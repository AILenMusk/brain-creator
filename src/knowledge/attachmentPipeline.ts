import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import AdmZip from "adm-zip";
import { XMLParser } from "fast-xml-parser";
import type { InMemoryBrainCreatorRepository } from "../domain/repository.js";
import type {
  AttachmentAnalysis,
  AttachmentAnalysisKind,
  Gap,
  RequirementAttachment,
  RequirementSource
} from "../domain/types.js";
import { id } from "../shared/id.js";

const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;
const MAX_SPREADSHEET_ANALYSIS_CHARS = 500_000;
const DOWNLOAD_ATTEMPTS = 3;

export type AttachmentAnalysisDraft = {
  kind: AttachmentAnalysisKind;
  markdown: string;
  nodes: Array<{ id: string; type: string; label: string }>;
  edges: Array<{ from: string; to: string; condition?: string; actor?: string }>;
  confidence: number;
};

export type RequirementVisualAnalyzer = (input: {
  attachmentId: string;
  name: string;
  mimeType?: string;
  localPath: string;
  sourceRefs: string[];
}) => Promise<AttachmentAnalysisDraft>;

export type RequirementAttachmentDownloader = (
  attachment: RequirementAttachment
) => Promise<{ data: Buffer; mimeType?: string }>;

/** A host connector may download an attachment before handing it to Brain Creator. */
export type HostDownloadedAttachment = {
  attachmentId: string;
  localPath: string;
  contentHash?: string;
  mimeType?: string;
};

export class RequirementAttachmentPipeline {
  constructor(
    private readonly repository: InMemoryBrainCreatorRepository,
    private readonly rootDir: string,
    private readonly sourceBaseDir = process.cwd()
  ) {}

  async prepare(input: {
    sourceId: string;
    attachmentIds?: string[];
    hostDownloadedAttachments?: HostDownloadedAttachment[];
    fetcher?: typeof fetch;
    downloader?: RequirementAttachmentDownloader;
    analyzer?: RequirementVisualAnalyzer;
  }) {
    const source = this.source(input.sourceId);
    await this.adoptHostDownloads(source, input.hostDownloadedAttachments ?? []);
    const selected = source.attachments.filter(
      (attachment) =>
        !input.attachmentIds?.length ||
        (attachment.id !== undefined && input.attachmentIds.includes(attachment.id))
    );
    const analyses: AttachmentAnalysis[] = [];
    const recognitionRequests: Array<{
      attachmentId: string;
      name: string;
      mimeType?: string;
      localPath: string;
      requiredOutput: "AttachmentAnalysis";
      instructions: string;
      schema: {
        kinds: AttachmentAnalysisKind[];
        required: string[];
      };
      sourceRefs: string[];
    }> = [];
    const gaps: Gap[] = [];

    for (const attachment of selected) {
      if (!attachment.id) continue;
      if (attachment.status === "confirmed" || attachment.status === "structured") continue;
      if (!attachment.localPath || attachment.status === "failed" || attachment.status === "needs-auth") {
        const download = await this.downloadWithRetry(source, attachment, input.fetcher, input.downloader);
        if (!download.ok) {
          gaps.push(this.finalFailureGap(source, attachment, "download", download.reason));
          continue;
        }
      }
      if (!attachment.localPath) continue;
      if (isSpreadsheetAttachment(attachment.mimeType, attachment)) {
        attachment.status = "recognizing";
        attachment.recognitionAttempts = (attachment.recognitionAttempts ?? 0) + 1;
        this.repository.persist();
        try {
          const analysis = await extractSpreadsheetAnalysis(attachment.localPath);
          analyses.push(this.submit({
            sourceId: source.id,
            attachmentId: attachment.id,
            provider: "adapter",
            result: analysis
          }));
        } catch (error) {
          attachment.status = "failed";
          attachment.failureReason = errorMessage(error);
          gaps.push(this.finalFailureGap(source, attachment, "recognition", attachment.failureReason));
        }
        continue;
      }
      const request = {
        attachmentId: attachment.id,
        name: attachment.name,
        mimeType: attachment.mimeType,
        localPath: attachment.localPath,
        requiredOutput: "AttachmentAnalysis" as const,
        instructions:
          "Treat the image or PDF as requirement content. Extract tables as Markdown and flows as typed nodes and edges without inventing missing labels.",
        schema: {
          kinds: ["table", "flowchart", "state-machine", "wireframe", "text-image", "other"] as AttachmentAnalysisKind[],
          required: ["kind", "markdown", "nodes", "edges", "confidence"]
        },
        sourceRefs: [`requirement-source:${source.id}`, `attachment:${attachment.id}`]
      };
      if (!input.analyzer) {
        recognitionRequests.push(request);
        continue;
      }
      let recognized = false;
      for (let attempt = 0; attempt < 2 && !recognized; attempt += 1) {
        attachment.status = "recognizing";
        attachment.recognitionAttempts = (attachment.recognitionAttempts ?? 0) + 1;
        this.repository.persist();
        try {
          const result = validateAnalysisDraft(await input.analyzer(request));
          analyses.push(this.submit({
            sourceId: source.id,
            attachmentId: attachment.id,
            provider: "adapter",
            result
          }));
          recognized = true;
        } catch (error) {
          attachment.failureReason = errorMessage(error);
        }
      }
      if (!recognized) {
        attachment.status = "failed";
        gaps.push(this.finalFailureGap(source, attachment, "recognition", attachment.failureReason ?? "unknown error"));
      }
    }
    this.repository.persist();
    return { attachments: selected, analyses, recognitionRequests, gaps };
  }

