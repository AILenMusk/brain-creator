import { describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InMemoryBrainCreatorRepository } from "../domain/repository.js";
import type { BusinessScenario } from "../brain/types.js";
import type { ExecutableCase, ExecutionEvidence, RequirementSuiteRun, RunLedgerEntry, TestDataLease, TestDataTask, TestIntent } from "../domain/types.js";
import { RequirementSuiteRunService } from "../knowledge/requirementSuiteRun.js";
import type { IntegrityAuthenticator } from "../shared/crypto.js";
import { createWorkspaceIntegrityAuthenticator } from "../shared/crypto.js";
import { RequirementGateService } from "./requirementGate.js";
import { EvaluationIntegrityService } from "./evaluationIntegrity.js";
import { calculateEvaluationTrialMetrics } from "./evaluationMetrics.js";

export function trialFixture(authenticator?: IntegrityAuthenticator, includeBusinessOutcomes = false) {
  const repository = new InMemoryBrainCreatorRepository();
  const now = "2026-09-11T00:00:00.000Z";
  repository.knowledgeProjects.push({ id: "p", name: "P", key: "p", status: "active", defaultLocale: "en", systemIds: ["s"], createdAt: now, updatedAt: now });
  repository.systemProfiles.push({ id: "s", name: "S", environment: "test", baseUrl: "https://example.test", urlAllowlist: [], defaultLocale: "en", status: "succeeded", createdAt: now, updatedAt: now });
  repository.requirementSources.push({ id: "source", knowledgeProjectId: "p", source: "req.md", sourceType: "local-file", title: "R", contentHash: "hash", content: "Approve", blocks: [], attachments: [], warnings: [], accessStatus: "available", revision: 1, latestRequirementSetId: "set", createdAt: now, updatedAt: now });
  repository.requirementSets.push({ id: "set", knowledgeProjectId: "p", sourceId: "source", version: 1, title: "R", summary: "R", contentHash: "hash", status: "approved", affectedNodeIds: [], createdAt: now, updatedAt: now });
  repository.systemBrainSnapshots.push({
    id: "snapshot",
    knowledgeProjectId: "p",
    systemId: "s",
    revision: 1,
    explorationIds: ["exploration"],
    status: "confirmed",
    assets: [],
    contentHash: "snapshot-hash",
    createdAt: now,
    confirmedAt: now,
    confirmedBy: "reviewer"
  });
  for (const n of [1, 2, 3]) {
    repository.businessScenarios.push({ id: `scenario${n}`, knowledgeProjectId: "p", requirementSetId: "set", title: "Approve", objective: "Approve", family: "main-flow", actors: [], preconditions: [], workflowRefs: [], stateTransitionRefs: [], decisionRuleRefs: [], testDataNeeds: [], expectedBusinessOutcomes: ["approved"], sourceRefs: ["req:1"], testIntentIds: [`intent${n}`], risk: "low", status: "approved" } satisfies BusinessScenario);
    repository.scenarioAssuranceContracts.push({
      scenarioId: `scenario${n}`,
      systemId: "s",
      systemBrainSnapshotId: "snapshot",
      requirementRefs: ["req:1"],
      workflowRefs: ["workflow:approve"],
      stateTransitionRefs: ["state:submitted-approved"],
      decisionRuleRefs: [],
      systemBinding: "unique",
      testDataReadiness: "ready",
      oracleStrength: "strong",
      unsupportedInferences: [],
      risk: "low",
      independence: "deterministic",
      verdict: "pass",
      evidenceRefs: ["system-brain:snapshot"]
    });
    repository.executableCases.push({ id: `case${n}`, knowledgeProjectId: "p", requirementSetId: "set", testIntentId: `intent${n}`, systemId: "s", title: "Approve", status: "ready", preconditions: [], steps: [], dataProfileIds: [], gapIds: [], createdAt: now, updatedAt: now } satisfies ExecutableCase);
  }
  let approvalReceiptId: string | undefined;
  if (includeBusinessOutcomes) {
    const scenario = repository.businessScenarios.find((item) => item.id === "scenario1")!;
    scenario.testIntentIds = ["intent1", "intent1-outcome2"];
    repository.testIntents.push(
      testIntent({ id: "intent1", businessOutcomeId: "OUTCOME-01", scenarioId: "scenario1", now }),
      testIntent({ id: "intent1-outcome2", businessOutcomeId: "OUTCOME-02", scenarioId: "scenario1", now })
    );
    repository.executableCases.push({
      id: "case1-outcome2", knowledgeProjectId: "p", requirementSetId: "set", testIntentId: "intent1-outcome2",
      systemId: "s", title: "Outcome 2", status: "ready", preconditions: [], steps: [], dataProfileIds: [], gapIds: [],
      createdAt: now, updatedAt: now
    } satisfies ExecutableCase);
    const gate = new RequirementGateService(repository);
    const challenge = gate.issueApprovalChallenge("set");
    approvalReceiptId = gate.createApprovalReceipt({
      requirementSetId: "set", assetHash: challenge.assetHash, method: "challenge-response", approvedBy: "reviewer",
      challengeId: challenge.challengeId, approvalCode: challenge.code
    }).id;
  }
  const service = new EvaluationIntegrityService(repository, authenticator);
  const input = { comparisonGroupId: "g", knowledgeProjectId: "p", systemId: "s", requirementSourceId: "source", provider: "builtin" as const, workspacePath: ".", storePath: "./isolated", codeRevision: "commit", runtimeVersions: {}, runtimeBuildIdentity: "test-build", businessScenarioIds: ["scenario1", "scenario2", "scenario3"] };
  const start = () => service.startTrial({ ...input, ...(approvalReceiptId ? { approvalReceiptId } : {}) }).trial;
  return { repository, service, input, start, approvalReceiptId };
}

function testIntent(input: { id: string; businessOutcomeId: string; scenarioId: string; now: string }): TestIntent {
  return {
    id: input.id,
    knowledgeProjectId: "p",
    requirementSetId: "set",
    businessOutcomeId: input.businessOutcomeId,
    title: input.businessOutcomeId,
    module: "Orders",
    priority: "P1",
    objective: "Verify one approved business outcome",
    preconditions: [],
    expectedResults: ["The matching business state is independently readable"],
    requirementRefs: ["req:1"],
    knowledgeNodeRefs: [],
    techniques: [],
    scenarioIds: [input.scenarioId],
    status: "approved",
    createdAt: input.now,
    updatedAt: input.now
  };
}

