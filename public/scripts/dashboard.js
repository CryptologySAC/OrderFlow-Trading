/**
 * Trading dashboard for visualizing real-time trades and order book data via WebSocket.
 * Displays a scatter chart for trades and a bar chart for order book, with interactive UI.
 * Uses Chart.js for charts, chartjs-plugin-annotation for annotations, and Interact.js for drag/resize.
 * @module TradingDashboard
 */

import { TradeWebSocket } from "./websocket.js";

const TRADE_WEBSOCKET_URL = "wss://api.cryptology.pe/ltcusdt_trades";
const MAX_TRADES = 50000;
const MAX_RECONNECT_ATTEMPTS = 10;
const RECONNECT_DELAY_MS = 1000;
const PING_INTERVAL_MS = 10000;
const PONG_WAIT_MS = 5000;
const PADDING_TIME = 300000; // 5 minutes
const FIFTEEN_MINUTES = 15 * 60 * 1000; // 15 minutes
const TRADE_TIMEOUT_MS = 10000; // 10 seconds
const GRID_SIZE = 20; // snapping grid for draggable/resizable elements

// DOM references
const tradesCanvas = document.getElementById("tradesChart");
const orderBookCanvas = document.getElementById("orderBookChart");
const delayGaugeCanvas = document.getElementById("delayGauge");
const rangeSelector = document.querySelector(".rangeSelector");
const directionText = document.getElementById("directionText");
const ratioText = document.getElementById("ratioText");
const supportText = document.getElementById("supportText");
const stabilityText = document.getElementById("stabilityText");
const volumeImbalance = document.getElementById("volumeImbalance");
const orderBookContainer = document.getElementById("orderBookContainer");

// Charts
let tradesChart = null;
let orderBookChart = null;
let delayGauge = null;

let anomalyList = [];
const anomalySeverityOrder = ["critical", "high", "medium", "info"];
let anomalyFilters = new Set(["critical", "high"]);

// Used to control badge display
let badgeTimeout = null;
let latestBadgeElem = null;

function snap(value) {
    return Math.round(value / GRID_SIZE) * GRID_SIZE;
}

function rectsOverlap(r1, r2) {
    return !(
        r1.right <= r2.left ||
        r1.left >= r2.right ||
        r1.bottom <= r2.top ||
        r1.top >= r2.bottom
    );
}

function isOverlapping(target) {
    const rect = target.getBoundingClientRect();
    const others = Array.from(
        document.querySelectorAll(
            ".chart-container, .anomaly-list-container, .gauge-container"
        )
    ).filter((el) => el !== target);
    return others.some((el) => rectsOverlap(rect, el.getBoundingClientRect()));
}

function getAnomalyIcon(type) {
    switch (type) {
        case "flash_crash":
            return "⚡";
        case "liquidity_void":
            return "💧";
        case "absorption":
            return "A";
        case "exhaustion":
            return "E";
        case "whale_activity":
            return "🐋";
        case "momentum_ignition":
            return "🔥";
        case "spoofing":
            return "👻";
        case "iceberg_order":
            return "🧊";
        case "orderbook_imbalance":
            return "≠";
        case "flow_imbalance":
            return "⇄";
        default:
            return "•";
    }
}
function capitalize(str) {
    return str[0].toUpperCase() + str.slice(1);
}
function formatAgo(ts) {
    const s = Math.floor((Date.now() - ts) / 1000);
    if (s < 60) return `${s}s ago`;
    const m = Math.floor(s / 60);
    return `${m}m ago`;
}

function renderAnomalyList() {
    const listElem = document.getElementById("anomalyList");
    if (!listElem) return;
    // Filter
    const filtered = anomalyList.filter((a) => anomalyFilters.has(a.severity));
    listElem.innerHTML = filtered
        .map(
            (a) => `
            <div class="anomaly-row ${a.severity}">
                <span class="anomaly-type">${getAnomalyIcon(a.type)}</span>
                <span>${capitalize(a.type)}</span>
                <span style="margin-left:8px">${a.affectedPriceRange.min.toFixed(2)} - ${a.affectedPriceRange.max.toFixed(2)}</span>
                <span style="margin-left:8px">${a.severity}</span>
                <span style="margin-left:8px">${a.recommendedAction}</span>
                <span style="margin-left:auto">${formatAgo(a.detectedAt || a.time || Date.now())}</span>
            </div>
        `
        )
        .join("");
}
function showAnomalyBadge(anomaly) {
    // Remove previous badge
    if (latestBadgeElem) latestBadgeElem.remove();
    const badge = document.createElement("div");
    badge.className = `anomaly-badge ${anomaly.severity}`;
    badge.innerHTML = `${getAnomalyIcon(anomaly.type)} ${capitalize(anomaly.type)} @ ${anomaly.price.toFixed(2)}`;
    document.body.appendChild(badge);
    latestBadgeElem = badge;
    if (badgeTimeout) clearTimeout(badgeTimeout);
    badgeTimeout = setTimeout(() => {
        badge.remove();
        latestBadgeElem = null;
    }, 4000);
}

