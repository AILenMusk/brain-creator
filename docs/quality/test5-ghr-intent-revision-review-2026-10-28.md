# Test5 GHR Intent Revision Review — 2026-10-28

## Purpose and evidence boundary

This review addresses the user's request to revise the original 37 TestIntents and 11 BusinessScenarios before beginning the separate 28-outcome mapping. It audits each original TestIntent and records whether its content belongs in an active TestIntent, shared scope/Oracle context, or an explicit blocked/unexecuted path.

The original draft is `requirementSet_oeesilyq` v1 (`superseded`, 37 draft intents, 11 scenarios, 3 data profiles). `requirementSet_pdqtx6ir` v2 and `requirementSet_ly8t58rl` v4 remain historical drafts. The current candidate is `requirementSet_nixk1cms` v6 (`draft`), from source `requirementSource_95yxkxqo` revision 6 with content hash `01cdfd80cd4c432fabe68e23974da46fbbbeab29feaaa852a239247413c34f8b`. The first v6 generation used Test Design Policy 2.2.7; after adding complete-path TestIntent generation, Policy 2.2.8 regenerated 18 active draft TestIntents and 11 active draft BusinessScenarios. All 11 scenarios have blocked data plans with no attached profiles; no Test5 data was provisioned. This matrix is a design revision audit, not a 28-outcome mapping, baseline approval, execution result, or authorization to write Test5 business data. A separate draft source was also created when the first refresh used slash-normalized path text; it is not the selected source or Trial baseline.

## Disposition of the 37 original TestIntents

