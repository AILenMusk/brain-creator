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
import type { BrainCreatorMcpContext, HostAgentTaskPackage } from "./handlers.js";
const { textResult, facadeTextResult, compactFacadePayload, summarizeFacadeRecord, facadeReferences, envelopeResult, stringArg, optionalStringArg, executionProvenanceArg, optionalNumberArg, numberArg, optionalBooleanArg, mutationResultsArg, materializeAuthStorageState, actorJourneyArg, explorationScenarioArg, summarizeCoverageDimensions, planContextArg, chainContextArg, archiveRequirementSuiteRun, writeRequirementSuiteSnapshots, createRequirementBugReport, suiteContextArg, regressionContextArg, runModeArg, browserModeArg, suiteActionArg, explorationPlanActionsArg, explorationCleanupPolicyArg, onboardingApprovalStageArg, explorationResultArg, reviewTargetArg, stabilityPolicyArg, isKnowledgeReviewTarget, resolveSystemReference, systemCandidatesText, normalizeSystemLookup, inferSystemName, extractCaseSource, intentCaseSourceFilters, intentBugRegressionFilters, bugRegressionFilters, matchesBugRegressionFilters, mergeUniqueStrings, extractBugIds, extractCaseNos, extractPriorities, isPriorityToken, extractTaggedValues, extractPrecedingTaggedValues, escapeRegExp, isContinueRequest, isBugRegressionRequest, isBugReviewRequest, isDocumentSuiteRequest, parseBrainCreatorCommand, parseBrainCreatorCommandTokens, commandWithSystemReference, parseRunCommandInput, parseBugRegressionCommandInput, parseReviewCommandInput, splitCommandValues, commandReviewTarget, commandTokens, configureTargetArg, prepareActionArg, executionActionPhaseArg, evaluationProviderArg, evaluationInterventionCategoryArg, diagnosisAssetTypeArg, legacyDiagnosisDecisionArg, optionalExecutionFailureTypeArg, optionalExecutionDiagnosisVerdictArg, testDataTaskResultStatusArg, optionalTestDataProviderDecisionArg, testDataResolutionsArg, knowledgeNodeTypeArg, policyProviderArg, explorationInteractionModeArg, systemExplorationModeArg, requirementContentPackageArg, hostDownloadedAttachmentsArg, explorationTaskOutcomeArg, attachmentAnalysisArg, interactionEvidenceArg, pageEvidenceArg, trainingEvidenceArg, assertSystemEvidenceUrl, stringArrayArg, optionalStringArrayArg, optionalObjectArrayArg, recordArg, loginMethodArg, severityArg, gapStatusArg, responseModeArg, onboardingCreateNextAction, evaluationRuntimeBuildIdentity, evaluationRuntimeIdentity, gapSeverityArg, bugStatusArg, authCheckpointStatusArg, agentArg, agentOutputStatusArg, scenarioArrayArg, stepArrayArg, priorityArg, actionArg, protectedSecretsForSystem } = handlerArguments;

export async function reevaluateLegacyExecutionEvidence(
  context: BrainCreatorMcpContext,
  input: Record<string, unknown>
) {
  if (optionalBooleanArg(input, "confirm") !== true) {
    throw new Error("Historical evidence re-evaluation requires confirm=true after reviewing its scope");
  }
  const trialId = stringArg(input, "evaluationTrialId");
  const evidenceId = stringArg(input, "executionEvidenceId");
  const trial = context.repository.evaluationTrials.find((item) => item.id === trialId);
  if (!trial) throw new Error("Evaluation trial not found");
  const evidence = context.repository.executionEvidence.find((item) => item.id === evidenceId);
  if (!evidence) throw new Error("Execution evidence not found");
  const trialValidation = context.evaluationIntegrity.validateTrial(trial.id, {
    codeRevision: trial.codeRevision,
    runtimeVersions: trial.runtimeVersions,
    runtimeBuildIdentity: trial.runtimeBuildIdentity
  }, false);
  const matchingCases = context.repository.requirementSuiteRuns
    .filter((run) => isLinkedEvaluationRun(run, trial))
    .flatMap((run) => run.caseRuns.flatMap((caseRun) => {
      const attempt = caseRun.attempts.find((item) => item.executionEvidenceId === evidence.id);
      if (caseRun.executionEvidenceId !== evidence.id && !attempt) return [];
      return [{ run, caseRun, planId: evidence.executionPlanId ?? attempt?.executionPlanId ?? caseRun.executionPlanId }];
    }));
  if (matchingCases.length !== 1) {
    throw new Error("Historical evidence must map to exactly one case in a Trial-bound Requirement Suite run");
  }
  const { run, caseRun, planId } = matchingCases[0];
  if (!planId) throw new Error("Historical evidence has no immutable execution plan binding");
  const plan = context.repository.executionPlans.find((item) => item.id === planId);
  if (!plan) throw new Error("Historical execution plan not found");
  const planValidation = context.executionPreflight.validatePlan(plan.id);
  const executableCase = context.repository.executableCases.find((item) => item.id === caseRun.executableCaseId);
  if (!executableCase) throw new Error("Historical executable case not found");
  const scenarioIds = trial.executionScope?.businessScenarioIds ?? [];
  const scenarios = context.repository.businessScenarios.filter((item) =>
    scenarioIds.includes(item.id) &&
    item.knowledgeProjectId === trial.knowledgeProjectId &&
    item.requirementSetId === trial.requirementSetId &&
    (item.testIntentIds ?? []).includes(executableCase.testIntentId)
  );
  if (scenarios.length !== 1) {
    throw new Error("Historical case must map to exactly one scenario in the frozen Trial scope");
  }
  const previousConformance = context.repository.conformanceResults
    .filter((item) => item.executionEvidenceId === evidence.id)
    .at(-1);
  const historicalInputs = {
    trial,
    trialValidationReasons: trialValidation.reasons,
    run,
    caseRun,
    plan,
    planValidationReasons: planValidation.reasons,
    executableCase,
    scenario: scenarios[0],
    evidence,
    previousConformance
  };
  const historicalInputFingerprint = historicalEvidenceSourceFingerprint(historicalInputs);
  const protectedSecrets = trial.systemId
    ? protectedSecretsForSystem(context, trial.systemId)
    : {};
  const reviewed = await reevaluateHistoricalEvidence({
    root: context.workDir,
    ...historicalInputs,
    reviewer: redactSensitiveText(stringArg(input, "historicalEvidenceReviewer"), protectedSecrets),
    note: redactSensitiveText(stringArg(input, "historicalEvidenceNote"), protectedSecrets),
    authenticator: createWorkspaceIntegrityAuthenticator(context.workDir)
  });
  const review = reviewed.evidence.historicalReevaluation!;
  const assertHistoricalInputsUnchanged = () => {
    const currentTrial = context.repository.evaluationTrials.find((item) => item.id === trial.id);
    const currentEvidence = context.repository.executionEvidence.find((item) => item.id === evidence.id);
    const currentRun = context.repository.requirementSuiteRuns.find((item) => item.id === run.id);
    const currentCaseRun = currentRun?.caseRuns.find((item) => item.executableCaseId === caseRun.executableCaseId);
    const currentPlan = context.repository.executionPlans.find((item) => item.id === plan.id);
    const currentExecutableCase = context.repository.executableCases.find((item) => item.id === executableCase.id);
    const currentScenario = context.repository.businessScenarios.find((item) => item.id === scenarios[0].id);
    const currentPreviousConformance = context.repository.conformanceResults
      .filter((item) => item.executionEvidenceId === evidence.id)
      .at(-1);
    if (!currentTrial || !currentEvidence || !currentRun || !currentCaseRun || !currentPlan ||
        !currentExecutableCase || !currentScenario) {
      throw new Error("Historical evidence inputs changed while re-evaluation was running");
    }
    const currentMatches = context.repository.requirementSuiteRuns
      .filter((candidateRun) => isLinkedEvaluationRun(candidateRun, currentTrial))
      .flatMap((candidateRun) => candidateRun.caseRuns.flatMap((candidateCaseRun) => {
        const attempt = candidateCaseRun.attempts.find((item) => item.executionEvidenceId === evidence.id);
        if (candidateCaseRun.executionEvidenceId !== evidence.id && !attempt) return [];
        return [{
          runId: candidateRun.id,
          caseId: candidateCaseRun.executableCaseId,
          planId: evidence.executionPlanId ?? attempt?.executionPlanId ?? candidateCaseRun.executionPlanId
        }];
      }));
    if (currentMatches.length !== 1 || currentMatches[0]?.runId !== run.id ||
        currentMatches[0]?.caseId !== caseRun.executableCaseId || currentMatches[0]?.planId !== plan.id) {
      throw new Error("Historical evidence inputs changed while re-evaluation was running");
    }
    const currentTrialValidation = context.evaluationIntegrity.validateTrial(currentTrial.id, {
      codeRevision: currentTrial.codeRevision,
      runtimeVersions: currentTrial.runtimeVersions,
      runtimeBuildIdentity: currentTrial.runtimeBuildIdentity
    }, false);
    const currentPlanValidation = context.executionPreflight.validatePlan(currentPlan.id);
    if (!currentTrialValidation.valid || !currentPlanValidation.valid) {
      throw new Error("Historical evidence inputs changed while re-evaluation was running");
    }
    const currentInputs = {
      trial: currentTrial,
      trialValidationReasons: currentTrialValidation.reasons,
      run: currentRun,
      caseRun: currentCaseRun,
      plan: currentPlan,
      planValidationReasons: currentPlanValidation.reasons,
      executableCase: currentExecutableCase,
      scenario: currentScenario,
      evidence: currentEvidence,
      previousConformance: currentPreviousConformance
    };
    if (historicalEvidenceSourceFingerprint(currentInputs) !== historicalInputFingerprint) {
      throw new Error("Historical evidence inputs changed while re-evaluation was running");
    }
    return currentEvidence;
  };
  assertHistoricalInputsUnchanged();
  const reviewedArtifacts = reviewed.evidence.artifactValidation?.files ?? [];
  const artifactRevalidation = await validateExecutionArtifacts(
    context.workDir,
    reviewedArtifacts.map((artifact) => artifact.path),
    Object.fromEntries(reviewedArtifacts.map((artifact) => [artifact.path, artifact.sha256]))
  );
  if (artifactRevalidation.status !== "valid" || artifactRevalidation.files.length !== reviewedArtifacts.length) {
    throw new Error(`Historical evidence artifacts changed before commit: ${artifactRevalidation.reasons.join("; ")}`);
  }
  let intervention;
  context.repository.transaction(() => {
    const currentEvidence = assertHistoricalInputsUnchanged();
    if (!currentEvidence || currentEvidence.semanticSnapshotHash || currentEvidence.historicalReevaluation) {
      throw new Error("Historical evidence changed while re-evaluation was running");
    }
    Object.assign(currentEvidence, reviewed.evidence);
    context.repository.conformanceResults.push(reviewed.conformance);
    intervention = context.evaluationIntegrity.recordIntervention({
      trialId: trial.id,
      category: "manual-evidence-review",
      actor: review.reviewer,
      note: review.note,
      evidenceRefs: [
        `historical-evidence-review:${review.id}`,
        `execution-evidence:${evidence.id}`,
        ...review.artifactHashes.map((artifact) => `artifact:${artifact.path}`),
        `conformance:${reviewed.conformance.id}`
      ],
      businessScenarioIds: [scenarios[0].id]
    });
  });
  return {
    status: "historical-evidence-reevaluated",
    trialId: trial.id,
    evidenceId: evidence.id,
    review,
    conformance: reviewed.conformance,
    intervention,
    nextAction: trial.interventionCapture
      ? "Re-capture the complete Trial intervention set before measuring autonomy."
      : "Review the Trial metrics; the manual evidence review is recorded as an intervention."
  };
}

