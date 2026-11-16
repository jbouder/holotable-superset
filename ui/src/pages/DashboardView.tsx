import { type DashboardFilter, defaultFilterState, type FilterState } from "@poc/spec";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useEffect, useId, useState } from "react";
import { api } from "../api";
import { attachChat } from "../chat";
import { ChatPanel } from "../components/ChatPanel";
import { DashboardGrid } from "../components/DashboardGrid";
import { TileView } from "../components/TileView";
import { Link } from "../router";

export function DashboardView({ id }: { id: string }) {
  const dashboard = useQuery({ queryKey: ["dashboard", id], queryFn: () => api.dashboard(id) });
  const [filters, setFilters] = useState<FilterState | null>(null);

  useEffect(() => attachChat(id), [id]);

  useEffect(() => {
    if (dashboard.data && filters === null) setFilters(defaultFilterState(dashboard.data.spec));
  }, [dashboard.data, filters]);

  const data = useQuery({
    queryKey: ["data", id, dashboard.data?.version, filters],
    queryFn: () => api.data(id, filters ?? {}),
    enabled: filters !== null,
    placeholderData: keepPreviousData,
  });

  if (dashboard.isPending) return <main className="p-8 text-muted">Loading…</main>;
  if (dashboard.isError)
    return (
      <main className="p-8">
        <p role="alert" className="text-danger">
          Could not load this dashboard: {dashboard.error.message}
        </p>
      </main>
    );

  const spec = dashboard.data.spec;
  return (
    <div className="mx-auto flex max-w-[1600px] flex-col gap-4 px-4 py-6 lg:flex-row lg:items-start">
    <main className="min-w-0 flex-1">
      <Link to="/" className="text-sm text-muted hover:text-foreground">
        ← Dashboards
      </Link>
      <header className="mt-2 mb-5 flex flex-wrap items-end justify-between gap-4">
        <div className="max-w-3xl">
          <h1 className="text-2xl font-semibold">{spec.title}</h1>
          {spec.summary ? <p className="mt-1 text-muted">{spec.summary}</p> : null}
        </div>
        <div className="flex flex-wrap items-end gap-3">
          {spec.filters.map((f) => (
            <TimeRangeFilter
              key={f.id}
              filter={f}
              value={filters?.[f.id] ?? f.default}
              onChange={(v) => setFilters((s) => ({ ...(s ?? {}), [f.id]: v }))}
            />
          ))}
          {data.isFetching ? <span className="pb-2 text-xs text-muted">Refreshing…</span> : null}
        </div>
      </header>
      {data.isError ? (
        <p role="alert" className="mb-4 text-danger">
          Could not load data: {data.error.message}
        </p>
      ) : null}
      {spec.tiles.length === 0 ? <p className="text-muted">No tiles yet.</p> : null}
      <DashboardGrid tiles={spec.tiles} renderTile={(tile) => <TileView tile={tile} result={data.data?.tiles[tile.id]} />} />
    </main>
    <ChatPanel className="h-[32rem] lg:sticky lg:top-6 lg:h-[calc(100vh-3rem)] lg:w-96 lg:shrink-0" />
    </div>
  );
}

const PRESETS = ["No filter", "Last week", "Last month", "Last quarter", "Last year"];
const CUSTOM = "custom";

/** A Superset time range: a preset, or a custom "YYYY-MM-DD : YYYY-MM-DD". */
function TimeRangeFilter({
  filter,
  value,
  onChange,
}: {
  filter: DashboardFilter;
  value: string;
  onChange: (value: string) => void;
}) {
  const id = useId();
  const isPreset = PRESETS.includes(value);
  const [from = "", to = ""] = isPreset ? [] : value.split(" : ");
  const field = "rounded-sm border border-border-strong bg-surface px-2 py-1.5 text-sm";
  return (
    <fieldset className="flex flex-wrap items-end gap-2">
      <legend className="sr-only">{filter.label ?? "Time range"}</legend>
      <label htmlFor={id} className="flex flex-col gap-1 text-xs text-muted">
        {filter.label ?? "Time range"}
        <select
          id={id}
          className={field}
          value={isPreset ? value : CUSTOM}
          onChange={(e) => onChange(e.target.value === CUSTOM ? "1990-01-01 : 2000-01-01" : e.target.value)}
        >
          {PRESETS.map((p) => (
            <option key={p}>{p}</option>
          ))}
          <option value={CUSTOM}>Custom range</option>
        </select>
      </label>
      {isPreset ? null : (
        <>
          <label className="flex flex-col gap-1 text-xs text-muted">
            From
            <input type="date" className={field} value={from} onChange={(e) => onChange(`${e.target.value} : ${to}`)} />
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted">
            To
            <input type="date" className={field} value={to} onChange={(e) => onChange(`${from} : ${e.target.value}`)} />
          </label>
        </>
      )}
    </fieldset>
  );
}
