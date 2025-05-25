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
        | "trade"
        | "orderbook"
        | "signal"
        | "error"
        | "test";
    data: unknown;
    now: number;
}

export interface PlotTrade {
    time: number; // eventTime in milliseconds
    price: number;
    quantity: number;
    orderType: "BUY" | "SELL";
    symbol: string;
    tradeId: number;
}

export interface Trade {
    e: string; // Event type (e.g., "trade")
    E: number; // Event time (milliseconds)
    s: string; // Symbol (e.g., "LTCUSDT")
    t: number; // Trade ID
    p: string; // Price
    q: string; // Quantity
    T: number; // Trade time (milliseconds)
    m: boolean; // Is the buyer the maker? (true = seller-initiated, false = buyer-initiated)
    M: boolean; // Is this the best match?
}

export interface AbsorptionLabel {
    time: number; // Time of the signal (milliseconds)
    price: number; // Price at which absorption occurred
    label: string; // Signal description (e.g., "Sell Absorption")
}

export interface Detected {
    side: "buy" | "sell";
    price: number;
    trades: SpotWebsocketStreams.AggTradeResponse[];
    totalAggressiveVolume: number;
}

// Signal interface matching Python's structure
export interface Signal {
    type:
        | "exhaustion"
        | "absorption"
        | "exhaustion_confirmed"
        | "absorption_confirmed"
        | "flow"
        | "swingHigh"
        | "swingLow";
    time: number; // Timestamp in milliseconds
    price: number;
    tradeIndex?: number;
    isInvalidated?: boolean; // True if invalidated (tighter stop loss)
    stopLoss?: number; // Stop loss price
    takeProfit?: number; // Take profit price
    timeframe?: "Daytime" | "Nighttime";
    closeReason?:
        | "take_profit"
        | "stop_loss"
        | "opposite_signal"
        | "end_of_data"
        | "invalidated"
        | "exhaustion"
        | "absorption"
        | "delta_divergence"
        | "cvd_slope_reversal"
        | "both"; // Set when closed
    totalAggressiveVolume?: number;
    passiveVolume?: number;
    refilled?: boolean;
    zone?: string;
}

export interface VolumeBin {
    buyVol: number;
    sellVol: number;
    lastUpdate: number;
}

export interface SwingPoint {
    tradeId: number;
    price: number;
    timeStamp: number;
}

export enum HighLow {
    HIGH = 1,
    LOW = -1,
}
