#!/usr/bin/env bash
# Leaked-database drill (PLAN.md Phase 12). Run in WSL from infra/:
#   ./leak-drill.sh [markers.txt] [server.log]
# Dumps the halqo database and every object in the halqo-media bucket to a temporary directory, as a thief with a
# copy of both would have them (but without the server's secrets), scans them with leak_drill.py, then deletes the
# copy. markers.txt lists text you typed into the app while testing (handles, names, posts, messages), one per
# line; keep it outside the repo.
set -euo pipefail
cd "$(dirname "$0")"
markers="${1:-}"
log="${2:-}"

set -a
source <(tr -d '\r' < .env)
source <(tr -d '\r' < ../server/.env | grep -E '^HALQO_(DB_USER|DB_PASSWORD|S3_BUCKET)=')
set +a
MINIO_CONTAINER=${MINIO_CONTAINER:-halqo-minio}
bucket=${HALQO_S3_BUCKET:-halqo-media}

out="$(mktemp -d)"
trap 'rm -rf "$out"' EXIT
mkdir -p "$out/objects"

echo "Dumping database halqo…"
MYSQL_PWD="$HALQO_DB_PASSWORD" mariadb-dump -h 127.0.0.1 -u "$HALQO_DB_USER" --single-transaction --skip-comments halqo > "$out/db.sql"

echo "Copying bucket $bucket…"
mc() { docker exec -e "MC_HOST_local=http://${MINIO_ROOT_USER}:${MINIO_ROOT_PASSWORD}@localhost:9000" "$MINIO_CONTAINER" mc "$@"; }
mc ls --recursive --json "local/$bucket" | python3 -c 'import json,sys
for l in sys.stdin:
    k = json.loads(l).get("key")
    if k: print(k)' | while read -r key; do
  mkdir -p "$out/objects/$(dirname "$key")"
  mc cat "local/$bucket/$key" > "$out/objects/$key"
done

args=(--dump "$out/db.sql" --objects "$out/objects")
[ -n "$markers" ] && args+=(--markers "$markers")
[ -n "$log" ] && args+=(--log "$log")
python3 leak_drill.py "${args[@]}"
