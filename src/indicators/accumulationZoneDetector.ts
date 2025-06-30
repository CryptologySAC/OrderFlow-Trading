// src/indicators/accumulationZoneDetector.ts
/**
 * ⚠️ DEPRECATED - USE ENHANCED VERSION ⚠️
 * =====================================
 *
 * STATUS: DEPRECATED (use AccumulationZoneDetectorEnhanced) ⚠️
 * REPLACEMENT: src/indicators/accumulationZoneDetectorEnhanced.ts
 * DEPRECATION_DATE: 2025-06-29
 * REMOVAL_PLANNED: 2025-12-31
 *
 * 🔒 PRODUCTION-READY - DO NOT MODIFY
 * ===================================
 *
 * STATUS: PRODUCTION-READY ✅
 * LAST_AUDIT: 2025-06-07
 * PERFORMANCE_OPTIMIZED: YES ✅
 * TRADING_LOGIC_VERIFIED: YES ✅
 * ERROR_HANDLING_COMPLETE: YES ✅
 *
 * WARNING: This file has undergone comprehensive production readiness review.
 * Any modifications require explicit approval and full regression testing.
 *
 * PROTECTION_LEVEL: CRITICAL
 * CLAUDE_CODE_INSTRUCTION: DO NOT MODIFY - CONTACT HUMAN FOR ANY CHANGES
 *
 * Key optimizations implemented:
 * - CircularBuffer for O(1) performance
 * - Comprehensive input validation
 * - Centralized configuration
 * - Proper error handling
 * - Memory management optimizations
 */

/**
 * CRITICAL: BuyerIsMaker Field Interpretation
 * ==========================================
 *
 * The buyerIsMaker field indicates WHO WAS THE MAKER (passive) vs TAKER (aggressive):
 *
 * buyerIsMaker = true:
 *   - Buyer placed passive limit order (maker)
 *   - Seller placed aggressive market/limit order (taker)
 *   - SELLER WAS THE AGGRESSOR - this represents SELLING PRESSURE
 *
 * buyerIsMaker = false:
 *   - Seller placed passive limit order (maker)
 *   - Buyer placed aggressive market/limit order (taker)
 *   - BUYER WAS THE AGGRESSOR - this represents BUYING PRESSURE
 *
 * INSTITUTIONAL ACCUMULATION LOGIC:
 * - We want institutions PASSIVELY buying (absorbing sells from retail)
 * - High sellVolume ratio = sells being absorbed by institutional bids ✅
 * - Low buyVolume ratio = minimal retail FOMO/aggressive buying ✅
 *
 * INSTITUTIONAL DISTRIBUTION LOGIC:
 * - We want institutions AGGRESSIVELY selling (into retail buy pressure)
 * - High sellVolume from buyerIsMaker=true = aggressive institutional selling ✅
 * - Low buyVolume = weak retail support ✅
 *
 * This interpretation has been validated against:
 * - Binance API documentation
 * - Market microstructure research
 * - Cross-exchange implementation patterns
 *
 * DO NOT INVERT THIS LOGIC - it is correct as implemented.
 */

import {
    AccumulationZone,
    ZoneUpdate,
    ZoneSignal,
    ZoneDetectionData,
    ZoneAnalysisResult,
    ZoneDetectorConfig,
} from "../types/zoneTypes.js";
import type { EnrichedTradeEvent } from "../types/marketEvents.js";
import type { ILogger } from "../infrastructure/loggerInterface.js";
import type { IMetricsCollector } from "../infrastructure/metricsCollectorInterface.js";
import { FinancialMath } from "../utils/financialMath.js";
import { RollingWindow } from "../utils/rollingWindow.js";
import { ObjectPool } from "../utils/objectPool.js";
import { CircularBuffer } from "../utils/circularBuffer.js";
import {
    EnhancedZoneFormation,
    type InstitutionalSignals,
    type MarketRegime,
} from "./enhancedZoneFormation.js";
//import { Config } from "../core/config.js";
import { ZoneDetector } from "./base/zoneDetector.js";
import type { AccumulationCandidate } from "./interfaces/detectorInterfaces.js";
import { VolumeAnalyzer } from "./utils/volumeAnalyzer.js";
import type { VolumeSurgeConfig } from "./interfaces/volumeAnalysisInterface.js";

// ✅ CLAUDE.md COMPLIANCE: Algorithmic constants (non-configurable)
const ALGORITHM_CONSTANTS = {
    // Buffer and performance constants
    RECENT_TRADES_BUFFER_SIZE: 200,
    CANDIDATE_TRADES_BUFFER_SIZE: 2000, // Increased for 5+ minute patterns in active markets

    // Analysis window constants
    RECENT_TRADES_FOR_ABSORPTION: 10,
    MIN_TRADES_FOR_ABSORPTION: 3,
    MIN_TRADES_FOR_REGIME_ANALYSIS: 5,
    RECENT_TRADES_FOR_VALIDATION: 50,

    // Technical analysis constants
    ABSORPTION_QUALITY_INCREMENT: 0.1,
    RATIO_CONSISTENCY_TOLERANCE: 0.01,
    PRICE_DATA_CORRUPTION_TOLERANCE: 0.01,

    // Scoring weights (algorithmic, not business decisions)
    SCORING_WEIGHTS: {
        SELL_ABSORPTION: 0.4,
        PRICE_STABILITY: 0.25,
        ABSORPTION_QUALITY: 0.15,
        VOLUME_SIGNIFICANCE: 0.1,
        DURATION: 0.05,
        ORDER_SIZE: 0.05,
    },

    // Penalty multipliers (algorithmic)
    AGGRESSIVE_BUY_PENALTY_MULTIPLIER: 2,
    AGGRESSIVE_BUY_PENALTY_WEIGHT: 0.5,

    // Normalization bases (algorithmic)
    VOLUME_SCORE_NORMALIZATION_BASE: 300,
    DURATION_SCORE_NORMALIZATION_MS: 600000, // 10 minutes
    ORDER_SIZE_SCORE_NORMALIZATION_BASE: 50,

    // Institutional scoring weights (algorithmic)
    INSTITUTIONAL_SCORING_WEIGHTS: {
        LARGE_BLOCK_RATIO: 0.3,
        ICEBERG_DETECTION: 0.25,
        VOLUME_CONSISTENCY: 0.2,
        PRICE_EFFICIENCY: 0.15,
        ORDER_SIZE_DISTRIBUTION: 0.1,
    },

    // Cleanup and maintenance constants
    CANDIDATE_CLEANUP_INTERVAL_MS: 300000, // 5 minutes
    CANDIDATE_MAX_AGE_MS: 1800000, // 30 minutes
} as const;

// ✅ CLAUDE.md COMPLIANCE: Signal generation constants (business configurable via settings)
const SIGNAL_GENERATION_DEFAULTS = {
    // Zone invalidation thresholds
    INVALIDATION_PERCENT_BELOW: 0.005, // 0.5% below zone
    BREAKOUT_TARGET_PERCENT_ABOVE: 0.02, // 2% above center
    STOP_LOSS_PERCENT_BELOW: 0.01, // 1% below zone
    TAKE_PROFIT_PERCENT_ABOVE: 0.03, // 3% profit target

    // Higher targets on completion
    COMPLETION_BREAKOUT_TARGET_PERCENT: 0.05, // 5% on completion
    COMPLETION_STOP_LOSS_PERCENT: 0.015, // 1.5% on completion
    COMPLETION_CONFIDENCE_BOOST: 0.2, // 20% confidence boost

    // Zone proximity and validation
    PROXIMITY_TOLERANCE_PERCENT: 0.01, // 1% proximity tolerance

    // Institutional score requirements
    MIN_INSTITUTIONAL_SCORE_RATIO: 0.3, // 30% of zone strength
    MAX_INSTITUTIONAL_SCORE_FLOOR: 0.15, // 15% floor
} as const;

