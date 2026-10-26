import type {
  ExecutableCase,
  ExecutableCaseStep,
  StateMachineModel,
  TestIntent,
  WorkflowModel
} from "../domain/types.js";
import type { InMemoryBrainCreatorRepository } from "../domain/repository.js";
import { id } from "../shared/id.js";
import { normalizeRequirementText } from "./policies.js";

export type SemanticCompilationResult = {
  steps: ExecutableCaseStep[];
  source: "state-machine" | "workflow" | "requirement-clause";
  processPathSourceRefs: string[];
  ambiguity?: {
    reason: string;
    sourceRefs: string[];
  };
};

export type ExecutableCaseReadiness = {
  verdict: "ready" | "blocked";
  reasons: string[];
  sourceRefs: string[];
};

/**
 * A persisted `ready` status is not proof that a case can be executed.
 * Keep this gate deterministic so incomplete cases fail closed before an
 * agent or browser is started.
 */
export function evaluateExecutableCaseReadiness(
  executableCase: Pick<
    ExecutableCase,
    "steps" | "assertionContracts" | "pathPlan" | "statePlan" | "dataPlan"
  >
): ExecutableCaseReadiness {
  const reasons: string[] = [];
  const sourceRefs = unique([
    ...executableCase.steps.flatMap((step) => step.sourceRefs),
    ...(executableCase.pathPlan?.navigationSourceRefs ?? []),
    ...(executableCase.statePlan?.transitionSourceRefs ?? []),
    ...(executableCase.dataPlan?.sourceRefs ?? []),
  ]);
  if (executableCase.steps.length === 0) reasons.push("Executable case has no steps.");
  const stepIds = executableCase.steps.map((step) => step.id);
  if (new Set(stepIds).size !== stepIds.length) reasons.push("Executable case contains duplicate step ids.");
  if (executableCase.steps.some((step, index) => step.order !== index + 1)) {
    reasons.push("Executable case step order is not contiguous.");
  }
  const provenance = validateStepProvenance(executableCase.steps);
  if (!provenance.valid) {
    reasons.push(`Executable case steps lack source provenance: ${provenance.invalidStepIds.join(", ")}.`);
  }

  const assertionSteps = executableCase.steps.filter((step) => step.action === "assert");
  const contracts = executableCase.assertionContracts ?? [];
  const hasDataPreparationStep = executableCase.steps.some((step) => Boolean(step.dataProfileId));
  if (assertionSteps.length === 0 && !hasDataPreparationStep) {
    reasons.push("Executable case has no business assertion oracle.");
  }
  if (contracts.length !== assertionSteps.length) {
    reasons.push(
      `Assertion contract count (${contracts.length}) does not match assertion step count (${assertionSteps.length}).`
    );
  }
  const assertionStepIds = new Set(assertionSteps.map((step) => step.id));
  for (const contract of contracts) {
    if (!contract.stepId || !assertionStepIds.has(contract.stepId)) {
      reasons.push(`Assertion contract ${contract.id} is not bound to an assertion step.`);
    }
    if (contract.requirementRefs.length === 0) reasons.push(`Assertion contract ${contract.id} has no requirement source.`);
    if (contract.evidenceRequirements.length === 0) reasons.push(`Assertion contract ${contract.id} has no evidence requirements.`);
  }
  for (const plan of [executableCase.pathPlan, executableCase.statePlan]) {
    if (plan && !["not-required", "unique"].includes(plan.verdict)) {
      reasons.push(`Executable case plan is ${plan.verdict}.`);
    }
  }
  return { verdict: reasons.length === 0 ? "ready" : "blocked", reasons, sourceRefs };
}

