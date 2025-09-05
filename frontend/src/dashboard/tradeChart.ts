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
import * as Config from "../config.js";
import {
    PADDING_FACTOR,
    NINETHY_MINUTES,
    FIFTEEN_MINUTES,
    PADDING_PERCENTAGE,
} from "./state.js";
import type { TradeData } from "../types.js";
import type { ChartDataPoint } from "../frontend-types.js";

Chart.register(...registerables, annotationPlugin);

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

export class TradeChart {
    private readonly tradeChart: Chart<"scatter">;
    private lastTradeUpdate = Date.now();
    private lastTradeLongUpdate = Date.now();
    private _activeRange: number = NINETHY_MINUTES;

    constructor(
        ctx: CanvasRenderingContext2D,
        initialMin: number,
        initialMax: number,
        now: number
    ) {
        this.tradeChart = new Chart(ctx, {
            type: "scatter",
            data: {
                datasets: [
                    {
                        label: "Trades",
                        parsing: false,
                        data: [],
                        borderWidth: 1,
                        backgroundColor: (
                            context: ScriptableContext<"line">
                        ) => {
                            const dataPoint = context.raw as ChartDataPoint;
                            const backgroundColor =
                                dataPoint &&
                                dataPoint.backgroundColor !== undefined
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
                        pointHoverRadius: (
                            context: ScriptableContext<"line">
                        ) => {
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
                        alignToPixels: true,
                        bounds: "ticks",
                    },
                    y: {
                        type: "linear",
                        title: {
                            display: true,
                            text: "USDT",
                        },
                        ticks: {
                            stepSize: 0.05,
                            precision: 5,
                            font: {
                                size: 11,
                                family: "monospace",
                            },
                            padding: 10,
                        },
                        position: "right",
                        grace: 0,
                        offset: true,
                        alignToPixels: true,
                    },
                },
                plugins: {
                    annotation: {
                        annotations: {
                            lastPriceLine: {},
                        },
                    },
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
                    borderWidth: 1,
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
                            const annotation = ctx.chart.options.plugins
                                .annotation.annotations as Record<
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
                this.tradeChart.options.plugins!.annotation!
                    .annotations as Record<string, AnnotationOptions<"line">>
            )["lastPriceLine"] = lastPriceLine as AnnotationOptions<"line">;
        } catch (error) {
            console.error("Error loading annotations: ", error);
        }

        // Initialize time annotations for specific time ranges
        this.updateTimeAnnotations(now);

        console.log("Trades chart initialized successfully.");
    }

    public set activeRange(newValue: number) {
        if (newValue <= 0) {
            throw new Error("active Range must be larger than 0.");
        }
        this._activeRange = newValue;
    }

    public get activeRange(): number {
        return this._activeRange;
    }

    public setScaleX(min: number, max: number, latestTime: number): void {
        if (
            !this.tradeChart ||
            !this.tradeChart.options ||
            !this.tradeChart.options.scales
        ) {
            throw new Error(
                "setScaleX: Trade Chart not correctly initialized."
            );
        }
        this.tradeChart.options!.scales!["x"]!.min = min;
        this.tradeChart.options!.scales!["x"]!.max = max;
        this.updateYAxisBounds();
        this.updateTimeAnnotations(latestTime);
        this.tradeChart.update("default");
    }

    public addTrade(trade: TradeData, update: boolean = true): void {
        if (this.isValidTradeData(trade)) {
            const dataPoint: ChartDataPoint = this.createTrade(
                trade.time,
                trade.price,
                trade.quantity,
                trade.orderType
            );
            if (!this.tradeChart.data || !this.tradeChart.data.datasets) {
                throw new Error("Trade Chart dataset corrupted.");
            }

            this.tradeChart.data.datasets.forEach((dataset) => {
                dataset.data.push(dataPoint);
            });

            const now = Date.now();
            if (update && now - this.lastTradeUpdate > 50) {
                this.updatePriceLine(trade.price);
                this.tradeChart.update("default");
                this.lastTradeUpdate = now;
            }

            if (update && now - this.lastTradeLongUpdate > 1000) {
                this.updateYAxisBounds();
                this.updateTimeAnnotations(now);
                this.lastTradeLongUpdate = now;
            }
        }
    }

    /**
     * Gets the background color for a trade based on type and quantity.
     */
    private getTradeBackgroundColor(isBuy: boolean, quantity: number): string {
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
    private getTradePointRadius(quantity: number): number {
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

    private createTrade(
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
            pointRadius: this.getTradePointRadius(quantity),
            backgroundColor: this.getTradeBackgroundColor(isBuy, quantity),
        };
    }

    private isValidTradeData(data: unknown): data is TradeData {
        if (!data || typeof data !== "object") return false;
        const trade = data as Record<string, unknown>;

        return (
            typeof trade["time"] === "number" &&
            typeof trade["price"] === "number" &&
            typeof trade["quantity"] === "number" &&
            trade["quantity"] > Config.MIN_TRADE_SIZE &&
            (trade["orderType"] === "BUY" || trade["orderType"] === "SELL") &&
            typeof trade["symbol"] === "string" &&
            typeof trade["tradeId"] === "number"
        );
    }

    public processTradeBacklog(backLog: TradeData[]): void {
        if (
            !this.tradeChart.data ||
            !this.tradeChart.data.datasets ||
            !this.tradeChart.data.datasets[0] ||
            !this.tradeChart.data.datasets[0].data
        ) {
            throw new Error("Trade Chart dataset corrupted.");
        }

        if (backLog.length === 0) return;

        // reset the dataset
        this.tradeChart.data.datasets.forEach((dataset) => {
            dataset.data = [];
        });

        let points = 0;
        const now = Date.now();
        const sortedBacklog = [...backLog].sort((a, b) => a.time - b.time);
        for (const trade of sortedBacklog) {
            const isOldTrade = now - trade.time > NINETHY_MINUTES;
            if (!isOldTrade) {
                this.addTrade(trade, false);
                points++;
            }
        }
        console.log(`${points} backlog trades sent to Trade chart;`);

        this.updateYAxisBounds();
        this.updatePriceLine(backLog[0]!.price);
        this.tradeChart.update("default");
    }

    /**
     * Updates Y-axis bounds based on visible trades (optimized for performance)
     */
    private updateYAxisBounds(): void {
        // Only process the visible range
        const chartOptions = this.tradeChart.options as ChartOptions<"scatter">;
        const xMin: number = chartOptions.scales!["x"]?.min as number;
        const xMax: number = chartOptions.scales!["x"]?.max as number;

        // PERFORMANCE OPTIMIZATION: Use single pass through trades array
        // Instead of filter + map + spread, do everything in one loop
        let yMin: number = Infinity;
        let yMax: number = -Infinity;
        let visibleCount: number = 0;

        if (
            this.tradeChart.data.datasets[0] === undefined ||
            this.tradeChart.data.datasets[0].data === undefined ||
            this.tradeChart.data.datasets[0].data.length < 2
        )
            return;

        // Single efficient loop through trades
        for (
            let i = this.tradeChart.data.datasets[0].data.length - 1;
            i >= 0;
            i--
        ) {
            const trade: ChartDataPoint | undefined = this.tradeChart.data
                .datasets[0].data[i] as ChartDataPoint;
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
        const tradesChartOptions: ChartOptions<"scatter"> = this.tradeChart
            .options as ChartOptions<"scatter">;
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
    private updateTimeAnnotations(latestTime: number): void {
        if (!this.tradeChart || !this.tradeChart.options) {
            return;
        }
        const chartOptions = this.tradeChart.options as ChartOptions<"scatter">;
        const annotations = chartOptions.plugins?.annotation
            ?.annotations as Record<string, AnnotationOptions<"line">>;
        if (!annotations) return;

        const padding = Math.ceil(this._activeRange / PADDING_FACTOR);
        const min: number = latestTime - this._activeRange;
        const max: number = latestTime + padding;

        Object.keys(annotations).forEach((key: string) => {
            if (
                !isNaN(Number(key)) &&
                (Number(key) < min || Number(key) > max)
            ) {
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

    private updatePriceLine(price: number) {
        const annotations = this.tradeChart.options.plugins?.annotation
            ?.annotations as Record<string, AnnotationOptions<"line">>;
        if (annotations) {
            const line = annotations[
                "lastPriceLine"
            ] as AnnotationOptions<"line">;
            if (line) {
                line.yMin = price;
                line.yMax = price;
            }
        }
    }

    public cleanOldTrades() {
        const RETENTION_MINUTES = 90;
        const cutoffTime = Date.now() - RETENTION_MINUTES * 60 * 1000;

        const originalLength = this.tradeChart.data!.datasets![0]!.data!.length;
        this.tradeChart.data.datasets.forEach((dataset) => {
            dataset.data = dataset.data.filter((trade) => {
                return (trade as ChartDataPoint).x >= cutoffTime;
            });
        });
        this.updateYAxisBounds();
        const removedCount =
            originalLength - this.tradeChart.data!.datasets![0]!.data!.length;
        console.log(
            `Trade cleanup complete: filtered ${removedCount} old trades, ${this.tradeChart.data!.datasets![0]!.data!.length} remaining`
        );
    }
}
