# holotable-superset

A proof of concept: a Holotable-style dashboard UI on top of Apache Superset,
used as a headless backend, where an AI agent turns a prompt into a dashboard.
You describe a dashboard, the agent picks a dataset and adds tiles, and every
tile is checked against live data before it is saved.

## Setup

You need Docker with Compose v2 and about 4 GB of memory for Docker. For the
agent you need an Anthropic API key, a key for any OpenAI-compatible API (see
[Other providers](#other-providers)), or a local model (see
[Local models](#local-models)).

```sh
git clone https://github.com/jbouder/holotable-superset.git
cd holotable-superset
cp .env.example .env        # then set LLM_API_KEY in .env
docker compose up -d --wait
```

The first start builds the images, loads Superset's example data and takes
about 2.5 minutes. Then open http://localhost:3000.

Without `LLM_API_KEY` everything still works except the agent: saved
dashboards load, filter and refresh, and the chat says to set the key.

## Architecture

Superset holds the data and runs every query, but its own UI is not part of
the demo. The `api` service (TypeScript, Hono) stores dashboard specs as JSONB
in Postgres and loads each tile's rows through one module,
`api/src/superset-client.ts`, which calls Superset's REST chart data API as a
read-only service account and caches results in Redis. A spec is defined
once, in Zod, in `spec/`, and the API and the UI both import it. The agent
runs in the API. It reads datasets through Superset's MCP server, limited to
`list_datasets` and `get_dataset_info`, and changes dashboards only through
the spec MCP server at `/mcp`, which runs each new tile's query and rejects
tiles that fail, return no data or do not match their chart. The UI (React,
Vite, ECharts, with Holotable's grid, card and theme) never talks to Superset
or MCP. It reads saved specs and data over REST, so dashboards load with no
LLM and with Superset's MCP server stopped. The POC creates no Superset charts
or dashboards; the ones Superset shows come with its example data.

| Service | Port | Role |
| --- | --- | --- |
| `ui` | 3000 | React app; proxies `/api/` to the API |
| `api` | 8000 | REST API, `POST /chat` (SSE), spec MCP server at `/mcp` |
| `superset` | 8088 | Superset, headless; its UI is there for debugging (admin/admin) |
| `superset-mcp` | 5008 | Superset's MCP server, used only by the agent |
| `superset-init` | none | One-shot: migrations, admin, read-only service account, example data |
| `superset-db` | internal | Postgres: Superset metadata, example data, `holotable` schema |
| `redis` | internal | Superset cache and the API's tile cache |
| `ollama`, `ollama-pull` | internal | Local model, `local-llm` profile only |

## Demo

1. Open http://localhost:3000. The seeded "US births" dashboard is listed.
   Open it: four tiles from Superset's `birth_names` example data, each with
   a note. Change the time range to a custom range, say 1990 to 2000, and
   every tile refreshes. Use "Show query" on a tile to see the SQL Superset ran.
2. Go back to the list. In "New dashboard", click "Use the example" and then
   "Build it". The chat panel shows each step as the agent works, and tiles
   appear as it adds them.
3. In the chat panel, ask for one change, for example "Make the trend monthly
   instead of yearly". The agent changes that one tile and leaves the rest.
4. Optional: `docker compose stop superset-mcp`, then reload a dashboard. It
   still loads and refreshes, because loading never uses MCP.
   `docker compose start superset-mcp` brings the agent back.

## Configuration

Everything is in `.env`; see `.env.example`. Every value has a local-only
default in `docker-compose.yml`, so the stack boots without a `.env`.

| Variable | Default | Meaning |
| --- | --- | --- |
| `LLM_PROVIDER` | `anthropic` | `anthropic`, `openai-compatible` or `ollama` |
| `LLM_MODEL` | `claude-opus-5-5` | Model name for the provider |
| `LLM_API_KEY` | none | API key for the provider; not needed for `ollama` |
| `LLM_BASE_URL` | provider default | API address; required for `openai-compatible` |
| `LLM_EFFORT` | `medium` | Anthropic effort: `low`, `medium`, `high`, `xhigh` or `max` |
| `AGENT_TIME_LIMIT` | `180` | Seconds before an agent run stops |
| `OLLAMA_MODELS` | a Docker volume | Where the `local-llm` profile keeps models |

With Claude, the API turns on Anthropic's server-side fallback, so a request
the model declines is retried on another model instead of failing.

## Other providers

`openai-compatible` talks to any Chat Completions API. It was tested with
Kimi K3 on OpenCode Zen, which passed `verify-m4.sh`: a new dashboard in 57
seconds and a follow-up in 25.

```sh
LLM_PROVIDER=openai-compatible
LLM_MODEL=kimi-k3
LLM_API_KEY=...
LLM_BASE_URL=https://opencode.ai/zen/v1
```

OpenCode Go uses `https://opencode.ai/inference/go/openai/v1` and needs an
active Go subscription on the key. OpenCode describes Go as meant for coding
agents, so Zen is the better fit for this app.

## Local models

The `local-llm` profile runs Ollama inside the stack, so an agent run makes no
calls outside the Docker network. Only the one-time model download needs the
internet.

```sh
# in .env
LLM_PROVIDER=ollama
LLM_MODEL=qwen3.5:35b
AGENT_TIME_LIMIT=1200

docker compose --profile local-llm up -d --wait
```

`ollama-pull` downloads the model on first start (about 23 GB for
`qwen3.5:35b`). If Ollama already has the model on your machine, set
`OLLAMA_MODELS=$HOME/.ollama` to reuse it instead of downloading.

On a Mac, Docker cannot use the GPU, so a model inside Docker runs on the CPU.
On an Apple M5 Pro each agent turn took 10 to 15 minutes that way, so a new
dashboard does not finish in practice. The profile suits a Linux host with a
GPU passed through to Docker. On a Mac, run Ollama natively and point the API
at it instead. This skips the `local-llm` profile and still makes no calls
outside your machine:

```sh
LLM_PROVIDER=ollama
LLM_MODEL=qwen3.5:35b
LLM_BASE_URL=http://host.docker.internal:11434
AGENT_TIME_LIMIT=420
```

`qwen3.5:35b` is the smallest model tested that completes the flow. On an
Apple M5 Pro with native Ollama, a new dashboard took 138 seconds and a
follow-up 28 seconds.

## Checks

Each milestone has a check script. Run `npm install` once at the repo root
for the TypeScript ones.

| Script | Checks |
| --- | --- |
| `scripts/verify-m1.sh` | Superset health, its MCP tools, read-only service account, example data over REST |
| `scripts/verify-m2.sh` | Seeded dashboard loads live data through the UI proxy; filters; tile cache |
| `scripts/verify-m3.sh` | Spec MCP server from an MCP client: valid tile saved, six kinds of bad tile rejected |
| `scripts/verify-m4.sh` | Prompt to dashboard in under 90 seconds; a follow-up changes exactly one tile (needs an LLM) |
| `scripts/verify-m5.sh` | Dashboards load with `superset-mcp` stopped; no Superset charts or dashboards beyond its examples |

`npm test --workspace @poc/api` runs the unit tests.

## Known limits

- No authentication. The API, including `/chat` and the spec MCP server at
  `/mcp`, is open to anyone who can reach ports 3000 and 8000. Run it on your
  own machine only.
- The defaults in `docker-compose.yml` (passwords, Superset's secret key) are
  for a laptop. Change them in `.env` anywhere else.
- Tiles use one source type, Superset metrics over one dataset. No joins
  across datasets and no raw SQL.
- The tile checks prove a tile's query runs and matches its chart. They do
  not check the prose. A model can still write a wrong fact into a note or a
  summary; small local models do this more often.
- Superset 6.1.0's MCP server has no setting to turn tools off. Its write
  tools are blocked by the service account's read-only role instead, and the
  agent only sees the two allowlisted tools.
- The chat lives in the browser tab. Reloading the page clears the
  conversation but not the dashboard.
- Local models miss the 90-second target: 138 seconds natively on an Apple
  M5 Pro, and far longer inside Docker on a Mac.

## Later

Ideas left out of the POC on purpose:

- Multi-user auth with Keycloak or another OIDC provider, mapped to Superset
  roles, and row-level security per user.
- Drag-and-drop layout editing, writing through `set_layout`.
- Alerts on tile values.
- A raw SQL tile source, run through Superset's SQL Lab API.
- Observability sources such as Prometheus or Loki next to Superset datasets.
- Production hardening: secrets management, TLS, rate limits on `/chat`,
  persisted chat history, and per-user cost limits for the LLM.
