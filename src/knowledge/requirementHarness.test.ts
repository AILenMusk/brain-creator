// @vitest-environment node

import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { HarnessRuntime } from "../brain/harness.js";
import { InMemoryBrainCreatorRepository } from "../domain/repository.js";
import type { AttachmentAnalysis, KnowledgeProject, RequirementSet, RequirementSource } from "../domain/types.js";
import { RequirementGateService } from "../evaluation/requirementGate.js";
import {
  RequirementAnalysisHostHarness,
  type BusinessModelerOutput,
  type ClauseAnalystOutput,
  type CoverageCriticOutput,
  type DocumentMapperOutput
} from "./requirementHarness.js";

describe("RequirementAnalysisHostHarness", () => {
  it("runs mapper, analyst, modeler, and isolated critic as four traceable Brain tasks", async () => {
    const fixture = await createFixture();
    const coordinator = new RequirementAnalysisHostHarness(
      fixture.repository,
      new HarnessRuntime(fixture.repository),
      fixture.knowledgeDir
    );

    const mapper = await coordinator.start(fixture.requirementSet.id);
    expect(mapper).toEqual(expect.objectContaining({
      status: "needs-host-analysis",
      stage: "document-mapper"
    }));
    expect(mapper.task.operation).toBe("requirement-analysis:document-mapper");
    expect(mapper.task.contextPack?.content).toContain("source:req-source#line:1");
    expect(mapper.task.contextPack?.content).toContain("attachment-analysis:attachment-analysis-1");

    const analyst = await coordinator.submit({ taskId: mapper.task.id, output: documentMap() });
    expect(analyst.stage).toBe("clause-analyst");
    expect(analyst.task.sessionId).toBe(mapper.task.sessionId);

    const modeler = await coordinator.submit({ taskId: analyst.task.id, output: clauses() });
    expect(modeler.stage).toBe("business-modeler");

    const critic = await coordinator.submit({ taskId: modeler.task.id, output: businessModels() });
    expect(critic.stage).toBe("coverage-critic");
    expect(critic.task.contextPack?.content).toContain('"workflowModels"');
    expect(critic.task.contextPack?.content).not.toContain("conversationHistory");
    expect(critic.task.contextPack?.content).not.toContain("designerReasoning");

    const completed = await coordinator.submit({ taskId: critic.task.id, output: criticOutput() });
    expect(completed.status).toBe("completed");
    expect(completed.result?.analysis.provider).toBe("host-agent");
    expect(completed.result?.analysis.clauses).toHaveLength(3);
    expect(completed.result?.models.workflowModels).toHaveLength(2);
    expect(completed.result?.models.stateMachineModels).toHaveLength(1);
    expect(completed.result?.models.businessObjectModels[0]).toEqual(expect.objectContaining({
      name: "Order",
      sourceRefs: ["source:req-source#line:1"]
    }));
    expect(completed.result?.evaluation).toEqual(expect.objectContaining({ verdict: "pass" }));
    expect(fixture.repository.brainTasks).toHaveLength(4);
    expect(fixture.repository.brainTasks.every((task) => task.status === "succeeded")).toBe(true);
    expect(new Set(fixture.repository.brainTasks.map((task) => task.id)).size).toBe(4);
  });

  it("allows one structured-output retry and then blocks with a recoverable Gap", async () => {
    const fixture = await createFixture();
    const coordinator = new RequirementAnalysisHostHarness(
      fixture.repository,
      new HarnessRuntime(fixture.repository),
      fixture.knowledgeDir
    );

    const first = await coordinator.start(fixture.requirementSet.id);
    const retry = await coordinator.submit({ taskId: first.task.id, output: { modules: [] } });

    expect(retry).toEqual(expect.objectContaining({
      status: "needs-host-analysis",
      stage: "document-mapper",
      retry: true
    }));
    expect(retry.task.id).not.toBe(first.task.id);
    expect(fixture.repository.brainTasks).toHaveLength(2);

    const blocked = await coordinator.submit({ taskId: retry.task.id, output: { modules: [] } });
    expect(blocked.status).toBe("blocked");
    expect(blocked.gap).toEqual(expect.objectContaining({
      sourceType: "requirement-host-harness",
      sourceId: fixture.requirementSet.id,
      status: "open"
    }));
    expect(blocked.gap?.reason).toContain("document-mapper");
    expect(fixture.repository.gaps).toContainEqual(blocked.gap);
  });

  it("rejects fabricated source line references even when they use the correct source prefix", async () => {
    const fixture = await createFixture();
    const coordinator = new RequirementAnalysisHostHarness(
      fixture.repository,
      new HarnessRuntime(fixture.repository),
      fixture.knowledgeDir,
      new RequirementGateService(fixture.repository)
    );

    const mapper = await coordinator.start(fixture.requirementSet.id);
    const response = await coordinator.submit({
      taskId: mapper.task.id,
      output: { ...documentMap(), sourceRefs: ["source:req-source#line:999"] }
    });

    expect(response).toEqual(expect.objectContaining({
      status: "needs-host-analysis",
      stage: "document-mapper",
      retry: true
    }));
    expect(fixture.repository.stageEvalRecords).toContainEqual(expect.objectContaining({
      evaluator: "schema-validator",
      reasons: ["Unsupported sourceRef: source:req-source#line:999"]
    }));
  });

  it("keeps the current stage resumable when the next-stage context exceeds budget", async () => {
    const fixture = await createFixture();
    const coordinator = new RequirementAnalysisHostHarness(
      fixture.repository,
      new HarnessRuntime(fixture.repository),
      fixture.knowledgeDir
    );
    const mapper = await coordinator.start(fixture.requirementSet.id);
    const originalAttachmentMarkdown = fixture.repository.attachmentAnalyses[0]!.markdown;
    fixture.repository.attachmentAnalyses[0]!.markdown = "x".repeat(50_000);

    await expect(coordinator.submit({ taskId: mapper.task.id, output: documentMap() }))
      .rejects.toThrow("Structured requirement context exceeds the Harness budget");
    expect(fixture.repository.brainTasks).toHaveLength(1);
    expect(fixture.repository.brainTasks[0]).toEqual(expect.objectContaining({
      id: mapper.task.id,
      state: "waiting-provider",
      outputRefs: []
    }));

    fixture.repository.attachmentAnalyses[0]!.markdown = originalAttachmentMarkdown;
    const recovered = await coordinator.submit({ taskId: mapper.task.id, output: documentMap() });
    expect(recovered).toEqual(expect.objectContaining({
      status: "needs-host-analysis",
      stage: "clause-analyst"
    }));
    expect(fixture.repository.brainTasks).toHaveLength(2);
    expect(fixture.repository.brainTasks[0]).toEqual(expect.objectContaining({
      id: mapper.task.id,
      state: "completed",
      status: "succeeded"
    }));
  });

  it("blocks completeness when a critical process image has not been confirmed", async () => {
    const fixture = await createFixture({ attachmentStatus: "downloaded", includeAnalysis: false });
    const coordinator = new RequirementAnalysisHostHarness(
      fixture.repository,
      new HarnessRuntime(fixture.repository),
      fixture.knowledgeDir
    );

    let next = await coordinator.start(fixture.requirementSet.id);
    next = await coordinator.submit({ taskId: next.task.id, output: documentMap() });
    next = await coordinator.submit({ taskId: next.task.id, output: clauses() });
    next = await coordinator.submit({ taskId: next.task.id, output: businessModels() });
    const completed = await coordinator.submit({ taskId: next.task.id, output: criticOutput() });

    expect(completed.status).toBe("blocked");
    expect(completed.result?.evaluation).toEqual(expect.objectContaining({ verdict: "blocked" }));
    expect(completed.result?.evaluation.reasons).toEqual([
      expect.stringContaining("critical process attachment")
    ]);
    expect(completed.task.state).toBe("blocked");
  });

  it("truncates cold source text without dropping traceable source references", async () => {
    const fixture = await createFixture();
    fixture.repository.requirementSources[0].content = Array.from(
      { length: 200 },
      (_, index) => `Requirement line ${index + 1}: ${"x".repeat(500)}`
    ).join("\n");
    const coordinator = new RequirementAnalysisHostHarness(
      fixture.repository,
      new HarnessRuntime(fixture.repository),
      fixture.knowledgeDir
    );

    const mapper = await coordinator.start(fixture.requirementSet.id);
    expect(mapper.task.contextPack).toEqual(expect.objectContaining({ truncated: true }));
    expect(mapper.task.contextPack!.estimatedChars).toBeLessThanOrEqual(50_000);
    expect(mapper.task.contextPack!.references).toContainEqual(expect.objectContaining({
      ref: "source:req-source#line:200"
    }));
  });

  it("keeps a large document block AST within budget without dropping block anchors", async () => {
    const fixture = await createFixture();
    fixture.repository.requirementSources[0].blocks = Array.from({ length: 240 }, (_, index) => ({
      id: `block-${index + 1}`,
      type: index % 3 === 0 ? "table" : "paragraph",
      text: `Long block ${index + 1}: ${"x".repeat(900)}`,
      level: index % 4,
      order: index + 1,
      sourceRef: `source:req-source#block:${"x".repeat(60)}${index + 1}`,
      sourceRefs: [`source:req-source#block:${index + 1}`],
      table: index % 3 === 0
        ? {
            headers: ["条件", "结果"],
            rows: Array.from({ length: 40 }, (_, row) => ["condition", `${row} ${"y".repeat(200)}`])
          }
        : undefined
    }));
    const coordinator = new RequirementAnalysisHostHarness(
      fixture.repository,
      new HarnessRuntime(fixture.repository),
      fixture.knowledgeDir
    );

    const mapper = await coordinator.start(fixture.requirementSet.id);

    expect(mapper.task.contextPack!.estimatedChars).toBeLessThanOrEqual(50_000);
    expect(mapper.task.contextPack!.content).toContain("sourceRef");
    expect(mapper.task.contextPack!.content).toContain(`"sourceRefPrefix":"source:req-source#block:${"x".repeat(60)}"`);
    expect(mapper.task.contextPack!.content).toContain('"sourceRef":"1"');
    expect(mapper.task.contextPack!.content).not.toContain("xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx");
    expect(mapper.task.contextPack!.references).toContainEqual(expect.objectContaining({
      ref: "source:req-source#line:1"
    }));
  });

  it("keeps later harness stages within budget after structured output is added", async () => {
    const fixture = await createFixture();
    fixture.repository.attachmentAnalyses[0]!.markdown = "Confirmed attachment flow facts. ".repeat(120);
    fixture.repository.requirementSources[0].content = Array.from(
      { length: 180 },
      (_, index) => `Requirement line ${index + 1}: ${"x".repeat(500)}`
    ).join("\n");
    const coordinator = new RequirementAnalysisHostHarness(
      fixture.repository,
      new HarnessRuntime(fixture.repository),
      fixture.knowledgeDir
    );

    const mapper = await coordinator.start(fixture.requirementSet.id);
    const analystOutput = {
      module: "Orders",
      clauses: Array.from({ length: 40 }, (_, index) => ({
        id: `clause-${index + 1}`,
        index: index + 1,
        text: `${"long clause ".repeat(80)} ${index + 1}`,
        sourceRefs: [`source:req-source#line:${(index % 180) + 1}`],
        module: "Orders",
        kind: "rule" as const,
        origin: "explicit" as const,
        confidence: 0.9,
        status: "draft" as const,
        nodeTypes: ["rule" as const]
      })),
      openQuestions: []
    };
    const analyst = await coordinator.submit({ taskId: mapper.task.id, output: documentMap() });
    expect(analyst.stage).toBe("clause-analyst");
    expect(analyst.task.contextPack!.estimatedChars).toBeLessThanOrEqual(50_000);
    expect(analyst.task.contextPack!.content).toContain('"omittedAfterDocumentMapping":true');
    expect(analyst.task.contextPack!.content).not.toContain('"id":"block-1"');
    expect(analyst.task.contextPack!.content).toContain("Requirement line 180:");
    expect(analyst.task.contextPack!.content).toContain("source lines excerpted; full requirement remains pinned by references");
    expect(analyst.task.contextPack!.references).toContainEqual(expect.objectContaining({
      ref: "source:req-source#line:180"
    }));
    const modeler = await coordinator.submit({ taskId: analyst.task.id, output: analystOutput });

    expect(modeler.stage).toBe("business-modeler");
    expect(modeler.task.contextPack!.estimatedChars).toBeLessThanOrEqual(50_000);
    expect(modeler.task.contextPack!.content).toContain("clause-1");
    expect(modeler.task.contextPack!.content).toContain("source:req-source#line:1");
    expect(modeler.task.contextPack!.content).toContain("Requirement line 40:");
    expect(modeler.task.contextPack!.content).not.toContain("Requirement line 41:");
    expect(modeler.task.contextPack!.content).toContain("source line excerpt; full requirement remains pinned by reference");
    expect(modeler.task.contextPack!.references).toContainEqual(expect.objectContaining({
      ref: "source:req-source#line:41"
    }));
  });

  it("keeps the frozen source and confirmed attachments within budget for a large document", async () => {
    const fixture = await createFixture();
    fixture.repository.requirementSources[0].content = Array.from(
      { length: 211 },
      (_, index) => `Requirement line ${index + 1}: ${"source text ".repeat(4)}`
    ).join("\n");
    const blockTypes = [
      ...Array.from({ length: 28 }, () => "heading"),
      ...Array.from({ length: 12 }, () => "list-item"),
      ...Array.from({ length: 56 }, () => "paragraph"),
      ...Array.from({ length: 34 }, () => "table-row")
    ];
    fixture.repository.requirementSources[0].blocks = blockTypes.map((type, index) => ({
      id: `block-${"x".repeat(12)}${index + 1}`,
      type,
      text: `Block ${index + 1} content`,
      level: index % 3,
      order: index + 1,
      sourceRef: `source:req-source#block:${"x".repeat(60)}${index + 1}`
    }));
    const attachmentMarkdownLengths = [1173, 7608, 5938, 1905, 1954];
    fixture.repository.attachmentAnalyses = attachmentMarkdownLengths.map((length, index) => ({
      ...attachmentAnalysis("2026-08-30T00:00:00.000Z"),
      id: `attachment-analysis-${index + 1}`,
      attachmentId: `attachment-${index + 1}`,
      kind: index === 4 ? "flowchart" : "table",
      markdown: "x".repeat(length),
      nodes: index === 4
        ? Array.from({ length: 22 }, (_, nodeIndex) => ({ id: `node-${nodeIndex + 1}`, type: "action", label: `Action ${nodeIndex + 1}` }))
        : [],
      edges: index === 4
        ? Array.from({ length: 30 }, (_, edgeIndex) => ({ from: `node-${edgeIndex + 1}`, to: `node-${edgeIndex + 2}` }))
        : [],
      sourceRefs: [`attachment:attachment-${index + 1}`]
    }));
    fixture.repository.requirementSources[0].attachments = attachmentMarkdownLengths.map((_, index) => ({
      id: `attachment-${index + 1}`,
      sourceId: "req-source",
      name: `source-${index + 1}.xlsx`,
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      status: "confirmed"
    }));
    const coordinator = new RequirementAnalysisHostHarness(
      fixture.repository,
      new HarnessRuntime(fixture.repository),
      fixture.knowledgeDir
    );

    const mapper = await coordinator.start(fixture.requirementSet.id);

    expect(mapper.task.contextPack!.estimatedChars).toBeLessThanOrEqual(50_000);
    expect(mapper.task.contextPack!.references).toContainEqual(expect.objectContaining({
      ref: "source:req-source#line:211"
    }));
    expect(mapper.task.contextPack!.references).toContainEqual(expect.objectContaining({
      ref: `source:req-source#block:${"x".repeat(60)}130`
    }));
    expect(mapper.task.contextPack!.content).toContain("attachment-analysis-5");
    expect(mapper.task.contextPack!.content).toMatch(/Source line labels L<n> map to source:req-source#line:<n>|source:req-source#line:211/);
  });

  it("uses a verified complete source file when thousands of line anchors cannot fit inline", async () => {
    const fixture = await createFixture();
    const source = fixture.repository.requirementSources[0];
    source.content = Array.from({ length: 2331 }, (_, index) =>
      `Requirement line ${index + 1}: ${"business rule ".repeat(2)}`
    ).join("\n");
    fixture.repository.attachmentAnalyses[0]!.markdown = "Confirmed attachment facts. ".repeat(1100);
    const sourceFile = join(fixture.knowledgeDir, "orders", "requirements", fixture.requirementSet.id, "source.md");
    await mkdir(join(fixture.knowledgeDir, "orders", "requirements", fixture.requirementSet.id), { recursive: true });
    await writeFile(sourceFile, `---\nsource_id: req-source\n---\n\n# Order approval\n\n${source.content}`, "utf8");
    const coordinator = new RequirementAnalysisHostHarness(
      fixture.repository,
      new HarnessRuntime(fixture.repository),
      fixture.knowledgeDir
    );

    const mapper = await coordinator.start(fixture.requirementSet.id);

    expect(mapper.task.contextPack!.estimatedChars).toBeLessThanOrEqual(50_000);
    expect(mapper.task.contextPack!.truncated).toBe(true);
    expect(mapper.task.contextPack!.content).toContain(JSON.stringify(sourceFile));
    expect(mapper.task.contextPack!.content).toContain("Source body SHA-256:");
    expect(mapper.task.contextPack!.content).toContain("contains 2331 lines");
    expect(mapper.task.contextPack!.references).toContainEqual(expect.objectContaining({
      ref: "source:req-source#line:2331"
    }));
  });

  it("uses the same verified source file for cited lines in later analysis stages", async () => {
    const fixture = await createFixture();
    const source = fixture.repository.requirementSources[0];
    source.content = Array.from({ length: 2331 }, (_, index) =>
      `Requirement line ${index + 1}: ${"business rule ".repeat(35)}`
    ).join("\n");
    fixture.repository.attachmentAnalyses[0]!.markdown = "Confirmed attachment facts. ".repeat(1100);
    const sourceDirectory = join(fixture.knowledgeDir, "orders", "requirements", fixture.requirementSet.id);
    await mkdir(sourceDirectory, { recursive: true });
    await writeFile(join(sourceDirectory, "source.md"), `---\nsource_id: req-source\n---\n\n# Order approval\n\n${source.content}`, "utf8");
    const coordinator = new RequirementAnalysisHostHarness(
      fixture.repository,
      new HarnessRuntime(fixture.repository),
      fixture.knowledgeDir
    );

    const mapper = await coordinator.start(fixture.requirementSet.id);
    const analyst = await coordinator.submit({ taskId: mapper.task.id, output: documentMap() });
    const output: ClauseAnalystOutput = {
      module: "Orders",
      clauses: Array.from({ length: 60 }, (_, index) => ({
        id: `clause-${index + 1}`,
        index: index + 1,
        text: `Requirement line ${index + 1} must be verified`,
        sourceRefs: [`source:req-source#line:${index + 1}`],
        module: "Orders",
        kind: "rule",
        origin: "explicit",
        confidence: 0.9,
        status: "draft",
        nodeTypes: ["rule"]
      })),
      openQuestions: []
    };

    const modeler = await coordinator.submit({ taskId: analyst.task.id, output });

    expect(modeler.stage).toBe("business-modeler");
    expect(modeler.task.contextPack!.estimatedChars).toBeLessThanOrEqual(50_000);
    expect(modeler.task.contextPack!.content).toContain("Complete frozen requirement source is in the verified local file");
    expect(modeler.task.contextPack!.references).toContainEqual(expect.objectContaining({
      ref: "source:req-source#line:2331"
    }));
  });

  it("rejects host output if a referenced source file changes after the task starts", async () => {
    const fixture = await createFixture();
    const source = fixture.repository.requirementSources[0];
    source.content = Array.from({ length: 2331 }, (_, index) => `Rule ${index + 1}: ${"x".repeat(40)}`).join("\n");
    fixture.repository.attachmentAnalyses[0]!.markdown = "Confirmed attachment facts. ".repeat(1100);
    const directory = join(fixture.knowledgeDir, "orders", "requirements", fixture.requirementSet.id);
    await mkdir(directory, { recursive: true });
    const path = join(directory, "source.md");
    await writeFile(path, `---\nsource_id: req-source\n---\n\n# Order approval\n\n${source.content}`, "utf8");
    const coordinator = new RequirementAnalysisHostHarness(
      fixture.repository,
      new HarnessRuntime(fixture.repository),
      fixture.knowledgeDir
    );
    const mapper = await coordinator.start(fixture.requirementSet.id);
    expect(mapper.task.contextPack!.references.some((item) => item.ref.startsWith("source-snapshot:req-source:sha256:"))).toBe(true);
    await writeFile(path, "---\nsource_id: req-source\n---\n\n# Order approval\n\nChanged", "utf8");

    await expect(coordinator.submit({ taskId: mapper.task.id, output: documentMap() })).rejects.toThrow(
      "Frozen requirement source file differs from the current RequirementSet content"
    );
    source.content = "Changed together with the source file";
    await writeFile(path, `---\nsource_id: req-source\n---\n\n# Order approval\n\n${source.content}`, "utf8");
    await expect(coordinator.submit({ taskId: mapper.task.id, output: documentMap() })).rejects.toThrow(
      "Frozen requirement source snapshot changed or is unavailable"
    );
    expect(fixture.repository.brainTasks).toHaveLength(1);
    expect(fixture.repository.brainTasks[0].state).toBe("waiting-provider");
  });

  it("rejects host output if the frozen source body shifts to a different file line offset", async () => {
    const fixture = await createFixture();
    const source = fixture.repository.requirementSources[0];
    source.content = Array.from({ length: 2331 }, (_, index) => `Rule ${index + 1}: ${"x".repeat(40)}`).join("\n");
    fixture.repository.attachmentAnalyses[0]!.markdown = "Confirmed attachment facts. ".repeat(1100);
    const directory = join(fixture.knowledgeDir, "orders", "requirements", fixture.requirementSet.id);
    await mkdir(directory, { recursive: true });
    const path = join(directory, "source.md");
    const prefix = "---\nsource_id: req-source\n---\n\n# Order approval\n\n";
    await writeFile(path, `${prefix}${source.content}`, "utf8");
    const coordinator = new RequirementAnalysisHostHarness(
      fixture.repository,
      new HarnessRuntime(fixture.repository),
      fixture.knowledgeDir
    );
    const mapper = await coordinator.start(fixture.requirementSet.id);
    expect(mapper.task.contextPack!.references.some((item) => item.ref.includes(":line-offset:"))).toBe(true);

    await writeFile(path, `---\nsource_id: req-source\n---\n\n# Added metadata line\n\n# Order approval\n\n${source.content}`, "utf8");

    await expect(coordinator.submit({ taskId: mapper.task.id, output: documentMap() })).rejects.toThrow(
      "Frozen requirement source snapshot changed or is unavailable"
    );
    expect(fixture.repository.brainTasks).toHaveLength(1);
    expect(fixture.repository.brainTasks[0].state).toBe("waiting-provider");
  });

  it("pins complete structured stage outputs when they cannot fit with confirmed attachments", async () => {
    const fixture = await createFixture();
    const source = fixture.repository.requirementSources[0];
    source.content = Array.from({ length: 2331 }, (_, index) => `Rule ${index + 1}: ${"x".repeat(40)}`).join("\n");
    fixture.repository.attachmentAnalyses[0]!.markdown = "Confirmed attachment facts. ".repeat(1600);
    const directory = join(fixture.knowledgeDir, "orders", "requirements", fixture.requirementSet.id);
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, "source.md"), `---\nsource_id: req-source\n---\n\n# Order approval\n\n${source.content}`, "utf8");
    const coordinator = new RequirementAnalysisHostHarness(
      fixture.repository,
      new HarnessRuntime(fixture.repository),
      fixture.knowledgeDir
    );
    const mapper = await coordinator.start(fixture.requirementSet.id);
    const analyst = await coordinator.submit({ taskId: mapper.task.id, output: documentMap() });
    const output: ClauseAnalystOutput = {
      module: "Orders",
      clauses: Array.from({ length: 60 }, (_, index) => ({
        id: `clause-${index + 1}`,
        index: index + 1,
        text: `Rule ${index + 1} must be verified ${"detail ".repeat(10)}`,
        sourceRefs: [`source:req-source#line:${index + 1}`],
        module: "Orders",
        kind: "rule",
        origin: "explicit",
        confidence: 0.9,
        status: "draft",
        nodeTypes: ["rule"]
      })),
      openQuestions: []
    };
    const modeler = await coordinator.submit({ taskId: analyst.task.id, output });
    expect(modeler.task.contextPack!.estimatedChars).toBeLessThanOrEqual(50_000);
    expect(modeler.task.contextPack!.content).toContain("Complete structured stage outputs are in the verified local file");
    const ref = modeler.task.contextPack!.references.find((item) => item.ref.startsWith("structured-output-snapshot:sha256:"))!.ref;
    const sha256 = ref.slice("structured-output-snapshot:sha256:".length);
    const snapshotPath = join(directory, "host-harness", modeler.task.sessionId!, `structured-${sha256}.json`);
    const original = await readFile(snapshotPath, "utf8");
    await writeFile(snapshotPath, "{}", "utf8");
    await expect(coordinator.submit({ taskId: modeler.task.id, output: businessModels() })).rejects.toThrow(
      "Structured requirement output snapshot changed or is unavailable"
    );
    await writeFile(snapshotPath, original, "utf8");
    await writeFile(analyst.task.outputRefs[0], JSON.stringify({ ...output, openQuestions: ["changed after snapshot"] }), "utf8");
    await expect(coordinator.submit({ taskId: modeler.task.id, output: businessModels() })).rejects.toThrow(
      "Structured requirement output snapshot changed or is unavailable"
    );
    expect(modeler.task.state).toBe("waiting-provider");
  });

  it("pins earlier stage output even when it fits inline", async () => {
    const fixture = await createFixture();
    const coordinator = new RequirementAnalysisHostHarness(fixture.repository, new HarnessRuntime(fixture.repository), fixture.knowledgeDir);
    const mapper = await coordinator.start(fixture.requirementSet.id);
    const analyst = await coordinator.submit({ taskId: mapper.task.id, output: documentMap() });
    expect(analyst.task.contextPack!.content).toContain('"documentMap"');
    expect(analyst.task.contextPack!.references.some((item) => item.ref.startsWith("structured-output-snapshot:sha256:"))).toBe(true);
    await writeFile(mapper.task.outputRefs[0], JSON.stringify({ ...documentMap(), modules: ["Changed"] }), "utf8");
    await expect(coordinator.submit({ taskId: analyst.task.id, output: clauses() })).rejects.toThrow(
      "Structured requirement output snapshot changed or is unavailable"
    );
  });

  it("refuses a source file that differs from the frozen RequirementSet content", async () => {
    const fixture = await createFixture();
    const sourceFile = join(fixture.knowledgeDir, "orders", "requirements", fixture.requirementSet.id, "source.md");
    await mkdir(join(fixture.knowledgeDir, "orders", "requirements", fixture.requirementSet.id), { recursive: true });
    await writeFile(sourceFile, "---\nsource_id: req-source\n---\n\n# Order approval\n\nTampered content", "utf8");
    const coordinator = new RequirementAnalysisHostHarness(
      fixture.repository,
      new HarnessRuntime(fixture.repository),
      fixture.knowledgeDir
    );

    await expect(coordinator.start(fixture.requirementSet.id)).rejects.toThrow(
      "Frozen requirement source file differs from the current RequirementSet content"
    );
    expect(fixture.repository.brainTasks).toHaveLength(0);
  });

  it("pins the source even when its text fits inline", async () => {
    const fixture = await createFixture();
    const directory = join(fixture.knowledgeDir, "orders", "requirements", fixture.requirementSet.id);
    const source = fixture.repository.requirementSources[0];
    await mkdir(directory, { recursive: true });
    const path = join(directory, "source.md");
    await writeFile(path, `# Order approval\n\n${source.content}`, "utf8");
    const coordinator = new RequirementAnalysisHostHarness(fixture.repository, new HarnessRuntime(fixture.repository), fixture.knowledgeDir);
    const task = await coordinator.start(fixture.requirementSet.id);
    expect(task.task.contextPack!.content).toContain("A requester creates an order");
    expect(task.task.contextPack!.references.some((item) => item.ref.startsWith("source-snapshot:req-source:sha256:"))).toBe(true);
    await writeFile(path, "# Order approval\n\nChanged", "utf8");
    await expect(coordinator.submit({ taskId: task.task.id, output: documentMap() })).rejects.toThrow(
      "Frozen requirement source file differs from the current RequirementSet content"
    );
  });

  it("fits the independent Critic context while retaining full source references", async () => {
    const fixture = await createFixture();
    fixture.repository.requirementSources[0].content = Array.from(
      { length: 211 },
      (_, index) => `Requirement line ${index + 1}: ${"source text ".repeat(4)}`
    ).join("\n");
    fixture.repository.requirementSources[0].blocks = Array.from({ length: 130 }, (_, index) => ({
      id: `block-${"x".repeat(12)}${index + 1}`,
      type: index < 28 ? "heading" : index < 40 ? "list-item" : index < 96 ? "paragraph" : "table-row",
      text: `Block ${index + 1} content`,
      level: index % 3,
      order: index + 1,
      sourceRef: `source:req-source#block:${"x".repeat(60)}${index + 1}`
    }));
    const attachmentMarkdownLengths = [1173, 7608, 5938, 1905, 1954];
    fixture.repository.attachmentAnalyses = attachmentMarkdownLengths.map((length, index) => ({
      ...attachmentAnalysis("2026-08-30T00:00:00.000Z"),
      id: `attachment-analysis-${index + 1}`,
      attachmentId: `attachment-${index + 1}`,
      kind: index === 4 ? "flowchart" : "table",
      markdown: "x".repeat(length),
      nodes: index === 4
        ? Array.from({ length: 22 }, (_, nodeIndex) => ({ id: `node-${nodeIndex + 1}`, type: "action", label: `Action ${nodeIndex + 1}` }))
        : [],
      edges: index === 4
        ? Array.from({ length: 30 }, (_, edgeIndex) => ({ from: `node-${edgeIndex + 1}`, to: `node-${edgeIndex + 2}` }))
        : [],
      sourceRefs: [`attachment:attachment-${index + 1}`]
    }));
    fixture.repository.requirementSources[0].attachments = attachmentMarkdownLengths.map((_, index) => ({
      id: `attachment-${index + 1}`,
      sourceId: "req-source",
      name: `source-${index + 1}.xlsx`,
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      status: "confirmed"
    }));
    const coordinator = new RequirementAnalysisHostHarness(
      fixture.repository,
      new HarnessRuntime(fixture.repository),
      fixture.knowledgeDir
    );

    let next = await coordinator.start(fixture.requirementSet.id);
    next = await coordinator.submit({ taskId: next.task.id, output: documentMap() });
    const clauseOutput = clauses();
    clauseOutput.clauses = Array.from({ length: 15 }, (_, index) => ({
      ...clauses().clauses[index % clauses().clauses.length]!,
      id: `clause-${index + 1}`,
      index: index + 1,
      text: `Source-backed clause ${index + 1}: ${"explicit requirement detail ".repeat(5)}`,
      sourceRefs: [`source:req-source#line:${index + 1}`, `source:req-source#line:${index + 2}`]
    }));
    next = await coordinator.submit({ taskId: next.task.id, output: clauseOutput });
    const modelOutput = businessModels();
    modelOutput.invariants = Array.from({ length: 5 }, (_, index) => `Invariant ${index + 1}: ${"preserve source-backed business behavior ".repeat(4)}`);
    modelOutput.decisionTableModels = Array.from({ length: 4 }, (_, tableIndex) => ({
      localId: `decision-${tableIndex + 1}`,
      title: `Decision table ${tableIndex + 1}`,
      conditions: ["condition A", "condition B", "condition C"],
      actions: ["action A", "action B"],
      rules: Array.from({ length: 20 }, (_, ruleIndex) => ({
        conditionValues: { conditionA: `${ruleIndex % 2 === 0}`, conditionB: `${ruleIndex % 3 === 0}` },
        expectedActions: [`Apply source-backed action ${ruleIndex + 1}`],
        sourceRefs: ["source:req-source#line:1", "source:req-source#line:2", "source:req-source#line:3"]
      })),
      sourceRefs: ["source:req-source#line:1", "source:req-source#line:2", "source:req-source#line:3"]
    }));

    const critic = await coordinator.submit({ taskId: next.task.id, output: modelOutput });

    expect(critic.stage).toBe("coverage-critic");
    expect(critic.task.contextPack!.estimatedChars).toBeLessThanOrEqual(50_000);
    expect(critic.task.contextPack!.content).toContain("Structured source reference encoding");
    expect(critic.task.contextPack!.content).toContain('"sourceRefs":["#line:1"');
    expect(critic.task.contextPack!.references).toContainEqual(expect.objectContaining({
      ref: "source:req-source#line:211"
    }));
  });
});

