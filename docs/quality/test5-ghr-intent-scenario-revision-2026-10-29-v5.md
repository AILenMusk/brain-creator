# Test5 GHR 意图与场景修订稿（2026-10-29 v5）

**状态：** 已通过 Brain Creator Facade 写回现有 RequirementSet，并由新进程回读核验：37 条 TestIntent、11 个 BusinessScenario 全部保持 draft。此次修订不批准基线、Trial、系统绑定或业务执行。

## 1. 依据与范围

- 正式需求主文档由 `lark-cli docs +fetch` 只读复核，当前 revision 为 `2045`，身份为当前用户。主文档仍标为正式发布版本。
- 当前待修订的 Brain Creator RequirementSet 为 `requirementSet_n61e346r`，内容哈希 `c93bc0c6e793dbf74e8cd0dacfca516dd6527193db2af6a3e0e570e67520c8d0`，状态 `draft`。现有 37 条意图、11 个场景及 37 个意图到场景的成员关联均存在。
- 用户冻结的本地 Test5 集团/GHR outcome 分母为 28。其余 9 条意图是 4 条路线、4 个主流程检查点和 1 条分母外回调补充。blocked、not-executed 与未执行的变体不从 28 中移除。
- 用户提供 `hc招聘需求流程` 配置页链接，并确认 `Proc000019 v9` 是 Test5 当前生效版本、以页面当前配置路径作为路线预期。后续不再要求重复打开或提供该链接。真实运行中的实际任务顺序仍须从同一合成需求的审批记录取证；这是执行证据，不是继续澄清路线来源。用户另确认需求/Offer 关闭优先级：任一关联 Offer 为“已接受offer”或“已发offer”时阻止直接关闭；其余组合走二次确认。确认二次关闭后的招聘需求为“已关闭”。
- 用户确认主文档中重复使用的 Offer 状态图片是有意的；6 项附件转录可作需求知识；流程管理员支线不纳入本轮，HSSC 系统管理员支线排除执行但对应 outcome 保留在分母并记未执行；职级分支暂跳过。
- 用户已授权使用当前登录账号，并在已授权范围内创建、提交、转交、审批和关闭；测试数据清理须事先通知。用户授权创建测试专用职位/职务体系选项，不代表这些选项已创建或已通过目标系统验证。
- Beisen 及需要 OEHR 外部副作用的路径不作为 Test5 本地成功结果；第二真实系统与 Beisen 执行仍是外部依赖。

### 修订原则

1. 每条 TestIntent 只表达一个可判定意图，标题不使用 `Move from ...` 场景摘要。
2. 每条意图写明场景化前置条件、唯一业务实体、目标状态/拒绝结果和证据条件。没有系统证据的角色、字段、动作和 Locator 保持待核验。
3. BusinessScenario 是多条原子意图的组合；`expectedBusinessOutcomes` 只列各成员意图的独立预期，不额外复制一条场景摘要。
4. 对业务状态的预期和执行处置分开记录。草稿状态继续为 `draft`；`blocked`、`not-executed` 是当前执行处置，不能写成通过。
5. 路线、检查点和回调不增加或替代 28 条冻结 outcome。

## 2. 37 条 TestIntent 候选修订

以下现有 ID 用于 Facade 写回及回读定位；预期描述均是候选 Oracle，不是实测结果。

### A. 固定分母内 28 条业务 outcome

