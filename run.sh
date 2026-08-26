#!/usr/bin/env bash
# Start the API and the admin dashboard.
#
#   ./run.sh          both, on localhost
#   ./run.sh --lan    also reachable from your phone on the same WiFi
#   ./run.sh --clean  force a full dependency reinstall first
#
# Dependencies are checked before use, not just assumed to exist. node_modules
# and a Python venv both contain compiled binaries for ONE operating system and
# CPU - copy a checkout between machines (or edit it over a mounted share) and
# they break with errors like "Cannot find module '../lightningcss.<platform>.node'".
# Rather than make you diagnose that, we detect it and rebuild.
set -euo pipefail
cd "$(dirname "$0")"
# shellcheck source=_python.sh
source ./_python.sh
PY_BIN="$(pick_python)" || exit 1

HOST=127.0.0.1
CLEAN=0
for arg in "$@"; do
  [[ "$arg" == "--lan" ]] && HOST=0.0.0.0
  [[ "$arg" == "--clean" ]] && CLEAN=1
done

say() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }

# --- Python API -------------------------------------------------------------
venv_ok() {
  [[ -x apps/api/.venv/bin/python ]] || return 1
  # Right platform, new enough, and the packages actually import.
  apps/api/.venv/bin/python -c "
import sys
assert sys.version_info >= (3, $MIN_MINOR)
import fastapi, sqlalchemy
" >/dev/null 2>&1
}

if [[ $CLEAN -eq 1 ]] || ! venv_ok; then
  if [[ -d apps/api/.venv ]]; then
    say "Python venv is missing, too old, or built for another platform - rebuilding"
    rm -rf apps/api/.venv
  else
    say "Setting up the Python API"
  fi
  "$PY_BIN" -m venv apps/api/.venv
  apps/api/.venv/bin/pip install -q --upgrade pip
  apps/api/.venv/bin/pip install -q -r apps/api/requirements.txt
fi

if [[ ! -f data/boxcode.db ]]; then
  say "Creating the database"
  (cd apps/api && .venv/bin/python scripts/init_db.py && .venv/bin/python scripts/seed.py)
fi

# --- Next.js dashboard ------------------------------------------------------
# Importing the CSS toolchain is the honest test: it's the native module that
# actually fails, and it fails at page-render time rather than at install.
web_ok() {
  [[ -d apps/web/node_modules ]] \
    && (cd apps/web && node -e "require('lightningcss')" >/dev/null 2>&1)
}

if [[ $CLEAN -eq 1 ]] || ! web_ok; then
  if [[ -d apps/web/node_modules ]]; then
    say "Dashboard dependencies were built for another platform - reinstalling"
    rm -rf apps/web/node_modules apps/web/.next
  else
    say "Installing dashboard dependencies"
  fi
  (cd apps/web && npm install --no-audit --no-fund)
fi

rm -rf apps/web/sessions 2>/dev/null || true

trap 'kill 0' EXIT
(cd apps/api && .venv/bin/uvicorn app.main:app --host "$HOST" --port 8000 --reload) &
(cd apps/web && npx next dev --port 3000) &

sleep 2
echo
echo "  dashboard  http://localhost:3000"
echo "  api docs   http://localhost:8000/docs"
if [[ "$HOST" == "0.0.0.0" ]]; then
  IP=$(ipconfig getifaddr en0 2>/dev/null || hostname -I 2>/dev/null | awk '{print $1}')
  echo "  phone      http://${IP:-<your-lan-ip>}:8000"
fi
echo
wait
