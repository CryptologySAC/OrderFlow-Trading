/**
 * Trading dashboard for visualizing real-time trades and order book data via WebSocket.
 * Displays a scatter chart for trades and a bar chart for order book, with interactive UI.
 * Uses Chart.js for charts, chartjs-plugin-annotation for annotations, and Interact.js for drag/resize.
 * @module TradingDashboard
 */

/**
 * WebSocket URL for trade data.
 * @constant {string}
 */
const TRADE_WEBSOCKET_URL = 'wss://api.cryptology.pe/ltcusdt_trades';
let tradeWs = null;
let tradeWsReconnectAttempts = 0;
let tradeWsPingInterval = null;
let tradeWsPongTimeout = null;

/**
 * WebSocket URL for order book data.
 * @constant {string}
 */
const ORDERBOOK_WEBSOCKET_URL = 'wss://api.cryptology.pe/ltcusdt_orderbook';
let orderBookWs = null;
let orderBookWsReconnectAttempts = 0;
let orderBookWsPingInterval = null;
let orderBookWsPongTimeout = null;

/**
 * Maxium retires to connect to a websocket
 * @constant {number}
 */
const MAX_RECONNECT_ATTEMPTS = 10;

/**
 * Reconnect Delay (ms)
 * @constant {number}
 */
const RECONNECT_DELAY = 1000; // 1 second

/**
 * Maximum number of trades to store.
 * @constant {number}
 */
const MAX_TRADES = 50000;

/**
 * Interval for pinging the WebSocket (ms).
 * @constant {number}
 */
const PING_INTERVAL_MS = 10000;

/**
 * Timeout for waiting for a pong response (ms).
 *  @constant {number}
 */
const PONG_WAIT_MS = 5000;

/**
 * Padding time for the trades chart (ms).
 * @constant {number}
 */
const PADDING_TIME = 300000; // 5 minutes

/**
 * Interval for 15-minute annotations (ms).
 * @constant {number}
 */
const FIFTEEN_MINUTES = 15 * 60 * 1000; // 15 minutes

/**
 * Timeout for trade delay gauge (ms).
 * @constant {number}
 */
const TRADE_TIMEOUT_MS = 10000; // 10 seconds

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
  direction: { type: 'Stable', probability: 80 },
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

// DOM references
const tradesCanvas = document.getElementById('tradesChart');
const orderBookCanvas = document.getElementById('orderBookChart');
const rangeSelector = document.querySelector('.rangeSelector');
const delayGaugeCanvas = document.getElementById('delayGauge');

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
    trade != null &&
    typeof trade.time === 'number' &&
    typeof trade.price === 'number' &&
    typeof trade.quantity === 'number' &&
    ['BUY', 'SELL'].includes(trade.orderType)
  );
}

/**
 * Gets the background color for a trade based on type and quantity.
 * @param {Object} context - Chart.js context with trade data.
 * @returns {string} Color as RGBA string.
 */
function getTradeBackgroundColor(context) {
  const trade = context.raw;
  if (!trade) return 'rgba(0, 0, 0, 0)';
  const isBuy = trade.orderType === 'BUY';
  if (trade.quantity > 500) {
    return isBuy ? 'rgba(0, 255, 25, 0.6)' : 'rgba(255, 50, 200, 0.6)';
  } else if (trade.quantity > 200) {
    return isBuy ? 'rgba(0, 100, 25, 0.5)' : 'rgba(255, 0, 20, 0.5)';
  } else if (trade.quantity > 100) {
    return isBuy ? 'rgba(0, 255, 30, 0.4)' : 'rgba(255, 0, 90, 0.4)';
  } else if (trade.quantity > 15) {
    return isBuy ? 'rgba(0, 255, 30, 0.3)' : 'rgba(255, 0, 90, 0.3)';
  }
  return isBuy ? 'rgba(0, 255, 30, 0.2)' : 'rgba(255, 0, 90, 0.2)';
}

/**
 * Gets the point radius for a trade based on quantity.
 * @param {Object} context - Chart.js context with trade data.
 * @returns {number} Radius in pixels.
 */
function getTradePointRadius(context) {
  const trade = context.raw;
  if (!trade) return 2;
  if (trade.quantity > 1000) return 50;
  if (trade.quantity > 500) return 40;
  if (trade.quantity > 200) return 25;
  if (trade.quantity > 100) return 10;
  if (trade.quantity > 50) return 5;
  return 2;
}

