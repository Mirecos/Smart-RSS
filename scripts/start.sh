#!/usr/bin/env bash
# Builds (if needed) and starts Smart RSS with Docker Compose, then waits until it is healthy.
#   ./scripts/start.sh             start the app
#   ./scripts/start.sh --js        also start the headless-Chromium renderer
#   ./scripts/start.sh --no-build  skip the image rebuild
source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"

profile_args=()
build_args=(--build)
for arg in "$@"; do
  case "$arg" in
    --js) profile_args=(--profile js) ;;
    --no-build) build_args=() ;;
    -h | --help) sed -n '2,5p' "$0"; exit 0 ;;
    *) echo "Unknown option: $arg (use --js, --no-build)" >&2; exit 2 ;;
  esac
done

init_env_file
assert_docker

echo "> docker compose ${profile_args[*]} up -d ${build_args[*]}"
docker compose "${profile_args[@]}" up -d "${build_args[@]}"

url="$(app_url)"
wait_healthy "$url"
echo "Smart RSS is running at $url"
