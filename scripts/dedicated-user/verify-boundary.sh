#!/usr/bin/env bash
# 用顾问用户试读：应能读 workspace，不应读 forbid 路径。
# 用法：bash scripts/dedicated-user/verify-boundary.sh --workspace DIR [--forbid PATH]...
set -euo pipefail

USER_NAME="impladvisor"
WORKSPACE=""
FORBID=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --user) USER_NAME="$2"; shift 2 ;;
    --workspace) WORKSPACE="$2"; shift 2 ;;
    --forbid) FORBID+=("$2"); shift 2 ;;
    -h|--help)
      echo "usage: $0 --workspace DIR [--forbid PATH]..."
      exit 0
      ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

if [[ -z "$WORKSPACE" ]]; then
  echo "缺少 --workspace" >&2
  exit 2
fi
if ! id "$USER_NAME" &>/dev/null; then
  echo "用户不存在：${USER_NAME}" >&2
  exit 1
fi

WORKSPACE="$(cd "$WORKSPACE" && pwd)"
fail=0

probe() {
  local label="$1" path="$2" expect="$3"
  local code
  set +e
  sudo -u "$USER_NAME" -H test -r "$path"
  code=$?
  set -e
  if [[ "$expect" == "allow" && "$code" -eq 0 ]]; then
    echo "OK allow: $label ($path)"
  elif [[ "$expect" == "deny" && "$code" -ne 0 ]]; then
    echo "OK deny:  $label ($path)"
  else
    echo "FAIL expect=${expect} got_exit=${code}: $label ($path)" >&2
    fail=1
  fi
}

probe workspace "$WORKSPACE" allow
# 常见入口文件
if [[ -f "$WORKSPACE/package.json" ]]; then
  probe workspace-package "$WORKSPACE/package.json" allow
fi

if [[ ${#FORBID[@]} -eq 0 ]]; then
  FORBID+=("${HOME}/.ssh" "${HOME}/.impl-advisor")
fi
for path in "${FORBID[@]}"; do
  if [[ -e "$path" ]]; then
    probe "forbid $(basename "$path")" "$path" deny
  else
    echo "skip missing forbid: $path"
  fi
done

if [[ "$fail" -ne 0 ]]; then
  echo "边界未通过：检查 grant-project.sh ACL / 家目录权限" >&2
  exit 1
fi
echo "verify-boundary: ok"
