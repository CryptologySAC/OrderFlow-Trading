// Chart management and utilities for the trading dashboard
// Converted from JavaScript to TypeScript with strict type checking

import type {
    ChartDataPoint,
    ChartAnnotation,
    Trade,
    SupportResistanceLevel,
    Signal,
    OrderBookData,
} from "../frontend-types.js";
import {
    tradesChart,
    orderBookChart,
    rsiChart,
    trades,
    PADDING_TIME,
    FIFTEEN_MINUTES,
} from "./state.js";

//let _isSyncing: boolean = false;
let chartUpdateScheduled: boolean = false;
//let _supportResistanceLevels: SupportResistanceLevel[] = [];

export function scheduleTradesChartUpdate(): void {
    if (!chartUpdateScheduled) {
        chartUpdateScheduled = true;
        requestAnimationFrame(() => {
            if (tradesChart) {
                tradesChart.update("none");
            }
            chartUpdateScheduled = false;
        });
    }
}

//let _orderBookUpdateTimeout: NodeJS.Timeout | null = null;
//let _lastOrderBookDraw: number = 0;

export function scheduleOrderBookUpdate(): void {
    if (!orderBookChart) return;

    // Direct update - let Chart.js handle optimization internally
    orderBookChart.update();
}

// Placeholder functions for functions that will be implemented later
// These are referenced in the original code but not yet converted

export function updateOrderBookBarColors(theme: string): void {
    // TODO: Implement order book bar color updates
    console.log("updateOrderBookBarColors called with theme:", theme);
}

export function initializeTradesChart(ctx: CanvasRenderingContext2D): any {
    // TODO: Implement trades chart initialization
    console.log("initializeTradesChart called");
    return null;
}

export function initializeRSIChart(ctx: CanvasRenderingContext2D): any {
    // TODO: Implement RSI chart initialization
    console.log("initializeRSIChart called");
    return null;
}

export function initializeOrderBookChart(ctx: CanvasRenderingContext2D): any {
    // TODO: Implement order book chart initialization
    console.log("initializeOrderBookChart called");
    return null;
}

export function cleanupOldSupportResistanceLevels(): void {
    // TODO: Implement cleanup of old support/resistance levels
    console.log("cleanupOldSupportResistanceLevels called");
}

export function cleanupOldZones(): void {
    // TODO: Implement cleanup of old zones
    console.log("cleanupOldZones called");
}

export function handleSupportResistanceLevel(data: any): void {
    // TODO: Implement support/resistance level handling
    console.log("handleSupportResistanceLevel called with:", data);
}

export function handleZoneUpdate(data: any): void {
    // TODO: Implement zone update handling
    console.log("handleZoneUpdate called with:", data);
}

export function handleZoneSignal(data: any): void {
    // TODO: Implement zone signal handling
    console.log("handleZoneSignal called with:", data);
}

export function updateOrderBookDisplay(data: OrderBookData): void {
    // TODO: Implement order book display update
    console.log("updateOrderBookDisplay called with:", data);
}

export function safeUpdateRSIChart(data: any): boolean {
    // TODO: Implement safe RSI chart update
    console.log("safeUpdateRSIChart called with:", data);
    return true;
}

// =============================================================================
// Y-AXIS BOUNDS MANAGEMENT
// =============================================================================

/**
 * Updates Y-axis bounds based on visible trades (optimized for performance)
 */
export function updateYAxisBounds(
    tradesData?: (ChartDataPoint | Trade)[]
): void {
    const tradesArray = tradesData || trades;
    if (!tradesChart || tradesArray.length === 0) return;

    const xMin: number | undefined = tradesChart.options.scales.x.min;
    const xMax: number | undefined = tradesChart.options.scales.x.max;

    if (xMin === undefined || xMax === undefined) return;

    // PERFORMANCE OPTIMIZATION: Use single pass through trades array
    // Instead of filter + map + spread, do everything in one loop
    let yMin: number = Infinity;
    let yMax: number = -Infinity;
    let visibleCount: number = 0;

    // Single efficient loop through trades
    for (let i: number = tradesArray.length - 1; i >= 0; i--) {
        const trade: ChartDataPoint | Trade | undefined = tradesArray[i];
        if (trade) {
            const tradeTime = (trade as any).x || (trade as any).time;
            const tradePrice = (trade as any).y || (trade as any).price;

            if (tradeTime >= xMin && tradeTime <= xMax) {
                if (tradePrice < yMin) yMin = tradePrice;
                if (tradePrice > yMax) yMax = tradePrice;
                visibleCount++;

                // Early exit if we have enough samples for accurate bounds
                if (visibleCount >= 1000) break;
            }
        }
    }

    if (visibleCount === 0) return;

    const padding: number = (yMax - yMin) * 0.05;
    tradesChart.options.scales.y.suggestedMin = yMin - padding;
    tradesChart.options.scales.y.suggestedMax = yMax + padding;
    delete tradesChart.options.scales.y.min;
    delete tradesChart.options.scales.y.max;
}