  private async adoptHostDownloads(
    source: RequirementSource,
    downloads: HostDownloadedAttachment[]
  ) {
    for (const download of downloads) {
      const attachment = source.attachments.find((item) => item.id === download.attachmentId);
      if (!attachment) throw new Error(`Requirement attachment not found: ${download.attachmentId}`);
      if (!download.localPath.trim()) throw new Error("Host attachment localPath is required");

      const workspaceRoot = resolve(this.sourceBaseDir);
      const candidate = resolve(workspaceRoot, download.localPath);
      const relativePath = relative(workspaceRoot, candidate);
      if (
        relativePath === ".." ||
        relativePath.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) ||
        isAbsolute(relativePath)
      ) {
        throw new Error("Host attachment path must stay inside the Brain Creator workspace");
      }

      const data = await readFile(candidate);
      if (data.byteLength > MAX_ATTACHMENT_BYTES) {
        throw new Error(`attachment exceeds ${MAX_ATTACHMENT_BYTES} bytes`);
      }
      const mimeType = download.mimeType ?? attachment.mimeType ?? mimeTypeFromName(attachment.name);
      if (!isSupportedRequirementAttachment(mimeType, attachment)) {
        throw new Error("host attachment is not a supported image, PDF, or XLSX workbook");
      }
      const contentHash = createHash("sha256").update(data).digest("hex");
      if (download.contentHash && download.contentHash !== contentHash) {
        throw new Error(`host attachment hash mismatch for ${attachment.id}`);
      }

      const directory = join(this.rootDir, "sources", source.id, "attachments");
      await mkdir(directory, { recursive: true });
      const path = join(directory, `${attachment.id}-${safeName(attachment.name)}`);
      await writeFile(path, data);
      attachment.localPath = path;
      attachment.mimeType = mimeType;
      attachment.contentHash = contentHash;
      attachment.status = "downloaded";
      attachment.attempts = (attachment.attempts ?? 0) + 1;
      attachment.failureReason = undefined;

      for (const gap of this.repository.gaps.filter(
        (item) =>
          item.sourceType === "requirement-attachment" &&
          item.sourceId === attachment.id &&
          item.status === "open"
      )) {
        gap.status = "resolved";
        gap.lifecycle = [
          ...(gap.lifecycle ?? []),
          {
            operation: "resolve",
            note: "Recovered by a host-provided, hash-verified attachment download.",
            evidenceRefs: [
              `requirement-source:${source.id}`,
              `attachment:${attachment.id}`,
              `sha256:${contentHash}`
            ],
            createdAt: new Date().toISOString()
          }
        ];
        gap.updatedAt = new Date().toISOString();
      }
    }
    if (downloads.length > 0) {
      source.updatedAt = new Date().toISOString();
      this.repository.persist();
    }
  }

  submit(input: {
    sourceId: string;
    attachmentId: string;
    provider: "host-agent" | "adapter";
    result: AttachmentAnalysisDraft;
  }) {
    const source = this.source(input.sourceId);
    const attachment = source.attachments.find((item) => item.id === input.attachmentId);
    if (!attachment) throw new Error("Requirement attachment not found");
    const attachmentId = attachment.id;
    if (!attachmentId) throw new Error("Requirement attachment is missing its id");
    const existing = this.repository.attachmentAnalyses.find(
      (item) => item.sourceId === source.id && item.attachmentId === attachment.id && item.status !== "failed"
    );
    const revisingDraft = existing?.status === "draft" && attachment.analysisId === existing.id;
    if (!attachment.localPath) {
      throw new Error("Requirement attachment must be downloaded before analysis submission");
    }
    if (!revisingDraft && !["downloaded", "recognizing", "failed"].includes(attachment.status ?? "")) {
      throw new Error("Only the linked draft attachment analysis can be revised");
    }
    const result = validateAnalysisDraft(input.result);
    const now = new Date().toISOString();
    const analysis: AttachmentAnalysis = existing ?? {
      id: id("attachmentAnalysis"),
      knowledgeProjectId: source.knowledgeProjectId,
      requirementSetId: requiredRequirementSetId(source),
      sourceId: source.id,
      attachmentId,
      ...result,
      sourceRefs: [`requirement-source:${source.id}`, `attachment:${attachment.id}`],
      provider: input.provider,
      status: "draft",
      createdAt: now,
      updatedAt: now
    };
    Object.assign(analysis, result, { provider: input.provider, status: "draft", updatedAt: now });
    if (!existing) this.repository.attachmentAnalyses.push(analysis);
    attachment.analysisId = analysis.id;
    attachment.status = "structured";
    attachment.failureReason = undefined;
    this.repository.persist();
    return analysis;
  }

  confirm(input: { analysisId: string; confirmedBy?: string }) {
    const analysis = this.repository.attachmentAnalyses.find((item) => item.id === input.analysisId);
    if (!analysis) throw new Error("Attachment analysis not found");
    if (analysis.status !== "draft") throw new Error("Only draft attachment analysis can be confirmed");
    const source = this.source(analysis.sourceId);
    const attachment = source.attachments.find((item) => item.id === analysis.attachmentId);
    if (!attachment) throw new Error("Requirement attachment not found");
    const now = new Date().toISOString();
    analysis.status = "confirmed";
    analysis.confirmedAt = now;
    analysis.confirmedBy = input.confirmedBy;
    analysis.updatedAt = now;
    attachment.status = "confirmed";
    this.repository.persist();
    return analysis;
  }

  private async downloadWithRetry(
    source: RequirementSource,
    attachment: RequirementAttachment,
    fetcher = fetch,
    downloader?: RequirementAttachmentDownloader
  ): Promise<{ ok: true } | { ok: false; reason: string }> {
    let lastError = "attachment download failed";
    for (let attempt = 0; attempt < DOWNLOAD_ATTEMPTS; attempt += 1) {
      attachment.status = "downloading";
      attachment.attempts = (attachment.attempts ?? 0) + 1;
      try {
        const result = await readAttachment(
          source,
          attachment,
          fetcher,
          downloader,
          this.sourceBaseDir
        );
        if (result.data.byteLength > MAX_ATTACHMENT_BYTES) {
          throw new Error(`attachment exceeds ${MAX_ATTACHMENT_BYTES} bytes`);
        }
        if (!isSupportedRequirementAttachment(result.mimeType ?? attachment.mimeType, attachment)) {
          throw new Error("attachment is not a supported image, PDF, or XLSX workbook");
        }
        const directory = join(this.rootDir, "sources", source.id, "attachments");
        await mkdir(directory, { recursive: true });
        const path = join(directory, `${attachment.id}-${safeName(attachment.name)}`);
        await writeFile(path, result.data);
        attachment.localPath = path;
        attachment.mimeType = result.mimeType ?? attachment.mimeType ?? mimeTypeFromName(attachment.name);
        attachment.contentHash = createHash("sha256").update(result.data).digest("hex");
        attachment.status = "downloaded";
        attachment.failureReason = undefined;
        this.repository.persist();
        return { ok: true };
      } catch (error) {
        lastError = errorMessage(error);
        attachment.failureReason = lastError;
      }
    }
    attachment.status = missingConnector(source, attachment, downloader) ? "needs-auth" : "failed";
    this.repository.persist();
    return { ok: false, reason: lastError };
  }

  private finalFailureGap(
    source: RequirementSource,
    attachment: RequirementAttachment,
    stage: "download" | "recognition",
    reason: string
  ) {
    const existing = this.repository.gaps.find(
      (gap) =>
        gap.sourceType === "requirement-attachment" &&
        gap.sourceId === attachment.id &&
        gap.status === "open"
    );
    if (existing) return existing;
    const now = new Date().toISOString();
    const gap: Gap = {
      id: id("gap"),
      projectId: source.knowledgeProjectId,
      sourceType: "requirement-attachment",
      sourceId: attachment.id ?? source.id,
      reason:
        `Attachment ${attachment.name} failed after ${
          stage === "download" ? attachment.attempts ?? 0 : attachment.recognitionAttempts ?? 0
        } ${stage} attempts using ${stage === "recognition" ? "the visual adapter" : "the source connector"}. ` +
        `Last error: ${reason}. Next action: restore connector access, provide a supported file, or retry recognition.`,
      severity: "high",
      owner: "qa",
      status: "open",
      createdAt: now,
      updatedAt: now
    };
    this.repository.gaps.push(gap);
    return gap;
  }

  private source(sourceId: string) {
    const source = this.repository.requirementSources.find((item) => item.id === sourceId);
    if (!source) throw new Error("Requirement source not found");
    return source;
  }
}

