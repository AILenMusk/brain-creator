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
import * as handlerArguments from "./handlerArguments.js";
import * as requirementWorkflowHandlers from "./requirementWorkflowHandlers.js";
import * as facadeProjectionHandlers from "./facadeProjectionHandlers.js";
export { summarizeStabilityRuns } from "./facadeProjectionHandlers.js";
const { textResult, facadeTextResult, compactFacadePayload, summarizeFacadeRecord, facadeReferences, envelopeResult, stringArg, optionalStringArg, executionProvenanceArg, optionalNumberArg, numberArg, optionalBooleanArg, mutationResultsArg, materializeAuthStorageState, actorJourneyArg, explorationScenarioArg, summarizeCoverageDimensions, planContextArg, chainContextArg, archiveRequirementSuiteRun, writeRequirementSuiteSnapshots, createRequirementBugReport, suiteContextArg, regressionContextArg, runModeArg, browserModeArg, suiteActionArg, explorationPlanActionsArg, explorationCleanupPolicyArg, onboardingApprovalStageArg, explorationResultArg, reviewTargetArg, stabilityPolicyArg, isKnowledgeReviewTarget, resolveSystemReference, systemCandidatesText, normalizeSystemLookup, inferSystemName, extractCaseSource, intentCaseSourceFilters, intentBugRegressionFilters, bugRegressionFilters, matchesBugRegressionFilters, mergeUniqueStrings, extractBugIds, extractCaseNos, extractPriorities, isPriorityToken, extractTaggedValues, extractPrecedingTaggedValues, escapeRegExp, isContinueRequest, isBugRegressionRequest, isBugReviewRequest, isDocumentSuiteRequest, parseBrainCreatorCommand, parseBrainCreatorCommandTokens, commandWithSystemReference, parseRunCommandInput, parseBugRegressionCommandInput, parseReviewCommandInput, splitCommandValues, commandReviewTarget, commandTokens, configureTargetArg, prepareActionArg, executionActionPhaseArg, evaluationProviderArg, evaluationInterventionCategoryArg, diagnosisAssetTypeArg, legacyDiagnosisDecisionArg, optionalExecutionFailureTypeArg, optionalExecutionDiagnosisVerdictArg, testDataTaskResultStatusArg, optionalTestDataProviderDecisionArg, testDataResolutionsArg, knowledgeNodeTypeArg, policyProviderArg, explorationInteractionModeArg, systemExplorationModeArg, requirementContentPackageArg, hostDownloadedAttachmentsArg, explorationTaskOutcomeArg, attachmentAnalysisArg, interactionEvidenceArg, pageEvidenceArg, trainingEvidenceArg, assertSystemEvidenceUrl, stringArrayArg, optionalStringArrayArg, optionalObjectArrayArg, recordArg, loginMethodArg, severityArg, gapStatusArg, responseModeArg, onboardingCreateNextAction, evaluationRuntimeBuildIdentity, evaluationRuntimeIdentity, gapSeverityArg, bugStatusArg, authCheckpointStatusArg, agentArg, agentOutputStatusArg, scenarioArrayArg, stepArrayArg, priorityArg, actionArg, protectedSecretsForSystem } = handlerArguments;
const { adjudicateRequirementDesign, assertExecutionPlanIsCurrent, authProfileStatusRank, compileRunSummary, completeRequirementEvidence, continueRequirementSuiteAfterTestData, executeNextRequirementSuiteCase, executeRequirementSuiteCase, finalizeRequirementSuiteCase, findAuthProfile, findAuthProfileById, findOrCreateHostHarnessSession, formatRequirementGeneratorContext, hostAgentPrompt, isArtifactRunLayout, isFeishuRequirementSource, prepareAgentTask, prepareFacade, recordAuthPreflight, recordExecutionActionFacade, recordExecutionEvidenceProgress, redactPostconditionVerification, reevaluateLegacyExecutionEvidence, refreshAndVerifyAuthState, reportKnowledgeGap, requirementArtifactLayout, requirementSuiteTestDataTaskPackage, resolveChainArtifactScope, resolveStructuredReporterMode, runApprovedChain, taskPackageFromStoredTask, verifyAuthForExecution } = requirementWorkflowHandlers;
const { actorJourneyEvidenceMatches, aggregateLegacyDiagnosisAudit, aggregateLegacyDiagnosisReviewSummary, brainRuntimeStatus, caseSuiteExecutionSnapshot, computeNextAction, connectorStatus, countBy, executionDiagnosisReviewSummary, facadeNextAction, knowledgeReview, knowledgeStatus, legacyDiagnosisEvalMarkdown, nextCommandForAction, nextFacadeToolForAction, nextStepForAction, paginateReviewItems, requirementSuiteReconciliation, requirementSuiteRunCollectionSummary, sessionResume, statusFacade, statusMarkdown, statusQuickCommands, statusSystemSelection, statusToolGuidance, statusUserSummary, summarizeStabilityRuns, testReadinessForSystem, unfinishedCaseSuites, uniqueStrings } = facadeProjectionHandlers;


export type BrainCreatorMcpContext = {
  repository: InMemoryBrainCreatorRepository;
  service: BrainCreatorService;
  knowledgeService: KnowledgeService;
  requirementAnalysisHarness: RequirementAnalysisHostHarness;
  testDataProvider: TestDataProviderService;
  testDataBrain: TestDataBrainService;
  executionPreflight: ExecutionPreflightService;
  requirementSuiteRuns: RequirementSuiteRunService;
  runLedger: RunLedgerService;
  executionDiagnosis: ExecutionDiagnosisService;
  systemExploration: SystemExplorationCoordinator;
  statefulExplorationPlans: StatefulExplorationPlanService;
  onboardingPlans: OnboardingPlanService;
  harness: HarnessRuntime;
  semanticSpine: SemanticSpineService;
  systemBrainSnapshots: SystemBrainSnapshotService;
  providerRegistry: EvaluationProviderRegistry;
  evaluationIntegrity: EvaluationIntegrityService;
  requirementGate: RequirementGateService;
  workDir: string;
  testDataProviderStatus: "configured" | "not-configured" | "synthetic-test-only";
  agentBridge?: AgentBridgeWithMetadata;
  runner?: CommandRunner;
  structuredReporter?: boolean;
  authStateVerifier: AuthStateVerifier;
  authStateMaterializer: AuthStateMaterializer;
  authStateRefresher?: AuthStateRefresher;
  authRefreshRegistry: AuthStateRefreshRegistry;
  postconditionVerifier?: ExecutionPostconditionVerifier;
  authVerificationCache: Map<string, number>;
  feishuReader?: RequirementSourceReader;
  runtimeConfiguration?: RuntimeConfiguration;
  runtimeConfigurationPath: string;
  reloadRuntimeConfiguration: (input?: {
    configuration?: RuntimeConfiguration;
    persist?: boolean;
  }) => Promise<{ configuration?: RuntimeConfiguration; bridgeProvider?: string; connectorStatus: string; path: string }>;
};

export function validateScheduledTrialBinding(
  context: BrainCreatorMcpContext,
  run: RequirementSuiteRun,
  requestedTrialId?: string
) {
  if (requestedTrialId && run.evaluationTrialId !== requestedTrialId) {
    throw new Error("Requirement suite run belongs to another evaluation trial");
  }
  if (!run.evaluationTrialId) return;
  const binding = context.evaluationIntegrity.validateExecutionBinding({
    trialId: run.evaluationTrialId,
    knowledgeProjectId: run.knowledgeProjectId,
    systemId: run.systemId,
    executableCaseIds: run.caseRuns.map((item) => item.executableCaseId),
    requirementSetIds: run.requirementSetIds,
    runtimeBuildIdentity: evaluationRuntimeBuildIdentity(context)
  });
  if (!binding.valid) {
    throw new Error(`Evaluation trial binding is invalid: ${binding.reasons.join("; ")}`);
  }
}

export type HostAgentTaskPackage = {
  status: "needs_agent_execution";
  task: AgentTask;
  promptPath: string;
  contextPath: string;
  outputPaths: string[];
  submitTool: "bc_submit_agent_output";
  nextAction: string;
};

type CreateContextInput = {
  dataFilePath?: string;
  storeDirPath?: string;
  workDir?: string;
  agentBridge?: AgentBridgeWithMetadata;
  runner?: CommandRunner;
  structuredReporter?: boolean;
  authStateVerifier?: AuthStateVerifier;
  authStateMaterializer?: AuthStateMaterializer;
  authStateRefresher?: AuthStateRefresher;
  authRefreshRegistry?: AuthStateRefreshRegistry;
  authRefreshAdapters?: AuthRefreshAdapter[];
  testDataProviders?: TestDataProvider[];
  testDataNoEffectVerifier?: TestDataNoEffectVerifier;
  postconditionVerifier?: ExecutionPostconditionVerifier;
  knowledgeDir?: string;
  feishuReader?: RequirementSourceReader;
  systemExplorer?: SystemExplorer;
};

export function createBrainCreatorMcpContext(
  input: CreateContextInput = {}
): BrainCreatorMcpContext {
  const workDir = input.workDir ?? resolveBrainCreatorWorkspace();
  const initialRuntimeConfiguration = readRuntimeConfiguration(workDir);
  const initialRuntimeEnvironment = runtimeEnvironment(initialRuntimeConfiguration, process.env);
  const configuredTestData = configuredTestDataAdapter(workDir);
  if (input.testDataProviders?.length && configuredTestData.status === "configured") {
    throw new Error("Provide Testdata providers either through context injection or the configured adapter module, not both");
  }
  const authStateMaterializer = input.authStateMaterializer ?? materializeBrowserAuthState;
  const genericAuthRefreshAdapters: AuthRefreshAdapter[] = [
    {
      provider: "token",
      supports: (refreshInput) => refreshInput.authProfile.loginMethod === "token",
      refresh: async (refreshInput) => {
        const materialized = await authStateMaterializer({
          workDir: refreshInput.workDir,
          system: refreshInput.system,
          authProfile: refreshInput.authProfile
        });
        return { status: "succeeded", storageStatePath: materialized.storageStatePath };
      }
    },
    {
      provider: "cookie",
      supports: (refreshInput) => refreshInput.authProfile.loginMethod === "cookie",
      refresh: async (refreshInput) => {
        const materialized = await authStateMaterializer({
          workDir: refreshInput.workDir,
          system: refreshInput.system,
          authProfile: refreshInput.authProfile
        });
        return { status: "succeeded", storageStatePath: materialized.storageStatePath };
      }
    }
  ];
  const repository = input.dataFilePath
    ? new JsonFileBrainCreatorRepository(input.dataFilePath)
    : new ShardedFileBrainCreatorRepository(
        input.storeDirPath ?? resolveBrainCreatorStoreDir(workDir),
        resolveBrainCreatorDataFile(workDir)
      );
  const harness = new HarnessRuntime(repository);
  const semanticSpine = new SemanticSpineService(repository);
  const systemBrainSnapshots = new SystemBrainSnapshotService(repository);
  const providerRegistry = new EvaluationProviderRegistry({
    environment: initialRuntimeEnvironment
  });
  const integrityAuthenticator = createWorkspaceIntegrityAuthenticator(workDir);
  const evaluationIntegrity = new EvaluationIntegrityService(repository, integrityAuthenticator);
  const requirementGate = new RequirementGateService(repository);
  const service = new BrainCreatorService(repository);
  const configuredAuthProviders = new Set(
    (input.authRefreshAdapters ?? []).map((adapter) => adapter.provider)
  );
  const authRegistryManaged = !input.authRefreshRegistry;
  const createRuntimeAuthRefreshRegistry = () =>
    createDefaultAuthRefreshRegistry(input.authStateRefresher, [
      ...(input.authRefreshAdapters ?? []),
      ...createStandardAuthProviderAdapters().filter(
        (adapter) => !configuredAuthProviders.has(adapter.provider)
      ),
      ...genericAuthRefreshAdapters
    ]);
  const knowledgeService = new KnowledgeService(
    repository,
    input.knowledgeDir ?? resolveBrainCreatorKnowledgeDir(workDir),
    workDir,
    systemBrainSnapshots,
    semanticSpine,
    integrityAuthenticator
  );
  const requirementAnalysisHarness = new RequirementAnalysisHostHarness(
    repository,
    harness,
    input.knowledgeDir ?? resolveBrainCreatorKnowledgeDir(workDir),
    requirementGate
  );
  const testDataBrain = new TestDataBrainService(repository, [
    ...(input.testDataProviders ?? []),
    ...configuredTestData.providers,
    ...(process.env.NODE_ENV === "test" && !input.testDataProviders?.length && configuredTestData.status !== "configured"
      ? [new InMemoryTestDataProvider("local-fixture-provider")]
      : [])
  ]);
  const testDataProvider = new TestDataProviderService(
    repository,
    knowledgeService,
    join(workDir, ".brain-creator"),
    testDataBrain,
    input.testDataNoEffectVerifier ?? configuredTestData.noEffectVerifier
  );
  const executionPreflight = new ExecutionPreflightService(repository);
  const runLedger = new RunLedgerService(repository, undefined, undefined, integrityAuthenticator);
  const executionDiagnosis = new ExecutionDiagnosisService(repository);
  const requirementSuiteRuns = new RequirementSuiteRunService(
    repository,
    runLedger,
    undefined,
    evaluationIntegrity
  );
  const statefulExplorationPlans = new StatefulExplorationPlanService(
    repository,
    knowledgeService
  );
  const onboardingPlans = new OnboardingPlanService(
    repository,
    knowledgeService,
    statefulExplorationPlans
  );
  const runtimeManaged = !input.agentBridge && !input.runner;
  const context: BrainCreatorMcpContext = {
    repository,
    service,
    knowledgeService,
    requirementAnalysisHarness,
    testDataProvider,
    testDataBrain,
    executionPreflight,
    requirementSuiteRuns,
    runLedger,
    executionDiagnosis,
    systemExploration: new SystemExplorationCoordinator({
      repository,
      service,
      knowledgeService,
      workDir,
      explorer: input.systemExplorer
    }),
    statefulExplorationPlans,
    onboardingPlans,
    harness,
    semanticSpine,
    systemBrainSnapshots,
    providerRegistry,
    evaluationIntegrity,
    requirementGate,
    workDir,
    testDataProviderStatus: input.testDataProviders?.length || configuredTestData.status === "configured"
      ? "configured"
      : process.env.NODE_ENV === "test"
        ? "synthetic-test-only"
        : "not-configured",
    agentBridge:
      input.agentBridge ??
      (input.runner
        ? commandRunnerAgentBridge(input.runner)
        : createConfiguredAgentBridge({ env: initialRuntimeEnvironment })),
    runner: input.runner,
    structuredReporter: input.structuredReporter,
    authStateVerifier: input.authStateVerifier ?? verifyStoredBrowserAuth,
    authStateMaterializer,
    authStateRefresher: input.authStateRefresher,
    authRefreshRegistry: input.authRefreshRegistry ?? createRuntimeAuthRefreshRegistry(),
    postconditionVerifier: input.postconditionVerifier ?? configuredPostconditionVerifier(workDir),
    authVerificationCache: new Map(),
    feishuReader: input.feishuReader ?? configuredFeishuReader(initialRuntimeEnvironment),
    runtimeConfiguration: initialRuntimeConfiguration,
    runtimeConfigurationPath: resolveRuntimeConfigurationPath(workDir),
    reloadRuntimeConfiguration: async (reloadInput = {}) => {
      const configuration = reloadInput.configuration === undefined
        ? readRuntimeConfiguration(workDir)
        : reloadInput.configuration;
      const candidateEnvironment = runtimeEnvironment(configuration, process.env);
      const candidateBridge = runtimeManaged
        ? createConfiguredAgentBridge({ env: candidateEnvironment })
        : context.agentBridge;
      const candidateAuthRefreshRegistry = authRegistryManaged
        ? createRuntimeAuthRefreshRegistry()
        : context.authRefreshRegistry;
      if (runtimeManaged && configuration?.bridgeProvider !== "disabled") {
        const bridgeCheck = await preflightAgentBridge(candidateBridge);
        if (!bridgeCheck.ok) {
          throw new BrainCreatorError({
            code: "BC_RUNTIME_PREFLIGHT_FAILED",
            message: bridgeCheck.error ?? "Runtime bridge preflight failed",
            userMessage: {
              enUS: `Runtime configuration preflight failed: ${bridgeCheck.error ?? "unknown error"}`,
              zhCN: `运行时配置预检失败：${bridgeCheck.error ?? "未知错误"}`
            },
            nextAction: "review-runtime-config",
            retryable: true
          });
        }
      }
      if (reloadInput.persist && configuration) writeRuntimeConfiguration(workDir, configuration);
      if (runtimeManaged) {
        context.agentBridge = candidateBridge;
        context.feishuReader = configuredFeishuReader(candidateEnvironment);
        context.providerRegistry = new EvaluationProviderRegistry({
          environment: candidateEnvironment
        });
      }
      if (authRegistryManaged) context.authRefreshRegistry = candidateAuthRefreshRegistry;
      context.runtimeConfiguration = configuration;
      return {
        ...(configuration ? { configuration } : {}),
        ...(candidateBridge?.provider ? { bridgeProvider: candidateBridge.provider } : {}),
        registeredAuthProviders: candidateAuthRefreshRegistry.providers(),
        connectorStatus: context.feishuReader ? "feishu-configured" : "host-agent-fallback",
        path: resolveRuntimeConfigurationPath(workDir)
      };
    }
  };
  return context;
}