describe("frozen evaluation execution scope", () => {
  it.each(["project", "system", "source", "scenario"])("rejects foreign %s at start", (kind) => {
    const f = trialFixture();
    if (kind === "project") f.input.knowledgeProjectId = "foreign";
    if (kind === "system") f.input.systemId = "foreign";
    if (kind === "source") f.repository.requirementSets[0].sourceId = "foreign";
    if (kind === "scenario") f.repository.businessScenarios[0].requirementSetId = "foreign";
    expect(() => f.start()).toThrow();
  });
  it("requires an explicit scoped system but preserves legacy analysis trials", () => {
    const f = trialFixture();
    expect(() => f.service.startTrial({ ...f.input, systemId: undefined })).toThrow("explicit");
    expect(f.service.startTrial({ ...f.input, systemId: undefined, businessScenarioIds: undefined }).trial.executionScope).toBeUndefined();
  });
  it.each(["scenario-status", "missing-contract", "weak-oracle", "snapshot-status", "system-binding"])(
    "rejects scoped Trials with an unready %s",
    (kind) => {
      const f = trialFixture();
      if (kind === "scenario-status") f.repository.businessScenarios[0]!.status = "draft";
      if (kind === "missing-contract") f.repository.scenarioAssuranceContracts.splice(0, 1);
      if (kind === "weak-oracle") f.repository.scenarioAssuranceContracts[0]!.oracleStrength = "limited";
      if (kind === "snapshot-status") f.repository.systemBrainSnapshots[0]!.status = "superseded";
      if (kind === "system-binding") f.repository.scenarioAssuranceContracts[0]!.systemBinding = "ambiguous";

      expect(() => f.start()).toThrow("Evaluation trial scenarios are not ready");
    }
  );
  it("requires exactly one assurance contract for the selected system while allowing other system bindings", () => {
    const f = trialFixture();
    f.repository.scenarioAssuranceContracts.push({
      ...structuredClone(f.repository.scenarioAssuranceContracts[0]!),
      systemId: "other-system"
    });
    expect(() => f.start()).not.toThrow();

    const duplicate = trialFixture();
    duplicate.repository.scenarioAssuranceContracts.push(
      structuredClone(duplicate.repository.scenarioAssuranceContracts[0]!)
    );
    expect(() => duplicate.start()).toThrow("one unique assurance contract for the selected system");
  });
  it("rechecks scenario review and Oracle readiness after a controlled projection checkpoint", () => {
    const f = trialFixture();
    const trial = f.start();
    f.repository.businessScenarios[0]!.status = "draft";
    f.service.checkpointTrial({
      trialId: trial.id,
      previousProjectionManifestId: trial.latestProjectionManifestId,
      operation: "controlled scenario edit",
      evidenceRefs: ["review:scenario-edit"]
    });

    const validation = f.service.validateExecutionBinding({
      trialId: trial.id,
      knowledgeProjectId: "p",
      systemId: "s",
      executableCaseIds: ["case1"]
    });

    expect(validation.valid).toBe(false);
    expect(validation.reasons).toContain("Scenario scenario1 is missing or not approved");
  });
  it("pins the confirmed System Brain snapshot in the Trial scope and rejects a reviewed replacement", () => {
    const f = trialFixture();
    const trial = f.start();
    expect(trial.executionScope).toMatchObject({
      systemBrainSnapshotId: "snapshot",
      systemBrainSnapshotHash: "snapshot-hash"
    });

    const replacement = {
      ...structuredClone(f.repository.systemBrainSnapshots[0]!),
      id: "snapshot-2",
      revision: 2,
      contentHash: "snapshot-hash-2"
    };
    f.repository.systemBrainSnapshots.push(replacement);
    f.repository.scenarioAssuranceContracts[0]!.systemBrainSnapshotId = replacement.id;
    f.repository.scenarioAssuranceContracts[0]!.evidenceRefs = ["system-brain:snapshot-2"];
    f.service.checkpointTrial({
      trialId: trial.id,
      previousProjectionManifestId: trial.latestProjectionManifestId,
      operation: "review replacement System Brain snapshot",
      evidenceRefs: ["system-brain:snapshot-2"]
    });

    const validation = f.service.validateExecutionBinding({
      trialId: trial.id,
      knowledgeProjectId: "p",
      systemId: "s",
      executableCaseIds: ["case1"]
    });
    expect(validation.valid).toBe(false);
    expect(validation.reasons).toContain("Frozen System Brain snapshot changed or is not pinned");
  });
  it.each(["none", "multiple", "outside"])("rejects %s selected scenario mapping", (kind) => {
    const f = trialFixture();
    if (kind === "none") f.repository.businessScenarios[0].testIntentIds = [];
    if (kind === "multiple") f.repository.businessScenarios[1].testIntentIds = ["intent1"];
    if (kind === "outside") f.input.businessScenarioIds = ["scenario2"];
    const trial = f.start();
    expect(f.service.validateExecutionBinding({ trialId: trial.id, knowledgeProjectId: "p", systemId: "s", executableCaseIds: ["case1"] }).valid).toBe(false);
  });
  it.each(["scope", "version", "source", "membership"])("detects changed %s even after a checkpoint", (kind) => {
    const f = trialFixture(); const trial = f.start();
    if (kind === "scope") trial.executionScope!.businessScenarioIds.pop();
    if (kind === "version") f.repository.requirementSets[0].version++;
    if (kind === "source") f.repository.requirementSources[0].revision++;
    if (kind === "membership") f.repository.knowledgeProjects[0].systemIds = [];
    f.service.checkpointTrial({ trialId: trial.id, previousProjectionManifestId: trial.latestProjectionManifestId, operation: "test", evidenceRefs: ["test:1"] });
    expect(f.service.validateExecutionBinding({ trialId: trial.id, knowledgeProjectId: "p", systemId: "s", executableCaseIds: ["case1"] }).valid).toBe(false);
  });
  it("rejects execution binding when the repository projection drifts after the latest checkpoint", () => {
    const f = trialFixture();
    const trial = f.start();
    f.repository.executableCases[0]!.title = "Changed without a checkpoint";

    const validation = f.service.validateExecutionBinding({
      trialId: trial.id,
      knowledgeProjectId: "p",
      systemId: "s",
      executableCaseIds: ["case1"]
    });

    expect(validation.valid).toBe(false);
    expect(validation.reasons).toContain("Repository projection changed outside a controlled checkpoint");
  });
  it.each([undefined, "unknown", "other"])("rejects missing or changed runtime %s", (runtimeBuildIdentity) => {
    const f = trialFixture();
    const trial = f.service.startTrial({ ...f.input, runtimeBuildIdentity: "pinned" }).trial;
    expect(f.service.validateExecutionBinding({ trialId: trial.id, knowledgeProjectId: "p", systemId: "s", executableCaseIds: ["case1"], runtimeBuildIdentity }).valid).toBe(false);
  });
  it("accepts an actual current receipt and rejects fake, draft and stale approvals", () => {
    const f = trialFixture(); const gate = new RequirementGateService(f.repository);
    expect(() => f.service.startTrial({ ...f.input, approvalReceiptId: "arbitrary-hash" })).toThrow();
    const challenge = gate.issueApprovalChallenge("set");
    const receipt = gate.createApprovalReceipt({ requirementSetId: "set", assetHash: challenge.assetHash, method: "challenge-response", approvedBy: "reviewer", challengeId: challenge.challengeId, approvalCode: challenge.code });
    f.repository.requirementSets[0].status = "draft";
    expect(() => f.service.startTrial({ ...f.input, approvalReceiptId: receipt.id })).toThrow("approved");
    f.repository.requirementSets[0].status = "approved";
    const trial = f.service.startTrial({ ...f.input, approvalReceiptId: receipt.id }).trial;
    expect(trial.executionScope?.approvalScopeHash).toBe(receipt.assetHash);
    f.repository.requirementSets[0].version++;
    expect(f.service.validateExecutionBinding({ trialId: trial.id, knowledgeProjectId: "p", systemId: "s" }).valid).toBe(false);
  });
  it("freezes the complete unique approved business-outcome roster", () => {
    const f = trialFixture(undefined, true);
    const malformed = trialFixture(undefined, true);
    malformed.repository.testIntents[0]!.businessOutcomeId = " OUTCOME-01 ";
    expect(() => malformed.service.startTrial({
      ...malformed.input,
      approvalReceiptId: malformed.approvalReceiptId
    })).toThrow("empty or non-normalized");

    expect(() => f.service.startTrial({ ...f.input })).toThrow("approved RequirementSet and its approval receipt");
    expect(() => f.service.startTrial({
      ...f.input,
      approvalReceiptId: f.approvalReceiptId,
      businessOutcomeIds: ["OUTCOME-01"]
    })).toThrow("complete approved business-outcome roster");
    expect(() => f.service.startTrial({
      ...f.input,
      approvalReceiptId: f.approvalReceiptId,
      businessOutcomeIds: ["OUTCOME-01", "OUTCOME-01", "OUTCOME-02"]
    })).toThrow("duplicate outcome IDs");

    const trial = f.service.startTrial({
      ...f.input,
      approvalReceiptId: f.approvalReceiptId,
      businessOutcomeIds: ["OUTCOME-01", "OUTCOME-02"]
    }).trial;
    expect(trial.executionScope?.businessOutcomeIds).toEqual(["OUTCOME-01", "OUTCOME-02"]);
  });
  it("invalidates a Trial when its approved outcome mapping changes after the snapshot", () => {
    const f = trialFixture(undefined, true);
    const trial = f.start();
    f.repository.testIntents[0]!.businessOutcomeId = "OUTCOME-CHANGED";
    f.service.checkpointTrial({
      trialId: trial.id,
      previousProjectionManifestId: trial.latestProjectionManifestId,
      operation: "test changed approved outcome mapping",
      evidenceRefs: ["review:mapping-change"]
    });

    const validation = f.service.validateExecutionBinding({
      trialId: trial.id,
      knowledgeProjectId: "p",
      systemId: "s",
      executableCaseIds: ["case1"]
    });
    expect(validation.valid).toBe(false);
    expect(validation.reasons).toContain("Frozen requirement baseline or scope version changed");
    expect(trial.status).toBe("invalidated");
  });
});

