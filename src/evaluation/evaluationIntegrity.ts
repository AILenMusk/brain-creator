import { createHash } from "node:crypto";
import { resolve } from "node:path";
import type {
  EvaluationInterventionCategory,
  EvaluationProvider,
  EvaluationTrial,
  InterventionRecord,
  ProjectionManifest,
  SourceSnapshot
} from "../brain/types.js";
import type { RequirementSource } from "../domain/types.js";
import type { InMemoryBrainCreatorRepository } from "../domain/repository.js";
import type { IntegrityAuthenticator } from "../shared/crypto.js";
import { id } from "../shared/id.js";
import { RequirementGateService } from "./requirementGate.js";

export type StartEvaluationTrialInput = {
  comparisonGroupId: string;
  knowledgeProjectId: string;
  systemId?: string;
  requirementSourceId: string;
  provider: EvaluationProvider;
  workspacePath: string;
  storePath: string;
  codeRevision: string;
  runtimeVersions: Record<string, string>;
  runtimeBuildIdentity?: string;
  businessScenarioIds?: string[];
  approvalReceiptId?: string;
};

export class EvaluationIntegrityService {
  constructor(
    private readonly repository: InMemoryBrainCreatorRepository,
    private readonly projectionAuthenticator?: IntegrityAuthenticator
  ) {}

  startTrial(input: StartEvaluationTrialInput) {
    const source = this.repository.requirementSources.find(
      (item) => item.id === input.requirementSourceId && item.knowledgeProjectId === input.knowledgeProjectId
    );
    if (!source) throw new Error("Requirement source not found for the evaluation trial");
    const project = this.repository.knowledgeProjects.find((item) => item.id === input.knowledgeProjectId);
    if (!project) throw new Error("Knowledge project not found for the evaluation trial");
    if (input.systemId) {
      if (!this.repository.systemProfiles.some((item) => item.id === input.systemId)) {
        throw new Error("Evaluation trial system not found");
      }
      if (!project.systemIds.includes(input.systemId)) {
        throw new Error("Evaluation trial system is not bound to the knowledge project");
      }
    }
    const requirementSetId = source.latestRequirementSetId;
    const requirementSet = requirementSetId
      ? this.repository.requirementSets.find((item) => item.id === requirementSetId)
      : undefined;
    if (requirementSetId && (!requirementSet || requirementSet.knowledgeProjectId !== project.id || requirementSet.sourceId !== source.id)) {
      throw new Error("Evaluation trial source requirement set is invalid");
    }
    const scenarioIds = unique(input.businessScenarioIds ?? []);
    if (scenarioIds.length > 0 && !input.systemId) {
      throw new Error("A scoped evaluation trial requires an explicit business system");
    }
    for (const scenarioId of scenarioIds) {
      const scenario = this.repository.businessScenarios.find((item) => item.id === scenarioId);
      if (!scenario || scenario.knowledgeProjectId !== project.id || scenario.requirementSetId !== requirementSetId) {
        throw new Error("Evaluation trial scenario is outside the source requirement set");
      }
    }
    const scenarioReadinessReasons = this.scenarioReadinessReasons({
      knowledgeProjectId: project.id,
      systemId: input.systemId,
      scenarioIds
    });
    if (scenarioReadinessReasons.length > 0) {
      throw new Error(`Evaluation trial scenarios are not ready: ${scenarioReadinessReasons.join("; ")}`);
    }
    const approvalReceipt = input.approvalReceiptId
      ? this.repository.approvalReceipts.find((item) => item.id === input.approvalReceiptId)
      : undefined;
    if (input.approvalReceiptId && (!approvalReceipt || !requirementSetId || requirementSet?.status !== "approved" || !approvalReceipt.assetRefs.includes(`requirement-set:${requirementSetId}`))) {
      throw new Error("Evaluation trial approval must reference an existing approved requirement set");
    }
    if (approvalReceipt && requirementSetId) {
      new RequirementGateService(this.repository).verifyApprovalReceipt(requirementSetId, approvalReceipt.id);
    }
    const peers = this.repository.evaluationTrials.filter(
      (item) => item.comparisonGroupId === input.comparisonGroupId
    );
    if (peers.some((item) => samePath(item.storePath, input.storePath))) {
      throw new Error("Each provider in an evaluation comparison must use an isolated store");
    }
    if (peers.some((item) =>
      item.requirementSourceId !== source.id ||
      item.sourceRevision !== source.revision ||
      item.sourceHash !== source.contentHash
    )) {
      throw new Error("Evaluation comparison trials must use the same source revision and hash");
    }
    if (peers.some((item) => item.codeRevision !== input.codeRevision)) {
      throw new Error("Evaluation comparison trials must use the same code revision");
    }

    const now = new Date().toISOString();
    const systemBrainSnapshot = scenarioIds.length > 0 && input.systemId
      ? this.latestConfirmedSystemBrainSnapshot(project.id, input.systemId)
      : undefined;
    const executionScope = scenarioIds.length > 0 || approvalReceipt ? {
      businessScenarioIds: [...scenarioIds].sort(),
      baselineHash: requirementSetId ? new RequirementGateService(this.repository).baselineFingerprint(requirementSetId) : undefined,
      ...(systemBrainSnapshot ? {
        systemBrainSnapshotId: systemBrainSnapshot.id,
        systemBrainSnapshotHash: systemBrainSnapshot.contentHash
      } : {}),
      ...(approvalReceipt ? { approvalScopeRef: approvalReceipt.id, approvalScopeHash: approvalReceipt.assetHash } : {})
    } : undefined;
    const trialId = id("evaluationTrial");
    const sourceSnapshot: SourceSnapshot = {
      id: id("sourceSnapshot"),
      trialId,
      sourceId: source.id,
      knowledgeProjectId: source.knowledgeProjectId,
      requirementSetId: source.latestRequirementSetId,
      sourceType: source.sourceType,
      sourceRevision: source.revision,
      contentHash: source.contentHash,
      semanticInputHash: requirementSemanticInputHash(source),
      sourceLocatorHash: hash(source.source),
      blockCount: source.blocks.length,
      attachmentCount: source.attachments.length,
      warningCount: source.warnings.length,
      createdAt: now
    };
    if (this.projectionAuthenticator) {
      sourceSnapshot.integrityTag = this.projectionAuthenticator.sign(sourceSnapshotPayload(sourceSnapshot));
    }
    const projectionManifest = this.buildManifest({
      trialId,
      knowledgeProjectId: source.knowledgeProjectId,
      systemId: input.systemId,
      operation: "start-trial",
      evidenceRefs: [`requirement-source:${source.id}`, `source-snapshot:${sourceSnapshot.id}`]
    });
    const trial: EvaluationTrial = {
      id: trialId,
      comparisonGroupId: required(input.comparisonGroupId, "Comparison group"),
      knowledgeProjectId: source.knowledgeProjectId,
      systemId: input.systemId,
      requirementSourceId: source.id,
      sourceSnapshotId: sourceSnapshot.id,
      sourceRevision: source.revision,
      sourceHash: source.contentHash,
      requirementSetId,
      provider: input.provider,
      workspacePath: resolve(required(input.workspacePath, "Workspace path")),
      storePath: resolve(required(input.storePath, "Store path")),
      codeRevision: required(input.codeRevision, "Code revision"),
      runtimeVersions: normalizedRecord(input.runtimeVersions),
      ...(executionScope
        ? { runtimeBuildIdentity: input.runtimeBuildIdentity ?? "unknown" }
        : input.runtimeBuildIdentity
          ? { runtimeBuildIdentity: input.runtimeBuildIdentity }
          : {}),
      ...(executionScope ? { executionScope: { ...executionScope, scopeHash: hash(stableStringify(executionScope)) } } : {}),
      latestProjectionManifestId: projectionManifest.id,
      status: "active",
      invalidationReasons: [],
      createdAt: now,
      updatedAt: now
    };
    this.repository.transaction(() => {
      this.repository.sourceSnapshots.push(sourceSnapshot);
      this.repository.projectionManifests.push(projectionManifest);
      this.repository.evaluationTrials.push(trial);
    });
    return { trial, sourceSnapshot, projectionManifest };
  }

