import { useQuery } from "@tanstack/react-query";
import { type FormEvent, useId, useState } from "react";
import { api } from "../api";
import { startNewDashboard, useChat } from "../chat";
import { Card } from "../components/card";
import { Link } from "../router";

export function DashboardList() {
  const list = useQuery({ queryKey: ["dashboards"], queryFn: api.dashboards });
  return (
    <main className="mx-auto max-w-5xl px-4 py-8">
      <h1 className="mb-6 text-2xl font-semibold">Dashboards</h1>
      <PromptBox />
      {list.isPending ? (
        <p className="text-muted">Loading…</p>
      ) : list.isError ? (
        <p role="alert" className="text-danger">
          Could not load dashboards: {list.error.message}
        </p>
      ) : list.data.length === 0 ? (
        <p className="text-muted">No dashboards yet.</p>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2">
          {list.data.map((d) => (
            <li key={d.id}>
              <Card className="h-full p-4 hover:border-border-strong">
                <Link to={`/d/${d.id}`} className="text-base font-semibold hover:underline">
                  {d.title}
                </Link>
                {d.summary ? <p className="mt-1 text-sm text-muted">{d.summary}</p> : null}
                <p className="mt-3 text-xs text-muted">
                  {d.tiles} tiles · version {d.version}
                </p>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

const EXAMPLE = "Show US births over time, by gender and by state, with the most common names";

/** Describe a dashboard; the agent builds it. */
function PromptBox() {
  const chat = useChat();
  const [prompt, setPrompt] = useState("");
  const id = useId();
  function submit(e: FormEvent) {
    e.preventDefault();
    if (prompt.trim() && !chat.running) startNewDashboard(prompt.trim());
  }
  return (
    <form onSubmit={submit} className="mb-8">
      <Card className="p-4">
        <label htmlFor={id} className="text-sm font-semibold">
          New dashboard
        </label>
        <textarea
          id={id}
          rows={3}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit(e);
          }}
          placeholder={EXAMPLE}
          className="mt-2 w-full resize-y rounded-sm border border-border-strong bg-surface px-3 py-2 text-sm"
        />
        <div className="mt-2 flex items-center justify-between gap-3">
          <button type="button" className="text-xs text-muted hover:text-foreground" onClick={() => setPrompt(EXAMPLE)}>
            Use the example
          </button>
          <button
            type="submit"
            disabled={chat.running || !prompt.trim()}
            className="rounded-sm bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            Build it
          </button>
        </div>
      </Card>
    </form>
  );
}