function measuredFixture(includeBusinessOutcomes = false) {
  const f = trialFixture(undefined, includeBusinessOutcomes); const trial = f.start();
  const runs = new RequirementSuiteRunService(f.repository, undefined, "test-build");
  const run = runs.create({ knowledgeProjectId: "p", systemId: "s", evaluationTrialId: trial.id, cases: [{ executableCaseId: "case1", title: "Approve" }, { executableCaseId: "case2", title: "Blocked" }], continueOnBlocked: true });
  const at = new Date(Date.parse(run.createdAt) + 1000).toISOString();
  run.updatedAt = at;
  run.caseRuns[0].status = "passed"; run.caseRuns[0].completedAt = at; run.caseRuns[0].executionEvidenceId = "e";
  run.caseRuns[1].status = "blocked";
  const evidence: ExecutionEvidence = {
    id: "e", knowledgeProjectId: "p", systemId: "s", executableCaseId: "case1", requirementSuiteRunId: run.id, testCaseId: "test", contextPackPath: "", status: "passed", provenance: "real-system", assuranceLevel: "strong", createdAt: run.createdAt, completedAt: at,
    artifactValidation: { status: "valid", files: [{ path: "evidence.json", sha256: "a".repeat(64) }], reasons: [] },
    assertionContracts: [{ id: "assert", stepId: "step", type: "state", strength: "strong", requirementRefs: ["req:1"], evidenceRequirements: ["actual-value"], oracle: { operator: "equals", expected: "approved", applicability: { mode: "unconditional" }, applicabilityRefs: ["req:1"] } }],
    reporterResult: { status: "passed", total: 1, passed: 1, failed: 0, skipped: 0, durationMs: 1, assertions: [{ id: "assert", stepId: "step", status: "passed", actual: "approved", evidenceRefs: ["evidence.json"] }], attachments: ["evidence.json"], consoleErrors: [], networkFailures: [] },
    steps: [], tracePaths: [], artifactPaths: ["evidence.json"], consoleErrors: [], networkFailures: []
  };
  f.repository.executionEvidence.push(evidence);
  f.repository.conformanceResults.push({ id: "c", scenarioId: "scenario1", executionEvidenceId: "e", verdict: "conform", expectationRefs: ["req:1"], observationRefs: ["evidence.json"], executionRefs: ["e"], reasons: [], createdAt: at });
  const metrics = (actionEvidenceArtifactsValidByEntryId = new Map(
    f.repository.runLedgerEntries.filter((entry) => entry.event === "action-reconciled" && entry.actionEvidenceArtifacts?.length)
      .map((entry) => [entry.id, true])
  ), includeTestIntents = true) => calculateEvaluationTrialMetrics({ trial, runs: f.repository.requirementSuiteRuns, evidence: f.repository.executionEvidence, conformanceResults: f.repository.conformanceResults, scenarios: f.repository.businessScenarios, ...(includeTestIntents ? { testIntents: f.repository.testIntents } : {}), executableCases: f.repository.executableCases, interventions: f.repository.interventionRecords, runLedgerEntries: f.repository.runLedgerEntries, testDataTasks: f.repository.testDataTasks, testDataLeases: f.repository.testDataLeases, actionEvidenceArtifactsValidByEntryId });
  return { ...f, trial, run, runs, evidence, at, metrics };
}

