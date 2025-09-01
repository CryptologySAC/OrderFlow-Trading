// Type declarations for chart objects
interface ChartInstance {
    data: {
        datasets: Array<{
            data: unknown[];
            [key: string]: unknown;
        }>;
        [key: string]: unknown;
    };
    options: {
        scales?: {
            x?: {
                min?: number;
                max?: number;
                [key: string]: unknown;
            };
            y?: {
                min?: number;
                max?: number;
                suggestedMin?: number;
                suggestedMax?: number;
                [key: string]: unknown;
            };
            [key: string]: unknown;
        };
        plugins?: {
            annotation?: {
                annotations: Record<string, unknown>;
            };
            [key: string]: unknown;
        };
        [key: string]: unknown;
    };
    update(mode?: string): void;
}

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
} from "./state";
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
} from "./charts";
import {
    renderAnomalyList,
    renderSignalsList,
    updateTradeDelayIndicator,
    showSignalBundleBadge,
} from "./render";
import {
    restoreColumnWidths,
    restoreAnomalyFilters,
    restoreTimeRange,
    restoreVerticalLayout,
    resetAllSettings,
    saveAnomalyFilters,
} from "./persistence";
import { setupColumnResizing, setRange } from "./ui";
import {
    getCurrentTheme,
    getSystemTheme,
    updateChartTheme,
    restoreTheme,
    toggleTheme,
    updateThemeToggleButton,
    toggleDepletionVisualization,
    updateDepletionToggleButton,
} from "./theme";
import { TradeWebSocket } from "../websocket";

declare module "./charts" {
    export const initializeTradesChart: (ctx: CanvasRenderingContext2D) => any;
    export const initializeRSIChart: (ctx: CanvasRenderingContext2D) => any;
    export const initializeOrderBookChart: (
        ctx: CanvasRenderingContext2D
    ) => any;
    export const cleanupOldSupportResistanceLevels: () => void;
    export const cleanupOldZones: () => void;
    export const updateYAxisBounds: () => void;
    export const updateTimeAnnotations: (time: number, range: number) => void;
    export const updateRSITimeAnnotations: (
        time: number,
        range: number
    ) => void;
    export const scheduleTradesChartUpdate: () => void;
    export const checkSupportResistanceBreaches: (
        price: number,
        time: number
    ) => void;
    export const buildSignalLabel: (signal: any) => string;
    export const handleSupportResistanceLevel: (data: any) => void;
    export const handleZoneUpdate: (data: any) => void;
    export const handleZoneSignal: (data: any) => void;
    export const updateOrderBookDisplay: (data: any) => void;
    export const safeUpdateRSIChart: (data: any[]) => boolean;
}

declare module "./render" {
    export const renderAnomalyList: () => void;
    export const renderSignalsList: () => void;
    export const updateTradeDelayIndicator: (delay: number) => void;
    export const showSignalBundleBadge: (signals: any[]) => void;
}

declare module "./persistence" {
    export const restoreColumnWidths: () => void;
    export const restoreAnomalyFilters: () => void;
    export const restoreTimeRange: () => void;
    export const restoreVerticalLayout: () => void;
    export const resetAllSettings: () => void;
    export const saveAnomalyFilters: () => void;
}

declare module "./ui" {
    export const setupColumnResizing: () => void;
    export const setRange: (range: number | null) => void;
}

declare module "./theme" {
    export const getCurrentTheme: () => string;
    export const getSystemTheme: () => string;
    export const updateChartTheme: (theme: string) => void;
    export const restoreTheme: () => void;
    export const toggleTheme: () => void;
    export const updateThemeToggleButton: () => void;
    export const toggleDepletionVisualization: () => void;
    export const updateDepletionToggleButton: () => void;
}

