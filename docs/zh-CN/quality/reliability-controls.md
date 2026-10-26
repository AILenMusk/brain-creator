# 执行可靠性控制

Brain Creator 将可靠性作为可审计的控制面，而不是把一次绿色运行当作需求整体通过的证明。

## 跨页面与多 surface 恢复

系统探索会记录目标 surface（`document`、`iframe`、`popup`、`shadow-root`、`wujie`），并独立恢复目标 surface。子页面不可用时不会静默退回主文档；跨域或未注册的 surface 会阻断并保留证据，供后续创建 Gap。

## 鉴权刷新

鉴权刷新采用统一供应商注册表和适配器协议。Token 和 Cookie 配置可以通过内置适配器重新物化为静态加密的浏览器状态；浏览器上下文只在内存中接收解密后的状态。旧版明文状态文件在首次读取时加密。OAuth 使用标准 refresh-token grant，轮换后的 refresh token 只写回加密 AuthProfile；CAS 先校验 service ticket，再强制通过目标系统会话交换；SAML 优先使用会话端点返回的 Cookie，没有 Cookie 时才使用会话令牌。浏览器特定或厂商特定流程继续由 host-agent 适配器承接。供应商凭据与端点通过加密 AuthProfile 提供，刷新有超时限制，结果不会返回明文密钥。CAS 校验成功但没有建立目标会话时，刷新仍视为失败，不能当作可用浏览器状态。

使用 `brain-creator auth capture --system <id> --profile <id>` 可打开隔离的可见浏览器供用户登录。该命令执行来源允许列表检查，在写入前加密状态，并在新的浏览器上下文中验证后才将 AuthProfile 标记为已验证。凭据不会输入到 CLI 或聊天。

可以先通过 `bc_configure target=auth operation=preflight` 检查供应商 readiness，再用 `operation=refresh` 显式请求刷新。`bc_status` 会展示已注册、已配置和不可用的刷新供应商；缺少或不可用的供应商会创建鉴权预检 Gap，并阻止用例进入 Agent/Playwright 链路。

## 同系统多需求对账

需求套件会持久化预期需求集合，并在创建和复盘时对账可执行用例：

- `complete`：所有需求集合都有当前用例，且没有跨系统引用或重复编译键。
- `partial`：需求集合或可执行用例缺失。
- `conflicted`：用例属于其他系统，或当前编译键重复。

通过 `bc_review` 的 `target=requirement-suite-run` 查看对账结果。结果还会展示缺失的 TestIntent、缺失的可执行用例、已废弃需求版本和未绑定系统的用例。

## 长周期稳定性

稳定性评估包含目标次数、最小样本、失败率、连续失败、最长耗时、强证据和阻断策略。单次绿色运行仍然是 `insufficient-sample`。配置最小间隔后，下一轮会持久化 `nextRunAt`，不会提前执行；下一次显式调用 `bc_run` 或 resume 且时间到达后才会启动。

稳定性任务现在提供显式的 claim/lease 控制面：外部定时器或宿主 Agent 可以预览到期任务，使用 `suiteAction=claim-scheduled` 领取，长任务期间续租，失败时释放并写入错误。统一 CLI 的 Runner 还支持 `--max-wall-time-ms` 和 `--lease-renewal-ms`，长任务会后台续租，在墙钟预算耗尽后不再启动下一条用例，并返回耗时与续租次数；失败重试使用有上限的指数退避。租约过期后其他执行者可以恢复领取，进程崩溃不会永久卡住任务。当前仍是可持久化调度元数据，不是后台 Worker；生产定时器和分布式存储仍需按部署环境接入。

仓库提供了 `.github/workflows/brain-creator-runner.yml` 作为 GitHub Actions 外部调度样例。它每 15 分钟或手动触发一次，从 Runner 状态 Artifact 恢复分片仓库，每次最多处理一个到期迭代，再上传更新后的状态和报告。工作流通过 concurrency 组保证只有一个写入者推进样本。该样例用于验证租约、恢复和多轮稳定性，不代表生产系统；生产部署应将 Artifact 状态替换为经过批准的外部存储，并继续使用相同的 claim/renew/release 协议。

