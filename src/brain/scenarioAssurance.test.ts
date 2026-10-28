import { describe, expect, it } from "vitest";
import type {
  DecisionTableModel,
  StateMachineModel,
  TestDataProfile,
  TestIntent,
  WorkflowModel
} from "../domain/types.js";
import type { SemanticBinding, SystemBrainSnapshot } from "./types.js";
import {
  buildBusinessScenarios,
  buildScenarioAssurance,
  createScenarioTrustRecord,
  evaluateMutationSuite,
  updateScenarioTrust,
  EvaluationProviderRegistry
} from "./scenarioAssurance.js";

const now = "2026-09-01T00:00:00.000Z";

function workflow(): WorkflowModel {
  return {
    id: "workflow-order",
    knowledgeProjectId: "project-1",
    requirementSetId: "requirement-1",
    title: "Submit order",
    actors: ["requester", "approver"],
    steps: [
      { id: "draft", label: "Draft", actor: "requester", sourceRefs: ["req:workflow"] },
      { id: "approved", label: "Approved", actor: "approver", sourceRefs: ["req:workflow"] }
    ],
    transitions: [{
      id: "transition-submit",
      from: "draft",
      to: "approved",
      condition: "amount is within limit",
      actor: "approver",
      trigger: "approve",
      sourceRefs: ["req:approve"]
    }],
    startStepIds: ["draft"],
    endStepIds: ["approved"],
    sourceRefs: ["req:workflow", "req:approve"],
    confidence: 1,
    status: "confirmed",
    createdAt: now,
    updatedAt: now
  };
}

function stateMachine(): StateMachineModel {
  return {
    id: "state-order",
    knowledgeProjectId: "project-1",
    requirementSetId: "requirement-1",
    title: "Order states",
    states: [
      { id: "draft", label: "Draft", initial: true, terminal: false, sourceRefs: ["req:state"] },
      { id: "submitted", label: "Submitted", initial: false, terminal: true, sourceRefs: ["req:state"] }
    ],
    transitions: [{
      id: "transition-submit",
      from: "draft",
      to: "submitted",
      trigger: "submit",
      actor: "requester",
      preconditions: ["Order is complete"],
      validity: "legal",
      sourceRefs: ["req:submit"]
    }],
    sourceRefs: ["req:state", "req:submit"],
    confidence: 1,
    status: "confirmed",
    createdAt: now,
    updatedAt: now
  };
}

function decisionTable(): DecisionTableModel {
  return {
    id: "decision-order",
    requirementSetId: "requirement-1",
    title: "Approval routing",
    conditions: ["amount"],
    actions: ["route to approver"],
    rules: [{
      conditionValues: { amount: "within-limit" },
      expectedActions: ["route to approver"],
      sourceRefs: ["req:decision"]
    }],
    sourceRefs: ["req:decision"],
    status: "confirmed"
  };
}

function intent(id: string, refs: string[], dimensions: TestIntent["coverageDimensions"] = ["workflow"]): TestIntent {
  return {
    id,
    knowledgeProjectId: "project-1",
    requirementSetId: "requirement-1",
    title: "Submit order",
    module: "Orders",
    priority: "P1",
    objective: "Submit a complete order",
    preconditions: ["Order is complete"],
    expectedResults: ["Order is submitted"],
    requirementRefs: refs,
    knowledgeNodeRefs: [],
    techniques: ["scenario"],
    coverageDimensions: dimensions,
    processModelRefs: ["workflow-order"],
    actorJourney: ["requester", "approver"],
    status: "draft",
    createdAt: now,
    updatedAt: now
  };
}

function snapshot(): SystemBrainSnapshot {
  return {
    id: "snapshot-1",
    knowledgeProjectId: "project-1",
    systemId: "system-1",
    revision: 1,
    status: "confirmed",
    explorationIds: [],
    assets: [{
      semanticId: "action:approve",
      kind: "transition",
      label: "Approve",
      content: "Approve order",
      contentHash: "asset-hash",
      sourceRefs: ["system-observation:approve"],
      metadata: {}
    }],
    contentHash: "system-hash",
    createdAt: now,
    confirmedAt: now,
    confirmedBy: "qa"
  };
}

