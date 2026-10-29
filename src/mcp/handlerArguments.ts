import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { BrainCreatorService } from "../domain/service.js";
import { formatScenariosAsMarkdown, parseSpecMarkdown } from "../agent/caseFormatter.js";
import {
  InMemoryBrainCreatorRepository,
  JsonFileBrainCreatorRepository,
  ShardedFileBrainCreatorRepository,
  SHARDED_REPOSITORY_SCHEMA_VERSION
} from "../domain/repository.js";
import { generateSeedFile } from "../agent/seedGenerator.js";
import { validatePageObjectUsage } from "../agent/pageObjectValidation.js";
import { runSubmittedPlaywrightTest } from "../execution/hostPlaywrightRunner.js";
import {
  requiredPageObjectBindingsForSteps,
  validateConfirmedSystemPageObjectBindings,
  type RequiredSystemPageObjectBinding
} from "../execution/systemPageObject.js";
import { buildAgentPrompt } from "../agent/promptBuilder.js";
import { checkBusinessRules } from "../agent/qualityGate.js";
import { extractCandidateTerms } from "../agent/termExtractor.js";
import { createConfiguredAgentBridge } from "../agent/bridgeProvider.js";
import {
  mergeRuntimeConfiguration,
  readRuntimeConfiguration,
  resolveRuntimeConfigurationPath,
  runtimeEnvironment,
  writeRuntimeConfiguration,
  type RuntimeConfiguration,
  type RuntimeConfigurationPatch
} from "../agent/runtimeConfiguration.js";
import {
  verifyStoredBrowserAuth,
  type AuthStateVerification,
  type AuthStateVerifier
} from "../agent/authStateVerifier.js";
import {
  materializeBrowserAuthState,
  type AuthStateMaterializer
} from "../agent/authStateMaterializer.js";
import {
  AuthStateRefreshRegistry,
  createDefaultAuthRefreshRegistry,
  type AuthRefreshAdapter,
  type AuthStateRefresher
} from "../agent/authStateRefresh.js";
import { createStandardAuthProviderAdapters } from "../agent/standardAuthProviders.js";
import { BrainCreatorError, errorEnvelope, successEnvelope } from "../shared/envelope.js";
import {
  resolveBrainCreatorDataFile,
  resolveBrainCreatorStoreDir,
  resolveBrainCreatorKnowledgeDir,
  resolveBrainCreatorWorkspace
} from "../shared/workspace.js";
import { KnowledgeService } from "../knowledge/service.js";
import { RequirementAnalysisHostHarness } from "../knowledge/requirementHarness.js";
import {
  resolveRequirementSource,
  type RequirementSourceReader
} from "../knowledge/sourceAdapters.js";
import { FeishuOpenApiAdapter } from "../knowledge/feishuAdapter.js";
import type { HostDownloadedAttachment } from "../knowledge/attachmentPipeline.js";
import { writeArtifactManifest } from "../storage/artifactArchive.js";
import {
  artifactFileName,
  resolveArtifactRunLayout,
  type ArtifactRunLayout
} from "../storage/artifactWorkspace.js";
import { writeStaticSuiteExecutionReport } from "../execution/staticSuiteReport.js";
import { writeStaticDocumentSuiteReport } from "../execution/staticDocumentSuiteReport.js";
import { configuredPostconditionVerifier } from "../execution/configuredPostconditionVerifier.js";
import type {
  ExecutionPostconditionVerifier,
  PostconditionVerification
} from "../execution/postconditionVerifier.js";
import {
  validateManualPostconditionEvidenceArtifacts,
  validatePostconditionVerificationArtifacts
} from "../execution/postconditionVerifier.js";
import { browserObservationCapability } from "../execution/browserObservation.js";
import { normalizeHostSkillAnalysis } from "../knowledge/policies.js";
import { assessRequirementSourceComplexity } from "../knowledge/requirementRouting.js";
import { buildContextPack } from "../knowledge/retriever.js";
import { reconcileRequirementCoverage } from "../knowledge/requirementReconciliation.js";
import {
  evaluateStabilityPolicy,
  isStabilityScheduleDue
} from "../knowledge/stabilityPolicy.js";
import {
  SystemExplorationCoordinator,
  type SystemExplorer
} from "../knowledge/systemExplorer.js";
import {
  TestDataProviderService,
  type TestDataNoEffectVerifier,
  type TestDataSubmitResult
} from "../knowledge/testDataProvider.js";
import { ExecutionPreflightService } from "../knowledge/executionPreflight.js";
import { StatefulExplorationPlanService } from "../knowledge/statefulExplorationPlan.js";
import { OnboardingPlanService } from "../knowledge/onboardingPlan.js";
import { buildCaseDependencyGraph } from "../knowledge/caseDependencyGraph.js";
import { RequirementSuiteRunService } from "../knowledge/requirementSuiteRun.js";
import { RunLedgerService, verifyRunLedgerIntegrityChains } from "../knowledge/runLedger.js";
import { ExecutionDiagnosisService } from "../knowledge/executionDiagnosis.js";
import {
  classifyEvidenceFailure,
  recoverExecutionState
} from "../knowledge/executionRecovery.js";
import {
  projectExecutionTasks,
  type UnifiedExecutionTask
} from "../knowledge/executionTaskProjection.js";
import {
  classifyExecutionFailure as classifyFailure
} from "../knowledge/failureClassifier.js";
import {
  commandRunnerAgentBridge,
  generatePlanDraft,
  preflightAgentBridge,
  runAgent,
  runChain,
  validateActorJourneyUsage,
  validateStepInstrumentation,
  type AgentBridge,
  type AgentBridgeWithMetadata,
  type CommandResult,
  type CommandRunner
} from "../agent/orchestrator.js";
import { runInHarness } from "../agent/harnessAdapter.js";
import {
  evaluateStructuredAgentOutput,
  plannerOutputFromResult
} from "../brain/harnessSchema.js";
import { HarnessRuntime } from "../brain/harness.js";
import type { BrainEvalResult, EvaluationTrial } from "../brain/types.js";
import { SemanticSpineService } from "../brain/semanticSpine.js";
import { SystemBrainSnapshotService } from "../brain/systemSnapshot.js";
import {
  InMemoryTestDataProvider,
  TestDataBrainService,
  type TestDataProvider
} from "../brain/testdata.js";
import { configuredTestDataAdapter } from "../brain/configuredTestDataAdapter.js";
import {
  EvaluationProviderRegistry,
  type MutationOutcome
} from "../brain/scenarioAssurance.js";
import { EvaluationIntegrityService } from "../evaluation/evaluationIntegrity.js";
import { authCheckpointBinding } from "../evaluation/authCheckpointBinding.js";
import { calculateEvaluationTrialMetrics, isLinkedEvaluationRun } from "../evaluation/evaluationMetrics.js";
import { revalidateExecutionEvidence, revalidateRunLedgerActionEvidence } from "../evaluation/evidenceRevalidation.js";
import {
  historicalEvidenceSourceFingerprint,
  reevaluateHistoricalEvidence
} from "../evaluation/historicalEvidenceReevaluation.js";
import { validateExecutionArtifacts } from "../execution/artifactValidation.js";
import { hasValidExecutionEvidenceSnapshot } from "../execution/evidenceSnapshot.js";
import { RequirementGateService } from "../evaluation/requirementGate.js";
import { parseCaseSource, summarizeDocumentCases, type ParsedCaseSource } from "../caseSource/parser.js";
import { writeXlsxCaseSourceResults } from "../caseSource/writeBack.js";
import { id } from "../shared/id.js";
import { readRuntimeIdentity } from "../shared/runtimeIdentity.js";
import { resolveProtectedStorageStatePath } from "../shared/authStorage.js";
import { createWorkspaceIntegrityAuthenticator, decryptSecrets } from "../shared/crypto.js";
import { redactSensitiveText, scanSensitivePatterns, scanSensitiveValues } from "../shared/secretScan.js";
import type {
  AgentRun,
  AgentTask,
  AuthCheckpoint,
  AuthProfile,
  BrowserExecutionMode,
  BugReport,
  CaseSuiteRun,
  CaseSuite,
  CaseSuiteCaseResult,
  ChainRun,
  CompileRun,
  DocumentCase,
  ExecutableCase,
  ExecutionEvidence,
  ExecutionDiagnosis,
  ExecutionDiagnosisVerdict,
  ExecutionPlan,
  ExecutionFailureType,
  ExecutionProvenance,
  ExecutionPreflightCheck,
  Gap,
  RequirementSuiteCaseOutcome,
  RequirementSuiteRun,
  RequirementContentPackage,
  TestArtifact,
  TestCaseScenario,
  TestCaseStep,
  TestDataTask,
  KnowledgeNodeType,
  LegacyDiagnosisDecision,
  SystemProfile,
  StabilityPolicy,
  TestCase
} from "../domain/types.js";
import type {
  BrainCreatorToolName,
  BrainCreatorToolRequest
} from "./tools.js";
import type { BrainCreatorMcpContext, KnowledgeReviewTarget } from "./handlers.js";

export function textResult(data: unknown): CallToolResult {
  return envelopeResult(successEnvelope(data), false);
}

export function facadeTextResult(data: unknown, input: Record<string, unknown>): CallToolResult {
  if (responseModeArg(input) === "full") return textResult(data);
  return textResult(compactFacadePayload(data));
}

export function compactFacadePayload(data: unknown) {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return { responseMode: "summary", status: "succeeded", summary: data };
  }
  const record = data as Record<string, unknown>;
  if (typeof record.compileRunId === "string" && !record.items) {
    return { ...record, responseMode: "summary" };
  }
  const preferredSummary =
    record.reviewSummary ?? record.userSummary ?? record.summary ?? summarizeFacadeRecord(record);
  const adjudicationReview = record.adjudication && record.evaluation && typeof record.evaluation === "object"
    ? record.evaluation as { verdict?: unknown; reasons?: unknown; nextActions?: unknown }
    : undefined;
  return {
    responseMode: "summary",
    status: typeof record.status === "string" ? record.status : "succeeded",
    ...(typeof record.mode === "string" ? { mode: record.mode } : {}),
    ...(typeof record.stage === "string" ? { stage: record.stage } : {}),
    summary: preferredSummary,
    ...(record.runtimeIdentity ? { runtimeIdentity: record.runtimeIdentity } : {}),
    ...(record.recoveryCapabilities ? { recoveryCapabilities: record.recoveryCapabilities } : {}),
    ...(record.runtimeCapabilities ? { runtimeCapabilities: record.runtimeCapabilities } : {}),
    ...(typeof record.nextAction === "string" ? { nextAction: record.nextAction } : {}),
    ...(typeof record.requiresConfirmation === "boolean"
      ? { requiresConfirmation: record.requiresConfirmation }
      : {}),
    ...(adjudicationReview && typeof adjudicationReview.verdict === "string"
      ? {
          review: {
            verdict: adjudicationReview.verdict,
            reasons: Array.isArray(adjudicationReview.reasons) ? adjudicationReview.reasons : [],
            nextActions: Array.isArray(adjudicationReview.nextActions) ? adjudicationReview.nextActions : []
          }
        }
      : {}),
    references: facadeReferences(record)
  };
}

