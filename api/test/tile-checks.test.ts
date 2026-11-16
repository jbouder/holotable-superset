import { SupersetMetricsSource, type TileData, Viz } from "@poc/spec";
import { describe, expect, it } from "vitest";
import {
  checkResult,
  checkSourceAgainstDataset,
  type DatasetShape,
  findFreeSlot,
  layoutOverlaps,
  makeId,
} from "../src/tile-checks.ts";

const births: DatasetShape = {
  id: 3,
  name: "birth_names",
  mainDttmCol: "ds",
  columns: [
    { name: "ds", isDttm: true },
    { name: "gender", isDttm: false },
    { name: "state", isDttm: false },
    { name: "num", isDttm: false },
  ],
  metrics: [{ name: "count" }, { name: "sum__num" }],
};

const source = (s: object) => SupersetMetricsSource.parse({ type: "superset_metrics", datasetId: 3, ...s });

describe("checkSourceAgainstDataset", () => {
  it("passes a source that only names real columns and metrics", () => {
    const s = source({ metrics: ["sum__num", { column: "num", aggregate: "AVG" }], dimensions: ["state"] });
    expect(checkSourceAgainstDataset(s, births)).toEqual([]);
  });

  it("names the bad column and lists the real ones", () => {
    const [problem] = checkSourceAgainstDataset(source({ metrics: ["count"], dimensions: ["region"] }), births);
    expect(problem).toContain('dimension "region"');
    expect(problem).toContain('"state"');
  });

  it("lists saved metrics for an unknown metric name", () => {
    const [problem] = checkSourceAgainstDataset(source({ metrics: ["revenue"] }), births);
    expect(problem).toContain('"sum__num"');
    expect(problem).toContain("aggregate");
  });

  it("rejects a non-temporal time column", () => {
    const [problem] = checkSourceAgainstDataset(source({ metrics: ["count"], timeColumn: "state" }), births);
    expect(problem).toContain("not temporal");
  });

  it("needs a time column for a time range when the dataset has no default", () => {
    const problems = checkSourceAgainstDataset(source({ metrics: ["count"], timeRange: "Last year" }), {
      ...births,
      mainDttmCol: null,
    });
    expect(problems[0]).toContain("needs a timeColumn");
  });
});

const data = (rows: Record<string, unknown>[]): TileData => ({
  columns: [
    { name: "state", type: "string" },
    { name: "sum__num", type: "number" },
  ],
  rows,
});

describe("checkResult", () => {
  const bar = Viz.parse({ type: "bar", x: "state", y: "sum__num" });

  it("passes rows that carry every viz column", () => {
    expect(checkResult(bar, data([{ state: "CA", sum__num: 1 }]))).toEqual([]);
  });

  it("rejects an empty result", () => {
    expect(checkResult(bar, data([]))[0]).toContain("no data");
  });

  it("rejects a total over no matching rows", () => {
    const viz = Viz.parse({ type: "big_number", value: "sum__num" });
    expect(checkResult(viz, data([{ state: null, sum__num: null }]))[0]).toContain("no data");
  });

  it("rejects a viz column the query does not return", () => {
    const viz = Viz.parse({ type: "bar", x: "region", y: "sum__num" });
    expect(checkResult(viz, data([{ state: "CA", sum__num: 1 }]))[0]).toContain('"region"');
  });

  it("rejects plotting a string as a number", () => {
    const viz = Viz.parse({ type: "bar", x: "sum__num", y: "state" });
    expect(checkResult(viz, data([{ state: "CA", sum__num: 1 }])).join()).toContain("as a number");
  });

  it("rejects a big number over many rows", () => {
    const viz = Viz.parse({ type: "big_number", value: "sum__num" });
    const rows = [
      { state: "CA", sum__num: 1 },
      { state: "NY", sum__num: 2 },
    ];
    expect(checkResult(viz, data(rows))[0]).toContain("one value");
  });
});

describe("layout and ids", () => {
  it("places a tile in the first free spot", () => {
    expect(findFreeSlot([{ x: 0, y: 0, w: 6, h: 4 }], { w: 6, h: 4 })).toEqual({ x: 6, y: 0, w: 6, h: 4 });
    expect(findFreeSlot([{ x: 0, y: 0, w: 12, h: 3 }], { w: 4, h: 3 })).toEqual({ x: 0, y: 3, w: 4, h: 3 });
  });

  it("reports overlapping tiles", () => {
    const tiles = [
      { id: "a", layout: { x: 0, y: 0, w: 6, h: 4 } },
      { id: "b", layout: { x: 5, y: 3, w: 6, h: 4 } },
      { id: "c", layout: { x: 4, y: 4, w: 4, h: 2 } },
    ];
    expect(layoutOverlaps(tiles)).toEqual(['tile "a" overlaps tile "b".', 'tile "b" overlaps tile "c".']);
  });

  it("makes unique ids from titles", () => {
    expect(makeId("t_", "Births by State!", new Set())).toBe("t_births_by_state");
    expect(makeId("t_", "Births by State", new Set(["t_births_by_state"]))).toBe("t_births_by_state_2");
  });
});
