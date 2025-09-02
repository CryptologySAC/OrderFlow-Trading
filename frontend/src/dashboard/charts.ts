import {
    tradesChart,
    orderBookChart,
    rsiChart,
    trades,
    activeRange,
    PADDING_TIME,
    FIFTEEN_MINUTES,
    orderBookData,
    maxSupportResistanceLevels,
    activeZones,
    maxActiveZones,
    signalsList,
    setTradesChart,
    setOrderBookChart,
    setRsiChart,
} from "./state.js";
import { renderSignalsList } from "./render.js";
import {
    getCurrentTheme,
    getSystemTheme,
    getDepletionVisualizationEnabled,
} from "./theme.js";

import type {
    ChartAnnotation,
    ChartInstance,
    ChartDataPoint,
    ChartOptions,
    ChartScale,
    ChartDataset,
    Anomaly,
    Trade,
    OrderBookLevel,
    OrderBookData,
    Signal,
    SupportResistanceLevel,
    ZoneData,
    RSIDataPoint,
} from "../frontend-types.js";

// Define zone types locally
type ZoneUpdateType =
    | "zone_created"
    | "zone_updated"
    | "zone_strengthened"
    | "zone_weakened"
    | "zone_completed"
    | "zone_invalidated";
type ZoneSignalType = "completion" | "invalidation" | "consumption";

// Magic number constants
const PADDING_PERCENTAGE = 0.05;
const MAX_LABEL_LENGTH = 250;
const TRUNCATED_LABEL_LENGTH = 245;
const PRICE_DEVIATION_THRESHOLD = 0.02;

// Module-level variables with proper types
let isSyncing = false;
let chartUpdateScheduled = false;
let supportResistanceLevels: SupportResistanceLevel[] = [];

// Global reference for RSI canvas (used in safeUpdateRSIChart)
declare const rsiCanvas: HTMLCanvasElement | undefined;

/**
 * Schedules a trades chart update using requestAnimationFrame
 */
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

/**
 * Schedules an order book chart update
 */
export function scheduleOrderBookUpdate(): void {
    if (!orderBookChart) return;

    // Direct update - let Chart.js handle optimization internally
    orderBookChart.update();
}

/**
 * Updates Y-axis bounds based on visible trades (optimized for performance)
 */
export function updateYAxisBounds(): void {
    if (!tradesChart || trades.length === 0) return;

    const chartOptions = tradesChart.options as ChartOptions;
    const xMin: number = chartOptions.scales.x.min as number;
    const xMax: number = chartOptions.scales.x.max as number;

    // PERFORMANCE OPTIMIZATION: Use single pass through trades array
    // Instead of filter + map + spread, do everything in one loop
    let yMin: number = Infinity;
    let yMax: number = -Infinity;
    let visibleCount: number = 0;

    // Single efficient loop through trades
    for (let i = trades.length - 1; i >= 0; i--) {
        const trade: ChartDataPoint | undefined = trades[i];
        if (!trade) continue;
        if (trade.x >= xMin && trade.x <= xMax) {
            const price: number = trade.y;
            if (price < yMin) yMin = price;
            if (price > yMax) yMax = price;
            visibleCount++;

            // Early exit if we have enough samples for accurate bounds
            if (visibleCount >= 1000) break;
        }
    }

    if (visibleCount === 0) return;

    const padding: number = (yMax - yMin) * PADDING_PERCENTAGE;
    const tradesChartOptions = tradesChart.options as ChartOptions;
    const yScale = tradesChartOptions.scales.y;
    yScale.suggestedMin = yMin - padding;
    yScale.suggestedMax = yMax + padding;
    delete yScale.min;
    delete yScale.max;
}

/**
 * Updates 15-minute annotations efficiently
 */
