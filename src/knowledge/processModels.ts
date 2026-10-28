import { id } from "../shared/id.js";
import type {
  AttachmentAnalysis,
  CoverageDimension,
  RequirementCoverageProfile,
  StateMachineModel,
  TestIntent,
  WorkflowModel
} from "../domain/types.js";
import {
  REQUIREMENT_ANALYSIS_POLICY,
  type RequirementAnalysis,
  type RequirementClause
} from "./policies.js";

type ProcessModels = {
  workflowModels: WorkflowModel[];
  stateMachineModels: StateMachineModel[];
};

export function buildProcessModels(input: {
  knowledgeProjectId: string;
  requirementSetId: string;
  analyses: AttachmentAnalysis[];
}): ProcessModels {
  const confirmed = input.analyses.filter((analysis) => analysis.status === "confirmed");
  return {
    workflowModels: confirmed
      .filter((analysis) => analysis.kind === "flowchart")
      .map((analysis) => workflowModel(input, analysis)),
    stateMachineModels: confirmed
      .filter((analysis) => analysis.kind === "state-machine")
      .map((analysis) => stateMachineModel(input, analysis))
  };
}

export function augmentAnalysisWithProcessModels(
  analysis: RequirementAnalysis,
  models: ProcessModels,
  attachmentAnalyses: AttachmentAnalysis[] = []
): RequirementAnalysis {
  const clauses: RequirementClause[] = [...analysis.clauses];
  const nodes = [...analysis.nodes];
  let clauseIndex = clauses.length;

  for (const attachment of attachmentAnalyses.filter(
    (item) => item.status === "confirmed" && item.kind !== "flowchart" && item.kind !== "state-machine"
  )) {
    for (const evidence of attachmentEvidenceClauses(attachment)) {
      const clause = processClause(
        ++clauseIndex,
        evidence.text,
        evidence.sourceRef,
        analysis.module,
        evidence.nodeTypes
      );
      clauses.push(clause);
      nodes.push(...nodesForProcessClause(analysis, clause, attachment.confidence));
    }
  }

  for (const model of models.workflowModels) {
    for (const transition of model.transitions) {
      const from = model.steps.find((step) => step.id === transition.from)?.label ?? transition.from;
      const to = model.steps.find((step) => step.id === transition.to)?.label ?? transition.to;
      const text = describeTransition(from, to, transition.condition, transition.actor);
      const clause = processClause(++clauseIndex, text, transition.sourceRefs[0], analysis.module, [
        "workflow",
        ...(transition.actor ? (["actor"] as const) : [])
      ]);
      clauses.push(clause);
      nodes.push(...nodesForProcessClause(analysis, clause, model.confidence));
    }
  }

  for (const model of models.stateMachineModels) {
    for (const transition of model.transitions) {
      const from = model.states.find((state) => state.id === transition.from)?.label ?? transition.from;
      const to = model.states.find((state) => state.id === transition.to)?.label ?? transition.to;
      const text = describeTransition(from, to, transition.trigger, transition.actor);
      const clause = processClause(++clauseIndex, text, transition.sourceRefs[0], analysis.module, [
        "state",
        "workflow",
        ...(transition.actor ? (["actor"] as const) : [])
      ]);
      clauses.push(clause);
      nodes.push(...nodesForProcessClause(analysis, clause, model.confidence));
    }
  }

  return { ...analysis, clauses, nodes };
}