  checkpointTrial(input: {
    trialId: string;
    previousProjectionManifestId: string;
    operation: string;
    evidenceRefs: string[];
  }) {
    const trial = this.activeTrial(input.trialId);
    if (trial.latestProjectionManifestId !== input.previousProjectionManifestId) {
      throw new Error("Evaluation projection checkpoint is stale");
    }
    const chainReasons = this.projectionManifestChainReasons(trial, false);
    if (chainReasons.length > 0) {
      throw new Error(`Evaluation projection checkpoint chain is invalid: ${chainReasons.join("; ")}`);
    }
    if (input.evidenceRefs.length === 0) {
      throw new Error("Controlled projection checkpoints require evidence references");
    }
    const manifest = this.buildManifest({
      trialId: trial.id,
      previousManifestId: input.previousProjectionManifestId,
      operation: required(input.operation, "Checkpoint operation"),
      evidenceRefs: unique(input.evidenceRefs)
    });
    this.repository.transaction(() => {
      trial.latestProjectionManifestId = manifest.id;
      trial.updatedAt = manifest.createdAt;
      this.repository.projectionManifests.push(manifest);
      const intervention: InterventionRecord = {
        id: id("intervention"),
        trialId: trial.id,
        category: "controlled-facade-write",
        actor: "brain-creator",
        note: `Controlled checkpoint: ${manifest.operation}`,
        evidenceRefs: manifest.evidenceRefs,
        invalidatesTrial: false,
        createdAt: manifest.createdAt
      };
      if (this.projectionAuthenticator) {
        intervention.integrityTag = this.projectionAuthenticator.sign(interventionPayload(intervention));
      }
      this.repository.interventionRecords.push(intervention);
    });
    return manifest;
  }