async function readAttachment(
  source: RequirementSource,
  attachment: RequirementAttachment,
  fetcher: typeof fetch,
  downloader?: RequirementAttachmentDownloader,
  sourceBaseDir = process.cwd()
) {
  if (attachment.containerPath && attachment.containerEntry) {
    assertLocalAttachmentPath(source, attachment.containerPath, sourceBaseDir);
    const containerPath = resolve(sourceBaseDir, attachment.containerPath);
    const entry = new AdmZip(containerPath).getEntry(attachment.containerEntry);
    if (!entry) throw new Error(`container entry ${attachment.containerEntry} not found`);
    return { data: entry.getData(), mimeType: attachment.mimeType };
  }
  if (source.sourceType === "feishu" && attachment.fileToken) {
    if (!downloader) throw new Error("Feishu connector authentication is required to download media");
    return downloader(attachment);
  }
  if (attachment.containerPath) {
    assertLocalAttachmentPath(source, attachment.containerPath, sourceBaseDir);
    return { data: await readFile(resolve(sourceBaseDir, attachment.containerPath)), mimeType: attachment.mimeType };
  }
  if (!attachment.url) throw new Error("attachment has no downloadable reference");
  if (isAbsolute(attachment.url) || /^[a-z]:[\\/]/i.test(attachment.url)) {
    assertLocalAttachmentPath(source, attachment.url, sourceBaseDir);
    return { data: await readFile(attachment.url), mimeType: attachment.mimeType };
  }
  if (
    (source.sourceType === "local-file" || source.sourceType === "obsidian") &&
    !/^[a-z][a-z0-9+.-]*:/i.test(attachment.url)
  ) {
    const candidate = resolve(dirname(localSourcePath(source, sourceBaseDir)), attachment.url);
    assertLocalAttachmentPath(source, candidate, sourceBaseDir);
    return { data: await readFile(candidate), mimeType: attachment.mimeType };
  }
  const url = new URL(attachment.url);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`unsupported attachment protocol: ${url.protocol}`);
  }
  if (source.sourceType === "http" && new URL(source.source).origin !== url.origin) {
    throw new Error("cross-origin requirement attachment requires an authorized connector");
  }
  const response = await fetcher(url, {
    redirect: "error",
    signal: AbortSignal.timeout(15_000)
  });
  if (!response.ok) throw new Error(`attachment returned HTTP ${response.status}`);
  return {
    data: Buffer.from(await response.arrayBuffer()),
    mimeType: response.headers.get("content-type") ?? attachment.mimeType
  };
}

