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
import type { BrainCreatorMcpContext, KnowledgeReviewTarget, TestReadiness } from "./handlers.js";
const { textResult, facadeTextResult, compactFacadePayload, summarizeFacadeRecord, facadeReferences, envelopeResult, stringArg, optionalStringArg, executionProvenanceArg, optionalNumberArg, numberArg, optionalBooleanArg, mutationResultsArg, materializeAuthStorageState, actorJourneyArg, explorationScenarioArg, summarizeCoverageDimensions, planContextArg, chainContextArg, archiveRequirementSuiteRun, writeRequirementSuiteSnapshots, createRequirementBugReport, suiteContextArg, regressionContextArg, runModeArg, browserModeArg, suiteActionArg, explorationPlanActionsArg, explorationCleanupPolicyArg, onboardingApprovalStageArg, explorationResultArg, reviewTargetArg, stabilityPolicyArg, isKnowledgeReviewTarget, resolveSystemReference, systemCandidatesText, normalizeSystemLookup, inferSystemName, extractCaseSource, intentCaseSourceFilters, intentBugRegressionFilters, bugRegressionFilters, matchesBugRegressionFilters, mergeUniqueStrings, extractBugIds, extractCaseNos, extractPriorities, isPriorityToken, extractTaggedValues, extractPrecedingTaggedValues, escapeRegExp, isContinueRequest, isBugRegressionRequest, isBugReviewRequest, isDocumentSuiteRequest, parseBrainCreatorCommand, parseBrainCreatorCommandTokens, commandWithSystemReference, parseRunCommandInput, parseBugRegressionCommandInput, parseReviewCommandInput, splitCommandValues, commandReviewTarget, commandTokens, configureTargetArg, prepareActionArg, executionActionPhaseArg, evaluationProviderArg, evaluationInterventionCategoryArg, diagnosisAssetTypeArg, legacyDiagnosisDecisionArg, optionalExecutionFailureTypeArg, optionalExecutionDiagnosisVerdictArg, testDataTaskResultStatusArg, optionalTestDataProviderDecisionArg, testDataResolutionsArg, knowledgeNodeTypeArg, policyProviderArg, explorationInteractionModeArg, systemExplorationModeArg, requirementContentPackageArg, hostDownloadedAttachmentsArg, explorationTaskOutcomeArg, attachmentAnalysisArg, interactionEvidenceArg, pageEvidenceArg, trainingEvidenceArg, assertSystemEvidenceUrl, stringArrayArg, optionalStringArrayArg, optionalObjectArrayArg, recordArg, loginMethodArg, severityArg, gapStatusArg, responseModeArg, onboardingCreateNextAction, evaluationRuntimeBuildIdentity, evaluationRuntimeIdentity, gapSeverityArg, bugStatusArg, authCheckpointStatusArg, agentArg, agentOutputStatusArg, scenarioArrayArg, stepArrayArg, priorityArg, actionArg, protectedSecretsForSystem } = handlerArguments;
const { compileRunSummary } = requirementWorkflowHandlers;

export async function statusFacade(context: BrainCreatorMcpContext, input: Record<string, unknown>) {
  const knowledgeProjectId = optionalStringArg(input, "knowledgeProjectId");
  if (knowledgeProjectId) {
    return knowledgeStatus(context, knowledgeProjectId);
  }
  const systemIdInput = optionalStringArg(input, "systemId");
  const systemNameInput = optionalStringArg(input, "systemName");
  const environment = optionalStringArg(input, "environment");
  const candidates =
    systemIdInput || systemNameInput
      ? []
      : context.service
          .listSystemProfiles()
          .filter((system) => system.status !== "cancelled")
          .filter((system) => !environment || system.environment === environment);
  if (!systemIdInput && !systemNameInput && candidates.length !== 1) {
    return statusSystemSelection(candidates, environment);
  }
  const resolution = resolveSystemReference(
    context,
    candidates.length === 1 ? { ...input, systemId: candidates[0].id } : input
  );
  const systemId = resolution.systemId;
  const snapshot = await sessionResume(context, { systemId });
  const caseSources = context.service.listCaseSources(systemId);
  const suites = context.service.listCaseSuites(systemId);
  const suiteRuns = context.service.listCaseSuiteRuns(systemId);
  const bugs = context.service.listBugReports({ systemId });
  const executionDiagnoses = context.executionDiagnosis.list({ systemId });
  const executionEvidence = context.repository.executionEvidence.filter(
    (item) => item.systemId === systemId
  );
  const requirementSuiteRuns = context.repository.requirementSuiteRuns.filter(
    (run) => run.systemId === systemId
  );
  const executionTasks = projectExecutionTasks(context.repository, { systemId });
  const scheduledRuns = requirementSuiteRuns
    .filter((run) => Boolean(run.stabilitySchedule))
    .map((run) => {
      const schedule = run.stabilitySchedule!;
      return {
        runId: run.id,
        knowledgeProjectId: run.knowledgeProjectId,
        status: run.status,
        stabilityGroupId: run.stabilityGroupId,
        stabilityIteration: run.stabilityIteration,
        stabilityTarget: run.stabilityTarget,
        due: isStabilityScheduleDue(schedule, new Date()),
        nextRunAt: schedule.nextRunAt,
        leaseOwner: schedule.leaseOwner,
        leaseExpiresAt: schedule.leaseExpiresAt,
        lastError: schedule.lastError
      };
    })
    .sort((left, right) => Number(right.due) - Number(left.due) || left.runId.localeCompare(right.runId));
  const configuredRefreshProviders = snapshot.auth.profiles
    .map((profile) => (profile as AuthProfile & { refreshProvider?: string }).refreshProvider)
    .filter(Boolean) as string[];
  const registeredRefreshProviders = context.authRefreshRegistry.providers();
  const unavailableRefreshProviders = [...new Set(configuredRefreshProviders)]
    .filter((provider) => !registeredRefreshProviders.includes(provider as typeof registeredRefreshProviders[number]));
  const legacyDiagnosisAudit = context.executionDiagnosis.auditLegacy({
    systemId,
    limit: 1
  });
  const openBugs = bugs.filter((bug) => bug.status === "open" || bug.status === "retest-failed");
  const unfinishedSuites = unfinishedCaseSuites(context, systemId);
  const documentRunLedgerEntries = context.runLedger.list({
    runType: "document-suite",
    systemId
  });
  const activeDocumentSuite = unfinishedSuites.at(-1);
  const activeDocumentSuiteAsset = activeDocumentSuite
    ? context.service.getCaseSuite(activeDocumentSuite.suiteId)
    : undefined;
  const pendingAgentTasks = context.service
    .listAgentTasks(systemId)
    .filter((task) => task.status === "pending");
  const awaitingAuthCheckpoints = snapshot.auth.checkpoints.filter(
    (checkpoint) => checkpoint.status === "awaiting-user"
  );
  const activeAuthProfiles = snapshot.auth.profiles.filter(
    (profile) => profile.status !== "cancelled"
  );
  const verifiedAuthProfiles = snapshot.auth.profiles.filter(
    (profile) => profile.status === "succeeded"
  );
  const reauthenticationProfile = activeAuthProfiles
    .filter((profile) => profile.status === "pending" || profile.status === "failed")
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
  const activeDocumentLedgerSummary =
    activeDocumentSuite &&
    documentRunLedgerEntries.some(
      (entry) => entry.caseSuiteId === activeDocumentSuite.suiteId
    )
      ? context.runLedger.summary(activeDocumentSuite.suiteId)
      : undefined;
  const activeDocumentExecutionRecovery = activeDocumentSuite
    ? recoverExecutionState(context.repository, activeDocumentSuite.suiteId)
    : undefined;
  const pendingWriteTaskId = executionTasks.active?.pendingAction
    ? executionTasks.active.id
    : undefined;
  const stalledExecutionTaskId = executionTasks.tasks.find((task) => task.possiblyStalled)?.id;
  const nextAction = facadeNextAction({
    bridgeOk: snapshot.bridge.ok,
    authProfiles: activeAuthProfiles.length,
    verifiedAuthProfiles: verifiedAuthProfiles.length,
    authProfileId: reauthenticationProfile?.id,
    awaitingAuthCheckpoints: awaitingAuthCheckpoints.length,
    pendingWriteTaskId,
    stalledExecutionTaskId,
    pendingAgentTasks: pendingAgentTasks.length,
    openBugs: openBugs.length,
    openGaps: snapshot.openGaps.length,
    approvedCases: snapshot.cases.byStatus.approved,
    caseSources: caseSources.length,
    unfinishedSuites: unfinishedSuites.length
  });
  const activeSuiteSummary = activeDocumentSuite
    ? {
        suiteId: activeDocumentSuite.suiteId,
        status: activeDocumentSuite.status,
        browserMode: activeDocumentSuiteAsset?.browserMode ?? "headless",
        reportPath: activeDocumentSuiteAsset?.reportPath,
        totalCases: activeDocumentSuite.totalCases,
        attempted: activeDocumentSuite.attemptedCaseNos.length,
        passed: activeDocumentSuite.passedCaseNos.length,
        failed: activeDocumentSuite.failedCaseNos.length,
        blocked: activeDocumentSuite.blockedCaseNos.length,
        waiting: activeDocumentSuite.waitingCaseNos.length,
        pending: activeDocumentSuite.pendingCaseNos.length,
        nextCaseNo: activeDocumentSuite.nextCaseNo,
        ...(activeDocumentLedgerSummary
          ? {
              currentStage: activeDocumentLedgerSummary.currentStage,
              currentStep: activeDocumentLedgerSummary.currentStep,
              currentCaseTitle: activeDocumentLedgerSummary.currentCaseTitle,
              currentPageUrl: activeDocumentLedgerSummary.currentPageUrl,
              elapsedMs: activeDocumentLedgerSummary.elapsedMs,
              lastUpdatedAt: activeDocumentLedgerSummary.updatedAt,
              waitReason: activeDocumentLedgerSummary.waitReason,
              possiblyStalled: activeDocumentLedgerSummary.possiblyStalled,
              latestEvent: activeDocumentLedgerSummary.latestEvent,
              traceId: activeDocumentLedgerSummary.traceId
            }
          : {}),
        ...(activeDocumentExecutionRecovery
          ? { executionRecovery: activeDocumentExecutionRecovery }
          : {}),
        activeTask: activeDocumentSuite.activeTask
          ? {
              taskId: activeDocumentSuite.activeTask.taskId,
              caseNo: activeDocumentSuite.activeTask.caseNo,
              title: activeDocumentSuite.activeTask.title
            }
          : undefined
      }
    : undefined;
  const userSummary = statusUserSummary({
    systemId,
    systemName: snapshot.system.name,
    bridgeOk: snapshot.bridge.ok,
    authProfiles: activeAuthProfiles.length,
    verifiedAuthProfiles: verifiedAuthProfiles.length,
    authProfileId: reauthenticationProfile?.id,
    awaitingAuthCheckpoints: awaitingAuthCheckpoints.length,
    pendingAgentTasks: pendingAgentTasks.length,
    openBugs: openBugs.length,
    openGaps: snapshot.openGaps.length,
    unfinishedSuites: unfinishedSuites.length,
    testReadiness: testReadinessForSystem(context, systemId, {
      approvedCases: snapshot.cases.byStatus.approved,
      caseSources: caseSources.length
    }),
    pendingWriteTaskId,
    stalledExecutionTaskId,
    nextAction,
    activeSuite: activeSuiteSummary,
    activeExecutionTask: executionTasks.active
  });
  return {
    ...snapshot,
    sessionResumeNextAction: snapshot.nextAction,
    nextAction,
    systemResolution: resolution,
    caseSources: {
      total: caseSources.length,
      recent: caseSources.slice(-5)
    },
    suites: {
      total: suites.length,
      byStatus: countBy(suites, (suite) => suite.status),
      unfinished: unfinishedSuites.slice(-10),
      unfinishedTruncated: unfinishedSuites.length > 10,
      recent: suites.slice(-5)
    },
    suiteRuns: {
      total: suiteRuns.length,
      byStatus: countBy(suiteRuns, (run) => run.status),
      recent: suiteRuns.slice(-5)
    },
    documentRunLedger: {
      total: documentRunLedgerEntries.length,
      activeSummary:
        activeDocumentLedgerSummary,
      recovery: activeDocumentExecutionRecovery,
      recent: documentRunLedgerEntries.slice(-20),
      recentTruncated: documentRunLedgerEntries.length > 20
    },
    agentTasks: {
      pending: pendingAgentTasks.slice(-10),
      pendingTruncated: pendingAgentTasks.length > 10
    },
    bugs: {
      total: bugs.length,
      open: openBugs.length,
      recent: bugs.slice(-5)
    },
    executionDiagnoses: {
      ...context.executionDiagnosis.summary({ systemId }),
      recent: executionDiagnoses.slice(-10),
      recentTruncated: executionDiagnoses.length > 10,
      legacyAudit: legacyDiagnosisAudit.summary,
      legacyReviews: context.executionDiagnosis.legacyReviewSummary(systemId),
      humanAdjudicationEval:
        context.executionDiagnosis.legacyReviewEval(systemId)
    },
    executionEvidence: {
      total: executionEvidence.length,
      byStatus: countBy(executionEvidence, (item) => item.status),
      byAssurance: countBy(executionEvidence, (item) => item.assuranceLevel ?? "none"),
      unassured: executionEvidence.filter(
        (item) => !item.assuranceLevel || item.assuranceLevel === "none"
      ).length
    },
    authRefresh: {
      registeredProviders: registeredRefreshProviders,
      configuredProviders: [...new Set(configuredRefreshProviders)],
      unavailableProviders: unavailableRefreshProviders
    },
    runtime: {
      configurationPath: context.runtimeConfigurationPath,
      configurationConfigured: Boolean(context.runtimeConfiguration),
      bridgeProvider: context.agentBridge?.provider ?? context.runtimeConfiguration?.bridgeProvider ?? "disabled",
      connectorStatus: context.feishuReader ? "feishu-configured" : "host-agent-fallback",
      reloadOperation: "bc_configure target=runtime operation=reload-config"
    },
    providerEvaluation: {
      primary: context.providerRegistry.primary(),
      evaluator: context.providerRegistry.evaluator(),
      available: context.providerRegistry.list().filter(
        (item) => item.role === "evaluator" && item.available
      )
    },
    executionTasks,
    brainRuntime: brainRuntimeStatus(context, systemId),
    requirementSuiteRuns: {
      total: requirementSuiteRuns.length,
      byStatus: countBy(requirementSuiteRuns, (run) => run.status),
      stability: summarizeStabilityRuns(requirementSuiteRuns, executionEvidence),
      scheduledRuns,
      scheduledRunsTruncated: scheduledRuns.length > 20
    },
    facadeNextAction: nextAction,
    userSummary,
    statusMarkdown: statusMarkdown(userSummary),
    quickCommands: statusQuickCommands({
      authProfiles: activeAuthProfiles.length,
      verifiedAuthProfiles: verifiedAuthProfiles.length,
      authProfileId: reauthenticationProfile?.id,
      openBugs: openBugs.length,
      openGaps: snapshot.openGaps.length,
      unfinishedSuites: unfinishedSuites.length,
      pendingWriteTaskId,
      systemId,
      stalledExecutionTaskId
    }),
    toolGuidance: statusToolGuidance(nextAction)
  };
}

