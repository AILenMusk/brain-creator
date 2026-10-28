# Test5 GHR 37 条意图与 11 个场景复核（2026-10-29）

## 当前结论

本报告核对 Brain Creator 当前持久化的本地 Test5 集团/GHR 候选设计。当前 RequirementSet 是 draft，Coverage Critic 为 needs-review，11 个场景的 Scenario Assurance 全部 blocked。本报告只验收草稿结构与关联；不批准基线、不映射固定 outcome、不启动 Trial，也不代表 Test5 业务执行结果。

本次没有运行 Test5 业务流程，没有创建、提交、转交、审批、关闭或清理业务记录。用户已确认的路由 Oracle 继续使用 Test5 当前生效 hc招聘需求流程 Proc000019 v9；配置仍须通过新运行的任务/业务状态独立验证。

## Brain Creator 身份与范围

| 项目 | 当前值 |
|---|---|
| Requirement source | requirementSource_la1u6or0，revision 4 |
| Requirement source contentHash | 40c12674d8c0959c33b075d3e5f7e77afd12b89e3bafdeea8b4d3c982d850401 |
| Harness 原始输入快照 SHA-256 | aeca490c94e77b876b59adb4e8082cb588c6492527ebd2433e566b0113dc964d |
| RequirementSet | requirementSet_s200mxe8，version 4，draft |
| RequirementSet contentHash | 40c12674d8c0959c33b075d3e5f7e77afd12b89e3bafdeea8b4d3c982d850401 |
| Latest Host Harness session | brainSession_snt8ep6u |
| Coverage Critic | needs-review |
| Target system | system_nny1q7wk（Test5 集团/GHR） |
| Frozen local-GHR denominator | 28 outcomes；本轮映射 0/28 |

## 数量和关联

| 资产 | 当前值 | 复核 |
|---|---:|---|
| 原始 TestIntent 追溯行 | 37 | 37 个原始 ID 均保留在修订矩阵 |
| Draft TestIntent | 37 | 37 draft；0 个未关联场景 |
| 活动 Draft BusinessScenario | 11 | 11 个关联意图；0 个孤立场景 |
| 历史 stale BusinessScenario | 36 | 保留为历史，不计入活动场景数 |
| TestDataProfile | 0 | 当前没有数据档案；没有生成职位、部门、Offer 或业务记录数据 |
| Scenario Assurance | 11/11 blocked | 0 pass；0 needs-review |
| EvaluationTrial | 0 | 没有真实 Trial |
| 固定 outcome 映射 | 0/28 | blocked/not-executed 保留分母 |

37 个活动 TestIntent 的组成是：32 条独立矩阵条款、1 条用户确认的回调映射补充条款、4 条路由 WorkflowModel 路径意图。原始矩阵中的 5 条共享范围、Oracle、证据、授权与通用起点约束保留追溯，不重复生成独立 TestIntent。

## 11 个活动场景

