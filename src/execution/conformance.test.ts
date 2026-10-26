// @vitest-environment node

import { describe, expect, it } from "vitest";
import { evaluateConformance, type ConformanceEvaluationInput } from "./conformance.js";

function boundResult(): ConformanceEvaluationInput {
  return {
    scenarioId: "scenario-order", executionEvidenceId: "evidence-order", status: "passed", assuranceLevel: "strong",
    provenance: "real-system",
    expectationRefs: ["requirement:approval"], observationRefs: ["actual.json"], executionRefs: ["evidence-order"],
    artifactValidation: { status: "valid", files: [{ path: "actual.json", sha256: "a".repeat(64) }], reasons: [] },
    contracts: [{ id: "approval", stepId: "verify", type: "state", strength: "strong", expected: "approved",
      requirementRefs: ["requirement:approval"], evidenceRequirements: ["actual-value"],
      oracle: { operator: "transition", previous: "pending", expected: "approved", applicability: { mode: "unconditional" }, applicabilityRefs: ["requirement:approval"] } }],
    reporter: { status: "passed", total: 1, passed: 1, failed: 0, skipped: 0, durationMs: 1,
      assertions: [{ id: "approval", stepId: "verify", status: "passed", actual: "approved", previousActual: "pending", evidenceRefs: ["actual.json"] }],
      attachments: [], consoleErrors: [], networkFailures: [] }
  };
}