export async function prepareFacade(context: BrainCreatorMcpContext, input: Record<string, unknown>) {
  const action = prepareActionArg(input, "action");
  if (action === "record-execution-action" || action === "reconcile-execution-action") {
    return recordExecutionActionFacade(context, input, action);
  }
  if (action === "start-evaluation-trial") {
    const requirementSourceId = stringArg(input, "requirementSourceId");
    const source = context.repository.requirementSources.find((item) => item.id === requirementSourceId);
    const runtimeIdentity = evaluationRuntimeIdentity(context);
    const runtimeCodeRevision = runtimeIdentity.commit === "unknown"
      ? runtimeIdentity.buildId
      : runtimeIdentity.commit;
    const requestedCodeRevision = optionalStringArg(input, "codeRevision");
    if (requestedCodeRevision && requestedCodeRevision !== runtimeCodeRevision) {
      throw new Error("Evaluation trial codeRevision must match the running process build identity");
    }
    const approvalReceiptId = optionalStringArg(input, "approvalReceiptId");
    if (approvalReceiptId) {
      if (!source?.latestRequirementSetId) throw new Error("Evaluation trial approval requires a source requirement set");
      context.requirementGate.verifyApprovalReceipt(source.latestRequirementSetId, approvalReceiptId);
    }
    return context.evaluationIntegrity.startTrial({
      comparisonGroupId: stringArg(input, "comparisonGroupId"),
      knowledgeProjectId: stringArg(input, "knowledgeProjectId"),
      systemId: optionalStringArg(input, "systemId"),
      requirementSourceId,
      provider: evaluationProviderArg(input, "evaluationProvider"),
      workspacePath: stringArg(input, "evaluationWorkspacePath"),
      storePath: stringArg(input, "evaluationStorePath"),
      codeRevision: runtimeCodeRevision,
      runtimeVersions: recordArg(input, "runtimeVersions"),
      runtimeBuildIdentity: runtimeIdentity.buildId,
      businessScenarioIds: stringArrayArg(input, "businessScenarioIds"),
      businessOutcomeIds: optionalStringArrayArg(input, "businessOutcomeIds"),
      approvalReceiptId
    });
  }
  if (action === "checkpoint-evaluation-trial") {
    return context.evaluationIntegrity.checkpointTrial({
      trialId: stringArg(input, "evaluationTrialId"),
      previousProjectionManifestId: stringArg(input, "previousProjectionManifestId"),
      operation: stringArg(input, "checkpointOperation"),
      evidenceRefs: stringArrayArg(input, "evidenceRefs")
    });
  }
  if (action === "validate-evaluation-trial") {
    return context.evaluationIntegrity.validateTrial(
      stringArg(input, "evaluationTrialId"),
      {
        codeRevision: stringArg(input, "codeRevision"),
        runtimeVersions: recordArg(input, "runtimeVersions")
        ,runtimeBuildIdentity: evaluationRuntimeBuildIdentity(context)
      }
    );
  }
  if (action === "complete-evaluation-trial") {
    return context.evaluationIntegrity.completeTrial(
      stringArg(input, "evaluationTrialId"),
      stringArg(input, "codeRevision"),
      recordArg(input, "runtimeVersions"),
      evaluationRuntimeBuildIdentity(context)
    );
  }
  if (action === "record-evaluation-intervention") {
    return context.evaluationIntegrity.recordIntervention({
      trialId: stringArg(input, "evaluationTrialId"),
      category: evaluationInterventionCategoryArg(input, "interventionCategory"),
      actor: stringArg(input, "interventionActor"),
      note: stringArg(input, "interventionNote"),
      evidenceRefs: stringArrayArg(input, "evidenceRefs"),
      businessScenarioIds: stringArrayArg(input, "businessScenarioIds")
    });
  }
  if (action === "complete-intervention-capture") {
    return context.evaluationIntegrity.completeInterventionCapture({
      trialId: stringArg(input, "evaluationTrialId"),
      scenarioIds: stringArrayArg(input, "businessScenarioIds"),
      actor: stringArg(input, "interventionActor"),
      evidenceRefs: stringArrayArg(input, "evidenceRefs")
    });
  }
  if (action === "reevaluate-legacy-execution-evidence") {
    return reevaluateLegacyExecutionEvidence(context, input);
  }
  if (action === "mark-test-data-sent") {
    return context.testDataProvider.markSent(stringArg(input, "taskId"));
  }
  if (action === "confirm-cleanup-notice") {
    return context.testDataProvider.acknowledgeCleanupNotice(
      stringArg(input, "taskId"),
      stringArg(input, "cleanupNoticeSha256")
    );
  }
  if (action === "reconcile-test-data-no-effect") {
    const task = await context.testDataProvider.reconcileNotApplied(
      stringArg(input, "taskId"),
      stringArrayArg(input, "sourceRefs")
    );
    if (task.status !== "submitted") return task;
    const executableCase = context.repository.executableCases.find(
      (item) => item.id === task.executableCaseId
    );
    if (!executableCase) throw new Error("Reconciled test-data case not found");
    const lease = task.leaseId
      ? context.repository.testDataLeases.find((item) => item.id === task.leaseId)
      : undefined;
    return continueRequirementSuiteAfterTestData(context, {
      task,
      executableCase,
      ...(lease ? { lease } : {})
    });
  }
  if (action === "rollback-legacy-diagnosis") {
    const resolution = resolveSystemReference(context, input);
    const rollbackInput = {
      systemId: resolution.systemId,
      reviewId: stringArg(input, "diagnosisReviewId")
    };
    if (!optionalBooleanArg(input, "confirm")) {
      return {
        status: "preview",
        ...context.executionDiagnosis.previewLegacyRollback(rollbackInput),
        systemResolution: resolution,
        nextAction:
          "Present the rollback changes and ask for explicit confirmation with a human rollback note."
      };
    }
    return {
      status: "rolled-back",
      ...context.executionDiagnosis.confirmLegacyRollback({
        ...rollbackInput,
        note: stringArg(input, "confirmationNote")
      }),
      systemResolution: resolution,
      nextAction:
        "Re-audit the restored historical asset before applying another diagnosis."
    };
  }
  if (action === "review-legacy-diagnosis") {
    const resolution = resolveSystemReference(context, input);
    const reviewInput = {
      systemId: resolution.systemId,
      assetType: diagnosisAssetTypeArg(input, "diagnosisAssetType"),
      assetId: stringArg(input, "diagnosisAssetId"),
      decision: legacyDiagnosisDecisionArg(input, "diagnosisDecision"),
      correctedFailureType: optionalExecutionFailureTypeArg(
        input,
        "correctedFailureType"
      ),
      correctedVerdict: optionalExecutionDiagnosisVerdictArg(
        input,
        "correctedVerdict"
      )
    };
    if (!optionalBooleanArg(input, "confirm")) {
      return {
        status: "preview",
        ...context.executionDiagnosis.previewLegacyReview(reviewInput),
        systemResolution: resolution,
        nextAction:
          "Present the proposed asset changes and ask for explicit confirmation with a human review note."
      };
    }
    return {
      status: "confirmed",
      ...context.executionDiagnosis.confirmLegacyReview({
        ...reviewInput,
        note: stringArg(input, "confirmationNote")
      }),
      systemResolution: resolution,
      nextAction: "Review the updated diagnosis, Bug, and Gap state."
    };
  }
  if (action === "ingest-requirement" || action === "refresh-requirement") {
    const knowledgeProjectId = stringArg(input, "knowledgeProjectId");
    const source = stringArg(input, "source");
    let resolved;
    try {
      resolved = await resolveRequirementSource(
        { source, contentPackage: requirementContentPackageArg(input, "contentPackage") },
        {
          baseDir: context.workDir,
          allowPrivateNetwork: optionalBooleanArg(input, "allowPrivateNetwork"),
          feishuReader: context.feishuReader
        }
      );
    } catch (error) {
      if (!isFeishuRequirementSource(source)) throw error;
      const reason = error instanceof Error ? error.message : String(error);
      const gap = reportKnowledgeGap(
        context,
        knowledgeProjectId,
        source,
        `Feishu connector failed: ${reason}`
      );
      return {
        status: "connector-error",
        connector: "feishu",
        error: reason,
        gap,
        nextAction: "Fix Feishu access or retry with a host-provided contentPackage."
      };
    }
    if (resolved.status === "needs-host-connector") {
      const gap = reportKnowledgeGap(
        context,
        knowledgeProjectId,
        source,
        "Feishu content requires a host lark connector. Submit a RequirementContentPackage or export DOCX/PDF/Markdown."
      );
      return {
        ...resolved,
        gap,
        nextAction: "Read the Feishu document through the host lark capability and retry with contentPackage."
      };
    }
    const result = await context.knowledgeService.ingestRequirement({
      projectId: knowledgeProjectId,
      contentPackage: resolved.contentPackage
    });
    const pendingAttachments = result.source.attachments.filter(
      (attachment) => attachment.status !== "confirmed"
    );
    return {
      ...result,
      status: result.changed ? "draft-created" : "unchanged",
      attachmentSummary: {
        total: result.source.attachments.length,
        pending: pendingAttachments.length
      },
      nextAction:
        pendingAttachments.length > 0
          ? "analyze-attachments"
          : result.changed
            ? "generate-test-design"
            : "review-existing-baseline"
    };
  }
  if (action === "analyze-attachments") {
    const sourceId = stringArg(input, "requirementSourceId");
    const downloader = context.feishuReader?.downloadAttachment
      ? context.feishuReader.downloadAttachment.bind(context.feishuReader)
      : undefined;
    const result = await context.knowledgeService.prepareRequirementAttachments({
      sourceId,
      attachmentIds: stringArrayArg(input, "attachmentIds"),
      hostDownloadedAttachments: hostDownloadedAttachmentsArg(input, "hostDownloadedAttachments"),
      downloader
    });
    return {
      status: result.recognitionRequests.length > 0
        ? "needs-host-vision"
        : result.gaps.length > 0
          ? "blocked"
          : "structured",
      ...result,
      requiredOutput: result.recognitionRequests.length > 0 ? "AttachmentAnalysis" : undefined,
      nextAction:
        result.recognitionRequests.length > 0
          ? "Use the host multimodal capability on each localPath, then submit each structured result with submit-attachment-analysis."
          : result.gaps.length > 0
            ? "Restore connector access or resolve the attachment Gap before approving the requirement baseline."
            : "Review and confirm each draft attachment analysis."
    };
  }
  if (action === "submit-attachment-analysis") {
    const analysis = context.knowledgeService.submitRequirementAttachmentAnalysis({
      sourceId: stringArg(input, "requirementSourceId"),
      attachmentId: stringArg(input, "attachmentId"),
      provider: "host-agent",
      result: attachmentAnalysisArg(input, "attachmentAnalysis")
    });
    return {
      status: "draft-created",
      analysis,
      nextAction: "Present the structured visual interpretation and ask the user to confirm it."
    };
  }
  if (action === "confirm-attachment-analysis") {
    if (!optionalBooleanArg(input, "confirm")) {
      const analysisId = stringArg(input, "attachmentAnalysisId");
      const analysis = context.repository.attachmentAnalyses.find((item) => item.id === analysisId);
      if (!analysis) throw new Error("Attachment analysis not found");
      return {
        status: "preview",
        analysis,
        requiresConfirmation: true,
        nextAction: "Ask the user to confirm this visual interpretation before it enters requirement knowledge."
      };
    }
    return context.knowledgeService.confirmRequirementAttachmentAnalysis({
      analysisId: stringArg(input, "attachmentAnalysisId"),
      confirmedBy: optionalStringArg(input, "confirmedBy")
    });
  }
  if (action === "revise-test-design-draft") {
    return context.knowledgeService.reviseTestDesignDraft({
      knowledgeProjectId: stringArg(input, "knowledgeProjectId"),
      requirementSetId: stringArg(input, "requirementSetId"),
      expectedDraftHash: optionalStringArg(input, "expectedDraftHash"),
      confirm: optionalBooleanArg(input, "confirm") === true,
      confirmationNote: optionalStringArg(input, "confirmationNote"),
      testIntentDraftUpdates: (input.testIntentDraftUpdates ?? []) as Parameters<
        KnowledgeService["reviseTestDesignDraft"]
      >[0]["testIntentDraftUpdates"],
      businessScenarioDraftUpdates: (input.businessScenarioDraftUpdates ?? []) as Parameters<
        KnowledgeService["reviseTestDesignDraft"]
      >[0]["businessScenarioDraftUpdates"]
    });
  }
  if (action === "refresh-test-design-projection") {
    return context.knowledgeService.refreshTestDesignProjection({
      knowledgeProjectId: stringArg(input, "knowledgeProjectId"),
      requirementSetId: stringArg(input, "requirementSetId")
    });
  }
  if (action === "generate-analysis" || action === "generate-test-design") {
    const requirementSetId = stringArg(input, "requirementSetId");
    const requirementSet = context.repository.requirementSets.find((item) => item.id === requirementSetId);
    if (!requirementSet) throw new Error("Requirement set not found");
    const source = context.repository.requirementSources.find((item) => item.id === requirementSet.sourceId);
    if (!source) throw new Error("Requirement source not found");
    const complexity = assessRequirementSourceComplexity(source);
    const requestedProvider = optionalStringArg(input, "provider");
    const provider = requestedProvider
      ? policyProviderArg(input, "provider")
      : action === "generate-analysis" || complexity.level === "complex"
        ? "host-agent"
        : "builtin";
    if (complexity.level === "complex" && provider === "builtin") {
      return {
        status: "preview-only",
        provider,
        requirementSetId,
        complexity,
        requiresHostHarness: true,
        nextAction: "Run the complex requirement through provider=host-agent before approving or executing it."
      };
    }
    if (provider === "host-agent") {
      if (action === "generate-analysis") {
        return input.taskId && input.analysisPackage !== undefined
          ? context.requirementAnalysisHarness.submit({
              taskId: stringArg(input, "taskId"),
              output: input.analysisPackage
            })
          : context.requirementAnalysisHarness.start(requirementSetId);
      }
      const result = await context.requirementAnalysisHarness.latestCompletedResult(requirementSetId);
      if (!result) {
        return {
          status: "needs-host-analysis",
          requirementSetId,
          nextAction: "Run generate-analysis with provider=host-agent before generating test design."
        };
      }
      if (result.evaluation.verdict === "retry") {
        return {
          status: "blocked",
          requirementSetId,
          evaluation: result.evaluation,
          nextAction: "Retry or complete the active Requirement Host Harness task before generating test design."
        };
      }
      const design = await context.knowledgeService.generateTestDesign(
        requirementSetId,
        provider,
        result.analysis,
        result.models
      );
      const adjudicated = adjudicateRequirementDesign(context, requirementSet, provider, design);
      return result.evaluation.verdict === "blocked"
        ? {
            ...adjudicated,
            draftDesignCreated: true,
            draftOnly: true,
            draftTestIntentCount: design.testIntents.length,
            draftScenarioCount: design.businessScenarios.length,
            nextAction: "Review the draft design and resolve the blocked Requirement Host Harness findings before baseline approval, compilation, or execution."
          }
        : adjudicated;
    }
    if (provider === "host-skill" && action === "generate-test-design" && input.analysisPackage === undefined) {
      const result = await context.requirementAnalysisHarness.latestCompletedResult(requirementSetId);
      if (result?.analysis.provider === "host-skill") {
        if (result.evaluation.verdict === "retry") {
          return {
            status: "blocked",
            requirementSetId,
            evaluation: result.evaluation,
            nextAction: "Retry or complete the active Requirement Host Harness task before generating test design."
          };
        }
        const design = await context.knowledgeService.generateTestDesign(
          requirementSetId,
          provider,
          result.analysis,
          result.models
        );
        const adjudicated = adjudicateRequirementDesign(context, requirementSet, provider, design);
        return result.evaluation.verdict === "blocked"
          ? {
              ...adjudicated,
              draftDesignCreated: true,
              draftOnly: true,
              draftTestIntentCount: design.testIntents.length,
              draftScenarioCount: design.businessScenarios.length,
              nextAction: "Review the draft design and resolve the blocked Requirement Host Harness findings before baseline approval, compilation, or execution."
            }
          : adjudicated;
      }
    }
    if (provider === "host-skill" && input.analysisPackage === undefined) {
      return {
        status: "needs-host-skill",
        requirementSetId: stringArg(input, "requirementSetId"),
        requiredSkills: ["RequirementAnalysis.skill", "TestCaseDesign.skill"],
        requiredOutput: "Brain Creator RequirementAnalysis schema",
        nextAction:
          "Run the available host Skill against the requirement source, then retry with analysisPackage."
      };
    }
    if (provider === "host-skill") {
      return context.requirementAnalysisHarness.startFromHostSkill(
        normalizeHostSkillAnalysis(input.analysisPackage, requirementSetId)
      );
    }
    const design = await context.knowledgeService.generateTestDesign(
      requirementSetId,
      provider,
      undefined
    );
    if (provider === "builtin") {
      requirementSet.analysisProvider = "builtin";
      requirementSet.baselineFingerprint = context.requirementGate.baselineFingerprint(requirementSetId);
      context.repository.persist();
    }
    return design;
  }
  if (action === "confirm-eval-actions") {
    const requirementSetId = stringArg(input, "requirementSetId");
    if (!optionalBooleanArg(input, "confirm")) {
      const requirementSet = context.repository.requirementSets.find(
        (item) => item.id === requirementSetId
      );
      if (!requirementSet) throw new Error("Requirement set not found");
      return {
        status: "preview",
        requirementSetId,
        evaluationGate: requirementSet.evaluationGate,
        requiresConfirmation: true,
        nextAction: "Present every pending Eval action and ask the user for an explicit resolution note."
      };
    }
    return context.knowledgeService.confirmEvaluationActions({
      requirementSetId,
      actionIds: stringArrayArg(input, "actionIds"),
      note: stringArg(input, "confirmationNote"),
      confirm: true,
      confirmedBy: optionalStringArg(input, "confirmedBy")
    });
  }
  if (action === "assess-scenarios") {
    const result = context.knowledgeService.assessBusinessScenarios({
      knowledgeProjectId: stringArg(input, "knowledgeProjectId"),
      requirementSetId: stringArg(input, "requirementSetId"),
      systemId: optionalStringArg(input, "systemId"),
      scenarioIds: stringArrayArg(input, "scenarioIds"),
      providerIndependence: optionalStringArg(input, "providerIndependence") as
        | "deterministic"
        | "isolated-single-provider"
        | "cross-provider"
        | "human-confirmed"
        | undefined
    });
    return {
      status: result.summary.blocked > 0 ? "blocked" : result.summary.needsReview > 0 ? "needs-review" : "passed",
      ...result
    };
  }
  if (action === "record-scenario-run") {
    const scenarioId = stringArg(input, "scenarioId");
    const scenario = context.repository.businessScenarios.find((item) => item.id === scenarioId);
    if (!scenario) throw new Error("Business scenario not found");
    const requirementSet = context.repository.requirementSets.find(
      (item) => item.id === scenario.requirementSetId
    );
    if (!requirementSet) throw new Error("Requirement set not found for business scenario");
    const executionEvidenceId = optionalStringArg(input, "executionEvidenceId");
    if (executionEvidenceId) {
      const evidence = context.repository.executionEvidence.find(
        (item) => item.id === executionEvidenceId && item.systemId === optionalStringArg(input, "systemId")
      );
      if (!evidence) throw new Error("Completed execution evidence was not found for this system");
      const trust = context.knowledgeService.recordScenarioEvidenceRun({
        scenarioId,
        evidence,
        observationMode: optionalStringArg(input, "observationMode") === "observe" ? "observe" : "headless"
      });
      if (!trust) throw new Error("Execution evidence could not be uniquely bound to the scenario");
      return {
        status: "recorded",
        trust,
        nextAction: "Review scenario trust status before enabling unattended execution."
      };
    }
    if (input.runPassed === true || input.strongEvidence === true) {
      throw new Error("executionEvidenceId is required; trust must be recorded from completed evidence");
    }
    return {
      status: "recorded",
      trust: context.knowledgeService.recordScenarioStrongRun({
        scenarioId,
        systemId: optionalStringArg(input, "systemId"),
        passed: input.runPassed === true,
        strongEvidence: input.strongEvidence === true,
        requirementHash: optionalStringArg(input, "requirementHash") ?? requirementSet.contentHash,
        systemSnapshotHash: optionalStringArg(input, "systemSnapshotHash"),
        dataPlanHash: optionalStringArg(input, "dataPlanHash"),
        evidenceRefs: stringArrayArg(input, "evidenceRefs"),
        reason: optionalStringArg(input, "reason")
      }),
      nextAction: "Review scenario trust status before enabling unattended execution."
    };
  }
  if (action === "evaluate-mutations") {
    const result = context.knowledgeService.evaluateScenarioMutations({
      mutations: mutationResultsArg(input),
      threshold: optionalNumberArg(input, "mutationThreshold")
    });
    return {
      status: result.verdict,
      ...result,
      nextAction: result.verdict === "pass"
        ? "Record the mutation evidence with the scenario assurance review."
        : "Review survived or blocked mutations before promoting the scenario."
    };
  }
  if (action === "approve-baseline") {
    const requirementSetId = stringArg(input, "requirementSetId");
    const requirementSet = context.repository.requirementSets.find((item) => item.id === requirementSetId);
    if (!requirementSet) throw new Error("Requirement set not found");
    const requiresReceipt = requirementSet.analysisProvider === "host-agent" ||
      requirementSet.analysisProvider === "host-skill";
    if (!optionalBooleanArg(input, "confirm")) {
      try {
        context.knowledgeService.validateRequirementSetApproval(requirementSetId);
      } catch (error) {
        return {
          status: "blocked",
          requirementSetId,
          analysisProvider: requirementSet.analysisProvider ?? "builtin",
          approvalRequired: requiresReceipt,
          reasons: [error instanceof Error ? error.message : String(error)],
          stageEvaluations: context.requirementGate.list({ requirementSetId, status: "current" }),
          requiresConfirmation: false,
          nextAction: "Resolve the baseline blockers before requesting an approval challenge."
        };
      }
      const challenge = requiresReceipt
        ? context.requirementGate.issueApprovalChallenge(requirementSetId)
        : undefined;
      return {
        status: "preview",
        requirementSetId,
        analysisProvider: requirementSet.analysisProvider ?? "builtin",
        baselineFingerprint: context.requirementGate.baselineFingerprint(requirementSetId),
        approvalRequired: requiresReceipt,
        approvalReceiptId: requirementSet.approvalReceiptId,
        approvalChallenge: challenge,
        stageEvaluations: context.requirementGate.list({ requirementSetId, status: "current" }),
        requiresConfirmation: true,
        nextAction: requiresReceipt
          ? "Create an approval receipt from the challenge or host proof, then approve the requirement baseline."
          : "Ask the user to confirm the requirement baseline before approval."
      };
    }
    if (requiresReceipt || optionalStringArg(input, "approvalReceiptId")) {
      const receiptId = optionalStringArg(input, "approvalReceiptId") ?? requirementSet.approvalReceiptId;
      if (!receiptId) throw new Error("A verified approval receipt is required for Host Harness baselines");
      context.requirementGate.verifyApprovalReceipt(requirementSetId, receiptId);
      requirementSet.approvalReceiptId = receiptId;
      requirementSet.baselineFingerprint = context.requirementGate.baselineFingerprint(requirementSetId);
      requirementSet.updatedAt = new Date().toISOString();
      context.repository.persist();
    }
    return context.knowledgeService.approveRequirementSet(requirementSetId);
  }
  if (
    action === "resolve-gap" ||
    action === "dismiss-gap" ||
    action === "reopen-gap"
  ) {
    const knowledgeProjectId = optionalStringArg(input, "knowledgeProjectId");
    const systemId = optionalStringArg(input, "systemId");
    const systemName = optionalStringArg(input, "systemName");
    if (knowledgeProjectId && (systemId || systemName)) {
      throw new Error("Specify either knowledgeProjectId or systemId/systemName for a Gap transition");
    }
    if (knowledgeProjectId && !context.repository.knowledgeProjects.some((project) => project.id === knowledgeProjectId)) {
      throw new Error(`Knowledge project not found: ${knowledgeProjectId}`);
    }
    const resolution = knowledgeProjectId ? undefined : resolveSystemReference(context, input);
    const projectId = knowledgeProjectId ?? resolution!.systemId;
    const gapId = stringArg(input, "gapId");
    const gap = context.repository.gaps.find(
      (item) => item.id === gapId && item.projectId === projectId
    );
    if (!gap) throw new Error("Gap not found");
    if (!optionalBooleanArg(input, "confirm")) {
      return {
        status: "preview",
        operation: action.replace("-gap", ""),
        scope: knowledgeProjectId ? "knowledge-project" : "system",
        gap,
        evidenceRefs: stringArrayArg(input, "evidenceRefs"),
        confirmationNote: optionalStringArg(input, "confirmationNote"),
        requiresConfirmation: true,
        nextAction: "Present the Gap transition, evidence, and note before confirmation."
      };
    }
    const evidenceRefs = stringArrayArg(input, "evidenceRefs");
    if (evidenceRefs.length === 0) {
      throw new Error("Gap transitions require at least one evidence reference");
    }
    return context.service.transitionGap({
      projectId,
      gapId,
      operation:
        action === "resolve-gap"
          ? "resolve"
          : action === "dismiss-gap"
            ? "dismiss"
            : "reopen",
      note: stringArg(input, "confirmationNote"),
      evidenceRefs
    });
  }
  if (action === "confirm-page-binding") {
    if (!optionalBooleanArg(input, "confirm")) {
      return {
        status: "preview",
        testIntentId: stringArg(input, "testIntentId"),
        systemId: stringArg(input, "systemId"),
        pageModelId: stringArg(input, "pageModelId"),
        role: optionalStringArg(input, "role"),
        requiresConfirmation: true,
        nextAction: "Present the selected page and evidence before confirming the binding."
      };
    }
    return context.knowledgeService.confirmPageBinding({
      testIntentId: stringArg(input, "testIntentId"),
      systemId: stringArg(input, "systemId"),
      pageModelId: stringArg(input, "pageModelId"),
      role: optionalStringArg(input, "role"),
      note: stringArg(input, "confirmationNote")
    });
  }
  if (action === "create-onboarding-plan") {
    const result = context.onboardingPlans.create({
      requirementSetId: stringArg(input, "requirementSetId"),
      systemId: stringArg(input, "systemId"),
      actorJourney: actorJourneyArg(input),
      allowedRoutes: stringArrayArg(input, "allowedRoutes"),
      allowedActions:
        input.explorationPlanActions === undefined
          ? undefined
          : explorationPlanActionsArg(input),
      forbiddenActions: stringArrayArg(input, "forbiddenActions"),
      cleanupPolicy: explorationCleanupPolicyArg(input, "cleanupPolicy"),
      maxWrites: optionalNumberArg(input, "maxWrites"),
      maxDurationMs: optionalNumberArg(input, "maxDurationMs")
    });
    return {
      status: result.onboardingPlan.status,
      ...result,
      requiresConfirmation: result.onboardingPlan.status === "draft" && !result.baselineChanged,
      nextAction: onboardingCreateNextAction(
        result.onboardingPlan.status,
        result.baselineChanged ?? false
      )
    };
  }
  if (action === "approve-onboarding-plan") {
    const onboardingPlan = context.onboardingPlans.get(
      stringArg(input, "onboardingPlanId")
    );
    const approvalStage = onboardingApprovalStageArg(input);
    const explorationPlan = context.statefulExplorationPlans.get(
      onboardingPlan.explorationPlanId
    );
    if (!optionalBooleanArg(input, "confirm")) {
      return {
        status: "preview",
        onboardingPlan,
        explorationPlan,
        approvalStage,
        requiresConfirmation: true,
        nextAction:
          approvalStage === "execution"
            ? "Present complete coverage, action-level requirement and system evidence, data readiness, and residual risks before execution approval."
            : "Present the requirement baseline, uncovered items, roles, routes, writes, duration, and cleanup policy before exploration approval."
      };
    }
    return {
      status: "approved",
      ...context.onboardingPlans.approve({
        onboardingPlanId: onboardingPlan.id,
        note: stringArg(input, "confirmationNote"),
        approvedBy: stringArg(input, "confirmedBy"),
        stage: approvalStage
      }),
      approvalStage,
      nextAction: approvalStage === "execution"
        ? "run-requirement-suite"
        : "start-onboarding-plan"
    };
  }
  if (action === "start-onboarding-plan") {
    const result = context.onboardingPlans.start(
      stringArg(input, "onboardingPlanId")
    );
    return {
      ...result,
      nextAction:
        result.status === "needs-data"
          ? "prepare-test-data"
          : "execute-requirement-directed-exploration"
    };
  }
  if (action === "create-exploration-plan") {
    const plan = context.statefulExplorationPlans.create({
      explorationTaskIds: stringArrayArg(input, "explorationTaskIds"),
      actorJourney: actorJourneyArg(input),
      allowedRoutes: stringArrayArg(input, "allowedRoutes"),
      allowedActions: explorationPlanActionsArg(input),
      forbiddenActions: stringArrayArg(input, "forbiddenActions"),
      cleanupPolicy: explorationCleanupPolicyArg(input, "cleanupPolicy"),
      maxWrites: optionalNumberArg(input, "maxWrites"),
      maxDurationMs: optionalNumberArg(input, "maxDurationMs")
    });
    return {
      status: plan.status,
      plan,
      requiresConfirmation: true,
      nextAction: "approve-exploration-plan"
    };
  }
  if (action === "approve-exploration-plan") {
    const plan = context.statefulExplorationPlans.get(
      stringArg(input, "explorationPlanId")
    );
    if (!optionalBooleanArg(input, "confirm")) {
      return {
        status: "preview",
        plan,
        requiresConfirmation: true,
        nextAction:
          "Present the roles, routes, writes, data policy, duration, and cleanup policy before one explicit approval."
      };
    }
    return {
      status: "approved",
      plan: context.statefulExplorationPlans.approve({
        planId: plan.id,
        note: stringArg(input, "confirmationNote"),
        approvedBy: stringArg(input, "confirmedBy")
      }),
      nextAction: "start-exploration-plan"
    };
  }
  if (action === "cancel-exploration-plan") {
    const plan = context.statefulExplorationPlans.get(
      stringArg(input, "explorationPlanId")
    );
    if (!optionalBooleanArg(input, "confirm")) {
      return {
        status: "preview",
        plan,
        requiresConfirmation: true,
        nextAction: "Confirm cancellation with a reason, or approve the exploration plan."
      };
    }
    const cancelledPlan = context.statefulExplorationPlans.cancel({
      planId: plan.id,
      note: stringArg(input, "confirmationNote")
    });
    return {
      status: "cancelled",
      plan: cancelledPlan,
      onboardingPlan: context.onboardingPlans.syncFromExploration(cancelledPlan.id),
      nextAction: "review-compile-run"
    };
  }
  if (action === "start-exploration-plan") {
    const result = context.statefulExplorationPlans.start(
      stringArg(input, "explorationPlanId")
    );
    return {
      ...result,
      nextAction:
        result.status === "needs-data"
          ? "prepare-test-data"
          : "execute-authorized-exploration"
    };
  }
  if (action === "submit-exploration-result") {
    const result = await context.statefulExplorationPlans.submit(
      explorationResultArg(input)
    );
    const onboardingPlan = context.onboardingPlans.syncFromExploration(result.plan.id);
    return {
      ...result,
      onboardingPlan,
      status: result.plan.status,
      nextAction:
        result.plan.status === "completed"
          ? "review-resumed-compile-run"
          : "review-exploration-gap"
    };
  }
  if (action === "resolve-exploration-task") {
    const taskId = stringArg(input, "explorationTaskId");
    const outcome = explorationTaskOutcomeArg(input, "explorationOutcome");
    const task = context.repository.explorationTasks.find((item) => item.id === taskId);
    if (!task) throw new Error("Exploration task not found");
    if (!optionalBooleanArg(input, "confirm")) {
      return {
        status: "preview",
        task,
        outcome,
        evidenceRefs: stringArrayArg(input, "evidenceRefs"),
        selectedTransitionRefs: stringArrayArg(input, "selectedTransitionRefs"),
        requiresConfirmation: true,
        nextAction: "Present the exploration evidence and outcome before confirmation."
      };
    }
    const result = context.knowledgeService.resolveExplorationTask({
      taskId,
      outcome,
      evidenceRefs: stringArrayArg(input, "evidenceRefs"),
        selectedTransitionRefs: stringArrayArg(input, "selectedTransitionRefs"),
      failureReason: optionalStringArg(input, "failureReason")
    });
    const resumedStatus = result.resumed?.executableCase.status;
    return {
      ...result,
      status: outcome,
      nextAction:
        outcome === "failed"
          ? "review-gap"
          : outcome === "cancelled"
            ? "review-compile-run"
            : resumedStatus === "ready"
              ? "preview-requirement-suite"
              : resumedStatus === "needs-data"
                ? "resolve-test-data"
                : "review-exploration-task"
    };
  }
  if (action === "resolve-test-data") {
    const executableCaseId = stringArg(input, "executableCaseId");
    const executableCase = context.repository.executableCases.find(
      (item) => item.id === executableCaseId
    );
    if (!executableCase) throw new Error("Executable case not found");
    if (!optionalBooleanArg(input, "confirm")) {
      return {
        status: "preview",
        executableCaseId,
        testDataPlan: executableCase.dataPlan,
        requiresConfirmation: true,
        nextAction:
          "Present lookup, reuse, create, cleanup, and value decisions before resolving test data."
      };
    }
    return context.knowledgeService.resolveExecutableCaseTestData({
      executableCaseId,
      resolutions: testDataResolutionsArg(input, "testDataResolutions")
    });
  }
  if (action === "prepare-test-data") {
    return context.testDataProvider.prepare({
      knowledgeProjectId: stringArg(input, "knowledgeProjectId"),
      systemId: stringArg(input, "systemId"),
      executableCaseId: stringArg(input, "executableCaseId"),
      confirm: optionalBooleanArg(input, "confirm"),
      allowCreate: optionalBooleanArg(input, "allowCreate"),
      automatic: optionalBooleanArg(input, "automatic")
    });
  }
  if (action === "submit-test-data") {
    const submitted = await context.testDataProvider.submit({
      taskId: stringArg(input, "taskId"),
      status: testDataTaskResultStatusArg(input, "taskStatus"),
      decision: optionalTestDataProviderDecisionArg(input, "dataDecision"),
      reference: optionalStringArg(input, "dataReference"),
      value: optionalStringArg(input, "dataValue"),
      sourceRefs: stringArrayArg(input, "sourceRefs"),
      error: optionalStringArg(input, "error")
    });
    return continueRequirementSuiteAfterTestData(context, submitted);
  }
  if (action === "prepare-execution") {
    const executableCaseId = stringArg(input, "executableCaseId");
    const confirm = optionalBooleanArg(input, "confirm");
    const executableCase = context.repository.executableCases.find(
      (item) => item.id === executableCaseId
    );
    if (!executableCase) throw new Error("Executable case not found");
    if (
      confirm &&
      executableCase.dataPlan?.verdict === "ready" &&
      executableCase.dataPlan.requiresConfirmation &&
      !executableCase.dataPlan.confirmedAt
    ) {
      context.knowledgeService.confirmExecutableCaseTestData(executableCase.id);
    }
    return context.executionPreflight.prepare({
      knowledgeProjectId: stringArg(input, "knowledgeProjectId"),
      systemId: stringArg(input, "systemId"),
      executableCaseId,
      authProfileId: optionalStringArg(input, "authProfileId"),
      actorJourney: actorJourneyArg(input),
      confirm
    });
  }
  if (action === "explore-system") {
    return context.systemExploration.explore({
      knowledgeProjectId: stringArg(input, "knowledgeProjectId"),
      systemId: stringArg(input, "systemId"),
      authProfileId: optionalStringArg(input, "authProfileId"),
      startUrl: optionalStringArg(input, "startUrl"),
      explorationMode: systemExplorationModeArg(input, "explorationMode"),
      scenario: explorationScenarioArg(input),
      interactionMode: explorationInteractionModeArg(input, "interactionMode"),
      budget: {
        maxPages: optionalNumberArg(input, "maxPages"),
        maxDepth: optionalNumberArg(input, "maxDepth"),
        maxDurationMs: optionalNumberArg(input, "maxDurationMs"),
        maxInteractionsPerPage: optionalNumberArg(input, "maxInteractionsPerPage")
      }
    });
  }
  if (action === "record-observation") {
    return context.knowledgeService.recordSystemObservation({
      projectId: stringArg(input, "knowledgeProjectId"),
      systemId: stringArg(input, "systemId"),
      type: knowledgeNodeTypeArg(input, "observationType"),
      title: stringArg(input, "title"),
      content: stringArg(input, "content"),
      module: optionalStringArg(input, "module") ?? "General",
      sourceRefs: stringArrayArg(input, "sourceRefs"),
      confidence: optionalNumberArg(input, "confidence")
    });
  }
  if (action === "record-page-evidence") {
    const knowledgeProjectId = stringArg(input, "knowledgeProjectId");
    const systemId = stringArg(input, "systemId");
    context.knowledgeService.getSystemBrain(knowledgeProjectId, systemId);
    const evidence = pageEvidenceArg(input, "pageEvidence");
    assertSystemEvidenceUrl(context, systemId, evidence.finalUrl);
    const authProfileId = optionalStringArg(input, "authProfileId");
    if (
      authProfileId &&
      !context.repository.authProfiles.some(
        (profile) => profile.id === authProfileId && profile.projectId === systemId
      )
    ) {
      throw new Error("Auth profile does not belong to the selected business system");
    }
    const result = context.service.discoverPageModel({
      projectId: systemId,
      route: evidence.finalUrl,
      name: evidence.title,
      authProfileId: authProfileId ?? "",
      domText: evidence.domText,
      captureMode: "browser",
      targetUrl: evidence.finalUrl,
      browserCapture: evidence
    });
    return {
      ...result,
      brain: await context.knowledgeService.refreshSystemBrain(
        knowledgeProjectId,
        systemId
      )
    };
  }
  if (action === "record-interaction-evidence") {
    const evidence = interactionEvidenceArg(input, "interactionEvidence");
    return context.systemExploration.recordInteractionEvidence({
      knowledgeProjectId: stringArg(input, "knowledgeProjectId"),
      systemId: stringArg(input, "systemId"),
      pageModelId: stringArg(input, "pageModelId"),
      ...evidence
    });
  }
  if (action === "record-training-evidence") {
    const knowledgeProjectId = stringArg(input, "knowledgeProjectId");
    const systemId = stringArg(input, "systemId");
    const pageModelId = stringArg(input, "pageModelId");
    const brain = context.knowledgeService.getSystemBrain(knowledgeProjectId, systemId);
    const page = brain.pages.find((candidate) => candidate.pageModelId === pageModelId);
    if (!page) {
      throw new Error("Page model does not belong to the selected System Brain");
    }
    const evidence = trainingEvidenceArg(input, "trainingEvidence");
    if (
      evidence.actions.some(
        (action) => !page.locators.some((locator) => locator.id === action.targetLocatorId)
      )
    ) {
      throw new Error("Training action locator does not belong to the selected page model");
    }
    const session = context.service.createTrainingSession({ projectId: systemId, pageModelId });
    const result = context.service.completeTrainingSession({
      sessionId: session.id,
      actions: evidence.actions,
      apiRequests: evidence.apiRequests,
      artifacts: evidence.artifacts
    });
    return {
      ...result,
      brain: await context.knowledgeService.refreshSystemBrain(
        knowledgeProjectId,
        systemId
      )
    };
  }
  if (action === "refresh-system-brain") {
    return context.knowledgeService.refreshSystemBrain(
      stringArg(input, "knowledgeProjectId"),
      stringArg(input, "systemId")
    );
  }
  if (action === "confirm-system-snapshot") {
    if (!optionalBooleanArg(input, "confirm")) {
      const snapshotId = stringArg(input, "systemBrainSnapshotId");
      const snapshot = context.repository.systemBrainSnapshots.find(
        (item) => item.id === snapshotId
      );
      if (!snapshot) throw new Error("System Brain snapshot not found");
      return {
        status: "preview",
        snapshot,
        requiresConfirmation: true,
        nextAction: "Confirm this System Brain snapshot before using it as a compilation baseline."
      };
    }
    return {
      status: "confirmed",
      snapshot: context.systemBrainSnapshots.confirm(
        stringArg(input, "systemBrainSnapshotId"),
        optionalStringArg(input, "confirmedBy") ?? "agent-user"
      ),
      nextAction: "Recompile cases affected by the confirmed System Brain snapshot."
    };
  }
  if (action === "reconcile-system-brain") {
    const result = context.knowledgeService.reconcileSystemBrain(
      stringArg(input, "knowledgeProjectId"),
      stringArg(input, "systemId"),
      stringArg(input, "requirementSetId"),
      optionalStringArg(input, "systemBrainSnapshotId")
    );
    return responseModeArg(input) === "summary"
      ? {
          status: "reconciled",
          systemId: result.systemId,
          requirementSetId: result.requirementSetId,
          expectedCount: result.expectedCount,
          observedCount: result.observedCount,
          summary: result.summary,
          unresolved: result.unresolved,
          nextAction: result.unresolved.length > 0
            ? "Review unresolved System Brain bindings."
            : "Review and confirm the semantic bindings."
        }
      : result;
  }
  if (action === "confirm-semantic-binding") {
    const bindingId = stringArg(input, "semanticBindingId");
    const binding = context.repository.semanticBindings.find((item) => item.id === bindingId);
    if (!binding) throw new Error("Semantic binding not found");
    if (!optionalBooleanArg(input, "confirm")) {
      return {
        status: "preview",
        binding,
        requiresConfirmation: true,
        nextAction: "Confirm the semantic binding only when expected and observed behavior agree."
      };
    }
    return {
      status: "confirmed",
      binding: context.knowledgeService.confirmSemanticBinding(
        bindingId,
        optionalStringArg(input, "confirmedBy") ?? "agent-user"
      ),
      nextAction: "Reconcile affected cases before compiling or executing them."
    };
  }
  if (action === "recompile-stale-cases") {
    return context.knowledgeService.recompileStaleSystemBrainCases({
      projectId: stringArg(input, "knowledgeProjectId"),
      systemId: stringArg(input, "systemId"),
      changeSetId: optionalStringArg(input, "systemBrainChangeSetId")
    });
  }
  const selectedIntentIds = stringArrayArg(input, "testIntentIds");
  const selectedModules = stringArrayArg(input, "modules");
  const requirementSetId = optionalStringArg(input, "requirementSetId");
  if (requirementSetId || selectedIntentIds.length > 0 || selectedModules.length > 0) {
    const result = context.knowledgeService.compileExecutableCasesBatch({
      requirementSetId,
      testIntentIds: selectedIntentIds,
      modules: selectedModules,
      systemId: optionalStringArg(input, "systemId")
    });
    const summary = compileRunSummary(result.compileRun);
    return responseModeArg(input) === "summary"
      ? summary
      : {
          ...result,
          summary,
          nextAction:
            result.compileRun.blocked + result.compileRun.ambiguous + result.compileRun.needsExploration + result.compileRun.needsData + result.compileRun.skipped > 0
              ? "review-compile-run"
              : "preview-requirement-suite"
        };
  }
  const compiled = context.knowledgeService.compileExecutableCases(
    stringArg(input, "testIntentId"),
    optionalStringArg(input, "systemId")
  );
  return {
    ...compiled,
    workflowPath: compiled.executableCase.pathPlan,
    stateActions: compiled.executableCase.statePlan,
    testDataPlan: compiled.executableCase.dataPlan,
    nextAction:
      compiled.executableCase.status === "ready"
        ? "preview-requirement-suite"
        : compiled.executableCase.status === "needs-data"
          ? "resolve-test-data"
          : compiled.executableCase.status === "needs-exploration" || compiled.executableCase.status === "ambiguous"
            ? "review-exploration-task"
            : "review-compile-blocker"
  };
}

