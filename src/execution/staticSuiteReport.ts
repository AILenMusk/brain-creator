import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type {
  ExecutionEvidence,
  ExecutionProgressEvent,
  RequirementSuiteRun
} from "../domain/types.js";
import { redactSensitiveText } from "../shared/secretScan.js";

type SuiteProgress = {
  current?: ExecutionProgressEvent;
  possiblyStalled: boolean;
  stalledAfterMs: number;
};

type SuiteActionEvidence = {
  caseId?: string;
  phase: string;
  actionKey: string;
  actionSemantic: string;
  entityReference?: string;
  postcondition?: string;
  evidenceRefs: string[];
  evidenceArtifacts: Array<{ path: string; sha256: string }>;
};

export async function writeStaticSuiteExecutionReport(input: {
  outputPath: string;
  title: string;
  run: RequirementSuiteRun;
  requirementSetIds?: string[];
  locale?: string;
  evidence: ExecutionEvidence[];
  coverage?: Array<{
    testIntentId: string;
    title: string;
    module: string;
    classification: string;
    classificationReason: string;
    requirementRefs: string[];
  }>;
  bugs?: Array<{ id: string; status: string; caseNo?: string; actualResult: string }>;
  gaps?: Array<{ id: string; status: string; caseNo?: string; reason: string }>;
  progress?: SuiteProgress;
  actionEvidence?: SuiteActionEvidence[];
  protectedSecrets?: Record<string, string>;
}) {
  await mkdir(dirname(input.outputPath), { recursive: true });
  await writeFile(input.outputPath, renderStaticSuiteExecutionReport(input), "utf8");
  return input.outputPath;
}

