# 本机独立用户硬边界

> 状态：落地说明，2026-10-14  
> 原则：**用 OS 权限挡乱读，不用提示词挡**。沙箱可后加，不是起步项。

## 为什么要独立用户

顾问 runner（DSH / OpenCode）和普通开发账号同家目录时，模型理论上能读到：

- 其它项目源码
- `~/.impl-advisor` 里别的会话 / API 痕迹
- 本机凭据与私人文件

提示词「不许读」挡不住工具调用。换成一把只能开指定房间的钥匙更干净。

类比：独立用户 = 客房钥匙；沙箱 = 钥匙 + 厚本进门规则。先做钥匙。

## 边界目标

| 路径 | 顾问用户 |
|---|---|
| 目标 `workspace` | 只读 |
| 允许的 export / 离线 trace（若配置） | 只读 |
| `~/.impl-advisor/<project>/`（该项目会话区） | 读写（落盘会话） |
| 操作者家目录其它内容 | **不可读** |
| 目标仓写操作 / git commit | **不可写** |

SSH 远端仍走既有 jail（`docs/SSH_READONLY_GUARDRAILS.md`），与本机边界正交。

## 脚本

均在 `scripts/dedicated-user/`：

```bash
# 1) 建用户 + 组（需管理员；默认用户名 impladvisor）
sudo bash scripts/dedicated-user/setup-macos.sh

# 2) 给某项目挂上可读 ACL，并收紧写权限
sudo bash scripts/dedicated-user/grant-project.sh \
  --workspace /path/to/planora \
  --advisor-home /Users/impladvisor/.impl-advisor/planora

# 3) 自检：顾问用户能否读 workspace、能否读到你的私人文件
bash scripts/dedicated-user/verify-boundary.sh \
  --workspace /path/to/planora \
  --forbid "$HOME/.ssh" \
  --forbid "$HOME/.impl-advisor"

# 4) 以顾问用户跑 ask（同一套工作记忆 / 证据网关）
bash scripts/dedicated-user/run-as-advisor.sh \
  --config /Users/impladvisor/.impl-advisor/planora/project.json \
  ask --question "……"
```

Linux 可用同目录 `setup-linux.sh`（`useradd` + `setfacl`）。

## 配置约定

把 `project.json` 放进顾问用户自己的树，例如：

```text
/Users/impladvisor/.impl-advisor/planora/project.json
```

`workspace` 仍指向真实代码目录；`recordDir` / `notesDir` / `memoryDir` 必须落在顾问用户可写区，且**不得**指回目标仓（现有 CLI 已拒绝）。

## 明确不做

- 不在本阶段上 `sandbox-exec` / seatbelt 全量策略
- 不用 Docker 当默认本机边界
- 不把「独立用户」伪装成远端 SSH jail 的替代品