export async function recordExecutionActionFacade(
  context: BrainCreatorMcpContext,
  input: Record<string, unknown>,
  operation: "record-execution-action" | "reconcile-execution-action"
) {
  const requirementSuiteRunId = optionalStringArg(input, "requirementSuiteRunId");
  const caseSuiteId = optionalStringArg(input, "caseSuiteId");
  if (Boolean(requirementSuiteRunId) === Boolean(caseSuiteId)) {
    throw new Error(
      "Execution action requires exactly one of requirementSuiteRunId or caseSuiteId"
    );
  }

  const run = requirementSuiteRunId
    ? context.repository.requirementSuiteRuns.find((item) => item.id === requirementSuiteRunId)
    : undefined;
  const suite = caseSuiteId
    ? context.repository.caseSuites.find((item) => item.id === caseSuiteId)
    : undefined;
  const systemId = optionalStringArg(input, "systemId");
  const resolvedSystemId = run?.systemId ?? suite?.systemId;
  if (!resolvedSystemId) {
    throw new Error("Execution suite was not found");
  }
  if (systemId && systemId !== resolvedSystemId) {
    throw new Error("Execution action system does not match the suite system");
  }
  if (requirementSuiteRunId && !run) throw new Error("Requirement suite run not found");
  if (caseSuiteId && !suite) throw new Error("Document suite not found");

  const executableCaseId = optionalStringArg(input, "executableCaseId");
  const caseNo = optionalStringArg(input, "caseNo");
  const requestedEvaluationTrialId = optionalStringArg(input, "evaluationTrialId");
  const requestedBusinessScenarioId = optionalStringArg(input, "businessScenarioId");
  if (run?.evaluationTrialId && requestedEvaluationTrialId &&
      run.evaluationTrialId !== requestedEvaluationTrialId) {
    throw new Error("Execution action Trial does not match its requirement suite");
  }
  if (run && executableCaseId && !run.caseRuns.some((item) => item.executableCaseId === executableCaseId)) {
    throw new Error("Execution action case does not belong to the requirement suite");
  }
  if (suite && caseNo && !suite.selectedCaseNos.includes(caseNo)) {
    throw new Error("Execution action case does not belong to the document suite");
  }
  if (run && caseNo) throw new Error("Requirement suite actions must use executableCaseId");
  if (suite && executableCaseId) throw new Error("Document suite actions must use caseNo");

  const runScenarioBinding = run?.evaluationTrialId && executableCaseId
    ? authCheckpointBinding(context.repository, {
        systemId: resolvedSystemId,
        requirementSuiteRunId,
        executableCaseId
      }).businessScenarioId
    : undefined;
  if (runScenarioBinding && requestedBusinessScenarioId &&
      runScenarioBinding !== requestedBusinessScenarioId) {
    throw new Error("Execution action scenario does not match its uniquely mapped Trial scenario");
  }
  let actionEvaluationTrialId = run?.evaluationTrialId ?? requestedEvaluationTrialId;
  let actionBusinessScenarioId = runScenarioBinding ?? requestedBusinessScenarioId;
  const validateActionTrialBinding = () => {
    if (!actionEvaluationTrialId) {
      if (actionBusinessScenarioId) throw new Error("Execution action scenario requires an evaluation Trial binding");
      return;
    }
    const trial = context.repository.evaluationTrials.find((item) => item.id === actionEvaluationTrialId);
    if (!trial || trial.systemId !== resolvedSystemId) {
      throw new Error("Execution action Trial does not match the business system");
    }
    if (actionBusinessScenarioId) {
      const scenario = context.repository.businessScenarios.find((item) =>
        item.id === actionBusinessScenarioId && item.knowledgeProjectId === trial.knowledgeProjectId
      );
      if (!trial.executionScope?.businessScenarioIds.includes(actionBusinessScenarioId) || !scenario) {
        throw new Error("Execution action scenario is outside the bound Trial scope");
      }
    }
  };
  if (operation !== "reconcile-execution-action" || actionEvaluationTrialId) {
    validateActionTrialBinding();
  }

  const requestedPhase = optionalStringArg(input, "actionPhase");
  const phase = operation === "reconcile-execution-action"
    ? "reconciled" as const
    : executionActionPhaseArg(input, "actionPhase");
  if (operation === "record-execution-action" && phase === "confirmed") {
    throw new Error("A sent write cannot be marked confirmed directly; use reconcile-execution-action with verified target evidence");
  }
  const actionKey = stringArg(input, "actionKey");
  let actionSemantic = stringArg(input, "actionSemantic");
  let actionEntityReference = optionalStringArg(input, "entityReference");
  let actionPostcondition = optionalStringArg(input, "actionPostcondition");
  let actionStepId = optionalStringArg(input, "actionStepId");
  let actionEvidenceRefs = stringArrayArg(input, "actionEvidenceRefs");
  let actionEvidenceArtifacts: Array<{ path: string; sha256: string }> = [];
  let postconditionVerification: PostconditionVerification | undefined;
  if (operation === "reconcile-execution-action") {
    if (
      requestedPhase &&
      requestedPhase !== "sent" &&
      requestedPhase !== "reconciliation-required"
    ) {
      throw new Error("Reconciliation must resolve a sent or reconciliation-required action");
    }
    if (optionalBooleanArg(input, "confirm") !== true) {
      return {
        status: "preview",
        actionKey,
        actionSemantic,
        requirementSuiteRunId,
        caseSuiteId,
        executableCaseId,
        caseNo,
        requiresConfirmation: true,
        nextAction: "Confirm the postcondition evidence before allowing the suite to continue."
      };
    }
    const runId = requirementSuiteRunId ?? caseSuiteId!;
    const previousAction = context.runLedger.latestAction(runId, actionKey);
    if (!previousAction ||
        (previousAction.actionPhase !== "sent" && previousAction.actionPhase !== "reconciliation-required")) {
      throw new Error("Reconciliation requires an unresolved action from the Run Ledger");
    }
    if (previousAction.systemId !== resolvedSystemId ||
        previousAction.executableCaseId !== executableCaseId ||
        previousAction.caseNo !== caseNo) {
      throw new Error("Reconciliation action does not match its original system and case binding");
    }
    if (previousAction.evaluationTrialId && actionEvaluationTrialId &&
        previousAction.evaluationTrialId !== actionEvaluationTrialId) {
      throw new Error("Reconciliation cannot change the original Trial binding");
    }
    if (previousAction.evaluationTrialId) actionEvaluationTrialId = previousAction.evaluationTrialId;
    if (previousAction.businessScenarioId && actionBusinessScenarioId &&
        previousAction.businessScenarioId !== actionBusinessScenarioId) {
      throw new Error("Reconciliation cannot change the original business scenario binding");
    }
    if (previousAction.businessScenarioId) actionBusinessScenarioId = previousAction.businessScenarioId;
    if (previousAction.stepId && actionStepId && previousAction.stepId !== actionStepId) {
      throw new Error("Reconciliation cannot change the original action step binding");
    }
    if (previousAction.stepId) actionStepId = previousAction.stepId;
    if (!actionEvaluationTrialId && !optionalBooleanArg(input, "autoVerify")) {
      const activeTrials = context.repository.evaluationTrials.filter((trial) =>
        trial.systemId === resolvedSystemId && trial.status === "active"
      );
      if (activeTrials.length > 1) {
        throw new Error("Manual recovery must specify an evaluationTrialId when multiple active Trials match this system");
      }
      if (activeTrials.length === 1) actionEvaluationTrialId = activeTrials[0]!.id;
    }
    validateActionTrialBinding();
    if (previousAction.actionSemantic && actionSemantic !== previousAction.actionSemantic) {
      throw new Error("Reconciliation cannot change the original action semantic");
    }
    if (actionPostcondition && previousAction.actionPostcondition &&
        actionPostcondition !== previousAction.actionPostcondition) {
      throw new Error("Reconciliation cannot change the original action postcondition");
    }
    if (actionEntityReference && previousAction.entityReference &&
        actionEntityReference !== previousAction.entityReference) {
      throw new Error("Reconciliation cannot change the original entity reference");
    }
    actionSemantic = previousAction.actionSemantic ?? actionSemantic;
    actionEntityReference = previousAction.entityReference ?? actionEntityReference;
    actionPostcondition = previousAction.actionPostcondition ?? actionPostcondition;
    if (optionalBooleanArg(input, "autoVerify")) {
      if (!actionPostcondition) {
        throw new Error("Automatic reconciliation requires actionPostcondition or a pending action postcondition");
      }
      let verification = context.postconditionVerifier
        ? await context.postconditionVerifier({
            systemId: resolvedSystemId,
            evaluationTrialId: actionEvaluationTrialId,
            businessScenarioId: actionBusinessScenarioId,
            requirementSuiteRunId,
            caseSuiteId,
            executableCaseId,
            caseNo,
            stepId: actionStepId,
            actionKey,
            actionSemantic,
            entityReference: actionEntityReference,
            postcondition: actionPostcondition
          }).catch((error) => ({
            status: "unavailable" as const,
            reason: error instanceof Error ? error.message : String(error)
          }))
        : {
            status: "unavailable" as const,
            reason: "No postcondition verifier is configured for this runtime."
          };
      if (verification.status === "confirmed") {
        try {
          actionEvidenceArtifacts = await validatePostconditionVerificationArtifacts({
            root: join(context.workDir, ".brain-creator"),
            verification,
            binding: {
              evaluationTrialId: actionEvaluationTrialId,
              businessScenarioId: actionBusinessScenarioId,
              requirementSuiteRunId,
              caseSuiteId,
              executableCaseId,
              caseNo,
              stepId: actionStepId
            },
            systemId: resolvedSystemId,
            actionKey,
            actionSemantic,
            entityReference: actionEntityReference,
            postcondition: actionPostcondition
          });
          verification = { ...verification, evidenceArtifacts: actionEvidenceArtifacts };
        } catch (error) {
          verification = {
            status: "unavailable",
            reason: error instanceof Error ? error.message : String(error)
          };
          actionEvidenceArtifacts = [];
        }
      }
      const safeVerification = redactPostconditionVerification(
        context,
        resolvedSystemId,
        verification
      );
      postconditionVerification = safeVerification;
      if (safeVerification.status !== "confirmed") {
        const entry = context.runLedger.recordAction({
          runType: run ? "requirement-suite" : "document-suite",
          knowledgeProjectId: run?.knowledgeProjectId,
          systemId: resolvedSystemId,
          evaluationTrialId: actionEvaluationTrialId,
          businessScenarioId: actionBusinessScenarioId,
          requirementSuiteRunId,
          caseSuiteId,
          caseSourceId: suite?.sourceId,
          executableCaseId,
          caseNo,
          stepId: actionStepId,
          stepTitle: optionalStringArg(input, "actionStepTitle"),
          actionKey,
          phase: "reconciliation-required",
          actionSemantic,
          entityReference: actionEntityReference,
          postcondition: actionPostcondition,
          evidenceRefs: safeVerification.evidenceRefs ?? [],
          operator: optionalStringArg(input, "operator"),
          provider: optionalStringArg(input, "provider"),
          sessionId: optionalStringArg(input, "sessionId"),
          traceId: optionalStringArg(input, "traceId")
        });
        return {
          status: "waiting",
          action: entry,
          verification: safeVerification,
          pendingAction: {
            actionKey: entry.actionKey,
            phase: entry.actionPhase,
            nextAction: "reconcile-action"
          },
          nextAction: "reconcile-action"
        };
      }
      actionEvidenceRefs = safeVerification.evidenceRefs ?? [];
      if (actionEvidenceRefs.length === 0) {
        throw new Error("Confirmed postcondition verification must return action evidence references");
      }
    } else if (actionEvidenceRefs.length === 0) {
      throw new Error("Action reconciliation requires actionEvidenceRefs");
    } else {
      const operator = optionalStringArg(input, "operator");
      if (!operator) {
        throw new Error("Manual action reconciliation requires an explicit operator");
      }
      if (!actionPostcondition) {
        throw new Error("Manual action reconciliation requires the original postcondition");
      }
      const requestedArtifacts = optionalObjectArrayArg(input, "actionEvidenceArtifacts").map((artifact, index) => {
        if (typeof artifact.path !== "string" || !artifact.path.trim() ||
            typeof artifact.sha256 !== "string" || !/^[a-f0-9]{64}$/i.test(artifact.sha256)) {
          throw new Error(`actionEvidenceArtifacts[${index}] requires a path and SHA-256 hash`);
        }
        return { path: artifact.path, sha256: artifact.sha256 };
      });
      if (requestedArtifacts.length === 0) {
        throw new Error("Manual action reconciliation requires at least one hash-bound evidence artifact");
      }
      actionEvidenceArtifacts = await validateManualPostconditionEvidenceArtifacts({
        root: join(context.workDir, ".brain-creator"),
        artifacts: requestedArtifacts,
        binding: {
          evaluationTrialId: actionEvaluationTrialId,
          businessScenarioId: actionBusinessScenarioId,
          requirementSuiteRunId,
          caseSuiteId,
          executableCaseId,
          caseNo,
          stepId: actionStepId
        },
        systemId: resolvedSystemId,
        actionKey,
        actionSemantic,
        entityReference: actionEntityReference,
        postcondition: actionPostcondition,
        operator
      });
    }
    if (!actionPostcondition) throw new Error("Action reconciliation requires actionPostcondition");
  } else if (phase === "confirmed") {
    if (!optionalStringArg(input, "actionPostcondition")) {
      throw new Error("Confirmed execution action requires actionPostcondition");
    }
    if (actionEvidenceRefs.length === 0) {
      throw new Error("Confirmed execution action requires actionEvidenceRefs");
    }
  } else if (phase === "reconciled") {
    throw new Error("Use reconcile-execution-action for the reconciled phase");
  }

  const manualRecoveryBinding = operation === "reconcile-execution-action" && actionEvaluationTrialId &&
      optionalBooleanArg(input, "autoVerify") !== true
    ? {
        evaluationTrialId: actionEvaluationTrialId,
        businessScenarioId: actionBusinessScenarioId
      }
    : undefined;
  const recordAction = () => {
    const entry = context.runLedger.recordAction({
      runType: run ? "requirement-suite" : "document-suite",
      knowledgeProjectId: run?.knowledgeProjectId,
      systemId: resolvedSystemId,
      evaluationTrialId: actionEvaluationTrialId,
      businessScenarioId: actionBusinessScenarioId,
      requirementSuiteRunId,
      caseSuiteId,
      caseSourceId: suite?.sourceId,
      executableCaseId,
      caseNo,
      stepId: actionStepId,
      stepTitle: optionalStringArg(input, "actionStepTitle"),
      actionKey,
      phase: operation === "reconcile-execution-action" ? "reconciled" : phase,
      ...(operation === "reconcile-execution-action"
        ? { recoveryMode: optionalBooleanArg(input, "autoVerify") === true ? "automatic" as const : "manual" as const }
        : {}),
      actionSemantic,
      entityReference: actionEntityReference,
      postcondition: actionPostcondition,
      evidenceRefs: actionEvidenceRefs,
      evidenceArtifacts: actionEvidenceArtifacts,
      operator: optionalStringArg(input, "operator"),
      provider: optionalStringArg(input, "provider"),
      sessionId: optionalStringArg(input, "sessionId"),
      traceId: optionalStringArg(input, "traceId")
    });
    if (manualRecoveryBinding) {
      context.evaluationIntegrity.recordIntervention({
        trialId: manualRecoveryBinding.evaluationTrialId,
        category: "manual-recovery",
        actor: optionalStringArg(input, "operator") ?? "user",
        note: `Manually reconciled execution action ${actionKey}`,
        evidenceRefs: [
          `run-ledger:${entry.id}`,
          ...actionEvidenceRefs,
          ...actionEvidenceArtifacts.map((artifact) => `artifact:${artifact.path}#sha256=${artifact.sha256}`)
        ],
        ...(manualRecoveryBinding.businessScenarioId
          ? { businessScenarioIds: [manualRecoveryBinding.businessScenarioId] }
          : {})
      });
    }
    return entry;
  };
  const entry = manualRecoveryBinding
    ? context.repository.transaction(recordAction)
    : recordAction();
  const waiting = entry.actionPhase === "sent" || entry.actionPhase === "reconciliation-required";
  const continuationAction = run
    ? "continue-requirement-suite"
    : "continue-case-source-suite";
  return {
    status: operation === "reconcile-execution-action" ? "reconciled" : waiting ? "waiting" : "recorded",
    action: entry,
    ...(postconditionVerification ? { verification: postconditionVerification } : {}),
    ...(waiting ? {
      pendingAction: {
        actionKey: entry.actionKey,
        phase: entry.actionPhase,
        nextAction: "reconcile-action"
      }
    } : {}),
    nextAction: waiting ? "reconcile-action" : continuationAction
  };
}

