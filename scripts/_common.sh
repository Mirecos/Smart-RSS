#!/usr/bin/env bash
# Shared helpers for start.sh / stop.sh / restart.sh (sourced, not run directly).
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT"

init_env_file() {
  if [ ! -f .env ]; then
    cp .env.example .env
    echo "Created .env from .env.example (edit it to change settings)."
  fi
}

# env_value NAME DEFAULT - reads NAME=value from .env, falls back to DEFAULT when missing or empty.
env_value() {
  local value=""
  if [ -f .env ]; then
    value="$(grep -E "^[[:space:]]*$1[[:space:]]*=" .env | tail -n 1 | cut -d= -f2- | tr -d "\r\"'" | xargs || true)"
  fi
  echo "${value:-$2}"
}

assert_docker() {
  if ! docker info >/dev/null 2>&1; then
    echo "Docker is not running. Start Docker (Desktop), then try again." >&2
    exit 1
  fi
}

app_url() {
  local host
  host="$(env_value BIND_ADDRESS 127.0.0.1)"
  [ "$host" = "0.0.0.0" ] && host="127.0.0.1"
  echo "http://${host}:$(env_value PORT 8080)"
}

wait_healthy() {
  local url="$1" timeout="${2:-120}"
  local deadline=$((SECONDS + timeout))
  printf "Waiting for the app to become healthy"
  until curl -fsS "$url/api/health" >/dev/null 2>&1; do
    if [ "$SECONDS" -ge "$deadline" ]; then
      echo
      echo "The app did not become healthy within ${timeout}s. Check the logs: docker compose logs app" >&2
      exit 1
    fi
    printf "."
    sleep 2
  done
  echo " ok"
}