| 编号 | 当前 TestIntent ID | 修订后的单一目标与预期 | 场景 | 当前处置与必要前置 |
|---|---|---|---|---|
| GHR-REQ-01 | `intent_kpkmsf90` | 使用唯一合成的正式员工招聘需求完成创建、提交、审批通过和关闭；同一需求依次为“草稿”→“审批中”→“进行中”→“已关闭”。 | S01 | **blocked**：测试职位/编制、四条路线、任务角色和独立后置查询未验证。每条路线用独立需求；至少一条无关联 Offer 的路线完成关闭断言。 |
| GHR-REQ-02 | `intent_oxmrs77n` | 创建无编制实习需求；不校验编制数，需求职级须在所选职位的最低/最高职级之间。提交、后续审批及终态只按来源已定义部分检查。 | S02 | **blocked**：测试专用实习职位/职级尚未创建和读取；实习生后续审批角色及终态未定义，不推断。 |
| GHR-REQ-03a | `intent_8l0g46yj` | 离职替补或调岗替补需求缺少替补人员时，提交被阻止；需求保持提交前状态且不新增审批记录。 | S03 | **blocked**：需合成需求；提交前后状态和审批记录须独立读取。 |
| GHR-REQ-03b | `intent_7cl5k1ay` | 使用满足 Test5 条件的合成替补人员提交替补需求；成功后同一需求为“审批中”。 | S03 | **blocked**：尚无获准的合成替补人员及资格证据；不得选用真实员工。 |
| GHR-REQ-04a | `intent_sio5rp6p` | 审批人执行“驳回至提交人”后，同一需求回到“草稿”；列表、详情和审批记录一致。 | S04 | **blocked**：实际审批任务、可用角色和驳回动作需核验；使用独立合成需求。 |
| GHR-REQ-04b | `intent_3dq97yx1` | 提交人撤回后，同一需求回到“草稿”；列表、详情和审批记录一致。 | S04 | **blocked**：撤回入口与当前账号对应的流程角色需核验；不得用驳回替代撤回。 |
| GHR-REQ-05 | `intent_mzktym1i` | 通过明确的流程作废动作后，招聘需求状态为“已废弃”，且与“已关闭”区分。 | S05 | **blocked**：作废动作、适用状态和独立读回尚未绑定。 |
| GHR-REQ-06a | `intent_chlyhya5` | 单独关联状态为“已接受offer”的 Offer 时，直接关闭被阻止；需求和 Offer 均不变。 | S06 | **blocked**：独立合成需求/Offer 和前后查询未准备。 |
| GHR-REQ-06b | `intent_b7mytka1` | 单独关联状态为“已发offer”的 Offer 时，直接关闭被阻止；需求和 Offer 均不变。 | S06 | **blocked**：独立合成需求/Offer 和前后查询未准备。 |
| GHR-REQ-06c | `intent_mqaww5p2` | 关联“审批中”Offer 时确认二次关闭：需求变为“已关闭”，Offer 变为“已废弃”；若有关联审批流程，其作废结果另行独立核验。 | S06 | **blocked**：Offer、审批流程和需求的独立后置查询未配置。 |
| GHR-REQ-06d | `intent_bb5ezyma` | 关联“待发offer”时确认二次关闭：需求变为“已关闭”，Offer 变为“已废弃”。 | S06 | **blocked**：独立合成 Offer 和状态读回未准备。 |
| GHR-REQ-06e | `intent_e53qo1o3` | 关联“审批中”Offer 时取消二次关闭：需求、Offer 与关联审批状态均保持原值。 | S06 | **blocked**：需取得确认前后同一实体的状态。 |
| GHR-REQ-06f | `intent_xa1ozl07` | 关联“待发offer”时取消二次关闭：需求及 Offer 均保持原值。 | S06 | **blocked**：需取得确认前后同一实体的状态。 |
| GHR-REQ-06g | `intent_gb6n3mu4` | 同时关联“已发offer”和“审批中”Offer 时，已发 Offer 优先阻止直接关闭；所有关联实体保持原状态。 | S06 | **blocked**：两条 Offer 必须为独立合成实体并分别读回。 |
| GHR-REQ-06h | `intent_upvh53zc` | 同时关联“已发offer”和“待发offer”Offer 时，已发 Offer 优先阻止直接关闭；所有关联实体保持原状态。 | S06 | **blocked**：两条 Offer 必须为独立合成实体并分别读回。 |
| GHR-OFFER-01 | `intent_39oofw0w` | 在 Test5 集团/GHR 本地适用路径创建正式员工 Offer；满足已确认字段和附件后提交为“审批中”，审批后为“待发offer”。 | S07 | **blocked**：本地路由、实际字段/附件、角色任务与 Offer 独立查询待核验；Beisen 路径不替代。 |
| GHR-OFFER-02 | `intent_t2ooun1y` | 为同一条已批准的合成实习需求录入实习 Offer；验证已确认的职位/职级字段和需求关联。 | S02 | **blocked**：实习 Offer 审批后续角色、目标终态及合成材料未定义；不推断审批通过。 |
| GHR-OFFER-03a | `intent_j6gzbxdu` | 同一 Offer 从“待发offer”转为“已发offer”，并在独立读取中显示新状态。 | S08 | **blocked**：目标动作和本地无外部副作用的路径待核验。 |
| GHR-OFFER-03c | `intent_opu7g6jx` | 同一 Offer 从“待发offer”转为“已拒绝offer”，并在独立读取中显示新状态。 | S08 | **blocked**：目标动作和本地无外部副作用的路径待核验。 |
| GHR-OFFER-03d | `intent_hwmiagpv` | 同一 Offer 从“已发offer”转为“待发offer”，并在独立读取中显示新状态。 | S08 | **blocked**：确认不会触发未授权的 OEHR/Beisen 副作用前不得操作。 |
| GHR-OFFER-03f | `intent_bs9yvosp` | 同一 Offer 从“已发offer”转为“已拒绝offer”，并在独立读取中显示新状态。 | S08 | **blocked**：确认不会触发未授权的 OEHR/Beisen 副作用前不得操作。 |
| GHR-OFFER-03k | `intent_trew459l` | 同一 Offer 从“已拒绝offer”尝试转为“待发offer”；分别检查停编/待停编及编制已占用/在途保护条件。 | S08 | **blocked**：目标动作和安全编制夹具未核验；不得把未命中条件算作通过。 |
| GHR-OFFER-03l | `intent_vgrsa27e` | 同一 Offer 从“已拒绝offer”尝试转为“已发offer”；分别检查停编/待停编及编制已占用/在途保护条件。 | S08 | **blocked**：目标动作和安全编制夹具未核验；OEHR/Beisen 副作用保持排除。 |
| GHR-COMP-01 | `intent_2qi53frh` | 只读核对薪酬项目配置中“适用用工形式”是否必填且支持多选，并核对列表/导出是否展示该字段；不修改共享配置。 | S09 | **blocked**：需绑定正确的 Test5 配置页并取得只读页面/导出证据。 |
| GHR-PAY-01 | `intent_hv95r4i1` | 只读核对薪酬项查询是否随计薪制度、区域和用工形式刷新；固定基数/固定比例各展示对应薪酬字段。 | S09 | **blocked / external**：Oracle 依赖 OEHR 返回值；第二系统和授权未具备，不计本地 GHR 通过。 |
| GHR-STAFF-01 | `intent_qfbteqfj` | 检查编制详情标准表单和旧流程迁移后审批/状态保留的需求预期；HSSC 系统管理员分支按用户决定不执行。 | S10 | **not-executed**：固定分母保留此 outcome；不把流程管理员分支混入，也不以只读页面代替迁移结果。 |
| GHR-QUERY-01 | `intent_tre1kslm` | 按本轮合成需求/Offer 唯一编码核对列表、详情、审批记录在已批准检查点的状态一致性。 | S11 | **blocked**：依赖本轮合成数据及独立查询证据。 |
| GHR-QUERY-02 | `intent_zxwblnq4` | 仅导出本轮筛选出的合成记录；列名和值符合复核后的字段清单，且不包含无关员工记录。 | S11 | **blocked**：目标字段清单、过滤条件及导出证据尚未准备；不导出或留存现有员工数据。 |

