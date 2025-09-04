import {
    tradesChart,
    orderBookChart,
    rsiChart,
    activeRange,
    PADDING_TIME,
    FIFTEEN_MINUTES,
    orderBookData,
    maxSupportResistanceLevels,
    activeZones,
    maxActiveZones,
    signalsList,
    //setTradesChart,
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
    ChartInstance,
    Anomaly,
    Trade,
    OrderBookLevel,
    OrderBookData,
    Signal,
    SupportResistanceLevel,
    ZoneData,
    RSIDataPoint,
    ChartDataset,
} from "../frontend-types.js";

import {
    Chart,
    ChartEvent,
    registerables,
    ScriptableContext,
    TooltipItem,
    ChartOptions,
} from "chart.js";
import annotationPlugin, {
    //    EventContext,
    //PartialEventContext,
} from "chartjs-plugin-annotation";

import zoomPlugin from "chartjs-plugin-zoom";
import "chartjs-adapter-date-fns";

Chart.register(...registerables, zoomPlugin, annotationPlugin);

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
const MAX_LABEL_LENGTH = 250;
const TRUNCATED_LABEL_LENGTH = 245;
const PRICE_DEVIATION_THRESHOLD = 0.02;

// RSI threshold constants
const RSI_OVERBOUGHT = 70;
const RSI_OVERSOLD = 30;

// Color alpha constants
const COLOR_ALPHA_FULL = 1;
const COLOR_ALPHA_MEDIUM = 0.5;
const COLOR_ALPHA_STRONG = 0.8;
const COLOR_ALPHA_MAX = 0.9;

// Volume calculation constants
const VOLUME_NORMALIZER_DARK = 1500;
const VOLUME_NORMALIZER_LIGHT = 2000;
const VOLUME_OPACITY_MIN = 0.3;
const VOLUME_OPACITY_LOW = 0.4;
const VOLUME_OPACITY_MEDIUM = 0.6;
const VOLUME_OPACITY_HIGH = 0.8;
const VOLUME_OPACITY_MAX = 0.9;

// Depletion ratio thresholds
const DEPLETION_RATIO_LOW = 0.3;
const DEPLETION_RATIO_MEDIUM = 0.7;

// Zone calculation constants
//const ZONE_ALPHA_MIN = 0.2;
//const ZONE_ALPHA_MAX = 0.5;
//const ZONE_DURATION_MAX_HOURS = 4;
//const ZONE_DURATION_MAX_MS = ZONE_DURATION_MAX_HOURS * 60 * 60 * 1000;
const ZONE_BASE_THICKNESS_PERCENT = 0.0008; // 0.08%
const ZONE_STRENGTH_MULTIPLIER_BASE = 1;
const ZONE_TOUCH_MULTIPLIER_MAX = 1;
const ZONE_TOUCH_COUNT_NORMALIZER = 10;
//const ZONE_ALPHA_MULTIPLIER = 1.5;
//const ZONE_ALPHA_MULTIPLIER_MAX = 0.8;

// Breach threshold constants
const BREACH_THRESHOLD_MULTIPLIER = 2;

// Cleanup time constants
const CLEANUP_TIME_HOURS = 2;
const CLEANUP_TIME_MS = CLEANUP_TIME_HOURS * 60 * 60 * 1000;

// Zone color constants
const ZONE_ALPHA_MIN_PERCENT = 0.15;
const ZONE_ALPHA_MAX_PERCENT = 0.4;

// RGB color constants
const COLOR_RED_FULL = 255;
const COLOR_RED_MEDIUM = 80;
const COLOR_RED_LOW = 0;
const COLOR_GREEN_FULL = 255;
const COLOR_GREEN_MEDIUM = 128;

// Order book volume normalizers
const ORDER_BOOK_VOLUME_NORMALIZER_DARK = 1500;
const ORDER_BOOK_VOLUME_NORMALIZER_LIGHT = 2000;

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
 * Updates 15-minute time annotations for RSI chart
 */
