#!/usr/bin/env bash
set -euo pipefail
test "$(id -u)" = 0
release="/opt/payathon-ops/releases/$(date -u +%Y%m%dT%H%M%SZ)"
install -d -m 755 "$release"
tar -xzf /tmp/payathon-operations.tgz --exclude='*/._*' -C "$release"
cd "$release"
/opt/payathon-tools/node-v24.19.0-linux-x64/bin/node scripts/check.mjs
/opt/payathon-tools/node-v24.19.0-linux-x64/bin/node --test tests/*.test.mjs
systemd-analyze verify deploy/payathon-backup.service deploy/payathon-backup.timer deploy/payathon-monitor.service deploy/payathon-monitor.timer
install -d -m 700 -o payathon-test -g payathon-test /var/backups/payathon-test
install -d -m 700 /var/lib/payathon-monitor
test ! -e /opt/payathon-ops/current || test -L /opt/payathon-ops/current
ln -sfn "$release" /opt/payathon-ops/current
for unit in payathon-backup.service payathon-backup.timer payathon-monitor.service payathon-monitor.timer; do
  install -m 644 "deploy/$unit" "/etc/systemd/system/$unit"
done
systemctl daemon-reload
systemctl start payathon-backup.service
systemctl enable --now payathon-backup.timer payathon-monitor.timer
systemctl start payathon-monitor.service
systemctl is-active payathon-test.service nginx.service payathon-backup.timer payathon-monitor.timer
cat /var/lib/payathon-monitor/status.json
