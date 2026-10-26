#!/usr/bin/env bash
# Build the frontend and deploy it to Catalyst Slate (Development) as a static app.
# Never targets Production (no --production flag). The API base comes from
# frontend/.env.production; SPA routes fall back to index.html via public/_redirects.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
NAME="${SLATE_APP:-volta}"
cd "$ROOT/frontend"
npm run build
mkdir -p dist/.catalyst
# SPA fallback: deep links (/dashboard, /input, /history) serve index.html; _redirects alone was not honoured
printf 'framework = "static"\ndeployment_name = "default"\n\n[[redirects]]\nfrom = "/*"\nto = "/index.html"\nstatus = 200\n' > dist/.catalyst/slate-config.toml
# Slate's static mode served 404 for deep links despite both redirect configs above, so
# each app route also gets its own copy of index.html (assets are root-absolute, /assets/...).
for route in dashboard input history; do
  mkdir -p "dist/$route" && cp dist/index.html "dist/$route/index.html"
done
cd "$ROOT"
if ! grep -q "\"$NAME\"" catalyst.json 2>/dev/null; then
  catalyst slate:link --source "$ROOT/frontend/dist" --name "$NAME" --framework static -ni
fi
catalyst deploy slate "$NAME" -m "volta $(git describe --tags --always --dirty)" -ni
