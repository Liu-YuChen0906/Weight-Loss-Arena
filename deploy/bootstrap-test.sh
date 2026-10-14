#!/usr/bin/env bash
set -euo pipefail
# Run only on the explicitly selected Ubuntu test host. No application data is copied.
test "$(id -u)" = 0
test "$(uname -m)" = x86_64
apt-get update -qq
DEBIAN_FRONTEND=noninteractive apt-get install -y -qq nginx python3-venv ca-certificates xz-utils
install -d -m 755 /opt/payathon-tools
if [ ! -x /opt/payathon-tools/node-v24.19.0-linux-x64/bin/node ]; then
  work=$(mktemp -d /tmp/payathon-node.XXXXXX)
  trap 'rm -rf "$work"' EXIT
  cd "$work"
  curl -fsS --retry 2 --connect-timeout 15 --max-time 180 -O https://nodejs.org/dist/v24.19.0/node-v24.19.0-linux-x64.tar.xz
  curl -fsS --connect-timeout 15 --max-time 60 -O https://nodejs.org/dist/v24.19.0/SHASUMS256.txt
  sha256sum --check --ignore-missing SHASUMS256.txt
  tar -xJf node-v24.19.0-linux-x64.tar.xz -C /opt/payathon-tools
fi
if [ ! -x /opt/payathon-tools/certbot/bin/certbot ]; then
  python3 -m venv /opt/payathon-tools/certbot
  /opt/payathon-tools/certbot/bin/pip --isolated install --index-url https://pypi.org/simple --disable-pip-version-check 'certbot>=5.4,<6'
fi
/opt/payathon-tools/node-v24.19.0-linux-x64/bin/node --version
/opt/payathon-tools/certbot/bin/certbot --version
if ! id payathon-test >/dev/null 2>&1; then useradd --system --home /var/lib/payathon-test --shell /usr/sbin/nologin payathon-test; fi
install -d -m 700 -o payathon-test -g payathon-test /var/lib/payathon-test
install -d -m 750 -o root -g payathon-test /etc/payathon-test
install -d -m 755 /opt/payathon-test/releases /var/lib/payathon-acme
