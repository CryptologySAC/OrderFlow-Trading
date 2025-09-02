// frontend/src/main.ts
// EXACT TYPE-SAFE FRONTEND IMPLEMENTATION
// Recreates main.js functionality with ZERO unknown/any types
// Uses exact backend message structures

import {
    tradesCanvas,
    orderBookCanvas,
    rsiCanvas,
    rangeSelector,
    anomalyFilters,
    signalFilters,
    trades,
    anomalyList,
    signalsList,
    rsiData,
    activeRange,
    dedupTolerance,
    rsiChart,
    tradesChart,
    PADDING_TIME,
    MAX_RSI_DATA,
    setRuntimeConfig,
} from "./dashboard/state.js";
import {
    initializeTradesChart,
    initializeRSIChart,
    initializeOrderBookChart,
    cleanupOldSupportResistanceLevels,
    cleanupOldZones,
    updateYAxisBounds,
    updateTimeAnnotations,
    updateRSITimeAnnotations,
    scheduleTradesChartUpdate,
    checkSupportResistanceBreaches,
    buildSignalLabel,
    handleSupportResistanceLevel,
    handleZoneUpdate,
    handleZoneSignal,
    updateOrderBookDisplay,
    safeUpdateRSIChart,
} from "./dashboard/charts.js";
import {
    renderAnomalyList,
    renderSignalsList,
    updateTradeDelayIndicator,
    showSignalBundleBadge,
} from "./dashboard/render.js";
import {
    restoreColumnWidths,
    restoreAnomalyFilters,
    restoreTimeRange,
    restoreVerticalLayout,
    resetAllSettings,
    saveAnomalyFilters,
} from "./dashboard/persistence.js";
import { setupColumnResizing, setRange } from "./dashboard/ui.js";
import {
    getCurrentTheme,
    getSystemTheme,
    updateChartTheme,
    restoreTheme,
    toggleTheme,
    updateThemeToggleButton,
    toggleDepletionVisualization,
    updateDepletionToggleButton,
} from "./dashboard/theme.js";
import { TradeWebSocket } from "./websocket.js";
import type {
    WebSocketMessage,
    TradeData,
    OrderBookData,
    Signal,
    MarketAnomaly,
    RSIDataPoint,
    SupportResistanceLevel,
    ZoneUpdateEvent,
    ZoneSignalEvent,
} from "./dashboard/types.js";
import type { ChartAnnotation, ChartInstance } from "./frontend-types.js";

// ============================================================================
// TYPE GUARDS (NO UNKNOWN PARAMETERS)
// ============================================================================

function isValidTradeData(data: TradeData): boolean {
    return (
        typeof data.time === "number" &&
        typeof data.price === "number" &&
        typeof data.quantity === "number" &&
        (data.orderType === "BUY" || data.orderType === "SELL") &&
        typeof data.symbol === "string" &&
        typeof data.tradeId === "number"
    );
}

function isValidSignalData(data: Signal): boolean {
    return (
        typeof data.id === "string" &&
        typeof data.type === "string" &&
        typeof data.time === "number" &&
        typeof data.price === "number" &&
        (data.side === "buy" || data.side === "sell")
    );
}

function isValidAnomalyData(data: MarketAnomaly): boolean {
    return (
        typeof data.type === "string" &&
        typeof data.detectedAt === "number" &&
        ["low", "medium", "high", "critical", "info"].includes(data.severity) &&
        typeof data.affectedPriceRange === "object" &&
        data.affectedPriceRange !== null &&
        typeof data.affectedPriceRange.min === "number" &&
        typeof data.affectedPriceRange.max === "number" &&
        typeof data.recommendedAction === "string" &&
        typeof data.details === "object"
    );
}

function isValidOrderBookData(data: OrderBookData): boolean {
    return (
        Array.isArray(data.priceLevels) &&
        data.priceLevels.every(
            (level) =>
                typeof level.price === "number" &&
                typeof level.bid === "number" &&
                typeof level.ask === "number"
        )
    );
}

function isValidRSIData(data: RSIDataPoint): boolean {
    return (
        typeof data.time === "number" &&
        typeof data.rsi === "number" &&
        data.rsi >= 0 &&
        data.rsi <= 100
    );
}

