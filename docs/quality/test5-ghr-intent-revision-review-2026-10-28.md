# Test5 GHR Intent Revision Review — 2026-10-28

## Purpose and evidence boundary

This review addresses the user's request to revise the original 37 TestIntents and 11 BusinessScenarios before beginning the separate 28-outcome mapping. It audits each original TestIntent and records whether its content belongs in an active TestIntent, shared scope/Oracle context, or an explicit blocked/unexecuted path.

The original draft is `requirementSet_oeesilyq` v1 (`superseded`, 37 draft intents, 11 scenarios, 3 data profiles). `requirementSet_pdqtx6ir` v2 and `requirementSet_ly8t58rl` v4 remain historical drafts. The first complete-path candidate, `requirementSet_nixk1cms` v6, is also historical and superseded by the current revision below. The current candidate is `requirementSet_2wfobw7n` v4 (`draft`), from `requirementSource_u8iwcdvf` revision 4 with content hash `11a1c65d64c4b8140f58f4b11e68ce7bae12c29da485e128e53541819cddb577`. It contains 11 active draft TestIntents and 11 active draft BusinessScenarios, paired one-to-one. All 11 scenarios have blocked data plans with no attached profiles; no Test5 data was provisioned. This matrix is a design revision audit, not a 28-outcome mapping, baseline approval, execution result, or authorization to write Test5 business data. A separate draft source was also created when an earlier refresh used slash-normalized path text; it is not the selected source or Trial baseline.

## Disposition of the 37 original TestIntents