export function renderStaticSuiteExecutionReport(input: {
  title: string;
  run: RequirementSuiteRun;
  requirementSetIds?: string[];
  locale?: string;
  evidence: ExecutionEvidence[];
  coverage?: Array<{
    testIntentId: string;
    title: string;
    module: string;
    classification: string;
    classificationReason: string;
    requirementRefs: string[];
  }>;
  bugs?: Array<{ id: string; status: string; caseNo?: string; actualResult: string }>;
  gaps?: Array<{ id: string; status: string; caseNo?: string; reason: string }>;
  progress?: SuiteProgress;
  actionEvidence?: SuiteActionEvidence[];
  protectedSecrets?: Record<string, string>;
}) {
  const safeHtml = (value: string) => escapeHtml(
    input.protectedSecrets
      ? redactSensitiveText(value, input.protectedSecrets)
      : value
  );
  const labels = staticReportLabelsFixed(input.locale);
  const evidenceByCase = new Map(input.evidence.map((item) => [item.executableCaseId, item]));
  const strong = input.evidence.filter((item) => item.assuranceLevel === "strong").length;
  const limited = input.evidence.filter((item) => item.assuranceLevel === "limited").length;
  const none = input.evidence.filter((item) => !item.assuranceLevel || item.assuranceLevel === "none").length;
  const trusted = input.evidence.filter((item) => item.scenarioTrust?.status === "trusted").length;
  const verified = input.evidence.filter((item) => item.scenarioTrust?.status === "verified").length;
  const quarantined = input.evidence.filter((item) => item.scenarioTrust?.status === "quarantined").length;
  const consoleErrors = input.evidence.reduce(
    (total, item) => total + item.consoleErrors.length,
    0
  );
  const networkFailures = input.evidence.reduce(
    (total, item) => total + item.networkFailures.length,
    0
  );
  const coverageCounts = (input.coverage ?? []).reduce<Record<string, number>>((counts, item) => {
    counts[item.classification] = (counts[item.classification] ?? 0) + 1;
    return counts;
  }, {});
  const coverageRows = (input.coverage ?? []).map((item) =>
    `<tr class="searchable-row"><td>${safeHtml(item.testIntentId)}</td><td>${safeHtml(item.title)}</td><td>${safeHtml(item.module)}</td><td>${safeHtml(item.classification)}</td><td>${safeHtml(item.classificationReason)}</td><td>${safeHtml(item.requirementRefs.join(", "))}</td></tr>`
  ).join("");
  const requirementSetIds = [...new Set(input.requirementSetIds ?? [])];
  const formattedCreatedAt = formatTimestamp(input.run.createdAt, input.locale);
  const formattedUpdatedAt = formatTimestamp(input.run.updatedAt, input.locale);
  const currentProgress = input.progress?.current;
  const trustSummary = input.locale?.toLowerCase().startsWith("zh")
    ? `场景可信状态：可信 ${trusted}，已验证 ${verified}，已隔离 ${quarantined}。`
    : `Scenario trust: trusted ${trusted}, verified ${verified}, quarantined ${quarantined}.`;
  const plainLanguageSummary = `<section class="plain-language-summary"><h2>${labels.humanSummary}</h2><p>${labels.executionCaveat}</p><p>${labels.assuranceExplanation}</p><p>${trustSummary}</p></section>`;
  const progressSummary = currentProgress
    ? `<section class="progress"><h2>${labels.currentProgress}</h2><p><strong class="${currentProgress.status}">${safeHtml(currentProgress.status)}</strong> | ${labels.case}${labels.separator} ${safeHtml(currentProgress.caseTitle ?? currentProgress.caseId ?? labels.none)} | ${labels.stage}${labels.separator} ${safeHtml(currentProgress.stage)} | ${labels.currentStep}${labels.separator} ${safeHtml(currentProgress.stepTitle ?? labels.none)} | ${labels.elapsed}${labels.separator} ${safeHtml(String(currentProgress.elapsedMs))} ms${input.progress?.possiblyStalled ? ` | <strong class="blocked">${labels.possiblyStalled}</strong>` : ""}</p>${currentProgress.pageUrl ? `<p>${labels.page}${labels.separator} ${safeHtml(currentProgress.pageUrl)}</p>` : ""}${currentProgress.waitReason ? `<p>${labels.waitReason}${labels.separator} ${safeHtml(currentProgress.waitReason)}</p>` : ""}</section>`
    : "";
  const rows = input.run.caseRuns.map((caseRun) => {
    const evidence = evidenceByCase.get(caseRun.executableCaseId);
    const assurance = evidence?.assuranceLevel ?? "none";
    const artifacts = evidence?.artifactPaths ?? [];
    const warnings = evidence?.evidenceWarnings ?? [];
    const reason = evidence?.actualResult ?? caseRun.error ?? (caseRun.status === "queued" ? "Not executed" : "");
    const steps = evidence?.steps ?? [];
    const stepDetails = steps.length > 0
      ? `<details><summary>${steps.length} ${labels.stepUnit}</summary><ol>${steps.map((step) => `<li class="searchable-row"><strong>${safeHtml(step.assertionStatus)}</strong> ${safeHtml(step.instruction)}${step.expected ? ` | ${labels.expected}: ${safeHtml(step.expected)}` : ""}${step.actual ? ` | ${labels.actual}: ${safeHtml(step.actual)}` : ""}${step.screenshotPath ? ` | ${artifactLink(step.screenshotPath, safeHtml)}` : ""}</li>`).join("")}</ol></details>`
      : `<span class=muted>${labels.noStepEvidence}</span>`;
    return `<tr class="searchable-row"><td>${caseRun.order}</td><td>${safeHtml(caseRun.title)}</td><td class="${caseRun.status}">${safeHtml(caseRun.status)}</td><td>${safeHtml(assurance)}</td><td>${safeHtml(reason)}</td><td>${safeHtml(warnings.join("; "))}</td><td>${stepDetails}</td><td>${escapeHtml(String(evidence?.consoleErrors.length ?? 0))}</td><td>${escapeHtml(String(evidence?.networkFailures.length ?? 0))}</td><td>${artifactLinks(artifacts, safeHtml)}</td></tr>`;
  }).join("");
  const bugs = (input.bugs ?? []).map((bug) => `<li class="searchable-row">${safeHtml(bug.id)} ${safeHtml(bug.status)}: ${safeHtml(bug.actualResult)}</li>`).join("") || `<li class=muted>${labels.none}</li>`;
  const gaps = (input.gaps ?? []).map((gap) => `<li class="searchable-row">${safeHtml(gap.id)} ${safeHtml(gap.status)}: ${safeHtml(gap.reason)}</li>`).join("") || `<li class=muted>${labels.none}</li>`;
  const html = `<!doctype html><html lang="${labels.lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${safeHtml(input.title)}</title><style>body{font:14px system-ui,sans-serif;max-width:1400px;margin:2rem auto;padding:0 1rem;color:#17202a}header{border-bottom:1px solid #ddd;margin-bottom:1rem}input{width:100%;padding:.6rem;margin:1rem 0}table{width:100%;border-collapse:collapse}th,td{border:1px solid #ddd;padding:.5rem;text-align:left;vertical-align:top}.passed{color:#087f5b}.failed{color:#c92a2a}.blocked{color:#a15c00}.muted{color:#667085}details{min-width:240px}.plain-language-summary{border:1px solid #ddd;padding:1rem;margin:1rem 0}</style></head><body><header><h1>${safeHtml(input.title)}</h1><p>${labels.status}${labels.separator} <strong class="${input.run.status}">${safeHtml(input.run.status)}</strong> | ${labels.total}${labels.separator} ${input.run.total} | ${labels.passed}${labels.separator} ${input.run.passed} | ${labels.failed}${labels.separator} ${input.run.failed} | ${labels.blocked}${labels.separator} ${input.run.blocked}</p><p>${labels.browserMode}${labels.separator} ${safeHtml(input.run.browserMode ?? "headless")}</p><p>${labels.assurance}${labels.separator} <strong>strong ${strong}</strong> | limited ${limited} | none ${none}</p><p>${labels.runtimeImpact}${labels.separator} ${labels.consoleErrors} ${consoleErrors} | ${labels.networkFailures} ${networkFailures}</p><p>${labels.coverage}${labels.separator} ${Object.entries(coverageCounts).map(([key, value]) => `${safeHtml(key)} ${value}`).join(" | ") || labels.noCoverage}</p><p>${labels.run}${labels.separator} ${safeHtml(input.run.id)} | ${labels.system}${labels.separator} ${safeHtml(input.run.systemId)} | ${labels.requirementProject}${labels.separator} ${safeHtml(input.run.knowledgeProjectId)}</p><p>${labels.created}${labels.separator} ${safeHtml(formattedCreatedAt)} | ${labels.updated}${labels.separator} ${safeHtml(formattedUpdatedAt)}${input.locale ? ` | ${labels.locale}${labels.localeSeparator} ${safeHtml(input.locale)}` : ""}</p>${requirementSetIds.length > 0 ? `<p>${labels.requirementSets}${labels.separator} ${requirementSetIds.map((id) => safeHtml(id)).join(", ")}</p>` : ""}</header>${plainLanguageSummary}${progressSummary}<label for="search">${labels.search}</label><input id="search" type="search" placeholder="${labels.searchPlaceholder}" oninput="filterReport(this.value)"><h2>${labels.coverage}</h2><table><thead><tr><th>${labels.intent}</th><th>${labels.title}</th><th>${labels.module}</th><th>${labels.classification}</th><th>${labels.reason}</th><th>${labels.requirementRefs}</th></tr></thead><tbody>${coverageRows || `<tr><td colspan=6 class=muted>${labels.noCoverage}</td></tr>`}</tbody></table><h2>${labels.cases}</h2><table><thead><tr><th>#</th><th>${labels.case}</th><th>${labels.status}</th><th>${labels.assurance}</th><th>${labels.actualOrNotExecuted}</th><th>${labels.evidenceWarnings}</th><th>${labels.steps}</th><th>${labels.consoleErrorsHeader}</th><th>${labels.networkFailuresHeader}</th><th>${labels.artifacts}</th></tr></thead><tbody>${rows || `<tr><td colspan=10 class=muted>${labels.noCases}</td></tr>`}</tbody></table><h2>${labels.bugReports}</h2><ul>${bugs}</ul><h2>${labels.gaps}</h2><ul>${gaps}</ul><script>function filterReport(q){q=q.toLowerCase();document.querySelectorAll('.searchable-row').forEach(r=>r.hidden=!r.textContent.toLowerCase().includes(q))}</script></body></html>`;
  const actionRows = (input.actionEvidence ?? []).map((action) =>
    `<tr class="searchable-row"><td>${safeHtml(action.caseId ?? labels.none)}</td><td>${safeHtml(action.phase)}</td><td>${safeHtml(action.actionKey)}</td><td>${safeHtml(action.actionSemantic)}</td><td>${safeHtml(action.entityReference ?? labels.none)}</td><td>${safeHtml(action.postcondition ?? labels.none)}</td><td>${safeHtml(action.evidenceRefs.join(", "))}</td><td>${action.evidenceArtifacts.map((artifact) => `${artifactLink(artifact.path, safeHtml)} <code>${safeHtml(artifact.sha256)}</code>`).join("<br>") || labels.none}</td></tr>`
  ).join("");
  const zh = input.locale?.toLowerCase().startsWith("zh");
  const actionHeading = zh ? "恢复与写操作证据" : "Recovery and write-action evidence";
  const actionCaveat = zh
    ? "账本动作状态和操作人产物是审计证据，不单独构成业务符合性结论。"
    : "Ledger action phases and operator artifacts support auditability; they are not by themselves a business conformance verdict.";
  const actionSection = `<section class="action-evidence"><h2>${actionHeading}</h2><p>${actionCaveat}</p><table><thead><tr><th>${labels.case}</th><th>${zh ? "动作阶段" : "Action phase"}</th><th>${zh ? "动作键" : "Action key"}</th><th>${zh ? "动作" : "Action"}</th><th>${zh ? "实体" : "Entity"}</th><th>${zh ? "后置条件" : "Postcondition"}</th><th>${zh ? "证据引用" : "Evidence refs"}</th><th>${labels.artifacts}</th></tr></thead><tbody>${actionRows || `<tr><td colspan=8 class=muted>${zh ? "暂无动作证据" : "No action evidence"}</td></tr>`}</tbody></table></section>`;
  const caseHeading = `<h2>${labels.cases}</h2>`;
  return html.replace(caseHeading, `${actionSection}${caseHeading}`);
}