describe("scenario assurance", () => {
  it("builds domain-neutral path scenarios without adding a generic actor journey", () => {
    const scenarios = buildBusinessScenarios({
      knowledgeProjectId: "project-1",
      requirementSetId: "requirement-1",
      workflows: [workflow()],
      stateMachines: [stateMachine()],
      decisionTables: [decisionTable()],
      testIntents: [intent("intent-1", ["req:workflow", "req:approve"])]
    });

    expect(scenarios.some((item) => item.workflowRefs.includes("workflow-order"))).toBe(true);
    expect(scenarios.some((item) => item.family === "branch")).toBe(true);
    expect(scenarios.some((item) => item.family === "state-transition")).toBe(true);
    expect(scenarios.some((item) => item.family === "cross-role")).toBe(false);
    expect(scenarios.some((item) => item.family === "invalid-transition")).toBe(true);
    expect(scenarios.every((item) => item.sourceRefs.length > 0)).toBe(true);
    expect(scenarios.every((item) => !item.title.includes("HR"))).toBe(true);
  });

  it("links decision-table branches only to intents with matching source anchors", () => {
    const relevant = intent("intent-relevant", ["req:decision"]);
    const unrelated = intent("intent-unrelated", ["req:workflow"]);
    const scenarios = buildBusinessScenarios({
      knowledgeProjectId: "project-1",
      requirementSetId: "requirement-1",
      workflows: [],
      stateMachines: [],
      decisionTables: [decisionTable()],
      testIntents: [relevant, unrelated]
    });

    const branch = scenarios.find((scenario) => scenario.family === "branch");

    expect(branch).toEqual(expect.objectContaining({
      testIntentIds: ["intent-relevant"]
    }));
  });

  it("names decision-table scenarios with their condition values", () => {
    const scenarios = buildBusinessScenarios({
      knowledgeProjectId: "project-1",
      requirementSetId: "requirement-1",
      workflows: [],
      stateMachines: [],
      decisionTables: [decisionTable()],
      testIntents: [intent("intent-relevant", ["req:decision"])]
    });

    expect(scenarios.find((scenario) => scenario.family === "branch")?.title)
      .toBe("Approval routing: amount=within-limit");
  });

  it("keeps positive workflow scenarios separate from negative intents and unrelated transitions", () => {
    const matching = intent("intent-matching", ["req:approve"]);
    matching.processModelRefs = ["workflow-order"];
    const wrongTransition = intent("intent-wrong-transition", ["req:workflow"]);
    wrongTransition.processModelRefs = ["workflow-order"];
    const negative = intent("intent-negative", ["req:approve"]);
    negative.processModelRefs = ["workflow-order"];
    negative.scenarioType = "negative";
    negative.expectedResults = ["Unauthorized actor is rejected"];

    const scenarios = buildBusinessScenarios({
      knowledgeProjectId: "project-1",
      requirementSetId: "requirement-1",
      workflows: [workflow()],
      stateMachines: [],
      decisionTables: [],
      testIntents: [matching, wrongTransition, negative]
    });
    const workflowPath = scenarios.find((scenario) => scenario.workflowRefs.includes("workflow-order"));

    expect(workflowPath?.testIntentIds).toEqual(["intent-matching"]);
    expect(workflowPath?.expectedBusinessOutcomes).not.toContain("Unauthorized actor is rejected");
  });

  it("enumerates complete mutually-exclusive paths and scopes intents by their applicability conditions", () => {
    const model = workflow();
    model.steps = [
      { id: "start", label: "Start", actor: "requester", sourceRefs: ["req:route"] },
      { id: "overseas", label: "Overseas route", actor: "HRBP", sourceRefs: ["req:route"] },
      { id: "domestic", label: "Domestic default", actor: "HRBP_TA", sourceRefs: ["req:route"] },
      { id: "org23", label: "Department lead", actor: "Department lead", sourceRefs: ["req:route"] },
      { id: "orgDefault", label: "Fourth-level lead", actor: "Fourth-level lead", sourceRefs: ["req:route"] }
    ];
    model.transitions = [
      { id: "oversea", from: "start", to: "overseas", condition: "overseaEstablishment == 1", sourceRefs: ["req:route"] },
      { id: "domestic", from: "start", to: "domestic", condition: "domestic default", sourceRefs: ["req:route"] },
      { id: "oversea-org23", from: "overseas", to: "org23", condition: "orgLevel is 2 or 3", sourceRefs: ["req:route"] },
      { id: "oversea-org-default", from: "overseas", to: "orgDefault", condition: "orgLevel default", sourceRefs: ["req:route"] },
      { id: "domestic-org23", from: "domestic", to: "org23", condition: "orgLevel is 2 or 3", sourceRefs: ["req:route"] },
      { id: "domestic-org-default", from: "domestic", to: "orgDefault", condition: "orgLevel default", sourceRefs: ["req:route"] }
    ];
    model.startStepIds = ["start"];
    model.endStepIds = ["org23", "orgDefault"];
    const intents = [
      { ...intent("overseas-intent", ["req:route"]), applicabilityConditions: ["overseaEstablishment == 1"] },
      { ...intent("domestic-intent", ["req:route"]), applicabilityConditions: ["domestic default"] },
      { ...intent("org23-intent", ["req:route"]), applicabilityConditions: ["orgLevel is 2 or 3"] },
      { ...intent("org-default-intent", ["req:route"]), applicabilityConditions: ["orgLevel default"] }
    ];

    const scenarios = buildBusinessScenarios({
      knowledgeProjectId: "project-1",
      requirementSetId: "requirement-1",
      workflows: [model],
      stateMachines: [],
      decisionTables: [],
      testIntents: intents
    });

    expect(scenarios).toHaveLength(4);
    expect(scenarios.every((scenario) => scenario.workflowRefs.includes(model.id))).toBe(true);
    expect(scenarios.find((scenario) => scenario.preconditions.includes("overseaEstablishment == 1") && scenario.preconditions.includes("orgLevel default"))?.testIntentIds)
      .toEqual(["overseas-intent", "org-default-intent"]);
    expect(scenarios.find((scenario) => scenario.preconditions.includes("domestic default") && scenario.preconditions.includes("orgLevel is 2 or 3"))?.testIntentIds)
      .toEqual(["domestic-intent", "org23-intent"]);
  });

  it("keeps free-text outcomes limited until a structured oracle contract exists", () => {
    const dataProfile: TestDataProfile = {
      id: "data-order",
      knowledgeProjectId: "project-1",
      requirementSetId: "requirement-1",
      name: "Order data",
      field: "order",
      strategy: "generated",
      constraints: [],
      seed: "order-1",
      sourceRefs: ["req:workflow"],
      createdAt: now
    };
    const scenario = buildBusinessScenarios({
      knowledgeProjectId: "project-1",
      requirementSetId: "requirement-1",
      workflows: [workflow()],
      stateMachines: [],
      decisionTables: [],
      testIntents: [intent("intent-1", ["req:workflow", "req:approve"])],
      dataProfiles: [dataProfile]
    }).find((item) => item.workflowRefs.includes("workflow-order"))!;
    const binding: SemanticBinding = {
      id: "binding-1",
      requirementSetId: "requirement-1",
      systemId: "system-1",
      expectedSemanticId: "action:approve",
      observedSemanticId: "action:approve",
      type: "exact",
      conditions: {},
      confidence: 1,
      status: "confirmed",
      evidenceRefs: ["system-observation:approve"]
    };

    expect(buildScenarioAssurance({ scenario }).systemBinding).toBe("missing");
    const contract = buildScenarioAssurance({
      scenario,
      systemId: "system-1",
      systemSnapshot: snapshot(),
      semanticBindings: [binding],
      dataProfiles: [dataProfile],
      providerIndependence: "isolated-single-provider"
    });
    expect(contract).toEqual(expect.objectContaining({
      systemBinding: "unique",
      testDataReadiness: "creatable",
      oracleStrength: "limited",
      verdict: "needs-review",
      independence: "isolated-single-provider"
    }));
    expect(contract.reasons).toContain("Free-text business outcomes are not a structured business oracle.");

    expect(buildScenarioAssurance({
      scenario,
      systemId: "system-1",
      systemSnapshot: { ...snapshot(), status: "candidate", confirmedAt: undefined, confirmedBy: undefined },
      semanticBindings: [binding],
      dataProfiles: [dataProfile]
    })).toEqual(expect.objectContaining({
      systemBinding: "missing",
      verdict: "blocked"
    }));
  });

  it("blocks assurance when no scenario-scoped data plan is declared", () => {
    const scenario = buildBusinessScenarios({
      knowledgeProjectId: "project-1",
      requirementSetId: "requirement-1",
      workflows: [workflow()],
      stateMachines: [],
      decisionTables: [],
      testIntents: [intent("intent-no-data", ["req:workflow"])]
    }).find((item) => item.workflowRefs.includes("workflow-order"))!;
    const binding: SemanticBinding = {
      id: "binding-1",
      requirementSetId: "requirement-1",
      systemId: "system-1",
      expectedSemanticId: "action:approve",
      observedSemanticId: "action:approve",
      type: "exact",
      conditions: {},
      confidence: 1,
      status: "confirmed",
      evidenceRefs: ["system-observation:approve"]
    };

    const contract = buildScenarioAssurance({
      scenario,
      systemId: "system-1",
      systemSnapshot: snapshot(),
      semanticBindings: [binding]
    });

    expect(contract).toEqual(expect.objectContaining({
      systemBinding: "unique",
      testDataReadiness: "blocked",
      verdict: "blocked"
    }));
    expect(contract.reasons).toContain("No scenario-scoped test data profiles are declared.");
  });

  it("promotes only after three unchanged strong runs and downgrades on evidence changes", () => {
    const initial = createScenarioTrustRecord({
      scenarioId: "scenario-1",
      requirementHash: "req-hash",
      systemSnapshotHash: "system-hash",
      dataPlanHash: "data-hash",
      grounded: true,
      bound: true,
      updatedAt: now
    });
    expect(initial.status).toBe("bound");
    const first = updateScenarioTrust(initial, {
      passed: true,
      strongEvidence: true,
      requirementHash: "req-hash",
      systemSnapshotHash: "system-hash",
      dataPlanHash: "data-hash",
      updatedAt: now
    });
    const second = updateScenarioTrust(first, {
      passed: true,
      strongEvidence: true,
      requirementHash: "req-hash",
      systemSnapshotHash: "system-hash",
      dataPlanHash: "data-hash",
      updatedAt: now
    });
    const trusted = updateScenarioTrust(second, {
      passed: true,
      strongEvidence: true,
      requirementHash: "req-hash",
      systemSnapshotHash: "system-hash",
      dataPlanHash: "data-hash",
      updatedAt: now
    });
    expect(first.status).toBe("verified");
    expect(trusted.status).toBe("trusted");
    expect(updateScenarioTrust(trusted, {
      passed: true,
      strongEvidence: true,
      requirementHash: "changed",
      systemSnapshotHash: "system-hash",
      dataPlanHash: "data-hash",
      updatedAt: now
    })).toEqual(expect.objectContaining({ status: "bound", strongRunCount: 0 }));
  });

  it("evaluates mutation outcomes without treating blocked mutants as caught", () => {
    const result = evaluateMutationSuite({
      threshold: 0.85,
      mutations: [
        { id: "m1", scenarioId: "scenario-1", status: "caught", evidenceRefs: ["e1"] },
        { id: "m2", scenarioId: "scenario-1", status: "survived", evidenceRefs: ["e2"] },
        { id: "m3", scenarioId: "scenario-1", status: "blocked", evidenceRefs: [] }
      ]
    });
    expect(result).toEqual(expect.objectContaining({ caught: 1, survived: 1, blocked: 1, detectionRate: 0.5, verdict: "needs-review" }));
  });

  it("exposes the host as the primary provider and optional CLI evaluators through an injectable registry", () => {
    const registry = new EvaluationProviderRegistry({
      primary: "host-agent",
      evaluator: "codex",
      probe: (provider) => provider === "codex"
    });
    expect(registry.primary()).toEqual(expect.objectContaining({ provider: "host-agent", role: "primary", available: true }));
    expect(registry.evaluator()).toEqual(expect.objectContaining({ provider: "codex", role: "evaluator", available: true, enabled: true }));
    expect(registry.list().filter((item) => item.role === "evaluator")).toHaveLength(1);
  });
});
