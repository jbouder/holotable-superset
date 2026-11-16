# holotable-superset

A proof of concept: a Holotable-style dashboard UI on top of Apache Superset as
a headless backend, where an AI agent turns a prompt into a dashboard.

Start it from the repo root:

```sh
docker compose up
```

Status: M3 (spec MCP server). Open http://localhost:3000 once the stack is
healthy. The spec MCP server is at http://localhost:8000/mcp. Run
`scripts/verify-m1.sh`, `scripts/verify-m2.sh` and `scripts/verify-m3.sh` to
check it (M3 needs `npm install` at the root first).
The full README arrives with M5.
