import dotenv from "dotenv";
dotenv.config();

import { Storage } from "./storage";
import { BinanceDataFeed } from "./binance";
import { SpotWebsocketStreams, SpotWebsocketAPI } from "@binance/spot";
import { PlotTrade, WebSocketMessage } from "./interfaces";

export class TradesProcessor {
    private readonly binanceFeed = new BinanceDataFeed();
    private readonly symbol: string = process.env.SYMBOL ?? "LTCUSDT";
    private readonly storage = new Storage();
    private readonly storageTime: number =
        parseInt(process.env.MAX_STORAGE_TIME ?? "", 10) || 1000 * 60 * 90;
    private thresholdTime: number = Date.now() - this.storageTime;
    private aggTradeTemp: SpotWebsocketAPI.TradesAggregateResponseResultInner[] =
        [];

    /**
     * Preload the backlog of aggregated trades into storage
     */
    public async fillBacklog(): Promise<void> {
        console.log(
            "Requesting backlog for %s hours",
            (this.storageTime / 3600000).toFixed(2)
        );

        try {
            const now = Date.now();
            while (this.thresholdTime < now) {
                const aggregatedTrades =
                    await this.binanceFeed.fetchAggTradesByTime(
                        this.symbol,
                        this.thresholdTime
                    );

                if (aggregatedTrades.length === 0) {
                    console.warn(
                        "No trades returned for threshold time:",
                        this.thresholdTime
                    );
                    break;
                }

                for (const trade of aggregatedTrades) {
                    if (trade.T && trade.T > this.thresholdTime) {
                        this.thresholdTime = trade.T;
                        this.storage.saveAggregatedTrade(trade, this.symbol);
                    }
                }

                if (aggregatedTrades.length < 10) {
                    console.warn(
                        "Possibly hit the end of available trade history"
                    );
                    break;
                }
            }
        } catch (error: unknown) {
            if (error instanceof Error) {
                console.warn("Backlog fill error:", error.message);
            } else {
                console.warn("Backlog fill error:", error);
            }
        }
    }

    /**
     * Request a number of recent aggregated trades for plotting
     */
    public requestBacklog(amount: number): PlotTrade[] {
        try {
            this.aggTradeTemp = this.storage.getLatestAggregatedTrades(
                amount,
                this.symbol
            );

            return this.aggTradeTemp.map((trade) => ({
                time: trade.T ?? 0,
                price: parseFloat(trade.p || "0"),
                quantity: parseFloat(trade.q || "0"),
                orderType: trade.m ? "SELL" : "BUY",
                symbol: this.symbol,
                tradeId: trade.a ?? 0,
            }));
        } catch (error) {
            console.error("requestBacklog() failed:", error);
            return [];
        }
    }

    /**
     * Process and store a live trade, returning a formatted message
     */
    public addTrade(
        data: SpotWebsocketStreams.AggTradeResponse
    ): WebSocketMessage {
        try {
            this.storage.saveAggregatedTrade(data, this.symbol);

            const processedTrade: PlotTrade = {
                time: data.T ?? 0,
                price: data.p && !isNaN(+data.p) ? parseFloat(data.p) : 0,
                quantity: data.q && !isNaN(+data.q) ? parseFloat(data.q) : 0,
                orderType: data.m ? "SELL" : "BUY",
                symbol: this.symbol,
                tradeId: data.a ?? 0,
            };

            return {
                type: "trade",
                now: Date.now(),
                data: processedTrade,
            };
        } catch (error) {
            console.error("addTrade() failed:", error);
            return {
                type: "error",
                now: Date.now(),
                data: error,
            };
        }
    }
}