export function buildProcessTestIntents(input: {
  knowledgeProjectId: string;
  analysis: RequirementAnalysis;
  workflowModels: WorkflowModel[];
  stateMachineModels: StateMachineModel[];
  baseIntents: TestIntent[];
}): TestIntent[] {
  const now = new Date().toISOString();
  const intents = input.baseIntents.map((intent) => ({ ...intent }));

  for (const model of input.workflowModels) {
    const paths = enumeratePaths(
      model.steps,
      model.transitions,
      model.startStepIds,
      model.endStepIds
    );
    for (const path of paths) {
      const intent = pathTestIntent({
        knowledgeProjectId: input.knowledgeProjectId,
        requirementSetId: input.analysis.requirementSetId,
        module: input.analysis.module,
        modelId: model.id,
        modelTitle: model.title,
        modelKind: "workflow",
        path,
        now
      });
      if (intent) intents.push(intent);
    }
  }

  const workflowSourceRefs = new Set(
    input.workflowModels.flatMap((model) => model.transitions.flatMap((transition) => transition.sourceRefs))
  );
  for (const model of input.stateMachineModels) {
    const eligibleTransitions = model.transitions.filter(
      (transition) => !workflowSourceRefs.has(transition.sourceRefs[0] ?? "")
    );
    const paths = enumeratePaths(
      model.states,
      eligibleTransitions,
      model.states.filter((state) => state.initial).map((state) => state.id),
      model.states.filter((state) => state.terminal).map((state) => state.id)
    );
    for (const path of paths) {
      const intent = pathTestIntent({
        knowledgeProjectId: input.knowledgeProjectId,
        requirementSetId: input.analysis.requirementSetId,
        module: input.analysis.module,
        modelId: model.id,
        modelTitle: model.title,
        modelKind: "state-machine",
        path,
        now
      });
      if (intent) intents.push(intent);
    }

    for (const transition of model.transitions) {
      const sourceRef = transition.sourceRefs[0];
      if (workflowSourceRefs.has(sourceRef)) continue;
      const from = model.states.find((state) => state.id === transition.from)?.label ?? transition.from;
      const to = model.states.find((state) => state.id === transition.to)?.label ?? transition.to;
      intents.push(negativeIntent(input, model.id, sourceRef, `${from} -> ${to}: missing prerequisite`,
        `Attempt the transition without first reaching ${from}`,
        `The transition to ${to} is rejected and the current state is preserved`, now));
      if (transition.actor) {
        intents.push(negativeIntent(input, model.id, sourceRef, `${from} -> ${to}: role mismatch`,
          `Attempt the transition as an actor other than ${transition.actor}`,
          `The transition is rejected for an unauthorized actor`, now));
      }
    }

    const invalid = firstInvalidTransition(model);
    if (invalid && model.sourceRefs[0]) {
      intents.push(negativeIntent(
        input,
        model.id,
        model.sourceRefs[0],
        `${invalid.from.label} -> ${invalid.to.label}: invalid transition`,
        `Attempt a direct transition from ${invalid.from.label} to ${invalid.to.label}`,
        "The undefined state transition is rejected",
        now
      ));
    }
  }

  return intents;
}

type PathNode = {
  id: string;
  label: string;
  actor?: string;
  preconditions?: string[];
};

type PathTransition = {
  id: string;
  from: string;
  to: string;
  condition?: string;
  trigger?: string;
  actor?: string;
  preconditions?: string[];
  sourceRefs: string[];
};

type EnumeratedPath = {
  nodes: PathNode[];
  transitions: PathTransition[];
  complete: boolean;
};

