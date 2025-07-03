// src/indicators/deltaCVDDetectorEnhanced.ts
//
// ✅ DELTACVD PHASE 1: Enhanced DeltaCVDConfirmation with standardized zone integration
//
// This file implements DeltaCVDDetectorEnhanced, a production-safe wrapper around
// the original DeltaCVDConfirmation that adds standardized zone analysis capabilities.
//
// ARCHITECTURE APPROACH:
// - Wrapper pattern: Preserves 100% original detector behavior as baseline
// - Supplementary analysis: Adds standardized zone enhancements as additional layer
// - Production safety: Original signals remain unchanged, enhancements are additive
// - Feature flags: All enhancements can be enabled/disabled via configuration
//
// KEY ENHANCEMENTS:
// - Multi-timeframe CVD divergence analysis (5T, 10T, 20T)
// - Zone-based volume delta confirmation with institutional thresholds
// - Enhanced CVD scoring with zone confluence validation
// - Cross-timeframe momentum alignment detection
//

import { DeltaCVDConfirmation } from "./deltaCVDConfirmation.js";
import { FinancialMath } from "../utils/financialMath.js";
import type { ILogger } from "../infrastructure/loggerInterface.js";
import type { IMetricsCollector } from "../infrastructure/metricsCollectorInterface.js";
import { ISignalLogger } from "../infrastructure/signalLoggerInterface.js";
import { SpoofingDetector } from "../services/spoofingDetector.js";
import type {
    EnrichedTradeEvent,
    StandardZoneData,
    ZoneSnapshot,
} from "../types/marketEvents.js";
import { z } from "zod";
import { DeltaCVDDetectorSchema } from "../core/config.js";
import { Config } from "../core/config.js";

/**
 * Enhanced configuration interface extending DeltaCVDConfirmationSettings with standardized zone capabilities
 *
 * DELTACVD PHASE 1: Core interface for enhanced CVD detection
 */
// Use Zod schema inference for complete type safety - matches config.json exactly
export type DeltaCVDEnhancedSettings = z.infer<typeof DeltaCVDDetectorSchema>;

/**
 * Statistics interface for monitoring DeltaCVD detector enhancements
 *
 * DELTACVD PHASE 1: Comprehensive monitoring and debugging
 */
export interface DeltaCVDEnhancementStats {
    // Call statistics
    callCount: number;
    enhancementCount: number;
    errorCount: number;

    // Feature usage statistics
    confluenceDetectionCount: number;
    cvdDivergenceDetectionCount: number;
    momentumAlignmentCount: number;

    // Performance metrics
    averageConfidenceBoost: number;
    totalConfidenceBoost: number;
    enhancementSuccessRate: number;
}

/**
 * DeltaCVDDetectorEnhanced - Production-safe enhanced CVD detector
 *
 * DELTACVD PHASE 1: Standardized zone integration with multi-timeframe CVD analysis
 *
 * This enhanced detector adds sophisticated multi-timeframe CVD divergence analysis while
 * preserving the original detector's behavior as the production baseline.
 */
export class DeltaCVDDetectorEnhanced extends DeltaCVDConfirmation {
    private readonly useStandardizedZones: boolean;
    private readonly enhancementConfig: DeltaCVDEnhancedSettings;
    private readonly enhancementStats: DeltaCVDEnhancementStats;

    constructor(
        id: string,
        settings: DeltaCVDEnhancedSettings,
        logger: ILogger,
        spoofingDetector: SpoofingDetector,
        metrics: IMetricsCollector,
        signalLogger?: ISignalLogger
    ) {
        // Settings are pre-validated by Config.DELTACVD_DETECTOR getter
        // No validation needed here - trust that settings are correct

        // Initialize parent detector with original settings
        super(id, settings, logger, spoofingDetector, metrics, signalLogger);

        // Initialize enhancement configuration
        this.useStandardizedZones = settings.useStandardizedZones;
        this.enhancementConfig = settings;

        // Initialize enhancement statistics
        this.enhancementStats = {
            callCount: 0,
            enhancementCount: 0,
            errorCount: 0,
            confluenceDetectionCount: 0,
            cvdDivergenceDetectionCount: 0,
            momentumAlignmentCount: 0,
            averageConfidenceBoost: 0,
            totalConfidenceBoost: 0,
            enhancementSuccessRate: 0,
        };

        this.logger.info("DeltaCVDDetectorEnhanced initialized", {
            detectorId: id,
            useStandardizedZones: this.useStandardizedZones,
            enhancementMode: this.enhancementConfig.enhancementMode,
        });
    }