  validateTrial(trialId: string, input: {
    codeRevision: string;
    runtimeVersions: Record<string, string>;
    runtimeBuildIdentity?: string;
  }, invalidate = true) {
    const trial = this.trial(trialId);
    const source = this.repository.requirementSources.find((item) => item.id === trial.requirementSourceId);
    const reasons = [
      ...this.executionScopeReasons(trial),
      ...this.sourceSnapshotReasons(trial),
      ...(!source || source.revision !== trial.sourceRevision || source.contentHash !== trial.sourceHash
        ? ["Requirement source changed during the evaluation trial"] : []),
      ...(input.codeRevision !== trial.codeRevision
        ? ["Code revision changed during the evaluation trial"] : []),
      ...(!sameRecord(normalizedRecord(input.runtimeVersions), trial.runtimeVersions)
        ? ["Runtime versions changed during the evaluation trial"] : []),
      ...(trial.runtimeBuildIdentity && trial.runtimeBuildIdentity !== input.runtimeBuildIdentity
        ? ["Runtime build identity changed during the evaluation trial"] : []),
      ...(trial.executionScope && (!trial.runtimeBuildIdentity || trial.runtimeBuildIdentity === "unknown")
        ? ["Evaluation trial has no known pinned runtime build identity"] : []),
      ...(trial.executionScope && (!input.runtimeBuildIdentity || input.runtimeBuildIdentity === "unknown")
        ? ["Current runtime build identity is unknown"] : []),
      ...this.projectionManifestChainReasons(trial, true)
    ];
    if (reasons.length > 0 && invalidate) {
      this.repository.transaction(() => this.invalidate(trial, reasons));
    }
    return { valid: reasons.length === 0 && trial.status !== "invalidated" && (!invalidate || trial.status === "active"), reasons, trial };
  }

  validateExecutionBinding(input: {
    trialId: string;
    knowledgeProjectId: string;
    systemId: string;
    executableCaseIds?: string[];
    requirementSetIds?: string[];
    runtimeBuildIdentity?: string;
  }) {
    const trial = this.trial(input.trialId);
    const reasons: string[] = this.executionScopeReasons(trial);
    reasons.push(...this.sourceSnapshotReasons(trial));
    reasons.push(...this.projectionManifestChainReasons(trial, true));
    if (!trial.executionScope?.businessScenarioIds.length || !trial.systemId) reasons.push("Execution binding requires a frozen scenario scope and system");
    if (trial.status !== "active") reasons.push(`Evaluation trial is not active: ${trial.status}`);
    if (trial.knowledgeProjectId !== input.knowledgeProjectId) reasons.push("Evaluation trial belongs to another knowledge project");
    if (trial.systemId && trial.systemId !== input.systemId) reasons.push("Evaluation trial belongs to another business system");
    if (!trial.systemId) {
      const project = this.repository.knowledgeProjects.find((item) => item.id === input.knowledgeProjectId);
      if (!project?.systemIds.includes(input.systemId)) reasons.push("Evaluation trial execution system is not bound to the knowledge project");
    }
    const source = this.repository.requirementSources.find((item) => item.id === trial.requirementSourceId);
    if (!source || source.revision !== trial.sourceRevision || source.contentHash !== trial.sourceHash) {
      reasons.push("Requirement source changed during the evaluation trial");
    }
    if (trial.requirementSetId && source?.latestRequirementSetId !== trial.requirementSetId) {
      reasons.push("Requirement source requirement set changed during the evaluation trial");
    }
    if (trial.runtimeBuildIdentity && trial.runtimeBuildIdentity !== input.runtimeBuildIdentity) {
      reasons.push("Runtime build identity changed during the evaluation trial");
    }
    if (trial.executionScope && (!trial.runtimeBuildIdentity || trial.runtimeBuildIdentity === "unknown")) {
      reasons.push("Evaluation trial has no known pinned runtime build identity");
    }
    if (trial.executionScope && (!input.runtimeBuildIdentity || input.runtimeBuildIdentity === "unknown")) {
      reasons.push("Current runtime build identity is unknown");
    }
    if (trial.requirementSetId && input.requirementSetIds?.length &&
        (input.requirementSetIds.length !== 1 || input.requirementSetIds[0] !== trial.requirementSetId)) {
      reasons.push("Requirement suite does not use the trial requirement set");
    }
    const caseIds = unique(input.executableCaseIds ?? []);
    for (const caseId of caseIds) {
      const executableCase = this.repository.executableCases.find((item) => item.id === caseId);
      if (!executableCase || executableCase.knowledgeProjectId !== trial.knowledgeProjectId || executableCase.systemId && executableCase.systemId !== input.systemId) {
        reasons.push(`Executable case ${caseId} is outside the evaluation trial scope`);
        continue;
      }
      if (trial.requirementSetId && executableCase.requirementSetId !== trial.requirementSetId) {
        reasons.push(`Executable case ${caseId} is from another requirement set`);
      }
      const scenarioIds = this.scenarioIdsForCase(caseId);
      const frozenScenarioIds = trial.executionScope?.businessScenarioIds;
      if (frozenScenarioIds && scenarioIds.length !== 1) {
        reasons.push(`Executable case ${caseId} does not map to exactly one business scenario`);
      } else if (frozenScenarioIds && scenarioIds.some((scenarioId) => !frozenScenarioIds.includes(scenarioId))) {
        reasons.push(`Executable case ${caseId} is outside the frozen business scenario scope`);
      }
    }
    const driftReasons = reasons.filter((reason) => /source|requirement set changed|runtime build identity/i.test(reason));
    if (driftReasons.length > 0 && trial.status === "active") {
      this.repository.transaction(() => this.invalidate(trial, driftReasons));
    }
    return {
      valid: reasons.length === 0,
      comparable: Boolean(trial.executionScope),
      reasons,
      trial,
      scenarioIds: caseIds.flatMap((caseId) => this.scenarioIdsForCase(caseId))
    };
  }