export async function handleBrainCreatorTool(
  context: BrainCreatorMcpContext,
  name: BrainCreatorToolName,
  input: Record<string, unknown>,
  request?: BrainCreatorToolRequest
): Promise<CallToolResult> {
  try {
    switch (name) {
      case "bc_prepare":
        return facadeTextResult(await prepareFacade(context, input), input);
      case "bc_command":
        return textResult(await commandFacade(context, input));
      case "bc_intent_preview":
        return textResult(intentPreviewFacade(context, input));
      case "bc_status":
        return facadeTextResult({
          ...await statusFacade(context, input),
          runtimeIdentity: readRuntimeIdentity({ workspace: context.workDir, schemaVersion: context.repository.schemaVersion,
          provider: context.agentBridge?.provider ?? context.runtimeConfiguration?.bridgeProvider ?? "disabled", processKind: "mcp" }),
        recoveryCapabilities: {
          automaticPostconditionVerification: context.postconditionVerifier ? "configured" : "not-configured"
        },
        runtimeCapabilities: {
          testDataProvider: context.testDataProviderStatus
        }
        }, input);
      case "bc_run":
        return facadeTextResult(
          {
            ...await runWithProgress(context, input, request),
            runtimeIdentity: evaluationRuntimeIdentity(context)
          },
          input
        );
      case "bc_review":
        return facadeTextResult(await reviewFacade(context, input), input);
      case "bc_configure":
        return facadeTextResult(await configureFacade(context, input), input);
      case "bc_create_system":
        return textResult(
          context.service.createSystemProfile({
            name: stringArg(input, "name"),
            environment: stringArg(input, "environment"),
            baseUrl: stringArg(input, "baseUrl"),
            executionProvenance: executionProvenanceArg(input),
            defaultLocale: optionalStringArg(input, "defaultLocale") ?? "zh-CN",
            urlAllowlist: stringArrayArg(input, "urlAllowlist")
          })
        );
      case "bc_list_systems":
        return textResult(context.service.listSystemProfiles());
      case "bc_session_resume":
        return textResult(await sessionResume(context, input));
      case "bc_system_overview":
        return textResult(context.service.getSystemOverview(stringArg(input, "systemId")));
      case "bc_archive_system":
        return textResult(context.service.archiveSystemProfile(stringArg(input, "systemId")));
      case "bc_create_auth":
        return textResult(
          context.service.createAuthProfile({
            projectId: stringArg(input, "projectId"),
            env: stringArg(input, "env"),
            role: stringArg(input, "role"),
            loginMethod: loginMethodArg(input, "loginMethod"),
            secrets: recordArg(input, "secrets")
          })
        );
      case "bc_list_auth":
        return textResult(context.service.listAuthProfiles(stringArg(input, "systemId")));
      case "bc_verify_auth":
        return textResult(context.service.verifyAuthProfile(stringArg(input, "id")));
      case "bc_archive_auth":
        return textResult(context.service.archiveAuthProfile(stringArg(input, "id")));
      case "bc_generate_seed":
        return textResult(await generateSeed(context, input));
      case "bc_create_auth_checkpoint":
        {
          const systemId = stringArg(input, "systemId");
          const evaluationTrialId = optionalStringArg(input, "evaluationTrialId");
          if (evaluationTrialId) {
            const trial = context.repository.evaluationTrials.find((item) => item.id === evaluationTrialId);
            if (!trial || trial.status !== "active" || trial.systemId !== systemId) {
              throw new Error("Auth checkpoint Trial must be active and belong to the same business system");
            }
          }
        return textResult(
          context.service.createAuthCheckpoint({
            systemId,
            authProfileId: stringArg(input, "authProfileId"),
            testCaseId: optionalStringArg(input, "testCaseId"),
            evaluationTrialId,
            requirementSuiteRunId: optionalStringArg(input, "requirementSuiteRunId"),
            executableCaseId: optionalStringArg(input, "executableCaseId"),
            businessScenarioId: optionalStringArg(input, "businessScenarioId"),
            reason: stringArg(input, "reason"),
            resumeInstruction: stringArg(input, "resumeInstruction")
          })
        );
        }
      case "bc_list_auth_checkpoints":
        return textResult(
          context.service.listAuthCheckpoints(
            stringArg(input, "systemId"),
            authCheckpointStatusArg(input, "status")
          )
        );
      case "bc_complete_auth_checkpoint":
        {
          const checkpointId = stringArg(input, "checkpointId");
          const checkpoint = context.repository.authCheckpoints.find((item) => item.id === checkpointId);
          if (!checkpoint) throw new Error("Auth checkpoint not found");
          const trial = checkpoint.evaluationTrialId
            ? context.repository.evaluationTrials.find((item) => item.id === checkpoint.evaluationTrialId)
            : undefined;
          if (checkpoint.evaluationTrialId && (!trial || trial.status !== "active" || trial.systemId !== checkpoint.systemId)) {
            throw new Error("Auth checkpoint Trial is no longer active or does not match the business system");
          }
          const suiteRun = checkpoint.requirementSuiteRunId
            ? context.repository.requirementSuiteRuns.find((item) => item.id === checkpoint.requirementSuiteRunId)
            : undefined;
          if (checkpoint.requirementSuiteRunId && (
            !suiteRun ||
            suiteRun.systemId !== checkpoint.systemId ||
            suiteRun.evaluationTrialId !== checkpoint.evaluationTrialId
          )) {
            throw new Error("Auth checkpoint requirement suite binding is no longer valid");
          }
          if (checkpoint.executableCaseId && suiteRun && !suiteRun.caseRuns.some(
            (item) => item.executableCaseId === checkpoint.executableCaseId
          )) {
            throw new Error("Auth checkpoint executable case is no longer in its requirement suite");
          }
          if (checkpoint.businessScenarioId && !trial?.executionScope?.businessScenarioIds.includes(checkpoint.businessScenarioId)) {
            throw new Error("Auth checkpoint scenario is no longer in the frozen Trial scope");
          }
          const completed = context.service.completeAuthCheckpoint(checkpointId);
          if (trial) {
            context.evaluationIntegrity.recordIntervention({
              trialId: trial.id,
              category: "user-authentication",
              actor: "user",
              note: `Completed manual authentication checkpoint ${checkpoint.id}`,
              evidenceRefs: [
                `auth-checkpoint:${checkpoint.id}`,
                ...(checkpoint.requirementSuiteRunId
                  ? [`requirement-suite-run:${checkpoint.requirementSuiteRunId}`]
                  : []),
                ...(checkpoint.executableCaseId
                  ? [`executable-case:${checkpoint.executableCaseId}`]
                  : [])
              ],
              ...(checkpoint.businessScenarioId
                ? { businessScenarioIds: [checkpoint.businessScenarioId] }
                : {}),
              ...(checkpoint.authenticationPhase
                ? { authenticationPhase: checkpoint.authenticationPhase }
                : {})
            });
          }
          return textResult(completed);
        }
      case "bc_cancel_auth_checkpoint":
        return textResult(context.service.cancelAuthCheckpoint(stringArg(input, "checkpointId")));
      case "bc_add_term":
        return textResult(
          context.service.createGlossaryTerm({
            projectId: stringArg(input, "projectId"),
            key: stringArg(input, "key"),
            zhCN: stringArg(input, "zhCN"),
            enUS: stringArg(input, "enUS"),
            aliases: stringArrayArg(input, "aliases"),
            pageScope: optionalStringArg(input, "pageScope") ?? "/"
          })
        );
      case "bc_list_terms":
        return textResult(
          context.service.listGlossaryTerms({
            projectId: stringArg(input, "projectId"),
            query: optionalStringArg(input, "query") ?? ""
          })
        );
      case "bc_update_term":
        return textResult(
          context.service.updateGlossaryTerm({
            projectId: stringArg(input, "projectId"),
            termId: stringArg(input, "termId"),
            key: stringArg(input, "key"),
            zhCN: stringArg(input, "zhCN"),
            enUS: stringArg(input, "enUS"),
            aliases: stringArrayArg(input, "aliases"),
            pageScope: optionalStringArg(input, "pageScope") ?? "/"
          })
        );
      case "bc_delete_term":
        return textResult(
          context.service.deleteGlossaryTerm({
            projectId: stringArg(input, "projectId"),
            termId: stringArg(input, "termId")
          })
        );
      case "bc_batch_confirm_terms":
        return textResult(
          context.service.confirmCandidateTerms({
            caseId: stringArg(input, "caseId"),
            confirmTermIds: stringArrayArg(input, "confirmTermIds"),
            ignoreTermIds: stringArrayArg(input, "ignoreTermIds")
          })
        );
      case "bc_add_rule":
        return textResult(
          context.service.createBusinessRule({
            systemId: stringArg(input, "systemId"),
            name: stringArg(input, "name"),
            condition: stringArg(input, "condition"),
            severity: severityArg(input, "severity")
          })
        );
      case "bc_list_rules":
        return textResult(context.service.listBusinessRules(stringArg(input, "systemId")));
      case "bc_delete_rule":
        return textResult(
          context.service.deleteBusinessRule({
            systemId: stringArg(input, "systemId"),
            ruleId: stringArg(input, "ruleId")
          })
        );
      case "bc_generate_plan":
        return textResult(await generatePlan(context, input));
      case "bc_update_plan":
        return textResult(
          context.service.updateTestCaseScenarios(
            stringArg(input, "caseId"),
            scenarioArrayArg(input, "scenarios")
          )
        );
      case "bc_approve_plan":
        return textResult(context.service.approveTestCase(stringArg(input, "caseId")));
      case "bc_cancel_plan":
        return textResult(
          context.service.cancelTestCase(stringArg(input, "caseId"), stringArg(input, "reason"))
        );
      case "bc_resume_plan":
        return textResult(context.service.resumeTestCase(stringArg(input, "caseId")));
      case "bc_run_agent":
        return textResult(await runSingleAgent(context, input));
      case "bc_prepare_agent_task":
        return textResult(await prepareAgentTask(context, input));
      case "bc_submit_agent_output":
        return textResult(
          await submitAgentOutputWithProgress(context, input, request)
        );
      case "bc_list_agent_runs":
        return textResult(context.service.listAgentRuns(stringArg(input, "systemId")));
      case "bc_run_chain":
        return textResult(await runApprovedChain(context, input));
      case "bc_full_workflow":
        return textResult(await fullWorkflow(context, input));
      case "bc_list_chain_runs":
        return textResult(context.service.listChainRuns(stringArg(input, "systemId")));
      case "bc_list_specs":
        return textResult(context.service.listTestSpecs(stringArg(input, "systemId")));
      case "bc_list_tests":
        return textResult(context.service.listTestFiles(stringArg(input, "systemId")));
      case "bc_read_spec":
        return textResult(await readArtifact(context, input, "test-spec"));
      case "bc_read_test":
        return textResult(await readArtifact(context, input, "test-file"));
      case "bc_artifact_overview":
        return textResult(await artifactOverview(context, input));
      case "bc_list_cases":
        return textResult(context.service.listTestCases(stringArg(input, "systemId")));
      case "bc_list_gaps":
        return textResult(
          context.service.listGaps({
            projectId: stringArg(input, "projectId"),
            status: gapStatusArg(input, "status")
          })
        );
      case "bc_report_gap":
        return textResult(
          context.service.reportGap({
            projectId: stringArg(input, "projectId"),
            sourceType: stringArg(input, "sourceType"),
            sourceId: stringArg(input, "sourceId"),
            reason: stringArg(input, "reason"),
            severity: gapSeverityArg(input, "severity"),
            owner: stringArg(input, "owner")
          })
        );
      case "bc_resolve_gap":
        throw new Error(
          "Direct Gap resolution is disabled because it cannot preview or bind evidence. Use bc_prepare action=resolve-gap with confirm=false, then confirm=true with a confirmationNote and evidenceRefs."
        );
      case "bc_search_assets":
        return textResult(
          context.service.searchAssets({
            projectId: stringArg(input, "projectId"),
            query: stringArg(input, "query")
          })
        );
      default:
        throw new Error(`Unknown Brain Creator tool: ${name}`);
    }
  } catch (error) {
    await notifyMcpProgress(request, {
      progress: 1,
      total: 1,
      message: "Brain Creator failed. Inspect the error envelope and trace ID."
    });
    return envelopeResult(errorEnvelope(error), true);
  }
}

async function runWithProgress(
  context: BrainCreatorMcpContext,
  input: Record<string, unknown>,
  request?: BrainCreatorToolRequest
) {
  await notifyMcpProgress(request, {
    progress: 0,
    total: 1,
    message: "Brain Creator started the requested run."
  });
  const result = await runFacade(context, input);
  await publishResultProgress(context, result, input, request);
  return result;
}

async function submitAgentOutputWithProgress(
  context: BrainCreatorMcpContext,
  input: Record<string, unknown>,
  request?: BrainCreatorToolRequest
) {
  await notifyMcpProgress(request, {
    progress: 0,
    total: 1,
    message: "Brain Creator is validating the submitted Agent output."
  });
  const result = await submitAgentOutput(context, input);
  await publishResultProgress(context, result, input, request);
  return result;
}

async function publishResultProgress(
  context: BrainCreatorMcpContext,
  result: Record<string, unknown>,
  input: Record<string, unknown>,
  request?: BrainCreatorToolRequest
) {
  const runId = findNestedString(result, "requirementSuiteRunId") ??
    findNestedString(result, "suiteId") ??
    findNestedString(result, "id", "requirementSuiteRun");
  if (!runId) {
    await notifyMcpProgress(request, {
      progress: 1,
      total: 1,
      message: "Brain Creator completed the requested operation."
    });
    return;
  }
  let progress;
  try {
    progress = context.runLedger.progress(runId);
  } catch {
    await notifyMcpProgress(request, {
      progress: 1,
      total: 1,
      message: `Brain Creator updated run ${runId}.`
    });
    return;
  }
  const events = input.observationMode === "step-by-step"
    ? progress.events.slice(-50)
    : progress.current
      ? [progress.current]
      : [];
  for (const event of events) {
    await notifyMcpProgress(request, {
      progress: event.sequence,
      message: [
        event.caseTitle,
        event.stepTitle,
        event.status
      ].filter(Boolean).join(" | ")
    });
  }
}

async function notifyMcpProgress(
  request: BrainCreatorToolRequest | undefined,
  params: { progress: number; total?: number; message?: string }
) {
  if (request?.progressToken === undefined || !request.sendNotification) return;
  try {
    await request.sendNotification({
      method: "notifications/progress",
      params: {
        progressToken: request.progressToken,
        ...params
      }
    });
  } catch {
    // Progress transport is best-effort; the durable Run Ledger remains authoritative.
  }
}

function findNestedString(
  value: unknown,
  key: string,
  parentKey?: string,
  currentKey?: string,
  depth = 0
): string | undefined {
  if (!value || typeof value !== "object" || depth > 5) return undefined;
  for (const [childKey, child] of Object.entries(value as Record<string, unknown>)) {
    if (childKey === key && typeof child === "string" && (!parentKey || currentKey === parentKey)) {
      return child;
    }
    const nested = findNestedString(child, key, parentKey, childKey, depth + 1);
    if (nested) return nested;
  }
  return undefined;
}

async function commandFacade(context: BrainCreatorMcpContext, input: Record<string, unknown>) {
  const command = stringArg(input, "command");
  const commandInput = commandWithSystemReference(command);
  if (isBrainCreatorHelpCommand(commandInput.tokens)) {
    validateHelpCommandTokens(commandInput.tokens);
    const resolution = hasCommandSystemContext(input, commandInput.systemReference)
      ? resolveSystemReference(context, input, commandInput.systemReference)
      : undefined;
    return {
      command,
      action: "help",
      userMessage: "Brain Creator shortcuts are available through /bc commands.",
      helpMarkdown: brainCreatorCommandHelpMarkdown(),
      shortcuts: brainCreatorCommandShortcuts(),
      ...(resolution ? { systemResolution: resolution } : {})
    };
  }
  if (
    isBrainCreatorStatusCommand(commandInput.tokens) &&
    !hasCommandSystemIdentity(input, commandInput.systemReference)
  ) {
    const toolInput = {
      ...(optionalStringArg(input, "environment") || commandInput.systemReference.environment
        ? {
            environment:
              optionalStringArg(input, "environment") ?? commandInput.systemReference.environment
          }
        : {})
    };
    return {
      command,
      tool: "bc_status",
      toolInput,
      result: await statusFacade(context, toolInput)
    };
  }
  const resolution = resolveSystemReference(context, input, commandInput.systemReference);
  const parsed = parseBrainCreatorCommandTokens(commandInput.tokens, resolution.systemId);
  const result =
    parsed.tool === "bc_status"
      ? await statusFacade(context, parsed.toolInput)
      : parsed.tool === "bc_review"
        ? await reviewFacade(context, parsed.toolInput)
        : await runFacade(context, parsed.toolInput);
  return {
    command,
    tool: parsed.tool,
    toolInput: parsed.toolInput,
    systemResolution: resolution,
    result
  };
}

function isBrainCreatorHelpCommand(tokens: string[]) {
  return tokens[0]?.toLowerCase() === "/bc" && tokens[1]?.toLowerCase() === "help";
}

function isBrainCreatorStatusCommand(tokens: string[]) {
  return (
    tokens.length === 2 &&
    tokens[0]?.toLowerCase() === "/bc" &&
    tokens[1]?.toLowerCase() === "status"
  );
}

function validateHelpCommandTokens(tokens: string[]) {
  for (const token of tokens.slice(2)) {
    if (token.startsWith("--")) {
      throw new Error(`Unsupported /bc help option: ${token}`);
    }
    throw new Error(`Unexpected /bc help argument: ${token}`);
  }
}

function hasCommandSystemContext(
  input: Record<string, unknown>,
  systemReference: { systemName?: string; environment?: string }
) {
  return Boolean(
    optionalStringArg(input, "systemId") ||
      optionalStringArg(input, "systemName") ||
      optionalStringArg(input, "environment") ||
      systemReference.systemName ||
      systemReference.environment
  );
}

function hasCommandSystemIdentity(
  input: Record<string, unknown>,
  systemReference: { systemName?: string; environment?: string }
) {
  return Boolean(
    optionalStringArg(input, "systemId") ||
      optionalStringArg(input, "systemName") ||
      systemReference.systemName
  );
}

function intentPreviewFacade(context: BrainCreatorMcpContext, input: Record<string, unknown>) {
  const request = stringArg(input, "request");
  const systemName = optionalStringArg(input, "systemName") ?? inferSystemName(context, request);
  const resolution = resolveSystemReference(context, { ...input, systemName });
  const source = optionalStringArg(input, "source") ?? extractCaseSource(request);
  const normalizedRequest = request.toLowerCase();
  const filters = intentCaseSourceFilters(input, request);
  const bugFilters = intentBugRegressionFilters(input, request);

  if (isContinueRequest(normalizedRequest)) {
    return {
      request,
      intent: "continue-suite",
      tool: "bc_run",
      toolInput: {
        mode: "case-source-suite",
        systemId: resolution.systemId,
        resume: true,
        confirm: true
      },
      systemResolution: resolution,
      requiresConfirmation: false,
      userMessage: "Continue the latest unfinished suite for the selected system."
    };
  }

  if (isBugRegressionRequest(normalizedRequest)) {
    return {
      request,
      intent: "regress-open-bugs",
      tool: "bc_run",
      toolInput: {
        mode: "bug-regression",
        systemId: resolution.systemId,
        ...bugFilters
      },
      systemResolution: resolution,
      requiresConfirmation: false,
      userMessage: "Run regression for open BugReports in the selected system."
    };
  }

  if (isBugReviewRequest(normalizedRequest)) {
    return {
      request,
      intent: "review-open-bugs",
      tool: "bc_review",
      toolInput: {
        target: "bug",
        systemId: resolution.systemId,
        status: "open"
      },
      systemResolution: resolution,
      requiresConfirmation: false,
      userMessage: "Review open BugReports for the selected system."
    };
  }

  if (isDocumentSuiteRequest(normalizedRequest, source)) {
    if (!source) {
      throw new Error("A test case document path is required for a document suite request.");
    }
    return {
      request,
      intent: "case-source-suite-preview",
      tool: "bc_run",
      toolInput: {
        mode: "case-source-suite",
        systemId: resolution.systemId,
        source,
        ...filters,
        confirm: false
      },
      systemResolution: resolution,
      requiresConfirmation: true,
      userMessage: "Preview the document suite first; ask the user to confirm before executing."
    };
  }

  return {
    request,
    intent: "status",
    tool: "bc_status",
    toolInput: {
      systemId: resolution.systemId
    },
    systemResolution: resolution,
    requiresConfirmation: false,
    userMessage: "Inspect the selected system status before choosing the next facade action."
  };
}













async function runFacade(context: BrainCreatorMcpContext, input: Record<string, unknown>) {
  const mode = runModeArg(input, "mode");
  if (mode === "approved-case") {
    return runApprovedChain(context, { ...input, caseId: stringArg(input, "caseId") });
  }
  if (mode === "full-workflow") {
    return fullWorkflow(context, { ...input, caseId: stringArg(input, "caseId") });
  }
  if (mode === "requirement-suite") {
    return runRequirementSuite(context, input);
  }
  const resolution = resolveSystemReference(context, input);
  const inputWithSystem = { ...input, systemId: resolution.systemId };
  if (mode === "case-source-suite") {
    if (suiteActionArg(input) === "cancel") {
      return {
        ...(await cancelCaseSourceSuite(context, inputWithSystem)),
        systemResolution: resolution
      };
    }
    return {
      ...(await runCaseSourceSuite(context, inputWithSystem)),
      systemResolution: resolution
    };
  }
  return {
    ...(await runBugRegression(context, inputWithSystem)),
    systemResolution: resolution
  };
}

async function cancelCaseSourceSuite(
  context: BrainCreatorMcpContext,
  input: Record<string, unknown>
) {
  const systemId = stringArg(input, "systemId");
  const resumeTarget = optionalBooleanArg(input, "resume")
    ? latestUnfinishedCaseSuite(context, systemId)
    : undefined;
  const suiteId = optionalStringArg(input, "suiteId") ?? resumeTarget?.suiteId;
  if (!suiteId) {
    throw new Error("suiteId is required to cancel a document case suite");
  }
  const suite = context.service.getCaseSuite(suiteId);
  if (suite.systemId !== systemId) {
    throw new Error("Case suite belongs to another business system");
  }
  ensureDocumentSuiteLedger(context, suite);
  const cancelledSuite = context.service.cancelCaseSuite(suite.id);
  completeDocumentSuiteLedger(context, cancelledSuite, "cancelled");
  let reportPath: string | undefined;
  let reportWarning: string | undefined;
  try {
    reportPath = await writeDocumentSuiteReport(context, cancelledSuite);
  } catch (error) {
    reportWarning = error instanceof Error ? error.message : String(error);
  }
  return {
    mode: "case-source-suite",
    status: "cancelled",
    suite: cancelledSuite,
    progress: caseSuiteProgress(context, cancelledSuite),
    ...(reportPath ? { reportPath } : {}),
    ...(reportWarning ? { reportWarning } : {}),
    nextAction: "Run a new preview and confirm the document suite again."
  };
}

