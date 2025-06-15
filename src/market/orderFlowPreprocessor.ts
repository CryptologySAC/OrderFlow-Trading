// src/market/orderflowPreprocessor.ts
import type { SpotWebsocketStreams } from "@binance/spot";
import { EventEmitter } from "events";
import type {
    AggressiveTrade,
    EnrichedTradeEvent,
    HybridTradeEvent,
    OrderBookSnapshot,
} from "../types/marketEvents.js";
import { OrderBookState } from "./orderBookState.js";
import type { ILogger } from "../infrastructure/loggerInterface.js";
import type { IMetricsCollector } from "../infrastructure/metricsCollectorInterface.js";
import { randomUUID } from "crypto";
import { IndividualTradesManager } from "../data/individualTradesManager.js";
import { MicrostructureAnalyzer } from "../data/microstructureAnalyzer.js";

export interface OrderflowPreprocessorOptions {
    pricePrecision?: number;
    bandTicks?: number;
    tickSize?: number;
    emitDepthMetrics?: boolean;
    symbol?: string;
    enableIndividualTrades?: boolean;
}

export interface IOrderflowPreprocessor {
    handleDepth(
        update: SpotWebsocketStreams.DiffBookDepthResponse
    ): Promise<void>;
    handleAggTrade(trade: SpotWebsocketStreams.AggTradeResponse): Promise<void>;
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
    private readonly logger: ILogger;
    private readonly metricsCollector: IMetricsCollector;
    private readonly symbol; // Default symbol, can be made configurable
    private readonly enableIndividualTrades: boolean;

    // Individual trades components (optional)
    private readonly individualTradesManager?: IndividualTradesManager;
    private readonly microstructureAnalyzer?: MicrostructureAnalyzer;

    // Track processing stats
    private processedTrades = 0;
    private processedDepthUpdates = 0;

    constructor(
        opts: OrderflowPreprocessorOptions = {},
        orderBook: OrderBookState,
        logger: ILogger,
        metricsCollector: IMetricsCollector,
        individualTradesManager?: IndividualTradesManager,
        microstructureAnalyzer?: MicrostructureAnalyzer
    ) {
        super();
        this.logger = logger;
        this.metricsCollector = metricsCollector;
        this.pricePrecision = opts.pricePrecision ?? 2;
        this.bandTicks = opts.bandTicks ?? 5;
        this.tickSize = opts.tickSize ?? 0.01;
        this.emitDepthMetrics = opts.emitDepthMetrics ?? false;
        this.enableIndividualTrades = opts.enableIndividualTrades ?? false;
        this.symbol = opts.symbol ?? "LTCUSDT"; // Default symbol, can be overridden
        this.bookState = orderBook;

        // Initialize individual trades components if enabled
        if (this.enableIndividualTrades) {
            this.individualTradesManager = individualTradesManager;
            this.microstructureAnalyzer = microstructureAnalyzer;

            if (!this.individualTradesManager || !this.microstructureAnalyzer) {
                this.logger.warn(
                    "[OrderflowPreprocessor] Individual trades enabled but components not provided"
                );
            }
        }

        this.logger.info("[OrderflowPreprocessor] Initialized", {
            symbol: this.symbol,
            enableIndividualTrades: this.enableIndividualTrades,
            hasIndividualTradesManager: !!this.individualTradesManager,
            hasMicrostructureAnalyzer: !!this.microstructureAnalyzer,
        });
    }

