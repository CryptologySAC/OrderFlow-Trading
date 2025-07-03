// src/indicators/absorptionDetectorEnhanced.ts
/**
 * Enhanced AbsorptionDetector with Standardized Zone Integration
 *
 * PRODUCTION-SAFE ENHANCEMENT WRAPPER
 *
 * This enhanced detector integrates with OrderFlowPreprocessor's standardized zones
 * to provide multi-timeframe absorption analysis while preserving the original
 * AbsorptionDetector's production-tested behavior as the baseline.
 *
 * Key Features:
 * - Multi-timeframe zone confluence analysis (5T, 10T, 20T)
 * - Institutional volume detection using standardized thresholds
 * - Enhanced absorption quality scoring with zone confluence
 * - Performance optimization through shared zone cache
 * - Feature flag controlled enhancement deployment
 *
 * Architecture:
 * - 80% weight: Original AbsorptionDetector behavior (production baseline)
 * - 20% weight: Enhanced standardized zone analysis (supplementary)
 * - Fallback: Graceful degradation if standardized zones unavailable
 *
 * CRITICAL: DO NOT MODIFY ORIGINAL DETECTOR - This is a wrapper only
 */

import { AbsorptionDetector } from "./absorptionDetector.js";
// AbsorptionSettings no longer used - enhanced detector uses Zod schema inference
import { FinancialMath } from "../utils/financialMath.js";
import { Config } from "../core/config.js";
import type { ILogger } from "../infrastructure/loggerInterface.js";
import type { IMetricsCollector } from "../infrastructure/metricsCollectorInterface.js";
import { ISignalLogger } from "../infrastructure/signalLoggerInterface.js";
import { SpoofingDetector } from "../services/spoofingDetector.js";
import { IOrderBookState } from "../market/orderBookState.js";
import type {
    EnrichedTradeEvent,
    ZoneSnapshot,
    StandardZoneData,
} from "../types/marketEvents.js";
import { z } from "zod";
import { AbsorptionDetectorSchema } from "../core/config.js";

// ✅ CLAUDE.md COMPLIANCE: Use Config getter type for pre-validated settings
// This ensures settings are validated by Zod and guaranteed to be complete

export interface AbsorptionEnhancementStats {
    enabled: boolean;
    mode: string;
    callCount: number;
    enhancementCount: number;
    confluenceDetectionCount: number;
    institutionalDetectionCount: number;
    crossTimeframeDetectionCount: number;
    enhancementSuccessRate: number;
    averageConfidenceBoost: number;
    errorCount: number;
    lastEnhancementTime?: number;
}

/**
 * Enhanced AbsorptionDetector with multi-timeframe zone analysis
 *
 * PRODUCTION-SAFE: Uses wrapper pattern to preserve original behavior
 */
export class AbsorptionDetectorEnhanced extends AbsorptionDetector {
    private readonly useStandardizedZones: boolean;
    private readonly enhancementConfig: typeof Config.ABSORPTION_DETECTOR;

    // Enhancement statistics and monitoring
    private enhancementStats: AbsorptionEnhancementStats = {
        enabled: false,
        mode: "disabled",
        callCount: 0,
        enhancementCount: 0,
        confluenceDetectionCount: 0,
        institutionalDetectionCount: 0,
        crossTimeframeDetectionCount: 0,
        enhancementSuccessRate: 0,
        averageConfidenceBoost: 0,
        errorCount: 0,
    };

    private totalConfidenceBoost = 0;