export function adjudicateRequirementDesign(
  context: BrainCreatorMcpContext,
  requirementSet: NonNullable<BrainCreatorMcpContext["repository"]["requirementSets"][number]>,
  provider: "host-agent" | "host-skill",
  design: Awaited<ReturnType<KnowledgeService["generateTestDesign"]>>
) {
  const source = context.repository.requirementSources.find((item) => item.id === requirementSet.sourceId);
  if (!source) throw new Error("Requirement source not found");
  const inputHash = createHash("sha256")
    .update(JSON.stringify({
      analysis: design.analysis,
      workflowModels: design.workflowModels,
      stateMachineModels: design.stateMachineModels,
      businessObjectModels: design.businessObjectModels,
      decisionTableModels: design.decisionTableModels,
      testIntents: design.testIntents,
      coverage: design.coverage
    }))
    .digest("hex");
  const adjudication = context.requirementGate.adjudicateBaseline({
    requirementSetId: requirementSet.id,
    provider,
    evaluation: {
      verdict: design.evaluation.verdict === "needs-user" ? "needs-review" : design.evaluation.verdict,
      score: design.evaluation.score,
      reasons: design.evaluation.reasons,
      affectedAssetIds: [requirementSet.id],
      evidenceRefs: design.analysis.clauses.flatMap((clause) => clause.sourceRefs),
      nextActions: design.evaluation.requiredActions
    },
    supportRefs: [
      ...design.analysis.clauses.flatMap((clause) => clause.sourceRefs),
      ...design.testIntents.flatMap((intent) => intent.requirementRefs)
    ],
    inputHashes: [source.contentHash, inputHash],
    policyVersion: design.analysis.policyVersion
  });
  requirementSet.analysisProvider = provider;
  requirementSet.evaluationStageIds = adjudication.stageEvaluations.map((record) => record.id);
  requirementSet.baselineFingerprint = context.requirementGate.baselineFingerprint(requirementSet.id);
  context.repository.persist();
  return {
    ...design,
    status: adjudication.evaluation.verdict === "pass"
      ? "succeeded"
      : adjudication.evaluation.verdict,
    evaluation: adjudication.evaluation,
    stageEvaluations: adjudication.stageEvaluations,
    adjudication: adjudication.record
  };
}