| # | v1 intent ID | Original content | Revision disposition | v6 active candidate / remaining gap |
|---:|---|---|---|---|
| 1 | `intent_ovid7n3s` | Local GHR scope and diagram boundary | Keep as shared scope metadata; remove as executable test | Applies to all local GHR scenarios |
| 2 | `intent_3cxsphum` | HSSC excluded; process administrator excluded | Keep both scope decisions; retain HSSC outcome as unexecuted | `intent_hc49vou0` / GHR-ROUTE-06; process administrator excluded |
| 3 | `intent_c10cnhol` | Active Test5 Proc000019 v9 is the selected route Oracle | Keep as shared route precondition and user-attested version binding | GHR-ROUTE-01–04; does not prove any branch execution |
| 4 | `intent_c9e5na10` | HRBP manager, intern/default, HRBP lead, CHO appear later in the route | Keep downstream nodes out of passing prefixes; preserve the intern case separately as blocked | GHR-ROUTE-07 (`intent_26rerryj`) is blocked; downstream chain after department lead remains unverified |
| 5 | `intent_j6t5mwr1` | Unmapped grade conditions `<2-1`, `<=2-3`, `>2-3`, `>3-3` | Retain all affected outcomes as skipped/unexecuted | `intent_ikxmlixr` / GHR-ROUTE-05 |
| 6 | `intent_w5o5nb1k` | `>3-3` to CEO and process end | Retain as skipped while grade IDs are unmapped | `intent_ikxmlixr` / GHR-ROUTE-05 |
| 7 | `intent_vj7d2o63` | `orgLevel` 2/3 versus default department route | Split the two outcomes; keep each next-actor assertion separate | GHR-ROUTE-01–04, crossed with overseas/domestic applicability |
| 8 | `intent_579posqm` | Overseas HRBP versus domestic default route | Split the two outcomes; keep each next-actor assertion separate | GHR-ROUTE-01–04, crossed with `orgLevel` applicability |
| 9 | `intent_yblcuxed` | Accepted/sent Offer blocks close; other associated states confirm | Split into the three distinct Offer-state rules, keeping no-associated-Offer close separate | GHR-CLOSE-01–03 |
| 10 | `intent_p0876bet` | Close Oracle needs independent target evidence | Keep as a verification constraint, not a test case | Applies to GHR-CLOSE-01–03; all actual assertions remain unverified |
| 11 | `intent_5zo2ti0m` | Successful demand close becomes `已关闭`; no inferred Offer/OA change | Use as the demand-state postcondition for allowed close paths | GHR-CLOSE-01 and GHR-CLOSE-03 |
| 12 | `intent_lwucnblm` | Authorized operations and advance cleanup notice | Keep as execution boundary and cleanup policy | Not an executable scenario; no Trial data exists |
| 13 | `intent_zkhgpuc2` | Broad cross-role route journey spanning all branches | Replace the mutually exclusive combined path with ordered, branch-specific prefixes | GHR-ROUTE-01–04 cover only prefixes through the first department approver; later route chain remains unverified |
| 14 | `intent_5vzxooij` | Broad cross-role close journey | Split by Offer state and close outcome | GHR-CLOSE-01–03 |
| 15 | `intent_2causjsi` | Attempt close, inspect Offer state, block or confirm | Split by exact state predicate; no associated Offer uses the direct-close rule, while other associated states require confirmation | GHR-CLOSE-01–03 |
| 16 | `intent_nnt1mr8p` | Second-level department lead to HRBP manager | Retain as a downstream step only after a supported grade path is identified | Not covered by the v6 prefixes; grade-dependent and currently unexecuted |
| 17 | `intent_f451mwlw` | Start demand and evaluate region route | Use as the start of the overseas/domestic branch paths | GHR-ROUTE-01–04 |
| 18 | `intent_nku2r45s` | Offer-state rule followed by demand closed | Use the closed state only for paths where close is permitted and confirmed | GHR-CLOSE-01/03; blocked close cases must not expect `已关闭` |
| 19 | `intent_e2rl8k3y` | Unmapped `<=2-3` to second-level lead | Retain as unexecuted; do not infer from canvas visibility | `intent_ikxmlixr` / GHR-ROUTE-05 |
| 20 | `intent_lys1dxlb` | Unmapped `>3-3` to process end | Retain as unexecuted | `intent_ikxmlixr` / GHR-ROUTE-05 |
| 21 | `intent_ae82y3uk` | Unmapped `>3-3` to CEO | Retain as unexecuted | `intent_ikxmlixr` / GHR-ROUTE-05 |
| 22 | `intent_baqbwgap` | Third-level department lead to HRBP manager | Retain as a downstream route step; do not claim path completion | Not covered by the v6 prefixes; grade/intern branch conditions need a verified path |
| 23 | `intent_beteu7cs` | Intern/default and `>2-3` toward HRBP lead | Split the explicit internship predicate from unmapped grade predicates | GHR-ROUTE-07 (`intent_26rerryj`) is separately blocked; grade branch maps to `intent_ikxmlixr` / GHR-ROUTE-05 |
| 24 | `intent_5j62yh7l` | Fourth-level department lead to unmapped grade/personnel branch | Keep only as an unexecuted boundary; do not label the step passed | `intent_ikxmlixr` / GHR-ROUTE-05; grade branch stays in denominator |
| 25 | `intent_o3oi3j6p` | Demand department lead to unmapped grade/personnel branch | Keep only as an unexecuted boundary | `intent_ikxmlixr` / GHR-ROUTE-05 |
| 26 | `intent_xhov83bo` | Unmapped grade condition to nested `<=2-3` | Retain as unexecuted | `intent_ikxmlixr` / GHR-ROUTE-05 |
| 27 | `intent_vic2koq0` | Unmapped grade/personnel condition to third-level lead | Retain as unexecuted | `intent_ikxmlixr` / GHR-ROUTE-05 |
| 28 | `intent_cks0cjkr` | CEO to process end | Retain as unexecuted until the `>3-3` branch is mapped | `intent_ikxmlixr` / GHR-ROUTE-05 |
| 29 | `intent_qyjkes9b` | CHO to nested `>3-3` | Retain as unexecuted | `intent_ikxmlixr` / GHR-ROUTE-05 |
| 30 | `intent_czetarmf` | HRBP lead to CHO | Keep as a downstream step, not a standalone pass | Not covered by the v6 prefixes; only reachable through a verified eligible route |
| 31 | `intent_ca80qvkk` | HRBP manager to intern/default and `>2-3` condition | Split internship from grade conditions; preserve the fixed denominator for grade skips | GHR-ROUTE-07 (`intent_26rerryj`) is blocked; grade branch maps to `intent_ikxmlixr` / GHR-ROUTE-05 |
| 32 | `intent_ztgtlzam` | HRBP to HRBP_TA | Use as a step in the overseas path; the domestic default path starts at HRBP_TA | GHR-ROUTE-01/02 |
| 33 | `intent_hlleg6vz` | HRBP_TA to `orgLevel` branch | Use as the decision point preceding the two department paths | GHR-ROUTE-01–04 |
| 34 | `intent_ois68f24` | Default department branch to fourth-level lead | Keep as a positive branch assertion | GHR-ROUTE-02/04 |
| 35 | `intent_wtw3orxy` | `orgLevel` 2/3 to demand department lead | Keep as a positive branch assertion | GHR-ROUTE-01/03 |
| 36 | `intent_85kuafrj` | Overseas branch to HRBP | Keep as a positive branch assertion | GHR-ROUTE-01/02 |
| 37 | `intent_1jso11kw` | Domestic default branch to HRBP_TA | Keep as a positive branch assertion | GHR-ROUTE-03/04 |

