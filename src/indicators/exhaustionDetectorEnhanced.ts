// src/indicators/exhaustionDetectorEnhanced.ts
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
    TraditionalIndicators,
    TraditionalIndicatorValues,
} from "./helpers/traditionalIndicators.js";
import type {
    EnrichedTradeEvent,
    StandardZoneData,
    ZoneSnapshot,
} from "../types/marketEvents.js";
import type {
    SignalCandidate,
    ExhaustionThresholdChecks,
    SignalType,
} from "../types/signalTypes.js";
import { z } from "zod";
import { ExhaustionDetectorSchema } from "../core/config.js";

interface VolumePressure {
    directionalAggressiveVolume: number;
    directionalPassiveVolume: number;
    totalDirectionalVolume: number;
    accumulatedAggressiveRatio: number;
    accumulatedPassiveRatio: number;
}

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
 * This enhanced detector provides sophisticated multi-timeframe exhaustion analysis using
 * Universal Zones from the preprocessor, with all parameters configurable and no magic numbers.
 */
export class ExhaustionDetectorEnhanced extends Detector {
    private readonly enhancementStats: ExhaustionEnhancementStats;
    private readonly zoneTracker: ExhaustionZoneTracker;

    // Signal cooldown tracking (CLAUDE.md compliance - no magic cooldown values)
    private readonly lastSignal = new Map<string, number>();

