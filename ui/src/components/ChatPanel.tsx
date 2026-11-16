import { type FormEvent, useEffect, useId, useRef, useState } from "react";
import { type ChatItem, sendChat, useChat } from "../chat";
import { cn } from "../lib/utils";
import { Card } from "./card";

/** The agent conversation, docked beside the dashboard. */
export function ChatPanel({ className }: { className?: string }) {
  const chat = useChat();
  const [draft, setDraft] = useState("");
  const inputId = useId();
  const logRef = useRef<HTMLOListElement>(null);

  useEffect(() => {
    const log = logRef.current;
    if (log) log.scrollTop = log.scrollHeight;
  }, [chat.items.length]);

  function submit(e: FormEvent) {
    e.preventDefault();
    const text = draft.trim();
    if (!text || chat.running) return;
    setDraft("");
    void sendChat(text);
  }

  return (
    <Card className={cn("flex min-h-0 flex-col", className)}>
      <h2 className="border-b border-border px-4 py-3 text-sm font-semibold">Agent</h2>
      <ol ref={logRef} aria-live="polite" className="min-h-0 flex-1 space-y-2 overflow-y-auto px-4 py-3 text-sm">
        {chat.items.length === 0 ? (
          <li className="text-muted">Ask for a change, like "make the trend monthly" or "add a table of the top names".</li>
        ) : (
          chat.items.map((item, i) => <ChatLine key={i} item={item} />)
        )}
        {chat.running ? <Working startedAt={chat.startedAt} /> : null}
        {!chat.running && chat.seconds !== null ? (
          <li className="font-mono text-[11px] text-muted">Finished in {chat.seconds.toFixed(1)}s</li>
        ) : null}
      </ol>
      <form onSubmit={submit} className="border-t border-border p-3">
        <label htmlFor={inputId} className="sr-only">
          Message the agent
        </label>
        <textarea
          id={inputId}
          rows={2}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) submit(e);
          }}
          placeholder={chat.running ? "Working…" : "Change this dashboard"}
          className="w-full resize-none rounded-sm border border-border-strong bg-surface px-2 py-1.5 text-sm"
        />
        <div className="mt-2 flex justify-end">
          <button
            type="submit"
            disabled={chat.running || !draft.trim()}
            className="rounded-sm bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            Send
          </button>
        </div>
      </form>
    </Card>
  );
}

function ChatLine({ item }: { item: ChatItem }) {
  switch (item.kind) {
    case "user":
      return <li className="rounded-sm bg-surface-2 px-3 py-2">{item.text}</li>;
    case "assistant":
      return <li className="px-1 py-1">{item.text}</li>;
    case "error":
      return (
        <li role="alert" className="rounded-sm bg-tint-danger px-3 py-2 text-danger">
          {item.text}
        </li>
      );
    case "step":
      return (
        <li className="flex gap-2 px-1 font-mono text-xs text-muted">
          <span aria-hidden="true" className={item.status === "rejected" ? "text-warning" : item.status === "ok" ? "text-success" : ""}>
            {item.status === "rejected" ? "!" : item.status === "ok" ? "+" : "·"}
          </span>
          <span>
            <span className="sr-only">{item.status === "rejected" ? "Rejected: " : ""}</span>
            {item.text}
          </span>
        </li>
      );
  }
}

function Working({ startedAt }: { startedAt: number | null }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const seconds = startedAt ? Math.floor((now - startedAt) / 1000) : 0;
  return <li className="animate-pulse px-1 font-mono text-xs text-muted">Working… {seconds}s</li>;
}
