import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("Agent-native usage documentation", () => {
  it("keeps a concise Chinese-first requirement-first README", async () => {
    const content = await readFile("README.md", "utf8");

    for (const marker of [
      "Brain Creator",
      "面向中文团队",
      "## 产品形态",
      "Agent 对话",
      "MCP",
      "brain-creator init",
      "brain-creator doctor",
      "brain-creator plugin install",
      "五分钟开始",
      "没有独立 Web UI",
      "工程文件结构与代码分层",
      "System Brain 保存的页面知识",
      "docs/zh-CN/agent-usage.md",
      "真实 Trial",
      "MIT License"
    ]) {
      expect(content).toContain(marker);
    }

    expect(content.split("\n").length).toBeLessThan(300);
  });

  it("documents the requirement-first Agent flow and legacy compatibility", async () => {
    const content = await readFile("docs/agent-usage.md", "utf8");

    for (const marker of [
      "# Brain Creator Agent Usage Guide",
      "one sentence",
      "Requirement-First Flow",
      "Ingest The Requirement",
      "Analyze And Design",
      "Approve The Baseline",
      "Compile Executable Cases",
      "Preview And Execute",
      "Review Evidence",
      "Use Brain Creator to connect the order admin system",
      "source checkout mode",
      "MCP CLI connection mode",
      "repo-local plugin installation mode",
      "brain-creator init",
      "brain-creator doctor",
      "brain-creator help legacy",
      "bc_run_chain",
      "bc_create_auth_checkpoint",
      "bc_cancel_plan",
      "bc_resume_plan",
      "bc_report_gap",
      "npm run verify:l3-eval",
      "npm run verify:l3-eval:strict",
      "npm run verify:l3-eval:json"
    ]) {
      expect(content).toContain(marker);
    }
  });

  it("documents the session resume new-session entry point", async () => {
    const content = await readFile("docs/agent-usage.md", "utf8");

    expect(content).toContain("Session Resume: The New-Session Entry Point");
    expect(content).toContain("bc_session_resume");
    expect(content).toContain("6-7 independent queries");
    expect(content).toContain("Bridge preflight status");
    expect(content).toContain("docs/e2e-session-resume-workflow.md");
    expect(content).toContain("check the order-admin system status");
    expect(content).toContain("resume where I left off");
  });

  it("lists the session resume smoke command in verification commands", async () => {
    const content = await readFile("docs/agent-usage.md", "utf8");
    const packageJson = JSON.parse(await readFile("package.json", "utf8"));

    expect(content).toContain("npm run verify:live-session-resume-workflow");
    expect(packageJson.scripts["verify:live-session-resume-workflow"]).toContain(
      "scripts/liveSessionResumeWorkflowSmoke.ts"
    );
  });

  it("keeps the L3 evaluation scripts available in the source checkout", async () => {
    const packageJson = JSON.parse(await readFile("package.json", "utf8"));

    expect(packageJson.scripts["verify:l3-eval"]).toContain("scripts/l3Eval.ts");
    expect(packageJson.scripts["verify:l3-eval:strict"]).toContain("--strict");
    expect(packageJson.scripts["verify:l3-eval:json"]).toContain("--json");
  });
});
