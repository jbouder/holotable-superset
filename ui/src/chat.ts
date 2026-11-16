import type { ChatEvent, ChatRequestInput } from "@poc/spec";
import { useSyncExternalStore } from "react";
import { queryClient } from "./query-client";
import { navigate } from "./router";

/**
 * One conversation at a time, kept outside React so it survives the move
 * from the prompt box to the new dashboard's page. A conversation belongs to
 * one dashboard; opening another dashboard starts a fresh one.
 */

export type ChatItem =
  | { kind: "user"; text: string }
  | { kind: "assistant"; text: string }
  | { kind: "step"; text: string; status: "ok" | "rejected" | "info" }
  | { kind: "error"; text: string };

export interface ChatState {
  dashboardId: string | null;
  items: ChatItem[];
  running: boolean;
  startedAt: number | null;
  seconds: number | null;
}

let state: ChatState = { dashboardId: null, items: [], running: false, startedAt: null, seconds: null };
const listeners = new Set<() => void>();

function set(patch: Partial<ChatState>) {
  state = { ...state, ...patch };
  for (const l of listeners) l();
}

function push(item: ChatItem) {
  set({ items: [...state.items, item] });
}

export function useChat(): ChatState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );
}

/** Point the conversation at a dashboard; a different one starts fresh. */
export function attachChat(dashboardId: string) {
  if (state.dashboardId === dashboardId || state.running) return;
  set({ dashboardId, items: [], seconds: null });
}

function handle(event: ChatEvent) {
  switch (event.type) {
    case "step":
      push({ kind: "step", text: event.text, status: event.status });
      break;
    case "message":
      push({ kind: "assistant", text: event.text });
      break;
    case "error":
      push({ kind: "error", text: event.message });
      break;
    case "dashboard": {
      const first = state.dashboardId !== event.id;
      set({ dashboardId: event.id });
      void queryClient.invalidateQueries({ queryKey: ["dashboard", event.id] });
      void queryClient.invalidateQueries({ queryKey: ["dashboards"] });
      if (first && window.location.pathname !== `/d/${event.id}`) navigate(`/d/${encodeURIComponent(event.id)}`);
      break;
    }
    case "done":
      set({ running: false, seconds: event.seconds });
      break;
  }
}

/** Send a message; with no open dashboard the agent builds a new one. */
export async function sendChat(message: string) {
  if (state.running) return;
  const history = state.items
    .filter((i): i is Extract<ChatItem, { kind: "user" | "assistant" }> => i.kind === "user" || i.kind === "assistant")
    .slice(-20)
    .map((i) => ({ role: i.kind, text: i.text }));
  const body: ChatRequestInput = { message, history, ...(state.dashboardId && { dashboardId: state.dashboardId }) };
  push({ kind: "user", text: message });
  set({ running: true, startedAt: Date.now(), seconds: null });

  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok || !res.body) {
      const err = (await res.json().catch(() => null)) as { error?: string } | null;
      throw new Error(err?.error ?? `HTTP ${res.status}`);
    }
    // Server-sent events: blank-line separated frames; each carries one JSON `data:` line.
    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += value;
      const frames = buffer.split(/\r?\n\r?\n/);
      buffer = frames.pop() ?? "";
      for (const frame of frames) {
        const data = frame
          .split(/\r?\n/)
          .filter((l) => l.startsWith("data:"))
          .map((l) => l.slice(5).trimStart())
          .join("\n");
        if (data) handle(JSON.parse(data) as ChatEvent);
      }
    }
  } catch (err) {
    push({ kind: "error", text: err instanceof Error ? err.message : String(err) });
  } finally {
    if (state.running) set({ running: false, seconds: state.startedAt ? (Date.now() - state.startedAt) / 1000 : null });
  }
}

/** Start a new dashboard from the list page's prompt box. */
export function startNewDashboard(prompt: string) {
  if (state.running) return;
  set({ dashboardId: null, items: [], seconds: null });
  navigate("/new");
  void sendChat(prompt);
}