async function runCaseSourceSuite(context: BrainCreatorMcpContext, input: Record<string, unknown>) {
  const systemId = stringArg(input, "systemId");
  const resumeTarget = optionalBooleanArg(input, "resume")
    ? latestUnfinishedCaseSuite(context, systemId)
    : undefined;
  const source = optionalStringArg(input, "source") ?? resumeTarget?.source;
  if (!source) {
    throw new Error("source is required unless resume is true and an unfinished suite exists");
  }
  const requestedBrowserMode = browserModeArg(input);
  const requestedAuthProfileId = optionalStringArg(input, "authProfileId");
  const parsed = await parseCaseSource(source);
  const filters = caseSourceFilters(input);
  const selectedCases = filterDocumentCases(parsed.cases, filters);
  const caseSource = context.service.upsertCaseSource({
    systemId,
    source: parsed.source,
    sourceType: parsed.sourceType,
    contentHash: parsed.contentHash,
    caseCount: parsed.cases.length,
    moduleStats: parsed.moduleStats,
    priorityStats: parsed.priorityStats
  });
  const bridge = await preflightAgentBridge(context.agentBridge);

  if (!optionalBooleanArg(input, "confirm")) {
    return {
      mode: "case-source-suite",
      status: "preview",
      source: caseSource,
      summary: previewSummary(parsed, selectedCases),
      selection: selectionSummary(parsed.cases, selectedCases, filters),
      executionPolicy: {
        continueOnBlocked: optionalBooleanArg(input, "continueOnBlocked"),
        browserMode: requestedBrowserMode ?? "headless"
      },
      browserObservation: browserObservationCapability(
        requestedBrowserMode ?? "headless"
      ),
      bridge,
      requiresConfirmation: true,
      nextAction: "Ask the user to confirm before running the full suite."
    };
  }

  if (selectedCases.length === 0) {
    const gap = context.service.reportGap({
      projectId: systemId,
      sourceType: "case-source",
      sourceId: caseSource.id,
      reason:
        parsed.cases.length === 0
          ? "Case source has no executable document cases."
          : "Case source filters selected no executable document cases.",
      severity: "high",
      owner: "qa"
    });
    return { mode: "case-source-suite", status: "blocked", source: caseSource, gap, bridge };
  }

  if (context.service.listAuthProfiles(systemId).length === 0) {
    const gap = context.service.reportGap({
      projectId: systemId,
      sourceType: "case-source-suite",
      sourceId: caseSource.id,
      reason: "Auth profile is required before executing a document case suite.",
      severity: "high",
      owner: "qa"
    });
    return { mode: "case-source-suite", status: "blocked", source: caseSource, gap, bridge };
  }

  const selectedAuthProfile = requestedAuthProfileId
    ? findAuthProfileById(context, systemId, requestedAuthProfileId)
    : findAuthProfile(context, systemId);

  const awaitingAuthCheckpoints = context.service
    .listAuthCheckpoints(systemId, "awaiting-user")
    .filter((checkpoint) => checkpoint.authProfileId === selectedAuthProfile.id);
  if (awaitingAuthCheckpoints.length > 0) {
    const gap = context.service.reportGap({
      projectId: systemId,
      sourceType: "case-source-suite",
      sourceId: caseSource.id,
      reason: "Manual authentication checkpoint must be completed before executing a document case suite.",
      severity: "high",
      owner: "qa"
    });
    return {
      mode: "case-source-suite",
      status: "blocked",
      source: caseSource,
      gap,
      bridge,
      authCheckpoints: awaitingAuthCheckpoints
    };
  }

  const authState = await verifyCaseSourceSuiteAuthState(context, systemId, selectedAuthProfile);
  if (authState?.status === "expired") {
    const authCheckpoint = context.service.createAuthCheckpoint({
      systemId,
      authProfileId: selectedAuthProfile.id,
      reason: authState.reason ?? "Stored browser authentication has expired.",
      resumeInstruction:
        "Complete login in an isolated browser, save refreshed storage state, verify it in a fresh context, then resume the suite."
    });
    const gap = context.service.reportGap({
      projectId: systemId,
      sourceType: "case-source-suite-auth",
      sourceId: caseSource.id,
      reason: authState.reason ?? "Stored browser authentication has expired.",
      severity: "high",
      owner: "qa"
    });
    return {
      mode: "case-source-suite",
      status: "blocked",
      source: caseSource,
      authState,
      authCheckpoint,
      gap,
      bridge
    };
  }
  if (authState?.status === "unavailable") {
    const gap = context.service.reportGap({
      projectId: systemId,
      sourceType: "case-source-suite-auth",
      sourceId: caseSource.id,
      reason: authState.reason ?? "Stored browser authentication could not be verified.",
      severity: "high",
      owner: "qa"
    });
    return { mode: "case-source-suite", status: "blocked", source: caseSource, authState, gap, bridge };
  }

  if (!bridge.ok) {
    const gap = context.service.reportGap({
      projectId: systemId,
      sourceType: "case-source-suite",
      sourceId: caseSource.id,
      reason: `Agent bridge unavailable: ${bridge.error}`,
      severity: "high",
      owner: "qa"
    });
    return { mode: "case-source-suite", status: "blocked", source: caseSource, gap, bridge };
  }

  const requestedSuiteId = optionalStringArg(input, "suiteId") ?? resumeTarget?.suiteId;
  const requestedBrowserCapability = browserObservationCapability(
    requestedBrowserMode ?? "headless"
  );
  if (!requestedSuiteId && !requestedBrowserCapability.available) {
    return {
      mode: "case-source-suite",
      status: "blocked",
      source: caseSource,
      browserObservation: requestedBrowserCapability,
      nextAction: requestedBrowserCapability.reason
    };
  }
  const suite = requestedSuiteId
    ? existingCaseSuite(context, requestedSuiteId, systemId, caseSource.id)
    : context.service.createCaseSuite({
        systemId,
        sourceId: caseSource.id,
        totalCases: selectedCases.length,
        selectedCaseNos: selectedCases.map((documentCase) => documentCase.caseNo),
        continueOnBlocked: optionalBooleanArg(input, "continueOnBlocked"),
        browserMode: requestedBrowserMode ?? "headless",
        status: "approved"
      });
  const suiteBrowserMode = suite.browserMode ?? "headless";
  if (requestedBrowserMode && requestedBrowserMode !== suiteBrowserMode) {
    throw new Error("Document case suite cannot change its browser mode");
  }
  const browserCapability = browserObservationCapability(suiteBrowserMode);
  if (!browserCapability.available) {
    return {
      mode: "case-source-suite",
      status: "blocked",
      source: caseSource,
      suite,
      browserObservation: browserCapability,
      nextAction: browserCapability.reason
    };
  }
  if (optionalBooleanArg(input, "continueOnBlocked") && suite.continueOnBlocked !== true) {
    context.service.enableCaseSuiteContinueOnBlocked(suite.id);
  }
  ensureDocumentSuiteLedger(context, suite);
  let reportPath = await writeDocumentSuiteReport(context, suite, parsed.cases);
  const pendingAction = context.runLedger.latestUnresolvedAction(suite.id);
  if (pendingAction) {
    const pendingCase = pendingAction.caseNo
      ? parsed.cases.find((documentCase) => documentCase.caseNo === pendingAction.caseNo)
      : undefined;
    const waitingSuite = suite.status === "waiting-for-agent"
      ? suite
      : context.service.updateCaseSuiteStatus(suite.id, "waiting-for-agent");
    return {
      mode: "case-source-suite",
      status: "waiting",
      source: caseSource,
      authState,
      suite: waitingSuite,
      currentCase: pendingCase
        ? {
            caseNo: pendingCase.caseNo,
            title: pendingCase.title,
            status: "waiting-for-agent",
            gapIds: []
          }
        : undefined,
      pendingAction: {
        actionKey: pendingAction.actionKey,
        phase: pendingAction.actionPhase,
        stepId: pendingAction.stepId,
        actionSemantic: pendingAction.actionSemantic,
        entityReference: pendingAction.entityReference,
        postcondition: pendingAction.actionPostcondition,
        evidenceRefs: pendingAction.actionEvidenceRefs ?? [],
        nextAction: "reconcile-action"
      },
      waitReason:
        "A write action was sent but its result was not confirmed. Query the postcondition before retrying.",
      progress: caseSuiteProgress(context, waitingSuite),
      reportPath,
      nextAction: "reconcile-action"
    };
  }
  if (requestedSuiteId && optionalBooleanArg(input, "resume")) {
    recordDocumentSuiteLedger(context, suite, {
      event: "suite-resumed",
      scope: "suite",
      stage: "suite",
      fromStatus: suite.status,
      toStatus: "running"
    });
  }
  const alreadyPassed = passedCaseNosForSuite(context, systemId, suite.id);
  const alreadyBlocked = blockedCaseNosForSuite(context, systemId, suite.id);
  const casesToRun = parsed.cases.filter(
    (documentCase) =>
      suite.selectedCaseNos.includes(documentCase.caseNo) &&
      !alreadyPassed.has(documentCase.caseNo) &&
      !(suite.continueOnBlocked === true && alreadyBlocked.has(documentCase.caseNo))
  );
  if (context.agentBridge?.provider === "host-agent") {
    const pendingTask = context.service
      .listAgentTasks(systemId)
      .find(
        (task) =>
          task.status === "pending" &&
          task.suiteContext?.suiteId === suite.id
      );
    if (pendingTask?.suiteContext) {
      const currentCase = parsed.cases.find(
        (documentCase) => documentCase.caseNo === pendingTask.suiteContext?.caseNo
      );
      const waitingSuite = context.service.updateCaseSuiteStatus(suite.id, "waiting-for-agent");
      return {
        ...taskPackageFromStoredTask(pendingTask),
        mode: "case-source-suite",
        authState,
        stage: pendingTask.agent,
        source: caseSource,
        suite: waitingSuite,
        currentCase: {
          caseNo: pendingTask.suiteContext.caseNo,
          title: pendingTask.suiteContext.title,
          status: "waiting-for-agent",
          testCaseId: pendingTask.chainContext?.testCaseId,
          gapIds: []
        },
        progress: caseSuiteProgress(context, waitingSuite),
        documentCase: currentCase,
        reportPath
      };
    }
    const documentCase = casesToRun[0];
    if (!documentCase) {
      const completedSuite = context.service.updateCaseSuiteStatus(suite.id, "completed");
      completeDocumentSuiteLedger(context, completedSuite, "completed");
      reportPath = await writeDocumentSuiteReport(context, completedSuite, parsed.cases);
      return {
        mode: "case-source-suite",
        status: "completed",
        source: caseSource,
        authState,
        suite: completedSuite,
        progress: caseSuiteProgress(context, completedSuite),
        reportPath
      };
    }
    const result = await executeDocumentCase(context, {
      systemId,
      sourceId: caseSource.id,
      suiteId: suite.id,
      documentCase,
      maxHealAttempts: optionalNumberArg(input, "maxHealAttempts"),
      browserMode: suiteBrowserMode,
      createBugOnFailure: true
    });
    if (result.taskPackage) {
      const waitingSuite = context.service.updateCaseSuiteStatus(suite.id, "waiting-for-agent");
      reportPath = await writeDocumentSuiteReport(context, waitingSuite, parsed.cases);
      return {
        ...result.taskPackage,
        mode: "case-source-suite",
        authState,
        stage: result.taskPackage.task.agent,
        source: caseSource,
        suite: waitingSuite,
        currentCase: result.caseResult,
        progress: caseSuiteProgress(context, waitingSuite),
        reportPath
      };
    }
  }
  context.service.updateCaseSuiteStatus(suite.id, "running");
  const caseResults: CaseSuiteCaseResult[] = [];
  const artifactPaths: string[] = [];
  const bugReportIds: string[] = [];
  const gapIds: string[] = [];

  for (const documentCase of casesToRun) {
    const result = await executeDocumentCase(context, {
      systemId,
      sourceId: caseSource.id,
      suiteId: suite.id,
      documentCase,
      maxHealAttempts: optionalNumberArg(input, "maxHealAttempts"),
      browserMode: suiteBrowserMode,
      createBugOnFailure: true
    });
    caseResults.push(result.caseResult);
    if (result.artifactPaths) {
      artifactPaths.push(...result.artifactPaths);
    }
    if (result.bugReportId) {
      bugReportIds.push(result.bugReportId);
    }
    gapIds.push(...result.caseResult.gapIds);
  }

  const counts = countBy(caseResults, (result) => result.status);
  const nowPassed = new Set(alreadyPassed);
  for (const result of caseResults.filter((item) => item.status === "passed")) {
    nowPassed.add(result.caseNo);
  }
  const allSuiteCasesPassed = suite.selectedCaseNos.every((caseNo) => nowPassed.has(caseNo));
  const suiteRun = context.service.recordCaseSuiteRun({
    systemId,
    suiteId: suite.id,
    sourceId: caseSource.id,
    status: (counts.blocked ?? 0) > 0 ? "blocked" : (counts.failed ?? 0) > 0 ? "failed" : "completed",
    total: casesToRun.length,
    passed: counts.passed ?? 0,
    failed: counts.failed ?? 0,
    blocked: counts.blocked ?? 0,
    caseResults,
    artifactPaths: [...new Set(artifactPaths)],
    bugReportIds,
    gapIds,
    completedAt: new Date().toISOString()
  });
  context.service.updateCaseSuiteStatus(
    suite.id,
    allSuiteCasesPassed ? "completed" : "failed"
  );
  completeDocumentSuiteLedger(
    context,
    suite,
    allSuiteCasesPassed ? "completed" : "failed"
  );
  reportPath = await writeDocumentSuiteReport(context, suite, parsed.cases);
  const artifactManifest = await writeArtifactManifest({
    workDir: context.workDir,
    systemId,
    suiteRunId: suiteRun.id,
    artifactPaths: [...suiteRun.artifactPaths, reportPath],
    sourceRefs: [caseSource.id, suite.id],
    ownershipDirectory: dirname(dirname(reportPath)),
    protectedSecrets: protectedSecretsForSystem(context, systemId)
  });
  const bugs = context.service.listBugReports({ systemId }).filter((bug) =>
    bugReportIds.includes(bug.id)
  );
  const writeBack = await maybeWriteCaseSourceResults({
    source: parsed.source,
    cases: parsed.cases,
    results: caseResults,
    bugs,
    requested: optionalBooleanArg(input, "writeBack"),
    confirmed: optionalBooleanArg(input, "confirmWriteBack")
  });

  return {
    mode: "case-source-suite",
    status: suiteRun.status,
    source: caseSource,
    authState,
    suite,
    suiteRun,
    artifactManifest,
    reportPath,
    progress: caseSuiteProgress(context, suite),
    bugs,
    writeBack
  };
}