describe("execution conformance", () => {
  it("evaluates the actual transition against the approved oracle", () => {
    const input = boundResult();
    expect(evaluateConformance(input).verdict).toBe("conform");
    input.reporter!.assertions[0].actual = "rejected";
    expect(evaluateConformance(input).verdict).toBe("nonconform");
    input.reporter!.assertions[0].previousActual = "draft";
    expect(evaluateConformance(input).verdict).toBe("context-mismatch");
  });

  it("rejects missing, duplicate or wrong-step assertion bindings", () => {
    const input = boundResult();
    input.reporter!.assertions[0].stepId = "unrelated";
    expect(evaluateConformance(input).verdict).toBe("inconclusive");
    input.reporter!.assertions[0].stepId = "verify";
    input.reporter!.assertions.push({ ...input.reporter!.assertions[0] });
    expect(evaluateConformance(input).verdict).toBe("inconclusive");
  });

  it("does not let a single reporter assertion satisfy duplicate contract IDs", () => {
    const input = boundResult();
    input.contracts!.push({ ...input.contracts![0] });
    expect(evaluateConformance(input)).toEqual(expect.objectContaining({
      verdict: "inconclusive",
      reasons: expect.arrayContaining(["Assertion contract IDs must be unique within a conformance evaluation."])
    }));
  });

  it("does not use missing artifacts or synthetic runs to establish conformance", () => {
    const input = boundResult();
    input.artifactValidation!.files = [];
    expect(evaluateConformance(input).verdict).toBe("inconclusive");
    const synthetic = boundResult();
    synthetic.provenance = "synthetic";
    expect(evaluateConformance(synthetic).verdict).toBe("inconclusive");

    const unknown = boundResult();
    unknown.provenance = "unknown";
    expect(evaluateConformance(unknown).verdict).toBe("inconclusive");

    const unmarked = boundResult();
    delete unmarked.provenance;
    expect(evaluateConformance(unmarked).verdict).toBe("inconclusive");
  });

  it("detects changed expectations independently of reporter pass status", () => {
    const input = boundResult();
    input.reporter!.assertions[0].expected = "rejected";
    expect(evaluateConformance(input).verdict).toBe("context-mismatch");
    input.reporter!.assertions[0].expected = "approved";
    input.contracts![0].expected = "rejected";
    expect(evaluateConformance(input).verdict).toBe("requirement-review");
  });
  it("requires a business oracle even when the caller says passed and strong", () => {
    expect(evaluateConformance({
      scenarioId: "scenario-order",
      executionEvidenceId: "evidence-1",
      status: "passed",
      assuranceLevel: "strong",
      provenance: "real-system",
      expectationRefs: ["requirement:order-status"],
      observationRefs: ["evidence/assertion.png"],
      executionRefs: ["evidence-1"]
    })).toEqual(expect.objectContaining({ verdict: "requirement-review" }));
  });

  it("fails closed on malformed runtime oracle operators and empty expected states", () => {
    const unsupported = boundResult();
    (unsupported.contracts![0].oracle as unknown as { operator: string }).operator = "contains";
    expect(evaluateConformance(unsupported)).toEqual(expect.objectContaining({ verdict: "requirement-review" }));

    const emptyExpected = boundResult();
    emptyExpected.contracts![0].oracle!.expected = " ";
    expect(evaluateConformance(emptyExpected)).toEqual(expect.objectContaining({ verdict: "requirement-review" }));

    const missingPrevious = boundResult();
    delete missingPrevious.contracts![0].oracle!.previous;
    expect(evaluateConformance(missingPrevious)).toEqual(expect.objectContaining({ verdict: "requirement-review" }));

    const malformedReferences = boundResult();
    (malformedReferences.contracts![0] as unknown as { requirementRefs: unknown }).requirementRefs = null;
    expect(evaluateConformance(malformedReferences)).toEqual(expect.objectContaining({ verdict: "requirement-review" }));

    const malformedExpectationRefs = boundResult();
    (malformedExpectationRefs as unknown as { expectationRefs: unknown }).expectationRefs = ["requirement:approval", 7];
    expect(evaluateConformance(malformedExpectationRefs)).toEqual(expect.objectContaining({ verdict: "inconclusive" }));

    const malformedReporter = boundResult();
    (malformedReporter.reporter as unknown as { assertions: unknown }).assertions = null;
    expect(evaluateConformance(malformedReporter)).toEqual(expect.objectContaining({ verdict: "inconclusive" }));

    const malformedAssertionEvidence = boundResult();
    (malformedAssertionEvidence.reporter!.assertions[0] as unknown as { evidenceRefs: unknown }).evidenceRefs = null;
    expect(evaluateConformance(malformedAssertionEvidence)).toEqual(expect.objectContaining({ verdict: "inconclusive" }));

    const malformedArtifactList = boundResult();
    (malformedArtifactList.artifactValidation as unknown as { files: unknown }).files = [null];
    expect(evaluateConformance(malformedArtifactList)).toEqual(expect.objectContaining({ verdict: "inconclusive" }));
  });

  it("does not turn a green limited run into a conformance claim", () => {
    expect(evaluateConformance({
      scenarioId: "scenario-order",
      executionEvidenceId: "evidence-2",
      status: "passed",
      assuranceLevel: "limited",
      expectationRefs: ["requirement:order-status"],
      observationRefs: [],
      executionRefs: ["evidence-2"]
    })).toEqual(expect.objectContaining({ verdict: "inconclusive" }));
  });

  it("does not turn a product bug label alone into a business conclusion", () => {
    expect(evaluateConformance({
      scenarioId: "scenario-order",
      executionEvidenceId: "evidence-3",
      status: "failed",
      assuranceLevel: "strong",
      diagnosisVerdict: "product_bug",
      expectationRefs: ["requirement:order-status"],
      observationRefs: ["evidence/assertion.png"],
      executionRefs: ["evidence-3"]
    })).toEqual(expect.objectContaining({ verdict: "inconclusive" }));
  });

  it("requires requirement review when the process passed without an oracle", () => {
    expect(evaluateConformance({
      scenarioId: "scenario-order",
      executionEvidenceId: "evidence-4",
      status: "passed",
      assuranceLevel: "none",
      provenance: "real-system",
      expectationRefs: [],
      observationRefs: [],
      executionRefs: ["evidence-4"]
    })).toEqual(expect.objectContaining({ verdict: "requirement-review" }));
  });

  it("does not conform when assertion status conflicts with the observed business value", () => {
    const input = boundResult();
    input.reporter!.assertions[0].status = "failed";
    expect(evaluateConformance(input).verdict).toBe("context-mismatch");

    input.reporter!.assertions[0].actual = "rejected";
    expect(evaluateConformance(input).verdict).toBe("nonconform");
  });

  it("does not trust caller-supplied strong assurance over an inconsistent Reporter", () => {
    const input = boundResult();
    input.reporter!.status = "failed";
    expect(evaluateConformance(input)).toEqual(expect.objectContaining({ verdict: "inconclusive" }));

    const weakContract = boundResult();
    weakContract.contracts![0].strength = "limited";
    expect(evaluateConformance(weakContract)).toEqual(expect.objectContaining({ verdict: "inconclusive" }));
  });

  it("evaluates conditional applicability from bound actual context instead of a boolean label", () => {
    const input = boundResult();
    input.contracts![0].oracle!.applicability = {
      mode: "conditional",
      combine: "all",
      conditions: [{ id: "employment-type", field: "employmentType", operator: "equals", expected: "intern" }]
    };
    input.reporter!.assertions[0].applicabilityObservations = [{
      conditionId: "employment-type",
      actual: "intern",
      evidenceRefs: ["actual.json"]
    }];
    expect(evaluateConformance(input).verdict).toBe("conform");

    input.reporter!.assertions[0].applicabilityObservations[0].actual = "formal";
    input.reporter!.assertions[0].status = "skipped";
    expect(evaluateConformance(input).verdict).toBe("not-applicable");
  });

  it("does not promote legacy or malformed applicability labels", () => {
    const legacy = boundResult();
    delete (legacy.contracts![0].oracle as unknown as { applicability?: unknown }).applicability;
    expect(evaluateConformance(legacy).verdict).toBe("requirement-review");

    const malformed = boundResult();
    malformed.contracts![0].oracle!.applicability = {
      mode: "conditional",
      combine: "all",
      conditions: []
    };
    expect(evaluateConformance(malformed).verdict).toBe("requirement-review");
  });

  it("requires every conditional applicability value to be hash-validated evidence", () => {
    const input = boundResult();
    input.contracts![0].oracle!.applicability = {
      mode: "conditional",
      combine: "all",
      conditions: [{ id: "employment-type", field: "employmentType", operator: "equals", expected: "intern" }]
    };
    input.reporter!.assertions[0].applicabilityObservations = [{
      conditionId: "employment-type",
      actual: "intern",
      evidenceRefs: ["unvalidated.json"]
    }];

    expect(evaluateConformance(input)).toEqual(expect.objectContaining({
      verdict: "inconclusive",
      reasons: expect.arrayContaining([expect.stringContaining("validated artifact")])
    }));
  });

  it("binds applicability and business entity references to the contract and reporter", () => {
    const unboundApplicability = boundResult();
    unboundApplicability.contracts![0].oracle!.applicabilityRefs = ["requirement:other"];
    expect(evaluateConformance(unboundApplicability).verdict).toBe("requirement-review");

    const wrongEntity = boundResult();
    wrongEntity.contracts![0].oracle!.entityReference = "order:expected";
    wrongEntity.reporter!.assertions[0].entityReference = "order:other";
    expect(evaluateConformance(wrongEntity).verdict).toBe("context-mismatch");
  });

  it("requires contract source and reporter observation refs in the conformance record", () => {
    const missingExpectation = boundResult();
    missingExpectation.expectationRefs = ["requirement:other"];
    expect(evaluateConformance(missingExpectation).verdict).toBe("requirement-review");

    const missingObservation = boundResult();
    missingObservation.observationRefs = ["different.json"];
    expect(evaluateConformance(missingObservation).verdict).toBe("inconclusive");

    const missingExecution = boundResult();
    missingExecution.executionRefs = ["another-evidence"];
    expect(evaluateConformance(missingExecution).verdict).toBe("inconclusive");
  });

  it("does not conform a mixed applicable and non-applicable contract set", () => {
    const input = boundResult();
    const skippedContract = { ...input.contracts![0], id: "conditional", stepId: "conditional-step" };
    skippedContract.oracle = {
      operator: "equals",
      expected: "approved",
      applicability: {
        mode: "conditional",
        combine: "all",
        conditions: [{ id: "is-intern", field: "employmentType", operator: "equals", expected: "intern" }]
      },
      applicabilityRefs: ["requirement:approval"]
    };
    input.contracts!.push(skippedContract);
    input.reporter!.total = 2;
    input.reporter!.passed = 1;
    input.reporter!.skipped = 1;
    input.reporter!.assertions.push({
      id: "conditional",
      stepId: "conditional-step",
      status: "skipped",
      evidenceRefs: [],
      applicabilityObservations: [{ conditionId: "is-intern", actual: "formal", evidenceRefs: ["actual.json"] }]
    });

    expect(evaluateConformance(input).verdict).toBe("inconclusive");
  });
});