  private executionScopeReasons(trial: EvaluationTrial): string[] {
    const scope = trial.executionScope;
    if (!scope) return [];
    const { scopeHash, ...frozen } = scope;
    const reasons: string[] = [];
    if (!scopeHash || scopeHash !== hash(stableStringify(frozen))) reasons.push("Frozen execution scope changed or is legacy");
    const source = this.repository.requirementSources.find((item) => item.id === trial.requirementSourceId);
    const set = this.repository.requirementSets.find((item) => item.id === trial.requirementSetId);
    const project = this.repository.knowledgeProjects.find((item) => item.id === trial.knowledgeProjectId);
    if (!set || set.sourceId !== source?.id || set.knowledgeProjectId !== trial.knowledgeProjectId ||
        source?.knowledgeProjectId !== trial.knowledgeProjectId || source.latestRequirementSetId !== set.id ||
        !trial.systemId || !project?.systemIds.includes(trial.systemId)) return [...reasons, "Frozen source/project/system membership changed"];
    if (scope.baselineHash !== new RequirementGateService(this.repository).baselineFingerprint(set.id)) reasons.push("Frozen requirement baseline or scope version changed");
    if (scope.businessScenarioIds.length > 0) {
      const pinnedSystemSnapshot = scope.systemBrainSnapshotId
        ? this.repository.systemBrainSnapshots.find((item) => item.id === scope.systemBrainSnapshotId)
        : undefined;
      const latestConfirmedSystemSnapshot = trial.systemId
        ? this.latestConfirmedSystemBrainSnapshot(trial.knowledgeProjectId, trial.systemId)
        : undefined;
      if (
        !scope.systemBrainSnapshotId ||
        !scope.systemBrainSnapshotHash ||
        !pinnedSystemSnapshot ||
        pinnedSystemSnapshot.knowledgeProjectId !== trial.knowledgeProjectId ||
        pinnedSystemSnapshot.systemId !== trial.systemId ||
        pinnedSystemSnapshot.status !== "confirmed" ||
        pinnedSystemSnapshot.contentHash !== scope.systemBrainSnapshotHash ||
        latestConfirmedSystemSnapshot?.id !== scope.systemBrainSnapshotId ||
        latestConfirmedSystemSnapshot.contentHash !== scope.systemBrainSnapshotHash
      ) reasons.push("Frozen System Brain snapshot changed or is not pinned");
    }
    reasons.push(...this.scenarioReadinessReasons({
      knowledgeProjectId: trial.knowledgeProjectId,
      systemId: trial.systemId,
      scenarioIds: scope.businessScenarioIds
    }));
    if (scope.approvalScopeRef) {
      try {
        const receipt = new RequirementGateService(this.repository).verifyApprovalReceipt(set.id, scope.approvalScopeRef);
        if (set.status !== "approved" || receipt.assetHash !== scope.approvalScopeHash) reasons.push("Frozen approval changed");
      } catch { reasons.push("Frozen approval is no longer valid"); }
    }
    return reasons;
  }

  private scenarioReadinessReasons(input: {
    knowledgeProjectId: string;
    systemId?: string;
    scenarioIds: string[];
  }) {
    const reasons: string[] = [];
    for (const scenarioId of input.scenarioIds) {
      const scenario = this.repository.businessScenarios.find(
        (item) => item.id === scenarioId && item.knowledgeProjectId === input.knowledgeProjectId
      );
      if (!scenario || scenario.status !== "approved") {
        reasons.push(`Scenario ${scenarioId} is missing or not approved`);
        continue;
      }
      if (!input.systemId) {
        reasons.push(`Scenario ${scenarioId} has no bound execution system`);
        continue;
      }
      const contracts = this.repository.scenarioAssuranceContracts.filter(
        (item) => item.scenarioId === scenarioId && item.systemId === input.systemId
      );
      if (contracts.length !== 1) {
        reasons.push(`Scenario ${scenarioId} does not have one unique assurance contract for the selected system`);
        continue;
      }
      const contract = contracts[0]!;
      if (
        contract.systemId !== input.systemId ||
        contract.systemBinding !== "unique" ||
        contract.verdict !== "pass" ||
        contract.oracleStrength !== "strong" ||
        contract.requirementRefs.length === 0 ||
        contract.unsupportedInferences.length > 0 ||
        contract.testDataReadiness === "blocked"
      ) {
        reasons.push(`Scenario ${scenarioId} lacks a unique system binding, strong requirement-backed Oracle, or executable data plan`);
        continue;
      }
      const snapshot = contract.systemBrainSnapshotId
        ? this.repository.systemBrainSnapshots.find((item) => item.id === contract.systemBrainSnapshotId)
        : undefined;
      const latestConfirmedSnapshot = this.latestConfirmedSystemBrainSnapshot(input.knowledgeProjectId, input.systemId);
      if (
        !snapshot ||
        snapshot.knowledgeProjectId !== input.knowledgeProjectId ||
        snapshot.systemId !== input.systemId ||
        snapshot.status !== "confirmed" ||
        !snapshot.confirmedAt ||
        !snapshot.confirmedBy?.trim() ||
        latestConfirmedSnapshot?.id !== snapshot.id
      ) {
        reasons.push(`Scenario ${scenarioId} is not bound to the current confirmed System Brain snapshot`);
      }
    }
    return reasons;
  }

