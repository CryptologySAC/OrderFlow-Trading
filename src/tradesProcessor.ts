import dotenv from "dotenv";
dotenv.config();
import { randomUUID } from "crypto";
import { Storage } from "./infrastructure/storage.js";
import { BinanceDataFeed } from "./utils/binance.js";
import { SpotWebsocketStreams, SpotWebsocketAPI } from "@binance/spot";
import { WebSocketMessage } from "./utils/interfaces.js";
import { PlotTrade } from "./utils/types.js";
import { Logger } from "./infrastructure/logger.js";
import { MetricsCollector } from "./infrastructure/metricsCollector.js";

export interface ITradesProcessor {
    fillBacklog(): Promise<void>;
    requestBacklog(amount: number): PlotTrade[];
    addTrade(data: SpotWebsocketStreams.AggTradeResponse): WebSocketMessage;
}

export class TradesProcessor implements ITradesProcessor {
    private readonly binanceFeed = new BinanceDataFeed();
    private readonly symbol: string = process.env.SYMBOL ?? "LTCUSDT";
    private readonly storage = new Storage();
    private readonly storageTime: number =
        parseInt(process.env.MAX_STORAGE_TIME ?? "", 10) || 1000 * 60 * 90;
    private thresholdTime: number = Date.now() - this.storageTime;
    private aggTradeTemp: SpotWebsocketAPI.TradesAggregateResponseResultInner[] =
        [];
    private readonly logger: Logger = new Logger();
    private readonly metricsCollector: MetricsCollector =
        new MetricsCollector();

    /**
     * Preload the backlog of aggregated trades into storage
     */
    public async fillBacklog(): Promise<void> {
        this.logger.info(
            `Requesting backlog for %s hours ${(
                this.storageTime / 3600000
            ).toFixed(2)}`
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
                    this.logger.warn(
                        `No trades returned for threshold time: ${this.thresholdTime}`
                    );
                    break;
                }

                //const inserted = this.storage.saveAggregatedTradesBulk(
                //    aggregatedTrades,
                //    this.symbol
                //);
                //console.info(
                //    `Preloaded and inserted ${inserted} aggTrades for ${this.symbol}`
                //);
                for (const trade of aggregatedTrades) {
                    if (trade.T && trade.T > this.thresholdTime) {
                        this.thresholdTime = trade.T;
                        this.storage.saveAggregatedTrade(trade, this.symbol);
                    }
                }

                if (aggregatedTrades.length < 10) {
                    this.logger.warn(
                        "Possibly hit the end of available trade history"
                    );
                    break;
                }
            }
        } catch (error) {
            this.handleError(error as Error, "fillBacklog");
        }
    }

    private handleError(
        error: Error,
        context: string,
        correlationId?: string
    ): void {
        this.metricsCollector.incrementMetric("errorsCount");

        const errorContext = {
            context,
            errorName: error.name,
            errorMessage: error.message,
            stack: error.stack,
            timestamp: new Date().toISOString(),
            correlationId: correlationId || randomUUID(),
        };

        this.logger.error(
            `[${context}] ${error.message}`,
            errorContext,
            correlationId
        );
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
            this.handleError(error as Error, "requestBacklog");
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
            this.handleError(error as Error, "addTrade");
            return {
                type: "error",
                now: Date.now(),
                data: error,
            };
        }
    }
}
