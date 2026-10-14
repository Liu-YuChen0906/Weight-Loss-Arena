#!/usr/bin/env bash
set -euo pipefail
cd /opt/payathon-test/current
test -s /etc/letsencrypt/live/101.132.150.197/fullchain.pem
install -m 644 deploy/nginx-test.conf /etc/nginx/sites-available/payathon-test
nginx -t
systemctl reload nginx
install -d -m 755 /etc/letsencrypt/renewal-hooks/deploy
install -m 755 deploy/reload-nginx.sh /etc/letsencrypt/renewal-hooks/deploy/payathon-nginx.sh
install -m 644 deploy/payathon-cert-renew.service /etc/systemd/system/payathon-cert-renew.service
install -m 644 deploy/payathon-cert-renew.timer /etc/systemd/system/payathon-cert-renew.timer
systemctl daemon-reload
systemctl enable --now payathon-cert-renew.timer
systemctl is-active payathon-test.service nginx.service payathon-cert-renew.timer
