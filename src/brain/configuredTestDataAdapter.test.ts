// @vitest-environment node

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { configuredTestDataAdapter } from "./configuredTestDataAdapter.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("configured target Testdata adapter", () => {
  it("does not provide a synthetic target adapter unless a module is configured", () => {
    expect(configuredTestDataAdapter(process.cwd(), {})).toEqual({
      providers: [],
      status: "not-configured"
    });
  });

  it("dispatches lifecycle operations to a system-matched workspace provider", async () => {
    const workspace = await tempDir();
    await writeFile(join(workspace, "target-data-adapter.mjs"), `
      export const testDataProviders = [{
        name: "orders-api",
        supports: (input) => input.systemId === "system-orders",
        lookup: async (input) => ({ status: "found", reference: input.reference ?? "system-orders/orders/42", entityReference: input.entityReference, sourceRefs: input.sourceRefs }),
        create: async (input) => ({ status: "created", reference: "system-orders/orders/42", entityReference: input.entityReference, values: input.values, sourceRefs: input.sourceRefs }),
        transition: async (input) => ({ status: "transitioned", reference: input.reference, entityReference: input.entityReference, values: input.values, sourceRefs: input.sourceRefs }),
        verify: async (input) => ({ status: "verified", reference: input.reference, entityReference: input.entityReference, values: input.expected, sourceRefs: input.sourceRefs }),
        cleanup: async (input) => ({ status: "cleaned", reference: input.reference, entityReference: input.entityReference, sourceRefs: input.sourceRefs })
      }];
      export async function verifyNoEffect({ system, query }) {
        return { status: "absent", provider: "orders-api-read-only-query", query, evidenceRefs: ["target-query:orders"], evidenceArtifacts: [], checkedAt: "2026-10-20T00:00:00.000Z" };
      }
    `, "utf8");
    const adapter = configuredTestDataAdapter(workspace, {
      BRAIN_CREATOR_TESTDATA_ADAPTER_MODULE: "target-data-adapter.mjs"
    });

    expect(adapter.status).toBe("configured");
    await expect(adapter.providers[0]!.create({
      systemId: "system-orders",
      knowledgeProjectId: "project-orders",
      entityType: "order",
      entityReference: "order",
      values: { amount: 500 },
      sourceRefs: ["requirement:order"]
    })).resolves.toEqual(expect.objectContaining({
      status: "created",
      reference: "system-orders/orders/42",
      provider: "orders-api"
    }));
    await expect(adapter.providers[0]!.verify({
      systemId: "system-orders",
      reference: "system-orders/orders/42",
      expected: { state: "submitted" },
      sourceRefs: []
    })).resolves.toEqual(expect.objectContaining({
      status: "verified",
      values: { state: "submitted" }
    }));
    await expect(adapter.providers[0]!.lookup({ systemId: "system-other", sourceRefs: [] }))
      .rejects.toThrow("must resolve one provider");
    await expect(adapter.noEffectVerifier!({
      task: { id: "task-1" } as never,
      system: { id: "system-orders" } as never,
      query: "order:42"
    })).resolves.toEqual(expect.objectContaining({
      status: "absent",
      provider: "orders-api-read-only-query"
    }));
  });

  it("fails closed for a missing or out-of-workspace adapter module", async () => {
    const parent = await tempDir();
    const workspace = join(parent, "workspace");
    await import("node:fs/promises").then(({ mkdir }) => mkdir(workspace));
    await writeFile(join(parent, "outside.mjs"), "export const testDataProviders = [];", "utf8");
    const adapter = configuredTestDataAdapter(workspace, {
      BRAIN_CREATOR_TESTDATA_ADAPTER_MODULE: "../outside.mjs"
    });

    await expect(adapter.providers[0]!.lookup({ systemId: "system-orders", sourceRefs: [] }))
      .rejects.toThrow();
  });
});

async function tempDir() {
  const dir = await mkdtemp(join(tmpdir(), "bc-testdata-adapter-"));
  tempDirs.push(dir);
  return dir;
}
