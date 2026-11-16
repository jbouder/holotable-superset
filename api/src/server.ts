import { serve } from "@hono/node-server";
import { app } from "./app.ts";
import { config } from "./config.ts";
import { migrate, seed } from "./db.ts";
import { connectCache } from "./superset-client.ts";

await migrate();
const seeded = await seed();
if (seeded.length) console.log(`seeded dashboards: ${seeded.join(", ")}`);
await connectCache();

serve({ fetch: app.fetch, port: config.port, hostname: "0.0.0.0" }, (info) => {
  console.log(`api listening on :${info.port}`);
});