| # | v1 intent ID | Original content | Revision disposition | Current v4 destination / remaining gap |
|---:|---|---|---|---|
| 1 | `intent_ovid7n3s` | Local GHR scope and diagram boundary | Keep as shared scope metadata; remove as executable test | Shared source context for all 11 current scenarios; no active TestIntent |
| 2 | `intent_3cxsphum` | HSSC excluded; process administrator excluded | Keep both scope decisions; retain HSSC outcome as not-executed | `intent_neezo9w2` / `scenario_696db77c8bd2de0d`; process administrator excluded |
| 3 | `intent_c10cnhol` | Active Test5 Proc000019 v9 is the selected route Oracle | Keep as shared route precondition and user-attested version binding | Four route scenarios `scenario_fc19e4c651fa7417`, `scenario_fb8dfabf94021634`, `scenario_e903e82f341dfa44`, `scenario_545cc8faabdfa516`; no branch execution implied |
| 4 | `intent_c9e5na10` | HRBP manager, intern/default, HRBP lead, CHO appear later in the route | Keep downstream nodes out of passing prefixes; preserve the intern case separately as blocked | `intent_9vuroo5a` / `scenario_c06df2baed32d118` is blocked; later route remains unverified |
| 5 | `intent_j6t5mwr1` | Unmapped grade conditions `<2-1`, `<=2-3`, `>2-3`, `>3-3` | Retain all affected outcomes as skipped/not-executed per the user's explicit decision; later read-only label mapping does not make existing options test data | `intent_krvywvao` / `scenario_34e8a82141a59af0` |
| 6 | `intent_w5o5nb1k` | `>3-3` to CEO and process end | Retain as skipped/not-executed per the user's decision; the grade condition label was later mapped but the branch remains deferred | `intent_krvywvao` / `scenario_34e8a82141a59af0` |
| 7 | `intent_vj7d2o63` | `orgLevel` 2/3 versus default department route | Split the two outcomes; keep each next-actor assertion separate | `intent_gymohswk`, `intent_3z3sqen4`, `intent_ju1cieuo`, `intent_biirv9fe`; four route scenarios |
| 8 | `intent_579posqm` | Overseas HRBP versus domestic default route | Split the two outcomes; keep each next-actor assertion separate | Same four route scenarios, crossed with `orgLevel` conditions |
| 9 | `intent_yblcuxed` | Accepted/sent Offer blocks close; other associated states confirm | Split into the three distinct Offer-state rules, keeping no-associated-Offer close separate | `intent_0yx5xm9s`, `intent_5djtbb0u`, `intent_od4nmvm7`; scenarios `scenario_eb5dfe80e2f3521d`, `scenario_a5ebcedca0bf781b`, `scenario_6650a81e26731bff` |
| 10 | `intent_p0876bet` | Close Oracle needs independent target evidence | Keep as a verification constraint, not a test case | Applies to the three close scenarios above; all assertions remain unverified |
| 11 | `intent_5zo2ti0m` | Successful demand close becomes `已关闭`; no inferred Offer/OA change | Use as the demand-state postcondition for allowed close paths | `intent_0yx5xm9s` / `scenario_eb5dfe80e2f3521d` and `intent_od4nmvm7` / `scenario_6650a81e26731bff` |
| 12 | `intent_lwucnblm` | Authorized operations and advance cleanup notice | Keep as execution boundary and cleanup policy | Shared scope constraint; no active TestIntent or Trial data |
| 13 | `intent_zkhgpuc2` | Broad cross-role route journey spanning all branches | Replace the mutually exclusive combined path with ordered, branch-specific prefixes | Four route scenarios end at the first department approver; later chain remains unverified |
| 14 | `intent_5vzxooij` | Broad cross-role close journey | Split by Offer state and close outcome | The three separate close scenarios above |
| 15 | `intent_2causjsi` | Attempt close, inspect Offer state, block or confirm | Split by exact state predicate; no associated Offer uses the direct-close rule, while other associated states require confirmation | The three separate close scenarios above |
| 16 | `intent_nnt1mr8p` | Second-level department lead to HRBP manager | Retain as a downstream step; the user-deferred grade branch is not executed | No current executable scenario past first department approver; downstream route remains unverified |
| 17 | `intent_f451mwlw` | Start demand and evaluate region route | Use as the start of the overseas/domestic branch paths | Four route scenarios above |
| 18 | `intent_nku2r45s` | Offer-state rule followed by demand closed | Use the closed state only for paths where close is permitted and confirmed | No-Offer close and other-state confirmed close; accepted/sent Offer scenario must not expect `已关闭` |
| 19 | `intent_e2rl8k3y` | Unmapped `<=2-3` to second-level lead | Retain as not-executed per the user's branch-skip decision; do not infer a hit from canvas visibility or option labels | `intent_krvywvao` / `scenario_34e8a82141a59af0` |
| 20 | `intent_lys1dxlb` | Unmapped `>3-3` to process end | Retain as not-executed per the user's branch-skip decision | `intent_krvywvao` / `scenario_34e8a82141a59af0` |
| 21 | `intent_ae82y3uk` | Unmapped `>3-3` to CEO | Retain as not-executed per the user's branch-skip decision | `intent_krvywvao` / `scenario_34e8a82141a59af0` |
| 22 | `intent_baqbwgap` | Third-level department lead to HRBP manager | Retain as a downstream route step; do not claim path completion | No current scenario covers this later step; downstream route remains unverified |
| 23 | `intent_beteu7cs` | Intern/default and `>2-3` toward HRBP lead | Split the explicit internship predicate from the grade branch; retain the latter as not-executed per user decision | `intent_9vuroo5a` / `scenario_c06df2baed32d118` blocked; grade branch `intent_krvywvao` / `scenario_34e8a82141a59af0` not-executed |
| 24 | `intent_5j62yh7l` | Fourth-level department lead to unmapped grade/personnel branch | Keep only as an unexecuted boundary per the user's grade-branch deferral; do not label the step passed | `intent_krvywvao` / `scenario_34e8a82141a59af0`; downstream outcomes stay in denominator |
| 25 | `intent_o3oi3j6p` | Demand department lead to unmapped grade/personnel branch | Keep only as an unexecuted boundary per the user's grade-branch deferral | `intent_krvywvao` / `scenario_34e8a82141a59af0` |
| 26 | `intent_xhov83bo` | Unmapped grade condition to nested `<=2-3` | Retain as not-executed per the user's branch-skip decision | `intent_krvywvao` / `scenario_34e8a82141a59af0` |
| 27 | `intent_vic2koq0` | Unmapped grade/personnel condition to third-level lead | Retain as not-executed per the user's branch-skip decision | `intent_krvywvao` / `scenario_34e8a82141a59af0` |
| 28 | `intent_cks0cjkr` | CEO to process end | Retain as not-executed per the user's branch-skip decision; no requirement to re-map the displayed condition | `intent_krvywvao` / `scenario_34e8a82141a59af0` |
| 29 | `intent_qyjkes9b` | CHO to nested `>3-3` | Retain as not-executed per the user's branch-skip decision | `intent_krvywvao` / `scenario_34e8a82141a59af0` |
| 30 | `intent_czetarmf` | HRBP lead to CHO | Keep as a downstream step, not a standalone pass | No current scenario covers this later step; only claim after a verified eligible route |
| 31 | `intent_ca80qvkk` | HRBP manager to intern/default and `>2-3` condition | Split the internship branch from the grade branch; preserve the fixed denominator for the user's deferred grade outcomes | Internship `intent_9vuroo5a` blocked; grade `intent_krvywvao` not-executed |
| 32 | `intent_ztgtlzam` | HRBP to HRBP_TA | Use as a step in the overseas path; the domestic default path starts at HRBP_TA | Overseas scenarios `scenario_fc19e4c651fa7417` / `scenario_fb8dfabf94021634`; domestic scenarios start at HRBP_TA |
| 33 | `intent_hlleg6vz` | HRBP_TA to `orgLevel` branch | Use as the decision point preceding the two department paths | All four route scenarios above |
| 34 | `intent_ois68f24` | Default department branch to fourth-level lead | Keep as a positive branch assertion | `intent_3z3sqen4` / `scenario_fb8dfabf94021634` and `intent_biirv9fe` / `scenario_545cc8faabdfa516` |
| 35 | `intent_wtw3orxy` | `orgLevel` 2/3 to demand department lead | Keep as a positive branch assertion | `intent_gymohswk` / `scenario_fc19e4c651fa7417` and `intent_ju1cieuo` / `scenario_e903e82f341dfa44` |
| 36 | `intent_85kuafrj` | Overseas branch to HRBP | Keep as a positive branch assertion | Overseas scenarios `scenario_fc19e4c651fa7417` and `scenario_fb8dfabf94021634` |
| 37 | `intent_1jso11kw` | Domestic default branch to HRBP_TA | Keep as a positive branch assertion | Domestic scenarios `scenario_e903e82f341dfa44` and `scenario_545cc8faabdfa516` |

