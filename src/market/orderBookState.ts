// src/market/orderBookState.ts

import type { SpotWebsocketStreams } from "@binance/spot";
import { PassiveLevel } from "../types/marketEvents.js";

export class OrderBookState {
    private book: Map<number, PassiveLevel> = new Map();
    private pricePrecision: number;

    constructor(pricePrecision: number = 2) {
        this.pricePrecision = pricePrecision;
    }

    public updateDepth(update: SpotWebsocketStreams.DiffBookDepthResponse) {
        const bids: [string, string][] = (update.b as [string, string][]) || [];
        const asks: [string, string][] = (update.a as [string, string][]) || [];
        const now = Date.now();

        for (const [priceStr, qtyStr] of bids) {
            const price = +(+priceStr).toFixed(this.pricePrecision);
            const qty = +qtyStr;
            const existing = this.book.get(price) || {
                price,
                bid: 0,
                ask: 0,
                timestamp: now,
            };
            if (qty === 0) {
                this.book.delete(price);
            } else {
                this.book.set(price, { ...existing, bid: qty, timestamp: now });
            }
        }

        for (const [priceStr, qtyStr] of asks) {
            const price = +(+priceStr).toFixed(this.pricePrecision);
            const qty = +qtyStr;
            const existing = this.book.get(price) || {
                price,
                bid: 0,
                ask: 0,
                timestamp: now,
            };
            if (qty === 0) {
                this.book.delete(price);
            } else {
                this.book.set(price, { ...existing, ask: qty, timestamp: now });
            }
        }
    }

    public getLevel(price: number): PassiveLevel | undefined {
        return this.book.get(+price.toFixed(this.pricePrecision));
    }

    public sumBand(
        center: number,
        bandTicks: number,
        tickSize: number
    ): { bid: number; ask: number } {
        let sumBid = 0,
            sumAsk = 0;
        const min = center - bandTicks * tickSize;
        const max = center + bandTicks * tickSize;
        for (const [price, lvl] of this.book) {
            if (price >= min && price <= max) {
                sumBid += lvl.bid;
                sumAsk += lvl.ask;
            }
        }
        return { bid: sumBid, ask: sumAsk };
    }

    public snapshot(): Map<number, PassiveLevel> {
        // Optionally deep clone for advanced analysis
        return new Map(this.book);
    }
}
