# Readonly Advisor CLI

`impl-advisor` 的薄 DSH 封装：项目方提供只读工作区与运行材料入口；专家提问、追问、生成待研发确认建议。

## 外部工作区（默认）

配置与会话默认在：

```text
~/.impl-advisor/<project>/project.json
~/.impl-advisor/<project>/sessions/
```

不会写入目标代码仓库。若 `--output` / `--recordDir` 落在目标 `workspace` 内，命令会失败。

## 命令

```bash
node readonly-advisor/cli.js init \
  --project planora \
  --task "技术规格书语气改写" \
  --workspace /path/to/planora

node readonly-advisor/cli.js ask \
  --config ~/.impl-advisor/planora/project.json \
  --question "为什么这句话被改写？请定位证据。"

node readonly-advisor/cli.js followup \
  --session /path/to/session \
  --question "还缺哪些运行材料？"

node readonly-advisor/cli.js propose --session /path/to/session

node readonly-advisor/cli.js review \
  --session /path/to/session \
  --decision approved \
  --note "同意补充回归测试。"
```

`--decision`：`approved` | `rejected` | `needs_changes`。

可选配置：`taskContextPaths`、`retrieval`（只读检索命令提示）。详见根目录开发计划。

## 边界

- `readOnly: true` 为硬性要求；
- 实际只读仍依赖 OS/SSH/DSH 权限，不能只靠提示词；
- 不自动改代码、提交或部署。
