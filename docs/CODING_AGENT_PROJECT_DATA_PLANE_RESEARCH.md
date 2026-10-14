# 项目只读数据面：重新调研

> 状态：深入调研稿 v2，2026-10-13  
> 性质：**重新做分类学与证据面调研**，不是把聊天结论贴进文档。  
> 本稿替代同日浅补记；结论均挂可核对来源。  
> 实现状态见 §9；未交付项禁止写成「已能查库」。

---

## 0. 调研要回答的问题

1. 只读顾问最少需要几类证据源？原先「代码 + 运行材料」是否充分？  
2. 「运行材料 / Runtime Access」是否被错误地当成「能覆盖一切实例事实」？  
3. 业务库 / API 里到底有什么（不止 job 日志）？分类学如何写才不被接入清单再次压扁？  
4. Cursor 定 GT 时如何查库？那种做法能否原样产品化？  
5. 顾问该不该自己写 SQL？行业里成熟做法是什么（负载，不只是注入）？  
6. 对本仓架构 / 接入清单 / 实现优先级，必须改哪些断言？下一步用什么实验关掉争论？

---

## 1. 方法与证据边界

### 1.1 用了什么（主证据）

| 证据类 | 具体材料 | 用途 |
|---|---|---|
| 本仓既有设计 | 概要 / 详设 / 架构 / 统一计划 / 开发计划 / 产品定位 | 还原「两面证据」如何写进权威文档 |
| Planora Q123 ablation | `~/.impl-advisor/planora/ablation/user-q123-20261012T093000Z/` 的 `question.md`、`QUALITATIVE.md`、`GT-COMPARE.md`、四臂 `answer.md` | **阴性对照**：有代码 ± 文件仍缺实例 provenance |
| Planora 顾问配置 | `~/.impl-advisor/planora/project.json` | 现状：`runtime.mode=ssh`；**无** `structuredRuntime` |
| SSH 护栏文档与实现 | `docs/SSH_READONLY_GUARDRAILS.md`、`readonly-advisor/ssh-readonly.js` | 文件面白名单：无 DB |
| Planora schema（顾问 workspace） | `/Users/ltc/CursorProject/中交机电局项目/planora/prisma/schema.postgres.prisma` | **82** 个 model；含 rewrite 域 |
| Planora schema（GitHub 副本） | `/Users/ltc/Documents/GitHub/planora/prisma/schema.postgres.prisma` | **57** 个 model；**缺** rewrite 等表 → 说明「随手读错 checkout 的 schema」也会漏第三面 |
| Cursor 历史会话 | `~/.cursor/projects/Users-ltc-WindowsProject/agent-transcripts` 等中含 `psql`/`SELECT` 的 shell 命令 | 统计人工查库习惯与触达表 |
| 行业公开实践 | Tier2「no free-form SQL」、MCP Toolbox read-only tools、Agentic Fabriq Postgres agent guides 等 | 命名查询 / 只读角色 / 预算，非本仓已实现 |

### 1.2 不用来证明什么

- 不因一份设计文档写了「两面」就证明两面够用。  
- 不因 Cursor 能 `psql` 就证明顾问产品已具备安全数据面。  
- 不把 Planora 全库 82 表当成顾问默认可读范围。  
- 不把行业博客当成已在本仓落地。  
- 不把「code 臂碰巧答对某原子」当成「文件面已覆盖数据面」（见 §3.3）。

### 1.3 能力状态标签（对本仓代码）

| 标签 | 含义 |
|---|---|
| `[已实现]` | 有可执行路径 |
| `[预留]` | 有配置/接口占位，无完整执行路径 |
| `[文档已纠正]` | 设计文档已改口，实现未齐 |
| `【待确认】` | 尚缺对照实验或第二项目证据 |

---

## 2. 前期调研如何不够充分

### 2.1 文档级假设（错误收窄）

多份权威设计把证据访问写成 **Code Access + Runtime Access** 两块：