export function compileIntentSemanticSteps(input: {
  intent: TestIntent;
  workflowModels: WorkflowModel[];
  stateMachineModels: StateMachineModel[];
  additionalSourceRefs: string[];
}): SemanticCompilationResult {
  const sourceRefs = unique([...input.intent.requirementRefs, ...input.additionalSourceRefs]);
  const candidates = [
    ...confirmedStateTransitions(input.intent, input.stateMachineModels),
    ...confirmedWorkflowTransitions(input.intent, input.workflowModels)
  ];
  const explicitModelRefs = unique(input.intent.processModelRefs ?? []);
  const confirmedModelIds = new Set([
    ...confirmedModels(input.intent, input.stateMachineModels),
    ...confirmedModels(input.intent, input.workflowModels)
  ].map((model) => model.id));
  const confirmedStateModels = confirmedModels(input.intent, input.stateMachineModels);
  const confirmedWorkflowModels = confirmedModels(input.intent, input.workflowModels);
  const selectedTransitionRefs = unique(input.intent.selectedTransitionRefs ?? []);
  const availableTransitionRefs = new Set([
    ...confirmedStateModels.flatMap((model) =>
      model.transitions.map((transition) => transitionSourceRef({ source: "state-machine", model, transition }))),
    ...confirmedWorkflowModels.flatMap((model) =>
      model.transitions.map((transition) => transitionSourceRef({ source: "workflow", model, transition })))
  ]);
  const selectedPathSource = selectedTransitionRefs.length === 0
    ? undefined
    : selectedTransitionRefs.every((reference) => reference.startsWith("state-machine:"))
      ? "state-machine"
      : selectedTransitionRefs.every((reference) => reference.startsWith("workflow:"))
        ? "workflow"
        : "mixed";
  const unresolvedTransitionRefs = selectedTransitionRefs.filter((reference) => !availableTransitionRefs.has(reference));
  if (unresolvedTransitionRefs.length > 0) {
    const refs = unique([...sourceRefs, ...selectedTransitionRefs]);
    return {
      source: selectedPathSource === "workflow" ? "workflow" : "state-machine",
      processPathSourceRefs: refs,
      steps: [],
      ambiguity: {
        reason: `Explicitly selected process transitions are not all present in the confirmed model scope: ${unresolvedTransitionRefs.join(", ")}.`,
        sourceRefs: refs
      }
    };
  }
  const unresolvedModelRefs = explicitModelRefs.filter((modelRef) => !confirmedModelIds.has(modelRef));
  if (unresolvedModelRefs.length > 0) {
    const missingModelRefs = unique([
      ...sourceRefs,
      ...unresolvedModelRefs.map((modelRef) => `process-model:${modelRef}`)
    ]);
    return {
      source: "requirement-clause",
      processPathSourceRefs: missingModelRefs,
      steps: [],
      ambiguity: {
        reason: `The intent has unresolved explicit process model references: ${unresolvedModelRefs.join(", ")}; the compiler cannot compile a process action with a partial model scope.`,
        sourceRefs: missingModelRefs
      }
    };
  }

  const negatedStateRefs = negatedProcessStateRefs(input.intent, confirmedStateModels, confirmedWorkflowModels);
  if (negatedStateRefs.length > 0) {
    const refs = unique([...sourceRefs, ...negatedStateRefs]);
    return {
      source: "requirement-clause",
      processPathSourceRefs: refs,
      steps: [],
      ambiguity: {
        reason: "The intent contains a negated process-state mention; the compiler cannot treat it as an explicit path endpoint. Clarify the intended starting state or target outcome before compilation.",
        sourceRefs: refs
      }
    };
  }

  if (selectedPathSource === "mixed") {
    const refs = unique([...sourceRefs, ...selectedTransitionRefs]);
    return {
      source: "requirement-clause",
      processPathSourceRefs: refs,
      steps: [],
      ambiguity: {
        reason: "Explicitly selected transitions must belong to one confirmed process-model family; the compiler will not combine unrelated state and workflow paths.",
        sourceRefs: refs
      }
    };
  }

  if (selectedPathSource === undefined &&
      hasExplicitStatePath(input.intent, confirmedStateModels) &&
      hasExplicitWorkflowPath(input.intent, confirmedWorkflowModels)) {
    const statePaths = confirmedStateModels.flatMap((model) => statePathsForIntent(input.intent, model));
    const workflowPaths = confirmedWorkflowModels.flatMap((model) => workflowPathsForIntent(input.intent, model));
    if (statePaths.length > 0 && workflowPaths.length > 0) {
      const pathRefs = unique([
        ...sourceRefs,
        ...statePaths.flatMap((path) => [
          `state-machine:${path.model.id}`,
          ...path.transitions.flatMap((transition) => [
            ...transition.sourceRefs,
            transitionSourceRef({ source: "state-machine", model: path.model, transition })
          ])
        ]),
        ...workflowPaths.flatMap((path) => [
          `workflow:${path.model.id}`,
          ...path.transitions.flatMap((transition) => [
            ...transition.sourceRefs,
            transitionSourceRef({ source: "workflow", model: path.model, transition })
          ])
        ])
      ]);
      return {
        source: "requirement-clause",
        processPathSourceRefs: pathRefs,
        steps: [],
        ambiguity: {
          reason: "Both state and workflow models provide confirmed endpoint paths; select one model and transition family before compilation.",
          sourceRefs: pathRefs
        }
      };
    }
  }

  if (selectedPathSource !== "workflow" && hasExplicitStatePath(input.intent, confirmedStateModels)) {
    const paths = confirmedStateModels.flatMap((model) => statePathsForIntent(input.intent, model));
    if (paths.length > 1) {
      const pathRefs = unique([
        ...sourceRefs,
        ...paths.flatMap((path) => [
          `state-machine:${path.model.id}`,
          ...path.transitions.flatMap((transition) => [
            ...transition.sourceRefs,
            `state-machine:${path.model.id}#transition:${transition.id}`
          ])
        ])
      ]);
      return {
        source: "state-machine",
        processPathSourceRefs: pathRefs,
        steps: [],
        ambiguity: {
          reason: `Multiple confirmed state paths match the explicit starting and target states; select a path or add transition constraints (${paths.length} candidates).`,
          sourceRefs: pathRefs
        }
      };
    }
    if (paths.length === 1) {
      const path = paths[0];
      const stateLabels = new Map(path.model.states.map((state) => [state.id, state.label]));
      const pathRefs = unique([
        ...sourceRefs,
        ...path.transitions.flatMap((transition) => [
          ...transition.sourceRefs,
          transitionSourceRef({ source: "state-machine", model: path.model, transition }),
          `state-machine:${path.model.id}`
        ])
      ]);
      const steps = path.transitions.flatMap((transition) => {
        const from = stateLabels.get(transition.from) ?? transition.from;
        const to = stateLabels.get(transition.to) ?? transition.to;
        const actor = transition.actor ? ` as ${transition.actor}` : "";
        const conditions = [
          ...(transition.preconditions ?? []),
          transition.trigger
        ].filter((value): value is string => Boolean(value));
        return processSteps({
          module: input.intent.module,
          action: transitionAction(transition.trigger),
          actionInstruction: `Trigger the confirmed state transition from ${from} to ${to}${actor}${conditions.length ? ` when ${conditions.join(" and ")}` : ""}`,
          businessContext: transitionBusinessContext(transition.businessObject, transition.sideEffects),
          targetSemantic: transition.trigger || `transition to ${to}`,
          expected: `State becomes ${to}`,
          sourceRefs: unique([...pathRefs, ...transition.sourceRefs, transitionSourceRef({ source: "state-machine", model: path.model, transition })])
        });
      }).map((step, index) => ({ ...step, id: id("step"), order: index + 1 }));
      return {
        source: "state-machine",
        processPathSourceRefs: pathRefs,
        steps
      };
    }
    const pathRefs = unique([
      ...sourceRefs,
      ...confirmedStateModels.flatMap((model) => [
        `state-machine:${model.id}`,
        ...model.sourceRefs,
        ...model.transitions.flatMap((transition) => [
          ...transition.sourceRefs,
          `state-machine:${model.id}#transition:${transition.id}`
        ])
      ])
    ]);
    return {
      source: "state-machine",
      processPathSourceRefs: pathRefs,
      steps: [],
      ambiguity: {
        reason: "The explicit starting and target states do not resolve to a unique confirmed path; the compiler will not replace a missing path with generic clause steps.",
        sourceRefs: pathRefs
      }
    };
  }

  if (selectedPathSource !== "state-machine" && hasExplicitWorkflowPath(input.intent, confirmedWorkflowModels)) {
    const paths = confirmedWorkflowModels.flatMap((model) => workflowPathsForIntent(input.intent, model));
    if (paths.length > 1) {
      const pathRefs = unique([
        ...sourceRefs,
        ...paths.flatMap((path) => [
          `workflow:${path.model.id}`,
          ...path.transitions.flatMap((transition) => [
            ...transition.sourceRefs,
            transitionSourceRef({ source: "workflow", model: path.model, transition })
          ])
        ])
      ]);
      return {
        source: "workflow",
        processPathSourceRefs: pathRefs,
        steps: [],
        ambiguity: {
          reason: `Multiple confirmed workflow paths match the explicit starting and target steps; select a path or add transition constraints (${paths.length} candidates).`,
          sourceRefs: pathRefs
        }
      };
    }
    if (paths.length === 1) {
      const path = paths[0];
      const stepLabels = new Map(path.model.steps.map((step) => [step.id, step.label]));
      const pathRefs = unique([
        ...sourceRefs,
        ...path.transitions.flatMap((transition) => [
          ...transition.sourceRefs,
          transitionSourceRef({ source: "workflow", model: path.model, transition }),
          `workflow:${path.model.id}`
        ])
      ]);
      const steps = path.transitions.flatMap((transition) => {
        const from = stepLabels.get(transition.from) ?? transition.from;
        const to = stepLabels.get(transition.to) ?? transition.to;
        const fromStep = path.model.steps.find((step) => step.id === transition.from);
        const toStep = path.model.steps.find((step) => step.id === transition.to);
        const actor = transition.actor ?? fromStep?.actor;
        const conditions = [
          ...(transition.preconditions ?? []),
          transition.condition,
          transition.trigger
        ].filter((value): value is string => Boolean(value));
        return processSteps({
          module: input.intent.module,
          action: transitionAction(transition.trigger ?? transition.condition),
          actionInstruction: `Follow the confirmed workflow from ${from} to ${to}${actor ? ` as ${actor}` : ""}${conditions.length ? ` when ${conditions.join(" and ")}` : ""}`,
          businessContext: transitionBusinessContext(
            transition.businessObject ?? toStep?.businessObject ?? fromStep?.businessObject,
            unique([...(fromStep?.sideEffects ?? []), ...(transition.sideEffects ?? []), ...(toStep?.sideEffects ?? [])])
          ),
          targetSemantic: transition.trigger || transition.condition || to,
          expected: `Workflow reaches ${to}`,
          sourceRefs: unique([
            ...pathRefs,
            ...(fromStep?.sourceRefs ?? []),
            ...transition.sourceRefs,
            ...(toStep?.sourceRefs ?? []),
            transitionSourceRef({ source: "workflow", model: path.model, transition })
          ])
        });
      }).map((step, index) => ({ ...step, id: id("step"), order: index + 1 }));
      return {
        source: "workflow",
        processPathSourceRefs: pathRefs,
        steps
      };
    }
    const pathRefs = unique([
      ...sourceRefs,
      ...confirmedWorkflowModels.flatMap((model) => [
        `workflow:${model.id}`,
        ...model.sourceRefs,
        ...model.transitions.flatMap((transition) => [
          ...transition.sourceRefs,
          transitionSourceRef({ source: "workflow", model, transition })
        ])
      ])
    ]);
    return {
      source: "workflow",
      processPathSourceRefs: pathRefs,
      steps: [],
      ambiguity: {
        reason: "The explicit starting and target steps do not resolve to a unique confirmed workflow path; the compiler will not replace a missing path with generic clause steps.",
        sourceRefs: pathRefs
      }
    };
  }

  const matches = selectedTransitionRefs.length > 0 ? [] : matchingIntentTransitions(input.intent, candidates);
  if (matches.length > 1) {
    const ambiguousSourceRefs = unique([
      ...sourceRefs,
      ...matches.flatMap((match) => [
        ...match.transition.sourceRefs,
        modelSourceRef(match),
        transitionSourceRef(match)
      ])
    ]);
    const missingStateEndpoint = matches.some(
      (match) => match.source === "state-machine" && (
        !match.model.states.some((state) => state.id === match.transition.from) ||
        !match.model.states.some((state) => state.id === match.transition.to)
      )
    );
    return {
      source: compilationSourceFor(matches),
      processPathSourceRefs: ambiguousSourceRefs,
      steps: [],
      ambiguity: {
        reason: [
          `Multiple confirmed process transitions match the intent; an explicit model and transition reference or a unique confirmed path is required (${matches.length} candidates).`,
          "The compiler resolves directly referenced edges only and does not select a path by keyword scoring.",
          ...(missingStateEndpoint
            ? ["At least one candidate state transition has an endpoint missing from the model; endpoint inference is outside this compiler."]
            : [])
        ].join(" "),
        sourceRefs: ambiguousSourceRefs
      }
    };
  }

  const match = matches[0];
  if (match?.source === "state-machine") {
    const from = match.model.states.find((state) => state.id === match.transition.from)?.label ?? match.transition.from;
    const to = match.model.states.find((state) => state.id === match.transition.to)?.label ?? match.transition.to;
    const transitionRefs = unique([...sourceRefs, ...match.transition.sourceRefs, modelSourceRef(match)]);
    if (missingStateEndpoint(match)) {
      return {
        source: "state-machine",
        processPathSourceRefs: transitionRefs,
        steps: [],
        ambiguity: {
          reason: `The confirmed state transition ${match.transition.id} references a missing state endpoint; the compiler does not infer incomplete state paths.`,
          sourceRefs: unique([...transitionRefs, transitionSourceRef(match)])
        }
      };
    }
    return {
      source: "state-machine",
      processPathSourceRefs: transitionRefs,
      steps: processSteps({
        module: input.intent.module,
        action: transitionAction(match.transition.trigger),
        actionInstruction: `Trigger the confirmed state transition from ${from} to ${to}${match.transition.trigger ? ` using ${match.transition.trigger}` : ""}`,
        businessContext: transitionBusinessContext(match.transition.businessObject, match.transition.sideEffects),
        targetSemantic: match.transition.trigger || `transition to ${to}`,
        expected: input.intent.expectedResults[0] || `State becomes ${to}`,
        sourceRefs: transitionRefs
      })
    };
  }

  if (match?.source === "workflow") {
    const from = match.model.steps.find((step) => step.id === match.transition.from)?.label ?? match.transition.from;
    const to = match.model.steps.find((step) => step.id === match.transition.to)?.label ?? match.transition.to;
    const transitionRefs = unique([...sourceRefs, ...match.transition.sourceRefs, modelSourceRef(match)]);
    if (missingWorkflowEndpoint(match)) {
      return {
        source: "workflow",
        processPathSourceRefs: transitionRefs,
        steps: [],
        ambiguity: {
          reason: `The confirmed workflow transition ${match.transition.id} references a missing workflow step endpoint; the compiler does not infer incomplete workflow paths.`,
          sourceRefs: unique([...transitionRefs, transitionSourceRef(match)])
        }
      };
    }
    return {
      source: "workflow",
      processPathSourceRefs: transitionRefs,
      steps: processSteps({
        module: input.intent.module,
        action: transitionAction(match.transition.condition),
        actionInstruction: `Follow the confirmed workflow from ${from} to ${to}${match.transition.condition ? ` when ${match.transition.condition}` : ""}`,
        businessContext: transitionBusinessContext(match.transition.businessObject, match.transition.sideEffects),
        targetSemantic: match.transition.condition || to,
        expected: input.intent.expectedResults[0] || `Workflow reaches ${to}`,
        sourceRefs: transitionRefs
      })
    };
  }

  if (explicitModelRefs.length > 0) {
    const explicitModelSourceRefs = unique([
      ...sourceRefs,
      ...explicitModelRefs.map((modelRef) => `process-model:${modelRef}`)
    ]);
    return {
      source: "requirement-clause",
      processPathSourceRefs: explicitModelSourceRefs,
      steps: [],
      ambiguity: {
        reason: "The explicitly referenced confirmed process model has no transition matching the intent source evidence; the compiler cannot choose a process action.",
        sourceRefs: explicitModelSourceRefs
      }
    };
  }

  return {
    source: "requirement-clause",
    processPathSourceRefs: sourceRefs,
    steps: clauseSteps(input.intent, sourceRefs)
  };
}