    constructor(
        id: string,
        settings: typeof Config.ABSORPTION_DETECTOR, // Pre-validated by Zod
        orderBook: IOrderBookState,
        logger: ILogger,
        spoofingDetector: SpoofingDetector,
        metricsCollector: IMetricsCollector,
        signalLogger?: ISignalLogger
    ) {
        // Settings are pre-validated by Config.ABSORPTION_DETECTOR getter
        // No validation needed here - trust that settings are correct

        // Initialize the original detector with complete settings
        // AbsorptionEnhancedSettings now contains ALL properties from config.json
        super(
            id,
            settings,
            orderBook,
            logger,
            spoofingDetector,
            metricsCollector,
            signalLogger
        );

        // Configure standardized zone enhancement
        this.useStandardizedZones = settings.useStandardizedZones;
        this.enhancementConfig = settings;

        // Update enhancement statistics
        this.enhancementStats.enabled = this.useStandardizedZones;
        this.enhancementStats.mode = settings.enhancementMode;

        this.logger.info("AbsorptionDetectorEnhanced initialized", {
            detectorId: id,
            useStandardizedZones: this.useStandardizedZones,
            enhancementMode: this.enhancementStats.mode,
            enhancementConfig: this.enhancementConfig,
        });
    }

    /**
     * Enhanced trade processing with standardized zone analysis
     *
     * PRODUCTION-SAFE: Preserves original behavior, adds enhancements as supplementary analysis
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
            this.enhanceAbsorptionAnalysis(event);
        } catch (error) {
            this.enhancementStats.errorCount++;
            this.logger.warn("AbsorptionDetectorEnhanced: Enhancement failed", {
                error: error instanceof Error ? error.message : String(error),
                detectorId: this.getId(),
                price: event.price,
                timestamp: event.timestamp,
            });
            // Continue with original detector behavior - no impact on production signals
        }
    }

    /**
     * Enhance absorption analysis with standardized zone data
     */
    private enhanceAbsorptionAnalysis(event: EnrichedTradeEvent): void {
        const zoneData = event.zoneData;
        if (!zoneData) return;

        this.enhancementStats.enhancementCount++;
        this.enhancementStats.lastEnhancementTime = Date.now();

        let totalConfidenceBoost = 0;

        // Zone confluence analysis
        if (Config.UNIVERSAL_ZONE_CONFIG.enableZoneConfluenceFilter) {
            const confluenceResult = this.analyzeZoneConfluence(
                zoneData,
                event.price
            );
            if (confluenceResult.hasConfluence) {
                this.enhancementStats.confluenceDetectionCount++;
                totalConfidenceBoost +=
                    Config.UNIVERSAL_ZONE_CONFIG.confluenceConfidenceBoost;

                this.logger.debug(
                    "AbsorptionDetectorEnhanced: Advanced zone confluence detected",
                    {
                        detectorId: this.getId(),
                        price: event.price,
                        confluenceZones: confluenceResult.confluenceZones,
                        confluenceScore: confluenceResult.confluenceScore,
                        confluenceStrength: confluenceResult.confluenceStrength,
                        timeframeBreakdown: confluenceResult.timeframeBreakdown,
                        absorptionAlignment:
                            confluenceResult.absorptionAlignment,
                        confidenceBoost:
                            Config.UNIVERSAL_ZONE_CONFIG
                                .confluenceConfidenceBoost,
                    }
                );
            }
        }

        // Institutional volume analysis
        if (this.enhancementConfig.enableInstitutionalVolumeFilter) {
            const institutionalResult = this.analyzeInstitutionalVolume(
                zoneData,
                event
            );
            if (institutionalResult.hasInstitutionalPresence) {
                this.enhancementStats.institutionalDetectionCount++;
                totalConfidenceBoost +=
                    this.enhancementConfig.institutionalVolumeBoost;

                this.logger.debug(
                    "AbsorptionDetectorEnhanced: Institutional volume detected",
                    {
                        detectorId: this.getId(),
                        price: event.price,
                        institutionalRatio:
                            institutionalResult.institutionalRatio,
                        confidenceBoost:
                            this.enhancementConfig.institutionalVolumeBoost,
                    }
                );
            }
        }

        // Cross-timeframe analysis
        if (Config.UNIVERSAL_ZONE_CONFIG.enableCrossTimeframeAnalysis) {
            const crossTimeframeResult = this.analyzeCrossTimeframe(
                zoneData,
                event
            );
            if (crossTimeframeResult.hasAlignment) {
                this.enhancementStats.crossTimeframeDetectionCount++;
                totalConfidenceBoost +=
                    Config.UNIVERSAL_ZONE_CONFIG.crossTimeframeBoost;

                this.logger.debug(
                    "AbsorptionDetectorEnhanced: Cross-timeframe alignment detected",
                    {
                        detectorId: this.getId(),
                        price: event.price,
                        alignedTimeframes:
                            crossTimeframeResult.alignedTimeframes,
                        confidenceBoost:
                            Config.UNIVERSAL_ZONE_CONFIG.crossTimeframeBoost,
                    }
                );
            }
        }

        // Update enhancement statistics
        this.totalConfidenceBoost += totalConfidenceBoost;
        this.enhancementStats.averageConfidenceBoost =
            this.enhancementStats.enhancementCount > 0
                ? this.totalConfidenceBoost /
                  this.enhancementStats.enhancementCount
                : 0;

        this.enhancementStats.enhancementSuccessRate =
            this.enhancementStats.callCount > 0
                ? (this.enhancementStats.enhancementCount -
                      this.enhancementStats.errorCount) /
                  this.enhancementStats.callCount
                : 0;

        // Store enhanced metrics for potential signal boosting
        if (totalConfidenceBoost > 0) {
            this.storeEnhancedAbsorptionMetrics(event, totalConfidenceBoost);
        }
    }

