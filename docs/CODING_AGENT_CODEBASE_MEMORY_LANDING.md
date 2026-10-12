# 代码库顾问：外部检索与上下文生成落地

> 状态：调研落地修订版，2026-10-12  
> 范围：代码只读、自动生成代码地图和外部顾问上下文；不要求修改目标代码库。

本文件只讨论代码检索和上下文生成。专家若要解释某一次具体运行，还必须接入服务器或运行材料的只读入口，见 [`CODING_AGENT_RUNTIME_ADVISOR_OVERVIEW.md`](./CODING_AGENT_RUNTIME_ADVISOR_OVERVIEW.md)。

## 1. 目标重新定义

我们不是让项目方维护一个“代码库记忆文件”，也不是先建设白盒化契约。目标是：

```text
只读代码
  → 顾问侧通用搜索和结构分析
  → 外部代码地图 / 任务 dossier
  → DSH 只读顾问
  → 会话、证据和人工确认
```

项目方已有的 `AGENTS.md`、任务文档、索引或查询命令可以被读取，但没有也不阻塞 P0。

## 2. 代码库记忆的三种材料

| 材料 | 来源 | 可信边界 |
|---|---|---|
| 代码观察 | 源文件、配置、Git、目录 | `observed`，须绑定 revision |
| 结构地图 | 工具从文件、符号、引用生成 | `derived`，回源核对后使用 |
| 项目确认事实 | 专家或研发明确确认 | `confirmed`，保留会话来源 |

运行证据和业务质量标准不由代码索引自动推出。

## 3. 通用兜底

Planora 先使用 DSH 自带的文件搜索、读文件和目录工具。顾问侧再提供：

- 目录范围限制；
- Git commit、分支和工作区状态；
- 受限文本搜索；
- 只读运行材料搜索和产物读取；
- 证据路径、符号名和版本记录。

这套能力不要求项目方安装索引或添加工具文件。

## 4. 现成方案比较

| 方案 | 主要能力 | 是否写目标仓库 | 项目方成本 | 建议 |
|---|---|---:|---|---|
| DSH 文件搜索 + LSP | 现场搜索、读文件、可选符号导航 | 否 | 低 | **P0 基线** |
| Aider repo map | 动态生成按相关性裁剪的文件/符号地图 | 否 | 低到中 | 借鉴算法，先不替换 DSH |
| codebase-memory-mcp | 本地代码图和结构查询 MCP | 可能安装到 Agent 配置，不应直接作为项目门槛 | 中 | P1/P2 小实验 |
| Sourcegraph MCP | 多仓搜索、导航和引用 | 否 | 依赖项目已有部署 | 有则接入，不自建 |
| DeepWiki-Open | 自动生成代码 Wiki、图和 codemap | 否 | 需要单独部署/模型配置 | 参考产物形态，不作为 P0 依赖 |
| 自建向量库 / 白盒化契约 | 自定义记忆或边界协议 | 通常需要项目改造 | 高 | 当前不做 |

Aider 文档明确说明 repo map 是从整个 Git 仓库动态生成、按相关性和 token 预算裁剪的导航材料，而不是项目方手写的完整说明。[Repository map](https://aider.chat/docs/repomap.html)

codebase-memory-mcp 和 DeepWiki-Open 可作为实验对象；它们的性能或质量描述属于项目自身声明，不能直接当作本项目结论。[codebase-memory-mcp](https://github.com/DeusData/codebase-memory-mcp)、[DeepWiki-Open](https://github.com/AsyncFuncAI/deepwiki-open)

## 5. 外部生成物

```text
Advisor Workspace/projects/<project>/
  observations/<revision>.jsonl
  code-map/<revision>.json
  task-dossiers/<task>/<revision>.json
  confirmed-facts.jsonl
  sessions/<session-id>/
```

不把这些文件写回目标代码库，不把它们伪装成项目官方文档。

## 6. 生成流程

1. 读取代码和可达运行材料；
2. 生成基础观察和代码地图；
3. 根据专家问题生成任务 dossier；
4. 选择当前问题需要的文件和工具；
5. 回源核对证据；
6. 保存会话和专家反馈；
7. 只有人工确认后才更新 `confirmed-facts`。

## 7. Planora 实验

用同一批问题比较：

1. 仅 DSH 原生搜索；
2. DSH + 外部生成的基础代码地图；
3. DSH + 代码地图 + 运行材料查询。

记录搜索轮次、首证时间、错连次数、缺证报告和专家是否能提出具体意见。若代码地图没有明显收益，就保留通用搜索，不把索引做成平台硬依赖。