  private latestConfirmedSystemBrainSnapshot(knowledgeProjectId: string, systemId: string) {
    return this.repository.systemBrainSnapshots
      .filter((item) =>
        item.knowledgeProjectId === knowledgeProjectId &&
        item.systemId === systemId &&
        item.status === "confirmed"
      )
      .sort((left, right) => right.revision - left.revision || right.createdAt.localeCompare(left.createdAt))[0];
  }

  recordIntervention(input: {
    trialId: string;
    category: EvaluationInterventionCategory;
    actor: string;
    note: string;
    evidenceRefs: string[];
    businessScenarioIds?: string[];
    authenticationPhase?: InterventionRecord["authenticationPhase"];
  }): InterventionRecord {
    const trial = this.trial(input.trialId);
    const businessScenarioIds = unique(input.businessScenarioIds ?? []);
    const frozenScenarioIds = trial.executionScope?.businessScenarioIds ?? [];
    if (businessScenarioIds.some((scenarioId) => !frozenScenarioIds.includes(scenarioId))) {
      throw new Error("Intervention scenario is outside the frozen Trial scope");
    }
    const evidenceRefs = unique(input.evidenceRefs.map((reference) => required(reference, "Intervention evidence reference")));
    if (evidenceRefs.length === 0) throw new Error("Intervention records require evidence references");
    if (input.authenticationPhase && input.category !== "user-authentication") {
      throw new Error("Authentication phase is only valid for user-authentication interventions");
    }
    const invalidatesTrial = ![
      "controlled-facade-write",
      "user-clarification",
      "user-authentication",
      "manual-evidence-review",
      "manual-recovery"
    ].includes(input.category);
    const record: InterventionRecord = {
      id: id("intervention"),
      trialId: trial.id,
      category: input.category,
      actor: required(input.actor, "Intervention actor"),
      note: required(input.note, "Intervention note"),
      evidenceRefs,
      ...(businessScenarioIds.length > 0 ? { businessScenarioIds } : {}),
      ...(input.authenticationPhase ? { authenticationPhase: input.authenticationPhase } : {}),
      invalidatesTrial,
      createdAt: new Date().toISOString()
    };
    if (this.projectionAuthenticator) {
      record.integrityTag = this.projectionAuthenticator.sign(interventionPayload(record));
    }
    this.repository.transaction(() => {
      this.repository.interventionRecords.push(record);
      if (invalidatesTrial) this.invalidate(trial, [`${input.category}: ${record.note}`]);
    });
    return record;
  }

  completeInterventionCapture(input: {
    trialId: string;
    scenarioIds: string[];
    actor: string;
    evidenceRefs: string[];
  }) {
    const trial = this.trial(input.trialId);
    const scope = trial.executionScope;
    if (trial.status !== "completed") throw new Error("Intervention capture can only be completed after the Trial is completed");
    if (!scope?.scopeHash || !scope.businessScenarioIds.length) {
      throw new Error("Intervention capture requires a frozen business scenario scope");
    }
    const scenarioIds = unique(input.scenarioIds).sort();
    if (stableStringify(scenarioIds) !== stableStringify([...scope.businessScenarioIds].sort())) {
      throw new Error("Intervention capture must cover every frozen Trial scenario");
    }
    const evidenceRefs = unique(input.evidenceRefs.map((reference) => required(reference, "Intervention capture evidence reference")));
    if (evidenceRefs.length === 0) throw new Error("Intervention capture requires evidence references");
    const missingInterventionSourceRefs = this.unrecordedInterventionSourceRefs(trial.id);
    if (missingInterventionSourceRefs.length > 0) {
      throw new Error(`Completed Trial intervention sources are missing records: ${missingInterventionSourceRefs.join(", ")}`);
    }
    const capture: NonNullable<EvaluationTrial["interventionCapture"]> = {
      scenarioIds,
      interventionIds: this.repository.interventionRecords
        .filter((record) => record.trialId === trial.id)
        .map((record) => record.id),
      scopeHash: scope.scopeHash,
      actor: required(input.actor, "Intervention capture actor"),
      evidenceRefs,
      completedAt: new Date().toISOString()
    };
    if (this.projectionAuthenticator) {
      capture.integrityTag = this.projectionAuthenticator.sign(interventionCapturePayload(capture));
    }
    this.repository.transaction(() => {
      trial.interventionCapture = capture;
      trial.updatedAt = capture.completedAt;
    });
    return capture;
  }