function staticReportLabels(locale?: string) {
  if (locale?.toLowerCase().startsWith("zh")) {
    return {
    lang: "zh-CN", separator: "：", localeSeparator: ":", status: "状态", total: "总数", passed: "通过", failed: "失败", blocked: "阻塞", assurance: "验证强度", browserMode: "浏览器模式", runtimeImpact: "运行时影响", consoleErrors: "控制台错误", consoleErrorsHeader: "控制台错误", networkFailures: "网络失败", networkFailuresHeader: "网络失败", coverage: "测试意图覆盖", run: "运行", system: "系统", requirementProject: "需求项目", created: "创建时间", updated: "更新时间", locale: "Locale", requirementSets: "需求版本", search: "搜索报告", searchPlaceholder: "用例、状态、证据", intent: "意图", title: "标题", module: "模块", classification: "分类", reason: "原因", requirementRefs: "需求引用", noCoverage: "未关联覆盖台账", cases: "用例", case: "用例", actualOrNotExecuted: "实际结果 / 未执行原因", evidenceWarnings: "证据警告", steps: "步骤", artifacts: "产物", bugReports: "缺陷报告", gaps: "缺口", noCases: "暂无用例", noStepEvidence: "暂无步骤证据", expected: "预期", actual: "实际", stepUnit: "步骤", none: "无", currentProgress: "当前进度", stage: "阶段", currentStep: "当前步骤", elapsed: "耗时", page: "页面", waitReason: "等待原因", possiblyStalled: "可能已卡住", humanSummary: "白话摘要", executionCaveat: "运行通过不等于需求完整符合。", assuranceExplanation: "只有具备完整来源、断言和步骤证据的强验证结果，才可以作为需求符合性的依据。"
    };
  }
  return {
    lang: "en", separator: ":", localeSeparator: ":", status: "Status", total: "Total", passed: "Passed", failed: "Failed", blocked: "Blocked", assurance: "Assurance", browserMode: "Browser mode", runtimeImpact: "Runtime impact", consoleErrors: "console errors", consoleErrorsHeader: "Console errors", networkFailures: "network failures", networkFailuresHeader: "Network failures", coverage: "TestIntent coverage", run: "Run", system: "System", requirementProject: "Requirement project", created: "Created", updated: "Updated", locale: "Locale", requirementSets: "Requirement sets", search: "Search report", searchPlaceholder: "case, status, evidence", intent: "Intent", title: "Title", module: "Module", classification: "Classification", reason: "Reason", requirementRefs: "Requirement refs", noCoverage: "No coverage ledger attached", cases: "Cases", case: "Case", actualOrNotExecuted: "Actual result / not executed reason", evidenceWarnings: "Evidence warnings", steps: "Steps", artifacts: "Artifacts", bugReports: "BugReports", gaps: "Gaps", noCases: "No cases", noStepEvidence: "No step evidence", expected: "expected", actual: "actual", stepUnit: "step(s)", none: "None", currentProgress: "Current progress", stage: "Stage", currentStep: "Current step", elapsed: "Elapsed", page: "Page", waitReason: "Wait reason", possiblyStalled: "Possibly stalled", humanSummary: "Human-readable summary", executionCaveat: "A passing execution does not by itself prove complete requirement conformance.", assuranceExplanation: "Only strong evidence with complete sources, assertions, and step evidence supports a conformance conclusion."
  };
}

