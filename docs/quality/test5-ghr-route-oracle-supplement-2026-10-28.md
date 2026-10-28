# Test5 集团/GHR 路由 Oracle 补充（2026-10-28）

**状态：** 用户确认的 Test5 本地验收补充输入；保持草稿，不构成基线审批或执行授权。此文件不修改飞书正式需求。

## 本轮适用范围

- 本地 GHR 固定分母为已确认的 28 个 outcome；未执行和 blocked outcome 继续保留在分母中。
- Beisen 跨系统需求保留为外部阻塞项，待第二真实系统和单独授权；不并入本地 GHR 路由结论。
- 写入 OEHR 的路径不在本轮本地 GHR 执行范围内。

## Test5 路由 Oracle

用户确认，本轮 Test5 集团/GHR 的路由 Oracle 采用页面当前配置的 `hc招聘需求流程`，对应已发布的 `Proc000019 v9`。飞书主文档 revision 2045 和 `流程梳理` 子文档 revision 5 中的图示仅作为候选需求分析输入，不作为 Test5 GHR 的预期路径。图示与 Test5 当前配置描述不同适用范围，不构成本地 GHR Trial 内两个相互冲突的预期；本补充仅适用于 Test5 GHR，不改写通用需求。

现有系统观察记录 `knowledgeNode_lwkkjic2` 仅证明配置列表显示 `hc招聘需求流程`、ID `Proc000019`、状态“发布”、版本 v9；它没有证明节点条件或实际审批结果。宿主 Chrome 的只读页面观察 `knowledgeNode_d051ahq9` 记录了可见路线：

1. `overseaEstablishment == 1` 指向 HRBP，国内为默认分支；之后进入 HRBP_TA。
2. `orgLevel` 为 2 或 3 时进入需求部门负责人，默认分支进入四级部门负责人。
3. 页面可见职级 `<2-1`、实习生与默认条件，并包含三级部门负责人和嵌套的 `<=2-3` 路径（默认条件包含二级部门负责人）。原始职级 ID 没有映射为可选职级名称。
4. 后续进入 HRBP 经理；可见实习生/默认分支，再进入高职级可见的 HRBP 负责人和 CHO；`职级 > 3-3` 分支指向 CEO，并有默认分支。

### 最新页面核验与证据边界

用户提供的设计页路径为 `/dwApp/process/designer/db88e8d8-7c40-11f1-9dfa-fefcfe44737d?title=hc%E6%8B%9B%E8%81%98%E9%9C%80%E6%B1%82%E6%B5%81%E7%A8%8B`。2026-10-28 在用户现有 Chrome 登录会话中直接打开后，页面显示 `流程设计 - 招聘需求 - hc招聘需求流程`、流程画布以及“暂存”“发布”按钮。只读检查取得了页面截图和可访问性树；未点击“暂存”或“发布”，也未操作任何业务数据。

本次可见画布中的路线条件转录如下。原始 ID 按页面显示记录，不解释或推断其对应的职级名称：

