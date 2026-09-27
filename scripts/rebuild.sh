#!/usr/bin/env bash
# Stops Smart RSS, rebuilds the image from scratch (fresh base images), then starts it again.
# Your data is kept. Use it after pulling new code or when a normal restart does not pick up changes.
#   ./scripts/rebuild.sh             rebuild with fresh base images, reusing the build cache
#   ./scripts/rebuild.sh --no-cache  full rebuild, ignoring the build cache (slower)
#   ./scripts/rebuild.sh --js        also start the headless-Chromium renderer afterwards
source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"
SCRIPTS_DIR="$PROJECT_ROOT/scripts"

cache_args=()
start_args=(--no-build)
for arg in "$@"; do
  case "$arg" in
    --no-cache) cache_args=(--no-cache) ;;
    --js) start_args+=(--js) ;;
    -h | --help) sed -n '2,7p' "$0"; exit 0 ;;
    *) echo "Unknown option: $arg (use --no-cache, --js)" >&2; exit 2 ;;
  esac
done

init_env_file
assert_docker

"$SCRIPTS_DIR/stop.sh"

echo "> docker compose build --pull ${cache_args[*]}"
if ! docker compose build --pull "${cache_args[@]}"; then
  echo "docker compose build failed. The app is stopped; fix the error and run this script again." >&2
  exit 1
fi

"$SCRIPTS_DIR/start.sh" "${start_args[@]}"
