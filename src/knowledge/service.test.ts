// @vitest-environment node

import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { InMemoryBrainCreatorRepository, JsonFileBrainCreatorRepository } from "../domain/repository.js";
import type { RequirementContentPackage, StateMachineModel, TestDataProfile } from "../domain/types.js";
import { createWorkspaceIntegrityAuthenticator, encryptSecrets } from "../shared/crypto.js";
import { SemanticSpineService } from "../brain/semanticSpine.js";
import { hasValidExecutionEvidenceSnapshot } from "../execution/evidenceSnapshot.js";
import { KnowledgeService } from "./service.js";
import { RequirementSuiteRunService } from "./requirementSuiteRun.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("KnowledgeService", () => {
  it("resumes state-action exploration with the explicitly selected confirmed path", async () => {
    const repository = new InMemoryBrainCreatorRepository();
    const service = new KnowledgeService(repository, await tempDir());
    const project = await service.createProject({ name: "State path", key: "state-path", defaultLocale: "en-US" });
    const system = {
      id: "system-state-path",
      name: "Orders",
      environment: "test",
      baseUrl: "https://orders.example.test",
      defaultLocale: "en-US",
      urlAllowlist: ["https://orders.example.test"],
      status: "succeeded" as const,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    repository.systemProfiles.push(system);
    service.bindSystem(project.id, system.id);
    const ingested = await service.ingestRequirement({
      projectId: project.id,
      contentPackage: requirementPackage("state-path", "Orders can be submitted and approved.")
    });
    const design = await service.generateTestDesign(ingested.requirementSet.id);
    service.approveRequirementSet(ingested.requirementSet.id);
    const intent = design.testIntents[0];
    intent.preconditions = ["Order state is Draft"];
    intent.expectedResults = ["Order state is Approved"];
    intent.processModelRefs = ["order-state-path"];
    intent.updatedAt = new Date().toISOString();
    const now = new Date().toISOString();
    const model: StateMachineModel = {
      id: "order-state-path",
      knowledgeProjectId: project.id,
      requirementSetId: ingested.requirementSet.id,
      title: "Order approval paths",
      states: [
        { id: "draft", label: "Draft", initial: true, terminal: false, sourceRefs: ["requirement:state-path"] },
        { id: "submitted", label: "Submitted", initial: false, terminal: false, sourceRefs: ["requirement:state-path"] },
        { id: "review", label: "In review", initial: false, terminal: false, sourceRefs: ["requirement:state-path"] },
        { id: "approved", label: "Approved", initial: false, terminal: true, sourceRefs: ["requirement:state-path"] }
      ],
      transitions: [
        { id: "submit", from: "draft", to: "submitted", trigger: "submit order", validity: "legal", sourceRefs: ["requirement:state-path"] },
        { id: "send-review", from: "draft", to: "review", trigger: "request review", validity: "legal", sourceRefs: ["requirement:state-path"] },
        { id: "approve-submitted", from: "submitted", to: "approved", trigger: "approve order", validity: "legal", sourceRefs: ["requirement:state-path"] },
        { id: "approve-review", from: "review", to: "approved", trigger: "approve reviewed order", validity: "legal", sourceRefs: ["requirement:state-path"] }
      ],
      sourceRefs: ["requirement:state-path"],
      confidence: 1,
      status: "confirmed",
      createdAt: now,
      updatedAt: now
    };
    repository.stateMachineModels.push(model);

    const ambiguous = service.compileExecutableCases(intent.id, system.id).executableCase;
    expect(ambiguous.status).toBe("ambiguous");
    const exploration = repository.explorationTasks.find((task) => task.kind === "state-action" && task.status === "pending");
    expect(exploration).toBeDefined();
    const selectedTransitionRefs = [
      "state-machine:order-state-path#transition:submit",
      "state-machine:order-state-path#transition:approve-submitted"
    ];

    expect(() => service.resolveExplorationTask({
      taskId: exploration!.id,
      outcome: "resolved",
      evidenceRefs: ["requirement:state-path"],
      selectedTransitionRefs: ["state-machine:foreign#transition:submit"]
    })).toThrow("Selected transitions are outside the exploration scope");
    expect(exploration!.status).toBe("pending");

    const resolved = service.resolveExplorationTask({
      taskId: exploration!.id,
      outcome: "resolved",
      evidenceRefs: ["requirement:state-path"],
      selectedTransitionRefs
    });

    expect(exploration!.selectedTransitionRefs).toEqual(selectedTransitionRefs);
    expect(intent.selectedTransitionRefs).toEqual(selectedTransitionRefs);
    expect(resolved.resumed?.executableCase.compilationStages?.find((stage) => stage.stage === "requirement-path")?.verdict).toBe("ready");
    expect(selectedTransitionRefs.every((reference) =>
      resolved.resumed?.executableCase.steps.some((step) => step.sourceRefs.includes(reference))
    )).toBe(true);
    expect(repository.explorationTasks.some((task) => task.kind === "state-action" && task.status === "pending")).toBe(false);
  });

  it("creates a knowledge project before a runtime system is bound", async () => {
    const knowledgeDir = await tempDir();
    const service = new KnowledgeService(new InMemoryBrainCreatorRepository(), knowledgeDir);

    const project = await service.createProject({
      name: "Order Approval",
      key: "order-approval",
      defaultLocale: "en-US"
    });

    expect(project.systemIds).toEqual([]);
    expect(await readFile(join(knowledgeDir, "order-approval", "MOC.md"), "utf8")).toContain(
      "# Order Approval"
    );
  });

  it("creates a new requirement revision only when the content hash changes", async () => {
    const service = new KnowledgeService(new InMemoryBrainCreatorRepository(), await tempDir());
    const project = await service.createProject({
      name: "Orders",
      key: "orders",
      defaultLocale: "zh-CN"
    });
    const first = await service.ingestRequirement({
      projectId: project.id,
      contentPackage: requirementPackage("hash-1", "订单金额超过 1000 元需要经理审批。")
    });
    const same = await service.ingestRequirement({
      projectId: project.id,
      contentPackage: requirementPackage("hash-1", "订单金额超过 1000 元需要经理审批。")
    });
    const changed = await service.ingestRequirement({
      projectId: project.id,
      contentPackage: requirementPackage("hash-2", "订单金额超过 2000 元需要经理审批。")
    });

    expect(first.changed).toBe(true);
    expect(same.changed).toBe(false);
    expect(same.requirementSet.id).toBe(first.requirementSet.id);
    expect(changed.requirementSet.version).toBe(2);
    expect(changed.previousRequirementSetId).toBe(first.requirementSet.id);
  });

  it("indexes requirement actions for later System Brain binding", async () => {
    const repository = new InMemoryBrainCreatorRepository();
    const knowledgeDir = await tempDir();
    const spine = new SemanticSpineService(repository);
    const service = new KnowledgeService(
      repository,
      knowledgeDir,
      process.cwd(),
      undefined,
      spine
    );
    const project = await service.createProject({
      name: "Recruitment",
      key: "requirement-semantic-actions",
      defaultLocale: "zh-CN"
    });
    const ingested = await service.ingestRequirement({
      projectId: project.id,
      contentPackage: requirementPackage(
        "semantic-actions",
        "用户新增招聘需求后提交审批。"
      )
    });

    await service.generateTestDesign(ingested.requirementSet.id);

    expect(repository.semanticConcepts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: "action",
        canonicalName: "create",
        requirementSetId: ingested.requirementSet.id,
        aliases: expect.arrayContaining(["新增"])
      }),
      expect.objectContaining({
        kind: "action",
        canonicalName: "submit",
        requirementSetId: ingested.requirementSet.id,
        aliases: expect.arrayContaining(["提交"])
      })
    ]));
  });

  it("keeps parser warnings visible without creating a Gap before attachment processing is attempted", async () => {
    const repository = new InMemoryBrainCreatorRepository();
    const service = new KnowledgeService(repository, await tempDir());
    const project = await service.createProject({ name: "Wiki", key: "wiki-warnings", defaultLocale: "en-US" });
    const contentPackage = requirementPackage("wiki-warning", "Users approve requests.");
    contentPackage.warnings = ["Feishu table block requires separate extraction"];

    const result = await service.ingestRequirement({ projectId: project.id, contentPackage });

    expect(result.gaps).toEqual([]);
    expect(result.source.warnings).toEqual(["Feishu table block requires separate extraction"]);
    expect(repository.gaps).toEqual([]);
  });

  it("blocks requirement baseline approval while source extraction warnings remain", async () => {
    const repository = new InMemoryBrainCreatorRepository();
    const service = new KnowledgeService(repository, await tempDir());
    const project = await service.createProject({ name: "Wiki", key: "wiki-source-closure", defaultLocale: "en-US" });
    const incompletePackage = requirementPackage("wiki-source-v1", "Employees submit hiring requests.");
    incompletePackage.source = "https://tenant.larkenterprise.com/wiki/hiring";
    incompletePackage.sourceType = "feishu";
    incompletePackage.warnings = ["Feishu sheet block fields-1 requires separate extraction"];
    const incomplete = await service.ingestRequirement({ projectId: project.id, contentPackage: incompletePackage });

    await service.generateTestDesign(incomplete.requirementSet.id);

    expect(() => service.approveRequirementSet(incomplete.requirementSet.id)).toThrow(
      "Requirement source has unresolved extraction warnings"
    );

    const completePackage: RequirementContentPackage = {
      ...incompletePackage,
      contentHash: "wiki-source-v2-complete",
      blocks: [
        {
          type: "paragraph",
          text: "Employees submit hiring requests.",
          sourceRef: "https://tenant.larkenterprise.com/wiki/hiring#revision:12"
        },
        {
          type: "table",
          text: "",
          table: { headers: ["Field", "Required"], rows: [["Position", "Yes"]] },
          sourceRef: "https://tenant.larkenterprise.com/wiki/hiring#sheet:fields-1:revision:4"
        }
      ],
      warnings: []
    };
    const complete = await service.ingestRequirement({ projectId: project.id, contentPackage: completePackage });
    await service.generateTestDesign(complete.requirementSet.id);

    expect(service.approveRequirementSet(complete.requirementSet.id).status).toBe("approved");
  });

  it("does not trust host-provided attachment lifecycle state", async () => {
    const repository = new InMemoryBrainCreatorRepository();
    const service = new KnowledgeService(repository, await tempDir());
    const project = await service.createProject({ name: "Host", key: "host-attachment", defaultLocale: "en-US" });
    const contentPackage = requirementPackage("host-attachment", "Users approve requests.");
    contentPackage.attachments = [{
      id: "untrusted-id",
      sourceId: "untrusted-source",
      name: "flow.png",
      status: "confirmed",
      localPath: "C:\\untrusted\\flow.png",
      analysisId: "untrusted-analysis",
      attempts: 99
    }];

    const result = await service.ingestRequirement({ projectId: project.id, contentPackage });

    expect(result.source.attachments[0]).toEqual(
      expect.objectContaining({
        id: expect.not.stringMatching(/^untrusted/),
        sourceId: result.source.id,
        status: "discovered",
        attempts: 0,
        localPath: undefined,
        analysisId: undefined
      })
    );
  });

  it("restores knowledge assets from the versioned JSON repository", async () => {
    const root = await tempDir();
    const filePath = join(root, "assets.json");
    const first = new KnowledgeService(new JsonFileBrainCreatorRepository(filePath), join(root, "knowledge"));
    const project = await first.createProject({ name: "CRM", key: "crm", defaultLocale: "zh-CN" });
    await first.ingestRequirement({
      projectId: project.id,
      contentPackage: requirementPackage("crm-hash", "销售线索可以转为商机。")
    });

    const second = new KnowledgeService(
      new JsonFileBrainCreatorRepository(filePath),
      join(root, "knowledge")
    );

    expect(second.listProjects()).toEqual([expect.objectContaining({ id: project.id, key: "crm" })]);
    expect(second.listRequirementSets(project.id)).toHaveLength(1);
  });

  it("requires approval before compiling executable cases", async () => {
    const service = new KnowledgeService(new InMemoryBrainCreatorRepository(), await tempDir());
    const project = await service.createProject({ name: "Recruiting", key: "recruiting", defaultLocale: "zh-CN" });
    const ingested = await service.ingestRequirement({
      projectId: project.id,
      contentPackage: requirementPackage(
        "recruiting-hash",
        "用户进入招聘需求列表，新建招聘需求并填写表单。需求类型选择离职替补后显示替补人员字段。"
      )
    });
    const design = await service.generateTestDesign(ingested.requirementSet.id);

    expect(design.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ relation: "contains", sourceRefs: expect.any(Array) }),
        expect.objectContaining({ relation: "covers", sourceRefs: expect.any(Array) })
      ])
    );

    expect(() => service.compileExecutableCases(design.testIntents[0].id)).toThrow(
      "Requirement baseline must be approved"
    );

    await service.confirmEvaluationActions({
      requirementSetId: ingested.requirementSet.id,
      actionIds: design.evaluationGate.actions.map((action) => action.id),
      note: "When the replacement type is not selected, the replacement employee field stays hidden.",
      confirm: true
    });
    service.approveRequirementSet(ingested.requirementSet.id);
    const compiled = service.compileExecutableCases(design.testIntents[0].id);

    expect(compiled.executableCase.steps.map((step) => step.action)).toEqual(
      expect.arrayContaining(["navigate", "click", "fill", "assert"])
    );
    expect(compiled.executableCase.steps.every((step) => step.sourceRefs.length > 0)).toBe(true);
  });

  it("batch compiles an approved requirement idempotently and records a bounded compile run", async () => {
    const repository = new InMemoryBrainCreatorRepository();
    const service = new KnowledgeService(repository, await tempDir());
    const project = await service.createProject({
      name: "Order Lifecycle",
      key: "order-lifecycle-batch",
      defaultLocale: "en-US"
    });
    const ingested = await service.ingestRequirement({
      projectId: project.id,
      contentPackage: requirementPackage(
        "order-batch-hash",
        "Buyer creates an order. Manager approves an order. Finance rejects an order."
      )
    });
    const design = await service.generateTestDesign(ingested.requirementSet.id);
    if (design.evaluationGate.actions.length > 0) {
      await service.confirmEvaluationActions({
        requirementSetId: ingested.requirementSet.id,
        actionIds: design.evaluationGate.actions.map((action) => action.id),
        note: "The listed order lifecycle branches are confirmed.",
        confirm: true
      });
    }
    service.approveRequirementSet(ingested.requirementSet.id);

    const first = service.compileExecutableCasesBatch({
      requirementSetId: ingested.requirementSet.id
    });
    const second = service.compileExecutableCasesBatch({
      requirementSetId: ingested.requirementSet.id
    });

    expect(first.compileRun.total).toBe(design.testIntents.length);
    expect(first.compileRun.items).toHaveLength(design.testIntents.length);
    expect(first.compileRun.items.every((item) => item.result !== "reused")).toBe(true);
    expect(second.compileRun.items.every((item) => item.result === "reused")).toBe(true);
    expect(repository.executableCases).toHaveLength(design.testIntents.length);
    expect(repository.compileRuns).toHaveLength(2);
  });

  it("persists explicit cross-case entity dependencies and oracle contracts", async () => {
    const repository = new InMemoryBrainCreatorRepository();
    const service = new KnowledgeService(repository, await tempDir());
    const project = await service.createProject({
      name: "Employee lifecycle",
      key: "employee-lifecycle-dependencies",
      defaultLocale: "en-US"
    });
    const ingested = await service.ingestRequirement({
      projectId: project.id,
      contentPackage: requirementPackage(
        "employee-dependency-hash",
        "Create an employee. Edit the employee created by the previous case."
      )
    });
    const design = await service.generateTestDesign(ingested.requirementSet.id);
    const [producer, consumer] = design.testIntents;
    expect(consumer).toBeDefined();
    producer.producesEntityRefs = ["employee:testperson001"];
    consumer.consumesEntityRefs = ["employee:testperson001"];
    const profile: TestDataProfile = {
      id: "data-employee-reference",
      knowledgeProjectId: project.id,
      requirementSetId: ingested.requirementSet.id,
      name: "Employee entity",
      field: "Employee",
      strategy: "existing-reference",
      constraints: ["status=active"],
      seed: "employee:testperson001",
      entityReference: "employee:testperson001",
      sourceRefs: producer.requirementRefs,
      createdAt: new Date(0).toISOString()
    };
    repository.testDataProfiles.push(profile);
    if (design.evaluationGate.actions.length > 0) {
      await service.confirmEvaluationActions({
        requirementSetId: ingested.requirementSet.id,
        actionIds: design.evaluationGate.actions.map((action) => action.id),
        note: "The employee lifecycle cases are confirmed for compilation.",
        confirm: true
      });
    }
    service.approveRequirementSet(ingested.requirementSet.id);

    const compiled = service.compileExecutableCases(consumer.id);

    expect(compiled.executableCase.caseDependencyGraph).toEqual(expect.objectContaining({
      verdict: "ready",
      edges: [expect.objectContaining({
        fromTestIntentId: producer.id,
        toTestIntentId: consumer.id,
        entityReference: "employee:testperson001"
      })]
    }));
    expect(compiled.executableCase.dataPlan?.entityReferences).toEqual([
      "employee:testperson001"
    ]);
    expect(compiled.executableCase.dataPlan?.operations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          profileId: "entity:employee%3Atestperson001",
          decision: "reuse",
          status: "ready",
          entityReference: "employee:testperson001",
          cleanup: "none"
        })
      ])
    );
    expect(compiled.executableCase.assertionContracts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          requirementRefs: expect.arrayContaining(consumer.requirementRefs),
          evidenceRequirements: expect.arrayContaining(["actual-value", "screenshot", "trace"])
        })
      ])
    );
  });

  it("rejects an explicit batch selection that crosses requirement sets", async () => {
    const repository = new InMemoryBrainCreatorRepository();
    const service = new KnowledgeService(repository, await tempDir());
    const project = await service.createProject({
      name: "Order Revisions",
      key: "order-revisions-batch",
      defaultLocale: "en-US"
    });
    const first = await service.ingestRequirement({
      projectId: project.id,
      contentPackage: requirementPackage("order-revision-1", "Buyer creates an order.")
    });
    const second = await service.ingestRequirement({
      projectId: project.id,
      contentPackage: requirementPackage("order-revision-2", "Manager approves an order.")
    });
    const firstDesign = await service.generateTestDesign(first.requirementSet.id);
    const secondDesign = await service.generateTestDesign(second.requirementSet.id);

    expect(() =>
      service.compileExecutableCasesBatch({
        requirementSetId: first.requirementSet.id,
        testIntentIds: [firstDesign.testIntents[0].id, secondDesign.testIntents[0].id]
      })
    ).toThrow(/does not belong to RequirementSet/);
  });

  it("persists an explicit page binding decision for ambiguous compilation", async () => {
    const root = await tempDir();
    const filePath = join(root, "assets.json");
    const repository = new JsonFileBrainCreatorRepository(filePath);
    const service = new KnowledgeService(repository, join(root, "knowledge"));
    const project = await service.createProject({
      name: "Page Binding",
      key: "page-binding",
      defaultLocale: "en-US"
    });
    repository.systemProfiles.push({
      id: "system-binding-1",
      name: "Orders",
      environment: "test",
      baseUrl: "https://orders.example.test",
      defaultLocale: "en-US",
      urlAllowlist: ["https://orders.example.test"],
      status: "succeeded",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    service.bindSystem(project.id, "system-binding-1");
    const ingested = await service.ingestRequirement({
      projectId: project.id,
      contentPackage: requirementPackage("binding-hash", "User creates an order.")
    });
    const design = await service.generateTestDesign(ingested.requirementSet.id);
    repository.pageModels.push({
      id: "page-binding-1",
      projectId: "system-binding-1",
      route: "/orders/new",
      name: "Create order",
      version: 1,
      domSnapshotId: "dom-1",
      screenshotId: "shot-1",
      status: "succeeded",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    const decision = service.confirmPageBinding({
      testIntentId: design.testIntents[0].id,
      systemId: "system-binding-1",
      pageModelId: "page-binding-1",
      role: "buyer",
      note: "Confirmed from the order creation workflow."
    });

    expect(decision).toEqual(
      expect.objectContaining({
        testIntentId: design.testIntents[0].id,
        pageModelId: "page-binding-1",
        role: "buyer"
      })
    );
    expect(repository.pageBindingDecisions).toHaveLength(1);
    expect(
      service.confirmPageBinding({
        testIntentId: design.testIntents[0].id,
        systemId: "system-binding-1",
        pageModelId: "page-binding-1",
        role: "buyer",
        note: "Confirmed from the order creation workflow."
      }).id
    ).toBe(decision.id);
    expect(repository.pageBindingDecisions).toHaveLength(1);
    expect(new JsonFileBrainCreatorRepository(filePath).pageBindingDecisions).toEqual([
      expect.objectContaining({ id: decision.id, pageModelId: "page-binding-1" })
    ]);
  });

  it("persists atomic test intents and a traceable requirement evaluation report", async () => {
    const knowledgeDir = await tempDir();
    const service = new KnowledgeService(new InMemoryBrainCreatorRepository(), knowledgeDir);
    const project = await service.createProject({
      name: "Order Approval",
      key: "order-coverage",
      defaultLocale: "en-US"
    });
    const ingested = await service.ingestRequirement({
      projectId: project.id,
      contentPackage: requirementPackage(
        "order-coverage-v1",
        "Buyer creates an order. Orders above 1000 require manager approval. Status changes from draft to approved. Finance users may reject the order."
      )
    });

    const design = await service.generateTestDesign(ingested.requirementSet.id);
    const report = await readFile(
      join(knowledgeDir, "order-coverage", "requirements", ingested.requirementSet.id, "analysis.md"),
      "utf8"
    );
    const testIntentReport = await readFile(
      join(knowledgeDir, "order-coverage", "requirements", ingested.requirementSet.id, "test-intents.md"),
      "utf8"
    );
    const projectIndex = await readFile(
      join(knowledgeDir, "order-coverage", "MOC.md"),
      "utf8"
    );
    const evidenceIndex = await readFile(
      join(knowledgeDir, "order-coverage", "requirements", ingested.requirementSet.id, "evidence-index.md"),
      "utf8"
    );

    expect(design.testIntents).toHaveLength(4);
    expect(design.evaluation.coverage).toEqual(
      expect.objectContaining({ totalClauses: 4, coveredClauses: 4, coverageRate: 1 })
    );
    expect(report).toContain("## 三、需求条款");
    expect(report).toContain("## 六、业务场景分析");
    expect(report).not.toContain("## Requirement Clauses");
    expect(report).not.toContain("module=");
    expect(testIntentReport).toContain("：测试意图");
    expect(testIntentReport).toContain("验证目标");
    expect(testIntentReport).toContain("预期结果");
    expect(projectIndex).toContain("test-intents");
    expect(projectIndex).toContain("evidence-index");
    expect(report).toContain("[REQ-001](evidence-index.md#req-001)");
    expect(report).not.toContain(design.analysis.clauses[0].sourceRef);
    expect(testIntentReport).not.toContain(design.analysis.clauses[0].sourceRef);
    expect(evidenceIndex).toContain("# Requirement：证据索引");
    expect(evidenceIndex).toContain("REQ-001");
  });

  it("writes cross-module clauses into separate module knowledge files and edges", async () => {
    const repository = new InMemoryBrainCreatorRepository();
    const knowledgeDir = await tempDir();
    const service = new KnowledgeService(repository, knowledgeDir);
    const project = await service.createProject({
      name: "Recruiting Offer",
      key: "recruiting-offer",
      defaultLocale: "en-US"
    });
    const ingested = await service.ingestRequirement({
      projectId: project.id,
      contentPackage: requirementPackage(
        "cross-module",
        "Recruiter creates a hiring request. When the request is approved, the Offer module creates an offer."
      )
    });

    const result = await service.generateTestDesign(ingested.requirementSet.id);

    expect(result.testIntents.map((intent) => intent.module)).toEqual([
      "Recruiting",
      "Offer"
    ]);
    expect(
      await readFile(
        join(knowledgeDir, "recruiting-offer", "modules", "recruiting", "flows.md"),
        "utf8"
      )
    ).toContain("Recruiter creates a hiring request");
    expect(
      await readFile(
        join(knowledgeDir, "recruiting-offer", "modules", "offer", "flows.md"),
        "utf8"
      )
    ).toContain("Offer module creates an offer");
    const moduleNodes = repository.knowledgeNodes.filter(
      (node) => node.requirementSetId === ingested.requirementSet.id && node.type === "module"
    );
    for (const moduleNode of moduleNodes) {
      expect(
        repository.knowledgeEdges.some(
          (edge) =>
            edge.fromNodeId === moduleNode.id &&
            repository.knowledgeNodes.some(
              (node) => node.id === edge.toNodeId && node.module === moduleNode.module
            )
        )
      ).toBe(true);
    }
  });

  it("persists Eval actions and blocks approval until the user explicitly confirms them", async () => {
    const root = await tempDir();
    const dataFile = join(root, "assets.json");
    const knowledgeDir = join(root, "knowledge");
    const repository = new JsonFileBrainCreatorRepository(dataFile);
    const first = new KnowledgeService(repository, knowledgeDir);
    const project = await first.createProject({
      name: "Order Workflow",
      key: "order-eval-gate",
      defaultLocale: "en-US"
    });
    const ingested = await first.ingestRequirement({
      projectId: project.id,
      contentPackage: requirementPackage(
        "order-eval-gate-v1",
        "When the manager approves the order, status changes from draft to approved."
      )
    });

    const design = await first.generateTestDesign(ingested.requirementSet.id);
    const pendingAction = design.evaluationGate.actions[0];

    expect(design.evaluationGate).toEqual(
      expect.objectContaining({
        status: "needs-confirmation",
        verdict: "needs-user",
        actions: [
          expect.objectContaining({
            kind: "missing-branch",
            status: "pending",
            sourceRefs: [expect.stringContaining("#clause-1")]
          })
        ]
      })
    );
    expect(() => first.approveRequirementSet(ingested.requirementSet.id)).toThrow(
      "Requirement Eval actions must be confirmed before approval"
    );

    const restoredRepository = new JsonFileBrainCreatorRepository(dataFile);
    const restored = new KnowledgeService(restoredRepository, knowledgeDir);
    expect(restored.listRequirementSets(project.id)[0].evaluationGate?.actions[0].status).toBe("pending");
    await expect(
      restored.confirmEvaluationActions({
        requirementSetId: ingested.requirementSet.id,
        actionIds: [pendingAction.id],
        note: "If approval does not occur, the order remains in draft.",
        confirm: false
      })
    ).rejects.toThrow("Explicit confirmation is required");

    const confirmed = await restored.confirmEvaluationActions({
      requirementSetId: ingested.requirementSet.id,
      actionIds: [pendingAction.id],
      note: "If approval does not occur, the order remains in draft.",
      confirm: true,
      confirmedBy: "reviewer@example.test"
    });
    const confirmationReport = await readFile(
      join(
        knowledgeDir,
        "order-eval-gate",
        "requirements",
        ingested.requirementSet.id,
        "evaluation-confirmations.md"
      ),
      "utf8"
    );

    expect(confirmed.evaluationGate.status).toBe("confirmed");
    expect(confirmed.evaluationGate.actions[0]).toEqual(
      expect.objectContaining({
        status: "confirmed",
        confirmationNote: "If approval does not occur, the order remains in draft.",
        confirmedAt: expect.any(String),
        confirmedBy: "reviewer@example.test"
      })
    );
    expect(confirmationReport).toContain("If approval does not occur");
    expect(confirmationReport).toContain("reviewer@example.test");
    expect(confirmed.evaluationGate.actions[0].resolutionNodeId).toBeTruthy();
    expect(restored.listTestIntents(project.id).flatMap((intent) => intent.expectedResults)).not.toContain(
      "Confirmed Eval resolution: If approval does not occur, the order remains in draft."
    );
    expect(
      restoredRepository.knowledgeNodes.find(
        (node) => node.id === confirmed.evaluationGate.actions[0].resolutionNodeId
      )
    ).toEqual(expect.objectContaining({
      type: "requirement",
      origin: "derived",
      content: "If approval does not occur, the order remains in draft."
    }));
    expect(restored.approveRequirementSet(ingested.requirementSet.id).status).toBe("approved");
    const compiled = restored.compileExecutableCases(design.testIntents[0].id).executableCase;
    expect(compiled.steps.every((step) =>
      step.sourceRefs.some((sourceRef) => sourceRef.includes("#eval-action-"))
    )).toBe(true);
  });

  it("removes legacy Eval-resolution notes from TestIntent oracles during scenario regeneration", async () => {
    const service = new KnowledgeService(new InMemoryBrainCreatorRepository(), await tempDir());
    const project = await service.createProject({ name: "Scope review", key: "scope-review", defaultLocale: "en-US" });
    const ingested = await service.ingestRequirement({
      projectId: project.id,
      contentPackage: requirementPackage("scope-review", "Users create and submit a request.")
    });
    const design = await service.generateTestDesign(ingested.requirementSet.id);
    const intent = design.testIntents[0];
    const originalExpectedResults = [...intent.expectedResults];
    intent.expectedResults.push("Confirmed Eval resolution: A scope clarification, not an expected business result.");

    await service.generateTestDesign(ingested.requirementSet.id);

    expect(intent.expectedResults).toEqual(originalExpectedResults);
  });

  it("compiles only the selected intent instead of guessing hidden workflow actions", async () => {
    const service = new KnowledgeService(new InMemoryBrainCreatorRepository(), await tempDir());
    const project = await service.createProject({ name: "Contracts", key: "contracts", defaultLocale: "zh-CN" });
    const ingested = await service.ingestRequirement({
      projectId: project.id,
      contentPackage: requirementPackage(
        "contracts-hash",
        "合同可以从列表新建，也可以从客户详情新建。填写合同表单并提交。"
      )
    });
    const design = await service.generateTestDesign(ingested.requirementSet.id);
    service.approveRequirementSet(ingested.requirementSet.id);

    const compiled = service.compileExecutableCases(design.testIntents[0].id);

    expect(compiled.executableCase.status).toBe("ready");
    expect(compiled.executableCase.steps.map((step) => step.action)).toEqual([
      "navigate", "click", "fill", "assert"
    ]);
    expect(compiled.executableCase.steps.find((step) => step.action === "click")?.origin).toBe("source");
    expect(compiled.gaps).toEqual([]);
  });

  it("recognizes real UTF-8 Chinese workflows and conditional fields", async () => {
    const service = new KnowledgeService(new InMemoryBrainCreatorRepository(), await tempDir());
    const project = await service.createProject({ name: "Recruiting", key: "utf8-recruiting", defaultLocale: "zh-CN" });
    const ingested = await service.ingestRequirement({
      projectId: project.id,
      contentPackage: requirementPackage(
        "utf8-recruiting",
        "\u8fdb\u5165\u62db\u8058\u9700\u6c42\u5217\u8868\uff0c\u586b\u5199\u62db\u8058\u9700\u6c42\u8868\u5355\u3002\u9700\u6c42\u7c7b\u578b\u9009\u62e9\u79bb\u804c\u66ff\u8865\u540e\u663e\u793a\u66ff\u8865\u4eba\u5458\u5b57\u6bb5\u3002"
      )
    });
    const design = await service.generateTestDesign(ingested.requirementSet.id);
    await service.confirmEvaluationActions({
      requirementSetId: ingested.requirementSet.id,
      actionIds: design.evaluationGate.actions.map((action) => action.id),
      note: "未选择离职替补时，替补人员字段保持隐藏。",
      confirm: true
    });
    service.approveRequirementSet(ingested.requirementSet.id);

    const compiled = service.compileExecutableCases(design.testIntents[0].id);

    expect(compiled.executableCase.steps.map((step) => step.action)).toEqual([
      "navigate", "fill", "assert"
    ]);
    expect(compiled.executableCase.steps.every((step) => step.sourceRefs.length > 0)).toBe(true);
  });

  it("does not mix unrelated UTF-8 workflow paths into one selected intent", async () => {
    const service = new KnowledgeService(new InMemoryBrainCreatorRepository(), await tempDir());
    const project = await service.createProject({ name: "Contracts", key: "utf8-contracts", defaultLocale: "zh-CN" });
    const ingested = await service.ingestRequirement({
      projectId: project.id,
      contentPackage: requirementPackage(
        "utf8-contracts",
        "\u53ef\u4ee5\u4ece\u5217\u8868\u9875\u65b0\u5efa\u5408\u540c\uff0c\u4e5f\u53ef\u4ee5\u4ece\u5ba2\u6237\u8be6\u60c5\u9875\u65b0\u5efa\u5408\u540c\u3002"
      )
    });
    const design = await service.generateTestDesign(ingested.requirementSet.id);
    service.approveRequirementSet(ingested.requirementSet.id);

    const compiled = service.compileExecutableCases(design.testIntents[0].id);
    expect(compiled.executableCase.status).toBe("ready");
    expect(compiled.executableCase.steps.every((step) => step.sourceRefs.length > 0)).toBe(true);
  });

  it("reuses an existing design and deprecates impacted nodes only after the new baseline is approved", async () => {
    const repository = new InMemoryBrainCreatorRepository();
    const knowledgeDir = await tempDir();
    const service = new KnowledgeService(repository, knowledgeDir);
    const project = await service.createProject({ name: "Orders", key: "orders-impact", defaultLocale: "en-US" });
    const first = await service.ingestRequirement({
      projectId: project.id,
      contentPackage: requirementPackage("v1", "Orders above 1000 require approval.")
    });
    const firstDesign = await service.generateTestDesign(first.requirementSet.id);
    const reused = await service.generateTestDesign(first.requirementSet.id);
    const evidenceIndex = await readFile(
      join(knowledgeDir, "orders-impact", "requirements", first.requirementSet.id, "evidence-index.md"),
      "utf8"
    );
    service.approveRequirementSet(first.requirementSet.id);
    const second = await service.ingestRequirement({
      projectId: project.id,
      contentPackage: requirementPackage("v2", "Orders above 2000 require approval.")
    });
    await service.generateTestDesign(second.requirementSet.id);

    expect(reused.reused).toBe(true);
    expect(evidenceIndex).toContain("证据索引");
    expect(repository.testIntents.filter((item) => item.requirementSetId === first.requirementSet.id)).toHaveLength(
      firstDesign.testIntents.length
    );
    expect(second.requirementSet.affectedNodeIds.length).toBeGreaterThan(0);
    const unchangedModule = repository.knowledgeNodes.find(
      (item) => item.requirementSetId === first.requirementSet.id && item.type === "module"
    );
    expect(second.requirementSet.affectedNodeIds).not.toContain(unchangedModule?.id);
    expect(
      repository.knowledgeNodes.filter((item) => first.requirementSet.affectedNodeIds.includes(item.id))
    ).toEqual(expect.arrayContaining([expect.objectContaining({ status: "confirmed" })]));

    service.approveRequirementSet(second.requirementSet.id);

    expect(
      repository.knowledgeNodes.filter((item) => first.requirementSet.affectedNodeIds.includes(item.id))
    ).toEqual(expect.arrayContaining([expect.objectContaining({ status: "deprecated" })]));
    expect(unchangedModule?.status).toBe("confirmed");
  });

  it("blocks baseline approval while requirement clarification gaps remain open", async () => {
    const repository = new InMemoryBrainCreatorRepository();
    const service = new KnowledgeService(repository, await tempDir());
    const project = await service.createProject({ name: "Invoices", key: "invoice-gaps", defaultLocale: "en-US" });
    const ingested = await service.ingestRequirement({
      projectId: project.id,
      contentPackage: requirementPackage("invoice-gap", "The invoice approval threshold is not specified.")
    });

    const design = await service.generateTestDesign(ingested.requirementSet.id);

    expect(design.evaluation.verdict).toBe("needs-user");
    expect(design.gaps).toEqual([expect.objectContaining({ sourceType: "requirement-clarification" })]);
    expect(design.evaluationGate.actions[0]).toEqual(
      expect.objectContaining({
        kind: "clarification",
        status: "pending",
        gapIds: [design.gaps[0].id]
      })
    );
    expect(() => service.approveRequirementSet(ingested.requirementSet.id)).toThrow(
      "Requirement Eval actions must be confirmed"
    );
    const confirmation = await service.confirmEvaluationActions({
      requirementSetId: ingested.requirementSet.id,
      actionIds: [design.evaluationGate.actions[0].id],
      note: "The invoice approval threshold is 1000.",
      confirm: true
    });

    expect(design.gaps[0].status).toBe("open");
    expect(confirmation.evaluationGate.actions[0].resolutionNodeId).toEqual(expect.any(String));
    expect(confirmation.resolvedGapIds).toEqual([]);
    expect(
      repository.knowledgeNodes.find(
        (node) => node.id === confirmation.evaluationGate.actions[0].resolutionNodeId
      )
    ).toEqual(expect.objectContaining({ content: "The invoice approval threshold is 1000." }));
    expect(() => service.approveRequirementSet(ingested.requirementSet.id)).toThrow(
      "Requirement clarification gaps must be resolved before approval"
    );
  });

  it("blocks baseline approval when requirement clauses contradict each other", async () => {
    const repository = new InMemoryBrainCreatorRepository();
    const service = new KnowledgeService(repository, await tempDir());
    const project = await service.createProject({
      name: "Approval Form",
      key: "approval-conflict",
      defaultLocale: "en-US"
    });
    const ingested = await service.ingestRequirement({
      projectId: project.id,
      contentPackage: requirementPackage(
        "approval-conflict-v1",
        "The approval field is visible. The approval field is not visible."
      )
    });

    const design = await service.generateTestDesign(ingested.requirementSet.id);

    expect(design.evaluation.verdict).toBe("needs-user");
    expect(design.gaps).toEqual([
      expect.objectContaining({ sourceType: "requirement-conflict", status: "open" })
    ]);
    expect(design.evaluationGate).toEqual(
      expect.objectContaining({
        status: "blocked",
        actions: [expect.objectContaining({ kind: "contradiction", status: "blocked" })]
      })
    );
    expect(() => service.approveRequirementSet(ingested.requirementSet.id)).toThrow(
      "Blocked Requirement Eval output cannot be approved"
    );
    await expect(
      service.confirmEvaluationActions({
        requirementSetId: ingested.requirementSet.id,
        actionIds: [design.evaluationGate.actions[0].id],
        note: "The field should be visible.",
        confirm: true
      })
    ).rejects.toThrow("Blocked Requirement Eval actions cannot be confirmed");
  });

  it("keeps approved expectations separate from conflicting system observations", async () => {
    const repository = new InMemoryBrainCreatorRepository();
    const knowledgeDir = await tempDir();
    const service = new KnowledgeService(repository, knowledgeDir);
    const project = await service.createProject({ name: "Orders", key: "orders-observed", defaultLocale: "en-US" });
    repository.systemProfiles.push({
      id: "system-orders",
      name: "Orders",
      environment: "test",
      baseUrl: "https://orders.example.test",
      defaultLocale: "en-US",
      urlAllowlist: ["https://orders.example.test"],
      status: "succeeded",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    service.bindSystem(project.id, "system-orders");
    repository.knowledgeNodes.push({
      id: "expected-rule",
      knowledgeProjectId: project.id,
      type: "rule",
      title: "Approval threshold",
      content: "Orders above 1000 require approval.",
      module: "Orders",
      sourceRefs: ["requirement-1"],
      origin: "source",
      confidence: 1,
      status: "confirmed",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    const result = await service.recordSystemObservation({
      projectId: project.id,
      systemId: "system-orders",
      type: "rule",
      title: "Approval threshold",
      content: "Orders above 2000 require approval.",
      module: "Orders",
      sourceRefs: ["trace/order-42.zip"]
    });

    expect(result.conflicted).toBe(true);
    expect(result.observation).toEqual(expect.objectContaining({ origin: "observed", status: "conflicted" }));
    expect(repository.knowledgeNodes.find((node) => node.id === "expected-rule")?.status).toBe("confirmed");
    expect(result.gaps).toEqual([expect.objectContaining({ sourceType: "system-observation", status: "open" })]);
    expect(await readFile(join(knowledgeDir, "orders-observed", "systems", "system-orders", "conflicts.md"), "utf8"))
      .toContain("Orders above 2000 require approval");
  });

  it("stores step-level execution evidence without inventing missing screenshots", async () => {
    const repository = new InMemoryBrainCreatorRepository();
    const knowledgeDir = await tempDir();
    const service = new KnowledgeService(repository, knowledgeDir);
    const project = await service.createProject({ name: "Evidence", key: "execution-evidence", defaultLocale: "en-US" });
    repository.systemProfiles.push({
      id: "system-evidence",
      name: "Evidence",
      environment: "test",
      baseUrl: "https://evidence.example.test",
      defaultLocale: "en-US",
      urlAllowlist: ["https://evidence.example.test"],
      status: "succeeded",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    service.bindSystem(project.id, "system-evidence");
    repository.systemProfiles[0]!.executionProvenance = "synthetic";
    const ingested = await service.ingestRequirement({
      projectId: project.id,
      contentPackage: requirementPackage("evidence", "Users create an order form.")
    });
    const design = await service.generateTestDesign(ingested.requirementSet.id);
    service.approveRequirementSet(ingested.requirementSet.id);
    const compiled = service.compileExecutableCases(design.testIntents[0].id).executableCase;
    const runs = new RequirementSuiteRunService(repository);
    const run = runs.create({
      knowledgeProjectId: project.id,
      systemId: "system-evidence",
      cases: [{ executableCaseId: compiled.id, title: compiled.title }],
      continueOnBlocked: true
    });
    runs.beginNext(run.id);
    expect(() => service.createExecutionEvidence({
      projectId: project.id,
      systemId: "system-evidence",
      executableCaseId: compiled.id,
      requirementSuiteRunId: "missing-run",
      testCaseId: "test-case-evidence",
      contextPackPath: "context/evidence.json"
    })).toThrow("does not match the active suite case");
    const evidence = service.createExecutionEvidence({
      projectId: project.id,
      systemId: "system-evidence",
      executableCaseId: compiled.id,
      requirementSuiteRunId: run.id,
      testCaseId: "test-case-evidence",
      contextPackPath: "context/evidence.json"
    });
    expect(evidence.requirementSuiteRunId).toBe(run.id);
    expect(evidence.provenance).toBe("synthetic");
    repository.systemProfiles[0]!.executionProvenance = "real-system";
    expect(evidence.provenance).toBe("synthetic");

    const completed = await service.completeExecutionEvidence(evidence.id, {
      status: "failed",
      chainRunId: "chain-evidence",
      actualResult: "Expected approved status but received draft",
      artifactPaths: ["evidence/step-04.png", "evidence/trace.zip"],
      tracePaths: ["evidence/trace.zip"],
      consoleErrors: ["console error: failed request"],
      networkFailures: ["GET /orders 500"]
    });

    expect(completed.status).toBe("failed");
    expect(completed.steps.find((step) => step.order === 4)?.screenshotPath).toBe(
      "evidence/step-04.png"
    );
    expect(completed.steps.find((step) => step.action === "assert")).toEqual(
      expect.objectContaining({ assertionStatus: "failed", actual: expect.stringContaining("draft") })
    );
    expect(completed.steps.filter((step) => step.action !== "assert")).toEqual(
      expect.arrayContaining([expect.objectContaining({ assertionStatus: "blocked" })])
    );
    expect(compiled.status).toBe("executed");
    expect(
      await readFile(
        join(knowledgeDir, "execution-evidence", "reports", "chain-evidence", "summary.md"),
        "utf8"
      )
    ).toContain("Expected approved status but received draft");
  });

  it("does not accept a passed status when the structured reporter failed", async () => {
    const repository = new InMemoryBrainCreatorRepository();
    const knowledgeDir = await tempDir();
    const service = new KnowledgeService(repository, knowledgeDir);
    const project = await service.createProject({ name: "Reporter authority", key: "reporter-authority", defaultLocale: "en-US" });
    repository.systemProfiles.push({
      id: "system-reporter-authority",
      name: "Reporter authority",
      environment: "test",
      baseUrl: "https://reporter-authority.example.test",
      defaultLocale: "en-US",
      urlAllowlist: ["https://reporter-authority.example.test"],
      status: "succeeded",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    service.bindSystem(project.id, "system-reporter-authority");
    const ingested = await service.ingestRequirement({
      projectId: project.id,
      contentPackage: requirementPackage("reporter-authority", "Users create an order form.")
    });
    const design = await service.generateTestDesign(ingested.requirementSet.id);
    service.approveRequirementSet(ingested.requirementSet.id);
    const compiled = service.compileExecutableCases(design.testIntents[0].id).executableCase;
    const evidence = service.createExecutionEvidence({
      projectId: project.id,
      systemId: "system-reporter-authority",
      executableCaseId: compiled.id,
      testCaseId: "test-reporter-authority",
      contextPackPath: "context/reporter-authority.json"
    });

    const completed = await service.completeExecutionEvidence(evidence.id, {
      status: "passed",
      actualResult: "Caller reported passed",
      artifactPaths: [],
      reporterResult: {
        status: "failed",
        total: 0,
        passed: 0,
        failed: 0,
        skipped: 0,
        durationMs: 1,
        assertions: [],
        steps: [],
        attachments: [],
        consoleErrors: [],
        networkFailures: []
      }
    });

    expect(completed.status).toBe("failed");
    expect(completed.evidenceWarnings).toEqual(
      expect.arrayContaining([
        "Requested status passed disagreed with structured Reporter status failed; Reporter status was used."
      ])
    );
  });

  it("does not trust a stored Reporter result that differs from its persisted artifact", async () => {
    const repository = new InMemoryBrainCreatorRepository();
    const knowledgeDir = await tempDir();
    const service = new KnowledgeService(repository, knowledgeDir);
    const project = await service.createProject({ name: "Reporter binding", key: "reporter-binding", defaultLocale: "en-US" });
    repository.systemProfiles.push({
      id: "system-reporter-binding",
      name: "Reporter binding",
      environment: "test",
      baseUrl: "https://reporter-binding.example.test",
      defaultLocale: "en-US",
      urlAllowlist: ["https://reporter-binding.example.test"],
      executionProvenance: "real-system",
      status: "succeeded",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    service.bindSystem(project.id, "system-reporter-binding");
    const ingested = await service.ingestRequirement({
      projectId: project.id,
      contentPackage: requirementPackage("reporter-binding", "The approval state is approved.")
    });
    const design = await service.generateTestDesign(ingested.requirementSet.id);
    service.approveRequirementSet(ingested.requirementSet.id);
    const executableCase = service.compileExecutableCases(design.testIntents[0].id).executableCase;
    const evidence = service.createExecutionEvidence({
      projectId: project.id,
      systemId: "system-reporter-binding",
      executableCaseId: executableCase.id,
      testCaseId: "test-reporter-binding",
      contextPackPath: "context/reporter-binding.json"
    });
    const assertionStep = evidence.steps.find((step) => step.action === "assert");
    if (!assertionStep) throw new Error("Expected a compiled assertion step");
    evidence.assertionContracts = [{
      id: "approval-state",
      stepId: assertionStep.stepId,
      type: "state",
      strength: "strong",
      expected: "approved",
      requirementRefs: ["requirement:approval-state"],
      evidenceRequirements: ["actual-value"],
      oracle: {
        operator: "equals",
        expected: "approved",
        applicability: { mode: "unconditional" },
        applicabilityRefs: ["requirement:approval-state"]
      }
    }];
    const reporterResult = {
      status: "passed" as const,
      total: 1,
      passed: 1,
      failed: 0,
      skipped: 0,
      durationMs: 1,
      assertions: [{
        id: "approval-state",
        stepId: assertionStep.stepId,
        status: "passed" as const,
        expected: "approved",
        actual: "approved",
        evidenceRefs: ["evidence/actual.json"]
      }],
      steps: evidence.steps.map((step) => ({
        id: step.stepId,
        title: step.stepId,
        status: "passed" as const,
        evidenceRefs: ["evidence/actual.json"]
      })),
      attachments: [],
      consoleErrors: [],
      networkFailures: []
    };
    await mkdir(join(knowledgeDir, "evidence"), { recursive: true });
    await writeFile(join(knowledgeDir, "evidence", "actual.json"), "{\"state\":\"approved\"}", "utf8");
    await writeFile(join(knowledgeDir, "evidence", "reporter.json"), JSON.stringify({ ...reporterResult, assertions: [] }), "utf8");

    const completed = await service.completeExecutionEvidence(evidence.id, {
      status: "passed",
      actualResult: "approved",
      artifactPaths: ["evidence/actual.json", "evidence/reporter.json"],
      evidenceRootDir: knowledgeDir,
      reporterPath: "evidence/reporter.json",
      reporterResult
    });

    expect(completed.artifactValidation?.status).toBe("valid");
    expect(completed.assuranceLevel).toBe("limited");
    expect(completed.evidenceWarnings).toContain(
      "Structured Reporter artifact does not match the stored Reporter result."
    );
  });

  it("downgrades assurance and records a warning when a declared trace is missing", async () => {
    const repository = new InMemoryBrainCreatorRepository();
    const knowledgeDir = await tempDir();
    const service = new KnowledgeService(repository, knowledgeDir);
    const project = await service.createProject({ name: "Trace evidence", key: "trace-evidence", defaultLocale: "en-US" });
    repository.systemProfiles.push({
      id: "system-trace",
      name: "Trace",
      environment: "test",
      baseUrl: "https://trace.example.test",
      defaultLocale: "en-US",
      urlAllowlist: ["https://trace.example.test"],
      status: "succeeded",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    service.bindSystem(project.id, "system-trace");
    const ingested = await service.ingestRequirement({
      projectId: project.id,
      contentPackage: requirementPackage("trace", "Users submit an order.")
    });
    const design = await service.generateTestDesign(ingested.requirementSet.id);
    service.approveRequirementSet(ingested.requirementSet.id);
    const executableCase = service.compileExecutableCases(design.testIntents[0].id).executableCase;
    const evidence = service.createExecutionEvidence({
      projectId: project.id,
      systemId: "system-trace",
      executableCaseId: executableCase.id,
      testCaseId: "test-trace",
      contextPackPath: "context/trace.json"
    });
    evidence.assertionContracts = [{
      id: "assert-workflow",
      type: "workflow",
      strength: "strong",
      requirementRefs: ["requirement:trace"],
      evidenceRequirements: ["trace"]
    }];
    const completed = await service.completeExecutionEvidence(evidence.id, {
      status: "passed",
      artifactPaths: [],
      tracePaths: ["missing/trace.zip"],
      reporterResult: {
        status: "passed",
        total: 1,
        passed: 1,
        failed: 0,
        skipped: 0,
        durationMs: 1,
        assertions: [],
        steps: [],
        attachments: [],
        consoleErrors: [],
        networkFailures: []
      },
      evidenceRootDir: knowledgeDir
    });

    expect(completed.assuranceLevel).toBe("none");
    expect(completed.evidenceWarnings).toEqual(
      expect.arrayContaining([expect.stringContaining("Missing trace artifact")])
    );
  });

  it("redacts auth values before execution evidence and reports are persisted", async () => {
    const repository = new InMemoryBrainCreatorRepository();
    const knowledgeDir = await tempDir();
    const service = new KnowledgeService(repository, knowledgeDir);
    const project = await service.createProject({ name: "Redacted evidence", key: "redacted-evidence", defaultLocale: "en-US" });
    repository.systemProfiles.push({
      id: "system-redacted",
      name: "Redacted",
      environment: "test",
      baseUrl: "https://redacted.example.test",
      defaultLocale: "en-US",
      urlAllowlist: ["https://redacted.example.test"],
      status: "succeeded",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    repository.authProfiles.push({
      id: "auth-redacted",
      projectId: "system-redacted",
      env: "test",
      role: "qa",
      loginMethod: "token",
      encryptedSecrets: encryptSecrets({ token: "runtime-secret-value" }),
      status: "succeeded",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    service.bindSystem(project.id, "system-redacted");
    const ingested = await service.ingestRequirement({
      projectId: project.id,
      contentPackage: requirementPackage("redacted", "Users create a record.")
    });
    const design = await service.generateTestDesign(ingested.requirementSet.id);
    service.approveRequirementSet(ingested.requirementSet.id);
    const executableCase = service.compileExecutableCases(design.testIntents[0].id).executableCase;
    const persistedCase = repository.executableCases.find((item) => item.id === executableCase.id);
    if (!persistedCase) throw new Error("Expected compiled case to be persisted");
    persistedCase.steps[0] = {
      ...persistedCase.steps[0],
      targetSemantic: "Protected token field",
      value: "runtime-secret-value",
      pageModelId: "page-redacted",
      locatorPointId: "locator-token",
      dataProfileId: "data-token"
    };
    const evidence = service.createExecutionEvidence({
      projectId: project.id,
      systemId: "system-redacted",
      executableCaseId: executableCase.id,
      testCaseId: "test-redacted",
      contextPackPath: "context/redacted.json"
    });
    expect(evidence.steps[0]).toEqual(expect.objectContaining({
      targetSemantic: "Protected token field",
      value: "[REDACTED]",
      pageModelId: "page-redacted",
      locatorPointId: "locator-token",
      dataProfileId: "data-token"
    }));
    const completed = await service.completeExecutionEvidence(evidence.id, {
      status: "failed",
      actualResult: "token=runtime-secret-value",
      artifactPaths: [],
      consoleErrors: ["Authorization runtime-secret-value"],
      networkFailures: ["GET /records?token=runtime-secret-value"],
      reporterResult: {
        status: "failed",
        total: 1,
        passed: 0,
        failed: 1,
        skipped: 0,
        durationMs: 1,
        assertions: [{
          id: "assert-secret",
          status: "failed",
          actual: "runtime-secret-value",
          expected: "runtime-secret-value",
          evidenceRefs: []
        }],
        steps: [{
          id: "step-secret",
          title: "bc:secret",
          status: "failed",
          evidenceRefs: [],
          error: "token=runtime-secret-value",
          consoleErrors: ["runtime-secret-value"],
          networkFailures: ["runtime-secret-value"]
        }],
        attachments: [],
        consoleErrors: ["runtime-secret-value"],
        networkFailures: ["runtime-secret-value"]
      }
    });

    expect(completed.actualResult).toBe("token=[REDACTED]");
    expect(completed.consoleErrors).toEqual(["Authorization [REDACTED]"]);
    expect(completed.networkFailures).toEqual(["GET /records?token=[REDACTED]"]);
    expect(completed.reporterResult?.assertions[0].actual).toBe("[REDACTED]");
    expect(completed.reporterResult?.steps?.[0].error).toBe("token=[REDACTED]");
    const report = await readFile(join(knowledgeDir, "redacted-evidence", "reports", evidence.id, "summary.md"), "utf8");
    expect(report).not.toContain("runtime-secret-value");
  });

  it("downgrades assurance when structured reporter omits a declared step", async () => {
    const repository = new InMemoryBrainCreatorRepository();
    const knowledgeDir = await tempDir();
    const service = new KnowledgeService(repository, knowledgeDir);
    await writeFile(join(knowledgeDir, "trace.zip"), "trace", "utf8");
    const project = await service.createProject({ name: "Reporter coverage", key: "reporter-coverage", defaultLocale: "en-US" });
    repository.systemProfiles.push({
      id: "system-reporter-coverage",
      name: "Reporter coverage",
      environment: "test",
      baseUrl: "https://reporter-coverage.example.test",
      defaultLocale: "en-US",
      urlAllowlist: ["https://reporter-coverage.example.test"],
      status: "succeeded",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    service.bindSystem(project.id, "system-reporter-coverage");
    const ingested = await service.ingestRequirement({
      projectId: project.id,
      contentPackage: requirementPackage("reporter-coverage", "Users create an order record.")
    });
    const design = await service.generateTestDesign(ingested.requirementSet.id);
    service.approveRequirementSet(ingested.requirementSet.id);
    const executableCase = service.compileExecutableCases(design.testIntents[0].id).executableCase;
    const evidence = service.createExecutionEvidence({
      projectId: project.id,
      systemId: "system-reporter-coverage",
      executableCaseId: executableCase.id,
      testCaseId: "test-reporter-coverage",
      contextPackPath: "context/reporter-coverage.json"
    });
    const completed = await service.completeExecutionEvidence(evidence.id, {
      status: "passed",
      artifactPaths: [],
      tracePaths: ["trace.zip"],
      evidenceRootDir: knowledgeDir,
      reporterResult: {
        status: "passed",
        total: evidence.assertionContracts?.length ?? 0,
        passed: evidence.assertionContracts?.length ?? 0,
        failed: 0,
        skipped: 0,
        durationMs: 1,
        assertions: (evidence.assertionContracts ?? []).map((contract) => ({
          id: contract.id,
          status: "passed" as const,
          evidenceRefs: []
        })),
        steps: [],
        attachments: [],
        consoleErrors: [],
        networkFailures: []
      }
    });

    expect(completed.assuranceLevel).toBe("limited");
    expect(completed.evidenceWarnings).toEqual(expect.arrayContaining([
      expect.stringContaining("Assurance evidence incomplete: actual-value, screenshot, trace"),
      expect.stringContaining("Missing structured Reporter evidence for step(s):")
    ]));
    expect(completed.evidenceWarnings?.some((warning) => warning.includes("Missing trace artifact"))).toBe(false);
  });

  it("does not verify field or workflow coverage from unreadable step artifacts", async () => {
    const repository = new InMemoryBrainCreatorRepository();
    const knowledgeDir = await tempDir();
    await mkdir(join(knowledgeDir, "evidence"), { recursive: true });
    await writeFile(join(knowledgeDir, "evidence", "trace.zip"), "trace", "utf8");
    const service = new KnowledgeService(repository, knowledgeDir);
    const project = await service.createProject({ name: "Coverage dimensions", key: "coverage-dimensions", defaultLocale: "en-US" });
    repository.systemProfiles.push({
      id: "system-coverage-dimensions",
      name: "Coverage dimensions",
      environment: "test",
      baseUrl: "https://coverage-dimensions.example.test",
      defaultLocale: "en-US",
      urlAllowlist: ["https://coverage-dimensions.example.test"],
      status: "succeeded",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    service.bindSystem(project.id, "system-coverage-dimensions");
    const ingested = await service.ingestRequirement({
      projectId: project.id,
      contentPackage: requirementPackage("coverage-dimensions", "Users fill the customer form and save the customer record.")
    });
    const design = await service.generateTestDesign(ingested.requirementSet.id);
    service.approveRequirementSet(ingested.requirementSet.id);
    const executableCase = service.compileExecutableCases(design.testIntents[0].id).executableCase;
    const evidence = service.createExecutionEvidence({
      projectId: project.id,
      systemId: "system-coverage-dimensions",
      executableCaseId: executableCase.id,
      testCaseId: "test-coverage-dimensions",
      contextPackPath: "context/coverage-dimensions.json"
    });
    const completed = await service.completeExecutionEvidence(evidence.id, {
      status: "passed",
      actualResult: "Customer form saved",
      artifactPaths: ["evidence/step.png", "evidence/trace.zip"],
      tracePaths: ["evidence/trace.zip"],
      evidenceRootDir: knowledgeDir,
      reporterResult: {
        status: "passed",
        total: evidence.assertionContracts?.length ?? 0,
        passed: evidence.assertionContracts?.length ?? 0,
        failed: 0,
        skipped: 0,
        durationMs: 1,
        assertions: (evidence.assertionContracts ?? []).map((contract, index) => ({
          id: contract.id,
          stepId: contract.stepId,
          status: "passed" as const,
          actual: `Observed value ${index + 1}`,
          evidenceRefs: ["evidence/assertion.png", "evidence/trace.zip"]
        })),
        steps: evidence.steps.map((step) => ({
          id: step.stepId,
          title: `bc:${step.stepId}`,
          status: "passed" as const,
          evidenceRefs: ["evidence/step.png"]
        })),
        attachments: ["evidence/step.png", "evidence/trace.zip"],
        consoleErrors: [],
        networkFailures: []
      }
    });

    expect(completed.coverage?.required).toEqual(expect.arrayContaining(["field", "workflow"]));
    expect(completed.coverage?.verified).toEqual([]);
    expect(completed.coverage?.missing).toEqual(expect.arrayContaining(["field", "workflow"]));
    expect(completed.assuranceLevel).toBe("limited");
    expect(completed.artifactValidation?.status).toBe("invalid");
    expect(completed.steps.filter((step) => step.action === "assert").map((step) => step.actual)).toEqual(
      (evidence.assertionContracts ?? []).map((_, index) => `Observed value ${index + 1}`)
    );
  });

  it("does not claim conformance for legacy paths without files or an oracle", async () => {
    const repository = new InMemoryBrainCreatorRepository();
    const workDir = await tempDir();
    const integrityAuthenticator = createWorkspaceIntegrityAuthenticator(workDir);
    const service = new KnowledgeService(
      repository,
      join(workDir, "knowledge"),
      workDir,
      undefined,
      undefined,
      integrityAuthenticator
    );
    const project = await service.createProject({ name: "Conformance", key: "conformance", defaultLocale: "en-US" });
    repository.systemProfiles.push({
      id: "system-conformance",
      name: "Conformance",
      environment: "test",
      baseUrl: "https://conformance.example.test",
      defaultLocale: "en-US",
      urlAllowlist: ["https://conformance.example.test"],
      status: "succeeded",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    service.bindSystem(project.id, "system-conformance");
    const ingested = await service.ingestRequirement({
      projectId: project.id,
      contentPackage: requirementPackage("conformance", "Users create an order record.")
    });
    const design = await service.generateTestDesign(ingested.requirementSet.id);
    const scenario = repository.businessScenarios.find(
      (item) => item.requirementSetId === ingested.requirementSet.id
    );
    if (!scenario) throw new Error("Expected a generated business scenario");
    scenario.testIntentIds = [design.testIntents[0].id];
    service.approveRequirementSet(ingested.requirementSet.id);
    const executableCase = service.compileExecutableCases(
      design.testIntents[0].id,
      "system-conformance"
    ).executableCase;
    const evidence = service.createExecutionEvidence({
      projectId: project.id,
      systemId: "system-conformance",
      executableCaseId: executableCase.id,
      testCaseId: "test-conformance",
      contextPackPath: "context/conformance.json"
    });
    const contracts = evidence.assertionContracts ?? [];
    const completed = await service.completeExecutionEvidence(evidence.id, {
      status: "passed",
      artifactPaths: ["evidence/step-04.png"],
      tracePaths: ["evidence/trace.zip"],
      reporterResult: {
        status: "passed",
        total: contracts.length,
        passed: contracts.length,
        failed: 0,
        skipped: 0,
        durationMs: 1,
        assertions: contracts.map((contract) => ({
          id: contract.id,
          stepId: contract.stepId,
          status: "passed" as const,
          actual: "created",
          evidenceRefs: ["evidence/assertion.png", "evidence/trace.zip"]
        })),
        steps: evidence.steps.map((step) => ({
          id: step.stepId,
          title: step.instruction,
          status: "passed" as const,
          evidenceRefs: ["evidence/step-04.png"]
        })),
        attachments: ["evidence/trace.zip"],
        consoleErrors: [],
        networkFailures: []
      }
    });

    expect(completed.assuranceLevel).toBe("limited");
    const conformance = repository.conformanceResults.find((item) => item.executionEvidenceId === evidence.id);
    expect(completed.semanticSnapshotHash).toMatch(/^v1:[A-Za-z0-9][A-Za-z0-9._-]{0,63}:[a-f0-9]{64}$/);
    expect(hasValidExecutionEvidenceSnapshot(completed, conformance, integrityAuthenticator)).toBe(true);
    completed.reporterResult!.assertions[0].actual = "forged result";
    expect(hasValidExecutionEvidenceSnapshot(completed, conformance, integrityAuthenticator)).toBe(false);
    expect(repository.conformanceResults).toEqual([
      expect.objectContaining({
        executionEvidenceId: evidence.id,
        verdict: "inconclusive",
        expectationRefs: expect.arrayContaining(executableCase.assertionContracts?.[0].requirementRefs ?? [])
      })
    ]);
    expect(service.listConformanceResults({
      knowledgeProjectId: project.id,
      systemId: "system-conformance"
    })).toHaveLength(1);
  });

  it("estimates Requirement Eval accuracy from traceable historical execution outcomes", async () => {
    const repository = new InMemoryBrainCreatorRepository();
    const service = new KnowledgeService(repository, await tempDir());
    const project = await service.createProject({
      name: "Historical Eval",
      key: "historical-eval",
      defaultLocale: "en-US"
    });
    repository.systemProfiles.push({
      id: "system-history",
      name: "Historical Eval",
      environment: "test",
      baseUrl: "https://history.example.test",
      defaultLocale: "en-US",
      urlAllowlist: ["https://history.example.test"],
      status: "succeeded",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    service.bindSystem(project.id, "system-history");
    const ingested = await service.ingestRequirement({
      projectId: project.id,
      contentPackage: requirementPackage("history", "Users create a customer record.")
    });
    const design = await service.generateTestDesign(ingested.requirementSet.id);
    service.approveRequirementSet(ingested.requirementSet.id);

    const passCase = service.compileExecutableCases(design.testIntents[0].id).executableCase;
    const passEvidence = service.createExecutionEvidence({
      projectId: project.id,
      systemId: "system-history",
      executableCaseId: passCase.id,
      testCaseId: "test-pass",
      contextPackPath: "context/pass.json"
    });
    passEvidence.assertionContracts = [{
      id: "assertion-pass",
      type: "workflow",
      strength: "strong",
      expected: "Customer record created",
      requirementRefs: [ingested.requirementSet.id],
      evidenceRequirements: ["actual-value", "screenshot", "trace"]
    }];
    await service.completeExecutionEvidence(passEvidence.id, {
      status: "passed",
      chainRunId: "chain-pass",
      actualResult: "Customer record created",
      artifactPaths: ["evidence/pass.png", "evidence/pass-trace.zip"],
      tracePaths: ["evidence/pass-trace.zip"],
      reporterResult: {
        status: "passed",
        total: passEvidence.assertionContracts?.length ?? 0,
        passed: passEvidence.assertionContracts?.length ?? 0,
        failed: 0,
        skipped: 0,
        durationMs: 10,
        assertions: [{
          id: "assertion-pass",
          status: "passed" as const,
          actual: "Customer record created",
          evidenceRefs: ["evidence/pass.png", "evidence/pass-trace.zip"]
        }],
        steps: passEvidence.steps.map((step) => ({
          id: step.stepId,
          title: `bc:${step.stepId}`,
          status: "passed" as const,
          evidenceRefs: ["evidence/pass.png"],
          traceRefs: ["evidence/pass-trace.zip"]
        })),
        attachments: ["evidence/pass.png", "evidence/pass-trace.zip"],
        consoleErrors: [],
        networkFailures: []
      }
    });
    expect(repository.executionEvidence.find((item) => item.id === passEvidence.id)?.assuranceLevel).toBe(
      passEvidence.assertionContracts?.length ? "limited" : "none"
    );

    const bugCase = service.compileExecutableCases(design.testIntents[0].id).executableCase;
    const bugEvidence = service.createExecutionEvidence({
      projectId: project.id,
      systemId: "system-history",
      executableCaseId: bugCase.id,
      testCaseId: "test-bug",
      contextPackPath: "context/bug.json"
    });
    await service.completeExecutionEvidence(bugEvidence.id, {
      status: "failed",
      chainRunId: "chain-bug",
      actualResult: "Save returned an error",
      artifactPaths: []
    });
    repository.bugReports.push({
      id: "bug-history",
      systemId: "system-history",
      sourceId: bugCase.id,
      caseNo: bugCase.id,
      caseTitle: bugCase.title,
      module: "Customer",
      priority: "P0",
      expectedResult: "Customer record is created",
      actualResult: "Save returned an error",
      reproductionSteps: [],
      evidencePaths: [],
      chainRunId: "chain-bug",
      gapIds: [],
      status: "open",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    const disputedCase = service.compileExecutableCases(design.testIntents[0].id).executableCase;
    const disputedEvidence = service.createExecutionEvidence({
      projectId: project.id,
      systemId: "system-history",
      executableCaseId: disputedCase.id,
      testCaseId: "test-disputed",
      contextPackPath: "context/disputed.json"
    });
    await service.completeExecutionEvidence(disputedEvidence.id, {
      status: "failed",
      chainRunId: "chain-disputed",
      actualResult: "Observed behavior contradicts the expected workflow",
      artifactPaths: []
    });

    const blockedCase = service.compileExecutableCases(design.testIntents[0].id).executableCase;
    const blockedEvidence = service.createExecutionEvidence({
      projectId: project.id,
      systemId: "system-history",
      executableCaseId: blockedCase.id,
      testCaseId: "test-blocked",
      contextPackPath: "context/blocked.json"
    });
    await service.completeExecutionEvidence(blockedEvidence.id, {
      status: "blocked",
      actualResult: "Environment request failed",
      artifactPaths: [],
      networkFailures: ["GET /customers 503"]
    });

    const unassuredCase = service.compileExecutableCases(design.testIntents[0].id).executableCase;
    const unassuredEvidence = service.createExecutionEvidence({
      projectId: project.id,
      systemId: "system-history",
      executableCaseId: unassuredCase.id,
      testCaseId: "test-unassured",
      contextPackPath: "context/unassured.json"
    });
    await service.completeExecutionEvidence(unassuredEvidence.id, {
      status: "passed",
      actualResult: "The runner completed without structured assertion evidence",
      artifactPaths: []
    });

    expect(service.requirementEvalAccuracy(project.id)).toEqual(
      expect.objectContaining({
        totalEvidence: 5,
        executionPassed: 2,
        strongVerified: 0,
        limitedOrUnassuredPassed: 2,
        validated: 1,
        contradicted: 1,
        inconclusive: 3,
        accuracyRate: 1 / 2,
        systemConformanceRate: 2 / 3,
        strongVerificationRate: 0,
        traceabilityRate: 1
      })
    );
    expect(service.requirementEvalAccuracy(project.id).byRequirementSet).toEqual([
      expect.objectContaining({
        requirementSetId: ingested.requirementSet.id,
        validated: 1,
        contradicted: 1,
        inconclusive: 3,
        strongVerified: 0
      })
    ]);
  });
});

function requirementPackage(contentHash: string, content: string): RequirementContentPackage {
  return {
    title: "Requirement",
    content,
    blocks: [{ type: "paragraph", text: content }],
    attachments: [],
    source: "requirements/requirement.md",
    sourceType: "local-file" as const,
    contentHash,
    warnings: []
  };
}

async function tempDir() {
  const dir = await mkdtemp(join(tmpdir(), "brain-knowledge-"));
  tempDirs.push(dir);
  return dir;
}
