import { chmod, mkdir, rename, rm } from "node:fs/promises";
import { dirname, relative, join } from "node:path";
import { chromium, type Browser, type Page } from "@playwright/test";
import type { AuthProfile, SystemProfile } from "../domain/types.js";
import type { BrainCreatorService } from "../domain/service.js";
import { resolveProtectedStorageStatePath } from "../shared/authStorage.js";
import { writeEncryptedAuthStorageState } from "../shared/authStorageState.js";
import { browserExecutablePath, verifyStoredBrowserAuth } from "./authStateVerifier.js";

export type AuthStateCaptureInput = {
  workDir: string;
  system: SystemProfile;
  authProfile: AuthProfile;
  service: Pick<BrainCreatorService, "getCaptureAuth" | "setAuthStorageStatePath" | "verifyAuthProfile">;
  waitForManualLogin: (page: Page) => Promise<void>;
  launchBrowser?: () => Promise<Browser>;
  verifyAuth?: typeof verifyStoredBrowserAuth;
};

export async function captureAuthState(input: AuthStateCaptureInput) {
  if (input.authProfile.projectId !== input.system.id) {
    throw new Error("Auth profile belongs to another business system");
  }
  const allowedOrigins = new Set(
    [input.system.baseUrl, ...input.system.urlAllowlist].map((value) => allowedHttpOrigin(value))
  );
  const configuredPath = input.service.getCaptureAuth(input.authProfile.id, input.workDir)?.secrets.storageStatePath;
  const relativePath = configuredPath ?? join(
    ".brain-creator",
    "auth",
    safePart(input.system.id),
    safePart(input.authProfile.id),
    "storage-state.json"
  );
  const destinationPath = await resolveProtectedStorageStatePath(input.workDir, relativePath);
  const authDirectory = dirname(destinationPath);
  await mkdir(authDirectory, { recursive: true, mode: 0o700 });
  await chmod(authDirectory, 0o700).catch(() => undefined);

  const temporaryPath = `${destinationPath}.capture-${Date.now()}.tmp`;
  const browser = await (input.launchBrowser ?? (() => {
    const executablePath = browserExecutablePath();
    return chromium.launch({
      headless: false,
      ...(executablePath ? { executablePath } : {})
    });
  }))();
  let page: Page | undefined;
  let destinationCommitted = false;
  try {
    const context = await browser.newContext();
    page = await context.newPage();
    await page.route("**/*", async (route) => {
      const request = route.request();
      if (!request.isNavigationRequest() || isAllowedOrigin(request.url(), allowedOrigins)) {
        await route.continue();
        return;
      }
      await route.abort("blockedbyclient");
    });
    await page.goto(input.system.baseUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
    if (!isAllowedOrigin(page.url(), allowedOrigins)) {
      throw new Error("Authentication capture navigated outside the configured system allowlist");
    }

    await input.waitForManualLogin(page);

    const finalUrl = page.url();
    if (!isAllowedOrigin(finalUrl, allowedOrigins)) {
      throw new Error("Authentication capture finished outside the configured system allowlist");
    }
    const state = await context.storageState();
    await writeEncryptedAuthStorageState(temporaryPath, state as {
      cookies: Array<Record<string, unknown>>;
      origins: Array<{ origin: string; localStorage: Array<{ name: string; value: string }> }>;
    }, input.workDir);

    const verification = await (input.verifyAuth ?? verifyStoredBrowserAuth)({
      storageStatePath: temporaryPath,
      workDir: input.workDir,
      targetUrl: input.system.baseUrl,
      allowedUrls: input.system.urlAllowlist
    });
    if (verification.status !== "valid" || !verification.finalUrl) {
      throw new Error(verification.reason ?? "Captured login state did not pass fresh-context verification");
    }

    await rename(temporaryPath, destinationPath);
    destinationCommitted = true;
    await chmod(destinationPath, 0o600).catch(() => undefined);
    const storedPath = relative(input.workDir, destinationPath).replace(/\\/g, "/");
    input.service.setAuthStorageStatePath(input.authProfile.id, storedPath, input.workDir);
    const profile = input.service.verifyAuthProfile(input.authProfile.id, {
      targetUrl: input.system.baseUrl,
      finalUrl: verification.finalUrl,
      title: verification.title
    });
    return {
      profile,
      verification: {
        status: verification.status,
        finalUrl: verification.finalUrl,
        title: verification.title
      }
    };
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
    if (destinationCommitted) await rm(destinationPath, { force: true }).catch(() => undefined);
    throw error;
  } finally {
    await page?.context().close().catch(() => undefined);
    await browser.close().catch(() => undefined);
  }
}

function allowedHttpOrigin(value: string) {
  const url = new URL(value);
  if ((url.protocol !== "https:" && url.protocol !== "http:") || url.username || url.password) {
    throw new Error("Authentication allowlist entries must be HTTP(S) origins without credentials");
  }
  return url.origin;
}

function isAllowedOrigin(value: string, allowedOrigins: Set<string>) {
  try {
    return allowedOrigins.has(allowedHttpOrigin(value));
  } catch {
    return false;
  }
}

function safePart(value: string) {
  return value.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 120) || "unknown";
}
