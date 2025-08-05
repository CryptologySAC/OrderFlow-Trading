// src/market/orderflowPreprocessor.ts
import type { SpotWebsocketStreams } from "@binance/spot";
import { EventEmitter } from "events";
import type {
    AggressiveTrade,
    EnrichedTradeEvent,
    HybridTradeEvent,
    OrderBookUpdate,
    OrderBookSnapshot,
    ZoneSnapshot,
    StandardZoneData,
    ZoneTradeRecord,
} from "../types/marketEvents.js";
import { IOrderBookState } from "./orderBookState.js";
import type { ILogger } from "../infrastructure/loggerInterface.js";
import type { IMetricsCollector } from "../infrastructure/metricsCollectorInterface.js";
import { randomUUID } from "crypto";
import { IndividualTradesManager } from "../data/individualTradesManager.js";
import { MicrostructureAnalyzer } from "../data/microstructureAnalyzer.js";
import { FinancialMath } from "../utils/financialMath.js";
import { AdaptiveZoneCalculator } from "../utils/adaptiveZoneCalculator.js";
import type { StandardZoneConfig } from "../types/zoneTypes.js";
import { CircularBuffer } from "../utils/circularBuffer.js";

export interface OrderflowPreprocessorOptions {
    pricePrecision: number;
    quantityPrecision: number;
    bandTicks: number;
    tickSize: number;
    symbol: string;
    enableIndividualTrades: boolean;
    largeTradeThreshold: number;
    maxEventListeners: number;
    dashboardUpdateInterval: number;
    maxDashboardInterval: number;
    significantChangeThreshold: number;
    standardZoneConfig: StandardZoneConfig;
    maxZoneCacheAgeMs: number; // 90 minutes for cross-detector zone persistence
    adaptiveZoneLookbackTrades: number; // 500 trades ≈ meaningful zone formation over 12-15 min
    zoneCalculationRange: number; // ±12 zones for broader price action coverage
    zoneCacheSize: number; // Pre-allocated cache size for 90-minute analysis
    defaultZoneMultipliers: number[];
    defaultTimeWindows: number[];
    defaultMinZoneWidthMultiplier: number; // Based on LTCUSDT: 2 ticks minimum
    defaultMaxZoneWidthMultiplier: number; // Based on LTCUSDT: 10 ticks maximum
    defaultMaxZoneHistory: number; // 2000 zones ≈ 90+ minutes comprehensive coverage
    defaultMaxMemoryMB: number; // 50MB for 90-minute zone structures and history
    defaultAggressiveVolumeAbsolute: number; // LTCUSDT: 10+ LTC (top 5% of trades)
    defaultPassiveVolumeAbsolute: number; // LTCUSDT: 5+ LTC (top 15% of trades)
    defaultInstitutionalVolumeAbsolute: number; // LTCUSDT: 50+ LTC (<1% whale trades)
    maxTradesPerZone: number; // Maximum individual trades stored per zone for VWAP calculation
}

export interface IOrderflowPreprocessor {
    handleDepth(update: SpotWebsocketStreams.DiffBookDepthResponse): void;
    handleAggTrade(trade: SpotWebsocketStreams.AggTradeResponse): Promise<void>;
    getStats(): {
        processedTrades: number;
        processedDepthUpdates: number;
        bookMetrics: ReturnType<IOrderBookState["getDepthMetrics"]>;
    };
    // Universal zone analysis service methods
    findZonesNearPrice(
        zones: ZoneSnapshot[],
        price: number,
        maxDistanceTicks: number
    ): ZoneSnapshot[];
    calculateZoneRelevanceScore(zone: ZoneSnapshot, price: number): number;
    findMostRelevantZone(
        zoneData: StandardZoneData,
        price: number,
        maxDistanceTicks?: number
    ): ZoneSnapshot | null;
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

    // NEW: Standardized zone cache and configuration - PERFORMANCE OPTIMIZED
    private readonly standardZoneConfig: StandardZoneConfig;
    private readonly adaptiveZoneCalculator?: AdaptiveZoneCalculator;
    // High-performance zone cache using arrays instead of Maps
    private readonly zoneCache: (ZoneSnapshot | null)[] = []; // LRU cache with pre-allocated size
    private readonly zoneCacheSize: number;
    private readonly zoneCacheIndex: Map<string, number> = new Map(); // Fast zone lookup by ID
    private zoneCacheHead = 0; // LRU cache head pointer
    private readonly maxZoneCacheAge: number;
    private readonly adaptiveZoneLookbackTrades: number;
    private readonly zoneCalculationRange: number;
    // Zone configuration parameters (CLAUDE.md compliance - LTCUSDT data-driven)
    // LTCUSDT volume analysis - absolute thresholds instead of ratios
    private readonly maxTradesPerZone: number;

    // Track processing stats
    private processedTrades = 0;
    private processedDepthUpdates = 0;

