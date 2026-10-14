#!/usr/bin/env bash
set -euo pipefail
test "$(id -u)" = 0
release="/opt/payathon-test/releases/$(date -u +%Y%m%dT%H%M%SZ)"
install -d -m 755 "$release"
tar -xzf /tmp/payathon-test-release.tgz --exclude='*/._*' -C "$release"
cd "$release"
/opt/payathon-tools/node-v24.19.0-linux-x64/bin/node scripts/check.mjs
/opt/payathon-tools/node-v24.19.0-linux-x64/bin/node --test tests/*.test.mjs
if [ -e /etc/payathon-test/accounts.json ]; then
  if [ -e /tmp/payathon-test-accounts.json ]; then cmp /tmp/payathon-test-accounts.json /etc/payathon-test/accounts.json; fi
else
  install -m 640 -o root -g payathon-test /tmp/payathon-test-accounts.json /etc/payathon-test/accounts.json
fi
rm -f /tmp/payathon-test-accounts.json
install -m 640 -o root -g payathon-test deploy/test.env.example /etc/payathon-test/app.env
test ! -e /opt/payathon-test/current || test -L /opt/payathon-test/current
ln -sfn "$release" /opt/payathon-test/current
install -m 644 deploy/payathon-test.service /etc/systemd/system/payathon-test.service
systemctl daemon-reload
systemctl enable payathon-test.service
systemctl restart payathon-test.service
curl -fsS --retry 10 --retry-delay 1 --retry-connrefused --max-time 15 http://127.0.0.1:4181/api/v1/health
if [ -s /etc/letsencrypt/live/101.132.150.197/fullchain.pem ]; then
  install -m 644 deploy/nginx-test.conf /etc/nginx/sites-available/payathon-test
else
  install -m 644 deploy/nginx-test-http.conf /etc/nginx/sites-available/payathon-test
fi
ln -sfn /etc/nginx/sites-available/payathon-test /etc/nginx/sites-enabled/payathon-test
nginx -t
systemctl reload nginx
install -d -m 755 /var/lib/payathon-acme/.well-known/acme-challenge
printf '%s\n' 'payathon-test-acme-ready' > /var/lib/payathon-acme/.well-known/acme-challenge/payathon-readiness
