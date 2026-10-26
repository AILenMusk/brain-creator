import type { ConformanceResult } from "../brain/types.js";
import type { ExecutionDiagnosisVerdict, AssuranceLevel, AssertionContract, BusinessOracle, StructuredReporterResult, ExecutionEvidence } from "../domain/types.js";

export type ConformanceEvaluationInput = {
  scenarioId: string;
  executionEvidenceId: string;
  status: "passed" | "failed" | "blocked";
  assuranceLevel?: AssuranceLevel;
  diagnosisVerdict?: ExecutionDiagnosisVerdict;
  expectationRefs: string[];
  observationRefs: string[];
  executionRefs: string[];
  contracts?: AssertionContract[];
  reporter?: StructuredReporterResult;
  artifactValidation?: ExecutionEvidence["artifactValidation"];
  provenance?: ExecutionEvidence["provenance"];
};

export function evaluateConformance(input: ConformanceEvaluationInput): ConformanceResult {
  const reasons: string[] = [];
  let verdict: ConformanceResult["verdict"];
  if (input.provenance !== "real-system") {
    verdict = "inconclusive";
    reasons.push(input.provenance === "synthetic"
      ? "Synthetic results do not establish real business conformance."
      : "Unverified result provenance does not establish real business conformance.");
  } else if (!isValidReferenceList(input.expectationRefs) || !isValidReferenceList(input.observationRefs) ||
      !isValidReferenceList(input.executionRefs)) {
    verdict = "inconclusive";
    reasons.push("Conformance reference lists must contain only non-empty strings.");
  } else if (!input.contracts?.length || input.contracts.some((contract) => !contract ||
      !Array.isArray(contract.requirementRefs) || contract.requirementRefs.length === 0 ||
      contract.requirementRefs.some((reference) => typeof reference !== "string" || !reference.trim()) ||
      !isValidBusinessOracle(contract.oracle) ||
      !contract.oracle.applicabilityRefs.length || contract.oracle.applicabilityRefs.some((reference) =>
        typeof reference !== "string" || !reference.trim() ||
        !contract.requirementRefs.includes(reference) || !input.expectationRefs.includes(reference)) ||
      contract.requirementRefs.some((reference) => !input.expectationRefs.includes(reference)))) {
    verdict = input.status === "passed" && input.assuranceLevel !== "limited" ? "requirement-review" : "inconclusive";
    reasons.push("A source-backed business oracle and applicability evidence bound to its contract are required.");
  } else if (new Set(input.contracts.map((contract) => contract.id)).size !== input.contracts.length) {
    verdict = "inconclusive";
    reasons.push("Assertion contract IDs must be unique within a conformance evaluation.");
  } else if (input.status === "blocked" || !isValidArtifactFileList(input.artifactValidation) ||
      !isValidStructuredReporter(input.reporter) ||
      !input.expectationRefs.length || !input.observationRefs.length ||
      !input.executionRefs.includes(input.executionEvidenceId)) {
    verdict = "inconclusive";
    reasons.push("Bound expectation, observation, execution references, validated artifacts, and a structured reporter are required.");
  } else {
    const results = input.contracts.map((contract) => {
      const oracle = contract.oracle!;
      const assertions = input.reporter!.assertions.filter((item) => item.id === contract.id && item.stepId === contract.stepId);
      const actual = assertions[0];
      if (!contract.stepId || assertions.length !== 1 || !actual || !["passed", "failed", "skipped"].includes(actual.status)) return "inconclusive";
      const files = new Set(input.artifactValidation!.files.map((file) => file.path));
      const applicability = evaluateApplicability(oracle, actual, files);
      if (applicability.status !== "applicable") {
        if (applicability.reason) reasons.push(`${contract.id}: ${applicability.reason}`);
        return applicability.status;
      }
      if (oracle.entityReference && actual.entityReference !== oracle.entityReference) {
        return actual.entityReference ? "context-mismatch" : "inconclusive";
      }
      if (actual.status === "skipped" || actual.actual === undefined || !actual.evidenceRefs.length ||
          actual.evidenceRefs.some((ref) => !files.has(ref) || !input.observationRefs.includes(ref))) return "inconclusive";
      if (contract.expected !== undefined && contract.expected !== oracle.expected) return "requirement-review";
      if (actual.expected !== undefined && actual.expected !== oracle.expected) return "context-mismatch";
      if ((oracle.operator === "transition" || oracle.operator === "changed") && (actual.previousActual === undefined || oracle.previous === undefined)) return "inconclusive";
      if (oracle.previous !== undefined && actual.previousActual !== oracle.previous) return "context-mismatch";
      if (oracle.operator === "visibility" && !["visible", "hidden"].includes(oracle.expected)) return "requirement-review";
      const matches = actual.actual === oracle.expected && (oracle.operator !== "changed" || actual.previousActual !== actual.actual);
      if (actual.status !== "passed" && matches) return "context-mismatch";
      reasons.push(`${contract.id}: ${oracle.operator}; expected=${oracle.expected}; actual=${actual.actual}; sources=${contract.requirementRefs.join(",")}`);
      return matches ? "conform" : "nonconform";
    });
    const reporterConsistent = input.reporter.status === "passed" &&
      input.reporter.total === input.contracts.length &&
      input.reporter.passed === input.contracts.length &&
      input.reporter.failed === 0 &&
      input.reporter.skipped === 0 &&
      input.reporter.assertions.length === input.contracts.length &&
      input.reporter.assertions.every((assertion) => assertion.status === "passed") &&
      input.contracts.every((contract) => contract.strength === "strong");
    verdict = results.includes("context-mismatch") ? "context-mismatch"
      : results.includes("requirement-review") ? "requirement-review"
      : results.includes("inconclusive") ? "inconclusive"
      : results.every((result) => result === "not-applicable") ? "not-applicable"
      : results.includes("not-applicable") ? "inconclusive"
      : results.includes("nonconform") ? "nonconform"
      : input.status === "passed" && input.assuranceLevel === "strong" && reporterConsistent ? "conform" : "inconclusive";
    if (verdict === "inconclusive" && !reporterConsistent) {
      reasons.push("Reporter status, assertion count, or contract strength does not support strong conformance.");
    }
    if (!reasons.length) reasons.push("The business oracle could not be evaluated against applicable, bound evidence.");
  }
  return {
    id: `conformance:${input.executionEvidenceId}`,
    scenarioId: input.scenarioId,
    executionEvidenceId: input.executionEvidenceId,
    verdict,
    expectationRefs: unique(input.expectationRefs),
    observationRefs: unique(input.observationRefs),
    executionRefs: unique(input.executionRefs),
    reasons,
    createdAt: new Date().toISOString()
  };
}

