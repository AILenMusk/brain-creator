# Brain Creator

Brain Creator 是面向中文团队的需求驱动测试系统，当前以 Codex 作为首要宿主。用户主要通过 Agent 对话，把需求来源转成可审查、可追踪、可执行和可恢复的测试流程；Claude Code 可通过相同的 MCP 接口接入。

**Brain Creator 没有独立 Web UI。** Skill 负责指导 Agent 推进流程，Facade MCP 提供工具；npm 包负责安装和分发，CLI 负责初始化、诊断与维护。Harness 和五个 Brain 是内部实现，不是额外的用户入口。产品边界见[产品方向](docs/zh-CN/product-direction.md)。

## 产品形态

| 层次 | 职责 |
|---|---|
| Agent 对话 | 用户描述需求、审核方案、确认执行和复核结果，是主要使用体验。 |
| Brain Creator Skill | 指导 Agent 按统一流程工作，不单独执行测试。 |
| Facade MCP | 向 Agent 提供统一工具接口；宿主负责启动 MCP server。 |
| npm 包 | 将运行时、Skill、MCP 和宿主插件资源交付到业务项目。 |
| CLI | 提供初始化、诊断、配置和维护命令；高级命令不是日常主入口。 |

### 内部能力边界

| 组件 | 负责内容 |
|---|---|
| Requirement Brain（需求大脑） | 保存需求条款、来源引用、业务对象、规则、流程、状态和覆盖情况。 |
| System Brain（系统大脑） | 保存目标系统中的页面、导航、角色、控件和状态证据。 |
| Testcase Brain（测试用例大脑） | 管理测试意图、可执行用例、来源关系和编译缺口。 |
| Testdata Brain（测试数据大脑） | 管理实体、数据依赖、Provider（数据提供器）、租约与清理记录。 |
| Testexecution Brain（测试执行大脑） | 管理执行计划、断言、Reporter（结构化结果）、证据、诊断与回归记录。 |
| Harness（任务编排运行时） | 组织可恢复任务、人工审核、Agent 接续、评估和重试边界。 |
| Facade（统一工具入口） | 汇总 Agent 常用操作；底层 MCP 工具保留兼容、审计和调试用途。 |

## 适用场景

- 从需求文档、飞书文档、流程图或现有用例整理测试范围。
- 在审批后连接目标系统，观察页面、导航、角色和状态变化。
- 为测试准备可追踪的数据，运行 Playwright 测试并检查业务结果。
- 恢复中断任务，查看证据、缺陷和待处理问题。

## 工作流程

```mermaid
flowchart LR
  S[需求来源] --> R[Requirement Brain 需求大脑]
  R --> A[审核与需求基线审批]
  A --> Y[System Brain 系统大脑]
  Y --> C[Testcase Brain 测试用例大脑]
  C --> D[Testdata Brain 测试数据大脑]
  D --> E[Testexecution Brain 测试执行大脑]
  E --> O[证据、BugReport 缺陷报告或 Gap 待处理问题]
  O --> R
```

## 五分钟开始

### 在要测试的业务项目中安装

需要 Node.js 20 或更新版本，以及 Codex（当前首要宿主）或 Claude Code。进入业务项目目录安装 npm 包：

```bash
npm install --save-dev brain-creator
```

Codex 默认路径会同时安装项目级插件：

```bash
npx brain-creator init --provider host-agent --with-plugin
npx brain-creator doctor
```

Claude Code 使用相同的 MCP 和 Skill 契约，不安装 Codex 插件：

```bash
npx brain-creator init --provider host-agent
npx brain-creator doctor
```

已完成初始化、只需单独补装 Codex 插件时，运行：

```bash
npx brain-creator plugin install
```

重启 Agent 后，可直接用中文描述任务：

```text
用 Brain Creator 分析这个需求文档，列出流程覆盖、来源依据和待确认项。
等我审核并批准需求基线后，再连接目标系统准备执行。
```

第一次分析应展示需求摘要、来源引用、流程与状态覆盖、疑问和下一步。**未经审核的需求基线不能执行。**

### 常用中文提示

| 目标 | 可以这样说 |
|---|---|
| 分析需求 | “用 Brain Creator 分析这个飞书需求，生成可追踪的测试意图，先等我审核。” |
| 连接系统 | “用 Brain Creator 连接这个测试系统，检查页面证据和登录状态；先只读探索。” |
| 执行现有用例 | “预览这份 Excel 测试用例，说明执行范围和副作用，等我确认后再运行。” |
| 恢复任务 | “恢复上次 Brain Creator 任务，告诉我已完成的步骤、等待原因和下一步。” |
| 复核结果 | “复盘最近一次运行，区分产品缺陷和环境/自动化问题，并给出证据。” |

