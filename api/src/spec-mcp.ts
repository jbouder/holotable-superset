import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import {
  AGGREGATES,
  Dashboard,
  DashboardFilter,
  defaultFilterState,
  FILTER_OPS,
  GRID_COLUMNS,
  Layout,
  NUMBER_FORMATS,
  SupersetMetricsSource,
  TIME_GRAINS,
  Tile,
  type TileData,
  Viz,
} from "@poc/spec";
import { z } from "zod";
import { createDashboard, getDashboard, listDashboards, mutateDashboard } from "./db.ts";
import { getDataset, runSource, SourceError } from "./superset-client.ts";
import {
  checkResult,
  checkSourceAgainstDataset,
  defaultSize,
  findFreeSlot,
  layoutOverlaps,
  makeId,
  overlaps,
} from "./tile-checks.ts";

/**
 * The spec MCP server: the only way the agent changes a dashboard. Every
 * write is validated against the Zod spec, and every tile's query is run
 * through the Superset client before it is saved, so a stored tile always
 * renders. Rejections come back as tool errors that say what to change.
 */

class Rejected extends Error {
  constructor(readonly problems: string[]) {
    super(problems.join("; "));
  }
}

function ok(body: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(body, null, 2) }] };
}

function zodProblems(err: z.ZodError, prefix = ""): string[] {
  return err.issues.map((i) => {
    const path = [prefix, ...i.path.map(String)].filter(Boolean).join(".");
    return path ? `${path}: ${i.message}` : i.message;
  });
}

/** Run a tool body; turn validation failures into an error result the agent can act on. */
async function guarded(tool: string, body: () => Promise<CallToolResult>): Promise<CallToolResult> {
  try {
    return await body();
  } catch (err) {
    const problems =
      err instanceof Rejected
        ? err.problems
        : err instanceof z.ZodError
          ? zodProblems(err)
          : err instanceof SourceError
            ? [err.message]
            : null;
    if (!problems) {
      console.error(`spec mcp ${tool}`, err);
      return { isError: true, content: [{ type: "text", text: `${tool} failed: internal error. Try again.` }] };
    }
    const text = `${tool} rejected. Nothing was saved.\n${problems.map((p) => `- ${p}`).join("\n")}`;
    return { isError: true, content: [{ type: "text", text }] };
  }
}

async function load(id: string): Promise<Dashboard> {
  const stored = await getDashboard(id);
  if (!stored) {
    const ids = (await listDashboards()).map((d) => d.spec.id);
    throw new Rejected([`no dashboard "${id}". Existing ids: ${ids.join(", ") || "none"}.`]);
  }
  return stored.spec;
}

/**
 * Check a tile against its dataset, run its query with the dashboard's
 * default filters, and check the result against the viz. Returns the rows
 * for a preview.
 */
async function proveTile(tile: Tile, dashboard: Dashboard): Promise<TileData> {
  const dataset = await getDataset(tile.source.datasetId);
  const sourceProblems = checkSourceAgainstDataset(tile.source, dataset);
  if (sourceProblems.length) throw new Rejected(sourceProblems);

  const filters = defaultFilterState(dashboard);
  let data: TileData;
  try {
    data = await runSource(tile.source, filters);
  } catch (err) {
    if (err instanceof SourceError) throw new Rejected([`Superset rejected the query: ${err.message}`]);
    throw err;
  }
  const resultProblems = checkResult(tile.viz, data);
  if (resultProblems.length) {
    const context = Object.entries(filters).map(([k, v]) => `${k} = "${v}"`);
    if (data.rows.length === 0 && context.length && tile.source.timeRange) {
      resultProblems.push(`The query ran with the dashboard's filter defaults: ${context.join(", ")}.`);
    }
    throw new Rejected(resultProblems);
  }
  return data;
}

function preview(data: TileData) {
  return { columns: data.columns, rowCount: data.rows.length, firstRows: data.rows.slice(0, 5) };
}