function enumeratePaths<Node extends PathNode, Transition extends PathTransition>(
  nodes: Node[],
  transitions: Transition[],
  startNodeIds: string[],
  endNodeIds: string[]
): EnumeratedPath[] {
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const outgoing = new Map<string, Transition[]>();
  for (const transition of transitions) {
    outgoing.set(transition.from, [...(outgoing.get(transition.from) ?? []), transition]);
  }
  const terminalIds = new Set(endNodeIds);
  const paths: EnumeratedPath[] = [];
  const maxPaths = 256;
  const append = (nodeIds: string[], pathTransitions: Transition[], complete: boolean) => {
    if (pathTransitions.length === 0) return;
    paths.push({
      nodes: nodeIds.flatMap((nodeId) => nodesById.has(nodeId) ? [nodesById.get(nodeId)!] : []),
      transitions: pathTransitions,
      complete
    });
    if (paths.length > maxPaths) throw new Error(`Process model exceeds the ${maxPaths}-path intent limit`);
  };
  const visit = (nodeIds: string[], pathTransitions: Transition[], visited: Set<string>) => {
    const current = nodeIds.at(-1);
    if (!current) return;
    if (terminalIds.has(current)) {
      append(nodeIds, pathTransitions, true);
      return;
    }
    const candidates = (outgoing.get(current) ?? []).filter((transition) => !visited.has(transition.to));
    if (candidates.length === 0) {
      append(nodeIds, pathTransitions, false);
      return;
    }
    for (const transition of candidates) {
      visit(
        [...nodeIds, transition.to],
        [...pathTransitions, transition],
        new Set([...visited, transition.to])
      );
    }
  };
  for (const startNodeId of startNodeIds) visit([startNodeId], [], new Set([startNodeId]));
  return paths;
}

function pathTestIntent(input: {
  knowledgeProjectId: string;
  requirementSetId: string;
  module: string;
  modelId: string;
  modelTitle: string;
  modelKind: "workflow" | "state-machine";
  path: EnumeratedPath;
  now: string;
}): TestIntent | undefined {
  const { path } = input;
  const requirementRefs = unique(path.transitions.flatMap((transition) => transition.sourceRefs));
  if (requirementRefs.length === 0) return undefined;
  const labelsById = new Map(path.nodes.map((node) => [node.id, node.label]));
  const pathConditions = unique(path.transitions.flatMap((transition) => transition.condition ? [transition.condition] : []));
  const actorsInOrder = path.transitions.flatMap((transition) => transition.actor ? [transition.actor] : []);
  const startLabel = path.nodes[0]?.label ?? path.transitions[0]?.from ?? input.modelTitle;
  const endLabel = path.nodes.at(-1)?.label ?? path.transitions.at(-1)?.to ?? input.modelTitle;
  const conditionsLabel = pathConditions.join(" AND ");
  const pathLabel = conditionsLabel || `${startLabel} → ${endLabel}`;
  const expectedResults = path.transitions.map((transition) => {
    const from = labelsById.get(transition.from) ?? transition.from;
    const to = labelsById.get(transition.to) ?? transition.to;
    const trigger = transition.trigger ?? transition.condition;
    const actor = transition.actor ? `${transition.actor} performs ` : "";
    return trigger
      ? `${actor}${trigger}: ${from} → ${to}`
      : `${actor}complete transition ${from} → ${to}`;
  });
  if (path.complete) expectedResults.push(`The modeled path reaches ${endLabel}`);

  return {
    id: id("intent"),
    knowledgeProjectId: input.knowledgeProjectId,
    requirementSetId: input.requirementSetId,
    title: `${input.module}: ${pathLabel}`,
    module: input.module,
    priority: "P1",
    objective: pathConditions.length > 0
      ? `Complete only the modeled path when ${conditionsLabel}`
      : `Complete the modeled path from ${startLabel} to ${endLabel}`,
    preconditions: unique([
      ...pathConditions,
      ...(input.modelKind === "state-machine" && startLabel ? [startLabel] : []),
      ...path.nodes.flatMap((node) => node.preconditions ?? []),
      ...path.transitions.flatMap((transition) => transition.preconditions ?? [])
    ]),
    ...(pathConditions.length > 0 ? { applicabilityConditions: pathConditions } : {}),
    expectedResults,
    requirementRefs,
    knowledgeNodeRefs: [`${input.modelKind}:${input.modelTitle}`],
    techniques: unique([
      "scenario",
      ...(input.modelKind === "state-machine" ? ["state-transition" as const] : []),
      ...(pathConditions.length > 0 ? ["decision-table" as const] : [])
    ]),
    coverageDimensions: input.modelKind === "state-machine" ? ["workflow", "state"] : ["workflow"],
    ...(path.complete ? { scenarioType: "positive" as const } : {}),
    processModelRefs: [input.modelId],
    selectedTransitionRefs: path.transitions.map((transition) => transition.id),
    ...(new Set(actorsInOrder).size > 1 ? { actorJourney: actorsInOrder } : {}),
    status: "draft",
    createdAt: input.now,
    updatedAt: input.now
  };
}

