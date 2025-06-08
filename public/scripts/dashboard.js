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
const ITEM_MARGIN = 20; // fixed space between dashboard items

// DOM references
const tradesCanvas = document.getElementById("tradesChart");
const orderBookCanvas = document.getElementById("orderBookChart");
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

let anomalyList = [];
const anomalySeverityOrder = ["critical", "high", "medium", "info"];
let anomalyFilters = new Set(["critical", "high"]);

// Signals management
let signalsList = [];
let signalFilters = new Set(["buy", "sell"]);
let activeSignalTooltip = null;

// Support/Resistance levels management
let supportResistanceLevels = [];
let maxSupportResistanceLevels = 20;

// Zone management
let activeZones = new Map();
let maxActiveZones = 10;

// Used to control badge display
let badgeTimeout = null;
let latestBadgeElem = null;

// Runtime configuration
let dedupTolerance = 0.01;
if (
    window.runtimeConfig &&
    typeof window.runtimeConfig.dedupTolerance === "number"
) {
    dedupTolerance = window.runtimeConfig.dedupTolerance;
}

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
    return others.some((el) => {
        const r = el.getBoundingClientRect();
        return !(
            rect.right + ITEM_MARGIN <= r.left ||
            rect.left >= r.right + ITEM_MARGIN ||
            rect.bottom + ITEM_MARGIN <= r.top ||
            rect.top >= r.bottom + ITEM_MARGIN
        );
    });
}

function snapToOthers(x, y, width, height, target) {
    const others = Array.from(
        document.querySelectorAll(
            ".chart-container, .anomaly-list-container, .gauge-container"
        )
    ).filter((el) => el !== target);
    for (const el of others) {
        const r = el.getBoundingClientRect();
        if (Math.abs(x - (r.right + ITEM_MARGIN)) <= ITEM_MARGIN) {
            x = r.right + ITEM_MARGIN;
        }
        if (Math.abs(x + width + ITEM_MARGIN - r.left) <= ITEM_MARGIN) {
            x = r.left - width - ITEM_MARGIN;
        }
        if (Math.abs(y - (r.bottom + ITEM_MARGIN)) <= ITEM_MARGIN) {
            y = r.bottom + ITEM_MARGIN;
        }
        if (Math.abs(y + height + ITEM_MARGIN - r.top) <= ITEM_MARGIN) {
            y = r.top - height - ITEM_MARGIN;
        }
    }
    return { x, y };
}

function adjustLayout(movedEl) {
    const elements = Array.from(
        document.querySelectorAll(
            ".chart-container, .anomaly-list-container, .gauge-container"
        )
    );

    const queue = [movedEl];
    const handled = new Set();

    while (queue.length) {
        const el = queue.shift();
        handled.add(el);
        const rect = el.getBoundingClientRect();
        for (const other of elements) {
            if (other === el) continue;
            const oRect = other.getBoundingClientRect();
            if (!rectsOverlap(rect, oRect)) continue;

            let x = parseFloat(other.getAttribute("data-x")) || 0;
            let y = parseFloat(other.getAttribute("data-y")) || 0;

            const moveRight = rect.right + ITEM_MARGIN - oRect.left;
            const moveLeft = oRect.right - rect.left + ITEM_MARGIN;
            const moveDown = rect.bottom + ITEM_MARGIN - oRect.top;
            const moveUp = oRect.bottom - rect.top + ITEM_MARGIN;

            if (Math.abs(moveRight) < Math.abs(moveDown)) {
                if (oRect.left >= rect.left) x += moveRight;
                else x -= moveLeft;
            } else {
                if (oRect.top >= rect.top) y += moveDown;
                else y -= moveUp;
            }

            x = snap(x);
            y = snap(y);
            ({ x, y } = snapToOthers(
                x,
                y,
                other.offsetWidth,
                other.offsetHeight,
                other
            ));
            other.style.transform = `translate(${x}px, ${y}px)`;
            other.setAttribute("data-x", x);
            other.setAttribute("data-y", y);

            if (!handled.has(other)) queue.push(other);
        }
    }
}

let layoutAdjustScheduled = false;
function scheduleLayoutAdjust(target) {
    if (!layoutAdjustScheduled) {
        layoutAdjustScheduled = true;
        requestAnimationFrame(() => {
            adjustLayout(target);
            layoutAdjustScheduled = false;
        });
    }
}

function getAnomalyIcon(type) {
    switch (type) {
        case "flash_crash":
            return "⚡";
        case "liquidity_void":
            return "💧";
        case "absorption":
            return "🔵";
        case "exhaustion":
            return "🔴";
        case "whale_activity":
            return "🐋";
        case "momentum_ignition":
            return "🔥";
        case "spoofing":
            return "👻";
        case "iceberg_order":
            return "🧊";
        case "orderbook_imbalance":
            return "⚖️";
        case "flow_imbalance":
            return "⇄";
        default:
            return "•";
    }
}

function getAnomalyLabel(type) {
    switch (type) {
        case "flash_crash":
            return "Flash Crash";
        case "liquidity_void":
            return "Liquidity Void";
        case "absorption":
            return "Absorption";
        case "exhaustion":
            return "Exhaustion";
        case "whale_activity":
            return "Whale Activity";
        case "momentum_ignition":
            return "Momentum Ignition";
        case "spoofing":
            return "Spoofing";
        case "iceberg_order":
            return "Iceberg Order";
        case "orderbook_imbalance":
            return "Orderbook Imbalance";
        case "flow_imbalance":
            return "Flow Imbalance";
        default:
            return type
                .replace(/_/g, " ")
                .replace(/\b\w/g, (l) => l.toUpperCase());
    }
}

function getReadableAction(action) {
    if (!action) return "Monitor";

    switch (action.toLowerCase()) {
        case "buy_signal":
        case "buy":
            return "Buy";
        case "sell_signal":
        case "sell":
            return "Sell";
        case "hold_position":
        case "hold":
            return "Hold";
        case "close_position":
        case "close":
            return "Close";
        case "reduce_position":
        case "reduce":
            return "Reduce";
        case "increase_position":
        case "increase":
            return "Add";
        case "wait_for_confirmation":
        case "wait":
            return "Wait";
        case "monitor_closely":
        case "monitor":
            return "Monitor";
        case "avoid_trading":
        case "avoid":
            return "Avoid";
        case "exit_immediately":
        case "exit":
            return "Exit";
        default:
            // Convert snake_case to Title Case
            return action
                .replace(/_/g, " ")
                .replace(/\b\w/g, (l) => l.toUpperCase());
    }
}

function getAnomalySummary(anomaly) {
    if (!anomaly || typeof anomaly !== "object") return "";
    const details = anomaly.details || {};
    const parts = [];
    if (details.confidence !== undefined) {
        const pct = Number(details.confidence) * 100;
        if (!Number.isNaN(pct)) parts.push(`Conf: ${pct.toFixed(0)}%`);
    }
    if (details.imbalance !== undefined) {
        const val = Number(details.imbalance);
        if (!Number.isNaN(val)) parts.push(`Imb: ${val.toFixed(2)}`);
    }
    if (details.absorptionRatio !== undefined) {
        const val = Number(details.absorptionRatio);
        if (!Number.isNaN(val)) parts.push(`AbsRatio: ${val.toFixed(2)}`);
    }
    if (details.rationale) {
        if (typeof details.rationale === "string") {
            parts.push(details.rationale);
        } else if (typeof details.rationale === "object") {
            const flags = Object.entries(details.rationale)
                .filter(([_, v]) => Boolean(v))
                .map(([k]) => k)
                .join(", ");
            if (flags) parts.push(`Reasons: ${flags}`);
        }
    }
    return parts.join(" | ");
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
            <div class="anomaly-row ${a.severity}" title="${getAnomalySummary(a)}">
                <span class="anomaly-icon">${getAnomalyIcon(a.type)}</span>
                <span class="anomaly-label">${getAnomalyLabel(a.type)}</span>
                <span class="anomaly-price">${a.affectedPriceRange ? `${a.affectedPriceRange.min.toFixed(2)}-${a.affectedPriceRange.max.toFixed(2)}` : `${a.price?.toFixed(2) || "N/A"}`}</span>
                <span class="anomaly-action">${getReadableAction(a.recommendedAction)}</span>
                <span class="anomaly-time">${formatAgo(a.detectedAt || a.time || Date.now())}</span>
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
    badge.innerHTML = `${getAnomalyIcon(anomaly.type)} ${getAnomalyLabel(anomaly.type)} @ ${anomaly.price?.toFixed(2) || "N/A"}`;
    document.body.appendChild(badge);
    latestBadgeElem = badge;
    if (badgeTimeout) clearTimeout(badgeTimeout);
    badgeTimeout = setTimeout(() => {
        badge.remove();
        latestBadgeElem = null;
    }, 4000);
}

