import { describe, expect, it } from "vitest";
import { InMemoryBrainCreatorRepository } from "../domain/repository.js";
import { authCheckpointBinding } from "./authCheckpointBinding.js";

describe("auth checkpoint Trial binding", () => {
  it("links a run checkpoint to its uniquely mapped frozen scenario", () => {
    const repository = fixture();

    expect(authCheckpointBinding(repository, {
      systemId: "system",
      requirementSuiteRunId: "run",
      executableCaseId: "case"
    })).toEqual({
      requirementSuiteRunId: "run",
      executableCaseId: "case",
      evaluationTrialId: "trial",
      businessScenarioId: "scenario"
    });
  });

  it("retains Trial attribution but does not guess when scenario mapping is ambiguous", () => {
    const repository = fixture();
    repository.businessScenarios.push({
      ...repository.businessScenarios[0]!,
      id: "scenario-duplicate"
    });
    repository.evaluationTrials[0]!.executionScope!.businessScenarioIds.push("scenario-duplicate");

    expect(authCheckpointBinding(repository, {
      systemId: "system",
      requirementSuiteRunId: "run",
      executableCaseId: "case"
    })).toEqual({
      requirementSuiteRunId: "run",
      executableCaseId: "case",
      evaluationTrialId: "trial"
    });
  });

  it("does not bind checkpoints across a system, suite, or case boundary", () => {
    const repository = fixture();

    expect(authCheckpointBinding(repository, {
      systemId: "other-system",
      requirementSuiteRunId: "run",
      executableCaseId: "case"
    })).toEqual({});
    expect(authCheckpointBinding(repository, {
      systemId: "system",
      requirementSuiteRunId: "run",
      executableCaseId: "other-case"
    })).toEqual({});
  });
});

function fixture() {
  const repository = new InMemoryBrainCreatorRepository();
  const now = new Date(0).toISOString();
  repository.executableCases.push({
    id: "case",
    knowledgeProjectId: "project",
    requirementSetId: "set",
    testIntentId: "intent",
    systemId: "system",
    title: "Approval flow",
    status: "ready",
    preconditions: [],
    steps: [],
    dataProfileIds: [],
    gapIds: [],
    createdAt: now,
    updatedAt: now
  });
  repository.businessScenarios.push({
    id: "scenario",
    knowledgeProjectId: "project",
    requirementSetId: "set",
    title: "Approval flow",
    objective: "Complete an approval flow",
    family: "main-flow",
    actors: [],
    preconditions: [],
    workflowRefs: [],
    stateTransitionRefs: [],
    decisionRuleRefs: [],
    testDataNeeds: [],
    expectedBusinessOutcomes: ["approved"],
    sourceRefs: ["requirement:approval"],
    testIntentIds: ["intent"],
    risk: "low",
    status: "approved"
  });
  repository.evaluationTrials.push({
    id: "trial",
    comparisonGroupId: "group",
    knowledgeProjectId: "project",
    systemId: "system",
    requirementSourceId: "source",
    sourceSnapshotId: "snapshot",
    sourceRevision: 1,
    sourceHash: "source-hash",
    provider: "codex",
    workspacePath: ".",
    storePath: ".brain-creator/store",
    codeRevision: "revision",
    runtimeVersions: {},
    executionScope: {
      businessScenarioIds: ["scenario"],
      scopeHash: "scope-hash"
    },
    latestProjectionManifestId: "manifest",
    status: "active",
    invalidationReasons: [],
    createdAt: now,
    updatedAt: now
  });
  repository.requirementSuiteRuns.push({
    id: "run",
    knowledgeProjectId: "project",
    systemId: "system",
    evaluationTrialId: "trial",
    status: "running",
    continueOnBlocked: true,
    allowCreateTestData: false,
    total: 1,
    passed: 0,
    failed: 0,
    blocked: 0,
    skipped: 0,
    cancelled: 0,
    caseRuns: [{
      executableCaseId: "case",
      title: "Approval flow",
      order: 1,
      status: "running",
      gapIds: [],
      attempts: []
    }],
    createdAt: now,
    updatedAt: now
  });
  return repository;
}
