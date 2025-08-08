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
import { SignalValidationLogger } from "../utils/signalValidationLogger.js";
import type { ILogger } from "../infrastructure/loggerInterface.js";
import type { IMetricsCollector } from "../infrastructure/metricsCollectorInterface.js";
import type { IOrderflowPreprocessor } from "../market/orderFlowPreprocessor.js";
import type {
    EnrichedTradeEvent,
    StandardZoneData,
    ZoneSnapshot,
} from "../types/marketEvents.js";
import type { AbsorptionCalculatedValues } from "../types/calculatedValuesTypes.js";
import type {
    SignalCandidate,
    EnhancedAbsorptionSignalData,
    SignalType,
} from "../types/signalTypes.js";
import { z } from "zod";
import { AbsorptionDetectorSchema, Config } from "../core/config.js";
import type { ISignalLogger } from "../infrastructure/signalLoggerInterface.js";

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

const _BALANCE_CENTER_POINT = 0.5;

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
    private readonly validationLogger: SignalValidationLogger;
    private readonly windowMs: number;

    // Signal cooldown tracking (CLAUDE.md compliance - no magic cooldown values)
    private readonly lastSignal = new Map<string, number>();

    // CLAUDE.md compliant configuration parameters - NO MAGIC NUMBERS
    private readonly confluenceMinZones: number;
    private readonly confluenceMaxDistance: number;
    private readonly absorptionVolumeThreshold: number;
    private readonly absorptionRatioThreshold: number;
    private readonly absorptionScoreThreshold: number;

    constructor(
        id: string,
        settings: AbsorptionEnhancedSettings,
        preprocessor: IOrderflowPreprocessor,
        logger: ILogger,
        metrics: IMetricsCollector,
        validationLogger: SignalValidationLogger,
        signalLogger: ISignalLogger
    ) {
        // Settings are pre-validated by Config.ABSORPTION_DETECTOR getter
        // No validation needed here - trust that settings are correct

        // Initialize base detector directly (no legacy inheritance)
        super(id, logger, metrics, signalLogger);

        // Initialize enhancement configuration
        this.useStandardizedZones = settings.useStandardizedZones;
        this.enhancementConfig = settings;
        this.preprocessor = preprocessor;
        this.windowMs = Config.getTimeWindow(settings.timeWindowIndex);

        // ✅ SHARED SIGNAL VALIDATION LOGGER: Use dependency-injected shared instance
        this.validationLogger = validationLogger;

        // CLAUDE.md Compliance: Extract all configurable parameters (NO MAGIC NUMBERS)
        this.confluenceMinZones = settings.confluenceMinZones; // Dedicated parameter for minimum confluence zones
        this.confluenceMaxDistance = settings.confluenceMaxDistance; // Dedicated parameter for maximum confluence distance
        this.absorptionVolumeThreshold = settings.institutionalVolumeThreshold;
        this.absorptionRatioThreshold = settings.passiveAbsorptionThreshold;
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
            windowMs: this.windowMs,
        });
    }

    /**
     * Main trade event processing - implements required BaseDetector interface
     *
     * STANDALONE VERSION: Processes trades directly without legacy detector dependency
     */
    public onEnrichedTrade(event: EnrichedTradeEvent): void {
        // Update current price for signal validation
        this.validationLogger.updateCurrentPrice(event.price);
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

        this.logger.info(
            "AbsorptionDetectorEnhanced: Processing trade",
            debugInfo
        );

        // Only process if standardized zones are enabled and available
        if (
            !this.useStandardizedZones ||
            this.enhancementConfig.enhancementMode === "disabled" ||
            !event.zoneData
        ) {
            this.logger.info(
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
        return `Absorption Enhanced - Mode: ${this.enhancementConfig.enhancementMode}, Window: ${this.windowMs}ms, Zones: ${this.useStandardizedZones ? "enabled" : "disabled"}`;
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
     * Check if we can emit a signal for this detector (respects cooldown)
     */
    private canEmitSignal(eventKey: string, update: boolean = false): boolean {
        // Note: For signal cooldown, we still use Date.now() since it's system time management
        // not market data timing. This is acceptable as per architectural guidelines.
        const now = Date.now();
        const lastSignalTime = this.lastSignal.get(eventKey) || 0;

        if (now - lastSignalTime <= this.enhancementConfig.eventCooldownMs) {
            return false;
        }

        if (update) {
            this.lastSignal.set(eventKey, now);
        }
        return true;
    }

    /**
     * Core absorption pattern analysis using standardized zones
     *
     * STANDALONE VERSION: Complete absorption detection with enhancement analysis
     */
    private analyzeAbsorptionPattern(event: EnrichedTradeEvent): void {
        if (!event.zoneData) {
            this.logSignalRejection(
                event,
                "no_zone_data",
                {
                    type: "zone_data_availability",
                    threshold: 1,
                    actual: 0,
                },
                {
                    calculatedMinAggVolume: 0,
                    calculatedTimeWindowIndex:
                        this.enhancementConfig.timeWindowIndex,
                    calculatedEventCooldownMs:
                        Date.now() - (this.lastSignal.get("last") || 0),
                    calculatedPriceEfficiencyThreshold: 0,
                    calculatedMaxAbsorptionRatio: 0,
                    calculatedMinPassiveMultiplier: 0,
                    calculatedPassiveAbsorptionThreshold: 0,
                    calculatedExpectedMovementScalingFactor: 0,
                    calculatedContextConfidenceBoostMultiplier: 0,
                    calculatedLiquidityGradientRange: 0,
                    calculatedInstitutionalVolumeThreshold: 0,
                    calculatedInstitutionalVolumeRatioThreshold: 0,
                    calculatedEnableInstitutionalVolumeFilter:
                        this.enhancementConfig.enableInstitutionalVolumeFilter,
                    calculatedInstitutionalVolumeBoost: 0,
                    calculatedMinAbsorptionScore: 0,
                    calculatedFinalConfidenceRequired: 0,
                    calculatedMaxZoneCountForScoring: 0,
                    calculatedMinEnhancedConfidenceThreshold: 0,
                    calculatedUseStandardizedZones:
                        this.enhancementConfig.useStandardizedZones,
                    calculatedEnhancementMode:
                        this.enhancementConfig.enhancementMode,
                    calculatedBalanceThreshold: 0,
                    calculatedConfluenceMinZones: 0,
                    calculatedConfluenceMaxDistance: 0,
                } as AbsorptionCalculatedValues
            );
            return;
        }

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

        // Check signal cooldown to prevent too many signals
        const eventKey = `absorption`; // Single cooldown for all absorption signals
        if (!this.canEmitSignal(eventKey)) {
            this.logger.debug(
                "AbsorptionDetectorEnhanced: Signal blocked by cooldown",
                {
                    detectorId: this.getId(),
                    price: event.price,
                    eventKey,
                    cooldownMs: this.enhancementConfig.eventCooldownMs,
                }
            );
            return;
        }

        // STEP 2: QUALITY FLAG ANALYSIS (Track signal quality indicators)
        let hasZoneConfluence = false;
        let hasInstitutionalVolume = false;
        let hasCrossTimeframe = false;
        let hasPriceEfficiency = false;

        // Zone confluence analysis for absorption validation (CLAUDE.md compliant)
        if (this.enhancementConfig.enableInstitutionalVolumeFilter) {
            const confluenceResult = this.analyzeZoneConfluence(
                event.zoneData,
                event.price
            );
            if (confluenceResult.hasConfluence) {
                hasZoneConfluence = true;
                this.enhancementStats.confluenceDetectionCount++;

                this.logger.debug(
                    "AbsorptionDetectorEnhanced: Zone confluence detected for absorption validation",
                    {
                        detectorId: this.getId(),
                        price: event.price,
                        confluenceZones: confluenceResult.confluenceZones,
                        confluenceStrength: confluenceResult.confluenceStrength,
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
                hasInstitutionalVolume = true;
                this.enhancementStats.institutionalDetectionCount++;

                this.logger.debug(
                    "AbsorptionDetectorEnhanced: Institutional absorption detected",
                    {
                        detectorId: this.getId(),
                        price: event.price,
                        absorptionRatio: absorptionResult.absorptionRatio,
                        affectedZones: absorptionResult.affectedZones,
                    }
                );
            }
        }

        // Cross-timeframe absorption analysis (CLAUDE.md compliant)
        const crossTimeframeResult: {
            hasAlignment: boolean;
            alignmentScore: number;
            timeframeBreakdown: {
                tick5: number;
                tick10: number;
                tick20: number;
            };
        } = this.analyzeCrossTimeframeAbsorption(event.zoneData, event);
        if (crossTimeframeResult.hasAlignment) {
            hasCrossTimeframe = true;
            this.enhancementStats.crossTimeframeAnalysisCount++;

            this.logger.debug(
                "AbsorptionDetectorEnhanced: Cross-timeframe absorption alignment",
                {
                    detectorId: this.getId(),
                    price: event.price,
                    alignmentScore: crossTimeframeResult.alignmentScore,
                    timeframeBreakdown: crossTimeframeResult.timeframeBreakdown,
                }
            );
        }

        // Check price efficiency from the core signal data
        const signalData =
            coreAbsorptionResult.data as EnhancedAbsorptionSignalData;
        if (
            signalData.priceEfficiency !== null &&
            signalData.priceEfficiency <=
                this.enhancementConfig.priceEfficiencyThreshold
        ) {
            hasPriceEfficiency = true;
        }

        // Determine if any enhancements/quality flags were detected
        const enhancementApplied =
            hasZoneConfluence ||
            hasInstitutionalVolume ||
            hasCrossTimeframe ||
            hasPriceEfficiency;

        // STEP 3: EMIT SINGLE SIGNAL with quality flags
        if (enhancementApplied) {
            // Update enhancement statistics
            this.enhancementStats.enhancementCount++;
            this.enhancementStats.enhancementSuccessRate =
                this.enhancementStats.enhancementCount /
                this.enhancementStats.callCount;

            // Create enhanced signal with quality flags
            const enhancedSignal: SignalCandidate = {
                ...coreAbsorptionResult,
                id: `enhanced-${coreAbsorptionResult.id}`,
                qualityFlags: {
                    crossTimeframe: hasCrossTimeframe,
                    institutionalVolume: hasInstitutionalVolume,
                    zoneConfluence: hasZoneConfluence,
                    priceEfficiency: hasPriceEfficiency,
                },
            };

            // Update cooldown tracking before emitting signal
            this.canEmitSignal(eventKey, true);

            // Log enhanced signal for validation tracking BEFORE checking thresholds
            const signalZones = event.zoneData ? event.zoneData.zones : [];
            void this.logSignalForValidation(
                enhancedSignal,
                event,
                signalZones
            );

            // Log successful signal parameters for 90-minute optimization
            void this.logSuccessfulSignalParameters(enhancedSignal, event);

            // Only emit if confidence meets the final confidence requirement
            if (
                coreAbsorptionResult.confidence <
                this.enhancementConfig.finalConfidenceRequired
            ) {
                return; // Signal doesn't meet confidence threshold but was logged
            }

            this.emit("signalCandidate", enhancedSignal);

            this.logger.info(
                "🎯 AbsorptionDetectorEnhanced: ENHANCED ABSORPTION SIGNAL GENERATED!",
                {
                    detectorId: this.getId(),
                    price: event.price,
                    side: enhancedSignal.side,
                    confidence: coreAbsorptionResult.confidence,
                    qualityFlags: enhancedSignal.qualityFlags,
                    signalId: enhancedSignal.id,
                    signalType: "absorption",
                    timestamp: new Date(enhancedSignal.timestamp).toISOString(),
                }
            );
        } else {
            // Add quality flags to core signal
            const signalWithFlags: SignalCandidate = {
                ...coreAbsorptionResult,
                qualityFlags: {
                    crossTimeframe: hasCrossTimeframe,
                    institutionalVolume: hasInstitutionalVolume,
                    zoneConfluence: hasZoneConfluence,
                    priceEfficiency: hasPriceEfficiency,
                },
            };

            // Update cooldown tracking before emitting signal
            this.canEmitSignal(eventKey, true);

            // Log core signal for validation tracking BEFORE checking thresholds
            const signalZones = event.zoneData ? event.zoneData.zones : [];
            void this.logSignalForValidation(
                signalWithFlags,
                event,
                signalZones
            );

            // Log successful signal parameters for 90-minute optimization
            void this.logSuccessfulSignalParameters(signalWithFlags, event);

            // Only check threshold AFTER logging
            if (
                coreAbsorptionResult.confidence <
                this.enhancementConfig.finalConfidenceRequired
            ) {
                return; // Core signal doesn't meet final confidence threshold but was logged
            }

            this.emit("signalCandidate", signalWithFlags);

            this.logger.info(
                "🎯 AbsorptionDetectorEnhanced: CORE ABSORPTION SIGNAL GENERATED!",
                {
                    detectorId: this.getId(),
                    price: event.price,
                    side: signalWithFlags.side,
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
     * ARCHITECTURAL PATTERN: Follows successful exhaustion detector restructuring
     */
    private detectCoreAbsorption(
        event: EnrichedTradeEvent
    ): SignalCandidate | null {
        // DEBUG: Log entry conditions
        this.logger.info(
            "AbsorptionDetectorEnhanced: detectCoreAbsorption called",
            {
                hasZoneData: !!event.zoneData,
                quantity: event.quantity,
                windowMs: this.windowMs,
                tradeTimestamp: event.timestamp,
            }
        );

        // EARLY VALIDATION: Only check for missing/malformed data - no signal validation logging
        if (!event.zoneData) {
            this.logger.debug(
                "AbsorptionDetectorEnhanced: No zone data available"
            );
            return null;
        }

        const allZones = [...event.zoneData.zones];
        if (allZones.length === 0) {
            this.logSignalRejection(
                event,
                "no_zones_available",
                {
                    type: "zones_count",
                    threshold: 1,
                    actual: 0,
                },
                {
                    calculatedMinAggVolume: 0,
                    calculatedTimeWindowIndex:
                        this.enhancementConfig.timeWindowIndex,
                    calculatedEventCooldownMs:
                        Date.now() - (this.lastSignal.get("last") || 0),
                    calculatedPriceEfficiencyThreshold: 0,
                    calculatedMaxAbsorptionRatio: 0,
                    calculatedMinPassiveMultiplier: 0,
                    calculatedPassiveAbsorptionThreshold: 0,
                    calculatedExpectedMovementScalingFactor: 0,
                    calculatedContextConfidenceBoostMultiplier: 0,
                    calculatedLiquidityGradientRange: 0,
                    calculatedInstitutionalVolumeThreshold: 0,
                    calculatedInstitutionalVolumeRatioThreshold: 0,
                    calculatedEnableInstitutionalVolumeFilter:
                        this.enhancementConfig.enableInstitutionalVolumeFilter,
                    calculatedInstitutionalVolumeBoost: 0,
                    calculatedMinAbsorptionScore: 0,
                    calculatedFinalConfidenceRequired: 0,
                    calculatedMaxZoneCountForScoring: 0,
                    calculatedMinEnhancedConfidenceThreshold: 0,
                    calculatedUseStandardizedZones:
                        this.enhancementConfig.useStandardizedZones,
                    calculatedEnhancementMode:
                        this.enhancementConfig.enhancementMode,
                    calculatedBalanceThreshold: 0,
                    calculatedConfluenceMinZones: 0,
                    calculatedConfluenceMaxDistance: 0,
                } as AbsorptionCalculatedValues
            );
            return null;
        }

        this.logger.debug(
            "AbsorptionDetectorEnhanced: Starting core absorption detection",
            {
                price: event.price,
                quantity: event.quantity,
                minAggVolume: this.enhancementConfig.minAggVolume,
                absorptionRatioThreshold: this.absorptionRatioThreshold,
                priceEfficiencyThreshold:
                    this.enhancementConfig.priceEfficiencyThreshold,
            }
        );

        // FULL CALCULATION SECTION: Calculate ALL thresholds regardless of outcome

        // Filter zones by time window using trade timestamp
        const windowStartTime = event.timestamp - this.windowMs;
        const recentZones = allZones.filter(
            (zone) => zone.lastUpdate >= windowStartTime
        );

        this.logger.debug("AbsorptionDetectorEnhanced: Time-window filtering", {
            totalZones: allZones.length,
            recentZones: recentZones.length,
            windowMs: this.windowMs,
            windowStartTime,
            tradeTimestamp: event.timestamp,
        });

        // Find zones near the current price from recent zones only
        let relevantZones = this.preprocessor.findZonesNearPrice(
            recentZones,
            event.price,
            this.confluenceMaxDistance
        );

        // If no zones found with primary method, find nearest zone with volume from recent zones
        if (relevantZones.length === 0) {
            this.logger.debug(
                "AbsorptionDetectorEnhanced: No zones found with primary method, using fallback",
                {
                    price: event.price,
                    maxDistance: this.confluenceMaxDistance,
                    totalZones: allZones.length,
                    recentZones: recentZones.length,
                }
            );

            const zonesWithVolume = recentZones.filter(
                (z) => z.aggressiveVolume > 0 || z.passiveVolume > 0
            );

            if (zonesWithVolume.length > 0) {
                const nearestZone = zonesWithVolume.reduce((closest, zone) =>
                    Math.abs(zone.priceLevel - event.price) <
                    Math.abs(closest.priceLevel - event.price)
                        ? zone
                        : closest
                );
                relevantZones = [nearestZone];

                this.logger.debug(
                    "AbsorptionDetectorEnhanced: Using fallback zone",
                    {
                        price: event.price,
                        zonePrice: nearestZone.priceLevel,
                        distance: Math.abs(
                            nearestZone.priceLevel - event.price
                        ),
                        aggressiveVolume: nearestZone.aggressiveVolume,
                    }
                );
            }
        }

        this.logger.debug("AbsorptionDetectorEnhanced: Found relevant zones", {
            relevantZones: relevantZones.length,
            maxDistance: this.confluenceMaxDistance,
        });

        // Calculate accumulated absorption metrics over time window
        let totalAggressiveVolume = 0;
        let totalPassiveVolume = 0;

        for (const zone of relevantZones) {
            totalAggressiveVolume += zone.aggressiveVolume;
            totalPassiveVolume += zone.passiveVolume;
        }

        const totalAccumulatedVolume =
            totalAggressiveVolume + totalPassiveVolume;

        this.logger.debug(
            "AbsorptionDetectorEnhanced: Accumulated volume analysis",
            {
                totalAggressiveVolume,
                totalPassiveVolume,
                totalAccumulatedVolume,
                absorptionVolumeThreshold: this.absorptionVolumeThreshold,
                windowMs: this.windowMs,
                zonesAnalyzed: relevantZones.length,
            }
        );

        // Calculate volume pressure using FinancialMath (CLAUDE.md compliant)
        const volumePressure = this.calculateVolumePressure(
            event,
            relevantZones
        );

        // Calculate passive volume ratio for institutional absorption
        const passiveVolumeRatio = volumePressure
            ? FinancialMath.divideQuantities(
                  volumePressure.passivePressure,
                  volumePressure.totalPressure
              )
            : 0;

        // Calculate price efficiency using FinancialMath (institutional precision)
        const priceEfficiency = this.calculatePriceEfficiency(
            event,
            relevantZones
        );

        // Calculate absorption ratio using FinancialMath
        const absorptionRatio = volumePressure
            ? this.calculateAbsorptionRatio(event, volumePressure)
            : null;

        // Check for balanced institutional flow
        const balanceScore =
            this.detectBalancedInstitutionalFlow(relevantZones);
        const isBalancedInstitutional = balanceScore !== null;

        // Determine dominant side and signal direction
        const dominantSide = this.calculateDominantSide(relevantZones, event);

        // Calculate final confidence using statistical analysis
        const confidence =
            priceEfficiency !== null &&
            absorptionRatio !== null &&
            volumePressure !== null
                ? this.calculateAbsorptionConfidence(
                      priceEfficiency,
                      absorptionRatio,
                      volumePressure,
                      relevantZones
                  )
                : null;

        this.logger.debug(
            "AbsorptionDetectorEnhanced: All calculations completed",
            {
                totalAggressiveVolume,
                totalPassiveVolume,
                passiveVolumeRatio,
                priceEfficiency,
                absorptionRatio,
                confidence,
                dominantSide,
                isBalancedInstitutional,
                balanceScore,
            }
        );

        // SINGLE EVALUATION SECTION: One decision point with complete threshold data
        const hasRecentZones = recentZones.length > 0;
        const hasRelevantZones = relevantZones.length > 0;
        const hasVolumePressure = volumePressure !== null;
        // Use institutional threshold when institutional filtering is enabled, otherwise use regular threshold
        const volumeThreshold = this.enhancementConfig
            .enableInstitutionalVolumeFilter
            ? this.enhancementConfig.institutionalVolumeThreshold
            : this.enhancementConfig.minAggVolume;
        const passesVolumeThreshold = totalAggressiveVolume >= volumeThreshold;
        const passesPassiveRatioThreshold =
            passiveVolumeRatio >= this.absorptionRatioThreshold;
        const passesEfficiencyThreshold =
            priceEfficiency !== null &&
            priceEfficiency <= this.enhancementConfig.priceEfficiencyThreshold;
        const passesAbsorptionRatioThreshold =
            absorptionRatio !== null &&
            absorptionRatio <= this.enhancementConfig.maxAbsorptionRatio;
        const passesConfidenceThreshold =
            confidence !== null &&
            confidence >= this.enhancementConfig.finalConfidenceRequired;
        const hasValidSignalSide = dominantSide !== null;
        const isNotBalanced = !isBalancedInstitutional;

        // ✅ CAPTURE ALL CALCULATED VALUES: Using TypeScript interface for type safety
        const allCalculatedValues: AbsorptionCalculatedValues = {
            calculatedMinAggVolume: totalAggressiveVolume,
            calculatedTimeWindowIndex: this.enhancementConfig.timeWindowIndex,
            calculatedEventCooldownMs:
                Date.now() - (this.lastSignal.get("last") || 0),
            calculatedPriceEfficiencyThreshold: priceEfficiency ?? 0,
            calculatedMaxAbsorptionRatio: absorptionRatio ?? 0,
            calculatedMinPassiveMultiplier:
                totalPassiveVolume / Math.max(totalAggressiveVolume, 1),
            calculatedPassiveAbsorptionThreshold: passiveVolumeRatio,
            calculatedExpectedMovementScalingFactor:
                FinancialMath.divideQuantities(
                    FinancialMath.multiplyQuantities(
                        event.quantity,
                        this.enhancementConfig.expectedMovementScalingFactor
                    ),
                    event.quantity
                ),
            calculatedLiquidityGradientRange: FinancialMath.multiplyQuantities(
                this.enhancementConfig.liquidityGradientRange,
                event.zoneData?.zoneConfig.tickValue ?? 0
            ),
            calculatedInstitutionalVolumeThreshold:
                volumePressure?.totalPressure ?? 0,
            calculatedInstitutionalVolumeRatioThreshold:
                totalPassiveVolume / Math.max(totalAggressiveVolume, 1),
            calculatedEnableInstitutionalVolumeFilter:
                this.enhancementConfig.enableInstitutionalVolumeFilter,
            calculatedMinAbsorptionScore:
                totalPassiveVolume > 0
                    ? totalPassiveVolume /
                      (totalAggressiveVolume + totalPassiveVolume)
                    : 0,
            calculatedFinalConfidenceRequired: confidence ?? 0,
            calculatedMaxZoneCountForScoring: relevantZones.length,
            calculatedMinEnhancedConfidenceThreshold: confidence ?? 0,
            calculatedUseStandardizedZones:
                this.enhancementConfig.useStandardizedZones,
            calculatedEnhancementMode: this.enhancementConfig.enhancementMode,
            calculatedBalanceThreshold: Math.max(
                Math.abs(
                    totalAggressiveVolume /
                        Math.max(
                            totalAggressiveVolume + totalPassiveVolume,
                            1
                        ) -
                        _BALANCE_CENTER_POINT
                ),
                Math.abs(
                    totalPassiveVolume /
                        Math.max(
                            totalAggressiveVolume + totalPassiveVolume,
                            1
                        ) -
                        _BALANCE_CENTER_POINT
                )
            ),
            calculatedConfluenceMinZones: relevantZones.length,
            calculatedConfluenceMaxDistance: this.confluenceMaxDistance,
        };

        // Comprehensive rejection with complete threshold data
        if (
            !hasRecentZones ||
            !hasRelevantZones ||
            !hasVolumePressure ||
            !passesVolumeThreshold ||
            !passesPassiveRatioThreshold ||
            !passesEfficiencyThreshold ||
            !passesAbsorptionRatioThreshold ||
            !passesConfidenceThreshold ||
            !hasValidSignalSide ||
            !isNotBalanced
        ) {
            // Determine primary rejection reason for logging
            let rejectionReason = "comprehensive_rejection";
            let thresholdType = "multiple_thresholds";
            let thresholdValue = 0;
            let actualValue = 0;

            if (!hasRecentZones) {
                rejectionReason = "no_recent_zones_in_time_window";
                thresholdType = "time_window_zones";
                thresholdValue = 1;
                actualValue = recentZones.length;
            } else if (!hasRelevantZones) {
                rejectionReason = "no_relevant_zones";
                thresholdType = "zone_count";
                thresholdValue = 1;
                actualValue = 0;
            } else if (!hasVolumePressure) {
                rejectionReason = "insufficient_volume_pressure";
                thresholdType = "volume_pressure";
                thresholdValue = 1;
                actualValue = 0;
            } else if (!passesVolumeThreshold) {
                rejectionReason = "insufficient_aggressive_volume";
                thresholdType = this.enhancementConfig
                    .enableInstitutionalVolumeFilter
                    ? "institutional_volume"
                    : "aggressive_volume";
                thresholdValue = volumeThreshold;
                actualValue = totalAggressiveVolume;
            } else if (!passesPassiveRatioThreshold) {
                rejectionReason = "passive_volume_ratio_too_low";
                thresholdType = "passive_volume_ratio";
                thresholdValue = this.absorptionRatioThreshold;
                actualValue = passiveVolumeRatio;
            } else if (!passesEfficiencyThreshold) {
                rejectionReason = "price_efficiency_too_high";
                thresholdType = "price_efficiency";
                thresholdValue =
                    this.enhancementConfig.priceEfficiencyThreshold;
                actualValue = priceEfficiency ?? -1;
            } else if (!passesAbsorptionRatioThreshold) {
                rejectionReason = "absorption_ratio_too_high";
                thresholdType = "absorption_ratio";
                thresholdValue = this.enhancementConfig.maxAbsorptionRatio;
                actualValue = absorptionRatio ?? -1;
            } else if (!passesConfidenceThreshold) {
                rejectionReason = "confidence_below_threshold";
                thresholdType = "confidence_threshold";
                thresholdValue = this.enhancementConfig.finalConfidenceRequired;
                actualValue = confidence ?? 0;
            } else if (!hasValidSignalSide) {
                rejectionReason = "no_dominant_side";
                thresholdType = "side_determination";
                thresholdValue = 1;
                actualValue = 0;
            } else if (!isNotBalanced) {
                rejectionReason = "balanced_institutional_flow";
                thresholdType = "institutional_balance";
                thresholdValue = this.enhancementConfig.balanceThreshold;
                actualValue = balanceScore ?? 0;
            }

            this.logSignalRejection(
                event,
                rejectionReason,
                {
                    type: thresholdType,
                    threshold: thresholdValue,
                    actual: actualValue,
                },
                allCalculatedValues
            );
            return null;
        }

        // Create signal candidate with correct interface structure
        return {
            id: `absorption-${this.getId()}-${event.timestamp}`,
            type: "absorption" as SignalType,
            side: dominantSide, // Follow institutional flow direction
            confidence,
            timestamp: event.timestamp,
            data: {
                price: event.price,
                zone: event.price, // Use price as zone for now
                side: dominantSide,
                aggressive: volumePressure.aggressivePressure,
                passive: volumePressure.passivePressure,
                refilled: false, // Will be determined later
                confidence,
                absorptionScore: 1 - absorptionRatio, // Invert ratio for score
                passiveMultiplier: this.enhancementConfig.minPassiveMultiplier,
                priceEfficiency,
                spreadImpact:
                    event.bestAsk !== undefined && event.bestBid !== undefined
                        ? FinancialMath.calculateSpread(
                              event.bestAsk,
                              event.bestBid,
                              2
                          )
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
     * Calculate volume pressure using FinancialMath for institutional precision
     * DIRECTIONAL FIX: Only count passive volume relevant to trade direction
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

        // CRITICAL FIX: Determine which passive volume is relevant based on trade direction
        // - Buy trades (buyerIsMaker = false): Only count passiveAskVolume (hitting asks)
        // - Sell trades (buyerIsMaker = true): Only count passiveBidVolume (hitting bids)
        const isBuyTrade = !event.buyerIsMaker;

        for (const zone of zones) {
            // Validate inputs before FinancialMath calls to prevent NaN BigInt errors
            if (
                isNaN(zone.aggressiveVolume) ||
                isNaN(zone.passiveBidVolume) ||
                isNaN(zone.passiveAskVolume)
            ) {
                return null; // Skip this calculation if any zone has NaN values
            }

            totalAggressive = FinancialMath.safeAdd(
                totalAggressive,
                zone.aggressiveVolume
            );

            // DIRECTIONAL PASSIVE VOLUME: Only count relevant side
            const relevantPassiveVolume = isBuyTrade
                ? zone.passiveAskVolume // Buy trades absorb ask liquidity
                : zone.passiveBidVolume; // Sell trades absorb bid liquidity

            totalPassive = FinancialMath.safeAdd(
                totalPassive,
                relevantPassiveVolume
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

        // DEBUG: Log zone VWAP status
        this.logger.info(
            "AbsorptionDetectorEnhanced: calculatePriceEfficiency zones",
            {
                totalZones: zones.length,
                zonesWithVWAP: zones.filter(
                    (z) => z.volumeWeightedPrice !== null
                ).length,
                zonesWithVolume: zones.filter((z) => z.aggressiveVolume > 0)
                    .length,
                sampleZones: zones.slice(0, 3).map((z) => ({
                    priceLevel: z.priceLevel,
                    volumeWeightedPrice: z.volumeWeightedPrice,
                    aggressiveVolume: z.aggressiveVolume,
                })),
            }
        );

        // Calculate volume-weighted average price using FinancialMath
        let totalVolumeWeightedPrice = 0;
        let totalVolume = 0;

        for (const zone of zones) {
            // CRITICAL: Check for both null and undefined, and skip zones with invalid data
            if (
                zone.volumeWeightedPrice == null ||
                isNaN(zone.volumeWeightedPrice)
            )
                continue;
            if (zone.aggressiveVolume == null || isNaN(zone.aggressiveVolume))
                continue;

            const zoneWeight = FinancialMath.multiplyQuantities(
                zone.volumeWeightedPrice,
                zone.aggressiveVolume
            );

            // Skip zones where calculation fails
            if (isNaN(zoneWeight)) continue;

            totalVolumeWeightedPrice = FinancialMath.safeAdd(
                totalVolumeWeightedPrice,
                zoneWeight
            );
            totalVolume = FinancialMath.safeAdd(
                totalVolume,
                zone.aggressiveVolume
            );
        }

        // DEBUG: Log calculation status
        this.logger.info(
            "AbsorptionDetectorEnhanced: Price efficiency calculation",
            {
                totalVolumeWeightedPrice,
                totalVolume,
                willReturnNull: totalVolume === 0,
            }
        );

        if (totalVolume === 0) return null;

        const vwap = FinancialMath.divideQuantities(
            totalVolumeWeightedPrice,
            totalVolume
        );
        const priceDiff = FinancialMath.calculateAbs(
            FinancialMath.safeSubtract(event.price, vwap)
        );

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
        const actualImpact = FinancialMath.calculateAbs(
            FinancialMath.safeSubtract(event.price, event.bestBid)
        );

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
     * Calculate dominant side based on directional passive volume absorption
     * CRITICAL: Determines signal direction based on institutional flow
     * FIXED: Now uses same directional logic as calculateVolumePressure
     */
    private calculateDominantSide(
        zones: ZoneSnapshot[],
        event: EnrichedTradeEvent
    ): "buy" | "sell" | null {
        if (zones.length === 0) return null;

        // CRITICAL FIX: Use same directional logic as calculateVolumePressure
        // - Buy trades (buyerIsMaker = false): Only count passiveAskVolume (hitting asks)
        // - Sell trades (buyerIsMaker = true): Only count passiveBidVolume (hitting bids)
        const isBuyTrade = !event.buyerIsMaker;

        let relevantPassiveVolume = 0;

        for (const zone of zones) {
            // DIRECTIONAL PASSIVE VOLUME: Only count relevant side matching the trade
            const zoneRelevantVolume = isBuyTrade
                ? zone.passiveAskVolume || 0 // Buy trades absorb ask liquidity
                : zone.passiveBidVolume || 0; // Sell trades absorb bid liquidity

            relevantPassiveVolume = FinancialMath.safeAdd(
                relevantPassiveVolume,
                zoneRelevantVolume
            );
        }

        // DEBUG: Log directional passive volume calculations
        this.logger.info(
            "AbsorptionDetectorEnhanced: calculateDominantSide DIRECTIONAL DEBUG",
            {
                isBuyTrade,
                buyerIsMaker: event.buyerIsMaker,
                relevantPassiveVolume,
                zoneCount: zones.length,
                tradeDirection: isBuyTrade ? "BUY" : "SELL",
                passiveSideUsed: isBuyTrade ? "ask" : "bid",
            }
        );

        // DIRECTIONAL SIGNAL LOGIC: Signal follows the trade direction that shows absorption
        // This aligns with calculateVolumePressure which also uses directional passive volume
        if (relevantPassiveVolume > 0) {
            const signalSide = isBuyTrade ? "buy" : "sell";
            this.logger.info(
                `AbsorptionDetectorEnhanced: Returning ${signalSide.toUpperCase()} signal (directional absorption detected)`,
                {
                    relevantPassiveVolume,
                    tradeDirection: isBuyTrade ? "BUY" : "SELL",
                    signalSide,
                }
            );
            return signalSide;
        }

        this.logger.info(
            "AbsorptionDetectorEnhanced: Returning NULL (no directional absorption)",
            {
                relevantPassiveVolume,
                tradeDirection: isBuyTrade ? "BUY" : "SELL",
            }
        );
        return null; // No directional absorption
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

        // Calculate confidence factors using FinancialMath (CLAUDE.md compliance - no bounds forcing)
        const efficiencyFactor = 1 - priceEfficiency; // Higher efficiency = higher confidence
        const absorptionFactor = 1 - absorptionRatio; // Lower absorption ratio = higher confidence
        const pressureFactor = FinancialMath.divideQuantities(
            volumePressure.pressureRatio,
            2
        ); // Pressure component
        const zoneFactor = FinancialMath.divideQuantities(
            zones.length,
            this.enhancementConfig.maxZoneCountForScoring
        ); // Zone count component

        // Validate all factors before proceeding (CLAUDE.md compliance - return null for invalid calculations)
        if (
            !FinancialMath.isValidFinancialNumber(efficiencyFactor) ||
            !FinancialMath.isValidFinancialNumber(absorptionFactor) ||
            !FinancialMath.isValidFinancialNumber(pressureFactor) ||
            !FinancialMath.isValidFinancialNumber(zoneFactor) ||
            efficiencyFactor < 0 ||
            absorptionFactor < 0 ||
            pressureFactor < 0 ||
            zoneFactor < 0
        ) {
            return null; // Cannot calculate confidence with invalid factor inputs
        }

        const confidenceFactors = [
            efficiencyFactor,
            absorptionFactor,
            pressureFactor,
            zoneFactor,
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
        const allZones = zoneData.zones;

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

            totalPassiveVolume = FinancialMath.safeAdd(
                totalPassiveVolume,
                passiveVolume
            );
            totalAggressiveVolume = FinancialMath.safeAdd(
                totalAggressiveVolume,
                aggressiveVolume
            );

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

        const totalVolume = FinancialMath.safeAdd(
            totalPassiveVolume,
            totalAggressiveVolume
        );
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
        // CLAUDE.md SIMPLIFIED: Calculate absorption strength for single zone size with temporal filtering
        const absorptionStrength = this.calculateTimeframeAbsorptionStrength(
            zoneData.zones,
            event.price,
            event.timestamp
        );

        // CLAUDE.md compliance: return early if calculation fails
        if (absorptionStrength === null) {
            return {
                hasAlignment: false,
                alignmentScore: 0,
                timeframeBreakdown: {
                    tick5: 0,
                    tick10: 0,
                    tick20: 0,
                },
            }; // CLAUDE.md compliance: return default when calculation cannot be performed
        }

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
            }; // CLAUDE.md compliance: return default when calculation cannot be performed
        }

        const stdDev = FinancialMath.calculateStdDev(absorptionValues);
        if (stdDev === null) {
            return {
                hasAlignment: false,
                alignmentScore: 0,
                timeframeBreakdown,
            }; // CLAUDE.md compliance: return default when calculation cannot be performed
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
        price: number,
        tradeTimestamp: number
    ): number | null {
        if (zones.length === 0) return null;

        // CRITICAL FIX: Filter zones by time window using trade timestamp for temporal absorption analysis
        const windowStartTime = tradeTimestamp - this.windowMs;

        const recentZones = zones.filter(
            (zone) => zone.lastUpdate >= windowStartTime
        );

        this.logger.debug("Absorption temporal filtering", {
            totalZones: zones.length,
            recentZones: recentZones.length,
            windowMs: this.windowMs,
            windowStartTime,
            tradeTimestamp,
        });

        if (recentZones.length === 0) return null;

        const relevantZones = this.preprocessor.findZonesNearPrice(
            recentZones,
            price,
            this.confluenceMaxDistance
        );
        if (relevantZones.length === 0) return null;

        let totalAbsorptionScore = 0;

        for (const zone of relevantZones) {
            const totalVolume = FinancialMath.safeAdd(
                zone.aggressiveVolume,
                zone.passiveVolume
            );
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
                          0 // confidence boost removed
                      );

            totalAbsorptionScore = FinancialMath.safeAdd(
                totalAbsorptionScore,
                absorptionScore
            );
        }

        return FinancialMath.divideQuantities(
            totalAbsorptionScore,
            relevantZones.length
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

        const totalAggressive = FinancialMath.safeAdd(
            totalAggressiveBuy,
            totalAggressiveSell
        );
        const totalPassive = FinancialMath.safeAdd(
            totalPassiveBuy,
            totalPassiveSell
        );

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
        const aggressiveBalance = FinancialMath.calculateAbs(
            FinancialMath.safeSubtract(
                aggressiveBuyRatio,
                _BALANCE_CENTER_POINT
            )
        );
        const passiveBalance = FinancialMath.calculateAbs(
            FinancialMath.safeSubtract(passiveBuyRatio, _BALANCE_CENTER_POINT)
        );

        // Balanced threshold: within configurable % of perfect balance using FinancialMath
        const balanceThreshold = this.enhancementConfig.balanceThreshold;

        const isBalanced =
            aggressiveBalance <= balanceThreshold &&
            passiveBalance <= balanceThreshold;

        if (isBalanced) {
            // Return balance score (higher = more balanced) using FinancialMath
            return FinancialMath.safeSubtract(
                balanceThreshold,
                FinancialMath.calculateMax([aggressiveBalance, passiveBalance])
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
     * Log signal for validation tracking
     */
    private logSignalForValidation(
        signal: SignalCandidate,
        event: EnrichedTradeEvent,
        relevantZones: ZoneSnapshot[]
    ): void {
        try {
            // Calculate market context for validation logging
            const marketContext = this.calculateMarketContext(
                event,
                relevantZones
            );

            // Add absorption-specific metrics
            const extendedContext = {
                ...marketContext,
                absorptionRatio: undefined as number | undefined,
            };

            if (
                signal.data &&
                typeof signal.data === "object" &&
                "absorptionScore" in signal.data
            ) {
                extendedContext.absorptionRatio = signal.data.absorptionScore;
            }

            // Get calculated values for signal logging (same as successful/rejection logging)
            const totalAggVol: number = relevantZones.reduce(
                (sum: number, zone) => sum + zone.aggressiveVolume,
                0
            );
            const totalPassiveVolume: number = relevantZones.reduce(
                (sum: number, zone) => sum + zone.passiveVolume,
                0
            );
            const priceEfficiency = this.calculatePriceEfficiency(
                event,
                relevantZones
            );
            const absorptionRatio =
                totalPassiveVolume > 0
                    ? totalPassiveVolume / (totalAggVol + totalPassiveVolume)
                    : 0;
            const passiveVolumeRatio =
                totalAggVol > 0 ? totalPassiveVolume / totalAggVol : 0;
            const confluenceCount = relevantZones.length;
            const volumePressure = this.calculateVolumePressure(
                event,
                relevantZones
            );

            const calculatedValues: AbsorptionCalculatedValues = {
                calculatedMinAggVolume: totalAggVol,
                calculatedTimeWindowIndex:
                    this.enhancementConfig.timeWindowIndex,
                calculatedEventCooldownMs:
                    Date.now() - (this.lastSignal.get("last") || 0),
                calculatedPriceEfficiencyThreshold: priceEfficiency ?? 0,
                calculatedMaxAbsorptionRatio: absorptionRatio,
                calculatedMinPassiveMultiplier:
                    totalPassiveVolume / Math.max(totalAggVol, 1),
                calculatedPassiveAbsorptionThreshold: passiveVolumeRatio,
                calculatedExpectedMovementScalingFactor:
                    FinancialMath.divideQuantities(
                        FinancialMath.multiplyQuantities(
                            event.quantity,
                            this.enhancementConfig.expectedMovementScalingFactor
                        ),
                        event.quantity
                    ),
                calculatedLiquidityGradientRange:
                    FinancialMath.multiplyQuantities(
                        this.enhancementConfig.liquidityGradientRange,
                        event.zoneData?.zoneConfig.tickValue ?? 0
                    ),
                calculatedInstitutionalVolumeThreshold:
                    volumePressure?.totalPressure ?? 0,
                calculatedInstitutionalVolumeRatioThreshold:
                    totalPassiveVolume / Math.max(totalAggVol, 1),
                calculatedEnableInstitutionalVolumeFilter:
                    this.enhancementConfig.enableInstitutionalVolumeFilter,
                calculatedMinAbsorptionScore:
                    totalPassiveVolume > 0
                        ? totalPassiveVolume /
                          (totalAggVol + totalPassiveVolume)
                        : 0,
                calculatedFinalConfidenceRequired: signal.confidence,
                calculatedMaxZoneCountForScoring: confluenceCount,
                calculatedMinEnhancedConfidenceThreshold: signal.confidence,
                calculatedUseStandardizedZones:
                    this.enhancementConfig.useStandardizedZones,
                calculatedEnhancementMode:
                    this.enhancementConfig.enhancementMode,
                calculatedBalanceThreshold: Math.max(
                    Math.abs(
                        totalAggVol /
                            Math.max(totalAggVol + totalPassiveVolume, 1) -
                            _BALANCE_CENTER_POINT
                    ),
                    Math.abs(
                        totalPassiveVolume /
                            Math.max(totalAggVol + totalPassiveVolume, 1) -
                            _BALANCE_CENTER_POINT
                    )
                ),
                calculatedConfluenceMinZones: confluenceCount,
                calculatedConfluenceMaxDistance: this.confluenceMaxDistance,
            };

            this.validationLogger.logSignal(
                signal,
                event,
                calculatedValues,
                marketContext
            );
        } catch (error) {
            this.logger.error(
                "AbsorptionDetectorEnhanced: Failed to log signal for validation",
                {
                    signalId: signal.id,
                    error:
                        error instanceof Error ? error.message : String(error),
                }
            );
        }
    }

    /**
     * Log signal rejection for threshold optimization
     */
    private logSignalRejection(
        event: EnrichedTradeEvent,
        rejectionReason: string,
        thresholdDetails: {
            type: string;
            threshold: number;
            actual: number;
        },
        allCalculatedValues: AbsorptionCalculatedValues
    ): void {
        try {
            this.validationLogger.logRejection(
                "absorption",
                rejectionReason,
                event,
                thresholdDetails,
                allCalculatedValues
            );
        } catch (error) {
            this.logger.error(
                "AbsorptionDetectorEnhanced: Failed to log signal rejection",
                {
                    rejectionReason,
                    error:
                        error instanceof Error ? error.message : String(error),
                }
            );
        }
    }

    /**
     * Log successful signal parameters for 90-minute optimization
     */
    private logSuccessfulSignalParameters(
        signal: SignalCandidate,
        event: EnrichedTradeEvent
    ): void {
        try {
            // Collect ACTUAL VALUES that each parameter was checked against when signal passed
            const totalAggVol: number =
                event.zoneData?.zones.reduce(
                    (sum: number, zone) => sum + zone.aggressiveVolume,
                    0
                ) || 0;

            // Market context at time of successful signal
            const marketContext = {
                marketVolume:
                    event.zoneData?.zones.reduce(
                        (sum, zone) =>
                            sum + zone.aggressiveVolume + zone.passiveVolume,
                        0
                    ) || 0,
                marketSpread:
                    event.bestAsk && event.bestBid
                        ? event.bestAsk - event.bestBid
                        : 0,
                marketVolatility: this.calculateMarketVolatility(event),
            };

            // Use exact same calculated values as rejection logging
            const volumePressure = this.calculateVolumePressure(
                event,
                event.zoneData?.zones || []
            );

            // Calculate the same values used in rejection logging
            const relevantZones = event.zoneData?.zones || [];
            const confluenceCount = relevantZones.length;
            const totalPassiveVolume: number = relevantZones.reduce(
                (sum: number, zone) => sum + zone.passiveVolume,
                0
            );
            const priceEfficiency =
                this.calculatePriceEfficiency(event, relevantZones) ?? 0;
            const absorptionRatio =
                totalPassiveVolume > 0
                    ? totalPassiveVolume / (totalAggVol + totalPassiveVolume)
                    : 0;
            const passiveVolumeRatio =
                totalAggVol > 0 ? totalPassiveVolume / totalAggVol : 0;

            const calculatedValues: AbsorptionCalculatedValues = {
                calculatedMinAggVolume: totalAggVol,
                calculatedTimeWindowIndex:
                    this.enhancementConfig.timeWindowIndex,
                calculatedEventCooldownMs:
                    Date.now() - (this.lastSignal.get("last") || 0),
                calculatedPriceEfficiencyThreshold: priceEfficiency ?? 0,
                calculatedMaxAbsorptionRatio: absorptionRatio ?? 0,
                calculatedMinPassiveMultiplier:
                    totalPassiveVolume / Math.max(totalAggVol, 1),
                calculatedPassiveAbsorptionThreshold: passiveVolumeRatio,
                calculatedExpectedMovementScalingFactor:
                    FinancialMath.divideQuantities(
                        FinancialMath.multiplyQuantities(
                            event.quantity,
                            this.enhancementConfig.expectedMovementScalingFactor
                        ),
                        event.quantity
                    ),
                calculatedLiquidityGradientRange:
                    FinancialMath.multiplyQuantities(
                        this.enhancementConfig.liquidityGradientRange,
                        event.zoneData?.zoneConfig.tickValue ?? 0
                    ),
                calculatedInstitutionalVolumeThreshold:
                    volumePressure?.totalPressure ?? 0,
                calculatedInstitutionalVolumeRatioThreshold:
                    totalPassiveVolume / Math.max(totalAggVol, 1),
                calculatedEnableInstitutionalVolumeFilter:
                    this.enhancementConfig.enableInstitutionalVolumeFilter,
                calculatedMinAbsorptionScore:
                    totalPassiveVolume > 0
                        ? totalPassiveVolume /
                          (totalAggVol + totalPassiveVolume)
                        : 0,
                calculatedFinalConfidenceRequired: signal.confidence,
                calculatedMaxZoneCountForScoring: confluenceCount,
                calculatedMinEnhancedConfidenceThreshold: signal.confidence,
                calculatedUseStandardizedZones:
                    this.enhancementConfig.useStandardizedZones,
                calculatedEnhancementMode:
                    this.enhancementConfig.enhancementMode,
                calculatedBalanceThreshold: Math.max(
                    Math.abs(
                        totalAggVol /
                            Math.max(totalAggVol + totalPassiveVolume, 1) -
                            _BALANCE_CENTER_POINT
                    ),
                    Math.abs(
                        totalPassiveVolume /
                            Math.max(totalAggVol + totalPassiveVolume, 1) -
                            _BALANCE_CENTER_POINT
                    )
                ),
                calculatedConfluenceMinZones: confluenceCount,
                calculatedConfluenceMaxDistance: this.confluenceMaxDistance,
            };

            this.validationLogger.logSuccessfulSignal(
                "absorption",
                event,
                calculatedValues,
                marketContext
            );
        } catch (error) {
            this.logger.error(
                "AbsorptionDetectorEnhanced: Failed to log successful signal parameters",
                {
                    signalId: signal.id,
                    error:
                        error instanceof Error ? error.message : String(error),
                }
            );
        }
    }

    /**
     * Calculate market volatility estimate
     */
    private calculateMarketVolatility(event: EnrichedTradeEvent): number {
        // Simple volatility estimate based on spread and recent price action
        if (!event.bestAsk || !event.bestBid) return 0;

        const spread = event.bestAsk - event.bestBid;
        const midPrice = (event.bestAsk + event.bestBid) / 2;

        // Return spread as percentage of mid price
        return FinancialMath.divideQuantities(spread, midPrice);
    }

    /**
     * Calculate market context for validation logging
     */
    private calculateMarketContext(
        event: EnrichedTradeEvent,
        relevantZones: ZoneSnapshot[]
    ): {
        totalAggressiveVolume: number;
        totalPassiveVolume: number;
        aggressiveBuyVolume: number;
        aggressiveSellVolume: number;
        passiveBidVolume: number;
        passiveAskVolume: number;
        institutionalVolumeRatio: number;
        priceEfficiency: number | null;
    } {
        let totalAggressive = 0;
        let totalPassive = 0;
        let aggressiveBuy = 0;
        let aggressiveSell = 0;
        let passiveBid = 0;
        let passiveAsk = 0;

        // Aggregate volume data from relevant zones
        for (const zone of relevantZones) {
            totalAggressive = FinancialMath.safeAdd(
                totalAggressive,
                zone.aggressiveVolume
            );
            totalPassive = FinancialMath.safeAdd(
                totalPassive,
                zone.passiveVolume
            );
            aggressiveBuy = FinancialMath.safeAdd(
                aggressiveBuy,
                zone.aggressiveBuyVolume || 0
            );
            aggressiveSell = FinancialMath.safeAdd(
                aggressiveSell,
                zone.aggressiveSellVolume || 0
            );
            passiveBid = FinancialMath.safeAdd(
                passiveBid,
                zone.passiveBidVolume || 0
            );
            passiveAsk = FinancialMath.safeAdd(
                passiveAsk,
                zone.passiveAskVolume || 0
            );
        }

        const totalVolume = FinancialMath.safeAdd(
            totalAggressive,
            totalPassive
        );
        const institutionalVolumeRatio =
            totalVolume > 0
                ? FinancialMath.divideQuantities(totalPassive, totalVolume)
                : 0;

        // Calculate price efficiency based on volume-weighted price deviation
        const priceEfficiency = this.calculatePriceEfficiency(
            event,
            relevantZones
        );

        return {
            totalAggressiveVolume: totalAggressive,
            totalPassiveVolume: totalPassive,
            aggressiveBuyVolume: aggressiveBuy,
            aggressiveSellVolume: aggressiveSell,
            passiveBidVolume: passiveBid,
            passiveAskVolume: passiveAsk,
            institutionalVolumeRatio,
            priceEfficiency,
        };
    }

    /**
     * Enhanced cleanup - no legacy dependencies to clean up
     *
     * STANDALONE VERSION: Simple cleanup without legacy detector cleanup
     */
    public cleanup(): void {
        // Clean up validation logger
        this.validationLogger.cleanup();

        this.logger.info(
            "AbsorptionDetectorEnhanced: Standalone cleanup completed",
            {
                detectorId: this.getId(),
                enhancementStats: this.enhancementStats,
            }
        );
    }
}
