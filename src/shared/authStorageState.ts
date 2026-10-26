import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { decryptSecrets, encryptSecrets } from "./crypto.js";

const format = "brain-creator-encrypted-auth-state";

export type BrowserStorageState = {
  cookies: Array<Record<string, unknown>>;
  origins: Array<{
    origin: string;
    localStorage: Array<{ name: string; value: string }>;
  }>;
};

type EncryptedStorageState = {
  format: typeof format;
  version: 1;
  payload: string;
};

export async function writeEncryptedAuthStorageState(path: string, state: BrowserStorageState, workspace?: string) {
  const directory = dirname(path);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700).catch(() => undefined);
  const payload = encryptSecrets({ state: JSON.stringify(state) }, workspace).state;
  const envelope: EncryptedStorageState = { format, version: 1, payload };
  const temporaryPath = `${path}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`;
  try {
    await writeFile(temporaryPath, JSON.stringify(envelope), { encoding: "utf8", mode: 0o600, flag: "wx" });
    await chmod(temporaryPath, 0o600).catch(() => undefined);
    await rename(temporaryPath, path);
    await chmod(path, 0o600).catch(() => undefined);
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

export async function readEncryptedAuthStorageState(path: string, workspace?: string): Promise<BrowserStorageState> {
  const raw = await readFile(path, "utf8");
  const parsed = JSON.parse(raw) as unknown;
  if (isEncryptedState(parsed)) {
    const decrypted = decryptSecrets({ state: parsed.payload }, workspace).state;
    return parseStorageState(decrypted);
  }

  const state = parseStorageState(raw);
  await writeEncryptedAuthStorageState(path, state, workspace);
  return state;
}

function isEncryptedState(value: unknown): value is EncryptedStorageState {
  return Boolean(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      (value as EncryptedStorageState).format === format &&
      (value as EncryptedStorageState).version === 1 &&
      typeof (value as EncryptedStorageState).payload === "string" &&
      (value as EncryptedStorageState).payload.startsWith("enc:")
  );
}

function parseStorageState(value: string): BrowserStorageState {
  const parsed = JSON.parse(value) as Partial<BrowserStorageState>;
  if (!Array.isArray(parsed.cookies) || !Array.isArray(parsed.origins)) {
    throw new Error("Auth storage state must contain cookies and origins arrays");
  }
  return parsed as BrowserStorageState;
}
