import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import type { BusinessScenario, EvaluationTrial } from "../brain/types.js";
import type { ExecutableCase, ExecutionEvidence, ExecutionPlan, RequirementSuiteRun } from "../domain/types.js";
import { createWorkspaceIntegrityAuthenticator } from "../shared/crypto.js";
import { createExecutionEvidenceSnapshotHash, hasValidExecutionEvidenceSnapshot } from "../execution/evidenceSnapshot.js";
import { reevaluateHistoricalEvidence } from "./historicalEvidenceReevaluation.js";

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))); });

it("re-evaluates complete legacy artifacts, preserves the old conformance record, and pins a reviewed snapshot", async () => {
  const fixture = await historicalFixture();
  const reviewed = await reevaluateHistoricalEvidence({ ...fixture.input, authenticator: fixture.authenticator });

  expect(reviewed.conformance.verdict).toBe("conform");
  expect(reviewed.conformance.historicalReviewId).toBe(reviewed.evidence.historicalReevaluation?.id);
  expect(reviewed.evidence.artifactValidation).toMatchObject({ status: "valid", files: expect.arrayContaining([
    expect.objectContaining({ path: "actual.json", sha256: expect.stringMatching(/^[a-f0-9]{64}$/) })
  ]) });
  expect(reviewed.evidence.historicalReevaluation).toEqual(expect.objectContaining({
    reviewer: "reviewer@example.test",
    note: "Verified the archived Reporter output against the pinned Oracle",
    previousConformanceResultId: "conformance:legacy"
  }));
  expect(reviewed.evidence.semanticSnapshotHash).toBeTruthy();
  expect(hasValidExecutionEvidenceSnapshot(reviewed.evidence, reviewed.conformance, fixture.authenticator)).toBe(true);
  reviewed.evidence.historicalReevaluation!.note = "Unreviewed edit";
  expect(hasValidExecutionEvidenceSnapshot(reviewed.evidence, reviewed.conformance, fixture.authenticator)).toBe(false);
}
);

it("rejects a Reporter artifact that does not match the stored structured result", async () => {
  const fixture = await historicalFixture();
  await writeFile(join(fixture.root, "reporter.json"), JSON.stringify({ status: "failed" }), "utf8");

  await expect(reevaluateHistoricalEvidence({ ...fixture.input, authenticator: fixture.authenticator }))
    .rejects.toThrow("does not match the stored structured Reporter result");
});

it("re-evaluates a legacy snapshot that fails the current integrity signature", async () => {
  const fixture = await historicalFixture();
  fixture.input.evidence.semanticSnapshotHash = "v1:legacy:invalid";

  const reviewed = await reevaluateHistoricalEvidence({ ...fixture.input, authenticator: fixture.authenticator });

  expect(reviewed.conformance.verdict).toBe("conform");
  expect(reviewed.evidence.historicalReevaluation?.previousConformanceResultId).toBe("conformance:legacy");
  expect(hasValidExecutionEvidenceSnapshot(reviewed.evidence, reviewed.conformance, fixture.authenticator)).toBe(true);
});

it("does not re-evaluate evidence with a snapshot that still passes integrity validation", async () => {
  const fixture = await historicalFixture();
  fixture.input.evidence.semanticSnapshotHash = createExecutionEvidenceSnapshotHash(
    fixture.input.evidence,
    fixture.input.previousConformance,
    fixture.authenticator
  );

  await expect(reevaluateHistoricalEvidence({ ...fixture.input, authenticator: fixture.authenticator }))
    .rejects.toThrow("Historical evidence with a valid semantic snapshot does not require re-evaluation");
});

it("rejects incomplete or unavailable historical artifacts without creating a snapshot", async () => {
  const fixture = await historicalFixture();
  await rm(join(fixture.root, "actual.json"));

  await expect(reevaluateHistoricalEvidence({ ...fixture.input, authenticator: fixture.authenticator }))
    .rejects.toThrow("Historical execution artifacts are incomplete or invalid");
});

it("rejects historical evidence whose run no longer matches the frozen Trial", async () => {
  const fixture = await historicalFixture();
  fixture.input.run.evaluationSourceHash = "changed-source-hash";

  await expect(reevaluateHistoricalEvidence({ ...fixture.input, authenticator: fixture.authenticator }))
    .rejects.toThrow("Historical evidence suite run is not bound to the frozen Trial");
});