  reviewInterventionIntegrity(trialId: string) {
    const trial = this.trial(trialId);
    const records = this.repository.interventionRecords.filter((record) => record.trialId === trial.id);
    const capture = trial.interventionCapture;
    const interventionValidById = new Map(records.map((record) => [
      record.id,
      Boolean(record.integrityTag && this.projectionAuthenticator?.verify(
        interventionPayload(record), record.integrityTag
      ))
    ]));
    const capturedIds = new Set(capture?.interventionIds ?? []);
    const currentIds = new Set(records.map((record) => record.id));
    const unrecordedInterventionSourceRefs = this.unrecordedInterventionSourceRefs(trial.id);
    const interventionSetMatchesCapture = Boolean(capture) &&
      capturedIds.size === currentIds.size &&
      [...capturedIds].every((recordId) => currentIds.has(recordId));
    const captureIntegrityValid = Boolean(capture?.integrityTag && this.projectionAuthenticator?.verify(
      interventionCapturePayload(capture), capture.integrityTag
    ));
    return {
      captureIntegrityValid,
      interventionSetMatchesCapture,
      interventionValidById,
      unrecordedInterventionSourceRefs,
      interventionSourcesComplete: unrecordedInterventionSourceRefs.length === 0
    };
  }

  private unrecordedInterventionSourceRefs(trialId: string) {
    const records = this.repository.interventionRecords.filter((record) => record.trialId === trialId);
    const missingAuthCheckpointRefs = this.repository.authCheckpoints
      .filter((checkpoint) => checkpoint.evaluationTrialId === trialId && checkpoint.status === "completed")
      .filter((checkpoint) => !records.some((record) =>
        record.category === "user-authentication" &&
        record.evidenceRefs.includes(`auth-checkpoint:${checkpoint.id}`)
      ))
      .map((checkpoint) => `auth-checkpoint:${checkpoint.id}`);
    const trialSuiteRunIds = new Set(this.repository.requirementSuiteRuns
      .filter((run) => run.evaluationTrialId === trialId)
      .map((run) => run.id));
    const missingManualRecoveryRefs = this.repository.runLedgerEntries
      .filter((entry) => entry.evaluationTrialId === trialId ||
        Boolean(entry.requirementSuiteRunId && trialSuiteRunIds.has(entry.requirementSuiteRunId)))
      .filter((entry) => entry.event === "action-reconciled" && entry.recoveryMode === "manual")
      .filter((entry) => !records.some((record) =>
        record.category === "manual-recovery" &&
        record.evidenceRefs.includes(`run-ledger:${entry.id}`)
      ))
      .map((entry) => `run-ledger:${entry.id}`);
    return [...missingAuthCheckpointRefs, ...missingManualRecoveryRefs].sort();
  }

  completeTrial(
    trialId: string,
    codeRevision: string,
    runtimeVersions: Record<string, string>,
    runtimeBuildIdentity?: string
  ) {
    const validation = this.validateTrial(trialId, { codeRevision, runtimeVersions, runtimeBuildIdentity });
    if (!validation.valid) throw new Error(`Evaluation trial is not valid: ${validation.reasons.join("; ")}`);
    const now = new Date().toISOString();
    this.repository.transaction(() => {
      validation.trial.status = "completed";
      validation.trial.completedAt = now;
      validation.trial.updatedAt = now;
    });
    return validation.trial;
  }

  list(input: { knowledgeProjectId?: string; comparisonGroupId?: string } = {}) {
    return this.repository.evaluationTrials.filter((item) =>
      (!input.knowledgeProjectId || item.knowledgeProjectId === input.knowledgeProjectId) &&
      (!input.comparisonGroupId || item.comparisonGroupId === input.comparisonGroupId)
    );
  }

  private buildManifest(input: {
    trialId: string;
    knowledgeProjectId?: string;
    systemId?: string;
    previousManifestId?: string;
    operation: string;
    evidenceRefs: string[];
  }): ProjectionManifest {
    const trial = this.repository.evaluationTrials.find((item) => item.id === input.trialId);
    const knowledgeProjectId = trial?.knowledgeProjectId ?? input.knowledgeProjectId;
    if (!knowledgeProjectId) throw new Error("Evaluation projection requires a knowledge project");
    const projection = this.projection(knowledgeProjectId, trial?.systemId ?? input.systemId);
    const manifest: ProjectionManifest = {
      id: id("projectionManifest"),
      trialId: input.trialId,
      previousManifestId: input.previousManifestId,
      operation: input.operation,
      projectionHash: projection.hash,
      assetCounts: projection.counts,
      evidenceRefs: unique(input.evidenceRefs),
      status: "current",
      createdAt: new Date().toISOString()
    };
    if (this.projectionAuthenticator) {
      manifest.integrityTag = this.projectionAuthenticator.sign(projectionManifestPayload(manifest));
    }
    return manifest;
  }

