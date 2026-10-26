import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { validateExecutionArtifacts } from "./artifactValidation.js";

export type PostconditionVerification = {
  status: "confirmed" | "not-confirmed" | "unavailable";
  actualResult?: string;
  evidenceRefs?: string[];
  evidenceArtifacts?: Array<{ path: string; sha256: string }>;
  reason?: string;
  checkedAt?: string;
};

export type PostconditionVerificationInput = {
  systemId: string;
  evaluationTrialId?: string;
  businessScenarioId?: string;
  requirementSuiteRunId?: string;
  caseSuiteId?: string;
  executableCaseId?: string;
  caseNo?: string;
  stepId?: string;
  actionKey: string;
  actionSemantic: string;
  entityReference?: string;
  postcondition: string;
};

export type PostconditionRunBinding = Pick<PostconditionVerificationInput,
  "evaluationTrialId" | "businessScenarioId" | "requirementSuiteRunId" | "caseSuiteId" |
  "executableCaseId" | "caseNo" | "stepId">;

function matchesRunBinding(record: Record<string, unknown>, binding: PostconditionRunBinding) {
  const runType = binding.requirementSuiteRunId ? "requirement-suite" : "document-suite";
  const runId = binding.requirementSuiteRunId ?? binding.caseSuiteId;
  const expected: Record<string, unknown> = {
    runType,
    runId,
    evaluationTrialId: binding.evaluationTrialId,
    businessScenarioId: binding.businessScenarioId,
    executableCaseId: binding.executableCaseId,
    caseNo: binding.caseNo,
    stepId: binding.stepId
  };
  return Object.entries(expected).every(([key, value]) => record[key] === value);
}

function assertPostconditionRunBinding(binding: PostconditionRunBinding) {
  const hasRequirementRun = Boolean(binding.requirementSuiteRunId?.trim());
  const hasDocumentSuite = Boolean(binding.caseSuiteId?.trim());
  if (hasRequirementRun === hasDocumentSuite) {
    throw new Error("Postcondition evidence requires exactly one suite run identity");
  }
}

export type ExecutionPostconditionVerifier = (
  input: PostconditionVerificationInput
) => Promise<PostconditionVerification>;

export async function validateManualPostconditionEvidenceArtifacts(input: {
  root: string;
  artifacts: Array<{ path: string; sha256: string }>;
  binding: PostconditionRunBinding;
  systemId: string;
  actionKey: string;
  actionSemantic: string;
  entityReference?: string;
  postcondition: string;
  operator: string;
}) {
  assertPostconditionRunBinding(input.binding);
  const validation = await validateExecutionArtifacts(
    input.root,
    input.artifacts.map((artifact) => artifact.path),
    Object.fromEntries(input.artifacts.map((artifact) => [artifact.path, artifact.sha256]))
  );
  if (validation.status !== "valid" || validation.files.length !== input.artifacts.length) {
    throw new Error(`Manual action evidence is unreadable or invalid: ${validation.reasons.join("; ")}`);
  }
  const evidenceRoot = await realpath(input.root);
  let boundObservationCount = 0;
  for (const artifact of input.artifacts) {
    const lowerPath = artifact.path.toLowerCase();
    if (/\.(png|jpe?g|webp)$/.test(lowerPath) || /trace[^/\\]*\.zip$/.test(lowerPath)) continue;
    if (!lowerPath.endsWith(".json")) {
      throw new Error("Manual action evidence must be a decodable image, readable trace, or bound observation JSON");
    }
    const artifactPath = await realpath(resolve(evidenceRoot, artifact.path));
    const relativePath = relative(evidenceRoot, artifactPath);
    if (!relativePath || relativePath === ".." || relativePath.startsWith("..\\") || relativePath.startsWith("../") || isAbsolute(relativePath)) {
      throw new Error("Manual action evidence artifact path escaped the runtime artifact root");
    }
    const contents = await readFile(artifactPath);
    const sha256 = createHash("sha256").update(contents).digest("hex");
    const validatedFile = validation.files.find((file) => file.path === artifact.path);
    if (!validatedFile || sha256 !== validatedFile.sha256) {
      throw new Error("Manual action evidence changed during validation");
    }
    let observation: unknown;
    try {
      observation = JSON.parse(contents.toString("utf8"));
    } catch {
      throw new Error("Manual action observation must be structured JSON");
    }
    if (!observation || typeof observation !== "object" || Array.isArray(observation)) {
      throw new Error("Manual action observation must be a structured JSON object");
    }
    const record = observation as Record<string, unknown>;
    if (record.schemaVersion !== 2 || record.type !== "manual-execution-postcondition-observation" ||
        !matchesRunBinding(record, input.binding) ||
        record.systemId !== input.systemId || record.actionKey !== input.actionKey ||
        record.actionSemantic !== input.actionSemantic || record.entityReference !== input.entityReference ||
        record.postcondition !== input.postcondition || record.result !== "confirmed" ||
        typeof record.actualResult !== "string" || !record.actualResult.trim() ||
        typeof record.checkedAt !== "string" || !Number.isFinite(Date.parse(record.checkedAt)) ||
        record.operator !== input.operator) {
      throw new Error("Manual action observation does not match the original target, action, postcondition, or operator");
    }
    boundObservationCount += 1;
  }
  if (boundObservationCount === 0) {
    throw new Error("Manual action evidence requires a run-bound observation JSON in addition to any image or trace artifacts");
  }
  return validation.files;
}

