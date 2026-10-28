# Test5 GHR 28-Outcome Mapping Review — 2026-10-28

## Scope and result

This review compares the user-frozen 28-outcome denominator in `test5-ghr-outcome-mapping-2026-10-28.csv` with the current Brain Creator v4 draft (`requirementSet_2wfobw7n`). It does not change the CSV, approve the baseline, create a Trial, or authorize Test5 business writes.

**Result: 0/28 finalized CSV mappings.** The current v4 draft has 11 active scenarios: four route prefixes, three demand-close outcomes, and four separate grade/internship/HSSC/callback dispositions. A single scenario may cover multiple frozen outcomes when each outcome's fixture variant, applicability, Oracle, and evidence are explicitly represented; the CSV stores one scenario link per outcome and permits repeated scenario IDs. Six close outcomes have plausible candidate links to two close templates, but they are not finalized because state-specific fixtures, structured Oracles, and independent postcondition reads are missing. The callback scenario is not one of the frozen 28 outcomes. The CSV remains unchanged at `unmapped / not_executed` for all 28 rows; blocked and not-executed outcomes remain in the denominator.

## Outcome-by-outcome review

| Frozen outcome | Closest current v4 draft | Mapping decision | Missing coverage for a safe outcome-specific link |
|---|---|---|---|
| `GHR-REQ-01` | `scenario_eb5dfe80e2f3521d` (no-Offer close) | Candidate is insufficient; no mapping | This scenario covers the close action and terminal state only; it does not cover create → submit → full route → approve → close and checkpoint reads. |
| `GHR-REQ-02` | `scenario_c06df2baed32d118` (intern branch) | Candidate is insufficient; no mapping | The scenario records an unresolved intern branch; it does not cover no-quota creation, submission, approval, or position/grade checks. |
| `GHR-REQ-03a` | — | No mapping | No replacement-demand missing-substitute scenario or unchanged-state Oracle. |
| `GHR-REQ-03b` | — | No mapping | No eligible synthetic-substitute fixture or successful replacement-submit scenario. |
| `GHR-REQ-04a` | — | No mapping | No approver rejection-to-requester scenario or list/detail/history Oracle. |
| `GHR-REQ-04b` | — | No mapping | No requester withdrawal scenario or list/detail/history Oracle. |
| `GHR-REQ-05` | — | No mapping | No demand-process void scenario; the close scenarios must not be reused for the distinct `已废弃` terminal. |
| `GHR-REQ-06a` | `scenario_a5ebcedca0bf781b` (accepted/sent Offer blocks close) | Candidate link; not finalized | Keep a fixture with an accepted Offer and independently verify the close action is blocked and business state is unchanged. |
| `GHR-REQ-06b` | `scenario_a5ebcedca0bf781b` (accepted/sent Offer blocks close) | Candidate link; not finalized | Keep a separate sent-Offer fixture and independently verify the close action is blocked and business state is unchanged. |
| `GHR-REQ-06c` | `scenario_6650a81e26731bff` (other Offer state requires confirmation) | Candidate link; not finalized | Preserve the approval-in-progress fixture and independently verify demand, Offer, and OA state after the confirmation path. |
| `GHR-REQ-06d` | `scenario_6650a81e26731bff` (other Offer state requires confirmation) | Candidate link; not finalized | Preserve the to-be-sent fixture and independently verify demand, Offer, and OA state after the confirmation path. |
| `GHR-REQ-06e` | — | No mapping | No cancel-confirmation scenario with before/after checks proving demand, Offer, and OA remain unchanged. |
| `GHR-REQ-06f` | — | No mapping | No cancel-confirmation scenario for the to-be-sent Offer variant. |
| `GHR-REQ-06g` | `scenario_a5ebcedca0bf781b` (accepted/sent Offer blocks close) | Candidate link; not finalized | The mixed sent + approval-in-progress fixture must be separately prepared and read back; any `已发offer` blocks direct close. |
| `GHR-REQ-06h` | `scenario_a5ebcedca0bf781b` (accepted/sent Offer blocks close) | Candidate link; not finalized | The mixed sent + to-be-sent fixture must be separately prepared and read back; any `已发offer` blocks direct close. |
| `GHR-OFFER-01` | `scenario_ed2211c4cac07209` (callback mapping) | No mapping | Callback label mapping is not the formal Offer create/submit/approve route, required-field coverage, or target-state verification. |
| `GHR-OFFER-02` | — | No mapping | No intern Offer form/approval scenario or intern-specific field Oracle. |
| `GHR-OFFER-03a` | — | No mapping | No scenario for `待发offer → 已发offer` and independent status verification. |
| `GHR-OFFER-03c` | — | No mapping | No scenario for `待发offer → 已拒绝offer` and independent status verification. |
| `GHR-OFFER-03d` | — | No mapping | No scenario for `已发offer → 待发offer` and independent status verification. |
| `GHR-OFFER-03f` | — | No mapping | No scenario for `已发offer → 已拒绝offer` and independent status verification. |
| `GHR-OFFER-03k` | — | No mapping | No rejected-source transition scenario or quota-guard Oracle. |
| `GHR-OFFER-03l` | — | No mapping | No rejected-source transition scenario for the second fixed edge or quota-guard Oracle. |
| `GHR-COMP-01` | — | No mapping | No read-only compensation field/configuration/export scenario or confirmed field manifest. |
| `GHR-STAFF-01` | `scenario_696db77c8bd2de0d` (HSSC not executed) | No mapping | This scenario records that the HSSC branch is not executed; it does not test staffing detail form and legacy workflow migration. |
| `GHR-PAY-01` | — | No mapping | No pay-item query scenario, OEHR access, or independent schema/display Oracle. |
| `GHR-QUERY-01` | — | No mapping | No Trial-owned unique demand/Offer fixture or list/detail/history consistency scenario. |
| `GHR-QUERY-02` | — | No mapping | No Trial-owned filtered-export scenario or approved field manifest. |

## Draft mapping limits and next step

The current 11 scenarios support only six plausible close-rule links, all still blocked by missing fixtures and evidence; the other 22 frozen outcomes have no suitable current scenario. Do not force those outcomes onto broad route, callback, or unexecuted HSSC/grade records. The next design pass should add outcome-specific blocked/not-executed scenarios where the approved source defines the rule, and record an explicit unresolved gap where it does not. Reuse a scenario ID across CSV rows only when each row's exact fixture variant, applicability, expected comparison, and independent read are preserved. Missing fixtures, bindings, role evidence, external system access, and postcondition checks remain visible blockers; a draft association is not an approved mapping or execution result.

Keep the CSV unchanged at 0/28 mapped and 0/28 independently evidenced until the revised scenario set and row-level associations are reviewed. The fixed denominator remains 28.
