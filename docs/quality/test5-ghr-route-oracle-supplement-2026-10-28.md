# Test5 集团/GHR 路由 Oracle 补充（2026-10-28）

**状态：** 用户确认的 Test5 本地验收补充输入；保持草稿，不构成基线审批或执行授权。此文件不修改飞书正式需求。

## 本轮适用范围

- 本地 GHR 固定分母为已确认的 28 个 outcome；未执行和 blocked outcome 继续保留在分母中。
- Beisen 跨系统需求保留为外部阻塞项，待第二真实系统和单独授权；不并入本地 GHR 路由结论。
- 写入 OEHR 的路径不在本轮本地 GHR 执行范围内。

## Test5 路由 Oracle

用户确认，本轮 Test5 集团/GHR 的路由预期采用 Test5 页面当前配置的 `hc招聘需求流程`。若其与飞书主文档 revision 2045 或 `流程梳理` 子文档 revision 5 的图示不一致，本轮按 Test5 当前配置判定，同时保留差异；这项决定仅适用于 Test5 GHR，不改写通用需求。

现有系统观察记录 `knowledgeNode_lwkkjic2` 仅证明配置列表显示 `hc招聘需求流程`、ID `Proc000019`、状态“发布”、版本 v9；它没有证明节点条件或实际审批结果。宿主 Chrome 的只读页面观察 `knowledgeNode_d051ahq9` 记录了可见路线：

1. `overseaEstablishment == 1` 指向 HRBP，国内为默认分支；之后进入 HRBP_TA。
2. `orgLevel` 为 2 或 3 时进入需求部门负责人，默认分支进入四级部门负责人。
3. 页面可见职级 `<2-1`、实习生与默认条件，并包含三级部门负责人和嵌套的 `<=2-3` 路径（默认条件包含二级部门负责人）。原始职级 ID 没有映射为可选职级名称。
4. 后续进入 HRBP 经理；可见实习生/默认分支，再进入高职级可见的 HRBP 负责人和 CHO；`职级 > 3-3` 分支指向 CEO，并有默认分支。

### 最新页面核验与证据边界

用户提供了 Test5 `hc招聘需求流程` 设计页路径 `/dwApp/process/designer/db88e8d8-7c40-11f1-9dfa-fefcfe44737d?title=hc%E6%8B%9B%E8%81%98%E9%9C%80%E6%B1%82%E6%B5%81%E7%A8%8B`。2026-10-28 在用户现有 Chrome 登录会话中只读打开该地址，页面显示 `流程设计 - 招聘需求 - hc招聘需求流程` 及流程画布。没有点击“暂存”或“发布”。现有详细转录仍以 `knowledgeNode_d051ahq9` 为依据；其来源为该 Chrome 标签页的可访问性树，置信度 0.8。

Brain Creator 将这次页面采集记录为 PageModel `page_yso7q41u` v4、ProbeResult `probe_aify5s9r`。该采集找到 **0 个定位点**且没有截图；System Brain 为 7 个页面模型，当前快照 `systemBrainSnapshot_dwoles4t` 仍是 candidate，ChangeSet `systemBrainChangeSet_gpemiiu3` 为 `needs-review`，结构化 workflow/state-transition 模型仍为 0。此前独立 Playwright 上下文访问同地址仍跳转到应用 404。当前页面可见性和已有转录都不证明分支实际命中、页面绑定或审批结果。

以上是已登录宿主 Chrome 可访问性树的只读观察，不是逐条审批执行结果。尤其是嵌套职级、默认分支和原始职级 ID 不足以推导出未显示的路径。

页面上的 `requirementJobLevelId` 值尚未映射到 Test5 职级选项。系统观察只作为路由解释的证据来源，不作为已执行结果或独立业务后置状态证据。

## 用户确认的分支处置

- 职级映射未明的相关分支先跳过；对应 outcome 仍留在 28 个分母中并记为未执行，不得标为通过。
- HSSC 系统管理员支线排除在本轮验收执行之外；相关 outcome 仍留在分母中并记为未执行。
- 流程管理员支线不计入本轮测试验收。

## 执行门禁

该补充只解决本轮 Test5 路由口径。RequirementSet 仍为 draft；在批准基线、完成目标系统绑定、逐场景 Oracle 与数据准备审核前，不得据此执行招聘需求或 Offer 写操作。任何测试数据清理仍须提前通知并按确认方案执行。