| 场景 | Brain Creator ID | 活动标题 | 关联 TestIntent | 数据计划 | Assurance | 当前候选预期摘要 |
|---|---|---|---:|---|---|---|
| GHR-ROUTE-01 | scenario_5b138e9171bc5552 | GHR-ROUTE-01 海外 × 部门 2/3 级（截止首位部门负责人任务）: 创建并提交招聘需求 → 地区=海外 → 部门层级=2/3级 | 8 | blocked | blocked | 路由断言：当部门层级命中 2/3 级条件时，本轮边界为出现“需求部门负责人”审批任务。；路由区分：海外与国内默认路线必须分开建场景、分开核验，不得以一条路径代表另一条。；路径边界：地区×部门层级构成四个独立候选前缀；每条只验证到首位部门负责人任务，不把它称为完整审批终态。；地区入口：海外需求经 HRBP 到 HRBP_TA；国内默认需求直接进入 HRBP_TA。；部门分支：HRBP_TA 后按部门层级分别命中 2/3 级和默认分支。；部门 2/3 级 Oracle：命中条件后的首个部门审批任务为“需求部门负责人”。；海外路径 Oracle：审批任务顺序包含 HRBP → HRBP_TA，随后才进入部门层级分支。；当前登录账号 performs 创建并提交招聘需求: 招聘需求草稿 → 招聘需求已提交；地区=海外: 招聘需求已提交 → HRBP审批任务；HRBP performs complete transition HRBP审批任务 → HRBP_TA审批任务；HRBP_TA performs 部门层级=2/3级: HRBP_TA审批任务 → 需求部门负责人审批任务；The modeled path reaches 需求部门负责人审批任务；创建并提交招聘需求 → 招聘需求已提交；地区=海外 → HRBP审批任务；达到 HRBP_TA审批任务；部门层级=2/3级 → 需求部门负责人审批任务；需求部门负责人审批任务 |
| GHR-ROUTE-02 | scenario_6dd953bad63038aa | GHR-ROUTE-02 海外 × 部门默认（截止首位部门负责人任务）: 创建并提交招聘需求 → 地区=海外 → 部门层级=默认 | 8 | blocked | blocked | 路由断言：当部门层级命中 2/3 级条件时，本轮边界为出现“需求部门负责人”审批任务。；路由区分：海外与国内默认路线必须分开建场景、分开核验，不得以一条路径代表另一条。；路径边界：地区×部门层级构成四个独立候选前缀；每条只验证到首位部门负责人任务，不把它称为完整审批终态。；地区入口：海外需求经 HRBP 到 HRBP_TA；国内默认需求直接进入 HRBP_TA。；部门分支：HRBP_TA 后按部门层级分别命中 2/3 级和默认分支。；部门默认 Oracle：默认分支的首个部门审批任务为“四级部门负责人”。；海外路径 Oracle：审批任务顺序包含 HRBP → HRBP_TA，随后才进入部门层级分支。；当前登录账号 performs 创建并提交招聘需求: 招聘需求草稿 → 招聘需求已提交；地区=海外: 招聘需求已提交 → HRBP审批任务；HRBP performs complete transition HRBP审批任务 → HRBP_TA审批任务；HRBP_TA performs 部门层级=默认: HRBP_TA审批任务 → 四级部门负责人审批任务；The modeled path reaches 四级部门负责人审批任务；创建并提交招聘需求 → 招聘需求已提交；地区=海外 → HRBP审批任务；达到 HRBP_TA审批任务；部门层级=默认 → 四级部门负责人审批任务；四级部门负责人审批任务 |
| GHR-ROUTE-03 | scenario_82527f9f19e9a180 | GHR-ROUTE-03 国内默认 × 部门 2/3 级（截止首位部门负责人任务）: 创建并提交招聘需求 → 地区=国内默认 → 部门层级=2/3级 | 8 | blocked | blocked | 路由断言：当部门层级命中 2/3 级条件时，本轮边界为出现“需求部门负责人”审批任务。；路由区分：海外与国内默认路线必须分开建场景、分开核验，不得以一条路径代表另一条。；路径边界：地区×部门层级构成四个独立候选前缀；每条只验证到首位部门负责人任务，不把它称为完整审批终态。；地区入口：海外需求经 HRBP 到 HRBP_TA；国内默认需求直接进入 HRBP_TA。；部门分支：HRBP_TA 后按部门层级分别命中 2/3 级和默认分支。；部门 2/3 级 Oracle：命中条件后的首个部门审批任务为“需求部门负责人”。；国内默认路径 Oracle：地区入口应直接进入 HRBP_TA，不经过海外 HRBP 节点。；当前登录账号 performs 创建并提交招聘需求: 招聘需求草稿 → 招聘需求已提交；地区=国内默认: 招聘需求已提交 → HRBP_TA审批任务；HRBP_TA performs 部门层级=2/3级: HRBP_TA审批任务 → 需求部门负责人审批任务；The modeled path reaches 需求部门负责人审批任务；创建并提交招聘需求 → 招聘需求已提交；地区=国内默认 → HRBP_TA审批任务；部门层级=2/3级 → 需求部门负责人审批任务；需求部门负责人审批任务 |
| GHR-ROUTE-04 | scenario_36c2c1379b63cf9d | GHR-ROUTE-04 国内默认 × 部门默认（截止首位部门负责人任务）: 创建并提交招聘需求 → 地区=国内默认 → 部门层级=默认 | 8 | blocked | blocked | 路由断言：当部门层级命中 2/3 级条件时，本轮边界为出现“需求部门负责人”审批任务。；路由区分：海外与国内默认路线必须分开建场景、分开核验，不得以一条路径代表另一条。；路径边界：地区×部门层级构成四个独立候选前缀；每条只验证到首位部门负责人任务，不把它称为完整审批终态。；地区入口：海外需求经 HRBP 到 HRBP_TA；国内默认需求直接进入 HRBP_TA。；部门分支：HRBP_TA 后按部门层级分别命中 2/3 级和默认分支。；部门默认 Oracle：默认分支的首个部门审批任务为“四级部门负责人”。；国内默认路径 Oracle：地区入口应直接进入 HRBP_TA，不经过海外 HRBP 节点。；当前登录账号 performs 创建并提交招聘需求: 招聘需求草稿 → 招聘需求已提交；地区=国内默认: 招聘需求已提交 → HRBP_TA审批任务；HRBP_TA performs 部门层级=默认: HRBP_TA审批任务 → 四级部门负责人审批任务；The modeled path reaches 四级部门负责人审批任务；创建并提交招聘需求 → 招聘需求已提交；地区=国内默认 → HRBP_TA审批任务；部门层级=默认 → 四级部门负责人审批任务；四级部门负责人审批任务 |
| GHR-CALLBACK-01 | scenario_8300c8d2c87ec50a | Test5 集团/GHR Offer: 来源回调状态为“已接收”时，Test5 同一 Offer 实体列表状态应为“已接受offer”；结果必须通过同一实体的独立查询验证。 | 1 | blocked | blocked | 来源回调状态为“已接收”时，Test5 同一 Offer 实体列表状态应为“已接受offer”；结果必须通过同一实体的独立查询验证。 |
| GHR-CLOSE-01 | scenario_96e2fa335ada2323 | GHR-CLOSE 需求关闭规则: 关联 Offer 状态=无关联 Offer | 5 | blocked | blocked | 仅当页面操作列提供关闭动作时才允许关闭。；关闭成功后独立查询招聘需求状态应为已关闭；不推断 Offer/OA 状态变化。 |
| GHR-CLOSE-02 | scenario_f143528624c69a80 | GHR-CLOSE 需求关闭规则: 关联 Offer 状态=任一已接受offer或已发offer（含混合状态） | 3 | blocked | blocked | 阻止直接关闭；不得确认关闭提示。；需求不得被记为已关闭；独立查询需求与同一 Offer 状态。 |
| GHR-CLOSE-03 | scenario_75ea9017a6ce1ebb | GHR-CLOSE 需求关闭规则: 关联 Offer 状态=其他关联状态且无已接受offer/已发offer | 5 | blocked | blocked | 显示二次确认；只有当前账号确认后才继续关闭。；成功后独立查询招聘需求状态应为已关闭，并分别核验 Offer 状态。 |
| GHR-ROUTE-05 | scenario_c720c2e51e8282db | GHR 本轮分支处置: 分支类别=用户暂缓职级条件 | 14 | blocked | blocked | 记为not-executed；相关outcome保留在固定28项分母。；不得创建或选用职级测试数据，不触发该路径。 |
| GHR-ROUTE-07 | scenario_5338adea0517010a | GHR 本轮分支处置: 分支类别=personnelType=2实习生 | 3 | blocked | blocked | 保持blocked；下一审批角色与终态未定义时不触发写入路径。；不推断审批通过或终态。 |
| GHR-SCOPE-01 | scenario_e633f5677c264249 | GHR 本轮分支处置: 分支类别=HSSC系统管理员 | 1 | blocked | blocked | 记为not-executed且保留相关outcome在28项分母；流程管理员支线排除。 |