export function updateRSITimeAnnotations(
    latestTime: number,
    activeRange: number
): void {
    if (!rsiChart) return;
    const rsiChartOptions = rsiChart.options as ChartOptions;
    const annotations = rsiChartOptions.plugins?.annotation?.annotations;
    if (!annotations) return;

    // Create a completely new annotations object to avoid circular references
    const newAnnotations: any = {};

    // Preserve existing overbought/oversold lines with deep copies
    /*
    if (annotations["overboughtLine"]) {
        newAnnotations["overboughtLine"] = {
            ...annotations["overboughtLine"],
        } as AnnotationOptions<"line">;
    }

    if (annotations["oversoldLine"]) {
        newAnnotations["oversoldLine"] = {
            ...annotations["oversoldLine"],
        } as AnnotationOptions<"line">;
    }
*/
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
    //if (rsiChart.options.plugins?.annotation) {
    //    rsiChart.options.plugins.annotation.annotations = newAnnotations as any;
    //}
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
 * Initializes the RSI chart.
 */
export function initializeRSIChart(
    ctx: CanvasRenderingContext2D,
    initialMin: number,
    initialMax: number,
    now: number
): Chart<"line"> | null {
    if (rsiChart) return rsiChart;

    try {
        const chart: Chart<"line"> = new Chart(ctx, {
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
                    },
                    y: {
                        type: "linear",
                        title: { display: true, text: "RSI" },
                        min: 0,
                        max: 100,
                        ticks: { stepSize: 5 },
                        position: "right",
                        grace: 0,
                        offset: true,
                    },
                },
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            label: (context: TooltipItem<"line">) => {
                                const data = context.raw as RSIDataPoint;
                                return data
                                    ? `RSI: ${data.rsi.toFixed(1)}`
                                    : "";
                            },
                        },
                    },

                    zoom: {
                        pan: {
                            enabled: true,
                            mode: "x",
                            onPanComplete: ({ chart }: { chart: Chart }) => {
                                if (isSyncing) return;
                                isSyncing = true;

                                if (
                                    tradesChart &&
                                    tradesChart.options &&
                                    tradesChart.options.scales &&
                                    tradesChart.options.scales["x"] &&
                                    chart.options &&
                                    chart.options.scales &&
                                    chart.options.scales["x"]
                                ) {
                                    if (
                                        chart.options.scales["x"].min &&
                                        chart.options.scales["x"].max
                                    ) {
                                        tradesChart.options.scales["x"].min =
                                            chart.options.scales["x"].min;

                                        tradesChart.options.scales["x"].max =
                                            chart.options.scales["x"].max;

                                        tradesChart.update("none");
                                    }
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
                            onZoomComplete: ({ chart }: { chart: Chart }) => {
                                if (isSyncing) return;
                                isSyncing = true;

                                if (
                                    tradesChart &&
                                    tradesChart.options &&
                                    tradesChart.options.scales &&
                                    chart.options &&
                                    chart.options.scales
                                ) {
                                    if (
                                        tradesChart.options.scales["x"] &&
                                        chart.options.scales["x"]
                                    ) {
                                        tradesChart.options.scales["x"]!.min =
                                            chart.options.scales["x"]!.min ??
                                            Date.now() - 90 * 60000;

                                        tradesChart.options.scales["x"]!.max =
                                            chart.options.scales["x"]!.max ??
                                            Date.now() + PADDING_TIME;

                                        tradesChart.update("none");
                                    }
                                }

                                isSyncing = false;
                            },
                        },
                    },
                },
            },
        });

        /*
        const overboughtLine: AnnotationOptions<"line"> = {
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
        };

        const oversoldLine: AnnotationOptions<"line"> = {
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
        };

        (
            chart.options.plugins!.annotation!.annotations as Record<
                string,
                AnnotationOptions<"line">
            >
        )["overboughtLine"] = overboughtLine;
        (
            chart.options.plugins!.annotation!.annotations as Record<
                string,
                AnnotationOptions<"line">
            >
        )["oversoldLine"] = oversoldLine;
*/
        setRsiChart(chart as Chart<"line">);

        // Initialize time annotations
        if (activeRange !== null) {
            updateRSITimeAnnotations(now, activeRange);
        }

        console.log("RSI Chart initialized succesfully!");
        return chart;
    } catch (error) {
        console.error("Failed to create RSI chart:", error);
        return null;
    }
}