async function createFixture(options: { attachmentStatus?: "downloaded" | "confirmed"; includeAnalysis?: boolean } = {}) {
  const repository = new InMemoryBrainCreatorRepository();
  const knowledgeDir = await mkdtemp(join(tmpdir(), "brain-creator-requirement-harness-"));
  const now = "2026-08-30T00:00:00.000Z";
  const project: KnowledgeProject = {
    id: "project-1",
    key: "orders",
    name: "Orders",
    defaultLocale: "en-US",
    status: "active",
    systemIds: [],
    createdAt: now,
    updatedAt: now
  };
  const source: RequirementSource = {
    id: "req-source",
    knowledgeProjectId: project.id,
    source: "requirements.md",
    sourceType: "local-file",
    title: "Order approval",
    contentHash: "hash-1",
    content: "A requester creates an order. A manager approves it. The approved order becomes active.",
    blocks: [],
    attachments: [{
      id: "attachment-1",
      sourceId: "req-source",
      name: "order-state.png",
      mimeType: "image/png",
      status: options.attachmentStatus ?? "confirmed"
    }],
    warnings: [],
    accessStatus: "available",
    revision: 1,
    latestRequirementSetId: "requirement-1",
    createdAt: now,
    updatedAt: now
  };
  const requirementSet: RequirementSet = {
    id: "requirement-1",
    knowledgeProjectId: project.id,
    sourceId: source.id,
    version: 1,
    title: source.title,
    summary: "Order approval",
    contentHash: source.contentHash,
    status: "draft",
    affectedNodeIds: [],
    createdAt: now,
    updatedAt: now
  };
  repository.knowledgeProjects.push(project);
  repository.requirementSources.push(source);
  repository.requirementSets.push(requirementSet);
  if (options.includeAnalysis !== false) repository.attachmentAnalyses.push(attachmentAnalysis(now));
  return { repository, knowledgeDir, requirementSet };
}

