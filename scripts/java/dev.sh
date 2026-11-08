#!/usr/bin/env bash
# Local development: Docker runs MySQL/Redis; host Java/Node run the application.
set -euo pipefail
cd "$(dirname "$0")/../.."
project_root="$PWD"
if ! command -v docker >/dev/null && [[ -x /Applications/Docker.app/Contents/Resources/bin/docker ]]; then
  export PATH="/Applications/Docker.app/Contents/Resources/bin:$PATH"
fi
if ! docker info >/dev/null 2>&1; then
  printf 'Please open Docker Desktop and wait until its engine is running.\n' >&2
  exit 1
fi
if [[ -d "$project_root/.tools/amazon-corretto-21.jdk/Contents/Home" ]]; then
  export JAVA_HOME="$project_root/.tools/amazon-corretto-21.jdk/Contents/Home"
  export PATH="$JAVA_HOME/bin:$PATH"
fi
if ! command -v node >/dev/null && [[ -x "$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node" ]]; then
  export PATH="$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH"
fi
if ! command -v node >/dev/null || ! java -version >/dev/null 2>&1; then
  printf 'Java 21 and Node 24 are required.\n' >&2
  exit 1
fi
if [[ ! -f deploy/java/.env ]]; then
  python3 scripts/java/configure.py
fi
if [[ ! -d apps/web-vue/node_modules ]]; then
  printf 'Install frontend dependencies with pnpm --dir apps/web-vue install --frozen-lockfile first.\n' >&2
  exit 1
fi
set -a
source deploy/java/.env
set +a
docker compose --env-file deploy/java/.env -f deploy/java/compose.yml up -d --wait mysql redis
if [[ -x .tools/apache-maven-3.9.11/bin/mvn ]]; then
  .tools/apache-maven-3.9.11/bin/mvn -B "-Dmaven.repo.local=$project_root/.tools/m2" -f apps/java-api/pom.xml package -DskipTests
else
  apps/java-api/mvnw -B -f apps/java-api/pom.xml package -DskipTests
fi
export APP_ORIGIN=http://localhost:5173
export EXPOSE_INSTANCE=true
export APP_MODE=local
mkdir -p var/logs
processes=()
cleanup() {
  for process in "${processes[@]}"; do kill "$process" 2>/dev/null || true; done
  wait || true
}
trap cleanup EXIT
trap 'exit 130' INT TERM
PORT=8080 INSTANCE_ID=java-1 java -jar apps/java-api/target/shangcheng-api-0.1.0.jar >var/logs/api-1.log 2>&1 &
processes+=("$!")
PORT=8081 INSTANCE_ID=java-2 java -jar apps/java-api/target/shangcheng-api-0.1.0.jar >var/logs/api-2.log 2>&1 &
processes+=("$!")
ready=0
for attempt in {1..60}; do
  if curl -fsS --max-time 2 http://localhost:8080/api/v1/health >/dev/null 2>&1 && curl -fsS --max-time 2 http://localhost:8081/api/v1/health >/dev/null 2>&1; then ready=1; break; fi
  if ! kill -0 "${processes[0]}" 2>/dev/null || ! kill -0 "${processes[1]}" 2>/dev/null; then break; fi
  sleep 1
done
if [[ "$ready" != 1 ]]; then
  printf 'Java did not become ready. Inspect var/logs/api-1.log and api-2.log.\n' >&2
  exit 1
fi
printf '\nOpen http://localhost:5173/ . Keep this terminal open. Ctrl+C stops only these app processes; database data is retained.\n'
existing_frontend="$(curl -fsS --max-time 2 http://localhost:5173/ 2>/dev/null || true)"
if [[ "$existing_frontend" == *'<title>上秤'* ]]; then
  printf 'Reusing the existing local Shangcheng frontend on port 5173.\n'
  wait "${processes[0]}"
  exit 0
fi
(cd apps/web-vue && exec node node_modules/vite/bin/vite.js --host 127.0.0.1 --strictPort) &
processes+=("$!")
wait "${processes[2]}"
