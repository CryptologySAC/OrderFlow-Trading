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
        | "anomaly"
        | "error"
        | "test";
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
        | "both"
        | "swing_detection"; // Add this
    totalAggressiveVolume?: number;
    passiveVolume?: number;
    refilled?: boolean;
    zone?: string;
    signalData?: unknown; // This will hold SwingSignalData or other data
}
