/** Pure checks the agent loop applies to every tool call before it runs. */

/**
 * Some local models send nested objects as JSON text ("viz": "{\"type\": ...}").
 * Decode top-level string arguments that hold a JSON object or array.
 */
export function coerceArgs(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object") return {};
  return Object.fromEntries(
    Object.entries(input as Record<string, unknown>).map(([k, v]) => {
      if (typeof v !== "string" || !/^\s*[[{]/.test(v)) return [k, v];
      try {
        return [k, JSON.parse(v) as unknown];
      } catch {
        return [k, v];
      }
    }),
  );
}

const SPEC_WRITES = ["create_dashboard", "add_tile", "update_tile", "remove_tile", "set_layout", "update_dashboard"];

/**
 * A run may change one dashboard: the open one, or the one it creates. Writes
 * aimed anywhere else are refused before they reach the spec server.
 */
export function scopeError(name: string, input: Record<string, unknown>, scope: string | undefined): string | null {
  if (!SPEC_WRITES.includes(name)) return null;
  if (name === "create_dashboard") {
    return scope ? `This chat is editing the dashboard "${scope}". Change it instead of creating a new one.` : null;
  }
  if (!scope) return `Create the dashboard first with create_dashboard.`;
  return input.dashboardId === scope ? null : `This chat may only change the dashboard "${scope}". Use dashboardId "${scope}".`;
}