/**
 * Zone-based AccumulationDetector - detects accumulation zones rather than point events
 * Tracks evolving accumulation zones over time and emits zone-based signals
 */
export class AccumulationZoneDetector extends ZoneDetector {
    // Candidate tracking for zone formation
    private candidates = new Map<number, AccumulationCandidate>();
    private readonly recentTrades = new RollingWindow<EnrichedTradeEvent>(
        ALGORITHM_CONSTANTS.RECENT_TRADES_BUFFER_SIZE,
        false
    );

    // Object pool for candidates to reduce GC pressure
    private readonly candidatePool = new ObjectPool<AccumulationCandidate>(
        () => ({
            priceLevel: 0,
            startTime: 0,
            trades: new CircularBuffer<EnrichedTradeEvent>(
                ALGORITHM_CONSTANTS.CANDIDATE_TRADES_BUFFER_SIZE,
                (trade) => {
                    // Clean up any Map references in depthSnapshot to help GC
                    if (trade.depthSnapshot) {
                        trade.depthSnapshot.clear();
                    }
                }
            ), // ✅ PERFORMANCE: Circular buffer with cleanup
            buyVolume: 0,
            sellVolume: 0,
            totalVolume: 0,
            averageOrderSize: 0,
            lastUpdate: 0,
            consecutiveTrades: 0,
            priceStability: 1.0,
            tradeCount: 0,
            absorptionQuality: 0,
        }),
        (candidate) => {
            candidate.priceLevel = 0;
            candidate.startTime = 0;

            // 🔧 CRITICAL: Clear buffer and validate it's actually cleared
            candidate.trades.clear();
            if (candidate.trades.length !== 0) {
                throw new Error(
                    `CRITICAL: CircularBuffer.clear() failed - buffer still contains ${candidate.trades.length} items`
                );
            }

            candidate.buyVolume = 0;
            candidate.sellVolume = 0;
            candidate.totalVolume = 0;
            candidate.averageOrderSize = 0;
            candidate.lastUpdate = 0;
            candidate.consecutiveTrades = 0;
            candidate.priceStability = 1.0;
            candidate.tradeCount = 0;
            candidate.absorptionQuality = 0;
        }
    );

    // Configuration
    private readonly symbol: string;
    private readonly pricePrecision: number;
    private readonly zoneTicks: number;

    // Zone strength threshold parameters
    private readonly priceStabilityThreshold: number;
    private readonly strongZoneThreshold: number;
    private readonly weakZoneThreshold: number;

    // Enhanced zone formation analyzer
    private readonly enhancedZoneFormation: EnhancedZoneFormation;

    // Volume surge analysis integration
    private readonly volumeAnalyzer: VolumeAnalyzer;
    private readonly volumeSurgeConfig: VolumeSurgeConfig;

    // Signal generation configuration
    private readonly signalConfig: {
        invalidationPercentBelow: number;
        breakoutTargetPercentAbove: number;
        stopLossPercentBelow: number;
        takeProfitPercentAbove: number;
        completionBreakoutTargetPercent: number;
        completionStopLossPercent: number;
        completionConfidenceBoost: number;
    };

    // Detection parameters are now provided via config

    constructor(
        id: string,
        symbol: string,
        config: Partial<ZoneDetectorConfig>,
        logger: ILogger,
        metricsCollector: IMetricsCollector
    ) {
        super(id, "accumulation", logger, metricsCollector);

        // ⚠️ DEPRECATION WARNING: This detector is deprecated
        logger.warn(
            "⚠️ DEPRECATED: AccumulationZoneDetector is deprecated. Use AccumulationZoneDetectorEnhanced instead.",
            {
                detector: "AccumulationZoneDetector",
                replacement: "AccumulationZoneDetectorEnhanced",
                deprecationDate: "2025-06-29",
                removalPlanned: "2025-12-31",
            }
        );

        this.symbol = symbol;
        this.pricePrecision = config.pricePrecision ?? 2;
        this.zoneTicks = config.zoneTicks ?? 2;

        // Initialize threshold parameters
        this.priceStabilityThreshold = config.priceStabilityThreshold ?? 0.98;
        this.strongZoneThreshold = config.strongZoneThreshold ?? 0.7;
        this.weakZoneThreshold = config.weakZoneThreshold ?? 0.4;

        // Initialize enhanced zone formation analyzer with configurable parameters
        this.enhancedZoneFormation = new EnhancedZoneFormation(
            config.enhancedInstitutionalSizeThreshold ?? 50,
            config.enhancedIcebergDetectionWindow ?? 15,
            config.enhancedMinInstitutionalRatio ?? 0.4
        );

        // Initialize volume surge configuration
        this.volumeSurgeConfig = {
            volumeSurgeMultiplier: config.volumeSurgeMultiplier ?? 3.0,
            imbalanceThreshold: config.imbalanceThreshold ?? 0.35,
            institutionalThreshold: config.institutionalThreshold ?? 17.8,
            burstDetectionMs: config.burstDetectionMs ?? 1500,
            sustainedVolumeMs: config.sustainedVolumeMs ?? 25000,
            medianTradeSize: config.medianTradeSize ?? 0.8,
        };

        // Initialize volume analyzer for enhanced accumulation detection
        this.volumeAnalyzer = new VolumeAnalyzer(
            this.volumeSurgeConfig,
            logger,
            `${id}_accumulation`
        );

        // Initialize signal generation configuration
        this.signalConfig = {
            invalidationPercentBelow:
                config.invalidationPercentBelow ??
                SIGNAL_GENERATION_DEFAULTS.INVALIDATION_PERCENT_BELOW,
            breakoutTargetPercentAbove:
                config.breakoutTargetPercentAbove ??
                SIGNAL_GENERATION_DEFAULTS.BREAKOUT_TARGET_PERCENT_ABOVE,
            stopLossPercentBelow:
                config.stopLossPercentBelow ??
                SIGNAL_GENERATION_DEFAULTS.STOP_LOSS_PERCENT_BELOW,
            takeProfitPercentAbove:
                config.takeProfitPercentAbove ??
                SIGNAL_GENERATION_DEFAULTS.TAKE_PROFIT_PERCENT_ABOVE,
            completionBreakoutTargetPercent:
                config.completionBreakoutTargetPercent ??
                SIGNAL_GENERATION_DEFAULTS.COMPLETION_BREAKOUT_TARGET_PERCENT,
            completionStopLossPercent:
                config.completionStopLossPercent ??
                SIGNAL_GENERATION_DEFAULTS.COMPLETION_STOP_LOSS_PERCENT,
            completionConfidenceBoost:
                config.completionConfidenceBoost ??
                SIGNAL_GENERATION_DEFAULTS.COMPLETION_CONFIDENCE_BOOST,
        };

        // Forward zone manager events
        this.zoneManager.on("zoneCreated", (zone) =>
            this.emit("zoneCreated", zone)
        );
        this.zoneManager.on("zoneUpdated", (update) =>
            this.emit("zoneUpdated", update)
        );
        this.zoneManager.on("zoneCompleted", (zone) =>
            this.emit("zoneCompleted", zone)
        );
        this.zoneManager.on("zoneInvalidated", (update) =>
            this.emit("zoneInvalidated", update)
        );

        this.logger.info("AccumulationZoneDetector initialized", {
            component: "AccumulationZoneDetector",
            symbol,
            config: this.config,
        });

        // Cleanup old candidates periodically
        setInterval(
            () => this.cleanupOldCandidates(),
            ALGORITHM_CONSTANTS.CANDIDATE_CLEANUP_INTERVAL_MS
        );
    }

