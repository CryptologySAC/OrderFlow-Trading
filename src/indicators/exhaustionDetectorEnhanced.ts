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

import { Detector } from "./base/detectorEnrichedTrade.js";
import { FinancialMath } from "../utils/financialMath.js";
import { Config } from "../core/config.js";
import { SignalValidationLogger } from "../utils/signalValidationLogger.js";
import {
    ExhaustionZoneTracker,
    type ZoneTrackerConfig,
} from "./helpers/exhaustionZoneTracker.js";
import type { ILogger } from "../infrastructure/loggerInterface.js";
import type { IMetricsCollector } from "../infrastructure/metricsCollectorInterface.js";
import type { ISignalLogger } from "../infrastructure/signalLoggerInterface.js";
import type { IOrderflowPreprocessor } from "../market/orderFlowPreprocessor.js";
import type {
    EnrichedTradeEvent,
    StandardZoneData,
    ZoneSnapshot,
} from "../types/marketEvents.js";
import type { ExhaustionCalculatedValues } from "../types/calculatedValuesTypes.js";
import type { SignalCandidate, SignalType } from "../types/signalTypes.js";
import { z } from "zod";
import { ExhaustionDetectorSchema } from "../core/config.js";

/**
 * Enhanced configuration interface for exhaustion detection - ONLY exhaustion-specific parameters
 *
 * EXHAUSTION PHASE 1: Core interface for enhanced exhaustion detection
 */
// Use Zod schema inference for complete type safety - matches config.json exactly
export type ExhaustionEnhancedSettings = z.infer<
    typeof ExhaustionDetectorSchema
>;

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
 * ExhaustionDetectorEnhanced - Standalone enhanced exhaustion detector
 *
 * STANDALONE VERSION: CLAUDE.md compliant exhaustion detection without legacy dependencies
 *
 * This enhanced detector provides sophisticated multi-timeframe exhaustion analysis using
 * Universal Zones from the preprocessor, with all parameters configurable and no magic numbers.
 */
export class ExhaustionDetectorEnhanced extends Detector {
    private readonly useStandardizedZones: boolean;
    private readonly enhancementConfig: ExhaustionEnhancedSettings;
    private readonly enhancementStats: ExhaustionEnhancementStats;
    private readonly preprocessor: IOrderflowPreprocessor;
    private readonly validationLogger: SignalValidationLogger;

    // Signal cooldown tracking (CLAUDE.md compliance - no magic cooldown values)
    private lastExhaustionSignalTs = 0;

    // CLAUDE.md compliant configuration parameters - NO MAGIC NUMBERS
    private readonly confluenceMaxDistance: number;
    private readonly exhaustionVolumeThreshold: number;
    private readonly exhaustionRatioThreshold: number;
    private readonly exhaustionScoreThreshold: number;

    // Additional configurable thresholds to replace magic numbers
    private readonly passiveRatioBalanceThreshold: number;
    private readonly premiumConfidenceThreshold: number;
    private readonly variancePenaltyFactor: number;
    private readonly ratioBalanceCenterPoint: number;
    private readonly gapDetectionTicks: number;

    // Dynamic zone tracking for true exhaustion detection
    private readonly zoneTracker: ExhaustionZoneTracker;
    private readonly enableDynamicZoneTracking: boolean;

    // Cached time window and hot-path flags
    private readonly timeWindowMs: number;
    private readonly hotPathDebugEnabled: boolean;

    // Cheap, monotonic signal id counter
    private signalCounter = 0;

    constructor(
        id: string,
        settings: ExhaustionEnhancedSettings,
        preprocessor: IOrderflowPreprocessor,
        logger: ILogger,
        metricsCollector: IMetricsCollector,
        signalLogger: ISignalLogger,
        validationLogger: SignalValidationLogger
    ) {
        // Initialize parent Detector (not ExhaustionDetector)
        super(id, logger, metricsCollector, signalLogger);

        // Initialize enhancement configuration
        this.useStandardizedZones = settings.useStandardizedZones;
        this.enhancementConfig = settings;
        this.preprocessor = preprocessor;

        // ✅ SHARED SIGNAL VALIDATION LOGGER: Use dependency-injected shared instance
        this.validationLogger = validationLogger;

        // Initialize CLAUDE.md compliant configuration parameters - NO MAGIC NUMBERS
        this.confluenceMaxDistance =
            Config.UNIVERSAL_ZONE_CONFIG.maxZoneConfluenceDistance;
        this.exhaustionVolumeThreshold = settings.minAggVolume;
        this.exhaustionRatioThreshold = settings.exhaustionThreshold;
        this.exhaustionScoreThreshold = settings.minEnhancedConfidenceThreshold;

        // Initialize additional configurable thresholds (CLAUDE.md compliance)
        this.passiveRatioBalanceThreshold =
            settings.passiveRatioBalanceThreshold;
        this.premiumConfidenceThreshold = settings.premiumConfidenceThreshold;
        this.variancePenaltyFactor = settings.variancePenaltyFactor;
        this.ratioBalanceCenterPoint = settings.ratioBalanceCenterPoint;
        this.gapDetectionTicks = settings.gapDetectionTicks;

        // Cache time window to avoid repeated Config lookups
        this.timeWindowMs = Config.getTimeWindow(settings.timeWindowIndex);

        // Gate hot-path debug logging (off in production by default)
        this.hotPathDebugEnabled =
            this.enhancementConfig.enhancementMode !== "production" &&
            process.env["NODE_ENV"] !== "production";

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

        // Initialize dynamic zone tracker for true exhaustion detection
        this.enableDynamicZoneTracking = settings.enableDynamicZoneTracking;
        const zoneTrackerConfig: ZoneTrackerConfig = {
            maxZonesPerSide: settings.maxZonesPerSide,
            historyWindowMs: this.timeWindowMs,
            depletionThreshold: settings.zoneDepletionThreshold,
            minPeakVolume: settings.minAggVolume,
            gapDetectionTicks: settings.gapDetectionTicks,
        };
        this.zoneTracker = new ExhaustionZoneTracker(
            zoneTrackerConfig,
            Config.TICK_SIZE
        );

        this.logger.info("ExhaustionDetectorEnhanced initialized", {
            detectorId: this.getId(),
            useStandardizedZones: this.useStandardizedZones,
            enhancementMode: this.enhancementConfig.enhancementMode,
        });
    }

    /**
     * Check if we can emit a signal for this detector (respects cooldown)
     * CLAUDE.md MEMORY LEAK FIX: Automatically cleans up old cooldown entries
     */
    private canEmitSignal(_eventKey: string, update: boolean = false): boolean {
        // Note: For signal cooldown, we still use Date.now() since it's system time management
        // not market data timing. This is acceptable as per architectural guidelines.
        const now = Date.now();
        const lastSignalTime = this.lastExhaustionSignalTs || 0;

        if (now - lastSignalTime <= this.enhancementConfig.eventCooldownMs) {
            return false;
        }

        if (update) {
            this.lastExhaustionSignalTs = now;
        }

        return true;
    }

