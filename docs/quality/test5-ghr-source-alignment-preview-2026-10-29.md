# Test5 GHR 37/11 来源锚点对齐记录

**状态：** 用户已确认来源对齐策略；Brain Creator Facade 已完成 37/11 对齐，且新进程回读通过。它不批准 RequirementSet、28 条 outcome Oracle、基线或 Trial。

## 当前来源事实

- 待核对集合：`requirementSet_n61e346r`，37 个 TestIntent、11 个 BusinessScenario，均为 draft。
- 当前集合已引用正式飞书源 `requirementSource_8dk46kq4`，内容 hash 为 `eb3511da524718e7b03f36e68d46f4994f7ad3b9ab3a72107d1d91500195f065`；原本地设计源 `requirementSource_dx9nznvc`（v4，SHA-256 `c93bc0c6e793dbf74e8cd0dacfca516dd6527193db2af6a3e0e570e67520c8d0`）仍保留。正式主文档 revision 2045；流程梳理子文档 revision 5。
- 当前 Store 回读的主文档 `contentHash` 为 `eb3511da524718e7b03f36e68d46f4994f7ad3b9ab3a72107d1d91500195f065`。导入的附件/子表内容被展平在同一源内容的后续行；引用下表行号时须同时保持该源 hash。
- 以下 `F#N` 表示 `source:requirementSource_8dk46kq4#line:N`；`L#N` 表示旧本地设计源的行，仅作为用户决定/修订历史的追踪，不替代正式需求。Test5 路线使用已保存的用户确认 `user-confirmation://codex/2026-10-28/test5-ghr-route-clarification`，不拿一般流程图替代当前系统配置。
- 任何源锚点映射都不改变 37/11 ID、成员关系、草稿状态、固定 28 分母或 Oracle。用户已确认来源策略；Brain Creator 已完成完整预览、确认与新进程回读。

## 37 条 TestIntent 候选锚点