// Improve Trade Chart update performance
let chartUpdateScheduled = false;
function scheduleTradesChartUpdate() {
    if (!chartUpdateScheduled) {
        chartUpdateScheduled = true;
        requestAnimationFrame(() => {
            tradesChart.update("none");
            chartUpdateScheduled = false;
        });
    }
}

// Improve Orderbook Chart performance
let orderBookUpdateTimeout = null;
function scheduleOrderBookUpdate() {
    if (orderBookUpdateTimeout) clearTimeout(orderBookUpdateTimeout);
    orderBookUpdateTimeout = setTimeout(() => {
        orderBookChart.update();
    }, 100); // Update 10 times/second max
}

/**
 * Updates Y-axis bounds based on visible trades
 */
function updateYAxisBounds() {
    if (!tradesChart || trades.length === 0) return;

    const xMin = tradesChart.options.scales.x.min;
    const xMax = tradesChart.options.scales.x.max;

    const visibleTrades = trades.filter((t) => t.x >= xMin && t.x <= xMax);

    if (visibleTrades.length === 0) return;

    const prices = visibleTrades.map((t) => t.y);
    const yMin = Math.min(...prices);
    const yMax = Math.max(...prices);

    tradesChart.options.scales.y.suggestedMin = yMin - (yMax - yMin) * 0.05;
    tradesChart.options.scales.y.suggestedMax = yMax + (yMax - yMin) * 0.05;
    delete tradesChart.options.scales.y.min;
    delete tradesChart.options.scales.y.max;
}

/**
 * Updates 15-minute annotations efficiently
 */
function updateTimeAnnotations(latestTime, activeRange) {
    const annotations = tradesChart.options.plugins.annotation.annotations;
    const min = latestTime - activeRange;
    const max = latestTime + PADDING_TIME;
    Object.keys(annotations).forEach((key) => {
        if (!isNaN(key) && (key < min || key > max)) delete annotations[key];
    });

    let time = Math.ceil(min / FIFTEEN_MINUTES) * FIFTEEN_MINUTES;
    while (time <= max) {
        if (!annotations[time]) {
            annotations[time] = {
                type: "line",
                xMin: time,
                xMax: time,
                borderColor: "rgba(102, 102, 102, 0.4)",
                borderWidth: 2,
                z: 1,
            };
        }
        time += FIFTEEN_MINUTES;
    }
}

function createTrade(x, y, quantity, orderType) {
    return { x, y, quantity, orderType };
}

/**
 * Build a label string for orderflow signals for chart annotations.
 * @param {Signal} signal - Signal object as per the new interface
 * @returns {string} - Formatted label text for Chart.js or other UI
 */
