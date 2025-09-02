// Type guard functions for strict TypeScript validation of WebSocket messages
// NO optional chaining, NO any types - strict 100% type safety

import type {
    WebSocketMessage,
    TradeMessage,
    SignalMessage,
    AnomalyMessage,
    OrderbookMessage,
    RsiMessage,
    RsiBacklogMessage,
    SignalBacklogMessage,
    SignalBundleMessage,
    RuntimeConfigMessage,
    SupportResistanceLevelMessage,
    ZoneUpdateMessage,
    ZoneSignalMessage,
    OrderBookData,
    PriceLevel,
} from "../types.js";

// Import SignalData from shared-types
import type { SignalData } from "../shared-types";

// =============================================================================
// TYPE GUARD FUNCTIONS - STRICT VALIDATION
// =============================================================================

// Base validation helpers
function isObject(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === "object";
}

function isString(value: unknown): value is string {
    return typeof value === "string";
}

function isNumber(value: unknown): value is number {
    return typeof value === "number" && !isNaN(value);
}

function isBoolean(value: unknown): value is boolean {
    return typeof value === "boolean";
}

// =============================================================================
// TRADE MESSAGE VALIDATION
// =============================================================================

export function isValidTradeData(data: unknown): data is TradeMessage["data"] {
    if (!isObject(data)) return false;

    const trade = data as Record<string, unknown>;
    return (
        isNumber(trade.id) &&
        isString(trade.p) &&
        isString(trade.q) &&
        isNumber(trade.t) &&
        isBoolean(trade.m)
    );
}

export function isValidTradeMessage(msg: unknown): msg is TradeMessage {
    if (!isObject(msg)) return false;

    const message = msg as Record<string, unknown>;
    return message.type === "trade" && isValidTradeData(message.data);
}

// =============================================================================
// SIGNAL MESSAGE VALIDATION
// =============================================================================

export function isValidSignalData(
    data: unknown
): data is SignalMessage["data"] {
    if (!isObject(data)) return false;

    const signal = data as Record<string, unknown>;
    return (
        isString(signal.id) &&
        isString(signal.type) &&
        isNumber(signal.strength) &&
        isNumber(signal.price) &&
        isNumber(signal.timestamp) &&
        (signal.aggressor === "buy" || signal.aggressor === "sell") &&
        isString(signal.detector)
    );
}

export function isValidSignalMessage(msg: unknown): msg is SignalMessage {
    if (!isObject(msg)) return false;

    const message = msg as Record<string, unknown>;
    return message.type === "signal" && isValidSignalData(message.data);
}

// =============================================================================
// ANOMALY MESSAGE VALIDATION
// =============================================================================

export function isValidAnomalyData(
    data: unknown
): data is AnomalyMessage["data"] {
    if (!isObject(data)) return false;

    const anomaly = data as Record<string, unknown>;
    return (
        isString(anomaly.detector) &&
        isString(anomaly.message) &&
        isNumber(anomaly.timestamp)
        // details is optional and can be any object
    );
}

export function isValidAnomalyMessage(msg: unknown): msg is AnomalyMessage {
    if (!isObject(msg)) return false;

    const message = msg as Record<string, unknown>;
    return message.type === "anomaly" && isValidAnomalyData(message.data);
}

// =============================================================================
// ORDERBOOK MESSAGE VALIDATION
// =============================================================================

export function isValidPriceLevel(level: unknown): level is PriceLevel {
    if (!isObject(level)) return false;

    const priceLevel = level as Record<string, unknown>;
    return (
        isNumber(priceLevel.price) &&
        isNumber(priceLevel.bid) &&
        isNumber(priceLevel.ask)
        // Optional fields
    );
}

export function isValidOrderBookData(data: unknown): data is OrderBookData {
    if (!isObject(data)) return false;

    const orderBook = data as Record<string, unknown>;

    // Check required fields
    if (
        !Array.isArray(orderBook.priceLevels) ||
        !isNumber(orderBook.bestBid) ||
        !isNumber(orderBook.bestAsk) ||
        !isNumber(orderBook.spread) ||
        !isNumber(orderBook.midPrice) ||
        !isNumber(orderBook.totalBidVolume) ||
        !isNumber(orderBook.totalAskVolume) ||
        !isNumber(orderBook.imbalance) ||
        !isNumber(orderBook.timestamp)
    ) {
        return false;
    }

    // Validate all price levels
    return orderBook.priceLevels.every(isValidPriceLevel);
}

export function isValidOrderbookMessage(msg: unknown): msg is OrderbookMessage {
    if (!isObject(msg)) return false;

    const message = msg as Record<string, unknown>;
    return message.type === "orderbook" && isValidOrderBookData(message.data);
}

// =============================================================================
// RSI MESSAGE VALIDATION
// =============================================================================

export function isValidRSIData(data: unknown): data is RsiMessage["data"] {
    if (!isObject(data)) return false;

    const rsi = data as Record<string, unknown>;
    return (
        isNumber(rsi.time) &&
        isNumber(rsi.rsi) &&
        rsi.rsi >= 0 &&
        rsi.rsi <= 100
    );
}

export function isValidRsiMessage(msg: unknown): msg is RsiMessage {
    if (!isObject(msg)) return false;

    const message = msg as Record<string, unknown>;
    return message.type === "rsi" && isValidRSIData(message.data);
}

// =============================================================================
// RSI BACKLOG MESSAGE VALIDATION
// =============================================================================

export function isValidRsiBacklogData(
    data: unknown
): data is RsiMessage["data"][] {
    return Array.isArray(data) && data.every(isValidRSIData);
}

