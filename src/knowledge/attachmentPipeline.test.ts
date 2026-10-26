// @vitest-environment node

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import AdmZip from "adm-zip";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InMemoryBrainCreatorRepository } from "../domain/repository.js";
import { KnowledgeService } from "./service.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("requirement attachment pipeline", () => {
  it("downloads and recognizes an attachment before it can create a Gap", async () => {
    const root = await tempDir();
    const imagePath = join(root, "flow.png");
    await writeFile(imagePath, Buffer.from("image"));
    const repository = new InMemoryBrainCreatorRepository();
    const service = new KnowledgeService(repository, join(root, "knowledge"));
    const project = await service.createProject({ name: "Order", key: "order", defaultLocale: "en-US" });
    const ingested = await service.ingestRequirement({
      projectId: project.id,
      contentPackage: {
        title: "Order flow",
        content: "Orders require approval.",
        blocks: [{ type: "paragraph", text: "Orders require approval." }],
        attachments: [{ name: "flow.png", url: imagePath }],
        source: join(root, "requirement.md"),
        sourceType: "local-file",
        contentHash: "attachment-hash",
        warnings: []
      }
    });

    expect(repository.gaps).toEqual([]);
    expect(ingested.source.attachments[0]).toEqual(
      expect.objectContaining({ status: "discovered", attempts: 0, sourceId: ingested.source.id })
    );

    const prepared = await service.prepareRequirementAttachments({
      sourceId: ingested.source.id,
      analyzer: async () => ({
        kind: "state-machine",
        markdown: "Draft -> Approved",
        nodes: [
          { id: "draft", type: "state", label: "Draft" },
          { id: "approved", type: "state", label: "Approved" }
        ],
        edges: [{ from: "draft", to: "approved", condition: "approve", actor: "manager" }],
        confidence: 0.94
      })
    });

    expect(prepared.gaps).toEqual([]);
    expect(prepared.analyses).toEqual([
      expect.objectContaining({ kind: "state-machine", status: "draft", provider: "adapter" })
    ]);
    expect(ingested.source.attachments[0].status).toBe("structured");
  });

  it("returns a host-agent recognition request when no visual adapter is configured", async () => {
    const { service, sourceId } = await fixtureWithAttachment();

    const prepared = await service.prepareRequirementAttachments({ sourceId });

    expect(prepared.recognitionRequests).toEqual([
      expect.objectContaining({ attachmentId: expect.any(String), localPath: expect.any(String) })
    ]);
    expect(prepared.gaps).toEqual([]);
  });

  it("extracts hash-verified XLSX attachments into deterministic draft tables", async () => {
    const root = await tempDir();
    const attachmentPath = join(root, "demand-fields.xlsx");
    await writeFile(attachmentPath, createXlsxFixture());
    const repository = new InMemoryBrainCreatorRepository();
    const service = new KnowledgeService(repository, join(root, "knowledge"), root);
    const project = await service.createProject({ name: "GHR requirements", key: "ghr-xlsx", defaultLocale: "zh-CN" });
    const ingested = await service.ingestRequirement({
      projectId: project.id,
      contentPackage: {
        title: "Demand fields",
        content: "Demand form rules are attached.",
        blocks: [{ type: "paragraph", text: "Demand form rules are attached." }],
        attachments: [{ name: "demand-fields.xlsx", fileToken: "lark-sheet-token", contentHash: "source-hash" }],
        source: "https://example.larkenterprise.com/wiki/demand",
        sourceType: "feishu",
        contentHash: "source-hash",
        warnings: []
      }
    });

    const prepared = await service.prepareRequirementAttachments({
      sourceId: ingested.source.id,
      hostDownloadedAttachments: [{
        attachmentId: ingested.source.attachments[0].id!,
        localPath: "demand-fields.xlsx",
        mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      }]
    });

    expect(prepared.gaps).toEqual([]);
    expect(prepared.recognitionRequests).toEqual([]);
    expect(prepared.analyses).toEqual([
      expect.objectContaining({
        kind: "table",
        provider: "adapter",
        status: "draft",
        markdown: expect.stringContaining("实习需求同样必填")
      })
    ]);
    expect(ingested.source.attachments[0]).toMatchObject({
      status: "structured",
      contentHash: expect.stringMatching(/^[0-9a-f]{64}$/)
    });
    expect(repository.attachmentAnalyses[0].markdown).toContain("需求人数");
  });

  it("creates a recognition Gap instead of accepting invalid XLSX bytes", async () => {
    const root = await tempDir();
    const attachmentPath = join(root, "invalid.xlsx");
    await writeFile(attachmentPath, Buffer.from("not an xlsx workbook"));
    const repository = new InMemoryBrainCreatorRepository();
    const service = new KnowledgeService(repository, join(root, "knowledge"), root);
    const project = await service.createProject({ name: "GHR requirements", key: "ghr-invalid-xlsx", defaultLocale: "zh-CN" });
    const ingested = await service.ingestRequirement({
      projectId: project.id,
      contentPackage: {
        title: "Demand fields",
        content: "Demand form rules are attached.",
        blocks: [{ type: "paragraph", text: "Demand form rules are attached." }],
        attachments: [{ name: "invalid.xlsx", fileToken: "lark-sheet-token" }],
        source: "https://example.larkenterprise.com/wiki/invalid-demand",
        sourceType: "feishu",
        contentHash: "invalid-source-hash",
        warnings: []
      }
    });

    const prepared = await service.prepareRequirementAttachments({
      sourceId: ingested.source.id,
      hostDownloadedAttachments: [{
        attachmentId: ingested.source.attachments[0].id!,
        localPath: "invalid.xlsx",
        mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      }]
    });

    expect(prepared.analyses).toEqual([]);
    expect(prepared.gaps).toEqual([expect.objectContaining({ sourceType: "requirement-attachment", status: "open" })]);
    expect(ingested.source.attachments[0].status).toBe("failed");
  });

  it("accepts a host-downloaded attachment through the controlled workspace boundary", async () => {
    const root = await tempDir();
    const downloadedPath = join(root, "feishu-image.png");
    await writeFile(downloadedPath, Buffer.from("host-image"));
    const repository = new InMemoryBrainCreatorRepository();
    const service = new KnowledgeService(repository, join(root, "knowledge"), root);
    const project = await service.createProject({ name: "Feishu", key: "feishu-host", defaultLocale: "zh-CN" });
    const ingested = await service.ingestRequirement({
      projectId: project.id,
      contentPackage: {
        title: "Feishu flow",
        content: "A request requires approval.",
        blocks: [{ type: "paragraph", text: "A request requires approval." }],
        attachments: [{ name: "flow.png", fileToken: "file-token" }],
        source: "https://example.larkenterprise.com/wiki/demo",
        sourceType: "feishu",
        contentHash: "feishu-host-download",
        warnings: []
      }
    });
    const attachment = ingested.source.attachments[0];

    const prepared = await service.prepareRequirementAttachments({
      sourceId: ingested.source.id,
      hostDownloadedAttachments: [{
        attachmentId: attachment.id!,
        localPath: downloadedPath,
        mimeType: "image/png"
      }]
    });

    expect(prepared.gaps).toEqual([]);
    expect(prepared.recognitionRequests).toEqual([
      expect.objectContaining({ attachmentId: attachment.id, localPath: expect.stringContaining("knowledge") })
    ]);
    expect(attachment.status).toBe("downloaded");
    expect(attachment.contentHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("uses a workspace-contained archive attachment before requiring the Feishu connector", async () => {
    const root = await tempDir();
    const archivePath = join(root, "source-export.zip");
    const archive = new AdmZip();
    archive.addFile("word/media/flow.png", Buffer.from("archive-image"));
    archive.writeZip(archivePath);
    const repository = new InMemoryBrainCreatorRepository();
    const service = new KnowledgeService(repository, join(root, "knowledge"), root);
    const project = await service.createProject({ name: "Feishu archive", key: "feishu-archive", defaultLocale: "zh-CN" });
    const ingested = await service.ingestRequirement({
      projectId: project.id,
      contentPackage: {
        title: "Feishu archive flow",
        content: "A request requires approval.",
        blocks: [{ type: "paragraph", text: "A request requires approval." }],
        attachments: [{
          name: "flow.png",
          fileToken: "file-token",
          containerPath: "source-export.zip",
          containerEntry: "word/media/flow.png",
          mimeType: "image/png"
        }],
        source: "https://example.larkenterprise.com/wiki/archive",
        sourceType: "feishu",
        contentHash: "feishu-archive",
        warnings: []
      }
    });

    const prepared = await service.prepareRequirementAttachments({ sourceId: ingested.source.id });

    expect(prepared.gaps).toEqual([]);
    expect(prepared.recognitionRequests).toHaveLength(1);
    expect(prepared.recognitionRequests[0].localPath).toContain("knowledge");
  });

  it("rejects a host attachment outside the Brain Creator workspace", async () => {
    const root = await tempDir();
    const outside = await tempDir();
    const outsidePath = join(outside, "outside.png");
    await writeFile(outsidePath, Buffer.from("secret"));
    const repository = new InMemoryBrainCreatorRepository();
    const service = new KnowledgeService(repository, join(root, "knowledge"), root);
    const project = await service.createProject({ name: "Feishu", key: "feishu-path", defaultLocale: "zh-CN" });
    const ingested = await service.ingestRequirement({
      projectId: project.id,
      contentPackage: {
        title: "Feishu flow",
        content: "A request requires approval.",
        blocks: [{ type: "paragraph", text: "A request requires approval." }],
        attachments: [{ name: "flow.png", fileToken: "file-token" }],
        source: "https://example.larkenterprise.com/wiki/path",
        sourceType: "feishu",
        contentHash: "feishu-host-path",
        warnings: []
      }
    });

    await expect(service.prepareRequirementAttachments({
      sourceId: ingested.source.id,
      hostDownloadedAttachments: [{
        attachmentId: ingested.source.attachments[0].id!,
        localPath: outsidePath,
        mimeType: "image/png"
      }]
    })).rejects.toThrow("inside the Brain Creator workspace");
  });

  it("retries visual recognition once before creating a Gap", async () => {
    const { service, sourceId } = await fixtureWithAttachment();
    const analyzer = vi
      .fn()
      .mockRejectedValueOnce(new Error("temporary vision failure"))
      .mockResolvedValueOnce({
        kind: "table",
        markdown: "| Field | Rule |\n| --- | --- |",
        nodes: [],
        edges: [],
        confidence: 0.8
      });

    const prepared = await service.prepareRequirementAttachments({ sourceId, analyzer });

    expect(analyzer).toHaveBeenCalledTimes(2);
    expect(prepared.analyses).toHaveLength(1);
    expect(prepared.gaps).toEqual([]);
  });

  it("creates one actionable Gap only after download retries are exhausted", async () => {
    const root = await tempDir();
    const repository = new InMemoryBrainCreatorRepository();
    const service = new KnowledgeService(repository, join(root, "knowledge"));
    const project = await service.createProject({ name: "Order", key: "failed", defaultLocale: "en-US" });
    const ingested = await service.ingestRequirement({
      projectId: project.id,
      contentPackage: {
        title: "Order flow",
        content: "Orders require approval.",
        blocks: [{ type: "paragraph", text: "Orders require approval." }],
        attachments: [{ name: "flow.png", url: "https://example.test/flow.png" }],
        source: "https://example.test/requirements",
        sourceType: "http",
        contentHash: "failed-hash",
        warnings: []
      }
    });
    const fetcher = vi.fn(async () => new Response("denied", { status: 403 }));

    const prepared = await service.prepareRequirementAttachments({
      sourceId: ingested.source.id,
      fetcher
    });

    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(prepared.gaps).toEqual([
      expect.objectContaining({ sourceType: "requirement-attachment", status: "open" })
    ]);
    expect(prepared.gaps[0].reason).toContain("3 download attempts");
  });

  it("rejects local attachment paths outside the requirement directory", async () => {
    const root = await tempDir();
    const requirementDir = join(root, "requirements");
    await mkdir(requirementDir, { recursive: true });
    const secretPath = join(root, "secret.png");
    await writeFile(secretPath, Buffer.from("secret"));
    const repository = new InMemoryBrainCreatorRepository();
    const service = new KnowledgeService(repository, join(root, "knowledge"), root);
    const project = await service.createProject({ name: "Order", key: "path-guard", defaultLocale: "en-US" });
    const ingested = await service.ingestRequirement({
      projectId: project.id,
      contentPackage: {
        title: "Order",
        content: "Orders require approval.",
        blocks: [{ type: "paragraph", text: "Orders require approval." }],
        attachments: [{ name: "secret.png", url: secretPath }],
        source: join(requirementDir, "requirement.md"),
        sourceType: "local-file",
        contentHash: "path-guard",
        warnings: []
      }
    });

    const prepared = await service.prepareRequirementAttachments({ sourceId: ingested.source.id });

    expect(prepared.gaps[0].reason).toContain("must stay inside the requirement source directory");
    expect(ingested.source.attachments[0].localPath).toBeUndefined();
  });

  it("validates host output and requires confirmation before marking analysis confirmed", async () => {
    const { service, sourceId } = await fixtureWithAttachment();
    const prepared = await service.prepareRequirementAttachments({ sourceId });
    const request = prepared.recognitionRequests[0];
    const submitted = service.submitRequirementAttachmentAnalysis({
      sourceId,
      attachmentId: request.attachmentId,
      provider: "host-agent",
      result: {
        kind: "flowchart",
        markdown: "Start -> Submit",
        nodes: [{ id: "start", type: "step", label: "Start" }],
        edges: [],
        confidence: 0.88
      }
    });

    expect(submitted.status).toBe("draft");
    const revised = service.submitRequirementAttachmentAnalysis({
      sourceId,
      attachmentId: request.attachmentId,
      provider: "host-agent",
      result: {
        kind: "flowchart",
        markdown: "Start -> Submit -> Confirm",
        nodes: [
          { id: "start", type: "step", label: "Start" },
          { id: "submit", type: "step", label: "Submit" }
        ],
        edges: [{ from: "start", to: "submit" }],
        confidence: 0.93
      }
    });

    expect(revised.id).toBe(submitted.id);
    expect(revised.status).toBe("draft");
    expect(revised.markdown).toBe("Start -> Submit -> Confirm");
    const confirmed = service.confirmRequirementAttachmentAnalysis({
      analysisId: revised.id,
      confirmedBy: "qa"
    });
    expect(confirmed.status).toBe("confirmed");
    expect(() => service.submitRequirementAttachmentAnalysis({
      sourceId,
      attachmentId: request.attachmentId,
      provider: "host-agent",
      result: {
        kind: "flowchart",
        markdown: "Changed after confirmation",
        nodes: [],
        edges: [],
        confidence: 0.93
      }
    })).toThrow("Only the linked draft attachment analysis can be revised");
  });

  it("blocks approval before critical process evidence is confirmed without creating a premature Gap", async () => {
    const root = await tempDir();
    const imagePath = join(root, "approval-flow.png");
    await writeFile(imagePath, Buffer.from("image"));
    const repository = new InMemoryBrainCreatorRepository();
    const service = new KnowledgeService(repository, join(root, "knowledge"));
    const project = await service.createProject({ name: "Order", key: "process-gate", defaultLocale: "en-US" });
    const ingested = await service.ingestRequirement({
      projectId: project.id,
      contentPackage: {
        title: "Order approval",
        content: "Orders require approval.",
        blocks: [{ type: "paragraph", text: "Orders require approval." }],
        attachments: [{ name: "approval-flow.png", url: imagePath }],
        source: join(root, "requirement.md"),
        sourceType: "local-file",
        contentHash: "process-gate-hash",
        warnings: []
      }
    });

    const design = await service.generateTestDesign(ingested.requirementSet.id);

    expect(design.evaluationGate.status).toBe("blocked");
    expect(design.evaluation.verdict).toBe("blocked");
    expect(design.evaluation.requiredActions).toContain(
      "Analyze and confirm critical process attachments"
    );
    expect(design.evaluationGate.actions).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: "unconfirmed-attachment", status: "blocked" })])
    );
    expect(repository.gaps).toEqual([]);
    expect(() => service.approveRequirementSet(ingested.requirementSet.id)).toThrow(
      "Blocked Requirement Eval output cannot be approved"
    );
  });

  it("rebuilds test design with workflow and state coverage after attachment confirmation", async () => {
    const root = await tempDir();
    const imagePath = join(root, "approval-state.png");
    await writeFile(imagePath, Buffer.from("image"));
    const repository = new InMemoryBrainCreatorRepository();
    const service = new KnowledgeService(repository, join(root, "knowledge"));
    const project = await service.createProject({ name: "Order", key: "process-design", defaultLocale: "en-US" });
    const ingested = await service.ingestRequirement({
      projectId: project.id,
      contentPackage: {
        title: "Order lifecycle",
        content: "Orders have a lifecycle.",
        blocks: [{ type: "paragraph", text: "Orders have a lifecycle." }],
        attachments: [{ name: "approval-state.png", url: imagePath }],
        source: join(root, "requirement.md"),
        sourceType: "local-file",
        contentHash: "process-design-hash",
        warnings: []
      }
    });
    const before = await service.generateTestDesign(ingested.requirementSet.id);
    const prepared = await service.prepareRequirementAttachments({
      sourceId: ingested.source.id,
      analyzer: async () => ({
        kind: "state-machine",
        markdown: "Draft -> Submitted -> Approved",
        nodes: [
          { id: "draft", type: "state", label: "Draft" },
          { id: "submitted", type: "state", label: "Submitted" },
          { id: "approved", type: "state", label: "Approved" }
        ],
        edges: [
          { from: "draft", to: "submitted", condition: "submit", actor: "requester" },
          { from: "submitted", to: "approved", condition: "approve", actor: "manager" }
        ],
        confidence: 0.96
      })
    });
    service.confirmRequirementAttachmentAnalysis({
      analysisId: prepared.analyses[0].id,
      confirmedBy: "qa"
    });

    const after = await service.generateTestDesign(ingested.requirementSet.id);

    expect(before.testIntents).toHaveLength(1);
    expect(after.reused).toBeUndefined();
    expect(after.stateMachineModels).toHaveLength(1);
    expect(after.coverageProfile.status).toBe("complete");
    expect(after.coverageProfile.dimensions.state.missingRefs).toEqual([]);
    expect(after.testIntents.length).toBeGreaterThan(before.testIntents.length);
    expect(after.testIntents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ scenarioType: "positive", processModelRefs: [after.stateMachineModels[0].id] }),
        expect.objectContaining({ scenarioType: "negative" })
      ])
    );
    expect(after.testIntents.every((intent) => intent.requirementRefs.length > 0)).toBe(true);
  });
});

