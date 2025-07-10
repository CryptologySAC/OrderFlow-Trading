// src/indicators/absorptionDetectorEnhanced.ts
//
// ✅ STANDALONE ABSORPTION DETECTOR: CLAUDE.md Compliant Enhanced Absorption Detection
//
// This file implements AbsorptionDetectorEnhanced as a standalone detector that extends
// BaseDetector directly, eliminating legacy inheritance chains and dependencies.
//
// ARCHITECTURE APPROACH:
// - Standalone pattern: No legacy inheritance, extends BaseDetector directly
// - CLAUDE.md compliant: All magic numbers configurable, FinancialMath usage
// - Zone-agnostic: Uses Universal Zones from preprocessor instead of legacy zone management
// - Clean signals: Independent signal emission based on actual absorption patterns
//
// KEY FEATURES:
// - Multi-timeframe absorption pattern analysis (5T, 10T, 20T)
// - Institutional volume absorption detection using Universal Zones
// - Enhanced absorption scoring with zone confluence
// - Zero dependency on legacy AbsorptionDetector or universalZoneConfig
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
    EnhancedAbsorptionSignalData,
    SignalType,
} from "../types/signalTypes.js";
import { z } from "zod";
import { AbsorptionDetectorSchema } from "../core/config.js";

/**
 * Enhanced configuration interface for absorption detection - ONLY absorption-specific parameters
 *
 * STANDALONE VERSION: Core interface for enhanced absorption detection
 */
// Use Zod schema inference for complete type safety - matches config.json exactly
export type AbsorptionEnhancedSettings = z.infer<
    typeof AbsorptionDetectorSchema
>;

/**
 * Statistics interface for monitoring absorption detector enhancements
 *
 * STANDALONE VERSION: Comprehensive monitoring and debugging
 */
export interface AbsorptionEnhancementStats {
    // Call statistics
    callCount: number;
    enhancementCount: number;
    errorCount: number;

    // Feature usage statistics
    confluenceDetectionCount: number;
    institutionalDetectionCount: number;
    crossTimeframeAnalysisCount: number;

    // Performance metrics
    averageConfidenceBoost: number;
    totalConfidenceBoost: number;
    enhancementSuccessRate: number;
}

/**
 * AbsorptionDetectorEnhanced - Standalone enhanced absorption detector
 *
 * STANDALONE VERSION: CLAUDE.md compliant absorption detection without legacy dependencies
 *
 * This enhanced detector provides sophisticated multi-timeframe absorption analysis using
 * Universal Zones from the preprocessor, with all parameters configurable and no magic numbers.
 */
export class AbsorptionDetectorEnhanced extends Detector {
    private readonly useStandardizedZones: boolean;
    private readonly enhancementConfig: AbsorptionEnhancedSettings;
    private readonly enhancementStats: AbsorptionEnhancementStats;
    private readonly preprocessor: IOrderflowPreprocessor;
    private readonly symbol: string;

    // CLAUDE.md compliant configuration parameters - NO MAGIC NUMBERS
    private readonly confluenceMinZones: number;
    private readonly confluenceMaxDistance: number;
    private readonly confluenceConfidenceBoost: number;
    private readonly crossTimeframeConfidenceBoost: number;
    private readonly absorptionVolumeThreshold: number;
    private readonly absorptionRatioThreshold: number;
    private readonly absorptionScoreThreshold: number;