export function isValidRsiBacklogMessage(
    msg: unknown
): msg is RsiBacklogMessage {
    if (!isObject(msg)) return false;

    const message = msg as Record<string, unknown>;
    return (
        message.type === "rsi_backlog" && isValidRsiBacklogData(message.data)
    );
}

// =============================================================================
// SIGNAL BACKLOG MESSAGE VALIDATION
// =============================================================================

export function isValidSignalBacklogData(
    data: unknown
): data is SignalMessage["data"][] {
    return Array.isArray(data) && data.every(isValidSignalData);
}

export function isValidSignalBacklogMessage(
    msg: unknown
): msg is SignalBacklogMessage {
    if (!isObject(msg)) return false;

    const message = msg as Record<string, unknown>;
    return (
        message.type === "signal_backlog" &&
        isValidSignalBacklogData(message.data)
    );
}

// =============================================================================
// SIGNAL BUNDLE MESSAGE VALIDATION
// =============================================================================

export function isValidSignalBundleMessage(
    msg: unknown
): msg is SignalBundleMessage {
    if (!isObject(msg)) return false;

    const message = msg as Record<string, unknown>;
    return (
        message.type === "signal_bundle" &&
        isValidSignalBacklogData(message.data)
    );
}

// =============================================================================
// RUNTIME CONFIG MESSAGE VALIDATION
// =============================================================================

export function isValidRuntimeConfigMessage(
    msg: unknown
): msg is RuntimeConfigMessage {
    if (!isObject(msg)) return false;

    const message = msg as Record<string, unknown>;
    return message.type === "runtimeConfig";
    // data can be any object for runtime config
}

// =============================================================================
// SUPPORT RESISTANCE LEVEL MESSAGE VALIDATION
// =============================================================================

export function isValidSupportResistanceLevelMessage(
    msg: unknown
): msg is SupportResistanceLevelMessage {
    if (!isObject(msg)) return false;

    const message = msg as Record<string, unknown>;
    return message.type === "supportResistanceLevel";
    // data can be any object for support resistance levels
}

// =============================================================================
// ZONE UPDATE MESSAGE VALIDATION
// =============================================================================

export function isValidZoneUpdateMessage(
    msg: unknown
): msg is ZoneUpdateMessage {
    if (!isObject(msg)) return false;

    const message = msg as Record<string, unknown>;
    return message.type === "zoneUpdate";
    // data can be any object for zone updates
}

// =============================================================================
// ZONE SIGNAL MESSAGE VALIDATION
// =============================================================================

export function isValidZoneSignalMessage(
    msg: unknown
): msg is ZoneSignalMessage {
    if (!isObject(msg)) return false;

    const message = msg as Record<string, unknown>;
    return message.type === "zoneSignal";
    // data can be any object for zone signals
}

// =============================================================================
// DATA TRANSFORMATION FUNCTIONS
// =============================================================================

// Transform WebSocket trade data to internal trade format
export function transformTradeData(wsData: TradeMessage["data"]): {
    time: number;
    price: number;
    quantity: number;
    orderType: string;
} {
    return {
        time: wsData.t,
        price: parseFloat(wsData.p),
        quantity: parseFloat(wsData.q),
        orderType: wsData.m ? "sell" : "buy", // m=true means buyer is maker (sell order)
    };
}

// Transform WebSocket signal data to internal signal format
export function transformSignalData(wsData: SignalMessage["data"]): SignalData {
    return {
        id: wsData.id,
        type: wsData.type,
        side: wsData.aggressor,
        price: wsData.price,
        time: wsData.timestamp,
        confidence: wsData.strength / 100, // Convert 0-100 to 0-1
        signalData: {
            confidence: wsData.strength / 100,
            meta: {
                detector: wsData.detector,
            },
        },
    };
}

// =============================================================================
// MASTER TYPE GUARD - VALIDATES ANY WEBSOCKET MESSAGE
// =============================================================================

export function isValidWebSocketMessage(msg: unknown): msg is WebSocketMessage {
    if (!isObject(msg)) return false;

    const message = msg as Record<string, unknown>;
    if (!isString(message.type)) return false;

    switch (message.type) {
        case "trade":
            return isValidTradeMessage(msg);
        case "signal":
            return isValidSignalMessage(msg);
        case "anomaly":
            return isValidAnomalyMessage(msg);
        case "orderbook":
            return isValidOrderbookMessage(msg);
        case "rsi":
            return isValidRsiMessage(msg);
        case "rsi_backlog":
            return isValidRsiBacklogMessage(msg);
        case "signal_backlog":
            return isValidSignalBacklogMessage(msg);
        case "signal_bundle":
            return isValidSignalBundleMessage(msg);
        case "runtimeConfig":
            return isValidRuntimeConfigMessage(msg);
        case "supportResistanceLevel":
            return isValidSupportResistanceLevelMessage(msg);
        case "zoneUpdate":
            return isValidZoneUpdateMessage(msg);
        case "zoneSignal":
            return isValidZoneSignalMessage(msg);
        default:
            return false; // Unknown message type
    }
}

// =============================================================================
// CHART DATA VALIDATION
// =============================================================================

export function isValidChartDataPoint(point: unknown): point is {
    x: number;
    y: number;
    quantity?: number;
    orderType?: "buy" | "sell";
} {
    if (!isObject(point)) return false;

    const p = point as Record<string, unknown>;
    return (
        isNumber(p.x) &&
        isNumber(p.y) &&
        (p.quantity === undefined || isNumber(p.quantity)) &&
        (p.orderType === undefined ||
            p.orderType === "buy" ||
            p.orderType === "sell")
    );
}

export function isValidChartDataArray(data: unknown): data is Array<{
    x: number;
    y: number;
    quantity?: number;
    orderType?: "buy" | "sell";
}> {
    return Array.isArray(data) && data.every(isValidChartDataPoint);
}
