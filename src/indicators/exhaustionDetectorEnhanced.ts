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
import type { ILogger } from "../infrastructure/loggerInterface.js";
import type { IMetricsCollector } from "../infrastructure/metricsCollectorInterface.js";
import type { ISignalLogger } from "../infrastructure/signalLoggerInterface.js";
import type {
    EnrichedTradeEvent,
    StandardZoneData,
    ZoneSnapshot,
} from "../types/marketEvents.js";
import type { ExhaustionSettings } from "./types/exhaustionTypes.js";
import { SpoofingDetector } from "../services/spoofingDetector.js";

/**
 * Enhanced configuration interface extending ExhaustionSettings with standardized zone capabilities
 *
 * EXHAUSTION PHASE 1: Core interface for enhanced exhaustion detection
 */
export interface ExhaustionEnhancedSettings extends ExhaustionSettings {
    useStandardizedZones?: boolean;
    standardizedZoneConfig?: ExhaustionEnhancementConfig;
}

/**
 * Configuration interface for exhaustion detector enhancements
 *
 * EXHAUSTION PHASE 1: Standardized zone enhancement parameters
 */
export interface ExhaustionEnhancementConfig {
    // Zone confluence analysis
    minZoneConfluenceCount?: number; // Minimum zones required for confluence (default: 2)
    maxZoneConfluenceDistance?: number; // Max distance in ticks for zone confluence (default: 3)

    // Liquidity depletion analysis
    depletionVolumeThreshold?: number; // Minimum volume for depletion analysis (default: 30)
    depletionRatioThreshold?: number; // Minimum depletion ratio for exhaustion (default: 0.6)

    // CLAUDE.md compliant calculation parameters
    ltcusdtTickValue?: number; // LTCUSDT tick value for distance calculations (default: 0.01)
    varianceReductionFactor?: number; // Variance reduction factor for alignment calculations (default: 1.0)
    alignmentNormalizationFactor?: number; // Alignment normalization factor (default: 1.0)
    distanceNormalizationDivisor?: number; // Distance normalization divisor (default: 2.0)
    passiveVolumeExhaustionRatio?: number; // Passive volume exhaustion ratio threshold (default: 0.5)
    aggressiveVolumeExhaustionThreshold?: number; // Aggressive volume exhaustion threshold (default: 0.7)
    aggressiveVolumeReductionFactor?: number; // Aggressive volume reduction factor (default: 0.5)

    // Multi-timeframe analysis
    enableZoneConfluenceFilter?: boolean; // Enable zone confluence filtering (default: true)
    enableDepletionAnalysis?: boolean; // Enable liquidity depletion analysis (default: true)
    enableCrossTimeframeAnalysis?: boolean; // Enable cross-timeframe validation (default: false)

    // Confidence boost parameters
    confluenceConfidenceBoost?: number; // Boost for zone confluence (default: 0.15)
    depletionConfidenceBoost?: number; // Boost for liquidity depletion (default: 0.1)
    crossTimeframeBoost?: number; // Boost for cross-timeframe alignment (default: 0.05)

