#!/usr/bin/env bash
set -euo pipefail
test "$(id -u)" = 0
test "${1:-}" = '--reset-legacy-test'
test -s /etc/payathon-test/sms-auth.env
# First cutover only; rerunning must never erase a new phone-login trial.
test ! -e /var/lib/payathon-test/phone-trial.sqlite
release="/opt/payathon-test/releases/$(date -u +%Y%m%dT%H%M%SZ)-sms-trial"
install -d -m 755 "$release"
tar -xzf /tmp/payathon-test-release.tgz --exclude='*/._*' -C "$release"
cd "$release"
node_bin=/opt/payathon-tools/node-v24.19.0-linux-x64/bin/node
"$node_bin" scripts/check.mjs
"$node_bin" --test tests/*.test.mjs
"$node_bin" --env-file=/etc/payathon-test/sms-auth.env scripts/sms-check.mjs
"$node_bin" --env-file=deploy/sms-trial.env.example --env-file=/etc/payathon-test/sms-auth.env --input-type=module -e 'import { loadRuntime } from "./apps/api/runtime.mjs"; loadRuntime(); console.log("SMS trial runtime configuration ready");'
systemd-analyze verify deploy/payathon-test.service deploy/payathon-backup.service deploy/payathon-monitor.service
nginx -t
# Stop writers before resetting legacy data. Existing backup bundles stay offline.
systemctl stop payathon-backup.timer payathon-monitor.timer
systemctl stop payathon-backup.service payathon-monitor.service
systemctl stop payathon-test.service
DATABASE_PATH=/var/lib/payathon-test/test.sqlite "$node_bin" scripts/reset-test-data.mjs --reset-legacy-test
chown payathon-test:payathon-test /var/lib/payathon-test/test.sqlite /var/lib/payathon-test/test.sqlite.deletions.sqlite
# Retire old issued login identities as well as their business records.
rm -f /etc/payathon-test/accounts.json
install -m 640 -o root -g payathon-test deploy/sms-trial.env.example /etc/payathon-test/app.env
ln -sfn "$release" /opt/payathon-test/current
ln -sfn "$release" /opt/payathon-ops/current
for unit in payathon-test.service payathon-backup.service payathon-monitor.service; do
  install -m 644 "deploy/$unit" "/etc/systemd/system/$unit"
done
systemctl daemon-reload
systemctl restart payathon-test.service
curl -fsS --retry 10 --retry-delay 1 --retry-connrefused --max-time 15 http://127.0.0.1:4181/api/v1/health
systemctl start payathon-backup.service
systemctl start payathon-backup.timer payathon-monitor.timer
systemctl start payathon-monitor.service
systemctl is-active payathon-test.service nginx.service payathon-backup.timer payathon-monitor.timer
