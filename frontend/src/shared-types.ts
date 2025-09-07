// Shared types between frontend and backend
// This file contains type definitions that are shared between frontend and backend
// to avoid import issues with TypeScript rootDir restrictions

// WebSocket Message Types
export interface WebSocketMessage {
    type: string;
    data: unknown;
    now: number;
}

// Trade Data Types
export interface PlotTrade {
    time: number;
    price: number;
    quantity: number;
    orderType: "BUY" | "SELL";
    symbol: string;
    tradeId: number;
}

// Order Book Types
export interface PriceLevel {
    price: number;
    bid: number;
    ask: number;
    bidCount?: number;
    askCount?: number;
    depletionRatio?: number;
    depletionVelocity?: number;
    originalBidVolume?: number;
    originalAskVolume?: number;
}

export interface OrderBookData {
    priceLevels: PriceLevel[];
    bestBid?: number;
    bestAsk?: number;
    spread?: number;
    midPrice?: number;
    totalBidVolume?: number;
    totalAskVolume?: number;
    imbalance?: number;
    timestamp?: number;
}

// RSI Data Types
export interface RSIDataPoint {
    time: number;
    rsi: number;
}

// Signal Types
export interface SignalData {
    id: string;
    type: string;
    price: number;
    time: number;
    confidence?: number;
    side?: string;
    [key: string]: unknown;
}

// Anomaly Types
export interface AnomalyData {
    detector: string;
    message: string;
    severity: "low" | "medium" | "high" | "critical" | "info";
    details?: Record<string, unknown>;
    timestamp: number;
    price?: number;
}

// Configuration Types
export interface RuntimeConfig {
    [key: string]: unknown;
}

// Support/Resistance Types
export interface SupportResistanceLevel {
    id: string;
    price: number;
    type: "support" | "resistance";
    strength: number;
    touchCount: number;
    firstDetected: number;
    lastTouched: number;
    volumeAtLevel: number;
    roleReversals?: Array<{
        timestamp: number;
        fromType: "support" | "resistance";
        toType: "support" | "resistance";
    }>;
}

// Zone Types
export interface ZoneData {
    id: string;
    type: string;
    priceRange: {
        min: number;
        max: number;
        center?: number;
    };
    startTime: number;
    endTime?: number;
    strength: number;
    completion: number;
    confidence?: number;
    totalVolume?: number;
    [key: string]: unknown;
}

// Extended message types for additional messages not in backend union
export type ExtendedWebSocketMessage =
    | WebSocketMessage
    | {
          type: "signal_bundle" | "runtimeConfig";
          data: Record<string, unknown>;
      };