## Acceptance of this revision

- The v1 draft had 37 intents because it mixed scope/Oracle context with generated adjacent-edge assertions. The 37 original IDs above now each have a documented disposition. Scope and Oracle context remain shared requirements; adjacent edges are composed into path-level scenarios; mutually exclusive conditions are separated; unmapped grade and HSSC outcomes stay visible as unexecuted.
- The current v6 design has four mutually exclusive route prefixes (overseas/domestic crossed with `orgLevel` 2/3/default), three close outcomes (direct close, accepted/sent Offer blocks, other linked Offer state requires confirmation), and four separate outcomes (grade not executed, internship blocked, HSSC not executed, callback mapping). The route prefixes stop at the first department approver; later grade/personnel-dependent routing is not represented as passed.
- Facade Scenario Assurance assessed the selected v6 set as **11 blocked / 0 pass**. All 11 lack a confirmed executable System Brain binding, have only limited Oracles, and have blocked data plans without attached profiles. No scenario has a verified target-system postcondition. This is draft readiness, not an executed scenario result.
- No `GHR-*` outcome mapping has been performed; the fixed 28-outcome denominator is unchanged. The RequirementSet remains `draft`; no baseline approval, EvaluationTrial, Test5 write, or cleanup occurred.

## Open path question

The observed current-route transcription shows `personnelType == "2"` at the HRBP-manager branch, but the captured evidence does not identify the expected next approver or terminal route for an intern. The user asked to skip unmapped **grade-ID** branches; the internship predicate is separate. The current draft keeps a separate blocked internship scenario and does not merge it into the grade skip. The route remains a prefix and cannot claim the later HRBP manager/HRBP lead/CHO/CEO path as executed.

## Latest Brain Creator draft: 18 active TestIntents / 11 scenarios

The current records were regenerated through the candidate-local Brain Creator Facade from RequirementSet v6 after the path-generation change. The 18 active TestIntents and 11 BusinessScenarios are all `draft`; path-level intents carry exact selected transition IDs and route conditions, and blocked/not-executed clauses do not create misleading data profiles. These IDs are the current draft assets; the v1 IDs above remain historical evidence.

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

All 18 TestIntents and 11 scenarios remain `draft`; Scenario Assurance is **11 blocked / 0 pass**. All scenario data plans are blocked because no profiles are attached, all bindings are missing, and all Oracles are limited. This latest normalization does not claim a complete approval chain, map any row in the fixed 28 outcomes, or replace the still-required individual scenario and Oracle review.
