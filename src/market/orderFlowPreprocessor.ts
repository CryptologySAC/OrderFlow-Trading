// src/market/orderflowPreprocessor.ts
import type { SpotWebsocketStreams } from "@binance/spot";
import { EventEmitter } from "events";
import type {
    AggressiveTrade,
    EnrichedTradeEvent,
    HybridTradeEvent,
    OrderBookUpdate,
    OrderBookSnapshot,
} from "../types/marketEvents.js";
import { IOrderBookState } from "./orderBookState.js";
import type { ILogger } from "../infrastructure/loggerInterface.js";
import type { IMetricsCollector } from "../infrastructure/metricsCollectorInterface.js";
import { randomUUID } from "crypto";
import { IndividualTradesManager } from "../data/individualTradesManager.js";
import { MicrostructureAnalyzer } from "../data/microstructureAnalyzer.js";
import { FinancialMath } from "../utils/financialMath.js";

export interface OrderflowPreprocessorOptions {
    pricePrecision?: number;
    quantityPrecision?: number;
    bandTicks?: number;
    tickSize?: number;
    symbol?: string;
    enableIndividualTrades?: boolean;
    largeTradeThreshold?: number;
    maxEventListeners?: number;
    // Dashboard update configuration
    dashboardUpdateInterval?: number;
    maxDashboardInterval?: number;
    significantChangeThreshold?: number;
}

export interface IOrderflowPreprocessor {
    handleDepth(update: SpotWebsocketStreams.DiffBookDepthResponse): void;
    handleAggTrade(trade: SpotWebsocketStreams.AggTradeResponse): Promise<void>;
    getStats(): {
        processedTrades: number;
        processedDepthUpdates: number;
        bookMetrics: ReturnType<IOrderBookState["getDepthMetrics"]>;
    };
}