export function updateTimeAnnotations(
    latestTime: number,
    activeRange: number
): void {
    if (!tradesChart) return;
    const chartOptions = tradesChart.options as ChartOptions;
    const annotations: Record<string, ChartAnnotation> = (
        chartOptions.plugins?.annotation as any
    ).annotations;
    const min: number = latestTime - activeRange;
    const max: number = latestTime + PADDING_TIME;

    Object.keys(annotations).forEach((key: string) => {
        if (!isNaN(Number(key)) && (Number(key) < min || Number(key) > max)) {
            delete annotations[key];
        }
    });

    let time: number = Math.ceil(min / FIFTEEN_MINUTES) * FIFTEEN_MINUTES;
    while (time <= max) {
        if (!annotations[time]) {
            annotations[time] = {
                type: "line",
                xMin: time,
                xMax: time,
                borderColor: "rgba(102, 102, 102, 0.4)",
                borderWidth: 2,
                z: 1,
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
    const rsiChartOptions = rsiChart.options as ChartOptions;
    const annotations: Record<string, ChartAnnotation> = (
        rsiChartOptions.plugins?.annotation as any
    ).annotations;

    // Create a completely new annotations object to avoid circular references
    const newAnnotations: Record<string, ChartAnnotation> = {};

    // Preserve existing overbought/oversold lines with deep copies
    if (annotations["overboughtLine"]) {
        newAnnotations["overboughtLine"] = {
            type: annotations["overboughtLine"].type,
            yMin: annotations["overboughtLine"].yMin,
            yMax: annotations["overboughtLine"].yMax,
            borderColor: annotations["overboughtLine"].borderColor,
            borderWidth: annotations["overboughtLine"].borderWidth,
            borderDash: annotations["overboughtLine"].borderDash,
            drawTime: annotations["overboughtLine"].drawTime,
            label: annotations["overboughtLine"]
                .label as ChartAnnotation["label"],
        } as ChartAnnotation;
    }

    if (annotations["oversoldLine"]) {
        newAnnotations["oversoldLine"] = {
            type: annotations["oversoldLine"].type,
            yMin: annotations["oversoldLine"].yMin,
            yMax: annotations["oversoldLine"].yMax,
            borderColor: annotations["oversoldLine"].borderColor,
            borderWidth: annotations["oversoldLine"].borderWidth,
            borderDash: annotations["oversoldLine"].borderDash,
            drawTime: annotations["oversoldLine"].drawTime,
            label: annotations["oversoldLine"]
                .label as ChartAnnotation["label"],
        } as ChartAnnotation;
    }

    // Add time annotations
    const min: number = latestTime - activeRange;
    const max: number = latestTime + PADDING_TIME;
    let time: number = Math.ceil(min / FIFTEEN_MINUTES) * FIFTEEN_MINUTES;
    while (time <= max) {
        newAnnotations[time] = {
            type: "line",
            xMin: time,
            xMax: time,
            borderColor: "rgba(102, 102, 102, 0.4)",
            borderWidth: 2,
            z: 1,
        };
        time += FIFTEEN_MINUTES;
    }

    // Replace the entire annotations object
    (rsiChart.options.plugins as any).annotation.annotations = newAnnotations;
}

export function createTrade(
    x: number,
    y: number,
    quantity: number,
    orderType: string
): ChartDataPoint {
    return {
        x,
        y,
        quantity,
        orderType: (orderType.toLowerCase() === "buy" ? "BUY" : "SELL") as
            | "BUY"
            | "SELL",
    };
}

/**
 * Build a label string for orderflow signals for chart annotations.
 */
export function buildSignalLabel(signal: Signal): string {
    if (!signal) return "Invalid Signal";

    // 1. Main signal summary (type/side/price/time)
    let label: string = `[${signal.type?.toUpperCase() ?? "?"}] ${signal.side?.toUpperCase() ?? "?"} @ ${signal.price?.toFixed(2) ?? "?"}`;

    // 2. Confidence/Confirmations
    if (signal.confidence !== undefined) {
        label += `\nConf: ${(signal.confidence * 100).toFixed(0)}%`;
    }

    // Optional: truncate if label is too long for chart
    if (label.length > MAX_LABEL_LENGTH)
        label = label.slice(0, TRUNCATED_LABEL_LENGTH) + "...";

    return label;
}

/**
 * Validates a trade object.
 */
export function isValidTrade(trade: unknown): trade is Trade {
    if (!trade || typeof trade !== "object") return false;

    const t = trade as Record<string, unknown>;
    const orderType = t["orderType"];

    return (
        typeof t["time"] === "number" &&
        typeof t["price"] === "number" &&
        typeof t["quantity"] === "number" &&
        (orderType === "BUY" ||
            orderType === "SELL" ||
            orderType === "buy" ||
            orderType === "sell")
    );
}

/**
 * Gets the background color for a trade based on type and quantity.
 */
function getTradeBackgroundColor(context: any): string {
    const trade: ChartDataPoint = context.raw;
    if (!trade) return "rgba(0, 0, 0, 0)";

    const isBuy: boolean = trade.orderType === "BUY";
    const q: number = trade.quantity || 0;
    const opacity: number =
        q > 500 ? 0.6 : q > 200 ? 0.5 : q > 100 ? 0.4 : q > 15 ? 0.3 : 0.2;
    return isBuy
        ? `rgba(0, 255, 30, ${opacity})`
        : `rgba(255, 0, 90, ${opacity})`;
}

/**
 * Gets the point radius for a trade based on quantity.
 */
function getTradePointRadius(context: any): number {
    const q: number = context.raw?.quantity || 0;
    return q > 1000
        ? 50
        : q > 500
          ? 40
          : q > 200
            ? 25
            : q > 100
              ? 10
              : q > 50
                ? 5
                : 2;
}

/**
 * Initializes the trades scatter chart.
 */
export function initializeTradesChart(
    ctx: CanvasRenderingContext2D
): ChartInstance | null {
    if (tradesChart) return tradesChart;

    // Use EXACT same time calculation as RSI chart
    const now: number = Date.now();
    let initialMin: number, initialMax: number;

    if (activeRange !== null) {
        initialMin = now - activeRange;
        initialMax = now + PADDING_TIME;
    } else {
        initialMin = now - 90 * 60000; // 90 minutes ago
        initialMax = now + PADDING_TIME;
    }

    const chart = new (window as any).Chart(ctx, {
        type: "scatter",
        data: {
            datasets: [
                {
                    label: "Trades",
                    parsing: { xAxisKey: "x", yAxisKey: "y" },
                    data: trades,
                    backgroundColor: getTradeBackgroundColor,
                    pointRadius: getTradePointRadius,
                    hoverRadius: getTradePointRadius,
                },
            ],
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: false,
            layout: { padding: 0 },
            scales: {
                x: {
                    type: "time",
                    time: {
                        unit: "minute",
                        displayFormats: { minute: "HH:mm" },
                    },
                    min: initialMin,
                    max: initialMax,
                    grid: {
                        display: true,
                        color: "rgba(102, 102, 102, 0.1)",
                        ticks: { source: "auto" },
                    },
                },
                y: {
                    type: "linear",
                    title: { display: true, text: "USDT" },
                    ticks: { stepSize: 0.05, precision: 2 },
                    position: "right",
                    grace: 0.1,
                    offset: true,
                },
            },
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: (context: any) => {
                            const t: ChartDataPoint = context.raw;
                            return t
                                ? `Price: ${t.y.toFixed(2)}, Qty: ${t.quantity}, Type: ${t.orderType}`
                                : "";
                        },
                    },
                },
                annotation: {
                    annotations: {
                        lastPriceLine: {
                            type: "line",
                            yMin: undefined,
                            yMax: undefined,
                            borderColor: "blue",
                            borderWidth: 1,
                            drawTime: "afterDatasetsDraw",
                            label: {
                                display: true,
                                content: (ctx: any) =>
                                    (
                                        ctx.chart.options.plugins.annotation
                                            .annotations.lastPriceLine
                                            .yMin as number
                                    )?.toFixed(2) || "",
                                position: "end",
                                xAdjust: -2,
                                yAdjust: 0,
                                backgroundColor: "rgba(0, 0, 255, 0.5)",
                                color: "white",
                                font: { size: 12 },
                                padding: 6,
                            },
                        },
                    },
                },
                zoom: {
                    pan: {
                        enabled: true,
                        mode: "x",
                        onPanComplete: ({ chart }: any) => {
                            if (isSyncing) return;
                            isSyncing = true;
                            if (rsiChart) {
                                const rsiChartOptions =
                                    rsiChart.options as ChartOptions;
                                const chartOptions =
                                    chart.options as ChartOptions;
                                rsiChartOptions.scales.x.min =
                                    chartOptions.scales.x.min;
                                rsiChartOptions.scales.x.max =
                                    chartOptions.scales.x.max;
                                rsiChart.update("none");
                            }
                            isSyncing = false;
                        },
                    },
                    zoom: {
                        wheel: {
                            enabled: true,
                        },
                        pinch: {
                            enabled: true,
                        },
                        mode: "x",
                        onZoomComplete: ({ chart }: any) => {
                            if (isSyncing) return;
                            isSyncing = true;
                            if (rsiChart) {
                                rsiChart.options.scales.x.min =
                                    chart.scales.x.min;
                                rsiChart.options.scales.x.max =
                                    chart.scales.x.max;
                                rsiChart.update("none");
                            }
                            isSyncing = false;
                        },
                    },
                },
            },
        },
    });

    setTradesChart(chart as ChartInstance);

    // Initialize time annotations for specific time ranges
    if (activeRange !== null) {
        updateTimeAnnotations(now, activeRange);
    }

    console.log("Trades chart initialized successfully");
    return chart;
}

/**
 * Initializes the RSI chart.
 */
