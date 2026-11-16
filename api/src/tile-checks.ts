import {
  GRID_COLUMNS,
  type Layout,
  metricLabel,
  type Tile,
  type TileData,
  type TileSource,
  type Viz,
  type VizType,
  vizColumns,
} from "@poc/spec";

/**
 * Pure checks the spec MCP server runs before it saves a tile. Each returns a
 * list of problems written for the agent: what is wrong and what it can use
 * instead. An empty list means the tile passes.
 */

export interface DatasetShape {
  id: number;
  name: string;
  mainDttmCol: string | null;
  columns: { name: string; isDttm: boolean }[];
  metrics: { name: string }[];
}

function list(names: string[], max = 40): string {
  const shown = names.slice(0, max).map((n) => `"${n}"`).join(", ");
  return names.length > max ? `${shown}, and ${names.length - max} more` : shown;
}

/** Every column and saved metric the source names must exist on the dataset. */
export function checkSourceAgainstDataset(source: TileSource, ds: DatasetShape): string[] {
  const problems: string[] = [];
  const columns = new Set(ds.columns.map((c) => c.name));
  const saved = new Set(ds.metrics.map((m) => m.name));
  const where = `dataset ${ds.id} (${ds.name})`;
  const columnHint = `Its columns are ${list([...columns])}.`;

  for (const dim of source.dimensions) {
    if (!columns.has(dim)) problems.push(`dimension "${dim}" is not a column of ${where}. ${columnHint}`);
  }
  for (const f of source.filters) {
    if (!columns.has(f.col)) problems.push(`filter column "${f.col}" is not a column of ${where}. ${columnHint}`);
  }
  for (const m of source.metrics) {
    if (typeof m === "string") {
      if (!saved.has(m)) {
        problems.push(
          `metric "${m}" is not a saved metric of ${where}. Saved metrics: ${list([...saved]) || "none"}. ` +
            `Or use an aggregate such as {"column": "<column>", "aggregate": "SUM"}.`,
        );
      }
    } else if (!columns.has(m.column)) {
      problems.push(`metric column "${m.column}" is not a column of ${where}. ${columnHint}`);
    }
  }

  const temporal = ds.columns.filter((c) => c.isDttm).map((c) => c.name);
  if (source.timeColumn && !columns.has(source.timeColumn)) {
    problems.push(`timeColumn "${source.timeColumn}" is not a column of ${where}. Temporal columns: ${list(temporal) || "none"}.`);
  } else if (source.timeColumn && !temporal.includes(source.timeColumn)) {
    problems.push(`timeColumn "${source.timeColumn}" is not temporal. Temporal columns: ${list(temporal) || "none"}.`);
  }
  if (source.timeRange && !source.timeColumn && !ds.mainDttmCol) {
    problems.push(
      `${where} has no default datetime column, so timeRange needs a timeColumn. ` +
        `Temporal columns: ${list(temporal) || "none (drop timeRange)"}.`,
    );
  }

  if (source.orderBy) {
    const orderable = new Set([...columns, ...saved, ...source.metrics.map(metricLabel)]);
    if (!orderable.has(source.orderBy.column)) {
      problems.push(`orderBy column "${source.orderBy.column}" is not a column, saved metric or metric label of this source.`);
    }
  }
  return problems;
}

const SERIES = new Set<VizType>(["bar", "line", "area"]);

/** The query's actual result must have rows and every column the viz reads, with numbers where numbers are drawn. */
export function checkResult(viz: Viz, data: TileData): string[] {
  // A total over rows that match nothing comes back as one row of nulls.
  const numbers = data.columns.filter((c) => c.type === "number").map((c) => c.name);
  const allNull = numbers.length > 0 && data.rows.every((r) => numbers.every((n) => r[n] == null));
  if (data.rows.length === 0 || allNull) {
    return ["the query matched no data. Loosen its filters or time range, or check the filter values against the data."];
  }
  const problems: string[] = [];
  const types = new Map(data.columns.map((c) => [c.name, c.type]));
  const returned = `The query returns ${list(data.columns.map((c) => c.name))}.`;

  for (const col of vizColumns(viz)) {
    if (!types.has(col)) problems.push(`viz uses "${col}", which the query does not return. ${returned}`);
  }

  const numeric =
    viz.type === "big_number" ? [viz.value] : SERIES.has(viz.type) && "y" in viz ? [viz.y].flat() : [];
  for (const col of numeric) {
    const type = types.get(col);
    if (type && type !== "number") problems.push(`viz plots "${col}" as a number, but it is ${type}. Use a metric for it.`);
  }

  if (viz.type === "big_number" && data.rows.length > 1) {
    problems.push(
      `big_number shows one value, but the query returns ${data.rows.length} rows. ` +
        `Remove the dimensions, or use a bar or table viz.`,
    );
  }
  return problems;
}

/** Default tile size per viz type, in grid units. */
export function defaultSize(type: VizType): { w: number; h: number } {
  return type === "big_number" ? { w: 4, h: 3 } : { w: 6, h: 4 };
}

export function overlaps(a: Layout, b: Layout): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/** The first free spot, scanning rows top to bottom and left to right. */
export function findFreeSlot(taken: Layout[], size: { w: number; h: number }): Layout {
  for (let y = 0; ; y++) {
    for (let x = 0; x + size.w <= GRID_COLUMNS; x++) {
      const spot = { x, y, ...size };
      if (!taken.some((t) => overlaps(t, spot))) return spot;
    }
  }
}

/** Pairs of tiles whose layouts overlap, as readable problems. */
export function layoutOverlaps(tiles: Pick<Tile, "id" | "layout">[]): string[] {
  const problems: string[] = [];
  for (let i = 0; i < tiles.length; i++) {
    for (let j = i + 1; j < tiles.length; j++) {
      const a = tiles[i] as Tile;
      const b = tiles[j] as Tile;
      if (overlaps(a.layout, b.layout)) problems.push(`tile "${a.id}" overlaps tile "${b.id}".`);
    }
  }
  return problems;
}

/** A url-safe id from a title, made unique against the ids already used. */
export function makeId(prefix: string, title: string, used: Set<string>): string {
  const base =
    prefix +
    (title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 40) || "item");
  let id = base;
  for (let n = 2; used.has(id); n++) id = `${base}_${n}`;
  return id;
}
