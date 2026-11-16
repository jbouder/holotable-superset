import { useEffect, useState } from "react";
import { resolveColor } from "../lib/oklch";

/**
 * A slimmed version of Holotable's src/lib/color/chart-theme.ts. A canvas
 * cannot read CSS variables or oklch(), so the chart tokens are read off
 * <html> and converted to hex, and read again when the theme changes.
 */
export interface ChartTheme {
  series: string[];
  text: string;
  line: string;
  grid: string;
  raised: string;
  foreground: string;
  font: string;
  areaFade: number;
  lineWidth: number;
}

function read(): ChartTheme {
  const style = getComputedStyle(document.documentElement);
  const token = (name: string) => resolveColor(style.getPropertyValue(name).trim());
  const num = (name: string, fallback: number) => {
    const n = Number.parseFloat(style.getPropertyValue(name));
    return Number.isFinite(n) ? n : fallback;
  };
  return {
    series: Array.from({ length: 8 }, (_, i) => token(`--chart-${i + 1}`)),
    text: token("--chart-text"),
    line: token("--chart-axis"),
    grid: token("--chart-grid"),
    raised: token("--surface-3"),
    foreground: token("--foreground"),
    font: style.getPropertyValue("--font-sans").trim() || "sans-serif",
    areaFade: num("--chart-area-fade", 0.32),
    lineWidth: num("--chart-line-width", 2),
  };
}

export function useChartTheme(): ChartTheme {
  const [theme, setTheme] = useState(read);
  useEffect(() => {
    const update = () => setTheme(read());
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);
  return theme;
}
