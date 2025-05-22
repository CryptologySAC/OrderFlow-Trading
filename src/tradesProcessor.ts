import { Storage } from "./storage";
import { BinanceDataFeed } from "./binance";
import { SpotWebsocketStreams, SpotWebsocketAPI } from "@binance/spot";
import { PlotTrade, WebSocketMessage } from "./interfaces";
import dotenv from "dotenv";

dotenv.config();

export class TradesProcessor {
    private readonly binanceFeed: BinanceDataFeed;
    private readonly symbol: string;
    private readonly storageTime: number;
    private readonly storage: Storage;
    private aggTradeTemp: SpotWebsocketAPI.TradesAggregateResponseResultInner[] =
        [];
    private thresholdTime: number;

    constructor() {
        this.binanceFeed = new BinanceDataFeed();
        this.symbol = process.env.SYMBOL ?? "ltcusdt"; // Default to ltcusdt if not provided
        this.storage = new Storage();
        this.storageTime = (process.env.MAX_STORAGE_TIME ??
            1000 * 60 * 90) as number; // 90 mins in ms
        this.thresholdTime = Date.now() - this.storageTime;
    }

    /**
     * Preload the Backlog of aggregated trades
     */
    public async fillBacklog() {
        console.log(
            "Requesting backlog for %s hours",
            this.storageTime / 3600000
        );
        try {
            while (this.thresholdTime < Date.now()) {
                const aggregatedTrades: SpotWebsocketAPI.TradesAggregateResponseResultInner[] =
                    await this.binanceFeed.fetchAggTradesByTime(
                        this.symbol,
                        this.thresholdTime
                    );
                aggregatedTrades.forEach(
                    (
                        trade: SpotWebsocketAPI.TradesAggregateResponseResultInner
                    ) => {
                        if (
                            trade.T !== undefined &&
                            trade.T > this.thresholdTime
                        ) {
                            this.thresholdTime = trade.T;
                            this.storage.saveAggregatedTrade(
                                trade,
                                this.symbol
                            );
                        }
                    }
                );

                if (aggregatedTrades.length < 10) {
                    throw new Error("No more trades available");
                }
            }
        } catch (error) {
            console.warn("Backlog filled:", error);
        }
    }

    /**
     * Request a backlog of trades from the storage.
     * @param amount The number of trades to request.
     * @returns An array of PlotTrade objects.
     */
    public requestBacklog(amount: number): PlotTrade[] {
        try {
            const backLog: PlotTrade[] = [];
            this.aggTradeTemp = this.storage.getLatestAggregatedTrades(
                amount,
                this.symbol
            );
            this.aggTradeTemp.forEach(
                (
                    trade: SpotWebsocketAPI.TradesAggregateResponseResultInner
                ) => {
                    const plotTrade: PlotTrade = {
                        time: trade.T !== undefined ? trade.T : 0, // Millisecond precision
                        price: trade.p !== undefined ? parseFloat(trade.p) : 0,
                        quantity:
                            trade.q !== undefined ? parseFloat(trade.q) : 0,
                        orderType: trade.m ? "SELL" : "BUY",
                        symbol: this.symbol,
                        tradeId: trade.a !== undefined ? trade.a : 0,
                    };
                    backLog.push(plotTrade);
                }
            );
            return backLog;
        } catch (error) {
            console.log(error);
            return [];
        }
    }

    public addTrade(
        data: SpotWebsocketStreams.AggTradeResponse
    ): WebSocketMessage {
        try {
            this.storage.saveAggregatedTrade(data, this.symbol);

            const processedTrade: PlotTrade = {
                time: data.T !== undefined ? data.T : 0, // Millisecond precision
                price: data.p !== undefined ? parseFloat(data.p) : 0,
                quantity: data.q !== undefined ? parseFloat(data.q) : 0,
                orderType: data.m ? "SELL" : "BUY",
                symbol: this.symbol,
                tradeId: data.a !== undefined ? data.a : 0,
            };

            const message: WebSocketMessage = {
                type: "trade",
                now: Date.now(),
                data: processedTrade,
            };

            return message;
        } catch (error) {
            console.log(error);
            return {
                type: "error",
                data: error,
                now: 0,
            };
        }
    }
}