function attachmentAnalysis(now: string): AttachmentAnalysis {
  return {
    id: "attachment-analysis-1",
    knowledgeProjectId: "project-1",
    requirementSetId: "requirement-1",
    sourceId: "req-source",
    attachmentId: "attachment-1",
    kind: "flowchart",
    markdown: "Requester creates an order, then a manager approves it.",
    nodes: [
      { id: "visual-create", type: "action", label: "Create" },
      { id: "visual-approve", type: "action", label: "Approve" }
    ],
    edges: [{ from: "visual-create", to: "visual-approve", actor: "manager" }],
    confidence: 0.96,
    sourceRefs: ["attachment:attachment-1"],
    provider: "host-agent",
    status: "confirmed",
    createdAt: now,
    updatedAt: now,
    confirmedAt: now,
    confirmedBy: "tester"
  };
}

function documentMap(): DocumentMapperOutput {
  return {
    goals: ["Approve valid orders"],
    scope: ["Order creation and approval"],
    modules: ["Orders"],
    actors: ["requester", "manager"],
    businessObjects: ["Order"],
    attachmentRefs: ["attachment-analysis:attachment-analysis-1"],
    risks: ["Approval can be bypassed"],
    sourceRefs: ["source:req-source#line:1"]
  };
}

function clauses(): ClauseAnalystOutput {
  return {
    module: "Orders",
    clauses: [
      {
        id: "clause-create",
        index: 1,
        text: "A requester creates an order.",
        sourceRefs: ["source:req-source#line:1"],
        module: "Orders",
        kind: "workflow",
        origin: "explicit",
        confidence: 1,
        status: "draft",
        nodeTypes: ["workflow", "actor", "object"]
      },
      {
        id: "clause-approve",
        index: 2,
        text: "A manager approves the order.",
        sourceRefs: ["source:req-source#line:1"],
        module: "Orders",
        kind: "workflow",
        origin: "explicit",
        confidence: 1,
        status: "draft",
        nodeTypes: ["workflow", "actor", "object"]
      },
      {
        id: "clause-active",
        index: 3,
        text: "The approved order becomes active.",
        sourceRefs: ["source:req-source#line:1"],
        module: "Orders",
        kind: "state",
        origin: "explicit",
        confidence: 1,
        status: "draft",
        nodeTypes: ["state", "rule"]
      }
    ],
    openQuestions: []
  };
}