// =============================================================================
// TIME ANNOTATIONS MANAGEMENT
// =============================================================================

/**
 * Updates 15-minute annotations efficiently
 */
export function updateTimeAnnotations(
    latestTime: number,
    activeRange: number
): void {
    if (!tradesChart) return;
    const annotations: Record<string, ChartAnnotation> =
        tradesChart.options.plugins?.annotation?.annotations || {};
    const min: number = latestTime - activeRange;
    const max: number = latestTime + PADDING_TIME;

    // Remove old annotations
    Object.keys(annotations).forEach((key: string) => {
        const keyNum: number = parseFloat(key);
        if (!isNaN(keyNum) && (keyNum < min || keyNum > max)) {
            delete annotations[key];
        }
    });

    // Add new time annotations
    let time: number = Math.ceil(min / FIFTEEN_MINUTES) * FIFTEEN_MINUTES;
    while (time <= max) {
        if (!annotations[time.toString()]) {
            annotations[time.toString()] = {
                type: "line",
                xMin: time,
                xMax: time,
                borderColor: "rgba(102, 102, 102, 0.4)",
                borderWidth: 2,
            };
        }
        time += FIFTEEN_MINUTES;
    }
}

/**
 * Updates 15-minute time annotations for RSI chart
 */
export function updateRSITimeAnnotations(
    latestTime: number,
    activeRange: number
): void {
    if (!rsiChart) return;
    const annotations: Record<string, ChartAnnotation> =
        rsiChart.options.plugins?.annotation?.annotations || {};

    // Create a completely new annotations object to avoid circular references
    const newAnnotations: Record<string, ChartAnnotation> = {};

    // Preserve existing overbought/oversold lines with deep copies
    if (annotations["overboughtLine"]) {
        newAnnotations["overboughtLine"] = { ...annotations["overboughtLine"] };
    }

    if (annotations["oversoldLine"]) {
        newAnnotations["oversoldLine"] = { ...annotations["oversoldLine"] };
    }

    // Add time annotations
    const min: number = latestTime - activeRange;
    const max: number = latestTime + PADDING_TIME;
    let time: number = Math.ceil(min / FIFTEEN_MINUTES) * FIFTEEN_MINUTES;
    while (time <= max) {
        newAnnotations[time.toString()] = {
            type: "line",
            xMin: time,
            xMax: time,
            borderColor: "rgba(102, 102, 102, 0.4)",
            borderWidth: 2,
        };
        time += FIFTEEN_MINUTES;
    }

    // Replace the entire annotations object
    if (rsiChart.options.plugins?.annotation) {
        rsiChart.options.plugins.annotation.annotations = newAnnotations;
    }
}

// =============================================================================
// TRADE CREATION UTILITIES
// =============================================================================

export function createTrade(
    x: number,
    y: number,
    quantity: number,
    orderType: "buy" | "sell"
): ChartDataPoint {
    return { x, y, quantity, orderType };
}

// Placeholder functions for functions that will be implemented later
// These are referenced in the original code but not yet converted

export function checkSupportResistanceBreaches(
    price: number,
    time: number
): void {
    // TODO: Implement support/resistance breach checking
    console.log("checkSupportResistanceBreaches called with:", price, time);
}

export function buildSignalLabel(signal: Signal): string {
    // TODO: Implement signal label building
    return `${signal.type} ${signal.side || "unknown"} @ ${signal.price.toFixed(2)}`;
}