export class OrderflowPreprocessor
    extends EventEmitter
    implements IOrderflowPreprocessor
{
    private readonly bookState: IOrderBookState;
    private readonly pricePrecision: number;
    private readonly quantityPrecision: number;
    private readonly bandTicks: number;
    private readonly tickSize: number;
    private readonly logger: ILogger;
    private readonly metricsCollector: IMetricsCollector;
    private readonly symbol: string;
    private readonly enableIndividualTrades: boolean;
    private readonly largeTradeThreshold: number;
    private readonly maxEventListeners: number;

    // Dashboard update configuration
    private readonly dashboardUpdateInterval: number;
    private readonly maxDashboardInterval: number;
    private readonly significantChangeThreshold: number;

    // Dashboard update state
    private dashboardUpdateTimer?: NodeJS.Timeout;
    private lastDashboardUpdate = 0;
    private lastDashboardMidPrice = 0;

    // Individual trades components (optional)
    private readonly individualTradesManager?: IndividualTradesManager;
    private readonly microstructureAnalyzer?: MicrostructureAnalyzer;

    // Track processing stats
    private processedTrades = 0;
    private processedDepthUpdates = 0;

    constructor(
        opts: OrderflowPreprocessorOptions = {},
        orderBook: IOrderBookState,
        logger: ILogger,
        metricsCollector: IMetricsCollector,
        individualTradesManager?: IndividualTradesManager,
        microstructureAnalyzer?: MicrostructureAnalyzer
    ) {
        super();
        this.logger = logger;
        this.metricsCollector = metricsCollector;
        this.pricePrecision = opts.pricePrecision ?? 2;
        this.quantityPrecision = opts.quantityPrecision ?? 8; // Default 8 decimals for most crypto
        this.bandTicks = opts.bandTicks ?? 5;
        this.tickSize = opts.tickSize ?? 0.01;
        this.enableIndividualTrades = opts.enableIndividualTrades ?? false;
        this.symbol = opts.symbol ?? "LTCUSDT";
        this.largeTradeThreshold = opts.largeTradeThreshold ?? 100;
        this.maxEventListeners = opts.maxEventListeners ?? 50;

        // Dashboard update configuration
        this.dashboardUpdateInterval = opts.dashboardUpdateInterval ?? 200; // 200ms = 5 FPS
        this.maxDashboardInterval = opts.maxDashboardInterval ?? 1000; // Max 1 second between updates
        this.significantChangeThreshold =
            opts.significantChangeThreshold ?? 0.001; // 0.1% price change

        this.bookState = orderBook;

        // Configure EventEmitter to prevent memory leaks
        this.setMaxListeners(this.maxEventListeners);

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
            pricePrecision: this.pricePrecision,
            quantityPrecision: this.quantityPrecision,
            largeTradeThreshold: this.largeTradeThreshold,
            maxEventListeners: this.maxEventListeners,
            dashboardUpdateInterval: this.dashboardUpdateInterval,
            enableIndividualTrades: this.enableIndividualTrades,
            hasIndividualTradesManager: !!this.individualTradesManager,
            hasMicrostructureAnalyzer: !!this.microstructureAnalyzer,
        });

        // Initialize dashboard update timer
        this.initializeDashboardTimer();
    }

    // Should be called on every depth update
    public handleDepth(
        update: SpotWebsocketStreams.DiffBookDepthResponse
    ): void {
        try {
            if (this.bookState) {
                this.bookState.updateDepth(update);
                this.processedDepthUpdates++;

                const bestBid = this.bookState.getBestBid();
                const bestAsk = this.bookState.getBestAsk();
                const spread = this.bookState.getSpread();
                const midPrice = this.bookState.getMidPrice();
                const timestamp = Date.now();
                const depthMetrics = this.bookState.getDepthMetrics();

                // Update best quotes event
                this.emit("best_quotes_update", {
                    bestBid,
                    bestAsk,
                    spread,
                    timestamp,
                });

                // OPTIMIZED: orderbook_update now focuses on trading signals (NO expensive snapshot)
                // Core quotes and metrics for signal validation and processing
                // Dashboard visualization uses separate dedicated event stream
                this.emit("orderbook_update", {
                    timestamp,
                    bestBid,
                    bestAsk,
                    spread,
                    midPrice,
                    passiveBidVolume: depthMetrics.totalBidVolume,
                    passiveAskVolume: depthMetrics.totalAskVolume,
                    imbalance: depthMetrics.imbalance,
                } as OrderBookUpdate);
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
            // Basic structure validation only
            if (
                !(
                    trade.e === "aggTrade" &&
                    trade.T &&
                    trade.p &&
                    trade.q &&
                    trade.s
                )
            ) {
                this.metricsCollector.incrementMetric("invalidTrades");
                throw new Error("Invalid trade structure");
            }

            const aggressive = this.normalizeTradeData(trade);
            const bookLevel = this.bookState.getLevel(aggressive.price);
            const zone = FinancialMath.priceToZone(
                aggressive.price,
                this.tickSize
            );

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
     * Normalize trade data with enhanced validation and precision handling
     */
    protected normalizeTradeData(
        trade: SpotWebsocketStreams.AggTradeResponse
    ): AggressiveTrade {
        const price = FinancialMath.parsePrice(trade.p!);
        const quantity = FinancialMath.parseQuantity(trade.q!);

        // Apply financial precision normalization to quantity using symbol-specific precision
        const normalizedQuantity = FinancialMath.normalizeQuantity(
            quantity,
            this.quantityPrecision
        );

        const normalizedPrice = FinancialMath.normalizePriceToTick(
            price,
            this.tickSize
        );

        return {
            price: normalizedPrice,
            quantity: normalizedQuantity,
            timestamp: trade.T!,
            buyerIsMaker: !!trade.m,
            pair: trade.s ?? "",
            originalTrade: trade,
            tradeId: trade.a ? trade.a.toString() : randomUUID(),
        };
    }

    /**
     * Get the threshold for large trades that require full depth snapshot
     * This is now configurable per symbol to account for different liquidity profiles
     */
    private getLargeTradeThreshold(): number {
        return this.largeTradeThreshold;
    }

    /**
     * Initialize dashboard update timer for periodic snapshot generation
     */
    private initializeDashboardTimer(): void {
        this.dashboardUpdateTimer = setInterval(() => {
            this.emitDashboardUpdate();
        }, this.dashboardUpdateInterval);

        this.logger.info(
            "[OrderflowPreprocessor] Dashboard timer initialized",
            {
                interval: this.dashboardUpdateInterval,
                maxInterval: this.maxDashboardInterval,
            }
        );
    }

    /**
     * Emit dashboard-specific orderbook update with full snapshot
     */
    private emitDashboardUpdate(): void {
        try {
            const timestamp = Date.now();
            const depthMetrics = this.bookState.getDepthMetrics();
            const bestBid = this.bookState.getBestBid();
            const bestAsk = this.bookState.getBestAsk();
            const spread = this.bookState.getSpread();
            const midPrice = this.bookState.getMidPrice();

            // Check if we should skip this update
            if (!this.shouldUpdateDashboard(midPrice, timestamp)) {
                return;
            }

            // Create snapshot for dashboard visualization
            const snapshot = this.bookState.snapshot();

            this.emit("dashboard_orderbook_update", {
                timestamp,
                bestBid,
                bestAsk,
                spread,
                midPrice,
                depthSnapshot: snapshot,
                passiveBidVolume: depthMetrics.totalBidVolume,
                passiveAskVolume: depthMetrics.totalAskVolume,
                imbalance: depthMetrics.imbalance,
            } as OrderBookSnapshot);

            // Update dashboard state
            this.lastDashboardUpdate = timestamp;
            this.lastDashboardMidPrice = midPrice;
        } catch (error) {
            this.handleError(
                error as Error,
                "OrderflowPreprocessor.emitDashboardUpdate"
            );
        }
    }

    /**
     * Determine if dashboard should be updated based on time and price movement
     */
    private shouldUpdateDashboard(
        currentMidPrice: number,
        now: number
    ): boolean {
        const timeSinceLastUpdate = now - this.lastDashboardUpdate;

        // Always respect minimum interval
        if (timeSinceLastUpdate < this.dashboardUpdateInterval) {
            return false;
        }

        // Force update if max interval exceeded
        if (timeSinceLastUpdate >= this.maxDashboardInterval) {
            return true;
        }

        // Update on significant price change
        if (this.lastDashboardMidPrice > 0) {
            const changePercent =
                Math.abs(currentMidPrice - this.lastDashboardMidPrice) /
                this.lastDashboardMidPrice;
            if (changePercent > this.significantChangeThreshold) {
                return true;
            }
        }

        return false;
    }

    /**
     * Cleanup dashboard timer on shutdown
     */
    public shutdown(): void {
        if (this.dashboardUpdateTimer) {
            clearInterval(this.dashboardUpdateTimer);
            this.dashboardUpdateTimer = undefined;
            this.logger.info("[OrderflowPreprocessor] Dashboard timer cleared");
        }
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
        bookMetrics: ReturnType<IOrderBookState["getDepthMetrics"]>;
    } {
        if (!this.bookState) {
            throw new Error("OrderBook is not initialized");
        }
        return {
            processedTrades: this.processedTrades,
            processedDepthUpdates: this.processedDepthUpdates,
            bookMetrics: this.bookState.getDepthMetrics(),
        };
    }
}
