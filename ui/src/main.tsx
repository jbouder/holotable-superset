import { QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { DashboardList } from "./pages/DashboardList";
import { DashboardView } from "./pages/DashboardView";
import { NewDashboard } from "./pages/NewDashboard";
import { queryClient } from "./query-client";
import { usePath } from "./router";
import "./styles.css";

function App() {
  const path = usePath();
  if (path === "/new") return <NewDashboard />;
  const match = /^\/d\/([^/]+)$/.exec(path);
  return match?.[1] ? <DashboardView id={decodeURIComponent(match[1])} /> : <DashboardList />;
}

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
