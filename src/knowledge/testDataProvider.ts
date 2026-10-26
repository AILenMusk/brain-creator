import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { isAbsolute, join, relative, resolve } from "node:path";
import type { InMemoryBrainCreatorRepository } from "../domain/repository.js";
import type {
  ExecutableCase,
  ExecutableCaseDataOperation,
  Gap,
  SystemProfile,
  TestDataLease,
  TestDataTask
} from "../domain/types.js";
import type { TestDataBrainService } from "../brain/testdata.js";
import { id } from "../shared/id.js";
import type { KnowledgeService } from "./service.js";
import { executableCaseCompileStatus } from "./caseCompiler.js";
import { findActiveTestDataLease } from "./dataLeaseResolver.js";
import { validateExecutionArtifacts } from "../execution/artifactValidation.js";

type PrepareInput = {
  knowledgeProjectId: string;
  systemId: string;
  executableCaseId: string;
  requirementSuiteRunId?: string;
  confirm: boolean;
  allowCreate?: boolean;
  automatic?: boolean;
  phase?: "prepare" | "cleanup";
};

type SubmitInput = {
  taskId: string;
  status: "succeeded" | "failed";
  decision?: "reuse" | "create";
  reference?: string;
  value?: string;
  sourceRefs: string[];
  error?: string;
};

type PrepareOperation = {
  profileId: string;
  field: string;
  entityReference?: string;
  reference?: string;
  lookupQuery?: string;
  cleanup: TestDataTask["cleanup"];
  allowedDecisions: Array<"reuse" | "create">;
  constraints: string[];
  sourceRefs: string[];
};

export type TestDataNoEffectVerification = {
  status: "absent" | "present" | "unavailable";
  provider: string;
  query: string;
  evidenceRefs: string[];
  evidenceArtifacts: Array<{ path: string; sha256: string }>;
  checkedAt: string;
  reason?: string;
};

type TestDataNoEffectObservation = {
  schemaVersion: 1;
  type: "testdata-no-effect-observation";
  systemId: string;
  query: string;
  result: "absent" | "present";
  matchCount: number;
  reference?: string;
  provider: string;
  checkedAt: string;
};

export type TestDataNoEffectVerifier = (input: {
  task: TestDataTask;
  system: SystemProfile;
  query: string;
}) => Promise<TestDataNoEffectVerification>;

export type TestDataPrepareResult = {
  status: "preview" | "needs-agent-execution" | "reconciliation-required" | "ready";
  operations: PrepareOperation[];
  task?: TestDataTask;
  cleanupNotice?: { message: string; sha256: string };
  nextAction?: string;
  autoResolvedProfileIds?: string[];
};

export type TestDataSubmitResult = {
  task: TestDataTask;
  executableCase: ExecutableCase;
  lease?: TestDataLease;
  gap?: Gap;
};

export class TestDataProviderService {
  constructor(
    private readonly repository: InMemoryBrainCreatorRepository,
    private readonly knowledgeService: KnowledgeService,
    private readonly runtimeDir: string,
    private readonly testDataBrain?: TestDataBrainService,
    private readonly noEffectVerifier?: TestDataNoEffectVerifier
  ) {}

  async prepare(input: PrepareInput): Promise<TestDataPrepareResult> {
    const executableCase = this.getCase(input);
    if (input.confirm) {
      this.releaseReusableLeasesAfterExecution(executableCase, input.requirementSuiteRunId);
      this.recordCrossCaseLeaseConsumptions(executableCase, input.requirementSuiteRunId);
    }
    const cleanupLease = this.findCleanupLease(executableCase, input.requirementSuiteRunId);
    if (cleanupLease) {
      const consumerLease = this.consumerLeaseFor(
        executableCase,
        cleanupLease,
        input.requirementSuiteRunId
      );
      const producerCase = this.repository.executableCases.find(
        (candidate) => candidate.id === cleanupLease.executableCaseId
      );
      const operation: PrepareOperation = {
        profileId: cleanupLease.profileId,
        field: this.findField(producerCase ?? executableCase, cleanupLease.profileId),
        ...(cleanupLease.entityReference
          ? { entityReference: cleanupLease.entityReference }
          : {}),
        cleanup: cleanupLease.cleanup,
        allowedDecisions: [],
        constraints: [],
        sourceRefs: unique([
          ...cleanupLease.sourceRefs,
          ...(consumerLease?.sourceRefs ?? [])
        ])
      };
      if (!input.confirm) {
        return { status: "preview", operations: [operation] };
      }
      const task = await this.createOrReuseTask({
        executableCase,
        requirementSuiteRunId: input.requirementSuiteRunId,
        operation,
        action: "cleanup",
        allowCreate: false,
        leaseId: cleanupLease.id
      });
      if (!this.canDispatchAgain(task)) {
        return {
          status: "reconciliation-required",
          operations: [operation],
          task,
          cleanupNotice: this.cleanupNotice(task.id),
          nextAction: "Read the target system without writing. If cleanup did not take effect, send the included advance notice before retrying the cleanup; do not repeat the write based only on a missing response."
        };
      }
      return {
        status: "needs-agent-execution",
        operations: [operation],
        task,
        cleanupNotice: this.cleanupNotice(task.id),
        nextAction: "Send the included cleanup notice to the user, then call confirm-cleanup-notice with its SHA-256 before marking the task sent or performing cleanup. If the user asks to retain the data, stop and keep the run blocked."
      };
    }
    if (input.phase === "cleanup") {
      return { status: "ready", operations: [] };
    }

    if (
      input.automatic &&
      input.confirm &&
      executableCase.dataPlan?.requiresConfirmation &&
      !executableCase.dataPlan.confirmedAt
    ) {
      throw new Error("Test data plan must be confirmed before automatic resolution");
    }
    const autoResolvedProfileIds = input.automatic && input.confirm
      ? this.resolveDeterministicOperations(executableCase)
      : [];
    const operations = this.unresolvedOperations(executableCase, input.requirementSuiteRunId).map((operation) =>
      this.prepareOperation(operation, Boolean(input.allowCreate))
    );
    if (operations.length === 0) {
      return {
        status: "ready",
        operations: [],
        ...(autoResolvedProfileIds.length > 0
          ? { autoResolvedProfileIds }
          : {})
      };
    }
    if (!input.confirm) {
      return { status: "preview", operations };
    }
    if (
      input.allowCreate &&
      operations.some((operation) => operation.cleanup === "none")
    ) {
      throw new Error(
        "Creating test data requires an explicit cleanup policy before task dispatch"
      );
    }

    const next = this.nextOperation(executableCase, operations);
    const task = await this.createOrReuseTask({
      executableCase,
      requirementSuiteRunId: input.requirementSuiteRunId,
      operation: next,
      action: "lookup-or-create",
      allowCreate: Boolean(input.allowCreate)
    });
    if (!this.canDispatchAgain(task)) {
      return {
        status: "reconciliation-required",
        operations,
        task,
        ...(autoResolvedProfileIds.length > 0
          ? { autoResolvedProfileIds }
          : {}),
        nextAction: "Read the target system without writing. Reuse and submit an existing matching entity if the operation took effect; only retry after evidence proves it did not."
      };
    }
    return {
      status: "needs-agent-execution",
      operations,
      task,
      ...(autoResolvedProfileIds.length > 0
        ? { autoResolvedProfileIds }
        : {})
    };
  }