export function buildRequirementCoverageProfile(input: {
  knowledgeProjectId: string;
  requirementSetId: string;
  inputHash: string;
  analysis: RequirementAnalysis;
  intents: TestIntent[];
  workflowModels: WorkflowModel[];
  stateMachineModels: StateMachineModel[];
}): RequirementCoverageProfile {
  const dimensions = Object.fromEntries(
    (["field", "workflow", "state", "permission", "integration"] as CoverageDimension[]).map((dimension) => {
      const requirementRefs = unique(
        input.analysis.clauses
          .filter((clause) => clauseDimensions(clause).includes(dimension))
          .map((clause) => clause.sourceRef)
      );
      const matching = input.intents.filter((intent) => intent.coverageDimensions?.includes(dimension));
      const modeledRefs = dimension === "workflow"
        ? input.workflowModels.filter((model) => model.status === "confirmed").flatMap((model) => model.transitions.flatMap((transition) => transition.sourceRefs))
        : dimension === "state"
          ? input.stateMachineModels.filter((model) => model.status === "confirmed").flatMap((model) => model.transitions.flatMap((transition) => transition.sourceRefs))
          : [];
      const coveredRefs = requirementRefs.filter((sourceRef) =>
        matching.some((intent) => intent.requirementRefs.includes(sourceRef)) || modeledRefs.includes(sourceRef)
      );
      return [dimension, {
        requirementRefs,
        coveredRefs,
        missingRefs: requirementRefs.filter((sourceRef) => !coveredRefs.includes(sourceRef)),
        intentCount: matching.length
      }];
    })
  ) as RequirementCoverageProfile["dimensions"];

  const reasons: string[] = [];
  if (input.workflowModels.length > 0 && dimensions.workflow.missingRefs.length > 0) {
    reasons.push("Workflow transitions are missing traceable test coverage");
  }
  if (input.stateMachineModels.length > 0 && dimensions.state.missingRefs.length > 0) {
    reasons.push("State transitions are missing traceable test coverage");
  }
  if (input.workflowModels.some((model) => model.transitions.length === 0)) {
    const incomplete = input.workflowModels.find((model) => model.transitions.length === 0)!;
    reasons.push(
      incomplete.status === "confirmed"
        ? "A confirmed workflow model has no transitions"
        : `A ${incomplete.status} workflow model has no transitions`
    );
  }
  if (input.stateMachineModels.some((model) => model.states.length < 2 || model.transitions.length === 0)) {
    const incomplete = input.stateMachineModels.find(
      (model) => model.states.length < 2 || model.transitions.length === 0
    )!;
    reasons.push(
      incomplete.status === "confirmed"
        ? "A confirmed state-machine model lacks states or transitions"
        : `A ${incomplete.status} state-machine model lacks states or transitions`
    );
  }
  const processRequired = input.workflowModels.length + input.stateMachineModels.length > 0;
  if (processRequired && dimensions.workflow.coveredRefs.length + dimensions.state.coveredRefs.length === 0) {
    reasons.push("Requirement test design is field-heavy and has no process coverage");
  }

  return {
    id: id("coverageProfile"),
    knowledgeProjectId: input.knowledgeProjectId,
    requirementSetId: input.requirementSetId,
    inputHash: input.inputHash,
    dimensions,
    workflowModelIds: input.workflowModels.map((model) => model.id),
    stateMachineModelIds: input.stateMachineModels.map((model) => model.id),
    status: reasons.length > 0 ? "blocked" : "complete",
    reasons,
    generatedAt: new Date().toISOString()
  };
}