function buildSignalLabel(signal) {
    if (!signal) return "Invalid Signal";

    // 1. Main signal summary (type/side/price/time)
    let label = `[${signal.type?.toUpperCase() ?? "?"}] ${signal.side?.toUpperCase() ?? "?"} @ ${signal.price?.toFixed(2) ?? "?"}`;
    label += signal.time
        ? `\n${new Date(signal.time).toLocaleTimeString()}`
        : "";

    // 2. TP/SL
    if (signal.takeProfit) label += `\nTP: ${signal.takeProfit.toFixed(2)}`;
    if (signal.stopLoss) label += ` | SL: ${signal.stopLoss.toFixed(2)}`;

    // 3. Confidence/Confirmations
    if (signal.confidence !== undefined)
        label += `\nConf: ${(signal.confidence * 100).toFixed(0)}%`;
    if (signal.confirmations?.length)
        label += ` | Confirms: ${signal.confirmations.join(", ")}`;

    // 4. Zone/Volumes/Refilled
    if (signal.zone !== undefined) label += `\nZone: ${signal.zone}`;
    if (signal.totalAggressiveVolume !== undefined)
        label += ` | Agg: ${Number(signal.totalAggressiveVolume).toFixed(2)}`;
    if (signal.passiveVolume !== undefined)
        label += ` | Passive: ${Number(signal.passiveVolume).toFixed(2)}`;
    if (signal.refilled !== undefined)
        label += ` | Ref: ${signal.refilled ? "Yes" : "No"}`;

    // 5. Reason/closeReason
    if (signal.closeReason) label += `\nReason: ${signal.closeReason}`;

    // 6. Anomaly
    if (signal.anomaly && signal.anomaly.detected)
        label += `\nAnomaly: ${signal.anomaly.type || "?"} (${signal.anomaly.severity || "?"})`;

    // 7. Signal-specific details
    if (signal.signalData) {
        if ("absorptionType" in signal.signalData) {
            label += `\nAbsorption: ${signal.signalData.absorptionType}`;
            if (signal.signalData.spoofed) label += " | Spoofed!";
            if (signal.signalData.recentAggressive !== undefined)
                label += `\nAgg: ${Number(signal.signalData.recentAggressive).toFixed(2)}`;
            if (signal.signalData.rollingZonePassive !== undefined)
                label += ` | RollingPassive: ${Number(signal.signalData.rollingZonePassive).toFixed(2)}`;
            if (signal.signalData.avgPassive !== undefined)
                label += ` | AvgPassive: ${Number(signal.signalData.avgPassive).toFixed(2)}`;
        }
        if ("exhaustionType" in signal.signalData) {
            label += `\nExhaustion: ${signal.signalData.exhaustionType}`;
            if (signal.signalData.spoofed) label += " | Spoofed!";
            if (signal.signalData.recentAggressive !== undefined)
                label += `\nAgg: ${Number(signal.signalData.recentAggressive).toFixed(2)}`;
            if (signal.signalData.oppositeQty !== undefined)
                label += ` | OppQty: ${Number(signal.signalData.oppositeQty).toFixed(2)}`;
            if (signal.signalData.avgLiquidity !== undefined)
                label += ` | AvgBook: ${Number(signal.signalData.avgLiquidity).toFixed(2)}`;
            if (signal.signalData.spread !== undefined)
                label += ` | Spread: ${(signal.signalData.spread * 100).toFixed(3)}%`;
        }
        if ("swingType" in signal.signalData) {
            label += `\nSwing: ${signal.signalData.swingType} | Str: ${signal.signalData.strength}`;
        }
        if ("divergence" in signal.signalData) {
            label += `\nDiv: ${signal.signalData.divergence}`;
        }
        // Add more per-type details as needed.
    }

    // 8. Invalidation (for signal lifecycle tracking)
    if (signal.isInvalidated) label += "\n❌ Invalidated";

    // Optional: truncate if label is too long for chart
    if (label.length > 250) label = label.slice(0, 245) + "...";

    return label;
}

