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

## 工程文件结构与代码分层

先按用途区分产品源码、可复用验证代码、项目文档和运行产物。文件数本身不是问题；模块职责混杂、边界不清和变化互相牵连才是主要维护风险。

```text
.
├── AGENTS.md                 # 所有代码 Agent 的开发规则正本
├── CLAUDE.md                 # Claude Code 的短入口，指向 AGENTS.md
├── README.md                 # 产品入口、工程结构和使用说明
├── README.legacy.md          # 旧版 README 的只读历史备份
├── src/                      # npm 包中的产品运行时代码
│   ├── cli/                  # 安装、诊断、配置和维护命令
│   ├── mcp/                  # MCP 注册与 Facade；工具分发、工作流、投影和参数模块分置
│   ├── agent/                # 宿主 Agent、认证和任务接续适配
│   ├── knowledge/            # 需求、系统知识、编译、数据与工作流服务
│   ├── brain/                # Brain 模型、Harness 状态和能力服务
│   ├── domain/               # 资产类型、领域服务和仓库接口/实现
│   ├── execution/            # 浏览器执行、System Brain POM、断言、证据和报告
│   ├── evaluation/           # Trial 完整性、指标和历史证据复核
│   ├── runner/               # 套件调度入口
│   ├── storage/              # 文件产物布局、归档、迁移和保留策略
│   ├── shared/               # 工作区、运行身份、加密等共享能力
│   ├── caseSource/           # Excel/Markdown 等既有用例来源适配
│   └── quality/              # 质量台账、回归和黄金样本的测试文件
├── tests/                    # 可复用的浏览器/集成夹具与测试辅助代码
├── scripts/                  # CI、安装、Agent 宿主和工程验收脚本
├── skills/                   # Brain Creator 产品 Skill 正本
├── plugin/、plugins/         # 宿主插件及其安装资源
├── docs/zh-CN/               # 面向中文用户的产品文档
├── docs/quality/             # 质量规则和当前验收台账
├── dist/                     # 构建生成目录，不是源码
├── node_modules/             # npm 依赖，不是项目源码
└── <业务项目>/.brain-creator/ # 用户工作区中的 Store、运行产物和本地密钥
```

目录职责已有基本分区，但当前仍有分层债务。第一轮 MCP 拆分已将浏览器运行/Reporter、需求工作流、状态与审核投影、参数解析移入独立模块；`src/mcp/handlers.ts` 保留工具分发及尚未拆完的 Facade 操作，仍约 5,800 行，不能称为薄适配层。`src/knowledge/` 仍同时容纳多类业务流程，`src/domain/types.ts` 仍汇集大量跨域类型。后续按稳定接口继续拆分，优先降低单文件改动范围和跨域依赖，不做无目标的整体搬迁。

当前 MCP 文件职责：`handlers.ts` 注册 Facade 分支并适配请求；`requirementWorkflowHandlers.ts` 承接需求准备、测试数据续跑与执行计划工作流；`facadeProjectionHandlers.ts` 组装状态和审核投影；`handlerArguments.ts` 处理参数校验、解析和响应格式；`execution/hostPlaywrightRunner.ts` 负责宿主提交的 Playwright 运行及结构化 Reporter。新增流程应优先进入可独立测试的服务；不要将这些模块互相循环导入，也不要把领域规则放进参数/展示层。

### 知识驱动的 POM

`PageModel`（页面模型）和 `LocatorPoint`（定位点）是 System Brain 保存的页面知识；它们本身不是 POM。执行期的 `src/execution/systemPageObject.ts` 只从已确认的 System Brain 快照读取 `pageModelId` 与 `locatorPointId`，在当前页面路由匹配且定位结果唯一、可见时执行操作。生成的 Playwright seed 提供 `bc.pageObject(page, pageModelId).control(locatorPointId)`，每次操作附带快照版本、页面、定位点、动作和结果，供运行证据引用。

POM 只解决“如何定位和操作控件”。测试步骤、角色交接、数据实体和业务写入顺序仍由 Testcase Brain 与 Harness 决定；预期值和业务符合性仍由 Oracle（业务判定依据）与后置状态核验决定。页面或定位知识不确认、页面路由变化、控件缺失或匹配多个元素时，执行会明确失败并要求探索/复核，不切换到未经确认的选择器。复杂控件可在业务工作区的生成测试中注册具名扩展，通过 `control.extend(extensionId)` 调用；扩展与目标系统的专用验收资产留在业务工作区，不加入 Brain Creator 通用产品源码。

新代码遵循以下依赖方向：

```text
Agent / CLI / MCP 适配入口
          ↓
按业务动作组织的用例与流程服务
          ↓
Brain / Domain 模型与业务规则
          ↓
由 Storage、浏览器、数据 Provider 等适配器实现的技术能力
```

