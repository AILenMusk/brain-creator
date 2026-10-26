import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { BusinessScenario, ConformanceResult, EvaluationTrial } from "../brain/types.js";
import type {
  ExecutableCase,
  ExecutionEvidence,
  ExecutionPlan,
  RequirementSuiteCaseRun,
  RequirementSuiteRun
} from "../domain/types.js";
import { validateExecutionArtifacts } from "../execution/artifactValidation.js";
import {
  createExecutionEvidenceSnapshotHash,
  hasValidExecutionEvidenceSnapshot
} from "../execution/evidenceSnapshot.js";
import { determineAssuranceLevel } from "../execution/assurance.js";
import { evaluateConformance } from "../execution/conformance.js";
import type { IntegrityAuthenticator } from "../shared/crypto.js";
import { id } from "../shared/id.js";

export type HistoricalEvidenceSourceRecords = {
  trial: EvaluationTrial;
  trialValidationReasons: string[];
  run: RequirementSuiteRun;
  caseRun: RequirementSuiteCaseRun;
  plan: ExecutionPlan;
  planValidationReasons: string[];
  executableCase: ExecutableCase;
  scenario: BusinessScenario;
  evidence: ExecutionEvidence;
  previousConformance?: ConformanceResult;
};

export function historicalEvidenceSourceFingerprint(input: HistoricalEvidenceSourceRecords) {
  return hash(input);
}