function workflowModel(
  input: { knowledgeProjectId: string; requirementSetId: string },
  analysis: AttachmentAnalysis
): WorkflowModel {
  const now = new Date().toISOString();
  const incoming = new Set(analysis.edges.map((edge) => edge.to));
  const outgoing = new Set(analysis.edges.map((edge) => edge.from));
  const transitions = analysis.edges.map((edge, index) => ({
    id: `${analysis.id}:transition:${index + 1}`,
    from: edge.from,
    to: edge.to,
    condition: edge.condition,
    actor: edge.actor,
    sourceRefs: [edgeSourceRef(analysis, index)]
  }));
  return {
    id: id("workflow"),
    knowledgeProjectId: input.knowledgeProjectId,
    requirementSetId: input.requirementSetId,
    attachmentAnalysisId: analysis.id,
    title: `Workflow from ${analysis.attachmentId}`,
    actors: unique(analysis.edges.map((edge) => edge.actor).filter((actor): actor is string => Boolean(actor))),
    steps: analysis.nodes.map((node) => ({
      id: node.id,
      label: node.label,
      actor: analysis.edges.find((edge) => edge.from === node.id)?.actor,
      sourceRefs: analysis.sourceRefs
    })),
    transitions,
    startStepIds: analysis.nodes.filter((node) => !incoming.has(node.id)).map((node) => node.id),
    endStepIds: analysis.nodes.filter((node) => !outgoing.has(node.id)).map((node) => node.id),
    sourceRefs: unique(transitions.flatMap((transition) => transition.sourceRefs)),
    confidence: analysis.confidence,
    status: "confirmed",
    createdAt: now,
    updatedAt: now
  };
}

function stateMachineModel(
  input: { knowledgeProjectId: string; requirementSetId: string },
  analysis: AttachmentAnalysis
): StateMachineModel {
  const now = new Date().toISOString();
  const incoming = new Set(analysis.edges.map((edge) => edge.to));
  const outgoing = new Set(analysis.edges.map((edge) => edge.from));
  const transitions = analysis.edges.map((edge, index) => ({
    id: `${analysis.id}:transition:${index + 1}`,
    from: edge.from,
    to: edge.to,
    trigger: edge.condition,
    actor: edge.actor,
    sourceRefs: [edgeSourceRef(analysis, index)]
  }));
  return {
    id: id("stateMachine"),
    knowledgeProjectId: input.knowledgeProjectId,
    requirementSetId: input.requirementSetId,
    attachmentAnalysisId: analysis.id,
    title: `State machine from ${analysis.attachmentId}`,
    states: analysis.nodes.map((node) => ({
      id: node.id,
      label: node.label,
      initial: !incoming.has(node.id),
      terminal: !outgoing.has(node.id),
      sourceRefs: analysis.sourceRefs
    })),
    transitions,
    sourceRefs: unique(transitions.flatMap((transition) => transition.sourceRefs)),
    confidence: analysis.confidence,
    status: "confirmed",
    createdAt: now,
    updatedAt: now
  };
}

function processClause(
  index: number,
  text: string,
  sourceRef: string,
  module: string,
  nodeTypes: RequirementClause["nodeTypes"]
): RequirementClause {
  return {
    id: `visual-clause-${index}`,
    index,
    text,
    sourceRef,
    sourceRefs: [sourceRef],
    module,
    kind: nodeTypes.includes("state") ? "state" : nodeTypes.includes("workflow") ? "workflow" : "goal",
    origin: "derived",
    confidence: 1,
    status: "confirmed",
    testDesignEligible: false,
    policyId: REQUIREMENT_ANALYSIS_POLICY.id,
    policyVersion: REQUIREMENT_ANALYSIS_POLICY.version,
    nodeTypes: [...nodeTypes]
  };
}

