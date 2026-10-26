# 存储与证据

Brain Creator 使用本地文件仓库。默认运行仓库是 schema 21 分片目录 `.brain-creator/store/`。旧的 `.brain-creator/local-assets.json` 仍作为迁移源和兼容格式保留，但新 MCP 上下文默认不会继续写入这个单文件。

## 迁移

首次启动且不存在 schema 21 manifest 时，Brain Creator 会检查 `local-assets.json`，先校验 JSON，创建带时间戳的 `local-assets.json.backup-*` 备份，再通过临时文件和原子重命名写入分片仓库，并校验新的 manifest。已有 schema 19 和 schema 20 仓库会在 `store/backups/` 生成独立迁移快照；迁移失败不会删除旧文件，也不会把历史用例自动晋升为可信场景。

主要目录如下：

```text
.brain-creator/store/
  manifest.json
  collections/<资产集合>.json
  systems/<系统 ID>/system.json
  systems/<系统 ID>/assets.json
  knowledge/<知识项目 ID>/requirements/<需求 ID>.json
  runs/<Suite 运行 ID>/ledger.jsonl
  collections/evaluationTrials.json
  collections/sourceSnapshots.json
  collections/projectionManifests.json
  collections/interventionRecords.json
  indexes/asset-index.json
```

可以通过 `BRAIN_CREATOR_STORE_DIR` 指定其他分片目录。`BRAIN_CREATOR_DATA_FILE` 仍可作为旧仓库迁移源。Brain Creator 运行期间不要手工修改这些文件，应使用 Facade 控制面。

## 评估完整性

L3 A/B 对比或历史准确率评估必须先创建 `EvaluationTrial`。Trial 会冻结需求来源版本和 hash、代码 revision、运行时版本、工作区和独立 Store 路径。受控 Facade 操作改变评估投影后，必须使用上一份 manifest ID 和证据引用建立 checkpoint。需求或代码变化、手工修改 Store、无法解释的投影漂移都会使 Trial 失效。可通过 `bc_review target=evaluation-trial` 复盘来源快照、投影链和干预记录。

## Doctor 检查

运行：

```bash
npx brain-creator doctor
```

报告会检查 manifest 格式和版本、索引是否存在、遗留单文件以及未完成的临时文件或锁文件。`warn` 表示需要复核但不一定阻止执行；`fail` 表示 manifest 不可信，应先从备份恢复再执行测试。

如果索引缺失且当前没有 Suite 或 Agent 任务，可以通过运行时控制面重建：

```json
{
  "target": "runtime",
  "operation": "rebuild-index"
}
```

## 证据 manifest

新的文档 Suite 和 Requirement Suite 使用同一套归属目录：

```text
.brain-creator/artifacts/<系统>/<需求>-v<版本>/<Suite 运行>/
  source/
  analysis/
  cases/
  specs/
  tests/
  evidence/
  report/
  manifest.json
  index.md
```

`latest.json` 保存在 Suite 目录的同级。每个已存在的产物都记录工作区相对路径、字节数、SHA-256 hash 和来源引用。缺失证据会被明确记录；工作区外的产物路径会被拒绝。

历史根目录产物通过统一 CLI 管理。迁移和清理在传入 `--confirm` 前都只返回预览：

```bash
npx brain-creator artifacts migrate
npx brain-creator artifacts migrate --confirm
npx brain-creator artifacts rollback --migration <迁移 ID> --confirm
npx brain-creator artifacts retention --older-than-days 90
npx brain-creator artifacts retention --older-than-days 90 --confirm
```

迁移会校验 hash、更新仓库路径、写入 `legacy-path-index.json` 并支持回滚。无法证明归属的文件会保存在 `artifacts/unresolved/`。清理只选择带 manifest、已终止且非 latest 的 Suite 目录。

## 导出

将已完成的文档 Suite 导出为可迁移 ZIP：

```bash
npx brain-creator export --suite <suite-run-id> --output exports/suite.zip
```

归档包含归属该运行的 source、analysis、cases、specs、tests、evidence、report、index 和 manifest，不包含仓库、密钥、浏览器 storage state 或其他无关工作区文件。Bridge 和 Host Agent 的 Generator/Healer 输出会在 Playwright 执行前或任务接收前检查，ZIP 导出时还会再次扫描。缺失证据会列在 manifest 中，不会被静默忽略。