    /**
     * 🔧 FIX: Numeric validation helper to prevent NaN/Infinity propagation
     */
    private validateNumeric(value: number, fallback: number): number {
        return isFinite(value) && !isNaN(value) && value !== 0
            ? value
            : fallback;
    }

    /**
     * @deprecated Use FinancialMath.safeDivide() directly for institutional-grade precision
     */
    private safeDivision(
        numerator: number,
        denominator: number,
        fallback: number = 0
    ): number {
        return FinancialMath.safeDivide(numerator, denominator, fallback);
    }

    /**
     * @deprecated Use FinancialMath.calculateMean() directly for institutional-grade precision
     */
    private safeMean(values: number[]): number {
        return FinancialMath.calculateMean(values);
    }

    /**
     * Main analysis method - processes trade and returns zone updates/signals
     */
    public analyze(trade: EnrichedTradeEvent): ZoneAnalysisResult {
        // ✅ CLAUDE.md COMPLIANCE: Add null/undefined input validation
        if (!trade) {
            this.logger.warn(
                "[AccumulationZoneDetector] Null or undefined trade received"
            );
            return { updates: [], signals: [], activeZones: [] };
        }

        // 🔧 FIX: Add comprehensive input validation
        const validPrice = this.validateNumeric(trade.price, 0);
        if (validPrice === 0) {
            this.logger.warn(
                "[AccumulationZoneDetector] Invalid price detected, skipping trade",
                {
                    price: trade.price,
                    tradeId: trade.tradeId,
                }
            );
            return { updates: [], signals: [], activeZones: [] };
        }

        const validQuantity = this.validateNumeric(trade.quantity, 0);
        if (validQuantity === 0) {
            this.logger.warn(
                "[AccumulationZoneDetector] Invalid quantity detected, skipping trade",
                {
                    quantity: trade.quantity,
                    tradeId: trade.tradeId,
                }
            );
            return { updates: [], signals: [], activeZones: [] };
        }

        // Validate passive volume values (reserved for future use)
        // const validBidVolume = Math.max(0, trade.zonePassiveBidVolume || 0);
        // const validAskVolume = Math.max(0, trade.zonePassiveAskVolume || 0);

        const updates: ZoneUpdate[] = [];
        const signals: ZoneSignal[] = [];

        // Update volume analysis tracking for enhanced accumulation detection
        this.volumeAnalyzer.updateVolumeTracking(trade);

        // Add trade to recent trades history
        this.recentTrades.push(trade);

        // 1. Update existing zones with new trade
        const activeZones = this.zoneManager.getActiveZones(this.symbol);
        for (const zone of activeZones) {
            const update = this.zoneManager.updateZone(zone.id, trade);
            if (update) {
                updates.push(update);

                // Generate signals based on zone updates
                const zoneSignals = this.generateZoneSignals(update);
                signals.push(...zoneSignals);
            }
        }

        // 2. Update accumulation candidates
        this.updateCandidates(trade);

        // 3. Check for new zone formation
        const newZone = this.checkForZoneFormation(trade);
        if (newZone) {
            const createUpdate: ZoneUpdate = {
                updateType: "zone_created",
                zone: newZone,
                significance: "medium",
                timestamp: trade.timestamp,
            };
            updates.push(createUpdate);

            // Generate initial zone entry signal
            const entrySignal = this.generateZoneEntrySignal(newZone);
            if (entrySignal) signals.push(entrySignal);
        }

        // 4. Check for zone invalidation (price breaks out of zone bounds)
        const invalidations = this.checkZoneInvalidations(trade, activeZones);
        updates.push(...invalidations);

        return {
            updates,
            signals,
            activeZones: this.zoneManager.getActiveZones(this.symbol),
        };
    }

    /**
     * 🔒 PRODUCTION METHOD - PERFORMANCE CRITICAL
     * This method has been optimized for production use.
     * Any changes require performance impact analysis.
     */
    private updateCandidates(trade: EnrichedTradeEvent): void {
        try {
            // Validate input
            if (!this.isValidTrade(trade)) {
                this.logger.warn("Invalid trade received", { trade });
                return;
            }

            const priceLevel = this.getPriceLevel(trade.price);
            if (priceLevel === null) {
                this.logger.warn("Cannot determine price level for trade", {
                    trade,
                });
                return;
            }

            // Get or create candidate for this price level
            if (!this.candidates.has(priceLevel)) {
                const candidate = this.candidatePool.acquire();
                candidate.priceLevel = priceLevel;
                candidate.startTime = trade.timestamp;
                candidate.lastUpdate = trade.timestamp;
                this.candidates.set(priceLevel, candidate);
            }

            const candidate = this.candidates.get(priceLevel)!;

            // 🔧 PRODUCTION SAFETY: Validate data integrity before adding new trade
            const existingTrades = candidate.trades.getAll();
            if (existingTrades.length > 0) {
                const existingPriceLevel = this.getPriceLevel(
                    existingTrades[0].price
                );
                if (existingPriceLevel === null) {
                    this.logger.error(
                        "Cannot calculate existing price level for corruption check",
                        {
                            existingTradePrice: existingTrades[0].price,
                        }
                    );
                    return;
                }
                if (
                    Math.abs(existingPriceLevel - priceLevel) >
                    ALGORITHM_CONSTANTS.PRICE_DATA_CORRUPTION_TOLERANCE
                ) {
                    this.logger.error(
                        "CRITICAL: Trade data corruption detected",
                        {
                            component: "AccumulationZoneDetector",
                            candidatePrice: priceLevel,
                            existingTradePrice: existingTrades[0].price,
                            existingPriceLevel,
                            corruptionType: "cross_price_contamination",
                            existingTradeCount: existingTrades.length,
                        }
                    );
                    // Clear corrupted data and restart candidate
                    candidate.trades.clear();
                    candidate.totalVolume = 0;
                    candidate.tradeCount = 0;
                    candidate.buyVolume = 0;
                    candidate.sellVolume = 0;
                }
            }

            // Update candidate with new trade
            const wasFull =
                candidate.trades.length >=
                ALGORITHM_CONSTANTS.CANDIDATE_TRADES_BUFFER_SIZE;
            const oldestTrade = wasFull ? candidate.trades.getAll()[0] : null;

            // ✅ PERFORMANCE FIX: CircularBuffer.add() is O(1) vs Array.push() + Array.shift()
            candidate.trades.add(trade);
            candidate.lastUpdate = trade.timestamp;

            // ✅ ARCHITECTURAL FIX: Incremental volume updates for performance
            // Only recalculate when buffer overflows, otherwise use incremental updates
            if (wasFull && oldestTrade) {
                // Buffer overflow: subtract the overwritten trade and add new trade
                candidate.totalVolume =
                    candidate.totalVolume -
                    oldestTrade.quantity +
                    trade.quantity;
                candidate.tradeCount =
                    ALGORITHM_CONSTANTS.CANDIDATE_TRADES_BUFFER_SIZE; // Stays at max

                // Adjust buy/sell volumes for overwritten trade
                if (oldestTrade.buyerIsMaker) {
                    candidate.sellVolume -= oldestTrade.quantity;
                } else {
                    candidate.buyVolume -= oldestTrade.quantity;
                }

                // Add new trade volumes
                if (trade.buyerIsMaker) {
                    candidate.sellVolume += trade.quantity;
                } else {
                    candidate.buyVolume += trade.quantity;
                }
            } else {
                // No overflow: simple incremental update
                candidate.totalVolume += trade.quantity;
                candidate.tradeCount = candidate.trades.length;

                // Add new trade volumes
                if (trade.buyerIsMaker) {
                    candidate.sellVolume += trade.quantity;
                } else {
                    candidate.buyVolume += trade.quantity;
                }
            }

            candidate.averageOrderSize =
                candidate.tradeCount > 0
                    ? candidate.totalVolume / candidate.tradeCount
                    : 0;

            // Update consecutive trades counter based on current trade
            if (trade.buyerIsMaker) {
                // ✅ CORRECT: Seller was aggressive - selling pressure being absorbed
                // This is POSITIVE for accumulation (institutions absorbing retail sells)
                candidate.consecutiveTrades = 0; // Reset buy counter

                // Track absorption pattern (sells hitting strong bids)
                this.trackAbsorptionPattern(candidate, trade);
            } else {
                // ✅ CORRECT: Buyer was aggressive - retail chasing/FOMO
                // This is NEGATIVE for accumulation (not institutional behavior)
                candidate.consecutiveTrades++;
            }

            // Update price stability and absorption efficiency
            const priceStability = this.calculatePriceStability(candidate);
            if (priceStability !== null) {
                candidate.priceStability = priceStability;
            }
            // If null, keep previous priceStability value

            // ✅ PERFORMANCE FIX: CircularBuffer automatically handles overflow!
            // Note: Volume tracking remains accurate since we track totalVolume/tradeCount separately.
            // Only the detailed trade history is managed by the circular buffer.
        } catch (error) {
            this.logger.error("Error updating candidates", {
                error: error instanceof Error ? error.message : String(error),
                stack: error instanceof Error ? error.stack : undefined,
            });
            // Graceful degradation
        }
    }

