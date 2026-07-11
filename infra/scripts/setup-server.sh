#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────
# Aurial — Ubuntu server bootstrap (idempotent — safe to re-run).
#
# Installs Docker Engine + compose plugin, git, ffmpeg and ufw;
# opens the firewall; creates /opt/aurial.
#
# Run ON the server as root:
#   sudo bash infra/scripts/setup-server.sh
# or straight from a fresh box (before the repo exists):
#   scp infra/scripts/setup-server.sh v@192.168.0.100:/tmp/ && \
#     ssh -t v@192.168.0.100 "sudo bash /tmp/setup-server.sh"
#
# Overridable env vars:
#   DEPLOY_PATH  (default /opt/aurial)
#   LAN_SUBNET   (default 192.168.0.0/24 — used to restrict port 4000)
# ──────────────────────────────────────────────────────────────
set -euo pipefail

DEPLOY_PATH="${DEPLOY_PATH:-/opt/aurial}"
LAN_SUBNET="${LAN_SUBNET:-192.168.0.0/24}"
# When run with sudo, grant docker access to the invoking user (e.g. "v").
TARGET_USER="${SUDO_USER:-${USER}}"

step() { printf '\n\033[1;32m==> %s\033[0m\n' "$*"; }

if [[ "${EUID}" -ne 0 ]]; then
  echo "error: run as root — sudo bash $0" >&2
  exit 1
fi

step "1/7 apt update + upgrade"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get upgrade -y

step "2/7 Base packages: git, ffmpeg, ufw, curl, ca-certificates"
apt-get install -y git ffmpeg ufw curl ca-certificates gnupg

step "3/7 Docker Engine + compose plugin"
if command -v docker >/dev/null 2>&1; then
  echo "docker already installed: $(docker --version)"
else
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  # shellcheck source=/dev/null
  . /etc/os-release
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu ${VERSION_CODENAME} stable" \
    >/etc/apt/sources.list.d/docker.list
  apt-get update -y
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi
# The compose plugin can be missing on older docker installs — ensure it.
if ! docker compose version >/dev/null 2>&1; then
  apt-get install -y docker-compose-plugin
fi

step "4/7 Enable and start the docker service"
systemctl enable --now docker

step "5/7 Add ${TARGET_USER} to the docker group"
if id -nG "${TARGET_USER}" | grep -qw docker; then
  echo "${TARGET_USER} is already in the docker group"
else
  usermod -aG docker "${TARGET_USER}"
  echo "added — ${TARGET_USER} must log out/in (or run 'newgrp docker') for it to apply"
fi

step "6/7 Firewall (ufw): allow 22, 80, 443; 4000 restricted to the LAN"
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
# Port 4000 is the API published by docker compose. Keep it LAN-only —
# anything public should go through nginx on 80/443 instead.
# NOTE: docker publishes ports via iptables and can bypass ufw for
# container ports; binding 4000 plus this rule is defense in depth.
ufw allow from "${LAN_SUBNET}" to any port 4000 proto tcp
ufw --force enable
ufw status verbose

step "7/7 Create ${DEPLOY_PATH}"
mkdir -p "${DEPLOY_PATH}" "${DEPLOY_PATH}/backups"
chown -R "${TARGET_USER}:${TARGET_USER}" "${DEPLOY_PATH}"

printf '\n\033[1;32mDone.\033[0m Next steps (as %s, after re-login for the docker group):\n' "${TARGET_USER}"
cat <<NEXT
  1. git clone <repo-url> ${DEPLOY_PATH}        # or rsync the repo there
  2. cp ${DEPLOY_PATH}/.env.example ${DEPLOY_PATH}/.env   # fill in production values
  3. chmod +x ${DEPLOY_PATH}/infra/scripts/*.sh
  4. ${DEPLOY_PATH}/infra/scripts/deploy-api.sh
Full guide: docs/DEPLOY.md
NEXT
