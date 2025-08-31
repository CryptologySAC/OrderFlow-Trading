// Constants
export const TRADE_WEBSOCKET_URL = "wss://api.cryptology.pe/ltcusdt_trades";
export const MAX_TRADES = 50000;
export const MAX_RECONNECT_ATTEMPTS = 10;
export const RECONNECT_DELAY_MS = 1000;
export const PING_INTERVAL_MS = 10000;
export const PONG_WAIT_MS = 5000;
export const PADDING_TIME = 300000; // 5 minutes
export const FIFTEEN_MINUTES = 15 * 60 * 1000; // 15 minutes
export const TRADE_TIMEOUT_MS = 10000; // 10 seconds
export const GRID_SIZE = 20; // snapping grid for draggable/resizable elements
export const ITEM_MARGIN = 20; // fixed space between dashboard items
export const MAX_RSI_DATA = 100;

// DOM references
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

// Chart instances
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

// Anomaly management
export let anomalyList = [];
export const anomalySeverityOrder = ["critical", "high", "medium", "info"];
export let anomalyFilters = new Set(["critical", "high"]);

// Signals management
export let signalsList = [];
export let signalFilters = new Set(["buy", "sell"]);
export let activeSignalTooltip = null;

// Support/Resistance levels management
export let supportResistanceLevels = [];
export let maxSupportResistanceLevels = 20;

// Zone management
export let activeZones = new Map();
export let maxActiveZones = 10;

// RSI data management
export let rsiData = [];

// Order book display
export let orderBookData = {
    priceLevels: [],
};

// Badge display
export let badgeTimeout = null;
export let latestBadgeElem = null;

// Runtime configuration
export let dedupTolerance = 0.01;
if (
    window.runtimeConfig &&
    typeof window.runtimeConfig.dedupTolerance === "number"
) {
    dedupTolerance = window.runtimeConfig.dedupTolerance;
}

// Trades data
export const trades = [];

// Active time range
export let activeRange = 90 * 60000; // 90 minutes

export function setActiveRange(range) {
    activeRange = range;
}

export function setAnomalyFilters(filters) {
    anomalyFilters = filters;
}

export function setRuntimeConfig(config) {
    if (config && typeof config === "object") {
        try {
            // Safe config merging with circular reference protection
            const safeConfig = safeConfigMerge(
                window.runtimeConfig || {},
                config
            );
            window.runtimeConfig = safeConfig;

            if (typeof safeConfig.dedupTolerance === "number") {
                dedupTolerance = safeConfig.dedupTolerance;
            }
        } catch (error) {
            console.error("Error processing runtime config:", error);
            // Fallback to basic config without merging
            if (typeof config.dedupTolerance === "number") {
                dedupTolerance = config.dedupTolerance;
            }
        }
    }
}

// Helper function for safe config merging
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

    return { ...safeClone(target), ...safeClone(source) };
}