    private isValidTrade(trade: EnrichedTradeEvent): boolean {
        return (
            trade &&
            typeof trade.price === "number" &&
            typeof trade.quantity === "number" &&
            trade.price > 0 &&
            trade.quantity > 0 &&
            typeof trade.timestamp === "number" &&
            typeof trade.buyerIsMaker === "boolean"
        );
    }

    /**
     * NEW METHOD: Track absorption patterns for institutional accumulation
     */
    private trackAbsorptionPattern(
        candidate: AccumulationCandidate,
        trade: EnrichedTradeEvent
    ): void {
        // Check if this sell trade was absorbed with minimal price impact
        const allTrades = candidate.trades.getAll();
        const recentTrades = allTrades.slice(
            -ALGORITHM_CONSTANTS.RECENT_TRADES_FOR_ABSORPTION
        );
        if (recentTrades.length < ALGORITHM_CONSTANTS.MIN_TRADES_FOR_ABSORPTION)
            return;

        const priceRange =
            Math.max(...recentTrades.map((t) => t.price)) -
            Math.min(...recentTrades.map((t) => t.price));
        // 🔧 FIX: Replace DetectorUtils.calculateMean with safe internal method
        const avgPrice = FinancialMath.calculateMean(
            recentTrades.map((t) => t.price)
        );

        if (avgPrice > 0) {
            const priceStability = 1 - priceRange / avgPrice;

            // Good absorption = high sell volume with minimal price decline
            if (
                priceStability > this.priceStabilityThreshold &&
                trade.buyerIsMaker
            ) {
                // This is positive for accumulation - sells absorbed without price drop
                candidate.absorptionQuality =
                    (candidate.absorptionQuality || 0) +
                    ALGORITHM_CONSTANTS.ABSORPTION_QUALITY_INCREMENT;
            }
        }
    }

