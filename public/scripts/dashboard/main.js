import { Chart, registerables, } from "chart.js";
import "chartjs-adapter-date-fns";
Chart.register(...registerables);
import { tradesCanvas, orderBookCanvas, rsiCanvas, anomalyFilters, signalFilters, trades, activeRange, PADDING_TIME, } from "./state.js";
import { initializeOrderBookChart, cleanupOldSupportResistanceLevels, cleanupOldZones, } from "./charts.js";
import { initializeTradesChart, createTrade, processTradeBacklog, isValidTradeData, updateYAxisBounds, updateTimeAnnotations, } from "./tradeChart.js";
import { renderAnomalyList, renderSignalsList, updateTradeDelayIndicator, } from "./render.js";
import { restoreColumnWidths, restoreAnomalyFilters, restoreTimeRange, restoreVerticalLayout, resetAllSettings, saveAnomalyFilters, } from "./persistence.js";
import { setupColumnResizing, } from "./ui.js";
import { getCurrentTheme, getSystemTheme, updateChartTheme, restoreTheme, toggleTheme, updateThemeToggleButton, toggleDepletionVisualization, updateDepletionToggleButton, } from "./theme.js";
import { TradeWebSocket } from "../websocket.js";
let tradeChart;
let lastTradeUpdate = 0;
export function isValidSignalData(data) {
    return (typeof data.id === "string" &&
        typeof data.type === "string" &&
        typeof data.time === "number" &&
        typeof data.price === "number" &&
        (data.side === "buy" || data.side === "sell"));
}
export function isValidAnomalyData(data) {
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
export function isValidOrderBookData(data) {
    return (Array.isArray(data.priceLevels) &&
        data.priceLevels.every((level) => typeof level.price === "number" &&
            typeof level.bid === "number" &&
            typeof level.ask === "number"));
}
export function isValidRSIData(data) {
    return (typeof data.time === "number" &&
        typeof data.rsi === "number" &&
        data.rsi >= 0 &&
        data.rsi <= 100);
}
export function isValidSupportResistanceData(data) {
    return (typeof data.id === "string" &&
        typeof data.price === "number" &&
        (data.type === "support" || data.type === "resistance") &&
        typeof data.strength === "number" &&
        typeof data.touchCount === "number" &&
        typeof data.firstDetected === "number" &&
        typeof data.lastTouched === "number" &&
        typeof data.volumeAtLevel === "number");
}
export function isValidZoneUpdateData(data) {
    return (typeof data.updateType === "string" &&
        typeof data.zone === "object" &&
        data.zone !== null &&
        typeof data.significance === "number" &&
        typeof data.detectorId === "string" &&
        typeof data.timestamp === "number");
}
export function isValidZoneSignalData(data) {
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
const messageQueue = [];
let isProcessingQueue = false;
function updateUnifiedTimeRange(latestTime, tradeChart) {
    if (activeRange !== null) {
        unifiedMin = latestTime - activeRange;
        unifiedMax = latestTime + PADDING_TIME;
        if (tradeChart &&
            tradeChart.options &&
            tradeChart.options.scales &&
            tradeChart.options.scales["x"]) {
            tradeChart.options.scales["x"].min = unifiedMin;
            tradeChart.options.scales["x"].max = unifiedMax;
            updateTimeAnnotations(tradeChart, latestTime, activeRange);
        }
    }
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
    try {
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
        initializeOrderBookChart(orderBookCtx);
        tradeChart = initializeTradesChart(tradesCtx, initialMin, initialMax, now);
        if (!tradeChart) {
            throw new Error("Failed to initialize Trade Chart.");
        }
    }
    catch (error) {
        console.error("Error in initializing charts: ", error);
        return;
    }
    try {
        tradeWebsocket.connect();
        console.log("Connected to Trade Websocket.");
    }
    catch (error) {
        console.error("Failed to connect to web socket.", error);
        return;
    }
    setupColumnResizing();
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
        requestAnimationFrame(processMessageQueue);
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
    requestAnimationFrame(processMessageQueue);
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
        case "trade":
            const trade = message.data;
            if (isValidTradeData(trade) &&
                tradeChart &&
                tradeChart.data &&
                tradeChart.data.datasets &&
                tradeChart.data.datasets[0] &&
                tradeChart.data.datasets[0].data) {
                const dataPoint = createTrade(trade.time, trade.price, trade.quantity, trade.orderType);
                tradeChart.data.datasets[0].data.push(dataPoint);
                const now = Date.now();
                if (now - lastTradeUpdate > 20 && tradeChart) {
                    updateUnifiedTimeRange(now, tradeChart);
                    updateYAxisBounds(tradeChart);
                    tradeChart.update("none");
                    lastTradeUpdate = now;
                }
            }
            break;
        case "error":
            const errorData = message.data;
            console.error("WebSocket error:", errorData.message);
            break;
        case "stats":
            break;
        case "connection_status":
            console.log("Connection status:", message.data);
            break;
        default:
            break;
    }
}
const tradeWebsocket = new TradeWebSocket({
    url: "ws://localhost:3001",
    maxTrades: 10000,
    maxReconnectAttempts: 10,
    reconnectDelay: 1000,
    pingInterval: 10000,
    pongWait: 5000,
    onBacklog: (backLog) => {
        const trades = processTradeBacklog(backLog);
        if (tradeChart) {
            const chartInstance = tradeChart;
            const chartData = chartInstance.data;
            if (chartData && chartData.datasets && chartData.datasets[0]) {
                chartData.datasets[0].data = [
                    ...trades,
                ];
                updateYAxisBounds(tradeChart);
                updateUnifiedTimeRange(Date.now(), tradeChart);
            }
            tradeChart.update("none");
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
                messageQueue.push(convertedMessage);
                if (!isProcessingQueue) {
                    processMessageQueue();
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
            }
        }, true);
        signalsListElement.addEventListener("mouseleave", (e) => {
            const target = e.target;
            if (target.closest(".signal-row")) {
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
            const removedCount = originalLength - trades.length;
            console.log(`Trade cleanup complete: filtered ${removedCount} old trades, ${trades.length} remaining`);
        }
    }, 30 * 60 * 1000);
});
tradeWebsocket.connect();
