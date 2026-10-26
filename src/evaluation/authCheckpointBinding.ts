import type { InMemoryBrainCreatorRepository } from "../domain/repository.js";
import type { AuthCheckpoint } from "../domain/types.js";

export type AuthCheckpointRunBinding = Pick<
  AuthCheckpoint,
  "requirementSuiteRunId" | "executableCaseId" | "evaluationTrialId" | "businessScenarioId"
>;

export function authCheckpointBinding(
  repository: Pick<
    InMemoryBrainCreatorRepository,
    "requirementSuiteRuns" | "executableCases" | "evaluationTrials" | "businessScenarios"
  >,
  input: {
    systemId: string;
    requirementSuiteRunId?: string;
    executableCaseId?: string;
  }
): AuthCheckpointRunBinding {
  const suiteRun = input.requirementSuiteRunId
    ? repository.requirementSuiteRuns.find(
        (item) => item.id === input.requirementSuiteRunId
      )
    : undefined;
  const executableCase = input.executableCaseId
    ? repository.executableCases.find(
        (item) => item.id === input.executableCaseId
      )
    : undefined;
  if (
    !suiteRun ||
    !executableCase ||
    suiteRun.systemId !== input.systemId ||
    executableCase.knowledgeProjectId !== suiteRun.knowledgeProjectId ||
    !suiteRun.caseRuns.some((item) => item.executableCaseId === executableCase.id)
  ) {
    return {};
  }
  const binding: AuthCheckpointRunBinding = {
    requirementSuiteRunId: suiteRun.id,
    executableCaseId: executableCase.id
  };
  const trial = suiteRun.evaluationTrialId
    ? repository.evaluationTrials.find(
        (item) => item.id === suiteRun.evaluationTrialId
      )
    : undefined;
  if (!trial || trial.status !== "active" || trial.systemId !== input.systemId) {
    return binding;
  }
  binding.evaluationTrialId = trial.id;
  const scope = trial.executionScope?.businessScenarioIds ?? [];
  const scenarios = repository.businessScenarios.filter(
    (item) =>
      item.knowledgeProjectId === suiteRun.knowledgeProjectId &&
      item.requirementSetId === executableCase.requirementSetId &&
      (item.testIntentIds ?? []).includes(executableCase.testIntentId) &&
      scope.includes(item.id)
  );
  if (scenarios.length === 1) binding.businessScenarioId = scenarios[0]!.id;
  return binding;
}