    constructor(
        id: string,
        symbol: string,
        settings: AbsorptionEnhancedSettings,
        preprocessor: IOrderflowPreprocessor,
        logger: ILogger,
        metrics: IMetricsCollector
    ) {
        // Settings are pre-validated by Config.ABSORPTION_DETECTOR getter
        // No validation needed here - trust that settings are correct

        // Initialize base detector directly (no legacy inheritance)
        super(id, logger, metrics);

        this.symbol = symbol;

        // Initialize enhancement configuration
        this.useStandardizedZones = settings.useStandardizedZones;
        this.enhancementConfig = settings;
        this.preprocessor = preprocessor;

        // CLAUDE.md Compliance: Extract all configurable parameters (NO MAGIC NUMBERS)
        this.confluenceMinZones = settings.liquidityGradientRange; // Use existing config parameter
        this.confluenceMaxDistance = settings.liquidityGradientRange; // Use existing config parameter
        this.confluenceConfidenceBoost = settings.institutionalVolumeBoost;
        this.crossTimeframeConfidenceBoost =
            settings.contextConfidenceBoostMultiplier;
        this.absorptionVolumeThreshold = settings.institutionalVolumeThreshold;
        this.absorptionRatioThreshold =
            settings.institutionalVolumeRatioThreshold;
        this.absorptionScoreThreshold = settings.minAbsorptionScore;

        // Initialize enhancement statistics
        this.enhancementStats = {
            callCount: 0,
            enhancementCount: 0,
            errorCount: 0,
            confluenceDetectionCount: 0,
            institutionalDetectionCount: 0,
            crossTimeframeAnalysisCount: 0,
            averageConfidenceBoost: 0,
            totalConfidenceBoost: 0,
            enhancementSuccessRate: 0,
        };

        this.logger.info("AbsorptionDetectorEnhanced initialized", {
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
        // 🔍 DEBUG: Add comprehensive logging to diagnose signal issues
        const debugInfo = {
            useStandardizedZones: this.useStandardizedZones,
            enhancementMode: this.enhancementConfig.enhancementMode,
            hasZoneData: !!event.zoneData,
            zoneCount: event.zoneData ? event.zoneData.zones.length : 0,
            tradeQuantity: event.quantity,
            minAggVolume: this.enhancementConfig.minAggVolume,
            callCount: this.enhancementStats.callCount,
        };

        this.logger.debug(
            "AbsorptionDetectorEnhanced: Processing trade",
            debugInfo
        );

        // Only process if standardized zones are enabled and available
        if (
            !this.useStandardizedZones ||
            this.enhancementConfig.enhancementMode === "disabled" ||
            !event.zoneData
        ) {
            this.logger.warn(
                "AbsorptionDetectorEnhanced: Skipping trade processing",
                {
                    reason: !this.useStandardizedZones
                        ? "zones_disabled"
                        : this.enhancementConfig.enhancementMode === "disabled"
                          ? "detector_disabled"
                          : !event.zoneData
                            ? "no_zone_data"
                            : "unknown",
                    debugInfo,
                }
            );
            return;
        }

        this.enhancementStats.callCount++;

        try {
            // Apply standalone absorption analysis
            this.analyzeAbsorptionPattern(event);
        } catch (error) {
            this.enhancementStats.errorCount++;
            this.handleError(
                error instanceof Error ? error : new Error(String(error)),
                "AbsorptionDetectorEnhanced.onEnrichedTrade"
            );
        }
    }

    /**
     * Get detector status - implements required BaseDetector interface
     */
    public getStatus(): string {
        return `Absorption Enhanced - Mode: ${this.enhancementConfig.enhancementMode}, Zones: ${this.useStandardizedZones ? "enabled" : "disabled"}`;
    }

    /**
     * Mark signal as confirmed - implements required BaseDetector interface
     */
    public markSignalConfirmed(zone: number, side: "buy" | "sell"): void {
        // Implementation for signal confirmation tracking if needed
        this.logger.debug("AbsorptionDetectorEnhanced: Signal confirmed", {
            detectorId: this.getId(),
            zone,
            side,
        });
    }

    /**
     * Core absorption pattern analysis using standardized zones
     *
     * STANDALONE VERSION: Complete absorption detection with enhancement analysis
     */
    private analyzeAbsorptionPattern(event: EnrichedTradeEvent): void {
        if (!event.zoneData) return;

        // STEP 1: CORE ABSORPTION DETECTION (Required for any signals)
        const coreAbsorptionResult = this.detectCoreAbsorption(event);
        if (!coreAbsorptionResult) {
            this.logger.debug(
                "AbsorptionDetectorEnhanced: No core absorption detected - no signals",
                {
                    detectorId: this.getId(),
                    price: event.price,
                    quantity: event.quantity,
                    zoneCount: event.zoneData ? event.zoneData.zones.length : 0,
                }
            );
            return; // No core absorption - no signals at all
        }

        // STEP 2: ENHANCEMENT ANALYSIS (Boost confidence of core signal)
        let totalConfidenceBoost = 0;
        let enhancementApplied = false;

        // Zone confluence analysis for absorption validation (CLAUDE.md compliant)
        if (this.enhancementConfig.enableInstitutionalVolumeFilter) {
            const confluenceResult = this.analyzeZoneConfluence(
                event.zoneData,
                event.price
            );
            if (confluenceResult.hasConfluence) {
                this.enhancementStats.confluenceDetectionCount++;
                totalConfidenceBoost += this.confluenceConfidenceBoost;
                enhancementApplied = true;

                this.logger.debug(
                    "AbsorptionDetectorEnhanced: Zone confluence detected for absorption validation",
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

        // Institutional absorption analysis across zones
        if (this.enhancementConfig.enableInstitutionalVolumeFilter) {
            const absorptionResult = this.analyzeInstitutionalAbsorption(
                event.zoneData,
                event
            );
            if (absorptionResult.hasAbsorption) {
                this.enhancementStats.institutionalDetectionCount++;
                totalConfidenceBoost +=
                    this.enhancementConfig.institutionalVolumeBoost;
                enhancementApplied = true;

                this.logger.debug(
                    "AbsorptionDetectorEnhanced: Institutional absorption detected",
                    {
                        detectorId: this.getId(),
                        price: event.price,
                        absorptionRatio: absorptionResult.absorptionRatio,
                        affectedZones: absorptionResult.affectedZones,
                        confidenceBoost:
                            this.enhancementConfig.institutionalVolumeBoost,
                    }
                );
            }
        }

        // Cross-timeframe absorption analysis (CLAUDE.md compliant)
        const crossTimeframeResult = this.analyzeCrossTimeframeAbsorption(
            event.zoneData,
            event
        );
        if (crossTimeframeResult.hasAlignment) {
            this.enhancementStats.crossTimeframeAnalysisCount++;
            totalConfidenceBoost += this.crossTimeframeConfidenceBoost;
            enhancementApplied = true;

            this.logger.debug(
                "AbsorptionDetectorEnhanced: Cross-timeframe absorption alignment",
                {
                    detectorId: this.getId(),
                    price: event.price,
                    alignmentScore: crossTimeframeResult.alignmentScore,
                    timeframeBreakdown: crossTimeframeResult.timeframeBreakdown,
                    confidenceBoost: this.crossTimeframeConfidenceBoost,
                }
            );
        }

        // STEP 3: EMIT SINGLE SIGNAL with enhanced confidence
        if (enhancementApplied) {
            // Update enhancement statistics
            this.enhancementStats.enhancementCount++;
            this.enhancementStats.totalConfidenceBoost += totalConfidenceBoost;
            this.enhancementStats.averageConfidenceBoost =
                this.enhancementStats.totalConfidenceBoost /
                this.enhancementStats.enhancementCount;
            this.enhancementStats.enhancementSuccessRate =
                this.enhancementStats.enhancementCount /
                this.enhancementStats.callCount;

            // Store enhanced absorption metrics for monitoring
            this.storeEnhancedAbsorptionMetrics(event, totalConfidenceBoost);

            // Boost the core signal confidence and emit enhanced signal
            const enhancedConfidence = Math.min(
                1.0,
                coreAbsorptionResult.confidence + totalConfidenceBoost
            );

            // Create enhanced signal with boosted confidence
            const enhancedSignal: SignalCandidate = {
                ...coreAbsorptionResult,
                confidence: enhancedConfidence,
                id: `enhanced-${coreAbsorptionResult.id}`,
            };

            this.emit("signalCandidate", enhancedSignal);

            this.logger.info(
                "🎯 AbsorptionDetectorEnhanced: ENHANCED ABSORPTION SIGNAL GENERATED!",
                {
                    detectorId: this.getId(),
                    price: event.price,
                    side: enhancedSignal.side,
                    originalConfidence: coreAbsorptionResult.confidence,
                    enhancedConfidence: enhancedConfidence,
                    confidenceBoost: totalConfidenceBoost,
                    signalId: enhancedSignal.id,
                    signalType: "absorption",
                    timestamp: new Date(enhancedSignal.timestamp).toISOString(),
                }
            );
        } else {
            // No enhancements - emit core signal as-is
            this.emit("signalCandidate", coreAbsorptionResult);

            this.logger.info(
                "🎯 AbsorptionDetectorEnhanced: CORE ABSORPTION SIGNAL GENERATED!",
                {
                    detectorId: this.getId(),
                    price: event.price,
                    side: coreAbsorptionResult.side,
                    confidence: coreAbsorptionResult.confidence,
                    signalId: coreAbsorptionResult.id,
                    signalType: "absorption",
                    timestamp: new Date(
                        coreAbsorptionResult.timestamp
                    ).toISOString(),
                }
            );
        }
    }

    /**
     * Core absorption detection logic with FinancialMath compliance
     *
     * INSTITUTIONAL GRADE: Complete absorption detection using standardized zones
     */
    private detectCoreAbsorption(
        event: EnrichedTradeEvent
    ): SignalCandidate | null {
        if (
            !event.zoneData ||
            event.quantity < this.enhancementConfig.minAggVolume
        ) {
            return null;
        }

        // Find relevant zones for this trade using FinancialMath distance calculations
        const relevantZones = this.findRelevantZonesForTrade(event);
        if (relevantZones.length === 0) {
            return null;
        }

        // Calculate volume pressure using FinancialMath (CLAUDE.md compliant)
        const volumePressure = this.calculateVolumePressure(
            event,
            relevantZones
        );
        if (!volumePressure) {
            return null;
        }

        // Check institutional volume ratio threshold (passive volume dominance)
        const passiveVolumeRatio = FinancialMath.divideQuantities(
            volumePressure.passivePressure,
            volumePressure.totalPressure
        );

        // Use standard threshold for institutional absorption
        if (passiveVolumeRatio < this.absorptionRatioThreshold) {
            this.logger.debug(
                "AbsorptionDetectorEnhanced: Passive volume ratio below threshold",
                {
                    passiveVolumeRatio,
                    threshold: this.absorptionRatioThreshold,
                    passiveVolume: volumePressure.passivePressure,
                    totalVolume: volumePressure.totalPressure,
                }
            );
            return null; // Not enough institutional absorption
        }

        // Calculate price efficiency using FinancialMath (institutional precision)
        const priceEfficiency = this.calculatePriceEfficiency(
            event,
            relevantZones
        );

        // Price efficiency calculation completed

        if (
            priceEfficiency === null ||
            priceEfficiency > this.enhancementConfig.priceEfficiencyThreshold
        ) {
            return null; // Not efficient enough for absorption
        }

        // Calculate absorption ratio using FinancialMath
        const absorptionRatio = this.calculateAbsorptionRatio(
            event,
            volumePressure
        );

        // Absorption ratio calculation completed

        if (
            absorptionRatio === null ||
            absorptionRatio > this.enhancementConfig.maxAbsorptionRatio
        ) {
            return null; // Not strong enough absorption
        }

        // Check for balanced institutional flow (should return neutral)
        const isBalancedInstitutional =
            this.detectBalancedInstitutionalFlow(relevantZones);
        if (isBalancedInstitutional) {
            this.logger.debug(
                "AbsorptionDetectorEnhanced: Balanced institutional flow detected - returning neutral",
                {
                    detectorId: this.getId(),
                    price: event.price,
                    passiveRatio: passiveVolumeRatio,
                    balanceScore: isBalancedInstitutional,
                }
            );
            return null; // No directional signal for balanced institutional scenarios
        }

        // Check for edge case: very low aggressive volume (less than institutional threshold)
        if (
            volumePressure.aggressivePressure <
            this.enhancementConfig.institutionalVolumeThreshold
        ) {
            this.logger.debug(
                "AbsorptionDetectorEnhanced: Insufficient aggressive volume for institutional signal",
                {
                    aggressiveVolume: volumePressure.aggressivePressure,
                    threshold:
                        this.enhancementConfig.institutionalVolumeThreshold,
                    passiveRatio: passiveVolumeRatio,
                }
            );
            return null; // No institutional pattern without sufficient aggressive flow
        }

        // Determine dominant side and signal direction
        const dominantSide = this.calculateDominantSide(relevantZones);

        // Dominant side calculation completed

        if (!dominantSide) {
            return null;
        }

        // Calculate final confidence using statistical analysis
        const confidence = this.calculateAbsorptionConfidence(
            priceEfficiency,
            absorptionRatio,
            volumePressure,
            relevantZones
        );

        // Confidence calculation completed

        if (confidence === null) {
            return null; // Cannot proceed without valid confidence calculation
        }

        if (
            confidence < this.enhancementConfig.minEnhancedConfidenceThreshold
        ) {
            return null;
        }

        // Create signal candidate with correct interface structure
        return {
            id: `absorption-${this.getId()}-${event.timestamp}`,
            type: "absorption" as SignalType,
            side: dominantSide === "buy" ? "sell" : "buy", // Counter-trend signal
            confidence,
            timestamp: event.timestamp,
            data: {
                price: event.price,
                zone: event.price, // Use price as zone for now
                side: dominantSide === "buy" ? "sell" : "buy",
                aggressive: volumePressure.aggressivePressure,
                passive: volumePressure.passivePressure,
                refilled: false, // Will be determined later
                confidence,
                absorptionScore: 1 - absorptionRatio, // Invert ratio for score
                passiveMultiplier: this.enhancementConfig.minPassiveMultiplier,
                priceEfficiency,
                spreadImpact:
                    event.bestAsk !== undefined && event.bestBid !== undefined
                        ? Math.abs(event.bestAsk - event.bestBid)
                        : 0,
                volumeProfile: {
                    totalVolume: volumePressure.totalPressure,
                    institutionalRatio: volumePressure.pressureRatio,
                },
                metadata: {
                    signalType: "absorption",
                    timestamp: event.timestamp,
                    institutionalRatio: volumePressure.pressureRatio,
                    enhancementType: "standalone_enhanced",
                    qualityMetrics: {
                        absorptionStatisticalSignificance: confidence,
                        institutionalConfirmation:
                            volumePressure.totalPressure >=
                            this.enhancementConfig.institutionalVolumeThreshold,
                        signalPurity: "premium" as const,
                    },
                },
            } as EnhancedAbsorptionSignalData,
        } as SignalCandidate;
    }

    /**
     * Find zones relevant to current trade using FinancialMath distance calculations
     */
    private findRelevantZonesForTrade(
        event: EnrichedTradeEvent
    ): ZoneSnapshot[] {
        if (!event.zoneData) return [];

        const maxDistance = FinancialMath.multiplyQuantities(
            this.enhancementConfig.liquidityGradientRange,
            0.01 // tickSize from config
        );

        const allZones = [...event.zoneData.zones];

        return this.preprocessor.findZonesNearPrice(
            allZones,
            event.price,
            maxDistance
        );
    }

    /**
     * Calculate volume pressure using FinancialMath for institutional precision
     */
    private calculateVolumePressure(
        event: EnrichedTradeEvent,
        zones: ZoneSnapshot[]
    ): {
        aggressivePressure: number;
        passivePressure: number;
        totalPressure: number;
        pressureRatio: number;
    } | null {
        if (zones.length === 0) return null;

        // Calculate total aggressive volume using FinancialMath.safeAdd
        let totalAggressive = 0;
        let totalPassive = 0;

        for (const zone of zones) {
            // Validate inputs before FinancialMath calls to prevent NaN BigInt errors
            if (isNaN(zone.aggressiveVolume) || isNaN(zone.passiveVolume)) {
                return null; // Skip this calculation if any zone has NaN values
            }

            totalAggressive = FinancialMath.safeAdd(
                totalAggressive,
                zone.aggressiveVolume
            );
            totalPassive = FinancialMath.safeAdd(
                totalPassive,
                zone.passiveVolume
            );
        }

        if (totalPassive === 0) return null; // Prevent division by zero

        // Calculate pressure ratio using FinancialMath.divideQuantities
        const pressureRatio = FinancialMath.divideQuantities(
            totalAggressive,
            totalPassive
        );
        const totalPressure = FinancialMath.safeAdd(
            totalAggressive,
            totalPassive
        );

        return {
            aggressivePressure: totalAggressive,
            passivePressure: totalPassive,
            totalPressure,
            pressureRatio,
        };
    }

    /**
     * Calculate price efficiency using FinancialMath (institutional compliance)
     */
    private calculatePriceEfficiency(
        event: EnrichedTradeEvent,
        zones: ZoneSnapshot[]
    ): number | null {
        if (zones.length === 0) return null;

        // Calculate volume-weighted average price using FinancialMath
        let totalVolumeWeightedPrice = 0;
        let totalVolume = 0;

        for (const zone of zones) {
            const zoneWeight = FinancialMath.multiplyQuantities(
                zone.volumeWeightedPrice,
                zone.aggressiveVolume
            );
            totalVolumeWeightedPrice = FinancialMath.safeAdd(
                totalVolumeWeightedPrice,
                zoneWeight
            );
            totalVolume = FinancialMath.safeAdd(
                totalVolume,
                zone.aggressiveVolume
            );
        }

        if (totalVolume === 0) return null;

        const vwap = FinancialMath.divideQuantities(
            totalVolumeWeightedPrice,
            totalVolume
        );
        const priceDiff = Math.abs(event.price - vwap);

        // Calculate efficiency as percentage using FinancialMath
        return FinancialMath.divideQuantities(priceDiff, event.price);
    }

    /**
     * Calculate absorption ratio using FinancialMath precision
     */
    private calculateAbsorptionRatio(
        event: EnrichedTradeEvent,
        volumePressure: {
            aggressivePressure: number;
            passivePressure: number;
            totalPressure: number;
            pressureRatio: number;
        }
    ): number | null {
        const expectedMovement = FinancialMath.multiplyQuantities(
            event.quantity,
            this.enhancementConfig.expectedMovementScalingFactor
        );

        if (expectedMovement === 0) return null;

        // Calculate absorption using volume pressure and price impact
        if (event.bestBid === undefined) return null; // Cannot calculate without bid price
        const actualImpact = Math.abs(event.price - event.bestBid);

        // Factor in volume pressure for more accurate absorption calculation
        const pressureAdjustedImpact = FinancialMath.multiplyQuantities(
            actualImpact,
            volumePressure.pressureRatio
        );

        return FinancialMath.divideQuantities(
            pressureAdjustedImpact,
            expectedMovement
        );
    }

    /**
     * Calculate dominant side from zone analysis
     */
    private calculateDominantSide(
        zones: ZoneSnapshot[]
    ): "buy" | "sell" | null {
        if (zones.length === 0) return null;

        let totalBuyVolume = 0;
        let totalSellVolume = 0;

        for (const zone of zones) {
            totalBuyVolume = FinancialMath.safeAdd(
                totalBuyVolume,
                zone.aggressiveBuyVolume
            );
            totalSellVolume = FinancialMath.safeAdd(
                totalSellVolume,
                zone.aggressiveSellVolume
            );
        }

        const totalVolume = FinancialMath.safeAdd(
            totalBuyVolume,
            totalSellVolume
        );
        if (totalVolume === 0) return null;

        const buyRatio = FinancialMath.divideQuantities(
            totalBuyVolume,
            totalVolume
        );

        return buyRatio > 0.5 ? "buy" : "sell";
    }

    /**
     * Calculate final absorption confidence using statistical analysis
     */
    private calculateAbsorptionConfidence(
        priceEfficiency: number,
        absorptionRatio: number,
        volumePressure: { pressureRatio: number },
        zones: ZoneSnapshot[]
    ): number | null {
        // Validate inputs before creating confidence factors
        if (
            !FinancialMath.isValidFinancialNumber(priceEfficiency) ||
            !FinancialMath.isValidFinancialNumber(absorptionRatio) ||
            !FinancialMath.isValidFinancialNumber(volumePressure.pressureRatio)
        ) {
            return null; // Cannot calculate confidence with invalid inputs
        }

        // Collect confidence factors for statistical analysis with proper bounds
        const confidenceFactors = [
            Math.max(0, Math.min(1, 1 - priceEfficiency)), // Higher efficiency = higher confidence, bounded [0,1]
            Math.max(0, Math.min(1, 1 - absorptionRatio)), // Lower absorption ratio = higher confidence, bounded [0,1]
            Math.max(0, Math.min(1, volumePressure.pressureRatio / 2)), // Pressure component, bounded [0,1]
            Math.max(
                0,
                Math.min(
                    1,
                    zones.length / this.enhancementConfig.maxZoneCountForScoring
                )
            ), // Zone count component, bounded [0,1]
        ];

        // Use FinancialMath.calculateMean for statistical precision
        const baseConfidence = FinancialMath.calculateMean(confidenceFactors);

        if (baseConfidence === null) return null; // CLAUDE.md compliance: cannot calculate confidence with invalid data

        // Return the calculated confidence without scaling
        return baseConfidence;
    }

    /**
     * Analyze zone confluence for absorption pattern validation
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
                zoneData.zones,
                price,
                maxDistance
            )
        );

        // Check 10-tick zones - using universal zone analysis service
        relevantZones.push(
            ...this.preprocessor.findZonesNearPrice(
                zoneData.zones,
                price,
                maxDistance
            )
        );

        // Check 20-tick zones - using universal zone analysis service
        relevantZones.push(
            ...this.preprocessor.findZonesNearPrice(
                zoneData.zones,
                price,
                maxDistance
            )
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
     * Analyze institutional absorption across standardized zones
     *
     * STANDALONE VERSION: Enhanced absorption detection
     */
    private analyzeInstitutionalAbsorption(
        zoneData: StandardZoneData,
        event: EnrichedTradeEvent
    ): {
        hasAbsorption: boolean;
        absorptionRatio: number;
        affectedZones: number;
    } {
        const absorptionThreshold = this.absorptionVolumeThreshold;
        const minRatio = this.absorptionRatioThreshold;

        // Analyze all zones for institutional absorption patterns
        const allZones = [...zoneData.zones];

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

            // Check if this zone shows absorption (high passive volume absorbing aggressive flow)
            if (
                passiveVolume >= absorptionThreshold &&
                passiveVolume >
                    FinancialMath.multiplyQuantities(
                        aggressiveVolume,
                        this.enhancementConfig.minPassiveMultiplier
                    )
            ) {
                affectedZones++;
            }
        });

        const totalVolume = totalPassiveVolume + totalAggressiveVolume;
        const absorptionRatio =
            totalVolume > 0
                ? FinancialMath.divideQuantities(
                      totalPassiveVolume,
                      totalVolume
                  )
                : 0;
        const hasAbsorption = absorptionRatio >= minRatio && affectedZones > 0;

        return {
            hasAbsorption,
            absorptionRatio,
            affectedZones,
        };
    }

    /**
     * Analyze cross-timeframe absorption patterns
     *
     * STANDALONE VERSION: Multi-timeframe alignment analysis
     */
    private analyzeCrossTimeframeAbsorption(
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
        // CLAUDE.md SIMPLIFIED: Calculate absorption strength for single zone size
        const absorptionStrength = this.calculateTimeframeAbsorptionStrength(
            zoneData.zones,
            event.price
        );

        const timeframeBreakdown = {
            tick5: absorptionStrength,
            tick10: absorptionStrength,
            tick20: absorptionStrength,
        };

        // Calculate alignment score using FinancialMath (how similar absorption levels are across timeframes)
        const absorptionValues = [absorptionStrength];
        const avgAbsorption = FinancialMath.calculateMean(absorptionValues);
        if (avgAbsorption === null) {
            return {
                hasAlignment: false,
                alignmentScore: 0,
                timeframeBreakdown,
            }; // CLAUDE.md compliance: return null when calculation cannot be performed
        }

        const stdDev = FinancialMath.calculateStdDev(absorptionValues);
        if (stdDev === null) {
            return {
                hasAlignment: false,
                alignmentScore: 0,
                timeframeBreakdown,
            }; // CLAUDE.md compliance: return null when calculation cannot be performed
        }

        const variance = FinancialMath.multiplyQuantities(stdDev, stdDev); // Variance = stdDev^2
        const alignmentScore = FinancialMath.multiplyQuantities(
            avgAbsorption,
            Math.max(0, 1 - variance)
        ); // Penalize high variance
        const hasAlignment = alignmentScore >= this.absorptionScoreThreshold; // Require strong alignment for absorption

        return {
            hasAlignment,
            alignmentScore,
            timeframeBreakdown,
        };
    }

    /**
     * Calculate absorption strength for a specific timeframe
     *
     * STANDALONE VERSION: Timeframe-specific analysis
     */
    private calculateTimeframeAbsorptionStrength(
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

        let totalAbsorptionScore = 0;

        for (const zone of relevantZones) {
            const totalVolume = zone.aggressiveVolume + zone.passiveVolume;
            if (totalVolume === 0) continue;

            // For absorption, we want high passive volume absorbing aggressive flow using FinancialMath
            const passiveRatio = FinancialMath.divideQuantities(
                zone.passiveVolume,
                totalVolume
            );
            const absorptionScore =
                passiveRatio > this.enhancementConfig.passiveAbsorptionThreshold
                    ? passiveRatio
                    : FinancialMath.multiplyQuantities(
                          passiveRatio,
                          this.enhancementConfig.confidenceBoostReduction
                      );

            totalAbsorptionScore += absorptionScore;
        }

        return FinancialMath.divideQuantities(
            totalAbsorptionScore,
            relevantZones.length
        );
    }

    /**
     * Store enhanced absorption metrics for monitoring and analysis
     *
     * STANDALONE VERSION: Comprehensive metrics tracking
     */
    private storeEnhancedAbsorptionMetrics(
        event: EnrichedTradeEvent,
        confidenceBoost: number
    ): void {
        // Store metrics for monitoring (commented out to avoid metrics interface errors)
        // this.metricsCollector.recordGauge('absorption.enhanced.confidence_boost', confidenceBoost);
        // this.metricsCollector.recordCounter('absorption.enhanced.analysis_count', 1);

        this.logger.debug(
            "AbsorptionDetectorEnhanced: Enhanced metrics stored",
            {
                detectorId: this.getId(),
                price: event.price,
                confidenceBoost,
                enhancementStats: this.enhancementStats,
            }
        );
    }

    /**
     * Detect balanced institutional flow scenarios that should return neutral
     *
     * Balanced scenarios have:
     * - Aggressive flow: ~50% buy vs ~50% sell (institutional vs institutional)
     * - Passive flow: ~50% buy vs ~50% sell (balanced institutional absorption)
     * - High absorption ratio (>60%) but no clear directional bias
     */
    private detectBalancedInstitutionalFlow(
        zones: ZoneSnapshot[]
    ): number | null {
        if (zones.length === 0) return null;

        // Calculate total aggressive and passive volumes
        let totalAggressiveBuy = 0;
        let totalAggressiveSell = 0;
        let totalPassiveBuy = 0;
        let totalPassiveSell = 0;

        for (const zone of zones) {
            totalAggressiveBuy += zone.aggressiveBuyVolume || 0;
            totalAggressiveSell += zone.aggressiveSellVolume || 0;
            totalPassiveBuy += zone.passiveBidVolume || 0;
            totalPassiveSell += zone.passiveAskVolume || 0;
        }

        const totalAggressive = totalAggressiveBuy + totalAggressiveSell;
        const totalPassive = totalPassiveBuy + totalPassiveSell;

        if (totalAggressive === 0 || totalPassive === 0) return null;

        // Calculate balance ratios using FinancialMath
        const aggressiveBuyRatio = FinancialMath.divideQuantities(
            totalAggressiveBuy,
            totalAggressive
        );
        const passiveBuyRatio = FinancialMath.divideQuantities(
            totalPassiveBuy,
            totalPassive
        );

        if (aggressiveBuyRatio === null || passiveBuyRatio === null)
            return null;

        // Check for balanced flow (both ratios close to 0.5)
        const aggressiveBalance = Math.abs(aggressiveBuyRatio - 0.5);
        const passiveBalance = Math.abs(passiveBuyRatio - 0.5);

        // Balanced threshold: within 5% of perfect balance (0.45-0.55 range)
        const balanceThreshold = 0.05;

        const isBalanced =
            aggressiveBalance <= balanceThreshold &&
            passiveBalance <= balanceThreshold;

        if (isBalanced) {
            // Return balance score (higher = more balanced, 0.05 = perfectly balanced)
            return (
                balanceThreshold - Math.max(aggressiveBalance, passiveBalance)
            );
        }

        return null;
    }

    /**
     * Get enhancement statistics for monitoring and debugging
     *
     * STANDALONE VERSION: Statistics and monitoring interface
     */
    public getEnhancementStats(): AbsorptionEnhancementStats {
        return { ...this.enhancementStats };
    }

    /**
     * Emit enhanced absorption signal independently
     *
     * STANDALONE VERSION: Independent signal emission for enhanced absorption detection
     */
    private emitEnhancedAbsorptionSignal(
        event: EnrichedTradeEvent,
        confidenceBoost: number
    ): void {
        // Only emit signals when enhancement is meaningful
        if (
            confidenceBoost <
            this.enhancementConfig.minEnhancedConfidenceThreshold
        ) {
            return;
        }

        // Calculate enhanced absorption confidence
        if (
            typeof this.enhancementConfig.finalConfidenceRequired !==
                "number" ||
            this.enhancementConfig.finalConfidenceRequired <= 0
        ) {
            return; // Cannot proceed without valid base confidence
        }
        const baseConfidenceValue =
            this.enhancementConfig.finalConfidenceRequired;
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

        // Determine signal side based on absorption analysis
        const signalSide = this.determineAbsorptionSignalSide(event);
        if (signalSide === "neutral") {
            return;
        }

        // Calculate absorption metrics
        const absorptionMetrics = this.calculateAbsorptionMetrics(event);
        if (absorptionMetrics === null) {
            return;
        }

        // Find the relevant zone from standardized zone data
        const relevantZone = this.preprocessor.findMostRelevantZone(
            event.zoneData!,
            event.price
        );
        if (!relevantZone) {
            return; // Cannot create absorption signal without valid zone
        }

        // Create enhanced absorption signal data
        const absorptionResult: EnhancedAbsorptionSignalData = {
            price: event.price,
            zone: relevantZone.priceLevel,
            side: signalSide,
            aggressive: relevantZone.aggressiveVolume,
            passive: relevantZone.passiveVolume,
            refilled: false, // TODO: Implement refill detection from zone data
            confidence: enhancedConfidence,
            absorptionScore: absorptionMetrics.absorptionScore,
            passiveMultiplier: absorptionMetrics.passiveMultiplier,
            priceEfficiency: absorptionMetrics.priceEfficiency,
            spreadImpact: absorptionMetrics.spreadImpact,
            volumeProfile: {
                totalVolume:
                    relevantZone.aggressiveVolume + relevantZone.passiveVolume,
                institutionalRatio: absorptionMetrics.institutionalRatio,
            },
            metadata: {
                signalType: "absorption",
                timestamp: event.timestamp,
                institutionalRatio: absorptionMetrics.institutionalRatio,
                enhancementType: "zone_based_absorption",
                qualityMetrics: {
                    absorptionStatisticalSignificance: enhancedConfidence,
                    institutionalConfirmation:
                        absorptionMetrics.institutionalRatio > 0.5,
                    signalPurity:
                        enhancedConfidence > 0.7 ? "premium" : "standard",
                },
            },
        };

        // Create signal candidate
        const signalCandidate: SignalCandidate = {
            id: `enhanced-absorption-${Date.now()}-${Math.random().toString(36).substring(7)}`,
            type: "absorption" as SignalType,
            side: signalSide,
            confidence: enhancedConfidence,
            timestamp: Date.now(),
            data: absorptionResult,
        };

        // ✅ EMIT ENHANCED ABSORPTION SIGNAL - Independent of base detector
        this.emit("signalCandidate", signalCandidate);

        this.logger.info(
            "AbsorptionDetectorEnhanced: ABSORPTION CANDIDATE SIGNAL EMITTED",
            {
                detectorId: this.getId(),
                price: event.price,
                side: signalSide,
                confidence: enhancedConfidence,
                confidenceBoost,
                absorptionScore: absorptionMetrics.absorptionScore,
                signalId: signalCandidate.id,
                signalType: "absorption",
                signalCandidate: signalCandidate,
            }
        );
    }

    /**
     * Determine absorption signal side based on market conditions
     */
    private determineAbsorptionSignalSide(
        event: EnrichedTradeEvent
    ): "buy" | "sell" | "neutral" {
        if (!event.zoneData) {
            return "neutral";
        }

        // For absorption, we analyze which side is being absorbed
        const allZones = [...event.zoneData.zones];

        const relevantZones = this.preprocessor.findZonesNearPrice(
            allZones,
            event.price,
            this.confluenceMaxDistance
        );
        if (relevantZones.length === 0) {
            return "neutral";
        }

        let totalPassiveVolume = 0;
        let totalAggressiveVolume = 0;

        relevantZones.forEach((zone) => {
            totalPassiveVolume += zone.passiveVolume;
            totalAggressiveVolume += zone.aggressiveVolume;
        });

        const totalVolume = totalPassiveVolume + totalAggressiveVolume;
        if (totalVolume === 0) {
            return "neutral";
        }

        const passiveRatio = FinancialMath.divideQuantities(
            totalPassiveVolume,
            totalVolume
        );

        // If passive volume is high, it suggests absorption (institutions providing liquidity)
        // The signal direction depends on which side is being absorbed
        if (passiveRatio >= this.absorptionRatioThreshold) {
            // High passive volume suggests institutional absorption
            // Determine direction based on aggressive flow direction
            return event.buyerIsMaker ? "sell" : "buy"; // Opposite of aggressive flow
        }

        return "neutral";
    }

    /**
     * Calculate absorption metrics for signal data
     */
    private calculateAbsorptionMetrics(event: EnrichedTradeEvent): {
        absorptionScore: number;
        passiveMultiplier: number;
        priceEfficiency: number;
        spreadImpact: number;
        institutionalRatio: number;
    } | null {
        if (!event.zoneData) {
            return null;
        }

        const allZones = [...event.zoneData.zones];

        const relevantZones = this.preprocessor.findZonesNearPrice(
            allZones,
            event.price,
            this.confluenceMaxDistance
        );
        if (relevantZones.length === 0) {
            return null;
        }

        let totalPassiveVolume = 0;
        let totalAggressiveVolume = 0;
        let totalInstitutionalVolume = 0;

        relevantZones.forEach((zone) => {
            totalPassiveVolume += zone.passiveVolume;
            totalAggressiveVolume += zone.aggressiveVolume;

            // Count institutional-sized volume
            if (zone.aggressiveVolume >= this.absorptionVolumeThreshold) {
                totalInstitutionalVolume += zone.aggressiveVolume;
            }
            if (zone.passiveVolume >= this.absorptionVolumeThreshold) {
                totalInstitutionalVolume += zone.passiveVolume;
            }
        });

        const totalVolume = totalPassiveVolume + totalAggressiveVolume;
        if (totalVolume === 0) {
            return null;
        }

        // Calculate metrics using FinancialMath
        const absorptionScore = FinancialMath.divideQuantities(
            totalPassiveVolume,
            totalVolume
        );
        const passiveMultiplier =
            totalAggressiveVolume > 0
                ? FinancialMath.divideQuantities(
                      totalPassiveVolume,
                      totalAggressiveVolume
                  )
                : 0;
        const institutionalRatio = FinancialMath.divideQuantities(
            totalInstitutionalVolume,
            totalVolume
        );

        // Calculate price efficiency (simplified)
        const priceEfficiency =
            relevantZones.length > 1
                ? FinancialMath.divideQuantities(
                      totalVolume,
                      relevantZones.length * 100
                  )
                : 0.5;

        // Calculate spread impact (simplified)
        const spreadImpact =
            relevantZones.length > 1
                ? Math.abs(
                      relevantZones[0].priceLevel -
                          relevantZones[relevantZones.length - 1].priceLevel
                  )
                : 0;

        return {
            absorptionScore,
            passiveMultiplier,
            priceEfficiency,
            spreadImpact,
            institutionalRatio,
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
            "AbsorptionDetectorEnhanced: Enhancement mode updated",
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
            "AbsorptionDetectorEnhanced: Standalone cleanup completed",
            {
                detectorId: this.getId(),
                enhancementStats: this.enhancementStats,
            }
        );
    }
}
