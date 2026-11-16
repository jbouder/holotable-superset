import Anthropic from "@anthropic-ai/sdk";
import { type ChatEvent, type ChatRequest, Dashboard } from "@poc/spec";
import { coerceArgs, scopeError } from "./agent-guards.ts";
import { type AgentTools, connectAgentTools, type ToolResult } from "./agent-tools.ts";
import { config } from "./config.ts";
import { getDashboard } from "./db.ts";

/**
 * The agent loop. It turns one chat message into spec MCP calls, using
 * Superset's MCP server to learn the data, and reports each meaningful step
 * as a short line. The model reaches Superset and Postgres only through
 * those tools.
 */

const SYSTEM = `You build and edit dashboards for Holotable, a dashboard UI on top of Apache Superset. You work only through tools. Every tile you add is a Superset query plus a chart config; the spec tools run the query before they save the tile.

Building a new dashboard:
1. Call list_datasets with {"request": {"select_columns": ["id", "table_name", "main_dttm_col"], "page_size": 100}}.
2. Pick the one dataset that best fits the request and call get_dataset_info for it. Use only its real columns and saved metrics.
3. Call list_viz_types once, then create_dashboard with a short title.
4. Add 4 to 6 tiles that answer the request: usually one or two big numbers, a trend over time, a ranking, and a detail table. Give every tile "timeRange": "$f_time" so the dashboard's time filter applies. Add independent tiles in the same turn.
5. If a tile is rejected, read the reason and fix that tile. Do not retry the same input. Give up on a tile after two failed fixes.
6. Last, in one turn: give each tile a note with update_tile (note only, one sentence on what its preview rows show), and write the dashboard summary with update_dashboard.

Editing an open dashboard (the message names it):
- Change only what was asked. A change to one tile is one update_tile call. Do not recreate the dashboard and do not touch other tiles.
- Update the edited tile's note if its data changed.

Rules:
- A line or area chart needs the time column in dimensions with timeColumn and timeGrain set.
- A big number has no dimensions.
- A bar chart of categories needs a rowLimit of 10 to 20 and an orderBy on its metric.
- Never invent numbers. Notes and summaries come from the tool results.
- When you are done, reply to the user in one or two plain sentences. No headings, no lists.`;

const MAX_TURNS = 24;

type Emit = (event: ChatEvent) => void;

/**
 * Two providers, one SDK. "anthropic" is the Claude API. "ollama" is a local
 * model behind Ollama's Anthropic-compatible /v1/messages, which takes tools
 * and streaming but no prompt caching, betas or effort, so those are left out.
 */
const ollama = () => config.llm.provider === "ollama";

export function llmReady(): string | null {
  if (!["anthropic", "ollama"].includes(config.llm.provider)) {
    return `LLM_PROVIDER "${config.llm.provider}" is not supported. Use "anthropic" or "ollama".`;
  }
  if (!ollama() && !config.llm.apiKey) return "Set LLM_API_KEY in .env and restart the api service to use the agent.";
  return null;
}

function makeClient(): Anthropic {
  return ollama()
    ? new Anthropic({ apiKey: "ollama", baseURL: config.llm.baseUrl ?? "http://ollama:11434", maxRetries: 0 })
    : new Anthropic({ apiKey: config.llm.apiKey, baseURL: config.llm.baseUrl, maxRetries: 2 });
}

function request(
  tools: Anthropic.Beta.BetaTool[],
  messages: Anthropic.Beta.BetaMessageParam[],
): Anthropic.Beta.MessageCreateParamsStreaming | Anthropic.Beta.MessageCreateParamsNonStreaming {
  if (ollama()) {
    return { model: config.llm.model, max_tokens: 16_000, system: SYSTEM, tools, messages };
  }
  return {
    model: config.llm.model,
    max_tokens: 32_000,
    system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
    tools: tools.map((t) => ({ ...t, eager_input_streaming: true })),
    messages,
    output_config: { effort: config.llm.effort },
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
  };
}

