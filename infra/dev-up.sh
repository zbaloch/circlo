#!/usr/bin/env bash
# Bring up the local Circlo dev stack inside Debian WSL: existing MySQL/MariaDB + MinIO in Docker.
# From Windows, run infra/dev-up.ps1 instead (it calls this script and keeps WSL awake).
set -euo pipefail

cd "$(dirname "$0")"

if [[ ! -f .env ]]; then
  echo "infra/.env is missing. Copy infra/.env.example to infra/.env and fill it in." >&2
  exit 1
fi
set -a; source <(tr -d '\r' < .env); set +a
MINIO_CONTAINER=${MINIO_CONTAINER:-circlo-minio}

# 1. Existing database server (never a container).
db_unit=""
for unit in mariadb mysql; do
  if systemctl cat "${unit}.service" >/dev/null 2>&1; then db_unit=$unit; break; fi
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

# 2. MinIO: reuse $MINIO_CONTAINER if it exists, otherwise start the compose service.
if docker inspect "$MINIO_CONTAINER" >/dev/null 2>&1; then
  docker start "$MINIO_CONTAINER" >/dev/null
elif [[ "$MINIO_CONTAINER" == "circlo-minio" ]]; then
  docker compose up -d
else
  echo "Container $MINIO_CONTAINER (from MINIO_CONTAINER in infra/.env) does not exist." >&2
  exit 1
fi

echo -n "Waiting for MinIO"
for _ in $(seq 1 60); do
  if curl -fsS "http://localhost:9000/minio/health/live" >/dev/null 2>&1; then break; fi
  echo -n "."
  sleep 1
done
curl -fsS "http://localhost:9000/minio/health/live" >/dev/null || { echo " MinIO did not become healthy" >&2; exit 1; }
echo " ok"

# 3. Buckets (private) and the non-root app user. Idempotent.
mc() { docker exec -e "MC_HOST_local=http://${MINIO_ROOT_USER}:${MINIO_ROOT_PASSWORD}@localhost:9000" "$MINIO_CONTAINER" mc "$@"; }
mc mb --ignore-existing local/circlo-media local/circlo-media-test >/dev/null
mc anonymous set none local/circlo-media >/dev/null
mc anonymous set none local/circlo-media-test >/dev/null
if ! mc admin user info local "$MINIO_APP_USER" >/dev/null 2>&1; then
  mc admin user add local "$MINIO_APP_USER" "$MINIO_APP_PASSWORD" >/dev/null
fi
mc admin policy attach local readwrite --user "$MINIO_APP_USER" >/dev/null 2>&1 || true
echo "Buckets circlo-media, circlo-media-test and user $MINIO_APP_USER are ready"

cat <<EOF

Circlo dev stack is up:
  API (when running):  http://${LAN_IP}:8080
  MinIO S3:            http://${LAN_IP}:9000
  MinIO console:       http://${LAN_IP}:9001
EOF
