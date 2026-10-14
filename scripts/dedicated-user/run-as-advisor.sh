#!/usr/bin/env bash
# 以顾问用户执行 readonly-advisor CLI（同一套工作记忆 / 证据网关）。
# 用法：
#   bash scripts/dedicated-user/run-as-advisor.sh --config /Users/impladvisor/.impl-advisor/planora/project.json \
#     ask --question "..."
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
USER_NAME="impladvisor"
CONFIG=""
PASSTHRU=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --user) USER_NAME="$2"; shift 2 ;;
    --config) CONFIG="$2"; shift 2 ;;
    --) shift; PASSTHRU+=("$@"); break ;;
    -h|--help)
      echo "usage: $0 --config PATH <cli-args...>"
      echo "example: $0 --config ~/.impl-advisor/planora/project.json ask --question '...'"
      exit 0
      ;;
    *)
      PASSTHRU+=("$@")
      break
      ;;
  esac
done

if [[ -z "$CONFIG" ]]; then
  echo "缺少 --config" >&2
  exit 2
fi
if ! id "$USER_NAME" &>/dev/null; then
  echo "用户不存在：${USER_NAME}" >&2
  exit 1
fi

# 若还有未吃掉的 --config（兼容旧写法），并入 PASSTHRU
CMD=(node "${ROOT}/readonly-advisor/cli.js" --config "$CONFIG" "${PASSTHRU[@]}")
echo "+ sudo -u ${USER_NAME} -H ${CMD[*]}" >&2
exec sudo -u "$USER_NAME" -H "${CMD[@]}"