// Configure Websocket
const tradeWebsocket = new TradeWebSocket({
    url: TRADE_WEBSOCKET_URL,
    maxTrades: MAX_TRADES,
    maxReconnectAttempts: MAX_RECONNECT_ATTEMPTS,
    reconnectDelay: RECONNECT_DELAY_MS,
    pingIntervalTime: PING_INTERVAL_MS,
    pongWaitTime: PONG_WAIT_MS,
    onBacklog: (backLog) => {
        console.log(`${backLog.length} backlog trades received.`);
        if (delayGauge) {
            delayGauge.value = 0;
            delayGauge.title = "Loading Backlog";
        }

        trades.length = 0;
        for (const trade of backLog) {
            if (isValidTrade(trade)) {
                if (trades.length < MAX_TRADES) {
                    trades.push(
                        createTrade(
                            trade.time,
                            trade.price,
                            trade.quantity,
                            trade.orderType
                        )
                    );
                } else {
                    const recycled = trades.shift(); // Remove the oldest trade
                    recycled.x = trade.time;
                    recycled.y = trade.price;
                    recycled.quantity = trade.quantity;
                    recycled.orderType = trade.orderType;
                    trades.push(recycled); // Push updated object
                }
            }
        }
        while (trades.length > MAX_TRADES) trades.shift();

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
            if (activeRange !== null) {
                tradesChart.options.scales.x.min = latestTime - activeRange;
                tradesChart.options.scales.x.max = latestTime + PADDING_TIME;
                updateYAxisBounds(trades);
                updateTimeAnnotations(latestTime, activeRange);
            }
        }

        scheduleTradesChartUpdate();
    },

    onMessage: (message) => {
        try {
            const receiveTime = Date.now();
            const messageTime = message.now ?? 0;
            const delay = receiveTime - messageTime;
            if (delay >= 0 && delayGauge) {
                delayGauge.value = parseInt(delay, 10);
            }

            if (tradeTimeoutId) clearTimeout(tradeTimeoutId);
            tradeTimeoutId = setTimeout(
                () => setGaugeTimeout(delayGauge),
                TRADE_TIMEOUT_MS
            );

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
                        if (trades.length < MAX_TRADES) {
                            trades.push(
                                createTrade(
                                    trade.time,
                                    trade.price,
                                    trade.quantity,
                                    trade.orderType
                                )
                            );
                        } else {
                            const recycled = trades.shift(); // Remove the oldest trade
                            recycled.x = trade.time;
                            recycled.y = trade.price;
                            recycled.quantity = trade.quantity;
                            recycled.orderType = trade.orderType;
                            trades.push(recycled); // Push updated object
                        }
                        while (trades.length > MAX_TRADES) trades.shift();

                        tradesChart.data.datasets[0].data = [...trades];

                        const line =
                            tradesChart.options.plugins.annotation.annotations
                                .lastPriceLine;
                        line.yMin = trade.price;
                        line.yMax = trade.price;

                        if (activeRange !== null) {
                            tradesChart.options.scales.x.min =
                                trade.time - activeRange;
                            tradesChart.options.scales.x.max =
                                trade.time + PADDING_TIME;
                            updateYAxisBounds(trades);
                            updateTimeAnnotations(trade.time, activeRange);
                        }

                        scheduleTradesChartUpdate();
                    }
                    break;

                case "signal":
                    const label = buildSignalLabel(message.data);
                    const id = message.data.id;

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
                    if (window.orderBookChart) {
                        orderBookChart.data.labels =
                            orderBookData.priceLevels.map((level) =>
                                level.price ? level.price.toFixed(2) : "0.00"
                            );
                        orderBookChart.data.datasets[1].data =
                            orderBookData.priceLevels.map(
                                (level) => level.bid || 0
                            );
                        orderBookChart.data.datasets[0].data =
                            orderBookData.priceLevels.map(
                                (level) => level.ask || 0
                            );
                        orderBookChart.data.datasets[1].backgroundColor =
                            orderBookData.priceLevels.map((level) =>
                                level.bid
                                    ? `rgba(0, 128, 0, ${Math.min(level.bid / 2000, 1)})`
                                    : "rgba(0, 0, 0, 0)"
                            );
                        orderBookChart.data.datasets[0].backgroundColor =
                            orderBookData.priceLevels.map((level) =>
                                level.ask
                                    ? `rgba(255, 0, 0, ${Math.min(level.ask / 2000, 1)})`
                                    : "rgba(0, 0, 0, 0)"
                            );
                        scheduleOrderBookUpdate();
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

tradeWebsocket.connect();

/**
 * Global timeout ID for trade delay gauge.
 * @type {number|null}
 */
let tradeTimeoutId = null;

/**
 * Global order book data.
 * @type {Object}
 * @property {Array<Object>} priceLevels - Array of price levels with price, bid, and ask.
 */
let orderBookData = {
    priceLevels: [],
};

/**
 * Array of trade objects.
 * @type {Array<Object>}
 */
const trades = [];

/**
 * Current time range for the trades chart (ms), or null for all data.
 * @type {number|null}
 */
let activeRange = 90 * 60000; // 90 minutes

/**
 * Validates a trade object.
 * @param {Object} trade - The trade to validate.
 * @param {number} trade.time - Timestamp (ms).
 * @param {number} trade.price - Price (USDT).
 * @param {number} trade.quantity - Quantity (LTC).
 * @param {string} trade.orderType - 'BUY' or 'SELL'.
 * @returns {boolean} True if valid, false otherwise.
 */
function isValidTrade(trade) {
    return (
        trade &&
        typeof trade.time === "number" &&
        typeof trade.price === "number" &&
        typeof trade.quantity === "number" &&
        ["BUY", "SELL"].includes(trade.orderType)
    );
}

/**
 * Gets the background color for a trade based on type and quantity.
 * @param {Object} context - Chart.js context with trade data.
 * @returns {string} Color as RGBA string.
 */
function getTradeBackgroundColor(context) {
    const trade = context.raw;
    if (!trade) return "rgba(0, 0, 0, 0)";

    const isBuy = trade.orderType === "BUY";
    const q = trade.quantity;
    const opacity =
        q > 500 ? 0.6 : q > 200 ? 0.5 : q > 100 ? 0.4 : q > 15 ? 0.3 : 0.2;
    return isBuy
        ? `rgba(0, 255, 30, ${opacity})`
        : `rgba(255, 0, 90, ${opacity})`;
}

/**
 * Gets the point radius for a trade based on quantity.
 * @param {Object} context - Chart.js context with trade data.
 * @returns {number} Radius in pixels.
 */
function getTradePointRadius(context) {
    const q = context.raw?.quantity || 0;
    return q > 1000
        ? 50
        : q > 500
          ? 40
          : q > 200
            ? 25
            : q > 100
              ? 10
              : q > 50
                ? 5
                : 2;
}

/**
 * Initializes the trades scatter chart.
 * @param {CanvasRenderingContext2D} ctx - The canvas 2D context.
 * @returns {Object} The Chart.js instance.
 * @throws {Error} If Chart.js is not loaded.
 */
function initializeTradesChart(ctx) {
    if (tradesChart) return tradesChart;

    return new Chart(ctx, {
        type: "scatter",
        data: {
            datasets: [
                {
                    label: "Trades",
                    parsing: { xAxisKey: "x", yAxisKey: "y" },
                    data: trades,
                    backgroundColor: getTradeBackgroundColor,
                    pointRadius: getTradePointRadius,
                    hoverRadius: getTradePointRadius,
                },
            ],
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: false,
            layout: { padding: 0 },
            scales: {
                x: {
                    type: "time",
                    time: {
                        unit: "minute",
                        displayFormats: { minute: "HH:mm" },
                    },
                    grid: { display: true, color: "rgba(102, 102, 102, 0.1)" },
                    ticks: { source: "auto" },
                },
                y: {
                    type: "linear",
                    title: { display: true, text: "USDT" },
                    ticks: { stepSize: 0.05, precision: 2 },
                    position: "right",
                    grace: 0.1,
                    offset: true,
                },
            },
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: (context) => {
                            const t = context.raw;
                            return t
                                ? `Price: ${t.y.toFixed(2)}, Qty: ${t.quantity}, Type: ${t.orderType}`
                                : "";
                        },
                    },
                },
                annotation: {
                    annotations: {
                        lastPriceLine: {
                            type: "line",
                            yMin: undefined,
                            yMax: undefined,
                            borderColor: "blue",
                            borderWidth: 1,
                            drawTime: "afterDatasetsDraw",
                            label: {
                                display: true,
                                content: (ctx) =>
                                    ctx.chart.options.plugins.annotation.annotations.lastPriceLine.yMin?.toFixed(
                                        2
                                    ) || "",
                                position: "end",
                                xAdjust: -2,
                                yAdjust: 0,
                                backgroundColor: "rgba(0, 0, 255, 0.5)",
                                color: "white",
                                font: { size: 12 },
                                padding: 6,
                            },
                        },
                    },
                },
            },
        },
    });
}

