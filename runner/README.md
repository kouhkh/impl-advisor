# Advisor Runner

薄本地 HTTP 进程：接收 PinAsk batch 或 `/ask` JSON，绑定外部项目配置，调用只读顾问 CLI/DSH，返回会话与回答。

## 启动

```bash
node runner/server.js \
  --config ~/.impl-advisor/planora/project.json \
  --port 8787 \
  --host 127.0.0.1
```

调试可不连真实 DSH：

```bash
node runner/server.js --config ~/.impl-advisor/planora/project.json --dry-run
```

## 接口

| 方法 | 路径 | 作用 |
|---|---|---|
| GET | `/health` | 健康检查与当前绑定项目 |
| GET | `/api/pinask?status=` | 兼容 PinAsk demo 状态探测 |
| POST | `/api/pinask` | 接收 PinAsk batch，新建或追问会话 |
| POST | `/ask` | `{ question, session?, page_context? }` |

PinAsk 是独立仓库，不随本仓发布。对接版本钉在 [`deps/pinask.json`](../deps/pinask.json)。

PinAsk overlay 把 `endpoint` 指到 `http://127.0.0.1:8787/api/pinask`。返回 JSON 含 `id` / `session` / `answer`；兼容的 PinAsk 版本会在侧栏展示 `answer`，并用 `session` 追问。

## 边界

- `project` / `environment` / 运行材料入口来自外部配置，不从页面猜测；
- 默认只监听本机；
- 不写目标代码仓库。