it("rejects a case-run payload that is not the uniquely linked record inside the supplied suite run", async () => {
  const fixture = await historicalFixture();
  fixture.input.caseRun = structuredClone(fixture.input.caseRun);
  fixture.input.caseRun.order = 2;

  await expect(reevaluateHistoricalEvidence({ ...fixture.input, authenticator: fixture.authenticator }))
    .rejects.toThrow("Historical evidence case run is not uniquely bound to the completed suite run");

  const duplicateFixture = await historicalFixture();
  duplicateFixture.input.run.caseRuns.push({ ...structuredClone(duplicateFixture.input.run.caseRuns[0]!), order: 2 });
  await expect(reevaluateHistoricalEvidence({ ...duplicateFixture.input, authenticator: duplicateFixture.authenticator }))
    .rejects.toThrow("Historical evidence case run is not uniquely bound to the completed suite run");
});

it("rejects conflicting plan references across evidence and suite-case bindings", async () => {
  const fixture = await historicalFixture();
  fixture.input.evidence.executionPlanId = "plan-other";

  await expect(reevaluateHistoricalEvidence({ ...fixture.input, authenticator: fixture.authenticator }))
    .rejects.toThrow("Historical evidence is not bound to a complete immutable execution plan");
});

it("rejects historical evidence steps that differ from the immutable execution plan", async () => {
  const fixture = await historicalFixture();
  fixture.input.evidence.steps = [{
    stepId: "foreign-step",
    order: 1,
    action: "click",
    instruction: "Submit a different request",
    targetSemantic: "submit",
    assertionStatus: "passed",
    sourceRefs: ["requirement:approval"],
    origin: "source"
  }];

  await expect(reevaluateHistoricalEvidence({ ...fixture.input, authenticator: fixture.authenticator }))
    .rejects.toThrow("Historical execution steps do not match the immutable execution plan");
});

it("requires every planned assertion step to have exactly one immutable contract", async () => {
  const fixture = await historicalFixture();
  fixture.input.plan.steps.push({ ...fixture.input.plan.steps[0]!, id: "step-uncontracted" });

  await expect(reevaluateHistoricalEvidence({ ...fixture.input, authenticator: fixture.authenticator }))
    .rejects.toThrow("Historical assertion contracts do not bind every planned assertion step exactly once");
});

it("requires structured Reporter steps to cover the exact planned step IDs", async () => {
  const fixture = await historicalFixture();
  fixture.input.evidence.reporterResult!.steps![0]!.id = "foreign-step";

  await expect(reevaluateHistoricalEvidence({ ...fixture.input, authenticator: fixture.authenticator }))
    .rejects.toThrow("Historical Reporter steps do not match the immutable execution plan");
});

it("rejects a previous Conformance result from another evidence or scenario", async () => {
  const otherEvidence = await historicalFixture();
  otherEvidence.input.previousConformance!.executionEvidenceId = "evidence-other";
  await expect(reevaluateHistoricalEvidence({ ...otherEvidence.input, authenticator: otherEvidence.authenticator }))
    .rejects.toThrow("Previous Conformance result does not match the historical evidence and scenario");

  const otherScenario = await historicalFixture();
  otherScenario.input.previousConformance!.scenarioId = "scenario-other";
  await expect(reevaluateHistoricalEvidence({ ...otherScenario.input, authenticator: otherScenario.authenticator }))
    .rejects.toThrow("Previous Conformance result does not match the historical evidence and scenario");
});

it("rejects source-record changes during historical evidence re-evaluation", async () => {
  const fixture = await historicalFixture();
  const authenticator = {
    sign(payload: string) {
      fixture.input.run.updatedAt = "2026-10-02T00:00:00.000Z";
      return fixture.authenticator.sign(payload);
    },
    verify: (payload: string, tag: string) => fixture.authenticator.verify(payload, tag)
  };

  await expect(reevaluateHistoricalEvidence({ ...fixture.input, authenticator }))
    .rejects.toThrow("Historical evidence inputs changed while re-evaluation was running");
});