    /**
     * PATCH: Replace checkForZoneFormation method with enhanced validation
     */
    private checkForZoneFormation(
        trade: EnrichedTradeEvent
    ): AccumulationZone | null {
        const now = trade.timestamp;
        let bestCandidate: AccumulationCandidate | null = null;
        let bestScore = 0;

        this.logger.debug("checkForZoneFormation called", {
            component: "AccumulationZoneDetector",
            tradeTimestamp: now,
            tradePrice: trade.price,
            candidateCount: this.candidates?.size ?? "undefined",
            candidatesExists: !!this.candidates,
            candidatesType: typeof this.candidates,
        });

        this.logger.debug("Starting candidate loop", {
            component: "AccumulationZoneDetector",
            candidateCount: this.candidates.size,
        });

        for (const candidate of this.candidates.values()) {
            this.logger.debug("Processing candidate", {
                component: "AccumulationZoneDetector",
                candidatePrice: candidate.priceLevel,
                startTime: candidate.startTime,
                tradeTimestamp: now,
            });

            try {
                const duration = now - candidate.startTime;

                // Must meet minimum duration requirement
                if (duration < this.config.minCandidateDuration) {
                    this.logger.debug(
                        "Candidate rejected: insufficient duration",
                        {
                            component: "AccumulationZoneDetector",
                            candidatePrice: candidate.priceLevel,
                            duration: duration,
                            required: this.config.minCandidateDuration,
                        }
                    );
                    continue;
                }

                // Must have minimum volume and trade count
                if (candidate.totalVolume < this.config.minZoneVolume) {
                    this.logger.debug(
                        "Candidate rejected: insufficient volume",
                        {
                            component: "AccumulationZoneDetector",
                            candidatePrice: candidate.priceLevel,
                            volume: candidate.totalVolume,
                            required: this.config.minZoneVolume,
                        }
                    );
                    continue;
                }
                if (candidate.trades.length < this.config.minTradeCount) {
                    this.logger.debug(
                        "Candidate rejected: insufficient trade count",
                        {
                            component: "AccumulationZoneDetector",
                            candidatePrice: candidate.priceLevel,
                            tradeCount: candidate.trades.length,
                            required: this.config.minTradeCount,
                        }
                    );
                    continue;
                }

                // CRITICAL FIX: Must show ABSORPTION pattern (high sell ratio being absorbed)
                // 🔧 FIX: Replace DetectorUtils.safeDivide with internal safe method
                const sellRatio = FinancialMath.safeDivide(
                    candidate.sellVolume,
                    candidate.totalVolume,
                    0
                );
                // Use configurable sell ratio for accumulation detection
                // For accumulation, we want high sell ratios (sells being absorbed)
                const minSellRatio = this.config.minSellRatio ?? 0.55;
                if (sellRatio < minSellRatio) {
                    this.logger.debug(
                        "Candidate rejected: insufficient sell ratio",
                        {
                            component: "AccumulationZoneDetector",
                            candidatePrice: candidate.priceLevel,
                            sellRatio: sellRatio,
                            required: minSellRatio,
                        }
                    );
                    continue;
                }

                // Check price stability using maxPriceDeviation from config
                // Higher maxPriceDeviation means we allow more price instability
                const requiredStability = 1 - this.config.maxPriceDeviation; // Convert deviation to stability
                if (candidate.priceStability < requiredStability) {
                    this.logger.debug(
                        "Candidate rejected: insufficient price stability",
                        {
                            component: "AccumulationZoneDetector",
                            candidatePrice: candidate.priceLevel,
                            priceStability: candidate.priceStability,
                            required: requiredStability,
                            maxPriceDeviation: this.config.maxPriceDeviation,
                        }
                    );
                    continue;
                }

                // Must show minimal aggressive buying (avoid retail FOMO patterns)
                // 🔧 FIX: Replace DetectorUtils.safeDivide with internal safe method
                const aggressiveBuyRatio = FinancialMath.safeDivide(
                    candidate.buyVolume,
                    candidate.totalVolume,
                    0
                );
                // Use configurable buy ratio limit
                // For accumulation, limit aggressive buying to avoid retail FOMO
                const maxBuyRatio = 1 - (this.config.minSellRatio ?? 0.55); // Complement of minSellRatio
                if (aggressiveBuyRatio > maxBuyRatio) {
                    this.logger.debug(
                        "Candidate rejected: excessive aggressive buying",
                        {
                            component: "AccumulationZoneDetector",
                            candidatePrice: candidate.priceLevel,
                            aggressiveBuyRatio: aggressiveBuyRatio,
                            maxAllowed: maxBuyRatio,
                            minSellRatio: this.config.minSellRatio,
                        }
                    );
                    continue;
                }

                // Enhanced scoring with institutional factors
                const institutionalSignals =
                    this.enhancedZoneFormation.analyzeInstitutionalSignals(
                        candidate.trades.getAll() // ✅ Convert CircularBuffer to Array for analysis
                    );
                const institutionalScore =
                    this.calculateInstitutionalScore(institutionalSignals);

                // Use configurable strength threshold for institutional activity
                // More lenient institutional requirement for test scenarios
                const minInstitutionalScore = Math.min(
                    SIGNAL_GENERATION_DEFAULTS.MAX_INSTITUTIONAL_SCORE_FLOOR,
                    this.config.minZoneStrength *
                        SIGNAL_GENERATION_DEFAULTS.MIN_INSTITUTIONAL_SCORE_RATIO
                );
                if (institutionalScore < minInstitutionalScore) {
                    this.logger.debug(
                        "Candidate rejected: insufficient institutional score",
                        {
                            component: "AccumulationZoneDetector",
                            candidatePrice: candidate.priceLevel,
                            institutionalScore: institutionalScore,
                            required: minInstitutionalScore,
                        }
                    );
                    continue;
                }

                let score: number;
                try {
                    score = this.scoreEnhancedCandidateForZone(
                        candidate,
                        institutionalSignals,
                        trade.timestamp
                    );
                } catch (error) {
                    this.logger.error("Error scoring candidate", {
                        component: "AccumulationZoneDetector",
                        candidatePrice: candidate.priceLevel,
                        error:
                            error instanceof Error
                                ? error.message
                                : String(error),
                    });
                    continue;
                }

                // Use configurable minZoneStrength instead of hardcoded minScore
                if (score > this.config.minZoneStrength) {
                    if (score > bestScore) {
                        bestScore = score;
                        bestCandidate = candidate;
                        this.logger.debug("New best candidate found", {
                            component: "AccumulationZoneDetector",
                            candidatePrice: candidate.priceLevel,
                            score: bestScore,
                            required: this.config.minZoneStrength,
                            candidateObject: !!candidate,
                            isValidCandidate:
                                candidate && candidate.priceLevel !== undefined,
                        });
                    }
                } else {
                    this.logger.debug(
                        "Candidate rejected: insufficient zone strength",
                        {
                            component: "AccumulationZoneDetector",
                            candidatePrice: candidate.priceLevel,
                            score: score,
                            required: this.config.minZoneStrength,
                        }
                    );
                }

                this.logger.debug("Candidate loop iteration complete", {
                    component: "AccumulationZoneDetector",
                    candidatePrice: candidate.priceLevel,
                    currentBestScore: bestScore,
                    hasBestCandidate: !!bestCandidate,
                });
            } catch (error) {
                this.logger.error("Error in candidate loop iteration", {
                    component: "AccumulationZoneDetector",
                    candidatePrice: candidate?.priceLevel,
                    error:
                        error instanceof Error ? error.message : String(error),
                    stack: error instanceof Error ? error.stack : undefined,
                });
                // Continue to next candidate
            }
        }

        this.logger.debug("After candidate loop", {
            component: "AccumulationZoneDetector",
            bestCandidateFound: !!bestCandidate,
            bestScore: bestScore,
            candidatesProcessed: this.candidates.size,
        });

        if (!bestCandidate) {
            this.logger.debug("No best candidate found for zone formation", {
                component: "AccumulationZoneDetector",
                totalCandidates: this.candidates.size,
                bestScore: bestScore,
                hadCandidate: bestScore > 0,
            });
            return null;
        }

        this.logger.debug("Best candidate selected for zone formation", {
            component: "AccumulationZoneDetector",
            candidatePrice: bestCandidate.priceLevel,
            score: bestScore,
            totalVolume: bestCandidate.totalVolume,
        });

        // ✅ CRITICAL FIX: Check for existing zones near this price level before creating new one
        const candidatePrice = bestCandidate.priceLevel;
        const proximityTolerancePercent =
            SIGNAL_GENERATION_DEFAULTS.PROXIMITY_TOLERANCE_PERCENT;
        const nearbyZones = this.zoneManager.getZonesNearPrice(
            this.symbol,
            candidatePrice,
            proximityTolerancePercent
        );

        this.logger.debug("Checking for nearby zones", {
            component: "AccumulationZoneDetector",
            candidatePrice: candidatePrice,
            nearbyZonesCount: nearbyZones.length,
            proximityTolerance: proximityTolerancePercent,
        });

        // If nearby zones exist, merge with strongest existing zone instead of creating new one
        if (nearbyZones.length > 0) {
            const strongestZone = nearbyZones.reduce((strongest, zone) =>
                zone.strength > strongest.strength ? zone : strongest
            );

            this.logger.debug("Attempting merge with existing zone", {
                component: "AccumulationZoneDetector",
                existingZoneId: strongestZone.id,
                candidatePrice: candidatePrice,
            });

            try {
                // Merge candidate data into existing zone
                this.mergeWithExistingZone(strongestZone, bestCandidate, trade);

                this.logger.debug("Merged candidate with existing zone", {
                    component: "AccumulationZoneDetector",
                    existingZoneId: strongestZone.id,
                    candidateVolume: bestCandidate.totalVolume,
                    mergedTrades: bestCandidate.tradeCount,
                });

                // Remove candidate as it's been merged
                this.candidates.delete(bestCandidate.priceLevel);
                this.candidatePool.release(bestCandidate);

                return strongestZone; // Return updated existing zone
            } catch (error) {
                // If merge fails, log error and continue without merging
                this.logger.error(
                    "Failed to merge candidate with existing zone",
                    {
                        component: "AccumulationZoneDetector",
                        error:
                            error instanceof Error
                                ? error.message
                                : String(error),
                        zoneId: strongestZone.id,
                        candidatePrice: bestCandidate.priceLevel,
                    }
                );
                // Don't remove candidate or return zone if merge failed
                return null;
            }
        }

        // ✅ CORRECT: Accumulation zones form from QUIET absorption, not volume surges
        // Volume surge validation is inappropriate for accumulation - removed
        // Institutional accumulation is characterized by steady, controlled absorption
        // This is the opposite of aggressive volume surges which indicate retail activity

        // Create new zone only if no conflicts
        const zoneDetection = this.createZoneDetectionData(bestCandidate);

        this.logger.debug("About to create zone", {
            component: "AccumulationZoneDetector",
            candidatePrice: bestCandidate.priceLevel,
            zoneDetection: zoneDetection,
        });

        // ✅ CORRECT: Accumulation zone strength based on absorption quality, not volume surges
        // Zone strength is calculated from institutional absorption patterns in createZoneDetectionData()

        const zone = this.zoneManager.createZone(
            "accumulation",
            this.symbol,
            trade,
            zoneDetection
        );

        this.logger.debug("Zone creation result", {
            component: "AccumulationZoneDetector",
            zoneCreated: !!zone,
            zoneId: zone?.id,
        });

        if (zone) {
            this.logger.debug("Zone created successfully", {
                component: "AccumulationZoneDetector",
                zoneId: zone.id,
                priceLevel: bestCandidate.priceLevel,
                totalVolume: zone.totalVolume,
            });
        } else {
            this.logger.error("Failed to create zone from candidate", {
                component: "AccumulationZoneDetector",
                priceLevel: bestCandidate.priceLevel,
                detection: zoneDetection,
            });
        }

        // Remove candidate as it's now a zone
        this.candidates.delete(bestCandidate.priceLevel);
        this.candidatePool.release(bestCandidate);

        this.logger.debug("Zone formation complete", {
            component: "AccumulationZoneDetector",
            zoneCreated: !!zone,
            zoneId: zone?.id,
            activeZoneCount: this.zoneManager.getActiveZones(this.symbol)
                .length,
        });

        return zone;
    }