  async submit(input: SubmitInput): Promise<TestDataSubmitResult> {
    const task = this.repository.testDataTasks.find((item) => item.id === input.taskId);
    if (!task) throw new Error("Test data task not found");
    const executableCase = this.repository.executableCases.find(
      (item) => item.id === task.executableCaseId
    );
    if (!executableCase) throw new Error("Executable case not found");
    if (task.status === "submitted") {
      return {
        task,
        executableCase,
        lease: task.leaseId
          ? this.repository.testDataLeases.find((item) => item.id === task.leaseId)
          : undefined
      };
    }
    if (task.status !== "pending") {
      throw new Error(`Test data task is ${task.status}`);
    }

    if (input.status === "succeeded" &&
        task.operationPhase !== "sent" &&
        task.operationPhase !== "reconciled-applied") {
      throw new Error("Test data task must be marked sent before submitting a successful external operation");
    }
    if (input.status === "failed" && task.operationPhase !== "reconciled-not-applied") {
      throw new Error("Failed test data tasks require read-only evidence that no external write took effect");
    }

    const sourceRefs = cleanSourceRefs(input.sourceRefs);
    if (input.status === "failed") {
      const reason = input.error?.trim() || "Host agent could not complete the test data task";
      task.status = "failed";
      task.error = reason;
      task.outputSourceRefs = unique([...(task.reconciliationSourceRefs ?? []), ...sourceRefs]);
      task.updatedAt = timestamp();
      if (task.action === "cleanup" && task.leaseId) {
        const lease = this.getLease(task.leaseId);
        lease.status = "cleanup-failed";
        lease.updatedAt = task.updatedAt;
        const gap = this.createGap(
          executableCase,
          task,
          `Test data cleanup failed: ${reason}`,
          "test-data-cleanup"
        );
        this.repository.persist();
        return { task, executableCase, lease, gap };
      }
      executableCase.status = "blocked";
      executableCase.updatedAt = task.updatedAt;
      const gap = this.createGap(
        executableCase,
        task,
        `Test data preparation failed: ${reason}`,
        "test-data-provider"
      );
      this.repository.persist();
      return { task, executableCase, gap };
    }

    if (sourceRefs.length === 0) {
      throw new Error("Successful test data task requires source evidence");
    }
    if (task.action === "cleanup") {
      if (!task.leaseId) throw new Error("Cleanup task has no data lease");
      const lease = this.getLease(task.leaseId);
      const verification = task.reconciliationVerification;
      if (verification?.status !== "absent" || verification.query !== lease.reference || verification.artifactHashes.length === 0) {
        throw new Error("Successful cleanup requires target-backed evidence that the exact leased entity is absent");
      }
      const cleanupSourceRefs = unique([...sourceRefs, ...verification.evidenceRefs]);
      const now = timestamp();
      task.operationPhase = "reconciled-applied";
      lease.status = "released";
      lease.releasedAt = now;
      lease.updatedAt = now;
      lease.sourceRefs = unique([...lease.sourceRefs, ...cleanupSourceRefs]);
      this.completeTask(task, cleanupSourceRefs, now);
      this.testDataBrain?.releaseExternal({
        knowledgeProjectId: task.knowledgeProjectId,
        systemId: task.systemId,
        reference: lease.reference,
        sourceRefs: cleanupSourceRefs
      });
      this.resolveCleanupGaps(lease.id, now);
      this.repository.persist();
      return { task, executableCase, lease };
    }

    if (input.decision !== "reuse" && input.decision !== "create") {
      throw new Error("Data preparation result requires reuse or create decision");
    }
    if (!input.reference?.trim()) {
      throw new Error(`${input.decision} result requires a data reference`);
    }
    if (input.decision === "create" && !task.allowCreate) {
      throw new Error("Creating test data is not allowed for this task");
    }
    if (input.decision === "create" && task.cleanup === "none") {
      throw new Error("Created test data requires an explicit cleanup policy");
    }

    this.assertDependencyLeases(executableCase, task);
    if (!this.testDataBrain) {
      throw new Error("Successful test data resolution requires a target-backed Testdata provider");
    }
    const verification = await this.testDataBrain.lookupVerified({
      knowledgeProjectId: task.knowledgeProjectId,
      systemId: task.systemId,
      entityType: entityTypeFromReference(input.reference.trim()) ?? task.field,
      reference: input.reference.trim(),
      ...(task.entityReference ? { entityReference: task.entityReference } : {}),
      ...(input.value?.trim() ? { expected: { [task.field]: input.value.trim() } } : {}),
      sourceRefs: []
    });
    const verifiedSourceRefs = cleanSourceRefs(verification.sourceRefs);
    if (!verification.provider?.trim() || verifiedSourceRefs.length === 0) {
      throw new Error("Target test data verification is missing its provider or evidence references");
    }
    const resultSourceRefs = unique([...sourceRefs, ...verifiedSourceRefs]);

    const resolved = this.knowledgeService.resolveExecutableCaseTestData({
      executableCaseId: executableCase.id,
      resolutions: [{
        profileId: task.profileId,
        decision: input.decision,
        reference: input.reference.trim(),
        value: input.value?.trim() || undefined
      }]
    });
    const now = timestamp();
    task.operationPhase = "reconciled-applied";
    this.resolveProviderGaps(task, now);
    this.refreshCaseStatus(resolved.executableCase, now);
    this.assertDependencyLeases(resolved.executableCase, task);
    const operation = resolved.executableCase.dataPlan?.operations.find(
      (candidate) => candidate.profileId === task.profileId
    );
    const reusedFromLease = input.decision === "reuse" && operation
      ? findActiveTestDataLease(
          this.repository,
          resolved.executableCase,
          task.systemId,
          { ...operation, reference: input.reference.trim() },
          task.requirementSuiteRunId
        )
      : undefined;
    const lease = this.createOrReuseLease({
      task,
      decision: input.decision,
      reference: input.reference.trim(),
      value: input.value?.trim() || undefined,
      sourceRefs: resultSourceRefs,
      now,
      ...(reusedFromLease ? { reusedFromLeaseId: reusedFromLease.id } : {})
    });
    this.linkDataDependencies(resolved.executableCase, task, lease, resultSourceRefs);
    task.leaseId = lease.id;
    this.completeTask(task, resultSourceRefs, now);
    this.repository.persist();
    return { task, executableCase: resolved.executableCase, lease };
  }