async function executeDocumentCase(
  context: BrainCreatorMcpContext,
  input: {
    systemId: string;
    sourceId: string;
    suiteId?: string;
    documentCase: DocumentCase;
    maxHealAttempts?: number;
    browserMode?: BrowserExecutionMode;
    createBugOnFailure?: boolean;
    regressionBug?: BugReport;
    remainingBugIds?: string[];
  }
): Promise<{
  caseResult: CaseSuiteCaseResult;
  artifactPaths?: string[];
  bugReportId?: string;
  taskPackage?: HostAgentTaskPackage;
}> {
  const testCase = context.service.createTestCaseFromDocumentCase({
    systemId: input.systemId,
    documentCase: input.documentCase
  });
  context.service.approveTestCase(testCase.id);
  if (input.suiteId) {
    const suite = context.service.getCaseSuite(input.suiteId);
    const priorAttempts = context.runLedger.list({
      runType: "document-suite",
      systemId: input.systemId,
      caseSuiteId: input.suiteId,
      caseNo: input.documentCase.caseNo
    });
    recordDocumentSuiteLedger(context, suite, {
      event: priorAttempts.some(
        (entry) => entry.event === "case-started" || entry.event === "case-retried"
      )
        ? "case-retried"
        : "case-started",
      scope: "case",
      stage: "generator",
      toStatus: "running",
      caseNo: input.documentCase.caseNo,
      message: input.documentCase.title,
      references: { testCaseId: testCase.id }
    });
  }
  try {
    const result = await runApprovedChain(context, {
      caseId: testCase.id,
      maxHealAttempts: input.maxHealAttempts,
      browserMode: input.browserMode,
      suiteContext: input.suiteId
        ? {
            suiteId: input.suiteId,
            sourceId: input.sourceId,
            caseNo: input.documentCase.caseNo,
            title: input.documentCase.title
          }
        : undefined,
      regressionContext: input.regressionBug
        ? {
            bugReportId: input.regressionBug.id,
            sourceId: input.regressionBug.sourceId,
            caseNo: input.regressionBug.caseNo,
            title: input.regressionBug.caseTitle,
            previousStatus:
              input.regressionBug.status === "retest-failed"
                ? "retest-failed"
                : "open",
            remainingBugIds: input.remainingBugIds ?? [],
            maxHealAttempts: input.maxHealAttempts
          }
        : undefined
    });
    if (!("chainRun" in result)) {
      if (input.suiteId) {
        recordDocumentSuiteLedger(
          context,
          context.service.getCaseSuite(input.suiteId),
          {
            event: "agent-task-requested",
            scope: "case",
            stage: "generator",
            fromStatus: "running",
            toStatus: "waiting-for-agent",
            caseNo: input.documentCase.caseNo,
            references: {
              testCaseId: testCase.id,
              agentTaskId: result.task.id
            }
          }
        );
      }
      return {
        caseResult: {
          caseNo: input.documentCase.caseNo,
          title: input.documentCase.title,
          status: "waiting-for-agent",
          testCaseId: testCase.id,
          gapIds: [],
          error: "Waiting for the current host agent to generate the requested test output."
        },
        artifactPaths: [result.specPath, result.testPath],
        taskPackage: result
      };
    }
    const artifactPaths = [result.chainRun.specPath, result.chainRun.testPath].filter(
      (item): item is string => typeof item === "string"
    );
    if (result.chainRun.status === "succeeded") {
      if (input.suiteId) {
        recordDocumentSuiteLedger(
          context,
          context.service.getCaseSuite(input.suiteId),
          {
            event: "case-completed",
            scope: "case",
            stage: "execution",
            fromStatus: "running",
            toStatus: "passed",
            outcome: "passed",
            caseNo: input.documentCase.caseNo,
            references: {
              testCaseId: testCase.id,
              chainRunId: result.chainRun.id
            }
          }
        );
      }
      return {
        caseResult: {
          caseNo: input.documentCase.caseNo,
          title: input.documentCase.title,
          status: "passed",
          testCaseId: testCase.id,
          chainRunId: result.chainRun.id,
          gapIds: []
        },
        artifactPaths
      };
    }
    const failureReason =
      [result.testResult?.stderr, result.testResult?.stdout]
        .find((value): value is string => Boolean(value?.trim())) ??
      chainFailureReason(result.chainRun);
    const diagnosis = context.executionDiagnosis.create({
      systemId: input.systemId,
      caseSourceId: input.sourceId,
      caseSuiteId: input.suiteId,
      caseNo: input.documentCase.caseNo,
      testCaseId: testCase.id,
      chainRunId: result.chainRun.id,
      status: "failed",
      failureReason,
      sourceType: "case-source-suite",
      healAttempts: result.healerRuns.length,
      maxHealAttempts: input.maxHealAttempts ?? 2,
      evidenceAssurance: result.testResult?.structuredReporter ? "strong" : "none",
      evidenceRefs: [
        result.chainRun.id,
        input.sourceId,
        input.suiteId
      ].filter((value): value is string => Boolean(value))
    });
    const isProductBug = diagnosis.verdict === "product_bug";
    if (isProductBug) {
      result.chainRun.gaps = [];
      context.repository.persist();
    } else {
      context.executionDiagnosis.linkGaps(
        diagnosis.id,
        result.chainRun.gaps.map((gap) => gap.id)
      );
    }
    const bug =
      isProductBug && input.createBugOnFailure !== false
        ? context.service.createBugReport({
            systemId: input.systemId,
            sourceId: input.sourceId,
            caseNo: input.documentCase.caseNo,
            caseTitle: input.documentCase.title,
            module: input.documentCase.module,
            priority: input.documentCase.priority,
            expectedResult: input.documentCase.expectedResult,
            actualResult: failureReason,
            reproductionSteps: reproductionSteps(input.documentCase),
            evidencePaths: artifactPaths,
            chainRunId: result.chainRun.id,
            diagnosisId: diagnosis.id,
            gapIds: []
          })
        : undefined;
    if (bug) {
      context.executionDiagnosis.linkBugReport(diagnosis.id, bug.id);
    }
    if (input.suiteId) {
      const suite = context.service.getCaseSuite(input.suiteId);
      recordDocumentSuiteLedger(context, suite, {
        event: "failure-diagnosed",
        scope: "case",
        stage: "execution",
        fromStatus: "running",
        toStatus: diagnosis.verdict,
        failureType: diagnosis.failureType,
        caseNo: input.documentCase.caseNo,
        references: {
          testCaseId: testCase.id,
          chainRunId: result.chainRun.id,
          diagnosisId: diagnosis.id,
          bugReportId: bug?.id,
          gapIds: result.chainRun.gaps.map((gap) => gap.id)
        }
      });
      recordDocumentSuiteLedger(context, suite, {
        event: "case-completed",
        scope: "case",
        stage: "execution",
        fromStatus: "running",
        toStatus: isProductBug ? "failed" : "blocked",
        outcome: isProductBug ? "failed" : "blocked",
        failureType: diagnosis.failureType,
        caseNo: input.documentCase.caseNo,
        message: failureReason,
        references: {
          testCaseId: testCase.id,
          chainRunId: result.chainRun.id,
          diagnosisId: diagnosis.id,
          bugReportId: bug?.id,
          gapIds: result.chainRun.gaps.map((gap) => gap.id)
        }
      });
    }
    return {
      caseResult: {
        caseNo: input.documentCase.caseNo,
        title: input.documentCase.title,
        status: isProductBug ? "failed" : "blocked",
        testCaseId: testCase.id,
        chainRunId: result.chainRun.id,
        diagnosisId: diagnosis.id,
        bugReportId: bug?.id,
        gapIds: result.chainRun.gaps.map((gap) => gap.id),
        error: failureReason
      },
      artifactPaths,
      bugReportId: bug?.id
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    const gap = context.service.reportGap({
      projectId: input.systemId,
      sourceType: "case-source-suite",
      sourceId: `${input.sourceId}:${input.documentCase.caseNo}`,
      reason,
      severity: "high",
      owner: "qa"
    });
    if (input.suiteId) {
      recordDocumentSuiteLedger(
        context,
        context.service.getCaseSuite(input.suiteId),
        {
          event: "case-completed",
          scope: "case",
          stage: "execution",
          fromStatus: "running",
          toStatus: "blocked",
          outcome: "blocked",
          failureType: classifyFailure(reason, "case-source-suite"),
          caseNo: input.documentCase.caseNo,
          message: reason,
          references: { testCaseId: testCase.id, gapIds: [gap.id] }
        }
      );
    }
    return {
      caseResult: {
        caseNo: input.documentCase.caseNo,
        title: input.documentCase.title,
        status: "blocked",
        testCaseId: testCase.id,
        gapIds: [gap.id],
        error: reason
      }
    };
  }
}

async function runBugRegression(context: BrainCreatorMcpContext, input: Record<string, unknown>) {
  const systemId = stringArg(input, "systemId");
  const browserMode = browserModeArg(input) ?? "headless";
  const browserCapability = browserObservationCapability(browserMode);
  if (!browserCapability.available) {
    return {
      mode: "bug-regression",
      status: "blocked",
      browserObservation: browserCapability,
      nextAction: browserCapability.reason
    };
  }
  const requestedBugIds = stringArrayArg(input, "bugIds");
  const filters = bugRegressionFilters(input);
  const candidates = context.service
    .listBugReports({ systemId })
    .filter((bug) =>
      requestedBugIds.length > 0
        ? requestedBugIds.includes(bug.id)
        : bug.status === "open" || bug.status === "retest-failed"
    )
    .filter((bug) => matchesBugRegressionFilters(bug, filters));
  const bridge = await preflightAgentBridge(context.agentBridge);
  if (!bridge.ok) {
    const gap = context.service.reportGap({
      projectId: systemId,
      sourceType: "bug-regression",
      sourceId: requestedBugIds.join(",") || "open-bugs",
      reason: `Agent bridge unavailable: ${bridge.error}`,
      severity: "high",
      owner: "qa"
    });
    return { mode: "bug-regression", status: "blocked", bridge, gap };
  }

  const results: CaseSuiteCaseResult[] = [];
  for (const [candidateIndex, bug] of candidates.entries()) {
    const previousStatus = bug.status;
    context.service.updateBugReportStatus(bug.id, "retest-running");
    try {
      const source = context.service
        .listCaseSources(systemId)
        .find((candidate) => candidate.id === bug.sourceId);
      if (!source) {
        throw new Error(`Original case source not found for bug ${bug.id}`);
      }
      const parsed = await parseCaseSource(source.source);
      const documentCase = parsed.cases.find((item) => item.caseNo === bug.caseNo);
      if (!documentCase) {
        throw new Error(`Original document case ${bug.caseNo} not found`);
      }
      const result = await executeDocumentCase(context, {
        systemId,
        sourceId: source.id,
        documentCase,
        maxHealAttempts: optionalNumberArg(input, "maxHealAttempts"),
        browserMode,
        createBugOnFailure: false,
        regressionBug: { ...bug, status: previousStatus },
        remainingBugIds: candidates
          .slice(candidateIndex + 1)
          .map((item) => item.id)
      });
      if (result.taskPackage) {
        return {
          ...result.taskPackage,
          mode: "bug-regression",
          stage: result.taskPackage.task.agent,
          status: "needs_agent_execution",
          currentBug: bug,
          completedResults: results
        };
      }
      if (result.caseResult.diagnosisId) {
        context.executionDiagnosis.linkBugReport(
          result.caseResult.diagnosisId,
          bug.id
        );
      }
      result.caseResult.bugReportId = bug.id;
      results.push(result.caseResult);
      if (result.caseResult.status === "passed") {
        context.service.updateBugReportStatus(bug.id, "retest-passed");
      } else if (result.caseResult.status === "failed") {
        context.service.updateBugReportStatus(bug.id, "retest-failed");
      } else {
        context.service.updateBugReportStatus(bug.id, previousStatus);
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      const gap = context.service.reportGap({
        projectId: systemId,
        sourceType: "bug-regression",
        sourceId: bug.id,
        reason,
        severity: "high",
        owner: "qa"
      });
      results.push({
        caseNo: bug.caseNo,
        title: bug.caseTitle,
        status: "blocked",
        bugReportId: bug.id,
        gapIds: [gap.id],
        error: reason
      });
      context.service.updateBugReportStatus(bug.id, previousStatus);
    }
  }
  const counts = countBy(results, (result) => result.status);
  const bugs = context.service.listBugReports({ systemId }).filter((bug) =>
    candidates.some((candidate) => candidate.id === bug.id)
  );
  const summary = bugRegressionSummary(candidates, bugs, results);
  return {
    mode: "bug-regression",
    status: (counts.blocked ?? 0) > 0 ? "blocked" : (counts.failed ?? 0) > 0 ? "failed" : "completed",
    total: results.length,
    passed: counts.passed ?? 0,
    failed: counts.failed ?? 0,
    blocked: counts.blocked ?? 0,
    summary,
    results,
    bugs,
    regressionMarkdown: bugRegressionMarkdown(summary, bugs)
  };
}

async function reviewFacade(context: BrainCreatorMcpContext, input: Record<string, unknown>) {
  let knowledgeProjectId = optionalStringArg(input, "knowledgeProjectId");
  const requestedTarget = reviewTargetArg(input, "target");
  if (requestedTarget === "gap" && knowledgeProjectId) {
    const project = context.repository.knowledgeProjects.find((item) => item.id === knowledgeProjectId);
    if (!project) throw new Error("Knowledge project not found");
    const failureTypes = failureTypeFilters(input);
    const gaps = context.service
      .listGaps({
        projectId: knowledgeProjectId,
        status: gapStatusArg(input, "status")
      })
      .filter((gap) => matchesFailureTypes(classifyFailure(gap.reason, gap.sourceType), failureTypes));
    const reviewSummary = gapReviewSummary(gaps);
    return {
      scope: "knowledge-project",
      knowledgeProjectId,
      items: gaps,
      reviewSummary,
      reviewMarkdown: reviewMarkdownFromSummary(reviewSummary),
      nextAction: reviewSummary.nextAction
    };
  }
  if (!knowledgeProjectId && requestedTarget === "onboarding-plan") {
    const projectIds = [...new Set(
      context.onboardingPlans
        .list({
          systemId: optionalStringArg(input, "systemId"),
          requirementSetId: optionalStringArg(input, "requirementSetId")
        })
        .filter((item) => !optionalStringArg(input, "id") || item.id === optionalStringArg(input, "id"))
        .map((item) => item.knowledgeProjectId)
    )];
    if (projectIds.length === 1) knowledgeProjectId = projectIds[0];
  }
  if (knowledgeProjectId && isKnowledgeReviewTarget(requestedTarget)) {
    return knowledgeReview(
      context,
      knowledgeProjectId,
      requestedTarget,
      requestedTarget === "system-brain"
        ? optionalStringArg(input, "systemId") ?? optionalStringArg(input, "id")
        : optionalStringArg(input, "id"),
      optionalNumberArg(input, "limit") ?? 50,
      optionalNumberArg(input, "minSampleSize") ?? 20,
      optionalNumberArg(input, "offset") ?? 0,
      input
    );
  }
  if (!knowledgeProjectId && requestedTarget === "run-ledger") {
    const resolution = resolveSystemReference(context, input);
    const requestedRunId = optionalStringArg(input, "id");
    const entries = context.runLedger
      .list({ runType: "document-suite", systemId: resolution.systemId })
      .filter((entry) => !requestedRunId || entry.caseSuiteId === requestedRunId);
    const runIds = [
      ...new Set(
        entries.flatMap((entry) => (entry.caseSuiteId ? [entry.caseSuiteId] : []))
      )
    ];
    return {
      runType: "document-suite",
      summaries: runIds.map((runId) => context.runLedger.summary(runId)),
      entries,
      systemResolution: resolution
    };
  }
  if (
    isKnowledgeReviewTarget(requestedTarget) &&
    requestedTarget !== "execution-diagnosis"
  ) {
    throw new Error("knowledgeProjectId is required for knowledge review targets");
  }
  const resolution = resolveSystemReference(context, input);
  const systemId = resolution.systemId;
  const target = requestedTarget;
  const failureTypes = failureTypeFilters(input);
  if (target === "execution-diagnosis") {
    const diagnosisEval = context.executionDiagnosis.legacyReviewEval(
      systemId,
      optionalNumberArg(input, "minSampleSize") ?? 20
    );
    const items = context.executionDiagnosis
      .list({ systemId })
      .filter(
        (item) =>
          (!optionalStringArg(input, "id") ||
            item.id === optionalStringArg(input, "id")) &&
          (failureTypes.size === 0 ||
            (item.failureType !== undefined &&
              failureTypes.has(item.failureType)))
      );
    const diagnosisSummary = context.executionDiagnosis.summary({ systemId });
    return {
      summary: diagnosisSummary,
      items,
      legacyAudit: context.executionDiagnosis.auditLegacy({
        systemId,
        limit: optionalNumberArg(input, "limit") ?? 50
      }),
      legacyReviews: context.executionDiagnosis.listLegacyReviews(systemId),
      humanAdjudicationEval: diagnosisEval,
      reviewSummary: executionDiagnosisReviewSummary({
        summary: diagnosisSummary,
        items,
        nextAction:
          diagnosisSummary.routing.bugEligible > 0
            ? "review_product_bugs"
            : diagnosisSummary.routing.gapRouted > 0
              ? "review_evidence_gaps"
              : "no_diagnosis_action"
      }),
      evalMarkdown: legacyDiagnosisEvalMarkdown(diagnosisEval),
      systemResolution: resolution
    };
  }
  if (target === "bug") {
    const bugs = context.service
      .listBugReports({
        systemId,
        status: bugStatusArg(input, "status")
      })
      .filter((bug) => matchesFailureTypes(classifyFailure(bug.actualResult), failureTypes));
    const regressionCandidates = bugRegressionCandidates(bugs);
    const summary = bugReviewSummary(bugs);
    const nextAction = bugs.some((bug) => bug.status === "open" || bug.status === "retest-failed")
      ? "run_bug_regression"
      : "no_open_bug";
    const reviewSummary = bugReviewResultSummary(summary, bugs, nextAction);
    return {
      summary,
      bugs,
      regressionCandidates: regressionCandidateSummary(regressionCandidates),
      reportMarkdown: bugReviewMarkdown(bugs),
      reviewSummary,
      reviewMarkdown: reviewMarkdownFromSummary(reviewSummary),
      nextAction,
      systemResolution: resolution
    };
  }
  if (target === "suite-run") {
    const review = suiteRunReview(context, systemId, optionalStringArg(input, "id"), failureTypes);
    const reviewSummary = suiteRunReviewSummary(review);
    return {
      ...review,
      reviewSummary,
      reviewMarkdown: reviewMarkdownFromSummary(reviewSummary),
      systemResolution: resolution
    };
  }
  if (target === "case") {
    return {
      items: context.service.listTestCases(systemId),
      systemResolution: resolution
    };
  }
  if (target === "gap") {
    const gaps = context.service
      .listGaps({
        projectId: systemId,
        status: gapStatusArg(input, "status")
      })
      .filter((gap) => matchesFailureTypes(classifyFailure(gap.reason, gap.sourceType), failureTypes));
    const reviewSummary = gapReviewSummary(gaps);
    return {
      items: gaps,
      reviewSummary,
      reviewMarkdown: reviewMarkdownFromSummary(reviewSummary),
      systemResolution: resolution
    };
  }
  const overview = await artifactOverview(context, { systemId });
  const reviewSummary = artifactReviewSummary(overview);
  return {
    ...overview,
    reviewSummary,
    reviewMarkdown: reviewMarkdownFromSummary(reviewSummary),
    systemResolution: resolution
  };
}



async function configureFacade(context: BrainCreatorMcpContext, input: Record<string, unknown>) {
  const target = configureTargetArg(input, "target");
  const operation = optionalStringArg(input, "operation") ?? "create";
  if (target === "runtime") {
    const runtimeOperation = operation === "create" ? "reload-store" : operation;
    if (!["update", "reload-config", "reload-store", "rebuild-index"].includes(runtimeOperation)) {
      throw new Error("runtime operation is invalid");
    }
    const active = [
      ...context.repository.requirementSuiteRuns.filter((run) =>
        ["running", "waiting-for-test-data", "waiting-for-agent"].includes(run.status)
      ),
      ...context.repository.caseSuiteRuns.filter((run) => run.status === "running"),
      ...context.repository.agentTasks.filter((task) =>
        ["pending", "running"].includes(task.status)
      )
    ];
    if (active.length > 0) {
      throw new BrainCreatorError({
        code: "BC_STORE_BUSY",
        message: "Store reload is blocked while a run is active",
        userMessage: {
          enUS: "Wait for active Brain Creator runs to finish before reloading the store.",
          zhCN: "请等待 Brain Creator 活动运行结束后再刷新存储。"
        },
        nextAction: "review-active-runs",
        retryable: true
      });
    }
    if (runtimeOperation === "update") {
      const patch: RuntimeConfigurationPatch = {
        ...(optionalStringArg(input, "bridgeProvider")
          ? { bridgeProvider: optionalStringArg(input, "bridgeProvider") as RuntimeConfiguration["bridgeProvider"] }
          : {}),
        ...(optionalStringArg(input, "bridgeCommand") ? { bridgeCommand: optionalStringArg(input, "bridgeCommand") } : {}),
        ...(Array.isArray(input.bridgeArgs) ? { bridgeArgs: stringArrayArg(input, "bridgeArgs") } : {}),
        ...(optionalNumberArg(input, "bridgeTimeoutMs") !== undefined
          ? { bridgeTimeoutMs: optionalNumberArg(input, "bridgeTimeoutMs") }
          : {}),
        ...(optionalStringArg(input, "evaluationProvider")
          ? { evaluationProvider: optionalStringArg(input, "evaluationProvider") as "claude" | "codex" }
          : {}),
        ...(input.providerConfigs !== undefined ? { providerConfigs: recordArg(input, "providerConfigs") } : {}),
        ...(input.connectorConfigs !== undefined ? { connectorConfigs: recordArg(input, "connectorConfigs") } : {})
      };
      const configuration = mergeRuntimeConfiguration(context.runtimeConfiguration, patch);
      return {
        status: "config-reloaded",
        operation: runtimeOperation,
        ...(await context.reloadRuntimeConfiguration({ configuration, persist: true })),
        nextAction: "review-status"
      };
    }
    if (runtimeOperation === "reload-config") {
      return {
        status: "config-reloaded",
        operation: runtimeOperation,
        ...(await context.reloadRuntimeConfiguration()),
        nextAction: "review-status"
      };
    }
    if (runtimeOperation === "rebuild-index") {
      if (!(context.repository instanceof ShardedFileBrainCreatorRepository)) {
        throw new Error(`Index rebuild requires the schema ${SHARDED_REPOSITORY_SCHEMA_VERSION} sharded repository`);
      }
      return {
        status: "index-rebuilt",
        index: context.repository.rebuildIndexes(),
        nextAction: "review-status"
      };
    }
    return {
      status: "reloaded",
      counts: context.repository.reload(),
      reloadedAt: new Date().toISOString(),
      nextAction: "review-status"
    };
  }
  if (target === "approval") {
    const requirementSetId = stringArg(input, "requirementSetId");
    if (operation === "preflight") {
      const challenge = context.requirementGate.issueApprovalChallenge(requirementSetId);
      return {
        status: "approval-challenge-issued",
        requirementSetId,
        challenge,
        nextAction: "Return the one-time approval code to Brain Creator without editing the requirement source."
      };
    }
    if (operation !== "create") throw new Error("approval operation is invalid");
    const method = optionalStringArg(input, "approvalMethod") as "host-attested" | "challenge-response" | undefined;
    if (!method) throw new Error("approvalMethod is required");
    const receipt = context.requirementGate.createApprovalReceipt({
      requirementSetId,
      assetHash: optionalStringArg(input, "assetHash") ?? context.requirementGate.baselineFingerprint(requirementSetId),
      method,
      approvedBy: stringArg(input, "confirmedBy"),
      hostMessageId: optionalStringArg(input, "hostMessageId"),
      hostMessageHash: optionalStringArg(input, "hostMessageHash"),
      challengeId: optionalStringArg(input, "approvalChallengeId"),
      approvalCode: optionalStringArg(input, "approvalCode")
    });
    return {
      status: "approval-receipt-created",
      receipt,
      nextAction: "Pass approvalReceiptId to bc_prepare action=approve-baseline with confirm=true."
    };
  }
  if (target === "knowledge-project") {
    return context.knowledgeService.createProject({
      name: stringArg(input, "name"),
      key: stringArg(input, "key"),
      defaultLocale: optionalStringArg(input, "defaultLocale") ?? "zh-CN"
    });
  }
  if (target === "system-binding") {
    return context.knowledgeService.bindSystem(
      stringArg(input, "knowledgeProjectId"),
      stringArg(input, "systemId")
    );
  }
  if (target === "connector") {
    const connector = optionalStringArg(input, "connector") ?? "feishu";
    if (connector !== "feishu") throw new Error("Only the Feishu connector is supported in this phase");
    return connectorStatus(context, optionalStringArg(input, "knowledgeProjectId"));
  }
  if (target === "system") {
    const operation = optionalStringArg(input, "operation") ?? "create";
    if (operation === "update") {
      if (optionalBooleanArg(input, "confirm") !== true) {
        throw new Error("Updating a system URL allowlist requires confirm=true");
      }
      return context.service.addSystemUrlAllowlistOrigins(
        stringArg(input, "systemId"),
        stringArrayArg(input, "urlAllowlist")
      );
    }
    if (operation !== "create") throw new Error("System configuration supports create or confirmed allowlist update");
    return context.service.createSystemProfile({
      name: stringArg(input, "name"),
      environment: stringArg(input, "environment"),
      baseUrl: stringArg(input, "baseUrl"),
      executionProvenance: executionProvenanceArg(input),
      defaultLocale: optionalStringArg(input, "defaultLocale") ?? "zh-CN",
      urlAllowlist: stringArrayArg(input, "urlAllowlist")
    });
  }
  if (target === "auth") {
    const operation = optionalStringArg(input, "operation") ?? "create";
    if (operation === "verify") {
      const systemId = stringArg(input, "systemId");
      const authProfileId = stringArg(input, "authProfileId");
      const profile = findAuthProfileById(context, systemId, authProfileId);
      const system = context.repository.systemProfiles.find((item) => item.id === systemId);
      if (!system) throw new Error("Business system not found");
      let storageStatePath: string | undefined;
      try {
        storageStatePath = await materializeAuthStorageState(context, system, profile, true);
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        context.service.failAuthProfileVerification(profile.id, reason);
        throw new BrainCreatorError({
          code: "BC_AUTH_MATERIALIZATION_FAILED",
          message: reason,
          userMessage: {
            enUS: "Brain Creator could not materialize this token or cookie into a browser login state.",
            zhCN: "Token/Cookie cannot be materialized into a browser login state."
          },
          nextAction: "capture-auth-checkpoint",
          retryable: true
        });
      }
      if (!storageStatePath) {
        throw new BrainCreatorError({
          code: "BC_AUTH_EVIDENCE_REQUIRED",
          message: "Auth verification requires a protected storageState path",
          userMessage: {
            enUS: "Capture a browser login state before verifying this authentication profile.",
            zhCN: "验证该鉴权配置前需要先采集浏览器登录状态。"
          },
          nextAction: "complete-auth-checkpoint",
          retryable: false
        });
      }
      const verification = await context.authStateVerifier({
        storageStatePath: await resolveProtectedStorageStatePath(context.workDir, storageStatePath),
        workDir: context.workDir,
        targetUrl: system.baseUrl,
        allowedUrls: system.urlAllowlist
      });
      if (verification.status !== "valid" || !verification.finalUrl) {
        const reason = verification.reason ?? "Browser authentication verification failed";
        context.service.failAuthProfileVerification(profile.id, reason);
        throw new BrainCreatorError({
          code: "BC_AUTH_VERIFICATION_FAILED",
          message: reason,
          userMessage: {
            enUS: "The saved browser login could not be verified.",
            zhCN: "已保存的浏览器登录状态验证失败。"
          },
          nextAction: "complete-auth-checkpoint",
          retryable: verification.status === "unavailable"
        });
      }
      return context.service.verifyAuthProfile(profile.id, {
        targetUrl: system.baseUrl,
        finalUrl: verification.finalUrl,
        title: verification.title
      });
    }
    if (operation === "preflight") {
      const systemId = stringArg(input, "systemId");
      const authProfileId = stringArg(input, "authProfileId");
      const profile = findAuthProfileById(context, systemId, authProfileId);
      const system = context.repository.systemProfiles.find((item) => item.id === systemId);
      if (!system) throw new Error("Business system not found");
      const authRefresh = await context.authRefreshRegistry.preflight({
        workDir: context.workDir,
        system,
        authProfile: profile,
        reason: optionalStringArg(input, "reason") ?? "Authentication provider preflight requested."
      });
      return {
        authProfile: context.service.listAuthProfiles(systemId).find((item) => item.id === profile.id),
        authRefresh,
        nextAction: authRefresh.status === "ready"
          ? "Authentication provider is ready for execution."
          : "Configure the provider or complete the authentication checkpoint before execution."
      };
    }
    if (operation === "refresh") {
      const systemId = stringArg(input, "systemId");
      const authProfileId = stringArg(input, "authProfileId");
      const profile = findAuthProfileById(context, systemId, authProfileId);
      const system = context.repository.systemProfiles.find((item) => item.id === systemId);
      if (!system) throw new Error("Business system not found");
      const refreshed = await refreshAndVerifyAuthState(
        context,
        system,
        profile,
        optionalStringArg(input, "reason") ?? "Authentication refresh requested by the operator."
      );
      if (refreshed?.status === "valid" && refreshed.finalUrl) {
        return {
          authRefresh: refreshed.authRefresh,
          profile: context.service.verifyAuthProfile(profile.id, {
            targetUrl: system.baseUrl,
            finalUrl: refreshed.finalUrl,
            title: refreshed.title
          }),
          nextAction: "continue-execution"
        };
      }
      const pending = context.service.listAuthCheckpoints(system.id, "awaiting-user")
        .find((checkpoint) => checkpoint.authProfileId === profile.id);
      const checkpoint = pending ?? context.service.createAuthCheckpoint({
        systemId,
        authProfileId: profile.id,
        reason: refreshed?.reason ?? "Authentication refresh requires user intervention.",
        resumeInstruction: "Refresh the provider session or complete the login checkpoint, then retry auth refresh."
      });
      return {
        status: "needs-user",
        authRefresh: refreshed?.authRefresh,
        checkpoint,
        nextAction: "complete-auth-checkpoint"
      };
    }
    if (operation === "archive") {
      const profile = findAuthProfileById(
        context,
        stringArg(input, "systemId"),
        stringArg(input, "authProfileId")
      );
      return context.service.archiveAuthProfile(profile.id);
    }
    if (operation !== "create") throw new Error("auth operation is invalid");
    return context.service.createAuthProfile({
      projectId: stringArg(input, "systemId"),
      env: stringArg(input, "env"),
      role: stringArg(input, "role"),
      loginMethod: loginMethodArg(input, "loginMethod"),
      refreshProvider: optionalStringArg(input, "refreshProvider") as AuthProfile["refreshProvider"],
      secrets: recordArg(input, "secrets")
    });
  }
  if (target === "term") {
    return context.service.createGlossaryTerm({
      projectId: stringArg(input, "systemId"),
      key: stringArg(input, "key"),
      zhCN: stringArg(input, "zhCN"),
      enUS: stringArg(input, "enUS"),
      aliases: stringArrayArg(input, "aliases"),
      pageScope: optionalStringArg(input, "pageScope") ?? "/"
    });
  }
  if (target === "rule") {
    return context.service.createBusinessRule({
      systemId: stringArg(input, "systemId"),
      name: stringArg(input, "name"),
      condition: stringArg(input, "condition"),
      severity: severityArg(input, "severity")
    });
  }
  return context.service.createAuthCheckpoint({
    systemId: stringArg(input, "systemId"),
    authProfileId: stringArg(input, "authProfileId"),
    testCaseId: optionalStringArg(input, "testCaseId"),
    reason: stringArg(input, "reason"),
    resumeInstruction: stringArg(input, "resumeInstruction")
  });
}

function isRequirementSuiteCandidate(
  context: BrainCreatorMcpContext,
  executableCase: ExecutableCase
) {
  const openTestDataGap = context.repository.gaps.some(
    (gap) =>
      gap.status === "open" &&
      gap.sourceType === "test-data-plan" &&
      (executableCase.gapIds.includes(gap.id) ||
        gap.sourceId === executableCase.id ||
        gap.sourceId === executableCase.testIntentId)
  );
  if (executableCase.status === "ready" && openTestDataGap) return false;
  if (executableCase.status === "ready") return true;
  if (
    executableCase.status === "needs-data" &&
    executableCase.dataPlan?.verdict === "blocked"
  ) {
    return (
      executableCase.dataPlan.operations.some(
        (operation) =>
          operation.decision === "lookup" &&
          operation.status === "needs-resolution"
      ) &&
      executableCase.dataPlan.operations.every(
        (operation) => operation.status !== "blocked"
      )
    );
  }
  if (
    executableCase.status !== "blocked" ||
    executableCase.dataPlan?.verdict !== "blocked"
  ) {
    return false;
  }
  const openGaps = context.repository.gaps.filter(
    (gap) =>
      executableCase.gapIds.includes(gap.id) && gap.status === "open"
  );
  return (
    openGaps.length > 0 &&
    openGaps.every((gap) => gap.sourceType === "test-data-plan") &&
    executableCase.dataPlan.operations.some(
      (operation) =>
        operation.decision === "lookup" &&
        operation.status === "needs-resolution"
    ) &&
    executableCase.dataPlan.operations.every(
      (operation) => operation.status !== "blocked"
    )
  );
}

function requirementSuitePreflightBlockers(
  context: BrainCreatorMcpContext,
  executableCase: ExecutableCase,
  checks: ExecutionPreflightCheck[]
) {
  const dataResolutionCandidate =
    (executableCase.status === "blocked" || executableCase.status === "needs-data") &&
    isRequirementSuiteCandidate(context, executableCase);
  return checks.filter((check) => {
    if (check.status === "pass") return false;
    if (
      check.id === "test-data" ||
      check.id === "test-data-tasks" ||
      check.id === "test-data-cleanup"
    ) {
      return false;
    }
    if (
      dataResolutionCandidate &&
      (check.id === "executable-case" || check.id === "open-gaps")
    ) {
      return false;
    }
    return true;
  });
}

async function runRequirementSuite(context: BrainCreatorMcpContext, input: Record<string, unknown>) {
  const projectId = stringArg(input, "knowledgeProjectId");
  const project = context.repository.knowledgeProjects.find((item) => item.id === projectId);
  if (!project) throw new Error("Knowledge project not found");
  const suiteAction = suiteActionArg(input);
  if (suiteAction !== "continue") {
    return controlRequirementSuite(context, projectId, suiteAction, input);
  }
  const requestedCaseId = optionalStringArg(input, "executableCaseId");
  const candidates = context.knowledgeService
    .listExecutableCases(projectId)
    .filter((item) => isRequirementSuiteCandidate(context, item))
    .filter((item) => !requestedCaseId || item.id === requestedCaseId);
  const selectedSystemId =
    optionalStringArg(input, "systemId") ?? project.systemIds[0];
  const authProfileId = optionalStringArg(input, "authProfileId");
  const actorJourney = actorJourneyArg(input);
  const requestedBrowserMode = browserModeArg(input);
  const requestedRepeatCount = optionalNumberArg(input, "repeatCount");
  const repeatCount = Math.max(1, requestedRepeatCount ?? 1);
  const stabilityPolicy = stabilityPolicyArg(input) ?? (repeatCount > 1
    ? { targetIterations: repeatCount, minIterations: 2, maxFailureRate: 0, requireStrongEvidence: true, stopOnBlocked: true }
    : undefined);
  if (!optionalBooleanArg(input, "confirm")) {
    const executionPreflights = selectedSystemId
      ? candidates.map((executableCase) => ({
          executableCaseId: executableCase.id,
          ...context.executionPreflight.prepare({
            knowledgeProjectId: projectId,
            systemId: selectedSystemId,
            executableCaseId: executableCase.id,
            authProfileId,
            actorJourney,
            confirm: false
          })
        }))
      : [];
    return {
      mode: "requirement-suite",
      status: "preview",
      project,
      executableCases: candidates,
      executionPreflights,
      boundSystemIds: project.systemIds,
      stability: {
        repeatCount,
        policy: repeatCount > 1
          ? "Each iteration uses an isolated RequirementSuiteRun and is aggregated in coverage review."
          : "Single execution; do not infer stability from one green run."
      },
      browserObservation: browserObservationCapability(
        requestedBrowserMode ?? "headless"
      ),
      requiresConfirmation: true,
      nextAction:
        project.systemIds.length === 0
          ? "Bind a runtime system before confirming execution."
          : "Ask the user to confirm the requirement suite execution."
    };
  }
  const requestedSuiteRunId = optionalStringArg(input, "suiteId");
  const requestedEvaluationTrialId = optionalStringArg(input, "evaluationTrialId");
  if (requestedEvaluationTrialId && !selectedSystemId) {
    throw new Error("An evaluation trial requirement suite requires a business system");
  }
  const requestedRequirementSetIds = stringArrayArg(input, "requirementSetIds");
  const requestedEvaluationBinding = requestedEvaluationTrialId
    ? context.evaluationIntegrity.validateExecutionBinding({
        trialId: requestedEvaluationTrialId,
        knowledgeProjectId: projectId,
        systemId: selectedSystemId!,
        executableCaseIds: candidates.map((item) => item.id),
        requirementSetIds: requestedRequirementSetIds,
        runtimeBuildIdentity: evaluationRuntimeBuildIdentity(context)
      })
    : undefined;
  if (requestedEvaluationBinding && !requestedEvaluationBinding.valid) {
    throw new Error(`Evaluation trial binding is invalid: ${requestedEvaluationBinding.reasons.join("; ")}`);
  }
  const activeRequirementSuiteRun = requestedSuiteRunId
    ? context.requirementSuiteRuns.get(requestedSuiteRunId)
    : context.requirementSuiteRuns
        .list(projectId)
        .filter(
          (item) =>
            item.status === "running" ||
            item.status === "waiting-for-test-data" ||
            item.status === "waiting-for-agent" ||
            item.status === "blocked"
        )
        .filter(
          (item) => !selectedSystemId || item.systemId === selectedSystemId
        )
        .at(-1);
  if (activeRequirementSuiteRun) {
    if (activeRequirementSuiteRun.knowledgeProjectId !== projectId) {
      throw new Error(
        "Requirement suite run belongs to another knowledge project"
      );
    }
    if (
      selectedSystemId &&
      activeRequirementSuiteRun.systemId !== selectedSystemId
    ) {
      throw new Error(
        "Requirement suite run belongs to another business system"
      );
    }
    if (requestedEvaluationTrialId && activeRequirementSuiteRun.evaluationTrialId !== requestedEvaluationTrialId) {
      throw new Error("Requirement suite run belongs to another evaluation trial");
    }
    if (!requestedEvaluationTrialId && activeRequirementSuiteRun.evaluationTrialId) {
      const existingBinding = context.evaluationIntegrity.validateExecutionBinding({
        trialId: activeRequirementSuiteRun.evaluationTrialId,
        knowledgeProjectId: projectId,
        systemId: activeRequirementSuiteRun.systemId,
        executableCaseIds: activeRequirementSuiteRun.caseRuns.map((item) => item.executableCaseId),
        requirementSetIds: activeRequirementSuiteRun.requirementSetIds,
        runtimeBuildIdentity: evaluationRuntimeBuildIdentity(context)
      });
      if (!existingBinding.valid) {
        throw new Error(`Evaluation trial binding is invalid: ${existingBinding.reasons.join("; ")}`);
      }
    }
    if (
      authProfileId &&
      activeRequirementSuiteRun.authProfileId !== authProfileId
    ) {
      throw new Error(
        "Requirement suite run cannot change its selected auth profile"
      );
    }
    if (
      actorJourney &&
      JSON.stringify(activeRequirementSuiteRun.actorJourney ?? []) !==
        JSON.stringify(actorJourney)
    ) {
      throw new Error("Requirement suite run cannot change its actor journey");
    }
    const activeBrowserMode = activeRequirementSuiteRun.browserMode ?? "headless";
    if (requestedBrowserMode && requestedBrowserMode !== activeBrowserMode) {
      throw new Error("Requirement suite run cannot change its browser mode");
    }
    const activeBrowserCapability = browserObservationCapability(activeBrowserMode);
    if (!activeBrowserCapability.available) {
      return {
        mode: "requirement-suite",
        status: "blocked",
        browserObservation: activeBrowserCapability,
        requirementSuiteRun: activeRequirementSuiteRun,
        nextAction: activeBrowserCapability.reason
      };
    }
    if (
      requestedRepeatCount !== undefined &&
      requestedRepeatCount !== (activeRequirementSuiteRun.stabilityTarget ?? 1)
    ) {
      throw new Error("Requirement suite run cannot change its stability repeat count");
    }
    if (
      optionalBooleanArg(input, "allowCreateTestData") &&
      !activeRequirementSuiteRun.allowCreateTestData
    ) {
      context.requirementSuiteRuns.authorizeTestDataCreation(
        activeRequirementSuiteRun.id
      );
    }
    if (
      optionalBooleanArg(input, "automaticTestData") &&
      !activeRequirementSuiteRun.automaticTestData
    ) {
      context.requirementSuiteRuns.enableAutomaticTestData(
        activeRequirementSuiteRun.id
      );
    }
    if (activeRequirementSuiteRun.status === "blocked") {
      if (!optionalBooleanArg(input, "resume")) {
        return {
          mode: "requirement-suite",
          status: "blocked",
          requirementSuiteRun: activeRequirementSuiteRun,
          nextAction:
            "Retry with resume=true and continueOnBlocked=true after reviewing the blocked case."
        };
      }
      context.requirementSuiteRuns.resume(activeRequirementSuiteRun.id, {
        continueOnBlocked: optionalBooleanArg(input, "continueOnBlocked")
      });
    }
    return executeNextRequirementSuiteCase(
      context,
      activeRequirementSuiteRun.id,
      { maxHealAttempts: optionalNumberArg(input, "maxHealAttempts") }
    );
  }
  if (candidates.length === 0) throw new Error("No ready executable cases were selected");
  const systemId = selectedSystemId;
  if (!systemId || !project.systemIds.includes(systemId)) {
    throw new Error("Requirement suite must use a system bound to the knowledge project");
  }
  const browserMode = requestedBrowserMode ?? "headless";
  const browserCapability = browserObservationCapability(browserMode);
  if (!browserCapability.available) {
    return {
      mode: "requirement-suite",
      status: "blocked",
      browserObservation: browserCapability,
      nextAction: browserCapability.reason
    };
  }
  const blockingKnowledgeGaps = context.repository.gaps.filter(
    (gap) =>
      gap.projectId === projectId &&
      gap.status === "open" &&
      ["requirement-clarification", "system-observation"].includes(gap.sourceType)
  );
  if (blockingKnowledgeGaps.length > 0) {
    return {
      mode: "requirement-suite",
      status: "blocked",
      knowledgeProjectId: projectId,
      systemId,
      gaps: blockingKnowledgeGaps,
      nextAction: "Resolve requirement or observed-system conflicts before execution."
    };
  }
  for (const candidate of candidates) {
    if (candidate.systemId && candidate.systemId !== systemId) {
      throw new Error(
        `Executable case ${candidate.id} was compiled for another business system`
      );
    }
    if (
      candidate.dataPlan?.requiresConfirmation &&
      !candidate.dataPlan.confirmedAt
    ) {
      context.knowledgeService.confirmExecutableCaseTestData(candidate.id);
    }
  }
  const executionPreflights = candidates.map((candidate) => {
    const prepared = context.executionPreflight.prepare({
      knowledgeProjectId: projectId,
      systemId,
      executableCaseId: candidate.id,
      authProfileId,
      actorJourney,
      confirm: false
    });
    return {
      executableCaseId: candidate.id,
      ...prepared,
      status: prepared.draft.verdict
    };
  });
  const blockedPreflights = executionPreflights.filter(
    (item) =>
      requirementSuitePreflightBlockers(
        context,
        candidates.find(
          (candidate) => candidate.id === item.executableCaseId
        )!,
        item.draft.checks
      ).length > 0
  );
  if (blockedPreflights.length > 0) {
    return {
      mode: "requirement-suite",
      status: "blocked",
      knowledgeProjectId: projectId,
      systemId,
      executionPreflight: executionPreflights[0],
      executionPreflights,
      nextAction:
        blockedPreflights.some(
          (item) =>
            requirementSuitePreflightBlockers(
              context,
              candidates.find(
                (candidate) => candidate.id === item.executableCaseId
              )!,
              item.draft.checks
            ).some((check) => check.status === "action-required")
        )
          ? "Confirm proposed execution inputs before retrying."
          : "Resolve execution preflight blockers before retrying."
    };
  }
  let requirementSuiteRun = context.requirementSuiteRuns.create({
    knowledgeProjectId: projectId,
    systemId,
    authProfileId,
    operator: optionalStringArg(input, "operator"),
    provider: optionalStringArg(input, "provider"),
    sessionId: optionalStringArg(input, "sessionId"),
    actorJourney,
    browserMode,
    requirementSetIds: requestedRequirementSetIds,
    ...(requestedEvaluationBinding
      ? {
          evaluationTrialId: requestedEvaluationBinding.trial.id,
          evaluationSourceRevision: requestedEvaluationBinding.trial.sourceRevision,
          evaluationSourceHash: requestedEvaluationBinding.trial.sourceHash,
          ...(requestedEvaluationBinding.trial.runtimeBuildIdentity
            ? { evaluationRuntimeBuildIdentity: requestedEvaluationBinding.trial.runtimeBuildIdentity }
            : {})
        }
      : {}),
    cases: candidates.map((candidate) => ({
      executableCaseId: candidate.id,
      title: candidate.title
    })),
    continueOnBlocked: optionalBooleanArg(input, "continueOnBlocked"),
    allowCreateTestData: optionalBooleanArg(input, "allowCreateTestData"),
    automaticTestData: optionalBooleanArg(input, "automaticTestData"),
    maxHealAttempts: optionalNumberArg(input, "maxHealAttempts")
    ,stabilityPolicy
    ,stabilityGroupId: repeatCount > 1 ? id("stabilityGroup") : undefined
    ,stabilityIteration: 1
    ,stabilityTarget: repeatCount
  });
  if (optionalBooleanArg(input, "resume")) {
    requirementSuiteRun = context.requirementSuiteRuns.resume(
      requirementSuiteRun.id,
      {
        continueOnBlocked: optionalBooleanArg(input, "continueOnBlocked")
      }
    );
  }
  return executeNextRequirementSuiteCase(context, requirementSuiteRun.id, {
    maxHealAttempts: optionalNumberArg(input, "maxHealAttempts")
  });
}

async function controlRequirementSuite(
  context: BrainCreatorMcpContext,
  projectId: string,
  action:
    | "cancel"
    | "retry"
    | "skip"
    | "claim-next-scheduled"
    | "process-next-scheduled"
    | "claim-scheduled"
    | "renew-scheduled"
    | "release-scheduled",
  input: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const requestedEvaluationTrialId = optionalStringArg(input, "evaluationTrialId");
  const validateScheduledEvaluation = (run: RequirementSuiteRun) => {
    validateScheduledTrialBinding(context, run, requestedEvaluationTrialId);
  };
  if (action === "claim-next-scheduled") {
    const scheduleOwner = optionalStringArg(input, "scheduleOwner");
    if (!scheduleOwner) throw new Error("scheduleOwner is required for schedule control");
    const systemId = optionalStringArg(input, "systemId");
    const dueRuns = context.requirementSuiteRuns
      .listDueStabilityRuns(projectId)
      .filter((item) => !systemId || item.systemId === systemId)
      .filter((item) => !requestedEvaluationTrialId || item.evaluationTrialId === requestedEvaluationTrialId)
      .sort((left, right) => left.id.localeCompare(right.id));
    if (!optionalBooleanArg(input, "confirm")) {
      return {
        mode: "requirement-suite",
        status: "control-preview",
        action,
        scheduledRuns: dueRuns.slice(0, 20),
        scheduledRunsTruncated: dueRuns.length > 20,
        requiresConfirmation: true,
        nextAction: dueRuns.length > 0
          ? "Confirm to claim the first due scheduled run."
          : "No scheduled stability run is due."
      };
    }
    const next = dueRuns[0];
    if (!next) {
      return {
        mode: "requirement-suite",
        status: "no-due-scheduled-run",
        action,
        scheduledRuns: [],
        nextAction: "Poll again when a scheduled stability run is due."
      };
    }
    validateScheduledEvaluation(next);
    const claimed = context.requirementSuiteRuns.claimScheduled(next.id, {
      owner: scheduleOwner,
      leaseMs: optionalNumberArg(input, "scheduleLeaseMs")
    });
    try {
      validateScheduledEvaluation(claimed);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      try {
        context.requirementSuiteRuns.releaseScheduledLease(claimed.id, {
          owner: scheduleOwner,
          nextRunAt: new Date(Date.now() + 60_000).toISOString(),
          lastError: message
        });
      } catch (releaseError) {
        const releaseMessage = releaseError instanceof Error ? releaseError.message : String(releaseError);
        throw new Error(`${message}; schedule lease release failed: ${releaseMessage}`);
      }
      throw error;
    }
    return {
      mode: "requirement-suite",
      status: "scheduled-control-applied",
      action,
      requirementSuiteRun: claimed,
      nextAction: "Continue the claimed requirement suite with suiteAction=continue."
    };
  }
  if (action === "process-next-scheduled") {
    const scheduleOwner = optionalStringArg(input, "scheduleOwner");
    if (!scheduleOwner) throw new Error("scheduleOwner is required for schedule control");
    const systemId = optionalStringArg(input, "systemId");
    const dueRuns = context.requirementSuiteRuns
      .listDueStabilityRuns(projectId)
      .filter((item) => !systemId || item.systemId === systemId)
      .filter((item) => !requestedEvaluationTrialId || item.evaluationTrialId === requestedEvaluationTrialId)
      .sort((left, right) => left.id.localeCompare(right.id));
    if (!optionalBooleanArg(input, "confirm")) {
      return {
        mode: "requirement-suite",
        status: "control-preview",
        action,
        scheduledRuns: dueRuns.slice(0, 20),
        scheduledRunsTruncated: dueRuns.length > 20,
        requiresConfirmation: true,
        nextAction: dueRuns.length > 0
          ? "Confirm to claim and process the first due scheduled run."
          : "No scheduled stability run is due."
      };
    }
    const next = dueRuns[0];
    if (!next) {
      return {
        mode: "requirement-suite",
        status: "no-due-scheduled-run",
        action,
        scheduledRuns: [],
        nextAction: "Poll again when a scheduled stability run is due."
      };
    }
    validateScheduledEvaluation(next);
    const claimed = context.requirementSuiteRuns.claimScheduled(next.id, {
      owner: scheduleOwner,
      leaseMs: optionalNumberArg(input, "scheduleLeaseMs")
    });
    try {
      validateScheduledEvaluation(claimed);
      const result = await executeNextRequirementSuiteCase(context, claimed.id, {
        maxHealAttempts: optionalNumberArg(input, "maxHealAttempts")
      });
      return {
        ...result,
        action,
        scheduleOwner,
        scheduledRunId: claimed.id,
        nextAction: result.status === "completed"
          ? "The scheduled stability iteration completed. Review stability thresholds."
          : "Renew the schedule lease while the suite is waiting, then continue the scheduled run."
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      let released = claimed;
      let releaseErrorMessage: string | undefined;
      try {
        released = context.requirementSuiteRuns.releaseScheduledLease(claimed.id, {
          owner: scheduleOwner,
          nextRunAt: new Date(Date.now() + 60_000).toISOString(),
          lastError: message
        });
      } catch (releaseError) {
        releaseErrorMessage = releaseError instanceof Error ? releaseError.message : String(releaseError);
        try {
          released = context.requirementSuiteRuns.get(claimed.id);
        } catch {
          released = claimed;
        }
      }
      const finalError = releaseErrorMessage
        ? `${message}; schedule lease release failed: ${releaseErrorMessage}`
        : message;
      return {
        mode: "requirement-suite",
        status: "scheduled-run-failed",
        action,
        scheduledRunId: claimed.id,
        requirementSuiteRun: released,
        error: finalError,
        nextAction: releaseErrorMessage
          ? "Schedule lease release failed. Inspect the current lease owner and expiry before continuing; do not replay the scheduled action."
          : "Inspect the failure and retry the scheduled run after the backoff."
      };
    }
  }
  const suiteId = optionalStringArg(input, "suiteId");
  const systemId = optionalStringArg(input, "systemId");
  const run = suiteId
    ? context.requirementSuiteRuns.get(suiteId)
    : context.requirementSuiteRuns
        .list(projectId)
        .filter((item) => !systemId || item.systemId === systemId)
        .at(-1);
  if (!run) throw new Error("Requirement suite run not found");
  if (run.knowledgeProjectId !== projectId) {
    throw new Error("Requirement suite run belongs to another knowledge project");
  }
  if (systemId && run.systemId !== systemId) {
    throw new Error("Requirement suite run belongs to another business system");
  }
  if (["claim-scheduled", "renew-scheduled", "release-scheduled"].includes(action)) {
    const scheduleOwner = optionalStringArg(input, "scheduleOwner");
    if (!optionalBooleanArg(input, "confirm")) {
      return {
        mode: "requirement-suite",
        status: "control-preview",
        action,
        requirementSuiteRun: run,
        requiresConfirmation: true,
        nextAction: `Confirm the requirement suite ${action} action.`
      };
    }
    if (!scheduleOwner) throw new Error("scheduleOwner is required for schedule control");
    if (action === "claim-scheduled") {
      validateScheduledEvaluation(run);
    } else if (requestedEvaluationTrialId && run.evaluationTrialId !== requestedEvaluationTrialId) {
      throw new Error("Requirement suite run belongs to another evaluation trial");
    }
    const updated =
      action === "claim-scheduled"
        ? context.requirementSuiteRuns.claimScheduled(run.id, {
            owner: scheduleOwner,
            leaseMs: optionalNumberArg(input, "scheduleLeaseMs")
          })
        : action === "renew-scheduled"
          ? context.requirementSuiteRuns.renewScheduledLease(run.id, {
              owner: scheduleOwner,
              leaseMs: optionalNumberArg(input, "scheduleLeaseMs")
            })
          : context.requirementSuiteRuns.releaseScheduledLease(run.id, {
              owner: scheduleOwner,
              nextRunAt: optionalStringArg(input, "nextRunAt"),
              lastError: optionalStringArg(input, "scheduleError")
            });
    return {
      mode: "requirement-suite",
      status: "scheduled-control-applied",
      action,
      requirementSuiteRun: updated,
      nextAction:
        action === "release-scheduled"
          ? "The schedule is released; claim it again when the next run is due."
          : "Continue the requirement suite with suiteAction=continue."
    };
  }
  const requestedCaseId = optionalStringArg(input, "executableCaseId");
  const targetCase =
    requestedCaseId
      ? run.caseRuns.find((item) => item.executableCaseId === requestedCaseId)
      : [...run.caseRuns]
          .reverse()
          .find((item) =>
            action === "skip"
              ? item.status === "blocked"
              : item.status === "failed" || item.status === "blocked"
          );
  if (action !== "cancel" && !targetCase) {
    throw new Error(
      action === "retry"
        ? "No failed or blocked requirement suite case is available to retry"
        : "No blocked requirement suite case is available to skip"
    );
  }
  if (action === "cancel") {
    if (requestedEvaluationTrialId && run.evaluationTrialId !== requestedEvaluationTrialId) {
      throw new Error("Requirement suite run belongs to another evaluation trial");
    }
  } else {
    validateScheduledEvaluation(run);
  }
  if (!optionalBooleanArg(input, "confirm")) {
    return {
      mode: "requirement-suite",
      status: "control-preview",
      action,
      requirementSuiteRun: run,
      targetCase,
      requiresConfirmation: true,
      nextAction: `Confirm the requirement suite ${action} action.`
    };
  }

  const updated =
    action === "cancel"
      ? context.requirementSuiteRuns.cancel(run.id)
      : action === "retry"
        ? context.requirementSuiteRuns.retry(
            run.id,
            targetCase!.executableCaseId
          )
        : context.requirementSuiteRuns.skip(
            run.id,
            targetCase!.executableCaseId
          );
  if (updated.status === "running") {
    return executeNextRequirementSuiteCase(context, updated.id, {
      maxHealAttempts:
        optionalNumberArg(input, "maxHealAttempts") ??
        updated.maxHealAttempts
    });
  }
  const archive = await archiveRequirementSuiteRun(context, updated);
  return {
    mode: "requirement-suite",
    status: updated.status,
    action,
    requirementSuiteRun: updated,
    ...(archive ? { artifactManifest: archive.artifactManifest } : {})
  };
}

























function configuredFeishuReader(environment: Record<string, string | undefined> = process.env): RequirementSourceReader | undefined {
  const appId = environment.BRAIN_CREATOR_FEISHU_APP_ID;
  const appSecret = environment.BRAIN_CREATOR_FEISHU_APP_SECRET;
  return appId && appSecret ? new FeishuOpenApiAdapter({ appId, appSecret }) : undefined;
}



async function generatePlan(context: BrainCreatorMcpContext, input: Record<string, unknown>) {
  const bridgeCheck = await preflightAgentBridge(context.agentBridge);
  if (!bridgeCheck.ok) {
    throw new Error(`Agent bridge unavailable: ${bridgeCheck.error}`);
  }
  const systemId = stringArg(input, "systemId");
  const requirement = stringArg(input, "requirement");
  const system = context.repository.systemProfiles.find((item) => item.id === systemId);
  if (!system) {
    throw new Error("Business system not found");
  }
  const authProfile = findAuthProfile(context, systemId);
  const planLayout = resolveArtifactRunLayout({
    workDir: context.workDir,
    systemKey: system.name,
    requirementKey: "draft-plan",
    suiteRunId: `plan-${system.id}`
  });
  const specPath = optionalStringArg(input, "specPath") ?? join(
    planLayout.specsDir,
    artifactFileName({ title: requirement, extension: ".md", contentHash: systemId })
  );
  if (context.agentBridge?.provider === "host-agent") {
    const prompt = await buildAgentPrompt({
      outputDir: planLayout.analysisDir,
      system,
      requirement,
      glossaryTerms: context.service.listGlossaryTerms({ projectId: systemId, query: "" }),
      businessRules: context.service.listBusinessRules(systemId),
      authProfiles: [authProfile]
    });
    const seed = await generateSeedFile({
      workDir: context.workDir,
      outputDir: planLayout.testsDir,
      system,
      authProfile,
      systemBrainSnapshot: context.systemBrainSnapshots.latest(system.id)
    });
    await mkdir(dirname(specPath), { recursive: true });
    const taskPackage = await prepareAgentTask(context, {
      systemId,
      agent: "planner",
      inputSummary: requirement,
      args: ["--prompt", prompt.promptPath, "--seed", seed.seedPath, "--output", specPath],
      outputPaths: [specPath],
      planContext: {
        requirement,
        specPath,
        promptPath: prompt.promptPath,
        seedPath: seed.seedPath
      }
    });
    return {
      ...taskPackage,
      stage: "planner",
      promptPath: prompt.promptPath,
      seedPath: seed.seedPath,
      specPath
    };
  }
  const harnessResult = await runInHarness({
    runtime: context.harness,
    approved: true,
    agent: "planner",
    enforceEvaluation: true,
    task: {
      brain: "requirement",
      operation: "generate-plan",
      inputSummary: requirement,
      systemId,
      policy: {
        allowWrites: true,
        allowedFiles: [specPath],
        requireApproval: false
      }
    },
    execute: () => generatePlanDraft({
      workDir: context.workDir,
      system,
      authProfile,
      requirement,
      glossaryTerms: context.service.listGlossaryTerms({ projectId: systemId, query: "" }),
      businessRules: context.service.listBusinessRules(systemId),
      specPath,
      agentBridge: context.agentBridge,
      systemBrainSnapshot: context.systemBrainSnapshots.latest(system.id)
    }),
    structuredOutput: (result) => plannerOutputFromResult({
      status: result.agentRun.status === "succeeded" ? "succeeded" : "failed",
      scenarios: result.scenarios,
      sourceRefs: [`agent-run:${result.agentRun.id}`, `system:${systemId}`],
      gaps: result.agentRun.error ? [result.agentRun.error] : []
    }),
    evaluate: (result) => ({
      verdict: result.agentRun.status === "succeeded" ? "pass" : "blocked",
      score: result.agentRun.status === "succeeded" ? 1 : 0,
      reasons: result.agentRun.error ? [result.agentRun.error] : [],
      affectedAssetIds: [result.agentRun.id],
      evidenceRefs: result.agentRun.outputPaths.map((path) => `artifact:${path}`),
      nextActions: result.agentRun.status === "succeeded" ? [] : ["review-agent-run"]
    })
  });
  const result = harnessResult.result;
  context.service.recordAgentRun(result.agentRun);
  const testCase = context.service.createTestCase({
    systemId,
    requirement,
    scenarios: result.scenarios,
    newTerms: result.newTerms,
    ruleCheckResult: result.ruleCheckResult
  });
  return { ...result, testCase };
}















/**
 * bc_full_workflow — 一键审批 + 执行。
 * 封装 bc_approve_plan → bc_run_chain，用于用户已审核计划、确认可执行的场景。
 * 不减损审批门禁：只对 draft 状态用例执行审批，等效于用户手动确认。
 */
async function fullWorkflow(context: BrainCreatorMcpContext, input: Record<string, unknown>) {
  const caseId = stringArg(input, "caseId");
  const approved = context.service.approveTestCase(caseId);
  const chainInput = { ...input, caseId: approved.id };
  return runApprovedChain(context, chainInput);
}

/**
 * bc_session_resume — 一次调用返回系统完整快照，替代新会话时的 6-7 次独立查询。
 * 只读，不做任何写入操作。
 */




async function generateSeed(context: BrainCreatorMcpContext, input: Record<string, unknown>) {
  const systemId = stringArg(input, "systemId");
  const system = context.repository.systemProfiles.find((item) => item.id === systemId);
  if (!system) {
    throw new Error("Business system not found");
  }
  const authProfile = optionalStringArg(input, "authProfileId")
    ? findAuthProfileById(context, systemId, optionalStringArg(input, "authProfileId")!)
    : findAuthProfile(context, systemId);
  return generateSeedFile({
    workDir: context.workDir,
    outputDir: optionalStringArg(input, "outputDir") ?? join(context.workDir, "tests"),
    system,
    authProfile,
    systemBrainSnapshot: context.systemBrainSnapshots.latest(system.id)
  });
}

async function runSingleAgent(context: BrainCreatorMcpContext, input: Record<string, unknown>) {
  const systemId = stringArg(input, "systemId");
  const system = context.repository.systemProfiles.find((item) => item.id === systemId);
  if (!system) {
    throw new Error("Business system not found");
  }
  const agent = agentArg(input, "agent");
  const inputSummary = stringArg(input, "inputSummary");
  const outputPaths = stringArrayArg(input, "outputPaths");
  const harnessResult = await runInHarness({
    runtime: context.harness,
    approved: true,
    task: {
      brain: agent === "planner" ? "requirement" : agent === "generator" ? "testcase" : "testexecution",
      operation: `run-${agent}`,
      inputSummary,
      systemId,
      provider: context.agentBridge?.provider,
      policy: {
        allowWrites: outputPaths.length > 0,
        allowedFiles: outputPaths,
        requireApproval: false
      }
    },
    execute: () => runAgent({
      systemId,
      agent,
      inputSummary,
      args: stringArrayArg(input, "args"),
      outputPaths,
      cwd: context.workDir,
      timeoutMs: optionalNumberArg(input, "timeoutMs"),
      agentBridge: context.agentBridge
    }),
    evaluate: (result) => ({
      verdict: result.status === "succeeded" ? "pass" : "blocked",
      score: result.status === "succeeded" ? 1 : 0,
      reasons: result.error ? [result.error] : [],
      affectedAssetIds: result.outputPaths,
      evidenceRefs: result.outputPaths.map((path) => `artifact:${path}`),
      nextActions: result.status === "succeeded" ? [] : ["review-agent-run"]
    })
  });
  context.service.recordAgentRun(harnessResult.result);
  return harnessResult.result;
}





async function evaluateHostAgentOutput(
  context: BrainCreatorMcpContext,
  task: AgentTask,
  status: "succeeded" | "failed",
  providerText: string
): Promise<BrainEvalResult | undefined> {
  const harnessTask = task.harnessTaskId ? context.harness.getTask(task.harnessTaskId) : undefined;
  if (!harnessTask) return undefined;
  const output = await hostAgentStructuredOutput(context, task, status);
  if (!output) return undefined;
  return evaluateStructuredAgentOutput(task.agent, output, {
    allowedFiles: harnessTask.policy.allowedFiles,
    text: providerText
  });
}

async function hostAgentStructuredOutput(
  _context: BrainCreatorMcpContext,
  task: AgentTask,
  status: "succeeded" | "failed"
) {
  const sourceRefs = [
    `agent-task:${task.id}`,
    ...task.outputPaths.map((path) => `artifact:${path}`)
  ];
  if (task.agent === "planner") {
    if (status !== "succeeded" || !task.planContext) return undefined;
    const specContent = await readFile(task.planContext.specPath, "utf8").catch(() => undefined);
    if (!specContent) return undefined;
    const scenarios = parseSpecMarkdown(specContent);
    if (scenarios.length === 0) return undefined;
    return plannerOutputFromResult({
      status: "succeeded",
      scenarios,
      sourceRefs,
      gaps: []
    });
  }
  if (task.agent === "generator") {
    const testPath = task.chainContext?.testPath ?? task.outputPaths[0] ?? "";
    const requiredStepIds = task.chainContext?.requiredStepIds ?? ["generated-test"];
    return {
      version: 1 as const,
      agent: "generator" as const,
      status: status === "succeeded" ? "generated" as const : "blocked" as const,
      testPath,
      steps: requiredStepIds.map((id) => ({ id, sourceRefs })),
      assertions: [{ id: "generated-assertions", sourceRefs }],
      sourceRefs
    };
  }
  return {
    version: 1 as const,
    agent: "healer" as const,
    status: status === "succeeded" ? "healed" as const : "unresolved" as const,
    targetTestPath: task.chainContext?.testPath ?? task.outputPaths[0] ?? "",
    changedFiles: task.outputPaths,
    removedAssertionIds: [],
    failureRefs: [`agent-task:${task.id}`],
    sourceRefs
  };
}

function completeHostHarnessTask(
  context: BrainCreatorMcpContext,
  task: AgentTask,
  evaluation: BrainEvalResult,
  agentRunId: string,
  outputPaths: string[]
) {
  if (!task.harnessTaskId) return;
  const harnessTask = context.harness.getTask(task.harnessTaskId);
  if (!harnessTask || ["completed", "blocked", "failed", "cancelled"].includes(harnessTask.state)) return;
  context.harness.completeDeferredTask(
    harnessTask.id,
    evaluation,
    [
      `agent-run:${agentRunId}`,
      ...outputPaths.map((path) => `artifact:${path}`)
    ]
  );
}

function hostAgentEvaluation(status: "succeeded" | "failed", reason?: string): BrainEvalResult {
  return status === "succeeded"
    ? {
        verdict: "pass",
        score: 1,
        reasons: [],
        affectedAssetIds: [],
        evidenceRefs: [],
        nextActions: []
      }
    : {
        verdict: "blocked",
        score: 0,
        reasons: [reason ?? "Host agent task failed"],
        affectedAssetIds: [],
        evidenceRefs: [],
        nextActions: ["review-agent-run"]
      };
}

function mergeHarnessEvaluations(
  base: BrainEvalResult,
  structured: BrainEvalResult | undefined
): BrainEvalResult {
  if (!structured || structured.verdict === "pass") return base;
  if (base.verdict === "blocked") return base;
  return {
    verdict: structured.verdict,
    score: Math.min(base.score, structured.score),
    reasons: [...new Set([...base.reasons, ...structured.reasons])],
    affectedAssetIds: [...new Set([...base.affectedAssetIds, ...structured.affectedAssetIds])],
    evidenceRefs: [...new Set([...base.evidenceRefs, ...structured.evidenceRefs])],
    nextActions: [...new Set([...base.nextActions, ...structured.nextActions])]
  };
}







async function submitAgentOutput(context: BrainCreatorMcpContext, input: Record<string, unknown>) {
  const taskId = stringArg(input, "taskId");
  const pendingTask = context.repository.agentTasks.find(
    (item) => item.id === taskId
  );
  if (!pendingTask) throw new Error("Agent task not found");
  if (pendingTask.status !== "pending") {
    throw new Error("Agent task already submitted");
  }
  if (pendingTask.chainContext?.executionPlanId) {
    assertExecutionPlanIsCurrent(
      context,
      pendingTask.chainContext.executionPlanId
    );
  }
  if (
    agentOutputStatusArg(input, "status") === "succeeded" &&
    (pendingTask.agent === "generator" || pendingTask.agent === "healer") &&
    pendingTask.chainContext
  ) {
    const source = await readFile(pendingTask.chainContext.testPath, "utf8").catch((error) => {
      throw new Error(
        `Generated test cannot be validated before submission: ${error instanceof Error ? error.message : String(error)}`
      );
    });
    const { requiredStepIds = [], actorJourneyRoles = [] } = pendingTask.chainContext;
    const journeyCheck = validateActorJourneyUsage(
      source,
      actorJourneyRoles.map((role) => ({ role }))
    );
    if (!journeyCheck.valid) throw new Error(journeyCheck.reason);
    const instrumentationCheck = validateStepInstrumentation(source, requiredStepIds);
    if (!instrumentationCheck.valid) throw new Error(instrumentationCheck.reason);
    const pageObjectCheck = validatePageObjectUsage(
      source,
      pendingTask.chainContext.requiredPageObjectBindings ?? []
    );
    if (!pageObjectCheck.valid) throw new Error(pageObjectCheck.reason);
    const secretFindings = scanGeneratedTestSecrets(context, pendingTask.systemId, source);
    if (secretFindings.length > 0) {
      throw new Error(
        `Generated test contains sensitive material: ${secretFindings.join(", ")}`
      );
    }
  }
  const stdout = redactHostAgentText(
    context,
    pendingTask.systemId,
    optionalStringArg(input, "stdout") ?? ""
  );
  const stderr = redactHostAgentText(
    context,
    pendingTask.systemId,
    optionalStringArg(input, "stderr") ?? ""
  );
  const submittedOutputPaths = optionalStringArrayArg(input, "outputPaths");
  assertWorkspaceOutputPaths(context.workDir, submittedOutputPaths);
  const submittedStatus = agentOutputStatusArg(input, "status");
  const harnessTask = pendingTask.harnessTaskId
    ? context.harness.getTask(pendingTask.harnessTaskId)
    : undefined;
  const redactedProviderText = [stdout, stderr].filter(Boolean).join("\n");
  const structuredEvaluation = harnessTask
    ? await evaluateHostAgentOutput(context, pendingTask, submittedStatus, redactedProviderText)
    : undefined;
  if (harnessTask && submittedStatus === "succeeded" && structuredEvaluation?.verdict === "blocked") {
    context.harness.completeDeferredTask(
      harnessTask.id,
      structuredEvaluation,
      (submittedOutputPaths ?? pendingTask.outputPaths).map((path) => `artifact:${path}`)
    );
    throw new Error(
      `Host agent output failed Harness Eval: ${structuredEvaluation.reasons.join("; ") || "review required"}`
    );
  }
  const result = context.service.submitAgentTask({
    taskId,
    status: agentOutputStatusArg(input, "status"),
    stdout,
    stderr,
    outputPaths: submittedOutputPaths
  });
  if (result.task.planContext) {
    completeHostHarnessTask(context, result.task, mergeHarnessEvaluations(
      hostAgentEvaluation(
        result.agentRun.status === "succeeded" ? "succeeded" : "failed",
        result.agentRun.error
      ),
      structuredEvaluation
    ), result.agentRun.id, submittedOutputPaths ?? result.task.outputPaths);
    return finalizeHostAgentPlan(context, result);
  }
  const { chainContext } = result.task;
  if (!chainContext) {
    completeHostHarnessTask(
      context,
      result.task,
      mergeHarnessEvaluations(
        hostAgentEvaluation(
          result.agentRun.status === "succeeded" ? "succeeded" : "failed",
          result.agentRun.error
        ),
        structuredEvaluation
      ),
      result.agentRun.id,
      submittedOutputPaths ?? result.task.outputPaths
    );
    return result;
  }
  if (chainContext.requirementSuiteRunId && chainContext.executableCaseId) {
    context.runLedger.appendProgress({
      knowledgeProjectId: chainContext.knowledgeProjectId,
      systemId: result.task.systemId,
      requirementSuiteRunId: chainContext.requirementSuiteRunId,
      executableCaseId: chainContext.executableCaseId,
      stage: "execution",
      status: "running",
      stepTitle: "Run generated Playwright test",
      assertionSummary: "Waiting for structured Playwright evidence"
    });
  }
  const testResult =
    result.agentRun.status === "succeeded" &&
    (result.task.agent === "generator" || result.task.agent === "healer")
      ? await runSubmittedPlaywrightTest({
          workDir: context.workDir,
          testPath: chainContext.testPath,
          systemId: result.task.systemId,
          runId: result.task.id,
          browserMode: chainContext.browserMode,
          runner: context.runner,
          protectedSecrets: protectedSecretsForSystem(context, result.task.systemId)
        })
      : undefined;
  const healAttempts = chainContext.healAttempts ?? 0;
  const maxHealAttempts = chainContext.maxHealAttempts ?? 1;
  if (
    (result.task.agent === "generator" || result.task.agent === "healer") &&
    testResult &&
    testResult.exitCode !== 0 &&
    healAttempts < maxHealAttempts
  ) {
    completeHostHarnessTask(
      context,
      result.task,
      mergeHarnessEvaluations(
        {
          verdict: "retry",
          score: 0,
          reasons: ["Generated test requires a controlled healer retry"],
          affectedAssetIds: [],
          evidenceRefs: [],
          nextActions: ["review-playwright-failure"]
        },
        structuredEvaluation
      ),
      result.agentRun.id,
      submittedOutputPaths ?? result.task.outputPaths
    );
    const chainRun: ChainRun = {
      id: id("chain"),
      systemId: result.task.systemId,
      testCaseId: chainContext.testCaseId,
      status: "partial",
      generateRunId:
        result.task.agent === "generator" ? result.agentRun.id : chainContext.generateRunId,
      healRunId: result.task.agent === "healer" ? result.agentRun.id : undefined,
      specPath: chainContext.specPath,
      testPath: chainContext.testPath,
      gaps: [],
      createdAt: result.agentRun.createdAt,
      completedAt: new Date().toISOString()
    };
    context.service.recordChainRun(chainRun);
    const failureOutput = testResult.stderr || testResult.stdout || "Generated test failed";
    const healerTaskPackage = await prepareAgentTask(context, {
      systemId: result.task.systemId,
      agent: "healer",
      inputSummary: `Heal ${result.task.inputSummary}: ${failureOutput}`,
      args: [
        "--test",
        chainContext.testPath,
        ...(chainContext.seedPath ? ["--seed", chainContext.seedPath] : []),
        "--error",
        failureOutput
      ],
      outputPaths: [chainContext.testPath],
      chainContext: {
        ...chainContext,
        generateRunId:
          result.task.agent === "generator" ? result.agentRun.id : chainContext.generateRunId,
        healAttempts: healAttempts + 1
      },
      suiteContext: result.task.suiteContext,
      regressionContext: result.task.regressionContext
    });
    if (result.task.suiteContext) {
      const suite = context.service.getCaseSuite(result.task.suiteContext.suiteId);
      recordDocumentSuiteLedger(context, suite, {
        event: "agent-task-requested",
        scope: "case",
        stage: "generator",
        fromStatus: "waiting-for-agent",
        toStatus: "waiting-for-agent",
        caseNo: result.task.suiteContext.caseNo,
        message: "Controlled healer retry requested",
        references: {
          testCaseId: chainContext.testCaseId,
          agentTaskId: healerTaskPackage.task.id,
          chainRunId: chainRun.id
        }
      });
    }
    if (
      chainContext.requirementSuiteRunId &&
      chainContext.executableCaseId &&
      chainContext.executionEvidenceId
    ) {
      context.requirementSuiteRuns.markWaiting(
        chainContext.requirementSuiteRunId,
        chainContext.executableCaseId,
        {
          testCaseId: chainContext.testCaseId,
          agentTaskId: healerTaskPackage.task.id,
          executionEvidenceId: chainContext.executionEvidenceId
        }
      );
    }
    return {
      ...result,
      ...healerTaskPackage,
      stage: "healer",
      chainRun,
      testResult
    };
  }
  const status =
    result.agentRun.status === "succeeded" && (!testResult || testResult.exitCode === 0)
      ? "succeeded"
      : "failed";
  const failureReason =
    status === "failed"
      ? hostAgentFailureReason(result.task.agent, result.agentRun.error, testResult)
      : undefined;
  completeHostHarnessTask(
    context,
    result.task,
    mergeHarnessEvaluations(
      hostAgentEvaluation(
        status,
        failureReason
      ),
      structuredEvaluation
    ),
    result.agentRun.id,
    submittedOutputPaths ?? result.task.outputPaths
  );
  const failureClassification = status === "failed"
    ? classifyEvidenceFailure({
        stderr: testResult?.stderr,
        stdout: testResult?.stdout,
        reporter: testResult?.structuredReporter
      })
    : undefined;
  const chainRunId = id("chain");
  const artifactPaths = [
    chainContext.specPath,
    chainContext.testPath,
    testResult?.reporterPath,
    testResult?.actorRoleEvidencePath,
    ...(testResult?.structuredReporter?.attachments ?? [])
  ].filter((path): path is string => typeof path === "string");
  const terminalDiagnosis =
    status === "failed" &&
    failureReason &&
    (chainContext.executableCaseId ||
      result.task.suiteContext ||
      result.task.regressionContext)
      ? context.executionDiagnosis.create({
          knowledgeProjectId: chainContext.knowledgeProjectId,
          systemId: result.task.systemId,
          requirementSuiteRunId: chainContext.requirementSuiteRunId,
          executableCaseId: chainContext.executableCaseId,
          caseSourceId:
            result.task.suiteContext?.sourceId ??
            result.task.regressionContext?.sourceId,
          caseSuiteId: result.task.suiteContext?.suiteId,
          caseNo:
            result.task.suiteContext?.caseNo ??
            result.task.regressionContext?.caseNo,
          executionEvidenceId: chainContext.executionEvidenceId,
          chainRunId,
          testCaseId: chainContext.testCaseId,
          status: "failed",
          failureReason,
          failureType: failureClassification?.type,
          consoleErrors: testResult?.structuredReporter?.consoleErrors,
          networkFailures: testResult?.structuredReporter?.networkFailures,
          sourceType:
            result.task.agent === "healer"
              ? "host-agent-healer"
              : "host-agent-generator",
          healAttempts,
          maxHealAttempts,
          evidenceAssurance: testResult?.structuredReporter
            ? "strong"
            : chainContext.executionEvidenceId
              ? context.repository.executionEvidence.find(
                  (item) => item.id === chainContext.executionEvidenceId
                )?.assuranceLevel
              : "none",
          evidenceRefs: [
            chainRunId,
            chainContext.executionEvidenceId,
            chainContext.executionPlanId
          ].filter((value): value is string => Boolean(value))
        })
      : undefined;
  const bugReport =
    status === "failed" && failureReason
      ? await maybeCreateHostAgentBugReport(context, {
          task: result.task,
          chainRunId,
          failureReason,
          artifactPaths,
          diagnosisId: terminalDiagnosis?.id,
          diagnosisVerdict: terminalDiagnosis?.verdict
        })
      : undefined;
  if (bugReport && terminalDiagnosis) {
    context.executionDiagnosis.linkBugReport(
      terminalDiagnosis.id,
      bugReport.id
    );
  }
  if (result.task.regressionContext && terminalDiagnosis) {
    context.executionDiagnosis.linkBugReport(
      terminalDiagnosis.id,
      result.task.regressionContext.bugReportId
    );
  }
  const productRegressionFailure =
    Boolean(result.task.regressionContext) &&
    terminalDiagnosis?.verdict === "product_bug";
  const gaps =
    status === "failed" &&
    !bugReport &&
    !productRegressionFailure &&
    failureReason
      ? [
          context.service.reportGap({
            projectId: result.task.systemId,
            sourceType:
              result.task.agent === "healer" ? "host-agent-healer" : "host-agent-generator",
            sourceId: result.task.id,
            reason: failureReason,
            severity: "high",
            owner: "qa"
          })
        ]
      : [];
  if (terminalDiagnosis && gaps.length > 0) {
    context.executionDiagnosis.linkGaps(
      terminalDiagnosis.id,
      gaps.map((gap) => gap.id)
    );
  }
  const chainRun: ChainRun = {
    id: chainRunId,
    systemId: result.task.systemId,
    testCaseId: chainContext.testCaseId,
    status,
    generateRunId: result.task.agent === "healer" ? chainContext.generateRunId : result.agentRun.id,
    healRunId: result.task.agent === "healer" ? result.agentRun.id : undefined,
    specPath: chainContext.specPath,
    testPath: chainContext.testPath,
    gaps,
    createdAt: result.agentRun.createdAt,
    completedAt: new Date().toISOString()
  };
  context.service.recordChainRun(chainRun);
  if (chainContext.executionEvidenceId) {
    await completeRequirementEvidence(
      context,
      chainContext.executionEvidenceId,
      chainRun,
      testResult,
      [chainContext.contextPackPath, chainContext.specPath, chainContext.testPath].filter(
        (path): path is string => typeof path === "string"
      ),
      chainContext.browserMode === "observe" ? "observe" : "headless",
      terminalDiagnosis
    );
  }
  if (
    chainContext.requirementSuiteRunId &&
    chainContext.executableCaseId
  ) {
    const requirementCaseStatus =
      status === "succeeded"
        ? "passed"
        : bugReport
          ? "failed"
          : "blocked";
    const completedCase = {
      task: result.task,
      agentRun: result.agentRun,
      chainRun,
      testResult,
      bugReport,
      executionDiagnosis: terminalDiagnosis,
      gaps
    };
    const executableCase = context.repository.executableCases.find(
      (item) => item.id === chainContext.executableCaseId
    );
    if (!executableCase) {
      throw new Error("Requirement suite executable case not found");
    }
    return finalizeRequirementSuiteCase(context, {
      requirementSuiteRunId: chainContext.requirementSuiteRunId,
      executableCase,
      outcome: {
        status: requirementCaseStatus,
        chainRunId: chainRun.id,
        diagnosisId: terminalDiagnosis?.id,
        bugReportId: bugReport?.id,
        gapIds: gaps.map((gap) => gap.id),
        failureType: terminalDiagnosis?.failureType,
        error: failureReason
      },
      completedCase,
      completionField: "submittedCase",
      maxHealAttempts: chainContext.maxHealAttempts
    });
  }
  const suiteRun = result.task.suiteContext
    ? context.service.recordCaseSuiteRun({
        systemId: result.task.systemId,
        suiteId: result.task.suiteContext.suiteId,
        sourceId: result.task.suiteContext.sourceId,
        status: status === "succeeded" ? "completed" : bugReport ? "failed" : "blocked",
        total: 1,
        passed: status === "succeeded" ? 1 : 0,
        failed: status === "failed" && bugReport ? 1 : 0,
        blocked: status === "failed" && !bugReport ? 1 : 0,
        caseResults: [
          {
            caseNo: result.task.suiteContext.caseNo,
            title: result.task.suiteContext.title,
            status: status === "succeeded" ? "passed" : bugReport ? "failed" : "blocked",
            testCaseId: chainContext.testCaseId,
            chainRunId: chainRun.id,
            diagnosisId: terminalDiagnosis?.id,
            bugReportId: bugReport?.id,
            gapIds: gaps.map((gap) => gap.id),
            error: failureReason
          }
        ],
        artifactPaths,
        bugReportIds: bugReport ? [bugReport.id] : [],
        gapIds: gaps.map((gap) => gap.id),
        completedAt: new Date().toISOString()
      })
    : undefined;
  if (suiteRun) {
    const suite = context.service.getCaseSuite(suiteRun.suiteId);
    const suiteContext = result.task.suiteContext!;
    if (terminalDiagnosis) {
      recordDocumentSuiteLedger(context, suite, {
        event: "failure-diagnosed",
        scope: "case",
        stage: "execution",
        fromStatus: "waiting-for-agent",
        toStatus: terminalDiagnosis.verdict,
        failureType: terminalDiagnosis.failureType,
        caseNo: suiteContext.caseNo,
        references: {
          testCaseId: chainContext.testCaseId,
          agentTaskId: result.task.id,
          chainRunId: chainRun.id,
          diagnosisId: terminalDiagnosis.id,
          bugReportId: bugReport?.id,
          gapIds: gaps.map((gap) => gap.id)
        }
      });
    }
    recordDocumentSuiteLedger(context, suite, {
      event: "case-completed",
      scope: "case",
      stage: "execution",
      fromStatus: "waiting-for-agent",
      toStatus:
        status === "succeeded" ? "passed" : bugReport ? "failed" : "blocked",
      outcome:
        status === "succeeded" ? "passed" : bugReport ? "failed" : "blocked",
      failureType: terminalDiagnosis?.failureType,
      caseNo: suiteContext.caseNo,
      message: failureReason,
      references: {
        testCaseId: chainContext.testCaseId,
        agentTaskId: result.task.id,
        chainRunId: chainRun.id,
        diagnosisId: terminalDiagnosis?.id,
        bugReportId: bugReport?.id,
        gapIds: gaps.map((gap) => gap.id)
      }
    });
    const passed = passedCaseNosForSuite(context, suiteRun.systemId, suiteRun.suiteId);
    if (suite.selectedCaseNos.every((caseNo) => passed.has(caseNo))) {
      const completedSuite = context.service.updateCaseSuiteStatus(suiteRun.suiteId, "completed");
      completeDocumentSuiteLedger(context, completedSuite, "completed");
      const reportPath = await writeDocumentSuiteReport(context, completedSuite);
      return {
        ...result,
        status: "completed",
        chainRun,
        suiteRun,
        suite: completedSuite,
        testResult,
        reportPath
      };
    }
    if (
      suite.continueOnBlocked !== true &&
      (suiteRun.status === "blocked" ||
        (suiteRun.gapIds.length > 0 && suiteRun.bugReportIds.length === 0))
    ) {
      const blockedSuite = context.service.updateCaseSuiteStatus(suiteRun.suiteId, "blocked");
      completeDocumentSuiteLedger(context, blockedSuite, "blocked");
      const reportPath = await writeDocumentSuiteReport(context, blockedSuite);
      return {
        ...result,
        status: "blocked",
        chainRun,
        suiteRun,
        suite: blockedSuite,
        testResult,
        reportPath
      };
    }
    const nextTask = await prepareNextHostAgentSuiteTask(
      context,
      suiteRun.suiteId,
      result.task.chainContext?.maxHealAttempts
    );
    if (nextTask) {
      const reportPath = await writeDocumentSuiteReport(context, nextTask.suite);
      return {
        ...result,
        submittedTask: result.task,
        submittedAgentRun: result.agentRun,
        chainRun,
        suiteRun,
        testResult,
        reportPath,
        ...nextTask
      };
    }
    const finalStatus = hostAgentSuiteFailureStatus(context, suite);
    const failedSuite = context.service.updateCaseSuiteStatus(suiteRun.suiteId, finalStatus);
    completeDocumentSuiteLedger(context, failedSuite, finalStatus);
    const reportPath = await writeDocumentSuiteReport(context, failedSuite);
    return {
      ...result,
      status: finalStatus,
      chainRun,
      suiteRun,
      suite: failedSuite,
      testResult,
      reportPath
    };
  }
  if (result.task.regressionContext) {
    const regression = result.task.regressionContext;
    const bug = context.repository.bugReports.find(
      (item) =>
        item.id === regression.bugReportId &&
        item.systemId === result.task.systemId
    );
    if (!bug) throw new Error("Regression BugReport not found");
    const caseStatus =
      status === "succeeded"
        ? "passed"
        : productRegressionFailure
          ? "failed"
          : "blocked";
    context.service.updateBugReportStatus(
      bug.id,
      caseStatus === "passed"
        ? "retest-passed"
        : caseStatus === "failed"
          ? "retest-failed"
          : regression.previousStatus
    );
    const completedRegression = {
      ...result,
      mode: "bug-regression",
      status:
        caseStatus === "passed"
          ? "completed"
          : caseStatus === "failed"
            ? "failed"
            : "blocked",
      chainRun,
      testResult,
      executionDiagnosis: terminalDiagnosis,
      result: {
        caseNo: regression.caseNo,
        title: regression.title,
        status: caseStatus,
        testCaseId: chainContext.testCaseId,
        chainRunId: chainRun.id,
        diagnosisId: terminalDiagnosis?.id,
        bugReportId: bug.id,
        gapIds: gaps.map((gap) => gap.id),
        error: failureReason
      },
      bug
    };
    if (regression.remainingBugIds.length === 0) {
      return completedRegression;
    }
    const next = await runBugRegression(context, {
      systemId: result.task.systemId,
      bugIds: regression.remainingBugIds,
      maxHealAttempts: regression.maxHealAttempts,
      browserMode: chainContext.browserMode
    });
    return {
      ...next,
      completedRegression
    };
  }
  return { ...result, chainRun, testResult };
}



async function finalizeHostAgentPlan(
  context: BrainCreatorMcpContext,
  result: { task: AgentTask; agentRun: AgentRun }
) {
  const planContext = result.task.planContext;
  if (!planContext) {
    return result;
  }
  if (result.agentRun.status !== "succeeded") {
    const gap = context.service.reportGap({
      projectId: result.task.systemId,
      sourceType: "host-agent-planner",
      sourceId: result.task.id,
      reason: result.agentRun.error ?? "Host-agent planner failed",
      severity: "high",
      owner: "qa"
    });
    return { ...result, status: "blocked", stage: "planner", gap };
  }

  let specContent: string;
  try {
    specContent = await readFile(planContext.specPath, "utf8");
  } catch (error) {
    const gap = context.service.reportGap({
      projectId: result.task.systemId,
      sourceType: "host-agent-planner",
      sourceId: result.task.id,
      reason: `Planner did not create the requested spec output: ${error instanceof Error ? error.message : String(error)}`,
      severity: "high",
      owner: "qa"
    });
    return { ...result, status: "blocked", stage: "planner", gap };
  }
  const scenarios = parseSpecMarkdown(specContent);
  if (scenarios.length === 0) {
    const gap = context.service.reportGap({
      projectId: result.task.systemId,
      sourceType: "host-agent-planner",
      sourceId: result.task.id,
      reason: "Planner output did not contain any executable scenarios.",
      severity: "high",
      owner: "qa"
    });
    return { ...result, status: "blocked", stage: "planner", gap };
  }

  const glossaryTerms = context.service.listGlossaryTerms({
    projectId: result.task.systemId,
    query: ""
  });
  const businessRules = context.service.listBusinessRules(result.task.systemId);
  const ruleCheckResult = checkBusinessRules({ specContent, rules: businessRules });
  const newTerms = extractCandidateTerms({
    systemId: result.task.systemId,
    specContent,
    existingTerms: glossaryTerms,
    pageScope: "/"
  });
  const testCase = context.service.createTestCase({
    systemId: result.task.systemId,
    requirement: planContext.requirement,
    scenarios,
    newTerms,
    ruleCheckResult
  });
  return {
    ...result,
    status: "plan_ready",
    stage: "planner",
    specPath: planContext.specPath,
    promptPath: planContext.promptPath,
    seedPath: planContext.seedPath,
    scenarios,
    newTerms,
    ruleCheckResult,
    testCase
  };
}

async function maybeCreateHostAgentBugReport(
  context: BrainCreatorMcpContext,
  input: {
    task: AgentTask;
    chainRunId: string;
    failureReason: string;
    artifactPaths: string[];
    diagnosisId?: string;
    diagnosisVerdict?: ExecutionDiagnosisVerdict;
  }
) {
  if (
    input.task.chainContext?.executableCaseId &&
    input.diagnosisVerdict === "product_bug"
  ) {
    const executableCase = context.repository.executableCases.find(
      (item) => item.id === input.task.chainContext?.executableCaseId
    );
    if (executableCase) {
      return createRequirementBugReport(context, {
        executableCase,
        chainRun: {
          id: input.chainRunId,
          systemId: input.task.systemId,
          testCaseId: input.task.chainContext.testCaseId,
          status: "failed",
          gaps: [],
          createdAt: input.task.createdAt
        },
        failureReason: input.failureReason,
        artifactPaths: input.artifactPaths,
        diagnosisId: input.diagnosisId
      });
    }
  }
  if (
    !input.task.suiteContext ||
    input.diagnosisVerdict !== "product_bug"
  ) {
    return undefined;
  }
  const source = context.service
    .listCaseSources(input.task.systemId)
    .find((item) => item.id === input.task.suiteContext?.sourceId);
  if (!source) {
    return undefined;
  }
  let documentCase: DocumentCase | undefined;
  try {
    const parsed = await parseCaseSource(source.source);
    documentCase = parsed.cases.find((item) => item.caseNo === input.task.suiteContext?.caseNo);
  } catch {
    return undefined;
  }
  if (!documentCase) {
    return undefined;
  }
  return context.service.createBugReport({
    systemId: input.task.systemId,
    sourceId: source.id,
    caseNo: documentCase.caseNo,
    caseTitle: documentCase.title,
    module: documentCase.module,
    priority: documentCase.priority,
    expectedResult: documentCase.expectedResult,
    actualResult: input.failureReason,
    reproductionSteps: reproductionSteps(documentCase),
    evidencePaths: input.artifactPaths,
    chainRunId: input.chainRunId,
    diagnosisId: input.diagnosisId,
    gapIds: []
  });
}

function hostAgentFailureReason(
  agent: AgentRun["agent"],
  agentError: string | undefined,
  testResult: Awaited<ReturnType<typeof runSubmittedPlaywrightTest>> | undefined
) {
  const detail = [agentError, testResult?.stderr, testResult?.stdout].find(
    (value): value is string => Boolean(value?.trim())
  ) ?? "Host agent task failed";
  if (agent === "healer") {
    return `Playwright still failing after healer: ${detail}`;
  }
  if (agent === "generator" && testResult) {
    return `Playwright failed after generator: ${detail}`;
  }
  return detail;
}

function redactHostAgentText(
  context: BrainCreatorMcpContext,
  systemId: string,
  text: string
) {
  return redactSensitiveText(text, protectedSecretsForSystem(context, systemId));
}



function assertWorkspaceOutputPaths(workDir: string, paths: string[] | undefined) {
  for (const path of paths ?? []) {
    const absolute = resolve(workDir, path);
    const offset = relative(resolve(workDir), absolute);
    if (offset.startsWith("..") || isAbsolute(offset)) {
      throw new Error("Agent output path must stay inside the Brain Creator workspace");
    }
  }
}



function scanGeneratedTestSecrets(
  context: BrainCreatorMcpContext,
  systemId: string,
  source: string
) {
  const protectedValues = Object.entries(protectedSecretsForSystem(context, systemId));
  return [
    ...scanSensitiveValues(source, Object.fromEntries(protectedValues)).map(
      (finding) => `credential:${finding.secretKey}`
    ),
    ...scanSensitivePatterns(source).map((finding) => `pattern:${finding.rule}`)
  ];
}



async function readArtifact(
  context: BrainCreatorMcpContext,
  input: Record<string, unknown>,
  type: TestArtifact["type"]
) {
  const systemId = stringArg(input, "systemId");
  const requestedPath = stringArg(input, "path");
  const resolvedPath = resolveWorkspacePath(context.workDir, requestedPath);
  const artifacts =
    type === "test-spec"
      ? context.service.listTestSpecs(systemId)
      : context.service.listTestFiles(systemId);
  const artifact = artifacts.find((item) => {
    try {
      return resolveWorkspacePath(context.workDir, item.path) === resolvedPath;
    } catch {
      return false;
    }
  });
  if (!artifact) {
    throw new Error("Artifact not found");
  }
  const content = await readFile(resolvedPath, "utf8");
  return {
    ...artifact,
    content,
    bytes: Buffer.byteLength(content, "utf8")
  };
}

async function artifactOverview(context: BrainCreatorMcpContext, input: Record<string, unknown>) {
  const systemId = stringArg(input, "systemId");
  const specs = context.service.listTestSpecs(systemId);
  const tests = context.service.listTestFiles(systemId);
  const latestSpec = specs.at(-1);
  const latestTest = tests.at(-1);
  return {
    systemId,
    counts: {
      specs: specs.length,
      tests: tests.length
    },
    latestSpec: latestSpec ? await artifactSummary(context, latestSpec) : undefined,
    latestTest: latestTest ? await artifactSummary(context, latestTest) : undefined
  };
}

function suiteRunReview(
  context: BrainCreatorMcpContext,
  systemId: string,
  id?: string,
  failureTypes = new Set<FailureType>()
) {
  const runs = context.service
    .listCaseSuiteRuns(systemId)
    .filter((run) => id === undefined || run.id === id || run.suiteId === id);
  const bugIds = new Set(runs.flatMap((run) => run.bugReportIds));
  const gapIds = new Set(
    runs.flatMap((run) => [
      ...run.gapIds,
      ...run.caseResults.flatMap((caseResult) => caseResult.gapIds)
    ])
  );
  const bugReports = context.service
    .listBugReports({ systemId })
    .filter((bug) => bugIds.has(bug.id))
    .filter((bug) => matchesFailureTypes(classifyFailure(bug.actualResult), failureTypes));
  const gaps = context.service
    .listGaps({ projectId: systemId })
    .filter((gap) => gapIds.has(gap.id))
    .filter((gap) => matchesFailureTypes(classifyFailure(gap.reason, gap.sourceType), failureTypes));
  const filteredBugIds = new Set(bugReports.map((bug) => bug.id));
  const filteredGapIds = new Set(gaps.map((gap) => gap.id));
  const failedCases = runs.flatMap((run) =>
    run.caseResults
      .filter((caseResult) => caseResult.status !== "passed")
      .filter(
        (caseResult) =>
          failureTypes.size === 0 ||
          (caseResult.bugReportId !== undefined && filteredBugIds.has(caseResult.bugReportId)) ||
          caseResult.gapIds.some((gapId) => filteredGapIds.has(gapId))
      )
      .map((caseResult) => ({
        suiteRunId: run.id,
        suiteId: run.suiteId,
        sourceId: run.sourceId,
        caseNo: caseResult.caseNo,
        title: caseResult.title,
        status: caseResult.status,
        bugReportId: caseResult.bugReportId,
        gapIds: caseResult.gapIds,
        error: caseResult.error
      }))
  );
  const summary = suiteRunSummary(runs, bugReports, gaps);
  const suiteIds = new Set(runs.map((run) => run.suiteId));
  const ledgerEntries = context.runLedger
    .list({ runType: "document-suite", systemId })
    .filter((entry) => suiteIds.has(entry.caseSuiteId ?? ""));
  return {
    summary,
    runs,
    failedCases,
    bugReports,
    gaps,
    runLedger: {
      summaries: [...suiteIds]
        .filter((suiteId) =>
          ledgerEntries.some((entry) => entry.caseSuiteId === suiteId)
        )
        .map((suiteId) => context.runLedger.summary(suiteId)),
      entries: ledgerEntries
    },
    reportMarkdown: suiteRunMarkdown(summary, failedCases, bugReports, gaps),
    nextAction: suiteRunNextAction(bugReports, gaps)
  };
}

function suiteRunSummary(runs: CaseSuiteRun[], bugReports: BugReport[], gaps: Gap[]) {
  const latest = runs.at(-1);
  const failed = sumBy(runs, (run) => run.failed);
  const blocked = sumBy(runs, (run) => run.blocked);
  const byType = failureTypeCounts([
    ...bugReports.map((bug) => classifyFailure(bug.actualResult)),
    ...gaps.map((gap) => classifyFailure(gap.reason, gap.sourceType))
  ]);
  return {
    totalRuns: runs.length,
    totalCases: sumBy(runs, (run) => run.total),
    passed: sumBy(runs, (run) => run.passed),
    failed,
    blocked,
    bugReports: bugReports.length,
    gaps: gaps.length,
    failureClassification: {
      businessBugs: bugReports.length,
      evidenceGaps: gaps.length,
      failedCases: failed,
      blockedCases: blocked,
      byType
    },
    latestStatus: latest?.status,
    byStatus: countBy(runs, (run) => run.status)
  };
}

function suiteRunMarkdown(
  summary: ReturnType<typeof suiteRunSummary>,
  failedCases: Array<{
    caseNo: string;
    title: string;
    status: string;
    bugReportId?: string;
    gapIds: string[];
    error?: string;
  }>,
  bugReports: BugReport[],
  gaps: Gap[]
) {
  const lines = [
    "## Suite Run Summary",
    "",
    `Runs: ${summary.totalRuns}`,
    `Cases: ${summary.totalCases}`,
    `Passed: ${summary.passed}`,
    `Failed: ${summary.failed}`,
    `Blocked: ${summary.blocked}`,
    `BugReports: ${summary.bugReports}`,
    `Gaps: ${summary.gaps}`,
    ""
  ];
  if (failedCases.length > 0) {
    lines.push("### Failed / Blocked Cases", "");
    for (const item of failedCases) {
      lines.push(
        `- ${item.caseNo} ${item.title} [${item.status}]` +
          `${item.bugReportId ? ` bug=${item.bugReportId}` : ""}` +
          `${item.gapIds.length > 0 ? ` gaps=${item.gapIds.join(",")}` : ""}` +
          `${item.error ? ` error=${item.error}` : ""}`
      );
    }
    lines.push("");
  }
  if (bugReports.length > 0) {
    lines.push("### BugReports", "");
    for (const bug of bugReports) {
      lines.push(`- ${bug.caseNo} ${bug.caseTitle} [${bug.status}] ${bug.actualResult}`);
    }
    lines.push("");
  }
  if (gaps.length > 0) {
    lines.push("### Gaps", "");
    for (const gap of gaps) {
      lines.push(`- ${gap.id} [${gap.status}] ${gap.reason}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

function suiteRunNextAction(bugReports: BugReport[], gaps: Gap[]) {
  if (bugReports.some((bug) => bug.status === "open" || bug.status === "retest-failed")) {
    return "review_bugs";
  }
  if (gaps.some((gap) => gap.status === "open")) {
    return "review_gaps";
  }
  return "no_action";
}

function suiteRunReviewSummary(review: ReturnType<typeof suiteRunReview>) {
  const evidencePaths = uniqueStrings(review.runs.flatMap((run) => run.artifactPaths));
  return {
    title: "Suite Run Review",
    status: review.summary.latestStatus ?? "empty",
    metrics: review.summary,
    evidencePaths: evidencePaths.slice(0, 20),
    evidencePathCount: evidencePaths.length,
    evidenceTruncated: evidencePaths.length > 20,
    nextAction: review.nextAction,
    userMessage:
      `Suite review: ${review.summary.totalCases} cases, ` +
      `${review.summary.passed} passed, ${review.summary.failed} failed, ` +
      `${review.summary.blocked} blocked; ` +
      `${review.summary.failureClassification.businessBugs} business bugs, ` +
      `${review.summary.failureClassification.evidenceGaps} evidence gaps.`
  };
}

function bugReviewResultSummary(
  summary: ReturnType<typeof bugReviewSummary>,
  bugs: BugReport[],
  nextAction: string
) {
  const evidencePaths = uniqueStrings(bugs.flatMap((bug) => bug.evidencePaths));
  return {
    title: "Bug Review",
    status: summary.open > 0 || summary.retestFailed > 0 ? "action_required" : "completed",
    metrics: summary,
    evidencePaths: evidencePaths.slice(0, 20),
    evidencePathCount: evidencePaths.length,
    evidenceTruncated: evidencePaths.length > 20,
    nextAction,
    userMessage:
      `Bug review: ${summary.open} open, ${summary.retestFailed} retest failed, ` +
      `${summary.retestPassed} retest passed.`
  };
}

function gapReviewSummary(gaps: Gap[]) {
  const metrics = {
    total: gaps.length,
    open: gaps.filter((gap) => gap.status === "open").length,
    resolved: gaps.filter((gap) => gap.status === "resolved").length,
    bySeverity: countBy(gaps, (gap) => gap.severity),
    byFailureType: failureTypeCounts(gaps.map((gap) => classifyFailure(gap.reason, gap.sourceType)))
  };
  return {
    title: "Gap Review",
    status: metrics.open > 0 ? "action_required" : "completed",
    metrics,
    evidencePaths: [],
    nextAction: metrics.open > 0 ? "resolve_gaps" : "no_action",
    userMessage: `Gap review: ${metrics.open} open, ${metrics.resolved} resolved.`
  };
}

function artifactReviewSummary(overview: Awaited<ReturnType<typeof artifactOverview>>) {
  const evidencePaths = uniqueStrings([
    overview.latestSpec?.path,
    overview.latestTest?.path
  ].filter((path): path is string => Boolean(path)));
  const hasArtifacts = overview.counts.specs > 0 || overview.counts.tests > 0;
  return {
    title: "Artifact Review",
    status: hasArtifacts ? "ready" : "empty",
    metrics: overview.counts,
    evidencePaths,
    nextAction: hasArtifacts ? "read_artifacts" : "no_artifact",
    userMessage: `Artifact review: ${overview.counts.specs} specs, ${overview.counts.tests} tests.`
  };
}

function reviewMarkdownFromSummary(summary: {
  title: string;
  status: string;
  metrics: Record<string, unknown>;
  evidencePaths: string[];
  nextAction: string;
  userMessage: string;
}) {
  const lines = [
    `# ${summary.title}`,
    "",
    `- Status: ${summary.status}`,
    `- Next action: ${summary.nextAction}`,
    `- Message: ${summary.userMessage}`,
    "",
    "## Metrics"
  ];
  for (const [key, value] of Object.entries(summary.metrics)) {
    lines.push(`- ${key}: ${JSON.stringify(value)}`);
  }
  if (summary.evidencePaths.length > 0) {
    lines.push("", "## Evidence");
    for (const path of summary.evidencePaths) {
      lines.push(`- ${path}`);
    }
  }
  return lines.join("\n");
}



async function maybeWriteCaseSourceResults(input: {
  source: string;
  cases: DocumentCase[];
  results: CaseSuiteCaseResult[];
  bugs: BugReport[];
  requested: boolean;
  confirmed: boolean;
}) {
  if (!input.requested) {
    return { status: "skipped", updatedRows: 0 };
  }
  if (!input.confirmed) {
    return {
      status: "requires_confirmation",
      updatedRows: 0,
      reason: "Set confirmWriteBack=true to modify the source .xlsx file."
    };
  }
  return writeXlsxCaseSourceResults({
    source: input.source,
    cases: input.cases,
    results: input.results,
    bugs: input.bugs
  });
}

function previewSummary(parsed: ParsedCaseSource, selectedCases: DocumentCase[] = parsed.cases) {
  const selectedStats = summarizeDocumentCases(selectedCases);
  return {
    total: selectedCases.length,
    moduleStats: selectedStats.moduleStats,
    priorityStats: selectedStats.priorityStats,
    warnings: parsed.warnings,
    sampleCases: selectedCases.slice(0, 3).map((item) => ({
      caseNo: item.caseNo,
      title: item.title,
      module: item.module,
      priority: item.priority,
      sourceRow: item.sourceRow
    }))
  };
}

function caseSourceFilters(input: Record<string, unknown>) {
  return {
    caseNos: new Set(stringArrayArg(input, "caseNos").map((item) => item.trim()).filter(Boolean)),
    modules: new Set(stringArrayArg(input, "modules").map((item) => item.trim()).filter(Boolean)),
    priorities: new Set(stringArrayArg(input, "priorities").map((item) => item.trim()).filter(Boolean))
  };
}

function filterDocumentCases(
  cases: DocumentCase[],
  filters: ReturnType<typeof caseSourceFilters>
) {
  return cases.filter((documentCase) => {
    if (filters.caseNos.size > 0 && !filters.caseNos.has(documentCase.caseNo)) {
      return false;
    }
    if (filters.modules.size > 0 && !filters.modules.has(documentCase.module)) {
      return false;
    }
    if (filters.priorities.size > 0 && !filters.priorities.has(documentCase.priority)) {
      return false;
    }
    return true;
  });
}

function selectionSummary(
  allCases: DocumentCase[],
  selectedCases: DocumentCase[],
  filters: ReturnType<typeof caseSourceFilters>
) {
  return {
    totalAvailable: allCases.length,
    selected: selectedCases.length,
    selectedCaseNos: selectedCases.map((documentCase) => documentCase.caseNo),
    filters: {
      caseNos: [...filters.caseNos],
      modules: [...filters.modules],
      priorities: [...filters.priorities]
    }
  };
}

function caseSuiteProgress(context: BrainCreatorMcpContext, suite: CaseSuite) {
  const snapshot = caseSuiteExecutionSnapshot(context, suite);
  return {
    browserMode: suite.browserMode ?? "headless",
    selected: suite.selectedCaseNos.length,
    alreadyPassed: snapshot.passedCaseNos.length,
    attempted: snapshot.attemptedCaseNos.length,
    passed: snapshot.passedCaseNos.length,
    failed: snapshot.failedCaseNos.length,
    blocked: snapshot.blockedCaseNos.length,
    waiting: snapshot.waitingCaseNos.length,
    pending: snapshot.pendingCaseNos.length,
    remaining: snapshot.remainingCaseNos.length,
    ...snapshot
  };
}

async function writeDocumentSuiteReport(
  context: BrainCreatorMcpContext,
  suite: CaseSuite,
  cases?: DocumentCase[]
) {
  const source = context.service
    .listCaseSources(suite.systemId)
    .find((candidate) => candidate.id === suite.sourceId);
  let reportCases = cases ?? [];
  let sourceWarning: string | undefined;
  if (!cases && source) {
    try {
      reportCases = (await parseCaseSource(source.source)).cases;
    } catch (error) {
      sourceWarning = `Case source could not be read; selected cases are not expanded in this report: ${error instanceof Error ? error.message : String(error)}`;
    }
  } else if (!cases) {
    sourceWarning = "Case source is unavailable; selected cases are not expanded in this report.";
  }
  if (reportCases.length === 0 && suite.selectedCaseNos.length > 0) {
    reportCases = suite.selectedCaseNos.map((caseNo, index) => ({
      caseNo,
      title: "Source unavailable",
      module: "",
      precondition: "",
      steps: [],
      expectedResult: "",
      priority: "unknown",
      sourceRow: index + 1
    }));
  }
  const system = context.repository.systemProfiles.find((item) => item.id === suite.systemId);
  const layout = resolveArtifactRunLayout({
    workDir: context.workDir,
    systemKey: system?.name ?? suite.systemId,
    requirementKey: `document-${source?.id ?? suite.sourceId}`,
    suiteRunId: suite.id
  });
  const reportPath = join(layout.reportDir, "suite-report.html");
  const runs = context.service
    .listCaseSuiteRuns(suite.systemId)
    .filter((run) => run.suiteId === suite.id);
  const progressEntries = context.runLedger.list({
    runType: "document-suite",
    systemId: suite.systemId,
    caseSuiteId: suite.id
  });
  const historicalArtifactPaths = runs.flatMap((run) => run.artifactPaths);
  const actionArtifactPaths = progressEntries.flatMap((entry) =>
    (entry.actionEvidenceArtifacts ?? []).map((artifact) =>
      join(context.workDir, ".brain-creator", artifact.path)
    )
  );
  const ignoredExternalArtifactCount = [
    ...historicalArtifactPaths,
    ...actionArtifactPaths
  ].filter((path) => !isWorkspacePath(context.workDir, path)).length;
  if (ignoredExternalArtifactCount > 0) {
    const warning = `${ignoredExternalArtifactCount} historical artifact path(s) outside the current workspace were omitted from this report manifest.`;
    sourceWarning = [sourceWarning, warning].filter(Boolean).join(" ");
  }
  const bugIds = new Set(runs.flatMap((run) => run.bugReportIds));
  const gapIds = new Set(runs.flatMap((run) => run.gapIds));
  const progress = progressEntries.length > 0
    ? context.runLedger.progress(suite.id)
    : undefined;
  await writeStaticDocumentSuiteReport({
    outputPath: reportPath,
    title: `Brain Creator document suite ${suite.id}`,
    suite,
    cases: reportCases,
    runs,
    locale: system?.defaultLocale,
    progress,
    actionEvidence: [...new Map(
      progressEntries
        .filter((entry) => Boolean(entry.actionKey && entry.actionPhase))
        .map((entry) => [entry.actionKey!, entry])
    ).values()].map((entry) => ({
      ...(entry.caseNo ? { caseId: entry.caseNo } : {}),
      phase: entry.actionPhase!,
      actionKey: entry.actionKey!,
      actionSemantic: entry.actionSemantic ?? "",
      ...(entry.entityReference ? { entityReference: entry.entityReference } : {}),
      ...(entry.actionPostcondition ? { postcondition: entry.actionPostcondition } : {}),
      evidenceRefs: entry.actionEvidenceRefs ?? [],
      evidenceArtifacts: (entry.actionEvidenceArtifacts ?? [])
        .map((artifact) => ({
          path: join(context.workDir, ".brain-creator", artifact.path),
          sha256: artifact.sha256
        }))
        .filter((artifact) => isWorkspacePath(context.workDir, artifact.path))
    })),
    sourceWarning,
    bugs: context.repository.bugReports
      .filter((bug) =>
        bug.systemId === suite.systemId &&
        (bugIds.has(bug.id) || bug.sourceId === suite.sourceId)
      )
      .map((bug) => ({
        id: bug.id,
        status: bug.status,
        caseNo: bug.caseNo,
        actualResult: bug.actualResult
      })),
    gaps: context.repository.gaps
      .filter((gap) =>
        gap.projectId === suite.systemId &&
        (gapIds.has(gap.id) || gap.sourceId === suite.sourceId || gap.sourceId.startsWith(`${suite.sourceId}:`))
      )
      .map((gap) => ({
        id: gap.id,
        status: gap.status,
        caseNo: gap.sourceId.startsWith(`${suite.sourceId}:`)
          ? gap.sourceId.slice(suite.sourceId.length + 1)
          : undefined,
        reason: gap.reason
      })),
    protectedSecrets: protectedSecretsForSystem(context, suite.systemId)
  });
  await writeArtifactManifest({
    workDir: context.workDir,
    systemId: suite.systemId,
    suiteRunId: suite.id,
    artifactPaths: [
      reportPath,
      ...historicalArtifactPaths.filter((path) => isWorkspacePath(context.workDir, path)),
      ...actionArtifactPaths.filter((path) => isWorkspacePath(context.workDir, path))
    ],
    sourceRefs: [suite.sourceId, suite.id],
    ownershipDirectory: layout.root,
    protectedSecrets: protectedSecretsForSystem(context, suite.systemId)
  });
  if (suite.reportPath !== reportPath) {
    suite.reportPath = reportPath;
    context.repository.persist();
  }
  return reportPath;
}

function isWorkspacePath(workDir: string, path: string) {
  const absolute = resolve(workDir, path);
  const offset = relative(resolve(workDir), absolute);
  return !offset.startsWith("..") && !isAbsolute(offset);
}

function ensureDocumentSuiteLedger(
  context: BrainCreatorMcpContext,
  suite: CaseSuite
) {
  const existing = context.runLedger.list({
    runType: "document-suite",
    systemId: suite.systemId,
    caseSuiteId: suite.id
  });
  if (existing.length > 0) return;
  recordDocumentSuiteLedger(context, suite, {
    event: "suite-created",
    scope: "suite",
    stage: "suite",
    toStatus: suite.status
  });
}

function recordDocumentSuiteLedger(
  context: BrainCreatorMcpContext,
  suite: CaseSuite,
  input: Omit<
    Parameters<RunLedgerService["append"]>[0],
    "runType" | "knowledgeProjectId" | "systemId" | "requirementSuiteRunId" | "caseSuiteId" | "caseSourceId"
  >
) {
  return context.runLedger.append({
    runType: "document-suite",
    systemId: suite.systemId,
    caseSuiteId: suite.id,
    caseSourceId: suite.sourceId,
    ...input
  });
}

function completeDocumentSuiteLedger(
  context: BrainCreatorMcpContext,
  suite: CaseSuite,
  status: "completed" | "failed" | "blocked" | "cancelled"
) {
  const entries = context.runLedger.list({
    runType: "document-suite",
    systemId: suite.systemId,
    caseSuiteId: suite.id
  });
  const latest = entries.at(-1);
  if (latest?.event === "suite-completed" && latest.toStatus === status) return;
  recordDocumentSuiteLedger(context, suite, {
    event: "suite-completed",
    scope: "suite",
    stage: "suite",
    fromStatus: suite.status,
    toStatus: status,
    outcome:
      status === "completed"
        ? "passed"
        : status === "cancelled"
          ? "cancelled"
          : status
  });
}

async function prepareNextHostAgentSuiteTask(
  context: BrainCreatorMcpContext,
  suiteId: string,
  maxHealAttempts?: number
) {
  const suite = context.service.getCaseSuite(suiteId);
  const source = context.service
    .listCaseSources(suite.systemId)
    .find((candidate) => candidate.id === suite.sourceId);
  if (!source) {
    throw new Error("Case source not found for host-agent suite continuation");
  }
  const parsed = await parseCaseSource(source.source);
  const attempted = attemptedCaseNosForSuite(context, suite.systemId, suite.id);
  const documentCase = parsed.cases.find(
    (candidate) =>
      suite.selectedCaseNos.includes(candidate.caseNo) && !attempted.has(candidate.caseNo)
  );
  if (!documentCase) {
    return undefined;
  }
  const result = await executeDocumentCase(context, {
    systemId: suite.systemId,
    sourceId: source.id,
    suiteId: suite.id,
    documentCase,
    maxHealAttempts,
    browserMode: suite.browserMode ?? "headless",
    createBugOnFailure: true
  });
  if (!result.taskPackage) {
    return undefined;
  }
  const waitingSuite = context.service.updateCaseSuiteStatus(suite.id, "waiting-for-agent");
  return {
    ...result.taskPackage,
    mode: "case-source-suite",
    stage: result.taskPackage.task.agent,
    source,
    suite: waitingSuite,
    currentCase: result.caseResult,
    progress: caseSuiteProgress(context, waitingSuite)
  };
}





function latestUnfinishedCaseSuite(context: BrainCreatorMcpContext, systemId: string) {
  const suites = unfinishedCaseSuites(context, systemId);
  return suites.at(-1);
}

function existingCaseSuite(
  context: BrainCreatorMcpContext,
  suiteId: string,
  systemId: string,
  sourceId: string
): CaseSuite {
  const suite = context.service.getCaseSuite(suiteId);
  if (suite.systemId !== systemId) {
    throw new Error("Case suite belongs to another business system");
  }
  if (suite.sourceId !== sourceId) {
    throw new Error("Case suite belongs to another case source");
  }
  return suite;
}

function passedCaseNosForSuite(context: BrainCreatorMcpContext, systemId: string, suiteId: string) {
  const passed = new Set<string>();
  for (const run of context.service.listCaseSuiteRuns(systemId).filter((item) => item.suiteId === suiteId)) {
    for (const result of run.caseResults) {
      if (result.status === "passed") {
        passed.add(result.caseNo);
      }
    }
  }
  return passed;
}

function blockedCaseNosForSuite(context: BrainCreatorMcpContext, systemId: string, suiteId: string) {
  const blocked = new Set<string>();
  for (const run of context.service.listCaseSuiteRuns(systemId).filter((item) => item.suiteId === suiteId)) {
    for (const result of run.caseResults) {
      if (result.status === "blocked") {
        blocked.add(result.caseNo);
      }
    }
  }
  return blocked;
}

function attemptedCaseNosForSuite(
  context: BrainCreatorMcpContext,
  systemId: string,
  suiteId: string
) {
  const attempted = new Set<string>();
  for (const run of context.service
    .listCaseSuiteRuns(systemId)
    .filter((item) => item.suiteId === suiteId)) {
    for (const result of run.caseResults) {
      attempted.add(result.caseNo);
    }
  }
  return attempted;
}

function hostAgentSuiteFailureStatus(
  context: BrainCreatorMcpContext,
  suite: CaseSuite
): "blocked" | "failed" {
  const runs = context.service
    .listCaseSuiteRuns(suite.systemId)
    .filter((run) => run.suiteId === suite.id);
  return runs.some((run) => run.status === "blocked" || run.blocked > 0)
    ? "blocked"
    : "failed";
}



export type TestReadiness = {
  status: "not-ready" | "action-required" | "ready";
  reasons: string[];
  counts: {
    requirementProjects: number;
    requirementBaselines: number;
    approvedRequirementBaselines: number;
    confirmedSystemSnapshots: number;
    executableCases: number;
    readyExecutableCases: number;
    caseSources: number;
  };
};

























function brainCreatorCommandShortcuts() {
  return [
    {
      command: "/bc status",
      description: "Show current system readiness, auth, suites, bugs, gaps, artifacts, and next action."
    },
    {
      command: `/bc run "<path>"`,
      description: "Preview a test case document suite. Add --case, --module, or --priority filters when needed."
    },
    {
      command: "/bc continue",
      description: "Continue the latest unfinished suite for the selected system."
    },
    {
      command: "/bc bugs",
      description: "Review open BugReports. Add --failure-type to focus on one failure class."
    },
    {
      command: "/bc gaps",
      description: "Review open Gaps. Add --failure-type to focus on one failure class."
    },
    {
      command: "/bc review suite",
      description: "Review the latest suite run. Add --failure-type for focused failure analysis."
    },
    {
      command: "/bc regress bugs",
      description: "Run regression for open bugs. Add --bug, --module, or --priority filters when needed."
    }
  ];
}

function brainCreatorCommandHelpMarkdown() {
  return [
    "# Brain Creator shortcuts",
    "",
    "Use natural language first. When you want a compact command, use these `/bc` shortcuts:",
    "",
    ...brainCreatorCommandShortcuts().map(
      (shortcut) => `- \`${shortcut.command}\`: ${shortcut.description}`
    ),
    "",
    "Useful filters:",
    "- `--system <name>` / `--env <environment>` choose a system context.",
    "- `--case TC-001,TC-002` limits document suite preview or execution to case numbers.",
    "- `--module Recruiting` limits document suite preview, execution, or bug regression to modules.",
    "- `--priority P0` limits document suite preview, execution, or bug regression to priorities.",
    "- `--failure-type assertion_failure` filters bug, gap, or suite review by failure classification."
  ].join("\n");
}



function chainFailureReason(chainRun: ChainRun) {
  return (
    chainRun.gaps.map((gap) => gap.reason).filter(Boolean).join("\n") ||
    `Chain run ${chainRun.id} failed`
  );
}

function reproductionSteps(documentCase: DocumentCase) {
  return [
    documentCase.precondition ? `Precondition: ${documentCase.precondition}` : "",
    ...documentCase.steps
  ].filter(Boolean);
}









function sumBy<T>(items: T[], getValue: (item: T) => number) {
  return items.reduce((total, item) => total + getValue(item), 0);
}

function bugReviewSummary(bugs: Array<{ status: string; actualResult: string }>) {
  const counts = countBy(bugs, (bug) => bug.status);
  return {
    total: bugs.length,
    open: counts.open ?? 0,
    retestRunning: counts["retest-running"] ?? 0,
    retestPassed: counts["retest-passed"] ?? 0,
    retestFailed: counts["retest-failed"] ?? 0,
    closed: counts.closed ?? 0,
    byFailureType: failureTypeCounts(bugs.map((bug) => classifyFailure(bug.actualResult)))
  };
}

type FailureType = ExecutionFailureType;

function failureTypeCounts(types: FailureType[]) {
  return countBy(types, (type) => type);
}

function failureTypeFilters(input: Record<string, unknown>) {
  return new Set(stringArrayArg(input, "failureTypes").map((item) => failureTypeArg(item)));
}

function failureTypeArg(value: string): FailureType {
  const valid: FailureType[] = [
    "assertion_failure",
    "auth_failure",
    "locator_failure",
    "network_failure",
    "automation_failure",
    "test_data_failure",
    "environment_failure",
    "execution_failure",
    "unknown_failure"
  ];
  if (!valid.includes(value as FailureType)) {
    throw new Error(`failureTypes contains invalid value: ${value}`);
  }
  return value as FailureType;
}

function matchesFailureTypes(type: FailureType, filters: Set<FailureType>) {
  return filters.size === 0 || filters.has(type);
}

function bugRegressionCandidates(bugs: BugReport[]) {
  return bugs.filter((bug) => bug.status === "open" || bug.status === "retest-failed");
}

function regressionCandidateSummary(bugs: BugReport[]) {
  return {
    total: bugs.length,
    bugIds: bugs.map((bug) => bug.id),
    caseNos: bugs.map((bug) => bug.caseNo),
    byModule: countBy(bugs, (bug) => bug.module || "未分组"),
    byPriority: countBy(bugs, (bug) => bug.priority || "未标记")
  };
}

function bugRegressionSummary(
  candidates: BugReport[],
  bugs: BugReport[],
  results: CaseSuiteCaseResult[]
) {
  const counts = countBy(bugs, (bug) => bug.status);
  return {
    candidates: candidates.length,
    attempted: results.length,
    retestPassed: counts["retest-passed"] ?? 0,
    retestFailed: counts["retest-failed"] ?? 0,
    blocked: results.filter((result) => result.status === "blocked").length,
    remainingOpen: counts.open ?? 0
  };
}

function bugRegressionMarkdown(
  summary: ReturnType<typeof bugRegressionSummary>,
  bugs: BugReport[]
) {
  const lines = [
    "## Bug Regression Summary",
    "",
    `Candidates: ${summary.candidates}`,
    `Attempted: ${summary.attempted}`,
    `Retest passed: ${summary.retestPassed}`,
    `Retest failed: ${summary.retestFailed}`,
    `Blocked: ${summary.blocked}`,
    `Remaining open: ${summary.remainingOpen}`,
    ""
  ];
  for (const bug of bugs) {
    lines.push(
      `### ${bug.caseNo} ${bug.caseTitle}`,
      "",
      `Status: ${bug.status}`,
      `Priority: ${bug.priority}`,
      `Module: ${bug.module}`,
      `Expected: ${bug.expectedResult}`,
      `Actual: ${bug.actualResult}`,
      `Evidence: ${bug.evidencePaths.join(", ") || "N/A"}`,
      ""
    );
  }
  return lines.join("\n");
}

function bugReviewMarkdown(
  bugs: Array<{
    caseNo: string;
    caseTitle: string;
    status: string;
    priority: string;
    module: string;
    expectedResult: string;
    actualResult: string;
    reproductionSteps: string[];
    evidencePaths: string[];
  }>
) {
  const summary = bugReviewSummary(bugs);
  const lines = [
    "## BugReport Summary",
    "",
    `Total: ${summary.total}`,
    `Open: ${summary.open}`,
    `Retest passed: ${summary.retestPassed}`,
    `Retest failed: ${summary.retestFailed}`,
    ""
  ];
  for (const bug of bugs) {
    lines.push(
      `### ${bug.caseNo} ${bug.caseTitle}`,
      "",
      `Status: ${bug.status}`,
      `Priority: ${bug.priority}`,
      `Module: ${bug.module}`,
      `Expected: ${bug.expectedResult}`,
      `Actual: ${bug.actualResult}`,
      `Steps: ${bug.reproductionSteps.join(" -> ") || "N/A"}`,
      `Evidence: ${bug.evidencePaths.join(", ") || "N/A"}`,
      ""
    );
  }
  return lines.join("\n");
}

async function artifactSummary(context: BrainCreatorMcpContext, artifact: TestArtifact) {
  const resolvedPath = resolveWorkspacePath(context.workDir, artifact.path);
  const content = await readFile(resolvedPath, "utf8");
  return {
    ...artifact,
    snippet: content.slice(0, 500),
    bytes: Buffer.byteLength(content, "utf8")
  };
}

async function verifyCaseSourceSuiteAuthState(
  context: BrainCreatorMcpContext,
  systemId: string,
  profile = findAuthProfile(context, systemId)
): Promise<(AuthStateVerification & {
  authRefresh?: { attempted: boolean; provider?: string; status?: string; reason?: string };
}) | undefined> {
  const system = context.repository.systemProfiles.find((item) => item.id === systemId);
  if (!system) {
    throw new Error("Business system not found");
  }
  const storageStatePath = await materializeAuthStorageState(context, system, profile);
  if (!storageStatePath) {
    return undefined;
  }
  const verification = await context.authStateVerifier({
    storageStatePath: await resolveProtectedStorageStatePath(context.workDir, storageStatePath),
    workDir: context.workDir,
    targetUrl: system.baseUrl,
    allowedUrls: system.urlAllowlist
  });
  if (verification.status === "valid") {
    return { ...verification, authRefresh: { attempted: false } };
  }
  const refreshed = await refreshAndVerifyAuthState(context, system, profile, verification.reason);
  if (!refreshed) return verification;
  return refreshed.status === "valid"
    ? {
        ...refreshed,
        authRefresh: refreshed.authRefresh
          ? {
              attempted: true,
              provider: refreshed.authRefresh.provider
            }
          : undefined
      }
    : { ...verification, authRefresh: refreshed.authRefresh };
}









function resolveWorkspacePath(workDir: string, candidatePath: string) {
  const root = resolve(workDir);
  const candidate = isAbsolute(candidatePath)
    ? resolve(candidatePath)
    : resolve(root, candidatePath);
  const offset = relative(root, candidate);
  if (offset.startsWith("..") || isAbsolute(offset)) {
    throw new Error("Artifact path must stay inside workspace");
  }
  return candidate;
}































































export type KnowledgeReviewTarget =
  | "evaluation-trial"
  | "requirement"
  | "knowledge"
  | "coverage"
  | "requirement-eval-accuracy"
  | "system-brain"
  | "system-exploration"
  | "onboarding-plan"
  | "exploration-plan"
  | "test-intent"
  | "executable-case"
  | "execution-plan"
  | "requirement-suite-run"
  | "run-ledger"
  | "execution-diagnosis"
  | "evidence"
  | "compile-run"
  | "semantic-binding"
  | "case-dependency"
  | "testdata"
  | "business-scenario"
  | "scenario-assurance"
  | "scenario-trust"
  | "conformance"
  | "stage-eval"
  | "source-fidelity"
  | "approval";