export async function executeNextRequirementSuiteCase(
  context: BrainCreatorMcpContext,
  requirementSuiteRunId: string,
  input: { maxHealAttempts?: number }
): Promise<Record<string, unknown>> {
  let requirementSuiteRun = context.requirementSuiteRuns.get(
    requirementSuiteRunId
  );
  if (requirementSuiteRun.evaluationTrialId) {
    const binding = context.evaluationIntegrity.validateExecutionBinding({
      trialId: requirementSuiteRun.evaluationTrialId,
      knowledgeProjectId: requirementSuiteRun.knowledgeProjectId,
      systemId: requirementSuiteRun.systemId,
      executableCaseIds: requirementSuiteRun.caseRuns.map((item) => item.executableCaseId),
      requirementSetIds: requirementSuiteRun.requirementSetIds,
      runtimeBuildIdentity: evaluationRuntimeBuildIdentity(context)
    });
    if (!binding.valid) {
      throw new Error(`Evaluation trial binding is invalid: ${binding.reasons.join("; ")}`);
    }
  }
  const pendingAction = context.runLedger.latestUnresolvedAction(
    requirementSuiteRunId
  );
  if (pendingAction) {
    return {
      mode: "requirement-suite",
      status: "waiting",
      requirementSuiteRun,
      currentExecutableCaseId: pendingAction.executableCaseId,
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
      nextAction: "reconcile-action"
    };
  }
  const activeCase = requirementSuiteRun.caseRuns.find(
    (item) =>
      item.status === "running" ||
      item.status === "waiting-for-test-data" ||
      item.status === "waiting-for-agent"
  );
  if (activeCase) {
    if (activeCase.status === "waiting-for-test-data") {
      const testDataTask = context.repository.testDataTasks.find(
        (task) => task.id === activeCase.testDataTaskId
      );
      if (!testDataTask || testDataTask.status !== "pending") {
        throw new Error(
          "Requirement suite is waiting for test data, but no pending TestDataTask exists"
        );
      }
      return requirementSuiteTestDataTaskPackage(
        requirementSuiteRun,
        activeCase.executableCaseId,
        testDataTask,
        activeCase.testDataPhase ?? "prepare"
      );
    }
    const pendingTask = context.repository.agentTasks.find(
      (task) =>
        task.status === "pending" &&
        task.chainContext?.requirementSuiteRunId === requirementSuiteRun.id &&
        task.chainContext.executableCaseId === activeCase.executableCaseId
    );
    if (pendingTask) {
      if (activeCase.status === "running") {
        const executionEvidenceId =
          pendingTask.chainContext?.executionEvidenceId ??
          activeCase.executionEvidenceId;
        if (!executionEvidenceId) {
          throw new Error(
            "Requirement suite AgentTask is missing execution evidence"
          );
        }
        requirementSuiteRun = context.requirementSuiteRuns.markWaiting(
          requirementSuiteRun.id,
          activeCase.executableCaseId,
          {
            testCaseId: pendingTask.chainContext!.testCaseId,
            agentTaskId: pendingTask.id,
            executionEvidenceId
          }
        );
      }
      return {
        ...taskPackageFromStoredTask(pendingTask),
        mode: "requirement-suite",
        stage: pendingTask.agent,
        specPath: pendingTask.chainContext?.specPath,
        seedPath: pendingTask.chainContext?.seedPath,
        testPath: pendingTask.chainContext?.testPath,
        requirementSuiteRun,
        currentExecutableCaseId: activeCase.executableCaseId
      };
    }
    if (activeCase.status === "waiting-for-agent") {
      throw new Error(
        "Requirement suite is waiting for an agent, but no pending AgentTask exists"
      );
    }
  }
  const started = context.requirementSuiteRuns.beginNext(
    requirementSuiteRun.id
  );
  requirementSuiteRun = started.run;
  if (!started.caseRun) {
    return {
      mode: "requirement-suite",
      status: requirementSuiteRun.status,
      requirementSuiteRun
    };
  }
  const executableCase = context.repository.executableCases.find(
    (item) =>
      item.id === started.caseRun!.executableCaseId &&
      item.knowledgeProjectId === requirementSuiteRun.knowledgeProjectId
  );
  if (!executableCase) throw new Error("Executable case not found");
  if (!executableCase.systemId) {
    executableCase.systemId = requirementSuiteRun.systemId;
    executableCase.updatedAt = new Date().toISOString();
    context.repository.persist();
  }
  const testDataPhase =
    started.caseRun.testDataPhase === "cleanup" &&
    started.caseRun.pendingOutcome
      ? "cleanup"
      : "prepare";
  const testDataPreparation = await context.testDataProvider.prepare({
    knowledgeProjectId: requirementSuiteRun.knowledgeProjectId,
    systemId: requirementSuiteRun.systemId,
    executableCaseId: executableCase.id,
    requirementSuiteRunId: requirementSuiteRun.id,
    confirm: true,
    allowCreate: requirementSuiteRun.allowCreateTestData,
    automatic: requirementSuiteRun.automaticTestData,
    phase: testDataPhase
  });
  if (testDataPreparation.task) {
    const waitingRun =
      context.requirementSuiteRuns.markWaitingForTestData(
        requirementSuiteRun.id,
        executableCase.id,
        {
          taskId: testDataPreparation.task.id,
          phase: testDataPhase,
          pendingOutcome: started.caseRun.pendingOutcome
        }
      );
    return requirementSuiteTestDataTaskPackage(
      waitingRun,
      executableCase.id,
      testDataPreparation.task,
      testDataPhase
    );
  }
  if (testDataPhase === "cleanup" && started.caseRun.pendingOutcome) {
    const cleanedRun = context.requirementSuiteRuns.completeCase(
      requirementSuiteRun.id,
      executableCase.id,
      started.caseRun.pendingOutcome
    );
    if (cleanedRun.status === "running") {
      return executeNextRequirementSuiteCase(context, cleanedRun.id, {
        maxHealAttempts: input.maxHealAttempts
      });
    }
    return {
      mode: "requirement-suite",
      status: cleanedRun.status,
      requirementSuiteRun: cleanedRun
    };
  }
  if (
    executableCase.dataPlan?.verdict === "ready" &&
    executableCase.dataPlan.requiresConfirmation &&
    !executableCase.dataPlan.confirmedAt
  ) {
    context.knowledgeService.confirmExecutableCaseTestData(
      executableCase.id
    );
  }
  const suiteAuthProfileId =
    requirementSuiteRun.authProfileId ??
    requirementSuiteRun.actorJourney?.[0]?.authProfileId;
  const suiteAuthProfile = suiteAuthProfileId
    ? context.repository.authProfiles.find((item) => item.id === suiteAuthProfileId)
    : undefined;
  const requiresAuthProviderPreflight =
    suiteAuthProfile &&
    (Boolean(suiteAuthProfile.refreshProvider) ||
      suiteAuthProfile.loginMethod === "token" ||
      suiteAuthProfile.loginMethod === "cookie");
  if (suiteAuthProfile && requiresAuthProviderPreflight) {
    const authProviderPreflight = await context.authRefreshRegistry.preflight({
      workDir: context.workDir,
      system: context.repository.systemProfiles.find(
        (item) => item.id === requirementSuiteRun.systemId
      )!,
      authProfile: suiteAuthProfile,
      reason: "Requirement suite execution preflight."
    });
    if (authProviderPreflight.status !== "ready") {
      const existingGap = context.repository.gaps.find(
        (gap) =>
          gap.projectId === requirementSuiteRun.systemId &&
          gap.sourceType === "requirement-suite-auth-preflight" &&
          gap.sourceId === requirementSuiteRun.id &&
          gap.status === "open"
      );
      const gap = existingGap ?? context.service.reportGap({
        projectId: requirementSuiteRun.systemId,
        sourceType: "requirement-suite-auth-preflight",
        sourceId: requirementSuiteRun.id,
        reason:
          authProviderPreflight.reason ??
          `Authentication provider ${authProviderPreflight.provider} is not ready.`,
        severity: "high",
        owner: "qa"
      });
      const blockedRun = context.requirementSuiteRuns.completeCase(
        requirementSuiteRun.id,
        executableCase.id,
        {
          status: "blocked",
          gapIds: [gap.id],
          failureType: "auth_failure",
          error: gap.reason
        }
      );
      return {
        mode: "requirement-suite",
        status: "blocked",
        authProviderPreflight,
        gap,
        requirementSuiteRun: blockedRun,
        nextAction:
          "Configure or complete the authentication provider, resolve the Gap, then explicitly resume the requirement suite."
      };
    }
  }
  const executionPreflight = context.executionPreflight.prepare({
    knowledgeProjectId: requirementSuiteRun.knowledgeProjectId,
    systemId: requirementSuiteRun.systemId,
    executableCaseId: executableCase.id,
    requirementSuiteRunId: requirementSuiteRun.id,
    authProfileId: requirementSuiteRun.authProfileId,
    actorJourney: requirementSuiteRun.actorJourney,
    confirm: true
  });
  if (
    executionPreflight.status !== "ready" ||
    !executionPreflight.executionPlan
  ) {
    const reason =
      executionPreflight.draft.blockers.join("; ") ||
      "Execution preflight did not produce a ready execution plan";
    const gap = context.service.reportGap({
      projectId: requirementSuiteRun.systemId,
      sourceType: "requirement-suite-preflight",
      sourceId: requirementSuiteRun.id,
      reason,
      severity: "high",
      owner: "qa"
    });
    const blockedRun = context.requirementSuiteRuns.completeCase(
      requirementSuiteRun.id,
      executableCase.id,
      {
        status: "blocked",
        gapIds: [gap.id],
        failureType: classifyFailure(
          reason,
          "requirement-suite-preflight"
        ),
        error: reason
      }
    );
    return {
      mode: "requirement-suite",
      status: "blocked",
      executionPreflight,
      gap,
      requirementSuiteRun: blockedRun,
      nextAction:
        "Resolve the execution preflight Gap, then explicitly resume the requirement suite."
    };
  }
  const executionPlan = executionPreflight.executionPlan;
  context.requirementSuiteRuns.bindExecutionPlan(
    requirementSuiteRun.id,
    executableCase.id,
    executionPlan.id
  );
  return executeRequirementSuiteCase(context, {
    requirementSuiteRunId: requirementSuiteRun.id,
    executableCase,
    executionPlan,
    maxHealAttempts: input.maxHealAttempts
  });
}

