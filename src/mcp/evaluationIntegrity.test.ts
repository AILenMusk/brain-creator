// @vitest-environment node

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BusinessScenario, EvaluationTrial } from "../brain/types.js";
import type { ExecutableCase, ExecutionEvidence, ExecutionPlan, RequirementSuiteRun, TestIntent } from "../domain/types.js";
import { readRuntimeIdentity } from "../shared/runtimeIdentity.js";
import { createBrainCreatorMcpContext, handleBrainCreatorTool } from "./handlers.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("evaluation integrity facade", () => {
  it("returns the fixed outcome denominator through the Brain Creator review facade", async () => {
    const workDir = await mkdtemp(join(tmpdir(), "brain-creator-outcome-review-"));
    tempDirs.push(workDir);
    const context = createBrainCreatorMcpContext({ workDir, dataFilePath: join(workDir, "assets.json") });
    const project = await context.knowledgeService.createProject({
      name: "Outcome review", key: "outcome-review", defaultLocale: "en-US"
    });
    const ingested = await context.knowledgeService.ingestRequirement({
      projectId: project.id,
      contentPackage: {
        title: "Demand outcome", content: "A demand can be submitted.",
        blocks: [{ type: "paragraph", text: "A demand can be submitted." }],
        attachments: [], source: "requirements/demand.md", sourceType: "local-file",
        contentHash: "demand-v1", warnings: []
      }
    });
    const now = new Date().toISOString();
    const set = context.repository.requirementSets.find((item) => item.id === ingested.requirementSet.id)!;
    set.status = "approved";
    context.repository.systemProfiles.push({
      id: "system-outcome", name: "Outcome target", environment: "test", baseUrl: "https://example.test",
      urlAllowlist: ["https://example.test"], defaultLocale: "en-US", status: "succeeded", createdAt: now, updatedAt: now
    });
    project.systemIds.push("system-outcome");
    context.repository.systemBrainSnapshots.push({
      id: "snapshot-outcome", knowledgeProjectId: project.id, systemId: "system-outcome", revision: 1,
      explorationIds: ["exploration-outcome"], status: "confirmed", assets: [], contentHash: "snapshot-hash",
      createdAt: now, confirmedAt: now, confirmedBy: "reviewer"
    });
    const intent: TestIntent = {
      id: "intent-outcome", knowledgeProjectId: project.id, requirementSetId: set.id,
      businessOutcomeId: "GHR-REQ-01", title: "Demand submission", module: "Demand", priority: "P1",
      objective: "Verify one fixed business outcome", preconditions: ["An isolated demand is ready"],
      expectedResults: ["The same demand becomes independently readable"], requirementRefs: ["requirement:demand"],
      knowledgeNodeRefs: [], techniques: [], scenarioIds: ["scenario-outcome"], status: "approved",
      createdAt: now, updatedAt: now
    };
    const scenario: BusinessScenario = {
      id: "scenario-outcome", knowledgeProjectId: project.id, requirementSetId: set.id,
      title: "Demand outcome", objective: "Review one demand transition", family: "state-transition",
      actors: ["Authorized test actor"], preconditions: ["The demand is in the expected initial state"],
      workflowRefs: [], stateTransitionRefs: [], decisionRuleRefs: [], testDataNeeds: ["One isolated demand"],
      expectedBusinessOutcomes: ["The same demand has the target state"], sourceRefs: ["requirement:demand"],
      testIntentIds: [intent.id], risk: "high", status: "approved"
    };
    context.repository.testIntents.push(intent);
    context.repository.businessScenarios.push(scenario);
    context.repository.scenarioAssuranceContracts.push({
      scenarioId: scenario.id, systemId: "system-outcome", systemBrainSnapshotId: "snapshot-outcome",
      requirementRefs: ["requirement:demand"], workflowRefs: [], stateTransitionRefs: ["demand:draft-submitted"],
      decisionRuleRefs: [], systemBinding: "unique", testDataReadiness: "ready", oracleStrength: "strong",
      unsupportedInferences: [], risk: "high", independence: "deterministic", verdict: "pass",
      evidenceRefs: ["system-brain:snapshot-outcome"]
    });
    const challenge = context.requirementGate.issueApprovalChallenge(set.id);
    const receipt = context.requirementGate.createApprovalReceipt({
      requirementSetId: set.id, assetHash: challenge.assetHash, method: "challenge-response",
      approvedBy: "reviewer", challengeId: challenge.challengeId, approvalCode: challenge.code
    });
    const runtimeIdentity = readRuntimeIdentity({
      workspace: workDir, schemaVersion: context.repository.schemaVersion, provider: "disabled", processKind: "mcp"
    });
    const codeRevision = runtimeIdentity.commit === "unknown" ? runtimeIdentity.buildId : runtimeIdentity.commit;
    const started = dataOf(await handleBrainCreatorTool(context, "bc_prepare", {
      action: "start-evaluation-trial", knowledgeProjectId: project.id, systemId: "system-outcome",
      requirementSourceId: ingested.source.id, comparisonGroupId: "outcome-review",
      evaluationProvider: "builtin", evaluationWorkspacePath: join(workDir, "trial"),
      evaluationStorePath: join(workDir, "trial", ".brain-creator", "store"), codeRevision,
      runtimeVersions: { node: "22.0.0" }, businessScenarioIds: [scenario.id],
      businessOutcomeIds: ["GHR-REQ-01"], approvalReceiptId: receipt.id
    })) as { trial: { id: string } };
    const review = dataOf(await handleBrainCreatorTool(context, "bc_review", {
      target: "evaluation-trial", knowledgeProjectId: project.id, id: started.trial.id
    })) as { items: Array<{ metrics: {
      businessOutcomeIds: string[];
      businessOutcomeConformance: { status: string; denominator: number | null; notRun: number | null; rate: number | null };
      autonomy: { businessOutcomes: { status: string; denominator: number | null; rate: number | null } };
    } }> };

    expect(review.items[0]!.metrics.businessOutcomeIds).toEqual(["GHR-REQ-01"]);
    expect(review.items[0]!.metrics.businessOutcomeConformance).toMatchObject({
      status: "not-measured", denominator: 1, notRun: 1, rate: null
    });
    expect(review.items[0]!.metrics.autonomy.businessOutcomes).toMatchObject({
      status: "not-measured", denominator: 1, rate: null
    });
  });

  it("starts, reviews, validates, and completes an evaluation trial", async () => {
    const workDir = await mkdtemp(join(tmpdir(), "brain-creator-evaluation-"));
    tempDirs.push(workDir);
    const context = createBrainCreatorMcpContext({
      workDir,
      dataFilePath: join(workDir, "assets.json")
    });
    const project = await context.knowledgeService.createProject({
      name: "Evaluation",
      key: "evaluation",
      defaultLocale: "en-US"
    });
    const ingested = await context.knowledgeService.ingestRequirement({
      projectId: project.id,
      contentPackage: {
        title: "Order approval",
        content: "A requester submits an order for approval.",
        blocks: [{ type: "paragraph", text: "A requester submits an order for approval." }],
        attachments: [],
        source: "requirements/order.md",
        sourceType: "local-file",
        contentHash: "order-v1",
        warnings: []
      }
    });

    const runtimeIdentity = readRuntimeIdentity({
      workspace: workDir,
      schemaVersion: context.repository.schemaVersion,
      provider: "disabled",
      processKind: "mcp"
    });
    const codeRevision = runtimeIdentity.commit === "unknown" ? runtimeIdentity.buildId : runtimeIdentity.commit;
    const mismatchedRevision = await handleBrainCreatorTool(context, "bc_prepare", {
      action: "start-evaluation-trial",
      knowledgeProjectId: project.id,
      requirementSourceId: ingested.source.id,
      comparisonGroupId: "order-ab-mismatch",
      evaluationProvider: "host-agent",
      evaluationWorkspacePath: join(workDir, "host-mismatch"),
      evaluationStorePath: join(workDir, "host-mismatch", ".brain-creator", "store"),
      codeRevision: "caller-supplied-revision",
      runtimeVersions: { node: "22.0.0" }
    });
    expect(JSON.stringify(mismatchedRevision)).toContain("codeRevision must match the running process build identity");
    expect(context.repository.evaluationTrials).toHaveLength(0);

    const started = dataOf(await handleBrainCreatorTool(context, "bc_prepare", {
      action: "start-evaluation-trial",
      knowledgeProjectId: project.id,
      requirementSourceId: ingested.source.id,
      comparisonGroupId: "order-ab",
      evaluationProvider: "host-agent",
      evaluationWorkspacePath: join(workDir, "host"),
      evaluationStorePath: join(workDir, "host", ".brain-creator", "store"),
      codeRevision,
      runtimeVersions: { node: "22.0.0" }
    })) as { trial: { id: string; status: string } };
    expect(started.trial.status).toBe("active");
    expect(context.repository.evaluationTrials[0].codeRevision).toBe(codeRevision);

    const status = dataOf(await handleBrainCreatorTool(context, "bc_status", {
      knowledgeProjectId: project.id
    })) as { evaluationIntegrity: { active: number; invalidated: number } };
    expect(status.evaluationIntegrity).toEqual(expect.objectContaining({ active: 1, invalidated: 0 }));

    const review = dataOf(await handleBrainCreatorTool(context, "bc_review", {
      target: "evaluation-trial",
      knowledgeProjectId: project.id,
      id: started.trial.id
    })) as {
      summary: { total: number };
      items: Array<{
        sourceSnapshot: unknown;
        projectionManifests: unknown[];
        interventionIntegrity: { capture: string; recordSetMatchesCapture: boolean };
      }>;
    };
    expect(review.summary.total).toBe(1);
    expect(review.items[0].sourceSnapshot).toBeDefined();
    expect(review.items[0].projectionManifests).toHaveLength(1);
    expect(review.items[0].interventionIntegrity).toEqual({
      capture: "missing",
      recordSetMatchesCapture: false,
      unrecordedInterventionSourceRefs: [],
      records: []
    });

    const completed = dataOf(await handleBrainCreatorTool(context, "bc_prepare", {
      action: "complete-evaluation-trial",
      evaluationTrialId: started.trial.id,
      codeRevision,
      runtimeVersions: { node: "22.0.0" }
    })) as { status: string };
    expect(completed.status).toBe("completed");

    const storedTrial = context.repository.evaluationTrials.find((item) => item.id === started.trial.id)!;
    storedTrial.executionScope = {
      businessScenarioIds: ["scenario-a", "scenario-b"],
      baselineHash: "baseline-hash",
      scopeHash: "scope-hash"
    };
    const runCreatedAt = new Date(Date.parse(storedTrial.createdAt) + 1000).toISOString();
    const runCompletedAt = new Date(Date.parse(runCreatedAt) + 1000).toISOString();
    const linkedRun: RequirementSuiteRun = {
      id: "trial-linked-run", knowledgeProjectId: project.id, systemId: storedTrial.systemId ?? "system-evaluation",
      evaluationTrialId: storedTrial.id, evaluationSourceRevision: storedTrial.sourceRevision,
      evaluationSourceHash: storedTrial.sourceHash, evaluationRuntimeBuildIdentity: storedTrial.runtimeBuildIdentity,
      ...(storedTrial.requirementSetId ? { requirementSetIds: [storedTrial.requirementSetId] } : {}),
      status: "completed", continueOnBlocked: false, allowCreateTestData: false,
      total: 0, passed: 0, failed: 0, blocked: 0, skipped: 0, cancelled: 0, caseRuns: [],
      createdAt: runCreatedAt, updatedAt: runCompletedAt, completedAt: runCompletedAt
    };
    context.repository.requirementSuiteRuns.push(linkedRun);
    context.runLedger.append({
      knowledgeProjectId: project.id, systemId: linkedRun.systemId, requirementSuiteRunId: linkedRun.id,
      event: "suite-created", scope: "suite", stage: "suite", toStatus: "running"
    });
    context.runLedger.append({
      knowledgeProjectId: project.id, systemId: linkedRun.systemId, requirementSuiteRunId: linkedRun.id,
      event: "suite-completed", scope: "suite", stage: "suite", toStatus: "completed", outcome: "passed"
    });
    const completeRunReview = dataOf(await handleBrainCreatorTool(context, "bc_review", {
      target: "evaluation-trial", knowledgeProjectId: project.id, id: storedTrial.id
    })) as { items: Array<{ runLedgerIntegrity: Array<{ runId: string; status: string }> }> };
    expect(completeRunReview.items[0].runLedgerIntegrity).toContainEqual({ runId: linkedRun.id, status: "valid", reason: undefined });
    context.repository.runLedgerEntries.pop();
    const missingTailReview = dataOf(await handleBrainCreatorTool(context, "bc_review", {
      target: "evaluation-trial", knowledgeProjectId: project.id, id: storedTrial.id
    })) as { items: Array<{ runLedgerIntegrity: Array<{ runId: string; status: string; reason?: string }> }> };
    expect(missingTailReview.items[0].runLedgerIntegrity[0]).toMatchObject({
      runId: linkedRun.id, status: "invalid", reason: "Terminal run is missing its signed final suite-completed event."
    });
    const invalidReview = dataOf(await handleBrainCreatorTool(context, "bc_review", {
      target: "evaluation-trial",
      knowledgeProjectId: project.id,
      id: started.trial.id
    })) as {
      items: Array<{
        metrics: {
          businessConformance: { status: string; denominator: number | null; measured: number | null; rate: number | null };
          autonomy: { status: string; denominator: number | null; autonomousScenarios: number | null; rate: number | null };
          operations: {
            firstValidResult: { status: string; elapsedMs: number | null };
            recovery: { status: string; denominator: number | null; rate: number | null };
            cleanup: { status: string; denominator: number | null; rate: number | null };
          };
        };
      }>};
    expect(invalidReview.items[0].metrics).toMatchObject({
      businessConformance: { status: "not-comparable", denominator: 2, measured: null, rate: null },
      autonomy: { status: "not-measured", denominator: 2, autonomousScenarios: null, rate: null },
      operations: {
        firstValidResult: { status: "not-measured", elapsedMs: null },
        recovery: { status: "not-measured", denominator: null, rate: null },
        cleanup: { status: "not-measured", denominator: null, rate: null }
      }
    });
    storedTrial.interventionCapture = {
      scenarioIds: ["scenario-a", "scenario-b"],
      interventionIds: [],
      scopeHash: "scope-hash",
      actor: "reviewer",
      evidenceRefs: ["review:session"],
      completedAt: new Date().toISOString(),
      integrityTag: "tampered"
    };
    const tamperedReview = dataOf(await handleBrainCreatorTool(context, "bc_review", {
      target: "evaluation-trial",
      knowledgeProjectId: project.id,
      id: started.trial.id
    })) as { items: Array<{ interventionIntegrity: { capture: string } }> };
    expect(tamperedReview.items[0].interventionIntegrity.capture).toBe("invalid");

    context.evaluationIntegrity.completeInterventionCapture({
      trialId: started.trial.id,
      actor: "reviewer",
      scenarioIds: ["scenario-a", "scenario-b"],
      evidenceRefs: ["review:session"]
    });
    context.evaluationIntegrity.recordIntervention({
      trialId: started.trial.id,
      category: "user-clarification",
      actor: "user",
      note: "Clarified the scenario after the capture was completed",
      evidenceRefs: ["review:late-clarification"]
    });
    const staleReview = dataOf(await handleBrainCreatorTool(context, "bc_review", {
      target: "evaluation-trial",
      knowledgeProjectId: project.id,
      id: started.trial.id
    })) as { items: Array<{ interventionIntegrity: { capture: string; recordSetMatchesCapture: boolean } }> };
    expect(staleReview.items[0].interventionIntegrity).toMatchObject({
      capture: "stale",
      recordSetMatchesCapture: false
    });
  });

  it("records a manual intervention and surfaces the invalidated trial", async () => {
    const workDir = await mkdtemp(join(tmpdir(), "brain-creator-evaluation-"));
    tempDirs.push(workDir);
    const context = createBrainCreatorMcpContext({ workDir, dataFilePath: join(workDir, "assets.json") });
    const project = await context.knowledgeService.createProject({ name: "Eval", key: "eval", defaultLocale: "en-US" });
    const ingested = await context.knowledgeService.ingestRequirement({
      projectId: project.id,
      contentPackage: {
        title: "Requirement",
        content: "Create a record.",
        blocks: [], attachments: [], source: "requirement.md", sourceType: "local-file",
        contentHash: "hash-1", warnings: []
      }
    });
    const runtimeIdentity = readRuntimeIdentity({
      workspace: workDir,
      schemaVersion: context.repository.schemaVersion,
      provider: "disabled",
      processKind: "mcp"
    });
    const started = dataOf(await handleBrainCreatorTool(context, "bc_prepare", {
      action: "start-evaluation-trial",
      knowledgeProjectId: project.id,
      requirementSourceId: ingested.source.id,
      comparisonGroupId: "comparison",
      evaluationProvider: "builtin",
      evaluationWorkspacePath: join(workDir, "builtin"),
      evaluationStorePath: join(workDir, "builtin", "store"),
      codeRevision: runtimeIdentity.commit === "unknown" ? runtimeIdentity.buildId : runtimeIdentity.commit,
      runtimeVersions: { node: "22.0.0" }
    })) as { trial: { id: string } };

    const intervention = dataOf(await handleBrainCreatorTool(context, "bc_prepare", {
      action: "record-evaluation-intervention",
      evaluationTrialId: started.trial.id,
      interventionCategory: "manual-store-write",
      interventionActor: "host-agent",
      interventionNote: "Changed the canonical store outside the Facade",
      evidenceRefs: ["audit:manual-write"]
    })) as { invalidatesTrial: boolean };
    expect(intervention.invalidatesTrial).toBe(true);
    expect(context.repository.evaluationTrials[0].status).toBe("invalidated");
  });

  it("rejects historical evidence when a source record changes before commit", async () => {
    const workDir = await mkdtemp(join(tmpdir(), "brain-creator-historical-race-"));
    tempDirs.push(workDir);
    const context = createBrainCreatorMcpContext({ workDir, dataFilePath: join(workDir, "assets.json") });
    const contract = {
      id: "assert-approved",
      stepId: "step-approve",
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
      durationMs: 1,
      assertions: [{
        id: contract.id,
        stepId: contract.stepId,
        status: "passed" as const,
        actual: "approved",
        expected: "approved",
        evidenceRefs: ["actual.json"]
      }],
      steps: [{ id: "step-approve", title: "Verify approval", status: "passed" as const, evidenceRefs: ["actual.json"] }],
      attachments: ["actual.json"],
      consoleErrors: [],
      networkFailures: []
    };
    await writeFile(join(workDir, "actual.json"), JSON.stringify({ status: "approved" }), "utf8");
    await writeFile(join(workDir, "reporter.json"), JSON.stringify(reporter), "utf8");
    const trial: EvaluationTrial = {
      id: "trial-race",
      comparisonGroupId: "group-race",
      knowledgeProjectId: "project-race",
      systemId: "system-race",
      requirementSourceId: "source-race",
      sourceSnapshotId: "snapshot-race",
      sourceRevision: 1,
      sourceHash: "source-hash",
      requirementSetId: "set-race",
      provider: "codex",
      workspacePath: workDir,
      storePath: join(workDir, "store"),
      codeRevision: "commit-race",
      runtimeVersions: { node: "22" },
      runtimeBuildIdentity: "build-race",
      executionScope: { businessScenarioIds: ["scenario-race"], scopeHash: "scope-race" },
      latestProjectionManifestId: "manifest-race",
      status: "completed",
      invalidationReasons: [],
      createdAt: "2026-10-01T00:00:00.000Z",
      updatedAt: "2026-10-01T00:10:00.000Z",
      completedAt: "2026-10-01T00:10:00.000Z"
    };
    const executableCase: ExecutableCase = {
      id: "case-race",
      knowledgeProjectId: trial.knowledgeProjectId,
      requirementSetId: trial.requirementSetId!,
      testIntentId: "intent-race",
      systemId: trial.systemId,
      title: "Approve request",
      status: "ready",
      preconditions: [],
      steps: [{
        id: "step-approve",
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
    const scenario: BusinessScenario = {
      id: "scenario-race",
      knowledgeProjectId: trial.knowledgeProjectId,
      requirementSetId: trial.requirementSetId!,
      title: "Approval",
      objective: "Approve one request",
      family: "main-flow",
      actors: ["reviewer"],
      preconditions: [],
      workflowRefs: [],
      stateTransitionRefs: [],
      decisionRuleRefs: [],
      testDataNeeds: [],
      expectedBusinessOutcomes: ["approved"],
      sourceRefs: ["requirement:approval"],
      testIntentIds: [executableCase.testIntentId],
      risk: "low",
      status: "approved"
    };
    const plan = {
      id: "plan-race",
      knowledgeProjectId: trial.knowledgeProjectId,
      requirementSetId: trial.requirementSetId!,
      systemId: trial.systemId!,
      executableCaseId: executableCase.id,
      title: executableCase.title,
      preconditions: [],
      steps: [{
        id: "step-approve",
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
      contextPack: { knowledgeProjectId: trial.knowledgeProjectId, purpose: "generator" as const, query: "approval", references: [], content: "", estimatedChars: 0, truncated: false },
      checks: [],
      verdict: "ready",
      blockers: [],
      sourceRefs: ["requirement:approval"],
      integrity: { assertionContractHash: createHash("sha256").update(stableStringify([contract])).digest("hex") },
      snapshotHash: "a".repeat(64),
      generatedAt: "2026-10-01T00:01:00.000Z",
      confirmedAt: "2026-10-01T00:01:00.000Z"
    } as unknown as ExecutionPlan;
    const evidence: ExecutionEvidence = {
      id: "evidence-race",
      knowledgeProjectId: trial.knowledgeProjectId,
      systemId: trial.systemId!,
      executableCaseId: executableCase.id,
      requirementSuiteRunId: "run-race",
      executionPlanId: plan.id,
      testCaseId: "test-race",
      contextPackPath: "",
      status: "passed",
      provenance: "real-system",
      assuranceLevel: "limited",
      assertionContracts: [contract],
      reporterPath: "reporter.json",
      reporterResult: reporter,
      steps: [{
        stepId: "step-approve",
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
    const run: RequirementSuiteRun = {
      id: "run-race",
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
        executableCaseId: executableCase.id,
        executionPlanId: plan.id,
        title: executableCase.title,
        order: 1,
        status: "passed",
        executionEvidenceId: evidence.id,
        gapIds: [],
        attempts: [],
        completedAt: evidence.completedAt
      }],
      createdAt: "2026-10-01T00:01:00.000Z",
      updatedAt: "2026-10-01T00:03:00.000Z",
      completedAt: "2026-10-01T00:03:00.000Z"
    };
    context.repository.evaluationTrials.push(trial);
    context.repository.executableCases.push(executableCase);
    context.repository.businessScenarios.push(scenario);
    context.repository.executionPlans.push(plan);
    context.repository.executionEvidence.push(evidence);
    context.repository.requirementSuiteRuns.push(run);
    vi.spyOn(context.evaluationIntegrity, "validateTrial").mockReturnValue({ valid: true, reasons: [], trial });
    vi.spyOn(context.executionPreflight, "validatePlan").mockReturnValue({
      status: "valid", valid: true, executionPlan: plan, currentSnapshotHash: plan.snapshotHash, reasons: [], draft: {} as never
    });
    const originalTransaction = context.repository.transaction.bind(context.repository);
    let changed = false;
    context.repository.transaction = ((action: () => unknown) => {
      if (!changed) {
        scenario.objective = "Changed while the review was running";
        changed = true;
      }
      return originalTransaction(action);
    }) as typeof context.repository.transaction;

    const response = await handleBrainCreatorTool(context, "bc_prepare", {
      action: "reevaluate-legacy-execution-evidence",
      evaluationTrialId: trial.id,
      executionEvidenceId: evidence.id,
      historicalEvidenceReviewer: "reviewer@example.test",
      historicalEvidenceNote: "Review the historical evidence",
      confirm: true
    });
    const envelope = JSON.parse((response.content[0] as { text: string }).text) as {
      success: boolean;
      errors: string[];
    };

    expect(envelope.success).toBe(false);
    expect(envelope.errors.join(" ")).toContain("Historical evidence inputs changed while re-evaluation was running");
    expect(evidence.semanticSnapshotHash).toBeUndefined();
    expect(evidence.historicalReevaluation).toBeUndefined();
    expect(context.repository.conformanceResults).toHaveLength(0);
    expect(context.repository.interventionRecords).toHaveLength(0);
  });
});

function dataOf(result: { content: Array<{ type: string; text?: string }> }) {
  const text = result.content.find((item) => item.type === "text")?.text;
  if (!text) throw new Error("Expected a text response");
  return (JSON.parse(text) as { data?: unknown }).data;
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
