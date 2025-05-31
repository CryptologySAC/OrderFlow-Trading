// src/clients/tradesProcessor.ts
import { randomUUID } from "crypto";
import { Storage } from "../infrastructure/storage.js";
import { BinanceDataFeed } from "../utils/binance.js";
import { SpotWebsocketAPI } from "@binance/spot";
import type { WebSocketMessage } from "../utils/interfaces.js";
import type { PlotTrade } from "../utils/types.js";
import type { EnrichedTradeEvent } from "../types/marketEvents.js";

import { Logger } from "../infrastructure/logger.js";
import { MetricsCollector } from "../infrastructure/metricsCollector.js";

export interface ITradesProcessor {
    fillBacklog(): Promise<void>;
    requestBacklog(amount: number): PlotTrade[];
    onEnrichedTrade(event: EnrichedTradeEvent): WebSocketMessage;
}

export interface TradesProcessorOptions {
    symbol?: string;
    storageTime?: number; // in milliseconds
}

export class TradesProcessor implements ITradesProcessor {
    private readonly binanceFeed = new BinanceDataFeed();
    private readonly symbol: string;
    private readonly storage = new Storage();
    private readonly storageTime: number;
    private thresholdTime: number;
    private aggTradeTemp: SpotWebsocketAPI.TradesAggregateResponseResultInner[] =
        [];
    private readonly logger: Logger;
    private readonly metricsCollector: MetricsCollector;

    constructor(
        options: TradesProcessorOptions,
        logger: Logger,
        metricsCollector: MetricsCollector
    ) {
        this.logger = logger;
        this.metricsCollector = metricsCollector;
        this.symbol = options.symbol ?? "LTCUSDT";
        this.storageTime = options.storageTime ?? 1000 * 60 * 90;
        this.thresholdTime = Date.now() - this.storageTime;
    }

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
     * Process and store an EnrichedTradeEvent (from event stream), returning a formatted message
     */
    public onEnrichedTrade(event: EnrichedTradeEvent): WebSocketMessage {
        try {
            // Save as generic trade (you may want to create a more specific handler if needed)
            // If EnrichedTradeEvent is compatible with agg trade, you could store it directly:
            if (!event.originalTrade) {
                this.logger.warn(
                    "[TradesProcessor] EnrichedTradeEvent missing originalTrade",
                    { event }
                );
                return {
                    type: "error",
                    now: Date.now(),
                    data: "EnrichedTradeEvent missing originalTrade",
                };
            }
            this.storage.saveAggregatedTrade(event.originalTrade, this.symbol);

            const processedTrade: PlotTrade = {
                time: event.timestamp ?? 0,
                price: event.price ?? 0,
                quantity: event.quantity ?? 0,
                orderType: event.buyerIsMaker ? "SELL" : "BUY",
                symbol: event.pair,
                tradeId:
                    event.originalTrade?.a ?? event.timestamp ?? Date.now(),
            };

            return {
                type: "trade",
                now: Date.now(),
                data: processedTrade,
            };
        } catch (error) {
            this.handleError(error as Error, "onEnrichedTrade");
            return {
                type: "error",
                now: Date.now(),
                data: error,
            };
        }
    }
}
