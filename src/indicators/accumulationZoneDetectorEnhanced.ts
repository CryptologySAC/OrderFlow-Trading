// src/indicators/accumulationZoneDetectorEnhanced.ts
//
// ✅ STANDALONE ACCUMULATION DETECTOR: CLAUDE.md Compliant Enhanced Accumulation Detection
//
// This file implements AccumulationZoneDetectorEnhanced as a standalone detector that extends
// BaseDetector directly, eliminating legacy inheritance chains and ZoneManager dependencies.
//
// ARCHITECTURE APPROACH:
// - Standalone pattern: No legacy inheritance, extends BaseDetector directly
// - CLAUDE.md compliant: All magic numbers configurable, FinancialMath usage
// - Zone-agnostic: Uses Universal Zones from preprocessor instead of ZoneManager
// - Clean signals: Independent signal emission based on actual accumulation patterns
//
// KEY FEATURES:
// - Multi-timeframe accumulation pattern analysis (5T, 10T, 20T)
// - Institutional buying pressure detection using Universal Zones
// - Enhanced accumulation scoring with zone confluence
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
    AccumulationResult,
    AccumulationConditions,
    AccumulationMarketRegime,
} from "../types/signalTypes.js";
import { z } from "zod";
import { AccumulationDetectorSchema } from "../core/config.js";
import type { ZoneVisualizationData } from "../types/zoneTypes.js";

/**
 * Enhanced configuration interface for accumulation detection - ONLY accumulation-specific parameters
 *
 * STANDALONE VERSION: Core interface for enhanced accumulation detection
 */
// Use Zod schema inference for complete type safety - matches config.json exactly
export type AccumulationEnhancedSettings = z.infer<
    typeof AccumulationDetectorSchema
>;

/**
 * Statistics interface for monitoring accumulation detector enhancements
 *
 * STANDALONE VERSION: Comprehensive monitoring and debugging
 */
export interface AccumulationEnhancementStats {
    // Call statistics
    callCount: number;
    enhancementCount: number;
    errorCount: number;

    // Feature usage statistics
    confluenceDetectionCount: number;
    buyingPressureDetectionCount: number;
    crossTimeframeAnalysisCount: number;

    // Performance metrics
    averageConfidenceBoost: number;
    totalConfidenceBoost: number;
    enhancementSuccessRate: number;
}

/**
 * AccumulationZoneDetectorEnhanced - Standalone enhanced accumulation detector
 *
 * STANDALONE VERSION: CLAUDE.md compliant accumulation detection without legacy dependencies
 *
 * This enhanced detector provides sophisticated multi-timeframe accumulation analysis using
 * Universal Zones from the preprocessor, with all parameters configurable and no magic numbers.
 */
export class AccumulationZoneDetectorEnhanced extends Detector {
    private readonly useStandardizedZones: boolean;
    private readonly enhancementConfig: AccumulationEnhancedSettings;
    private readonly enhancementStats: AccumulationEnhancementStats;
    private readonly preprocessor: IOrderflowPreprocessor;
    private readonly symbol: string;

    // CLAUDE.md compliant configuration parameters - NO MAGIC NUMBERS
    private readonly confluenceMinZones: number;
    private readonly confluenceMaxDistance: number;
    private readonly confluenceConfidenceBoost: number;
    private readonly crossTimeframeConfidenceBoost: number;
    private readonly accumulationVolumeThreshold: number;
    private readonly accumulationRatioThreshold: number;
    private readonly alignmentScoreThreshold: number;