function validateAnalysisDraft(value: AttachmentAnalysisDraft) {
  const kinds: AttachmentAnalysisKind[] = [
    "table", "flowchart", "state-machine", "wireframe", "text-image", "other"
  ];
  if (!value || !kinds.includes(value.kind) || !value.markdown?.trim()) {
    throw new Error("Attachment analysis requires a supported kind and markdown content");
  }
  if (!Array.isArray(value.nodes) || !Array.isArray(value.edges)) {
    throw new Error("Attachment analysis nodes and edges must be arrays");
  }
  if (!Number.isFinite(value.confidence) || value.confidence < 0 || value.confidence > 1) {
    throw new Error("Attachment analysis confidence must be between 0 and 1");
  }
  const nodeIds = new Set(value.nodes.map((node) => node.id));
  if (nodeIds.size !== value.nodes.length || value.nodes.some((node) => !node.id || !node.type || !node.label)) {
    throw new Error("Attachment analysis nodes require unique id, type, and label values");
  }
  if (value.edges.some((edge) => !nodeIds.has(edge.from) || !nodeIds.has(edge.to))) {
    throw new Error("Attachment analysis edges must reference declared nodes");
  }
  return value;
}

function assertLocalAttachmentPath(
  source: RequirementSource,
  candidate: string,
  sourceBaseDir: string
) {
  const workspaceRoot = resolve(sourceBaseDir);
  const candidatePath = resolve(sourceBaseDir, candidate);
  const pathFromSource = relative(
    source.sourceType === "local-file" || source.sourceType === "obsidian"
      ? dirname(localSourcePath(source, sourceBaseDir))
      : workspaceRoot,
    candidatePath
  );
  if (
    pathFromSource === ".." ||
    pathFromSource.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) ||
    isAbsolute(pathFromSource)
  ) {
    throw new Error("local attachment must stay inside the requirement source directory");
  }
}

