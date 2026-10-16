#!/usr/bin/env bash
# Routine update: preserve all credentials, identities, databases and journals.
set -euo pipefail
test "$(id -u)" = 0
test -f /etc/payathon-test/app.env
release="/opt/payathon-test/releases/$(date -u +%Y%m%dT%H%M%SZ)-update"
install -d -m 755 "$release"
tar -xzf /tmp/payathon-test-release.tgz --exclude='*/._*' -C "$release"
cd "$release"
node_bin=/opt/payathon-tools/node-v24.19.0-linux-x64/bin/node
"$node_bin" scripts/check.mjs
"$node_bin" --test tests/*.test.mjs
"$node_bin" --env-file=/etc/payathon-test/app.env --env-file-if-exists=/etc/payathon-test/sms-auth.env --input-type=module -e 'import { loadRuntime } from "./apps/api/runtime.mjs"; loadRuntime(); console.log("Existing runtime configuration ready");'
systemctl start payathon-backup.service
previous=$(readlink -f /opt/payathon-test/current)
ln -sfn "$release" /opt/payathon-test/current
systemctl restart payathon-test.service
if ! curl -fsS --retry 10 --retry-delay 1 --retry-connrefused --max-time 15 http://127.0.0.1:4181/api/v1/health; then
  ln -sfn "$previous" /opt/payathon-test/current
  systemctl restart payathon-test.service
  exit 1
fi
ln -sfn "$release" /opt/payathon-ops/current
systemctl start payathon-backup.service
systemctl start payathon-monitor.service
systemctl is-active payathon-test.service nginx.service payathon-backup.timer payathon-monitor.timer
