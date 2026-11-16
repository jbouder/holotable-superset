import type { Tile, TileData, TileResult } from "@poc/spec";
import { useId, useMemo, useState } from "react";
import { useChartTheme } from "../charts/chart-theme";
import { EChart } from "../charts/EChart";
import { seriesOption } from "../charts/series-option";
import { formatCell, formatNumber } from "../lib/format";
import { Card, CardTitle } from "./card";

export function TileView({ tile, result }: { tile: Tile; result: TileResult | undefined }) {
  const [showQuery, setShowQuery] = useState(false);
  const queryId = useId();
  return (
    <Card className="flex h-full min-h-0 flex-col">
      <div className="flex items-start justify-between gap-2 px-4 pt-3">
        <CardTitle as="h3" className="leading-snug">
          {tile.title}
        </CardTitle>
        <button
          type="button"
          aria-expanded={showQuery}
          aria-controls={queryId}
          onClick={() => setShowQuery((v) => !v)}
          className="shrink-0 rounded-sm px-1.5 py-0.5 font-mono text-[11px] text-muted hover:bg-surface-2 hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
        >
          {showQuery ? "Hide query" : "Show query"}
        </button>
      </div>
      <div className="min-h-0 flex-1 px-4 py-2">
        {showQuery ? (
          <QueryPanel id={queryId} tile={tile} result={result} />
        ) : !result ? (
          <div className="h-full animate-pulse rounded-sm bg-surface-2" aria-label="Loading" />
        ) : result.ok ? (
          <TileBody tile={tile} data={result.data} />
        ) : (
          <p role="alert" className="text-sm text-danger">
            {result.error}
          </p>
        )}
      </div>
      {tile.note ? <p className="border-t border-border px-4 py-2 text-xs text-muted">{tile.note}</p> : null}
    </Card>
  );
}

function TileBody({ tile, data }: { tile: Tile; data: TileData }) {
  const theme = useChartTheme();
  const viz = tile.viz;
  const option = useMemo(
    () => (viz.type === "bar" || viz.type === "line" || viz.type === "area" ? seriesOption(viz, data, theme) : null),
    [viz, data, theme],
  );

  if (data.rows.length === 0) {
    return <p className="text-sm text-muted">No rows for this time range.</p>;
  }
  if (option) return <EChart option={option} label={tile.title} />;

  if (viz.type === "big_number") {
    const value = data.rows[0]?.[viz.value];
    return (
      <div className="flex h-full flex-col items-center justify-center">
        <span className="text-4xl font-semibold tabular-nums">{formatNumber(value, viz.format ?? "compact")}</span>
        {viz.unit ? <span className="mt-1 text-sm text-muted">{viz.unit}</span> : null}
      </div>
    );
  }

  if (viz.type === "table") {
    const columns = viz.columns
      ? data.columns.filter((c) => viz.columns?.includes(c.name)).sort((a, b) => viz.columns!.indexOf(a.name) - viz.columns!.indexOf(b.name))
      : data.columns;
    return (
      <div className="h-full overflow-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-surface">
            <tr>
              {columns.map((c) => (
                <th
                  key={c.name}
                  scope="col"
                  className={`border-b border-border px-2 py-1.5 font-medium text-muted ${c.type === "number" ? "text-right" : "text-left"}`}
                >
                  {c.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.rows.map((row, i) => (
              // Rows have no key of their own; their order is the query's.
              // biome-ignore lint/suspicious/noArrayIndexKey: rows are positional
              <tr key={i} className="border-b border-border/50 last:border-0">
                {columns.map((c) => (
                  <td key={c.name} className={`px-2 py-1 ${c.type === "number" ? "text-right tabular-nums" : ""}`}>
                    {formatCell(row[c.name], c.type, viz.format)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  return null;
}

function QueryPanel({ id, tile, result }: { id: string; tile: Tile; result: TileResult | undefined }) {
  const sql = result?.ok ? result.data.query : undefined;
  return (
    <div id={id} className="h-full overflow-auto font-mono text-[11px] leading-relaxed">
      <p className="mb-1 text-muted">Source</p>
      <pre className="whitespace-pre-wrap break-words">{JSON.stringify(tile.source, null, 2)}</pre>
      {sql ? (
        <>
          <p className="mt-3 mb-1 text-muted">SQL Superset ran</p>
          <pre className="whitespace-pre-wrap break-words">{sql.trim()}</pre>
        </>
      ) : null}
    </div>
  );
}
