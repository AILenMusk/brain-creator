import type {
  EvaluationTrial,
  BusinessScenario,
  InterventionRecord,
  ConformanceResult
} from "../brain/types.js";
import type {
  ExecutionEvidence,
  ExecutableCase,
  RequirementSuiteRun,
  RunLedgerEntry,
  TestDataLease,
  TestDataTask
} from "../domain/types.js";
import { evaluateConformance } from "../execution/conformance.js";

export type EvaluationMetricStatus = "measured" | "not-measured" | "not-comparable";

export type EvaluationScenarioMetric = {
  status: EvaluationMetricStatus;
  denominator: number | null;
  measured: number | null;
  passed: number | null;
  failed: number | null;
  blocked: number | null;
  notRun: number | null;
  syntheticOrUnknown: number | null;
  inconclusive: number | null;
  rate: number | null;
};

export type EvaluationTrialMetrics = {
  comparability: "comparable" | "not-comparable";
  comparabilityReasons: string[];
  linkedRunIds: string[];
  linkedRunCount: number;
  scenarioIds: string[];
  businessConformance: EvaluationScenarioMetric;
  operations: {
    firstValidResult: {
      status: "measured" | "not-measured";
      elapsedMs: number | null;
      scenarioId: string | null;
    };
    recovery: {
      status: "measured" | "not-measured";
      denominator: number | null;
      succeeded: number | null;
      unresolved: number | null;
      rate: number | null;
    };
    cleanup: {
      status: "measured" | "not-measured";
      denominator: number | null;
      succeeded: number | null;
      failed: number | null;
      pending: number | null;
      retained: number | null;
      rate: number | null;
    };
  };
  autonomy: {
    status: "measured" | "not-measured";
    interventions: InterventionRecord[];
    codeChanges: InterventionRecord[];
    autonomousScenarios: number | null;
    denominator: number | null;
    rate: number | null;
    manualScenarioIds: string[] | null;
    authenticationInterventionCounts: {
      initialAuthorization: number;
      sessionRecovery: number;
      unclassified: number;
    } | null;
    reason: string;
  };
};

export function calculateEvaluationTrialMetrics(input: {
  trial: EvaluationTrial;
  runs: RequirementSuiteRun[];
  evidence: ExecutionEvidence[];
  conformanceResults: ConformanceResult[];
  scenarios: BusinessScenario[];
  executableCases: ExecutableCase[];
  interventions: InterventionRecord[];
  runLedgerEntries?: RunLedgerEntry[];
  testDataTasks?: TestDataTask[];
  testDataLeases?: TestDataLease[];
  artifactValidationByEvidenceId?: Map<string, NonNullable<ExecutionEvidence["artifactValidation"]>>;
  semanticSnapshotValidByEvidenceId?: Map<string, boolean>;
  interventionIntegrityValidById?: Map<string, boolean>;
  interventionCaptureIntegrityValid?: boolean;
  interventionSourcesComplete?: boolean;
  actionEvidenceArtifactsValidByEntryId?: Map<string, boolean>;
}): EvaluationTrialMetrics {
  const scope = input.trial.executionScope;
  const scenarioIds = [...new Set(scope?.businessScenarioIds ?? [])];
  const comparableReasons: string[] = [];
  if (input.trial.status === "invalidated") comparableReasons.push("Evaluation trial is invalidated");
  if (!scope || scenarioIds.length === 0) comparableReasons.push("Evaluation trial has no frozen business scenario scope");
  if (!input.trial.requirementSetId) comparableReasons.push("Evaluation trial has no frozen source requirement set");
  if (scenarioIds.length > 0 && (!input.trial.runtimeBuildIdentity || input.trial.runtimeBuildIdentity === "unknown")) {
    comparableReasons.push("Evaluation trial has no known pinned runtime build identity");
  }
  if (!input.trial.systemId || !scope?.scopeHash || !scope.baselineHash) comparableReasons.push("Evaluation trial lacks a verifiable execution scope");
  if (scenarioIds.some((scenarioId) => !input.scenarios.some((scenario) => scenario.id === scenarioId))) {
    comparableReasons.push("Frozen business scenario scope contains an unknown scenario");
  }

  const linkedRuns = input.runs.filter((run) => isLinkedEvaluationRun(run, input.trial));
  const scenarioEvaluation = comparableReasons.length > 0
    ? { metric: notComparableMetric(scenarioIds.length > 0 ? scenarioIds.length : null), outcomes: new Map<string, ScenarioOutcome>() }
    : scenarioMetric(input.trial, scenarioIds, linkedRuns, input.evidence, input.conformanceResults, input.scenarios, input.executableCases, input.artifactValidationByEvidenceId, input.semanticSnapshotValidByEvidenceId);
  const interventions = input.interventions.filter((item) => item.trialId === input.trial.id);
  const linkedRunIds = new Set(linkedRuns.map((run) => run.id));
  return {
    comparability: comparableReasons.length > 0 ? "not-comparable" : "comparable",
    comparabilityReasons: comparableReasons,
    linkedRunIds: linkedRuns.map((run) => run.id),
    linkedRunCount: linkedRuns.length,
    scenarioIds,
    businessConformance: scenarioEvaluation.metric,
    operations: calculateOperationalMetrics(
      input.trial,
      scenarioEvaluation.firstValidResult,
      input.runLedgerEntries ?? [],
      input.testDataTasks ?? [],
      input.testDataLeases ?? [],
      linkedRunIds,
      input.actionEvidenceArtifactsValidByEntryId
    ),
    autonomy: calculateAutonomy(
      input.trial,
      scenarioIds,
      scenarioEvaluation.outcomes,
      interventions,
      comparableReasons,
      input.interventionIntegrityValidById,
      input.interventionCaptureIntegrityValid,
      input.interventionSourcesComplete
    )
  };
}

