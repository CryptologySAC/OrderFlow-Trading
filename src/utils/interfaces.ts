import { SpotWebsocketStreams } from "@binance/spot";

export interface IWebSocket {
    readyState: number;
    send(data: string | Buffer): void;
    on(event: "message", cb: (msg: string | Buffer) => void): this;
    on(event: "close", cb: () => void): this;
}
export interface IWebSocketServer {
    clients: Set<IWebSocket>;
    on(event: "connection", cb: (ws: IWebSocket) => void): this;
}

export interface WebSocketMessage {
    type:
        | "pong"
        | "backlog"
        | "signal_backlog"
        | "trade"
        | "orderbook"
        | "signal"
        | "anomaly"
        | "supportResistanceLevel"
        | "zoneUpdate"
        | "zoneSignal"
        | "error"
        | "test"
        | "stats"
        | "connection_status";
    data: unknown;
    now: number;
}

export interface Signal_old {
    type:
        | "exhaustion"
        | "absorption"
        | "exhaustion_confirmed"
        | "absorption_confirmed"
        | "flow"
        | "swingHigh"
        | "swingLow";
    time: number;
    price: number;
    tradeIndex?: number;
    isInvalidated?: boolean;
    stopLoss?: number;
    takeProfit?: number;
    totalAggressiveVolume?: number;
    passiveVolume?: number;
    refilled?: boolean;
    zone?: string;
    signalData?: unknown; // This will hold SwingSignalData or other data
}

/**
 * Interface for a pending orderflow detection (absorption or exhaustion).
 */
export interface PendingDetection {
    time: number;
    price: number;
    side: "buy" | "sell";
    zone: number;
    trades: SpotWebsocketStreams.AggTradeResponse[];
    aggressive: number;
    passive: number; // Enforced as number, not number | null
    refilled: boolean;
    confirmed: boolean;
    status?: "pending" | "confirmed" | "invalidated";
    id: string; // Optional ID for tracking
}

/**
 * Generic, exchange-agnostic trade interface.
 */
export interface TradeData {
    price: number;
    quantity: number;
    timestamp: number;
    buyerIsMaker: boolean;
    originalTrade: SpotWebsocketStreams.AggTradeResponse;
}

/**
 * Interface for orderbook price level.
 */
export interface DepthLevel {
    bid: number;
    ask: number;
}
