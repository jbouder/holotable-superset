function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

export const config = {
  port: Number(process.env.PORT ?? 8000),
  databaseUrl: required("DATABASE_URL"),
  redisUrl: process.env.REDIS_URL ?? "redis://redis:6379/3",
  superset: {
    url: process.env.SUPERSET_URL ?? "http://superset:8088",
    username: required("SUPERSET_SERVICE_USERNAME"),
    password: required("SUPERSET_SERVICE_PASSWORD"),
  },
  /** Seconds a tile result stays in the Redis cache. */
  tileCacheTtl: Number(process.env.TILE_CACHE_TTL ?? 300),
  seedDir: process.env.SEED_DIR ?? new URL("../seed", import.meta.url).pathname,
};