export function initializeRSIChart(
    ctx: CanvasRenderingContext2D
): ChartInstance | null {
    if (rsiChart) return rsiChart;

    if (typeof (window as any).Chart === "undefined") {
        console.error("Chart.js not loaded - cannot initialize RSI chart");
        throw new Error("Chart.js is not loaded");
    }

    // Get current time range for initial setup - SAME as trades chart
    const now: number = Date.now();
    let initialMin: number, initialMax: number;

    if (activeRange !== null) {
        // Use the SAME calculation as trades chart
        initialMin = now - activeRange;
        initialMax = now + PADDING_TIME;
    } else {
        // For "ALL" case, use the SAME default as trades chart
        initialMin = now - 90 * 60000; // 90 minutes ago
        initialMax = now + PADDING_TIME;
    }

    if (
        typeof (window as any).Chart.Annotation !== "undefined" &&
        !(window as any).Chart.registry.plugins.get("annotation")
    ) {
        (window as any).Chart.register((window as any).Chart.Annotation);
    }

    try {
        const chart = new (window as any).Chart(ctx, {
            type: "line",
            data: {
                datasets: [
                    {
                        label: "RSI",
                        parsing: { xAxisKey: "time", yAxisKey: "rsi" },
                        data: [], // Start with empty data - will be populated by real RSI data
                        borderColor: getRSIColor,
                        backgroundColor: getRSIBackgroundColor,
                        borderWidth: 2,
                        fill: false,
                        pointRadius: 0,
                        hoverRadius: 4,
                        tension: 0.1,
                    },
                ],
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                animation: false,
                layout: { padding: 0 },
                scales: {
                    x: {
                        type: "time",
                        time: {
                            unit: "minute",
                            displayFormats: { minute: "HH:mm" },
                        },
                        min: initialMin,
                        max: initialMax,
                        grid: {
                            display: true,
                            color: "rgba(102, 102, 102, 0.1)",
                        },
                        ticks: { source: "data" }, // Prevent auto-scaling
                    },
                    y: {
                        type: "linear",
                        title: { display: true, text: "RSI" },
                        min: 0,
                        max: 100,
                        ticks: { stepSize: 10 },
                        position: "right",
                        grace: 0,
                        offset: true,
                    },
                },
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            label: (context: any) => {
                                const data: RSIDataPoint = context.raw;
                                return data
                                    ? `RSI: ${data.rsi.toFixed(1)}`
                                    : "";
                            },
                        },
                    },
                    annotation: {
                        annotations: {
                            overboughtLine: {
                                type: "line",
                                yMin: 70,
                                yMax: 70,
                                borderColor: "rgba(255, 0, 0, 0.8)",
                                borderWidth: 1,
                                borderDash: [5, 5],
                                drawTime: "beforeDatasetsDraw",
                                label: {
                                    display: true,
                                    content: "Overbought (70)",
                                    position: "end",
                                    backgroundColor: "rgba(255, 0, 0, 0.8)",
                                    color: "white",
                                    font: { size: 10 },
                                    padding: 4,
                                },
                            },
                            oversoldLine: {
                                type: "line",
                                yMin: 30,
                                yMax: 30,
                                borderColor: "rgba(0, 255, 0, 0.8)",
                                borderWidth: 1,
                                borderDash: [5, 5],
                                drawTime: "beforeDatasetsDraw",
                                label: {
                                    display: true,
                                    content: "Oversold (30)",
                                    position: "start",
                                    backgroundColor: "rgba(0, 255, 0, 0.8)",
                                    color: "white",
                                    font: { size: 10 },
                                    padding: 4,
                                },
                            },
                        },
                    },
                    zoom: {
                        pan: {
                            enabled: true,
                            mode: "x",
                            onPanComplete: ({ chart }: any) => {
                                if (isSyncing) return;
                                isSyncing = true;
                                if (tradesChart) {
                                    tradesChart.options.scales.x.min =
                                        chart.scales.x.min;
                                    tradesChart.options.scales.x.max =
                                        chart.scales.x.max;
                                    tradesChart.update("none");
                                }
                                isSyncing = false;
                            },
                        },
                        zoom: {
                            wheel: {
                                enabled: true,
                            },
                            pinch: {
                                enabled: true,
                            },
                            mode: "x",
                            onZoomComplete: ({ chart }: any) => {
                                if (isSyncing) return;
                                isSyncing = true;
                                if (tradesChart) {
                                    tradesChart.options.scales.x.min =
                                        chart.scales.x.min;
                                    tradesChart.options.scales.x.max =
                                        chart.scales.x.max;
                                    tradesChart.update("none");
                                }
                                isSyncing = false;
                            },
                        },
                    },
                },
            },
        });

        setRsiChart(chart);

        // Initialize time annotations
        if (activeRange !== null) {
            updateRSITimeAnnotations(now, activeRange);
        } else {
            // For "ALL" case, use the calculated range
            updateRSITimeAnnotations(
                (initialMin + initialMax) / 2,
                (initialMax - initialMin) / 2 + PADDING_TIME
            );
        }

        return chart;
    } catch (error) {
        console.error("Failed to create RSI chart:", error);
        return null;
    }
}

/**
 * Safely updates RSI chart with error recovery
 */
export function safeUpdateRSIChart(rsiData: RSIDataPoint[]): boolean {
    if (!rsiChart) {
        console.warn(
            "RSI chart not initialized, attempting to reinitialize..."
        );
        const rsiCtx: CanvasRenderingContext2D | null =
            rsiCanvas?.getContext("2d") || null;
        if (rsiCtx) {
            const newChart: ChartInstance | null = initializeRSIChart(rsiCtx);
            if (!newChart) {
                console.error("Failed to reinitialize RSI chart");
                return false;
            }
        } else {
            console.error(
                "Cannot reinitialize RSI chart - canvas context unavailable"
            );
            return false;
        }
    }

    if (
        rsiChart &&
        rsiChart.data &&
        rsiChart.data.datasets &&
        rsiChart.data.datasets[0]
    ) {
        // Update data directly (backlog loading handles data replacement)
        rsiChart.data.datasets[0].data = rsiData as any;

        // Update chart
        rsiChart.update("none");
        return true;
    }

    console.error("Failed to update RSI chart - chart structure invalid");
    return false;
}

/**
 * Gets the color for RSI line based on current value
 */
function getRSIColor(context: any): string {
    const data: RSIDataPoint = context.raw;
    if (!data || typeof data.rsi !== "number") return "rgba(102, 102, 102, 1)";

    const rsi: number = data.rsi;
    if (rsi >= 70) return "rgba(255, 0, 0, 1)"; // Red for overbought
    if (rsi <= 30) return "rgba(0, 255, 0, 1)"; // Green for oversold
    return "rgba(102, 102, 102, 1)"; // Gray for neutral
}

/**
 * Gets the background color for RSI chart area
 */
function getRSIBackgroundColor(context: any): string {
    const data: RSIDataPoint = context.raw;
    if (!data || typeof data.rsi !== "number")
        return "rgba(102, 102, 102, 0.1)";

    const rsi: number = data.rsi;
    if (rsi >= 70) return "rgba(255, 0, 0, 0.1)"; // Light red for overbought
    if (rsi <= 30) return "rgba(0, 255, 0, 0.1)"; // Light green for oversold
    return "rgba(102, 102, 102, 0.1)"; // Light gray for neutral
}

/**
 * Initializes the order book bar chart.
 */
export function initializeOrderBookChart(
    ctx: CanvasRenderingContext2D
): ChartInstance | null {
    if (orderBookChart) return orderBookChart;
    if (typeof (window as any).Chart === "undefined") {
        throw new Error("Chart.js is not loaded");
    }

    // Create labels for both bid and ask positions for each price level
    const labels: string[] = [];
    const askData: (number | null)[] = [];
    const bidData: (number | null)[] = [];
    const askColors: string[] = [];
    const bidColors: string[] = [];

    orderBookData.priceLevels.forEach((level: OrderBookLevel) => {
        const basePrice: number = level.price;
        const priceStr: string = basePrice.toFixed(2);

        // Add ask position (upper part of price tick)
        labels.push(`${priceStr}_ask`);
        askData.push(level.ask);
        bidData.push(null);
        askColors.push("rgba(255, 0, 0, 0.5)"); // Placeholder, will be updated by theme
        bidColors.push("rgba(0, 0, 0, 0)");

        // Add bid position (lower part of price tick)
        labels.push(`${priceStr}_bid`);
        askData.push(null);
        bidData.push(level.bid);
        askColors.push("rgba(0, 0, 0, 0)");
        bidColors.push("rgba(0, 128, 0, 0.5)"); // Placeholder, will be updated by theme
    });

    const chart: ChartInstance = new (window as any).Chart(ctx, {
        type: "bar",
        data: {
            labels: labels,
            datasets: [
                {
                    label: "Asks",
                    data: askData,
                    backgroundColor: askColors,
                    borderColor: "rgba(255, 0, 0, 0.5)",
                    borderWidth: 1,
                    barPercentage: 0.9,
                    categoryPercentage: 1.0,
                },
                {
                    label: "Bids",
                    data: bidData,
                    backgroundColor: bidColors,
                    borderColor: "rgba(0, 128, 0, 0.5)",
                    borderWidth: 1,
                    barPercentage: 0.9,
                    categoryPercentage: 1.0,
                },
            ],
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: false,
            indexAxis: "y",
            scales: {
                x: {
                    title: { display: true, text: "Volume (LTC)" },
                    ticks: {
                        callback: (value: unknown) => Math.abs(value as number),
                    },
                },
                y: {
                    title: { display: true, text: "Price (USDT)" },
                    offset: true,
                    reverse: true,
                    ticks: {
                        callback: function (
                            this: {
                                getLabelForValue: (index: number) => string;
                            },
                            _value: unknown,
                            index: number
                        ) {
                            const label: string = this.getLabelForValue(
                                index
                            ) as string;
                            if (label && label.includes("_ask")) {
                                return label.split("_")[0]; // Only show price for ask positions
                            }
                            return "";
                        },
                    },
                },
            },
            datasets: {
                bar: {
                    barPercentage: 1.0,
                    categoryPercentage: 0.5,
                },
            },
            plugins: {
                legend: {
                    display: true,
                    position: "top",
                    labels: {
                        usePointStyle: true,
                        boxWidth: 10,
                        boxHeight: 10,
                        padding: 10,
                        font: { size: 12 },
                    },
                },
                tooltip: {
                    callbacks: {
                        label: function (context: any) {
                            const label: string = context.label || "";
                            const isAsk: boolean = label.includes("_ask");
                            const isBid: boolean = label.includes("_bid");
                            const priceStr: string = label.split("_")[0] ?? "";
                            const price: number = parseFloat(priceStr);

                            // Find the corresponding price level
                            const level: OrderBookLevel | undefined =
                                orderBookData.priceLevels.find(
                                    (l: OrderBookLevel) =>
                                        Math.abs(l.price - price) < 0.001
                                );

                            if (!level) return "";

                            let tooltipText: string = "";
                            if (isAsk && level.ask > 0) {
                                tooltipText = `Ask: ${level.ask} LTC at ${price.toFixed(2)}`;
                            } else if (isBid && level.bid > 0) {
                                tooltipText = `Bid: ${level.bid} LTC at ${price.toFixed(2)}`;
                            } else {
                                return "";
                            }

                            // Add depletion information if available
                            if (
                                level.depletionRatio &&
                                level.depletionRatio > 0
                            ) {
                                const depletionPercent: string = (
                                    level.depletionRatio * 100
                                ).toFixed(1);
                                const depletionVelocity: string =
                                    level.depletionVelocity
                                        ? level.depletionVelocity.toFixed(1)
                                        : "0.0";

                                tooltipText += `\nDepletion: ${depletionPercent}% (${depletionVelocity} LTC/sec)`;

                                // Add depletion severity indicator
                                if (level.depletionRatio >= 0.7) {
                                    tooltipText += " 🔥 HIGH";
                                } else if (level.depletionRatio >= 0.3) {
                                    tooltipText += " ⚠️ MEDIUM";
                                }
                            }

                            return tooltipText;
                        },
                        title: function (context: any) {
                            const label: string = context[0].label || "";
                            const priceStr: string = label.split("_")[0] ?? "";
                            return `Price: ${priceStr}`;
                        },
                    },
                },
            },
        },
    });
    setOrderBookChart(chart);
    return chart;
}

