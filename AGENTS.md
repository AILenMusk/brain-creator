# Brain Creator 项目方向与协作规则

`AGENTS.md` 是本仓库唯一权威的开发入口，适用于 Codex、Claude Code 和其他代码 Agent。版本、命令入口和脚本以 `package.json` 为准。Claude Code 通过根目录 `CLAUDE.md` 加载本文；不要在 `CLAUDE.md` 维护第二份项目规则。

## 产品目标与设计

Brain Creator 是面向中文团队的需求驱动测试产品，目标是把业务需求变成可审核、可追踪、可执行、可复核和可恢复的测试工作流。当前以 Codex 作为首要宿主，用户主要通过 Agent 对话使用产品；Claude Code 通过同一套 Skill 与 MCP 契约接入。

### 产品形态与边界

- npm 包是安装和分发方式，不是另一种用户界面。
- Skill（Agent 工作指引）组织 Agent 的工作步骤；Facade MCP（统一工具接口）提供 Agent 调用能力。
- CLI（命令行）负责初始化、诊断、配置和必要的维护操作，不构成平行的主要测试工作流。
- Harness（任务编排运行时）和五个 Brain 是产品内部实现边界，不作为独立产品入口。
- 新宿主应适配同一套产品契约；不要为不同宿主复制不同的核心工作流。

正式产品定位、默认使用路径和命令边界见 [`docs/zh-CN/product-direction.md`](docs/zh-CN/product-direction.md)。

| Brain | 职责 |
|---|---|
| Requirement Brain（需求大脑） | 需求来源、条款、规则、业务对象、流程、状态、覆盖和审批。 |
| System Brain（系统大脑） | 目标系统的页面、导航、角色、控件、行为和状态证据。 |
| Testcase Brain（测试用例大脑） | TestIntent（测试意图）、ExecutableCase（可执行用例）、编译和来源绑定。 |
| Testdata Brain（测试数据大脑） | 实体引用、数据依赖、Provider（数据提供器）、Lease（数据租约）和清理。 |
| Testexecution Brain（测试执行大脑） | 执行计划、断言、Reporter（结构化报告）、证据、诊断和回归。 |

Harness（任务编排运行时）负责任务状态、审核、等待、续跑和恢复；Facade（统一工具入口）为宿主 Agent 提供高层操作。五个 Brain 是同一产品内的职责边界，不代表五个独立产品。

开发遵循以下方向：

1. 先保证需求来源和业务预期可追踪，再生成测试意图；来源冲突、覆盖缺口和未定义规则必须留在审核结果中。
2. 用 System Brain 的实际观察绑定系统行为；需求预期、系统观察和运行结果分层保存。
3. 用业务路径、角色、状态和实体引用编译场景；不因共享来源就挑选第一条流程路径，也不在通用规划器中加入单一客户的业务规则。
4. 用真实文件、准确合同和独立业务后置状态判断结果；标签、截图路径或自动化绿色结果本身不构成业务符合性。
5. 通过 Harness 和 Run Ledger（运行台账）恢复任务；中断后先核对目标状态，避免重复创建、提交或审批。
6. 合成夹具用于工程控制验证；Trial（试验轮次）的真实业务指标只使用绑定本轮的真实证据。
7. 生产 Runner（调度执行器）的长期稳定性、跨系统迁移和广泛鉴权兼容性须各自有实测证据，不能由合成运行推定。

## 代码分层与工程资产边界

README 的“工程文件结构与代码分层”说明当前目录和目标依赖方向；实现时遵循以下规则：

- `src/mcp/`、`src/cli/` 是入口适配层：处理协议/参数校验、调用服务和格式化响应，不承载业务流程规则。
- 用例编排放在职责明确的服务模块中；核心资产与业务不变量留在 Brain/Domain 能力中；文件、浏览器、宿主和数据 Provider 等外部能力通过接口或适配器接入。
- 依赖从入口和适配器指向用例与领域能力。Domain/Brain 核心不能反向依赖 MCP/CLI、特定宿主、文件系统或浏览器实现。
- 每个模块应只有一个主要变化原因。若修改同时触及输入协议、业务决策、持久化和报告，应先拆出对应职责，再实现新行为。
- `src/mcp/handlers.ts` 是已知的高风险拆分债务。新功能不得继续向其中添加业务编排或通用解析/报告逻辑；先抽到可独立测试的模块，逐步保留原公开 MCP 契约。
- 单元/集成测试、合成浏览器夹具和可复用验收脚本属于工程源代码。单轮 Trial（试验轮次）的输入副本、人工标注、截图、trace、报告和指标快照属于验收产物，不得放入产品源码或 npm 发布白名单。
- 长期验收规则与当前简要状态可保留在 `docs/quality/`；逐轮证据应使用独立归档，并由 Trial ID、代码 SHA、manifest 和哈希索引。历史证据不能为追求整洁而删除或覆盖。
- 用户工作区中的运行资产统一按 `.brain-creator/` 布局管理；不得在仓库根目录或 `src/` 下写入新的运行产物。迁移和清理先预览，再按明确范围确认。

### 旧版 README 中保留的后续规划

旧 README 混合了面向用户的入门说明、PR 功能记录和阶段性计划。用户操作说明已改由新版 README 与中文文档承载；PR 编年内容只保留在 `README.legacy.md` 作为历史；下列长期事项纳入项目规划，并以问题台账核对是否仍未完成：

