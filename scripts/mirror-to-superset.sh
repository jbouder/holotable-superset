#!/usr/bin/env bash
# M6: mirror a Holotable dashboard into Superset (default: the seeded
# us_births). Opt-in. Needs `npm install` at the repo root.
# Usage: scripts/mirror-to-superset.sh [dashboardId] [--dark]
set -euo pipefail
cd "$(dirname "$0")/.."
npx tsx scripts/mirror-to-superset.ts "$@"
