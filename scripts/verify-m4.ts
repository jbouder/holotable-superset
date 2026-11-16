/**
 * M4 check: one prompt through the UI's proxy yields a dashboard with four or
 * more tiles that all load live data, in under 90 seconds; then a follow-up
 * changes exactly one tile and leaves the others byte for byte. Needs
 * LLM_API_KEY in .env. Keeps the dashboard so you can open it.
 */
import type { ChatEvent, ChatRequestInput, DashboardData, StoredDashboard, Tile } from "@poc/spec";

const UI = process.env.UI_URL ?? "http://localhost:3000";
const PROMPT =
  process.env.PROMPT ?? "Build a dashboard of US births: the total, births per year by gender, the top states, and the most common names.";
const FOLLOW_UP = process.env.FOLLOW_UP ?? "Make the births-per-year trend monthly instead of yearly.";

let failed = false;
function check(label: string, pass: boolean, detail = "") {
  console.log(`   ${pass ? "ok  " : "FAIL"} ${label}${detail ? `\n        ${detail}` : ""}`);
  if (!pass) failed = true;
}

async function chat(body: ChatRequestInput): Promise<{ events: ChatEvent[]; seconds: number }> {
  const started = Date.now();
  const res = await fetch(`${UI}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok || !res.body) throw new Error(`POST /chat: HTTP ${res.status} ${await res.text()}`);
  const events: ChatEvent[] = [];
  let buffer = "";
  for await (const chunk of res.body.pipeThrough(new TextDecoderStream())) {
    buffer += chunk;
    const frames = buffer.split(/\r?\n\r?\n/);
    buffer = frames.pop() ?? "";
    for (const frame of frames) {
      const data = frame.split(/\r?\n/).find((l) => l.startsWith("data:"));
      if (!data) continue;
      const event = JSON.parse(data.slice(5)) as ChatEvent;
      events.push(event);
      const s = ((Date.now() - started) / 1000).toFixed(1).padStart(5);
      if (event.type === "step") console.log(`        ${s}s ${event.status === "rejected" ? "!" : event.status === "ok" ? "+" : "·"} ${event.text}`);
      if (event.type === "message") console.log(`        ${s}s agent: ${event.text}`);
      if (event.type === "error") console.log(`        ${s}s ERROR ${event.message}`);
    }
  }
  return { events, seconds: (Date.now() - started) / 1000 };
}

const get = async <T>(path: string) => (await (await fetch(`${UI}/api${path}`)).json()) as T;

console.log(`1. Prompt: "${PROMPT}"`);
const first = await chat({ message: PROMPT });
const done = first.events.find((e): e is Extract<ChatEvent, { type: "done" }> => e.type === "done");
const id = done?.dashboardId;
check(`agent finished in ${first.seconds.toFixed(1)}s (limit 90s)`, Boolean(id) && first.seconds < 90);
check("no agent errors", !first.events.some((e) => e.type === "error"));
if (!id) process.exit(1);

console.log(`2. Dashboard ${id}`);
const before = await get<StoredDashboard>(`/dashboards/${id}`);
console.log(`        "${before.spec.title}": ${before.spec.summary ?? "(no summary)"}`);
for (const t of before.spec.tiles) console.log(`        ${t.id}: ${t.viz.type} "${t.title}"${t.note ? ` / ${t.note}` : ""}`);
check(`${before.spec.tiles.length} tiles (need 4 or more)`, before.spec.tiles.length >= 4);
const data = await get<DashboardData>(`/dashboards/${id}/data`);
const bad = Object.entries(data.tiles).filter(([, r]) => !r.ok || r.data.rows.length === 0);
check("every tile loads live rows", bad.length === 0, bad.map(([k, r]) => `${k}: ${r.ok ? "no rows" : r.error}`).join("; "));

console.log(`3. Follow-up: "${FOLLOW_UP}"`);
const history = [
  { role: "user" as const, text: PROMPT },
  ...first.events.filter((e) => e.type === "message").map((e) => ({ role: "assistant" as const, text: (e as { text: string }).text })),
];
const second = await chat({ message: FOLLOW_UP, dashboardId: id, history });
console.log(`        took ${second.seconds.toFixed(1)}s`);
const after = await get<StoredDashboard>(`/dashboards/${id}`);
const byId = (tiles: Tile[]) => new Map(tiles.map((t) => [t.id, JSON.stringify(t)]));
const was = byId(before.spec.tiles);
const now = byId(after.spec.tiles);
const changed = [...now].filter(([k, v]) => was.get(k) !== v).map(([k]) => k);
check("same tiles, none added or removed", was.size === now.size && [...was.keys()].every((k) => now.has(k)));
check(`exactly one tile changed: ${changed.join(", ") || "none"}`, changed.length === 1);
const edited = after.spec.tiles.find((t) => t.id === changed[0]);
if (edited) console.log(`        ${edited.id}: timeGrain ${edited.source.timeGrain ?? "none"}`);
check("dashboard not recreated", after.spec.id === id && !second.events.some((e) => e.type === "step" && e.text.startsWith("Created")));
const data2 = await get<DashboardData>(`/dashboards/${id}/data`);
check("every tile still loads", Object.values(data2.tiles).every((r) => r.ok));

console.log(`\nOpen ${UI}/d/${id}`);
process.exit(failed ? 1 : 0);