export function summarizeFacadeRecord(record: Record<string, unknown>) {
  const summary = Object.fromEntries(
    Object.entries(record)
      .filter(([, value]) =>
        typeof value === "string" || typeof value === "number" || typeof value === "boolean"
      )
      .slice(0, 20)
  );
  for (const key of ["verificationEvidence", "counts", "completeness"]) {
    if (record[key] && typeof record[key] === "object") summary[key] = record[key];
  }
  if (typeof record.baseUrl === "string" && Array.isArray(record.urlAllowlist)) {
    summary.urlAllowlist = record.urlAllowlist;
  }
  return summary;
}

export function facadeReferences(value: unknown, depth = 0): Record<string, string>[] {
  if (!value || typeof value !== "object" || depth > 3) return [];
  const references: Record<string, string>[] = [];
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (typeof child === "string" && (/(?:Id|Path)$/i.test(key) || key === "id")) {
      references.push({ [key]: child });
    } else if (Array.isArray(child)) {
      for (const item of child.slice(0, 10)) {
        references.push(...facadeReferences(item, depth + 1));
      }
    } else if (child && typeof child === "object") {
      references.push(...facadeReferences(child, depth + 1));
    }
    if (references.length >= 30) break;
  }
  return references.slice(0, 30);
}

export function envelopeResult(envelope: unknown, isError: boolean): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(envelope, null, 2) }],
    isError
  };
}

export function stringArg(input: Record<string, unknown>, key: string): string {
  const value = input[key];
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${key} is required`);
  }
  return value;
}

export function optionalStringArg(input: Record<string, unknown>, key: string): string | undefined {
  const value = input[key];
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

export function executionProvenanceArg(input: Record<string, unknown>): ExecutionProvenance | undefined {
  const value = optionalStringArg(input, "executionProvenance");
  if (value === undefined) return undefined;
  if (value === "real-system" || value === "synthetic" || value === "unknown") return value;
  throw new Error("executionProvenance must be real-system, synthetic, or unknown");
}

export function optionalNumberArg(input: Record<string, unknown>, key: string): number | undefined {
  const value = input[key];
  return typeof value === "number" ? value : undefined;
}

export function numberArg(input: Record<string, unknown>, key: string): number {
  const value = input[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${key} must be a number`);
  }
  return value;
}

export function optionalBooleanArg(input: Record<string, unknown>, key: string): boolean {
  return input[key] === true;
}

export function mutationResultsArg(input: Record<string, unknown>): MutationOutcome[] {
  const value = input.mutationResults;
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error("mutationResults must be an array");
  return value.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error(`mutationResults[${index}] must be an object`);
    }
    const record = item as Record<string, unknown>;
    const status = record.status;
    if (typeof record.id !== "string" || typeof record.scenarioId !== "string") {
      throw new Error(`mutationResults[${index}] requires id and scenarioId`);
    }
    if (status !== "caught" && status !== "survived" && status !== "blocked") {
      throw new Error(`mutationResults[${index}].status is invalid`);
    }
    const evidenceRefs = record.evidenceRefs;
    return {
      id: record.id,
      scenarioId: record.scenarioId,
      status: status as MutationOutcome["status"],
      evidenceRefs: Array.isArray(evidenceRefs)
        ? evidenceRefs.filter((item): item is string => typeof item === "string")
        : [],
      reason: typeof record.reason === "string" ? record.reason : undefined
    };
  });
}

export async function materializeAuthStorageState(
  context: BrainCreatorMcpContext,
  system: SystemProfile,
  authProfile: AuthProfile,
  force: boolean = false
) {
  const capture = context.service.getCaptureAuth(authProfile.id);
  const existing = capture?.secrets.storageStatePath;
  if (existing) return existing;
  if (!force && (!authProfile.verificationEvidence || authProfile.status !== "succeeded")) return undefined;
  if (!force && authProfile.loginMethod !== "token" && authProfile.loginMethod !== "cookie") {
    return undefined;
  }
  if (authProfile.loginMethod !== "token" && authProfile.loginMethod !== "cookie") {
    return undefined;
  }
  const hasSecret = authProfile.loginMethod === "token"
    ? Boolean(capture?.secrets.token)
    : Boolean(capture?.secrets.cookie);
  if (!hasSecret) return undefined;
  const materialized = await context.authStateMaterializer({
    workDir: context.workDir,
    system,
    authProfile
  });
  context.service.setAuthStorageStatePath(authProfile.id, materialized.storageStatePath);
  context.authVerificationCache.delete(authProfile.id);
  return materialized.storageStatePath;
}

export function actorJourneyArg(input: Record<string, unknown>) {
  const value = input.actorJourney;
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new Error("actorJourney must be an array");
  return value.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error(`actorJourney[${index}] must be an object`);
    }
    const record = item as Record<string, unknown>;
    return {
      role: optionalStringArg(record, "role"),
      authProfileId: stringArg(record, "authProfileId"),
      afterStepId: optionalStringArg(record, "afterStepId"),
      sourceRefs: optionalStringArrayArg(record, "sourceRefs") ?? []
    };
  });
}

export function explorationScenarioArg(input: Record<string, unknown>) {
  const value = input.explorationScenario;
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("explorationScenario must be an object");
  }
  const record = value as Record<string, unknown>;
  const name = stringArg(record, "name");
  const dataRefs = optionalStringArrayArg(record, "dataRefs") ?? [];
  return {
    id: optionalStringArg(record, "id"),
    name,
    role: optionalStringArg(record, "role"),
    prerequisiteState: optionalStringArg(record, "prerequisiteState"),
    dataRefs,
    testDataLeaseIds: optionalStringArrayArg(record, "testDataLeaseIds") ?? [],
    selectorValues: recordArg(record, "selectorValues")
  };
}

export function summarizeCoverageDimensions(
  items: Array<{
    coverage?: {
      required: readonly string[];
      verified: readonly string[];
      missing: readonly string[];
    };
  }>
) {
  const dimensions = [...new Set(items.flatMap((item) => item.coverage?.required ?? []))];
  return dimensions.map((dimension) => ({
    dimension,
    required: items.filter((item) => item.coverage?.required.includes(dimension)).length,
    verified: items.filter((item) => item.coverage?.verified.includes(dimension)).length,
    missing: items.filter((item) => item.coverage?.missing.includes(dimension)).length
  }));
}

export function planContextArg(input: Record<string, unknown>): AgentTask["planContext"] | undefined {
  const value = input.planContext;
  if (value === undefined) {
    return undefined;
  }
  if (!value || typeof value !== "object") {
    throw new Error("planContext must be an object");
  }
  const candidate = value as Record<string, unknown>;
  const requirement = candidate.requirement;
  const specPath = candidate.specPath;
  const promptPath = candidate.promptPath;
  const seedPath = candidate.seedPath;
  if (
    typeof requirement !== "string" ||
    typeof specPath !== "string" ||
    typeof promptPath !== "string" ||
    typeof seedPath !== "string"
  ) {
    throw new Error("planContext requires requirement, specPath, promptPath, and seedPath");
  }
  return { requirement, specPath, promptPath, seedPath };
}

export function chainContextArg(input: Record<string, unknown>): AgentTask["chainContext"] | undefined {
  const value = input.chainContext;
  if (value === undefined) {
    return undefined;
  }
  if (!value || typeof value !== "object") {
    throw new Error("chainContext must be an object");
  }
  const candidate = value as Record<string, unknown>;
  const testCaseId = candidate.testCaseId;
  const specPath = candidate.specPath;
  const seedPath = candidate.seedPath;
  const testPath = candidate.testPath;
  const generateRunId = candidate.generateRunId;
  const maxHealAttempts = candidate.maxHealAttempts;
  const healAttempts = candidate.healAttempts;
  const knowledgeProjectId = candidate.knowledgeProjectId;
  const executableCaseId = candidate.executableCaseId;
  const executionPlanId = candidate.executionPlanId;
  const requirementSuiteRunId = candidate.requirementSuiteRunId;
  const executionEvidenceId = candidate.executionEvidenceId;
  const contextPackPath = candidate.contextPackPath;
  const requiredStepIds = candidate.requiredStepIds;
  const requiredPageObjectBindings = candidate.requiredPageObjectBindings;
  const actorJourneyRoles = candidate.actorJourneyRoles;
  const browserMode = candidate.browserMode;
  if (typeof testCaseId !== "string" || typeof specPath !== "string" || typeof testPath !== "string") {
    throw new Error("chainContext requires testCaseId, specPath, and testPath");
  }
  if (generateRunId !== undefined && typeof generateRunId !== "string") {
    throw new Error("chainContext generateRunId must be a string when provided");
  }
  if (seedPath !== undefined && typeof seedPath !== "string") {
    throw new Error("chainContext seedPath must be a string when provided");
  }
  if (maxHealAttempts !== undefined && (typeof maxHealAttempts !== "number" || maxHealAttempts < 0)) {
    throw new Error("chainContext maxHealAttempts must be a non-negative number when provided");
  }
  if (healAttempts !== undefined && (typeof healAttempts !== "number" || healAttempts < 0)) {
    throw new Error("chainContext healAttempts must be a non-negative number when provided");
  }
  for (const [name, value] of Object.entries({
    knowledgeProjectId,
    executableCaseId,
    executionPlanId,
    requirementSuiteRunId,
    executionEvidenceId,
    contextPackPath
  })) {
    if (value !== undefined && typeof value !== "string") {
      throw new Error(`chainContext ${name} must be a string when provided`);
    }
  }
  for (const [name, value] of Object.entries({ requiredStepIds, actorJourneyRoles })) {
    if (
      value !== undefined &&
      (!Array.isArray(value) || value.some((item) => typeof item !== "string"))
    ) {
      throw new Error(`chainContext ${name} must be an array of strings when provided`);
    }
  }
  if (
    requiredPageObjectBindings !== undefined &&
    (!Array.isArray(requiredPageObjectBindings) ||
      requiredPageObjectBindings.some((item) => {
        if (!item || typeof item !== "object") return true;
        const binding = item as Record<string, unknown>;
        return typeof binding.pageModelId !== "string" || typeof binding.locatorPointId !== "string";
      }))
  ) {
    throw new Error("chainContext requiredPageObjectBindings must be an array of page/locator id pairs");
  }
  if (browserMode !== undefined && browserMode !== "headless" && browserMode !== "observe") {
    throw new Error("chainContext browserMode must be headless or observe");
  }
  return {
    testCaseId,
    specPath,
    seedPath,
    testPath,
    generateRunId,
    maxHealAttempts,
    healAttempts,
    knowledgeProjectId: knowledgeProjectId as string | undefined,
    executableCaseId: executableCaseId as string | undefined,
    executionPlanId: executionPlanId as string | undefined,
    requirementSuiteRunId: requirementSuiteRunId as string | undefined,
    executionEvidenceId: executionEvidenceId as string | undefined,
    contextPackPath: contextPackPath as string | undefined,
    requiredStepIds: requiredStepIds as string[] | undefined,
    requiredPageObjectBindings: requiredPageObjectBindings as RequiredSystemPageObjectBinding[] | undefined,
    actorJourneyRoles: actorJourneyRoles as string[] | undefined,
    browserMode: browserMode as "headless" | "observe" | undefined
  };
}