### B. 不增加 28 条分母的 8 条支持意图与 1 条补充意图

| 编号 | 当前 TestIntent ID | 修订后的单一目标 | 场景 | 处置 |
|---|---|---|---|---|
| GHR-ROUTE-01 | `intent_9nzupas3` | 海外地区且部门为 2/3 级时，按用户确认的 Test5 当前生效 `Proc000019 v9` 路径，核对任务顺序 HRBP → HRBP_TA → 需求部门负责人。 | S01 | blocked：候选路线来源已确认；每个任务节点仍须在同一合成需求的审批记录中命中；职级分支暂跳过。 |
| GHR-ROUTE-02 | `intent_s4yo0ms4` | 海外地区且部门采用默认分支时，按用户确认的 Test5 当前生效 `Proc000019 v9` 路径核对 HRBP → HRBP_TA → 四级部门负责人。 | S01 | blocked：候选路线来源已确认；默认分支条件和实际任务仍须分别取证；职级分支暂跳过。 |
| GHR-ROUTE-03 | `intent_2b79jh14` | 国内默认地区且部门为 2/3 级时，按用户确认的 Test5 当前生效 `Proc000019 v9` 路径核对 HRBP_TA → 需求部门负责人。 | S01 | blocked：候选路线来源已确认；审批记录仍须证明实际任务顺序；职级分支暂跳过。 |
| GHR-ROUTE-04 | `intent_0cgz00at` | 国内默认地区且部门采用默认分支时，按用户确认的 Test5 当前生效 `Proc000019 v9` 路径核对 HRBP_TA → 四级部门负责人。 | S01 | blocked：候选路线来源已确认；默认分支条件和实际任务仍须分别取证；职级分支暂跳过。 |
| GHR-CHECK-01 | `intent_90bvcgix` | 创建后用同一需求编码查询；状态为“草稿”，已持久化字段与提交前表单一致。 | S01 | blocked：独立列表/详情读回；与提交后状态分开断言。 |
| GHR-CHECK-02 | `intent_jyz43tx7` | 提交后同一需求为“审批中”，且可读到对应审批任务/记录。 | S01 | blocked：需求状态和审批任务分别核验。 |
| GHR-CHECK-03 | `intent_1vwesyoh` | 当前审批路径通过后同一需求为“进行中”，列表、详情、审批记录一致。 | S01 | blocked：不得以页面按钮响应或审批提交响应替代后置读取。 |
| GHR-CHECK-04 | `intent_2kjcdlp7` | 无关联 Offer 且操作列提供关闭动作时，关闭后需求为“已关闭”。 | S01 | blocked：需求关闭与 Offer 无直接关联；“已关闭”按正式正文和用户确认。 |
| GHR-CALLBACK-01 | `intent_boiaj0l5` | 在安全的本地回调夹具中验证来源状态“已接收”映射到同一 Test5 Offer 的“已接受offer”。 | S08 | **blocked / denominator-excluded**：仅用户确认映射规则；没有本地回调夹具，不向 Beisen/OEHR 发送事件。 |