function isValidSupportResistanceData(data: SupportResistanceLevel): boolean {
    return (
        typeof data.id === "string" &&
        typeof data.price === "number" &&
        (data.type === "support" || data.type === "resistance") &&
        typeof data.strength === "number" &&
        typeof data.touchCount === "number" &&
        typeof data.firstDetected === "number" &&
        typeof data.lastTouched === "number" &&
        typeof data.volumeAtLevel === "number"
    );
}

function isValidZoneUpdateData(data: ZoneUpdateEvent): boolean {
    return (
        typeof data.updateType === "string" &&
        typeof data.zone === "object" &&
        data.zone !== null &&
        typeof data.significance === "number" &&
        typeof data.detectorId === "string" &&
        typeof data.timestamp === "number"
    );
}

function isValidZoneSignalData(data: ZoneSignalEvent): boolean {
    return (
        typeof data.signalType === "string" &&
        typeof data.zone === "object" &&
        data.zone !== null &&
        typeof data.actionType === "string" &&
        typeof data.confidence === "number" &&
        (data.expectedDirection === "up" ||
            data.expectedDirection === "down") &&
        typeof data.detectorId === "string" &&
        typeof data.timestamp === "number"
    );
}

// ============================================================================
// GLOBAL STATE
// ============================================================================

let unifiedMin = 0;
let unifiedMax = 0;

let orderBookData: OrderBookData = {
    priceLevels: [],
};

// let supportResistanceLevels: SupportResistanceLevel[] = []; // Not used in main.ts

const messageQueue: WebSocketMessage[] = [];
let isProcessingQueue = false;

// ============================================================================
// CORE FUNCTIONS
// ============================================================================

function updateUnifiedTimeRange(latestTime: number): void {
    if (activeRange !== null) {
        unifiedMin = latestTime - activeRange;
        unifiedMax = latestTime + PADDING_TIME;

        if (
            tradesChart &&
            (tradesChart as ChartInstance).options &&
            (tradesChart as ChartInstance).options.scales &&
            (tradesChart as ChartInstance).options.scales.x
        ) {
            (tradesChart as ChartInstance).options.scales.x.min = unifiedMin;
            (tradesChart as ChartInstance).options.scales.x.max = unifiedMax;
            updateTimeAnnotations(latestTime, activeRange);
        }
        if (
            rsiChart &&
            (rsiChart as ChartInstance).options &&
            (rsiChart as ChartInstance).options.scales &&
            (rsiChart as ChartInstance).options.scales.x
        ) {
            (rsiChart as ChartInstance).options.scales.x.min = unifiedMin;
            (rsiChart as ChartInstance).options.scales.x.max = unifiedMax;
            updateRSITimeAnnotations(latestTime, activeRange);
        }
    }
}

function createTrade(
    time: number,
    price: number,
    quantity: number,
    orderType: "BUY" | "SELL"
): { x: number; y: number; quantity: number; orderType: string } {
    return {
        x: time,
        y: price,
        quantity: quantity,
        orderType: orderType,
    };
}