/**
 * Initializes the trade delay gauge.
 * @param {HTMLCanvasElement} canvas - The canvas element for the gauge.
 * @returns {Object|null} The Gauge instance or null if initialization fails.
 */
function initializeDelayGauge(canvas) {
    if (delayGauge) return delayGauge;

    if (typeof RadialGauge === "undefined") return null;

    return new RadialGauge({
        renderTo: canvas,
        width: 200,
        height: 160,
        units: "ms",
        title: "Trade Delay",
        minValue: 0,
        maxValue: 2000,
        valueDec: 0,
        valueInt: 4,
        majorTicks: ["0", "500", "1000", "1500", "2000"],
        minorTicks: 5,
        strokeTicks: true,
        highlights: [
            { from: 0, to: 500, color: "rgba(0, 255, 0, 0.3)" },
            { from: 500, to: 1000, color: "rgba(255, 165, 0, 0.3)" },
            { from: 1000, to: 2000, color: "rgba(255, 0, 0, 0.3)" },
        ],
        colorPlate: "#fff",
        colorMajorTicks: "#444",
        colorMinorTicks: "#666",
        colorTitle: "#000",
        colorUnits: "#000",
        colorNumbers: "#444",
        colorNeedleStart: "rgba(240, 128, 128, 1)",
        colorNeedleEnd: "rgba(255, 160, 122, .9)",
        value: 0,
        valueBox: true,
        valueTextShadow: false,
        animationRule: "linear",
        animationDuration: 10,
    }).draw();
}

/**
 * Sets the trade delay gauge to timeout state.
 * @param {Object} gauge - The Gauge instance.
 */
function setGaugeTimeout(gauge) {
    if (gauge) {
        gauge.value = 0;
        gauge.title = "TIMEOUT";
        //gauge.set({
        //  title: 'Trade Timeout',
        //  highlights: [{ from: 0, to: 2000, color: 'rgba(128, 128, 128, 0.3)' }], // Gray: Timeout
        //  value: 0,
        //});
        //gauge.draw();
    }
}

/**
 * Initializes the order book bar chart.
 * @param {CanvasRenderingContext2D} ctx - The canvas 2D context.
 * @returns {Object} The Chart.js instance.
 * @throws {Error} If Chart.js is not loaded.
 */
