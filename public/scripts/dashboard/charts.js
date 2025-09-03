import { tradesChart, orderBookChart, rsiChart, trades, activeRange, PADDING_TIME, FIFTEEN_MINUTES, orderBookData, maxSupportResistanceLevels, activeZones, maxActiveZones, signalsList, setTradesChart, setOrderBookChart, setRsiChart, } from "./state.js";
import { renderSignalsList } from "./render.js";
import { getCurrentTheme, getSystemTheme, getDepletionVisualizationEnabled, } from "./theme.js";
import { Chart, registerables } from "chart.js";
import "chartjs-adapter-date-fns";
import annotationPlugin from "chartjs-plugin-annotation";
import zoomPlugin from "chartjs-plugin-zoom";
Chart.register(...registerables, annotationPlugin, zoomPlugin);
const PADDING_PERCENTAGE = 0.05;
const MAX_LABEL_LENGTH = 250;
const TRUNCATED_LABEL_LENGTH = 245;
const PRICE_DEVIATION_THRESHOLD = 0.02;
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
const RSI_OVERBOUGHT = 70;
const RSI_OVERSOLD = 30;
const COLOR_ALPHA_FULL = 1;
const COLOR_ALPHA_MEDIUM = 0.5;
const COLOR_ALPHA_STRONG = 0.8;
const COLOR_ALPHA_MAX = 0.9;
const VOLUME_NORMALIZER_DARK = 1500;
const VOLUME_NORMALIZER_LIGHT = 2000;
const VOLUME_OPACITY_MIN = 0.3;
const VOLUME_OPACITY_LOW = 0.4;
const VOLUME_OPACITY_MEDIUM = 0.6;
const VOLUME_OPACITY_HIGH = 0.8;
const VOLUME_OPACITY_MAX = 0.9;
const DEPLETION_RATIO_LOW = 0.3;
const DEPLETION_RATIO_MEDIUM = 0.7;
const ZONE_ALPHA_MIN = 0.2;
const ZONE_ALPHA_MAX = 0.5;
const ZONE_DURATION_MAX_HOURS = 4;
const ZONE_DURATION_MAX_MS = ZONE_DURATION_MAX_HOURS * 60 * 60 * 1000;
const ZONE_BASE_THICKNESS_PERCENT = 0.0008;
const ZONE_STRENGTH_MULTIPLIER_BASE = 1;
const ZONE_TOUCH_MULTIPLIER_MAX = 1;
const ZONE_TOUCH_COUNT_NORMALIZER = 10;
const ZONE_ALPHA_MULTIPLIER = 1.5;
const ZONE_ALPHA_MULTIPLIER_MAX = 0.8;
const BREACH_THRESHOLD_MULTIPLIER = 2;
const CLEANUP_TIME_HOURS = 2;
const CLEANUP_TIME_MS = CLEANUP_TIME_HOURS * 60 * 60 * 1000;
const ZONE_ALPHA_MIN_PERCENT = 0.15;
const ZONE_ALPHA_MAX_PERCENT = 0.4;
const COLOR_RED_FULL = 255;
const COLOR_RED_MEDIUM = 80;
const COLOR_RED_LOW = 0;
const COLOR_GREEN_FULL = 255;
const COLOR_GREEN_MEDIUM = 128;
const ORDER_BOOK_VOLUME_NORMALIZER_DARK = 1500;
const ORDER_BOOK_VOLUME_NORMALIZER_LIGHT = 2000;
let isSyncing = false;
let chartUpdateScheduled = false;
let supportResistanceLevels = [];
export function scheduleTradesChartUpdate() {
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
export function scheduleOrderBookUpdate() {
    if (!orderBookChart)
        return;
    orderBookChart.update();
}
export function updateYAxisBounds() {
    if (!tradesChart || trades.length === 0)
        return;
    const chartOptions = tradesChart.options;
    const xMin = chartOptions.scales?.["x"]?.min;
    const xMax = chartOptions.scales?.["x"]?.max;
    let yMin = Infinity;
    let yMax = -Infinity;
    let visibleCount = 0;
    for (let i = trades.length - 1; i >= 0; i--) {
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
            if (visibleCount >= 1000)
                break;
        }
    }
    if (visibleCount === 0)
        return;
    const padding = (yMax - yMin) * PADDING_PERCENTAGE;
    const tradesChartOptions = tradesChart.options;
    if (tradesChartOptions === undefined || tradesChartOptions.scales === undefined || tradesChartOptions.scales["y"] === undefined) {
        throw new Error("tradesChartOptions(.scales.y) is undefined");
    }
    const yScale = tradesChartOptions.scales["y"];
    yScale.suggestedMin = yMin - padding;
    yScale.suggestedMax = yMax + padding;
    yScale.min = 0;
    yScale.max = 0;
}
export function updateTimeAnnotations(latestTime, activeRange) {
    if (!tradesChart)
        return;
    const chartOptions = tradesChart.options;
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
export function updateRSITimeAnnotations(latestTime, activeRange) {
    if (!rsiChart)
        return;
    const rsiChartOptions = rsiChart.options;
    const annotations = rsiChartOptions.plugins?.annotation?.annotations;
    if (!annotations)
        return;
    const newAnnotations = {};
    if (annotations["overboughtLine"]) {
        newAnnotations["overboughtLine"] = {
            ...annotations["overboughtLine"],
        };
    }
    if (annotations["oversoldLine"]) {
        newAnnotations["oversoldLine"] = {
            ...annotations["oversoldLine"],
        };
    }
    const min = latestTime - activeRange;
    const max = latestTime + PADDING_TIME;
    let time = Math.ceil(min / FIFTEEN_MINUTES) * FIFTEEN_MINUTES;
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
    if (rsiChart.options.plugins?.annotation) {
        rsiChart.options.plugins.annotation.annotations = newAnnotations;
    }
}
export function createTrade(x, y, quantity, orderType) {
    return {
        x,
        y,
        quantity,
        orderType: (orderType.toLowerCase() === "buy" ? "BUY" : "SELL"),
    };
}
export function buildSignalLabel(signal) {
    if (!signal)
        return "Invalid Signal";
    let label = `[${signal.type?.toUpperCase() ?? "?"}] ${signal.side?.toUpperCase() ?? "?"} @ ${signal.price?.toFixed(2) ?? "?"}`;
    if (signal.confidence !== undefined) {
        label += `\nConf: ${(signal.confidence * 100).toFixed(0)}%`;
    }
    if (label.length > MAX_LABEL_LENGTH)
        label = label.slice(0, TRUNCATED_LABEL_LENGTH) + "...";
    return label;
}
export function isValidTrade(trade) {
    if (!trade || typeof trade !== "object")
        return false;
    const t = trade;
    const orderType = t["orderType"];
    return (typeof t["time"] === "number" &&
        typeof t["price"] === "number" &&
        typeof t["quantity"] === "number" &&
        (orderType === "BUY" ||
            orderType === "SELL" ||
            orderType === "buy" ||
            orderType === "sell"));
}
function getTradeBackgroundColor(context) {
    const trade = context.raw;
    if (!trade)
        return "rgba(0, 0, 0, 0)";
    const isBuy = trade.orderType === "BUY";
    const q = trade.quantity || 0;
    const opacity = q > TRADE_QUANTITY_HIGH
        ? TRADE_OPACITY_HIGH
        : q > TRADE_QUANTITY_MEDIUM_HIGH
            ? TRADE_OPACITY_MEDIUM_HIGH
            : q > TRADE_QUANTITY_MEDIUM
                ? TRADE_OPACITY_MEDIUM
                : q > TRADE_QUANTITY_LOW
                    ? TRADE_OPACITY_LOW
                    : TRADE_OPACITY_MINIMAL;
    return isBuy
        ? `rgba(0, 255, 30, ${opacity})`
        : `rgba(255, 0, 90, ${opacity})`;
}
function getTradePointRadius(context) {
    const q = context.raw?.quantity || 0;
    return q > 1000
        ? POINT_RADIUS_LARGEST
        : q > TRADE_QUANTITY_HIGH
            ? POINT_RADIUS_LARGE
            : q > TRADE_QUANTITY_MEDIUM_HIGH
                ? POINT_RADIUS_MEDIUM
                : q > TRADE_QUANTITY_MEDIUM
                    ? POINT_RADIUS_SMALL
                    : q > 50
                        ? POINT_RADIUS_TINY
                        : POINT_RADIUS_MINIMAL;
}
export function initializeTradesChart(ctx) {
    if (tradesChart)
        return tradesChart;
    const now = Date.now();
    let initialMin, initialMax;
    if (activeRange !== null) {
        initialMin = now - activeRange;
        initialMax = now + PADDING_TIME;
    }
    else {
        initialMin = now - 90 * 60000;
        initialMax = now + PADDING_TIME;
    }
    const chart = new Chart(ctx, {
        type: "scatter",
        data: {
            datasets: [
                {
                    label: "Trades",
                    parsing: { xAxisKey: "x", yAxisKey: "y" },
                    data: trades,
                    backgroundColor: getTradeBackgroundColor,
                    pointRadius: getTradePointRadius,
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
                                content: (ctx) => ctx.chart.options.plugins
                                    ?.annotation?.annotations
                                    ?.lastPriceLine?.yMin?.toFixed(2) || "",
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
                        onPanComplete: ({ chart }) => {
                            if (isSyncing)
                                return;
                            isSyncing = true;
                            if (rsiChart) {
                                const rsiChartOptions = rsiChart.options;
                                const chartOptions = chart.options;
                                if (rsiChartOptions === undefined) {
                                    throw new Error("rsiChartOptions is undefined.");
                                }
                                if (rsiChartOptions.scales && rsiChartOptions.scales["x"]) {
                                    rsiChartOptions.scales["x"].min =
                                        chartOptions.scales?.["x"]?.min ??
                                            Date.now() - 90 * 60000;
                                    rsiChartOptions.scales["x"].max =
                                        chartOptions.scales?.["x"]?.max ??
                                            Date.now() + PADDING_TIME;
                                    rsiChart.update("none");
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
                        onZoomComplete: ({ chart }) => {
                            if (isSyncing)
                                return;
                            isSyncing = true;
                            if (rsiChart && chart) {
                                if (rsiChart.options &&
                                    rsiChart.options.scales &&
                                    chart.options &&
                                    chart.options.scales &&
                                    rsiChart.options.scales["x"] &&
                                    chart.options.scales["x"]) {
                                    rsiChart.options.scales.x.min =
                                        chart.options.scales.x.min ??
                                            Date.now() - 90 * 60000;
                                    rsiChart.options.scales.x.max =
                                        chart.options.scales["x"].max ??
                                            Date.now() + PADDING_TIME;
                                    rsiChart.update("none");
                                }
                            }
                            isSyncing = false;
                        },
                    },
                },
            },
        },
    });
    setTradesChart(chart);
    if (activeRange !== null) {
        updateTimeAnnotations(now, activeRange);
    }
    console.log("Trades chart initialized successfully");
    return chart;
}
export function initializeRSIChart(ctx) {
    if (rsiChart)
        return rsiChart;
    if (typeof Chart === "undefined") {
        console.error("Chart.js not loaded - cannot initialize RSI chart");
        throw new Error("Chart.js is not loaded");
    }
    const now = Date.now();
    let initialMin, initialMax;
    if (activeRange !== null) {
        initialMin = now - activeRange;
        initialMax = now + PADDING_TIME;
    }
    else {
        initialMin = now - 90 * 60000;
        initialMax = now + PADDING_TIME;
    }
    try {
        const chart = new Chart(ctx, {
            type: "line",
            data: {
                datasets: [
                    {
                        label: "RSI",
                        parsing: { xAxisKey: "time", yAxisKey: "rsi" },
                        data: [],
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
                        ticks: { source: "data" },
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
                            label: (context) => {
                                const data = context.raw;
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
                            onPanComplete: ({ chart }) => {
                                if (isSyncing)
                                    return;
                                isSyncing = true;
                                if (tradesChart &&
                                    tradesChart.options &&
                                    tradesChart.options.scales &&
                                    chart.options &&
                                    chart.options.scales) {
                                    if (tradesChart.options.scales["x"] &&
                                        chart.options.scales["x"]) {
                                        tradesChart.options.scales["x"].min =
                                            chart.options.scales["x"].min ??
                                                Date.now() - 90 * 60000;
                                        tradesChart.options.scales["x"].max =
                                            chart.options.scales["x"].max ??
                                                Date.now() + PADDING_TIME;
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
                            onZoomComplete: ({ chart }) => {
                                if (isSyncing)
                                    return;
                                isSyncing = true;
                                if (tradesChart &&
                                    tradesChart.options &&
                                    tradesChart.options.scales &&
                                    chart.options &&
                                    chart.options.scales) {
                                    if (tradesChart.options.scales["x"] &&
                                        chart.options.scales["x"]) {
                                        tradesChart.options.scales["x"].min =
                                            chart.options.scales["x"].min ??
                                                Date.now() - 90 * 60000;
                                        tradesChart.options.scales["x"].max =
                                            chart.options.scales["x"].max ??
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
        setRsiChart(chart);
        if (activeRange !== null) {
            updateRSITimeAnnotations(now, activeRange);
        }
        else {
            updateRSITimeAnnotations((initialMin + initialMax) / 2, (initialMax - initialMin) / 2 + PADDING_TIME);
        }
        return chart;
    }
    catch (error) {
        console.error("Failed to create RSI chart:", error);
        return null;
    }
}
export function safeUpdateRSIChart(rsiData) {
    if (!rsiChart) {
        console.warn("RSI chart not initialized, attempting to reinitialize...");
        const rsiCtx = rsiCanvas?.getContext("2d") || null;
        if (rsiCtx) {
            const newChart = initializeRSIChart(rsiCtx);
            if (!newChart) {
                console.error("Failed to reinitialize RSI chart");
                return false;
            }
        }
        else {
            console.error("Cannot reinitialize RSI chart - canvas context unavailable");
            return false;
        }
    }
    if (rsiChart &&
        rsiChart.data &&
        rsiChart.data.datasets &&
        rsiChart.data.datasets[0]) {
        rsiChart.data.datasets[0].data = rsiData;
        rsiChart.update("none");
        return true;
    }
    console.error("Failed to update RSI chart - chart structure invalid");
    return false;
}
function getRSIColor(context) {
    const data = context.raw;
    if (!data || typeof data.rsi !== "number")
        return "rgba(102, 102, 102, 1)";
    const rsi = data.rsi;
    if (rsi >= RSI_OVERBOUGHT)
        return "rgba(255, 0, 0, 1)";
    if (rsi <= RSI_OVERSOLD)
        return "rgba(0, 255, 0, 1)";
    return "rgba(102, 102, 102, 1)";
}
function getRSIBackgroundColor(context) {
    const data = context.raw;
    if (!data || typeof data.rsi !== "number")
        return "rgba(102, 102, 102, 0.1)";
    const rsi = data.rsi;
    if (rsi >= RSI_OVERBOUGHT)
        return "rgba(255, 0, 0, 0.1)";
    if (rsi <= RSI_OVERSOLD)
        return "rgba(0, 255, 0, 0.1)";
    return "rgba(102, 102, 102, 0.1)";
}
export function initializeOrderBookChart(ctx) {
    if (orderBookChart)
        return orderBookChart;
    if (typeof Chart === "undefined") {
        throw new Error("Chart.js is not loaded");
    }
    const labels = [];
    const askData = [];
    const bidData = [];
    const askColors = [];
    const bidColors = [];
    orderBookData.priceLevels.forEach((level) => {
        const basePrice = level.price;
        const priceStr = basePrice.toFixed(2);
        labels.push(`${priceStr}_ask`);
        askData.push(level.ask);
        bidData.push(null);
        askColors.push("rgba(255, 0, 0, 0.5)");
        bidColors.push("rgba(0, 0, 0, 0)");
        labels.push(`${priceStr}_bid`);
        askData.push(null);
        bidData.push(level.bid);
        askColors.push("rgba(0, 0, 0, 0)");
        bidColors.push("rgba(0, 128, 0, 0.5)");
    });
    const chart = new Chart(ctx, {
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
                        callback: (value) => Math.abs(value),
                    },
                },
                y: {
                    title: { display: true, text: "Price (USDT)" },
                    offset: true,
                    reverse: true,
                    ticks: {
                        callback: function (_value, index) {
                            const label = this.getLabelForValue(index);
                            if (label && label.includes("_ask")) {
                                return label.split("_")[0];
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
                        label: function (context) {
                            const label = context.label || "";
                            const isAsk = label.includes("_ask");
                            const isBid = label.includes("_bid");
                            const priceStr = label.split("_")[0] ?? "";
                            const price = parseFloat(priceStr);
                            const level = orderBookData.priceLevels.find((l) => Math.abs(l.price - price) < 0.001);
                            if (!level)
                                return "";
                            let tooltipText = "";
                            if (isAsk && level.ask > 0) {
                                tooltipText = `Ask: ${level.ask} LTC at ${price.toFixed(2)}`;
                            }
                            else if (isBid && level.bid > 0) {
                                tooltipText = `Bid: ${level.bid} LTC at ${price.toFixed(2)}`;
                            }
                            else {
                                return "";
                            }
                            if (level.depletionRatio &&
                                level.depletionRatio > 0) {
                                const depletionPercent = (level.depletionRatio * 100).toFixed(1);
                                const depletionVelocity = level.depletionVelocity
                                    ? level.depletionVelocity.toFixed(1)
                                    : "0.0";
                                tooltipText += `\nDepletion: ${depletionPercent}% (${depletionVelocity} LTC/sec)`;
                                if (level.depletionRatio >= 0.7) {
                                    tooltipText += " 🔥 HIGH";
                                }
                                else if (level.depletionRatio >= DEPLETION_RATIO_LOW) {
                                    tooltipText += " ⚠️ MEDIUM";
                                }
                            }
                            return tooltipText;
                        },
                        title: function (context) {
                            const label = context[0]?.label || "";
                            const priceStr = label.split("_")[0] ?? "";
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
function getDepletionColor(volume, depletionRatio, side, theme) {
    if (volume <= 0)
        return "rgba(0, 0, 0, 0)";
    const depletionEnabled = typeof getDepletionVisualizationEnabled === "function"
        ? getDepletionVisualizationEnabled()
        : true;
    const baseColors = {
        ask: theme === "dark"
            ? [COLOR_RED_FULL, COLOR_RED_MEDIUM, COLOR_RED_MEDIUM]
            : [COLOR_RED_FULL, COLOR_RED_LOW, COLOR_RED_LOW],
        bid: theme === "dark"
            ? [COLOR_RED_MEDIUM, COLOR_GREEN_FULL, COLOR_RED_MEDIUM]
            : [COLOR_RED_LOW, COLOR_GREEN_MEDIUM, COLOR_RED_LOW],
    };
    const [r, g, b] = baseColors[side] || [0, 0, 0];
    let baseOpacity = theme === "dark"
        ? Math.min(volume / VOLUME_NORMALIZER_DARK, VOLUME_OPACITY_MAX)
        : Math.min(volume / VOLUME_NORMALIZER_LIGHT, COLOR_ALPHA_FULL);
    if (depletionEnabled && depletionRatio > 0) {
        if (depletionRatio < DEPLETION_RATIO_LOW) {
            baseOpacity = Math.max(baseOpacity, VOLUME_OPACITY_LOW);
        }
        else if (depletionRatio < DEPLETION_RATIO_MEDIUM) {
            baseOpacity = Math.max(baseOpacity, VOLUME_OPACITY_MEDIUM);
        }
        else {
            baseOpacity = Math.max(baseOpacity, VOLUME_OPACITY_HIGH);
        }
    }
    return `rgba(${r}, ${g}, ${b}, ${Math.max(baseOpacity, VOLUME_OPACITY_MIN)})`;
}
function updateOrderBookBorderColors(theme) {
    if (!orderBookChart)
        return;
    const datasets = orderBookChart.data.datasets;
    if (!datasets || datasets.length < 2)
        return;
    const borderOpacity = theme === "dark" ? COLOR_ALPHA_STRONG : COLOR_ALPHA_MEDIUM;
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
export function updateOrderBookBarColors(theme) {
    if (!orderBookChart || !orderBookData)
        return;
    const datasets = orderBookChart.data.datasets;
    if (!datasets || datasets.length < 2)
        return;
    const askColors = [];
    const bidColors = [];
    orderBookData.priceLevels.forEach((level) => {
        const askOpacity = theme === "dark"
            ? Math.min((level.ask ?? 0) / ORDER_BOOK_VOLUME_NORMALIZER_DARK, COLOR_ALPHA_MAX)
            : Math.min((level.ask ?? 0) / ORDER_BOOK_VOLUME_NORMALIZER_LIGHT, COLOR_ALPHA_FULL);
        const askColor = level.ask
            ? theme === "dark"
                ? `rgba(${COLOR_RED_FULL}, ${COLOR_RED_MEDIUM}, ${COLOR_RED_MEDIUM}, ${Math.max(askOpacity, VOLUME_OPACITY_MIN)})`
                : `rgba(${COLOR_RED_FULL}, ${COLOR_RED_LOW}, ${COLOR_RED_LOW}, ${askOpacity})`
            : "rgba(0, 0, 0, 0)";
        const bidOpacity = theme === "dark"
            ? Math.min((level.bid ?? 0) / ORDER_BOOK_VOLUME_NORMALIZER_DARK, COLOR_ALPHA_MAX)
            : Math.min((level.bid ?? 0) / ORDER_BOOK_VOLUME_NORMALIZER_LIGHT, COLOR_ALPHA_FULL);
        const bidColor = level.bid
            ? theme === "dark"
                ? `rgba(${COLOR_RED_MEDIUM}, ${COLOR_GREEN_FULL}, ${COLOR_RED_MEDIUM}, ${Math.max(bidOpacity, VOLUME_OPACITY_MIN)})`
                : `rgba(${COLOR_RED_LOW}, ${COLOR_GREEN_MEDIUM}, ${COLOR_RED_LOW}, ${bidOpacity})`
            : "rgba(0, 0, 0, 0)";
        askColors.push(askColor);
        bidColors.push("rgba(0, 0, 0, 0)");
        askColors.push("rgba(0, 0, 0, 0)");
        bidColors.push(bidColor);
    });
    if (datasets[0]) {
        datasets[0].backgroundColor = askColors;
    }
    if (datasets[1]) {
        datasets[1].backgroundColor = bidColors;
    }
    updateOrderBookBorderColors(theme);
}
function validateDepletionLevel(level, midPrice, currentTime) {
    if (!level || typeof level.price !== "number") {
        console.warn("⚠️ Depletion validation: Invalid level data", level);
        return false;
    }
    const priceDeviation = Math.abs(level.price - midPrice) / midPrice;
    if (priceDeviation > PRICE_DEVIATION_THRESHOLD) {
        console.warn(`⚠️ Depletion validation: Price ${level.price.toFixed(4)} too far from mid price ${midPrice.toFixed(4)} (${(priceDeviation * 100).toFixed(2)}% deviation)`);
        return false;
    }
    const depletionRatio = level.depletionRatio;
    if (depletionRatio !== undefined && depletionRatio !== null) {
        if (depletionRatio < 0 || depletionRatio > 1) {
            console.warn(`⚠️ Depletion validation: Invalid depletion ratio ${depletionRatio} for price ${level.price.toFixed(4)}`);
            return false;
        }
    }
    const hasOriginalBidVolume = Boolean(level.originalBidVolume && level.originalBidVolume > 0);
    const hasOriginalAskVolume = Boolean(level.originalAskVolume && level.originalAskVolume > 0);
    if (depletionRatio !== undefined &&
        depletionRatio !== null &&
        depletionRatio > 0) {
        if (!hasOriginalBidVolume && !hasOriginalAskVolume) {
            console.warn(`⚠️ Depletion validation: Missing original volume data for depleted level at ${level.price.toFixed(4)}`);
            return false;
        }
    }
    if (level.timestamp && currentTime - level.timestamp > 10 * 60 * 1000) {
        console.warn(`⚠️ Depletion validation: Stale data for price ${level.price.toFixed(4)} (${Math.round((currentTime - level.timestamp) / 60000)} minutes old)`);
        return false;
    }
    return true;
}
export function updateOrderBookDisplay(data) {
    if (!orderBookChart) {
        return;
    }
    const labels = [];
    const askData = [];
    const bidData = [];
    const priceLevels = data.priceLevels || [];
    const currentTime = Date.now();
    const midPrice = data.midPrice || 0;
    const validLevels = [];
    const invalidLevels = [];
    priceLevels.forEach((level) => {
        if (validateDepletionLevel(level, midPrice, currentTime)) {
            validLevels.push(level);
        }
        else {
            invalidLevels.push(level);
        }
    });
    if (invalidLevels.length > 0) {
        console.log(`📊 Depletion validation: ${validLevels.length} valid, ${invalidLevels.length} invalid levels filtered`);
    }
    const maxLevels = 50;
    const sortedLevels = validLevels.sort((a, b) => a.price - b.price);
    let midIndex = 0;
    let minDiff = Infinity;
    for (let i = 0; i < sortedLevels.length; i++) {
        const level = sortedLevels[i];
        if (!level)
            continue;
        const diff = Math.abs(level.price - midPrice);
        if (diff < minDiff) {
            minDiff = diff;
            midIndex = i;
        }
    }
    const halfLevels = Math.floor(maxLevels / 2);
    const startIndex = Math.max(0, midIndex - halfLevels);
    const endIndex = Math.min(sortedLevels.length, startIndex + maxLevels);
    const displayLevels = sortedLevels.slice(startIndex, endIndex);
    const currentTheme = getCurrentTheme();
    const actualTheme = currentTheme === "system" ? getSystemTheme() : currentTheme;
    const askColors = [];
    const bidColors = [];
    const depletionLabels = [];
    displayLevels.forEach((level) => {
        const priceStr = level.price.toFixed(2);
        const depletionRatio = level.depletionRatio || 0;
        const depletionVelocity = level.depletionVelocity || 0;
        const askColor = getDepletionColor(level.ask || 0, depletionRatio, "ask", actualTheme);
        const bidColor = getDepletionColor(level.bid || 0, depletionRatio, "bid", actualTheme);
        labels.push(`${priceStr}_ask`);
        askData.push(level.ask || 0);
        bidData.push(null);
        askColors.push(askColor);
        bidColors.push("rgba(0, 0, 0, 0)");
        const depletionInfo = depletionRatio > 0
            ? ` (${(depletionRatio * 100).toFixed(1)}% depleted, ${depletionVelocity.toFixed(1)} LTC/sec)`
            : "";
        depletionLabels.push(`${priceStr}_ask${depletionInfo}`);
        labels.push(`${priceStr}_bid`);
        askData.push(null);
        bidData.push(level.bid || 0);
        askColors.push("rgba(0, 0, 0, 0)");
        bidColors.push(bidColor);
        depletionLabels.push(`${priceStr}_bid${depletionInfo}`);
    });
    if (orderBookChart?.data && orderBookChart.data.datasets.length >= 2) {
        const chart = orderBookChart;
        chart.data.labels =
            depletionLabels;
        chart.data.datasets[0].data = askData;
        chart.data.datasets[1].data = bidData;
        chart.data.datasets[0].backgroundColor = askColors;
        chart.data.datasets[1].backgroundColor = bidColors;
    }
    updateOrderBookBorderColors(actualTheme);
    scheduleOrderBookUpdate();
}
export function addAnomalyChartLabel(anomaly) {
    if (!tradesChart)
        return;
    const now = anomaly.timestamp || anomaly.detectedAt || Date.now();
    if (!tradesChart.options.plugins)
        tradesChart.options.plugins = {};
    if (!tradesChart.options.plugins.annotation) {
        tradesChart.options.plugins.annotation = { annotations: {} };
    }
    const annotations = tradesChart.options.plugins.annotation.annotations;
    if (annotations === undefined) {
        throw new Error("annotations is undefined.");
    }
    annotations[`anomaly.${now}`] = {
        type: "label",
        xValue: anomaly.timestamp ?? anomaly.detectedAt ?? now,
        yValue: anomaly.price ?? 0,
        content: `${getAnomalyIcon(anomaly.type)}`,
        backgroundColor: anomaly.severity === "critical"
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
    tradesChart.update("none");
}
export function handleSupportResistanceLevel(levelData) {
    if (!tradesChart || !levelData.data)
        return;
    const level = levelData.data;
    supportResistanceLevels.unshift(level);
    if (supportResistanceLevels.length > maxSupportResistanceLevels) {
        const oldestLevel = supportResistanceLevels.pop();
        removeSupportResistanceLevel(oldestLevel.id);
    }
    addSupportResistanceToChart(level);
    console.log("Support/Resistance level added to chart:", {
        id: level.id,
        price: level.price,
        type: level.type,
        strength: level.strength,
        touchCount: level.touchCount,
    });
}
function addSupportResistanceToChart(level) {
    if (!tradesChart)
        return;
    if (!tradesChart.options.plugins)
        tradesChart.options.plugins = {};
    if (!tradesChart.options.plugins.annotation) {
        tradesChart.options.plugins.annotation = { annotations: {} };
    }
    const annotations = tradesChart.options.plugins.annotation.annotations;
    if (annotations === undefined) {
        throw new Error("annotations is undefined.");
    }
    const levelId = `sr_level_${level.id}`;
    const isSupport = level.type === "support";
    const baseColor = isSupport ? "34, 197, 94" : "239, 68, 68";
    const alpha = Math.max(ZONE_ALPHA_MIN, Math.min(ZONE_ALPHA_MAX, level.strength));
    const now = Date.now();
    const startTime = level.firstDetected;
    const maxValidDuration = ZONE_DURATION_MAX_MS;
    const endTime = Math.min(now + maxValidDuration, level.lastTouched + maxValidDuration);
    const baseThickness = level.price * ZONE_BASE_THICKNESS_PERCENT;
    const strengthMultiplier = ZONE_STRENGTH_MULTIPLIER_BASE + level.strength * 2;
    const touchMultiplier = ZONE_STRENGTH_MULTIPLIER_BASE +
        Math.min(level.touchCount / ZONE_TOUCH_COUNT_NORMALIZER, ZONE_TOUCH_MULTIPLIER_MAX);
    const zoneHeight = baseThickness * strengthMultiplier * touchMultiplier;
    const annotation = {
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
    if (level.roleReversals?.length) {
        annotation.borderDash = [5, 5];
    }
    annotations[levelId] = annotation;
    const labelId = `sr_label_${level.id}`;
    annotations[labelId] = {
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
function removeSupportResistanceLevel(levelId) {
    if (!tradesChart)
        return;
    const annotations = tradesChart.options.plugins?.annotation?.annotations;
    if (!annotations)
        return;
    const barId = `sr_level_${levelId}`;
    const labelId = `sr_label_${levelId}`;
    delete annotations[barId];
    delete annotations[labelId];
    tradesChart.update("none");
}
export function checkSupportResistanceBreaches(tradePrice) {
    if (!supportResistanceLevels.length)
        return;
    supportResistanceLevels = supportResistanceLevels.filter((level) => {
        const zoneHeight = level.price *
            ZONE_BASE_THICKNESS_PERCENT *
            (ZONE_STRENGTH_MULTIPLIER_BASE + level.strength * 2) *
            (ZONE_STRENGTH_MULTIPLIER_BASE +
                Math.min(level.touchCount / ZONE_TOUCH_COUNT_NORMALIZER, ZONE_TOUCH_MULTIPLIER_MAX));
        const breachThreshold = zoneHeight * BREACH_THRESHOLD_MULTIPLIER;
        let isBreached = false;
        if (level.type === "support") {
            isBreached = tradePrice < level.price - breachThreshold;
        }
        else {
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
            return false;
        }
        return true;
    });
}
export function cleanupOldSupportResistanceLevels() {
    const cutoffTime = Date.now() - CLEANUP_TIME_MS;
    supportResistanceLevels = supportResistanceLevels.filter((level) => {
        if (level.lastTouched < cutoffTime) {
            removeSupportResistanceLevel(level.id);
            return false;
        }
        return true;
    });
}
export function handleZoneUpdate(updateData) {
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
export function handleZoneSignal(signalData) {
    const { zone, confidence, expectedDirection } = signalData;
    if (zone.type === "accumulation" || zone.type === "distribution") {
        console.log(`${zone.type} zone signal filtered out - zones draw but signals don't show`, zone.id);
        return;
    }
    const normalizedSignal = {
        id: `zone_${zone.id}_${Date.now()}`,
        type: `${zone.type}_zone_${signalData.signalType}`,
        price: zone.priceRange.center ??
            (zone.priceRange.min + zone.priceRange.max) / 2,
        time: Date.now(),
        side: expectedDirection === "up"
            ? "buy"
            : expectedDirection === "down"
                ? "sell"
                : "buy",
        confidence: confidence,
        zone: zone,
    };
    signalsList.unshift(normalizedSignal);
    if (signalsList.length > 50) {
        signalsList.splice(50);
    }
    renderSignalsList();
}
function createZoneBox(zone) {
    activeZones.set(zone.id, zone);
    if (activeZones.size > maxActiveZones) {
        const oldestZoneId = activeZones.keys().next().value ?? "";
        removeZoneBox(oldestZoneId);
    }
    addZoneToChart(zone);
}
function updateZoneBox(zone) {
    activeZones.set(zone.id, zone);
    if (tradesChart?.options?.plugins?.annotation?.annotations) {
        const tradesChartOptions = tradesChart.options;
        const annotation = tradesChartOptions.plugins?.annotation?.annotations[`zone_${zone.id}`];
        if (annotation) {
            if (zone.type === "hidden_liquidity" || zone.type === "iceberg") {
                const price = zone.priceRange.center ??
                    (zone.priceRange.min + zone.priceRange.max) / 2;
                annotation.yMin = price;
                annotation.yMax = price;
                annotation.borderColor = getZoneBorderColor(zone);
                if (zone.type === "iceberg" && zone.endTime) {
                    annotation.xMax = zone.endTime;
                }
            }
            else {
                annotation.yMin = zone.priceRange.min;
                annotation.yMax = zone.priceRange.max;
                annotation.backgroundColor = getZoneColor(zone);
                annotation.borderColor = getZoneBorderColor(zone);
            }
            if (annotation.label) {
                annotation.label.content = getZoneLabel(zone);
            }
            tradesChart.update("none");
        }
        else {
            addZoneToChart(zone);
        }
    }
}
function completeZoneBox(zone) {
    activeZones.set(zone.id, zone);
    if (tradesChart?.options?.plugins?.annotation?.annotations) {
        const tradesChartOptions = tradesChart.options;
        const annotation = tradesChartOptions.plugins?.annotation?.annotations[`zone_${zone.id}`];
        if (annotation) {
            if (zone.type === "hidden_liquidity" || zone.type === "iceberg") {
                annotation.borderColor = getCompletedZoneBorderColor(zone);
                annotation.borderWidth = 2;
                annotation.borderDash =
                    zone.type === "iceberg" ? [3, 3] : [5, 5];
                if (zone.type === "iceberg" && zone.endTime) {
                    annotation.xMax = zone.endTime;
                }
            }
            else {
                annotation.backgroundColor = getCompletedZoneColor(zone);
                annotation.borderColor = getCompletedZoneBorderColor(zone);
                annotation.borderWidth = 2;
                annotation.borderDash = [5, 5];
            }
            if (annotation.label) {
                annotation.label.content = getZoneLabel(zone) + " ✓";
            }
            tradesChart.update("none");
            setTimeout(() => {
                removeZoneBox(zone.id);
            }, 30 * 60 * 1000);
        }
    }
}
function removeZoneBox(zoneId) {
    activeZones.delete(zoneId);
    if (tradesChart?.options?.plugins?.annotation?.annotations) {
        const tradesChartOptions = tradesChart.options;
        delete tradesChartOptions.plugins?.annotation?.annotations[`zone_${zoneId}`];
        tradesChart.update("none");
    }
}
function addZoneToChart(zone) {
    if (!tradesChart?.options?.plugins?.annotation?.annotations)
        return;
    console.log("Adding zone to chart:", zone.type, zone.id, zone.priceRange);
    const tradesChartOptions = tradesChart.options;
    let zoneAnnotation;
    if (zone.type === "hidden_liquidity" || zone.type === "iceberg") {
        const price = zone.priceRange.center ??
            (zone.priceRange.min + zone.priceRange.max) / 2;
        const endTime = zone.endTime || Date.now() + 5 * 60 * 1000;
        const zoneAnnotationBase = {
            type: "line",
            xMin: zone.startTime ?? Date.now(),
            xMax: endTime,
            yMin: price,
            yMax: price,
            borderColor: getZoneBorderColor(zone),
            borderWidth: zone.type === "iceberg" ? 3 : 2,
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
            enter: (_ctx, event) => {
                showZoneTooltip(zone, event);
            },
            leave: () => {
                hideZoneTooltip();
            },
        };
        if (zone.type === "iceberg") {
            zoneAnnotationBase.borderDash = [8, 4];
        }
        zoneAnnotation = zoneAnnotationBase;
    }
    else {
        zoneAnnotation = {
            type: "box",
            xMin: zone.startTime ?? Date.now(),
            xMax: Date.now() + 5 * 60 * 1000,
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
            enter: (_ctx, event) => {
                showZoneTooltip(zone, event);
            },
            leave: () => {
                hideZoneTooltip();
            },
        };
    }
    if (tradesChartOptions.plugins?.annotation?.annotations) {
        tradesChartOptions.plugins.annotation.annotations[`zone_${zone.id}`] =
            zoneAnnotation;
    }
    tradesChart.update("none");
}
function getZoneColor(zone) {
    const alpha = Math.max(ZONE_ALPHA_MIN_PERCENT, zone.strength * ZONE_ALPHA_MAX_PERCENT);
    switch (zone.type) {
        case "accumulation":
            return `rgba(34, 197, 94, ${alpha})`;
        case "distribution":
            return `rgba(239, 68, 68, ${alpha})`;
        case "iceberg":
            return `rgba(59, 130, 246, ${alpha})`;
        case "spoofing":
            return `rgba(147, 51, 234, ${alpha})`;
        case "hidden_liquidity":
            return `rgba(245, 158, 11, ${alpha})`;
        default:
            return `rgba(107, 114, 128, ${alpha})`;
    }
}
function getZoneBorderColor(zone) {
    switch (zone.type) {
        case "accumulation":
            return "rgba(34, 197, 94, 0.8)";
        case "distribution":
            return "rgba(239, 68, 68, 0.8)";
        case "iceberg":
            return "rgba(59, 130, 246, 0.8)";
        case "spoofing":
            return "rgba(147, 51, 234, 0.8)";
        case "hidden_liquidity":
            return "rgba(245, 158, 11, 0.8)";
        default:
            return "rgba(107, 114, 128, 0.8)";
    }
}
function getCompletedZoneColor(zone) {
    switch (zone.type) {
        case "accumulation":
            return "rgba(34, 197, 94, 0.2)";
        case "distribution":
            return "rgba(239, 68, 68, 0.2)";
        case "iceberg":
            return "rgba(59, 130, 246, 0.2)";
        case "spoofing":
            return "rgba(147, 51, 234, 0.2)";
        case "hidden_liquidity":
            return "rgba(245, 158, 11, 0.2)";
        default:
            return "rgba(107, 114, 128, 0.2)";
    }
}
function getCompletedZoneBorderColor(zone) {
    switch (zone.type) {
        case "accumulation":
            return "rgba(34, 197, 94, 0.5)";
        case "distribution":
            return "rgba(239, 68, 68, 0.5)";
        case "iceberg":
            return "rgba(59, 130, 246, 0.5)";
        case "spoofing":
            return "rgba(147, 51, 234, 0.5)";
        case "hidden_liquidity":
            return "rgba(245, 158, 11, 0.5)";
        default:
            return "rgba(107, 114, 128, 0.5)";
    }
}
function getZoneTextColor(zone) {
    if (zone.type === "accumulation") {
        return "rgba(21, 128, 61, 1)";
    }
    else {
        return "rgba(153, 27, 27, 1)";
    }
}
function getZoneLabel(zone) {
    const strengthPercent = Math.round(zone.strength * 100);
    const completionPercent = Math.round((zone.completion ?? 0) * 100);
    let typeLabel;
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
            typeLabel = zone.type.toUpperCase();
    }
    return `${typeLabel} ${strengthPercent}% (${completionPercent}%)`;
}
function showZoneTooltip(zone, event) {
    const tooltip = document.createElement("div");
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
    const duration = Math.round((Date.now() - (zone.startTime ?? Date.now())) / 60000);
    const volumeFormatted = zone.totalVolume?.toLocaleString() || "N/A";
    let zoneColor;
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
    let tooltipContent = `<div style="font-weight: bold; margin-bottom: 6px; color: ${zoneColor};">
            ${getZoneLabel(zone)} ZONE
        </div>
        <div>Price Range: ${zone.priceRange.min.toFixed(4)} - ${zone.priceRange.max.toFixed(4)}</div>`;
    if (zone.priceRange.center) {
        tooltipContent += `<div>Center: ${zone.priceRange.center.toFixed(4)}</div>`;
    }
    tooltipContent += `
        <div>Strength: ${(zone.strength * 100).toFixed(1)}%</div>
        <div>Completion: ${((zone.completion ?? 0) * 100).toFixed(1)}%</div>`;
    if (zone.confidence !== undefined) {
        tooltipContent += `<div>Confidence: ${(zone.confidence * 100).toFixed(1)}%</div>`;
    }
    tooltipContent += `<div>Duration: ${duration}m</div>`;
    if (zone.type === "iceberg") {
        tooltipContent += `
            <div style="margin-top: 6px; border-top: 1px solid #333; padding-top: 6px;">
                <div>Refills: ${zone.refillCount || "N/A"}</div>
                <div>Volume: ${volumeFormatted}</div>
                <div>Avg Size: ${zone.averagePieceSize?.toFixed(2) || "N/A"}</div>
                <div>Side: ${zone.side?.toUpperCase() || "N/A"}</div>
            </div>`;
    }
    else if (zone.type === "spoofing") {
        tooltipContent += `
            <div style="margin-top: 6px; border-top: 1px solid #333; padding-top: 6px;">
                <div>Type: ${zone.spoofType || "N/A"}</div>
                <div>Wall Size: ${zone.wallSize?.toFixed(2) || "N/A"}</div>
                <div>Canceled: ${zone.canceled?.toFixed(2) || "N/A"}</div>
                <div>Executed: ${zone.executed?.toFixed(2) || "N/A"}</div>
                <div>Side: ${zone.side?.toUpperCase() || "N/A"}</div>
            </div>`;
    }
    else if (zone.type === "hidden_liquidity") {
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
    tooltip.style.left = `${event.clientX + 15}px`;
    tooltip.style.top = `${event.clientY + 15}px`;
}
function hideZoneTooltip() {
    const tooltip = document.getElementById("zoneTooltip");
    if (tooltip) {
        tooltip.remove();
    }
}
function getAnomalyIcon(type) {
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
export function cleanupOldZones() {
    const cutoffTime = Date.now() - 60 * 60 * 1000;
    for (const [zoneId, zone] of activeZones) {
        if (!zone.isActive && zone.endTime && zone.endTime < cutoffTime) {
            removeZoneBox(zoneId);
        }
    }
}
