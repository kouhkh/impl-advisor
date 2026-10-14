#!/usr/bin/env bash
# Linux：创建低权顾问用户。需 root。ACL 依赖 setfacl（acl 包）。
# 用法：sudo bash scripts/dedicated-user/setup-linux.sh [--user impladvisor]
set -euo pipefail

USER_NAME="impladvisor"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --user) USER_NAME="$2"; shift 2 ;;
    -h|--help) echo "usage: sudo $0 [--user NAME]"; exit 0 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

if [[ "$(id -u)" -ne 0 ]]; then
  echo "需要 root" >&2
  exit 1
fi

if ! id "$USER_NAME" &>/dev/null; then
  useradd --create-home --shell /bin/bash --user-group "$USER_NAME"
  echo "created user ${USER_NAME}"
else
  echo "user ${USER_NAME} already exists"
fi

HOME_DIR="$(getent passwd "$USER_NAME" | cut -d: -f6)"
mkdir -p "${HOME_DIR}/.impl-advisor"
chown -R "${USER_NAME}:${USER_NAME}" "${HOME_DIR}/.impl-advisor"
chmod 700 "${HOME_DIR}" "${HOME_DIR}/.impl-advisor"

if ! command -v setfacl >/dev/null; then
  echo "警告：未安装 setfacl；grant-project.sh 在 Linux 上需要 acl 包" >&2
fi

cat <<EOF
下一步：
  sudo bash scripts/dedicated-user/grant-project.sh \\
    --workspace /path/to/code \\
    --advisor-home ${HOME_DIR}/.impl-advisor/<project>
EOF
