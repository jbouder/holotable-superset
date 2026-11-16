import {
  type FilterState,
  type Metric,
  metricLabel,
  resolveTimeRange,
  type TileData,
  type TileSource,
} from "@poc/spec";

/**
 * Pure translation between a tile source and Superset's chart data API.
 * `superset-client.ts` is the only caller and the only module that talks to
 * Superset over HTTP.
 */

/** What the translator needs to know about the dataset. */
export interface DatasetFacts {
  id: number;
  mainDttmCol: string | null;
}

type SupersetMetric =
  | string
  | {
      expressionType: "SIMPLE";
      column: { column_name: string };
      aggregate: string;
      label: string;
    };

type SupersetColumn =
  | string
  | {
      expressionType: "SQL";
      sqlExpression: string;
      label: string;
      columnType: "BASE_AXIS";
      timeGrain: string;
    };

export interface ChartDataPayload {
  datasource: { id: number; type: "table" };
  force: boolean;
  result_format: "json";
  result_type: "full";
  queries: {
    columns: SupersetColumn[];
    metrics: SupersetMetric[];
    filters: { col: string; op: string; val?: unknown }[];
    orderby: [SupersetMetric | string, boolean][];
    row_limit: number;
  }[];
}

function toSupersetMetric(metric: Metric): SupersetMetric {
  if (typeof metric === "string") return metric;
  return {
    expressionType: "SIMPLE",
    column: { column_name: metric.column },
    aggregate: metric.aggregate,
    label: metricLabel(metric),
  };
}

export class SourceError extends Error {}

export function buildChartDataPayload(
  source: TileSource,
  state: FilterState,
  dataset: DatasetFacts,
): ChartDataPayload {
  const metrics = source.metrics.map(toSupersetMetric);
  const timeColumn = source.timeColumn ?? dataset.mainDttmCol;

  const columns: SupersetColumn[] = source.dimensions.map((dim) =>
    source.timeGrain && dim === timeColumn
      ? {
          expressionType: "SQL",
          sqlExpression: dim,
          label: dim,
          columnType: "BASE_AXIS",
          timeGrain: source.timeGrain,
        }
      : dim,
  );

  const filters: ChartDataPayload["queries"][number]["filters"] = source.filters.map((f) =>
    f.val === undefined ? { col: f.col, op: f.op } : { col: f.col, op: f.op, val: f.val },
  );

  const timeRange = resolveTimeRange(source, state);
  if (timeRange && timeRange !== "No filter") {
    if (!timeColumn) {
      throw new SourceError(
        `dataset ${dataset.id} has no main datetime column; set source.timeColumn to apply a time range`,
      );
    }
    filters.push({ col: timeColumn, op: "TEMPORAL_RANGE", val: timeRange });
  }

  const orderby: ChartDataPayload["queries"][number]["orderby"] = [];
  if (source.orderBy) {
    const i = source.metrics.findIndex((m) => metricLabel(m) === source.orderBy?.column);
    const target = i >= 0 ? (metrics[i] as SupersetMetric) : source.orderBy.column;
    orderby.push([target, !source.orderBy.desc]);
  } else if (!source.timeGrain && metrics[0] !== undefined) {
    // Without a time axis, the biggest values first keep a row limit meaningful.
    orderby.push([metrics[0], false]);
  }

  return {
    datasource: { id: dataset.id, type: "table" },
    force: false,
    result_format: "json",
    result_type: "full",
    queries: [{ columns, metrics, filters, orderby, row_limit: source.rowLimit }],
  };
}

/** The part of `result[0]` the client reads. */
export interface ChartDataResult {
  colnames: string[];
  coltypes: number[];
  data: Record<string, unknown>[];
  query?: string;
  is_cached?: boolean;
  status?: string;
  error?: string | null;
}

const COLTYPE: Record<number, TileData["columns"][number]["type"]> = {
  0: "number",
  1: "string",
  2: "time",
  3: "boolean",
};

/**
 * Normalize Superset's result to `{columns, rows}`. Temporal values arrive as
 * epoch milliseconds and leave as ISO strings; a bucketed time axis is sorted
 * ascending, since Superset orders a grouped query by its metric.
 */
export function normalizeResult(result: ChartDataResult, source: TileSource): TileData {
  const columns = result.colnames.map((name, i) => ({
    name,
    type: COLTYPE[result.coltypes[i] ?? 1] ?? "string",
  }));
  const timeCols = columns.filter((c) => c.type === "time").map((c) => c.name);
  let rows = result.data.map((row) => {
    const out: Record<string, unknown> = { ...row };
    for (const col of timeCols) {
      const v = out[col];
      if (typeof v === "number") out[col] = new Date(v).toISOString();
    }
    return out;
  });
  const axis = source.timeGrain ? source.timeColumn : undefined;
  if (axis && timeCols.includes(axis)) {
    rows = [...rows].sort((a, b) => String(a[axis]).localeCompare(String(b[axis])));
  }
  return { columns, rows, ...(result.query ? { query: result.query } : {}) };
}