  markSent(taskId: string) {
    const task = this.getTask(taskId);
    if (task.status !== "pending") throw new Error(`Test data task is ${task.status}`);
    if (task.action === "cleanup" && (!task.cleanupNoticeAcknowledgedAt || !task.cleanupNoticeSha256)) {
      throw new Error("Cleanup advance notice must be acknowledged before marking the task sent");
    }
    if (task.operationPhase === "sent") {
      throw new Error("Test data task already has a sent operation; reconcile it before another attempt");
    }
    if (task.operationPhase !== "prepared" && task.operationPhase !== "reconciled-not-applied") {
      throw new Error("Test data task requires read-only reconciliation before a write can be dispatched");
    }
    const now = timestamp();
    task.operationPhase = "sent";
    task.lastSentAt = now;
    task.updatedAt = now;
    this.repository.persist();
    return task;
  }

  cleanupNotice(taskId: string) {
    const task = this.getTask(taskId);
    if (task.action !== "cleanup" || !task.leaseId || !task.cleanupNoticeMessage || !task.cleanupNoticeSha256) {
      throw new Error("Cleanup notice requires a pending cleanup task with a leased entity");
    }
    const digest = createHash("sha256").update(task.cleanupNoticeMessage).digest("hex");
    if (digest !== task.cleanupNoticeSha256) {
      throw new Error("Cleanup notice message no longer matches its stored digest");
    }
    return { message: task.cleanupNoticeMessage, sha256: digest };
  }

  acknowledgeCleanupNotice(taskId: string, sha256: string) {
    const task = this.getTask(taskId);
    if (task.status !== "pending" || task.action !== "cleanup") {
      throw new Error("Only a pending cleanup task can acknowledge an advance notice");
    }
    if (task.operationPhase !== "prepared" && task.operationPhase !== "reconciled-not-applied") {
      throw new Error("Cleanup notice must be acknowledged before a cleanup write is sent");
    }
    const expected = this.cleanupNotice(taskId);
    if (!/^[a-f0-9]{64}$/i.test(sha256) || expected.sha256 !== sha256) {
      throw new Error("Cleanup notice digest does not match the message returned for this task");
    }
    const now = timestamp();
    task.cleanupNoticeAcknowledgedAt = now;
    task.cleanupNoticeSha256 = sha256;
    task.updatedAt = now;
    this.repository.persist();
    return task;
  }