function initializeOrderBookChart(ctx) {
    if (orderBookChart) return orderBookChart;
    if (typeof Chart === "undefined") {
        throw new Error("Chart.js is not loaded");
    }

    return new Chart(ctx, {
        type: "bar",
        data: {
            labels: orderBookData.priceLevels.map((level) =>
                level.price.toFixed(2)
            ),
            datasets: [
                {
                    label: "Asks",
                    data: orderBookData.priceLevels.map((level) => level.ask),
                    backgroundColor: orderBookData.priceLevels.map((level) =>
                        level.ask
                            ? `rgba(255, 0, 0, ${Math.min(level.ask / 2000, 1)})`
                            : "rgba(0, 0, 0, 0)"
                    ),
                    borderColor: "rgba(255, 0, 0, 0.5)",
                    borderWidth: 1,
                    barThickness: 10,
                },
                {
                    label: "Bids",
                    data: orderBookData.priceLevels.map((level) => level.bid),
                    backgroundColor: orderBookData.priceLevels.map((level) =>
                        level.bid
                            ? `rgba(0, 128, 0, ${Math.min(level.bid / 2000, 1)})`
                            : "rgba(0, 0, 0, 0)"
                    ),
                    borderColor: "rgba(0, 128, 0, 0.5)",
                    borderWidth: 1,
                    barThickness: 10,
                },
            ],
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: false,
            indexAxis: "y",
            scales: {
                x: {
                    title: { display: true, text: "Volume (LTC)" },
                    ticks: { callback: (value) => Math.abs(value) },
                },
                y: {
                    title: { display: true, text: "Price (USDT)" },
                    offset: true,
                    reverse: true,
                },
            },
            plugins: {
                legend: {
                    display: true,
                    position: "top",
                    labels: {
                        usePointStyle: true,
                        boxWidth: 10,
                        boxHeight: 10,
                        padding: 10,
                        font: { size: 12 },
                    },
                },
                tooltip: {
                    callbacks: {
                        label: function (context) {
                            const level =
                                orderBookData.priceLevels[context.dataIndex];
                            return `Price: $${level.price.toFixed(2)}, Bid: ${level.bid} LTC, Ask: ${level.ask} LTC, Direction: ${orderBookData.direction.type} (${orderBookData.direction.probability}%)`;
                        },
                    },
                },
            },
        },
    });
}

/**
 * Sets the time range for the trades chart.
 * @param {number|null} duration - Duration in milliseconds, or null for all data.
 */
function setRange(duration) {
    activeRange = duration;
    const now = Date.now();
    if (tradesChart) {
        if (duration !== null) {
            tradesChart.options.scales.x.min = now - duration;
            tradesChart.options.scales.x.max = now + PADDING_TIME;
        } else {
            tradesChart.options.scales.x.min = undefined;
            tradesChart.options.scales.x.max = undefined;
        }

        updateYAxisBounds();
        tradesChart.update();
    }
}

/**
 * Sets up Interact.js for draggable and resizable chart containers.
 */
