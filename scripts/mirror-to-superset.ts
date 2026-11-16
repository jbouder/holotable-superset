/**
 * M6: rebuild a Holotable dashboard as a native Superset dashboard, for a
 * side-by-side comparison. Opt-in; nothing in the demo path calls it.
 *
 * Reads the saved spec from the API, logs in to Superset as the admin, and
 * creates one chart per tile, the same 12-column grid, the summary as a
 * Markdown header, notes as chart descriptions, and the time filter as a
 * native filter. Each chart's saved query is built by the same code the API
 * uses, so both dashboards run the same SQL. Running it again replaces the
 * mirror it made before, found by its slug.
 *
 *   npx tsx scripts/mirror-to-superset.ts [dashboardId] [--dark]
 */
import { type Dashboard, type Metric, metricLabel, type SourceFilter, type StoredDashboard, type Tile } from "@poc/spec";
import { buildChartDataPayload } from "../api/src/superset-query.ts";

const args = process.argv.slice(2);
const DASHBOARD_ID = args.find((a) => !a.startsWith("--")) ?? "us_births";
const DARK = args.includes("--dark");
const UI = process.env.UI_URL ?? "http://localhost:3000";
const SUPERSET = process.env.SUPERSET_URL ?? "http://localhost:8088";
const USERNAME = process.env.SUPERSET_ADMIN_USERNAME ?? "admin";
const PASSWORD = process.env.SUPERSET_ADMIN_PASSWORD ?? "admin";

/** Slug of the mirror in Superset. verify-m5 and verify-m6 look for it. */
export const mirrorSlug = (id: string) => `holotable-${id.replace(/_/g, "-")}`;

// Holotable's grid: 84px rows with a 16px gap. Superset sizes in 8px units.
const ROW_PX = 84;
const GAP_PX = 16;
const heightUnits = (h: number) => Math.round((h * ROW_PX + (h - 1) * GAP_PX) / 8);

let token = "";
let csrf = "";
let cookie = "";

async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${SUPERSET}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(csrf && { "X-CSRFToken": csrf, Cookie: cookie, Referer: SUPERSET }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path}: HTTP ${res.status} ${text.slice(0, 400)}`);
  return (text ? JSON.parse(text) : {}) as T;
}

async function login(): Promise<void> {
  const res = await fetch(`${SUPERSET}/api/v1/security/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: USERNAME, password: PASSWORD, provider: "db", refresh: false }),
  });
  if (!res.ok) throw new Error(`Superset admin login failed: HTTP ${res.status}`);
  token = ((await res.json()) as { access_token: string }).access_token;
  // Writes need a CSRF token tied to the session cookie it came with.
  const c = await fetch(`${SUPERSET}/api/v1/security/csrf_token/`, { headers: { Authorization: `Bearer ${token}` } });
  csrf = ((await c.json()) as { result: string }).result;
  cookie = (c.headers.getSetCookie?.() ?? []).map((v) => v.split(";")[0]).join("; ");
}

const FORMAT: Record<string, string> = { number: ",d", compact: "SMART_NUMBER", percent: ".1%", currency: "$,.2f" };

function adhocMetric(m: Metric) {
  if (typeof m === "string") return m;
  return {
    expressionType: "SIMPLE",
    column: { column_name: m.column },
    aggregate: m.aggregate,
    label: metricLabel(m),
    hasCustomLabel: true,
    optionName: `metric_${metricLabel(m)}`,
  };
}

function adhocFilter(f: SourceFilter) {
  return {
    expressionType: "SIMPLE",
    clause: "WHERE",
    subject: f.col,
    operator: f.op,
    ...(f.val !== undefined && { comparator: f.val }),
  };
}