export async function archiveRequirementSuiteRun(
  context: BrainCreatorMcpContext,
  run: RequirementSuiteRun
) {
  const executableCaseIds = new Set(run.caseRuns.map((item) => item.executableCaseId));
  const executableCases = run.caseRuns
    .map((item) => context.repository.executableCases.find((candidate) => candidate.id === item.executableCaseId))
    .filter((item): item is NonNullable<typeof item> => Boolean(item));
  const requirementSetIds = [...new Set(executableCases.map((item) => item.requirementSetId))];
  const requirementSetIdSet = new Set(requirementSetIds);
  const requirementSetId = requirementSetIds.length === 1
    ? requirementSetIds[0]
    : requirementSetIds.length > 1
      ? "multi-requirement"
      : "unscoped";
  const coverage = context.knowledgeService
    .testIntentCoverage(run.knowledgeProjectId, run.systemId)
    .items
    .filter((item) => requirementSetIdSet.has(item.requirementSetId))
    .map((item) => ({
      testIntentId: item.testIntentId,
      title: item.title,
      module: item.module,
      classification: item.classification,
      classificationReason: item.classificationReason,
      requirementRefs: item.requirementRefs
    }));
  const evidence = run.caseRuns.flatMap((caseRun) => {
    const item = caseRun.executionEvidenceId
      ? context.repository.executionEvidence.find((candidate) => candidate.id === caseRun.executionEvidenceId)
      : undefined;
    return item ? [item] : [];
  });
  const system = context.repository.systemProfiles.find((item) => item.id === run.systemId);
  const singleRequirement = requirementSetIds.length === 1
    ? context.repository.requirementSets.find((item) => item.id === requirementSetIds[0])
    : undefined;
  const artifactLayout = resolveArtifactRunLayout({
    workDir: context.workDir,
    systemKey: system?.name ?? run.systemId,
    requirementKey: singleRequirement?.title ?? requirementSetId,
    requirementVersion: singleRequirement?.version,
    suiteRunId: run.id
  });
  const snapshotPaths = await writeRequirementSuiteSnapshots(
    context,
    run,
    requirementSetIds,
    executableCases,
    coverage,
    artifactLayout
  );
  const reportPath = join(artifactLayout.reportDir, "suite-report.html");
  await writeStaticSuiteExecutionReport({
    outputPath: reportPath,
    title: `Brain Creator requirement suite ${run.id}`,
    run,
    requirementSetIds,
    locale: system?.defaultLocale,
    evidence,
    coverage,
    bugs: context.repository.bugReports
      .filter((bug) => bug.systemId === run.systemId && executableCaseIds.has(bug.sourceId))
      .map((bug) => ({ id: bug.id, status: bug.status, caseNo: bug.caseNo, actualResult: bug.actualResult })),
    gaps: context.repository.gaps
      .filter((gap) => gap.projectId === run.systemId && (gap.sourceId === run.id || executableCaseIds.has(gap.sourceId)))
      .map((gap) => ({ id: gap.id, status: gap.status, caseNo: gap.sourceId, reason: gap.reason })),
    progress: context.runLedger.progress(run.id),
    actionEvidence: [...new Map(
      context.runLedger.list({ requirementSuiteRunId: run.id })
        .filter((entry) => Boolean(entry.actionKey && entry.actionPhase))
        .map((entry) => [entry.actionKey!, entry])
    ).values()].map((entry) => ({
      ...(entry.executableCaseId || entry.caseNo
        ? { caseId: entry.executableCaseId ?? entry.caseNo }
        : {}),
      phase: entry.actionPhase!,
      actionKey: entry.actionKey!,
      actionSemantic: entry.actionSemantic ?? "",
      ...(entry.entityReference ? { entityReference: entry.entityReference } : {}),
      ...(entry.actionPostcondition ? { postcondition: entry.actionPostcondition } : {}),
      evidenceRefs: entry.actionEvidenceRefs ?? [],
      evidenceArtifacts: (entry.actionEvidenceArtifacts ?? []).map((artifact) => ({
        path: join(context.workDir, ".brain-creator", artifact.path),
        sha256: artifact.sha256
      }))
    })),
    protectedSecrets: protectedSecretsForSystem(context, run.systemId)
  });
  run.reportPath = reportPath;
  const artifactManifest = await writeArtifactManifest({
    workDir: context.workDir,
    systemId: run.systemId,
    requirementSetId,
    suiteRunId: run.id,
    requirementSetIds,
    artifactPaths: [
      ...snapshotPaths,
      reportPath,
      ...evidence.flatMap((item) => item.artifactPaths),
      ...context.runLedger.list({ requirementSuiteRunId: run.id })
        .flatMap((entry) => (entry.actionEvidenceArtifacts ?? []).map((artifact) =>
          join(context.workDir, ".brain-creator", artifact.path)
        ))
    ],
    sourceRefs: requirementSetIds,
    ownershipDirectory: artifactLayout.root,
    protectedSecrets: protectedSecretsForSystem(context, run.systemId)
  });
  context.repository.persist();
  return { reportPath, artifactManifest };
}

export async function writeRequirementSuiteSnapshots(
  context: BrainCreatorMcpContext,
  run: RequirementSuiteRun,
  requirementSetIds: string[],
  executableCases: ExecutableCase[],
  coverage: Array<Record<string, unknown>>,
  layout: ArtifactRunLayout
) {
  const requirementIdSet = new Set(requirementSetIds);
  const requirementSets = context.repository.requirementSets.filter(
    (item) => requirementIdSet.has(item.id)
  );
  const sourceIds = new Set(requirementSets.map((item) => item.sourceId));
  const sourcePath = join(layout.sourceDir, "requirements.json");
  const analysisPath = join(layout.analysisDir, "knowledge-and-coverage.json");
  const casesPath = join(layout.casesDir, "executable-cases.json");
  await Promise.all([
    mkdir(layout.sourceDir, { recursive: true }),
    mkdir(layout.analysisDir, { recursive: true }),
    mkdir(layout.casesDir, { recursive: true })
  ]);
  await Promise.all([
    writeFile(sourcePath, `${JSON.stringify({
      knowledgeProject: context.repository.knowledgeProjects.find(
        (item) => item.id === run.knowledgeProjectId
      ),
      requirementSets,
      requirementSources: context.repository.requirementSources.filter(
        (item) => sourceIds.has(item.id)
      )
    }, null, 2)}\n`, "utf8"),
    writeFile(analysisPath, `${JSON.stringify({
      coverage,
      workflowModels: context.repository.workflowModels.filter(
        (item) => requirementIdSet.has(item.requirementSetId)
      ),
      stateMachineModels: context.repository.stateMachineModels.filter(
        (item) => requirementIdSet.has(item.requirementSetId)
      ),
      attachmentAnalyses: context.repository.attachmentAnalyses.filter(
        (item) => requirementIdSet.has(item.requirementSetId)
      )
    }, null, 2)}\n`, "utf8"),
    writeFile(casesPath, `${JSON.stringify({
      executableCases,
      executionPlans: context.repository.executionPlans.filter(
        (item) => executableCases.some((candidate) => candidate.id === item.executableCaseId)
      )
    }, null, 2)}\n`, "utf8")
  ]);
  return [sourcePath, analysisPath, casesPath];
}

export function createRequirementBugReport(
  context: BrainCreatorMcpContext,
  input: {
    executableCase: ExecutableCase;
    chainRun: ChainRun;
    failureReason: string;
    artifactPaths: string[];
    diagnosisId?: string;
  }
) {
  const intent = context.repository.testIntents.find(
    (item) => item.id === input.executableCase.testIntentId
  );
  return context.service.createBugReport({
    systemId: input.chainRun.systemId,
    sourceId: input.executableCase.id,
    caseNo: input.executableCase.id,
    caseTitle: input.executableCase.title,
    module: intent?.module ?? "General",
    priority: intent?.priority ?? "P0",
    expectedResult:
      intent?.expectedResults.join("; ") ?? "Behavior matches the approved requirement",
    actualResult: input.failureReason,
    reproductionSteps: input.executableCase.steps.map(
      (step) => `${step.order}. ${step.instruction}`
    ),
    evidencePaths: input.artifactPaths,
    chainRunId: input.chainRun.id,
    diagnosisId: input.diagnosisId,
    gapIds: []
  });
}

export function suiteContextArg(input: Record<string, unknown>): AgentTask["suiteContext"] | undefined {
  const value = input.suiteContext;
  if (value === undefined) {
    return undefined;
  }
  if (!value || typeof value !== "object") {
    throw new Error("suiteContext must be an object");
  }
  const candidate = value as Record<string, unknown>;
  const suiteId = candidate.suiteId;
  const sourceId = candidate.sourceId;
  const caseNo = candidate.caseNo;
  const title = candidate.title;
  if (
    typeof suiteId !== "string" ||
    typeof sourceId !== "string" ||
    typeof caseNo !== "string" ||
    typeof title !== "string"
  ) {
    throw new Error("suiteContext requires suiteId, sourceId, caseNo, and title");
  }
  return { suiteId, sourceId, caseNo, title };
}

export function regressionContextArg(
  input: Record<string, unknown>
): AgentTask["regressionContext"] | undefined {
  const value = input.regressionContext;
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object") {
    throw new Error("regressionContext must be an object");
  }
  const candidate = value as Record<string, unknown>;
  const bugReportId = candidate.bugReportId;
  const sourceId = candidate.sourceId;
  const caseNo = candidate.caseNo;
  const title = candidate.title;
  const previousStatus = candidate.previousStatus;
  const remainingBugIds = candidate.remainingBugIds;
  const maxHealAttempts = candidate.maxHealAttempts;
  if (
    typeof bugReportId !== "string" ||
    typeof sourceId !== "string" ||
    typeof caseNo !== "string" ||
    typeof title !== "string" ||
    (previousStatus !== "open" && previousStatus !== "retest-failed") ||
    !Array.isArray(remainingBugIds) ||
    remainingBugIds.some((item) => typeof item !== "string") ||
    (maxHealAttempts !== undefined &&
      (typeof maxHealAttempts !== "number" || maxHealAttempts < 0))
  ) {
    throw new Error(
      "regressionContext requires bugReportId, sourceId, caseNo, title, previousStatus, and remainingBugIds"
    );
  }
  return {
    bugReportId,
    sourceId,
    caseNo,
    title,
    previousStatus,
    remainingBugIds: remainingBugIds as string[],
    maxHealAttempts: maxHealAttempts as number | undefined
  };
}

