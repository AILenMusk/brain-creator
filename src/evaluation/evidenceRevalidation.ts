import type { ExecutionEvidence, RunLedgerEntry } from "../domain/types.js";
import { validateExecutionArtifacts } from "../execution/artifactValidation.js";

export type RevalidatedExecutionEvidence = {
  evidenceId: string;
  validation: NonNullable<ExecutionEvidence["artifactValidation"]>;
};

export type RevalidatedRunLedgerAction = {
  entryId: string;
  validation: {
    status: "valid" | "invalid";
    files: Array<{ path: string; sha256: string }>;
    reasons: string[];
  };
};

export async function revalidateExecutionEvidence(
  root: string,
  evidence: ExecutionEvidence[]
): Promise<RevalidatedExecutionEvidence[]> {
  const results: RevalidatedExecutionEvidence[] = [];
  for (const item of evidence) {
    const stored = item.artifactValidation;
    if (stored?.status !== "valid") {
      results.push({
        evidenceId: item.id,
        validation: stored ?? { status: "invalid", files: [], reasons: ["No stored artifact validation is available."] }
      });
      continue;
    }
    const expectedHashes = Object.fromEntries(stored.files.map((file) => [file.path, file.sha256]));
    const references = new Set([
      ...stored.files.map((file) => file.path),
      ...(item.reporterResult?.attachments ?? []),
      ...(item.reporterResult?.assertions ?? []).flatMap((assertion) => assertion.evidenceRefs),
      ...(item.reporterResult?.steps ?? []).flatMap((step) => [...step.evidenceRefs, ...(step.traceRefs ?? [])]),
      ...item.tracePaths
    ]);
    const unpinnedReferences = [...references].filter((reference) => !expectedHashes[reference]);
    const validation = await validateExecutionArtifacts(root, [...references], expectedHashes);
    if (unpinnedReferences.length > 0) {
      validation.status = "invalid";
      validation.reasons.push(...unpinnedReferences.map((reference) => `Artifact ${reference} has no stored validation hash.`));
    }
    results.push({ evidenceId: item.id, validation });
  }
  return results;
}

export async function revalidateRunLedgerActionEvidence(
  root: string,
  entries: RunLedgerEntry[]
): Promise<RevalidatedRunLedgerAction[]> {
  const results: RevalidatedRunLedgerAction[] = [];
  for (const entry of entries) {
    const artifacts = entry.actionEvidenceArtifacts ?? [];
    const references = artifacts.map((artifact) => artifact.path);
    const validation = entry.actionPhase === "reconciled" && entry.actionEvidenceRefs?.length && artifacts.length > 0
      ? await validateExecutionArtifacts(
        root,
        references,
        Object.fromEntries(artifacts.map((artifact) => [artifact.path, artifact.sha256]))
      )
      : { status: "invalid" as const, files: [], reasons: ["Reconciled action has no hash-bound evidence set."] };
    if (validation.status === "valid" && validation.files.length !== artifacts.length) {
      validation.status = "invalid";
      validation.reasons.push("Reconciled action evidence contains duplicate or unresolved artifact paths.");
    }
    results.push({ entryId: entry.id, validation });
  }
  return results;
}
