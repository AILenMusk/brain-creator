import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { dirname, resolve } from "node:path";

export function redactSecrets(secrets: Record<string, string>) {
  return Object.fromEntries(Object.keys(secrets).map((key) => [key, "[REDACTED]"]));
}

export function encryptSecrets(secrets: Record<string, string>, workspace?: string) {
  return Object.fromEntries(
    Object.entries(secrets).map(([key, value]) => [key, encryptSecretValue(value, workspace)])
  );
}

export function decryptSecrets(secrets: Record<string, string>, workspace?: string) {
  return Object.fromEntries(
    Object.entries(secrets)
      .filter(([, value]) => value.startsWith("enc:"))
      .map(([key, value]) => [key, decryptSecretValue(value, workspace)])
  );
}

export type IntegrityAuthenticator = {
  sign(payload: string): string;
  verify(payload: string, tag: string): boolean;
};

export function createWorkspaceIntegrityAuthenticator(workspace: string): IntegrityAuthenticator {
  return {
    sign(payload) {
      const keyRing = integrityKeyRing(workspace, true);
      if (!keyRing.active) throw new Error("No active integrity key is configured");
      const digest = createHmac("sha256", keyRing.active.key).update(payload).digest("hex");
      return `v1:${keyRing.active.id}:${digest}`;
    },
    verify(payload, tag) {
      try {
        const keyRing = integrityKeyRing(workspace, false);
        const taggedMatch = /^v1:([A-Za-z0-9][A-Za-z0-9._-]{0,63}):([a-f0-9]{64})$/.exec(tag);
        const candidates = taggedMatch
          ? [keyRing.keys.get(taggedMatch[1])].filter((key): key is Buffer => Boolean(key))
          : /^[a-f0-9]{64}$/i.test(tag)
            ? [...keyRing.keys.values()]
            : [];
        const actual = Buffer.from(taggedMatch?.[2] ?? tag, "hex");
        return candidates.some((key) => {
          const expected = createHmac("sha256", key).update(payload).digest();
          return actual.length === expected.length && timingSafeEqual(actual, expected);
        });
      } catch {
        return false;
      }
    }
  };
}

type IntegrityKeyRing = {
  active?: { id: string; key: Buffer };
  keys: Map<string, Buffer>;
};

function integrityKeyRing(workspace: string, createWorkspaceKey: boolean): IntegrityKeyRing {
  const keys = new Map<string, Buffer>();
  const externalKey = process.env.BRAIN_CREATOR_INTEGRITY_KEY;
  const externalKeyFile = process.env.BRAIN_CREATOR_INTEGRITY_KEY_FILE;
  if (externalKey && externalKeyFile) {
    throw new Error("Configure only one of BRAIN_CREATOR_INTEGRITY_KEY and BRAIN_CREATOR_INTEGRITY_KEY_FILE");
  }

  let active: IntegrityKeyRing["active"];
  if (externalKey || externalKeyFile) {
    const secret = externalKey ?? readFileSync(resolve(externalKeyFile!), "utf8");
    if (!secret) throw new Error("The configured external integrity key is empty");
    const id = process.env.BRAIN_CREATOR_INTEGRITY_KEY_ID || "external-current";
    if (!isIntegrityKeyId(id)) throw new Error("BRAIN_CREATOR_INTEGRITY_KEY_ID is invalid");
    active = { id, key: deriveSecretKey(secret) };
    keys.set(id, active.key);
  } else {
    const legacyKey = createWorkspaceKey ? secretKey(workspace) : existingSecretKey(workspace);
    if (legacyKey) {
      const id = process.env.BRAIN_CREATOR_SECRET_KEY ? "legacy-secret" : "workspace";
      active = { id, key: legacyKey };
      keys.set(id, legacyKey);
    }
  }

  const previousKeys = process.env.BRAIN_CREATOR_INTEGRITY_PREVIOUS_KEYS;
  if (previousKeys) {
    const parsed = JSON.parse(previousKeys) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("BRAIN_CREATOR_INTEGRITY_PREVIOUS_KEYS must be a JSON object of key IDs to key values");
    }
    for (const [id, secret] of Object.entries(parsed)) {
      if (!isIntegrityKeyId(id) || typeof secret !== "string" || secret.length === 0 || keys.has(id)) {
        throw new Error("BRAIN_CREATOR_INTEGRITY_PREVIOUS_KEYS contains an invalid or duplicate key entry");
      }
      keys.set(id, deriveSecretKey(secret));
    }
  }

  addLegacyVerificationKeys(keys, workspace);
  return { active, keys };
}

