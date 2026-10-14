#!/usr/bin/env bash
# 在 macOS 上创建低权顾问用户 + 组。需管理员权限。
# 用法：sudo bash scripts/dedicated-user/setup-macos.sh [--user impladvisor]
set -euo pipefail

USER_NAME="impladvisor"
GROUP_NAME="impladvisor"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --user) USER_NAME="$2"; GROUP_NAME="$2"; shift 2 ;;
    --group) GROUP_NAME="$2"; shift 2 ;;
    -h|--help)
      echo "usage: sudo $0 [--user NAME] [--group NAME]"
      exit 0
      ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

if [[ "$(id -u)" -ne 0 ]]; then
  echo "需要 root：sudo bash $0" >&2
  exit 1
fi

if ! dscl . -read "/Groups/${GROUP_NAME}" &>/dev/null; then
  # 选一个空闲 GID
  GID=$(dscl . -list /Groups PrimaryGroupID | awk '{print $2}' | sort -n | tail -1)
  GID=$((GID + 1))
  dscl . -create "/Groups/${GROUP_NAME}"
  dscl . -create "/Groups/${GROUP_NAME}" PrimaryGroupID "$GID"
  dscl . -create "/Groups/${GROUP_NAME}" Password '*'
  echo "created group ${GROUP_NAME} gid=${GID}"
else
  GID=$(dscl . -read "/Groups/${GROUP_NAME}" PrimaryGroupID | awk '{print $2}')
  echo "group ${GROUP_NAME} already exists gid=${GID}"
fi

HOME_DIR="/Users/${USER_NAME}"
if ! id "${USER_NAME}" &>/dev/null; then
  UID_NUM=$(dscl . -list /Users UniqueID | awk '{print $2}' | sort -n | tail -1)
  UID_NUM=$((UID_NUM + 1))
  dscl . -create "/Users/${USER_NAME}"
  dscl . -create "/Users/${USER_NAME}" UserShell /bin/zsh
  dscl . -create "/Users/${USER_NAME}" RealName "Impl Advisor Runner"
  dscl . -create "/Users/${USER_NAME}" UniqueID "$UID_NUM"
  dscl . -create "/Users/${USER_NAME}" PrimaryGroupID "$GID"
  dscl . -create "/Users/${USER_NAME}" NFSHomeDirectory "${HOME_DIR}"
  dscl . -passwd "/Users/${USER_NAME}" '*'
  createhomedir -c -u "${USER_NAME}" >/dev/null || mkdir -p "${HOME_DIR}"
  chown -R "${USER_NAME}:${GROUP_NAME}" "${HOME_DIR}"
  chmod 700 "${HOME_DIR}"
  echo "created user ${USER_NAME} uid=${UID_NUM} home=${HOME_DIR}"
else
  echo "user ${USER_NAME} already exists"
fi

mkdir -p "${HOME_DIR}/.impl-advisor"
chown -R "${USER_NAME}:${GROUP_NAME}" "${HOME_DIR}/.impl-advisor"
chmod 700 "${HOME_DIR}/.impl-advisor"

cat <<EOF
下一步：
  sudo bash scripts/dedicated-user/grant-project.sh \\
    --workspace /path/to/code \\
    --advisor-home ${HOME_DIR}/.impl-advisor/<project>
  bash scripts/dedicated-user/verify-boundary.sh --workspace /path/to/code
EOF
