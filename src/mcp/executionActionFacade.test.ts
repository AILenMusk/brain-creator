import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { InMemoryBrainCreatorRepository } from "../domain/repository.js";
import { EvaluationIntegrityService } from "../evaluation/evaluationIntegrity.js";
import { RunLedgerService } from "../knowledge/runLedger.js";
import {
  createBrainCreatorMcpContext,
  handleBrainCreatorTool,
  type BrainCreatorMcpContext
} from "./handlers.js";

function contextFor(repository: InMemoryBrainCreatorRepository) {
  return {
    repository,
    runLedger: new RunLedgerService(repository)
  } as unknown as BrainCreatorMcpContext;
}

function readResult(result: Awaited<ReturnType<typeof handleBrainCreatorTool>>) {
  return JSON.parse((result.content[0] as { text: string }).text) as {
    success: boolean;
    data?: Record<string, unknown>;
    errors?: Array<{ message?: string }>;
  };
}

async function writeManualActionEvidence(
  context: BrainCreatorMcpContext,
  name: string,
  observation: {
    binding: {
      runType: "requirement-suite" | "document-suite";
      runId: string;
      evaluationTrialId?: string;
      businessScenarioId?: string;
      executableCaseId?: string;
      caseNo?: string;
      stepId?: string;
    };
    systemId: string;
    actionKey: string;
    actionSemantic: string;
    entityReference?: string;
    postcondition: string;
    operator: string;
  }
) {
  const workDir = context.workDir ?? await mkdtemp(join(tmpdir(), "bc-manual-action-evidence-"));
  context.workDir = workDir;
  const path = `manual-recovery/${name}.json`;
  const contents = JSON.stringify({
    schemaVersion: 2,
    type: "manual-execution-postcondition-observation",
    ...observation.binding,
    ...observation,
    result: "confirmed",
    actualResult: "Reviewed target system and observed the expected state",
    checkedAt: new Date().toISOString()
  });
  await mkdir(join(workDir, ".brain-creator", "manual-recovery"), { recursive: true });
  await writeFile(join(workDir, ".brain-creator", path), contents, "utf8");
  return { path, sha256: createHash("sha256").update(contents).digest("hex") };
}