## Acceptance of this revision

- The v1 draft had 37 intents because it mixed scope/Oracle context with generated adjacent-edge assertions. The 37 original IDs above now each have a documented disposition. Scope and Oracle context remain shared requirements; adjacent edges are composed into path-level scenarios; mutually exclusive conditions are separated; user-deferred grade and HSSC outcomes stay visible as not-executed.
- The historical v6 design had four mutually exclusive route prefixes (overseas/domestic crossed with `orgLevel` 2/3/default), three close outcomes, and separate grade, internship, HSSC, and callback candidates. The current v4 revision below replaces its intent/scenario IDs and fixes the grade-skip wording using the later read-only option mapping. Route prefixes still stop at the first department approver; later routing is not represented as passed.
- Facade Scenario Assurance assessed the historical v6 set as **11 blocked / 0 pass**. The current v4 assessment is recorded separately below. No scenario has a verified target-system postcondition. This is draft readiness, not an executed scenario result.
- No `GHR-*` outcome mapping has been performed; the fixed 28-outcome denominator is unchanged. The RequirementSet remains `draft`; no baseline approval, EvaluationTrial, Test5 write, or cleanup occurred.

## Open path question

The observed current-route transcription shows `personnelType == "2"` at the HRBP-manager branch, but the captured evidence does not identify the expected next approver or terminal route for an intern. The process grade IDs were later matched to labels in the then-current Test5 option list, but the user's decision to skip those grade branches remains in force. The latest draft keeps a separate blocked internship scenario and does not merge it into the grade skip. Route scenarios remain prefixes and cannot claim the later HRBP manager/HRBP lead/CHO/CEO path as executed.

## Historical Brain Creator draft: v6, 18 active TestIntents / 11 scenarios (superseded)

