// Type declarations for state.js

export declare const TRADE_WEBSOCKET_URL: string;
export declare const MAX_TRADES: number;
export declare const MAX_RECONNECT_ATTEMPTS: number;
export declare const RECONNECT_DELAY_MS: number;
export declare const PING_INTERVAL_MS: number;
export declare const PONG_WAIT_MS: number;
export declare const PADDING_TIME: number;
export declare const FIFTEEN_MINUTES: number;
export declare const TRADE_TIMEOUT_MS: number;
export declare const GRID_SIZE: number;
export declare const ITEM_MARGIN: number;
export declare const MAX_RSI_DATA: number;

// DOM references
export declare const tradesCanvas: HTMLCanvasElement | null;
export declare const orderBookCanvas: HTMLCanvasElement | null;
export declare const rsiCanvas: HTMLCanvasElement | null;
export declare const rangeSelector: HTMLElement | null;
export declare const directionText: HTMLElement | null;
export declare const ratioText: HTMLElement | null;
export declare const supportText: HTMLElement | null;
export declare const stabilityText: HTMLElement | null;
export declare const volumeImbalance: HTMLElement | null;
export declare const orderBookContainer: HTMLElement | null;

// Chart instances - using any to avoid type inference issues
export declare let tradesChart: unknown;
export declare let orderBookChart: unknown;
export declare let rsiChart: unknown;

// Chart setter functions
export declare function setTradesChart(chart: unknown): void;
export declare function setOrderBookChart(chart: unknown): void;
export declare function setRsiChart(chart: unknown): unknown;

// Anomaly management
export declare let anomalyList: unknown[];
export declare const anomalySeverityOrder: string[];
export declare let anomalyFilters: Set<string>;

// Signals management
export declare let signalsList: unknown[];
export declare let signalFilters: Set<string>;
export declare let activeSignalTooltip: unknown;

// Support/Resistance levels management
export declare let supportResistanceLevels: unknown[];
export declare let maxSupportResistanceLevels: number;

// Zone management
export declare let activeZones: Map<string, unknown>;
export declare let maxActiveZones: number;

// RSI data management
export declare let rsiData: unknown[];

// Order book display
export declare let orderBookData: {
    priceLevels: unknown[];
};

// Badge display
export declare let badgeTimeout: number | null;
export declare let latestBadgeElem: HTMLElement | null;

// Runtime configuration
export declare let dedupTolerance: number;
export declare function setRuntimeConfig(config: unknown): void;

// Trades data
export declare let trades: unknown[];

// Active time range
export declare let activeRange: number | null;
export declare function setActiveRange(range: number | null): void;

// Filter management
export declare function setAnomalyFilters(filters: Set<string>): void;
