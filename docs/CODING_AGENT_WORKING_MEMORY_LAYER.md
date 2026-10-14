# 顾问工作记忆与证据网关（harness-neutral）

> 状态：实现说明，2026-10-14  
> 落点：worktree `impl-advisor-wm` / 分支 `feat/working-memory-layer`  
> 原则：**先定义顾问工作记忆，再比较 harness**。

## 1. 四层拆分

| 层 | 职责 | 本仓落点 |
|---|---|---|
| 权限控制 | agent 能碰哪些目录/命令/运行环境 | 独立用户 / ACL：`docs/LOCAL_DEDICATED_USER_BOUNDARY.md`；SSH jail 已有 |
| 证据网关 | 固定少数只读操作 → 结构化证据卡 | `evidence-gateway.js` |
| 工作记忆 | 本轮允许进 prompt 的摘要与停搜规则 | `working-memory.js` |
| harness | 通用 agent 循环、工具调用、模型请求 | `runners.js`：`dsh`（默认）/ `opencode`（对照） |

开源 harness 不知道「代码事实 vs 运行事实」「候选不可混用」「何时必须未知」。这些属于顾问领域策略，不重写通用 harness。

## 2. 工作记忆对象

```text
当前问题
当前结论摘要
证据卡片[]
运行候选状态
未决问题[]
下一步允许的操作
停搜原因
```

状态：`observed` →（确认）`confirmed`；环境变化 → `stale`；模型推断 → `derived`。

落盘：`sessions/<id>/working-memory.json`。  
完整 `transcript.md` / 工具轨迹：**只落盘，默认不回灌**。

## 3. 证据网关操作

- `code.search` / `code.read`
- `run.list` / `run.summary` / `run.log_slice`（multiple 未确认禁止 slice）
- `run.record_list` / `run.record_get`（结构化运行，可选）
- `version.bind`

CLI：`node readonly-advisor/cli.js evidence --config <cfg> --op code.search --query ...`

## 4. 与 ask / followup 的关系

1. 预检拿到 versions + runtimeSearch（权限层 / SSH）。  
2. **首问**：收成证据卡 → 格式化为工作记忆摘要 → 注入 prompt（不再重复灌完整版本表/候选原文）。  
3. runner（默认 DSH）作答。  
4. 会话落盘后 `updateWorkingMemory`。  
5. **追问**：只注入 `buildWorkingMemoryBrief`，不带整份 transcript。

关闭：`workingMemory.enabled=false`（或 `memory.workingMemory=false`）回退旧行为。

## 5. 长期记忆（外置，非每轮全量）

顾问工作区（不写目标仓）：

- `project-memory` / `task-memory` / `run-memory` / `confirmed-facts`

CLI：

```bash
node readonly-advisor/cli.js memory --config <cfg> --kind project
node readonly-advisor/cli.js memory --config <cfg> --kind task --question "..."
node readonly-advisor/cli.js memory --config <cfg> --kind run --from-session <sessionDir>
```

`ask` 落盘会话时会尝试写入 `run-memory/<runKey>/`（版本绑定 + 运行候选指针）。  
`loadMemoryForPrompt` 仅在问题像运行/部署相关时注入 **最多 1 条** run-memory，且标题带 `run-memory:`，**不得与项目地图混写**。

## 6. 对照 harness 的前置条件

同一套：`working-memory` + 证据网关 + 同一题 + 同一模型，只换 runner。  
否则比的是「谁更容易被脏上下文拖垮」，不是 harness 能力。

```bash
# 默认 DSH
node readonly-advisor/cli.js ask --config <cfg> --question "..."

# 同一配置改 runner，或临时覆盖
node readonly-advisor/cli.js ask --config <cfg> --runner opencode --question "..."
```

`project.json` 字段：`runner`（`dsh`|`opencode`）、`opencodeBin` / `OPENCODE_BIN`、`opencodeArgs`（默认 `["run"]`）。

## 7. 明确不做

- 自研完整向量库 / 图谱 / 多代理框架  
- 在 harness 内重做业务停搜规则  
- 用提示词代替权限边界（权限另做）
