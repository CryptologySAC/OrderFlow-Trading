import {
    Chart,
    TooltipItem,
    ScriptableContext,
    registerables,
    ChartOptions,
    LinearScaleOptions,
} from "chart.js";
import "chartjs-adapter-date-fns";
import annotationPlugin, {
    AnnotationOptions,
    PartialEventContext,
} from "chartjs-plugin-annotation";

import {
    //rsiChart,
    trades,
    PADDING_TIME,
    setTradesChart,
    NINETHY_MINUTES,
    FIFTEEN_MINUTES,
    PADDING_PERCENTAGE,
} from "./state.js";
import type { TradeData } from "../types.js";

//import
//    ,
//    {
//EventContext,
//,
//} from "chartjs-plugin-annotation";
Chart.register(...registerables, annotationPlugin);

import type { ChartDataPoint } from "../frontend-types.js";

// Trade opacity constants
const TRADE_OPACITY_HIGH = 0.6;
const TRADE_OPACITY_MEDIUM_HIGH = 0.5;
const TRADE_OPACITY_MEDIUM = 0.4;
const TRADE_OPACITY_LOW = 0.3;
const TRADE_OPACITY_MINIMAL = 0.2;

// Trade quantity thresholds
const TRADE_QUANTITY_HIGH = 500;
const TRADE_QUANTITY_MEDIUM_HIGH = 200;
const TRADE_QUANTITY_MEDIUM = 100;
const TRADE_QUANTITY_LOW = 15;

// Point radius constants
const POINT_RADIUS_LARGEST = 50;
const POINT_RADIUS_LARGE = 40;
const POINT_RADIUS_MEDIUM = 25;
const POINT_RADIUS_SMALL = 10;
const POINT_RADIUS_TINY = 5;
const POINT_RADIUS_MINIMAL = 2;

/**
 * Initializes the trades scatter chart.
 */
export function initializeTradesChart(
    ctx: CanvasRenderingContext2D,
    initialMin: number,
    initialMax: number,
    now: number
): Chart<"scatter"> | null {
    const chart: Chart<"scatter"> = new Chart(ctx, {
        type: "scatter",
        data: {
            datasets: [
                {
                    label: "Trades",
                    parsing: false,
                    data: trades,
                    backgroundColor: (context: ScriptableContext<"line">) => {
                        const dataPoint = context.raw as ChartDataPoint;
                        const backgroundColor =
                            dataPoint && dataPoint.backgroundColor !== undefined
                                ? dataPoint.backgroundColor
                                : "rgba(0,0,0,0)";
                        return backgroundColor;
                    },
                    pointRadius: (context: ScriptableContext<"line">) => {
                        const dataPoint = context.raw as ChartDataPoint;
                        const pointRadius =
                            dataPoint && dataPoint.pointRadius !== undefined
                                ? dataPoint.pointRadius
                                : 0;
                        return pointRadius;
                    },
                    pointHoverRadius: (context: ScriptableContext<"line">) => {
                        const dataPoint = context.raw as ChartDataPoint;
                        const pointRadius =
                            dataPoint && dataPoint.pointRadius !== undefined
                                ? dataPoint.pointRadius
                                : 0;
                        return pointRadius;
                    },
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
                        displayFormats: { minute: "HH:mm", hour: "HH:mm" },
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
                        label: (context: TooltipItem<"scatter">) => {
                            const t = context.raw as ChartDataPoint;
                            return t
                                ? `Price: ${t.y.toFixed(2)}, Qty: ${t.quantity}, Type: ${t.orderType}`
                                : "";
                        },
                    },
                },
            },
        },
    });

    try {
        let lastPriceLine = {
            type: "line",
            yMin: 0,
            yMax: 0,
            borderColor: "blue",
            borderWidth: 1,
            borderCapStyle: "butt",
            borderJoinStyle: "miter",
            drawTime: "afterDatasetsDraw",
            label: {
                borderCapStyle: "butt",
                borderJoinStyle: "miter",
                display: true,
                content: (ctx: PartialEventContext) => {
                    if (
                        ctx &&
                        ctx.chart &&
                        ctx.chart.options &&
                        ctx.chart.options.plugins &&
                        ctx.chart.options.plugins.annotation &&
                        ctx.chart.options.plugins.annotation.annotations
                    ) {
                        const annotation = ctx.chart.options.plugins.annotation
                            .annotations as Record<
                            string,
                            AnnotationOptions<"line">
                        >;

                        if (
                            annotation &&
                            annotation["lastPriceLine"] &&
                            annotation["lastPriceLine"].yMin
                        ) {
                            return (
                                annotation["lastPriceLine"].yMin as number
                            ).toFixed(2);
                        }
                    }
                    return "";
                },
                position: "end",
                xAdjust: -2,
                yAdjust: 0,
                backgroundColor: "rgba(0, 0, 255, 0.5)",
                color: "white",
                font: { size: 12 },
                padding: 6,
            },
        };

        (
            chart.options.plugins!.annotation!.annotations as Record<
                string,
                AnnotationOptions<"line">
            >
        )["lastPriceLine"] = lastPriceLine as AnnotationOptions<"line">;
    } catch (error) {
        console.error("Error loading annotations: ", error);
    }

    setTradesChart(chart as Chart<"scatter">);
    void now;
    // Initialize time annotations for specific time ranges
    //if (activeRange !== null) {
    //    updateTimeAnnotations(now, activeRange);
    //}

    console.log("Trades chart initialized successfully.");
    return chart;
}

