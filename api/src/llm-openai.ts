import type Anthropic from "@anthropic-ai/sdk";

/**
 * One agent turn over an OpenAI-compatible Chat Completions API, such as
 * OpenCode Zen or Go serving Kimi K3. The agent loop keeps its history in
 * Anthropic's message shape; this module converts it on the way out and
 * converts the reply back, so the loop does not care which provider ran.
 */

export interface Turn {
  stop_reason: string | null;
  content: Anthropic.Beta.BetaContentBlock[];
}

export class LlmHttpError extends Error {
  constructor(
    readonly status: number,
    body: string,
  ) {
    super(`HTTP ${status}: ${body.slice(0, 300)}`);
  }
}

type ChatMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; reasoning_content?: string; tool_calls?: ToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

interface ChatResponse {
  choices?: {
    finish_reason: string | null;
    message: { content: string | null; reasoning_content?: string | null; tool_calls?: ToolCall[] };
  }[];
}

function blockText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((c: { type: string; text?: string }) => (c.type === "text" ? (c.text ?? "") : "")).join("\n");
}

/** Anthropic-shaped history to Chat Completions messages. */
export function toChatMessages(system: string, messages: Anthropic.Beta.BetaMessageParam[]): ChatMessage[] {
  const out: ChatMessage[] = [{ role: "system", content: system }];
  for (const m of messages) {
    if (typeof m.content === "string") {
      out.push(m.role === "user" ? { role: "user", content: m.content } : { role: "assistant", content: m.content });
      continue;
    }
    if (m.role === "assistant") {
      const text = m.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("\n");
      const reasoning = m.content.filter((b) => b.type === "thinking").map((b) => (b as { thinking: string }).thinking).join("\n");
      const calls = m.content
        .filter((b) => b.type === "tool_use")
        .map((b) => {
          const u = b as { id: string; name: string; input: unknown };
          return { id: u.id, type: "function" as const, function: { name: u.name, arguments: JSON.stringify(u.input ?? {}) } };
        });
      out.push({
        role: "assistant",
        content: text || null,
        ...(reasoning && { reasoning_content: reasoning }),
        ...(calls.length > 0 && { tool_calls: calls }),
      });
      continue;
    }
    // A user turn: tool results become tool messages, any text a user message.
    const text: string[] = [];
    for (const b of m.content ?? []) {
      if (b.type === "tool_result") {
        const r = b as { tool_use_id: string; content?: unknown; is_error?: boolean };
        out.push({ role: "tool", tool_call_id: r.tool_use_id, content: `${r.is_error ? "Error: " : ""}${blockText(r.content)}` });
      } else if (b.type === "text") {
        text.push((b as { text: string }).text);
      }
    }
    if (text.length) out.push({ role: "user", content: text.join("\n") });
  }
  return out;
}

const STOP: Record<string, string> = { tool_calls: "tool_use", length: "max_tokens", content_filter: "refusal" };

/** A Chat Completions reply to Anthropic-shaped content blocks. */
export function fromChatResponse(res: ChatResponse): Turn {
  const choice = res.choices?.[0];
  if (!choice) throw new Error("The LLM returned no choices.");
  const { message } = choice;
  const content: Record<string, unknown>[] = [];
  // Reasoning models such as Kimi K3 expect their reasoning back on later turns.
  if (message.reasoning_content) content.push({ type: "thinking", thinking: message.reasoning_content, signature: "" });
  if (message.content) content.push({ type: "text", text: message.content, citations: null });
  for (const call of message.tool_calls ?? []) {
    let input: unknown = {};
    try {
      input = JSON.parse(call.function.arguments || "{}");
    } catch {
      // Left empty: the tool's own validation then names the missing fields.
    }
    content.push({ type: "tool_use", id: call.id, name: call.function.name, input });
  }
  const toolUse = (message.tool_calls ?? []).length > 0;
  return {
    stop_reason: toolUse ? "tool_use" : (STOP[choice.finish_reason ?? ""] ?? "end_turn"),
    content: content as unknown as Anthropic.Beta.BetaContentBlock[],
  };
}

export interface OpenAiOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  /** One id per agent run. OpenCode routes and caches by it. */
  sessionId: string;
  signal: AbortSignal;
}

export async function openAiTurn(
  system: string,
  tools: Anthropic.Beta.BetaTool[],
  messages: Anthropic.Beta.BetaMessageParam[],
  opts: OpenAiOptions,
): Promise<Turn> {
  const body = JSON.stringify({
    model: opts.model,
    max_tokens: 16_000,
    messages: toChatMessages(system, messages),
    tools: tools.map((t) => ({
      type: "function",
      function: { name: t.name, description: t.description, parameters: t.input_schema },
    })),
  });
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${opts.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${opts.apiKey}`,
        "Content-Type": "application/json",
        "User-Agent": "holotable-superset/0.5",
        "x-opencode-session": opts.sessionId,
      },
      body,
      signal: opts.signal,
    });
    if (res.ok) return fromChatResponse((await res.json()) as ChatResponse);
    const text = await res.text();
    const retryable = res.status === 429 || res.status >= 500;
    if (!retryable || attempt >= 2) throw new LlmHttpError(res.status, text);
    await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
  }
}