The historical v6 records were generated through the candidate-local Brain Creator Facade after the path-generation change. Its 18 TestIntents and 11 BusinessScenarios were `draft`; path-level intents carried selected transition IDs and route conditions. These IDs are retained for audit only. The v1 IDs above are original history, and the active v4 IDs are listed separately below.

| # | Current scenario ID | Draft intent IDs | Candidate coverage and disposition | Source refs |
|---:|---|---|---|---|
| 1 | `scenario_b89e454377ef769b` | `intent_pdoqc5pk`, `intent_cdo4ynri` | GHR-ROUTE-01: Overseas + `orgLevel` 2/3 → department lead | lines 62–65 |
| 2 | `scenario_4edf2753aa3d24e2` | `intent_21g85le4`, `intent_v1rpsawh` | GHR-ROUTE-02: Overseas + `orgLevel` default → fourth-level department lead | lines 62–65 |
| 3 | `scenario_a7837aff7be3b123` | `intent_sjjc2fo0`, `intent_rhb1jxo4` | GHR-ROUTE-03: Domestic default + `orgLevel` 2/3 → department lead | lines 62–65 |
| 4 | `scenario_38d37da3deaee45e` | `intent_p9xjyte9`, `intent_564zqaup` | GHR-ROUTE-04: Domestic default + `orgLevel` default → fourth-level department lead | lines 62–65 |
| 5 | `scenario_bfbae5e15453fa9c` | `intent_f5j1n0tq`, `intent_d1mvucbx` | GHR-CLOSE-01: No linked Offer; direct close only if the row action exists; independently read demand `已关闭` | lines 50–51, 66 |
| 6 | `scenario_a2e7ecb724c68073` | `intent_rbfdgug8`, `intent_npzw68x1` | GHR-CLOSE-02: Any accepted/sent linked Offer blocks direct close; each state variant needs separate evidence | lines 52, 67 |
| 7 | `scenario_3f81d19fc15e4327` | `intent_r32dd36s`, `intent_ld61zqp7` | GHR-CLOSE-03: Other linked Offer states require a second confirmation; independently verify demand `已关闭` | lines 50–52, 54, 68 |
| 8 | `scenario_3677c2ab20a8ca64` | `intent_ikxmlixr` | GHR-ROUTE-05: Grade-ID branches not executed; retain all related outcomes in the fixed denominator | lines 19, 30–32, 40, 69 |
| 9 | `scenario_1fe6f183e2a2042c` | `intent_26rerryj` | GHR-ROUTE-07: `personnelType == 2` internship path blocked until the next actor and terminal are defined | lines 30–31, 70 |
| 10 | `scenario_26d94fc0a62b4d59` | `intent_hc49vou0` | GHR-ROUTE-06: HSSC system-administrator branch not executed; process-administrator branch excluded | lines 41–42, 71 |
| 11 | `scenario_830e5cb904322e23` | `intent_1dobmcqo` | GHR-CALLBACK-01: Candidate callback mapping `已接收` → `已接受offer`; requires bound entity and independent read | lines 53, 72 |

All 18 TestIntents and 11 scenarios in this historical v6 record were `draft`; Scenario Assurance was **11 blocked / 0 pass**. This record is retained for audit only. It is superseded by the current v4 draft below and is not a current intent or scenario index.

## Current Brain Creator draft: v4, 11 active TestIntents / 11 scenarios

The latest source refresh and design run were performed through the candidate-local Brain Creator Facade. The source is `requirementSource_u8iwcdvf` revision 4, content hash `11a1c65d64c4b8140f58f4b11e68ce7bae12c29da485e128e53541819cddb577`; the resulting RequirementSet is `requirementSet_2wfobw7n` v4, status `draft`, with `previousRequirementSetId=requirementSet_1sn82m3g`. Its 11 active TestIntents and 11 active BusinessScenarios are each draft and paired one-to-one. The older 18-intent intermediate was rejected because route context clauses were attached broadly and the callback had been merged into a close scenario; no outcomes were mapped from that intermediate.