function calculateOperationalMetrics(
  trial: EvaluationTrial,
  firstValidResult: { scenarioId: string; at: string } | undefined,
  ledger: RunLedgerEntry[],
  tasks: TestDataTask[],
  leases: TestDataLease[],
  linkedRunIds: Set<string>,
  actionEvidenceArtifactsValidByEntryId?: Map<string, boolean>
): EvaluationTrialMetrics["operations"] {
  const firstValidAt = firstValidResult?.at;
  const elapsedMs = firstValidAt
    ? Date.parse(firstValidAt) - Date.parse(trial.createdAt)
    : Number.NaN;
  const validElapsed = Number.isFinite(elapsedMs) && elapsedMs >= 0;

  const scopedLedger = ledger.filter((entry) =>
    entry.runType !== "document-suite" &&
    entry.requirementSuiteRunId && linkedRunIds.has(entry.requirementSuiteRunId) &&
    entry.knowledgeProjectId === trial.knowledgeProjectId &&
    entry.systemId === trial.systemId
  );
  const actionGroups = new Map<string, RunLedgerEntry[]>();
  for (const entry of scopedLedger) {
    if (!entry.actionKey || !entry.actionPhase || !entry.requirementSuiteRunId) continue;
    const key = `${entry.requirementSuiteRunId}\u0000${entry.executableCaseId ?? ""}\u0000${entry.actionKey}`;
    actionGroups.set(key, [...(actionGroups.get(key) ?? []), entry]);
  }
  const recoveryAttempts = [...actionGroups.values()].filter((entries) =>
    entries.some((entry) => entry.event === "action-reconciliation-required")
  );
  const recoverySucceeded = recoveryAttempts.filter((entries) => {
    const latest = [...entries].sort(compareLedgerSequence).at(-1);
    return latest?.event === "action-reconciled" &&
      Boolean(latest.actionEvidenceRefs?.length) &&
      Boolean(latest.actionEvidenceArtifacts?.length) &&
      latest.actionEvidenceArtifacts!.every((artifact) => /^[a-f0-9]{64}$/i.test(artifact.sha256)) &&
      actionEvidenceArtifactsValidByEntryId?.get(latest.id) === true;
  }).length;

  const scopedTasks = tasks.filter((task) => task.action === "cleanup" &&
    task.requirementSuiteRunId && linkedRunIds.has(task.requirementSuiteRunId) &&
    task.knowledgeProjectId === trial.knowledgeProjectId &&
    task.systemId === trial.systemId);
  const taskLeases = new Map(leases.map((lease) => [lease.id, lease]));
  const cleanupSucceeded = scopedTasks.filter((task) =>
    task.status === "submitted" && task.leaseId && (() => {
      const lease = taskLeases.get(task.leaseId);
      return lease?.status === "released" &&
        lease.requirementSuiteRunId === task.requirementSuiteRunId &&
        lease.knowledgeProjectId === trial.knowledgeProjectId &&
        lease.systemId === trial.systemId;
    })()
  ).length;
  const cleanupFailed = scopedTasks.filter((task) =>
    task.status === "failed" || (task.leaseId && taskLeases.get(task.leaseId)?.status === "cleanup-failed" &&
      taskLeases.get(task.leaseId)?.requirementSuiteRunId === task.requirementSuiteRunId &&
      taskLeases.get(task.leaseId)?.knowledgeProjectId === trial.knowledgeProjectId &&
      taskLeases.get(task.leaseId)?.systemId === trial.systemId)
  ).length;
  const cleanupRetained = scopedTasks.filter((task) => task.cleanup === "none").length;
  const cleanupDenominator = scopedTasks.length - cleanupRetained;
  const cleanupPending = Math.max(0, cleanupDenominator - cleanupSucceeded - cleanupFailed);

  return {
    firstValidResult: {
      status: validElapsed ? "measured" : "not-measured",
      elapsedMs: validElapsed ? elapsedMs : null,
      scenarioId: validElapsed ? firstValidResult!.scenarioId : null
    },
    recovery: {
      status: recoveryAttempts.length > 0 ? "measured" : "not-measured",
      denominator: recoveryAttempts.length || null,
      succeeded: recoveryAttempts.length > 0 ? recoverySucceeded : null,
      unresolved: recoveryAttempts.length > 0 ? recoveryAttempts.length - recoverySucceeded : null,
      rate: recoveryAttempts.length > 0 ? recoverySucceeded / recoveryAttempts.length : null
    },
    cleanup: {
      status: cleanupDenominator > 0 ? "measured" : "not-measured",
      denominator: cleanupDenominator || null,
      succeeded: cleanupDenominator > 0 ? cleanupSucceeded : null,
      failed: cleanupDenominator > 0 ? cleanupFailed : null,
      pending: cleanupDenominator > 0 ? cleanupPending : null,
      retained: scopedTasks.length > 0 ? cleanupRetained : null,
      rate: cleanupDenominator > 0 ? cleanupSucceeded / cleanupDenominator : null
    }
  };
}