| 位置 | 原断言（摘要） | 问题 |
|---|---|---|
| 架构 Evidence Access | Code + Runtime（日志/产物/运行记录） | 把结构化业务对象并进或省略 |
| 详设运行接口 | `searchRuns/getRun/getArtifact/readLogs` | 全是 run/文件语义 |
| 统一计划 U5 | 「代码和运行材料」；无脚本时「探索可读材料」 | 默认探索对象是文件树 |
| 产品定位 | 能答某次运行 ⟺ 代码入口 + 运行材料入口 | 未单列数据入口与缺省降级 |
| 开发计划组件表 | Runtime Access = export-dir + SSH | 完成定义过窄；无 Project Data Access 行 |
| SSH 护栏 | 白名单 `ls/head/find/...` | 正确且必要，但**不能**被误读成「运行入口已覆盖实例数据」 |

这些表述在「有导出目录或日志就能解释一次执行」时近似成立，却把 **业务库中的对象事实** 悄悄排除，或误并进「运行材料」。

### 2.2 当时应问却没钉死的调研问题

| 应问 | 当时实际做法 | 后果 |
|---|---|---|
| 专家问题里的「这一次」事实存在哪？ | 默认想成日志/导出 | 漏 DB/API |
| 文件型 RuntimeReader 覆盖率上限？ | 未用实例题做阴性对照 | 高估 SSH/export-dir |
| 实例题 vs 机制题要什么材料？ | 混在「运行解释」一栏 | Q1/Q3 被当成「再多搜文件」 |
| 若必须读库，威胁模型是什么？ | 未做 | 易默认「让模型写 SQL」 |
| Cursor 人工 `psql` 算不算产品能力？ | 未写入能力边界 | GT 能答、顾问不能答，却未触发架构修订 |
| 顾问 workspace schema 与公开副本是否一致？ | 未比对 | GitHub 57 表副本**没有** rewrite 域，分类学易漏 |

**判断：** 不是「漏写一句 DB」，而是 **证据面分类学没做完**——在首轮接入设计里把「项目结构化数据」当成 Runtime 的子集或可省略项。

---

## 3. Planora Q123：阴性证据（文件面不够）

### 3.1 题目与评分原子

题目原文：`.../user-q123-20261012T093000Z/question.md`。

`GT-COMPARE.md` 软分原子（与 auto-score 的 deploy/GPU 题无关）：

| ID | 原子 | 钉事实主要依赖 |
|---|---|---|
| Q1a | 目录 = 知识库投标施组兜底模板（具体模板名） | **数据面**：`Project.templateId` → `TemplateProfile` / `TemplateVersion` |
| Q1b | 正文 = chapter.generate / 策略生成（非技术规格书 docx） | 代码机制 + 可选 `Chapter`/`ChapterPlan`/`AiJob` |
| Q1c | 提到「青岛-招标文件.pdf」作证据/资料 | **数据面**：`FileAsset`（或上传元数据） |
| Q2a | `maxMediaDocumentPages=32` / 33>32 | **代码面**为主；报错字面可来自页面/问题 |
| Q2b | 点名该次失败文档/任务 | 问题已含文档名；完整 job 行靠 **数据面** `AiJob` / `TechnicalSpecRewriteDocument.error` |
| Q3a | 产物字面「确保适带宽」（不是「确保适应带宽」） | 问题措辞可**推导**；**核验**靠 draft/history **数据面** |
| Q3b | 根因 = ensure +「带」臂误伤「适应」内「应」 | **代码面** |
| Q3c | 明确未修复 / 仍可复现 | 代码版本 + 部署绑定；**不是**多搜文件能替代 |

### 3.2 QUALITATIVE 原话要点

`QUALITATIVE.md`：

- none：正确拒绝实例事实；只能解析错误字面。  
- code：Q2/Q3 机制强；Q1 只有代码路径推测，无项目行。  
- runtime/full：可读部署代码 + 候选；**仍不能查 Postgres**，故拿不到项目级 provenance（模板名、job ids、draft 字面核验）。  
- GT 依赖护栏外只读 `psql`（顾问 SSH 白名单外）。

四臂 `answer.md` 关键词抽查：多臂出现「数据库」字样但**无实际查询**；`project.json` 当前无 `structuredRuntime`。full 臂极短总结且未钉住 Q1 模板名。