export function validateStepProvenance(steps: ExecutableCaseStep[]) {
  const invalidStepIds = steps
    .filter((step) => step.sourceRefs.length === 0 || step.sourceRefs.some((ref) => !ref.trim()))
    .map((step) => step.id);
  return { valid: invalidStepIds.length === 0, invalidStepIds };
}

export function executableCaseCompileStatus(
  repository: InMemoryBrainCreatorRepository,
  executableCase: ExecutableCase
): "ready" | "needs-exploration" | "needs-data" | "ambiguous" | "blocked" {
  if (executableCase.status === "ready" && evaluateExecutableCaseReadiness(executableCase).verdict === "blocked") {
    return "blocked";
  }
  const hasOpenGap = executableCase.gapIds.some((gapId) =>
    repository.gaps.some((gap) => gap.id === gapId && gap.status === "open")
  );
  if (hasOpenGap) return "blocked";
  const dependencyIssues = executableCase.caseDependencyGraph?.unresolved.filter(
    (issue) => issue.testIntentId === executableCase.testIntentId
  ) ?? [];
  if (dependencyIssues.some((issue) => issue.reason === "cycle")) return "blocked";
  if (dependencyIssues.some((issue) => issue.reason === "ambiguous-producer")) return "ambiguous";
  if (dependencyIssues.some((issue) => issue.reason === "missing-producer")) return "needs-data";
  const plannedEntityReferences = new Set(executableCase.dataPlan?.entityReferences ?? []);
  if ((executableCase.entityReferenceRequirements ?? []).some(
    (reference) => !plannedEntityReferences.has(reference)
  )) return "needs-data";
  const pendingTasks = repository.explorationTasks.filter(
    (task) => executableCase.explorationTaskIds?.includes(task.id) && task.status === "pending"
  );
  if (pendingTasks.length > 0) {
    return executableCase.pathPlan?.verdict === "ambiguous" ||
      executableCase.statePlan?.verdict === "ambiguous"
      ? "ambiguous"
      : "needs-exploration";
  }
  if (
    executableCase.dataPlan?.operations.some(
      (operation) => operation.status === "needs-resolution"
    )
  ) {
    return "needs-data";
  }
  return "ready";
}

