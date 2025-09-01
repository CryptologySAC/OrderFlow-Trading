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

let _isSyncing: boolean = false;
let chartUpdateScheduled: boolean = false;
let _supportResistanceLevels: SupportResistanceLevel[] = [];

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

let _orderBookUpdateTimeout: NodeJS.Timeout | null = null;
let _lastOrderBookDraw: number = 0;

export function scheduleOrderBookUpdate(): void {
    if (!orderBookChart) return;

    // Direct update - let Chart.js handle optimization internally
    orderBookChart.update();
    _lastOrderBookDraw = Date.now();
}

// =============================================================================
// Y-AXIS BOUNDS MANAGEMENT
// =============================================================================

/**
 * Updates Y-axis bounds based on visible trades (optimized for performance)
 */
export function updateYAxisBounds(): void {
    if (!tradesChart || trades.length === 0) return;

    const xMin: number | undefined = tradesChart.options.scales.x.min;
    const xMax: number | undefined = tradesChart.options.scales.x.max;

    if (xMin === undefined || xMax === undefined) return;

    // PERFORMANCE OPTIMIZATION: Use single pass through trades array
    // Instead of filter + map + spread, do everything in one loop
    let yMin: number = Infinity;
    let yMax: number = -Infinity;
    let visibleCount: number = 0;

    // Single efficient loop through trades
    for (let i: number = trades.length - 1; i >= 0; i--) {
        const trade: Trade | undefined = trades[i];
        if (trade && trade.time >= xMin && trade.time <= xMax) {
            const price: number = trade.price;
            if (price < yMin) yMin = price;
            if (price > yMax) yMax = price;
            visibleCount++;

            // Early exit if we have enough samples for accurate bounds
            if (visibleCount >= 1000) break;
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