### 3.3 必须分开的两件事

1. **机制题**（Q2a、Q3b）：代码面经常够。  
2. **实例 provenance 题**（Q1a、Q1c；Q3a 的核验）：文件面（SSH `ls/head/find`、export-dir）**没有**这些行。

code 臂在 `GT-COMPARE` 上对 Q3a 打 OK，**不等于**数据面已通：问题本身写了「适应带宽」去掉「应」、前面加「确保」，模型可推出「确保适带宽」。  
**核验**「历史 AI 改写记录里确实是这个字面」仍要读 `TechnicalSpecRewriteDraft.content`（或等价 history），那是数据面。

因此：

```text
代码面  ⊨ 机制解释（经常够）
文件面  ⊨ 部署树 / 部分日志（有时够）
数据面  ⊨ 业务对象实例事实（Q1/Q3 核验类经常必需）
```

**文件面 ⇏ 数据面。** 这是实证，不是偏好。

---

## 4. 「项目数据」分类学（以 Planora 为样本）

样本 schema：顾问 workspace 的 `schema.postgres.prisma`（**82** model）。  
对比：GitHub `planora` 副本仅 **57** model，**缺少**整组：

`TechnicalSpecRewriteDocument` / `Draft` / `Media` / `TechnicalSpecReviewSession`，以及多项 Dangerous*、ScoreRequirement*、Interaction* 等。

**调研含义：** 数据面分类必须以**实际运行环境绑定的 schema**为准；拿错 checkout 会再次「调研漏表」。

### 4.1 按「专家会问什么」分组（不是按 ORM 文件夹）

| 类别 | Planora 例子 | 典型问题 | 默认是否对顾问开放 |
|---|---|---|---|
| 项目/成员元数据 | `Project`, `ProjectMember` | 哪个项目、业务线、阶段、绑定模板 | 常开（脱敏后） |
| 模板与策略 | `TemplateProfile`, `TemplateVersion`, `ChapterPlan.strategy`, `ExportTemplate` | 目录/策略从哪套模板来 | 常开 |
| 文档与资产 | `FileAsset`, `DocumentChapter`, `KnowledgeAsset`… | 上传了什么、类别、checksum | 常开摘要；正文慎开 |
| 生成产物 | `Chapter`, `ChapterVersion`, `ChapterPlan` | 正文/大纲如何生成 | 摘要常开；长正文限流 |
| 改写对象 | `TechnicalSpecRewriteDocument`, `Draft`, `Media`, `ReviewSession` | before/after、draft 字面、解析错误 | **实例题常必需**；全文截断 |
| 任务/作业 | `AiJob`, `ParseTask`, `ExportTask`, `CheckTask` | 哪次 job、状态、error/result | 常开摘要 |
| 评测/审计/遥测 | `AuditLog`, `PromptTrace`, `EvaluationSample`, `Interaction*` | 追溯 | **默认更严** |
| 领域扩展 | Dangerous*、ScoreRequirement*、DeviceResponse*… | 专题题 | 按题注册，不默认全开 |
| 鉴权 | `User`, `Role`, `Permission`… | — | **默认不对顾问开放** |

把这一切叫「运行记录」会在产品和接入清单上再次误导：模板名、FileAsset、draft **不是**日志文件的子集。

### 4.2 与文件面的边界（操作级）

| 能力 | 落在哪一面 | Planora 现状 |
|---|---|---|
| release 树、`current` 符号、日志切片 | 文件面 | SSH 护栏 `[已实现]` |
| `Project.name LIKE …` 定位项目 | 数据面 | 仅 Cursor 护栏外 psql |
| `TemplateVersion.directory` / 模板标题 | 数据面 | 同上 |
| `FileAsset.originalName` 列表 | 数据面 | 同上；uploads 目录文件名**不等于**库内 category/关联 |
| `TechnicalSpecRewriteDraft.content` 截断核验 | 数据面 | 同上 |
| `AiJob.error` / `result` JSON 摘要 | 数据面（偶有日志回声） | 日志可能有片段，**稳定主键与关联在库** |

