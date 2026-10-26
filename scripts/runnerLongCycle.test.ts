import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runRunnerCycle } from "./runnerLongCycle.js";
import { ShardedFileBrainCreatorRepository } from "../src/domain/repository.js";
import { resolveBrainCreatorDataFile, resolveBrainCreatorStoreDir } from "../src/shared/workspace.js";

describe("GitHub Actions Runner long-cycle fixture", () => {
  const directories: string[] = [];

  afterEach(async () => {
    await Promise.all(directories.splice(0).map((directory) => rm(directory, {
      recursive: true,
      force: true,
      maxRetries: 3,
      retryDelay: 100
    })));
  });

  it("persists and resumes scheduled iterations through the sharded repository", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "brain-runner-cycle-"));
    directories.push(workspace);

    const first = await runRunnerCycle({
      workspace,
      targetIterations: 2,
      minIntervalMs: 0,
      leaseMs: 50,
      leaseRenewalMs: 5,
      maxWallTimeMs: 200
    });
    const repository = new ShardedFileBrainCreatorRepository(
      resolveBrainCreatorStoreDir(workspace, {}),
      resolveBrainCreatorDataFile(workspace, {})
    );
    repository.executionEvidence.push({
      id: "unrelated-real-labelled-evidence",
      knowledgeProjectId: repository.knowledgeProjects[0]!.id,
      systemId: repository.systemProfiles[0]!.id,
      executableCaseId: "unrelated-case",
      testCaseId: "unrelated-test",
      contextPackPath: "unrelated/context.json",
      status: "passed",
      provenance: "real-system",
      assuranceLevel: "strong",
      steps: [],
      tracePaths: [],
      artifactPaths: [],
      consoleErrors: [],
      networkFailures: [],
      createdAt: new Date().toISOString()
    });
    repository.persist();
    const second = await runRunnerCycle({
      workspace,
      targetIterations: 2,
      minIntervalMs: 0,
      leaseMs: 50,
      leaseRenewalMs: 5,
      maxWallTimeMs: 200
    });

    expect(first.status).toBe("progressed");
    expect(first.completedIterations).toBe(1);
    expect(second.status).toBe("complete");
    expect(second.completedIterations).toBe(2);
    expect(second.strongEvidenceCounts).toEqual({ realSystem: 0, synthetic: 2, unclassified: 0 });
    expect(second.activeLeases).toBe(0);
    expect(JSON.parse(await readFile(join(workspace, "runner-report.json"), "utf8"))).toEqual(
      expect.objectContaining({
        schemaVersion: 2,
        status: "complete",
        completedIterations: 2,
        strongEvidenceCounts: { realSystem: 0, synthetic: 2, unclassified: 0 }
      })
    );
  }, 15_000);
});
