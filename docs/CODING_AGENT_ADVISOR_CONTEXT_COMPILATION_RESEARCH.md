# Coding Agent 顾问上下文生成调研

> 状态：调研落地稿，2026-10-12  
> 范围：研究大型开源项目和现成代码理解工具，判断顾问是否应要求项目方维护导航文件、技能或索引。  
> 结论：项目方不应被要求把顾问资料写进目标代码库；顾问应在代码库外生成、更新和使用项目上下文。

## 1. 先给结论

我们需要的不是“让项目方维护一套 Agent 提示词”，而是一个**上下文编译器（Context Builder）**：

```text
只读代码 + 只读运行材料 + 页面事实
        ↓
顾问侧生成项目观察、任务线索、代码地图和运行查询计划
        ↓
外部顾问工作区（按项目 / 环境 / 版本 / 运行保存）
        ↓
DSH 顾问按问题选择相关材料和工具
```

这里的“编译”不是把猜测写成事实，而是把原始材料整理成可检索的候选上下文。每个产物必须标明来源版本、生成时间和状态：

| 状态 | 含义 |
|---|---|
| `observed` | 从代码、配置、运行材料或页面事实直接观察到 |
| `derived` | Agent 根据已观察材料推导的候选解释 |
| `confirmed` | 专家或研发明确确认过 |
| `stale` | 来源版本或运行环境已经变化，需要重新生成 |

只有 `observed` 和 `confirmed` 可以作为直接证据；`derived` 只能作为待核对线索。

## 2. 研究对象给出的不同启示

### 2.1 Firefox：作用域、工具和触发器

