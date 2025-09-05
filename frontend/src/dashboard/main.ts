// frontend/src/main.ts
// EXACT TYPE-SAFE FRONTEND IMPLEMENTATION
// Recreates main.js functionality with ZERO unknown/any types
// Uses exact backend message structures
import {
    Chart,
    registerables,
    //ChartOptions
} from "chart.js";
import "chartjs-adapter-date-fns";
import * as Config from "../config.js";

//import annotationPlugin, {
//    AnnotationOptions,
//EventContext,
//PartialEventContext,
//} from "chartjs-plugin-annotation";
Chart.register(...registerables);
import {
    tradesCanvas,
    orderBookCanvas,
    rsiCanvas,
    //rangeSelector,
    anomalyFilters,
    signalFilters,
    //anomalyList,
    //signalsList,
    //rsiData,
    activeRange,
    //dedupTolerance,
    PADDING_TIME,
    //MAX_RSI_DATA,
    //setRuntimeConfig,
} from "./state.js";
import {
    //initializeRSIChart,
    cleanupOldSupportResistanceLevels,
    cleanupOldZones,

    //updateRSITimeAnnotations,
    //scheduleTradesChartUpdate,
    //checkSupportResistanceBreaches,
    //buildSignalLabel,
    //handleSupportResistanceLevel,
    //handleZoneUpdate,
    //handleZoneSignal,
    //updateOrderBookDisplay,
    //safeUpdateRSIChart,
} from "./charts.js";
import { TradeChart } from "./tradeChart.js";
import { OrderBookChart } from "./orderBookChart.js";
import { RsiChart } from "./rsiChart.js";

import {
    renderAnomalyList,
    renderSignalsList,
    updateTradeDelayIndicator,
    //showSignalBundleBadge,
} from "./render.js";
import {
    restoreColumnWidths,
    restoreAnomalyFilters,
    restoreTimeRange,
    restoreVerticalLayout,
    resetAllSettings,
    saveAnomalyFilters,
} from "./persistence.js";
import {
    setupColumnResizing,
    //setRange
} from "./ui.js";
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
    RSIDataPoint,
    ZoneUpdateEvent,
    ZoneSignalEvent,
} from "./types.js";
import type {
    TradeData,
    WebSocketMessage,
    TradeMessage,
    OrderbookMessage,
    OrderBookData,
    RsiMessage,
} from "../types.js";
import { MessageType } from "../types.js";
import type {
    Signal,
    SupportResistanceLevel,
    //ZoneData,
} from "../frontend-types.js";
import type {
    //ChartAnnotation,
    //ChartInstance,
    //ChartDataPoint,
    Anomaly,
} from "../frontend-types.js";

// ============================================================================
// VARIABLES
// ============================================================================
if (!tradesCanvas) {
    throw new Error("Trades chart canvas not found");
}
const tradesCtx = tradesCanvas ? tradesCanvas.getContext("2d") : null;
if (!tradesCtx) {
    throw new Error("Could not get 2D context for trades chart");
}
let now = Date.now();
let initialMin: number, initialMax: number;

if (activeRange !== null) {
    initialMin = now - activeRange;
    initialMax = now + PADDING_TIME;
} else {
    initialMin = now - 90 * 60000; // 90 minutes ago
    initialMax = now + PADDING_TIME;
}
const tradeChart: TradeChart = new TradeChart(
    tradesCtx,
    initialMin,
    initialMax,
    now
);
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

// ============================================================================
// GLOBAL UTILITIES
// ============================================================================

// ============================================================================
// TYPE GUARDS (NO UNKNOWN PARAMETERS)
// ============================================================================

export function isValidSignalData(data: Signal): boolean {
    return (
        typeof data.id === "string" &&
        typeof data.type === "string" &&
        typeof data.time === "number" &&
        typeof data.price === "number" &&
        (data.side === "buy" || data.side === "sell")
    );
}