function attachmentEvidenceClauses(analysis: AttachmentAnalysis): Array<{
  text: string;
  sourceRef: string;
  nodeTypes: RequirementClause["nodeTypes"];
}> {
  if (analysis.kind === "table") {
    const rows = analysis.markdown
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.startsWith("|") && line.endsWith("|"))
      .map((line) => line.slice(1, -1).split("|").map((cell) => cell.trim()));
    const [header, ...body] = rows;
    const dataRows = body.filter((row) => !row.every((cell) => /^:?-{3,}:?$/.test(cell)));
    if (header && dataRows.length > 0) {
      return dataRows.map((row, index) => ({
        text: header.map((name, column) => `${name}: ${row[column] ?? ""}`).join("; "),
        sourceRef: `attachment-analysis:${analysis.id}#row:${index + 1}`,
        nodeTypes: ["field", "rule", "data-constraint"]
      }));
    }
  }
  const markdown = analysis.markdown.trim();
  if (!markdown) return [];
  return [{
    text: markdown,
    sourceRef: `attachment-analysis:${analysis.id}`,
    nodeTypes: analysis.kind === "wireframe" ? ["field", "workflow"] : ["requirement"]
  }];
}

function nodesForProcessClause(
  analysis: RequirementAnalysis,
  clause: RequirementClause,
  confidence: number
): RequirementAnalysis["nodes"] {
  return clause.nodeTypes.map((type) => ({
    requirementSetId: analysis.requirementSetId,
    type,
    title: `${clause.module} ${type}: ${clause.text}`,
    content: clause.text,
    module: clause.module,
    sourceRefs: [clause.sourceRef],
    origin: "derived" as const,
    confidence,
    status: "draft" as const,
    policyId: analysis.policyId,
    policyVersion: analysis.policyVersion
  }));
}

function negativeIntent(
  input: { knowledgeProjectId: string; analysis: RequirementAnalysis },
  modelId: string,
  sourceRef: string,
  title: string,
  objective: string,
  expected: string,
  now: string
): TestIntent {
  return {
    id: id("intent"),
    knowledgeProjectId: input.knowledgeProjectId,
    requirementSetId: input.analysis.requirementSetId,
    title: `${input.analysis.module}: ${title}`,
    module: input.analysis.module,
    priority: "P1",
    objective,
    preconditions: ["The requirement baseline is approved", "The target environment is available"],
    expectedResults: [expected],
    requirementRefs: [sourceRef],
    knowledgeNodeRefs: [`state-machine:${modelId}`],
    techniques: ["state-transition", "error-guessing"],
    coverageDimensions: ["state", "workflow"],
    scenarioType: "negative",
    processModelRefs: [modelId],
    status: "draft",
    createdAt: now,
    updatedAt: now
  };
}

function firstInvalidTransition(model: StateMachineModel) {
  for (const from of model.states) {
    for (const to of model.states) {
      if (from.id === to.id) continue;
      if (!model.transitions.some((transition) => transition.from === from.id && transition.to === to.id)) {
        return { from, to };
      }
    }
  }
  return undefined;
}

function edgeSourceRef(analysis: AttachmentAnalysis, index: number) {
  return `attachment-analysis:${analysis.id}#edge:${index + 1}`;
}

function describeTransition(from: string, to: string, condition?: string, actor?: string) {
  return [actor ? `${actor} moves` : "Move", `from ${from} to ${to}`, condition ? `when ${condition}` : ""]
    .filter(Boolean)
    .join(" ");
}

function clauseDimensions(clause: RequirementClause): CoverageDimension[] {
  return unique(clause.nodeTypes.flatMap((type): CoverageDimension[] => {
    if (type === "field" || type === "data-constraint") return ["field"];
    if (type === "workflow" || type === "object") return ["workflow"];
    if (type === "state" || type === "rule") return ["state"];
    if (type === "permission") return ["permission"];
    if (type === "integration") return ["integration"];
    return [];
  }));
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}