type ApplicabilityResult = {
  status: "applicable" | "not-applicable" | "inconclusive" | "requirement-review";
  reason?: string;
};

function evaluateApplicability(
  oracle: NonNullable<AssertionContract["oracle"]>,
  assertion: NonNullable<StructuredReporterResult["assertions"]>[number],
  validatedFiles: Set<string>
): ApplicabilityResult {
  const applicability = oracle.applicability;
  if (!applicability) {
    return { status: "requirement-review", reason: "Applicability must be explicitly unconditional or evaluated from a structured condition." };
  }
  if (applicability.mode === "unconditional") return { status: "applicable" };
  if (applicability.mode !== "conditional" || !["all", "any"].includes(applicability.combine)) {
    return { status: "requirement-review", reason: "The Oracle contains an unsupported applicability mode or condition combiner." };
  }
  const conditions = applicability.conditions;
  if (!Array.isArray(conditions) || !conditions.length || conditions.some((condition) => !condition ||
      typeof condition.id !== "string" || typeof condition.field !== "string" || typeof condition.expected !== "string" ||
      !["equals", "not-equals"].includes(condition.operator) ||
      !condition.id.trim() || !condition.field.trim() || !condition.expected.trim()) ||
      new Set(conditions.map((condition) => condition.id)).size !== conditions.length) {
    return { status: "requirement-review", reason: "Conditional applicability requires unique, source-backed condition IDs, fields, and expected values." };
  }
  const observations = assertion.applicabilityObservations ?? [];
  if (observations.length !== conditions.length || new Set(observations.map((observation) => observation.conditionId)).size !== observations.length) {
    return { status: "inconclusive", reason: "Structured applicability observations are missing, duplicated, or unexpected." };
  }
  const matches = conditions.map((condition) => {
    const observation = observations.find((item) => item.conditionId === condition.id);
    if (!observation || !observation.actual.trim() || !observation.evidenceRefs.length ||
        observation.evidenceRefs.some((reference) => !validatedFiles.has(reference))) return undefined;
    return condition.operator === "equals"
      ? observation.actual === condition.expected
      : observation.actual !== condition.expected;
  });
  if (matches.some((match) => match === undefined)) {
    return { status: "inconclusive", reason: "Applicability observations lack a bound value or validated artifact." };
  }
  const applicable = applicability.combine === "all"
    ? matches.every(Boolean)
    : matches.some(Boolean);
  return applicable
    ? { status: "applicable" }
    : { status: "not-applicable", reason: "The validated business context does not satisfy the Oracle applicability conditions." };
}