  private projection(knowledgeProjectId: string, systemId?: string) {
    const requirementSetIds = new Set(this.repository.requirementSets
      .filter((item) => item.knowledgeProjectId === knowledgeProjectId)
      .map((item) => item.id));
    const scenarioIds = new Set(this.repository.businessScenarios
      .filter((item) => item.knowledgeProjectId === knowledgeProjectId)
      .map((item) => item.id));
    const assets: Record<string, unknown[]> = {
      requirementSources: this.repository.requirementSources.filter((item) => item.knowledgeProjectId === knowledgeProjectId),
      requirementSets: this.repository.requirementSets.filter((item) => requirementSetIds.has(item.id)),
      attachmentAnalyses: this.repository.attachmentAnalyses.filter((item) => requirementSetIds.has(item.requirementSetId)),
      businessObjectModels: this.repository.businessObjectModels.filter((item) => requirementSetIds.has(item.requirementSetId)),
      workflowModels: this.repository.workflowModels.filter((item) => requirementSetIds.has(item.requirementSetId)),
      stateMachineModels: this.repository.stateMachineModels.filter((item) => requirementSetIds.has(item.requirementSetId)),
      decisionTableModels: this.repository.decisionTableModels.filter((item) => requirementSetIds.has(item.requirementSetId)),
      knowledgeNodes: this.repository.knowledgeNodes.filter((item) => item.knowledgeProjectId === knowledgeProjectId),
      knowledgeEdges: this.repository.knowledgeEdges.filter((item) => item.knowledgeProjectId === knowledgeProjectId),
      testIntents: this.repository.testIntents.filter((item) => item.knowledgeProjectId === knowledgeProjectId),
      testDataProfiles: this.repository.testDataProfiles.filter((item) => item.knowledgeProjectId === knowledgeProjectId),
      executableCases: this.repository.executableCases.filter((item) => item.knowledgeProjectId === knowledgeProjectId && (!systemId || item.systemId === systemId)),
      businessScenarios: this.repository.businessScenarios.filter((item) => scenarioIds.has(item.id)),
      scenarioAssuranceContracts: this.repository.scenarioAssuranceContracts.filter((item) => scenarioIds.has(item.scenarioId)),
      semanticBindings: this.repository.semanticBindings.filter((item) => requirementSetIds.has(item.requirementSetId) && (!systemId || item.systemId === systemId))
    };
    const normalized = Object.fromEntries(Object.entries(assets).map(([key, values]) => [
      key,
      [...values].sort((left, right) => String((left as { id?: string }).id ?? "").localeCompare(String((right as { id?: string }).id ?? "")))
    ]));
    return {
      hash: hash(stableStringify(normalized)),
      counts: Object.fromEntries(Object.entries(assets).map(([key, values]) => [key, values.length]))
    };
  }

  private projectionManifestChainReasons(trial: EvaluationTrial, compareCurrentProjection: boolean) {
    const reasons: string[] = [];
    const visited = new Set<string>();
    let manifest = this.repository.projectionManifests.find(
      (item) => item.id === trial.latestProjectionManifestId
    );
    if (!manifest) return ["Evaluation projection manifest is missing"];
    if (manifest.trialId !== trial.id) reasons.push("Evaluation projection manifest belongs to another Trial");
    if (manifest.status !== "current") reasons.push("Evaluation projection manifest is not current");
    if (compareCurrentProjection && manifest.projectionHash !== this.projection(trial.knowledgeProjectId, trial.systemId).hash) {
      reasons.push("Repository projection changed outside a controlled checkpoint");
    }
    while (manifest) {
      if (visited.has(manifest.id)) {
        reasons.push("Evaluation projection manifest chain contains a cycle");
        break;
      }
      visited.add(manifest.id);
      if (manifest.trialId !== trial.id) {
        reasons.push("Evaluation projection manifest chain crosses Trial ownership");
        break;
      }
      if (this.projectionAuthenticator && (
        !manifest.integrityTag ||
        !this.projectionAuthenticator.verify(projectionManifestPayload(manifest), manifest.integrityTag)
      )) {
        reasons.push("Evaluation projection manifest integrity authentication failed");
      }
      const children = this.repository.projectionManifests.filter(
        (item) => item.previousManifestId === manifest!.id
      );
      if (manifest.id !== trial.latestProjectionManifestId && children.length !== 1) {
        reasons.push("Evaluation projection manifest chain is branched or incomplete");
        break;
      }
      if (manifest.id === trial.latestProjectionManifestId && children.length > 0) {
        reasons.push("Evaluation projection manifest is not the end of its chain");
        break;
      }
      if (!manifest.evidenceRefs.length || manifest.evidenceRefs.some((reference) => !reference.trim())) {
        reasons.push("Evaluation projection manifest has no valid evidence references");
      }
      if (!manifest.previousManifestId) {
        if (manifest.operation !== "start-trial") reasons.push("Evaluation projection manifest chain has no Trial root");
        if (!manifest.evidenceRefs.includes(`requirement-source:${trial.requirementSourceId}`) ||
            !manifest.evidenceRefs.includes(`source-snapshot:${trial.sourceSnapshotId}`)) {
          reasons.push("Evaluation projection manifest root does not bind the frozen requirement source snapshot");
        }
        break;
      }
      const previous = this.repository.projectionManifests.find(
        (item) => item.id === manifest!.previousManifestId
      );
      if (!previous) {
        reasons.push("Evaluation projection manifest chain has a missing parent");
        break;
      }
      manifest = previous;
    }
    return [...new Set(reasons)];
  }

  private activeTrial(trialId: string) {
    const trial = this.trial(trialId);
    if (trial.status !== "active") throw new Error(`Evaluation trial is not active: ${trial.status}`);
    return trial;
  }