function localSourcePath(source: RequirementSource, sourceBaseDir: string) {
  const normalizedSource = source.source.startsWith("obsidian:")
    ? source.source.slice("obsidian:".length).trim()
    : source.source.startsWith("[[") && source.source.endsWith("]]")
      ? source.source.slice(2, -2).trim()
      : source.source;
  return resolve(sourceBaseDir, normalizedSource);
}

function isSupportedVisualContent(
  mimeType: string | undefined,
  attachment: RequirementAttachment
) {
  if (mimeType?.toLowerCase().startsWith("image/")) return true;
  if (mimeType?.toLowerCase().split(";", 1)[0] === "application/pdf") return true;
  if (attachment.type === "image") return true;
  return [".png", ".jpg", ".jpeg", ".gif", ".webp", ".pdf"].includes(
    extname(attachment.name).toLowerCase()
  );
}

function isSupportedRequirementAttachment(
  mimeType: string | undefined,
  attachment: RequirementAttachment
) {
  return isSupportedVisualContent(mimeType, attachment) ||
    isSpreadsheetAttachment(mimeType, attachment);
}

function isSpreadsheetAttachment(
  mimeType: string | undefined,
  attachment: RequirementAttachment
) {
  const normalizedMimeType = mimeType?.toLowerCase().split(";", 1)[0];
  return normalizedMimeType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
    extname(attachment.name).toLowerCase() === ".xlsx";
}

