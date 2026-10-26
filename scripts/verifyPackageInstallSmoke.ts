import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";

const rootDir = process.cwd();
const smokeRoot = await mkdtemp(join(tmpdir(), "brain-package-install-"));
const packageDir = join(smokeRoot, "package");
const businessDir = join(smokeRoot, "business-project");
const sourceDataFile = join(rootDir, ".brain-creator", "local-assets.json");
const sourceSnapshot = await readOptionalFile(sourceDataFile);
const keepArtifacts = process.env.BRAIN_CREATOR_KEEP_LIVE_ARTIFACTS === "1";
const packageVersion = JSON.parse(await readFile(join(rootDir, "package.json"), "utf8")).version;

try {
  await mkdir(packageDir, { recursive: true });
  await mkdir(businessDir, { recursive: true });
  await run("npm", ["pack", "--pack-destination", packageDir], rootDir);
  const tarballName = join(packageDir, await findTarball(packageDir));
  assert(tarballName.endsWith(".tgz"), "npm pack did not create a package tarball");

  await writeFile(join(businessDir, "package.json"), "{\"type\":\"module\"}", "utf8");
  await run(
    "npm",
    ["install", "--no-audit", "--no-fund", "--prefer-offline", tarballName],
    businessDir,
    {},
    300_000
  );

  const binDir = join(businessDir, "node_modules", ".bin");
  const bin = (name: string) =>
    join(binDir, process.platform === "win32" ? `${name}.cmd` : name);
  const version = await run(bin("brain-creator"), ["--version"], businessDir);
  assert(
    version.stdout.trim() === packageVersion,
    `installed brain-creator reported ${version.stdout.trim()} instead of ${packageVersion}`
  );
  const cliHelp = await run(bin("brain-creator"), ["--help"], businessDir);
  assert(
    cliHelp.stdout.includes("brain-creator init") &&
      cliHelp.stdout.includes("brain-creator doctor") &&
      cliHelp.stdout.includes("brain-creator plugin install"),
    "installed Brain Creator CLI help is missing expected commands"
  );
  await run(
    bin("brain-creator"),
    ["init", "--target", businessDir, "--provider", "host-agent"],
    businessDir
  );
  const configInspection = await run(
    bin("brain-creator"),
    ["config", "--target", businessDir, "--json"],
    businessDir
  );
  const configEnvelope = JSON.parse(configInspection.stdout);
  assert(
    configEnvelope.success === true && configEnvelope.command === "config show",
    "installed Brain Creator CLI could not inspect its MCP config"
  );
  await run(
    bin("brain-creator"),
    [
      "config",
      "write",
      "--target",
      businessDir,
      "--global",
      "--provider",
      "codex"
    ],
    businessDir
  );
  const globalInspection = JSON.parse(
    (
      await run(
        bin("brain-creator"),
        ["config", "--target", businessDir, "--json"],
        businessDir
      )
    ).stdout
  );
  assert(
    globalInspection.data.server.command === "brain-creator-mcp" &&
      globalInspection.data.server.env.BRAIN_CREATOR_AGENT_PROVIDER === "codex",
    "installed Brain Creator CLI did not write global Codex configuration"
  );
  await run(
    bin("brain-creator"),
    ["config", "write", "--target", businessDir, "--provider", "host-agent"],
    businessDir
  );
  const codexPluginHelp = await run(
    bin("brain-creator-install-codex-plugin"),
    ["--help"],
    businessDir
  );
  assert(
    codexPluginHelp.stdout.includes("brain-creator-install-codex-plugin") &&
      codexPluginHelp.stdout.includes("--package-root"),
    "installed Codex plugin installer help is missing expected usage text"
  );

  const skill = await readFile(
    join(businessDir, ".claude", "skills", "brain-creator", "SKILL.md"),
    "utf8"
  );
  assert(skill.includes("bc_run_chain"), "installed Brain Creator skill is missing workflow guidance");
  assert(
    (await readFile(join(businessDir, "playwright.config.ts"), "utf8")).includes(
      "PLAYWRIGHT_CHROMIUM_EXECUTABLE"
    ),
    "installed business project is missing the portable Playwright config"
  );
  const mcpConfig = JSON.parse(await readFile(join(businessDir, ".mcp.json"), "utf8"));
  assert(
    mcpConfig.mcpServers?.["brain-creator"]?.command === "npx",
    "installed business project MCP config is missing Brain Creator"
  );
  assert(
    JSON.stringify(mcpConfig.mcpServers?.["brain-creator"]?.args) ===
      JSON.stringify(["--yes", "--package=brain-creator", "brain-creator-mcp"]),
    "installed business project MCP config should use local npx Brain Creator"
  );
  assert(
    mcpConfig.mcpServers?.["brain-creator"]?.env?.BRAIN_CREATOR_TOOL_PROFILE === "facade",
    "installed business project MCP config should default to the facade tool profile"
  );

  const configuredClient = await connectConfiguredMcpClient(businessDir, mcpConfig.mcpServers["brain-creator"]);
  try {
    const configuredStatus = dataOf(await configuredClient.callTool({
      name: "bc_status",
      arguments: { responseMode: "full" }
    }));
    assertRuntimeIdentity(configuredStatus.runtimeIdentity, {
      packageVersion,
      workspace: businessDir,
      provider: "host-agent"
    }, "Generated npx MCP config");
  } finally {
    await configuredClient.close();
  }

  const doctorEnv = {
    BRAIN_CREATOR_WORKSPACE: businessDir,
    BRAIN_CREATOR_TOOL_PROFILE: "facade",
    BRAIN_CREATOR_AGENT_PROVIDER: "host-agent",
    BRAIN_CREATOR_AGENT_TIMEOUT_MS: "120000"
  };
  const doctorHuman = await run(bin("brain-creator-doctor"), [], businessDir, doctorEnv);
  assert(
    doctorHuman.stdout.includes(`Runtime: ${packageVersion}; commit=`) &&
      doctorHuman.stdout.includes("Process: cli; PID=") &&
      doctorHuman.stdout.includes(`Workspace: ${businessDir}`) &&
      doctorHuman.stdout.includes("Agent provider: host-agent"),
    "Installed Brain Creator doctor did not display its runtime identity"
  );
  const doctorJson = JSON.parse(
    (await run(bin("brain-creator"), ["doctor", "--json"], businessDir, doctorEnv)).stdout
  );
  assert(
    doctorJson.success === true && doctorJson.command === "doctor",
    "Installed Brain Creator doctor did not return its JSON report"
  );
  assertRuntimeIdentity(doctorJson.data.runtimeIdentity, {
    packageVersion,
    workspace: businessDir,
    provider: "host-agent",
    processKind: "cli"
  }, "Installed doctor");

  let client = await connectInstalledMcpClient(businessDir);
  try {
    const tools = await client.listTools();
    const facadeTools = [
      "bc_prepare",
      "bc_command",
      "bc_intent_preview",
      "bc_status",
      "bc_run",
      "bc_review",
      "bc_configure",
      "bc_submit_agent_output"
    ];
    for (const name of facadeTools) {
      assert(tools.tools.some((tool) => tool.name === name), `Installed MCP is missing ${name}`);
    }
    assert(tools.tools.length === facadeTools.length, "Installed MCP exposed tools outside the facade profile");
    for (const name of ["bc_intent_preview", "bc_status", "bc_review"]) {
      assert(
        tools.tools.find((tool) => tool.name === name)?.annotations?.readOnlyHint === true,
        `Installed MCP must mark ${name} read-only`
      );
    }
    assert(
      tools.tools.find((tool) => tool.name === "bc_run")?.annotations?.readOnlyHint !== true,
      "Installed MCP must not mark bc_run read-only"
    );

    const help = dataOf(
      await client.callTool({
        name: "bc_command",
        arguments: { command: "/bc help" }
      })
    );
    assert(help.action === "help", "Installed MCP /bc help did not return help");
    const status = dataOf(
      await client.callTool({
        name: "bc_command",
        arguments: { command: "/bc status" }
      })
    );
    assert(
      status.result.status === "no_systems",
      "Installed MCP /bc status did not return system connection guidance"
    );
    const system = dataOf(
      await client.callTool({
        name: "bc_configure",
        arguments: {
          target: "system",
          name: "Installed Recovery Fixture",
          environment: "package-install-smoke",
          baseUrl: "https://package-install-smoke.example.test",
          defaultLocale: "en-US",
          urlAllowlist: ["https://package-install-smoke.example.test"],
          responseMode: "full"
        }
      })
    );
    assert(typeof system.id === "string", `Installed MCP system setup returned no id: ${JSON.stringify(system)}`);
    const runtimeStatus = dataOf(
      await client.callTool({
        name: "bc_status",
        arguments: { responseMode: "full" }
      })
    );
    assertRuntimeIdentity(runtimeStatus.runtimeIdentity, {
      packageVersion,
      workspace: businessDir,
      provider: "host-agent"
    }, "Installed MCP");
    assert(
      runtimeStatus.recoveryCapabilities?.automaticPostconditionVerification === "not-configured",
      "Installed MCP should report automatic postcondition verification as not configured by default"
    );
    assert(
      runtimeStatus.runtimeCapabilities?.testDataProvider === "not-configured",
      "Installed MCP must not report an implicit synthetic Testdata provider as a target adapter"
    );
    const testDataAdapterPath = join(businessDir, "installed-testdata-adapter.mjs");
    await writeFile(testDataAdapterPath, [
      "export const testDataProviders = [{",
      "  name: 'orders-api',",
      "  supports: (input) => input.systemId.startsWith('system_'),",
      "  lookup: async (input) => input.reference ? ({ status: 'found', reference: input.reference, entityReference: input.entityReference, sourceRefs: input.sourceRefs }) : undefined,",
      "  create: async (input) => ({ status: 'created', reference: `${input.systemId}:orders:PKG-1`, entityReference: input.entityReference, values: input.values, sourceRefs: input.sourceRefs }),",
      "  transition: async (input) => ({ status: 'transitioned', reference: input.reference, entityReference: input.entityReference, values: input.values, sourceRefs: input.sourceRefs }),",
      "  verify: async (input) => ({ status: 'verified', reference: input.reference, entityReference: input.entityReference, values: input.expected, sourceRefs: input.sourceRefs }),",
      "  cleanup: async (input) => ({ status: 'cleaned', reference: input.reference, entityReference: input.entityReference, sourceRefs: input.sourceRefs })",
      "}];",
      "export async function verifyNoEffect({ query }) { return { status: 'unavailable', provider: 'orders-api', query, evidenceRefs: [], evidenceArtifacts: [], checkedAt: new Date().toISOString() }; }"
    ].join("\n"), "utf8");
    const testDataCheckScriptPath = join(businessDir, "verify-installed-testdata-adapter.mjs");
    await writeFile(testDataCheckScriptPath, [
      "import { pathToFileURL } from 'node:url';",
      `const handlers = await import(pathToFileURL(${JSON.stringify(join(businessDir, "node_modules", "brain-creator", "dist", "mcp", "handlers.js"))}).href);`,
      "const context = handlers.createBrainCreatorMcpContext({ workDir: process.cwd() });",
      `const input = { systemId: ${JSON.stringify(system.id)}, entityType: 'order', entityReference: 'order', values: { amount: 500 }, sourceRefs: ['requirement:package-install'] };`,
      "const created = await context.testDataBrain.create(input);",
      "const found = await context.testDataBrain.lookup({ ...input, reference: created.reference });",
      "const transitioned = await context.testDataBrain.transition({ ...input, reference: created.reference, transition: 'submit', values: { amount: 500, status: 'submitted' } });",
      "const verified = await context.testDataBrain.verify({ ...input, reference: created.reference, expected: { status: 'submitted' } });",
      "const cleaned = await context.testDataBrain.cleanup({ ...input, reference: created.reference });",
      "const noticeProject = await context.knowledgeService.createProject({ name: 'Cleanup Notice Smoke', key: 'cleanup-notice-smoke', defaultLocale: 'en-US' });",
      "context.knowledgeService.bindSystem(noticeProject.id, input.systemId);",
      "const now = new Date().toISOString();",
      "const noticeCase = { id: 'installed-cleanup-case', knowledgeProjectId: noticeProject.id, requirementSetId: 'installed-cleanup-set', systemId: input.systemId, testIntentId: 'installed-cleanup-intent', title: 'Cleanup notice', status: 'ready', dataPlan: { verdict: 'ready', requiresConfirmation: false, operations: [{ profileId: 'installed-cleanup-profile', field: 'Order', cleanup: 'delete-created', sourceRefs: [] }] }, createdAt: now, updatedAt: now };",
      "context.repository.executableCases.push(noticeCase);",
      "context.repository.testDataLeases.push({ id: 'installed-cleanup-lease', knowledgeProjectId: noticeProject.id, systemId: input.systemId, executableCaseId: noticeCase.id, profileId: 'installed-cleanup-profile', taskId: 'installed-create-task', decision: 'create', reference: 'order:package-install-notice', cleanup: 'delete-created', status: 'active', sourceRefs: ['fixture:create'], createdAt: now, updatedAt: now });",
      "context.repository.executionEvidence.push({ id: 'installed-cleanup-evidence', knowledgeProjectId: noticeProject.id, systemId: input.systemId, executableCaseId: noticeCase.id, testCaseId: 'installed-cleanup-case', contextPackPath: 'context.json', status: 'passed', steps: [], tracePaths: [], artifactPaths: [], consoleErrors: [], networkFailures: [], createdAt: now, completedAt: new Date(Date.now() + 1).toISOString() });",
      "const cleanup = await context.testDataProvider.prepare({ knowledgeProjectId: noticeProject.id, systemId: input.systemId, executableCaseId: noticeCase.id, confirm: true, phase: 'cleanup' });",
      "let blockedBeforeNotice = false; try { context.testDataProvider.markSent(cleanup.task.id); } catch (error) { blockedBeforeNotice = String(error).includes('advance notice'); }",
      "const noticeConfirmationResult = await handlers.handleBrainCreatorTool(context, 'bc_prepare', { action: 'confirm-cleanup-notice', taskId: cleanup.task.id, cleanupNoticeSha256: cleanup.task.cleanupNoticeSha256 });",
      "const noticeConfirmation = JSON.parse(noticeConfirmationResult.content[0].text).data;",
      "const noticeSent = context.testDataProvider.markSent(cleanup.task.id);",
      "const entity = context.repository.businessEntityInstances.find((candidate) => candidate.entityKey === created.reference);",
      "console.log(JSON.stringify({ status: context.testDataProviderStatus, results: [created, found, transitioned, verified, cleaned], lifecycle: entity?.lifecycleEvents, entityStatus: entity?.status, cleanupNoticeGate: { blockedBeforeNotice, acknowledged: Boolean(noticeConfirmation.cleanupNoticeAcknowledgedAt), sent: noticeSent.operationPhase === 'sent', messageIncludesEntity: noticeConfirmation.cleanupNoticeMessage.includes('order:package-install-notice') } }));"
    ].join("\n"), "utf8");
    const testDataCheck = JSON.parse((await runNode(
      [testDataCheckScriptPath],
      businessDir,
      childEnv({
        BRAIN_CREATOR_WORKSPACE: businessDir,
        BRAIN_CREATOR_TESTDATA_ADAPTER_MODULE: "installed-testdata-adapter.mjs"
      })
    )).stdout) as { status?: string; results?: Array<{ status?: string; provider?: string; reference?: string }>; lifecycle?: Array<{ operation?: string; provider?: string }>; entityStatus?: string; cleanupNoticeGate?: { blockedBeforeNotice?: boolean; acknowledged?: boolean; sent?: boolean; messageIncludesEntity?: boolean } };
    assert(
      testDataCheck.status === "configured" &&
        testDataCheck.results?.map((result) => result.status).join(",") === "created,found,transitioned,verified,cleaned" &&
        testDataCheck.results.every((result) => result.provider === "orders-api" && result.reference === `${system.id}:orders:PKG-1`) &&
        testDataCheck.lifecycle?.map((event) => event.provider).join(",") === "orders-api,orders-api,orders-api,orders-api,orders-api" &&
        testDataCheck.entityStatus === "released" &&
        testDataCheck.cleanupNoticeGate?.blockedBeforeNotice === true &&
        testDataCheck.cleanupNoticeGate.acknowledged === true &&
        testDataCheck.cleanupNoticeGate.sent === true &&
        testDataCheck.cleanupNoticeGate.messageIncludesEntity === true,
      `Installed MCP did not dispatch Testdata operations to the configured target adapter: ${JSON.stringify(testDataCheck)}`
    );

    const knowledgeProject = dataOf(
      await client.callTool({
        name: "bc_configure",
        arguments: {
          target: "knowledge-project",
          name: "Installed Requirement",
          key: "installed-requirement",
          defaultLocale: "en-US",
          responseMode: "full"
        }
      })
    );
    assert(
      typeof knowledgeProject.id === "string" && knowledgeProject.id.length > 0,
      `Installed MCP knowledge-project configuration did not return an id: ${JSON.stringify(knowledgeProject)}`
    );
    const requirementPath = join(businessDir, "requirement.md");
    await writeFile(
      requirementPath,
      "# Installed Requirement\n\nUsers create requests and managers approve them.",
      "utf8"
    );
    const prepared = dataOf(
      await client.callTool({
        name: "bc_prepare",
        arguments: {
          action: "ingest-requirement",
          knowledgeProjectId: knowledgeProject.id,
          source: requirementPath,
          responseMode: "full"
        }
      })
    );
    assert(prepared.status === "draft-created", "Installed MCP did not ingest a requirement source");
    assert(
      prepared.requirementSet.status === "draft",
      "Installed MCP did not persist a draft requirement baseline"
    );
    const knowledgeStatus = dataOf(
      await client.callTool({
        name: "bc_status",
        arguments: {
          knowledgeProjectId: knowledgeProject.id,
          responseMode: "full"
        }
      })
    );
    assert(
      knowledgeStatus.knowledge.requirementSets.total === 1,
      "Installed MCP knowledge status did not restore the requirement baseline"
    );

    const caseSourcePath = join(businessDir, "recovery-smoke-cases.md");
    await writeFile(
      caseSourcePath,
      [
        "| 用例编号 | 用例标题 | 所属模块 | 前置条件 | 操作步骤 | 预期结果 | 优先级 |",
        "| --- | --- | --- | --- | --- | --- | --- |",
        "| TC-PKG-001 | Reconcile pending order submit | Orders | Draft order exists | Submit the order | Order status is submitted | P1 |"
      ].join("\n"),
      "utf8"
    );
    const preview = dataOf(
      await client.callTool({
        name: "bc_run",
        arguments: {
          mode: "case-source-suite",
          systemId: system.id,
          source: caseSourcePath,
          confirm: false
        }
      })
    );
    assert(
      preview.status === "preview" && preview.summary.total === 1,
      `Installed MCP could not parse its recovery smoke document: ${JSON.stringify(preview.summary)}`
    );

    await client.close();
    const handlersPath = join(businessDir, "node_modules", "brain-creator", "dist", "mcp", "handlers.js");
    const setupScript = [
      "import { pathToFileURL } from 'node:url';",
      `const handlers = await import(pathToFileURL(${JSON.stringify(handlersPath)}).href);`,
      "const context = handlers.createBrainCreatorMcpContext({ workDir: process.cwd() });",
      `const source = context.service.listCaseSources(${JSON.stringify(system.id)}).at(-1);`,
      "if (!source) throw new Error('Installed smoke case source was not persisted');",
      `const suite = context.service.createCaseSuite({ systemId: ${JSON.stringify(system.id)}, sourceId: source.id, totalCases: 1, selectedCaseNos: ["TC-PKG-001"], status: "running" });`,
      "console.log(JSON.stringify({ id: suite.id }));"
    ].join("\n");
    const setupScriptPath = join(businessDir, "create-recovery-smoke-suite.mjs");
    await writeFile(setupScriptPath, setupScript, "utf8");
    const setup = await runNode(
      [setupScriptPath],
      businessDir,
      childEnv({ BRAIN_CREATOR_WORKSPACE: businessDir })
    );
    const suite = JSON.parse(setup.stdout) as { id: string };

    client = await connectInstalledMcpClient(businessDir);
    const waiting = dataOf(
      await client.callTool({
        name: "bc_prepare",
        arguments: {
          action: "record-execution-action",
          caseSuiteId: suite.id,
          systemId: system.id,
          caseNo: "TC-PKG-001",
          actionKey: "package-install-submit",
          actionSemantic: "Submit order",
          actionPhase: "sent",
          actionPostcondition: "Order status is submitted",
          actionStepId: "submit-order"
        }
      })
    );
    assert(waiting.status === "waiting", "Installed MCP did not persist the sent action");
    await client.close();

    client = await connectInstalledMcpClient(businessDir);
    const restoredStatus = dataOf(
      await client.callTool({
        name: "bc_status",
        arguments: { systemId: system.id, responseMode: "full" }
      })
    );
    const restoredTask = JSON.stringify(restoredStatus.executionTasks ?? []);
    assert(
      restoredTask.includes("package-install-submit") && restoredTask.includes("reconcile-action"),
      "Fresh installed MCP process did not restore the pending action and its reconciliation next step"
    );
    const verifierModulePath = join(businessDir, "installed-postcondition-verifier.mjs");
    await writeFile(verifierModulePath, [
      'import { createHash } from "node:crypto";',
      'import { mkdir, writeFile } from "node:fs/promises";',
      'import { join } from "node:path";',
      "export async function verifyPostcondition(input) {",
      "  const checkedAt = new Date().toISOString();",
      "  const actualResult = `Synthetic installed verifier observed: ${input.postcondition}`;",
      "  const artifactPath = `postconditions/${encodeURIComponent(input.actionKey)}.json`;",
      "  const contents = JSON.stringify({ schemaVersion: 2, type: 'execution-postcondition-observation', runType: input.requirementSuiteRunId ? 'requirement-suite' : 'document-suite', runId: input.requirementSuiteRunId ?? input.caseSuiteId, evaluationTrialId: input.evaluationTrialId, businessScenarioId: input.businessScenarioId, executableCaseId: input.executableCaseId, caseNo: input.caseNo, stepId: input.stepId, systemId: input.systemId, actionKey: input.actionKey, actionSemantic: input.actionSemantic, entityReference: input.entityReference, postcondition: input.postcondition, result: 'confirmed', actualResult, checkedAt });",
      "  await mkdir(join(process.cwd(), '.brain-creator', 'postconditions'), { recursive: true });",
      "  await writeFile(join(process.cwd(), '.brain-creator', artifactPath), contents, 'utf8');",
      "  return { status: 'confirmed', actualResult, checkedAt, evidenceRefs: [`synthetic-installed-verifier:${input.actionKey}`], evidenceArtifacts: [{ path: artifactPath, sha256: createHash('sha256').update(contents).digest('hex') }] };",
      "}"
    ].join("\n"), "utf8");
    await client.close();
    client = await connectInstalledMcpClient(businessDir, {
      BRAIN_CREATOR_POSTCONDITION_VERIFIER_MODULE: "installed-postcondition-verifier.mjs"
    });
    const verifierStatus = dataOf(await client.callTool({
      name: "bc_status",
      arguments: { systemId: system.id, responseMode: "full" }
    }));
    assert(
      verifierStatus.recoveryCapabilities?.automaticPostconditionVerification === "configured",
      "Installed MCP status did not advertise the configured automatic postcondition verifier"
    );
    const autoReconciled = dataOf(await client.callTool({
      name: "bc_prepare",
      arguments: {
        action: "reconcile-execution-action",
        caseSuiteId: suite.id,
        systemId: system.id,
        caseNo: "TC-PKG-001",
        actionKey: "package-install-submit",
        actionSemantic: "Submit order",
        actionPostcondition: "Order status is submitted",
        autoVerify: true,
          responseMode: "full",
        confirm: true
      }
    }));
    assert(
      autoReconciled.status === "reconciled" && autoReconciled.verification?.status === "confirmed",
      `Installed MCP did not load the configured target verifier: ${JSON.stringify(autoReconciled)}`
    );
    const manualWaiting = dataOf(await client.callTool({
      name: "bc_prepare",
      arguments: {
        action: "record-execution-action",
        caseSuiteId: suite.id,
        systemId: system.id,
        caseNo: "TC-PKG-001",
        actionKey: "package-install-manual-submit",
        actionSemantic: "Submit manual recovery fixture",
        actionPhase: "sent",
        actionPostcondition: "Manual fixture is submitted",
        actionStepId: "manual-submit-order"
      }
    }));
    assert(manualWaiting.status === "waiting", "Installed MCP did not persist the manual recovery action");
    await client.close();
    const recoveryEvidencePath = "recovery/postcondition.json";
    const recoveryEvidence = JSON.stringify({
      schemaVersion: 2,
      type: "manual-execution-postcondition-observation",
      runType: "document-suite",
      runId: suite.id,
      caseNo: "TC-PKG-001",
      stepId: "manual-submit-order",
      systemId: system.id,
      actionKey: "package-install-manual-submit",
      actionSemantic: "Submit manual recovery fixture",
      postcondition: "Manual fixture is submitted",
      result: "confirmed",
      actualResult: "Installed recovery smoke observed the submitted status",
      checkedAt: new Date().toISOString(),
      operator: "package-install-smoke"
    });
    const recoveryEvidenceSha256 = createHash("sha256").update(recoveryEvidence).digest("hex");
    await mkdir(join(businessDir, ".brain-creator", "recovery"), { recursive: true });
    await writeFile(join(businessDir, ".brain-creator", recoveryEvidencePath), recoveryEvidence, "utf8");
    client = await connectInstalledMcpClient(businessDir);
    const reconciled = dataOf(
      await client.callTool({
        name: "bc_prepare",
        arguments: {
          action: "reconcile-execution-action",
          caseSuiteId: suite.id,
          systemId: system.id,
          caseNo: "TC-PKG-001",
          actionKey: "package-install-manual-submit",
          actionSemantic: "Submit manual recovery fixture",
          actionPhase: "sent",
          actionPostcondition: "Manual fixture is submitted",
          actionEvidenceRefs: ["smoke:read-only-postcondition-query"],
          actionEvidenceArtifacts: [{
            path: recoveryEvidencePath,
            sha256: recoveryEvidenceSha256
          }],
          operator: "package-install-smoke",
          confirm: true
        }
      })
    );
    assert(reconciled.status === "reconciled", "Installed MCP could not reconcile the persisted action");
    await client.close();

    client = await connectInstalledMcpClient(businessDir);
    const cancelled = dataOf(
      await client.callTool({
        name: "bc_run",
        arguments: {
          mode: "case-source-suite",
          suiteAction: "cancel",
          systemId: system.id,
          suiteId: suite.id,
          responseMode: "full"
        }
      })
    );
    assert(cancelled.status === "cancelled", "Installed MCP did not complete its recovery report suite");
    assert(typeof cancelled.reportPath === "string", "Installed MCP did not return the terminal report path");
    const reportContents = await readFile(cancelled.reportPath, "utf8");
    assert(
      reportContents.includes("package-install-submit") && reportContents.includes("package-install-manual-submit"),
      "Terminal report omitted an automatically or manually reconciled action"
    );
    const autoEvidencePath = ".brain-creator/postconditions/package-install-submit.json";
    assert(reportContents.includes(autoEvidencePath), "Terminal report omitted the configured verifier artifact");
    assert(reportContents.includes(recoveryEvidencePath), "Terminal report omitted the recovery artifact link");
    assert(reportContents.includes(recoveryEvidenceSha256), "Terminal report omitted the recovery artifact hash");
    const artifactManifest = JSON.parse(
      await readFile(join(dirname(dirname(cancelled.reportPath)), "manifest.json"), "utf8")
    ) as { artifacts?: Array<{ path?: string; status?: string; sha256?: string }> };
    const archivedRecoveryEvidence = artifactManifest.artifacts?.find(
      (artifact) => artifact.path === ".brain-creator/recovery/postcondition.json"
    );
    assert(
      archivedRecoveryEvidence?.status === "present" &&
        archivedRecoveryEvidence.sha256 === recoveryEvidenceSha256,
      "Artifact manifest omitted the validated recovery evidence or its matching hash"
    );
    const archivedAutoEvidence = artifactManifest.artifacts?.find(
      (artifact) => artifact.path === autoEvidencePath
    );
    assert(
      archivedAutoEvidence?.status === "present" && /^[a-f0-9]{64}$/i.test(archivedAutoEvidence.sha256 ?? ""),
      "Artifact manifest omitted the installed target verifier observation or its hash"
    );
    const terminalReport = await readFile(cancelled.reportPath, "utf8");
    assert(
      terminalReport.includes("TC-PKG-001") && terminalReport.includes("cancelled"),
      "Installed MCP recovery report is missing its selected case or terminal state"
    );
  } finally {
    await client.close();
  }

  assert(
    (await readOptionalFile(sourceDataFile)) === sourceSnapshot,
    "Source repository Brain Creator assets changed during package install smoke"
  );

  console.log("Package install smoke passed.");
  console.log(`Business project: ${businessDir}`);
  console.log(`Package: ${tarballName}`);
} finally {
  if (!keepArtifacts) {
    await removeSmokeRoot(smokeRoot);
  }
}

