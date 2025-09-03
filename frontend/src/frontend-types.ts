// Chart.js v4 Type Augmentation
import type {
    Chart as ChartJS,
    ChartOptions as ChartJSOptions,
    ScaleOptionsByType,
    CartesianScaleTypeRegistry,
} from "chart.js";

// Extend Chart.js types for our use case
export type ChartInstance = ChartJS;

// Frontend Type Definitions for TypeScript Conversion
// This file contains all type definitions needed for the frontend JavaScript to TypeScript conversion

import type { WebSocketMessage } from "./types.js";

// =============================================================================
// CHART.JS TYPES
// =============================================================================

export interface ChartDataPoint {
    x: number;
    y: number;
    quantity?: number;
    orderType?: "BUY" | "SELL";
}

export interface ChartAnnotation {
    type: string;
    xValue?: number;
    yValue?: number;
    xMin?: number;
    xMax?: number;
    yMin?: number;
    yMax?: number;
    content?: string;
    backgroundColor?: string;
    color?: string;
    font?: {
        size?: number;
        family?: string;
        weight?: string;
    };
    borderRadius?: number;
    padding?: number;
    position?: {
        x: string;
        y: string;
    };
    borderColor?: string;
    borderWidth?: number;
    borderDash?: number[];
    drawTime?: string;
    label?: {
        display?: boolean;
        content?: string;
        position?: string;
        backgroundColor?: string;
        color?: string;
        font?: {
            size?: number;
            family?: string;
            weight?: string;
        };
        padding?: number;
        borderRadius?: number;
    };
    z?: number;
    xAdjust?: number;
    yAdjust?: number;
    enter?: (context: unknown, event: MouseEvent) => void;
    leave?: () => void;
}

export interface ChartScale {
    min?: number;
    max?: number;
    suggestedMin?: number;
    suggestedMax?: number;
    grid?: {
        color?: string;
        display?: boolean;
    };
    ticks?: {
        color?: string;
        display?: boolean;
    };
}

export interface ChartOptions extends ChartJSOptions {
    scales?: {
        [key: string]: ScaleOptionsByType<keyof CartesianScaleTypeRegistry>;
    };
    plugins?: {
        annotation?: any; // Use any for Chart.js plugin compatibility
    } & ChartJSOptions["plugins"];
}

export interface ChartDataset {
    data: ChartDataPoint[] | (number | null)[];
    label?: string;
    backgroundColor?: string | string[];
    borderColor?: string | string[];
    pointBackgroundColor?: string | string[];
    pointBorderColor?: string | string[];
    pointRadius?: number;
    pointHoverRadius?: number;
    showLine?: boolean;
    fill?: boolean;
    barPercentage?: number;
    categoryPercentage?: number;
}

export interface ChartConfiguration {
    type: string;
    data: {
        datasets: ChartDataset[];
    };
    options: ChartOptions;
}

// =============================================================================
// DOM ELEMENT TYPES
// =============================================================================

export interface DashboardElements {
    tradesCanvas: HTMLCanvasElement | null;
    orderBookCanvas: HTMLCanvasElement | null;
    rsiCanvas: HTMLCanvasElement | null;
    rangeSelector: HTMLElement | null;
    directionText: HTMLElement | null;
    ratioText: HTMLElement | null;
    supportText: HTMLElement | null;
    stabilityText: HTMLElement | null;
    volumeImbalance: HTMLElement | null;
    orderBookContainer: HTMLElement | null;
}

// =============================================================================
// TRADE AND MARKET DATA TYPES
// =============================================================================

export interface Trade {
    time: number;
    price: number;
    quantity: number;
    orderType: "buy" | "sell";
    id?: number;
}

export interface OrderBookLevel {
    price: number;
    bid: number;
    ask: number;
    bidCount?: number;
    askCount?: number;
    depletionRatio?: number;
    depletionVelocity?: number;
    originalBidVolume?: number;
    originalAskVolume?: number;
    timestamp?: number;
}

export interface OrderBookData {
    priceLevels: OrderBookLevel[];
    bestBid: number;
    bestAsk: number;
    spread: number;
    midPrice: number;
    totalBidVolume: number;
    totalAskVolume: number;
    imbalance: number;
    timestamp: number;
}

// =============================================================================
// SIGNAL AND ANOMALY TYPES
// =============================================================================

export interface Signal {
    id: string;
    type: string;
    side: "buy" | "sell";
    price: number;
    time: number;
    confidence?: number;
    detector?: string;
    zone?: ZoneData;
    originalSignals?: Array<{
        type: string;
        metadata?: {
            side: string;
        };
    }>;
    finalPrice?: number;
    confirmedAt?: number;
    takeProfit?: number;
    stopLoss?: number;
}

export interface Anomaly {
    detector: string;
    message: string;
    severity: "critical" | "high" | "medium" | "info";
    timestamp: number;
    type?: string;
    price?: number;
    affectedPriceRange?: {
        min: number;
        max: number;
    };
    recommendedAction?: string;
    detectedAt?: number;
    details?: {
        confidence?: number;
        imbalance?: number;
        absorptionRatio?: number;
        rationale?: string | Record<string, unknown>;
        [key: string]: unknown;
    };
}

export interface SignalBundle {
    id: string;
    type: string;
    side: "buy" | "sell";
    price: number;
    time: number;
    confidence: number;
}

// =============================================================================
// SUPPORT/RESISTANCE AND ZONE TYPES
// =============================================================================

