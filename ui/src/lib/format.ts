import type { ColumnType } from "@poc/spec";

type NumberFormat = "number" | "compact" | "percent" | "currency" | undefined;

const formatters: Record<Exclude<NumberFormat, undefined>, Intl.NumberFormat> = {
  number: new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }),
  compact: new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }),
  percent: new Intl.NumberFormat("en-US", { style: "percent", maximumFractionDigits: 1 }),
  currency: new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }),
};

export function formatNumber(value: unknown, format: NumberFormat = "number"): string {
  const n = typeof value === "number" ? value : Number(value);
  if (value === null || value === undefined || value === "" || !Number.isFinite(n)) return "–";
  return formatters[format].format(n);
}

/**
 * A time value as short as it can be while still telling rows apart: a year
 * when every value falls on January 1, a month when every value falls on the
 * 1st, a date otherwise.
 */
export function timeFormatter(values: unknown[]): (value: unknown) => string {
  const dates = values.map((v) => new Date(String(v))).filter((d) => !Number.isNaN(d.getTime()));
  const allYears = dates.every((d) => d.getUTCMonth() === 0 && d.getUTCDate() === 1);
  const allMonths = dates.every((d) => d.getUTCDate() === 1);
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    ...(allYears ? { year: "numeric" } : allMonths ? { year: "numeric", month: "short" } : { dateStyle: "medium" }),
  });
  return (value) => {
    const d = new Date(String(value));
    return Number.isNaN(d.getTime()) ? String(value ?? "") : fmt.format(d);
  };
}

export function formatCell(value: unknown, type: ColumnType | undefined, format?: NumberFormat): string {
  if (value === null || value === undefined) return "–";
  if (type === "number") return formatNumber(value, format);
  if (type === "time") return timeFormatter([value])(value);
  return String(value);
}
