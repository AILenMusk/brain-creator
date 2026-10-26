// @vitest-environment node

import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readEncryptedAuthStorageState, writeEncryptedAuthStorageState } from "./authStorageState.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("encrypted browser auth storage state", () => {
  it("encrypts session material at rest and restores it for runtime use", async () => {
    const workDir = await temporaryDirectory();
    const path = join(workDir, ".brain-creator", "auth", "state.json");
    const state = {
      cookies: [{ name: "session", value: "sensitive-cookie" }],
      origins: [{ origin: "https://example.test", localStorage: [{ name: "session", value: "sensitive-token" }] }]
    };

    await writeEncryptedAuthStorageState(path, state, workDir);

    const stored = await readFile(path, "utf8");
    expect(stored).not.toContain("sensitive-cookie");
    expect(stored).not.toContain("sensitive-token");
    await expect(readEncryptedAuthStorageState(path, workDir)).resolves.toEqual(state);
  });

  it("encrypts a legacy plaintext state when it is first read", async () => {
    const workDir = await temporaryDirectory();
    const path = join(workDir, "legacy.json");
    const state = { cookies: [{ name: "session", value: "legacy-secret" }], origins: [] };
    await writeFile(path, JSON.stringify(state), "utf8");

    await expect(readEncryptedAuthStorageState(path, workDir)).resolves.toEqual(state);
    expect(await readFile(path, "utf8")).not.toContain("legacy-secret");
  });

  it("rejects malformed storage state instead of passing it to the browser", async () => {
    const path = join(await temporaryDirectory(), "invalid.json");
    await writeFile(path, JSON.stringify({ cookies: "not-an-array", origins: [] }), "utf8");

    await expect(readEncryptedAuthStorageState(path)).rejects.toThrow("cookies and origins arrays");
  });
});

async function temporaryDirectory() {
  const directory = await mkdtemp(join(tmpdir(), "brain-auth-storage-"));
  directories.push(directory);
  return directory;
}