it("rejects synthetic evidence and invalid immutable plan hashes", async () => {
  const syntheticFixture = await historicalFixture();
  syntheticFixture.input.evidence.provenance = "synthetic";
  await expect(reevaluateHistoricalEvidence({ ...syntheticFixture.input, authenticator: syntheticFixture.authenticator }))
    .rejects.toThrow("Only completed real-system evidence can be re-evaluated");

  const stalePlanFixture = await historicalFixture();
  stalePlanFixture.input.plan.snapshotHash = "not-a-plan-hash";
  await expect(reevaluateHistoricalEvidence({ ...stalePlanFixture.input, authenticator: stalePlanFixture.authenticator }))
    .rejects.toThrow("Historical evidence is not bound to a complete immutable execution plan");
});

async function historicalFixture() {
  const root = await mkdtemp(join(tmpdir(), "bc-historical-evidence-"));
  directories.push(root);
  const contract = {
    id: "assert-approval",
    stepId: "step-approval",
    type: "state" as const,
    strength: "strong" as const,
    expected: "approved",
    requirementRefs: ["requirement:approval"],
    evidenceRequirements: ["actual-value" as const],
    oracle: {
      operator: "equals" as const,
      expected: "approved",
      applicability: { mode: "unconditional" as const },
      applicabilityRefs: ["requirement:approval"]
    }
  };
  const reporter = {
    status: "passed" as const,
    total: 1,
    passed: 1,
    failed: 0,
    skipped: 0,
    durationMs: 5,
    assertions: [{
      id: contract.id,
      stepId: contract.stepId,
      status: "passed" as const,
      actual: "approved",
      expected: "approved",
      evidenceRefs: ["actual.json"]
    }],
    steps: [{
      id: "step-approval",
      title: "Verify approval",
      status: "passed" as const,
      evidenceRefs: ["actual.json"]
    }],
    attachments: ["actual.json"],
    consoleErrors: [],
    networkFailures: []
  };
  await writeFile(join(root, "actual.json"), JSON.stringify({ status: "approved" }), "utf8");
  await writeFile(join(root, "reporter.json"), JSON.stringify(reporter), "utf8");
  const trial: EvaluationTrial = {
    id: "trial-history",
    comparisonGroupId: "group-history",
    knowledgeProjectId: "project-history",
    systemId: "system-history",
    requirementSourceId: "source-history",
    sourceSnapshotId: "snapshot-history",
    sourceRevision: 3,
    sourceHash: "source-hash",
    requirementSetId: "set-history",
    provider: "codex",
    workspacePath: root,
    storePath: join(root, "store"),
    codeRevision: "revision-history",
    runtimeVersions: { node: "22" },
    runtimeBuildIdentity: "build-history",
    executionScope: { businessScenarioIds: ["scenario-history"], scopeHash: "frozen-scope" },
    latestProjectionManifestId: "manifest-history",
    status: "completed",
    invalidationReasons: [],
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
    completedAt: "2026-10-01T00:10:00.000Z"
  };
  const run: RequirementSuiteRun = {
    id: "run-history",
    knowledgeProjectId: trial.knowledgeProjectId,
    systemId: trial.systemId!,
    evaluationTrialId: trial.id,
    evaluationSourceRevision: trial.sourceRevision,
    evaluationSourceHash: trial.sourceHash,
    evaluationRuntimeBuildIdentity: trial.runtimeBuildIdentity,
    requirementSetIds: [trial.requirementSetId!],
    status: "completed",
    continueOnBlocked: false,
    allowCreateTestData: false,
    total: 1,
    passed: 1,
    failed: 0,
    blocked: 0,
    skipped: 0,
    cancelled: 0,
    caseRuns: [{
      executableCaseId: "case-history",
      executionPlanId: "plan-history",
      title: "Approve",
      order: 1,
      status: "passed",
      executionEvidenceId: "evidence-history",
      gapIds: [],
      attempts: [],
      completedAt: "2026-10-01T00:02:00.000Z"
    }],
    createdAt: "2026-10-01T00:01:00.000Z",
    updatedAt: "2026-10-01T00:03:00.000Z",
    completedAt: "2026-10-01T00:03:00.000Z"
  };
  const executableCase: ExecutableCase = {
    id: "case-history",
    knowledgeProjectId: trial.knowledgeProjectId,
    requirementSetId: trial.requirementSetId!,
    testIntentId: "intent-history",
    systemId: trial.systemId,
    title: "Approve",
    status: "ready",
    preconditions: [],
    steps: [{
      id: "step-approval",
      order: 1,
      action: "assert",
      instruction: "Verify approval",
      targetSemantic: "request status",
      expected: "approved",
      sourceRefs: ["requirement:approval"],
      origin: "source"
    }],
    dataProfileIds: [],
    gapIds: [],
    createdAt: trial.createdAt,
    updatedAt: trial.updatedAt
  };
  const plan = {
    id: "plan-history",
    knowledgeProjectId: trial.knowledgeProjectId,
    requirementSetId: trial.requirementSetId!,
    systemId: trial.systemId!,
    executableCaseId: executableCase.id,
    title: executableCase.title,
    preconditions: [],
    steps: [{
      id: "step-approval",
      order: 1,
      action: "assert",
      instruction: "Verify approval",
      targetSemantic: "request status",
      expected: "approved",
      sourceRefs: ["requirement:approval"],
      origin: "source"
    }],
    assertionContracts: [contract],
    dataBindings: [],
    contextPack: { references: [], summary: "", content: "", estimatedChars: 0, truncated: false, purpose: "testexecution", taskId: "task-history" },
    checks: [],
    verdict: "ready" as const,
    blockers: [],
    sourceRefs: ["requirement:approval"],
    integrity: { assertionContractHash: createHash("sha256").update(stableStringify([contract])).digest("hex") },
    snapshotHash: "a".repeat(64),
    generatedAt: "2026-10-01T00:01:00.000Z",
    confirmedAt: "2026-10-01T00:01:00.000Z"
  } as unknown as ExecutionPlan;
  const scenario: BusinessScenario = {
    id: "scenario-history",
    knowledgeProjectId: trial.knowledgeProjectId,
    requirementSetId: trial.requirementSetId!,
    title: "Approve",
    objective: "Approve one request",
    family: "main-flow",
    actors: ["reviewer"],
    preconditions: [],
    workflowRefs: ["workflow:approval"],
    stateTransitionRefs: [],
    decisionRuleRefs: [],
    testDataNeeds: [],
    expectedBusinessOutcomes: ["approved"],
    sourceRefs: ["requirement:approval"],
    testIntentIds: [executableCase.testIntentId],
    risk: "low",
    status: "approved"
  };
  const evidence: ExecutionEvidence = {
    id: "evidence-history",
    knowledgeProjectId: trial.knowledgeProjectId,
    systemId: trial.systemId!,
    executableCaseId: executableCase.id,
    executionPlanId: plan.id,
    testCaseId: "test-history",
    contextPackPath: "",
    status: "passed",
    provenance: "real-system",
    assuranceLevel: "limited",
    assertionContracts: [contract],
    reporterPath: "reporter.json",
    reporterResult: reporter,
    steps: [{
      stepId: "step-approval",
      order: 1,
      action: "assert",
      instruction: "Verify approval",
      targetSemantic: "request status",
      expected: "approved",
      assertionStatus: "passed",
      sourceRefs: ["requirement:approval"],
      origin: "source"
    }],
    tracePaths: [],
    artifactPaths: ["actual.json"],
    consoleErrors: [],
    networkFailures: [],
    createdAt: "2026-10-01T00:01:30.000Z",
    completedAt: "2026-10-01T00:02:00.000Z"
  };
  const authenticator = createWorkspaceIntegrityAuthenticator(root);
  return {
    root,
    authenticator,
    input: {
      root,
      trial,
      trialValidationReasons: [],
      run,
      caseRun: run.caseRuns[0],
      plan,
      planValidationReasons: [],
      executableCase,
      scenario,
      evidence,
      previousConformance: {
        id: "conformance:legacy",
        scenarioId: scenario.id,
        executionEvidenceId: evidence.id,
        verdict: "inconclusive" as const,
        expectationRefs: ["requirement:approval"],
        observationRefs: [],
        executionRefs: [evidence.id],
        reasons: ["Legacy evidence was not fully validated"],
        createdAt: evidence.createdAt
      },
      reviewer: "reviewer@example.test",
      note: "Verified the archived Reporter output against the pinned Oracle",
      reviewedAt: "2026-10-02T00:00:00.000Z"
    }
  };
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>).filter(([, item]) => item !== undefined).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}
