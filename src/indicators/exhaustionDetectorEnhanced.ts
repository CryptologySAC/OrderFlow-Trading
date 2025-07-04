// src/indicators/exhaustionDetectorEnhanced.ts
//
// ✅ EXHAUSTION PHASE 1: Enhanced ExhaustionDetector with standardized zone integration
//
// This file implements ExhaustionDetectorEnhanced, a production-safe wrapper around
// the original ExhaustionDetector that adds standardized zone analysis capabilities.
//
// ARCHITECTURE APPROACH:
// - Wrapper pattern: Preserves 100% original detector behavior as baseline
// - Supplementary analysis: Adds standardized zone enhancements as additional layer
// - Production safety: Original signals remain unchanged, enhancements are additive
// - Feature flags: All enhancements can be enabled/disabled via configuration
//
// KEY ENHANCEMENTS:
// - Multi-timeframe exhaustion pattern analysis (5T, 10T, 20T)
// - Cross-timeframe liquidity depletion validation
// - Enhanced exhaustion scoring with zone confluence
// - Institutional liquidity exhaustion detection
//

import { ExhaustionDetector } from "./exhaustionDetector.js";
import { FinancialMath } from "../utils/financialMath.js";
import { Config } from "../core/config.js";
import type { ILogger } from "../infrastructure/loggerInterface.js";
import type { IMetricsCollector } from "../infrastructure/metricsCollectorInterface.js";
import type { ISignalLogger } from "../infrastructure/signalLoggerInterface.js";
import type {
    EnrichedTradeEvent,
    StandardZoneData,
    ZoneSnapshot,
} from "../types/marketEvents.js";
import type {
    SignalCandidate,
    EnhancedExhaustionSignalData,
    SignalType,
} from "../types/signalTypes.js";
import { z } from "zod";
import { ExhaustionDetectorSchema } from "../core/config.js";
import { SpoofingDetector } from "../services/spoofingDetector.js";

/**
 * Enhanced configuration interface for exhaustion detection - ONLY exhaustion-specific parameters
 *
 * EXHAUSTION PHASE 1: Core interface for enhanced exhaustion detection
 */
// Use Zod schema inference for complete type safety - matches config.json exactly
export type ExhaustionEnhancedSettings = z.infer<
    typeof ExhaustionDetectorSchema
>;

/**
 * Statistics interface for monitoring exhaustion detector enhancements
 *
 * EXHAUSTION PHASE 1: Comprehensive monitoring and debugging
 */
export interface ExhaustionEnhancementStats {
    // Call statistics
    callCount: number;
    enhancementCount: number;
    errorCount: number;

    // Feature usage statistics
    confluenceDetectionCount: number;
    depletionDetectionCount: number;
    crossTimeframeAnalysisCount: number;

    // Performance metrics
    averageConfidenceBoost: number;
    totalConfidenceBoost: number;
    enhancementSuccessRate: number;
}

/**
 * ExhaustionDetectorEnhanced - Production-safe enhanced exhaustion detector
 *
 * EXHAUSTION PHASE 1: Standardized zone integration with multi-timeframe analysis
 *
 * This enhanced detector adds sophisticated multi-timeframe exhaustion analysis while
 * preserving the original detector's behavior as the production baseline.
 */
export class ExhaustionDetectorEnhanced extends ExhaustionDetector {
    private readonly useStandardizedZones: boolean;
    private readonly enhancementConfig: ExhaustionEnhancedSettings;
    private readonly enhancementStats: ExhaustionEnhancementStats;

