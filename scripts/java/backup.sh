#!/usr/bin/env bash
set -euo pipefail
umask 077
cd "$(dirname "$0")/../.."
set -a
source deploy/java/.env
set +a
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
target="var/backups/business/$stamp"
mkdir -p "$target"
docker compose --env-file deploy/java/.env -f deploy/java/compose.yml exec -T -e MYSQL_PWD="$DB_PASSWORD" mysql mysqldump -u shangcheng --single-transaction --no-tablespaces --skip-lock-tables shangcheng_java_local > "$target/business.sql"
shasum -a 256 "$target/business.sql" > "$target/SHA256SUMS"
printf 'schema=Flyway-V1\nalgorithm=bmi22-piecewise-v1\nrelease=0.1.0\n' > "$target/metadata.txt"
printf 'Business backup created: %s\nKeep the independent journal current; never restore it from this business snapshot.\n' "$target"