/**
 * Get depletion-aware color for orderbook bars
 */
function getDepletionColor(
    volume: number,
    depletionRatio: number,
    side: "ask" | "bid",
    theme: string
): string {
    if (volume <= 0) return "rgba(0, 0, 0, 0)";

    // Check if depletion visualization is enabled
    const depletionEnabled: boolean =
        typeof getDepletionVisualizationEnabled === "function"
            ? getDepletionVisualizationEnabled()
            : true;

    // Base colors for ask/bid
    const baseColors: Record<string, [number, number, number]> = {
        ask: theme === "dark" ? [255, 80, 80] : [255, 0, 0], // Red
        bid: theme === "dark" ? [80, 255, 80] : [0, 128, 0], // Green
    };

    const [r, g, b]: [number, number, number] = baseColors[side] || [0, 0, 0];

    // Calculate opacity based on volume
    let baseOpacity: number =
        theme === "dark"
            ? Math.min(volume / 1500, 0.9)
            : Math.min(volume / 2000, 1);

    // Apply depletion effect only if visualization is enabled
    if (depletionEnabled && depletionRatio > 0) {
        if (depletionRatio < 0.3) {
            // Low depletion - slight color shift
            baseOpacity = Math.max(baseOpacity, 0.4);
        } else if (depletionRatio < 0.7) {
            // Medium depletion - moderate intensification
            baseOpacity = Math.max(baseOpacity, 0.6);
        } else {
            // High depletion - strong intensification
            baseOpacity = Math.max(baseOpacity, 0.8);
        }
    }

    return `rgba(${r}, ${g}, ${b}, ${Math.max(baseOpacity, 0.3)})`;
}

/**
 * Update orderbook border colors for better visibility
 */
function updateOrderBookBorderColors(theme: string): void {
    if (!orderBookChart) return;

    const datasets: any[] = orderBookChart.data.datasets;
    if (!datasets || datasets.length < 2) return;

    const borderOpacity: number = theme === "dark" ? 0.8 : 0.5;

    // Enhanced border colors for depletion visualization
    datasets[0].borderColor =
        theme === "dark"
            ? `rgba(255, 120, 120, ${borderOpacity})`
            : `rgba(255, 0, 0, ${borderOpacity})`;
    datasets[1].borderColor =
        theme === "dark"
            ? `rgba(120, 255, 120, ${borderOpacity})`
            : `rgba(0, 128, 0, ${borderOpacity})`;
}

export function updateOrderBookBarColors(theme: string): void {
    if (!orderBookChart || !orderBookData) return;

    const datasets: any[] = orderBookChart.data.datasets;
    if (!datasets || datasets.length < 2) return;

    // Enhanced colors for better visibility in dark mode
    const askColors: string[] = [];
    const bidColors: string[] = [];

    orderBookData.priceLevels.forEach((level: OrderBookLevel) => {
        // Ask colors (red) - enhanced opacity for dark mode
        const askOpacity: number =
            theme === "dark"
                ? Math.min(level.ask / 1500, 0.9) // Higher max opacity in dark mode
                : Math.min(level.ask / 2000, 1);

        const askColor: string = level.ask
            ? theme === "dark"
                ? `rgba(255, 80, 80, ${Math.max(askOpacity, 0.3)})` // Brighter red with min opacity
                : `rgba(255, 0, 0, ${askOpacity})`
            : "rgba(0, 0, 0, 0)";

        // Bid colors (green) - enhanced opacity for dark mode
        const bidOpacity: number =
            theme === "dark"
                ? Math.min(level.bid / 1500, 0.9) // Higher max opacity in dark mode
                : Math.min(level.bid / 2000, 1);

        const bidColor: string = level.bid
            ? theme === "dark"
                ? `rgba(80, 255, 80, ${Math.max(bidOpacity, 0.3)})` // Brighter green with min opacity
                : `rgba(0, 128, 0, ${bidOpacity})`
            : "rgba(0, 0, 0, 0)";

        // Add ask position
        askColors.push(askColor);
        bidColors.push("rgba(0, 0, 0, 0)");

        // Add bid position
        askColors.push("rgba(0, 0, 0, 0)");
        bidColors.push(bidColor);
    });

    // Update the chart datasets
    datasets[0].backgroundColor = askColors; // Asks
    datasets[1].backgroundColor = bidColors; // Bids

    // Update border colors for better definition in dark mode
    updateOrderBookBorderColors(theme);
}

/**
 * Validate depletion level data for current market conditions
 * CLAUDE.md COMPLIANCE: Data validation and error handling
 */
