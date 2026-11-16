# holotable-superset

A proof of concept: a Holotable-style dashboard UI on top of Apache Superset as
a headless backend, where an AI agent turns a prompt into a dashboard.

Start it from the repo root:

```sh
docker compose up
```

Status: M4 (chat to dashboard), built but not yet verified against a live
LLM. Put `LLM_API_KEY=<Anthropic API key>` in `.env` to use the agent. Open
http://localhost:3000 once the stack is healthy. The spec MCP server is at
http://localhost:8000/mcp. Run `scripts/verify-m1.sh` through
`scripts/verify-m4.sh` to check it (M3 and M4 need `npm install` at the root
first; M4 needs the key).
The full README arrives with M5.
