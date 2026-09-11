#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# deploy.sh  –  One-command deploy to EC2
#
#   ./deploy.sh                    # auto-finds PEM, pulls & rebuilds
#   ./deploy.sh -k ~/my-key.pem   # explicit key path
#
# What it does on the server:
#   1. git pull (latest code)
#   2. npm install (picks up new deps like @paper-design/shaders)
#   3. npm run build
#   4. restarts Next.js (pm2 or systemd, whichever is running)
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

# ── config ───────────────────────────────────────────────────────────────────
EC2_HOST="98.84.138.15"
EC2_USER="ubuntu"
# Common places your PEM might live — tried in order.
PEM_CANDIDATES=(
  "$HOME/Downloads/boxcode-hrms.pem"
  "$HOME/Downloads/boxcode.pem"
  "$HOME/Desktop/boxcode-hrms.pem"
  "$HOME/.ssh/boxcode-hrms.pem"
  "$HOME/.ssh/boxcode.pem"
  "$HOME/.ssh/id_rsa"
  "$HOME/.ssh/id_ed25519"
)

# ── argument parsing ──────────────────────────────────────────────────────────
KEY_FILE=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    -k|--key) KEY_FILE="$2"; shift 2 ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

# ── find key ─────────────────────────────────────────────────────────────────
if [[ -z "$KEY_FILE" ]]; then
  for f in "${PEM_CANDIDATES[@]}"; do
    if [[ -f "$f" ]]; then
      KEY_FILE="$f"
      break
    fi
  done
fi

if [[ -z "$KEY_FILE" ]]; then
  echo ""
  echo "❌  Could not find your EC2 key file automatically."
  echo "    Run with:  ./deploy.sh -k /path/to/your-key.pem"
  echo ""
  exit 1
fi

chmod 600 "$KEY_FILE"   # SSH refuses keys that are world-readable

say()  { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
ok()   { printf '\033[1;32m✔  %s\033[0m\n' "$*"; }
fail() { printf '\033[1;31m✘  %s\033[0m\n' "$*" >&2; }

SSH="ssh -i $KEY_FILE -o StrictHostKeyChecking=no -o ConnectTimeout=10 $EC2_USER@$EC2_HOST"

# ── test connection ───────────────────────────────────────────────────────────
say "Connecting to EC2 ($EC2_HOST)…"
if ! $SSH "echo ok" &>/dev/null; then
  fail "Cannot connect. Check your key and security group (port 22 open?)."
  exit 1
fi
ok "Connected with key: $KEY_FILE"

# ── find app directory on server ──────────────────────────────────────────────
say "Locating app directory on server…"
APP_DIR=$($SSH "
  for d in /opt/boxcode-hrms ~/boxcode-hrms ~/app /home/ubuntu/boxcode-hrms; do
    if [[ -d \"\$d/myco-frontend/web\" ]]; then echo \"\$d\"; break; fi
  done
")

if [[ -z "$APP_DIR" ]]; then
  fail "Could not find app directory on server. Is the repo cloned?"
  exit 1
fi
ok "App found at: $APP_DIR"

WEB_DIR="$APP_DIR/myco-frontend/web"

# ── deploy ────────────────────────────────────────────────────────────────────
say "Pulling latest code…"
$SSH "cd '$APP_DIR' && git pull --ff-only"
ok "git pull done"

say "Installing npm dependencies (includes @paper-design/shaders)…"
$SSH "cd '$WEB_DIR' && npm install --no-audit --no-fund"
ok "npm install done"

say "Building Next.js…"
$SSH "cd '$WEB_DIR' && npm run build"
ok "Build complete"

# ── restart Next.js ───────────────────────────────────────────────────────────
say "Restarting Next.js server…"
$SSH "
  # Try pm2 first
  if command -v pm2 &>/dev/null; then
    # Restart whichever pm2 process is serving the Next.js app
    PM2_NAME=\$(pm2 jlist 2>/dev/null | python3 -c \"
import sys, json
procs = json.load(sys.stdin)
for p in procs:
    if 'next' in p.get('name','').lower() or 'web' in p.get('name','').lower():
        print(p['name']); break
\" 2>/dev/null || true)
    if [[ -n \"\$PM2_NAME\" ]]; then
      pm2 restart \"\$PM2_NAME\"
      echo \"Restarted pm2 process: \$PM2_NAME\"
    else
      # Try common names
      pm2 restart next-web 2>/dev/null \
        || pm2 restart web 2>/dev/null \
        || pm2 restart next 2>/dev/null \
        || { echo 'pm2: no matching process found, starting fresh'; pm2 start 'npm -- start' --name next-web --cwd '$WEB_DIR'; }
    fi
  # Try systemd
  elif systemctl is-active --quiet boxcode-web 2>/dev/null; then
    sudo systemctl restart boxcode-web
    echo 'Restarted systemd: boxcode-web'
  elif systemctl is-active --quiet next-web 2>/dev/null; then
    sudo systemctl restart next-web
    echo 'Restarted systemd: next-web'
  else
    # Nuclear option: kill whatever is on port 3000 and start fresh
    fuser -k 3000/tcp 2>/dev/null || true
    sleep 1
    nohup bash -c 'cd $WEB_DIR && npm start > /tmp/next.log 2>&1 &' &
    echo 'Started Next.js on port 3000 (nohup)'
  fi
"
ok "Next.js restarted ✨"

echo ""
echo "─────────────────────────────────────────────────────"
echo "🚀  Deploy complete!"
echo "    Live:   http://$EC2_HOST:3000/login"
echo "    Demo:   http://$EC2_HOST:3000/demo"
echo "─────────────────────────────────────────────────────"
echo ""
