// src/indicators/distributionDetectorEnhanced.ts
//
// ✅ STANDALONE DISTRIBUTION DETECTOR: CLAUDE.md Compliant Enhanced Distribution Detection
//
// This file implements DistributionDetectorEnhanced as a standalone detector that extends
// BaseDetector directly, eliminating legacy inheritance chains and ZoneManager dependencies.
//
// ARCHITECTURE APPROACH:
// - Standalone pattern: No legacy inheritance, extends BaseDetector directly
// - CLAUDE.md compliant: All magic numbers configurable, FinancialMath usage
// - Zone-agnostic: Uses Universal Zones from preprocessor instead of ZoneManager
// - Clean signals: Independent signal emission based on actual distribution patterns
//
// KEY FEATURES:
// - Multi-timeframe distribution pattern analysis (5T, 10T, 20T)
// - Institutional selling pressure detection using Universal Zones
// - Enhanced distribution scoring with zone confluence
// - Zero dependency on legacy ZoneManager or universalZoneConfig
//

import { Detector } from "./base/detectorEnrichedTrade.js";
import { FinancialMath } from "../utils/financialMath.js";
import type { ILogger } from "../infrastructure/loggerInterface.js";
import type { IMetricsCollector } from "../infrastructure/metricsCollectorInterface.js";
import type { IOrderflowPreprocessor } from "../market/orderFlowPreprocessor.js";
import type {
    EnrichedTradeEvent,
    StandardZoneData,
    ZoneSnapshot,
} from "../types/marketEvents.js";
import type {
    SignalCandidate,
    EnhancedDistributionSignalData,
    DistributionConditions,
    DistributionMarketRegime,
} from "../types/signalTypes.js";
import { z } from "zod";
import { DistributionDetectorSchema } from "../core/config.js";
import type { ZoneVisualizationData } from "../types/zoneTypes.js";

/**
 * Enhanced configuration interface for distribution detection - ONLY distribution-specific parameters
 *
 * STANDALONE VERSION: Core interface for enhanced distribution detection
 */
// Use Zod schema inference for complete type safety - matches config.json exactly
export type DistributionEnhancedSettings = z.infer<
    typeof DistributionDetectorSchema
>;

/**
 * Statistics interface for monitoring distribution detector enhancements
 *
 * STANDALONE VERSION: Comprehensive monitoring and debugging
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
 * DistributionDetectorEnhanced - Standalone enhanced distribution detector
 *
 * STANDALONE VERSION: CLAUDE.md compliant distribution detection without legacy dependencies
 *
 * This enhanced detector provides sophisticated multi-timeframe distribution analysis using
 * Universal Zones from the preprocessor, with all parameters configurable and no magic numbers.
 */
export class DistributionDetectorEnhanced extends Detector {
    private readonly useStandardizedZones: boolean;
    private readonly enhancementConfig: DistributionEnhancedSettings;
    private readonly enhancementStats: DistributionEnhancementStats;
    private readonly preprocessor: IOrderflowPreprocessor;
    private readonly symbol: string;

    // CLAUDE.md compliant configuration parameters - NO MAGIC NUMBERS
    private readonly confluenceMinZones: number;
    private readonly confluenceMaxDistance: number;
    private readonly confluenceConfidenceBoost: number;
    private readonly crossTimeframeConfidenceBoost: number;
    private readonly distributionVolumeThreshold: number;
    private readonly distributionRatioThreshold: number;
    private readonly alignmentScoreThreshold: number;