function showSignalBundleBadge(signals) {
    if (!Array.isArray(signals) || signals.length === 0) return;
    const top = signals[0];
    if (latestBadgeElem) latestBadgeElem.remove();
    const badge = document.createElement("div");
    badge.className = "anomaly-badge";
    let color = "#757575"; // grey
    if (top.confidence > 0.9) {
        color = "#2e7d32"; // green
    } else if (top.confidence >= 0.75) {
        color = "#fb8c00"; // orange
    }
    badge.style.background = color;
    badge.innerHTML = `${top.side.toUpperCase()} @ ${top.price.toFixed(2)} (${(
        top.confidence * 100
    ).toFixed(0)}%)`;
    document.body.appendChild(badge);
    latestBadgeElem = badge;
    if (badgeTimeout) clearTimeout(badgeTimeout);
    badgeTimeout = setTimeout(() => {
        badge.remove();
        latestBadgeElem = null;
    }, 4000);
}

// Signal list rendering
function formatSignalTime(timestamp) {
    const s = Math.floor((Date.now() - timestamp) / 1000);
    if (s < 60) return `${s}s ago`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    return `${h}h ${m % 60}m ago`;
}

function getSignalSummary(signal) {
    const confidence = ((signal.signalData?.confidence || 0) * 100).toFixed(1);
    const meta = signal.signalData?.meta || {};
    const anomaly = signal.signalData?.anomalyCheck || {};

    return [
        `Signal: ${signal.type} (${signal.side})`,
        `Price: $${signal.price.toFixed(2)}`,
        `Confidence: ${confidence}%`,
        `Take Profit: $${signal.takeProfit?.toFixed(2) || "N/A"}`,
        `Stop Loss: $${signal.stopLoss?.toFixed(2) || "N/A"}`,
        meta.volume ? `Volume: ${meta.volume.toFixed(2)}` : "",
        meta.absorptionRatio
            ? `Absorption: ${(meta.absorptionRatio * 100).toFixed(1)}%`
            : "",
        anomaly.marketHealthy !== undefined
            ? `Market Health: ${anomaly.marketHealthy ? "Healthy" : "Unhealthy"}`
            : "",
        `Generated: ${new Date(signal.time).toLocaleString()}`,
    ]
        .filter(Boolean)
        .join("\n");
}

function renderSignalsList() {
    const listElem = document.getElementById("signalsList");
    if (!listElem) return;

    // Filter signals based on selected filters
    const filtered = signalsList.filter((signal) =>
        signalFilters.has(signal.side)
    );

    listElem.innerHTML = filtered
        .map((signal) => {
            const confidence = (
                (signal.signalData?.confidence || 0) * 100
            ).toFixed(0);
            const timeAgo = formatSignalTime(signal.time);

            return `
                <div class="signal-row signal-${signal.side}" 
                     data-signal-id="${signal.id}"
                     title="${getSignalSummary(signal)}">
                    <div class="signal-row-header">
                        <span class="signal-type">${signal.type.replace("_confirmed", "").replace("_", " ")}</span>
                        <span class="signal-side ${signal.side}">${signal.side.toUpperCase()}</span>
                        <span class="signal-time">${timeAgo}</span>
                    </div>
                    <div class="signal-details">
                        <span class="signal-price">$${signal.price.toFixed(2)}</span>
                        <span class="signal-confidence">${confidence}%</span>
                    </div>
                    <div class="signal-targets">
                        <span>TP: $${signal.takeProfit?.toFixed(2) || "N/A"}</span>
                        <span>SL: $${signal.stopLoss?.toFixed(2) || "N/A"}</span>
                    </div>
                </div>
            `;
        })
        .join("");
}