function processSteps(input: {
  module: string;
  action: "click" | "select";
  actionInstruction: string;
  businessContext?: string[];
  targetSemantic: string;
  expected: string;
  sourceRefs: string[];
}): ExecutableCaseStep[] {
  return [
    step(1, "navigate", `Open the ${input.module} workflow entry`, `${input.module} entry`, input.sourceRefs, "derived"),
    step(
      2,
      input.action,
      [input.actionInstruction, ...(input.businessContext ?? [])].join(". "),
      input.targetSemantic,
      input.sourceRefs,
      "derived"
    ),
    {
      ...step(3, "assert", "Verify the requirement-defined transition outcome", "transition outcome", input.sourceRefs, "source"),
      expected: normalizeRequirementText(input.expected),
      assertion: deriveAssertion(input.expected)
    }
  ];
}

function transitionBusinessContext(businessObject?: string, sideEffects: string[] = []) {
  return [
    ...(businessObject ? [`Business object: ${businessObject}`] : []),
    ...sideEffects.map((effect) => `Business side effect: ${effect}`)
  ];
}

function clauseSteps(intent: TestIntent, sourceRefs: string[]): ExecutableCaseStep[] {
  const steps: ExecutableCaseStep[] = [
    step(1, "navigate", `Open the ${intent.module} entry`, `${intent.module} entry`, sourceRefs, "derived")
  ];
  const content = `${intent.title} ${intent.objective}`;
  if (/\b(create|new)\b|\u65b0\u5efa|\u521b\u5efa/i.test(content)) {
    steps.push(step(steps.length + 1, "click", "Start the requirement-defined create action", "new record action", sourceRefs, "source"));
  }
  if (/\b(fill|form|input|enter)\b|\u586b\u5199|\u8868\u5355|\u8f93\u5165/i.test(content)) {
    steps.push(step(steps.length + 1, "fill", "Fill the requirement-defined fields", "business form", sourceRefs, "source"));
  }
  if (/\b(select|choose)\b|\u9009\u62e9/i.test(content)) {
    const selectionTarget = extractSelectionTarget(content);
    steps.push(
      step(
        steps.length + 1,
        "select",
        selectionTarget
          ? `Select ${selectionTarget}`
          : "Select the requirement-defined option",
        selectionTarget || "conditional selector",
        sourceRefs,
        "source"
      )
    );
  }
  const expected = normalizeRequirementText(intent.expectedResults[0] || intent.objective);
  const assertion = deriveAssertion(`${content} ${expected}`);
  steps.push({
    ...step(steps.length + 1, "assert", "Verify the approved requirement outcome", "requirement outcome", sourceRefs, "source"),
    expected: assertion?.expected ?? expected,
    assertion
  });
  return steps;
}

