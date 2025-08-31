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

/**
 * Detects circular references in objects to prevent infinite recursion.
 * @param {any} obj - The object to check for circular references.
 * @param {WeakSet} visited - Set of already visited objects.
 * @returns {boolean} - True if circular reference is found, false otherwise.
 */
function hasCircularReference(obj, visited = new WeakSet()) {
    if (!obj || typeof obj !== "object") {
        return false;
    }

    if (visited.has(obj)) {
        return true;
    }

    visited.add(obj);

    for (const key in obj) {
        if (hasCircularReference(obj[key], visited)) {
            return true;
        }
    }

    return false;
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

    // Set up efficient trade cleanup every 15 minutes
    // This prevents memory bloat while maintaining 90 minutes of visible trades
    setInterval(
        () => {
            const cutoffTime = Date.now() - 90 * 60 * 1000; // 90 minutes ago
            const indexToKeep = trades.findIndex((t) => t.x >= cutoffTime);

            if (indexToKeep > 0) {
                // Remove all old trades in one efficient operation
                trades.splice(0, indexToKeep);

                // Update chart after cleanup
                if (tradesChart) {
                    tradesChart.data.datasets[0].data = [...trades];
                    scheduleTradesChartUpdate();
                }

                console.log(
                    `Cleaned up ${indexToKeep} old trades, ${trades.length} remaining`
                );
            }
        },
        15 * 60 * 1000
    ); // Every 15 minutes
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
        try {
            // Check if message is null or undefined
            if (!message) {
                console.warn("Received null or undefined message");
                return;
            }

            // Add circular reference check for message.data
            if (message.data && typeof message.data === "object") {
                if (hasCircularReference(message.data)) {
                    console.error(
                        "Message contains circular reference, skipping:",
                        message.type
                    );
                    return;
                }
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
                    console.log("Anomaly received:", message.data);
                    anomalyList.unshift(message.data);
                    // Limit list length
                    if (anomalyList.length > 100)
                        anomalyList = anomalyList.slice(0, 100);
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
                        // Add to RSI data array
                        rsiData.push(rsiDataPoint);

                        // Limit data size
                        if (rsiData.length > MAX_RSI_DATA) {
                            rsiData.shift();
                        }

                        // Update RSI chart with new data
                        const updateSuccess = safeUpdateRSIChart([...rsiData]);

                        if (!updateSuccess) {
                            console.error(
                                "Failed to update RSI chart with data:",
                                rsiDataPoint
                            );
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
                    rsiData.length = 0; // Clear existing data

                    for (const rsiPoint of message.data) {
                        if (
                            rsiPoint &&
                            typeof rsiPoint.time === "number" &&
                            typeof rsiPoint.rsi === "number"
                        ) {
                            rsiData.push(rsiPoint);
                        }
                    }

                    // Update RSI chart with backlog data
                    if (rsiChart && rsiData.length > 0) {
                        rsiChart.data.datasets[0].data = [...rsiData];
                    }

                    console.log(
                        `${rsiData.length} RSI backlog points added to chart`
                    );
                    break;

                case "signal":
                    const label = buildSignalLabel(message.data);
                    const id = message.data.id;

                    // Add to signals list
                    signalsList.unshift(message.data);
                    // Limit list length
                    if (signalsList.length > 50) {
                        signalsList = signalsList.slice(0, 50);
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
                        signalsList = signalsList.slice(-50); // Keep most recent 50
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
                            if (signalsList.length > 50) {
                                signalsList = signalsList.slice(0, 50);
                            }

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

                        renderSignalsList();
                        tradesChart.update("none");
                        showSignalBundleBadge(filtered);
                    }
                    break;

                case "rsi_backlog":
                    console.log(
                        `${message.data.length} RSI backlog data received.`
                    );
                    rsiData.length = 0; // Clear existing data

                    for (const rsiPoint of message.data) {
                        if (
                            rsiPoint &&
                            typeof rsiPoint.time === "number" &&
                            typeof rsiPoint.rsi === "number"
                        ) {
                            rsiData.push(rsiPoint);
                        }
                    }

                    // Update RSI chart with backlog data
                    if (rsiChart && rsiData.length > 0) {
                        rsiChart.data.datasets[0].data = [...rsiData];
                    }

                    console.log(
                        `${rsiData.length} RSI backlog points added to chart`
                    );
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
                        console.error(
                            "Invalid order book data: priceLevels is missing or not an array",
                            message.data
                        );
                        return;
                    }

                    orderBookData = message.data;

                    // Enhanced debug: Log depletion data validation and statistics
                    if (
                        orderBookData.priceLevels &&
                        orderBookData.priceLevels.length > 0
                    ) {
                        // Only log detailed info once per session to avoid spam
                        if (!window.depletionDataLogged) {
                            const depletionLevels =
                                orderBookData.priceLevels.filter(
                                    (level) => level.depletionRatio > 0
                                );

                            if (depletionLevels.length > 0) {
                                const sampleLevel = depletionLevels[0];
                                console.log(
                                    "📊 Depletion data received from backend:",
                                    {
                                        totalLevels:
                                            orderBookData.priceLevels.length,
                                        depletionLevels: depletionLevels.length,
                                        samplePrice: sampleLevel.price,
                                        depletionRatio:
                                            sampleLevel.depletionRatio,
                                        depletionVelocity:
                                            sampleLevel.depletionVelocity,
                                        originalBidVolume:
                                            sampleLevel.originalBidVolume,
                                        originalAskVolume:
                                            sampleLevel.originalAskVolume,
                                        midPrice: orderBookData.midPrice,
                                        hasDepletionData: true,
                                    }
                                );

                                // Log depletion statistics
                                const avgDepletion =
                                    depletionLevels.reduce(
                                        (sum, level) =>
                                            sum + level.depletionRatio,
                                        0
                                    ) / depletionLevels.length;

                                const highDepletionLevels =
                                    depletionLevels.filter(
                                        (level) => level.depletionRatio > 0.5
                                    );

                                console.log("📈 Depletion statistics:", {
                                    averageDepletionRatio:
                                        (avgDepletion * 100).toFixed(1) + "%",
                                    highDepletionCount:
                                        highDepletionLevels.length,
                                    totalBidVolume:
                                        orderBookData.totalBidVolume,
                                    totalAskVolume:
                                        orderBookData.totalAskVolume,
                                    timestamp: new Date(
                                        orderBookData.timestamp
                                    ).toLocaleTimeString(),
                                });
                            } else {
                                console.log(
                                    "📊 Orderbook data received (no depletion yet):",
                                    {
                                        priceLevelsCount:
                                            orderBookData.priceLevels.length,
                                        samplePrice:
                                            orderBookData.priceLevels[0]?.price,
                                        midPrice: orderBookData.midPrice,
                                        totalBidVolume:
                                            orderBookData.totalBidVolume,
                                        totalAskVolume:
                                            orderBookData.totalAskVolume,
                                        hasDepletionData: false,
                                        timestamp: new Date(
                                            orderBookData.timestamp
                                        ).toLocaleTimeString(),
                                    }
                                );
                            }
                            window.depletionDataLogged = true;
                        }

                        // Periodic validation logging (every 30 seconds)
                        if (
                            !window.lastDepletionValidation ||
                            Date.now() - window.lastDepletionValidation > 30000
                        ) {
                            const currentLevels = orderBookData.priceLevels;
                            const depletionLevels = currentLevels.filter(
                                (level) => level.depletionRatio > 0
                            );

                            if (depletionLevels.length > 0) {
                                const staleLevels = depletionLevels.filter(
                                    (level) => {
                                        if (!level.timestamp) return false;
                                        return (
                                            Date.now() - level.timestamp >
                                            10 * 60 * 1000
                                        ); // 10 minutes
                                    }
                                );

                                if (staleLevels.length > 0) {
                                    console.warn(
                                        "⚠️ Stale depletion data detected:",
                                        {
                                            staleCount: staleLevels.length,
                                            totalDepletionLevels:
                                                depletionLevels.length,
                                            sampleStalePrice:
                                                staleLevels[0]?.price,
                                            ageMinutes: Math.round(
                                                (Date.now() -
                                                    staleLevels[0]?.timestamp) /
                                                    60000
                                            ),
                                        }
                                    );
                                }
                            }

                            window.lastDepletionValidation = Date.now();
                        }
                    }

                    // Display the data directly from backend (already 1-tick precision)
                    if (orderBookChart) {
                        updateOrderBookDisplay(orderBookData);
                    } else {
                        console.warn(
                            "Order book chart not initialized; skipping update"
                        );
                    }
                    break;
            }
        } catch (error) {
            console.error("Error parsing trade WebSocket message:", error);
        }
    },
});

// Connect to WebSocket after all initialization
tradeWebsocket.connect();