1. 发起后，`overseaEstablishment == 1`（优先级 1）进入 HRBP；“国内”为默认条件（优先级 2）。其后画布出现 HRBP_TA 对接人。
2. `orgLevel == "6ba7b810-9dad-11d1-80b4-00c04fd430c8" || orgLevel == "3b1f8b40-9b3e-4f6e-8a2d-5c7e9f1a3b6c"` 标记为“2,3级部门”，进入需求部门负责人；默认条件进入四级部门负责人。
3. 页面显示“职级<2-1”条件，原始 ID 为 `60256f0d-784f-4959-8a30-f92ca0e2e574`、`89fd1471-3701-4f10-b7f7-8556bf51d932`、`e4959ffd-4284-4e50-bd98-1a76228e8bae`；另有“实习生”条件 `personnelType=="2"` 和默认条件。随后画布显示三级部门负责人及嵌套的“职级<=2-3”条件。该嵌套条件包含 `83c6cc96-54ca-4c31-bb84-0af91a42cfcb`、`dac5c9e9-e46f-4772-8c5a-998c5ddee1c4`、`43b6017c-6c16-4c82-9c6a-935b8edef64c`、上述三个 `<2-1` ID，以及 `c8e53ffa-45cb-44df-b4ab-f286b5768ab5`、`c02b7d5a-9a36-4b22-ae53-a349361ccfe7`、`7784afc8-f2f7-40a7-8faf-138857a7ad59`；该嵌套路由的默认条件显示二级部门负责人。
4. 后续画布显示 HRBP 经理。其后再次显示实习生条件 `personnelType=="2"` 与默认条件。默认条件下可见“职级 > 2-3”条件，所列 ID 为 `40c4405d-93e9-47a3-8b38-039613a34032`、`3153a709-c7fb-4e53-bb25-0de6c66a36f4`、`a7394af7-ccb8-425b-9e2f-93f1aad04b2e`、`58310180-e77e-4733-9cdd-80fb9bab755e`、`3cfb2e05-e360-4a69-a401-3d18884ab1e0`、`1fc3060e-ed96-43b5-ada6-62dbea6f4e28`、`18069b04-13d8-4968-8884-43ca448caaf0`、`a8d75ea7-28f8-41b2-a320-ae8d6e712277`、`50ad1139-ca0e-4693-95f6-44dc4ab08122`、`91348580-148a-4549-aa5e-08fbe1d09380`、`518b94b2-d50a-4f10-a58c-f906b88bb695`、`6815367b-28fc-4c7e-bbd1-8e655f09d392`、`ebb6b5d7-25ff-49b1-9343-7570630c6794`、`e8c444c4-db4d-4630-bbf3-81279f710315`、`df34852f-e8aa-4809-9aee-42f3b409c8e6`；画布可见 HRBP 负责人和 CHO。
5. 后续嵌套的“职级>3-3”条件列出 `58310180-e77e-4733-9cdd-80fb9bab755e`、`3cfb2e05-e360-4a69-a401-3d18884ab1e0`、`1fc3060e-ed96-43b5-ada6-62dbea6f4e28`、`18069b04-13d8-4968-8884-43ca448caaf0`、`a8d75ea7-28f8-41b2-a320-ae8d6e712277`、`50ad1139-ca0e-4693-95f6-44dc4ab08122`、`ebb6b5d7-25ff-49b1-9343-7570630c6794`、`e8c444c4-db4d-4630-bbf3-81279f710315`、`df34852f-e8aa-4809-9aee-42f3b409c8e6`，指向 CEO；页面另显示默认条件和流程结束节点。

这次浏览器直读比 Brain Creator 中的 PageModel `page_yso7q41u` v4、ProbeResult `probe_aify5s9r` 更完整：后者没有 locator 或截图，System Brain 的 snapshot `systemBrainSnapshot_dwoles4t` 仍为 candidate，ChangeSet `systemBrainChangeSet_gpemiiu3` 为 `needs-review`，结构化 workflow/state-transition 模型仍为 0。此前独立 Playwright 上下文访问同地址仍跳转到应用 404。上述差异均予保留。

页面截图和可访问性树直接证明登录会话中设计画布当前可见的条件与节点。虽然画面有“暂存”和“发布”按钮，用户于 2026-10-28 明确确认：此链接就是 Test5 当前已发布、实际用于审批的版本，并对应列表标识 `Proc000019` v9。因此，本轮将该链接作为 Test5 专用路由 Oracle；版本对应关系的依据是用户确认，不冒充独立系统校验。页面本身仍不能证明任何分支已命中或审批已发生，真实执行及业务后置状态仍须独立验证。页面上的 `requirementJobLevelId` 尚未映射到 Test5 职级选项；用户已要求跳过相关职级分支，相关 outcome 继续留在分母并记未执行。

## 用户确认的分支处置

- 职级映射未明的相关分支先跳过；对应 outcome 仍留在 28 个分母中并记为未执行，不得标为通过。
- HSSC 系统管理员支线排除在本轮验收执行之外；相关 outcome 仍留在分母中并记为未执行。
- 流程管理员支线不计入本轮测试验收。

## 执行门禁

该补充只解决本轮 Test5 路由口径。RequirementSet 仍为 draft；在批准基线、完成目标系统绑定、逐场景 Oracle 与数据准备审核前，不得据此执行招聘需求或 Offer 写操作。任何测试数据清理仍须提前通知并按确认方案执行。

## 用户确认的需求关闭 Oracle

- 需求成功关闭后的需求状态为 `已关闭`，按正式正文记录。
- 需求关闭不直接改变关联 Offer 状态；不从需求状态推断 Offer 或 OA 状态变化。
- 任一关联 Offer 为 `已接受offer` 或 `已发offer` 时，阻止直接关闭。其他关联 Offer 状态按用户确认的二次确认规则处理。
- 用户确认的 `已接收` → Test5 页面 `已接受offer` 映射和以上关闭优先级仅冻结为候选 Oracle；目标系统中的提示、动作、需求状态、Offer 状态和 OA 后置状态仍须逐项独立验证。
- 当前授权仍限于创建、提交、转交、审批和关闭，使用当前登录账号；任何测试数据清理均须提前通知并遵循确认后的策略。

