import { createHash } from "node:crypto";
import type { ConformanceResult } from "../brain/types.js";
import type { ExecutionEvidence } from "../domain/types.js";
import type { IntegrityAuthenticator } from "../shared/crypto.js";

export function createExecutionEvidenceSnapshotHash(
  evidence: ExecutionEvidence,
  conformance?: ConformanceResult,
  authenticator?: IntegrityAuthenticator
) {
  const payload = canonicalEvidenceSnapshot(evidence, conformance);
  return authenticator
    ? authenticator.sign(payload)
    : createHash("sha256").update(payload).digest("hex");
}

export function hasValidExecutionEvidenceSnapshot(
  evidence: ExecutionEvidence,
  conformance?: ConformanceResult,
  authenticator?: IntegrityAuthenticator
) {
  if (!evidence.semanticSnapshotHash) return false;
  if (authenticator) {
    return authenticator.verify(canonicalEvidenceSnapshot(evidence, conformance), evidence.semanticSnapshotHash);
  }
  return evidence.semanticSnapshotHash === createExecutionEvidenceSnapshotHash(evidence, conformance);
}

function canonicalEvidenceSnapshot(evidence: ExecutionEvidence, conformance?: ConformanceResult) {
  return canonicalJson({
    evidence: {
      id: evidence.id,
      knowledgeProjectId: evidence.knowledgeProjectId,
      systemId: evidence.systemId,
      executableCaseId: evidence.executableCaseId,
      requirementSuiteRunId: evidence.requirementSuiteRunId,
      executionPlanId: evidence.executionPlanId,
      testCaseId: evidence.testCaseId,
      chainRunId: evidence.chainRunId,
      contextPackPath: evidence.contextPackPath,
      provenance: evidence.provenance,
      status: evidence.status,
      assuranceLevel: evidence.assuranceLevel,
      scenarioTrust: evidence.scenarioTrust,
      assertionContracts: evidence.assertionContracts,
      reporterPath: evidence.reporterPath,
      reporterResult: evidence.reporterResult,
      evidenceWarnings: evidence.evidenceWarnings,
      artifactValidation: evidence.artifactValidation,
      coverage: evidence.coverage,
      actorJourney: evidence.actorJourney,
      steps: evidence.steps,
      tracePaths: evidence.tracePaths,
      artifactPaths: evidence.artifactPaths,
      consoleErrors: evidence.consoleErrors,
      networkFailures: evidence.networkFailures,
      actualResult: evidence.actualResult,
      historicalReevaluation: evidence.historicalReevaluation,
      createdAt: evidence.createdAt,
      completedAt: evidence.completedAt
    },
    conformance: conformance ?? null
  });
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}