function isValidBusinessOracle(oracle: BusinessOracle | undefined): oracle is BusinessOracle {
  if (!oracle || !["equals", "visibility", "transition", "changed"].includes(oracle.operator) ||
      typeof oracle.expected !== "string" || !oracle.expected.trim() ||
      !Array.isArray(oracle.applicabilityRefs) || oracle.applicabilityRefs.length === 0) return false;
  if ((oracle.operator === "transition" || oracle.operator === "changed") &&
      (typeof oracle.previous !== "string" || !oracle.previous.trim())) return false;
  if (oracle.operator === "visibility" && !["visible", "hidden"].includes(oracle.expected)) return false;
  return true;
}

function isValidReferenceList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((reference) => typeof reference === "string" && Boolean(reference.trim()));
}

function isValidArtifactFileList(value: ExecutionEvidence["artifactValidation"]): value is NonNullable<ExecutionEvidence["artifactValidation"]> {
  return value?.status === "valid" && Array.isArray(value.files) && value.files.every((file) =>
    Boolean(file) && typeof file.path === "string" && Boolean(file.path.trim()) &&
    typeof file.sha256 === "string" && /^[a-f0-9]{64}$/i.test(file.sha256));
}

function isValidStructuredReporter(value: StructuredReporterResult | undefined): value is StructuredReporterResult {
  if (!value || !Array.isArray(value.assertions)) return false;
  return value.assertions.every((assertion) =>
    Boolean(assertion) && typeof assertion.id === "string" && Boolean(assertion.id.trim()) &&
    ["passed", "failed", "skipped", "unknown"].includes(assertion.status) &&
    (assertion.stepId === undefined || typeof assertion.stepId === "string") &&
    (assertion.actual === undefined || typeof assertion.actual === "string") &&
    (assertion.previousActual === undefined || typeof assertion.previousActual === "string") &&
    (assertion.expected === undefined || typeof assertion.expected === "string") &&
    (assertion.entityReference === undefined || typeof assertion.entityReference === "string") &&
    isValidReferenceList(assertion.evidenceRefs) &&
    (assertion.applicabilityObservations === undefined || Array.isArray(assertion.applicabilityObservations) &&
      assertion.applicabilityObservations.every((observation) => Boolean(observation) &&
        typeof observation.conditionId === "string" && typeof observation.actual === "string" &&
        isValidReferenceList(observation.evidenceRefs))));
}

function unique(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}
