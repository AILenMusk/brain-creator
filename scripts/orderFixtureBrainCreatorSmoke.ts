import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import type { AddressInfo } from "node:net";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { createConfiguredAgentBridge } from "../src/agent/bridgeProvider.js";
import { spawnCommand } from "../src/agent/orchestrator.js";
import { createBrainCreatorMcpContext, handleBrainCreatorTool } from "../src/mcp/handlers.js";

const projectRoot = process.cwd();
const fixturePath = join(projectRoot, "tests", "fixtures", "order-approval", "index.html");
const fixtureHtml = await readFile(fixturePath, "utf8");
const smokeRoot = join(projectRoot, ".brain-creator-test");
await mkdir(smokeRoot, { recursive: true });
const workspace = await mkdtemp(join(smokeRoot, "order-brain-smoke-"));
const server = createServer((_request, response) => {
  response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  response.end(fixtureHtml);
});

await new Promise<void>((resolve, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", resolve);
});

const address = server.address() as AddressInfo;
const baseUrl = `http://127.0.0.1:${address.port}`;
const sourcePath = join(workspace, "order-approval-cases.md");

try {
  await writeFile(
    join(workspace, "playwright.config.ts"),
    await readFile(join(projectRoot, "playwright.config.ts"), "utf8"),
    "utf8"
  );
  await writeFile(
    sourcePath,
    [
      "| 用例编号 | 用例标题 | 所属模块 | 前置条件 | 操作步骤 | 预期结果 | 优先级 |",
      "| --- | --- | --- | --- | --- | --- | --- |",
      "| TC-ORD-001 | Create and close a low-value order | Order approval | Order Approval is open as requester | Create a 500 order; submit it; switch to manager and approve; switch to finance and close | Order moves through draft, manager-review, approved and closed; the same order ID remains visible | P0 |",
      "| TC-ORD-002 | Create and close a high-value order | Order approval | Order Approval is open as requester | Create a 1500 order; submit it; manager approves; finance approves; close the order | Order moves through draft, manager-review, finance-review, approved and closed; the same order ID remains visible | P0 |"
    ].join("\n"),
    "utf8"
  );

  const context = createBrainCreatorMcpContext({
    dataFilePath: join(workspace, "assets.json"),
    workDir: workspace,
    agentBridge: createConfiguredAgentBridge({
      env: { BRAIN_CREATOR_AGENT_PROVIDER: "host-agent" }
    }),
    runner: (command, args, options) =>
      spawnCommand(command, [...args, "--output", join(workspace, "playwright-results")], {
        ...options,
        env: process.env,
        timeoutMs: 120_000
      })
  });

  const system = dataOf(await handleBrainCreatorTool(context, "bc_configure", {
    target: "system",
    name: "Order Approval Fixture",
    environment: "local",
    baseUrl,
    executionProvenance: "synthetic",
    defaultLocale: "en-US",
    urlAllowlist: [baseUrl]
  }));
  const authStatePath = join(workspace, "auth", "storage-state.json");
  await mkdir(dirname(authStatePath), { recursive: true });
  await writeFile(authStatePath, JSON.stringify({ cookies: [], origins: [] }), "utf8");
  await handleBrainCreatorTool(context, "bc_configure", {
    target: "auth",
    systemId: system.id,
    env: "local",
    role: "qa-agent",
    loginMethod: "script",
    secrets: {
      storageStatePath: relative(workspace, authStatePath).replace(/\\/g, "/")
    }
  });

  const preview = dataOf(await handleBrainCreatorTool(context, "bc_run", {
    mode: "case-source-suite",
    systemId: system.id,
    source: sourcePath,
    confirm: false,
    responseMode: "full"
  }));
  assert(
    preview.status === "preview" && preview.summary.total === 2,
    `Order fixture suite preview was not ready: ${JSON.stringify(preview)}`
  );

  let handoff = dataOf(await handleBrainCreatorTool(context, "bc_run", {
    mode: "case-source-suite",
    systemId: system.id,
    source: sourcePath,
    confirm: true,
    browserMode: "headless",
    maxHealAttempts: 0,
    responseMode: "full"
  }));
  while (handoff.status === "needs_agent_execution") {
    const caseNo = handoff.currentCase?.caseNo;
    assert(["TC-ORD-001", "TC-ORD-002"].includes(caseNo), "Order suite returned an unexpected case handoff");
    await writeGeneratedTest(handoff.testPath, caseNo);
    handoff = dataOf(await handleBrainCreatorTool(context, "bc_submit_agent_output", {
      taskId: handoff.task.id,
      status: "succeeded",
      stdout: "Host agent generated the approved order fixture case.",
      stderr: "",
      outputPaths: [handoff.testPath]
    }));
  }

  assert(
    handoff.status === "completed" && handoff.testResult?.exitCode === 0,
    `Order fixture suite did not complete: ${JSON.stringify({ status: handoff.status, testResult: handoff.testResult })}`
  );
  assert(typeof handoff.reportPath === "string", "Order fixture suite did not return its report path");
  const report = await readFile(handoff.reportPath, "utf8");
  assert(
    report.includes("TC-ORD-001") && report.includes("TC-ORD-002") && report.includes("completed"),
    "Order fixture report is missing a selected case or the completed status"
  );
  const suiteRuns = context.service.listCaseSuiteRuns(system.id);
  const completedCases = suiteRuns
    .flatMap((run) => run.caseResults.map((result) => ({ runStatus: run.status, ...result })))
    .sort((left, right) => left.caseNo.localeCompare(right.caseNo));
  assert(
    suiteRuns.length === 2 && completedCases.length === 2 &&
      completedCases.every((result) => result.runStatus === "completed" && result.status === "passed") &&
      completedCases.map((result) => result.caseNo).join(",") === "TC-ORD-001,TC-ORD-002",
    `Order fixture suite did not persist both cases as passed: ${JSON.stringify(suiteRuns.map((run) => ({ status: run.status, results: run.caseResults })))}`
  );

  console.log("Brain Creator order fixture smoke passed.");
  console.log(`Fixture: ${baseUrl}`);
  console.log(`Case: ${suiteRuns[0]!.caseResults[0]?.caseNo}`);
  console.log(`Report: ${handoff.reportPath}`);
} finally {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await rm(workspace, { recursive: true, force: true });
}