export async function executeRequirementSuiteCase(
  context: BrainCreatorMcpContext,
  input: {
    requirementSuiteRunId: string;
    executableCase: ExecutableCase;
    executionPlan: ExecutionPlan;
    maxHealAttempts?: number;
  }
): Promise<Record<string, unknown>> {
  const { executableCase, executionPlan } = input;
  const requirementSuiteRun = context.requirementSuiteRuns.get(
    input.requirementSuiteRunId
  );
  const projectId = requirementSuiteRun.knowledgeProjectId;
  const systemId = requirementSuiteRun.systemId;
  executableCase.systemId = systemId;
  executableCase.updatedAt = new Date().toISOString();
  context.repository.persist();
  const contextPack = executionPlan.contextPack;
  const artifactLayout = requirementArtifactLayout(
    context,
    requirementSuiteRun,
    executableCase
  );
  const contextPackPath = join(artifactLayout.analysisDir, `${executionPlan.id}-context.json`);
  await mkdir(dirname(contextPackPath), { recursive: true });
  await writeFile(contextPackPath, `${JSON.stringify(contextPack, null, 2)}\n`, "utf8");
  const scenario: TestCaseScenario = {
    id: id("scenario"),
    title: executionPlan.title,
    priority: "high",
    steps: executionPlan.steps.map((step) => ({
      action: step.action === "api" ? "wait" : step.action,
      target: step.targetSemantic,
      value: step.value,
      expected: step.expected
    }))
  };
  const testCase = context.service.createTestCase({
    systemId,
    requirement: executionPlan.title,
    scenarios: [scenario],
    newTerms: [],
    ruleCheckResult: { passed: true, checks: [] }
  });
  context.service.approveTestCase(testCase.id);
  const executionEvidence = context.knowledgeService.createExecutionEvidence({
    projectId,
    systemId,
    executableCaseId: executableCase.id,
    requirementSuiteRunId: requirementSuiteRun.id,
    executionPlanId: executionPlan.id,
    testCaseId: testCase.id,
    contextPackPath
  });
  const knowledgeContext = formatRequirementGeneratorContext(
    executionPlan,
    contextPack,
    executionEvidence.id,
    artifactLayout.evidenceDir
  );
  let result;
  try {
    result = await runApprovedChain(context, {
      caseId: testCase.id,
      authProfileId: requirementSuiteRun.authProfileId,
      maxHealAttempts: input.maxHealAttempts,
      knowledgeProjectId: projectId,
      executableCaseId: executableCase.id,
      executionPlanId: executionPlan.id,
      requirementSuiteRunId: requirementSuiteRun.id,
      executionEvidenceId: executionEvidence.id,
      contextPackPath,
      knowledgeContext,
      artifactLayout,
      browserMode: requirementSuiteRun.browserMode ?? "headless"
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    await context.knowledgeService.completeExecutionEvidence(executionEvidence.id, {
      status: "blocked",
      actualResult: reason,
      artifactPaths: [contextPackPath]
    });
    const gap = context.service.reportGap({
      projectId: systemId,
      sourceType: "requirement-suite-run",
      sourceId: requirementSuiteRun.id,
      reason,
      severity: "high",
      owner: "qa"
    });
    return finalizeRequirementSuiteCase(context, {
      requirementSuiteRunId: requirementSuiteRun.id,
      executableCase,
      outcome: {
        status: "blocked",
        gapIds: [gap.id],
        failureType: classifyFailure(reason, "requirement-suite-run"),
        error: reason
      },
      completedCase: {
        mode: "requirement-suite",
        status: "blocked",
        knowledgeProjectId: projectId,
        executableCaseId: executableCase.id,
        executionPlan,
        contextPackPath,
        executionEvidence: context.repository.executionEvidence.find(
          (item) => item.id === executionEvidence.id
        ),
        gap
      },
      completionField: "completedCase",
      maxHealAttempts: input.maxHealAttempts
    });
  }
  if (
    "task" in result &&
    result.task?.status === "pending" &&
    !("chainRun" in result)
  ) {
    const waitingRun = context.requirementSuiteRuns.markWaiting(
      requirementSuiteRun.id,
      executableCase.id,
      {
        testCaseId: testCase.id,
        agentTaskId: result.task.id,
        executionEvidenceId: executionEvidence.id
      }
    );
    return {
      ...result,
      mode: "requirement-suite",
      knowledgeProjectId: projectId,
      executableCaseId: executableCase.id,
      executionPlan,
      contextPackPath,
      executionEvidence,
      requirementSuiteRun: waitingRun,
      remainingExecutableCaseIds: waitingRun.caseRuns
        .filter((item) => item.status === "queued")
        .map((item) => item.executableCaseId)
    };
  }
  const requirementFailure =
    "chainRun" in result && result.chainRun?.status === "failed"
      ? [
          "testResult" in result ? result.testResult?.stderr : undefined,
          "testResult" in result ? result.testResult?.stdout : undefined,
          result.chainRun.gaps.map((gap) => gap.reason).join("; ")
        ].find((value): value is string => Boolean(value?.trim()))
      : undefined;
  const requirementTestResult = "testResult" in result ? result.testResult : undefined;
  const requirementFailureClassification = requirementFailure
    ? classifyEvidenceFailure({
        stderr: requirementTestResult?.stderr,
        stdout: requirementTestResult?.stdout,
        reporter: requirementTestResult?.structuredReporter
      })
    : undefined;
  const diagnosis =
    "chainRun" in result && result.chainRun?.status === "failed"
      ? context.executionDiagnosis.create({
          knowledgeProjectId: projectId,
          systemId,
          requirementSuiteRunId: requirementSuiteRun.id,
          executableCaseId: executableCase.id,
          executionEvidenceId: executionEvidence.id,
          chainRunId: result.chainRun.id,
          testCaseId: testCase.id,
          status: "failed",
          failureReason: requirementFailure,
          failureType: requirementFailureClassification?.type,
          consoleErrors: requirementTestResult?.structuredReporter?.consoleErrors,
          networkFailures: requirementTestResult?.structuredReporter?.networkFailures,
          sourceType: "requirement-suite-run",
          healAttempts:
            "healerRuns" in result && Array.isArray(result.healerRuns)
              ? result.healerRuns.length
              : 0,
          maxHealAttempts: input.maxHealAttempts ?? 2,
          evidenceAssurance: executionEvidence.assuranceLevel,
          evidenceRefs: [
            executionEvidence.id,
            result.chainRun.id,
            executionPlan.id
          ]
        })
      : undefined;
  const requirementBug =
    requirementFailure &&
    diagnosis?.verdict === "product_bug" &&
    "chainRun" in result
      ? createRequirementBugReport(context, {
          executableCase,
          chainRun: result.chainRun,
          failureReason: requirementFailure,
          artifactPaths: [contextPackPath, result.specPath, result.testPath].filter(
            (path): path is string => typeof path === "string"
          ),
          diagnosisId: diagnosis.id
        })
      : undefined;
  if (requirementBug && diagnosis) {
    context.executionDiagnosis.linkBugReport(diagnosis.id, requirementBug.id);
  }
  if (
    diagnosis &&
    diagnosis.verdict !== "product_bug" &&
    "chainRun" in result
  ) {
    context.executionDiagnosis.linkGaps(
      diagnosis.id,
      result.chainRun?.gaps.map((gap) => gap.id) ?? []
    );
  }
  if (requirementBug && "chainRun" in result) result.chainRun.gaps = [];
  const completedEvidence =
    "chainRun" in result && result.chainRun?.status !== "partial"
      ? await completeRequirementEvidence(
          context,
          executionEvidence.id,
          result.chainRun,
          "testResult" in result ? result.testResult : undefined,
          [contextPackPath, result.specPath, result.testPath].filter(
            (path): path is string => typeof path === "string"
          ),
          requirementSuiteRun.browserMode === "observe" ? "observe" : "headless",
          diagnosis
        )
      : executionEvidence;
  if (
    "chainRun" in result &&
    result.testResult?.actorRoleEvidencePath &&
    requirementSuiteRun.actorJourney?.length
  ) {
    context.requirementSuiteRuns.recordActorJourneyEvidence(
      requirementSuiteRun.id,
      executableCase.id,
      result.testResult.actorRoleEvidencePath
    );
  }
  const caseStatus =
    "chainRun" in result && result.chainRun?.status === "succeeded"
      ? "passed"
      : requirementBug
        ? "failed"
        : "blocked";
  const outcome: RequirementSuiteCaseOutcome = {
    status: caseStatus,
    chainRunId:
      "chainRun" in result ? result.chainRun?.id : undefined,
    diagnosisId: diagnosis?.id,
    bugReportId: requirementBug?.id,
    gapIds:
      "chainRun" in result
        ? result.chainRun?.gaps.map((gap) => gap.id) ?? []
        : [],
    failureType:
      caseStatus === "passed"
        ? undefined
        : diagnosis?.failureType ??
          classifyFailure(
            requirementFailure ?? "Requirement suite execution blocked",
            "requirement-suite-run"
          ),
    error: requirementFailure
  };
  const completedCase = {
    ...result,
    executableCaseId: executableCase.id,
    executionPlan,
    contextPackPath,
    executionEvidence: completedEvidence,
    executionDiagnosis: diagnosis,
    bugReport: requirementBug
  };
  return finalizeRequirementSuiteCase(context, {
    requirementSuiteRunId: requirementSuiteRun.id,
    executableCase,
    outcome,
    completedCase,
    completionField: "completedCase",
    maxHealAttempts: input.maxHealAttempts
  });
}

export async function finalizeRequirementSuiteCase(
  context: BrainCreatorMcpContext,
  input: {
    requirementSuiteRunId: string;
    executableCase: ExecutableCase;
    outcome: RequirementSuiteCaseOutcome;
    completedCase: Record<string, unknown>;
    completionField: "completedCase" | "submittedCase";
    maxHealAttempts?: number;
  }
): Promise<Record<string, unknown>> {
  const run = context.requirementSuiteRuns.get(
    input.requirementSuiteRunId
  );
  let cleanup;
  try {
    cleanup = await context.testDataProvider.prepare({
      knowledgeProjectId: run.knowledgeProjectId,
      systemId: run.systemId,
      executableCaseId: input.executableCase.id,
      requirementSuiteRunId: run.id,
      confirm: true,
      phase: "cleanup"
    });
  } catch (error) {
    const reason =
      error instanceof Error ? error.message : String(error);
    const gap = context.service.reportGap({
      projectId: run.systemId,
      sourceType: "test-data-cleanup",
      sourceId: run.id,
      reason: `Could not prepare test-data cleanup: ${reason}`,
      severity: "high",
      owner: "qa"
    });
    const blockedRun = context.requirementSuiteRuns.completeCase(
      run.id,
      input.executableCase.id,
      {
        status: "blocked",
        gapIds: [...input.outcome.gapIds, gap.id],
        failureType: classifyFailure(reason, "test-data-cleanup"),
        error: reason
      }
    );
    const archive = await archiveRequirementSuiteRun(context, blockedRun);
    return {
      ...input.completedCase,
      mode: "requirement-suite",
      status: "blocked",
      gap,
      requirementSuiteRun: blockedRun,
      ...(archive ? { artifactManifest: archive.artifactManifest } : {})
    };
  }
  if (cleanup.task) {
    const waitingRun =
      context.requirementSuiteRuns.markWaitingForTestData(
        run.id,
        input.executableCase.id,
        {
          taskId: cleanup.task.id,
          phase: "cleanup",
          pendingOutcome: input.outcome
        }
      );
    return {
      ...requirementSuiteTestDataTaskPackage(
        waitingRun,
        input.executableCase.id,
        cleanup.task,
        "cleanup"
      ),
      [input.completionField]: input.completedCase
    };
  }

  const updatedRun = context.requirementSuiteRuns.completeCase(
    run.id,
    input.executableCase.id,
    input.outcome
  );
  const archive = await archiveRequirementSuiteRun(context, updatedRun);
  const artifactManifest = archive?.artifactManifest;
  if (updatedRun.status === "running") {
    const next = await executeNextRequirementSuiteCase(
      context,
      updatedRun.id,
      { maxHealAttempts: input.maxHealAttempts }
    );
    return {
      ...next,
      [input.completionField]: input.completedCase,
      requirementSuiteRun: context.requirementSuiteRuns.get(updatedRun.id)
    };
  }
  if (updatedRun.stabilityNextRunId) {
    const next = await executeNextRequirementSuiteCase(
      context,
      updatedRun.stabilityNextRunId,
      { maxHealAttempts: input.maxHealAttempts }
    );
    return {
      ...next,
      [input.completionField]: input.completedCase,
      previousStabilityRun: updatedRun,
      requirementSuiteRun: context.requirementSuiteRuns.get(updatedRun.stabilityNextRunId)
    };
  }
  return {
    ...input.completedCase,
    mode: "requirement-suite",
    status: updatedRun.status,
    requirementSuiteRun: updatedRun,
    ...(artifactManifest ? { artifactManifest } : {}),
    remainingExecutableCaseIds: updatedRun.caseRuns
      .filter((item) => item.status === "queued")
      .map((item) => item.executableCaseId)
  };
}

export function formatRequirementGeneratorContext(
  executionPlan: ExecutionPlan,
  contextPack: ReturnType<typeof buildContextPack>,
  evidenceId: string,
  evidenceRoot: string
) {
  const evidenceDir = join(evidenceRoot, evidenceId);
  return [
    "## Brain Creator Knowledge Context",
    "",
    contextPack.content || "No additional confirmed knowledge was retrieved.",
    "",
    "### Context References",
    ...(contextPack.references.length > 0
      ? contextPack.references.map(
          (reference) =>
            `- ${reference.nodeId} [${reference.type}] sources=${reference.sourceRefs.join(",")}`
        )
      : ["- None"]),
    "",
    "## Executable Step Traceability",
    "",
    ...(executionPlan.preconditions.length > 0
      ? executionPlan.preconditions.map(
          (precondition) => `- Precondition: ${precondition}`
        )
      : ["- Preconditions: none"]),
    ...executionPlan.steps.map(
      (step) =>
        `- Step ${step.order} ${step.action}: ${step.instruction}; target=${step.targetSemantic}; dataProfile=${step.dataProfileId ?? "none"}; origin=${step.origin}; sources=${step.sourceRefs.join(",")}`
    ),
    "",
    "## Execution Plan",
    "",
    `- Plan ID: ${executionPlan.id}`,
    `- Snapshot hash: ${executionPlan.snapshotHash}`,
    `- System: ${executionPlan.systemId}`,
    `- Auth profile: ${executionPlan.auth?.profileId ?? "public-or-host-managed"}`,
    ...(executionPlan.actorJourney?.length
      ? [
          "",
          "## Actor Journey",
          ...executionPlan.actorJourney.map(
            (actor) =>
              `- Role ${actor.order}: ${actor.role}; authProfile=${actor.authProfileId}; afterStep=${actor.afterStepId ?? "start"}; sources=${actor.sourceRefs.join(",")}`
          ),
          "- Switch role only at the declared step boundary; do not infer an account or role from page text.",
          "- The generated test must call bc.runAsRole(browser, role, action) for every role transition."
        ]
      : []),
    ...executionPlan.checks.map(
      (check) => `- ${check.id}: ${check.status}; ${check.message}`
    ),
    "",
    "## Test Data Plan",
    "",
    ...(executionPlan.dataBindings.length
      ? executionPlan.dataBindings.map((binding) =>
          [
            `- ${binding.field}: decision=${binding.decision}`,
            `value=${binding.decision === "resolve-secret" ? "[secret-reference]" : binding.value ?? "runtime"}`,
            `reference=${binding.reference ?? binding.secretRef ?? "none"}`,
            `lease=${binding.leaseId ?? "none"}`,
            `cleanup=${binding.cleanup}`,
            `sources=${binding.sourceRefs.join(",")}`
          ].join("; ")
        )
      : ["- No planned test data"]),
    "",
    "## Evidence Contract",
    "",
    "- Wrap each executable step in Playwright test.step with its step number and instruction.",
    ...executionPlan.steps.map(
      (step) =>
        `- After step ${step.order}, capture a screenshot at ${join(
          evidenceDir,
          `step-${String(step.order).padStart(2, "0")}.png`
        )}.`
    ),
    `- Record browser console errors and failed network requests under ${evidenceDir}.`,
    "- Keep requirement assertions explicit. Do not replace them with navigation-only checks.",
    "- Do not invent selectors or data. Fail with a precise evidence message when proof is unavailable."
  ].join("\n");
}

export async function completeRequirementEvidence(
  context: BrainCreatorMcpContext,
  evidenceId: string,
  chainRun: ChainRun,
  testResult: CommandResult | undefined,
  baseArtifactPaths: string[],
  observationMode: "observe" | "headless" = "headless",
  diagnosis?: Pick<ExecutionDiagnosis, "verdict" | "failureType">
) {
  const output = [testResult?.stdout, testResult?.stderr].filter(Boolean).join("\n").trim();
  const reporter = testResult?.structuredReporter;
  const artifactPaths = [
    ...new Set(
      [
        ...baseArtifactPaths,
        testResult?.reporterPath,
        testResult?.actorRoleEvidencePath,
        ...(reporter?.attachments ?? [])
      ].filter((path): path is string => typeof path === "string")
    )
  ];
  const status =
    reporter?.status === "failed"
      ? "failed"
      : reporter?.status === "blocked"
        ? "blocked"
        : chainRun.status === "succeeded"
      ? "passed"
      : chainRun.gaps.length > 0
        ? "blocked"
        : "failed";
  const actualResult =
    status === "passed"
      ? reporter
        ? "Playwright structured reporter passed."
        : "Playwright exited successfully, but structured reporter evidence was unavailable."
      : output || chainRun.gaps.map((gap) => gap.reason).join("; ") || "Execution failed.";
  const completed = await context.knowledgeService.completeExecutionEvidence(evidenceId, {
    status,
    chainRunId: chainRun.id,
    actualResult,
    artifactPaths,
    tracePaths: artifactPaths.filter((path) => /trace[^\\/]*\.zip$/i.test(path)),
    consoleErrors: reporter?.consoleErrors ?? [],
    networkFailures: reporter?.networkFailures ?? [],
    reporterPath: testResult?.reporterPath,
    reporterResult: reporter,
    actorRoleEvidencePath: testResult?.actorRoleEvidencePath,
    evidenceRootDir: context.workDir,
    observationMode,
    diagnosis
  });
  recordExecutionEvidenceProgress(context, completed);
  return completed;
}

export function recordExecutionEvidenceProgress(
  context: BrainCreatorMcpContext,
  evidence: ExecutionEvidence
) {
  const run = context.repository.requirementSuiteRuns.find((candidate) =>
    candidate.caseRuns.some((caseRun) =>
      caseRun.executableCaseId === evidence.executableCaseId &&
      caseRun.executionEvidenceId === evidence.id
    )
  );
  if (!run) return;
  for (const step of evidence.steps) {
    context.runLedger.appendProgress({
      knowledgeProjectId: run.knowledgeProjectId,
      systemId: run.systemId,
      requirementSuiteRunId: run.id,
      executableCaseId: evidence.executableCaseId,
      stage: "execution",
      status:
        step.assertionStatus === "passed"
          ? "passed"
          : step.assertionStatus === "failed"
            ? "failed"
            : step.assertionStatus === "blocked"
              ? "blocked"
              : "running",
      stepId: step.stepId,
      stepTitle: step.instruction,
      pageUrl: step.pageUrl,
      screenshotPath: step.screenshotPath,
      assertionSummary: [
        step.expected ? `expected=${step.expected}` : undefined,
        step.actual ? `actual=${step.actual}` : undefined
      ].filter(Boolean).join("; ") || undefined
    });
  }
}

export function reportKnowledgeGap(
  context: BrainCreatorMcpContext,
  projectId: string,
  sourceId: string,
  reason: string
) {
  if (!context.repository.knowledgeProjects.some((item) => item.id === projectId)) {
    throw new Error("Knowledge project not found");
  }
  const now = new Date().toISOString();
  const gap: Gap = {
    id: id("gap"),
    projectId,
    sourceType: "requirement-connector",
    sourceId,
    reason,
    severity: "high",
    owner: "product",
    status: "open",
    createdAt: now,
    updatedAt: now
  };
  context.repository.gaps.push(gap);
  context.repository.persist();
  return gap;
}

export function compileRunSummary(run: CompileRun) {
  return {
    compileRunId: run.id,
    status: run.status,
    total: run.total,
    ready: run.ready,
    needsExploration: run.needsExploration,
    needsData: run.needsData,
    blocked: run.blocked,
    ambiguous: run.ambiguous,
    skipped: run.skipped,
    reused: run.reused,
    nextAction:
      run.blocked + run.ambiguous + run.needsExploration + run.needsData + run.skipped > 0
        ? "review-compile-run"
        : "preview-requirement-suite"
  };
}

export function isFeishuRequirementSource(source: string) {
  try {
    const hostname = new URL(source).hostname.toLowerCase();
    return hostname.endsWith(".feishu.cn") || hostname.endsWith(".larksuite.com") || hostname.endsWith(".larkenterprise.com");
  } catch {
    return false;
  }
}

export async function runApprovedChain(context: BrainCreatorMcpContext, input: Record<string, unknown>) {
  const executionPlanId = optionalStringArg(input, "executionPlanId");
  const executionPlan = executionPlanId
    ? assertExecutionPlanIsCurrent(context, executionPlanId)
    : undefined;
  const structuredReporter = resolveStructuredReporterMode(context, input);
  const browserMode = browserModeArg(input) ?? "headless";
  const browserCapability = browserObservationCapability(browserMode);
  if (!browserCapability.available) {
    throw new Error(browserCapability.reason);
  }
  const bridgeCheck = await preflightAgentBridge(context.agentBridge);
  if (!bridgeCheck.ok) {
    throw new Error(`Agent bridge unavailable: ${bridgeCheck.error}`);
  }
  const testCase = context.service.getTestCase(stringArg(input, "caseId"));
  if (testCase.status !== "approved") {
    throw new Error("Test case must be approved before running chain");
  }
  const system = context.repository.systemProfiles.find((item) => item.id === testCase.systemId);
  if (!system) {
    throw new Error("Business system not found");
  }
  if (executionPlan && executionPlan.systemId !== testCase.systemId) {
    throw new Error("Execution plan belongs to another business system");
  }
  const systemBrainSnapshot = context.systemBrainSnapshots.latest(system.id);
  const requiredPageObjectBindings = executionPlan
    ? requiredPageObjectBindingsForSteps(executionPlan.steps)
    : [];
  const pageObjectReadiness = validateConfirmedSystemPageObjectBindings(
    systemBrainSnapshot,
    requiredPageObjectBindings
  );
  if (!pageObjectReadiness.valid) {
    throw new Error(pageObjectReadiness.reason);
  }
  const authProfile = executionPlan?.auth
    ? findAuthProfileById(
        context,
        testCase.systemId,
        executionPlan.auth.profileId
      )
    : optionalStringArg(input, "authProfileId")
      ? findAuthProfileById(
          context,
          testCase.systemId,
          optionalStringArg(input, "authProfileId")!
        )
      : findAuthProfile(context, testCase.systemId);
  await verifyAuthForExecution(context, system, authProfile, {
    requirementSuiteRunId: optionalStringArg(input, "requirementSuiteRunId"),
    executableCaseId: optionalStringArg(input, "executableCaseId"),
    role: "primary"
  });
  const actorJourneyProfiles = executionPlan?.actorJourney?.map((actor) => ({
    role: actor.role,
    authProfile: findAuthProfileById(context, testCase.systemId, actor.authProfileId)
  }));
  for (const actor of actorJourneyProfiles ?? []) {
    await verifyAuthForExecution(context, system, actor.authProfile, {
      requirementSuiteRunId: optionalStringArg(input, "requirementSuiteRunId"),
      executableCaseId: optionalStringArg(input, "executableCaseId"),
      role: actor.role
    });
  }
  const artifactScope = resolveChainArtifactScope(context, input, system, testCase);
  if (context.agentBridge?.provider === "host-agent") {
    const specPath = join(artifactScope.layout.specsDir, artifactFileName({
      caseNo: artifactScope.caseNo,
      title: testCase.requirement,
      extension: ".md",
      contentHash: testCase.id
    }));
    const testPath = join(artifactScope.layout.testsDir, artifactFileName({
      caseNo: artifactScope.caseNo,
      title: testCase.requirement,
      extension: ".spec.ts",
      contentHash: testCase.id
    }));
    await mkdir(artifactScope.layout.specsDir, { recursive: true });
    await mkdir(artifactScope.layout.testsDir, { recursive: true });
    await writeFile(
      specPath,
      [formatScenariosAsMarkdown(testCase.scenarios), optionalStringArg(input, "knowledgeContext")]
        .filter(Boolean)
        .join("\n\n"),
      "utf8"
    );
    const seed = await generateSeedFile({
      workDir: context.workDir,
      outputDir: artifactScope.layout.testsDir,
      system,
      authProfile,
      actorJourney: actorJourneyProfiles,
      systemBrainSnapshot
    });
    const taskPackage = await prepareAgentTask(context, {
      systemId: system.id,
      agent: "generator",
      inputSummary: testCase.requirement,
      args: ["--spec", specPath, "--seed", seed.seedPath, "--output", testPath],
      outputPaths: [testPath],
      chainContext: {
        testCaseId: testCase.id,
        specPath,
        seedPath: seed.seedPath,
        testPath,
        maxHealAttempts: optionalNumberArg(input, "maxHealAttempts") ?? 1,
        healAttempts: 0,
        knowledgeProjectId: optionalStringArg(input, "knowledgeProjectId"),
        executableCaseId: optionalStringArg(input, "executableCaseId"),
        executionPlanId: optionalStringArg(input, "executionPlanId"),
        requirementSuiteRunId: optionalStringArg(
          input,
          "requirementSuiteRunId"
        ),
        executionEvidenceId: optionalStringArg(input, "executionEvidenceId"),
        contextPackPath: optionalStringArg(input, "contextPackPath"),
        requiredStepIds: executionPlan?.steps
          .filter((step) => step.action !== "api")
          .map((step) => step.id),
        requiredPageObjectBindings,
        actorJourneyRoles: actorJourneyProfiles?.map((actor) => actor.role),
        browserMode
      },
      suiteContext: suiteContextArg(input),
      regressionContext: regressionContextArg(input)
    });
    return {
      ...taskPackage,
      mode: "host-agent",
      stage: "generator",
      testCase,
      specPath,
      seedPath: seed.seedPath,
      testPath
    };
  }
  const harnessResult = await runInHarness({
    runtime: context.harness,
    approved: true,
    task: {
      brain: "testexecution",
      operation: "run-approved-chain",
      inputSummary: testCase.requirement,
      systemId: testCase.systemId,
      requirementSetId: optionalStringArg(input, "requirementSetId"),
      policy: {
        allowWrites: true,
        requireApproval: false,
        allowedUrls: [system.baseUrl]
      },
      budget: {
        maxHealAttempts: optionalNumberArg(input, "maxHealAttempts") ?? 1
      }
    },
    execute: () => runChain({
      workDir: context.workDir,
      system,
      authProfile,
      testCase,
      agentBridge: context.agentBridge,
      runner: context.runner,
      structuredReporter,
      maxHealAttempts: optionalNumberArg(input, "maxHealAttempts"),
      knowledgeContext: optionalStringArg(input, "knowledgeContext"),
      actorJourney: actorJourneyProfiles,
      requiredStepIds: executionPlan?.steps
        .filter((step) => step.action !== "api")
        .map((step) => step.id),
      requiredPageObjectBindings,
      systemBrainSnapshot,
      browserMode,
      artifactLayout: artifactScope.layout,
      caseNo: artifactScope.caseNo
    }),
    structuredOutputs: (result) => [
      {
        agent: "generator" as const,
        output: {
          version: 1,
          agent: "generator" as const,
          status: result.generateRun.status === "succeeded" ? "generated" as const : "blocked" as const,
          testPath: result.testPath,
          steps: testCase.scenarios.flatMap((scenario) => scenario.steps.map((step, index) => ({
            id: `${scenario.id}-step-${index + 1}`,
            sourceRefs: [`test-case:${testCase.id}`]
          }))),
          assertions: testCase.scenarios.flatMap((scenario) => scenario.steps
            .filter((step) => step.action === "assert")
            .map((step, index) => ({
              id: `${scenario.id}-assertion-${index + 1}`,
              sourceRefs: [`test-case:${testCase.id}`]
            }))),
          sourceRefs: [`test-case:${testCase.id}`, `agent-run:${result.generateRun.id}`]
        }
      },
      ...result.healerRuns.map((healerRun) => ({
        agent: "healer" as const,
        output: {
          version: 1,
          agent: "healer" as const,
          status: healerRun.status === "succeeded" ? "healed" as const : "unresolved" as const,
          targetTestPath: result.testPath,
          changedFiles: [result.testPath],
          removedAssertionIds: [],
          failureRefs: [`agent-run:${healerRun.id}`],
          sourceRefs: [`agent-run:${healerRun.id}`, `chain-run:${result.chainRun.id}`],
          notes: healerRun.error
        }
      }))
    ],
    evaluate: (result) => ({
      verdict: result.chainRun.status === "succeeded" ? "pass" : result.chainRun.gaps.length > 0 ? "blocked" : "needs-review",
      score: result.chainRun.status === "succeeded" ? 1 : 0,
      reasons: result.chainRun.gaps.map((gap) => gap.reason),
      affectedAssetIds: [result.chainRun.id],
      evidenceRefs: [
        `chain-run:${result.chainRun.id}`,
        ...result.chainRun.gaps.map((gap) => `gap:${gap.id}`)
      ],
      nextActions: result.chainRun.status === "succeeded" ? [] : ["review-chain-run"]
    })
  });
  const result = harnessResult.result;
  context.service.recordAgentRun(result.generateRun);
  for (const healerRun of result.healerRuns) {
    context.service.recordAgentRun(healerRun);
  }
  context.service.recordChainRun(result.chainRun);
  return result;
}

export function requirementArtifactLayout(
  context: BrainCreatorMcpContext,
  run: RequirementSuiteRun,
  executableCase: ExecutableCase
) {
  const system = context.repository.systemProfiles.find((item) => item.id === run.systemId);
  const requirement = context.repository.requirementSets.find(
    (item) => item.id === executableCase.requirementSetId
  );
  return resolveArtifactRunLayout({
    workDir: context.workDir,
    systemKey: system?.name ?? run.systemId,
    requirementKey: requirement?.title ?? executableCase.requirementSetId,
    requirementVersion: requirement?.version,
    suiteRunId: run.id
  });
}

export function resolveChainArtifactScope(
  context: BrainCreatorMcpContext,
  input: Record<string, unknown>,
  system: SystemProfile,
  testCase: TestCase
): { layout: ArtifactRunLayout; caseNo?: string } {
  const supplied = input.artifactLayout;
  const requirementSuiteRunId = optionalStringArg(input, "requirementSuiteRunId");
  const executableCaseId = optionalStringArg(input, "executableCaseId");
  const requirementSuiteRun = requirementSuiteRunId
    ? context.repository.requirementSuiteRuns.find((item) => item.id === requirementSuiteRunId)
    : undefined;
  const executableCase = executableCaseId
    ? context.repository.executableCases.find((item) => item.id === executableCaseId)
    : undefined;
  const caseRun = requirementSuiteRun?.caseRuns.find(
    (item) => item.executableCaseId === executableCaseId || item.testCaseId === testCase.id
  );
  if (isArtifactRunLayout(supplied)) {
    return {
      layout: supplied,
      ...(caseRun ? { caseNo: `TC-${String(caseRun.order).padStart(3, "0")}` } : {})
    };
  }
  if (requirementSuiteRun && executableCase) {
    return {
      layout: requirementArtifactLayout(context, requirementSuiteRun, executableCase),
      ...(caseRun ? { caseNo: `TC-${String(caseRun.order).padStart(3, "0")}` } : {})
    };
  }
  return {
    layout: resolveArtifactRunLayout({
      workDir: context.workDir,
      systemKey: system.name,
      requirementKey: "unscoped",
      suiteRunId: `chain-${testCase.id}`
    })
  };
}

export function isArtifactRunLayout(value: unknown): value is ArtifactRunLayout {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<ArtifactRunLayout>;
  return [candidate.root, candidate.specsDir, candidate.testsDir, candidate.evidenceDir]
    .every((path) => typeof path === "string");
}

export function resolveStructuredReporterMode(
  context: BrainCreatorMcpContext,
  input: Record<string, unknown>
) {
  const requested = optionalStringArg(input, "evidenceMode");
  if (requested && requested !== "strict" && requested !== "compatibility") {
    throw new Error("evidenceMode must be strict or compatibility");
  }
  if (requested === "compatibility" && !context.runner) {
    throw new Error(
      "evidenceMode=compatibility requires an injected runner; real Playwright execution stays strict"
    );
  }
  if (requested === "strict") return true;
  if (requested === "compatibility") return false;
  return context.structuredReporter;
}

export async function verifyAuthForExecution(
  context: BrainCreatorMcpContext,
  system: SystemProfile,
  authProfile: AuthProfile,
  ledgerContext: {
    requirementSuiteRunId?: string;
    executableCaseId?: string;
    role?: string;
  } = {}
) {
  const capture = context.service.getCaptureAuth(authProfile.id);
  if (!capture) return;
  const checkpointBinding = authCheckpointBinding(context.repository, {
    systemId: system.id,
    requirementSuiteRunId: ledgerContext.requirementSuiteRunId,
    executableCaseId: ledgerContext.executableCaseId
  });
  let storageStatePath: string | undefined;
  try {
    storageStatePath = await materializeAuthStorageState(context, system, authProfile);
  } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      const pending = context.service.listAuthCheckpoints(system.id, "awaiting-user")
        .find((checkpoint) =>
          checkpoint.authProfileId === authProfile.id &&
          checkpoint.requirementSuiteRunId === checkpointBinding.requirementSuiteRunId &&
          checkpoint.executableCaseId === checkpointBinding.executableCaseId &&
          checkpoint.evaluationTrialId === checkpointBinding.evaluationTrialId
        );
      if (!pending) {
        context.service.createAuthCheckpoint({
          systemId: system.id,
          authProfileId: authProfile.id,
          ...checkpointBinding,
          reason,
          resumeInstruction: "Refresh or capture a browser login state, then complete this checkpoint before resuming execution."
        });
      }
      recordAuthPreflight(context, authProfile, ledgerContext, {
        status: "blocked",
        message: reason
      });
      throw new BrainCreatorError({
        code: "BC_AUTH_MATERIALIZATION_FAILED",
        message: reason,
        userMessage: {
          enUS: "Authentication state could not be prepared for execution.",
          zhCN: "执行前无法准备鉴权状态。"
        },
        nextAction: "complete-auth-checkpoint",
        retryable: true
      });
  }
  if (!storageStatePath) return;
  const cacheTtlMs = Math.max(
    5_000,
    Math.min(300_000, Number(process.env.BRAIN_CREATOR_AUTH_CACHE_TTL_MS ?? 60_000))
  );
  const cachedUntil = context.authVerificationCache.get(authProfile.id) ?? 0;
  if (cachedUntil > Date.now()) {
    recordAuthPreflight(context, authProfile, ledgerContext, {
      status: "valid",
      message: "Authentication state reused from the bounded verification cache."
    });
    return;
  }
  let verification = await context.authStateVerifier({
    storageStatePath: await resolveProtectedStorageStatePath(context.workDir, storageStatePath),
    workDir: context.workDir,
    targetUrl: system.baseUrl,
    allowedUrls: system.urlAllowlist
  });
  if (verification.status === "valid") {
    context.authVerificationCache.set(authProfile.id, Date.now() + cacheTtlMs);
    recordAuthPreflight(context, authProfile, ledgerContext, {
      status: "valid",
      message: "Authentication state verified in a fresh browser context."
    });
    return;
  }
  const refreshed = await refreshAndVerifyAuthState(context, system, authProfile, verification.reason);
  if (refreshed?.status === "valid") {
    context.authVerificationCache.set(authProfile.id, Date.now() + cacheTtlMs);
    recordAuthPreflight(context, authProfile, ledgerContext, {
      status: "valid",
      message: `Authentication state refreshed and reverified${refreshed.authRefresh?.provider ? ` by ${refreshed.authRefresh.provider}` : ""}.`
    });
    return;
  }
  if (refreshed) verification = refreshed;
  context.authVerificationCache.delete(authProfile.id);
  const pending = context.service.listAuthCheckpoints(system.id, "awaiting-user")
    .find((checkpoint) =>
      checkpoint.authProfileId === authProfile.id &&
      checkpoint.requirementSuiteRunId === checkpointBinding.requirementSuiteRunId &&
      checkpoint.executableCaseId === checkpointBinding.executableCaseId &&
      checkpoint.evaluationTrialId === checkpointBinding.evaluationTrialId
    );
  if (!pending) {
    context.service.createAuthCheckpoint({
      systemId: system.id,
      authProfileId: authProfile.id,
      ...checkpointBinding,
      reason: verification.reason ?? "Stored browser authentication is no longer valid.",
      resumeInstruction: "Refresh the browser login state, then complete this checkpoint before resuming execution."
    });
  }
  recordAuthPreflight(context, authProfile, ledgerContext, {
    status: "blocked",
    message: verification.reason ?? "Stored browser authentication requires user intervention."
  });
  throw new BrainCreatorError({
    code: verification.status === "expired"
      ? "BC_AUTH_STATE_EXPIRED"
      : "BC_AUTH_STATE_UNAVAILABLE",
    message: verification.reason ?? "Stored browser authentication requires user intervention before execution.",
    userMessage: {
      enUS: "Stored browser authentication requires user intervention before execution.",
      zhCN: "保存的浏览器鉴权状态需要人工处理后才能执行。"
    },
    nextAction: "complete-auth-checkpoint",
    retryable: verification.status === "unavailable"
  });
}

export function recordAuthPreflight(
  context: BrainCreatorMcpContext,
  authProfile: AuthProfile,
  ledgerContext: {
    requirementSuiteRunId?: string;
    executableCaseId?: string;
    role?: string;
  },
  input: { status: "valid" | "blocked"; message: string }
) {
  if (!ledgerContext.requirementSuiteRunId) return;
  context.runLedger.append({
    runType: "requirement-suite",
    systemId: authProfile.projectId,
    requirementSuiteRunId: ledgerContext.requirementSuiteRunId,
    executableCaseId: ledgerContext.executableCaseId,
    event: "auth-preflight",
    scope: ledgerContext.executableCaseId ? "case" : "suite",
    stage: "preflight",
    toStatus: input.status,
    outcome: input.status === "valid" ? "passed" : "blocked",
    message: ledgerContext.role
      ? `${ledgerContext.role}: ${input.message}`
      : input.message,
    references: { authProfileId: authProfile.id }
  });
}

export async function prepareAgentTask(
  context: BrainCreatorMcpContext,
  input: Record<string, unknown>
): Promise<HostAgentTaskPackage> {
  const systemId = stringArg(input, "systemId");
  const system = context.repository.systemProfiles.find((item) => item.id === systemId);
  if (!system) {
    throw new Error("Business system not found");
  }
  const taskId = id("agentTask");
  const taskDir = join(context.workDir, ".brain-creator", "agent-tasks", taskId);
  const promptPath = join(taskDir, "input.prompt.md");
  const contextPath = join(taskDir, "input.context.json");
  const agent = agentArg(input, "agent");
  const args = stringArrayArg(input, "args");
  const outputPaths = stringArrayArg(input, "outputPaths");
  const inputSummary = stringArg(input, "inputSummary");
  const planContext = planContextArg(input);
  const chainContext = chainContextArg(input);
  const suiteContext = suiteContextArg(input);
  const regressionContext = regressionContextArg(input);
  const provider = context.agentBridge?.provider ?? "host-agent";
  const harnessSession = findOrCreateHostHarnessSession(context, systemId, provider);
  const harnessTask = context.harness.startDeferredTask({
    brain: agent === "planner" ? "requirement" : "testexecution",
    operation: `host-agent-${agent}`,
    inputSummary,
    inputRefs: [
      `system:${systemId}`,
      ...outputPaths.map((path) => `artifact:${path}`),
      ...(planContext ? [`requirement:${planContext.requirement}`] : []),
      ...(chainContext?.testCaseId ? [`test-case:${chainContext.testCaseId}`] : [])
    ],
    systemId,
    sessionId: harnessSession.id,
    provider,
    policy: {
      allowedFiles: outputPaths,
      allowWrites: true,
      requireApproval: false
    },
    budget: chainContext?.maxHealAttempts === undefined
      ? undefined
      : { maxHealAttempts: Math.max(chainContext.maxHealAttempts, 0) },
    approved: true
  });
  const contextContent = JSON.stringify({
    systemId,
    agent,
    inputSummary,
    outputPaths,
    planContext,
    chainContext,
    suiteContext,
    regressionContext
  });
  context.harness.setContextPack(harnessTask.id, {
    taskId: harnessTask.id,
    purpose: agent === "planner" ? "requirement" : "testexecution",
    summary: inputSummary,
    references: [
      { ref: `system:${systemId}`, kind: "system" },
      ...outputPaths.map((path) => ({ ref: `artifact:${path}`, kind: "artifact" as const }))
    ],
    content: contextContent,
    estimatedChars: contextContent.length,
    truncated: false
  });
  const task = context.service.createAgentTask({
    id: taskId,
    systemId,
    agent,
    inputSummary,
    args,
    outputPaths,
    promptPath,
    contextPath,
    planContext,
    chainContext,
    suiteContext,
    regressionContext,
    harnessTaskId: harnessTask.id,
    harnessSessionId: harnessSession.id
  });
  await mkdir(taskDir, { recursive: true });
  await writeFile(
    promptPath,
    hostAgentPrompt({
      systemId,
      agent,
      inputSummary,
      args,
      outputPaths,
      requiredStepIds: chainContext?.requiredStepIds,
      actorJourneyRoles: chainContext?.actorJourneyRoles,
      requiredPageObjectBindings: chainContext?.requiredPageObjectBindings
    }),
    "utf8"
  );
  await writeFile(
    contextPath,
    `${JSON.stringify(
      {
        taskId,
        harnessTaskId: harnessTask.id,
        harnessSessionId: harnessSession.id,
        systemId,
        system,
        agent,
        inputSummary,
        args,
        outputPaths,
        planContext,
        chainContext,
        suiteContext,
        regressionContext,
        workDir: context.workDir,
        submitTool: "bc_submit_agent_output"
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  return {
    status: "needs_agent_execution",
    task,
    promptPath,
    contextPath,
    outputPaths,
    submitTool: "bc_submit_agent_output",
    nextAction: "The host agent should read the prompt/context, create requested outputs, then call bc_submit_agent_output."
  };
}

export function findOrCreateHostHarnessSession(
  context: BrainCreatorMcpContext,
  systemId: string,
  provider: string
) {
  const existing = context.repository.brainSessions.find(
    (session) =>
      session.currentSystemId === systemId &&
      session.provider === provider &&
      !session.activeTaskId
  );
  return existing ?? context.harness.createSession({
    currentSystemId: systemId,
    provider
  });
}

export function taskPackageFromStoredTask(task: AgentTask): HostAgentTaskPackage {
  return {
    status: "needs_agent_execution",
    task,
    promptPath: task.promptPath,
    contextPath: task.contextPath,
    outputPaths: task.outputPaths,
    submitTool: task.submitTool,
    nextAction:
      "The host agent should read the prompt/context, create requested outputs, then call bc_submit_agent_output."
  };
}

export function requirementSuiteTestDataTaskPackage(
  requirementSuiteRun: RequirementSuiteRun,
  executableCaseId: string,
  task: TestDataTask,
  phase: "prepare" | "cleanup"
): Record<string, unknown> {
  const reconciliationRequired = task.operationPhase === "sent" || task.operationPhase === undefined;
  return {
    mode: "requirement-suite",
    status: reconciliationRequired ? "needs_test_data_reconciliation" : "needs_test_data",
    stage:
      phase === "cleanup"
        ? "test-data-cleanup"
        : "test-data-prepare",
    task,
    contextPath: task.contextPath,
    promptPath: task.promptPath,
    submitTool: "bc_prepare",
    submitInput: {
      action: "submit-test-data",
      taskId: task.id
    },
    currentExecutableCaseId: executableCaseId,
    requirementSuiteRun,
    nextAction:
      reconciliationRequired
        ? phase === "cleanup"
          ? "Read the target system without writing. If cleanup did not take effect, send the included advance notice and call confirm-cleanup-notice with its SHA-256 before retrying. Do not repeat cleanup based only on a missing response."
          : "Read the target system without writing. Submit the same entity if the operation took effect; otherwise record read-only evidence with reconcile-test-data-no-effect before retrying."
        : phase === "cleanup"
        ? "Send the included advance cleanup notice to the user. Then call confirm-cleanup-notice with its SHA-256; only after that succeeds may you mark the task sent, perform the approved cleanup, and submit evidence. If the user asks to retain the data, stop and keep the run blocked."
        : "Complete the test-data task and submit its decision and evidence before generation."
  };
}

export async function continueRequirementSuiteAfterTestData(
  context: BrainCreatorMcpContext,
  submitted: TestDataSubmitResult
): Promise<Record<string, unknown>> {
  const matched = context.repository.requirementSuiteRuns
    .flatMap((run) =>
      run.caseRuns.map((caseRun) => ({ run, caseRun }))
    )
    .find(({ caseRun }) => caseRun.testDataTaskId === submitted.task.id);
  if (!matched) return submitted as unknown as Record<string, unknown>;

  if (submitted.task.status === "failed") {
    const gapIds = submitted.gap ? [submitted.gap.id] : [];
    const blockedRun = context.requirementSuiteRuns.failTestDataTask(
      matched.run.id,
      matched.caseRun.executableCaseId,
      {
        gapIds,
        error:
          submitted.task.error ??
          "Requirement suite test-data task failed"
      }
    );
    return {
      mode: "requirement-suite",
      status: "blocked",
      stage:
        matched.caseRun.testDataPhase === "cleanup"
          ? "test-data-cleanup"
          : "test-data-prepare",
      submittedTestData: submitted,
      gap: submitted.gap,
      requirementSuiteRun: blockedRun,
      nextAction:
        "Resolve the test-data Gap, then explicitly resume the requirement suite to retry the same case."
    };
  }

  let nextCleanup: Awaited<ReturnType<typeof context.testDataProvider.prepare>> | undefined;
  if (matched.caseRun.testDataPhase === "cleanup") {
    try {
      nextCleanup = await context.testDataProvider.prepare({
        knowledgeProjectId: matched.run.knowledgeProjectId,
        systemId: matched.run.systemId,
        executableCaseId: matched.caseRun.executableCaseId,
        requirementSuiteRunId: matched.run.id,
        confirm: true,
        phase: "cleanup"
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      const gap = context.service.reportGap({
        projectId: matched.run.systemId,
        sourceType: "test-data-cleanup",
        sourceId: matched.run.id,
        reason: `Could not prepare remaining test-data cleanup: ${reason}`,
        severity: "high",
        owner: "qa"
      });
      const blockedRun = context.requirementSuiteRuns.failTestDataTask(
        matched.run.id,
        matched.caseRun.executableCaseId,
        { gapIds: [gap.id], error: reason }
      );
      return {
        mode: "requirement-suite",
        status: "blocked",
        stage: "test-data-cleanup",
        submittedTestData: submitted,
        gap,
        requirementSuiteRun: blockedRun,
        nextAction: "Resolve the cleanup Gap, then explicitly resume the requirement suite."
      };
    }
  }
  const continuedRun = context.requirementSuiteRuns.completeTestDataTask(
    matched.run.id,
    matched.caseRun.executableCaseId,
    nextCleanup?.task?.id
  );
  if (nextCleanup?.task) {
    return {
      ...requirementSuiteTestDataTaskPackage(
        continuedRun,
        matched.caseRun.executableCaseId,
        nextCleanup.task,
        "cleanup"
      ),
      submittedTestData: submitted,
      requirementSuiteRun: continuedRun
    };
  }
  if (continuedRun.status === "running") {
    const next = await executeNextRequirementSuiteCase(
      context,
      continuedRun.id,
      { maxHealAttempts: continuedRun.maxHealAttempts }
    );
    return {
      ...next,
      submittedTestData: submitted,
      requirementSuiteRun: context.requirementSuiteRuns.get(continuedRun.id)
    };
  }
  return {
    mode: "requirement-suite",
    status: continuedRun.status,
    submittedTestData: submitted,
    requirementSuiteRun: continuedRun
  };
}

export function assertExecutionPlanIsCurrent(
  context: BrainCreatorMcpContext,
  executionPlanId: string
) {
  const validation = context.executionPreflight.validatePlan(executionPlanId);
  if (!validation.valid) {
    throw new Error(
      `Execution plan is ${validation.status}: ${validation.reasons.join("; ")}`
    );
  }
  return validation.executionPlan;
}

export function redactPostconditionVerification(
  context: BrainCreatorMcpContext,
  systemId: string,
  verification: PostconditionVerification
) {
  const redact = (value?: string) =>
    value === undefined
      ? undefined
      : redactSensitiveText(value, protectedSecretsForSystem(context, systemId));
  return {
    ...verification,
    actualResult: redact(verification.actualResult),
    reason: redact(verification.reason),
    evidenceRefs: verification.evidenceRefs?.map((reference) => redact(reference)!),
    evidenceArtifacts: verification.evidenceArtifacts?.map((artifact) => ({
      path: redact(artifact.path)!,
      sha256: artifact.sha256
    }))
  };
}

export function hostAgentPrompt(input: {
  systemId: string;
  agent: AgentRun["agent"];
  inputSummary: string;
  args: string[];
  outputPaths: string[];
  requiredStepIds?: string[];
  actorJourneyRoles?: string[];
  requiredPageObjectBindings?: RequiredSystemPageObjectBinding[];
}) {
  return [
    `# Brain Creator Host Agent Task`,
    "",
    `Agent: ${input.agent}`,
    `System id: ${input.systemId}`,
    `Task: ${input.inputSummary}`,
    "",
    "Execution contract:",
    "- Execute this task as the current host agent; do not start a Claude or Codex subprocess.",
    "- Do not ask the user for permission or clarification during this task.",
    "- Keep secrets out of stdout and summaries.",
    "- Write every requested output file exactly where specified.",
    ...(input.agent === "generator" || input.agent === "healer"
      ? [
          "- When Arguments include --seed, import test and expect from that seed instead of @playwright/test; the seed owns authenticated browser setup."
        ]
      : []),
    ...(input.requiredStepIds?.length
      ? [
          `- Instrument every declared execution step with bc.step(): ${input.requiredStepIds.join(", ")}.`
        ]
      : []),
    ...(input.requiredPageObjectBindings?.length
      ? [
          "- Resolve each required page control only with the confirmed System Brain seed API: bc.pageObject(page, <pageModelId>).control(<locatorPointId>). Do not use raw selectors or substitute another binding.",
          "- Complex controls may use an explicitly registered workspace-local extension passed in bc.pageObject(..., extensions); invoke it through control.extend(extensionId), and keep the extension out of Brain Creator product source.",
          `- Required confirmed bindings: ${input.requiredPageObjectBindings
            .map(({ pageModelId, locatorPointId }) => `${pageModelId}/${locatorPointId}`)
            .join(", ")}.`
        ]
      : []),
    ...(input.actorJourneyRoles && input.actorJourneyRoles.length > 1
      ? [
          `- This is a multi-role journey. Use bc.runAsRole() and reference every role: ${input.actorJourneyRoles.join(", ")}.`
        ]
      : []),
    "",
    "Arguments:",
    input.args.length > 0 ? input.args.join(" ") : "(none)",
    "",
    "Expected output paths:",
    input.outputPaths.length > 0 ? input.outputPaths.join("\n") : "(none)",
    "",
    "When complete, call `bc_submit_agent_output` with this task id and status."
  ].join("\n");
}

export async function refreshAndVerifyAuthState(
  context: BrainCreatorMcpContext,
  system: SystemProfile,
  authProfile: AuthProfile,
  reason = "Stored browser authentication is no longer valid."
) {
  try {
    const refreshed = await context.authRefreshRegistry.refresh({
      workDir: context.workDir,
      system,
      authProfile,
      reason,
      timeoutMs: Number(process.env.BRAIN_CREATOR_AUTH_REFRESH_TIMEOUT_MS ?? 30_000)
    });
    if (refreshed.status !== "succeeded" || !refreshed.storageStatePath) {
      return {
        status: "unavailable" as const,
        reason: refreshed.reason ?? "Authentication refresh requires user intervention.",
        authRefresh: {
          attempted: true,
          provider: refreshed.provider,
          status: refreshed.status,
          reason: refreshed.reason
        }
      };
    }
    const safePath = await resolveProtectedStorageStatePath(
      context.workDir,
      refreshed.storageStatePath
    );
    context.service.setAuthStorageStatePath(authProfile.id, refreshed.storageStatePath);
    const verification = await context.authStateVerifier({
      storageStatePath: safePath,
      workDir: context.workDir,
      targetUrl: system.baseUrl,
      allowedUrls: system.urlAllowlist
    });
    return {
      ...verification,
      authRefresh: {
        attempted: true,
        provider: refreshed.provider,
        status: refreshed.status
      }
    };
  } catch (error) {
    return {
      status: "unavailable" as const,
      reason: error instanceof Error ? error.message : String(error),
      authRefresh: {
        attempted: true,
        status: "failed",
        reason: error instanceof Error ? error.message : String(error)
      }
    };
  }
}

export function findAuthProfile(context: BrainCreatorMcpContext, systemId: string): AuthProfile {
  const profile = context.repository.authProfiles
    .filter((item) => item.projectId === systemId && item.status !== "cancelled")
    .sort((left, right) => {
      const statusDifference = authProfileStatusRank(right) - authProfileStatusRank(left);
      return statusDifference || right.updatedAt.localeCompare(left.updatedAt);
    })[0];
  if (!profile) {
    throw new Error("Auth profile not found");
  }
  return profile;
}

export function authProfileStatusRank(profile: AuthProfile) {
  if (profile.status === "succeeded") {
    return 3;
  }
  if (profile.status === "running") {
    return 2;
  }
  if (profile.status === "pending") {
    return 1;
  }
  return 0;
}

export function findAuthProfileById(
  context: BrainCreatorMcpContext,
  systemId: string,
  authProfileId: string
): AuthProfile {
  const profile = context.repository.authProfiles.find((item) => item.id === authProfileId);
  if (!profile) {
    throw new Error("Auth profile not found");
  }
  if (profile.projectId !== systemId) {
    throw new Error("Auth profile belongs to another business system");
  }
  if (profile.status === "cancelled") {
    throw new Error("Auth profile is archived");
  }
  return profile;
}
