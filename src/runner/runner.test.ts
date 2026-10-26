import { describe, expect, it, vi } from "vitest";
import type { ExecutionEvidence, RequirementSuiteRun } from "../domain/types.js";
import { InMemoryBrainCreatorRepository } from "../domain/repository.js";
import { RequirementSuiteRunService } from "../knowledge/requirementSuiteRun.js";
import { runScheduledSuites } from "./runner.js";

function scheduledRun(): RequirementSuiteRun {
  return {
    id: "suite-run-1",
    knowledgeProjectId: "knowledge-1",
    systemId: "system-1",
    status: "running",
    continueOnBlocked: false,
    allowCreateTestData: false,
    total: 1,
    passed: 0,
    failed: 0,
    blocked: 0,
    skipped: 0,
    cancelled: 0,
    caseRuns: [],
    stabilitySchedule: {
      status: "active",
      nextRunAt: "2026-01-01T00:00:00.000Z"
    },
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z"
  };
}

describe("scheduled Runner", () => {
  it("claims a due suite and drives it until completion", async () => {
    const run = scheduledRun();
    const controller = {
      listDueStabilityRuns: vi.fn(() => [run]),
      claimScheduled: vi.fn(() => {
        run.stabilitySchedule = {
          ...run.stabilitySchedule!,
          leaseId: "lease-1",
          leaseOwner: "ci",
          leaseExpiresAt: "2026-01-01T00:05:00.000Z",
          nextRunAt: undefined
        };
        return run;
      }),
      get: vi.fn(() => run),
      releaseScheduledLease: vi.fn()
    };
    const execute = vi.fn(async () => {
      run.status = "completed";
      run.stabilitySchedule = { status: "completed" };
    });

    const result = await runScheduledSuites({
      controller,
      owner: "ci",
      now: new Date("2026-01-01T00:01:00.000Z"),
      execute
    });

    expect(execute).toHaveBeenCalledOnce();
    expect(controller.claimScheduled).toHaveBeenCalledWith("suite-run-1", {
      owner: "ci",
      leaseMs: 300_000
    }, expect.any(Date));
    expect(controller.releaseScheduledLease).not.toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({
      status: "completed",
      processedRuns: 1
    }));
  });

  it("rejects an invalid scheduled Trial binding before claiming a lease", async () => {
    const run = scheduledRun();
    run.evaluationTrialId = "trial-1";
    const controller = {
      listDueStabilityRuns: vi.fn(() => [run]),
      claimScheduled: vi.fn(),
      get: vi.fn(() => run),
      releaseScheduledLease: vi.fn()
    };
    const validateRun = vi.fn(() => {
      throw new Error("Evaluation trial binding is invalid: code revision changed");
    });
    const execute = vi.fn();

    const result = await runScheduledSuites({
      controller,
      owner: "ci",
      validateRun,
      now: new Date("2026-01-01T00:01:00.000Z"),
      execute
    });

    expect(validateRun).toHaveBeenCalledWith(run);
    expect(controller.claimScheduled).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
    expect(result.runs).toEqual([expect.objectContaining({
      runId: run.id,
      status: "claim-failed",
      error: expect.stringContaining("binding is invalid")
    })]);
  });

  it("revalidates the claimed Trial binding and releases a lease if it changed", async () => {
    const dueRun = scheduledRun();
    dueRun.evaluationTrialId = "trial-1";
    const claimedRun = structuredClone(dueRun);
    claimedRun.systemId = "changed-system";
    claimedRun.stabilitySchedule = {
      ...claimedRun.stabilitySchedule!,
      leaseId: "lease-1",
      leaseOwner: "ci",
      leaseExpiresAt: "2026-01-01T00:05:00.000Z",
      attemptCount: 3,
      nextRunAt: undefined
    };
    const controller = {
      listDueStabilityRuns: vi.fn(() => [dueRun]),
      claimScheduled: vi.fn(() => claimedRun),
      get: vi.fn(() => claimedRun),
      releaseScheduledLease: vi.fn(() => claimedRun)
    };
    const validateRun = vi.fn((run: RequirementSuiteRun) => {
      if (run.systemId !== "system-1") throw new Error("Evaluation trial binding changed after claim");
    });
    const execute = vi.fn();

    const result = await runScheduledSuites({
      controller,
      owner: "ci",
      validateRun,
      retryBackoffMs: 1_000,
      maxRetryBackoffMs: 3_000,
      clock: () => Date.parse("2026-01-01T00:01:00.000Z"),
      now: new Date("2026-01-01T00:01:00.000Z"),
      execute
    });

    expect(validateRun).toHaveBeenCalledTimes(2);
    expect(controller.releaseScheduledLease).toHaveBeenCalledWith(
      claimedRun.id,
      expect.objectContaining({
        owner: "ci",
        nextRunAt: "2026-01-01T00:01:03.000Z",
        lastError: "Evaluation trial binding changed after claim"
      }),
      expect.any(Date)
    );
    expect(execute).not.toHaveBeenCalled();
    expect(result.runs).toEqual([expect.objectContaining({
      runId: dueRun.id,
      status: "claim-failed",
      error: "Evaluation trial binding changed after claim"
    })]);
  });

  it("requires a binding validator for Trial-bound scheduled runs", async () => {
    const run = scheduledRun();
    run.evaluationTrialId = "trial-1";
    const controller = {
      listDueStabilityRuns: vi.fn(() => [run]),
      claimScheduled: vi.fn(),
      get: vi.fn(() => run),
      releaseScheduledLease: vi.fn()
    };

    const result = await runScheduledSuites({
      controller,
      owner: "ci",
      now: new Date("2026-01-01T00:01:00.000Z"),
      execute: vi.fn()
    });

    expect(controller.claimScheduled).not.toHaveBeenCalled();
    expect(result.runs).toEqual([expect.objectContaining({
      runId: run.id,
      status: "claim-failed",
      error: expect.stringContaining("require a runtime binding validator")
    })]);
  });

  it("releases the lease when execution must wait for a provider", async () => {
    const run = scheduledRun();
    const controller = {
      listDueStabilityRuns: vi.fn(() => [run]),
      claimScheduled: vi.fn(() => {
        run.stabilitySchedule = {
          ...run.stabilitySchedule!,
          leaseId: "lease-1",
          leaseOwner: "ci",
          leaseExpiresAt: "2026-01-01T00:05:00.000Z",
          nextRunAt: undefined
        };
        return run;
      }),
      get: vi.fn(() => run),
      releaseScheduledLease: vi.fn(() => run)
    };
    const execute = vi.fn(async () => {
      run.status = "waiting-for-agent";
    });

    const result = await runScheduledSuites({
      controller,
      owner: "ci",
      now: new Date("2026-01-01T00:01:00.000Z"),
      execute
    });

    expect(controller.releaseScheduledLease).toHaveBeenCalledWith(
      "suite-run-1",
      expect.objectContaining({ owner: "ci", lastError: expect.stringContaining("waiting") }),
      expect.any(Date)
    );
    expect(result).toEqual(expect.objectContaining({ status: "waiting" }));
  });

  it("returns an explicit no-due-run result without claiming anything", async () => {
    const controller = {
      listDueStabilityRuns: vi.fn(() => []),
      claimScheduled: vi.fn(),
      get: vi.fn(),
      releaseScheduledLease: vi.fn()
    };

    const result = await runScheduledSuites({
      controller,
      owner: "ci",
      execute: vi.fn()
    });

    expect(result).toEqual(expect.objectContaining({ status: "no-due-runs", processedRuns: 0 }));
    expect(controller.claimScheduled).not.toHaveBeenCalled();
  });

  it("renews a long-running lease and reports the renewal count", async () => {
    const run = scheduledRun();
    const controller = {
      listDueStabilityRuns: vi.fn(() => [run]),
      claimScheduled: vi.fn(() => {
        run.stabilitySchedule = {
          ...run.stabilitySchedule!,
          leaseId: "lease-1",
          leaseOwner: "ci",
          leaseExpiresAt: new Date(Date.now() + 20).toISOString(),
          nextRunAt: undefined
        };
        return run;
      }),
      renewScheduledLease: vi.fn(() => run),
      get: vi.fn(() => run),
      releaseScheduledLease: vi.fn()
    };

    const result = await runScheduledSuites({
      controller,
      owner: "ci",
      leaseMs: 50,
      leaseRenewalMs: 5,
      maxWallTimeMs: 200,
      execute: async () => {
        await new Promise((resolve) => setTimeout(resolve, 25));
        run.status = "completed";
        run.stabilitySchedule = { status: "completed" };
      }
    });

    expect(controller.renewScheduledLease).toHaveBeenCalled();
    expect(result.runs[0]).toEqual(expect.objectContaining({
      status: "completed",
      leaseRenewals: expect.any(Number),
      durationMs: expect.any(Number)
    }));
    expect(result.runs[0].leaseRenewals).toBeGreaterThan(0);
  });

  it("waits for an in-flight lease renewal before releasing a waiting run", async () => {
    const run = scheduledRun();
    let markRenewalStarted!: () => void;
    const renewalStarted = new Promise<void>((resolve) => {
      markRenewalStarted = resolve;
    });
    let finishRenewal!: () => void;
    const renewalGate = new Promise<void>((resolve) => {
      finishRenewal = resolve;
    });
    const controller = {
      listDueStabilityRuns: vi.fn(() => [run]),
      claimScheduled: vi.fn(() => {
        run.stabilitySchedule = {
          ...run.stabilitySchedule!,
          leaseId: "lease-1",
          leaseOwner: "ci",
          leaseExpiresAt: "2026-01-01T00:05:00.000Z",
          nextRunAt: undefined
        };
        return run;
      }),
      renewScheduledLease: vi.fn(async () => {
        markRenewalStarted();
        await renewalGate;
        return run;
      }),
      get: vi.fn(() => run),
      releaseScheduledLease: vi.fn(() => run)
    };
    const resultPromise = runScheduledSuites({
      controller,
      owner: "ci",
      leaseMs: 100,
      leaseRenewalMs: 5,
      execute: async () => {
        await renewalStarted;
        run.status = "waiting-for-agent";
      }
    });

    try {
      await renewalStarted;
      await new Promise((resolve) => setTimeout(resolve, 70));
      expect(controller.releaseScheduledLease).not.toHaveBeenCalled();
    } finally {
      finishRenewal();
    }

    await expect(resultPromise).resolves.toEqual(expect.objectContaining({ status: "waiting" }));
    expect(controller.releaseScheduledLease).toHaveBeenCalledOnce();
    expect(controller.renewScheduledLease).toHaveBeenCalledOnce();
  });

  it("stops before starting another case when the wall-time budget is exhausted", async () => {
    const run = scheduledRun();
    run.total = 2;
    run.caseRuns.push({
      executableCaseId: "case-2",
      title: "Second case",
      order: 2,
      status: "queued",
      gapIds: [],
      attempts: []
    });
    let clockNow = 0;
    const controller = {
      listDueStabilityRuns: vi.fn(() => [run]),
      claimScheduled: vi.fn(() => {
        run.stabilitySchedule = {
          ...run.stabilitySchedule!,
          leaseId: "lease-1",
          leaseOwner: "ci",
          leaseExpiresAt: new Date(1000).toISOString(),
          nextRunAt: undefined
        };
        return run;
      }),
      get: vi.fn(() => run),
      releaseScheduledLease: vi.fn((_runId, input) => {
        run.stabilitySchedule = { status: "active", nextRunAt: input.nextRunAt, lastError: input.lastError };
        return run;
      })
    };
    const execute = vi.fn(async () => {
      clockNow = 20;
      run.status = "running";
    });

    const result = await runScheduledSuites({
      controller,
      owner: "ci",
      now: new Date(0),
      maxWallTimeMs: 10,
      clock: () => clockNow,
      execute
    });

    expect(execute).toHaveBeenCalledOnce();
    expect(controller.releaseScheduledLease).toHaveBeenCalledWith(
      "suite-run-1",
      expect.objectContaining({ lastError: expect.stringContaining("wall-time") }),
      expect.any(Date)
    );
    expect(result).toEqual(expect.objectContaining({ status: "partial" }));
    expect(result.runs[0]).toEqual(expect.objectContaining({ budgetExceeded: true }));
  });

  it("completes twenty stability iterations through the real suite service", async () => {
    const repository = new InMemoryBrainCreatorRepository();
    const service = new RequirementSuiteRunService(repository);
    const first = service.create({
      knowledgeProjectId: "knowledge-long-run",
      systemId: "system-orders",
      cases: [{ executableCaseId: "case-order-approval", title: "Approve order" }],
      continueOnBlocked: false,
      stabilityGroupId: "long-run-orders",
      stabilityIteration: 1,
      stabilityTarget: 20,
      stabilityPolicy: {
        targetIterations: 20,
        minIterations: 20,
        minIntervalMs: 0,
        requireStrongEvidence: true
      }
    });
    let currentRunId = first.id;

    for (let iteration = 1; iteration <= 20; iteration += 1) {
      const current = service.get(currentRunId);
      current.stabilitySchedule!.nextRunAt = "2020-01-01T00:00:00.000Z";
      const result = await runScheduledSuites({
        controller: service,
        owner: "github-actions",
        knowledgeProjectId: "knowledge-long-run",
        now: new Date("2026-08-28T00:00:00.000Z"),
        execute: async (runId) => {
          const started = service.beginNext(runId);
          const evidence: ExecutionEvidence = {
            id: `evidence-${iteration}`,
            knowledgeProjectId: "knowledge-long-run",
            systemId: "system-orders",
            executableCaseId: started.caseRun!.executableCaseId,
            testCaseId: `case-${iteration}`,
            contextPackPath: `context/${iteration}.json`,
            status: "passed",
            assuranceLevel: "strong",
            steps: [],
            tracePaths: [`trace/${iteration}.zip`],
            artifactPaths: [`evidence/${iteration}.json`],
            consoleErrors: [],
            networkFailures: [],
            createdAt: new Date().toISOString(),
            completedAt: new Date().toISOString()
          };
          repository.executionEvidence.push(evidence);
          started.caseRun!.executionEvidenceId = evidence.id;
          service.completeCase(runId, started.caseRun!.executableCaseId, {
            status: "passed",
            chainRunId: `chain-${iteration}`,
            gapIds: []
          });
        }
      });

      expect(result.status).toBe("completed");
      currentRunId = service.get(currentRunId).stabilityNextRunId ?? currentRunId;
    }

    const runs = repository.requirementSuiteRuns.filter(
      (run) => run.stabilityGroupId === "long-run-orders"
    );
    expect(runs).toHaveLength(20);
    expect(runs.every((run) => run.status === "completed")).toBe(true);
    expect(runs.every((run) => !run.stabilitySchedule?.leaseId)).toBe(true);
    expect(repository.executionEvidence).toHaveLength(20);
    expect(repository.executionEvidence.every((evidence) => evidence.assuranceLevel === "strong")).toBe(true);
  });
});
