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
    orderBookChart,
    PADDING_TIME,
    MAX_RSI_DATA,
    FIFTEEN_MINUTES,
    setRuntimeConfig,
} from "./state.js";

// Re-export trades as ChartDataPoint array for type safety
const chartTrades = trades as unknown as ChartDataPoint[];
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
} from "./charts.js";
import {
    renderAnomalyList,
    renderSignalsList,
    updateTradeDelayIndicator,
    showSignalBundleBadge,
} from "./render.js";
import {
    restoreColumnWidths,
    restoreAnomalyFilters,
    restoreTimeRange,
    restoreVerticalLayout,
    resetAllSettings,
    saveAnomalyFilters,
} from "./persistence.js";
import { setupColumnResizing, setRange } from "./ui.js";
import {
    getCurrentTheme,
    getSystemTheme,
    updateChartTheme,
    restoreTheme,
    toggleTheme,
    updateThemeToggleButton,
    toggleDepletionVisualization,
    updateDepletionToggleButton,
} from "./theme.js";
import { TradeWebSocket } from "../websocket.js";
import type {
    WebSocketMessage,
    MessageType,
    TradeMessage,
    SignalMessage,
    AnomalyMessage,
    RsiMessage,
    RsiBacklogMessage,
    SignalBacklogMessage,
    SignalBundleMessage,
    RuntimeConfigMessage,
    SupportResistanceLevelMessage,
    ZoneUpdateMessage,
    ZoneSignalMessage,
    OrderbookMessage,
    BacklogMessage,
} from "../types.js";
import type {
    ChartDataPoint,
    Trade,
    Signal,
    Anomaly,
    RSIDataPoint,
    OrderBookData,
} from "../frontend-types.ts";

// Extend ChartDataPoint to include the properties we need
interface ExtendedChartDataPoint extends ChartDataPoint {
    time?: number;
    price?: number;
}

// =============================================================================
// TYPE DEFINITIONS
// =============================================================================

interface MessageQueueItem {
    type: string;
    data?: unknown;
    now?: number;
}

interface UnifiedTimeRange {
    min: number;
    max: number;
}

// =============================================================================
// GLOBAL STATE
// =============================================================================

let unifiedMin = 0;
let unifiedMax = 0;

