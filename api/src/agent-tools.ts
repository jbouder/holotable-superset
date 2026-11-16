import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { config } from "./config.ts";
import { createSpecMcpServer } from "./spec-mcp.ts";

/**
 * The agent's tools: two MCP servers behind one lookup. The spec MCP server
 * runs in this process over an in-memory transport; Superset's MCP server is
 * reached over HTTP, and only its read tools are exposed.
 */

/** Superset MCP tools the agent may call. Everything else is hidden from it. */
export const SUPERSET_ALLOWLIST = ["list_datasets", "get_dataset_info"];

/** Long tool results are cut so one call cannot flood the context. */
const MAX_RESULT_CHARS = 20_000;

export interface ToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface ToolResult {
  text: string;
  isError: boolean;
}

export interface AgentTools {
  defs: ToolDef[];
  call(name: string, input: unknown): Promise<ToolResult>;
  close(): Promise<void>;
}

type CallResult = { isError?: boolean; content?: { type: string; text?: string }[] };

function toResult(res: CallResult): ToolResult {
  let text = (res.content ?? []).map((c) => (c.type === "text" ? (c.text ?? "") : `[${c.type}]`)).join("\n");
  if (text.length > MAX_RESULT_CHARS) text = `${text.slice(0, MAX_RESULT_CHARS)}\n[cut at ${MAX_RESULT_CHARS} characters]`;
  // Superset's MCP server reports tool failures as text with isError false.
  const supersetError = /^\s*(\{\s*"error"|Error:)/.test(text) || /Permission denied/.test(text);
  return { text, isError: Boolean(res.isError) || supersetError };
}

export async function connectAgentTools(): Promise<AgentTools> {
  const spec = new Client({ name: "holotable-agent", version: "0.4.0" });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const specServer = createSpecMcpServer();
  await specServer.connect(serverSide);
  await spec.connect(clientSide);

  const superset = new Client({ name: "holotable-agent", version: "0.4.0" });
  await superset.connect(new StreamableHTTPClientTransport(new URL(config.supersetMcpUrl)));

  const owner = new Map<string, Client>();
  const defs: ToolDef[] = [];
  for (const [client, allow] of [
    [superset, (n: string) => SUPERSET_ALLOWLIST.includes(n)],
    [spec, () => true],
  ] as const) {
    const { tools } = await client.listTools();
    for (const t of tools.filter((t) => allow(t.name))) {
      owner.set(t.name, client);
      defs.push({ name: t.name, description: t.description ?? "", inputSchema: t.inputSchema as Record<string, unknown> });
    }
  }
  const missing = SUPERSET_ALLOWLIST.filter((n) => !owner.has(n));
  if (missing.length) throw new Error(`Superset MCP is missing ${missing.join(", ")}`);

  return {
    defs,
    async call(name, input) {
      const client = owner.get(name);
      if (!client) return { text: `There is no tool named "${name}".`, isError: true };
      try {
        const res = (await client.callTool({ name, arguments: (input ?? {}) as Record<string, unknown> })) as CallResult;
        return toResult(res);
      } catch (err) {
        return { text: `${name} failed: ${err instanceof Error ? err.message : String(err)}`, isError: true };
      }
    },
    async close() {
      await Promise.allSettled([spec.close(), superset.close(), specServer.close()]);
    },
  };
}