/**
 * Gets the background color for a trade based on type and quantity.
 */
function getTradeBackgroundColor(isBuy: boolean, quantity: number): string {
    const opacity: number =
        quantity > TRADE_QUANTITY_HIGH
            ? TRADE_OPACITY_HIGH
            : quantity > TRADE_QUANTITY_MEDIUM_HIGH
              ? TRADE_OPACITY_MEDIUM_HIGH
              : quantity > TRADE_QUANTITY_MEDIUM
                ? TRADE_OPACITY_MEDIUM
                : quantity > TRADE_QUANTITY_LOW
                  ? TRADE_OPACITY_LOW
                  : TRADE_OPACITY_MINIMAL;
    return isBuy
        ? `rgba(0, 255, 30, ${opacity})`
        : `rgba(255, 0, 90, ${opacity})`;
}

/**
 * Gets the point radius for a trade based on quantity.
 */
function getTradePointRadius(quantity: number): number {
    return quantity > 1000
        ? POINT_RADIUS_LARGEST
        : quantity > TRADE_QUANTITY_HIGH
          ? POINT_RADIUS_LARGE
          : quantity > TRADE_QUANTITY_MEDIUM_HIGH
            ? POINT_RADIUS_MEDIUM
            : quantity > TRADE_QUANTITY_MEDIUM
              ? POINT_RADIUS_SMALL
              : quantity > 50
                ? POINT_RADIUS_TINY
                : POINT_RADIUS_MINIMAL;
}

export function createTrade(
    x: number,
    y: number,
    quantity: number,
    orderType: string
): ChartDataPoint {
    const isBuy = orderType.toLowerCase() === "buy";
    return {
        x,
        y,
        quantity,
        orderType: (isBuy ? "BUY" : "SELL") as "BUY" | "SELL",
        pointRadius: getTradePointRadius(quantity),
        backgroundColor: getTradeBackgroundColor(isBuy, quantity),
    };
}

export function isValidTradeData(data: unknown): data is TradeData {
    if (!data || typeof data !== "object") return false;
    const trade = data as Record<string, unknown>;

    return (
        typeof trade["time"] === "number" &&
        typeof trade["price"] === "number" &&
        typeof trade["quantity"] === "number" &&
        trade["quantity"] > 1 &&
        (trade["orderType"] === "BUY" || trade["orderType"] === "SELL") &&
        typeof trade["symbol"] === "string" &&
        typeof trade["tradeId"] === "number"
    );
}