function setupInteract() {
    if (typeof interact === "undefined") {
        console.error("Interact.js not loaded");
        return;
    }

    interact(".chart-container")
        .draggable({
            inertia: true,
            modifiers: [
                interact.modifiers.restrictRect({
                    restriction: ".dashboard",
                    endOnly: true,
                }),
            ],
            listeners: {
                start(event) {
                    const t = event.target;
                    t.setAttribute("data-prev-x", t.getAttribute("data-x") || 0);
                    t.setAttribute("data-prev-y", t.getAttribute("data-y") || 0);
                },
                move(event) {
                    const target = event.target;
                    let x = (parseFloat(target.getAttribute("data-x")) || 0) +
                        event.dx;
                    let y = (parseFloat(target.getAttribute("data-y")) || 0) +
                        event.dy;
                    x = snap(x);
                    y = snap(y);
                    target.style.transform = `translate(${x}px, ${y}px)`;
                    target.setAttribute("data-x", x);
                    target.setAttribute("data-y", y);
                },
                end(event) {
                    const target = event.target;
                    if (isOverlapping(target)) {
                        const px = parseFloat(target.getAttribute("data-prev-x")) || 0;
                        const py = parseFloat(target.getAttribute("data-prev-y")) || 0;
                        target.style.transform = `translate(${px}px, ${py}px)`;
                        target.setAttribute("data-x", px);
                        target.setAttribute("data-y", py);
                    } else {
                        target.setAttribute("data-prev-x", target.getAttribute("data-x"));
                        target.setAttribute("data-prev-y", target.getAttribute("data-y"));
                    }
                },
            },
        })
        .resizable({
            edges: { left: true, right: true, bottom: true, top: true },
            modifiers: [
                interact.modifiers.restrictSize({
                    min: { width: 200, height: 200 },
                }),
            ],
            listeners: {
                start(event) {
                    const t = event.target;
                    t.setAttribute(
                        "data-prev-w",
                        parseFloat(t.style.width) || t.offsetWidth
                    );
                    t.setAttribute(
                        "data-prev-h",
                        parseFloat(t.style.height) || t.offsetHeight
                    );
                    t.setAttribute("data-prev-x", t.getAttribute("data-x") || 0);
                    t.setAttribute("data-prev-y", t.getAttribute("data-y") || 0);
                },
                move(event) {
                    const target = event.target;
                    let x = (parseFloat(target.getAttribute("data-x")) || 0) +
                        event.deltaRect.left;
                    let y = (parseFloat(target.getAttribute("data-y")) || 0) +
                        event.deltaRect.top;
                    let width = snap(event.rect.width);
                    let height = snap(event.rect.height);
                    x = snap(x);
                    y = snap(y);
                    target.style.width = `${width}px`;
                    target.style.height = `${height}px`;
                    target.style.transform = `translate(${x}px, ${y}px)`;
                    target.setAttribute("data-x", x);
                    target.setAttribute("data-y", y);
                    const canvas = target.querySelector("canvas");
                    if (canvas) {
                        canvas.width = width;
                        canvas.height = height;
                        const chart = Chart.getChart(canvas.id);
                        if (chart) chart.resize();
                    }
                },
                end(event) {
                    const target = event.target;
                    if (isOverlapping(target)) {
                        const px = parseFloat(target.getAttribute("data-prev-x")) || 0;
                        const py = parseFloat(target.getAttribute("data-prev-y")) || 0;
                        const pw = parseFloat(target.getAttribute("data-prev-w"));
                        const ph = parseFloat(target.getAttribute("data-prev-h"));
                        target.style.width = `${pw}px`;
                        target.style.height = `${ph}px`;
                        target.style.transform = `translate(${px}px, ${py}px)`;
                        target.setAttribute("data-x", px);
                        target.setAttribute("data-y", py);
                    } else {
                        target.setAttribute("data-prev-x", target.getAttribute("data-x"));
                        target.setAttribute("data-prev-y", target.getAttribute("data-y"));
                        target.setAttribute(
                            "data-prev-w",
                            parseFloat(target.style.width)
                        );
                        target.setAttribute(
                            "data-prev-h",
                            parseFloat(target.style.height)
                        );
                    }
                },
            },
        });

    interact(".anomaly-list-container")
        .draggable({
            inertia: true,
            modifiers: [
                interact.modifiers.restrictRect({
                    restriction: ".dashboard",
                    endOnly: true,
                }),
            ],
            listeners: {
                start(event) {
                    const t = event.target;
                    t.setAttribute("data-prev-x", t.getAttribute("data-x") || 0);
                    t.setAttribute("data-prev-y", t.getAttribute("data-y") || 0);
                },
                move(event) {
                    const target = event.target;
                    let x = (parseFloat(target.getAttribute("data-x")) || 0) +
                        event.dx;
                    let y = (parseFloat(target.getAttribute("data-y")) || 0) +
                        event.dy;
                    x = snap(x);
                    y = snap(y);
                    target.style.transform = `translate(${x}px, ${y}px)`;
                    target.setAttribute("data-x", x);
                    target.setAttribute("data-y", y);
                },
                end(event) {
                    const target = event.target;
                    if (isOverlapping(target)) {
                        const px = parseFloat(target.getAttribute("data-prev-x")) || 0;
                        const py = parseFloat(target.getAttribute("data-prev-y")) || 0;
                        target.style.transform = `translate(${px}px, ${py}px)`;
                        target.setAttribute("data-x", px);
                        target.setAttribute("data-y", py);
                    } else {
                        target.setAttribute("data-prev-x", target.getAttribute("data-x"));
                        target.setAttribute("data-prev-y", target.getAttribute("data-y"));
                    }
                },
            },
        })
        .resizable({
            edges: { left: true, right: true, bottom: true, top: true },
            modifiers: [
                interact.modifiers.restrictSize({
                    min: { width: 200, height: 200 },
                }),
            ],
            listeners: {
                start(event) {
                    const t = event.target;
                    t.setAttribute("data-prev-w", parseFloat(t.style.width) || t.offsetWidth);
                    t.setAttribute("data-prev-h", parseFloat(t.style.height) || t.offsetHeight);
                    t.setAttribute("data-prev-x", t.getAttribute("data-x") || 0);
                    t.setAttribute("data-prev-y", t.getAttribute("data-y") || 0);
                },
                move(event) {
                    const target = event.target;
                    let x = (parseFloat(target.getAttribute("data-x")) || 0) + event.deltaRect.left;
                    let y = (parseFloat(target.getAttribute("data-y")) || 0) + event.deltaRect.top;
                    let width = snap(event.rect.width);
                    let height = snap(event.rect.height);
                    x = snap(x);
                    y = snap(y);
                    target.style.width = `${width}px`;
                    target.style.height = `${height}px`;
                    target.style.transform = `translate(${x}px, ${y}px)`;
                    target.setAttribute("data-x", x);
                    target.setAttribute("data-y", y);
                    const canvas = target.querySelector("canvas");
                    if (canvas) {
                        canvas.width = width;
                        canvas.height = height;
                        const chart = Chart.getChart(canvas.id);
                        if (chart) chart.resize();
                    }
                },
                end(event) {
                    const target = event.target;
                    if (isOverlapping(target)) {
                        const px = parseFloat(target.getAttribute("data-prev-x")) || 0;
                        const py = parseFloat(target.getAttribute("data-prev-y")) || 0;
                        const pw = parseFloat(target.getAttribute("data-prev-w"));
                        const ph = parseFloat(target.getAttribute("data-prev-h"));
                        target.style.width = `${pw}px`;
                        target.style.height = `${ph}px`;
                        target.style.transform = `translate(${px}px, ${py}px)`;
                        target.setAttribute("data-x", px);
                        target.setAttribute("data-y", py);
                    } else {
                        target.setAttribute("data-prev-x", target.getAttribute("data-x"));
                        target.setAttribute("data-prev-y", target.getAttribute("data-y"));
                        target.setAttribute("data-prev-w", parseFloat(target.style.width));
                        target.setAttribute("data-prev-h", parseFloat(target.style.height));
                    }
                },
            },
        });

    interact(".gauge-container").draggable({
        inertia: true,
        modifiers: [
            interact.modifiers.restrictRect({
                restriction: ".dashboard",
                endOnly: true,
            }),
        ],
        listeners: {
            start(event) {
                const t = event.target;
                t.setAttribute("data-prev-x", t.getAttribute("data-x") || 0);
                t.setAttribute("data-prev-y", t.getAttribute("data-y") || 0);
            },
            move(event) {
                const target = event.target;
                let x = (parseFloat(target.getAttribute("data-x")) || 0) + event.dx;
                let y = (parseFloat(target.getAttribute("data-y")) || 0) + event.dy;
                x = snap(x);
                y = snap(y);
                target.style.transform = `translate(${x}px, ${y}px)`;
                target.setAttribute("data-x", x);
                target.setAttribute("data-y", y);
            },
            end(event) {
                const target = event.target;
                if (isOverlapping(target)) {
                    const px = parseFloat(target.getAttribute("data-prev-x")) || 0;
                    const py = parseFloat(target.getAttribute("data-prev-y")) || 0;
                    target.style.transform = `translate(${px}px, ${py}px)`;
                    target.setAttribute("data-x", px);
                    target.setAttribute("data-y", py);
                } else {
                    target.setAttribute("data-prev-x", target.getAttribute("data-x"));
                    target.setAttribute("data-prev-y", target.getAttribute("data-y"));
                }
            },
        },
    });
}

