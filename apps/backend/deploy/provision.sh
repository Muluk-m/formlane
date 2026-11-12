#!/usr/bin/env bash
set -euo pipefail

# Run only on the already approved Formlane VM. This does not stop the legacy stack.
[[ $(id -u) == 0 ]] || { echo 'Run with sudo.' >&2; exit 1; }
[[ $(hostname -s) == formlane-agent ]] || { echo 'Unexpected deployment host.' >&2; exit 1; }
getent passwd formlane >/dev/null
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y --no-install-recommends postgresql postgresql-client python3-venv
systemctl enable --now postgresql
install -d -m 0755 /opt/formlane/python-tools /opt/formlane/python-backend/releases
install -d -o formlane -g formlane -m 0700 /var/lib/formlane/python /var/lib/formlane/backups
if [[ ! -x /opt/formlane/python-tools/bin/python ]]; then
  python3 -m venv /opt/formlane/python-tools
fi
/opt/formlane/python-tools/bin/pip install --disable-pip-version-check 'uv==0.13.7'
python3 "$(dirname "$0")/bootstrap_postgres.py"
echo 'PostgreSQL and Python tooling provisioned; legacy executor unchanged.'
