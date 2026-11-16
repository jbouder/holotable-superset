import type { DashboardData, FilterState, StoredDashboard } from "@poc/spec";

export interface DashboardSummary {
  id: string;
  title: string;
  summary?: string;
  tiles: number;
  version: number;
  updatedAt: string;
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`/api${path}`);
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return (await res.json()) as T;
}

export const api = {
  dashboards: () => get<DashboardSummary[]>("/dashboards"),
  dashboard: (id: string) => get<StoredDashboard>(`/dashboards/${encodeURIComponent(id)}`),
  data: (id: string, filters: FilterState) => {
    const q = new URLSearchParams(filters).toString();
    return get<DashboardData>(`/dashboards/${encodeURIComponent(id)}/data${q ? `?${q}` : ""}`);
  },
};