export function brainRuntimeStatus(context: BrainCreatorMcpContext, systemId?: string, knowledgeProjectId?: string) {
  const tasks = context.repository.brainTasks.filter(
    (task) => (!systemId || task.systemId === systemId) &&
      (!knowledgeProjectId || task.knowledgeProjectId === knowledgeProjectId)
  );
  const taskIds = new Set(tasks.map((task) => task.id));
  const sessions = context.repository.brainSessions.filter(
    (session) => (!systemId || session.currentSystemId === systemId) &&
      (!knowledgeProjectId || session.knowledgeProjectId === knowledgeProjectId)
  );
  const events = context.repository.brainEvents.filter(
    (event) => !systemId || (event.taskId ? taskIds.has(event.taskId) : false)
  );
  const concepts = context.repository.semanticConcepts.filter(
    (concept) => (!systemId || concept.systemId === systemId) &&
      (!knowledgeProjectId || concept.knowledgeProjectId === knowledgeProjectId)
  );
  const entities = context.repository.businessEntityInstances.filter(
    (entity) => (!systemId || entity.systemId === systemId) &&
      (!knowledgeProjectId || entity.knowledgeProjectId === knowledgeProjectId)
  );
  const snapshots = context.repository.systemBrainSnapshots.filter(
    (snapshot) => (!systemId || snapshot.systemId === systemId) &&
      (!knowledgeProjectId || snapshot.knowledgeProjectId === knowledgeProjectId)
  );
  return {
    tasks: {
      total: tasks.length,
      active: tasks.filter((task) => ["pending", "running"].includes(task.status)),
      byState: countBy(tasks, (task) => task.state)
    },
    sessions: {
      total: sessions.length,
      active: sessions.filter((session) => Boolean(session.activeTaskId))
    },
    events: {
      total: events.length,
      recent: events.slice(-20)
    },
    semanticSpine: {
      concepts: concepts.length,
      aliases: context.repository.semanticAliases.filter((alias) =>
        concepts.some((concept) => concept.id === alias.conceptId)
      ).length,
      relations: context.repository.semanticRelations.filter((relation) =>
        concepts.some((concept) => concept.id === relation.fromConceptId || concept.id === relation.toConceptId)
      ).length,
      businessEntities: entities.length
    },
    testdataBrain: systemId
      ? {
          entities: context.testDataBrain.graph(systemId, knowledgeProjectId).entities.length,
          dependencies: context.testDataBrain.graph(systemId, knowledgeProjectId).dependencies.length
        }
      : {
          entities: entities.length,
          dependencies: context.repository.testDataDependencies.filter((item) =>
            (!knowledgeProjectId || item.knowledgeProjectId === knowledgeProjectId)
          ).length
        },
    staleArtifacts: {
      intents: context.repository.testIntents.filter((intent) => intent.status === "stale").length,
      executableCases: context.repository.executableCases.filter(
        (executableCase) => (!systemId || executableCase.systemId === systemId) && executableCase.status === "stale"
      ).length
    },
    systemBrainSnapshots: {
      total: snapshots.length,
      confirmed: snapshots.filter((snapshot) => snapshot.status === "confirmed").length,
      candidate: snapshots.filter((snapshot) => snapshot.status === "candidate").length,
      latest: snapshots
        .sort((left, right) => right.revision - left.revision || right.createdAt.localeCompare(left.createdAt))[0]
    }
  };
}

export function statusSystemSelection(
  systems: Array<{ id: string; name: string; environment: string }>,
  environment?: string
) {
  const grouped = new Map<
    string,
    { name: string; environment: string; systemIds: string[] }
  >();
  for (const system of systems) {
    const key = `${normalizeSystemLookup(system.name)}\u0000${normalizeSystemLookup(system.environment)}`;
    const existing = grouped.get(key);
    if (existing) {
      existing.systemIds.push(system.id);
      continue;
    }
    grouped.set(key, {
      name: system.name,
      environment: system.environment,
      systemIds: [system.id]
    });
  }
  const systemOptions = [...grouped.values()]
    .map((option) => ({
      ...option,
      instanceCount: option.systemIds.length
    }))
    .sort(
      (left, right) =>
        left.name.localeCompare(right.name) ||
        left.environment.localeCompare(right.environment)
    );
  const noSystems = systemOptions.length === 0;
  const selectionMarkdown = noSystems
    ? [
        "# Select a Brain Creator system",
        "",
        environment
          ? `No active systems were found in environment "${environment}".`
          : "No active systems are configured.",
        "Ask Brain Creator to connect a business system first."
      ].join("\n")
    : [
        "# Select a Brain Creator system",
        "",
        "Choose a system context before continuing:",
        "",
        ...systemOptions.flatMap((option) => [
          `- ${option.name} (${option.environment}) - ${option.instanceCount} ${
            option.instanceCount === 1 ? "instance" : "instances"
          }`,
          option.instanceCount === 1
            ? `  Command: \`/bc status --system "${option.name}" --env "${option.environment}"\``
            : "  Ask the Agent to choose a specific instance."
        ])
      ].join("\n");
  return {
    status: noSystems ? "no_systems" : "needs_system_selection",
    userMessage: noSystems
      ? "Connect a business system before using Brain Creator status."
      : "Choose a business system before continuing.",
    environment,
    systemOptions,
    selectionMarkdown,
    nextAction: noSystems ? "configure_system" : "select_system",
    quickCommands: systemOptions
      .filter((option) => option.instanceCount === 1)
      .map((option) => ({
        command: `/bc status --system "${option.name}" --env "${option.environment}"`,
        description: `Inspect ${option.name} in ${option.environment}.`
      })),
    toolGuidance: statusToolGuidance(noSystems ? "configure_system" : "select_system")
  };
}