async function removeSmokeRoot(path: string) {
  for (let attempt = 1; attempt <= 10; attempt += 1) {
    try {
      await rm(path, { recursive: true, force: true });
      return;
    } catch (error) {
      const code =
        error && typeof error === "object" && "code" in error
          ? String(error.code)
          : "";
      if (!["EBUSY", "EPERM", "ENOTEMPTY"].includes(code) || attempt === 10) throw error;
      await new Promise((resolveDelay) => setTimeout(resolveDelay, attempt * 250));
    }
  }
}

async function run(
  command: string,
  args: string[],
  cwd: string,
  env: Record<string, string> = {},
  timeoutMs = 120_000
) {
  return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: { ...process.env, ...env },
      shell: process.platform === "win32"
    });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error(`Command timed out: ${command} ${args.join(" ")}`));
    }, timeoutMs);
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (exitCode) => {
      clearTimeout(timeout);
      if (exitCode === 0) {
        resolve({ stdout, stderr });
        return;
      }
      reject(
        new Error(
          [
            `Command failed: ${command} ${args.join(" ")}`,
            `cwd: ${cwd}`,
            `stdout:\n${stdout}`,
            `stderr:\n${stderr}`
          ].join("\n")
        )
      );
    });
  });
}

async function runNode(args: string[], cwd: string, env: Record<string, string>) {
  return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(process.execPath, args, { cwd, env, shell: false });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error(`Command timed out: ${process.execPath} ${args.join(" ")}`));
    }, 120_000);
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", reject);
    child.on("close", (exitCode) => {
      clearTimeout(timeout);
      if (exitCode === 0) {
        resolve({ stdout, stderr });
        return;
      }
      reject(new Error([
        `Command failed: ${process.execPath} ${args.join(" ")}`,
        `cwd: ${cwd}`,
        `stdout:\n${stdout}`,
        `stderr:\n${stderr}`
      ].join("\n")));
    });
  });
}