  private sourceSnapshotReasons(trial: EvaluationTrial) {
    const snapshot = this.repository.sourceSnapshots.find((item) => item.id === trial.sourceSnapshotId);
    const source = this.repository.requirementSources.find((item) => item.id === trial.requirementSourceId);
    if (!snapshot || !source) {
      return ["Frozen requirement source snapshot is missing, changed, or outside the Trial"];
    }
    const reasons: string[] = [];
    if (this.projectionAuthenticator && (
      !snapshot.integrityTag ||
      !this.projectionAuthenticator.verify(sourceSnapshotPayload(snapshot), snapshot.integrityTag)
    )) {
      reasons.push("Frozen requirement source snapshot integrity authentication failed");
    }
    if (snapshot.trialId !== trial.id || snapshot.sourceId !== trial.requirementSourceId ||
        snapshot.knowledgeProjectId !== trial.knowledgeProjectId || snapshot.requirementSetId !== trial.requirementSetId ||
        snapshot.sourceRevision !== trial.sourceRevision || snapshot.contentHash !== trial.sourceHash ||
        source.revision !== snapshot.sourceRevision || source.contentHash !== snapshot.contentHash ||
        source.latestRequirementSetId !== snapshot.requirementSetId ||
        snapshot.sourceLocatorHash !== hash(source.source) ||
        snapshot.semanticInputHash !== requirementSemanticInputHash(source)) {
      reasons.push("Frozen requirement source snapshot is missing, changed, or outside the Trial");
    }
    return reasons;
  }

  private trial(trialId: string) {
    const trial = this.repository.evaluationTrials.find((item) => item.id === trialId);
    if (!trial) throw new Error("Evaluation trial not found");
    return trial;
  }

  private scenarioIdsForCase(executableCaseId: string) {
    const executableCase = this.repository.executableCases.find((item) => item.id === executableCaseId);
    if (!executableCase) return [];
    return this.repository.businessScenarios
      .filter((scenario) => scenario.knowledgeProjectId === executableCase.knowledgeProjectId &&
        scenario.requirementSetId === executableCase.requirementSetId &&
        (scenario.testIntentIds ?? []).includes(executableCase.testIntentId))
      .map((scenario) => scenario.id);
  }

  private invalidate(trial: EvaluationTrial, reasons: string[]) {
    trial.status = "invalidated";
    trial.invalidationReasons = unique([...trial.invalidationReasons, ...reasons]);
    trial.updatedAt = new Date().toISOString();
    const manifest = this.repository.projectionManifests.find((item) => item.id === trial.latestProjectionManifestId);
    if (manifest) manifest.status = "drifted";
  }
}

function requirementSemanticInputHash(source: RequirementSource) {
  return hash(stableStringify({
    sourceType: source.sourceType,
    title: source.title,
    content: source.content,
    blocks: source.blocks,
    attachments: source.attachments.map((attachment) => ({
      id: attachment.id,
      blockId: attachment.blockId,
      fileToken: attachment.fileToken,
      name: attachment.name,
      mimeType: attachment.mimeType,
      type: attachment.type,
      url: attachment.url,
      contentHash: attachment.contentHash,
      pageNumber: attachment.pageNumber
    })),
    warnings: source.warnings
  }));
}

function normalizedRecord(value: Record<string, string>) {
  return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)));
}

function sameRecord(left: Record<string, string>, right: Record<string, string>) {
  return stableStringify(left) === stableStringify(right);
}

function projectionManifestPayload(manifest: ProjectionManifest) {
  return stableStringify({
    id: manifest.id,
    trialId: manifest.trialId,
    previousManifestId: manifest.previousManifestId,
    operation: manifest.operation,
    projectionHash: manifest.projectionHash,
    assetCounts: manifest.assetCounts,
    evidenceRefs: manifest.evidenceRefs,
    createdAt: manifest.createdAt
  });
}

function interventionPayload(intervention: InterventionRecord) {
  return stableStringify({
    id: intervention.id,
    trialId: intervention.trialId,
    category: intervention.category,
    actor: intervention.actor,
    note: intervention.note,
    evidenceRefs: intervention.evidenceRefs,
    businessScenarioIds: intervention.businessScenarioIds,
    ...(intervention.authenticationPhase
      ? { authenticationPhase: intervention.authenticationPhase }
      : {}),
    invalidatesTrial: intervention.invalidatesTrial,
    createdAt: intervention.createdAt
  });
}

function interventionCapturePayload(capture: NonNullable<EvaluationTrial["interventionCapture"]>) {
  return stableStringify({
    scenarioIds: capture.scenarioIds,
    interventionIds: capture.interventionIds,
    scopeHash: capture.scopeHash,
    actor: capture.actor,
    evidenceRefs: capture.evidenceRefs,
    completedAt: capture.completedAt
  });
}

function sourceSnapshotPayload(snapshot: SourceSnapshot) {
  return stableStringify({
    id: snapshot.id,
    trialId: snapshot.trialId,
    sourceId: snapshot.sourceId,
    knowledgeProjectId: snapshot.knowledgeProjectId,
    requirementSetId: snapshot.requirementSetId,
    sourceType: snapshot.sourceType,
    sourceRevision: snapshot.sourceRevision,
    contentHash: snapshot.contentHash,
    semanticInputHash: snapshot.semanticInputHash,
    sourceLocatorHash: snapshot.sourceLocatorHash,
    blockCount: snapshot.blockCount,
    attachmentCount: snapshot.attachmentCount,
    warningCount: snapshot.warningCount,
    createdAt: snapshot.createdAt
  });
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function hash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function samePath(left: string, right: string) {
  return resolve(left).toLowerCase() === resolve(right).toLowerCase();
}

function required(value: string, label: string) {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label} is required`);
  return normalized;
}

function unique(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}
