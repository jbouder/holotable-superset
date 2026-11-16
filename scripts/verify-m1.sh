#!/usr/bin/env bash
# M1 check: Superset is healthy, its MCP server lists tools, and the service
# account can see example datasets and run a chart data query over REST.
set -euo pipefail

SUPERSET=${SUPERSET_URL:-http://localhost:8088}
MCP=${SUPERSET_MCP_URL:-http://localhost:5008/mcp}
USER=${SUPERSET_SERVICE_USERNAME:-holotable_svc}
PASS=${SUPERSET_SERVICE_PASSWORD:-holotable_svc}

json() { python3 -c "import json,sys; d=json.load(sys.stdin); $1"; }
# MCP streamable HTTP may answer as SSE; keep only the JSON payload.
mcp_body() { python3 -c "
import sys
raw = sys.stdin.read()
lines = [l[5:].strip() for l in raw.splitlines() if l.startswith('data:')]
print(lines[-1] if lines else raw)"; }

echo "1. Superset health"
printf '   %s\n' "$(curl -fsS "$SUPERSET/health")"

echo "2. MCP server tools"
mcp() {
  curl -fsS -X POST "$MCP" \
    -H 'Content-Type: application/json' \
    -H 'Accept: application/json, text/event-stream' \
    -d "$1" | mcp_body
}
mcp '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"verify-m1","version":"0"}}}' >/dev/null
mcp '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' | json "
tools = sorted(t['name'] for t in d['result']['tools'])
print(f'   {len(tools)} tools')
for n in ('list_datasets', 'get_dataset_info'):
    print(f'   {n}: ' + ('present' if n in tools else 'MISSING'))
"

echo "3. MCP list_datasets as the service account"
mcp '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"list_datasets","arguments":{"request":{"page_size":5}}}}' | json "
r = d.get('result', {})
if r.get('isError'):
    sys.exit('   list_datasets failed: ' + json.dumps(r)[:400])
body = r.get('structuredContent') or json.loads(r['content'][0]['text'])
names = [x.get('table_name') for x in body.get('datasets', [])]
print(f\"   total {body.get('total_count')}, first: {names}\")
"

echo "4. MCP write tool is blocked for the service account"
mcp '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"generate_dashboard","arguments":{"request":{"chart_ids":[1],"dashboard_title":"should fail"}}}}' | json "
# Superset 6.1.0 reports tool errors as text with isError false.
text = json.dumps(d)
if 'Permission denied' not in text:
    sys.exit('   NOT BLOCKED: ' + text[:300])
print('   blocked: ' + text[text.index('Permission denied'):].split('(tool')[0].strip())
"

echo "5. REST login as the service account"
TOKEN=$(curl -fsS -X POST "$SUPERSET/api/v1/security/login" \
  -H 'Content-Type: application/json' \
  -d "{\"username\":\"$USER\",\"password\":\"$PASS\",\"provider\":\"db\",\"refresh\":true}" |
  json "print(d['access_token'])")
echo "   ok"

echo "6. Example datasets over REST"
curl -fsS -G "$SUPERSET/api/v1/dataset/" -H "Authorization: Bearer $TOKEN" \
  --data-urlencode 'q=(columns:!(id,table_name),page_size:100)' | json "
rows = d['result']
print(f\"   {d['count']} datasets, e.g. {[r['table_name'] for r in rows[:6]]}\")
"
DS_ID=$(curl -fsS -G "$SUPERSET/api/v1/dataset/" -H "Authorization: Bearer $TOKEN" \
  --data-urlencode 'q=(filters:!((col:table_name,opr:eq,value:birth_names)),columns:!(id))' |
  json "print(d['result'][0]['id'])")

echo "7. Chart data query (birth_names, sum__num by gender, 1990 to 2000)"
curl -fsS -X POST "$SUPERSET/api/v1/chart/data" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d "{\"datasource\":{\"id\":$DS_ID,\"type\":\"table\"},\"result_format\":\"json\",\"result_type\":\"full\",
       \"queries\":[{\"columns\":[\"gender\"],\"metrics\":[\"sum__num\"],
         \"filters\":[{\"col\":\"ds\",\"op\":\"TEMPORAL_RANGE\",\"val\":\"1990-01-01 : 2000-01-01\"}],
         \"row_limit\":10}]}" | json "
r = d['result'][0]
print(f\"   colnames {r['colnames']} coltypes {r['coltypes']}\")
print(f\"   rows {r['data']}\")
"

echo "8. Superset holds no charts or dashboards created by the POC"
curl -fsS -G "$SUPERSET/api/v1/dashboard/" -H "Authorization: Bearer $TOKEN" \
  --data-urlencode "q=(filters:!((col:dashboard_title,opr:ct,value:'should fail')))" |
  json "
n = d['count']
print(f\"   dashboards titled 'should fail': {n}\")
sys.exit(1 if n else 0)
"

echo "M1 checks passed"
