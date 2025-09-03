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
export const NINETHY_MINUTES = 90 * 60 * 1000; // 90 minutes
export const TRADE_TIMEOUT_MS = 10000; // 10 seconds
export const GRID_SIZE = 25; // snapping grid for draggable/resizable elements
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

export let activeRange = NINETHY_MINUTES; // 90 minutes

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
            // Validate config structure before processing
            if (typeof config !== "object" || config === null) {
                console.warn("Invalid config received - not an object");
                return;
            }

            // Safe config merging with circular reference protection
            const safeConfig = safeConfigMerge(
                (typeof window !== "undefined" ? window.runtimeConfig : {}) ||
                    {},
                config
            );

            if (typeof window !== "undefined") {
                window.runtimeConfig = safeConfig;
            }

            // Apply dedupTolerance with validation
            if (
                typeof safeConfig.dedupTolerance === "number" &&
                safeConfig.dedupTolerance >= 0 &&
                safeConfig.dedupTolerance <= 1
            ) {
                dedupTolerance = safeConfig.dedupTolerance;
                console.log("Updated dedupTolerance:", dedupTolerance);
            } else if (safeConfig.dedupTolerance !== undefined) {
                console.warn(
                    "Invalid dedupTolerance value:",
                    safeConfig.dedupTolerance
                );
            }
        } catch (error) {
            console.error("Error processing runtime config:", error);
            // Enhanced fallback: only apply dedupTolerance if it's valid
            if (
                typeof config.dedupTolerance === "number" &&
                config.dedupTolerance >= 0 &&
                config.dedupTolerance <= 1
            ) {
                dedupTolerance = config.dedupTolerance;
                console.log("Applied fallback dedupTolerance:", dedupTolerance);
            } else {
                console.warn("Skipping invalid dedupTolerance in fallback");
            }
        }
    } else {
        console.warn("Invalid config received:", typeof config);
    }
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Safely merges two configuration objects with circular reference protection.
 * This version uses a more robust circular reference detection method.
 */
function safeConfigMerge(
    target: RuntimeConfig,
    source: RuntimeConfig
): RuntimeConfig {
    const safeClone = (obj: unknown, visited = new WeakSet()): unknown => {
        if (obj === null || typeof obj !== "object") {
            return obj;
        }

        if (visited.has(obj)) {
            // Return a placeholder for circular references
            return "[Circular]";
        }

        visited.add(obj);

        if (Array.isArray(obj)) {
            const newArr: unknown[] = [];
            for (const item of obj) {
                newArr.push(safeClone(item, visited));
            }
            visited.delete(obj);
            return newArr;
        }

        const newObj: Record<string, unknown> = {};
        for (const key in obj) {
            if (Object.prototype.hasOwnProperty.call(obj, key)) {
                newObj[key] = safeClone(
                    (obj as Record<string, unknown>)[key],
                    visited
                );
            }
        }

        visited.delete(obj);
        return newObj;
    };

    const clonedTarget = safeClone(target) as Record<string, unknown>;
    const clonedSource = safeClone(source) as Record<string, unknown>;

    // Perform a deep merge
    const deepMerge = (
        targetObj: Record<string, any>,
        sourceObj: Record<string, any>
    ): Record<string, any> => {
        const output = { ...targetObj };
        if (
            typeof targetObj === "object" &&
            targetObj !== null &&
            typeof sourceObj === "object" &&
            sourceObj !== null
        ) {
            Object.keys(sourceObj).forEach((key) => {
                if (
                    typeof sourceObj[key] === "object" &&
                    sourceObj[key] !== null &&
                    !Array.isArray(sourceObj[key])
                ) {
                    if (!(key in targetObj)) {
                        Object.assign(output, { [key]: sourceObj[key] });
                    } else {
                        output[key] = deepMerge(
                            targetObj[key],
                            sourceObj[key]
                        );
                    }
                } else {
                    Object.assign(output, { [key]: sourceObj[key] });
                }
            });
        }
        return output;
    };

    return deepMerge(clonedTarget, clonedSource) as RuntimeConfig;
}