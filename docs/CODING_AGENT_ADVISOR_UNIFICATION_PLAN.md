# 只读顾问文档统一计划（供 Cursor 确认）

> 2026-10-12；状态：核对完成，统一建议待确认。  
> 计划确认前只新增本计划；用户确认模块边界后，已先更新无后缀的概要、服务架构和详细设计主稿。Cursor 副本、产品代码和目标项目仍未修改。  
> 比较范围：概要、详细设计、服务架构、开发计划、代码库记忆落地，共 5 对文档；同时核对接入指南、产品定位、上下文生成调研和当前实现。

## 1. 核对发现

| 编号 | 已核实的事实 | 依据 |
|---|---|---|
| F1 | Cursor 的 4 份主设计页眉写着“与无后缀同文”，但两套正文已明显不同；记忆落地副本仍保留更早的阶段划分 | [概要原稿](/Users/ltc/WindowsProject/wps-addin-poc/docs/CODING_AGENT_RUNTIME_ADVISOR_OVERVIEW.md:7)、[概要副本](/Users/ltc/WindowsProject/wps-addin-poc/docs/CODING_AGENT_RUNTIME_ADVISOR_OVERVIEW.cursor.md:3)、[记忆副本](/Users/ltc/WindowsProject/wps-addin-poc/docs/CODING_AGENT_CODEBASE_MEMORY_LANDING.cursor.md:30) |
| F2 | 原稿新增了外部上下文生成；Cursor 更强调薄 Runner、项目侧默认部署和压缩 MVP | [原稿架构](/Users/ltc/WindowsProject/wps-addin-poc/docs/CODING_AGENT_ADVISOR_SERVICE_ARCHITECTURE.md:44)、[副本架构](/Users/ltc/WindowsProject/wps-addin-poc/docs/CODING_AGENT_ADVISOR_SERVICE_ARCHITECTURE.cursor.md:9) |
| F3 | 当前 PinAsk 保存 DOM、页面信息、坐标等，截图明确为 `not-captured`；有 `onSave(batch)` 接入点 | [页面信息](/Users/ltc/CursorProject/中交机电局项目/pinask/overlay/pinask.js:338)、[保存回调](/Users/ltc/CursorProject/中交机电局项目/pinask/overlay/pinask.js:456) |
| F4 | 代码实际支持的配置版本是 `readonly-advisor-project/1`，不是两套详设中的 `runtime-advisor-project/1` 或 `/2` | [配置版本](/Users/ltc/WindowsProject/wps-addin-poc/readonly-advisor/cli.js:11)、[配置校验](/Users/ltc/WindowsProject/wps-addin-poc/readonly-advisor/cli.js:114) |
| F5 | `init` 默认在目标工作区写配置；会话默认已在仓库外保存，但目前没有阻止用户把记录目录指回目标仓库 | [初始化](/Users/ltc/WindowsProject/wps-addin-poc/readonly-advisor/cli.js:234)、[会话目录](/Users/ltc/WindowsProject/wps-addin-poc/readonly-advisor/cli.js:99) |
| F6 | 普通追问读取了历史记录，但 `buildPrompt` 仅在 proposal 分支使用它，answer 分支遗漏历史 | [提示词](/Users/ltc/WindowsProject/wps-addin-poc/readonly-advisor/cli.js:146)、[追问](/Users/ltc/WindowsProject/wps-addin-poc/readonly-advisor/cli.js:265) |
| F7 | CLI 检查 `readOnly: true` 并发送只读提示词；实际调用继承环境并使用 DSH headless profile。仅凭此封装不能确认底层已强制只读，也不能确认实际模型一定是 Flash | [加载配置](/Users/ltc/WindowsProject/wps-addin-poc/readonly-advisor/cli.js:114)、[DSH 调用](/Users/ltc/WindowsProject/wps-addin-poc/readonly-advisor/cli.js:163)、[模型策略记录](/Users/ltc/WindowsProject/wps-addin-poc/readonly-advisor/cli.js:204) |
| F8 | Cursor 详设把薄 HTTP 放到 P2，但概要和开发计划把 PinAsk 接通列为 MVP；原稿的对比实验同时改变地图和运行材料，无法单独归因地图收益 | [副本详设](/Users/ltc/WindowsProject/wps-addin-poc/docs/CODING_AGENT_RUNTIME_ADVISOR_DETAILED_DESIGN.cursor.md:113)、[副本计划](/Users/ltc/WindowsProject/wps-addin-poc/docs/CODING_AGENT_ADVISOR_DEVELOPMENT_PLAN.cursor.md:36)、[原稿实验](/Users/ltc/WindowsProject/wps-addin-poc/docs/CODING_AGENT_CODEBASE_MEMORY_LANDING.md:82) |

