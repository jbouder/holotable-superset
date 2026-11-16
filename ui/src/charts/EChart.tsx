import type { EChartsCoreOption } from "echarts/core";
import { useEffect, useRef } from "react";
import { type ECharts, init } from "./echarts";

/** A minimal ECharts host: one instance per mount, resized with its box. */
export function EChart({ option, label }: { option: EChartsCoreOption; label: string }) {
  const host = useRef<HTMLDivElement>(null);
  const chart = useRef<ECharts | null>(null);

  useEffect(() => {
    if (!host.current) return;
    const instance = init(host.current, undefined, { renderer: "canvas" });
    chart.current = instance;
    const observer = new ResizeObserver(() => instance.resize());
    observer.observe(host.current);
    return () => {
      observer.disconnect();
      instance.dispose();
      chart.current = null;
    };
  }, []);

  useEffect(() => {
    chart.current?.setOption({ ...option, aria: { enabled: true, label: { description: label } } }, true);
  }, [option, label]);

  return <div ref={host} role="img" aria-label={label} className="h-full w-full min-h-0" />;
}