## 2026-10-28 修订：37 条意图与 11 个场景

本次按用户要求先修订原 37 条 TestIntent 与 11 个 BusinessScenario，不开始 28 个 outcome 映射。37 条原始意图逐条处置见 `test5-ghr-intent-revision-review-2026-10-28.md`：范围和 Oracle 说明改作共享上下文；相邻流程边组合成完整可证实的路径前缀；互斥条件拆分；未映射分支保留为 blocked 或 not-executed。旧版 RequirementSet 保留历史，不原地覆盖。

以下 11 个是当前 draft 的场景结构。所有 route 场景都以已提交需求为起点，逐节点核对实际审批任务；流程画布可见性只作为配置 Oracle，不代替实际命中证据。

1. **GHR-ROUTE-01 海外 + 二/三级部门：** `overseaEstablishment == 1`，经 HRBP、HRBP_TA 后，`orgLevel` 命中页面标记的 2/3 级，预期下一节点为需求部门负责人。
2. **GHR-ROUTE-02 海外 + 部门默认：** `overseaEstablishment == 1`，经 HRBP、HRBP_TA 后，`orgLevel` 走默认条件，预期下一节点为四级部门负责人。
3. **GHR-ROUTE-03 国内 + 二/三级部门：** 国内默认分支进入 HRBP_TA 后，`orgLevel` 命中页面标记的 2/3 级，预期下一节点为需求部门负责人。
4. **GHR-ROUTE-04 国内 + 部门默认：** 国内默认分支进入 HRBP_TA 后，`orgLevel` 走默认条件，预期下一节点为四级部门负责人。
5. **GHR-CLOSE-01 无关联 Offer：** 只有需求操作列实际提供关闭动作时才执行；关闭成功后独立读取需求状态应为 `已关闭`。不推断 Offer/OA 状态变化。
6. **GHR-CLOSE-02 关联 Offer 为已接受或已发：** 两种数据变体均应阻止直接关闭；混合状态中只要有任一 `已接受offer` 或 `已发offer`，阻止规则优先。两种变体须分别有实际证据，不能由一个样本代替。
7. **GHR-CLOSE-03 其他关联 Offer 状态：** 若关联 Offer 不含 `已接受offer`/`已发offer`，预期二次确认；确认后仅在操作成功且独立读取到需求状态 `已关闭` 时记成功。Offer/OA 状态分别核验，不作推断。
8. **GHR-ROUTE-05 未映射职级分支：** 页面中的职级 ID 尚未映射到 Test5 可选职级；依赖这些条件的结果保持未执行，并继续计入 28 个 outcome 分母。
9. **GHR-ROUTE-07 实习生分支：** `personnelType == "2"` 与未映射职级分开；当前配置转录未确定其下一审批人/终态，保持 blocked，不并入其他路径。
10. **GHR-ROUTE-06 HSSC 系统管理员分支：** 用户已排除此支线的执行，但相关 outcome 继续保留在 28 项分母并记未执行；流程管理员支线不纳入本轮验收。
11. **GHR-CALLBACK-01 回调状态映射：** 候选映射为来源回调 `已接收` 对应 Test5 列表 `已接受offer`；需要绑定同一业务实体并独立读取状态后才能判定。此编号刻意与固定 28 outcome 中的 Offer 审批路线 `GHR-OFFER-01` 区分。

4 个 route 场景只覆盖当前配置能明确区分且不依赖未知职级的前缀，分别跨越地区入口、HRBP（如适用）、HRBP_TA 和部门负责人分支。部门负责人之后的职级/人员类型路径未据画布可见性推断为已命中。实习生与职级分支分别记录。关闭候选 Oracle 已按用户确认的优先级整理：任一已接受/已发 Offer 阻止直接关闭；其他关联 Offer 状态要求二次确认；无关联 Offer 在页面提供关闭动作时可直接关闭，成功需求态为 `已关闭`。

该设计仍为 draft：Brain Creator canonical source revision 6 / RequirementSet `requirementSet_nixk1cms` v6 经 Test Design Policy 2.2.8 生成 18 个意图和 11 个场景，Critic 为 `needs-review` (0.62)，Scenario Assurance 为 11 blocked / 0 pass。路径级意图保存完整转移序列、适用条件和角色交接；这仍是设计证据，不代表路径实测。所有场景都缺少确认的 System Brain 绑定、结构化 Oracle 和场景数据档案；blocked/not-executed 条款不会生成可执行数据准备。固定 28 outcome 分母不变，当前映射 0、独立业务证据 0/28；未执行与 blocked 均保留。不批准基线、不启动 Trial、不进行 Test5 业务写入或数据清理。
