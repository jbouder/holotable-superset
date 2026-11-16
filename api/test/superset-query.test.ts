import { type SupersetMetricsSourceInput, TileSource } from "@poc/spec";
import { describe, expect, it } from "vitest";
import { buildChartDataPayload, normalizeResult, SourceError } from "../src/superset-query.ts";

const dataset = { id: 17, mainDttmCol: "ds" };
const source = (s: Omit<SupersetMetricsSourceInput, "type" | "datasetId">) =>
  TileSource.parse({ type: "superset_metrics", datasetId: 17, ...s });

describe("buildChartDataPayload", () => {
  it("maps a saved metric and dimensions to columns and metrics", () => {
    const p = buildChartDataPayload(source({ metrics: ["revenue"], dimensions: ["region"] }), {}, dataset);
    expect(p.datasource).toEqual({ id: 17, type: "table" });
    expect(p.result_format).toBe("json");
    expect(p.result_type).toBe("full");
    expect(p.queries).toHaveLength(1);
    expect(p.queries[0]).toMatchObject({
      columns: ["region"],
      metrics: ["revenue"],
      filters: [],
      row_limit: 1000,
    });
  });

  it("turns a column aggregate into a labelled SIMPLE ad hoc metric", () => {
    const p = buildChartDataPayload(
      source({ metrics: [{ column: "num", aggregate: "MAX" }, { column: "state", aggregate: "COUNT_DISTINCT", label: "states" }] }),
      {},
      dataset,
    );
    expect(p.queries[0]?.metrics).toEqual([
      { expressionType: "SIMPLE", column: { column_name: "num" }, aggregate: "MAX", label: "max__num" },
      { expressionType: "SIMPLE", column: { column_name: "state" }, aggregate: "COUNT_DISTINCT", label: "states" },
    ]);
  });

  it("passes source filters through, without val for unary operators", () => {
    const p = buildChartDataPayload(
      source({
        metrics: ["revenue"],
        filters: [
          { col: "region", op: "IN", val: ["West", "East"] },
          { col: "channel", op: "IS NOT NULL" },
        ],
      }),
      {},
      dataset,
    );
    expect(p.queries[0]?.filters).toEqual([
      { col: "region", op: "IN", val: ["West", "East"] },
      { col: "channel", op: "IS NOT NULL" },
    ]);
  });

  it("resolves a $filter time range into a TEMPORAL_RANGE filter on the main datetime column", () => {
    const p = buildChartDataPayload(source({ metrics: ["revenue"], timeRange: "$f_time" }), { f_time: "Last year" }, dataset);
    expect(p.queries[0]?.filters).toEqual([{ col: "ds", op: "TEMPORAL_RANGE", val: "Last year" }]);
  });

  it("uses a literal time range and an explicit time column as given", () => {
    const p = buildChartDataPayload(
      source({ metrics: ["revenue"], timeRange: "1990-01-01 : 2000-01-01", timeColumn: "order_date" }),
      {},
      dataset,
    );
    expect(p.queries[0]?.filters).toEqual([{ col: "order_date", op: "TEMPORAL_RANGE", val: "1990-01-01 : 2000-01-01" }]);
  });

  it("adds no time filter for 'No filter' or an unset filter value", () => {
    const states: Record<string, string>[] = [{ f_time: "No filter" }, {}];
    for (const state of states) {
      const p = buildChartDataPayload(source({ metrics: ["revenue"], timeRange: "$f_time" }), state, dataset);
      expect(p.queries[0]?.filters).toEqual([]);
    }
  });

  it("refuses a time range on a dataset with no datetime column", () => {
    expect(() =>
      buildChartDataPayload(source({ metrics: ["revenue"], timeRange: "Last year" }), {}, { id: 3, mainDttmCol: null }),
    ).toThrow(SourceError);
  });

  it("buckets the time column as a BASE_AXIS column when a grain is set", () => {
    const p = buildChartDataPayload(
      source({ metrics: ["sum__num"], dimensions: ["ds", "gender"], timeColumn: "ds", timeGrain: "P1Y" }),
      {},
      dataset,
    );
    expect(p.queries[0]?.columns).toEqual([
      { expressionType: "SQL", sqlExpression: "ds", label: "ds", columnType: "BASE_AXIS", timeGrain: "P1Y" },
      "gender",
    ]);
    // A time axis is sorted after the fact, not by metric.
    expect(p.queries[0]?.orderby).toEqual([]);
  });

  it("orders by the first metric, descending, when nothing else is said", () => {
    const p = buildChartDataPayload(source({ metrics: ["revenue", "orders"], dimensions: ["region"] }), {}, dataset);
    expect(p.queries[0]?.orderby).toEqual([["revenue", false]]);
  });

  it("orders by a named metric as its Superset metric, and by a column by name", () => {
    const byMetric = buildChartDataPayload(
      source({ metrics: [{ column: "num", aggregate: "SUM", label: "births" }], dimensions: ["state"], orderBy: { column: "births", desc: false } }),
      {},
      dataset,
    );
    expect(byMetric.queries[0]?.orderby).toEqual([
      [{ expressionType: "SIMPLE", column: { column_name: "num" }, aggregate: "SUM", label: "births" }, true],
    ]);
    const byColumn = buildChartDataPayload(
      source({ metrics: ["revenue"], dimensions: ["state"], orderBy: { column: "state" } }),
      {},
      dataset,
    );
    expect(byColumn.queries[0]?.orderby).toEqual([["state", false]]);
  });

  it("carries the row limit", () => {
    const p = buildChartDataPayload(source({ metrics: ["revenue"], rowLimit: 10 }), {}, dataset);
    expect(p.queries[0]?.row_limit).toBe(10);
  });
});

describe("normalizeResult", () => {
  it("maps coltypes, turns epoch milliseconds into ISO strings, and sorts a time axis", () => {
    const data = normalizeResult(
      {
        colnames: ["ds", "gender", "sum__num"],
        coltypes: [2, 1, 0],
        data: [
          { ds: 1167609600000.0, gender: "girl", sum__num: 2 },
          { ds: 157766400000.0, gender: "girl", sum__num: 1 },
        ],
        query: "SELECT 1",
      },
      source({ metrics: ["sum__num"], dimensions: ["ds", "gender"], timeColumn: "ds", timeGrain: "P1Y" }),
    );
    expect(data.columns).toEqual([
      { name: "ds", type: "time" },
      { name: "gender", type: "string" },
      { name: "sum__num", type: "number" },
    ]);
    expect(data.rows).toEqual([
      { ds: "1975-01-01T00:00:00.000Z", gender: "girl", sum__num: 1 },
      { ds: "2007-01-01T00:00:00.000Z", gender: "girl", sum__num: 2 },
    ]);
    expect(data.query).toBe("SELECT 1");
  });
});