function compareLedgerSequence(left: RunLedgerEntry, right: RunLedgerEntry) {
  return (left.sequence ?? Number.MAX_SAFE_INTEGER) - (right.sequence ?? Number.MAX_SAFE_INTEGER) ||
    left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id);
}

function calculateAutonomy(
  trial: EvaluationTrial,
  scenarioIds: string[],
  outcomes: Map<string, ScenarioOutcome>,
  interventions: InterventionRecord[],
  comparabilityReasons: string[],
  interventionIntegrityValidById?: Map<string, boolean>,
  interventionCaptureIntegrityValid?: boolean,
  interventionSourcesComplete?: boolean
): EvaluationTrialMetrics["autonomy"] {
  const codeChanges = interventions.filter((item) => ["code-change", "product-source-change"].includes(item.category));
  const capture = trial.interventionCapture;
  const base = {
    interventions,
    codeChanges,
    autonomousScenarios: null,
    denominator: scenarioIds.length || null,
    rate: null,
    manualScenarioIds: null as string[] | null,
    authenticationInterventionCounts: null
  };
  if (comparabilityReasons.length > 0) {
    return { ...base, status: "not-measured", reason: `Trial is not comparable: ${comparabilityReasons.join("; ")}` };
  }
  if (!capture) {
    return { ...base, status: "not-measured", reason: "Intervention capture has not been attested for the completed Trial." };
  }
  if (interventionCaptureIntegrityValid === false) {
    return { ...base, status: "not-measured", reason: "Intervention capture integrity could not be verified." };
  }
  if (interventionSourcesComplete === false) {
    return { ...base, status: "not-measured", reason: "A completed Trial-bound authentication checkpoint or manual recovery is missing an intervention record." };
  }
  if (interventionIntegrityValidById && interventions.some((item) => interventionIntegrityValidById.get(item.id) !== true)) {
    return { ...base, status: "not-measured", reason: "An intervention record integrity could not be verified." };
  }
  if (!trial.executionScope?.scopeHash || capture.scopeHash !== trial.executionScope.scopeHash ||
      stableScenarioIds(capture.scenarioIds) !== stableScenarioIds(scenarioIds)) {
    return { ...base, status: "not-measured", reason: "Intervention capture does not match the frozen Trial scenario scope." };
  }
  const capturedInterventionIds = new Set(capture.interventionIds);
  if (interventions.some((item) => !capturedInterventionIds.has(item.id))) {
    return { ...base, status: "not-measured", reason: "An intervention was recorded after the capture attestation." };
  }
  const currentInterventionIds = new Set(interventions.map((item) => item.id));
  if (capturedInterventionIds.size !== currentInterventionIds.size ||
      [...capturedInterventionIds].some((interventionId) => !currentInterventionIds.has(interventionId))) {
    return { ...base, status: "not-measured", reason: "An intervention is missing from the captured Trial record set." };
  }
  const manualInterventions = interventions.filter((item) =>
    item.category === "user-clarification" ||
    item.category === "manual-evidence-review" ||
    item.category === "manual-recovery" ||
    (item.category === "user-authentication" && item.authenticationPhase !== "initial-authorization")
  );
  if (manualInterventions.some((item) => !item.businessScenarioIds?.length)) {
    return { ...base, status: "not-measured", reason: "At least one manual intervention is not attributed to a frozen scenario." };
  }
  const manualScenarioIds = [...new Set(manualInterventions.flatMap((item) => item.businessScenarioIds ?? []))]
    .filter((scenarioId) => scenarioIds.includes(scenarioId)).sort();
  const manualScenarioSet = new Set(manualScenarioIds);
  const autonomousScenarios = scenarioIds.filter((scenarioId) =>
    outcomes.get(scenarioId)?.kind === "passed" && !manualScenarioSet.has(scenarioId)
  ).length;
  const authenticationInterventions = interventions.filter((item) => item.category === "user-authentication");
  return {
    ...base,
    status: "measured",
    autonomousScenarios,
    manualScenarioIds,
    authenticationInterventionCounts: {
      initialAuthorization: authenticationInterventions.filter((item) => item.authenticationPhase === "initial-authorization").length,
      sessionRecovery: authenticationInterventions.filter((item) => item.authenticationPhase === "session-recovery").length,
      unclassified: authenticationInterventions.filter((item) => !item.authenticationPhase).length
    },
    rate: scenarioIds.length > 0 ? autonomousScenarios / scenarioIds.length : null,
    reason: "Only scenarios with qualifying real-system conformance and no attributed user intervention beyond initial authorization count as autonomously completed; initial authorization is reported separately, while session recovery and unclassified authentication remain interventions. Blocked and unexecuted scenarios stay in the denominator."
  };
}

