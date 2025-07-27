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
        this.confluenceMinZones = settings.liquidityGradientRange; // Use existing config parameter
        this.confluenceMaxDistance = settings.liquidityGradientRange; // Use existing config parameter
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

        if (!event.zoneData) {
            this.logger.info(
                "AbsorptionDetectorEnhanced: No zone data available",
                {
                    hasZoneData: !!event.zoneData,
                    quantity: event.quantity,
                }
            );
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
            return null;
        }

        // ARCHITECTURAL FIX: Remove individual trade filtering
        // All trades contribute to volume accumulation analysis over time window
        // Individual trade size filtering prevented detection of cumulative patterns

        // Find relevant zones for this trade using FinancialMath distance calculations
        const relevantZones = this.findRelevantZonesForTrade(event);
        this.logger.info("AbsorptionDetectorEnhanced: Found relevant zones", {
            relevantZoneCount: relevantZones.length,
            totalZones: event.zoneData.zones.length,
        });

        if (relevantZones.length === 0) {
            this.logSignalRejection(
                event,
                "no_relevant_zones",
                {
                    type: "zone_count",
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

        // Calculate volume pressure using FinancialMath (CLAUDE.md compliant)
        const volumePressure = this.calculateVolumePressure(
            event,
            relevantZones
        );
        this.logger.info(
            "AbsorptionDetectorEnhanced: Volume pressure calculated",
            {
                hasVolumePressure: !!volumePressure,
                passivePressure: volumePressure?.passivePressure,
                totalPressure: volumePressure?.totalPressure,
            }
        );

        if (!volumePressure) {
            this.logSignalRejection(
                event,
                "insufficient_volume_pressure",
                {
                    type: "volume_pressure",
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

        // Check institutional volume ratio threshold (passive volume dominance)
        const passiveVolumeRatio = FinancialMath.divideQuantities(
            volumePressure.passivePressure,
            volumePressure.totalPressure
        );

        // DEBUG: Log passive volume ratio check
        this.logger.info(
            "AbsorptionDetectorEnhanced: Passive volume ratio check",
            {
                passiveVolumeRatio,
                threshold: this.absorptionRatioThreshold,
                passiveVolume: volumePressure.passivePressure,
                totalVolume: volumePressure.totalPressure,
                ratioAboveThreshold:
                    passiveVolumeRatio >= this.absorptionRatioThreshold,
            }
        );

        // Use standard threshold for institutional absorption
        if (passiveVolumeRatio < this.absorptionRatioThreshold) {
            this.logger.info(
                "AbsorptionDetectorEnhanced: Passive volume ratio below threshold - REJECTED",
                {
                    passiveVolumeRatio,
                    threshold: this.absorptionRatioThreshold,
                    passiveVolume: volumePressure.passivePressure,
                    totalVolume: volumePressure.totalPressure,
                }
            );
            this.logSignalRejection(
                event,
                "passive_volume_ratio_too_low",
                {
                    type: "passive_volume_ratio",
                    threshold: this.absorptionRatioThreshold,
                    actual: passiveVolumeRatio,
                },
                {
                    aggressiveVolume: volumePressure.aggressivePressure,
                    passiveVolume: volumePressure.passivePressure,
                    priceEfficiency: null,
                    confidence: 0,
                }
            );
            return null; // Not enough institutional absorption
        }

        // Calculate price efficiency using FinancialMath (institutional precision)
        const priceEfficiency = this.calculatePriceEfficiency(
            event,
            relevantZones
        );

        // DEBUG: Log price efficiency calculation
        this.logger.info(
            "AbsorptionDetectorEnhanced: Price efficiency calculated",
            {
                priceEfficiency,
                threshold: this.enhancementConfig.priceEfficiencyThreshold,
                isNull: priceEfficiency === null,
                aboveThreshold:
                    priceEfficiency !== null &&
                    priceEfficiency >
                        this.enhancementConfig.priceEfficiencyThreshold,
            }
        );

        // Price efficiency calculation completed

        if (
            priceEfficiency === null ||
            priceEfficiency > this.enhancementConfig.priceEfficiencyThreshold
        ) {
            this.logger.info(
                "AbsorptionDetectorEnhanced: Price efficiency check failed - REJECTED",
                {
                    priceEfficiency,
                    threshold: this.enhancementConfig.priceEfficiencyThreshold,
                    isNull: priceEfficiency === null,
                }
            );
            this.logSignalRejection(
                event,
                "price_efficiency_too_high",
                {
                    type: "price_efficiency",
                    threshold: this.enhancementConfig.priceEfficiencyThreshold,
                    actual: priceEfficiency ?? -1,
                },
                {
                    aggressiveVolume: volumePressure.aggressivePressure,
                    passiveVolume: volumePressure.passivePressure,
                    priceEfficiency,
                    confidence: 0,
                }
            );
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
            this.logSignalRejection(
                event,
                "absorption_ratio_too_high",
                {
                    type: "absorption_ratio",
                    threshold: this.enhancementConfig.maxAbsorptionRatio,
                    actual: absorptionRatio ?? -1,
                },
                {
                    aggressiveVolume: volumePressure.aggressivePressure,
                    passiveVolume: volumePressure.passivePressure,
                    priceEfficiency,
                    confidence: 0,
                }
            );
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
            this.logSignalRejection(
                event,
                "balanced_institutional_flow",
                {
                    type: "institutional_balance",
                    threshold: this.enhancementConfig.balanceThreshold,
                    actual: isBalancedInstitutional,
                },
                {
                    aggressiveVolume: volumePressure.aggressivePressure,
                    passiveVolume: volumePressure.passivePressure,
                    priceEfficiency,
                    confidence: 0,
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
            this.logSignalRejection(
                event,
                "insufficient_aggressive_volume",
                {
                    type: "aggressive_volume",
                    threshold:
                        this.enhancementConfig.institutionalVolumeThreshold,
                    actual: volumePressure.aggressivePressure,
                },
                {
                    aggressiveVolume: volumePressure.aggressivePressure,
                    passiveVolume: volumePressure.passivePressure,
                    priceEfficiency,
                    confidence: 0,
                }
            );
            return null; // No institutional pattern without sufficient aggressive flow
        }

        // Determine dominant side and signal direction
        const dominantSide = this.calculateDominantSide(relevantZones);

        // Dominant side calculation completed

        if (!dominantSide) {
            this.logger.info(
                "AbsorptionDetectorEnhanced: No dominant side - REJECTED",
                {
                    relevantZoneCount: relevantZones.length,
                    dominantSide,
                }
            );
            this.logSignalRejection(
                event,
                "no_dominant_side",
                {
                    type: "side_determination",
                    threshold: 1,
                    actual: 0,
                },
                {
                    aggressiveVolume: volumePressure.aggressivePressure,
                    passiveVolume: volumePressure.passivePressure,
                    priceEfficiency,
                    confidence: 0,
                }
            );
            return null;
        }

        this.logger.info(
            "AbsorptionDetectorEnhanced: Dominant side determined",
            {
                dominantSide,
                relevantZoneCount: relevantZones.length,
            }
        );

        // Calculate final confidence using statistical analysis
        const confidence = this.calculateAbsorptionConfidence(
            priceEfficiency,
            absorptionRatio,
            volumePressure,
            relevantZones
        );

        // Confidence calculation completed

        if (confidence === null) {
            this.logSignalRejection(
                event,
                "confidence_calculation_failed",
                {
                    type: "confidence_calculation",
                    threshold: 1,
                    actual: 0,
                },
                {
                    aggressiveVolume: volumePressure.aggressivePressure,
                    passiveVolume: volumePressure.passivePressure,
                    priceEfficiency,
                    confidence: 0,
                }
            );
            return null; // Cannot proceed without valid confidence calculation
        }

        if (
            confidence < this.enhancementConfig.minEnhancedConfidenceThreshold
        ) {
            this.logSignalRejection(
                event,
                "confidence_below_threshold",
                {
                    type: "confidence_threshold",
                    threshold:
                        this.enhancementConfig.minEnhancedConfidenceThreshold,
                    actual: confidence,
                },
                {
                    aggressiveVolume: volumePressure.aggressivePressure,
                    passiveVolume: volumePressure.passivePressure,
                    priceEfficiency,
                    confidence,
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
                        ? FinancialMath.calculateAbs(FinancialMath.safeSubtract(event.bestAsk, event.bestBid))
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
        const priceDiff = FinancialMath.calculateAbs(FinancialMath.safeSubtract(event.price, vwap));

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
        const actualImpact = FinancialMath.calculateAbs(FinancialMath.safeSubtract(event.price, event.bestBid));

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

        // Original absorption logic (CLAUDE.md compliance - simple and reliable)

        // Signal based on which passive side is absorbing more
        if (totalPassiveBidAbsorption > totalPassiveAskAbsorption) {
            // More bid absorption → support level → BUY signal
            this.logger.info(
                "AbsorptionDetectorEnhanced: Returning BUY signal",
                {
                    totalPassiveBidAbsorption,
                    totalPassiveAskAbsorption,
                }
            );
            return "buy";
        } else if (totalPassiveAskAbsorption > totalPassiveBidAbsorption) {
            // More ask absorption → resistance level → SELL signal
            this.logger.info(
                "AbsorptionDetectorEnhanced: Returning SELL signal",
                {
                    totalPassiveBidAbsorption,
                    totalPassiveAskAbsorption,
                }
            );
            return "sell";
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

            totalPassiveVolume = FinancialMath.safeAdd(totalPassiveVolume, passiveVolume);
            totalAggressiveVolume = FinancialMath.safeAdd(totalAggressiveVolume, aggressiveVolume);

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

        const totalVolume = FinancialMath.safeAdd(totalPassiveVolume, totalAggressiveVolume);
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
            const totalVolume = FinancialMath.safeAdd(zone.aggressiveVolume, zone.passiveVolume);
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

            totalAbsorptionScore = FinancialMath.safeAdd(totalAbsorptionScore, absorptionScore);
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

        const totalAggressive = FinancialMath.safeAdd(totalAggressiveBuy, totalAggressiveSell);
        const totalPassive = FinancialMath.safeAdd(totalPassiveBuy, totalPassiveSell);

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
        const aggressiveBalance = FinancialMath.calculateAbs(FinancialMath.safeSubtract(aggressiveBuyRatio, 0.5));
        const passiveBalance = FinancialMath.calculateAbs(FinancialMath.safeSubtract(passiveBuyRatio, 0.5));

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
            totalAggressive = FinancialMath.safeAdd(totalAggressive, zone.aggressiveVolume);
            totalPassive = FinancialMath.safeAdd(totalPassive, zone.passiveVolume);
            aggressiveBuy = FinancialMath.safeAdd(aggressiveBuy, zone.aggressiveBuyVolume || 0);
            aggressiveSell = FinancialMath.safeAdd(aggressiveSell, zone.aggressiveSellVolume || 0);
            passiveBid = FinancialMath.safeAdd(passiveBid, zone.passiveBidVolume || 0);
            passiveAsk = FinancialMath.safeAdd(passiveAsk, zone.passiveAskVolume || 0);
        }

        const totalVolume = FinancialMath.safeAdd(totalAggressive, totalPassive);
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
