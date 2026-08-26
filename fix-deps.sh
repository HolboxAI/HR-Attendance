#!/usr/bin/env bash
# Nuclear option: delete every installed dependency and rebuild for THIS machine.
# Source code, the database and photos are untouched.
set -euo pipefail
cd "$(dirname "$0")"
# shellcheck source=_python.sh
source ./_python.sh
PY_BIN="$(pick_python)" || exit 1

echo "Removing dependencies built for another platform..."
rm -rf apps/api/.venv
rm -rf apps/web/node_modules apps/web/.next apps/web/sessions apps/web/tsconfig.tsbuildinfo
rm -rf apps/mobile/node_modules

echo "Reinstalling for $(uname -s) $(uname -m) with $("$PY_BIN" -V)..."
"$PY_BIN" -m venv apps/api/.venv
apps/api/.venv/bin/pip install -q --upgrade pip
apps/api/.venv/bin/pip install -q -r apps/api/requirements.txt
(cd apps/web && npm install --no-audit --no-fund)
(cd apps/mobile && npm install --no-audit --no-fund)

echo
echo "Done. Now run ./run.sh"