  async reconcileNotApplied(taskId: string, sourceRefs: string[]) {
    const task = this.getTask(taskId);
    if (task.status !== "pending") throw new Error(`Test data task is ${task.status}`);
    if (task.operationPhase !== "sent" && task.operationPhase !== undefined) {
      throw new Error("Only an uncertain sent Test data operation can be reconciled");
    }
    if (!this.noEffectVerifier) {
      throw new Error("A target-backed read-only no-effect verifier is not configured; the uncertain write remains blocked");
    }
    const project = this.repository.knowledgeProjects.find((item) => item.id === task.knowledgeProjectId);
    const system = this.repository.systemProfiles.find((item) => item.id === task.systemId);
    if (!project || !system || !project.systemIds.includes(system.id)) {
      throw new Error("No-effect verification target system is not bound to the task knowledge project");
    }
    const cleanupLease = task.action === "cleanup" && task.leaseId
      ? this.getLease(task.leaseId)
      : undefined;
    if (task.action === "cleanup" && !cleanupLease) {
      throw new Error("Cleanup reconciliation requires its leased entity reference");
    }
    const query = cleanupLease?.reference ?? task.lookupQuery?.trim() ?? task.entityReference?.trim() ?? `${task.field}=${task.field}`;
    const verification = await this.noEffectVerifier({
      task: structuredClone(task),
      system: structuredClone(system),
      query
    });
    const expectedState = task.action === "cleanup" ? "present" : "absent";
    const alreadyApplied = task.action === "cleanup" && verification.status === "absent";
    if (verification.status === "unavailable" ||
        (verification.status !== expectedState && !alreadyApplied)) {
      throw new Error(verification.reason?.trim() || (
        verification.status === "present"
          ? "The target lookup found the entity; do not retry this write unless the operation-specific no-effect state is proven"
          : "The target-backed no-effect verification is unavailable; the uncertain write remains blocked"
      ));
    }
    const verifiedRefs = cleanSourceRefs(verification.evidenceRefs ?? []);
    const evidenceArtifacts = verification.evidenceArtifacts ?? [];
    if (!verification.provider?.trim() || verification.query !== query || verifiedRefs.length === 0 ||
        evidenceArtifacts.length === 0 || evidenceArtifacts.some((artifact) =>
          !artifact.path?.trim() || !/^[a-f0-9]{64}$/i.test(artifact.sha256)
        ) || !Number.isFinite(Date.parse(verification.checkedAt))) {
      throw new Error("No-effect verifier returned an incomplete or mismatched verification record");
    }
    const artifactValidation = await validateExecutionArtifacts(
      this.runtimeDir,
      evidenceArtifacts.map((artifact) => artifact.path),
      Object.fromEntries(evidenceArtifacts.map((artifact) => [artifact.path, artifact.sha256]))
    );
    if (artifactValidation.status !== "valid" || artifactValidation.files.length !== evidenceArtifacts.length) {
      throw new Error(`No-effect verifier evidence is unreadable or invalid: ${artifactValidation.reasons.join("; ")}`);
    }
    const evidenceRoot = await realpath(this.runtimeDir);
    for (const artifact of evidenceArtifacts) {
      const artifactPath = await realpath(resolve(evidenceRoot, artifact.path));
      const relativePath = relative(evidenceRoot, artifactPath);
      if (!relativePath || relativePath === ".." || relativePath.startsWith("..\\") || relativePath.startsWith("../") || isAbsolute(relativePath)) {
        throw new Error("No-effect verifier evidence path escaped the runtime artifact root");
      }
      const contents = await readFile(artifactPath);
      const sha256 = createHash("sha256").update(contents).digest("hex");
      const validatedFile = artifactValidation.files.find((file) => file.path === artifact.path);
      if (!validatedFile || sha256 !== validatedFile.sha256) {
        throw new Error("No-effect verifier evidence changed during validation");
      }
      let observation: TestDataNoEffectObservation;
      try {
        observation = JSON.parse(contents.toString("utf8")) as TestDataNoEffectObservation;
      } catch {
        throw new Error("No-effect verifier evidence must be a readable structured JSON observation");
      }
      if (observation.schemaVersion !== 1 || observation.type !== "testdata-no-effect-observation" ||
          observation.systemId !== system.id || observation.query !== query ||
          observation.result !== verification.status ||
          (observation.result === "absent" && observation.matchCount !== 0) ||
          (observation.result === "present" &&
            (observation.matchCount !== 1 || observation.reference !== query)) ||
          observation.provider !== verification.provider.trim() ||
          observation.checkedAt !== verification.checkedAt) {
        throw new Error("No-effect verifier evidence does not match the target, query, unique entity state, or action phase");
      }
    }
    const now = timestamp();
    task.operationPhase = alreadyApplied ? "reconciled-applied" : "reconciled-not-applied";
    if (!alreadyApplied && task.action === "cleanup") {
      task.cleanupNoticeAcknowledgedAt = undefined;
    }
    task.reconciliationVerification = {
      status: verification.status,
      provider: verification.provider.trim(),
      query,
      evidenceRefs: verifiedRefs,
      artifactHashes: artifactValidation.files,
      checkedAt: verification.checkedAt
    };
    task.reconciliationSourceRefs = unique([...(task.reconciliationSourceRefs ?? []), ...verifiedRefs]);
    task.reconciliationContextRefs = unique([
      ...(task.reconciliationContextRefs ?? []),
      ...cleanSourceRefs(sourceRefs)
    ]);
    task.updatedAt = now;
    if (alreadyApplied) {
      await this.submit({
        taskId: task.id,
        status: "succeeded",
        sourceRefs: unique([...verifiedRefs, ...cleanSourceRefs(sourceRefs)])
      });
      return task;
    }
    this.repository.persist();
    return task;
  }

  private getCase(input: PrepareInput) {
    const project = this.repository.knowledgeProjects.find(
      (item) => item.id === input.knowledgeProjectId
    );
    if (!project) throw new Error("Knowledge project not found");
    if (!project.systemIds.includes(input.systemId)) {
      throw new Error("Business system is not bound to the knowledge project");
    }
    const executableCase = this.repository.executableCases.find(
      (item) =>
        item.id === input.executableCaseId &&
        item.knowledgeProjectId === input.knowledgeProjectId
    );
    if (!executableCase) throw new Error("Executable case not found");
    if (executableCase.systemId !== input.systemId) {
      throw new Error("Executable case belongs to another business system");
    }
    return executableCase;
  }

