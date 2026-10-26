import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import type { BusinessScenario, ConformanceResult, EvaluationTrial } from "../brain/types.js";
import type { ExecutionEvidence } from "../domain/types.js";
import type { ExecutableCase, RequirementSuiteRun, RunLedgerEntry } from "../domain/types.js";
import { createWorkspaceIntegrityAuthenticator } from "../shared/crypto.js";
import { calculateEvaluationTrialMetrics } from "./evaluationMetrics.js";
import { revalidateExecutionEvidence, revalidateRunLedgerActionEvidence } from "./evidenceRevalidation.js";
import { createExecutionEvidenceSnapshotHash, hasValidExecutionEvidenceSnapshot } from "../execution/evidenceSnapshot.js";

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))); });

async function workspace() {
  const directory = await mkdtemp(join(tmpdir(), "bc-evidence-revalidation-"));
  directories.push(directory);
  return directory;
}

function evidence(content: string): ExecutionEvidence {
  return {
    id: "evidence-1", knowledgeProjectId: "project-1", systemId: "system-1", executableCaseId: "case-1", requirementSuiteRunId: "run-1",
    testCaseId: "test-1", contextPackPath: "", status: "passed", provenance: "real-system", assuranceLevel: "strong",
    assertionContracts: [{ id: "assert-1", stepId: "step-1", type: "state", strength: "strong", expected: "approved",
      requirementRefs: ["req:1"], evidenceRequirements: ["actual-value"],
      oracle: { operator: "equals", expected: "approved", applicability: { mode: "unconditional" }, applicabilityRefs: ["req:1"] } }],
    reporterResult: {
      status: "passed", total: 1, passed: 1, failed: 0, skipped: 0, durationMs: 1,
      assertions: [{ id: "assert-1", stepId: "step-1", status: "passed", expected: "approved", actual: "approved", evidenceRefs: ["actual.json"] }],
      attachments: ["actual.json"], consoleErrors: [], networkFailures: []
    },
    artifactValidation: {
      status: "valid", files: [{ path: "actual.json", sha256: createHash("sha256").update(content).digest("hex") }], reasons: []
    },
    steps: [], tracePaths: [], artifactPaths: ["actual.json"], consoleErrors: [], networkFailures: [],
    createdAt: "2026-10-01T00:00:00.000Z", completedAt: "2026-10-01T00:00:01.000Z"
  };
}

it("revalidates stored evidence files against their hashes", async () => {
  const root = await workspace();
  await writeFile(join(root, "actual.json"), "{\"status\":\"approved\"}", "utf8");
  const item = evidence("{\"status\":\"approved\"}");

  const valid = await revalidateExecutionEvidence(root, [item]);
  expect(valid[0].validation.status).toBe("valid");

  await writeFile(join(root, "actual.json"), "{\"status\":\"rejected\"}", "utf8");
  const changed = await revalidateExecutionEvidence(root, [item]);
  expect(changed[0].validation.status).toBe("invalid");
  expect(changed[0].validation.reasons).toContain("Invalid artifact actual.json: artifact hash changed");
});

it("rejects newly referenced artifacts without a stored validation hash", async () => {
  const root = await workspace();
  await writeFile(join(root, "actual.json"), "{\"status\":\"approved\"}", "utf8");
  await writeFile(join(root, "replacement.json"), "{\"status\":\"approved\"}", "utf8");
  const item = evidence("{\"status\":\"approved\"}");
  item.reporterResult!.assertions[0].evidenceRefs = ["replacement.json"];

  const result = await revalidateExecutionEvidence(root, [item]);
  expect(result[0].validation.status).toBe("invalid");
  expect(result[0].validation.reasons).toContain("Artifact replacement.json has no stored validation hash.");
});

it("revalidates reconciled-action evidence files and hashes during Trial review", async () => {
  const root = await workspace();
  const original = "{\"result\":\"confirmed\"}";
  await writeFile(join(root, "action.json"), original, "utf8");
  const entry = {
    id: "action-1", event: "action-reconciled", actionPhase: "reconciled", systemId: "system-1",
    actionKey: "submit", actionEvidenceRefs: ["state:submitted"],
    actionEvidenceArtifacts: [{ path: "action.json", sha256: createHash("sha256").update(original).digest("hex") }]
  } as RunLedgerEntry;
  const valid = await revalidateRunLedgerActionEvidence(root, [entry]);
  expect(valid[0].validation.status).toBe("valid");

  await writeFile(join(root, "action.json"), "{\"result\":\"rejected\"}", "utf8");
  const changed = await revalidateRunLedgerActionEvidence(root, [entry]);
  expect(changed[0].validation.status).toBe("invalid");
  expect(changed[0].validation.reasons).toContain("Invalid artifact action.json: artifact hash changed");

  const missing = await revalidateRunLedgerActionEvidence(root, [{ ...entry, actionEvidenceArtifacts: [] } as RunLedgerEntry]);
  expect(missing[0].validation.status).toBe("invalid");
});