## 执行过程可见性

每条 Run Ledger 记录都会获得运行内稳定序号，并投影为统一的 `ExecutionProgressEvent`。Reporter 回传的步骤会补充步骤 ID、标题、断言摘要、截图、耗时和 trace 标识；敏感值和页面 URL 查询参数会在持久化前脱敏。

Trial 恢复指标依据 Run Ledger 序号识别每个动作最终的恢复事件；历史记录再用时间戳和 ID 处理排序。即使事件时间相同，也不会把已成功的恢复误记为未解决，或把较早的待处理事件误当成终态。

恢复时会合并两层持久化状态：持久化的 Suite 状态负责运行终态和当前用例，Run Ledger 负责步骤级进度和证据细节。如果进程已经写入 Suite 状态但还没来得及写入最后一条 Ledger 事件，`bc_status` 会以 Suite 结果为准，并标记为已对账恢复，不会把旧步骤继续显示成当前步骤。如果还没有 Ledger，系统仍会根据持久化状态显示等待中的用例和下一步；如果只有 Ledger 证据，则会明确标记为仅账本来源。

调用方提供 progress token 时，`bc_run` 和 `bc_submit_agent_output` 会发送 MCP Progress Notification。通知属于尽力而为通道，发送失败不改变执行结果；恢复时会对账持久化 Suite 状态和 Run Ledger。`bc_status` 返回当前事件；活动事件超过阈值时显示 `possiblyStalled`，终态事件不会误报卡住。每条用例完成后都会增量重写静态 Suite 报告，测试工程师无需等待整套结束即可查看证据。

如果调用方传入的状态与结构化 Playwright Reporter 结果不一致，Reporter 的非通过结果会优先于调用方的 `passed`，同时保留状态冲突警告。这样可以避免调用方的绿色路径掩盖实际失败或阻塞。

执行新增显式的 `browserMode=headless|observe` 契约。无头模式仍是无人值守默认值；观察模式会向 Playwright 传入 `--headed`、保持单 Worker、随 Suite/AgentTask 持久化，并显示在状态和静态报告中。无法打开窗口时能力检查会直接阻断，不存在隐藏降级。浏览器可见性用于增强测试工程师的过程信任，但不会提升断言验证强度，也不能替代结构化证据。

Brain Creator 为某次执行启动 `npx playwright` 时，会优先从该次运行的 `workDir` 解析 Playwright CLI，再回退到 Brain Creator 安装目录。生成的 seed 和测试文件因此会与 CLI 使用同一工作区安装的 `@playwright/test`，避免隔离业务项目中出现重复的 Playwright 测试注册器。

中断后的写操作恢复必须绑定原始 Run Ledger 动作。仅允许对未解决的 `sent` 或 `reconciliation-required` 记录进行恢复；若系统／用例绑定、动作语义、后置条件或实体引用发生变化则拒绝。自动和人工产物校验都要求恰好一个套件运行标识，拒绝空绑定或互相矛盾的双重绑定。自动验证沿用账本中的实体引用，并用结构化、带哈希的观察证据核对原始动作，防止写入发送后再替换成更弱的 Oracle。

发送写操作的标记也必须包含已冻结的后置条件。planned 动作会将语义、目标实体和后置条件带入 `sent`；变更这些字段或在缺少后置条件时发送都会被拒绝。这样可确保在外部写入前已有恢复 Oracle，而不是等到结果不确定后再临时补充。

创建实体的清理任务会包含提前通知文本及其 SHA-256。Host Agent 必须先向用户发送通知，再调用 `bc_prepare action=confirm-cleanup-notice` 提交该摘要，之后才能标记任务已发送；没有通知确认时 `mark-test-data-sent` 会拒绝清理。若只读核对证明清理未生效，系统会清除本次确认，重试前必须重新通知。摘要和时间戳记录的是 Host Agent 的确认，不构成用户已看到消息的独立证明。