describe("execution action facade", () => {
  it("does not let a caller promote a sent write to confirmed without reconciliation evidence", async () => {
    const repository = new InMemoryBrainCreatorRepository();
    repository.requirementSuiteRuns.push({
      id: "suite-orders",
      knowledgeProjectId: "project-orders",
      systemId: "system-orders",
      status: "running",
      currentExecutableCaseId: "case-submit",
      continueOnBlocked: false,
      allowCreateTestData: false,
      total: 1,
      passed: 0,
      failed: 0,
      blocked: 0,
      skipped: 0,
      cancelled: 0,
      caseRuns: [{ executableCaseId: "case-submit", title: "Submit order", order: 1, status: "running", gapIds: [], attempts: [] }],
      createdAt: "2026-09-14T00:00:00.000Z",
      updatedAt: "2026-09-14T00:00:01.000Z"
    });
    const context = contextFor(repository);
    const action = {
      requirementSuiteRunId: "suite-orders",
      systemId: "system-orders",
      executableCaseId: "case-submit",
      actionKey: "submit-order",
      actionSemantic: "Submit order",
      actionPostcondition: "Order status is submitted"
    };

    const sent = readResult(await handleBrainCreatorTool(context, "bc_prepare", {
      action: "record-execution-action",
      ...action,
      actionPhase: "sent"
    }));
    expect(sent.success).toBe(true);

    const directConfirmation = readResult(await handleBrainCreatorTool(context, "bc_prepare", {
      action: "record-execution-action",
      ...action,
      actionPhase: "confirmed",
      actionEvidenceRefs: ["target:order:ORDER-42"]
    }));

    expect(directConfirmation.success).toBe(false);
    expect(JSON.stringify(directConfirmation)).toContain("use reconcile-execution-action with verified target evidence");
    expect(context.runLedger.latestUnresolvedAction("suite-orders")?.actionPhase).toBe("sent");
    expect(repository.runLedgerEntries.some((entry) => entry.actionPhase === "confirmed")).toBe(false);
  });

  it("records an uncertain send and reconciles it without rerunning the action", async () => {
    const repository = new InMemoryBrainCreatorRepository();
    repository.requirementSuiteRuns.push({
      id: "suite-orders",
      knowledgeProjectId: "project-orders",
      systemId: "system-orders",
      status: "running",
      currentExecutableCaseId: "case-submit",
      continueOnBlocked: false,
      allowCreateTestData: false,
      total: 1,
      passed: 0,
      failed: 0,
      blocked: 0,
      skipped: 0,
      cancelled: 0,
      caseRuns: [{
        executableCaseId: "case-submit",
        title: "Submit order",
        order: 1,
        status: "running",
        gapIds: [],
        attempts: []
      }],
      createdAt: "2026-09-14T00:00:00.000Z",
      updatedAt: "2026-09-14T00:00:01.000Z"
    });
    const context = contextFor(repository);

    const sent = readResult(await handleBrainCreatorTool(context, "bc_prepare", {
      action: "record-execution-action",
      responseMode: "full",
      requirementSuiteRunId: "suite-orders",
      systemId: "system-orders",
      executableCaseId: "case-submit",
      actionKey: "plan-submit:step-submit",
      actionPhase: "sent",
      actionSemantic: "Submit order",
      actionStepId: "step-submit",
      actionPostcondition: "Order status is submitted"
    }));
    expect(sent.success).toBe(true);
    expect(sent.data).toEqual(expect.objectContaining({
      status: "waiting",
      nextAction: "reconcile-action"
    }));
    expect(context.runLedger.latestUnresolvedAction("suite-orders")?.actionKey)
      .toBe("plan-submit:step-submit");

    const missingEvidence = readResult(await handleBrainCreatorTool(context, "bc_prepare", {
      action: "reconcile-execution-action",
      responseMode: "full",
      confirm: true,
      requirementSuiteRunId: "suite-orders",
      systemId: "system-orders",
      executableCaseId: "case-submit",
      actionKey: "plan-submit:step-submit",
      actionSemantic: "Submit order",
      actionPostcondition: "Order status is submitted",
      actionEvidenceRefs: ["evidence:order-submitted"],
      operator: "qa-reviewer"
    }));
    expect(missingEvidence.success).toBe(false);
    expect(JSON.stringify(missingEvidence)).toContain("requires at least one hash-bound evidence artifact");
    expect(context.runLedger.latestUnresolvedAction("suite-orders")?.actionPhase).toBe("sent");
    const actionEvidenceArtifact = await writeManualActionEvidence(context, "order-submitted", {
      binding: { runType: "requirement-suite", runId: "suite-orders", executableCaseId: "case-submit", stepId: "step-submit" },
      systemId: "system-orders",
      actionKey: "plan-submit:step-submit",
      actionSemantic: "Submit order",
      postcondition: "Order status is submitted",
      operator: "qa-reviewer"
    });
    const replacedEvidence = readResult(await handleBrainCreatorTool(context, "bc_prepare", {
      action: "reconcile-execution-action",
      responseMode: "full",
      confirm: true,
      requirementSuiteRunId: "suite-orders",
      systemId: "system-orders",
      executableCaseId: "case-submit",
      actionKey: "plan-submit:step-submit",
      actionSemantic: "Submit order",
      actionPostcondition: "Order status is submitted",
      actionEvidenceRefs: ["evidence:order-submitted"],
      actionEvidenceArtifacts: [{ ...actionEvidenceArtifact, sha256: "0".repeat(64) }],
      operator: "qa-reviewer"
    }));
    expect(replacedEvidence.success).toBe(false);
    expect(JSON.stringify(replacedEvidence)).toContain("artifact hash changed");
    expect(context.runLedger.latestUnresolvedAction("suite-orders")?.actionPhase).toBe("sent");
    const mismatchedEvidence = await writeManualActionEvidence(context, "other-business-state", {
      binding: { runType: "requirement-suite", runId: "suite-orders", executableCaseId: "case-submit", stepId: "step-submit" },
      systemId: "system-orders",
      actionKey: "plan-submit:step-submit",
      actionSemantic: "Submit order",
      postcondition: "Order status is approved",
      operator: "qa-reviewer"
    });
    const changedOracle = readResult(await handleBrainCreatorTool(context, "bc_prepare", {
      action: "reconcile-execution-action",
      responseMode: "full",
      confirm: true,
      requirementSuiteRunId: "suite-orders",
      systemId: "system-orders",
      executableCaseId: "case-submit",
      actionKey: "plan-submit:step-submit",
      actionSemantic: "Submit order",
      actionPostcondition: "Order status is submitted",
      actionEvidenceRefs: ["evidence:order-submitted"],
      actionEvidenceArtifacts: [mismatchedEvidence],
      operator: "qa-reviewer"
    }));
    expect(changedOracle.success).toBe(false);
    expect(JSON.stringify(changedOracle)).toContain("does not match the original target, action, postcondition, or operator");
    expect(context.runLedger.latestUnresolvedAction("suite-orders")?.actionPhase).toBe("sent");
    const replayedEvidence = await writeManualActionEvidence(context, "other-run", {
      binding: { runType: "requirement-suite", runId: "suite-other", executableCaseId: "case-submit", stepId: "step-submit" },
      systemId: "system-orders",
      actionKey: "plan-submit:step-submit",
      actionSemantic: "Submit order",
      postcondition: "Order status is submitted",
      operator: "qa-reviewer"
    });
    const crossRunReplay = readResult(await handleBrainCreatorTool(context, "bc_prepare", {
      action: "reconcile-execution-action",
      responseMode: "full",
      confirm: true,
      requirementSuiteRunId: "suite-orders",
      systemId: "system-orders",
      executableCaseId: "case-submit",
      actionKey: "plan-submit:step-submit",
      actionSemantic: "Submit order",
      actionPostcondition: "Order status is submitted",
      actionEvidenceRefs: ["evidence:order-submitted"],
      actionEvidenceArtifacts: [replayedEvidence],
      operator: "qa-reviewer"
    }));
    expect(crossRunReplay.success).toBe(false);
    expect(JSON.stringify(crossRunReplay)).toContain("does not match the original target, action, postcondition, or operator");
    expect(context.runLedger.latestUnresolvedAction("suite-orders")?.actionPhase).toBe("sent");

    const resumed = readResult(await handleBrainCreatorTool(context, "bc_prepare", {
      action: "reconcile-execution-action",
      responseMode: "full",
      confirm: true,
      requirementSuiteRunId: "suite-orders",
      systemId: "system-orders",
      executableCaseId: "case-submit",
      actionKey: "plan-submit:step-submit",
      actionPhase: "sent",
      actionSemantic: "Submit order",
      actionPostcondition: "Order status is submitted",
      actionEvidenceRefs: ["evidence:order-submitted"],
      actionEvidenceArtifacts: [actionEvidenceArtifact],
      operator: "qa-reviewer"
    }));
    expect(resumed.success).toBe(true);
    expect(resumed.data).toEqual(expect.objectContaining({
      status: "reconciled",
      nextAction: "continue-requirement-suite"
    }));
    expect(context.runLedger.latestUnresolvedAction("suite-orders")).toBeUndefined();
    expect(repository.runLedgerEntries.filter((entry) => entry.actionKey === "plan-submit:step-submit"))
      .toHaveLength(2);
  });

  it("attributes manual reconciliation to the uniquely mapped active Trial scenario", async () => {
    const repository = new InMemoryBrainCreatorRepository();
    repository.requirementSuiteRuns.push({
      id: "suite-orders",
      knowledgeProjectId: "project-orders",
      systemId: "system-orders",
      evaluationTrialId: "trial-orders",
      status: "running",
      currentExecutableCaseId: "case-submit",
      continueOnBlocked: false,
      allowCreateTestData: false,
      total: 1,
      passed: 0,
      failed: 0,
      blocked: 0,
      skipped: 0,
      cancelled: 0,
      caseRuns: [{
        executableCaseId: "case-submit",
        title: "Submit order",
        order: 1,
        status: "running",
        gapIds: [],
        attempts: []
      }],
      createdAt: "2026-09-14T00:00:00.000Z",
      updatedAt: "2026-09-14T00:00:01.000Z"
    });
    repository.executableCases.push({
      id: "case-submit",
      knowledgeProjectId: "project-orders",
      requirementSetId: "requirements-orders",
      testIntentId: "intent-submit",
      systemId: "system-orders",
      title: "Submit order",
      status: "ready",
      preconditions: [],
      steps: [],
      dataProfileIds: [],
      gapIds: [],
      createdAt: "2026-09-14T00:00:00.000Z",
      updatedAt: "2026-09-14T00:00:00.000Z"
    });
    repository.businessScenarios.push({
      id: "scenario-submit",
      knowledgeProjectId: "project-orders",
      requirementSetId: "requirements-orders",
      title: "Submit order",
      objective: "Submit one order for approval",
      family: "main-flow",
      actors: [],
      preconditions: [],
      workflowRefs: [],
      stateTransitionRefs: [],
      decisionRuleRefs: [],
      testDataNeeds: [],
      expectedBusinessOutcomes: ["manager review"],
      sourceRefs: ["requirement:submit"],
      testIntentIds: ["intent-submit"],
      risk: "low",
      status: "approved"
    });
    repository.evaluationTrials.push({
      id: "trial-orders",
      comparisonGroupId: "group-orders",
      knowledgeProjectId: "project-orders",
      systemId: "system-orders",
      requirementSourceId: "source-orders",
      sourceSnapshotId: "snapshot-orders",
      sourceRevision: 1,
      sourceHash: "hash-orders",
      provider: "codex",
      workspacePath: ".",
      storePath: ".brain-creator/store",
      codeRevision: "revision-orders",
      runtimeVersions: {},
      executionScope: { businessScenarioIds: ["scenario-submit"], scopeHash: "scope-orders" },
      latestProjectionManifestId: "manifest-orders",
      status: "active",
      invalidationReasons: [],
      createdAt: "2026-09-14T00:00:00.000Z",
      updatedAt: "2026-09-14T00:00:00.000Z"
    });
    const context = contextFor(repository);
    context.evaluationIntegrity = new EvaluationIntegrityService(repository);
    const actionEvidenceArtifact = await writeManualActionEvidence(context, "trial-order-submitted", {
      binding: {
        runType: "requirement-suite", runId: "suite-orders", evaluationTrialId: "trial-orders",
        businessScenarioId: "scenario-submit", executableCaseId: "case-submit", stepId: "step-submit"
      },
      systemId: "system-orders",
      actionKey: "plan-submit:step-submit",
      actionSemantic: "Submit order",
      entityReference: "order:42",
      postcondition: "Order status is submitted",
      operator: "qa-reviewer"
    });
    context.runLedger.recordAction({
      runType: "requirement-suite",
      knowledgeProjectId: "project-orders",
      systemId: "system-orders",
      requirementSuiteRunId: "suite-orders",
      executableCaseId: "case-submit",
      actionKey: "plan-submit:step-submit",
      phase: "sent",
      actionSemantic: "Submit order",
      stepId: "step-submit",
      entityReference: "order:42",
      postcondition: "Order status is submitted"
    });

    const reconciliation = {
      action: "reconcile-execution-action",
      responseMode: "full",
      confirm: true,
      requirementSuiteRunId: "suite-orders",
      systemId: "system-orders",
      executableCaseId: "case-submit",
      actionKey: "plan-submit:step-submit",
      actionSemantic: "Submit order",
      actionPostcondition: "Order status is submitted",
      actionEvidenceRefs: ["evidence:order-submitted"],
      actionEvidenceArtifacts: [actionEvidenceArtifact],
      operator: "qa-reviewer"
    };
    vi.spyOn(context.evaluationIntegrity!, "recordIntervention")
      .mockImplementationOnce(() => {
        throw new Error("intervention persistence failed");
      });
    const failedReconciliation = readResult(await handleBrainCreatorTool(context, "bc_prepare", reconciliation));
    expect(failedReconciliation.success).toBe(false);
    expect(repository.runLedgerEntries.filter((entry) => entry.actionKey === "plan-submit:step-submit"))
      .toHaveLength(1);
    expect(repository.interventionRecords).toHaveLength(0);

    const result = readResult(await handleBrainCreatorTool(context, "bc_prepare", reconciliation));

    expect(result.success).toBe(true);
    expect(repository.interventionRecords).toEqual([expect.objectContaining({
      trialId: "trial-orders",
      category: "manual-recovery",
      businessScenarioIds: ["scenario-submit"],
      evidenceRefs: expect.arrayContaining([
        expect.stringMatching(/^run-ledger:/),
        "evidence:order-submitted",
        expect.stringContaining("manual-recovery/trial-order-submitted.json#sha256=")
      ])
    })]);
    expect(repository.runLedgerEntries.at(-1)).toEqual(expect.objectContaining({
      event: "action-reconciled",
      recoveryMode: "manual"
    }));
  });

  it("attributes out-of-suite manual recovery to the unique active Trial", async () => {
    const repository = new InMemoryBrainCreatorRepository();
    repository.caseSuites.push({
      id: "document-suite",
      systemId: "system-orders",
      sourceId: "document-source",
      status: "running",
      totalCases: 1,
      selectedCaseNos: ["TC-001"],
      createdAt: "2026-09-14T00:00:00.000Z",
      updatedAt: "2026-09-14T00:00:01.000Z"
    });
    repository.businessScenarios.push({
      id: "scenario-document",
      knowledgeProjectId: "project-orders",
      requirementSetId: "requirements-orders",
      title: "Document-suite recovery",
      objective: "Recover a pending workflow action",
      family: "main-flow",
      actors: [],
      preconditions: [],
      workflowRefs: [],
      stateTransitionRefs: [],
      decisionRuleRefs: [],
      testDataNeeds: [],
      expectedBusinessOutcomes: ["Order is submitted"],
      sourceRefs: ["requirement:submit"],
      testIntentIds: [],
      risk: "low",
      status: "approved"
    });
    repository.evaluationTrials.push({
      id: "trial-orders",
      comparisonGroupId: "group-orders",
      knowledgeProjectId: "project-orders",
      systemId: "system-orders",
      requirementSourceId: "source-orders",
      sourceSnapshotId: "snapshot-orders",
      sourceRevision: 1,
      sourceHash: "hash-orders",
      provider: "codex",
      workspacePath: ".",
      storePath: ".brain-creator/store",
      codeRevision: "revision-orders",
      runtimeVersions: {},
      executionScope: { businessScenarioIds: ["scenario-document"], scopeHash: "scope-orders" },
      latestProjectionManifestId: "manifest-orders",
      status: "active",
      invalidationReasons: [],
      createdAt: "2026-09-14T00:00:00.000Z",
      updatedAt: "2026-09-14T00:00:00.000Z"
    });
    const context = contextFor(repository);
    context.evaluationIntegrity = new EvaluationIntegrityService(repository);
    context.runLedger.recordAction({
      runType: "document-suite",
      systemId: "system-orders",
      caseSuiteId: "document-suite",
      caseNo: "TC-001",
      actionKey: "tc-001:submit",
      phase: "sent",
      actionSemantic: "Submit order",
      entityReference: "order:42",
      postcondition: "Order status is submitted"
    });
    const actionEvidenceArtifact = await writeManualActionEvidence(context, "document-trial-recovery", {
      binding: {
        runType: "document-suite", runId: "document-suite", evaluationTrialId: "trial-orders",
        businessScenarioId: "scenario-document", caseNo: "TC-001"
      },
      systemId: "system-orders",
      actionKey: "tc-001:submit",
      actionSemantic: "Submit order",
      entityReference: "order:42",
      postcondition: "Order status is submitted",
      operator: "qa-reviewer"
    });

    const result = readResult(await handleBrainCreatorTool(context, "bc_prepare", {
      action: "reconcile-execution-action",
      responseMode: "full",
      confirm: true,
      caseSuiteId: "document-suite",
      systemId: "system-orders",
      caseNo: "TC-001",
      actionKey: "tc-001:submit",
      actionSemantic: "Submit order",
      actionPostcondition: "Order status is submitted",
      actionEvidenceRefs: ["evidence:order-submitted"],
      actionEvidenceArtifacts: [actionEvidenceArtifact],
      businessScenarioId: "scenario-document",
      operator: "qa-reviewer"
    }));

    expect(result.success).toBe(true);
    expect(repository.runLedgerEntries.at(-1)).toEqual(expect.objectContaining({
      event: "action-reconciled",
      recoveryMode: "manual",
      evaluationTrialId: "trial-orders",
      businessScenarioId: "scenario-document"
    }));
    expect(repository.interventionRecords).toEqual([expect.objectContaining({
      trialId: "trial-orders",
      category: "manual-recovery",
      businessScenarioIds: ["scenario-document"]
    })]);
    expect(context.evaluationIntegrity.reviewInterventionIntegrity("trial-orders")
      .unrecordedInterventionSourceRefs).toEqual([]);
  });

  it("reconciles a pending action after an injected postcondition verifier confirms it", async () => {
    const repository = new InMemoryBrainCreatorRepository();
    repository.requirementSuiteRuns.push({
      id: "suite-orders",
      knowledgeProjectId: "project-orders",
      systemId: "system-orders",
      status: "running",
      currentExecutableCaseId: "case-submit",
      continueOnBlocked: false,
      allowCreateTestData: false,
      total: 1,
      passed: 0,
      failed: 0,
      blocked: 0,
      skipped: 0,
      cancelled: 0,
      caseRuns: [{
        executableCaseId: "case-submit",
        title: "Submit order",
        order: 1,
        status: "running",
        gapIds: [],
        attempts: []
      }],
      createdAt: "2026-09-14T00:00:00.000Z",
      updatedAt: "2026-09-14T00:00:01.000Z"
    });
    const context = contextFor(repository);
    const postconditionCalls: string[] = [];
    const workDir = await mkdtemp(join(tmpdir(), "bc-postcondition-"));
    context.workDir = workDir;
    context.postconditionVerifier = async (input) => {
      postconditionCalls.push(input.postcondition);
      const checkedAt = "2026-09-14T00:00:02.000Z";
      const evidencePath = "postconditions/order-submit.json";
      const contents = JSON.stringify({
        schemaVersion: 2,
        type: "execution-postcondition-observation",
        runType: input.requirementSuiteRunId ? "requirement-suite" : "document-suite",
        runId: input.requirementSuiteRunId ?? input.caseSuiteId,
        evaluationTrialId: input.evaluationTrialId,
        businessScenarioId: input.businessScenarioId,
        executableCaseId: input.executableCaseId,
        caseNo: input.caseNo,
        stepId: input.stepId,
        systemId: input.systemId,
        actionKey: input.actionKey,
        actionSemantic: input.actionSemantic,
        entityReference: input.entityReference,
        postcondition: input.postcondition,
        result: "confirmed",
        actualResult: "Order status is submitted",
        checkedAt
      });
      await mkdir(join(workDir, ".brain-creator", "postconditions"), { recursive: true });
      await writeFile(join(workDir, ".brain-creator", evidencePath), contents, "utf8");
      return {
        status: "confirmed",
        actualResult: "Order status is submitted",
        evidenceRefs: ["evidence:order-submitted"],
        evidenceArtifacts: [{ path: evidencePath, sha256: createHash("sha256").update(contents).digest("hex") }],
        checkedAt
      };
    };

    context.runLedger.recordAction({
      runType: "requirement-suite",
      knowledgeProjectId: "project-orders",
      systemId: "system-orders",
      requirementSuiteRunId: "suite-orders",
      executableCaseId: "case-submit",
      actionKey: "plan-submit:step-submit",
      phase: "sent",
      actionSemantic: "Submit order",
      postcondition: "Order status is submitted"
    });

    const result = readResult(await handleBrainCreatorTool(context, "bc_prepare", {
      action: "reconcile-execution-action",
      responseMode: "full",
      confirm: true,
      autoVerify: true,
      requirementSuiteRunId: "suite-orders",
      systemId: "system-orders",
      executableCaseId: "case-submit",
      actionKey: "plan-submit:step-submit",
      actionSemantic: "Submit order"
    }));

    expect(result.success).toBe(true);
    expect(result.data).toEqual(expect.objectContaining({
      status: "reconciled",
      nextAction: "continue-requirement-suite",
      verification: expect.objectContaining({
        status: "confirmed",
        evidenceRefs: ["evidence:order-submitted"],
        evidenceArtifacts: [expect.objectContaining({
          path: "postconditions/order-submit.json",
          sha256: expect.stringMatching(/^[a-f0-9]{64}$/)
        })]
      })
    }));
    expect(postconditionCalls).toEqual(["Order status is submitted"]);
    expect(context.runLedger.latestUnresolvedAction("suite-orders")).toBeUndefined();
    expect(repository.runLedgerEntries.at(-1)).toEqual(expect.objectContaining({
      actionPhase: "reconciled",
      recoveryMode: "automatic",
      actionEvidenceRefs: ["evidence:order-submitted"],
      actionEvidenceArtifacts: [expect.objectContaining({
        path: "postconditions/order-submit.json",
        sha256: expect.stringMatching(/^[a-f0-9]{64}$/)
      })]
    }));
    await rm(workDir, { recursive: true, force: true });
  });

  it("rejects reconciliation that changes the pending action postcondition", async () => {
    const repository = new InMemoryBrainCreatorRepository();
    repository.requirementSuiteRuns.push({
      id: "suite-orders",
      knowledgeProjectId: "project-orders",
      systemId: "system-orders",
      status: "running",
      continueOnBlocked: false,
      allowCreateTestData: false,
      total: 1,
      passed: 0,
      failed: 0,
      blocked: 0,
      skipped: 0,
      cancelled: 0,
      caseRuns: [{
        executableCaseId: "case-submit",
        title: "Submit order",
        order: 1,
        status: "running",
        gapIds: [],
        attempts: []
      }],
      createdAt: "2026-09-14T00:00:00.000Z",
      updatedAt: "2026-09-14T00:00:01.000Z"
    });
    const context = contextFor(repository);
    context.runLedger.recordAction({
      runType: "requirement-suite",
      knowledgeProjectId: "project-orders",
      systemId: "system-orders",
      requirementSuiteRunId: "suite-orders",
      executableCaseId: "case-submit",
      actionKey: "plan-submit:step-submit",
      phase: "sent",
      actionSemantic: "Submit order",
      entityReference: "order:42",
      postcondition: "Order status is submitted"
    });

    const result = readResult(await handleBrainCreatorTool(context, "bc_prepare", {
      action: "reconcile-execution-action",
      responseMode: "full",
      confirm: true,
      autoVerify: true,
      requirementSuiteRunId: "suite-orders",
      systemId: "system-orders",
      executableCaseId: "case-submit",
      actionKey: "plan-submit:step-submit",
      actionSemantic: "Submit order",
      actionPostcondition: "Order status is approved"
    }));

    expect(result.success).toBe(false);
    expect(JSON.stringify(result)).toContain("cannot change the original action postcondition");
    expect(context.runLedger.latestUnresolvedAction("suite-orders")).toEqual(
      expect.objectContaining({
        actionPhase: "sent",
        actionPostcondition: "Order status is submitted"
      })
    );
  });

  it("keeps a pending action blocked when automatic postcondition verification is unavailable", async () => {
    const repository = new InMemoryBrainCreatorRepository();
    repository.requirementSuiteRuns.push({
      id: "suite-orders",
      knowledgeProjectId: "project-orders",
      systemId: "system-orders",
      status: "running",
      continueOnBlocked: false,
      allowCreateTestData: false,
      total: 1,
      passed: 0,
      failed: 0,
      blocked: 0,
      skipped: 0,
      cancelled: 0,
      caseRuns: [{
        executableCaseId: "case-submit",
        title: "Submit order",
        order: 1,
        status: "running",
        gapIds: [],
        attempts: []
      }],
      createdAt: "2026-09-14T00:00:00.000Z",
      updatedAt: "2026-09-14T00:00:01.000Z"
    });
    const context = contextFor(repository);
    context.runLedger.recordAction({
      runType: "requirement-suite",
      knowledgeProjectId: "project-orders",
      systemId: "system-orders",
      requirementSuiteRunId: "suite-orders",
      executableCaseId: "case-submit",
      actionKey: "plan-submit:step-submit",
      phase: "sent",
      actionSemantic: "Submit order",
      postcondition: "Order status is submitted"
    });

    const result = readResult(await handleBrainCreatorTool(context, "bc_prepare", {
      action: "reconcile-execution-action",
      responseMode: "full",
      confirm: true,
      autoVerify: true,
      requirementSuiteRunId: "suite-orders",
      systemId: "system-orders",
      executableCaseId: "case-submit",
      actionKey: "plan-submit:step-submit",
      actionSemantic: "Submit order"
    }));

    expect(result.success).toBe(true);
    expect(result.data).toEqual(expect.objectContaining({
      status: "waiting",
      nextAction: "reconcile-action",
      verification: expect.objectContaining({
        status: "unavailable",
        reason: "No postcondition verifier is configured for this runtime."
      })
    }));
    expect(context.runLedger.latestUnresolvedAction("suite-orders")).toEqual(
      expect.objectContaining({
        actionKey: "plan-submit:step-submit",
        actionPhase: "reconciliation-required"
      })
    );
  });

  it("does not auto-reconcile a confirmed verifier response without hash-bound artifacts", async () => {
    const repository = new InMemoryBrainCreatorRepository();
    const workDir = await mkdtemp(join(tmpdir(), "bc-postcondition-missing-proof-"));
    repository.requirementSuiteRuns.push({
      id: "suite-orders",
      knowledgeProjectId: "project-orders",
      systemId: "system-orders",
      status: "running",
      continueOnBlocked: false,
      allowCreateTestData: false,
      total: 1,
      passed: 0,
      failed: 0,
      blocked: 0,
      skipped: 0,
      cancelled: 0,
      caseRuns: [{
        executableCaseId: "case-submit",
        title: "Submit order",
        order: 1,
        status: "running",
        gapIds: [],
        attempts: []
      }],
      createdAt: "2026-09-14T00:00:00.000Z",
      updatedAt: "2026-09-14T00:00:01.000Z"
    });
    const context = contextFor(repository);
    context.workDir = workDir;
    context.postconditionVerifier = async () => ({
      status: "confirmed",
      actualResult: "Order status is submitted",
      evidenceRefs: ["evidence:order-submitted"],
      checkedAt: "2026-09-14T00:00:02.000Z"
    });
    context.runLedger.recordAction({
      runType: "requirement-suite",
      knowledgeProjectId: "project-orders",
      systemId: "system-orders",
      requirementSuiteRunId: "suite-orders",
      executableCaseId: "case-submit",
      actionKey: "plan-submit:step-submit",
      phase: "sent",
      actionSemantic: "Submit order",
      postcondition: "Order status is submitted"
    });

    const result = readResult(await handleBrainCreatorTool(context, "bc_prepare", {
      action: "reconcile-execution-action",
      responseMode: "full",
      confirm: true,
      autoVerify: true,
      requirementSuiteRunId: "suite-orders",
      systemId: "system-orders",
      executableCaseId: "case-submit",
      actionKey: "plan-submit:step-submit",
      actionSemantic: "Submit order"
    }));

    expect(result.success).toBe(true);
    expect(result.data).toEqual(expect.objectContaining({
      status: "waiting",
      verification: expect.objectContaining({
        status: "unavailable",
        reason: expect.stringContaining("hash-bound artifacts")
      })
    }));
    expect(context.runLedger.latestUnresolvedAction("suite-orders")?.actionPhase)
      .toBe("reconciliation-required");
    expect(repository.runLedgerEntries.at(-1)?.actionEvidenceArtifacts).toBeUndefined();
    await rm(workDir, { recursive: true, force: true });
  });

  it("rejects actions that claim another system or case", async () => {
    const repository = new InMemoryBrainCreatorRepository();
    repository.requirementSuiteRuns.push({
      id: "suite-orders",
      knowledgeProjectId: "project-orders",
      systemId: "system-orders",
      status: "running",
      continueOnBlocked: false,
      allowCreateTestData: false,
      total: 0,
      passed: 0,
      failed: 0,
      blocked: 0,
      skipped: 0,
      cancelled: 0,
      caseRuns: [],
      createdAt: "2026-09-14T00:00:00.000Z",
      updatedAt: "2026-09-14T00:00:01.000Z"
    });

    const result = readResult(await handleBrainCreatorTool(
      contextFor(repository),
      "bc_prepare",
      {
        action: "record-execution-action",
        requirementSuiteRunId: "suite-orders",
        systemId: "system-billing",
        executableCaseId: "case-other",
        actionKey: "action-1",
        actionPhase: "sent",
        actionSemantic: "Submit order"
      }
    ));
    expect(result.success).toBe(false);
    expect(JSON.stringify(result)).toContain("does not match");
    expect(repository.runLedgerEntries).toHaveLength(0);
  });

  it("stops requirement-suite continuation before dispatching another action", async () => {
    const workDir = await mkdtemp(`${tmpdir()}/brain-action-guard-`);
    try {
      const context = createBrainCreatorMcpContext({ workDir });
      context.repository.knowledgeProjects.push({
        id: "project-orders",
        key: "orders",
        name: "Orders",
        defaultLocale: "en-US",
        status: "active",
        systemIds: ["system-orders"],
        createdAt: "2026-09-14T00:00:00.000Z",
        updatedAt: "2026-09-14T00:00:00.000Z"
      });
      context.repository.requirementSuiteRuns.push({
        id: "suite-orders",
        knowledgeProjectId: "project-orders",
        systemId: "system-orders",
        status: "running",
        currentExecutableCaseId: "case-submit",
        continueOnBlocked: false,
        allowCreateTestData: false,
        total: 1,
        passed: 0,
        failed: 0,
        blocked: 0,
        skipped: 0,
        cancelled: 0,
        caseRuns: [{
          executableCaseId: "case-submit",
          title: "Submit order",
          order: 1,
          status: "running",
          gapIds: [],
          attempts: []
        }],
        createdAt: "2026-09-14T00:00:00.000Z",
        updatedAt: "2026-09-14T00:00:01.000Z"
      });
      context.runLedger.recordAction({
        requirementSuiteRunId: "suite-orders",
        systemId: "system-orders",
        executableCaseId: "case-submit",
        actionKey: "plan-submit:step-submit",
        phase: "sent",
        actionSemantic: "Submit order",
        postcondition: "Order status is submitted"
      });

      const result = readResult(await handleBrainCreatorTool(context, "bc_run", {
        mode: "requirement-suite",
        knowledgeProjectId: "project-orders",
        systemId: "system-orders",
        suiteId: "suite-orders",
        confirm: true,
        browserMode: "headless"
      }));
      expect(result.success).toBe(true);
      expect(result.data).toEqual(expect.objectContaining({
        status: "waiting",
        nextAction: "reconcile-action",
        pendingAction: expect.objectContaining({ actionKey: "plan-submit:step-submit" })
      }));
      expect(context.repository.requirementSuiteRuns[0].caseRuns[0].status).toBe("running");
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  });

  it("stops document-suite continuation before creating another test case", async () => {
    const workDir = await mkdtemp(`${tmpdir()}/brain-document-action-guard-`);
    try {
      const source = `${workDir}/cases.md`;
      await writeFile(source, [
        "| 用例编号 | 用例标题 | 所属模块 | 前置条件 | 操作步骤 | 预期结果 | 优先级 |",
        "| --- | --- | --- | --- | --- | --- | --- |",
        "| TC-001 | Submit order | Orders | Signed in | Submit order | Order is submitted | P0 |"
      ].join("\n"), "utf8");
      const context = createBrainCreatorMcpContext({
        workDir,
        agentBridge: Object.assign(
          async () => ({ exitCode: 0, stdout: "", stderr: "" }),
          {
            provider: "host-agent" as const,
            preflight: async () => ({ ok: true })
          }
        ),
        runner: async () => {
          throw new Error("runner must not execute while action reconciliation is pending");
        }
      });
      const system = context.service.createSystemProfile({
        name: "Orders",
        environment: "test",
        baseUrl: "https://orders.example.test",
        defaultLocale: "en-US",
        urlAllowlist: ["https://orders.example.test"]
      });
      context.service.createAuthProfile({
        projectId: system.id,
        env: "test",
        role: "qa",
        loginMethod: "script",
        secrets: {}
      });
      const caseSource = context.service.upsertCaseSource({
        systemId: system.id,
        source,
        sourceType: "markdown",
        contentHash: "document-action-guard",
        caseCount: 1,
        moduleStats: { Orders: 1 },
        priorityStats: { P0: 1 }
      });
      const suite = context.service.createCaseSuite({
        systemId: system.id,
        sourceId: caseSource.id,
        totalCases: 1,
        selectedCaseNos: ["TC-001"],
        status: "running"
      });
      context.runLedger.recordAction({
        runType: "document-suite",
        systemId: system.id,
        caseSuiteId: suite.id,
        caseNo: "TC-001",
        actionKey: "tc-001:submit",
        phase: "sent",
        actionSemantic: "Submit order",
        postcondition: "Order is submitted"
      });

      const result = readResult(await handleBrainCreatorTool(context, "bc_run", {
        mode: "case-source-suite",
        systemId: system.id,
        suiteId: suite.id,
        source,
        confirm: true,
        browserMode: "headless"
      }));

      expect(result.success).toBe(true);
      expect(result.data).toEqual(expect.objectContaining({
        status: "waiting",
        nextAction: "reconcile-action",
        pendingAction: expect.objectContaining({ actionKey: "tc-001:submit" })
      }));
      expect(context.repository.testCases).toHaveLength(0);
      expect(context.service.getCaseSuite(suite.id).status).toBe("waiting-for-agent");

      const reconciled = readResult(await handleBrainCreatorTool(context, "bc_prepare", {
        action: "reconcile-execution-action",
        responseMode: "full",
        confirm: true,
        caseSuiteId: suite.id,
        systemId: system.id,
        caseNo: "TC-001",
        actionKey: "tc-001:submit",
        actionSemantic: "Submit order",
        actionPostcondition: "Order is submitted",
        actionEvidenceRefs: ["evidence:order-submitted"],
        actionEvidenceArtifacts: [await writeManualActionEvidence(context, "document-order-submitted", {
          binding: { runType: "document-suite", runId: suite.id, caseNo: "TC-001" },
          systemId: system.id,
          actionKey: "tc-001:submit",
          actionSemantic: "Submit order",
          postcondition: "Order is submitted",
          operator: "qa-reviewer"
        })],
        operator: "qa-reviewer"
      }));
      expect(reconciled.data).toEqual(expect.objectContaining({
        status: "reconciled",
        nextAction: "continue-case-source-suite"
      }));
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  });

  it("replays a pending document action after a fresh MCP context is created", async () => {
    const workDir = await mkdtemp(`${tmpdir()}/brain-document-recovery-`);
    const bridge = Object.assign(
      async () => ({ exitCode: 0, stdout: "", stderr: "" }),
      {
        provider: "host-agent" as const,
        preflight: async () => ({ ok: true })
      }
    );
    const authStateVerifier = async () => ({ status: "valid" as const });
    try {
      const firstContext = createBrainCreatorMcpContext({
        workDir,
        agentBridge: bridge,
        authStateVerifier
      });
      const system = firstContext.service.createSystemProfile({
        name: "Orders",
        environment: "test",
        baseUrl: "https://orders.example.test",
        defaultLocale: "en-US",
        urlAllowlist: ["https://orders.example.test"]
      });
      firstContext.service.createAuthProfile({
        projectId: system.id,
        env: "test",
        role: "qa",
        loginMethod: "script",
        secrets: {}
      });
      const source = `${workDir}/cases.md`;
      await writeFile(source, [
        "| 用例编号 | 用例标题 | 所属模块 | 前置条件 | 操作步骤 | 预期结果 | 优先级 |",
        "| --- | --- | --- | --- | --- | --- | --- |",
        "| TC-001 | Submit order | Orders | Signed in | Submit order | Order is submitted | P1 |"
      ].join("\n"), "utf8");
      const caseSource = firstContext.service.upsertCaseSource({
        systemId: system.id,
        source,
        sourceType: "markdown",
        contentHash: "persistent-recovery",
        caseCount: 1,
        moduleStats: { Orders: 1 },
        priorityStats: { P1: 1 }
      });
      const suite = firstContext.service.createCaseSuite({
        systemId: system.id,
        sourceId: caseSource.id,
        totalCases: 1,
        selectedCaseNos: ["TC-001"],
        status: "running"
      });
      firstContext.runLedger.recordAction({
        runType: "document-suite",
        systemId: system.id,
        caseSuiteId: suite.id,
        caseSourceId: caseSource.id,
        caseNo: "TC-001",
        actionKey: "tc-001:submit",
        phase: "sent",
        actionSemantic: "Submit order",
        postcondition: "Order status is submitted"
      });

      const resumedContext = createBrainCreatorMcpContext({
        workDir,
        agentBridge: bridge,
        authStateVerifier,
        runner: async () => {
          throw new Error("runner must not execute before reconciliation");
        }
      });
      const result = readResult(await handleBrainCreatorTool(resumedContext, "bc_run", {
        mode: "case-source-suite",
        systemId: system.id,
        suiteId: suite.id,
        source,
        confirm: true,
        browserMode: "headless"
      }));

      expect(result.success).toBe(true);
      expect(result.data).toEqual(expect.objectContaining({
        status: "waiting",
        nextAction: "reconcile-action",
        pendingAction: expect.objectContaining({ actionKey: "tc-001:submit" }),
        reportPath: expect.stringContaining("suite-report.html")
      }));
      const report = await readFile(result.data?.reportPath as string, "utf8");
      expect(report).toContain("TC-001");
      expect(report).toContain("write action was sent");
      expect(resumedContext.repository.testCases).toHaveLength(0);
      expect(resumedContext.repository.runLedgerEntries).toHaveLength(
        firstContext.repository.runLedgerEntries.length
      );
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  });
});