export function runModeArg(input: Record<string, unknown>, key: string) {
  const value = stringArg(input, key);
  if (
    ![
      "approved-case",
      "full-workflow",
      "case-source-suite",
      "bug-regression",
      "requirement-suite"
    ].includes(value)
  ) {
    throw new Error(`${key} is invalid`);
  }
  return value as
    | "approved-case"
    | "full-workflow"
    | "case-source-suite"
    | "bug-regression"
    | "requirement-suite";
}

export function browserModeArg(input: Record<string, unknown>): BrowserExecutionMode | undefined {
  const value = optionalStringArg(input, "browserMode");
  if (value === undefined) return undefined;
  if (value !== "headless" && value !== "observe") {
    throw new Error("browserMode must be headless or observe");
  }
  return value;
}

export function suiteActionArg(input: Record<string, unknown>) {
  const value = optionalStringArg(input, "suiteAction") ?? "continue";
  if (!["continue", "cancel", "retry", "skip", "claim-next-scheduled", "process-next-scheduled", "claim-scheduled", "renew-scheduled", "release-scheduled"].includes(value)) {
    throw new Error("suiteAction is invalid");
  }
  return value as
    | "continue"
    | "cancel"
    | "retry"
    | "skip"
    | "claim-next-scheduled"
    | "process-next-scheduled"
    | "claim-scheduled"
    | "renew-scheduled"
    | "release-scheduled";
}

export function explorationPlanActionsArg(input: Record<string, unknown>) {
  const value = input.explorationPlanActions;
  if (!Array.isArray(value)) throw new Error("explorationPlanActions must be an array");
  return value.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error(`explorationPlanActions[${index}] must be an object`);
    }
    const record = item as Record<string, unknown>;
    return {
      name: stringArg(record, "name"),
      route: stringArg(record, "route"),
      role: optionalStringArg(record, "role"),
      write: optionalBooleanArg(record, "write"),
      sourceRefs: stringArrayArg(record, "sourceRefs"),
      requirementRefs: stringArrayArg(record, "requirementRefs"),
      systemEvidenceRefs: stringArrayArg(record, "systemEvidenceRefs"),
      coverageItemIds: stringArrayArg(record, "coverageItemIds")
    };
  });
}

export function explorationCleanupPolicyArg(
  input: Record<string, unknown>,
  key: string
) {
  const value = stringArg(input, key);
  if (value !== "delete" && value !== "close" && value !== "retain-with-label") {
    throw new Error(`${key} is invalid`);
  }
  return value;
}

export function onboardingApprovalStageArg(input: Record<string, unknown>) {
  const value = optionalStringArg(input, "approvalStage") ?? "exploration";
  if (value !== "exploration" && value !== "execution") {
    throw new Error("approvalStage is invalid");
  }
  return value as "exploration" | "execution";
}

export function explorationResultArg(input: Record<string, unknown>) {
  const value = input.explorationResult;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("explorationResult must be an object");
  }
  const record = value as Record<string, unknown>;
  const status = stringArg(record, "status");
  if (status !== "succeeded" && status !== "failed") {
    throw new Error("explorationResult.status is invalid");
  }
  const cleanupStatus = stringArg(record, "cleanupStatus");
  if (cleanupStatus !== "completed" && cleanupStatus !== "not-required" && cleanupStatus !== "failed") {
    throw new Error("explorationResult.cleanupStatus is invalid");
  }
  const rawActions = record.actionEvidence;
  if (!Array.isArray(rawActions)) {
    throw new Error("explorationResult.actionEvidence must be an array");
  }
  return {
    planId: stringArg(input, "explorationPlanId"),
    status: status as "succeeded" | "failed",
    durationMs: numberArg(record, "durationMs"),
    actionEvidence: rawActions.map((item, index) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        throw new Error(`explorationResult.actionEvidence[${index}] must be an object`);
      }
      const action = item as Record<string, unknown>;
      return {
        actionId: stringArg(action, "actionId"),
        action: stringArg(action, "action"),
        route: stringArg(action, "route"),
        role: optionalStringArg(action, "role"),
        sourceRefs: stringArrayArg(action, "sourceRefs"),
        systemEvidenceRefs: optionalStringArrayArg(action, "systemEvidenceRefs") ?? []
      };
    }),
    evidenceRefs: stringArrayArg(record, "evidenceRefs"),
    pageModelIds: stringArrayArg(record, "pageModelIds"),
    systemExplorationIds: stringArrayArg(record, "systemExplorationIds"),
    trainingSessionIds: stringArrayArg(record, "trainingSessionIds"),
    taskEvidence: optionalObjectArrayArg(record, "taskEvidence").map((item) => ({
      taskId: stringArg(item, "taskId"),
      observedEvidence: stringArrayArg(item, "observedEvidence"),
      evidenceRefs: stringArrayArg(item, "evidenceRefs")
    })),
    cleanupStatus: cleanupStatus as "completed" | "not-required" | "failed",
    error: optionalStringArg(record, "error")
  };
}

export function reviewTargetArg(input: Record<string, unknown>, key: string) {
  const value = stringArg(input, key);
  if (
    ![
      "evaluation-trial",
      "suite-run",
      "case",
      "bug",
      "gap",
      "artifact",
      "requirement",
      "knowledge",
      "coverage",
      "requirement-eval-accuracy",
      "system-brain",
      "system-exploration",
      "onboarding-plan",
      "exploration-plan",
      "test-intent",
      "executable-case",
      "execution-plan",
      "requirement-suite-run",
      "run-ledger",
      "execution-diagnosis",
      "evidence",
      "compile-run",
      "semantic-binding",
      "case-dependency",
      "testdata",
      "business-scenario",
      "scenario-assurance",
      "scenario-trust",
      "conformance",
      "stage-eval",
      "source-fidelity",
      "approval"
    ].includes(value)
  ) {
    throw new Error(`${key} is invalid`);
  }
  return value as
    | "suite-run"
    | "case"
    | "bug"
    | "gap"
    | "artifact"
    | KnowledgeReviewTarget;
}

export function stabilityPolicyArg(input: Record<string, unknown>): StabilityPolicy | undefined {
  const value = input.stabilityPolicy;
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const candidate = value as Record<string, unknown>;
  const numberValue = (key: string) =>
    typeof candidate[key] === "number" && Number.isFinite(candidate[key])
      ? candidate[key] as number
      : undefined;
  const targetIterations = numberValue("targetIterations");
  if (!targetIterations || targetIterations < 1) {
    throw new Error("stabilityPolicy.targetIterations must be a positive number");
  }
  const minIterations = numberValue("minIterations");
  const maxFailureRate = numberValue("maxFailureRate");
  const maxConsecutiveFailures = numberValue("maxConsecutiveFailures");
  const minIntervalMs = numberValue("minIntervalMs");
  const maxIntervalMs = numberValue("maxIntervalMs");
  if (minIterations !== undefined && (minIterations < 1 || minIterations > targetIterations)) {
    throw new Error("stabilityPolicy.minIterations must be between 1 and targetIterations");
  }
  if (maxFailureRate !== undefined && (maxFailureRate < 0 || maxFailureRate > 1)) {
    throw new Error("stabilityPolicy.maxFailureRate must be between 0 and 1");
  }
  if (maxConsecutiveFailures !== undefined && maxConsecutiveFailures < 0) {
    throw new Error("stabilityPolicy.maxConsecutiveFailures must not be negative");
  }
  if (minIntervalMs !== undefined && minIntervalMs < 0) {
    throw new Error("stabilityPolicy.minIntervalMs must not be negative");
  }
  if (maxIntervalMs !== undefined && maxIntervalMs < 0) {
    throw new Error("stabilityPolicy.maxIntervalMs must not be negative");
  }
  if (minIntervalMs !== undefined && maxIntervalMs !== undefined && maxIntervalMs < minIntervalMs) {
    throw new Error("stabilityPolicy.maxIntervalMs must be greater than or equal to minIntervalMs");
  }
  return {
    targetIterations,
    minIterations,
    maxDurationMs: numberValue("maxDurationMs"),
    maxFailureRate,
    maxConsecutiveFailures,
    minIntervalMs,
    maxIntervalMs,
    requireStrongEvidence: typeof candidate.requireStrongEvidence === "boolean"
      ? candidate.requireStrongEvidence
      : undefined,
    stopOnBlocked: typeof candidate.stopOnBlocked === "boolean"
      ? candidate.stopOnBlocked
      : undefined
  };
}

export function isKnowledgeReviewTarget(value: ReturnType<typeof reviewTargetArg>): value is KnowledgeReviewTarget {
  return [
    "evaluation-trial",
    "requirement",
    "knowledge",
    "coverage",
    "requirement-eval-accuracy",
    "system-brain",
    "system-exploration",
    "onboarding-plan",
    "exploration-plan",
    "test-intent",
    "executable-case",
    "execution-plan",
    "requirement-suite-run",
    "run-ledger",
    "execution-diagnosis",
    "evidence",
    "compile-run",
    "semantic-binding",
    "case-dependency",
    "testdata",
    "business-scenario",
    "scenario-assurance",
    "scenario-trust",
    "conformance",
    "stage-eval",
    "source-fidelity",
    "approval"
  ].includes(value);
}

