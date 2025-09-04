// Type declarations for ui.js
import { Chart } from "chart.js";
export declare function setRange(
    duration: number | null,
    tradeChart: Chart<"scatter">,
    rsiChart: Chart<"line">
): void;
export declare function setupColumnResizing(): void;
export declare function triggerChartResize(): void;
