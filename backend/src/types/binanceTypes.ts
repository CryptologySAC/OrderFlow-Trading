// src/types/binanceTypes.ts
import { SpotWebsocketStreams } from "@binance/spot";

export interface BinanceAggTradeStream {
    on(
        event: "message",
        cb: (msg: SpotWebsocketStreams.AggTradeResponse) => void
    ): void;
    on(event: "error", cb: (err: Error) => void): void;
    removeAllListeners(): void;
}

export interface BinanceDiffBookDepthStream {
    on(
        event: "message",
        cb: (msg: SpotWebsocketStreams.DiffBookDepthResponse) => void
    ): void;
    on(event: "error", cb: (err: Error) => void): void;
    removeAllListeners(): void;
}