  private unresolvedOperations(executableCase: ExecutableCase, requirementSuiteRunId?: string) {
    if (!executableCase.dataPlan) return [];
    return executableCase.dataPlan.operations.filter(
      (operation) =>
        (operation.decision === "lookup" &&
          operation.status === "needs-resolution") ||
        ((operation.decision === "reuse" || operation.decision === "create") &&
          !findActiveTestDataLease(
            this.repository,
            executableCase,
            executableCase.systemId!,
            operation,
            requirementSuiteRunId
          ))
    );
  }

  private resolveDeterministicOperations(executableCase: ExecutableCase) {
    const operations = executableCase.dataPlan?.operations.filter(
      (operation) =>
        (operation.strategy === "generated" || operation.strategy === "unique") &&
        operation.decision === "generate" &&
        operation.status === "proposed" &&
        Boolean(operation.value?.trim())
    ) ?? [];
    if (operations.length === 0) return [];
    this.knowledgeService.resolveExecutableCaseTestData({
      executableCaseId: executableCase.id,
      resolutions: operations.map((operation) => ({
        profileId: operation.profileId,
        decision: "use-value" as const,
        value: operation.value
      }))
    });
    return operations.map((operation) => operation.profileId);
  }

  private prepareOperation(
    operation: ExecutableCaseDataOperation,
    allowCreate: boolean
  ): PrepareOperation {
    return {
      profileId: operation.profileId,
      field: operation.field,
      ...(operation.entityReference
        ? { entityReference: operation.entityReference }
        : {}),
      ...(operation.reference ? { reference: operation.reference } : {}),
      lookupQuery: operation.lookupQuery,
      cleanup: operation.cleanup,
      allowedDecisions:
        allowCreate && operation.cleanup !== "none"
          ? ["reuse", "create"]
          : ["reuse"],
      constraints: operation.constraints,
      sourceRefs: operation.sourceRefs
    };
  }

  private nextOperation(executableCase: ExecutableCase, operations: PrepareOperation[]) {
    const order = executableCase.dataPlan?.dependencyOrder ?? [];
    return [...operations].sort(
      (left, right) =>
        order.indexOf(left.profileId) - order.indexOf(right.profileId)
    )[0];
  }

  private async createOrReuseTask(input: {
    executableCase: ExecutableCase;
    requirementSuiteRunId?: string;
    operation: PrepareOperation;
    action: TestDataTask["action"];
    allowCreate: boolean;
    leaseId?: string;
  }) {
    const idempotencyKey = [
      input.executableCase.systemId,
      input.executableCase.id,
      input.requirementSuiteRunId ?? "manual",
      input.operation.profileId,
      input.action,
      input.leaseId ?? "none"
    ].join(":");
    const existing = this.repository.testDataTasks.find(
      (item) => item.idempotencyKey === idempotencyKey && item.status === "pending"
    );
    if (existing) {
      if (existing.action === "cleanup" && existing.leaseId &&
          (!existing.cleanupNoticeMessage || !existing.cleanupNoticeSha256)) {
        const lease = this.repository.testDataLeases.find((item) => item.id === existing.leaseId);
        if (!lease) throw new Error("Cleanup task has no leased entity for its advance notice");
        const notice = cleanupNoticeFor(lease);
        existing.cleanupNoticeMessage = notice.message;
        existing.cleanupNoticeSha256 = notice.sha256;
        existing.cleanupNoticeAcknowledgedAt = undefined;
        existing.updatedAt = timestamp();
        this.repository.persist();
      }
      return existing;
    }

    const taskId = id("testDataTask");
    const taskDir = join(this.runtimeDir, "test-data", taskId);
    const contextPath = join(taskDir, "input.context.json");
    const promptPath = join(taskDir, "input.prompt.md");
    const now = timestamp();
    const cleanupLease = input.leaseId
      ? this.repository.testDataLeases.find((item) => item.id === input.leaseId)
      : undefined;
    const cleanupNotice = input.action === "cleanup" && cleanupLease
      ? cleanupNoticeFor(cleanupLease)
      : undefined;
    const task: TestDataTask = {
      id: taskId,
      knowledgeProjectId: input.executableCase.knowledgeProjectId,
      systemId: input.executableCase.systemId!,
      executableCaseId: input.executableCase.id,
      ...(input.requirementSuiteRunId ? { requirementSuiteRunId: input.requirementSuiteRunId } : {}),
      profileId: input.operation.profileId,
      field: input.operation.field,
      ...(input.operation.entityReference
        ? { entityReference: input.operation.entityReference }
        : {}),
      action: input.action,
      status: "pending",
      idempotencyKey,
      operationPhase: "prepared",
      allowCreate: input.allowCreate,
      cleanup: input.operation.cleanup,
      lookupQuery: input.operation.lookupQuery,
      leaseId: input.leaseId,
      ...(cleanupNotice ? {
        cleanupNoticeMessage: cleanupNotice.message,
        cleanupNoticeSha256: cleanupNotice.sha256
      } : {}),
      contextPath,
      promptPath,
      sourceRefs: input.operation.sourceRefs,
      outputSourceRefs: [],
      createdAt: now,
      updatedAt: now
    };
    await mkdir(taskDir, { recursive: true });
    await writeFile(
      contextPath,
      JSON.stringify({
        taskId,
        systemId: task.systemId,
        executableCaseId: task.executableCaseId,
        requirementSuiteRunId: task.requirementSuiteRunId,
        action: task.action,
        idempotencyKey: task.idempotencyKey,
        operationPhase: task.operationPhase,
        field: task.field,
        ...(task.entityReference
          ? { entityReference: task.entityReference }
          : {}),
        lookupQuery: task.lookupQuery,
        allowedDecisions: input.operation.allowedDecisions,
        cleanup: task.cleanup,
        constraints: input.operation.constraints,
        lease: task.leaseId
          ? this.repository.testDataLeases.find((item) => item.id === task.leaseId)
          : undefined,
        sourceRefs: task.sourceRefs
      }, null, 2),
      "utf8"
    );
    await writeFile(promptPath, this.taskPrompt(task, input.operation), "utf8");
    this.repository.testDataTasks.push(task);
    this.repository.persist();
    return task;
  }