function staticReportLabelsFixed(locale?: string) {
  if (!locale?.toLowerCase().startsWith("zh")) {
    return staticReportLabels(locale);
  }
  return {
    lang: "zh-CN",
    separator: "：",
    localeSeparator: "：",
    status: "状态",
    total: "总数",
    passed: "通过",
    failed: "失败",
    blocked: "阻塞",
    assurance: "验证强度",
    browserMode: "浏览器模式",
    runtimeImpact: "运行时影响",
    consoleErrors: "控制台错误",
    consoleErrorsHeader: "控制台错误",
    networkFailures: "网络失败",
    networkFailuresHeader: "网络失败",
    coverage: "测试意图覆盖",
    run: "运行",
    system: "系统",
    requirementProject: "需求项目",
    created: "创建时间",
    updated: "更新时间",
    locale: "语言环境",
    requirementSets: "需求版本",
    search: "搜索报告",
    searchPlaceholder: "用例、状态、证据",
    intent: "意图",
    title: "标题",
    module: "模块",
    classification: "分类",
    reason: "原因",
    requirementRefs: "需求引用",
    noCoverage: "未关联覆盖台账",
    cases: "用例",
    case: "用例",
    actualOrNotExecuted: "实际结果 / 未执行原因",
    evidenceWarnings: "证据警告",
    steps: "步骤",
    artifacts: "产物",
    bugReports: "缺陷报告",
    gaps: "缺口",
    noCases: "暂无用例",
    noStepEvidence: "暂无步骤证据",
    expected: "预期",
    actual: "实际",
    stepUnit: "步",
    none: "无",
    currentProgress: "当前进度",
    stage: "阶段",
    currentStep: "当前步骤",
    elapsed: "耗时",
    page: "页面",
    waitReason: "等待原因",
    possiblyStalled: "可能已卡住",
    humanSummary: "白话摘要",
    executionCaveat: "运行通过不等于需求完整符合。",
    assuranceExplanation: "只有具备完整来源、断言和步骤证据的强验证结果，才可以作为需求符合性的依据。"
  };
}

function formatTimestamp(value: string, locale = "en-US") {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  try {
    return new Intl.DateTimeFormat(locale, {
      dateStyle: "medium",
      timeStyle: "medium"
    }).format(date);
  } catch {
    return new Intl.DateTimeFormat("en-US", {
      dateStyle: "medium",
      timeStyle: "medium"
    }).format(date);
  }
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ?? character);
}

function artifactLinks(paths: string[], safeHtml: (value: string) => string) {
  return paths.map((path) => artifactLink(path, safeHtml)).filter(Boolean).join("<br>");
}

function artifactLink(path: string | undefined, safeHtml: (value: string) => string) {
  if (!path) return "";
  const safePath = safeHtml(path);
  return `<a href="${safeHtml(artifactHref(safePath))}">${safePath}</a>`;
}

function artifactHref(path: string) {
  const normalized = path.replaceAll("\\", "/");
  if (/^[A-Za-z]:\//.test(normalized)) return `file:///${normalized}`;
  if (normalized.startsWith("/")) return `file://${normalized}`;
  if (/^[a-z][a-z\d+.-]*:/i.test(normalized) || normalized.startsWith("//")) return "#";
  return normalized;
}