function validateDepletionLevel(
    level: OrderBookLevel,
    midPrice: number,
    currentTime: number
): boolean {
    // Check if level has basic required properties
    if (!level || typeof level.price !== "number") {
        console.warn("⚠️ Depletion validation: Invalid level data", level);
        return false;
    }

    // Check price proximity to current market (within 2% of mid price)
    const priceDeviation: number = Math.abs(level.price - midPrice) / midPrice;
    if (priceDeviation > PRICE_DEVIATION_THRESHOLD) {
        console.warn(
            `⚠️ Depletion validation: Price ${level.price.toFixed(4)} too far from mid price ${midPrice.toFixed(4)} (${(priceDeviation * 100).toFixed(2)}% deviation)`
        );
        return false;
    }

    // Check if depletion data exists and is reasonable
    const depletionRatio = level.depletionRatio;
    if (depletionRatio !== undefined && depletionRatio !== null) {
        if (depletionRatio < 0 || depletionRatio > 1) {
            console.warn(
                `⚠️ Depletion validation: Invalid depletion ratio ${depletionRatio} for price ${level.price.toFixed(4)}`
            );
            return false;
        }
    }

    // Check volume data consistency
    // Note: hasBidVolume and hasAskVolume are not used but kept for potential future validation
    const hasOriginalBidVolume: boolean = Boolean(
        level.originalBidVolume && level.originalBidVolume > 0
    );
    const hasOriginalAskVolume: boolean = Boolean(
        level.originalAskVolume && level.originalAskVolume > 0
    );

    // If we have depletion data, we should have both current and original volumes
    if (
        depletionRatio !== undefined &&
        depletionRatio !== null &&
        depletionRatio > 0
    ) {
        if (!hasOriginalBidVolume && !hasOriginalAskVolume) {
            console.warn(
                `⚠️ Depletion validation: Missing original volume data for depleted level at ${level.price.toFixed(4)}`
            );
            return false;
        }
    }

    // Check for data freshness (if timestamp available)
    if (level.timestamp && currentTime - level.timestamp > 10 * 60 * 1000) {
        // 10 minutes
        console.warn(
            `⚠️ Depletion validation: Stale data for price ${level.price.toFixed(4)} (${Math.round((currentTime - level.timestamp) / 60000)} minutes old)`
        );
        return false;
    }

    return true;
}

export function updateOrderBookDisplay(data: OrderBookData): void {
    if (!orderBookChart) {
        return;
    }

    const labels: string[] = [];
    const askData: (number | null)[] = [];
    const bidData: (number | null)[] = [];

    // Backend sends data already configured with proper binSize (1-tick)
    // Just display it directly without any local processing
    const priceLevels: OrderBookLevel[] = data.priceLevels || [];
    const currentTime: number = Date.now();
    const midPrice: number = data.midPrice || 0;

    // Validate and filter depletion data
    const validLevels: OrderBookLevel[] = [];
    const invalidLevels: OrderBookLevel[] = [];

    priceLevels.forEach((level: OrderBookLevel) => {
        if (validateDepletionLevel(level, midPrice, currentTime)) {
            validLevels.push(level);
        } else {
            invalidLevels.push(level);
        }
    });

    // Log validation summary
    if (invalidLevels.length > 0) {
        console.log(
            `📊 Depletion validation: ${validLevels.length} valid, ${invalidLevels.length} invalid levels filtered`
        );
    }

    // Select levels symmetrically around mid price for balanced display
    const maxLevels: number = 50; // Show more levels since we have 1-tick precision

    // Sort levels by price
    const sortedLevels: OrderBookLevel[] = validLevels.sort(
        (a: OrderBookLevel, b: OrderBookLevel) => a.price - b.price
    );

    // Find the index closest to midPrice
    let midIndex: number = 0;
    let minDiff: number = Infinity;
    for (let i = 0; i < sortedLevels.length; i++) {
        const level = sortedLevels[i];
        if (!level) continue;
        const diff: number = Math.abs(level.price - midPrice);
        if (diff < minDiff) {
            minDiff = diff;
            midIndex = i;
        }
    }

    // Select levels around midpoint
    const halfLevels: number = Math.floor(maxLevels / 2);
    const startIndex: number = Math.max(0, midIndex - halfLevels);
    const endIndex: number = Math.min(
        sortedLevels.length,
        startIndex + maxLevels
    );
    const displayLevels: OrderBookLevel[] = sortedLevels.slice(
        startIndex,
        endIndex
    );

    // Get current theme for depletion colors
    const currentTheme: string = getCurrentTheme();
    const actualTheme: string =
        currentTheme === "system" ? getSystemTheme() : currentTheme;

    // Build chart data with depletion information
    const askColors: string[] = [];
    const bidColors: string[] = [];
    const depletionLabels: string[] = [];

    displayLevels.forEach((level: OrderBookLevel) => {
        const priceStr: string = level.price.toFixed(2);
        const depletionRatio: number = level.depletionRatio || 0;
        const depletionVelocity: number = level.depletionVelocity || 0;

        // Create depletion-aware colors for ask bars
        const askColor: string = getDepletionColor(
            level.ask || 0,
            depletionRatio,
            "ask",
            actualTheme
        );
        const bidColor: string = getDepletionColor(
            level.bid || 0,
            depletionRatio,
            "bid",
            actualTheme
        );

        // Add ask position
        labels.push(`${priceStr}_ask`);
        askData.push(level.ask || 0);
        bidData.push(null);
        askColors.push(askColor);
        bidColors.push("rgba(0, 0, 0, 0)"); // Transparent for ask position

        // Add depletion info to tooltip
        const depletionInfo: string =
            depletionRatio > 0
                ? ` (${(depletionRatio * 100).toFixed(1)}% depleted, ${depletionVelocity.toFixed(1)} LTC/sec)`
                : "";
        depletionLabels.push(`${priceStr}_ask${depletionInfo}`);

        // Add bid position
        labels.push(`${priceStr}_bid`);
        askData.push(null);
        bidData.push(level.bid || 0);
        askColors.push("rgba(0, 0, 0, 0)"); // Transparent for bid position
        bidColors.push(bidColor);

        // Add depletion info to tooltip
        depletionLabels.push(`${priceStr}_bid${depletionInfo}`);
    });

    if (orderBookChart?.data && orderBookChart.data.datasets.length >= 2) {
        const chart = orderBookChart;
        (chart.data as any).labels = depletionLabels; // Use labels with depletion info
        chart.data.datasets[0]!.data = askData as any;
        chart.data.datasets[1]!.data = bidData as any;

        // Apply depletion-aware colors
        chart.data.datasets[0]!.backgroundColor = askColors;
        chart.data.datasets[1]!.backgroundColor = bidColors;
    }

    // Update border colors for better visibility
    updateOrderBookBorderColors(actualTheme);

    scheduleOrderBookUpdate();
}

export function addAnomalyChartLabel(anomaly: Anomaly): void {
    if (!tradesChart) return;
    const now: number = anomaly.timestamp || anomaly.detectedAt || Date.now();
    (tradesChart.options.plugins as any).annotation.annotations =
        (tradesChart.options.plugins as any).annotation.annotations || {};
    (tradesChart.options.plugins as any).annotation.annotations[
        `anomaly.${now}`
    ] = {
        type: "label",
        xValue: anomaly.timestamp || anomaly.detectedAt,
        yValue: anomaly.price,
        content: `${getAnomalyIcon(anomaly.type)}`,
        backgroundColor:
            anomaly.severity === "critical"
                ? "rgba(229,57,53,0.8)"
                : anomaly.severity === "high"
                  ? "rgba(255,179,0,0.85)"
                  : anomaly.severity === "medium"
                    ? "rgba(255,241,118,0.5)"
                    : "rgba(33,150,243,0.5)",
        color: "#fff",
        font: { size: 18, weight: "bold" },
        padding: 6,
        borderRadius: 6,
        id: `anomaly.${now}`,
    };
    tradesChart.update("none");
}

/**
 * Handle incoming support/resistance level data
 */
export function handleSupportResistanceLevel(levelData: {
    data: SupportResistanceLevel;
}): void {
    if (!tradesChart || !levelData.data) return;

    const level: SupportResistanceLevel = levelData.data;

    // Add to levels array
    supportResistanceLevels.unshift(level);

    // Limit the number of levels to prevent chart clutter
    if (supportResistanceLevels.length > maxSupportResistanceLevels) {
        // Remove oldest level from chart
        const oldestLevel: SupportResistanceLevel =
            supportResistanceLevels.pop()!;
        removeSupportResistanceLevel(oldestLevel.id);
    }

    // Add level to chart
    addSupportResistanceToChart(level);

    console.log("Support/Resistance level added to chart:", {
        id: level.id,
        price: level.price,
        type: level.type,
        strength: level.strength,
        touchCount: level.touchCount,
    });
}

/**
 * Add support/resistance level as translucent bar on chart
 */
