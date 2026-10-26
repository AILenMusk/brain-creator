import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ledger = readFileSync(join(process.cwd(), "docs/quality/trust-convergence.md"), "utf8");

function tableIds(section: string, header: string, nextHeading: string) {
  const start = section.indexOf(header);
  expect(start).toBeGreaterThanOrEqual(0);
  const end = section.indexOf(nextHeading, start);
  expect(end).toBeGreaterThan(start);
  return section.slice(start, end)
    .split(/\r?\n/)
    .map((line) => line.match(/^\|\s*`([^`]+)`\s*\|/))
    .filter((match): match is RegExpMatchArray => match !== null)
    .map((match) => match[1]!);
}

describe("trust convergence scenario denominator", () => {
  it("matches the approved 28 local-GHR outcomes and full 34-outcome inventory", () => {
    const start = ledger.indexOf("## Test5 Review Paths (User-Approved Local GHR Scope)");
    expect(start).toBeGreaterThanOrEqual(0);
    const end = ledger.indexOf("## 2026-10-21 Local Candidate Verification", start);
    expect(end).toBeGreaterThan(start);
    const scope = ledger.slice(start, end);

    const primaryIds = tableIds(scope, "| Draft ID |", "The full inventory now contains");
    const transitionIds = tableIds(scope, "| Candidate ID |", "The user has approved this local-GHR scope");
    const demandIds = primaryIds.filter((id) => /^GHR-REQ-/.test(id));
    const offerFormIds = primaryIds.filter((id) => /^GHR-OFFER-0[12]$/.test(id));
    const supportIds = primaryIds.filter((id) => /^(GHR-COMP|GHR-STAFF|GHR-PAY|GHR-QUERY)-/.test(id));
    const localOfferTransitionIds = ["GHR-OFFER-03a", "GHR-OFFER-03c", "GHR-OFFER-03d", "GHR-OFFER-03f", "GHR-OFFER-03k", "GHR-OFFER-03l"];
    const allOutcomeIds = [...demandIds, ...offerFormIds, ...transitionIds, ...supportIds];

    expect(demandIds).toHaveLength(15);
    expect(offerFormIds).toHaveLength(2);
    expect(transitionIds).toHaveLength(12);
    expect(supportIds).toHaveLength(5);
    expect(new Set(allOutcomeIds).size).toBe(34);
    expect(transitionIds.filter((id) => localOfferTransitionIds.includes(id))).toEqual(localOfferTransitionIds);
    expect(demandIds.length + offerFormIds.length + localOfferTransitionIds.length + supportIds.length).toBe(28);
    expect(scope).toContain("The current approved planning denominator is therefore 28 local-GHR candidate outcomes");
    expect(scope).toContain("leaving 28 candidate outcomes");

    const closeOutcomes = new Map<string, string>();
    for (const line of scope.split(/\r?\n/)) {
      const match = line.match(/^\|\s*`(GHR-REQ-06[a-h])`\s*\|\s*(.*?)\s*\|\s*(.*?)\s*\|$/);
      if (match) closeOutcomes.set(match[1]!, `${match[2]} ${match[3]}`);
    }
    expect(closeOutcomes.size).toBe(8);
    expect(closeOutcomes.get("GHR-REQ-06a")).toContain("`已接受offer` blocks direct closure");
    expect(closeOutcomes.get("GHR-REQ-06b")).toContain("`已发offer` blocks direct closure");
    expect(closeOutcomes.get("GHR-REQ-06c")).toContain("confirm the second close prompt");
    expect(closeOutcomes.get("GHR-REQ-06c")).toContain("Offer becomes `已废弃`");
    expect(closeOutcomes.get("GHR-REQ-06c")).toContain("demand becomes `已关闭`");
    expect(closeOutcomes.get("GHR-REQ-06c")).toContain("in-progress linked OA flow is voided");
    expect(closeOutcomes.get("GHR-REQ-06d")).toContain("confirm the second close prompt");
    expect(closeOutcomes.get("GHR-REQ-06d")).toContain("Offer becomes `已废弃`");
    expect(closeOutcomes.get("GHR-REQ-06d")).toContain("demand becomes `已关闭`");
    expect(closeOutcomes.get("GHR-REQ-06e")).toContain("cancel the second close prompt");
    expect(closeOutcomes.get("GHR-REQ-06e")).toContain("remain unchanged");
    expect(closeOutcomes.get("GHR-REQ-06f")).toContain("cancel the second close prompt");
    expect(closeOutcomes.get("GHR-REQ-06g")).toContain("`已发offer` blocks direct close");
    expect(closeOutcomes.get("GHR-REQ-06h")).toContain("`已发offer` blocks direct close");
  });
});
