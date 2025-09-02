import {
    tradesCanvas,
    orderBookCanvas,
    rsiCanvas,
    rangeSelector,
    anomalyFilters,
    signalFilters,
    trades,
    //orderBookData,
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

let unifiedMin = 0;
let unifiedMax = 0;

let orderBookData = {
    priceLevels: [],
};
let supportResistanceLevels = [];

const messageQueue = [];
let isProcessingQueue = false;

/**
 * Centralized function to update the time range for both charts.
 * @param {number} latestTime - The latest timestamp to base the range on.
 */
function updateUnifiedTimeRange(latestTime) {
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
 * @param {object} trade - The trade object to validate.
 * @returns {boolean} - True if the trade is valid, false otherwise.
 */
function isValidTrade(trade) {
    return (
        trade &&
        typeof trade.time === "number" &&
        typeof trade.price === "number" &&
        typeof trade.quantity === "number" &&
        typeof trade.orderType === "string"
    );
}

/**
 * Creates a trade object for the chart.
 * @param {number} time - The timestamp of the trade.
 * @param {number} price - The price of the trade.
 * @param {number} quantity - The quantity of the trade.
 * @param {string} orderType - The order type (e.g., 'buy' or 'sell').
 * @returns {{x: number, y: number, v: number, t: string}}
 */
function createTrade(time, price, quantity, orderType) {
    return {
        x: time,
        y: price,
        quantity: quantity,
        orderType: orderType,
    };
}



function initialize() {
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

    const rsiCtx = rsiCanvas.getContext("2d");
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
        rangeSelector.addEventListener("click", (e) => {
            if (e.target.tagName === "BUTTON") {
                const range = e.target.getAttribute("data-range");

                // Update UI active state
                rangeSelector
                    .querySelectorAll("button")
                    .forEach((btn) => btn.classList.remove("active"));
                e.target.classList.add("active");

                setRange(range === "all" ? null : parseInt(range));
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

function processMessageQueue() {
    if (messageQueue.length === 0) {
        isProcessingQueue = false;
        requestAnimationFrame(processMessageQueue);
        return;
    }

    isProcessingQueue = true;
    const message = messageQueue.shift();

    try {
        // The actual message processing logic
        handleMessage(message);
    } catch (error) {
        console.error("Error processing message from queue:", error);
    }

    requestAnimationFrame(processMessageQueue);
}

function handleMessage(message) {
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
            anomalyList.unshift(message.data);
            // Limit list length
            if (anomalyList.length > 100) {
                anomalyList.length = 100;
            }
            renderAnomalyList();
            // Badge only for high/critical
            if (
                message.data.severity === "high" ||
                message.data.severity === "critical"
            ) {
                //showAnomalyBadge(message.data);
            }
            // Annotate chart if desired (optional, see below)
            //addAnomalyChartLabel(message.data);
            break;
        case "trade":
            const trade = message.data;
            if (isValidTrade(trade)) {
                trades.push(
                    createTrade(
                        trade.time,
                        trade.price,
                        trade.quantity,
                        trade.orderType
                    )
                );

                tradesChart.data.datasets[0].data = [...trades];

                const line =
                    tradesChart.options.plugins.annotation.annotations
                        .lastPriceLine;
                line.yMin = trade.price;
                line.yMax = trade.price;

                updateUnifiedTimeRange(trade.time);
                updateYAxisBounds(trades);

                // Check for support/resistance zone breaches
                checkSupportResistanceBreaches(trade.price, trade.time);

                scheduleTradesChartUpdate();
            }
            break;

        case "rsi":
            const rsiDataPoint = message.data;
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
                        const updateSuccess = safeUpdateRSIChart([
                            ...rsiData,
                        ]);
                        window.rsiUpdateTimeout = null;

                        if (!updateSuccess) {
                            console.error(
                                "Failed to update RSI chart with batched data"
                            );
                        }
                    }, 100); // Update at most every 100ms
                }
            } else {
                console.warn(
                    "Invalid RSI data received:",
                    rsiDataPoint
                );
            }
            break;

        case "rsi_backlog":
            console.log(
                `${message.data.length} RSI backlog data received.`
            );

            // Process backlog data and replace chart data entirely
            const backlogData = [];
            const processBacklogChunk = (data, startIndex = 0) => {
                const chunkSize = 10; // Process 10 points at a time
                const endIndex = Math.min(
                    startIndex + chunkSize,
                    data.length
                );

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
                    setTimeout(
                        () => processBacklogChunk(data, endIndex),
                        0
                    );
                } else {
                    // All chunks processed - replace rsiData with backlog
                    if (backlogData.length > 0) {
                        rsiData.length = 0; // Clear existing data
                        rsiData.push(...backlogData); // Add backlog data

                        // Update chart immediately with backlog data
                        if (rsiChart) {
                            rsiChart.data.datasets[0].data = [
                                ...rsiData,
                            ];
                            rsiChart.update("none");
                        }

                        console.log(
                            `${backlogData.length} RSI backlog points loaded and chart updated`
                        );
                    }
                }
            };

            // Process backlog and replace data
            processBacklogChunk(message.data);
            break;

        case "signal":
            const label = buildSignalLabel(message.data);
            const id = message.data.id;

            // Add to signals list
            signalsList.unshift(message.data);
            // Limit list length
            if (signalsList.length > 50) {
                signalsList.length = 50;
            }
            renderSignalsList();

            // Add to chart
            tradesChart.options.plugins.annotation.annotations[id] = {
                type: "label",
                xValue: message.data.time,
                yValue: message.data.price,
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
            break;

        case "signal_backlog":
            console.log(
                `${message.data.length} backlog signals received.`
            );

            // Process backlog signals in reverse order (oldest first)
            const backlogSignals = [...message.data].reverse();

            for (const signal of backlogSignals) {
                const normalizedSignal = {
                    id: signal.id,
                    type:
                        signal.originalSignals?.[0]?.type ||
                        "confirmed",
                    side:
                        signal.originalSignals?.[0]?.metadata?.side ||
                        "unknown",
                    price: signal.finalPrice || signal.price,
                    time: signal.confirmedAt || signal.time,
                    confidence: signal.confidence,
                    // Include original signal data for buildSignalLabel
                    ...signal,
                };

                const signalLabel = buildSignalLabel(normalizedSignal);
                const signalId = signal.id;

                // Add to signals list - use unshift to maintain newest-first order
                signalsList.unshift(normalizedSignal);

                // Add to chart
                tradesChart.options.plugins.annotation.annotations[
                    signalId
                ] = {
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
            tradesChart.update("none");
            console.log(
                `${backlogSignals.length} backlog signals added to chart and list`
            );
            break;

        case "signal_bundle":
            if (Array.isArray(message.data) && message.data.length) {
                const filtered = message.data.filter((s) => {
                    const last = signalsList[0];
                    if (!last) return true;
                    const diff = Math.abs(s.price - last.price);
                    return diff > last.price * dedupTolerance;
                });

                filtered.forEach((signal) => {
                    signalsList.unshift(signal);

                    const label = buildSignalLabel(signal);
                    tradesChart.options.plugins.annotation.annotations[
                        signal.id
                    ] = {
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
                });

                if (signalsList.length > 50) {
                    signalsList.length = 50;
                }

                renderSignalsList();
                tradesChart.update("none");
                showSignalBundleBadge(filtered);
            }
            break;

        case "runtimeConfig":
            if (message.data && typeof message.data === "object") {
                setRuntimeConfig(message.data);
            }
            break;

        case "supportResistanceLevel":
            console.log(
                "Support/Resistance level received:",
                message.data
            );
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
                !Array.isArray(message.data.priceLevels)
            ) {
                console.error("Invalid orderbook data");
                return;
            }

            orderBookData = message.data;

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
            box.addEventListener("change", () => {
                if (box.checked) anomalyFilters.add(box.value);
                else anomalyFilters.delete(box.value);
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
                box.addEventListener("change", () => {
                    if (box.checked) signalFilters.add(box.value);
                    else signalFilters.delete(box.value);
                    renderSignalsList();
                });
            });
    }

    // Setup signal hover interactions for chart transparency
    const signalsListElement = document.getElementById("signalsList");
    if (signalsListElement) {
        signalsListElement.addEventListener(
            "mouseenter",
            (e) => {
                if (e.target.closest(".signal-row")) {
                    const signalRow = e.target.closest(".signal-row");
                    const signalId = signalRow.dataset.signalId;

                    // Make other chart annotations transparent
                    if (
                        tradesChart?.options?.plugins?.annotation?.annotations
                    ) {
                        Object.keys(
                            tradesChart.options.plugins.annotation.annotations
                        ).forEach((key) => {
                            if (key !== signalId && key !== "lastPriceLine") {
                                const annotation =
                                    tradesChart.options.plugins.annotation
                                        .annotations[key];
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
            (e) => {
                if (e.target.closest(".signal-row")) {
                    // Restore normal transparency for all annotations
                    if (
                        tradesChart?.options?.plugins?.annotation?.annotations
                    ) {
                        Object.keys(
                            tradesChart.options.plugins.annotation.annotations
                        ).forEach((key) => {
                            if (key !== "lastPriceLine") {
                                const annotation =
                                    tradesChart.options.plugins.annotation
                                        .annotations[key];
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
            const originalLength = trades.length;

            // Find the index of the first trade to keep. This is also the number of trades to remove.
            let tradesToRemoveCount = trades.findIndex((t) => t.x >= cutoffTime);

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
                    tradesChart.data.datasets[0].data = trades;
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
    pingIntervalTime: 10000,
    pongWaitTime: 5000,
    onBacklog: (backLog) => {
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

        tradesChart.data.datasets[0].data = [...trades];

        if (trades.length > 0) {
            const latestTrade = trades[trades.length - 1];
            const latestTime = latestTrade.x;
            const latestPrice = latestTrade.y;

            // Update price line
            const line =
                tradesChart.options.plugins.annotation.annotations
                    .lastPriceLine;
            line.yMin = latestPrice;
            line.yMax = latestPrice;

            // Update axes and annotations
            updateUnifiedTimeRange(latestTime);
            updateYAxisBounds(trades);
        }

        scheduleTradesChartUpdate();
    },

    onMessage: (message) => {
        messageQueue.push(message);
        if (!isProcessingQueue) {
            processMessageQueue();
        }
    },
});

// Connect to WebSocket after all initialization
tradeWebsocket.connect();