export async function reevaluateHistoricalEvidence(input: {
  root: string;
  trial: EvaluationTrial;
  trialValidationReasons: string[];
  run: RequirementSuiteRun;
  caseRun: RequirementSuiteCaseRun;
  plan: ExecutionPlan;
  planValidationReasons: string[];
  executableCase: ExecutableCase;
  scenario: BusinessScenario;
  evidence: ExecutionEvidence;
  previousConformance?: ConformanceResult;
  reviewer: string;
  note: string;
  authenticator: IntegrityAuthenticator;
  reviewedAt?: string;
}) {
  const sourceFingerprint = historicalEvidenceSourceFingerprint(input);
  const reviewer = required(input.reviewer, "Historical evidence reviewer");
  const note = required(input.note, "Historical evidence review note");
  const trial = input.trial;
  const evidence = structuredClone(input.evidence);
  const scenario = input.scenario;
  const plan = input.plan;
  const run = input.run;
  const caseRun = input.caseRun;
  const executableCase = input.executableCase;
  if (trial.status !== "completed" || input.trialValidationReasons.length > 0) {
    throw new Error(`Historical evidence requires a valid completed Trial: ${input.trialValidationReasons.join("; ") || trial.status}`);
  }
  if (input.planValidationReasons.length > 0) {
    throw new Error(`Historical evidence requires a current immutable execution plan: ${input.planValidationReasons.join("; ")}`);
  }
  if (!trial.executionScope?.businessScenarioIds.includes(scenario.id) || !trial.systemId || !trial.requirementSetId) {
    throw new Error("Historical evidence is outside the frozen Trial scenario, system, or requirement scope");
  }
  if (scenario.status !== "approved" || scenario.knowledgeProjectId !== trial.knowledgeProjectId || scenario.requirementSetId !== trial.requirementSetId) {
    throw new Error("Historical evidence scenario does not match the approved Trial baseline");
  }
  if (run.status !== "completed" || run.evaluationTrialId !== trial.id || run.knowledgeProjectId !== trial.knowledgeProjectId ||
      run.systemId !== trial.systemId || run.requirementSetIds?.length !== 1 || run.requirementSetIds[0] !== trial.requirementSetId ||
      !run.completedAt || run.evaluationSourceRevision !== trial.sourceRevision || run.evaluationSourceHash !== trial.sourceHash ||
      run.evaluationRuntimeBuildIdentity !== trial.runtimeBuildIdentity) {
    throw new Error("Historical evidence suite run is not bound to the frozen Trial");
  }
  const matchingRunCases = run.caseRuns.filter((candidate) =>
    candidate.executionEvidenceId === evidence.id || candidate.attempts.some((attempt) => attempt.executionEvidenceId === evidence.id)
  );
  const matchingAttempts = caseRun.attempts.filter((attempt) => attempt.executionEvidenceId === evidence.id);
  if (matchingRunCases.length !== 1 || stableStringify(matchingRunCases[0]) !== stableStringify(caseRun) ||
      matchingAttempts.length > 1 || caseRun.executionEvidenceId === evidence.id && matchingAttempts.length > 0 ||
      !["passed", "failed"].includes(caseRun.status)) {
    throw new Error("Historical evidence case run is not uniquely bound to the completed suite run");
  }
  const linkedAttempt = matchingAttempts[0];
  const executionPlanReferences = unique([
    evidence.executionPlanId,
    linkedAttempt?.executionPlanId,
    caseRun.executionPlanId
  ].filter((reference): reference is string => Boolean(reference)));
  if (caseRun.executableCaseId !== executableCase.id ||
      caseRun.executionEvidenceId !== evidence.id && !linkedAttempt ||
      evidence.knowledgeProjectId !== trial.knowledgeProjectId || evidence.systemId !== trial.systemId ||
      evidence.executableCaseId !== executableCase.id || evidence.createdAt < trial.createdAt || evidence.createdAt < run.createdAt ||
      run.completedAt && evidence.createdAt > run.completedAt ||
      evidence.requirementSuiteRunId && evidence.requirementSuiteRunId !== run.id) {
    throw new Error("Historical execution evidence does not have a unique matching run and case binding");
  }
  if (executableCase.knowledgeProjectId !== trial.knowledgeProjectId || executableCase.systemId !== trial.systemId ||
      executableCase.requirementSetId !== trial.requirementSetId || !(scenario.testIntentIds ?? []).includes(executableCase.testIntentId)) {
    throw new Error("Historical execution case is outside the approved Trial scenario scope");
  }
  if (executionPlanReferences.length === 0 || executionPlanReferences.some((reference) => reference !== plan.id) ||
      plan.knowledgeProjectId !== trial.knowledgeProjectId || plan.systemId !== trial.systemId ||
      plan.requirementSetId !== trial.requirementSetId || plan.executableCaseId !== executableCase.id ||
      !/^[a-f0-9]{64}$/i.test(plan.snapshotHash) || plan.integrity?.assertionContractHash !== hash(plan.assertionContracts ?? [])) {
    throw new Error("Historical evidence is not bound to a complete immutable execution plan");
  }
  if (evidence.historicalReevaluation) {
    throw new Error("Historical evidence that has already been re-evaluated cannot be reviewed again");
  }
  if (evidence.semanticSnapshotHash && hasValidExecutionEvidenceSnapshot(
    evidence,
    input.previousConformance,
    input.authenticator
  )) {
    throw new Error("Historical evidence with a valid semantic snapshot does not require re-evaluation");
  }
  if (input.previousConformance &&
      (input.previousConformance.executionEvidenceId !== evidence.id ||
       input.previousConformance.scenarioId !== scenario.id)) {
    throw new Error("Previous Conformance result does not match the historical evidence and scenario");
  }
  if (evidence.provenance !== "real-system" || evidence.status === "running" || evidence.status === "blocked") {
    throw new Error("Only completed real-system evidence can be re-evaluated");
  }
  if (!evidence.reporterPath || !evidence.reporterResult || !evidence.completedAt) {
    throw new Error("Historical evidence must contain a persisted structured Reporter artifact and completion time");
  }
  const contracts = plan.assertionContracts ?? [];
  if (!contracts.length || stableStringify(evidence.assertionContracts ?? []) !== stableStringify(contracts)) {
    throw new Error("Historical assertion contracts do not match the immutable execution plan");
  }
  if (!assertionContractsMatchPlan(contracts, plan.steps)) {
    throw new Error("Historical assertion contracts do not bind every planned assertion step exactly once");
  }
  if (!executionStepsMatchPlan(plan.steps, evidence.steps)) {
    throw new Error("Historical execution steps do not match the immutable execution plan");
  }
  if (!reporterStepsMatchPlan(plan.steps, evidence.reporterResult.steps)) {
    throw new Error("Historical Reporter steps do not match the immutable execution plan");
  }

  const references = [...new Set([
    evidence.reporterPath,
    ...(evidence.contextPackPath ? [evidence.contextPackPath] : []),
    ...evidence.artifactPaths,
    ...evidence.tracePaths,
    ...evidence.reporterResult.attachments,
    ...evidence.reporterResult.assertions.flatMap((assertion) => assertion.evidenceRefs),
    ...(evidence.reporterResult.steps ?? []).flatMap((step) => [...step.evidenceRefs, ...(step.traceRefs ?? [])]),
    ...evidence.steps.flatMap((step) => [
      ...(step.screenshotPath ? [step.screenshotPath] : []),
      ...(step.evidenceRefs ?? []),
      ...(step.traceRefs ?? [])
    ])
  ])];
  const artifactValidation = await validateExecutionArtifacts(input.root, references);
  if (artifactValidation.status !== "valid" || artifactValidation.files.length !== references.length) {
    throw new Error(`Historical execution artifacts are incomplete or invalid: ${artifactValidation.reasons.join("; ")}`);
  }
  const reporterArtifact = await readFile(resolve(input.root, evidence.reporterPath), "utf8");
  let parsedReporter: unknown;
  try {
    parsedReporter = JSON.parse(reporterArtifact);
  } catch {
    throw new Error("Historical structured Reporter artifact is not valid JSON");
  }
  if (stableStringify(parsedReporter) !== stableStringify(evidence.reporterResult)) {
    throw new Error("Historical Reporter artifact does not match the stored structured Reporter result");
  }

  evidence.requirementSuiteRunId = run.id;
  evidence.artifactValidation = artifactValidation;
  evidence.assuranceLevel = determineAssuranceLevel(contracts, evidence.reporterResult);
  const expectationRefs = unique(contracts.flatMap((contract) => contract.requirementRefs));
  const conformance = evaluateConformance({
    scenarioId: scenario.id,
    executionEvidenceId: evidence.id,
    status: evidence.status,
    assuranceLevel: evidence.assuranceLevel,
    expectationRefs,
    observationRefs: artifactValidation.files.map((file) => file.path),
    executionRefs: [evidence.id, run.id, plan.id],
    contracts,
    reporter: evidence.reporterResult,
    artifactValidation,
    provenance: evidence.provenance
  });
  const reviewId = id("historicalEvidenceReview");
  const conformanceResultId = id("conformanceReview");
  const reviewedAt = input.reviewedAt ?? new Date().toISOString();
  evidence.historicalReevaluation = {
    id: reviewId,
    trialId: trial.id,
    requirementSuiteRunId: run.id,
    conformanceResultId,
    ...(input.previousConformance ? { previousConformanceResultId: input.previousConformance.id } : {}),
    reviewer,
    note,
    artifactHashes: structuredClone(artifactValidation.files),
    reviewedAt
  };
  const historicalConformance: ConformanceResult = {
    ...conformance,
    id: conformanceResultId,
    historicalReviewId: reviewId,
    createdAt: reviewedAt
  };
  evidence.semanticSnapshotHash = createExecutionEvidenceSnapshotHash(
    evidence,
    historicalConformance,
    input.authenticator
  );
  if (sourceFingerprint !== historicalEvidenceSourceFingerprint(input)) {
    throw new Error("Historical evidence inputs changed while re-evaluation was running");
  }
  return { evidence, conformance: historicalConformance };
}