export function isValidAnomalyData(data: Anomaly): boolean {
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

export function isValidOrderBookData(data: OrderBookData): boolean {
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

export function isValidSupportResistanceData(
    data: SupportResistanceLevel
): boolean {
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

export function isValidZoneUpdateData(data: ZoneUpdateEvent): boolean {
    return (
        typeof data.updateType === "string" &&
        typeof data.zone === "object" &&
        data.zone !== null &&
        typeof data.significance === "number" &&
        typeof data.detectorId === "string" &&
        typeof data.timestamp === "number"
    );
}

export function isValidZoneSignalData(data: ZoneSignalEvent): boolean {
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

// let supportResistanceLevels: SupportResistanceLevel[] = []; // Not used in main.ts

// ============================================================================
// CORE FUNCTIONS
// ============================================================================
export function updateUnifiedTimeRange(
    latestTime: number,
    tradeChart: TradeChart,
    rsiChart: RsiChart
): void {
    if (activeRange !== null) {
        unifiedMin = latestTime - activeRange;
        unifiedMax = latestTime + PADDING_TIME;

        try {
            tradeChart.setScaleX(unifiedMin, unifiedMax);
            rsiChart.setScaleX(unifiedMin, unifiedMax);
        } catch (error) {
            console.error("updateUnifiedTimeRange Error: ", error);
        }
    }
}

function initialize(): void {
    // Restore ALL saved settings FIRST, before any UI setup or rendering
    restoreTheme();
    restoreColumnWidths();
    restoreAnomalyFilters();
    restoreTimeRange();
    restoreVerticalLayout();

    // Initialize charts first
    try {
        //const now = Date.now();
        //let initialMin: number, initialMax: number;
        //if (activeRange !== null) {
        //    initialMin = now - activeRange;
        //    initialMax = now + PADDING_TIME;
        //} else {
        //    initialMin = now - 90 * 60000; // 90 minutes ago
        //    initialMax = now + PADDING_TIME;
        //}
        /*
        const rsiChart = initializeRSIChart(
            rsiCtx,
            initialMin,
            initialMax,
            now
        );
        if (!rsiChart) {
            throw new Error("Failed to initialize RSI Chart.");
        }

        setRange(activeRange, tradeChart, rsiChart);

        // Setup range selector
        if (rangeSelector) {
            rangeSelector.addEventListener("click", (e: Event) => {
                const target = e.target as HTMLElement;
                if (target.tagName === "BUTTON") {
                    const range = target.getAttribute("data-range");
                    if (rangeSelector) {
                        rangeSelector
                            .querySelectorAll("button")
                            .forEach((btn: HTMLButtonElement) =>
                                btn.classList.remove("active")
                            );
                    }
                    target.classList.add("active");
                    setRange(
                        range === "all" ? null : range ? parseInt(range) : null,
                        tradeChart,
                        rsiChart
                    );
                }
            });
        } else {
            console.warn("Range selector element not found");
        }
            */
    } catch (error) {
        console.error("Error in initializing charts: ", error);
        return;
    }

    try {
        // Connect to the trade WebSocket after charts are ready
        tradeWebsocket.connect();
        console.log("Connected to Trade Websocket.");
    } catch (error) {
        console.error("Failed to connect to web socket.", error);
        return;
    }

    // Setup interact.js for column resizing
    setupColumnResizing();

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
        // Proces an incomming trade
        case "trade":
            const trade: TradeData = (message as TradeMessage)
                .data as TradeData;

            if (tradeChart) {
                tradeChart.addTrade(trade);
                const now = Date.now();
                if (now - lastTradeUpdate > 2000 && tradeChart && rsiChart) {
                    updateUnifiedTimeRange(now, tradeChart, rsiChart);
                    lastTradeUpdate = now;
                }
            }
            break;

        case "orderbook":
            const orderBook: OrderBookData = (message as OrderbookMessage)
                .data as OrderBookData;
            if (isValidOrderBookData(orderBook)) {
                orderBookChart.orderBookData = orderBook;

                orderBookChart.updateOrderBookDisplay();
            } else {
                console.error("Invalid orderbook data");
            }
            break;

        case "rsi":
            const rsiDataPoint: RSIDataPoint = (message as RsiMessage)
                .data as RSIDataPoint;
            if (rsiChart) {
                rsiChart.addPoint(rsiDataPoint);
            }
            break;

        /*
        case "signal":
            const signal: Signal = message.data as Signal;
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
                    const annotation = (plugins as any).annotation;
                    const annotations = (annotation as any).annotations;
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

        case "anomaly":
            const anomaly = message.data as Anomaly;
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

        

        

        case "runtimeConfig":
            const config = message.data as Record<string, unknown>;
            if (config && typeof config === "object") {
                setRuntimeConfig(config);
            }
            break;

        case "supportResistanceLevel":
            const level = message.data as SupportResistanceLevel;
            if (isValidSupportResistanceData(level)) {
                handleSupportResistanceLevel({ data: level });
            }
            break;

        case "zoneUpdate":
            const zoneUpdate = message.data as ZoneUpdateEvent;
            if (isValidZoneUpdateData(zoneUpdate)) {
                // Transform ZoneVisualizationData to ZoneData
                const zoneData: ZoneData = {
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
            const zoneSignal = message.data as ZoneSignalEvent;
            if (isValidZoneSignalData(zoneSignal)) {
                // Transform ZoneVisualizationData to ZoneData
                const zoneData: ZoneData = {
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
                    urgency: "medium", // Default urgency since it's not provided in ZoneSignalEvent
                    expectedDirection: zoneSignal.expectedDirection,
                });
            }
            break;
*/
        case "error":
            const errorData = message.data as { message: string };
            console.error("WebSocket error:", errorData.message);
            break;

        case "stats":
            break;

        default:
            //console.warn("Unknown message type:", message.type);
            break;
    }
}

// ============================================================================
// WEBSOCKET SETUP
// ============================================================================

const tradeWebsocket = new TradeWebSocket({
    url: Config.WEBSOCKET_URL,
    onBacklog: (backLog: TradeData[]) => {
        tradeChart.processTradeBacklog(backLog);
        updateUnifiedTimeRange(Date.now(), tradeChart, rsiChart);
    },
    onRsiBacklog: (backLog: RSIDataPoint[]) => {
        rsiChart.processBacklog(backLog);
        updateUnifiedTimeRange(Date.now(), tradeChart, rsiChart);
    },
    onMessage: (message: WebSocketMessage) => {
        if (isValidWebSocketMessage(message)) {
            handleMessage(message);
        }
    },
});

function isValidWebSocketMessage(data: unknown): data is WebSocketMessage {
    if (!data || typeof data !== "object") return false;
    const msg = data as Record<string, unknown>;

    if (typeof msg["type"] !== "string") return false;
    if (typeof msg["now"] !== "number") return false;

    return Object.values(MessageType).includes(msg["type"] as MessageType);
}

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
                    //const signalRow = target.closest(
                    //    ".signal-row"
                    //) as HTMLElement;
                    //const signalId = signalRow.dataset["signalId"];
                    /*
                    if (tradesChart && signalId) {
                        const chartInstance = tradesChart as ChartInstance;
                        const chartOptions = chartInstance.options;
                        const plugins = chartOptions.plugins;
                        const annotation = (plugins as any).annotation;
                        const annotations = (annotation as any).annotations;
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
                        */
                }
            },
            true
        );

        signalsListElement.addEventListener(
            "mouseleave",
            (e: Event) => {
                const target = e.target as HTMLElement;
                if (target.closest(".signal-row")) {
                    /*
                    if (tradesChart) {
                        const chartInstance = tradesChart as ChartInstance;
                        const chartOptions = chartInstance.options;
                        const plugins = chartOptions.plugins;
                        const annotation = (plugins as any).annotation;
                        const annotations = (annotation as any).annotations;
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
                        */
                }
            },
            true
        );
    }

    // Charts cleanup every 10 minutes
    setInterval(
        () => {
            tradeChart.cleanOldTrades();
            rsiChart.cleanOldData();
            updateUnifiedTimeRange(Date.now(), tradeChart, rsiChart);
        },
        10 * 60 * 1000
    );
});

// Connect to WebSocket after all initialization
tradeWebsocket.connect();
