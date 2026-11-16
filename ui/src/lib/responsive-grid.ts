import { GRID_COLUMNS, type Layout } from "@poc/spec";

/**
 * Copied from Holotable src/lib/responsive-grid.ts. Changed only to take the
 * POC spec's `Layout` instead of Holotable's `Panel`. Presentation-only: the
 * stored 12-column layout is never rewritten.
 */

export type Breakpoint = "sm" | "md" | "lg";

export const BREAKPOINT_COLUMNS: Record<Breakpoint, number> = {
  sm: 1,
  md: 6,
  lg: GRID_COLUMNS,
};

const ROW_HEIGHT_SCALE: Record<Breakpoint, number> = {
  sm: 0.72,
  md: 0.86,
  lg: 1,
};

export function rowHeightAt(breakpoint: Breakpoint, rowHeight: number): number {
  return Math.max(1, Math.round(rowHeight * ROW_HEIGHT_SCALE[breakpoint]));
}

/** Re-flow layouts into `columns`, preserving reading order and relative width. */
export function reflowLayouts(layouts: Layout[], columns: number): Layout[] {
  const cols = Math.min(GRID_COLUMNS, Math.max(1, Math.floor(columns)));
  if (cols === GRID_COLUMNS) return layouts;

  const reading = layouts
    .map((layout, index) => ({ layout, index }))
    .sort((a, b) => a.layout.y - b.layout.y || a.layout.x - b.layout.x || a.index - b.index);

  const out: Layout[] = new Array(layouts.length);
  let x = 0;
  let y = 0;
  let rowHeight = 0;

  for (const { layout, index } of reading) {
    const w = Math.min(cols, Math.max(1, Math.round((layout.w * cols) / GRID_COLUMNS)));
    if (x > 0 && x + w > cols) {
      y += rowHeight;
      x = 0;
      rowHeight = 0;
    }
    out[index] = { x, y, w, h: layout.h };
    x += w;
    rowHeight = Math.max(rowHeight, layout.h);
  }

  return out;
}

/** A layout as a CSS `grid-area` shorthand: `row / column / span h / span w`. */
export function gridArea(layout: Layout, columns: number): string {
  const w = Math.min(Math.max(1, layout.w), columns);
  return `${layout.y + 1} / ${layout.x + 1} / span ${Math.max(1, layout.h)} / span ${w}`;
}