---

## 5. Cursor 查库方式：能力、习惯、不可产品化点

### 5.1 实际通道

`ssh 123` → `sudo -u postgres psql -d planora`（或经 `DATABASE_URL`）→ 即席 SQL。  
这在顾问 SSH 白名单之外；`SSH_READONLY_GUARDRAILS.md` 明确只有 `health/ls/head/find-names/deploy-snapshot/run-candidates/ask-preflight` 等。

### 5.2 从历史会话挖到的习惯（定量）

在本地 Cursor 相关 transcript 中检索含 `psql`/`SELECT` 的 shell 命令（约 **60** 条命中）：

| 习惯 | 约略频次（命令级） | 含义 |
|---|---|---|
| `sudo -u postgres` | 高 | 研究通道，非产品角色 |
| `LIKE` | 高 | 先按名称缩小 |
| `information_schema` | 高 | 先摸列再查 |
| `LIMIT` | 中高 | 限行 |
| `left(`/`substring(` | 中高 | 长字段截断 |
| 外壳 `head` | 高 | 再砍输出 |
| `SELECT *` | 相对少但仍出现 | 仍有整行灌入风险 |
| 显式 `"projectId"=…` | 会话内常见（转义导致自动计数偏低） | 范围约束 |

高频触达表（命令文本提及）：`Project`, `AiJob`, `Chapter`, `FileAsset`, `TechnicalSpecRewriteDocument`, `TechnicalSpecRewriteDraft`, `TemplateVersion`, `ChapterPlan`…

典型链路（与 Q123 同构）：

1. `Project` WHERE name/code `LIKE` → 得 `id`  
2. `FileAsset` / `Template*` / `AiJob` WHERE `"projectId"`  
3. rewrite：`TechnicalSpecRewriteDocument` → `Draft`，对 `content` 做 `length`/`left`/`position`

### 5.3 为何不能原样交给顾问产品

| 维度 | Cursor 人工 psql | 产品默认若开放自由 SQL |
|---|---|---|
| 停手 | 人会累、会改查询 | Agent 不累，假设驱动连扫 |
| 成本可见性 | 人感知慢查询 | 取消的语句可避开统计（行业案例） |
| 审计 / 回归 | 会话日志散落 | 需稳定 `queryId` |
| 安全评审 | 一次性人工 | 「模型会写 SQL」无法收敛成批准清单 |
| 上下文 | 人选择性粘贴 | 大 JSON/draft 易整段灌进 prompt |
| schema 漂移 | 人可换库核对 | 接错 checkout schema 会静默漏表 |

**结论：** Cursor 证明「只读库对答实例题极有价值」，同时证明「自由 SQL 是研究工具，不是顾问默认工具面」。

---

## 6. 顾问该不该自己写 SQL？

### 6.1 「模型写得出合适 SQL 吗？」

**经常写得出**（有 schema、有示例、有缩小范围的提示时）。这不是瓶颈。  
瓶颈是：**写得出 ≠ 应被允许在生产路径上无限次执行。**

### 6.2 方案比较

| 方案 | 谁定义查询形状 | 负载/上下文 | 可评审性 | 推荐 |
|---|---|---|---|---|
| 自由 SQL 工具 | 模型 | 差：易全表扫、易灌上下文 | 差 | **否（产品默认）** |
| 模型起草 + 解析器校验 | 模型+规则 | 中：仍难防劣质 plan | 中 | 仅严格试点 |
| **命名参数化查询** | **接入方/平台注册** | **好：形状已知、可 LIMIT** | **好：清单可批准** | **默认** |
| 只读 BFF / 安全视图 | 接入方 | 好 | 好 | 与命名查询同类 |

### 6.3 行业旁证（负载，不只是注入）

