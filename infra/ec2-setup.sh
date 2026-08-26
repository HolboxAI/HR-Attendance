#!/usr/bin/env bash
# Boxcode HRMS - one-time server setup (Ubuntu 22.04/24.04).
#
# Sized for under 60 employees: Postgres and the API share one small instance.
# At this scale that is not a compromise, it is the correct answer - a t3.small
# will sit near-idle all day.
#
#   sudo bash ec2-setup.sh
#
# Read it before running it. It touches firewall rules and creates a database.
set -euo pipefail

DB_NAME="${DB_NAME:-boxcode_hrms}"
DB_USER="${DB_USER:-boxcode}"
APP_DIR="${APP_DIR:-/opt/boxcode-hrms}"
APP_USER="${APP_USER:-boxcode}"

log() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }

[[ $EUID -eq 0 ]] || { echo "Run with sudo."; exit 1; }

log "Packages"
apt-get update -qq
apt-get install -y -qq postgresql postgresql-contrib python3-venv python3-pip \
  nginx certbot python3-certbot-nginx ufw git

log "Database"
DB_PASS="$(openssl rand -base64 24 | tr -d '/+=' | head -c 24)"
sudo -u postgres psql -v ON_ERROR_STOP=1 <<SQL
DO \$\$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${DB_USER}') THEN
    CREATE ROLE ${DB_USER} LOGIN PASSWORD '${DB_PASS}';
  END IF;
END \$\$;
SELECT 'CREATE DATABASE ${DB_NAME} OWNER ${DB_USER}'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = '${DB_NAME}')\gexec
SQL

log "Postgres tuning for a 2GB instance"
PG_VER="$(ls /etc/postgresql | sort -V | tail -1)"
PG_CONF="/etc/postgresql/${PG_VER}/main/postgresql.conf"
set_pg() { sed -i "s|^#\?${1} =.*|${1} = ${2}|" "$PG_CONF"; }
set_pg shared_buffers            "512MB"
set_pg effective_cache_size      "1GB"
set_pg work_mem                  "8MB"
set_pg maintenance_work_mem      "128MB"
set_pg max_connections           "50"
# Keep Postgres on localhost. The API is the only thing that should reach it;
# a database listening on a public IP is how small companies get ransomed.
set_pg listen_addresses          "'localhost'"
systemctl restart postgresql

log "App user and directory"
id -u "$APP_USER" &>/dev/null || useradd -r -m -d "$APP_DIR" -s /bin/bash "$APP_USER"
mkdir -p "$APP_DIR"
chown -R "$APP_USER:$APP_USER" "$APP_DIR"

log "Systemd service"
cat > /etc/systemd/system/boxcode-api.service <<UNIT
[Unit]
Description=Boxcode HRMS API
After=network.target postgresql.service
Requires=postgresql.service

[Service]
Type=simple
User=${APP_USER}
WorkingDirectory=${APP_DIR}/apps/api
EnvironmentFile=${APP_DIR}/apps/api/.env
ExecStart=${APP_DIR}/apps/api/.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000 --workers 2
Restart=always
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload

log "nginx reverse proxy"
cat > /etc/nginx/sites-available/boxcode-hrms <<'NGINX'
server {
    listen 80;
    server_name _;
    client_max_body_size 8M;          # selfies

    location / {
        proxy_pass         http://127.0.0.1:8000;
        proxy_set_header   Host $host;
        proxy_set_header   X-Real-IP $remote_addr;
        proxy_set_header   X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
        proxy_read_timeout 60s;
    }
}
NGINX
ln -sf /etc/nginx/sites-available/boxcode-hrms /etc/nginx/sites-enabled/boxcode-hrms
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx

log "Firewall"
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw --force enable

cat <<DONE

  Done.

  DATABASE_URL=postgresql+psycopg://${DB_USER}:${DB_PASS}@localhost:5432/${DB_NAME}

  Write that into ${APP_DIR}/apps/api/.env - it is shown once and not stored
  anywhere else by this script.

  Still to do:
    1. Clone the repo into ${APP_DIR}
    2. python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
    3. alembic upgrade head
    4. systemctl enable --now boxcode-api
    5. certbot --nginx -d <your-domain>   (the mobile app needs real TLS)

  Security group: allow 22 and 443 only. Postgres is bound to localhost and
  must stay that way.

DONE