function summarize(d: Dashboard, version: number) {
  return {
    id: d.id,
    title: d.title,
    version,
    tiles: d.tiles.map((t) => ({ id: t.id, title: t.title, viz: t.viz.type, layout: t.layout })),
  };
}

const VIZ_GUIDE = {
  vizTypes: [
    {
      type: "big_number",
      fields: { value: "a numeric column", format: NUMBER_FORMATS, unit: "short caption, optional" },
      use: "One headline number. The source has no dimensions, so it returns one row.",
      defaultSize: defaultSize("big_number"),
    },
    {
      type: "line",
      fields: { x: "time column", y: "numeric column or list", series: "optional column to split y by", format: NUMBER_FORMATS },
      use: "A trend over time. Put the time column in dimensions and set timeColumn and timeGrain.",
      defaultSize: defaultSize("line"),
    },
    {
      type: "area",
      fields: { x: "time column", y: "numeric column or list", series: "optional", stacked: "boolean", format: NUMBER_FORMATS },
      use: "A trend over time where the total and the parts both matter.",
      defaultSize: defaultSize("area"),
    },
    {
      type: "bar",
      fields: { x: "category column", y: "numeric column or list", series: "optional", stacked: "boolean", horizontal: "boolean", format: NUMBER_FORMATS },
      use: "Compare categories. Set rowLimit (10 to 20) so the top values fit.",
      defaultSize: defaultSize("bar"),
    },
    {
      type: "table",
      fields: { columns: "columns to show, in order; all when omitted", format: NUMBER_FORMATS },
      use: "Detail rows or rankings with several columns.",
      defaultSize: defaultSize("table"),
    },
  ],
  source: {
    type: "superset_metrics",
    datasetId: "a Superset dataset id (Superset MCP list_datasets, get_dataset_info)",
    metrics: [
      "a saved metric name on the dataset, such as \"count\"",
      `or {"column": "<column>", "aggregate": one of ${AGGREGATES.join(", ")}, "label": "<optional>"}; its row column is the label, or "<aggregate lowercase>__<column>"`,
    ],
    dimensions: "group-by columns; the rows carry these, then one column per metric",
    filters: `[{"col", "op": one of ${FILTER_OPS.join(", ")}, "val"}]`,
    timeRange: "\"$<filter id>\" to follow a dashboard filter (\"$f_time\"), or a literal: \"No filter\", \"Last year\", \"2000-01-01 : 2010-01-01\"",
    timeColumn: "temporal column the time range and grain apply to; the dataset default when omitted",
    timeGrain: TIME_GRAINS,
    orderBy: "{\"column\": \"<metric label or column>\", \"desc\": true}",
    rowLimit: "1 to 10000, default 1000",
  },
  grid: { columns: GRID_COLUMNS, note: "Layout is {x, y, w, h} in grid units. Omit it on add_tile to place the tile in the first free spot." },
};

/** A tile as add_tile takes it: the spec's Tile, with id and layout optional. */
const TileArgs = {
  id: z.string().optional().describe("Tile id; made from the title when omitted"),
  title: z.string().describe("Short title shown on the tile"),
  source: SupersetMetricsSource.describe("The tile's Superset query"),
  viz: Viz.describe("How the rows are drawn; see list_viz_types"),
  layout: Layout.optional().describe("Grid position; the first free spot when omitted"),
  note: z.string().optional().describe("One sentence on what the data shows, written from the preview rows"),
};