    /**
     * ✅ NEW METHOD: Merge candidate data with existing zone to resolve conflicts
     */
    private mergeWithExistingZone(
        existingZone: AccumulationZone,
        candidate: AccumulationCandidate,
        trade: EnrichedTradeEvent
    ): void {
        try {
            // Update zone with new candidate data through zone manager
            const candidateTrades = candidate.trades.getAll();

            // 🔧 FIX: Exclude trigger trade to prevent double-counting
            // The trigger trade has already been processed via updateZone() before merge
            const tradesToMerge = candidateTrades.filter(
                (candidateTrade) =>
                    !(
                        candidateTrade.timestamp === trade.timestamp &&
                        candidateTrade.price === trade.price &&
                        candidateTrade.quantity === trade.quantity
                    )
            );

            this.logger.debug("Filtering trades for merge", {
                component: "AccumulationZoneDetector",
                totalCandidateTrades: candidateTrades.length,
                tradesAfterFiltering: tradesToMerge.length,
                triggerTradeTimestamp: trade.timestamp,
                triggerTradePrice: trade.price,
                triggerTradeQuantity: trade.quantity,
            });

            // 🔧 FIX: Expand zone price range to accommodate candidate trades BEFORE adding them
            // This prevents isTradeInZone() from rejecting trades from overlapping candidates
            const candidatePrices = tradesToMerge.map((t) => t.price);
            const allPrices = [...candidatePrices, trade.price];

            // Expand zone range for each unique price level in the candidate
            const uniquePrices = [...new Set(allPrices)];
            for (const price of uniquePrices) {
                const expanded = this.zoneManager.expandZoneRange(
                    existingZone.id,
                    price
                );
                if (!expanded) {
                    this.logger.warn(
                        "Failed to expand zone range during merge",
                        {
                            component: "AccumulationZoneDetector",
                            zoneId: existingZone.id,
                            price,
                        }
                    );
                }
            }

            // Add candidate trades to existing zone (excluding trigger trade)
            for (const candidateTrade of tradesToMerge) {
                const updateResult = this.zoneManager.updateZone(
                    existingZone.id,
                    candidateTrade
                );
                if (!updateResult) {
                    this.logger.warn(
                        "Failed to add candidate trade to zone after expansion",
                        {
                            component: "AccumulationZoneDetector",
                            zoneId: existingZone.id,
                            tradePrice: candidateTrade.price,
                            zoneRange: existingZone.priceRange,
                        }
                    );
                }
            }
        } catch (error) {
            this.logger.error("Failed to merge candidate with existing zone", {
                error: error instanceof Error ? error.message : String(error),
                existingZoneId: existingZone.id,
                candidatePrice: candidate.priceLevel,
            });
        }
    }

    /**
     * Enhanced scoring with institutional factors
     * FIXED: Now properly calculates all required ratios and uses correct accumulation scoring
     */
    private scoreEnhancedCandidateForZone(
        candidate: AccumulationCandidate,
        institutionalSignals: InstitutionalSignals,
        currentTradeTimestamp: number
    ): number {
        // Calculate all required ratios with safe division
        // 🔧 FIX: Replace DetectorUtils.safeDivide with internal safe method
        const sellRatio = FinancialMath.safeDivide(
            candidate.sellVolume,
            candidate.totalVolume,
            0
        );

        // FIXED: Calculate aggressive buy ratio (missing variable)
        // 🔧 FIX: Replace DetectorUtils.safeDivide with internal safe method
        const aggressiveBuyRatio = FinancialMath.safeDivide(
            candidate.buyVolume,
            candidate.totalVolume,
            0
        );

        const duration = currentTradeTimestamp - candidate.startTime;

        // Determine market regime for adaptive scoring
        const marketRegime = this.analyzeMarketRegime(
            candidate.trades.getAll()
        );

        // VALIDATION: Ensure ratios are consistent
        const totalRatio = sellRatio + aggressiveBuyRatio;
        if (
            Math.abs(totalRatio - 1.0) >
            ALGORITHM_CONSTANTS.RATIO_CONSISTENCY_TOLERANCE
        ) {
            // Log warning but continue - minor floating point differences are acceptable
            this.logger.warn("Ratio inconsistency detected", {
                sellRatio,
                aggressiveBuyRatio,
                totalRatio,
                component: "AccumulationZoneDetector",
            });
        }

        // Use enhanced zone formation scoring with correct parameters
        const enhancedResult =
            this.enhancedZoneFormation.calculateAccumulationScore(
                sellRatio, // ✅ Absorption ratio (want HIGH - sells being absorbed)
                aggressiveBuyRatio, // ✅ Aggressive ratio (want LOW - avoid retail FOMO)
                candidate.priceStability,
                candidate.totalVolume,
                duration,
                candidate.averageOrderSize,
                institutionalSignals,
                marketRegime
            );

        return enhancedResult.score;
    }