export function resolveSystemReference(
  context: BrainCreatorMcpContext,
  input: Record<string, unknown>,
  commandReference: { systemName?: string; environment?: string } = {}
) {
  const systemId = optionalStringArg(input, "systemId");
  const systemName = optionalStringArg(input, "systemName") ?? commandReference.systemName;
  const environment = optionalStringArg(input, "environment") ?? commandReference.environment;
  const systems = context.service.listSystemProfiles().filter((system) => system.status !== "cancelled");

  if (systemId) {
    const system = systems.find((item) => item.id === systemId);
    if (!system) {
      throw new Error(`Brain Creator system not found: ${systemId}`);
    }
    return {
      systemId: system.id,
      systemName: system.name,
      environment: system.environment,
      matchedBy: "id"
    };
  }

  if (!systemName) {
    if (systems.length === 1) {
      const [system] = systems;
      return {
        systemId: system.id,
        systemName: system.name,
        environment: system.environment,
        matchedBy: "single-active-system"
      };
    }
    throw new Error(
      `systemId or systemName is required. Available systems: ${systemCandidatesText(systems)}`
    );
  }

  const normalizedName = normalizeSystemLookup(systemName);
  const normalizedEnvironment = environment ? normalizeSystemLookup(environment) : undefined;
  const nameMatches = systems.filter((system) =>
    normalizeSystemLookup(system.name).includes(normalizedName)
  );
  const matches = normalizedEnvironment
    ? nameMatches.filter((system) => normalizeSystemLookup(system.environment) === normalizedEnvironment)
    : nameMatches;

  if (matches.length === 1) {
    const [system] = matches;
    return {
      systemId: system.id,
      systemName: system.name,
      environment: system.environment,
      matchedBy: normalizedEnvironment ? "name-environment" : "name"
    };
  }
  if (matches.length > 1) {
    throw new Error(
      `Multiple Brain Creator systems match "${systemName}". Add environment or systemId. Candidates: ${systemCandidatesText(matches)}`
    );
  }
  throw new Error(
    `No Brain Creator system matches "${systemName}". Available systems: ${systemCandidatesText(systems)}`
  );
}

export function systemCandidatesText(systems: Array<{ id: string; name: string; environment: string }>) {
  return systems.length === 0
    ? "none"
    : systems.map((system) => `${system.name} (${system.environment}, ${system.id})`).join("; ");
}

export function normalizeSystemLookup(value: string) {
  return value.trim().toLowerCase();
}

export function inferSystemName(context: BrainCreatorMcpContext, request: string) {
  const normalizedRequest = normalizeSystemLookup(request);
  const matches = context.service
    .listSystemProfiles()
    .filter((system) => system.status !== "cancelled")
    .filter((system) => normalizedRequest.includes(normalizeSystemLookup(system.name)));
  if (matches.length === 1) {
    return matches[0].name;
  }
  return undefined;
}

export function extractCaseSource(request: string) {
  const match = request.match(/(?:[A-Za-z]:[\\/][^\r\n]*?\.(?:xlsx|md)|[./\\][^\r\n]*?\.(?:xlsx|md))/i);
  return match?.[0]?.trim();
}

export function intentCaseSourceFilters(input: Record<string, unknown>, request: string) {
  const caseNos = mergeUniqueStrings(stringArrayArg(input, "caseNos"), extractCaseNos(request));
  const modules = mergeUniqueStrings(stringArrayArg(input, "modules"), extractTaggedValues(request, ["模块", "module"], [
    "优先级",
    "priority",
    "用例",
    "case"
  ]));
  const priorities = mergeUniqueStrings(
    stringArrayArg(input, "priorities"),
    extractTaggedValues(request, ["优先级", "priority"], ["模块", "module", "用例", "case"]),
    extractPriorities(request)
  );
  const filters: Record<string, string[]> = {};
  if (caseNos.length > 0) {
    filters.caseNos = caseNos;
  }
  if (modules.length > 0) {
    filters.modules = modules;
  }
  if (priorities.length > 0) {
    filters.priorities = priorities;
  }
  return filters;
}

export function intentBugRegressionFilters(input: Record<string, unknown>, request: string) {
  const bugIds = mergeUniqueStrings(stringArrayArg(input, "bugIds"), extractBugIds(request));
  const modules = mergeUniqueStrings(
    stringArrayArg(input, "modules"),
    extractTaggedValues(request, ["模块", "module"], ["优先级", "priority", "bug", "用例", "case"]),
    extractPrecedingTaggedValues(request, ["模块", "module"])
  ).filter((item) => !isPriorityToken(item));
  const priorities = mergeUniqueStrings(
    stringArrayArg(input, "priorities"),
    extractTaggedValues(request, ["优先级", "priority"], ["模块", "module", "bug", "用例", "case"]),
    extractPriorities(request)
  );
  const filters: Record<string, string[]> = {};
  if (bugIds.length > 0) {
    filters.bugIds = bugIds;
  }
  if (modules.length > 0) {
    filters.modules = modules;
  }
  if (priorities.length > 0) {
    filters.priorities = priorities;
  }
  return filters;
}

export function bugRegressionFilters(input: Record<string, unknown>) {
  return {
    modules: new Set(stringArrayArg(input, "modules").map((item) => normalizeSystemLookup(item))),
    priorities: new Set(stringArrayArg(input, "priorities").map((item) => normalizeSystemLookup(item)))
  };
}

export function matchesBugRegressionFilters(bug: BugReport, filters: ReturnType<typeof bugRegressionFilters>) {
  if (filters.modules.size > 0 && !filters.modules.has(normalizeSystemLookup(bug.module))) {
    return false;
  }
  if (filters.priorities.size > 0 && !filters.priorities.has(normalizeSystemLookup(bug.priority))) {
    return false;
  }
  return true;
}

export function mergeUniqueStrings(...groups: string[][]) {
  return [...new Set(groups.flat().map((item) => item.trim()).filter(Boolean))];
}

export function extractBugIds(request: string) {
  return request.match(/\bbug[_-][a-z0-9_-]+\b/gi) ?? [];
}

export function extractCaseNos(request: string) {
  return request.match(/\bTC[-_\s]?\d+\b/gi)?.map((item) => item.replace(/\s+/, "-")) ?? [];
}

export function extractPriorities(request: string) {
  return request.match(/\bP[0-3]\b/gi)?.map((item) => item.toUpperCase()) ?? [];
}

export function isPriorityToken(value: string) {
  return /^P[0-3]$/i.test(value);
}

export function extractTaggedValues(request: string, labels: string[], stopLabels: string[]) {
  const labelPattern = labels.map(escapeRegExp).join("|");
  const stopPattern = stopLabels.map(escapeRegExp).join("|");
  const match = request.match(
    new RegExp(`(?:${labelPattern})\\s*[:：]?\\s*(.+?)(?=\\s*(?:${stopPattern})(?:\\s|[:：]|$)|$)`, "i")
  );
  return match ? splitCommandValues([match[1]]) : [];
}

export function extractPrecedingTaggedValues(request: string, labels: string[]) {
  const labelPattern = labels.map(escapeRegExp).join("|");
  const matches = [...request.matchAll(new RegExp(`(?:^|\\s)([A-Za-z0-9_-]+)\\s*(?:${labelPattern})(?=\\s|$)`, "gi"))];
  return matches.map((match) => match[1]).filter(Boolean);
}

export function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function isContinueRequest(normalizedRequest: string) {
  return (
    normalizedRequest.includes("continue") ||
    normalizedRequest.includes("resume") ||
    normalizedRequest.includes("继续")
  );
}

export function isBugRegressionRequest(normalizedRequest: string) {
  return (
    normalizedRequest.includes("bug") &&
    (normalizedRequest.includes("regress") ||
      normalizedRequest.includes("retest") ||
      normalizedRequest.includes("回归") ||
      normalizedRequest.includes("重测"))
  );
}

export function isBugReviewRequest(normalizedRequest: string) {
  return normalizedRequest.includes("bug") && !normalizedRequest.includes("regress");
}

export function isDocumentSuiteRequest(normalizedRequest: string, source?: string) {
  return Boolean(
    source ||
      normalizedRequest.includes("excel") ||
      normalizedRequest.includes(".xlsx") ||
      normalizedRequest.includes(".md") ||
      normalizedRequest.includes("测试用例文档")
  );
}

export function parseBrainCreatorCommand(command: string, systemId: string): {
  tool: "bc_status" | "bc_run" | "bc_review";
  toolInput: Record<string, unknown>;
} {
  return parseBrainCreatorCommandTokens(commandTokens(command), systemId);
}

export function parseBrainCreatorCommandTokens(tokens: string[], systemId: string): {
  tool: "bc_status" | "bc_run" | "bc_review";
  toolInput: Record<string, unknown>;
} {
  if (tokens[0]?.toLowerCase() !== "/bc") {
    throw new Error("Brain Creator command must start with /bc");
  }
  const action = tokens[1]?.toLowerCase();
  if (action === "status") {
    return { tool: "bc_status", toolInput: { systemId } };
  }
  if (action === "run") {
    return {
      tool: "bc_run",
      toolInput: parseRunCommandInput(tokens.slice(2), systemId)
    };
  }
  if (action === "continue") {
    return {
      tool: "bc_run",
      toolInput: {
        mode: "case-source-suite",
        systemId,
        resume: true,
        confirm: true
      }
    };
  }
  if (action === "regress" && tokens[2]?.toLowerCase() === "bugs") {
    return {
      tool: "bc_run",
      toolInput: parseBugRegressionCommandInput(tokens.slice(3), systemId)
    };
  }
  if (action === "bugs") {
    return {
      tool: "bc_review",
      toolInput: parseReviewCommandInput(["bug", ...tokens.slice(2)], systemId)
    };
  }
  if (action === "gaps") {
    return {
      tool: "bc_review",
      toolInput: parseReviewCommandInput(["gap", ...tokens.slice(2)], systemId)
    };
  }
  if (action === "review" && tokens[2]) {
    return {
      tool: "bc_review",
      toolInput: parseReviewCommandInput(tokens.slice(2), systemId)
    };
  }
  throw new Error(`Unsupported Brain Creator command: ${tokens.join(" ")}`);
}

export function commandWithSystemReference(command: string) {
  const tokens = commandTokens(command);
  const stripped: string[] = [];
  const systemReference: { systemName?: string; environment?: string } = {};
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    const normalized = token.toLowerCase();
    if (normalized === "--system" || normalized === "--system-name") {
      const value = tokens[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error(`${token} requires a value`);
      }
      systemReference.systemName = value;
      index += 1;
      continue;
    }
    if (normalized === "--env" || normalized === "--environment") {
      const value = tokens[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error(`${token} requires a value`);
      }
      systemReference.environment = value;
      index += 1;
      continue;
    }
    stripped.push(token);
  }
  return { tokens: stripped, systemReference };
}

export function parseRunCommandInput(tokens: string[], systemId: string) {
  const flagIndex = tokens.findIndex((token) => token.startsWith("--"));
  const sourceTokens = flagIndex >= 0 ? tokens.slice(0, flagIndex) : tokens;
  const source = sourceTokens.join(" ").trim();
  if (!source) {
    throw new Error("/bc run requires a case source path");
  }
  const toolInput: Record<string, unknown> = {
    mode: "case-source-suite",
    systemId,
    source,
    confirm: false
  };
  if (flagIndex >= 0) {
    for (let index = flagIndex; index < tokens.length; index += 1) {
      const token = tokens[index];
      if (!token.startsWith("--")) {
        throw new Error(`Unexpected /bc run argument: ${token}`);
      }
      const values: string[] = [];
      while (tokens[index + 1] && !tokens[index + 1].startsWith("--")) {
        values.push(tokens[index + 1]);
        index += 1;
      }
      const parsedValues = splitCommandValues(values);
      if (parsedValues.length === 0) {
        throw new Error(`${token} requires a value`);
      }
      if (token === "--case" || token === "--cases") {
        toolInput.caseNos = parsedValues;
      } else if (token === "--module" || token === "--modules") {
        toolInput.modules = parsedValues;
      } else if (token === "--priority" || token === "--priorities") {
        toolInput.priorities = parsedValues;
      } else {
        throw new Error(`Unsupported /bc run option: ${token}`);
      }
    }
  }
  return toolInput;
}

