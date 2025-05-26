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

function buildSignalLabel(signal) {
    let color,
        letter,
        extraInfo = "";

    if (signal.type.startsWith("exhaustion")) {
        letter = "E";
        color = signal.type.includes("confirmed")
            ? "rgba(0, 90, 255, 0.5)" // Blue for confirmed
            : signal.side === "sell"
              ? "rgba(255, 0, 0, 0.5)"
              : "rgba(0, 200, 0, 0.5)"; // Red/Green
    } else if (signal.type.startsWith("absorption")) {
        letter = "A";
        color = signal.type.includes("confirmed")
            ? "rgba(0, 90, 255, 1)"
            : signal.side === "sell"
              ? "rgba(255, 0, 0, 1)"
              : "rgba(0, 200, 0, 1)";
    } else {
        letter = "?";
        color = "rgba(128,128,128,0.5)";
    }

    // Compose info for testing
    if (signal.totalAggressiveVolume !== undefined)
        extraInfo += `\nAgg: ${signal.totalAggressiveVolume}`;
    if (signal.passiveVolume !== undefined)
        extraInfo += `\nPass: ${signal.passiveVolume}`;
    if (signal.refilled !== undefined)
        extraInfo += `\nRefilled: ${signal.refilled ? "Y" : "N"}`;
    if (signal.zone) extraInfo += `\nZone: ${signal.zone}`;
    if (signal.closeReason) extraInfo += `\n(${signal.closeReason})`;

    return {
        type: "label",
        xValue: signal.time,
        yValue: signal.price,
        content: `${letter}\n${extraInfo.trim()}`,
        backgroundColor: color,
        color: "white",
        font: { size: 14 },
        padding: 8,
        id: `label.${signal.time}.${signal.type}`,
    };
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
                    const label = message.data;
                    tradesChart.options.plugins.annotation.annotations[
                        label.id || `label.${label.time}.${label.type}`
                    ] = buildSignalLabel(label);
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
                        updateIndicators();
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
 * @property {number} ratio - Ask/bid ratio.
 * @property {number} supportPercent - Bid support percentage.
 * @property {boolean} askStable - Ask volume stability.
 * @property {boolean} bidStable - Bid volume stability.
 * @property {Object} direction - Market direction with type and probability.
 * @property {number} volumeImbalance - Volume imbalance metric.
 */
let orderBookData = {
    priceLevels: [],
    ratio: 0,
    supportPercent: 0,
    askStable: true,
    bidStable: false,
    direction: { type: "Stable", probability: 80 },
    volumeImbalance: 0,
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
 * Updates HTML indicators with order book data.
 */
function updateIndicators() {
    if (directionText) {
        directionText.textContent = `Direction: ${orderBookData.direction.type} (${orderBookData.direction.probability}%)`;
        directionText.style.color =
            orderBookData.direction.type === "Down"
                ? "red"
                : orderBookData.direction.type === "Up"
                  ? "green"
                  : "gray";
    }

    if (ratioText) {
        ratioText.textContent = `Ask/Bid Ratio: ${orderBookData.ratio.toFixed(2)} (Threshold: 2)`;
    }

    if (supportText) {
        supportText.textContent = `Bid Support: ${orderBookData.supportPercent.toFixed(2)}% (Threshold: 50%)`;
    }

    if (stabilityText) {
        stabilityText.textContent = `Ask Volume Stability: ${orderBookData.askStable ? "Stable" : "Unstable"}`;
        stabilityText.style.color = orderBookData.askStable ? "green" : "red";
    }

    if (volumeImbalance) {
        volumeImbalance.textContent = `Volume Imbalance: ${orderBookData.volumeImbalance.toFixed(2)} (Short < -0.65 | Long > 0.65)`;
        volumeImbalance.style.color =
            orderBookData.volumeImbalance > 0.65
                ? "green"
                : orderBookData.volumeImbalance < -0.65
                  ? "red"
                  : "gray";
    }

    if (orderBookContainer) {
        orderBookContainer.style.border = `3px solid ${orderBookData.askStable ? "green" : "red"}`;
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
                move(event) {
                    const target = event.target;
                    const x =
                        (parseFloat(target.getAttribute("data-x")) || 0) +
                        event.dx;
                    const y =
                        (parseFloat(target.getAttribute("data-y")) || 0) +
                        event.dy;
                    target.style.transform = `translate(${x}px, ${y}px)`;
                    target.setAttribute("data-x", x);
                    target.setAttribute("data-y", y);
                },
            },
        })
        .resizable({
            edges: { left: true, right: true, bottom: true, top: true },
            modifiers: [
                interact.modifiers.restrictSize({
                    min: { width: 600, height: 600 },
                }),
            ],
            listeners: {
                move(event) {
                    const target = event.target;
                    target.style.width = `${event.rect.width}px`;
                    target.style.height = `${event.rect.height}px`;
                    const canvas = target.querySelector("canvas");
                    if (canvas) {
                        canvas.width = event.rect.width;
                        canvas.height = event.rect.height;
                        const chart = Chart.getChart(canvas.id);
                        if (chart) chart.resize();
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
            move: function (event) {
                const target = event.target;
                const x =
                    (parseFloat(target.getAttribute("data-x")) || 0) + event.dx;
                const y =
                    (parseFloat(target.getAttribute("data-y")) || 0) + event.dy;
                target.style.transform = `translate(${x}px, ${y}px)`;
                target.setAttribute("data-x", x);
                target.setAttribute("data-y", y);
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

// Start application
document.addEventListener("DOMContentLoaded", initialize);