export function createSpecMcpServer(): McpServer {
  const server = new McpServer({ name: "holotable-spec", version: "0.3.0" });

  server.registerTool(
    "list_viz_types",
    {
      description: "The viz types a tile can use, their fields, the tile source format, and the grid. Read this before add_tile.",
      annotations: { readOnlyHint: true },
    },
    async () => ok(VIZ_GUIDE),
  );

  server.registerTool(
    "list_dashboards",
    { description: "Saved dashboards: id, title, tile count and version.", annotations: { readOnlyHint: true } },
    async () =>
      guarded("list_dashboards", async () =>
        ok(
          (await listDashboards()).map(({ spec, version, updatedAt }) => ({
            id: spec.id,
            title: spec.title,
            tiles: spec.tiles.length,
            version,
            updatedAt,
          })),
        ),
      ),
  );

  server.registerTool(
    "get_dashboard",
    {
      description: "One dashboard's full spec and version.",
      inputSchema: { id: z.string() },
      annotations: { readOnlyHint: true },
    },
    async ({ id }) =>
      guarded("get_dashboard", async () => {
        const stored = await getDashboard(id);
        if (!stored) await load(id);
        return ok(stored);
      }),
  );

  server.registerTool(
    "create_dashboard",
    {
      description:
        'Create an empty dashboard. It gets one time filter, "f_time" (default "No filter"), unless filters are given. Tiles reference it with "timeRange": "$f_time".',
      inputSchema: {
        title: z.string(),
        summary: z.string().optional().describe("One or two sentences on what the dashboard shows"),
        id: z.string().optional().describe("Dashboard id; made from the title when omitted"),
        filters: z.array(DashboardFilter).optional(),
      },
    },
    async ({ title, summary, id, filters }) =>
      guarded("create_dashboard", async () => {
        const used = new Set((await listDashboards()).map((d) => d.spec.id));
        const spec = Dashboard.parse({
          id: id ?? makeId("", title, used),
          title,
          summary,
          filters: filters ?? [{ id: "f_time", type: "time_range", label: "Time range", default: "No filter" }],
          tiles: [],
        });
        const stored = await createDashboard(spec);
        if (!stored) throw new Rejected([`dashboard id "${spec.id}" is taken. Pick another id or omit it.`]);
        return ok({ ...summarize(stored.spec, stored.version), filters: stored.spec.filters });
      }),
  );

  server.registerTool(
    "add_tile",
    {
      description:
        "Add a tile. The tile's query runs against Superset first. The tile is rejected, with the reason, if the query fails, returns no rows, or lacks a column the viz uses. Returns the saved tile and its first rows.",
      inputSchema: { dashboardId: z.string(), ...TileArgs },
    },
    async ({ dashboardId, ...args }) =>
      guarded("add_tile", async () => {
        const dashboard = await load(dashboardId);
        const used = new Set(dashboard.tiles.map((t) => t.id));
        const tileId = args.id ?? makeId("t_", args.title, used);
        if (used.has(tileId)) throw new Rejected([`tile id "${tileId}" is taken on this dashboard. Pick another id or omit it.`]);

        const taken = dashboard.tiles.map((t) => t.layout);
        const layout = args.layout ?? findFreeSlot(taken, defaultSize(args.viz.type));
        const clash = dashboard.tiles.find((t) => overlaps(t.layout, layout));
        if (clash) {
          const free = findFreeSlot(taken, { w: layout.w, h: layout.h });
          throw new Rejected([
            `layout overlaps tile "${clash.id}". A free spot of that size: ${JSON.stringify(free)}. Or omit layout.`,
          ]);
        }

        const tile = Tile.parse({ ...args, id: tileId, layout });
        const data = await proveTile(tile, dashboard);
        const stored = await mutateDashboard(dashboardId, (d) => ({ ...d, tiles: [...d.tiles, tile] }));
        if (!stored) await load(dashboardId);
        return ok({ dashboardId, version: stored?.version, tile, preview: preview(data) });
      }),
  );

  server.registerTool(
    "update_tile",
    {
      description:
        "Change one tile and leave the others alone. Fields not given keep their value. `source` is merged field by field into the current source; `viz` replaces the current viz. A changed source or viz is run and checked like add_tile.",
      inputSchema: {
        dashboardId: z.string(),
        tileId: z.string(),
        title: z.string().optional(),
        source: z
          .record(z.string(), z.unknown())
          .optional()
          .describe("Source fields to change, same names as add_tile's source; others keep their value"),
        viz: Viz.optional(),
        layout: Layout.optional(),
        note: z.string().nullable().optional().describe("New note, or null to remove it"),
      },
    },
    async ({ dashboardId, tileId, title, source, viz, layout, note }) =>
      guarded("update_tile", async () => {
        const dashboard = await load(dashboardId);
        const current = dashboard.tiles.find((t) => t.id === tileId);
        if (!current) {
          throw new Rejected([`no tile "${tileId}" on "${dashboardId}". Tiles: ${dashboard.tiles.map((t) => t.id).join(", ") || "none"}.`]);
        }
        const draft: Record<string, unknown> = {
          ...current,
          ...(title !== undefined && { title }),
          ...(viz && { viz }),
          ...(layout && { layout }),
          source: source ? SupersetMetricsSource.parse({ ...current.source, ...source }) : current.source,
        };
        if (note === null) delete draft.note;
        else if (note !== undefined) draft.note = note;
        const tile = Tile.parse(draft);

        if (layout) {
          const clash = dashboard.tiles.find((t) => t.id !== tileId && overlaps(t.layout, tile.layout));
          if (clash) throw new Rejected([`layout overlaps tile "${clash.id}". Move that tile too with set_layout.`]);
        }
        const data = source || viz ? await proveTile(tile, dashboard) : null;

        const stored = await mutateDashboard(dashboardId, (d) => ({
          ...d,
          tiles: d.tiles.map((t) => (t.id === tileId ? tile : t)),
        }));
        return ok({ dashboardId, version: stored?.version, tile, ...(data && { preview: preview(data) }) });
      }),
  );

  server.registerTool(
    "remove_tile",
    {
      description: "Remove one tile. Other tiles keep their place.",
      inputSchema: { dashboardId: z.string(), tileId: z.string() },
      annotations: { destructiveHint: true },
    },
    async ({ dashboardId, tileId }) =>
      guarded("remove_tile", async () => {
        const dashboard = await load(dashboardId);
        if (!dashboard.tiles.some((t) => t.id === tileId)) {
          throw new Rejected([`no tile "${tileId}" on "${dashboardId}". Tiles: ${dashboard.tiles.map((t) => t.id).join(", ") || "none"}.`]);
        }
        const stored = await mutateDashboard(dashboardId, (d) => ({ ...d, tiles: d.tiles.filter((t) => t.id !== tileId) }));
        return ok(stored && summarize(stored.spec, stored.version));
      }),
  );

  server.registerTool(
    "set_layout",
    {
      description: `Move or resize tiles on the ${GRID_COLUMNS}-column grid in one step. Tiles not listed stay where they are. Rejected if any two tiles would overlap.`,
      inputSchema: {
        dashboardId: z.string(),
        layout: z.array(z.object({ tileId: z.string(), x: z.number().int(), y: z.number().int(), w: z.number().int(), h: z.number().int() })).min(1),
      },
    },
    async ({ dashboardId, layout }) =>
      guarded("set_layout", async () => {
        const dashboard = await load(dashboardId);
        const ids = new Set(dashboard.tiles.map((t) => t.id));
        const unknown = layout.filter((l) => !ids.has(l.tileId)).map((l) => l.tileId);
        if (unknown.length) throw new Rejected([`no tiles ${unknown.map((u) => `"${u}"`).join(", ")}. Tiles: ${[...ids].join(", ")}.`]);

        const problems: string[] = [];
        const moves = new Map(
          layout.map(({ tileId, ...l }) => {
            const parsed = Layout.safeParse(l);
            if (!parsed.success) problems.push(...zodProblems(parsed.error, tileId));
            return [tileId, l];
          }),
        );
        const tiles = dashboard.tiles.map((t) => ({ ...t, layout: moves.get(t.id) ?? t.layout }));
        problems.push(...layoutOverlaps(tiles));
        if (problems.length) throw new Rejected(problems);

        const stored = await mutateDashboard(dashboardId, (d) => ({
          ...d,
          tiles: d.tiles.map((t) => ({ ...t, layout: moves.get(t.id) ?? t.layout })),
        }));
        return ok(stored && summarize(stored.spec, stored.version));
      }),
  );

  return server;
}
