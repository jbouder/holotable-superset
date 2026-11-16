import type { Tile } from "@poc/spec";
import type * as React from "react";
import { BREAKPOINT_COLUMNS, gridArea, reflowLayouts, rowHeightAt } from "../lib/responsive-grid";

/**
 * Adapted from Holotable src/components/dashboard/DashboardGrid.tsx: the same
 * 12-column grid, re-flowed to six columns on a tablet and one on a phone,
 * emitted as CSS custom properties so the browser picks the arrangement.
 * Left out for the POC: FLIP animation, the per-panel error boundary and the
 * non-responsive editor mode.
 */
export function DashboardGrid({
  tiles,
  renderTile,
  rowHeight = 84,
}: {
  tiles: Tile[];
  renderTile: (tile: Tile) => React.ReactNode;
  rowHeight?: number;
}) {
  const source = tiles.map((t) => t.layout);
  const layouts = {
    sm: reflowLayouts(source, BREAKPOINT_COLUMNS.sm),
    md: reflowLayouts(source, BREAKPOINT_COLUMNS.md),
    lg: reflowLayouts(source, BREAKPOINT_COLUMNS.lg),
  };

  return (
    <div
      className="grid grid-cols-1 gap-4 [grid-auto-rows:var(--row-sm)] md:grid-cols-6 md:[grid-auto-rows:var(--row-md)] lg:grid-cols-12 lg:[grid-auto-rows:var(--row-lg)]"
      style={
        {
          "--row-sm": `${rowHeightAt("sm", rowHeight)}px`,
          "--row-md": `${rowHeightAt("md", rowHeight)}px`,
          "--row-lg": `${rowHeightAt("lg", rowHeight)}px`,
        } as React.CSSProperties
      }
    >
      {tiles.map((tile, i) => (
        <div
          key={tile.id}
          style={
            {
              "--area-sm": gridArea(layouts.sm[i] ?? tile.layout, BREAKPOINT_COLUMNS.sm),
              "--area-md": gridArea(layouts.md[i] ?? tile.layout, BREAKPOINT_COLUMNS.md),
              "--area-lg": gridArea(layouts.lg[i] ?? tile.layout, BREAKPOINT_COLUMNS.lg),
            } as React.CSSProperties
          }
          className="min-h-0 [grid-area:var(--area-sm)] md:[grid-area:var(--area-md)] lg:[grid-area:var(--area-lg)]"
        >
          {renderTile(tile)}
        </div>
      ))}
    </div>
  );
}