## 信任与安全边界

- RequirementSet（需求集）和业务场景必须通过相应审核门禁，才可进入执行。
- 需求预期、System Brain 观察和运行结果分别保存；观察结果不能覆盖已批准的需求。
- 需要写入目标系统或跨角色流转时，先展示具体范围并按审批门禁执行。
- 测试数据按 `lookup/create/transition/verify/cleanup`（查询、创建、流转、验证、清理）追踪。清理策略须符合批准范围；需要用户通知时，先通知再清理。
- 只有有证据支持的业务结果才可判为通过。缺少文件、登录、定位器、数据或后置状态证据时保持阻塞，不推测成功。
- BugReport（缺陷报告）用于有证据的产品不符合预期；Gap（待处理问题）用于鉴权、环境、自动化、数据和证据阻塞。
- synthetic（合成）夹具用于验证工程流程，不能代替真实系统结果，也不能计入真实 Trial（试验轮次）的业务完成率。
- 产品不宣称任意系统零准备、无需审核的全自主测试。生产 Runner（调度执行器）的长期稳定性也需要真实部署证据。

## 评估术语

| 名词 | 含义 |
|---|---|
| Trial（试验轮次） | 将需求版本、目标系统、代码版本、场景范围和证据绑定到一次可复核的评估运行。 |
| EvaluationTrial（评估试验记录） | Brain Creator 中保存 Trial 身份、输入指纹和运行记录的资产。 |
| TestIntent（测试意图） | 有需求来源、预期结果和覆盖范围的测试设计项。 |
| BusinessScenario（业务场景） | 跨步骤、角色和数据实体的业务流程。 |
| Evidence（证据） | 与断言、步骤和场景绑定的截图、trace、Reporter 或状态查询结果。 |
| Conformance（业务符合性） | 根据适用需求、实际业务值和已验证证据判断是否符合预期。 |

实现检查、合成验证和真实业务结果分别报告。真实 Trial 没有样本时，相关业务指标应写“未测量”；blocked（阻塞）、失败和未执行场景保留在固定分母中。

## 仓库结构

| 路径 | 内容 |
|---|---|
| `src/agent/` | Agent 任务、宿主接续和运行时适配。 |
| `src/brain/` | 五个 Brain 的核心模型和 Harness 类型。 |
| `src/knowledge/` | 需求分析、系统探索、测试编译、数据准备和报告服务。 |
| `src/domain/`、`src/storage/` | 领域资产、仓库、隔离和持久化。 |
| `src/execution/`、`src/runner/` | 执行、证据评估、调度和恢复。 |
| `src/mcp/`、`src/cli/` | Facade/MCP 与命令行产品入口。 |
| `skills/brain-creator/` | Codex、Claude Code 等宿主使用的产品 Skill。 |
| `docs/zh-CN/` | 面向中文用户的快速开始、概念、操作和故障排查文档。 |
| `docs/quality/` | 验收策略、质量台账、真实系统回归和交付证据。 |

## 中文文档

- [产品方向](docs/zh-CN/product-direction.md)
- [快速开始](docs/zh-CN/getting-started.md)
- [核心概念](docs/zh-CN/core-concepts.md)
- [需求到测试流程](docs/zh-CN/guides/requirement-to-test.md)
- [测试用例与测试数据](docs/zh-CN/guides/testcase-testdata-brain.md)
- [数据 Provider（提供器）](docs/zh-CN/guides/testdata-providers.md)
- [可信控制面](docs/zh-CN/guides/trusted-control-plane.md)
- [Agent 使用指南](docs/zh-CN/agent-usage.md)
- [CLI 命令参考](docs/zh-CN/cli-reference.md)
- [MCP 安装](docs/zh-CN/mcp-installation.md)
- [故障排查](docs/zh-CN/troubleshooting.md)
- [可靠性控制](docs/zh-CN/quality/reliability-controls.md)
- [真实系统回归](docs/zh-CN/quality/real-system-regression.md)
- [旧版 README 备份](README.legacy.md)

## 源码开发

当前仓库使用单一主工作目录：从 GitHub 的 `main` 同步到本地 `fixture` 分支开发；完成审核后快进到本地 `main`，再由本地 `main` 推送远端。具体规则见 [AGENTS.md](AGENTS.md)。

```bash
npm install
npm test
npx tsc --noEmit
npm run build
```

README 的历史功能清单和 PR 叙述已移入备份；最新验收状态应以质量台账和验收策略为准，避免把历史计划误读为当前已完成能力。

## 许可

本项目使用 [MIT License](LICENSE)。