| 意图 | TestIntent ID | 正式来源候选 | 说明/保留项 |
|---|---|---|---|
| GHR-REQ-01 | `intent_kpkmsf90` | F#80、F#152、需求字段 F#218–226；Test5 路线另引用户确认 | 状态回写、创建字段、确认关闭后的需求终态；真实任务顺序仍须从该需求审批记录取证。 |
| GHR-REQ-02 | `intent_oxmrs77n` | F#218、F#221–226 | 职位必填、职位职级范围、实习生不校验编制数。后续审批角色/终态未定义。 |
| GHR-REQ-03a | `intent_8l0g46yj` | F#227–228 | 替补类型与替补人员必填；不把真实员工用作合成替补。 |
| GHR-REQ-03b | `intent_7cl5k1ay` | F#227–228 | 同上；合成替补资格仍需验证。 |
| GHR-REQ-04a | `intent_sio5rp6p` | F#80 | 驳回至提交人后回草稿。 |
| GHR-REQ-04b | `intent_3dq97yx1` | F#80 | 提交人撤回后回草稿。 |
| GHR-REQ-05 | `intent_mzktym1i` | F#80 | 流程作废后为“已废弃”，与关闭区分。 |
| GHR-REQ-06a | `intent_chlyhya5` | F#141–145 | 单独“已接受offer”阻止直接关闭。 |
| GHR-REQ-06b | `intent_b7mytka1` | F#141–145 | 单独“已发offer”阻止直接关闭；官方文字同时覆盖该状态。 |
| GHR-REQ-06c | `intent_mqaww5p2` | F#146–152 | “审批中”二次确认；确认后需求“已关闭”、关联 Offer “已废弃”，审批流程副作用需独立读回。 |
| GHR-REQ-06d | `intent_bb5ezyma` | F#146–152 | “待发offer”二次确认；确认后需求与 Offer 的目标状态如上。 |
| GHR-REQ-06e | `intent_e53qo1o3` | F#146、F#154 | 取消确认不执行任何操作。 |
| GHR-REQ-06f | `intent_xa1ozl07` | F#146、F#154 | 取消确认不执行任何操作。 |
| GHR-REQ-06g | `intent_gb6n3mu4` | F#141–154；L#11 | 两个混合态数据组合。任一“已接受/已发”优先阻止是用户已确认规则，旧本地行只保留决定轨迹。 |
| GHR-REQ-06h | `intent_upvh53zc` | F#141–154；L#11 | 同上；该 outcome 的两个混合态组合须分别保留。 |
| GHR-OFFER-01 | `intent_39oofw0w` | F#98、F#102、正式员工 Offer 字段 F#424–455；范围另引 L#10 | 表单与审批状态可追溯。正式来源 F#90 表示集团/GOFO 国内 Offer 转北森；本地 Test5 GHR 是否存在适用的正式员工 Offer 路径须由系统证据确认，不能从表单来源推定。 |
| GHR-OFFER-02 | `intent_t2ooun1y` | F#98、F#102、实习生 Offer 字段 F#710–745、需求职级 F#221–224 | 仅核对来源已定义字段和需求关联；审批后续角色/终态保持未定义。 |
| GHR-OFFER-03a | `intent_j6gzbxdu` | F#106、F#111 | “待发offer”转“已发offer”。 |
| GHR-OFFER-03c | `intent_opu7g6jx` | F#106、F#113 | “待发offer”转“已拒绝offer”。 |
| GHR-OFFER-03d | `intent_hwmiagpv` | F#106、F#114 | “已发offer”转“待发offer”。 |
| GHR-OFFER-03f | `intent_bs9yvosp` | F#106、F#116 | “已发offer”转“已拒绝offer”。 |
| GHR-OFFER-03k | `intent_trew459l` | F#121、F#126–129 | “已拒绝offer”转“待发offer”及停编/占用保护条件；数据分支须分别验证。 |
| GHR-OFFER-03l | `intent_vgrsa27e` | F#122、F#126–129 | “已拒绝offer”转“已发offer”及同一保护条件。 |
| GHR-COMP-01 | `intent_2qi53frh` | F#178–180 | “适用用工形式”必填、多选及列表/导出字段。 |
| GHR-PAY-01 | `intent_hv95r4i1` | F#158–168 | 薪酬项目、计薪制度、区域、用工形式和字段展示；依赖 OEHR 查询的实际返回值未在本地目标验证，保持 blocked。 |
| GHR-STAFF-01 | `intent_qfbteqfj` | F#171–176；流程管理员排除说明见 L#14 | 旧流程迁移仍为固定 outcome；用户指定 HSSC 系统管理员分支 not-executed，保留分母。 |
| GHR-QUERY-01 | `intent_tre1kslm` | F#76、F#80、F#182–184 | 查询条件、状态和列表核对；运行时须使用本轮合成实体编码。 |
| GHR-QUERY-02 | `intent_zxwblnq4` | F#76、F#182–184 | 列表/导出范围；须先冻结字段与筛选清单，禁止带出无关人员数据。 |
| GHR-ROUTE-01 | `intent_9nzupas3` | `user-confirmation://codex/2026-10-28/test5-ghr-route-clarification` | Test5 当前配置路线 Oracle；一般流程图 F#176 不覆盖此系统裁决。 |
| GHR-ROUTE-02 | `intent_s4yo0ms4` | 同上 | 同上。 |
| GHR-ROUTE-03 | `intent_2b79jh14` | 同上 | 同上。 |
| GHR-ROUTE-04 | `intent_0cgz00at` | 同上 | 同上。 |
| GHR-CHECK-01 | `intent_90bvcgix` | 需求字段 F#218–234、列表 F#76/F#184 | 创建后同码查询；草稿值按同实体读回。 |
| GHR-CHECK-02 | `intent_jyz43tx7` | F#80 | 提交后“审批中”和任务/审批记录分开读回。 |
| GHR-CHECK-03 | `intent_1vwesyoh` | F#80 | 批准后“进行中”；实际路线来自 Test5 用户确认，结果由审批记录证明。 |
| GHR-CHECK-04 | `intent_2kjcdlp7` | F#68、F#152 | 无关联 Offer 且页面提供关闭动作时，终态为“已关闭”。 |
| GHR-CALLBACK-01 | `intent_boiaj0l5` | L#12（用户确认补充映射） | 28 条分母外；没有安全本地回调夹具前保持 blocked，不向 Beisen/OEHR 发送事件。 |