function required(value: string, label: string) {
  const result = value.trim();
  if (!result) throw new Error(`${label} is required`);
  return result;
}

function unique(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

function hash(value: unknown) {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

function executionStepsMatchPlan(plan: ExecutionPlan["steps"], evidence: ExecutionEvidence["steps"]) {
  return plan.length === evidence.length && plan.every((step, index) => {
    const recorded = evidence[index];
    return recorded?.stepId === step.id &&
      recorded.order === step.order &&
      recorded.action === step.action &&
      recorded.instruction === step.instruction &&
      recorded.targetSemantic === step.targetSemantic &&
      recorded.value === step.value &&
      recorded.pageModelId === step.pageModelId &&
      recorded.locatorPointId === step.locatorPointId &&
      recorded.dataProfileId === step.dataProfileId &&
      recorded.dataReference === step.dataReference &&
      recorded.expected === step.expected &&
      stableStringify(recorded.sourceRefs) === stableStringify(step.sourceRefs) &&
      recorded.origin === step.origin;
  });
}

function assertionContractsMatchPlan(
  contracts: NonNullable<ExecutionEvidence["assertionContracts"]>,
  steps: ExecutionPlan["steps"]
) {
  const assertionStepIds = steps.filter((step) => step.action === "assert").map((step) => step.id);
  const contractStepIds = contracts.map((contract) => contract.stepId);
  return assertionStepIds.length === contracts.length &&
    new Set(assertionStepIds).size === assertionStepIds.length &&
    contractStepIds.every((stepId) => Boolean(stepId) && assertionStepIds.includes(stepId!)) &&
    new Set(contractStepIds).size === contractStepIds.length;
}

function reporterStepsMatchPlan(
  steps: ExecutionPlan["steps"],
  reporterSteps: NonNullable<ExecutionEvidence["reporterResult"]>["steps"]
) {
  const plannedIds = steps.map((step) => step.id);
  const reportedIds = reporterSteps?.map((step) => step.id) ?? [];
  return plannedIds.length === reportedIds.length &&
    new Set(plannedIds).size === plannedIds.length &&
    new Set(reportedIds).size === reportedIds.length &&
    plannedIds.every((stepId) => reportedIds.includes(stepId));
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
      .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}
