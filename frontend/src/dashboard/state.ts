// Frontend State Management - TypeScript Version
// Contains all global state, constants, and DOM references for the dashboard

import type {
    ChartInstance,
    RuntimeConfig,
    Anomaly,
    Signal,
    SupportResistanceLevel,
    ZoneData,
    RSIDataPoint,
    OrderBookData,
    ChartDataPoint,
} from "../frontend-types.js";

// =============================================================================
// CONSTANTS
// =============================================================================

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

// =============================================================================
// DOM REFERENCES
// =============================================================================

export const tradesCanvas = document.getElementById(
    "tradesChart"
) as HTMLCanvasElement | null;
export const orderBookCanvas = document.getElementById(
    "orderBookChart"
) as HTMLCanvasElement | null;
export const rsiCanvas = document.getElementById(
    "rsiChart"
) as HTMLCanvasElement | null;
export const rangeSelector = document.querySelector(".rangeSelector");
export const directionText = document.getElementById("directionText");
export const ratioText = document.getElementById("ratioText");
export const supportText = document.getElementById("supportText");
export const stabilityText = document.getElementById("stabilityText");
export const volumeImbalance = document.getElementById("volumeImbalance");
export const orderBookContainer = document.getElementById("orderBookContainer");

// =============================================================================
// CHART INSTANCES
// =============================================================================

export let tradesChart: ChartInstance | null = null;
export let orderBookChart: ChartInstance | null = null;
export let rsiChart: ChartInstance | null = null;

export function setTradesChart(chart: ChartInstance | null): void {
    tradesChart = chart;
}

export function setOrderBookChart(chart: ChartInstance | null): void {
    orderBookChart = chart;
}

export function setRsiChart(chart: ChartInstance | null): void {
    rsiChart = chart;
}

// =============================================================================
// ANOMALY MANAGEMENT
// =============================================================================

export const anomalyList: Anomaly[] = [];
export const anomalySeverityOrder: readonly string[] = [
    "critical",
    "high",
    "medium",
    "info",
];
export let anomalyFilters: Set<string> = new Set(["critical", "high"]);

// =============================================================================
// SIGNALS MANAGEMENT
// =============================================================================

export const signalsList: Signal[] = [];
export const signalFilters: Set<string> = new Set(["buy", "sell"]);
export const activeSignalTooltip: HTMLElement | null = null;

// =============================================================================
// SUPPORT/RESISTANCE LEVELS MANAGEMENT
// =============================================================================

export const supportResistanceLevels: SupportResistanceLevel[] = [];
export const maxSupportResistanceLevels = 20;

// =============================================================================
// ZONE MANAGEMENT
// =============================================================================

export const activeZones: Map<string, ZoneData> = new Map();
export const maxActiveZones = 10;

// =============================================================================
// RSI DATA MANAGEMENT
// =============================================================================

export const rsiData: RSIDataPoint[] = [];

// =============================================================================
// ORDER BOOK DISPLAY
// =============================================================================

export const orderBookData: OrderBookData = {
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

// =============================================================================
// BADGE DISPLAY
// =============================================================================

export const badgeTimeout: NodeJS.Timeout | null = null;
export const latestBadgeElem: HTMLElement | null = null;

// =============================================================================
// RUNTIME CONFIGURATION
// =============================================================================

export let dedupTolerance = 0.01;

// Initialize dedupTolerance from window.runtimeConfig if available
if (
    typeof window !== "undefined" &&
    window.runtimeConfig &&
    typeof window.runtimeConfig.dedupTolerance === "number"
) {
    dedupTolerance = window.runtimeConfig.dedupTolerance;
}

// =============================================================================
// TRADES DATA
// =============================================================================

export const trades: ChartDataPoint[] = [];

// =============================================================================
// ACTIVE TIME RANGE
// =============================================================================

export let activeRange = 90 * 60000; // 90 minutes

export function setActiveRange(range: number): void {
    activeRange = range;
}

export function setAnomalyFilters(filters: Set<string>): void {
    anomalyFilters = filters;
}

export function setRuntimeConfig(
    config: RuntimeConfig | null | undefined
): void {
    if (config && typeof config === "object") {
        try {
            // Safe config merging with circular reference protection
            const safeConfig = safeConfigMerge(
                (typeof window !== "undefined" ? window.runtimeConfig : {}) ||
                    {},
                config
            );

            if (typeof window !== "undefined") {
                window.runtimeConfig = safeConfig;
            }

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

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Safely merges two configuration objects with circular reference protection
 */
function safeConfigMerge(
    target: RuntimeConfig,
    source: RuntimeConfig
): RuntimeConfig {
    const visited = new WeakSet<object>();

    function isCircular(obj: unknown): boolean {
        if (obj && typeof obj === "object") {
            if (visited.has(obj)) {
                return true;
            }
            visited.add(obj);
        }
        return false;
    }

    function safeClone(obj: unknown, depth = 0, maxDepth = 10): unknown {
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

        const result: Record<string, unknown> = {};
        for (const key in obj) {
            if (Object.prototype.hasOwnProperty.call(obj, key)) {
                result[key] = safeClone(
                    (obj as Record<string, unknown>)[key],
                    depth + 1,
                    maxDepth
                );
            }
        }
        return result;
    }

    const clonedTarget = safeClone(target) as Record<string, unknown>;
    const clonedSource = safeClone(source) as Record<string, unknown>;

    return { ...clonedTarget, ...clonedSource } as RuntimeConfig;
}