## 3. 11 个 BusinessScenario 字段修订

本节按 Brain Creator `BusinessScenario` 模型字段给出候选值：`objective`、`family`、`actors`、`preconditions`、`workflowRefs`、`stateTransitionRefs`、`decisionRuleRefs`、`testDataNeeds`、`expectedBusinessOutcomes`、`sourceRefs`、`testIntentIds`、`risk`、`status`。没有已验证的模型引用或数据资料时留空/blocked，不造 ID。所有场景 `status=draft`。

### GHR-S01 — 正式需求闭环与当前路线

- 当前场景 ID：`scenario_6c4a8679e74f58a4`；`family=cross-role`；`risk=critical`。
- 成员：REQ-01、ROUTE-01～04、CHECK-01～04（9 条意图）。
- `objective`：以 Test5 当前发布的 `Proc000019 v9` 验证集团/GHR 正式需求创建、当前路线审批、状态回写与关闭。
- `actors`：发起人；由 Test5 实际任务分配的审批人。具体身份只从页面/审批记录读取，不在设计中预设人员。
- `preconditions`：Test5 Group/GHR 目标和鉴权就绪；测试专用职位及可用编制/配额已安全建立并独立核验；每条地区/部门路线各用独立合成需求；无关联 Offer 的关闭实体通过独立查询确认；关闭/审批记录可读。
- `testDataNeeds`：四个地区/部门路线的唯一合成需求编码；一个无关联 Offer 的合成需求；创建/提交后通过同一实体引用继续使用。准确职位、部门、地区、职级值从 Test5 读回后再绑定。
- `workflowRefs`：保留当前 RequirementSet 已有的需求 workflow 引用；路线预期来源采用用户提供并确认当前生效的 Test5 `Proc000019 v9` 页面配置。`stateTransitionRefs`：只引用已核验的草稿→审批中→进行中→已关闭边。`decisionRuleRefs`：没有可安全确认的结构化 Store 引用时不造 ID；按已确认配置路径记录候选规则，实际分支命中留给运行证据。
- `expectedBusinessOutcomes`：分别对应 9 条成员意图；删除自动生成的 `Move from GHR-REQ-01 ...` 摘要副本。
- `status`：draft；执行处置 blocked。路线来源已由用户确认；本轮审批任务与业务后置状态尚无真实运行证据。

