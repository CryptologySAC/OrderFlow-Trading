import axios from "axios";
import dotenv from "dotenv";

import { SpotWebsocketStreams, SpotWebsocketAPI } from "@binance/spot";
import { WebSocketMessage } from "./interfaces";

dotenv.config();

// Interface for order book data (matching dashboard format)
interface OrderBookData {
    priceLevels: { price: number; bid: number; ask: number }[];
    ratio: number;
    supportPercent: number;
    askStable: boolean;
    bidStable: boolean;
    direction: { type: "Down" | "Up" | "Stable"; probability: number };
    volumeImbalance: number;
}

// Interface for Binance REST API order book snapshot
interface BinanceOrderBookSnapshot {
    lastUpdateId: number;
    bids: [string, string][];
    asks: [string, string][];
}

export class OrderBookProcessor {
    private readonly symbol: string;

    private orderBook: {
        bids: Map<number, number>;
        asks: Map<number, number>;
    } = {
        bids: new Map(),
        asks: new Map(),
    };
    private lastUpdateId: number = 0;
    private askVolumeHistory: number[] = []; // For stability check
    private bidVolumeHistory: number[] = []; // For stability check
    private readonly binSize: number = (process.env.BIN_SIZE ?? 10) as number;
    private readonly numLevels: number = (process.env.BIN_LEVELS ??
        10) as number;
    private volumeImbalanceHistory: number[] = [];

    constructor(symbol: string = "LTCUSDT") {
        this.symbol = symbol;
    }

    public async fetchInitialOrderBook(): Promise<WebSocketMessage> {
        const url = `https://api.binance.com/api/v3/depth?symbol=${this.symbol}&limit=1000`;
        try {
            const response = await axios.get<BinanceOrderBookSnapshot>(url);
            const snapshot = response.data;

            this.lastUpdateId = snapshot.lastUpdateId;

            snapshot.bids.forEach(([price, qty]) => {
                const priceNum = parseFloat(price);
                const qtyNum = parseFloat(qty);
                if (qtyNum > 0) this.orderBook.bids.set(priceNum, qtyNum);
            });
            snapshot.asks.forEach(([price, qty]) => {
                const priceNum = parseFloat(price);
                const qtyNum = parseFloat(qty);
                if (qtyNum > 0) this.orderBook.asks.set(priceNum, qtyNum);
            });

            console.log(
                "Initial order book snapshot loaded:",
                this.lastUpdateId
            );

            const orderBook = this.processOrderBook();
            return {
                type: "orderbook",
                now: Date.now(),
                data: orderBook,
            };
        } catch (error) {
            console.error("Error fetching initial order book:", error);
            return {
                type: "error",
                data: error,
                now: 0,
            };
        }
    }

    public processWebSocketUpdate(
        data: SpotWebsocketStreams.DiffBookDepthResponse
    ): WebSocketMessage {
        try {
            const update: SpotWebsocketAPI.DepthResponseResult = {
                lastUpdateId: data.u,
                bids: data.b,
                asks: data.a,
            };

            if (((update.lastUpdateId ?? -1) as number) <= this.lastUpdateId) {
                throw new Error(
                    `Received outdated update: ${update.lastUpdateId} | ${this.lastUpdateId}`
                );
            }

            this.lastUpdateId = (update.lastUpdateId ?? -1) as number;

            update.bids?.forEach(([price, qty]) => {
                const priceNum = parseFloat(price);
                const qtyNum = parseFloat(qty);
                if (qtyNum === 0) {
                    this.orderBook.bids.delete(priceNum);
                } else {
                    this.orderBook.bids.set(priceNum, qtyNum);
                }
            });

            update.asks?.forEach(([price, qty]) => {
                const priceNum = parseFloat(price);
                const qtyNum = parseFloat(qty);
                if (qtyNum === 0) {
                    this.orderBook.asks.delete(priceNum);
                } else {
                    this.orderBook.asks.set(priceNum, qtyNum);
                }
            });

            const orderBook = this.processOrderBook();
            return {
                type: "orderbook",
                now: Date.now(),
                data: orderBook,
            };
        } catch (error) {
            console.log(error);
            return {
                type: "error",
                data: error,
                now: 0,
            };
        }
    }