## 结构化执行证据

当宿主只能提供只读 DOM／无障碍树观察时，页面证据可以不包含 `screenshotPath`。
此类采集会标记为 `host-accessibility-observation`，不会生成虚假的截图 ID；定位置信度会受限，ProbeResult 会明确记录缺少截图证据。
它可用于有界探索，但不能作为执行证据或强业务断言。可用时，真实浏览器采集仍应附带经过校验的截图产物。

执行证据现在区分“运行成功”和“需求验证强度”。一条证据可以包含：

- `assertionContracts`：带需求来源引用、证据要求和类型的断言契约。
- `reporterResult`：标准化后的 Playwright JSON Reporter 结果。
- `assuranceLevel`：`strong`、`limited` 或 `none`。
- `reporterPath`：执行器返回结构化结果时保存的 Reporter 文件。

静态 HTML 报告与 Markdown 证据报告一起生成。即使命令退出码为 0，如果没有完成结构化 Reporter 映射，结果仍为 `none`，不能被描述为强需求验证。报告是离线执行产物，不是新的 Brain Creator UI 入口。

执行完成后，Brain Creator 还会独立写入 `ConformanceResult`，把“过程是否跑完”和“是否有足够证据支持需求符合”分开。只有通过、强断言和完整来源证据才能得到 `conform`；有限证据得到 `inconclusive`，无断言 Oracle 得到 `requirement-review`，确认的产品缺陷得到 `nonconform`。可通过 `bc_review target=conformance` 按系统、需求版本或场景复盘这些结论。

完成执行证据后，系统还会自动评估场景可信状态。首次强证据可见观察运行会将
已绑定场景推进到 `verified`；连续三次需求、System Brain 和数据版本不变的强
证据通过后才进入 `trusted`。首次无头通过会停留在 `bound`，等待可见观察证据。
缺少 Reporter、来源引用、必需覆盖或非通过诊断时，不能晋升，并会把原因写入
证据。需求、System Brain 或数据计划发生变化会清零之前的强运行次数。

报告开头会给出白话摘要：本次理解了什么、观察到什么、用了哪些可复用数据、
实际结果是什么、失败属于哪一类，以及为什么可以或不可以支持需求符合性判断。
Suite 报告还会统计可信、已验证和已隔离的场景证据。

## 鉴权密钥处理

新的鉴权密文使用 `.brain-creator/secret.key` 中的随机本地密钥。可通过 `BRAIN_CREATOR_SECRET_KEY` 使用外部托管密钥，也可通过 `BRAIN_CREATOR_SECRET_KEY_FILE` 指定密钥文件；环境变量优先。已有 `enc:v1` 数据在读取配置时会先解密，再重新加密为 `enc:v2`。生成的 token/cookie seed 只引用 `BRAIN_CREATOR_AUTH_TOKEN` 或 `BRAIN_CREATOR_AUTH_COOKIE`，不会写入凭据值。所有产物阶段都会匹配当前受保护凭据值，以及私钥、JWT、Bearer Token、明文 password/token/cookie 字段等高置信凭据模式。

## 证据完整性密钥托管与轮换

运行投影与执行语义快照的 HMAC 默认使用 workspace 密钥。需要独立托管时，配置 `BRAIN_CREATOR_INTEGRITY_KEY` 或 `BRAIN_CREATOR_INTEGRITY_KEY_FILE`（二选一）；`BRAIN_CREATOR_INTEGRITY_KEY_ID` 标识当前密钥，默认 `external-current`。新签名包含 key ID，格式为 `v1:<key-id>:<digest>`。轮换期间，将旧密钥放在 `BRAIN_CREATOR_INTEGRITY_PREVIOUS_KEYS` JSON 对象中，以 key ID 映射密钥值；新签名始终只使用当前密钥，验证可按 key ID 校验新签名，并在旧密钥仍可用时校验旧的无 ID 签名。更改配置后需重启 MCP/CLI 进程。仅当保留证据均已重新签名或明确失去资格后，才移除旧密钥；被移除密钥签名的记录将无法验证，不能用于可信晋升。密钥值必须通过受保护的环境注入或访问受控的密钥文件提供，不会写入报告或日志。验证缺失密钥时不会创建新密钥。