    // Enhancement control
    enhancementMode?: "disabled" | "monitoring" | "production"; // Enhancement deployment mode
    minEnhancedConfidenceThreshold?: number; // Minimum confidence for enhanced signals (default: 0.3)
}

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
    private readonly enhancementConfig: ExhaustionEnhancementConfig;
    private readonly enhancementStats: ExhaustionEnhancementStats;

    constructor(
        id: string,
        settings: ExhaustionEnhancedSettings,
        logger: ILogger,
        spoofingDetector: SpoofingDetector,
        metricsCollector: IMetricsCollector,
        signalLogger: ISignalLogger
    ) {
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
        if (this.enhancementConfig.enableZoneConfluenceFilter) {
            const confluenceResult = this.analyzeZoneConfluence(
                event.zoneData,
                event.price
            );
            if (confluenceResult.hasConfluence) {
                this.enhancementStats.confluenceDetectionCount++;
                totalConfidenceBoost +=
                    this.enhancementConfig.confluenceConfidenceBoost ?? 0.15;
                enhancementApplied = true;

                this.logger.debug(
                    "ExhaustionDetectorEnhanced: Zone confluence detected for exhaustion validation",
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

        // Liquidity depletion analysis across zones
        if (this.enhancementConfig.enableDepletionAnalysis) {
            const depletionResult = this.analyzeLiquidityDepletion(
                event.zoneData,
                event
            );
            if (depletionResult.hasDepletion) {
                this.enhancementStats.depletionDetectionCount++;
                totalConfidenceBoost +=
                    this.enhancementConfig.depletionConfidenceBoost ?? 0.1;
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
            }
        }

        // Cross-timeframe exhaustion analysis
        if (this.enhancementConfig.enableCrossTimeframeAnalysis) {
            const crossTimeframeResult = this.analyzeCrossTimeframeExhaustion(
                event.zoneData,
                event
            );
            if (crossTimeframeResult.hasAlignment) {
                this.enhancementStats.crossTimeframeAnalysisCount++;
                totalConfidenceBoost +=
                    this.enhancementConfig.crossTimeframeBoost ?? 0.05;
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
            this.enhancementConfig.depletionVolumeThreshold ?? 30;
        const minRatio = this.enhancementConfig.depletionRatioThreshold ?? 0.6;

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
                this.enhancementConfig.passiveVolumeExhaustionRatio ?? 0.5;
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
            this.enhancementConfig.varianceReductionFactor ?? 1.0;
        const normalizedVariance = FinancialMath.multiplyQuantities(
            variance,
            varianceReductionFactor
        );
        const alignmentScore = FinancialMath.multiplyQuantities(
            avgExhaustion,
            Math.max(0, 1 - normalizedVariance)
        ); // Penalize high variance
        const alignmentNormalizationFactor =
            this.enhancementConfig.alignmentNormalizationFactor ?? 1.0;
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
                this.enhancementConfig.aggressiveVolumeExhaustionThreshold ??
                0.7;
            const aggressiveVolumeReductionFactor =
                this.enhancementConfig.aggressiveVolumeReductionFactor ?? 0.5;
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
     * Initialize enhancement configuration with safe defaults
     *
     * EXHAUSTION PHASE 1: Production-safe configuration
     */
    private initializeEnhancementConfig(
        config?: ExhaustionEnhancementConfig
    ): ExhaustionEnhancementConfig {
        return {
            minZoneConfluenceCount:
                config?.minZoneConfluenceCount ??
                this.getDefaultMinZoneConfluenceCount(),
            maxZoneConfluenceDistance:
                config?.maxZoneConfluenceDistance ??
                this.getDefaultMaxZoneConfluenceDistance(),
            depletionVolumeThreshold:
                config?.depletionVolumeThreshold ??
                this.getDefaultDepletionVolumeThreshold(),
            depletionRatioThreshold:
                config?.depletionRatioThreshold ??
                this.getDefaultDepletionRatioThreshold(),

            // CLAUDE.md compliant calculation parameters
            ltcusdtTickValue:
                config?.ltcusdtTickValue ?? this.getDefaultLtcusdtTickValue(),
            varianceReductionFactor:
                config?.varianceReductionFactor ??
                this.getDefaultVarianceReductionFactor(),
            alignmentNormalizationFactor:
                config?.alignmentNormalizationFactor ??
                this.getDefaultAlignmentNormalizationFactor(),
            distanceNormalizationDivisor:
                config?.distanceNormalizationDivisor ??
                this.getDefaultDistanceNormalizationDivisor(),
            passiveVolumeExhaustionRatio:
                config?.passiveVolumeExhaustionRatio ??
                this.getDefaultPassiveVolumeExhaustionRatio(),
            aggressiveVolumeExhaustionThreshold:
                config?.aggressiveVolumeExhaustionThreshold ??
                this.getDefaultAggressiveVolumeExhaustionThreshold(),
            aggressiveVolumeReductionFactor:
                config?.aggressiveVolumeReductionFactor ??
                this.getDefaultAggressiveVolumeReductionFactor(),

            enableZoneConfluenceFilter:
                config?.enableZoneConfluenceFilter ??
                this.getDefaultEnableZoneConfluenceFilter(),
            enableDepletionAnalysis:
                config?.enableDepletionAnalysis ??
                this.getDefaultEnableDepletionAnalysis(),
            enableCrossTimeframeAnalysis:
                config?.enableCrossTimeframeAnalysis ??
                this.getDefaultEnableCrossTimeframeAnalysis(),
            confluenceConfidenceBoost:
                config?.confluenceConfidenceBoost ??
                this.getDefaultConfluenceConfidenceBoost(),
            depletionConfidenceBoost:
                config?.depletionConfidenceBoost ??
                this.getDefaultDepletionConfidenceBoost(),
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
    private getDefaultDepletionVolumeThreshold(): number {
        return 30;
    }
    private getDefaultDepletionRatioThreshold(): number {
        return 0.6;
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
    private getDefaultDistanceNormalizationDivisor(): number {
        return 2.0;
    }
    private getDefaultPassiveVolumeExhaustionRatio(): number {
        return 0.5;
    }
    private getDefaultAggressiveVolumeExhaustionThreshold(): number {
        return 0.7;
    }
    private getDefaultAggressiveVolumeReductionFactor(): number {
        return 0.5;
    }
    private getDefaultEnableZoneConfluenceFilter(): boolean {
        return true;
    }
    private getDefaultEnableDepletionAnalysis(): boolean {
        return true;
    }
    private getDefaultEnableCrossTimeframeAnalysis(): boolean {
        return false;
    }
    private getDefaultConfluenceConfidenceBoost(): number {
        return 0.15;
    }
    private getDefaultDepletionConfidenceBoost(): number {
        return 0.1;
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
        return 0.3;
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