  private taskPrompt(task: TestDataTask, operation: PrepareOperation) {
    const recovery = [
      `Stable idempotency key: ${task.idempotencyKey}`,
      "Mark the task sent before the first external write.",
      "If a prior response was lost or execution was interrupted, perform a read-only lookup and verify the current business state before doing anything else.",
      "If the requested result already exists, submit that same entity reference with evidence; do not repeat the create or transition.",
      "If the requested effect is absent, record read-only evidence of absence before retrying the write."
    ];
    if (task.action === "cleanup") {
      return [
        "# Test Data Cleanup Task",
        "",
        `Clean up the data lease for field "${task.field}" using policy "${task.cleanup}".`,
        "Before any cleanup write, send this advance notice to the user, then acknowledge it with the returned SHA-256 using bc_prepare action=confirm-cleanup-notice. Do not mark the task sent or perform cleanup until that acknowledgment succeeds.",
        task.cleanupNoticeMessage ?? "The cleanup notice is unavailable; stop and do not clean up.",
        task.cleanupNoticeSha256 ? `Cleanup notice SHA-256: ${task.cleanupNoticeSha256}` : "",
        "Do not modify unrelated business data.",
        ...recovery,
        "After cleanup, verify by a read-only query that this exact leased entity is absent, then call bc_prepare action=reconcile-test-data-no-effect with the verification evidence. Do not report cleanup as complete from the write response alone."
      ].join("\n");
    }
    return [
      "# Test Data Preparation Task",
      "",
      `Find data for field "${task.field}" in the bound business system.`,
      ...(task.entityReference
        ? [`Semantic entity reference: ${task.entityReference}`]
        : []),
      `Lookup query: ${task.lookupQuery ?? "(not specified)"}`,
      `Allowed decisions: ${operation.allowedDecisions.join(", ")}`,
      "Prefer reusing an existing matching record.",
      "Do not create data unless lookup cannot satisfy the request and create is explicitly allowed.",
      ...recovery,
      `If data is created, preserve evidence and apply cleanup policy "${task.cleanup}".`,
      "Do not expose secrets in the result."
    ].join("\n");
  }

  private createOrReuseLease(input: {
    task: TestDataTask;
    decision: "reuse" | "create";
    reference: string;
    value?: string;
    sourceRefs: string[];
    now: string;
    reusedFromLeaseId?: string;
  }) {
    const existing = this.repository.testDataLeases.find(
      (item) =>
        item.taskId === input.task.id &&
        item.profileId === input.task.profileId &&
        item.reference === input.reference
    );
    if (existing) return existing;
    const lease: TestDataLease = {
      id: id("testDataLease"),
      knowledgeProjectId: input.task.knowledgeProjectId,
      systemId: input.task.systemId,
      executableCaseId: input.task.executableCaseId,
      ...(input.task.requirementSuiteRunId ? { requirementSuiteRunId: input.task.requirementSuiteRunId } : {}),
      profileId: input.task.profileId,
      taskId: input.task.id,
      decision: input.decision,
      reference: input.reference,
      ...(input.task.entityReference
        ? { entityReference: input.task.entityReference }
        : {}),
      value: input.value,
      cleanup: input.decision === "create" ? input.task.cleanup : "none",
      status: "active",
      ...(input.reusedFromLeaseId
        ? { reusedFromLeaseId: input.reusedFromLeaseId }
        : {}),
      sourceRefs: input.sourceRefs,
      createdAt: input.now,
      updatedAt: input.now
    };
    this.repository.testDataLeases.push(lease);
    return lease;
  }

  private findCleanupLease(executableCase: ExecutableCase, requirementSuiteRunId?: string) {
    return this.repository.testDataLeases.find((lease) => {
      const isCreatedCleanupLease = lease.decision === "create" &&
        lease.cleanup !== "none" &&
        (!requirementSuiteRunId || lease.requirementSuiteRunId === requirementSuiteRunId) &&
        (lease.status === "active" || lease.status === "cleanup-failed");
      if (!isCreatedCleanupLease) return false;
      const ownedByCurrentCase = lease.executableCaseId === executableCase.id;
      const consumerLease = this.consumerLeaseFor(executableCase, lease, requirementSuiteRunId);
      if (!ownedByCurrentCase && !consumerLease) return false;
      if (!this.hasTerminalEvidence(executableCase.id, requirementSuiteRunId, consumerLease?.createdAt ?? lease.createdAt)) {
        return false;
      }
      return !this.hasUnfinishedConsumers(lease, requirementSuiteRunId);
    });
  }