/**
 * Safely updates RSI chart with error recovery
 *v/
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
        rsiChart.data.datasets[0].data = rsiData as unknown as ChartDataPoint[];

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
function getRSIColor(context: ScriptableContext<"line">): string {
    const data = context.raw as RSIDataPoint;
    if (!data || typeof data.rsi !== "number") return "rgba(102, 102, 102, 1)";

    const rsi: number = data.rsi;
    if (rsi >= RSI_OVERBOUGHT) return "rgba(255, 0, 0, 1)"; // Red for overbought
    if (rsi <= RSI_OVERSOLD) return "rgba(0, 255, 0, 1)"; // Green for oversold
    return "rgba(102, 102, 102, 1)"; // Gray for neutral
}

/**
 * Gets the background color for RSI chart area
 */
function getRSIBackgroundColor(context: ScriptableContext<"line">): string {
    const data = context.raw as RSIDataPoint;
    if (!data || typeof data.rsi !== "number")
        return "rgba(102, 102, 102, 0.1)";

    const rsi: number = data.rsi;
    if (rsi >= RSI_OVERBOUGHT) return "rgba(255, 0, 0, 0.1)"; // Light red for overbought
    if (rsi <= RSI_OVERSOLD) return "rgba(0, 255, 0, 0.1)"; // Light green for oversold
    return "rgba(102, 102, 102, 0.1)"; // Light gray for neutral
}

/**
 * Initializes the order book bar chart.
 */
export function initializeOrderBookChart(
    ctx: CanvasRenderingContext2D
): ChartInstance | null {
    if (orderBookChart) return orderBookChart;
    if (typeof Chart === "undefined") {
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

    const chart: ChartInstance = new Chart(ctx, {
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
                        label: function (context: TooltipItem<"bar">) {
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
                                } else if (
                                    level.depletionRatio >= DEPLETION_RATIO_LOW
                                ) {
                                    tooltipText += " ⚠️ MEDIUM";
                                }
                            }

                            return tooltipText;
                        },
                        title: function (context: TooltipItem<"bar">[]) {
                            const label: string = context[0]?.label || "";
                            const priceStr: string = label.split("_")[0] ?? "";
                            return `Price: ${priceStr}`;
                        },
                    },
                },
            },
        },
    });
    setOrderBookChart(chart as any as ChartInstance);
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
        ask:
            theme === "dark"
                ? [COLOR_RED_FULL, COLOR_RED_MEDIUM, COLOR_RED_MEDIUM]
                : [COLOR_RED_FULL, COLOR_RED_LOW, COLOR_RED_LOW], // Red
        bid:
            theme === "dark"
                ? [COLOR_RED_MEDIUM, COLOR_GREEN_FULL, COLOR_RED_MEDIUM]
                : [COLOR_RED_LOW, COLOR_GREEN_MEDIUM, COLOR_RED_LOW], // Green
    };

    const [r, g, b]: [number, number, number] = baseColors[side] || [0, 0, 0];

    // Calculate opacity based on volume
    let baseOpacity: number =
        theme === "dark"
            ? Math.min(volume / VOLUME_NORMALIZER_DARK, VOLUME_OPACITY_MAX)
            : Math.min(volume / VOLUME_NORMALIZER_LIGHT, COLOR_ALPHA_FULL);

    // Apply depletion effect only if visualization is enabled
    if (depletionEnabled && depletionRatio > 0) {
        if (depletionRatio < DEPLETION_RATIO_LOW) {
            // Low depletion - slight color shift
            baseOpacity = Math.max(baseOpacity, VOLUME_OPACITY_LOW);
        } else if (depletionRatio < DEPLETION_RATIO_MEDIUM) {
            // Medium depletion - moderate intensification
            baseOpacity = Math.max(baseOpacity, VOLUME_OPACITY_MEDIUM);
        } else {
            // High depletion - strong intensification
            baseOpacity = Math.max(baseOpacity, VOLUME_OPACITY_HIGH);
        }
    }

    return `rgba(${r}, ${g}, ${b}, ${Math.max(baseOpacity, VOLUME_OPACITY_MIN)})`;
}

/**
 * Update orderbook border colors for better visibility
 */