| # | Current intent ID | Current scenario ID | Revised intent and scenario boundary | Candidate disposition |
|---:|---|---|---|---|
| 1 | `intent_gymohswk` | `scenario_fc19e4c651fa7417` | Overseas route: submit → HRBP → HRBP_TA → `orgLevel` page-labeled 2/3 branch → demand department approver. | Draft route prefix; later route unverified. |
| 2 | `intent_3z3sqen4` | `scenario_fb8dfabf94021634` | Overseas route: submit → HRBP → HRBP_TA → default `orgLevel` branch → fourth-level department approver. | Draft route prefix; later route unverified. |
| 3 | `intent_ju1cieuo` | `scenario_e903e82f341dfa44` | Domestic default route: submit → HRBP_TA → page-labeled `orgLevel` 2/3 branch → demand department approver. | Draft route prefix; later route unverified. |
| 4 | `intent_biirv9fe` | `scenario_545cc8faabdfa516` | Domestic default route: submit → HRBP_TA → default `orgLevel` branch → fourth-level department approver. | Draft route prefix; later route unverified. |
| 5 | `intent_0yx5xm9s` | `scenario_eb5dfe80e2f3521d` | No linked Offer and the row exposes the close action: close, then independently read demand status `已关闭`. Do not infer Offer/OA changes. | Draft; exact entity, data plan, action binding, and independent read are missing. |
| 6 | `intent_5djtbb0u` | `scenario_a5ebcedca0bf781b` | Any linked Offer in `已接受offer` or `已发offer` blocks direct close; keep the two state variants distinct during later outcome mapping. | Draft; negative outcome and no-change postcondition need structured Oracle/evidence. |
| 7 | `intent_od4nmvm7` | `scenario_6650a81e26731bff` | Other linked Offer states: show second confirmation; after current account confirms, demand status is independently read as `已关闭`. Offer/OA states are not inferred. | Draft; exact state sample, data plan, and independent reads are missing. |
| 8 | `intent_krvywvao` | `scenario_34e8a82141a59af0` | Grade-condition branches the user chose to defer remain `not-executed` and within the fixed 28-outcome denominator. | Explicitly not executed; the option mapping does not reverse the user's skip decision. |
| 9 | `intent_9vuroo5a` | `scenario_c06df2baed32d118` | `personnelType == "2"` internship branch remains separate; next approver/terminal is undefined. | Blocked; keep in the denominator. |
| 10 | `intent_neezo9w2` | `scenario_696db77c8bd2de0d` | HSSC system-administrator branch is not executed; process-administrator branch is outside scope. | Explicitly not executed; retain associated outcomes in the denominator. |
| 11 | `intent_dtv43lqw` | `scenario_ed2211c4cac07209` | Callback `已接收` is a candidate mapping to the same Offer's Test5 list state `已接受offer`; query that same entity independently. | Blocked; callback source, system binding, and entity binding are absent. |

The route Oracle is the user-confirmed active Test5 `hc招聘需求流程` `Proc000019` v9 page configuration. The latest draft no longer treats the process link as an open question. It does not establish that any route branch was executed. Four route scenarios end at the first department approver; downstream HRBP-manager/HRBP-lead/CHO/CEO conditions remain unverified. The 24/24 grade-ID-to-current-option-label observation is recorded in the supplement, but the user's prior instruction to skip grade branches remains authoritative.

Brain Creator `generate-test-design` returned `needs-review`. `assess-scenarios` and `bc_review` report **11 blocked / 0 pass**; all 11 have no confirmed System Brain binding and only limited Oracles. Each scenario has a blocked data plan with no attached profile, and there is no independent target-system postcondition evidence. The RequirementSet gate is `blocked` with 33/33 clause traceability, pending review/clarification actions, and unresolved post-path coverage. These are readiness findings, not business execution results.

No 28-outcome mapping has been performed; the fixed denominator remains 28. EvaluationTrial count is zero, independently evidenced outcomes are 0/28, and no Test5 business write or cleanup occurred. The 37-row disposition matrix above remains the historical-source audit; this v4 table is the current candidate index. User review of the 11 scenario boundaries and their expected outcomes is the next gate before any 28-outcome mapping.
