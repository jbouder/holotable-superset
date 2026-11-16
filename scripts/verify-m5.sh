#!/usr/bin/env bash
# M5 check, for the definition of done: saved dashboards load and refresh
# with superset-mcp stopped, the agent explains a missing LLM key instead of
# failing, and Superset holds no charts or dashboards. Restarts superset-mcp
# at the end.
set -euo pipefail
cd "$(dirname "$0")/.."

UI=${UI_URL:-http://localhost:3000}
SUPERSET=${SUPERSET_URL:-http://localhost:8088}
ADMIN_USER=${SUPERSET_ADMIN_USERNAME:-admin}
ADMIN_PASS=${SUPERSET_ADMIN_PASSWORD:-admin}
json() { python3 -c "import json,sys; d=json.load(sys.stdin); $1"; }

echo "1. Stop superset-mcp"
docker compose stop superset-mcp >/dev/null 2>&1
trap 'docker compose start superset-mcp >/dev/null 2>&1' EXIT
docker compose ps superset-mcp --format '   superset-mcp: {{.State}}' 2>/dev/null || echo "   superset-mcp: stopped"

echo "2. Saved dashboards still load and refresh"
scripts/verify-m2.sh | sed 's/^/   /'

echo "3. The agent without an LLM"
code=$(curl -s -o /tmp/holotable-chat.json -w '%{http_code}' -X POST "$UI/api/chat" \
  -H 'Content-Type: application/json' -d '{"message":"hello"}')
if [ "$code" = "503" ]; then
  json "print('    503:', d['error'])" < /tmp/holotable-chat.json
else
  echo "   an LLM is configured (HTTP $code); skipped"
fi

echo "4. Superset holds no charts or dashboards"
token=$(curl -fsS -X POST "$SUPERSET/api/v1/security/login" -H 'Content-Type: application/json' \
  -d "{\"username\":\"$ADMIN_USER\",\"password\":\"$ADMIN_PASS\",\"provider\":\"db\"}" | json "print(d['access_token'])")
for kind in chart dashboard; do
  curl -fsS "$SUPERSET/api/v1/$kind/?q=(page_size:1)" -H "Authorization: Bearer $token" |
    json "n = d['count']; print(f'    {n} ${kind}s'); sys.exit(1 if n else 0)"
done

echo "M5 checks passed."