export function parseBugRegressionCommandInput(tokens: string[], systemId: string) {
  const toolInput: Record<string, unknown> = {
    mode: "bug-regression",
    systemId
  };
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token.startsWith("--")) {
      throw new Error(`Unexpected /bc regress bugs argument: ${token}`);
    }
    const values: string[] = [];
    while (tokens[index + 1] && !tokens[index + 1].startsWith("--")) {
      values.push(tokens[index + 1]);
      index += 1;
    }
    const parsedValues = splitCommandValues(values);
    if (parsedValues.length === 0) {
      throw new Error(`${token} requires a value`);
    }
    if (token === "--bug" || token === "--bugs") {
      toolInput.bugIds = parsedValues;
    } else if (token === "--module" || token === "--modules") {
      toolInput.modules = parsedValues;
    } else if (token === "--priority" || token === "--priorities") {
      toolInput.priorities = parsedValues;
    } else {
      throw new Error(`Unsupported /bc regress bugs option: ${token}`);
    }
  }
  return toolInput;
}

export function parseReviewCommandInput(tokens: string[], systemId: string) {
  const target = commandReviewTarget(tokens[0]);
  const toolInput: Record<string, unknown> = {
    target,
    systemId
  };
  for (let index = 1; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token.startsWith("--")) {
      throw new Error(`Unexpected /bc review argument: ${token}`);
    }
    const values: string[] = [];
    while (tokens[index + 1] && !tokens[index + 1].startsWith("--")) {
      values.push(tokens[index + 1]);
      index += 1;
    }
    const parsedValues = splitCommandValues(values);
    if (parsedValues.length === 0) {
      throw new Error(`${token} requires a value`);
    }
    if (token === "--failure-type" || token === "--failure-types") {
      toolInput.failureTypes = parsedValues;
    } else {
      throw new Error(`Unsupported /bc review option: ${token}`);
    }
  }
  return toolInput;
}

export function splitCommandValues(values: string[]) {
  return values
    .flatMap((value) => value.split(","))
    .map((value) => value.trim())
    .filter(Boolean);
}

export function commandReviewTarget(token: string) {
  const normalized = token.toLowerCase();
  if (normalized === "suite" || normalized === "suites" || normalized === "suite-run") {
    return "suite-run";
  }
  if (normalized === "bug" || normalized === "bugs") {
    return "bug";
  }
  if (normalized === "gap" || normalized === "gaps") {
    return "gap";
  }
  if (normalized === "case" || normalized === "cases") {
    return "case";
  }
  if (normalized === "artifact" || normalized === "artifacts") {
    return "artifact";
  }
  throw new Error(`Unsupported /bc review target: ${token}`);
}

export function commandTokens(command: string) {
  const tokens: string[] = [];
  const pattern = /"([^"]*)"|'([^']*)'|(\S+)/g;
  for (const match of command.matchAll(pattern)) {
    tokens.push(match[1] ?? match[2] ?? match[3] ?? "");
  }
  return tokens;
}

export function configureTargetArg(input: Record<string, unknown>, key: string) {
  const value = stringArg(input, key);
  if (
    ![
      "system",
      "auth",
      "term",
      "rule",
      "checkpoint",
      "knowledge-project",
      "system-binding",
      "connector",
      "runtime",
      "approval"
    ].includes(value)
  ) {
    throw new Error(`${key} is invalid`);
  }
  return value as
    | "system"
    | "auth"
    | "term"
    | "rule"
    | "checkpoint"
    | "knowledge-project"
    | "system-binding"
    | "connector"
    | "runtime"
    | "approval";
}

export function prepareActionArg(input: Record<string, unknown>, key: string) {
  const value = stringArg(input, key);
  if (
    ![
      "start-evaluation-trial",
      "checkpoint-evaluation-trial",
      "validate-evaluation-trial",
      "complete-evaluation-trial",
      "record-evaluation-intervention",
      "complete-intervention-capture",
      "reevaluate-legacy-execution-evidence",
      "ingest-requirement",
      "refresh-requirement",
      "analyze-attachments",
      "submit-attachment-analysis",
      "confirm-attachment-analysis",
      "generate-analysis",
      "generate-test-design",
      "revise-test-design-draft",
      "refresh-test-design-projection",
      "assess-scenarios",
      "record-scenario-run",
      "evaluate-mutations",
      "confirm-eval-actions",
      "review-legacy-diagnosis",
      "rollback-legacy-diagnosis",
      "approve-baseline",
      "compile-cases",
      "confirm-page-binding",
      "create-onboarding-plan",
      "approve-onboarding-plan",
      "start-onboarding-plan",
      "create-exploration-plan",
      "approve-exploration-plan",
      "cancel-exploration-plan",
      "start-exploration-plan",
      "submit-exploration-result",
      "resolve-exploration-task",
      "resolve-gap",
      "dismiss-gap",
      "reopen-gap",
      "resolve-test-data",
      "prepare-test-data",
      "confirm-cleanup-notice",
      "mark-test-data-sent",
      "reconcile-test-data-no-effect",
      "submit-test-data",
      "prepare-execution",
      "record-execution-action",
      "reconcile-execution-action",
      "record-observation",
      "record-page-evidence",
      "record-interaction-evidence",
      "record-training-evidence",
      "explore-system",
      "refresh-system-brain",
      "confirm-system-snapshot",
      "reconcile-system-brain",
      "confirm-semantic-binding",
      "recompile-stale-cases"
    ].includes(value)
  ) {
    throw new Error(`${key} is invalid`);
  }
  return value as
    | "start-evaluation-trial"
    | "checkpoint-evaluation-trial"
    | "validate-evaluation-trial"
    | "complete-evaluation-trial"
    | "record-evaluation-intervention"
    | "complete-intervention-capture"
    | "reevaluate-legacy-execution-evidence"
    | "ingest-requirement"
    | "refresh-requirement"
    | "analyze-attachments"
    | "submit-attachment-analysis"
    | "confirm-attachment-analysis"
    | "generate-analysis"
    | "generate-test-design"
    | "revise-test-design-draft"
    | "refresh-test-design-projection"
    | "assess-scenarios"
    | "record-scenario-run"
    | "evaluate-mutations"
    | "confirm-eval-actions"
    | "review-legacy-diagnosis"
    | "rollback-legacy-diagnosis"
    | "approve-baseline"
    | "compile-cases"
    | "confirm-page-binding"
    | "create-onboarding-plan"
    | "approve-onboarding-plan"
    | "start-onboarding-plan"
    | "create-exploration-plan"
    | "approve-exploration-plan"
    | "cancel-exploration-plan"
    | "start-exploration-plan"
    | "submit-exploration-result"
    | "resolve-exploration-task"
    | "resolve-gap"
    | "dismiss-gap"
    | "reopen-gap"
    | "resolve-test-data"
    | "prepare-test-data"
    | "confirm-cleanup-notice"
    | "mark-test-data-sent"
    | "reconcile-test-data-no-effect"
    | "submit-test-data"
    | "prepare-execution"
    | "record-execution-action"
    | "reconcile-execution-action"
    | "record-observation"
    | "record-page-evidence"
    | "record-interaction-evidence"
    | "record-training-evidence"
    | "explore-system"
    | "refresh-system-brain"
    | "confirm-system-snapshot"
    | "reconcile-system-brain"
    | "confirm-semantic-binding"
    | "recompile-stale-cases";
}

export function executionActionPhaseArg(
  input: Record<string, unknown>,
  key: string
) {
  const value = stringArg(input, key);
  if (
    ![
      "planned",
      "sent",
      "confirmed",
      "reconciliation-required",
      "reconciled"
    ].includes(value)
  ) {
    throw new Error(`${key} is invalid`);
  }
  return value as
    | "planned"
    | "sent"
    | "confirmed"
    | "reconciliation-required"
    | "reconciled";
}

export function evaluationProviderArg(input: Record<string, unknown>, key: string) {
  const value = stringArg(input, key);
  if (!["builtin", "host-agent", "host-skill", "claude", "codex"].includes(value)) {
    throw new Error(`${key} is invalid`);
  }
  return value as "builtin" | "host-agent" | "host-skill" | "claude" | "codex";
}

export function evaluationInterventionCategoryArg(input: Record<string, unknown>, key: string) {
  const value = stringArg(input, key);
  if (![
    "controlled-facade-write",
    "user-clarification",
    "user-authentication",
    "manual-evidence-review",
    "manual-recovery",
    "manual-store-write",
    "source-change",
    "code-change",
    "product-source-change"
  ].includes(value)) {
    throw new Error(`${key} is invalid`);
  }
  return value as
    | "controlled-facade-write"
    | "user-clarification"
    | "user-authentication"
    | "manual-evidence-review"
    | "manual-recovery"
    | "manual-store-write"
    | "source-change"
    | "code-change"
    | "product-source-change";
}

export function diagnosisAssetTypeArg(
  input: Record<string, unknown>,
  key: string
): "bug" | "gap" {
  const value = stringArg(input, key);
  if (value !== "bug" && value !== "gap") {
    throw new Error(`${key} is invalid`);
  }
  return value;
}

export function legacyDiagnosisDecisionArg(
  input: Record<string, unknown>,
  key: string
): LegacyDiagnosisDecision {
  const value = stringArg(input, key);
  if (
    ![
      "confirm_bug",
      "review_bug_as_gap",
      "confirm_gap",
      "needs_evidence",
      "override_classification"
    ].includes(value)
  ) {
    throw new Error(`${key} is invalid`);
  }
  return value as LegacyDiagnosisDecision;
}

export function optionalExecutionFailureTypeArg(
  input: Record<string, unknown>,
  key: string
): ExecutionFailureType | undefined {
  const value = optionalStringArg(input, key);
  if (!value) return undefined;
  if (
    ![
      "assertion_failure",
      "auth_failure",
      "locator_failure",
      "network_failure",
      "automation_failure",
      "test_data_failure",
      "environment_failure",
      "execution_failure",
      "unknown_failure"
    ].includes(value)
  ) {
    throw new Error(`${key} is invalid`);
  }
  return value as ExecutionFailureType;
}

