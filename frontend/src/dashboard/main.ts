// frontend/src/main.ts
// EXACT TYPE-SAFE FRONTEND IMPLEMENTATION
import * as Config from "../config.js";
import {
    tradesCanvas,
    orderBookCanvas,
    rsiCanvas,
    rangeSelector,
    signalFilters,
    signalsList,
    activeRange,
    //dedupTolerance,
    PADDING_FACTOR,
    NINETHY_MINUTES,
} from "./state.js";
import { AnnotationOptions } from "chartjs-plugin-annotation";
import {
    cleanupOldSupportResistanceLevels,
    cleanupOldZones,

    //checkSupportResistanceBreaches,
    buildSignalLabel,
    handleSupportResistanceLevel,
    handleZoneUpdate,
    handleZoneSignal,
} from "./charts.js";
import { TradeChart } from "./tradeChart.js";
import { OrderBookChart } from "./orderBookChart.js";
import { RsiChart } from "./rsiChart.js";
import { HTMLActions } from "./htmlActions.js";

import { renderSignalsList, updateTradeDelayIndicator } from "./render.js";
import {
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
    SignalMessage,
    AnomalyMessage,
    SupportResistanceLevelMessage,
    ZoneUpdateMessage,
    ZoneSignalMessage,
} from "../types.js";
import { MessageType } from "../types.js";
import type {
    Signal,
    SupportResistanceLevel,
    ZoneData,
} from "../frontend-types.js";
import type { Anomaly } from "../frontend-types.js";

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
    const padding = Math.ceil(activeRange / PADDING_FACTOR);
    initialMin = now - activeRange;
    initialMax = now + padding;
} else {
    initialMin = now - 90 * 60000; // 90 minutes ago
    initialMax = Math.ceil(NINETHY_MINUTES / PADDING_FACTOR);
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

const htmlActions = new HTMLActions(
    tradeChart,
    rsiChart,
    activeRange,
    rangeSelector
);

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

// let supportResistanceLevels: SupportResistanceLevel[] = []; // Not used in main.ts

// ============================================================================
// CORE FUNCTIONS
// ============================================================================

function initialize(): void {
    try {
        htmlActions.restoreTheme();
        htmlActions.restoreColumnDimensions();
        htmlActions.restoreAnomalyFilters();
        htmlActions.restoreTimeRange();
        htmlActions.setRangeSelector();
        htmlActions.setupColumnResizing();
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

    // Setup reset layout button
    const resetLayoutBtn = document.getElementById("resetLayout");
    if (resetLayoutBtn) {
        resetLayoutBtn.addEventListener("click", () => {
            if (
                confirm(
                    "Reset all dashboard settings to default? This will clear your saved layout, filter, and time range preferences."
                )
            ) {
                htmlActions.resetAllSettings();
            }
        });
    }

    // Setup theme toggle button
    const themeToggleBtn = document.getElementById("themeToggle");
    if (themeToggleBtn) {
        themeToggleBtn.addEventListener("click", htmlActions.toggleTheme);
        htmlActions.updateThemeToggleButton();
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
            const currentTheme = htmlActions.getCurrentTheme();
            if (currentTheme === "system") {
                htmlActions.updateChartTheme(htmlActions.getSystemTheme());
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
                    htmlActions.updateUnifiedTimeRange(now);
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

        case "anomaly":
            const anomaly = (message as AnomalyMessage).data as Anomaly;
            htmlActions.addAnomaly(anomaly);
            break;

        case "signal":
            const signal: Signal = (message as SignalMessage).data as Signal;
            if (isValidSignalData(signal)) {
                const label = buildSignalLabel(signal);
                const id = signal.id;
                signalsList.unshift(signal);
                if (signalsList.length > 50) {
                    signalsList.length = 50;
                }
                renderSignalsList();

                if (tradeChart.tradeChart) {
                    const chartInstance = tradeChart.tradeChart;
                    const chartOptions = chartInstance.options;
                    const plugins = chartOptions.plugins;
                    const annotation = (plugins as any).annotation;
                    const annotations = annotation.annotations as Record<
                        string,
                        AnnotationOptions<"label">
                    >;
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
                        } as AnnotationOptions<"label">;
                        tradeChart.tradeChart.update("default");
                    }
                }
                console.log("Signal label added:", label);
            }
            break;

        case "supportResistanceLevel":
            const level = (message as SupportResistanceLevelMessage)
                .data as SupportResistanceLevel;
            if (isValidSupportResistanceData(level)) {
                handleSupportResistanceLevel({ data: level });
            }
            break;

        case "zoneUpdate":
            const zoneUpdate = (message as ZoneUpdateMessage)
                .data as ZoneUpdateEvent;
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
            const zoneSignal = (message as ZoneSignalMessage)
                .data as ZoneSignalEvent;
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
        default:
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
        htmlActions.updateUnifiedTimeRange(Date.now());
    },
    onRsiBacklog: (backLog: RSIDataPoint[]) => {
        rsiChart.processBacklog(backLog);
        htmlActions.updateUnifiedTimeRange(Date.now());
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
                    if (box.checked) htmlActions.anomalyFilters.add(box.value);
                    else htmlActions.anomalyFilters.delete(box.value);
                    htmlActions.renderAnomalyList();
                    htmlActions.saveAnomalyFilters();
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
            htmlActions.updateUnifiedTimeRange(Date.now());
        },
        10 * 60 * 1000
    );
});

// Connect to WebSocket after all initialization
tradeWebsocket.connect();
