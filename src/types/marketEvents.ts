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

export interface OrderBookSnapshot {
    timestamp: number;
    bestBid: number;
    bestAsk: number;
    spread: number;
    midPrice: number;
    depthSnapshot: Map<number, PassiveLevel>;
    passiveBidVolume: number;
    passiveAskVolume: number;
    imbalance: number;
}