    /**
     * Enhanced trade event processing with standardized zone analysis
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

        if (this.hotPathDebugEnabled) {
            this.logger.debug(
                "ExhaustionDetectorEnhanced: Processing trade",
                debugInfo
            );
        }

        this.enhancementStats.callCount++;

        try {
            // Apply standalone exhaustion analysis
            this.analyzeExhaustionPattern(event);
        } catch (error) {
            this.enhancementStats.errorCount++;
            this.logger.error("ExhaustionDetectorEnhanced: Enhancement error", {
                detectorId: this.getId(),
                error: error instanceof Error ? error.message : String(error),
                price: event.price,
                quantity: event.quantity,
            });
        }
    }

    /**
     * Core exhaustion analysis using standardized zones
     *
     * STANDALONE VERSION: Multi-timeframe exhaustion analysis
     */
    private analyzeExhaustionPattern(event: EnrichedTradeEvent): void {
        // 🔍 DEBUG: Core exhaustion detection first
        const coreExhaustionResult = this.detectCoreExhaustion(event);
        if (coreExhaustionResult) {
            // Check signal cooldown to prevent too many signals
            const eventKey = `exhaustion`; // Single cooldown for all exhaustion signals
            if (!this.canEmitSignal(eventKey)) {
                // Always log cooldown blocking for auditability and tests
                this.logger.debug(
                    "ExhaustionDetectorEnhanced: Signal blocked by cooldown",
                    {
                        detectorId: this.getId(),
                        price: event.price,
                        eventKey,
                        cooldownMs: this.enhancementConfig.eventCooldownMs,
                    }
                );
                return;
            }

            this.logger.info(
                "ExhaustionDetectorEnhanced: CORE EXHAUSTION DETECTED",
                {
                    detectorId: this.getId(),
                    price: event.price,
                    side: coreExhaustionResult.side,
                    confidence: coreExhaustionResult.confidence,
                    signalId: coreExhaustionResult.id,
                    signalType: "exhaustion",
                }
            );

            // DEFER: Core signal emission until after enhanced validation
            // This prevents signal spam by ensuring ALL signals go through quality gates
        }

        const finalSignal = coreExhaustionResult; // Start with core signal

        // Zone confluence analysis for exhaustion validation (logging only)
        if (Config.UNIVERSAL_ZONE_CONFIG.enableZoneConfluenceFilter) {
            const confluenceResult = this.analyzeZoneConfluence(
                event.zoneData,
                event.price
            );
            if (confluenceResult.hasConfluence) {
                this.enhancementStats.confluenceDetectionCount++;

                this.logger.debug(
                    "ExhaustionDetectorEnhanced: Zone confluence detected for exhaustion validation",
                    {
                        detectorId: this.getId(),
                        price: event.price,
                        confluenceZones: confluenceResult.confluenceZones,
                        confluenceStrength: confluenceResult.confluenceStrength,
                    }
                );
            }
        }

        // Liquidity depletion analysis across zones (logging only)
        if (this.enhancementConfig.enableDepletionAnalysis) {
            const depletionResult = this.analyzeLiquidityDepletion(
                event.zoneData,
                event
            );
            if (depletionResult.hasDepletion) {
                this.enhancementStats.depletionDetectionCount++;

                this.logger.debug(
                    "ExhaustionDetectorEnhanced: Liquidity depletion detected",
                    {
                        detectorId: this.getId(),
                        price: event.price,
                        depletionRatio: depletionResult.depletionRatio,
                        affectedZones: depletionResult.affectedZones,
                    }
                );
            }
        }

        // Cross-timeframe exhaustion analysis - set quality flag instead of boost
        let hasCrossTimeframeAlignment = false;
        if (Config.UNIVERSAL_ZONE_CONFIG.enableCrossTimeframeAnalysis) {
            const crossTimeframeResult = this.analyzeCrossTimeframeExhaustion(
                event.zoneData,
                event
            );
            if (crossTimeframeResult && crossTimeframeResult.hasAlignment) {
                hasCrossTimeframeAlignment = true;
                this.enhancementStats.crossTimeframeAnalysisCount++;

                this.logger.debug(
                    "ExhaustionDetectorEnhanced: Cross-timeframe exhaustion alignment",
                    {
                        detectorId: this.getId(),
                        price: event.price,
                        alignmentScore: crossTimeframeResult.alignmentScore,
                        exhaustionStrength:
                            crossTimeframeResult.exhaustionStrength,
                    }
                );
            }
        }

        // SIMPLIFIED: Unified signal emission path
        if (finalSignal && this.canEmitSignal(`exhaustion`)) {
            // Add quality flags instead of confidence boosts
            if (hasCrossTimeframeAlignment || finalSignal.qualityFlags) {
                finalSignal.qualityFlags = {
                    ...finalSignal.qualityFlags,
                    crossTimeframe: hasCrossTimeframeAlignment,
                };
            }

            // Update cooldown and emit signal
            this.canEmitSignal(`exhaustion`, true);
            void this.logSignalForValidation(
                finalSignal,
                event,
                event.zoneData?.zones || []
            );

            // Log successful signal parameters for 90-minute optimization
            void this.logSuccessfulSignalParameters(finalSignal, event);

            this.emit("signalCandidate", finalSignal);

            this.logger.info("ExhaustionDetectorEnhanced: Signal emitted", {
                detectorId: this.getId(),
                price: event.price,
                side: finalSignal.side,
                confidence: finalSignal.confidence,
                qualityFlags: finalSignal.qualityFlags,
            });
        }
    }

