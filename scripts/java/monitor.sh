#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
curl -fsS --max-time 10 http://localhost:8088/api/v1/health
if ! find var/backups/business -name business.sql -mmin -120 -print -quit 2>/dev/null | read -r _; then
  printf '\nNo business backup from the past two hours.\n' >&2
  exit 1
fi
