import type { TileData, Viz } from "@poc/spec";
import type { EChartsCoreOption } from "echarts/core";
import { formatNumber, timeFormatter } from "../lib/format";
import type { ChartTheme } from "./chart-theme";

type SeriesViz = Extract<Viz, { type: "bar" | "line" | "area" }>;

/**
 * Bar, line and area options. Written for the POC, following the choices in
 * Holotable's src/components/charts/options.ts: a category x axis, no
 * symbols on lines, an area that fades toward the axis, an axis tooltip,
 * theme tokens for every color, and compact tick labels.
 */
export function seriesOption(viz: SeriesViz, data: TileData, theme: ChartTheme): EChartsCoreOption {
  const xType = data.columns.find((c) => c.name === viz.x)?.type;
  const xValues: unknown[] = [];
  const seen = new Set<string>();
  for (const row of data.rows) {
    const key = String(row[viz.x]);
    if (!seen.has(key)) {
      seen.add(key);
      xValues.push(row[viz.x]);
    }
  }
  const label = xType === "time" ? timeFormatter(xValues) : (v: unknown) => String(v ?? "");
  const index = new Map(xValues.map((v, i) => [String(v), i]));

  // Wide series: one per y column. Long series: one per value of `series`.
  const ys = Array.isArray(viz.y) ? viz.y : [viz.y];
  const series: { name: string; values: (number | null)[] }[] = [];
  if (viz.series) {
    const y = ys[0] as string;
    const byName = new Map<string, (number | null)[]>();
    for (const row of data.rows) {
      const name = String(row[viz.series] ?? "–");
      if (!byName.has(name)) byName.set(name, new Array(xValues.length).fill(null));
      const at = index.get(String(row[viz.x]));
      if (at !== undefined) (byName.get(name) as (number | null)[])[at] = Number(row[y]);
    }
    for (const [name, values] of byName) series.push({ name, values });
  } else {
    for (const y of ys) {
      const values = new Array<number | null>(xValues.length).fill(null);
      for (const row of data.rows) {
        const at = index.get(String(row[viz.x]));
        if (at !== undefined) values[at] = Number(row[y]);
      }
      series.push({ name: y, values });
    }
  }

  const horizontal = viz.type === "bar" && viz.horizontal === true;
  const textStyle = { color: theme.text, fontFamily: theme.font, fontSize: 11 };
  const categoryAxis = {
    type: "category",
    data: xValues.map(label),
    axisLine: { lineStyle: { color: theme.line } },
    axisTick: { show: false },
    axisLabel: { ...textStyle, hideOverlap: true },
  };
  const valueAxis = {
    type: "value",
    splitNumber: 4,
    splitLine: { lineStyle: { color: theme.grid } },
    axisLabel: { ...textStyle, formatter: (v: number) => formatNumber(v, "compact") },
  };
  const legend = series.length > 1;

  return {
    color: theme.series,
    textStyle: { fontFamily: theme.font },
    animationDuration: 300,
    grid: { left: 8, right: 16, top: legend ? 32 : 16, bottom: 8, containLabel: true },
    legend: { show: legend, top: 0, left: 0, textStyle, icon: "roundRect", itemWidth: 10, itemHeight: 10 },
    tooltip: {
      trigger: "axis",
      backgroundColor: theme.raised,
      borderColor: theme.line,
      textStyle: { color: theme.foreground, fontFamily: theme.font, fontSize: 12 },
      valueFormatter: (v: unknown) => formatNumber(v, viz.format ?? "number"),
    },
    xAxis: horizontal ? valueAxis : categoryAxis,
    yAxis: horizontal ? { ...categoryAxis, inverse: true } : valueAxis,
    series: series.map((s, i) => ({
      name: s.name,
      type: viz.type === "bar" ? "bar" : "line",
      data: s.values,
      showSymbol: false,
      connectNulls: false,
      ...(viz.stacked ? { stack: "total" } : {}),
      ...(viz.type === "bar" ? { barMaxWidth: 48 } : { lineStyle: { width: theme.lineWidth } }),
      ...(viz.type === "area"
        ? {
            areaStyle: {
              color: {
                type: "linear",
                x: 0,
                y: 0,
                x2: 0,
                y2: 1,
                colorStops: [
                  { offset: 0, color: withAlpha(theme.series[i % theme.series.length] ?? "#888", viz.stacked ? 0.85 : theme.areaFade) },
                  { offset: 1, color: withAlpha(theme.series[i % theme.series.length] ?? "#888", viz.stacked ? 0.85 : 0) },
                ],
              },
            },
          }
        : {}),
    })),
  };
}

function withAlpha(hex: string, alpha: number): string {
  const a = Math.round(Math.min(1, Math.max(0, alpha)) * 255)
    .toString(16)
    .padStart(2, "0");
  return /^#[0-9a-f]{6}$/i.test(hex) ? `${hex}${a}` : hex;
}