function updateOrderBookBorderColors(theme: string): void {
    if (!orderBookChart) return;

    const datasets = orderBookChart.data.datasets as ChartDataset[];
    if (!datasets || datasets.length < 2) return;

    const borderOpacity: number =
        theme === "dark" ? COLOR_ALPHA_STRONG : COLOR_ALPHA_MEDIUM;

    // Enhanced border colors for depletion visualization
    if (datasets[0]) {
        datasets[0].borderColor =
            theme === "dark"
                ? `rgba(255, 120, 120, ${borderOpacity})`
                : `rgba(255, 0, 0, ${borderOpacity})`;
    }
    if (datasets[1]) {
        datasets[1].borderColor =
            theme === "dark"
                ? `rgba(120, 255, 120, ${borderOpacity})`
                : `rgba(0, 128, 0, ${borderOpacity})`;
    }
}

export function updateOrderBookBarColors(theme: string): void {
    if (!orderBookChart || !orderBookData) return;

    const datasets = orderBookChart.data.datasets as ChartDataset[];
    if (!datasets || datasets.length < 2) return;

    // Enhanced colors for better visibility in dark mode
    const askColors: string[] = [];
    const bidColors: string[] = [];

    orderBookData.priceLevels.forEach((level: OrderBookLevel) => {
        // Ask colors (red) - enhanced opacity for dark mode
        const askOpacity: number =
            theme === "dark"
                ? Math.min(
                      (level.ask ?? 0) / ORDER_BOOK_VOLUME_NORMALIZER_DARK,
                      COLOR_ALPHA_MAX
                  ) // Higher max opacity in dark mode
                : Math.min(
                      (level.ask ?? 0) / ORDER_BOOK_VOLUME_NORMALIZER_LIGHT,
                      COLOR_ALPHA_FULL
                  );

        const askColor: string = level.ask
            ? theme === "dark"
                ? `rgba(${COLOR_RED_FULL}, ${COLOR_RED_MEDIUM}, ${COLOR_RED_MEDIUM}, ${Math.max(askOpacity, VOLUME_OPACITY_MIN)})` // Brighter red with min opacity
                : `rgba(${COLOR_RED_FULL}, ${COLOR_RED_LOW}, ${COLOR_RED_LOW}, ${askOpacity})`
            : "rgba(0, 0, 0, 0)";

        // Bid colors (green) - enhanced opacity for dark mode
        const bidOpacity: number =
            theme === "dark"
                ? Math.min(
                      (level.bid ?? 0) / ORDER_BOOK_VOLUME_NORMALIZER_DARK,
                      COLOR_ALPHA_MAX
                  ) // Higher max opacity in dark mode
                : Math.min(
                      (level.bid ?? 0) / ORDER_BOOK_VOLUME_NORMALIZER_LIGHT,
                      COLOR_ALPHA_FULL
                  );

        const bidColor: string = level.bid
            ? theme === "dark"
                ? `rgba(${COLOR_RED_MEDIUM}, ${COLOR_GREEN_FULL}, ${COLOR_RED_MEDIUM}, ${Math.max(bidOpacity, VOLUME_OPACITY_MIN)})` // Brighter green with min opacity
                : `rgba(${COLOR_RED_LOW}, ${COLOR_GREEN_MEDIUM}, ${COLOR_RED_LOW}, ${bidOpacity})`
            : "rgba(0, 0, 0, 0)";

        // Add ask position
        askColors.push(askColor);
        bidColors.push("rgba(0, 0, 0, 0)");

        // Add bid position
        askColors.push("rgba(0, 0, 0, 0)");
        bidColors.push(bidColor);
    });

    // Update the chart datasets
    if (datasets[0]) {
        datasets[0].backgroundColor = askColors; // Asks
    }
    if (datasets[1]) {
        datasets[1].backgroundColor = bidColors; // Bids
    }

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
        (chart.data as unknown as { labels: string[] }).labels =
            depletionLabels; // Use labels with depletion info
        (chart.data.datasets[0] as ChartDataset).data = askData;
        (chart.data.datasets[1] as ChartDataset).data = bidData;

        // Apply depletion-aware colors
        (chart.data.datasets[0] as ChartDataset).backgroundColor = askColors;
        (chart.data.datasets[1] as ChartDataset).backgroundColor = bidColors;
    }

    // Update border colors for better visibility
    updateOrderBookBorderColors(actualTheme);

    scheduleOrderBookUpdate();
}

