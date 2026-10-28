# Test5 GHR 意图与场景修订记录（2026-10-29 v6）

**状态：** 已通过 Brain Creator Facade 修订现有 draft RequirementSet；该修订不批准基线、不创建 Trial，也不执行 Test5 业务操作。

## 修订范围

- 目标集合：`requirementSet_n61e346r`，知识项目 `knowledgeProject_o3mtvnlm`。
- 固定集合仍为 37 条 TestIntent、11 个 BusinessScenario，原 ID 与成员关系不变，37 个 Intent 均链接到现有场景。
- 28 条本地 GHR outcome 分母未改变。37 个 TestIntent 的 `businessOutcomeId` 均明确为空；本次没有建立 outcome 映射。
- 只更新 4 条意图的目标/前置/预期字段，以及 S02、S06 两个场景的说明、数据需求和预期结果；Facade 原子提交覆盖完整 37/11 集合。

## 内容调整

1. **GHR-REQ-02（`intent_oxmrs77n`）**：明确无编制实习需求仍必须选择职位，且不校验编制数；需求职级按测试专用职位当前配置的有效范围填写。审批路线中的职级分支按用户决定暂缓并记 `not-executed`，不与表单字段约束混为一谈。实习生后续审批角色和终态未定义处仍不推断。
2. **GHR-OFFER-02（`intent_t2ooun1y`）**：只有在同一合成实习需求的批准状态和审批记录具备独立目标系统读回证据时，才检查 Offer 的职位/职级字段与需求关联；无法独立证明前置状态时保持 `blocked`，不伪造批准结果或后续审批结论。
3. **GHR-REQ-06g（`intent_gb6n3mu4`）**：混合态覆盖“已接受offer + 审批中”和“已发offer + 审批中”两个独立组合。任一 blocker 都阻止直接关闭，不进入可确认关闭的二次确认，相关实体保持原状态。
4. **GHR-REQ-06h（`intent_upvh53zc`）**：混合态覆盖“已接受offer + 待发offer”和“已发offer + 待发offer”两个独立组合，应用相同的阻止与状态保持规则。
5. **S02（`scenario_baf73387170bf38b`）**：将职位必填、无编制数例外、测试职位有效职级字段，与已暂缓的路线职级分支分开；实习 Offer 仍受独立批准状态证据和本地字段/附件规则约束。
6. **S06（`scenario_6798fec93888e844`）**：保留 8 个固定 outcome，并明确两个混合态 outcome 各覆盖两组数据组合，因此关闭矩阵需 10 组独立需求/Offer 数据组合。清理仍须提前通知；OA 流程状态只有在可独立读取时才作断言。

## Facade 预览与持久化回读

- 通过 `bc_prepare action=revise-test-design-draft` 先做完整集预览，返回 37 个 TestIntent 和 11 个 BusinessScenario 更新目标；预览草稿哈希为 `d2876f7201112a9f081c0b32807b1b185f2fd70acec282b625cd64772fb3a37e`。
- 按用户指示“先修改37条意图 /11个场景”确认写回。Facade 返回 `status=revised`，更新后草稿哈希为 `2d53844da275cea721d9ffa537ba959ca7748d15245d5b3b6a56d2eb166b7328`。
- 使用新的 Facade 进程复读两个集合，逐字段与确认的完整更新载荷比对：37/37 意图与 11/11 场景均为 `draft`，37 个成员链接无缺失或错链，四条意图和两个场景的修订字段匹配；37 个 outcome 映射均为空。
- Facade Gate 仍为 `needs-confirmation`，当前读回为 4 项 confirmed、14 项 pending。该修订没有关闭仍需运行时证据或来源裁决的项。
- 本次 Facade 身份：Brain Creator `2.1.1`，候选代码 commit `309d9bd6d34ebbdb975a9edbbb19215b4e9cec5e`，build ID `42c99be3b2a051d24e71d10e9a654638786642e14d7d358beb963278f0d5d479`，Store workspace `trust-closure-main`，schema 21；这是候选运行身份，不是已发布版本身份。

## 来源差异与验收边界

- 本轮用 `lark-cli` 复核正式主文档 revision `2045`；流程梳理子文档当前 revision `5`，其 XML SHA-256 `5dc2147bb95956a206fbaaa83aeb61dd0943726dea0c02b143999466e483e9d0` 与来源清单相同。
- 现有 37/11 RequirementSet 仍指向旧 `local-file` 来源 `requirementSource_dx9nznvc`，内容哈希 `c93bc0c6e793dbf74e8cd0dacfca516dd6527193db2af6a3e0e570e67520c8d0`。正式 Feishu 来源 `requirementSource_8dk46kq4` 是同一知识项目中的另一个资产；本轮 Facade 修订保留来源字段，不能把旧来源伪装成 Lark 来源。
- 该集合仍是非基线 draft。来源锚点协调、Critic/Eval 通过和 28 条 outcome 映射尚未完成；真实 Trial 仍无独立业务证据。没有批准基线、创建 Trial、对 Test5 写入业务数据或清理测试数据。