    /**
     * Detect core exhaustion patterns using zone data
     *
     * STANDALONE VERSION: Core exhaustion detection logic
     * ARCHITECTURAL RESTRUCTURE: Single evaluation point with complete threshold data
     */
    private detectCoreExhaustion(
        event: EnrichedTradeEvent
    ): SignalCandidate | null {
        // EARLY VALIDATION: Only check for missing/malformed data - no signal validation logging
        if (!event.zoneData) {
            this.logger.debug(
                "ExhaustionDetectorEnhanced: No zone data available"
            );
            return null;
        }

        // CLAUDE.md SIMPLIFIED: Use single zone array (no more triple-counting!)
        const allZones = event.zoneData.zones;

        if (allZones.length === 0) {
            this.logger.debug(
                "ExhaustionDetectorEnhanced: No zones available",
                {
                    zonesCount: event.zoneData.zones.length,
                }
            );
            return null;
        }

        if (this.hotPathDebugEnabled) {
            this.logger.debug(
                "ExhaustionDetectorEnhanced: Starting core exhaustion detection",
                {
                    price: event.price,
                    quantity: event.quantity,
                    minAggVolume: this.enhancementConfig.minAggVolume,
                    exhaustionVolumeThreshold: this.exhaustionVolumeThreshold,
                    exhaustionRatioThreshold: this.exhaustionRatioThreshold,
                }
            );
        }

        // FULL CALCULATION SECTION: Calculate ALL thresholds regardless of outcome

        // ARCHITECTURAL FIX: Filter zones by time window using trade timestamp
        const windowStartTime = event.timestamp - this.timeWindowMs;
        const recentZones = allZones.filter(
            (zone) => zone.lastUpdate >= windowStartTime
        );

        if (this.hotPathDebugEnabled) {
            this.logger.debug(
                "ExhaustionDetectorEnhanced: Time-window filtering",
                {
                    totalZones: allZones.length,
                    recentZones: recentZones.length,
                    windowMs: this.timeWindowMs,
                    windowStartTime,
                    tradeTimestamp: event.timestamp,
                }
            );
        }

        // Find zones near the current price from recent zones only
        let relevantZones = this.preprocessor.findZonesNearPrice(
            recentZones,
            event.price,
            this.confluenceMaxDistance
        );

        // STRUCTURAL FIX: If no zones found with primary method, find nearest zone with volume from recent zones
        if (relevantZones.length === 0) {
            if (this.hotPathDebugEnabled) {
                this.logger.debug(
                    "ExhaustionDetectorEnhanced: No zones found with primary method, using fallback",
                    {
                        price: event.price,
                        maxDistance: this.confluenceMaxDistance,
                        totalZones: allZones.length,
                        recentZones: recentZones.length,
                    }
                );
            }

            // Find the zone with the smallest distance to the trade price that has volume from recent zones
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

                if (this.hotPathDebugEnabled) {
                    this.logger.debug(
                        "ExhaustionDetectorEnhanced: Using fallback zone",
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
        }

        if (this.hotPathDebugEnabled) {
            this.logger.debug(
                "ExhaustionDetectorEnhanced: Found relevant zones",
                {
                    relevantZones: relevantZones.length,
                    maxDistance: this.confluenceMaxDistance,
                }
            );
        }

        // ARCHITECTURAL FIX: Calculate accumulated exhaustion metrics over time window
        // CRITICAL: Use only DIRECTIONAL passive volume for exhaustion
        let totalAggressiveVolume = 0;
        let totalDirectionalPassiveVolume = 0;

        // Determine trade direction for exhaustion analysis
        const isBuyTrade = !event.buyerIsMaker;

        for (const zone of relevantZones) {
            totalAggressiveVolume += zone.aggressiveVolume;

            // EXHAUSTION PRINCIPLE: Only directional passive volume matters
            // Buy trades exhaust ask liquidity, sell trades exhaust bid liquidity
            const directionalPassive = isBuyTrade
                ? (zone.passiveAskVolume ?? 0) // Buy exhausts asks
                : (zone.passiveBidVolume ?? 0); // Sell exhausts bids
            totalDirectionalPassiveVolume += directionalPassive;
        }

        // VALIDATION: Cannot exhaust non-existent liquidity
        if (totalDirectionalPassiveVolume === 0) {
            this.logger.debug(
                "ExhaustionDetectorEnhanced: No directional passive volume to exhaust",
                {
                    isBuyTrade,
                    zonesAnalyzed: relevantZones.length,
                    totalAggressiveVolume,
                }
            );
            this.logSignalRejection(
                event,
                "no_directional_passive_volume",
                {
                    type: "directional_passive_volume",
                    threshold: 1,
                    actual: 0,
                },
                {} as ExhaustionCalculatedValues
            );
            return null;
        }

        // Use directional volumes for exhaustion calculation
        const totalAccumulatedVolume =
            totalAggressiveVolume + totalDirectionalPassiveVolume;

        if (this.hotPathDebugEnabled) {
            this.logger.debug(
                "ExhaustionDetectorEnhanced: Directional volume analysis",
                {
                    totalAggressiveVolume,
                    totalDirectionalPassiveVolume,
                    totalAccumulatedVolume,
                    exhaustionVolumeThreshold: this.exhaustionVolumeThreshold,
                    isBuyTrade,
                    windowMs: this.timeWindowMs,
                    zonesAnalyzed: relevantZones.length,
                }
            );
        }

        // Calculate exhaustion ratio using directional volumes
        const accumulatedAggressiveRatio = FinancialMath.divideQuantities(
            totalAggressiveVolume,
            totalAccumulatedVolume
        );
        const accumulatedPassiveRatio = FinancialMath.divideQuantities(
            totalDirectionalPassiveVolume,
            totalAccumulatedVolume
        );

        // Calculate overall exhaustion confidence from accumulated volumes
        // Base confidence from accumulated aggressive ratio
        const confidence = accumulatedAggressiveRatio;

        // Determine signal side based on exhaustion
        const signalSide = this.determineExhaustionSignalSide(event);

        // Calculate additional metrics for complete threshold data
        // const priceEfficiency = this.calculateZoneSpread(event.zoneData); // Not used in current interface
        const volumeImbalance = FinancialMath.calculateAbs(
            FinancialMath.safeSubtract(
                accumulatedAggressiveRatio,
                this.ratioBalanceCenterPoint
            )
        );

        // ✅ CAPTURE ALL CALCULATED VALUES: Every computed value that gets checked against config
        const allCalculatedValues: ExhaustionCalculatedValues = {
            // Volume calculations (what gets checked against minAggVolume, depletionVolumeThreshold, etc.)
            calculatedMinAggVolume: totalAggressiveVolume,

            // Ratio calculations (what gets checked against thresholds)
            calculatedExhaustionThreshold: accumulatedAggressiveRatio,

            calculatedTimeWindowIndex: this.enhancementConfig.timeWindowIndex,
            calculatedEventCooldownMs: Date.now() - this.lastExhaustionSignalTs,
            calculatedUseStandardizedZones:
                this.enhancementConfig.useStandardizedZones,
            calculatedEnhancementMode: this.enhancementConfig.enhancementMode,
            calculatedMinEnhancedConfidenceThreshold: confidence,
            calculatedEnableDepletionAnalysis:
                this.enhancementConfig.enableDepletionAnalysis,
            calculatedDepletionVolumeThreshold: totalAggressiveVolume,
            calculatedDepletionRatioThreshold:
                totalDirectionalPassiveVolume > 0
                    ? (totalAggressiveVolume - totalDirectionalPassiveVolume) /
                      totalDirectionalPassiveVolume
                    : 0,
            calculatedPassiveVolumeExhaustionRatio: accumulatedPassiveRatio,
            calculatedVarianceReductionFactor:
                this.enhancementConfig.varianceReductionFactor,
            calculatedAlignmentNormalizationFactor:
                this.enhancementConfig.alignmentNormalizationFactor,
            calculatedAggressiveVolumeExhaustionThreshold:
                accumulatedAggressiveRatio,
            calculatedAggressiveVolumeReductionFactor:
                this.enhancementConfig.aggressiveVolumeReductionFactor,
            calculatedPassiveRatioBalanceThreshold:
                this.enhancementConfig.passiveRatioBalanceThreshold,
            calculatedPremiumConfidenceThreshold: confidence,
            calculatedVariancePenaltyFactor:
                this.enhancementConfig.variancePenaltyFactor,
            calculatedRatioBalanceCenterPoint:
                this.enhancementConfig.ratioBalanceCenterPoint,
        };

        // SINGLE EVALUATION SECTION: One decision point with complete threshold data
        const hasRecentZones = recentZones.length > 0;
        const hasRelevantZones = relevantZones.length > 0;
        const hasAccumulatedVolume = totalAccumulatedVolume > 0;
        const passesVolumeThreshold =
            totalAggressiveVolume >= this.exhaustionVolumeThreshold;
        const passesExhaustionRatios =
            accumulatedAggressiveRatio >= this.exhaustionRatioThreshold &&
            accumulatedPassiveRatio < this.passiveRatioBalanceThreshold;
        const passesConfidenceThreshold =
            confidence >= this.exhaustionScoreThreshold;
        const hasValidSignalSide = signalSide !== "neutral";

        // Comprehensive rejection with complete threshold data
        if (!hasRecentZones) {
            this.logSignalRejection(
                event,
                "no_recent_zones_in_time_window",
                {
                    type: "time_window_zones",
                    threshold: 1,
                    actual: recentZones.length,
                },
                allCalculatedValues
            );
            return null;
        }

        if (!hasRelevantZones) {
            this.logSignalRejection(
                event,
                "no_relevant_zones_near_price",
                {
                    type: "relevant_zones",
                    threshold: 1,
                    actual: relevantZones.length,
                },
                allCalculatedValues
            );
            return null;
        }

        if (!hasAccumulatedVolume) {
            this.logSignalRejection(
                event,
                "no_accumulated_volume",
                {
                    type: "accumulated_volume",
                    threshold: 1,
                    actual: totalAccumulatedVolume,
                },
                allCalculatedValues
            );
            return null;
        }

        if (!passesVolumeThreshold) {
            this.logSignalRejection(
                event,
                "accumulated_aggressive_volume_too_low",
                {
                    type: "accumulated_aggressive_volume",
                    threshold: this.exhaustionVolumeThreshold,
                    actual: totalAggressiveVolume,
                },
                allCalculatedValues
            );
            return null;
        }

        if (!passesExhaustionRatios) {
            if (this.hotPathDebugEnabled) {
                this.logger.debug(
                    "ExhaustionDetectorEnhanced: Exhaustion conditions not met",
                    {
                        accumulatedAggressiveRatio,
                        accumulatedPassiveRatio,
                        exhaustionRatioThreshold: this.exhaustionRatioThreshold,
                        passiveRatioBalanceThreshold:
                            this.passiveRatioBalanceThreshold,
                        firstCondition:
                            accumulatedAggressiveRatio >=
                            this.exhaustionRatioThreshold,
                        secondCondition:
                            accumulatedPassiveRatio <
                            this.passiveRatioBalanceThreshold,
                    }
                );
            }
            this.logSignalRejection(
                event,
                "exhaustion_conditions_not_met",
                {
                    type: "exhaustion_ratio",
                    threshold: this.exhaustionRatioThreshold,
                    actual: accumulatedAggressiveRatio,
                },
                allCalculatedValues
            );
            return null;
        }

        if (!passesConfidenceThreshold) {
            this.logSignalRejection(
                event,
                "confidence_below_threshold",
                {
                    type: "confidence_threshold",
                    threshold: this.exhaustionScoreThreshold,
                    actual: confidence,
                },
                allCalculatedValues
            );
            return null;
        }

        if (!hasValidSignalSide) {
            this.logSignalRejection(
                event,
                "neutral_signal_side",
                {
                    type: "signal_side",
                    threshold: 1,
                    actual: 0,
                },
                allCalculatedValues
            );
            return null;
        }

        // All thresholds passed - create signal candidate
        if (this.hotPathDebugEnabled) {
            this.logger.debug(
                "ExhaustionDetectorEnhanced: Exhaustion conditions met",
                {
                    accumulatedAggressiveRatio,
                    accumulatedPassiveRatio,
                    exhaustionRatioThreshold: this.exhaustionRatioThreshold,
                }
            );
        }

        // Create core exhaustion signal using accumulated metrics
        const signalCandidate: SignalCandidate = {
            id: `core-exhaustion-${event.timestamp}-${++this.signalCounter}`,
            type: "exhaustion" as SignalType,
            side: signalSide,
            confidence: confidence, // Raw confidence, no capping
            timestamp: event.timestamp,
            data: {
                price: event.price,
                side: signalSide,
                aggressive: totalAggressiveVolume,
                oppositeQty: totalDirectionalPassiveVolume,
                avgLiquidity:
                    totalDirectionalPassiveVolume / relevantZones.length,
                spread: this.calculateZoneSpread(event.zoneData) ?? 0,
                exhaustionScore: accumulatedAggressiveRatio,
                confidence: confidence, // Raw confidence, no capping
                depletionRatio: accumulatedAggressiveRatio,
                passiveVolumeRatio: accumulatedPassiveRatio,
                volumeImbalance,
                metadata: {
                    signalType: "exhaustion",
                    timestamp: event.timestamp,
                    totalZones: relevantZones.length,
                    accumulatedVolume: totalAccumulatedVolume,
                    timeWindowMs: this.timeWindowMs,
                    enhancementType: "time_window_exhaustion",
                    qualityMetrics: {
                        exhaustionStatisticalSignificance: confidence,
                        depletionConfirmation:
                            accumulatedAggressiveRatio >=
                            this.exhaustionRatioThreshold,
                        signalPurity:
                            confidence > this.premiumConfidenceThreshold
                                ? "premium"
                                : "standard",
                        accumulatedVolumeRatio: accumulatedAggressiveRatio,
                    },
                },
            },
        };

        return signalCandidate;
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
        const universalZoneConfig = Config.UNIVERSAL_ZONE_CONFIG;
        const minConfluenceZones = universalZoneConfig.minZoneConfluenceCount;
        const maxDistance = universalZoneConfig.maxZoneConfluenceDistance;

        // Find zones that overlap around the current price
        const relevantZones: ZoneSnapshot[] = [];

        // CLAUDE.md SIMPLIFIED: Use single zone array (no more triple-counting!)
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

    // ✅ REMOVED: Duplicate zone analysis method - now using preprocessor.findZonesNearPrice()

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
        // If dynamic zone tracking is enabled, use the new tracker
        if (this.enableDynamicZoneTracking) {
            // Update zone tracker with current zones
            if (event.bestBid && event.bestAsk) {
                this.zoneTracker.updateSpread(event.bestBid, event.bestAsk);
            }

            // Update zones in tracker
            for (const zone of zoneData.zones) {
                this.zoneTracker.updateZone(zone, event.timestamp);
            }

            // Analyze exhaustion pattern
            const isBuyTrade = !event.buyerIsMaker;
            const exhaustionPattern =
                this.zoneTracker.analyzeExhaustion(isBuyTrade);

            // Log detailed exhaustion analysis if significant pattern detected
            if (exhaustionPattern.hasExhaustion) {
                this.logger.info("Dynamic zone tracking detected exhaustion", {
                    exhaustionType: exhaustionPattern.exhaustionType,
                    depletionRatio: exhaustionPattern.depletionRatio,
                    depletionVelocity: exhaustionPattern.depletionVelocity,
                    affectedZones: exhaustionPattern.affectedZones,
                    confidence: exhaustionPattern.confidence,
                    gapCreated: exhaustionPattern.gapCreated,
                    price: event.price,
                    timestamp: event.timestamp,
                });
            }

            return {
                hasDepletion: exhaustionPattern.hasExhaustion,
                depletionRatio: exhaustionPattern.depletionRatio,
                affectedZones: exhaustionPattern.affectedZones,
            };
        }

        // Fallback to original logic if dynamic tracking is disabled
        const depletionThreshold =
            this.enhancementConfig.depletionVolumeThreshold;
        const minRatio = this.enhancementConfig.depletionRatioThreshold;

        // CLAUDE.md SIMPLIFIED: Use single zone array (no more triple-counting!)
        const allZones = [...zoneData.zones];

        const relevantZones = this.preprocessor.findZonesNearPrice(
            allZones,
            event.price,
            this.gapDetectionTicks
        );

        let totalDirectionalPassiveVolume = 0;
        let totalAggressiveVolume = 0;
        let affectedZones = 0;

        // CRITICAL FIX: Determine which passive volume is relevant based on trade direction
        // Same logic as absorption detector:
        // - Buy trades (buyerIsMaker = false): Only count passiveAskVolume (hitting asks)
        // - Sell trades (buyerIsMaker = true): Only count passiveBidVolume (hitting bids)
        const isBuyTrade = !event.buyerIsMaker;

        relevantZones.forEach((zone) => {
            const aggressiveVolume = zone.aggressiveVolume;

            // DIRECTIONAL PASSIVE VOLUME: Only count relevant side for exhaustion analysis
            const relevantPassiveVolume = isBuyTrade
                ? zone.passiveAskVolume // Buy trades deplete ask liquidity
                : zone.passiveBidVolume; // Sell trades deplete bid liquidity

            totalDirectionalPassiveVolume += relevantPassiveVolume;
            totalAggressiveVolume += aggressiveVolume;

            // Check if this zone shows exhaustion using directional passive volume
            const passiveVolumeExhaustionRatio =
                this.enhancementConfig.passiveVolumeExhaustionRatio;
            if (
                aggressiveVolume >= depletionThreshold &&
                relevantPassiveVolume <
                    FinancialMath.multiplyQuantities(
                        aggressiveVolume,
                        passiveVolumeExhaustionRatio
                    )
            ) {
                affectedZones++;
            }
        });

        // VALIDATION: Check if directional passive volume exists (cannot exhaust non-existent liquidity)
        if (totalDirectionalPassiveVolume === 0) {
            return {
                hasDepletion: false,
                depletionRatio: 0,
                affectedZones: 0,
            };
        }

        const totalVolume =
            totalDirectionalPassiveVolume + totalAggressiveVolume;
        const depletionRatio =
            totalVolume > 0
                ? FinancialMath.divideQuantities(
                      totalAggressiveVolume,
                      totalVolume
                  )
                : 0;
        const hasDepletion = depletionRatio <= minRatio && affectedZones > 0;

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
        exhaustionStrength: number;
    } | null {
        // CLAUDE.md SIMPLIFIED: Calculate exhaustion strength for single zone size
        const exhaustionStrength = this.calculateTimeframeExhaustionStrength(
            zoneData.zones,
            event.price
        );

        // CLAUDE.md compliance: return early if calculation fails
        if (exhaustionStrength === null) {
            return null; // CLAUDE.md compliance: return null when calculation cannot be performed
        }

        // CLAUDE.md SIMPLIFIED: Single zone alignment (perfect alignment by definition)
        const exhaustionValues = [exhaustionStrength];
        const avgExhaustion = FinancialMath.calculateMean(exhaustionValues);
        if (avgExhaustion === null) {
            return null; // CLAUDE.md compliance: return null when calculation cannot be performed
        }

        const stdDev = FinancialMath.calculateStdDev(exhaustionValues);
        if (stdDev === null) {
            return null; // CLAUDE.md compliance: return null when calculation cannot be performed
        }

        const variance = FinancialMath.multiplyQuantities(stdDev, stdDev); // Variance = stdDev^2
        const varianceReductionFactor =
            this.enhancementConfig.varianceReductionFactor;
        const normalizedVariance = FinancialMath.multiplyQuantities(
            variance,
            varianceReductionFactor
        );
        const alignmentScore = FinancialMath.multiplyQuantities(
            avgExhaustion,
            FinancialMath.calculateMax([
                0,
                FinancialMath.safeSubtract(
                    this.variancePenaltyFactor,
                    normalizedVariance
                ),
            ])
        ); // Penalize high variance
        const alignmentNormalizationFactor =
            this.enhancementConfig.alignmentNormalizationFactor;
        const hasAlignment = alignmentScore >= alignmentNormalizationFactor; // Require moderate alignment

        return {
            hasAlignment,
            alignmentScore,
            exhaustionStrength: exhaustionStrength,
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
    ): number | null {
        if (zones.length === 0) return null;

        const relevantZones = this.preprocessor.findZonesNearPrice(
            zones,
            price,
            this.gapDetectionTicks
        );
        if (relevantZones.length === 0) return null;

        let totalExhaustionScore = 0;

        for (const zone of relevantZones) {
            const totalVolume = zone.aggressiveVolume + zone.passiveVolume;
            if (totalVolume === 0) continue;

            const aggressiveRatio = FinancialMath.divideQuantities(
                zone.aggressiveVolume,
                totalVolume
            );
            const aggressiveVolumeExhaustionThreshold =
                this.enhancementConfig.aggressiveVolumeExhaustionThreshold;
            const aggressiveVolumeReductionFactor =
                this.enhancementConfig.aggressiveVolumeReductionFactor;
            const exhaustionScore =
                aggressiveRatio <= aggressiveVolumeExhaustionThreshold
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
     * Determine exhaustion signal side based on directional passive liquidity exhaustion
     * FIXED: Exhaustion signals are REVERSALS, not continuations
     * - Ask exhaustion (aggressive buying depletes asks) → SELL signal (reversal down)
     * - Bid exhaustion (aggressive selling depletes bids) → BUY signal (reversal up)
     */
    private determineExhaustionSignalSide(
        event: EnrichedTradeEvent
    ): "buy" | "sell" | "neutral" {
        if (!event.zoneData) return "neutral";

        // Use time-window filtered zones for signal direction
        const windowStartTime =
            event.timestamp -
            Config.getTimeWindow(this.enhancementConfig.timeWindowIndex);
        const recentZones = event.zoneData.zones.filter(
            (zone) => zone.lastUpdate >= windowStartTime
        );

        // EXHAUSTION REVERSAL LOGIC:
        // - Buy trades (buyerIsMaker = false): Check if asks are being exhausted
        // - Sell trades (buyerIsMaker = true): Check if bids are being exhausted
        // When exhaustion detected → Signal REVERSAL (opposite direction)
        const isBuyTrade = !event.buyerIsMaker;

        let relevantPassiveVolume = 0; // Volume being exhausted
        let oppositePassiveVolume = 0; // Remaining volume on opposite side

        recentZones.forEach((zone) => {
            if (isBuyTrade) {
                // Buy trade: Exhausting asks (supply)
                // If asks depleted → Resistance exhausted → Price reverses down
                relevantPassiveVolume += zone.passiveAskVolume || 0;
                oppositePassiveVolume += zone.passiveBidVolume || 0;
            } else {
                // Sell trade: Exhausting bids (demand)
                // If bids depleted → Support exhausted → Price reverses up
                relevantPassiveVolume += zone.passiveBidVolume || 0;
                oppositePassiveVolume += zone.passiveAskVolume || 0;
            }
        });

        // Debug logging to verify directional data
        this.logger.info(
            "ExhaustionDetectorEnhanced: DIRECTIONAL Signal side calculation DEBUG",
            {
                detectorId: this.getId(),
                price: event.price,
                isBuyTrade,
                buyerIsMaker: event.buyerIsMaker,
                relevantPassiveVolume,
                oppositePassiveVolume,
                tradeDirection: isBuyTrade ? "BUY" : "SELL",
                relevantSide: isBuyTrade ? "ask" : "bid",
                oppositeSide: isBuyTrade ? "bid" : "ask",
            }
        );

        // DIRECTIONAL EXHAUSTION LOGIC:
        // - If opposite side has more liquidity, relevant side is exhausted → signal REVERSAL
        // - If relevant side has more liquidity, no exhaustion → neutral
        // FIXED: Exhaustion signals are reversals, not continuations
        if (oppositePassiveVolume > relevantPassiveVolume) {
            // CORRECTED: Exhaustion causes reversal
            // - Ask exhaustion (from buying) → Price reverses DOWN → SELL signal
            // - Bid exhaustion (from selling) → Price reverses UP → BUY signal
            const signalSide = isBuyTrade ? "sell" : "buy"; // REVERSAL signal
            this.logger.info(
                `ExhaustionDetectorEnhanced: Returning ${signalSide.toUpperCase()} signal (exhaustion reversal detected)`,
                {
                    relevantPassiveVolume,
                    oppositePassiveVolume,
                    tradeDirection: isBuyTrade ? "BUY" : "SELL",
                    signalSide,
                }
            );
            return signalSide;
        }

        this.logger.info(
            "ExhaustionDetectorEnhanced: Returning NEUTRAL (no directional exhaustion)",
            {
                relevantPassiveVolume,
                oppositePassiveVolume,
                tradeDirection: isBuyTrade ? "BUY" : "SELL",
            }
        );
        return "neutral"; // No directional exhaustion
    }

    /**
     * Calculate average spread across zones
     */
    private calculateZoneSpread(
        zoneData: StandardZoneData | undefined
    ): number | null {
        if (!zoneData) return null;

        // For single zones, spread is null (cannot calculate spread between zones)
        if (zoneData.zones.length === 1) return null;

        if (zoneData.zones.length < 2) return null;

        const limit = Math.min(zoneData.zones.length, 10);
        let totalSpread = 0;
        let spreadCount = 0;

        for (let i = 0; i < limit - 1; i++) {
            const spread = Math.abs(
                zoneData.zones[i + 1]!.priceLevel -
                    zoneData.zones[i]!.priceLevel
            );
            totalSpread += spread;
            spreadCount++;
        }

        return spreadCount > 0
            ? FinancialMath.divideQuantities(totalSpread, spreadCount)
            : null;
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
     * Get detector status - implements required BaseDetector interface
     */
    public getStatus(): string {
        return `Exhaustion Enhanced - Mode: ${this.enhancementConfig.enhancementMode}, Zones: ${this.useStandardizedZones ? "enabled" : "disabled"}`;
    }

    /**
     * Mark signal as confirmed - implements required BaseDetector interface
     */
    public markSignalConfirmed(zone: number, side: "buy" | "sell"): void {
        // Implementation for signal confirmation tracking if needed
        this.logger.debug("ExhaustionDetectorEnhanced: Signal confirmed", {
            detectorId: this.getId(),
            zone,
            side,
        });
    }

    /**
     * Get detector ID - required by base class
     */
    public override getId(): string {
        return this.id;
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

            // Calculate actual values for signal logging (same as successful/rejection logging)
            const totalAggVol = relevantZones.reduce(
                (sum, zone) => sum + zone.aggressiveVolume,
                0
            );
            // Note: totalPassiveVolume kept for metadata but not used in exhaustion calculation
            const totalPassiveVolume = relevantZones.reduce(
                (sum, zone) => sum + zone.passiveVolume,
                0
            );
            const isBuyTrade = !event.buyerIsMaker;
            const totalDirectionalPassiveVolume = relevantZones.reduce(
                (sum, zone) => {
                    return (
                        sum +
                        (isBuyTrade
                            ? zone.passiveAskVolume
                            : zone.passiveBidVolume)
                    );
                },
                0
            );
            const accumulatedAggressiveRatio =
                totalAggVol > 0
                    ? totalAggVol / (totalAggVol + totalPassiveVolume)
                    : 0;
            const accumulatedPassiveRatio =
                totalAggVol > 0
                    ? totalDirectionalPassiveVolume / totalAggVol
                    : 0;
            const depletionRatio =
                totalPassiveVolume > 0
                    ? (totalAggVol - totalPassiveVolume) / totalPassiveVolume
                    : 0;
            const actualVarianceReduction =
                signal.confidence * accumulatedAggressiveRatio;
            const actualAlignmentNormalization =
                (accumulatedAggressiveRatio * totalDirectionalPassiveVolume) /
                Math.max(totalAggVol, 1);
            const actualAggressiveVolumeReduction =
                totalAggVol * accumulatedAggressiveRatio;
            const actualVariancePenalty = Math.abs(
                totalAggVol / Math.max(totalAggVol + totalPassiveVolume, 1) -
                    this.ratioBalanceCenterPoint
            );
            const actualRatioBalanceCenter = Math.abs(
                totalDirectionalPassiveVolume /
                    Math.max(totalAggVol + totalDirectionalPassiveVolume, 1) -
                    this.ratioBalanceCenterPoint
            );

            const calculatedValues: ExhaustionCalculatedValues = {
                calculatedMinAggVolume: totalAggVol,
                calculatedExhaustionThreshold: accumulatedAggressiveRatio,
                calculatedTimeWindowIndex:
                    this.enhancementConfig.timeWindowIndex,
                calculatedEventCooldownMs:
                    Date.now() - this.lastExhaustionSignalTs,
                calculatedUseStandardizedZones: relevantZones.length > 0,
                calculatedEnhancementMode:
                    this.enhancementConfig.enhancementMode,
                calculatedMinEnhancedConfidenceThreshold: signal.confidence,
                calculatedEnableDepletionAnalysis:
                    totalAggVol >=
                    this.enhancementConfig.depletionVolumeThreshold,
                calculatedDepletionVolumeThreshold:
                    totalDirectionalPassiveVolume,
                calculatedDepletionRatioThreshold: depletionRatio,
                calculatedPassiveVolumeExhaustionRatio: accumulatedPassiveRatio,
                calculatedVarianceReductionFactor: actualVarianceReduction,
                calculatedAlignmentNormalizationFactor:
                    actualAlignmentNormalization,
                calculatedAggressiveVolumeExhaustionThreshold:
                    accumulatedAggressiveRatio,
                calculatedAggressiveVolumeReductionFactor:
                    actualAggressiveVolumeReduction,
                calculatedPassiveRatioBalanceThreshold: accumulatedPassiveRatio,
                calculatedPremiumConfidenceThreshold: signal.confidence,
                calculatedVariancePenaltyFactor: actualVariancePenalty,
                calculatedRatioBalanceCenterPoint: actualRatioBalanceCenter,
            };

            this.validationLogger.logSignal(
                signal,
                event,
                calculatedValues,
                marketContext
            );
        } catch (error) {
            this.logger.error(
                "ExhaustionDetectorEnhanced: Failed to log signal for validation",
                {
                    signalId: signal.id,
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
            const totalAggVolSuccessful =
                event.zoneData?.zones.reduce(
                    (sum, zone) => sum + zone.aggressiveVolume,
                    0
                ) || 0;
            const totalPassVol =
                event.zoneData?.zones.reduce(
                    (sum, zone) => sum + zone.passiveVolume,
                    0
                ) || 0;
            const actualExhaustionRatio =
                totalAggVolSuccessful > 0
                    ? totalAggVolSuccessful /
                      (totalAggVolSuccessful + totalPassVol)
                    : 0;
            const actualDepletionRatio =
                totalPassVol > 0
                    ? (totalAggVolSuccessful - totalPassVol) / totalPassVol
                    : 0;
            const actualPassiveExhaustionRatio =
                totalPassVol > 0 ? totalAggVolSuccessful / totalPassVol : 0;

            const parameterValues = {
                // EXHAUSTION ACTUAL VALUES - what was actually measured vs thresholds
                minAggVolume: totalAggVolSuccessful, // What aggressive volume actually was
                exhaustionThreshold: actualExhaustionRatio, // What exhaustion ratio actually was
                timeWindowIndex: this.enhancementConfig.timeWindowIndex, // Static config
                eventCooldownMs: this.enhancementConfig.eventCooldownMs, // Static config
                useStandardizedZones:
                    this.enhancementConfig.useStandardizedZones, // Static config
                enhancementMode: this.enhancementConfig.enhancementMode, // Static config
                minEnhancedConfidenceThreshold: signal.confidence, // What confidence actually was
                enableDepletionAnalysis:
                    this.enhancementConfig.enableDepletionAnalysis, // Static config
                depletionVolumeThreshold: totalPassVol, // What depletion volume actually was
                depletionRatioThreshold: actualDepletionRatio, // What depletion ratio actually was
                passiveVolumeExhaustionRatio: actualPassiveExhaustionRatio, // What passive exhaustion ratio actually was
                varianceReductionFactor:
                    this.enhancementConfig.varianceReductionFactor, // Static config
                alignmentNormalizationFactor:
                    this.enhancementConfig.alignmentNormalizationFactor, // Static config
                aggressiveVolumeExhaustionThreshold: actualExhaustionRatio, // What aggressive exhaustion actually was
                aggressiveVolumeReductionFactor:
                    this.enhancementConfig.aggressiveVolumeReductionFactor, // Static config
                passiveRatioBalanceThreshold:
                    Math.abs(totalAggVolSuccessful - totalPassVol) /
                    Math.max(totalAggVolSuccessful + totalPassVol, 1), // What balance actually was
                premiumConfidenceThreshold: signal.confidence, // What confidence actually was
                variancePenaltyFactor:
                    this.enhancementConfig.variancePenaltyFactor, // Static config
                ratioBalanceCenterPoint:
                    this.enhancementConfig.ratioBalanceCenterPoint, // Static config

                // ABSORPTION PARAMETERS (N/A for exhaustion but included for consistency)
                absorptionThreshold: undefined, // N/A for exhaustion
                priceEfficiencyThreshold: undefined, // N/A for exhaustion
                maxAbsorptionRatio: undefined, // N/A for exhaustion
                minPassiveMultiplier: undefined, // N/A for exhaustion
                passiveAbsorptionThreshold: undefined, // N/A for exhaustion
                expectedMovementScalingFactor: undefined, // N/A for exhaustion
                contextConfidenceBoostMultiplier: undefined, // N/A for exhaustion
                liquidityGradientRange: undefined, // N/A for exhaustion
                institutionalVolumeThreshold: undefined, // N/A for exhaustion
                institutionalVolumeRatioThreshold: undefined, // N/A for exhaustion
                enableInstitutionalVolumeFilter: undefined, // N/A for exhaustion
                minAbsorptionScore: undefined, // N/A for exhaustion
                finalConfidenceRequired: undefined, // N/A for exhaustion
                maxZoneCountForScoring: undefined, // N/A for exhaustion
                balanceThreshold: undefined, // N/A for exhaustion
                confluenceMinZones: undefined, // N/A for exhaustion
                confluenceMaxDistance: undefined, // N/A for exhaustion

                // RUNTIME VALUES (exactly what was calculated)
                priceEfficiency: undefined, // N/A for exhaustion
                confidence: signal.confidence,
                aggressiveVolume: totalAggVolSuccessful,
                passiveVolume: totalPassVol,
                volumeRatio:
                    totalAggVolSuccessful > 0
                        ? totalPassVol / totalAggVolSuccessful
                        : 0,
                institutionalVolumeRatio: undefined, // N/A for exhaustion
            };

            // Market context at time of successful signal
            const marketContext = {
                marketVolume:
                    parameterValues.aggressiveVolume +
                    parameterValues.passiveVolume,
                marketSpread:
                    event.bestAsk && event.bestBid
                        ? event.bestAsk - event.bestBid
                        : 0,
                marketVolatility: this.calculateMarketVolatility(event),
            };

            // Calculate actual values used in exhaustion analysis (no config values)
            const totalAggVolForValidation =
                event.zoneData?.zones.reduce(
                    (sum, zone) => sum + zone.aggressiveVolume,
                    0
                ) || 0;
            const totalPassiveVolume =
                event.zoneData?.zones.reduce(
                    (sum, zone) => sum + zone.passiveVolume,
                    0
                ) || 0;
            const isBuyTrade = !event.buyerIsMaker;
            const totalDirectionalPassiveVolume =
                event.zoneData?.zones.reduce((sum, zone) => {
                    return (
                        sum +
                        (isBuyTrade
                            ? zone.passiveAskVolume
                            : zone.passiveBidVolume)
                    );
                }, 0) || 0;
            const accumulatedAggressiveRatio =
                totalAggVolForValidation > 0
                    ? totalAggVolForValidation /
                      (totalAggVolForValidation + totalPassiveVolume)
                    : 0;
            const accumulatedPassiveRatio =
                totalAggVolForValidation > 0
                    ? totalDirectionalPassiveVolume / totalAggVolForValidation
                    : 0;
            const depletionRatio =
                totalPassiveVolume > 0
                    ? (totalAggVolForValidation - totalPassiveVolume) /
                      totalPassiveVolume
                    : 0;
            const exhaustionThreshold =
                totalAggVolForValidation > 0 ? accumulatedAggressiveRatio : 0;
            const actualVarianceReduction =
                signal.confidence * accumulatedAggressiveRatio;
            const actualAlignmentNormalization =
                (accumulatedAggressiveRatio * totalDirectionalPassiveVolume) /
                Math.max(totalAggVolForValidation, 1);
            const actualAggressiveVolumeReduction =
                totalAggVolForValidation * accumulatedAggressiveRatio;
            const actualVariancePenalty = Math.abs(
                totalAggVolForValidation /
                    Math.max(totalAggVolForValidation + totalPassiveVolume, 1) -
                    this.ratioBalanceCenterPoint
            );
            const actualRatioBalanceCenter = Math.abs(
                totalDirectionalPassiveVolume /
                    Math.max(
                        totalAggVolForValidation +
                            totalDirectionalPassiveVolume,
                        1
                    ) -
                    this.ratioBalanceCenterPoint
            );

            const calculatedValues: ExhaustionCalculatedValues = {
                calculatedMinAggVolume: totalAggVolForValidation,
                calculatedExhaustionThreshold: accumulatedAggressiveRatio,
                calculatedTimeWindowIndex:
                    this.enhancementConfig.timeWindowIndex,
                calculatedEventCooldownMs:
                    Date.now() - this.lastExhaustionSignalTs,
                calculatedUseStandardizedZones:
                    event.zoneData?.zones.length > 0,
                calculatedEnhancementMode:
                    this.enhancementConfig.enhancementMode,
                calculatedMinEnhancedConfidenceThreshold: signal.confidence,
                calculatedEnableDepletionAnalysis:
                    totalAggVolForValidation >=
                    this.enhancementConfig.depletionVolumeThreshold,
                calculatedDepletionVolumeThreshold:
                    totalDirectionalPassiveVolume,
                calculatedDepletionRatioThreshold: depletionRatio,
                calculatedPassiveVolumeExhaustionRatio: accumulatedPassiveRatio,
                calculatedVarianceReductionFactor: actualVarianceReduction,
                calculatedAlignmentNormalizationFactor:
                    actualAlignmentNormalization,
                calculatedAggressiveVolumeExhaustionThreshold:
                    exhaustionThreshold,
                calculatedAggressiveVolumeReductionFactor:
                    actualAggressiveVolumeReduction,
                calculatedPassiveRatioBalanceThreshold: accumulatedPassiveRatio,
                calculatedPremiumConfidenceThreshold: signal.confidence,
                calculatedVariancePenaltyFactor: actualVariancePenalty,
                calculatedRatioBalanceCenterPoint: actualRatioBalanceCenter,
            };

            this.validationLogger.logSuccessfulSignal(
                "exhaustion",
                event,
                calculatedValues,
                marketContext
            );
        } catch (error) {
            this.logger.error(
                "ExhaustionDetectorEnhanced: Failed to log successful signal parameters",
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
        calculatedValues: ExhaustionCalculatedValues
    ): void {
        try {
            this.validationLogger.logRejection(
                "exhaustion",
                rejectionReason,
                event,
                thresholdDetails,
                calculatedValues
            );
        } catch (error) {
            this.logger.error(
                "ExhaustionDetectorEnhanced: Failed to log signal rejection",
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
            totalAggressive += zone.aggressiveVolume;
            totalPassive += zone.passiveVolume;
            aggressiveBuy += zone.aggressiveBuyVolume || 0;
            aggressiveSell += zone.aggressiveSellVolume || 0;
            passiveBid += zone.passiveBidVolume || 0;
            passiveAsk += zone.passiveAskVolume || 0;
        }

        const totalVolume = totalAggressive + totalPassive;
        const institutionalVolumeRatio =
            totalVolume > 0
                ? FinancialMath.divideQuantities(totalPassive, totalVolume)
                : 0;

        // Calculate simple price efficiency based on zone spread
        const priceEfficiency = this.calculateZoneSpread(event.zoneData);

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
     * Enhanced cleanup with zone-aware resource management
     *
     * STANDALONE VERSION: Resource management
     */
    public cleanup(): void {
        // Clean up validation logger
        this.validationLogger.cleanup();

        // Clear zone tracker
        this.zoneTracker.clear();

        this.logger.info(
            "ExhaustionDetectorEnhanced: Enhanced cleanup completed",
            {
                detectorId: this.getId(),
                enhancementStats: this.enhancementStats,
                zoneTrackerStats: this.zoneTracker.getStats(),
            }
        );
    }
}