    constructor(
        opts: OrderflowPreprocessorOptions,
        orderBook: IOrderBookState,
        logger: ILogger,
        metricsCollector: IMetricsCollector,
        individualTradesManager?: IndividualTradesManager,
        microstructureAnalyzer?: MicrostructureAnalyzer
    ) {
        super();
        this.logger = logger;
        this.metricsCollector = metricsCollector;
        this.pricePrecision = opts.pricePrecision;
        this.quantityPrecision = opts.quantityPrecision; // Default 8 decimals for most crypto
        this.bandTicks = opts.bandTicks;
        this.tickSize = opts.tickSize;
        this.enableIndividualTrades = opts.enableIndividualTrades;
        this.symbol = opts.symbol;
        this.largeTradeThreshold = opts.largeTradeThreshold;
        this.maxEventListeners = opts.maxEventListeners;

        // Dashboard update configuration
        this.dashboardUpdateInterval = opts.dashboardUpdateInterval; // 200ms = 5 FPS
        this.maxDashboardInterval = opts.maxDashboardInterval; // Max 1 second between updates
        this.significantChangeThreshold = opts.significantChangeThreshold; // 0.1% price change

        // LTCUSDT volume thresholds - absolute values from trade distribution analysis
        this.maxTradesPerZone = opts.maxTradesPerZone; // Maximum individual trades stored per zone

        // NEW: Initialize standardized zone configuration (LTCUSDT data-driven defaults) - AFTER defaults set
        this.standardZoneConfig = opts.standardZoneConfig;

        // LTCUSDT 90-minute cross-detector zone analysis (1.54s avg trade frequency, 3,500 trades/90min)
        this.maxZoneCacheAge = opts.maxZoneCacheAgeMs; // 90 minutes for cross-detector zone persistence
        this.adaptiveZoneLookbackTrades = opts.adaptiveZoneLookbackTrades; // 500 trades ≈ 12-15 min meaningful zone formation
        this.zoneCalculationRange = opts.zoneCalculationRange; // ±12 zones captures broader price action
        this.zoneCacheSize = opts.zoneCacheSize; // (12*2+1) * 3 zone sizes * 5 time windows for 90-min analysis

        // Pre-allocate zone cache for performance (based on zoneCacheSize)
        if (this.zoneCacheSize && this.zoneCacheSize > 0) {
            this.zoneCache.length = this.zoneCacheSize;
            for (let i = 0; i < this.zoneCacheSize; i++) {
                this.zoneCache[i] = null; // Will be populated as needed
            }
        }

        this.bookState = orderBook;

        // Configure EventEmitter to prevent memory leaks
        if (
            this.maxEventListeners &&
            typeof this.maxEventListeners === "number" &&
            this.maxEventListeners > 0
        ) {
            this.setMaxListeners(this.maxEventListeners);
        }

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

        // Initialize adaptive zone calculator if enabled
        if (this.standardZoneConfig.adaptiveMode) {
            this.adaptiveZoneCalculator = new AdaptiveZoneCalculator(
                this.adaptiveZoneLookbackTrades
            );
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
            // NEW: Zone configuration logging
            zoneTicks: this.standardZoneConfig?.zoneTicks,
            adaptiveMode: this.standardZoneConfig?.adaptiveMode,
            hasAdaptiveCalculator: !!this.adaptiveZoneCalculator,
        });

