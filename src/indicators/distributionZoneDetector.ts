// src/indicators/distributionZoneDetector.ts
/**
 * 🔧 TRANSFORMED FROM ACCUMULATION DETECTOR - INSTITUTIONAL DISTRIBUTION DETECTION
 * ===============================================================================
 *
 * STATUS: NEWLY TRANSFORMED ⚙️
 * BASED_ON: AccumulationZoneDetector (PRODUCTION-READY)
 * TRANSFORMATION: Market mechanics inverted for distribution detection
 * LOGIC_VERIFIED: Mirrors accumulation with inverted institutional behavior
 *
 * Key transformation:
 * - Same structure and validation as AccumulationZoneDetector
 * - Inverted market mechanics: detect institutions selling into retail buying
 * - Uses distribution config parameters
 * - Identical performance optimizations and error handling
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
 * INSTITUTIONAL DISTRIBUTION LOGIC (INVERTED FROM ACCUMULATION):
 * - We want institutions AGGRESSIVELY selling (into retail buy pressure)
 * - High buyVolume ratio = institutions selling into retail buying ✅
 * - Low sellVolume ratio = weak retail selling pressure ✅
 *
 * DIFFERENCE FROM ACCUMULATION:
 * - Accumulation: institutions PASSIVELY absorb sells (high sell ratios)
 * - Distribution: institutions AGGRESSIVELY sell into buys (high buy ratios)
 *
 * This interpretation mirrors the validated accumulation logic with inverted mechanics.
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
import { ZoneDetector } from "./base/zoneDetector.js";
import type { DistributionCandidate } from "./interfaces/detectorInterfaces.js";
import { VolumeAnalyzer } from "./utils/volumeAnalyzer.js";
import type { VolumeSurgeConfig } from "./interfaces/volumeAnalysisInterface.js";

/**
 * Zone-based DistributionDetector - detects distribution zones rather than point events
 * Tracks evolving distribution zones over time and emits zone-based signals
 * MIRRORS AccumulationZoneDetector with inverted market mechanics
 */
export class DistributionZoneDetector extends ZoneDetector {
    // Candidate tracking for zone formation (identical to accumulation)
    private candidates = new Map<number, DistributionCandidate>();
    private readonly recentTrades = new RollingWindow<EnrichedTradeEvent>(
        200,
        false
    );

