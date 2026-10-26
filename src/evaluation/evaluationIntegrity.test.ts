import { mkdtemp, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { InMemoryBrainCreatorRepository } from "../domain/repository.js";
import { createWorkspaceIntegrityAuthenticator } from "../shared/crypto.js";
import { EvaluationIntegrityService } from "./evaluationIntegrity.js";

describe("EvaluationIntegrityService", () => {
  it("starts an isolated trial with a frozen source and projection", () => {
    const repository = fixtureRepository();
    const service = new EvaluationIntegrityService(repository);

    const result = service.startTrial({
      knowledgeProjectId: "knowledge-1",
      requirementSourceId: "source-1",
      provider: "host-agent",
      comparisonGroupId: "comparison-1",
      workspacePath: "C:/work/host",
      storePath: "C:/work/host/.brain-creator/store",
      codeRevision: "commit-1",
      runtimeVersions: { node: "22.0.0", playwright: "1.55.0" }
    });

    expect(result.trial).toEqual(expect.objectContaining({
      status: "active",
      requirementSourceId: "source-1",
      sourceRevision: 3,
      sourceHash: "source-hash",
      provider: "host-agent"
    }));
    expect(result.sourceSnapshot).toEqual(expect.objectContaining({
      sourceId: "source-1",
      sourceRevision: 3,
      contentHash: "source-hash"
    }));
    expect(result.projectionManifest.projectionHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("authenticates projection manifests with the workspace key and rejects Store edits", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "brain-projection-integrity-"));
    try {
      const repository = fixtureRepository();
      const authenticator = createWorkspaceIntegrityAuthenticator(workspace);
      const service = new EvaluationIntegrityService(repository, authenticator);
      const { trial, projectionManifest } = service.startTrial({
        knowledgeProjectId: "knowledge-1",
        requirementSourceId: "source-1",
        provider: "host-agent",
        comparisonGroupId: "comparison-1",
        workspacePath: workspace,
        storePath: join(workspace, ".brain-creator", "store"),
        codeRevision: "commit-1",
        runtimeVersions: { node: "22.0.0" }
      });
      expect(projectionManifest.integrityTag).toMatch(/^v1:[A-Za-z0-9][A-Za-z0-9._-]{0,63}:[a-f0-9]{64}$/);

      const reloadedService = new EvaluationIntegrityService(
        repository,
        createWorkspaceIntegrityAuthenticator(workspace)
      );
      expect(reloadedService.validateTrial(trial.id, {
        codeRevision: "commit-1",
        runtimeVersions: { node: "22.0.0" }
      }).valid).toBe(true);

      repository.projectionManifests[0]!.operation = "forged-checkpoint";
      const tampered = reloadedService.validateTrial(trial.id, {
        codeRevision: "commit-1",
        runtimeVersions: { node: "22.0.0" }
      });
      expect(tampered.valid).toBe(false);
      expect(tampered.reasons).toContain("Evaluation projection manifest integrity authentication failed");
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  it("authenticates the frozen requirement source snapshot against Store edits", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "brain-source-snapshot-integrity-"));
    try {
      const repository = fixtureRepository();
      const service = new EvaluationIntegrityService(
        repository,
        createWorkspaceIntegrityAuthenticator(workspace)
      );
      const { trial, sourceSnapshot } = service.startTrial({
        knowledgeProjectId: "knowledge-1",
        requirementSourceId: "source-1",
        provider: "host-agent",
        comparisonGroupId: "comparison-1",
        workspacePath: workspace,
        storePath: join(workspace, ".brain-creator", "store"),
        codeRevision: "commit-1",
        runtimeVersions: { node: "22.0.0" }
      });
      sourceSnapshot.semanticInputHash = "0".repeat(64);

      const validation = service.validateTrial(trial.id, {
        codeRevision: "commit-1",
        runtimeVersions: { node: "22.0.0" }
      });

      expect(validation.valid).toBe(false);
      expect(validation.reasons).toContain("Frozen requirement source snapshot integrity authentication failed");
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("fails closed without recreating a missing projection authentication key", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "brain-projection-missing-key-"));
    try {
      const repository = fixtureRepository();
      const service = new EvaluationIntegrityService(
        repository,
        createWorkspaceIntegrityAuthenticator(workspace)
      );
      const { trial } = service.startTrial({
        knowledgeProjectId: "knowledge-1",
        requirementSourceId: "source-1",
        provider: "host-agent",
        comparisonGroupId: "comparison-1",
        workspacePath: workspace,
        storePath: join(workspace, ".brain-creator", "store"),
        codeRevision: "commit-1",
        runtimeVersions: { node: "22.0.0" }
      });
      const keyPath = join(workspace, ".brain-creator", "secret.key");
      await rm(keyPath);

      const validation = service.validateTrial(trial.id, {
        codeRevision: "commit-1",
        runtimeVersions: { node: "22.0.0" }
      });

      expect(validation.valid).toBe(false);
      expect(validation.reasons).toContain("Evaluation projection manifest integrity authentication failed");
      expect(existsSync(keyPath)).toBe(false);
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  it("rejects A/B trials that reuse a store or change the canonical source", () => {
    const repository = fixtureRepository();
    const service = new EvaluationIntegrityService(repository);
    service.startTrial({
      knowledgeProjectId: "knowledge-1",
      requirementSourceId: "source-1",
      provider: "host-agent",
      comparisonGroupId: "comparison-1",
      workspacePath: "C:/work/host",
      storePath: "C:/work/shared/store",
      codeRevision: "commit-1",
      runtimeVersions: { node: "22.0.0" }
    });

    expect(() => service.startTrial({
      knowledgeProjectId: "knowledge-1",
      requirementSourceId: "source-1",
      provider: "builtin",
      comparisonGroupId: "comparison-1",
      workspacePath: "C:/work/builtin",
      storePath: "C:/work/shared/store",
      codeRevision: "commit-1",
      runtimeVersions: { node: "22.0.0" }
    })).toThrow("isolated store");

    expect(() => service.startTrial({
      knowledgeProjectId: "knowledge-1",
      requirementSourceId: "source-1",
      provider: "builtin",
      comparisonGroupId: "comparison-1",
      workspacePath: "C:/work/builtin",
      storePath: "C:/work/builtin/store",
      codeRevision: "commit-2",
      runtimeVersions: { node: "22.0.0" }
    })).toThrow("same code revision");

    repository.requirementSources[0].contentHash = "changed-source";
    expect(() => service.startTrial({
      knowledgeProjectId: "knowledge-1",
      requirementSourceId: "source-1",
      provider: "builtin",
      comparisonGroupId: "comparison-1",
      workspacePath: "C:/work/builtin",
      storePath: "C:/work/builtin/store",
      codeRevision: "commit-1",
      runtimeVersions: { node: "22.0.0" }
    })).toThrow("same source revision and hash");
  });

  it("invalidates a trial when source, code, or projection drifts", () => {
    const repository = fixtureRepository();
    const service = new EvaluationIntegrityService(repository);
    const { trial } = service.startTrial({
      knowledgeProjectId: "knowledge-1",
      requirementSourceId: "source-1",
      provider: "host-agent",
      comparisonGroupId: "comparison-1",
      workspacePath: "C:/work/host",
      storePath: "C:/work/host/store",
      codeRevision: "commit-1",
      runtimeVersions: { node: "22.0.0" }
    });

    repository.testIntents.push({
      id: "intent-out-of-band",
      knowledgeProjectId: "knowledge-1",
      requirementSetId: "requirement-1",
      title: "Injected",
      module: "Orders",
      priority: "P1",
      objective: "Injected outside the Facade",
      preconditions: [],
      expectedResults: [],
      requirementRefs: ["source:1"],
      knowledgeNodeRefs: [],
      techniques: [],
      coverageDimensions: [],
      status: "draft",
      createdAt: "2026-09-01T00:00:00.000Z",
      updatedAt: "2026-09-01T00:00:00.000Z"
    });

    const validation = service.validateTrial(trial.id, {
      codeRevision: "commit-2",
      runtimeVersions: { node: "23.0.0" }
    });

    expect(validation.valid).toBe(false);
    expect(validation.reasons).toEqual(expect.arrayContaining([
      "Code revision changed during the evaluation trial",
      "Runtime versions changed during the evaluation trial",
      "Repository projection changed outside a controlled checkpoint"
    ]));
    expect(validation.trial.status).toBe("invalidated");
  });

  it("rejects a projection manifest borrowed from another trial", () => {
    const repository = fixtureRepository();
    const service = new EvaluationIntegrityService(repository);
    const first = service.startTrial({
      knowledgeProjectId: "knowledge-1",
      requirementSourceId: "source-1",
      provider: "host-agent",
      comparisonGroupId: "comparison-1",
      workspacePath: "C:/work/first",
      storePath: "C:/work/first/store",
      codeRevision: "commit-1",
      runtimeVersions: { node: "22.0.0" }
    });
    const second = service.startTrial({
      knowledgeProjectId: "knowledge-1",
      requirementSourceId: "source-1",
      provider: "builtin",
      comparisonGroupId: "comparison-1",
      workspacePath: "C:/work/second",
      storePath: "C:/work/second/store",
      codeRevision: "commit-1",
      runtimeVersions: { node: "22.0.0" }
    });
    first.trial.latestProjectionManifestId = second.projectionManifest.id;

    const validation = service.validateTrial(first.trial.id, {
      codeRevision: "commit-1",
      runtimeVersions: { node: "22.0.0" }
    });

    expect(validation.valid).toBe(false);
    expect(validation.reasons).toContain("Evaluation projection manifest belongs to another Trial");
    expect(validation.trial.status).toBe("invalidated");
  });

  it("does not let a projection checkpoint legitimize mutated frozen source content", () => {
    const repository = fixtureRepository();
    const service = new EvaluationIntegrityService(repository);
    const { trial } = service.startTrial({
      knowledgeProjectId: "knowledge-1",
      requirementSourceId: "source-1",
      provider: "host-agent",
      comparisonGroupId: "comparison-1",
      workspacePath: "C:/work/host",
      storePath: "C:/work/host/store",
      codeRevision: "commit-1",
      runtimeVersions: { node: "22.0.0" }
    });
    repository.requirementSources[0]!.source = `${repository.requirementSources[0]!.source} changed`;
    service.checkpointTrial({
      trialId: trial.id,
      previousProjectionManifestId: trial.latestProjectionManifestId,
      operation: "untrusted-checkpoint-attempt",
      evidenceRefs: [`requirement-source:${trial.requirementSourceId}`]
    });

    const validation = service.validateTrial(trial.id, {
      codeRevision: "commit-1",
      runtimeVersions: { node: "22.0.0" }
    });

    expect(validation.valid).toBe(false);
    expect(validation.reasons).toContain("Frozen requirement source snapshot is missing, changed, or outside the Trial");
  });

  it("invalidates a trial when source semantics change without changing the declared content hash", () => {
    const repository = fixtureRepository();
    const service = new EvaluationIntegrityService(repository);
    const { trial } = service.startTrial({
      knowledgeProjectId: "knowledge-1",
      requirementSourceId: "source-1",
      provider: "host-agent",
      comparisonGroupId: "comparison-1",
      workspacePath: "C:/work/host",
      storePath: "C:/work/host/store",
      codeRevision: "commit-1",
      runtimeVersions: { node: "22.0.0" }
    });
    repository.requirementSources[0]!.content = "Changed after trial start";

    const validation = service.validateTrial(trial.id, {
      codeRevision: "commit-1",
      runtimeVersions: { node: "22.0.0" }
    });

    expect(validation.valid).toBe(false);
    expect(validation.reasons).toContain("Frozen requirement source snapshot is missing, changed, or outside the Trial");
  });

  it("invalidates a trial when semantic blocks change independently of source content", () => {
    const repository = fixtureRepository();
    const service = new EvaluationIntegrityService(repository);
    const { trial } = service.startTrial({
      knowledgeProjectId: "knowledge-1",
      requirementSourceId: "source-1",
      provider: "host-agent",
      comparisonGroupId: "comparison-1",
      workspacePath: "C:/work/host",
      storePath: "C:/work/host/store",
      codeRevision: "commit-1",
      runtimeVersions: { node: "22.0.0" }
    });
    repository.requirementSources[0]!.blocks[0]!.text = "Changed block after trial start";

    const validation = service.validateTrial(trial.id, {
      codeRevision: "commit-1",
      runtimeVersions: { node: "22.0.0" }
    });

    expect(validation.valid).toBe(false);
    expect(validation.reasons).toContain("Frozen requirement source snapshot is missing, changed, or outside the Trial");
  });

  it("invalidates a trial when an attachment fingerprint changes", () => {
    const repository = fixtureRepository();
    repository.requirementSources[0]!.attachments = [{ name: "process-map.xlsx", contentHash: "attachment-before" }];
    const service = new EvaluationIntegrityService(repository);
    const { trial } = service.startTrial({
      knowledgeProjectId: "knowledge-1",
      requirementSourceId: "source-1",
      provider: "host-agent",
      comparisonGroupId: "comparison-1",
      workspacePath: "C:/work/host",
      storePath: "C:/work/host/store",
      codeRevision: "commit-1",
      runtimeVersions: { node: "22.0.0" }
    });
    repository.requirementSources[0]!.attachments[0]!.contentHash = "attachment-after";

    const validation = service.validateTrial(trial.id, {
      codeRevision: "commit-1",
      runtimeVersions: { node: "22.0.0" }
    });

    expect(validation.valid).toBe(false);
    expect(validation.reasons).toContain("Frozen requirement source snapshot is missing, changed, or outside the Trial");
  });

  it.each(["content hash", "revision", "latest requirement set"] as const)(
    "invalidates a trial when the live source %s drifts",
    (field) => {
      const repository = fixtureRepository();
      const service = new EvaluationIntegrityService(repository);
      const { trial } = service.startTrial({
        knowledgeProjectId: "knowledge-1",
        requirementSourceId: "source-1",
        provider: "host-agent",
        comparisonGroupId: "comparison-1",
        workspacePath: "C:/work/host",
        storePath: "C:/work/host/store",
        codeRevision: "commit-1",
        runtimeVersions: { node: "22.0.0" }
      });
      const source = repository.requirementSources[0]!;
      if (field === "content hash") source.contentHash = "changed-hash";
      if (field === "revision") source.revision += 1;
      if (field === "latest requirement set") source.latestRequirementSetId = "requirement-set-changed";

      const validation = service.validateTrial(trial.id, {
        codeRevision: "commit-1",
        runtimeVersions: { node: "22.0.0" }
      });

      expect(validation.valid).toBe(false);
      expect(validation.reasons).toContain("Frozen requirement source snapshot is missing, changed, or outside the Trial");
    }
  );

  it("records controlled checkpoints and invalidating interventions", () => {
    const repository = fixtureRepository();
    const service = new EvaluationIntegrityService(repository);
    const { trial, projectionManifest } = service.startTrial({
      knowledgeProjectId: "knowledge-1",
      requirementSourceId: "source-1",
      provider: "host-agent",
      comparisonGroupId: "comparison-1",
      workspacePath: "C:/work/host",
      storePath: "C:/work/host/store",
      codeRevision: "commit-1",
      runtimeVersions: { node: "22.0.0" }
    });
    repository.knowledgeNodes.push({
      id: "node-controlled",
      knowledgeProjectId: "knowledge-1",
      requirementSetId: "requirement-1",
      module: "Orders",
      type: "requirement",
      title: "Controlled node",
      content: "Controlled output",
      sourceRefs: ["source:1"],
      origin: "source",
      confidence: 1,
      status: "draft",
      policyId: "policy",
      policyVersion: "1",
      createdAt: "2026-09-01T00:00:00.000Z",
      updatedAt: "2026-09-01T00:00:00.000Z"
    });

    const checkpoint = service.checkpointTrial({
      trialId: trial.id,
      previousProjectionManifestId: projectionManifest.id,
      operation: "generate-analysis",
      evidenceRefs: ["brain-task:task-1"]
    });
    expect(checkpoint.status).toBe("current");
    expect(service.validateTrial(trial.id, {
      codeRevision: "commit-1",
      runtimeVersions: { node: "22.0.0" }
    }).valid).toBe(true);

    const intervention = service.recordIntervention({
      trialId: trial.id,
      category: "manual-store-write",
      actor: "host-agent",
      note: "Edited the canonical store outside the Facade",
      evidenceRefs: ["audit:manual-edit"]
    });
    expect(intervention.invalidatesTrial).toBe(true);
    expect(repository.evaluationTrials[0].status).toBe("invalidated");
  });

  it.each(["user-clarification", "user-authentication", "manual-evidence-review", "manual-recovery"] as const)(
    "records %s as a non-invalidating user intervention",
    (category) => {
      const repository = fixtureRepository();
      const service = new EvaluationIntegrityService(repository);
      const trial = service.startTrial({
        knowledgeProjectId: "knowledge-1",
        requirementSourceId: "source-1",
        provider: "host-agent",
        comparisonGroupId: "comparison-1",
        workspacePath: "C:/work/host",
        storePath: "C:/work/host/store",
        codeRevision: "commit-1",
        runtimeVersions: { node: "22.0.0" }
      }).trial;

      const intervention = service.recordIntervention({
        trialId: trial.id,
        category,
        actor: "user",
        note: "Required user action during the scenario",
        evidenceRefs: ["run-ledger:user-action"]
      });

      expect(intervention.invalidatesTrial).toBe(false);
      expect(trial.status).toBe("active");
    }
  );
});

function fixtureRepository() {
  const repository = new InMemoryBrainCreatorRepository();
  repository.knowledgeProjects.push({
    id: "knowledge-1",
    name: "Orders",
    key: "orders",
    defaultLocale: "en-US",
    status: "active",
    systemIds: [],
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z"
  });
  repository.requirementSources.push({
    id: "source-1",
    knowledgeProjectId: "knowledge-1",
    source: "requirements/orders.md",
    sourceType: "local-file",
    title: "Order approval",
    contentHash: "source-hash",
    content: "Create and approve an order",
    blocks: [{ type: "paragraph", text: "Create and approve an order" }],
    attachments: [],
    warnings: [],
    accessStatus: "available",
    revision: 3,
    latestRequirementSetId: "requirement-1",
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z"
  });
  repository.requirementSets.push({
    id: "requirement-1",
    knowledgeProjectId: "knowledge-1",
    sourceId: "source-1",
    version: 3,
    title: "Order approval",
    summary: "Create and approve an order",
    contentHash: "source-hash",
    status: "draft",
    affectedNodeIds: [],
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z"
  });
  return repository;
}