export function knowledgeStatus(context: BrainCreatorMcpContext, projectId: string) {
  const project = context.repository.knowledgeProjects.find((item) => item.id === projectId);
  if (!project) throw new Error("Knowledge project not found");
  const evaluationTrials = context.evaluationIntegrity.list({ knowledgeProjectId: projectId });
  const sources = context.repository.requirementSources.filter(
    (item) => item.knowledgeProjectId === projectId
  );
  const requirementSets = context.repository.requirementSets.filter(
    (item) => item.knowledgeProjectId === projectId
  );
  const activeRequirementSets = requirementSets.filter((item) => item.status !== "superseded");
  const nodes = context.repository.knowledgeNodes.filter(
    (item) => item.knowledgeProjectId === projectId
  );
  const testIntents = context.knowledgeService.listTestIntents(projectId);
  const executableCases = context.knowledgeService.listExecutableCases(projectId);
  const explorationTasks = context.knowledgeService.listExplorationTasks()
    .filter((item) => item.knowledgeProjectId === projectId);
  const pendingExplorationTasks = explorationTasks.filter(
    (item) => item.status === "pending"
  );
  const explorationPlans = context.statefulExplorationPlans.list()
    .filter((item) => item.knowledgeProjectId === projectId);
  const activeExplorationPlan = explorationPlans
    .filter((item) => ["draft", "approved", "running"].includes(item.status))
    .at(-1);
  const onboardingPlans = context.onboardingPlans
    .list()
    .filter((item) => item.knowledgeProjectId === projectId);
  const activeOnboardingPlan = onboardingPlans
    .filter((item) => ["draft", "approved"].includes(item.status))
    .at(-1);
  const activeOnboardingExplorationPlan = activeOnboardingPlan
    ? explorationPlans.find((item) => item.id === activeOnboardingPlan.explorationPlanId)
    : undefined;
  const projectCompileRuns = context.repository.compileRuns.filter(
    (item) => item.knowledgeProjectId === projectId
  );
  const blockedDataPlans = executableCases.filter(
    (item) => item.dataPlan?.verdict === "blocked"
  );
  const onboardingNeedsData = Boolean(
    activeOnboardingPlan?.status === "approved" &&
      activeOnboardingExplorationPlan?.executableCaseIds.some((caseId) => {
        const executableCase = executableCases.find((item) => item.id === caseId);
        return executableCase?.status === "needs-data" ||
          executableCase?.dataPlan?.verdict === "blocked" ||
          Boolean(
            executableCase?.dataPlan?.requiresConfirmation &&
              !executableCase.dataPlan.confirmedAt
          );
      })
  );
  const executionEvidence = context.knowledgeService.listExecutionEvidence(projectId);
  const executionPlans = context.repository.executionPlans.filter(
    (item) => item.knowledgeProjectId === projectId
  );
  const requirementSuiteRuns = context.requirementSuiteRuns.list(projectId);
  const executionTasks = projectExecutionTasks(context.repository, {
    knowledgeProjectId: projectId
  });
  const stability = summarizeStabilityRuns(
    requirementSuiteRuns,
    context.repository.executionEvidence
  );
  const runLedgerEntries = context.runLedger.list({
    knowledgeProjectId: projectId
  });
  const executionDiagnoses = context.executionDiagnosis.list({
    knowledgeProjectId: projectId
  });
  const legacyDiagnosisAudit = aggregateLegacyDiagnosisAudit(
    context,
    project.systemIds,
    1
  );
  const activeRequirementSuiteRun = requirementSuiteRuns
    .filter(
      (item) =>
        item.status === "running" ||
        item.status === "waiting-for-test-data" ||
        item.status === "waiting-for-agent" ||
        item.status === "blocked"
    )
    .at(-1);
  const activeRequirementExecutionRecovery = activeRequirementSuiteRun
    ? recoverExecutionState(context.repository, activeRequirementSuiteRun.id)
    : undefined;
  const testDataTasks = context.repository.testDataTasks.filter(
    (item) => item.knowledgeProjectId === projectId
  );
  const testDataLeases = context.repository.testDataLeases.filter(
    (item) => item.knowledgeProjectId === projectId
  );
  const pendingTestDataTasks = testDataTasks.filter(
    (item) => item.status === "pending"
  );
  const cleanupDue = testDataLeases.filter(
    (lease) =>
      lease.decision === "create" &&
      lease.cleanup !== "none" &&
      (lease.status === "active" || lease.status === "cleanup-failed") &&
      executionEvidence.some(
        (evidence) =>
          evidence.executableCaseId === lease.executableCaseId &&
          evidence.status !== "running"
      )
  );
  const gaps = context.service.listGaps({ projectId, status: "open" });
  const activeRequirementSetIds = new Set(activeRequirementSets.map((item) => item.id));
  const activeRequirementSourceIds = new Set(activeRequirementSets.map((item) => item.sourceId));
  const activeSources = sources.filter((item) => activeRequirementSourceIds.has(item.id));
  const activeAttachmentIds = new Set(activeSources.flatMap((item) => item.attachments.flatMap((attachment) =>
    attachment.id ? [attachment.id] : []
  )));
  const activeRequirementGaps = gaps.filter((gap) =>
    gap.sourceType.startsWith("requirement-") &&
    (activeRequirementSetIds.has(gap.sourceId) ||
      activeRequirementSourceIds.has(gap.sourceId) ||
      activeAttachmentIds.has(gap.sourceId))
  );
  const unconfirmedAttachmentSources = activeSources.filter((source) =>
    source.attachments.some((attachment) => attachment.status !== "confirmed")
  );
  const evaluationGates = activeRequirementSets.flatMap((item) =>
    item.evaluationGate ? [item.evaluationGate] : []
  );
  const pendingEvalActions = evaluationGates.flatMap((gate) =>
    gate.actions.filter((action) => action.status === "pending")
  );
  const blockedEvalActions = evaluationGates.flatMap((gate) =>
    gate.actions.filter((action) => action.status === "blocked")
  );
  const systemBrains = project.systemIds.map((systemId) => {
    const brain = context.knowledgeService.getSystemBrain(projectId, systemId);
    const explorations = context.systemExploration.list(projectId, systemId);
    const pageIdentities = context.repository.systemPageIdentities.filter(
      (identity) => identity.systemId === systemId
    );
    return {
      systemId,
      readiness: brain.readiness,
      pages: brain.pages.length,
      workflows: brain.workflows.length,
      behaviorRules: brain.behaviorRules.length,
      apiFlows: brain.apiFlows.length,
      navigationEdges: brain.navigationEdges.length,
      states: brain.states.length,
      stateTransitions: brain.stateTransitions.length,
      pageIdentities: {
        total: pageIdentities.length,
        confirmed: pageIdentities.filter((identity) => identity.status === "confirmed").length,
        candidate: pageIdentities.filter((identity) => identity.status === "candidate").length,
        lowConfidence: pageIdentities.filter((identity) => (identity.confidence ?? 1) < 0.8).length
      },
      latestExploration: explorations.at(-1),
      conflicts: brain.conflicts.length
    };
  });
  const explorations = context.systemExploration.list(projectId);
  const runningExplorations = explorations.filter((item) => item.status === "running");
  const unresolvedExplorations = explorations.filter(
    (item) =>
      (item.status === "blocked" || item.status === "partial") &&
      item.gapIds.some((gapId) =>
        context.repository.gaps.some((gap) => gap.id === gapId && gap.status === "open")
      )
  );
  let nextAction = "generate_test_design";
  if (activeRequirementSuiteRun?.status === "waiting-for-test-data") {
    nextAction = "complete_requirement_suite_test_data_task";
  } else if (activeRequirementSuiteRun?.status === "waiting-for-agent") {
    nextAction = "complete_requirement_suite_agent_task";
  } else if (activeRequirementSuiteRun?.status === "blocked") {
    nextAction = "review_and_resume_requirement_suite";
  } else if (activeRequirementSuiteRun?.status === "running") {
    nextAction = "continue_requirement_suite";
  } else if (activeExplorationPlan?.status === "running") {
    nextAction = "complete_exploration_plan";
  } else if (onboardingNeedsData) {
    nextAction = "prepare_test_data";
  } else if (activeOnboardingPlan?.status === "approved") {
    nextAction = "start_onboarding_plan";
  } else if (activeOnboardingPlan?.status === "draft") {
    nextAction = "approve_onboarding_plan";
  } else if (activeExplorationPlan?.status === "approved") {
    nextAction = "start_exploration_plan";
  } else if (activeExplorationPlan?.status === "draft") {
    nextAction = "approve_exploration_plan";
  } else if (pendingTestDataTasks.length > 0) {
    nextAction = "complete_test_data_task";
  } else if (cleanupDue.length > 0) {
    nextAction = "prepare_test_data_cleanup";
  } else if (sources.length === 0) nextAction = "ingest_requirement";
  else if (blockedEvalActions.length > 0) nextAction = "revise_blocked_requirement";
  else if (pendingEvalActions.length > 0) nextAction = "confirm_requirement_eval";
  else if (activeRequirementGaps.length > 0) nextAction = "review_gaps";
  else if (unconfirmedAttachmentSources.length > 0) nextAction = "review_requirement_attachments";
  else if (activeRequirementSets.some((item) => item.status === "draft")) {
    const evaluatedDraft = activeRequirementSets.find(
      (item) =>
        item.status === "draft" &&
        item.evaluationGate &&
        item.evaluationGate.status !== "blocked" &&
        item.evaluationGate.actions.every((action) => action.status === "confirmed")
    );
    nextAction = evaluatedDraft && project.systemIds.length > 0
      ? "create_onboarding_plan"
      : "review_and_approve_baseline";
  } else if (pendingExplorationTasks.length > 0) {
    nextAction = "review_exploration_task";
  } else if (executableCases.some((item) => item.status === "ready")) {
    nextAction = project.systemIds.length > 0 ? "run_requirement_suite" : "bind_system";
  } else if (blockedDataPlans.length > 0) {
    nextAction = project.systemIds.length > 0 ? "prepare_test_data" : "resolve_test_data";
  } else if (testIntents.some((item) => item.status === "approved")) {
    if (project.systemIds.length === 0) nextAction = "bind_system";
    else if (runningExplorations.length > 0) nextAction = "review_system_exploration";
    else if (
      unresolvedExplorations.length > 0 &&
      !systemBrains.some((brain) => brain.readiness.readyForCompilation)
    ) {
      nextAction = "resolve_system_exploration_gap";
    }
    else if (!systemBrains.some((brain) => brain.readiness.readyForCompilation)) {
      nextAction = "explore_system";
    } else {
      nextAction = "compile_cases";
    }
  }
  return {
    summary: {
      knowledgeProjectId: project.id,
      projectName: project.name,
      nextAction,
      openGaps: gaps.length,
      latestCompileRunId: projectCompileRuns.at(-1)?.id,
      activeExplorationTaskId: pendingExplorationTasks.at(-1)?.id,
      activeExplorationPlanId: activeExplorationPlan?.id,
      activeOnboardingPlanId: activeOnboardingPlan?.id,
      activeExecutionTask: executionTasks.active,
      activeRun: activeRequirementSuiteRun
        ? {
            runId: activeRequirementSuiteRun.id,
            status: activeRequirementSuiteRun.status,
            browserMode: activeRequirementSuiteRun.browserMode ?? "headless",
            currentExecutableCaseId: activeRequirementSuiteRun.currentExecutableCaseId,
            progress: runLedgerEntries.some(
              (entry) => entry.requirementSuiteRunId === activeRequirementSuiteRun.id
            )
              ? context.runLedger.summary(activeRequirementSuiteRun.id).currentProgress
              : undefined,
            possiblyStalled: activeRequirementExecutionRecovery?.possiblyStalled ?? false,
            executionRecovery: activeRequirementExecutionRecovery
          }
        : undefined
    },
    knowledge: {
      project,
      sources: { total: sources.length, recent: sources.slice(-5) },
      requirementSets: {
        total: requirementSets.length,
        byStatus: countBy(requirementSets, (item) => item.status),
        recent: requirementSets.slice(-5)
      },
      evaluationGates: {
        total: evaluationGates.length,
        byStatus: countBy(evaluationGates, (item) => item.status),
        pendingActions: pendingEvalActions.length,
        blockedActions: blockedEvalActions.length
      },
      onboarding: {
        total: onboardingPlans.length,
        byStatus: countBy(onboardingPlans, (item) => item.status),
        active: activeOnboardingPlan,
        recent: onboardingPlans.slice(-5)
      },
      nodes: { total: nodes.length, byType: countBy(nodes, (item) => item.type) },
      testIntents: { total: testIntents.length, byStatus: countBy(testIntents, (item) => item.status) },
      executableCases: {
        total: executableCases.length,
        byStatus: countBy(executableCases, (item) => item.status),
        dataPlans: {
          byVerdict: countBy(
            executableCases.flatMap((item) => item.dataPlan ? [item.dataPlan] : []),
            (item) => item.verdict
          ),
          blocked: blockedDataPlans.map((item) => ({
            executableCaseId: item.id,
            reasons: item.dataPlan?.reasons ?? []
          }))
        }
      },
      compilation: {
        compileRuns: {
          total: projectCompileRuns.length,
          recent: projectCompileRuns
            .slice(-5)
            .map(compileRunSummary)
        },
        explorationTasks: {
          total: explorationTasks.length,
          pending: pendingExplorationTasks.length,
          byStatus: countBy(explorationTasks, (item) => item.status),
          recent: explorationTasks.slice(-5)
        },
        explorationPlans: {
          total: explorationPlans.length,
          byStatus: countBy(explorationPlans, (item) => item.status),
          active: activeExplorationPlan,
          recent: explorationPlans.slice(-5)
        }
      },
      executionEvidence: {
        total: executionEvidence.length,
        byStatus: countBy(executionEvidence, (item) => item.status)
      },
      executionPlans: {
        total: executionPlans.length,
        recent: executionPlans.slice(-5)
      },
      requirementSuiteRuns: {
        total: requirementSuiteRuns.length,
        byStatus: countBy(requirementSuiteRuns, (item) => item.status),
        stability,
        active: activeRequirementSuiteRun,
        recent: requirementSuiteRuns.slice(-5)
      },
      runLedger: {
        total: runLedgerEntries.length,
        activeSummary:
          activeRequirementSuiteRun &&
          runLedgerEntries.some(
            (entry) =>
              entry.requirementSuiteRunId === activeRequirementSuiteRun.id
          )
          ? context.runLedger.summary(activeRequirementSuiteRun.id)
          : undefined,
        recent: runLedgerEntries.slice(-20)
      },
      executionDiagnoses: {
        ...context.executionDiagnosis.summary({
          knowledgeProjectId: projectId
        }),
        recent: executionDiagnoses.slice(-10),
        legacyAudit: legacyDiagnosisAudit.summary,
        legacyReviews: aggregateLegacyDiagnosisReviewSummary(
          context,
          project.systemIds
        ),
        humanAdjudicationEval:
          context.executionDiagnosis.legacyReviewEvalForSystems(
            project.systemIds
          )
      },
      testData: {
        tasks: {
          total: testDataTasks.length,
          byStatus: countBy(testDataTasks, (item) => item.status),
          pending: pendingTestDataTasks
        },
        leases: {
          total: testDataLeases.length,
          byStatus: countBy(testDataLeases, (item) => item.status),
          cleanupDue
        }
      },
      scenarios: {
        total: context.repository.businessScenarios.filter(
          (scenario) => scenario.knowledgeProjectId === projectId
        ).length,
        assurance: countBy(
          context.repository.scenarioAssuranceContracts.filter((contract) =>
            context.repository.businessScenarios.some(
              (scenario) => scenario.id === contract.scenarioId && scenario.knowledgeProjectId === projectId
            )
          ),
          (contract) => contract.verdict
        ),
        trust: countBy(
          context.repository.scenarioTrustRecords.filter((record) =>
            context.repository.businessScenarios.some(
              (scenario) => scenario.id === record.scenarioId && scenario.knowledgeProjectId === projectId
            )
          ),
          (record) => record.status
        )
      },
      requirementEvalHistory: context.knowledgeService.requirementEvalAccuracy(projectId),
      explorations: {
        total: explorations.length,
        byStatus: countBy(explorations, (item) => item.status),
        running: runningExplorations,
        unresolved: unresolvedExplorations,
        recent: explorations.slice(-5)
      },
      systemBrains,
      openGaps: gaps,
      brainRuntime: brainRuntimeStatus(
        context,
        project.systemIds.length === 1 ? project.systemIds[0] : undefined,
        projectId
      ),
      executionTasks
    },
    evaluationIntegrity: {
      total: evaluationTrials.length,
      active: evaluationTrials.filter((item) => item.status === "active").length,
      invalidated: evaluationTrials.filter((item) => item.status === "invalidated").length,
      completed: evaluationTrials.filter((item) => item.status === "completed").length,
      activeTrialIds: evaluationTrials
        .filter((item) => item.status === "active")
        .map((item) => item.id)
    },
    connectors: connectorStatus(context, projectId),
    executionTasks,
    latestCompileRunId: projectCompileRuns.at(-1)?.id,
    activeExplorationTaskId: pendingExplorationTasks.at(-1)?.id,
    activeExplorationPlanId: activeExplorationPlan?.id,
    activeOnboardingPlanId: activeOnboardingPlan?.id,
    nextAction,
    ...(nextAction === "review_gaps" ? {
      nextFacadeTool: "bc_review",
      nextToolInput: { target: "gap", knowledgeProjectId: projectId },
      nextCommand: `bc_review target=gap knowledgeProjectId=${projectId}`
    } : nextAction === "review_requirement_attachments" ? {
      nextFacadeTool: "bc_review",
      nextToolInput: {
        target: "source-fidelity",
        knowledgeProjectId: projectId,
        requirementSourceId: unconfirmedAttachmentSources[0]!.id
      },
      nextCommand: `bc_review target=source-fidelity knowledgeProjectId=${projectId} requirementSourceId=${unconfirmedAttachmentSources[0]!.id}`
    } : {})
  };
}