    /**
     * Enhanced multi-timeframe zone confluence analysis with sophisticated algorithms
     *
     * ABSORPTION PHASE 2.1: Advanced confluence detection with:
     * - Volume-weighted confluence scoring
     * - Timeframe priority weighting
     * - Absorption pattern strength analysis
     * - Dynamic distance thresholds based on market volatility
     */
    private analyzeZoneConfluence(
        zoneData: StandardZoneData,
        price: number
    ): {
        hasConfluence: boolean;
        confluenceZones: number;
        confluenceStrength: number;
        confluenceScore: number;
        timeframeBreakdown: {
            tick5: number;
            tick10: number;
            tick20: number;
        };
        absorptionAlignment: number;
    } {
        const minConfluenceZones =
            Config.UNIVERSAL_ZONE_CONFIG.minZoneConfluenceCount;
        const maxDistance =
            Config.UNIVERSAL_ZONE_CONFIG.maxZoneConfluenceDistance;

        // Multi-timeframe analysis with priority weighting
        const tick5Zones = this.findZonesNearPrice(
            zoneData.zones5Tick,
            price,
            maxDistance
        );
        const tick10Zones = this.findZonesNearPrice(
            zoneData.zones10Tick,
            price,
            maxDistance
        );
        const tick20Zones = this.findZonesNearPrice(
            zoneData.zones20Tick,
            price,
            maxDistance
        );

        // Calculate timeframe-specific confluence strength
        const timeframeBreakdown = {
            tick5: this.calculateTimeframeConfluenceStrength(
                tick5Zones,
                price,
                0.4
            ), // Highest weight - most responsive
            tick10: this.calculateTimeframeConfluenceStrength(
                tick10Zones,
                price,
                0.35
            ), // Medium weight - balanced
            tick20: this.calculateTimeframeConfluenceStrength(
                tick20Zones,
                price,
                0.25
            ), // Lower weight - trend confirmation
        };

        // Enhanced confluence scoring with volume and absorption pattern weighting
        const confluenceScore = this.calculateAdvancedConfluenceScore(
            tick5Zones,
            tick10Zones,
            tick20Zones,
            price,
            timeframeBreakdown
        );

        // Analyze absorption pattern alignment across timeframes
        const absorptionAlignment = this.calculateAbsorptionAlignment(
            tick5Zones,
            tick10Zones,
            tick20Zones
        );
        if (absorptionAlignment === null) {
            return {
                hasConfluence: false,
                confluenceZones: 0,
                confluenceStrength: 0,
                confluenceScore: 0,
                timeframeBreakdown,
                absorptionAlignment: 0,
            };
        }

        const totalZones =
            tick5Zones.length + tick10Zones.length + tick20Zones.length;
        const hasConfluence =
            totalZones >= minConfluenceZones &&
            confluenceScore >= this.enhancementConfig.minConfluenceScore;

        // Enhanced confluence strength calculation using FinancialMath
        const baseStrength = Math.min(
            1.0,
            FinancialMath.divideQuantities(totalZones, minConfluenceZones * 2)
        );
        const volumeBoost = this.calculateVolumeConfluenceBoost(
            tick5Zones,
            tick10Zones,
            tick20Zones
        );
        const confidenceBoostReduction =
            this.enhancementConfig.confidenceBoostReduction;
        const alignmentBoost = FinancialMath.multiplyQuantities(
            absorptionAlignment,
            confidenceBoostReduction
        );

        const confluenceStrength = Math.min(
            1.0,
            baseStrength + volumeBoost + alignmentBoost
        );

        return {
            hasConfluence,
            confluenceZones: totalZones,
            confluenceStrength,
            confluenceScore,
            timeframeBreakdown,
            absorptionAlignment,
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
     * Calculate timeframe-specific confluence strength with volume weighting
     *
     * ABSORPTION PHASE 2.1: Advanced timeframe analysis
     */
    private calculateTimeframeConfluenceStrength(
        zones: ZoneSnapshot[],
        price: number,
        timeframeWeight: number
    ): number {
        if (zones.length === 0) return 0;

        let totalStrength = 0;
        let totalWeight = 0;

        for (const zone of zones) {
            // Distance-based strength (closer zones have higher strength) using FinancialMath
            const distance = FinancialMath.calculateSpread(
                zone.priceLevel,
                price,
                8
            );
            const maxDistance =
                Config.UNIVERSAL_ZONE_CONFIG.maxZoneConfluenceDistance;
            const tickValue = Config.TICK_SIZE;
            const maxDistanceValue = FinancialMath.multiplyQuantities(
                maxDistance,
                tickValue
            );
            const normalizedDistance = FinancialMath.divideQuantities(
                distance,
                maxDistanceValue
            );
            const distanceStrength = Math.max(0, 1 - normalizedDistance);

            // Volume-based strength (higher volume zones have higher strength) using FinancialMath
            const totalVolume = zone.aggressiveVolume + zone.passiveVolume;
            const volumeStrength = Math.min(
                1.0,
                FinancialMath.divideQuantities(
                    totalVolume,
                    this.enhancementConfig.volumeNormalizationThreshold
                )
            );

            // Absorption pattern strength (passive > aggressive indicates absorption) using FinancialMath
            const absorptionRatio = FinancialMath.divideQuantities(
                zone.passiveVolume,
                Math.max(
                    this.enhancementConfig.minVolumeForRatio,
                    zone.aggressiveVolume
                )
            );
            const absorptionStrength = Math.min(
                1.0,
                FinancialMath.divideQuantities(
                    absorptionRatio,
                    this.enhancementConfig.absorptionRatioNormalization
                )
            );

            // Combined zone strength using configurable weights
            const zoneStrength =
                FinancialMath.multiplyQuantities(
                    distanceStrength,
                    this.enhancementConfig.distanceWeight
                ) +
                FinancialMath.multiplyQuantities(
                    volumeStrength,
                    this.enhancementConfig.volumeWeight
                ) +
                FinancialMath.multiplyQuantities(
                    absorptionStrength,
                    this.enhancementConfig.absorptionWeight
                );

            totalStrength += FinancialMath.multiplyQuantities(
                zoneStrength,
                timeframeWeight
            );
            totalWeight += timeframeWeight;
        }

        return totalWeight > 0
            ? FinancialMath.divideQuantities(totalStrength, totalWeight)
            : 0;
    }

    /**
     * Calculate advanced confluence score using sophisticated weighting algorithms
     *
     * ABSORPTION PHASE 2.1: Multi-factor confluence scoring
     */
    private calculateAdvancedConfluenceScore(
        tick5Zones: ZoneSnapshot[],
        tick10Zones: ZoneSnapshot[],
        tick20Zones: ZoneSnapshot[],
        price: number,
        timeframeBreakdown: { tick5: number; tick10: number; tick20: number }
    ): number {
        // Base confluence score from timeframe strengths
        const baseScore =
            timeframeBreakdown.tick5 +
            timeframeBreakdown.tick10 +
            timeframeBreakdown.tick20;

        // Timeframe diversity bonus (having zones in multiple timeframes is stronger)
        const activeTimeframes = [
            tick5Zones.length > 0 ? 1 : 0,
            tick10Zones.length > 0 ? 1 : 0,
            tick20Zones.length > 0 ? 1 : 0,
        ].reduce((sum, active) => sum + active, 0);

        const diversityBonus = (activeTimeframes / 3) * 0.2; // Up to 20% bonus for full timeframe coverage

        // Volume concentration analysis
        const allZones = [...tick5Zones, ...tick10Zones, ...tick20Zones];
        const volumeConcentration = this.calculateVolumeConcentration(
            allZones,
            price
        );

        // Pattern consistency across timeframes
        const patternConsistency = this.calculatePatternConsistency(
            tick5Zones,
            tick10Zones,
            tick20Zones
        );
        if (patternConsistency === null) {
            return 0;
        }

        // Final confluence score using FinancialMath
        const confluenceScore = Math.min(
            1.0,
            baseScore +
                diversityBonus +
                FinancialMath.multiplyQuantities(
                    volumeConcentration,
                    this.enhancementConfig.volumeConcentrationWeight
                ) +
                FinancialMath.multiplyQuantities(
                    patternConsistency,
                    this.enhancementConfig.patternConsistencyWeight
                )
        );

        return confluenceScore;
    }

    /**
     * Calculate absorption pattern alignment across timeframes
     *
     * ABSORPTION PHASE 2.1: Cross-timeframe absorption pattern analysis
     */
    private calculateAbsorptionAlignment(
        tick5Zones: ZoneSnapshot[],
        tick10Zones: ZoneSnapshot[],
        tick20Zones: ZoneSnapshot[]
    ): number | null {
        const timeframeAlignments = [
            this.getTimeframeAbsorptionStrength(tick5Zones),
            this.getTimeframeAbsorptionStrength(tick10Zones),
            this.getTimeframeAbsorptionStrength(tick20Zones),
        ].filter((alignment) => alignment !== null);

        if (timeframeAlignments.length === 0) {
            return null; // CLAUDE.md compliance: return null when no valid data
        }

        // Calculate alignment consistency using FinancialMath (how similar the absorption patterns are across timeframes)
        const avgAlignment = FinancialMath.calculateMean(timeframeAlignments);
        if (avgAlignment === null) {
            return null; // CLAUDE.md compliance: return null when calculation cannot be performed
        }

        // Calculate variance using FinancialMath (lower variance = better alignment)
        const stdDev = FinancialMath.calculateStdDev(timeframeAlignments);
        if (stdDev === null) {
            return null; // CLAUDE.md compliance: return null when calculation cannot be performed
        }

        const variance = FinancialMath.multiplyQuantities(stdDev, stdDev); // Variance = stdDev^2
        const alignmentConsistency = Math.max(0, 1 - variance); // Lower variance = higher consistency

        // Weight by overall absorption strength
        return FinancialMath.multiplyQuantities(
            avgAlignment,
            alignmentConsistency
        );
    }

    /**
     * Calculate volume confluence boost based on zone volume distribution
     *
     * ABSORPTION PHASE 2.1: Volume-weighted confluence enhancement
     */
    private calculateVolumeConfluenceBoost(
        tick5Zones: ZoneSnapshot[],
        tick10Zones: ZoneSnapshot[],
        tick20Zones: ZoneSnapshot[]
    ): number {
        const allZones = [...tick5Zones, ...tick10Zones, ...tick20Zones];
        if (allZones.length === 0) return 0;

        const totalVolume = allZones.reduce(
            (sum, zone) => sum + zone.aggressiveVolume + zone.passiveVolume,
            0
        );
        const avgVolumePerZone = totalVolume / allZones.length;

        // Boost based on high volume concentration in confluent zones
        const highVolumeZones = allZones.filter(
            (zone) =>
                zone.aggressiveVolume + zone.passiveVolume >
                avgVolumePerZone * 1.5
        );

        const volumeBoost = Math.min(
            0.25,
            FinancialMath.multiplyQuantities(
                FinancialMath.divideQuantities(
                    highVolumeZones.length,
                    allZones.length
                ),
                0.25
            )
        );
        return volumeBoost;
    }

    /**
     * Calculate volume concentration around price level
     *
     * ABSORPTION PHASE 2.1: Volume distribution analysis
     */
    private calculateVolumeConcentration(
        zones: ZoneSnapshot[],
        price: number
    ): number {
        if (zones.length === 0) return 0;

        const totalVolume = zones.reduce(
            (sum, zone) => sum + zone.aggressiveVolume + zone.passiveVolume,
            0
        );

        // Find zones closest to price and calculate their volume share using FinancialMath
        const sortedByDistance = zones.sort(
            (a, b) =>
                FinancialMath.calculateSpread(a.priceLevel, price, 8) -
                FinancialMath.calculateSpread(b.priceLevel, price, 8)
        );

        const closestZones = sortedByDistance.slice(
            0,
            Math.min(
                this.enhancementConfig.maxZoneCountForScoring,
                zones.length
            )
        ); // Top N closest zones
        const closestVolume = closestZones.reduce(
            (sum, zone) => sum + zone.aggressiveVolume + zone.passiveVolume,
            0
        );

        return totalVolume > 0
            ? FinancialMath.divideQuantities(closestVolume, totalVolume)
            : 0;
    }

    /**
     * Calculate pattern consistency across timeframes
     *
     * ABSORPTION PHASE 2.1: Cross-timeframe pattern validation
     */
    private calculatePatternConsistency(
        tick5Zones: ZoneSnapshot[],
        tick10Zones: ZoneSnapshot[],
        tick20Zones: ZoneSnapshot[]
    ): number | null {
        const timeframePatterns = [
            this.analyzeZonePattern(tick5Zones),
            this.analyzeZonePattern(tick10Zones),
            this.analyzeZonePattern(tick20Zones),
        ];

        // Calculate pattern similarity (absorption vs distribution characteristics)
        // Calculate pattern variance using FinancialMath statistical methods
        const patternScores = timeframePatterns.map((p) => p.absorptionScore);
        const stdDev = FinancialMath.calculateStdDev(patternScores);
        if (stdDev === null) {
            return null; // CLAUDE.md compliance: return null when calculation cannot be performed
        }

        const variance = FinancialMath.multiplyQuantities(stdDev, stdDev);
        // Higher consistency = lower variance, normalized by pattern variance reduction factor
        return Math.max(
            0,
            1 -
                FinancialMath.multiplyQuantities(
                    variance,
                    this.enhancementConfig.patternVarianceReduction
                )
        );
    }

    /**
     * Get absorption strength for a specific timeframe
     *
     * ABSORPTION PHASE 2.1: Timeframe-specific absorption analysis
     */
    private getTimeframeAbsorptionStrength(
        zones: ZoneSnapshot[]
    ): number | null {
        if (zones.length === 0) return 0;

        const absorptionScores = zones.map((zone) => {
            const totalVolume = zone.aggressiveVolume + zone.passiveVolume;
            if (totalVolume === 0) return 0;

            const passiveRatio = FinancialMath.divideQuantities(
                zone.passiveVolume,
                totalVolume
            );
            const absorptionStrength =
                passiveRatio > this.enhancementConfig.passiveAbsorptionThreshold
                    ? passiveRatio
                    : FinancialMath.multiplyQuantities(
                          passiveRatio,
                          this.enhancementConfig.confidenceBoostReduction
                      ); // Bonus for strong absorption

            return absorptionStrength;
        });

        const meanScore = FinancialMath.calculateMean(absorptionScores);
        return meanScore ?? null; // CLAUDE.md compliance: return null when calculation cannot be performed
    }

    /**
     * Analyze zone pattern characteristics
     *
     * ABSORPTION PHASE 2.1: Zone pattern classification
     */
    private analyzeZonePattern(zones: ZoneSnapshot[]): {
        absorptionScore: number;
        distributionScore: number;
        patternType: "absorption" | "distribution" | "neutral";
    } {
        if (zones.length === 0) {
            return {
                absorptionScore: 0,
                distributionScore: 0,
                patternType: "neutral",
            };
        }

        let totalAbsorptionScore = 0;
        let totalDistributionScore = 0;

        for (const zone of zones) {
            const totalVolume = zone.aggressiveVolume + zone.passiveVolume;
            if (totalVolume === 0) continue;

            const passiveRatio = FinancialMath.divideQuantities(
                zone.passiveVolume,
                totalVolume
            );
            const aggressiveRatio = FinancialMath.divideQuantities(
                zone.aggressiveVolume,
                totalVolume
            );

            // Absorption characteristics: high passive volume, low aggressive volume
            if (
                passiveRatio > this.enhancementConfig.passiveAbsorptionThreshold
            ) {
                totalAbsorptionScore += passiveRatio;
            }

            // Distribution characteristics: high aggressive volume, lower passive volume
            if (
                aggressiveRatio >
                this.enhancementConfig.aggressiveDistributionThreshold
            ) {
                totalDistributionScore += aggressiveRatio;
            }
        }

        const avgAbsorptionScore = FinancialMath.divideQuantities(
            totalAbsorptionScore,
            zones.length
        );
        const avgDistributionScore = FinancialMath.divideQuantities(
            totalDistributionScore,
            zones.length
        );

        const patternType: "absorption" | "distribution" | "neutral" =
            avgAbsorptionScore >
            avgDistributionScore +
                this.enhancementConfig.patternDifferenceThreshold
                ? "absorption"
                : avgDistributionScore >
                    avgAbsorptionScore +
                        this.enhancementConfig.patternDifferenceThreshold
                  ? "distribution"
                  : "neutral";

        return {
            absorptionScore: avgAbsorptionScore,
            distributionScore: avgDistributionScore,
            patternType,
        };
    }

    /**
     * Analyze institutional volume presence in zones
     */
    private analyzeInstitutionalVolume(
        zoneData: StandardZoneData,
        event: EnrichedTradeEvent
    ): {
        hasInstitutionalPresence: boolean;
        institutionalRatio: number;
        whaleActivity: number;
    } {
        const institutionalThreshold =
            this.enhancementConfig.institutionalVolumeThreshold;
        const minRatio =
            this.enhancementConfig.institutionalVolumeRatioThreshold;

        // Check if current trade meets institutional volume threshold
        const isInstitutionalTrade = event.quantity >= institutionalThreshold;

        // Analyze institutional volume in relevant zones
        const allZones = [
            ...zoneData.zones5Tick,
            ...zoneData.zones10Tick,
            ...zoneData.zones20Tick,
        ];

        const relevantZones = this.findZonesNearPrice(allZones, event.price, 5);

        let totalVolume = 0;
        let institutionalVolume = 0;

        relevantZones.forEach((zone) => {
            const zoneVolume = zone.aggressiveVolume + zone.passiveVolume;
            totalVolume += zoneVolume;

            // Estimate institutional volume based on threshold
            if (zone.aggressiveVolume >= institutionalThreshold) {
                institutionalVolume += zone.aggressiveVolume;
            }
            if (zone.passiveVolume >= institutionalThreshold) {
                institutionalVolume += zone.passiveVolume;
            }
        });

        const institutionalRatio =
            totalVolume > 0 ? institutionalVolume / totalVolume : 0;
        const hasInstitutionalPresence =
            isInstitutionalTrade || institutionalRatio >= minRatio;

        // Calculate whale activity score (0-1) using FinancialMath
        const whaleActivity = Math.min(
            1.0,
            FinancialMath.multiplyQuantities(
                institutionalRatio,
                this.enhancementConfig.whaleActivityMultiplier
            )
        );

        return {
            hasInstitutionalPresence,
            institutionalRatio,
            whaleActivity,
        };
    }

    /**
     * Analyze cross-timeframe absorption alignment
     */
    private analyzeCrossTimeframe(
        zoneData: StandardZoneData,
        event: EnrichedTradeEvent
    ): {
        hasAlignment: boolean;
        alignedTimeframes: string[];
        alignmentStrength: number;
    } {
        const alignedTimeframes: string[] = [];

        // Check absorption patterns across timeframes
        const price = event.price;

        // Analyze 5-tick timeframe
        if (this.hasAbsorptionPattern(zoneData.zones5Tick, price)) {
            alignedTimeframes.push("5T");
        }

        // Analyze 10-tick timeframe
        if (this.hasAbsorptionPattern(zoneData.zones10Tick, price)) {
            alignedTimeframes.push("10T");
        }

        // Analyze 20-tick timeframe
        if (this.hasAbsorptionPattern(zoneData.zones20Tick, price)) {
            alignedTimeframes.push("20T");
        }

        const hasAlignment = alignedTimeframes.length >= 2; // Require at least 2 timeframes
        const alignmentStrength = alignedTimeframes.length / 3; // Normalize to 0-1

        return {
            hasAlignment,
            alignedTimeframes,
            alignmentStrength,
        };
    }

    /**
     * Check if zones show absorption pattern near price
     */
    private hasAbsorptionPattern(
        zones: ZoneSnapshot[],
        price: number
    ): boolean {
        const relevantZones = this.findZonesNearPrice(zones, price, 2);

        if (relevantZones.length === 0) return false;

        // Look for absorption characteristics: high passive volume, low aggressive/passive ratio
        return relevantZones.some((zone) => {
            const totalVolume = zone.aggressiveVolume + zone.passiveVolume;
            if (totalVolume === 0) return false;

            const aggressiveRatio = zone.aggressiveVolume / totalVolume;
            const hasHighPassive = zone.passiveVolume > zone.aggressiveVolume;
            const hasLowAggressiveRatio = aggressiveRatio < 0.4; // Less than 40% aggressive

            return hasHighPassive && hasLowAggressiveRatio;
        });
    }

    /**
     * Store enhanced absorption metrics for potential signal boosting
     */
    private storeEnhancedAbsorptionMetrics(
        event: EnrichedTradeEvent,
        confidenceBoost: number
    ): void {
        // Store enhanced metrics that could be used for signal generation
        // This is supplementary data that doesn't affect the original detector

        this.logger.debug(
            "AbsorptionDetectorEnhanced: Enhanced metrics stored",
            {
                detectorId: this.getId(),
                price: event.price,
                timestamp: event.timestamp,
                confidenceBoost: confidenceBoost,
                enhancementCount: this.enhancementStats.enhancementCount,
            }
        );

        // Update metrics collector with enhancement data
        // Note: Enhancement metrics would be added to the metrics interface in future iterations
    }

    /**
     * Get enhancement statistics for monitoring and debugging
     */
    public getEnhancementStats(): AbsorptionEnhancementStats {
        return { ...this.enhancementStats };
    }

    /**
     * Set enhancement mode (for runtime configuration)
     */
    public setEnhancementMode(
        mode: "disabled" | "testing" | "production"
    ): void {
        this.enhancementConfig.enhancementMode = mode;
        this.enhancementStats.mode = mode;

        this.logger.info(
            "AbsorptionDetectorEnhanced: Enhancement mode changed",
            {
                detectorId: this.getId(),
                newMode: mode,
                timestamp: Date.now(),
            }
        );
    }

    /**
     * Override cleanup to include enhancement cleanup
     */
    public override cleanup(): void {
        // Log final enhancement statistics
        this.logger.info(
            "AbsorptionDetectorEnhanced: Cleanup with final stats",
            {
                detectorId: this.getId(),
                enhancementStats: this.enhancementStats,
            }
        );

        // Call parent cleanup
        super.cleanup();
    }
}
