import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRuntimeIdentityReader } from "./runtimeIdentity.js";

describe("running process identity", () => {
  it("keeps build identity when an exported source has no git metadata", () => {
    const dir = mkdtempSync(join(tmpdir(), "bc-identity-export-"));
    const path = join(dir, "build-identity.json");
    try {
      writeFileSync(path, JSON.stringify({ packageVersion: "2.1.1", commit: "unknown", dirty: "unknown", buildId: "content-hash", builtAt: "2026-09-08T00:00:00Z" }));
      const read = createRuntimeIdentityReader({ metadataPath: path });
      expect(read({ workspace: dir, schemaVersion: 21, provider: "host-agent" })).toMatchObject({ commit: "unknown", dirty: "unknown", buildId: "content-hash" });
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it("pins build identity even if files change while a process is alive", () => {
    const dir = mkdtempSync(join(tmpdir(), "bc-identity-"));
    const path = join(dir, "build-identity.json");
    try {
      writeFileSync(path, JSON.stringify({ packageVersion: "2.1.1", commit: "a".repeat(40), buildId: "first", builtAt: "2026-09-08T00:00:00Z", dirty: false }));
      const read = createRuntimeIdentityReader({ metadataPath: path });
      const first = read({ workspace: dir, schemaVersion: 21, provider: "host-agent" });
      writeFileSync(path, JSON.stringify({ buildId: "replacement" }));
      const next = read({ workspace: dir, schemaVersion: 21, provider: "codex" });
      expect(first.buildId).toBe("first");
      expect(next.buildId).toBe("first");
      expect(next.pid).toBe(process.pid);
      expect(next.startedAt).toBe(first.startedAt);
      expect(next.provider).toBe("codex");
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("assigns distinct source build identities to different dirty working trees", () => {
    const dir = mkdtempSync(join(tmpdir(), "bc-source-identity-"));
    try {
      execFileSync("git", ["init"], { cwd: dir, stdio: "ignore" });
      execFileSync("git", ["config", "user.email", "brain-creator-test@example.invalid"], { cwd: dir, stdio: "ignore" });
      execFileSync("git", ["config", "user.name", "Brain Creator Test"], { cwd: dir, stdio: "ignore" });
      writeFileSync(join(dir, "source.ts"), "export const value = 1;\n");
      execFileSync("git", ["add", "source.ts"], { cwd: dir, stdio: "ignore" });
      execFileSync("git", ["commit", "-m", "baseline"], { cwd: dir, stdio: "ignore" });

      const firstRead = createRuntimeIdentityReader({ sourceRoot: dir });
      const firstIdentity = firstRead({ workspace: dir, schemaVersion: 22, provider: "test" });
      expect(firstIdentity.dirty).toBe(false);

      writeFileSync(join(dir, "source.ts"), "export const value = 2;\n");
      const trackedChange = createRuntimeIdentityReader({ sourceRoot: dir })({ workspace: dir, schemaVersion: 22, provider: "test" });
      expect(trackedChange.dirty).toBe(true);
      expect(trackedChange.buildId).not.toBe(firstIdentity.buildId);

      mkdirSync(join(dir, "generated"));
      writeFileSync(join(dir, "generated", "runtime.ts"), "export const runtime = 'one';\n");
      const firstUntrackedState = createRuntimeIdentityReader({ sourceRoot: dir })({ workspace: dir, schemaVersion: 22, provider: "test" });
      writeFileSync(join(dir, "generated", "runtime.ts"), "export const runtime = 'two';\n");
      const secondUntrackedState = createRuntimeIdentityReader({ sourceRoot: dir })({ workspace: dir, schemaVersion: 22, provider: "test" });
      expect(firstUntrackedState.buildId).not.toBe(trackedChange.buildId);
      expect(secondUntrackedState.buildId).not.toBe(firstUntrackedState.buildId);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("reports missing build provenance as unknown instead of reading the user's git checkout", () => {
    const read = createRuntimeIdentityReader({ metadataPath: join(tmpdir(), "missing-bc-build.json") });
    expect(read({ workspace: tmpdir(), schemaVersion: 21, provider: "disabled" })).toMatchObject({
      commit: "unknown", buildId: "unknown", builtAt: "unknown", dirty: "unknown",
      schemaVersion: 21, processKind: "cli"
    });
  });
});