function addSupportResistanceToChart(level: SupportResistanceLevel): void {
    if (!tradesChart) return;

    const annotations: Record<string, ChartAnnotation> = (
        tradesChart.options.plugins as any
    ).annotation.annotations;
    const levelId: string = `sr_level_${level.id}`;

    // Determine color based on type and strength
    const isSupport: boolean = level.type === "support";
    const baseColor: string = isSupport ? "34, 197, 94" : "239, 68, 68"; // Green for support, red for resistance
    const alpha: number = Math.max(0.2, Math.min(0.5, level.strength)); // Opacity based on strength

    // Calculate time boundaries for the zone
    const now: number = Date.now();
    const startTime: number = level.firstDetected;
    // Zone is valid until crossed or for a maximum duration
    const maxValidDuration: number = 4 * 60 * 60 * 1000; // 4 hours maximum
    const endTime: number = Math.min(
        now + maxValidDuration,
        level.lastTouched + maxValidDuration
    );

    // Create price tolerance for zone height - make it proportional to strength and touch count
    const baseThickness: number = level.price * 0.0008; // 0.08% base thickness
    const strengthMultiplier: number = 1 + level.strength * 2; // 1x to 3x based on strength
    const touchMultiplier: number = 1 + Math.min(level.touchCount / 10, 1); // Additional thickness for more touches
    const zoneHeight: number =
        baseThickness * strengthMultiplier * touchMultiplier;

    // Add the time-bounded zone box
    const annotation: any = {
        type: "box",
        xMin: startTime,
        xMax: endTime,
        yMin: level.price - zoneHeight / 2,
        yMax: level.price + zoneHeight / 2,
        backgroundColor: `rgba(${baseColor}, ${alpha})`,
        borderColor: `rgba(${baseColor}, ${Math.min(alpha * 1.5, 0.8)})`,
        borderWidth: 1,
        drawTime: "beforeDatasetsDraw",
        z: 1,
        enter: (_context: any, _event: MouseEvent) => {
            // Handle mouse enter
        },
        leave: () => {
            // Handle mouse leave
        },
    };

    // Only add borderDash if it has a value
    if (level.roleReversals?.length) {
        annotation.borderDash = [5, 5];
    }

    annotations[levelId] = annotation;

    // Add a label for the level - positioned at the start of the zone
    const labelId: string = `sr_label_${level.id}`;
    annotations[labelId] = {
        type: "label",
        xValue: startTime,
        yValue: level.price,
        content: `${isSupport ? "SUPPORT" : "RESISTANCE"} ${level.price.toFixed(2)}`,
        backgroundColor: `rgba(${baseColor}, 0.9)`,
        color: "white",
        font: {
            size: 9,
            weight: "bold",
            family: "monospace",
        },
        padding: 3,
        borderRadius: 3,
        position: {
            x: "start",
            y: "center",
        },
        xAdjust: 5,
        drawTime: "afterDatasetsDraw",
        z: 5,
    };

    tradesChart.update("none");
}

/**
 * Remove support/resistance level from chart
 */
function removeSupportResistanceLevel(levelId: string): void {
    if (!tradesChart) return;

    const annotations: Record<string, ChartAnnotation> = (
        tradesChart.options.plugins as any
    ).annotation.annotations;
    const barId: string = `sr_level_${levelId}`;
    const labelId: string = `sr_label_${levelId}`;

    delete annotations[barId];
    delete annotations[labelId];

    tradesChart.update("none");
}

/**
 * Check if a trade price breaches any support/resistance zones and invalidate them
 */
export function checkSupportResistanceBreaches(
    tradePrice: number,
    _tradeTime: number
): void {
    if (!supportResistanceLevels.length) return;

    supportResistanceLevels = supportResistanceLevels.filter(
        (level: SupportResistanceLevel) => {
            // Calculate breach threshold - zone is breached if price moves significantly beyond it
            const zoneHeight: number =
                level.price *
                0.0008 *
                (1 + level.strength * 2) *
                (1 + Math.min(level.touchCount / 10, 1));
            const breachThreshold: number = zoneHeight * 2; // Breach if price moves 2x zone height beyond level

            let isBreached: boolean = false;

            if (level.type === "support") {
                // Support is breached if price falls significantly below it
                isBreached = tradePrice < level.price - breachThreshold;
            } else {
                // Resistance is breached if price rises significantly above it
                isBreached = tradePrice > level.price + breachThreshold;
            }

            if (isBreached) {
                console.log(`${level.type.toUpperCase()} level breached:`, {
                    levelPrice: level.price,
                    tradePrice: tradePrice,
                    threshold: breachThreshold,
                    levelId: level.id,
                });

                removeSupportResistanceLevel(level.id);
                return false; // Remove from array
            }

            return true; // Keep in array
        }
    );
}

/**
 * Clean up old support/resistance levels based on time
 */
export function cleanupOldSupportResistanceLevels(): void {
    const cutoffTime: number = Date.now() - 2 * 60 * 60 * 1000; // 2 hours

    supportResistanceLevels = supportResistanceLevels.filter(
        (level: SupportResistanceLevel) => {
            if (level.lastTouched < cutoffTime) {
                removeSupportResistanceLevel(level.id);
                return false;
            }
            return true;
        }
    );
}

/**
 * Zone Management Functions
 * Handle accumulation/distribution zones as visual boxes on the chart
 */

/**
 * Handle zone update messages from WebSocket
 */
export function handleZoneUpdate(updateData: {
    updateType: ZoneUpdateType;
    zone: ZoneData;
    significance: number;
}): void {
    const { updateType, zone } = updateData;

    switch (updateType) {
        case "zone_created":
            createZoneBox(zone);
            break;
        case "zone_updated":
        case "zone_strengthened":
        case "zone_weakened":
            updateZoneBox(zone);
            break;
        case "zone_completed":
            completeZoneBox(zone);
            break;
        case "zone_invalidated":
            removeZoneBox(zone.id);
            break;
    }
}

/**
 * Handle zone signal messages - add to signals list
 */
export function handleZoneSignal(signalData: {
    signalType: ZoneSignalType;
    zone: ZoneData;
    actionType: string;
    confidence: number;
    urgency: string;
    expectedDirection: "up" | "down";
    stopLossLevel?: number;
    takeProfitLevel?: number;
    positionSizing?: number;
}): void {
    const { zone, confidence, expectedDirection } = signalData;

    // Filter out accumulation and distribution zone signals from signals list
    // These zones are drawn via zoneUpdate messages, but signals shouldn't appear in the list
    if (zone.type === "accumulation" || zone.type === "distribution") {
        console.log(
            `${zone.type} zone signal filtered out - zones draw but signals don't show`,
            zone.id
        );
        return;
    }

    // Create a normalized signal for the signals list
    const normalizedSignal: Signal = {
        id: `zone_${zone.id}_${Date.now()}`,
        type: `${zone.type}_zone_${signalData.signalType}` as any,
        price:
            zone.priceRange.center ??
            (zone.priceRange.min + zone.priceRange.max) / 2,
        time: Date.now(),
        side:
            expectedDirection === "up"
                ? "buy"
                : expectedDirection === "down"
                  ? "sell"
                  : "buy",
        confidence: confidence,
        zone: zone,
    };

    // Add to signals list
    signalsList.unshift(normalizedSignal);
    if (signalsList.length > 50) {
        signalsList.splice(50);
    }
    renderSignalsList();
}

/**
 * Create a zone box on the chart
 */
function createZoneBox(zone: ZoneData): void {
    // Store zone data
    (activeZones as any).set(zone.id, zone);

    // Limit number of active zones
    if ((activeZones as any).size > maxActiveZones) {
        const oldestZoneId: string = (activeZones as any).keys().next().value;
        removeZoneBox(oldestZoneId);
    }

    // Add zone box to chart
    addZoneToChart(zone);
}

/**
 * Update an existing zone box
 */
