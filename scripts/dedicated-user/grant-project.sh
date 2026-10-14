#!/usr/bin/env bash
# 给顾问用户挂只读 workspace ACL，并准备顾问工作区目录。
# 用法：sudo bash scripts/dedicated-user/grant-project.sh \
#   --workspace /path/to/code --advisor-home /Users/impladvisor/.impl-advisor/planora
set -euo pipefail

USER_NAME="impladvisor"
WORKSPACE=""
ADVISOR_HOME=""
EXTRA_READ=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --user) USER_NAME="$2"; shift 2 ;;
    --workspace) WORKSPACE="$2"; shift 2 ;;
    --advisor-home) ADVISOR_HOME="$2"; shift 2 ;;
    --also-read) EXTRA_READ+=("$2"); shift 2 ;;
    -h|--help)
      echo "usage: sudo $0 --workspace DIR --advisor-home DIR [--also-read DIR]..."
      exit 0
      ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

if [[ "$(id -u)" -ne 0 ]]; then
  echo "需要 root：sudo bash $0 ..." >&2
  exit 1
fi
if [[ -z "$WORKSPACE" || -z "$ADVISOR_HOME" ]]; then
  echo "缺少 --workspace 或 --advisor-home" >&2
  exit 2
fi
if ! id "$USER_NAME" &>/dev/null; then
  echo "用户不存在：先跑 setup-macos.sh / setup-linux.sh" >&2
  exit 1
fi

WORKSPACE="$(cd "$WORKSPACE" && pwd)"
mkdir -p "$ADVISOR_HOME"/{sessions,notes,memory,proposals}
chown -R "${USER_NAME}:${USER_NAME}" "$ADVISOR_HOME"
chmod -R u+rwX,go-rwx "$ADVISOR_HOME"

grant_read() {
  local target="$1"
  if [[ ! -e "$target" ]]; then
    echo "skip missing: $target" >&2
    return 0
  fi
  # macOS ACL：允许读+遍历，明确拒绝写
  chmod -R +a "user:${USER_NAME}:allow:read,execute,readattr,readextattr,readsecurity,list,search" "$target" 2>/dev/null \
    || setfacl -R -m "u:${USER_NAME}:rX" "$target"
  chmod -R +a "user:${USER_NAME}:deny:write,append,delete,delete_child,writeattr,writeextattr" "$target" 2>/dev/null \
    || setfacl -R -m "u:${USER_NAME}:r-X" "$target" || true
  echo "granted read-only: $target"
}

grant_read "$WORKSPACE"
for path in "${EXTRA_READ[@]+"${EXTRA_READ[@]}"}"; do
  grant_read "$(cd "$path" && pwd)"
done

cat <<EOF
已准备顾问工作区：${ADVISOR_HOME}
请把 project.json 的 recordDir/notesDir/memoryDir 指到该目录下对应子路径。
EOF