it("excludes evidence with failed review-time artifact or semantic snapshot revalidation from trial metrics", async () => {
  const item = evidence("{\"status\":\"approved\"}");
  const trial: EvaluationTrial = {
    id: "trial-1", comparisonGroupId: "group-1", knowledgeProjectId: "project-1", systemId: "system-1",
    requirementSourceId: "source-1", sourceSnapshotId: "snapshot-1", sourceRevision: 1, sourceHash: "source-hash",
    requirementSetId: "set-1", provider: "builtin", workspacePath: ".", storePath: "./store", codeRevision: "commit-1",
    runtimeVersions: {}, runtimeBuildIdentity: "build-1",
    executionScope: { businessScenarioIds: ["scenario-1"], baselineHash: "baseline", scopeHash: "scope" },
    latestProjectionManifestId: "manifest-1", status: "active", invalidationReasons: [],
    createdAt: "2026-09-30T00:00:00.000Z", updatedAt: "2026-09-30T00:00:00.000Z"
  };
  const run: RequirementSuiteRun = {
    id: "run-1", knowledgeProjectId: "project-1", systemId: "system-1", status: "completed",
    continueOnBlocked: true, allowCreateTestData: false, evaluationTrialId: trial.id,
    evaluationSourceRevision: trial.sourceRevision, evaluationSourceHash: trial.sourceHash,
    evaluationRuntimeBuildIdentity: trial.runtimeBuildIdentity, requirementSetIds: ["set-1"],
    total: 1, passed: 1, failed: 0, blocked: 0, skipped: 0, cancelled: 0,
    caseRuns: [{ executableCaseId: "case-1", title: "Approve", order: 1, status: "passed", executionEvidenceId: item.id,
      gapIds: [], attempts: [], completedAt: "2026-10-01T00:00:02.000Z" }],
    createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-01T00:00:03.000Z", completedAt: "2026-10-01T00:00:03.000Z"
  };
  const scenario: BusinessScenario = {
    id: "scenario-1", knowledgeProjectId: "project-1", requirementSetId: "set-1", title: "Approve", objective: "Approve",
    family: "main-flow", actors: [], preconditions: [], workflowRefs: [], stateTransitionRefs: [], decisionRuleRefs: [],
    testDataNeeds: [], expectedBusinessOutcomes: ["approved"], sourceRefs: ["req:1"], testIntentIds: ["intent-1"], risk: "low", status: "approved"
  };
  const executableCase: ExecutableCase = {
    id: "case-1", knowledgeProjectId: "project-1", requirementSetId: "set-1", testIntentId: "intent-1",
    systemId: "system-1", title: "Approve", status: "ready", preconditions: [], steps: [], dataProfileIds: [],
    gapIds: [], createdAt: trial.createdAt, updatedAt: trial.updatedAt
  };
  const conformance: ConformanceResult = {
    id: "conformance-1", scenarioId: scenario.id, executionEvidenceId: item.id, verdict: "conform",
    expectationRefs: ["req:1"], observationRefs: ["actual.json"], executionRefs: [item.id], reasons: [],
    createdAt: "2026-10-01T00:00:02.000Z"
  };
  const authenticator = createWorkspaceIntegrityAuthenticator(await workspace());
  item.scenarioTrust = {
    scenarioId: scenario.id,
    decision: "held",
    status: "verified",
    strongRunCount: 1,
    reasons: ["Review before promotion"]
  };
  item.evidenceWarnings = ["Trace artifact is absent"];
  item.semanticSnapshotHash = createExecutionEvidenceSnapshotHash(item, conformance, authenticator);
  const metricsInput = {
    trial, runs: [run], evidence: [item], conformanceResults: [conformance], scenarios: [scenario],
    executableCases: [executableCase], interventions: []
  };
  expect(hasValidExecutionEvidenceSnapshot(item, conformance, authenticator)).toBe(true);
  expect(calculateEvaluationTrialMetrics({
    ...metricsInput,
    artifactValidationByEvidenceId: new Map([[item.id, item.artifactValidation!]]),
    semanticSnapshotValidByEvidenceId: new Map([[item.id, true]])
  }).businessConformance).toMatchObject({ status: "measured", measured: 1, passed: 1, rate: 1 });

  item.scenarioTrust = { ...item.scenarioTrust, status: "trusted" };
  expect(hasValidExecutionEvidenceSnapshot(item, conformance, authenticator)).toBe(false);
  item.scenarioTrust = { ...item.scenarioTrust, status: "verified" };
  item.evidenceWarnings = ["Warnings were removed"];
  expect(hasValidExecutionEvidenceSnapshot(item, conformance, authenticator)).toBe(false);
  item.evidenceWarnings = ["Trace artifact is absent"];
  expect(hasValidExecutionEvidenceSnapshot(item, conformance, authenticator)).toBe(true);

  item.reporterResult!.assertions[0].actual = "rejected";
  expect(hasValidExecutionEvidenceSnapshot(item, conformance, authenticator)).toBe(false);
  item.semanticSnapshotHash = createExecutionEvidenceSnapshotHash(item, conformance);
  expect(hasValidExecutionEvidenceSnapshot(item, conformance, authenticator)).toBe(false);
  const result = calculateEvaluationTrialMetrics({
    ...metricsInput,
    artifactValidationByEvidenceId: new Map([[item.id, { status: "invalid", files: [], reasons: ["artifact hash changed"] }]]),
    semanticSnapshotValidByEvidenceId: new Map([[item.id, false]])
  });

  expect(result.businessConformance).toMatchObject({
    status: "not-measured", measured: 0, passed: 0, inconclusive: 1, rate: null
  });
});