function updateZoneBox(zone: ZoneData): void {
    (activeZones as any).set(zone.id, zone);

    // Update the chart annotation
    if (tradesChart?.options?.plugins?.annotation?.annotations) {
        const tradesChartOptions = tradesChart.options as ChartOptions;
        const annotation: ChartAnnotation = (
            tradesChartOptions.plugins?.annotation as any
        ).annotations[`zone_${zone.id}`];
        if (annotation) {
            // Update zone properties
            if (zone.type === "hidden_liquidity" || zone.type === "iceberg") {
                const price: number =
                    zone.priceRange.center ??
                    (zone.priceRange.min + zone.priceRange.max) / 2;
                annotation.yMin = price;
                annotation.yMax = price;
                annotation.borderColor = getZoneBorderColor(zone);
                // Update end time for iceberg orders if zone has ended
                if (zone.type === "iceberg" && zone.endTime) {
                    annotation.xMax = zone.endTime;
                }
            } else {
                annotation.yMin = zone.priceRange.min;
                annotation.yMax = zone.priceRange.max;
                annotation.backgroundColor = getZoneColor(zone);
                annotation.borderColor = getZoneBorderColor(zone);
            }
            annotation.label!.content = getZoneLabel(zone);

            tradesChart.update("none");
        } else {
            // Zone doesn't exist yet, create it
            addZoneToChart(zone);
        }
    }
}

/**
 * Mark zone as completed (change visual style)
 */
function completeZoneBox(zone: ZoneData): void {
    (activeZones as any).set(zone.id, zone);

    if (tradesChart?.options?.plugins?.annotation?.annotations) {
        const tradesChartOptions = tradesChart.options as ChartOptions;
        const annotation: ChartAnnotation = (
            tradesChartOptions.plugins?.annotation as any
        ).annotations[`zone_${zone.id}`];
        if (annotation) {
            // Change to completed zone style
            if (zone.type === "hidden_liquidity" || zone.type === "iceberg") {
                annotation.borderColor = getCompletedZoneBorderColor(zone);
                annotation.borderWidth = 2;
                annotation.borderDash =
                    zone.type === "iceberg" ? [3, 3] : [5, 5]; // Shorter dashes for iceberg
                // Set final end time for iceberg orders
                if (zone.type === "iceberg" && zone.endTime) {
                    annotation.xMax = zone.endTime;
                }
            } else {
                annotation.backgroundColor = getCompletedZoneColor(zone);
                annotation.borderColor = getCompletedZoneBorderColor(zone);
                annotation.borderWidth = 2;
                annotation.borderDash = [5, 5];
            }
            annotation.label!.content = getZoneLabel(zone) + " ✓";

            tradesChart.update("none");

            // Auto-remove completed zones after 30 minutes
            setTimeout(
                () => {
                    removeZoneBox(zone.id);
                },
                30 * 60 * 1000
            );
        }
    }
}

/**
 * Remove zone box from chart
 */
function removeZoneBox(zoneId: string): void {
    (activeZones as any).delete(zoneId);

    if (tradesChart?.options?.plugins?.annotation?.annotations) {
        const tradesChartOptions = tradesChart.options as ChartOptions;
        delete (tradesChartOptions.plugins?.annotation as any).annotations[
            `zone_${zoneId}`
        ];
        tradesChart.update("none");
    }
}

/**
 * Add zone as chart annotation
 */
function addZoneToChart(zone: ZoneData): void {
    if (!tradesChart?.options?.plugins?.annotation?.annotations) return;
    console.log("Adding zone to chart:", zone.type, zone.id, zone.priceRange);
    const tradesChartOptions = tradesChart.options as ChartOptions;
    let zoneAnnotation: ChartAnnotation;

    if (zone.type === "hidden_liquidity" || zone.type === "iceberg") {
        const price: number =
            zone.priceRange.center ??
            (zone.priceRange.min + zone.priceRange.max) / 2;

        // Calculate actual end time for iceberg orders based on zone duration
        const endTime: number = zone.endTime || Date.now() + 5 * 60 * 1000;

        const zoneAnnotationBase = {
            type: "line",
            xMin: zone.startTime ?? Date.now(),
            xMax: endTime,
            yMin: price,
            yMax: price,
            borderColor: getZoneBorderColor(zone),
            borderWidth: zone.type === "iceberg" ? 3 : 2, // Slightly thicker for iceberg
            label: {
                display: true,
                content: getZoneLabel(zone),
                position: "start",
                font: {
                    size: 10,
                    weight: "bold",
                },
                color: getZoneTextColor(zone),
                backgroundColor: "rgba(255, 255, 255, 0.8)",
                padding: 4,
                borderRadius: 3,
            },
            enter: (_ctx: any, event: MouseEvent) => {
                showZoneTooltip(zone, event);
            },
            leave: () => {
                hideZoneTooltip();
            },
        };

        // Add borderDash only if it's defined
        if (zone.type === "iceberg") {
            (zoneAnnotationBase as any).borderDash = [8, 4];
        }

        zoneAnnotation = zoneAnnotationBase;
    } else {
        zoneAnnotation = {
            type: "box",
            xMin: zone.startTime ?? Date.now(),
            xMax: Date.now() + 5 * 60 * 1000, // Extend 5 minutes into future
            yMin: zone.priceRange.min,
            yMax: zone.priceRange.max,
            backgroundColor: getZoneColor(zone),
            borderColor: getZoneBorderColor(zone),
            borderWidth: 1,
            label: {
                display: true,
                content: getZoneLabel(zone),
                position: "start",
                font: {
                    size: 10,
                    weight: "bold",
                },
                color: getZoneTextColor(zone),
                backgroundColor: "rgba(255, 255, 255, 0.8)",
                padding: 4,
                borderRadius: 3,
            },
            enter: (_ctx: any, event: MouseEvent) => {
                showZoneTooltip(zone, event);
            },
            leave: () => {
                hideZoneTooltip();
            },
        };
    }

    (tradesChartOptions.plugins?.annotation as any).annotations[
        `zone_${zone.id}`
    ] = zoneAnnotation;
    tradesChart.update("none");
}

/**
 * Get zone background color based on type and strength
 */
function getZoneColor(zone: ZoneData): string {
    const alpha: number = Math.max(0.15, zone.strength * 0.4); // Min 15%, max 40% opacity

    switch (zone.type) {
        case "accumulation":
            return `rgba(34, 197, 94, ${alpha})`; // Green
        case "distribution":
            return `rgba(239, 68, 68, ${alpha})`; // Red
        case "iceberg":
            return `rgba(59, 130, 246, ${alpha})`; // Blue
        case "spoofing":
            return `rgba(147, 51, 234, ${alpha})`; // Purple
        case "hidden_liquidity":
            return `rgba(245, 158, 11, ${alpha})`; // Amber
        default:
            return `rgba(107, 114, 128, ${alpha})`; // Gray
    }
}

/**
 * Get zone border color
 */
function getZoneBorderColor(zone: ZoneData): string {
    switch (zone.type) {
        case "accumulation":
            return "rgba(34, 197, 94, 0.8)"; // Green
        case "distribution":
            return "rgba(239, 68, 68, 0.8)"; // Red
        case "iceberg":
            return "rgba(59, 130, 246, 0.8)"; // Blue
        case "spoofing":
            return "rgba(147, 51, 234, 0.8)"; // Purple
        case "hidden_liquidity":
            return "rgba(245, 158, 11, 0.8)"; // Amber
        default:
            return "rgba(107, 114, 128, 0.8)"; // Gray
    }
}

/**
 * Get completed zone colors (more muted)
 */
function getCompletedZoneColor(zone: ZoneData): string {
    switch (zone.type) {
        case "accumulation":
            return "rgba(34, 197, 94, 0.2)"; // Lighter green
        case "distribution":
            return "rgba(239, 68, 68, 0.2)"; // Lighter red
        case "iceberg":
            return "rgba(59, 130, 246, 0.2)"; // Lighter blue
        case "spoofing":
            return "rgba(147, 51, 234, 0.2)"; // Lighter purple
        case "hidden_liquidity":
            return "rgba(245, 158, 11, 0.2)"; // Lighter amber
        default:
            return "rgba(107, 114, 128, 0.2)"; // Lighter gray
    }
}