function parse(text: string): Record<string, unknown> | null {
  try {
    const v: unknown = JSON.parse(text);
    return v && typeof v === "object" ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function firstProblem(text: string): string {
  const line = text.split("\n").find((l) => l.startsWith("- "));
  return (line ?? text).replace(/^- /, "").slice(0, 200);
}

/** One readable line for a tool call, or null for calls not worth showing. */
function describe(name: string, input: Record<string, unknown>, result: ToolResult): ChatEvent | null {
  const body = result.isError ? null : parse(result.text);
  const title = String(input.title ?? (body?.tile as { title?: string } | undefined)?.title ?? input.tileId ?? "tile");
  if (result.isError) {
    const subject = name === "add_tile" ? `"${title}"` : name;
    return { type: "step", status: "rejected", text: `${subject} was rejected: ${firstProblem(result.text)}` };
  }
  switch (name) {
    case "list_datasets": {
      const count = (body?.datasets as unknown[] | undefined)?.length;
      return { type: "step", status: "info", text: `Looked through ${count ?? "the"} datasets` };
    }
    case "get_dataset_info": {
      const cols = (body?.columns as unknown[] | undefined)?.length;
      return { type: "step", status: "info", text: `Read ${body?.table_name ?? "a dataset"}${cols ? ` (${cols} columns)` : ""}` };
    }
    case "create_dashboard":
      return { type: "step", status: "ok", text: `Created the dashboard "${body?.title}"` };
    case "add_tile": {
      const rows = (body?.preview as { rowCount?: number } | undefined)?.rowCount;
      const viz = (body?.tile as { viz?: { type?: string } } | undefined)?.viz?.type;
      return { type: "step", status: "ok", text: `Added "${title}" (${viz}, ${rows} rows)` };
    }
    case "update_tile": {
      const noteOnly = Object.keys(input).every((k) => ["dashboardId", "tileId", "note"].includes(k));
      return { type: "step", status: "ok", text: noteOnly ? `Wrote a note for "${title}"` : `Updated "${title}"` };
    }
    case "remove_tile":
      return { type: "step", status: "ok", text: `Removed tile ${String(input.tileId)}` };
    case "set_layout":
      return { type: "step", status: "ok", text: "Rearranged the tiles" };
    case "update_dashboard":
      return { type: "step", status: "ok", text: "Wrote the summary" };
    default:
      return null;
  }
}

/** Spec writes report the dashboard's id and new version. */
function written(name: string, result: ToolResult): { id: string; version: number } | null {
  if (result.isError || ["list_datasets", "get_dataset_info", "list_viz_types", "get_dashboard", "list_dashboards"].includes(name)) {
    return null;
  }
  const body = parse(result.text);
  const id = body?.dashboardId ?? body?.id;
  const version = body?.version;
  return typeof id === "string" && typeof version === "number" ? { id, version } : null;
}

async function openingMessage(req: ChatRequest): Promise<string> {
  if (!req.dashboardId) return req.message;
  const stored = await getDashboard(req.dashboardId);
  if (!stored) return req.message;
  const spec = Dashboard.parse(stored.spec);
  return `The open dashboard is "${spec.id}". Edit it; do not create a new one. Its spec now:\n${JSON.stringify(spec)}\n\nRequest: ${req.message}`;
}

export async function runAgent(req: ChatRequest, emit: Emit, signal: AbortSignal): Promise<void> {
  const started = Date.now();
  const client = makeClient();
  // A plain controller and timer: a signal from AbortSignal.any() over
  // AbortSignal.timeout() can be garbage collected before it fires.
  const stop = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    stop.abort();
  }, config.llm.timeLimit * 1000);
  const onClientGone = () => stop.abort();
  signal.addEventListener("abort", onClientGone, { once: true });
  const deadline = stop.signal;
  let tools: AgentTools | null = null;
  let dashboardId = req.dashboardId;

  try {
    tools = await connectAgentTools();
    const toolDefs: Anthropic.Beta.BetaTool[] = tools.defs.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.inputSchema as Anthropic.Beta.BetaTool.InputSchema,
    }));
    const messages: Anthropic.Beta.BetaMessageParam[] = [
      ...req.history.map((h) => ({ role: h.role, content: h.text })),
      { role: "user", content: await openingMessage(req) },
    ];

    for (let turn = 0; turn < MAX_TURNS; turn++) {
      const stream = client.beta.messages.stream(request(toolDefs, messages), { signal: deadline });
      const message = await stream.finalMessage();

      if (message.stop_reason === "refusal") {
        emit({ type: "error", message: "The model declined this request." });
        return;
      }
      if (message.stop_reason === "pause_turn") {
        messages.push({ role: "assistant", content: message.content });
        continue;
      }
      const calls = message.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
      if (calls.length === 0) {
        const text = message.content
          .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
          .map((b) => b.text)
          .join("\n")
          .trim();
        if (text) emit({ type: "message", text });
        return;
      }
      if (message.stop_reason === "max_tokens") {
        emit({ type: "error", message: "The model ran out of room mid-step. Try a narrower request." });
        return;
      }

      messages.push({ role: "assistant", content: message.content });
      const results = await Promise.all(
        calls.map(async (call) => {
          const input = coerceArgs(call.input);
          const refused = scopeError(call.name, input, dashboardId);
          const result = refused ? { text: refused, isError: true } : await (tools as AgentTools).call(call.name, input);
          const step = describe(call.name, input, result);
          if (step) emit(step);
          const write = written(call.name, result);
          if (write) {
            dashboardId = write.id;
            emit({ type: "dashboard", ...write });
          }
          return {
            type: "tool_result" as const,
            tool_use_id: call.id,
            content: result.text,
            ...(result.isError && { is_error: true }),
          };
        }),
      );
      messages.push({ role: "user", content: results });
    }
    emit({ type: "error", message: `Stopped after ${MAX_TURNS} steps.` });
  } catch (err) {
    if (signal.aborted) return;
    if (timedOut) {
      emit({ type: "error", message: `Stopped after ${config.llm.timeLimit} seconds.` });
    } else if (err instanceof Anthropic.AuthenticationError) {
      emit({ type: "error", message: "The LLM rejected the API key. Check LLM_API_KEY." });
    } else if (err instanceof Anthropic.RateLimitError) {
      emit({ type: "error", message: "The LLM is rate limiting requests. Try again in a minute." });
    } else if (err instanceof Anthropic.APIError) {
      emit({ type: "error", message: `The LLM returned an error (${err.status ?? "network"}).` });
      console.error("agent llm", err);
    } else {
      emit({ type: "error", message: "The agent failed. See the api logs." });
      console.error("agent", err);
    }
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", onClientGone);
    await tools?.close();
    emit({ type: "done", dashboardId, seconds: Math.round((Date.now() - started) / 100) / 10 });
  }
}
