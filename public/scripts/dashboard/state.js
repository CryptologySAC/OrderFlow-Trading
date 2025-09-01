export const TRADE_WEBSOCKET_URL = "wss://api.cryptology.pe/ltcusdt_trades";
export const MAX_TRADES = 50000;
export const MAX_RECONNECT_ATTEMPTS = 10;
export const RECONNECT_DELAY_MS = 1000;
export const PING_INTERVAL_MS = 10000;
export const PONG_WAIT_MS = 5000;
export const PADDING_TIME = 300000;
export const FIFTEEN_MINUTES = 15 * 60 * 1000;
export const TRADE_TIMEOUT_MS = 10000;
export const GRID_SIZE = 20;
export const ITEM_MARGIN = 20;
export const MAX_RSI_DATA = 100;
export const tradesCanvas = document.getElementById("tradesChart");
export const orderBookCanvas = document.getElementById("orderBookChart");
export const rsiCanvas = document.getElementById("rsiChart");
export const rangeSelector = document.querySelector(".rangeSelector");
export const directionText = document.getElementById("directionText");
export const ratioText = document.getElementById("ratioText");
export const supportText = document.getElementById("supportText");
export const stabilityText = document.getElementById("stabilityText");
export const volumeImbalance = document.getElementById("volumeImbalance");
export const orderBookContainer = document.getElementById("orderBookContainer");
export let tradesChart = null;
export let orderBookChart = null;
export let rsiChart = null;
export function setTradesChart(chart) {
    tradesChart = chart;
}
export function setOrderBookChart(chart) {
    orderBookChart = chart;
}
export function setRsiChart(chart) {
    rsiChart = chart;
}
export let anomalyList = [];
export const anomalySeverityOrder = [
    "critical",
    "high",
    "medium",
    "info",
];
export let anomalyFilters = new Set(["critical", "high"]);
export let signalsList = [];
export let signalFilters = new Set(["buy", "sell"]);
export let activeSignalTooltip = null;
export let supportResistanceLevels = [];
export let maxSupportResistanceLevels = 20;
export let activeZones = new Map();
export let maxActiveZones = 10;
export let rsiData = [];
export let orderBookData = {
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
export let badgeTimeout = null;
export let latestBadgeElem = null;
export let dedupTolerance = 0.01;
if (typeof window !== "undefined" &&
    window.runtimeConfig &&
    typeof window.runtimeConfig.dedupTolerance === "number") {
    dedupTolerance = window.runtimeConfig.dedupTolerance;
}
export let trades = [];
export let activeRange = 90 * 60000;
export function setActiveRange(range) {
    activeRange = range;
}
export function setAnomalyFilters(filters) {
    anomalyFilters = filters;
}
export function setRuntimeConfig(config) {
    if (config && typeof config === "object") {
        try {
            const safeConfig = safeConfigMerge((typeof window !== "undefined" ? window.runtimeConfig : {}) ||
                {}, config);
            if (typeof window !== "undefined") {
                window.runtimeConfig = safeConfig;
            }
            if (typeof safeConfig.dedupTolerance === "number") {
                dedupTolerance = safeConfig.dedupTolerance;
            }
        }
        catch (error) {
            console.error("Error processing runtime config:", error);
            const fallbackConfig = config;
            if (typeof fallbackConfig.dedupTolerance === "number") {
                dedupTolerance = fallbackConfig.dedupTolerance;
            }
        }
    }
}
function safeConfigMerge(target, source) {
    const visited = new WeakSet();
    function isCircular(obj) {
        if (obj && typeof obj === "object") {
            if (visited.has(obj)) {
                return true;
            }
            visited.add(obj);
        }
        return false;
    }
    function safeClone(obj, depth = 0, maxDepth = 10) {
        if (depth > maxDepth) {
            console.warn("Max depth reached during config cloning");
            return {};
        }
        if (!obj || typeof obj !== "object" || isCircular(obj)) {
            return obj;
        }
        if (Array.isArray(obj)) {
            return obj.map((item) => safeClone(item, depth + 1, maxDepth));
        }
        const result = {};
        for (const key in obj) {
            if (obj.hasOwnProperty(key)) {
                result[key] = safeClone(obj[key], depth + 1, maxDepth);
            }
        }
        return result;
    }
    const clonedTarget = safeClone(target);
    const clonedSource = safeClone(source);
    return { ...clonedTarget, ...clonedSource };
}
