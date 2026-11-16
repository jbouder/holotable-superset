#!/usr/bin/env bash
# M3 check: drive the spec MCP server from an MCP client (the official
# TypeScript SDK). Needs `npm install` at the repo root.
set -euo pipefail
cd "$(dirname "$0")/.."
npx tsx scripts/verify-m3.ts
