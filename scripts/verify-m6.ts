/**
 * M6 check: the mirror script builds one Superset dashboard that matches the
 * Holotable spec. Same tiles and titles, the same grid, a native time filter
 * over every tile that uses it, and every chart returning the same rows as
 * its tile. Run it after mirror-to-superset.ts.
 */
import type { DashboardData, StoredDashboard } from "@poc/spec";
import { mirrorSlug } from "./mirror-to-superset.ts";

const UI = process.env.UI_URL ?? "http://localhost:3000";
const SUPERSET = process.env.SUPERSET_URL ?? "http://localhost:8088";
const ID = process.argv[2] ?? "us_births";

let failed = false;
function check(label: string, pass: boolean, detail = "") {
  console.log(`   ${pass ? "ok  " : "FAIL"} ${label}${detail && !pass ? `\n        ${detail}` : ""}`);
  if (!pass) failed = true;
}

const login = await fetch(`${SUPERSET}/api/v1/security/login`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    username: process.env.SUPERSET_ADMIN_USERNAME ?? "admin",
    password: process.env.SUPERSET_ADMIN_PASSWORD ?? "admin",
    provider: "db",
  }),
});
const token = ((await login.json()) as { access_token: string }).access_token;
const ss = async <T>(path: string) => {
  const res = await fetch(`${SUPERSET}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`GET ${path}: HTTP ${res.status}`);
  return (await res.json()) as T;
};

const stored = (await (await fetch(`${UI}/api/dashboards/${ID}`)).json()) as StoredDashboard;
const spec = stored.spec;
const slug = mirrorSlug(ID);

console.log(`1. One Superset dashboard for "${spec.title}"`);
const list = await ss<{ result: { id: number; slug: string | null }[] }>(
  "/api/v1/dashboard/?q=(columns:!(id,slug),page_size:1000)",
);
const matches = list.result.filter((d) => d.slug === slug);
check(`exactly one dashboard with slug ${slug}`, matches.length === 1, `found ${matches.length}`);
const dash = (await ss<{ result: { id: number; dashboard_title: string; position_json: string; json_metadata: string } }>(
  `/api/v1/dashboard/${slug}`,
)).result;
check("same title", dash.dashboard_title === spec.title);

console.log("2. One chart per tile");
const charts = (await ss<{ result: { id: number; slice_name: string }[] }>(`/api/v1/dashboard/${dash.id}/charts`)).result;
check(`${charts.length} charts for ${spec.tiles.length} tiles`, charts.length === spec.tiles.length);
const titles = new Set(charts.map((c) => c.slice_name));
check("every tile title has a chart", spec.tiles.every((t) => titles.has(t.title)));

console.log("3. Same grid");
type Node = { type: string; children?: string[]; meta?: { chartId?: number; width?: number; height?: number; sliceName?: string } };
const pos = JSON.parse(dash.position_json) as Record<string, Node>;
const rowsOfCharts = (pos.GRID_ID?.children ?? [])
  .map((r) => (pos[r]?.children ?? []).map((c) => pos[c]).filter((n): n is Node => n?.type === "CHART"))
  .filter((r) => r.length);
const ys = [...new Set(spec.tiles.map((t) => t.layout.y))].sort((a, b) => a - b);
const specRows = ys.map((y) => spec.tiles.filter((t) => t.layout.y === y).sort((a, b) => a.layout.x - b.layout.x));
check(`${rowsOfCharts.length} rows (spec has ${specRows.length})`, rowsOfCharts.length === specRows.length);
specRows.forEach((row, i) => {
  const got = rowsOfCharts[i] ?? [];
  const same = row.length === got.length && row.every((t, j) => got[j]?.meta?.sliceName === t.title && got[j]?.meta?.width === t.layout.w);
  check(
    `row ${i + 1}: ${row.map((t) => `${t.title} (w${t.layout.w})`).join(", ")}`,
    same,
    `got ${got.map((n) => `${n.meta?.sliceName} (w${n.meta?.width})`).join(", ")}`,
  );
  const heights = new Set(got.map((n) => n.meta?.height));
  check(`row ${i + 1}: one height for the row`, heights.size === 1);
});

console.log("4. Native time filter");
const meta = JSON.parse(dash.json_metadata) as {
  native_filter_configuration?: { name: string; filterType: string; chartsInScope: number[]; defaultDataMask: { filterState: { value?: string } } }[];
};
const filters = meta.native_filter_configuration ?? [];
for (const f of spec.filters) {
  const nf = filters.find((n) => n.name === f.label);
  const wanted = spec.tiles.filter((t) => t.source.timeRange === `$${f.id}`).map((t) => charts.find((c) => c.slice_name === t.title)?.id);
  check(`"${f.label}" is a filter_time`, nf?.filterType === "filter_time");
  check(`default "${f.default}"`, nf?.defaultDataMask.filterState.value === f.default);
  check(`scoped to the ${wanted.length} tiles that use it`, Boolean(nf) && wanted.every((id) => nf?.chartsInScope.includes(id as number)));
}

console.log("5. Same rows as Holotable");
const holo = (await (await fetch(`${UI}/api/dashboards/${ID}/data`)).json()) as DashboardData;
for (const tile of spec.tiles) {
  const chart = charts.find((c) => c.slice_name === tile.title);
  const tileData = holo.tiles[tile.id];
  if (!chart || !tileData?.ok) {
    check(tile.title, false, "missing chart or tile data");
    continue;
  }
  const data = await ss<{ result: { data: Record<string, unknown>[] }[] }>(`/api/v1/chart/${chart.id}/data/`);
  const rows = data.result[0]?.data ?? [];
  const metric = tileData.data.columns.find((c) => c.type === "number")?.name ?? "";
  const sum = (rs: Record<string, unknown>[]) => rs.reduce((s, r) => s + Number(r[metric] ?? 0), 0);
  check(
    `${tile.title}: ${rows.length} rows, ${metric} total ${sum(rows)}`,
    rows.length === tileData.data.rows.length && sum(rows) === sum(tileData.data.rows),
    `Holotable has ${tileData.data.rows.length} rows, total ${sum(tileData.data.rows)}`,
  );
}

console.log(failed ? "\nM6 checks failed." : `\nM6 checks passed. Open ${SUPERSET}/superset/dashboard/${slug}/`);
process.exit(failed ? 1 : 0);