F6 已用临时目录和 `--dry-run` 核验：历史在 transcript 中存在，普通追问提示词不包含上一问，proposal 提示词包含上一问。没有调用模型或修改项目代码。

## 2. 沿用的用户要求与共同结论

依据：本会话最近的产品要求，以及两套概要、详设的共同边界。

- 项目方提供代码和运行材料的只读访问；不维护导航、提示词、索引、技能或查询脚本。
- 顾问负责通用搜索，以及项目特定资料的生成和复用；产物保存在目标仓库之外。
- 一个顾问同时使用代码与运行证据。只有代码时可以解释实现，但不能解释某次实际运行。
- 页面上下文采集与服务侧运行访问是两条轴。页面零业务改造仍需要加载 PinAsk、绑定项目环境并配置服务侧访问。
- 不假定页面有运行 ID；多候选要列出并追问，缺材料要报告，不能混合不同运行。
- 复用 PinAsk、DSH、现有 CLI；会话和建议保留，修改建议等待研发处理。
- 当前不交付白盒化契约、自动改代码或发布能力。结构索引也不能直接提供业务标准或可改边界。

## 3. 逐项统一建议

以下为建议，不是已实现能力。请 Cursor 按 U 编号确认或给替代表述。

| 编号 / 议题 | 两版差异或缺口 | 建议统一口径 |
|---|---|---|
| U1 外部工作区 | 原稿明确外置；副本未完整说明生成资料放哪里；实现默认配置仍可能写入目标仓库 | 顾问配置、会话、生成资料和工具都放外部工作区。目标代码和运行材料只读，顾问自己的工作区可写。项目无需维护这些产物 |
| U2 自建上下文规模 | 原稿把 Context Builder、地图、任务 dossier 作为 P0；副本仅有短 taskHints/seed | P0 包含“自动生成并按需复用少量查询笔记”。复用 DSH，在同一 Runner 内完成；不先做独立编译服务、全仓 Wiki、全仓符号图或完整业务知识库。生成失败或资料过期可退回通用搜索，不阻塞首问 |
| U3 通用工具 | 原稿列出 6 个工具名，容易被理解为必须新写 6 个工具 | 优先使用 DSH 已有读文件、搜索、目录和受限命令能力；只补实际缺口。工具表描述职责，不承诺统一 Runtime schema 已成立。自建查询笔记不等于项目方预写查询脚本 |
| U4 部署默认 | 原稿把中台、项目侧、本地并列；副本默认项目侧 | MVP 默认是项目方可控环境中的独立 Runner，Planora 先在本机试验。不要求业务 App 同机，也不要求项目团队自行运维，平台可协助。保留未来中台托管能力，当前不开发注册中心或中央权限平台 |
| U5 运行接入 | 主设计基本一致，记忆副本仍说“运行证据下一阶段” | 从首轮就用代码和运行材料；导出目录、已有只读命令、SSH 都是合法入口。Planora P0 先选导出目录是实验安排；P1 接真实环境。项目没有现成查询脚本时由顾问探索可读材料。HTTP Adapter 在重复接入有收益时再固定 |
| U6 页面与连接 | 副本把截图列为稳定输入；薄 HTTP 的阶段冲突 | 截图可选，当前未捕获。P0 包含从现有 PinAsk 发送问题到顾问、看到回答并追问所需的最小连接；可复用现有服务或做薄 HTTP。CLI/JSON 可先调通，但不能冒充页面端到端验收。顾问入口与 PinAsk 自动改代码的入口分开路由 |
| U7 配置与接口 | 两版详设使用不同 schema，均不匹配现有 CLI | 以代码中的 `readonly-advisor-project/1` 和 `workspace/readOnly/recordDir/retrieval` 为兼容基线。新增环境、运行入口、外部工作区字段时标成“计划”；有破坏性变更再升级 schema。保留旧配置迁移方案，不直接发布不能执行的 JSON 示例 |
| U8 证据与复核 | 原稿“Evidence Gate”容易被理解为自动保证正确；两版 Flash 表述都比封装能力更强 | P0 用确定性检查确认引用可达、版本字段和运行候选是否冲突；业务解释质量由试点评审人判断。Flash 是默认配置目标；实际模型需记录或标未知。Pro 先人工触发。缺权限、缺日志和版本不明不能靠升级模型解决 |
| U9 版本与事实状态 | 原稿把 observed/derived/confirmed/stale 并列；生成业务标准、增量更新的工作量容易扩大 | 内容性质和时效分开记录。专家确认不代表永不过期，也不证明某次运行事实；业务期望与实现事实分开。P0 记来源、时间、可读到的版本；变化后回源核对或重建受影响笔记，不做增量图谱。代码 HEAD 不能冒充部署版本；读不到就记未知 |
| U10 分期和实验 | 原稿把较多增强列为 P1 必做；副本 P1 聚焦真实运行 | P0 做双只读、页面连接、连续会话和最小外部笔记；P1 做 Planora 真实运行及同题对比。结构索引、自动技能、复杂记忆、主动刷新、中心名录均按失败信号触发，不因阶段编号自动开工 |
| U11 文档权威关系 | 副本声称“权威且同文”，实际已经分叉 | 确认并合并后，无后缀文件作为正式引用版本；`.cursor.md` 是 Cursor 工作副本，注明基于哪个主稿版本及未合入差异。保留工作副本，不维持“两份都声称权威”的状态，不整文件相互覆盖 |