function stableScenarioIds(values: string[]) {
  return JSON.stringify([...new Set(values)].sort());
}

function scenarioMetric(
  trial: EvaluationTrial,
  scenarioIds: string[],
  runs: RequirementSuiteRun[],
  evidence: ExecutionEvidence[],
  conformanceResults: ConformanceResult[],
  scenarios: BusinessScenario[],
  executableCases: ExecutableCase[],
  artifactValidationByEvidenceId?: Map<string, NonNullable<ExecutionEvidence["artifactValidation"]>>,
  semanticSnapshotValidByEvidenceId?: Map<string, boolean>
): { metric: EvaluationScenarioMetric; outcomes: Map<string, ScenarioOutcome>; firstValidResult?: { scenarioId: string; at: string } } {
  const evidenceById = new Map(evidence.map((item) => [item.id, item]));
  const conformanceByEvidenceId = new Map(
    conformanceResults.map((item) => [item.executionEvidenceId, item])
  );
  const outcomesByCaseId = new Map<string, ScenarioOutcome>();
  let firstValidResult: { scenarioId: string; at: string } | undefined;
  for (const run of runs) {
    for (const caseRun of run.caseRuns) {
      const caseScenarioIds = scenariosForCase(caseRun.executableCaseId, scenarios, executableCases);
      if (caseScenarioIds.length === 0) continue;
      const records = [
        ...caseRun.attempts.map((attempt) => ({
          evidenceId: attempt.executionEvidenceId,
          status: attempt.status,
          at: attempt.completedAt ?? attempt.archivedAt
        })),
        { evidenceId: caseRun.executionEvidenceId, status: caseRun.status, at: caseRun.completedAt ?? run.updatedAt }
      ];
      for (const scenarioId of caseScenarioIds) {
        if (!scenarioIds.includes(scenarioId)) continue;
        for (const record of records) {
          const candidate = caseScenarioIds.length !== 1
            ? { kind: "inconclusive" as const, at: record.at }
            : outcomeFor(trial, run, caseRun.executableCaseId, scenarioId, record, evidenceById, conformanceByEvidenceId, executableCases, artifactValidationByEvidenceId, semanticSnapshotValidByEvidenceId);
          if (!candidate) continue;
          if (candidate.kind === "passed" && (!firstValidResult || candidate.at < firstValidResult.at)) {
            firstValidResult = { scenarioId, at: candidate.at };
          }
          const prior = outcomesByCaseId.get(caseRun.executableCaseId);
          if (isLaterOrMoreConservative(candidate, prior)) outcomesByCaseId.set(caseRun.executableCaseId, candidate);
        }
      }
    }
  }

  const outcomes = new Map<string, ScenarioOutcome>();
  for (const scenarioId of scenarioIds) {
    const scenario = scenarios.find((item) => item.id === scenarioId);
    if (!scenario?.testIntentIds?.length) {
      outcomes.set(scenarioId, { kind: "not-run", at: trial.createdAt });
      continue;
    }
    const caseIds: string[] = [];
    let unresolved: ScenarioOutcome["kind"] | undefined;
    for (const testIntentId of new Set(scenario.testIntentIds)) {
      const candidates = executableCases.filter((item) =>
        item.knowledgeProjectId === trial.knowledgeProjectId &&
        item.requirementSetId === scenario.requirementSetId &&
        item.testIntentId === testIntentId &&
        (!item.systemId || item.systemId === trial.systemId) &&
        (item.status === "ready" || item.status === "executed")
      );
      if (candidates.length === 0) {
        unresolved = "not-run";
        break;
      }
      if (candidates.length !== 1 || scenariosForCase(candidates[0].id, scenarios, executableCases).length !== 1) {
        unresolved = "inconclusive";
        break;
      }
      caseIds.push(candidates[0].id);
    }
    if (unresolved) {
      outcomes.set(scenarioId, { kind: unresolved, at: latestCaseOutcomeAt(caseIds, outcomesByCaseId, trial.createdAt) });
      continue;
    }
    const caseOutcomes = caseIds.map((caseId) => outcomesByCaseId.get(caseId) ?? { kind: "not-run" as const, at: trial.createdAt });
    outcomes.set(scenarioId, aggregateScenarioOutcomes(caseOutcomes));
  }

  let measured = 0;
  let passed = 0;
  let failed = 0;
  let blocked = 0;
  let notRun = 0;
  let syntheticOrUnknown = 0;
  let inconclusive = 0;
  for (const scenarioId of scenarioIds) {
    const outcome = outcomes.get(scenarioId);
    if (!outcome || outcome.kind === "not-run") {
      notRun += 1;
    } else if (outcome.kind === "blocked") {
      blocked += 1;
    } else if (outcome.kind === "synthetic-or-unknown") {
      syntheticOrUnknown += 1;
    } else if (outcome.kind === "inconclusive") {
      inconclusive += 1;
    } else {
      measured += 1;
      if (outcome.kind === "passed") passed += 1;
      else failed += 1;
    }
  }
  return {
    metric: {
      status: measured > 0 ? "measured" : "not-measured",
      denominator: scenarioIds.length,
      measured,
      passed,
      failed,
      blocked,
      notRun,
      syntheticOrUnknown,
      inconclusive,
      rate: measured > 0 ? passed / scenarioIds.length : null
    },
    outcomes,
    firstValidResult
  };
}