- BusinessScenario（业务场景）信任晋级依赖需求、系统、测试数据和证据绑定；一次未变化的强观测运行可达到 `verified`，连续三次未变化的强运行才可达到 `trusted`。单次绿色自动化不自动晋级。
- `evaluate-mutations` 已能评价已记录的 caught/survived/blocked 结果；故障样本生成和历史 Bug 回放需分别追踪，不把评价器存在描述成这些能力都已完成。
- EvaluationTrial（评估试验轮次）须冻结需求、代码、运行时和隔离 Store（数据仓库）投影；source、代码或投影变化会影响比较有效性。Synthetic（合成）样本与真实试验分开计算。
- 生产 Runner、跨系统迁移、鉴权 Provider（提供器）兼容范围和长期无人值守运行，需要目标环境中的独立验收；浏览器夹具或 GitHub Actions 合成调度不能替代。

截至 2026-10-29，用户要求将 E（真实业务评估）和 F（结果复核与交付）暂时延期。除非用户明确恢复，不启动相关验收或 Test5 业务写入。实现进度与真实业务结果的口径见质量验收文档，不在本文件中硬编码百分比。

## Git 与工作区规则

用户指定的常规流程是：GitHub `main` → 本地 `fixture` 开发 → 本地 `main` → GitHub `main`。保持一个主工作目录；除非任务确有隔离需求或用户要求，不创建额外工作树和功能分支。

首次准备或同步开发分支：

```bash
git fetch origin main:refs/remotes/origin/main
git switch fixture
git merge --ff-only origin/main
```

如果本地尚无 `fixture`，从 `origin/main` 建立并跟踪：

```bash
git switch --create fixture --track origin/main
```

在 `fixture` 完成修改、检查和提交后，将本地 `main` 快进到最新远端，再快进合并开发结果并推送：

```bash
git switch main
git pull --ff-only origin main
git merge --ff-only fixture
git push origin main
```

只从本地 `main` 推送远端 `main`。若快进失败、分支保护拒绝推送或存在未审查提交，停止并报告原因；不通过重置、强推、自动建 PR 或额外工作树绕过。清理旧分支或工作树前，先核对未提交改动、未合并提交、PR 关联和是否仍被 Store/任务使用；不得只按目录名批量删除。

## 用户沟通与文档语言

- 面向中文用户时，默认用中文对话和撰写交付文档。
- 产品标识、字段、命令、API 和领域类型保持准确英文；首次出现的专业名词应附中文说明，例如 `Trial（试验轮次）`、`RequirementSet（需求集）`、`Evidence（证据）`。
- 不把英文旧文档直接作为中文用户的默认入口；优先维护 `docs/zh-CN/`。
- README 面向产品使用者，介绍定位、架构、入门、安全边界和文档入口；历史 PR 清单和阶段进展不放入 README。
- `README.legacy.md` 是旧 README 的只读备份。稳定项目方向与 Agent 工作规则维护在本文；当前验收事实维护在 `docs/quality/trust-convergence.md` 及相应验收报告。
- `CLAUDE.md` 应保持为指向本文和必要 Claude 专用资源的短入口，不复制整套项目规则。

## 开发命令与检查

- 修改影响单个模块时，运行对应测试：`npx vitest run <test-file>`；涉及多个模块时运行 `npm test`。排除项见 `vitest.config.ts`。
- 类型检查：`npx tsc --noEmit`；构建：`npm run build`。
- 文档站改动：`npm run docs:build`。
- 包装或安装改动：`npm run verify:package-contents` 和 `npm run verify:package-install`。
- `verify:live-*` 与生成的 Playwright 套件可能访问外部 Agent 或真实系统。运行前检查目标、脚本行为和授权；单元测试授权不等于真实业务写入授权。
- 本地编辑、夹具检查和请求范围内的修复可继续完成；相关检查结束后停止，或明确报告阻塞。

## 业务和数据不变量

- 保持 `systemId` 与 `knowledgeProjectId` 隔离。已批准需求表达预期行为；System Brain 观察和执行结果不能静默覆盖需求。
- 保留需求基线审批、用例编译、系统绑定、鉴权就绪和执行确认门禁。证据缺失时使用 ExplorationTask（探索任务）与 Gap（待处理问题）记录，不伪造成功。
- 不编造定位器、测试数据、断言或通过证据。不得通过放宽断言、跳过用例或隐藏失败来掩盖产品问题。
- 凭据须静态加密保存，并在响应、报告和日志中脱敏。
- 产品名称和业务专属规则放在需求、系统知识和测试夹具中，不写进通用规划器。
- 遵循 ESM/NodeNext TypeScript 约定。MCP Handler 负责适配工具请求到服务，不在 Schema 或展示层重复业务决策。

## 参考资料与 Skill 同步

| 工作内容 | 优先阅读 |
|---|---|
| 需求导入、编译、执行与审批 | `skills/brain-creator/SKILL.md`、`docs/zh-CN/agent-usage.md` |
| 领域或编排改动 | `src/domain/`、`src/knowledge/`、`src/brain/`、`src/execution/`、`src/agent/` 的相关服务和相邻测试 |
| 鉴权、证据、恢复和调度 | `docs/quality/reliability-controls.md`、`docs/zh-CN/quality/reliability-controls.md` |
| 已知问题或真实系统回归 | `docs/quality/problem-register.md`、`docs/quality/real-system-regression.md` |
| MCP 安装和发布 | `docs/mcp-installation.md`、`docs/release-checklist.md`、`.github/workflows/ci.yml` |
| 修改仓库说明、Skill 或 Hook | `docs/development-conventions.md` |

`skills/brain-creator/SKILL.md` 是产品 Skill 正本。`.claude/skills/brain-creator/SKILL.md` 与 `plugins/brain-creator/skills/brain-creator/SKILL.md` 必须逐字节一致。安装器只复制单个 Skill 文件；增加引用文件时同步更新安装和打包契约。

Claude Code 的专用 Agent 与 Skill 文件位于 `.claude/`，它们是宿主执行资源，不是另一套项目开发规则。修改这些文件时同时遵循本文的业务、安全、测试和打包约定。