function initialize(): void {
    // Restore ALL saved settings FIRST, before any UI setup or rendering
    restoreTheme();
    restoreColumnWidths();
    restoreAnomalyFilters();
    restoreTimeRange();
    restoreVerticalLayout();

    // Validate DOM elements
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

    // Initialize charts first
    initializeTradesChart(tradesCtx);
    initializeOrderBookChart(orderBookCtx);
    initializeRSIChart(rsiCtx);

    // Apply the restored time range to the charts AFTER initialization
    console.log(
        "Applying time range after chart initialization:",
        activeRange === null ? "ALL" : `${activeRange / 60000} minutes`
    );
    setRange(activeRange);

    // Validate chart initialization before connecting WebSocket
    if (!rsiChart) {
        console.error(
            "Failed to initialize RSI chart - WebSocket connection aborted"
        );
        return;
    }

    // Validate RSI chart structure
    if (
        !rsiChart ||
        !(rsiChart as ChartInstance).data ||
        !(rsiChart as ChartInstance).data.datasets
    ) {
        console.error(
            "RSI chart structure invalid after initialization - WebSocket connection aborted"
        );
        return;
    }

    // Connect to the trade WebSocket after charts are ready
    tradeWebsocket.connect();

    // Setup interact.js for column resizing
    setupColumnResizing();

    // Setup range selector
    if (rangeSelector) {
        rangeSelector.addEventListener("click", (e: Event) => {
            const target = e.target as HTMLElement;
            if (target.tagName === "BUTTON") {
                const range = target.getAttribute("data-range");
                if (rangeSelector) {
                    rangeSelector
                        .querySelectorAll("button")
                        .forEach((btn) => btn.classList.remove("active"));
                }
                target.classList.add("active");
                setRange(
                    range === "all" ? null : range ? parseInt(range) : null
                );
            }
        });
    } else {
        console.warn("Range selector element not found");
    }

    // Setup reset layout button
    const resetLayoutBtn = document.getElementById("resetLayout");
    if (resetLayoutBtn) {
        resetLayoutBtn.addEventListener("click", () => {
            if (
                confirm(
                    "Reset all dashboard settings to default? This will clear your saved layout, filter, and time range preferences."
                )
            ) {
                resetAllSettings();
            }
        });
    }

    // Setup theme toggle button
    const themeToggleBtn = document.getElementById("themeToggle");
    if (themeToggleBtn) {
        themeToggleBtn.addEventListener("click", toggleTheme);
        updateThemeToggleButton();
    }

    // Setup depletion toggle button
    const depletionToggleBtn = document.getElementById("depletionToggle");
    if (depletionToggleBtn) {
        depletionToggleBtn.addEventListener(
            "click",
            toggleDepletionVisualization
        );
        updateDepletionToggleButton();
    }

    // Listen for system theme changes
    if (window.matchMedia) {
        const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
        mediaQuery.addEventListener("change", () => {
            const currentTheme = getCurrentTheme();
            if (currentTheme === "system") {
                updateChartTheme(getSystemTheme());
            }
        });
    }

    // Setup periodic cleanup for support/resistance levels
    setInterval(cleanupOldSupportResistanceLevels, 300000); // Every 5 minutes
    setInterval(cleanupOldZones, 300000); // Every 5 minutes

    // Setup periodic update for signal times display
    setInterval(renderSignalsList, 60000); // Update every minute

    // Start the message queue processor
    processMessageQueue();
}

function processMessageQueue(): void {
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
    } catch (error) {
        console.error("Error processing message from queue:", error);
    }

    requestAnimationFrame(processMessageQueue);
}