/** A tile as Superset form data: the chart's saved controls. */
function formData(tile: Tile, timeColumn: string | null, defaultRange: string) {
  const { source, viz } = tile;
  const metrics = source.metrics.map(adhocMetric);
  const adhoc_filters: Record<string, unknown>[] = source.filters.map(adhocFilter);
  if (source.timeRange && timeColumn) {
    // Superset 6 charts carry the time range as a filter; the native filter replaces its value.
    adhoc_filters.push({ expressionType: "SIMPLE", clause: "WHERE", subject: timeColumn, operator: "TEMPORAL_RANGE", comparator: defaultRange });
  }
  const sortMetric = source.orderBy
    ? (metrics.find((m, i) => metricLabel(source.metrics[i] as Metric) === source.orderBy?.column) ?? source.orderBy.column)
    : metrics[0];
  const base = { datasource: `${source.datasetId}__table`, adhoc_filters, row_limit: source.rowLimit };

  switch (viz.type) {
    case "big_number":
      return {
        ...base,
        viz_type: "big_number_total",
        metric: metrics[source.metrics.findIndex((m) => metricLabel(m) === viz.value)] ?? metrics[0],
        subheader: viz.unit ?? "",
        y_axis_format: FORMAT[viz.format ?? "compact"],
        header_font_size: 0.4,
        subheader_font_size: 0.15,
      };
    case "table":
      return {
        ...base,
        viz_type: "table",
        query_mode: "aggregate",
        groupby: source.dimensions,
        metrics,
        timeseries_limit_metric: sortMetric,
        order_desc: !source.orderBy || source.orderBy.desc,
        server_pagination: false,
        table_timestamp_format: "smart_date",
      };
    default: {
      const temporal = Boolean(source.timeGrain) && viz.x === source.timeColumn;
      const shared = {
        ...base,
        x_axis: viz.x,
        metrics,
        groupby: viz.series ? [viz.series] : [],
        y_axis_format: FORMAT[viz.format ?? "compact"],
        show_legend: Boolean(viz.series),
        rich_tooltip: true,
        stack: viz.stacked ? "Stack" : null,
        ...(temporal ? { time_grain_sqla: source.timeGrain, x_axis_time_format: "smart_date" } : {}),
        ...(!temporal && { x_axis_sort: metricLabel(source.metrics[0] as Metric), x_axis_sort_asc: false }),
        ...(!temporal && { timeseries_limit_metric: sortMetric, order_desc: true }),
      };
      if (viz.type === "line") return { ...shared, viz_type: "echarts_timeseries_line" };
      if (viz.type === "area") return { ...shared, viz_type: "echarts_area" };
      return { ...shared, viz_type: "echarts_timeseries_bar", orientation: viz.horizontal ? "horizontal" : "vertical" };
    }
  }
}

/** Tiles grouped into Superset rows by their top edge, left to right. */
function rows(tiles: Tile[]): Tile[][] {
  const byY = new Map<number, Tile[]>();
  for (const t of tiles) byY.set(t.layout.y, [...(byY.get(t.layout.y) ?? []), t]);
  return [...byY.entries()].sort(([a], [b]) => a - b).map(([, r]) => r.sort((a, b) => a.layout.x - b.layout.x));
}

function positionJson(spec: Dashboard, chartIds: Map<string, number>) {
  const pos: Record<string, unknown> = {
    DASHBOARD_VERSION_KEY: "v2",
    ROOT_ID: { type: "ROOT", id: "ROOT_ID", children: ["GRID_ID"] },
    HEADER_ID: { type: "HEADER", id: "HEADER_ID", meta: { text: spec.title } },
  };
  const grid: string[] = [];
  if (spec.summary) {
    pos["ROW-summary"] = { type: "ROW", id: "ROW-summary", children: ["MARKDOWN-summary"], parents: ["ROOT_ID", "GRID_ID"], meta: { background: "BACKGROUND_TRANSPARENT" } };
    pos["MARKDOWN-summary"] = {
      type: "MARKDOWN",
      id: "MARKDOWN-summary",
      children: [],
      parents: ["ROOT_ID", "GRID_ID", "ROW-summary"],
      meta: { width: 12, height: 8, code: spec.summary },
    };
    grid.push("ROW-summary");
  }
  rows(spec.tiles).forEach((row, i) => {
    const rowId = `ROW-${i}`;
    grid.push(rowId);
    pos[rowId] = {
      type: "ROW",
      id: rowId,
      children: row.map((t) => `CHART-${t.id}`),
      parents: ["ROOT_ID", "GRID_ID"],
      meta: { background: "BACKGROUND_TRANSPARENT" },
    };
    for (const t of row) {
      pos[`CHART-${t.id}`] = {
        type: "CHART",
        id: `CHART-${t.id}`,
        children: [],
        parents: ["ROOT_ID", "GRID_ID", rowId],
        meta: { chartId: chartIds.get(t.id), width: t.layout.w, height: heightUnits(t.layout.h), sliceName: t.title },
      };
    }
  });
  pos.GRID_ID = { type: "GRID", id: "GRID_ID", children: grid, parents: ["ROOT_ID"] };
  return pos;
}

