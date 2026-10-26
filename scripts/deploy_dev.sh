#!/usr/bin/env bash
# Build and deploy the AppSail proxy to the Catalyst Development environment.
# Never targets Production (no --production flag). Standalone deploy: secrets
# stay in the AppSail console's environment variables and survive redeploys.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
"$ROOT/scripts/build_appsail.sh"
cd "$ROOT"
catalyst deploy appsail --name microgrid-proxy --build-path "$ROOT/dist/appsail" \
  --stack python_3_11 --command "python3 main.py" -ni
