#!/usr/bin/env bash
# Stops then starts Smart RSS. Accepts the same options as start.sh (--js, --no-build).
set -euo pipefail
SCRIPTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

"$SCRIPTS_DIR/stop.sh"
"$SCRIPTS_DIR/start.sh" "$@"