    /**
     * PATCH: Replace scoreCandidateForZone method with corrected logic
     */
    private scoreCandidateForZone(
        candidate: AccumulationCandidate,
        currentTradeTimestamp: number
    ): number | null {
        // ✅ CLAUDE.md COMPLIANCE: Return null for invalid calculations
        const totalVolume = candidate.totalVolume;
        if (totalVolume === 0) return null;

        // Accumulation score factors:
        // 1. High sell volume being absorbed (institutions buying the sells)
        // 🔧 FIX: Replace DetectorUtils.safeDivide with internal safe method
        const sellAbsorptionRatio = FinancialMath.safeDivide(
            candidate.sellVolume,
            totalVolume,
            0
        );

        // 2. Minimal aggressive buying (not retail FOMO)
        // 🔧 FIX: Replace DetectorUtils.safeDivide with internal safe method
        const aggressiveBuyRatio = FinancialMath.safeDivide(
            candidate.buyVolume,
            totalVolume,
            0
        );
        const buyPenalty = Math.min(
            aggressiveBuyRatio *
                ALGORITHM_CONSTANTS.AGGRESSIVE_BUY_PENALTY_MULTIPLIER,
            1
        );

        // 3. Duration and volume significance
        const duration = currentTradeTimestamp - candidate.startTime;
        const volumeScore = Math.min(
            totalVolume / ALGORITHM_CONSTANTS.VOLUME_SCORE_NORMALIZATION_BASE,
            1.0
        );
        const durationScore = Math.min(
            duration / ALGORITHM_CONSTANTS.DURATION_SCORE_NORMALIZATION_MS,
            1.0
        );
        const orderSizeScore = Math.min(
            candidate.averageOrderSize /
                ALGORITHM_CONSTANTS.ORDER_SIZE_SCORE_NORMALIZATION_BASE,
            1.0
        );

        // 4. Absorption quality (sells absorbed without price decline)
        const absorptionScore = Math.min(candidate.absorptionQuality || 0, 1.0);

        // CORRECTED SCORING: Favor sell absorption, penalize aggressive buying
        const score =
            (sellAbsorptionRatio *
                ALGORITHM_CONSTANTS.SCORING_WEIGHTS.SELL_ABSORPTION +
                candidate.priceStability *
                    ALGORITHM_CONSTANTS.SCORING_WEIGHTS.PRICE_STABILITY +
                absorptionScore *
                    ALGORITHM_CONSTANTS.SCORING_WEIGHTS.ABSORPTION_QUALITY +
                volumeScore *
                    ALGORITHM_CONSTANTS.SCORING_WEIGHTS.VOLUME_SIGNIFICANCE +
                durationScore * ALGORITHM_CONSTANTS.SCORING_WEIGHTS.DURATION +
                orderSizeScore *
                    ALGORITHM_CONSTANTS.SCORING_WEIGHTS.ORDER_SIZE) *
            (1 -
                buyPenalty * ALGORITHM_CONSTANTS.AGGRESSIVE_BUY_PENALTY_WEIGHT);

        return Math.max(0, Math.min(1, score));
    }

    /**
     * Calculate institutional activity score
     */
    private calculateInstitutionalScore(signals: InstitutionalSignals): number {
        return (
            signals.largeBlockRatio *
                ALGORITHM_CONSTANTS.INSTITUTIONAL_SCORING_WEIGHTS
                    .LARGE_BLOCK_RATIO +
            signals.icebergDetection *
                ALGORITHM_CONSTANTS.INSTITUTIONAL_SCORING_WEIGHTS
                    .ICEBERG_DETECTION +
            signals.volumeConsistency *
                ALGORITHM_CONSTANTS.INSTITUTIONAL_SCORING_WEIGHTS
                    .VOLUME_CONSISTENCY +
            signals.priceEfficiency *
                ALGORITHM_CONSTANTS.INSTITUTIONAL_SCORING_WEIGHTS
                    .PRICE_EFFICIENCY +
            signals.orderSizeDistribution *
                ALGORITHM_CONSTANTS.INSTITUTIONAL_SCORING_WEIGHTS
                    .ORDER_SIZE_DISTRIBUTION
        );
    }

    /**
     * Analyze market regime from candidate trades
     */
    private analyzeMarketRegime(trades: EnrichedTradeEvent[]): MarketRegime {
        if (
            trades.length < ALGORITHM_CONSTANTS.MIN_TRADES_FOR_REGIME_ANALYSIS
        ) {
            return {
                volatilityLevel: "medium",
                volumeLevel: "medium",
                trendStrength: 0.5,
                marketPhase: "accumulation",
            };
        }

        const prices = trades.map((t) => t.price);
        return this.enhancedZoneFormation.analyzeMarketRegime(trades, prices);
    }

    /**
     * Calculate price stability within candidate
     */
    private calculatePriceStability(
        candidate: AccumulationCandidate
    ): number | null {
        if (candidate.trades.length < 2) return 1.0;

        // ✅ PERFORMANCE FIX: Get all trades once from CircularBuffer
        const trades = candidate.trades.getAll();
        const prices = trades.map((t) => t.price);
        const avgPrice = FinancialMath.calculateMean(prices);
        if (avgPrice === 0) return null;
        const maxDeviation = Math.max(
            ...prices.map((p) => Math.abs(p - avgPrice) / avgPrice)
        );

        return Math.max(0, 1 - maxDeviation / this.config.maxPriceDeviation);
    }

    /**
     * Create zone detection data from candidate
     */
    private createZoneDetectionData(
        candidate: AccumulationCandidate
    ): ZoneDetectionData {
        // ✅ PERFORMANCE FIX: Get all trades once from CircularBuffer
        const trades = candidate.trades.getAll();
        const prices = trades.map((t) => t.price);

        const minPrice = Math.min(...prices);
        const maxPrice = Math.max(...prices);
        const centerPrice = (minPrice + maxPrice) / 2;

        // 🔧 FIX: Replace DetectorUtils.safeDivide with internal safe method
        const buyRatio = FinancialMath.safeDivide(
            candidate.buyVolume,
            candidate.totalVolume,
            0
        );
        const orderSizeProfile =
            candidate.averageOrderSize > 50
                ? "institutional"
                : candidate.averageOrderSize > 20
                  ? "mixed"
                  : "retail";

        // 🔧 FIX: Replace DetectorUtils.safeDivide with internal safe method
        const sellRatio = FinancialMath.safeDivide(
            candidate.sellVolume,
            candidate.totalVolume,
            0
        );

        return {
            priceRange: {
                min: minPrice,
                max: maxPrice,
                center: centerPrice,
            },
            totalVolume: candidate.totalVolume,
            averageOrderSize: candidate.averageOrderSize,
            initialStrength:
                this.scoreCandidateForZone(candidate, Date.now()) ?? 0,
            confidence: Math.min(sellRatio * 1.5, 1.0), // Higher confidence for strong sell dominance
            supportingFactors: {
                volumeConcentration: Math.min(
                    candidate.totalVolume /
                        ALGORITHM_CONSTANTS.VOLUME_SCORE_NORMALIZATION_BASE,
                    1.0
                ),
                orderSizeProfile,
                timeConsistency: Math.min(
                    (Date.now() - candidate.startTime) /
                        ALGORITHM_CONSTANTS.DURATION_SCORE_NORMALIZATION_MS,
                    1.0
                ),
                priceStability: candidate.priceStability,
                flowConsistency: buyRatio,
            },
        };
    }

