#!/usr/bin/env bash
# M6 check: run the mirror for the seeded dashboard, check it matches the
# spec, then confirm the demo path still creates nothing else in Superset.
set -euo pipefail
cd "$(dirname "$0")/.."
echo "0. Mirror us_births"
scripts/mirror-to-superset.sh | sed 's/^/   /'
npx tsx scripts/verify-m6.ts
echo "6. Nothing else in Superset (verify-m5, step 4)"
scripts/verify-m5.sh | sed -n '/^4\./,$p' | sed 's/^/   /'