export function optionalExecutionDiagnosisVerdictArg(
  input: Record<string, unknown>,
  key: string
): ExecutionDiagnosisVerdict | undefined {
  const value = optionalStringArg(input, key);
  if (!value) return undefined;
  if (
    ![
      "product_bug",
      "automation_gap",
      "test_data_gap",
      "auth_gap",
      "environment_gap",
      "network_gap",
      "execution_gap",
      "unknown_gap"
    ].includes(value)
  ) {
    throw new Error(`${key} is invalid`);
  }
  return value as ExecutionDiagnosisVerdict;
}

export function testDataTaskResultStatusArg(
  input: Record<string, unknown>,
  key: string
) {
  const value = stringArg(input, key);
  if (value !== "succeeded" && value !== "failed") {
    throw new Error(`${key} is invalid`);
  }
  return value;
}

export function optionalTestDataProviderDecisionArg(
  input: Record<string, unknown>,
  key: string
) {
  const value = optionalStringArg(input, key);
  if (value === undefined) return undefined;
  if (value !== "reuse" && value !== "create") {
    throw new Error(`${key} is invalid`);
  }
  return value;
}

export function testDataResolutionsArg(
  input: Record<string, unknown>,
  key: string
) {
  const value = input[key] ?? [];
  if (!Array.isArray(value)) throw new Error(`${key} must be an array`);
  const decisions = new Set([
    "use-value",
    "reuse",
    "create",
    "capture",
    "secret-reference"
  ]);
  return value.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error(`${key}[${index}] must be an object`);
    }
    const resolution = item as Record<string, unknown>;
    if (
      typeof resolution.profileId !== "string" ||
      typeof resolution.decision !== "string" ||
      !decisions.has(resolution.decision) ||
      (resolution.value !== undefined && typeof resolution.value !== "string") ||
      (resolution.reference !== undefined &&
        typeof resolution.reference !== "string")
    ) {
      throw new Error(`${key}[${index}] is invalid`);
    }
    return {
      profileId: resolution.profileId,
      decision: resolution.decision as
        | "use-value"
        | "reuse"
        | "create"
        | "capture"
        | "secret-reference",
      value: resolution.value as string | undefined,
      reference: resolution.reference as string | undefined
    };
  });
}

export function knowledgeNodeTypeArg(input: Record<string, unknown>, key: string): KnowledgeNodeType {
  const value = stringArg(input, key);
  const allowed: KnowledgeNodeType[] = [
    "module", "actor", "object", "field", "rule", "workflow", "state", "permission",
    "integration", "data-constraint", "term", "requirement"
  ];
  if (!allowed.includes(value as KnowledgeNodeType)) throw new Error(`${key} is invalid`);
  return value as KnowledgeNodeType;
}

export function policyProviderArg(input: Record<string, unknown>, key: string) {
  const value = optionalStringArg(input, key) ?? "builtin";
  if (value !== "builtin" && value !== "host-skill" && value !== "host-agent") throw new Error(`${key} is invalid`);
  return value;
}

export function explorationInteractionModeArg(
  input: Record<string, unknown>,
  key: string
): "off" | "safe" {
  const value = optionalStringArg(input, key) ?? "off";
  if (value !== "off" && value !== "safe") throw new Error(`${key} is invalid`);
  return value;
}

export function systemExplorationModeArg(
  input: Record<string, unknown>,
  key: string
): "full" | "incremental" {
  const value = optionalStringArg(input, key) ?? "full";
  if (value !== "full" && value !== "incremental") throw new Error(`${key} is invalid`);
  return value;
}

export function requirementContentPackageArg(
  input: Record<string, unknown>,
  key: string
): RequirementContentPackage | undefined {
  const value = input[key];
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${key} must be an object`);
  }
  const candidate = value as RequirementContentPackage;
  if (
    typeof candidate.title !== "string" ||
    typeof candidate.content !== "string" ||
    typeof candidate.source !== "string" ||
    typeof candidate.sourceType !== "string" ||
    typeof candidate.contentHash !== "string" ||
    !Array.isArray(candidate.blocks) ||
    !Array.isArray(candidate.attachments) ||
    !Array.isArray(candidate.warnings)
  ) {
    throw new Error(`${key} is invalid`);
  }
  if (candidate.blocks.some((block) => {
    if (!block || typeof block !== "object" || typeof block.type !== "string" || typeof block.text !== "string") {
      return true;
    }
    const sourceRefs = block.sourceRefs;
    return sourceRefs !== undefined && (!Array.isArray(sourceRefs) || sourceRefs.some((ref) => typeof ref !== "string"));
  })) {
    throw new Error(`${key}.blocks contains an invalid document block`);
  }
  return candidate;
}

export function hostDownloadedAttachmentsArg(
  input: Record<string, unknown>,
  key: string
): HostDownloadedAttachment[] {
  const value = input[key];
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error(`${key} must be an array`);
  return value.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error(`${key}[${index}] is invalid`);
    }
    const candidate = item as Record<string, unknown>;
    if (typeof candidate.attachmentId !== "string" || typeof candidate.localPath !== "string") {
      throw new Error(`${key}[${index}] requires attachmentId and localPath`);
    }
    if (candidate.contentHash !== undefined && typeof candidate.contentHash !== "string") {
      throw new Error(`${key}[${index}].contentHash is invalid`);
    }
    if (candidate.mimeType !== undefined && typeof candidate.mimeType !== "string") {
      throw new Error(`${key}[${index}].mimeType is invalid`);
    }
    return {
      attachmentId: candidate.attachmentId,
      localPath: candidate.localPath,
      contentHash: candidate.contentHash,
      mimeType: candidate.mimeType
    };
  });
}

export function explorationTaskOutcomeArg(
  input: Record<string, unknown>,
  key: string
): "resolved" | "failed" | "cancelled" {
  const value = stringArg(input, key);
  if (value !== "resolved" && value !== "failed" && value !== "cancelled") {
    throw new Error(`${key} is invalid`);
  }
  return value;
}

export function attachmentAnalysisArg(input: Record<string, unknown>, key: string) {
  const value = input[key];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${key} must be an object`);
  }
  const record = value as Record<string, unknown>;
  const kinds = new Set(["table", "flowchart", "state-machine", "wireframe", "text-image", "other"]);
  if (
    typeof record.kind !== "string" ||
    !kinds.has(record.kind) ||
    typeof record.markdown !== "string" ||
    !record.markdown.trim() ||
    !Array.isArray(record.nodes) ||
    !Array.isArray(record.edges) ||
    typeof record.confidence !== "number" ||
    record.confidence < 0 ||
    record.confidence > 1
  ) {
    throw new Error(`${key} is invalid`);
  }
  return {
    kind: record.kind as "table" | "flowchart" | "state-machine" | "wireframe" | "text-image" | "other",
    markdown: record.markdown,
    nodes: record.nodes.map((node, index) => {
      if (!node || typeof node !== "object" || Array.isArray(node)) {
        throw new Error(`${key}.nodes[${index}] is invalid`);
      }
      const item = node as Record<string, unknown>;
      return { id: stringArg(item, "id"), type: stringArg(item, "type"), label: stringArg(item, "label") };
    }),
    edges: record.edges.map((edge, index) => {
      if (!edge || typeof edge !== "object" || Array.isArray(edge)) {
        throw new Error(`${key}.edges[${index}] is invalid`);
      }
      const item = edge as Record<string, unknown>;
      return {
        from: stringArg(item, "from"),
        to: stringArg(item, "to"),
        condition: optionalStringArg(item, "condition"),
        actor: optionalStringArg(item, "actor")
      };
    }),
    confidence: record.confidence
  };
}

export function interactionEvidenceArg(input: Record<string, unknown>, key: string) {
  const value = input[key];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${key} must be an object`);
  }
  const record = value as Record<string, unknown>;
  const state = (stateValue: unknown, stateKey: string) => {
    if (!stateValue || typeof stateValue !== "object" || Array.isArray(stateValue)) {
      throw new Error(`${key}.${stateKey} must be an object`);
    }
    const stateRecord = stateValue as Record<string, unknown>;
    const controlValues = stateRecord.controlValues;
    return {
      id: stringArg(stateRecord, "id"),
      url: stringArg(stateRecord, "url"),
      visibleElements: stringArrayArg(stateRecord, "visibleElements"),
      dialogs: stringArrayArg(stateRecord, "dialogs"),
      ...(controlValues === undefined
        ? {}
        : {
            controlValues: (controlValues as unknown[]).map((item, index) => {
              if (!item || typeof item !== "object" || Array.isArray(item)) {
                throw new Error(`${key}.${stateKey}.controlValues[${index}] must be an object`);
              }
              const control = item as Record<string, unknown>;
              return {
                name: stringArg(control, "name"),
                value: stringArg(control, "value")
              };
            })
          })
    };
  };
  const blockedRequests = record.blockedRequests;
  if (!Array.isArray(blockedRequests)) throw new Error(`${key}.blockedRequests must be an array`);
  return {
    pageUrl: stringArg(record, "pageUrl"),
    targetName: stringArg(record, "targetName"),
    targetRole: stringArg(record, "targetRole"),
    targetSelector: stringArg(record, "targetSelector"),
    targetKind: stringArg(record, "targetKind") as "tab" | "disclosure" | "select",
    action: stringArg(record, "action") as "click" | "select",
    inputValue: optionalStringArg(record, "inputValue"),
    before: state(record.before, "before"),
    after: state(record.after, "after"),
    visibleAdded: stringArrayArg(record, "visibleAdded"),
    visibleRemoved: stringArrayArg(record, "visibleRemoved"),
    dialogAdded: stringArrayArg(record, "dialogAdded"),
    dialogRemoved: stringArrayArg(record, "dialogRemoved"),
    changedControls:
      record.changedControls === undefined
        ? undefined
        : (record.changedControls as unknown[]).map((item, index) => {
            if (!item || typeof item !== "object" || Array.isArray(item)) {
              throw new Error(`${key}.changedControls[${index}] must be an object`);
            }
            const control = item as Record<string, unknown>;
            return {
              name: stringArg(control, "name"),
              before: stringArg(control, "before"),
              after: stringArg(control, "after")
            };
          }),
    urlChanged: Boolean(record.urlChanged),
    transitionKind: optionalStringArg(record, "transitionKind") as "navigation" | "state" | undefined,
    blockedRequests: blockedRequests.map((item, index) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        throw new Error(`${key}.blockedRequests[${index}] must be an object`);
      }
      const request = item as Record<string, unknown>;
      return { method: stringArg(request, "method"), url: stringArg(request, "url") };
    }),
    status: stringArg(record, "status") as "observed" | "no-change" | "blocked" | "failed",
    screenshotPath: optionalStringArg(record, "screenshotPath"),
    evidenceRefs: stringArrayArg(record, "evidenceRefs"),
    scenarioId: optionalStringArg(record, "scenarioId")
  };
}

export function pageEvidenceArg(input: Record<string, unknown>, key: string) {
  const value = input[key];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${key} must be an object`);
  }
  const record = value as Record<string, unknown>;
  const interactiveElements = record.interactiveElements;
  if (!Array.isArray(interactiveElements)) {
    throw new Error(`${key}.interactiveElements must be an array`);
  }
  return {
    title: stringArg(record, "title"),
    finalUrl: stringArg(record, "finalUrl"),
    domText: stringArg(record, "domText"),
    screenshotPath: optionalStringArg(record, "screenshotPath"),
    interactiveElements: interactiveElements.map((item, index) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        throw new Error(`${key}.interactiveElements[${index}] must be an object`);
      }
      const element = item as Record<string, unknown>;
      return {
        name: stringArg(element, "name"),
        role: stringArg(element, "role"),
        text: stringArg(element, "text"),
        selector: stringArg(element, "selector")
      };
    }),
    consoleErrors: stringArrayArg(record, "consoleErrors"),
    networkFailures: stringArrayArg(record, "networkFailures"),
    issues: stringArrayArg(record, "issues")
  };
}