declare module "../websocket" {
    export class TradeWebSocket {
        constructor(config: {
            url: string;
            maxTrades?: number;
            maxReconnectAttempts?: number;
            reconnectDelay?: number;
            pingInterval?: number;
            pongWait?: number;
            onBacklog?: (data: any[]) => void;
            onMessage?: (message: any) => void;
        });
        connect(): void;
    }
}
// Type definitions
interface Trade {
    x: number;
    y: number;
    quantity: number;
    orderType: string;
}

interface RSIDataPoint {
    time: number;
    rsi: number;
}

interface SignalData {
    id: string;
    type: string;
    price: number;
    time: number;
    confidence?: number;
    side?: string;
    [key: string]: unknown;
}

interface AnomalyData {
    detector: string;
    message: string;
    severity: "low" | "medium" | "high" | "critical" | "info";
    details?: Record<string, unknown>;
    timestamp: number;
    price?: number;
}

interface OrderBookData {
    priceLevels: Array<{
        price: number;
        bid: number;
        ask: number;
        bidCount?: number;
        askCount?: number;
        depletionRatio?: number;
        depletionVelocity?: number;
        originalBidVolume?: number;
        originalAskVolume?: number;
    }>;
    bestBid?: number;
    bestAsk?: number;
    spread?: number;
    midPrice?: number;
    totalBidVolume?: number;
    totalAskVolume?: number;
    imbalance?: number;
    timestamp?: number;
}

interface WebSocketMessage {
    type: string;
    data: unknown;
    now?: number;
}

// Chart.js type declarations
declare global {
    interface Window {
        rsiUpdateTimeout?: NodeJS.Timeout;
        orderbookInitialized?: boolean;
        activeSRTooltip?: HTMLElement;
        resizeTimeout?: NodeJS.Timeout;
        safeStringify?: (obj: unknown) => string;
        runtimeConfig?: Record<string, unknown>;
        matchMedia: (query: string) => MediaQueryList;
    }
}

interface ChartInstance {
    data: {
        datasets: Array<{
            data: unknown[];
            [key: string]: unknown;
        }>;
        [key: string]: unknown;
    };
    options: {
        scales?: {
            x?: {
                min?: number;
                max?: number;
                [key: string]: unknown;
            };
            y?: {
                min?: number;
                max?: number;
                suggestedMin?: number;
                suggestedMax?: number;
                [key: string]: unknown;
            };
            [key: string]: unknown;
        };
        plugins?: {
            annotation?: {
                annotations: Record<string, unknown>;
            };
            [key: string]: unknown;
        };
        [key: string]: unknown;
    };
    update(mode?: string): void;
}

let unifiedMin = 0;
let unifiedMax = 0;

let orderBookData: OrderBookData = {
    priceLevels: [],
};

const messageQueue: WebSocketMessage[] = [];
let isProcessingQueue = false;

/**
 * Centralized function to update the time range for both charts.
 * @param latestTime - The latest timestamp to base the range on.
 */
function updateUnifiedTimeRange(latestTime: number): void {
    if (activeRange !== null) {
        unifiedMin = latestTime - activeRange;
        unifiedMax = latestTime + PADDING_TIME;

        if (tradesChart) {
            (tradesChart as ChartInstance).options.scales!.x!.min = unifiedMin;
            (tradesChart as ChartInstance).options.scales!.x!.max = unifiedMax;
            updateTimeAnnotations(latestTime, activeRange);
        }
        if (rsiChart) {
            (rsiChart as ChartInstance).options.scales!.x!.min = unifiedMin;
            (rsiChart as ChartInstance).options.scales!.x!.max = unifiedMax;
            updateRSITimeAnnotations(latestTime, activeRange);
        }
    }
}

/**
 * Validates a trade object.
 * @param trade - The trade object to validate.
 * @returns True if the trade is valid, false otherwise.
 */