type ScenarioOutcome = {
  kind: "passed" | "failed" | "blocked" | "not-run" | "synthetic-or-unknown" | "inconclusive";
  at: string;
};

function isLaterOrMoreConservative(candidate: ScenarioOutcome, prior?: ScenarioOutcome) {
  if (!prior || candidate.at > prior.at) return true;
  if (candidate.at < prior.at) return false;
  const severity: Record<ScenarioOutcome["kind"], number> = {
    passed: 0,
    "not-run": 1,
    inconclusive: 2,
    "synthetic-or-unknown": 3,
    blocked: 4,
    failed: 5
  };
  return severity[candidate.kind] >= severity[prior.kind];
}

function latestCaseOutcomeAt(caseIds: string[], outcomes: Map<string, ScenarioOutcome>, fallback: string) {
  return caseIds.map((caseId) => outcomes.get(caseId)?.at).filter((value): value is string => Boolean(value))
    .sort().at(-1) ?? fallback;
}

function aggregateScenarioOutcomes(outcomes: ScenarioOutcome[]): ScenarioOutcome {
  const at = outcomes.map((item) => item.at).sort().at(-1) ?? "";
  const kind = outcomes.some((item) => item.kind === "failed") ? "failed"
    : outcomes.some((item) => item.kind === "blocked") ? "blocked"
      : outcomes.some((item) => item.kind === "not-run") ? "not-run"
        : outcomes.some((item) => item.kind === "synthetic-or-unknown") ? "synthetic-or-unknown"
          : outcomes.some((item) => item.kind === "inconclusive") ? "inconclusive"
            : "passed";
  return { kind, at };
}