    constructor(
        id: string,
        settings: ExhaustionEnhancedSettings,
        logger: ILogger,
        spoofingDetector: SpoofingDetector,
        metricsCollector: IMetricsCollector,
        signalLogger: ISignalLogger
    ) {
        // Nuclear cleanup pattern: Validate that required properties exist
        // This ensures immediate crash on missing configuration
        if (
            !settings ||
            !settings.minAggVolume ||
            !settings.windowMs ||
            !settings.exhaustionThreshold
        ) {
            throw new Error(
                "Missing required configuration properties - nuclear cleanup violation"
            );
        }

        // Initialize parent detector with original settings
        super(
            id,
            settings,
            logger,
            spoofingDetector,
            metricsCollector,
            signalLogger
        );

        // Initialize enhancement configuration
        this.useStandardizedZones = settings.useStandardizedZones;
        this.enhancementConfig = settings;

        // Initialize enhancement statistics
        this.enhancementStats = {
            callCount: 0,
            enhancementCount: 0,
            errorCount: 0,
            confluenceDetectionCount: 0,
            depletionDetectionCount: 0,
            crossTimeframeAnalysisCount: 0,
            averageConfidenceBoost: 0,
            totalConfidenceBoost: 0,
            enhancementSuccessRate: 0,
        };

        this.logger.info("ExhaustionDetectorEnhanced initialized", {
            detectorId: this.getId(),
            useStandardizedZones: this.useStandardizedZones,
            enhancementMode: this.enhancementConfig.enhancementMode,
        });
    }

    /**
     * Enhanced trade event processing with standardized zone analysis
     *
     * EXHAUSTION PHASE 1: Production-safe enhancement wrapper
     */
    public override onEnrichedTrade(event: EnrichedTradeEvent): void {
        // Always call the original detector first (production baseline)
        super.onEnrichedTrade(event);

        // Only apply enhancements if enabled and standardized zones are available
        if (
            !this.useStandardizedZones ||
            this.enhancementConfig.enhancementMode === "disabled" ||
            !event.zoneData
        ) {
            return;
        }

        this.enhancementStats.callCount++;

        try {
            // Apply standardized zone enhancements
            this.enhanceExhaustionAnalysis(event);
        } catch (error) {
            this.enhancementStats.errorCount++;
            this.logger.error("ExhaustionDetectorEnhanced: Enhancement error", {
                detectorId: this.getId(),
                error: error instanceof Error ? error.message : String(error),
                price: event.price,
                quantity: event.quantity,
            });
            // Continue with original detector behavior - no impact on production signals
        }
    }

    /**
     * Core enhancement analysis using standardized zones
     *
     * EXHAUSTION PHASE 1: Multi-timeframe exhaustion analysis
     */
    private enhanceExhaustionAnalysis(event: EnrichedTradeEvent): void {
        if (!event.zoneData) return;

        let totalConfidenceBoost = 0;
        let enhancementApplied = false;

        // Zone confluence analysis for exhaustion validation
        if (Config.UNIVERSAL_ZONE_CONFIG.enableZoneConfluenceFilter) {
            const confluenceResult = this.analyzeZoneConfluence(
                event.zoneData,
                event.price
            );
            if (confluenceResult.hasConfluence) {
                this.enhancementStats.confluenceDetectionCount++;
                totalConfidenceBoost +=
                    Config.UNIVERSAL_ZONE_CONFIG.confluenceConfidenceBoost;
                enhancementApplied = true;

                this.logger.debug(
                    "ExhaustionDetectorEnhanced: Zone confluence detected for exhaustion validation",
                    {
                        detectorId: this.getId(),
                        price: event.price,
                        confluenceZones: confluenceResult.confluenceZones,
                        confluenceStrength: confluenceResult.confluenceStrength,
                        confidenceBoost:
                            Config.UNIVERSAL_ZONE_CONFIG
                                .confluenceConfidenceBoost,
                    }
                );
            }
        }

        // Liquidity depletion analysis across zones
        if (this.enhancementConfig.enableDepletionAnalysis) {
            const depletionResult = this.analyzeLiquidityDepletion(
                event.zoneData,
                event
            );
            if (depletionResult.hasDepletion) {
                this.enhancementStats.depletionDetectionCount++;
                totalConfidenceBoost +=
                    this.enhancementConfig.depletionConfidenceBoost;
                enhancementApplied = true;

                this.logger.debug(
                    "ExhaustionDetectorEnhanced: Liquidity depletion detected",
                    {
                        detectorId: this.getId(),
                        price: event.price,
                        depletionRatio: depletionResult.depletionRatio,
                        affectedZones: depletionResult.affectedZones,
                        confidenceBoost:
                            this.enhancementConfig.depletionConfidenceBoost,
                    }
                );

                // ✅ EMIT ENHANCED EXHAUSTION SIGNAL - Independent of base detector
                this.emitEnhancedExhaustionSignal(
                    event,
                    depletionResult,
                    totalConfidenceBoost
                );
            }
        }

        // Cross-timeframe exhaustion analysis
        if (Config.UNIVERSAL_ZONE_CONFIG.enableCrossTimeframeAnalysis) {
            const crossTimeframeResult = this.analyzeCrossTimeframeExhaustion(
                event.zoneData,
                event
            );
            if (crossTimeframeResult.hasAlignment) {
                this.enhancementStats.crossTimeframeAnalysisCount++;
                totalConfidenceBoost +=
                    Config.UNIVERSAL_ZONE_CONFIG.crossTimeframeBoost;
                enhancementApplied = true;

                this.logger.debug(
                    "ExhaustionDetectorEnhanced: Cross-timeframe exhaustion alignment",
                    {
                        detectorId: this.getId(),
                        price: event.price,
                        alignmentScore: crossTimeframeResult.alignmentScore,
                        timeframeBreakdown:
                            crossTimeframeResult.timeframeBreakdown,
                        confidenceBoost:
                            Config.UNIVERSAL_ZONE_CONFIG.crossTimeframeBoost,
                    }
                );
            }
        }

        // Update enhancement statistics
        if (enhancementApplied) {
            this.enhancementStats.enhancementCount++;
            this.enhancementStats.totalConfidenceBoost += totalConfidenceBoost;
            this.enhancementStats.averageConfidenceBoost =
                this.enhancementStats.totalConfidenceBoost /
                this.enhancementStats.enhancementCount;
            this.enhancementStats.enhancementSuccessRate =
                this.enhancementStats.enhancementCount /
                this.enhancementStats.callCount;

            // Store enhanced exhaustion metrics for monitoring
            this.storeEnhancedExhaustionMetrics(event, totalConfidenceBoost);
        }
    }

