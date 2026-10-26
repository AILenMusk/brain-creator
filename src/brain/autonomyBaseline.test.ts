import { describe, expect, it } from "vitest";
import { buildAutonomyBaselineReport } from "./autonomyBaseline.js";

describe("AutonomyBaselineReport", () => {
  it("labels deterministic scenario assurance checks as synthetic, not product measurements", () => {
    const report = buildAutonomyBaselineReport({
      generatedAt: "2026-08-30T00:00:00.000Z",
      seed: "brain-creator-l3-baseline"
    });

    expect(report.schemaVersion).toBe(22);
    expect(report.generatedAt).toBe("2026-08-30T00:00:00.000Z");
    expect(report.seed).toBe("brain-creator-l3-baseline");
    expect(report.metrics.requirementGolden.total).toBeGreaterThan(1);
    expect(report.metrics.requirementGolden.status).toBe("synthetic");
    expect(report.metrics.processModel.sourceKind).toBe("sanitized-synthetic");
    expect(report.metrics.requirementGolden.rate).toBeGreaterThanOrEqual(0);
    expect(report.metrics.processModel.total).toBe(1);
    expect(report.metrics.requirementHostHarness).toEqual(expect.objectContaining({
      status: "synthetic",
      sourceKind: "sanitized-synthetic",
      passed: 5,
      total: 5,
      rate: 1
    }));
    expect(report.metrics.scenarioDefectDetection).toEqual(expect.objectContaining({
      status: "synthetic",
      sourceKind: "sanitized-synthetic",
      total: expect.any(Number),
      rate: expect.any(Number),
      threshold: 0.85
    }));
    expect(report.metrics.scenarioDefectDetection.rate).toBeGreaterThanOrEqual(0.85);
    expect(report.metrics.scenarioDefectDetection.notes).toContain(
      "Synthetic PR E scenario portfolio: mutation detection is scored; historical Bug replay remains separate."
    );
    expect(report.openCapabilityGaps).toContain(
      "Requirement Host Harness structure is scored from synthetic fixtures; semantic Critic quality still needs a larger real defect corpus"
    );
    expect(report.l3GoldenCorpus.sampleCount).toBe(7);
    expect(report.releaseGate.status).toBe("blocked");
    expect(report.releaseGate.blockers).toEqual(expect.arrayContaining([
      expect.stringContaining("Real-system")
    ]));
    expect(report.openCapabilityGaps).toEqual(expect.arrayContaining([
      expect.stringContaining("Historical Bug replay")
    ]));
  });
});
