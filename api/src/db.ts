import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { Dashboard, type StoredDashboard } from "@poc/spec";
import pg from "pg";
import { config } from "./config.ts";
import { findDatasetId } from "./superset-client.ts";

export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 5 });

export async function migrate(): Promise<void> {
  await pool.query(`
    CREATE SCHEMA IF NOT EXISTS holotable;
    CREATE TABLE IF NOT EXISTS holotable.dashboards (
      id         text PRIMARY KEY,
      title      text NOT NULL,
      spec       jsonb NOT NULL,
      version    integer NOT NULL DEFAULT 1,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
  `);
}

interface Row {
  spec: unknown;
  version: number;
  updated_at: Date;
}

function toStored(row: Row): StoredDashboard {
  return {
    spec: Dashboard.parse(row.spec),
    version: row.version,
    updatedAt: row.updated_at.toISOString(),
  };
}

export async function listDashboards(): Promise<StoredDashboard[]> {
  const { rows } = await pool.query<Row>(
    "SELECT spec, version, updated_at FROM holotable.dashboards ORDER BY updated_at DESC",
  );
  return rows.map(toStored);
}

export async function getDashboard(id: string): Promise<StoredDashboard | null> {
  const { rows } = await pool.query<Row>(
    "SELECT spec, version, updated_at FROM holotable.dashboards WHERE id = $1",
    [id],
  );
  return rows[0] ? toStored(rows[0]) : null;
}

/** Insert or replace a spec; every save bumps the version. */
export async function saveDashboard(spec: Dashboard): Promise<StoredDashboard> {
  const parsed = Dashboard.parse(spec);
  const { rows } = await pool.query<Row>(
    `INSERT INTO holotable.dashboards (id, title, spec)
     VALUES ($1, $2, $3)
     ON CONFLICT (id) DO UPDATE
       SET title = EXCLUDED.title, spec = EXCLUDED.spec,
           version = holotable.dashboards.version + 1, updated_at = now()
     RETURNING spec, version, updated_at`,
    [parsed.id, parsed.title, JSON.stringify(parsed)],
  );
  return toStored(rows[0] as Row);
}

/** Insert a new spec. Returns null when the id is already taken. */
export async function createDashboard(spec: Dashboard): Promise<StoredDashboard | null> {
  const parsed = Dashboard.parse(spec);
  const { rows } = await pool.query<Row>(
    `INSERT INTO holotable.dashboards (id, title, spec) VALUES ($1, $2, $3)
     ON CONFLICT (id) DO NOTHING
     RETURNING spec, version, updated_at`,
    [parsed.id, parsed.title, JSON.stringify(parsed)],
  );
  return rows[0] ? toStored(rows[0]) : null;
}

/**
 * Read, change and write one spec under a row lock, so two edits to the same
 * dashboard cannot overwrite each other. `change` returns the new spec, which
 * is validated before it is written. Returns null when the id does not exist.
 */
export async function mutateDashboard(
  id: string,
  change: (spec: Dashboard) => Dashboard,
): Promise<StoredDashboard | null> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query<Row>(
      "SELECT spec, version, updated_at FROM holotable.dashboards WHERE id = $1 FOR UPDATE",
      [id],
    );
    if (!rows[0]) {
      await client.query("ROLLBACK");
      return null;
    }
    const next = Dashboard.parse(change(toStored(rows[0]).spec));
    const updated = await client.query<Row>(
      `UPDATE holotable.dashboards
         SET title = $2, spec = $3, version = version + 1, updated_at = now()
       WHERE id = $1
       RETURNING spec, version, updated_at`,
      [id, next.title, JSON.stringify(next)],
    );
    await client.query("COMMIT");
    return toStored(updated.rows[0] as Row);
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

export async function deleteDashboard(id: string): Promise<boolean> {
  const { rowCount } = await pool.query("DELETE FROM holotable.dashboards WHERE id = $1", [id]);
  return (rowCount ?? 0) > 0;
}

/**
 * Seed files may name a dataset as `"datasetId": "name:<table_name>"`, since
 * dataset ids depend on the order Superset loaded its examples.
 */
async function resolveSeed(raw: { tiles?: { source?: { datasetId?: unknown } }[] }) {
  for (const tile of raw.tiles ?? []) {
    const ref = tile.source?.datasetId;
    if (tile.source && typeof ref === "string" && ref.startsWith("name:")) {
      tile.source.datasetId = await findDatasetId(ref.slice(5));
    }
  }
  return raw;
}

/** Load every seed spec whose id is not stored yet. Never overwrites. */
export async function seed(): Promise<string[]> {
  let files: string[];
  try {
    files = (await readdir(config.seedDir)).filter((f) => f.endsWith(".json"));
  } catch {
    return [];
  }
  const added: string[] = [];
  for (const file of files) {
    const raw = JSON.parse(await readFile(join(config.seedDir, file), "utf8"));
    if (await getDashboard(String(raw.id))) continue;
    const spec = Dashboard.parse(await resolveSeed(raw));
    await saveDashboard(spec);
    added.push(spec.id);
  }
  return added;
}