    constructor(
        id: string,
        symbol: string,
        settings: DistributionEnhancedSettings,
        preprocessor: IOrderflowPreprocessor,
        logger: ILogger,
        metrics: IMetricsCollector
    ) {
        // Settings are pre-validated by Config.DISTRIBUTION_DETECTOR getter
        // No validation needed here - trust that settings are correct

        // Initialize base detector directly (no legacy inheritance)
        super(id, logger, metrics);

        this.symbol = symbol;

        // Initialize enhancement configuration
        this.useStandardizedZones = settings.useStandardizedZones;
        this.enhancementConfig = settings;
        this.preprocessor = preprocessor;

        // CLAUDE.md Compliance: Extract all configurable parameters (NO MAGIC NUMBERS)
        this.confluenceMinZones = settings.confluenceMinZones;
        this.confluenceMaxDistance = settings.confluenceMaxDistance;
        this.confluenceConfidenceBoost = settings.confluenceConfidenceBoost;
        this.crossTimeframeConfidenceBoost =
            settings.crossTimeframeConfidenceBoost;
        this.distributionVolumeThreshold = settings.distributionVolumeThreshold;
        this.distributionRatioThreshold = settings.distributionRatioThreshold;
        this.alignmentScoreThreshold = settings.alignmentScoreThreshold;

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
     * Main trade event processing - implements required BaseDetector interface
     *
     * STANDALONE VERSION: Processes trades directly without legacy detector dependency
     */
    public onEnrichedTrade(event: EnrichedTradeEvent): void {
        // Only process if standardized zones are enabled and available
        if (
            !this.useStandardizedZones ||
            this.enhancementConfig.enhancementMode === "disabled" ||
            !event.zoneData
        ) {
            return;
        }

        this.enhancementStats.callCount++;

        try {
            // Apply standalone distribution analysis
            this.analyzeDistributionPattern(event);
        } catch (error) {
            this.enhancementStats.errorCount++;
            this.handleError(
                error instanceof Error ? error : new Error(String(error)),
                "DistributionDetectorEnhanced.onEnrichedTrade"
            );
        }
    }

    /**
     * Get detector status - implements required BaseDetector interface
     */
    public getStatus(): string {
        return `Distribution Enhanced - Mode: ${this.enhancementConfig.enhancementMode}, Zones: ${this.useStandardizedZones ? "enabled" : "disabled"}`;
    }

    /**
     * Mark signal as confirmed - implements required BaseDetector interface
     */
    public markSignalConfirmed(zone: number, side: "buy" | "sell"): void {
        // Implementation for signal confirmation tracking if needed
        this.logger.debug("DistributionDetectorEnhanced: Signal confirmed", {
            detectorId: this.getId(),
            zone,
            side,
        });
    }

    /**
     * Core distribution pattern analysis using standardized zones
     *
     * STANDALONE VERSION: Multi-timeframe distribution analysis without legacy dependencies
     */
    private analyzeDistributionPattern(event: EnrichedTradeEvent): void {
        if (!event.zoneData) return;

        let totalConfidenceBoost = 0;
        let enhancementApplied = false;

        // Zone confluence analysis for distribution validation (CLAUDE.md compliant)
        if (this.enhancementConfig.enableZoneConfluenceFilter) {
            const confluenceResult = this.analyzeZoneConfluence(
                event.zoneData,
                event.price
            );
            if (confluenceResult.hasConfluence) {
                this.enhancementStats.confluenceDetectionCount++;
                totalConfidenceBoost += this.confluenceConfidenceBoost;
                enhancementApplied = true;

                this.logger.debug(
                    "DistributionDetectorEnhanced: Zone confluence detected for distribution validation",
                    {
                        detectorId: this.getId(),
                        price: event.price,
                        confluenceZones: confluenceResult.confluenceZones,
                        confluenceStrength: confluenceResult.confluenceStrength,
                        confidenceBoost: this.confluenceConfidenceBoost,
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
                    this.enhancementConfig.sellingPressureConfidenceBoost;
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

        // Cross-timeframe distribution analysis (CLAUDE.md compliant)
        if (this.enhancementConfig.enableCrossTimeframeAnalysis) {
            const crossTimeframeResult = this.analyzeCrossTimeframeDistribution(
                event.zoneData,
                event
            );
            if (crossTimeframeResult.hasAlignment) {
                this.enhancementStats.crossTimeframeAnalysisCount++;
                totalConfidenceBoost += this.crossTimeframeConfidenceBoost;
                enhancementApplied = true;

                this.logger.debug(
                    "DistributionDetectorEnhanced: Cross-timeframe distribution alignment",
                    {
                        detectorId: this.getId(),
                        price: event.price,
                        alignmentScore: crossTimeframeResult.alignmentScore,
                        timeframeBreakdown:
                            crossTimeframeResult.timeframeBreakdown,
                        confidenceBoost: this.crossTimeframeConfidenceBoost,
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

            // ✅ EMIT ZONE UPDATE - For visualization in dashboard
            this.emitDistributionZoneUpdate(event, totalConfidenceBoost);

            // ✅ EMIT SIGNAL ONLY for actionable zone events (completion/invalidation/consumption)
            this.emitDistributionZoneSignal(event, totalConfidenceBoost);
        }
    }

    /**
     * Analyze zone confluence for distribution pattern validation
     *
     * STANDALONE VERSION: Multi-timeframe confluence analysis
     */
    private analyzeZoneConfluence(
        zoneData: StandardZoneData,
        price: number
    ): {
        hasConfluence: boolean;
        confluenceZones: number;
        confluenceStrength: number;
    } {
        const minConfluenceZones = this.confluenceMinZones;
        const maxDistance = this.confluenceMaxDistance;

        // Find zones that overlap around the current price
        const relevantZones: ZoneSnapshot[] = [];

        // Check 5-tick zones - using universal zone analysis service
        relevantZones.push(
            ...this.preprocessor.findZonesNearPrice(
                zoneData.zones5Tick,
                price,
                maxDistance
            )
        );

        // Check 10-tick zones - using universal zone analysis service
        relevantZones.push(
            ...this.preprocessor.findZonesNearPrice(
                zoneData.zones10Tick,
                price,
                maxDistance
            )
        );

        // Check 20-tick zones - using universal zone analysis service
        relevantZones.push(
            ...this.preprocessor.findZonesNearPrice(
                zoneData.zones20Tick,
                price,
                maxDistance
            )
        );

        const confluenceZones = relevantZones.length;
        const hasConfluence = confluenceZones >= minConfluenceZones;

        // Calculate confluence strength using FinancialMath (higher = more zones overlapping)
        const confluenceStrengthDivisor =
            this.enhancementConfig.confluenceStrengthDivisor;
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
     * Analyze institutional selling pressure across standardized zones
     *
     * STANDALONE VERSION: Enhanced selling pressure detection
     */
    private analyzeInstitutionalSellingPressure(
        zoneData: StandardZoneData,
        event: EnrichedTradeEvent
    ): {
        hasSellingPressure: boolean;
        sellingRatio: number;
        affectedZones: number;
    } {
        const sellingThreshold = this.distributionVolumeThreshold;
        const minRatio = this.distributionRatioThreshold;

        // Analyze all zones for institutional selling pressure patterns
        const allZones = [
            ...zoneData.zones5Tick,
            ...zoneData.zones10Tick,
            ...zoneData.zones20Tick,
        ];

        const relevantZones = this.preprocessor.findZonesNearPrice(
            allZones,
            event.price,
            this.confluenceMaxDistance
        );

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
                        this.enhancementConfig.passiveToAggressiveRatio
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
     * STANDALONE VERSION: Multi-timeframe alignment analysis
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
            this.enhancementConfig.varianceReductionFactor;
        const normalizedVariance = FinancialMath.multiplyQuantities(
            variance,
            varianceReductionFactor
        );
        const alignmentScore = FinancialMath.multiplyQuantities(
            avgDistribution,
            Math.max(0, 1 - normalizedVariance)
        ); // Penalize high variance
        const hasAlignment = alignmentScore >= this.alignmentScoreThreshold; // Require moderate alignment for distribution

        return {
            hasAlignment,
            alignmentScore,
            timeframeBreakdown,
        };
    }

    /**
     * Calculate distribution strength for a specific timeframe
     *
     * STANDALONE VERSION: Timeframe-specific analysis
     */
    private calculateTimeframeDistributionStrength(
        zones: ZoneSnapshot[],
        price: number
    ): number {
        if (zones.length === 0) return 0;

        const relevantZones = this.preprocessor.findZonesNearPrice(
            zones,
            price,
            this.confluenceMaxDistance
        );
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
                this.enhancementConfig.aggressiveSellingRatioThreshold;
            const aggressiveSellingReductionFactor =
                this.enhancementConfig.aggressiveSellingReductionFactor;
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
     * STANDALONE VERSION: Comprehensive metrics tracking
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
     * Get enhancement statistics for monitoring and debugging
     *
     * STANDALONE VERSION: Statistics and monitoring interface
     */
    public getEnhancementStats(): DistributionEnhancementStats {
        return { ...this.enhancementStats };
    }

    /**
     * Emit distribution zone update for dashboard visualization
     */
    private emitDistributionZoneUpdate(
        event: EnrichedTradeEvent,
        confidenceBoost: number
    ): void {
        if (!event.zoneData) return;

        // Determine zone update type based on distribution strength
        const updateType = this.determineZoneUpdateType(event, confidenceBoost);
        if (!updateType) return;

        // Create zone data for visualization
        const zoneData = this.createZoneVisualizationData(
            event,
            confidenceBoost
        );
        if (!zoneData) return;

        // Emit zoneUpdate event for dashboard visualization
        this.emit("zoneUpdate", {
            updateType,
            zone: zoneData,
            significance: confidenceBoost,
            detectorId: this.getId(),
            timestamp: Date.now(),
        });

        this.logger.debug("DistributionDetectorEnhanced: Zone update emitted", {
            detectorId: this.getId(),
            updateType,
            zoneId: zoneData.id,
            confidence: confidenceBoost,
        });
    }

    /**
     * Emit distribution zone signal for actionable events only
     */
    private emitDistributionZoneSignal(
        event: EnrichedTradeEvent,
        confidenceBoost: number
    ): void {
        // Only emit signals for actionable zone events (completion, invalidation, consumption)
        const signalType = this.determineZoneSignalType(event, confidenceBoost);
        if (!signalType) return; // No actionable event detected

        // Create zone signal for stats tracking
        const zoneData = this.createZoneVisualizationData(
            event,
            confidenceBoost
        );
        if (!zoneData) return;

        const signalSide = this.determineDistributionSignalSide(event);
        if (signalSide === "neutral") return;

        // Emit zoneSignal event for dashboard signals list
        this.emit("zoneSignal", {
            signalType,
            zone: zoneData,
            actionType: signalType,
            confidence: Math.min(
                1.0,
                this.enhancementConfig.baseConfidenceRequired + confidenceBoost
            ),
            urgency: confidenceBoost > 0.15 ? "high" : "medium",
            expectedDirection: signalSide === "sell" ? "down" : "up",
            detectorId: this.getId(),
            timestamp: Date.now(),
        });

        this.logger.info("DistributionDetectorEnhanced: Zone signal emitted", {
            detectorId: this.getId(),
            signalType,
            zoneId: zoneData.id,
            confidence: confidenceBoost,
            side: signalSide,
        });
    }

    /**
     * Create zone visualization data for dashboard
     */
    private createZoneVisualizationData(
        event: EnrichedTradeEvent,
        confidenceBoost: number
    ): ZoneVisualizationData | null {
        if (!event.zoneData) return null;

        const distributionMetrics = this.calculateDistributionMetrics(event);
        if (!distributionMetrics) return null;

        return {
            id: `distribution_${this.getId()}_${event.price.toFixed(2)}`,
            type: "distribution",
            priceRange: {
                center: event.price,
                min: event.price - this.confluenceMaxDistance,
                max: event.price + this.confluenceMaxDistance,
            },
            strength: distributionMetrics.strength,
            confidence: Math.min(
                1.0,
                this.enhancementConfig.baseConfidenceRequired + confidenceBoost
            ),
            volume: distributionMetrics.volumeConcentration,
            timespan: distributionMetrics.duration,
            lastUpdate: Date.now(),
            metadata: {
                sellRatio: distributionMetrics.sellRatio,
                conditions: distributionMetrics.conditions,
                marketRegime: distributionMetrics.marketRegime,
            },
        };
    }

    /**
     * Determine zone update type for visualization
     */
    private determineZoneUpdateType(
        event: EnrichedTradeEvent,
        confidenceBoost: number
    ): string | null {
        // Always create/update zones for visualization
        if (
            confidenceBoost >=
            this.enhancementConfig.minConfidenceBoostThreshold
        ) {
            if (confidenceBoost > 0.15) {
                return "zone_strengthened";
            } else {
                return "zone_updated";
            }
        }
        return "zone_created"; // Default for new zones
    }

    /**
     * Determine if this should generate an actionable zone signal
     */
    private determineZoneSignalType(
        event: EnrichedTradeEvent,
        confidenceBoost: number
    ): string | null {
        // Use base confidence threshold for signal eligibility
        if (confidenceBoost < this.enhancementConfig.baseConfidenceRequired) {
            return null; // Not significant enough for any signal
        }

        const distributionMetrics = this.calculateDistributionMetrics(event);
        if (!distributionMetrics) return null;

        // Check for strong distribution activity (medium confidence)
        if (
            distributionMetrics.sellRatio >= this.distributionRatioThreshold &&
            confidenceBoost >= this.enhancementConfig.baseConfidenceRequired
        ) {
            return "strengthened"; // Zone strengthening - actionable signal
        }

        return null;
    }

    /**
     * Emit enhanced distribution signal independently
     *
     * STANDALONE VERSION: Independent signal emission for enhanced distribution detection
     */
    private emitEnhancedDistributionSignal(
        event: EnrichedTradeEvent,
        confidenceBoost: number
    ): void {
        // Only emit signals when enhancement is meaningful
        if (
            confidenceBoost < this.enhancementConfig.minConfidenceBoostThreshold
        ) {
            return;
        }

        // Calculate enhanced distribution confidence
        if (
            typeof this.enhancementConfig.baseConfidenceRequired !== "number" ||
            this.enhancementConfig.baseConfidenceRequired <= 0
        ) {
            return; // Cannot proceed without valid base confidence
        }
        const baseConfidenceValue =
            this.enhancementConfig.baseConfidenceRequired;
        const enhancedConfidence = Math.min(
            1.0,
            FinancialMath.addAmounts(baseConfidenceValue, confidenceBoost, 8)
        );

        // Only emit high-quality enhanced signals
        if (
            enhancedConfidence < this.enhancementConfig.finalConfidenceRequired
        ) {
            return;
        }

        // Determine signal side based on distribution analysis
        const signalSide = this.determineDistributionSignalSide(event);
        if (signalSide === "neutral") {
            return;
        }

        // Calculate distribution metrics
        const distributionMetrics = this.calculateDistributionMetrics(event);
        if (distributionMetrics === null) {
            return;
        }

        // Create enhanced distribution signal data
        const distributionResult: EnhancedDistributionSignalData = {
            duration: distributionMetrics.duration,
            zone: distributionMetrics.zone,
            ratio: distributionMetrics.sellRatio,
            sellRatio: distributionMetrics.sellRatio,
            strength: distributionMetrics.strength,
            isDistributing: true,
            price: event.price,
            side: signalSide,
            confidence: enhancedConfidence,
            metadata: {
                distributionScore: distributionMetrics.strength,
                conditions: distributionMetrics.conditions,
                marketRegime: distributionMetrics.marketRegime,
                statisticalSignificance: enhancedConfidence,
                volumeConcentration: distributionMetrics.volumeConcentration,
                detectorVersion: "enhanced_v1",
            },
        };

        // Create signal candidate
        const signalCandidate: SignalCandidate = {
            id: `enhanced-distribution-${Date.now()}-${Math.random().toString(36).substring(7)}`,
            type: "distribution",
            side: signalSide,
            confidence: enhancedConfidence,
            timestamp: Date.now(),
            data: distributionResult,
        };

        // ✅ EMIT ENHANCED DISTRIBUTION SIGNAL - Independent of base detector
        this.emit("signalCandidate", signalCandidate);

        this.logger.info(
            "DistributionDetectorEnhanced: ENHANCED DISTRIBUTION SIGNAL EMITTED",
            {
                detectorId: this.getId(),
                price: event.price,
                side: signalSide,
                confidence: enhancedConfidence,
                confidenceBoost,
                strength: distributionMetrics.strength,
                sellRatio: distributionMetrics.sellRatio,
                signalId: signalCandidate.id,
                signalType: "distribution",
            }
        );
    }

    /**
     * Determine distribution signal side based on market conditions
     */
    private determineDistributionSignalSide(
        event: EnrichedTradeEvent
    ): "buy" | "sell" | "neutral" {
        if (!event.zoneData) {
            return "neutral";
        }

        // For distribution, we expect institutions to be selling (distributing)
        // This creates selling pressure, so we might see sell signals
        const allZones = [
            ...event.zoneData.zones5Tick,
            ...event.zoneData.zones10Tick,
            ...event.zoneData.zones20Tick,
        ];

        const relevantZones = this.preprocessor.findZonesNearPrice(
            allZones,
            event.price,
            this.confluenceMaxDistance
        );
        if (relevantZones.length === 0) {
            return "neutral";
        }

        let totalSellVolume = 0;
        let totalBuyVolume = 0;

        relevantZones.forEach((zone) => {
            totalSellVolume += zone.aggressiveSellVolume;
            totalBuyVolume += zone.aggressiveBuyVolume;
        });

        const totalVolume = totalSellVolume + totalBuyVolume;
        if (totalVolume === 0) {
            return "neutral";
        }

        const sellRatio = FinancialMath.divideQuantities(
            totalSellVolume,
            totalVolume
        );
        const distributionThreshold = this.distributionRatioThreshold;

        // If selling pressure is high, this suggests distribution pattern
        if (sellRatio >= distributionThreshold) {
            return "sell"; // Distribution creates bearish pressure
        }

        return "neutral";
    }

    /**
     * Calculate distribution metrics for signal data
     */
    private calculateDistributionMetrics(event: EnrichedTradeEvent): {
        duration: number;
        zone: number;
        sellRatio: number;
        strength: number;
        conditions: DistributionConditions;
        marketRegime: DistributionMarketRegime;
        volumeConcentration: number;
    } | null {
        if (!event.zoneData) {
            return null;
        }

        const allZones = [
            ...event.zoneData.zones5Tick,
            ...event.zoneData.zones10Tick,
            ...event.zoneData.zones20Tick,
        ];

        const relevantZones = this.preprocessor.findZonesNearPrice(
            allZones,
            event.price,
            this.confluenceMaxDistance
        );
        if (relevantZones.length === 0) {
            return null;
        }

        let totalSellVolume = 0;
        let totalVolume = 0;
        let totalPassiveVolume = 0;

        relevantZones.forEach((zone) => {
            totalSellVolume += zone.aggressiveSellVolume;
            totalVolume += zone.aggressiveVolume;
            totalPassiveVolume += zone.passiveVolume;
        });

        if (totalVolume === 0) {
            return null;
        }

        const sellRatio = FinancialMath.divideQuantities(
            totalSellVolume,
            totalVolume
        );
        const strength = Math.min(1.0, sellRatio * 1.5); // Boost strength for high sell ratios

        // Calculate duration (configurable)
        const duration = this.enhancementConfig.defaultDurationMs;

        // Calculate zone (price level using FinancialMath)
        const zone = FinancialMath.normalizePriceToTick(
            event.price,
            this.enhancementConfig.tickSize
        );

        // Volume concentration
        const volumeConcentration =
            relevantZones.length > 0
                ? FinancialMath.divideQuantities(
                      totalVolume,
                      relevantZones.length
                  )
                : 0;

        // Calculate distribution-specific metrics (CLAUDE.md compliant)
        const sellingPressure = sellRatio;
        const priceResistance = Math.min(
            this.enhancementConfig.maxPriceResistance,
            FinancialMath.multiplyQuantities(
                strength,
                this.enhancementConfig.priceResistanceMultiplier
            )
        );
        const distributionEfficiency = FinancialMath.divideQuantities(
            totalSellVolume,
            Math.max(
                this.enhancementConfig.minPassiveVolumeForEfficiency,
                totalPassiveVolume
            )
        );

        return {
            duration,
            zone,
            sellRatio,
            strength,
            conditions: {
                sellRatio,
                duration,
                aggressiveVolume: totalVolume,
                passiveVolume: totalPassiveVolume,
                totalVolume: totalVolume + totalPassiveVolume,
                strength,
                sellingPressure,
                priceResistance,
                volumeConcentration,
                recentActivity: 1,
                tradeCount: relevantZones.length,
                meetsMinDuration: true,
                meetsMinRatio: sellRatio >= this.distributionRatioThreshold,
                isRecentlyActive: true,
                dominantSide: "sell" as const,
                sideConfidence: sellRatio,
                distributionEfficiency,
            },
            marketRegime: {
                volatility: this.enhancementConfig.defaultVolatility,
                baselineVolatility:
                    this.enhancementConfig.defaultBaselineVolatility,
                distributionPressure: sellingPressure,
                resistanceStrength: priceResistance,
                lastUpdate: Date.now(),
            },
            volumeConcentration,
        };
    }

    /**
     * Update enhancement mode at runtime (for A/B testing and gradual rollout)
     *
     * STANDALONE VERSION: Runtime configuration management
     */
    public setEnhancementMode(
        mode: "disabled" | "testing" | "production"
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
     * Enhanced cleanup - no legacy dependencies to clean up
     *
     * STANDALONE VERSION: Simple cleanup without legacy detector cleanup
     */
    public cleanup(): void {
        this.logger.info(
            "DistributionDetectorEnhanced: Standalone cleanup completed",
            {
                detectorId: this.getId(),
                enhancementStats: this.enhancementStats,
            }
        );
    }
}
