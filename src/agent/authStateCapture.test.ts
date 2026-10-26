// @vitest-environment node

import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Browser, Route } from "@playwright/test";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AuthProfile, SystemProfile } from "../domain/types.js";
import { captureAuthState, type AuthStateCaptureInput } from "./authStateCapture.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("manual browser auth capture", () => {
  it("stores encrypted state only after allowlist checks and fresh-context verification", async () => {
    const fixture = await createFixture();
    let currentUrl = "https://sso.example.test/cas/login";
    fixture.page.url.mockImplementation(() => currentUrl);
    fixture.waitForManualLogin.mockImplementation(async () => {
      currentUrl = "https://ghr.example.test/recruitmentPlatform/demands";
    });

    const result = await captureAuthState(fixture.input);

    expect(fixture.page.goto).toHaveBeenCalledWith(
      "https://ghr.example.test/index",
      { waitUntil: "domcontentloaded", timeout: 30_000 }
    );
    expect(fixture.context.storageState).toHaveBeenCalledOnce();
    expect(fixture.verifyAuth).toHaveBeenCalledWith(expect.objectContaining({
      targetUrl: fixture.system.baseUrl,
      allowedUrls: fixture.system.urlAllowlist
    }));
    expect(fixture.service.setAuthStorageStatePath).toHaveBeenCalledWith(
      fixture.authProfile.id,
      expect.stringContaining(".brain-creator/auth/system_1/auth_1/storage-state.json")
    );
    const stored = await readFile(join(fixture.workDir, ".brain-creator/auth/system_1/auth_1/storage-state.json"), "utf8");
    expect(stored).not.toContain("captured-session-secret");
    expect(result.profile.status).toBe("succeeded");
    expect(result.verification.finalUrl).toBe(currentUrl);
    expect(fixture.browser.close).toHaveBeenCalledOnce();
  });

  it("blocks top-level navigation outside the system allowlist", async () => {
    const fixture = await createFixture();
    await captureAuthState(fixture.input);
    const route = {
      request: () => ({
        isNavigationRequest: () => true,
        url: () => "https://outside.example.test/login"
      }),
      abort: vi.fn(async () => undefined),
      continue: vi.fn(async () => undefined)
    } as unknown as Route;

    await fixture.getNavigationHandler()?.(route);

    expect(route.abort).toHaveBeenCalledWith("blockedbyclient");
    expect(route.continue).not.toHaveBeenCalled();
  });

  it("does not persist a state that fails fresh-context verification", async () => {
    const fixture = await createFixture({
      verification: {
        status: "expired",
        finalUrl: "https://sso.example.test/cas/login",
        reason: "Stored browser authentication redirected to a login page."
      }
    });

    await expect(captureAuthState(fixture.input)).rejects.toThrow("redirected to a login page");

    expect(fixture.service.setAuthStorageStatePath).not.toHaveBeenCalled();
    expect(fixture.service.verifyAuthProfile).not.toHaveBeenCalled();
    const directory = join(fixture.workDir, ".brain-creator", "auth", "system_1", "auth_1");
    await expect(readdir(directory)).resolves.toEqual([]);
  });

  it("rejects a foreign AuthProfile before launching a browser", async () => {
    const fixture = await createFixture();
    fixture.input.authProfile = { ...fixture.authProfile, projectId: "another-system" };

    await expect(captureAuthState(fixture.input)).rejects.toThrow("another business system");

    expect(fixture.launchBrowser).not.toHaveBeenCalled();
  });
});

async function createFixture(options: {
  verification?: { status: "valid" | "expired" | "unavailable"; finalUrl?: string; title?: string; reason?: string };
} = {}) {
  const workDir = await mkdtemp(join(tmpdir(), "brain-auth-capture-"));
  temporaryDirectories.push(workDir);
  const system: SystemProfile = {
    id: "system_1",
    name: "Test System",
    environment: "test",
    baseUrl: "https://ghr.example.test/index",
    defaultLocale: "zh-CN",
    urlAllowlist: ["https://sso.example.test"],
    status: "succeeded",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z"
  };
  const authProfile = {
    id: "auth_1",
    projectId: system.id,
    env: "test",
    role: "current-login-account",
    loginMethod: "script",
    encryptedSecrets: {},
    status: "pending",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z"
  } as AuthProfile;
  let currentUrl = system.baseUrl;
  let navigationHandler: ((route: Route) => Promise<void>) | undefined;
  const page = {
    route: vi.fn(async (_pattern: string, handler: (route: Route) => Promise<void>) => {
      navigationHandler = handler;
    }),
    goto: vi.fn(async () => { currentUrl = "https://sso.example.test/cas/login"; }),
    url: vi.fn(() => currentUrl),
    context: vi.fn()
  };
  const context = {
    newPage: vi.fn(async () => page),
    storageState: vi.fn(async () => ({
      cookies: [{ name: "session", value: "captured-session-secret" }],
      origins: []
    })),
    close: vi.fn(async () => undefined)
  };
  page.context.mockReturnValue(context);
  const browser = {
    newContext: vi.fn(async () => context),
    close: vi.fn(async () => undefined)
  };
  const launchBrowser = vi.fn(async () => browser as unknown as Browser);
  const verifyAuth = vi.fn(async () => options.verification ?? {
    status: "valid" as const,
    finalUrl: "https://ghr.example.test/recruitmentPlatform/demands",
    title: "HRONE"
  });
  const service = {
    getCaptureAuth: vi.fn(() => ({ loginMethod: "script" as const, secrets: {} })),
    setAuthStorageStatePath: vi.fn(() => ({ ...authProfile, status: "pending" as const })),
    verifyAuthProfile: vi.fn(() => ({ ...authProfile, status: "succeeded" as const }))
  };
  const waitForManualLogin = vi.fn(async () => undefined);
  const input: AuthStateCaptureInput = {
    workDir,
    system,
    authProfile,
    service,
    waitForManualLogin,
    launchBrowser,
    verifyAuth
  };
  return { workDir, system, authProfile, input, page, context, browser, launchBrowser, verifyAuth, service, waitForManualLogin, getNavigationHandler: () => navigationHandler };
}
