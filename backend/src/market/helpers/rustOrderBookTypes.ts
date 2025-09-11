// Type definitions for Rust OrderBook native addon
// This provides type safety for the Rust module exports

export interface RustOrderBookAddon {
    createOrderBook(
        symbol: string,
        pricePrecision: number,
        tickSize: number
    ): string;
    updateDepth(orderBookId: string, updatesJson: string): void;
    getLevel(orderBookId: string, price: number): RustOrderBookLevel | null;
    getBestBid(orderBookId: string): number;
    getBestAsk(orderBookId: string): number;
    getSpread(orderBookId: string): number;
    getMidPrice(orderBookId: string): number;
    sumBand(
        orderBookId: string,
        center: number,
        bandTicks: number,
        tickSize: number
    ): RustBandResult;
    getDepthMetrics(orderBookId: string): RustDepthMetrics;
    getHealth(orderBookId: string): RustHealthStatus;
    size(orderBookId: string): number;
    clear(orderBookId: string): void;
}

export interface RustOrderBookLevel {
    price: number;
    bid: number;
    ask: number;
    timestamp: string;
    consumedAsk: number;
    consumedBid: number;
    addedAsk: number;
    addedBid: number;
}

export interface RustBandResult {
    bid: number;
    ask: number;
    levels: number;
}

export interface RustDepthMetrics {
    totalLevels: number;
    bidLevels: number;
    askLevels: number;
    totalBidVolume: number;
    totalAskVolume: number;
    imbalance: number;
}

export interface RustHealthStatus {
    status: string;
    initialized: boolean;
    lastUpdateMs: number;
    circuitBreakerOpen: boolean;
    errorRate: number;
    bookSize: number;
    spread: number;
    midPrice: number;
    details: {
        bidLevels: number;
        askLevels: number;
        totalBidVolume: number;
        totalAskVolume: number;
        staleLevels: number;
        memoryUsageMB: number;
    };
}

export interface RustOrderBookUpdate {
    symbol: string;
    first_update_id: number;
    final_update_id: number;
    bids: [string, string][];
    asks: [string, string][];
}

// Magic number constants
export const DEFAULT_MAX_LEVELS = 1000;
export const DEFAULT_PRUNE_INTERVAL_MS = 30000; // 30 seconds
export const DEFAULT_MAX_ERROR_RATE = 10;
export const CIRCUIT_BREAKER_DURATION_MS = 60000; // 1 minute
export const ERROR_WINDOW_MS = 60000; // 1 minute