### GHR-S02 — 无编制实习需求与实习 Offer

- 当前场景 ID：`scenario_baf73387170bf38b`；`family=branch`；`risk=critical`。成员 REQ-02、OFFER-02。
- `objective`：验证无编制实习需求的编制校验例外与职位/职级约束；仅覆盖正式需求已定义部分。
- `actors`：当前登录账号；后续审批人角色以实际任务为准，未定义处不填具体角色。
- `preconditions`：测试专用实习职位/职务体系已创建并读取最低/最高职级；需求用工形式和职位绑定经只读核验；不使用真实员工或现有业务需求。
- `testDataNeeds`：一个测试专用实习职位及其可选职级；一个唯一合成实习需求；后续 Offer 仅在本地适用路径、字段和附件规则明确后准备。
- `workflowRefs`：需求/Offer 流程分别使用正式模型引用；Offer 后续角色未确认前不扩展审批链。`stateTransitionRefs` 只填已由来源明确的状态转换。
- `expectedBusinessOutcomes`：REQ-02 的“无需编制数校验、需求职级在职位上下限内”；OFFER-02 只核对已定义字段/需求关联，不臆测审批终态。
- `status`：draft；执行处置 blocked。测试职位授权不等于职位已经存在或数据准备完成。

### GHR-S03 — 替补必填与合成替补

- 当前场景 ID：`scenario_5103ffece55ceea5`；`family=branch`；`risk=high`。成员 REQ-03a、REQ-03b。
- `objective`：以两条相互独立的合成需求区分缺少替补时的提交阻止与具备有效替补时的提交结果。
- `actors`：当前登录账号；实际提交角色待系统观察。
- `preconditions`：表单必填条件和替补类型从正式需求/页面证据确定；有效替补须为合成且符合来源资格，不可从员工列表任选。
- `testDataNeeds`：两个独立合成需求；其中一个无替补，另一个引用已核验的合成替补；准备和状态读回均使用稳定实体引用。
- `expectedBusinessOutcomes`：缺失路径不产生审批任务且业务状态不变；有效路径提交后同一需求为“审批中”。
- `status`：draft；两个变体当前均 blocked，不能因一个通过推定另一个通过。

### GHR-S04 — 驳回与撤回

- 当前场景 ID：`scenario_8cbff88d136d8f56`；`family=state-transition`；`risk=high`。成员 REQ-04a、REQ-04b。
- `objective`：分别验证审批人驳回和提交人撤回回到“草稿”，不混用动作或实体。
- `actors`：需求提交人；Test5 实际分配的审批任务处理人。两种动作分开读取其真实任务角色。
- `preconditions`：两条独立合成需求均已达到来源允许驳回/撤回的状态；相应任务和动作在 Test5 页面可见；账号身份/角色可执行对应动作。
- `testDataNeeds`：一个用于驳回的需求，一个用于撤回的需求；两者都能独立查询审批前后状态和历史记录。
- `expectedBusinessOutcomes`：驳回至提交人后为“草稿”；提交人撤回后为“草稿”；分别核对列表、详情、审批历史。
- `status`：draft；执行处置 blocked，直至动作和角色路径被绑定。

### GHR-S05 — 流程作废

- 当前场景 ID：`scenario_94a50a9641cd3f2d`；`family=state-transition`；`risk=high`。成员 REQ-05。
- `objective`：在 Test5 存在明确流程作废操作时，验证需求状态转为“已废弃”。
- `actors`：实际可执行作废的当前账号角色，以目标页面和权限证据为准。
- `preconditions`：作废入口、来源状态、权限和审批流程影响均已核验；使用唯一合成需求。
- `testDataNeeds`：一个处于允许作废状态的合成需求。
- `expectedBusinessOutcomes`：只判定“已废弃”；不得与“已关闭”合并。
- `status`：draft；执行处置 blocked，未确认动作前不尝试写入。

