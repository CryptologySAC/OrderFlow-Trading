// src/indicators/exhaustionDetector.ts
//
// 🔒 PRODUCTION-CRITICAL FILE - PATTERN DETECTION ALGORITHM
//
// ⚠️  WARNING: This file contains core trading algorithm logic that directly impacts
//              signal generation and trading decisions. Any modifications require:
//
//     1. MANDATORY: User approval with explicit risk assessment
//     2. MANDATORY: Comprehensive testing and validation
//     3. MANDATORY: Performance benchmarking against baseline
//     4. MANDATORY: Rollback plan preparation
//
// 🚫  STRICTLY FORBIDDEN without approval:
//     - Algorithm logic modifications
//     - Threshold or scoring changes
//     - Signal generation modifications
//     - Data processing pipeline changes
//
// 📋  CHANGE VALIDATION PROTOCOL:
//     - Risk Assessment: Evaluate trading operation impact
//     - Dependency Analysis: Identify affected components
//     - Test Coverage: Ensure >95% test coverage
//     - User Approval: Get explicit approval for changes
//
// 🎯  This detector implements liquidity exhaustion pattern detection for
//     institutional-grade trading signal generation in live market conditions.
//
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

    // Scoring threshold parameters (previously hardcoded)
    imbalanceHighThreshold?: number; // High imbalance threshold (default 0.8)
    imbalanceMediumThreshold?: number; // Medium imbalance threshold (default 0.6)
    spreadHighThreshold?: number; // High spread threshold (default 0.005)
    spreadMediumThreshold?: number; // Medium spread threshold (default 0.002)

    // Volume surge detection parameters for enhanced exhaustion analysis
    volumeSurgeMultiplier?: number; // Volume surge threshold for exhaustion validation
    imbalanceThreshold?: number; // Order flow imbalance threshold for exhaustion
    institutionalThreshold?: number; // Institutional trade size threshold
    burstDetectionMs?: number; // Burst detection window
    sustainedVolumeMs?: number; // Sustained volume analysis window
    medianTradeSize?: number; // Baseline trade size for volume analysis

    // Scoring weight parameters (previously hardcoded)
    scoringWeights?: {
        depletion?: number; // Primary exhaustion factor (default 0.4)
        passive?: number; // Passive liquidity depletion (default 0.25)
        continuity?: number; // Continuous depletion trend (default 0.15)
        imbalance?: number; // Market imbalance (default 0.1)
        spread?: number; // Spread widening (default 0.08)
        velocity?: number; // Volume velocity (default 0.02)
    };

    // Depletion calculation parameters (previously hardcoded)
    depletionThresholdRatio?: number; // Ratio of avgPassive for depletion threshold (default 0.2)

    // Data quality assessment parameters (previously hardcoded)
    significantChangeThreshold?: number; // Significant change threshold (default 0.1)
    highQualitySampleCount?: number; // High quality minimum sample count (default 8)
    highQualityDataAge?: number; // High quality maximum data age (default 45000ms)
    mediumQualitySampleCount?: number; // Medium quality minimum sample count (default 3)
    mediumQualityDataAge?: number; // Medium quality maximum data age (default 90000ms)

    // Circuit breaker configuration (previously hardcoded)
    circuitBreakerMaxErrors?: number; // Maximum errors before circuit breaker opens (default 5)
    circuitBreakerWindowMs?: number; // Error count reset window (default 60000ms)
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
        maxErrors: 5, // Will be overridden in constructor
        errorWindowMs: 60000, // Will be overridden in constructor
    };

    // Exhaustion-specific configuration
    private readonly exhaustionThreshold: number;
    private readonly maxPassiveRatio: number;
    private readonly minDepletionFactor: number;
    private readonly imbalanceHighThreshold: number;
    private readonly imbalanceMediumThreshold: number;
    private readonly spreadHighThreshold: number;
    private readonly spreadMediumThreshold: number;

    // Scoring weights configuration
    private readonly scoringWeights: {
        depletion: number;
        passive: number;
        continuity: number;
        imbalance: number;
        spread: number;
        velocity: number;
    };

    // Depletion calculation configuration
    private readonly depletionThresholdRatio: number;

    // Data quality assessment configuration
    private readonly significantChangeThreshold: number;
    private readonly highQualitySampleCount: number;
    private readonly highQualityDataAge: number;
    private readonly mediumQualitySampleCount: number;
    private readonly mediumQualityDataAge: number;

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
        this.imbalanceHighThreshold = this.validateConfigValue(
            settings.imbalanceHighThreshold ?? 0.8,
            0.1,
            1.0,
            0.8,
            "imbalanceHighThreshold"
        );
        this.imbalanceMediumThreshold = this.validateConfigValue(
            settings.imbalanceMediumThreshold ?? 0.6,
            0.1,
            1.0,
            0.6,
            "imbalanceMediumThreshold"
        );
        this.spreadHighThreshold = this.validateConfigValue(
            settings.spreadHighThreshold ?? 0.005,
            0.001,
            0.1,
            0.005,
            "spreadHighThreshold"
        );
        this.spreadMediumThreshold = this.validateConfigValue(
            settings.spreadMediumThreshold ?? 0.002,
            0.0001,
            0.1,
            0.002,
            "spreadMediumThreshold"
        );

        // Initialize scoring weights configuration with validation
        this.scoringWeights = {
            depletion: this.validateConfigValue(
                settings.scoringWeights?.depletion ?? 0.4,
                0.1,
                0.8,
                0.4,
                "scoringWeights.depletion"
            ),
            passive: this.validateConfigValue(
                settings.scoringWeights?.passive ?? 0.25,
                0.05,
                0.5,
                0.25,
                "scoringWeights.passive"
            ),
            continuity: this.validateConfigValue(
                settings.scoringWeights?.continuity ?? 0.15,
                0.05,
                0.3,
                0.15,
                "scoringWeights.continuity"
            ),
            imbalance: this.validateConfigValue(
                settings.scoringWeights?.imbalance ?? 0.1,
                0.05,
                0.2,
                0.1,
                "scoringWeights.imbalance"
            ),
            spread: this.validateConfigValue(
                settings.scoringWeights?.spread ?? 0.08,
                0.01,
                0.15,
                0.08,
                "scoringWeights.spread"
            ),
            velocity: this.validateConfigValue(
                settings.scoringWeights?.velocity ?? 0.02,
                0.01,
                0.1,
                0.02,
                "scoringWeights.velocity"
            ),
        };

        // Validate that weights sum to approximately 1.0 using FinancialMath
        const weights = [
            this.scoringWeights.depletion,
            this.scoringWeights.passive,
            this.scoringWeights.continuity,
            this.scoringWeights.imbalance,
            this.scoringWeights.spread,
            this.scoringWeights.velocity,
        ];
        const weightSum = weights.reduce(
            (sum, weight) => FinancialMath.safeAdd(sum, weight),
            0
        );

        if (
            FinancialMath.calculateAbs(
                FinancialMath.safeSubtract(weightSum, 1.0)
            ) > 0.01
        ) {
            this.logger.warn(
                `[ExhaustionDetector] Scoring weights sum to ${weightSum.toFixed(3)}, expected 1.0. Normalizing weights.`,
                { originalWeights: this.scoringWeights, weightSum }
            );

            // Normalize weights to sum to 1.0 using FinancialMath
            this.scoringWeights.depletion = FinancialMath.safeDivide(
                this.scoringWeights.depletion,
                weightSum
            );
            this.scoringWeights.passive = FinancialMath.safeDivide(
                this.scoringWeights.passive,
                weightSum
            );
            this.scoringWeights.continuity = FinancialMath.safeDivide(
                this.scoringWeights.continuity,
                weightSum
            );
            this.scoringWeights.imbalance = FinancialMath.safeDivide(
                this.scoringWeights.imbalance,
                weightSum
            );
            this.scoringWeights.spread = FinancialMath.safeDivide(
                this.scoringWeights.spread,
                weightSum
            );
            this.scoringWeights.velocity = FinancialMath.safeDivide(
                this.scoringWeights.velocity,
                weightSum
            );
        }

        // Initialize depletion threshold ratio
        this.depletionThresholdRatio = this.validateConfigValue(
            settings.depletionThresholdRatio ?? 0.2,
            0.05,
            0.5,
            0.2,
            "depletionThresholdRatio"
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

        // Initialize data quality assessment thresholds
        this.significantChangeThreshold = this.validateConfigValue(
            settings.significantChangeThreshold ?? 0.1,
            0.01,
            0.5,
            0.1,
            "significantChangeThreshold"
        );

        this.highQualitySampleCount = this.validateConfigValue(
            settings.highQualitySampleCount ?? 8,
            3,
            20,
            8,
            "highQualitySampleCount"
        );

        this.highQualityDataAge = this.validateConfigValue(
            settings.highQualityDataAge ?? 45000,
            10000,
            120000,
            45000,
            "highQualityDataAge"
        );

        this.mediumQualitySampleCount = this.validateConfigValue(
            settings.mediumQualitySampleCount ?? 3,
            1,
            10,
            3,
            "mediumQualitySampleCount"
        );

        this.mediumQualityDataAge = this.validateConfigValue(
            settings.mediumQualityDataAge ?? 90000,
            20000,
            300000,
            90000,
            "mediumQualityDataAge"
        );

        // Initialize circuit breaker configuration
        this.circuitBreakerState.maxErrors = this.validateConfigValue(
            settings.circuitBreakerMaxErrors ?? 5,
            2,
            20,
            5,
            "circuitBreakerMaxErrors"
        );

        this.circuitBreakerState.errorWindowMs = this.validateConfigValue(
            settings.circuitBreakerWindowMs ?? 60000,
            10000,
            300000,
            60000,
            "circuitBreakerWindowMs"
        );

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
    private validateNumeric(value: number): number | null {
        return isFinite(value) && !isNaN(value) && value !== 0 ? value : null;
    }

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
        const validPrice = this.validateNumeric(event.price);
        if (validPrice === null) {
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

        const validQuantity = this.validateNumeric(event.quantity);
        if (validQuantity === null) {
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

        // Validate passive volume values using FinancialMath
        const validBidVolume = FinancialMath.calculateMax([
            0,
            event.zonePassiveBidVolume || 0,
        ]);
        const validAskVolume = FinancialMath.calculateMax([
            0,
            event.zonePassiveAskVolume || 0,
        ]);

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

    private calculateExhaustionScore(
        conditions: ExhaustionConditions
    ): number | null {
        // 🔧 FIX: Use BaseDetector's threshold management instead of duplicate calls
        const thresholds = this.getAdaptiveThresholds();

        // 🔧 FIX: Use configurable scoring weights instead of hardcoded constants
        const weights = this.scoringWeights;

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

        // Factor 3: Normalized continuous depletion - 🔧 FIX: Use configurable threshold ratio
        const depletionThreshold =
            conditions.avgPassive * this.depletionThresholdRatio;
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
        if (conditions.imbalance > this.imbalanceHighThreshold) {
            imbalanceScore = 1.0;
        } else if (conditions.imbalance > this.imbalanceMediumThreshold) {
            imbalanceScore = 0.5;
        } else {
            imbalanceScore = Math.max(0, (conditions.imbalance - 0.5) / 0.3); // Scale from 0.5-threshold to 0-1
        }
        weightedScore += imbalanceScore * weights.imbalance;

        // Factor 5: Normalized spread scoring
        let spreadScore = 0;
        if (this.features.spreadAdjustment) {
            if (conditions.spread > this.spreadHighThreshold) {
                spreadScore = 1.0;
            } else if (conditions.spread > this.spreadMediumThreshold) {
                spreadScore = 0.6;
            } else {
                spreadScore = Math.max(
                    0,
                    conditions.spread / this.spreadMediumThreshold
                ); // Proportional to medium threshold
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

        return finalScore >= thresholds.minimumConfidence ? finalScore : null;
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
        const threshold = this.significantChangeThreshold;

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
        // 🔧 FIX: Use trigger trade timestamp as reference instead of Date.now()
        // This prevents issues with network latency, processing delays, and historical data
        const referenceTime = triggerTrade.timestamp;
        const zoneTicks = this.getEffectiveZoneTicks();

        try {
            // Get recent trades within window relative to the trigger trade
            const recentTrades = this.trades.filter(
                (t) =>
                    referenceTime - t.timestamp < this.windowMs &&
                    t.timestamp <= referenceTime
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
        // ✅ CLAUDE.md COMPLIANCE: Proceed with available data, let calculations determine validity
        // Removed invalid blocking on "insufficient" data quality

        // Calculate score with confidence adjustment
        const baseScore = this.calculateExhaustionScore(conditions);
        if (baseScore === null) {
            return; // Cannot proceed without valid exhaustion score
        }
        const adjustedScore = baseScore * conditions.confidence;

        // ✅ CLAUDE.md COMPLIANCE: Make threshold check advisory, not blocking
        const effectiveThreshold =
            conditions.dataQuality === "low"
                ? this.exhaustionThreshold * 1.2
                : this.exhaustionThreshold;

        // Threshold check now advisory - affects confidence but doesn't block signals
        const thresholdConfidenceAdjustment =
            adjustedScore >= effectiveThreshold ? 1.0 : 0.7;
        if (adjustedScore < effectiveThreshold) {
            this.logger.debug(
                `[ExhaustionDetector] Score below threshold - reducing confidence`,
                {
                    zone,
                    price,
                    side,
                    score: adjustedScore,
                    threshold: effectiveThreshold,
                    confidenceAdjustment: thresholdConfidenceAdjustment,
                    dataQuality: conditions.dataQuality,
                }
            );
        }

        // Calculate zone volumes
        const volumes = this.calculateZoneVolumes(
            zone,
            tradesAtZone,
            zoneTicks
        );

        // ✅ CLAUDE.md COMPLIANCE: Make volume check advisory, not blocking
        const volumeConfidenceAdjustment =
            volumes.aggressive >= this.minAggVolume ? 1.0 : 0.8;
        if (volumes.aggressive < this.minAggVolume) {
            this.logger.debug(
                `[ExhaustionDetector] Low aggressive volume - reducing confidence`,
                {
                    zone,
                    price,
                    side,
                    aggressiveVolume: volumes.aggressive,
                    minRequired: this.minAggVolume,
                    confidenceAdjustment: volumeConfidenceAdjustment,
                }
            );
        }

        // ✅ CLAUDE.md COMPLIANCE: Make volume surge validation advisory, not blocking
        const volumeValidation =
            this.volumeAnalyzer.validateVolumeSurgeConditions(
                tradesAtZone,
                triggerTrade.timestamp
            );

        // Volume surge validation now advisory - affects confidence but doesn't block signals
        const volumeSurgeConfidenceAdjustment = volumeValidation.valid
            ? 1.0
            : 0.8;
        if (!volumeValidation.valid) {
            this.logger.debug(
                `[ExhaustionDetector] Volume surge validation failed - reducing confidence`,
                {
                    zone,
                    price,
                    side,
                    score: adjustedScore,
                    reason: volumeValidation.reason,
                    confidenceAdjustment: volumeConfidenceAdjustment,
                }
            );
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

        // ✅ CLAUDE.md COMPLIANCE: Apply all confidence adjustments
        let finalConfidence = adjustedScore * thresholdConfidenceAdjustment * volumeConfidenceAdjustment * volumeSurgeConfidenceAdjustment;
        
        // 🔍 DEBUG: Log signal generation attempt
        this.logger.info(`[ExhaustionDetector] 🔍 ATTEMPTING SIGNAL GENERATION`, {
            zone,
            price,
            side,
            baseScore,
            adjustedScore,
            finalConfidence,
            thresholdConfidenceAdjustment,
            volumeConfidenceAdjustment,
            volumeSurgeConfidenceAdjustment,
            effectiveThreshold,
            aggressiveVolume: volumes.aggressive,
            minAggVolume: this.minAggVolume,
            exhaustionThreshold: this.exhaustionThreshold,
        });
        
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
        // ✅ CLAUDE.md COMPLIANCE: Only return "insufficient" when absolutely no data
        if (
            samples.length === 0 &&
            avgLiquidity === 0 &&
            recentAggressive === 0
        ) {
            return "insufficient"; // Only when no data at all
        }

        // ✅ RELAXED: Allow analysis with any available data
        if (
            samples.length === 0 &&
            (avgLiquidity > 0 || recentAggressive > 0)
        ) {
            return "low"; // Can still analyze with market data
        }

        const dataAge =
            samples.length > 0 ? Date.now() - samples[0].timestamp : Infinity;
        const sampleCount = samples.length;

        // Use configurable data quality thresholds
        if (
            sampleCount >= this.highQualitySampleCount &&
            dataAge < this.highQualityDataAge
        )
            return "high";
        if (
            sampleCount >= this.mediumQualitySampleCount &&
            dataAge < this.mediumQualityDataAge
        )
            return "medium";

        // ✅ CLAUDE.md COMPLIANCE: Always attempt analysis with any available data
        return "low"; // Never block on sample count - let calculations decide validity
    }

    /**
     * Calculate confidence in the data
     */
    private calculateDataConfidence(
        samples: ZoneSample[],
        quality: "high" | "medium" | "low" | "insufficient",
        avgLiquidity: number
    ): number | null {
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
                return null; // Cannot calculate confidence with insufficient data
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

        const finalConfidence = Math.max(0, Math.min(1, confidence));

        return finalConfidence;
    }

    // Deprecated calculateSafeRatio and calculateSafeMean methods removed - use FinancialMath directly

    /**
     * Safe velocity calculation
     */
    private calculateSafeVelocity(samples: ZoneSample[]): number | null {
        if (!this.features.volumeVelocity || samples.length < 2) return null;

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
                : null;
        } catch {
            return null;
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
        const squaredDiffs = values.map((val) => {
            const diff = FinancialMath.safeSubtract(val, mean);
            return FinancialMath.safeMultiply(diff, diff); // Square using multiply
        });
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
            const minPassive = FinancialMath.calculateMin(
                samples.map((s) => s.total)
            );

            // Safe ratio calculations with bounds
            const passiveRatio = FinancialMath.safeDivide(
                currentPassive,
                avgPassive
            );
            const depletionRatio = FinancialMath.safeDivide(
                recentAggressive,
                avgPassive
            );

            // Calculate velocity with validation (only fail if feature is enabled but calculation fails)
            const passiveVelocity = this.calculateSafeVelocity(samples);
            if (passiveVelocity === null && this.features.volumeVelocity) {
                // Only fail if velocity feature is enabled but we can't calculate it
                return {
                    success: false,
                    error: new Error(
                        "Cannot calculate passive velocity - insufficient data for enabled feature"
                    ),
                    fallbackSafe: true,
                };
            }
            // Use 0 as default when velocity feature is disabled or insufficient data
            const safePassiveVelocity = passiveVelocity ?? 0;

            // Check passive imbalance with error handling
            const imbalanceResult = this.checkPassiveImbalanceSafe(zone);
            const imbalance = imbalanceResult.success
                ? FinancialMath.calculateAbs(imbalanceResult.data.imbalance)
                : 0;

            // Calculate confidence based on data quality and completeness (ADJUSTED)
            let confidence = this.calculateDataConfidence(
                samples,
                quality,
                avgLiquidity
            );

            // Handle null confidence (insufficient data)
            if (confidence === null) {
                return {
                    success: false,
                    error: new Error(
                        "Insufficient data quality for confidence calculation"
                    ),
                    fallbackSafe: true,
                };
            }

            // 🔧 FIX: Don't let confidence go too low for reasonable data
            if (samples.length > 2 && avgLiquidity > 0) {
                confidence = Math.max(0.3, confidence); // Minimum 30% confidence for any reasonable data
            }

            // Calculate additional fields for compatibility
            const maxPassive = FinancialMath.calculateMax(
                samples.map((s) => s.total)
            );
            const consistency = this.calculateConsistency(
                samples.map((s) => s.total)
            );
            const velocityIncrease = this.calculateVelocityIncrease(samples);

            // Handle null returns from calculations - return early if critical calculations fail
            if (consistency === null || velocityIncrease === null) {
                return {
                    success: false,
                    error: new Error(
                        "Critical calculation returned null - insufficient data"
                    ),
                    fallbackSafe: true,
                };
            }

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
                passiveVelocity: safePassiveVelocity,
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
    private calculateConsistency(passiveValues: number[]): number | null {
        if (passiveValues.length < 3) {
            return null; // Cannot calculate consistency with insufficient data
        }

        try {
            const avgPassive = FinancialMath.calculateMean(passiveValues);
            if (avgPassive === 0) return null; // Cannot calculate consistency with no passive volume

            let consistentPeriods = 0;
            for (const value of passiveValues) {
                // Count periods where passive stays above 70% of average
                if (value >= avgPassive * 0.7) {
                    consistentPeriods++;
                }
            }

            const consistency = consistentPeriods / passiveValues.length;

            // Safety checks
            if (!isFinite(consistency)) return null;
            return Math.max(0, Math.min(1, consistency));
        } catch (error) {
            this.logger?.warn(
                `[ExhaustionDetector] Error calculating consistency: ${(error as Error).message}`
            );
            return null; // Cannot calculate consistency due to error
        }
    }

    /**
     * Calculate velocity increase over time
     */
    private calculateVelocityIncrease(samples: ZoneSample[]): number | null {
        if (samples.length < 5) {
            return null; // Cannot calculate velocity with insufficient data
        }

        try {
            // Calculate velocity change over time
            const recent = samples.slice(-3); // Last 3 snapshots
            const earlier = samples.slice(-6, -3); // Previous 3 snapshots

            if (recent.length < 2 || earlier.length < 2) {
                return null; // Cannot calculate velocity with insufficient periods
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
            if (!isFinite(velocityRatio)) return null;
            return Math.max(0.1, Math.min(10, velocityRatio)); // Reasonable bounds
        } catch (error) {
            this.logger?.warn(
                `[ExhaustionDetector] Error calculating velocity increase: ${(error as Error).message}`
            );
            return null; // Cannot calculate velocity due to error
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
                    const volumeChange = FinancialMath.calculateAbs(
                        FinancialMath.safeSubtract(
                            current.total,
                            previous.total
                        )
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

                previousLevel = FinancialMath.calculateMax([
                    previousLevel,
                    currentLevel,
                ]);
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