function getCompletedZoneBorderColor(zone: ZoneData): string {
    switch (zone.type) {
        case "accumulation":
            return "rgba(34, 197, 94, 0.5)"; // Muted green
        case "distribution":
            return "rgba(239, 68, 68, 0.5)"; // Muted red
        case "iceberg":
            return "rgba(59, 130, 246, 0.5)"; // Muted blue
        case "spoofing":
            return "rgba(147, 51, 234, 0.5)"; // Muted purple
        case "hidden_liquidity":
            return "rgba(245, 158, 11, 0.5)"; // Muted amber
        default:
            return "rgba(107, 114, 128, 0.5)"; // Muted gray
    }
}

/**
 * Get zone text color
 */
function getZoneTextColor(zone: ZoneData): string {
    if (zone.type === "accumulation") {
        return "rgba(21, 128, 61, 1)"; // Dark green
    } else {
        return "rgba(153, 27, 27, 1)"; // Dark red
    }
}

/**
 * Generate zone label text
 */
function getZoneLabel(zone: ZoneData): string {
    const strengthPercent: number = Math.round(zone.strength * 100);
    const completionPercent: number = Math.round((zone.completion ?? 0) * 100);

    let typeLabel: string;
    switch (zone.type) {
        case "accumulation":
            typeLabel = "ACC";
            break;
        case "distribution":
            typeLabel = "DIST";
            break;
        case "iceberg":
            typeLabel = "🧊 ICE";
            break;
        case "spoofing":
            typeLabel = "👻 SPOOF";
            break;
        case "hidden_liquidity":
            typeLabel = "🔍 HIDDEN";
            break;
        default:
            typeLabel = (zone.type as string).toUpperCase();
    }

    return `${typeLabel} ${strengthPercent}% (${completionPercent}%)`;
}

/**
 * Show zone tooltip on hover
 */
function showZoneTooltip(zone: ZoneData, event: MouseEvent): void {
    const tooltip: HTMLDivElement = document.createElement("div");
    tooltip.id = "zoneTooltip";
    tooltip.style.cssText = "position: fixed;";
    ("background: rgba(0, 0, 0, 0.9);");
    ("color: white;");
    ("padding: 12px;");
    ("border-radius: 6px;");
    ("font-size: 12px;");
    ("font-family: monospace;");
    ("pointer-events: none;");
    ("z-index: 10000;");
    ("max-width: 300px;");
    ("line-height: 1.4;");
    ("box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3)");

    const duration: number = Math.round(
        (Date.now() - (zone.startTime ?? Date.now())) / 60000
    );
    const volumeFormatted: string = zone.totalVolume?.toLocaleString() || "N/A";

    // Get zone type color
    let zoneColor: string;
    switch (zone.type) {
        case "accumulation":
            zoneColor = "#22c55e";
            break;
        case "distribution":
            zoneColor = "#ef4444";
            break;
        case "iceberg":
            zoneColor = "#3b82f6";
            break;
        case "spoofing":
            zoneColor = "#9333ea";
            break;
        case "hidden_liquidity":
            zoneColor = "#f59e0b";
            break;
        default:
            zoneColor = "#6b7280";
    }

    let tooltipContent: string = `<div style=\"font-weight: bold; margin-bottom: 6px; color: ${zoneColor}">\n            ${getZoneLabel(zone)} ZONE
        </div>
        <div>Price Range: ${zone.priceRange.min.toFixed(4)} - ${zone.priceRange.max.toFixed(4)}</div>`;

    // Add center for accumulation/distribution zones
    if (zone.priceRange.center) {
        tooltipContent += `<div>Center: ${zone.priceRange.center.toFixed(4)}</div>`;
    }

    tooltipContent += `
        <div>Strength: ${(zone.strength * 100).toFixed(1)}%</div>
        <div>Completion: ${((zone.completion ?? 0) * 100).toFixed(1)}%</div>`;

    // Add confidence if available
    if (zone.confidence !== undefined) {
        tooltipContent += `<div>Confidence: ${(zone.confidence * 100).toFixed(1)}%</div>`;
    }

    tooltipContent += `<div>Duration: ${duration}m</div>`;

    // Add type-specific details
    if (zone.type === "iceberg") {
        tooltipContent += `
            <div style=\"margin-top: 6px; border-top: 1px solid #333; padding-top: 6px;\">
                <div>Refills: ${(zone as any).refillCount || "N/A"}</div>
                <div>Volume: ${volumeFormatted}</div>
                <div>Avg Size: ${(zone as any).averagePieceSize?.toFixed(2) || "N/A"}</div>
                <div>Side: ${(zone as any).side?.toUpperCase() || "N/A"}</div>
            </div>`;
    } else if (zone.type === "spoofing") {
        tooltipContent += `
            <div style=\"margin-top: 6px; border-top: 1px solid #333; padding-top: 6px;\">
                <div>Type: ${(zone as any).spoofType || "N/A"}</div>
                <div>Wall Size: ${(zone as any).wallSize?.toFixed(2) || "N/A"}</div>
                <div>Canceled: ${(zone as any).canceled?.toFixed(2) || "N/A"}</div>
                <div>Executed: ${(zone as any).executed?.toFixed(2) || "N/A"}</div>
                <div>Side: ${(zone as any).side?.toUpperCase() || "N/A"}</div>
            </div>`;
    } else if (zone.type === "hidden_liquidity") {
        tooltipContent += `
            <div style=\"margin-top: 6px; border-top: 1px solid #333; padding-top: 6px;\">
                <div>Stealth Type: ${(zone as any).stealthType || "N/A"}</div>
                <div>Stealth Score: ${(((zone as any).stealthScore ?? 0) * 100).toFixed(1) + "%"}</div>
                <div>Trades: ${(zone as any).tradeCount || "N/A"}</div>
                <div>Volume: ${volumeFormatted}</div>
                <div>Side: ${(zone as any).side?.toUpperCase() || "N/A"}</div>
            </div>`;
    } else if (zone.totalVolume) {
        // Default volume display for accumulation/distribution
        tooltipContent += `<div>Volume: ${volumeFormatted}</div>`;
    }

    tooltip.innerHTML = tooltipContent;

    tooltip.style.left = `${event.clientX + 10}px`;
    tooltip.style.top = `${event.clientY - 10}px`;

    document.body.appendChild(tooltip);
}

/**
 * Hide zone tooltip
 */
function hideZoneTooltip(): void {
    const tooltip: HTMLElement | null = document.getElementById("zoneTooltip");
    if (tooltip) {
        tooltip.remove();
    }
}

/**
 * Cleanup old completed zones
 */
export function cleanupOldZones(): void {
    const cutoffTime: number = Date.now() - 60 * 60 * 1000; // 1 hour

    for (const [zoneId, zone] of activeZones as any) {
        if (!zone.isActive && zone.endTime && zone.endTime < cutoffTime) {
            removeZoneBox(zoneId);
        }
    }
}

/**
 * Get anomaly icon based on type
 */
function getAnomalyIcon(type?: string): string {
    switch (type) {
        case "flash_crash":
            return "⚡";
        case "api_gap":
            return "🔌";
        case "liquidity_void":
            return "💧";
        case "extreme_volatility":
            return "🌊";
        case "spoofing":
            return "👻";
        case "layering":
            return "📚";
        case "ghost_liquidity":
            return "👤";
        case "orderbook_imbalance":
            return "⚖️";
        case "whale_activity":
            return "🐋";
        case "coordinated_activity":
            return "🤝";
        case "algorithmic_activity":
            return "🤖";
        case "toxic_flow":
            return "☠️";
        default:
            return "⚠️";
    }
}
