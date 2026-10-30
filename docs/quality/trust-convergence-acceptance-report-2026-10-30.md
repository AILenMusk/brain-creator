# Brain Creator 收敛与重新验收报告

**日期：** 2026-10-30

**结论：** 工程侧候选检查通过；E（真实业务评估）阻塞；F（结果复核与交付）部分通过。本文不是 Trial（试验轮次）结果，也不代表 A–F 全部准出。

## 1. 验收基线

| 项目 | 本轮记录 |
|---|---|
| 已合并基线 | `main` / `origin/main`：`1a964fc8acb27a564d2381818ca4da019b6b6fc4`，包含 PR #190 |
| 验收候选 | PR #191 中的代码改动基于 `a9cacd6dcbb8f989925b0eecc8b827b463698cb9`；PR 当前审查 head 以 GitHub 元数据为准，未获该 head SHA 的合并批准 |
| 验收状态 | 全量代码检查在上述代码候选上执行；之后只追加验收文档，单独重跑文档、身份及包验收。不能声称已在最新 `main` 复验 |
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
- 用户确认可以点开两条流程画布，并提供 `hc招聘需求流程` 的局部截图。截图保存在本工作区忽略目录 `.brain-creator/evidence/manual-system-observations/test5-ghr/2026-10-30-hc-recruitment-flow-top.png`，SHA-256 为 `725111814163B913AA8EFDD82F04B117FC37641FA6F6621D31C0ACEDB27CB476`；本轮已通过 Brain Creator Facade 记为 System Brain 观察 `knowledgeNode_e7758okl`，confidence `0.55`，来源绑定截图哈希。可见起点分为 `海外`（优先级 1，画面显示条件 `${overseaEstablishment = = 1}`）和 `国内`（默认、优先级 2）；截图内海外分支进入 HRBP，国内分支绕过 HRBP，两路汇合至 HRBP_TA 对接人。截图只覆盖画布上半段，且未显示流程 ID/版本号；观察记录明确保留该限制，不能确认完整路线、版本绑定或业务 Oracle，也没有生成执行期定位点。
- 此截图与正式附件中的两张路线图需要分层比较：业务提供图按海外/国内分支；附件“流程配置”图按工作地区区分；Test5 截图又显示 `overseaEstablishment` 条件。前半段拓扑部分相似，但判定字段并不相同。用户先前确认 Proc000019 v9 是当前生效版本；本截图没有显示其 ID/版本，仍需完整画布导出或可核对的版本页来绑定。旧的自动化探索仍只获得错误页，System Brain 目前为 0 条 workflow；不以手工截图自动晋升其候选快照。

- 2026-10-30 路由复核补充：在用户已登录浏览器当前活动标签中，招聘流程设计器画布可见，活动链接的 `title` 参数为双重 URL 编码；同一完整链接由已验证 AuthProfile 在新隔离上下文直达，仍跳转到 `/dw/doesNotExist`（`exploration_mvd22tjs`、候选 PageModel `page_7zva18rt`）。此前单重编码链接也失败，因此编码差异不足以解释全部问题；当前只能推测页面依赖已建立的应用内 SPA/会话状态，具体机制未证实。当前页可见完整节点/条件标签，但视口截图仅覆盖上部、页面未显示流程 ID/版本；用户另行确认 Proc000019 v9 为当前生效版本。通过 Facade 记录了两条系统观察 `knowledgeNode_n4ke4npq`、`knowledgeNode_i75p35hl`；不据此确认 System Brain 快照、结构化 WorkflowModel、执行期 POM 或业务 Oracle。

- 2026-10-30 Ego Browser 应用内路径复核（较新观察）：按用户提供的菜单路径，在已登录 Ego Lite 会话进入“流程管理 → 流程配置 → 招聘 → 招聘需求”，列表行显示 `hc招聘需求流程 / Proc000019 / 发布 / v9`；点击该行操作列的设计入口后，设计画布实际成功加载。纵向滚动核查了起点至“流程结束”的整张画布：海外条件分支进入 HRBP，国内默认支路绕过 HRBP，两路汇入 HRBP_TA对接人；后续可见部门层级、职级和实习生条件，以及 HRBP经理、HRBP负责人、CHO、CEO 等节点。使用同一流程配置列表选择“招聘 → offer”时，显示 `(zt-hc)offer流程 / Proc000017 / 发布 / v11`，其画布可见招聘渠道 16 至 HSSC_人事专员、海外/国内 HRBP 分流、HSSC_薪酬对接人，以及用工类型、职级、年龄、薪酬特批和部门层级条件。列表与画布截图、文件大小及 SHA-256 存于本机忽略目录 `.brain-creator/evidence/manual-system-observations/test5-ghr/2026-10-30-ego-in-app/manifest.json`。这证明已登录应用内设计入口可用；隔离上下文直开链接仍曾报错，底层原因未证实。此观察未写入 Brain Creator Store，没有保存/发布流程配置，也不证明任一业务分支真实执行、满足 Oracle 或形成执行期 POM。