function outcomeFor(
  trial: EvaluationTrial,
  run: RequirementSuiteRun,
  executableCaseId: string,
  scenarioId: string,
  record: { evidenceId?: string; status: string; at: string },
  evidenceById: Map<string, ExecutionEvidence>,
  conformanceByEvidenceId: Map<string, ConformanceResult>,
  executableCases: ExecutableCase[],
  artifactValidationByEvidenceId?: Map<string, NonNullable<ExecutionEvidence["artifactValidation"]>>,
  semanticSnapshotValidByEvidenceId?: Map<string, boolean>
): ScenarioOutcome | undefined {
  if (!record.evidenceId) {
    return record.status === "blocked"
      ? { kind: "blocked", at: record.at }
      : { kind: "not-run", at: record.at };
  }
  const evidence = evidenceById.get(record.evidenceId);
  const conformance = conformanceByEvidenceId.get(record.evidenceId);
  const artifactValidation = artifactValidationByEvidenceId?.get(record.evidenceId) ?? evidence?.artifactValidation;
  if (!evidence || !validEvidenceContext(evidence, trial, run, executableCaseId, executableCases)) {
    return { kind: "inconclusive", at: record.at };
  }
  if (["queued", "running", "waiting-for-test-data", "waiting-for-agent", "cancelled", "blocked"].includes(record.status) &&
      (!evidence.completedAt || evidence.completedAt < record.at)) {
    return { kind: record.status === "blocked" ? "blocked" : "not-run", at: record.at };
  }
  if (evidence.provenance !== "real-system") return { kind: "synthetic-or-unknown", at: record.at };
  if (evidence.status === "blocked") return { kind: "blocked", at: record.at };
  if (semanticSnapshotValidByEvidenceId && semanticSnapshotValidByEvidenceId.get(evidence.id) !== true) {
    return { kind: "inconclusive", at: record.at };
  }
  if (artifactValidation?.status !== "valid" || !conformance || conformance.scenarioId !== scenarioId) {
    return { kind: "inconclusive", at: record.at };
  }
  if (!evidence.completedAt || !evidence.reporterResult || !artifactValidation.files.length ||
      artifactValidation.files.some((file) => !/^[a-f0-9]{64}$/i.test(file.sha256)) ||
      !conformance.expectationRefs.length || !conformance.observationRefs.length || !conformance.executionRefs.length) {
    return { kind: "inconclusive", at: record.at };
  }
  const checked = evaluateConformance({
    scenarioId, executionEvidenceId: evidence.id,
    status: evidence.status === "running" ? "blocked" : evidence.status,
    assuranceLevel: evidence.assuranceLevel, contracts: evidence.assertionContracts,
    reporter: evidence.reporterResult, artifactValidation,
    provenance: evidence.provenance, expectationRefs: conformance.expectationRefs,
    observationRefs: conformance.observationRefs, executionRefs: conformance.executionRefs
  });
  if (checked.verdict !== conformance.verdict) return { kind: "inconclusive", at: record.at };
  if (conformance.verdict === "conform" && evidence.status === "passed" && record.status === "passed") return { kind: "passed", at: evidence.completedAt };
  if (conformance.verdict === "nonconform") return { kind: "failed", at: record.at };
  return { kind: "inconclusive", at: record.at };
}

