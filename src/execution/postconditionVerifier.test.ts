import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  validateManualPostconditionEvidenceArtifacts,
  validatePostconditionVerificationArtifacts
} from "./postconditionVerifier.js";

const temporaryDirectories: string[] = [];

async function createObservation(overrides: Record<string, unknown> = {}) {
  const root = await mkdtemp(join(tmpdir(), "bc-postcondition-proof-"));
  temporaryDirectories.push(root);
  const path = "postconditions/order.json";
  const checkedAt = "2026-10-20T00:00:00.000Z";
  const observation = {
    schemaVersion: 2,
    type: "execution-postcondition-observation",
    runType: "requirement-suite",
    runId: "suite-orders",
    executableCaseId: "case-submit",
    stepId: "step-submit",
    systemId: "system-orders",
    actionKey: "submit-order",
    actionSemantic: "Submit order",
    entityReference: "ORDER-42",
    postcondition: "Order status is submitted",
    result: "confirmed",
    actualResult: "ORDER-42 status is submitted",
    checkedAt,
    ...overrides
  };
  const contents = JSON.stringify(observation);
  await mkdir(join(root, "postconditions"), { recursive: true });
  await writeFile(join(root, path), contents, "utf8");
  return {
    root,
    path,
    contents,
    checkedAt,
    sha256: createHash("sha256").update(contents).digest("hex")
  };
}

async function createManualObservation(overrides: Record<string, unknown> = {}) {
  const root = await mkdtemp(join(tmpdir(), "bc-manual-postcondition-proof-"));
  temporaryDirectories.push(root);
  const path = "manual/order.json";
  const observation = {
    schemaVersion: 2,
    type: "manual-execution-postcondition-observation",
    runType: "requirement-suite",
    runId: "suite-orders",
    executableCaseId: "case-submit",
    stepId: "step-submit",
    systemId: "system-orders",
    actionKey: "submit-order",
    actionSemantic: "Submit order",
    entityReference: "ORDER-42",
    postcondition: "Order status is submitted",
    result: "confirmed",
    actualResult: "ORDER-42 status is submitted",
    checkedAt: "2026-10-20T00:00:00.000Z",
    operator: "qa-reviewer",
    ...overrides
  };
  const contents = JSON.stringify(observation);
  await mkdir(join(root, "manual"), { recursive: true });
  await writeFile(join(root, path), contents, "utf8");
  return {
    root,
    path,
    sha256: createHash("sha256").update(contents).digest("hex")
  };
}

function verification(path: string, sha256: string) {
  return {
    status: "confirmed" as const,
    actualResult: "ORDER-42 status is submitted",
    evidenceRefs: ["target:order:ORDER-42"],
    evidenceArtifacts: [{ path, sha256 }],
    checkedAt: "2026-10-20T00:00:00.000Z"
  };
}