let orderBookData: OrderBookData = {
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

let supportResistanceLevels: Array<{
    id: string;
    price: number;
    type: "support" | "resistance";
    strength: number;
    touchCount: number;
    firstDetected: number;
    lastTouched: number;
    volumeAtLevel: number;
    roleReversals?: Array<{
        timestamp: number;
        fromType: "support" | "resistance";
        toType: "support" | "resistance";
    }>;
}> = [];

const messageQueue: MessageQueueItem[] = [];
let isProcessingQueue = false;

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

/**
 * Centralized function to update the time range for both charts.
 * @param latestTime - The latest timestamp to base the range on.
 */
function updateUnifiedTimeRange(latestTime: number): void {
    if (activeRange !== null) {
        unifiedMin = latestTime - activeRange;
        unifiedMax = latestTime + PADDING_TIME;

        if (tradesChart) {
            tradesChart.options.scales.x.min = unifiedMin;
            tradesChart.options.scales.x.max = unifiedMax;
            updateTimeAnnotations(latestTime, activeRange);
        }
        if (rsiChart) {
            rsiChart.options.scales.x.min = unifiedMin;
            rsiChart.options.scales.x.max = unifiedMax;
            updateRSITimeAnnotations(latestTime, activeRange);
        }
    }
}

/**
 * Validates a trade object.
 * @param trade - The trade object to validate.
 * @returns True if the trade is valid, false otherwise.
 */
function isValidTrade(trade: unknown): trade is Trade {
    if (!trade || typeof trade !== "object") return false;

    const t = trade as Record<string, unknown>;
    return (
        (typeof t.time === "number" || typeof t.x === "number") &&
        (typeof t.price === "number" || typeof t.y === "number") &&
        typeof t.quantity === "number" &&
        typeof t.orderType === "string"
    );
}

/**
 * Creates a trade object for the chart.
 * @param time - The timestamp of the trade.
 * @param price - The price of the trade.
 * @param quantity - The quantity of the trade.
 * @param orderType - The order type (e.g., 'buy' or 'sell').
 * @returns Chart data point with trade information.
 */
function createTrade(
    time: number,
    price: number,
    quantity: number,
    orderType: string
): ChartDataPoint {
    return {
        x: time,
        y: price,
        quantity: quantity,
        orderType: orderType as "buy" | "sell",
    };
}

// =============================================================================
// INITIALIZATION
// =============================================================================

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
    const tradesChartInstance = initializeTradesChart(tradesCtx);
    const orderBookChartInstance = initializeOrderBookChart(orderBookCtx);
    const rsiChartInstance = initializeRSIChart(rsiCtx);

    // Apply the restored time range to the charts AFTER initialization
    // This ensures the charts exist before we try to update them
    console.log(
        "Applying time range after chart initialization:",
        activeRange === null ? "ALL" : `${activeRange / 60000} minutes`
    );
    setRange(activeRange);

    // Validate chart initialization before connecting WebSocket
    if (!rsiChartInstance) {
        console.error(
            "Failed to initialize RSI chart - WebSocket connection aborted"
        );
        return;
    }

    // Validate RSI chart structure
    if (!rsiChart || !rsiChart.data || !rsiChart.data.datasets) {
        console.error(
            "RSI chart structure invalid after initialization - WebSocket connection aborted"
        );
        return;
    }

    // Connect to the trade WebSocket after charts are ready
    tradeWebsocket.connect();

    // Setup interact.js for column resizing (this includes restoreColumnWidths)
    setupColumnResizing();

    // Setup range selector
    if (rangeSelector) {
        rangeSelector.addEventListener("click", (e: Event) => {
            const target = e.target as HTMLElement;
            if (target.tagName === "BUTTON") {
                const range = target.getAttribute("data-range");

                // Update UI active state
                if (rangeSelector) {
                    rangeSelector
                        .querySelectorAll("button")
                        .forEach((btn) => btn.classList.remove("active"));
                }
                target.classList.add("active");

                setRange(range === "all" ? null : parseInt(range || "0"));
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

// =============================================================================
// MESSAGE QUEUE PROCESSING
// =============================================================================

function processMessageQueue(): void {
    if (messageQueue.length === 0) {
        isProcessingQueue = false;
        requestAnimationFrame(processMessageQueue);
        return;
    }

    isProcessingQueue = true;
    const message = messageQueue.shift();

    if (message) {
        try {
            // The actual message processing logic
            handleMessage(message);
        } catch (error) {
            console.error("Error processing message from queue:", error);
        }
    }

    requestAnimationFrame(processMessageQueue);
}

function handleMessage(message: MessageQueueItem): void {
    // Check if message is null or undefined
    if (!message) {
        console.warn("Received null or undefined message");
        return;
    }

    const receiveTime = Date.now();
    const messageTime = (message as { now?: number }).now ?? 0;
    const delay = receiveTime - messageTime;
    if (delay >= 0) {
        // Update the trade delay indicator (gauge was removed)
        updateTradeDelayIndicator(delay);
    }

    switch (message.type) {
        case "anomaly":
            handleAnomalyMessage(message);
            break;
        case "trade":
            handleTradeMessage(message);
            break;
        case "rsi":
            handleRsiMessage(message);
            break;
        case "rsi_backlog":
            handleRsiBacklogMessage(message);
            break;
        case "signal":
            handleSignalMessage(message);
            break;
        case "signal_backlog":
            handleSignalBacklogMessage(message);
            break;
        case "signal_bundle":
            handleSignalBundleMessage(message);
            break;
        case "runtimeConfig":
            handleRuntimeConfigMessage(message);
            break;
        case "supportResistanceLevel":
            handleSupportResistanceLevelMessage(message);
            break;
        case "zoneUpdate":
            handleZoneUpdateMessage(message);
            break;
        case "zoneSignal":
            handleZoneSignalMessage(message);
            break;
        case "orderbook":
            handleOrderbookMessage(message);
            break;
        default:
            console.warn("Unknown message type:", message.type);
            break;
    }
}

// =============================================================================
// MESSAGE HANDLERS
// =============================================================================

function handleAnomalyMessage(message: MessageQueueItem): void {
    const anomalyData = message.data as Anomaly;
    if (!anomalyData) return;

    anomalyList.unshift(anomalyData);
    // Limit list length
    if (anomalyList.length > 100) {
        anomalyList.length = 100;
    }
    renderAnomalyList();

    // Badge only for high/critical
    if (
        anomalyData.severity === "high" ||
        anomalyData.severity === "critical"
    ) {
        // showAnomalyBadge(anomalyData);
    }
}

function handleTradeMessage(message: MessageQueueItem): void {
    const trade = message.data as Trade;
    if (!isValidTrade(trade)) return;

    const chartDataPoint = createTrade(
        trade.time || (trade as any).x,
        trade.price || (trade as any).y,
        trade.quantity,
        trade.orderType
    );

    chartTrades.push(chartDataPoint);

    if (tradesChart) {
        tradesChart.data.datasets[0].data = [...chartTrades];

        const line =
            tradesChart.options.plugins?.annotation?.annotations?.lastPriceLine;
        if (
            line &&
            typeof line === "object" &&
            "yMin" in line &&
            "yMax" in line
        ) {
            (line as any).yMin = trade.price || (trade as any).y;
            (line as any).yMax = trade.price || (trade as any).y;
        }
    }

    const tradeTime = trade.time || (trade as any).x;
    const tradePrice = trade.price || (trade as any).y;

    updateUnifiedTimeRange(tradeTime);
    updateYAxisBounds(chartTrades);

    // Check for support/resistance zone breaches
    checkSupportResistanceBreaches(tradePrice, tradeTime);

    scheduleTradesChartUpdate();
}

function handleRsiMessage(message: MessageQueueItem): void {
    const rsiDataPoint = message.data as RSIDataPoint;
    if (
        !rsiDataPoint ||
        typeof rsiDataPoint.time !== "number" ||
        typeof rsiDataPoint.rsi !== "number"
    ) {
        console.warn("Invalid RSI data received:", rsiDataPoint);
        return;
    }

    // Add to RSI data array (backlog already handles deduplication)
    rsiData.push(rsiDataPoint);

    // Limit data size
    if (rsiData.length > MAX_RSI_DATA) {
        rsiData.shift();
    }

    // Batch real-time RSI updates to reduce chart re-renders
    if (!window.rsiUpdateTimeout) {
        window.rsiUpdateTimeout = setTimeout(() => {
            const chartData = rsiData.map((point) => ({
                x: point.time,
                y: point.rsi,
            }));
            const updateSuccess = safeUpdateRSIChart(chartData);
            window.rsiUpdateTimeout = undefined;

            if (!updateSuccess) {
                console.error("Failed to update RSI chart with batched data");
            }
        }, 100); // Update at most every 100ms
    }
}

function handleRsiBacklogMessage(message: MessageQueueItem): void {
    const backlogData = message.data as RSIDataPoint[];
    if (!Array.isArray(backlogData)) {
        console.warn("Invalid RSI backlog data:", backlogData);
        return;
    }

    console.log(`${backlogData.length} RSI backlog data received.`);

    // Process backlog data and replace chart data entirely
    const processedData: RSIDataPoint[] = [];
    const processBacklogChunk = (
        data: RSIDataPoint[],
        startIndex: number = 0
    ) => {
        const chunkSize = 10; // Process 10 points at a time
        const endIndex = Math.min(startIndex + chunkSize, data.length);

        // Pre-validate and add data points to backlog array
        for (let i = startIndex; i < endIndex; i++) {
            const rsiPoint = data[i];
            if (
                rsiPoint &&
                typeof rsiPoint.time === "number" &&
                typeof rsiPoint.rsi === "number" &&
                rsiPoint.rsi >= 0 &&
                rsiPoint.rsi <= 100
            ) {
                processedData.push(rsiPoint);
            }
        }

        if (endIndex < data.length) {
            // Process next chunk asynchronously to avoid blocking
            setTimeout(() => processBacklogChunk(data, endIndex), 0);
        } else {
            // All chunks processed - replace rsiData with backlog
            if (processedData.length > 0) {
                rsiData.length = 0; // Clear existing data
                rsiData.push(...processedData); // Add backlog data

                // Update chart immediately with backlog data
                if (rsiChart) {
                    const chartData = rsiData.map((point) => ({
                        x: point.time,
                        y: point.rsi,
                    }));
                    rsiChart.data.datasets[0].data = chartData;
                    rsiChart.update("none");
                }

                console.log(
                    `${processedData.length} RSI backlog points loaded and chart updated`
                );
            }
        }
    };

    // Process backlog and replace data
    processBacklogChunk(backlogData);
}

function handleSignalMessage(message: MessageQueueItem): void {
    const signalData = message.data as Signal;
    if (!signalData) return;

    const label = buildSignalLabel(signalData);
    const id = signalData.id;

    // Add to signals list
    signalsList.unshift(signalData);
    // Limit list length
    if (signalsList.length > 50) {
        signalsList.length = 50;
    }
    renderSignalsList();

    // Add to chart
    if (tradesChart?.options?.plugins?.annotation?.annotations) {
        tradesChart.options.plugins.annotation.annotations[id] = {
            type: "label",
            xValue: signalData.time,
            yValue: signalData.price,
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
        tradesChart.update("none");
        console.log("Signal label added:", label);
    }
}

function handleSignalBacklogMessage(message: MessageQueueItem): void {
    const backlogSignals = message.data as Signal[];
    if (!Array.isArray(backlogSignals)) {
        console.warn("Invalid signal backlog data:", backlogSignals);
        return;
    }

    console.log(`${backlogSignals.length} backlog signals received.`);

    // Process backlog signals in reverse order (oldest first)
    const reversedSignals = [...backlogSignals].reverse();

    for (const signal of reversedSignals) {
        const normalizedSignal: Signal = {
            id: signal.id,
            type: signal.originalSignals?.[0]?.type || "confirmed",
            side:
                (signal.originalSignals?.[0]?.metadata?.side as
                    | "buy"
                    | "sell") || "buy",
            price: signal.finalPrice || signal.price,
            time: signal.confirmedAt || signal.time,
            confidence: signal.confidence,
            // Include additional properties without overwriting the ones we just set
            ...(({ id, type, side, price, time, confidence, ...rest }) => rest)(
                signal
            ),
        };

        const signalLabel = buildSignalLabel(normalizedSignal);
        const signalId = signal.id;

        // Add to signals list - use unshift to maintain newest-first order
        signalsList.unshift(normalizedSignal);

        // Add to chart
        if (tradesChart?.options?.plugins?.annotation?.annotations) {
            tradesChart.options.plugins.annotation.annotations[signalId] = {
                type: "label",
                xValue: normalizedSignal.time,
                yValue: normalizedSignal.price,
                content: signalLabel,
                backgroundColor: "rgba(90, 50, 255, 0.4)", // Slightly more transparent for backlog
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

    // Limit total signals list length
    if (signalsList.length > 50) {
        signalsList.length = 50; // Keep most recent 50
    }

    renderSignalsList();
    tradesChart?.update("none");
    console.log(
        `${reversedSignals.length} backlog signals added to chart and list`
    );
}

function handleSignalBundleMessage(message: MessageQueueItem): void {
    const signalBundle = message.data as Signal[];
    if (!Array.isArray(signalBundle)) {
        console.warn("Invalid signal bundle data:", signalBundle);
        return;
    }

    const filtered = signalBundle.filter((s) => {
        const last = signalsList[0];
        if (!last) return true;
        const diff = Math.abs(s.price - last.price);
        return diff > last.price * dedupTolerance;
    });

    filtered.forEach((signal) => {
        signalsList.unshift(signal);

        const label = buildSignalLabel(signal);
        if (tradesChart?.options?.plugins?.annotation?.annotations) {
            tradesChart.options.plugins.annotation.annotations[signal.id] = {
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
    });

    if (signalsList.length > 50) {
        signalsList.length = 50;
    }

    renderSignalsList();
    tradesChart?.update("none");
    showSignalBundleBadge(filtered);
}

function handleRuntimeConfigMessage(message: MessageQueueItem): void {
    const configData = message.data;
    if (configData && typeof configData === "object") {
        setRuntimeConfig(configData);
    }
}

function handleSupportResistanceLevelMessage(message: MessageQueueItem): void {
    console.log("Support/Resistance level received:", message.data);
    handleSupportResistanceLevel(message.data);
}

function handleZoneUpdateMessage(message: MessageQueueItem): void {
    console.log("Zone update received:", message.data);
    handleZoneUpdate(message.data);
}

function handleZoneSignalMessage(message: MessageQueueItem): void {
    console.log("Zone signal received:", message.data);
    handleZoneSignal(message.data);
}

function handleOrderbookMessage(message: MessageQueueItem): void {
    const orderBookMessageData = message.data as OrderBookData;
    if (
        !orderBookMessageData ||
        !Array.isArray(orderBookMessageData.priceLevels)
    ) {
        console.error("Invalid orderbook data");
        return;
    }

    orderBookData = orderBookMessageData;

    // Minimal logging - only once per session
    if (!window.orderbookInitialized) {
        console.log("📊 Orderbook initialized:", {
            levels: orderBookData.priceLevels.length,
            midPrice: orderBookData.midPrice,
        });
        window.orderbookInitialized = true;
    }

    // Direct chart update - no conditional checks
    updateOrderBookDisplay(orderBookData);
}

// =============================================================================
// DOM EVENT HANDLERS
// =============================================================================

document.addEventListener("DOMContentLoaded", initialize);

document.addEventListener("DOMContentLoaded", () => {
    const filterBox = document.querySelector(".anomaly-filter");
    if (filterBox) {
        filterBox.querySelectorAll("input[type=checkbox]").forEach((box) => {
            const checkbox = box as HTMLInputElement;
            checkbox.addEventListener("change", () => {
                if (checkbox.checked) anomalyFilters.add(checkbox.value);
                else anomalyFilters.delete(checkbox.value);
                renderAnomalyList();
                // Save the updated filter settings
                saveAnomalyFilters();
            });
        });
    }

    // Setup signal filter checkboxes
    const signalFilterBox = document.querySelector(".signals-filter");
    if (signalFilterBox) {
        signalFilterBox
            .querySelectorAll("input[type=checkbox]")
            .forEach((box) => {
                const checkbox = box as HTMLInputElement;
                checkbox.addEventListener("change", () => {
                    if (checkbox.checked) signalFilters.add(checkbox.value);
                    else signalFilters.delete(checkbox.value);
                    renderSignalsList();
                });
            });
    }

    // Setup signal hover interactions for chart transparency
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
                    const signalId = signalRow.dataset.signalId;

                    // Make other chart annotations transparent
                    if (
                        tradesChart?.options?.plugins?.annotation?.annotations
                    ) {
                        const annotations =
                            tradesChart.options.plugins.annotation.annotations;
                        Object.keys(annotations).forEach((key) => {
                            if (key !== signalId && key !== "lastPriceLine") {
                                const annotation = annotations[key];
                                if (annotation && annotation.backgroundColor) {
                                    annotation.backgroundColor =
                                        annotation.backgroundColor.replace(
                                            /[\d\.]+\)$/,
                                            "0.1)"
                                        );
                                }
                            }
                        });
                        tradesChart.update("none");
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
                    // Restore normal transparency for all annotations
                    if (
                        tradesChart?.options?.plugins?.annotation?.annotations
                    ) {
                        const annotations =
                            tradesChart.options.plugins.annotation.annotations;
                        Object.keys(annotations).forEach((key) => {
                            if (key !== "lastPriceLine") {
                                const annotation = annotations[key];
                                if (annotation && annotation.backgroundColor) {
                                    annotation.backgroundColor =
                                        annotation.backgroundColor.replace(
                                            /[\d\.]+\)$/,
                                            "0.5)"
                                        );
                                }
                            }
                        });
                        tradesChart.update("none");
                    }
                }
            },
            true
        );
    }

    // Set up efficient trade cleanup every 30 minutes (reduced frequency)
    // This prevents memory bloat while maintaining 90 minutes of visible trades
    setInterval(
        () => {
            const cutoffTime = Date.now() - 90 * 60 * 1000; // 90 minutes ago
            const originalLength = chartTrades.length;

            // Find the index of the first trade to keep. This is also the number of trades to remove.
            let tradesToRemoveCount = chartTrades.findIndex(
                (t) => t.x >= cutoffTime
            );

            // If all trades are older, findIndex returns -1. In that case, all trades should be removed.
            if (tradesToRemoveCount === -1 && originalLength > 0) {
                tradesToRemoveCount = originalLength;
            } else if (tradesToRemoveCount === -1) {
                tradesToRemoveCount = 0;
            }

            // Only cleanup if we have a significant number of old trades to remove.
            if (tradesToRemoveCount > 1000) {
                console.log(
                    `Starting trade cleanup: ${tradesToRemoveCount} old trades detected`
                );

                // Use slice to get the trades to keep, which is more performant than filter.
                const keptTrades = chartTrades.slice(tradesToRemoveCount);

                // Modify the array in-place to avoid breaking references in other modules.
                chartTrades.length = 0;
                chartTrades.push(...keptTrades);

                // Update chart after cleanup
                if (tradesChart) {
                    // The chart now points to the same, but modified, trades array.
                    tradesChart.data.datasets[0].data = chartTrades;
                    scheduleTradesChartUpdate();
                }

                const removedCount = originalLength - chartTrades.length;
                console.log(
                    `Trade cleanup complete: filtered ${removedCount} old trades, ${chartTrades.length} remaining`
                );
            }
        },
        30 * 60 * 1000
    ); // Every 30 minutes (reduced frequency)
});

// =============================================================================
// WEBSOCKET SETUP
// =============================================================================

const tradeWebsocket = new TradeWebSocket({
    url: "ws://localhost:3001",
    maxTrades: 50000,
    maxReconnectAttempts: 10,
    reconnectDelay: 1000,
    pingInterval: 10000,
    pongWait: 5000,
    onBacklog: (backLog: any[]) => {
        console.log(`${backLog.length} backlog trades received.`);

        chartTrades.length = 0;
        for (const tradeMessage of backLog) {
            // Handle both TradeMessage format and direct trade format
            const tradeData = tradeMessage.data || tradeMessage;
            const trade: Trade = {
                time: tradeData.t || tradeData.time || (tradeData as any).x,
                price: parseFloat(
                    tradeData.p || tradeData.price || (tradeData as any).y
                ),
                quantity: parseFloat(tradeData.q || tradeData.quantity),
                orderType: tradeData.m ? "sell" : "buy", // isBuyerMaker: true = sell, false = buy
            };

            if (isValidTrade(trade)) {
                chartTrades.push(
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
            tradesChart.data.datasets[0].data = [...chartTrades];
        }

        if (chartTrades.length > 0) {
            const latestTrade = chartTrades[chartTrades.length - 1];
            const latestTime = latestTrade.x;
            const latestPrice = latestTrade.y;

            // Update price line
            if (
                tradesChart?.options?.plugins?.annotation?.annotations
                    ?.lastPriceLine
            ) {
                const line =
                    tradesChart.options.plugins.annotation.annotations
                        .lastPriceLine;
                if (
                    line &&
                    typeof line === "object" &&
                    "yMin" in line &&
                    "yMax" in line
                ) {
                    (line as any).yMin = latestPrice;
                    (line as any).yMax = latestPrice;
                }
            }

            // Update axes and annotations
            updateUnifiedTimeRange(latestTime);
            updateYAxisBounds(chartTrades);
        }

        scheduleTradesChartUpdate();
    },

    onMessage: (message: WebSocketMessage) => {
        messageQueue.push(message);
        if (!isProcessingQueue) {
            processMessageQueue();
        }
    },
});

// Connect to WebSocket after all initialization
tradeWebsocket.connect();
