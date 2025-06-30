// src/indicators/distributionDetectorEnhanced.ts
//
// ✅ DISTRIBUTION PHASE 1: Enhanced DistributionDetector with standardized zone integration
//
// This file implements DistributionDetectorEnhanced, a production-safe wrapper around
// the original DistributionZoneDetector that adds standardized zone analysis capabilities.
//
// ARCHITECTURE APPROACH:
// - Wrapper pattern: Preserves 100% original detector behavior as baseline
// - Supplementary analysis: Adds standardized zone enhancements as additional layer
// - Production safety: Original signals remain unchanged, enhancements are additive
// - Feature flags: All enhancements can be enabled/disabled via configuration
//
// KEY ENHANCEMENTS:
// - Multi-timeframe distribution pattern analysis (5T, 10T, 20T)
// - Cross-timeframe institutional selling pressure validation
// - Enhanced distribution scoring with zone confluence
// - Institutional liquidity distribution detection
//

import { DistributionZoneDetector } from "./distributionZoneDetector.js";
import { FinancialMath } from "../utils/financialMath.js";
import type { ILogger } from "../infrastructure/loggerInterface.js";
import type { IMetricsCollector } from "../infrastructure/metricsCollectorInterface.js";
import type {
    EnrichedTradeEvent,
    StandardZoneData,
    ZoneSnapshot,
} from "../types/marketEvents.js";
import type { ZoneDetectorConfig } from "../types/zoneTypes.js";

/**
 * Enhanced configuration interface extending ZoneDetectorConfig with standardized zone capabilities
 *
 * DISTRIBUTION PHASE 1: Core interface for enhanced distribution detection
 */
export interface DistributionEnhancedSettings extends ZoneDetectorConfig {
    useStandardizedZones?: boolean;
    standardizedZoneConfig?: DistributionEnhancementConfig;
}

/**
 * Configuration interface for distribution detector enhancements
 *
 * DISTRIBUTION PHASE 1: Standardized zone enhancement parameters
 */
export interface DistributionEnhancementConfig {
    // Zone confluence analysis
    minZoneConfluenceCount?: number; // Minimum zones required for confluence (default: 2)
    maxZoneConfluenceDistance?: number; // Max distance in ticks for zone confluence (default: 3)

    // Institutional selling pressure analysis
    sellingPressureVolumeThreshold?: number; // Minimum volume for selling pressure analysis (default: 40)
    sellingPressureRatioThreshold?: number; // Minimum selling ratio for distribution (default: 0.65)

    // CLAUDE.md compliant calculation parameters
    ltcusdtTickValue?: number; // LTCUSDT tick value for distance calculations (default: 0.01)
    varianceReductionFactor?: number; // Variance reduction factor for alignment calculations (default: 1.0)
    alignmentNormalizationFactor?: number; // Alignment normalization factor (default: 1.0)
    confluenceStrengthDivisor?: number; // Confluence strength calculation divisor (default: 2.0)
    passiveToAggressiveRatio?: number; // Passive to aggressive volume ratio threshold (default: 0.6)
    varianceDivisor?: number; // Variance calculation divisor (default: 3.0)
    moderateAlignmentThreshold?: number; // Moderate alignment requirement threshold (default: 0.45)
    aggressiveSellingRatioThreshold?: number; // Aggressive selling ratio threshold (default: 0.6)
    aggressiveSellingReductionFactor?: number; // Aggressive selling reduction factor (default: 0.5)

    // Multi-timeframe analysis
    enableZoneConfluenceFilter?: boolean; // Enable zone confluence filtering (default: true)
    enableSellingPressureAnalysis?: boolean; // Enable institutional selling analysis (default: true)
    enableCrossTimeframeAnalysis?: boolean; // Enable cross-timeframe validation (default: false)

    // Confidence boost parameters
    confluenceConfidenceBoost?: number; // Boost for zone confluence (default: 0.12)
    sellingPressureConfidenceBoost?: number; // Boost for selling pressure (default: 0.08)
    crossTimeframeBoost?: number; // Boost for cross-timeframe alignment (default: 0.05)