/**
 * Initializes the trades scatter chart.
 * @param {CanvasRenderingContext2D} ctx - The canvas 2D context.
 * @returns {Object} The Chart.js instance.
 * @throws {Error} If Chart.js is not loaded.
 */
function initializeTradesChart(ctx) {
  if (typeof Chart === 'undefined') {
    throw new Error('Chart.js is not loaded');
  } 

  return new Chart(ctx, {
    type: 'scatter',
    data: {
      datasets: [
        {
          label: 'Trades',
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
      layout: {
        padding: { right: 20, left: 20 },
      },
      scales: {
        x: {
          type: 'time',
          time: {
            unit: 'minute',
            displayFormats: { minute: 'HH:mm' },
          },
          grid: {
            display: true,
            color: 'rgba(102, 102, 102, 0.1)',
            lineWidth: 1,
          },
          title: { display: false, text: 'Time' },
          ticks: { source: 'auto' },
        },
        y: {
          type: 'linear',
          ticks: { stepSize: 0.05, precision: 2 },
          title: { display: true, text: 'USDT' },
          position: 'right',
          grace: 0.1,
          offset: true,
        },
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: function (context) {
              const trade = context.raw;
              return trade
                ? `Price: ${trade.y.toFixed(2)}, Qty: ${trade.quantity}, Type: ${trade.orderType}`
                : '';
            },
          },
        },
        annotation: {
          annotations: {
            lastPriceLine: {
              type: 'line',
              yMin: undefined,
              yMax: undefined,
              borderColor: 'blue',
              borderWidth: 1,
              drawTime: 'afterDatasetsDraw',
              label: {
                display: true,
                content: function (ctx) {
                  const yValue = ctx.chart.options.plugins.annotation.annotations.lastPriceLine.yMin;
                  return yValue ? `${yValue.toFixed(2)}` : '';
                },
                position: 'end',
                xAdjust: -50,
                yAdjust: 0,
                backgroundColor: 'rgba(0, 0, 255, 1)',
                borderColor: 'blue',
                borderWidth: 2,
                font: { size: 12 },
                color: 'white',
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
  if (typeof RadialGauge === 'undefined') {
    console.error('Canvas Gauges is not loaded');
    return null;
  }
  if (!canvas) {
    console.error('Delay gauge canvas not found');
    return null;
  }

  return new RadialGauge({
    renderTo: canvas,
    width: 200,
    height: 160,
    units: 'ms',
    title: 'Trade Delay',
    minValue: 0,
    maxValue: 2000,
    majorTicks: ['0', '500', '1000', '1500', '2000'],
    minorTicks: 5,
    strokeTicks: true,
    highlights: [
      { from: 0, to: 500, color: 'rgba(0, 255, 0, 0.3)' }, // Green: Low delay
      { from: 500, to: 1000, color: 'rgba(255, 165, 0, 0.3)' }, // Orange: Slow
      { from: 1000, to: 2000, color: 'rgba(255, 0, 0, 0.3)' }, // Red: Very slow
    ],
    colorPlate: '#fff',
    colorMajorTicks: '#444',
    colorMinorTicks: '#666',
    colorTitle: '#000',
    colorUnits: '#000',
    colorNumbers: '#444',
    colorNeedleStart: 'rgba(240, 128, 128, 1)',
    colorNeedleEnd: 'rgba(255, 160, 122, .9)',
    value: 0,
    valueBox: true,
    valueTextShadow: false,
    animationRule: 'linear',
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
    gauge.title="TIMEOUT";
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
  if (typeof Chart === 'undefined') {
    throw new Error('Chart.js is not loaded');
  }

  return new Chart(ctx, {
    type: 'bar',
    data: {
      labels: orderBookData.priceLevels.map((level) => level.price.toFixed(2)),
      datasets: [
        {
          label: 'Asks',
          data: orderBookData.priceLevels.map((level) => level.ask),
          backgroundColor: orderBookData.priceLevels.map((level) =>
            level.ask ? `rgba(255, 0, 0, ${Math.min(level.ask / 2000, 1)})` : 'rgba(0, 0, 0, 0)',
          ),
          borderColor: 'rgba(255, 0, 0, 0.5)',
          borderWidth: 1,
          barThickness: 10,
        },
        {
          label: 'Bids',
          data: orderBookData.priceLevels.map((level) => level.bid),
          backgroundColor: orderBookData.priceLevels.map((level) =>
            level.bid ? `rgba(0, 128, 0, ${Math.min(level.bid / 2000, 1)})` : 'rgba(0, 0, 0, 0)',
          ),
          borderColor: 'rgba(0, 128, 0, 0.5)',
          borderWidth: 1,
          barThickness: 10,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      indexAxis: 'y',
      scales: {
        x: {
          title: { display: true, text: 'Volume (LTC)' },
          ticks: { callback: (value) => Math.abs(value) },
        },
        y: {
          title: { display: true, text: 'Price (USDT)' },
          offset: true,
          reverse: true,
        },
      },
      plugins: {
        legend: {
          display: true,
          position: 'top',
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
              const level = orderBookData.priceLevels[context.dataIndex];
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
  if (window.tradesChart) {
    if (duration !== null) {
      window.tradesChart.options.scales.x.min = now - duration;
      window.tradesChart.options.scales.x.max = now + PADDING_TIME;
    } else {
      window.tradesChart.options.scales.x.min = undefined;
      window.tradesChart.options.scales.x.max = undefined;
    }
    window.tradesChart.update();
  }
}

/**
 * Updates HTML indicators with order book data.
 */
function updateIndicators() {
  const directionText = document.getElementById('directionText');
  if (directionText) {
    directionText.textContent = `Direction: ${orderBookData.direction.type} (${orderBookData.direction.probability}%)`;
    directionText.style.color =
      orderBookData.direction.type === 'Down'
        ? 'red'
        : orderBookData.direction.type === 'Up'
        ? 'green'
        : 'gray';
  }

  const ratioText = document.getElementById('ratioText');
  if (ratioText) {
    ratioText.textContent = `Ask/Bid Ratio: ${orderBookData.ratio.toFixed(2)} (Threshold: 2)`;
  }

  const supportText = document.getElementById('supportText');
  if (supportText) {
    supportText.textContent = `Bid Support: ${orderBookData.supportPercent.toFixed(2)}% (Threshold: 50%)`;
  }

  const stabilityText = document.getElementById('stabilityText');
  if (stabilityText) {
    stabilityText.textContent = `Ask Volume Stability: ${orderBookData.askStable ? 'Stable' : 'Unstable'}`;
    stabilityText.style.color = orderBookData.askStable ? 'green' : 'red';
  }

  const volumeImbalance = document.getElementById('volumeImbalance');
  if (volumeImbalance) {
    volumeImbalance.textContent = `Volume Imbalance: ${orderBookData.volumeImbalance.toFixed(2)} (Short < -0.65 | Long > 0.65)`;
    volumeImbalance.style.color =
      orderBookData.volumeImbalance > 0.65
        ? 'green'
        : orderBookData.volumeImbalance < -0.65
        ? 'red'
        : 'gray';
  }

  const orderBookContainer = document.getElementById('orderBookContainer');
  if (orderBookContainer) {
    orderBookContainer.style.border = `3px solid ${orderBookData.askStable ? 'green' : 'red'}`;
  }
}

/**
 * Sends a Ping to the websocket server
 * @param {string} socket 
 */
function startPing(socket) {
    if (socket === "tradeWs") {
        tradeWsPingInterval = setInterval(() => {
            if (tradeWs && tradeWs.readyState === WebSocket.OPEN) {
                tradeWs.send(JSON.stringify({ type: "ping" }));
                startPongTimeout(socket);
            }
        }, PING_INTERVAL_MS);
    } else if (socket === "orderBookWs") {
        orderBookWsPingInterval = setInterval(() => {
            if (orderBookWs && orderBookWs.readyState === WebSocket.OPEN) {
                orderBookWs.send(JSON.stringify({ type: "ping" }));
                startPongTimeout(socket);
            }
        }, PING_INTERVAL_MS);
    }
}

/**
 * Handle a Pong from the websocket server
 * @param {string} socket
 */
function startPongTimeout(socket) {
    if (socket === "tradeWs") {
        clearPongTimeout(socket);
        tradeWsPongTimeout = setTimeout(() => {
            console.warn("Pong not received, closing Trade socket...");
            tradeWs.close(); // This will trigger the reconnect
        }, PONG_WAIT_MS);
    } else if (socket === "orderBookWs") {
        clearPongTimeout(socket);
        orderBookWsPongTimeout = setTimeout(() => {
            console.warn("Pong not received, closing OrderBook socket...");
            orderBookWs.close(); // This will trigger the reconnect
        }, PONG_WAIT_MS);
    }
  }

/**
 * Clears a Pong Timeout
 * @param {string} socket 
 */
function clearPongTimeout(socket) {
    if (socket === "tradeWs") {
        if (tradeWsPongTimeout) clearTimeout(tradeWsPongTimeout);
        tradeWsPongTimeout = null;
    } else if (socket === "orderBookWs") {  
        if (orderBookWsPongTimeout) clearTimeout(orderBookWsPongTimeout);
        orderBookWsPongTimeout = null;
    }
}

/**
 * Stops a Ping Interval
 * @param {string} socket 
 */
function stopPing(socket) {
    if (socket === "tradeWs") {
        if (tradeWsPingInterval) clearInterval(tradeWsPingInterval);
        clearPongTimeout(socket);
        tradeWsPingInterval = null;
    } else if (socket === "orderBookWs") {
        if (orderBookWsPingInterval) clearInterval(orderBookWsPingInterval);
        clearPongTimeout(socket);
        orderBookWsPingInterval = null;
    }
}

/**
 * Connects to the trade WebSocket.
 */
function connectTradeWs() {
    tradeWs = new WebSocket(TRADE_WEBSOCKET_URL);
    

    tradeWs.onopen = () =>  {
        console.log('Connected to Trades WebSocket');
        tradeWsReconnectAttempts = 0;
        if (tradeWs && tradeWs.readyState === WebSocket.OPEN) {
            console.log('Sending backlog request');
            tradeWs.send(JSON.stringify({ type: "backlog", data: {amount:MAX_TRADES} }));
        }
        startPing("tradeWs");
    }

    tradeWs.onerror = (error) => console.error('Trades WebSocket error:', error);

    tradeWs.onclose = () => {
        console.log('Trades WebSocket closed, reconnecting to %s', TRADE_WEBSOCKET_URL);
        if ( delayGauge) {
            setGaugeTimeout(delayGauge);
        }
        stopPing("tradeWs");
        tradeWsPingInterval = null;
        if (tradeWsReconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
            tradeWsReconnectAttempts++;
            const delay = RECONNECT_DELAY * Math.pow(2, tradeWsReconnectAttempts - 1);
            console.log(`Reconnecting in ${delay / 1000}s...`);
            setTimeout(connectTradeWs(), delay);
        } else {
            console.error("Max reconnect attempts reached.");
        }
    };

    tradeWs.onmessage = (event) => {
    try {
      const message = JSON.parse(event.data);
      const receiveTime = Date.now();
      if (message.type === 'pong') {
        clearPongTimeout("tradeWs");
        console.log("Pong received");  
      }

      else if (message.type === 'backlog') {
        console.log(`%s backlog trades received.`, message.data.length);
        if (delayGauge) {
            delayGauge.value= 0;
            delayGauge.title='Loading Backlog';
        }
        //setGaugeTimeout(delayGauge);
        trades.length = 0;
        message.data.forEach((t) => {
          if (isValidTrade(t)) {
            trades.push({ x: t.time, y: t.price, quantity: t.quantity, orderType: t.orderType });
          }
        });
        while (trades.length > MAX_TRADES) trades.shift();
        console.log(`%s backlog trades processed.`, trades.length);
        tradesChart.data.datasets[0].data = trades;
        if (trades.length > 0) {
          const latestPrice = trades[trades.length - 1].y;
          tradesChart.options.plugins.annotation.annotations.lastPriceLine.yMin = latestPrice;
          tradesChart.options.plugins.annotation.annotations.lastPriceLine.yMax = latestPrice;
          if (activeRange !== null) {
            const latestTime = trades[trades.length - 1].x;
            const min = latestTime - activeRange;
            const max = latestTime + PADDING_TIME;
            tradesChart.options.scales.x.min = min;
            tradesChart.options.scales.x.max = max;

            let time = Math.ceil(min / FIFTEEN_MINUTES) * FIFTEEN_MINUTES;
            while (time <= max) {
              tradesChart.options.plugins.annotation.annotations[time] = {
                type: 'line',
                xMin: time,
                xMax: time,
                borderColor: 'rgba(102, 102, 102, 0.4)',
                borderWidth: 2,
                z: 1,
              };
              time += FIFTEEN_MINUTES;
            }
          }
        }
        tradesChart.update();
      } else if (message.type === 'trade') {
        if (tradeTimeoutId) clearTimeout(tradeTimeoutId);
        tradeTimeoutId = setTimeout(() => setGaugeTimeout(delayGauge), TRADE_TIMEOUT_MS);
        const trade = message.data;
        if (isValidTrade(trade)) {
          const delay = receiveTime - trade.time;
          if (delay >= 0 && delayGauge) {
            delayGauge.value = delay;
          } else if (delayGauge) {
            console.warn('Invalid trade delay:', delay, trade.time, receiveTime);
            delayGauge.value = 0;
          }  
          trades.push({ x: trade.time, y: trade.price, quantity: trade.quantity, orderType: trade.orderType });
          while (trades.length > MAX_TRADES) trades.shift();
          tradesChart.data.datasets[0].data = trades;
          tradesChart.options.plugins.annotation.annotations.lastPriceLine.yMin = trade.price;
          tradesChart.options.plugins.annotation.annotations.lastPriceLine.yMax = trade.price;
          if (activeRange !== null) {
            const min = trade.time - activeRange;
            const max = trade.time + PADDING_TIME;
            tradesChart.options.scales.x.min = min;
            tradesChart.options.scales.x.max = max;

            let time = Math.ceil(min / FIFTEEN_MINUTES) * FIFTEEN_MINUTES;
            while (time <= max) {
              tradesChart.options.plugins.annotation.annotations[time] = {
                type: 'line',
                xMin: time,
                xMax: time,
                borderColor: 'rgba(102, 102, 102, 0.4)',
                borderWidth: 2,
                z: 1,
              };
              time += FIFTEEN_MINUTES;
            }
          }
          tradesChart.update('none');
        }
      } else if (message.type === 'signal') {
        const label = message.data;
        tradesChart.options.plugins.annotation.annotations[label.tradeIndex] = {
          type: 'label',
          xValue: label.time,
          yValue: label.price,
          content: `${label.type} | ${label.status}`,
          backgroundColor: 'rgba(90, 50, 255, 1)',
          color: 'white',
          font: { size: 14 },
          padding: 8,
          id: label.tradeIndex,
        };
        tradesChart.update('none');
        console.log('Signal label added:', label);
      }
    } catch (error) {
      console.error('Error parsing trade WebSocket message:', error);
    }
  };
}

function connectOrderBookWs() {
    orderBookWs = new WebSocket(ORDERBOOK_WEBSOCKET_URL);
    orderBookWs.onopen = () => {
        console.log('Connected to Order Book WebSocket');
        orderBookWsReconnectAttempts = 0;
        startPing("orderBookWs");
    }

    orderBookWs.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            if (data.type === 'pong') {
                clearPongTimeout("orderBookWs");
                console.log("Pong received");  
            } else {
                if (!data || !Array.isArray(data.priceLevels)) {
                    console.error('Invalid order book data: priceLevels is missing or not an array', data);
                    return;
                }
                orderBookData = data;
                if (window.orderBookChart) {
                    orderBookChart.data.labels = orderBookData.priceLevels.map((level) =>
                        level.price ? level.price.toFixed(2) : '0.00',
                    );
                    orderBookChart.data.datasets[1].data = orderBookData.priceLevels.map((level) => level.bid || 0);
                    orderBookChart.data.datasets[0].data = orderBookData.priceLevels.map((level) => level.ask || 0);
                    orderBookChart.data.datasets[1].backgroundColor = orderBookData.priceLevels.map((level) =>
                        level.bid ? `rgba(0, 128, 0, ${Math.min(level.bid / 2000, 1)})` : 'rgba(0, 0, 0, 0)',
                    );
                    orderBookChart.data.datasets[0].backgroundColor = orderBookData.priceLevels.map((level) =>
                        level.ask ? `rgba(255, 0, 0, ${Math.min(level.ask / 2000, 1)})` : 'rgba(0, 0, 0, 0)',
                    );
                    orderBookChart.update();
                    updateIndicators();
                } else {
                    console.warn('Order book chart not initialized; skipping update');
                }
            }
        } catch (error) {
            console.error('Error parsing order book WebSocket message:', error, 'Raw data:', event.data);
        }
    };

    orderBookWs.onerror = (error) => console.error('Order Book WebSocket error:', error);

    orderBookWs.onclose = () => {
        console.log('Order Book WebSocket closed, reconnecting to %s', ORDERBOOK_WEBSOCKET_URL);
        stopPing("orderBookWs");
        if (orderBookWsReconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
            orderBookWsReconnectAttempts++;
            const delay = RECONNECT_DELAY * Math.pow(2, orderBookWsReconnectAttempts - 1);
            console.log(`Reconnecting in ${delay / 1000}s...`);
            setTimeout(connectOrderBookWs(), delay);
        } else {
            console.error("Max reconnect attempts reached.");
        }
    };
}

/**
 * Sets up WebSocket connections for trades and order book data.
 * @param {Object} tradesChart - The trades Chart.js instance.
 * @param {Object} orderBookChart - The order book Chart.js instance.
 */
function setupWebSockets(tradesChart, orderBookChart, delayGauge) {
    connectTradeWs();
    connectOrderBookWs();
}

/**
 * Sets up Interact.js for draggable and resizable chart containers.
 */
function setupInteract() {
  if (typeof interact === 'undefined') {
    console.error('Interact.js is not loaded');
    return;
  }

  interact('.chart-container')
    .draggable({
      inertia: true,
      modifiers: [
        interact.modifiers.restrictRect({
          restriction: '.dashboard',
          endOnly: true,
        }),
      ],
      listeners: {
        move: function (event) {
          const target = event.target;
          const x = (parseFloat(target.getAttribute('data-x')) || 0) + event.dx;
          const y = (parseFloat(target.getAttribute('data-y')) || 0) + event.dy;
          target.style.transform = `translate(${x}px, ${y}px)`;
          target.setAttribute('data-x', x);
          target.setAttribute('data-y', y);
        },
      },
    })
    .resizable({
      edges: { left: true, right: true, bottom: true, top: true },
      modifiers: [
        interact.modifiers.restrictSize({
          min: { width: 600, height: 600 },
          max: { width: 1600, height: 1600 },
        }),
      ],
      listeners: {
        move: function (event) {
          const target = event.target;
          target.style.width = event.rect.width + 'px';
          target.style.height = event.rect.height + 'px';
          const canvas = target.querySelector('canvas');
          canvas.width = event.rect.width - 20;
          canvas.height = event.rect.height - 20;
          const chart = Chart.getChart(canvas.id);
          if (chart) chart.resize();
        },
      },
    });

    interact('.gauge-container')
    .draggable({
      inertia: true,
      modifiers: [
        interact.modifiers.restrictRect({
          restriction: '.dashboard',
          endOnly: true,
        }),
      ],
      listeners: {
        move: function (event) {
          const target = event.target;
          const x = (parseFloat(target.getAttribute('data-x')) || 0) + event.dx;
          const y = (parseFloat(target.getAttribute('data-y')) || 0) + event.dy;
          target.style.transform = `translate(${x}px, ${y}px)`;
          target.setAttribute('data-x', x);
          target.setAttribute('data-y', y);
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
    console.error('Trades chart canvas not found');
    return;
  }
  if (!orderBookCanvas) {
    console.error('Order book chart canvas not found');
    return;
  }

  if (!delayGaugeCanvas) {
    console.error('Delay gauge canvas not found');
    return;
 }

  const tradesCtx = tradesCanvas.getContext('2d');
  if (!tradesCtx) {
    console.error('Could not get 2D context for trades chart');
    return;
  }
  

  const orderBookCtx = orderBookCanvas.getContext('2d');
  if (!orderBookCtx) {
    console.error('Could not get 2D context for order book chart');
    return;
  }

  // Initialize charts
  window.tradesChart = initializeTradesChart(tradesCtx);
  window.orderBookChart = initializeOrderBookChart(orderBookCtx);
  window.delayGauge = initializeDelayGauge(delayGaugeCanvas);

  // Setup WebSockets
  setupWebSockets(window.tradesChart, window.orderBookChart, window.delayGauge);

  // Setup interact.js
  setupInteract();

  // Setup range selector
  if (rangeSelector) {
    rangeSelector.addEventListener('click', (e) => {
      if (e.target.tagName === 'BUTTON') {
        const range = e.target.getAttribute('data-range');
        setRange(range === 'all' ? null : parseInt(range));
      }
    });
  } else {
    console.warn('Range selector element not found');
  }
}

// Start application
document.addEventListener('DOMContentLoaded', initialize);