export function addAnomalyChartLabel(anomaly: Anomaly): void {
    if (!tradesChart) return;
    void anomaly;
    //const now: number = anomaly.timestamp || anomaly.detectedAt || Date.now();
    if (!tradesChart.options.plugins) tradesChart.options.plugins = {};
    //if (!tradesChart.options.plugins.annotation) {
    //    tradesChart.options.plugins.annotation = { annotations: {} };
    //}
    //const annotations = tradesChart.options.plugins.annotation.annotations;
    //if (annotations === undefined) {
    //    throw new Error("annotations is undefined.");
    //}

    /*
    (annotations as any)[`anomaly.${now}`] = {
        type: "label",
        xValue: anomaly.timestamp ?? anomaly.detectedAt ?? now,
        yValue: anomaly.price ?? 0,
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
    };
    */
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
    //addSupportResistanceToChart(level);

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
 * /
function addSupportResistanceToChart(level: SupportResistanceLevel): void {
    if (!tradesChart) return;

    if (!tradesChart.options.plugins) tradesChart.options.plugins = {};
    if (!tradesChart.options.plugins.annotation) {
        tradesChart.options.plugins.annotation = { annotations: {} };
    }
    const annotations = tradesChart.options.plugins.annotation.annotations;
    if (annotations === undefined) {
        throw new Error("annotations is undefined.");
    }
    //const levelId: string = `sr_level_${level.id}`;

    // Determine color based on type and strength
    //const isSupport: boolean = level.type === "support";
    //const baseColor: string = isSupport ? "34, 197, 94" : "239, 68, 68"; // Green for support, red for resistance
    /*
    const alpha: number = Math.max(
        ZONE_ALPHA_MIN,
        Math.min(ZONE_ALPHA_MAX, level.strength)
    ); // Opacity based on strength

    // Calculate time boundaries for the zone
    //const now: number = Date.now();
    const startTime: number = level.firstDetected;
    // Zone is valid until crossed or for a maximum duration
    //const maxValidDuration: number = ZONE_DURATION_MAX_MS; // 4 hours maximum

    /*
    const endTime: number = Math.min(
        now + maxValidDuration,
        level.lastTouched + maxValidDuration
    );

    // Create price tolerance for zone height - make it proportional to strength and touch count
    /*
    const baseThickness: number = level.price * ZONE_BASE_THICKNESS_PERCENT; // 0.08% base thickness
    const strengthMultiplier: number =
        ZONE_STRENGTH_MULTIPLIER_BASE + level.strength * 2; // 1x to 3x based on strength
    const touchMultiplier: number =
        ZONE_STRENGTH_MULTIPLIER_BASE +
        Math.min(
            level.touchCount / ZONE_TOUCH_COUNT_NORMALIZER,
            ZONE_TOUCH_MULTIPLIER_MAX
        ); // Additional thickness for more touches
    //const zoneHeight: number =
    //    baseThickness * strengthMultiplier * touchMultiplier;

    // Add the time-bounded zone box
    /* 
    const annotation: AnnotationOptions<"box"> = {
        type: "box",
        xMin: startTime,
        xMax: endTime,
        yMin: level.price - zoneHeight / 2,
        yMax: level.price + zoneHeight / 2,
        backgroundColor: `rgba(${baseColor}, ${alpha})`,
        borderColor: `rgba(${baseColor}, ${Math.min(alpha * ZONE_ALPHA_MULTIPLIER, ZONE_ALPHA_MULTIPLIER_MAX)})`,
        borderWidth: 1,
        drawTime: "beforeDatasetsDraw",
        z: 1,
    };

    // Only add borderDash if it has a value
    if (level.roleReversals?.length) {
        annotation.borderDash = [5, 5];
    }

    (annotations as any)[levelId] = annotation as any;
    * /

    // Add a label for the level - positioned at the start of the zone
    const labelId: string = `sr_label_${level.id}`;
    (annotations as any)[labelId] = {
        type: "label",
        xValue: startTime,
        yValue: level.price,
        content: `${isSupport ? "SUPPORT" : "RESISTANCE"} ${level.price.toFixed(2)}`,
        backgroundColor: `rgba(${baseColor}, ${COLOR_ALPHA_MAX})`,
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

    void levelId;
    //const annotations = tradesChart.options.plugins?.annotation?.annotations;
    //if (!annotations) return;

    //const barId: string = `sr_level_${levelId}`;
    //const labelId: string = `sr_label_${levelId}`;

    //delete (annotations as any)[barId];
    //delete (annotations as any)[labelId];

    tradesChart.update("none");
}

/**
 * Check if a trade price breaches any support/resistance zones and invalidate them
 */
export function checkSupportResistanceBreaches(tradePrice: number): void {
    if (!supportResistanceLevels.length) return;

    supportResistanceLevels = supportResistanceLevels.filter(
        (level: SupportResistanceLevel) => {
            // Calculate breach threshold - zone is breached if price moves significantly beyond it
            const zoneHeight: number =
                level.price *
                ZONE_BASE_THICKNESS_PERCENT *
                (ZONE_STRENGTH_MULTIPLIER_BASE + level.strength * 2) *
                (ZONE_STRENGTH_MULTIPLIER_BASE +
                    Math.min(
                        level.touchCount / ZONE_TOUCH_COUNT_NORMALIZER,
                        ZONE_TOUCH_MULTIPLIER_MAX
                    ));
            const breachThreshold: number =
                zoneHeight * BREACH_THRESHOLD_MULTIPLIER; // Breach if price moves 2x zone height beyond level

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
    const cutoffTime: number = Date.now() - CLEANUP_TIME_MS; // 2 hours

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
        type: `${zone.type}_zone_${signalData.signalType}`,
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
    (activeZones as Map<string, ZoneData>).set(zone.id, zone);

    // Limit number of active zones
    if ((activeZones as Map<string, ZoneData>).size > maxActiveZones) {
        const oldestZoneId: string =
            (activeZones as Map<string, ZoneData>).keys().next().value ?? "";
        removeZoneBox(oldestZoneId);
    }

    // Add zone box to chart
    //addZoneToChart(zone);
}

/**
 * Update an existing zone box
 */
function updateZoneBox(zone: ZoneData): void {
    (activeZones as Map<string, ZoneData>).set(zone.id, zone);

    /*
    // Update the chart annotation
    if (
        tradesChart &&
        tradesChart.options &&
        tradesChart.options.plugins &&
        tradesChart.options.plugins.annotation &&
        tradesChart.options.plugins.annotation.annotations
    ) {
        const annotation = tradesChart.options.plugins.annotation
            .annotations as Record<string, AnnotationOptions<"box">>;

        if (annotation && annotation[`zone_${zone.id}`]) {
            const annotations = annotation[
                `zone_${zone.id}`
            ] as AnnotationOptions<"box">;
            // Update zone properties
            if (zone.type === "hidden_liquidity" || zone.type === "iceberg") {
                const price: number =
                    zone.priceRange.center ??
                    (zone.priceRange.min + zone.priceRange.max) / 2;
                annotations.yMin = price;
                annotations.yMax = price;
                annotations.borderColor = getZoneBorderColor(zone);
                // Update end time for iceberg orders if zone has ended
                if (zone.type === "iceberg" && zone.endTime) {
                    annotations.xMax = zone.endTime;
                }
            } else {
                annotations.yMin = zone.priceRange.min;
                annotations.yMax = zone.priceRange.max;
                annotations.backgroundColor = getZoneColor(zone);
                annotations.borderColor = getZoneBorderColor(zone);
            }
            if (annotations.label) {
                annotations.label.content = getZoneLabel(zone);
            }

            tradesChart.update("none");
        } else {
            // Zone doesn't exist yet, create it
            addZoneToChart(zone);
        }
    }
        */
}

/**
 * Mark zone as completed (change visual style)
 */
function completeZoneBox(zone: ZoneData): void {
    (activeZones as Map<string, ZoneData>).set(zone.id, zone);

    /*
    if (
        tradesChart &&
        tradesChart.options &&
        tradesChart.options.plugins &&
        tradesChart.options.plugins.annotation &&
        tradesChart.options.plugins.annotation.annotations
    ) {
        const annotation = tradesChart.options.plugins.annotation
            .annotations as Record<string, AnnotationOptions<"box">>;
        if (annotation && annotation[`zone_${zone.id}`]) {
            const annotations: AnnotationOptions<"box"> = annotation[
                `zone_${zone.id}`
            ] as AnnotationOptions<"box">;
            // Change to completed zone style
            if (zone.type === "hidden_liquidity" || zone.type === "iceberg") {
                annotations.borderColor = getCompletedZoneBorderColor(zone);
                annotations.borderWidth = 2;
                annotations.borderDash =
                    zone.type === "iceberg" ? [3, 3] : [5, 5]; // Shorter dashes for iceberg
                // Set final end time for iceberg orders
                if (zone.type === "iceberg" && zone.endTime) {
                    annotations.xMax = zone.endTime;
                }
            } else {
                annotations.backgroundColor = getCompletedZoneColor(zone);
                annotations.borderColor = getCompletedZoneBorderColor(zone);
                annotations.borderWidth = 2;
                annotations.borderDash = [5, 5];
            }
            if (annotations.label) {
                annotations.label.content = getZoneLabel(zone) + " ✓";
            }

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
        */
}

/**
 * Remove zone box from chart
 */
function removeZoneBox(zoneId: string): void {
    (activeZones as Map<string, ZoneData>).delete(zoneId);
    /*
    if (
        tradesChart &&
        tradesChart.options &&
        tradesChart.options.plugins &&
        tradesChart.options.plugins.annotation &&
        tradesChart.options.plugins.annotation.annotations
    ) {
        const annotation = tradesChart.options.plugins.annotation
            .annotations as Record<string, AnnotationOptions<"box">>;
        if (annotation) {
            delete annotation[`zone_${zoneId}`];
        }

        tradesChart.update("none");
    }
        */
}

/**
 * Add zone as chart annotation
 * /
function addZoneToChart(zone: ZoneData): void {
    if (
        tradesChart &&
        tradesChart.options &&
        tradesChart.options.plugins &&
        tradesChart.options.plugins.annotation &&
        tradesChart.options.plugins.annotation.annotations
    ) {
        console.log(
            "Adding zone to chart:",
            zone.type,
            zone.id,
            zone.priceRange
        );
    
        /*

        if (zone.type === "hidden_liquidity" || zone.type === "iceberg") {
            const price: number =
                zone.priceRange.center ??
                (zone.priceRange.min + zone.priceRange.max) / 2;

            // Calculate actual end time for iceberg orders based on zone duration
            const endTime: number = zone.endTime || Date.now() + 5 * 60 * 1000;

            const zoneAnnotationLine: AnnotationOptions<"line"> = {
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
                enter: (_ctx: EventContext, event: ChartEvent) => {
                    showZoneTooltip(zone, event);
                },
                leave: () => {
                    hideZoneTooltip();
                },
            };

            // Add borderDash only if it's defined
            if (zone.type === "iceberg") {
                zoneAnnotationLine.borderDash = [8, 4];
            }
            const annotation = tradesChart.options.plugins.annotation
                .annotations as Record<string, AnnotationOptions<"line">>;
            if (annotation) {
                annotation[`zone_${zone.id}`] = zoneAnnotationLine;
            }
        } else {
            const zoneAnnotation: AnnotationOptions<"box"> = {
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
                enter: (_ctx: EventContext, event: ChartEvent) => {
                    showZoneTooltip(zone, event);
                },
                leave: () => {
                    hideZoneTooltip();
                },
            } as AnnotationOptions<"box">;
            const annotation = tradesChart.options.plugins.annotation
                .annotations as Record<string, AnnotationOptions<"box">>;
            if (annotation) {
                annotation[`zone_${zone.id}`] = zoneAnnotation;
            }
        }
        tradesChart.update("none");
    }
        */
//}

/**
 * Get zone background color based on type and strength
 */
export function getZoneColor(zone: ZoneData): string {
    const alpha: number = Math.max(
        ZONE_ALPHA_MIN_PERCENT,
        zone.strength * ZONE_ALPHA_MAX_PERCENT
    ); // Min 15%, max 40% opacity

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
export function getZoneBorderColor(zone: ZoneData): string {
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
export function getCompletedZoneColor(zone: ZoneData): string {
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

export function getCompletedZoneBorderColor(zone: ZoneData): string {
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
export function getZoneTextColor(zone: ZoneData): string {
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
export function showZoneTooltip(zone: ZoneData, event: ChartEvent): void {
    const tooltip: HTMLDivElement = document.createElement("div");
    tooltip.id = "zoneTooltip";
    tooltip.style.position = "fixed";
    tooltip.style.background = "rgba(0, 0, 0, 0.9)";
    tooltip.style.color = "white";
    tooltip.style.padding = "12px";
    tooltip.style.borderRadius = "6px";
    tooltip.style.fontSize = "12px";
    tooltip.style.fontFamily = "monospace";
    tooltip.style.pointerEvents = "none";
    tooltip.style.zIndex = "10000";
    tooltip.style.maxWidth = "300px";
    tooltip.style.lineHeight = "1.4";
    tooltip.style.boxShadow = "0 4px 12px rgba(0, 0, 0, 0.3)";

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

    let tooltipContent: string = `<div style="font-weight: bold; margin-bottom: 6px; color: ${zoneColor};">
            ${getZoneLabel(zone)} ZONE
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
            <div style="margin-top: 6px; border-top: 1px solid #333; padding-top: 6px;">
                <div>Refills: ${zone.refillCount || "N/A"}</div>
                <div>Volume: ${volumeFormatted}</div>
                <div>Avg Size: ${zone.averagePieceSize?.toFixed(2) || "N/A"}</div>
                <div>Side: ${zone.side?.toUpperCase() || "N/A"}</div>
            </div>`;
    } else if (zone.type === "spoofing") {
        tooltipContent += `
            <div style="margin-top: 6px; border-top: 1px solid #333; padding-top: 6px;">
                <div>Type: ${zone.spoofType || "N/A"}</div>
                <div>Wall Size: ${zone.wallSize?.toFixed(2) || "N/A"}</div>
                <div>Canceled: ${zone.canceled?.toFixed(2) || "N/A"}</div>
                <div>Executed: ${zone.executed?.toFixed(2) || "N/A"}</div>
                <div>Side: ${zone.side?.toUpperCase() || "N/A"}</div>
            </div>`;
    } else if (zone.type === "hidden_liquidity") {
        tooltipContent += `
            <div style="margin-top: 6px; border-top: 1px solid #333; padding-top: 6px;">
                <div>Stealth Type: ${zone.stealthType || "N/A"}</div>
                <div>Stealth Score: ${((zone.stealthScore ?? 0) * 100).toFixed(1) + "%"}</div>
                <div>Trades: ${zone.tradeCount || "N/A"}</div>
                <div>Volume: ${volumeFormatted}</div>
                <div>Side: ${zone.side?.toUpperCase() || "N/A"}</div>
            </div>`;
    }

    tooltip.innerHTML = tooltipContent;

    document.body.appendChild(tooltip);

    // Position tooltip
    tooltip.style.left = `${event.x ?? +15}px`;
    tooltip.style.top = `${event.y ?? +15}px`;
}

export function hideZoneTooltip(): void {
    const tooltip: HTMLElement | null = document.getElementById("zoneTooltip");
    if (tooltip) {
        tooltip.remove();
    }
}

export function getAnomalyIcon(type: string | undefined): string {
    switch (type) {
        case "volume_anomaly":
            return "📊";
        case "price_anomaly":
            return "💹";
        case "liquidity_anomaly":
            return "💧";
        default:
            return "❓";
    }
}

/**
 * Cleanup old completed zones
 */
export function cleanupOldZones() {
    const cutoffTime = Date.now() - 60 * 60 * 1000; // 1 hour

    for (const [zoneId, zone] of activeZones) {
        if (!zone.isActive && zone.endTime && zone.endTime < cutoffTime) {
            removeZoneBox(zoneId);
        }
    }
}
