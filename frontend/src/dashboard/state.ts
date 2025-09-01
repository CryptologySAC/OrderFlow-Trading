// State management for the trading dashboard
// Converted from JavaScript to TypeScript with strict type checking

import type {
    ChartInstance,
    Trade,
    Anomaly,
    Signal,
    SupportResistanceLevel,
    ZoneData,
    OrderBookData,
    RSIDataPoint,
    RuntimeConfig,
} from "../frontend-types.js";

// =============================================================================
// CONSTANTS
// =============================================================================

export const TRADE_WEBSOCKET_URL: string =
    "wss://api.cryptology.pe/ltcusdt_trades";
export const MAX_TRADES: number = 50000;
export const MAX_RECONNECT_ATTEMPTS: number = 10;
export const RECONNECT_DELAY_MS: number = 1000;
export const PING_INTERVAL_MS: number = 10000;
export const PONG_WAIT_MS: number = 5000;
export const PADDING_TIME: number = 300000; // 5 minutes
export const FIFTEEN_MINUTES: number = 15 * 60 * 1000; // 15 minutes
export const TRADE_TIMEOUT_MS: number = 10000; // 10 seconds
export const GRID_SIZE: number = 20; // snapping grid for draggable/resizable elements
export const ITEM_MARGIN: number = 20; // fixed space between dashboard items
export const MAX_RSI_DATA: number = 100;

// =============================================================================
// DOM ELEMENT REFERENCES
// =============================================================================

// Canvas elements with proper null checking
export const tradesCanvas: HTMLCanvasElement | null = document.getElementById(
    "tradesChart"
) as HTMLCanvasElement | null;
export const orderBookCanvas: HTMLCanvasElement | null =
    document.getElementById("orderBookChart") as HTMLCanvasElement | null;
export const rsiCanvas: HTMLCanvasElement | null = document.getElementById(
    "rsiChart"
) as HTMLCanvasElement | null;

// Other DOM elements
export const rangeSelector: HTMLElement | null =
    document.querySelector(".rangeSelector");
export const directionText: HTMLElement | null =
    document.getElementById("directionText");
export const ratioText: HTMLElement | null =
    document.getElementById("ratioText");
export const supportText: HTMLElement | null =
    document.getElementById("supportText");
export const stabilityText: HTMLElement | null =
    document.getElementById("stabilityText");
export const volumeImbalance: HTMLElement | null =
    document.getElementById("volumeImbalance");
export const orderBookContainer: HTMLElement | null =
    document.getElementById("orderBookContainer");

// =============================================================================
// CHART INSTANCES
// =============================================================================

export let tradesChart: ChartInstance | null = null;
export let orderBookChart: ChartInstance | null = null;
export let rsiChart: ChartInstance | null = null;

// Chart setter functions with proper typing
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

export let anomalyList: Anomaly[] = [];
export const anomalySeverityOrder: readonly string[] = [
    "critical",
    "high",
    "medium",
    "info",
] as const;
export let anomalyFilters: Set<string> = new Set(["critical", "high"]);

// =============================================================================
// SIGNALS MANAGEMENT
// =============================================================================

export let signalsList: Signal[] = [];
export let signalFilters: Set<string> = new Set(["buy", "sell"]);
export let activeSignalTooltip: HTMLElement | null = null;

// =============================================================================
// SUPPORT/RESISTANCE LEVELS MANAGEMENT
// =============================================================================

export let supportResistanceLevels: SupportResistanceLevel[] = [];
export let maxSupportResistanceLevels: number = 20;

// =============================================================================
// ZONE MANAGEMENT
// =============================================================================

export let activeZones: Map<string, ZoneData> = new Map();
export let maxActiveZones: number = 10;

// =============================================================================
// RSI DATA MANAGEMENT
// =============================================================================

export let rsiData: RSIDataPoint[] = [];

// =============================================================================
// ORDER BOOK DISPLAY
// =============================================================================

export let orderBookData: OrderBookData = {
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

export let badgeTimeout: NodeJS.Timeout | null = null;
export let latestBadgeElem: HTMLElement | null = null;

// =============================================================================
// RUNTIME CONFIGURATION
// =============================================================================

export let dedupTolerance: number = 0.01;

// Initialize dedupTolerance from runtime config if available
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

export let trades: Trade[] = [];

// =============================================================================
// ACTIVE TIME RANGE
// =============================================================================

export let activeRange: number | null = 90 * 60000; // 90 minutes

// =============================================================================
// STATE SETTER FUNCTIONS
// =============================================================================

export function setActiveRange(range: number | null): void {
    activeRange = range;
}

export function setAnomalyFilters(filters: Set<string>): void {
    anomalyFilters = filters;
}

export function setRuntimeConfig(config: RuntimeConfig | unknown): void {
    if (config && typeof config === "object") {
        try {
            // Safe config merging with circular reference protection
            const safeConfig: RuntimeConfig = safeConfigMerge(
                (typeof window !== "undefined" ? window.runtimeConfig : {}) ||
                    {},
                config as RuntimeConfig
            );

            if (typeof window !== "undefined") {
                window.runtimeConfig = safeConfig;
            }

            if (typeof safeConfig.dedupTolerance === "number") {
                dedupTolerance = safeConfig.dedupTolerance;
            }
        } catch (error: unknown) {
            console.error("Error processing runtime config:", error);
            // Fallback to basic config without merging
            const fallbackConfig = config as RuntimeConfig;
            if (typeof fallbackConfig.dedupTolerance === "number") {
                dedupTolerance = fallbackConfig.dedupTolerance;
            }
        }
    }
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

// Helper function for safe config merging with circular reference protection
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

    function safeClone(
        obj: unknown,
        depth: number = 0,
        maxDepth: number = 10
    ): unknown {
        if (depth > maxDepth) {
            console.warn("Max depth reached during config cloning");
            return {};
        }

        if (!obj || typeof obj !== "object" || isCircular(obj)) {
            return obj;
        }

        if (Array.isArray(obj)) {
            return obj.map((item: unknown) =>
                safeClone(item, depth + 1, maxDepth)
            );
        }

        const result: Record<string, unknown> = {};
        for (const key in obj) {
            if (obj.hasOwnProperty(key)) {
                result[key] = safeClone(
                    (obj as Record<string, unknown>)[key],
                    depth + 1,
                    maxDepth
                );
            }
        }
        return result;
    }

    const clonedTarget = safeClone(target) as RuntimeConfig;
    const clonedSource = safeClone(source) as RuntimeConfig;
    return { ...clonedTarget, ...clonedSource };
}