async function fixtureWithAttachment() {
  const root = await tempDir();
  const imagePath = join(root, "flow.png");
  await writeFile(imagePath, Buffer.from("image"));
  const repository = new InMemoryBrainCreatorRepository();
  const service = new KnowledgeService(repository, join(root, "knowledge"));
  const project = await service.createProject({ name: "Order", key: "fixture", defaultLocale: "en-US" });
  const ingested = await service.ingestRequirement({
    projectId: project.id,
    contentPackage: {
      title: "Order flow",
      content: "Orders require approval.",
      blocks: [{ type: "paragraph", text: "Orders require approval." }],
      attachments: [{ name: "flow.png", url: imagePath }],
      source: join(root, "requirement.md"),
      sourceType: "local-file",
      contentHash: "fixture-hash",
      warnings: []
    }
  });
  return { service, sourceId: ingested.source.id };
}

async function tempDir() {
  const dir = await mkdtemp(join(tmpdir(), "brain-attachment-"));
  tempDirs.push(dir);
  return dir;
}

function createXlsxFixture() {
  const zip = new AdmZip();
  zip.addFile("xl/workbook.xml", Buffer.from(
    '<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="发起" sheetId="1" r:id="rId1"/></sheets></workbook>',
    "utf8"
  ));
  zip.addFile("xl/_rels/workbook.xml.rels", Buffer.from(
    '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet"/></Relationships>',
    "utf8"
  ));
  zip.addFile("xl/sharedStrings.xml", Buffer.from(
    '<sst><si><t>字段</t></si><si><t>必填</t></si><si><t>校验规则</t></si><si><t>职位</t></si><si><t>是</t></si><si><t></t><r><t>实习需求</t></r><r><t>同样必填</t></r></si><si><t>需求人数</t></si><si><t>正整数</t></si></sst>',
    "utf8"
  ));
  zip.addFile("xl/worksheets/sheet1.xml", Buffer.from(
    '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c></row><row r="2"><c r="A2" t="s"><v>3</v></c><c r="B2" t="s"><v>4</v></c><c r="C2" t="s"><v>5</v></c></row><row r="3"><c r="A3" t="s"><v>6</v></c><c r="B3" t="s"><v>4</v></c><c r="C3" t="s"><v>7</v></c></row></sheetData></worksheet>',
    "utf8"
  ));
  return zip.toBuffer();
}
