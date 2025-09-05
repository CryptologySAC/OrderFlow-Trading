import {
    Chart,
    TooltipItem,
    ScriptableContext,
    registerables,
    ChartOptions,
    Point,
} from "chart.js";
import "chartjs-adapter-date-fns";
import annotationPlugin, { AnnotationOptions } from "chartjs-plugin-annotation";
import { PADDING_TIME, NINETHY_MINUTES, FIFTEEN_MINUTES } from "./state.js";
import type { RSIDataPoint } from "../frontend-types.js";

Chart.register(...registerables, annotationPlugin);

// RSI threshold constants
const RSI_OVERBOUGHT = 70;
const RSI_OVERSOLD = 30;

export class RsiChart {
    private readonly rsiChart: Chart<"line">;
    private _activeRange: number = NINETHY_MINUTES;
    private lastRsiUpdate = Date.now();
    private lastRsiLongUpdate = Date.now();

    /**
     * Initializes the RSI chart.
     */
    constructor(
        ctx: CanvasRenderingContext2D,
        initialMin: number,
        initialMax: number,
        now: number
    ) {
        this.rsiChart = new Chart(ctx, {
            type: "line",
            data: {
                datasets: [
                    {
                        label: "RSI",
                        parsing: false,
                        data: [], // Start with empty data - will be populated by real RSI data
                        borderColor: this.getRSIColor,
                        backgroundColor: this.getRSIBackgroundColor,
                        borderWidth: 2,
                        fill: false,
                        pointRadius: 0,
                        showLine: true,
                        pointStyle: false,
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
                            label: (context: TooltipItem<"line">) => {
                                const data = context.raw as RSIDataPoint;
                                return data
                                    ? `RSI: ${data.rsi.toFixed(1)}`
                                    : "";
                            },
                        },
                    },
                },
            },
        });

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
            this.rsiChart.options.plugins!.annotation!.annotations as Record<
                string,
                AnnotationOptions<"line">
            >
        )["overboughtLine"] = overboughtLine;
        (
            this.rsiChart.options.plugins!.annotation!.annotations as Record<
                string,
                AnnotationOptions<"line">
            >
        )["oversoldLine"] = oversoldLine;

        // Initialize time annotations
        if (this.activeRange !== null) {
            this.updateTimeAnnotations(now);
        }

        console.log("RSI Chart initialized succesfully!");
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

    public processBacklog(backLog: RSIDataPoint[]): void {
        if (
            !this.rsiChart.data ||
            !this.rsiChart.data.datasets ||
            !this.rsiChart.data.datasets[0] ||
            !this.rsiChart.data.datasets[0].data
        ) {
            throw new Error("RSI Chart dataset corrupted.");
        }

        if (backLog.length === 0) return;

        // reset the dataset
        this.rsiChart.data.datasets.forEach((dataset) => {
            dataset.data = [];
        });

        let points = 0;
        const now = Date.now();
        for (const rsiPoint of backLog) {
            const isOldRSI = now - rsiPoint.time > NINETHY_MINUTES;
            if (!isOldRSI) {
                this.addPoint(rsiPoint, false);
                points++;
            }
        }
        console.log(`${points} backlog RSI Points sent to RSI chart;`);

        this.rsiChart.update("active");
    }

    public setScaleX(min: number, max: number): void {
        if (
            !this.rsiChart ||
            !this.rsiChart.options ||
            !this.rsiChart.options.scales
        ) {
            throw new Error("setScaleX: RSI Chart not correctly initialized.");
        }
        this.rsiChart.options!.scales!["x"]!.min = min;
        this.rsiChart.options!.scales!["x"]!.max = max;
    }

    public addPoint(dataPoint: RSIDataPoint, update: boolean = true): void {
        if (this.isValidRSIData(dataPoint)) {
            if (!this.rsiChart.data || !this.rsiChart.data.datasets) {
                throw new Error("RSI Chart dataset corrupted.");
            }

            const newValue: Point = {
                x: dataPoint.time,
                y: dataPoint.rsi,
            };

            this.rsiChart.data.datasets.forEach((dataset) => {
                dataset.data.push(newValue);
            });

            const now = Date.now();
            if (update && now - this.lastRsiUpdate > 50) {
                this.rsiChart.update("active");
                this.lastRsiUpdate = now;
            }

            if (update && now - this.lastRsiLongUpdate > 1000) {
                this.updateTimeAnnotations(now);
                this.lastRsiLongUpdate = now;
            }
        }
    }

    private isValidRSIData(data: RSIDataPoint): boolean {
        return (
            typeof data.time === "number" &&
            typeof data.rsi === "number" &&
            data.rsi >= 0 &&
            data.rsi <= 100
        );
    }

    /**
     * Updates 15-minute time annotations for RSI chart
     */
    private updateTimeAnnotations(latestTime: number): void {
        if (!this.rsiChart || !this.rsiChart.options) {
            return;
        }
        const chartOptions = this.rsiChart.options as ChartOptions<"line">;
        const annotations = chartOptions.plugins?.annotation
            ?.annotations as Record<string, AnnotationOptions<"line">>;
        if (!annotations) return;

        const min: number = latestTime - this._activeRange;
        const max: number = latestTime + PADDING_TIME;

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

    /**
     * Gets the color for RSI line based on current value
     */
    private getRSIColor(context: ScriptableContext<"line">): string {
        const data = context.raw as Point;
        if (!data || typeof data.y !== "number")
            return "rgba(102, 102, 102, 1)";

        const rsi: number = data.y;
        if (rsi >= RSI_OVERBOUGHT) return "rgba(255, 0, 0, 1)"; // Red for overbought
        if (rsi <= RSI_OVERSOLD) return "rgba(0, 255, 0, 1)"; // Green for oversold
        return "rgba(102, 102, 102, 1)"; // Gray for neutral
    }

    /**
     * Gets the background color for RSI chart area
     */
    private getRSIBackgroundColor(context: ScriptableContext<"line">): string {
        const data = context.raw as Point;
        if (!data || typeof data.y !== "number")
            return "rgba(102, 102, 102, 0.1)";

        const rsi: number = data.y;
        if (rsi >= RSI_OVERBOUGHT) return "rgba(255, 0, 0, 0.1)"; // Light red for overbought
        if (rsi <= RSI_OVERSOLD) return "rgba(0, 255, 0, 0.1)"; // Light green for oversold
        return "rgba(102, 102, 102, 0.1)"; // Light gray for neutral
    }

    public cleanOldData() {
        const RETENTION_MINUTES = 90;
        const cutoffTime = Date.now() - RETENTION_MINUTES * 60 * 1000;

        const originalLength = this.rsiChart.data!.datasets![0]!.data!.length;
        this.rsiChart.data.datasets.forEach((dataset) => {
            dataset.data = dataset.data.filter((dataPoint) => {
                return (dataPoint as Point).x >= cutoffTime;
            });
        });

        const removedCount =
            originalLength - this.rsiChart.data!.datasets![0]!.data!.length;
        console.log(
            `Trade cleanup complete: filtered ${removedCount} old RSI Points, ${this.rsiChart.data!.datasets![0]!.data!.length} remaining`
        );
    }
}