[Tier2: We did not give the agent SQL](https://tier2.dev/blog/no-free-form-sql)：

- 只读角色挡写破坏；**真正要防的是「善意扫库」打挂库**；  
- 控制：只读副本、表白名单、`statement_timeout`（文中 20s）、关并行 gather、**仅命名参数化查询**、每会话查询预算（文中 10）+ 租户小时上限；  
- 超预算 → 会话 `inconclusive`，而不是继续扫；  
- 新查询 = 可 diff 的 runbook 变更。

同类方向：

- [MCP Toolbox Read-Only Tools](https://mcp-toolbox.dev/documentation/configuration/security/read-only/)：预置 SQL 工具 + 源级 `readOnly`；  
- [Agentic Fabriq: safe Postgres access](https://agenticfabriq.github.io/connect/databases/)：只读角色、副本、命名关系 GRANT、timeout、**参数化工具而非 SQL box**；并强调：占位符防的是值注入，**防不住「模型被问题诱导去问不该问的问题」**——还要靠工具白名单。

对本产品：**默认命名查询；自由 SQL 留给人工研究通道（显式、审计、非 DSH 默认工具）。**

---

## 7. 推荐的顾问侧契约（调研结论，非已交付）

### 7.1 三面证据访问（架构应改成）

```text
Evidence Access
├── Code Access          源码 / Git
├── Runtime File Access  日志 / 导出 / release 树（原 Runtime Access）
└── Project Data Access  元数据 / 文档 / 策略 / 任务 / draft…（新增）
```

文件/运行语义保留：

```text
searchRuns / getRun / getArtifact / readLogs
```

数据面另立：

```text
data.list  (collection, filter) -> RecordCard[]   # 限条数、摘要字段
data.get   (collection, id)     -> RecordDetail   # 字段投影 + 字符预算
data.query (queryId, params)    -> Rows           # 命名只读查询（主路径）
```

现网关过渡名 `run.record_list` / `run.record_get` **应迁** `data.*`，避免再把第三面说成「只有运行记录」。

### 7.2 硬边界（产品默认）

1. DB 角色：只读；优先副本；表白名单或仅视图。  
2. `statement_timeout` + 行数/字节上限；必要时限制并行。  
3. 模型不可提交任意 SQL 字符串。  
4. 大字段默认截断；全文需二次 get 或显式字段。  
5. 每会话查询预算；超限 → 回答标记证据不足，而不是继续扫。  
6. 返回物进证据卡 / 工作记忆，不默认塞进无限 transcript。  
7. 绑定 **环境对应 schema**（避免 GitHub 瘦副本漏表）。

### 7.3 接入方工作

合作方注册：集合说明、命名查询、参数、索引预期、敏感字段策略。  
**这不是「为每个 bug 写特判」**，而是「登记可问数据集」——与 SSH 只许 `ls/head/find` 同级。

### 7.4 Planora 最小命名查询集（建议草案，≤8，对齐 GT 触达表）

> 下列为**调研推导的注册清单**，不是已实现 SQL，也不是 Q3 fixture。

| queryId | 参数 | 目的 | 对应原子 |
|---|---|---|---|
| `project_by_name` | `nameLike` | 定位 `Project` | 入口 |
| `project_template` | `projectId` | 模板 profile/version 摘要 | Q1a |
| `project_files` | `projectId`, optional `nameLike` | `FileAsset` 名片 | Q1c |
| `jobs_by_project` | `projectId`, optional `typeLike` | `AiJob` 列表摘要 | Q2b 等 |
| `rewrite_docs_by_project` | `projectId` | rewrite document 名片 | Q2/Q3 入口 |
| `rewrite_draft_excerpt` | `documentId`, `needle?` | draft `left`/`position` 核验 | Q3a 核验 |
| `chapter_plans_by_project` | `projectId` | 策略/章节计划摘要 | Q1b 补充 |
| `job_get` | `jobId` | 单 job error/result 截断 | Q2b |

每条必须：固定 SQL 或视图、强制 `LIMIT`、长字段截断、只读角色。

---

## 8. 对本仓文档与实现的含义

### 8.1 必须改掉的断言

任意「最低接入」列表必须显式出现：

1. 代码只读入口；  
2. 运行**文件**只读入口（可选：无则不能声称还原某次部署/日志）；  
3. **项目只读数据入口**（可选：无则实例 provenance 降级为机制解释 / 明确未知）。

禁止再写隐含等式：`运行材料 ≈ 能回答项目里某一行数据的问题`。

### 8.2 开发优先级含义

- 「加深运行搜索和日志覆盖」**不能**作为「代码机制对、个案对不上」的唯一对策（开发计划触发表需改）。  
- P1 验收「一个具体运行问题」应拆成：文件面运行题 **与** 数据面实例题；后者依赖命名查询，而不是更多 `find`。

---

## 9. 本仓实现状态（避免把调研写成已完成）

| 项 | 状态 | 证据 |
|---|---|---|
| SSH 文件护栏 | `[已实现]` | `readonly-advisor/ssh-readonly.js`，`docs/SSH_READONLY_GUARDRAILS.md` |
| 运行候选 list | `[已实现]` | `runtime-search.js` |
| 项目数据面契约 + fixture list/get | `[预留]` / 协议可测 | `structured-runtime.js`，`fixtures/structured-runtime/`（**中性 FOO/bar，非 Q3 答案**） |
| 网关名 `run.record_*` | `[预留]` 过渡命名 | 应迁 `data.*` |
| `structuredRuntime.mode=sql` | `[预留]` | 返回 `not_implemented`；接通前必须是命名查询驱动 |
| DSH 可调用数据面工具 | `【待确认】` / 未接 | 尚未进入 harness 工具循环 |
| Planora `project.json` 挂数据源 | `【待确认】` | 当前无 `structuredRuntime` |
| Planora 生产命名查询集 | `【待确认】` | 未交付 |
| 第二项目复用同一契约 | `【待确认】` | 未做 |

---

## 10. 必须回写的文档断言（清单）

| 文档 | 问题断言 | 2026-10-13 回写 |
|---|---|---|
| `CODING_AGENT_ADVISOR_SERVICE_ARCHITECTURE.md` | Evidence Access 仅 Code + Runtime；工具表无数据查询 | **已改**：三面 + Access Planner + 数据查询工具行 |
| `CODING_AGENT_RUNTIME_ADVISOR_DETAILED_DESIGN.md` | 组件树 Runtime Access；无 data 接口；项目方清单无数据入口 | **已改**：三面 + §4.4 + 清单 + Composer |
| `CODING_AGENT_ADVISOR_UNIFICATION_PLAN.md` U5/U10 | 「探索可读材料」未区分文件 vs 数据 | **已改** |
| `CODING_AGENT_ADVISOR_DEVELOPMENT_PLAN.md` | Runtime Access 完成定义过窄；触发表「加深日志」 | **已改**：Project Data Access + P1 任务 8 |
| `CODING_AGENT_RUNTIME_ADVISOR_OVERVIEW.md` | 两面材料 | **已改**：三面 + 轴 C |
| 产品定位 / 接入指南 | 「运行材料和日志」统称仍易误读 | **已改**：降级规则 + 数据入口 |

---

## 11. 下一步实验（用数据关闭问题）

1. **注册 §7.4 最小查询集**接只读角色/副本，挂到仓外 `project.json`（非 fixture 透题）。  
2. **阴性对照**：仅文件面 vs 文件+数据面，同模型同题（Q123 软分原子）。  
3. **负载探针**：对同一命名查询加压，确认 timeout/行上限/会话预算生效；自由 SQL **不作**默认对照臂工具。  
4. **schema 绑定检查**：启动时核对环境表集合是否含 rewrite 域（防接错瘦副本）。  
5. **第二项目**：换 schema，只换查询注册，验证契约是否通用。

---

## 12. 一句话结论

前期调研把「只读顾问」收成代码 + 运行文件，**在分类学上就不完备**；Planora Q123 证明实例 provenance 依赖独立的 **项目只读数据面**。  
Cursor 的护栏外 `psql` 与行业实践一致指向：**不要让顾问自由写 SQL**；用命名参数化查询 + 只读角色 + 预算。  
当前代码只迈出协议/fixture 半步；**深入调研的文档与架构回写必须先于「再讨论一轮」**；实例题是否稳定变好，要靠 §11 实验，不是本文可宣称的结果。
