import { BarChart, LineChart } from "echarts/charts";
import {
  AriaComponent,
  AxisPointerComponent,
  GridComponent,
  LegendComponent,
  TooltipComponent,
} from "echarts/components";
import type { ECharts } from "echarts/core";
import { init, use } from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";

/**
 * Pruned from Holotable src/components/charts/echarts.ts: the one module that
 * loads ECharts at runtime, registering only what bar, line and area draw.
 */
use([
  CanvasRenderer,
  BarChart,
  LineChart,
  AriaComponent,
  AxisPointerComponent,
  GridComponent,
  LegendComponent,
  TooltipComponent,
]);

export { init };
export type { ECharts };
