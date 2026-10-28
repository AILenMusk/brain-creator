# Test5 GHR 37 条意图与 11 个场景复核（2026-10-28）

## 结论与边界

Brain Creator 已从修订稿生成 **37 个 draft TestIntent、11 个活动 draft BusinessScenario**。这是可复核的本地候选设计，不是通过基线、执行结果或真实 Trial。RequirementSet 保持 `draft`，当前 Requirement Eval gate 为 `needs-confirmation`，Test Design 为 `needs-review`。

本次没有创建 EvaluationTrial，没有运行 Test5 业务流程，没有创建、提交、转交、审批、关闭或清理业务记录，也没有将 28 个固定 outcome 映射到场景。

## Brain Creator 持久化身份

| 项目 | 当前值 |
|---|---|
| Requirement source | `requirementSource_la1u6or0`，revision 3 |
| Source SHA-256 | `6ab4a2a633e8d0a50c127ff47f4f3de9dc4aaf26b28fb09d4385f44295078875` |
| RequirementSet | `requirementSet_e0jzumat`，version 3，`draft` |
| RequirementSet 内容哈希 | `6ab4a2a633e8d0a50c127ff47f4f3de9dc4aaf26b28fb09d4385f44295078875` |
| Analysis provider | `host-agent` |
| Requirement Eval | `blocked` |
| Test Design | policy `brain-creator.test-design` 2.2.8，`needs-review` |

源修订稿：[test5-ghr-intent-scenario-revision-2026-10-28.md](test5-ghr-intent-scenario-revision-2026-10-28.md)。

## 数量和关联校验

| 资产 | 数量 | 复核结果 |
|---|---:|---|
| 原始意图追溯行 | 37 | 原始 ID 全部保留在修订矩阵 |
| TestIntent | 37 | 全部至少关联一个 BusinessScenario |
| BusinessScenario | 11 | 全部至少关联一个 TestIntent |
| 历史 BusinessScenario | 38 | 旧设计保留为 `stale`，不计入当前 11 个活动场景 |
| TestDataProfile | 0 | 未编造职位、部门、Offer 或业务记录数据 |
| 场景数据计划 | 11/11 blocked | 因缺少场景级数据档案，均不可执行 |
| 固定 28 outcome 映射 | 0/28 | 尚未开始；分母保持 28 |

37 个 TestIntent 的生成组成是：32 条来自原始意图矩阵的独立条款、1 条由用户确认的回调映射意图、4 条由路由 WorkflowModel 生成的路径意图。共享范围、Oracle 选择、执行授权和已由路径模型覆盖的创建/提交入口保留为来源约束，不重复生成独立意图。原始矩阵中的每一条仍保留可追溯记录。

## 11 个候选场景

| ID | Brain Creator 场景 | 候选预期和当前状态 |
|---|---|---|
| GHR-ROUTE-01 | `scenario_54c86ddc2533e265` — 海外 + 2/3 级部门 | 到需求部门负责人任务为止；draft，Assurance blocked |
| GHR-ROUTE-02 | `scenario_18dec5870c6a5764` — 海外 + 部门默认 | 到四级部门负责人任务为止；draft，Assurance blocked |
| GHR-ROUTE-03 | `scenario_d4dfc3d3815ff7b4` — 国内 + 2/3 级部门 | 到需求部门负责人任务为止；draft，Assurance blocked |
| GHR-ROUTE-04 | `scenario_4631be48976525c5` — 国内 + 部门默认 | 到四级部门负责人任务为止；draft，Assurance blocked |
| GHR-CLOSE-01 | `scenario_c564b70fdb9e9e7d` — GHR-CLOSE 规则 1 | 无 Offer；仅当操作列实际提供关闭动作时尝试，成功后独立查到需求 `已关闭`；draft，Assurance blocked |
| GHR-CLOSE-02 | `scenario_1a4d1873bb1e9b20` — GHR-CLOSE 规则 2 | 任一 `已接受offer`/`已发offer`（含混合状态）阻止直接关闭；draft，Assurance blocked |
| GHR-CLOSE-03 | `scenario_cd7c0dca2bc0bde9` — GHR-CLOSE 规则 3 | 其他关联 Offer 状态二次确认后才尝试关闭；成功后独立查到需求 `已关闭`；draft，Assurance blocked |
| GHR-CALLBACK-01 | `scenario_256754e1714b3042` — 回调状态映射 | 来源回调 `已接收` → Test5 列表 `已接受offer`；来源事件、同一 Offer 查询和本地安全夹具未验证，draft，Assurance blocked |
| GHR-ROUTE-05 | `scenario_8cdf70815f58c5fa` — 处置规则 1 | 职级条件分支按用户决定 not-executed，相关 outcome 留在固定分母 |
| GHR-ROUTE-07 | `scenario_b0648c20fc695b9f` — 处置规则 2 | 实习生 `personnelType == 2`；下一审批角色和终态未定义，blocked |
| GHR-SCOPE-01 | `scenario_19ec1d718129e8c8` — 处置规则 3 | HSSC 系统管理员支线 not-executed 并保留 outcome；流程管理员支线排除 |

