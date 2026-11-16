import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import { Card } from "../components/card";
import { Link } from "../router";

export function DashboardList() {
  const list = useQuery({ queryKey: ["dashboards"], queryFn: api.dashboards });
  return (
    <main className="mx-auto max-w-5xl px-4 py-8">
      <h1 className="mb-6 text-2xl font-semibold">Dashboards</h1>
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
