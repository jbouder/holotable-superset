import { z } from "zod";

/**
 * The dashboard spec: the one contract between the agent, the API, storage
 * and the UI. Every type is inferred from these schemas; nothing defines a
 * parallel shape.
 *
 * A tile carries its own Superset query (`source`) and a Holotable chart
 * config (`viz`). No Superset chart or dashboard is ever created.
 */

export const SPEC_VERSION = 1;
export const GRID_COLUMNS = 12;

const Id = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/, "letters, digits, _ and - only");

/** Superset's own operators for a chart data filter. */
export const FILTER_OPS = [
  "==",
  "!=",
  ">",
  "<",
  ">=",
  "<=",
  "IN",
  "NOT IN",
  "LIKE",
  "ILIKE",
  "IS NULL",
  "IS NOT NULL",
] as const;

export const SourceFilter = z
  .object({
    col: z.string().min(1),
    op: z.enum(FILTER_OPS),
    val: z.union([z.string(), z.number(), z.boolean(), z.array(z.union([z.string(), z.number()]))]).optional(),
  })
  .strict()
  .superRefine((f, ctx) => {
    const unary = f.op === "IS NULL" || f.op === "IS NOT NULL";
    const list = f.op === "IN" || f.op === "NOT IN";
    if (unary && f.val !== undefined) ctx.addIssue({ code: "custom", message: `${f.op} takes no val` });
    if (!unary && f.val === undefined) ctx.addIssue({ code: "custom", message: `${f.op} needs a val` });
    if (list && !Array.isArray(f.val)) ctx.addIssue({ code: "custom", message: `${f.op} needs a list val` });
  });
export type SourceFilter = z.infer<typeof SourceFilter>;

export const AGGREGATES = ["SUM", "AVG", "COUNT", "COUNT_DISTINCT", "MIN", "MAX"] as const;

/**
 * A metric is either a saved metric on the dataset, by name, or a simple
 * aggregate over one column. Its label is the column name the tile's rows
 * carry, which is what `viz` refers to.
 */
export const Metric = z.union([
  z.string().min(1),
  z
    .object({
      column: z.string().min(1),
      aggregate: z.enum(AGGREGATES),
      label: z.string().min(1).optional(),
    })
    .strict(),
]);
export type Metric = z.infer<typeof Metric>;

export function metricLabel(metric: Metric): string {
  if (typeof metric === "string") return metric;
  return metric.label ?? `${metric.aggregate.toLowerCase()}__${metric.column}`;
}

/** ISO 8601 durations Superset accepts as a time grain. */
export const TIME_GRAINS = ["PT1H", "P1D", "P1W", "P1M", "P3M", "P1Y"] as const;

/** A `$<filter id>` reference to a dashboard filter, or a literal Superset time range. */
const TimeRangeRef = z.string().min(1);

export const SupersetMetricsSource = z
  .object({
    type: z.literal("superset_metrics"),
    datasetId: z.number().int().positive(),
    metrics: z.array(Metric).min(1).max(10),
    /** Group-by columns. With `timeGrain`, `timeColumn` may appear here and is bucketed. */
    dimensions: z.array(z.string().min(1)).max(5).default([]),
    filters: z.array(SourceFilter).max(10).default([]),
    /** `$f_time` for the dashboard's time filter, a literal like "Last year", or omitted for none. */
    timeRange: TimeRangeRef.optional(),
    /** The temporal column the time range applies to; the dataset's main datetime column when omitted. */
    timeColumn: z.string().min(1).optional(),
    timeGrain: z.enum(TIME_GRAINS).optional(),
    orderBy: z
      .object({ column: z.string().min(1), desc: z.boolean().default(true) })
      .strict()
      .optional(),
    rowLimit: z.number().int().min(1).max(10_000).default(1000),
  })
  .strict();
export type SupersetMetricsSource = z.infer<typeof SupersetMetricsSource>;
export type SupersetMetricsSourceInput = z.input<typeof SupersetMetricsSource>;

export const TileSource = SupersetMetricsSource;
export type TileSource = SupersetMetricsSource;

/** Columns a source's rows will carry: its dimensions, then its metric labels. */
export function sourceColumns(source: TileSource): string[] {
  return [...source.dimensions, ...source.metrics.map(metricLabel)];
}

export const NUMBER_FORMATS = ["number", "compact", "percent", "currency"] as const;
const NumberFormat = z.enum(NUMBER_FORMATS).optional();

const SeriesViz = {
  /** The category or time column across. */
  x: z.string().min(1),
  /** One or more numeric columns up. */
  y: z.union([z.string().min(1), z.array(z.string().min(1)).min(1).max(8)]),
  /** Split one `y` into a series per value of this column (long rows to wide). */
  series: z.string().min(1).optional(),
  stacked: z.boolean().optional(),
  format: NumberFormat,
};

export const Viz = z.discriminatedUnion("type", [
  z.object({ type: z.literal("bar"), ...SeriesViz, horizontal: z.boolean().optional() }).strict(),
  z.object({ type: z.literal("line"), ...SeriesViz }).strict(),
  z.object({ type: z.literal("area"), ...SeriesViz }).strict(),
  z
    .object({
      type: z.literal("big_number"),
      value: z.string().min(1),
      format: NumberFormat,
      /** Optional caption under the number, such as "births". */
      unit: z.string().max(32).optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("table"),
      /** Columns to show, in order; all of them when omitted. */
      columns: z.array(z.string().min(1)).max(20).optional(),
      format: NumberFormat,
    })
    .strict(),
]);
export type Viz = z.infer<typeof Viz>;
export const VIZ_TYPES = ["bar", "line", "area", "big_number", "table"] as const satisfies readonly Viz["type"][];
export type VizType = (typeof VIZ_TYPES)[number];