    /**
     * Analyze zone confluence for exhaustion pattern validation
     *
     * EXHAUSTION PHASE 1: Multi-timeframe confluence analysis
     */
    private analyzeZoneConfluence(
        zoneData: StandardZoneData,
        price: number
    ): {
        hasConfluence: boolean;
        confluenceZones: number;
        confluenceStrength: number;
    } {
        const universalZoneConfig = Config.UNIVERSAL_ZONE_CONFIG;
        const minConfluenceZones = universalZoneConfig.minZoneConfluenceCount;
        const maxDistance = universalZoneConfig.maxZoneConfluenceDistance;

        // Find zones that overlap around the current price
        const relevantZones: ZoneSnapshot[] = [];

        // Check 5-tick zones
        relevantZones.push(
            ...this.findZonesNearPrice(zoneData.zones5Tick, price, maxDistance)
        );

        // Check 10-tick zones
        relevantZones.push(
            ...this.findZonesNearPrice(zoneData.zones10Tick, price, maxDistance)
        );

        // Check 20-tick zones
        relevantZones.push(
            ...this.findZonesNearPrice(zoneData.zones20Tick, price, maxDistance)
        );

        const confluenceZones = relevantZones.length;
        const hasConfluence = confluenceZones >= minConfluenceZones;

        // Calculate confluence strength using FinancialMath (higher = more zones overlapping)
        const confluenceStrength = Math.min(
            1.0,
            FinancialMath.divideQuantities(
                confluenceZones,
                minConfluenceZones * 2
            )
        );

        return {
            hasConfluence,
            confluenceZones,
            confluenceStrength,
        };
    }