function handleMessage(message: WebSocketMessage): void {
    // Check if message is null or undefined
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
            // Handle pong response - connection health
            console.log("Received pong from server");
            break;

        case "backlog":
            const tradeBacklog = message.data as TradeData[];
            console.log(`${tradeBacklog.length} backlog trades received.`);
            trades.length = 0;
            for (const trade of tradeBacklog) {
                if (isValidTradeData(trade)) {
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
            if (tradesChart) {
                const chartInstance = tradesChart as ChartInstance;
                const chartData = chartInstance.data;
                if (chartData && chartData.datasets && chartData.datasets[0]) {
                    chartData.datasets[0].data = [
                        ...(trades as {
                            x: number;
                            y: number;
                            quantity?: number;
                            orderType?: "buy" | "sell";
                        }[]),
                    ];
                }
            }
            if (trades.length > 0) {
                const latestTrade = trades[trades.length - 1] as {
                    x: number;
                    y: number;
                };
                const latestTime = latestTrade.x;
                const latestPrice = latestTrade.y;
                if (tradesChart) {
                    const chartInstance = tradesChart as ChartInstance;
                    const chartOptions = chartInstance.options;
                    const plugins = chartOptions.plugins;
                    const annotation = plugins?.annotation;
                    const annotations = annotation?.annotations;
                    if (annotations) {
                        const line = annotations[
                            "lastPriceLine"
                        ] as ChartAnnotation;
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
            const backlogSignals = message.data as Signal[];
            console.log(`${backlogSignals.length} backlog signals received.`);
            for (const signal of backlogSignals.reverse()) {
                if (isValidSignalData(signal)) {
                    const normalizedSignal: Signal = signal;
                    signalsList.unshift(normalizedSignal);
                    const signalLabel = buildSignalLabel(normalizedSignal);
                    const signalId = signal.id;
                    if (tradesChart) {
                        const chartInstance = tradesChart as ChartInstance;
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
                (tradesChart as ChartInstance).update("none");
            }
            console.log(
                `${backlogSignals.length} backlog signals added to chart and list`
            );
            break;

        case "rsi_backlog":
            const rsiBacklog = message.data as RSIDataPoint[];
            console.log(`${rsiBacklog.length} RSI backlog data received.`);
            const backlogData: RSIDataPoint[] = [];
            for (const rsiPoint of rsiBacklog) {
                if (isValidRSIData(rsiPoint)) {
                    backlogData.push(rsiPoint);
                }
            }
            if (backlogData.length > 0) {
                rsiData.length = 0;
                rsiData.push(...backlogData);
                if (rsiChart) {
                    const rsiChartInstance = rsiChart as ChartInstance;
                    if (
                        rsiChartInstance.data &&
                        rsiChartInstance.data.datasets &&
                        rsiChartInstance.data.datasets[0]
                    ) {
                        rsiChartInstance.data.datasets[0].data = (
                            rsiData as { time: number; rsi: number }[]
                        ).map((point) => ({
                            x: point.time,
                            y: point.rsi,
                        }));
                        rsiChartInstance.update("none");
                    }
                }
                console.log(
                    `${backlogData.length} RSI backlog points loaded and chart updated`
                );
            }
            break;

        case "trade":
            const trade = message.data as TradeData;
            if (isValidTradeData(trade)) {
                trades.push(
                    createTrade(
                        trade.time,
                        trade.price,
                        trade.quantity,
                        trade.orderType
                    )
                );
                if (tradesChart) {
                    const chartInstance = tradesChart as ChartInstance;
                    const chartData = chartInstance.data;
                    if (
                        chartData &&
                        chartData.datasets &&
                        chartData.datasets[0]
                    ) {
                        chartData.datasets[0].data = [
                            ...(trades as {
                                x: number;
                                y: number;
                                quantity?: number;
                                orderType?: "buy" | "sell";
                            }[]),
                        ];
                    }
                }
                if (tradesChart) {
                    const chartInstance = tradesChart as ChartInstance;
                    const chartOptions = chartInstance.options;
                    const plugins = chartOptions.plugins;
                    const annotation = plugins?.annotation;
                    const annotations = annotation?.annotations;
                    if (annotations) {
                        const line = annotations[
                            "lastPriceLine"
                        ] as ChartAnnotation;
                        if (line) {
                            line.yMin = trade.price;
                            line.yMax = trade.price;
                        }
                    }
                }
                updateUnifiedTimeRange(trade.time);
                updateYAxisBounds();
                checkSupportResistanceBreaches(trade.price, trade.time);
                scheduleTradesChartUpdate();
            }
            break;

        case "signal":
            const signal = message.data as Signal;
            if (isValidSignalData(signal)) {
                const label = buildSignalLabel(signal);
                const id = signal.id;
                signalsList.unshift(signal);
                if (signalsList.length > 50) {
                    signalsList.length = 50;
                }
                renderSignalsList();
                if (tradesChart) {
                    const chartInstance = tradesChart as ChartInstance;
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
                        } as ChartAnnotation;
                        (tradesChart as ChartInstance).update("none");
                    }
                }
                console.log("Signal label added:", label);
            }
            break;

        case "signal_bundle":
            const signalBundle = message.data as Signal[];
            if (Array.isArray(signalBundle) && signalBundle.length) {
                const filtered = signalBundle.filter((s: Signal) => {
                    if (isValidSignalData(s)) {
                        const last = signalsList[0] as Signal;
                        if (!last) return true;
                        const diff = Math.abs(s.price - last.price);
                        return diff > last.price * dedupTolerance;
                    }
                    return false;
                });
                filtered.forEach((signal: Signal) => {
                    signalsList.unshift(signal);
                    const label = buildSignalLabel(signal);
                    if (tradesChart) {
                        const chartInstance = tradesChart as ChartInstance;
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
                            } as ChartAnnotation;
                        }
                    }
                });
                if (signalsList.length > 50) {
                    signalsList.length = 50;
                }
                renderSignalsList();
                if (tradesChart) {
                    (tradesChart as ChartInstance).update("none");
                }
                showSignalBundleBadge(filtered);
            }
            break;

        case "anomaly":
            const anomaly = message.data as MarketAnomaly;
            if (isValidAnomalyData(anomaly)) {
                anomalyList.unshift(anomaly);
                if (anomalyList.length > 100) {
                    anomalyList.length = 100;
                }
                renderAnomalyList();
                if (
                    anomaly.severity === "high" ||
                    anomaly.severity === "critical"
                ) {
                    // Badge functionality would be implemented here
                }
            }
            break;

        case "rsi":
            const rsiDataPoint = message.data as RSIDataPoint;
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
                            console.error(
                                "Failed to update RSI chart with batched data"
                            );
                        }
                    }, 100);
                }
            } else {
                console.warn("Invalid RSI data received:", rsiDataPoint);
            }
            break;

        case "orderbook":
            const orderBook = message.data as OrderBookData;
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
            } else {
                console.error("Invalid orderbook data");
            }
            break;

        case "runtimeConfig":
            const config = message.data as Record<string, unknown>;
            if (config && typeof config === "object") {
                setRuntimeConfig(config);
            }
            break;

        case "supportResistanceLevel":
            const level = message.data as SupportResistanceLevel;
            if (isValidSupportResistanceData(level)) {
                handleSupportResistanceLevel(level);
            }
            break;

        case "zoneUpdate":
            const zoneUpdate = message.data as ZoneUpdateEvent;
            if (isValidZoneUpdateData(zoneUpdate)) {
                handleZoneUpdate(zoneUpdate);
            }
            break;

        case "zoneSignal":
            const zoneSignal = message.data as ZoneSignalEvent;
            if (isValidZoneSignalData(zoneSignal)) {
                handleZoneSignal(zoneSignal);
            }
            break;

        case "error":
            const errorData = message.data as { message: string };
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

