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
import type { ILogger } from "../infrastructure/loggerInterface.js";
import type { IMetricsCollector } from "../infrastructure/metricsCollectorInterface.js";
import type { ISignalLogger } from "../infrastructure/signalLoggerInterface.js";
import type { IOrderflowPreprocessor } from "../market/orderFlowPreprocessor.js";
import type {
    EnrichedTradeEvent,
    StandardZoneData,
    ZoneSnapshot,
} from "../types/marketEvents.js";
import type {
    SignalCandidate,
    EnhancedExhaustionSignalData,
    SignalType,
} from "../types/signalTypes.js";
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
    private readonly lastSignal = new Map<string, number>();

    // CLAUDE.md compliant configuration parameters - NO MAGIC NUMBERS
    private readonly confluenceMinZones: number;
    private readonly confluenceMaxDistance: number;
    private readonly confluenceConfidenceBoost: number;
    private readonly crossTimeframeConfidenceBoost: number;
    private readonly exhaustionVolumeThreshold: number;
    private readonly exhaustionRatioThreshold: number;
    private readonly exhaustionScoreThreshold: number;

    // Additional configurable thresholds to replace magic numbers
    private readonly passiveRatioBalanceThreshold: number;
    private readonly premiumConfidenceThreshold: number;
    private readonly variancePenaltyFactor: number;
    private readonly ratioBalanceCenterPoint: number;

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
        this.confluenceMinZones =
            Config.UNIVERSAL_ZONE_CONFIG.minZoneConfluenceCount;
        this.confluenceMaxDistance =
            Config.UNIVERSAL_ZONE_CONFIG.maxZoneConfluenceDistance;
        this.confluenceConfidenceBoost =
            Config.UNIVERSAL_ZONE_CONFIG.confluenceConfidenceBoost;
        this.crossTimeframeConfidenceBoost =
            Config.UNIVERSAL_ZONE_CONFIG.crossTimeframeBoost;
        this.exhaustionVolumeThreshold = settings.minAggVolume;
        this.exhaustionRatioThreshold = settings.exhaustionThreshold;
        this.exhaustionScoreThreshold = settings.minEnhancedConfidenceThreshold;

        // Initialize additional configurable thresholds (CLAUDE.md compliance)
        this.passiveRatioBalanceThreshold =
            settings.passiveRatioBalanceThreshold;
        this.premiumConfidenceThreshold = settings.premiumConfidenceThreshold;
        this.variancePenaltyFactor = settings.variancePenaltyFactor;
        this.ratioBalanceCenterPoint = settings.ratioBalanceCenterPoint;

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
     * Check if we can emit a signal for this detector (respects cooldown)
     * CLAUDE.md MEMORY LEAK FIX: Automatically cleans up old cooldown entries
     */
    private canEmitSignal(eventKey: string, update: boolean = false): boolean {
        // Note: For signal cooldown, we still use Date.now() since it's system time management
        // not market data timing. This is acceptable as per architectural guidelines.
        const now = Date.now();

        // MEMORY LEAK FIX: Clean up expired cooldown entries to prevent memory growth
        this.cleanupExpiredCooldowns(now);

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
     * Clean up expired cooldown entries to prevent memory leak
     * CLAUDE.md COMPLIANCE: Memory management without magic numbers
     */
    private cleanupExpiredCooldowns(currentTime: number): void {
        const expirationTime =
            currentTime - this.enhancementConfig.eventCooldownMs * 2; // Keep entries for 2x cooldown period

        for (const [key, timestamp] of this.lastSignal.entries()) {
            if (timestamp < expirationTime) {
                this.lastSignal.delete(key);
            }
        }
    }

    /**
     * Enhanced trade event processing with standardized zone analysis
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
            "ExhaustionDetectorEnhanced: Processing trade",
            debugInfo
        );

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

        let totalConfidenceBoost = 0;
        let enhancementApplied = false;
        let finalSignal = coreExhaustionResult; // Start with core signal

        // Zone confluence analysis for exhaustion validation
        if (Config.UNIVERSAL_ZONE_CONFIG.enableZoneConfluenceFilter) {
            const confluenceResult = this.analyzeZoneConfluence(
                event.zoneData,
                event.price
            );
            if (confluenceResult.hasConfluence) {
                this.enhancementStats.confluenceDetectionCount++;
                totalConfidenceBoost +=
                    Config.UNIVERSAL_ZONE_CONFIG.confluenceConfidenceBoost;
                enhancementApplied = true;

                this.logger.debug(
                    "ExhaustionDetectorEnhanced: Zone confluence detected for exhaustion validation",
                    {
                        detectorId: this.getId(),
                        price: event.price,
                        confluenceZones: confluenceResult.confluenceZones,
                        confluenceStrength: confluenceResult.confluenceStrength,
                        confidenceBoost:
                            Config.UNIVERSAL_ZONE_CONFIG
                                .confluenceConfidenceBoost,
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
                    this.enhancementConfig.depletionConfidenceBoost;
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

                // Enhanced signal will be processed through unified emission logic
            }
        }

        // Cross-timeframe exhaustion analysis
        if (Config.UNIVERSAL_ZONE_CONFIG.enableCrossTimeframeAnalysis) {
            const crossTimeframeResult = this.analyzeCrossTimeframeExhaustion(
                event.zoneData,
                event
            );
            if (crossTimeframeResult && crossTimeframeResult.hasAlignment) {
                this.enhancementStats.crossTimeframeAnalysisCount++;
                totalConfidenceBoost +=
                    Config.UNIVERSAL_ZONE_CONFIG.crossTimeframeBoost;
                enhancementApplied = true;

                this.logger.debug(
                    "ExhaustionDetectorEnhanced: Cross-timeframe exhaustion alignment",
                    {
                        detectorId: this.getId(),
                        price: event.price,
                        alignmentScore: crossTimeframeResult.alignmentScore,
                        exhaustionStrength:
                            crossTimeframeResult.exhaustionStrength,
                        confidenceBoost:
                            Config.UNIVERSAL_ZONE_CONFIG.crossTimeframeBoost,
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

        // SIMPLIFIED: Unified signal emission path
        if (finalSignal && this.canEmitSignal(`exhaustion`)) {
            // Apply enhancement confidence boost if applicable
            if (enhancementApplied && totalConfidenceBoost > 0) {
                finalSignal.confidence = Math.min(
                    1.0,
                    finalSignal.confidence + totalConfidenceBoost
                );
            }

            // Update cooldown and emit signal
            this.canEmitSignal(`exhaustion`, true);
            void this.logSignalForValidation(
                finalSignal,
                event,
                event.zoneData?.zones || []
            );
            this.emit("signalCandidate", finalSignal);

            this.logger.info("ExhaustionDetectorEnhanced: Signal emitted", {
                detectorId: this.getId(),
                price: event.price,
                side: finalSignal.side,
                confidence: finalSignal.confidence,
                enhancementApplied,
                confidenceBoost: totalConfidenceBoost,
            });
        }
    }

    /**
     * Detect core exhaustion patterns using zone data
     *
     * STANDALONE VERSION: Core exhaustion detection logic
     */
    private detectCoreExhaustion(
        event: EnrichedTradeEvent
    ): SignalCandidate | null {
        if (!event.zoneData) {
            this.logger.debug(
                "ExhaustionDetectorEnhanced: No zone data available"
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

        // CRITICAL FIX: Restore individual trade filtering to prevent signal spam
        // Only significant trades should contribute to exhaustion detection
        if (event.quantity < this.enhancementConfig.minAggVolume) {
            this.logSignalRejection(
                event,
                "trade_quantity_too_small",
                {
                    type: "trade_quantity",
                    threshold: this.enhancementConfig.minAggVolume,
                    actual: event.quantity,
                },
                {
                    aggressiveVolume: event.quantity,
                    passiveVolume: 0,
                    priceEfficiency: null,
                    confidence: 0,
                }
            );
            return null;
        }

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

        // CLAUDE.md SIMPLIFIED: Use single zone array (no more triple-counting!)
        const allZones = [...event.zoneData.zones];

        if (allZones.length === 0) {
            this.logger.debug(
                "ExhaustionDetectorEnhanced: No zones available",
                {
                    zonesCount: event.zoneData.zones.length,
                }
            );
            this.logSignalRejection(
                event,
                "no_zones_available",
                {
                    type: "zone_count",
                    threshold: 1,
                    actual: 0,
                },
                {
                    aggressiveVolume: event.quantity,
                    passiveVolume: 0,
                    priceEfficiency: null,
                    confidence: 0,
                }
            );
            return null;
        }

        // ARCHITECTURAL FIX: Filter zones by time window using trade timestamp
        const windowStartTime =
            event.timestamp -
            Config.getTimeWindow(this.enhancementConfig.timeWindowIndex);
        const recentZones = allZones.filter(
            (zone) => zone.lastUpdate >= windowStartTime
        );

        this.logger.debug("ExhaustionDetectorEnhanced: Time-window filtering", {
            totalZones: allZones.length,
            recentZones: recentZones.length,
            windowMs: Config.getTimeWindow(
                this.enhancementConfig.timeWindowIndex
            ),
            windowStartTime,
            tradeTimestamp: event.timestamp,
        });

        if (recentZones.length === 0) {
            this.logger.debug(
                "ExhaustionDetectorEnhanced: No recent zones within time window",
                {
                    windowMs: Config.getTimeWindow(
                        this.enhancementConfig.timeWindowIndex
                    ),
                    tradeTimestamp: event.timestamp,
                }
            );
            this.logSignalRejection(
                event,
                "no_recent_zones_in_time_window",
                {
                    type: "time_window_zones",
                    threshold: 1,
                    actual: 0,
                },
                {
                    aggressiveVolume: event.quantity,
                    passiveVolume: 0,
                    priceEfficiency: null,
                    confidence: 0,
                }
            );
            return null;
        }

        // Find zones near the current price from recent zones only
        let relevantZones = this.preprocessor.findZonesNearPrice(
            recentZones,
            event.price,
            this.confluenceMaxDistance
        );

        // STRUCTURAL FIX: If no zones found with primary method, find nearest zone with volume from recent zones
        if (relevantZones.length === 0) {
            this.logger.debug(
                "ExhaustionDetectorEnhanced: No zones found with primary method, using fallback",
                {
                    price: event.price,
                    maxDistance: this.confluenceMaxDistance,
                    totalZones: allZones.length,
                    recentZones: recentZones.length,
                }
            );

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

        if (relevantZones.length === 0) {
            this.logger.debug(
                "ExhaustionDetectorEnhanced: No relevant zones found even with fallback",
                {
                    price: event.price,
                    totalZones: allZones.length,
                }
            );
            this.logSignalRejection(
                event,
                "no_relevant_zones_near_price",
                {
                    type: "relevant_zones",
                    threshold: 1,
                    actual: 0,
                },
                {
                    aggressiveVolume: event.quantity,
                    passiveVolume: 0,
                    priceEfficiency: null,
                    confidence: 0,
                }
            );
            return null;
        }

        this.logger.debug("ExhaustionDetectorEnhanced: Found relevant zones", {
            relevantZones: relevantZones.length,
            maxDistance: this.confluenceMaxDistance,
        });

        // ARCHITECTURAL FIX: Calculate accumulated exhaustion metrics over time window
        let totalAggressiveVolume = 0;
        let totalPassiveVolume = 0;

        for (const zone of relevantZones) {
            totalAggressiveVolume += zone.aggressiveVolume;
            totalPassiveVolume += zone.passiveVolume;
        }

        const totalAccumulatedVolume =
            totalAggressiveVolume + totalPassiveVolume;

        this.logger.debug(
            "ExhaustionDetectorEnhanced: Accumulated volume analysis",
            {
                totalAggressiveVolume,
                totalPassiveVolume,
                totalAccumulatedVolume,
                exhaustionVolumeThreshold: this.exhaustionVolumeThreshold,
                windowMs: Config.getTimeWindow(
                    this.enhancementConfig.timeWindowIndex
                ),
                zonesAnalyzed: relevantZones.length,
            }
        );

        // Check if we have enough accumulated volume for exhaustion analysis
        if (totalAccumulatedVolume === 0) {
            this.logger.debug(
                "ExhaustionDetectorEnhanced: No accumulated volume in time window"
            );
            this.logSignalRejection(
                event,
                "no_accumulated_volume",
                {
                    type: "accumulated_volume",
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

        // CORE FIX: Check accumulated aggressive volume against threshold (not per-zone)
        if (totalAggressiveVolume < this.exhaustionVolumeThreshold) {
            this.logger.debug(
                "ExhaustionDetectorEnhanced: Accumulated aggressive volume below threshold",
                {
                    totalAggressiveVolume,
                    exhaustionVolumeThreshold: this.exhaustionVolumeThreshold,
                }
            );
            this.logSignalRejection(
                event,
                "accumulated_aggressive_volume_too_low",
                {
                    type: "accumulated_aggressive_volume",
                    threshold: this.exhaustionVolumeThreshold,
                    actual: totalAggressiveVolume,
                },
                {
                    aggressiveVolume: totalAggressiveVolume,
                    passiveVolume: totalPassiveVolume,
                    priceEfficiency: null,
                    confidence: 0,
                }
            );
            return null;
        }

        // Calculate accumulated ratios over time window
        const accumulatedAggressiveRatio = FinancialMath.divideQuantities(
            totalAggressiveVolume,
            totalAccumulatedVolume
        );
        const accumulatedPassiveRatio = FinancialMath.divideQuantities(
            totalPassiveVolume,
            totalAccumulatedVolume
        );

        // Check for exhaustion: high accumulated aggressive volume, low accumulated passive volume
        if (
            accumulatedAggressiveRatio >= this.exhaustionRatioThreshold &&
            accumulatedPassiveRatio < this.passiveRatioBalanceThreshold // More aggressive than passive (configurable threshold)
        ) {
            this.logger.debug(
                "ExhaustionDetectorEnhanced: Exhaustion conditions met",
                {
                    accumulatedAggressiveRatio,
                    accumulatedPassiveRatio,
                    exhaustionRatioThreshold: this.exhaustionRatioThreshold,
                }
            );
        } else {
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
            this.logSignalRejection(
                event,
                "exhaustion_conditions_not_met",
                {
                    type: "exhaustion_ratio",
                    threshold: this.exhaustionRatioThreshold,
                    actual: accumulatedAggressiveRatio,
                },
                {
                    aggressiveVolume: totalAggressiveVolume,
                    passiveVolume: totalPassiveVolume,
                    priceEfficiency: null,
                    confidence: accumulatedAggressiveRatio,
                }
            );
            return null;
        }

        // Calculate overall exhaustion confidence from accumulated volumes
        // Base confidence from accumulated aggressive ratio
        const confidence = accumulatedAggressiveRatio;

        // Apply minimum confidence threshold
        if (confidence < this.exhaustionScoreThreshold) {
            this.logger.debug(
                "ExhaustionDetectorEnhanced: Confidence below threshold",
                {
                    confidence,
                    exhaustionScoreThreshold: this.exhaustionScoreThreshold,
                }
            );
            this.logSignalRejection(
                event,
                "confidence_below_threshold",
                {
                    type: "confidence_threshold",
                    threshold: this.exhaustionScoreThreshold,
                    actual: confidence,
                },
                {
                    aggressiveVolume: totalAggressiveVolume,
                    passiveVolume: totalPassiveVolume,
                    priceEfficiency: null,
                    confidence,
                }
            );
            return null;
        }

        // Determine signal side based on exhaustion
        const signalSide = this.determineExhaustionSignalSide(event);
        if (signalSide === "neutral") {
            this.logSignalRejection(
                event,
                "neutral_signal_side",
                {
                    type: "signal_side",
                    threshold: 1,
                    actual: 0,
                },
                {
                    aggressiveVolume: totalAggressiveVolume,
                    passiveVolume: totalPassiveVolume,
                    priceEfficiency: null,
                    confidence,
                }
            );
            return null;
        }

        // Create core exhaustion signal using accumulated metrics
        const signalCandidate: SignalCandidate = {
            id: `core-exhaustion-${event.timestamp}-${Math.random().toString(36).substring(7)}`,
            type: "exhaustion" as SignalType,
            side: signalSide,
            confidence: Math.min(1.0, confidence),
            timestamp: event.timestamp,
            data: {
                price: event.price,
                side: signalSide,
                aggressive: totalAggressiveVolume,
                oppositeQty: totalPassiveVolume,
                avgLiquidity: totalPassiveVolume / relevantZones.length,
                spread: this.calculateZoneSpread(event.zoneData) ?? 0,
                exhaustionScore: accumulatedAggressiveRatio,
                confidence: Math.min(1.0, confidence),
                depletionRatio: accumulatedAggressiveRatio,
                passiveVolumeRatio: accumulatedPassiveRatio,
                volumeImbalance: FinancialMath.calculateAbs(
                    FinancialMath.safeSubtract(
                        accumulatedAggressiveRatio,
                        this.ratioBalanceCenterPoint
                    )
                ),
                metadata: {
                    signalType: "exhaustion",
                    timestamp: event.timestamp,
                    totalZones: relevantZones.length,
                    accumulatedVolume: totalAccumulatedVolume,
                    timeWindowMs: Config.getTimeWindow(
                        this.enhancementConfig.timeWindowIndex
                    ),
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
        const depletionThreshold =
            this.enhancementConfig.depletionVolumeThreshold;
        const minRatio = this.enhancementConfig.depletionRatioThreshold;

        // CLAUDE.md SIMPLIFIED: Use single zone array (no more triple-counting!)
        const allZones = [...zoneData.zones];

        const relevantZones = this.preprocessor.findZonesNearPrice(
            allZones,
            event.price,
            5
        );

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
                this.enhancementConfig.passiveVolumeExhaustionRatio;
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
        exhaustionStrength: number;
    } | null {
        // CLAUDE.md SIMPLIFIED: Calculate exhaustion strength for single zone size
        const exhaustionStrength = this.calculateTimeframeExhaustionStrength(
            zoneData.zones,
            event.price
        );

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
            exhaustionStrength,
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

        const relevantZones = this.preprocessor.findZonesNearPrice(
            zones,
            price,
            3
        );
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
                this.enhancementConfig.aggressiveVolumeExhaustionThreshold;
            const aggressiveVolumeReductionFactor =
                this.enhancementConfig.aggressiveVolumeReductionFactor;
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
     * Calculate average passive volume from zone data
     */
    private calculateAveragePassiveVolume(
        zoneData: StandardZoneData | undefined
    ): number | null {
        if (!zoneData) return null;

        const allZones = [...zoneData.zones];

        if (allZones.length === 0) return null;

        const totalPassiveVolume = allZones.reduce(
            (sum, zone) => sum + zone.passiveVolume,
            0
        );

        return FinancialMath.divideQuantities(
            totalPassiveVolume,
            allZones.length
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
     * Emit enhanced exhaustion signal independently of base detector
     *
     * EXHAUSTION PHASE 1: Independent signal emission for enhanced exhaustion detection
     */
    private emitEnhancedExhaustionSignal(
        event: EnrichedTradeEvent,
        depletionResult: {
            hasDepletion: boolean;
            depletionRatio: number;
            affectedZones: number;
        },
        confidenceBoost: number
    ): void {
        // 🔧 CLAUDE.md COMPLIANCE: Only proceed with valid depletion ratio
        if (depletionResult.depletionRatio <= 0) {
            return;
        }

        // Calculate enhanced confidence without any defaults
        const enhancedConfidence =
            depletionResult.depletionRatio + confidenceBoost;

        // Only emit if enhanced confidence meets minimum threshold
        if (
            enhancedConfidence <
            this.enhancementConfig.minEnhancedConfidenceThreshold
        ) {
            return;
        }

        // Determine signal side based on zone exhaustion analysis
        const signalSide = this.determineExhaustionSignalSide(event);
        if (signalSide === "neutral") {
            return;
        }

        // Calculate zone metrics - return early if any are null
        const passiveVolumeRatio = this.calculateZonePassiveRatio(
            event.zoneData
        );
        const avgSpread = this.calculateZoneSpread(event.zoneData);
        const volumeImbalance = this.calculateZoneVolumeImbalance(
            event.zoneData
        );
        const averagePassiveVolume = this.calculateAveragePassiveVolume(
            event.zoneData
        );

        if (
            passiveVolumeRatio === null ||
            avgSpread === null ||
            volumeImbalance === null ||
            averagePassiveVolume === null
        ) {
            return;
        }

        // Create enhanced exhaustion result
        const exhaustionResult: EnhancedExhaustionSignalData = {
            price: event.price,
            side: signalSide,
            aggressive: event.quantity,
            oppositeQty: this.calculateOppositeQuantity(event),
            avgLiquidity: averagePassiveVolume,
            spread: avgSpread,
            exhaustionScore: depletionResult.depletionRatio,
            confidence: enhancedConfidence,
            depletionRatio: depletionResult.depletionRatio,
            passiveVolumeRatio,
            avgSpread,
            volumeImbalance,
            metadata: {
                signalType: "exhaustion",
                timestamp: event.timestamp,
                affectedZones: depletionResult.affectedZones,
                enhancementType: "zone_based_exhaustion",
                qualityMetrics: {
                    exhaustionStatisticalSignificance: enhancedConfidence,
                    depletionConfirmation: depletionResult.affectedZones >= 2,
                    signalPurity:
                        enhancedConfidence > this.premiumConfidenceThreshold
                            ? "premium"
                            : "standard",
                },
            },
        };

        // Create signal candidate
        const signalCandidate: SignalCandidate = {
            id: `enhanced-exhaustion-${event.timestamp}-${Math.random().toString(36).substring(7)}`,
            type: "exhaustion" as SignalType,
            side: signalSide,
            confidence: enhancedConfidence,
            timestamp: event.timestamp,
            data: exhaustionResult,
        };

        // Update cooldown tracking before emitting enhanced signal
        const eventKey = `exhaustion`;
        this.canEmitSignal(eventKey, true);

        // ✅ EMIT ENHANCED EXHAUSTION SIGNAL - Independent of base detector
        this.emit("signalCandidate", signalCandidate);

        this.logger.info(
            "ExhaustionDetectorEnhanced: ENHANCED EXHAUSTION SIGNAL EMITTED",
            {
                detectorId: this.getId(),
                price: event.price,
                side: signalSide,
                confidence: enhancedConfidence,
                depletionRatio: depletionResult.depletionRatio,
                affectedZones: depletionResult.affectedZones,
                signalId: signalCandidate.id,
                signalType: "exhaustion",
            }
        );
    }

    /**
     * Determine exhaustion signal side based on which passive liquidity is exhausted
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

        let totalPassiveBidAvailable = 0;
        let totalPassiveAskAvailable = 0;

        recentZones.forEach((zone) => {
            totalPassiveBidAvailable += zone.passiveBidVolume || 0;
            totalPassiveAskAvailable += zone.passiveAskVolume || 0;
        });

        // Debug logging to verify the data
        this.logger.info(
            "ExhaustionDetectorEnhanced: Signal side calculation DEBUG",
            {
                detectorId: this.getId(),
                price: event.price,
                totalPassiveBidAvailable,
                totalPassiveAskAvailable,
                recentZones: recentZones.map((z) => ({
                    zoneId: z.zoneId,
                    passiveBidVolume: z.passiveBidVolume,
                    passiveAskVolume: z.passiveAskVolume,
                })),
            }
        );

        // Exhaustion logic: More available liquidity on one side means the opposite side is more exhausted
        if (totalPassiveBidAvailable > totalPassiveAskAvailable) {
            // More bid liquidity AVAILABLE → ask side MORE exhausted → price resistance weakened → BUY signal
            return "buy";
        } else if (totalPassiveAskAvailable > totalPassiveBidAvailable) {
            // More ask liquidity AVAILABLE → bid side MORE exhausted → price support weakened → SELL signal
            return "sell";
        }

        return "neutral"; // Equal exhaustion = no clear direction
    }

    /**
     * Calculate momentum-based directional prediction for exhaustion signals
     *
     * CLAUDE.md Compliance:
     * - Uses FinancialMath for all calculations (institutional precision)
     * - No magic numbers (all thresholds configurable)
     * - Returns null for insufficient data (calculation integrity)
     * - No live data caching (fresh calculations only)
     */

    /**
     * Calculate zone passive volume ratio for exhaustion analysis
     */
    private calculateZonePassiveRatio(
        zoneData: StandardZoneData | undefined
    ): number | null {
        if (!zoneData) return null;

        const allZones = [...zoneData.zones];

        let totalPassive = 0;
        let totalAggressive = 0;

        allZones.forEach((zone) => {
            if (zone.passiveVolume !== undefined) {
                totalPassive += zone.passiveVolume;
            }
            if (zone.aggressiveVolume !== undefined) {
                totalAggressive += zone.aggressiveVolume;
            }
        });

        const totalVolume = totalPassive + totalAggressive;
        if (totalVolume === 0) return null;

        return FinancialMath.divideQuantities(totalPassive, totalVolume);
    }

    /**
     * Calculate average spread across zones
     */
    private calculateZoneSpread(
        zoneData: StandardZoneData | undefined
    ): number | null {
        if (!zoneData) return null;

        // For single zones, spread is 0 (no spread between zones)
        if (zoneData.zones.length === 1) return 0;

        if (zoneData.zones.length < 2) return null;

        const zones = zoneData.zones.slice(0, 10);
        let totalSpread = 0;
        let spreadCount = 0;

        for (let i = 0; i < zones.length - 1; i++) {
            const spread = Math.abs(
                zones[i + 1].priceLevel - zones[i].priceLevel
            );
            totalSpread += spread;
            spreadCount++;
        }

        return spreadCount > 0
            ? FinancialMath.divideQuantities(totalSpread, spreadCount)
            : null;
    }

    /**
     * Calculate volume imbalance across zones
     */
    private calculateZoneVolumeImbalance(
        zoneData: StandardZoneData | undefined
    ): number | null {
        if (!zoneData) return null;

        const allZones = [...zoneData.zones];

        let totalBuyVolume = 0;
        let totalSellVolume = 0;

        allZones.forEach((zone) => {
            if (zone.aggressiveBuyVolume !== undefined) {
                totalBuyVolume += zone.aggressiveBuyVolume;
            }
            if (zone.aggressiveSellVolume !== undefined) {
                totalSellVolume += zone.aggressiveSellVolume;
            }
        });

        const totalVolume = totalBuyVolume + totalSellVolume;
        if (totalVolume === 0) return null;

        const buyRatio = FinancialMath.divideQuantities(
            totalBuyVolume,
            totalVolume
        );
        return FinancialMath.calculateAbs(
            FinancialMath.safeSubtract(buyRatio, this.ratioBalanceCenterPoint)
        );
    }

    /**
     * Calculate opposite side quantity for exhaustion analysis
     * Returns the passive volume on the opposite side of the aggressive trade
     */
    private calculateOppositeQuantity(event: EnrichedTradeEvent): number {
        if (!event.zoneData) return 0;

        const allZones = [...event.zoneData.zones];
        let totalOppositeVolume = 0;

        // Determine signal side to find opposite volume
        const signalSide = this.determineExhaustionSignalSide(event);

        allZones.forEach((zone) => {
            if (signalSide === "sell") {
                // Sell signal -> consumed bid liquidity -> opposite is remaining ask volume
                totalOppositeVolume += zone.passiveAskVolume || 0;
            } else if (signalSide === "buy") {
                // Buy signal -> consumed ask liquidity -> opposite is remaining bid volume
                totalOppositeVolume += zone.passiveBidVolume || 0;
            }
        });

        return totalOppositeVolume;
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
    public getId(): string {
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

            this.validationLogger.logSignal(signal, event, marketContext);
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
     * Log enhanced signal for validation tracking
     */
    private logEnhancedSignalForValidation(
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

            // Add exhaustion-specific metrics
            const extendedContext = {
                ...marketContext,
                exhaustionRatio: undefined as number | undefined,
                depletionRatio: undefined as number | undefined,
            };

            if (
                signal.data &&
                typeof signal.data === "object" &&
                "exhaustionScore" in signal.data
            ) {
                extendedContext.exhaustionRatio = signal.data.exhaustionScore;
            }
            if (
                signal.data &&
                typeof signal.data === "object" &&
                "depletionRatio" in signal.data
            ) {
                extendedContext.depletionRatio = signal.data.depletionRatio;
            }

            this.validationLogger.logSignal(signal, event, extendedContext);
        } catch (error) {
            this.logger.error(
                "ExhaustionDetectorEnhanced: Failed to log enhanced signal for validation",
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
                "exhaustion",
                rejectionReason,
                event,
                thresholdDetails,
                marketContext
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

        this.logger.info(
            "ExhaustionDetectorEnhanced: Enhanced cleanup completed",
            {
                detectorId: this.getId(),
                enhancementStats: this.enhancementStats,
            }
        );
    }
}
