/**
 * M3 check, run from a real MCP client: create a dashboard and add a tile
 * through the spec MCP server, show that bad tiles are rejected with errors
 * an agent can act on, edit and move a tile, then render it over REST.
 * Cleans up after itself. Run with scripts/verify-m3.sh.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const API = process.env.API_URL ?? "http://localhost:8000";
const SUPERSET = process.env.SUPERSET_URL ?? "http://localhost:8088";

let failed = false;
function check(label: string, pass: boolean, detail = "") {
  console.log(`   ${pass ? "ok  " : "FAIL"} ${label}${detail ? `\n        ${detail.replace(/\n/g, "\n        ")}` : ""}`);
  if (!pass) failed = true;
}

const client = new Client({ name: "verify-m3", version: "1.0.0" });
await client.connect(new StreamableHTTPClientTransport(new URL(`${API}/mcp`)));

type Result = { isError?: boolean; content: { type: string; text?: string }[] };
async function call(name: string, args: Record<string, unknown> = {}) {
  const res = (await client.callTool({ name, arguments: args })) as Result;
  const text = res.content.map((c) => c.text ?? "").join("\n");
  return { isError: Boolean(res.isError), text, json: () => JSON.parse(text) };
}

async function datasetId(name: string): Promise<number> {
  const login = await fetch(`${SUPERSET}/api/v1/security/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "holotable_svc", password: process.env.SUPERSET_SERVICE_PASSWORD ?? "holotable_svc", provider: "db" }),
  });
  const { access_token } = (await login.json()) as { access_token: string };
  const q = encodeURIComponent(`(filters:!((col:table_name,opr:eq,value:${name})))`);
  const res = await fetch(`${SUPERSET}/api/v1/dataset/?q=${q}`, { headers: { Authorization: `Bearer ${access_token}` } });
  return ((await res.json()) as { result: { id: number }[] }).result[0]!.id;
}

console.log("1. Tools");
const { tools } = await client.listTools();
const names = tools.map((t) => t.name).sort();
const expected = ["add_tile", "create_dashboard", "get_dashboard", "list_dashboards", "list_viz_types", "remove_tile", "set_layout", "update_dashboard", "update_tile"];
check(`${names.length} tools: ${names.join(", ")}`, JSON.stringify(names) === JSON.stringify(expected));
const guide = (await call("list_viz_types")).json();
check(`list_viz_types: ${guide.vizTypes.map((v: { type: string }) => v.type).join(", ")}`, guide.vizTypes.length === 5);

const ds = await datasetId("birth_names");
const source = { type: "superset_metrics", datasetId: ds, timeRange: "$f_time" };

console.log("2. Create a dashboard");
const created = await call("create_dashboard", { title: "M3 check", summary: "Made by verify-m3." });
check("create_dashboard", !created.isError, created.isError ? created.text : "");
const dash = created.json().id as string;
console.log(`        id ${dash}, filters ${created.json().filters.map((f: { id: string }) => f.id).join(", ")}`);

try {
  console.log("3. Add a valid tile");
  const added = await call("add_tile", {
    dashboardId: dash,
    title: "Births by state",
    source: { ...source, metrics: ["sum__num"], dimensions: ["state"], rowLimit: 10 },
    viz: { type: "bar", x: "state", y: "sum__num", format: "compact" },
  });
  check("add_tile accepted", !added.isError, added.isError ? added.text : "");
  const tile = added.isError ? null : added.json();
  if (tile) {
    console.log(`        ${tile.tile.id} at ${JSON.stringify(tile.tile.layout)}, ${tile.preview.rowCount} rows, first ${JSON.stringify(tile.preview.firstRows[0])}`);
  }

  console.log("4. Invalid tiles are rejected with a useful error");
  const cases: [string, Record<string, unknown>, string][] = [
    [
      "unknown column",
      { title: "Bad", source: { ...source, metrics: ["sum__num"], dimensions: ["region"] }, viz: { type: "bar", x: "region", y: "sum__num" } },
      'dimension "region"',
    ],
    [
      "unknown saved metric",
      { title: "Bad", source: { ...source, metrics: ["revenue"] }, viz: { type: "big_number", value: "revenue" } },
      'metric "revenue"',
    ],
    [
      "viz column the query does not return",
      { title: "Bad", source: { ...source, metrics: ["sum__num"], dimensions: ["state"] }, viz: { type: "bar", x: "gender", y: "sum__num" } },
      '"gender"',
    ],
    [
      "query with no rows",
      {
        title: "Bad",
        source: { ...source, metrics: ["sum__num"], filters: [{ col: "state", op: "==", val: "ZZ" }] },
        viz: { type: "big_number", value: "sum__num" },
      },
      "no data",
    ],
    [
      "big number over many rows",
      { title: "Bad", source: { ...source, metrics: ["sum__num"], dimensions: ["gender"] }, viz: { type: "big_number", value: "sum__num" } },
      "one value",
    ],
    [
      "overlapping layout",
      {
        title: "Bad",
        source: { ...source, metrics: ["sum__num"] },
        viz: { type: "big_number", value: "sum__num" },
        layout: { x: 2, y: 1, w: 4, h: 3 },
      },
      "overlaps",
    ],
  ];
  for (const [label, args, expect] of cases) {
    const res = await call("add_tile", { dashboardId: dash, ...args });
    check(label, res.isError && res.text.includes(expect), res.text);
  }

  console.log("5. Edit one tile, move it, add a second");
  const tileId = tile?.tile.id as string;
  const edited = await call("update_tile", {
    dashboardId: dash,
    tileId,
    title: "Births by gender",
    source: { dimensions: ["gender"] },
    viz: { type: "bar", x: "gender", y: "sum__num", horizontal: true },
  });
  check("update_tile re-ran the query", !edited.isError && edited.json().preview.rowCount === 2, edited.isError ? edited.text : "");
  const second = await call("add_tile", {
    dashboardId: dash,
    title: "Total births",
    source: { ...source, metrics: ["sum__num"] },
    viz: { type: "big_number", value: "sum__num", format: "compact" },
  });
  check("add_tile placed a second tile", !second.isError, second.isError ? second.text : JSON.stringify(second.json().tile.layout));
  const moved = await call("set_layout", {
    dashboardId: dash,
    layout: [
      { tileId: "t_total_births", x: 0, y: 0, w: 4, h: 3 },
      { tileId, x: 4, y: 0, w: 8, h: 3 },
    ],
  });
  check("set_layout", !moved.isError, moved.isError ? moved.text : "");

  console.log("6. Saved spec renders over REST");
  const got = (await call("get_dashboard", { id: dash })).json();
  check(`version ${got.version}, tiles ${got.spec.tiles.map((t: { id: string }) => t.id).join(", ")}`, got.spec.tiles.length === 2);
  const data = (await (await fetch(`${API}/dashboards/${dash}/data`)).json()) as { tiles: Record<string, { ok: boolean }> };
  check("every tile has live data", Object.values(data.tiles).every((t) => t.ok));
  const removed = await call("remove_tile", { dashboardId: dash, tileId });
  check("remove_tile", !removed.isError && removed.json().tiles.length === 1);
} finally {
  await fetch(`${API}/dashboards/${dash}`, { method: "DELETE" });
  await client.close();
}

process.exit(failed ? 1 : 0);