    private processOrderBook(): OrderBookData {
        const bestBid = Math.max(...Array.from(this.orderBook.bids.keys()));
        const bestAsk = Math.min(...Array.from(this.orderBook.asks.keys()));
        const currentPrice = (bestBid + bestAsk) / 2;

        const priceLevels: { price: number; bid: number; ask: number }[] = [];
        for (let i = -this.numLevels; i < this.numLevels; i++) {
            const price =
                Math.round(currentPrice * 100 + i * this.binSize) / 100;
            const binStart = Math.floor(price * this.binSize) / this.binSize;
            const binEnd = binStart + this.binSize * 0.01;

            let bidVolume = 0;
            for (const [p, qty] of this.orderBook.bids) {
                if (p >= binStart && p < binEnd) bidVolume += qty;
            }

            let askVolume = 0;
            for (const [p, qty] of this.orderBook.asks) {
                if (p >= binStart && p < binEnd) askVolume += qty;
            }

            priceLevels.push({
                price: binStart,
                bid: bidVolume,
                ask: askVolume,
            });
        }

        const totalAsk = priceLevels
            .slice(this.numLevels)
            .reduce((sum, level) => sum + level.ask, 0);
        const totalBid = priceLevels
            .slice(0, this.numLevels)
            .reduce((sum, level) => sum + level.bid, 0);

        // --- 10-tick Volume Imbalance ---
        const tickSize = 0.01;
        const tickRange = 10;
        const bidLowerBound = bestBid - tickRange * tickSize;
        const askUpperBound = bestAsk + tickRange * tickSize;

        let imbalanceBidVolume = 0;
        for (const [price, qty] of this.orderBook.bids) {
            if (price >= bidLowerBound && price <= bestBid) {
                imbalanceBidVolume += qty;
            }
        }

        let imbalanceAskVolume = 0;
        for (const [price, qty] of this.orderBook.asks) {
            if (price >= bestAsk && price <= askUpperBound) {
                imbalanceAskVolume += qty;
            }
        }

        const imbalance =
            imbalanceBidVolume === 0 && imbalanceAskVolume === 0
                ? 0
                : (imbalanceBidVolume - imbalanceAskVolume) /
                  (imbalanceBidVolume + imbalanceAskVolume || 1);
        this.volumeImbalanceHistory.push(imbalance);
        if (this.volumeImbalanceHistory.length > 30)
            this.volumeImbalanceHistory.shift();
        const volumeImbalance =
            this.volumeImbalanceHistory.reduce((sum, val) => sum + val, 0) /
            this.volumeImbalanceHistory.length;

        const ratio = totalAsk / (totalBid || 1);
        const supportPercent = (totalBid / (totalAsk || 1)) * 100;

        this.askVolumeHistory.push(totalAsk);
        this.bidVolumeHistory.push(totalBid);
        if (this.askVolumeHistory.length > 30) this.askVolumeHistory.shift();
        if (this.bidVolumeHistory.length > 30) this.bidVolumeHistory.shift();

        const askStable =
            this.askVolumeHistory.length < 30 ||
            this.askVolumeHistory.every(
                (vol, idx) =>
                    idx === 0 || vol >= this.askVolumeHistory[idx - 1] * 0.8
            );
        const bidStable =
            this.bidVolumeHistory.length < 30 ||
            this.bidVolumeHistory.every(
                (vol, idx) =>
                    idx === 0 || vol >= this.bidVolumeHistory[idx - 1] * 0.8
            );

        let direction: {
            type: "Down" | "Up" | "Stable";
            probability: number;
        };
        if (ratio > 2 && supportPercent < 50 && askStable) {
            direction = { type: "Down", probability: 70 };
        } else if (ratio < 0.5 && supportPercent > 75 && bidStable) {
            direction = { type: "Up", probability: 65 };
        } else {
            direction = { type: "Stable", probability: 80 };
        }

        return {
            priceLevels,
            ratio,
            supportPercent,
            askStable,
            bidStable,
            direction,
            volumeImbalance,
        };
    }
}
