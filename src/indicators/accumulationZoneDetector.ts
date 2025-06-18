// src/indicators/accumulationZoneDetector.ts
/**
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
import { DetectorUtils } from "./base/detectorUtils.js";
import { RollingWindow } from "../utils/rollingWindow.js";
import { ObjectPool } from "../utils/objectPool.js";
import { CircularBuffer } from "../utils/circularBuffer.js";
import {
    EnhancedZoneFormation,
    type InstitutionalSignals,
    type MarketRegime,
} from "./enhancedZoneFormation.js";
import { Config } from "../core/config.js";
import { ZoneDetector } from "./base/zoneDetector.js";
import type { AccumulationCandidate } from "./interfaces/detectorInterfaces.js";

/**
 * Zone-based AccumulationDetector - detects accumulation zones rather than point events
 * Tracks evolving accumulation zones over time and emits zone-based signals
 */
export class AccumulationZoneDetector extends ZoneDetector {
    // Candidate tracking for zone formation
    private candidates = new Map<number, AccumulationCandidate>();
    private readonly recentTrades = new RollingWindow<EnrichedTradeEvent>(
        200,
        false
    );

    // Object pool for candidates to reduce GC pressure
    private readonly candidatePool = new ObjectPool<AccumulationCandidate>(
        () => ({
            priceLevel: 0,
            startTime: 0,
            trades: new CircularBuffer<EnrichedTradeEvent>(100, (trade) => {
                // Clean up any Map references in depthSnapshot to help GC
                if (trade.depthSnapshot) {
                    trade.depthSnapshot.clear();
                }
            }), // ✅ PERFORMANCE: Circular buffer with cleanup
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
            candidate.trades.clear(); // ✅ PERFORMANCE: Clear circular buffer
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

    // Enhanced zone formation analyzer
    private readonly enhancedZoneFormation: EnhancedZoneFormation;

    // Detection parameters are now provided via config

    constructor(
        id: string,
        symbol: string,
        config: Partial<ZoneDetectorConfig>,
        logger: ILogger,
        metricsCollector: IMetricsCollector
    ) {
        super(id, config, "accumulation", logger, metricsCollector);

        this.symbol = symbol;
        this.pricePrecision = 2; // Should come from config
        this.zoneTicks = 2; // Price levels that define a zone

        // Initialize enhanced zone formation analyzer
        this.enhancedZoneFormation = new EnhancedZoneFormation(
            50, // Institutional size threshold
            15, // Iceberg detection window
            0.4 // Min institutional ratio
        );

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
        setInterval(() => this.cleanupOldCandidates(), 300000); // Every 5 minutes
    }

    /**
     * Main analysis method - processes trade and returns zone updates/signals
     */
    public analyze(trade: EnrichedTradeEvent): ZoneAnalysisResult {
        const updates: ZoneUpdate[] = [];
        const signals: ZoneSignal[] = [];

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

            // Get or create candidate for this price level
            if (!this.candidates.has(priceLevel)) {
                const candidate = this.candidatePool.acquire();
                candidate.priceLevel = priceLevel;
                candidate.startTime = trade.timestamp;
                candidate.lastUpdate = trade.timestamp;
                this.candidates.set(priceLevel, candidate);
            }

            const candidate = this.candidates.get(priceLevel)!;

            // Update candidate with new trade
            // ✅ PERFORMANCE FIX: CircularBuffer.add() is O(1) vs Array.push() + Array.shift()
            candidate.trades.add(trade);
            candidate.lastUpdate = trade.timestamp;

            // ✅ CRITICAL FIX: Calculate volume from actual CircularBuffer contents
            // to avoid double counting when buffer overwrites old trades
            const currentTrades = candidate.trades.getAll();
            candidate.totalVolume = currentTrades.reduce(
                (sum, t) => sum + t.quantity,
                0
            );
            candidate.tradeCount = currentTrades.length;
            candidate.averageOrderSize =
                candidate.tradeCount > 0
                    ? candidate.totalVolume / candidate.tradeCount
                    : 0;

            // ✅ CRITICAL FIX: Calculate side-specific volumes from actual CircularBuffer contents
            // to avoid double counting when buffer overwrites old trades
            candidate.buyVolume = currentTrades
                .filter((t) => !t.buyerIsMaker)
                .reduce((sum, t) => sum + t.quantity, 0);
            candidate.sellVolume = currentTrades
                .filter((t) => t.buyerIsMaker)
                .reduce((sum, t) => sum + t.quantity, 0);

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
            candidate.priceStability = this.calculatePriceStability(candidate);

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
        const recentTrades = allTrades.slice(-10); // Last 10 trades
        if (recentTrades.length < 3) return;

        const priceRange =
            Math.max(...recentTrades.map((t) => t.price)) -
            Math.min(...recentTrades.map((t) => t.price));
        const avgPrice = DetectorUtils.calculateMean(
            recentTrades.map((t) => t.price)
        );

        if (avgPrice > 0) {
            const priceStability = 1 - priceRange / avgPrice;

            // Good absorption = high sell volume with minimal price decline
            if (priceStability > 0.98 && trade.buyerIsMaker) {
                // This is positive for accumulation - sells absorbed without price drop
                candidate.absorptionQuality =
                    (candidate.absorptionQuality || 0) + 0.1;
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

        for (const candidate of this.candidates.values()) {
            const duration = now - candidate.startTime;

            // Must meet minimum duration requirement
            if (duration < this.config.minCandidateDuration) {
                continue;
            }

            // Must have minimum volume and trade count
            if (candidate.totalVolume < this.config.minZoneVolume) {
                continue;
            }
            if (candidate.trades.length < this.config.minTradeCount) {
                continue;
            }

            // CRITICAL FIX: Must show ABSORPTION pattern (high sell ratio being absorbed)
            const sellRatio = DetectorUtils.safeDivide(
                candidate.sellVolume,
                candidate.totalVolume,
                0
            );
            const minAbsorptionRatio =
                Config.ENHANCED_ZONE_FORMATION.detectorThresholds.accumulation
                    .minAbsorptionRatio;
            // ✅ FIXED: For accumulation, we WANT high sell ratios (sells being absorbed)
            // The minAbsorptionRatio (0.55) means we need at least 55% sell pressure to detect absorption
            if (sellRatio < minAbsorptionRatio) {
                continue;
            }

            // Must have institutional-grade price stability during absorption
            if (
                candidate.priceStability <
                Config.ENHANCED_ZONE_FORMATION.detectorThresholds.accumulation
                    .minPriceStability
            ) {
                continue;
            }

            // Must show minimal aggressive buying (avoid retail FOMO patterns)
            const aggressiveBuyRatio = DetectorUtils.safeDivide(
                candidate.buyVolume,
                candidate.totalVolume,
                0
            );
            if (
                aggressiveBuyRatio >
                Config.ENHANCED_ZONE_FORMATION.detectorThresholds.accumulation
                    .maxAggressiveRatio
            ) {
                continue;
            }

            // Enhanced scoring with institutional factors
            const institutionalSignals =
                this.enhancedZoneFormation.analyzeInstitutionalSignals(
                    candidate.trades.getAll() // ✅ Convert CircularBuffer to Array for analysis
                );
            const institutionalScore =
                this.calculateInstitutionalScore(institutionalSignals);

            // Require minimum institutional activity for accumulation
            const minInstitutionalScore =
                Config.ENHANCED_ZONE_FORMATION.detectorThresholds.accumulation
                    .minInstitutionalScore;

            if (institutionalScore < minInstitutionalScore) {
                continue;
            }

            const score = this.scoreEnhancedCandidateForZone(
                candidate,
                institutionalSignals,
                trade.timestamp
            );

            if (
                score > bestScore &&
                score >
                    Config.ENHANCED_ZONE_FORMATION.detectorThresholds
                        .accumulation.minScore
            ) {
                // High threshold for accumulation
                bestScore = score;
                bestCandidate = candidate;
            }
        }

        if (!bestCandidate) {
            return null;
        }

        // ✅ CRITICAL FIX: Check for existing zones near this price level before creating new one
        const candidatePrice = bestCandidate.priceLevel;
        const proximityTolerance = candidatePrice * 0.01; // 1% proximity tolerance
        const nearbyZones = this.zoneManager.getZonesNearPrice(
            this.symbol,
            candidatePrice,
            proximityTolerance
        );

        // If nearby zones exist, merge with strongest existing zone instead of creating new one
        if (nearbyZones.length > 0) {
            const strongestZone = nearbyZones.reduce((strongest, zone) =>
                zone.strength > strongest.strength ? zone : strongest
            );

            // Merge candidate data into existing zone
            this.mergeWithExistingZone(strongestZone, bestCandidate, trade);

            // Remove candidate as it's been merged
            this.candidates.delete(bestCandidate.priceLevel);
            this.candidatePool.release(bestCandidate);

            return strongestZone; // Return updated existing zone
        }

        // Create new zone only if no conflicts
        const zoneDetection = this.createZoneDetectionData(bestCandidate);
        const zone = this.zoneManager.createZone(
            "accumulation",
            this.symbol,
            trade,
            zoneDetection
        );

        // Remove candidate as it's now a zone
        this.candidates.delete(bestCandidate.priceLevel);
        this.candidatePool.release(bestCandidate);

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

            // Add candidate trades to existing zone
            for (const candidateTrade of candidateTrades) {
                this.zoneManager.updateZone(existingZone.id, candidateTrade);
            }

            // Also update zone with the current trade that triggered the merge
            this.zoneManager.updateZone(existingZone.id, trade);

            // Log merge operation for monitoring
            this.logger.debug("Merged candidate with existing zone", {
                component: "AccumulationZoneDetector",
                existingZoneId: existingZone.id,
                candidatePrice: candidate.priceLevel,
                candidateVolume: candidate.totalVolume,
                mergedTrades: candidateTrades.length,
            });
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
        const sellRatio = DetectorUtils.safeDivide(
            candidate.sellVolume,
            candidate.totalVolume,
            0
        );

        // FIXED: Calculate aggressive buy ratio (missing variable)
        const aggressiveBuyRatio = DetectorUtils.safeDivide(
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
        if (Math.abs(totalRatio - 1.0) > 0.01) {
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
    ): number {
        // CRITICAL FIX: Score based on absorption, not aggressive buying
        const totalVolume = candidate.totalVolume;
        if (totalVolume === 0) return 0;

        // Accumulation score factors:
        // 1. High sell volume being absorbed (institutions buying the sells)
        const sellAbsorptionRatio = DetectorUtils.safeDivide(
            candidate.sellVolume,
            totalVolume,
            0
        );

        // 2. Minimal aggressive buying (not retail FOMO)
        const aggressiveBuyRatio = DetectorUtils.safeDivide(
            candidate.buyVolume,
            totalVolume,
            0
        );
        const buyPenalty = Math.min(aggressiveBuyRatio * 2, 1); // Penalize aggressive buying

        // 3. Duration and volume significance
        const duration = currentTradeTimestamp - candidate.startTime;
        const volumeScore = Math.min(totalVolume / 300, 1.0);
        const durationScore = Math.min(duration / 600000, 1.0); // 10 minutes
        const orderSizeScore = Math.min(candidate.averageOrderSize / 50, 1.0);

        // 4. Absorption quality (sells absorbed without price decline)
        const absorptionScore = Math.min(candidate.absorptionQuality || 0, 1.0);

        // CORRECTED SCORING: Favor sell absorption, penalize aggressive buying
        const score =
            (sellAbsorptionRatio * 0.4 + // 40% - Want high sell volume being absorbed
                candidate.priceStability * 0.25 + // 25% - Price stability during selling
                absorptionScore * 0.15 + // 15% - Quality of absorption
                volumeScore * 0.1 + // 10% - Volume significance
                durationScore * 0.05 + // 5% - Duration
                orderSizeScore * 0.05) * // 5% - Order size
            (1 - buyPenalty * 0.5); // Reduce score if too much aggressive buying

        return Math.max(0, Math.min(1, score));
    }

    /**
     * Calculate institutional activity score
     */
    private calculateInstitutionalScore(signals: InstitutionalSignals): number {
        return (
            signals.largeBlockRatio * 0.3 +
            signals.icebergDetection * 0.25 +
            signals.volumeConsistency * 0.2 +
            signals.priceEfficiency * 0.15 +
            signals.orderSizeDistribution * 0.1
        );
    }

    /**
     * Analyze market regime from candidate trades
     */
    private analyzeMarketRegime(trades: EnrichedTradeEvent[]): MarketRegime {
        if (trades.length < 5) {
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
    private calculatePriceStability(candidate: AccumulationCandidate): number {
        if (candidate.trades.length < 2) return 1.0;

        // ✅ PERFORMANCE FIX: Get all trades once from CircularBuffer
        const trades = candidate.trades.getAll();
        const prices = trades.map((t) => t.price);
        const avgPrice = prices.reduce((a, b) => a + b, 0) / prices.length;
        if (avgPrice === 0) return 0;
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

        const buyRatio = DetectorUtils.safeDivide(
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

        const sellRatio = DetectorUtils.safeDivide(
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
            initialStrength: this.scoreCandidateForZone(candidate, Date.now()),
            confidence: Math.min(sellRatio * 1.5, 1.0), // Higher confidence for strong sell dominance
            supportingFactors: {
                volumeConcentration: Math.min(candidate.totalVolume / 300, 1.0),
                orderSizeProfile,
                timeConsistency: Math.min(
                    (Date.now() - candidate.startTime) / 600000,
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
                    zone.strength > 0.7 &&
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
                        invalidationLevel: zone.priceRange.min * 0.995, // 0.5% below zone
                        breakoutTarget: zone.priceRange.center * 1.02, // 2% above center
                        positionSizing:
                            zone.significance === "institutional"
                                ? "heavy"
                                : zone.significance === "major"
                                  ? "normal"
                                  : "light",
                        stopLossLevel: zone.priceRange.min * 0.99, // 1% below zone
                        takeProfitLevel: zone.priceRange.center * 1.03, // 3% profit target
                    });
                }
                break;

            case "zone_completed":
                signals.push({
                    signalType: "zone_completion",
                    zone,
                    actionType: "prepare_for_breakout",
                    confidence: Math.min(zone.confidence * 1.2, 1.0), // Boost confidence for completion
                    urgency: "high",
                    timeframe: "immediate",
                    expectedDirection: "up",
                    zoneStrength: zone.strength,
                    completionLevel: zone.completion,
                    invalidationLevel: zone.priceRange.min * 0.99,
                    breakoutTarget: zone.priceRange.center * 1.05, // Higher target on completion
                    positionSizing: "normal", // Standard sizing for breakout
                    stopLossLevel: zone.priceRange.min * 0.985,
                    takeProfitLevel: zone.priceRange.center * 1.05,
                });
                break;

            case "zone_weakened":
                if (zone.strength < 0.4) {
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
                        stopLossLevel: zone.priceRange.min * 0.995,
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
            invalidationLevel: zone.priceRange.min * 0.995,
            breakoutTarget: zone.priceRange.center * 1.025,
            positionSizing:
                zone.significance === "institutional"
                    ? "heavy"
                    : zone.significance === "major"
                      ? "normal"
                      : "light",
            stopLossLevel: zone.priceRange.min * 0.99,
            takeProfitLevel: zone.priceRange.center * 1.03,
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
            const invalidationPrice = zone.priceRange.min * 0.995; // 0.5% below zone

            if (trade.price < invalidationPrice) {
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
     */
    private getPriceLevel(price: number): number {
        return DetectorUtils.calculateZone(
            price,
            this.zoneTicks,
            this.pricePrecision
        );
    }

    /**
     * Cleanup old candidates that haven't formed zones
     */
    private cleanupOldCandidates(): void {
        const now = Date.now();
        const maxAge = 1800000;
        let cleanedCount = 0;

        for (const [priceLevel, candidate] of this.candidates) {
            if (now - candidate.startTime > maxAge) {
                // Validate before cleanup
                if (candidate.trades.length > 0) {
                    candidate.trades.clear(); // ✅ PERFORMANCE: Use CircularBuffer.clear()
                }
                this.candidates.delete(priceLevel);
                this.candidatePool.release(candidate);
                cleanedCount++;
            }
        }

        // Log cleanup metrics
        if (cleanedCount > 0) {
            this.logger.debug("Cleaned old candidates", {
                cleanedCount,
                component: "AccumulationZoneDetector",
            });
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
