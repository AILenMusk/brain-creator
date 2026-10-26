import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { createBrainCreatorMcpContext, handleBrainCreatorTool } from "../src/mcp/handlers.js";

const rootDir = process.cwd();
const smokeRoot = await mkdtemp(join(rootDir, ".brain-creator-test", "installed-mcp-"));
const businessWorkspace = join(smokeRoot, "business-workspace");
const sourceDataFile = join(rootDir, ".brain-creator", "local-assets.json");
const previousWorkspace = process.env.BRAIN_CREATOR_WORKSPACE;
const previousDataFile = process.env.BRAIN_CREATOR_DATA_FILE;
const sourceSnapshot = await readOptionalFile(sourceDataFile);

try {
  await mkdir(businessWorkspace, { recursive: true });
  process.env.BRAIN_CREATOR_WORKSPACE = businessWorkspace;
  delete process.env.BRAIN_CREATOR_DATA_FILE;

  const context = createBrainCreatorMcpContext();
  const system = dataOf(
    await handleBrainCreatorTool(context, "bc_create_system", {
      name: "Installed MCP Smoke System",
      environment: "installed-smoke",
      baseUrl: "https://installed.example.test",
      defaultLocale: "en-US",
      urlAllowlist: ["https://installed.example.test"]
    })
  );

  assert(context.workDir === businessWorkspace, "MCP context did not use business workspace");
  const installedStoreDir = join(businessWorkspace, ".brain-creator", "store");
  const installedManifest = JSON.parse(
    await readFile(join(installedStoreDir, "manifest.json"), "utf8")
  );
  assert(
    installedManifest.format === "sharded" &&
      installedManifest.collections.includes("systemProfiles"),
    "Installed workspace did not persist a valid sharded store manifest"
  );
  const installedProfiles = JSON.parse(
    await readFile(join(installedStoreDir, "collections", "systemProfiles.json"), "utf8")
  );
  assert(
    installedProfiles.some((item: { id: string }) => item.id === system.id),
    "Installed workspace did not persist created system"
  );
  assert(
    (await readOptionalFile(sourceDataFile)) === sourceSnapshot,
    "Source repository Brain Creator assets changed during installed MCP smoke"
  );

  console.log("Source MCP workspace isolation smoke passed.");
  console.log(`Workspace: ${businessWorkspace}`);
  console.log(`Store: ${installedStoreDir}`);
  console.log(`System: ${system.id}`);
} finally {
  restoreEnv("BRAIN_CREATOR_WORKSPACE", previousWorkspace);
  restoreEnv("BRAIN_CREATOR_DATA_FILE", previousDataFile);
  if (process.env.BRAIN_CREATOR_KEEP_LIVE_ARTIFACTS !== "1") {
    await rm(smokeRoot, { recursive: true, force: true });
  }
}

function dataOf(result: CallToolResult) {
  const content = result.content?.[0];
  if (!content || content.type !== "text") {
    throw new Error(`Unexpected MCP result: ${JSON.stringify(result)}`);
  }
  const envelope = JSON.parse(content.text);
  if (!envelope.success) {
    throw new Error(`MCP call failed: ${content.text}`);
  }
  return envelope.data;
}

async function readOptionalFile(path: string) {
  return readFile(path, "utf8").catch(() => "");
}

function restoreEnv(key: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[key];
    return;
  }
  process.env[key] = value;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}