export interface SupportResistanceLevel {
    id: string;
    price: number;
    type: "support" | "resistance";
    strength: number;
    touchCount: number;
    firstDetected: number;
    lastTouched: number;
    volumeAtLevel: number;
    timestamp: number;
    zoneId?: string;
    roleReversals?: Array<{
        timestamp: number;
        previousType: "support" | "resistance";
        newType: "support" | "resistance";
    }>;
}

export interface ZoneData {
    id: string;
    type:
        | "accumulation"
        | "distribution"
        | "hidden_liquidity"
        | "iceberg"
        | "spoofing";
    priceRange: {
        min: number;
        max: number;
        center?: number;
    };
    volume: number;
    timestamp: number;
    strength: number;
    startTime?: number;
    endTime?: number;
    completion?: number;
    confidence?: number;
    totalVolume?: number;
    stealthScore?: number;
    refillCount?: number;
    averagePieceSize?: number;
    side?: string;
    spoofType?: string;
    wallSize?: number;
    canceled?: number;
    executed?: number;
    tradeCount?: number;
    isActive?: boolean;
    stealthType?:
        | "reserve_order"
        | "stealth_liquidity"
        | "algorithmic_hidden"
        | "institutional_stealth";
}

// =============================================================================
// UI AND STATE TYPES
// =============================================================================

export interface RuntimeConfig {
    dedupTolerance?: number;
    [key: string]: unknown;
}

export interface FilterState {
    anomalyFilters: Set<string>;
    signalFilters: Set<string>;
}

export interface ChartState {
    tradesChart: ChartInstance | null;
    orderBookChart: ChartInstance | null;
    rsiChart: ChartInstance | null;
}

export interface RSIDataPoint {
    time: number;
    rsi: number;
}

// =============================================================================
// WEBSOCKET AND MESSAGE TYPES
// =============================================================================

export interface WebSocketConfig {
    url: string;
    maxTrades?: number;
    maxReconnectAttempts?: number;
    reconnectDelay?: number;
    pingInterval?: number;
    pongWait?: number;
    onMessage?: (message: WebSocketMessage) => void;
    onBacklog?: (data: Trade[]) => void;
    onReconnectFail?: () => void;
    onTimeout?: () => void;
}

// =============================================================================
// EVENT AND INTERACTION TYPES
// =============================================================================

export interface InteractEvent {
    target: HTMLElement;
    dx: number;
    dy: number;
}

export interface ResizeHandleEvent extends InteractEvent {
    target: HTMLElement;
}

// =============================================================================
// UTILITY TYPES
// =============================================================================

export type ThemeMode = "light" | "dark" | "system";

export interface ThemeConfig {
    mode: ThemeMode;
    depletionVisualization: boolean;
}

export interface PersistenceData {
    columnWidths?: Record<string, number[]>;
    anomalyFilters?: string[];
    timeRange?: number | null;
    verticalLayout?: unknown;
    theme?: ThemeMode;
}

// =============================================================================
// GLOBAL WINDOW EXTENSIONS
// =============================================================================

declare global {
    interface Window {
        runtimeConfig?: RuntimeConfig;
        tradesChart?: ChartInstance;
        orderBookChart?: ChartInstance;
        rsiChart?: ChartInstance;
        resizeTimeout?: NodeJS.Timeout;
        rsiUpdateTimeout?: NodeJS.Timeout;
        orderbookInitialized?: boolean;
        resetTableColumns?: (tableId: string) => void;
        interact?: {
            (selector: string): {
                draggable: (config: {
                    axis?: string;
                    listeners: {
                        move: (event: InteractEvent) => void;
                        start?: (event: InteractEvent) => void;
                        end?: (event: InteractEvent) => void;
                    };
                }) => void;
            };
        };
    }
}

// =============================================================================
// MESSAGE QUEUE TYPES
// =============================================================================

export interface MessageQueueItem {
    type: string;
    data: unknown;
    now?: number;
}

// =============================================================================
// TIMER AND TIMEOUT TYPES
// =============================================================================

export interface TimerState {
    pingTimer?: NodeJS.Timeout;
    pongTimeout?: NodeJS.Timeout;
    reconnectTimer?: NodeJS.Timeout;
    cleanupTimer?: NodeJS.Timeout;
    rsiUpdateTimeout?: NodeJS.Timeout;
    orderBookUpdateTimeout?: NodeJS.Timeout;
}

// =============================================================================
// VALIDATION TYPES
// =============================================================================

export interface ValidationResult {
    isValid: boolean;
    error?: string;
}

export interface TradeValidation extends ValidationResult {
    trade?: Trade;
}

// =============================================================================
// CONFIGURATION CONSTANTS
// =============================================================================

export interface DashboardConstants {
    TRADE_WEBSOCKET_URL: string;
    MAX_TRADES: number;
    MAX_RECONNECT_ATTEMPTS: number;
    RECONNECT_DELAY_MS: number;
    PING_INTERVAL_MS: number;
    PONG_WAIT_MS: number;
    PADDING_TIME: number;
    FIFTEEN_MINUTES: number;
    TRADE_TIMEOUT_MS: number;
    GRID_SIZE: number;
    ITEM_MARGIN: number;
    MAX_RSI_DATA: number;
    MAX_ANOMALY_LIST: number;
    MAX_SIGNAL_LIST: number;
    MAX_SUPPORT_RESISTANCE_LEVELS: number;
    MAX_ACTIVE_ZONES: number;
}