### GHR-S06 — 需求关闭与 Offer 状态矩阵

- 当前场景 ID：`scenario_6798fec93888e844`；`family=branch`；`risk=critical`。成员 REQ-06a～06h（8 条独立 outcome）。
- `objective`：验证需求关闭遇到关联 Offer 时的阻止/二次确认/取消规则，并逐实体核对副作用。
- `actors`：当前登录账号；具体关闭动作和确认弹窗由目标页面观察。
- `preconditions`：每个变体使用独立合成需求和 Offer；开始前读回全部实体 ID 与状态；所有 Offer 均确认关联到该需求；不复用会被变更的 Offer。
- `testDataNeeds`：8 组独立需求/Offer 状态组合；混合 Offer 情形逐条记录每个 Offer 引用；关联 OA 流程只有在能独立读取时才纳入强断言。
- `decisionRuleRefs`：用户确认的优先规则为“任一关联 Offer 是已接受/已发即阻止直接关闭；没有这两种状态的其他组合走二次确认”。此处保存为需求候选规则，不声称系统已实现。
- `expectedBusinessOutcomes`：8 个独立目标分别引用 REQ-06a～06h，不增加无固定分母的新 outcome；取消确认保持所有前置状态；确认关闭后需求“已关闭”，关联审批中/待发 Offer “已废弃”。OA 流程副作用另列独立证据，不从弹窗或需求状态推断。
- `status`：draft；执行处置 blocked，独立目标查询、数据准备和动作证据未齐备。

### GHR-S07 — 集团/GHR 正式员工 Offer

- 当前场景 ID：`scenario_4ae5d83bef9a5f95`；`family=main-flow`；`risk=critical`。成员 OFFER-01。
- `objective`：验证 Test5 集团/GHR 本地路径中正式员工 Offer 的字段、提交和审批状态。
- `actors`：当前登录账号及 Test5 实际生成的审批任务处理人；具体角色待观察。
- `preconditions`：Test5 中确认本地 GHR 承载路径；唯一合成且已批准的需求可关联；正式员工 Offer 表字段/条件字段和附件清单可追溯到当前子表；附件内容仅用合成材料。
- `testDataNeeds`：已完成的合成需求实体引用、合成 Offer 附件、唯一 Offer 编码；禁止真实候选人/员工数据。
- `expectedBusinessOutcomes`：同一 Offer 提交后“审批中”、审批通过后“待发offer”；字段值和需求关联从独立 Offer 查询读取。
- `status`：draft；执行处置 blocked，Beisen 走向不计作本地通过。

### GHR-S08 — 本地 Offer 状态转移与回调补充

- 当前场景 ID：`scenario_a5fa52dd6d7a93e0`；`family=state-transition`；`risk=critical`。成员 OFFER-03a/03c/03d/03f/03k/03l 及分母外 CALLBACK-01。
- `objective`：逐条验证允许范围内的 Offer 状态边；将回调映射作为隔离的候选补充，不与本地 UI 状态边混判。
- `actors`：当前登录账号；目标动作/任务角色以 Test5 只读页面证据为准。
- `preconditions`：每条状态边有独立合成 Offer，起始状态经独立读取；明确该操作不会向 OEHR/Beisen 产生未授权外部副作用；编制保护分支分别准备对应合成状态。
- `testDataNeeds`：6 个唯一 Offer 状态边夹具；回调另需本地隔离事件夹具，不能复用真实外部回调。
- `expectedBusinessOutcomes`：每条状态边核对同一 Offer 的目标状态；03k/03l 单独核对停编/待停编和已占用/在途保护。CALLBACK-01 仅在本地回调夹具下核对“已接收”→“已接受offer”，不进入 28 条分母。
- `status`：draft；上述状态边 blocked；回调 blocked 且 denominator-excluded。外部副作用路径不执行。

### GHR-S09 — 薪酬项目配置与薪酬项查询