async function extractSpreadsheetAnalysis(path: string): Promise<AttachmentAnalysisDraft> {
  const zip = new AdmZip(path);
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    parseTagValue: false,
    trimValues: false
  });
  const workbookXml = zip.getEntry("xl/workbook.xml")?.getData().toString("utf8");
  const relationshipsXml = zip.getEntry("xl/_rels/workbook.xml.rels")?.getData().toString("utf8");
  if (!workbookXml || !relationshipsXml) throw new Error("XLSX workbook metadata is incomplete");
  const workbook = objectValue(parseXmlObject(parser.parse(workbookXml)).workbook);
  const relationshipRoot = objectValue(parseXmlObject(parser.parse(relationshipsXml)).Relationships);
  const workbookSheets = toObjectArray(objectValue(workbook?.sheets)?.sheet);
  const relationships = toObjectArray(relationshipRoot?.Relationship);
  if (workbookSheets.length === 0) throw new Error("XLSX workbook contains no worksheets");
  const relationshipTargets = new Map(
    relationships.map((relationship) => [stringValue(relationship["@_Id"]), stringValue(relationship["@_Target"])])
  );
  const sharedStringsXml = zip.getEntry("xl/sharedStrings.xml")?.getData().toString("utf8");
  const sharedStringsRoot = sharedStringsXml
    ? objectValue(parseXmlObject(parser.parse(sharedStringsXml)).sst)
    : undefined;
  const sharedStrings = toObjectArray(sharedStringsRoot?.si).map((item) => richText(item));
  const lines: string[] = [];
  for (const [sheetIndex, worksheet] of workbookSheets.entries()) {
    const name = stringValue(worksheet["@_name"]) || `Sheet ${sheetIndex + 1}`;
    const sheetState = stringValue(worksheet["@_state"]) || "visible";
    const relationshipId = stringValue(worksheet["@_r:id"] ?? worksheet["@_id"]);
    const target = relationshipTargets.get(relationshipId);
    if (!target) throw new Error(`XLSX worksheet relationship not found for ${name}`);
    const sheetPath = target.startsWith("/")
      ? target.slice(1)
      : joinXlsxPath("xl", target);
    const sheetXml = zip.getEntry(sheetPath)?.getData().toString("utf8");
    if (!sheetXml) throw new Error(`XLSX worksheet data not found for ${name}`);
    const sheetRoot = objectValue(parseXmlObject(parser.parse(sheetXml)).worksheet);
    const sheetData = toObjectArray(objectValue(sheetRoot?.sheetData)?.row);
    const state = sheetState === "visible" ? "" : ` (${sheetState})`;
    lines.push(`## ${escapeMarkdownCell(name)}${state}`);
    const rows: Array<{ number: number; values: string[] }> = [];
    for (const [rowIndex, row] of sheetData.entries()) {
      const rowNumber = Number(stringValue(row["@_r"]) || rowIndex + 1);
      const cellObjects = toObjectArray(row.c);
      const cells = new Map<number, string>();
      for (const cell of cellObjects) {
        const columnNumber = xlsxColumnNumber(stringValue(cell["@_r"]));
        if (columnNumber === undefined) continue;
        cells.set(columnNumber, spreadsheetCellValue(cell, sharedStrings));
      }
      const columnCount = Math.max(0, ...cells.keys());
      const values = Array.from({ length: columnCount }, (_, index) => cells.get(index + 1) ?? "");
      if (values.some((value) => value.length > 0)) rows.push({ number: rowNumber, values });
    }

    if (rows.length === 0) {
      lines.push("No populated cells.");
      continue;
    }

    const columnCount = Math.max(...rows.map((row) => row.values.length));
    lines.push(
      `| Row | ${Array.from({ length: columnCount }, (_, index) => `Column ${index + 1}`).join(" | ")} |`,
      `| --- | ${Array.from({ length: columnCount }, () => "---").join(" | ")} |`
    );
    for (const row of rows) {
      const values = Array.from({ length: columnCount }, (_, index) => escapeMarkdownCell(row.values[index] ?? ""));
      lines.push(`| ${row.number} | ${values.join(" | ")} |`);
    }
    if (lines.join("\n").length > MAX_SPREADSHEET_ANALYSIS_CHARS) {
      throw new Error(`XLSX extraction exceeds ${MAX_SPREADSHEET_ANALYSIS_CHARS} characters`);
    }
  }

  return { kind: "table", markdown: lines.join("\n"), nodes: [], edges: [], confidence: 1 };
}

function parseXmlObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function toObjectArray(value: unknown): Array<Record<string, unknown>> {
  if (value === undefined || value === null) return [];
  return (Array.isArray(value) ? value : [value]).filter(
    (item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item)
  ) as Array<Record<string, unknown>>;
}

function stringValue(value: unknown) {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean"
    ? String(value)
    : "";
}

function richText(value: unknown): string {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map(richText).join("");
  if (!value || typeof value !== "object") return "";
  const object = value as Record<string, unknown>;
  if (object["#text"] !== undefined) return richText(object["#text"]);
  return `${richText(object.t)}${richText(object.r)}`;
}

function spreadsheetCellValue(cell: Record<string, unknown>, sharedStrings: string[]) {
  const type = stringValue(cell["@_t"]);
  if (type === "s") {
    const index = Number(richText(cell.v));
    if (!Number.isInteger(index) || index < 0 || index >= sharedStrings.length) {
      throw new Error("XLSX cell references a missing shared string");
    }
    return sharedStrings[index];
  }
  if (type === "inlineStr") return richText(cell.is);
  if (type === "b") return richText(cell.v) === "1" ? "TRUE" : "FALSE";
  if (cell.v !== undefined) return richText(cell.v);
  return cell.f !== undefined ? `=${richText(cell.f)}` : "";
}

function xlsxColumnNumber(reference: string) {
  const column = /^([A-Z]+)\d+$/i.exec(reference)?.[1]?.toUpperCase();
  if (!column) return undefined;
  let number = 0;
  for (const character of column) number = number * 26 + character.charCodeAt(0) - 64;
  return number;
}

function joinXlsxPath(root: string, target: string) {
  const parts: string[] = [];
  for (const part of `${root}/${target}`.replace(/\\/g, "/").split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return parts.join("/");
}

function escapeMarkdownCell(value: string) {
  return value.replace(/\r?\n/g, "<br>").replace(/\|/g, "\\|");
}

function requiredRequirementSetId(source: RequirementSource) {
  if (!source.latestRequirementSetId) throw new Error("Requirement source has no active requirement set");
  return source.latestRequirementSetId;
}

function missingConnector(
  source: RequirementSource,
  attachment: RequirementAttachment,
  downloader?: RequirementAttachmentDownloader
) {
  return source.sourceType === "feishu" && Boolean(attachment.fileToken) && !downloader;
}

function safeName(value: string) {
  const sanitized = basename(value).replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return sanitized || "attachment.bin";
}

function mimeTypeFromName(value: string) {
  return ({
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".pdf": "application/pdf"
  } as Record<string, string>)[extname(value).toLowerCase()];
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
