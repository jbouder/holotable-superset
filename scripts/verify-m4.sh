#!/usr/bin/env bash
# M4 check: prompt to dashboard, then a one-tile follow-up. Needs LLM_API_KEY
# in .env and `npm install` at the repo root.
set -euo pipefail
cd "$(dirname "$0")/.."
npx tsx scripts/verify-m4.ts