function updateTradeDelayIndicator(delay) {
    const indicator = document.getElementById("tradeDelayIndicator");
    const valueElement = document.getElementById("tradeDelayValue");

    if (!indicator || !valueElement) return;

    // Format delay with fixed width
    let formattedDelay;
    if (delay >= 1000) {
        // Show as seconds with 1 decimal place
        const seconds = (delay / 1000).toFixed(1);
        formattedDelay = `${seconds}s`;
    } else {
        // Show as milliseconds, ensure consistent width
        formattedDelay = `${delay}ms`;
    }

    // Update the displayed value
    valueElement.textContent = formattedDelay;

    // Remove previous delay classes
    indicator.classList.remove("delay-green", "delay-orange", "delay-red");

    // Add appropriate color class based on delay
    if (delay < 100) {
        indicator.classList.add("delay-green");
    } else if (delay < 500) {
        indicator.classList.add("delay-orange");
    } else {
        indicator.classList.add("delay-red");
    }
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
let lastOrderBookDraw = 0;
function scheduleOrderBookUpdate() {
    if (!orderBookChart) return;
    const now = Date.now();
    const delay = Math.max(0, 500 - (now - lastOrderBookDraw));
    if (orderBookUpdateTimeout) clearTimeout(orderBookUpdateTimeout);
    orderBookUpdateTimeout = setTimeout(() => {
        orderBookChart.update();
        lastOrderBookDraw = Date.now();
    }, delay);
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

    // 2. Confidence/Confirmations
    if (signal.confidence !== undefined) {
        label += `\nConf: ${(signal.confidence * 100).toFixed(0)}%`;
    }

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

                        // Check for support/resistance zone breaches
                        checkSupportResistanceBreaches(trade.price, trade.time);

                        scheduleTradesChartUpdate();
                    }
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
                        // Normalize confirmed signal structure for display
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

                        // Add to signals list (but don't unshift since we want chronological order)
                        signalsList.push(normalizedSignal);

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
                                font: { size: 12, family: "monospace" },
                                borderRadius: 4,
                                padding: 8,
                                position: { x: "center", y: "center" },
                            };
                        });

                        renderSignalsList();
                        tradesChart.update("none");
                        showSignalBundleBadge(filtered);
                    }
                    break;

                case "runtimeConfig":
                    if (message.data && typeof message.data === "object") {
                        window.runtimeConfig = {
                            ...(window.runtimeConfig || {}),
                            ...message.data,
                        };
                        if (typeof message.data.dedupTolerance === "number") {
                            dedupTolerance = message.data.dedupTolerance;
                        }
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
                    if (window.orderBookChart) {
                        // Update chart data with new structure
                        const labels = [];
                        const askData = [];
                        const bidData = [];

                        // Limit display to max 30 levels to prevent UI performance issues
                        const maxLevels = 30;
                        const levelsToShow = orderBookData.priceLevels.slice(
                            0,
                            maxLevels
                        );

                        levelsToShow.forEach((level) => {
                            const priceStr = level.price
                                ? level.price.toFixed(2)
                                : "0.00";

                            // Add ask position
                            labels.push(`${priceStr}_ask`);
                            askData.push(level.ask || 0);
                            bidData.push(null);

                            // Add bid position
                            labels.push(`${priceStr}_bid`);
                            askData.push(null);
                            bidData.push(level.bid || 0);
                        });

                        orderBookChart.data.labels = labels;
                        orderBookChart.data.datasets[0].data = askData;
                        orderBookChart.data.datasets[1].data = bidData;

                        // Update colors based on current theme
                        const currentTheme = getCurrentTheme();
                        const actualTheme =
                            currentTheme === "system"
                                ? getSystemTheme()
                                : currentTheme;
                        updateOrderBookBarColors(actualTheme);

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

    // Create labels for both bid and ask positions for each price level
    const labels = [];
    const askData = [];
    const bidData = [];
    const askColors = [];
    const bidColors = [];

    orderBookData.priceLevels.forEach((level) => {
        const basePrice = level.price;
        const priceStr = basePrice.toFixed(2);

        // Add ask position (upper part of price tick)
        labels.push(`${priceStr}_ask`);
        askData.push(level.ask);
        bidData.push(null);
        askColors.push("rgba(255, 0, 0, 0.5)"); // Placeholder, will be updated by theme
        bidColors.push("rgba(0, 0, 0, 0)");

        // Add bid position (lower part of price tick)
        labels.push(`${priceStr}_bid`);
        askData.push(null);
        bidData.push(level.bid);
        askColors.push("rgba(0, 0, 0, 0)");
        bidColors.push("rgba(0, 128, 0, 0.5)"); // Placeholder, will be updated by theme
    });

    return new Chart(ctx, {
        type: "bar",
        data: {
            labels: labels,
            datasets: [
                {
                    label: "Asks",
                    data: askData,
                    backgroundColor: askColors,
                    borderColor: "rgba(255, 0, 0, 0.5)",
                    borderWidth: 1,
                    barPercentage: 0.9,
                    categoryPercentage: 1.0,
                },
                {
                    label: "Bids",
                    data: bidData,
                    backgroundColor: bidColors,
                    borderColor: "rgba(0, 128, 0, 0.5)",
                    borderWidth: 1,
                    barPercentage: 0.9,
                    categoryPercentage: 1.0,
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
                    ticks: {
                        callback: function (value, index) {
                            const label = this.getLabelForValue(index);
                            if (label && label.includes("_ask")) {
                                return label.split("_")[0]; // Only show price for ask positions
                            }
                            return "";
                        },
                    },
                },
            },
            datasets: {
                bar: {
                    barPercentage: 0.45,
                    categoryPercentage: 1.0,
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
                            const label = context.label;
                            const isAsk = label.includes("_ask");
                            const isBid = label.includes("_bid");
                            const priceStr = label.split("_")[0];
                            const price = parseFloat(priceStr);

                            // Find the corresponding price level
                            const level = orderBookData.priceLevels.find(
                                (l) => Math.abs(l.price - price) < 0.001
                            );

                            if (!level) return "";

                            if (isAsk && level.ask > 0) {
                                return `Ask: ${level.ask} LTC at $${price.toFixed(2)}`;
                            } else if (isBid && level.bid > 0) {
                                return `Bid: ${level.bid} LTC at $${price.toFixed(2)}`;
                            }
                            return "";
                        },
                        title: function (context) {
                            const label = context[0].label;
                            const priceStr = label.split("_")[0];
                            return `Price: $${priceStr}`;
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

    // Save the new time range setting
    saveTimeRange();
}

/**
 * Sets up column resizing capabilities using interact.js with localStorage persistence.
 * Elements are no longer draggable or individually resizable - only column width resizing is allowed.
 */
function setupColumnResizing() {
    if (typeof interact === "undefined") {
        console.error("Interact.js not loaded");
        return;
    }

    // Setup column resizing functionality
    interact(".resize-handle").draggable({
        axis: "x",
        listeners: {
            move(event) {
                const handle = event.target;
                const handleId = handle.id;
                const dashboard = document.querySelector(".dashboard");
                const dashboardRect = dashboard.getBoundingClientRect();

                if (handleId === "resize1") {
                    // Resizing between column 1 and column 2
                    const column1 = document.getElementById("column1");
                    const column1Rect = column1.getBoundingClientRect();

                    const newWidth = Math.min(
                        Math.max(column1Rect.width + event.dx, 200),
                        dashboardRect.width * 0.5
                    );
                    const newPercent = (newWidth / dashboardRect.width) * 100;

                    column1.style.flex = `0 0 ${newPercent}%`;
                } else if (handleId === "resize2") {
                    // Resizing between column 2 and column 3
                    const column3 = document.getElementById("column3");
                    const column3Rect = column3.getBoundingClientRect();

                    const newWidth = Math.min(
                        Math.max(column3Rect.width - event.dx, 150),
                        dashboardRect.width * 0.3
                    );
                    const newPercent = (newWidth / dashboardRect.width) * 100;

                    column3.style.flex = `0 0 ${newPercent}%`;
                }

                // Debounced chart resize and save
                clearTimeout(window.resizeTimeout);
                window.resizeTimeout = setTimeout(() => {
                    triggerChartResize();
                    saveColumnWidths();
                }, 100);
            },
            end(event) {
                // Save column widths immediately when resize ends
                saveColumnWidths();
            },
        },
    });
}

/**
 * Save current column widths to localStorage
 */
function saveColumnWidths() {
    try {
        const dashboard = document.querySelector(".dashboard");
        const dashboardRect = dashboard.getBoundingClientRect();

        const column1 = document.getElementById("column1");
        const column3 = document.getElementById("column3");

        const column1Rect = column1.getBoundingClientRect();
        const column3Rect = column3.getBoundingClientRect();

        const column1Percent = (column1Rect.width / dashboardRect.width) * 100;
        const column3Percent = (column3Rect.width / dashboardRect.width) * 100;

        const columnWidths = {
            column1: column1Percent,
            column3: column3Percent,
            timestamp: Date.now(),
        };

        localStorage.setItem(
            "dashboardColumnWidths",
            JSON.stringify(columnWidths)
        );

        console.log("Column widths saved:", columnWidths);
    } catch (error) {
        console.warn("Failed to save column widths to localStorage:", error);
    }
}

/**
 * Save anomaly filter settings to localStorage
 */
function saveAnomalyFilters() {
    try {
        const filterSettings = {
            filters: Array.from(anomalyFilters),
            timestamp: Date.now(),
        };

        localStorage.setItem(
            "dashboardAnomalyFilters",
            JSON.stringify(filterSettings)
        );
        console.log("Anomaly filters saved:", filterSettings);
    } catch (error) {
        console.warn("Failed to save anomaly filters to localStorage:", error);
    }
}

/**
 * Restore anomaly filter settings from localStorage
 */
function restoreAnomalyFilters() {
    try {
        const savedFilters = localStorage.getItem("dashboardAnomalyFilters");

        if (!savedFilters) {
            console.log("No saved anomaly filters found, using defaults");
            return;
        }

        const filterSettings = JSON.parse(savedFilters);

        if (!filterSettings.filters || !Array.isArray(filterSettings.filters)) {
            console.warn("Invalid saved anomaly filters, using defaults");
            return;
        }

        // Update the anomaly filters set
        anomalyFilters.clear();
        filterSettings.filters.forEach((filter) => anomalyFilters.add(filter));

        // Update the UI checkboxes
        const filterBox = document.querySelector(".anomaly-filter");
        if (filterBox) {
            filterBox
                .querySelectorAll("input[type=checkbox]")
                .forEach((checkbox) => {
                    checkbox.checked = anomalyFilters.has(checkbox.value);
                });
        }

        console.log("Anomaly filters restored:", {
            filters: filterSettings.filters,
            savedAt: new Date(filterSettings.timestamp).toLocaleString(),
        });

        // Re-render the anomaly list with restored filters
        renderAnomalyList();
    } catch (error) {
        console.warn(
            "Failed to restore anomaly filters from localStorage:",
            error
        );
    }
}

/**
 * Save current time range setting to localStorage
 */
function saveTimeRange() {
    try {
        const rangeSettings = {
            activeRange: activeRange,
            timestamp: Date.now(),
        };

        localStorage.setItem(
            "dashboardTimeRange",
            JSON.stringify(rangeSettings)
        );
        console.log("Time range saved:", rangeSettings);
    } catch (error) {
        console.warn("Failed to save time range to localStorage:", error);
    }
}

/**
 * Restore time range setting from localStorage
 */
function restoreTimeRange() {
    try {
        const savedRange = localStorage.getItem("dashboardTimeRange");

        if (!savedRange) {
            console.log(
                "No saved time range found, using default (90 minutes)"
            );
            return;
        }

        const rangeSettings = JSON.parse(savedRange);

        if (rangeSettings.activeRange === undefined) {
            console.warn("Invalid saved time range, using default");
            return;
        }

        // Update active range and apply to chart
        activeRange = rangeSettings.activeRange;

        // Update the UI to show the selected range
        const rangeSelector = document.querySelector(".rangeSelector");
        if (rangeSelector) {
            rangeSelector.querySelectorAll("button").forEach((button) => {
                const buttonRange = button.getAttribute("data-range");
                const buttonRangeValue =
                    buttonRange === "all" ? null : parseInt(buttonRange);

                if (buttonRangeValue === activeRange) {
                    button.classList.add("active");
                } else {
                    button.classList.remove("active");
                }
            });
        }

        console.log("Time range restored:", {
            range:
                activeRange === null ? "all" : `${activeRange / 60000} minutes`,
            savedAt: new Date(rangeSettings.timestamp).toLocaleString(),
        });

        // Apply the range to the chart if it exists
        if (tradesChart) {
            setRange(activeRange);
        }
    } catch (error) {
        console.warn("Failed to restore time range from localStorage:", error);
    }
}

/**
 * Restore column widths from localStorage
 */
function restoreColumnWidths() {
    try {
        const savedWidths = localStorage.getItem("dashboardColumnWidths");

        if (!savedWidths) {
            console.log("No saved column widths found, using defaults");
            return;
        }

        const columnWidths = JSON.parse(savedWidths);

        // Validate saved data
        if (!columnWidths.column1 || !columnWidths.column3) {
            console.warn("Invalid saved column widths, using defaults");
            return;
        }

        // Apply saved widths with validation
        const column1 = document.getElementById("column1");
        const column3 = document.getElementById("column3");

        if (column1 && column3) {
            // Ensure widths are within valid ranges
            const column1Width = Math.min(
                Math.max(columnWidths.column1, 15),
                50
            ); // 15-50%
            const column3Width = Math.min(
                Math.max(columnWidths.column3, 10),
                30
            ); // 10-30%

            column1.style.flex = `0 0 ${column1Width}%`;
            column3.style.flex = `0 0 ${column3Width}%`;

            console.log("Column widths restored:", {
                column1: column1Width,
                column3: column3Width,
                savedAt: new Date(columnWidths.timestamp).toLocaleString(),
            });

            // Trigger chart resize after restoration
            setTimeout(() => {
                triggerChartResize();
            }, 100);
        }
    } catch (error) {
        console.warn(
            "Failed to restore column widths from localStorage:",
            error
        );
    }
}

/**
 * Reset column widths to default and clear localStorage
 */
function resetColumnWidths() {
    try {
        const column1 = document.getElementById("column1");
        const column3 = document.getElementById("column3");

        if (column1 && column3) {
            column1.style.flex = "0 0 25%";
            column3.style.flex = "0 0 15%";

            localStorage.removeItem("dashboardColumnWidths");

            setTimeout(() => {
                triggerChartResize();
            }, 100);

            console.log("Column widths reset to defaults");
        }
    } catch (error) {
        console.warn("Failed to reset column widths:", error);
    }
}

/**
 * Reset all dashboard settings to defaults
 */
function resetAllSettings() {
    try {
        // Reset column widths
        resetColumnWidths();

        // Reset anomaly filters to default (critical and high)
        anomalyFilters.clear();
        anomalyFilters.add("critical");
        anomalyFilters.add("high");
        localStorage.removeItem("dashboardAnomalyFilters");

        // Update UI checkboxes
        const filterBox = document.querySelector(".anomaly-filter");
        if (filterBox) {
            filterBox
                .querySelectorAll("input[type=checkbox]")
                .forEach((checkbox) => {
                    checkbox.checked = anomalyFilters.has(checkbox.value);
                });
        }
        renderAnomalyList();

        // Reset time range to default (90 minutes)
        activeRange = 90 * 60000;
        localStorage.removeItem("dashboardTimeRange");

        // Update UI range selector
        const rangeSelector = document.querySelector(".rangeSelector");
        if (rangeSelector) {
            rangeSelector.querySelectorAll("button").forEach((button) => {
                const buttonRange = button.getAttribute("data-range");
                const buttonRangeValue =
                    buttonRange === "all" ? null : parseInt(buttonRange);

                if (buttonRangeValue === activeRange) {
                    button.classList.add("active");
                } else {
                    button.classList.remove("active");
                }
            });
        }

        // Reset theme to system default
        localStorage.removeItem("dashboardTheme");
        applySystemTheme();
        updateThemeToggleButton();

        // Apply to chart
        if (tradesChart) {
            setRange(activeRange);
        }

        console.log("All dashboard settings reset to defaults");
    } catch (error) {
        console.warn("Failed to reset all settings:", error);
    }
}

/**
 * Theme management functions
 */
function getSystemTheme() {
    return window.matchMedia &&
        window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light";
}

function getCurrentTheme() {
    const saved = localStorage.getItem("dashboardTheme");
    if (saved && (saved === "light" || saved === "dark")) {
        return saved;
    }
    return "system";
}

function applyTheme(theme) {
    const body = document.body;

    if (theme === "system") {
        body.removeAttribute("data-theme");
    } else {
        body.setAttribute("data-theme", theme);
    }

    // Update chart colors for dark/light mode
    updateChartTheme(theme === "system" ? getSystemTheme() : theme);
}

function applySystemTheme() {
    applyTheme("system");
}

function saveTheme(theme) {
    try {
        if (theme === "system") {
            localStorage.removeItem("dashboardTheme");
        } else {
            localStorage.setItem("dashboardTheme", theme);
        }
        console.log("Theme saved:", theme);
    } catch (error) {
        console.warn("Failed to save theme to localStorage:", error);
    }
}

function restoreTheme() {
    try {
        const savedTheme = getCurrentTheme();
        applyTheme(savedTheme);
        updateThemeToggleButton();

        console.log("Theme restored:", savedTheme);
    } catch (error) {
        console.warn("Failed to restore theme from localStorage:", error);
    }
}

function toggleTheme() {
    const current = getCurrentTheme();
    let next;

    switch (current) {
        case "system":
            next = "light";
            break;
        case "light":
            next = "dark";
            break;
        case "dark":
            next = "system";
            break;
        default:
            next = "system";
    }

    applyTheme(next);
    saveTheme(next);
    updateThemeToggleButton();
}

function updateThemeToggleButton() {
    const button = document.getElementById("themeToggle");
    if (!button) return;

    const current = getCurrentTheme();
    const icons = {
        system: "🔄",
        light: "☀️",
        dark: "🌙",
    };

    const labels = {
        system: "System",
        light: "Light",
        dark: "Dark",
    };

    button.innerHTML = `${icons[current]} ${labels[current]}`;
    button.title = `Current theme: ${labels[current]}. Click to cycle through themes.`;
}

function updateChartTheme(theme) {
    // Update chart colors based on theme
    if (tradesChart) {
        const gridColor =
            theme === "dark"
                ? "rgba(255, 255, 255, 0.25)"
                : "rgba(102, 102, 102, 0.1)";
        const annotationColor =
            theme === "dark"
                ? "rgba(255, 255, 255, 0.6)"
                : "rgba(102, 102, 102, 0.4)";
        const tickColor = theme === "dark" ? "#e0e0e0" : "#666666";

        // Update grid colors
        tradesChart.options.scales.x.grid.color = gridColor;
        tradesChart.options.scales.y.grid =
            tradesChart.options.scales.y.grid || {};
        tradesChart.options.scales.y.grid.color = gridColor;

        // Update tick colors
        tradesChart.options.scales.x.ticks.color = tickColor;
        tradesChart.options.scales.y.ticks.color = tickColor;

        // Update annotation colors
        const annotations = tradesChart.options.plugins.annotation.annotations;
        Object.keys(annotations).forEach((key) => {
            if (key.includes("15min") || !isNaN(key)) {
                annotations[key].borderColor = annotationColor;
            }
        });

        tradesChart.update("none");
    }

    // Update order book chart colors
    if (orderBookChart) {
        const gridColor =
            theme === "dark"
                ? "rgba(255, 255, 255, 0.25)"
                : "rgba(102, 102, 102, 0.1)";
        const tickColor = theme === "dark" ? "#e0e0e0" : "#666666";

        // Update grid colors
        orderBookChart.options.scales.x.grid =
            orderBookChart.options.scales.x.grid || {};
        orderBookChart.options.scales.x.grid.color = gridColor;
        orderBookChart.options.scales.y.grid =
            orderBookChart.options.scales.y.grid || {};
        orderBookChart.options.scales.y.grid.color = gridColor;

        // Update tick colors
        orderBookChart.options.scales.x.ticks.color = tickColor;
        orderBookChart.options.scales.y.ticks.color = tickColor;

        // Update order book bar colors with better visibility in dark mode
        updateOrderBookBarColors(theme);

        scheduleOrderBookUpdate();
    }
}

function updateOrderBookBarColors(theme) {
    if (!orderBookChart || !orderBookData) return;

    const datasets = orderBookChart.data.datasets;
    if (!datasets || datasets.length < 2) return;

    // Enhanced colors for better visibility in dark mode
    const askColors = [];
    const bidColors = [];

    orderBookData.priceLevels.forEach((level) => {
        // Ask colors (red) - enhanced opacity for dark mode
        const askOpacity =
            theme === "dark"
                ? Math.min(level.ask / 1500, 0.9) // Higher max opacity in dark mode
                : Math.min(level.ask / 2000, 1);

        const askColor = level.ask
            ? theme === "dark"
                ? `rgba(255, 80, 80, ${Math.max(askOpacity, 0.3)})` // Brighter red with min opacity
                : `rgba(255, 0, 0, ${askOpacity})`
            : "rgba(0, 0, 0, 0)";

        // Bid colors (green) - enhanced opacity for dark mode
        const bidOpacity =
            theme === "dark"
                ? Math.min(level.bid / 1500, 0.9) // Higher max opacity in dark mode
                : Math.min(level.bid / 2000, 1);

        const bidColor = level.bid
            ? theme === "dark"
                ? `rgba(80, 255, 80, ${Math.max(bidOpacity, 0.3)})` // Brighter green with min opacity
                : `rgba(0, 128, 0, ${bidOpacity})`
            : "rgba(0, 0, 0, 0)";

        // Add ask position
        askColors.push(askColor);
        bidColors.push("rgba(0, 0, 0, 0)");

        // Add bid position
        askColors.push("rgba(0, 0, 0, 0)");
        bidColors.push(bidColor);
    });

    // Update the chart datasets
    datasets[0].backgroundColor = askColors; // Asks
    datasets[1].backgroundColor = bidColors; // Bids

    // Update border colors for better definition in dark mode
    const borderOpacity = theme === "dark" ? 0.8 : 0.5;
    datasets[0].borderColor =
        theme === "dark"
            ? `rgba(255, 120, 120, ${borderOpacity})`
            : `rgba(255, 0, 0, ${borderOpacity})`;
    datasets[1].borderColor =
        theme === "dark"
            ? `rgba(120, 255, 120, ${borderOpacity})`
            : `rgba(0, 128, 0, ${borderOpacity})`;
}

function triggerChartResize() {
    // Trigger chart resize after column resize
    if (tradesChart) tradesChart.resize();
    if (orderBookChart) orderBookChart.resize();
}

/**
 * Sets up Interact.js for draggable and resizable chart containers.
 * DEPRECATED: This function is no longer used for the new column-based layout.
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
                    t.setAttribute(
                        "data-prev-x",
                        t.getAttribute("data-x") || 0
                    );
                    t.setAttribute(
                        "data-prev-y",
                        t.getAttribute("data-y") || 0
                    );
                },
                move(event) {
                    const target = event.target;
                    let x =
                        (parseFloat(target.getAttribute("data-x")) || 0) +
                        event.dx;
                    let y =
                        (parseFloat(target.getAttribute("data-y")) || 0) +
                        event.dy;
                    x = snap(x);
                    y = snap(y);
                    ({ x, y } = snapToOthers(
                        x,
                        y,
                        target.offsetWidth,
                        target.offsetHeight,
                        target
                    ));
                    target.style.transform = `translate(${x}px, ${y}px)`;
                    target.setAttribute("data-x", x);
                    target.setAttribute("data-y", y);
                    scheduleLayoutAdjust(target);
                },
                end(event) {
                    const target = event.target;
                    if (isOverlapping(target)) {
                        const px =
                            parseFloat(target.getAttribute("data-prev-x")) || 0;
                        const py =
                            parseFloat(target.getAttribute("data-prev-y")) || 0;
                        target.style.transform = `translate(${px}px, ${py}px)`;
                        target.setAttribute("data-x", px);
                        target.setAttribute("data-y", py);
                    } else {
                        target.setAttribute(
                            "data-prev-x",
                            target.getAttribute("data-x")
                        );
                        target.setAttribute(
                            "data-prev-y",
                            target.getAttribute("data-y")
                        );
                    }
                    adjustLayout(target);
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
                    t.setAttribute(
                        "data-prev-x",
                        t.getAttribute("data-x") || 0
                    );
                    t.setAttribute(
                        "data-prev-y",
                        t.getAttribute("data-y") || 0
                    );
                },
                move(event) {
                    const target = event.target;
                    let x =
                        (parseFloat(target.getAttribute("data-x")) || 0) +
                        event.deltaRect.left;
                    let y =
                        (parseFloat(target.getAttribute("data-y")) || 0) +
                        event.deltaRect.top;
                    let width = snap(event.rect.width);
                    let height = snap(event.rect.height);
                    x = snap(x);
                    y = snap(y);
                    ({ x, y } = snapToOthers(x, y, width, height, target));
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
                    scheduleLayoutAdjust(target);
                },
                end(event) {
                    const target = event.target;
                    if (isOverlapping(target)) {
                        const px =
                            parseFloat(target.getAttribute("data-prev-x")) || 0;
                        const py =
                            parseFloat(target.getAttribute("data-prev-y")) || 0;
                        const pw = parseFloat(
                            target.getAttribute("data-prev-w")
                        );
                        const ph = parseFloat(
                            target.getAttribute("data-prev-h")
                        );
                        target.style.width = `${pw}px`;
                        target.style.height = `${ph}px`;
                        target.style.transform = `translate(${px}px, ${py}px)`;
                        target.setAttribute("data-x", px);
                        target.setAttribute("data-y", py);
                    } else {
                        target.setAttribute(
                            "data-prev-x",
                            target.getAttribute("data-x")
                        );
                        target.setAttribute(
                            "data-prev-y",
                            target.getAttribute("data-y")
                        );
                        target.setAttribute(
                            "data-prev-w",
                            parseFloat(target.style.width)
                        );
                        target.setAttribute(
                            "data-prev-h",
                            parseFloat(target.style.height)
                        );
                    }
                    adjustLayout(target);
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
                    t.setAttribute(
                        "data-prev-x",
                        t.getAttribute("data-x") || 0
                    );
                    t.setAttribute(
                        "data-prev-y",
                        t.getAttribute("data-y") || 0
                    );
                },
                move(event) {
                    const target = event.target;
                    let x =
                        (parseFloat(target.getAttribute("data-x")) || 0) +
                        event.dx;
                    let y =
                        (parseFloat(target.getAttribute("data-y")) || 0) +
                        event.dy;
                    x = snap(x);
                    y = snap(y);
                    ({ x, y } = snapToOthers(
                        x,
                        y,
                        target.offsetWidth,
                        target.offsetHeight,
                        target
                    ));
                    target.style.transform = `translate(${x}px, ${y}px)`;
                    target.setAttribute("data-x", x);
                    target.setAttribute("data-y", y);
                    scheduleLayoutAdjust(target);
                },
                end(event) {
                    const target = event.target;
                    if (isOverlapping(target)) {
                        const px =
                            parseFloat(target.getAttribute("data-prev-x")) || 0;
                        const py =
                            parseFloat(target.getAttribute("data-prev-y")) || 0;
                        target.style.transform = `translate(${px}px, ${py}px)`;
                        target.setAttribute("data-x", px);
                        target.setAttribute("data-y", py);
                    } else {
                        target.setAttribute(
                            "data-prev-x",
                            target.getAttribute("data-x")
                        );
                        target.setAttribute(
                            "data-prev-y",
                            target.getAttribute("data-y")
                        );
                    }
                    adjustLayout(target);
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
                    t.setAttribute(
                        "data-prev-x",
                        t.getAttribute("data-x") || 0
                    );
                    t.setAttribute(
                        "data-prev-y",
                        t.getAttribute("data-y") || 0
                    );
                },
                move(event) {
                    const target = event.target;
                    let x =
                        (parseFloat(target.getAttribute("data-x")) || 0) +
                        event.deltaRect.left;
                    let y =
                        (parseFloat(target.getAttribute("data-y")) || 0) +
                        event.deltaRect.top;
                    let width = snap(event.rect.width);
                    let height = snap(event.rect.height);
                    x = snap(x);
                    y = snap(y);
                    ({ x, y } = snapToOthers(x, y, width, height, target));
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
                    scheduleLayoutAdjust(target);
                },
                end(event) {
                    const target = event.target;
                    if (isOverlapping(target)) {
                        const px =
                            parseFloat(target.getAttribute("data-prev-x")) || 0;
                        const py =
                            parseFloat(target.getAttribute("data-prev-y")) || 0;
                        const pw = parseFloat(
                            target.getAttribute("data-prev-w")
                        );
                        const ph = parseFloat(
                            target.getAttribute("data-prev-h")
                        );
                        target.style.width = `${pw}px`;
                        target.style.height = `${ph}px`;
                        target.style.transform = `translate(${px}px, ${py}px)`;
                        target.setAttribute("data-x", px);
                        target.setAttribute("data-y", py);
                    } else {
                        target.setAttribute(
                            "data-prev-x",
                            target.getAttribute("data-x")
                        );
                        target.setAttribute(
                            "data-prev-y",
                            target.getAttribute("data-y")
                        );
                        target.setAttribute(
                            "data-prev-w",
                            parseFloat(target.style.width)
                        );
                        target.setAttribute(
                            "data-prev-h",
                            parseFloat(target.style.height)
                        );
                    }
                    adjustLayout(target);
                },
            },
        });

    interact(".gauge-container")
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
                    t.setAttribute(
                        "data-prev-x",
                        t.getAttribute("data-x") || 0
                    );
                    t.setAttribute(
                        "data-prev-y",
                        t.getAttribute("data-y") || 0
                    );
                },
                move(event) {
                    const target = event.target;
                    let x =
                        (parseFloat(target.getAttribute("data-x")) || 0) +
                        event.dx;
                    let y =
                        (parseFloat(target.getAttribute("data-y")) || 0) +
                        event.dy;
                    x = snap(x);
                    y = snap(y);
                    ({ x, y } = snapToOthers(
                        x,
                        y,
                        target.offsetWidth,
                        target.offsetHeight,
                        target
                    ));
                    target.style.transform = `translate(${x}px, ${y}px)`;
                    target.setAttribute("data-x", x);
                    target.setAttribute("data-y", y);
                    scheduleLayoutAdjust(target);
                },
                end(event) {
                    const target = event.target;
                    if (isOverlapping(target)) {
                        const px =
                            parseFloat(target.getAttribute("data-prev-x")) || 0;
                        const py =
                            parseFloat(target.getAttribute("data-prev-y")) || 0;
                        target.style.transform = `translate(${px}px, ${py}px)`;
                        target.setAttribute("data-x", px);
                        target.setAttribute("data-y", py);
                    } else {
                        target.setAttribute(
                            "data-prev-x",
                            target.getAttribute("data-x")
                        );
                        target.setAttribute(
                            "data-prev-y",
                            target.getAttribute("data-y")
                        );
                    }
                    adjustLayout(target);
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
                    t.setAttribute(
                        "data-prev-x",
                        t.getAttribute("data-x") || 0
                    );
                    t.setAttribute(
                        "data-prev-y",
                        t.getAttribute("data-y") || 0
                    );
                },
                move(event) {
                    const target = event.target;
                    let x =
                        (parseFloat(target.getAttribute("data-x")) || 0) +
                        event.deltaRect.left;
                    let y =
                        (parseFloat(target.getAttribute("data-y")) || 0) +
                        event.deltaRect.top;
                    let width = snap(event.rect.width);
                    let height = snap(event.rect.height);
                    x = snap(x);
                    y = snap(y);
                    ({ x, y } = snapToOthers(x, y, width, height, target));
                    target.style.width = `${width}px`;
                    target.style.height = `${height}px`;
                    target.style.transform = `translate(${x}px, ${y}px)`;
                    target.setAttribute("data-x", x);
                    target.setAttribute("data-y", y);
                    scheduleLayoutAdjust(target);
                },
                end(event) {
                    const target = event.target;
                    if (isOverlapping(target)) {
                        const px =
                            parseFloat(target.getAttribute("data-prev-x")) || 0;
                        const py =
                            parseFloat(target.getAttribute("data-prev-y")) || 0;
                        const pw = parseFloat(
                            target.getAttribute("data-prev-w")
                        );
                        const ph = parseFloat(
                            target.getAttribute("data-prev-h")
                        );
                        target.style.width = `${pw}px`;
                        target.style.height = `${ph}px`;
                        target.style.transform = `translate(${px}px, ${py}px)`;
                        target.setAttribute("data-x", px);
                        target.setAttribute("data-y", py);
                    } else {
                        target.setAttribute(
                            "data-prev-x",
                            target.getAttribute("data-x")
                        );
                        target.setAttribute(
                            "data-prev-y",
                            target.getAttribute("data-y")
                        );
                        target.setAttribute(
                            "data-prev-w",
                            parseFloat(target.style.width)
                        );
                        target.setAttribute(
                            "data-prev-h",
                            parseFloat(target.style.height)
                        );
                    }
                    adjustLayout(target);
                },
            },
        });
}

/**
 * Initializes the application on DOM content loaded.
 */
function initialize() {
    // Restore ALL saved settings FIRST, before any UI setup or rendering
    restoreTheme();
    restoreColumnWidths();
    restoreAnomalyFilters();
    restoreTimeRange();

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

    // Initialize charts
    tradesChart = initializeTradesChart(tradesCtx);
    orderBookChart = initializeOrderBookChart(orderBookCtx);

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
}

function addAnomalyChartLabel(anomaly) {
    if (!tradesChart) return;
    const now = anomaly.time || anomaly.detectedAt || Date.now();
    tradesChart.options.plugins.annotation.annotations =
        tradesChart.options.plugins.annotation.annotations || {};
    tradesChart.options.plugins.annotation.annotations[`anomaly.${now}`] = {
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
    tradesChart.update("none");
}

/**
 * Handle incoming support/resistance level data
 */
function handleSupportResistanceLevel(levelData) {
    if (!tradesChart || !levelData.data) return;

    const level = levelData.data;

    // Add to levels array
    supportResistanceLevels.unshift(level);

    // Limit the number of levels to prevent chart clutter
    if (supportResistanceLevels.length > maxSupportResistanceLevels) {
        // Remove oldest level from chart
        const oldestLevel = supportResistanceLevels.pop();
        removeSupportResistanceLevel(oldestLevel.id);
    }

    // Add level to chart
    addSupportResistanceToChart(level);

    console.log("Support/Resistance level added to chart:", {
        id: level.id,
        price: level.price,
        type: level.type,
        strength: level.strength,
        touchCount: level.touchCount,
    });
}

/**
 * Add support/resistance level as translucent bar on chart
 */
function addSupportResistanceToChart(level) {
    if (!tradesChart) return;

    const annotations = tradesChart.options.plugins.annotation.annotations;
    const levelId = `sr_level_${level.id}`;

    // Determine color based on type and strength
    const isSupport = level.type === "support";
    const baseColor = isSupport ? "34, 197, 94" : "239, 68, 68"; // Green for support, red for resistance
    const alpha = Math.max(0.2, Math.min(0.5, level.strength)); // Opacity based on strength

    // Calculate time boundaries for the zone
    const now = Date.now();
    const startTime = level.firstDetected;
    // Zone is valid until crossed or for a maximum duration
    const maxValidDuration = 4 * 60 * 60 * 1000; // 4 hours maximum
    const endTime = Math.min(
        now + maxValidDuration,
        level.lastTouched + maxValidDuration
    );

    // Create price tolerance for zone height - make it proportional to strength and touch count
    const baseThickness = level.price * 0.0008; // 0.08% base thickness
    const strengthMultiplier = 1 + level.strength * 2; // 1x to 3x based on strength
    const touchMultiplier = 1 + Math.min(level.touchCount / 10, 1); // Additional thickness for more touches
    const zoneHeight = baseThickness * strengthMultiplier * touchMultiplier;

    // Add the time-bounded zone box
    annotations[levelId] = {
        type: "box",
        xMin: startTime,
        xMax: endTime,
        yMin: level.price - zoneHeight / 2,
        yMax: level.price + zoneHeight / 2,
        backgroundColor: `rgba(${baseColor}, ${alpha})`,
        borderColor: `rgba(${baseColor}, ${Math.min(alpha * 1.5, 0.8)})`,
        borderWidth: 1,
        borderDash: level.roleReversals?.length > 0 ? [5, 5] : undefined, // Dashed if has role reversals
        drawTime: "beforeDatasetsDraw",
        z: 1,
        // Add hover interaction
        enter: function (context, event) {
            showSupportResistanceTooltip(level, event);
        },
        leave: function () {
            hideSupportResistanceTooltip();
        },
    };

    // Add a label for the level - positioned at the start of the zone
    const labelId = `sr_label_${level.id}`;
    annotations[labelId] = {
        type: "label",
        xValue: startTime,
        yValue: level.price,
        content: `${isSupport ? "SUPPORT" : "RESISTANCE"} $${level.price.toFixed(2)}`,
        backgroundColor: `rgba(${baseColor}, 0.9)`,
        color: "white",
        font: {
            size: 9,
            weight: "bold",
            family: "monospace",
        },
        padding: 3,
        borderRadius: 3,
        position: {
            x: "start",
            y: "center",
        },
        xAdjust: 5,
        drawTime: "afterDatasetsDraw",
        z: 5,
    };

    tradesChart.update("none");
}

/**
 * Remove support/resistance level from chart
 */
function removeSupportResistanceLevel(levelId) {
    if (!tradesChart) return;

    const annotations = tradesChart.options.plugins.annotation.annotations;
    const barId = `sr_level_${levelId}`;
    const labelId = `sr_label_${levelId}`;

    delete annotations[barId];
    delete annotations[labelId];

    tradesChart.update("none");
}

/**
 * Show tooltip for support/resistance level
 */
function showSupportResistanceTooltip(level, event) {
    const tooltip = document.createElement("div");
    tooltip.className = "sr-tooltip";
    tooltip.innerHTML = `
        <div><strong>${level.type.toUpperCase()}: $${level.price.toFixed(2)}</strong></div>
        <div>Strength: ${(level.strength * 100).toFixed(1)}%</div>
        <div>Touches: ${level.touchCount}</div>
        <div>Volume: ${level.volumeAtLevel.toFixed(2)}</div>
        ${level.roleReversals?.length > 0 ? `<div>Role Reversals: ${level.roleReversals.length}</div>` : ""}
        <div>First: ${new Date(level.firstDetected).toLocaleTimeString()}</div>
        <div>Last: ${new Date(level.lastTouched).toLocaleTimeString()}</div>
    `;

    tooltip.style.position = "absolute";
    tooltip.style.background = "var(--bg-secondary)";
    tooltip.style.border = "1px solid var(--border-color)";
    tooltip.style.borderRadius = "4px";
    tooltip.style.padding = "8px";
    tooltip.style.fontSize = "11px";
    tooltip.style.zIndex = "1000";
    tooltip.style.pointerEvents = "none";
    tooltip.style.left = `${event.clientX + 10}px`;
    tooltip.style.top = `${event.clientY - 10}px`;

    document.body.appendChild(tooltip);

    // Store reference for cleanup
    window.activeSRTooltip = tooltip;
}

/**
 * Hide support/resistance tooltip
 */
function hideSupportResistanceTooltip() {
    if (window.activeSRTooltip) {
        window.activeSRTooltip.remove();
        window.activeSRTooltip = null;
    }
}

/**
 * Check if a trade price breaches any support/resistance zones and invalidate them
 */
function checkSupportResistanceBreaches(tradePrice, tradeTime) {
    if (!supportResistanceLevels.length) return;

    supportResistanceLevels = supportResistanceLevels.filter((level) => {
        // Calculate breach threshold - zone is breached if price moves significantly beyond it
        const zoneHeight =
            level.price *
            0.0008 *
            (1 + level.strength * 2) *
            (1 + Math.min(level.touchCount / 10, 1));
        const breachThreshold = zoneHeight * 2; // Breach if price moves 2x zone height beyond level

        let isBreached = false;

        if (level.type === "support") {
            // Support is breached if price falls significantly below it
            isBreached = tradePrice < level.price - breachThreshold;
        } else {
            // Resistance is breached if price rises significantly above it
            isBreached = tradePrice > level.price + breachThreshold;
        }

        if (isBreached) {
            console.log(`${level.type.toUpperCase()} level breached:`, {
                levelPrice: level.price,
                tradePrice: tradePrice,
                threshold: breachThreshold,
                levelId: level.id,
            });

            removeSupportResistanceLevel(level.id);
            return false; // Remove from array
        }

        return true; // Keep in array
    });
}

/**
 * Clean up old support/resistance levels based on time
 */
function cleanupOldSupportResistanceLevels() {
    const cutoffTime = Date.now() - 2 * 60 * 60 * 1000; // 2 hours

    supportResistanceLevels = supportResistanceLevels.filter((level) => {
        if (level.lastTouched < cutoffTime) {
            removeSupportResistanceLevel(level.id);
            return false;
        }
        return true;
    });
}

/**
 * Zone Management Functions
 * Handle accumulation/distribution zones as visual boxes on the chart
 */

/**
 * Handle zone update messages from WebSocket
 */
function handleZoneUpdate(updateData) {
    const { updateType, zone, significance } = updateData;

    switch (updateType) {
        case "zone_created":
            createZoneBox(zone);
            break;
        case "zone_updated":
        case "zone_strengthened":
        case "zone_weakened":
            updateZoneBox(zone);
            break;
        case "zone_completed":
            completeZoneBox(zone);
            break;
        case "zone_invalidated":
            removeZoneBox(zone.id);
            break;
    }
}

/**
 * Handle zone signal messages - add to signals list
 */
function handleZoneSignal(signalData) {
    const {
        signalType,
        zone,
        actionType,
        confidence,
        urgency,
        expectedDirection,
    } = signalData;

    // Create a normalized signal for the signals list
    const normalizedSignal = {
        id: `zone_${zone.id}_${Date.now()}`,
        type: `${zone.type}_zone_${signalType}`,
        price: zone.priceRange.center,
        time: Date.now(),
        side:
            expectedDirection === "up"
                ? "buy"
                : expectedDirection === "down"
                  ? "sell"
                  : "neutral",
        confidence: confidence,
        urgency: urgency,
        zone: zone,
        stopLoss: signalData.stopLossLevel,
        takeProfit: signalData.takeProfitLevel,
        positionSizing: signalData.positionSizing,
    };

    // Add to signals list
    signalsList.unshift(normalizedSignal);
    if (signalsList.length > 50) {
        signalsList = signalsList.slice(0, 50);
    }
    renderSignalsList();
}

/**
 * Create a zone box on the chart
 */
function createZoneBox(zone) {
    // Store zone data
    activeZones.set(zone.id, zone);

    // Limit number of active zones
    if (activeZones.size > maxActiveZones) {
        const oldestZoneId = activeZones.keys().next().value;
        removeZoneBox(oldestZoneId);
    }

    // Add zone box to chart
    addZoneToChart(zone);
}

/**
 * Update an existing zone box
 */
function updateZoneBox(zone) {
    activeZones.set(zone.id, zone);

    // Update the chart annotation
    if (tradesChart?.options?.plugins?.annotation?.annotations) {
        const annotation =
            tradesChart.options.plugins.annotation.annotations[
                `zone_${zone.id}`
            ];
        if (annotation) {
            // Update zone properties
            annotation.yMin = zone.priceRange.min;
            annotation.yMax = zone.priceRange.max;
            annotation.backgroundColor = getZoneColor(zone);
            annotation.borderColor = getZoneBorderColor(zone);
            annotation.label.content = getZoneLabel(zone);

            tradesChart.update("none");
        }
    }
}

/**
 * Mark zone as completed (change visual style)
 */
function completeZoneBox(zone) {
    activeZones.set(zone.id, zone);

    if (tradesChart?.options?.plugins?.annotation?.annotations) {
        const annotation =
            tradesChart.options.plugins.annotation.annotations[
                `zone_${zone.id}`
            ];
        if (annotation) {
            // Change to completed zone style
            annotation.backgroundColor = getCompletedZoneColor(zone);
            annotation.borderColor = getCompletedZoneBorderColor(zone);
            annotation.borderWidth = 2;
            annotation.borderDash = [5, 5]; // Dashed border for completed zones
            annotation.label.content = getZoneLabel(zone) + " ✓";

            tradesChart.update("none");

            // Auto-remove completed zones after 30 minutes
            setTimeout(
                () => {
                    removeZoneBox(zone.id);
                },
                30 * 60 * 1000
            );
        }
    }
}

/**
 * Remove zone box from chart
 */
function removeZoneBox(zoneId) {
    activeZones.delete(zoneId);

    if (tradesChart?.options?.plugins?.annotation?.annotations) {
        delete tradesChart.options.plugins.annotation.annotations[
            `zone_${zoneId}`
        ];
        tradesChart.update("none");
    }
}

/**
 * Add zone as chart annotation
 */
function addZoneToChart(zone) {
    if (!tradesChart?.options?.plugins?.annotation?.annotations) return;

    const zoneAnnotation = {
        type: "box",
        xMin: zone.startTime,
        xMax: Date.now() + 5 * 60 * 1000, // Extend 5 minutes into future
        yMin: zone.priceRange.min,
        yMax: zone.priceRange.max,
        backgroundColor: getZoneColor(zone),
        borderColor: getZoneBorderColor(zone),
        borderWidth: 1,
        label: {
            display: true,
            content: getZoneLabel(zone),
            position: "start",
            font: {
                size: 10,
                weight: "bold",
            },
            color: getZoneTextColor(zone),
            backgroundColor: "rgba(255, 255, 255, 0.8)",
            padding: 4,
            borderRadius: 3,
        },
        enter: (ctx, event) => {
            showZoneTooltip(zone, event);
        },
        leave: () => {
            hideZoneTooltip();
        },
    };

    tradesChart.options.plugins.annotation.annotations[`zone_${zone.id}`] =
        zoneAnnotation;
    tradesChart.update("none");
}

/**
 * Get zone background color based on type and strength
 */
function getZoneColor(zone) {
    const alpha = Math.max(0.15, zone.strength * 0.4); // Min 15%, max 40% opacity

    if (zone.type === "accumulation") {
        return `rgba(34, 197, 94, ${alpha})`; // Green
    } else {
        return `rgba(239, 68, 68, ${alpha})`; // Red
    }
}

/**
 * Get zone border color
 */
function getZoneBorderColor(zone) {
    if (zone.type === "accumulation") {
        return "rgba(34, 197, 94, 0.8)"; // Green
    } else {
        return "rgba(239, 68, 68, 0.8)"; // Red
    }
}

/**
 * Get completed zone colors (more muted)
 */
function getCompletedZoneColor(zone) {
    if (zone.type === "accumulation") {
        return "rgba(34, 197, 94, 0.2)"; // Lighter green
    } else {
        return "rgba(239, 68, 68, 0.2)"; // Lighter red
    }
}

function getCompletedZoneBorderColor(zone) {
    if (zone.type === "accumulation") {
        return "rgba(34, 197, 94, 0.5)"; // Muted green
    } else {
        return "rgba(239, 68, 68, 0.5)"; // Muted red
    }
}

/**
 * Get zone text color
 */
function getZoneTextColor(zone) {
    if (zone.type === "accumulation") {
        return "rgba(21, 128, 61, 1)"; // Dark green
    } else {
        return "rgba(153, 27, 27, 1)"; // Dark red
    }
}

/**
 * Generate zone label text
 */
function getZoneLabel(zone) {
    const typeLabel = zone.type === "accumulation" ? "ACC" : "DIST";
    const strengthPercent = Math.round(zone.strength * 100);
    const completionPercent = Math.round(zone.completion * 100);

    return `${typeLabel} ${strengthPercent}% (${completionPercent}%)`;
}

/**
 * Show zone tooltip on hover
 */
function showZoneTooltip(zone, event) {
    const tooltip = document.createElement("div");
    tooltip.id = "zoneTooltip";
    tooltip.style.cssText = `
        position: fixed;
        background: rgba(0, 0, 0, 0.9);
        color: white;
        padding: 12px;
        border-radius: 6px;
        font-size: 12px;
        font-family: monospace;
        pointer-events: none;
        z-index: 10000;
        max-width: 300px;
        line-height: 1.4;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    `;

    const duration = Math.round((Date.now() - zone.startTime) / 60000);
    const volumeFormatted = zone.totalVolume.toLocaleString();

    tooltip.innerHTML = `
        <div style="font-weight: bold; margin-bottom: 6px; color: ${zone.type === "accumulation" ? "#22c55e" : "#ef4444"}">
            ${zone.type.toUpperCase()} ZONE
        </div>
        <div>Price Range: $${zone.priceRange.min.toFixed(4)} - $${zone.priceRange.max.toFixed(4)}</div>
        <div>Center: $${zone.priceRange.center.toFixed(4)}</div>
        <div>Strength: ${(zone.strength * 100).toFixed(1)}%</div>
        <div>Completion: ${(zone.completion * 100).toFixed(1)}%</div>
        <div>Confidence: ${(zone.confidence * 100).toFixed(1)}%</div>
        <div>Duration: ${duration}m</div>
        <div>Volume: ${volumeFormatted}</div>
        <div>Trades: ${zone.tradeCount}</div>
        <div style="margin-top: 6px; font-size: 10px; opacity: 0.8">
            ID: ${zone.id}
        </div>
    `;

    tooltip.style.left = `${event.clientX + 10}px`;
    tooltip.style.top = `${event.clientY - 10}px`;

    document.body.appendChild(tooltip);
}

/**
 * Hide zone tooltip
 */
function hideZoneTooltip() {
    const tooltip = document.getElementById("zoneTooltip");
    if (tooltip) {
        tooltip.remove();
    }
}

/**
 * Cleanup old completed zones
 */
function cleanupOldZones() {
    const cutoffTime = Date.now() - 60 * 60 * 1000; // 1 hour

    for (const [zoneId, zone] of activeZones) {
        if (!zone.isActive && zone.endTime && zone.endTime < cutoffTime) {
            removeZoneBox(zoneId);
        }
    }
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
    const signalsList = document.getElementById("signalsList");
    if (signalsList) {
        signalsList.addEventListener(
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

        signalsList.addEventListener(
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
});
