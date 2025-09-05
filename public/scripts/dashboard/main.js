import * as Config from "../config.js";
import { tradesCanvas, orderBookCanvas, rsiCanvas, rangeSelector, signalFilters, activeRange, PADDING_FACTOR, NINETHY_MINUTES, } from "./state.js";
import { cleanupOldSupportResistanceLevels, cleanupOldZones, } from "./charts.js";
import { TradeChart } from "./tradeChart.js";
import { OrderBookChart } from "./orderBookChart.js";
import { RsiChart } from "./rsiChart.js";
import { HTMLActions } from "./htmlActions.js";
import { renderSignalsList, updateTradeDelayIndicator } from "./render.js";
import { toggleDepletionVisualization, updateDepletionToggleButton, } from "./theme.js";
import { TradeWebSocket } from "../websocket.js";
import { MessageType } from "../types.js";
if (!tradesCanvas) {
    throw new Error("Trades chart canvas not found");
}
const tradesCtx = tradesCanvas ? tradesCanvas.getContext("2d") : null;
if (!tradesCtx) {
    throw new Error("Could not get 2D context for trades chart");
}
let now = Date.now();
let initialMin, initialMax;
if (activeRange !== null) {
    const padding = Math.ceil(activeRange / PADDING_FACTOR);
    initialMin = now - activeRange;
    initialMax = now + padding;
}
else {
    initialMin = now - 90 * 60000;
    initialMax = Math.ceil(NINETHY_MINUTES / PADDING_FACTOR);
}
const tradeChart = new TradeChart(tradesCtx, initialMin, initialMax, now);
tradeChart.activeRange = activeRange;
let lastTradeUpdate = now;
if (!orderBookCanvas) {
    throw new Error("Order book chart canvas not found");
}
const orderBookCtx = orderBookCanvas.getContext("2d");
if (!orderBookCtx) {
    throw new Error("Could not get 2D context for order book chart");
}
const orderBookChart = new OrderBookChart(orderBookCtx);
if (!rsiCanvas) {
    throw new Error("RSIchart canvas not found");
}
const rsiCtx = rsiCanvas?.getContext("2d");
if (!rsiCtx) {
    throw new Error("Could not get 2D context for RSI chart");
}
const rsiChart = new RsiChart(rsiCtx, initialMin, initialMax, now);
rsiChart.activeRange = activeRange;
const htmlActions = new HTMLActions(tradeChart, rsiChart, activeRange, rangeSelector);
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
function initialize() {
    try {
        htmlActions.restoreTheme();
        htmlActions.restoreColumnDimensions();
        htmlActions.restoreAnomalyFilters();
        htmlActions.restoreTimeRange();
        htmlActions.setRangeSelector();
        htmlActions.setupColumnResizing();
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
    const resetLayoutBtn = document.getElementById("resetLayout");
    if (resetLayoutBtn) {
        resetLayoutBtn.addEventListener("click", () => {
            if (confirm("Reset all dashboard settings to default? This will clear your saved layout, filter, and time range preferences.")) {
                htmlActions.resetAllSettings();
            }
        });
    }
    const themeToggleBtn = document.getElementById("themeToggle");
    if (themeToggleBtn) {
        themeToggleBtn.addEventListener("click", htmlActions.toggleTheme);
        htmlActions.updateThemeToggleButton();
    }
    const depletionToggleBtn = document.getElementById("depletionToggle");
    if (depletionToggleBtn) {
        depletionToggleBtn.addEventListener("click", toggleDepletionVisualization);
        updateDepletionToggleButton();
    }
    if (window.matchMedia) {
        const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
        mediaQuery.addEventListener("change", () => {
            const currentTheme = htmlActions.getCurrentTheme();
            if (currentTheme === "system") {
                htmlActions.updateChartTheme(htmlActions.getSystemTheme());
            }
        });
    }
    setInterval(cleanupOldSupportResistanceLevels, 300000);
    setInterval(cleanupOldZones, 300000);
    setInterval(renderSignalsList, 60000);
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
            const trade = message
                .data;
            if (tradeChart) {
                tradeChart.addTrade(trade);
                const now = Date.now();
                if (now - lastTradeUpdate > 2000 && tradeChart && rsiChart) {
                    htmlActions.updateUnifiedTimeRange(now);
                    lastTradeUpdate = now;
                }
            }
            break;
        case "orderbook":
            const orderBook = message
                .data;
            if (isValidOrderBookData(orderBook)) {
                orderBookChart.orderBookData = orderBook;
                orderBookChart.updateOrderBookDisplay();
            }
            else {
                console.error("Invalid orderbook data");
            }
            break;
        case "rsi":
            const rsiDataPoint = message
                .data;
            if (rsiChart) {
                rsiChart.addPoint(rsiDataPoint);
            }
            break;
        case "error":
            const errorData = message.data;
            console.error("WebSocket error:", errorData.message);
            break;
        case "stats":
            break;
        default:
            break;
    }
}
const tradeWebsocket = new TradeWebSocket({
    url: Config.WEBSOCKET_URL,
    onBacklog: (backLog) => {
        tradeChart.processTradeBacklog(backLog);
        htmlActions.updateUnifiedTimeRange(Date.now());
    },
    onRsiBacklog: (backLog) => {
        rsiChart.processBacklog(backLog);
        htmlActions.updateUnifiedTimeRange(Date.now());
    },
    onMessage: (message) => {
        if (isValidWebSocketMessage(message)) {
            handleMessage(message);
        }
    },
});
function isValidWebSocketMessage(data) {
    if (!data || typeof data !== "object")
        return false;
    const msg = data;
    if (typeof msg["type"] !== "string")
        return false;
    if (typeof msg["now"] !== "number")
        return false;
    return Object.values(MessageType).includes(msg["type"]);
}
document.addEventListener("DOMContentLoaded", initialize);
document.addEventListener("DOMContentLoaded", () => {
    const filterBox = document.querySelector(".anomaly-filter");
    if (filterBox) {
        filterBox
            .querySelectorAll("input[type=checkbox]")
            .forEach((box) => {
            box.addEventListener("change", () => {
                if (box.checked)
                    htmlActions.anomalyFilters.add(box.value);
                else
                    htmlActions.anomalyFilters.delete(box.value);
                htmlActions.renderAnomalyList();
                htmlActions.saveAnomalyFilters();
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
        tradeChart.cleanOldTrades();
        rsiChart.cleanOldData();
        htmlActions.updateUnifiedTimeRange(Date.now());
    }, 10 * 60 * 1000);
});
tradeWebsocket.connect();
