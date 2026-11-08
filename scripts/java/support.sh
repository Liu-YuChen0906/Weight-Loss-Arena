#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
if [[ "${1:-}" == list ]]; then
  docker compose --env-file deploy/java/.env -f deploy/java/compose.yml run --rm --no-deps api-1 --server.port=0 --tool.support=list
elif [[ "${1:-}" == resolve && -n "${2:-}" && -n "${3:-}" ]]; then
  docker compose --env-file deploy/java/.env -f deploy/java/compose.yml run --rm --no-deps api-1 --server.port=0 --tool.support=resolve "--tool.id=$2" "--tool.operator=$3"
else
  printf 'Usage: support.sh list | support.sh resolve BUSINESS_ID OPERATOR_ID\n' >&2
  exit 2
fi
