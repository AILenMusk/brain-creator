# Testdata Providers

Brain Creator keeps test data planning and system operations separate. The Testdata Brain owns entity identity, dependencies, leases, source evidence, and cleanup state; a system-specific provider performs the actual lookup, creation, transition, verification, and cleanup.

## Provider Contract

An embedded integration can pass a provider when creating the MCP context:

```ts
const provider: TestDataProvider = {
  name: "orders-system",
  supports: (input) => input.systemId === "system-orders",
  lookup: async (input) => lookupOrder(input),
  create: async (input) => createOrder(input),
  transition: async (input) => transitionOrder(input),
  verify: async (input) => verifyOrder(input),
  cleanup: async (input) => deleteOrRestoreOrder(input)
};
```

Each method returns a stable reference, optional non-secret values, a typed lifecycle status, and source evidence. The provider must scope every operation to the requested `systemId`; cross-system references are rejected by Testdata Brain.

For the standalone MCP process, configure a reviewed workspace-local adapter module with `BRAIN_CREATOR_TESTDATA_ADAPTER_MODULE`. It must export a non-empty `testDataProviders` array whose providers implement the contract above; it may also export `verifyNoEffect(input)` for independent read-only reconciliation of uncertain writes. The adapter module path must resolve inside the Brain Creator workspace, and exactly one provider must support a requested system. Loading the module executes its code in the MCP process. `bc_status` reports `runtimeCapabilities.testDataProvider` as `configured`, `not-configured`, or `synthetic-test-only`. No target provider is enabled by default in production; the in-memory provider exists only in a `NODE_ENV=test` process and cannot establish evidence about an external system.

For `lookup`, return all matching candidates when the query is not unique. Testdata Brain accepts a single result and rejects multiple results rather than silently selecting the first; an empty result remains a lookup miss.

## Lifecycle

1. Brain Creator plans dependencies and prefers lookup/reuse.
2. Before cleanup, the Host Agent sends the returned advance notice to the user and acknowledges it with `bc_prepare action=confirm-cleanup-notice` and its `cleanupNoticeSha256`; the cleanup task cannot be marked sent until that acknowledgment succeeds. Before other external writes, the Host Agent marks the task sent with `bc_prepare action=mark-test-data-sent`.
3. The provider looks up or creates an entity only when the approved data plan allows it; transitions such as `submitted` or `approved` update the same entity reference.
4. After an uncertain response or interrupted session, the Host Agent performs a read-only lookup before retrying. Reconciliation is operation-specific: a create may retry only when the exact query is absent; a cleanup may retry only when exactly one matching entity is still present. If the cleanup entity is absent, Brain Creator records the cleanup as already applied, releases its lease, and advances without dispatching another cleanup. The configured target-backed `TestDataNoEffectVerifier` must return evidence references plus readable workspace artifacts with SHA-256 hashes; Brain Creator reopens and rehashes each artifact before re-arming or completing the operation. `evidenceRefs` and `sourceRefs` without those artifacts cannot authorize a retry or completion. If no verifier is configured or the query is unavailable/ambiguous, leave the task blocked for recovery.
5. Verification records evidence without replacing the requirement expectation. Created data receives a lease and must be cleaned up with `delete-created` or `restore`.
6. Cleanup marks the entity released; the Suite/control plane records a typed Gap when cleanup fails. Uncertain cleanup is also reconciled read-only before another attempt.

Each observation artifact must be JSON with `schemaVersion: 1`, `type: "testdata-no-effect-observation"`, the exact `systemId` and query, a `result` matching the target lookup, provider identity, and the same `checkedAt` returned by the verifier. `absent` requires `matchCount: 0`; `present` requires exactly one match and `reference` equal to the queried lease reference. Brain Creator checks these fields against the task and verifier response as well as rehashing the file.

The in-memory provider is only a deterministic test fixture. For a real system, implement the provider and target-backed no-effect verifier in its configured adapter, returning artifact paths relative to the Brain Creator `.brain-creator` runtime directory and their SHA-256 hashes, or leave uncertain writes blocked until a verifier is available. Host-supplied references alone are not independent verification. The CI/Suite control plane owns cleanup failure classification and Gap creation. Credentials never belong in provider results, generated tests, or reports.

## CI Runner

Use the consolidated CLI from cron, GitHub Actions, Jenkins, or another scheduler:

```bash
npx brain-creator runner run --owner ci --project knowledge-orders --lease-ms 300000 --json
```

Exit code `0` means no due run or completion, `1` means failed/blocked/partial, and `2` means a resumable wait. The lease is persisted in the repository so a second scheduler cannot claim an active run.

The repository includes a copyable [GitHub Actions example](../examples/github-actions/brain-creator-runner.yml). Configure a non-interactive Agent provider and its secrets in the target test repository before enabling the scheduled trigger; the example is documentation only and is not enabled by Brain Creator itself.