表中的 `blocked` 和 `not-executed` 是当前候选处置，不是本轮执行结果。

路由 Oracle 按用户确认使用 Test5 当前生效的 `hc招聘需求流程` `Proc000019 v9`。配置图只定义预期；实际任务或需求后置状态仍须在新运行中独立读取。四个路由场景的节点边界不是完整审批链终态。

## 未关闭的门禁

- 11 个场景没有场景级 TestDataProfile，无法准备、验证或消费同一测试实体。
- 尚未通过 Brain Creator 确认目标页面、动作和独立业务状态查询的 System Brain 绑定。
- 当前登录账号的 fresh Auth readiness 尚未在本轮执行前验证。
- 关闭场景需要可区分的无 Offer、已接受、已发、混合和其他状态数据变体；创建或清理数据仍按既有授权边界处理。
- 回调场景尚无已批准的本地事件夹具与同一 Offer 实体后置查询；Beisen/OEHR 保持外部依赖。
- 固定 28 个 outcome 尚未逐项映射，列表查询、流程配置和本地 Offer 生命周期 outcome 是否全部落入 11 个场景仍待核对。

## 复核依据

- Brain Creator Facade `bc_review target=business-scenario` 对该 RequirementSet 返回 11 个 draft 场景。
- Brain Creator Store 的 RequirementSet 范围读取确认 37 个 TestIntent、11 个场景、0 个数据档案，11 个场景均因无数据档案而 blocked。
- TestIntent 与场景双向关联检查均无孤立资产。
- 本地修订源 revision 3 和 RequirementSet version 3 的内容哈希相同。

没有运行单元、集成、浏览器、构建、包安装或宿主 smoke 检查；这份复核只验收需求草稿结构和 Store 持久化数量，不宣称 E/F 或真实业务验收通过。

## 2026-10-29 readiness recheck

- A fresh Facade review confirms this RequirementSet still contains 11 draft BusinessScenarios.
- `bc_prepare action=assess-scenarios` assessed all 11 candidate IDs against Test5 system `system_nny1q7wk`: **11 blocked / 0 pass / 0 needs-review**. A follow-up `bc_review target=scenario-assurance` reports **11 missing System Brain bindings** and **11 limited Oracles**. This is readiness evidence only; it did not compile or run business cases.
- The saved Test5 AuthProfile was revalidated in a fresh context and failed because it redirected to the login page. `bc_status` reports 0 verified AuthProfiles and one pending authentication checkpoint. A dedicated capture window is open for manual sign-in; no Test5 business operation has been performed.
- The 28-outcome mapping remains **0/28**, and no EvaluationTrial or Test5 business write/cleanup occurred.

## 2026-10-29 revised 37-intent / 11-scenario draft

- Re-ran the Brain Creator Host Harness against source `requirementSource_la1u6or0` revision 3 and draft RequirementSet `requirementSet_e0jzumat` v3. The completed Harness session is `brainSession_c5scfh4c`; the Coverage Critic verdict is `needs-review`.
- The generated design now has 33 clause-backed TestIntents plus four route-path TestIntents; exactly 11 active scenarios are produced: four route paths, three close rules, three scope dispositions, and one callback mapping. All 37 TestIntents and all 11 scenarios have source links and non-orphan associations. Store history retains 38 stale scenarios from earlier draft generations.
- Models persisted: 2 BusinessObjectModels, 4 WorkflowModels, 0 StateMachineModels, and 2 DecisionTableModels. No TestDataProfiles were generated because the safe entity fixtures and lifecycle have not been confirmed.
- The first Clause Analyst payload had a schema-validation retry (`exception` is not a valid `nodeType`); the corrected payload passed. No Store content was manually edited.
- Brain Creator Scenario Assurance is **11 blocked / 0 pass** for this RequirementSet: 11 missing System Brain bindings, 11 blocked data plans, and 11 limited free-text Oracles. The RequirementSet remains draft; its current Requirement Eval gate is `needs-confirmation`.
- This revision is ready for user review before any 28-outcome mapping. The fixed denominator remains **0/28 mapped**, **0/28 independently evidenced**, with zero EvaluationTrials and no Test5 business writes or cleanup.