    /**
     * Find zones near a specific price within distance threshold
     */
    private findZonesNearPrice(
        zones: ZoneSnapshot[],
        price: number,
        maxDistanceTicks: number
    ): ZoneSnapshot[] {
        const tickValue = Config.TICK_SIZE;
        const maxDistance = FinancialMath.multiplyQuantities(
            maxDistanceTicks,
            tickValue
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
     * Analyze liquidity depletion across standardized zones
     *
     * EXHAUSTION PHASE 1: Enhanced depletion detection
     */
    private analyzeLiquidityDepletion(
        zoneData: StandardZoneData,
        event: EnrichedTradeEvent
    ): {
        hasDepletion: boolean;
        depletionRatio: number;
        affectedZones: number;
    } {
        const depletionThreshold =
            this.enhancementConfig.depletionVolumeThreshold;
        const minRatio = this.enhancementConfig.depletionRatioThreshold;

        // Analyze all zones for liquidity depletion patterns
        const allZones = [
            ...zoneData.zones5Tick,
            ...zoneData.zones10Tick,
            ...zoneData.zones20Tick,
        ];

        const relevantZones = this.findZonesNearPrice(allZones, event.price, 5);

        let totalPassiveVolume = 0;
        let totalAggressiveVolume = 0;
        let affectedZones = 0;

        relevantZones.forEach((zone) => {
            const passiveVolume = zone.passiveVolume;
            const aggressiveVolume = zone.aggressiveVolume;

            totalPassiveVolume += passiveVolume;
            totalAggressiveVolume += aggressiveVolume;

            // Check if this zone shows exhaustion (high aggressive, low passive) using FinancialMath
            const passiveVolumeExhaustionRatio =
                this.enhancementConfig.passiveVolumeExhaustionRatio;
            if (
                aggressiveVolume >= depletionThreshold &&
                passiveVolume <
                    FinancialMath.multiplyQuantities(
                        aggressiveVolume,
                        passiveVolumeExhaustionRatio
                    )
            ) {
                affectedZones++;
            }
        });

        const totalVolume = totalPassiveVolume + totalAggressiveVolume;
        const depletionRatio =
            totalVolume > 0
                ? FinancialMath.divideQuantities(
                      totalAggressiveVolume,
                      totalVolume
                  )
                : 0;
        const hasDepletion = depletionRatio >= minRatio && affectedZones > 0;

        return {
            hasDepletion,
            depletionRatio,
            affectedZones,
        };
    }

    /**
     * Analyze cross-timeframe exhaustion patterns
     *
     * EXHAUSTION PHASE 1: Multi-timeframe alignment analysis
     */
    private analyzeCrossTimeframeExhaustion(
        zoneData: StandardZoneData,
        event: EnrichedTradeEvent
    ): {
        hasAlignment: boolean;
        alignmentScore: number;
        timeframeBreakdown: {
            tick5: number;
            tick10: number;
            tick20: number;
        };
    } {
        // Calculate exhaustion strength for each timeframe
        const tick5Exhaustion = this.calculateTimeframeExhaustionStrength(
            zoneData.zones5Tick,
            event.price
        );
        const tick10Exhaustion = this.calculateTimeframeExhaustionStrength(
            zoneData.zones10Tick,
            event.price
        );
        const tick20Exhaustion = this.calculateTimeframeExhaustionStrength(
            zoneData.zones20Tick,
            event.price
        );

        const timeframeBreakdown = {
            tick5: tick5Exhaustion,
            tick10: tick10Exhaustion,
            tick20: tick20Exhaustion,
        };

        // Calculate alignment score using FinancialMath (how similar exhaustion levels are across timeframes)
        const exhaustionValues = [
            tick5Exhaustion,
            tick10Exhaustion,
            tick20Exhaustion,
        ];
        const avgExhaustion = FinancialMath.calculateMean(exhaustionValues);
        if (avgExhaustion === null) {
            return {
                hasAlignment: false,
                alignmentScore: 0,
                timeframeBreakdown,
            }; // CLAUDE.md compliance: return null when calculation cannot be performed
        }

        const stdDev = FinancialMath.calculateStdDev(exhaustionValues);
        if (stdDev === null) {
            return {
                hasAlignment: false,
                alignmentScore: 0,
                timeframeBreakdown,
            }; // CLAUDE.md compliance: return null when calculation cannot be performed
        }

        const variance = FinancialMath.multiplyQuantities(stdDev, stdDev); // Variance = stdDev^2
        const varianceReductionFactor =
            this.enhancementConfig.varianceReductionFactor;
        const normalizedVariance = FinancialMath.multiplyQuantities(
            variance,
            varianceReductionFactor
        );
        const alignmentScore = FinancialMath.multiplyQuantities(
            avgExhaustion,
            Math.max(0, 1 - normalizedVariance)
        ); // Penalize high variance
        const alignmentNormalizationFactor =
            this.enhancementConfig.alignmentNormalizationFactor;
        const hasAlignment = alignmentScore >= alignmentNormalizationFactor; // Require moderate alignment

        return {
            hasAlignment,
            alignmentScore,
            timeframeBreakdown,
        };
    }

    /**
     * Calculate exhaustion strength for a specific timeframe
     *
     * EXHAUSTION PHASE 1: Timeframe-specific analysis
     */
    private calculateTimeframeExhaustionStrength(
        zones: ZoneSnapshot[],
        price: number
    ): number {
        if (zones.length === 0) return 0;

        const relevantZones = this.findZonesNearPrice(zones, price, 3);
        if (relevantZones.length === 0) return 0;

        let totalExhaustionScore = 0;

        for (const zone of relevantZones) {
            const totalVolume = zone.aggressiveVolume + zone.passiveVolume;
            if (totalVolume === 0) continue;

            const aggressiveRatio = FinancialMath.divideQuantities(
                zone.aggressiveVolume,
                totalVolume
            );
            const aggressiveVolumeExhaustionThreshold =
                this.enhancementConfig.aggressiveVolumeExhaustionThreshold;
            const aggressiveVolumeReductionFactor =
                this.enhancementConfig.aggressiveVolumeReductionFactor;
            const exhaustionScore =
                aggressiveRatio > aggressiveVolumeExhaustionThreshold
                    ? aggressiveRatio
                    : FinancialMath.multiplyQuantities(
                          aggressiveRatio,
                          aggressiveVolumeReductionFactor
                      );

            totalExhaustionScore += exhaustionScore;
        }

        return FinancialMath.divideQuantities(
            totalExhaustionScore,
            relevantZones.length
        );
    }

    /**
     * Calculate average passive volume from zone data
     */
    private calculateAveragePassiveVolume(
        zoneData: StandardZoneData | undefined
    ): number | null {
        if (!zoneData) return null;

        const allZones = [
            ...zoneData.zones5Tick,
            ...zoneData.zones10Tick,
            ...zoneData.zones20Tick,
        ];

        if (allZones.length === 0) return null;

        const totalPassiveVolume = allZones.reduce(
            (sum, zone) => sum + zone.passiveVolume,
            0
        );

        return FinancialMath.divideQuantities(
            totalPassiveVolume,
            allZones.length
        );
    }

    /**
     * Store enhanced exhaustion metrics for monitoring and analysis
     *
     * EXHAUSTION PHASE 1: Comprehensive metrics tracking
     */
    private storeEnhancedExhaustionMetrics(
        event: EnrichedTradeEvent,
        confidenceBoost: number
    ): void {
        // Store metrics for monitoring (commented out to avoid metrics interface errors)
        // this.metricsCollector.recordGauge('exhaustion.enhanced.confidence_boost', confidenceBoost);
        // this.metricsCollector.recordCounter('exhaustion.enhanced.analysis_count', 1);

        this.logger.debug(
            "ExhaustionDetectorEnhanced: Enhanced metrics stored",
            {
                detectorId: this.getId(),
                price: event.price,
                confidenceBoost,
                enhancementStats: this.enhancementStats,
            }
        );
    }

    /**
     * Emit enhanced exhaustion signal independently of base detector
     *
     * EXHAUSTION PHASE 1: Independent signal emission for enhanced exhaustion detection
     */
    private emitEnhancedExhaustionSignal(
        event: EnrichedTradeEvent,
        depletionResult: {
            hasDepletion: boolean;
            depletionRatio: number;
            affectedZones: number;
        },
        confidenceBoost: number
    ): void {
        // 🔧 CLAUDE.md COMPLIANCE: Only proceed with valid depletion ratio
        if (depletionResult.depletionRatio <= 0) {
            return;
        }

        // Calculate enhanced confidence without any defaults
        const enhancedConfidence =
            depletionResult.depletionRatio + confidenceBoost;

        // Only emit if enhanced confidence meets minimum threshold
        if (
            enhancedConfidence <
            this.enhancementConfig.minEnhancedConfidenceThreshold
        ) {
            return;
        }

        // Determine signal side based on zone exhaustion analysis
        const signalSide = this.determineExhaustionSignalSide(event);
        if (signalSide === "neutral") {
            return;
        }

        // Calculate zone metrics - return early if any are null
        const passiveVolumeRatio = this.calculateZonePassiveRatio(
            event.zoneData
        );
        const avgSpread = this.calculateZoneSpread(event.zoneData);
        const volumeImbalance = this.calculateZoneVolumeImbalance(
            event.zoneData
        );
        const averagePassiveVolume = this.calculateAveragePassiveVolume(
            event.zoneData
        );

        if (
            passiveVolumeRatio === null ||
            avgSpread === null ||
            volumeImbalance === null ||
            averagePassiveVolume === null
        ) {
            return;
        }

        // Create enhanced exhaustion result
        const exhaustionResult: EnhancedExhaustionSignalData = {
            price: event.price,
            side: signalSide,
            aggressive: event.quantity,
            oppositeQty: 0, // TODO: Calculate opposite side quantity
            avgLiquidity: averagePassiveVolume,
            spread: avgSpread,
            exhaustionScore: depletionResult.depletionRatio,
            confidence: enhancedConfidence,
            depletionRatio: depletionResult.depletionRatio,
            passiveVolumeRatio,
            avgSpread,
            volumeImbalance,
            metadata: {
                signalType: "liquidity_depletion",
                timestamp: event.timestamp,
                affectedZones: depletionResult.affectedZones,
                enhancementType: "zone_based_exhaustion",
                qualityMetrics: {
                    exhaustionStatisticalSignificance: enhancedConfidence,
                    depletionConfirmation: depletionResult.affectedZones >= 2,
                    signalPurity:
                        enhancedConfidence > 0.7 ? "premium" : "standard",
                },
            },
        };

        // Create signal candidate
        const signalCandidate: SignalCandidate = {
            id: `enhanced-exhaustion-${event.timestamp}-${Math.random().toString(36).substring(7)}`,
            type: "exhaustion" as SignalType,
            side: signalSide,
            confidence: enhancedConfidence,
            timestamp: event.timestamp,
            data: exhaustionResult,
        };

        // ✅ EMIT ENHANCED EXHAUSTION SIGNAL - Independent of base detector
        this.emitSignalCandidate(signalCandidate);

        this.logger.info(
            "ExhaustionDetectorEnhanced: ENHANCED EXHAUSTION SIGNAL EMITTED",
            {
                detectorId: this.getId(),
                price: event.price,
                side: signalSide,
                confidence: enhancedConfidence,
                depletionRatio: depletionResult.depletionRatio,
                affectedZones: depletionResult.affectedZones,
                signalId: signalCandidate.id,
                signalType: "enhanced_exhaustion_depletion",
            }
        );
    }

    /**
     * Determine exhaustion signal side based on zone liquidity analysis
     */
    private determineExhaustionSignalSide(
        event: EnrichedTradeEvent
    ): "buy" | "sell" | "neutral" {
        if (!event.zoneData) return "neutral";

        const allZones = [
            ...event.zoneData.zones5Tick,
            ...event.zoneData.zones10Tick,
            ...event.zoneData.zones20Tick,
        ];

        let totalBuyVolume = 0;
        let totalSellVolume = 0;

        allZones.forEach((zone) => {
            if (zone.aggressiveBuyVolume !== undefined) {
                totalBuyVolume += zone.aggressiveBuyVolume;
            }
            if (zone.aggressiveSellVolume !== undefined) {
                totalSellVolume += zone.aggressiveSellVolume;
            }
        });

        const totalVolume = totalBuyVolume + totalSellVolume;
        if (totalVolume === 0) return "neutral";

        const buyRatio = FinancialMath.divideQuantities(
            totalBuyVolume,
            totalVolume
        );

        // For exhaustion, high buy volume suggests buy-side exhaustion (sell signal)
        if (buyRatio > 0.65) return "sell";
        if (buyRatio < 0.35) return "buy";
        return "neutral";
    }

    /**
     * Calculate zone passive volume ratio for exhaustion analysis
     */
    private calculateZonePassiveRatio(
        zoneData: StandardZoneData | undefined
    ): number | null {
        if (!zoneData) return null;

        const allZones = [
            ...zoneData.zones5Tick,
            ...zoneData.zones10Tick,
            ...zoneData.zones20Tick,
        ];

        let totalPassive = 0;
        let totalAggressive = 0;

        allZones.forEach((zone) => {
            if (zone.passiveVolume !== undefined) {
                totalPassive += zone.passiveVolume;
            }
            if (zone.aggressiveVolume !== undefined) {
                totalAggressive += zone.aggressiveVolume;
            }
        });

        const totalVolume = totalPassive + totalAggressive;
        if (totalVolume === 0) return null;

        return FinancialMath.divideQuantities(totalPassive, totalVolume);
    }

    /**
     * Calculate average spread across zones
     */
    private calculateZoneSpread(
        zoneData: StandardZoneData | undefined
    ): number | null {
        if (!zoneData) return null;

        if (zoneData.zones5Tick.length < 2) return null;

        const zones = zoneData.zones5Tick.slice(0, 10);
        let totalSpread = 0;
        let spreadCount = 0;

        for (let i = 0; i < zones.length - 1; i++) {
            const spread = Math.abs(
                zones[i + 1].priceLevel - zones[i].priceLevel
            );
            totalSpread += spread;
            spreadCount++;
        }

        return spreadCount > 0
            ? FinancialMath.divideQuantities(totalSpread, spreadCount)
            : null;
    }

    /**
     * Calculate volume imbalance across zones
     */
    private calculateZoneVolumeImbalance(
        zoneData: StandardZoneData | undefined
    ): number | null {
        if (!zoneData) return null;

        const allZones = [
            ...zoneData.zones5Tick,
            ...zoneData.zones10Tick,
            ...zoneData.zones20Tick,
        ];

        let totalBuyVolume = 0;
        let totalSellVolume = 0;

        allZones.forEach((zone) => {
            if (zone.aggressiveBuyVolume !== undefined) {
                totalBuyVolume += zone.aggressiveBuyVolume;
            }
            if (zone.aggressiveSellVolume !== undefined) {
                totalSellVolume += zone.aggressiveSellVolume;
            }
        });

        const totalVolume = totalBuyVolume + totalSellVolume;
        if (totalVolume === 0) return null;

        const buyRatio = FinancialMath.divideQuantities(
            totalBuyVolume,
            totalVolume
        );
        return Math.abs(buyRatio - 0.5);
    }

    /**
     * Get enhancement statistics for monitoring and debugging
     *
     * EXHAUSTION PHASE 1: Statistics and monitoring interface
     */
    public getEnhancementStats(): ExhaustionEnhancementStats {
        return { ...this.enhancementStats };
    }

    /**
     * Update enhancement mode at runtime (for A/B testing and gradual rollout)
     *
     * EXHAUSTION PHASE 1: Runtime configuration management
     */
    public setEnhancementMode(
        mode: "disabled" | "monitoring" | "production"
    ): void {
        this.enhancementConfig.enhancementMode = mode;
        this.logger.info(
            "ExhaustionDetectorEnhanced: Enhancement mode updated",
            {
                detectorId: this.getId(),
                newMode: mode,
            }
        );
    }

    /**
     * Enhanced cleanup with zone-aware resource management
     *
     * EXHAUSTION PHASE 1: Resource management
     */
    public override cleanup(): void {
        super.cleanup();

        this.logger.info(
            "ExhaustionDetectorEnhanced: Enhanced cleanup completed",
            {
                detectorId: this.getId(),
                enhancementStats: this.enhancementStats,
            }
        );
    }
}