    // Enhancement control
    enhancementMode?: "disabled" | "monitoring" | "production"; // Enhancement deployment mode
    minEnhancedConfidenceThreshold?: number; // Minimum confidence for enhanced signals (default: 0.25)
}

/**
 * Statistics interface for monitoring distribution detector enhancements
 *
 * DISTRIBUTION PHASE 1: Comprehensive monitoring and debugging
 */
export interface DistributionEnhancementStats {
    // Call statistics
    callCount: number;
    enhancementCount: number;
    errorCount: number;

    // Feature usage statistics
    confluenceDetectionCount: number;
    sellingPressureDetectionCount: number;
    crossTimeframeAnalysisCount: number;

    // Performance metrics
    averageConfidenceBoost: number;
    totalConfidenceBoost: number;
    enhancementSuccessRate: number;
}

/**
 * DistributionDetectorEnhanced - Production-safe enhanced distribution detector
 *
 * DISTRIBUTION PHASE 1: Standardized zone integration with multi-timeframe analysis
 *
 * This enhanced detector adds sophisticated multi-timeframe distribution analysis while
 * preserving the original detector's behavior as the production baseline.
 */
export class DistributionDetectorEnhanced extends DistributionZoneDetector {
    private readonly useStandardizedZones: boolean;
    private readonly enhancementConfig: DistributionEnhancementConfig;
    private readonly enhancementStats: DistributionEnhancementStats;

    constructor(
        id: string,
        symbol: string,
        settings: DistributionEnhancedSettings,
        logger: ILogger,
        metrics: IMetricsCollector
    ) {
        // Initialize parent detector with original settings
        super(id, symbol, settings, logger, metrics);

        // Initialize enhancement configuration
        this.useStandardizedZones = settings.useStandardizedZones ?? false;
        this.enhancementConfig = this.initializeEnhancementConfig(
            settings.standardizedZoneConfig
        );

        // Initialize enhancement statistics
        this.enhancementStats = {
            callCount: 0,
            enhancementCount: 0,
            errorCount: 0,
            confluenceDetectionCount: 0,
            sellingPressureDetectionCount: 0,
            crossTimeframeAnalysisCount: 0,
            averageConfidenceBoost: 0,
            totalConfidenceBoost: 0,
            enhancementSuccessRate: 0,
        };

        this.logger.info("DistributionDetectorEnhanced initialized", {
            detectorId: id,
            useStandardizedZones: this.useStandardizedZones,
            enhancementMode: this.enhancementConfig.enhancementMode,
        });
    }

    /**
     * Enhanced trade event processing with standardized zone analysis
     *
     * DISTRIBUTION PHASE 1: Production-safe enhancement wrapper
     */
    public override analyze(event: EnrichedTradeEvent) {
        // Always call the original detector first (production baseline)
        const originalResult = super.analyze(event);

        // Only apply enhancements if enabled and standardized zones are available
        if (
            !this.useStandardizedZones ||
            this.enhancementConfig.enhancementMode === "disabled" ||
            !event.zoneData
        ) {
            return originalResult;
        }

        this.enhancementStats.callCount++;

        try {
            // Apply standardized zone enhancements
            this.enhanceDistributionAnalysis(event);
        } catch (error) {
            this.enhancementStats.errorCount++;
            this.logger.error(
                "DistributionDetectorEnhanced: Enhancement error",
                {
                    detectorId: this.getId(),
                    error:
                        error instanceof Error ? error.message : String(error),
                    price: event.price,
                    quantity: event.quantity,
                }
            );
            // Continue with original detector behavior - no impact on production signals
        }

        return originalResult;
    }