人工恢复同样受证据门禁约束：除提供非敏感证据引用外，还必须提供明确操作人，以及 `.brain-creator/` 下至少一个可读取产物和预期 SHA-256。JSON 观察必须绑定准确套件运行、系统、动作、实体、后置条件、实际结果、核对时间和操作人。校验后的路径与哈希会写入恢复后的 Run Ledger，并附加到 Trial 人工介入记录；仅有证据引用不能继续套件。

MCP 运行时会使用 workspace 完整性密钥为 Run Ledger 记录签名，并按每次运行的顺序链接。Trial 审核会重新校验当前动作产物哈希、HMAC 链，以及已结束（completed/failed/blocked/cancelled）运行的签名终态事件。缺失、乱序、未签名旧记录或被修改的事件不能支持恢复成功指标，但仍保留供审计查看。这只能证明本地记录完整性，不能证明外部目标系统持续可用或业务状态正确。

JSON 观察必须是 `manual-execution-postcondition-observation` 记录，并绑定准确的系统、动作、实体、后置条件、实际结果、核对时间和操作人；截图必须可解码，trace ZIP 必须含有可读事件。

Requirement Suite 终态报告会展示每个写操作最新的 Run Ledger 阶段、不可变语义／实体／后置条件、证据引用和带哈希产物链接，并明确说明这些仅用于审计，不等同符合性结论。符合性仍由单独校验的执行证据和 Oracle 判定。

业务 Oracle 的适用性必须显式定义。无条件 Oracle 声明无需分支条件；条件 Oracle 列出有来源的条件，Reporter 必须返回每个条件的实际值，并提供能解析到已校验文件的证据引用。符合性会按条件运算符比较这些值，而不信任布尔适用标签。预期和适用性引用必须属于对应合同，执行证据 ID 必须出现在执行引用中，Oracle 实体引用必须与 Reporter 实体一致。历史布尔适用记录仍可查看，但不能生成新的 `conform` 结论。

参与 Evaluation Trial 的 Document Suite 动作应在记录时提供 `evaluationTrialId`，并在已知时提供 `businessScenarioId`。若动作开始时未绑定 Trial，人工恢复仅会在系统恰好匹配一个活动 Trial 时自动绑定；匹配多个 Trial 时必须显式提供 Trial ID。Trial 复核会检测已绑定但缺少介入记录的人工恢复事件；场景绑定必须属于冻结范围。

## 目标系统后置条件验证器

生产 MCP 上下文可通过 `BRAIN_CREATOR_POSTCONDITION_VERIFIER_MODULE` 显式加载目标适配器，路径相对于 Brain Creator workspace。该模块必须是 workspace 内经审核的可信代码，并导出异步 `verifyPostcondition(input)` 函数（或默认函数），实现 `ExecutionPostconditionVerifier`。输入包含不可变的系统／动作／实体／后置条件绑定；适配器必须独立查询目标系统。确认结果还必须包含实际结果、核对时间、证据引用，以及 `.brain-creator/` 下与绑定一致、带哈希的 `execution-postcondition-observation` JSON 产物。模块缺失、越界、导出不合法或执行异常均返回 `unavailable`，不会推进待恢复动作。未配置目标适配器时，自动恢复不可用，必须使用经过校验的人工恢复证据。加载模块会在 MCP 进程内执行其代码，因此启用前必须审核；该配置不等于目标系统鉴权或业务写入授权。

`bc_status` 会将 `recoveryCapabilities.automaticPostconditionVerification` 显示为 `configured` 或 `not-configured`，便于在尝试自动恢复前审阅当前能力。`configured` 只表示已提供适配器；是否能访问目标系统以及证据是否有效，仍须通过针对该动作的查询和产物校验确认。

执行来源通过所选 `SystemProfile.executionProvenance` 声明，默认值为 `unknown`，并在创建执行证据时复制为该轮快照；完成或 Reporter 输入不能提升来源。合成夹具必须声明为 `synthetic`，只有明确分类的业务系统可参与 `real-system` 符合性判定。该分类不替代基线审批、产物校验或目标系统独立后置条件。
