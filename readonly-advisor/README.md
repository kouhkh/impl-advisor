# Readonly Advisor

这是一个很薄的 DSH 封装，用于把 coding agent 只读顾问变成可交付的项目工具：

- 项目方只需提供工作区、只读权限和任务名；
- 专家问题、回答、工作区提交和对话过程自动保存；
- 可以继续追问；
- 可以生成一份不改代码、等待研发确认的修改建议。

## 最小接入

```bash
node readonly-advisor/cli.js init \
  --project planora \
  --task "技术规格书语气改写" \
  --workspace /path/to/planora \
  --output /path/to/planora.advisor.json
```

配置文件中保持 `readOnly: true`。默认使用 `DSH_HOME` 或 `~/.dsh`，也可以通过 `--dsh-home` 指定。凭据由运行环境提供，不写入项目配置。

如果专家需要询问业务任务细节，可以在配置中增加少量任务资料路径：

```json
{
  "taskContextPaths": [
    "docs/technical-spec-rewrite-prd.md",
    "config/technical-spec-rewrite/quality-cases.json"
  ]
}
```

顾问会优先读取这些资料，再结合代码、配置和运行材料回答。没有这些文件时，不会假装掌握业务口径。

如果项目方已有本地代码索引或 Sourcegraph，可增加可选检索命令，而不是自建白盒化契约：

```json
{
  "retrieval": {
    "provider": "existing-readonly-index",
    "commands": {
      "search": "<按项目方已有索引工具填写>",
      "update": "<按项目方已有索引工具填写>"
    },
    "notes": "先定位 file:line，再读源文件核对。"
  }
}
```

未配置 `retrieval` 时，顾问仍使用 DSH 自带的文件搜索与读取。选型说明见 [`docs/CODING_AGENT_CODEBASE_MEMORY_LANDING.md`](../docs/CODING_AGENT_CODEBASE_MEMORY_LANDING.md)。

## 提问和记录

```bash
node readonly-advisor/cli.js ask \
  --config /path/to/planora.advisor.json \
  --question "为什么这句话被改写？请定位到规则、路由或模型，并列出证据。"
```

命令会输出会话目录，并写入：

- `session.json`：项目、任务、工作区提交、只读状态和会话状态；
- `question.md`；
- `answer.md`；
- `transcript.md`。

默认记录在 `~/.dsh-advisor/<project>/sessions/`，也可以在配置中指定 `recordDir`。

## 追问和生成修改建议

```bash
node readonly-advisor/cli.js followup \
  --session /path/to/session \
  --question "请进一步说明哪些材料还缺失。"

node readonly-advisor/cli.js propose \
  --session /path/to/session
```

`propose` 只生成 `change-proposal.md`，状态为 `pending_review`，不会修改代码、提交或部署。建议必须包含证据、可能修改对象、修改边界、验证方式和待研发确认项。

研发确认后记录决定：

```bash
node readonly-advisor/cli.js review \
  --session /path/to/session \
  --decision approved \
  --reviewer "研发姓名" \
  --note "同意先补充 routePolicyVersion，再补回归测试。"
```

`--decision` 可取 `approved`、`rejected` 或 `needs_changes`。决定会写入 `review.json`，并追加到会话 transcript。

## 当前边界

- 当前结果检查仍由操作者或后续编排器执行；
- 不自动接入线上日志和数据库；
- 不把一次回答自动变成代码修改；
- 不把项目记忆、白盒化契约或统一结果引用协议设为接入前提。