describe("postcondition verification artifact validation", () => {
  afterEach(async () => {
    await Promise.all(temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    ));
  });

  it("rejects an artifact whose supplied hash does not match its bytes", async () => {
    const artifact = await createObservation();

    await expect(validatePostconditionVerificationArtifacts({
      root: artifact.root,
      verification: verification(artifact.path, createHash("sha256").update("different bytes").digest("hex")),
      binding: { requirementSuiteRunId: "suite-orders", executableCaseId: "case-submit", stepId: "step-submit" },
      systemId: "system-orders",
      actionKey: "submit-order",
      actionSemantic: "Submit order",
      entityReference: "ORDER-42",
      postcondition: "Order status is submitted"
    })).rejects.toThrow(/hash|invalid/i);
  });

  it("rejects automatic evidence without exactly one suite run binding", async () => {
    const artifact = await createObservation();
    const base = {
      root: artifact.root,
      verification: verification(artifact.path, artifact.sha256),
      systemId: "system-orders",
      actionKey: "submit-order",
      actionSemantic: "Submit order",
      entityReference: "ORDER-42",
      postcondition: "Order status is submitted"
    };

    await expect(validatePostconditionVerificationArtifacts({ ...base, binding: {} }))
      .rejects.toThrow(/exactly one suite run identity/i);
    await expect(validatePostconditionVerificationArtifacts({
      ...base,
      binding: { requirementSuiteRunId: "suite-orders", caseSuiteId: "suite-orders" }
    })).rejects.toThrow(/exactly one suite run identity/i);
  });

  it("rejects a valid-hash observation bound to a different action", async () => {
    const artifact = await createObservation({ actionKey: "delete-order" });

    await expect(validatePostconditionVerificationArtifacts({
      root: artifact.root,
      verification: verification(artifact.path, artifact.sha256),
      binding: { requirementSuiteRunId: "suite-orders", executableCaseId: "case-submit", stepId: "step-submit" },
      systemId: "system-orders",
      actionKey: "submit-order",
      actionSemantic: "Submit order",
      entityReference: "ORDER-42",
      postcondition: "Order status is submitted"
    })).rejects.toThrow(/does not match the action/i);
  });

  it("rejects a valid artifact replayed from a different Trial or step", async () => {
    const artifact = await createObservation();

    await expect(validatePostconditionVerificationArtifacts({
      root: artifact.root,
      verification: verification(artifact.path, artifact.sha256),
      binding: {
        requirementSuiteRunId: "suite-orders",
        evaluationTrialId: "trial-other",
        executableCaseId: "case-submit",
        stepId: "step-submit"
      },
      systemId: "system-orders",
      actionKey: "submit-order",
      actionSemantic: "Submit order",
      entityReference: "ORDER-42",
      postcondition: "Order status is submitted"
    })).rejects.toThrow(/does not match the action/i);
  });

  it("accepts a manual observation bound to the original postcondition and operator", async () => {
    const artifact = await createManualObservation();

    await expect(validateManualPostconditionEvidenceArtifacts({
      root: artifact.root,
      artifacts: [{ path: artifact.path, sha256: artifact.sha256 }],
      binding: { requirementSuiteRunId: "suite-orders", executableCaseId: "case-submit", stepId: "step-submit" },
      systemId: "system-orders",
      actionKey: "submit-order",
      actionSemantic: "Submit order",
      entityReference: "ORDER-42",
      postcondition: "Order status is submitted",
      operator: "qa-reviewer"
    })).resolves.toEqual([{ path: artifact.path, sha256: artifact.sha256 }]);
  });

  it("rejects manual evidence without exactly one suite run binding", async () => {
    const artifact = await createManualObservation();
    const base = {
      root: artifact.root,
      artifacts: [{ path: artifact.path, sha256: artifact.sha256 }],
      systemId: "system-orders",
      actionKey: "submit-order",
      actionSemantic: "Submit order",
      entityReference: "ORDER-42",
      postcondition: "Order status is submitted",
      operator: "qa-reviewer"
    };

    await expect(validateManualPostconditionEvidenceArtifacts({ ...base, binding: {} }))
      .rejects.toThrow(/exactly one suite run identity/i);
    await expect(validateManualPostconditionEvidenceArtifacts({
      ...base,
      binding: { requirementSuiteRunId: "suite-orders", caseSuiteId: "suite-orders" }
    })).rejects.toThrow(/exactly one suite run identity/i);
  });

  it("rejects a manual observation that substitutes a different postcondition", async () => {
    const artifact = await createManualObservation({ postcondition: "Order status is approved" });

    await expect(validateManualPostconditionEvidenceArtifacts({
      root: artifact.root,
      artifacts: [{ path: artifact.path, sha256: artifact.sha256 }],
      binding: { requirementSuiteRunId: "suite-orders", executableCaseId: "case-submit", stepId: "step-submit" },
      systemId: "system-orders",
      actionKey: "submit-order",
      actionSemantic: "Submit order",
      entityReference: "ORDER-42",
      postcondition: "Order status is submitted",
      operator: "qa-reviewer"
    })).rejects.toThrow(/does not match the original target/i);
  });
});
