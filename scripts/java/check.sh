#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
apps/java-api/mvnw -B -f apps/java-api/pom.xml verify
pnpm --dir apps/web-vue test
pnpm --dir apps/web-vue build
