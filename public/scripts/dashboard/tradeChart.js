import { Chart, registerables, } from "chart.js";
import "chartjs-adapter-date-fns";
import annotationPlugin from "chartjs-plugin-annotation";
import { trades, PADDING_TIME, setTradesChart, NINETHY_MINUTES, FIFTEEN_MINUTES, PADDING_PERCENTAGE, } from "./state.js";
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
export function initializeTradesChart(ctx, initialMin, initialMax, now) {
    const chart = new Chart(ctx, {
        type: "scatter",
        data: {
            datasets: [
                {
                    label: "Trades",
                    parsing: false,
                    data: trades,
                    backgroundColor: (context) => {
                        const dataPoint = context.raw;
                        const backgroundColor = dataPoint && dataPoint.backgroundColor !== undefined
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
                display: true,
                content: (ctx) => {
                    if (ctx &&
                        ctx.chart &&
                        ctx.chart.options &&
                        ctx.chart.options.plugins &&
                        ctx.chart.options.plugins.annotation &&
                        ctx.chart.options.plugins.annotation.annotations) {
                        const annotation = ctx.chart.options.plugins.annotation
                            .annotations;
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
        chart.options.plugins.annotation.annotations["lastPriceLine"] = lastPriceLine;
    }
    catch (error) {
        console.error("Error loading annotations: ", error);
    }
    setTradesChart(chart);
    void now;
    console.log("Trades chart initialized successfully.");
    return chart;
}
function getTradeBackgroundColor(isBuy, quantity) {
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
function getTradePointRadius(quantity) {
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
export function createTrade(x, y, quantity, orderType) {
    const isBuy = orderType.toLowerCase() === "buy";
    return {
        x,
        y,
        quantity,
        orderType: (isBuy ? "BUY" : "SELL"),
        pointRadius: getTradePointRadius(quantity),
        backgroundColor: getTradeBackgroundColor(isBuy, quantity),
    };
}
export function isValidTradeData(data) {
    if (!data || typeof data !== "object")
        return false;
    const trade = data;
    return (typeof trade["time"] === "number" &&
        typeof trade["price"] === "number" &&
        typeof trade["quantity"] === "number" &&
        trade["quantity"] > 1 &&
        (trade["orderType"] === "BUY" || trade["orderType"] === "SELL") &&
        typeof trade["symbol"] === "string" &&
        typeof trade["tradeId"] === "number");
}
export function processTradeBacklog(backLog) {
    const now = Date.now();
    for (const trade of backLog) {
        const isOldTrade = now - trade.time < NINETHY_MINUTES;
        if (isValidTradeData(trade) && !isOldTrade) {
            trades.push(createTrade(trade.time, trade.price, trade.quantity, trade.orderType));
        }
    }
    console.log(`${trades.length} backlog trades sent to Trade chart;`);
    for (const trade of backLog) {
        if (isValidTradeData(trade)) {
            const tradeObj = trade;
            trades.push(createTrade(tradeObj.time, tradeObj.price, tradeObj.quantity, tradeObj.orderType));
        }
    }
    return trades;
}
export function updateYAxisBounds(tradeChart) {
    const chartOptions = tradeChart.options;
    const xMin = chartOptions.scales["x"]?.min;
    const xMax = chartOptions.scales["x"]?.max;
    let yMin = Infinity;
    let yMax = -Infinity;
    let visibleCount = 0;
    if (tradeChart.data.datasets[0] === undefined ||
        tradeChart.data.datasets[0].data === undefined ||
        tradeChart.data.datasets[0].data.length < 2)
        return;
    for (let i = tradeChart.data.datasets[0].data.length - 1; i >= 0; i--) {
        const trade = trades[i];
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
    const tradesChartOptions = tradeChart.options;
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
export function updateTimeAnnotations(tradeChart, latestTime, activeRange) {
    if (!tradeChart)
        return;
    const chartOptions = tradeChart.options;
    const annotations = chartOptions.plugins?.annotation?.annotations;
    if (!annotations)
        return;
    const min = latestTime - activeRange;
    const max = latestTime + PADDING_TIME;
    Object.keys(annotations).forEach((key) => {
        if (!isNaN(Number(key)) && (Number(key) < min || Number(key) > max)) {
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
