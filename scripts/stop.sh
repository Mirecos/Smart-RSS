#!/usr/bin/env bash
# Stops Smart RSS (and the optional renderer). Your data is kept in the "rss-data" volume.
source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"

assert_docker

# The profiles make sure the optional renderer (js) and HTTPS proxy (https) are stopped too.
echo "> docker compose --profile js --profile https down"
docker compose --profile js --profile https down
echo "Smart RSS stopped (data kept)."