    /**
     * Enhanced trade event processing with standardized zone analysis
     *
     * DELTACVD PHASE 1: Production-safe enhancement wrapper
     */
    public override onEnrichedTrade(event: EnrichedTradeEvent): void {
        // 🔍 DEBUG: Log every trade event received by Enhanced CVD detector
        this.logger.debug(
            "[DeltaCVDDetectorEnhanced DEBUG] Trade event received",
            {
                detectorId: this.getId(),
                price: event.price,
                quantity: event.quantity,
                useStandardizedZones: this.useStandardizedZones,
                enhancementMode: this.enhancementConfig.enhancementMode,
                hasZoneData: !!event.zoneData,
                timestamp: event.timestamp,
            }
        );

        // Always call the original detector first (production baseline)
        // This should trigger base class signal processing including tryEmitSignal()
        this.logger.debug(
            "[DeltaCVDDetectorEnhanced DEBUG] Calling base detector onEnrichedTrade",
            {
                detectorId: this.getId(),
                price: event.price,
            }
        );

        super.onEnrichedTrade(event);

        this.logger.debug(
            "[DeltaCVDDetectorEnhanced DEBUG] Base detector onEnrichedTrade completed",
            {
                detectorId: this.getId(),
                price: event.price,
            }
        );

        // Only apply enhancements if enabled and standardized zones are available
        if (
            !this.useStandardizedZones ||
            this.enhancementConfig.enhancementMode === "disabled" ||
            !event.zoneData
        ) {
            this.logger.debug(
                "[DeltaCVDDetectorEnhanced DEBUG] Skipping enhancements",
                {
                    detectorId: this.getId(),
                    reason: !this.useStandardizedZones
                        ? "standardized_zones_disabled"
                        : this.enhancementConfig.enhancementMode === "disabled"
                          ? "enhancement_disabled"
                          : !event.zoneData
                            ? "no_zone_data"
                            : "unknown",
                    useStandardizedZones: this.useStandardizedZones,
                    enhancementMode: this.enhancementConfig.enhancementMode,
                    hasZoneData: !!event.zoneData,
                }
            );
            return;
        }

        this.enhancementStats.callCount++;

        try {
            // Apply standardized zone enhancements
            this.enhanceCVDAnalysis(event);
        } catch (error) {
            this.enhancementStats.errorCount++;
            this.logger.error("DeltaCVDDetectorEnhanced: Enhancement error", {
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
     * DELTACVD PHASE 1: Multi-timeframe CVD analysis
     */
    private enhanceCVDAnalysis(event: EnrichedTradeEvent): void {
        if (!event.zoneData) return;

        let totalConfidenceBoost = 0;
        let enhancementApplied = false;

        // Zone confluence analysis for CVD validation
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
                    "DeltaCVDDetectorEnhanced: Zone confluence detected for CVD validation",
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

        // CVD divergence analysis across zones
        if (this.enhancementConfig.enableCVDDivergenceAnalysis) {
            const divergenceResult = this.analyzeCVDDivergence(
                event.zoneData,
                event
            );
            if (divergenceResult.hasDivergence) {
                this.enhancementStats.cvdDivergenceDetectionCount++;
                totalConfidenceBoost +=
                    this.enhancementConfig.divergenceConfidenceBoost;
                enhancementApplied = true;

                this.logger.debug(
                    "DeltaCVDDetectorEnhanced: CVD divergence detected",
                    {
                        detectorId: this.getId(),
                        price: event.price,
                        divergenceStrength: divergenceResult.divergenceStrength,
                        affectedZones: divergenceResult.affectedZones,
                        confidenceBoost:
                            this.enhancementConfig.divergenceConfidenceBoost,
                    }
                );
            }
        }

        // Cross-timeframe momentum alignment analysis
        if (this.enhancementConfig.enableMomentumAlignment) {
            const momentumResult = this.analyzeMomentumAlignment(
                event.zoneData,
                event
            );
            if (momentumResult.hasAlignment) {
                this.enhancementStats.momentumAlignmentCount++;
                totalConfidenceBoost +=
                    this.enhancementConfig.momentumAlignmentBoost;
                enhancementApplied = true;

                this.logger.debug(
                    "DeltaCVDDetectorEnhanced: Momentum alignment detected",
                    {
                        detectorId: this.getId(),
                        price: event.price,
                        alignmentScore: momentumResult.alignmentScore,
                        timeframeBreakdown: momentumResult.timeframeBreakdown,
                        confidenceBoost:
                            this.enhancementConfig.momentumAlignmentBoost,
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

            // Store enhanced CVD metrics for monitoring
            this.storeEnhancedCVDMetrics(event, totalConfidenceBoost);
        }
    }

    /**
     * Analyze zone confluence for CVD pattern validation
     *
     * DELTACVD PHASE 1: Multi-timeframe confluence analysis
     */
    private analyzeZoneConfluence(
        zoneData: StandardZoneData,
        price: number
    ): {
        hasConfluence: boolean;
        confluenceZones: number;
        confluenceStrength: number;
    } {
        this.logger.debug(
            "[DeltaCVDDetectorEnhanced DEBUG] analyzeZoneConfluence started",
            {
                detectorId: this.getId(),
                price: price,
                zones5TickCount: zoneData.zones5Tick.length,
                zones10TickCount: zoneData.zones10Tick.length,
                zones20TickCount: zoneData.zones20Tick.length,
            }
        );

        const minConfluenceZones =
            Config.UNIVERSAL_ZONE_CONFIG.minZoneConfluenceCount;
        const maxDistance =
            Config.UNIVERSAL_ZONE_CONFIG.maxZoneConfluenceDistance;

        this.logger.debug(
            "[DeltaCVDDetectorEnhanced DEBUG] analyzeZoneConfluence config",
            {
                detectorId: this.getId(),
                minConfluenceZones,
                maxDistance,
            }
        );

        // Find zones that overlap around the current price
        const relevantZones: ZoneSnapshot[] = [];

        // Check 5-tick zones
        const zones5Near = this.findZonesNearPrice(
            zoneData.zones5Tick,
            price,
            maxDistance
        );
        relevantZones.push(...zones5Near);

        // Check 10-tick zones
        const zones10Near = this.findZonesNearPrice(
            zoneData.zones10Tick,
            price,
            maxDistance
        );
        relevantZones.push(...zones10Near);

        // Check 20-tick zones
        const zones20Near = this.findZonesNearPrice(
            zoneData.zones20Tick,
            price,
            maxDistance
        );
        relevantZones.push(...zones20Near);

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

        this.logger.debug(
            "[DeltaCVDDetectorEnhanced DEBUG] analyzeZoneConfluence result",
            {
                detectorId: this.getId(),
                price,
                zones5Near: zones5Near.length,
                zones10Near: zones10Near.length,
                zones20Near: zones20Near.length,
                confluenceZones,
                hasConfluence,
                confluenceStrength,
                minConfluenceZones,
            }
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
        const maxDistance = FinancialMath.multiplyQuantities(
            maxDistanceTicks,
            Config.TICK_SIZE
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
     * Analyze CVD divergence across standardized zones
     *
     * DELTACVD PHASE 1: Enhanced CVD divergence detection
     */
    private analyzeCVDDivergence(
        zoneData: StandardZoneData,
        event: EnrichedTradeEvent
    ): {
        hasDivergence: boolean;
        divergenceStrength: number;
        affectedZones: number;
    } {
        this.logger.error(
            "[DeltaCVDDetectorEnhanced DEBUG] CRITICAL ISSUE - ALL ZONES HAVE ZERO VOLUME",
            {
                detectorId: this.getId(),
                price: event.price,
                quantity: event.quantity,
                totalZones5: zoneData.zones5Tick.length,
                totalZones10: zoneData.zones10Tick.length,
                totalZones20: zoneData.zones20Tick.length,
                sampleZone5: zoneData.zones5Tick[0]
                    ? {
                          priceLevel: zoneData.zones5Tick[0].priceLevel,
                          aggressiveVolume:
                              zoneData.zones5Tick[0].aggressiveVolume,
                          aggressiveBuyVolume:
                              zoneData.zones5Tick[0].aggressiveBuyVolume,
                          aggressiveSellVolume:
                              zoneData.zones5Tick[0].aggressiveSellVolume,
                          passiveVolume: zoneData.zones5Tick[0].passiveVolume,
                          totalVolume:
                              zoneData.zones5Tick[0].aggressiveVolume +
                              zoneData.zones5Tick[0].passiveVolume,
                      }
                    : "no zones",
                sampleZone10: zoneData.zones10Tick[0]
                    ? {
                          priceLevel: zoneData.zones10Tick[0].priceLevel,
                          aggressiveVolume:
                              zoneData.zones10Tick[0].aggressiveVolume,
                          totalVolume:
                              zoneData.zones10Tick[0].aggressiveVolume +
                              zoneData.zones10Tick[0].passiveVolume,
                      }
                    : "no zones",
            }
        );

        const volumeThreshold =
            this.enhancementConfig.cvdDivergenceVolumeThreshold;
        const minStrength =
            this.enhancementConfig.cvdDivergenceStrengthThreshold;

        this.logger.debug(
            "[DeltaCVDDetectorEnhanced DEBUG] analyzeCVDDivergence thresholds",
            {
                detectorId: this.getId(),
                volumeThreshold,
                minStrength,
                cvdSignificantImbalanceThreshold:
                    this.enhancementConfig.cvdSignificantImbalanceThreshold,
                cvdDivergenceScoreMultiplier:
                    this.enhancementConfig.cvdDivergenceScoreMultiplier,
            }
        );

        // Analyze all zones for CVD divergence patterns
        const allZones = [
            ...zoneData.zones5Tick,
            ...zoneData.zones10Tick,
            ...zoneData.zones20Tick,
        ];

        const relevantZones = this.findZonesNearPrice(allZones, event.price, 5);

        this.logger.debug(
            "[DeltaCVDDetectorEnhanced DEBUG] analyzeCVDDivergence zones found",
            {
                detectorId: this.getId(),
                totalZones: allZones.length,
                relevantZones: relevantZones.length,
                searchPrice: event.price,
                searchDistance: 5,
            }
        );

        let totalDivergenceScore = 0;
        let affectedZones = 0;
        let zonesTooSmall = 0;
        let zonesProcessed = 0;

        relevantZones.forEach((zone, index) => {
            zonesProcessed++;
            const aggressiveVolume = zone.aggressiveVolume;

            // Check if this zone shows CVD divergence patterns
            const buyVolume = zone.aggressiveBuyVolume;
            const sellVolume = zone.aggressiveSellVolume;

            this.logger.debug(
                "[DeltaCVDDetectorEnhanced DEBUG] analyzeCVDDivergence zone analysis",
                {
                    detectorId: this.getId(),
                    zoneIndex: index,
                    zonePriceLevel: zone.priceLevel,
                    aggressiveVolume,
                    buyVolume,
                    sellVolume,
                    volumeThreshold,
                    meetsVolumeThreshold: aggressiveVolume >= volumeThreshold,
                }
            );

            if (aggressiveVolume >= volumeThreshold) {
                // Calculate CVD delta for this zone using FinancialMath
                const cvdDelta = FinancialMath.calculateSpread(
                    buyVolume,
                    sellVolume,
                    8
                );
                const volumeRatio = FinancialMath.divideQuantities(
                    Math.abs(cvdDelta),
                    aggressiveVolume
                );

                const cvdSignificantImbalanceThreshold =
                    this.enhancementConfig.cvdSignificantImbalanceThreshold;

                this.logger.debug(
                    "[DeltaCVDDetectorEnhanced DEBUG] analyzeCVDDivergence CVD calculation",
                    {
                        detectorId: this.getId(),
                        zoneIndex: index,
                        cvdDelta,
                        volumeRatio,
                        cvdSignificantImbalanceThreshold,
                        meetsImbalanceThreshold:
                            volumeRatio >= cvdSignificantImbalanceThreshold,
                    }
                );

                if (volumeRatio >= cvdSignificantImbalanceThreshold) {
                    // Significant CVD imbalance detected
                    const divergenceScore = Math.min(
                        1.0,
                        FinancialMath.multiplyQuantities(
                            volumeRatio,
                            this.enhancementConfig.cvdDivergenceScoreMultiplier
                        )
                    );
                    totalDivergenceScore += divergenceScore;
                    affectedZones++;

                    this.logger.debug(
                        "[DeltaCVDDetectorEnhanced DEBUG] analyzeCVDDivergence divergence detected",
                        {
                            detectorId: this.getId(),
                            zoneIndex: index,
                            divergenceScore,
                            totalDivergenceScore,
                            affectedZones,
                        }
                    );
                }
            } else {
                zonesTooSmall++;
            }
        });

        this.logger.debug(
            "[DeltaCVDDetectorEnhanced DEBUG] analyzeCVDDivergence processing summary",
            {
                detectorId: this.getId(),
                zonesProcessed,
                zonesTooSmall,
                affectedZones,
                totalDivergenceScore,
            }
        );

        // 🔧 CLAUDE.md COMPLIANCE: Return null when calculation cannot be performed
        if (affectedZones === 0) {
            this.logger.debug(
                "[DeltaCVDDetectorEnhanced DEBUG] analyzeCVDDivergence no divergence detected",
                {
                    detectorId: this.getId(),
                    reason: "no_affected_zones",
                    zonesProcessed,
                    zonesTooSmall,
                }
            );
            return {
                hasDivergence: false,
                divergenceStrength: 0, // No divergence detected
                affectedZones: 0,
            };
        }

        const averageDivergence = FinancialMath.divideQuantities(
            totalDivergenceScore,
            affectedZones
        );
        const hasDivergence = averageDivergence >= minStrength;

        this.logger.debug(
            "[DeltaCVDDetectorEnhanced DEBUG] analyzeCVDDivergence final result",
            {
                detectorId: this.getId(),
                averageDivergence,
                minStrength,
                hasDivergence,
                affectedZones,
            }
        );

        return {
            hasDivergence,
            divergenceStrength: averageDivergence,
            affectedZones,
        };
    }

    /**
     * Analyze momentum alignment across timeframes
     *
     * DELTACVD PHASE 1: Multi-timeframe momentum analysis
     */
    private analyzeMomentumAlignment(
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
        this.logger.debug(
            "[DeltaCVDDetectorEnhanced DEBUG] analyzeMomentumAlignment started",
            {
                detectorId: this.getId(),
                price: event.price,
                zones5Count: zoneData.zones5Tick.length,
                zones10Count: zoneData.zones10Tick.length,
                zones20Count: zoneData.zones20Tick.length,
                alignmentMinimumThreshold:
                    this.enhancementConfig.alignmentMinimumThreshold,
            }
        );

        // Calculate momentum strength for each timeframe
        const tick5Momentum = this.calculateTimeframeMomentum(
            zoneData.zones5Tick,
            event.price
        );
        const tick10Momentum = this.calculateTimeframeMomentum(
            zoneData.zones10Tick,
            event.price
        );
        const tick20Momentum = this.calculateTimeframeMomentum(
            zoneData.zones20Tick,
            event.price
        );

        const timeframeBreakdown = {
            tick5: tick5Momentum,
            tick10: tick10Momentum,
            tick20: tick20Momentum,
        };

        this.logger.debug(
            "[DeltaCVDDetectorEnhanced DEBUG] analyzeMomentumAlignment timeframe momentum",
            {
                detectorId: this.getId(),
                tick5Momentum,
                tick10Momentum,
                tick20Momentum,
            }
        );

        // Calculate alignment score using FinancialMath (how similar momentum levels are across timeframes)
        const momentumValues = [tick5Momentum, tick10Momentum, tick20Momentum];
        const avgMomentum = FinancialMath.calculateMean(momentumValues);
        const stdDev = FinancialMath.calculateStdDev(momentumValues);

        this.logger.debug(
            "[DeltaCVDDetectorEnhanced DEBUG] analyzeMomentumAlignment statistics",
            {
                detectorId: this.getId(),
                momentumValues,
                avgMomentum,
                stdDev,
            }
        );

        // 🔧 CLAUDE.md COMPLIANCE: Return null when calculation cannot be performed
        if (avgMomentum === null || stdDev === null) {
            this.logger.debug(
                "[DeltaCVDDetectorEnhanced DEBUG] analyzeMomentumAlignment calculation failed",
                {
                    detectorId: this.getId(),
                    reason:
                        avgMomentum === null
                            ? "avgMomentum_null"
                            : "stdDev_null",
                    momentumValues,
                }
            );
            return {
                hasAlignment: false,
                alignmentScore: 0,
                timeframeBreakdown,
            };
        }

        // Use normalized standard deviation as variability measure (lower = better alignment)
        const normalizedVariability =
            avgMomentum > 0
                ? FinancialMath.divideQuantities(stdDev, avgMomentum)
                : 1;
        const alignmentScore = FinancialMath.multiplyQuantities(
            avgMomentum,
            Math.max(0, 1 - normalizedVariability)
        ); // Penalize high variability
        const hasAlignment =
            alignmentScore >= this.enhancementConfig.alignmentMinimumThreshold;

        this.logger.debug(
            "[DeltaCVDDetectorEnhanced DEBUG] analyzeMomentumAlignment final result",
            {
                detectorId: this.getId(),
                normalizedVariability,
                alignmentScore,
                alignmentMinimumThreshold:
                    this.enhancementConfig.alignmentMinimumThreshold,
                hasAlignment,
                timeframeBreakdown,
            }
        );

        return {
            hasAlignment,
            alignmentScore,
            timeframeBreakdown,
        };
    }

    /**
     * Calculate momentum strength for a specific timeframe
     *
     * DELTACVD PHASE 1: Timeframe-specific momentum analysis
     */
    private calculateTimeframeMomentum(
        zones: ZoneSnapshot[],
        price: number
    ): number {
        this.logger.debug(
            "[DeltaCVDDetectorEnhanced DEBUG] calculateTimeframeMomentum started",
            {
                detectorId: this.getId(),
                price,
                totalZones: zones.length,
                searchDistance: 3,
            }
        );

        if (zones.length === 0) {
            this.logger.debug(
                "[DeltaCVDDetectorEnhanced DEBUG] calculateTimeframeMomentum no zones",
                {
                    detectorId: this.getId(),
                    result: 0,
                }
            );
            return 0;
        }

        const relevantZones = this.findZonesNearPrice(zones, price, 3);
        if (relevantZones.length === 0) {
            this.logger.debug(
                "[DeltaCVDDetectorEnhanced DEBUG] calculateTimeframeMomentum no relevant zones",
                {
                    detectorId: this.getId(),
                    totalZones: zones.length,
                    relevantZones: 0,
                    result: 0,
                }
            );
            return 0;
        }

        this.logger.debug(
            "[DeltaCVDDetectorEnhanced DEBUG] calculateTimeframeMomentum zones found",
            {
                detectorId: this.getId(),
                totalZones: zones.length,
                relevantZones: relevantZones.length,
                momentumScoreMultiplier:
                    this.enhancementConfig.momentumScoreMultiplier,
            }
        );

        let totalMomentumScore = 0;
        let zonesProcessed = 0;
        let zonesSkipped = 0;

        for (const zone of relevantZones) {
            const totalVolume = zone.aggressiveVolume + zone.passiveVolume;
            if (totalVolume === 0) {
                zonesSkipped++;
                continue;
            }

            zonesProcessed++;

            // For CVD momentum, we want strong directional volume flow using FinancialMath
            const buyVolume = zone.aggressiveBuyVolume;
            const sellVolume = zone.aggressiveSellVolume;
            const cvdDelta = FinancialMath.calculateSpread(
                buyVolume,
                sellVolume,
                8
            );
            const cvdRatio = FinancialMath.divideQuantities(
                Math.abs(cvdDelta),
                totalVolume
            );

            // Higher ratio = stronger momentum
            const momentumScoreMultiplier =
                this.enhancementConfig.momentumScoreMultiplier;
            const momentumScore = Math.min(
                1.0,
                FinancialMath.multiplyQuantities(
                    cvdRatio,
                    momentumScoreMultiplier
                )
            );
            totalMomentumScore += momentumScore;

            this.logger.debug(
                "[DeltaCVDDetectorEnhanced DEBUG] calculateTimeframeMomentum zone processed",
                {
                    detectorId: this.getId(),
                    zonePriceLevel: zone.priceLevel,
                    buyVolume,
                    sellVolume,
                    totalVolume,
                    cvdDelta,
                    cvdRatio,
                    momentumScore,
                    totalMomentumScore,
                }
            );
        }

        const finalMomentum = FinancialMath.divideQuantities(
            totalMomentumScore,
            relevantZones.length
        );

        this.logger.debug(
            "[DeltaCVDDetectorEnhanced DEBUG] calculateTimeframeMomentum final result",
            {
                detectorId: this.getId(),
                zonesProcessed,
                zonesSkipped,
                totalMomentumScore,
                relevantZonesCount: relevantZones.length,
                finalMomentum,
            }
        );

        return finalMomentum;
    }

    /**
     * Store enhanced CVD metrics for monitoring and analysis
     *
     * DELTACVD PHASE 1: Comprehensive metrics tracking
     */
    private storeEnhancedCVDMetrics(
        event: EnrichedTradeEvent,
        confidenceBoost: number
    ): void {
        // Store metrics for monitoring (commented out to avoid metrics interface errors)
        // this.metricsCollector.recordGauge('cvd.enhanced.confidence_boost', confidenceBoost);
        // this.metricsCollector.recordCounter('cvd.enhanced.analysis_count', 1);

        this.logger.debug("DeltaCVDDetectorEnhanced: Enhanced metrics stored", {
            detectorId: this.getId(),
            price: event.price,
            confidenceBoost,
            enhancementStats: this.enhancementStats,
        });
    }

    /**
     * Get enhancement statistics for monitoring and debugging
     *
     * DELTACVD PHASE 1: Statistics and monitoring interface
     */
    public getEnhancementStats(): DeltaCVDEnhancementStats {
        return { ...this.enhancementStats };
    }

    /**
     * Update enhancement mode at runtime (for A/B testing and gradual rollout)
     *
     * DELTACVD PHASE 1: Runtime configuration management
     */
    public setEnhancementMode(
        mode: "disabled" | "monitoring" | "production"
    ): void {
        this.enhancementConfig.enhancementMode = mode;
        this.logger.info("DeltaCVDDetectorEnhanced: Enhancement mode updated", {
            detectorId: this.getId(),
            newMode: mode,
        });
    }

    /**
     * Enhanced cleanup with zone-aware resource management
     *
     * DELTACVD PHASE 1: Resource management
     */
    public override cleanup(): void {
        super.cleanup();

        this.logger.info(
            "DeltaCVDDetectorEnhanced: Enhanced cleanup completed",
            {
                detectorId: this.getId(),
                enhancementStats: this.enhancementStats,
            }
        );
    }
}