export async function validatePostconditionVerificationArtifacts(input: {
  root: string;
  verification: PostconditionVerification;
  binding: PostconditionRunBinding;
  systemId: string;
  actionKey: string;
  actionSemantic: string;
  entityReference?: string;
  postcondition: string;
}) {
  assertPostconditionRunBinding(input.binding);
  const artifacts = input.verification.evidenceArtifacts ?? [];
  if (!input.verification.actualResult?.trim() || !input.verification.checkedAt ||
      !Number.isFinite(Date.parse(input.verification.checkedAt)) || !(input.verification.evidenceRefs?.length) || artifacts.length === 0 ||
      artifacts.some((artifact) => !artifact.path?.trim() || !/^[a-f0-9]{64}$/i.test(artifact.sha256))) {
    throw new Error("Confirmed postcondition verification requires actual result, timestamp, and hash-bound artifacts");
  }
  const validation = await validateExecutionArtifacts(
    input.root,
    artifacts.map((artifact) => artifact.path),
    Object.fromEntries(artifacts.map((artifact) => [artifact.path, artifact.sha256]))
  );
  if (validation.status !== "valid" || validation.files.length !== artifacts.length) {
    throw new Error(`Postcondition verification artifacts are unreadable or invalid: ${validation.reasons.join("; ")}`);
  }
  const evidenceRoot = await realpath(input.root);
  for (const artifact of artifacts) {
    const artifactPath = await realpath(resolve(evidenceRoot, artifact.path));
    const relativePath = relative(evidenceRoot, artifactPath);
    if (!relativePath || relativePath === ".." || relativePath.startsWith("..\\") || relativePath.startsWith("../") || isAbsolute(relativePath)) {
      throw new Error("Postcondition verification artifact path escaped the runtime artifact root");
    }
    const contents = await readFile(artifactPath);
    const sha256 = createHash("sha256").update(contents).digest("hex");
    const validatedFile = validation.files.find((file) => file.path === artifact.path);
    if (!validatedFile || sha256 !== validatedFile.sha256) {
      throw new Error("Postcondition verification artifact changed during validation");
    }
    let observation: unknown;
    try {
      observation = JSON.parse(contents.toString("utf8"));
    } catch {
      throw new Error("Postcondition verification artifact must be structured JSON");
    }
    if (!observation || typeof observation !== "object" || Array.isArray(observation)) {
      throw new Error("Postcondition verification artifact must be a structured JSON object");
    }
    const record = observation as Record<string, unknown>;
    if (record.schemaVersion !== 2 || record.type !== "execution-postcondition-observation" ||
        !matchesRunBinding(record, input.binding) ||
        record.systemId !== input.systemId || record.actionKey !== input.actionKey ||
        record.actionSemantic !== input.actionSemantic || record.entityReference !== input.entityReference ||
        record.postcondition !== input.postcondition || record.result !== "confirmed" ||
        record.actualResult !== input.verification.actualResult || record.checkedAt !== input.verification.checkedAt) {
      throw new Error("Postcondition verification artifact does not match the action, target, or actual result");
    }
  }
  return validation.files;
}
