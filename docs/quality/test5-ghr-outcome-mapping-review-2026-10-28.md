# Test5 GHR 28-Outcome Mapping Review — 2026-10-28

## Scope and result

This review compares the user-frozen 28-outcome denominator in `test5-ghr-outcome-mapping-2026-10-28.csv` with the current Brain Creator v6 draft (`requirementSet_nixk1cms`). It does not change the CSV, approve the baseline, create a Trial, or authorize Test5 business writes.

**Result: 0/28 one-to-one scenario mappings.** The current v6 draft has 11 active scenarios: four route prefixes, three general demand-close outcomes, and four grade/internship/HSSC/callback candidates. Some are topically related to fixed outcomes, but none is specific enough to assign uniquely under the one-to-one mapping gate. The callback candidate `GHR-CALLBACK-01` is not one of the frozen 28 outcomes. All 28 CSV rows remain `unmapped / not_executed`, and all blocked or unexecuted outcomes remain in the denominator.

## Outcome-by-outcome review

| Frozen outcome | Closest v6 draft | Mapping decision | Missing coverage for a one-to-one link |
|---|---|---|---|
| `GHR-REQ-01` | GHR-CLOSE-01 | No mapping | CLOSE-01 covers the close action and terminal state only; no single draft scenario covers create → submit → route → approve → close and checkpoint reads. |
| `GHR-REQ-02` | GHR-ROUTE-07 | No mapping | ROUTE-07 only records an unresolved intern approval branch; it does not cover no-quota creation, submission, approval, or position/grade checks. |
| `GHR-REQ-03a` | — | No mapping | No replacement-demand missing-substitute scenario or unchanged-state Oracle. |
| `GHR-REQ-03b` | — | No mapping | No eligible synthetic-substitute fixture or successful replacement-submit scenario. |
| `GHR-REQ-04a` | — | No mapping | No approver rejection-to-requester scenario or list/detail/history Oracle. |
| `GHR-REQ-04b` | — | No mapping | No requester withdrawal scenario or list/detail/history Oracle. |
| `GHR-REQ-05` | — | No mapping | No demand-process void scenario; the close scenarios must not be reused for the distinct `已废弃` terminal. |
| `GHR-REQ-06a` | GHR-CLOSE-02 | No mapping | CLOSE-02 groups accepted/sent states; no unique scenario and independent Oracle for the accepted-Offer variant. |
| `GHR-REQ-06b` | GHR-CLOSE-02 | No mapping | CLOSE-02 groups accepted/sent states; no unique scenario and independent Oracle for the sent-Offer variant. |
| `GHR-REQ-06c` | GHR-CLOSE-03 | No mapping | CLOSE-03 generalizes pending Offer states; no unique approval-in-progress variant or independent Offer/OA postconditions. |
| `GHR-REQ-06d` | GHR-CLOSE-03 | No mapping | CLOSE-03 generalizes pending Offer states; no unique to-be-sent variant or independent Offer/OA postconditions. |
| `GHR-REQ-06e` | — | No mapping | No cancel-confirmation scenario with before/after checks proving demand, Offer, and OA remain unchanged. |
| `GHR-REQ-06f` | — | No mapping | No cancel-confirmation scenario for the to-be-sent Offer variant. |
| `GHR-REQ-06g` | GHR-CLOSE-02 | No mapping | The fixed mixed sent + approval-in-progress fixture is not represented as its own scenario or Oracle. |
| `GHR-REQ-06h` | GHR-CLOSE-02 | No mapping | The fixed mixed sent + to-be-sent fixture is not represented as its own scenario or Oracle. |
| `GHR-OFFER-01` | GHR-CALLBACK-01 | No mapping | Callback label mapping is not the formal Offer create/submit/approve route, required-field coverage, or target-state verification. |
| `GHR-OFFER-02` | — | No mapping | No intern Offer form/approval scenario or intern-specific field Oracle. |
| `GHR-OFFER-03a` | — | No mapping | No scenario for `待发offer → 已发offer` and independent status verification. |
| `GHR-OFFER-03c` | — | No mapping | No scenario for `待发offer → 已拒绝offer` and independent status verification. |
| `GHR-OFFER-03d` | — | No mapping | No scenario for `已发offer → 待发offer` and independent status verification. |
| `GHR-OFFER-03f` | — | No mapping | No scenario for `已发offer → 已拒绝offer` and independent status verification. |
| `GHR-OFFER-03k` | — | No mapping | No rejected-source transition scenario or quota-guard Oracle. |
| `GHR-OFFER-03l` | — | No mapping | No rejected-source transition scenario for the second fixed edge or quota-guard Oracle. |
| `GHR-COMP-01` | — | No mapping | No read-only compensation field/configuration/export scenario or confirmed field manifest. |
| `GHR-STAFF-01` | GHR-ROUTE-06 | No mapping | ROUTE-06 only marks the HSSC branch unexecuted; it does not test staffing detail form and legacy workflow migration. |
| `GHR-PAY-01` | — | No mapping | No pay-item query scenario, OEHR access, or independent schema/display Oracle. |
| `GHR-QUERY-01` | — | No mapping | No Trial-owned unique demand/Offer fixture or list/detail/history consistency scenario. |
| `GHR-QUERY-02` | — | No mapping | No Trial-owned filtered-export scenario or approved field manifest. |

## Decision needed before mapping work

The current 11 scenarios cannot satisfy the fixed 28-outcome one-to-one mapping without either mislabeling broad scenarios or adding outcome-specific draft scenarios. The proposed next step is to generate a separate blocked/not-executed-aware draft scenario for each frozen outcome, preserve the current 11 records as design history or reusable components, and only attach a fixed outcome ID when its applicability and source-backed Oracle are explicit. Missing fixtures, bindings, role evidence, external system access, and independent postcondition checks would remain visible blockers; generation would not count as execution or approval.

Until that scenario expansion is accepted and generated through Brain Creator, keep the CSV unchanged at 0/28 mapped and 0/28 independently evidenced.
