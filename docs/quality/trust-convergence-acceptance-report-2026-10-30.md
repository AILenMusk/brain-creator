# Brain Creator 收敛与重新验收报告

**日期：** 2026-10-30

**结论：** 工程侧候选检查通过；E（真实业务评估）阻塞；F（结果复核与交付）部分通过。本文不是 Trial（试验轮次）结果，也不代表 A–F 全部准出。

## 1. 验收基线

| 项目 | 本轮记录 |
|---|---|
| 已合并基线 | `main` / `origin/main`：`1a964fc8acb27a564d2381818ca4da019b6b6fc4`，包含 PR #190 |
| 验收候选 | `fixture` / `origin/fixture`：`a9cacd6dcbb8f989925b0eecc8b827b463698cb9`，对应 PR #191；未获该 head SHA 的合并批准 |
| 工作区状态 | 三份文档有未提交改动；代码验收在该 fixture 候选上执行，不能声称已在最新 `main` 复验 |
| Trial | 尚未创建；本轮未执行目标系统业务写入或测试数据清理 |
| 用户冻结范围 | 28 个本地 GHR outcome；Beisen 作为第二真实系统外部依赖，不计为已通过 |

## 2. 完成度口径

| 指标 | 当前结果 | 说明 |
|---|---|---|
| 实现完成度 | **4/6** | A–D 已有验收记录；E 阻塞，F 的真实数据复核未完成 |
| 真实业务完成度 | **未测量**；固定分母 **28** | 没有 Trial 绑定的业务证据；28 个 outcome 均未执行 |
| 自主完成度 | **未测量**；固定分母 **28** | 没有真实场景运行，无法计算自主完成数 |
| 工程合成检查 | 单独列示 | 不计入真实业务完成度、自主完成度、真实恢复率或业务准确率 |

“0 个本轮有效业务证据”是证据计数，不把尚未运行的业务指标填成 0% 或通过。

## 3. E：真实业务评估

### 已完成的只读核验

- 通过 `lark-cli` 复核的正式需求主文档 revision 为 `2045`，流程子文档 revision 为 `5`；需求、字段表和附件版本记录见 [trust-convergence.md](./trust-convergence.md)。
- 用户冻结了 28 个 Test5 集团/GHR 本地 outcome；Beisen 仍需第二真实系统与单独执行范围。
- 使用重新验证的 AuthProfile 完成了 Test5 首页、招聘需求列表和 Offer 列表的只读探索；未执行创建、提交、审批、关闭或清理。
- 用户提供的 `hc招聘需求流程`（流程 ID `db88e8d8-7c40-11f1-9dfa-fefcfe44737d`）和 `(zt-hc)offer流程`（流程 ID `f497a3f1-6fb8-11f1-bc9d-00ff39f9b15c`）在 Brain Creator 的已验证上下文中均未显示流程画布：招聘需求路径跳转到应用的资源不存在页；Offer 路径对应的应用页也显示资源不存在。两者不能作为审批路线知识或 Oracle。

### Trial 准入阻塞

- `requirementSet_teo6nqbx` 仍为 draft/blocked：135 条款中覆盖 130 条，7 项待处理、1 项阻塞，当前有 11 个 open Gap；Coverage Critic 与 Adjudicator 为 `needs-review`。
- 当前 draft 有 191 个 TestIntent、155 个 BusinessScenario，但 191 条意图全为 draft，显式映射到固定 28 个 outcome 的数量为 0。188/191 条只有通用前置条件；135/191 条的预期结果与 objective 相同；162/191 条集中在宽泛模块。来源可追踪和草稿数量不能代替业务覆盖。
- System Brain revision 8 仍是 candidate，最新 ChangeSet 为 needs-review，`workflowEvidence=false`；没有确认的流程画布或足以运行的页面绑定。
- 未配置独立业务后置状态校验器和 TestData Provider。项目的 EvaluationTrial 数量为 0。

**E 判定：阻塞。** 当前不能批准需求基线、准备本轮写入数据或启动三轮真实运行。授权的业务写入范围仍有效；它不替代需求基线、流程路径、业务 Oracle、数据方案和后置验证准入。

## 4. F：工程、包与宿主验收

以下检查针对 `fixture` 候选 `a9cacd6` 执行；临时安装工作区使用隔离目录并已清理。

| 检查 | 结果 |
|---|---|
| `npm test` | 通过：143 个测试文件，1,237 项 |
| `npx tsc --noEmit` | 通过 |
| `npm run build` | 通过 |
| `npm run docs:build` | 通过；保留既有大 chunk 警告 |
| `npm run verify:package-contents` | 通过：178 项，1,557,909 bytes |
| `npm run verify:package-install` | 通过：本地 tarball 安装、CLI/MCP 启动及恢复 smoke；临时目录已移除 |
| `npm run verify:order-fixture` | 通过：7/7，覆盖创建/提交、角色交接、拒绝与金额分支、跨用例实体复用、浏览器重启后先核状态且不重复提交、通用性反例 |
| `npm run verify:host-agent-document-suite` | 通过：本地合成服务器上的 TC-001、TC-002，使用 Playwright Chromium |
| `npm run verify:codex-native-entry` | 通过：Host Agent handoff、`/bc` 命令兼容、仓库内 plugin 安装 |
| `npm run verify:source-mcp-identity` | 通过：候选源码启动的身份返回 commit `a9cacd6`、build ID、dirty 标志、PID 与隔离 workspace；不是对现有宿主 MCP 进程升级的证明 |
| `npm run verify:source-workspace-isolation` | 通过：安装 MCP 的 Store 位于隔离业务 workspace；测试临时目录已移除 |
| `npm run verify:repository-hygiene` | 通过：380 个 tracked files。首次检查发现验收文档含目标环境主机 URL；已从仓库文档移除该主机，仅保留流程名称和 ID，复跑通过 |
| `git diff --check` | 通过 |

POM（页面对象模型）的单元反例覆盖未确认快照、路由变化、歧义/隐藏控件、快照外定位点及未登记扩展；合成订单夹具通过不代表 Test5 流程已绑定，也不构成真实业务结果。

## 5. F 未完成项与后续准出条件

F 的工程和包装检查已通过；最终交付仍依赖 E 的真实原始记录，以下项目尚无可测数据：三轮真实业务基线比较、人工业务标注、真实恢复率、真实清理率、自动化误报/漏检、实际介入与自主完成计数。均应记为**未测量**，不能用合成结果代填。

恢复真实 Trial 前，需按 `docs/quality/trust-convergence-acceptance-strategy.md` 的门禁完成：

1. 解决或经证据审阅关闭当前高严重度 Gap，并重新运行当前来源版本的 Requirement Eval。
2. 把固定 28 个 outcome 一对一映射到具体场景、操作、角色、数据准备、可观察后置条件和来源锚点；不确定分支保留在分母并标明 blocked/未执行。
3. 读取并确认当前生效的流程画布、System Brain 页面/定位点及唯一绑定；流程页面不可访问时，不猜测路径。
4. 配置独立目标系统后置状态校验与经批准的数据 Provider/实体生命周期；确认创建、复用、消费及清理/保留策略。
5. 完成需求基线审批、执行预检与 Trial 冻结，再在获准范围内分三轮运行；每轮的代码 SHA、需求 revision、场景分母、介入、证据及清理结果独立归档。

候选验证不构成 npm 发布授权；PR #191 内容仍须按仓库规则审查，只有批准准确 head SHA 后才可合并并推送 `main`。