路由场景均截止首位部门负责人任务，不表示后续审批完成。关闭规则按用户确认优先级区分无关联 Offer、任一已接受/已发阻止直关、其他关联状态二次确认。职级支线按用户指示 not-executed；实习生支线因后续角色/终态未定义保持 blocked；HSSC 系统管理员 outcome not-executed 并留在分母，流程管理员支线排除。回调场景只保留用户确认的“已接收”→Test5 同一 Offer“已接受offer”映射，安全本地夹具和独立查询仍未验证。

## 37 个活动 TestIntent 的持久化 ID 与场景关系

| TestIntent ID | 来源归属 | Brain Creator 意图 | 关联场景 |
|---|---|---|---|
| intent_xygax4xn | 原始意图 intent_3cxsphum（矩阵行 2） | Test5 集团/GHR: 范围处置：HSSC 系统管理员分支记为 not-executed 且保留在固定 28 项分母；流程管理员分支排除。 | GHR-SCOPE-01 (scenario_e633f5677c264249) |
| intent_2apu67eo | 原始意图 intent_c9e5na10（矩阵行 4） | Test5 集团/GHR: 实习生路径：personnelType=2 与职级判断分开；下一审批角色及终态未定义，因此不得断言后续角色或通过状态。 | GHR-ROUTE-07 (scenario_5338adea0517010a) |
| intent_uxnzbn43 | 原始意图 intent_j6t5mwr1（矩阵行 5） | Test5 集团/GHR: 执行范围：依赖职级条件 ID 的分支本轮记为 not-executed；页面能显示职级选项不等于分支已覆盖。 | GHR-ROUTE-05 (scenario_c720c2e51e8282db) |
| intent_70m2g3hl | 原始意图 intent_w5o5nb1k（矩阵行 6） | Test5 集团/GHR: 执行范围：职级 >3-3 后进入 CEO/流程结束的路径本轮记为 not-executed。 | GHR-ROUTE-05 (scenario_c720c2e51e8282db) |
| intent_0otd9dso | 原始意图 intent_vj7d2o63（矩阵行 7） | Test5 集团/GHR: 路由断言：当部门层级命中 2/3 级条件时，本轮边界为出现“需求部门负责人”审批任务。 | GHR-ROUTE-01 (scenario_5b138e9171bc5552); GHR-ROUTE-02 (scenario_6dd953bad63038aa); GHR-ROUTE-03 (scenario_82527f9f19e9a180); GHR-ROUTE-04 (scenario_36c2c1379b63cf9d) |
| intent_nq1li5bu | 原始意图 intent_579posqm（矩阵行 8） | Test5 集团/GHR: 路由区分：海外与国内默认路线必须分开建场景、分开核验，不得以一条路径代表另一条。 | GHR-ROUTE-01 (scenario_5b138e9171bc5552); GHR-ROUTE-02 (scenario_6dd953bad63038aa); GHR-ROUTE-03 (scenario_82527f9f19e9a180); GHR-ROUTE-04 (scenario_36c2c1379b63cf9d) |
| intent_rqg0qk6d | 原始意图 intent_yblcuxed（矩阵行 9） | Test5 集团/GHR: 关闭分支：将无关联 Offer、任一 Offer 为已接受/已发、其他关联 Offer 状态分别判定。 | GHR-CLOSE-01 (scenario_96e2fa335ada2323); GHR-CLOSE-02 (scenario_f143528624c69a80); GHR-CLOSE-03 (scenario_75ea9017a6ce1ebb) |
| intent_s05vsllp | 原始意图 intent_5zo2ti0m（矩阵行 11） | Test5 集团/GHR: 关闭后置条件：允许关闭并确认成功后，独立查询的招聘需求状态应为“已关闭”；被阻止的路径不得得到该断言。 | GHR-CLOSE-01 (scenario_96e2fa335ada2323); GHR-CLOSE-03 (scenario_75ea9017a6ce1ebb) |
| intent_50fo697s | 原始意图 intent_zkhgpuc2（矩阵行 13） | Test5 集团/GHR: 路径边界：地区×部门层级构成四个独立候选前缀；每条只验证到首位部门负责人任务，不把它称为完整审批终态。 | GHR-ROUTE-01 (scenario_5b138e9171bc5552); GHR-ROUTE-02 (scenario_6dd953bad63038aa); GHR-ROUTE-03 (scenario_82527f9f19e9a180); GHR-ROUTE-04 (scenario_36c2c1379b63cf9d) |
| intent_05hgea76 | 原始意图 intent_5vzxooij（矩阵行 14） | Test5 集团/GHR: 关闭分支：Offer 关联状态分为无关联、接受/已发阻止、其他状态二次确认三类独立结果。 | GHR-CLOSE-01 (scenario_96e2fa335ada2323); GHR-CLOSE-02 (scenario_f143528624c69a80); GHR-CLOSE-03 (scenario_75ea9017a6ce1ebb) |
| intent_u1mouc6g | 原始意图 intent_2causjsi（矩阵行 15） | Test5 集团/GHR: 关闭优先级：先读取关联 Offer；任一为已接受offer或已发offer即阻止直关，其他组合二次确认；无关联时仅使用页面实际提供的关闭动作。 | GHR-CLOSE-01 (scenario_96e2fa335ada2323); GHR-CLOSE-02 (scenario_f143528624c69a80); GHR-CLOSE-03 (scenario_75ea9017a6ce1ebb) |
| intent_cn6intc3 | 原始意图 intent_nnt1mr8p（矩阵行 16） | Test5 集团/GHR: 执行范围：从二级部门负责人继续到 HRBP 经理的后续边依赖暂缓的职级条件，本轮不得触发。 | GHR-ROUTE-05 (scenario_c720c2e51e8282db) |
| intent_phwqz96j | 原始意图 intent_nku2r45s（矩阵行 18） | Test5 集团/GHR: 关闭后置条件：无 Offer 直关或其他状态经二次确认关闭后，需求状态应为“已关闭”。 | GHR-CLOSE-01 (scenario_96e2fa335ada2323); GHR-CLOSE-03 (scenario_75ea9017a6ce1ebb) |
| intent_zleh9xff | 原始意图 intent_e2rl8k3y（矩阵行 19） | Test5 集团/GHR: 执行范围：嵌套职级 <=2-3 到二级部门负责人的路径本轮记为 not-executed。 | GHR-ROUTE-05 (scenario_c720c2e51e8282db) |
| intent_m5gzurmq | 原始意图 intent_lys1dxlb（矩阵行 20） | Test5 集团/GHR: 执行范围：职级 >3-3 到流程结束的路径本轮记为 not-executed。 | GHR-ROUTE-05 (scenario_c720c2e51e8282db) |
| intent_euu9zzfx | 原始意图 intent_ae82y3uk（矩阵行 21） | Test5 集团/GHR: 执行范围：职级 >3-3 到 CEO 的路径本轮记为 not-executed。 | GHR-ROUTE-05 (scenario_c720c2e51e8282db) |
| intent_sa59atwy | 原始意图 intent_baqbwgap（矩阵行 22） | Test5 集团/GHR: 执行范围：三级部门负责人之后转 HRBP 经理的职级路径本轮记为 not-executed。 | GHR-ROUTE-05 (scenario_c720c2e51e8282db) |
| intent_bfv00nfb | 原始意图 intent_beteu7cs（矩阵行 23） | Test5 集团/GHR: 分支隔离：实习生分支因后续 Oracle 未定义保持 blocked；其中独立的职级 >2-3 分支按用户决定记为 not-executed。 | GHR-ROUTE-07 (scenario_5338adea0517010a) |
| intent_nuz00tyd | 原始意图 intent_5j62yh7l（矩阵行 24） | Test5 集团/GHR: 执行范围：四级部门负责人之后依赖的职级条件路径本轮记为 not-executed。 | GHR-ROUTE-05 (scenario_c720c2e51e8282db) |
| intent_vzb0inka | 原始意图 intent_o3oi3j6p（矩阵行 25） | Test5 集团/GHR: 执行范围：需求部门负责人之后依赖的职级条件路径本轮记为 not-executed。 | GHR-ROUTE-05 (scenario_c720c2e51e8282db) |
| intent_65uv65q8 | 原始意图 intent_xhov83bo（矩阵行 26） | Test5 集团/GHR: 执行范围：嵌套职级 <=2-3 判断及其后续边本轮记为 not-executed。 | GHR-ROUTE-05 (scenario_c720c2e51e8282db) |
| intent_5b6c16ki | 原始意图 intent_vic2koq0（矩阵行 27） | Test5 集团/GHR: 执行范围：职级条件导向三级部门负责人的路径本轮记为 not-executed。 | GHR-ROUTE-05 (scenario_c720c2e51e8282db) |
| intent_npgontsw | 原始意图 intent_cks0cjkr（矩阵行 28） | Test5 集团/GHR: 执行范围：CEO 到流程结束的后续路径本轮记为 not-executed。 | GHR-ROUTE-05 (scenario_c720c2e51e8282db) |
| intent_y6i2k3o0 | 原始意图 intent_qyjkes9b（矩阵行 29） | Test5 集团/GHR: 执行范围：CHO 后的嵌套职级 >3-3 判断本轮记为 not-executed。 | GHR-ROUTE-05 (scenario_c720c2e51e8282db) |
| intent_rrr6w7qu | 原始意图 intent_czetarmf（矩阵行 30） | Test5 集团/GHR: 执行范围：虽然配置可见 HRBP 负责人到 CHO 的边，本轮仍记为 not-executed，不据配置宣称已覆盖。 | GHR-ROUTE-05 (scenario_c720c2e51e8282db) |
| intent_ns8awfu6 | 原始意图 intent_ca80qvkk（矩阵行 31） | Test5 集团/GHR: 分支隔离：实习生判断因后续角色/终态未定义保持 blocked；职级 >2-3 分支按用户决定记为 not-executed。 | GHR-ROUTE-07 (scenario_5338adea0517010a) |
| intent_89cfwmpb | 原始意图 intent_ztgtlzam（矩阵行 32） | Test5 集团/GHR: 地区入口：海外需求经 HRBP 到 HRBP_TA；国内默认需求直接进入 HRBP_TA。 | GHR-ROUTE-01 (scenario_5b138e9171bc5552); GHR-ROUTE-02 (scenario_6dd953bad63038aa); GHR-ROUTE-03 (scenario_82527f9f19e9a180); GHR-ROUTE-04 (scenario_36c2c1379b63cf9d) |
| intent_8ll9o9q0 | 原始意图 intent_hlleg6vz（矩阵行 33） | Test5 集团/GHR: 部门分支：HRBP_TA 后按部门层级分别命中 2/3 级和默认分支。 | GHR-ROUTE-01 (scenario_5b138e9171bc5552); GHR-ROUTE-02 (scenario_6dd953bad63038aa); GHR-ROUTE-03 (scenario_82527f9f19e9a180); GHR-ROUTE-04 (scenario_36c2c1379b63cf9d) |
| intent_6y2nzedt | 原始意图 intent_ois68f24（矩阵行 34） | Test5 集团/GHR: 部门默认 Oracle：默认分支的首个部门审批任务为“四级部门负责人”。 | GHR-ROUTE-02 (scenario_6dd953bad63038aa); GHR-ROUTE-04 (scenario_36c2c1379b63cf9d) |
| intent_3hm7fm6o | 原始意图 intent_wtw3orxy（矩阵行 35） | Test5 集团/GHR: 部门 2/3 级 Oracle：命中条件后的首个部门审批任务为“需求部门负责人”。 | GHR-ROUTE-01 (scenario_5b138e9171bc5552); GHR-ROUTE-03 (scenario_82527f9f19e9a180) |
| intent_424xftrs | 原始意图 intent_85kuafrj（矩阵行 36） | Test5 集团/GHR: 海外路径 Oracle：审批任务顺序包含 HRBP → HRBP_TA，随后才进入部门层级分支。 | GHR-ROUTE-01 (scenario_5b138e9171bc5552); GHR-ROUTE-02 (scenario_6dd953bad63038aa) |
| intent_6v1am8n5 | 原始意图 intent_1jso11kw（矩阵行 37） | Test5 集团/GHR: 国内默认路径 Oracle：地区入口应直接进入 HRBP_TA，不经过海外 HRBP 节点。 | GHR-ROUTE-03 (scenario_82527f9f19e9a180); GHR-ROUTE-04 (scenario_36c2c1379b63cf9d) |
| intent_twivdovr | 用户确认的回调映射（补充条款） | Test5 集团/GHR Offer: 来源回调状态为“已接收”时，Test5 同一 Offer 实体列表状态应为“已接受offer”；结果必须通过同一实体的独立查询验证。 | GHR-CALLBACK-01 (scenario_8300c8d2c87ec50a) |
| intent_5cw9fmtd | 路径模型生成：GHR-ROUTE-03 国内默认 × 部门 2/3 级（截止首位部门负责人任务） | Test5 集团/GHR: 地区=国内默认 AND 部门层级=2/3级 | GHR-ROUTE-03 (scenario_82527f9f19e9a180) |
| intent_js7cj3yl | 路径模型生成：GHR-ROUTE-01 海外 × 部门 2/3 级（截止首位部门负责人任务） | Test5 集团/GHR: 地区=海外 AND 部门层级=2/3级 | GHR-ROUTE-01 (scenario_5b138e9171bc5552) |
| intent_xbhwdwwd | 路径模型生成：GHR-ROUTE-04 国内默认 × 部门默认（截止首位部门负责人任务） | Test5 集团/GHR: 地区=国内默认 AND 部门层级=默认 | GHR-ROUTE-04 (scenario_36c2c1379b63cf9d) |
| intent_ynp84w4g | 路径模型生成：GHR-ROUTE-02 海外 × 部门默认（截止首位部门负责人任务） | Test5 集团/GHR: 地区=海外 AND 部门层级=默认 | GHR-ROUTE-02 (scenario_6dd953bad63038aa) |