export function processTradeBacklog(backLog: TradeData[]): ChartDataPoint[] {
    const now = Date.now();
    for (const trade of backLog) {
        const isOldTrade = now - trade.time < NINETHY_MINUTES;
        if (isValidTradeData(trade) && !isOldTrade) {
            trades.push(
                createTrade(
                    trade.time,
                    trade.price,
                    trade.quantity,
                    trade.orderType
                )
            );
        }
    }
    console.log(`${trades.length} backlog trades sent to Trade chart;`);

    for (const trade of backLog) {
        if (isValidTradeData(trade)) {
            // TypeScript knows trade is valid after isValidTradeData check
            const tradeObj = trade as unknown as {
                time: number;
                price: number;
                quantity: number;
                orderType: "BUY" | "SELL";
            };
            trades.push(
                createTrade(
                    tradeObj.time,
                    tradeObj.price,
                    tradeObj.quantity,
                    tradeObj.orderType
                )
            );
        }
    }

    return trades;
}

/**
 * Updates Y-axis bounds based on visible trades (optimized for performance)
 */
export function updateYAxisBounds(tradeChart: Chart<"scatter">): void {
    // Only process the visible range
    const chartOptions = tradeChart.options as ChartOptions<"scatter">;
    const xMin: number = chartOptions.scales!["x"]?.min as number;
    const xMax: number = chartOptions.scales!["x"]?.max as number;

    // PERFORMANCE OPTIMIZATION: Use single pass through trades array
    // Instead of filter + map + spread, do everything in one loop
    let yMin: number = Infinity;
    let yMax: number = -Infinity;
    let visibleCount: number = 0;

    if (
        tradeChart.data.datasets[0] === undefined ||
        tradeChart.data.datasets[0].data === undefined ||
        tradeChart.data.datasets[0].data.length < 2
    )
        return;

    // Single efficient loop through trades
    for (let i = tradeChart.data.datasets[0].data.length - 1; i >= 0; i--) {
        const trade: ChartDataPoint | undefined = trades[i];
        if (!trade) continue;
        if (trade.x >= xMin && trade.x <= xMax) {
            const price: number = trade.y;
            if (price < yMin) yMin = price;
            if (price > yMax) yMax = price;
            visibleCount++;
        }
    }

    if (visibleCount === 0) return;

    const padding: number = (yMax - yMin) * PADDING_PERCENTAGE;
    const tradesChartOptions: ChartOptions<"scatter"> =
        tradeChart.options as ChartOptions<"scatter">;
    if (
        tradesChartOptions === undefined ||
        tradesChartOptions.scales === undefined ||
        tradesChartOptions.scales["y"] === undefined
    ) {
        throw new Error("tradesChartOptions(.scales.y) is undefined");
    }
    const yScale = tradesChartOptions.scales["y"] as LinearScaleOptions;
    yScale.suggestedMin = yMin - padding;
    yScale.suggestedMax = yMax + padding;
    yScale.min = yMin - padding;
    yScale.max = yMax + padding;
}

/**
 * Updates 15-minute annotations efficiently
 */
export function updateTimeAnnotations(
    tradeChart: Chart<"scatter">,
    latestTime: number,
    activeRange: number
): void {
    if (!tradeChart) return;
    const chartOptions = tradeChart.options as ChartOptions<"scatter">;
    const annotations = chartOptions.plugins?.annotation?.annotations as Record<
        string,
        AnnotationOptions<"line">
    >;
    if (!annotations) return;

    const min: number = latestTime - activeRange;
    const max: number = latestTime + PADDING_TIME;

    Object.keys(annotations).forEach((key: string) => {
        if (!isNaN(Number(key)) && (Number(key) < min || Number(key) > max)) {
            delete annotations[key];
        }
    });

    let time: number = Math.ceil(min / FIFTEEN_MINUTES) * FIFTEEN_MINUTES;
    while (time <= max) {
        if (!annotations[time.toFixed()]) {
            annotations[time.toFixed()] = {
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