function nativeFilters(spec: Dashboard, chartIds: Map<string, number>) {
  return spec.filters.map((f) => {
    const inScope = spec.tiles.filter((t) => t.source.timeRange === `$${f.id}`).map((t) => chartIds.get(t.id));
    return {
      id: `NATIVE_FILTER-${f.id}`,
      name: f.label,
      filterType: "filter_time",
      type: "NATIVE_FILTER",
      targets: [{}],
      controlValues: { enableEmptyFilter: false },
      defaultDataMask: {
        extraFormData: { time_range: f.default },
        filterState: { value: f.default },
        ownState: {},
      },
      cascadeParentIds: [],
      scope: { rootPath: ["ROOT_ID"], excluded: spec.tiles.map((t) => chartIds.get(t.id)).filter((id) => !inScope.includes(id)) },
      chartsInScope: inScope,
      description: "",
    };
  });
}

async function removeOldMirror(slug: string): Promise<void> {
  const res = await fetch(`${SUPERSET}/api/v1/dashboard/${slug}`, { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 404) return;
  const { result } = (await res.json()) as { result: { id: number } };
  const charts = await api<{ result: { id: number }[] }>("GET", `/api/v1/dashboard/${result.id}/charts`);
  await api("DELETE", `/api/v1/dashboard/${result.id}`);
  for (const c of charts.result) await api("DELETE", `/api/v1/chart/${c.id}`);
  console.log(`Replaced the earlier mirror (dashboard ${result.id}, ${charts.result.length} charts).`);
}

async function main() {
  const stored = (await (await fetch(`${UI}/api/dashboards/${DASHBOARD_ID}`)).json()) as StoredDashboard;
  if (!stored?.spec) throw new Error(`No Holotable dashboard "${DASHBOARD_ID}" at ${UI}.`);
  const spec = stored.spec;
  await login();
  const slug = mirrorSlug(spec.id);
  await removeOldMirror(slug);

  const theme = DARK
    ? (await api<{ result: { id: number; theme_name: string }[] }>("GET", "/api/v1/theme/?q=(page_size:100)")).result.find((t) => t.theme_name === "THEME_DARK")?.id
    : undefined;
  const dash = await api<{ id: number }>("POST", "/api/v1/dashboard/", {
    dashboard_title: spec.title,
    slug,
    published: true,
    ...(theme && { theme_id: theme }),
  });

  const chartIds = new Map<string, number>();
  const datasets = new Map<number, string | null>();
  for (const tile of spec.tiles) {
    const dsId = tile.source.datasetId;
    if (!datasets.has(dsId)) {
      const ds = await api<{ result: { main_dttm_col: string | null } }>("GET", `/api/v1/dataset/${dsId}`);
      datasets.set(dsId, ds.result.main_dttm_col);
    }
    const mainDttm = datasets.get(dsId) ?? null;
    const timeColumn = tile.source.timeColumn ?? mainDttm;
    const defaultRange = spec.filters.find((f) => `$${f.id}` === tile.source.timeRange)?.default ?? tile.source.timeRange ?? "No filter";
    const params = formData(tile, timeColumn, defaultRange);
    const defaults = Object.fromEntries(spec.filters.map((f) => [f.id, f.default]));
    const queryContext = { ...buildChartDataPayload(tile.source, defaults, { id: dsId, mainDttmCol: mainDttm }), form_data: params };
    const chart = await api<{ id: number }>("POST", "/api/v1/chart/", {
      slice_name: tile.title,
      viz_type: params.viz_type,
      datasource_id: dsId,
      datasource_type: "table",
      params: JSON.stringify(params),
      query_context: JSON.stringify(queryContext),
      description: tile.note ?? null,
      dashboards: [dash.id],
    });
    chartIds.set(tile.id, chart.id);
    console.log(`  chart ${chart.id}: ${params.viz_type} "${tile.title}"`);
  }

  await api("PUT", `/api/v1/dashboard/${dash.id}`, {
    position_json: JSON.stringify(positionJson(spec, chartIds)),
    json_metadata: JSON.stringify({
      native_filter_configuration: nativeFilters(spec, chartIds),
      color_scheme: "supersetColors",
      refresh_frequency: 0,
      timed_refresh_immune_slices: [],
      expanded_slices: {},
      cross_filters_enabled: false,
    }),
  });
  console.log(`Mirrored "${spec.title}" to ${SUPERSET}/superset/dashboard/${slug}/ (log in as ${USERNAME}).`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
