# Test5 GHR E/F 阶段验收快照

**日期：** 2026-10-29

**状态：** 阶段性记录，E 未通过，F 未完成；不是最终交付报告。
**计数口径：** 实现验收只按合入所选 `origin/main` 且通过验收的交付包计数。候选分支、合成夹具和静态预览不计作真实业务结果。

## 基线与实现状态

- 当前所选基线为 `origin/main=eedc217d41b631815ca32d0142a3e4dfe26399d9`。PR #188 候选头 `d5170a5` 的 CI #575 和 Documentation #285 已通过；PR 仍是 draft，未合入。当前报告更新会进入后续 PR 提交，并由新的精确头 CI 验证。
- 当前正式实现验收为 **4/6**。候选头 CI #575 在 Node 20/22 通过完整测试、类型检查、构建、文档、包内容、仓库卫生和隔离包安装；Documentation #285 通过。该证据验证候选工程交付，不证明 E 的真实业务场景通过。
- 本轮来源对齐是目标 Store 的 draft 变更，不提高正式 **4/6**。候选 PR #188 保持 draft、未合并。

## E：真实业务评估

| 项目 | 当前证据 | 验收状态 |
|---|---|---|
| 固定范围 | Test5 集团/GHR 本地范围已冻结为 28 个 outcome；Beisen/OEHR 跨系统副作用另列外部范围 | 已冻结范围，不代表执行 |
| 测试设计 | 37 个 TestIntent、11 个 BusinessScenario 已修订并读回；仍均为 draft，成员链接有效 | 草稿已修订，未批准 |
| 需求来源 | `lark-cli` 本轮复核主文档 revision 2045、流程子文档 revision 5；四份子表 revision 154/607/175/62 与冻结包一致。通过 `bc_prepare action=align-test-design-source` 将现有 draft 对齐到正式来源；新 Facade 进程读回 37/11、成员关系与来源 hash。387/400 条直接来源引用指向正式源；123 条 KnowledgeNode 旧 v4 引用作为历史保留 | 来源对齐已持久化；Oracle 与 RequirementSet 仍未批准 |
| Requirement Eval | 对齐后 Facade 预览读取到 18 项 gate action：4 项已确认、14 项待处理，gate 的 `generatedAt` 仍为 2026-10-28；本轮未将旧 gate 当作新来源评估。对齐使 12 条旧 stage-eval 关联失效 | 需来源对齐后的评估及 pending 项处理 |
| outcome 映射 | 对齐后新 Facade 预览将 28 个固定 `GHR-*` outcome 一对一映射到 28 个现有 TestIntent；9 条路线/检查/回调支持意图保持 `null`。Draft hash 为 `c3b26c796d425fb413a61e009ed84217016cf0be443c20ddb4683af1ce0844a2` | 预览通过；待用户审阅 Oracle，Store 未写回 |
| Trial 与业务结果 | `EvaluationTrial` 数量为 0；真实完成 **0/28** | 未执行 |
| 鉴权与数据 | Test5 AuthProfile 仍为 `failed`，checkpoint 为 `awaiting-user`；旧专用 auth capture 在登录后 Enter 等待点被结束，未保存登录态。未发现对应系统的 TestData Profile；独立后置状态 verifier / Provider 尚未配置 | Trial admission blocked |
| 审批路线 | 用户确认以 Test5 当前生效配置 `Proc000019 v9` 为 Oracle | 口径已确定，无需再提供链接 |
| 副作用与清理 | 本轮没有 Test5 业务写入或清理 | 未执行；清理成功率未测量 |

### 固定分母与指标

- 真实业务完成度：**0/28**。Blocked 和未执行项保留在 28 的分母中。
- 自主完成度、首次有效结果耗时、恢复成功率、业务验证率、清理成功率：**未测量**。当前没有真实 Trial 数据，不填零、不推算。
- Beisen 第二真实系统：**外部依赖**。订单审批浏览器夹具通过也不能代替它的真实迁移验收。

## F：复核与交付

| 检查 | 当前证据 | 状态 |
|---|---|---|
| 单元/集成、类型检查、构建 | PR #188 已验证候选头 `d5170a5` 的精确头 CI #575 通过 Node 20/22；Documentation #285 通过。报告本轮修改后会由新精确头 CI 验证 | 候选提交通过，未合并 |
| 浏览器夹具 | 订单审批 Chromium 合成夹具 6/6；恢复用例没有重放写操作 | 合成证据，不计入真实业务指标 |
| Host Agent smoke | 本地合成站点 TC-001、TC-002 通过；Codex 原生入口 smoke 通过 | 宿主/夹具验证，不计入 E |
| 文档与安装 | PR #188 精确头 CI #575 已通过文档构建、包内容、隔离安装和仓库卫生检查；Documentation #285 通过 | 候选提交通过，未合并 |
| 实测基线与业务标注 | 无真实 Trial 记录，不能比较基线或计算主流程、角色交接、异常分支的实测覆盖 | 未完成 |
| 发布 | 未执行 npm 发布 | 按边界保持未发布 |

## 继续验收的具体门槛

1. 对新增 387 条正式源直接引用执行逐项相关性审核，并安全重跑来源绑定的 Requirement Eval；保留 37/11 ID 和成员关系。检查被失效的 12 个旧 stage-eval 关联及 14 项待处理 gate action。此步骤不批准 RequirementSet 或 Trial。
2. 用户审阅并确认 28 条 outcome 与 Oracle 映射，再写回 draft；保持固定分母，未定义项须保留 blocked。
3. 建立可在新上下文复验的 Test5 登录态，并配置独立目标后置状态校验与 TestData Provider。
4. 通过全部 admission gates 后创建固定范围 Trial，再按授权完成三轮业务执行；每轮用本轮新证据核验目标系统后置状态。
5. 执行中断恢复与清理/保留核验；失败、人工介入和未执行 outcome 保留在报告分母。以实际 Trial 数据更新最终 E/F 报告；在此之前不把 E 或 F 标记为通过。

## 结论

当前可证明的是候选实现与工程检查通过，Test5 需求草稿已对齐正式飞书来源并由独立进程回读；28 项映射已通过 Facade 预览但尚未取得 Oracle 审批或写回。登录态和独立后置状态校验未就绪。当前不能证明真实业务闭环、恢复不重放、三轮复跑、基线提升或自主完成目标。故本快照不改变正式实现验收 **4/6**，真实业务结果仍为 **0/28**，E 阻塞，F 部分完成。
