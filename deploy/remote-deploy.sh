#!/usr/bin/env bash
# Runs ON THE SERVER (called over SSH by the Deploy workflow, or by hand):
#   bash deploy/remote-deploy.sh [registry-user]     # registry token read from stdin (optional)
# Pulls the image named by APP_IMAGE in .env, restarts the stack and waits until the app is healthy.
# Set SKIP_PULL=1 to restart with an image that is already present on the server.
set -euo pipefail

cd "$(dirname "$0")/.."
REGISTRY_USER="${1:-}"
HEALTH_TIMEOUT_SECONDS="${HEALTH_TIMEOUT_SECONDS:-120}"

fail() {
  echo "ERROR: $*" >&2
  exit 1
}

[ -f .env ] || fail "$(pwd)/.env is missing"
[ -f docker-compose.yml ] || fail "$(pwd)/docker-compose.yml is missing"
command -v docker >/dev/null || fail "Docker is not installed on this server"
docker compose version >/dev/null 2>&1 || fail "The Docker Compose plugin is not installed on this server"

image="$(grep -E '^APP_IMAGE=' .env | tail -n 1 | cut -d= -f2- || true)"
[ -n "$image" ] || fail "APP_IMAGE is not set in .env"
echo "Deploying ${image}"

if [ "${SKIP_PULL:-0}" != "1" ]; then
  token=""
  if [ -n "$REGISTRY_USER" ] && [ ! -t 0 ]; then token="$(cat)"; fi
  if [ -n "$token" ]; then
    printf '%s' "$token" | docker login ghcr.io -u "$REGISTRY_USER" --password-stdin >/dev/null
  fi
  docker compose pull --quiet
  if [ -n "$token" ]; then docker logout ghcr.io >/dev/null 2>&1 || true; fi
fi

# --no-build: on the server the image always comes from the registry, never from local sources.
docker compose up -d --no-build --remove-orphans

container="$(docker compose ps -q app)"
[ -n "$container" ] || fail "The app container did not start"
deadline=$((SECONDS + HEALTH_TIMEOUT_SECONDS))
status=""
until [ "$status" = "healthy" ]; do
  status="$(docker inspect -f '{{.State.Health.Status}}' "$container" 2>/dev/null || echo unknown)"
  if [ "$SECONDS" -ge "$deadline" ]; then
    docker compose logs --tail 60 app >&2 || true
    fail "The app is not healthy after ${HEALTH_TIMEOUT_SECONDS}s (status: ${status})"
  fi
  [ "$status" = "healthy" ] || sleep 3
done

# Keep a week of old images around for quick manual rollbacks.
docker image prune -f --filter "until=168h" >/dev/null 2>&1 || true
echo "Smart RSS is healthy (${image})"