## 11 个 BusinessScenario 聚合来源候选

| 场景 | 候选来源 | 需要保持的隔离/阻塞 |
|---|---|---|
| S01 正式需求闭环与当前路线 | F#80、F#152、F#218–226；Test5 路线用户确认 | 4 条路由分别使用独立合成需求；地区/部门字段必须从页面读回。 |
| S02 无编制实习需求与实习 Offer | F#98、F#102、F#218–226、F#710–745 | 后续审批角色/终态未定义；不能因职位授权推断数据已存在。 |
| S03 替补必填与合成替补 | F#227–228 | 不选择现有员工；资格数据尚未核验。 |
| S04 驳回与撤回 | F#80 | 两个动作和角色分开验证。 |
| S05 流程作废 | F#80 | 不与“已关闭”合并。 |
| S06 需求关闭与 Offer 状态矩阵 | F#141–154；L#11 | 8 个固定 outcome、10 个独立组合；混合优先级保留用户决定轨迹。 |
| S07 正式员工 Offer | F#98、F#102、F#424–455；L#10 | 本地 GHR 适用路径仍需目标系统证据。 |
| S08 本地 Offer 状态转移 | F#106–129 | `已接受offer`相关 OEHR 写入路径不作为本地成功；回归范围按已批准本地分支裁剪但固定 outcome 不删。 |
| S09 薪酬项目配置与查询 | F#156–168、F#178–180 | 只读核验；OEHR 查询 Oracle 缺失处 blocked。 |
| S10 编制表单与旧流程迁移 | F#171–176 | HSSC 系统管理员 outcome 保留分母并 not-executed。 |
| S11 查询一致性与筛选导出 | F#76、F#182–184 | 只查/导出本轮合成实体；字段清单和筛选条件需先冻结。 |

## 对齐结果

该映射提供了逐条候选来源，不会自动把候选来源变成批准 Oracle。用户已确认正式飞书 revision 2045 / 流程子文档 revision 5 为本组 draft 的权威来源，保留现有 37/11 ID 与成员关系，并把本地 v4 留作历史。

Brain Creator Facade 预览 hash 为 `afe4bfde6b8543669f35735c73c0b162555d338a58ff4fb82b0a405ec01d8c65`，写入后将 RequirementSet `requirementSet_n61e346r` 对齐到 `requirementSource_8dk46kq4`。独立 Facade 进程确认 37 个 TestIntent 和 11 个 BusinessScenario 均为 draft、37 条成员关系有效；400 条直接来源引用中有 387 条指向正式源。原有 123 条 KnowledgeNode 来源引用仍指向本地 v4，作为历史保留。旧的 12 个 Eval 阶段关联和旧基线指纹已失效。

最新 draft 投影 SHA-256 为 `a5de04cd0d11d895e23031920ace7719469face59d5f58e4cdd78b7abcfec1a8`。回读确认 37 个 `businessOutcomeId` 仍未映射、EvaluationTrial 数量仍为 0。需要进一步审核知识节点与正式源的相关性，再进行 Requirement Eval、Oracle 映射和基线审批；来源未定义的期待继续 blocked，不补造规则。

来源对齐后的 Facade Eval 预览返回原有 18 项 gate action：4 项已确认、14 项待处理；gate `generatedAt` 仍是 `2026-10-28T19:22:10.656Z`，本轮没有把旧评估冒充为新的来源评估。此次对齐另外使 12 条旧 stage-eval 关联失效；这与 14 项待处理 action 是不同计数。待处理内容包括实习后续状态、替补数据、OA 流程独立读回、本地 Offer 路径与角色/附件、配置/迁移/导出范围、路线命中、账号角色、测试数据和真实运行证据。尚未确认任何 Eval action 或基线。

为避免旧快照覆盖，对齐前结束了仍等待“登录后回到终端按 Enter”的专用 `auth capture` 进程。该进程尚未保存鉴权状态；Test5 AuthProfile 仍未验证。没有批准基线、创建 Trial、执行 Test5 业务写入或清理。