async function connectInstalledMcpClient(businessDir: string, extraEnv: Record<string, string> = {}) {
  const client = new Client({ name: "brain-creator-package-smoke", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [
      join(businessDir, "node_modules", "brain-creator", "dist", "cli", "brainCreator.js"),
      "mcp"
    ],
    cwd: businessDir,
    env: childEnv({
      BRAIN_CREATOR_WORKSPACE: businessDir,
      BRAIN_CREATOR_TOOL_PROFILE: "facade",
      BRAIN_CREATOR_AGENT_PROVIDER: "host-agent",
      BRAIN_CREATOR_AGENT_TIMEOUT_MS: "120000",
      ...extraEnv
    }),
    stderr: "pipe"
  });
  await client.connect(transport);
  return client;
}

async function connectConfiguredMcpClient(
  businessDir: string,
  server: { command: string; args: string[]; env: Record<string, string> }
) {
  const client = new Client({ name: "brain-creator-configured-mcp-smoke", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: server.command,
    args: server.args,
    cwd: businessDir,
    env: childEnv(server.env),
    stderr: "pipe"
  });
  await client.connect(transport);
  return client;
}

async function readOptionalFile(path: string) {
  return readFile(path, "utf8").catch(() => "");
}

async function findTarball(dir: string) {
  const tarball = (await readdir(dir)).find((file) => file.endsWith(".tgz"));
  assert(tarball, "npm pack did not create a package tarball");
  return tarball;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function assertRuntimeIdentity(
  value: unknown,
  expected: { packageVersion: string; workspace: string; provider: string; processKind?: "mcp" | "cli" },
  label: string
) {
  assert(value !== null && typeof value === "object", `${label} returned no runtime identity`);
  const identity = value as Record<string, unknown>;
  assert(identity.packageVersion === expected.packageVersion, `${label} reported the wrong package version`);
  assert(
    identity.commit === "unknown" || (typeof identity.commit === "string" && /^[a-f0-9]{40,64}$/.test(identity.commit)),
    `${label} did not report a valid build commit or explicit unknown`
  );
  assert(typeof identity.buildId === "string" && identity.buildId.length > 0, `${label} reported no build ID`);
  assert(typeof identity.builtAt === "string" && identity.builtAt.length > 0, `${label} reported no build time`);
  assert(typeof identity.dirty === "boolean" || identity.dirty === "unknown", `${label} reported no dirty-state value`);
  assert(Number.isInteger(identity.pid) && Number(identity.pid) > 0, `${label} reported no process ID`);
  assert(typeof identity.startedAt === "string" && Number.isFinite(Date.parse(identity.startedAt)), `${label} reported no start time`);
  assert(typeof identity.workspace === "string" && resolve(identity.workspace) === resolve(expected.workspace), `${label} reported the wrong workspace`);
  assert(Number.isInteger(identity.schemaVersion) && Number(identity.schemaVersion) > 0, `${label} reported no Store schema version`);
  assert(identity.provider === expected.provider, `${label} reported the wrong Provider`);
  assert(identity.processKind === (expected.processKind ?? "mcp"), `${label} reported the wrong process kind`);
}

function childEnv(overrides: Record<string, string>) {
  return {
    ...Object.fromEntries(
      Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined)
    ),
    ...overrides
  };
}

function dataOf(result: Awaited<ReturnType<Client["callTool"]>>): any {
  if (!("content" in result)) {
    throw new Error(`Installed MCP returned an unsupported task result: ${JSON.stringify(result)}`);
  }
  const parsed = CallToolResultSchema.parse(result);
  const content = parsed.content?.[0];
  if (parsed.isError || !content || content.type !== "text") {
    throw new Error(`Installed MCP call failed: ${JSON.stringify(result)}`);
  }
  const envelope = JSON.parse(content.text);
  if (!envelope.success) {
    throw new Error(`Installed MCP call failed: ${content.text}`);
  }
  return envelope.data;
}