function isValidTrade(trade: unknown): trade is {
    time: number;
    price: number;
    quantity: number;
    orderType: string;
} {
    if (!trade || typeof trade !== "object") return false;
    const t = trade as Record<string, unknown>;
    return (
        typeof t.time === "number" &&
        typeof t.price === "number" &&
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
 * @returns The trade object for the chart.
 */
function createTrade(
    time: number,
    price: number,
    quantity: number,
    orderType: string
): Trade {
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

    const tradesCtx = (tradesCanvas as HTMLCanvasElement).getContext("2d");
    if (!tradesCtx) {
        console.error("Could not get 2D context for trades chart");
        return;
    }

    const orderBookCtx = (orderBookCanvas as HTMLCanvasElement).getContext(
        "2d"
    );
    if (!orderBookCtx) {
        console.error("Could not get 2D context for order book chart");
        return;
    }

    const rsiCtx = rsiCanvas
        ? (rsiCanvas as HTMLCanvasElement).getContext("2d")
        : null;
    if (!rsiCtx) {
        console.error("Could not get 2D context for RSI chart");
        return;
    }

    // Initialize charts first
    initializeTradesChart(tradesCtx);
    initializeOrderBookChart(orderBookCtx);
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

function processMessageQueue(): void {
    if (messageQueue.length === 0) {
        isProcessingQueue = false;
        requestAnimationFrame(processMessageQueue);
        return;
    }

    isProcessingQueue = true;
    const message = messageQueue.shift();

    try {
        // The actual message processing logic
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
        // Update the trade delay indicator (gauge was removed)
        updateTradeDelayIndicator(delay);
    }

    switch (message.type) {
        case "anomaly":
            const anomalyData = message.data as AnomalyData;
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
                //showAnomalyBadge(anomalyData);
            }
            // Annotate chart if desired (optional, see below)
            //addAnomalyChartLabel(anomalyData);
            break;
        case "trade":
            const trade = message.data as {
                time: number;
                price: number;
                quantity: number;
                orderType: string;
            };
            if (isValidTrade(trade)) {
                trades.push(
                    createTrade(
                        trade.time,
                        trade.price,
                        trade.quantity,
                        trade.orderType
                    )
                );

                (tradesChart as ChartInstance).data.datasets[0].data = [
                    ...trades,
                ];

                const line = (tradesChart as ChartInstance).options.plugins!
                    .annotation!.annotations.lastPriceLine as {
                    yMin: number;
                    yMax: number;
                };
                line.yMin = trade.price;
                line.yMax = trade.price;

                updateUnifiedTimeRange(trade.time);
                updateYAxisBounds();

                // Check for support/resistance zone breaches
                checkSupportResistanceBreaches(trade.price, trade.time);

                scheduleTradesChartUpdate();
            }
            break;

        case "rsi":
            const rsiDataPoint = message.data as RSIDataPoint;
            if (
                rsiDataPoint &&
                typeof rsiDataPoint.time === "number" &&
                typeof rsiDataPoint.rsi === "number"
            ) {
                // Add to RSI data array (backlog already handles deduplication)
                rsiData.push(rsiDataPoint);

                // Limit data size
                if (rsiData.length > MAX_RSI_DATA) {
                    rsiData.shift();
                }

                // Batch real-time RSI updates to reduce chart re-renders
                if (!window.rsiUpdateTimeout) {
                    window.rsiUpdateTimeout = setTimeout(() => {
                        const updateSuccess = safeUpdateRSIChart([...rsiData]);
                        window.rsiUpdateTimeout = undefined;

                        if (!updateSuccess) {
                            console.error(
                                "Failed to update RSI chart with batched data"
                            );
                        }
                    }, 100); // Update at most every 100ms
                }
            } else {
                console.warn("Invalid RSI data received:", rsiDataPoint);
            }
            break;

        case "rsi_backlog":
            console.log(
                `${(message.data as RSIDataPoint[]).length} RSI backlog data received.`
            );

            // Process backlog data and replace chart data entirely
            const backlogData: RSIDataPoint[] = [];
            const processBacklogChunk = (
                data: RSIDataPoint[],
                startIndex = 0
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
                        backlogData.push(rsiPoint);
                    }
                }

                if (endIndex < data.length) {
                    // Process next chunk asynchronously to avoid blocking
                    setTimeout(() => processBacklogChunk(data, endIndex), 0);
                } else {
                    // All chunks processed - replace rsiData with backlog
                    if (backlogData.length > 0) {
                        rsiData.length = 0; // Clear existing data
                        rsiData.push(...backlogData); // Add backlog data

                        // Update chart immediately with backlog data
                        if (rsiChart) {
                            (rsiChart as ChartInstance).data.datasets[0].data =
                                [...rsiData];
                            (rsiChart as ChartInstance).update("none");
                        }

                        console.log(
                            `${backlogData.length} RSI backlog points loaded and chart updated`
                        );
                    }
                }
            };

            // Process backlog and replace data
            processBacklogChunk(message.data as RSIDataPoint[]);
            break;

        case "signal":
            const signal = message.data as SignalData;
            const label = buildSignalLabel(signal);
            const id = signal.id;

            // Add to signals list
            signalsList.unshift(signal);
            // Limit list length
            if (signalsList.length > 50) {
                signalsList.length = 50;
            }
            renderSignalsList();

            // Add to chart
            if (tradesChart) {
                (
                    tradesChart as ChartInstance
                ).options.plugins!.annotation!.annotations[id] = {
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
                (tradesChart as ChartInstance).update("none");
            }
            console.log("Signal label added:", label);
            break;

        case "signal_backlog":
            console.log(
                `${(message.data as SignalData[]).length} backlog signals received.`
            );

            // Process backlog signals in reverse order (oldest first)
            const backlogSignals = [
                ...(message.data as SignalData[]),
            ].reverse();

            for (const signal of backlogSignals) {
                const normalizedSignal: SignalData = {
                    ...signal,
                    id: signal.id,
                    type:
                        (signal as any).originalSignals?.[0]?.type ||
                        "confirmed",
                    side:
                        (signal as any).originalSignals?.[0]?.metadata?.side ||
                        "unknown",
                    price: (signal as any).finalPrice || signal.price,
                    time: (signal as any).confirmedAt || signal.time,
                    confidence: signal.confidence ?? 0,
                };

                const signalLabel = buildSignalLabel(normalizedSignal);
                const signalId = signal.id;

                // Add to signals list - use unshift to maintain newest-first order
                signalsList.unshift(normalizedSignal);

                // Add to chart
                if (tradesChart) {
                    (
                        tradesChart as ChartInstance
                    ).options.plugins!.annotation!.annotations[signalId] = {
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

                // Limit total signals list length
                if (signalsList.length > 50) {
                    signalsList.length = 50; // Keep most recent 50
                }

                renderSignalsList();
                (tradesChart as ChartInstance).update("none");
            }
            console.log(
                `${backlogSignals.length} backlog signals added to chart and list`
            );
            break;

        case "signal_bundle":
            if (Array.isArray(message.data) && message.data.length) {
                const filtered = (message.data as SignalData[]).filter((s) => {
                    const last = signalsList[0];
                    if (!last) return true;
                    const diff = Math.abs(s.price - last.price);
                    return diff > last.price * dedupTolerance;
                });

                filtered.forEach((signal) => {
                    signalsList.unshift(signal);

                    const label = buildSignalLabel(signal);
                    if (tradesChart) {
                        (
                            tradesChart as ChartInstance
                        ).options.plugins!.annotation!.annotations[signal.id] =
                            {
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
                if (tradesChart) {
                    (tradesChart as ChartInstance).update("none");
                }
                showSignalBundleBadge(filtered);
            }
            break;

        case "runtimeConfig":
            if (message.data && typeof message.data === "object") {
                setRuntimeConfig(message.data as Record<string, unknown>);
            }
            break;

        case "supportResistanceLevel":
            console.log("Support/Resistance level received:", message.data);
            handleSupportResistanceLevel(message.data);
            break;

        case "zoneUpdate":
            console.log("Zone update received:", message.data);
            handleZoneUpdate(message.data);
            break;

        case "zoneSignal":
            console.log("Zone signal received:", message.data);
            handleZoneSignal(message.data);
            break;

        case "orderbook":
            if (
                !message.data ||
                !Array.isArray((message.data as OrderBookData).priceLevels)
            ) {
                console.error("Invalid orderbook data");
                return;
            }

            orderBookData = message.data as OrderBookData;

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
            break;
    }
}

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
                        Object.keys(
                            (tradesChart as ChartInstance).options.plugins!
                                .annotation!.annotations
                        ).forEach((key) => {
                            if (key !== signalId && key !== "lastPriceLine") {
                                const annotation = (
                                    tradesChart as ChartInstance
                                ).options.plugins!.annotation!.annotations[
                                    key
                                ] as {
                                    backgroundColor?: string;
                                };
                                if (annotation && annotation.backgroundColor) {
                                    annotation.backgroundColor =
                                        annotation.backgroundColor.replace(
                                            /[\d\.]+\)$/,
                                            "0.1)"
                                        );
                                }
                            }
                        });
                        (tradesChart as ChartInstance).update("none");
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
                        Object.keys(
                            (tradesChart as ChartInstance).options.plugins!
                                .annotation!.annotations
                        ).forEach((key) => {
                            if (key !== "lastPriceLine") {
                                const annotation = (
                                    tradesChart as ChartInstance
                                ).options.plugins!.annotation!.annotations[
                                    key
                                ] as {
                                    backgroundColor?: string;
                                };
                                if (annotation && annotation.backgroundColor) {
                                    annotation.backgroundColor =
                                        annotation.backgroundColor.replace(
                                            /[\d\.]+\)$/,
                                            "0.5)"
                                        );
                                }
                            }
                        });
                        (tradesChart as ChartInstance).update("none");
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
            const originalLength = trades.length;

            // Find the index of the first trade to keep. This is also the number of trades to remove.
            let tradesToRemoveCount = trades.findIndex(
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
                const keptTrades = trades.slice(tradesToRemoveCount);

                // Modify the array in-place to avoid breaking references in other modules.
                trades.length = 0;
                trades.push(...keptTrades);

                // Update chart after cleanup
                if (tradesChart) {
                    // The chart now points to the same, but modified, trades array.
                    (tradesChart as ChartInstance).data.datasets[0].data =
                        trades;
                    scheduleTradesChartUpdate();
                }

                const removedCount = originalLength - trades.length;
                console.log(
                    `Trade cleanup complete: filtered ${removedCount} old trades, ${trades.length} remaining`
                );
            }
        },
        30 * 60 * 1000
    ); // Every 30 minutes (reduced frequency)
});

const tradeWebsocket = new TradeWebSocket({
    url: "ws://localhost:3001",
    maxTrades: 50000,
    maxReconnectAttempts: 10,
    reconnectDelay: 1000,
    pingInterval: 10000,
    pongWait: 5000,
    onBacklog: (backLog: any[]) => {
        console.log(`${backLog.length} backlog trades received.`);

        trades.length = 0;
        for (const trade of backLog) {
            if (isValidTrade(trade)) {
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

        (tradesChart as ChartInstance).data.datasets[0].data = [...trades];

        if (trades.length > 0) {
            const latestTrade = trades[trades.length - 1];
            const latestTime = latestTrade.x;
            const latestPrice = latestTrade.y;

            // Update price line
            const line = (tradesChart as ChartInstance).options.plugins!
                .annotation!.annotations.lastPriceLine as {
                yMin: number;
                yMax: number;
            };
            line.yMin = latestPrice;
            line.yMax = latestPrice;

            // Update axes and annotations
            updateUnifiedTimeRange(latestTime);
            updateYAxisBounds();
        }

        scheduleTradesChartUpdate();
    },

    onMessage: (message: any) => {
        messageQueue.push(message);
        if (!isProcessingQueue) {
            processMessageQueue();
        }
    },
});

// Connect to WebSocket after all initialization
tradeWebsocket.connect();