- 当前场景 ID：`scenario_56c905c480715eff`；`family=integration`；`risk=high`。成员 COMP-01、PAY-01。
- `objective`：分开评定本地配置字段的只读展示和 OEHR 依赖的薪酬项查询，绝不把它们合并为一个通过结论。
- `actors`：当前登录账号，只读观察。
- `preconditions`：配置页只读权限和当前版本可读取；PAY-01 需第二目标系统/连接和独立来源 Oracle。
- `testDataNeeds`：COMP-01 不需业务写数据；PAY-01 使用隔离的合成查询参数，且依赖系统明确。
- `expectedBusinessOutcomes`：COMP-01 检查“适用用工形式”必填、多选及列表/导出字段；PAY-01 分别检查计薪制度、区域、用工形式及固定基数/固定比例字段变化。
- `status`：draft；COMP blocked until page/schema evidence is captured；PAY-01 external-blocked。

### GHR-S10 — 编制详情和旧流程迁移

- 当前场景 ID：`scenario_2ac3b25132728aa8`；`family=state-transition`；`risk=high`。成员 STAFF-01。
- `objective`：保留标准表单、旧流程迁移审批/状态保留的需求核验意图；按用户决定排除 HSSC 系统管理员支线。
- `actors`：只读核验账号；HSSC 系统管理员不执行。
- `preconditions`：若迁移证据缺少版本化历史记录，则保持 blocked；不通过当前表单截图推断迁移前后状态。
- `testDataNeeds`：不创建业务数据；需有可审核的合成迁移夹具或版本化迁移证据。
- `expectedBusinessOutcomes`：28 条中的 STAFF-01 保留在固定分母，处置为 not-executed；流程管理员支线不纳入。
- `status`：draft；执行处置 not-executed，不提升为 pass。

### GHR-S11 — 查询一致性与筛选导出

- 当前场景 ID：`scenario_0cbd38acd62c8f95`；`family=data`；`risk=high`。成员 QUERY-01、QUERY-02。
- `objective`：用本轮已验证的合成实体检查列表/详情/审批记录和筛选导出，防止混入现有员工/业务数据。
- `actors`：当前登录账号，只读查询/导出。
- `preconditions`：所有输入实体均由本轮数据准备任务产生或经用户批准复用；唯一编码、筛选器和当前字段清单已复核；可独立查询各实体。
- `testDataNeeds`：来自 S01～S08 的合成 demand/offer 引用；导出只筛选这些编码并限定最小需要字段。
- `expectedBusinessOutcomes`：QUERY-01 对每个已批准检查点比较同一编码的列表/详情/审批记录；QUERY-02 比较筛选结果行、字段名/值及无无关记录。
- `status`：draft；执行处置 blocked，导出范围未定前不导出。

## 4. 写回前的 Brain Creator 验收清单

### 4.1 已通过 Facade 记录的用户确认 Eval action

以下四条已在本轮继续工作前通过 Brain Creator Facade 确认；表中保留原始用户确认文本，不能把这些范围决定解释为 Oracle、基线或 Trial 批准：

| Eval action ID | 已记录的用户确认 | 精确确认文本 | 保留的边界 |
|---|---|---|---|
| `evalAction_u0q9r15m` | 固定 28 条本地 GHR outcome 分母 | “确认冻结 28 条，Beisen 保持阻塞” | blocked、failed、not-executed 均保留在分母。 |
| `evalAction_qquq9ecv` | 跳过职级分支 | “先跳过相关分支” | 相应 outcome 仍记录未执行/未验证。 |
| `evalAction_yixjk4gd` | 排除 HSSC 系统管理员支线的执行 | “排除该支线，相关 outcome 仍保留在分母并记未执行” | 不将其从 28 条分母删除。 |
| `evalAction_19dh7e8i` | Beisen/OEHR 跨系统路径等待第二系统与单独授权 | “纳入 Beisen 跨系统需求，等待第二系统与单独授权” | 不作为 Test5 本地 GHR 通过结果，不触发外部写入。 |

