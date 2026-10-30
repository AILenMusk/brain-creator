import { dirname, join, relative, resolve } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import type { BrowserExecutionMode } from "../domain/types.js";
import {
  normalizeReporterExitCode,
  parsePlaywrightJsonReport
} from "./playwrightReporter.js";
import { playwrightTestArgs } from "./browserObservation.js";
import {
  writeArtifactPlaywrightConfig,
  type ArtifactRunLayout
} from "../storage/artifactWorkspace.js";
import {
  spawnCommand,
  type CommandResult,
  type CommandRunner
} from "../agent/orchestrator.js";
import { redactSensitiveText } from "../shared/secretScan.js";

export type RunSubmittedPlaywrightInput = {
  workDir: string;
  testPath: string;
  systemId: string;
  runId?: string;
  browserMode?: BrowserExecutionMode;
  runner?: CommandRunner;
  protectedSecrets?: Record<string, string>;
};

/** Runs a host-produced Playwright file and persists only a structured, redacted report. */
export async function runSubmittedPlaywrightTest(input: RunSubmittedPlaywrightInput) {
  const runner = input.runner ?? spawnCommand;
  const artifactLayout = artifactLayoutFromTestPath(input.workDir, input.testPath);
  const testRunPath = relative(
    artifactLayout?.testsDir ?? input.workDir,
    input.testPath
  ).replace(/\\/g, "/");
  const playwrightConfigPath = artifactLayout
    ? await writeArtifactPlaywrightConfig({ workDir: input.workDir, layout: artifactLayout })
    : undefined;
  try {
    const rawResult = await runner(
      "npx",
      playwrightTestArgs(testRunPath, {
        browserMode: input.browserMode ?? "headless",
        structuredReporter: true,
        ...(playwrightConfigPath
          ? { configPath: relative(input.workDir, playwrightConfigPath).replace(/\\/g, "/") }
          : {})
      }),
      { cwd: input.workDir }
    );
    const protectedSecrets = input.protectedSecrets ?? {};
    const result: CommandResult = {
      ...rawResult,
      stdout: redactSensitiveText(rawResult.stdout, protectedSecrets),
      stderr: redactSensitiveText(rawResult.stderr, protectedSecrets),
      ...(rawResult.structuredReporter
        ? {
            structuredReporter: JSON.parse(
              redactSensitiveText(JSON.stringify(rawResult.structuredReporter), protectedSecrets)
            )
          }
        : {})
    };
    const reporter = result.structuredReporter ?? parseHostReporter(result.stdout);
    if (!reporter) {
      return {
        ...result,
        exitCode: result.exitCode === 0 ? 1 : result.exitCode,
        stderr: [
          result.stderr,
          "Structured Playwright Reporter output was missing; execution is not auditable."
        ].filter(Boolean).join("\n")
      };
    }
    const reporterPath = result.reporterPath ?? hostReporterPath(
      input.workDir,
      input.testPath,
      input.runId ?? "host-agent"
    );
    await mkdir(dirname(reporterPath), { recursive: true });
    if (!result.reporterPath) {
      await writeFile(reporterPath, `${JSON.stringify(reporter, null, 2)}\n`, "utf8");
    }
    return {
      ...result,
      exitCode: normalizeReporterExitCode(result.exitCode, reporter),
      structuredReporter: reporter,
      reporterPath
    };
  } catch (error) {
    return {
      exitCode: 1,
      stdout: "",
      stderr: error instanceof Error ? error.message : String(error)
    };
  }
}

function artifactLayoutFromTestPath(workDir: string, testPath: string): ArtifactRunLayout | undefined {
  const normalized = relative(workDir, testPath).replace(/\\/g, "/");
  if (!normalized.startsWith(".brain-creator/artifacts/")) return undefined;
  const root = dirname(dirname(resolve(workDir, testPath)));
  return {
    root,
    sourceDir: join(root, "source"),
    analysisDir: join(root, "analysis"),
    casesDir: join(root, "cases"),
    specsDir: join(root, "specs"),
    testsDir: join(root, "tests"),
    evidenceDir: join(root, "evidence"),
    reportDir: join(root, "report"),
    manifestPath: join(root, "manifest.json"),
    indexPath: join(root, "index.md"),
    latestPath: join(root, "..", "latest.json")
  };
}

function hostReporterPath(workDir: string, testPath: string, runId: string) {
  const normalized = relative(workDir, testPath).replace(/\\/g, "/");
  if (normalized.startsWith(".brain-creator/artifacts/")) {
    return join(dirname(dirname(resolve(workDir, testPath))), "evidence", `${runId}-playwright-report.json`);
  }
  return join(workDir, ".brain-creator", "runs", runId, "playwright-report.json");
}

function parseHostReporter(output: string) {
  try {
    return parsePlaywrightJsonReport(JSON.parse(output));
  } catch {
    return undefined;
  }
}