export function trainingEvidenceArg(input: Record<string, unknown>, key: string) {
  const value = input[key];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${key} must be an object`);
  }
  const record = value as Record<string, unknown>;
  if (!Array.isArray(record.actions) || !Array.isArray(record.apiRequests)) {
    throw new Error(`${key} requires actions and apiRequests arrays`);
  }
  const actions = record.actions.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error(`${key}.actions[${index}] must be an object`);
    }
    const action = item as Record<string, unknown>;
    const type = stringArg(action, "type");
    if (!["click", "fill", "select", "assert", "navigate", "wait"].includes(type)) {
      throw new Error(`${key}.actions[${index}].type is invalid`);
    }
    return {
      type,
      targetLocatorId: stringArg(action, "targetLocatorId"),
      inputValue: optionalStringArg(action, "inputValue") ?? "",
      assertion: optionalStringArg(action, "assertion") ?? ""
    };
  });
  const apiRequests = record.apiRequests.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error(`${key}.apiRequests[${index}] must be an object`);
    }
    const request = item as Record<string, unknown>;
    const status = numberArg(request, "status");
    if (!Number.isInteger(status) || status < 100 || status > 599) {
      throw new Error(`${key}.apiRequests[${index}].status is invalid`);
    }
    return {
      method: stringArg(request, "method").toUpperCase(),
      url: stringArg(request, "url"),
      status
    };
  });
  const artifactValue = record.artifacts;
  let artifacts: { traceUrl: string; harUrl: string; screenshotUrl: string } | undefined;
  if (artifactValue !== undefined) {
    if (!artifactValue || typeof artifactValue !== "object" || Array.isArray(artifactValue)) {
      throw new Error(`${key}.artifacts must be an object`);
    }
    const artifact = artifactValue as Record<string, unknown>;
    artifacts = {
      traceUrl: stringArg(artifact, "traceUrl"),
      harUrl: stringArg(artifact, "harUrl"),
      screenshotUrl: stringArg(artifact, "screenshotUrl")
    };
  }
  return { actions, apiRequests, artifacts };
}

export function assertSystemEvidenceUrl(
  context: BrainCreatorMcpContext,
  systemId: string,
  value: string
) {
  const system = context.repository.systemProfiles.find((item) => item.id === systemId);
  if (!system) throw new Error("Business system not found");
  const target = new URL(value);
  if (!["http:", "https:"].includes(target.protocol)) {
    throw new Error("Page evidence URL must use http or https");
  }
  const allowed = [system.baseUrl, ...system.urlAllowlist].some((candidate) => {
    try {
      const allowedUrl = new URL(candidate);
      const allowedPath = allowedUrl.pathname.replace(/\/+$/, "") || "/";
      return (
        target.origin === allowedUrl.origin &&
        (allowedPath === "/" ||
          target.pathname === allowedPath ||
          target.pathname.startsWith(`${allowedPath}/`))
      );
    } catch {
      return false;
    }
  });
  if (!allowed) throw new Error("Page evidence URL is outside the system URL allowlist");
}

export function stringArrayArg(input: Record<string, unknown>, key: string): string[] {
  const value = input[key];
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

export function optionalStringArrayArg(input: Record<string, unknown>, key: string): string[] | undefined {
  return Array.isArray(input[key]) ? stringArrayArg(input, key) : undefined;
}

export function optionalObjectArrayArg(input: Record<string, unknown>, key: string) {
  const value = input[key];
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error(`${key} must be an array`);
  return value.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error(`${key}[${index}] must be an object`);
    }
    return item as Record<string, unknown>;
  });
}

export function recordArg(input: Record<string, unknown>, key: string): Record<string, string> {
  const value = input[key];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${key} must be an object`);
  }
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string")
  );
}

export function loginMethodArg(input: Record<string, unknown>, key: string) {
  const value = stringArg(input, key);
  if (!["password", "cookie", "token", "script"].includes(value)) {
    throw new Error(`${key} is invalid`);
  }
  return value as "password" | "cookie" | "token" | "script";
}

export function severityArg(input: Record<string, unknown>, key: string) {
  const value = stringArg(input, key);
  if (value !== "block" && value !== "warn") {
    throw new Error(`${key} is invalid`);
  }
  return value;
}

export function gapStatusArg(input: Record<string, unknown>, key: string) {
  const value = optionalStringArg(input, key);
  if (value === undefined) {
    return undefined;
  }
  if (value !== "open" && value !== "resolved" && value !== "dismissed") {
    throw new Error(`${key} is invalid`);
  }
  return value;
}

export function responseModeArg(input: Record<string, unknown>) {
  const value = optionalStringArg(input, "responseMode") ?? "full";
  if (value !== "summary" && value !== "full") {
    throw new Error("responseMode is invalid");
  }
  return value;
}

export function onboardingCreateNextAction(
  status: "draft" | "approved" | "completed" | "blocked",
  baselineChanged: boolean
) {
  if (baselineChanged) return "review-onboarding-plan";
  if (status === "draft") return "approve-onboarding-plan";
  if (status === "approved") return "start-onboarding-plan";
  return "review-onboarding-plan";
}

export function evaluationRuntimeBuildIdentity(context: BrainCreatorMcpContext) {
  return evaluationRuntimeIdentity(context).buildId;
}

export function evaluationRuntimeIdentity(context: BrainCreatorMcpContext) {
  return readRuntimeIdentity({
    workspace: context.workDir,
    schemaVersion: context.repository.schemaVersion,
    provider: context.agentBridge?.provider ?? context.runtimeConfiguration?.bridgeProvider ?? "disabled",
    processKind: "mcp"
  });
}

export function gapSeverityArg(input: Record<string, unknown>, key: string) {
  const value = stringArg(input, key);
  if (!["low", "medium", "high"].includes(value)) {
    throw new Error(`${key} is invalid`);
  }
  return value as "low" | "medium" | "high";
}

export function bugStatusArg(input: Record<string, unknown>, key: string) {
  const value = optionalStringArg(input, key);
  if (value === undefined) {
    return undefined;
  }
  if (!["open", "retest-running", "retest-passed", "retest-failed", "closed"].includes(value)) {
    throw new Error(`${key} is invalid`);
  }
  return value as "open" | "retest-running" | "retest-passed" | "retest-failed" | "closed";
}

export function authCheckpointStatusArg(
  input: Record<string, unknown>,
  key: string
): AuthCheckpoint["status"] | undefined {
  const value = optionalStringArg(input, key);
  if (value === undefined) {
    return undefined;
  }
  if (!["awaiting-user", "completed", "cancelled"].includes(value)) {
    throw new Error(`${key} is invalid`);
  }
  return value as AuthCheckpoint["status"];
}

export function agentArg(input: Record<string, unknown>, key: string): AgentRun["agent"] {
  const value = stringArg(input, key);
  if (!["planner", "generator", "healer"].includes(value)) {
    throw new Error(`${key} is invalid`);
  }
  return value as AgentRun["agent"];
}

export function agentOutputStatusArg(input: Record<string, unknown>, key: string): "succeeded" | "failed" {
  const value = stringArg(input, key);
  if (!["succeeded", "failed"].includes(value)) {
    throw new Error(`${key} is invalid`);
  }
  return value as "succeeded" | "failed";
}

export function scenarioArrayArg(input: Record<string, unknown>, key: string): TestCaseScenario[] {
  const value = input[key];
  if (!Array.isArray(value)) {
    throw new Error(`${key} must be an array`);
  }
  return value.map((scenario, index) => {
    if (!scenario || typeof scenario !== "object" || Array.isArray(scenario)) {
      throw new Error(`${key}[${index}] must be an object`);
    }
    const record = scenario as Record<string, unknown>;
    return {
      id: stringArg(record, "id"),
      title: stringArg(record, "title"),
      priority: priorityArg(record, "priority"),
      steps: stepArrayArg(record, "steps"),
      businessRuleRef: optionalStringArg(record, "businessRuleRef")
    };
  });
}

export function stepArrayArg(input: Record<string, unknown>, key: string): TestCaseStep[] {
  const value = input[key];
  if (!Array.isArray(value)) {
    throw new Error(`${key} must be an array`);
  }
  return value.map((step, index) => {
    if (!step || typeof step !== "object" || Array.isArray(step)) {
      throw new Error(`${key}[${index}] must be an object`);
    }
    const record = step as Record<string, unknown>;
    return {
      action: actionArg(record, "action"),
      target: stringArg(record, "target"),
      value: optionalStringArg(record, "value"),
      expected: optionalStringArg(record, "expected")
    };
  });
}

export function priorityArg(input: Record<string, unknown>, key: string) {
  const value = stringArg(input, key);
  if (!["critical", "high", "medium", "low"].includes(value)) {
    throw new Error(`${key} is invalid`);
  }
  return value as TestCaseScenario["priority"];
}

export function actionArg(input: Record<string, unknown>, key: string) {
  const value = stringArg(input, key);
  if (!["navigate", "fill", "click", "assert", "wait", "select"].includes(value)) {
    throw new Error(`${key} is invalid`);
  }
  return value as TestCaseStep["action"];
}

export function protectedSecretsForSystem(
  context: BrainCreatorMcpContext,
  systemId: string
) {
  return Object.fromEntries(
    context.repository.authProfiles
      .filter((profile) => profile.projectId === systemId)
      .flatMap((profile) => {
        try {
          return Object.entries(decryptSecrets(profile.encryptedSecrets));
        } catch {
          return [];
        }
      })
  );
}