        // Initialize dashboard update timer
        this.initializeDashboardTimer();
    }

    // Should be called on every depth update
    public handleDepth(
        update: SpotWebsocketStreams.DiffBookDepthResponse
    ): void {
        const correlationId = randomUUID();
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
                "OrderflowPreprocessor.handleDepth",
                correlationId
            );
        }
    }

    // Should be called on every aggtrade event
    public async handleAggTrade(
        trade: SpotWebsocketStreams.AggTradeResponse
    ): Promise<void> {
        const correlationId = randomUUID();
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
                throw new Error(
                    `Invalid trade structure - correlationId: ${correlationId}`
                );
            }

            const aggressive = this.normalizeTradeData(trade);
            const bookLevel = this.bookState.getLevel(aggressive.price);

            const band = this.bookState.sumBand(
                aggressive.price,
                this.bandTicks,
                this.tickSize
            );

            const zoneData = this.calculateStandardizedZones(
                aggressive.price,
                aggressive.timestamp
            );

            // Create basic enriched trade with updated zone data
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
                // Zone data will be populated after trade aggregation
                zoneData: zoneData,
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
                                    },
                                    correlationId
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
                        },
                        correlationId
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

            // DEBUG: Confirm we reach the aggregation call
            this.logger.debug(
                "[OrderflowPreprocessor] About to call aggregateTradeIntoZones",
                {
                    finalTradeExists: !!finalTrade,
                    finalTradePrice: finalTrade?.price,
                    finalTradeQuantity: finalTrade?.quantity,
                    processedTrades: this.processedTrades,
                }
            );

            // CRITICAL FIX: Final trade aggregation for detectors
            // This ensures zones contain the complete finalTrade data (including any individual trades enhancements)
            try {
                this.aggregateTradeIntoZones(finalTrade);
                this.logger.debug(
                    "[OrderflowPreprocessor] aggregateTradeIntoZones completed successfully"
                );

                // CRITICAL FIX: Update finalTrade.zoneData with aggregated zone data
                // The tests expect the zones to have aggregated volume data
                const updatedZoneData = this.getCurrentZoneData(
                    finalTrade.price,
                    finalTrade.timestamp
                );
                if (updatedZoneData) {
                    finalTrade.zoneData = updatedZoneData;
                    this.logger.debug(
                        "[OrderflowPreprocessor] finalTrade.zoneData updated with aggregated data"
                    );
                }
            } catch (error) {
                this.logger.error(
                    "[OrderflowPreprocessor] ERROR in aggregateTradeIntoZones",
                    {
                        error:
                            error instanceof Error
                                ? error.message
                                : String(error),
                        stack:
                            error instanceof Error ? error.stack : "No stack",
                        finalTrade: {
                            price: finalTrade?.price,
                            quantity: finalTrade?.quantity,
                            timestamp: finalTrade?.timestamp,
                        },
                    }
                );
            }

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
                "OrderflowPreprocessor.handleAggTrade",
                correlationId
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

            // Clean up zone cache periodically to prevent memory leaks
            this.cleanupZoneCache();
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
        const correlationId = randomUUID();
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
                "OrderflowPreprocessor.emitDashboardUpdate",
                correlationId
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

    // ========================================================================
    // STANDARDIZED ZONE CALCULATION METHODS
    // ========================================================================

    /**
     * Calculate standardized zone data for all supported zone sizes
     * Returns zones for 5-tick, 10-tick, 20-tick, and optionally adaptive zones
     */
    private calculateStandardizedZones(
        price: number,
        timestamp: number
    ): StandardZoneData {
        this.logger.debug("[OrderflowPreprocessor] Starting zone calculation", {
            price,
            timestamp,
            zoneTicks: this.standardZoneConfig.zoneTicks,
            adaptiveMode: this.standardZoneConfig.adaptiveMode,
            timeWindows: this.standardZoneConfig.timeWindows,
            hasTimeWindows: !!this.standardZoneConfig.timeWindows,
            timeWindowsLength: this.standardZoneConfig.timeWindows?.length,
        });

        // Update adaptive calculator if enabled
        if (this.adaptiveZoneCalculator) {
            this.adaptiveZoneCalculator.updatePrice(price);
        }

        // Calculate zones with configured size (10 ticks)
        this.logger.debug("[OrderflowPreprocessor] Calculating zones", {
            zoneTicks: this.standardZoneConfig.zoneTicks,
        });
        const zones = this.calculateZoneSnapshots(
            price,
            this.standardZoneConfig.zoneTicks,
            timestamp
        );

        this.logger.debug("[OrderflowPreprocessor] Zone arrays calculated", {
            zonesCount: zones.length,
        });

        // Calculate adaptive zones if enabled
        let adaptiveZones: ZoneSnapshot[] | undefined;
        if (
            this.standardZoneConfig.adaptiveMode &&
            this.adaptiveZoneCalculator
        ) {
            const adaptiveTicks =
                this.adaptiveZoneCalculator.getAdaptiveZoneTicks(
                    this.pricePrecision
                );
            adaptiveZones = this.calculateZoneSnapshots(
                price,
                adaptiveTicks,
                timestamp
            );
        }

        const result = {
            zones,
            adaptiveZones,
            zoneConfig: {
                zoneTicks: this.standardZoneConfig.zoneTicks,
                tickValue: this.tickSize,
                timeWindow: this.standardZoneConfig.timeWindows[0], // Use shortest time window
            },
        };

        this.logger.debug(
            "[OrderflowPreprocessor] Zone calculation completed successfully",
            {
                totalZones: zones.length,
                hasAdaptiveZones: !!adaptiveZones,
            }
        );

        return result;
    }

    /**
     * ===================================================================
     * UNIVERSAL ZONE ANALYSIS SERVICE
     * ===================================================================
     *
     * Centralized zone analysis methods for all enhanced detectors.
     * Prevents code duplication and maintains architectural integrity.
     */

    /**
     * Find zones near a specific price within distance threshold
     */
    public findZonesNearPrice(
        zones: ZoneSnapshot[],
        price: number,
        maxDistanceTicks: number
    ): ZoneSnapshot[] {
        const maxDistance = FinancialMath.multiplyQuantities(
            maxDistanceTicks,
            this.tickSize
        );

        return zones.filter((zone) => {
            const distance = FinancialMath.calculateSpread(
                zone.priceLevel,
                price,
                8
            );
            return distance <= maxDistance;
        });
    }

    /**
     * Calculate zone relevance score for enhanced detector zone selection
     */
    public calculateZoneRelevanceScore(
        zone: ZoneSnapshot,
        price: number
    ): number {
        const totalVolume = zone.aggressiveVolume + zone.passiveVolume;
        const distance = FinancialMath.calculateSpread(
            zone.priceLevel,
            price,
            8
        );
        const proximityScore = Math.max(0, 1 - distance / 0.05); // Closer is better
        const volumeScore = Math.min(1, totalVolume / 100); // Higher volume is better

        return FinancialMath.multiplyQuantities(
            FinancialMath.addAmounts(proximityScore, volumeScore, 8),
            0.5
        );
    }

    /**
     * Find the most relevant zone from StandardZoneData for enhanced detectors
     */
    public findMostRelevantZone(
        zoneData: StandardZoneData,
        price: number,
        maxDistanceTicks: number = 5
    ): ZoneSnapshot | null {
        // CLAUDE.md SIMPLIFIED: Use single zone array (no more triple-counting!)
        const allZones = [...zoneData.zones];

        if (allZones.length === 0) {
            return null;
        }

        // Find zones near the current price
        const relevantZones = this.findZonesNearPrice(
            allZones,
            price,
            maxDistanceTicks
        );
        if (relevantZones.length === 0) {
            return null;
        }

        // Select the zone with the highest relevance score
        let bestZone = relevantZones[0];
        let bestScore = this.calculateZoneRelevanceScore(bestZone, price);

        for (const zone of relevantZones.slice(1)) {
            const score = this.calculateZoneRelevanceScore(zone, price);
            if (score > bestScore) {
                bestScore = score;
                bestZone = zone;
            }
        }

        return bestZone;
    }

    /**
     * Calculate zone snapshots for a specific zone size around a price
     * Returns zones within a reasonable range of the current price
     */
    private calculateZoneSnapshots(
        tradePrice: number,
        zoneTicks: number,
        timestamp: number
    ): ZoneSnapshot[] {
        this.logger.debug(
            "[OrderflowPreprocessor] calculateZoneSnapshots called",
            {
                tradePrice,
                zoneTicks,
                timestamp,
                tickSize: this.tickSize,
                pricePrecision: this.pricePrecision,
                rangeZones: this.zoneCalculationRange,
            }
        );

        const snapshots: ZoneSnapshot[] = [];
        const zoneSize = FinancialMath.safeMultiply(zoneTicks, this.tickSize);
        const rangeZones = this.zoneCalculationRange; // Configurable zones above and below current price

        // Calculate zone boundaries for the trade price
        this.logger.debug(
            "[OrderflowPreprocessor] Calling FinancialMath.calculateZone"
        );
        const currentZoneLowerBoundary = FinancialMath.calculateZone(
            tradePrice,
            zoneTicks,
            this.pricePrecision
        );
        this.logger.debug(
            "[OrderflowPreprocessor] Zone lower boundary calculated",
            {
                currentZoneLowerBoundary,
            }
        );

        // Generate zones around the current price
        for (let i = -rangeZones; i <= rangeZones; i++) {
            const zoneLowerBoundary = FinancialMath.safeAdd(
                currentZoneLowerBoundary,
                FinancialMath.safeMultiply(i, zoneSize)
            );
            // Check cache first for existing zone with trade data
            const zoneId = `${this.symbol}_${zoneTicks}T_${zoneLowerBoundary.toFixed(this.pricePrecision)}`;
            const cachedZone = this.getZoneFromCache(zoneId);

            const zoneSnapshot =
                cachedZone ||
                this.createZoneSnapshot(
                    zoneLowerBoundary,
                    zoneTicks,
                    timestamp,
                    tradePrice
                );

            if (zoneSnapshot) {
                snapshots.push(zoneSnapshot);
            }
        }

        return snapshots;
    }

    /**
     * Create a single zone snapshot with volume and trade data
     */
    private createZoneSnapshot(
        lowerBoundary: number,
        zoneTicks: number,
        timestamp: number,
        tradePrice: number
    ): ZoneSnapshot | undefined {
        try {
            // Zone boundaries: ONLY lower and upper boundaries exist
            // No centers, no midpoints - zones contain discrete tick levels only

            const minPrice = lowerBoundary; // Lower boundary (e.g., 89.00)
            const zoneSize = FinancialMath.safeMultiply(
                zoneTicks,
                this.tickSize
            );
            const maxPrice = FinancialMath.safeAdd(
                lowerBoundary,
                FinancialMath.safeSubtract(zoneSize, this.tickSize)
            ); // Upper boundary (e.g., 89.09 for 10-tick zone)

            this.logger.debug(
                "[OrderflowPreprocessor] Zone boundary calculation",
                {
                    lowerBoundary,
                    zoneTicks,
                    tickSize: this.tickSize,
                    minPrice,
                    maxPrice,
                    tradePrice,
                    zoneWidth: maxPrice - minPrice,
                    expectedTicks: zoneTicks,
                }
            );

            // CRITICAL FIX: Use actual trade price for passive volume calculation
            // This ensures we get the correct bid/ask volumes around the trade price
            const band = this.bookState.sumBand(
                tradePrice,
                zoneTicks,
                this.tickSize
            );

            // Volume-weighted price starts as null - first trade in zone will set it
            const volumeWeightedPrice = null;

            const zoneSnapshot: ZoneSnapshot = {
                zoneId: `${this.symbol}_${zoneTicks}T_${lowerBoundary.toFixed(this.pricePrecision)}`,
                priceLevel: lowerBoundary,
                tickSize: this.tickSize,
                aggressiveVolume: 0, // Will be updated with trade aggregation
                passiveVolume: FinancialMath.safeAdd(band.bid, band.ask),
                aggressiveBuyVolume: 0, // Will be updated with trade aggregation
                aggressiveSellVolume: 0, // Will be updated with trade aggregation
                passiveBidVolume: band.bid,
                passiveAskVolume: band.ask,
                tradeCount: 0, // Will be updated with trade aggregation
                timespan: this.standardZoneConfig.timeWindows[0], // Default to shortest window
                boundaries: { min: minPrice, max: maxPrice },
                lastUpdate: timestamp,
                volumeWeightedPrice,
                tradeHistory: new CircularBuffer<ZoneTradeRecord>(
                    this.maxTradesPerZone
                ),
            };

            // Add to high-performance cache for subsequent access
            this.addZoneToCache(zoneSnapshot);

            return zoneSnapshot;
        } catch (error) {
            this.logger.warn(
                "[OrderflowPreprocessor] Failed to create zone snapshot",
                {
                    error: (error as Error).message,
                    zoneTicks,
                }
            );
            return undefined;
        }
    }

    /**
     * Clean up expired zone cache entries using high-performance LRU eviction
     * 90-minute TTL for cross-detector zone persistence and multiple revisits
     */
    private cleanupZoneCache(): void {
        const now = Date.now();
        let expiredCount = 0;

        // Iterate through pre-allocated cache array for performance
        for (let i = 0; i < this.zoneCacheSize; i++) {
            const zone = this.zoneCache[i];
            if (
                zone &&
                zone.lastUpdate &&
                now - zone.lastUpdate > this.maxZoneCacheAge
            ) {
                // Remove expired zone and its index mapping
                this.zoneCacheIndex.delete(zone.zoneId);
                this.zoneCache[i] = null;
                expiredCount++;
            }
        }

        if (expiredCount > 0) {
            this.logger.debug(
                "[OrderflowPreprocessor] Cleaned up zone cache using LRU eviction",
                {
                    expiredEntries: expiredCount,
                    cacheSize: this.zoneCacheSize,
                    maxAge: this.maxZoneCacheAge,
                    utilization: this.zoneCacheIndex.size / this.zoneCacheSize,
                }
            );
        }
    }

    /**
     * Add zone to high-performance LRU cache with eviction strategy
     * Uses pre-allocated array instead of Map for better performance
     */
    private addZoneToCache(zone: ZoneSnapshot): void {
        // Check if zone already exists in cache
        const existingIndex = this.zoneCacheIndex.get(zone.zoneId);

        // DEBUG: Log cache update details
        this.logger.debug("[OrderflowPreprocessor] Zone cache update", {
            zoneId: zone.zoneId,
            existingIndex,
            zoneExists: existingIndex !== undefined,
            aggressiveVolume: zone.aggressiveVolume,
            tradeCount: zone.tradeCount,
            operation: existingIndex !== undefined ? "update" : "create",
        });

        if (existingIndex !== undefined) {
            const oldZone = this.zoneCache[existingIndex];

            // CRITICAL FIX: Don't overwrite existing zones that have aggregated volume
            // This preserves trade aggregation data during range-based zone calculation
            if (
                oldZone &&
                oldZone.aggressiveVolume > 0 &&
                zone.aggressiveVolume === 0
            ) {
                this.logger.debug(
                    "[OrderflowPreprocessor] Preserving existing zone with volume",
                    {
                        zoneId: zone.zoneId,
                        existingVolume: oldZone.aggressiveVolume,
                        existingTradeCount: oldZone.tradeCount,
                        newZoneVolume: zone.aggressiveVolume,
                        action: "preserved",
                    }
                );
                return; // Don't overwrite - keep the existing zone with volume
            }

            // Update existing zone (only if new zone has volume or old zone is empty)
            this.zoneCache[existingIndex] = zone;

            // DEBUG: Confirm the update
            this.logger.debug("[OrderflowPreprocessor] Zone cache updated", {
                zoneId: zone.zoneId,
                index: existingIndex,
                oldVolume: oldZone?.aggressiveVolume || 0,
                newVolume: zone.aggressiveVolume,
                cacheUpdated: this.zoneCache[existingIndex] === zone,
            });
            return;
        }

        // Find empty slot or use LRU eviction
        let targetIndex = -1;
        for (let i = 0; i < this.zoneCacheSize; i++) {
            if (!this.zoneCache[i]) {
                targetIndex = i;
                break;
            }
        }

        // If no empty slot, evict LRU entry
        if (targetIndex === -1) {
            targetIndex = this.zoneCacheHead;
            const evictedZone = this.zoneCache[targetIndex];
            if (evictedZone) {
                this.zoneCacheIndex.delete(evictedZone.zoneId);
            }
            this.zoneCacheHead = (this.zoneCacheHead + 1) % this.zoneCacheSize;
        }

        // Add new zone to cache
        this.zoneCache[targetIndex] = zone;
        this.zoneCacheIndex.set(zone.zoneId, targetIndex);
    }

    /**
     * Get zone from high-performance cache with O(1) lookup
     */
    private getZoneFromCache(zoneId: string): ZoneSnapshot | undefined {
        const index = this.zoneCacheIndex.get(zoneId);

        // DEBUG: Log zone lookup details
        this.logger.debug("[OrderflowPreprocessor] Zone lookup debug", {
            zoneId,
            indexFound: index !== undefined,
            index,
            zoneExists:
                index !== undefined ? this.zoneCache[index] !== null : false,
            cacheSize: this.zoneCacheIndex.size,
        });

        if (index !== undefined && this.zoneCache[index]) {
            const zone = this.zoneCache[index];
            const currentTime = Date.now();
            const age = currentTime - (zone.lastUpdate || 0);

            // DEBUG: Log age validation details
            this.logger.debug("[OrderflowPreprocessor] Zone age validation", {
                zoneId,
                age,
                maxAge: this.maxZoneCacheAge,
                isValid: age <= this.maxZoneCacheAge,
                aggressiveVolume: zone.aggressiveVolume,
            });

            // Check if zone is still valid (not expired)
            if (zone.lastUpdate && age <= this.maxZoneCacheAge) {
                return zone;
            } else {
                // Remove expired zone
                this.logger.debug(
                    "[OrderflowPreprocessor] Zone expired - removing",
                    {
                        zoneId,
                        age,
                        maxAge: this.maxZoneCacheAge,
                    }
                );
                this.zoneCacheIndex.delete(zoneId);
                this.zoneCache[index] = null;
            }
        }
        return undefined;
    }

    /**
     * Aggregate trade data into standardized zones
     *
     * CLAUDE.md COMPLIANCE:
     * - Uses FinancialMath for all price/volume calculations
     * - No magic numbers - all thresholds configurable
     * - Returns null when calculation cannot be performed
     * - Proper error handling with try-catch
     */
    private aggregateTradeIntoZones(trade: EnrichedTradeEvent): void {
        try {
            // DEBUG: Log entry into trade aggregation
            this.logger.debug(
                "[OrderflowPreprocessor] TRADE AGGREGATION STARTED",
                {
                    price: trade.price,
                    quantity: trade.quantity,
                    buyerIsMaker: trade.buyerIsMaker,
                    timestamp: trade.timestamp,
                }
            );

            if (!this.standardZoneConfig) {
                this.logger.debug(
                    "[OrderflowPreprocessor] TRADE AGGREGATION SKIPPED - No standard zone config"
                );
                return;
            }

            const { price, timestamp } = trade;

            // CLAUDE.md SIMPLIFIED: Process single zone size (no more triple-counting!)
            const zoneTicks = this.standardZoneConfig.zoneTicks;

            this.logger.debug(
                "[OrderflowPreprocessor] TRADE AGGREGATION - Processing single zone size",
                {
                    zoneTicks,
                    tradePrice: price,
                }
            );

            // Calculate which zone this trade belongs to using FinancialMath
            const lowerBoundary = FinancialMath.calculateZone(
                price,
                zoneTicks,
                this.pricePrecision
            );

            this.logger.debug(
                "[OrderflowPreprocessor] TRADE AGGREGATION - Zone lower boundary calculated",
                {
                    price,
                    zoneTicks,
                    lowerBoundary,
                    pricePrecision: this.pricePrecision,
                }
            );

            if (lowerBoundary === null) {
                this.logger.warn(
                    "[OrderflowPreprocessor] Failed to calculate zone lower boundary for trade aggregation",
                    {
                        price,
                        zoneTicks,
                        pricePrecision: this.pricePrecision,
                    }
                );
                return;
            }

            // Generate zone ID for cache lookup
            const zoneId = `${this.symbol}_${zoneTicks}T_${lowerBoundary.toFixed(this.pricePrecision)}`;

            this.logger.debug(
                "[OrderflowPreprocessor] TRADE AGGREGATION - Zone ID generated",
                {
                    zoneId,
                    symbol: this.symbol,
                    zoneTicks,
                    lowerBoundary: lowerBoundary.toFixed(this.pricePrecision),
                }
            );

            // Get existing zone from cache or create new one
            let zone = this.getZoneFromCache(zoneId);

            this.logger.debug(
                "[OrderflowPreprocessor] TRADE AGGREGATION - Zone lookup completed",
                {
                    zoneId,
                    zoneFound: !!zone,
                    existingVolume: zone?.aggressiveVolume || 0,
                    existingTradeCount: zone?.tradeCount || 0,
                }
            );

            // NOTE: Duplicate debug log removed - already logged above

            if (!zone) {
                this.logger.debug(
                    "[OrderflowPreprocessor] TRADE AGGREGATION - Creating new zone",
                    { zoneId, lowerBoundary, zoneTicks }
                );
                zone = this.createZoneSnapshot(
                    lowerBoundary,
                    zoneTicks,
                    timestamp,
                    price
                );
                if (!zone) {
                    this.logger.warn(
                        "[OrderflowPreprocessor] TRADE AGGREGATION - Zone creation failed",
                        { zoneId }
                    );
                    return; // Skip if zone creation failed
                }
            }

            this.logger.debug(
                "[OrderflowPreprocessor] TRADE AGGREGATION - About to update zone with trade",
                {
                    zoneId,
                    currentVolume: zone.aggressiveVolume,
                    currentTradeCount: zone.tradeCount,
                    tradeQuantity: trade.quantity,
                }
            );

            // Update zone with trade data using FinancialMath
            const updatedZone = this.updateZoneWithTrade(zone, trade);

            this.logger.debug(
                "[OrderflowPreprocessor] TRADE AGGREGATION - Zone update result",
                {
                    zoneId,
                    updateSuccessful: !!updatedZone,
                    oldVolume: zone.aggressiveVolume,
                    newVolume: updatedZone?.aggressiveVolume,
                    oldTradeCount: zone.tradeCount,
                    newTradeCount: updatedZone?.tradeCount,
                }
            );

            if (updatedZone) {
                // Update cache with aggregated data
                this.addZoneToCache(updatedZone);
                this.logger.debug(
                    "[OrderflowPreprocessor] TRADE AGGREGATION - Zone cached successfully",
                    { zoneId, finalVolume: updatedZone.aggressiveVolume }
                );
            }

            // NOTE: Zone data is populated AFTER aggregation in main handler
            // Do not populate zone data here to avoid overriding aggregated data

            // Emit metrics for monitoring
            this.metricsCollector.incrementCounter(
                "zone_trade_aggregations_total",
                1
            );

            // Log zone data population for troubleshooting
            if (trade.zoneData) {
                this.metricsCollector.incrementCounter(
                    "zone_data_populated_total",
                    1
                );

                this.logger.debug(
                    "[OrderflowPreprocessor] Zone data populated for detectors (single zone)",
                    {
                        price,
                        zonesCount: trade.zoneData.zones.length,
                        sampleZone: trade.zoneData.zones[0]
                            ? {
                                  priceLevel:
                                      trade.zoneData.zones[0].priceLevel,
                                  aggressiveVolume:
                                      trade.zoneData.zones[0].aggressiveVolume,
                                  tradeCount:
                                      trade.zoneData.zones[0].tradeCount,
                              }
                            : null,
                    }
                );
            } else {
                this.metricsCollector.incrementCounter(
                    "zone_data_population_failed_total",
                    1
                );
                this.logger.warn(
                    "[OrderflowPreprocessor] Failed to populate zone data for CVD detectors",
                    { price }
                );
            }
        } catch (error) {
            this.logger.error(
                "[OrderflowPreprocessor] Error aggregating trade into zones",
                {
                    error:
                        error instanceof Error ? error.message : String(error),
                    tradePrice: trade.price,
                    tradeQuantity: trade.quantity,
                    timestamp: trade.timestamp,
                }
            );
            this.metricsCollector.incrementCounter(
                "zone_aggregation_errors_total",
                1
            );
        }
    }

    /**
     * Update zone snapshot with new trade data
     *
     * CLAUDE.md COMPLIANCE:
     * - Uses FinancialMath for all calculations
     * - Returns null when update cannot be performed
     * - No magic numbers
     */
    private updateZoneWithTrade(
        zone: ZoneSnapshot,
        trade: EnrichedTradeEvent
    ): ZoneSnapshot | null {
        try {
            const { price, quantity, buyerIsMaker, timestamp } = trade;

            // ENHANCED DEBUG: Log boundary check details for zero volume diagnosis
            const withinBoundaries =
                price >= zone.boundaries.min && price <= zone.boundaries.max;

            this.logger.debug(
                "[OrderflowPreprocessor] Zone update boundary check",
                {
                    zoneId: zone.zoneId,
                    zoneCenter: zone.priceLevel,
                    zoneBoundaries: zone.boundaries,
                    tradePrice: price,
                    tradeQuantity: quantity,
                    withinBoundaries,
                    currentAggressiveVolume: zone.aggressiveVolume,
                    currentTradeCount: zone.tradeCount,
                }
            );

            // Check if trade falls within zone boundaries
            if (!withinBoundaries) {
                this.logger.debug(
                    "[OrderflowPreprocessor] Trade rejected - outside zone boundaries",
                    {
                        zoneId: zone.zoneId,
                        tradePrice: price,
                        minBoundary: zone.boundaries.min,
                        maxBoundary: zone.boundaries.max,
                        belowMin: price < zone.boundaries.min,
                        aboveMax: price > zone.boundaries.max,
                    }
                );
                return null; // Trade outside zone boundaries
            }

            // 🔄 CRITICAL FIX: Calculate time-windowed volumes from tradeHistory instead of cumulative
            // Add current trade to history first
            const currentTradeRecord: ZoneTradeRecord = {
                price,
                quantity,
                timestamp,
                tradeId: trade.tradeId,
                buyerIsMaker,
            };
            zone.tradeHistory.add(currentTradeRecord);

            // Calculate volumes from trades within active time window
            const timeWindowMs = zone.timespan; // Use zone's configured time window
            const cutoffTime = timestamp - timeWindowMs;

            let newAggressiveVolume = 0;
            let newBuyVolume = 0;
            let newSellVolume = 0;
            let newTradeCount = 0;

            // Sum volumes from all trades within time window
            for (const tradeRecord of zone.tradeHistory.getAll()) {
                if (tradeRecord.timestamp >= cutoffTime) {
                    newAggressiveVolume = FinancialMath.safeAdd(
                        newAggressiveVolume,
                        tradeRecord.quantity
                    );
                    newTradeCount++;

                    if (tradeRecord.buyerIsMaker) {
                        // Buyer is maker = sell side trade
                        newSellVolume = FinancialMath.safeAdd(
                            newSellVolume,
                            tradeRecord.quantity
                        );
                    } else {
                        // Buyer is taker = buy side trade
                        newBuyVolume = FinancialMath.safeAdd(
                            newBuyVolume,
                            tradeRecord.quantity
                        );
                    }
                }
            }

            // Note: Trade already added to history above for time-windowed calculation

            // Calculate live VWAP from individual trades with time-based expiration
            const newVolumeWeightedPrice = this.calculateLiveVWAP(
                zone,
                timestamp
            );

            // ENHANCED DEBUG: Log successful zone update
            const updatedZone = {
                ...zone,
                aggressiveVolume: newAggressiveVolume,
                aggressiveBuyVolume: newBuyVolume,
                aggressiveSellVolume: newSellVolume,
                tradeCount: newTradeCount,
                volumeWeightedPrice: newVolumeWeightedPrice,
                lastUpdate: timestamp,
            };

            this.logger.debug(
                "[OrderflowPreprocessor] Zone successfully updated with trade",
                {
                    zoneId: zone.zoneId,
                    oldAggressiveVolume: zone.aggressiveVolume,
                    newAggressiveVolume: newAggressiveVolume,
                    addedVolume: quantity,
                    oldTradeCount: zone.tradeCount,
                    newTradeCount: newTradeCount,
                    tradeDirection: buyerIsMaker ? "sell" : "buy",
                    oldBuyVolume: zone.aggressiveBuyVolume,
                    newBuyVolume: newBuyVolume,
                    oldSellVolume: zone.aggressiveSellVolume,
                    newSellVolume: newSellVolume,
                }
            );

            // Return updated zone snapshot
            return updatedZone;
        } catch (error) {
            this.logger.error(
                "[OrderflowPreprocessor] Error updating zone with trade",
                {
                    error:
                        error instanceof Error ? error.message : String(error),
                    zoneId: zone.zoneId,
                    tradePrice: trade.price,
                    tradeQuantity: trade.quantity,
                }
            );
            return null;
        }
    }

    /**
     * Calculate live volume-weighted average price from zone trade history
     * Only includes trades within the zone's timespan for accurate current market conditions
     *
     * CLAUDE.md COMPLIANCE:
     * - Returns null when no valid trades exist
     * - Uses FinancialMath for precise calculations
     * - Time-based expiration prevents stale data
     */
    private calculateLiveVWAP(
        zone: ZoneSnapshot,
        currentTime: number
    ): number | null {
        if (!zone.tradeHistory || zone.tradeHistory.length === 0) {
            return null;
        }

        // Filter to trades within the zone's timespan using CircularBuffer's efficient filter
        const validTrades = zone.tradeHistory.filter(
            (trade) => currentTime - trade.timestamp <= zone.timespan
        );

        if (validTrades.length === 0) {
            return null;
        }

        // Calculate total volume and volume-weighted sum using FinancialMath
        let totalVolume = 0;
        let volumeWeightedSum = 0;

        for (const trade of validTrades) {
            totalVolume = FinancialMath.safeAdd(totalVolume, trade.quantity);
            volumeWeightedSum = FinancialMath.safeAdd(
                volumeWeightedSum,
                FinancialMath.safeMultiply(trade.price, trade.quantity)
            );
        }

        return totalVolume > 0
            ? FinancialMath.safeDivide(volumeWeightedSum, totalVolume)
            : null;
    }

    /**
     * Get current zone data for all zone sizes near the specified price
     * Returns StandardZoneData with populated zone arrays for CVD detectors
     *
     * CLAUDE.md COMPLIANCE:
     * - Uses FinancialMath for all calculations
     * - Returns null when data cannot be retrieved
     * - No magic numbers - configurable search range
     */
    private getCurrentZoneData(
        price: number,
        timestamp: number
    ): StandardZoneData | undefined {
        try {
            if (!this.standardZoneConfig) {
                return undefined;
            }

            // CLAUDE.md SIMPLIFIED: Single zone calculation (no more triple-counting!)
            const zones: ZoneSnapshot[] = [];
            const adaptiveZones: ZoneSnapshot[] = [];

            // DEBUG: Log zone retrieval details
            this.logger.debug(
                "[OrderflowPreprocessor] Zone retrieval from cache (single zone)",
                {
                    searchPrice: price,
                    cacheSize: this.zoneCacheIndex.size,
                    zoneTicks: this.standardZoneConfig.zoneTicks,
                }
            );

            // Collect zones for the single configured zone size
            const zoneTicks = this.standardZoneConfig.zoneTicks;
            const zonesForSize: ZoneSnapshot[] = [];

            // Use proper zone lookup to get updated zones with accumulated volume
            let zonesFound = 0;
            for (let i = 0; i < this.zoneCacheSize; i++) {
                const cachedZone = this.zoneCache[i];
                if (cachedZone && cachedZone.zoneId.includes(`${zoneTicks}T`)) {
                    zonesFound++;
                    // Include ALL zones for complete analysis (no price filtering)
                    // Use getZoneFromCache to ensure we get the most recent version
                    const currentZone = this.getZoneFromCache(
                        cachedZone.zoneId
                    );
                    if (currentZone) {
                        zonesForSize.push(currentZone);
                    }
                }
            }

            // DEBUG: Log zone collection results
            this.logger.debug(
                "[OrderflowPreprocessor] Zone collection (single zone)",
                {
                    zoneTicks,
                    zonesFoundInCache: zonesFound,
                    zonesInRange: zonesForSize.length,
                    searchPrice: price,
                }
            );

            // Sort zones by price level for consistent ordering
            zonesForSize.sort((a, b) => a.priceLevel - b.priceLevel);
            zones.push(...zonesForSize);

            // Handle adaptive zones if enabled
            if (this.standardZoneConfig.adaptiveMode) {
                // Add adaptive zone calculation here if needed
                // For now, keep adaptive zones empty for simplicity
            }

            // Return populated StandardZoneData with single zone array
            return {
                zones,
                adaptiveZones:
                    adaptiveZones.length > 0 ? adaptiveZones : undefined,
                zoneConfig: {
                    zoneTicks: this.standardZoneConfig.zoneTicks,
                    tickValue: this.tickSize,
                    timeWindow: Math.max(
                        ...this.standardZoneConfig.timeWindows
                    ),
                },
            };
        } catch (error) {
            this.logger.error(
                "[OrderflowPreprocessor] Error collecting current zone data",
                {
                    error:
                        error instanceof Error ? error.message : String(error),
                    price,
                    timestamp,
                }
            );
            return undefined;
        }
    }
}
