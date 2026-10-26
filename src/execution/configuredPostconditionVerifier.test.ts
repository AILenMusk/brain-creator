// @vitest-environment node

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { PostconditionVerificationInput } from "./postconditionVerifier.js";
import { configuredPostconditionVerifier } from "./configuredPostconditionVerifier.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("configured target postcondition verifier", () => {
  it("remains disabled unless an adapter module is explicitly configured", () => {
    expect(configuredPostconditionVerifier(process.cwd(), {})).toBeUndefined();
  });

  it("loads and reuses an explicitly configured workspace adapter", async () => {
    const workspace = await tempDir();
    const adapterPath = join(workspace, "target-verifier.mjs");
    await writeFile(adapterPath, `
      globalThis.__brainCreatorVerifierLoads = (globalThis.__brainCreatorVerifierLoads ?? 0) + 1;
      export async function verifyPostcondition(input) {
        return { status: "confirmed", actualResult: input.postcondition, evidenceRefs: ["target-read:1"], checkedAt: "2026-10-20T00:00:00.000Z", evidenceArtifacts: [{ path: "postconditions/order.json", sha256: "${"a".repeat(64)}" }] };
      }
    `, "utf8");
    const verifier = configuredPostconditionVerifier(workspace, {
      BRAIN_CREATOR_POSTCONDITION_VERIFIER_MODULE: "target-verifier.mjs"
    });
    const input = verificationInput();

    expect(verifier).toBeDefined();
    await expect(verifier!(input)).resolves.toEqual(expect.objectContaining({
      status: "confirmed",
      actualResult: input.postcondition
    }));
    await expect(verifier!(input)).resolves.toEqual(expect.objectContaining({ status: "confirmed" }));
    expect((globalThis as typeof globalThis & { __brainCreatorVerifierLoads?: number }).__brainCreatorVerifierLoads).toBe(1);
    delete (globalThis as typeof globalThis & { __brainCreatorVerifierLoads?: number }).__brainCreatorVerifierLoads;
  });

  it("fails closed when the configured adapter module does not exist", async () => {
    const workspace = await tempDir();
    const verifier = configuredPostconditionVerifier(workspace, {
      BRAIN_CREATOR_POSTCONDITION_VERIFIER_MODULE: "invalid.mjs"
    });

    await expect(verifier!(verificationInput())).resolves.toEqual({
      status: "unavailable",
      reason: "The configured target postcondition verifier could not be loaded or completed."
    });
  });

  it("fails closed when the configured module resolves outside the workspace", async () => {
    const parent = await tempDir();
    const workspace = join(parent, "workspace");
    await mkdir(workspace);
    await writeFile(join(parent, "outside.mjs"), "export default async () => ({ status: 'confirmed' });", "utf8");
    const verifier = configuredPostconditionVerifier(workspace, {
      BRAIN_CREATOR_POSTCONDITION_VERIFIER_MODULE: "../outside.mjs"
    });

    await expect(verifier!(verificationInput())).resolves.toEqual({
      status: "unavailable",
      reason: "The configured target postcondition verifier could not be loaded or completed."
    });
  });

  it("does not treat a malformed adapter as a verifier", async () => {
    const workspace = await tempDir();
    await writeFile(join(workspace, "malformed.mjs"), "export const verifier = true;", "utf8");
    const verifier = configuredPostconditionVerifier(workspace, {
      BRAIN_CREATOR_POSTCONDITION_VERIFIER_MODULE: "malformed.mjs"
    });

    await expect(verifier!(verificationInput())).resolves.toEqual(expect.objectContaining({ status: "unavailable" }));
  });

  it("fails closed when a configured verifier returns an incomplete confirmation", async () => {
    const workspace = await tempDir();
    await writeFile(join(workspace, "incomplete.mjs"), "export default async () => ({ status: 'confirmed' });", "utf8");
    const verifier = configuredPostconditionVerifier(workspace, {
      BRAIN_CREATOR_POSTCONDITION_VERIFIER_MODULE: "incomplete.mjs"
    });

    await expect(verifier!(verificationInput())).resolves.toEqual({
      status: "unavailable",
      reason: "The configured target postcondition verifier could not be loaded or completed."
    });
  });
});

async function tempDir() {
  const dir = await mkdtemp(join(tmpdir(), "bc-postcondition-adapter-"));
  tempDirs.push(dir);
  return dir;
}

function verificationInput(): PostconditionVerificationInput {
  return {
    systemId: "system-orders",
    requirementSuiteRunId: "suite-orders",
    executableCaseId: "case-submit",
    actionKey: "submit-order",
    actionSemantic: "Submit order",
    entityReference: "order-42",
    postcondition: "Order state is Submitted"
  };
}
