// src/indicators/exhaustionDetector.ts
import { BaseDetector, ZoneSample } from "./base/baseDetector.js";
import type { ILogger } from "../infrastructure/loggerInterface.js";
import type { IMetricsCollector } from "../infrastructure/metricsCollectorInterface.js";
import { ISignalLogger } from "../infrastructure/signalLoggerInterface.js";
import { RollingWindow } from "../utils/rollingWindow.js";
import { FinancialMath } from "../utils/financialMath.js";
import { SpoofingDetector } from "../services/spoofingDetector.js";
import { SharedPools } from "../utils/objectPool.js";
import { AdaptiveThresholds } from "./marketRegimeDetector.js";

import type {
    EnrichedTradeEvent,
    AggressiveTrade,
} from "../types/marketEvents.js";
import type {
    IExhaustionDetector,
    BaseDetectorSettings,
    ExhaustionFeatures,
} from "./interfaces/detectorInterfaces.js";
import { SignalType, ExhaustionSignalData } from "../types/signalTypes.js";
import { DepthLevel } from "../utils/interfaces.js";
import { VolumeAnalyzer } from "./utils/volumeAnalyzer.js";
import type { VolumeSurgeConfig } from "./interfaces/volumeAnalysisInterface.js";

export interface ExhaustionSettings extends BaseDetectorSettings {
    features?: ExhaustionFeatures;
    // Exhaustion-specific settings
    exhaustionThreshold?: number; // Minimum exhaustion score (0-1)
    maxPassiveRatio?: number; // Max ratio of current/avg passive for exhaustion
    minDepletionFactor?: number; // Min factor for passive depletion detection

    // Volume surge detection parameters for enhanced exhaustion analysis
    volumeSurgeMultiplier?: number; // Volume surge threshold for exhaustion validation
    imbalanceThreshold?: number; // Order flow imbalance threshold for exhaustion
    institutionalThreshold?: number; // Institutional trade size threshold
    burstDetectionMs?: number; // Burst detection window
    sustainedVolumeMs?: number; // Sustained volume analysis window
    medianTradeSize?: number; // Baseline trade size for volume analysis
}

type DetectorResult<T> =
    | { success: true; data: T }
    | { success: false; error: Error; fallbackSafe: boolean };

/**
 * Conditions analyzed for exhaustion detection
 */
interface ExhaustionConditions {
    aggressiveVolume: number;
    currentPassive: number;
    avgPassive: number;
    minPassive: number;
    maxPassive: number;
    avgLiquidity: number;
    passiveRatio: number; // current/avg passive
    depletionRatio: number; // aggressive/avg passive
    refillGap: number; // change in passive over window
    imbalance: number; // bid/ask imbalance
    spread: number; // current spread ratio
    passiveVelocity: number; // rate of passive change
    sampleCount: number; // number of samples used
    isValid: boolean;
    confidence: number; // 0-1 confidence in the data
    dataQuality: "high" | "medium" | "low" | "insufficient";
    // Additional fields for consistency with absorption detector
    absorptionRatio: number; // alias for depletionRatio for compatibility
    passiveStrength: number; // alias for passiveRatio for compatibility
    consistency: number; // how consistently passive is maintained
    velocityIncrease: number; // velocity change over time
    dominantSide: "buy" | "sell" | "neutral"; // which side is dominant
    hasRefill: boolean; // whether passive refill was detected
    icebergSignal: number; // iceberg detection score (0-1)
    liquidityGradient: number; // liquidity gradient around zone
}

/**
 * Exhaustion detector – identifies when one side of the orderbook is depleted.
 * Production-ready with enhanced error handling, metrics, and configuration.
 */