export async function knowledgeReview(
  context: BrainCreatorMcpContext,
  projectId: string,
  target: KnowledgeReviewTarget,
  idValue?: string,
  limit = 50,
  minSampleSize = 20,
  offset = 0,
  input: Record<string, unknown> = {}
) {
  const status = knowledgeStatus(context, projectId);
  const project = status.knowledge.project;
  if (target === "evaluation-trial") {
    const trials = context.evaluationIntegrity
      .list({
        knowledgeProjectId: projectId,
        comparisonGroupId: optionalStringArg(input, "comparisonGroupId")
      })
      .filter((item) => !idValue || item.id === idValue);
    const items = [];
    const evidenceAuthenticator = createWorkspaceIntegrityAuthenticator(context.workDir);
    for (const trial of trials) {
      const validation = context.evaluationIntegrity.validateTrial(trial.id, {
        codeRevision: trial.codeRevision, runtimeVersions: trial.runtimeVersions,
        runtimeBuildIdentity: evaluationRuntimeBuildIdentity(context)
      }, false);
      const linkedRuns = context.repository.requirementSuiteRuns.filter((run) => isLinkedEvaluationRun(run, trial));
      const linkedRunIds = new Set(linkedRuns.map((run) => run.id));
      const linkedRunEntries = context.repository.runLedgerEntries.filter((entry) =>
        entry.requirementSuiteRunId && linkedRunIds.has(entry.requirementSuiteRunId) &&
        entry.runType !== "document-suite"
      );
      const runLedgerIntegrityByEntryId = verifyRunLedgerIntegrityChains(linkedRunEntries, evidenceAuthenticator);
      const runLedgerIntegrity = linkedRuns.map((run) => {
        const entries = linkedRunEntries.filter((entry) => entry.requirementSuiteRunId === run.id)
          .sort((left, right) => (left.sequence ?? Number.MAX_SAFE_INTEGER) - (right.sequence ?? Number.MAX_SAFE_INTEGER));
        const terminal = ["completed", "failed", "blocked", "cancelled"].includes(run.status);
        const latest = entries.at(-1);
        const terminalEvent = run.status === "cancelled" ? "suite-cancelled" : "suite-completed";
        const terminalEventValid = !terminal ||
          (latest?.event === terminalEvent && latest.toStatus === run.status);
        const valid = entries.length > 0 && terminalEventValid && entries.every((entry) => runLedgerIntegrityByEntryId.get(entry.id) === true);
        return {
          runId: run.id,
          status: valid ? "valid" as const : "invalid" as const,
          reason: valid ? undefined : !terminalEventValid
            ? "Terminal run is missing its signed final suite-completed event."
            : "Run Ledger signature chain is incomplete or invalid."
        };
      });
      const runLedgerIntegrityByRunId = new Map(runLedgerIntegrity.map((item) => [item.runId, item.status === "valid"]));
      const linkedReconciledActions = linkedRunEntries.filter((entry) =>
        entry.event === "action-reconciled" && entry.actionPhase === "reconciled" &&
        entry.knowledgeProjectId === trial.knowledgeProjectId &&
        entry.systemId === trial.systemId
      );
      const actionIntegrityValidByEntryId = new Map(linkedReconciledActions.map((entry) => [
        entry.id,
        runLedgerIntegrityByEntryId.get(entry.id) === true &&
          runLedgerIntegrityByRunId.get(entry.requirementSuiteRunId!) === true
      ]));
      const actionEvidenceArtifactRevalidation = await revalidateRunLedgerActionEvidence(
        join(context.workDir, ".brain-creator"),
        linkedReconciledActions
      );
      const actionEvidenceArtifactsValidByEntryId = new Map(
        actionEvidenceArtifactRevalidation.map((item) => [
          item.entryId,
          item.validation.status === "valid" && actionIntegrityValidByEntryId.get(item.entryId) === true
        ])
      );
      const linkedEvidenceIds = new Set(linkedRuns.flatMap((run) => run.caseRuns.flatMap((caseRun) => [
        ...(caseRun.executionEvidenceId ? [caseRun.executionEvidenceId] : []),
        ...caseRun.attempts.flatMap((attempt) => attempt.executionEvidenceId ? [attempt.executionEvidenceId] : [])
      ])));
      const linkedEvidence = context.repository.executionEvidence.filter((evidence) => linkedEvidenceIds.has(evidence.id));
      const artifactRevalidation = await revalidateExecutionEvidence(context.workDir, linkedEvidence);
      const artifactValidationByEvidenceId = new Map(artifactRevalidation.map((item) => [item.evidenceId, item.validation]));
      const conformanceByEvidenceId = new Map(context.repository.conformanceResults
        .filter((item) => linkedEvidenceIds.has(item.executionEvidenceId))
        .map((item) => [item.executionEvidenceId, item]));
      const semanticSnapshotRevalidation = linkedEvidence.map((evidence) => {
        const valid = hasValidExecutionEvidenceSnapshot(
          evidence,
          conformanceByEvidenceId.get(evidence.id),
          evidenceAuthenticator
        );
        return {
          evidenceId: evidence.id,
          status: valid ? "valid" as const : "invalid" as const,
          reasons: valid ? [] : [evidence.semanticSnapshotHash ? "Execution evidence semantics changed after completion." : "Execution evidence has no semantic snapshot hash."]
        };
      });
      const semanticSnapshotValidByEvidenceId = new Map(semanticSnapshotRevalidation.map((item) => [item.evidenceId, item.status === "valid"]));
      const interventionIntegrity = context.evaluationIntegrity.reviewInterventionIntegrity(trial.id);
      items.push({
      ...trial,
      validation: { valid: validation.valid, reasons: validation.reasons },
      approvalReadiness: trial.executionScope?.approvalScopeRef && validation.valid ? "verified-baseline-receipt" : "unverified",
      sourceSnapshot: context.repository.sourceSnapshots.find(
        (item) => item.id === trial.sourceSnapshotId
      ),
      projectionManifests: context.repository.projectionManifests.filter(
        (item) => item.trialId === trial.id
      ),
      interventions: context.repository.interventionRecords.filter(
        (item) => item.trialId === trial.id
      ),
      artifactRevalidation,
      actionEvidenceArtifactRevalidation: actionEvidenceArtifactRevalidation.map((item) => ({
        entryId: item.entryId,
        status: item.validation.status === "valid" && actionIntegrityValidByEntryId.get(item.entryId) === true ? "valid" : "invalid",
        integrityStatus: actionIntegrityValidByEntryId.get(item.entryId) === true ? "valid" : "invalid",
        reasons: [
          ...item.validation.reasons,
          ...(actionIntegrityValidByEntryId.get(item.entryId) === true ? [] : ["Run Ledger action integrity signature is missing or invalid."])
        ]
      })),
      runLedgerIntegrity,
      semanticSnapshotRevalidation,
      historicalReevaluations: linkedEvidence.flatMap((evidence) => evidence.historicalReevaluation
        ? [{ evidenceId: evidence.id, ...evidence.historicalReevaluation }]
        : []),
      interventionIntegrity: {
        capture: !trial.interventionCapture
          ? "missing"
          : !interventionIntegrity.captureIntegrityValid
            ? "invalid"
            : interventionIntegrity.interventionSetMatchesCapture ? "valid" : "stale",
        recordSetMatchesCapture: interventionIntegrity.interventionSetMatchesCapture,
        unrecordedInterventionSourceRefs: interventionIntegrity.unrecordedInterventionSourceRefs,
        records: [...interventionIntegrity.interventionValidById].map(([interventionId, valid]) => ({
          interventionId,
          status: valid ? "valid" : "invalid"
        }))
      },
      metrics: calculateEvaluationTrialMetrics({
        trial: validation.valid ? trial : { ...trial, status: "invalidated" },
        runs: context.repository.requirementSuiteRuns,
        evidence: context.repository.executionEvidence,
        conformanceResults: context.repository.conformanceResults,
        scenarios: context.repository.businessScenarios.filter(
          (item) => item.knowledgeProjectId === projectId
        ),
        testIntents: context.repository.testIntents.filter(
          (item) => item.knowledgeProjectId === projectId
        ),
        executableCases: context.repository.executableCases,
        interventions: context.repository.interventionRecords,
        runLedgerEntries: context.repository.runLedgerEntries,
        testDataTasks: context.repository.testDataTasks,
        testDataLeases: context.repository.testDataLeases,
        actionEvidenceArtifactsValidByEntryId,
        artifactValidationByEvidenceId,
        semanticSnapshotValidByEvidenceId,
        interventionIntegrityValidById: interventionIntegrity.interventionValidById,
        interventionCaptureIntegrityValid: interventionIntegrity.captureIntegrityValid,
        interventionSourcesComplete: interventionIntegrity.interventionSourcesComplete
      })
      });
    }
    return {
      project,
      summary: {
        total: items.length,
        active: items.filter((item) => item.status === "active").length,
        invalidated: items.filter((item) => item.status === "invalidated").length,
        completed: items.filter((item) => item.status === "completed").length,
        trials: items.map((item) => ({ id: item.id, metrics: item.metrics, approvalReadiness: item.approvalReadiness, validation: item.validation }))
      },
      ...paginateReviewItems(items, input)
    };
  }
  if (target === "compile-run") {
    const matchingRuns = context.repository.compileRuns
      .filter(
        (item) =>
          item.knowledgeProjectId === projectId && (!idValue || item.id === idValue)
      );
    const selectedRuns = idValue
      ? matchingRuns
      : matchingRuns.slice(offset, offset + limit);
    const itemOffset = idValue ? offset : 0;
    const runs = selectedRuns
      .map((run) => ({
        ...compileRunSummary(run),
        requirementSetId: run.requirementSetId,
        systemId: run.systemId,
        createdAt: run.createdAt,
        items: run.items.slice(itemOffset, itemOffset + limit),
        explorationTasks: context.repository.explorationTasks.filter((task) =>
          run.items.some((item) => item.explorationTaskIds?.includes(task.id))
        ),
        totalItems: run.items.length,
        returnedItems: Math.min(Math.max(run.items.length - itemOffset, 0), limit),
        nextItemOffset:
          itemOffset + limit < run.items.length ? itemOffset + limit : undefined
      }));
    return {
      project,
      items: runs,
      totalRuns: matchingRuns.length,
      offset,
      nextOffset:
        !idValue && offset + runs.length < matchingRuns.length
          ? offset + runs.length
          : undefined
    };
  }
  if (target === "semantic-binding") {
    const requestedSystemId = optionalStringArg(input, "systemId");
    const requestedRequirementSetId = optionalStringArg(input, "requirementSetId");
    const items = context.repository.semanticBindings.filter(
      (item) =>
        (!idValue || item.id === idValue) &&
        (!requestedSystemId || item.systemId === requestedSystemId) &&
        (!requestedRequirementSetId || item.requirementSetId === requestedRequirementSetId) &&
        context.repository.requirementSets.some(
          (requirementSet) =>
            requirementSet.id === item.requirementSetId &&
            requirementSet.knowledgeProjectId === projectId
        )
    );
    return {
      project,
      summary: {
        total: items.length,
        confirmed: items.filter((item) => item.status === "confirmed").length,
        candidates: items.filter((item) => item.status === "candidate").length,
        stale: items.filter((item) => item.status === "stale").length,
        conflicted: items.filter((item) => item.status === "conflicted").length
      },
      ...paginateReviewItems(items, input)
    };
  }
  if (target === "business-scenario") {
    const items = context.knowledgeService
      .listBusinessScenarios({
        knowledgeProjectId: projectId,
        requirementSetId: optionalStringArg(input, "requirementSetId"),
        systemId: optionalStringArg(input, "systemId")
      })
      .filter((item) => !idValue || item.id === idValue);
    return {
      project,
      summary: {
        total: items.length,
        byFamily: countBy(items, (item) => item.family),
        byStatus: countBy(items, (item) => item.status)
      },
      ...paginateReviewItems(items, input)
    };
  }
  if (target === "scenario-assurance") {
    const items = context.knowledgeService.listScenarioAssurance({
      knowledgeProjectId: projectId,
      requirementSetId: optionalStringArg(input, "requirementSetId"),
      systemId: optionalStringArg(input, "systemId"),
      scenarioId: idValue
    });
    return {
      project,
      summary: {
        total: items.length,
        byVerdict: countBy(items, (item) => item.verdict),
        byBinding: countBy(items, (item) => item.systemBinding),
        byOracle: countBy(items, (item) => item.oracleStrength)
      },
      ...paginateReviewItems(items, input)
    };
  }
  if (target === "scenario-trust") {
    const items = context.knowledgeService.listScenarioTrust({
      knowledgeProjectId: projectId,
      requirementSetId: optionalStringArg(input, "requirementSetId"),
      scenarioId: idValue
    });
    return {
      project,
      summary: {
        total: items.length,
        byStatus: countBy(items, (item) => item.status),
        trusted: items.filter((item) => item.status === "trusted").length
      },
      ...paginateReviewItems(items, input)
    };
  }
  if (target === "conformance") {
    const items = context.knowledgeService.listConformanceResults({
      knowledgeProjectId: projectId,
      systemId: optionalStringArg(input, "systemId"),
      requirementSetId: optionalStringArg(input, "requirementSetId"),
      scenarioId: idValue,
      verdict: optionalStringArg(input, "status")
    });
    return {
      project,
      summary: {
        total: items.length,
        byVerdict: countBy(items, (item) => item.verdict),
        conform: items.filter((item) => item.verdict === "conform").length,
        inconclusive: items.filter((item) => item.verdict === "inconclusive").length
      },
      ...paginateReviewItems(items, input)
    };
  }
  if (target === "stage-eval") {
    const requirementSetIds = new Set(
      context.repository.requirementSets
        .filter((item) => item.knowledgeProjectId === projectId)
        .filter((item) => !optionalStringArg(input, "requirementSetId") || item.id === optionalStringArg(input, "requirementSetId"))
        .map((item) => item.id)
    );
    const items = context.requirementGate.list({
      requirementSetId: optionalStringArg(input, "requirementSetId"),
      stage: optionalStringArg(input, "stage"),
      status: optionalStringArg(input, "status") as "current" | "stale" | undefined
    }).filter((item) => requirementSetIds.has(item.subjectRefs
      .find((ref) => ref.startsWith("requirement-set:"))?.slice("requirement-set:".length) ?? ""));
    return {
      project,
      summary: {
        total: items.length,
        current: items.filter((item) => item.status === "current").length,
        stale: items.filter((item) => item.status === "stale").length,
        byStage: countBy(items, (item) => item.stage),
        byVerdict: countBy(items, (item) => item.verdict)
      },
      ...paginateReviewItems(items, input)
    };
  }
  if (target === "approval") {
    const requirementSetIds = new Set(
      context.repository.requirementSets
        .filter((item) => item.knowledgeProjectId === projectId)
        .filter((item) => !optionalStringArg(input, "requirementSetId") || item.id === optionalStringArg(input, "requirementSetId"))
        .map((item) => item.id)
    );
    const items = context.repository.approvalReceipts
      .filter((receipt) => receipt.assetRefs.some((ref) => requirementSetIds.has(ref.replace("requirement-set:", ""))))
      .filter((receipt) => !idValue || receipt.id === idValue);
    return {
      project,
      summary: { total: items.length, byMethod: countBy(items, (item) => item.method) },
      ...paginateReviewItems(items, input)
    };
  }
  if (target === "source-fidelity") {
    const sources = context.repository.requirementSources.filter(
      (item) => item.knowledgeProjectId === projectId
    ).filter((item) => !optionalStringArg(input, "requirementSourceId") || item.id === optionalStringArg(input, "requirementSourceId"));
    const items = sources.map((source) => ({
      sourceId: source.id,
      title: source.title,
      sourceType: source.sourceType,
      revision: source.revision,
      contentHash: source.contentHash,
      blockCount: source.blocks.length,
      attachmentCount: source.attachments.length,
      attachments: source.attachments.map((attachment) => ({
        id: attachment.id,
        name: attachment.name,
        status: attachment.status,
        analysis: context.repository.attachmentAnalyses.find((item) => item.attachmentId === attachment.id)
      })),
      warnings: source.warnings,
      accessStatus: source.accessStatus
    })).filter((item) => !idValue || item.sourceId === idValue);
    return {
      project,
      summary: {
        total: items.length,
        withWarnings: items.filter((item) => item.warnings.length > 0).length,
        attachments: items.reduce((sum, item) => sum + item.attachmentCount, 0),
        analyzedAttachments: items.reduce((sum, item) => sum + item.attachments.filter((attachment) => attachment.analysis).length, 0)
      },
      ...paginateReviewItems(items, input)
    };
  }
  if (target === "requirement") {
    const items = context.repository.requirementSets.filter(
      (item) => item.knowledgeProjectId === projectId && (!idValue || item.id === idValue)
    );
    return {
      project,
      ...paginateReviewItems(items, input),
      impacts: items.map((item) => context.knowledgeService.requirementImpact(item.id))
    };
  }
  if (target === "test-intent") {
    const requestedRequirementSetId = optionalStringArg(input, "requirementSetId");
    const requestedSetBelongsToProject = !requestedRequirementSetId ||
      context.repository.requirementSets.some(
        (item) => item.id === requestedRequirementSetId && item.knowledgeProjectId === projectId
      );
    const items = context.knowledgeService
      .listTestIntents(projectId)
      .filter((item) => !requestedRequirementSetId || (
        requestedSetBelongsToProject && item.requirementSetId === requestedRequirementSetId
      ))
      .filter((item) => !idValue || item.id === idValue);
    return {
      project,
      ...paginateReviewItems(items, input)
    };
  }
  if (target === "executable-case") {
    const items = context.knowledgeService
      .listExecutableCases(projectId)
      .filter((item) => !idValue || item.id === idValue);
    return {
      project,
      ...paginateReviewItems(items, input)
    };
  }
  if (target === "case-dependency") {
    const requestedSystemId = optionalStringArg(input, "systemId");
    if (requestedSystemId && !project.systemIds.includes(requestedSystemId)) {
      throw new Error("Requested dependency graph system is not bound to the knowledge project");
    }
    const requirementSets = context.repository.requirementSets.filter(
      (item) =>
        item.knowledgeProjectId === projectId &&
        (!optionalStringArg(input, "requirementSetId") ||
          item.id === optionalStringArg(input, "requirementSetId")) &&
        (!idValue || item.id === idValue)
    );
    const systemIds: Array<string | undefined> = requestedSystemId
      ? [requestedSystemId]
      : project.systemIds.length > 0
        ? project.systemIds
        : [undefined];
    const graphs = requirementSets.flatMap((requirementSet) =>
      systemIds.map((systemId) =>
        buildCaseDependencyGraph({
          requirementSetId: requirementSet.id,
          ...(systemId ? { systemId } : {}),
          intents: context.repository.testIntents,
          executableCases: context.repository.executableCases
        })
      )
    );
    return {
      project,
      ...paginateReviewItems(graphs, input)
    };
  }
  if (target === "execution-plan") {
    const items = context.repository.executionPlans.filter(
      (item) =>
        item.knowledgeProjectId === projectId &&
        (!idValue || item.id === idValue)
    );
    return {
      project,
      ...paginateReviewItems(items, input)
    };
  }
  if (target === "requirement-suite-run") {
    const items = context.requirementSuiteRuns
      .list(projectId)
      .filter((item) => !idValue || item.id === idValue)
      .map((item) => ({
        ...item,
        reconciliation: requirementSuiteReconciliation(context, item)
      }));
    const reviewSummary = requirementSuiteRunCollectionSummary(items);
    return {
      project,
      ...paginateReviewItems(items, input),
      reviewSummary
    };
  }
  if (target === "run-ledger") {
    const entries = context.runLedger
      .list({ knowledgeProjectId: projectId })
      .filter(
        (entry) => !idValue || entry.requirementSuiteRunId === idValue
      );
    const runIds = [...new Set(
      entries.flatMap((entry) =>
        entry.requirementSuiteRunId ? [entry.requirementSuiteRunId] : []
      )
    )];
    const summaries = runIds.map((runId) => context.runLedger.summary(runId));
    const pagedEntries = paginateReviewItems(entries, input);
    const pagedSummaries = paginateReviewItems(summaries, input);
    return {
      project,
      summaries: pagedSummaries.items,
      entries: pagedEntries.items,
      ...(pagedEntries.totalItems === undefined
        ? {}
        : {
            summaryPage: pagedSummaries,
            entryPage: pagedEntries
          })
    };
  }
  if (target === "execution-diagnosis") {
    const diagnosisEval = context.executionDiagnosis.legacyReviewEvalForSystems(
      project.systemIds,
      minSampleSize
    );
    const items = context.executionDiagnosis
      .list({ knowledgeProjectId: projectId })
      .filter((item) => !idValue || item.id === idValue);
    const diagnosisSummary = context.executionDiagnosis.summary({
      knowledgeProjectId: projectId
    });
    return {
      project,
      summary: diagnosisSummary,
      items,
      legacyAudit: aggregateLegacyDiagnosisAudit(
        context,
        project.systemIds,
        limit
      ),
      legacyReviews: project.systemIds.flatMap((systemId) =>
        context.executionDiagnosis.listLegacyReviews(systemId)
      ),
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
      evalMarkdown: legacyDiagnosisEvalMarkdown(diagnosisEval)
    };
  }
  if (target === "coverage") {
    const requestedSystemId = optionalStringArg(input, "systemId");
    const intents = context.knowledgeService.listTestIntents(projectId);
    const sets = context.repository.requirementSets.filter(
      (item) => item.knowledgeProjectId === projectId && item.status !== "superseded"
    );
    const executionLedger = context.knowledgeService.testIntentCoverage(projectId, requestedSystemId);
    const requirementSetIds = new Set(sets.map((item) => item.id));
    const processCoverageProfiles = context.repository.requirementCoverageProfiles.filter(
      (item) => requirementSetIds.has(item.requirementSetId)
    );
    const requestedLimit = optionalNumberArg(input, "limit");
    const requestedOffset = optionalNumberArg(input, "offset") ?? 0;
    const nextOffset = requestedLimit !== undefined &&
      requestedOffset + requestedLimit < executionLedger.items.length
      ? requestedOffset + requestedLimit
      : undefined;
    const pagedLedger = requestedLimit === undefined
      ? executionLedger
      : {
          ...executionLedger,
          items: executionLedger.items.slice(requestedOffset, requestedOffset + requestedLimit),
          totalItems: executionLedger.items.length,
          returnedItems: Math.min(
            Math.max(executionLedger.items.length - requestedOffset, 0),
            requestedLimit
          ),
          offset: requestedOffset,
          nextOffset
        };
    return {
      project,
      ...(requestedSystemId ? { systemId: requestedSystemId } : {}),
      requirements: sets.length,
      coveredRequirements: new Set(intents.map((item) => item.requirementSetId)).size,
      traceableIntents: intents.filter(
        (item) => item.requirementRefs.length > 0 && item.knowledgeNodeRefs.length > 0
      ).length,
      totalIntents: intents.length,
      executionLedger: pagedLedger,
      dimensionSummary: summarizeCoverageDimensions(
        executionLedger.items
      ),
      requirementCoverageProfiles: processCoverageProfiles,
      processModels: {
        workflows: context.repository.workflowModels.filter(
          (item) => requirementSetIds.has(item.requirementSetId)
        ),
        stateMachines: context.repository.stateMachineModels.filter(
          (item) => requirementSetIds.has(item.requirementSetId)
        )
      },
      sourceLedger: context.knowledgeService.requirementSourceLedger(projectId),
      ...(requestedLimit === undefined
        ? {}
        : {
            itemPage: {
              limit: requestedLimit,
              offset: requestedOffset,
              total: executionLedger.items.length,
              nextOffset
            }
          })
    };
  }
  if (target === "requirement-eval-accuracy") {
    return {
      project,
      accuracy: context.knowledgeService.requirementEvalAccuracy(projectId, idValue)
    };
  }
  if (target === "testdata") {
    const requestedSystemId = optionalStringArg(input, "systemId");
    if (requestedSystemId && !project.systemIds.includes(requestedSystemId)) {
      throw new Error("Requested test data system is not bound to the knowledge project");
    }
    const systemIds = requestedSystemId ? [requestedSystemId] : project.systemIds;
    const systems = systemIds.map((systemId) => {
      const graph = context.testDataBrain.graph(systemId, projectId);
      return {
        systemId,
        entities: graph.entities,
        dependencies: graph.dependencies
      };
    });
    const scenarioPlans = context.repository.businessScenarios
      .filter((scenario) =>
        scenario.knowledgeProjectId === projectId &&
        (!requestedSystemId ||
          scenario.dataPlans?.some((plan) => plan.systemId === requestedSystemId) ||
          scenario.dataPlan?.systemId === requestedSystemId)
      )
      .flatMap((scenario) => {
        const plans = scenario.dataPlans?.length
          ? scenario.dataPlans
          : scenario.dataPlan
            ? [scenario.dataPlan]
            : [];
        return plans
          .filter((plan) => !requestedSystemId || plan.systemId === requestedSystemId)
          .map((plan) => ({
            scenarioId: scenario.id,
            title: scenario.title,
            plan
          }));
      });
    return {
      project,
      systems,
      scenarioPlans,
      totals: {
        entities: systems.reduce((total, item) => total + item.entities.length, 0),
        dependencies: systems.reduce((total, item) => total + item.dependencies.length, 0)
      }
    };
  }
  if (target === "system-brain") {
    if (!idValue) throw new Error("systemId is required to review System Brain");
    const view = optionalStringArg(input, "view") ?? "current";
    const snapshots = context.systemBrainSnapshots.history(idValue);
    const pageIdentities = context.repository.systemPageIdentities
      .filter((identity) => identity.systemId === idValue)
      .sort((left, right) => left.identityKey.localeCompare(right.identityKey));
    if (view === "history") {
      return {
        project,
        systemId: idValue,
        snapshots,
        pageIdentities
      };
    }
    if (view === "diff") {
      const fromSnapshotId = stringArg(input, "fromSnapshotId");
      const toSnapshotId = stringArg(input, "toSnapshotId");
      return {
        project,
        systemId: idValue,
        diff: context.systemBrainSnapshots.diff(idValue, fromSnapshotId, toSnapshotId),
        pageIdentities
      };
    }
    return {
      project,
      brain: context.knowledgeService.getSystemBrain(projectId, idValue),
      pageIdentities,
      snapshot:
        context.systemBrainSnapshots.latest(idValue) ??
        context.systemBrainSnapshots.latest(idValue, "candidate"),
      latestChangeSet: context.repository.systemBrainChangeSets
        .filter((changeSet) => changeSet.systemId === idValue)
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0]
    };
  }
  if (target === "system-exploration") {
    const items = context.systemExploration
      .list(projectId)
      .filter((item) => !idValue || item.id === idValue);
    return {
      project,
      ...paginateReviewItems(items, input)
    };
  }
  if (target === "onboarding-plan") {
    const items = context.onboardingPlans
      .list({
        systemId: optionalStringArg(input, "systemId"),
        requirementSetId: optionalStringArg(input, "requirementSetId")
      })
      .filter(
        (item) =>
          item.knowledgeProjectId === projectId &&
          (!idValue || item.id === idValue)
      );
    return {
      project,
      ...paginateReviewItems(items, input)
    };
  }
  if (target === "exploration-plan") {
    const items = context.statefulExplorationPlans
      .list({ requirementSetId: optionalStringArg(input, "requirementSetId") })
      .filter(
        (item) =>
          item.knowledgeProjectId === projectId &&
          (!idValue || item.id === idValue)
      );
    return {
      project,
      ...paginateReviewItems(items, input)
    };
  }
  if (target === "evidence") {
    const executionEvidence = context.knowledgeService.listExecutionEvidence(projectId);
    const artifacts = project.systemIds.flatMap((systemId) => [
      ...context.service.listTestSpecs(systemId),
      ...context.service.listTestFiles(systemId),
      ...context.service.listChainRuns(systemId)
    ]);
    const pagedEvidence = paginateReviewItems(executionEvidence, input);
    const pagedArtifacts = paginateReviewItems(artifacts, input);
    return {
      project,
      systems: project.systemIds,
      executionEvidence: pagedEvidence.items,
      artifacts: pagedArtifacts.items,
      ...(pagedEvidence.totalItems === undefined
        ? {}
        : {
            executionEvidencePage: pagedEvidence,
            artifactPage: pagedArtifacts
          })
    };
  }
  return { ...status.knowledge };
}