### 3.1 MVP 结构与外部笔记

建议的 MVP 结构：

```text
现有 PinAsk → 薄连接 → 顾问 Runner + DSH
                         ├─ 通用工具 → 目标代码、运行材料（只读）
                         └─ 外部工作区（顾问可写）
                              配置、会话、证据、少量生成笔记
```

“Context Builder”先作为 Runner 的一项职责。对外文档称“顾问生成的查询笔记”，不再反复引入 dossier、编译器等新名词。

建议最小产物示意：

```text
<advisor-data>/<project>/<environment>/
  project.json
  notes/
    map.md               # 已发现的目录和入口；不承诺覆盖全仓
    rewrite-task.md      # 相关实现、已有质量标准来源、推测和未知
    runtime-reading.md   # 已验证的读取方法、失败方法和适用条件
  sessions/<id>/...
```

这三种笔记可以按问题逐渐形成，也可以先合并为一个文件；不规定项目方的目录结构。首轮笔记保存可核对的来源；重复提问时才验证复用收益。后续脚本或技能也只在外部工作区生成，并在受限环境中验证，不能获得写目标项目的权限。

### 3.2 收紧双方的过度承诺

- 原稿的目录树、6 个工具名、4 个状态和多个模块不等于必须新增服务、数据库或复杂状态机。P0 先文件存储和最小元数据。
- 源码能说明当前实现；无法据此自动宣布“业务上应该如此”。已有质量标准可以引用，缺失的标准允许未知，不要求专家逐项审批机器笔记。
- 项目侧部署不等于模型推理一定不出域。DSH 所用模型服务的数据路径需按真实配置说明，不能只靠 Runner 所在位置推断。
- 导出目录能验证固定运行问题，不能证明已经完成线上接入。一个实现题加一个运行题属于冒烟检查，不能宣称产品已验证可用。
- 后续对比固定模型、代码版本、运行材料、问题和工具权限，只改变“是否使用生成笔记”。冷启动与复用分别记录，并计入笔记生成/更新成本。

## 4. 确认后如何合并文档

| 文件（均在 `docs/`） | 主要修改 | 该文档负责什么 |
|---|---|---|
| `CODING_AGENT_RUNTIME_ADVISOR_OVERVIEW.md` | U1–U6、U8–U10；修正实现状态 | 面向合作方说明用途、投入、边界；只放一张简图 |
| `CODING_AGENT_ADVISOR_SERVICE_ARCHITECTURE.md` | U1–U6、U9；外部存储与读写边界 | 模块关系、部署和数据流；避免重抄详设 |
| `CODING_AGENT_RUNTIME_ADVISOR_DETAILED_DESIGN.md` | U2、U3、U6–U9；兼容配置、薄连接、证据记录 | 字段、内部接口、执行约束；区分现状与计划 |
| `CODING_AGENT_ADVISOR_DEVELOPMENT_PLAN.md` | U2、U5、U6、U10；加入已查明的实现缺口 | P0/P1 出口、后续触发条件；分期的唯一维护位置 |
| `CODING_AGENT_CODEBASE_MEMORY_LANDING.md` | U2、U3、U5、U9、U10；合并现成方案研究 | 检索增强与笔记的实验建议；删掉运行证据“下一阶段”的旧前提 |
| `CODING_AGENT_READONLY_ADVISOR_INTEGRATION_GUIDE.md` | U1、U5–U9；同步实际可运行命令 | 已实现接入步骤；计划中的能力单列 |
| `CODING_AGENT_READONLY_ADVISOR_PRODUCT_POSITIONING.md` | U1、U4、U5；保持投入与收益口径一致 | 合作投入与交付形态，不另写一套架构 |
| `CODING_AGENT_ADVISOR_CONTEXT_COMPILATION_RESEARCH.md` | U2、U3、U9、U10；研究结论与必做项分开 | 保留调研依据，不再独立规定分期 |

