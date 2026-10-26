import { realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type {
  ExecutionPostconditionVerifier,
  PostconditionVerification
} from "./postconditionVerifier.js";

export function configuredPostconditionVerifier(
  workspace: string,
  env: NodeJS.ProcessEnv = process.env
): ExecutionPostconditionVerifier | undefined {
  const configuredModule = env.BRAIN_CREATOR_POSTCONDITION_VERIFIER_MODULE?.trim();
  if (!configuredModule) return undefined;

  let verifierPromise: Promise<ExecutionPostconditionVerifier> | undefined;
  return async (input) => {
    try {
      verifierPromise ??= loadVerifier(workspace, configuredModule);
      return validateVerifierResult(await (await verifierPromise)(input));
    } catch {
      return unavailableVerification();
    }
  };
}

function validateVerifierResult(value: unknown): PostconditionVerification {
  if (!value || typeof value !== "object" || Array.isArray(value)) return unavailableVerification();
  const result = value as Partial<PostconditionVerification>;
  if (result.status === "not-confirmed" || result.status === "unavailable") {
    return {
      status: result.status,
      ...(typeof result.reason === "string" && result.reason.trim() ? { reason: result.reason.trim() } : {})
    };
  }
  if (result.status !== "confirmed" || typeof result.actualResult !== "string" || !result.actualResult.trim() ||
      !Array.isArray(result.evidenceRefs) || result.evidenceRefs.length === 0 ||
      result.evidenceRefs.some((reference) => typeof reference !== "string" || !reference.trim()) ||
      typeof result.checkedAt !== "string" || !Number.isFinite(Date.parse(result.checkedAt)) ||
      !Array.isArray(result.evidenceArtifacts) || result.evidenceArtifacts.length === 0 ||
      result.evidenceArtifacts.some((artifact) => !artifact || typeof artifact.path !== "string" || !artifact.path.trim() ||
        typeof artifact.sha256 !== "string" || !/^[a-f0-9]{64}$/i.test(artifact.sha256))) {
    return unavailableVerification();
  }
  return {
    status: "confirmed",
    actualResult: result.actualResult,
    evidenceRefs: result.evidenceRefs,
    checkedAt: result.checkedAt,
    evidenceArtifacts: result.evidenceArtifacts
  };
}

async function loadVerifier(workspace: string, configuredModule: string): Promise<ExecutionPostconditionVerifier> {
  const workspacePath = await realpath(workspace);
  const modulePath = await realpath(resolve(workspacePath, configuredModule));
  const moduleRelativePath = relative(workspacePath, modulePath);
  if (!moduleRelativePath || moduleRelativePath === ".." || moduleRelativePath.startsWith("..\\") ||
      moduleRelativePath.startsWith("../") || isAbsolute(moduleRelativePath)) {
    throw new Error("Configured postcondition verifier must be inside the workspace");
  }
  const loaded = await import(pathToFileURL(modulePath).href) as {
    default?: unknown;
    verifyPostcondition?: unknown;
  };
  const verifier = loaded.verifyPostcondition ?? loaded.default;
  if (typeof verifier !== "function") throw new Error("Configured postcondition verifier must export a function");
  return verifier as ExecutionPostconditionVerifier;
}

function unavailableVerification(): PostconditionVerification {
  return {
    status: "unavailable",
    reason: "The configured target postcondition verifier could not be loaded or completed."
  };
}