export function paginateReviewItems<T>(items: T[], input: Record<string, unknown>) {
  const limit = optionalNumberArg(input, "limit");
  if (limit === undefined) return { items };
  const offset = optionalNumberArg(input, "offset") ?? 0;
  const page = items.slice(offset, offset + limit);
  return {
    items: page,
    totalItems: items.length,
    returnedItems: page.length,
    offset,
    nextOffset: offset + page.length < items.length ? offset + page.length : undefined
  };
}

export function connectorStatus(context?: BrainCreatorMcpContext, projectId?: string) {
  const directConfigured = Boolean(
    process.env.BRAIN_CREATOR_FEISHU_APP_ID && process.env.BRAIN_CREATOR_FEISHU_APP_SECRET
  );
  const recentSource = context?.repository.requirementSources
    .filter((source) => source.sourceType === "feishu")
    .filter((source) => !projectId || source.knowledgeProjectId === projectId)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
  return {
    feishu: {
      hostMode: "available-via-content-package",
      directMode: directConfigured ? "configured" : "not-configured",
      readMode: directConfigured ? "openapi-with-host-fallback" : "host-content-package",
      credentialStorage: "environment-reference-only",
      lastSyncedAt: recentSource?.updatedAt,
      lastSourceId: recentSource?.id
    }
  };
}