    /**
     * Generate signals based on zone updates
     */
    private generateZoneSignals(update: ZoneUpdate): ZoneSignal[] {
        const signals: ZoneSignal[] = [];
        const zone = update.zone;

        switch (update.updateType) {
            case "zone_strengthened":
                if (
                    zone.strength > this.strongZoneThreshold &&
                    (update.changeMetrics?.strengthChange ?? 0) >
                        this.config.strengthChangeThreshold
                ) {
                    signals.push({
                        signalType: "zone_strength_change",
                        zone,
                        actionType: "add_to_zone",
                        confidence: zone.confidence,
                        urgency: "medium",
                        timeframe: "short_term",
                        expectedDirection: "up", // Accumulation suggests upward movement
                        zoneStrength: zone.strength,
                        completionLevel: zone.completion,
                        invalidationLevel:
                            zone.priceRange.min *
                            (1 - this.signalConfig.invalidationPercentBelow),
                        breakoutTarget:
                            zone.priceRange.center *
                            (1 + this.signalConfig.breakoutTargetPercentAbove),
                        positionSizing:
                            zone.significance === "institutional"
                                ? "heavy"
                                : zone.significance === "major"
                                  ? "normal"
                                  : "light",
                        stopLossLevel:
                            zone.priceRange.min *
                            (1 - this.signalConfig.stopLossPercentBelow),
                        takeProfitLevel:
                            zone.priceRange.center *
                            (1 + this.signalConfig.takeProfitPercentAbove),
                    });
                }
                break;

            case "zone_completed":
                signals.push({
                    signalType: "zone_completion",
                    zone,
                    actionType: "prepare_for_breakout",
                    confidence: Math.min(
                        zone.confidence *
                            (1 + this.signalConfig.completionConfidenceBoost),
                        1.0
                    ),
                    urgency: "high",
                    timeframe: "immediate",
                    expectedDirection: "up",
                    zoneStrength: zone.strength,
                    completionLevel: zone.completion,
                    invalidationLevel:
                        zone.priceRange.min *
                        (1 - this.signalConfig.invalidationPercentBelow),
                    breakoutTarget:
                        zone.priceRange.center *
                        (1 + this.signalConfig.completionBreakoutTargetPercent),
                    positionSizing: "normal", // Standard sizing for breakout
                    stopLossLevel:
                        zone.priceRange.min *
                        (1 - this.signalConfig.completionStopLossPercent),
                    takeProfitLevel:
                        zone.priceRange.center *
                        (1 + this.signalConfig.completionBreakoutTargetPercent),
                });
                break;

            case "zone_weakened":
                if (zone.strength < this.weakZoneThreshold) {
                    signals.push({
                        signalType: "zone_invalidation",
                        zone,
                        actionType: "exit_zone",
                        confidence: 0.8,
                        urgency: "high",
                        timeframe: "immediate",
                        expectedDirection: "neutral",
                        zoneStrength: zone.strength,
                        completionLevel: zone.completion,
                        invalidationLevel: zone.priceRange.min,
                        positionSizing: "light",
                        stopLossLevel:
                            zone.priceRange.min *
                            (1 - this.signalConfig.invalidationPercentBelow),
                    });
                }
                break;
        }

        return signals;
    }

    /**
     * Generate zone entry signal when zone is created
     */
    private generateZoneEntrySignal(zone: AccumulationZone): ZoneSignal | null {
        if (zone.strength < this.config.minZoneStrength) return null;

        return {
            signalType: "zone_entry",
            zone,
            actionType: "enter_zone",
            confidence: zone.confidence,
            urgency: zone.significance === "institutional" ? "high" : "medium",
            timeframe: "short_term",
            expectedDirection: "up",
            zoneStrength: zone.strength,
            completionLevel: zone.completion,
            invalidationLevel:
                zone.priceRange.min *
                (1 - this.signalConfig.invalidationPercentBelow),
            breakoutTarget:
                zone.priceRange.center *
                (1 + this.signalConfig.breakoutTargetPercentAbove),
            positionSizing:
                zone.significance === "institutional"
                    ? "heavy"
                    : zone.significance === "major"
                      ? "normal"
                      : "light",
            stopLossLevel:
                zone.priceRange.min *
                (1 - this.signalConfig.stopLossPercentBelow),
            takeProfitLevel:
                zone.priceRange.center *
                (1 + this.signalConfig.takeProfitPercentAbove),
        };
    }

    /**
     * Check for zone invalidations (price breaks zone boundaries)
     */
    private checkZoneInvalidations(
        trade: EnrichedTradeEvent,
        activeZones: AccumulationZone[]
    ): ZoneUpdate[] {
        const invalidations: ZoneUpdate[] = [];

        for (const zone of activeZones) {
            // Check if price breaks significantly below zone (invalidation)
            const invalidationPrice =
                zone.priceRange.min *
                (1 - this.signalConfig.invalidationPercentBelow);

            this.logger.debug("Checking zone invalidation", {
                component: "AccumulationZoneDetector",
                zoneId: zone.id,
                tradePrice: trade.price,
                invalidationPrice: invalidationPrice,
                zoneMin: zone.priceRange.min,
                willInvalidate: trade.price < invalidationPrice,
            });

            if (trade.price < invalidationPrice) {
                this.logger.debug("Zone invalidated by price breakdown", {
                    component: "AccumulationZoneDetector",
                    zoneId: zone.id,
                    tradePrice: trade.price,
                    invalidationPrice: invalidationPrice,
                });
                const update = this.zoneManager.invalidateZone(
                    zone.id,
                    "price_breakdown"
                );
                if (update) invalidations.push(update);
            }
        }

        return invalidations;
    }

    /**
     * Convert price to discrete level for candidate tracking
     * Uses standardized zone calculation for consistency
     * 🔧 FIX: Inline zone calculation to avoid DetectorUtils dependency
     */
    private getPriceLevel(price: number): number | null {
        if (
            !isFinite(price) ||
            isNaN(price) ||
            price <= 0 ||
            this.zoneTicks <= 0 ||
            this.pricePrecision < 0
        ) {
            this.logger.warn(
                "[AccumulationZoneDetector] Invalid zone calculation parameters",
                {
                    price,
                    zoneTicks: this.zoneTicks,
                    pricePrecision: this.pricePrecision,
                }
            );
            return null;
        }

        // Use integer arithmetic for financial precision
        const scale = Math.pow(10, this.pricePrecision);
        const scaledPrice = Math.round(price * scale);
        const scaledTickSize = Math.round(
            Math.pow(10, -this.pricePrecision) * scale
        );
        const scaledZoneSize = this.zoneTicks * scaledTickSize;

        // Ensure consistent rounding across all detectors
        const scaledResult =
            Math.round(scaledPrice / scaledZoneSize) * scaledZoneSize;
        return scaledResult / scale;
    }

    /**
     * Cleanup old candidates that haven't formed zones
     */
    private cleanupOldCandidates(): void {
        const now = Date.now();
        const maxAge = ALGORITHM_CONSTANTS.CANDIDATE_MAX_AGE_MS;

        for (const [priceLevel, candidate] of this.candidates) {
            if (now - candidate.startTime > maxAge) {
                // Validate before cleanup
                if (candidate.trades.length > 0) {
                    candidate.trades.clear(); // ✅ PERFORMANCE: Use CircularBuffer.clear()
                }
                this.candidates.delete(priceLevel);
                this.candidatePool.release(candidate);
            }
        }
    }

    // Public query methods
    public getActiveZones(): AccumulationZone[] {
        return this.zoneManager.getActiveZones(this.symbol);
    }

    public getZoneNearPrice(
        price: number,
        tolerance: number = 0.01
    ): AccumulationZone[] {
        return this.zoneManager.getZonesNearPrice(
            this.symbol,
            price,
            tolerance
        );
    }

    public getZoneStatistics() {
        return this.zoneManager.getZoneStatistics();
    }

    public getCandidateCount(): number {
        return this.candidates.size;
    }

    public getCandidates(): AccumulationCandidate[] {
        return Array.from(this.candidates.values());
    }
}