function businessModels(): BusinessModelerOutput {
  return {
    businessObjectModels: [{
      localId: "order",
      name: "Order",
      actors: ["requester", "manager"],
      fields: [],
      states: ["draft", "pending", "active"],
      invariants: ["Only an approved order becomes active"],
      sourceRefs: ["source:req-source#line:1"]
    }],
    workflowModels: [{
      localId: "order-approval",
      title: "Order approval",
      actors: ["requester", "manager"],
      steps: [
        { id: "create", label: "Create order", actor: "requester", sourceRefs: ["source:req-source#line:1"] },
        { id: "approve", label: "Approve order", actor: "manager", sourceRefs: ["source:req-source#line:1"] }
      ],
      transitions: [{
        id: "create-to-approve",
        from: "create",
        to: "approve",
        actor: "manager",
        businessObject: "Order",
        sourceRefs: ["source:req-source#line:1"]
      }],
      startStepIds: ["create"],
      endStepIds: ["approve"],
      sourceRefs: ["source:req-source#line:1"],
      confidence: 0.95
    }],
    stateMachineModels: [{
      localId: "order-state",
      title: "Order state",
      states: [
        { id: "pending", label: "Pending", initial: true, terminal: false, sourceRefs: ["source:req-source#line:1"] },
        { id: "active", label: "Active", initial: false, terminal: true, sourceRefs: ["source:req-source#line:1"] }
      ],
      transitions: [{
        id: "approve",
        from: "pending",
        to: "active",
        trigger: "Approve",
        actor: "manager",
        validity: "legal",
        sourceRefs: ["source:req-source#line:1"]
      }],
      sourceRefs: ["source:req-source#line:1"],
      confidence: 0.95
    }],
    decisionTableModels: [{
      localId: "approval-rule",
      title: "Approval outcome",
      conditions: ["Manager approves"],
      actions: ["Order becomes active"],
      rules: [{
        conditionValues: { "Manager approves": "yes" },
        expectedActions: ["Order becomes active"],
        sourceRefs: ["source:req-source#line:1"]
      }],
      sourceRefs: ["source:req-source#line:1"]
    }],
    invariants: ["Only an approved order becomes active"]
  };
}

function criticOutput(): CoverageCriticOutput {
  return {
    verdict: "pass",
    score: 0.96,
    reasons: [],
    missingMainFlows: [],
    missingBranches: [],
    missingExceptions: [],
    missingActors: [],
    missingEndStates: [],
    contradictions: [],
    unsupportedInferences: [],
    requiredActions: [],
    evidenceRefs: ["source:req-source#line:1"]
  };
}