export async function sessionResume(context: BrainCreatorMcpContext, input: Record<string, unknown>) {
  const systemId = stringArg(input, "systemId");
  const system = context.repository.systemProfiles.find((item) => item.id === systemId);
  if (!system) {
    throw new Error("Business system not found");
  }

  const authProfiles = context.service.listAuthProfiles(systemId);
  const authCheckpoints = context.service.listAuthCheckpoints(systemId);
  const rules = context.service.listBusinessRules(systemId);
  const terms = context.service.listGlossaryTerms({ projectId: systemId, query: "" });
  const cases = context.service.listTestCases(systemId);
  const agentRuns = context.service.listAgentRuns(systemId);
  const chainRuns = context.service.listChainRuns(systemId);
  const openGaps = context.service.listGaps({ projectId: systemId, status: "open" });
  const specs = context.service.listTestSpecs(systemId);
  const tests = context.service.listTestFiles(systemId);
  const bridgeStatus = await preflightAgentBridge(context.agentBridge);

  const caseCounts = { draft: 0, approved: 0, generating: 0, passed: 0, failed: 0, cancelled: 0 };
  for (const item of cases) {
    caseCounts[item.status] += 1;
  }

  const nextAction = computeNextAction({
    hasAuth: authProfiles.length > 0,
    hasAwaitingAuth: authCheckpoints.some((checkpoint) => checkpoint.status === "awaiting-user"),
    hasRules: rules.length > 0,
    hasApprovedCases: caseCounts.approved > 0,
    hasFailedCases: caseCounts.failed > 0,
    hasOpenGaps: openGaps.length > 0,
    bridgeOk: bridgeStatus.ok
  });

  return {
    system,
    auth: { profiles: authProfiles, checkpoints: authCheckpoints },
    rules,
    terms,
    cases: { total: cases.length, byStatus: caseCounts },
    recentRuns: {
      agentRuns: agentRuns.slice(-5),
      chainRuns: chainRuns.slice(-5)
    },
    artifacts: { specs: specs.length, tests: tests.length },
    openGaps,
    bridge: bridgeStatus,
    nextAction
  };
}

export function computeNextAction(state: {
  hasAuth: boolean;
  hasAwaitingAuth: boolean;
  hasRules: boolean;
  hasApprovedCases: boolean;
  hasFailedCases: boolean;
  hasOpenGaps: boolean;
  bridgeOk: boolean;
}): string {
  if (!state.hasAuth) {
    return "complete_onboarding: 配置鉴权 (bc_create_auth)";
  }
  if (state.hasAwaitingAuth) {
    return "complete_auth_checkpoint: complete the pending manual authentication step";
  }
  if (!state.bridgeOk) {
    return "configure_bridge: 设置 BRAIN_CREATOR_AGENT_COMMAND 环境变量以启用 Planner/Generator/Healer";
  }
  if (state.hasOpenGaps) {
    return "resolve_gaps: 存在待处理的 Gap，先用 bc_review target=gap 检查，再通过 bc_prepare action=resolve-gap 预览并提交含 evidenceRefs 的确认。";
  }
  if (state.hasFailedCases) {
    return "review_failures: 存在失败用例，建议复盘或 healer 修复 (bc_review / bc_run_agent healer)";
  }
  if (state.hasApprovedCases) {
    return "run_chain: 已批准用例等待执行 (bc_run_chain)";
  }
  return "generate_plan: 系统就绪，可以生成新测试计划 (bc_generate_plan)";
}

