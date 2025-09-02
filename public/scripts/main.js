import { tradesCanvas, orderBookCanvas, rsiCanvas, rangeSelector, anomalyFilters, signalFilters, trades, anomalyList, signalsList, rsiData, activeRange, dedupTolerance, rsiChart, tradesChart, PADDING_TIME, MAX_RSI_DATA, setRuntimeConfig, } from "./dashboard/state.js";
import { initializeTradesChart, initializeRSIChart, initializeOrderBookChart, cleanupOldSupportResistanceLevels, cleanupOldZones, updateYAxisBounds, updateTimeAnnotations, updateRSITimeAnnotations, scheduleTradesChartUpdate, checkSupportResistanceBreaches, buildSignalLabel, handleSupportResistanceLevel, handleZoneUpdate, handleZoneSignal, updateOrderBookDisplay, safeUpdateRSIChart, } from "./dashboard/charts.js";
import { renderAnomalyList, renderSignalsList, updateTradeDelayIndicator, showSignalBundleBadge, } from "./dashboard/render.js";
import { restoreColumnWidths, restoreAnomalyFilters, restoreTimeRange, restoreVerticalLayout, resetAllSettings, saveAnomalyFilters, } from "./dashboard/persistence.js";
import { setupColumnResizing, setRange } from "./dashboard/ui.js";
import { getCurrentTheme, getSystemTheme, updateChartTheme, restoreTheme, toggleTheme, updateThemeToggleButton, toggleDepletionVisualization, updateDepletionToggleButton, } from "./dashboard/theme.js";
import { TradeWebSocket } from "./websocket.js";
import { isValidTradeData } from "./dashboard/types.js";
function isValidSignalData(data) {
    return (typeof data.id === "string" &&
        typeof data.type === "string" &&
        typeof data.time === "number" &&
        typeof data.price === "number" &&
        (data.side === "buy" || data.side === "sell"));
}
function isValidAnomalyData(data) {
    return (typeof data.type === "string" &&
        typeof data.detectedAt === "number" &&
        ["low", "medium", "high", "critical", "info"].includes(data.severity) &&
        typeof data.affectedPriceRange === "object" &&
        data.affectedPriceRange !== null &&
        typeof data.affectedPriceRange.min === "number" &&
        typeof data.affectedPriceRange.max === "number" &&
        typeof data.recommendedAction === "string" &&
        typeof data.details === "object");
}
function isValidOrderBookData(data) {
    return (Array.isArray(data.priceLevels) &&
        data.priceLevels.every((level) => typeof level.price === "number" &&
            typeof level.bid === "number" &&
            typeof level.ask === "number"));
}
function isValidRSIData(data) {
    return (typeof data.time === "number" &&
        typeof data.rsi === "number" &&
        data.rsi >= 0 &&
        data.rsi <= 100);
}
function isValidSupportResistanceData(data) {
    return (typeof data.id === "string" &&
        typeof data.price === "number" &&
        (data.type === "support" || data.type === "resistance") &&
        typeof data.strength === "number" &&
        typeof data.touchCount === "number" &&
        typeof data.firstDetected === "number" &&
        typeof data.lastTouched === "number" &&
        typeof data.volumeAtLevel === "number");
}
function isValidZoneUpdateData(data) {
    return (typeof data.updateType === "string" &&
        typeof data.zone === "object" &&
        data.zone !== null &&
        typeof data.significance === "number" &&
        typeof data.detectorId === "string" &&
        typeof data.timestamp === "number");
}
function isValidZoneSignalData(data) {
    return (typeof data.signalType === "string" &&
        typeof data.zone === "object" &&
        data.zone !== null &&
        typeof data.actionType === "string" &&
        typeof data.confidence === "number" &&
        (data.expectedDirection === "up" ||
            data.expectedDirection === "down") &&
        typeof data.detectorId === "string" &&
        typeof data.timestamp === "number");
}
let unifiedMin = 0;
let unifiedMax = 0;
let orderBookData = {
    priceLevels: [],
    bestBid: 0,
    bestAsk: 0,
    spread: 0,
    midPrice: 0,
    totalBidVolume: 0,
    totalAskVolume: 0,
    imbalance: 0,
    timestamp: 0,
};
const messageQueue = [];
let isProcessingQueue = false;
function updateUnifiedTimeRange(latestTime) {
    if (activeRange !== null) {
        unifiedMin = latestTime - activeRange;
        unifiedMax = latestTime + PADDING_TIME;
        if (tradesChart &&
            tradesChart.options &&
            tradesChart.options.scales &&
            tradesChart.options.scales.x) {
            tradesChart.options.scales.x.min = unifiedMin;
            tradesChart.options.scales.x.max = unifiedMax;
            updateTimeAnnotations(latestTime, activeRange);
        }
        if (rsiChart &&
            rsiChart.options &&
            rsiChart.options.scales &&
            rsiChart.options.scales.x) {
            rsiChart.options.scales.x.min = unifiedMin;
            rsiChart.options.scales.x.max = unifiedMax;
            updateRSITimeAnnotations(latestTime, activeRange);
        }
    }
}
function createTrade(time, price, quantity, orderType) {
    return {
        x: time,
        y: price,
        quantity: quantity,
        orderType: orderType,
    };
}
function initialize() {
    restoreTheme();
    restoreColumnWidths();
    restoreAnomalyFilters();
    restoreTimeRange();
    restoreVerticalLayout();
    if (!tradesCanvas) {
        console.error("Trades chart canvas not found");
        return;
    }
    if (!orderBookCanvas) {
        console.error("Order book chart canvas not found");
        return;
    }
    const tradesCtx = tradesCanvas.getContext("2d");
    if (!tradesCtx) {
        console.error("Could not get 2D context for trades chart");
        return;
    }
    const orderBookCtx = orderBookCanvas.getContext("2d");
    if (!orderBookCtx) {
        console.error("Could not get 2D context for order book chart");
        return;
    }
    const rsiCtx = rsiCanvas?.getContext("2d");
    if (!rsiCtx) {
        console.error("Could not get 2D context for RSI chart");
        return;
    }
    initializeTradesChart(tradesCtx);
    initializeOrderBookChart(orderBookCtx);
    initializeRSIChart(rsiCtx);
    console.log("Applying time range after chart initialization:", activeRange === null ? "ALL" : `${activeRange / 60000} minutes`);
    setRange(activeRange);
    if (!rsiChart) {
        console.error("Failed to initialize RSI chart - WebSocket connection aborted");
        return;
    }
    if (!rsiChart ||
        !rsiChart.data ||
        !rsiChart.data.datasets) {
        console.error("RSI chart structure invalid after initialization - WebSocket connection aborted");
        return;
    }
    tradeWebsocket.connect();
    setupColumnResizing();
    if (rangeSelector) {
        rangeSelector.addEventListener("click", (e) => {
            const target = e.target;
            if (target.tagName === "BUTTON") {
                const range = target.getAttribute("data-range");
                if (rangeSelector) {
                    rangeSelector
                        .querySelectorAll("button")
                        .forEach((btn) => btn.classList.remove("active"));
                }
                target.classList.add("active");
                setRange(range === "all" ? null : range ? parseInt(range) : null);
            }
        });
    }
    else {
        console.warn("Range selector element not found");
    }
    const resetLayoutBtn = document.getElementById("resetLayout");
    if (resetLayoutBtn) {
        resetLayoutBtn.addEventListener("click", () => {
            if (confirm("Reset all dashboard settings to default? This will clear your saved layout, filter, and time range preferences.")) {
                resetAllSettings();
            }
        });
    }
    const themeToggleBtn = document.getElementById("themeToggle");
    if (themeToggleBtn) {
        themeToggleBtn.addEventListener("click", toggleTheme);
        updateThemeToggleButton();
    }
    const depletionToggleBtn = document.getElementById("depletionToggle");
    if (depletionToggleBtn) {
        depletionToggleBtn.addEventListener("click", toggleDepletionVisualization);
        updateDepletionToggleButton();
    }
    if (window.matchMedia) {
        const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
        mediaQuery.addEventListener("change", () => {
            const currentTheme = getCurrentTheme();
            if (currentTheme === "system") {
                updateChartTheme(getSystemTheme());
            }
        });
    }
    setInterval(cleanupOldSupportResistanceLevels, 300000);
    setInterval(cleanupOldZones, 300000);
    setInterval(renderSignalsList, 60000);
    processMessageQueue();
}
function processMessageQueue() {
    if (messageQueue.length === 0) {
        isProcessingQueue = false;
        return;
    }
    isProcessingQueue = true;
    const message = messageQueue.shift();
    try {
        if (message) {
            handleMessage(message);
        }
    }
    catch (error) {
        console.error("Error processing message from queue:", error);
    }
    if (messageQueue.length > 100) {
        setTimeout(() => processMessageQueue(), 10);
    }
    else if (messageQueue.length > 10) {
        setTimeout(() => requestAnimationFrame(processMessageQueue), 5);
    }
    else {
        requestAnimationFrame(processMessageQueue);
    }
}
function handleMessage(message) {
    if (!message) {
        console.warn("Received null or undefined message");
        return;
    }
    const receiveTime = Date.now();
    const messageTime = message.now ?? 0;
    const delay = receiveTime - messageTime;
    if (delay >= 0) {
        updateTradeDelayIndicator(delay);
    }
    switch (message.type) {
        case "pong":
            console.log("Received pong from server");
            break;
        case "backlog":
            const tradeBacklog = message.data;
            console.log(`${tradeBacklog.length} backlog trades received.`);
            trades.length = 0;
            for (const trade of tradeBacklog) {
                if (isValidTradeData(trade)) {
                    trades.push(createTrade(trade.time, trade.price, trade.quantity, trade.orderType));
                }
            }
            if (tradesChart) {
                const chartInstance = tradesChart;
                const chartData = chartInstance.data;
                if (chartData && chartData.datasets && chartData.datasets[0]) {
                    chartData.datasets[0].data = trades;
                }
            }
            if (trades.length > 0) {
                const latestTrade = trades[trades.length - 1];
                const latestTime = latestTrade.x;
                const latestPrice = latestTrade.y;
                if (tradesChart) {
                    const chartInstance = tradesChart;
                    const chartOptions = chartInstance.options;
                    const plugins = chartOptions.plugins;
                    const annotation = plugins?.annotation;
                    const annotations = annotation?.annotations;
                    if (annotations) {
                        const line = annotations["lastPriceLine"];
                        if (line) {
                            line.yMin = latestPrice;
                            line.yMax = latestPrice;
                        }
                    }
                }
                updateUnifiedTimeRange(latestTime);
                updateYAxisBounds();
            }
            scheduleTradesChartUpdate();
            break;
        case "signal_backlog":
            const backlogSignals = message.data;
            console.log(`${backlogSignals.length} backlog signals received.`);
            for (const signal of backlogSignals.reverse()) {
                if (isValidSignalData(signal)) {
                    const normalizedSignal = signal;
                    signalsList.unshift(normalizedSignal);
                    const signalLabel = buildSignalLabel(normalizedSignal);
                    const signalId = signal.id;
                    if (tradesChart) {
                        const chartInstance = tradesChart;
                        const chartOptions = chartInstance.options;
                        const plugins = chartOptions.plugins;
                        const annotation = plugins?.annotation;
                        const annotations = annotation?.annotations;
                        if (annotations) {
                            annotations[signalId] = {
                                type: "label",
                                xValue: normalizedSignal.time,
                                yValue: normalizedSignal.price,
                                content: signalLabel,
                                backgroundColor: "rgba(90, 50, 255, 0.4)",
                                color: "white",
                                font: {
                                    size: 12,
                                    family: "monospace",
                                },
                                borderRadius: 4,
                                padding: 8,
                                position: {
                                    x: "center",
                                    y: "center",
                                },
                            };
                        }
                    }
                }
            }
            if (signalsList.length > 50) {
                signalsList.length = 50;
            }
            renderSignalsList();
            if (tradesChart) {
                tradesChart.update("none");
            }
            console.log(`${backlogSignals.length} backlog signals added to chart and list`);
            break;
        case "rsi_backlog":
            const rsiBacklog = message.data;
            console.log(`${rsiBacklog.length} RSI backlog data received.`);
            const backlogData = [];
            for (const rsiPoint of rsiBacklog) {
                if (isValidRSIData(rsiPoint)) {
                    backlogData.push(rsiPoint);
                }
            }
            if (backlogData.length > 0) {
                rsiData.length = 0;
                rsiData.push(...backlogData);
                if (rsiChart) {
                    const rsiChartInstance = rsiChart;
                    if (rsiChartInstance.data &&
                        rsiChartInstance.data.datasets &&
                        rsiChartInstance.data.datasets[0]) {
                        rsiChartInstance.data.datasets[0].data = rsiData.map((point) => ({
                            x: point.time,
                            y: point.rsi,
                        }));
                        rsiChartInstance.update("none");
                    }
                }
                console.log(`${backlogData.length} RSI backlog points loaded and chart updated`);
            }
            break;
        case "trade":
            const trade = message.data;
            if (isValidTradeData(trade)) {
                trades.push(createTrade(trade.time, trade.price, trade.quantity, trade.orderType));
                if (tradesChart) {
                    const chartInstance = tradesChart;
                    const chartData = chartInstance.data;
                    if (chartData &&
                        chartData.datasets &&
                        chartData.datasets[0]) {
                        chartData.datasets[0].data = trades;
                    }
                }
                if (tradesChart) {
                    const chartInstance = tradesChart;
                    const chartOptions = chartInstance.options;
                    const plugins = chartOptions.plugins;
                    const annotation = plugins?.annotation;
                    const annotations = annotation?.annotations;
                    if (annotations) {
                        const line = annotations["lastPriceLine"];
                        if (line) {
                            line.yMin = trade.price;
                            line.yMax = trade.price;
                        }
                    }
                }
                updateUnifiedTimeRange(trade.time);
                updateYAxisBounds();
                checkSupportResistanceBreaches(trade.price);
                scheduleTradesChartUpdate();
            }
            break;
        case "signal":
            const signal = message.data;
            if (isValidSignalData(signal)) {
                const label = buildSignalLabel(signal);
                const id = signal.id;
                signalsList.unshift(signal);
                if (signalsList.length > 50) {
                    signalsList.length = 50;
                }
                renderSignalsList();
                if (tradesChart) {
                    const chartInstance = tradesChart;
                    const chartOptions = chartInstance.options;
                    const plugins = chartOptions.plugins;
                    const annotation = plugins?.annotation;
                    const annotations = annotation?.annotations;
                    if (annotations) {
                        annotations[id] = {
                            type: "label",
                            xValue: signal.time,
                            yValue: signal.price,
                            content: label,
                            backgroundColor: "rgba(90, 50, 255, 0.5)",
                            color: "white",
                            font: {
                                size: 12,
                                family: "monospace",
                            },
                            borderRadius: 4,
                            padding: 8,
                            position: {
                                x: "center",
                                y: "center",
                            },
                        };
                        const MAX_ANNOTATIONS = 100;
                        const annotationKeys = Object.keys(annotations);
                        if (annotationKeys.length > MAX_ANNOTATIONS) {
                            const keysToRemove = annotationKeys
                                .filter((key) => key !== "lastPriceLine")
                                .sort()
                                .slice(0, annotationKeys.length - MAX_ANNOTATIONS);
                            keysToRemove.forEach((key) => {
                                delete annotations[key];
                            });
                            console.log(`Cleaned up ${keysToRemove.length} old signal annotations`);
                        }
                        tradesChart.update("none");
                    }
                }
                console.log("Signal label added:", label);
            }
            break;
        case "signal_bundle":
            const signalBundle = message.data;
            if (Array.isArray(signalBundle) && signalBundle.length) {
                const filtered = signalBundle.filter((s) => {
                    if (isValidSignalData(s)) {
                        const last = signalsList[0];
                        if (!last)
                            return true;
                        const diff = Math.abs(s.price - last.price);
                        return diff > last.price * dedupTolerance;
                    }
                    return false;
                });
                filtered.forEach((signal) => {
                    signalsList.unshift(signal);
                    const label = buildSignalLabel(signal);
                    if (tradesChart) {
                        const chartInstance = tradesChart;
                        const chartOptions = chartInstance.options;
                        const plugins = chartOptions.plugins;
                        const annotation = plugins?.annotation;
                        const annotations = annotation?.annotations;
                        if (annotations) {
                            annotations[signal.id] = {
                                type: "label",
                                xValue: signal.time,
                                yValue: signal.price,
                                content: label,
                                backgroundColor: "rgba(90, 50, 255, 0.5)",
                                color: "white",
                                font: {
                                    size: 12,
                                    family: "monospace",
                                },
                                borderRadius: 4,
                                padding: 8,
                                position: {
                                    x: "center",
                                    y: "center",
                                },
                            };
                        }
                    }
                });
                if (signalsList.length > 50) {
                    signalsList.length = 50;
                }
                renderSignalsList();
                if (tradesChart) {
                    tradesChart.update("none");
                }
                showSignalBundleBadge(filtered);
            }
            break;
        case "anomaly":
            const anomaly = message.data;
            if (isValidAnomalyData(anomaly)) {
                anomalyList.unshift(anomaly);
                if (anomalyList.length > 100) {
                    anomalyList.length = 100;
                }
                renderAnomalyList();
                if (anomaly.severity === "high" ||
                    anomaly.severity === "critical") {
                }
            }
            break;
        case "rsi":
            const rsiDataPoint = message.data;
            if (isValidRSIData(rsiDataPoint)) {
                rsiData.push(rsiDataPoint);
                if (rsiData.length > MAX_RSI_DATA) {
                    rsiData.shift();
                }
                if (!window.rsiUpdateTimeout) {
                    window.rsiUpdateTimeout = setTimeout(() => {
                        const updateSuccess = safeUpdateRSIChart([...rsiData]);
                        if (window.rsiUpdateTimeout) {
                            clearTimeout(window.rsiUpdateTimeout);
                            delete window.rsiUpdateTimeout;
                        }
                        if (!updateSuccess) {
                            console.error("Failed to update RSI chart with batched data");
                        }
                    }, 100);
                }
            }
            else {
                console.warn("Invalid RSI data received:", rsiDataPoint);
            }
            break;
        case "orderbook":
            const orderBook = message.data;
            if (isValidOrderBookData(orderBook)) {
                orderBookData = orderBook;
                if (!window.orderbookInitialized) {
                    console.log("📊 Orderbook initialized:", {
                        levels: orderBookData.priceLevels.length,
                        midPrice: orderBookData.midPrice,
                    });
                    window.orderbookInitialized = true;
                }
                updateOrderBookDisplay(orderBookData);
            }
            else {
                console.error("Invalid orderbook data");
            }
            break;
        case "runtimeConfig":
            const config = message.data;
            if (config && typeof config === "object") {
                setRuntimeConfig(config);
            }
            break;
        case "supportResistanceLevel":
            const level = message.data;
            if (isValidSupportResistanceData(level)) {
                handleSupportResistanceLevel({ data: level });
            }
            break;
        case "zoneUpdate":
            const zoneUpdate = message.data;
            if (isValidZoneUpdateData(zoneUpdate)) {
                const zoneData = {
                    id: zoneUpdate.zone.id,
                    type: zoneUpdate.zone.type,
                    priceRange: {
                        min: zoneUpdate.zone.priceRange.min,
                        max: zoneUpdate.zone.priceRange.max,
                        center: zoneUpdate.zone.priceRange.center,
                    },
                    volume: zoneUpdate.zone.volume,
                    timestamp: zoneUpdate.zone.lastUpdate,
                    strength: zoneUpdate.zone.strength,
                    startTime: zoneUpdate.zone.startTime,
                    confidence: zoneUpdate.zone.confidence,
                };
                handleZoneUpdate({
                    updateType: zoneUpdate.updateType,
                    zone: zoneData,
                    significance: zoneUpdate.significance,
                });
            }
            break;
        case "zoneSignal":
            const zoneSignal = message.data;
            if (isValidZoneSignalData(zoneSignal)) {
                const zoneData = {
                    id: zoneSignal.zone.id,
                    type: zoneSignal.zone.type,
                    priceRange: {
                        min: zoneSignal.zone.priceRange.min,
                        max: zoneSignal.zone.priceRange.max,
                        center: zoneSignal.zone.priceRange.center,
                    },
                    volume: zoneSignal.zone.volume,
                    timestamp: zoneSignal.zone.lastUpdate,
                    strength: zoneSignal.zone.strength,
                    startTime: zoneSignal.zone.startTime,
                    confidence: zoneSignal.zone.confidence,
                };
                handleZoneSignal({
                    signalType: zoneSignal.signalType,
                    zone: zoneData,
                    actionType: zoneSignal.actionType,
                    confidence: zoneSignal.confidence,
                    urgency: "medium",
                    expectedDirection: zoneSignal.expectedDirection,
                });
            }
            break;
        case "error":
            const errorData = message.data;
            console.error("WebSocket error:", errorData.message);
            break;
        case "test":
            console.log("Test message received:", message.data);
            break;
        case "stats":
            console.log("Stats received:", message.data);
            break;
        case "connection_status":
            console.log("Connection status:", message.data);
            break;
        default:
            console.warn("Unknown message type:", message.type);
            break;
    }
}
const tradeWebsocket = new TradeWebSocket({
    url: "ws://localhost:3001",
    maxTrades: 50000,
    maxReconnectAttempts: 10,
    reconnectDelay: 1000,
    pingInterval: 10000,
    pongWait: 5000,
    onBacklog: (backLog) => {
        if (Array.isArray(backLog)) {
            console.log(`${backLog.length} backlog trades received.`);
            trades.length = 0;
            for (const trade of backLog) {
                if (isValidTradeData(trade)) {
                    const tradeObj = trade;
                    trades.push(createTrade(tradeObj.time, tradeObj.price, tradeObj.quantity, tradeObj.orderType));
                }
            }
            if (tradesChart) {
                const chartInstance = tradesChart;
                const chartData = chartInstance.data;
                if (chartData && chartData.datasets && chartData.datasets[0]) {
                    chartData.datasets[0].data = [
                        ...trades,
                    ];
                }
            }
            if (trades.length > 0) {
                const latestTrade = trades[trades.length - 1];
                const latestTime = latestTrade.x;
                const latestPrice = latestTrade.y;
                if (tradesChart) {
                    const chartInstance = tradesChart;
                    const chartOptions = chartInstance.options;
                    const plugins = chartOptions.plugins;
                    const annotation = plugins?.annotation;
                    const annotations = annotation?.annotations;
                    if (annotations) {
                        const line = annotations["lastPriceLine"];
                        if (line) {
                            line.yMin = latestPrice;
                            line.yMax = latestPrice;
                        }
                    }
                }
                updateUnifiedTimeRange(latestTime);
                updateYAxisBounds();
            }
            scheduleTradesChartUpdate();
        }
    },
    onMessage: (message) => {
        if (typeof message === "object" && message !== null) {
            const msg = message;
            if (typeof msg["type"] === "string" &&
                typeof msg["data"] !== "undefined") {
                const convertedMessage = {
                    type: msg["type"],
                    data: msg["data"],
                    now: typeof msg["now"] === "number"
                        ? msg["now"]
                        : Date.now(),
                };
                if (messageQueue.length < 1000) {
                    messageQueue.push(convertedMessage);
                    if (!isProcessingQueue) {
                        processMessageQueue();
                    }
                }
                else {
                    console.warn("Message queue full (1000 messages), dropping message to prevent memory exhaustion");
                }
            }
        }
    },
});
document.addEventListener("DOMContentLoaded", initialize);
document.addEventListener("DOMContentLoaded", () => {
    const filterBox = document.querySelector(".anomaly-filter");
    if (filterBox) {
        filterBox
            .querySelectorAll("input[type=checkbox]")
            .forEach((box) => {
            box.addEventListener("change", () => {
                if (box.checked)
                    anomalyFilters.add(box.value);
                else
                    anomalyFilters.delete(box.value);
                renderAnomalyList();
                saveAnomalyFilters();
            });
        });
    }
    const signalFilterBox = document.querySelector(".signals-filter");
    if (signalFilterBox) {
        signalFilterBox
            .querySelectorAll("input[type=checkbox]")
            .forEach((box) => {
            box.addEventListener("change", () => {
                if (box.checked)
                    signalFilters.add(box.value);
                else
                    signalFilters.delete(box.value);
                renderSignalsList();
            });
        });
    }
    const signalsListElement = document.getElementById("signalsList");
    if (signalsListElement) {
        signalsListElement.addEventListener("mouseenter", (e) => {
            const target = e.target;
            if (target.closest(".signal-row")) {
                const signalRow = target.closest(".signal-row");
                const signalId = signalRow.dataset["signalId"];
                if (tradesChart && signalId) {
                    const chartInstance = tradesChart;
                    const chartOptions = chartInstance.options;
                    const plugins = chartOptions.plugins;
                    const annotation = plugins?.annotation;
                    const annotations = annotation?.annotations;
                    if (annotations) {
                        Object.keys(annotations).forEach((key) => {
                            if (key !== signalId &&
                                key !== "lastPriceLine") {
                                const annotation = annotations[key];
                                if (annotation &&
                                    annotation.backgroundColor) {
                                    annotation.backgroundColor =
                                        annotation.backgroundColor.replace(/[\d\.]+\)$/, "0.1)");
                                }
                            }
                        });
                        chartInstance.update("none");
                    }
                }
            }
        }, true);
        signalsListElement.addEventListener("mouseleave", (e) => {
            const target = e.target;
            if (target.closest(".signal-row")) {
                if (tradesChart) {
                    const chartInstance = tradesChart;
                    const chartOptions = chartInstance.options;
                    const plugins = chartOptions.plugins;
                    const annotation = plugins?.annotation;
                    const annotations = annotation?.annotations;
                    if (annotations) {
                        Object.keys(annotations).forEach((key) => {
                            if (key !== "lastPriceLine") {
                                const annotation = annotations[key];
                                if (annotation &&
                                    annotation.backgroundColor) {
                                    annotation.backgroundColor =
                                        annotation.backgroundColor.replace(/[\d\.]+\)$/, "0.5)");
                                }
                            }
                        });
                        chartInstance.update("none");
                    }
                }
            }
        }, true);
    }
    setInterval(() => {
        const TRADE_RETENTION_MINUTES = 90;
        const cutoffTime = Date.now() - TRADE_RETENTION_MINUTES * 60 * 1000;
        const originalLength = trades.length;
        let tradesToRemoveCount = trades.findIndex((t) => t.x >= cutoffTime);
        if (tradesToRemoveCount === -1 && originalLength > 0) {
            tradesToRemoveCount = originalLength;
        }
        else if (tradesToRemoveCount === -1) {
            tradesToRemoveCount = 0;
        }
        if (tradesToRemoveCount > 1000) {
            console.log(`Starting trade cleanup: ${tradesToRemoveCount} old trades detected`);
            const keptTrades = trades.slice(tradesToRemoveCount);
            trades.length = 0;
            trades.push(...keptTrades);
            if (tradesChart) {
                const chartInstance = tradesChart;
                const chartData = chartInstance.data;
                if (chartData &&
                    chartData.datasets &&
                    chartData.datasets[0]) {
                    chartData.datasets[0].data = trades;
                    scheduleTradesChartUpdate();
                }
            }
            const removedCount = originalLength - trades.length;
            console.log(`Trade cleanup complete: filtered ${removedCount} old trades, ${trades.length} remaining`);
        }
    }, 30 * 60 * 1000);
});
tradeWebsocket.connect();
