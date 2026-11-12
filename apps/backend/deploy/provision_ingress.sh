#!/usr/bin/env bash
set -euo pipefail

[[ $(id -u) == 0 ]] || { echo 'Run with sudo.' >&2; exit 1; }
[[ $(hostname -s) == formlane-agent ]] || { echo 'Unexpected deployment host.' >&2; exit 1; }
[[ $# == 1 && $1 =~ ^[a-zA-Z0-9.-]+$ ]] || { echo 'Supply the reserved public IP or DNS hostname.' >&2; exit 1; }
export DEBIAN_FRONTEND=noninteractive
if ! command -v caddy >/dev/null; then
  apt-get install -y --no-install-recommends curl gnupg ca-certificates debian-keyring debian-archive-keyring apt-transport-https
  curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/gpg.key | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt -o /etc/apt/sources.list.d/caddy-stable.list
  chmod 0644 /usr/share/keyrings/caddy-stable-archive-keyring.gpg /etc/apt/sources.list.d/caddy-stable.list
  apt-get update
  apt-get install -y --no-install-recommends caddy
fi
install -m 0644 "$(dirname "$0")/Caddyfile" /etc/caddy/Caddyfile
printf 'FORMLANE_API_HOST=%s\n' "$1" > /etc/caddy/formlane.env
chmod 0644 /etc/caddy/formlane.env
install -d -m 0755 /etc/systemd/system/caddy.service.d
printf '[Service]\nEnvironmentFile=/etc/caddy/formlane.env\n' > /etc/systemd/system/caddy.service.d/formlane.conf
FORMLANE_API_HOST="$1" caddy validate --config /etc/caddy/Caddyfile
systemctl daemon-reload
systemctl enable caddy
systemctl restart caddy
caddy version
