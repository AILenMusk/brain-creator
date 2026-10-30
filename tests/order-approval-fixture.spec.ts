import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, expect, test } from "@playwright/test";
import type {
  ExecutableCase,
  ExecutionEvidence,
  KnowledgeProject,
  RequirementSuiteRun,
  SystemProfile,
  TestDataLease
} from "../src/domain/types.js";
import { InMemoryBrainCreatorRepository } from "../src/domain/repository.js";
import { KnowledgeService } from "../src/knowledge/service.js";
import { RunLedgerService } from "../src/knowledge/runLedger.js";
import { TestDataProviderService } from "../src/knowledge/testDataProvider.js";
import { handleBrainCreatorTool, type BrainCreatorMcpContext } from "../src/mcp/handlers.js";
import { orderFixtureBrowserExecutablePath } from "./order-fixture-browser.js";
import { createSystemPageObject } from "../src/execution/systemPageObject.js";
import type { SystemPageObjectEvidence } from "../src/execution/systemPageObject.js";
import type { SystemBrainSnapshot } from "../src/brain/types.js";

const fixtureUrl = new URL("./fixtures/order-approval/index.html", import.meta.url);

test("completes a low-value order through role handoff and reuses its entity", async ({ page }) => {
  await page.goto(fixtureUrl.href);
  await page.getByLabel("Amount").fill("500");
  await page.getByRole("button", { name: "Create order" }).click();
  const orderId = await page.locator("#order-id").textContent();
  expect(orderId).toMatch(/^ORD-/);

  await page.getByRole("button", { name: "Submit for approval" }).click();
  await expect(page.locator("#order-status")).toHaveText("manager-review");
  await expect(page.getByRole("button", { name: "Approve" })).toHaveCount(0);

  await page.getByLabel("Current role").selectOption("manager");
  await page.getByRole("button", { name: "Approve" }).click();
  await expect(page.locator("#order-status")).toHaveText("approved");
  await expect(page.locator("#order-id")).toHaveText(orderId!);
  await page.reload();
  await expect(page.locator("#order-id")).toHaveText(orderId!);

  await page.getByLabel("Current role").selectOption("finance");
  await page.getByRole("button", { name: "Close order" }).click();
  await expect(page.locator("#order-status")).toHaveText("closed");
  await expect(page.locator("#order-id")).toHaveText(orderId!);
});

test("executes the approved order fixture path through confirmed System Brain POM bindings", async ({ page }) => {
  const actions: SystemPageObjectEvidence[] = [];
  const pageModelId = "order-approval-page";
  const locatorSpecs: Array<[string, string]> = [
    ["amount", "#amount"],
    ["create-order", "#create-order button[type=submit]"],
    ["order-id", "#order-id"],
    ["submit", "#submit-order"],
    ["role", "#role"],
    ["approve", "#approve-order"],
    ["status", "#order-status"],
    ["close", "#close-order"]
  ];
  const snapshot: SystemBrainSnapshot = {
    id: "order-fixture-snapshot-1",
    knowledgeProjectId: "order-fixture-project",
    systemId: "order-fixture-system",
    revision: 1,
    explorationIds: ["order-fixture-exploration"],
    status: "confirmed",
    assets: [
      { semanticId: "page:/order-approval", kind: "page", label: "Order Approval", content: "{}", contentHash: "page", sourceRefs: ["fixture"], metadata: { pageModelId, route: fixtureUrl.href } },
      ...locatorSpecs.map(([locatorPointId, selector]) => ({
        semanticId: `locator:${locatorPointId}`,
        kind: "locator" as const,
        label: locatorPointId,
        content: "{}",
        contentHash: locatorPointId,
        sourceRefs: [`locator-point:${locatorPointId}`],
        metadata: { pageModelId, locatorPointId, selector }
      }))
    ],
    contentHash: "snapshot-content-hash",
    createdAt: new Date(0).toISOString(),
    confirmedAt: new Date(0).toISOString(),
    confirmedBy: "fixture-review"
  };
  await page.goto(fixtureUrl.href);
  const object = createSystemPageObject(page, snapshot, pageModelId, {
    onAction: (event) => { actions.push(event); }
  });

  await object.control("amount").fill("500");
  await object.control("create-order").click();
  const orderId = await object.control("order-id").textContent();
  expect(orderId).toMatch(/^ORD-/);
  await object.control("submit").click();
  await expect.poll(() => object.control("status").textContent()).toBe("manager-review");
  await object.control("role").selectOption("manager");
  await object.control("approve").click();
  await expect.poll(() => object.control("status").textContent()).toBe("approved");
  expect(await object.control("order-id").textContent()).toBe(orderId);
  await page.reload();
  const resumed = createSystemPageObject(page, snapshot, pageModelId, {
    onAction: (event) => { actions.push(event); }
  });
  expect(await resumed.control("order-id").textContent()).toBe(orderId);
  await resumed.control("role").selectOption("finance");
  await resumed.control("close").click();
  await expect.poll(() => resumed.control("status").textContent()).toBe("closed");
  expect(actions.length).toBeGreaterThan(10);
  expect(actions.every((event) =>
    event.status === "succeeded" &&
    event.pageModelId === pageModelId &&
    event.snapshotId === "order-fixture-snapshot-1"
  )).toBe(true);
});

