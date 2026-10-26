import { createCipheriv, createHash, createHmac, randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createWorkspaceIntegrityAuthenticator,
  decryptSecrets,
  encryptSecrets,
  migrateEncryptedSecrets,
  redactSecrets
} from "./crypto.js";

describe("shared crypto helpers", () => {
  const environmentNames = [
    "BRAIN_CREATOR_SECRET_KEY",
    "BRAIN_CREATOR_SECRET_KEY_FILE",
    "BRAIN_CREATOR_INTEGRITY_KEY",
    "BRAIN_CREATOR_INTEGRITY_KEY_FILE",
    "BRAIN_CREATOR_INTEGRITY_KEY_ID",
    "BRAIN_CREATOR_INTEGRITY_PREVIOUS_KEYS"
  ];
  let originalEnvironment = new Map<string, string | undefined>();
  const temporaryDirectories: string[] = [];

  beforeEach(() => {
    originalEnvironment = new Map(environmentNames.map((name) => [name, process.env[name]]));
    process.env.BRAIN_CREATOR_SECRET_KEY = "crypto-test-key";
    delete process.env.BRAIN_CREATOR_SECRET_KEY_FILE;
    delete process.env.BRAIN_CREATOR_INTEGRITY_KEY;
    delete process.env.BRAIN_CREATOR_INTEGRITY_KEY_FILE;
    delete process.env.BRAIN_CREATOR_INTEGRITY_KEY_ID;
    delete process.env.BRAIN_CREATOR_INTEGRITY_PREVIOUS_KEYS;
  });

  afterEach(async () => {
    for (const name of environmentNames) {
      const value = originalEnvironment.get(name);
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, {
      recursive: true,
      force: true
    })));
  });

  it("encrypts secrets and decrypts them back without exposing plain values", () => {
    const encrypted = encryptSecrets({ token: "private-token" });

    expect(encrypted.token).toMatch(/^enc:v2:/);
    expect(encrypted.token).not.toContain("private-token");
    expect(decryptSecrets(encrypted)).toEqual({ token: "private-token" });
  });

  it("migrates legacy v1 ciphertext to the random-key v2 format", () => {
    const legacy = { token: encryptLegacy("legacy-token") };
    const migrated = migrateEncryptedSecrets(legacy);

    expect(migrated.changed).toBe(true);
    expect(migrated.encryptedSecrets.token).toMatch(/^enc:v2:/);
    expect(decryptSecrets(migrated.encryptedSecrets)).toEqual({ token: "legacy-token" });
  });

  it("redacts secret values by key", () => {
    expect(redactSecrets({ token: "anything", cookie: "session=abc" })).toEqual({
      token: "[REDACTED]",
      cookie: "[REDACTED]"
    });
  });

  it("uses a separately managed integrity key and key ID", () => {
    process.env.BRAIN_CREATOR_INTEGRITY_KEY = "managed-integrity-key-material";
    process.env.BRAIN_CREATOR_INTEGRITY_KEY_ID = "integrity-2026-1";
    const authenticator = createWorkspaceIntegrityAuthenticator("unused-workspace");
    const tag = authenticator.sign("frozen evidence snapshot");

    expect(tag).toMatch(/^v1:integrity-2026-1:[a-f0-9]{64}$/);
    expect(authenticator.verify("frozen evidence snapshot", tag)).toBe(true);
    expect(authenticator.verify("changed evidence snapshot", tag)).toBe(false);
  });

  it("loads an external integrity key from an access-controlled file path", async () => {
    const workspace = createTemporaryDirectory();
    const keyFile = join(workspace, "managed-integrity.key");
    await mkdir(workspace, { recursive: true });
    await writeFile(keyFile, "managed-file-integrity-key");
    process.env.BRAIN_CREATOR_INTEGRITY_KEY_FILE = keyFile;
    process.env.BRAIN_CREATOR_INTEGRITY_KEY_ID = "integrity-file-1";
    const authenticator = createWorkspaceIntegrityAuthenticator(workspace);
    const tag = authenticator.sign("file-backed integrity record");

    expect(tag).toMatch(/^v1:integrity-file-1:/);
    expect(authenticator.verify("file-backed integrity record", tag)).toBe(true);
  });

  it("verifies prior-key signatures during rotation and signs only with the active key", () => {
    const workspace = createTemporaryDirectory();
    process.env.BRAIN_CREATOR_INTEGRITY_KEY = "previous-integrity-key-material";
    process.env.BRAIN_CREATOR_INTEGRITY_KEY_ID = "integrity-2026-1";
    const previousAuthenticator = createWorkspaceIntegrityAuthenticator(workspace);
    const previousTag = previousAuthenticator.sign("review record");

    process.env.BRAIN_CREATOR_INTEGRITY_KEY = "current-integrity-key-material";
    process.env.BRAIN_CREATOR_INTEGRITY_KEY_ID = "integrity-2026-2";
    process.env.BRAIN_CREATOR_INTEGRITY_PREVIOUS_KEYS = JSON.stringify({
      "integrity-2026-1": "previous-integrity-key-material"
    });
    const rotatedAuthenticator = createWorkspaceIntegrityAuthenticator(workspace);
    const currentTag = rotatedAuthenticator.sign("review record");

    expect(currentTag).toMatch(/^v1:integrity-2026-2:/);
    expect(rotatedAuthenticator.verify("review record", previousTag)).toBe(true);
    expect(rotatedAuthenticator.verify("review record", currentTag)).toBe(true);

    delete process.env.BRAIN_CREATOR_INTEGRITY_PREVIOUS_KEYS;
    expect(createWorkspaceIntegrityAuthenticator(workspace).verify("review record", previousTag)).toBe(false);
  });

  it("keeps verifying legacy untagged workspace HMACs after migration", () => {
    const workspace = createTemporaryDirectory();
    const key = createHash("sha256").update("crypto-test-key").digest();
    const legacyTag = createHmac("sha256", key).update("legacy snapshot").digest("hex");
    process.env.BRAIN_CREATOR_INTEGRITY_KEY = "new-integrity-key-material";
    process.env.BRAIN_CREATOR_INTEGRITY_KEY_ID = "integrity-2026-2";

    expect(createWorkspaceIntegrityAuthenticator(workspace).verify("legacy snapshot", legacyTag)).toBe(true);
  });

  it("does not create a missing workspace key while verifying", () => {
    const workspace = createTemporaryDirectory();
    delete process.env.BRAIN_CREATOR_SECRET_KEY;
    const authenticator = createWorkspaceIntegrityAuthenticator(workspace);

    expect(authenticator.verify("payload", "a".repeat(64))).toBe(false);
    expect(existsSync(join(workspace, ".brain-creator"))).toBe(false);
  });

  function createTemporaryDirectory() {
    const directory = join(tmpdir(), `brain-integrity-${randomBytes(8).toString("hex")}`);
    temporaryDirectories.push(directory);
    return directory;
  }
});

function encryptLegacy(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv(
    "aes-256-gcm",
    createHash("sha256").update(process.env.BRAIN_CREATOR_SECRET_KEY!).digest(),
    iv
  );
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [
    "enc",
    "v1",
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    encrypted.toString("base64url")
  ].join(":");
}
