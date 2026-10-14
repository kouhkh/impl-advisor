# Harness 对照结论（2026-10-14）

> 目的：支持「以后默认不测 Cline」；区分 harness 优势 vs 模型差异；给出下一步优先组合。

## 1. 测试设置（共同点）

- 题：Planora **Q3**（「适应带宽」→ 去「应」加「确保」；版本 / 根因 / 是否修复）
- 同一套：证据网关 + 工作记忆 brief（冻结 prompt）
- 材料目录：
  - 纪律局：`~/.impl-advisor/planora/ablation/harness-compare-20261014T075101Z/`
  - 完成局：`~/.impl-advisor/planora/ablation/harness-confirmed-20261014T085107Z/`
    （专家已确认候选 = deploy 日志；允许 code.search/read）
  - **同 harness 换模型**：`~/.impl-advisor/planora/ablation/dsh-model-ab-20261014T110542Z/`
    （复用完成局 frozen-prompt；DSH × v4-pro / frontis glm-5.3 / frontis kimi-k2.7-code）

## 2. 各组合结果摘要

| 组合 | 模型 | 纪律局（multiple 停问） | 完成局（ying-tail） | 耗时量级 | 稳定性 |
|---|---|---|---|---|---|
| **DSH** | **deepseek-v4-pro**（默认） | 守停问 ~17s | 命中 ying-tail ~4.8–5.9min | **最快** | **最高** |
| **DSH** | **frontis/kimi-k2.7-code** | — | 命中满配 ~8.4min | 中 | 高（能收束） |
| **DSH** | **frontis/glm-5.3** | — | 线索命中但空转；~23min 杀进程，仅中间进展 | **最慢** | **低**（DSH 下易工具轰炸） |
| OpenCode | mimo-flash-free（早期） | 默认空转；禁工具后守停问 | — | — | 差（默认） |
| OpenCode | **frontis/glm-5.3** | 禁工具后守停问 ~1min | 命中（需工具预算）~4.4–8.5min | 中 | 中（默认爱空转） |
| OpenCode | **frontis/kimi-k2.7-code** | — | 命中 ~9.9min | 中慢 | 中 |
| Cline | **frontis/glm-5.3** | 能守停问，偏长 | 命中但噪声大，易超时 | 最慢档 | **最低** |
| cursor-agent | Cursor 官方（非 Frontis） | 未形成有效对照 | — | — | 不适用（CLI 接不上 Frontis） |

完成局答案长度（粗信号）：DSH-pro ~5k / DSH-Kimi ~4.7k / OpenCode-GLM ~2.5–3.3k / Cline ~39k（含 thinking 噪声）。

## 3. 决策：以后默认不测 Cline

依据：

1. 同模型 **GLM-5.3 + Frontis** 下，Cline 相对 OpenCode：**更慢、更容易拖到超时、输出噪声大**，任务命中率没有更高。
2. Cline 不能证明「GLM 不行」或「工作记忆不行」——只证明 **Cline 这个 harness 不适合当顾问默认 runner**。
3. 对照成本高（守护进程、ANSI/thinking 污染、超时杀进程），边际信息量低。

**决议：Cline 退出默认对照矩阵。** 仅当明确要修 Cline 集成时再单开，不进入日常 harness A/B。

## 4. harness vs 模型：交叉结论（已补齐）

同 DSH、同 frozen-prompt 换模型（`dsh-model-ab-20261014T110542Z`）：

| 组合 | 耗时 | ying_tail | 满配命中¹ | 收束 |
|---|---:|:---:|:---:|---|
| DSH × v4-pro | **353s (~5.9min)** | Y | **4/4** | 自然完成 |
| DSH × Kimi K2.7 Code | 506s (~8.4min) | Y | **4/4** | 自然完成 |
| DSH × GLM-5.3 | 1385s (~23min) 后杀掉 | Y | 3/4（缺未修复/未知收束） | **工具空转**（~44 step / 500+ bash） |

¹ 满配 = `ying_tail` + `code_path` + `separates_versions` + `unfixed_or_unknown`。

解读：

- **不是「换 GLM/Kimi 就更快」**：在 DSH 下两者都 **慢于 v4-pro**；GLM 还明显更爱空转。
- **正确性**：Kimi ≈ pro（都能说到根因与「未知/未修复」）；GLM 在杀掉前已摸到 ying-tail/版本线索，但 **交不出完整收束答案**。
- **harness 仍主导纪律**：同是 GLM，OpenCode（加工具预算）能在 ~数分钟收束；DSH×GLM 反而狂 bash——说明「模型 × runner 工具策略」耦合强，不能单骂模型。
- 早期「OpenCode+GLM 比 DSH+pro 更短」仍成立；但 **短 ≠ 快于 pro 完成任务**，且 DSH+pro 仍是完成局最快满配。

| 假设 | 结论 |
|---|---|
| DSH+GLM ≈ DSH+pro 且可能更快 | **否**（更慢且难收束） |
| DSH+Kimi ≈ DSH+pro 命中、可能更快 | **命中相当，但不更快**（~1.4× 时间） |
| 默认切 GLM 控成本 | **不建议**（顾问主路径要稳与快） |

## 5. 默认组合建议

1. **默认：`DSH + deepseek-v4-pro`（Frontis）** — 最快满配、最稳。
2. **备用：`DSH + frontis/kimi-k2.7-code`** — 结果相当、更慢；配额/可用性不够时用。
3. **不默认：`DSH + glm-5.3`** — 同题易工具轰炸；若要用 GLM，优先已验证的 **OpenCode + 工具预算**，或再给 DSH 加步数/工具硬顶后单开评估。
4. OpenCode 二次优化（默认工具预算）仍可做，但不替代 DSH+pro 默认。

## 6. 操作备忘

- `~/.dsh/settings.yaml`：
  - `llm-deepseek`：只挂 deepseek-\*（Frontis baseURL + `thinking: disabled`）
  - `llm-pi-ai.providers.frontis`：`glm-5.3` / `kimi-k2.7-code`（`reasoningEfforts: false`，`maxTokens: 128000`）
  - 默认仍是 `provider: deepseek-official` / `model: deepseek-v4-pro`
- 换模型：改 `agent-default-model.provider/model`（frontis vs deepseek-official）
- 复跑脚本：`node scripts/compare-dsh-models.mjs --out <dir> [--timeoutMs 720000]`

## 7. 历史附录：拒包期交叉（已过时）

材料：`model-ab-20261014T094700Z` 等——当时 DSH×GLM/Kimi 因 DeepSeek 方言打 Frontis（`max_tokens=256000` / `thinking`）被 MaaS `INVALID_REQUEST`。  
**已用 `llm-pi-ai` frontis 路由修好**；以 §4 的 `dsh-model-ab-20261014T110542Z` 为准。

OpenCode 并行注意：隔离 `XDG_CONFIG_HOME` / `XDG_DATA_HOME`，否则 `database is locked`。