function deriveAssertion(content: string): ExecutableCaseStep["assertion"] {
  const normalized = normalizeRequirementText(content);
  const branches = [...normalized.matchAll(
    /(?:当|若)?\s*([^；。;]+?)\s*(?:时|then)\s*[,，、:]?\s*(?:应|should)?\s*(显示|展示|隐藏|可编辑|不可编辑|出现|消失)\s*[:：]?\s*([^；。;]+)/giu
  )]
    .map((match) => {
      const condition = match[1]
        .replace(/^.*(?:当|若)\s*/u, "")
        .trim();
      const fields = normalizeFieldList(match[3]);
      if (!fields.length) return undefined;
      const visibility = /隐藏|不可编辑|消失/u.test(match[2]) ? match[2] : "显示";
      return `当${condition}时，应${visibility}：${fields.join("、")}`;
    })
    .filter((value): value is string => Boolean(value));

  if (branches.length > 0) {
    return { type: "visibility", strength: "limited", expected: branches.join("；") };
  }
  if (/显示|隐藏|可见|visible|shown|hidden/i.test(normalized)) {
    return { type: "visibility", strength: "limited", expected: normalized };
  }
  if (/状态|state|启用|禁用|draft|approved|rejected/i.test(normalized)) {
    return { type: "state", strength: "limited", expected: normalized };
  }
  if (/流程|审批|驳回|workflow|approved|rejected/i.test(normalized)) {
    return { type: "workflow", strength: "limited", expected: normalized };
  }
  return undefined;
}