function addLegacyVerificationKeys(keys: Map<string, Buffer>, workspace: string) {
  if (process.env.BRAIN_CREATOR_SECRET_KEY) {
    const key = secretKey(workspace);
    addVerificationKey(keys, "legacy-secret", key);
  }
  const keyPath = resolve(
    process.env.BRAIN_CREATOR_SECRET_KEY_FILE ??
      resolve(workspace, ".brain-creator", "secret.key")
  );
  if (existsSync(keyPath)) {
    const key = deriveSecretKey(readFileSync(keyPath));
    addVerificationKey(keys, "legacy-workspace", key);
  }
}

function addVerificationKey(keys: Map<string, Buffer>, preferredId: string, key: Buffer) {
  if ([...keys.values()].some((candidate) => candidate.equals(key))) return;
  let id = preferredId;
  let suffix = 1;
  while (keys.has(id)) id = `${preferredId}-${suffix++}`;
  keys.set(id, key);
}

function isIntegrityKeyId(value: string) {
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(value);
}

function deriveSecretKey(secret: string | Buffer) {
  return createHash("sha256").update(secret).digest();
}

function encryptSecretValue(value: string, workspace?: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", secretKey(workspace), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [
    "enc",
    "v2",
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    encrypted.toString("base64url")
  ].join(":");
}

function decryptSecretValue(value: string, workspace?: string) {
  const [, version, iv, tag, encrypted] = value.split(":");
  if (version !== "v1") {
    if (version !== "v2") {
      return Buffer.from(value.slice("enc:".length), "base64").toString("utf8");
    }
    return decryptWithKey(value, secretKey(workspace), iv, tag, encrypted);
  }
  return decryptWithKey(value, legacySecretKey(), iv, tag, encrypted);
}

function decryptWithKey(value: string, key: Buffer, iv: string, tag: string, encrypted: string) {
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(iv, "base64url")
  );
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(encrypted, "base64url")),
    decipher.final()
  ]).toString("utf8");
}

function legacySecretKey() {
  return createHash("sha256")
    .update(process.env.BRAIN_CREATOR_SECRET_KEY ?? process.cwd())
    .digest();
}

function secretKey(workspace?: string) {
  if (process.env.BRAIN_CREATOR_SECRET_KEY) {
    return createHash("sha256").update(process.env.BRAIN_CREATOR_SECRET_KEY).digest();
  }
  const keyPath = resolve(
    process.env.BRAIN_CREATOR_SECRET_KEY_FILE ??
      resolve(workspace ?? process.env.BRAIN_CREATOR_WORKSPACE ?? process.cwd(), ".brain-creator", "secret.key")
  );
  if (!existsSync(keyPath)) {
    mkdirSync(dirname(keyPath), { recursive: true });
    writeFileSync(keyPath, randomBytes(32), { mode: 0o600, flag: "wx" });
    try {
      chmodSync(keyPath, 0o600);
    } catch {
      // Windows does not expose POSIX file modes; ACLs remain the host control.
    }
  }
  return createHash("sha256").update(readFileSync(keyPath)).digest();
}

function existingSecretKey(workspace: string) {
  if (process.env.BRAIN_CREATOR_SECRET_KEY) {
    return createHash("sha256").update(process.env.BRAIN_CREATOR_SECRET_KEY).digest();
  }
  const keyPath = resolve(
    process.env.BRAIN_CREATOR_SECRET_KEY_FILE ??
      resolve(workspace, ".brain-creator", "secret.key")
  );
  if (!existsSync(keyPath)) return undefined;
  return createHash("sha256").update(readFileSync(keyPath)).digest();
}

export function migrateEncryptedSecrets(encryptedSecrets: Record<string, string>, workspace?: string) {
  const migrated: Record<string, string> = {};
  let changed = false;
  for (const [key, value] of Object.entries(encryptedSecrets)) {
    if (value.startsWith("enc:v1:")) {
      migrated[key] = encryptSecretValue(decryptSecretValue(value, workspace), workspace);
      changed = true;
    } else {
      migrated[key] = value;
    }
  }
  return { encryptedSecrets: migrated, changed };
}
