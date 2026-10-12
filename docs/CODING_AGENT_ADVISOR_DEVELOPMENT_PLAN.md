# Coding Agent 顾问：外部上下文生成开发计划

> 状态：修订版，2026-10-12  
> 试点：Planora「技术规格书语气改写」  
> 原则：项目方不需要向目标代码库添加顾问文件、提示词、索引或工具。

模块边界以 [`CODING_AGENT_ADVISOR_SERVICE_ARCHITECTURE.md`](./CODING_AGENT_ADVISOR_SERVICE_ARCHITECTURE.md) 为准。本计划只维护阶段、出口和扩展触发条件。

## 1. 计划边界

本计划验证的是“项目方给只读访问，顾问自己生成可用上下文”的产品路径。它不承担：

- 白盒化契约设计；
- 自动修改、提交或发布代码；
- 把生成的任务知识写回项目仓库；
- 一开始建设中心化多租户平台。

## 2. 组件状态

| 组件/模块 | 状态 |
|---|---|
| Page Connector / PinAsk | `[独立仓]` [kouhkh/pinask](https://github.com/kouhkh/pinask)；本仓只钉版本 [`deps/pinask.json`](../deps/pinask.json)，不内嵌源码 |
| Advisor Runner | `[已实现]` `runner/server.js`：本机 HTTP，接 PinAsk/`/ask`；DSH 仍走 CLI 封装 |
| Code Access | `[MVP]` 本地目录、Git 或 SSH 只读 |
| Runtime Access | `[已实现]` `runtime.mode=export-dir`；SSH/只读命令在 P1 验证 |
| Generic Tool Executor | `[MVP]` 优先复用 DSH 的目录、读文件、搜索和版本工具 |
| DSH Adapter | `[已实现]` `readonly-advisor` 调用 DSH headless |
| Context Notes | `[MVP]` 外部少量查询笔记；不做完整知识库 |
| Advisor Workspace | `[已实现]` 默认 `~/.impl-advisor/<project>/{project.json,sessions,notes}`；默认不写目标仓库 |
| Evidence Checker / Answer Composer | `[MVP]` Runner 内的确定性检查和回答组织组件 |
| Proposal / Developer Review | `[已实现]` CLI 可生成建议并记录决定；不自动改代码 |
| 结构索引 Provider | `[P1/P2]` 失败信号触发 |
| 页面适配器 / Runtime Adapter | `[P2]` 重复定位或接入需求后再做 |
| 中台目录/多租户 | `[P2]` 规模化后再评估 |

## 3. 里程碑

### P0：外部上下文的最小闭环

目标：不要求 Planora 修改仓库，就能让顾问对代码和固定运行材料进行提问。

1. `[已完成]` 修正 `readonly-advisor` 默认配置位置；配置/会话默认 `~/.impl-advisor/<project>/`，禁止写入目标仓库；
2. `[已完成]` 普通追问（answer）提示词注入会话历史；`followup` / `propose` 均带 transcript；
3. `[已完成]` 外部 Advisor Workspace：`sessions/` + `notes/`；
4. `[已完成]` `runtime.mode=export-dir` 与页面事实（`--page-context` / PinAsk batch）；
5. `[已完成]` 薄 Runner：`POST /api/pinask`、`POST /ask`；
6. `[已完成]` Planora 真实路径冒烟：workspace=`CursorProject/.../planora`，export=`planora-tone-conversion-trace-20261010`，DSH headless 已返回带路径证据的回答（约 2026-10-12）；
7. 提供通用代码工具：列目录、读文件、受限搜索、Git 版本读取（优先复用 DSH）；
8. 按需生成少量 Context Notes；多候选运行时追问澄清。

出口：项目仓库没有新增顾问文件；同一问题能给出证据或明确缺证。

### P1：Planora 测试环境与自建上下文复用

1. 接入测试机 SSH 或等价只读入口；
2. 按页面线索、时间和现象搜索运行材料；
3. 代码版本、部署版本、运行引用绑定到会话；
4. 代码版本变化时增量重建外部地图；
5. 专家确认的事实进入外部 `confirmed-facts`；
6. 比较“只有通用搜索”和“通用搜索 + Context Notes”的同题表现。

出口：至少一个实现问题和一个具体运行问题通过，且不混合不同运行。

### P2：遇到明确瓶颈再扩展

- 接入 codebase-memory-mcp、Sourcegraph 或其他结构索引；
- 生成可审阅的任务技能草稿；
- 根据问题类型触发工具和资料；
- 外部工作区的跨项目目录、检索和权限；
- 主动刷新、复杂记忆和统一 HTTP Adapter。

## 4. 触发式扩展表

| 观察到的失败 | 再考虑的扩展 | 不要误判成 |
|---|---|---|
| 搜索轮次多、找错模块 | 结构索引/代码地图增强 | 先要求项目方写导航文件 |
| 代码机制对、个案对不上 | 加深运行搜索和日志覆盖 | 再加代码索引 |
| 长期无法定位唯一运行 | 页面适配器或更厚 Runtime | 让 Agent 猜运行 ID |
| 同一事实反复纠正 | 外部确认事实 | 自动把推导写成真相 |
| 任务 dossier 越积越长 | 按版本和问题裁剪 | 建立全项目大提示词 |
| 第二项目接入重复劳动 | Runtime Adapter 或外部模板 | 先建中心化平台 |

## 5. 下一步代码任务

1. `[已完成]` 外部配置路径 + 普通追问历史；
2. `[已完成]` 页面事实 + `runtime.mode=export-dir`；
3. `[已完成]` 薄 Runner（PinAsk batch / `/ask`）；
4. `[已完成]` Planora 真实 export-dir + DSH 冒烟（配置在本机 `~/.impl-advisor/planora/`，不入库）；
5. 按需写入 Context Notes 与人工确认，不写入 Planora；
6. `[已完成/PinAsk 仓]` overlay 展示 `answer` + `session` 追问；本仓用 `deps/pinask.json` 记录兼容 commit。

P0 不做：新前端、注册中心、OpenAPI、向量库、结构索引大框架、自动 Pro 路由。

## 6. 实验指标

- 首个可核验证据的时间；
- DSH 搜索和工具调用轮次；
- 找错模块或错运行的次数；
- 缺失材料是否被明确报告；
- 专家是否能据此提出具体意见；
- 项目方为接入增加的实际步骤；
- 生成上下文中 `derived` 被专家否定的比例。
