#!/usr/bin/env bash
# Assemble the AppSail bundle in dist/appsail: our code, a version stamp, and
# Linux x86-64 (glibc 2.28+) wheels for Python 3.11 (AppSail runs Linux AMD64; Python AppSail
# does not install packages, so they ship inside the bundle).
#
# Usage: scripts/build_appsail.sh     then deploy with scripts/deploy_dev.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/dist/appsail"

rm -rf "$OUT"
mkdir -p "$OUT/backend" "$OUT/model"
cp "$ROOT"/backend/*.py "$OUT/backend/"
cp "$ROOT"/model/{__init__,data,features,quickml_client}.py "$OUT/model/"
cp "$ROOT/sample_test_input.csv" "$OUT/"  # served by GET /api/sample
git -C "$ROOT" describe --always --dirty > "$OUT/version.txt"
cat > "$OUT/main.py" <<'PY'
from backend.app import main

main()
PY

uv pip install --quiet --target "$OUT" \
  --python-platform x86_64-manylinux_2_28 --python-version 3.11 --only-binary :all: \
  -r "$ROOT/backend/requirements.txt"

# Trim what the runtime never loads.
find "$OUT" -type d \( -name __pycache__ -o -name tests \) -prune -exec rm -rf {} +
rm -rf "$OUT/bin"

echo "Built $OUT ($(du -sh "$OUT" | cut -f1), version $(cat "$OUT/version.txt"))"
