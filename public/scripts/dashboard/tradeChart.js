import { Chart, registerables, } from "chart.js";
import "chartjs-adapter-date-fns";
import annotationPlugin from "chartjs-plugin-annotation";
import * as Config from "../config.js";
import { PADDING_FACTOR, NINETHY_MINUTES, FIFTEEN_MINUTES, PADDING_PERCENTAGE, } from "./state.js";
Chart.register(...registerables, annotationPlugin);
const TRADE_OPACITY_HIGH = 0.6;
const TRADE_OPACITY_MEDIUM_HIGH = 0.5;
const TRADE_OPACITY_MEDIUM = 0.4;
const TRADE_OPACITY_LOW = 0.3;
const TRADE_OPACITY_MINIMAL = 0.2;
const TRADE_QUANTITY_HIGH = 500;
const TRADE_QUANTITY_MEDIUM_HIGH = 200;
const TRADE_QUANTITY_MEDIUM = 100;
const TRADE_QUANTITY_LOW = 15;
const POINT_RADIUS_LARGEST = 50;
const POINT_RADIUS_LARGE = 40;
const POINT_RADIUS_MEDIUM = 25;
const POINT_RADIUS_SMALL = 10;
const POINT_RADIUS_TINY = 5;
const POINT_RADIUS_MINIMAL = 2;
export class TradeChart {
    tradeChart;
    lastTradeUpdate = Date.now();
    lastTradeLongUpdate = Date.now();
    _activeRange = NINETHY_MINUTES;
    constructor(ctx, initialMin, initialMax, now) {
        this.tradeChart = new Chart(ctx, {
            type: "scatter",
            data: {
                datasets: [
                    {
                        label: "Trades",
                        parsing: false,
                        data: [],
                        borderWidth: 1,
                        backgroundColor: (context) => {
                            const dataPoint = context.raw;
                            const backgroundColor = dataPoint &&
                                dataPoint.backgroundColor !== undefined
                                ? dataPoint.backgroundColor
                                : "rgba(0,0,0,0)";
                            return backgroundColor;
                        },
                        pointRadius: (context) => {
                            const dataPoint = context.raw;
                            const pointRadius = dataPoint && dataPoint.pointRadius !== undefined
                                ? dataPoint.pointRadius
                                : 0;
                            return pointRadius;
                        },
                        pointHoverRadius: (context) => {
                            const dataPoint = context.raw;
                            const pointRadius = dataPoint && dataPoint.pointRadius !== undefined
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
                            label: (context) => {
                                const t = context.raw;
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
                    content: (ctx) => {
                        if (ctx &&
                            ctx.chart &&
                            ctx.chart.options &&
                            ctx.chart.options.plugins &&
                            ctx.chart.options.plugins.annotation &&
                            ctx.chart.options.plugins.annotation.annotations) {
                            const annotation = ctx.chart.options.plugins
                                .annotation.annotations;
                            if (annotation &&
                                annotation["lastPriceLine"] &&
                                annotation["lastPriceLine"].yMin) {
                                return annotation["lastPriceLine"].yMin.toFixed(2);
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
            this.tradeChart.options.plugins.annotation
                .annotations["lastPriceLine"] = lastPriceLine;
        }
        catch (error) {
            console.error("Error loading annotations: ", error);
        }
        this.updateTimeAnnotations(now);
        console.log("Trades chart initialized successfully.");
    }
    set activeRange(newValue) {
        if (newValue <= 0) {
            throw new Error("active Range must be larger than 0.");
        }
        this._activeRange = newValue;
    }
    get activeRange() {
        return this._activeRange;
    }
    setScaleX(min, max, latestTime) {
        if (!this.tradeChart ||
            !this.tradeChart.options ||
            !this.tradeChart.options.scales) {
            throw new Error("setScaleX: Trade Chart not correctly initialized.");
        }
        this.tradeChart.options.scales["x"].min = min;
        this.tradeChart.options.scales["x"].max = max;
        this.updateYAxisBounds();
        this.updateTimeAnnotations(latestTime);
        this.tradeChart.update("default");
    }
    addTrade(trade, update = true) {
        if (this.isValidTradeData(trade)) {
            const dataPoint = this.createTrade(trade.time, trade.price, trade.quantity, trade.orderType);
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
    getTradeBackgroundColor(isBuy, quantity) {
        const opacity = quantity > TRADE_QUANTITY_HIGH
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
    getTradePointRadius(quantity) {
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
    createTrade(x, y, quantity, orderType) {
        const isBuy = orderType.toLowerCase() === "buy";
        return {
            x,
            y,
            quantity,
            orderType: (isBuy ? "BUY" : "SELL"),
            pointRadius: this.getTradePointRadius(quantity),
            backgroundColor: this.getTradeBackgroundColor(isBuy, quantity),
        };
    }
    isValidTradeData(data) {
        if (!data || typeof data !== "object")
            return false;
        const trade = data;
        return (typeof trade["time"] === "number" &&
            typeof trade["price"] === "number" &&
            typeof trade["quantity"] === "number" &&
            trade["quantity"] > Config.MIN_TRADE_SIZE &&
            (trade["orderType"] === "BUY" || trade["orderType"] === "SELL") &&
            typeof trade["symbol"] === "string" &&
            typeof trade["tradeId"] === "number");
    }
    processTradeBacklog(backLog) {
        if (!this.tradeChart.data ||
            !this.tradeChart.data.datasets ||
            !this.tradeChart.data.datasets[0] ||
            !this.tradeChart.data.datasets[0].data) {
            throw new Error("Trade Chart dataset corrupted.");
        }
        if (backLog.length === 0)
            return;
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
        this.updatePriceLine(backLog[0].price);
        this.tradeChart.update("default");
    }
    updateYAxisBounds() {
        const chartOptions = this.tradeChart.options;
        const xMin = chartOptions.scales["x"]?.min;
        const xMax = chartOptions.scales["x"]?.max;
        let yMin = Infinity;
        let yMax = -Infinity;
        let visibleCount = 0;
        if (this.tradeChart.data.datasets[0] === undefined ||
            this.tradeChart.data.datasets[0].data === undefined ||
            this.tradeChart.data.datasets[0].data.length < 2)
            return;
        for (let i = this.tradeChart.data.datasets[0].data.length - 1; i >= 0; i--) {
            const trade = this.tradeChart.data
                .datasets[0].data[i];
            if (!trade)
                continue;
            if (trade.x >= xMin && trade.x <= xMax) {
                const price = trade.y;
                if (price < yMin)
                    yMin = price;
                if (price > yMax)
                    yMax = price;
                visibleCount++;
            }
        }
        if (visibleCount === 0)
            return;
        const padding = (yMax - yMin) * PADDING_PERCENTAGE;
        const tradesChartOptions = this.tradeChart
            .options;
        if (tradesChartOptions === undefined ||
            tradesChartOptions.scales === undefined ||
            tradesChartOptions.scales["y"] === undefined) {
            throw new Error("tradesChartOptions(.scales.y) is undefined");
        }
        const yScale = tradesChartOptions.scales["y"];
        yScale.suggestedMin = yMin - padding;
        yScale.suggestedMax = yMax + padding;
        yScale.min = yMin - padding;
        yScale.max = yMax + padding;
    }
    updateTimeAnnotations(latestTime) {
        if (!this.tradeChart || !this.tradeChart.options) {
            return;
        }
        const chartOptions = this.tradeChart.options;
        const annotations = chartOptions.plugins?.annotation
            ?.annotations;
        if (!annotations)
            return;
        const padding = Math.ceil(this._activeRange / PADDING_FACTOR);
        const min = latestTime - this._activeRange;
        const max = latestTime + padding;
        Object.keys(annotations).forEach((key) => {
            if (!isNaN(Number(key)) &&
                (Number(key) < min || Number(key) > max)) {
                delete annotations[key];
            }
        });
        let time = Math.ceil(min / FIFTEEN_MINUTES) * FIFTEEN_MINUTES;
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
    updatePriceLine(price) {
        const annotations = this.tradeChart.options.plugins?.annotation
            ?.annotations;
        if (annotations) {
            const line = annotations["lastPriceLine"];
            if (line) {
                line.yMin = price;
                line.yMax = price;
            }
        }
    }
    cleanOldTrades() {
        const RETENTION_MINUTES = 90;
        const cutoffTime = Date.now() - RETENTION_MINUTES * 60 * 1000;
        const originalLength = this.tradeChart.data.datasets[0].data.length;
        this.tradeChart.data.datasets.forEach((dataset) => {
            dataset.data = dataset.data.filter((trade) => {
                return trade.x >= cutoffTime;
            });
        });
        this.updateYAxisBounds();
        const removedCount = originalLength - this.tradeChart.data.datasets[0].data.length;
        console.log(`Trade cleanup complete: filtered ${removedCount} old trades, ${this.tradeChart.data.datasets[0].data.length} remaining`);
    }
}