### Trial 准入阻塞

- `requirementSet_teo6nqbx` 仍为 draft/blocked：135 条款中覆盖 130 条，7 项待处理、1 项阻塞；11 个高严重度 Gap 中当前 7 个 open、4 个 resolved。已记录的四项处置分别为旧鉴权失败经新上下文验证关闭、正式需求版次标签仍待来源补足、职级分支留在分母并标未执行、HSSC 管理员支线排除执行但保留 outcome 在分母。Coverage Critic 与 Adjudicator 仍为 `needs-review`。
- 当前 draft 有 191 个 TestIntent、155 个 BusinessScenario，但 191 条意图全为 draft，显式映射到固定 28 个 outcome 的数量为 0。另将先前经用户审阅的 v5 草稿中的 37 个 TestIntent ID 与当前列表逐一比对，匹配数为 0/37；旧 ID 不能直接写入此新 RequirementSet，也不据语义相似自动改绑。188/191 条只有通用前置条件；135/191 条的预期结果与 objective 相同；162/191 条集中在宽泛模块。来源可追踪和草稿数量不能代替业务覆盖。
- 对 155 个当前 BusinessScenario 的复核显示全部仍为 draft；177 条 `expectedBusinessOutcomes` 只有 115 个不同字符串，没有观察到与冻结 28 个 outcome ID 的显式一对一绑定。候选页面定位点方面，首页 11 个中 9 个、招聘需求列表 51 个中 25 个、Offer 列表 21 个中 17 个使用序号定位；即使定位置信度均高于 0.8，也不能把序号定位当作稳定 POM（页面对象模型）知识。
- 本轮通过 Facade 执行 `bc_prepare action=assess-scenarios`，覆盖当前全部 155 个 BusinessScenario：155 blocked、0 pass、0 needs-review（trace `50f000a4-a68b-4a7e-a021-35e9e5277869`）。逐条原因显示 155/155 缺已确认 System Brain 快照和系统绑定，155/155 的自由文本结果不足以构成结构化 Oracle，140/155 没有场景级 TestDataProfile，37/155 缺已确认的流程、状态或决策模型。该结果是生成设计的准入评估，不是运行或 Trial 结果。
- 最新 Facade 只读复核显示 System Brain snapshot `systemBrainSnapshot_cceqv46e` revision 12 仍是 `candidate`，ChangeSet `systemBrainChangeSet_s5zayre0` 为 `needs-review`；当前有 6 个 PageModel、0 个结构化 WorkflowModel，`workflowEvidence=false`。既有流程设计器 PageModel 仍混有“访问的资源不存在”观察、泛化控件名和序号定位；本轮 Ego 画布观察尚未经 Facade 写入，不能确认页面模型、流程唯一绑定或 POM。已存在的局部截图观察 `knowledgeNode_e7758okl` 也不会因后来浏览器打开成功而自动升级。
- 未配置独立业务后置状态校验器和 TestData Provider。项目的 EvaluationTrial 数量为 0。
- 当前已连接的宿主 MCP 报告 package `2.1.1`、commit `1a964fc8acb27a564d2381818ca4da019b6b6fc4`、`dirty=true`，即运行的是合并后的 `main` 基线而非 PR #191 候选；候选 workspace 的来源身份 smoke 不能证明宿主 MCP 已更新。

**E 判定：阻塞。** 当前不能批准需求基线、准备本轮写入数据或启动三轮真实运行。授权的业务写入范围仍有效；它不替代需求基线、流程路径、业务 Oracle、数据方案和后置验证准入。

## 4. F：工程、包与宿主验收

以下检查针对 `fixture` 候选 `a9cacd6` 执行；临时安装工作区使用隔离目录并已清理。

| 检查 | 结果 |
|---|---|
| `npm test` | 通过：143 个测试文件，1,237 项 |
| `npx tsc --noEmit` | 通过 |
| `npm run build` | 通过 |
| `npm run docs:build` | 通过；保留既有大 chunk 警告 |
| `npm run verify:package-contents` | 通过：178 项；包体积随构建身份内容变化，不作为能力指标 |
| `npm run verify:package-install` | 通过：本地 tarball 安装、CLI/MCP 启动及恢复 smoke；临时目录已移除 |
| `npm run verify:order-fixture` | 通过：7/7，覆盖创建/提交、角色交接、拒绝与金额分支、跨用例实体复用、浏览器重启后先核状态且不重复提交、通用性反例 |
| `npm run verify:host-agent-document-suite` | 通过：本地合成服务器上的 TC-001、TC-002，使用 Playwright Chromium |
| `npm run verify:codex-native-entry` | 通过：Host Agent handoff、`/bc` 命令兼容、仓库内 plugin 安装 |
| `npm run verify:source-mcp-identity` | 提交后复验通过：源码启动返回与当前提交一致的 build ID、`dirty=false`、PID 与隔离 workspace；不是对现有宿主 MCP 进程升级的证明 |
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
