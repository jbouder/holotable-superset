#!/usr/bin/env bash
# M2 check: the seeded hand-written spec loads through the UI's proxy, every
# tile comes back with live rows from Superset, a filter override narrows
# them, and a repeat request is served from the Redis tile cache.
set -euo pipefail

UI=${UI_URL:-http://localhost:3000}
json() { python3 -c "import json,sys; d=json.load(sys.stdin); $1"; }

echo "1. API health through the UI proxy"
curl -fsS "$UI/api/health" | json "print('   ', d); sys.exit(0 if d['ok'] else 1)"

echo "2. Seeded spec"
curl -fsS "$UI/api/dashboards/us_births" | json "
s = d['spec']
print(f\"   {s['title']}: {len(s['tiles'])} tiles ({', '.join(t['viz']['type'] for t in s['tiles'])}), version {d['version']}\")"

echo "3. Live data for every tile (no filter)"
curl -fsS "$UI/api/dashboards/us_births/data" | json "
bad = [k for k, v in d['tiles'].items() if not v['ok'] or not v['data']['rows']]
for k, v in d['tiles'].items():
    print(f\"   {k}: \" + (f\"{len(v['data']['rows'])} rows\" if v['ok'] else 'ERROR ' + v['error']))
sys.exit(1 if bad else 0)"

echo "4. Filter override (1990 to 2000)"
RANGE='1990-01-01%20%3A%202000-01-01'
curl -fsS "$UI/api/dashboards/us_births/data?f_time=$RANGE" | json "
t = d['tiles']
years = sorted({r['ds'][:4] for r in t['t_by_year']['data']['rows']})
print(f\"   total {t['t_total']['data']['rows'][0]['sum__num']:,}, years {years[0]} to {years[-1]}\")
sys.exit(0 if years[0] == '1990' and years[-1] == '1999' else 1)"

echo "5. Repeat request is cached"
curl -fsS "$UI/api/dashboards/us_births/data?f_time=$RANGE" | json "
c = [k for k, v in d['tiles'].items() if v['data'].get('cached')]
print(f\"   cached tiles: {len(c)} of {len(d['tiles'])}\")
sys.exit(0 if len(c) == len(d['tiles']) else 1)"

echo "6. UI serves the app"
curl -fsS "$UI/d/us_births" | grep -q '<div id="root">' && echo "   ok"

echo "M2 checks passed. Open $UI/d/us_births to see it render."
