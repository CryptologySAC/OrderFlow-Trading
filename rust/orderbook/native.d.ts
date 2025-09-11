// Type declarations for the Rust order book native addon

export interface PassiveLevel {
    price: number;
    bid: number;
    ask: number;
    timestamp: string;
    consumedAsk?: number;
    consumedBid?: number;
    addedAsk?: number;
    addedBid?: number;
}

export interface BandSum {
    bid: number;
    ask: number;
    levels: number;
}

export interface DepthMetrics {
    totalLevels: number;
    bidLevels: number;
    askLevels: number;
    totalBidVolume: number;
    totalAskVolume: number;
    imbalance: number;
}

export interface HealthDetails {
    bidLevels: number;
    askLevels: number;
    totalBidVolume: number;
    totalAskVolume: number;
    staleLevels: number;
    memoryUsageMB: number;
}

export interface OrderBookHealth {
    status: string;
    initialized: boolean;
    lastUpdateMs: number;
    circuitBreakerOpen: boolean;
    errorRate: number;
    bookSize: number;
    spread: number;
    midPrice: number;
    details: HealthDetails;
}

export interface NativeAddon {
    createOrderBook(
        id: string,
        pricePrecision: number,
        tickSize: number
    ): string;
    updateDepth(id: string, updatesJson: string): void;
    getLevel(id: string, price: number): PassiveLevel | null;
    getBestBid(id: string): number;
    getBestAsk(id: string): number;
    getSpread(id: string): number;
    getMidPrice(id: string): number;
    sumBand(
        id: string,
        center: number,
        bandTicks: number,
        tickSize: number
    ): BandSum;
    getDepthMetrics(id: string): DepthMetrics;
    getHealth(id: string): OrderBookHealth;
    clear(id: string): void;
    size(id: string): number;
}

declare const addon: NativeAddon;
export default addon;