function normalizeFieldList(value: string) {
  return [...new Set(
    value
      .replace(/\s+(?:选择|按|验证|检查|verify|check).*/i, "")
      .replace(/[，,]\s*(?:在|位于).*/u, "")
      .split(/[、，,]/)
      .map((field) => field.trim())
      .filter(Boolean)
  )];
}

function extractSelectionTarget(content: string) {
  const match = content.match(
    /(?:选择|选取|choose|select)\s*([^，,。.;；\s后若时则]{2,24})/i
  );
  return match?.[1]?.trim() || undefined;
}

function step(
  order: number,
  action: ExecutableCaseStep["action"],
  instruction: string,
  targetSemantic: string,
  sourceRefs: string[],
  origin: ExecutableCaseStep["origin"]
): ExecutableCaseStep {
  return { id: id("step"), order, action, instruction, targetSemantic, sourceRefs, origin };
}

type StateTransitionMatch = {
  source: "state-machine";
  model: StateMachineModel;
  transition: StateMachineModel["transitions"][number];
};

type WorkflowTransitionMatch = {
  source: "workflow";
  model: WorkflowModel;
  transition: WorkflowModel["transitions"][number];
};

type SemanticTransitionMatch = StateTransitionMatch | WorkflowTransitionMatch;

type StatePath = {
  model: StateMachineModel;
  transitions: StateMachineModel["transitions"];
};

type WorkflowPath = {
  model: WorkflowModel;
  transitions: WorkflowModel["transitions"];
};

function statePathsForIntent(intent: TestIntent, model: StateMachineModel): StatePath[] {
  const matchedStarts = model.states.filter((state) =>
    intent.preconditions.some((condition) => mentionsState(condition, state.id, state.label))
  );
  const startIds = matchedStarts.length > 0
    ? unique(matchedStarts.map((state) => state.id))
    : model.states.filter((state) => state.initial).map((state) => state.id);
  const matchedTargets = model.states.filter((state) =>
    intent.expectedResults.some((result) => mentionsState(result, state.id, state.label))
  );
  if (startIds.length !== 1 || matchedTargets.length !== 1 || startIds[0] === matchedTargets[0].id) return [];
  const paths: StatePath[] = [];
  const selectedTransitionRefs = unique(intent.selectedTransitionRefs ?? []);
  const modelTransitionRefs = new Set(model.transitions.map((transition) => transitionSourceRef({
    source: "state-machine",
    model,
    transition
  })));
  if (selectedTransitionRefs.some((reference) => !modelTransitionRefs.has(reference))) return [];
  const selectedTransitionRefSet = new Set(selectedTransitionRefs);
  const outgoing = new Map<string, StateMachineModel["transitions"]>();
  for (const transition of model.transitions) {
    if (transition.validity === "forbidden") continue;
    const reference = transitionSourceRef({ source: "state-machine", model, transition });
    if (selectedTransitionRefs.length > 0 && !selectedTransitionRefSet.has(reference)) continue;
    const edges = outgoing.get(transition.from) ?? [];
    edges.push(transition);
    outgoing.set(transition.from, edges);
  }
  const targetId = matchedTargets[0].id;
  const visited = new Set([startIds[0]]);
  const transitions: StateMachineModel["transitions"] = [];
  const stack = [{ stateId: startIds[0], edges: outgoing.get(startIds[0]) ?? [], nextEdge: 0 }];
  while (stack.length > 0 && paths.length < 2) {
    const frame = stack[stack.length - 1];
    if (frame.nextEdge >= frame.edges.length) {
      stack.pop();
      if (stack.length > 0) {
        visited.delete(frame.stateId);
        transitions.pop();
      }
      continue;
    }
    const transition = frame.edges[frame.nextEdge++];
    if (visited.has(transition.to)) continue;
    if (transition.to === targetId) {
      paths.push({ model, transitions: [...transitions, transition] });
      continue;
    }
    visited.add(transition.to);
    transitions.push(transition);
    stack.push({
      stateId: transition.to,
      edges: outgoing.get(transition.to) ?? [],
      nextEdge: 0
    });
  }
  if (selectedTransitionRefs.length > 0) {
    return paths.filter((path) => {
      const pathRefs = new Set(path.transitions.map((transition) => transitionSourceRef({
        source: "state-machine",
        model,
        transition
      })));
      return pathRefs.size === selectedTransitionRefs.length && selectedTransitionRefs.every((reference) => pathRefs.has(reference));
    });
  }
  return paths;
}