export function isLinkedEvaluationRun(run: RequirementSuiteRun, trial: EvaluationTrial) {
  return run.evaluationTrialId === trial.id &&
    run.knowledgeProjectId === trial.knowledgeProjectId &&
    (!trial.systemId || run.systemId === trial.systemId) &&
    (!trial.requirementSetId || (run.requirementSetIds?.length === 1 && run.requirementSetIds[0] === trial.requirementSetId)) &&
    run.createdAt >= trial.createdAt &&
    (!trial.runtimeBuildIdentity || run.evaluationRuntimeBuildIdentity === trial.runtimeBuildIdentity) &&
    (!trial.requirementSetId || (run.evaluationSourceRevision === trial.sourceRevision && run.evaluationSourceHash === trial.sourceHash));
}

function validEvidenceContext(
  evidence: ExecutionEvidence,
  trial: EvaluationTrial,
  run: RequirementSuiteRun,
  executableCaseId: string,
  executableCases: ExecutableCase[]
) {
  const executableCase = executableCases.find((item) => item.id === executableCaseId);
  return evidence.knowledgeProjectId === trial.knowledgeProjectId &&
    evidence.systemId === run.systemId &&
    evidence.executableCaseId === executableCaseId &&
    evidence.requirementSuiteRunId === run.id &&
    Boolean(executableCase) &&
    executableCase!.knowledgeProjectId === trial.knowledgeProjectId &&
    (!trial.requirementSetId || executableCase!.requirementSetId === trial.requirementSetId) &&
    (!executableCase!.systemId || executableCase!.systemId === run.systemId) &&
    evidence.createdAt >= trial.createdAt &&
    evidence.createdAt >= run.createdAt &&
    (!run.completedAt || evidence.createdAt <= run.completedAt) &&
    (!evidence.completedAt || evidence.completedAt >= evidence.createdAt) &&
    (!run.completedAt || !evidence.completedAt || evidence.completedAt <= run.completedAt);
}

function scenariosForCase(
  executableCaseId: string,
  scenarios: BusinessScenario[],
  executableCases: ExecutableCase[]
) {
  const executableCase = executableCases.find((item) => item.id === executableCaseId);
  if (!executableCase) return [];
  return scenarios
    .filter((scenario) => scenario.knowledgeProjectId === executableCase.knowledgeProjectId &&
      scenario.requirementSetId === executableCase.requirementSetId &&
      (scenario.testIntentIds ?? []).includes(executableCase.testIntentId))
    .map((scenario) => scenario.id);
}

function notComparableMetric(denominator: number | null): EvaluationScenarioMetric {
  return {
    status: "not-comparable",
    denominator,
    measured: null,
    passed: null,
    failed: null,
    blocked: null,
    notRun: null,
    syntheticOrUnknown: null,
    inconclusive: null,
    rate: null
  };
}