describe("evaluation trial metrics", () => {
  it("counts outcome-level conformance and autonomy independently of grouped scenarios", () => {
    const f = measuredFixture(true);
    const metrics = f.metrics();
    expect(metrics.businessConformance.denominator).toBe(3);
    expect(metrics.businessOutcomeIds).toEqual(["OUTCOME-01", "OUTCOME-02"]);
    expect(metrics.businessOutcomeConformance).toMatchObject({
      denominator: 2, measured: 1, passed: 1, blocked: 0, notRun: 1, rate: 0.5
    });
    expect(f.metrics(undefined, false).businessOutcomeConformance).toMatchObject({
      status: "not-comparable", denominator: 2, rate: null
    });

    f.service.completeTrial(f.trial.id, "commit", {}, "test-build");
    f.service.completeInterventionCapture({
      trialId: f.trial.id,
      actor: "reviewer",
      scenarioIds: ["scenario1", "scenario2", "scenario3"],
      evidenceRefs: ["review:session"]
    });
    expect(f.metrics().autonomy.businessOutcomes).toMatchObject({
      status: "measured", autonomous: 1, denominator: 2, rate: 0.5, manualIds: []
    });
  });
  it("keeps blocked and unexecuted selected scenarios in the denominator", () => {
    const f = measuredFixture();
    expect(f.metrics().businessConformance).toMatchObject({ denominator: 3, measured: 1, passed: 1, blocked: 1, notRun: 1, rate: 1 / 3 });
    expect(f.metrics().operations.firstValidResult).toMatchObject({
      status: "measured",
      elapsedMs: Date.parse(f.run.createdAt) + 1000 - Date.parse(f.trial.createdAt),
      scenarioId: "scenario1"
    });
    expect(f.metrics().operations.recovery).toMatchObject({ status: "not-measured", denominator: null, rate: null });
    expect(f.metrics().operations.cleanup).toMatchObject({ status: "not-measured", denominator: null, rate: null });
  });
  it("keeps the first valid result time when a later retry fails", () => {
    const f = measuredFixture();
    const laterAt = new Date(Date.parse(f.at) + 1000).toISOString();
    const failedEvidence: ExecutionEvidence = structuredClone(f.evidence);
    failedEvidence.id = "e-failed";
    failedEvidence.status = "failed";
    failedEvidence.createdAt = laterAt;
    failedEvidence.completedAt = laterAt;
    failedEvidence.artifactValidation = {
      status: "valid", files: [{ path: "failure.json", sha256: "c".repeat(64) }], reasons: []
    };
    failedEvidence.reporterResult = {
      ...failedEvidence.reporterResult!,
      status: "failed", passed: 0, failed: 1,
      assertions: [{ id: "assert", stepId: "step", status: "failed", expected: "approved", actual: "rejected", evidenceRefs: ["failure.json"] }]
    };
    f.repository.executionEvidence.push(failedEvidence);
    f.repository.conformanceResults.push({
      id: "c-failed", scenarioId: "scenario1", executionEvidenceId: failedEvidence.id, verdict: "nonconform",
      expectationRefs: ["req:1"], observationRefs: ["failure.json"], executionRefs: [failedEvidence.id], reasons: [], createdAt: laterAt
    });
    f.run.caseRuns[0]!.attempts.push({
      status: "failed", executionEvidenceId: failedEvidence.id, gapIds: [],
      completedAt: laterAt, archivedAt: laterAt
    });

    expect(f.metrics().businessConformance).toMatchObject({ failed: 1, passed: 0 });
    expect(f.metrics().operations.firstValidResult).toMatchObject({
      status: "measured",
      elapsedMs: Date.parse(f.at) - Date.parse(f.trial.createdAt),
      scenarioId: "scenario1"
    });
  });
  it("uses the signed evidence completion time instead of a later suite projection timestamp", () => {
    const f = measuredFixture();
    f.run.caseRuns[0]!.completedAt = new Date(Date.parse(f.at) + 60_000).toISOString();

    expect(f.metrics().operations.firstValidResult).toMatchObject({
      status: "measured",
      elapsedMs: Date.parse(f.evidence.completedAt!) - Date.parse(f.trial.createdAt),
      scenarioId: "scenario1"
    });
  });
  it("measures Trial-bound recovery and cleanup while retaining unresolved work in denominators", () => {
    const f = measuredFixture();
    const createdAt = new Date(Date.parse(f.run.createdAt) + 2000).toISOString();
    f.repository.runLedgerEntries.push(
      {
        id: "recovery-required", requirementSuiteRunId: f.run.id, knowledgeProjectId: "p", systemId: "s", event: "action-reconciliation-required",
        actionKey: "submit-order", actionPhase: "reconciliation-required", scope: "case", stage: "execution", toStatus: "waiting",
        createdAt
      } as RunLedgerEntry,
      {
        id: "recovery-done", requirementSuiteRunId: f.run.id, knowledgeProjectId: "p", systemId: "s", event: "action-reconciled",
        actionKey: "submit-order", actionPhase: "reconciled", actionEvidenceRefs: ["state:submitted"],
        actionEvidenceArtifacts: [{ path: "state.json", sha256: "b".repeat(64) }], scope: "case", stage: "execution", toStatus: "running",
        createdAt: new Date(Date.parse(createdAt) + 1000).toISOString()
      } as RunLedgerEntry,
      {
        id: "recovery-unverified-required", requirementSuiteRunId: f.run.id, knowledgeProjectId: "p", systemId: "s",
        event: "action-reconciliation-required", actionKey: "approve-order", actionPhase: "reconciliation-required",
        scope: "case", stage: "execution", toStatus: "waiting", createdAt
      } as RunLedgerEntry,
      {
        id: "recovery-unverified-done", requirementSuiteRunId: f.run.id, knowledgeProjectId: "p", systemId: "s",
        event: "action-reconciled", actionKey: "approve-order", actionPhase: "reconciled",
        scope: "case", stage: "execution", toStatus: "running", createdAt: new Date(Date.parse(createdAt) + 1000).toISOString()
      } as RunLedgerEntry
    );
    const task = (id: string, status: TestDataTask["status"], leaseId: string): TestDataTask => ({
      id, knowledgeProjectId: "p", systemId: "s", executableCaseId: "case1", requirementSuiteRunId: f.run.id,
      profileId: "profile", field: "order", action: "cleanup", status, idempotencyKey: id, allowCreate: true,
      cleanup: "delete-created", leaseId, contextPath: "", promptPath: "", sourceRefs: [], outputSourceRefs: [],
      createdAt, updatedAt: createdAt
    });
    const releasedLease: TestDataLease = {
      id: "lease-released", knowledgeProjectId: "p", systemId: "s", executableCaseId: "case1", requirementSuiteRunId: f.run.id,
      profileId: "profile", taskId: "cleanup-done", decision: "create", reference: "order:1", cleanup: "delete-created",
      status: "released", sourceRefs: [], createdAt, updatedAt: createdAt, releasedAt: createdAt
    };
    f.repository.testDataTasks.push(task("cleanup-done", "submitted", "lease-released"), task("cleanup-pending", "pending", "lease-pending"));
    f.repository.testDataLeases.push(releasedLease);
    expect(f.metrics().operations.recovery).toMatchObject({ status: "measured", denominator: 2, succeeded: 1, unresolved: 1, rate: 0.5 });
    expect(f.metrics(new Map([ ["recovery-done", false] ])).operations.recovery)
      .toMatchObject({ denominator: 2, succeeded: 0, unresolved: 2, rate: 0 });
    expect(f.metrics().operations.cleanup).toMatchObject({ status: "measured", denominator: 2, succeeded: 1, failed: 0, pending: 1, rate: 0.5 });
  });
  it("orders recovery outcomes by Run Ledger sequence when timestamps collide", () => {
    const f = measuredFixture();
    const createdAt = new Date(Date.parse(f.run.createdAt) + 2000).toISOString();
    f.repository.runLedgerEntries.push(
      {
        id: "recovery-done", sequence: 9, requirementSuiteRunId: f.run.id, knowledgeProjectId: "p", systemId: "s",
        event: "action-reconciled", actionKey: "submit-order", actionPhase: "reconciled",
        actionEvidenceRefs: ["state:submitted"], actionEvidenceArtifacts: [{ path: "state.json", sha256: "b".repeat(64) }],
        scope: "case", stage: "execution", toStatus: "running", createdAt
      } as RunLedgerEntry,
      {
        id: "recovery-required", sequence: 8, requirementSuiteRunId: f.run.id, knowledgeProjectId: "p", systemId: "s",
        event: "action-reconciliation-required", actionKey: "submit-order", actionPhase: "reconciliation-required",
        scope: "case", stage: "execution", toStatus: "waiting", createdAt
      } as RunLedgerEntry
    );

    expect(f.metrics(new Map([["recovery-done", true]])).operations.recovery)
      .toMatchObject({ status: "measured", denominator: 1, succeeded: 1, unresolved: 0, rate: 1 });
  });
  it("excludes cross-system and cross-project operational records", () => {
    const f = measuredFixture();
    const at = new Date(Date.parse(f.run.createdAt) + 2000).toISOString();
    f.repository.runLedgerEntries.push({
      id: "foreign-recovery", requirementSuiteRunId: f.run.id, knowledgeProjectId: "other-project", systemId: "s",
      event: "action-reconciliation-required", actionKey: "submit", actionPhase: "reconciliation-required",
      scope: "case", stage: "execution", toStatus: "waiting", createdAt: at
    } as RunLedgerEntry);
    f.repository.testDataTasks.push({
      id: "foreign-cleanup", knowledgeProjectId: "other-project", systemId: "s", executableCaseId: "case1",
      requirementSuiteRunId: f.run.id, profileId: "profile", field: "order", action: "cleanup", status: "pending",
      idempotencyKey: "foreign-cleanup", allowCreate: true, cleanup: "delete-created", leaseId: "foreign-lease",
      contextPath: "", promptPath: "", sourceRefs: [], outputSourceRefs: [], createdAt: at, updatedAt: at
    });
    expect(f.metrics().operations.recovery).toMatchObject({ status: "not-measured", denominator: null, rate: null });
    expect(f.metrics().operations.cleanup).toMatchObject({ status: "not-measured", denominator: null, rate: null });
  });
  it("measures autonomous completions only after full frozen-scope intervention attestation", () => {
    const f = measuredFixture();
    expect(f.metrics().autonomy).toMatchObject({ status: "not-measured", autonomousScenarios: null, denominator: 3, rate: null });
    f.service.completeTrial(f.trial.id, "commit", {}, "test-build");
    expect(() => f.service.completeInterventionCapture({
      trialId: f.trial.id, actor: "reviewer", scenarioIds: ["scenario1"], evidenceRefs: ["review:session"]
    })).toThrow("cover every frozen Trial scenario");
    f.service.completeInterventionCapture({
      trialId: f.trial.id,
      actor: "reviewer",
      scenarioIds: ["scenario1", "scenario2", "scenario3"],
      evidenceRefs: ["review:session"]
    });

    expect(f.metrics().autonomy).toMatchObject({
      status: "measured", autonomousScenarios: 1, denominator: 3, rate: 1 / 3, manualScenarioIds: []
    });
  });
  it("subtracts scenarios with recorded clarification, authentication or recovery from autonomous completions", () => {
    const f = measuredFixture();
    f.service.recordIntervention({
      trialId: f.trial.id,
      category: "user-clarification",
      actor: "user",
      note: "Clarified the approver role",
      evidenceRefs: ["run-ledger:manual-clarification"],
      businessScenarioIds: ["scenario1"]
    });
    f.service.recordIntervention({
      trialId: f.trial.id,
      category: "user-authentication",
      actor: "user",
      note: "Completed a required login challenge",
      evidenceRefs: ["auth-checkpoint:login"],
      businessScenarioIds: ["scenario1"]
    });
    f.service.recordIntervention({
      trialId: f.trial.id,
      category: "manual-evidence-review",
      actor: "reviewer",
      note: "Re-evaluated complete historical execution artifacts",
      evidenceRefs: ["historical-evidence-review:review-1"],
      businessScenarioIds: ["scenario1"]
    });
    f.service.recordIntervention({
      trialId: f.trial.id,
      category: "manual-recovery",
      actor: "user",
      note: "Restored the interrupted browser session",
      evidenceRefs: ["run-ledger:manual-recovery"],
      businessScenarioIds: ["scenario1"]
    });
    f.service.completeTrial(f.trial.id, "commit", {}, "test-build");
    f.service.completeInterventionCapture({
      trialId: f.trial.id,
      actor: "reviewer",
      scenarioIds: ["scenario1", "scenario2", "scenario3"],
      evidenceRefs: ["review:session"]
    });

    expect(f.metrics().autonomy).toMatchObject({
      status: "measured", autonomousScenarios: 0, denominator: 3, rate: 0, manualScenarioIds: ["scenario1"]
    });
  });
  it("reports initial authorization separately from authentication recovery", () => {
    const f = measuredFixture();
    f.service.recordIntervention({
      trialId: f.trial.id,
      category: "user-authentication",
      authenticationPhase: "initial-authorization",
      actor: "user",
      note: "Completed first authorization before the initial workflow run",
      evidenceRefs: ["auth-checkpoint:first-login"],
      businessScenarioIds: ["scenario1"]
    });
    f.service.recordIntervention({
      trialId: f.trial.id,
      category: "user-authentication",
      authenticationPhase: "session-recovery",
      actor: "user",
      note: "Restored an expired session during a later workflow run",
      evidenceRefs: ["auth-checkpoint:session-recovery"],
      businessScenarioIds: ["scenario2"]
    });
    f.service.completeTrial(f.trial.id, "commit", {}, "test-build");
    f.service.completeInterventionCapture({
      trialId: f.trial.id,
      actor: "reviewer",
      scenarioIds: ["scenario1", "scenario2", "scenario3"],
      evidenceRefs: ["review:session"]
    });

    expect(f.metrics().autonomy).toMatchObject({
      status: "measured",
      autonomousScenarios: 1,
      denominator: 3,
      rate: 1 / 3,
      manualScenarioIds: ["scenario2"],
      authenticationInterventionCounts: {
        initialAuthorization: 1,
        sessionRecovery: 1,
        unclassified: 0
      }
    });
  });
  it("blocks autonomy capture when a completed Trial auth checkpoint has no intervention record", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "bc-trial-missing-auth-intervention-"));
    try {
      const f = trialFixture(createWorkspaceIntegrityAuthenticator(workspace));
      const trial = f.start();
      f.service.completeTrial(trial.id, "commit", {}, "test-build");
      f.service.completeInterventionCapture({
        trialId: trial.id,
        actor: "reviewer",
        scenarioIds: ["scenario1", "scenario2", "scenario3"],
        evidenceRefs: ["review:session"]
      });
      f.repository.authCheckpoints.push({
        id: "checkpoint-missing-intervention",
        systemId: "s",
        authProfileId: "auth-profile",
        evaluationTrialId: trial.id,
        businessScenarioId: "scenario1",
        authenticationPhase: "initial-authorization",
        reason: "Complete initial login",
        resumeInstruction: "Resume after login",
        status: "completed",
        createdAt: new Date(0).toISOString(),
        updatedAt: new Date(0).toISOString(),
        completedAt: new Date(0).toISOString()
      });

      const integrity = f.service.reviewInterventionIntegrity(trial.id);
      expect(integrity.unrecordedInterventionSourceRefs).toEqual(["auth-checkpoint:checkpoint-missing-intervention"]);
      expect(() => f.service.completeInterventionCapture({
        trialId: trial.id,
        actor: "reviewer",
        scenarioIds: ["scenario1", "scenario2", "scenario3"],
        evidenceRefs: ["review:session"]
      })).toThrow(/intervention sources are missing records/);

      const metrics = calculateEvaluationTrialMetrics({
        trial,
        runs: f.repository.requirementSuiteRuns,
        evidence: f.repository.executionEvidence,
        conformanceResults: f.repository.conformanceResults,
        scenarios: f.repository.businessScenarios,
        executableCases: f.repository.executableCases,
        interventions: f.repository.interventionRecords,
        interventionCaptureIntegrityValid: integrity.captureIntegrityValid,
        interventionSourcesComplete: integrity.interventionSourcesComplete
      });
      expect(metrics.autonomy).toMatchObject({
        status: "not-measured",
        denominator: 3,
        reason: "A completed Trial-bound authentication checkpoint or manual recovery is missing an intervention record."
      });
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });
  it("blocks autonomy capture when a Trial-bound manual recovery is missing its intervention record", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "bc-trial-missing-recovery-intervention-"));
    try {
      const f = trialFixture(createWorkspaceIntegrityAuthenticator(workspace));
      const trial = f.start();
      f.service.completeTrial(trial.id, "commit", {}, "test-build");
      f.service.completeInterventionCapture({
        trialId: trial.id,
        actor: "reviewer",
        scenarioIds: ["scenario1", "scenario2", "scenario3"],
        evidenceRefs: ["review:session"]
      });
      const runId = "suite-manual-recovery";
      const now = new Date().toISOString();
      f.repository.requirementSuiteRuns.push({
        id: runId,
        knowledgeProjectId: "p",
        systemId: "s",
        evaluationTrialId: trial.id,
        status: "completed",
        continueOnBlocked: false,
        allowCreateTestData: false,
        total: 1,
        passed: 1,
        failed: 0,
        blocked: 0,
        skipped: 0,
        cancelled: 0,
        caseRuns: [],
        createdAt: now,
        updatedAt: now
      } satisfies RequirementSuiteRun);
      f.repository.runLedgerEntries.push({
        id: "ledger-manual-recovery",
        runType: "requirement-suite",
        knowledgeProjectId: "p",
        systemId: "s",
        requirementSuiteRunId: runId,
        event: "action-reconciled",
        scope: "case",
        stage: "execution",
        toStatus: "running",
        actionKey: "approve-order",
        actionPhase: "reconciled",
        recoveryMode: "manual",
        actionSemantic: "Approve order",
        actionPostcondition: "Order is approved",
        actionEvidenceRefs: ["manual-observation:approved"],
        createdAt: now
      } satisfies RunLedgerEntry);

      const integrity = f.service.reviewInterventionIntegrity(trial.id);
      expect(integrity.unrecordedInterventionSourceRefs).toEqual(["run-ledger:ledger-manual-recovery"]);
      expect(() => f.service.completeInterventionCapture({
        trialId: trial.id,
        actor: "reviewer",
        scenarioIds: ["scenario1", "scenario2", "scenario3"],
        evidenceRefs: ["review:session"]
      })).toThrow(/intervention sources are missing records/);
      expect(calculateEvaluationTrialMetrics({
        trial,
        runs: f.repository.requirementSuiteRuns,
        evidence: f.repository.executionEvidence,
        conformanceResults: f.repository.conformanceResults,
        scenarios: f.repository.businessScenarios,
        executableCases: f.repository.executableCases,
        interventions: f.repository.interventionRecords,
        interventionCaptureIntegrityValid: integrity.captureIntegrityValid,
        interventionSourcesComplete: integrity.interventionSourcesComplete
      }).autonomy).toMatchObject({
        status: "not-measured",
        denominator: 3,
        reason: "A completed Trial-bound authentication checkpoint or manual recovery is missing an intervention record."
      });
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });
  it("detects an unrecorded manual recovery bound outside a requirement suite", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "bc-trial-out-of-suite-recovery-"));
    try {
      const f = trialFixture(createWorkspaceIntegrityAuthenticator(workspace));
      const trial = f.start();
      f.repository.runLedgerEntries.push({
        id: "document-suite-manual-recovery",
        runType: "document-suite",
        systemId: "s",
        evaluationTrialId: trial.id,
        caseSuiteId: "document-suite",
        caseNo: "TC-001",
        event: "action-reconciled",
        scope: "case",
        stage: "execution",
        toStatus: "reconciled",
        actionKey: "tc-001:submit",
        actionPhase: "reconciled",
        recoveryMode: "manual",
        actionSemantic: "Submit order",
        actionPostcondition: "Order status is submitted",
        actionEvidenceRefs: ["manual-observation:submitted"],
        createdAt: new Date().toISOString()
      });

      expect(f.service.reviewInterventionIntegrity(trial.id).unrecordedInterventionSourceRefs)
        .toEqual(["run-ledger:document-suite-manual-recovery"]);
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });
  it.each(["code-change", "product-source-change"] as const)(
    "does not count a Trial with a %s repair as autonomous",
    (category) => {
      const f = measuredFixture();
      const intervention = f.service.recordIntervention({
        trialId: f.trial.id,
        category,
        actor: "developer",
        note: "Product code was repaired after the scenario failed",
        evidenceRefs: ["source-diff:repair-1"],
        businessScenarioIds: ["scenario1"]
      });

      expect(f.trial.status).toBe("invalidated");
      expect(f.metrics().businessConformance.status).toBe("not-comparable");
      expect(f.metrics().autonomy).toMatchObject({
        status: "not-measured",
        autonomousScenarios: null,
        denominator: 3,
        rate: null,
        codeChanges: [intervention]
      });
    }
  );
  it("refuses autonomy measurement when a new intervention appears after capture attestation", () => {
    const f = measuredFixture();
    f.service.completeTrial(f.trial.id, "commit", {}, "test-build");
    f.service.completeInterventionCapture({
      trialId: f.trial.id,
      actor: "reviewer",
      scenarioIds: ["scenario1", "scenario2", "scenario3"],
      evidenceRefs: ["review:session"]
    });
    f.service.recordIntervention({
      trialId: f.trial.id,
      category: "user-clarification",
      actor: "user",
      note: "Late clarification",
      evidenceRefs: ["run-ledger:late"],
      businessScenarioIds: ["scenario1"]
    });

    expect(f.metrics().autonomy).toMatchObject({
      status: "not-measured", autonomousScenarios: null, rate: null,
      reason: "An intervention was recorded after the capture attestation."
    });
  });
  it("keeps autonomy unmeasured when a manual recovery has no reliable scenario attribution", () => {
    const f = measuredFixture();
    f.service.recordIntervention({
      trialId: f.trial.id,
      category: "manual-recovery",
      actor: "user",
      note: "Recovered an interrupted session but could not identify the affected scenario",
      evidenceRefs: ["recovery:session-restore"]
    });
    f.service.completeTrial(f.trial.id, "commit", {}, "test-build");
    f.service.completeInterventionCapture({
      trialId: f.trial.id,
      actor: "reviewer",
      scenarioIds: ["scenario1", "scenario2", "scenario3"],
      evidenceRefs: ["review:session"]
    });

    expect(f.metrics().autonomy).toMatchObject({
      status: "not-measured",
      autonomousScenarios: null,
      denominator: 3,
      rate: null,
      reason: "At least one manual intervention is not attributed to a frozen scenario."
    });
  });
  it("authenticates intervention records and the frozen capture against Store edits", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "bc-trial-intervention-integrity-"));
    try {
      const f = trialFixture(createWorkspaceIntegrityAuthenticator(workspace));
      const trial = f.start();
      const record = f.service.recordIntervention({
        trialId: trial.id,
        category: "user-authentication",
        authenticationPhase: "initial-authorization",
        actor: "user",
        note: "Completed a login challenge",
        evidenceRefs: ["auth-checkpoint:login"],
        businessScenarioIds: ["scenario1"]
      });
      f.service.completeTrial(trial.id, "commit", {}, "test-build");
      f.service.completeInterventionCapture({
        trialId: trial.id,
        actor: "reviewer",
        scenarioIds: ["scenario1", "scenario2", "scenario3"],
        evidenceRefs: ["review:session"]
      });

      const intact = f.service.reviewInterventionIntegrity(trial.id);
      expect(intact.captureIntegrityValid).toBe(true);
      expect(intact.interventionSetMatchesCapture).toBe(true);
      expect(intact.interventionValidById.get(record.id)).toBe(true);
      expect(calculateEvaluationTrialMetrics({
        trial,
        runs: f.repository.requirementSuiteRuns,
        evidence: f.repository.executionEvidence,
        conformanceResults: f.repository.conformanceResults,
        scenarios: f.repository.businessScenarios,
        executableCases: f.repository.executableCases,
        interventions: f.repository.interventionRecords,
        interventionIntegrityValidById: intact.interventionValidById,
        interventionCaptureIntegrityValid: intact.captureIntegrityValid
      }).autonomy).toMatchObject({ status: "measured", manualScenarioIds: [] });

      record.authenticationPhase = "session-recovery";
      const changedAuthenticationPhase = f.service.reviewInterventionIntegrity(trial.id);
      expect(changedAuthenticationPhase.interventionValidById.get(record.id)).toBe(false);
      record.authenticationPhase = "initial-authorization";

      record.businessScenarioIds = ["scenario2"];
      const changedRecord = f.service.reviewInterventionIntegrity(trial.id);
      expect(changedRecord.interventionValidById.get(record.id)).toBe(false);
      expect(calculateEvaluationTrialMetrics({
        trial,
        runs: f.repository.requirementSuiteRuns,
        evidence: f.repository.executionEvidence,
        conformanceResults: f.repository.conformanceResults,
        scenarios: f.repository.businessScenarios,
        executableCases: f.repository.executableCases,
        interventions: f.repository.interventionRecords,
        interventionIntegrityValidById: changedRecord.interventionValidById,
        interventionCaptureIntegrityValid: changedRecord.captureIntegrityValid
      }).autonomy).toMatchObject({
        status: "not-measured",
        reason: "An intervention record integrity could not be verified."
      });

      trial.interventionCapture!.actor = "forged-reviewer";
      const changedCapture = f.service.reviewInterventionIntegrity(trial.id);
      expect(changedCapture.captureIntegrityValid).toBe(false);
      expect(calculateEvaluationTrialMetrics({
        trial,
        runs: f.repository.requirementSuiteRuns,
        evidence: f.repository.executionEvidence,
        conformanceResults: f.repository.conformanceResults,
        scenarios: f.repository.businessScenarios,
        executableCases: f.repository.executableCases,
        interventions: f.repository.interventionRecords,
        interventionIntegrityValidById: changedCapture.interventionValidById,
        interventionCaptureIntegrityValid: changedCapture.captureIntegrityValid
      }).autonomy).toMatchObject({
        status: "not-measured",
        reason: "Intervention capture integrity could not be verified."
      });
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });
  it("keeps autonomy unmeasured if an intervention is deleted after capture", () => {
    const f = measuredFixture();
    f.service.recordIntervention({
      trialId: f.trial.id,
      category: "user-clarification",
      actor: "user",
      note: "Clarified the requested state",
      evidenceRefs: ["run-ledger:clarification"],
      businessScenarioIds: ["scenario1"]
    });
    f.service.completeTrial(f.trial.id, "commit", {}, "test-build");
    f.service.completeInterventionCapture({
      trialId: f.trial.id,
      actor: "reviewer",
      scenarioIds: ["scenario1", "scenario2", "scenario3"],
      evidenceRefs: ["review:session"]
    });
    f.repository.interventionRecords.splice(0, 1);

    expect(f.metrics().autonomy).toMatchObject({
      status: "not-measured",
      reason: "An intervention is missing from the captured Trial record set."
    });
  });
  it("rejects intervention attribution outside the frozen Trial scenarios", () => {
    const f = measuredFixture();
    expect(() => f.service.recordIntervention({
      trialId: f.trial.id,
      category: "user-clarification",
      actor: "user",
      note: "Out-of-scope intervention",
      evidenceRefs: ["run-ledger:out-of-scope"],
      businessScenarioIds: ["scenario-outside-scope"]
    })).toThrow("outside the frozen Trial scope");
  });
  it("requires evidence references for intervention records", () => {
    const f = measuredFixture();
    expect(() => f.service.recordIntervention({
      trialId: f.trial.id,
      category: "user-clarification",
      actor: "user",
      note: "Unreferenced intervention",
      evidenceRefs: [],
      businessScenarioIds: ["scenario1"]
    })).toThrow("require evidence references");
  });
  it.each(["synthetic", "unknown", undefined] as const)("does not measure %s provenance", (provenance) => {
    const f = measuredFixture(); f.evidence.provenance = provenance;
    expect(f.metrics().businessConformance).toMatchObject({ status: "not-measured", rate: null, syntheticOrUnknown: 1 });
  });
  it.each(["systemId", "knowledgeProjectId", "executableCaseId", "requirementSuiteRunId", "createdAt"] as const)("rejects foreign or old evidence %s", (key) => {
    const f = measuredFixture(); f.evidence[key] = key === "createdAt" ? "2000-01-01T00:00:00.000Z" : "foreign";
    expect(f.metrics().businessConformance.measured).toBe(0);
  });
  it.each(["systemId", "knowledgeProjectId", "evaluationTrialId", "evaluationSourceHash"] as const)("rejects a foreign linked run %s", (key) => {
    const f = measuredFixture(); f.run[key] = "foreign";
    expect(f.metrics().businessConformance.measured).toBe(0);
  });
  it.each(["queued", "blocked", "cancelled", "waiting-for-agent"] as const)("latest %s without evidence supersedes old success including ties", (status) => {
    const f = measuredFixture();
    const next = structuredClone(f.run); next.id = "next";
    next.caseRuns[0].status = status; next.caseRuns[0].executionEvidenceId = undefined;
    f.repository.requirementSuiteRuns.push(next);
    expect(f.metrics().businessConformance).toMatchObject({ measured: 0, rate: null });
  });
  it("deduplicates attempts and fails closed on ambiguous mapping or contradicted oracles", () => {
    const f = measuredFixture();
    f.repository.requirementSuiteRuns.push(structuredClone(f.run));
    expect(f.metrics().businessConformance.passed).toBe(1);
    f.evidence.reporterResult!.assertions[0].actual = "rejected";
    expect(f.metrics().businessConformance.measured).toBe(0);
    f.evidence.reporterResult!.assertions[0].actual = "approved";
    f.repository.businessScenarios[1].testIntentIds = ["intent1"];
    expect(f.metrics().businessConformance.measured).toBe(0);
  });
  it("returns no invented rates for legacy scope or invalidated trials", () => {
    const f = measuredFixture(); f.trial.executionScope = undefined;
    expect(f.metrics().businessConformance).toMatchObject({ status: "not-comparable", denominator: null, rate: null });
    const invalidated = measuredFixture();
    invalidated.trial.status = "invalidated";
    expect(invalidated.metrics().businessConformance).toMatchObject({
      status: "not-comparable", denominator: 3, measured: null, passed: null, rate: null
    });
    expect(invalidated.metrics().autonomy).toMatchObject({ status: "not-measured", denominator: 3 });
  });
  it("retains the frozen denominator when a selected scenario definition is unavailable", () => {
    const f = measuredFixture();
    f.trial.executionScope!.businessScenarioIds = ["scenario1", "missing-scenario", "scenario3"];

    expect(f.metrics().businessConformance).toMatchObject({
      status: "not-comparable", denominator: 3, measured: null, passed: null, rate: null
    });
    expect(f.metrics().autonomy).toMatchObject({
      status: "not-measured", denominator: 3, autonomousScenarios: null, rate: null
    });
  });
  it("does not pass a multi-intent scenario while one required case is blocked", () => {
    const f = measuredFixture();
    f.repository.businessScenarios[0].testIntentIds!.push("intent2");
    f.repository.businessScenarios[1].testIntentIds = [];
    expect(f.metrics().businessConformance).toMatchObject({ measured: 0, passed: 0, blocked: 1, rate: null });
  });
  it("passes a multi-intent scenario only when every uniquely mapped case conforms", () => {
    const f = measuredFixture();
    f.repository.businessScenarios[0].testIntentIds!.push("intent2");
    f.repository.businessScenarios[1].testIntentIds = [];
    const secondCaseRun = f.run.caseRuns[1];
    secondCaseRun.status = "passed";
    secondCaseRun.executionEvidenceId = "e2";
    secondCaseRun.completedAt = f.run.updatedAt;
    f.run.status = "completed";
    f.run.completedAt = f.run.updatedAt;
    f.run.passed = 2;
    f.run.blocked = 0;
    f.repository.executionEvidence.push({ ...structuredClone(f.evidence), id: "e2", executableCaseId: "case2" });
    f.repository.conformanceResults.push({
      ...structuredClone(f.repository.conformanceResults[0]), id: "c2", executionEvidenceId: "e2", executionRefs: ["e2"], scenarioId: "scenario1"
    });

    expect(f.metrics().businessConformance).toMatchObject({
      denominator: 3, measured: 1, passed: 1, notRun: 2, rate: 1 / 3
    });
  });
  it("does not reuse historical suites and preserves binding on repeats", () => {
    const f = trialFixture(); const runs = new RequirementSuiteRunService(f.repository, undefined, "test-build");
    const input = { knowledgeProjectId: "p", systemId: "s", cases: [{ executableCaseId: "case1", title: "C" }], continueOnBlocked: true };
    const old = runs.create(input); const trial = f.start();
    const run = runs.create({ ...input, evaluationTrialId: trial.id, stabilityTarget: 2 });
    expect(run.id).not.toBe(old.id);
    runs.beginNext(run.id); runs.completeCase(run.id, "case1", { status: "passed", gapIds: [] });
    expect(runs.get(run.stabilityNextRunId!).evaluationTrialId).toBe(trial.id);
  });
  it("rejects scheduled Trial claims after the frozen execution binding is invalidated", () => {
    const f = trialFixture();
    const trial = f.start();
    const runs = new RequirementSuiteRunService(f.repository, undefined, "test-build");
    const run = runs.create({
      knowledgeProjectId: "p", systemId: "s", evaluationTrialId: trial.id,
      cases: [{ executableCaseId: "case1", title: "Approve" }], continueOnBlocked: true,
      stabilityTarget: 2, stabilityPolicy: { targetIterations: 2 }
    });
    f.service.recordIntervention({
      trialId: trial.id, category: "manual-store-write", actor: "test",
      note: "Invalidate the frozen Trial before scheduling", evidenceRefs: ["audit:manual-store-write"]
    });

    expect(() => runs.claimScheduled(run.id, { owner: "runner" })).toThrow("not active: invalidated");
  });
});