export function uniqueStrings(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

export function unfinishedCaseSuites(context: BrainCreatorMcpContext, systemId: string) {
  const sourcesById = new Map(context.service.listCaseSources(systemId).map((source) => [source.id, source]));
  return context.service
    .listCaseSuites(systemId)
    .filter((suite) => suite.status !== "completed" && suite.status !== "cancelled")
    .map((suite) => {
      const progress = caseSuiteExecutionSnapshot(context, suite);
      const lastRun = context.service
        .listCaseSuiteRuns(systemId)
        .filter((run) => run.suiteId === suite.id)
        .at(-1);
      return {
        suiteId: suite.id,
        sourceId: suite.sourceId,
        source: sourcesById.get(suite.sourceId)?.source,
        status: suite.status,
        totalCases: suite.totalCases,
        reportPath: suite.reportPath,
        ...progress,
        lastRunId: lastRun?.id,
        updatedAt: suite.updatedAt
      };
    })
    .filter((suite) => suite.remainingCaseNos.length > 0 && suite.source)
    .sort((left, right) => left.updatedAt.localeCompare(right.updatedAt));
}

export function caseSuiteExecutionSnapshot(context: BrainCreatorMcpContext, suite: CaseSuite) {
  const latestResultByCaseNo = new Map<string, CaseSuiteCaseResult>();
  const attempted = new Set<string>();
  for (const run of context.service
    .listCaseSuiteRuns(suite.systemId)
    .filter((item) => item.suiteId === suite.id)) {
    for (const result of run.caseResults) {
      attempted.add(result.caseNo);
      const current = latestResultByCaseNo.get(result.caseNo);
      if (current?.status === "passed") {
        continue;
      }
      latestResultByCaseNo.set(result.caseNo, result);
    }
  }
  const pendingTasks = context.service
    .listAgentTasks(suite.systemId)
    .filter((task) => task.status === "pending" && task.suiteContext?.suiteId === suite.id)
    .sort((left, right) => left.updatedAt.localeCompare(right.updatedAt));
  const waitingByCaseNo = new Map(
    pendingTasks.flatMap((task) =>
      task.suiteContext ? [[task.suiteContext.caseNo, task] as const] : []
    )
  );
  const passedCaseNos: string[] = [];
  const failedCaseNos: string[] = [];
  const blockedCaseNos: string[] = [];
  const waitingCaseNos: string[] = [];
  const pendingCaseNos: string[] = [];
  for (const caseNo of suite.selectedCaseNos) {
    const result = latestResultByCaseNo.get(caseNo);
    if (result?.status === "passed") {
      passedCaseNos.push(caseNo);
    } else if (waitingByCaseNo.has(caseNo) || result?.status === "waiting-for-agent") {
      waitingCaseNos.push(caseNo);
    } else if (result?.status === "failed") {
      failedCaseNos.push(caseNo);
    } else if (result?.status === "blocked") {
      blockedCaseNos.push(caseNo);
    } else {
      pendingCaseNos.push(caseNo);
    }
  }
  const passed = new Set(passedCaseNos);
  const remainingCaseNos = suite.selectedCaseNos.filter(
    (caseNo) => !passed.has(caseNo)
  );
  const activeTask = pendingTasks.at(-1);
  return {
    attemptedCaseNos: suite.selectedCaseNos.filter((caseNo) => attempted.has(caseNo)),
    passedCaseNos,
    failedCaseNos,
    blockedCaseNos,
    waitingCaseNos,
    pendingCaseNos,
    retryableCaseNos: [...failedCaseNos, ...blockedCaseNos],
    remainingCaseNos,
    nextCaseNo:
      activeTask?.suiteContext?.caseNo ??
      waitingCaseNos[0] ??
      pendingCaseNos[0] ??
      failedCaseNos[0] ??
      blockedCaseNos[0],
    activeTask: activeTask?.suiteContext
      ? {
          taskId: activeTask.id,
          agent: activeTask.agent,
          caseNo: activeTask.suiteContext.caseNo,
          title: activeTask.suiteContext.title,
          createdAt: activeTask.createdAt
        }
      : undefined,
    stateIssues:
      suite.status === "waiting-for-agent" && pendingTasks.length === 0
        ? ["Suite is waiting for an agent, but no pending AgentTask exists."]
        : pendingTasks.length > 1
          ? [`Suite has ${pendingTasks.length} pending AgentTasks; only the latest is active.`]
          : []
  };
}

export function facadeNextAction(state: {
  bridgeOk: boolean;
  authProfiles: number;
  verifiedAuthProfiles: number;
  authProfileId?: string;
  awaitingAuthCheckpoints: number;
  pendingWriteTaskId?: string;
  stalledExecutionTaskId?: string;
  pendingAgentTasks: number;
  openBugs: number;
  openGaps: number;
  approvedCases: number;
  caseSources: number;
  unfinishedSuites: number;
}) {
  if (state.awaitingAuthCheckpoints > 0) {
    return "complete_auth_checkpoint";
  }
  if (state.pendingWriteTaskId) {
    return "reconcile_pending_write";
  }
  if (!state.bridgeOk) {
    return "configure_bridge";
  }
  if (state.authProfiles === 0) {
    return "configure_auth";
  }
  if (state.stalledExecutionTaskId) {
    return "review_stalled_task";
  }
  if (state.pendingAgentTasks > 0) {
    return "continue_case_source_suite";
  }
  if (state.openGaps > 0) {
    return "review_gaps";
  }
  if (state.unfinishedSuites > 0) {
    return "continue_case_source_suite";
  }
  if (state.verifiedAuthProfiles === 0) {
    return state.authProfileId ? "reauthenticate_auth" : "configure_auth";
  }
  if (state.openBugs > 0) {
    return "review_bugs";
  }
  if (state.approvedCases > 0) {
    return "run_approved_case";
  }
  if (state.caseSources > 0) {
    return "run_case_source_suite";
  }
  return "configure_or_generate_plan";
}

export function testReadinessForSystem(
  context: BrainCreatorMcpContext,
  systemId: string,
  input: { approvedCases: number; caseSources: number }
): TestReadiness {
  const projectIds = new Set(
    context.repository.knowledgeProjects
      .filter((project) => project.systemIds.includes(systemId))
      .map((project) => project.id)
  );
  const requirementBaselines = context.repository.requirementSets.filter(
    (requirementSet) =>
      projectIds.has(requirementSet.knowledgeProjectId) &&
      requirementSet.status !== "superseded"
  );
  const approvedRequirementBaselines = requirementBaselines.filter(
    (requirementSet) => requirementSet.status === "approved"
  );
  const confirmedSystemSnapshots = context.repository.systemBrainSnapshots.filter(
    (snapshot) => snapshot.systemId === systemId && snapshot.status === "confirmed"
  );
  const executableCases = context.repository.executableCases.filter(
    (executableCase) => executableCase.systemId === systemId
  );
  const readyExecutableCases = executableCases.filter(
    (executableCase) => executableCase.status === "ready"
  );
  const counts = {
    requirementProjects: projectIds.size,
    requirementBaselines: requirementBaselines.length,
    approvedRequirementBaselines: approvedRequirementBaselines.length,
    confirmedSystemSnapshots: confirmedSystemSnapshots.length,
    executableCases: executableCases.length,
    readyExecutableCases: readyExecutableCases.length,
    caseSources: input.caseSources
  };

  // Document suites keep a compatibility path that does not require a Requirement Brain baseline.
  if (input.caseSources > 0 || input.approvedCases > 0) {
    const reasons: string[] = [];
    if (input.approvedCases === 0 && input.caseSources > 0) {
      reasons.push("document-suite-requires-confirmation");
    }
    if (input.approvedCases > 0 && readyExecutableCases.length === 0) {
      reasons.push("approved-cases-have-no-ready-executable-case");
    }
    return {
      status: reasons.length === 0 ? "ready" : "action-required",
      reasons,
      counts
    };
  }

  const reasons: string[] = [];
  if (requirementBaselines.length === 0) {
    reasons.push("requirement-baseline-missing");
  } else if (approvedRequirementBaselines.length === 0) {
    reasons.push("requirement-baseline-not-approved");
  }
  if (confirmedSystemSnapshots.length === 0) {
    reasons.push("system-brain-snapshot-not-confirmed");
  }
  if (readyExecutableCases.length === 0) {
    reasons.push("ready-executable-case-missing");
  }

  return {
    status: reasons.length === 0 ? "ready" : "not-ready",
    reasons,
    counts
  };
}

export function statusUserSummary(state: {
  systemId: string;
  systemName: string;
  bridgeOk: boolean;
  authProfiles: number;
  verifiedAuthProfiles: number;
  authProfileId?: string;
  awaitingAuthCheckpoints: number;
  pendingAgentTasks: number;
  openBugs: number;
  openGaps: number;
  unfinishedSuites: number;
  testReadiness: TestReadiness;
  pendingWriteTaskId?: string;
  stalledExecutionTaskId?: string;
  nextAction: string;
  activeExecutionTask?: Pick<
    UnifiedExecutionTask,
    | "id"
    | "kind"
    | "status"
    | "stage"
    | "currentCaseTitle"
    | "currentStepTitle"
    | "currentPageUrl"
    | "waitReason"
    | "nextAction"
    | "possiblyStalled"
  >;
  activeSuite?: {
    suiteId: string;
    status: string;
    browserMode?: BrowserExecutionMode;
    totalCases: number;
    attempted: number;
    passed: number;
    failed: number;
    blocked: number;
    waiting: number;
    pending: number;
    nextCaseNo?: string;
    currentStage?: string;
    currentStep?: string;
    currentCaseTitle?: string;
    currentPageUrl?: string;
    elapsedMs?: number;
    lastUpdatedAt?: string;
    waitReason?: string;
    possiblyStalled?: boolean;
    latestEvent?: string;
    traceId?: string;
    activeTask?: { taskId: string; caseNo: string; title: string };
  };
}) {
  return {
    systemName: state.systemName,
    readiness:
      !state.bridgeOk || state.verifiedAuthProfiles === 0 || state.awaitingAuthCheckpoints > 0
        ? "blocked"
        : state.pendingAgentTasks > 0 ||
            state.openBugs > 0 ||
            state.openGaps > 0 ||
            state.unfinishedSuites > 0
          ? "action-required"
          : "ready",
    testReadiness: state.testReadiness,
    nextAction: state.nextAction,
    nextCommand: nextCommandForAction(
      state.nextAction,
      state.systemId,
      state.stalledExecutionTaskId,
      state.pendingWriteTaskId,
      state.authProfileId
    ),
    nextStep: nextStepForAction(state.nextAction),
    ...(state.activeExecutionTask
      ? { activeExecutionTask: state.activeExecutionTask }
      : {}),
    ...(state.activeSuite ? { activeSuite: state.activeSuite } : {}),
    counts: {
      authProfiles: state.authProfiles,
      verifiedAuthProfiles: state.verifiedAuthProfiles,
      awaitingAuthCheckpoints: state.awaitingAuthCheckpoints,
      pendingAgentTasks: state.pendingAgentTasks,
      openBugs: state.openBugs,
      openGaps: state.openGaps,
      unfinishedSuites: state.unfinishedSuites
    }
  };
}

export function statusMarkdown(summary: ReturnType<typeof statusUserSummary>) {
  return [
    `# Brain Creator Status: ${summary.systemName}`,
    "",
    `- Readiness: ${summary.readiness}`,
    `- Test readiness: ${summary.testReadiness.status}`,
    ...(summary.testReadiness.reasons.length > 0
      ? [`- Test readiness reasons: ${summary.testReadiness.reasons.join(", ")}`]
      : []),
    `- Auth profiles: ${summary.counts.authProfiles}`,
    `- Verified auth profiles: ${summary.counts.verifiedAuthProfiles}`,
    `- Awaiting auth checkpoints: ${summary.counts.awaitingAuthCheckpoints}`,
    `- Pending agent tasks: ${summary.counts.pendingAgentTasks}`,
    `- Open bugs: ${summary.counts.openBugs}`,
    `- Open gaps: ${summary.counts.openGaps}`,
    `- Unfinished suites: ${summary.counts.unfinishedSuites}`,
    ...(summary.activeSuite
      ? [
          `- Active suite: ${summary.activeSuite.suiteId} (${summary.activeSuite.status})`,
          `- Active suite progress: ${summary.activeSuite.passed}/${summary.activeSuite.totalCases} passed; next ${summary.activeSuite.nextCaseNo ?? "none"}`,
          ...(summary.activeSuite.currentStage
            ? [`- Active suite stage: ${summary.activeSuite.currentStage}`]
            : []),
          ...(summary.activeSuite.currentStep
            ? [`- Active suite step: ${summary.activeSuite.currentStep}`]
            : []),
          ...(summary.activeSuite.currentCaseTitle
            ? [`- Active suite case: ${summary.activeSuite.currentCaseTitle}`]
            : []),
          ...(summary.activeSuite.currentPageUrl
            ? [`- Active suite page: ${summary.activeSuite.currentPageUrl}`]
            : []),
          ...(summary.activeSuite.elapsedMs !== undefined
            ? [`- Active suite elapsed: ${summary.activeSuite.elapsedMs} ms`]
            : []),
          ...(summary.activeSuite.waitReason
            ? [`- Active suite waiting: ${summary.activeSuite.waitReason}`]
            : []),
          ...(summary.activeSuite.possiblyStalled
            ? ["- Active suite warning: possibly stalled"]
            : []),
          ...(summary.activeSuite.latestEvent
            ? [`- Active suite event: ${summary.activeSuite.latestEvent}`]
            : []),
          ...(summary.activeSuite.traceId
            ? [`- Active suite trace: ${summary.activeSuite.traceId}`]
            : [])
        ]
      : []),
    ...(summary.activeExecutionTask
      ? [
          `- Active task: ${summary.activeExecutionTask.kind} ${summary.activeExecutionTask.id} (${summary.activeExecutionTask.status})`,
          `- Active task stage: ${summary.activeExecutionTask.stage}`,
          ...(summary.activeExecutionTask.currentCaseTitle
            ? [`- Active task case: ${summary.activeExecutionTask.currentCaseTitle}`]
            : []),
          ...(summary.activeExecutionTask.currentStepTitle
            ? [`- Active task step: ${summary.activeExecutionTask.currentStepTitle}`]
            : []),
          ...(summary.activeExecutionTask.waitReason
            ? [`- Active task waiting: ${summary.activeExecutionTask.waitReason}`]
            : []),
          `- Active task next action: ${summary.activeExecutionTask.nextAction}`,
          ...(summary.activeExecutionTask.possiblyStalled
            ? ["- Active task warning: possibly stalled"]
            : [])
        ]
      : []),
    "",
    `Next: ${summary.nextStep}`,
    `Command: \`${summary.nextCommand}\``
  ].join("\n");
}

export function statusQuickCommands(state: {
  authProfiles: number;
  verifiedAuthProfiles: number;
  authProfileId?: string;
  openBugs: number;
  openGaps: number;
  unfinishedSuites: number;
  pendingWriteTaskId?: string;
  systemId?: string;
  stalledExecutionTaskId?: string;
}) {
  const commands = [
    { command: "/bc status", description: "Inspect the current Brain Creator system status." },
    { command: `/bc run "<path>"`, description: "Preview a test case document suite before execution." }
  ];
  if (state.authProfiles === 0) {
    commands.unshift({
      command: state.systemId ? `bc_configure target=auth systemId=${state.systemId}` : "bc_configure target=auth",
      description: "Configure and verify authentication before planning or running tests."
    });
  } else if (state.verifiedAuthProfiles === 0) {
    commands.unshift({
      command: state.systemId && state.authProfileId
        ? `brain-creator auth capture --system ${state.systemId} --profile ${state.authProfileId}`
        : "brain-creator auth capture --system <system-id> --profile <auth-profile-id>",
      description: "Re-authenticate the existing profile in the isolated browser before planning or running tests."
    });
  }
  if (state.pendingWriteTaskId) {
    commands.push({
      command: `bc_review target=run-ledger systemId=${state.systemId} id=${state.pendingWriteTaskId}`,
      description: "Inspect the sent write and verify its original postcondition before resuming; never replay it."
    });
  } else if (state.stalledExecutionTaskId) {
    commands.push({ command: "/bc review suite", description: "Review the latest suite before deciding whether to resume a stalled task." });
  } else if (state.unfinishedSuites > 0) {
    commands.push({ command: "/bc continue", description: "Resume the latest unfinished suite." });
  }
  if (state.openBugs > 0) {
    commands.push({ command: "/bc bugs", description: "Review open BugReports." });
    commands.push({ command: "/bc regress bugs", description: "Run regression for open BugReports." });
  }
  if (state.openGaps > 0) {
    commands.push({ command: "/bc gaps", description: "Review open Gaps." });
  }
  return commands;
}

export function statusToolGuidance(nextAction: string) {
  return {
    defaultLayer: "facade",
    primaryTools: [
      { name: "bc_command", use: "Parse explicit /bc shortcuts into facade calls." },
      { name: "bc_status", use: "Restore session state, readiness, next action, and quick commands." },
      { name: "bc_configure", use: "Configure systems, auth, terms, rules, and checkpoints." },
      { name: "bc_run", use: "Execute approved cases, document suites, workflows, and bug regression." },
      { name: "bc_review", use: "Review suites, cases, bugs, gaps, and artifacts." }
    ],
    nextFacadeTool: nextFacadeToolForAction(nextAction),
    internalToolsPolicy:
      "Use fine-grained bc_* tools only for debugging, audit, or unsupported facade details."
  };
}

export function requirementSuiteRunCollectionSummary(runs: RequirementSuiteRun[]) {
  const statusCounts = countBy(runs, (run) => run.status);
  const metrics = {
    totalRuns: runs.length,
    byStatus: statusCounts,
    totalCases: runs.reduce((total, run) => total + run.total, 0),
    passed: runs.reduce((total, run) => total + run.passed, 0),
    failed: runs.reduce((total, run) => total + run.failed, 0),
    blocked: runs.reduce((total, run) => total + run.blocked, 0),
    skipped: runs.reduce((total, run) => total + run.skipped, 0),
    cancelled: runs.reduce((total, run) => total + run.cancelled, 0)
  };
  const active = runs.some((run) =>
    ["running", "waiting-for-test-data", "waiting-for-agent", "blocked"].includes(run.status)
  );
  return {
    title: "Requirement Suite Run Review",
    status: active ? "action_required" : runs.length > 0 ? "completed" : "empty",
    metrics,
    nextAction: active ? "resume_or_resolve_blockers" : runs.length > 0 ? "review_suite_results" : "prepare_requirement_suite",
    userMessage: runs.length === 0
      ? "No requirement suite runs are available."
      : `${runs.length} requirement suite run(s), ${metrics.totalCases} case(s): ${metrics.passed} passed, ${metrics.failed} failed, ${metrics.blocked} blocked.`
  };
}

export function executionDiagnosisReviewSummary(input: {
  summary: ReturnType<ExecutionDiagnosisService["summary"]>;
  items: Array<{ evidenceRefs: string[] }>;
  nextAction: string;
}) {
  const evidencePaths = uniqueStrings(input.items.flatMap((item) => item.evidenceRefs));
  return {
    title: "Execution Diagnosis Review",
    status:
      input.summary.routing.bugEligible > 0 || input.summary.routing.gapRouted > 0
        ? "action_required"
        : "completed",
    metrics: input.summary,
    evidencePaths: evidencePaths.slice(0, 20),
    evidencePathCount: evidencePaths.length,
    evidenceTruncated: evidencePaths.length > 20,
    nextAction: input.nextAction,
    userMessage:
      `Diagnosis review: ${input.summary.total} records, ` +
      `${input.summary.routing.bugEligible} product-bug candidates, ` +
      `${input.summary.routing.gapRouted} evidence-gap candidates.`
  };
}

export function summarizeStabilityRuns(
  runs: RequirementSuiteRun[],
  executionEvidence: ExecutionEvidence[]
) {
  const grouped = new Map<string, RequirementSuiteRun[]>();
  for (const run of runs) {
    if (!run.stabilityGroupId) continue;
    const group = grouped.get(run.stabilityGroupId) ?? [];
    group.push(run);
    grouped.set(run.stabilityGroupId, group);
  }
  return [...grouped.entries()]
    .sort(([, left], [, right]) => (right.at(-1)?.updatedAt ?? "").localeCompare(left.at(-1)?.updatedAt ?? ""))
    .slice(0, 20)
    .map(([groupId, group]) => {
      const target = Math.max(...group.map((run) => run.stabilityTarget ?? 1));
      const strongVerifiedRunIds = group.filter((run) =>
        run.status === "completed" &&
        run.failed === 0 &&
        run.blocked === 0 &&
        run.caseRuns.length === run.total &&
        run.caseRuns.every((caseRun) => {
          const evidence = caseRun.executionEvidenceId
            ? executionEvidence.find((item) => item.id === caseRun.executionEvidenceId)
            : undefined;
          return Boolean(
            evidence &&
              evidence.status === "passed" &&
              evidence.assuranceLevel === "strong" &&
              (evidence.coverage?.missing.length ?? 0) === 0 &&
              actorJourneyEvidenceMatches(run, evidence)
          );
        })
      ).map((run) => run.id);
      const policy = group.find((run) => run.stabilityPolicy)?.stabilityPolicy ?? {
        targetIterations: target,
        minIterations: 2,
        maxFailureRate: 0,
        requireStrongEvidence: true,
        stopOnBlocked: true
      };
      const evaluation = evaluateStabilityPolicy(group, policy, { strongVerifiedRunIds });
      return {
        stabilityGroupId: groupId,
        ...evaluation,
        latestRunId: group.at(-1)?.id,
        nextRunId: group.find((run) => run.stabilityNextRunId)?.stabilityNextRunId,
        nextRunAt: group.at(-1)?.stabilitySchedule?.nextRunAt,
        schedule: group.at(-1)?.stabilitySchedule
          ? {
              due: isStabilityScheduleDue(group.at(-1)!.stabilitySchedule!, new Date()),
              leaseOwner: group.at(-1)!.stabilitySchedule!.leaseOwner,
              leaseExpiresAt: group.at(-1)!.stabilitySchedule!.leaseExpiresAt
            }
          : undefined
      };
    });
}

export function requirementSuiteReconciliation(
  context: BrainCreatorMcpContext,
  run: RequirementSuiteRun
) {
  const project = context.repository.knowledgeProjects.find(
    (item) => item.id === run.knowledgeProjectId
  );
  if (!project) return run.reconciliation;
  return reconcileRequirementCoverage({
    knowledgeProject: project,
    systemId: run.systemId,
    requirementSets: context.repository.requirementSets,
    testIntents: context.repository.testIntents,
    cases: context.repository.executableCases,
    expectedRequirementSetIds: run.requirementSetIds
  });
}

export function actorJourneyEvidenceMatches(
  run: RequirementSuiteRun,
  evidence: ExecutionEvidence
) {
  const declaredRoles = (run.actorJourney ?? []).map((item) => item.role ?? "");
  if (declaredRoles.length === 0) return true;
  const observedRoles = (evidence.actorJourney ?? []).map((item) => item.role);
  return (
    observedRoles.length === declaredRoles.length &&
    observedRoles.every((role, index) => role === declaredRoles[index])
  );
}

export function nextFacadeToolForAction(action: string) {
  if (action === "configure_bridge") {
    return "brain-creator-doctor";
  }
  if (action === "configure_system") {
    return "bc_configure";
  }
  if (action === "configure_auth") {
    return "bc_configure";
  }
  if (action === "reauthenticate_auth") {
    return "brain-creator auth capture";
  }
  if (action === "complete_auth_checkpoint") {
    return "bc_configure";
  }
  if (action === "review_gaps" || action === "review_bugs") {
    return "bc_review";
  }
  if (action === "review_stalled_task") {
    return "bc_review";
  }
  if (action === "reconcile_pending_write") {
    return "bc_review";
  }
  if (
    action === "continue_case_source_suite" ||
    action === "run_approved_case" ||
    action === "run_case_source_suite" ||
    action === "configure_or_generate_plan"
  ) {
    return "bc_run";
  }
  return "bc_status";
}

export function nextCommandForAction(
  action: string,
  systemId?: string,
  stalledExecutionTaskId?: string,
  pendingWriteTaskId?: string,
  authProfileId?: string
) {
  if (action === "configure_bridge") {
    return "brain-creator-doctor";
  }
  if (action === "complete_auth_checkpoint") {
    return "complete authentication";
  }
  if (action === "configure_auth") {
    return systemId ? `bc_configure target=auth systemId=${systemId}` : "bc_configure target=auth";
  }
  if (action === "reauthenticate_auth") {
    return systemId && authProfileId
      ? `brain-creator auth capture --system ${systemId} --profile ${authProfileId}`
      : "brain-creator auth capture --system <system-id> --profile <auth-profile-id>";
  }
  if (action === "continue_case_source_suite") {
    return "/bc continue";
  }
  if (action === "review_stalled_task") {
    return stalledExecutionTaskId
      ? `bc_review target=run-ledger systemId=${systemId} id=${stalledExecutionTaskId}`
      : "/bc status";
  }
  if (action === "reconcile_pending_write") {
    return pendingWriteTaskId
      ? `bc_review target=run-ledger systemId=${systemId} id=${pendingWriteTaskId}`
      : "/bc status";
  }
  if (action === "review_gaps") {
    return "/bc gaps";
  }
  if (action === "review_bugs") {
    return "/bc bugs";
  }
  if (action === "run_case_source_suite" || action === "configure_or_generate_plan") {
    return `/bc run "<path>"`;
  }
  if (action === "run_approved_case") {
    return "confirm and run";
  }
  return "/bc status";
}

export function nextStepForAction(action: string) {
  if (action === "configure_bridge") {
    return "Configure the Brain Creator agent bridge before running generation or suites.";
  }
  if (action === "complete_auth_checkpoint") {
    return "Complete the pending manual authentication checkpoint.";
  }
  if (action === "configure_auth") {
    return "Configure and verify an authentication profile for this system before planning or execution.";
  }
  if (action === "reauthenticate_auth") {
    return "Re-authenticate the existing profile in the isolated browser and verify it before planning or execution.";
  }
  if (action === "continue_case_source_suite") {
    return "Continue the latest unfinished test case suite.";
  }
  if (action === "review_stalled_task") {
    return "Review the stalled task's Run Ledger and reconcile its persisted state before deciding whether to resume; do not replay pending writes.";
  }
  if (action === "reconcile_pending_write") {
    return "Inspect the Run Ledger and query the original business postcondition before any resume; reconcile with target evidence and do not replay the write.";
  }
  if (action === "review_gaps") {
    return "Review open gaps before claiming the system is ready.";
  }
  if (action === "review_bugs") {
    return "Review open bugs or run bug regression.";
  }
  if (action === "run_approved_case") {
    return "Run the approved test case chain.";
  }
  if (action === "run_case_source_suite") {
    return "Run or preview an existing test case document suite.";
  }
  return "Add a requirement or preview a test case document suite.";
}

export function countBy<T>(items: T[], getKey: (item: T) => string) {
  return items.reduce<Record<string, number>>((result, item) => {
    const key = getKey(item);
    result[key] = (result[key] ?? 0) + 1;
    return result;
  }, {});
}

export function aggregateLegacyDiagnosisAudit(
  context: BrainCreatorMcpContext,
  systemIds: string[],
  limit: number
) {
  const audits = systemIds.map((systemId) => ({
    systemId,
    audit: context.executionDiagnosis.auditLegacy({ systemId, limit: 100 })
  }));
  const candidates = audits
    .flatMap((item) => item.audit.candidates)
    .slice(0, Math.min(100, Math.max(1, limit)));
  const sum = (
    select: (summary: (typeof audits)[number]["audit"]["summary"]) => number
  ) => audits.reduce((total, item) => total + select(item.audit.summary), 0);
  const totalCandidates = sum((summary) => summary.totalCandidates);
  return {
    summary: {
      totalCandidates,
      bugs: sum((summary) => summary.bugs),
      gaps: sum((summary) => summary.gaps),
      reviewBugAsGap: sum((summary) => summary.reviewBugAsGap),
      confirmBug: sum((summary) => summary.confirmBug),
      confirmGap: sum((summary) => summary.confirmGap),
      needsEvidence: sum((summary) => summary.needsEvidence),
      truncated: candidates.length < totalCandidates
    },
    bySystem: audits.map((item) => ({
      systemId: item.systemId,
      ...item.audit.summary
    })),
    candidates
  };
}

export function aggregateLegacyDiagnosisReviewSummary(
  context: BrainCreatorMcpContext,
  systemIds: string[]
) {
  const reviews = systemIds.flatMap((systemId) =>
    context.executionDiagnosis.listLegacyReviews(systemId)
  );
  const activeReviews = reviews.filter(
    (review) => review.status !== "rolled-back"
  );
  const adjudicated = activeReviews.filter(
    (review) => review.confirmedVerdict !== undefined
  );
  const matched = adjudicated.filter(
    (review) => review.matchesSuggestion === true
  );
  return {
    total: reviews.length,
    byDecision: countBy(activeReviews, (review) => review.decision),
    migrated: activeReviews.filter((review) => review.status === "migrated").length,
    rolledBack: reviews.filter((review) => review.status === "rolled-back").length,
    needsEvidence: activeReviews.filter(
      (review) => review.decision === "needs_evidence"
    ).length,
    quality: {
      adjudicated: adjudicated.length,
      matched: matched.length,
      corrected: adjudicated.length - matched.length,
      accuracy:
        adjudicated.length > 0 ? matched.length / adjudicated.length : null,
      byProposedFailureType: adjudicated.reduce<
        Record<string, { total: number; matched: number; corrected: number }>
      >((summary, review) => {
        const current = summary[review.proposedFailureType] ?? {
          total: 0,
          matched: 0,
          corrected: 0
        };
        current.total += 1;
        if (review.matchesSuggestion) current.matched += 1;
        else current.corrected += 1;
        summary[review.proposedFailureType] = current;
        return summary;
      }, {})
    }
  };
}

export function legacyDiagnosisEvalMarkdown(evaluation: {
  metric: string;
  adjudicated: number;
  minSampleSize: number;
  readiness: "ready" | "insufficient-sample";
  observedAccuracy: number | null;
  reportableAccuracy: number | null;
  matched: number;
  corrected: number;
  inconclusive: number;
  rolledBack: number;
}) {
  const percent = (value: number | null) =>
    value === null ? "n/a" : `${(value * 100).toFixed(1)}%`;
  return [
    "# Historical Execution Diagnosis Eval",
    "",
    `- Metric: ${evaluation.metric}`,
    `- Readiness: ${evaluation.readiness}`,
    `- Adjudicated sample: ${evaluation.adjudicated}/${evaluation.minSampleSize}`,
    `- Observed accuracy: ${percent(evaluation.observedAccuracy)}`,
    `- Reportable accuracy: ${percent(evaluation.reportableAccuracy)}`,
    `- Matched: ${evaluation.matched}`,
    `- Corrected: ${evaluation.corrected}`,
    `- Inconclusive: ${evaluation.inconclusive}`,
    `- Rolled back: ${evaluation.rolledBack}`
  ].join("\n");
}