  private recordCrossCaseLeaseConsumptions(executableCase: ExecutableCase, requirementSuiteRunId?: string) {
    if (!executableCase.systemId) return;
    let changed = false;
    const now = timestamp();
    for (const operation of executableCase.dataPlan?.operations ?? []) {
      if ((operation.decision !== "reuse" && operation.decision !== "lookup") || !operation.entityReference) continue;
      const producerLease = findActiveTestDataLease(
        this.repository,
        executableCase,
        executableCase.systemId,
        operation,
        requirementSuiteRunId
      );
      if (!producerLease || producerLease.executableCaseId === executableCase.id) continue;
      const existingConsumption = this.repository.testDataLeases.some(
        (lease) => lease.executableCaseId === executableCase.id &&
          lease.requirementSuiteRunId === requirementSuiteRunId &&
          lease.profileId === operation.profileId &&
          lease.entityReference === operation.entityReference &&
          lease.reusedFromLeaseId === producerLease.id
      );
      if (existingConsumption) continue;
      this.repository.testDataLeases.push({
        id: id("testDataLease"),
        knowledgeProjectId: executableCase.knowledgeProjectId,
        systemId: executableCase.systemId,
        executableCaseId: executableCase.id,
        ...(requirementSuiteRunId ? { requirementSuiteRunId } : {}),
        profileId: operation.profileId,
        taskId: producerLease.taskId,
        decision: "reuse",
        reference: producerLease.reference,
        entityReference: operation.entityReference,
        cleanup: "none",
        status: "active",
        reusedFromLeaseId: producerLease.id,
        sourceRefs: unique([...producerLease.sourceRefs, ...operation.sourceRefs]),
        createdAt: now,
        updatedAt: now
      });
      changed = true;
    }
    if (changed) this.repository.persist();
  }

  private consumerLeaseFor(executableCase: ExecutableCase, producerLease: TestDataLease, requirementSuiteRunId?: string) {
    if (producerLease.executableCaseId === executableCase.id) return undefined;
    return this.repository.testDataLeases.find(
      (lease) => lease.executableCaseId === executableCase.id &&
        lease.reusedFromLeaseId === producerLease.id &&
        lease.requirementSuiteRunId === requirementSuiteRunId
    );
  }

  private hasUnfinishedConsumers(producerLease: TestDataLease, requirementSuiteRunId?: string) {
    if (!producerLease.entityReference) return false;
    const producerCase = this.repository.executableCases.find(
      (candidate) => candidate.id === producerLease.executableCaseId
    );
    if (!producerCase) return false;
    const consumers = this.repository.executableCases.filter(
      (candidate) => candidate.knowledgeProjectId === producerLease.knowledgeProjectId &&
        candidate.systemId === producerLease.systemId &&
        candidate.testIntentId !== producerCase.testIntentId &&
        candidate.status !== "stale" &&
        candidate.status !== "superseded" &&
        (candidate.caseDependencyGraph?.edges ?? []).some((edge) =>
          edge.fromTestIntentId === producerCase.testIntentId &&
          edge.toTestIntentId === candidate.testIntentId &&
          edge.entityReference === producerLease.entityReference
        )
    );
    const selectedConsumerIds = requirementSuiteRunId
      ? new Set(this.repository.requirementSuiteRuns.find((run) => run.id === requirementSuiteRunId)
          ?.caseRuns.map((caseRun) => caseRun.executableCaseId) ?? [])
      : undefined;
    return consumers.some((consumer) => {
      if (selectedConsumerIds && !selectedConsumerIds.has(consumer.id)) return false;
      const consumption = this.consumerLeaseFor(consumer, producerLease, requirementSuiteRunId);
      if (consumption) return consumption.status !== "released";
      const caseRun = requirementSuiteRunId
        ? this.repository.requirementSuiteRuns.find((run) => run.id === requirementSuiteRunId)
            ?.caseRuns.find((item) => item.executableCaseId === consumer.id)
        : undefined;
      return !caseRun || !["passed", "skipped", "cancelled"].includes(caseRun.status);
    });
  }

  private linkDataDependencies(
    executableCase: ExecutableCase,
    task: TestDataTask,
    lease: TestDataLease,
    sourceRefs: string[]
  ) {
    if (!this.testDataBrain) return;
    const operation = executableCase.dataPlan?.operations.find(
      (candidate) => candidate.profileId === task.profileId
    );
    for (const dependencyProfileId of operation?.dependsOnProfileIds ?? []) {
      const dependencyLease = this.findDependencyLease(task, dependencyProfileId);
      if (!dependencyLease) {
        throw new Error(
          `Test data dependency lease is missing for profile ${dependencyProfileId}`
        );
      }
      this.testDataBrain.linkDependency({
        knowledgeProjectId: task.knowledgeProjectId,
        systemId: task.systemId,
        fromReference: lease.reference,
        toReference: dependencyLease.reference,
        relation: "requires",
        sourceRefs: [...task.sourceRefs, ...sourceRefs]
      });
    }
  }

  private assertDependencyLeases(executableCase: ExecutableCase, task: TestDataTask) {
    const operation = executableCase.dataPlan?.operations.find(
      (candidate) => candidate.profileId === task.profileId
    );
    for (const dependencyProfileId of operation?.dependsOnProfileIds ?? []) {
      if (!this.findDependencyLease(task, dependencyProfileId)) {
        throw new Error(
          `Test data dependency lease is missing for profile ${dependencyProfileId}`
        );
      }
    }
  }

  private findDependencyLease(task: TestDataTask, dependencyProfileId: string) {
    return this.repository.testDataLeases.find(
      (candidate) =>
        candidate.knowledgeProjectId === task.knowledgeProjectId &&
        candidate.systemId === task.systemId &&
        candidate.executableCaseId === task.executableCaseId &&
        candidate.profileId === dependencyProfileId &&
        candidate.status === "active"
    );
  }

  private releaseReusableLeasesAfterExecution(executableCase: ExecutableCase, requirementSuiteRunId?: string) {
    const now = timestamp();
    let changed = false;
    for (const lease of this.repository.testDataLeases) {
      if (
        lease.executableCaseId === executableCase.id &&
        lease.requirementSuiteRunId === requirementSuiteRunId &&
        lease.decision === "reuse" &&
        lease.status === "active" &&
        this.hasTerminalEvidence(executableCase.id, requirementSuiteRunId, lease.createdAt)
      ) {
        lease.status = "released";
        lease.releasedAt = now;
        lease.updatedAt = now;
        const terminalEvidence = this.terminalEvidence(executableCase.id, requirementSuiteRunId, lease.createdAt);
        if (terminalEvidence) {
          lease.sourceRefs = unique([...lease.sourceRefs, `execution-evidence:${terminalEvidence.id}`]);
        }
        changed = true;
      }
    }
    if (changed) this.repository.persist();
  }

