#!/usr/bin/env bash
# Build the frontend and deploy it to Catalyst Slate (Development) as a static app.
# Never targets Production (no --production flag). The API base comes from
# frontend/.env.production; SPA routes fall back to index.html via public/_redirects.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
NAME="${SLATE_APP:-volta}"
cd "$ROOT/frontend"
npm run build
# Slate caches index.html for a year (see below), so a browser may keep an old page that asks
# for an old bundle. Never drop a hashed asset: every build's assets/ go into an archive
# (gitignored) and the whole archive ships with each deploy. Hashed names never collide.
ARCHIVE="$ROOT/.slate-assets"
mkdir -p "$ARCHIVE"
cp -n dist/assets/* "$ARCHIVE"/
cp -n "$ARCHIVE"/* dist/assets/
mkdir -p dist/.catalyst
# SPA fallback: deep links (/dashboard, /input, /history) serve index.html; _redirects alone was not honoured
printf 'framework = "static"\ndeployment_name = "default"\n\n[[redirects]]\nfrom = "/*"\nto = "/index.html"\nstatus = 200\n' > dist/.catalyst/slate-config.toml
# Slate serves every file, index.html included, with "Cache-Control: public, max-age=31536000",
# and ignored _headers and [[headers]] (tried 2026-10-27). A browser that opened an earlier
# deploy can keep its old HTML and fail on deleted assets until a hard refresh.
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
