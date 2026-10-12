# impl-advisor

面向业务专家的**实现核查顾问**（implementation advisor）。

专家提出业务/任务问题；顾问在项目方提供的**代码只读**与**运行材料只读**权限下，调用 DSH 查找证据，记录会话，并可生成待研发确认的修改建议。默认不改业务代码，也不把顾问配置写进目标仓库。

## 仓库结构

```text
readonly-advisor/   # CLI：init / ask / followup / propose / review
docs/               # 概要、详设、架构、开发计划
```

相关能力：

- 页面入口复用独立仓库 [PinAsk](https://github.com/kouhkh/pinask)
- Agent 运行时使用本机 DSH headless（需自行安装/配置）

## 快速开始

```bash
# 配置与会话默认落在 ~/.impl-advisor/<project>/，不会写进目标仓库
node readonly-advisor/cli.js init \
  --project planora \
  --task "技术规格书语气改写" \
  --workspace /path/to/planora

node readonly-advisor/cli.js ask \
  --config ~/.impl-advisor/planora/project.json \
  --question "为什么这句话被改写？请定位证据。"
```

如需指定外部路径：

```bash
node readonly-advisor/cli.js init \
  --project planora \
  --workspace /path/to/planora \
  --output /path/to/external/project.json \
  --recordDir /path/to/external/sessions
```

把 `--output` 或 `--recordDir` 指回目标仓库会被拒绝。

## 测试

```bash
npm test
```

## 文档

- [开发计划](docs/CODING_AGENT_ADVISOR_DEVELOPMENT_PLAN.md)
- [概要设计](docs/CODING_AGENT_RUNTIME_ADVISOR_OVERVIEW.md)
- [详细设计](docs/CODING_AGENT_RUNTIME_ADVISOR_DETAILED_DESIGN.md)
- [服务架构](docs/CODING_AGENT_ADVISOR_SERVICE_ARCHITECTURE.md)

## 当前边界（P0）

已做：CLI 会话闭环；默认外部工作区；追问携带历史。

计划中：薄 Runner 接 PinAsk、`export-dir` 运行材料、外部 Context Notes。详见开发计划。
