#!/usr/bin/env bash
# Bring up the local Halqo dev stack: existing WSL MySQL/MariaDB + MinIO in Docker.
set -euo pipefail

cd "$(dirname "$0")"

if [[ ! -f .env ]]; then
  echo "infra/.env is missing. Copy infra/.env.example to infra/.env and fill it in." >&2
  exit 1
fi
set -a; source .env; set +a

# 1. Existing database server (never a container).
db_unit=""
for unit in mysql mariadb; do
  if systemctl list-unit-files "${unit}.service" >/dev/null 2>&1; then db_unit=$unit; break; fi
done
if [[ -z "$db_unit" ]]; then
  echo "No mysql/mariadb systemd unit found. Is MySQL installed in WSL?" >&2
  exit 1
fi
if ! systemctl is-active --quiet "$db_unit"; then
  echo "Starting $db_unit..."
  sudo systemctl start "$db_unit"
fi
echo "Database: $db_unit is running on localhost:3306"

# 2. MinIO.
docker compose up -d

echo -n "Waiting for MinIO"
for _ in $(seq 1 60); do
  if curl -fsS "http://localhost:9000/minio/health/live" >/dev/null 2>&1; then
    echo " ok"
    break
  fi
  echo -n "."
  sleep 1
done
curl -fsS "http://localhost:9000/minio/health/live" >/dev/null || { echo " MinIO did not become healthy" >&2; exit 1; }

cat <<EOF

Halqo dev stack is up:
  API (when running):  http://${LAN_IP}:8080
  MinIO S3:            http://${LAN_IP}:9000
  MinIO console:       http://${LAN_IP}:9001
EOF
