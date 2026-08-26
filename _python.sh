# Sourced by run.sh and fix-deps.sh. Finds a Python this project can actually use.
#
# macOS ships Python 3.9 as `python3` (via Command Line Tools). 3.9 reached end
# of life in October 2025 and does not support `X | None` type syntax, which
# this codebase and SQLAlchemy 2.0 both rely on. So we look for a real one
# rather than quietly failing at import time with a confusing TypeError.
MIN_MINOR=10

pick_python() {
  local candidates=(python3.13 python3.12 python3.11 python3.10 python3)
  local extra
  for extra in /opt/homebrew/bin /usr/local/bin; do
    [[ -d "$extra" ]] && candidates+=("$extra"/python3.1[0-9])
  done

  local best="" best_minor=-1 py minor
  for py in "${candidates[@]}"; do
    command -v "$py" >/dev/null 2>&1 || [[ -x "$py" ]] || continue
    minor=$("$py" -c 'import sys; print(sys.version_info[1])' 2>/dev/null) || continue
    [[ "$minor" =~ ^[0-9]+$ ]] || continue
    if (( minor >= MIN_MINOR && minor > best_minor )); then
      best="$py"; best_minor="$minor"
    fi
  done

  if [[ -z "$best" ]]; then
    cat >&2 <<MSG

  This project needs Python 3.${MIN_MINOR} or newer.

  Found: $(python3 -V 2>&1 | awk '{print $2}') - on a Mac that is the version
  Apple ships with the developer tools. It reached end of life in October 2025
  and does not support the type syntax this codebase uses.

  Install a current one, either:

      brew install python@3.12          # if you have Homebrew

  or download the macOS installer from https://www.python.org/downloads/

  Then run this script again - it will find the new one automatically. Nothing
  else needs to change, and your database in data/ is unaffected.

MSG
    return 1
  fi

  echo "$best"
}