  private hasTerminalEvidence(executableCaseId: string, requirementSuiteRunId?: string, after?: string) {
    return Boolean(this.terminalEvidence(executableCaseId, requirementSuiteRunId, after));
  }

  private terminalEvidence(executableCaseId: string, requirementSuiteRunId?: string, after?: string) {
    const afterTime = after ? Date.parse(after) : undefined;
    return this.repository.executionEvidence.find((evidence) => {
      if (evidence.executableCaseId !== executableCaseId || evidence.status === "running") return false;
      if (requirementSuiteRunId && evidence.requirementSuiteRunId !== requirementSuiteRunId) return false;
      if (afterTime === undefined) return true;
      const terminalTime = Date.parse(evidence.completedAt ?? evidence.createdAt);
      return Number.isFinite(terminalTime) && terminalTime >= afterTime;
    });
  }

  private findField(executableCase: ExecutableCase, profileId: string) {
    return executableCase.dataPlan?.operations.find(
      (operation) => operation.profileId === profileId
    )?.field ?? profileId;
  }

  private getLease(leaseId: string) {
    const lease = this.repository.testDataLeases.find((item) => item.id === leaseId);
    if (!lease) throw new Error("Test data lease not found");
    return lease;
  }

  private completeTask(task: TestDataTask, sourceRefs: string[], now: string) {
    task.status = "submitted";
    task.operationPhase = "reconciled-applied";
    task.outputSourceRefs = unique([...(task.reconciliationSourceRefs ?? []), ...sourceRefs]);
    task.submittedAt = now;
    task.updatedAt = now;
  }

  private resolveCleanupGaps(leaseId: string, now: string) {
    const cleanupTaskIds = new Set(
      this.repository.testDataTasks
        .filter((item) => item.action === "cleanup" && item.leaseId === leaseId)
        .map((item) => item.id)
    );
    for (const gap of this.repository.gaps) {
      if (
        gap.sourceType === "test-data-cleanup" &&
        gap.status === "open" &&
        cleanupTaskIds.has(gap.sourceId)
      ) {
        gap.status = "resolved";
        gap.updatedAt = now;
      }
    }
  }

  private resolveProviderGaps(task: TestDataTask, now: string) {
    const relatedTaskIds = new Set(
      this.repository.testDataTasks
        .filter(
          (item) =>
            item.action === "lookup-or-create" &&
            item.executableCaseId === task.executableCaseId &&
            item.profileId === task.profileId
        )
        .map((item) => item.id)
    );
    for (const gap of this.repository.gaps) {
      if (
        gap.sourceType === "test-data-provider" &&
        gap.status === "open" &&
        relatedTaskIds.has(gap.sourceId)
      ) {
        gap.status = "resolved";
        gap.updatedAt = now;
      }
    }
  }

  private refreshCaseStatus(executableCase: ExecutableCase, now: string) {
    if (executableCase.dataPlan?.verdict !== "ready") return;
    const wasStale = executableCase.status === "stale";
    executableCase.status = wasStale
      ? "stale"
      : executableCaseCompileStatus(this.repository, executableCase);
    executableCase.updatedAt = now;
    const intent = this.repository.testIntents.find(
      (item) => item.id === executableCase.testIntentId
    );
    if (intent) {
      intent.status = executableCase.status === "ready"
        ? "compiled"
        : executableCase.status;
      intent.updatedAt = now;
    }
  }

  private createGap(
    executableCase: ExecutableCase,
    task: TestDataTask,
    reason: string,
    sourceType: string
  ) {
    const now = timestamp();
    const gap: Gap = {
      id: id("gap"),
      projectId: task.knowledgeProjectId,
      sourceType,
      sourceId: task.id,
      reason,
      severity: "high",
      owner: "qa",
      status: "open",
      createdAt: now,
      updatedAt: now
    };
    this.repository.gaps.push(gap);
    executableCase.gapIds = unique([...executableCase.gapIds, gap.id]);
    executableCase.updatedAt = now;
    return gap;
  }

  private getTask(taskId: string) {
    const task = this.repository.testDataTasks.find((item) => item.id === taskId);
    if (!task) throw new Error("Test data task not found");
    return task;
  }

  private canDispatchAgain(task: TestDataTask) {
    return task.operationPhase === "prepared" || task.operationPhase === "reconciled-not-applied";
  }
}

function cleanupNoticeFor(lease: TestDataLease) {
  const effect = lease.cleanup === "delete-created"
    ? "remove the test-created record"
    : "restore the test-created record to its approved prior state";
  const message = `Advance notice: I am about to clean up test entity "${lease.reference}" using policy "${lease.cleanup}". Expected effect: ${effect}. Timing: immediately after this notice and before the suite continues. Only this leased test entity will be changed.`;
  return {
    message,
    sha256: createHash("sha256").update(message).digest("hex")
  };
}

function entityTypeFromReference(reference: string) {
  const [prefix] = reference.split(":", 1);
  return prefix?.trim() || undefined;
}

function cleanSourceRefs(sourceRefs: string[]) {
  return unique(sourceRefs.map((item) => item.trim()).filter(Boolean));
}

function unique<T>(items: T[]) {
  return [...new Set(items)];
}

function timestamp() {
  return new Date().toISOString();
}
