// src/market/orderflowPreprocessor.ts

import type { SpotWebsocketStreams } from "@binance/spot";
import { EventEmitter } from "events";
import { AggressiveTrade, EnrichedTradeEvent } from "../types/marketEvents.js";
import { OrderBookState } from "./orderBookState.js";

export interface OrderflowPreprocessorOptions {
    pricePrecision?: number;
    bandTicks?: number;
    tickSize?: number;
}

export class OrderflowPreprocessor extends EventEmitter {
    private readonly bookState: OrderBookState;
    private readonly pricePrecision: number;
    private readonly bandTicks: number;
    private readonly tickSize: number;

    constructor(opts: OrderflowPreprocessorOptions = {}) {
        super();
        this.pricePrecision = opts.pricePrecision ?? 2;
        this.bandTicks = opts.bandTicks ?? 5;
        this.tickSize = opts.tickSize ?? 0.01;
        this.bookState = new OrderBookState(this.pricePrecision);
    }

    // Should be called on every depth update
    public handleDepth(update: SpotWebsocketStreams.DiffBookDepthResponse) {
        this.bookState.updateDepth(update);
    }

    // Should be called on every aggtrade event
    public handleAggTrade(trade: SpotWebsocketStreams.AggTradeResponse) {
        const price = +parseFloat(trade.p ?? "0").toFixed(this.pricePrecision);
        const quantity = parseFloat(trade.q ?? "0");
        const timestamp = trade.T ?? Date.now();
        const isMakerSell = !!trade.m;

        const aggressive: AggressiveTrade = {
            price,
            quantity,
            timestamp,
            isMakerSell,
            originalTrade: trade,
        };

        const bookLevel = this.bookState.getLevel(price);
        const zone = Math.round(price / this.tickSize) * this.tickSize;
        const band = this.bookState.sumBand(
            zone,
            this.bandTicks,
            this.tickSize
        );

        const enriched: EnrichedTradeEvent = {
            ...aggressive,
            passiveBidVolume: bookLevel?.bid ?? 0,
            passiveAskVolume: bookLevel?.ask ?? 0,
            zonePassiveBidVolume: band.bid,
            zonePassiveAskVolume: band.ask,
            depthSnapshot: undefined, // Only if needed
        };

        this.emit("enriched_trade", enriched);
    }
}
