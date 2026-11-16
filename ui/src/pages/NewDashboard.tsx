import { useEffect } from "react";
import { useChat } from "../chat";
import { ChatPanel } from "../components/ChatPanel";
import { Link, navigate } from "../router";

/** Shown while the agent starts a new dashboard; it moves to the dashboard once one exists. */
export function NewDashboard() {
  const chat = useChat();
  // A reload loses the conversation; there is nothing to wait for.
  const idle = !chat.running && chat.items.length === 0;
  useEffect(() => {
    if (idle) navigate("/");
  }, [idle]);
  return (
    <div className="mx-auto flex max-w-[1600px] flex-col gap-4 px-4 py-6 lg:flex-row lg:items-start">
      <main className="min-w-0 flex-1">
        <Link to="/" className="text-sm text-muted hover:text-foreground">
          ← Dashboards
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">New dashboard</h1>
        <p className="mt-1 text-muted">The agent is choosing a dataset. Tiles appear here as it adds them.</p>
      </main>
      <ChatPanel className="h-[32rem] lg:sticky lg:top-6 lg:h-[calc(100vh-3rem)] lg:w-96 lg:shrink-0" />
    </div>
  );
}
