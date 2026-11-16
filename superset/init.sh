#!/usr/bin/env bash
# One-shot Superset setup. Safe to run again: every step is idempotent.
set -euo pipefail

echo "[init] migrating metadata database"
superset db upgrade

echo "[init] creating admin user (skipped if present)"
superset fab create-admin \
  --username "$SUPERSET_ADMIN_USERNAME" \
  --firstname Superset --lastname Admin \
  --email admin@holotable.local \
  --password "$SUPERSET_ADMIN_PASSWORD" || true

echo "[init] syncing roles and permissions"
superset init

if ! python /app/holotable/init_service_account.py --examples-loaded; then
  echo "[init] loading example data (first run only)"
  superset load_examples
fi

echo "[init] creating read-only service account"
python /app/holotable/init_service_account.py

echo "[init] done"