Firefox 的根目录规则只保留全局约束，组件目录再提供局部地图；它还提供专门的 `searchfox-cli`，并用规则文件根据 diff 选择技能。[根目录 AGENTS.md](https://github.com/mozilla-firefox/firefox/blob/main/AGENTS.md)、[组件技能说明](https://github.com/mozilla-firefox/firefox/blob/main/.agents/skills/README.md)、[review-context.toml](https://github.com/mozilla-firefox/firefox/blob/main/review-context.toml)

可吸收：

- 全局安全约束和任务局部资料分开；
- 用工具替代“请认真搜索”的长提示；
- 用触发条件选择上下文，而不是每次加载全部资料；
- 引用名字和版本，不依赖“上面那个函数”或漂移行号。

不能直接照搬：Firefox 的 `AGENTS.md` 是维护者写的项目内文件，而我们的产品不能要求客户把文件加入仓库。因此我们应在外部工作区生成同样的结构。

### 2.2 VS Code：少量架构地图和验证入口

VS Code 的 Copilot 指南提供根目录地图、核心层次、扩展点和针对性验证命令。[copilot-instructions.md](https://github.com/microsoft/vscode/blob/main/.github/copilot-instructions.md)

可吸收：

- 顾问首先需要目录和模块地图；
- 地图应同时指出“如何找到相关代码”和“如何验证”；
- 验证命令要按变更范围选择，不能每次运行全套工程。

这更像顾问的**生成结果模板**，不是项目方必须维护的接口。

### 2.3 Kubernetes：全局不变量要短、明确、可执行

Kubernetes 的 `AGENTS.md` 很短，集中放生成文件不可手改、依赖更新、测试命令和提交要求。[AGENTS.md](https://github.com/kubernetes/kubernetes/blob/master/AGENTS.md)

可吸收：

- 全局规则只放少量真正普适的不变量；
- 约束要能转换成检查动作；
- 不能把背景知识、架构说明和安全门禁混在同一份长文件里。

对我们的对应物是顾问运行时的只读门禁、证据要求和版本绑定，而不是客户仓库里的新文件。

### 2.4 Rust：把政策、路由和实现知识分开

Rust 的 Agent 指南包含明确的停止条件、审核要求，并把更详细的流程路由到开发指南；它还明确说明 Agent 文件不能成为人类流程的唯一来源。[AGENTS.md](https://github.com/rust-lang/rust/blob/main/AGENTS.md)

可吸收：

- “必须阻止的动作”与“帮助理解代码的资料”分开；
- 事实来源和 Agent 的操作约束分开；
- 发现未知复杂性时应回到正式来源，而不是在 Agent 记忆里自行定规矩。

这支持我们的分层：顾问侧可以生成 `derived` 观察，但业务质量标准和责任归属不能由 Agent 自行宣布为 `confirmed`。

### 2.5 Aider：动态生成代码地图

Aider 不要求用户手写全仓说明，而是从 Git 仓库生成包含文件、符号和调用关系的 repo map，再按相关性和 token 预算裁剪给模型。[Repository map](https://aider.chat/docs/repomap.html)

这是对我们最直接的启示：

- 代码地图可以由工具自动生成；
- 地图应按问题动态裁剪；
- 地图负责导航，不负责业务真相；
- 生成结果可以留在顾问工作区，不写入目标仓库。

### 2.6 DeepWiki 和 codebase-memory-mcp：外部生成层的现成方向

DeepWiki-Open 展示了“读取仓库 → 生成结构分析、文档、图和 codemap”的产品形态。[README](https://github.com/AsyncFuncAI/deepwiki-open)

codebase-memory-mcp 则把代码索引、符号关系、调用链和 MCP 查询作为仓库外的本地工具，并提供本地图谱和查询接口。[README](https://github.com/DeusData/codebase-memory-mcp)

这两者可以作为候选依赖或实验对象，但不能直接接受其自报的质量和性能数字。我们仍需在 Planora 上验证：是否减少盲搜、是否降低错连、项目方是否需要额外部署。

## 3. 对产品架构的调整

### 3.1 产品不再要求项目方维护这些文件

下面这些东西均不应成为项目接入前提：

- `docs/advisor/map.md`；
- 任务专项提示词；
- 项目专用索引；
- Agent skill 文件；
- Runtime 查询脚本；
- 统一白盒化契约。

项目方已有的文档、命令或索引可以作为输入，但没有也不阻塞首轮接入。

### 3.2 顾问侧生成的外部产物

```text
Advisor Workspace/
  projects/<project>/
    observations/<revision>.jsonl
    code-map/<revision>.json
    task-dossiers/<task>/<revision>.json
    runtime-plans/<environment>/<revision>.json
    confirmed-facts.jsonl
    sessions/<session-id>/
```

这些路径只是产品内部实现示意，不要求项目方创建同名目录，也不应被写入目标仓库。

### 3.3 生成流程

```text
注册只读访问
  → 读取代码结构、配置和可达运行材料
  → 生成基础观察和候选地图
  → 根据专家问题生成任务 dossier
  → 只加载本问题相关的材料和工具
  → 用源文件、运行产物和版本核对
  → 保存会话、证据和专家反馈
  → 反馈确认后更新外部 confirmed-facts
```

顾问可以自建“如何查”的候选计划，但不能拥有不受权限约束的任意执行能力。运行查询仍由只读账号、导出目录、固定命令或 Runtime Adapter 限制。

## 4. MVP 与后续能力

### P0：顾问不依赖项目改造也能工作

- 代码只读：目录、Git 或 SSH；
- 运行只读：固定导出目录、已有只读命令或 SSH；
- 通用代码工具：目录列举、受限文本搜索、Git 版本读取；
- 外部顾问工作区：会话、原始观察、证据和版本信息；
- 自动生成最小代码地图：目录、入口文件、包/路由/配置线索；
- 根据一次问题临时生成任务 dossier，不要求人工先写；
- 事实、推导、缺失材料分层；多候选运行必须追问。

P0 不做完整语义索引，也不要求自动生成可靠的业务质量标准。

### P1：重复使用后再沉淀

- 按代码版本增量更新代码地图；
- 生成并复用任务级检索计划；
- 对运行查询形成可复用的只读 RuntimeReader；
- 让专家确认后的事实进入外部记忆；
- 根据问题类型触发不同的工具组合；
- 对比“通用搜索”和“生成地图”在 Planora 上的效果。

### P2：遇到明确瓶颈再增加

- codebase-memory-mcp、Sourcegraph 或其他结构索引；
- 自动生成可审阅的技能草稿；
- 跨项目模板和注册目录；
- 复杂记忆、向量检索、多租户和主动刷新；
- 自动从 diff 或页面变化触发上下文重建。

## 5. 必须验证的边界

1. 顾问自己生成的代码地图能否减少 Planora 的首次搜索轮次；
2. 生成的任务 dossier 是否会把“代码行为”误写成“业务质量标准”；
3. 运行查询计划能否在没有 `run_id` 时找到正确候选；
4. 外部工作区是否能按 commit、环境和运行隔离，避免版本混用；
5. 项目方只提供代码和运行只读权限时，接入成本是否真的低于让项目方维护一套 Agent 文件。

在这些问题得到实验结果前，不应把“自动生成 skill / 自动生成业务知识”写成已具备能力。

