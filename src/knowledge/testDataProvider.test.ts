// @vitest-environment node

import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { InMemoryBrainCreatorRepository } from "../domain/repository.js";
import type {
  ExecutableCase,
  Gap,
  KnowledgeProject,
  SystemProfile,
  TestDataLease,
  TestIntent
} from "../domain/types.js";
import {
  InMemoryTestDataProvider,
  TestDataBrainService,
  type TestDataProviderRequest
} from "../brain/testdata.js";
import { KnowledgeService } from "./service.js";
import {
  TestDataProviderService,
  type TestDataNoEffectVerifier,
  type TestDataSubmitResult
} from "./testDataProvider.js";

const tempDirs: string[] = [];

class EvidenceBackedFixtureProvider extends InMemoryTestDataProvider {
  override async lookup(input: Parameters<InMemoryTestDataProvider["lookup"]>[0]) {
    const result = await super.lookup(input);
    if (!result) return result;
    const matches = Array.isArray(result) ? result : [result];
    const evidenced = matches.map((match) => ({
      ...match,
      sourceRefs: [`fixture-target-query:${match.reference}`]
    }));
    return Array.isArray(result) ? evidenced : evidenced[0];
  }
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))
  );
});

describe("TestDataProviderService", () => {
  it("tracks cross-case consumption and waits for current-suite evidence before producer cleanup", async () => {
    const fixture = await providerFixture();
    const producerCase: ExecutableCase = {
      ...fixture.executableCase,
      id: "executable-producer",
      testIntentId: "intent-producer",
      title: "Create employee",
      status: "ready",
      caseDependencyGraph: undefined
    };
    fixture.repository.executableCases.push(producerCase);
    const requirementSuiteRunId = "suite-consumer-current";
    fixture.repository.requirementSuiteRuns.push({
      id: requirementSuiteRunId,
      knowledgeProjectId: fixture.project.id,
      systemId: fixture.system.id,
      status: "running",
      continueOnBlocked: false,
      allowCreateTestData: true,
      total: 1,
      passed: 0,
      failed: 0,
      blocked: 0,
      skipped: 0,
      cancelled: 0,
      caseRuns: [{
        executableCaseId: fixture.executableCase.id,
        title: "Edit employee",
        order: 1,
        status: "running",
        gapIds: [],
        attempts: []
      }],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    fixture.executableCase.dataPlan = {
      verdict: "ready",
      reasons: [],
      operations: [{
        profileId: "entity:employee%3Asemantic",
        field: "Employee",
        strategy: "existing-reference",
        decision: "reuse",
        status: "ready",
        entityReference: "employee:semantic",
        dependsOnProfileIds: [],
        dependsOnEntityReferences: [],
        cleanup: "none",
        constraints: ["Must be produced by the declared prerequisite case"],
        sourceRefs: ["case:edit-employee"]
      }],
      dependencyOrder: ["entity:employee%3Asemantic"],
      requiresConfirmation: false,
      requiresCleanup: false,
      entityReferences: ["employee:semantic"],
      sourceRefs: ["case:edit-employee"]
    };
    fixture.executableCase.caseDependencyGraph = {
      requirementSetId: fixture.executableCase.requirementSetId,
      systemId: fixture.system.id,
      nodes: [],
      edges: [{
        id: "case-dependency:producer-consumer",
        fromTestIntentId: producerCase.testIntentId,
        toTestIntentId: fixture.executableCase.testIntentId,
        entityReference: "employee:semantic",
        relation: "requires",
        sourceRefs: ["case:edit-employee"]
      }],
      dependencyOrder: [producerCase.testIntentId, fixture.executableCase.testIntentId],
      unresolved: [],
      verdict: "ready",
      sourceRefs: ["case:edit-employee"],
      generatedAt: new Date(0).toISOString()
    };
    const secondConsumerCase: ExecutableCase = {
      ...fixture.executableCase,
      id: "executable-consumer-second",
      testIntentId: "intent-consumer-second",
      title: "Approve employee",
      dataPlan: structuredClone(fixture.executableCase.dataPlan),
      caseDependencyGraph: {
        ...structuredClone(fixture.executableCase.caseDependencyGraph),
        edges: [{
          id: "case-dependency:producer-second-consumer",
          fromTestIntentId: producerCase.testIntentId,
          toTestIntentId: "intent-consumer-second",
          entityReference: "employee:semantic",
          relation: "requires",
          sourceRefs: ["case:approve-employee"]
        }],
        dependencyOrder: [producerCase.testIntentId, "intent-consumer-second"]
      }
    };
    fixture.repository.executableCases.push(secondConsumerCase);
    const consumerSuiteRun = fixture.repository.requirementSuiteRuns[0]!;
    consumerSuiteRun.total = 2;
    consumerSuiteRun.caseRuns.push({
      executableCaseId: secondConsumerCase.id,
      title: secondConsumerCase.title,
      order: 2,
      status: "queued",
      gapIds: [],
      attempts: []
    });
    const producerLease: TestDataLease = {
      id: "lease-employee-producer",
      knowledgeProjectId: fixture.project.id,
      systemId: fixture.system.id,
      executableCaseId: producerCase.id,
      requirementSuiteRunId,
      profileId: "profile-employee",
      taskId: "task-employee-producer",
      decision: "create",
      reference: "employee:001",
      entityReference: "employee:semantic",
      cleanup: "delete-created",
      status: "active",
      sourceRefs: ["case:create-employee"],
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString()
    };
    fixture.repository.testDataLeases.push(producerLease);
    fixture.repository.executionEvidence.push(executionEvidence(
      producerCase.id,
      "evidence-producer-created-entity",
      new Date(0).toISOString(),
      new Date().toISOString()
    ));

    const producerCleanupCheck = await fixture.provider.prepare({
      knowledgeProjectId: fixture.project.id,
      systemId: fixture.system.id,
      executableCaseId: producerCase.id,
      confirm: true,
      phase: "cleanup"
    });
    expect(producerCleanupCheck).toEqual({ status: "ready", operations: [] });
    expect(producerLease.status).toBe("active");

    fixture.repository.executionEvidence.push(executionEvidence(
      fixture.executableCase.id,
      "evidence-consumer-old",
      new Date(0).toISOString(),
      new Date(0).toISOString()
    ));

    const preview = await fixture.provider.prepare({
      knowledgeProjectId: fixture.project.id,
      systemId: fixture.system.id,
      executableCaseId: fixture.executableCase.id,
      requirementSuiteRunId,
      confirm: false
    });

    expect(preview).toEqual({ status: "ready", operations: [] });
    expect(fixture.repository.testDataLeases).toHaveLength(1);

    const result = await fixture.provider.prepare({
      knowledgeProjectId: fixture.project.id,
      systemId: fixture.system.id,
      executableCaseId: fixture.executableCase.id,
      requirementSuiteRunId,
      confirm: true
    });

    expect(result).toEqual({ status: "ready", operations: [] });
    expect(fixture.repository.testDataTasks).toHaveLength(0);
    const consumerLease = fixture.repository.testDataLeases.find(
      (lease) => lease.reusedFromLeaseId === producerLease.id
    );
    expect(consumerLease).toEqual(expect.objectContaining({
      decision: "reuse",
      executableCaseId: fixture.executableCase.id,
      reference: producerLease.reference,
      entityReference: "employee:semantic",
      requirementSuiteRunId,
      status: "active"
    }));

    fixture.repository.executionEvidence.push({
      ...executionEvidence(
        fixture.executableCase.id,
        "evidence-consumer-old-suite",
        new Date(0).toISOString(),
        new Date(Date.now() + 5000).toISOString()
      ),
      requirementSuiteRunId: "suite-consumer-old"
    });
    const historicalCleanupCheck = await fixture.provider.prepare({
      knowledgeProjectId: fixture.project.id,
      systemId: fixture.system.id,
      executableCaseId: fixture.executableCase.id,
      requirementSuiteRunId,
      confirm: true,
      phase: "cleanup"
    });
    expect(historicalCleanupCheck).toEqual({ status: "ready", operations: [] });
    expect(consumerLease?.status).toBe("active");
    expect(producerLease.status).toBe("active");

    fixture.repository.executionEvidence.push({
      ...executionEvidence(
        fixture.executableCase.id,
        "evidence-consumer-current",
        new Date().toISOString(),
        new Date(Date.now() + 1000).toISOString()
      ),
      requirementSuiteRunId
    });
    const consumerCleanupPreview = await fixture.provider.prepare({
      knowledgeProjectId: fixture.project.id,
      systemId: fixture.system.id,
      executableCaseId: fixture.executableCase.id,
      requirementSuiteRunId,
      confirm: false,
      phase: "cleanup"
    });
    expect(consumerCleanupPreview).toEqual({ status: "ready", operations: [] });
    expect(consumerLease?.status).toBe("active");
    expect(producerLease.status).toBe("active");

    const firstConsumerCleanupCheck = await fixture.provider.prepare({
      knowledgeProjectId: fixture.project.id,
      systemId: fixture.system.id,
      executableCaseId: fixture.executableCase.id,
      requirementSuiteRunId,
      confirm: true,
      phase: "cleanup"
    });
    expect(firstConsumerCleanupCheck).toEqual({ status: "ready", operations: [] });
    expect(consumerLease?.status).toBe("released");
    expect(producerLease.status).toBe("active");

    const secondConsumerPreparation = await fixture.provider.prepare({
      knowledgeProjectId: fixture.project.id,
      systemId: fixture.system.id,
      executableCaseId: secondConsumerCase.id,
      requirementSuiteRunId,
      confirm: true
    });
    expect(secondConsumerPreparation).toEqual({ status: "ready", operations: [] });
    const secondConsumerLease = fixture.repository.testDataLeases.find(
      (lease) => lease.executableCaseId === secondConsumerCase.id && lease.reusedFromLeaseId === producerLease.id
    );
    expect(secondConsumerLease).toEqual(expect.objectContaining({ status: "active", requirementSuiteRunId }));
    fixture.repository.executionEvidence.push({
      ...executionEvidence(
        secondConsumerCase.id,
        "evidence-consumer-second-current",
        new Date().toISOString(),
        new Date(Date.now() + 1000).toISOString()
      ),
      requirementSuiteRunId
    });

    const cleanup = await fixture.provider.prepare({
      knowledgeProjectId: fixture.project.id,
      systemId: fixture.system.id,
      executableCaseId: secondConsumerCase.id,
      requirementSuiteRunId,
      confirm: true,
      phase: "cleanup"
    });
    expect(cleanup).toEqual(expect.objectContaining({
      status: "needs-agent-execution",
      task: expect.objectContaining({ action: "cleanup", leaseId: producerLease.id })
    }));
    expect(secondConsumerLease?.status).toBe("released");
    await submitDataTask(fixture, {
      taskId: cleanup.task!.id,
      status: "succeeded",
      sourceRefs: ["api:cleanup/employee-001"]
    });
    expect(producerLease.status).toBe("released");
  });

  it("previews unresolved lookup work without creating a task", async () => {
    const fixture = await providerFixture();

    const result = await fixture.provider.prepare({
      knowledgeProjectId: fixture.project.id,
      systemId: fixture.system.id,
      executableCaseId: fixture.executableCase.id,
      confirm: false
    });

    expect(result.status).toBe("preview");
    expect(result.operations).toEqual([
      expect.objectContaining({
        profileId: "profile-customer",
        field: "Customer",
        lookupQuery: "status=active",
        allowedDecisions: ["reuse"]
      })
    ]);
    expect(fixture.repository.testDataTasks).toHaveLength(0);
  });

  it("keeps the semantic entity reference visible while preparing provider work", async () => {
    const fixture = await providerFixture();
    fixture.executableCase.dataPlan!.operations[0].entityReference = "customer:active-42";

    const result = await fixture.provider.prepare({
      knowledgeProjectId: fixture.project.id,
      systemId: fixture.system.id,
      executableCaseId: fixture.executableCase.id,
      confirm: true,
      allowCreate: true
    });

    expect(result.operations[0]).toEqual(expect.objectContaining({
      entityReference: "customer:active-42"
    }));
    expect(result.task).toEqual(expect.objectContaining({
      entityReference: "customer:active-42"
    }));
    expect(await readFile(result.task!.contextPath, "utf8")).toContain(
      "customer:active-42"
    );
  });

  it("automatically resolves deterministic generated data without touching the target system", async () => {
    const fixture = await providerFixture();
    fixture.executableCase.dataPlan = {
      verdict: "ready",
      reasons: [],
      operations: [{
        profileId: "profile-name",
        field: "Name",
        strategy: "generated",
        decision: "generate",
        status: "proposed",
        value: "bc-name-1234",
        dependsOnProfileIds: [],
        cleanup: "none",
        constraints: [],
        sourceRefs: ["test-data-profile:profile-name"]
      }],
      dependencyOrder: ["profile-name"],
      requiresConfirmation: true,
      confirmedAt: new Date(0).toISOString(),
      requiresCleanup: false,
      sourceRefs: ["test-data-profile:profile-name"]
    };
    fixture.executableCase.steps = [{
      id: "step-name",
      order: 1,
      action: "fill",
      instruction: "Fill Name",
      targetSemantic: "Name",
      dataProfileId: "profile-name",
      value: undefined,
      origin: "source",
      sourceRefs: ["requirement:customer"]
    }];

    const result = await fixture.provider.prepare({
      knowledgeProjectId: fixture.project.id,
      systemId: fixture.system.id,
      executableCaseId: fixture.executableCase.id,
      confirm: true,
      automatic: true
    });

    expect(result).toEqual({
      status: "ready",
      operations: [],
      autoResolvedProfileIds: ["profile-name"]
    });
    expect(fixture.repository.testDataTasks).toHaveLength(0);
    expect(fixture.executableCase.dataPlan?.operations[0]).toEqual(
      expect.objectContaining({
        decision: "use-fixed",
        status: "ready",
        value: "bc-name-1234"
      })
    );
    expect(fixture.executableCase.steps[0].value).toBe("bc-name-1234");
  });

  it("does not let automatic resolution bypass the data-plan confirmation gate", async () => {
    const fixture = await providerFixture();
    fixture.executableCase.dataPlan = {
      verdict: "ready",
      reasons: [],
      operations: [{
        profileId: "profile-name",
        field: "Name",
        strategy: "generated",
        decision: "generate",
        status: "proposed",
        value: "bc-name-1234",
        dependsOnProfileIds: [],
        cleanup: "none",
        constraints: [],
        sourceRefs: ["test-data-profile:profile-name"]
      }],
      dependencyOrder: ["profile-name"],
      requiresConfirmation: true,
      requiresCleanup: false,
      sourceRefs: ["test-data-profile:profile-name"]
    };

    await expect(
      fixture.provider.prepare({
        knowledgeProjectId: fixture.project.id,
        systemId: fixture.system.id,
        executableCaseId: fixture.executableCase.id,
        confirm: true,
        automatic: true
      })
    ).rejects.toThrow("must be confirmed");
  });

  it("creates one idempotent host-agent task with auditable input artifacts", async () => {
    const fixture = await providerFixture();
    const input = {
      knowledgeProjectId: fixture.project.id,
      systemId: fixture.system.id,
      executableCaseId: fixture.executableCase.id,
      confirm: true,
      allowCreate: true
    } as const;

    const first = await fixture.provider.prepare(input);
    const second = await fixture.provider.prepare(input);

    expect(first.status).toBe("needs-agent-execution");
    expect(second.task?.id).toBe(first.task?.id);
    expect(fixture.repository.testDataTasks).toHaveLength(1);
    expect(first.task).toEqual(
      expect.objectContaining({
        action: "lookup-or-create",
        allowCreate: true,
        cleanup: "delete-created",
        status: "pending"
      })
    );
    await access(first.task!.contextPath);
    await access(first.task!.promptPath);
    expect(await readFile(first.task!.promptPath, "utf8")).toContain(
      "Do not create data unless lookup cannot satisfy the request"
    );
    const prompt = await readFile(first.task!.promptPath, "utf8");
    expect(prompt).toContain(`Stable idempotency key: ${first.task!.idempotencyKey}`);
    expect(prompt).toContain("Mark the task sent before the first external write");
  });

  it("requires read-only reconciliation before retrying an uncertain data write", async () => {
    const fixture = await providerFixture({ cleanup: "delete-created" });
    const input = {
      knowledgeProjectId: fixture.project.id,
      systemId: fixture.system.id,
      executableCaseId: fixture.executableCase.id,
      confirm: true,
      allowCreate: true
    } as const;
    const prepared = await fixture.provider.prepare(input);
    const task = prepared.task!;
    fixture.provider.markSent(task.id);

    expect(() => fixture.provider.markSent(task.id)).toThrow(/reconcile/i);
    const resumed = await fixture.provider.prepare(input);
    expect(resumed).toMatchObject({ status: "reconciliation-required", task: { id: task.id } });
    await expect(fixture.provider.submit({
      taskId: task.id,
      status: "failed",
      error: "The response was lost",
      sourceRefs: ["provider:timeout"]
    })).rejects.toThrow(/read-only evidence/i);

    await fixture.provider.reconcileNotApplied(task.id, ["operator-note:lookup-attempt"]);
    expect(task.reconciliationVerification).toEqual(expect.objectContaining({
      provider: "fixture-target-query",
      query: "status=active",
      evidenceRefs: ["system-query:customer-not-found"],
      artifactHashes: [{
        path: `testdata-reconciliation/${task.id}.json`,
        sha256: expect.stringMatching(/^[a-f0-9]{64}$/)
      }]
    }));
    expect(task.reconciliationSourceRefs).toEqual(["system-query:customer-not-found"]);
    expect(task.reconciliationContextRefs).toEqual(["operator-note:lookup-attempt"]);
    const retry = await fixture.provider.prepare(input);
    expect(retry).toMatchObject({ status: "needs-agent-execution", task: { id: task.id } });
    const submitted = await submitDataTask(fixture, {
      taskId: task.id,
      status: "succeeded",
      decision: "create",
      reference: "customer:retried-once",
      sourceRefs: ["system-query:customer-created"]
    });

    expect(fixture.repository.testDataTasks).toHaveLength(1);
    expect(submitted.task.operationPhase).toBe("reconciled-applied");
    expect(submitted.task.outputSourceRefs).toEqual(expect.arrayContaining([
      "system-query:customer-not-found",
      "system-query:customer-created",
      "fixture-target-query:customer:retried-once"
    ]));
  });

  it("reconciles an already-applied cleanup without dispatching a second cleanup", async () => {
    let runtimeDir = "";
    const fixture = await providerFixture({
      cleanup: "delete-created",
      noEffectVerifier: async ({ task, system, query }) => {
        const evidencePath = `testdata-reconciliation/${task.id}.json`;
        const checkedAt = new Date().toISOString();
        const contents = JSON.stringify({
          schemaVersion: 1,
          type: "testdata-no-effect-observation",
          systemId: system.id,
          query,
          result: "absent",
          matchCount: 0,
          provider: "fixture-target-query",
          checkedAt
        });
        await mkdir(join(runtimeDir, "testdata-reconciliation"), { recursive: true });
        await writeFile(join(runtimeDir, evidencePath), contents, "utf8");
        return {
          status: "absent",
          provider: "fixture-target-query",
          query,
          evidenceRefs: ["system-query:cleanup-entity-absent"],
          evidenceArtifacts: [{ path: evidencePath, sha256: createHash("sha256").update(contents).digest("hex") }],
          checkedAt
        };
      }
    });
    runtimeDir = fixture.runtimeDir;
    const prepared = await fixture.provider.prepare({
      knowledgeProjectId: fixture.project.id,
      systemId: fixture.system.id,
      executableCaseId: fixture.executableCase.id,
      confirm: true,
      allowCreate: true
    });
    const created = await submitDataTask(fixture, {
      taskId: prepared.task!.id,
      status: "succeeded",
      decision: "create",
      reference: "customer:created-before-interrupt",
      value: "Created customer",
      sourceRefs: ["system-write:customer-created"]
    });
    fixture.repository.executionEvidence.push(executionEvidence(
      fixture.executableCase.id,
      "evidence-before-cleanup",
      created.lease!.createdAt,
      new Date(Date.now() + 1000).toISOString()
    ));
    const cleanup = await fixture.provider.prepare({
      knowledgeProjectId: fixture.project.id,
      systemId: fixture.system.id,
      executableCaseId: fixture.executableCase.id,
      confirm: true,
      phase: "cleanup"
    });
    expect(cleanup.cleanupNotice?.message).toContain("customer:created-before-interrupt");
    expect(cleanup.cleanupNotice?.message).toContain("remove the test-created record");
    expect(cleanup.nextAction).toContain("before marking the task sent");
    const cleanupTask = cleanup.task!;
    expect(await readFile(cleanupTask.promptPath, "utf8")).toContain(
      "confirm-cleanup-notice"
    );
    expect(() => fixture.provider.markSent(cleanupTask.id)).toThrow(/advance notice/i);
    expect(() => fixture.provider.acknowledgeCleanupNotice(cleanupTask.id, "0".repeat(64)))
      .toThrow(/digest does not match/i);
    fixture.provider.acknowledgeCleanupNotice(cleanupTask.id, cleanup.cleanupNotice!.sha256);
    fixture.provider.markSent(cleanupTask.id);

    const reconciled = await fixture.provider.reconcileNotApplied(cleanupTask.id, [
      "operator-note:cleanup-response-lost"
    ]);

    expect(reconciled).toEqual(expect.objectContaining({
      action: "cleanup",
      status: "submitted",
      operationPhase: "reconciled-applied",
      reconciliationVerification: expect.objectContaining({
        query: "customer:created-before-interrupt"
      })
    }));
    expect(created.lease?.status).toBe("released");
    expect(fixture.repository.testDataTasks.filter((task) => task.action === "cleanup")).toHaveLength(1);
    expect(await fixture.provider.prepare({
      knowledgeProjectId: fixture.project.id,
      systemId: fixture.system.id,
      executableCaseId: fixture.executableCase.id,
      confirm: true,
      phase: "cleanup"
    })).toEqual({ status: "ready", operations: [] });
  });

  it("keeps uncertain data writes blocked when no target-backed verifier is configured", async () => {
    const fixture = await providerFixture({ noEffectVerifier: false });
    const prepared = await fixture.provider.prepare({
      knowledgeProjectId: fixture.project.id,
      systemId: fixture.system.id,
      executableCaseId: fixture.executableCase.id,
      confirm: true,
      allowCreate: true
    });
    const task = prepared.task!;
    fixture.provider.markSent(task.id);

    await expect(fixture.provider.reconcileNotApplied(task.id, ["system-query:customer-not-found"]))
      .rejects.toThrow("target-backed read-only no-effect verifier is not configured");
    expect(task.operationPhase).toBe("sent");
    expect(task.reconciliationVerification).toBeUndefined();
    expect(await fixture.provider.prepare({
      knowledgeProjectId: fixture.project.id,
      systemId: fixture.system.id,
      executableCaseId: fixture.executableCase.id,
      confirm: true,
      allowCreate: true
    })).toMatchObject({
      status: "reconciliation-required",
      task: { id: task.id, operationPhase: "sent" }
    });
  });

  it("rejects no-effect verification when the task target is outside its project binding", async () => {
    const fixture = await providerFixture();
    const prepared = await fixture.provider.prepare({
      knowledgeProjectId: fixture.project.id,
      systemId: fixture.system.id,
      executableCaseId: fixture.executableCase.id,
      confirm: true,
      allowCreate: true
    });
    const task = prepared.task!;
    fixture.provider.markSent(task.id);
    fixture.repository.systemProfiles.push({
      ...fixture.system,
      id: "system-other",
      name: "Other Customer Portal"
    });
    task.systemId = "system-other";

    await expect(fixture.provider.reconcileNotApplied(task.id, ["operator-note:lookup-attempt"]))
      .rejects.toThrow("target system is not bound to the task knowledge project");
    expect(task.operationPhase).toBe("sent");
    expect(task.reconciliationVerification).toBeUndefined();
  });

  it("rejects no-effect evidence whose artifact hash does not match the file", async () => {
    let fixtureRuntimeDir = "";
    const fixture = await providerFixture({
      noEffectVerifier: async ({ task, query }) => {
        const evidencePath = `testdata-reconciliation/${task.id}.json`;
        await mkdir(join(fixtureRuntimeDir, "testdata-reconciliation"), { recursive: true });
        await writeFile(join(fixtureRuntimeDir, evidencePath), JSON.stringify({ query, status: "absent" }), "utf8");
        return {
          status: "absent",
          provider: "fixture-target-query",
          query,
          evidenceRefs: ["system-query:customer-not-found"],
          evidenceArtifacts: [{ path: evidencePath, sha256: "0".repeat(64) }],
          checkedAt: new Date().toISOString()
        };
      }
    });
    fixtureRuntimeDir = fixture.runtimeDir;
    const prepared = await fixture.provider.prepare({
      knowledgeProjectId: fixture.project.id,
      systemId: fixture.system.id,
      executableCaseId: fixture.executableCase.id,
      confirm: true,
      allowCreate: true
    });
    const task = prepared.task!;
    fixture.provider.markSent(task.id);

    await expect(fixture.provider.reconcileNotApplied(task.id, []))
      .rejects.toThrow("No-effect verifier evidence is unreadable or invalid");
    expect(task.operationPhase).toBe("sent");
    expect(task.reconciliationVerification).toBeUndefined();
  });

  it("rejects hash-valid observation artifacts that do not prove the exact absent query", async () => {
    let fixtureRuntimeDir = "";
    const fixture = await providerFixture({
      noEffectVerifier: async ({ task, system, query }) => {
        const evidencePath = `testdata-reconciliation/${task.id}.json`;
        const checkedAt = new Date().toISOString();
        const contents = JSON.stringify({
          schemaVersion: 1,
          type: "testdata-no-effect-observation",
          systemId: system.id,
          query: "different-query",
          result: "absent",
          matchCount: 0,
          provider: "fixture-target-query",
          checkedAt
        });
        await mkdir(join(fixtureRuntimeDir, "testdata-reconciliation"), { recursive: true });
        await writeFile(join(fixtureRuntimeDir, evidencePath), contents, "utf8");
        return {
          status: "absent",
          provider: "fixture-target-query",
          query,
          evidenceRefs: ["system-query:customer-not-found"],
          evidenceArtifacts: [{ path: evidencePath, sha256: createHash("sha256").update(contents).digest("hex") }],
          checkedAt
        };
      }
    });
    fixtureRuntimeDir = fixture.runtimeDir;
    const prepared = await fixture.provider.prepare({
      knowledgeProjectId: fixture.project.id,
      systemId: fixture.system.id,
      executableCaseId: fixture.executableCase.id,
      confirm: true,
      allowCreate: true
    });
    const task = prepared.task!;
    fixture.provider.markSent(task.id);

    await expect(fixture.provider.reconcileNotApplied(task.id, []))
      .rejects.toThrow("No-effect verifier evidence does not match the target, query, unique entity state, or action phase");
    expect(task.operationPhase).toBe("sent");
  });

  it("rejects creation unless the caller explicitly allowed it", async () => {
    const fixture = await providerFixture();
    const prepared = await fixture.provider.prepare({
      knowledgeProjectId: fixture.project.id,
      systemId: fixture.system.id,
      executableCaseId: fixture.executableCase.id,
      confirm: true
    });

    await expect(
      submitDataTask(fixture, {
        taskId: prepared.task!.id,
        status: "succeeded",
        decision: "create",
        reference: "customer:new-1",
        value: "New Customer",
        sourceRefs: ["browser:evidence/customer-new-1.json"]
      })
    ).rejects.toThrow("not allowed");
  });

  it("resolves the executable case from a reused data reference and records a lease", async () => {
    const fixture = await providerFixture();
    const prepared = await fixture.provider.prepare({
      knowledgeProjectId: fixture.project.id,
      systemId: fixture.system.id,
      executableCaseId: fixture.executableCase.id,
      confirm: true
    });

    const result = await submitDataTask(fixture, {
      taskId: prepared.task!.id,
      status: "succeeded",
      decision: "reuse",
      reference: "customer:42",
      value: "Existing Customer",
      sourceRefs: ["api:customers/42"]
    });

    expect(result.task.status).toBe("submitted");
    expect(result.lease).toEqual(
      expect.objectContaining({
        decision: "reuse",
        reference: "customer:42",
        cleanup: "none",
        status: "active",
        sourceRefs: expect.arrayContaining([
          "api:customers/42",
          "fixture-target-query:customer:42"
        ])
      })
    );
    expect(result.executableCase.dataPlan).toEqual(
      expect.objectContaining({ verdict: "ready" })
    );
    expect(result.executableCase.status).toBe("ready");
    expect(fixture.repository.gaps[0].status).toBe("resolved");

    fixture.repository.executionEvidence.push({
      id: "evidence-reuse-terminal",
      knowledgeProjectId: fixture.project.id,
      systemId: fixture.system.id,
      executableCaseId: fixture.executableCase.id,
      testCaseId: "case-reuse-terminal",
      contextPackPath: "context.json",
      status: "passed",
      steps: [],
      tracePaths: [],
      artifactPaths: [],
      consoleErrors: [],
      networkFailures: [],
      createdAt: new Date().toISOString(),
      completedAt: new Date().toISOString()
    });
    const reacquire = await fixture.provider.prepare({
      knowledgeProjectId: fixture.project.id,
      systemId: fixture.system.id,
      executableCaseId: fixture.executableCase.id,
      confirm: true
    });

    expect(result.lease!.status).toBe("released");
    expect(reacquire).toEqual(
      expect.objectContaining({
        status: "needs-agent-execution",
        task: expect.objectContaining({
          action: "lookup-or-create",
          profileId: "profile-customer",
          status: "pending"
        })
      })
    );
  });

  it("does not create a ready lease from host references without a unique target lookup", async () => {
    const fixture = await providerFixture();
    const prepared = await fixture.provider.prepare({
      knowledgeProjectId: fixture.project.id,
      systemId: fixture.system.id,
      executableCaseId: fixture.executableCase.id,
      confirm: true
    });
    fixture.provider.markSent(prepared.task!.id);

    await expect(fixture.provider.submit({
      taskId: prepared.task!.id,
      status: "succeeded",
      decision: "reuse",
      reference: "customer:not-present",
      sourceRefs: ["host-assertion:customer-not-present"]
    })).rejects.toThrow("exactly one entity is required");

    expect(fixture.repository.testDataLeases).toEqual([]);
    expect(fixture.executableCase.status).toBe("blocked");
    expect(fixture.repository.businessEntityInstances).toEqual([]);
  });

  it("does not choose the first entity when target verification returns multiple matches", async () => {
    const fixture = await providerFixture();
    const prepared = await fixture.provider.prepare({
      knowledgeProjectId: fixture.project.id,
      systemId: fixture.system.id,
      executableCaseId: fixture.executableCase.id,
      confirm: true
    });
    fixture.provider.markSent(prepared.task!.id);
    fixture.targetProvider.lookup = async () => [
      { status: "found", reference: "customer:match-1", sourceRefs: ["target-query:customers"] },
      { status: "found", reference: "customer:match-2", sourceRefs: ["target-query:customers"] }
    ];

    await expect(fixture.provider.submit({
      taskId: prepared.task!.id,
      status: "succeeded",
      decision: "reuse",
      reference: "customer:match-1",
      sourceRefs: ["host-assertion:customer-match-1"]
    })).rejects.toThrow("returned 2 matches");

    expect(fixture.repository.testDataLeases).toEqual([]);
    expect(fixture.executableCase.status).toBe("blocked");
    expect(fixture.repository.businessEntityInstances).toEqual([]);
  });

  it("does not lease a target entity whose queried business value differs", async () => {
    const fixture = await providerFixture();
    const prepared = await fixture.provider.prepare({
      knowledgeProjectId: fixture.project.id,
      systemId: fixture.system.id,
      executableCaseId: fixture.executableCase.id,
      confirm: true
    });
    await fixture.targetProvider.create({
      knowledgeProjectId: fixture.project.id,
      systemId: fixture.system.id,
      entityType: "customer",
      reference: "customer:wrong-value",
      values: { Customer: "Different Customer" },
      sourceRefs: ["fixture-seed:wrong-value"]
    });
    fixture.provider.markSent(prepared.task!.id);

    await expect(fixture.provider.submit({
      taskId: prepared.task!.id,
      status: "succeeded",
      decision: "reuse",
      reference: "customer:wrong-value",
      value: "Expected Customer",
      sourceRefs: ["host-assertion:expected-customer"]
    })).rejects.toThrow("expected business values");

    expect(fixture.repository.testDataLeases).toEqual([]);
    expect(fixture.executableCase.status).toBe("blocked");
    expect(fixture.repository.businessEntityInstances).toEqual([]);
  });

  it("keeps a case stale after its data is resolved", async () => {
    const fixture = await providerFixture();
    fixture.executableCase.status = "stale";
    fixture.executableCase.staleReason = "System Brain transition changed";
    fixture.executableCase.staleByChangeSetId = "change-set-1";
    fixture.repository.testIntents[0].status = "stale";

    const prepared = await fixture.provider.prepare({
      knowledgeProjectId: fixture.project.id,
      systemId: fixture.system.id,
      executableCaseId: fixture.executableCase.id,
      confirm: true
    });
    const result = await submitDataTask(fixture, {
      taskId: prepared.task!.id,
      status: "succeeded",
      decision: "reuse",
      reference: "customer:stale-case",
      sourceRefs: ["api:customers/stale-case"]
    });

    expect(result.executableCase.status).toBe("stale");
    expect(fixture.repository.testIntents[0].status).toBe("stale");
  });

  it("requires cleanup policy and evidence for created data", async () => {
    const fixture = await providerFixture({ cleanup: "none" });
    await expect(
      fixture.provider.prepare({
        knowledgeProjectId: fixture.project.id,
        systemId: fixture.system.id,
        executableCaseId: fixture.executableCase.id,
        confirm: true,
        allowCreate: true
      })
    ).rejects.toThrow("cleanup policy");

    const prepared = await fixture.provider.prepare({
      knowledgeProjectId: fixture.project.id,
      systemId: fixture.system.id,
      executableCaseId: fixture.executableCase.id,
      confirm: true
    });
    await expect(
      submitDataTask(fixture, {
        taskId: prepared.task!.id,
        status: "succeeded",
        decision: "reuse",
        reference: "customer:42",
        sourceRefs: []
      })
    ).rejects.toThrow("source evidence");
  });

  it("creates a provider gap when the host agent cannot prepare data", async () => {
    const fixture = await providerFixture();
    const prepared = await fixture.provider.prepare({
      knowledgeProjectId: fixture.project.id,
      systemId: fixture.system.id,
      executableCaseId: fixture.executableCase.id,
      confirm: true
    });

    const result = await submitFailedDataTask(fixture, {
      taskId: prepared.task!.id,
      status: "failed",
      error: "Customer API is unavailable",
      sourceRefs: ["network:customers-timeout"]
    });

    expect(result.task.status).toBe("failed");
    expect(result.gap).toEqual(
      expect.objectContaining({
        sourceType: "test-data-provider",
        sourceId: prepared.task!.id,
        status: "open",
        reason: expect.stringContaining("Customer API is unavailable")
      })
    );
    expect(fixture.executableCase.status).toBe("blocked");

    const retry = await fixture.provider.prepare({
      knowledgeProjectId: fixture.project.id,
      systemId: fixture.system.id,
      executableCaseId: fixture.executableCase.id,
      confirm: true
    });
    const recovered = await submitDataTask(fixture, {
      taskId: retry.task!.id,
      status: "succeeded",
      decision: "reuse",
      reference: "customer:42",
      sourceRefs: ["api:customers/42"]
    });

    expect(result.gap!.status).toBe("resolved");
    expect(recovered.executableCase.status).toBe("ready");
  });

  it("prepares cleanup after terminal execution and releases created data", async () => {
    const fixture = await providerFixture();
    const prepared = await fixture.provider.prepare({
      knowledgeProjectId: fixture.project.id,
      systemId: fixture.system.id,
      executableCaseId: fixture.executableCase.id,
      confirm: true,
      allowCreate: true
    });
    const submitted = await submitDataTask(fixture, {
      taskId: prepared.task!.id,
      status: "succeeded",
      decision: "create",
      reference: "customer:new-3",
      value: "New Customer",
      sourceRefs: ["browser:create/customer-new-3.json"]
    });
    fixture.repository.executionEvidence.push({
      id: "evidence-1",
      knowledgeProjectId: fixture.project.id,
      systemId: fixture.system.id,
      executableCaseId: fixture.executableCase.id,
      testCaseId: "case-1",
      contextPackPath: "context.json",
      status: "passed",
      steps: [],
      tracePaths: [],
      artifactPaths: [],
      consoleErrors: [],
      networkFailures: [],
      completedAt: new Date().toISOString(),
      createdAt: new Date().toISOString()
    });

    const cleanup = await fixture.provider.prepare({
      knowledgeProjectId: fixture.project.id,
      systemId: fixture.system.id,
      executableCaseId: fixture.executableCase.id,
      confirm: true
    });

    expect(cleanup.task).toEqual(
      expect.objectContaining({
        action: "cleanup",
        leaseId: submitted.lease!.id,
        status: "pending"
      })
    );
    const completed = await submitDataTask(fixture, {
      taskId: cleanup.task!.id,
      status: "succeeded",
      sourceRefs: ["browser:cleanup/customer-new-3.json"]
    });
    expect(completed.lease).toEqual(
      expect.objectContaining({ status: "released", releasedAt: expect.any(String) })
    );
  });

  it("does not release a created-data lease from cleanup source references alone", async () => {
    const fixture = await providerFixture();
    const prepared = await fixture.provider.prepare({
      knowledgeProjectId: fixture.project.id,
      systemId: fixture.system.id,
      executableCaseId: fixture.executableCase.id,
      confirm: true,
      allowCreate: true
    });
    const created = await submitDataTask(fixture, {
      taskId: prepared.task!.id,
      status: "succeeded",
      decision: "create",
      reference: "customer:cleanup-check",
      sourceRefs: ["host-write:customer-created"]
    });
    fixture.repository.executionEvidence.push(executionEvidence(
      fixture.executableCase.id,
      "evidence-cleanup-check",
      created.lease!.createdAt,
      new Date(Date.now() + 1000).toISOString()
    ));
    const cleanup = await fixture.provider.prepare({
      knowledgeProjectId: fixture.project.id,
      systemId: fixture.system.id,
      executableCaseId: fixture.executableCase.id,
      confirm: true
    });
    acknowledgeCleanupNoticeIfNeeded(fixture, cleanup.task!.id);
    fixture.provider.markSent(cleanup.task!.id);

    await expect(fixture.provider.submit({
      taskId: cleanup.task!.id,
      status: "succeeded",
      sourceRefs: ["host-write:cleanup-returned-success"]
    })).rejects.toThrow("target-backed evidence");

    expect(created.lease!.status).toBe("active");
    expect(cleanup.task!.status).toBe("pending");
  });

  it("releases reused data during cleanup without dispatching a new lookup", async () => {
    const fixture = await providerFixture();
    const prepared = await fixture.provider.prepare({
      knowledgeProjectId: fixture.project.id,
      systemId: fixture.system.id,
      executableCaseId: fixture.executableCase.id,
      confirm: true
    });
    const submitted = await submitDataTask(fixture, {
      taskId: prepared.task!.id,
      status: "succeeded",
      decision: "reuse",
      reference: "customer:existing-1",
      sourceRefs: ["api:customers/existing-1"]
    });
    fixture.repository.executionEvidence.push({
      id: "evidence-reuse-1",
      knowledgeProjectId: fixture.project.id,
      systemId: fixture.system.id,
      executableCaseId: fixture.executableCase.id,
      testCaseId: "case-reuse-1",
      contextPackPath: "context.json",
      status: "passed",
      steps: [],
      tracePaths: [],
      artifactPaths: [],
      consoleErrors: [],
      networkFailures: [],
      completedAt: new Date().toISOString(),
      createdAt: new Date().toISOString()
    });

    const cleanup = await fixture.provider.prepare({
      knowledgeProjectId: fixture.project.id,
      systemId: fixture.system.id,
      executableCaseId: fixture.executableCase.id,
      confirm: true,
      phase: "cleanup"
    });

    expect(cleanup).toEqual({ status: "ready", operations: [] });
    expect(submitted.lease).toEqual(
      expect.objectContaining({
        status: "released",
        releasedAt: expect.any(String)
      })
    );
    expect(fixture.repository.testDataTasks).toHaveLength(1);
  });

  it("marks cleanup failures separately from product defects", async () => {
    const fixture = await providerFixture();
    const prepared = await fixture.provider.prepare({
      knowledgeProjectId: fixture.project.id,
      systemId: fixture.system.id,
      executableCaseId: fixture.executableCase.id,
      confirm: true,
      allowCreate: true
    });
    const submitted = await submitDataTask(fixture, {
      taskId: prepared.task!.id,
      status: "succeeded",
      decision: "create",
      reference: "customer:new-4",
      sourceRefs: ["api:create/customer-new-4"]
    });
    fixture.repository.executionEvidence.push({
      id: "evidence-2",
      knowledgeProjectId: fixture.project.id,
      systemId: fixture.system.id,
      executableCaseId: fixture.executableCase.id,
      testCaseId: "case-2",
      contextPackPath: "context.json",
      status: "failed",
      steps: [],
      tracePaths: [],
      artifactPaths: [],
      consoleErrors: [],
      networkFailures: [],
      completedAt: new Date().toISOString(),
      createdAt: new Date().toISOString()
    });
    const cleanup = await fixture.provider.prepare({
      knowledgeProjectId: fixture.project.id,
      systemId: fixture.system.id,
      executableCaseId: fixture.executableCase.id,
      confirm: true
    });

    const result = await submitFailedDataTask(fixture, {
      taskId: cleanup.task!.id,
      status: "failed",
      error: "Delete endpoint returned 409",
      sourceRefs: ["api:cleanup/customer-new-4"]
    });

    expect(submitted.lease!.id).toBe(result.lease!.id);
    expect(result.lease!.status).toBe("cleanup-failed");
    expect(result.gap).toEqual(
      expect.objectContaining({ sourceType: "test-data-cleanup" })
    );

    const retry = await fixture.provider.prepare({
      knowledgeProjectId: fixture.project.id,
      systemId: fixture.system.id,
      executableCaseId: fixture.executableCase.id,
      confirm: true
    });
    expect(retry.task).toEqual(
      expect.objectContaining({
        action: "cleanup",
        leaseId: submitted.lease!.id,
        status: "pending"
      })
    );
    expect(retry.task!.id).not.toBe(cleanup.task!.id);

    await submitDataTask(fixture, {
      taskId: retry.task!.id,
      status: "succeeded",
      sourceRefs: ["api:cleanup/customer-new-4-retry"]
    });
    expect(result.gap!.status).toBe("resolved");
  });

  it("rejects a case from another system", async () => {
    const fixture = await providerFixture();

    await expect(
      fixture.provider.prepare({
        knowledgeProjectId: fixture.project.id,
        systemId: "system-other",
        executableCaseId: fixture.executableCase.id,
        confirm: true
      })
    ).rejects.toThrow("system");
  });

  it("records host-created entities and explicit profile dependencies", async () => {
    const fixture = await providerFixture();
    fixture.executableCase.dataPlan = {
      verdict: "blocked",
      reasons: ["Test data requires host resolution"],
      operations: [
        {
          profileId: "profile-employee",
          field: "Employee",
          strategy: "existing-reference",
          decision: "create",
          status: "needs-resolution",
          entityReference: "employee:semantic",
          dependsOnProfileIds: [],
          cleanup: "delete-created",
          constraints: [],
          sourceRefs: ["case:employee"]
        },
        {
          profileId: "profile-offer",
          field: "Offer",
          strategy: "existing-reference",
          decision: "create",
          status: "needs-resolution",
          entityReference: "offer:semantic",
          dependsOnProfileIds: ["profile-employee"],
          cleanup: "delete-created",
          constraints: [],
          sourceRefs: ["case:offer"]
        }
      ],
      dependencyOrder: ["profile-employee", "profile-offer"],
      requiresConfirmation: false,
      requiresCleanup: true,
      sourceRefs: ["case:data"]
    };

    const first = await fixture.provider.prepare({
      knowledgeProjectId: fixture.project.id,
      systemId: fixture.system.id,
      executableCaseId: fixture.executableCase.id,
      confirm: true,
      allowCreate: true
    });
    const employee = await submitDataTask(fixture, {
      taskId: first.task!.id,
      status: "succeeded",
      decision: "create",
      reference: "employee:001",
      value: "testperson001",
      sourceRefs: ["evidence:employee-created"]
    });
    expect(employee.lease?.reference).toBe("employee:001");

    const second = await fixture.provider.prepare({
      knowledgeProjectId: fixture.project.id,
      systemId: fixture.system.id,
      executableCaseId: fixture.executableCase.id,
      confirm: true,
      allowCreate: true
    });
    await submitDataTask(fixture, {
      taskId: second.task!.id,
      status: "succeeded",
      decision: "create",
      reference: "offer:001",
      sourceRefs: ["evidence:offer-created"]
    });

    expect(fixture.testDataBrain.graph(fixture.system.id)).toEqual(expect.objectContaining({
      entities: expect.arrayContaining([
        expect.objectContaining({
          entityKey: "employee:001",
          entityReference: "employee:semantic",
          values: { Employee: "testperson001" },
          status: "active"
        }),
        expect.objectContaining({
          entityKey: "offer:001",
          entityReference: "offer:semantic",
          status: "active"
        })
      ]),
      dependencies: [expect.objectContaining({
        fromReference: "offer:001",
        toReference: "employee:001",
        relation: "requires"
      })]
    }));
  });

  it("does not leave an entity or lease when a required dependency is missing", async () => {
    const fixture = await providerFixture();
    fixture.executableCase.dataPlan = {
      verdict: "blocked",
      reasons: ["Test data requires host resolution"],
      operations: [{
        profileId: "profile-offer",
        field: "Offer",
        strategy: "existing-reference",
        decision: "create",
        status: "needs-resolution",
        dependsOnProfileIds: ["profile-employee"],
        cleanup: "delete-created",
        constraints: [],
        sourceRefs: ["case:offer"]
      }],
      dependencyOrder: ["profile-employee", "profile-offer"],
      requiresConfirmation: false,
      requiresCleanup: true,
      sourceRefs: ["case:data"]
    };

    const prepared = await fixture.provider.prepare({
      knowledgeProjectId: fixture.project.id,
      systemId: fixture.system.id,
      executableCaseId: fixture.executableCase.id,
      confirm: true,
      allowCreate: true
    });

    await expect(submitDataTask(fixture, {
      taskId: prepared.task!.id,
      status: "succeeded",
      decision: "create",
      reference: "offer:missing-parent",
      sourceRefs: ["evidence:offer-created"]
    })).rejects.toThrow("dependency lease");
    expect(fixture.repository.testDataLeases).toHaveLength(0);
    expect(fixture.testDataBrain.graph(fixture.system.id).entities).toHaveLength(0);
  });
});

async function providerFixture(input: {
  cleanup?: "none" | "delete-created" | "restore";
  noEffectVerifier?: boolean | TestDataNoEffectVerifier;
} = {}) {
  const repository = new InMemoryBrainCreatorRepository();
  const root = await tempDir();
  const project: KnowledgeProject = {
    id: "knowledge-customer",
    key: "customer",
    name: "Customer",
    defaultLocale: "en-US",
    status: "active",
    systemIds: ["system-customer"],
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString()
  };
  const system: SystemProfile = {
    id: "system-customer",
    name: "Customer Portal",
    environment: "test",
    baseUrl: "https://customer.example.test",
    defaultLocale: "en-US",
    urlAllowlist: ["https://customer.example.test"],
    status: "succeeded",
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString()
  };
  const intent: TestIntent = {
    id: "intent-customer",
    knowledgeProjectId: project.id,
    requirementSetId: "requirement-customer",
    title: "Use an active customer",
    module: "Customer",
    priority: "P1",
    objective: "Verify a workflow using an active customer.",
    preconditions: [],
    expectedResults: ["The active customer is accepted."],
    requirementRefs: ["requirement:customer"],
    knowledgeNodeRefs: [],
    techniques: ["scenario"],
    status: "blocked",
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString()
  };
  const gap: Gap = {
    id: "gap-customer-data",
    projectId: project.id,
    sourceType: "test-data-plan",
    sourceId: "executable-customer",
    reason: "Customer requires an existing reference.",
    severity: "high",
    owner: "qa",
    status: "open",
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString()
  };
  const executableCase: ExecutableCase = {
    id: "executable-customer",
    knowledgeProjectId: project.id,
    requirementSetId: intent.requirementSetId,
    testIntentId: intent.id,
    systemId: system.id,
    title: intent.title,
    status: "blocked",
    preconditions: [],
    steps: [{
      id: "step-customer",
      order: 1,
      action: "select",
      instruction: "Select Customer",
      targetSemantic: "Customer",
      dataProfileId: "profile-customer",
      origin: "source",
      sourceRefs: ["requirement:customer"]
    }],
    dataProfileIds: ["profile-customer"],
    dataPlan: {
      verdict: "blocked",
      reasons: ["Customer requires lookup before execution."],
      operations: [{
        profileId: "profile-customer",
        field: "Customer",
        strategy: "existing-reference",
        decision: "lookup",
        status: "needs-resolution",
        lookupQuery: "status=active",
        dependsOnProfileIds: [],
        cleanup: input.cleanup ?? "delete-created",
        constraints: ["status must be active"],
        sourceRefs: ["requirement:customer"]
      }],
      dependencyOrder: ["profile-customer"],
      requiresConfirmation: true,
      requiresCleanup: false,
      sourceRefs: ["requirement:customer"]
    },
    gapIds: [gap.id],
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString()
  };
  repository.knowledgeProjects.push(project);
  repository.systemProfiles.push(system);
  repository.testIntents.push(intent);
  repository.gaps.push(gap);
  repository.executableCases.push(executableCase);
  const knowledgeService = new KnowledgeService(repository, join(root, "knowledge"));
  const cleanupResults = new Map<string, "absent" | "present">();
  const targetProvider = new EvidenceBackedFixtureProvider("fixture-provider", system.id);
  const testDataBrain = new TestDataBrainService(repository, [
    targetProvider
  ]);
  const provider = new TestDataProviderService(
    repository,
    knowledgeService,
    join(root, "runtime"),
    testDataBrain,
    input.noEffectVerifier === false ? undefined : typeof input.noEffectVerifier === "function"
      ? input.noEffectVerifier
      : async ({ task, system, query }) => {
      const evidencePath = `testdata-reconciliation/${task.id}.json`;
      const checkedAt = new Date().toISOString();
      const result = task.action === "cleanup" ? cleanupResults.get(task.id) ?? "present" : "absent" as const;
      const contents = JSON.stringify({
        schemaVersion: 1,
        type: "testdata-no-effect-observation",
        systemId: system.id,
        query,
        result,
        matchCount: result === "present" ? 1 : 0,
        ...(result === "present" ? { reference: query } : {}),
        provider: "fixture-target-query",
        checkedAt
      });
      await mkdir(join(root, "runtime", "testdata-reconciliation"), { recursive: true });
      await writeFile(join(root, "runtime", evidencePath), contents, "utf8");
      return {
        status: result,
        provider: "fixture-target-query",
        query,
        evidenceRefs: [task.action === "cleanup"
          ? result === "absent" ? "system-query:cleanup-not-found" : "system-query:cleanup-still-present"
          : "system-query:customer-not-found"],
        evidenceArtifacts: [{ path: evidencePath, sha256: createHash("sha256").update(contents).digest("hex") }],
        checkedAt
      };
    }
  );
  return {
    repository,
    project,
    system,
    intent,
    executableCase,
    provider,
    testDataBrain,
    targetProvider,
    setCleanupResult: (taskId: string, result: "absent" | "present") => cleanupResults.set(taskId, result),
    runtimeDir: join(root, "runtime")
  };
}

type ProviderFixture = Awaited<ReturnType<typeof providerFixture>>;

async function submitDataTask(
  fixture: ProviderFixture,
  input: Parameters<ProviderFixture["provider"]["submit"]>[0]
): Promise<TestDataSubmitResult> {
  if (input.status === "failed") throw new Error("Failed submissions require submitFailedDataTask");
  acknowledgeCleanupNoticeIfNeeded(fixture, input.taskId);
  const task = fixture.repository.testDataTasks.find((item) => item.id === input.taskId);
  if (!task) throw new Error("Fixture test data task not found");
  if (task.action === "cleanup") {
    fixture.setCleanupResult(task.id, "absent");
    fixture.provider.markSent(task.id);
    const completedTask = await fixture.provider.reconcileNotApplied(task.id, input.sourceRefs);
    const executableCase = fixture.repository.executableCases.find((item) => item.id === task.executableCaseId);
    if (!executableCase) throw new Error("Fixture executable case not found");
    const lease = task.leaseId
      ? fixture.repository.testDataLeases.find((item) => item.id === task.leaseId)
      : undefined;
    return { task: completedTask, executableCase, ...(lease ? { lease } : {}) };
  }
  if (!input.reference) throw new Error("Fixture successful test data result requires a reference");
  const seed: TestDataProviderRequest = {
    knowledgeProjectId: task.knowledgeProjectId,
    systemId: task.systemId,
    entityType: input.reference.split(":")[0] || task.field,
    reference: input.reference,
    ...(task.entityReference ? { entityReference: task.entityReference } : {}),
    values: input.value ? { [task.field]: input.value } : {},
    sourceRefs: [`fixture-seed:${task.id}`]
  };
  await fixture.targetProvider.create(seed);
  fixture.provider.markSent(task.id);
  return fixture.provider.submit(input);
}

function acknowledgeCleanupNoticeIfNeeded(fixture: ProviderFixture, taskId: string) {
  const task = fixture.repository.testDataTasks.find((item) => item.id === taskId);
  if (task?.action === "cleanup") {
    fixture.provider.acknowledgeCleanupNotice(task.id, task.cleanupNoticeSha256!);
  }
}

function executionEvidence(executableCaseId: string, evidenceId: string, createdAt: string, completedAt: string) {
  return {
    id: evidenceId,
    knowledgeProjectId: "knowledge-customer",
    systemId: "system-customer",
    executableCaseId,
    testCaseId: evidenceId,
    contextPackPath: "context.json",
    status: "passed" as const,
    steps: [],
    tracePaths: [],
    artifactPaths: [],
    consoleErrors: [],
    networkFailures: [],
    createdAt,
    completedAt
  };
}

async function submitFailedDataTask(
  fixture: ProviderFixture,
  input: Parameters<ProviderFixture["provider"]["submit"]>[0]
) {
  if (input.status !== "failed") throw new Error("submitFailedDataTask requires a failed data task");
  acknowledgeCleanupNoticeIfNeeded(fixture, input.taskId);
  fixture.provider.markSent(input.taskId);
  await fixture.provider.reconcileNotApplied(input.taskId, input.sourceRefs);
  return fixture.provider.submit(input);
}

async function tempDir() {
  const dir = await mkdtemp(join(tmpdir(), "brain-data-provider-"));
  tempDirs.push(dir);
  return dir;
}
