import { createHash } from "node:crypto";
import type { FilterState, TileData, TileSource } from "@poc/spec";
import { Redis } from "ioredis";
import { config } from "./config.ts";
import {
  buildChartDataPayload,
  type ChartDataResult,
  type DatasetFacts,
  normalizeResult,
  SourceError,
} from "./superset-query.ts";

/**
 * The only module that calls Superset's REST API. It logs in as the
 * read-only service account, translates a tile source into a chart data
 * query, normalizes the answer to `{columns, rows}`, and caches it in Redis
 * keyed by the exact query (source plus resolved filters).
 */

export { SourceError };

const redis = new Redis(config.redisUrl, { lazyConnect: true, maxRetriesPerRequest: 1 });
redis.on("error", () => {
  // A cache outage degrades to uncached queries; it never fails a request.
});

let accessToken: string | null = null;

async function login(): Promise<string> {
  const res = await fetch(`${config.superset.url}/api/v1/security/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: config.superset.username,
      password: config.superset.password,
      provider: "db",
      refresh: false,
    }),
  });
  if (!res.ok) throw new Error(`Superset login failed: HTTP ${res.status}`);
  const body = (await res.json()) as { access_token: string };
  accessToken = body.access_token;
  return accessToken;
}

/** One authenticated call; logs in again once if the token has expired. */
async function call(path: string, init: RequestInit = {}): Promise<Response> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const token = accessToken ?? (await login());
    const res = await fetch(`${config.superset.url}${path}`, {
      ...init,
      headers: {
        ...(init.headers ?? {}),
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    });
    if (res.status !== 401) return res;
    accessToken = null;
  }
  throw new Error("Superset rejected the service account token twice");
}

/** Superset puts its error text in a few different places. */
async function errorText(res: Response): Promise<string> {
  const raw = await res.text();
  try {
    const body = JSON.parse(raw) as {
      message?: unknown;
      errors?: { message?: string }[];
    };
    if (body.errors?.length) return body.errors.map((e) => e.message).join("; ");
    if (typeof body.message === "string") return body.message;
    if (body.message) return JSON.stringify(body.message);
  } catch {
    // not JSON
  }
  return raw.slice(0, 300) || `HTTP ${res.status}`;
}

export interface DatasetInfo extends DatasetFacts {
  name: string;
  columns: { name: string; type: string | null; isDttm: boolean }[];
  metrics: { name: string; expression: string }[];
}

const datasets = new Map<number, { at: number; info: DatasetInfo }>();
const DATASET_TTL_MS = 5 * 60_000;

export async function getDataset(id: number): Promise<DatasetInfo> {
  const hit = datasets.get(id);
  if (hit && Date.now() - hit.at < DATASET_TTL_MS) return hit.info;
  const res = await call(`/api/v1/dataset/${id}`);
  if (res.status === 404) throw new SourceError(`dataset ${id} does not exist`);
  if (!res.ok) throw new SourceError(`dataset ${id}: ${await errorText(res)}`);
  const { result } = (await res.json()) as {
    result: {
      id: number;
      table_name: string;
      main_dttm_col: string | null;
      columns: { column_name: string; type: string | null; is_dttm: boolean }[];
      metrics: { metric_name: string; expression: string }[];
    };
  };
  const info: DatasetInfo = {
    id: result.id,
    name: result.table_name,
    mainDttmCol: result.main_dttm_col,
    columns: result.columns.map((c) => ({ name: c.column_name, type: c.type, isDttm: c.is_dttm })),
    metrics: result.metrics.map((m) => ({ name: m.metric_name, expression: m.expression })),
  };
  datasets.set(id, { at: Date.now(), info });
  return info;
}

/** A dataset's id by its table name. Used to resolve seed specs, whose ids differ per install. */
export async function findDatasetId(tableName: string): Promise<number> {
  const q = `(filters:!((col:table_name,opr:eq,value:'${tableName.replace(/'/g, "!'")}')),columns:!(id))`;
  const res = await call(`/api/v1/dataset/?q=${encodeURIComponent(q)}`);
  if (!res.ok) throw new SourceError(`dataset lookup "${tableName}": ${await errorText(res)}`);
  const body = (await res.json()) as { result: { id: number }[] };
  const id = body.result[0]?.id;
  if (id === undefined) throw new SourceError(`no dataset named "${tableName}"`);
  return id;
}

/** Run a tile's query. Throws `SourceError` with Superset's message when the query is wrong. */
export async function runSource(source: TileSource, state: FilterState): Promise<TileData> {
  const dataset = await getDataset(source.datasetId);
  const payload = buildChartDataPayload(source, state, dataset);
  const key = `tile:${createHash("sha256").update(JSON.stringify(payload)).digest("hex")}`;

  const cached = await redis.get(key).catch(() => null);
  if (cached) return { ...(JSON.parse(cached) as TileData), cached: true };

  const res = await call("/api/v1/chart/data", { method: "POST", body: JSON.stringify(payload) });
  if (!res.ok) throw new SourceError(await errorText(res));
  const body = (await res.json()) as { result: ChartDataResult[] };
  const result = body.result[0];
  if (!result) throw new SourceError("Superset returned no result");
  if (result.status === "failed" || result.error) throw new SourceError(result.error ?? "query failed");

  const data = normalizeResult(result, source);
  await redis.set(key, JSON.stringify(data), "EX", config.tileCacheTtl).catch(() => undefined);
  return data;
}

export async function supersetHealthy(): Promise<boolean> {
  try {
    const res = await fetch(`${config.superset.url}/health`, { signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch {
    return false;
  }
}

export async function connectCache(): Promise<void> {
  await redis.connect().catch(() => undefined);
}