`readonly-advisor/README.md` 在相应代码落地时同步，不提前把计划字段写成已支持。

合并顺序：

1. Cursor 先评审本计划，按 U 编号给出同意、不同意及替代方案，先不改文件或代码。
2. 收敛分歧后，Codex 按小节修改无后缀主稿；Cursor 仅维护自己的副本。出现新增冲突先保留差异，不用整文件覆盖。
3. 主稿合并完成后，统一页眉、互相链接、分期引用；Cursor 副本注明同步基线。历史研究和实验记录保留当时日期与结论。
4. 开发以合并后的计划为依据，不让旧副本继续单独发出矛盾的开发任务。

## 5. 开发顺序与验收建议

这里只列合并后建议写入计划的内容，本轮不开发。

### P0：本地页面闭环与外部笔记

1. 修正初始化默认写入目标仓库；区分目标只读目录与顾问可写目录，并检查配置、会话和 DSH 缓存的实际落点。
2. 修复普通追问未传历史的问题；保留现有 propose/review 的建议和决定记录。
3. 接受页面事实和固定运行材料；复用现有 PinAsk 做最小提交、结果和追问连接。
4. 用 DSH 通用工具完成查证，按需生成和复用最小笔记；没有人工导航仍能继续工作。
5. 记录代码与运行版本的已知/未知、证据来源、候选和缺失材料；使用有效只读权限验证访问边界。

最低验收场景：

- 首次接入无项目专用导航，能回答一个 Planora 实现问题；
- 使用固定运行材料回答一个具体运行问题；
- 有两个可能运行时列候选，材料不足时明确缺失；
- 连续追问真正带入上一轮信息，建议可交研发确认；
- 再次提问可读取外部笔记，版本变化时不把旧笔记当作新事实；
- 目标代码库和运行数据未被写入；只读限制由执行环境生效，顾问资料只进入外部目录。

### P1：真实环境和收益验证

接入 Planora 测试环境只读 SSH 或等价方式。用相同代码、材料和问题对比通用搜索与生成笔记，记录回答可核验性、定位错误、工具轮次、总耗时及项目接入步骤。运行材料无法唯一定位时再决定增加哪种线索，不能预先要求项目改接口。

### 后续：按失败信号选择

| 反复出现的问题 | 再尝试什么 |
|---|---|
| 找代码慢、跨文件漏读 | 现成结构索引、地图裁剪 |
| 代码解释正确但无法对应本次运行 | 扩充可读运行材料；必要时页面线索适配 |
| 同类查询反复人工处理 | 顾问侧只读脚本或 RuntimeReader |
| 同一业务背景反复被纠正 | 带来源和时效的确认记录 |
| 多个项目重复接入成本高 | 打包、统一 Adapter、可选名录；根据证据决定是否中心化 |

## 6. 发给 Cursor 的确认要求

请基于本地实际文件评审本计划，先不要修改两套设计稿或代码。

请返回：

1. U1–U11 的确认结果；不同意时给可直接入文档的替代表述及理由。
2. 指出本计划是否遗漏你已实现的内容，并附文件/符号或验证结果；不要仅凭设计稿标为“已有”。
3. 重点确认 U2 的轻量上下文范围、U4 的部署默认、U6 的页面端到端要求、U7 的配置兼容和 U11 的主稿维护方式。
4. 若不同意某项进入 P0，请说明去掉后如何满足对应的用户要求；若建议新增 P0 工作，请说明它解决哪个已观察到的阻塞。

用户已经明确的“项目不维护导航、目标仓库不放顾问文件、双只读、通用兜底与顾问自建部分”直接作为边界。需要评审的是最小实现与文档统一方式。
