export const TRADE_WEBSOCKET_URL = "wss://api.cryptology.pe/ltcusdt_trades";
export const MAX_TRADES = 50000;
export const MAX_RECONNECT_ATTEMPTS = 10;
export const RECONNECT_DELAY_MS = 1000;
export const PING_INTERVAL_MS = 10000;
export const PONG_WAIT_MS = 5000;
export const PADDING_TIME = 300000;
export const FIFTEEN_MINUTES = 15 * 60 * 1000;
export const NINETHY_MINUTES = 90 * 60 * 1000;
export const TRADE_TIMEOUT_MS = 10000;
export const GRID_SIZE = 25;
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
export const anomalyList = [];
export const anomalySeverityOrder = [
    "critical",
    "high",
    "medium",
    "info",
];
export let anomalyFilters = new Set(["critical", "high"]);
export const signalsList = [];
export const signalFilters = new Set(["buy", "sell"]);
export const activeSignalTooltip = null;
export const supportResistanceLevels = [];
export const maxSupportResistanceLevels = 20;
export const activeZones = new Map();
export const maxActiveZones = 10;
export const rsiData = [];
export const orderBookData = {
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
export const badgeTimeout = null;
export const latestBadgeElem = null;
export let dedupTolerance = 0.01;
if (typeof window !== "undefined" &&
    window.runtimeConfig &&
    typeof window.runtimeConfig.dedupTolerance === "number") {
    dedupTolerance = window.runtimeConfig.dedupTolerance;
}
export const trades = [];
export let activeRange = NINETHY_MINUTES;
export function setActiveRange(range) {
    activeRange = range;
}
export function setAnomalyFilters(filters) {
    anomalyFilters = filters;
}
export function setRuntimeConfig(config) {
    if (config && typeof config === "object") {
        try {
            if (typeof config !== "object" || config === null) {
                console.warn("Invalid config received - not an object");
                return;
            }
            const safeConfig = safeConfigMerge((typeof window !== "undefined" ? window.runtimeConfig : {}) ||
                {}, config);
            if (typeof window !== "undefined") {
                window.runtimeConfig = safeConfig;
            }
            if (typeof safeConfig.dedupTolerance === "number" &&
                safeConfig.dedupTolerance >= 0 &&
                safeConfig.dedupTolerance <= 1) {
                dedupTolerance = safeConfig.dedupTolerance;
                console.log("Updated dedupTolerance:", dedupTolerance);
            }
            else if (safeConfig.dedupTolerance !== undefined) {
                console.warn("Invalid dedupTolerance value:", safeConfig.dedupTolerance);
            }
        }
        catch (error) {
            console.error("Error processing runtime config:", error);
            if (typeof config.dedupTolerance === "number" &&
                config.dedupTolerance >= 0 &&
                config.dedupTolerance <= 1) {
                dedupTolerance = config.dedupTolerance;
                console.log("Applied fallback dedupTolerance:", dedupTolerance);
            }
            else {
                console.warn("Skipping invalid dedupTolerance in fallback");
            }
        }
    }
    else {
        console.warn("Invalid config received:", typeof config);
    }
}
function safeConfigMerge(target, source) {
    const safeClone = (obj, visited = new WeakSet()) => {
        if (obj === null || typeof obj !== "object") {
            return obj;
        }
        if (visited.has(obj)) {
            return "[Circular]";
        }
        visited.add(obj);
        if (Array.isArray(obj)) {
            const newArr = [];
            for (const item of obj) {
                newArr.push(safeClone(item, visited));
            }
            visited.delete(obj);
            return newArr;
        }
        const newObj = {};
        for (const key in obj) {
            if (Object.prototype.hasOwnProperty.call(obj, key)) {
                newObj[key] = safeClone(obj[key], visited);
            }
        }
        visited.delete(obj);
        return newObj;
    };
    const clonedTarget = safeClone(target);
    const clonedSource = safeClone(source);
    const deepMerge = (targetObj, sourceObj) => {
        const output = { ...targetObj };
        if (typeof targetObj === "object" &&
            targetObj !== null &&
            typeof sourceObj === "object" &&
            sourceObj !== null) {
            Object.keys(sourceObj).forEach((key) => {
                if (typeof sourceObj[key] === "object" &&
                    sourceObj[key] !== null &&
                    !Array.isArray(sourceObj[key])) {
                    if (!(key in targetObj)) {
                        Object.assign(output, { [key]: sourceObj[key] });
                    }
                    else {
                        output[key] = deepMerge(targetObj[key], sourceObj[key]);
                    }
                }
                else {
                    Object.assign(output, { [key]: sourceObj[key] });
                }
            });
        }
        return output;
    };
    return deepMerge(clonedTarget, clonedSource);
}
