import { realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { TestDataProvider, TestDataProviderRequest } from "./testdata.js";
import type {
  TestDataNoEffectVerification,
  TestDataNoEffectVerifier
} from "../knowledge/testDataProvider.js";

export type ConfiguredTestDataAdapterSet = {
  providers: TestDataProvider[];
  noEffectVerifier?: TestDataNoEffectVerifier;
  status: "configured" | "not-configured";
};

type ConfiguredTestDataModule = {
  testDataProviders?: unknown;
  verifyNoEffect?: unknown;
  testDataNoEffectVerifier?: unknown;
};

export function configuredTestDataAdapter(
  workspace: string,
  env: NodeJS.ProcessEnv = process.env
): ConfiguredTestDataAdapterSet {
  const configuredModule = env.BRAIN_CREATOR_TESTDATA_ADAPTER_MODULE?.trim();
  if (!configuredModule) return { providers: [], status: "not-configured" };

  let adaptersPromise: Promise<{ providers: TestDataProvider[]; noEffectVerifier?: TestDataNoEffectVerifier }> | undefined;
  const loadAdapters = () => adaptersPromise ??= loadConfiguredModule(workspace, configuredModule);
  const provider: TestDataProvider = {
    name: "configured-target-testdata-adapter",
    supports: () => true,
    lookup: async (input) => {
      const selected = await selectProvider(input);
      const result = await selected.lookup(input);
      return Array.isArray(result)
        ? result.map((item) => ({ ...item, provider: selected.name }))
        : result ? { ...result, provider: selected.name } : undefined;
    },
    create: async (input) => {
      const selected = await selectProvider(input);
      return { ...(await selected.create(input)), provider: selected.name };
    },
    transition: async (input) => {
      const selected = await selectProvider(input);
      return { ...(await selected.transition(input)), provider: selected.name };
    },
    verify: async (input) => {
      const selected = await selectProvider(input);
      return { ...(await selected.verify(input)), provider: selected.name };
    },
    cleanup: async (input) => {
      const selected = await selectProvider(input);
      return { ...(await selected.cleanup(input)), provider: selected.name };
    }
  };
  async function selectProvider(input: TestDataProviderRequest) {
    const adapters = await loadAdapters();
    const selected = adapters.providers.filter((candidate) => candidate.supports(input));
    if (selected.length !== 1) {
      throw new Error(`Configured Testdata adapter must resolve one provider for ${input.systemId}; matched ${selected.length}`);
    }
    return selected[0]!;
  }

  const noEffectVerifier: TestDataNoEffectVerifier = async (input) => {
    const adapters = await loadAdapters();
    if (adapters.noEffectVerifier) return adapters.noEffectVerifier(input);
    const unavailable: TestDataNoEffectVerification = {
      status: "unavailable",
      provider: "configured-target-testdata-adapter",
      query: input.query,
      evidenceRefs: [],
      evidenceArtifacts: [],
      checkedAt: new Date().toISOString(),
      reason: "The configured Testdata adapter does not export verifyNoEffect."
    };
    return unavailable;
  };

  return { providers: [provider], noEffectVerifier, status: "configured" };
}

async function loadConfiguredModule(workspace: string, configuredModule: string) {
  const workspacePath = await realpath(workspace);
  const modulePath = await realpath(resolve(workspacePath, configuredModule));
  const moduleRelativePath = relative(workspacePath, modulePath);
  if (!moduleRelativePath || moduleRelativePath === ".." || moduleRelativePath.startsWith("..\\") ||
      moduleRelativePath.startsWith("../") || isAbsolute(moduleRelativePath)) {
    throw new Error("Configured Testdata adapter must be inside the workspace");
  }
  const loaded = await import(pathToFileURL(modulePath).href) as ConfiguredTestDataModule & { default?: unknown };
  const defaultExport = loaded.default && typeof loaded.default === "object"
    ? loaded.default as ConfiguredTestDataModule
    : undefined;
  const rawProviders = loaded.testDataProviders ?? defaultExport?.testDataProviders;
  if (!Array.isArray(rawProviders) || rawProviders.length === 0) {
    throw new Error("Configured Testdata adapter must export a non-empty testDataProviders array");
  }
  const providers = rawProviders.map(validateProvider);
  if (new Set(providers.map((provider) => provider.name)).size !== providers.length) {
    throw new Error("Configured Testdata adapter provider names must be unique");
  }
  const rawNoEffectVerifier = loaded.verifyNoEffect ?? loaded.testDataNoEffectVerifier ??
    defaultExport?.verifyNoEffect ?? defaultExport?.testDataNoEffectVerifier;
  if (rawNoEffectVerifier !== undefined && typeof rawNoEffectVerifier !== "function") {
    throw new Error("Configured Testdata verifyNoEffect export must be a function");
  }
  return {
    providers,
    ...(rawNoEffectVerifier ? { noEffectVerifier: rawNoEffectVerifier as TestDataNoEffectVerifier } : {})
  };
}

function validateProvider(value: unknown): TestDataProvider {
  if (!value || typeof value !== "object") throw new Error("Configured Testdata provider must be an object");
  const provider = value as Partial<TestDataProvider>;
  if (!provider.name?.trim() || typeof provider.supports !== "function" ||
      typeof provider.lookup !== "function" || typeof provider.create !== "function" ||
      typeof provider.transition !== "function" || typeof provider.verify !== "function" ||
      typeof provider.cleanup !== "function") {
    throw new Error("Configured Testdata provider must implement name, supports, lookup, create, transition, verify, and cleanup");
  }
  return provider as TestDataProvider;
}