- `src/mcp/` 和 `src/cli/` 负责输入校验、协议转换、调用和输出；业务规则放在对应的服务中。
- Domain/Brain 的核心规则不依赖 MCP、CLI 或某一种具体文件/浏览器 Provider；通过接口传入外部能力。
- 一个模块应有清楚的主要职责。已有超大模块作为拆分债务登记；新增工作流先拆成可独立测试的服务，不继续把逻辑堆进 `handlers.ts`。
- `*.test.ts`、`tests/` 中可重复运行的测试和 `scripts/` 中的通用检查属于工程代码；截图、真实需求副本、Trial 记录及单次运行报告属于验收/运行资产，不能混放在产品源码中。

### 工程代码、验收资产与运行产物

| 类别 | 放置规则 | 例子 |
|---|---|---|
| 产品工程 | 进入 `src/`、产品 Skill/插件和用户文档；可随 npm 发布的内容由 `package.json` 明确列出。 | Brain、MCP/CLI、通用业务逻辑、Skill。 |
| 可复用验证代码 | 保留在 `*.test.ts`、`tests/`、`scripts/`，作为产品质量门禁维护；其中不得写入真实账号或业务数据。 | 单元/集成测试、订单审批合成夹具、包安装检查。 |
| 验收规则 | 保留方法、固定评估口径和问题状态；逐轮结果应由明确的 Trial/提交版本索引。 | `docs/quality/` 中的验收策略、问题台账。 |
| 单轮验收与业务产物 | 放在目标业务工作区 `.brain-creator/artifacts/` 或批准的独立归档中，保留清单和哈希；真实鉴权材料不得进入源码包或 Git。 | 需求快照、Oracle 标注、截图、trace、Reporter、HTML/Markdown 报告。 |

`docs/quality/` 是仓库内部的质量台账和验收记录，不属于用户安装产品的文档包；npm 清单显式排除该目录。面向用户的中文指南保留在 `docs/zh-CN/`。历史和单轮验收资产应单独归档，不能靠将它们打入 npm 包来保存。

### npm 用户如何定位运行产物

Brain Creator 的运行数据写入**用户的业务工作区**，不是写进 `node_modules/brain-creator`。默认工作区是 MCP/CLI 进程的当前目录；设置 `BRAIN_CREATOR_WORKSPACE` 后以该目录为准。安装后运行 `npx brain-creator doctor`，检查该 CLI 进程的 `Workspace`、`Store directory` 和 `Knowledge directory`；Agent 侧查看 `bc_status.runtimeIdentity.workspace`，以实际 MCP 进程的工作区作为运行产物位置。两者可能因启动目录不同而不一致，不要只根据插件安装目录猜产物位置。

默认布局如下：

```text
<Workspace>/.brain-creator/
├── store/                              # 持久知识、资产、任务和运行台账
├── artifacts/
│   └── <系统>/<需求>-v<版本>/
│       ├── latest.json                 # 指向该需求下最近一次运行
│       └── <SuiteRunId>/
│           ├── source/                 # 本轮需求来源快照
│           ├── analysis/               # 分析和审核材料
│           ├── cases/                  # 测试用例/场景
│           ├── specs/                  # 本轮生成的测试规格
│           ├── tests/                  # 本轮生成的 Playwright 测试
│           ├── evidence/               # 截图、trace、Reporter 等执行证据
│           ├── report/                 # 人可读报告
│           ├── manifest.json           # 文件路径、来源、大小和 SHA-256
│           └── index.md                # 本轮产物索引
└── system-explorations/<探索 ID>/      # 独立系统探索记录和截图
```

每轮路径由目标系统、需求标识/版本和 `SuiteRunId` 组成，避免不同系统、需求版本和运行互相覆盖。此处的 `specs/` 是单轮生成产物；仓库根目录的旧 `specs/` 和 `tests/generated/` 是兼容迁移来源，不是新的产品代码写入位置。`BRAIN_CREATOR_STORE_DIR` 只覆盖 Store 路径；要整体迁移默认工作区与运行产物位置，应设置 `BRAIN_CREATOR_WORKSPACE`。

迁移旧产物先运行 `npx brain-creator artifacts migrate` 查看预览；确认后才传 `--confirm`。需要交付单轮结果时，运行 `npx brain-creator export --suite <SuiteRunId> --output <归档路径>`，导出包含清单和哈希，不包含凭据、浏览器 storage state 或无关工作区文件。更完整的存储、迁移、保留和证据规则见[存储与证据](docs/zh-CN/guides/storage-and-evidence.md)。

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
- [六包实施验收策略](docs/quality/trust-convergence-acceptance-strategy.md)
- [六包验收状态台账](docs/quality/trust-convergence.md)
- [工程收敛实施计划](docs/quality/engineering-convergence-implementation-plan.md)
- [工程收敛合并后验收报告](docs/quality/engineering-convergence-acceptance-2026-10-30.md)
- [Agent 开发规则](AGENTS.md)
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
