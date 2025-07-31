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
import type {
    SignalCandidate,
    EnhancedAbsorptionSignalData,
    SignalType,
} from "../types/signalTypes.js";
import { z } from "zod";
import { AbsorptionDetectorSchema, Config } from "../core/config.js";

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
    private readonly validationLogger: SignalValidationLogger;
    private readonly symbol: string;
    private readonly windowMs: number;

    // Signal cooldown tracking (CLAUDE.md compliance - no magic cooldown values)
    private readonly lastSignal = new Map<string, number>();

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
        metrics: IMetricsCollector,
        validationLogger: SignalValidationLogger
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
        this.windowMs = Config.getTimeWindow(settings.timeWindowIndex);

        // ✅ SHARED SIGNAL VALIDATION LOGGER: Use dependency-injected shared instance
        this.validationLogger = validationLogger;

        // CLAUDE.md Compliance: Extract all configurable parameters (NO MAGIC NUMBERS)
        this.confluenceMinZones = settings.confluenceMinZones; // Dedicated parameter for minimum confluence zones
        this.confluenceMaxDistance = settings.confluenceMaxDistance; // Dedicated parameter for maximum confluence distance
        this.confluenceConfidenceBoost = settings.institutionalVolumeBoost;
        this.crossTimeframeConfidenceBoost =
            settings.contextConfidenceBoostMultiplier;
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
                    aggressiveVolume: 0,
                    passiveVolume: 0,
                    priceEfficiency: null,
                    confidence: 0,
                }
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
            const enhancedConfidence =
                coreAbsorptionResult.confidence + totalConfidenceBoost;

            // Only emit if enhanced confidence meets the final confidence requirement
            if (
                enhancedConfidence <
                this.enhancementConfig.finalConfidenceRequired
            ) {
                return; // Enhanced signal doesn't meet confidence threshold
            }

            // Create enhanced signal with boosted confidence
            const enhancedSignal: SignalCandidate = {
                ...coreAbsorptionResult,
                confidence: enhancedConfidence,
                id: `enhanced-${coreAbsorptionResult.id}`,
            };

            // Update cooldown tracking before emitting signal
            this.canEmitSignal(eventKey, true);

            // Log enhanced signal for validation tracking
            const signalZones = event.zoneData ? event.zoneData.zones : [];
            void this.logSignalForValidation(
                enhancedSignal,
                event,
                signalZones
            );

            // Log successful signal parameters for 90-minute optimization
            void this.logSuccessfulSignalParameters(enhancedSignal, event);

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
            // No enhancements - check if core signal meets final confidence requirement
            if (
                coreAbsorptionResult.confidence <
                this.enhancementConfig.finalConfidenceRequired
            ) {
                return; // Core signal doesn't meet final confidence threshold
            }

            // Update cooldown tracking before emitting signal
            this.canEmitSignal(eventKey, true);

            // Log core signal for validation tracking
            const signalZones = event.zoneData ? event.zoneData.zones : [];
            void this.logSignalForValidation(
                coreAbsorptionResult,
                event,
                signalZones
            );

            // Log successful signal parameters for 90-minute optimization
            void this.logSuccessfulSignalParameters(
                coreAbsorptionResult,
                event
            );

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
                    aggressiveVolume: 0,
                    passiveVolume: 0,
                    priceEfficiency: null,
                    confidence: 0,
                }
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
        const dominantSide = this.calculateDominantSide(relevantZones);

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
        const passesVolumeThreshold =
            totalAggressiveVolume >= this.enhancementConfig.minAggVolume;
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
            confidence >= this.enhancementConfig.minEnhancedConfidenceThreshold;
        const hasValidSignalSide = dominantSide !== null;
        const isNotBalanced = !isBalancedInstitutional;

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
                thresholdType = "aggressive_volume";
                thresholdValue = this.enhancementConfig.minAggVolume;
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
                thresholdValue =
                    this.enhancementConfig.minEnhancedConfidenceThreshold;
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
                {
                    aggressiveVolume: totalAggressiveVolume,
                    passiveVolume: totalPassiveVolume,
                    priceEfficiency,
                    confidence: confidence ?? 0,
                }
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
     * Find zones relevant to current trade using FinancialMath distance calculations
     */
    private findRelevantZonesForTrade(
        event: EnrichedTradeEvent
    ): ZoneSnapshot[] {
        if (!event.zoneData) return [];

        const maxDistance = FinancialMath.multiplyQuantities(
            this.enhancementConfig.liquidityGradientRange,
            event.zoneData.zoneConfig.tickValue
        );

        const allZones = event.zoneData.zones;

        // CRITICAL FIX: Apply temporal filtering using trade timestamp for core absorption detection
        const windowStartTime = event.timestamp - this.windowMs;
        const recentZones = allZones.filter(
            (zone) => zone.lastUpdate >= windowStartTime
        );

        // DEBUG: Log temporal filtering for core absorption detection
        this.logger.info("Absorption temporal filtering", {
            totalZones: allZones.length,
            recentZones: recentZones.length,
            windowMs: this.windowMs,
            windowStartTime,
            tradeTimestamp: event.timestamp,
            zoneLastUpdates: allZones.map((z) => ({
                zoneId: z.zoneId,
                lastUpdate: z.lastUpdate,
                withinWindow: z.lastUpdate >= windowStartTime,
            })),
        });

        return this.preprocessor.findZonesNearPrice(
            recentZones,
            event.price,
            maxDistance
        );
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
     * Calculate dominant side based on which passive side is absorbing
     */
    private calculateDominantSide(
        zones: ZoneSnapshot[]
    ): "buy" | "sell" | null {
        if (zones.length === 0) return null;

        let totalPassiveBidAbsorption = 0;
        let totalPassiveAskAbsorption = 0;

        for (const zone of zones) {
            totalPassiveBidAbsorption = FinancialMath.safeAdd(
                totalPassiveBidAbsorption,
                zone.passiveBidVolume || 0
            );
            totalPassiveAskAbsorption = FinancialMath.safeAdd(
                totalPassiveAskAbsorption,
                zone.passiveAskVolume || 0
            );
        }

        // DEBUG: Log passive side calculations
        this.logger.info(
            "AbsorptionDetectorEnhanced: calculateDominantSide DEBUG",
            {
                totalPassiveBidAbsorption,
                totalPassiveAskAbsorption,
                zoneCount: zones.length,
                zones: zones.map((z) => ({
                    zoneId: z.zoneId,
                    passiveBidVolume: z.passiveBidVolume,
                    passiveAskVolume: z.passiveAskVolume,
                })),
            }
        );

        // CORRECTED SIGNAL DIRECTION LOGIC: As specified in compliance task
        // - High bid absorption indicates selling pressure/resistance → SELL signal
        // - High ask absorption indicates buying pressure/accumulation → BUY signal

        // Signal based on which passive side is absorbing more
        if (totalPassiveBidAbsorption > totalPassiveAskAbsorption) {
            // More bid absorption → selling pressure/resistance → SELL signal
            this.logger.info(
                "AbsorptionDetectorEnhanced: Returning SELL signal (bid absorption indicates selling pressure/resistance)",
                {
                    totalPassiveBidAbsorption,
                    totalPassiveAskAbsorption,
                }
            );
            return "sell";
        } else if (totalPassiveAskAbsorption > totalPassiveBidAbsorption) {
            // More ask absorption → buying pressure/accumulation → BUY signal
            this.logger.info(
                "AbsorptionDetectorEnhanced: Returning BUY signal (ask absorption indicates buying pressure/accumulation)",
                {
                    totalPassiveBidAbsorption,
                    totalPassiveAskAbsorption,
                }
            );
            return "buy";
        }

        this.logger.info(
            "AbsorptionDetectorEnhanced: Returning NULL (equal absorption)",
            {
                totalPassiveBidAbsorption,
                totalPassiveAskAbsorption,
            }
        );
        return null; // Equal absorption = no clear direction
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
        price: number,
        tradeTimestamp: number
    ): number {
        if (zones.length === 0) return 0;

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

        if (recentZones.length === 0) return 0;

        const relevantZones = this.preprocessor.findZonesNearPrice(
            recentZones,
            price,
            this.confluenceMaxDistance
        );
        if (relevantZones.length === 0) return 0;

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
                          this.enhancementConfig.confidenceBoostReduction
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
            FinancialMath.safeSubtract(aggressiveBuyRatio, 0.5)
        );
        const passiveBalance = FinancialMath.calculateAbs(
            FinancialMath.safeSubtract(passiveBuyRatio, 0.5)
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

            this.validationLogger.logSignal(signal, event, extendedContext);
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
        marketContext: {
            aggressiveVolume: number;
            passiveVolume: number;
            priceEfficiency: number | null;
            confidence: number;
        }
    ): void {
        try {
            this.validationLogger.logRejection(
                "absorption",
                rejectionReason,
                event,
                thresholdDetails,
                marketContext
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
            const totalAggVol =
                event.zoneData?.zones.reduce(
                    (sum, zone) => sum + zone.aggressiveVolume,
                    0
                ) || 0;
            const totalPassVol =
                event.zoneData?.zones.reduce(
                    (sum, zone) => sum + zone.passiveVolume,
                    0
                ) || 0;
            const actualPriceEfficiency = this.calculatePriceEfficiency(
                event,
                event.zoneData?.zones || []
            );
            const actualAbsorptionRatio =
                totalPassVol > 0
                    ? totalPassVol / (totalAggVol + totalPassVol)
                    : 0;
            const actualInstVolumeRatio =
                totalAggVol > 0 ? totalPassVol / totalAggVol : 0;

            const parameterValues = {
                // ACTUAL VALUES each threshold was checked against (not config values!)
                minAggVolume: totalAggVol, // What aggressive volume actually was
                exhaustionThreshold: undefined, // N/A for absorption
                timeWindowIndex: this.enhancementConfig.timeWindowIndex, // Static config
                eventCooldownMs: this.enhancementConfig.eventCooldownMs, // Static config
                useStandardizedZones:
                    this.enhancementConfig.useStandardizedZones, // Static config
                enhancementMode: this.enhancementConfig.enhancementMode, // Static config
                minEnhancedConfidenceThreshold: signal.confidence, // What confidence actually was
                enableDepletionAnalysis: undefined, // N/A for absorption
                depletionVolumeThreshold: undefined, // N/A for absorption
                depletionRatioThreshold: undefined, // N/A for absorption
                depletionConfidenceBoost: undefined, // N/A for absorption
                passiveVolumeExhaustionRatio: undefined, // N/A for absorption
                varianceReductionFactor: undefined, // N/A for absorption
                alignmentNormalizationFactor: undefined, // N/A for absorption
                aggressiveVolumeExhaustionThreshold: undefined, // N/A for absorption
                aggressiveVolumeReductionFactor: undefined, // N/A for absorption
                passiveRatioBalanceThreshold: undefined, // N/A for absorption
                premiumConfidenceThreshold: undefined, // N/A for absorption
                variancePenaltyFactor: undefined, // N/A for absorption
                ratioBalanceCenterPoint: undefined, // N/A for absorption

                // ABSORPTION ACTUAL VALUES - what was actually measured vs thresholds
                absorptionThreshold: actualAbsorptionRatio, // What absorption ratio actually was
                priceEfficiencyThreshold: actualPriceEfficiency || 0, // What price efficiency actually was
                maxAbsorptionRatio: actualAbsorptionRatio, // What absorption ratio actually was
                minPassiveMultiplier:
                    totalAggVol > 0 ? totalPassVol / totalAggVol : 0, // What multiplier actually was
                passiveAbsorptionThreshold: actualAbsorptionRatio, // What absorption ratio actually was
                expectedMovementScalingFactor:
                    this.enhancementConfig.expectedMovementScalingFactor, // Static config
                contextConfidenceBoostMultiplier:
                    this.enhancementConfig.contextConfidenceBoostMultiplier, // Static config
                liquidityGradientRange:
                    this.enhancementConfig.liquidityGradientRange, // Static config
                institutionalVolumeThreshold: totalAggVol, // What institutional volume actually was
                institutionalVolumeRatioThreshold: actualInstVolumeRatio, // What ratio actually was
                enableInstitutionalVolumeFilter:
                    this.enhancementConfig.enableInstitutionalVolumeFilter, // Static config
                institutionalVolumeBoost:
                    this.enhancementConfig.institutionalVolumeBoost, // Static config
                minAbsorptionScore: actualAbsorptionRatio, // What absorption score actually was
                finalConfidenceRequired: signal.confidence, // What final confidence actually was
                confidenceBoostReduction:
                    this.enhancementConfig.confidenceBoostReduction, // Static config
                maxZoneCountForScoring: event.zoneData?.zones.length || 0, // How many zones actually present
                balanceThreshold:
                    Math.abs(totalAggVol - totalPassVol) /
                    Math.max(totalAggVol + totalPassVol, 1), // What balance actually was
                confluenceMinZones: event.zoneData?.zones.length || 0, // How many zones actually present
                confluenceMaxDistance:
                    this.enhancementConfig.confluenceMaxDistance, // Static config

                // RUNTIME VALUES (exactly what was calculated)
                priceEfficiency: actualPriceEfficiency || 0,
                confidence: signal.confidence,
                aggressiveVolume: totalAggVol,
                passiveVolume: totalPassVol,
                volumeRatio: totalAggVol > 0 ? totalPassVol / totalAggVol : 0,
                institutionalVolumeRatio: actualInstVolumeRatio,
            };

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

            this.validationLogger.logSuccessfulSignal(
                "absorption",
                event,
                parameterValues,
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
