import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readlinkSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";
import { BRAIN_CREATOR_VERSION } from "../version.js";

type BuildIdentity = {
  packageVersion: string;
  commit: string;
  buildId: string;
  builtAt: string;
  dirty: boolean | "unknown";
};

type SourceBuildIdentity = Pick<BuildIdentity, "commit" | "dirty" | "buildId">;

const runtimeGlobal = globalThis as typeof globalThis & {
  __brainCreatorSourceBuildIdentities?: Map<string, SourceBuildIdentity>;
};
const sourceBuildIdentities = runtimeGlobal.__brainCreatorSourceBuildIdentities ??= new Map();

export type RuntimeIdentityContext = {
  workspace: string;
  schemaVersion: number;
  provider: string;
  processKind?: "mcp" | "cli";
};

export function createRuntimeIdentityReader(options: { metadataPath?: string; sourceRoot?: string } = {}) {
  let build: BuildIdentity = {
    packageVersion: BRAIN_CREATOR_VERSION,
    commit: "unknown", buildId: "unknown", builtAt: "unknown", dirty: "unknown"
  };
  const startedAt = new Date(Date.now() - process.uptime() * 1000).toISOString();
  try {
    if (!options.metadataPath && (options.sourceRoot || import.meta.url.endsWith(".ts"))) {
      const cwd = options.sourceRoot ?? fileURLToPath(new URL("../../", import.meta.url));
      const root = resolve(cwd);
      const sourceIdentity = options.sourceRoot
        ? readSourceBuildIdentity(root)
        : sourceBuildIdentities.get(root) ?? readAndCacheSourceBuildIdentity(root);
      build = { ...build, ...sourceIdentity };
    } else {
      const value = JSON.parse(readFileSync(options.metadataPath ?? new URL("../build-identity.json", import.meta.url), "utf8"));
      if (typeof value.packageVersion === "string" && (value.commit === "unknown" || /^[a-f0-9]{40,64}$/.test(value.commit)) &&
          typeof value.buildId === "string" && typeof value.builtAt === "string" && (typeof value.dirty === "boolean" || value.dirty === "unknown")) {
        build = { packageVersion: value.packageVersion, commit: value.commit, buildId: value.buildId, builtAt: value.builtAt, dirty: value.dirty };
      }
    }
  } catch { /* Legacy packages without build provenance remain explicitly unknown. */ }
  const pinned = Object.freeze(build);
  return (context: RuntimeIdentityContext) => ({ ...pinned, pid: process.pid, startedAt, ...context, processKind: context.processKind ?? "cli" });
}

function readAndCacheSourceBuildIdentity(root: string) {
  const identity = readSourceBuildIdentity(root);
  sourceBuildIdentities.set(root, identity);
  return identity;
}

function readSourceBuildIdentity(root: string): SourceBuildIdentity {
  const git = (args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8", timeout: 3000, stdio: ["ignore", "pipe", "ignore"] }).trim();
  const commit = git(["rev-parse", "HEAD"]);
  const dirty = Boolean(git(["status", "--porcelain", "--untracked-files=all"]));
  const buildId = dirty ? `source:${commit}:${sourceWorkingTreeFingerprint(root)}` : `source:${commit}`;
  return { commit, dirty, buildId };
}

function sourceWorkingTreeFingerprint(root: string) {
  const hash = createHash("sha256");
  const diff = execFileSync("git", ["diff", "HEAD", "--binary", "--no-ext-diff", "--"], {
    cwd: root,
    timeout: 3000,
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "ignore"]
  });
  hash.update(diff);
  const untracked = execFileSync("git", ["ls-files", "--others", "--exclude-standard", "-z"], {
    cwd: root,
    encoding: "utf8",
    timeout: 3000,
    stdio: ["ignore", "pipe", "ignore"]
  });
  for (const relativePath of untracked.split("\0").filter(Boolean).sort()) {
    const path = join(root, relativePath);
    const entry = lstatSync(path);
    hash.update(relativePath.replaceAll("\\", "/")).update("\0");
    if (entry.isSymbolicLink()) hash.update("symlink:").update(readlinkSync(path));
    else if (entry.isFile()) hash.update(readFileSync(path));
    hash.update("\0");
  }
  return hash.digest("hex");
}

// Capture once, before hot configuration reloads or an on-disk package upgrade.
export const readRuntimeIdentity = createRuntimeIdentityReader();