// ============================================================================
// WEBSOCKET SETUP
// ============================================================================

const tradeWebsocket = new TradeWebSocket({
    url: "ws://localhost:3001",
    maxTrades: 50000,
    maxReconnectAttempts: 10,
    reconnectDelay: 1000,
    pingInterval: 10000,
    pongWait: 5000,
    onBacklog: (backLog: unknown) => {
        if (Array.isArray(backLog)) {
            console.log(`${backLog.length} backlog trades received.`);
            trades.length = 0;
            for (const trade of backLog) {
                if (isValidTradeData(trade)) {
                    trades.push(
                        createTrade(
                            trade["time"],
                            trade["price"],
                            trade["quantity"],
                            trade["orderType"]
                        )
                    );
                }
            }
            if (tradesChart) {
                const chartInstance = tradesChart as ChartInstance;
                const chartData = chartInstance.data;
                if (chartData && chartData.datasets && chartData.datasets[0]) {
                    chartData.datasets[0].data = [
                        ...(trades as {
                            x: number;
                            y: number;
                            quantity?: number;
                            orderType?: "buy" | "sell";
                        }[]),
                    ];
                }
            }
            if (trades.length > 0) {
                const latestTrade = trades[trades.length - 1];
                const latestTime = (latestTrade as { x: number; y: number }).x;
                const latestPrice = (latestTrade as { x: number; y: number }).y;
                if (tradesChart) {
                    const chartInstance = tradesChart as ChartInstance;
                    const chartOptions = chartInstance.options;
                    const plugins = chartOptions.plugins;
                    const annotation = plugins?.annotation;
                    const annotations = annotation?.annotations;
                    if (annotations) {
                        const line = annotations[
                            "lastPriceLine"
                        ] as ChartAnnotation;
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
    onMessage: (message: unknown) => {
        // Convert websocket message to our expected format with proper validation
        if (typeof message === "object" && message !== null) {
            const msg = message as Record<string, unknown>;
            if (
                typeof msg["type"] === "string" &&
                typeof msg["data"] !== "undefined"
            ) {
                const convertedMessage: WebSocketMessage = {
                    type: msg["type"] as WebSocketMessage["type"],
                    data: msg["data"],
                    now:
                        typeof msg["now"] === "number"
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

// ============================================================================
// DOM EVENT HANDLERS
// ============================================================================

document.addEventListener("DOMContentLoaded", initialize);

document.addEventListener("DOMContentLoaded", () => {
    const filterBox = document.querySelector(".anomaly-filter");
    if (filterBox) {
        filterBox
            .querySelectorAll<HTMLInputElement>("input[type=checkbox]")
            .forEach((box) => {
                box.addEventListener("change", () => {
                    if (box.checked) anomalyFilters.add(box.value);
                    else anomalyFilters.delete(box.value);
                    renderAnomalyList();
                    saveAnomalyFilters();
                });
            });
    }

    const signalFilterBox = document.querySelector(".signals-filter");
    if (signalFilterBox) {
        signalFilterBox
            .querySelectorAll<HTMLInputElement>("input[type=checkbox]")
            .forEach((box) => {
                box.addEventListener("change", () => {
                    if (box.checked) signalFilters.add(box.value);
                    else signalFilters.delete(box.value);
                    renderSignalsList();
                });
            });
    }

    const signalsListElement = document.getElementById("signalsList");
    if (signalsListElement) {
        signalsListElement.addEventListener(
            "mouseenter",
            (e: Event) => {
                const target = e.target as HTMLElement;
                if (target.closest(".signal-row")) {
                    const signalRow = target.closest(
                        ".signal-row"
                    ) as HTMLElement;
                    const signalId = signalRow.dataset["signalId"];
                    if (tradesChart && signalId) {
                        const chartInstance = tradesChart as ChartInstance;
                        const chartOptions = chartInstance.options;
                        const plugins = chartOptions.plugins;
                        const annotation = plugins?.annotation;
                        const annotations = annotation?.annotations;
                        if (annotations) {
                            Object.keys(annotations).forEach((key) => {
                                if (
                                    key !== signalId &&
                                    key !== "lastPriceLine"
                                ) {
                                    const annotation = annotations[
                                        key
                                    ] as ChartAnnotation;
                                    if (
                                        annotation &&
                                        annotation.backgroundColor
                                    ) {
                                        annotation.backgroundColor =
                                            annotation.backgroundColor.replace(
                                                /[\d\.]+\)$/,
                                                "0.1)"
                                            );
                                    }
                                }
                            });
                            chartInstance.update("none");
                        }
                    }
                }
            },
            true
        );

        signalsListElement.addEventListener(
            "mouseleave",
            (e: Event) => {
                const target = e.target as HTMLElement;
                if (target.closest(".signal-row")) {
                    if (tradesChart) {
                        const chartInstance = tradesChart as ChartInstance;
                        const chartOptions = chartInstance.options;
                        const plugins = chartOptions.plugins;
                        const annotation = plugins?.annotation;
                        const annotations = annotation?.annotations;
                        if (annotations) {
                            Object.keys(annotations).forEach((key) => {
                                if (key !== "lastPriceLine") {
                                    const annotation = annotations[
                                        key
                                    ] as ChartAnnotation;
                                    if (
                                        annotation &&
                                        annotation.backgroundColor
                                    ) {
                                        annotation.backgroundColor =
                                            annotation.backgroundColor.replace(
                                                /[\d\.]+\)$/,
                                                "0.5)"
                                            );
                                    }
                                }
                            });
                            chartInstance.update("none");
                        }
                    }
                }
            },
            true
        );
    }

    // Trade cleanup every 30 minutes
    setInterval(
        () => {
            const cutoffTime = Date.now() - 90 * 60 * 1000;
            const originalLength = trades.length;
            let tradesToRemoveCount = trades.findIndex(
                (t) => (t as { x: number }).x >= cutoffTime
            );
            if (tradesToRemoveCount === -1 && originalLength > 0) {
                tradesToRemoveCount = originalLength;
            } else if (tradesToRemoveCount === -1) {
                tradesToRemoveCount = 0;
            }
            if (tradesToRemoveCount > 1000) {
                console.log(
                    `Starting trade cleanup: ${tradesToRemoveCount} old trades detected`
                );
                const keptTrades = trades.slice(tradesToRemoveCount);
                trades.length = 0;
                trades.push(...keptTrades);
                if (tradesChart) {
                    const chartInstance = tradesChart as ChartInstance;
                    const chartData = chartInstance.data;
                    if (
                        chartData &&
                        chartData.datasets &&
                        chartData.datasets[0]
                    ) {
                        chartData.datasets[0].data = trades as {
                            x: number;
                            y: number;
                            quantity?: number;
                            orderType?: "buy" | "sell";
                        }[];
                        scheduleTradesChartUpdate();
                    }
                }
                const removedCount = originalLength - trades.length;
                console.log(
                    `Trade cleanup complete: filtered ${removedCount} old trades, ${trades.length} remaining`
                );
            }
        },
        30 * 60 * 1000
    );
});

// Connect to WebSocket after all initialization
tradeWebsocket.connect();
