# SSH 只读护栏

目标：顾问可以通过 SSH 读测试机上的运行材料，但**不能把别人的服务器拖垮**。将来做成对外服务时，这些限制是默认安全底线，不是可选项。

## 硬限制（默认）

| 护栏 | 默认 | 作用 |
|---|---|---|
| 命令白名单 | `health` `ls` `head` `find-names` `deploy-snapshot` | 禁止自由 shell |
| 路径 jail | 必须在 `runtime.root` 下 | 防止读到无关系统路径 |
| 单 host 并发 | 1 | 避免并行打爆 |
| 最小间隔 | 800ms | 降低抖动与惊群 |
| 连接超时 | 8s | 卡死连接快速失败 |
| 命令超时 | 15s（上限 30s） | 长命令直接杀 |
| 输出上限 | 64KB | 防止大文件拖回 |
| `head` 文件上限 | 1MB | 拒绝超大文件 |
| `find` 深度/条数 | maxdepth 2 / 40 | 避免全盘扫描 |
| load 拒绝阈值 | `load1 > nproc * 0.75` | 忙时拒执行 |
| 内存拒绝阈值 | used/total > 0.90 | 内存紧张时拒执行 |
| 审计 | `~/.impl-advisor/<project>/ssh-audit.jsonl` | 可追溯 |

每次业务 op 前后都会做一次轻量 `health`；若超阈值，**失败并停止**，不要自动重试轰炸。

## 用法

```bash
# 配置示例（写在仓外）
# runtime.mode=ssh host=123 root=/opt/planora

node readonly-advisor/cli.js ssh --config ~/.impl-advisor/planora/project.json --op health
node readonly-advisor/cli.js ssh --config ~/.impl-advisor/planora/project.json --op ls --path current
node readonly-advisor/cli.js ssh --config ~/.impl-advisor/planora/project.json --op find-names --path logs --pattern "*.log"
```

## 明确不做

- 不在远端跑 `npm` / `build` / 测试套件
- 不开放任意远程命令字符串
- 不因超时/拒绝而自动加倍重试
- 不把凭据写进会话答案

## 调参

可在 `project.json` 的 `runtime.limits` 覆盖默认值。对外多租户时，只允许**更严**，不允许更松（后续服务层再强制）。
