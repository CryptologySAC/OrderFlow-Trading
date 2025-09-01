export enum MessageType {
    // Client to Server
    PING = "ping",
    BACKLOG_REQUEST = "backlog",

    // Server to Client
    PONG = "pong",
    BACKLOG = "backlog",
    TRADE = "trade",
    SIGNAL = "signal",
    STATS = "stats",
    ANOMALY = "anomaly",
    ERROR = "error",
    ORDERBOOK = "orderbook",
    RSI = "rsi",
    RSI_BACKLOG = "rsi_backlog",
    SIGNAL_BACKLOG = "signal_backlog",
    SIGNAL_BUNDLE = "signal_bundle",
    RUNTIMECONFIG = "runtimeConfig",
    SUPPORTRESISTANCELEVEL = "supportResistanceLevel",
    ZONEUPDATE = "zoneUpdate",
    ZONESIGNAL = "zoneSignal",
}

// --- Base Message Interface ---
interface BaseMessage {
    type: MessageType;
}

// --- Specific Message Interfaces ---

// Trade message
export interface TradeMessage extends BaseMessage {
    type: MessageType.TRADE;
    data: {
        id: number;
        p: string; // price
        q: string; // quantity
        t: number; // timestamp
        m: boolean; // isBuyerMaker
    };
}

// Signal message
export interface SignalMessage extends BaseMessage {
    type: MessageType.SIGNAL;
    data: {
        id: string;
        type: string;
        strength: number;
        price: number;
        timestamp: number;
        aggressor: "buy" | "sell";
        detector: string;
    };
}

// Stats update message
export interface StatsMessage extends BaseMessage {
    type: MessageType.STATS;
    data: any; // Define a more specific type if the stats structure is known
}

// Anomaly message
export interface AnomalyMessage extends BaseMessage {
    type: MessageType.ANOMALY;
    data: {
        detector: string;
        message: string;
        details?: any;
        timestamp: number;
    };
}

// Backlog message (from server)
export interface BacklogMessage extends BaseMessage {
    type: MessageType.BACKLOG;
    data: TradeMessage[];
}

// Error message from server
export interface ErrorMessage extends BaseMessage {
    type: MessageType.ERROR;
    data: {
        message: string;
        code?: number;
    };
}

// Orderbook message
export interface OrderbookMessage extends BaseMessage {
    type: MessageType.ORDERBOOK;
    data: OrderBookData;
}

export interface OrderBookData {
    priceLevels: PriceLevel[];
    bestBid: number;
    bestAsk: number;
    spread: number;
    midPrice: number;
    totalBidVolume: number;
    totalAskVolume: number;
    imbalance: number;
    timestamp: number;
}

export interface PriceLevel {
    price: number;
    bid: number;
    ask: number;
    bidCount?: number; // Number of orders in this bin
    askCount?: number; // Number of orders in this bin
    // Depletion tracking fields
    depletionRatio?: number; // 0-1, how much of original volume is depleted
    depletionVelocity?: number; // LTC/sec depletion rate
    originalBidVolume?: number; // Original bid volume before depletion
    originalAskVolume?: number; // Original ask volume before depletion
}

// RSI message
export interface RsiMessage extends BaseMessage {
    type: MessageType.RSI;
    data: {
        time: number;
        rsi: number;
    };
}

// RSI backlog message
export interface RsiBacklogMessage extends BaseMessage {
    type: MessageType.RSI_BACKLOG;
    data: RsiMessage["data"][];
}

// Signal backlog message
export interface SignalBacklogMessage extends BaseMessage {
    type: MessageType.SIGNAL_BACKLOG;
    data: SignalMessage["data"][];
}

// Signal bundle message
export interface SignalBundleMessage extends BaseMessage {
    type: MessageType.SIGNAL_BUNDLE;
    data: SignalMessage["data"][];
}

// Runtime config message
export interface RuntimeConfigMessage extends BaseMessage {
    type: MessageType.RUNTIMECONFIG;
    data: any;
}

// Support resistance level message
export interface SupportResistanceLevelMessage extends BaseMessage {
    type: MessageType.SUPPORTRESISTANCELEVEL;
    data: any;
}

// Zone update message
export interface ZoneUpdateMessage extends BaseMessage {
    type: MessageType.ZONEUPDATE;
    data: any;
}

// Zone signal message
export interface ZoneSignalMessage extends BaseMessage {
    type: MessageType.ZONESIGNAL;
    data: any;
}

// --- Client-side Messages ---

export interface PingMessage extends BaseMessage {
    type: MessageType.PING;
}

export interface PongMessage extends BaseMessage {
    type: MessageType.PONG;
}

// --- Union Type for all possible messages ---
export type WebSocketMessage =
    | TradeMessage
    | SignalMessage
    | StatsMessage
    | AnomalyMessage
    | BacklogMessage
    | ErrorMessage
    | PingMessage
    | PongMessage
    | OrderbookMessage
    | RsiMessage
    | RsiBacklogMessage
    | SignalBacklogMessage
    | SignalBundleMessage
    | RuntimeConfigMessage
    | SupportResistanceLevelMessage
    | ZoneUpdateMessage
    | ZoneSignalMessage;
