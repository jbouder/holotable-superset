#!/usr/bin/env bash
# M5 check, for the definition of done: saved dashboards load and refresh
# with superset-mcp stopped, the agent explains a missing LLM key instead of
# failing, and Superset holds no charts or dashboards beyond its examples
# and the opt-in M6 mirror. Restarts superset-mcp at the end.
set -euo pipefail
cd "$(dirname "$0")/.."

UI=${UI_URL:-http://localhost:3000}
SUPERSET=${SUPERSET_URL:-http://localhost:8088}
json() { python3 -c "import json,sys; d=json.load(sys.stdin); $1"; }

echo "1. Stop superset-mcp"
docker compose stop superset-mcp >/dev/null 2>&1
trap 'docker compose start superset-mcp >/dev/null 2>&1' EXIT
docker compose ps superset-mcp --format '   superset-mcp: {{.State}}' 2>/dev/null || echo "   superset-mcp: stopped"

echo "2. Saved dashboards still load and refresh"
scripts/verify-m2.sh | sed 's/^/   /'

echo "3. The agent without an LLM"
# An empty body: without an LLM the API answers 503 before reading it; with
# one it answers 400, so no agent run starts and no tokens are spent.
code=$(curl -s -o /tmp/holotable-chat.json -w '%{http_code}' -X POST "$UI/api/chat" \
  -H 'Content-Type: application/json' -d '{}')
if [ "$code" = "503" ]; then
  json "print('    503:', d['error'])" < /tmp/holotable-chat.json
else
  echo "   an LLM is configured (HTTP $code); skipped"
fi

echo "4. No Superset charts or dashboards made by the app"
# The examples load before init creates the service account, so anything
# created after that account was made by someone. The opt-in M6 mirror
# (slug holotable-*) and its charts are counted on their own. This reads the
# metadata database directly: Superset's list API caps pages at 100 rows and
# does not return creators.
docker compose exec -T superset-db psql -U "${POSTGRES_USER:-superset}" -d superset -At -F ' ' <<'SQL' |
with svc as (select created_on as t from ab_user where username = 'holotable_svc'),
mirror as (select id from dashboards where slug like 'holotable-%'),
mirror_charts as (select slice_id as id from dashboard_slices where dashboard_id in (select id from mirror))
select 'charts',
  count(*) filter (where created_on <= (select t from svc)),
  count(*) filter (where id in (select id from mirror_charts)),
  count(*) filter (where created_on > (select t from svc) and id not in (select id from mirror_charts))
from slices
union all
select 'dashboards',
  count(*) filter (where created_on <= (select t from svc)),
  count(*) filter (where id in (select id from mirror)),
  count(*) filter (where created_on > (select t from svc) and id not in (select id from mirror))
from dashboards;
SQL
  awk '{ printf "    %s %s from the examples, %s in the M6 mirror, %s made by anything else\n", $2, $1, $3, $4; if ($4 > 0) bad = 1 } END { exit bad }'

echo "M5 checks passed."
