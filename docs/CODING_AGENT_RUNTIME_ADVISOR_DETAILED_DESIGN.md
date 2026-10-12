# 代码库与运行顾问：详细设计

> 状态：模块边界修订版，2026-10-12  
> 首个试点：Planora「技术规格书语气改写」  
> 只读顾问；不做自动改代码和发布。

## 1. 设计对象和边界

本产品由一个顾问运行时和若干可替换的访问组件组成。它读取项目代码和运行材料，回答专家问题，并保存会话与证据。

```text
Page Connector → Advisor Runner → Evidence Access + DSH Adapter
                                      ↓
                              Advisor Workspace
```

目标代码库和业务运行环境是被读取的外部对象。顾问不要求项目方添加导航文件、技能、索引、查询脚本或白盒化契约。

## 2. 组件树

```text
Advisor Product
├── Interaction Module
│   └── Page Connector
├── Advisor Runtime Module
│   ├── Request Receiver
│   ├── Project Binding
│   ├── Session Controller
│   ├── Access Planner
│   ├── Evidence Checker
│   ├── Answer Composer
│   └── Response Writer
├── Evidence Access Module
│   ├── Code Access
│   └── Runtime Access
├── Tool Execution Module
│   ├── file/tree/search
│   ├── Git facts
│   └── restricted read-only commands
├── Reasoning Module
│   ├── DSH Adapter
│   └── Context Notes
├── Workspace Module
│   ├── Session Store
│   ├── Evidence Store
│   └── Query Notes Store
└── Optional Review Workflow
    ├── Proposal Generator
    └── Developer Review Record
```

只读权限、命令白名单、版本/环境绑定和凭据管理属于横切控制，不与上述模块并列为业务模块。

## 3. Runner 的职责和不负责的内容

### 3.1 Runner 负责

1. 接收 PinAsk/JSON 请求；
2. 根据实例配置绑定项目和环境；
3. 管理一次会话和连续追问；
4. 调用代码读取器和运行读取器；
5. 调用 DSH Adapter；
6. 检查证据是否可达、版本是否明确、运行候选是否冲突；
7. 组织回答并写入外部工作区。

### 3.2 Runner 不负责

- 解析页面元素对应的源码位置；这是 DSH 通过读取工具完成的；
- 修改项目代码、提交或发布；
- 要求项目方实现统一 Runtime API；
- 把推导内容直接写成业务事实；
- 代替专家判断质量。

## 4. 接口与数据

### 4.1 页面请求

```json
{
  "project": "planora",
  "environment": "test",
  "question": "这次改写为什么走这条路由？",
  "page_context": {
    "page_url": "https://planora.test/rewrite/123",
    "captured_at": "2026-10-12T11:00:00+08:00",
    "ui_target": {
      "selector": "…",
      "visible_text": "…",
      "ancestor_summary": "…",
      "screenshot_ref": null
    }
  }
}
```

PinAsk 当前不能稳定提供截图、`run_id` 或部署版本。页面有这些线索时可以附带，没有时不能由页面入口伪造。

### 4.2 外部项目配置

现有 CLI 的兼容基线是 `readonly-advisor-project/1`（`readonly-advisor/cli.js:10-12,114-125`）。当前支持的主要字段是：

```json
{
  "schemaVersion": "readonly-advisor-project/1",
  "project": "planora",
  "task": "技术规格书语气改写",
  "workspace": "/path/to/planora",
  "readOnly": true,
  "recordDir": "/path/to/advisor-data/planora/sessions",
  "taskContextPaths": [],
  "retrieval": null
}
```

外部运行入口、环境、版本命令和 Advisor Workspace 的专门字段是计划扩展，不能在文档中写成当前 CLI 已支持的配置。

### 4.3 运行访问接口

这是内部抽象，不要求项目方现在开发同名 API：

```text
searchRuns({ timeRange, keywords, pageHints }) -> RunCandidate[]
getRun(id) -> RunDetail
getArtifact(ref) -> bytes|path
readLogs({ runId, timeRange, keywords }) -> LogExcerpt[]
```

第一项目可由导出目录浏览、已有只读命令或 SSH 只读搜索实现。`getRun(id)` 只有已经找到唯一 ID 时才是优化；没有 ID 时必须支持搜索或目录浏览。

## 5. 一次提问的控制流

```text
Page Connector
  → Request Receiver
  → Project Binding
  → Session Controller
  → Access Planner
  → Code Access / Runtime Access / Generic Tools
  → DSH Adapter
  → Evidence Checker
  → Answer Composer
  → Response Writer + Workspace Store
```

### 5.1 Evidence Checker 的范围

它只做确定性检查：

- 引用的文件或产物是否实际可读；
- 代码版本、环境和运行引用是否记录；
- 多个运行候选是否被错误合并；
- 回答是否标记缺失材料和推导内容。

它不判断业务答案是否正确，也不保证 DSH 已经找到了所有相关代码。

### 5.2 Answer Composer 的范围

它把 DSH 结果整理成固定回答结构：

1. 结论；
2. 代码事实；
3. 运行事实；
4. 推导或不确定部分；
5. 缺失材料和专家下一步可以确认的问题。

它是 Runner 的输出组件，不是另一个 Agent。

## 6. 外部工作区

```text
<advisor-data>/<project>/<environment>/
  project.json
  notes/
    map.md
    task.md
    runtime-reading.md
  sessions/<session-id>/
  confirmed-facts.jsonl
```

P0 只生成少量查询笔记，不做完整代码知识库。笔记可以先合并为一个文件；目录名称不构成项目方契约。

记录内容分为：

| 内容 | 含义 |
|---|---|
| `observed` | 代码、页面或运行材料直接看到 |
| `derived` | Agent 根据证据推导的待核对内容 |
| `confirmed` | 专家或研发明确确认 |
| `stale` | 来源版本或环境已变化 |

## 7. 部署和管理边界

### 7.1 推荐部署

Planora P0：Runner、Advisor Workspace 和 DSH 在 Mac 本地；代码和运行导出目录以只读方式挂载或访问。PinAsk 在浏览器中运行，通过本地接口提交问题。

### 7.2 项目方负责

- 代码只读入口；
- 测试/线上运行材料只读入口；
- 网络白名单、账号、SSH 或导出目录权限；
- 项目和环境名称；
- 已有查询命令或导出方式（有则提供）。

### 7.3 平台负责

- PinAsk 接入；
- Runner 和通用工具；
- DSH Adapter 和模型策略；
- Evidence Checker 和回答格式；
- 外部工作区、会话和查询笔记；
- 只读权限的执行控制；
- 追问、提案和研发决定记录。

### 7.4 为什么不默认和业务服务同机

Runner 只需要能访问代码和运行材料。与业务服务同机不会自动解决版本关联，反而会扩大权限、部署和故障影响面。只有项目网络限制导致独立 Runner 无法访问必要材料时，才考虑把最小 Runner 放到项目网络内；仍不要求改业务 App。

## 8. 分期

| 阶段 | 内容 |
|---|---|
| P0 | `[部分完成]` CLI 外部配置 + 追问历史已修；余下：PinAsk 页面端到端；本地 Runner；Planora 代码/运行只读；外部会话和最小查询笔记 |
| P1 | Planora 测试环境 SSH/只读命令；可复用 RuntimeReader；确认事实；同题对比实验 |
| P2 | 结构索引、技能草稿、页面适配器、Runtime Adapter、项目名录、跨项目记忆 |

不把结构索引、HTTP Adapter、注册中心或自动改代码列为 P0。