/**
 * Initializes the application on DOM content loaded.
 */
function initialize() {
    // Validate DOM elements
    if (!tradesCanvas) {
        console.error("Trades chart canvas not found");
        return;
    }
    if (!orderBookCanvas) {
        console.error("Order book chart canvas not found");
        return;
    }

    if (!delayGaugeCanvas) {
        console.error("Delay gauge canvas not found");
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

    // Initialize charts
    tradesChart = initializeTradesChart(tradesCtx);
    orderBookChart = initializeOrderBookChart(orderBookCtx);
    delayGauge = initializeDelayGauge(delayGaugeCanvas);

    // Setup interact.js
    setupInteract();

    // Setup range selector
    if (rangeSelector) {
        rangeSelector.addEventListener("click", (e) => {
            if (e.target.tagName === "BUTTON") {
                const range = e.target.getAttribute("data-range");
                setRange(range === "all" ? null : parseInt(range));
            }
        });
    } else {
        console.warn("Range selector element not found");
    }
}

function addAnomalyChartLabel(anomaly) {
    if (!window.tradesChart) return;
    const now = anomaly.time || anomaly.detectedAt || Date.now();
    window.tradesChart.options.plugins.annotation.annotations =
        window.tradesChart.options.plugins.annotation.annotations || {};
    window.tradesChart.options.plugins.annotation.annotations[
        `anomaly.${now}`
    ] = {
        type: "label",
        xValue: anomaly.time || anomaly.detectedAt,
        yValue: anomaly.price,
        content: `${getAnomalyIcon(anomaly.type)}`,
        backgroundColor:
            anomaly.severity === "critical"
                ? "rgba(229,57,53,0.8)"
                : anomaly.severity === "high"
                  ? "rgba(255,179,0,0.85)"
                  : anomaly.severity === "medium"
                    ? "rgba(255,241,118,0.5)"
                    : "rgba(33,150,243,0.5)",
        color: "#fff",
        font: { size: 18, weight: "bold" },
        padding: 6,
        borderRadius: 6,
        id: `anomaly.${now}`,
    };
    window.tradesChart.update("none");
}

// Start application
document.addEventListener("DOMContentLoaded", initialize);

document.addEventListener("DOMContentLoaded", () => {
    const filterBox = document.querySelector(".anomaly-filter");
    if (filterBox) {
        filterBox.querySelectorAll("input[type=checkbox]").forEach((box) => {
            box.addEventListener("change", () => {
                if (box.checked) anomalyFilters.add(box.value);
                else anomalyFilters.delete(box.value);
                renderAnomalyList();
            });
        });
    }
});