Facade 回读显示该 RequirementSet 的 EvaluationGate 有 18 条 action，其中 4 条为 `confirmed`、14 条仍为 `pending`；门仍为 `needs-user` / `needs-confirmation`。其余 14 条涉及尚无来源定义的实习后续状态、合成替补、OA 副作用读回、实际本地 Offer 页面证据、配置/迁移/导出证据、系统命中、角色映射或数据夹具，不以以上用户决定代替所需证据。尤其 `evalAction_xfa1ies8` 仅保留为 OEHR 外部依赖，不在本地 Trial 中关闭或执行。

1. **已完成：** 通过 Facade 在同一个 RequirementSet 修订现有 37 条原子意图（28 outcome + 4 route + 4 checkpoint + 1 callback），保留现有 ID 和来源字段。
2. **已完成：** 更新 11 个现有场景的 `family`、`objective`、`actors`、`preconditions`、`testDataNeeds`、`expectedBusinessOutcomes`，保留现有 ID 和成员关系。
3. **已完成：** 新 Facade 进程读回 37/37 条 draft 意图、11/11 个 draft 场景；精确 ID 集合、37 条意图与场景的成员关联及修订字段均与本稿一致。Store 来源 ID 保留；TestDataProfile 的有效数量与引用仍未复核。
4. 清理已由用户明确确认的 Eval 待办（固定 28 分母、当前路线版本、关闭规则、附件草稿范围、流程管理员/HSSC/职级处置），但不以这些确认关闭需要系统证据的 Gap。
5. 剩余评估至少保留：系统角色/路由任务实测、独立后置查询、合成替补、实习终态、Offer 本地路由/字段/附件、Offer/OA 副作用、外部 OEHR/Beisen、薪酬配置/导出清单、测试数据资料质量。
6. Critic/Eval 通过前不批准基线；只有 baseline、system/auth、data、postcondition 等独立门禁通过后，才建立真实 Trial。真实执行另开 Trial，不手改 Store 填写成功。

## 5. Facade 写回与实际 Store 回读

预览阶段由 Brain Creator stdio Facade 读取活动 Store，并确认目标为 `requirementSet_n61e346r`、状态 `draft`、TestIntent/BusinessScenario ID 与本稿完整匹配；预览 hash 为 `3e2b7aa7446aa8e0a806e34e915b9a2d35ed1bbc0260fd7f2ab45f5667c3f4ef`。随后通过 `bc_prepare action=revise-test-design-draft` 写回 37/11 的字段修订。写入响应返回 `status=revised`，但未返回 RequirementSet 状态字段，因此另外启动全新 Facade 进程做实际 Store 回读，而未单凭写入响应判定成功。

新进程回读确认：Store 中仍是 37/37 draft TestIntent、11/11 draft BusinessScenario；37 个现有 ID、11 个场景 ID 和成员映射保持一致；意图目标、前置条件与预期结果，以及场景分类、角色、数据需要和业务结果与本稿一致。RequirementSet 仍为 `draft`，`sourceId` 仍为 `requirementSource_dx9nznvc`。本次运行身份报告包版本 2.1.1、schema 21、MCP workspace `trust-closure-main`、commit `7adc734af2edd04b68af47f9666bd4ed16fc0c1f` 和 build ID `853e77d4ec213078c10cfc63548e0d22bb9b4bb72e0dd947bd9f91845857e3ea`；该 commit 字段仅表示 Git HEAD，调用时产品源码有未提交修改，故 build ID 与回读证据才用于识别本次候选运行，不能把该 HEAD 误报为已合并版本。

本次原地修订保留了既有来源链，并未把旧源改写成正式 Lark 来源：`requirementSet_n61e346r` 的来源仍是 `local-file` 修订 v4，hash 为 `c93bc0c6e793dbf74e8cd0dacfca516dd6527193db2af6a3e0e570e67520c8d0`；正式 Lark 源集合另存为 `requirementSource_8dk46kq4`，主文档 revision 2045。候选稿的正式来源快照清单位于 `test5-ghr-source-manifest-2026-10-26.json`。旧 Store 曾有 5 条 TestDataProfile 的只读计数，但本次 Facade 的 test-data review 不返回按 RequirementSet 聚合的 profile 清单；数据资料数量与有效引用仍未复核，来源对齐、Critic/Eval 和独立 Trial 准入仍未完成。