## 模型与 Assurance 结果

- 模型数量：2 BusinessObjectModels、4 WorkflowModels、0 StateMachineModels、2 DecisionTableModels。
- bc_prepare action=assess-scenarios 针对上述 11 个活动场景及 Test5 系统执行：**11 blocked / 0 pass / 0 needs-review**。
- bc_review target=scenario-assurance：**11 个 System Brain binding missing、11 个 Oracle limited、11 个 test-data readiness blocked**。路由/关闭/回调结论目前仍是来源绑定的自由文本结果，不能称为强 Oracle。
- Test5 bc_status readiness 为 blocked：1 个 AuthProfile、0 个 verified AuthProfiles、1 个待完成 Auth checkpoint；TestData Provider 与自动后置条件校验未配置。

## 尚未通过的门禁

- RequirementSet 仍为 draft，Requirement Eval gate 为 blocked；本报告未批准正式基线。
- 11 个活动场景都没有经确认的 System Brain 页面/动作绑定、场景级数据计划与结构化业务 Oracle。
- Fresh Auth readiness 未通过；不得运行真实 Test5 写入。
- 固定 28 outcome 尚未逐项映射，0/28；不从分母移除 blocked 或未执行项。
- 回调本地夹具、Beisen/OEHR 外部边界及独立同实体后置查询仍未验收。

本报告不把合成结果计入真实业务度，也不把 draft/needs-review/blocked 转换为通过。E 仍 blocked、真实业务证据 0/28；F 仍 partial。当前代码候选 PR #187 未合并；无 npm 发布。