    constructor(
        id: string,
        private readonly settings: ExhaustionEnhancedSettings,
        private readonly preprocessor: IOrderflowPreprocessor,
        logger: ILogger,
        metricsCollector: IMetricsCollector,
        signalLogger: ISignalLogger,
        private readonly validationLogger: SignalValidationLogger,
        protected override readonly traditionalIndicators: TraditionalIndicators
    ) {
        // Initialize parent Detector (not ExhaustionDetector)
        super(
            id,
            logger,
            metricsCollector,
            signalLogger,
            traditionalIndicators
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

        const zoneTrackerConfig: ZoneTrackerConfig = {
            maxZonesPerSide: settings.maxZonesPerSide,
            historyWindowMs: settings.zoneHistoryWindowMs,
            depletionThreshold: settings.zoneDepletionThreshold,
            minPeakVolume: settings.minPeakVolume || settings.minAggVolume,
            gapDetectionTicks: settings.gapDetectionTicks,
        };
        this.zoneTracker = new ExhaustionZoneTracker(
            zoneTrackerConfig,
            Config.TICK_SIZE
        );

        this.logger.info("ExhaustionDetectorEnhanced initialized", {
            detectorId: this.getId(),
        });
    }

    public onEnrichedTrade(event: EnrichedTradeEvent): void {
        if (!event.zoneData) {
            return;
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
     * Get enhancement statistics for monitoring and debugging
     *
     * EXHAUSTION PHASE 1: Statistics and monitoring interface
     */
    public getEnhancementStats(): ExhaustionEnhancementStats {
        return { ...this.enhancementStats };
    }

    /**
     * Get detector status - implements required BaseDetector interface
     */
    public getStatus(): string {
        return `Exhaustion Enhanced`;
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
     * Core exhaustion analysis using standardized zones
     *
     * STANDALONE VERSION: Multi-timeframe exhaustion analysis
     */
    private analyzeExhaustionPattern(event: EnrichedTradeEvent): void {
        // 🔍 STEP 1: Core exhaustion detection first
        const signalCandidate = this.detectCoreExhaustion(event);
        if (!signalCandidate) {
            return; // No core exhaustion - no signals at all
        }

        // STEP 2: Emit the signal
        const eventKey = `exhaustion`; // Single cooldown for all exhaustion signals
        if (!this.canEmitSignal(eventKey)) {
            // Always log cooldown blocking for auditability and tests
            this.logger.debug(
                "ExhaustionDetectorEnhanced: Signal blocked by cooldown",
                {
                    detectorId: this.getId(),
                    price: event.price,
                    eventKey,
                    cooldownMs: this.settings.eventCooldownMs,
                }
            );
            return;
        }

        // Update cooldown tracking before emitting signal
        this.canEmitSignal(eventKey, true);
        this.emit("signalCandidate", signalCandidate);

        this.logger.info(
            "ExhaustionDetectorEnhanced: CORE EXHAUSTION DETECTED",
            {
                detectorId: this.getId(),
                price: event.price,
                side: signalCandidate.side,
                confidence: signalCandidate.confidence,
                signalId: signalCandidate.id,
                signalType: "exhaustion",
            }
        );
    }

    /**
     * Check if we can emit a signal for this detector (respects cooldown)
     */
    private canEmitSignal(eventKey: string, update: boolean = false): boolean {
        // Note: For signal cooldown, we still use Date.now() since it's system time management
        // not market data timing. This is acceptable as per architectural guidelines.
        const now = Date.now();
        const lastSignalTime = this.lastSignal.get(eventKey) || 0;

        if (now - lastSignalTime <= this.settings.eventCooldownMs) {
            return false;
        }

        if (update) {
            this.lastSignal.set(eventKey, now);
        }
        return true;
    }

    private detectCoreExhaustion(
        event: EnrichedTradeEvent
    ): SignalCandidate | null {
        const relevantZones = this.findRelevantZones(event);
        if (!relevantZones) {
            return null;
        }

        const volumePressure = this.calculateVolumePressure(
            event.buyerIsMaker,
            relevantZones
        );
        if (!volumePressure) {
            return null;
        }

        // minAggVolume: directionalAggressive >= this.enhancementConfig.minAggVolume
        const passesThreshold_minAggVolume =
            volumePressure.directionalAggressiveVolume >=
            this.settings.minAggVolume;

        // passiveRatioBalanceThreshold EQS
        const passesThreshold_passiveRatioBalanceThreshold =
            volumePressure.accumulatedPassiveRatio <=
            this.settings.passiveRatioBalanceThreshold;

        const depletionResult = this.analyzeLiquidityDepletion(
            event.zoneData,
            event
        );
        const hasDepletion = depletionResult.hasDepletion;

        // exhaustionThreshold EQL : Depletion Ratio
        const passesThreshold_exhaustionThreshold =
            depletionResult.depletionRatio >= this.settings.exhaustionThreshold;

        const isExhaustion =
            passesThreshold_minAggVolume &&
            passesThreshold_passiveRatioBalanceThreshold &&
            hasDepletion &&
            passesThreshold_exhaustionThreshold;

        const thresholdChecks: ExhaustionThresholdChecks = {
            minAggVolume: {
                threshold: this.settings.minAggVolume,
                calculated: volumePressure.directionalAggressiveVolume,
                op: "EQL", // Check: directionalAggressive >= this.enhancementConfig.minAggVolume
            },
            passiveRatioBalanceThreshold: {
                threshold: this.settings.passiveRatioBalanceThreshold,
                calculated: volumePressure.accumulatedPassiveRatio,
                op: "EQL", // Check: accumulatedPassiveRatio >= this.enhancementConfig.passiveRatioBalanceThreshold
            },
            exhaustionThreshold: {
                threshold: this.settings.exhaustionThreshold,
                calculated: depletionResult.depletionRatio,
                op: "EQL", // Check: depletionResult.depletionRatio >= settings.exhaustionThreshold,
            },
        };

        const dominantSide =
            this.determineExhaustionSignalSide(depletionResult);

        // Update current price for signal validation
        this.validationLogger.updateCurrentPrice(event.price);

        const signalSide =
            (dominantSide ?? event.buyerIsMaker) ? "sell" : "buy";

        // MANDATORY: Calculate traditional indicators for ALL signals (pass or reject)
        // Exhaustion signals are reversal signals - liquidity depletion at extremes
        const traditionalIndicatorResult =
            this.traditionalIndicators.validateSignal(
                event.price,
                signalSide,
                "reversal" // Exhaustion detects reversals from liquidity depletion
            );

        if (
            isExhaustion &&
            traditionalIndicatorResult.overallDecision !== "filter"
        ) {
            // Signal passes all thresholds AND traditional indicators

            const signalCandidate: SignalCandidate = {
                id: `core-exhaustion-${event.timestamp}-${event.price}-${depletionResult.depletionRatio}}`,
                type: "exhaustion" as SignalType,
                side: signalSide,
                confidence: 1,
                timestamp: event.timestamp,
                traditionalIndicators: {
                    vwap: traditionalIndicatorResult.vwap.value,
                    rsi: traditionalIndicatorResult.rsi.value,
                    oir: traditionalIndicatorResult.oir.value,
                    decision: traditionalIndicatorResult.overallDecision,
                    filtersTriggered:
                        traditionalIndicatorResult.filtersTriggered,
                },
                data: {
                    price: event.price,
                    side: (dominantSide ?? event.buyerIsMaker) ? "sell" : "buy",
                    aggressive: volumePressure.directionalAggressiveVolume,
                    oppositeQty: volumePressure.directionalPassiveVolume,
                    exhaustionScore: depletionResult.depletionRatio,
                    depletionRatio: depletionResult.depletionRatio,
                    passiveVolumeRatio: volumePressure.accumulatedPassiveRatio,
                    avgLiquidity: 0,
                    spread: 0,
                    confidence: 1,
                },
            };

            this.logSignalForValidation(
                signalCandidate,
                event,
                thresholdChecks,
                traditionalIndicatorResult
            );
            void this.logSuccessfulSignalParameters(
                signalCandidate,
                event,
                thresholdChecks,
                traditionalIndicatorResult
            );

            return signalCandidate;
        } else {
            // No Exhaustion
            // Determine primary rejection reason for logging
            let rejectionReason = "comprehensive_rejection";
            let thresholdType = "multiple_thresholds";
            let thresholdValue = 0;
            let actualValue = 0;

            if (traditionalIndicatorResult.overallDecision === "filter") {
                rejectionReason = "traditional_indicators_filter";
                thresholdType = "traditional_indicators";
                thresholdValue = 1;
                actualValue = 0;
            } else if (!passesThreshold_minAggVolume) {
                rejectionReason = "insufficient_aggressive_volume";
                thresholdType = "aggressive_volume";
                thresholdValue = this.settings.minAggVolume;
                actualValue = volumePressure.directionalAggressiveVolume;
            } else if (!passesThreshold_passiveRatioBalanceThreshold) {
                rejectionReason = "passive_volume_ratio_too_high";
                thresholdType = "passive_volume_ratio";
                thresholdValue = this.settings.passiveRatioBalanceThreshold;
                actualValue = volumePressure.accumulatedPassiveRatio;
            } else if (!hasDepletion) {
                rejectionReason = "no_depletion_detected";
                thresholdType = "no_depletion";
                thresholdValue = 1;
                actualValue = 0;
            } else if (!passesThreshold_exhaustionThreshold) {
                rejectionReason = "insufficient_depletion_threshold";
                thresholdType = "depletion_ratio";
                thresholdValue = this.settings.exhaustionThreshold;
                actualValue = depletionResult.depletionRatio;
            }

            // Log the rejection
            this.validationLogger.logRejection(
                "exhaustion",
                rejectionReason,
                event,
                {
                    type: thresholdType,
                    threshold: thresholdValue,
                    actual: actualValue,
                },
                thresholdChecks,
                signalSide,
                traditionalIndicatorResult
            );
            return null;
        }
    }

    private determineExhaustionSignalSide(depletionResult: {
        exhaustionType: "bid" | "ask" | "both" | null;
    }): "buy" | "sell" | null {
        // Use the ACTUAL depletion data, not static comparison
        switch (depletionResult.exhaustionType) {
            case "ask":
                // Asks depleted → resistance exhausted → reversal DOWN
                return "sell";
            case "bid":
                // Bids depleted → support exhausted → reversal UP
                return "buy";
            case "both":
                // Both sides depleted → unclear direction
                return null;
            default:
                return null;
        }
    }

    /**
     * Log signal for validation tracking
     */
    private logSignalForValidation(
        signal: SignalCandidate,
        event: EnrichedTradeEvent,
        thresholdChecks: ExhaustionThresholdChecks,
        traditionalIndicatorResult: TraditionalIndicatorValues
    ): void {
        try {
            this.validationLogger.logSignal(
                signal,
                event,
                thresholdChecks,
                traditionalIndicatorResult
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
        event: EnrichedTradeEvent,
        thresholdChecks: ExhaustionThresholdChecks,
        traditionalIndicatorResult: TraditionalIndicatorValues
    ): void {
        try {
            // Collect ACTUAL VALUES that each parameter was checked against when signal passed

            this.validationLogger.logSuccessfulSignal(
                "exhaustion",
                event,
                thresholdChecks,
                signal.side,
                traditionalIndicatorResult
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
     * Analyze liquidity depletion across standardized zones
     *
     * Enhanced depletion detection
     */
    private analyzeLiquidityDepletion(
        zoneData: StandardZoneData,
        event: EnrichedTradeEvent
    ): {
        hasDepletion: boolean;
        depletionRatio: number;
        affectedZones: number;
        exhaustionType: "bid" | "ask" | "both" | null;
    } {
        // If dynamic zone tracking is enabled, use the new tracker
        // CRITICAL: Update spread BEFORE updating zones so zones can be properly filtered
        if (event.bestBid && event.bestAsk) {
            this.zoneTracker.updateSpread(event.bestBid, event.bestAsk);
        }

        // Update zones in tracker - will now correctly filter based on spread
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
            exhaustionType: exhaustionPattern.exhaustionType,
        };
    }

    /**
     * Calculate volume pressure using FinancialMath for institutional precision
     * DIRECTIONAL FIX: Only count passive and aggressive volume relevant to trade direction
     */
    private calculateVolumePressure(
        buyerIsMaker: boolean,
        relevantZones: ZoneSnapshot[]
    ): VolumePressure | null {
        // Calculate total aggressive volume using FinancialMath.safeAdd
        let directionalAggressiveVolume = 0;
        let directionalPassiveVolume = 0;

        // Determine which passive volume is relevant based on trade direction
        // - Buy trades (buyerIsMaker = false): Only count passiveAskVolume (hitting asks)
        // - Sell trades (buyerIsMaker = true): Only count passiveBidVolume (hitting bids)
        for (const zone of relevantZones) {
            // Get directional volumes
            const directionalAggressive = !buyerIsMaker
                ? (zone.aggressiveBuyVolume ?? 0) // Buy trades: only aggressive buying affects asks
                : (zone.aggressiveSellVolume ?? 0); // Sell trades: only aggressive selling affects bids
            const directionalPassive = !buyerIsMaker
                ? (zone.passiveAskVolume ?? 0) // Buy trades absorb ask liquidity
                : (zone.passiveBidVolume ?? 0); // Sell trades absorb bid liquidity

            // Validate inputs before FinancialMath calls to prevent NaN BigInt errors
            if (
                !FinancialMath.isValidFinancialNumber(directionalAggressive) ||
                !FinancialMath.isValidFinancialNumber(directionalPassive)
            ) {
                return null; // Skip this calculation if any zone has NaN values
            }

            directionalAggressiveVolume = FinancialMath.safeAdd(
                directionalAggressiveVolume,
                directionalAggressive
            );

            // DIRECTIONAL PASSIVE VOLUME: Add the relevant passive volume already calculated
            directionalPassiveVolume = FinancialMath.safeAdd(
                directionalPassiveVolume,
                directionalPassive
            );
        }

        if (directionalPassiveVolume === 0) return null; // Prevent division by zero

        // Calculate pressure ratio using FinancialMath.divideQuantities
        const totalDirectionalVolume = FinancialMath.safeAdd(
            directionalAggressiveVolume,
            directionalPassiveVolume
        );

        // Calculate exhaustion ratio using directional volumes
        const accumulatedAggressiveRatio = FinancialMath.divideQuantities(
            directionalAggressiveVolume,
            totalDirectionalVolume
        );
        const accumulatedPassiveRatio = FinancialMath.divideQuantities(
            directionalPassiveVolume,
            totalDirectionalVolume
        );

        return {
            directionalAggressiveVolume,
            directionalPassiveVolume,
            totalDirectionalVolume,
            accumulatedAggressiveRatio,
            accumulatedPassiveRatio,
        };
    }

    // Find zones near the current price from recent zones only
    private findRelevantZones(
        event: EnrichedTradeEvent
    ): ZoneSnapshot[] | null {
        const allZones = [...event.zoneData.zones];
        if (allZones.length === 0) {
            return null;
        }

        // Filter zones by time window using trade timestamp
        const windowStartTime =
            event.timestamp - this.settings.zoneHistoryWindowMs;
        const recentZones = allZones.filter(
            (zone) => zone.lastUpdate >= windowStartTime
        );

        // confluenceMaxDistance: [CONSTANT]: this.enhancementConfig.confluenceMaxDistance ==> filter relevantZones,
        const relevantZones = this.preprocessor.findZonesNearPrice(
            recentZones,
            event.price,
            Config.UNIVERSAL_ZONE_CONFIG.maxZoneConfluenceDistance
        );
        if (relevantZones.length === 0) {
            return null;
        }

        // Apply confluence detection - require minimum number of zones
        // This adds quality control: we need multiple zones confirming exhaustion
        if (
            relevantZones.length <
            Config.UNIVERSAL_ZONE_CONFIG.minZoneConfluenceCount
        ) {
            this.logger.debug(
                "ExhaustionDetectorEnhanced: Insufficient zone confluence",
                {
                    detectorId: this.getId(),
                    price: event.price,
                    zonesFound: relevantZones.length,
                    minRequired:
                        Config.UNIVERSAL_ZONE_CONFIG.minZoneConfluenceCount,
                }
            );
            return null;
        }

        return relevantZones;
    }
}