/** Every column a viz reads. Each must be one of the source's columns. */
export function vizColumns(viz: Viz): string[] {
  switch (viz.type) {
    case "bar":
    case "line":
    case "area":
      return [viz.x, ...(Array.isArray(viz.y) ? viz.y : [viz.y]), ...(viz.series ? [viz.series] : [])];
    case "big_number":
      return [viz.value];
    case "table":
      return viz.columns ?? [];
  }
}

export const Layout = z
  .object({
    x: z.number().int().min(0).max(GRID_COLUMNS - 1),
    y: z.number().int().min(0).max(200),
    w: z.number().int().min(1).max(GRID_COLUMNS),
    h: z.number().int().min(1).max(12),
  })
  .strict()
  .refine((l) => l.x + l.w <= GRID_COLUMNS, { message: `x + w must be at most ${GRID_COLUMNS}` });
export type Layout = z.infer<typeof Layout>;

export const Tile = z
  .object({
    id: Id,
    title: z.string().min(1).max(120),
    source: TileSource,
    viz: Viz,
    layout: Layout,
    /** One sentence on what the tile shows, written from its data. */
    note: z.string().max(280).optional(),
  })
  .strict()
  .superRefine((tile, ctx) => {
    const available = new Set(sourceColumns(tile.source));
    for (const col of vizColumns(tile.viz)) {
      if (!available.has(col)) {
        ctx.addIssue({
          code: "custom",
          path: ["viz"],
          message: `viz uses "${col}", which the source does not return; it returns ${[...available].map((c) => `"${c}"`).join(", ")}`,
        });
      }
    }
    const t = tile.source;
    if (t.timeGrain && !t.dimensions.includes(t.timeColumn ?? "")) {
      ctx.addIssue({
        code: "custom",
        path: ["source", "timeGrain"],
        message: "timeGrain needs timeColumn set and listed in dimensions",
      });
    }
  });
export type Tile = z.infer<typeof Tile>;
export type TileInput = z.input<typeof Tile>;

export const DashboardFilter = z
  .object({
    id: Id,
    type: z.literal("time_range"),
    label: z.string().max(60).optional(),
    /** A Superset time range: "No filter", "Last year", "2000-01-01 : 2010-01-01", … */
    default: z.string().min(1),
  })
  .strict();
export type DashboardFilter = z.infer<typeof DashboardFilter>;

export const Dashboard = z
  .object({
    id: Id,
    title: z.string().min(1).max(120),
    summary: z.string().max(500).optional(),
    filters: z.array(DashboardFilter).max(5).default([]),
    tiles: z.array(Tile).max(24).default([]),
  })
  .strict()
  .superRefine((d, ctx) => {
    const tileIds = new Set<string>();
    d.tiles.forEach((t, i) => {
      if (tileIds.has(t.id)) ctx.addIssue({ code: "custom", path: ["tiles", i, "id"], message: `duplicate tile id "${t.id}"` });
      tileIds.add(t.id);
    });
    const filterIds = new Set(d.filters.map((f) => f.id));
    d.tiles.forEach((t, i) => {
      const ref = t.source.timeRange;
      if (ref?.startsWith("$") && !filterIds.has(ref.slice(1))) {
        ctx.addIssue({
          code: "custom",
          path: ["tiles", i, "source", "timeRange"],
          message: `"${ref}" names no dashboard filter`,
        });
      }
    });
  });
export type Dashboard = z.infer<typeof Dashboard>;
export type DashboardInput = z.input<typeof Dashboard>;

/** A stored dashboard as the API returns it. */
export interface StoredDashboard {
  spec: Dashboard;
  version: number;
  updatedAt: string;
}

/** Filter values in effect: dashboard filter id to Superset time range. */
export type FilterState = Record<string, string>;

export function defaultFilterState(d: Dashboard): FilterState {
  return Object.fromEntries(d.filters.map((f) => [f.id, f.default]));
}

/** Resolve a tile's time range against the filters in effect. */
export function resolveTimeRange(source: TileSource, state: FilterState): string | undefined {
  const ref = source.timeRange;
  if (!ref) return undefined;
  if (!ref.startsWith("$")) return ref;
  return state[ref.slice(1)];
}

/** What the data endpoint returns for one tile. */
export type ColumnType = "number" | "string" | "time" | "boolean";
export interface TileData {
  columns: { name: string; type: ColumnType }[];
  rows: Record<string, unknown>[];
  /** The SQL Superset ran, for the "show query" toggle. */
  query?: string;
  cached?: boolean;
}
export type TileResult = { ok: true; data: TileData } | { ok: false; error: string };
export interface DashboardData {
  filters: FilterState;
  tiles: Record<string, TileResult>;
}

/** A chat turn sent to `POST /chat`. Earlier turns travel as plain text. */
export const ChatRequest = z
  .object({
    message: z.string().trim().min(1).max(4000),
    /** The open dashboard; the agent edits it instead of making a new one. */
    dashboardId: Id.optional(),
    history: z
      .array(z.object({ role: z.enum(["user", "assistant"]), text: z.string().max(8000) }).strict())
      .max(20)
      .default([]),
  })
  .strict();
export type ChatRequest = z.infer<typeof ChatRequest>;
export type ChatRequestInput = z.input<typeof ChatRequest>;

/** Server-sent events from `POST /chat`, one JSON object per `data:` line. */
export type ChatEvent =
  /** One short, human-readable line per meaningful step. */
  | { type: "step"; text: string; status: "ok" | "rejected" | "info" }
  /** A dashboard was created or changed; the UI refetches it. */
  | { type: "dashboard"; id: string; version: number }
  /** The agent's closing words to the user. */
  | { type: "message"; text: string }
  | { type: "error"; message: string }
  | { type: "done"; dashboardId?: string; seconds: number };