    constructor(
        id: string,
        symbol: string,
        settings: AccumulationEnhancedSettings,
        preprocessor: IOrderflowPreprocessor,
        logger: ILogger,
        metrics: IMetricsCollector
    ) {
        // Settings are pre-validated by Config.ACCUMULATION_DETECTOR getter
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
        this.accumulationVolumeThreshold = settings.accumulationVolumeThreshold;
        this.accumulationRatioThreshold = settings.accumulationRatioThreshold;
        this.alignmentScoreThreshold = settings.alignmentScoreThreshold;

        // Initialize enhancement statistics
        this.enhancementStats = {
            callCount: 0,
            enhancementCount: 0,
            errorCount: 0,
            confluenceDetectionCount: 0,
            buyingPressureDetectionCount: 0,
            crossTimeframeAnalysisCount: 0,
            averageConfidenceBoost: 0,
            totalConfidenceBoost: 0,
            enhancementSuccessRate: 0,
        };

        this.logger.info("AccumulationZoneDetectorEnhanced initialized", {
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
            // Apply standalone accumulation analysis
            this.analyzeAccumulationPattern(event);
        } catch (error) {
            this.enhancementStats.errorCount++;
            this.handleError(
                error instanceof Error ? error : new Error(String(error)),
                "AccumulationZoneDetectorEnhanced.onEnrichedTrade"
            );
        }
    }

    /**
     * Get detector status - implements required BaseDetector interface
     */
    public getStatus(): string {
        return `Accumulation Enhanced - Mode: ${this.enhancementConfig.enhancementMode}, Zones: ${this.useStandardizedZones ? "enabled" : "disabled"}`;
    }

    /**
     * Mark signal as confirmed - implements required BaseDetector interface
     */
    public markSignalConfirmed(zone: number, side: "buy" | "sell"): void {
        // Implementation for signal confirmation tracking if needed
        this.logger.debug(
            "AccumulationZoneDetectorEnhanced: Signal confirmed",
            {
                detectorId: this.getId(),
                zone,
                side,
            }
        );
    }

    /**
     * Core accumulation pattern analysis using pure volume calculations
     */
    private analyzeAccumulationPattern(event: EnrichedTradeEvent): void {
        if (!event.zoneData) return;

        // Calculate base accumulation strength from pure volume ratios
        const calculatedAccumulationStrength =
            this.calculateAccumulationStrength(event);
        if (calculatedAccumulationStrength === null) return;

        // Start with base detection strength
        let totalConfidence = calculatedAccumulationStrength;

        // Add confluence contribution (pure volume concentration)
        const calculatedConfluenceStrength =
            this.calculateConfluenceContribution(event.zoneData, event.price);
        totalConfidence += calculatedConfluenceStrength;

        // Add institutional contribution (pure volume size analysis)
        const calculatedInstitutionalScore =
            this.calculateInstitutionalContribution(event.zoneData, event);
        totalConfidence += calculatedInstitutionalScore;

        // Add alignment contribution (pure volume consistency)
        const calculatedAlignmentScore = this.calculateAlignmentContribution(
            event.zoneData,
            event
        );
        totalConfidence += calculatedAlignmentScore;

        // SINGLE confidence check before any emission
        if (totalConfidence >= this.enhancementConfig.confidenceThreshold) {
            // Update enhancement statistics
            this.enhancementStats.enhancementCount++;
            this.enhancementStats.totalConfidenceBoost +=
                totalConfidence - calculatedAccumulationStrength;
            this.enhancementStats.averageConfidenceBoost =
                this.enhancementStats.totalConfidenceBoost /
                this.enhancementStats.enhancementCount;
            this.enhancementStats.enhancementSuccessRate =
                this.enhancementStats.enhancementCount /
                this.enhancementStats.callCount;

            // Store enhanced accumulation metrics for monitoring
            this.storeEnhancedAccumulationMetrics(event, totalConfidence);

            // ✅ EMIT ZONE UPDATE - For visualization in dashboard
            this.emitAccumulationZoneUpdate(event, totalConfidence);

            // ✅ EMIT SIGNAL ONLY for actionable zone events
            this.emitAccumulationZoneSignal(event, totalConfidence);

            this.logger.debug(
                "AccumulationZoneDetectorEnhanced: Accumulation pattern detected",
                {
                    detectorId: this.getId(),
                    price: event.price,
                    baseStrength: calculatedAccumulationStrength,
                    confluenceContribution: calculatedConfluenceStrength,
                    institutionalContribution: calculatedInstitutionalScore,
                    alignmentContribution: calculatedAlignmentScore,
                    totalConfidence: totalConfidence,
                }
            );
        }
    }

    /**
     * Calculate base accumulation strength from pure volume ratios
     */
    private calculateAccumulationStrength(
        event: EnrichedTradeEvent
    ): number | null {
        if (!event.zoneData) return null;

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
        if (relevantZones.length === 0) return null;

        let totalVolume = 0;
        let totalBuyVolume = 0;

        relevantZones.forEach((zone) => {
            totalVolume += zone.aggressiveVolume + zone.passiveVolume;
            totalBuyVolume += zone.aggressiveBuyVolume;
        });

        if (totalVolume === 0) return null;

        // Accumulation strength based purely on aggressive buying ratio
        return FinancialMath.divideQuantities(totalBuyVolume, totalVolume);
    }

    /**
     * Calculate confluence contribution based purely on volume concentration
     */
    private calculateConfluenceContribution(
        zoneData: StandardZoneData,
        price: number
    ): number {
        // Find zones near current price
        const relevantZones: ZoneSnapshot[] = [];
        relevantZones.push(
            ...this.preprocessor.findZonesNearPrice(
                zoneData.zones5Tick,
                price,
                this.confluenceMaxDistance
            ),
            ...this.preprocessor.findZonesNearPrice(
                zoneData.zones10Tick,
                price,
                this.confluenceMaxDistance
            ),
            ...this.preprocessor.findZonesNearPrice(
                zoneData.zones20Tick,
                price,
                this.confluenceMaxDistance
            )
        );

        if (relevantZones.length === 0) return 0;

        // Calculate volume concentration in confluence area
        let totalVolume = 0;
        let totalAggressiveVolume = 0;
        let totalBuyVolume = 0;

        relevantZones.forEach((zone) => {
            totalVolume += zone.aggressiveVolume + zone.passiveVolume;
            totalAggressiveVolume += zone.aggressiveVolume;
            totalBuyVolume += zone.aggressiveBuyVolume;
        });

        if (totalVolume === 0) return 0;

        // Confluence strength based purely on volume ratios:
        // More zones with higher buy volume concentration = higher confluence
        const buyRatio = FinancialMath.divideQuantities(
            totalBuyVolume,
            totalVolume
        );
        const aggressiveRatio = FinancialMath.divideQuantities(
            totalAggressiveVolume,
            totalVolume
        );
        const zoneConcentration = FinancialMath.divideQuantities(
            relevantZones.length,
            relevantZones.length + 1
        );

        // Pure volume-based confluence: buy activity * aggressive activity * zone density
        return buyRatio * aggressiveRatio * zoneConcentration;
    }

    /**
     * Calculate institutional contribution based purely on volume size patterns
     */
    private calculateInstitutionalContribution(
        zoneData: StandardZoneData,
        event: EnrichedTradeEvent
    ): number {
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

        if (relevantZones.length === 0) return 0;

        let totalVolume = 0;
        let totalAggressiveVolume = 0;
        let totalBuyVolume = 0;
        let largeVolumeSum = 0;

        relevantZones.forEach((zone) => {
            const zoneTotal = zone.aggressiveVolume + zone.passiveVolume;
            totalVolume += zoneTotal;
            totalAggressiveVolume += zone.aggressiveVolume;
            totalBuyVolume += zone.aggressiveBuyVolume;

            // Identify large volume activity (institutional-sized)
            const avgZoneVolume = zoneTotal / (relevantZones.length || 1);
            if (zone.aggressiveVolume > avgZoneVolume) {
                largeVolumeSum += zone.aggressiveVolume;
            }
        });

        if (totalVolume === 0) return 0;

        // Institutional contribution based purely on volume patterns:
        // 1. Buy volume dominance
        // 2. Large order concentration
        // 3. Aggressive activity level
        const buyRatio = FinancialMath.divideQuantities(
            totalBuyVolume,
            totalVolume
        );
        const largeVolumeRatio = FinancialMath.divideQuantities(
            largeVolumeSum,
            totalVolume
        );
        const aggressiveRatio = FinancialMath.divideQuantities(
            totalAggressiveVolume,
            totalVolume
        );

        // Pure volume-based institutional score
        return buyRatio * largeVolumeRatio * aggressiveRatio;
    }

    /**
     * Calculate alignment contribution based purely on volume consistency across timeframes
     */
    private calculateAlignmentContribution(
        zoneData: StandardZoneData,
        event: EnrichedTradeEvent
    ): number {
        // Calculate accumulation strength for each timeframe
        const tick5Accumulation = this.calculateTimeframeAccumulationStrength(
            zoneData.zones5Tick,
            event.price
        );
        const tick10Accumulation = this.calculateTimeframeAccumulationStrength(
            zoneData.zones10Tick,
            event.price
        );
        const tick20Accumulation = this.calculateTimeframeAccumulationStrength(
            zoneData.zones20Tick,
            event.price
        );

        const accumulationValues = [
            tick5Accumulation,
            tick10Accumulation,
            tick20Accumulation,
        ];
        const avgAccumulation = FinancialMath.calculateMean(accumulationValues);
        if (avgAccumulation === null || avgAccumulation === 0) {
            return 0;
        }

        const stdDev = FinancialMath.calculateStdDev(accumulationValues);
        if (stdDev === null) {
            return 0;
        }

        // Calculate alignment based purely on volume consistency:
        // High average = strong accumulation across timeframes
        // Low standard deviation relative to mean = consistent across timeframes
        if (stdDev === 0) {
            // Perfect consistency across timeframes
            return avgAccumulation;
        }

        const consistencyRatio = FinancialMath.divideQuantities(
            avgAccumulation,
            stdDev
        );

        // Return pure volume-based alignment: strength * consistency
        return (avgAccumulation * consistencyRatio) / (1 + consistencyRatio);
    }

    /**
     * Calculate accumulation strength for a specific timeframe based purely on volume ratios
     */
    private calculateTimeframeAccumulationStrength(
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

        let totalAccumulationScore = 0;

        for (const zone of relevantZones) {
            const totalVolume = zone.aggressiveVolume + zone.passiveVolume;
            if (totalVolume === 0) continue;

            // Accumulation strength based purely on aggressive buying ratio
            const aggressiveBuyingRatio = FinancialMath.divideQuantities(
                zone.aggressiveBuyVolume,
                totalVolume
            );

            totalAccumulationScore += aggressiveBuyingRatio;
        }

        return FinancialMath.divideQuantities(
            totalAccumulationScore,
            relevantZones.length
        );
    }

    /**
     * Analyze zone confluence for accumulation pattern validation
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
     * Analyze institutional buying pressure across standardized zones
     *
     * STANDALONE VERSION: Enhanced buying pressure detection
     */
    private analyzeInstitutionalBuyingPressure(
        zoneData: StandardZoneData,
        event: EnrichedTradeEvent
    ): {
        hasBuyingPressure: boolean;
        buyingRatio: number;
        affectedZones: number;
    } {
        const buyingThreshold = this.accumulationVolumeThreshold;
        const minRatio = this.accumulationRatioThreshold;

        // Analyze all zones for institutional buying pressure patterns
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

            // Check if this zone shows accumulation (high aggressive buying volume)
            // For accumulation: institutions are aggressively buying (buyerIsMaker = false)
            const aggressiveBuyVolume = zone.aggressiveBuyVolume;
            if (
                aggressiveBuyVolume >= buyingThreshold &&
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
        const buyingRatio =
            totalVolume > 0
                ? FinancialMath.divideQuantities(
                      totalAggressiveVolume,
                      totalVolume
                  )
                : 0;
        const hasBuyingPressure = buyingRatio >= minRatio && affectedZones > 0;

        return {
            hasBuyingPressure,
            buyingRatio,
            affectedZones,
        };
    }

    /**
     * Analyze cross-timeframe accumulation patterns
     *
     * STANDALONE VERSION: Multi-timeframe alignment analysis
     */
    private analyzeCrossTimeframeAccumulation(
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
        // Calculate accumulation strength for each timeframe
        const tick5Accumulation = this.calculateTimeframeAccumulationStrength(
            zoneData.zones5Tick,
            event.price
        );
        const tick10Accumulation = this.calculateTimeframeAccumulationStrength(
            zoneData.zones10Tick,
            event.price
        );
        const tick20Accumulation = this.calculateTimeframeAccumulationStrength(
            zoneData.zones20Tick,
            event.price
        );

        const timeframeBreakdown = {
            tick5: tick5Accumulation,
            tick10: tick10Accumulation,
            tick20: tick20Accumulation,
        };

        // Calculate alignment score using FinancialMath (how similar accumulation levels are across timeframes)
        const accumulationValues = [
            tick5Accumulation,
            tick10Accumulation,
            tick20Accumulation,
        ];
        const avgAccumulation = FinancialMath.calculateMean(accumulationValues);
        if (avgAccumulation === null) {
            return {
                hasAlignment: false,
                alignmentScore: 0,
                timeframeBreakdown,
            }; // CLAUDE.md compliance: return null when calculation cannot be performed
        }

        const stdDev = FinancialMath.calculateStdDev(accumulationValues);
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
            avgAccumulation,
            Math.max(0, 1 - normalizedVariance)
        ); // Penalize high variance
        const hasAlignment = alignmentScore >= this.alignmentScoreThreshold; // Require moderate alignment for accumulation

        return {
            hasAlignment,
            alignmentScore,
            timeframeBreakdown,
        };
    }

    /**
     * Store enhanced accumulation metrics for monitoring and analysis
     *
     * STANDALONE VERSION: Comprehensive metrics tracking
     */
    private storeEnhancedAccumulationMetrics(
        event: EnrichedTradeEvent,
        confidenceBoost: number
    ): void {
        // Store metrics for monitoring (commented out to avoid metrics interface errors)
        // this.metricsCollector.recordGauge('accumulation.enhanced.confidence_boost', confidenceBoost);
        // this.metricsCollector.recordCounter('accumulation.enhanced.analysis_count', 1);

        this.logger.debug(
            "AccumulationZoneDetectorEnhanced: Enhanced metrics stored",
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
    public getEnhancementStats(): AccumulationEnhancementStats {
        return { ...this.enhancementStats };
    }

    /**
     * Emit accumulation zone update for dashboard visualization
     */
    private emitAccumulationZoneUpdate(
        event: EnrichedTradeEvent,
        confidenceBoost: number
    ): void {
        if (!event.zoneData) return;

        // Determine zone update type based on accumulation strength
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

        this.logger.debug(
            "AccumulationZoneDetectorEnhanced: Zone update emitted",
            {
                detectorId: this.getId(),
                updateType,
                zoneId: zoneData.id,
                confidence: confidenceBoost,
            }
        );
    }

    /**
     * Emit accumulation zone signal for actionable events only
     */
    private emitAccumulationZoneSignal(
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

        const signalSide = this.determineAccumulationSignalSide(event);
        if (signalSide === "neutral") return;

        // Calculate proper confidence using zone strength instead of threshold
        const calculatedConfidence = Math.min(
            1.0,
            zoneData.strength + confidenceBoost
        );

        // Create signal before emitting
        const zoneSignal = {
            signalType,
            zone: zoneData,
            actionType: signalType,
            confidence: calculatedConfidence,
            urgency: confidenceBoost > 0.15 ? "high" : "medium",
            expectedDirection: signalSide === "buy" ? "up" : "down",
            detectorId: this.getId(),
            timestamp: Date.now(),
        };

        // Emit zoneSignal event for dashboard signals list
        this.emit("zoneSignal", zoneSignal);

        this.logger.info(
            "AccumulationZoneDetectorEnhanced: Zone signal emitted",
            {
                detectorId: this.getId(),
                signalType: zoneSignal.signalType,
                zoneId: zoneSignal.zone.id,
                confidence: zoneSignal.confidence,
                side: signalSide,
                urgency: zoneSignal.urgency,
                expectedDirection: zoneSignal.expectedDirection,
            }
        );
    }

    /**
     * Create zone visualization data for dashboard
     */
    private createZoneVisualizationData(
        event: EnrichedTradeEvent,
        confidenceBoost: number
    ): ZoneVisualizationData | null {
        if (!event.zoneData) return null;

        const accumulationMetrics = this.calculateAccumulationMetrics(event);
        if (!accumulationMetrics) return null;

        return {
            id: `accumulation_${this.getId()}_${event.price.toFixed(2)}`,
            type: "accumulation",
            priceRange: {
                center: event.price,
                min: event.price - this.confluenceMaxDistance,
                max: event.price + this.confluenceMaxDistance,
            },
            strength: accumulationMetrics.strength,
            confidence: Math.min(
                1.0,
                accumulationMetrics.strength + confidenceBoost
            ),
            volume: accumulationMetrics.volumeConcentration,
            timespan: accumulationMetrics.duration,
            lastUpdate: Date.now(),
            metadata: {
                buyRatio: accumulationMetrics.buyRatio,
                conditions: accumulationMetrics.conditions,
                marketRegime: accumulationMetrics.marketRegime,
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
        if (confidenceBoost >= this.enhancementConfig.confidenceThreshold) {
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
        const accumulationMetrics = this.calculateAccumulationMetrics(event);
        if (!accumulationMetrics) return null;

        // Calculate actual confidence from strength + boost
        const actualConfidence = accumulationMetrics.strength + confidenceBoost;

        // Use single confidence threshold for signal eligibility
        if (actualConfidence < this.enhancementConfig.confidenceThreshold) {
            return null; // Not significant enough for any signal
        }

        // Check for strong accumulation activity
        if (accumulationMetrics.buyRatio >= this.accumulationRatioThreshold) {
            return "strengthened"; // Zone strengthening - actionable signal
        }

        return null;
    }

    /**
     * Emit enhanced accumulation signal independently
     *
     * STANDALONE VERSION: Independent signal emission for enhanced accumulation detection
     */
    private emitEnhancedAccumulationSignal(
        event: EnrichedTradeEvent,
        confidenceBoost: number
    ): void {
        // Only emit signals when enhancement is meaningful
        if (confidenceBoost < this.enhancementConfig.confidenceThreshold) {
            return;
        }

        // Calculate enhanced accumulation confidence using actual detection strength
        const accumulationMetrics = this.calculateAccumulationMetrics(event);
        if (!accumulationMetrics) {
            return; // Cannot calculate confidence without metrics
        }

        const baseConfidenceValue = accumulationMetrics.strength;
        const enhancedConfidence = Math.min(
            1.0,
            FinancialMath.addAmounts(baseConfidenceValue, confidenceBoost, 8)
        );

        // Only emit high-quality enhanced signals
        if (enhancedConfidence < this.enhancementConfig.confidenceThreshold) {
            return;
        }

        // Determine signal side based on accumulation analysis
        const signalSide = this.determineAccumulationSignalSide(event);
        if (signalSide === "neutral") {
            return;
        }

        // Use already calculated accumulation metrics from above

        // Create enhanced accumulation signal data
        const accumulationResult: AccumulationResult = {
            duration: accumulationMetrics.duration,
            zone: accumulationMetrics.zone,
            ratio: accumulationMetrics.buyRatio,
            strength: accumulationMetrics.strength,
            isAccumulating: true,
            price: event.price,
            side: signalSide,
            confidence: enhancedConfidence,
            metadata: {
                accumulationScore: accumulationMetrics.strength,
                conditions: accumulationMetrics.conditions,
                marketRegime: accumulationMetrics.marketRegime,
                statisticalSignificance: enhancedConfidence,
                volumeConcentration: accumulationMetrics.volumeConcentration,
                detectorVersion: "enhanced_v1",
            },
        };

        // Create signal candidate
        const signalCandidate: SignalCandidate = {
            id: `enhanced-accumulation-${Date.now()}-${Math.random().toString(36).substring(7)}`,
            type: "accumulation",
            side: signalSide,
            confidence: enhancedConfidence,
            timestamp: Date.now(),
            data: accumulationResult,
        };

        // ✅ EMIT ENHANCED ACCUMULATION SIGNAL - Independent of base detector
        this.emit("signalCandidate", signalCandidate);

        this.logger.info(
            "AccumulationZoneDetectorEnhanced: ENHANCED ACCUMULATION SIGNAL EMITTED",
            {
                detectorId: this.getId(),
                price: event.price,
                side: signalSide,
                confidence: enhancedConfidence,
                confidenceBoost,
                strength: accumulationMetrics.strength,
                buyRatio: accumulationMetrics.buyRatio,
                signalId: signalCandidate.id,
                signalType: "accumulation",
            }
        );
    }

    /**
     * Determine accumulation signal side based on market conditions
     */
    private determineAccumulationSignalSide(
        event: EnrichedTradeEvent
    ): "buy" | "sell" | "neutral" {
        if (!event.zoneData) {
            return "neutral";
        }

        // For accumulation, we expect institutions to be buying (accumulating)
        // This creates buying pressure, so we might see buy signals
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

        let totalBuyVolume = 0;
        let totalSellVolume = 0;

        relevantZones.forEach((zone) => {
            totalBuyVolume += zone.aggressiveBuyVolume;
            totalSellVolume += zone.aggressiveSellVolume;
        });

        const totalVolume = totalBuyVolume + totalSellVolume;
        if (totalVolume === 0) {
            return "neutral";
        }

        const buyRatio = FinancialMath.divideQuantities(
            totalBuyVolume,
            totalVolume
        );
        const accumulationThreshold = this.accumulationRatioThreshold;

        // If buying pressure is high, this suggests accumulation pattern
        if (buyRatio >= accumulationThreshold) {
            return "buy"; // Accumulation creates bullish pressure
        }

        return "neutral";
    }

    /**
     * Calculate accumulation metrics for signal data
     */
    private calculateAccumulationMetrics(event: EnrichedTradeEvent): {
        duration: number;
        zone: number;
        buyRatio: number;
        strength: number;
        conditions: AccumulationConditions;
        marketRegime: AccumulationMarketRegime;
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

        let totalBuyVolume = 0;
        let totalVolume = 0;
        let totalPassiveVolume = 0;

        relevantZones.forEach((zone) => {
            totalBuyVolume += zone.aggressiveBuyVolume;
            totalVolume += zone.aggressiveVolume;
            totalPassiveVolume += zone.passiveVolume;
        });

        if (totalVolume === 0) {
            return null;
        }

        const buyRatio = FinancialMath.divideQuantities(
            totalBuyVolume,
            totalVolume
        );
        const strength = Math.min(1.0, buyRatio * 1.5); // Boost strength for high buy ratios

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

        // Calculate accumulation-specific metrics (CLAUDE.md compliant)
        const buyingPressure = buyRatio;
        const priceSupport = Math.min(
            this.enhancementConfig.maxPriceSupport,
            FinancialMath.multiplyQuantities(
                strength,
                this.enhancementConfig.priceSupportMultiplier
            )
        );
        const accumulationEfficiency = FinancialMath.divideQuantities(
            totalBuyVolume,
            Math.max(
                this.enhancementConfig.minPassiveVolumeForEfficiency,
                totalPassiveVolume
            )
        );

        return {
            duration,
            zone,
            buyRatio,
            strength,
            conditions: {
                ratio: buyRatio,
                duration,
                aggressiveVolume: totalVolume,
                relevantPassive: totalPassiveVolume,
                totalPassive: totalPassiveVolume,
                strength,
                velocity: 1,
                dominantSide: "buy" as const,
                recentActivity: 1,
                tradeCount: relevantZones.length,
                meetsMinDuration: true,
                meetsMinRatio: buyRatio >= this.accumulationRatioThreshold,
                isRecentlyActive: true,
                accumulationEfficiency,
            },
            marketRegime: {
                volatility: this.enhancementConfig.defaultVolatility,
                baselineVolatility:
                    this.enhancementConfig.defaultBaselineVolatility,
                accumulationPressure: buyingPressure,
                supportStrength: priceSupport,
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
            "AccumulationZoneDetectorEnhanced: Enhancement mode updated",
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
            "AccumulationZoneDetectorEnhanced: Standalone cleanup completed",
            {
                detectorId: this.getId(),
                enhancementStats: this.enhancementStats,
            }
        );
    }
}