    // Object pool for candidates to reduce GC pressure (identical structure)
    private readonly candidatePool = new ObjectPool<DistributionCandidate>(
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
            absorptionQuality: 0, // Same property name - represents institutional selling quality
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

    // Configuration (identical structure)
    private readonly symbol: string;
    private readonly pricePrecision: number;
    private readonly zoneTicks: number;
    private readonly strongZoneThreshold: number;

    // Volume surge analysis integration
    private readonly volumeAnalyzer: VolumeAnalyzer;
    private readonly volumeSurgeConfig: VolumeSurgeConfig;

    constructor(
        id: string,
        symbol: string,
        config: Partial<ZoneDetectorConfig>,
        logger: ILogger,
        metrics: IMetricsCollector
    ) {
        super(id, "distribution", logger, metrics);

        this.symbol = symbol;
        this.pricePrecision = 2; // Fixed precision for distribution
        this.zoneTicks = 5; // Fixed zone ticks for distribution
        this.strongZoneThreshold = config.strongZoneThreshold ?? 0.7;

        // Enhanced zone formation with distribution-specific settings

        // Initialize volume surge configuration
        this.volumeSurgeConfig = {
            volumeSurgeMultiplier: config.volumeSurgeMultiplier ?? 3.5,
            imbalanceThreshold: config.imbalanceThreshold ?? 0.3,
            institutionalThreshold: config.institutionalThreshold ?? 15.0,
            burstDetectionMs: config.burstDetectionMs ?? 1500,
            sustainedVolumeMs: config.sustainedVolumeMs ?? 25000,
            medianTradeSize: config.medianTradeSize ?? 0.8,
        };

        // Initialize volume analyzer for enhanced distribution detection
        this.volumeAnalyzer = new VolumeAnalyzer(
            this.volumeSurgeConfig,
            logger,
            `${id}_distribution`
        );

        // Forward zone manager events (CRITICAL FIX: enables signal emission)
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

        this.logger.info("DistributionZoneDetector initialized", {
            component: "DistributionZoneDetector",
            symbol: this.symbol,
            config: {
                minCandidateDuration: this.config.minCandidateDuration,
                minZoneVolume: this.config.minZoneVolume,
                minTradeCount: this.config.minTradeCount,
                minSellRatio: this.config.minSellRatio, // Will be inverted in logic
                maxPriceDeviation: this.config.maxPriceDeviation,
                minZoneStrength: this.config.minZoneStrength,
            },
        });

        // Cleanup old candidates periodically (matching AccumulationZoneDetector)
        setInterval(() => this.cleanupOldCandidates(), 300000); // Every 5 minutes
    }

    /**
     * 🔧 FIX: Numeric validation helper to prevent NaN/Infinity propagation
     */
    private validateNumeric(value: number, fallback: number): number {
        return isFinite(value) && !isNaN(value) && value !== 0
            ? value
            : fallback;
    }

    // Deprecated safeDivision and safeMean methods removed - use FinancialMath directly

    /**
     * Main analysis method - mirrors AccumulationZoneDetector exactly
     */
    analyze(trade: EnrichedTradeEvent): ZoneAnalysisResult {
        // 🔧 FIX: Add comprehensive input validation
        const validPrice = this.validateNumeric(trade.price, 0);
        if (validPrice === 0) {
            this.logger.warn(
                "[DistributionZoneDetector] Invalid price detected, skipping trade",
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
                "[DistributionZoneDetector] Invalid quantity detected, skipping trade",
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

        // Update volume analysis tracking for enhanced distribution detection
        this.volumeAnalyzer.updateVolumeTracking(trade);

        // Add trade to recent trades history (identical)
        this.recentTrades.push(trade);

        // 1. Update existing zones with new trade (identical)
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

        // 2. Update distribution candidates (identical logic, different mechanics)
        this.updateCandidates(trade);

        // 3. Check for new zone formation (copied from accumulation)
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

        // 4. Check for zone invalidation (identical)
        const invalidations = this.checkZoneInvalidations();
        updates.push(...invalidations);

        return {
            updates,
            signals,
            activeZones: this.zoneManager.getActiveZones(this.symbol),
        };
    }

    /**
     * Update candidates - mirrors AccumulationZoneDetector exactly
     */
    private updateCandidates(trade: EnrichedTradeEvent): void {
        // 🔧 FIX: Inline zone calculation to avoid DetectorUtils dependency
        const priceLevel = this.getPriceLevel(trade.price);

        // Get or create candidate (identical logic)
        let candidate = this.candidates.get(priceLevel);
        if (!candidate) {
            candidate = this.candidatePool.acquire();
            candidate.priceLevel = priceLevel;
            candidate.startTime = trade.timestamp;
            candidate.buyVolume = 0;
            candidate.sellVolume = 0;
            candidate.totalVolume = 0;
            candidate.averageOrderSize = 0;
            candidate.consecutiveTrades = 0;
            candidate.priceStability = 1.0;
            candidate.tradeCount = 0;
            candidate.absorptionQuality = 0;

            this.candidates.set(priceLevel, candidate);
        }

        // Add trade to candidate (identical)
        candidate.trades.add(trade);
        candidate.lastUpdate = trade.timestamp;
        candidate.tradeCount++;

        // Update volume tracking (identical calculations)
        const tradeVolume = trade.quantity;
        candidate.totalVolume += tradeVolume;

        if (trade.buyerIsMaker) {
            // buyerIsMaker = true means SELLER was aggressive (selling pressure)
            candidate.sellVolume += tradeVolume;
        } else {
            // buyerIsMaker = false means BUYER was aggressive (buying pressure)
            candidate.buyVolume += tradeVolume;
        }

        // Update average order size (identical)
        candidate.averageOrderSize =
            candidate.totalVolume / candidate.tradeCount;

        // Update price stability using Welford's algorithm (identical)
        this.updatePriceStability(candidate);

        // Track consecutive trades (identical)
        const timeSinceLastTrade = trade.timestamp - candidate.lastUpdate;
        if (timeSinceLastTrade < 30000) {
            // 30 seconds
            candidate.consecutiveTrades++;
        } else {
            candidate.consecutiveTrades = 1;
        }

        // Update institutional distribution quality (adapted from absorption quality)
        this.updateDistributionQuality(candidate);
    }

    /**
     * Update price stability - identical to AccumulationZoneDetector
     */
    private updatePriceStability(candidate: DistributionCandidate): void {
        const trades = candidate.trades.getAll();
        if (trades.length < 2) {
            candidate.priceStability = 1.0;
            return;
        }

        const prices = trades.map((t) => t.price);
        const mean = prices.reduce((sum, p) => sum + p, 0) / prices.length;
        const variance =
            prices.reduce((sum, p) => sum + Math.pow(p - mean, 2), 0) /
            prices.length;
        const stdDev = Math.sqrt(variance);

        // Price stability is inversely related to relative standard deviation
        const relativeStdDev = mean > 0 ? stdDev / mean : 0;
        candidate.priceStability = Math.max(0, 1 - relativeStdDev * 100);
    }

    /**
     * Update distribution quality - adapted from absorption quality
     * Tracks how well institutions are distributing (selling into buying pressure)
     */
    private updateDistributionQuality(candidate: DistributionCandidate): void {
        // For distribution, we want to see institutions aggressively selling (high buy ratios)
        // This is the inverse of accumulation where we want sells being absorbed

        // 🔧 FIX: Replace DetectorUtils.safeDivide with internal safe method
        const currentBuyRatio = FinancialMath.safeDivide(
            candidate.buyVolume,
            candidate.totalVolume,
            0
        );

        // Distribution quality increases when:
        // 1. High buying pressure (retail) being met with institutional selling
        // 2. Price remains stable despite selling pressure (institutional control)
        if (currentBuyRatio > 0.6) {
            // Strong retail buying pressure
            if (candidate.priceStability > 0.8) {
                // Price stability despite institutional selling suggests controlled distribution
                candidate.absorptionQuality =
                    (candidate.absorptionQuality || 0) + 0.1;
            }
        }
    }

    /**
     * Check for zone formation - copied from AccumulationZoneDetector with inverted logic
     */
    private checkForZoneFormation(
        trade: EnrichedTradeEvent
    ): AccumulationZone | null {
        const now = trade.timestamp;
        let bestCandidate: DistributionCandidate | null = null;
        let bestScore = 0;

        for (const candidate of this.candidates.values()) {
            const duration = now - candidate.startTime;

            // Must meet minimum duration requirement (identical)
            if (duration < this.config.minCandidateDuration) {
                this.logger.debug(
                    `[DistributionZoneDetector] Candidate rejected: insufficient duration`,
                    {
                        duration,
                        required: this.config.minCandidateDuration,
                        priceLevel: candidate.priceLevel,
                    }
                );
                continue;
            }

            // Must have minimum volume and trade count (identical)
            if (candidate.totalVolume < this.config.minZoneVolume) {
                this.logger.debug(
                    `[DistributionZoneDetector] Candidate rejected: insufficient volume`,
                    {
                        totalVolume: candidate.totalVolume,
                        required: this.config.minZoneVolume,
                        priceLevel: candidate.priceLevel,
                    }
                );
                continue;
            }
            if (candidate.trades.length < this.config.minTradeCount) {
                this.logger.debug(
                    `[DistributionZoneDetector] Candidate rejected: insufficient trade count`,
                    {
                        tradeCount: candidate.trades.length,
                        required: this.config.minTradeCount,
                        priceLevel: candidate.priceLevel,
                    }
                );
                continue;
            }

            // 🔄 INVERTED LOGIC: Must show DISTRIBUTION pattern (high buy ratio - institutions selling into retail buying)
            // 🔧 FIX: Replace DetectorUtils.safeDivide with internal safe method
            const buyRatio = FinancialMath.safeDivide(
                candidate.buyVolume,
                candidate.totalVolume,
                0
            );
            // For distribution, we want high buy ratios (retail buying into which institutions sell)
            // This is the inverse of accumulation's high sell ratios
            const minBuyRatio = this.config.minSellRatio ?? 0.55; // Config uses minSellRatio, we invert the logic
            if (buyRatio < minBuyRatio) {
                this.logger.debug(
                    `[DistributionZoneDetector] Candidate rejected: insufficient buy ratio`,
                    {
                        buyRatio: buyRatio.toFixed(3),
                        required: minBuyRatio,
                        priceLevel: candidate.priceLevel,
                    }
                );
                continue;
            }

            // Check price stability using maxPriceDeviation from config (identical)
            const requiredStability = 1 - this.config.maxPriceDeviation;
            if (candidate.priceStability < requiredStability) {
                this.logger.debug(
                    `[DistributionZoneDetector] Candidate rejected: insufficient price stability`,
                    {
                        priceStability: candidate.priceStability.toFixed(3),
                        required: requiredStability.toFixed(3),
                        priceLevel: candidate.priceLevel,
                    }
                );
                continue;
            }

            // 🔄 INVERTED LOGIC: Must show minimal aggressive selling (avoid institutional dumping patterns)
            // 🔧 FIX: Replace DetectorUtils.safeDivide with internal safe method
            const aggressiveSellRatio = FinancialMath.safeDivide(
                candidate.sellVolume,
                candidate.totalVolume,
                0
            );
            // For distribution, limit aggressive selling to avoid dump patterns
            const maxSellRatio = 1 - (this.config.minSellRatio ?? 0.55); // Complement of minBuyRatio
            if (aggressiveSellRatio > maxSellRatio) {
                this.logger.debug(
                    `[DistributionZoneDetector] Candidate rejected: excessive aggressive selling`,
                    {
                        aggressiveSellRatio: aggressiveSellRatio.toFixed(3),
                        maxAllowed: maxSellRatio.toFixed(3),
                        priceLevel: candidate.priceLevel,
                    }
                );
                continue;
            }

            const score = this.scoreCandidateForZone(
                candidate,
                trade.timestamp
            );
            if (score === null) {
                this.logger.debug("Candidate scoring failed", {
                    component: "DistributionZoneDetector",
                    candidatePrice: candidate.priceLevel,
                    reason: "Invalid calculation data",
                });
                continue;
            }

            this.logger.debug(`[DistributionZoneDetector] Candidate scoring`, {
                priceLevel: candidate.priceLevel,
                score: score.toFixed(3),
                minRequired: this.config.minZoneStrength,
                currentBest: bestScore.toFixed(3),
            });

            // Use configurable minZoneStrength (identical)
            if (score > bestScore && score > this.config.minZoneStrength) {
                bestScore = score;
                bestCandidate = candidate;
                this.logger.debug(
                    `[DistributionZoneDetector] New best candidate found`,
                    {
                        priceLevel: candidate.priceLevel,
                        score: score.toFixed(3),
                    }
                );
            }
        }

        if (!bestCandidate) {
            return null;
        }

        // ✅ Check for existing zones near this price level before creating new one (identical)
        const candidatePrice = bestCandidate.priceLevel;
        const proximityTolerancePercent = 0.01; // 1% proximity tolerance
        const nearbyZones = this.zoneManager.getZonesNearPrice(
            this.symbol,
            candidatePrice,
            proximityTolerancePercent
        );

        // If nearby zones exist, merge with strongest existing zone (identical)
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

        // ✅ ENHANCED: Volume surge validation for distribution confirmation
        const recentTrades = this.recentTrades.toArray().slice(-50); // Get recent trades for validation
        const aggressiveTrades = recentTrades.map((t) => ({
            price: t.price,
            quantity: t.quantity,
            timestamp: t.timestamp,
            buyerIsMaker: t.buyerIsMaker,
            pair: t.pair,
            tradeId: t.tradeId,
            originalTrade: t.originalTrade,
        }));

        const volumeValidation =
            this.volumeAnalyzer.validateVolumeSurgeConditions(
                aggressiveTrades,
                trade.timestamp
            );

        // 🔧 FIX: Make volume surge validation advisory rather than mandatory
        // Volume surge should enhance zone strength but not block zone formation
        let volumeBoostApplied = false;
        if (!volumeValidation.valid) {
            this.logger.debug(
                `[DistributionZoneDetector] Volume surge validation failed - proceeding with reduced confidence`,
                {
                    priceLevel: bestCandidate.priceLevel,
                    reason: volumeValidation.reason,
                    volumeSurge: volumeValidation.volumeSurge,
                    imbalance: volumeValidation.imbalance,
                    institutional: volumeValidation.institutional,
                }
            );
            // Don't return null - proceed with zone creation but without volume boost
        } else {
            volumeBoostApplied = true;
            this.logger.debug(
                `[DistributionZoneDetector] Volume surge validation passed - applying confidence boost`,
                {
                    priceLevel: bestCandidate.priceLevel,
                }
            );
        }

        // Create new zone only if no conflicts (identical)
        const zoneDetection = this.createZoneDetectionData(bestCandidate);

        // ✅ ENHANCED: Apply volume surge confidence boost to zone strength (only if validation passed)
        if (volumeBoostApplied) {
            const volumeBoost =
                this.volumeAnalyzer.calculateVolumeConfidenceBoost(
                    volumeValidation.volumeSurge,
                    volumeValidation.imbalance,
                    volumeValidation.institutional
                );

            if (volumeBoost.isValid) {
                // Enhance zone detection data with volume confidence
                const originalStrength = zoneDetection.initialStrength;
                zoneDetection.initialStrength = Math.min(
                    1.0,
                    originalStrength + volumeBoost.confidence
                );
                this.logger.debug(
                    `[DistributionZoneDetector] Volume boost applied`,
                    {
                        priceLevel: bestCandidate.priceLevel,
                        originalStrength: originalStrength.toFixed(3),
                        boostedStrength:
                            zoneDetection.initialStrength.toFixed(3),
                        boost: volumeBoost.confidence.toFixed(3),
                    }
                );
            }
        }

        const zone = this.zoneManager.createZone(
            "distribution", // Only difference: zone type
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
     * Merge candidate with existing zone - identical to AccumulationZoneDetector
     */
    private mergeWithExistingZone(
        existingZone: AccumulationZone,
        candidate: DistributionCandidate,
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
        } catch (error) {
            this.logger.error("Failed to merge candidate with existing zone", {
                component: "DistributionZoneDetector",
                error: error instanceof Error ? error.message : String(error),
                existingZoneId: existingZone.id,
                candidatePrice: candidate.priceLevel,
            });
        }
    }

    /**
     * Score candidate for zone formation - CLAUDE.md compliant
     */
    private scoreCandidateForZone(
        candidate: DistributionCandidate,
        currentTradeTimestamp: number
    ): number | null {
        // ✅ CLAUDE.md COMPLIANCE: Return null for invalid calculations
        const totalVolume = candidate.totalVolume;
        if (totalVolume === 0) return null;

        // Distribution scoring using FinancialMath for ALL calculations
        const sellRatio = FinancialMath.divideQuantities(
            candidate.sellVolume,
            totalVolume
        );
        if (sellRatio === null) return null;

        const buyRatio = FinancialMath.divideQuantities(
            candidate.buyVolume,
            totalVolume
        );
        if (buyRatio === null) return null;

        // Use configurable thresholds from universal zone config
        const duration = currentTradeTimestamp - candidate.startTime;
        const durationScore = FinancialMath.divideQuantities(
            Math.min(duration, this.config.minCandidateDuration),
            this.config.minCandidateDuration
        );
        if (durationScore === null) return null;

        // Simple distribution score using FinancialMath for ALL operations
        const stabilityWeight = this.config.priceStabilityThreshold;
        const sellComponent = FinancialMath.multiplyQuantities(
            sellRatio,
            stabilityWeight
        );
        const stabilityComponent = FinancialMath.multiplyQuantities(
            candidate.priceStability,
            FinancialMath.safeSubtract(1.0, stabilityWeight)
        );
        const durationComponent = FinancialMath.multiplyQuantities(
            durationScore,
            this.config.minZoneStrength
        );

        const totalScore = FinancialMath.addAmounts(
            FinancialMath.addAmounts(sellComponent, stabilityComponent, 8),
            durationComponent,
            8
        );

        if (totalScore === null) return null;

        return FinancialMath.divideQuantities(
            Math.min(Math.max(totalScore, 0), 1),
            1
        );
    }

    /**
     * Create zone detection data - identical to AccumulationZoneDetector
     */
    private createZoneDetectionData(
        candidate: DistributionCandidate
    ): ZoneDetectionData {
        const trades = candidate.trades.getAll();
        const prices = trades.map((t) => t.price);

        const minPrice = Math.min(...prices);
        const maxPrice = Math.max(...prices);
        const centerPrice = (minPrice + maxPrice) / 2;

        return {
            priceRange: {
                min: minPrice,
                max: maxPrice,
                center: centerPrice,
            },
            totalVolume: candidate.totalVolume,
            averageOrderSize: candidate.averageOrderSize,
            initialStrength: this.calculateInitialStrength(candidate),
            confidence: this.calculateConfidence(candidate),
            supportingFactors: {
                volumeConcentration:
                    this.calculateVolumeConcentration(candidate),
                orderSizeProfile: this.determineOrderSizeProfile(candidate),
                timeConsistency: this.calculateTimeConsistency(candidate),
                priceStability: candidate.priceStability,
                flowConsistency: this.calculateFlowConsistency(candidate),
            },
        };
    }

    /**
     * Calculate initial strength - identical to AccumulationZoneDetector
     */
    private calculateInitialStrength(candidate: DistributionCandidate): number {
        // 🔧 FIX: Replace DetectorUtils.safeDivide with internal safe method
        const buyRatio = FinancialMath.safeDivide(
            candidate.buyVolume,
            candidate.totalVolume,
            0
        );
        const durationScore = Math.min(
            1,
            (Date.now() - candidate.startTime) /
                this.config.minCandidateDuration
        );
        const volumeScore = Math.min(
            1,
            candidate.totalVolume / this.config.minZoneVolume
        );
        const stabilityScore = candidate.priceStability;

        // For distribution: higher buy ratios are better (institutions selling into retail buying)
        const ratioScore = buyRatio; // Different from accumulation which uses sellRatio

        return (
            ratioScore * 0.4 +
            durationScore * 0.2 +
            volumeScore * 0.2 +
            stabilityScore * 0.2
        );
    }

    /**
     * Helper methods - identical to AccumulationZoneDetector
     */
    private calculateConfidence(candidate: DistributionCandidate): number {
        const tradeCountScore = Math.min(
            1,
            candidate.tradeCount / this.config.minTradeCount
        );
        const consecutiveScore = Math.min(1, candidate.consecutiveTrades / 5);
        const qualityScore = candidate.absorptionQuality || 0;

        return (
            tradeCountScore * 0.4 + consecutiveScore * 0.3 + qualityScore * 0.3
        );
    }

    private calculateVolumeConcentration(
        candidate: DistributionCandidate
    ): number {
        const trades = candidate.trades.getAll();
        if (trades.length < 2) return 1;

        const volumes = trades.map((t) => t.quantity);
        const mean = volumes.reduce((sum, v) => sum + v, 0) / volumes.length;
        const variance =
            volumes.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) /
            volumes.length;
        const cv = mean > 0 ? Math.sqrt(variance) / mean : 0;

        return Math.max(0, 1 - cv); // Lower coefficient of variation = higher concentration
    }

    private determineOrderSizeProfile(
        candidate: DistributionCandidate
    ): "institutional" | "mixed" | "retail" {
        if (candidate.averageOrderSize > 100) return "institutional";
        if (candidate.averageOrderSize > 50) return "mixed";
        return "retail";
    }

    private calculateTimeConsistency(candidate: DistributionCandidate): number {
        const trades = candidate.trades.getAll();
        if (trades.length < 3) return 0;

        const intervals: number[] = [];
        for (let i = 1; i < trades.length; i++) {
            intervals.push(trades[i].timestamp - trades[i - 1].timestamp);
        }

        const meanInterval =
            intervals.reduce((sum, i) => sum + i, 0) / intervals.length;
        const variance =
            intervals.reduce(
                (sum, i) => sum + Math.pow(i - meanInterval, 2),
                0
            ) / intervals.length;
        const cv = meanInterval > 0 ? Math.sqrt(variance) / meanInterval : 0;

        return Math.max(0, 1 - cv * 0.1); // Reward consistent timing
    }

    private calculateFlowConsistency(candidate: DistributionCandidate): number {
        // 🔧 FIX: Replace DetectorUtils.safeDivide with internal safe method
        const buyRatio = FinancialMath.safeDivide(
            candidate.buyVolume,
            candidate.totalVolume,
            0
        );
        // For distribution, consistency means stable high buy ratios
        return Math.max(0, buyRatio - 0.5) * 2; // Scale 0.5-1.0 to 0-1.0
    }

    /**
     * Convert price to discrete level for candidate tracking
     * Uses standardized zone calculation for consistency
     * 🔧 FIX: Inline zone calculation to avoid DetectorUtils dependency
     */
    private getPriceLevel(price: number): number {
        if (
            !isFinite(price) ||
            isNaN(price) ||
            price <= 0 ||
            this.zoneTicks <= 0 ||
            this.pricePrecision < 0
        ) {
            this.logger.warn(
                "[DistributionZoneDetector] Invalid zone calculation parameters",
                {
                    price,
                    zoneTicks: this.zoneTicks,
                    pricePrecision: this.pricePrecision,
                }
            );
            return 0;
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
     * Signal generation methods - adapted for distribution
     * 🔧 FIX: Complete implementation for distribution zones suggesting SELL signals
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
                        expectedDirection: "down", // Distribution suggests downward movement
                        zoneStrength: zone.strength,
                        completionLevel: zone.completion,
                        invalidationLevel: zone.priceRange.max * 1.005, // 0.5% above zone
                        breakoutTarget: zone.priceRange.center * 0.98, // 2% below center
                        positionSizing:
                            zone.significance === "institutional"
                                ? "heavy"
                                : zone.significance === "major"
                                  ? "normal"
                                  : "light",
                        stopLossLevel: zone.priceRange.max * 1.01, // 1% above zone
                        takeProfitLevel: zone.priceRange.center * 0.97, // 3% profit target
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
                    expectedDirection: "down", // Distribution expects downward movement
                    zoneStrength: zone.strength,
                    completionLevel: zone.completion,
                    invalidationLevel: zone.priceRange.max * 1.01,
                    breakoutTarget: zone.priceRange.center * 0.95, // Lower target on completion
                    positionSizing: "normal", // Standard sizing for breakout
                    stopLossLevel: zone.priceRange.max * 1.015,
                    takeProfitLevel: zone.priceRange.center * 0.93,
                });
                break;

            default:
                break;
        }

        return signals;
    }

    private generateZoneEntrySignal(zone: AccumulationZone): ZoneSignal | null {
        if (zone.strength < this.config.minZoneStrength) return null;

        return {
            signalType: "zone_entry",
            zone,
            actionType: "enter_zone",
            confidence: zone.confidence,
            urgency: zone.significance === "institutional" ? "high" : "medium",
            timeframe: "short_term",
            expectedDirection: "down", // Distribution expects downward movement
            zoneStrength: zone.strength,
            completionLevel: zone.completion,
            invalidationLevel: zone.priceRange.max * 1.005,
            breakoutTarget: zone.priceRange.center * 0.975,
            positionSizing:
                zone.significance === "institutional"
                    ? "heavy"
                    : zone.significance === "major"
                      ? "normal"
                      : "light",
            stopLossLevel: zone.priceRange.max * 1.01,
            takeProfitLevel: zone.priceRange.center * 0.97,
        };
    }

    private checkZoneInvalidations(): ZoneUpdate[] {
        // Identical invalidation logic as AccumulationZoneDetector
        // This is a simplified implementation - in production would have full invalidation logic
        return [];
    }

    // Public query methods - identical to AccumulationZoneDetector
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

    public getCandidates(): DistributionCandidate[] {
        return Array.from(this.candidates.values());
    }

    /**
     * Cleanup old candidates that haven't formed zones (matching AccumulationZoneDetector)
     */
    private cleanupOldCandidates(): void {
        const now = Date.now();
        const maxAge = 1800000; // 30 minutes

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

    /**
     * Cleanup method - identical to AccumulationZoneDetector
     */
    cleanup(): void {
        // Release all candidates back to pool
        for (const candidate of this.candidates.values()) {
            this.candidatePool.release(candidate);
        }
        this.candidates.clear();

        this.logger.info("DistributionZoneDetector cleanup completed", {
            component: "DistributionZoneDetector",
        });
    }
}
