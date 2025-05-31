// src/market/orderflowPreprocessor.ts
import type { SpotWebsocketStreams } from "@binance/spot";
import { EventEmitter } from "events";
import type {
    AggressiveTrade,
    EnrichedTradeEvent,
    OrderBookSnapshot,
} from "../types/marketEvents.js";
import { OrderBookState } from "./orderBookState.js";
import { Logger } from "../infrastructure/logger.js";
import { MetricsCollector } from "../infrastructure/metricsCollector.js";

export interface OrderflowPreprocessorOptions {
    pricePrecision?: number;
    bandTicks?: number;
    tickSize?: number;
    emitDepthMetrics?: boolean;
    symbol?: string;
}

export interface IOrderflowPreprocessor {
    handleDepth(update: SpotWebsocketStreams.DiffBookDepthResponse): void;
    handleAggTrade(trade: SpotWebsocketStreams.AggTradeResponse): void;
    getStats(): {
        processedTrades: number;
        processedDepthUpdates: number;
        bookMetrics: ReturnType<OrderBookState["getDepthMetrics"]>;
    };
}

export class OrderflowPreprocessor
    extends EventEmitter
    implements IOrderflowPreprocessor
{
    private readonly bookState: OrderBookState;
    private readonly pricePrecision: number;
    private readonly bandTicks: number;
    private readonly tickSize: number;
    private readonly emitDepthMetrics: boolean;
    private readonly logger: Logger;
    private readonly metricsCollector: MetricsCollector;
    private readonly symbol; // Default symbol, can be made configurable

    // Track processing stats
    private processedTrades = 0;
    private processedDepthUpdates = 0;

    constructor(
        opts: OrderflowPreprocessorOptions = {},
        orderBook: OrderBookState,
        logger: Logger,
        metricsCollector: MetricsCollector
    ) {
        super();
        this.logger = logger;
        this.metricsCollector = metricsCollector;
        this.pricePrecision = opts.pricePrecision ?? 2;
        this.bandTicks = opts.bandTicks ?? 5;
        this.tickSize = opts.tickSize ?? 0.01;
        this.emitDepthMetrics = opts.emitDepthMetrics ?? false;
        this.symbol = opts.symbol ?? "LTCUSDT"; // Default symbol, can be overridden
        this.bookState = orderBook;
    }

    // Should be called on every depth update
    public handleDepth(
        update: SpotWebsocketStreams.DiffBookDepthResponse
    ): void {
        try {
            if (this.bookState) {
                this.bookState.updateDepth(update);
                this.processedDepthUpdates++;

                // Emit depth metrics if enabled
                if (
                    this.emitDepthMetrics &&
                    this.processedDepthUpdates % 10 === 0
                ) {
                    const metrics = this.bookState.getDepthMetrics();
                    this.emit("depth_metrics", {
                        ...metrics,
                        bestBid: this.bookState.getBestBid(),
                        bestAsk: this.bookState.getBestAsk(),
                        spread: this.bookState.getSpread(),
                        midPrice: this.bookState.getMidPrice(),
                        timestamp: Date.now(),
                    });
                }

                // Update best quotes event
                this.emit("best_quotes_update", {
                    bestBid: this.bookState.getBestBid(),
                    bestAsk: this.bookState.getBestAsk(),
                    spread: this.bookState.getSpread(),
                    timestamp: Date.now(),
                });

                const depthMetrics = this.bookState.getDepthMetrics();
                this.emit("orderbook_update", {
                    timestamp: Date.now(),
                    bestBid: this.bookState.getBestBid(),
                    bestAsk: this.bookState.getBestAsk(),
                    spread: this.bookState.getSpread(),
                    midPrice: this.bookState.getMidPrice(),
                    depthSnapshot: this.bookState.snapshot(),
                    passiveBidVolume: depthMetrics.totalBidVolume,
                    passiveAskVolume: depthMetrics.totalAskVolume,
                    imbalance: depthMetrics.imbalance,
                } as OrderBookSnapshot);
            }
        } catch (error) {
            this.handleError(
                error as Error,
                "OrderflowPreprocessor.handleDepth"
            );
        }
    }

    // Should be called on every aggtrade event
    public handleAggTrade(trade: SpotWebsocketStreams.AggTradeResponse): void {
        try {
            if (!this.isValidTrade(trade) || !this.bookState) {
                this.metricsCollector.incrementMetric("invalidTrades");
                return;
            }

            const aggressive = this.normalizeTradeData(trade);
            const bookLevel = this.bookState.getLevel(aggressive.price);
            const zone =
                Math.round(aggressive.price / this.tickSize) * this.tickSize;
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
                bestBid: this.bookState.getBestBid(),
                bestAsk: this.bookState.getBestAsk(),
                // Only include depth snapshot for large trades
                depthSnapshot:
                    aggressive.quantity > this.getLargeTradeThreshold()
                        ? this.bookState.snapshot()
                        : undefined,
            };

            this.processedTrades++;
            this.emit("enriched_trade", enriched);

            // Emit metrics periodically
            if (this.processedTrades % 100 === 0) {
                this.emit("processing_metrics", {
                    processedTrades: this.processedTrades,
                    processedDepthUpdates: this.processedDepthUpdates,
                    bookLevels: this.bookState.getDepthMetrics().totalLevels,
                    timestamp: Date.now(),
                });
            }
        } catch (error) {
            this.handleError(
                error as Error,
                "OrderflowPreprocessor.handleAggTrade"
            );
        }
    }

    /**
     * Check if trade data is valid
     */
    protected isValidTrade(
        trade: SpotWebsocketStreams.AggTradeResponse
    ): boolean {
        return !!(
            trade.e &&
            trade.e === "aggTrade" &&
            trade.T &&
            trade.p &&
            trade.q &&
            trade.s &&
            parseFloat(trade.p) > 0 &&
            parseFloat(trade.q) > 0
        );
    }

    /**
     * Normalize trade data
     */
    protected normalizeTradeData(
        trade: SpotWebsocketStreams.AggTradeResponse
    ): AggressiveTrade {
        const price = parseFloat(trade.p!);
        const normalizedPrice =
            Math.round(price / this.tickSize) * this.tickSize;

        return {
            price: normalizedPrice,
            quantity: parseFloat(trade.q!),
            timestamp: trade.T!,
            buyerIsMaker: !!trade.m,
            pair: trade.s ?? "",
            originalTrade: trade,
        };
    }

    private getLargeTradeThreshold(): number {
        // Could be made configurable or dynamic
        return 100; // Example: 100 units
    }

    protected handleError(
        error: Error,
        context: string,
        correlationId?: string
    ): void {
        this.metricsCollector.incrementMetric("preprocessorErrors");
        this.logger.error(
            `[${context}] ${error.message}`,
            {
                context,
                errorName: error.name,
                errorMessage: error.message,
                stack: error.stack,
                timestamp: new Date().toISOString(),
                correlationId,
            },
            correlationId
        );
    }

    public getStats(): {
        processedTrades: number;
        processedDepthUpdates: number;
        bookMetrics: ReturnType<OrderBookState["getDepthMetrics"]>;
    } {
        if (!this.bookState) {
            throw new Error("OrderBookState is not initialized");
        }
        return {
            processedTrades: this.processedTrades,
            processedDepthUpdates: this.processedDepthUpdates,
            bookMetrics: this.bookState.getDepthMetrics(),
        };
    }
}
