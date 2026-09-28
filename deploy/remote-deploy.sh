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

env_value() { grep -E "^$1=" .env | tail -n 1 | cut -d= -f2- | tr -d "\"'" || true; }

# Routing through an existing caddy-docker-proxy: its network must exist, and the built-in Caddy
# must stay off (both would want ports 80/443).
if [[ "$(env_value COMPOSE_FILE)" == *caddy-docker-proxy* ]]; then
  network="$(env_value CADDY_NETWORK)"; network="${network:-caddy}"
  docker network inspect "$network" >/dev/null 2>&1 \
    || fail "Docker network '${network}' not found. Set CADDY_NETWORK to the network of your caddy-docker-proxy (see: docker network ls)"
  [[ ",$(env_value COMPOSE_PROFILES)," != *,https,* ]] \
    || fail "Remove 'https' from COMPOSE_PROFILES: your caddy-docker-proxy is already the HTTPS proxy"
  [ -n "$(env_value DOMAIN)" ] || fail "DOMAIN must be set for caddy-docker-proxy routing"
fi

image="$(env_value APP_IMAGE)"
[ -n "$image" ] || fail "APP_IMAGE is not set in .env"
echo "Deploying ${image}"

if [ "${SKIP_PULL:-0}" != "1" ]; then
  token=""
  if [ -n "$REGISTRY_USER" ] && [ ! -t 0 ]; then token="$(cat)"; fi
  if [ -n "$token" ]; then
    # Log in with a throw-away Docker config: nothing is written to the user's home folder (which may
    # not be writable) and the registry token never stays on the server.
    auth_dir="$(mktemp -d)"
    trap 'rm -rf "$auth_dir"' EXIT
    # Keep per-user CLI plugins (e.g. a docker compose installed in ~/.docker/cli-plugins) usable.
    if [ -d "${HOME:-/nonexistent}/.docker/cli-plugins" ]; then ln -s "$HOME/.docker/cli-plugins" "$auth_dir/cli-plugins"; fi
    export DOCKER_CONFIG="$auth_dir"
    printf '%s' "$token" | docker login ghcr.io -u "$REGISTRY_USER" --password-stdin >/dev/null 2>&1 \
      || fail "Could not log in to ghcr.io with the workflow token"
  fi
  docker compose pull --quiet
  if [ -n "$token" ]; then
    unset DOCKER_CONFIG
    rm -rf "$auth_dir"
  fi
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
