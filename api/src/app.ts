import {
  type DashboardData,
  defaultFilterState,
  type FilterState,
  type TileResult,
} from "@poc/spec";
import { Hono } from "hono";
import { deleteDashboard, getDashboard, listDashboards, pool } from "./db.ts";
import { runSource, SourceError, supersetHealthy } from "./superset-client.ts";

export const app = new Hono();

app.onError((err, c) => {
  console.error(err);
  return c.json({ error: "internal error" }, 500);
});

app.get("/health", async (c) => {
  const [superset, db] = await Promise.all([
    supersetHealthy(),
    pool.query("SELECT 1").then(
      () => true,
      () => false,
    ),
  ]);
  const ok = superset && db;
  return c.json({ ok, superset, db }, ok ? 200 : 503);
});

app.get("/dashboards", async (c) => {
  const all = await listDashboards();
  return c.json(
    all.map(({ spec, version, updatedAt }) => ({
      id: spec.id,
      title: spec.title,
      summary: spec.summary,
      tiles: spec.tiles.length,
      version,
      updatedAt,
    })),
  );
});

app.get("/dashboards/:id", async (c) => {
  const stored = await getDashboard(c.req.param("id"));
  return stored ? c.json(stored) : c.json({ error: "not found" }, 404);
});

app.delete("/dashboards/:id", async (c) => {
  return (await deleteDashboard(c.req.param("id")))
    ? c.body(null, 204)
    : c.json({ error: "not found" }, 404);
});

/**
 * Rows and columns for every tile. Each dashboard filter can be overridden by
 * a query parameter named after its id, e.g. `?f_time=Last%20year`. A tile
 * that fails reports its error; the others still load.
 */
app.get("/dashboards/:id/data", async (c) => {
  const stored = await getDashboard(c.req.param("id"));
  if (!stored) return c.json({ error: "not found" }, 404);
  const { spec } = stored;

  const filters: FilterState = defaultFilterState(spec);
  for (const f of spec.filters) {
    const override = c.req.query(f.id);
    if (override) filters[f.id] = override.slice(0, 100);
  }

  const results = await Promise.all(
    spec.tiles.map(async (tile): Promise<[string, TileResult]> => {
      try {
        return [tile.id, { ok: true, data: await runSource(tile.source, filters) }];
      } catch (err) {
        if (err instanceof SourceError) return [tile.id, { ok: false, error: err.message }];
        console.error(`tile ${tile.id}`, err);
        return [tile.id, { ok: false, error: "could not reach Superset" }];
      }
    }),
  );

  const body: DashboardData = { filters, tiles: Object.fromEntries(results) };
  return c.json(body);
});