function workflowPathsForIntent(intent: TestIntent, model: WorkflowModel): WorkflowPath[] {
  const matchedStarts = model.steps.filter((step) =>
    intent.preconditions.some((condition) => mentionsState(condition, step.id, step.label))
  );
  const startIds = matchedStarts.length > 0
    ? unique(matchedStarts.map((step) => step.id))
    : unique(model.startStepIds);
  const matchedTargets = model.steps.filter((step) =>
    intent.expectedResults.some((result) => mentionsState(result, step.id, step.label))
  );
  const targetIds = unique(matchedTargets.map((step) => step.id));
  if (startIds.length !== 1 || targetIds.length !== 1 || startIds[0] === targetIds[0]) return [];

  const selectedTransitionRefs = unique(intent.selectedTransitionRefs ?? []);
  const transitionRefs = new Set(model.transitions.map((transition) => transitionSourceRef({
    source: "workflow",
    model,
    transition
  })));
  if (selectedTransitionRefs.some((reference) => !transitionRefs.has(reference))) return [];
  const selectedRefs = new Set(selectedTransitionRefs);
  const outgoing = new Map<string, WorkflowModel["transitions"]>();
  for (const transition of model.transitions) {
    const reference = transitionSourceRef({ source: "workflow", model, transition });
    if (selectedTransitionRefs.length > 0 && !selectedRefs.has(reference)) continue;
    const edges = outgoing.get(transition.from) ?? [];
    edges.push(transition);
    outgoing.set(transition.from, edges);
  }

  const targetId = targetIds[0];
  const visited = new Set([startIds[0]]);
  const transitions: WorkflowModel["transitions"] = [];
  const paths: WorkflowPath[] = [];
  const stack = [{ stateId: startIds[0], edges: outgoing.get(startIds[0]) ?? [], nextEdge: 0 }];
  while (stack.length > 0 && paths.length < 2) {
    const frame = stack[stack.length - 1];
    if (frame.nextEdge >= frame.edges.length) {
      stack.pop();
      if (stack.length > 0) {
        visited.delete(frame.stateId);
        transitions.pop();
      }
      continue;
    }
    const transition = frame.edges[frame.nextEdge++];
    if (!model.steps.some((step) => step.id === transition.from) ||
        !model.steps.some((step) => step.id === transition.to) || visited.has(transition.to)) continue;
    if (transition.to === targetId) {
      paths.push({ model, transitions: [...transitions, transition] });
      continue;
    }
    visited.add(transition.to);
    transitions.push(transition);
    stack.push({
      stateId: transition.to,
      edges: outgoing.get(transition.to) ?? [],
      nextEdge: 0
    });
  }
  if (selectedTransitionRefs.length > 0) {
    return paths.filter((path) => {
      const pathRefs = new Set(path.transitions.map((transition) => transitionSourceRef({
        source: "workflow",
        model,
        transition
      })));
      return pathRefs.size === selectedTransitionRefs.length && selectedTransitionRefs.every((reference) => pathRefs.has(reference));
    });
  }
  return paths;
}

function hasExplicitStatePath(intent: TestIntent, models: StateMachineModel[]) {
  return models.some((model) => {
    const starts = model.states.filter((state) =>
      intent.preconditions.some((condition) => mentionsState(condition, state.id, state.label))
    );
    const targets = model.states.filter((state) =>
      intent.expectedResults.some((result) => mentionsState(result, state.id, state.label))
    );
    return targets.length > 0 && (starts.length > 0 || model.states.filter((state) => state.initial).length === 1);
  });
}

function hasExplicitWorkflowPath(intent: TestIntent, models: WorkflowModel[]) {
  return models.some((model) => {
    const starts = model.steps.filter((step) =>
      intent.preconditions.some((condition) => mentionsState(condition, step.id, step.label))
    );
    const targets = model.steps.filter((step) =>
      intent.expectedResults.some((result) => mentionsState(result, step.id, step.label))
    );
    return targets.length > 0 && (starts.length > 0 || model.startStepIds.length === 1);
  });
}