export class ExhaustionDetector
    extends BaseDetector
    implements IExhaustionDetector
{
    protected readonly detectorType = "exhaustion" as const;
    protected readonly features: ExhaustionFeatures;

    // 🔧 FIX: Atomic circuit breaker state
    private readonly circuitBreakerState = {
        errorCount: 0,
        lastErrorTime: 0,
        isOpen: false,
        maxErrors: 5,
        errorWindowMs: 60000, // 1 minute
    };

    // Exhaustion-specific configuration
    private readonly exhaustionThreshold: number;
    private readonly maxPassiveRatio: number;
    private readonly minDepletionFactor: number;

    // Volume surge analysis integration
    private readonly volumeAnalyzer: VolumeAnalyzer;
    private readonly volumeSurgeConfig: VolumeSurgeConfig;

    // 🔧 FIX: Remove duplicate threshold update interval (already handled by BaseDetector)
    // Interval handle for periodic threshold updates - REMOVED to eliminate race condition
    // private thresholdUpdateInterval?: NodeJS.Timeout;

    constructor(
        id: string,
        settings: ExhaustionSettings = {},
        logger: ILogger,
        spoofingDetector: SpoofingDetector,
        metricsCollector: IMetricsCollector,
        signalLogger?: ISignalLogger
    ) {
        super(
            id,
            settings,
            logger,
            spoofingDetector,
            metricsCollector,
            signalLogger
        );

        // 🔧 FIX: Enhanced configuration validation
        this.exhaustionThreshold = this.validateConfigValue(
            settings.exhaustionThreshold ?? 0.7,
            0.1,
            1.0,
            0.7,
            "exhaustionThreshold"
        );
        this.maxPassiveRatio = this.validateConfigValue(
            settings.maxPassiveRatio ?? 0.3,
            0.1,
            1.0,
            0.3,
            "maxPassiveRatio"
        );
        this.minDepletionFactor = this.validateConfigValue(
            settings.minDepletionFactor ?? 0.5,
            0.1,
            10.0,
            0.5,
            "minDepletionFactor"
        );

        // Initialize volume surge configuration
        this.volumeSurgeConfig = {
            volumeSurgeMultiplier: settings.volumeSurgeMultiplier ?? 3.0,
            imbalanceThreshold: settings.imbalanceThreshold ?? 0.3,
            institutionalThreshold: settings.institutionalThreshold ?? 15.0,
            burstDetectionMs: settings.burstDetectionMs ?? 1500,
            sustainedVolumeMs: settings.sustainedVolumeMs ?? 25000,
            medianTradeSize: settings.medianTradeSize ?? 0.8,
        };

        // Initialize volume analyzer for enhanced exhaustion detection
        this.volumeAnalyzer = new VolumeAnalyzer(
            this.volumeSurgeConfig,
            logger,
            `${id}_exhaustion`
        );

        // Merge exhaustion-specific features
        this.features = {
            depletionTracking: true,
            spreadAdjustment: true,
            volumeVelocity: false,
            ...settings.features,
        };

        // 🔧 FIX: Remove duplicate threshold updates - BaseDetector already handles this
        // Duplicate threshold update interval removed to prevent race conditions

        // Initialize circuit breaker state
        this.circuitBreakerState.isOpen = false;
        this.circuitBreakerState.errorCount = 0;
    }

    /**
     * 🔧 FIX: Configuration validation utility
     */
    private validateConfigValue(
        value: number,
        min: number,
        max: number,
        defaultValue: number,
        name: string
    ): number {
        if (!isFinite(value) || value < min || value > max) {
            this.logger.warn(
                `[ExhaustionDetector] Invalid ${name}: ${value}, using default: ${defaultValue}`,
                {
                    value,
                    min,
                    max,
                    defaultValue,
                    configKey: name,
                }
            );
            return defaultValue;
        }
        return value;
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
    // Deprecated safeDivision method removed - use FinancialMath.safeDivide() directly

    /**
     * 🔧 FIX: Safe mean calculation to replace DetectorUtils.calculateMean
     */

    /**
     * 🔧 FIX: Simple config implementation with type safety
     */
    private readonly config = {
        maxZones: 100,
        zoneAgeLimit: 3600000, // 1 hour
    };

    private getConfigValue<T>(
        key: keyof typeof this.config,
        defaultValue: T
    ): T {
        return (this.config[key] as T) ?? defaultValue;
    }

    protected getSignalType(): SignalType {
        return "exhaustion";
    }

    /* ------------------------------------------------------------------ */
    /*  Incoming enriched trade                                           */
    /* ------------------------------------------------------------------ */
    public onEnrichedTrade(event: EnrichedTradeEvent): void {
        // 🔧 FIX: Add comprehensive input validation to prevent NaN/Infinity propagation
        const validPrice = this.validateNumeric(event.price, 0);
        if (validPrice === 0) {
            this.logger.warn(
                "[ExhaustionDetector] Invalid price detected, skipping trade",
                {
                    price: event.price,
                    quantity: event.quantity,
                    timestamp: event.timestamp,
                    pair: event.pair,
                }
            );
            return;
        }

        const validQuantity = this.validateNumeric(event.quantity, 0);
        if (validQuantity === 0) {
            this.logger.warn(
                "[ExhaustionDetector] Invalid quantity detected, skipping trade",
                {
                    price: event.price,
                    quantity: event.quantity,
                    timestamp: event.timestamp,
                    pair: event.pair,
                }
            );
            return;
        }

        // Validate passive volume values
        const validBidVolume = Math.max(0, event.zonePassiveBidVolume || 0);
        const validAskVolume = Math.max(0, event.zonePassiveAskVolume || 0);

        const zone = this.calculateZone(validPrice);

        // create window if absent
        if (!this.zonePassiveHistory.has(zone)) {
            this.zonePassiveHistory.set(
                zone,
                new RollingWindow<ZoneSample>(100, false)
            );
        }
        const zoneHistory = this.zonePassiveHistory.get(zone)!;

        // duplicate-snapshot guard
        const lastSnap =
            zoneHistory.count() > 0 ? zoneHistory.toArray().at(-1)! : null;

        // Use object pool to reduce GC pressure
        const snap = SharedPools.getInstance().zoneSamples.acquire();
        snap.bid = validBidVolume;
        snap.ask = validAskVolume;
        snap.total = validBidVolume + validAskVolume;
        snap.timestamp = event.timestamp;

        const spread = this.getCurrentSpread()?.spread ?? 0;
        this.adaptiveThresholdCalculator.updateMarketData(
            validPrice,
            validQuantity,
            spread
        );

        if (
            !lastSnap ||
            lastSnap.bid !== snap.bid ||
            lastSnap.ask !== snap.ask
        ) {
            // Use pool-aware push to handle evicted objects
            this.pushToZoneHistoryWithPoolCleanup(zoneHistory, snap);
        } else {
            // Release snapshot back to pool if not used
            SharedPools.getInstance().zoneSamples.release(snap);
        }

        // add trade exactly once
        if (this.lastTradeId !== event.tradeId) {
            this.lastTradeId = event.tradeId;
            this.addTrade(event); // EnrichedTradeEvent extends AggressiveTrade
        }

        // 🔧 FIX: Auto zone cleanup after zone creation
        if (
            this.zonePassiveHistory.size > this.getConfigValue("maxZones", 100)
        ) {
            this.cleanupZoneMemory();
        }
    }

    private calculateExhaustionScore(conditions: ExhaustionConditions): number {
        // 🔧 FIX: Use BaseDetector's threshold management instead of duplicate calls
        const thresholds = this.getAdaptiveThresholds();

        // 🔧 FIX: Define normalized weight constants to prevent score overflow
        const weights = {
            depletion: 0.4, // Primary exhaustion factor
            passive: 0.25, // Passive liquidity depletion
            continuity: 0.15, // Continuous depletion trend
            imbalance: 0.1, // Market imbalance
            spread: 0.08, // Spread widening
            velocity: 0.02, // Volume velocity
        };

        let weightedScore = 0;

        // Factor 1: Normalized depletion ratio scoring
        let depletionScore = 0;
        if (conditions.depletionRatio > thresholds.depletionLevels.extreme) {
            depletionScore = 1.0; // Maximum depletion
        } else if (
            conditions.depletionRatio > thresholds.depletionLevels.high
        ) {
            depletionScore = 0.75; // High depletion
        } else if (
            conditions.depletionRatio > thresholds.depletionLevels.moderate
        ) {
            depletionScore = 0.5; // Moderate depletion
        } else {
            // Proportional scoring below moderate threshold
            depletionScore = Math.min(
                0.5,
                conditions.depletionRatio / thresholds.depletionLevels.moderate
            );
        }
        weightedScore += depletionScore * weights.depletion;

        // Factor 2: Normalized passive strength scoring
        let passiveScore = 0;
        if (
            conditions.passiveRatio <
            thresholds.passiveRatioLevels.severeDepletion
        ) {
            passiveScore = 1.0; // Severely depleted
        } else if (
            conditions.passiveRatio <
            thresholds.passiveRatioLevels.moderateDepletion
        ) {
            passiveScore = 0.6; // Moderately depleted
        } else if (
            conditions.passiveRatio <
            thresholds.passiveRatioLevels.someDepletion
        ) {
            passiveScore = 0.3; // Somewhat depleted
        } else {
            // Proportional scoring - higher ratio = lower depletion score
            passiveScore = Math.max(0, 1 - conditions.passiveRatio);
        }
        weightedScore += passiveScore * weights.passive;

        // Factor 3: Normalized continuous depletion - 🔧 FIX: Fixed impossible threshold
        const depletionThreshold = conditions.avgPassive * 0.2; // 20% of average passive (FIXED)
        let continuityScore = 0;
        if (conditions.refillGap < -depletionThreshold) {
            continuityScore = 1.0; // Strong continuous depletion
        } else if (conditions.refillGap < 0) {
            continuityScore =
                Math.abs(conditions.refillGap) / depletionThreshold; // Proportional
        }
        weightedScore += continuityScore * weights.continuity;

        // Factor 4: Normalized imbalance scoring
        let imbalanceScore = 0;
        if (conditions.imbalance > 0.8) {
            imbalanceScore = 1.0;
        } else if (conditions.imbalance > 0.6) {
            imbalanceScore = 0.5;
        } else {
            imbalanceScore = Math.max(0, (conditions.imbalance - 0.5) / 0.3); // Scale from 0.5-0.8 to 0-1
        }
        weightedScore += imbalanceScore * weights.imbalance;

        // Factor 5: Normalized spread scoring
        let spreadScore = 0;
        if (this.features.spreadAdjustment) {
            if (conditions.spread > 0.005) {
                spreadScore = 1.0;
            } else if (conditions.spread > 0.002) {
                spreadScore = 0.6;
            } else {
                spreadScore = Math.max(0, conditions.spread / 0.002); // Proportional to 0.002 threshold
            }
        }
        weightedScore += spreadScore * weights.spread;

        // Factor 6: Normalized velocity scoring
        let velocityScore = 0;
        if (this.features.volumeVelocity && conditions.passiveVelocity < -100) {
            velocityScore = Math.min(
                1.0,
                Math.abs(conditions.passiveVelocity) / 200
            ); // Scale negative velocity
        }
        weightedScore += velocityScore * weights.velocity;

        // Apply data quality penalty
        if (conditions.sampleCount < 5) {
            weightedScore *= 0.7;
        }

        // 🔧 FIX: Ensure score never exceeds 1.0 and meets minimum confidence
        const finalScore = Math.max(0, Math.min(1, weightedScore));
        return finalScore >= thresholds.minimumConfidence ? finalScore : 0;
    }

    /**
     * Maybe update thresholds based on time or performance
     */
    // 🔧 FIX: Remove duplicate threshold update methods - BaseDetector handles this
    // maybeUpdateThresholds() and updateThresholds() removed to eliminate race conditions
    // All threshold updates now handled by BaseDetector's updateAdaptiveThresholds()

    /**
     * Check if threshold changes are significant
     */
    private hasSignificantChange(
        old: AdaptiveThresholds,
        current: AdaptiveThresholds
    ): boolean {
        const threshold = 0.1; // 10% change threshold

        return (
            Math.abs(
                old.depletionLevels.extreme - current.depletionLevels.extreme
            ) /
                old.depletionLevels.extreme >
                threshold ||
            Math.abs(old.scores.extreme - current.scores.extreme) /
                old.scores.extreme >
                threshold ||
            Math.abs(old.minimumConfidence - current.minimumConfidence) /
                old.minimumConfidence >
                threshold
        );
    }

    /**
     * Exhaustion-specific trade handling (called by base class)
     */
    protected onEnrichedTradeSpecific(event: EnrichedTradeEvent): void {
        // Update volume analysis tracking for enhanced exhaustion detection
        this.volumeAnalyzer.updateVolumeTracking(event);
        void event;
    }

    /**
     * Main detection loop for exhaustion patterns
     */
    protected checkForSignal(triggerTrade: AggressiveTrade): void {
        const now = Date.now();
        const zoneTicks = this.getEffectiveZoneTicks();

        try {
            // Get recent trades within window
            const recentTrades = this.trades.filter(
                (t) => now - t.timestamp < this.windowMs
            );

            if (recentTrades.length === 0) {
                return;
            }

            // Group trades by zones for analysis
            const zoneMap = this.groupTradesByZone(recentTrades, zoneTicks);

            // Analyze each zone for exhaustion patterns
            for (const [zone, tradesAtZone] of zoneMap) {
                if (tradesAtZone.length === 0) continue;

                this.analyzeZoneForExhaustion(
                    zone,
                    tradesAtZone,
                    triggerTrade,
                    zoneTicks
                );
            }

            // Record detection attempt metrics
            this.metricsCollector.incrementMetric(
                "exhaustionDetectionAttempts"
            );
            //this.metricsCollector.recordGauge('exhaustion.zones.analyzed', zoneMap.size);
        } catch (error) {
            this.handleError(
                error as Error,
                "ExhaustionDetector.checkForSignal"
            );
            this.metricsCollector.incrementMetric("exhaustionDetectionErrors");
        }
    }

    /**
     * Analyze a specific zone for exhaustion patterns
     */
    private analyzeZoneForExhaustion(
        zone: number,
        tradesAtZone: AggressiveTrade[],
        triggerTrade: AggressiveTrade,
        zoneTicks: number
    ): void {
        const latestTrade = tradesAtZone[tradesAtZone.length - 1];
        const price = +latestTrade.price.toFixed(this.pricePrecision);
        const side = this.getTradeSide(latestTrade);

        // Get current book level
        const bookLevel = this.getBookLevel(price, zone, side);
        if (!bookLevel) {
            this.logger.warn(`[ExhaustionDetector] No book data available`, {
                zone,
                price,
                side,
                hasZoneHistory: this.zonePassiveHistory.has(zone),
            });
            return;
        }

        // Check cooldown to prevent spam (update after confirmation)
        if (!this.checkCooldown(zone, side, false)) {
            return;
        }

        // Analyze exhaustion conditions
        const conditionsResult = this.analyzeExhaustionConditionsSafe(
            price,
            side,
            zone
        );

        if (!conditionsResult.success) {
            // Handle error appropriately based on type
            if (conditionsResult.fallbackSafe) {
                return;
            } else {
                this.pauseDetectorTemporarily(conditionsResult.error);
                return;
            }
        }

        const conditions = conditionsResult.data;
        if (conditions.dataQuality === "insufficient") {
            return;
        }

        // Calculate score with confidence adjustment
        const baseScore = this.calculateExhaustionScore(conditions);
        const adjustedScore = baseScore * conditions.confidence;

        // Apply stricter threshold for low-quality data
        const effectiveThreshold =
            conditions.dataQuality === "low"
                ? this.exhaustionThreshold * 1.2
                : this.exhaustionThreshold;

        if (adjustedScore < effectiveThreshold) {
            return;
        }

        // Calculate zone volumes
        const volumes = this.calculateZoneVolumes(
            zone,
            tradesAtZone,
            zoneTicks
        );

        // Skip if insufficient volume
        if (volumes.aggressive < this.minAggVolume) {
            return;
        }

        // Check for spoofing if enabled (includes layering detection)
        if (
            this.features.spoofingDetection &&
            (this.isSpoofed(price, side, triggerTrade.timestamp) ||
                this.detectLayeringAttack(price, side, triggerTrade.timestamp))
        ) {
            this.metricsCollector.incrementMetric("exhaustionSpoofingRejected");
            return;
        }

        // ✅ ENHANCED: Volume surge validation for exhaustion confirmation
        const volumeValidation =
            this.volumeAnalyzer.validateVolumeSurgeConditions(
                tradesAtZone,
                triggerTrade.timestamp
            );

        if (!volumeValidation.valid) {
            this.logger.debug(
                `[ExhaustionDetector] Exhaustion signal rejected - volume surge validation failed`,
                {
                    zone,
                    price,
                    side,
                    score: adjustedScore,
                    reason: volumeValidation.reason,
                }
            );
            return;
        }

        // Check for refill
        const oppositeQty = side === "buy" ? bookLevel.ask : bookLevel.bid;
        const refilled = this.checkRefill(price, side, oppositeQty);

        if (refilled) {
            this.metricsCollector.incrementMetric("exhaustionRefillRejected");
            return;
        }

        // ✅ ENHANCED: Apply volume surge confidence boost
        const volumeBoost = this.volumeAnalyzer.calculateVolumeConfidenceBoost(
            volumeValidation.volumeSurge,
            volumeValidation.imbalance,
            volumeValidation.institutional
        );

        let finalConfidence = adjustedScore;
        if (volumeBoost.isValid) {
            finalConfidence += volumeBoost.confidence;

            this.logger.debug(
                `[ExhaustionDetector] Volume surge confidence boost applied`,
                {
                    zone,
                    price,
                    side,
                    originalConfidence: adjustedScore,
                    volumeBoost: volumeBoost.confidence,
                    finalConfidence,
                    reason: volumeBoost.reason,
                    enhancementFactors: volumeBoost.enhancementFactors,
                    metadata: volumeBoost.metadata,
                }
            );
        }

        this.logger.info(`[ExhaustionDetector] 🎯 SIGNAL GENERATED!`, {
            zone,
            price,
            side,
            aggressive: volumes.aggressive,
            passive: volumes.passive,
            oppositeQty,
            baseScore,
            adjustedScore,
            confidence: conditions.confidence,
            conditions: {
                depletionRatio: conditions.depletionRatio,
                passiveRatio: conditions.passiveRatio,
                consistency: conditions.consistency,
                velocityIncrease: conditions.velocityIncrease,
                hasRefill: conditions.hasRefill,
                icebergSignal: conditions.icebergSignal,
            },
        });

        const signal: ExhaustionSignalData = {
            price,
            side,
            aggressive: volumes.aggressive,
            oppositeQty,
            avgLiquidity: conditions.avgLiquidity,
            spread: conditions.spread,
            confidence: Math.min(1, finalConfidence), // Cap at 1.0
            meta: {
                conditions,
                detectorVersion: "2.1-safe",
                dataQuality: conditions.dataQuality,
                originalConfidence: baseScore,
            },
        };

        this.handleDetection(signal);

        this.metricsCollector.updateMetric(
            `detector_${this.detectorType}Aggressive_volume`,
            signal.aggressive
        );
        this.metricsCollector.incrementMetric("exhaustionSignalsGenerated");
        this.metricsCollector.recordHistogram(
            "exhaustion.score",
            adjustedScore
        );
    }

    private findNearestPriceLevels(
        targetPrice: number,
        maxResults: number = 5
    ): number[] {
        const allPrices = Array.from(this.depth.keys())
            .filter((p) => typeof p === "number" && isFinite(p))
            .sort(
                (a, b) => Math.abs(a - targetPrice) - Math.abs(b - targetPrice)
            );

        return allPrices.slice(0, maxResults);
    }

    private getBookLevelFromZoneHistory(zone: number): DepthLevel | undefined {
        const zoneHistory = this.zonePassiveHistory.get(zone);
        if (!zoneHistory || zoneHistory.count() === 0) {
            return undefined; // ✅ Return undefined instead of null
        }

        const latestSnapshot = zoneHistory.toArray().at(-1);
        if (!latestSnapshot) {
            return undefined; // ✅ Return undefined instead of null
        }

        // ✅ Return proper DepthLevel object
        return {
            bid: latestSnapshot.bid,
            ask: latestSnapshot.ask,
        } as DepthLevel; // ✅ Cast to DepthLevel type
    }

    private getBookLevelFromRecentTrade(zone: number): DepthLevel | undefined {
        // Find recent trades in this zone
        const now = Date.now();
        const recentTrades = this.trades.filter((trade) => {
            const tradeZone = this.calculateZone(trade.price);
            return tradeZone === zone && now - trade.timestamp < 30000; // Last 30 seconds
        });

        if (recentTrades.length === 0) {
            return undefined;
        }

        // Get the most recent trade
        const latestTrade = recentTrades[recentTrades.length - 1];

        // If it's an EnrichedTradeEvent, it should have passive volume data
        if (
            "zonePassiveBidVolume" in latestTrade &&
            "zonePassiveAskVolume" in latestTrade
        ) {
            const enrichedTrade = latestTrade as EnrichedTradeEvent;
            return {
                bid: enrichedTrade.zonePassiveBidVolume,
                ask: enrichedTrade.zonePassiveAskVolume,
            };
        }

        return undefined;
    }

    private getBookLevel(
        price: number,
        zone: number,
        side: "buy" | "sell"
    ): { bid: number; ask: number } | null {
        const opposite = side === "buy" ? "ask" : "bid";

        // Method 1: Use depth data at the given price or nearest levels
        let bookLevel = this.depth.get(price);
        if (!bookLevel || bookLevel[opposite] === 0) {
            const nearestPrices = this.findNearestPriceLevels(price, 3);
            for (const p of nearestPrices) {
                const level = this.depth.get(p);
                if (level && level[opposite] > 0) {
                    bookLevel = level;
                    break;
                }
            }
        }
        if (bookLevel && (bookLevel.bid > 0 || bookLevel.ask > 0)) {
            return bookLevel;
        }

        // Method 2: Use zone passive history
        bookLevel = this.getBookLevelFromZoneHistory(zone);
        if (bookLevel && (bookLevel.bid > 0 || bookLevel.ask > 0)) {
            return bookLevel;
        }

        // Method 3: Fallback to recent trade data
        bookLevel = this.getBookLevelFromRecentTrade(zone);
        if (bookLevel && (bookLevel.bid > 0 || bookLevel.ask > 0)) {
            return bookLevel;
        }

        return null;
    }

    protected handleDetection(signal: ExhaustionSignalData): void {
        this.recentSignalCount++; // NEW: Track signal count

        // 🔧 FIX: Lighter signal metadata - keep only essential information
        signal.meta = {
            detectorVersion: "2.1-safe",
            dataQuality: "unknown", // Simplified for type safety
            originalConfidence: signal.confidence,
            // Remove large objects, add summaries instead
        };

        this.metricsCollector.updateMetric(
            `detector_${this.detectorType}Aggressive_volume`,
            signal.aggressive
        );
        this.metricsCollector.incrementMetric("exhaustionSignalsGenerated");
        this.metricsCollector.recordHistogram(
            "exhaustion.score",
            signal.confidence
        );

        // Call parent handleDetection
        super.handleDetection(signal);
    }

    /**
     * 🔧 FIX: Enhanced cleanup with zone memory management
     */
    public cleanup(): void {
        // Clean up zone passive history to prevent memory leaks
        this.cleanupZoneMemory();

        // Reset circuit breaker state
        this.circuitBreakerState.errorCount = 0;
        this.circuitBreakerState.isOpen = false;
        this.circuitBreakerState.lastErrorTime = 0;

        super.cleanup();
    }

    /**
     * 🔧 FIX: Zone memory cleanup to prevent memory leaks
     */
    private cleanupZoneMemory(): void {
        // 🔧 FIX: Adaptive cleanup thresholds based on memory pressure
        const memUsage = process.memoryUsage();
        const heapUsedMB = memUsage.heapUsed / 1024 / 1024;

        let maxZones = this.getConfigValue("maxZones", 100);
        let zoneAgeLimit = this.getConfigValue("zoneAgeLimit", 3600000); // 1 hour default

        // Adaptive thresholds based on memory pressure
        if (heapUsedMB > 1000) {
            // Above 1GB - more aggressive cleanup
            maxZones = Math.floor(maxZones * 0.5);
            zoneAgeLimit = Math.floor(zoneAgeLimit * 0.5);
        } else if (heapUsedMB > 500) {
            // Above 500MB - moderate cleanup
            maxZones = Math.floor(maxZones * 0.7);
            zoneAgeLimit = Math.floor(zoneAgeLimit * 0.7);
        }

        const now = Date.now();

        // Clean up old zones
        for (const [zone, history] of this.zonePassiveHistory.entries()) {
            const samples = history.toArray();
            if (samples.length === 0) {
                this.zonePassiveHistory.delete(zone);
                continue;
            }

            const lastUpdate = samples[samples.length - 1]?.timestamp || 0;
            if (now - lastUpdate > zoneAgeLimit) {
                // Release all zone samples back to pool before deletion
                samples.forEach((sample) => {
                    try {
                        SharedPools.getInstance().zoneSamples.release(sample);
                    } catch {
                        // Ignore release errors - sample may not be from pool
                    }
                });
                this.zonePassiveHistory.delete(zone);
            }
        }

        // Enforce zone count limit
        if (this.zonePassiveHistory.size > maxZones) {
            const zoneEntries = Array.from(this.zonePassiveHistory.entries());

            // Sort by last update time (oldest first)
            zoneEntries.sort((a, b) => {
                const aLastUpdate = a[1].toArray().at(-1)?.timestamp || 0;
                const bLastUpdate = b[1].toArray().at(-1)?.timestamp || 0;
                return aLastUpdate - bLastUpdate;
            });

            // Remove oldest zones
            const zonesToRemove = zoneEntries.slice(
                0,
                zoneEntries.length - maxZones
            );
            for (const [zone, history] of zonesToRemove) {
                const samples = history.toArray();
                samples.forEach((sample) => {
                    try {
                        SharedPools.getInstance().zoneSamples.release(sample);
                    } catch {
                        // Ignore release errors
                    }
                });
                this.zonePassiveHistory.delete(zone);
            }
        }
    }

    /**
     * Validate input parameters
     */
    private validateInputs(
        price: number,
        side: "buy" | "sell",
        zone: number
    ): boolean {
        if (!isFinite(price) || price <= 0) return false;
        if (side !== "buy" && side !== "sell") return false;
        if (!isFinite(zone)) return false;
        return true;
    }

    /**
     * Get and validate historical data
     */
    private getValidatedHistoricalData(
        price: number,
        side: "buy" | "sell",
        zone: number
    ): DetectorResult<{
        avgLiquidity: number;
        spreadInfo: { spread: number } | null;
        recentAggressive: number;
        samples: ZoneSample[];
    }> {
        try {
            const avgLiquidity =
                this.passiveVolumeTracker.getAveragePassiveBySide(
                    price,
                    side === "buy" ? "sell" : "buy",
                    this.windowMs
                );

            if (!isFinite(avgLiquidity) || avgLiquidity < 0) {
                return {
                    success: false,
                    error: new Error("Invalid average liquidity data"),
                    fallbackSafe: true,
                };
            }

            const spreadInfo = this.getCurrentSpread();
            const recentAggressive = this.getAggressiveVolumeAtPrice(
                price,
                5000
            );

            if (!isFinite(recentAggressive) || recentAggressive < 0) {
                return {
                    success: false,
                    error: new Error("Invalid aggressive volume data"),
                    fallbackSafe: true,
                };
            }

            // Get zone passive history
            const zoneHistory = this.zonePassiveHistory.get(zone);
            const now = Date.now();
            const samples = zoneHistory
                ? zoneHistory
                      .toArray()
                      .filter((s) => now - s.timestamp < this.windowMs)
                      .filter((s) => this.isValidSample(s))
                : [];

            return {
                success: true,
                data: { avgLiquidity, spreadInfo, recentAggressive, samples },
            };
        } catch (error) {
            return {
                success: false,
                error: error as Error,
                fallbackSafe: false,
            };
        }
    }

    /**
     * Assess data quality for decision making
     */
    private assessDataQuality(
        samples: ZoneSample[],
        avgLiquidity: number,
        recentAggressive: number
    ): "high" | "medium" | "low" | "insufficient" {
        // 🔧 FIX: Be less strict about "insufficient"
        if (samples.length === 0) return "insufficient";

        // 🔧 FIX: Allow analysis with minimal data
        if (
            samples.length === 1 &&
            (avgLiquidity > 0 || recentAggressive > 0)
        ) {
            return "low"; // Changed from "insufficient" to "low"
        }

        const dataAge =
            samples.length > 0 ? Date.now() - samples[0].timestamp : Infinity;
        const sampleCount = samples.length;

        //TODO
        // 🔧 FIX: More lenient thresholds
        if (sampleCount >= 8 && dataAge < 45000) return "high"; // Relaxed from 10 samples & 30s
        if (sampleCount >= 3 && dataAge < 90000) return "medium"; // Relaxed from 5 samples & 60s
        if (sampleCount >= 1) return "low"; // Relaxed from 2 samples

        return "insufficient";
    }

    /**
     * Calculate confidence in the data
     */
    private calculateDataConfidence(
        samples: ZoneSample[],
        quality: "high" | "medium" | "low" | "insufficient",
        avgLiquidity: number
    ): number {
        let confidence = 0;

        // Base confidence from data quality
        switch (quality) {
            case "high":
                confidence = 0.9;
                break;
            case "medium":
                confidence = 0.7;
                break;
            case "low":
                confidence = 0.5;
                break;
            case "insufficient":
                confidence = 0.2;
                break;
        }

        // Adjust for sample consistency
        if (samples.length > 1) {
            const variance = this.calculateVariance(
                samples.map((s) => s.total)
            );
            const consistency = Math.exp(-variance / (avgLiquidity || 1));
            confidence *= consistency;
        }

        // Adjust for data freshness
        if (samples.length > 0) {
            const latestAge = Date.now() - samples.at(-1)!.timestamp;
            const freshness = Math.exp(-latestAge / 30000); // Decay over 30 seconds
            confidence *= freshness;
        }

        return Math.max(0, Math.min(1, confidence));
    }

    // Deprecated calculateSafeRatio and calculateSafeMean methods removed - use FinancialMath directly

    /**
     * Safe velocity calculation
     */
    private calculateSafeVelocity(samples: ZoneSample[]): number {
        if (!this.features.volumeVelocity || samples.length < 2) return 0;

        try {
            const recent = samples.slice(-5);
            const velocities: number[] = [];

            for (let i = 1; i < recent.length; i++) {
                const deltaVol = recent[i].total - recent[i - 1].total;
                const deltaTime = recent[i].timestamp - recent[i - 1].timestamp;

                if (
                    deltaTime > 0 &&
                    isFinite(deltaVol) &&
                    isFinite(deltaTime)
                ) {
                    const velocity = deltaVol / (deltaTime / 1000);
                    if (isFinite(velocity)) {
                        velocities.push(velocity);
                    }
                }
            }

            return velocities.length > 0
                ? FinancialMath.calculateMean(velocities)
                : 0;
        } catch {
            return 0;
        }
    }

    /**
     * Safe imbalance check with Result pattern
     */
    private checkPassiveImbalanceSafe(
        zone: number
    ): DetectorResult<{ imbalance: number; dominantSide: string }> {
        try {
            const result = this.checkPassiveImbalance(zone);

            if (!isFinite(result.imbalance)) {
                return {
                    success: false,
                    error: new Error("Invalid imbalance calculation"),
                    fallbackSafe: true,
                };
            }

            return { success: true, data: result };
        } catch (error) {
            return {
                success: false,
                error: error as Error,
                fallbackSafe: true,
            };
        }
    }

    /**
     * Validate sample data
     */
    private isValidSample(sample: ZoneSample): boolean {
        return (
            isFinite(sample.bid) &&
            isFinite(sample.ask) &&
            isFinite(sample.total) &&
            isFinite(sample.timestamp) &&
            sample.bid >= 0 &&
            sample.ask >= 0 &&
            sample.timestamp > 0
        );
    }

    /**
     * Calculate variance for consistency check
     */
    private calculateVariance(values: number[]): number {
        if (values.length < 2) return 0;

        const mean = FinancialMath.calculateMean(values);
        const squaredDiffs = values.map((val) => Math.pow(val - mean, 2));
        return FinancialMath.calculateMean(squaredDiffs);
    }

    /**
     * 🔧 FIX: Atomic circuit breaker error handling
     */
    private handleDetectorError(error: Error): void {
        const now = Date.now();

        // Atomic state update to prevent race conditions
        const state = this.circuitBreakerState;

        // Reset error count if outside window
        if (now - state.lastErrorTime > state.errorWindowMs) {
            state.errorCount = 0;
        }

        state.errorCount++;
        state.lastErrorTime = now;

        // Open circuit breaker if too many errors
        if (state.errorCount >= state.maxErrors) {
            state.isOpen = true;
            this.logger.error(
                `[ExhaustionDetector] Circuit breaker opened after ${state.errorCount} errors`,
                {
                    error: error.message,
                    errorType: error.constructor.name,
                    timestamp: now,
                }
            );

            // Auto-reset circuit breaker after delay
            setTimeout(() => {
                state.isOpen = false;
                state.errorCount = 0;
                this.logger.info(`[ExhaustionDetector] Circuit breaker reset`, {
                    resetTimestamp: Date.now(),
                });
            }, state.errorWindowMs);
        }

        this.handleError(error, `${this.constructor.name}.detectorError`);
    }

    /**
     * Temporarily pause detector on critical errors
     */
    private pauseDetectorTemporarily(error: Error): void {
        this.logger.error(
            `[ExhaustionDetector] Pausing detector due to critical error: ${error.message}`
        );

        // Emit status change event
        this.emitStatusChange("paused", "active");

        // Auto-resume after short delay
        setTimeout(() => {
            this.logger.info(
                `[ExhaustionDetector] Resuming detector operation`
            );
            this.emitStatusChange("active", "paused");
        }, 5000); // 5 second pause
    }

    /* ------------------------------------------------------------------ */
    /*  Confidence score (0-1)                                            */
    /* ------------------------------------------------------------------ */

    /**
     * Safe analysis that returns Result type instead of dangerous defaults
     */
    private analyzeExhaustionConditionsSafe(
        price: number,
        side: "buy" | "sell",
        zone: number
    ): DetectorResult<ExhaustionConditions> {
        try {
            // 🔧 FIX: Atomic circuit breaker check
            if (this.circuitBreakerState.isOpen) {
                this.logger.info(
                    `[ExhaustionDetector] ❌ Circuit breaker is open`,
                    {
                        errorCount: this.circuitBreakerState.errorCount,
                        timeSinceLastError:
                            Date.now() - this.circuitBreakerState.lastErrorTime,
                    }
                );
                return {
                    success: false,
                    error: new Error(
                        "Circuit breaker open - too many recent errors"
                    ),
                    fallbackSafe: true,
                };
            }

            // Validate inputs first
            if (!this.validateInputs(price, side, zone)) {
                this.logger.info(`[ExhaustionDetector] ❌ Invalid inputs`, {
                    price,
                    side,
                    zone,
                });
                return {
                    success: false,
                    error: new Error("Invalid input parameters"),
                    fallbackSafe: true,
                };
            }

            // Get historical data with validation
            const dataResult = this.getValidatedHistoricalData(
                price,
                side,
                zone
            );
            if (!dataResult.success) {
                this.logger.info(
                    `[ExhaustionDetector] ❌ Historical data validation failed`,
                    {
                        error: dataResult.error.message,
                        fallbackSafe: dataResult.fallbackSafe,
                    }
                );
                return dataResult;
            }

            const { avgLiquidity, spreadInfo, recentAggressive, samples } =
                dataResult.data;

            // Validate data quality (LOOSEN THIS)
            const quality = this.assessDataQuality(
                samples,
                avgLiquidity,
                recentAggressive
            );

            // Calculate all metrics with bounds checking
            const currentPassive =
                samples.length > 0 ? samples.at(-1)!.total : 0;
            const avgPassive = FinancialMath.calculateMean(
                samples.map((s) => s.total)
            );
            const minPassive =
                samples.length > 0
                    ? Math.min(...samples.map((s) => s.total))
                    : 0;

            // Safe ratio calculations with bounds
            const passiveRatio = FinancialMath.safeDivide(
                currentPassive,
                avgPassive
            );
            const depletionRatio = FinancialMath.safeDivide(
                recentAggressive,
                avgPassive
            );

            // Calculate velocity with validation
            const passiveVelocity = this.calculateSafeVelocity(samples);

            // Check passive imbalance with error handling
            const imbalanceResult = this.checkPassiveImbalanceSafe(zone);
            const imbalance = imbalanceResult.success
                ? Math.abs(imbalanceResult.data.imbalance)
                : 0;

            // Calculate confidence based on data quality and completeness (ADJUSTED)
            let confidence = this.calculateDataConfidence(
                samples,
                quality,
                avgLiquidity
            );

            // 🔧 FIX: Don't let confidence go too low for reasonable data
            if (samples.length > 2 && avgLiquidity > 0) {
                confidence = Math.max(0.3, confidence); // Minimum 30% confidence for any reasonable data
            }

            // Calculate additional fields for compatibility
            const maxPassive =
                samples.length > 0
                    ? Math.max(...samples.map((s) => s.total))
                    : 0;
            const consistency = this.calculateConsistency(
                samples.map((s) => s.total)
            );
            const velocityIncrease = this.calculateVelocityIncrease(samples);

            // Determine dominant side based on imbalance
            const dominantSide = imbalanceResult.success
                ? imbalanceResult.data.imbalance > 0.1
                    ? "sell"
                    : imbalanceResult.data.imbalance < -0.1
                      ? "buy"
                      : "neutral"
                : ("neutral" as const);

            // Calculate refill detection
            const hasRefill = this.detectPassiveRefill(samples);
            const icebergSignal = this.calculateIcebergSignal(samples);
            const liquidityGradient = this.calculateLiquidityGradient(
                samples,
                avgLiquidity
            );

            const conditions: ExhaustionConditions = {
                aggressiveVolume: recentAggressive,
                currentPassive,
                avgPassive,
                minPassive,
                maxPassive,
                avgLiquidity,
                passiveRatio,
                depletionRatio,
                refillGap:
                    samples.length > 1
                        ? samples.at(-1)!.total - samples[0].total
                        : 0,
                imbalance,
                spread: spreadInfo?.spread ?? 0,
                passiveVelocity,
                sampleCount: samples.length,
                isValid: true,
                confidence,
                dataQuality: quality,
                // Additional fields for compatibility
                absorptionRatio: depletionRatio, // alias for compatibility
                passiveStrength: passiveRatio, // alias for compatibility
                consistency,
                velocityIncrease,
                dominantSide,
                hasRefill,
                icebergSignal,
                liquidityGradient,
            };

            return { success: true, data: conditions };
        } catch (error) {
            this.logger.error(
                `[ExhaustionDetector] ❌ EXCEPTION in conditions analysis`,
                {
                    zone,
                    price,
                    side,
                    error: (error as Error).message,
                    stack: (error as Error).stack,
                }
            );

            this.handleDetectorError(error as Error);

            // 🔧 FIX: Enhanced error handling with recovery strategy
            this.metricsCollector.incrementMetric("exhaustionDetectionErrors");

            // Trigger zone memory cleanup on critical errors
            if (!this.circuitBreakerState.isOpen) {
                this.cleanupZoneMemory();
            }
            return {
                success: false,
                error: error as Error,
                fallbackSafe: false,
            };
        }
    }

    /**
     * Calculate consistency (how consistently passive is maintained)
     */
    private calculateConsistency(passiveValues: number[]): number {
        if (passiveValues.length < 3) {
            return 0.7; // Default reasonable consistency for small samples
        }

        try {
            const avgPassive = FinancialMath.calculateMean(passiveValues);
            if (avgPassive === 0) return 0.5; // Neutral consistency if no passive volume

            let consistentPeriods = 0;
            for (const value of passiveValues) {
                // Count periods where passive stays above 70% of average
                if (value >= avgPassive * 0.7) {
                    consistentPeriods++;
                }
            }

            const consistency = consistentPeriods / passiveValues.length;

            // Safety checks
            if (!isFinite(consistency)) return 0.5;
            return Math.max(0, Math.min(1, consistency));
        } catch (error) {
            this.logger?.warn(
                `[ExhaustionDetector] Error calculating consistency: ${(error as Error).message}`
            );
            return 0.5; // Safe default
        }
    }

    /**
     * Calculate velocity increase over time
     */
    private calculateVelocityIncrease(samples: ZoneSample[]): number {
        if (samples.length < 5) {
            return 1.0; // Neutral velocity for insufficient data
        }

        try {
            // Calculate velocity change over time
            const recent = samples.slice(-3); // Last 3 snapshots
            const earlier = samples.slice(-6, -3); // Previous 3 snapshots

            if (recent.length < 2 || earlier.length < 2) {
                return 1.0; // Neutral velocity
            }

            // Calculate velocity for recent period
            const recentVelocity = this.calculatePeriodVelocity(recent);
            const earlierVelocity = this.calculatePeriodVelocity(earlier);

            // Return velocity increase ratio with safety checks using safeDivision
            const velocityRatio = FinancialMath.safeDivide(
                recentVelocity,
                earlierVelocity,
                1.0
            );

            // Safety checks and bounds
            if (!isFinite(velocityRatio)) return 1.0;
            return Math.max(0.1, Math.min(10, velocityRatio)); // Reasonable bounds
        } catch (error) {
            this.logger?.warn(
                `[ExhaustionDetector] Error calculating velocity increase: ${(error as Error).message}`
            );
            return 1.0; // Safe default
        }
    }

    /**
     * Calculate period velocity
     */
    private calculatePeriodVelocity(samples: ZoneSample[]): number {
        if (samples.length < 2) return 0;

        try {
            let totalVelocity = 0;
            let validPeriods = 0;

            for (let i = 1; i < samples.length; i++) {
                const current = samples[i];
                const previous = samples[i - 1];
                const timeDelta = current.timestamp - previous.timestamp;

                if (timeDelta > 0) {
                    const volumeChange = Math.abs(
                        current.total - previous.total
                    );
                    const velocity = FinancialMath.safeDivide(
                        volumeChange,
                        timeDelta / 1000,
                        0
                    ); // per second

                    if (isFinite(velocity)) {
                        totalVelocity += velocity;
                        validPeriods++;
                    }
                }
            }

            const avgVelocity = FinancialMath.safeDivide(
                totalVelocity,
                validPeriods,
                0
            );
            return isFinite(avgVelocity) ? avgVelocity : 0;
        } catch (error) {
            this.logger?.warn(
                `[ExhaustionDetector] Error calculating period velocity: ${(error as Error).message}`
            );
            return 0;
        }
    }

    /**
     * Detect passive refill patterns
     */
    private detectPassiveRefill(samples: ZoneSample[]): boolean {
        if (samples.length < 5) return false;

        try {
            const recent = samples.slice(-5);
            let refillEvents = 0;

            for (let i = 1; i < recent.length; i++) {
                const current = recent[i].total;
                const previous = recent[i - 1].total;

                if (current > previous * 1.1) {
                    // 10% increase
                    refillEvents++;
                }
            }

            return refillEvents >= 2;
        } catch (error) {
            this.logger?.warn(
                `[ExhaustionDetector] Error detecting refill: ${(error as Error).message}`
            );
            return false;
        }
    }

    /**
     * Calculate iceberg signal (simplified for exhaustion)
     */
    private calculateIcebergSignal(samples: ZoneSample[]): number {
        if (samples.length < 10) return 0;

        try {
            let refillCount = 0;
            let significantRefills = 0;
            let previousLevel = samples[0].total;

            for (let i = 1; i < samples.length; i++) {
                const currentLevel = samples[i].total;
                const prevLevel = samples[i - 1].total;

                // Detect refill after depletion
                if (
                    prevLevel < previousLevel * 0.7 && // Depleted
                    currentLevel > previousLevel * 0.9 // Refilled
                ) {
                    refillCount++;

                    if (currentLevel > previousLevel) {
                        significantRefills++; // Even stronger than before
                    }
                }

                previousLevel = Math.max(previousLevel, currentLevel);
            }

            // Calculate iceberg confidence
            const refillRate = FinancialMath.safeDivide(
                refillCount,
                samples.length / 10,
                0
            );
            const strengthRate = FinancialMath.safeDivide(
                significantRefills,
                Math.max(1, refillCount),
                0
            );

            return Math.min(1, refillRate * 0.7 + strengthRate * 0.3);
        } catch (error) {
            this.logger?.warn(
                `[ExhaustionDetector] Error calculating iceberg signal: ${(error as Error).message}`
            );
            return 0;
        }
    }

    /**
     * Calculate liquidity gradient (simplified for exhaustion)
     */
    private calculateLiquidityGradient(
        samples: ZoneSample[],
        avgLiquidity: number
    ): number {
        if (samples.length < 3 || avgLiquidity === 0) return 0;

        try {
            // Calculate gradient strength (higher = more liquidity depth)
            const currentLiquidity = samples[samples.length - 1]?.total || 0;
            const gradientStrength = FinancialMath.safeDivide(
                currentLiquidity,
                avgLiquidity,
                0
            );

            return Math.min(1, Math.max(0, gradientStrength));
        } catch (error) {
            this.logger?.warn(
                `[ExhaustionDetector] Error calculating liquidity gradient: ${(error as Error).message}`
            );
            return 0;
        }
    }
}
