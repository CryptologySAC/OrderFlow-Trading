// src/types/marketEvents.ts

import type { SpotWebsocketStreams } from "@binance/spot";

export interface AggressiveTrade {
    price: number;
    quantity: number;
    timestamp: number;
    buyerIsMaker: boolean;
    pair: string;
    tradeId: string;
    originalTrade: SpotWebsocketStreams.AggTradeResponse;
}

export interface PassiveLevel {
    price: number;
    bid: number;
    ask: number;
    timestamp: number;
    // Optional tracking fields for advanced orderbook analytics
    consumedAsk?: number;
    consumedBid?: number;
    addedAsk?: number;
    addedBid?: number;
}

export interface EnrichedTradeEvent extends AggressiveTrade {
    passiveBidVolume: number;
    passiveAskVolume: number;
    zonePassiveBidVolume: number;
    zonePassiveAskVolume: number;
    depthSnapshot?: Map<number, PassiveLevel>;
    bestBid?: number;
    bestAsk?: number;
}

export interface IndividualTrade {
    id: number;
    price: number;
    quantity: number;
    timestamp: number;
    isBuyerMaker: boolean;
    quoteQuantity: number;
}

export type FetchReason =
    | "large_order"
    | "key_level"
    | "anomaly_period"
    | "high_volume_period"
    | "detector_request";

export interface CoordinationSignal {
    type: "time_coordination" | "size_coordination" | "price_coordination";
    strength: number; // 0-1, higher = stronger coordination
    details: string;
}

export interface MicrostructureMetrics {
    // Order fragmentation analysis
    fragmentationScore: number; // 0-1, higher = more fragmented
    avgTradeSize: number;
    tradeSizeVariance: number;

    // Timing analysis
    timingPattern: "uniform" | "burst" | "coordinated";
    avgTimeBetweenTrades: number;

    // Flow analysis
    toxicityScore: number; // 0-1, higher = more informed flow
    directionalPersistence: number; // How consistently directional

    // Pattern detection
    suspectedAlgoType:
        | "market_making"
        | "iceberg"
        | "splitting"
        | "arbitrage"
        | "unknown";
    coordinationIndicators: CoordinationSignal[];

    // Statistical properties
    sizingPattern: "consistent" | "random" | "structured";
    executionEfficiency: number; // How efficiently large orders executed
}

export interface HybridTradeEvent extends EnrichedTradeEvent {
    // Individual trades data (optional)
    individualTrades?: IndividualTrade[];
    hasIndividualData: boolean;

    // Microstructure analysis
    microstructure?: MicrostructureMetrics;

    // Enhanced metadata
    tradeComplexity: "simple" | "complex" | "highly_fragmented";
    fetchReason?: FetchReason;
}

// Type alias for backward compatibility
export type AggTradeEvent = AggressiveTrade;

export interface OrderBookHealth {
    status: "healthy" | "degraded" | "unhealthy";
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

export interface OrderBookUpdate {
    timestamp: number;
    bestBid: number;
    bestAsk: number;
    spread: number;
    midPrice: number;
    passiveBidVolume: number;
    passiveAskVolume: number;
    imbalance: number;
}

export interface OrderBookSnapshot extends OrderBookUpdate {
    depthSnapshot: Map<number, PassiveLevel>;
}
