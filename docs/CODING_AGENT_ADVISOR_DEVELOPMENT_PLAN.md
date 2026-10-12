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
| Page Connector / PinAsk | `[已实现]`，`/Users/ltc/CursorProject/中交机电局项目/pinask`；页面端到端连接计划中 |
| Advisor Runner | `[MVP]` 计划实现；连接入口、读取器、DSH 和工作区 |
| Code Access | `[MVP]` 本地目录、Git 或 SSH 只读 |
| Runtime Access | `[MVP]` Planora 固定导出目录；SSH/只读命令在 P1 验证 |
| Generic Tool Executor | `[MVP]` 优先复用 DSH 的目录、读文件、搜索和版本工具 |
| DSH Adapter | `[已实现]` `readonly-advisor` 调用 DSH headless |
| Context Notes | `[MVP]` 外部少量查询笔记；不做完整知识库 |
| Advisor Workspace | `[MVP]` 外部会话、证据和笔记；默认不写目标仓库 |
| Evidence Checker / Answer Composer | `[MVP]` Runner 内的确定性检查和回答组织组件 |
| Proposal / Developer Review | `[已实现]` CLI 可生成建议并记录决定；不自动改代码 |
| 结构索引 Provider | `[P1/P2]` 失败信号触发 |
| 页面适配器 / Runtime Adapter | `[P2]` 重复定位或接入需求后再做 |
| 中台目录/多租户 | `[P2]` 规模化后再评估 |

## 3. 里程碑

### P0：外部上下文的最小闭环

目标：不要求 Planora 修改仓库，就能让顾问对代码和固定运行材料进行提问。

1. 修正 `readonly-advisor` 默认配置位置，确保配置和会话不落入目标仓库；
2. 在仓库外建立 Advisor Workspace；
3. 编写薄 Runner，接收 PinAsk 页面事实并调用现有 CLI/DSH；
4. 使用 Planora 实际运行材料验证固定导出目录读取；
5. 提供通用代码工具：列目录、读文件、受限搜索、Git 版本读取；
6. 按需生成少量 Context Notes，不要求首问前准备完整地图；
7. 保存证据、会话、版本和缺失材料；
8. 追问沿用同一会话上下文，并能处理多候选运行。

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

1. 修正 `readonly-advisor` 的外部配置路径和普通追问历史传递；
2. 增加页面事实和 `runtime.mode=export-dir` 的配置支持；
3. 编写薄 Runner：接收 PinAsk batch，调用 CLI/DSH，回传回答和证据；
4. 使用 Planora 实际运行材料完成端到端冒烟；
5. 记录 Context Notes 和人工确认，不写入 Planora。

P0 不做：新前端、注册中心、OpenAPI、向量库、结构索引大框架、自动 Pro 路由。

## 6. 实验指标

- 首个可核验证据的时间；
- DSH 搜索和工具调用轮次；
- 找错模块或错运行的次数；
- 缺失材料是否被明确报告；
- 专家是否能据此提出具体意见；
- 项目方为接入增加的实际步骤；
- 生成上下文中 `derived` 被专家否定的比例。