function negatedProcessStateRefs(
  intent: TestIntent,
  stateModels: StateMachineModel[],
  workflowModels: WorkflowModel[]
) {
  const endpointText = [...intent.preconditions, ...intent.expectedResults];
  const refs: string[] = [];
  for (const model of stateModels) {
    for (const state of model.states) {
      if ([state.id, state.label].some((candidate) =>
        endpointText.some((value) => hasNegatedStateMention(value, candidate)))) {
        refs.push(`state-machine:${model.id}`, `state-machine:${model.id}#state:${state.id}`, ...state.sourceRefs);
      }
    }
  }
  for (const model of workflowModels) {
    for (const step of model.steps) {
      if ([step.id, step.label].some((candidate) =>
        endpointText.some((value) => hasNegatedStateMention(value, candidate)))) {
        refs.push(`workflow:${model.id}`, `workflow:${model.id}#step:${step.id}`, ...step.sourceRefs);
      }
    }
  }
  return unique(refs);
}

function hasNegatedStateMention(value: string, stateLabel: string) {
  const normalized = value.normalize("NFKC").toLocaleLowerCase();
  const candidate = stateLabel.normalize("NFKC").toLocaleLowerCase();
  if (!candidate) return false;
  const clauseSeparators = [".", "!", "?", ";", ":", "。", "！", "？", "；", "：", "，", ","];
  let occurrence = normalized.indexOf(candidate);
  while (occurrence >= 0) {
    const clauseStart = Math.max(-1, ...clauseSeparators.map((separator) => normalized.lastIndexOf(separator, occurrence - 1)));
    const prefix = normalized.slice(clauseStart + 1, occurrence).trimEnd();
    const englishNegation = /\b(?:not|never|without|cannot|can't|won't|shouldn't|mustn't|doesn't|don't|isn't|aren't|no)(?:\s+[\p{L}\p{N}'’-]+){0,3}\s*$/iu;
    const chineseNegation = /(?:并非|不允许|不应|不得|不能|不会|不是|不为|不在|不处于|尚未|未曾|没有|未|无|非)(?:为|是|处于|进入|达到|变成|成为|在)?\s*$/u;
    if ((englishNegation.test(prefix) && !/\bnot\s+(?:only|just)\s*$/iu.test(prefix)) ||
        (chineseNegation.test(prefix) && !/(?:不只是|不但|不仅)\s*$/u.test(prefix))) return true;
    occurrence = normalized.indexOf(candidate, occurrence + candidate.length);
  }
  return false;
}

function mentionsState(value: string, stateId: string, stateLabel: string) {
  const normalized = value.normalize("NFKC").toLocaleLowerCase();
  return [stateId, stateLabel].some((candidate) =>
    normalized.includes(candidate.normalize("NFKC").toLocaleLowerCase())
  );
}

function confirmedStateTransitions(intent: TestIntent, models: StateMachineModel[]): StateTransitionMatch[] {
  return confirmedModels(intent, models).flatMap((model) =>
    model.transitions.map((transition) => ({
      source: "state-machine" as const,
      model,
      transition
    }))
  );
}

function confirmedWorkflowTransitions(intent: TestIntent, models: WorkflowModel[]): WorkflowTransitionMatch[] {
  return confirmedModels(intent, models).flatMap((model) =>
    model.transitions.map((transition) => ({
      source: "workflow" as const,
      model,
      transition
    }))
  );
}

function confirmedModels<T extends StateMachineModel | WorkflowModel>(intent: TestIntent, models: T[]): T[] {
  const explicitModelRefs = new Set(intent.processModelRefs ?? []);
  return models.filter((model) =>
    model.status === "confirmed" &&
    model.knowledgeProjectId === intent.knowledgeProjectId &&
    model.requirementSetId === intent.requirementSetId &&
    (explicitModelRefs.size === 0 || explicitModelRefs.has(model.id))
  );
}

function missingStateEndpoint(match: StateTransitionMatch) {
  return !match.model.states.some((state) => state.id === match.transition.from) ||
    !match.model.states.some((state) => state.id === match.transition.to);
}

function missingWorkflowEndpoint(match: WorkflowTransitionMatch) {
  return !match.model.steps.some((step) => step.id === match.transition.from) ||
    !match.model.steps.some((step) => step.id === match.transition.to);
}

function matchingIntentTransitions(
  intent: TestIntent,
  candidates: SemanticTransitionMatch[]
): SemanticTransitionMatch[] {
  const references = new Set([...intent.requirementRefs, ...intent.knowledgeNodeRefs]);
  const explicitTransitionMatches = candidates.filter(({ transition }) => references.has(transition.id));
  const selected = explicitTransitionMatches.length > 0
    ? explicitTransitionMatches
    : candidates.filter(({ transition }) =>
      transition.sourceRefs.some((ref) => intent.requirementRefs.includes(ref))
      );
  return selected;
}

function compilationSourceFor(matches: SemanticTransitionMatch[]): SemanticCompilationResult["source"] {
  if (matches.every((match) => match.source === "state-machine")) return "state-machine";
  if (matches.every((match) => match.source === "workflow")) return "workflow";
  return "requirement-clause";
}

function modelSourceRef(match: SemanticTransitionMatch) {
  return `${match.source}:${match.model.id}`;
}

function transitionSourceRef(match: SemanticTransitionMatch) {
  return `${modelSourceRef(match)}#transition:${match.transition.id}`;
}

function transitionAction(trigger?: string): "click" | "select" {
  return trigger && /\b(select|choose)\b|\u9009\u62e9/i.test(trigger) ? "select" : "click";
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}