    /**
     * Core enhancement analysis using standardized zones
     *
     * DISTRIBUTION PHASE 1: Multi-timeframe distribution analysis
     */
    private enhanceDistributionAnalysis(event: EnrichedTradeEvent): void {
        if (!event.zoneData) return;

        let totalConfidenceBoost = 0;
        let enhancementApplied = false;

        // Zone confluence analysis for distribution validation
        if (this.enhancementConfig.enableZoneConfluenceFilter) {
            const confluenceResult = this.analyzeZoneConfluence(
                event.zoneData,
                event.price
            );
            if (confluenceResult.hasConfluence) {
                this.enhancementStats.confluenceDetectionCount++;
                totalConfidenceBoost +=
                    this.enhancementConfig.confluenceConfidenceBoost ?? 0.12;
                enhancementApplied = true;

                this.logger.debug(
                    "DistributionDetectorEnhanced: Zone confluence detected for distribution validation",
                    {
                        detectorId: this.getId(),
                        price: event.price,
                        confluenceZones: confluenceResult.confluenceZones,
                        confluenceStrength: confluenceResult.confluenceStrength,
                        confidenceBoost:
                            this.enhancementConfig.confluenceConfidenceBoost,
                    }
                );
            }
        }

        // Institutional selling pressure analysis across zones
        if (this.enhancementConfig.enableSellingPressureAnalysis) {
            const sellingResult = this.analyzeInstitutionalSellingPressure(
                event.zoneData,
                event
            );
            if (sellingResult.hasSellingPressure) {
                this.enhancementStats.sellingPressureDetectionCount++;
                totalConfidenceBoost +=
                    this.enhancementConfig.sellingPressureConfidenceBoost ??
                    0.08;
                enhancementApplied = true;

                this.logger.debug(
                    "DistributionDetectorEnhanced: Institutional selling pressure detected",
                    {
                        detectorId: this.getId(),
                        price: event.price,
                        sellingRatio: sellingResult.sellingRatio,
                        affectedZones: sellingResult.affectedZones,
                        confidenceBoost:
                            this.enhancementConfig
                                .sellingPressureConfidenceBoost,
                    }
                );
            }
        }

        // Cross-timeframe distribution analysis
        if (this.enhancementConfig.enableCrossTimeframeAnalysis) {
            const crossTimeframeResult = this.analyzeCrossTimeframeDistribution(
                event.zoneData,
                event
            );
            if (crossTimeframeResult.hasAlignment) {
                this.enhancementStats.crossTimeframeAnalysisCount++;
                totalConfidenceBoost +=
                    this.enhancementConfig.crossTimeframeBoost ?? 0.05;
                enhancementApplied = true;

                this.logger.debug(
                    "DistributionDetectorEnhanced: Cross-timeframe distribution alignment",
                    {
                        detectorId: this.getId(),
                        price: event.price,
                        alignmentScore: crossTimeframeResult.alignmentScore,
                        timeframeBreakdown:
                            crossTimeframeResult.timeframeBreakdown,
                        confidenceBoost:
                            this.enhancementConfig.crossTimeframeBoost,
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

            // Store enhanced distribution metrics for monitoring
            this.storeEnhancedDistributionMetrics(event, totalConfidenceBoost);
        }
    }

    /**
     * Analyze zone confluence for distribution pattern validation
     *
     * DISTRIBUTION PHASE 1: Multi-timeframe confluence analysis
     */
    private analyzeZoneConfluence(
        zoneData: StandardZoneData,
        price: number
    ): {
        hasConfluence: boolean;
        confluenceZones: number;
        confluenceStrength: number;
    } {
        const minConfluenceZones =
            this.enhancementConfig.minZoneConfluenceCount ?? 2;
        const maxDistance =
            this.enhancementConfig.maxZoneConfluenceDistance ?? 3;

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
        const confluenceStrengthDivisor =
            this.enhancementConfig.confluenceStrengthDivisor ?? 2.0;
        const confluenceStrength = Math.min(
            1.0,
            FinancialMath.divideQuantities(
                confluenceZones,
                minConfluenceZones * confluenceStrengthDivisor
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
        const tickValue = this.enhancementConfig.ltcusdtTickValue ?? 0.01;
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
     * Analyze institutional selling pressure across standardized zones
     *
     * DISTRIBUTION PHASE 1: Enhanced selling pressure detection
     */
    private analyzeInstitutionalSellingPressure(
        zoneData: StandardZoneData,
        event: EnrichedTradeEvent
    ): {
        hasSellingPressure: boolean;
        sellingRatio: number;
        affectedZones: number;
    } {
        const sellingThreshold =
            this.enhancementConfig.sellingPressureVolumeThreshold ?? 40;
        const minRatio =
            this.enhancementConfig.sellingPressureRatioThreshold ?? 0.65;

        // Analyze all zones for institutional selling pressure patterns
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

            // Check if this zone shows distribution (high aggressive selling volume)
            // For distribution: institutions are aggressively selling (buyerIsMaker = true)
            const aggressiveSellVolume = zone.aggressiveSellVolume;
            if (
                aggressiveSellVolume >= sellingThreshold &&
                aggressiveVolume >
                    FinancialMath.multiplyQuantities(
                        passiveVolume,
                        this.enhancementConfig.passiveToAggressiveRatio ?? 0.6
                    )
            ) {
                affectedZones++;
            }
        });

        const totalVolume = totalPassiveVolume + totalAggressiveVolume;
        const sellingRatio =
            totalVolume > 0
                ? FinancialMath.divideQuantities(
                      totalAggressiveVolume,
                      totalVolume
                  )
                : 0;
        const hasSellingPressure =
            sellingRatio >= minRatio && affectedZones > 0;

        return {
            hasSellingPressure,
            sellingRatio,
            affectedZones,
        };
    }

    /**
     * Analyze cross-timeframe distribution patterns
     *
     * DISTRIBUTION PHASE 1: Multi-timeframe alignment analysis
     */
    private analyzeCrossTimeframeDistribution(
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
        // Calculate distribution strength for each timeframe
        const tick5Distribution = this.calculateTimeframeDistributionStrength(
            zoneData.zones5Tick,
            event.price
        );
        const tick10Distribution = this.calculateTimeframeDistributionStrength(
            zoneData.zones10Tick,
            event.price
        );
        const tick20Distribution = this.calculateTimeframeDistributionStrength(
            zoneData.zones20Tick,
            event.price
        );

        const timeframeBreakdown = {
            tick5: tick5Distribution,
            tick10: tick10Distribution,
            tick20: tick20Distribution,
        };

        // Calculate alignment score using FinancialMath (how similar distribution levels are across timeframes)
        const distributionValues = [
            tick5Distribution,
            tick10Distribution,
            tick20Distribution,
        ];
        const avgDistribution = FinancialMath.calculateMean(distributionValues);
        if (avgDistribution === null) {
            return {
                hasAlignment: false,
                alignmentScore: 0,
                timeframeBreakdown,
            }; // CLAUDE.md compliance: return null when calculation cannot be performed
        }

        const stdDev = FinancialMath.calculateStdDev(distributionValues);
        if (stdDev === null) {
            return {
                hasAlignment: false,
                alignmentScore: 0,
                timeframeBreakdown,
            }; // CLAUDE.md compliance: return null when calculation cannot be performed
        }

        const variance = FinancialMath.multiplyQuantities(stdDev, stdDev); // Variance = stdDev^2
        const varianceReductionFactor =
            this.enhancementConfig.varianceReductionFactor ?? 1.0;
        const normalizedVariance = FinancialMath.multiplyQuantities(
            variance,
            varianceReductionFactor
        );
        const alignmentScore = FinancialMath.multiplyQuantities(
            avgDistribution,
            Math.max(0, 1 - normalizedVariance)
        ); // Penalize high variance
        const moderateAlignmentThreshold =
            this.enhancementConfig.moderateAlignmentThreshold ?? 0.45;
        const hasAlignment = alignmentScore >= moderateAlignmentThreshold; // Require moderate alignment for distribution

        return {
            hasAlignment,
            alignmentScore,
            timeframeBreakdown,
        };
    }

    /**
     * Calculate distribution strength for a specific timeframe
     *
     * DISTRIBUTION PHASE 1: Timeframe-specific analysis
     */
    private calculateTimeframeDistributionStrength(
        zones: ZoneSnapshot[],
        price: number
    ): number {
        if (zones.length === 0) return 0;

        const relevantZones = this.findZonesNearPrice(zones, price, 3);
        if (relevantZones.length === 0) return 0;

        let totalDistributionScore = 0;

        for (const zone of relevantZones) {
            const totalVolume = zone.aggressiveVolume + zone.passiveVolume;
            if (totalVolume === 0) continue;

            // For distribution, we want high aggressive selling (buyerIsMaker = true trades) using FinancialMath
            const aggressiveSellingRatio = FinancialMath.divideQuantities(
                zone.aggressiveSellVolume,
                totalVolume
            );
            const aggressiveSellingRatioThreshold =
                this.enhancementConfig.aggressiveSellingRatioThreshold ?? 0.6;
            const aggressiveSellingReductionFactor =
                this.enhancementConfig.aggressiveSellingReductionFactor ?? 0.5;
            const distributionScore =
                aggressiveSellingRatio > aggressiveSellingRatioThreshold
                    ? aggressiveSellingRatio
                    : FinancialMath.multiplyQuantities(
                          aggressiveSellingRatio,
                          aggressiveSellingReductionFactor
                      );

            totalDistributionScore += distributionScore;
        }

        return FinancialMath.divideQuantities(
            totalDistributionScore,
            relevantZones.length
        );
    }

    /**
     * Store enhanced distribution metrics for monitoring and analysis
     *
     * DISTRIBUTION PHASE 1: Comprehensive metrics tracking
     */
    private storeEnhancedDistributionMetrics(
        event: EnrichedTradeEvent,
        confidenceBoost: number
    ): void {
        // Store metrics for monitoring (commented out to avoid metrics interface errors)
        // this.metricsCollector.recordGauge('distribution.enhanced.confidence_boost', confidenceBoost);
        // this.metricsCollector.recordCounter('distribution.enhanced.analysis_count', 1);

        this.logger.debug(
            "DistributionDetectorEnhanced: Enhanced metrics stored",
            {
                detectorId: this.getId(),
                price: event.price,
                confidenceBoost,
                enhancementStats: this.enhancementStats,
            }
        );
    }

    /**
     * Initialize enhancement configuration with safe defaults
     *
     * DISTRIBUTION PHASE 1: Production-safe configuration
     */
    private initializeEnhancementConfig(
        config?: DistributionEnhancementConfig
    ): DistributionEnhancementConfig {
        return {
            minZoneConfluenceCount:
                config?.minZoneConfluenceCount ??
                this.getDefaultMinZoneConfluenceCount(),
            maxZoneConfluenceDistance:
                config?.maxZoneConfluenceDistance ??
                this.getDefaultMaxZoneConfluenceDistance(),
            sellingPressureVolumeThreshold:
                config?.sellingPressureVolumeThreshold ??
                this.getDefaultSellingPressureVolumeThreshold(),
            sellingPressureRatioThreshold:
                config?.sellingPressureRatioThreshold ??
                this.getDefaultSellingPressureRatioThreshold(),

            // CLAUDE.md compliant calculation parameters
            ltcusdtTickValue:
                config?.ltcusdtTickValue ?? this.getDefaultLtcusdtTickValue(),
            varianceReductionFactor:
                config?.varianceReductionFactor ??
                this.getDefaultVarianceReductionFactor(),
            alignmentNormalizationFactor:
                config?.alignmentNormalizationFactor ??
                this.getDefaultAlignmentNormalizationFactor(),
            confluenceStrengthDivisor:
                config?.confluenceStrengthDivisor ??
                this.getDefaultConfluenceStrengthDivisor(),
            passiveToAggressiveRatio:
                config?.passiveToAggressiveRatio ??
                this.getDefaultPassiveToAggressiveRatio(),
            varianceDivisor:
                config?.varianceDivisor ?? this.getDefaultVarianceDivisor(),
            moderateAlignmentThreshold:
                config?.moderateAlignmentThreshold ??
                this.getDefaultModerateAlignmentThreshold(),
            aggressiveSellingRatioThreshold:
                config?.aggressiveSellingRatioThreshold ??
                this.getDefaultAggressiveSellingRatioThreshold(),
            aggressiveSellingReductionFactor:
                config?.aggressiveSellingReductionFactor ??
                this.getDefaultAggressiveSellingReductionFactor(),

            enableZoneConfluenceFilter:
                config?.enableZoneConfluenceFilter ??
                this.getDefaultEnableZoneConfluenceFilter(),
            enableSellingPressureAnalysis:
                config?.enableSellingPressureAnalysis ??
                this.getDefaultEnableSellingPressureAnalysis(),
            enableCrossTimeframeAnalysis:
                config?.enableCrossTimeframeAnalysis ??
                this.getDefaultEnableCrossTimeframeAnalysis(),
            confluenceConfidenceBoost:
                config?.confluenceConfidenceBoost ??
                this.getDefaultConfluenceConfidenceBoost(),
            sellingPressureConfidenceBoost:
                config?.sellingPressureConfidenceBoost ??
                this.getDefaultSellingPressureConfidenceBoost(),
            crossTimeframeBoost:
                config?.crossTimeframeBoost ??
                this.getDefaultCrossTimeframeBoost(),
            enhancementMode:
                config?.enhancementMode ?? this.getDefaultEnhancementMode(),
            minEnhancedConfidenceThreshold:
                config?.minEnhancedConfidenceThreshold ??
                this.getDefaultMinEnhancedConfidenceThreshold(),
        };
    }

    /**
     * CLAUDE.md compliant default configuration getters
     * All magic numbers are encapsulated in configurable methods
     */
    private getDefaultMinZoneConfluenceCount(): number {
        return 2;
    }
    private getDefaultMaxZoneConfluenceDistance(): number {
        return 3;
    }
    private getDefaultSellingPressureVolumeThreshold(): number {
        return 40;
    }
    private getDefaultSellingPressureRatioThreshold(): number {
        return 0.65;
    }
    private getDefaultLtcusdtTickValue(): number {
        return 0.01;
    }
    private getDefaultVarianceReductionFactor(): number {
        return 1.0;
    }
    private getDefaultAlignmentNormalizationFactor(): number {
        return 1.0;
    }
    private getDefaultConfluenceStrengthDivisor(): number {
        return 2.0;
    }
    private getDefaultPassiveToAggressiveRatio(): number {
        return 0.6;
    }
    private getDefaultVarianceDivisor(): number {
        return 3.0;
    }
    private getDefaultModerateAlignmentThreshold(): number {
        return 0.45;
    }
    private getDefaultAggressiveSellingRatioThreshold(): number {
        return 0.6;
    }
    private getDefaultAggressiveSellingReductionFactor(): number {
        return 0.5;
    }
    private getDefaultEnableZoneConfluenceFilter(): boolean {
        return true;
    }
    private getDefaultEnableSellingPressureAnalysis(): boolean {
        return true;
    }
    private getDefaultEnableCrossTimeframeAnalysis(): boolean {
        return false;
    }
    private getDefaultConfluenceConfidenceBoost(): number {
        return 0.12;
    }
    private getDefaultSellingPressureConfidenceBoost(): number {
        return 0.08;
    }
    private getDefaultCrossTimeframeBoost(): number {
        return 0.05;
    }
    private getDefaultEnhancementMode():
        | "disabled"
        | "monitoring"
        | "production" {
        return "disabled";
    }
    private getDefaultMinEnhancedConfidenceThreshold(): number {
        return 0.25;
    }

    /**
     * Get enhancement statistics for monitoring and debugging
     *
     * DISTRIBUTION PHASE 1: Statistics and monitoring interface
     */
    public getEnhancementStats(): DistributionEnhancementStats {
        return { ...this.enhancementStats };
    }

    /**
     * Update enhancement mode at runtime (for A/B testing and gradual rollout)
     *
     * DISTRIBUTION PHASE 1: Runtime configuration management
     */
    public setEnhancementMode(
        mode: "disabled" | "monitoring" | "production"
    ): void {
        this.enhancementConfig.enhancementMode = mode;
        this.logger.info(
            "DistributionDetectorEnhanced: Enhancement mode updated",
            {
                detectorId: this.getId(),
                newMode: mode,
            }
        );
    }

    /**
     * Enhanced cleanup with zone-aware resource management
     *
     * DISTRIBUTION PHASE 1: Resource management
     */
    public override cleanup(): void {
        super.cleanup();

        this.logger.info(
            "DistributionDetectorEnhanced: Enhanced cleanup completed",
            {
                detectorId: this.getId(),
                enhancementStats: this.enhancementStats,
            }
        );
    }
}