test("reuses one browser-created order across dependent cases and defers cleanup", async ({ page }) => {
  const workDir = await mkdtemp(join(tmpdir(), "brain-order-cross-case-"));
  try {
    await page.goto(fixtureUrl.href);
    await page.getByLabel("Amount").fill("500");
    await page.getByRole("button", { name: "Create order" }).click();
    const orderId = (await page.locator("#order-id").textContent())!;
    expect(orderId).toMatch(/^ORD-/);
    await page.getByRole("button", { name: "Submit for approval" }).click();
    await expect(page.locator("#order-status")).toHaveText("manager-review");

    const project: KnowledgeProject = {
      id: "fixture-orders-project",
      key: "fixture-orders",
      name: "Order fixture",
      defaultLocale: "en-US",
      status: "active",
      systemIds: ["fixture-orders-system"],
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString()
    };
    const system: SystemProfile = {
      id: "fixture-orders-system",
      name: "Order fixture",
      environment: "test",
      baseUrl: "file://order-approval-fixture",
      defaultLocale: "en-US",
      urlAllowlist: ["file://order-approval-fixture"],
      status: "succeeded",
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString()
    };
    const entityReference = `order:${orderId}`;
    const producerCase: ExecutableCase = {
      id: "case-order-producer",
      knowledgeProjectId: project.id,
      requirementSetId: "requirement-orders",
      testIntentId: "intent-order-submit",
      systemId: system.id,
      title: "Create and submit order",
      status: "ready",
      preconditions: [],
      steps: [],
      dataProfileIds: [],
      gapIds: [],
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString()
    };
    const consumerCase: ExecutableCase = {
      ...producerCase,
      id: "case-order-consumer",
      testIntentId: "intent-order-approve",
      title: "Approve submitted order",
      dataProfileIds: ["profile-order"],
      dataPlan: {
        verdict: "ready",
        reasons: [],
        operations: [{
          profileId: "profile-order",
          field: "Order ID",
          strategy: "existing-reference",
          decision: "reuse",
          status: "ready",
          reference: orderId,
          entityReference,
          dependsOnProfileIds: [],
          cleanup: "none",
          constraints: ["Use the exact order created by the preceding case."],
          sourceRefs: ["requirement:orders/approval"]
        }],
        dependencyOrder: ["profile-order"],
        requiresConfirmation: false,
        requiresCleanup: false,
        entityReferences: [entityReference],
        sourceRefs: ["requirement:orders/approval"]
      },
      caseDependencyGraph: {
        requirementSetId: producerCase.requirementSetId,
        systemId: system.id,
        nodes: [],
        edges: [{
          id: "order-producer-consumer",
          fromTestIntentId: producerCase.testIntentId,
          toTestIntentId: "intent-order-approve",
          entityReference,
          relation: "requires",
          sourceRefs: ["requirement:orders/approval"]
        }],
        dependencyOrder: [producerCase.testIntentId, "intent-order-approve"],
        unresolved: [],
        verdict: "ready",
        sourceRefs: ["requirement:orders/approval"],
        generatedAt: new Date(0).toISOString()
      }
    };
    const runId = "suite-order-cross-case";
    const repository = new InMemoryBrainCreatorRepository();
    repository.knowledgeProjects.push(project);
    repository.systemProfiles.push(system);
    repository.executableCases.push(producerCase, consumerCase);
    repository.requirementSuiteRuns.push({
      id: runId,
      knowledgeProjectId: project.id,
      systemId: system.id,
      status: "running",
      continueOnBlocked: false,
      allowCreateTestData: true,
      total: 2,
      passed: 1,
      failed: 0,
      blocked: 0,
      skipped: 0,
      cancelled: 0,
      caseRuns: [
        { executableCaseId: producerCase.id, title: producerCase.title, order: 1, status: "passed", gapIds: [], attempts: [] },
        { executableCaseId: consumerCase.id, title: consumerCase.title, order: 2, status: "queued", gapIds: [], attempts: [] }
      ],
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date().toISOString()
    } satisfies RequirementSuiteRun);
    const createdAt = new Date(Date.now() - 5000).toISOString();
    const producerLease: TestDataLease = {
      id: "lease-order-created",
      knowledgeProjectId: project.id,
      systemId: system.id,
      executableCaseId: producerCase.id,
      requirementSuiteRunId: runId,
      profileId: "profile-order",
      taskId: "task-order-create",
      decision: "create",
      reference: orderId,
      entityReference,
      cleanup: "delete-created",
      status: "active",
      sourceRefs: ["browser-fixture:order-created"],
      createdAt,
      updatedAt: createdAt
    };
    repository.testDataLeases.push(producerLease);
    repository.executionEvidence.push(syntheticEvidence(producerCase.id, runId, "evidence-order-submitted", createdAt));
    const provider = new TestDataProviderService(
      repository,
      new KnowledgeService(repository, join(workDir, "knowledge")),
      join(workDir, ".brain-creator")
    );

    const earlyCleanup = await provider.prepare({
      knowledgeProjectId: project.id,
      systemId: system.id,
      executableCaseId: producerCase.id,
      requirementSuiteRunId: runId,
      confirm: true,
      phase: "cleanup"
    });
    expect(earlyCleanup).toEqual({ status: "ready", operations: [] });
    expect(producerLease.status).toBe("active");

    const reused = await provider.prepare({
      knowledgeProjectId: project.id,
      systemId: system.id,
      executableCaseId: consumerCase.id,
      requirementSuiteRunId: runId,
      confirm: true
    });
    expect(reused).toEqual({ status: "ready", operations: [] });
    const consumerLease = repository.testDataLeases.find((lease) => lease.executableCaseId === consumerCase.id);
    expect(consumerLease).toEqual(expect.objectContaining({
      decision: "reuse",
      reference: orderId,
      entityReference,
      reusedFromLeaseId: producerLease.id,
      requirementSuiteRunId: runId,
      status: "active"
    }));

    const approvalPage = await page.context().newPage();
    await approvalPage.goto(fixtureUrl.href);
    await expect(approvalPage.locator("#order-id")).toHaveText(orderId);
    await approvalPage.getByLabel("Current role").selectOption("manager");
    await approvalPage.getByRole("button", { name: "Approve" }).click();
    await expect(approvalPage.locator("#order-status")).toHaveText("approved");
    await expect(approvalPage.locator("#order-id")).toHaveText(orderId);

    repository.executionEvidence.push(syntheticEvidence(
      consumerCase.id,
      runId,
      "evidence-order-approved",
      new Date(Date.now() + 1000).toISOString()
    ));
    const consumerCleanup = await provider.prepare({
      knowledgeProjectId: project.id,
      systemId: system.id,
      executableCaseId: consumerCase.id,
      requirementSuiteRunId: runId,
      confirm: true,
      phase: "cleanup"
    });
    expect(consumerCleanup).toEqual(expect.objectContaining({
      status: "needs-agent-execution",
      task: expect.objectContaining({ action: "cleanup", leaseId: producerLease.id })
    }));
    expect(consumerLease?.status).toBe("released");
    expect(consumerCleanup.operations[0]?.entityReference).toBe(entityReference);
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
});

test("requires finance for high-value orders and supports rejection", async ({ page }) => {
  await page.goto(fixtureUrl.href);
  await page.getByLabel("Amount").fill("1500");
  await page.getByRole("button", { name: "Create order" }).click();
  const orderId = await page.locator("#order-id").textContent();
  await page.getByRole("button", { name: "Submit for approval" }).click();

  await page.getByLabel("Current role").selectOption("manager");
  await page.getByRole("button", { name: "Approve" }).click();
  await expect(page.locator("#order-status")).toHaveText("finance-review");
  await expect(page.getByRole("button", { name: "Close order" })).toHaveCount(0);

  await page.getByLabel("Current role").selectOption("finance");
  await page.getByRole("button", { name: "Reject" }).click();
  await expect(page.locator("#order-status")).toHaveText("rejected");
  await expect(page.locator("#order-id")).toHaveText(orderId!);
});

test("routes a high-value order through manager and finance approval before closure", async ({ page }) => {
  await page.goto(fixtureUrl.href);
  await page.getByLabel("Amount").fill("1500");
  await page.getByRole("button", { name: "Create order" }).click();
  const orderId = await page.locator("#order-id").textContent();
  expect(orderId).toMatch(/^ORD-/);

  await page.getByRole("button", { name: "Submit for approval" }).click();
  await expect(page.locator("#order-status")).toHaveText("manager-review");
  await page.getByLabel("Current role").selectOption("manager");
  await page.getByRole("button", { name: "Approve" }).click();
  await expect(page.locator("#order-status")).toHaveText("finance-review");
  await expect(page.getByRole("button", { name: "Close order" })).toHaveCount(0);

  await page.getByLabel("Current role").selectOption("finance");
  await page.getByRole("button", { name: "Approve" }).click();
  await expect(page.locator("#order-status")).toHaveText("approved");
  await page.getByRole("button", { name: "Close order" }).click();
  await expect(page.locator("#order-status")).toHaveText("closed");
  await expect(page.locator("#order-id")).toHaveText(orderId!);
});

test("reconciles a lost response after browser process restart without replaying submit", async () => {
  const userDataDir = await mkdtemp(join(tmpdir(), "brain-order-recovery-"));
  const launchOptions = { headless: true, executablePath: orderFixtureBrowserExecutablePath() };
  let initialContext: Awaited<ReturnType<typeof chromium.launchPersistentContext>> | undefined;
  let recoveredContext: Awaited<ReturnType<typeof chromium.launchPersistentContext>> | undefined;
  let initialContextClosed = false;
  try {
    initialContext = await chromium.launchPersistentContext(userDataDir, launchOptions);
    const page = await initialContext.newPage();
    await page.goto(fixtureUrl.href);
    await page.getByRole("button", { name: "Create order" }).click();
    const orderId = await page.locator("#order-id").textContent();

    const repository = new InMemoryBrainCreatorRepository();
    repository.requirementSuiteRuns.push({
    id: "suite-order-browser-recovery",
    knowledgeProjectId: "fixture-orders",
    systemId: "fixture-orders",
    status: "running",
    currentExecutableCaseId: "case-order-submit",
    continueOnBlocked: false,
    allowCreateTestData: false,
    total: 1,
    passed: 0,
    failed: 0,
    blocked: 0,
    skipped: 0,
    cancelled: 0,
    caseRuns: [{
      executableCaseId: "case-order-submit",
      title: "Submit order",
      order: 1,
      status: "running",
      gapIds: [],
      attempts: []
    }],
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString()
  });
    const context = {
      repository,
      runLedger: new RunLedgerService(repository),
      workDir: userDataDir
    } as unknown as BrainCreatorMcpContext;
    await handleBrainCreatorTool(context, "bc_prepare", {
    action: "record-execution-action",
    requirementSuiteRunId: "suite-order-browser-recovery",
    systemId: "fixture-orders",
    executableCaseId: "case-order-submit",
    actionKey: "order-submit",
    actionPhase: "planned",
    actionSemantic: "Submit order",
    actionStepId: "submit-order",
    actionPostcondition: "Order status is manager-review"
  });

    await page.getByRole("button", { name: "Submit for approval" }).click();
    await expect(page.locator("#order-status")).toHaveText("manager-review");
    await handleBrainCreatorTool(context, "bc_prepare", {
    action: "record-execution-action",
    requirementSuiteRunId: "suite-order-browser-recovery",
    systemId: "fixture-orders",
    executableCaseId: "case-order-submit",
    actionKey: "order-submit",
    actionPhase: "sent",
    actionSemantic: "Submit order",
    actionStepId: "submit-order",
    actionPostcondition: "Order status is manager-review"
  });
    await page.close();
    await initialContext.close();
    initialContextClosed = true;

    recoveredContext = await chromium.launchPersistentContext(userDataDir, launchOptions);
    const recoveredPage = await recoveredContext.newPage();
    await recoveredPage.goto(fixtureUrl.href);
    context.postconditionVerifier = async (input) => {
      const observed = await recoveredPage.locator("#order-status").textContent();
      const observedId = await recoveredPage.locator("#order-id").textContent();
      const expectedStatus = input.postcondition.replace("Order status is ", "");
      const confirmed = observed === expectedStatus && observedId === orderId;
      const actualResult = `Order ${observedId} status is ${observed}`;
      const checkedAt = new Date().toISOString();
      const evidencePath = "postconditions/order-submit.json";
      const contents = JSON.stringify({
        schemaVersion: 2,
        type: "execution-postcondition-observation",
        runType: input.requirementSuiteRunId ? "requirement-suite" : "document-suite",
        runId: input.requirementSuiteRunId ?? input.caseSuiteId,
        evaluationTrialId: input.evaluationTrialId,
        businessScenarioId: input.businessScenarioId,
        executableCaseId: input.executableCaseId,
        caseNo: input.caseNo,
        stepId: input.stepId,
        systemId: input.systemId,
        actionKey: input.actionKey,
        actionSemantic: input.actionSemantic,
        entityReference: input.entityReference,
        postcondition: input.postcondition,
        result: confirmed ? "confirmed" : "not-confirmed",
        actualResult,
        checkedAt
      });
      if (confirmed) {
        await mkdir(join(userDataDir, ".brain-creator", "postconditions"), { recursive: true });
        await writeFile(join(userDataDir, ".brain-creator", evidencePath), contents, "utf8");
      }
      return {
        status: confirmed ? "confirmed" : "not-confirmed",
        actualResult,
        evidenceRefs: [`browser-fixture:${observedId}:status:${observed}`],
        evidenceArtifacts: confirmed ? [{ path: evidencePath, sha256: createHash("sha256").update(contents).digest("hex") }] : undefined,
        checkedAt
      };
    };
    const result = await handleBrainCreatorTool(context, "bc_prepare", {
    action: "reconcile-execution-action",
    responseMode: "full",
    confirm: true,
    autoVerify: true,
    requirementSuiteRunId: "suite-order-browser-recovery",
    systemId: "fixture-orders",
    executableCaseId: "case-order-submit",
    actionKey: "order-submit",
    actionSemantic: "Submit order"
  });
    const payload = JSON.parse((result.content[0] as { text: string }).text) as {
      success: boolean;
      data: { status: string; verification: { status: string } };
    };

    expect(payload).toMatchObject({ success: true, data: { status: "reconciled", verification: { status: "confirmed" } } });
    expect(repository.runLedgerEntries.filter((entry) => entry.actionKey === "order-submit").map((entry) => entry.actionPhase))
      .toEqual(["planned", "sent", "reconciled"]);
    await expect(recoveredPage.locator("#order-id")).toHaveText(orderId!);
    expect(await recoveredPage.locator("#order-status").textContent()).toBe("manager-review");
    expect(await recoveredPage.evaluate(() => JSON.parse(localStorage.getItem("order-approval-fixture.order")!).submissionCount)).toBe(1);
  } finally {
    if (recoveredContext) await recoveredContext.close();
    if (initialContext && !initialContextClosed) await initialContext.close();
    await rm(userDataDir, { recursive: true, force: true });
  }
});

test("keeps the fixture domain-neutral rather than embedding HR-specific rules", async () => {
  const source = await readFile(fileURLToPath(fixtureUrl), "utf8");
  expect(source).not.toMatch(/employee|recruitment|candidate|offer|hiring/i);
});

function syntheticEvidence(
  executableCaseId: string,
  requirementSuiteRunId: string,
  id: string,
  completedAt: string
): ExecutionEvidence {
  return {
    id,
    knowledgeProjectId: "fixture-orders-project",
    systemId: "fixture-orders-system",
    executableCaseId,
    testCaseId: id,
    contextPackPath: "fixture-context.json",
    status: "passed",
    provenance: "synthetic",
    requirementSuiteRunId,
    steps: [],
    tracePaths: [],
    artifactPaths: [],
    consoleErrors: [],
    networkFailures: [],
    createdAt: completedAt,
    completedAt
  };
}