    // Should be called on every depth update
    public async handleDepth(
        update: SpotWebsocketStreams.DiffBookDepthResponse
    ): Promise<void> {
        try {
            if (this.bookState) {
                // DEBUG: Log incoming depth update details
                const bids = (update.b as [string, string][]) || [];
                const asks = (update.a as [string, string][]) || [];

                // Count non-zero bids and asks in the update
                const nonZeroBids = bids.filter(
                    ([_, qty]) => parseFloat(qty) > 0
                ).length;
                const nonZeroAsks = asks.filter(
                    ([_, qty]) => parseFloat(qty) > 0
                ).length;
                const zeroBids = bids.filter(
                    ([_, qty]) => parseFloat(qty) === 0
                ).length;
                const zeroAsks = asks.filter(
                    ([_, qty]) => parseFloat(qty) === 0
                ).length;

                this.logger.debug(
                    "[OrderflowPreprocessor] DEPTH UPDATE RECEIVED",
                    {
                        symbol: this.symbol,
                        updateId: update.u,
                        firstUpdateId: update.U,
                        totalBidUpdates: bids.length,
                        totalAskUpdates: asks.length,
                        nonZeroBids,
                        nonZeroAsks,
                        zeroBids,
                        zeroAsks,
                        bidAskUpdateRatio:
                            asks.length > 0
                                ? (bids.length / asks.length).toFixed(2)
                                : "N/A",
                        bidSamplePrice: bids.length > 0 ? bids[0][0] : "none",
                        askSamplePrice: asks.length > 0 ? asks[0][0] : "none",
                        timestamp: Date.now(),
                    }
                );

                await this.bookState.updateDepth(update);
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

                // DEBUG: Log post-update order book metrics
                this.logger.debug(
                    "[OrderflowPreprocessor] POST-UPDATE BOOK METRICS",
                    {
                        symbol: this.symbol,
                        totalLevels: depthMetrics.totalLevels,
                        bidLevels: depthMetrics.bidLevels,
                        askLevels: depthMetrics.askLevels,
                        bidAskLevelRatio: (
                            depthMetrics.bidLevels /
                            Math.max(depthMetrics.askLevels, 1)
                        ).toFixed(2),
                        totalBidVolume: depthMetrics.totalBidVolume.toFixed(4),
                        totalAskVolume: depthMetrics.totalAskVolume.toFixed(4),
                        volumeImbalance: depthMetrics.imbalance.toFixed(4),
                        bestBid: this.bookState.getBestBid(),
                        bestAsk: this.bookState.getBestAsk(),
                        spread: this.bookState.getSpread(),
                        midPrice: this.bookState.getMidPrice(),
                    }
                );

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
    public async handleAggTrade(
        trade: SpotWebsocketStreams.AggTradeResponse
    ): Promise<void> {
        try {
            if (!this.isValidTrade(trade)) {
                this.metricsCollector.incrementMetric("invalidTrades");
                throw new Error("Invalid trade data received");
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

            // Create basic enriched trade
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

            // Check if we should enhance with individual trades data
            let finalTrade: EnrichedTradeEvent | HybridTradeEvent = enriched;

            if (
                this.enableIndividualTrades &&
                this.individualTradesManager &&
                this.microstructureAnalyzer
            ) {
                try {
                    // Check if we should fetch individual trades for this aggregated trade
                    if (
                        this.individualTradesManager.shouldFetchIndividualTrades(
                            aggressive
                        )
                    ) {
                        // Enhance with individual trades data
                        finalTrade =
                            await this.individualTradesManager.enhanceAggTradeWithIndividuals(
                                enriched
                            );

                        // Add microstructure analysis if individual trades are available
                        if (
                            "hasIndividualData" in finalTrade &&
                            finalTrade.hasIndividualData &&
                            finalTrade.individualTrades
                        ) {
                            try {
                                finalTrade.microstructure =
                                    this.microstructureAnalyzer.analyze(
                                        finalTrade.individualTrades
                                    );
                            } catch (analysisError) {
                                this.logger.warn(
                                    "[OrderflowPreprocessor] Microstructure analysis failed",
                                    {
                                        error:
                                            analysisError instanceof Error
                                                ? analysisError.message
                                                : String(analysisError),
                                        tradeId: aggressive.tradeId,
                                    }
                                );
                                // Continue without microstructure data
                            }
                        }

                        this.metricsCollector.incrementMetric(
                            "hybridTradesProcessed"
                        );
                    } else {
                        // Convert to HybridTradeEvent format but without individual data
                        finalTrade = {
                            ...enriched,
                            hasIndividualData: false,
                            tradeComplexity: "simple",
                        };
                    }
                } catch (error) {
                    this.logger.warn(
                        "[OrderflowPreprocessor] Individual trades enhancement failed, falling back to basic enrichment",
                        {
                            error: (error as Error).message,
                            tradeId: aggressive.tradeId,
                        }
                    );

                    // Fallback to basic enriched trade
                    finalTrade = {
                        ...enriched,
                        hasIndividualData: false,
                        tradeComplexity: "simple",
                    };

                    this.metricsCollector.incrementMetric(
                        "individualTradesEnhancementErrors"
                    );
                }
            }

            // Iceberg detection in OrderBook
            const side = finalTrade.buyerIsMaker ? "sell" : "buy";
            const price = finalTrade.price;
            const qty = finalTrade.quantity;

            this.bookState.registerTradeImpact(price, qty, side);
            this.processedTrades++;
            this.emit("enriched_trade", finalTrade);

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
        const normalizedPrice = parseFloat(
            (Math.round(price / this.tickSize) * this.tickSize).toFixed(
                this.pricePrecision
            )
        );

        return {
            price: normalizedPrice,
            quantity: parseFloat(trade.q!),
            timestamp: trade.T!,
            buyerIsMaker: !!trade.m,
            pair: trade.s ?? "",
            originalTrade: trade,
            tradeId: trade.a ? trade.a.toString() : randomUUID(),
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
