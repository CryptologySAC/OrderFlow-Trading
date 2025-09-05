import { Chart, registerables } from "chart.js";
import "chartjs-adapter-date-fns";
import annotationPlugin from "chartjs-plugin-annotation";
import { format } from "date-fns";
Chart.register(...registerables, annotationPlugin);
import { _adapters } from "chart.js";
_adapters._date.override({
    formats: () => ({
        datetime: "MMM dd, yyyy, h:mm:ss a",
        millisecond: "h:mm:ss.SSS a",
        second: "h:mm:ss a",
        minute: "h:mm a",
        hour: "h a",
        day: "MMM dd",
        week: "MMM dd",
        month: "MMM yyyy",
        quarter: "QQQ yyyy",
        year: "yyyy",
    }),
    parse: (value) => {
        if (typeof value === "string") {
            return new Date(value).getTime();
        }
        return value;
    },
    format: (timestamp, f) => {
        return format(new Date(timestamp), f);
    },
    add: (timestamp, amount, unit) => {
        const date = new Date(timestamp);
        switch (unit) {
            case "millisecond":
                date.setMilliseconds(date.getMilliseconds() + amount);
                break;
            case "second":
                date.setSeconds(date.getSeconds() + amount);
                break;
            case "minute":
                date.setMinutes(date.getMinutes() + amount);
                break;
            case "hour":
                date.setHours(date.getHours() + amount);
                break;
            case "day":
                date.setDate(date.getDate() + amount);
                break;
            case "week":
                date.setDate(date.getDate() + amount * 7);
                break;
            case "month":
                date.setMonth(date.getMonth() + amount);
                break;
            case "quarter":
                date.setMonth(date.getMonth() + amount * 3);
                break;
            case "year":
                date.setFullYear(date.getFullYear() + amount);
                break;
        }
        return date.getTime();
    },
    diff: (max, min, unit) => {
        const diff = max - min;
        switch (unit) {
            case "millisecond":
                return diff;
            case "second":
                return diff / 1000;
            case "minute":
                return diff / (1000 * 60);
            case "hour":
                return diff / (1000 * 60 * 60);
            case "day":
                return diff / (1000 * 60 * 60 * 24);
            case "week":
                return diff / (1000 * 60 * 60 * 24 * 7);
            case "month":
                return diff / (1000 * 60 * 60 * 24 * 30);
            case "quarter":
                return diff / (1000 * 60 * 60 * 24 * 90);
            case "year":
                return diff / (1000 * 60 * 60 * 24 * 365);
            default:
                return diff;
        }
    },
    startOf: (timestamp, unit, weekday) => {
        const date = new Date(timestamp);
        switch (unit) {
            case "second":
                date.setMilliseconds(0);
                break;
            case "minute":
                date.setSeconds(0, 0);
                break;
            case "hour":
                date.setMinutes(0, 0, 0);
                break;
            case "day":
                date.setHours(0, 0, 0, 0);
                break;
            case "week": {
                const day = date.getDay();
                const diff = date.getDate() - day + (weekday || 0);
                date.setDate(diff);
                date.setHours(0, 0, 0, 0);
                break;
            }
            case "month":
                date.setDate(1);
                date.setHours(0, 0, 0, 0);
                break;
            case "quarter": {
                const quarter = Math.floor(date.getMonth() / 3);
                date.setMonth(quarter * 3, 1);
                date.setHours(0, 0, 0, 0);
                break;
            }
            case "year":
                date.setMonth(0, 1);
                date.setHours(0, 0, 0, 0);
                break;
        }
        return date.getTime();
    },
    endOf: (timestamp, unit) => {
        const date = new Date(timestamp);
        switch (unit) {
            case "second":
                date.setMilliseconds(999);
                break;
            case "minute":
                date.setSeconds(59, 999);
                break;
            case "hour":
                date.setMinutes(59, 59, 999);
                break;
            case "day":
                date.setHours(23, 59, 59, 999);
                break;
            case "week": {
                const day = date.getDay();
                const diff = date.getDate() + (6 - day);
                date.setDate(diff);
                date.setHours(23, 59, 59, 999);
                break;
            }
            case "month": {
                date.setMonth(date.getMonth() + 1, 0);
                date.setHours(23, 59, 59, 999);
                break;
            }
            case "quarter": {
                const quarter = Math.floor(date.getMonth() / 3) + 1;
                date.setMonth(quarter * 3, 0);
                date.setHours(23, 59, 59, 999);
                break;
            }
            case "year":
                date.setMonth(11, 31);
                date.setHours(23, 59, 59, 999);
                break;
        }
        return date.getTime();
    },
});
export const TRADE_WEBSOCKET_URL = "wss://api.cryptology.pe/ltcusdt_trades";
export const MAX_TRADES = 50000;
export const MAX_RECONNECT_ATTEMPTS = 10;
export const RECONNECT_DELAY_MS = 1000;
export const PING_INTERVAL_MS = 10000;
export const PONG_WAIT_MS = 5000;
export const PADDING_FACTOR = 18;
export const FIFTEEN_MINUTES = 15 * 60 * 1000;
export const NINETHY_MINUTES = 90 * 60 * 1000;
export const TRADE_TIMEOUT_MS = 10000;
export const GRID_SIZE = 25;
export const ITEM_MARGIN = 20;
export const MAX_RSI_DATA = 100;
export const PADDING_PERCENTAGE = 0.05;
export const PRICE_DEVIATION_THRESHOLD = 0.02;
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