async function writeGeneratedTest(testPath: string, caseNo: "TC-ORD-001" | "TC-ORD-002") {
  const highValue = caseNo === "TC-ORD-002";
  const approvalSteps = highValue
    ? [
        "  await expect(page.locator('#order-status')).toHaveText('manager-review');",
        "  await page.getByLabel('Current role').selectOption('manager');",
        "  await page.getByRole('button', { name: 'Approve' }).click();",
        "  await expect(page.locator('#order-status')).toHaveText('finance-review');",
        "  await page.getByLabel('Current role').selectOption('finance');",
        "  await page.getByRole('button', { name: 'Approve' }).click();"
      ]
    : [
        "  await expect(page.locator('#order-status')).toHaveText('manager-review');",
        "  await page.getByLabel('Current role').selectOption('manager');",
        "  await page.getByRole('button', { name: 'Approve' }).click();"
      ];
  await writeFile(
    testPath,
    [
      'import { test, expect } from "@playwright/test";',
      "",
      `test('complete ${highValue ? "high" : "low"}-value order approval', async ({ page }) => {`,
      `  await page.goto(${JSON.stringify(baseUrl)});`,
      `  await page.getByLabel('Amount').fill('${highValue ? "1500" : "500"}');`,
      "  await page.getByRole('button', { name: 'Create order' }).click();",
      "  const orderId = await page.locator('#order-id').textContent();",
      "  expect(orderId).toMatch(/^ORD-/);",
      "  await page.getByRole('button', { name: 'Submit for approval' }).click();",
      ...approvalSteps,
      "  await expect(page.locator('#order-status')).toHaveText('approved');",
      "  await page.getByLabel('Current role').selectOption('finance');",
      "  await page.getByRole('button', { name: 'Close order' }).click();",
      "  await expect(page.locator('#order-status')).toHaveText('closed');",
      "  await expect(page.locator('#order-id')).toHaveText(orderId!);",
      "});",
      ""
    ].join("\n"),
    "utf8"
  );
}

function dataOf(result: CallToolResult): Record<string, any> {
  const content = result.content?.[0];
  if (!content || content.type !== "text") throw new Error(`Unexpected Brain Creator response: ${JSON.stringify(result)}`);
  const envelope = JSON.parse(content.text);
  if (!envelope.success) throw new Error(`Brain Creator tool failed: ${content.text}`);
  return envelope.data;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
