import { mkdtemp, readFile, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";

const rootDir = process.cwd();
const startedAt = Date.now();
const workspace = await mkdtemp(join(tmpdir(), "brain-source-mcp-"));
const client = new Client({ name: "brain-creator-source-identity-smoke", version: "1.0.0" });
const transport = new StdioClientTransport({
  command: process.execPath,
  args: ["--loader", "ts-node/esm", join(rootDir, "src/mcp/server.ts")],
  cwd: rootDir,
  env: {
    ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined)),
    BRAIN_CREATOR_WORKSPACE: workspace,
    BRAIN_CREATOR_TOOL_PROFILE: "facade",
    BRAIN_CREATOR_AGENT_PROVIDER: "host-agent",
    BRAIN_CREATOR_AGENT_TIMEOUT_MS: "120000"
  },
  stderr: "pipe"
});

try {
  await client.connect(transport);
  const status = dataOf(await client.callTool({
    name: "bc_status",
    arguments: { responseMode: "full" }
  }));
  const identity = status.runtimeIdentity;
  assert(identity && typeof identity === "object", "Source MCP returned no runtime identity");

  const sourceCommit = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: rootDir,
    encoding: "utf8"
  }).trim();
  const packageVersion = JSON.parse(await readFile(join(rootDir, "package.json"), "utf8")).version;
  assert(identity.packageVersion === packageVersion, "Source MCP reported the wrong package version");
  assert(identity.commit === sourceCommit, "Source MCP reported the wrong source commit");
  assert(
    identity.dirty === false
      ? identity.buildId === `source:${sourceCommit}`
      : identity.dirty === true && typeof identity.buildId === "string" && identity.buildId.startsWith(`source:${sourceCommit}:`),
    "Source MCP build ID does not reflect its clean or dirty checkout state"
  );
  assert(typeof identity.builtAt === "string" && identity.builtAt.length > 0, "Source MCP reported no build time");
  assert(Number.isInteger(identity.pid) && identity.pid !== process.pid, "Source MCP reported no child process ID");
  assert(
    typeof identity.startedAt === "string" &&
      Number.isFinite(Date.parse(identity.startedAt)) &&
      Date.parse(identity.startedAt) >= startedAt - 5_000,
    "Source MCP reported no current process start time"
  );
  assert(resolve(identity.workspace) === resolve(workspace), "Source MCP reported the wrong workspace");
  assert(Number.isInteger(identity.schemaVersion) && identity.schemaVersion > 0, "Source MCP reported no Store schema");
  assert(identity.provider === "host-agent", "Source MCP reported the wrong Provider");
  assert(identity.processKind === "mcp", "Source process did not identify as MCP");

  console.log("Source MCP runtime identity smoke passed.");
  console.log(`Commit: ${identity.commit}`);
  console.log(`Build ID: ${identity.buildId}`);
  console.log(`Dirty: ${identity.dirty}`);
  console.log(`PID: ${identity.pid}`);
  console.log(`Workspace: ${identity.workspace}`);
} finally {
  await client.close().catch(() => undefined);
  await rm(workspace, { recursive: true, force: true });
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function dataOf(result: Awaited<ReturnType<Client["callTool"]>>) {
  if (!("content" in result)) throw new Error("Source MCP returned an unsupported task result");
  const parsed = CallToolResultSchema.parse(result);
  const content = parsed.content?.[0];
  if (parsed.isError || !content || content.type !== "text") throw new Error("Source MCP status call failed");
  const envelope = JSON.parse(content.text);
  assert(envelope.success === true, "Source MCP status call did not succeed");
  return envelope.data;
}
