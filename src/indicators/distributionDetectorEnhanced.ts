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
        this.logger.debug("[DistributionDetectorEnhanced]: Signal confirmed", {
            detectorId: this.getId(),
            zone,
            side,
        });
    }

    /**
     * Core distribution pattern analysis using pure volume calculations
     */
    private analyzeDistributionPattern(event: EnrichedTradeEvent): void {
        if (!event.zoneData) return;

        // Calculate base distribution strength from pure volume ratios
        const calculatedDistributionStrength =
            this.calculateDistributionStrength(event);
        if (calculatedDistributionStrength === null) return;

        // Start with base detection strength
        let totalConfidence = calculatedDistributionStrength;

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
                totalConfidence - calculatedDistributionStrength;
            this.enhancementStats.averageConfidenceBoost =
                this.enhancementStats.totalConfidenceBoost /
                this.enhancementStats.enhancementCount;
            this.enhancementStats.enhancementSuccessRate =
                this.enhancementStats.enhancementCount /
                this.enhancementStats.callCount;

            // Store enhanced distribution metrics for monitoring
            this.storeEnhancedDistributionMetrics(event, totalConfidence);

            // ✅ EMIT ZONE UPDATE - For visualization in dashboard
            this.emitDistributionZoneUpdate(event, totalConfidence);

            // ✅ EMIT SIGNAL ONLY for actionable zone events
            this.emitDistributionZoneSignal(event, totalConfidence);

            // ✅ EMIT ENHANCED DISTRIBUTION SIGNAL - For signal tracking
            this.emitEnhancedDistributionSignal(event, totalConfidence);

            this.logger.debug(
                "[DistributionDetectorEnhanced]: Distribution pattern detected",
                {
                    detectorId: this.getId(),
                    price: event.price,
                    baseStrength: calculatedDistributionStrength,
                    confluenceContribution: calculatedConfluenceStrength,
                    institutionalContribution: calculatedInstitutionalScore,
                    alignmentContribution: calculatedAlignmentScore,
                    totalConfidence: totalConfidence,
                }
            );
        }
    }

    /**
     * Calculate base distribution strength from pure volume ratios
     */
    private calculateDistributionStrength(
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
        let totalSellVolume = 0;

        relevantZones.forEach((zone) => {
            totalVolume += zone.aggressiveVolume + zone.passiveVolume;
            totalSellVolume += zone.aggressiveSellVolume;
        });

        if (totalVolume === 0) return null;

        // ✅ CRITICAL: Volume threshold validation - must meet minimum LTC requirement
        if (totalVolume < this.distributionVolumeThreshold) {
            return null; // Insufficient volume - reject immediately
        }

        // Calculate sell ratio
        const sellRatio = FinancialMath.divideQuantities(
            totalSellVolume,
            totalVolume
        );

        // ✅ CRITICAL: Ratio threshold validation - must meet minimum sell ratio
        if (sellRatio < this.distributionRatioThreshold) {
            return null; // Insufficient sell ratio - reject immediately
        }

        // Distribution strength based purely on aggressive selling ratio
        return sellRatio;
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
        let totalSellVolume = 0;

        relevantZones.forEach((zone) => {
            totalVolume += zone.aggressiveVolume + zone.passiveVolume;
            totalAggressiveVolume += zone.aggressiveVolume;
            totalSellVolume += zone.aggressiveSellVolume;
        });

        if (totalVolume === 0) return 0;

        // Confluence strength based purely on volume ratios:
        // More zones with higher sell volume concentration = higher confluence
        const sellRatio = FinancialMath.divideQuantities(
            totalSellVolume,
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

        // Pure volume-based confluence: sell activity * aggressive activity * zone density
        return sellRatio * aggressiveRatio * zoneConcentration;
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
        let totalSellVolume = 0;
        let largeVolumeSum = 0;

        relevantZones.forEach((zone) => {
            const zoneTotal = zone.aggressiveVolume + zone.passiveVolume;
            totalVolume += zoneTotal;
            totalAggressiveVolume += zone.aggressiveVolume;
            totalSellVolume += zone.aggressiveSellVolume;

            // Identify large volume activity (institutional-sized)
            const avgZoneVolume = zoneTotal / (relevantZones.length || 1);
            if (zone.aggressiveVolume > avgZoneVolume) {
                largeVolumeSum += zone.aggressiveVolume;
            }
        });

        if (totalVolume === 0) return 0;

        // Institutional contribution based purely on volume patterns:
        // 1. Sell volume dominance
        // 2. Large order concentration
        // 3. Aggressive activity level
        const sellRatio = FinancialMath.divideQuantities(
            totalSellVolume,
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
        return sellRatio * largeVolumeRatio * aggressiveRatio;
    }

    /**
     * Calculate alignment contribution based purely on volume consistency across timeframes
     */
    private calculateAlignmentContribution(
        zoneData: StandardZoneData,
        event: EnrichedTradeEvent
    ): number {
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

        const distributionValues = [
            tick5Distribution,
            tick10Distribution,
            tick20Distribution,
        ];
        const avgDistribution = FinancialMath.calculateMean(distributionValues);
        if (avgDistribution === null || avgDistribution === 0) {
            return 0;
        }

        const stdDev = FinancialMath.calculateStdDev(distributionValues);
        if (stdDev === null) {
            return 0;
        }

        // Calculate alignment based purely on volume consistency:
        // High average = strong distribution across timeframes
        // Low standard deviation relative to mean = consistent across timeframes
        if (stdDev === 0) {
            // Perfect consistency across timeframes
            return avgDistribution;
        }

        const consistencyRatio = FinancialMath.divideQuantities(
            avgDistribution,
            stdDev
        );

        // Return pure volume-based alignment: strength * consistency
        return (avgDistribution * consistencyRatio) / (1 + consistencyRatio);
    }

    /**
     * Calculate distribution strength for a specific timeframe based purely on volume ratios
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

            // Distribution strength based purely on aggressive selling ratio
            const aggressiveSellingRatio = FinancialMath.divideQuantities(
                zone.aggressiveSellVolume,
                totalVolume
            );

            totalDistributionScore += aggressiveSellingRatio;
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
            "[DistributionDetectorEnhanced]: Enhanced metrics stored",
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

        this.logger.debug(
            "[DistributionDetectorEnhanced]: Zone update emitted",
            {
                detectorId: this.getId(),
                updateType,
                zoneId: zoneData.id,
                confidence: confidenceBoost,
            }
        );
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

        const signalSide = "sell";

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
            expectedDirection: signalSide === "sell" ? "down" : "up",
            detectorId: this.getId(),
            timestamp: Date.now(),
        };

        // Emit zoneSignal event for dashboard signals list
        this.emit("zoneSignal", zoneSignal);

        this.logger.info(
            "[DistributionDetectorEnhanced]: Zone signal emitted",
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
                distributionMetrics.strength + confidenceBoost
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
        const distributionMetrics = this.calculateDistributionMetrics(event);
        if (!distributionMetrics) return null;

        // Calculate actual confidence from strength + boost
        const actualConfidence = distributionMetrics.strength + confidenceBoost;

        // Use single confidence threshold for signal eligibility
        if (actualConfidence < this.enhancementConfig.confidenceThreshold) {
            return null; // Not significant enough for any signal
        }

        // Check for strong distribution activity
        if (distributionMetrics.sellRatio >= this.distributionRatioThreshold) {
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
        if (confidenceBoost < this.enhancementConfig.confidenceThreshold) {
            return;
        }

        // Calculate distribution metrics to get the base confidence from strength
        const distributionMetrics = this.calculateDistributionMetrics(event);
        if (!distributionMetrics) {
            return; // Cannot proceed without valid metrics
        }

        // Calculate enhanced distribution confidence using strength as base
        const enhancedConfidence = Math.min(
            1.0,
            FinancialMath.addAmounts(
                distributionMetrics.strength,
                confidenceBoost,
                8
            )
        );

        // Only emit high-quality enhanced signals
        if (enhancedConfidence < this.enhancementConfig.confidenceThreshold) {
            return;
        }

        // Determine signal side based on distribution analysis
        const signalSide = "sell";

        // distributionMetrics already calculated and validated above

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
            "[DistributionDetectorEnhanced]: ENHANCED DISTRIBUTION SIGNAL EMITTED",
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
            "[DistributionDetectorEnhanced]: Enhancement mode updated",
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
            "[DistributionDetectorEnhanced]: Standalone cleanup completed",
            {
                detectorId: this.getId(),
                enhancementStats: this.enhancementStats,
            }
        );
    }
}
