# Brain Creator 产品方向

## 产品定位

Brain Creator 是面向中文团队的需求驱动测试产品。它帮助用户把需求转成经过审核、可追踪、可执行、可复核和可恢复的测试流程。

当前以 Codex 作为首要 Agent 宿主，Agent 对话是主要用户体验。Claude Code 可通过相同的 Skill 和 MCP 契约接入；后续宿主作为适配层接入同一产品能力，不复制核心工作流。Brain Creator 不提供独立 Web UI。

## 产品层次

| 层次 | 用户和产品中的职责 | 边界 |
|---|---|---|
| Agent 对话 | 用户提出目标、审核需求与方案、确认执行、复核结果。 | 主要用户入口。 |
| Brain Creator Skill | 指导 Agent 分析需求、调用工具、等待审核、执行和恢复。 | 工作指引，不是执行引擎。 |
| Facade MCP | 为 Agent 提供统一的高层工具接口。 | 产品工具 API；具体 server 由宿主启动。 |
| npm 包 | 分发运行时、Skill、MCP 配置和宿主插件资源。 | 安装载体，不是第二个用户界面。 |
| CLI | 初始化项目、诊断环境、管理配置和执行维护操作。 | 支持入口，不替代 Agent 主流程。 |
| Harness 和五个 Brain | 管理任务状态、需求、系统知识、用例、测试数据和执行证据。 | 内部实现层，不是独立产品或安装选项。 |

产品主链路是：

```text
用户在 Agent 中提出目标
  → Brain Creator Skill 指导流程
  → Facade MCP 提供工具
  → Harness 管理状态和恢复
  → 五个 Brain 完成各自职责
```

## 默认使用路径

在目标业务项目中安装 Brain Creator，然后由 Agent 接管主要测试工作流：

```bash
npm install --save-dev brain-creator
npx brain-creator init --provider host-agent --with-plugin
npx brain-creator doctor
```

Codex 通过项目插件、Skill 和 MCP 使用 Brain Creator。Claude Code 通过相同的 MCP 工具和工作指引接入，不另建一套产品实现。宿主启动 MCP 后，用户以自然语言开展需求分析、审核、执行和结果复核。

## CLI 命令边界

- 主路径：`init`、`doctor`，以及 Codex 项目插件安装。
- 配置操作：`config` 和 `config write`，用于查看、生成或有意更新宿主连接配置。
- 运维操作：鉴权捕获、结果导出、制品管理和 Runner 调度；这些命令服务于特定管理场景，不作为新用户的主要测试界面。
- 独立 npm 可执行文件继续兼容已有安装和自动化配置；新的文档与示例以统一的 `brain-creator` 子命令为准。

MCP server 的直接启动命令主要服务宿主配置、集成测试和诊断，不要求普通用户手工启动。Skill、MCP 和 CLI 不能发展成彼此重复的需求分析或测试执行流程。

## 后续演进约束

1. 新增面向用户的能力时，优先接入 Agent 对话、Skill 和 Facade MCP 主链路；新增 CLI 命令须说明它解决的安装、诊断或运维问题。
2. 新增宿主时适配同一产品契约，避免维护宿主专用的需求模型、执行状态或业务工作流。
3. Harness 与五个 Brain 按职责保持可维护性，但不将其包装成五种产品或五套用户入口。
4. npm 版本、可执行命令、安装内容和兼容范围以 `package.json` 及其打包检查为准。
5. 真实系统执行仍遵守审核、授权、证据、业务后置条件和恢复门禁；产品形态收敛不能放宽这些要求。
