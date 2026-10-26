# 测试数据 Provider

Brain Creator 将测试数据规划和真实系统操作分开。Testdata Brain 负责实体身份、依赖关系、租约、来源证据和清理状态；系统专用 Provider 负责实际的查询、创建、状态转换、验证和清理。

## Provider 契约

嵌入式集成创建 MCP context 时可以传入系统 Provider：

```ts
const provider: TestDataProvider = {
  name: "orders-system",
  supports: (input) => input.systemId === "system-orders",
  lookup: async (input) => lookupOrder(input),
  create: async (input) => createOrder(input),
  transition: async (input) => transitionOrder(input),
  verify: async (input) => verifyOrder(input),
  cleanup: async (input) => deleteOrRestoreOrder(input)
};
```

每个方法都要返回稳定引用、可选的非敏感值、明确的生命周期状态和来源证据。Provider 必须将每次操作限制在请求的 `systemId` 内，Testdata Brain 会拒绝跨系统引用。

独立运行的 MCP 进程可通过 `BRAIN_CREATOR_TESTDATA_ADAPTER_MODULE` 配置 workspace 内经过审核的适配器模块。模块必须导出非空 `testDataProviders` 数组，每个 Provider 实现上述契约；也可导出 `verifyNoEffect(input)`，用于对不确定写操作执行独立只读核对。模块路径必须解析在 Brain Creator workspace 内，每个目标系统必须且只能匹配一个 Provider。加载模块会在 MCP 进程内执行其代码。`bc_status` 的 `runtimeCapabilities.testDataProvider` 会显示 `configured`、`not-configured` 或 `synthetic-test-only`。生产环境默认不启用目标 Provider；内存 Provider 仅在 `NODE_ENV=test` 进程中作为合成夹具使用，不能证明外部系统中的数据状态。

对于 `lookup`，查询不唯一时应返回全部匹配候选。Testdata Brain 只接受单个结果；多个结果会被拒绝，不会静默选取第一条；空结果表示未查到数据。

## 生命周期

1. Brain Creator 规划依赖关系，并优先查询/复用数据。
2. 清理前，Host Agent 先向用户发送返回的提前通知，再通过 `bc_prepare action=confirm-cleanup-notice` 和 `cleanupNoticeSha256` 确认已通知；成功后才能标记清理任务已发送。其他外部写操作仍需先调用 `bc_prepare action=mark-test-data-sent`。
3. 只有已批准的数据计划允许时，Provider 才查询或创建实体；`submitted`、`approved` 等状态转换继续使用同一实体引用。
4. 响应不确定或会话中断后，Host Agent 必须先只读查询，并按操作类型处理：创建操作只有在精确查询结果为 `absent` 时才能重试；清理操作只有在仍存在且唯一匹配的实体时才能重试。如果清理目标已经不存在，Brain Creator 会记录清理已生效、释放 Lease 并推进流程，不再发送第二次清理。目标端 `TestDataNoEffectVerifier` 必须返回证据引用及带 SHA-256 的可读工作区产物；Brain Creator 会重新读取并计算产物 hash。单独提供 `evidenceRefs` 或 Host Agent 的 `sourceRefs` 不能授权重试或确认完成。没有 verifier，或查询结果不可用/有歧义时，任务必须保持阻塞并等待恢复。
5. 验证只记录证据，不覆盖需求预期。创建的数据获得租约，并且必须使用 `delete-created` 或 `restore` 清理。
6. 清理成功后实体标记为 released；清理失败时由 Suite/控制面记录类型化 Gap。清理结果不确定时，同样先只读核对再重试。

观察证据产物必须是 JSON，包含 `schemaVersion: 1`、`type: "testdata-no-effect-observation"`、精确的 `systemId` 和查询、与目标查询一致的 `result`、Provider 标识及与 verifier 返回值相同的 `checkedAt`。`absent` 必须对应 `matchCount: 0`；`present` 必须对应唯一匹配且 `reference` 与所查 Lease 引用一致。Brain Creator 会校验这些字段并重新计算文件 hash。

内存 Provider 只用于确定性测试夹具。真实系统应在配置适配器中实现 Provider 和目标端无效果 verifier，并返回相对 Brain Creator `.brain-creator` 运行目录的产物路径及 SHA-256；verifier 不可用或产物无法读取/哈希不匹配时，不确定写入必须保持阻塞。Host Agent 提供的引用本身不构成独立验证。CI/Suite 控制面负责清理失败分类和 Gap 创建。凭据不能进入 Provider 返回值、生成测试或报告。

## CI Runner

可以从 cron、GitHub Actions、Jenkins 或其他调度器调用统一 CLI：

```bash
npx brain-creator runner run --owner ci --project knowledge-orders --lease-ms 300000 --json
```

退出码 `0` 表示没有到期任务或执行完成，`1` 表示失败/阻断/部分完成，`2` 表示可恢复等待。租约会持久化到仓库中，因此第二个调度器不能领取正在执行的任务。

仓库提供了可复制的 [GitHub Actions 示例](../examples/github-actions/brain-creator-runner.yml)。启用定时触发前，必须在被测项目中配置非交互式 Agent provider 及其密钥；该示例仅用于接入参考，不会由 Brain Creator 自动启用。
