# impl-advisor

面向业务专家的**实现核查顾问**（implementation advisor）。

专家提出业务/任务问题；顾问在项目方提供的**代码只读**与**运行材料只读**权限下查找证据，记录会话，并可生成待研发确认的修改建议。默认不改业务代码，也不把顾问配置写进目标仓库。

产品分层：**权限控制** → **证据网关** → **工作记忆** → **harness runner（默认 DSH）**。  
`impl-advisor` 只拥有薄领域策略（允许找什么、证据如何进工作集、何时停）；不重写通用 harness。详见 [`docs/CODING_AGENT_WORKING_MEMORY_LAYER.md`](docs/CODING_AGENT_WORKING_MEMORY_LAYER.md)。

## 仓库结构

```text
readonly-advisor/   # CLI：init / ask / followup / evidence / propose / review
runner/             # 薄 HTTP：接 PinAsk batch /ask
docs/               # 概要、详设、架构、工作记忆层
```

相关能力：

- 页面入口复用独立仓库 [PinAsk](https://github.com/kouhkh/pinask)（**不内嵌**；可给其他库用）
- 本仓对接的 PinAsk 版本见 [`deps/pinask.json`](deps/pinask.json)；升级 PinAsk 后改那里的 `compatible.commit`
- 默认 runner 为本机 DSH headless；证据网关与工作记忆与 harness 解耦

## 快速开始

```bash
# 配置、会话、notes 默认落在 ~/.impl-advisor/<project>/，不会写进目标仓库
node readonly-advisor/cli.js init \
  --project planora \
  --task "技术规格书语气改写" \
  --workspace /path/to/planora \
  --runtime-mode export-dir \
  --export-dir /path/to/planora-exports

node readonly-advisor/cli.js ask \
  --config ~/.impl-advisor/planora/project.json \
  --question "为什么这句话被改写？请定位证据。"

# PinAsk endpoint -> http://127.0.0.1:8787/api/pinask
npm run runner -- --config ~/.impl-advisor/planora/project.json

# 外部查询笔记（不写目标仓）
node readonly-advisor/cli.js notes --config ~/.impl-advisor/planora/project.json --refresh

# 代码 vs 部署版本绑定（ssh 时自动一次 deploy-snapshot）
node readonly-advisor/cli.js versions --config ~/.impl-advisor/planora/project.json
# ask 默认附带部署快照；可用 --no-deploy-snapshot 关闭

# 页面夹具 E2E：另开 dry-run Runner 在 8790，再打开 http://127.0.0.1:8791/
npm run runner -- --config ~/.impl-advisor/planora/project.json --port 8790 --dry-run
npm run e2e:fixture
```

把 `--output` / `--recordDir` / `--notesDir` 指回目标仓库会被拒绝。

## 测试

```bash
npm test
```

## 文档

- [工作记忆与证据网关](docs/CODING_AGENT_WORKING_MEMORY_LAYER.md)
- [开发计划](docs/CODING_AGENT_ADVISOR_DEVELOPMENT_PLAN.md)
- [概要设计](docs/CODING_AGENT_RUNTIME_ADVISOR_OVERVIEW.md)
- [详细设计](docs/CODING_AGENT_RUNTIME_ADVISOR_DETAILED_DESIGN.md)
- [服务架构](docs/CODING_AGENT_ADVISOR_SERVICE_ARCHITECTURE.md)
- [Runner](runner/README.md)

## 当前边界（P0）

已做：CLI；外部工作区；`export-dir`；页面事实；薄 Runner；SSH 护栏；版本绑定；运行候选；**证据网关 + 工作记忆（首问/追问）**；PinAsk 入口。

已补：`run-memory` 骨架；本机独立用户 ACL 脚本（见 [`docs/LOCAL_DEDICATED_USER_BOUNDARY.md`](docs/LOCAL_DEDICATED_USER_BOUNDARY.md)）；`runners.js` 支持 `--runner opencode` 对照。

Harness 对照决议（2026-10-14）：**默认不再测 Cline**；默认保留 `DSH×v4-pro`（同 harness 下 GLM/Kimi 未更快）。详见 [`docs/HARNESS_COMPARE_DECISION_20261014.md`](docs/HARNESS_COMPARE_DECISION_20261014.md)。
