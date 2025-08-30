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
    ZoneSnapshot,
    StandardZoneData,
} from "../types/marketEvents.js";
import type { PhaseContext } from "../types/marketEvents.js";
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

    // Dynamic thresholding
    private passiveRatioHistory: number[] = [];
    private rollingPassiveRatioAverage = 0;
    private readonly ROLLING_WINDOW_SIZE = 100;

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
            minPeakVolume: settings.minPeakVolume,
            gapDetectionTicks: settings.gapDetectionTicks,
            consumptionValidation: settings.consumptionValidation,
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

        // STEP 2: Phase filtering - only emit reversal signals
        const phaseContext = event.phaseContext;
        if (phaseContext?.currentPhase) {
            const phaseDirection = phaseContext.currentPhase.direction;
            const signalSide = signalCandidate.side;

            // STEP 2.5: Phase extreme proximity validation (within 0.1% of extreme)
            const phaseExtreme = this.calculatePhaseExtreme(phaseContext);
            if (phaseExtreme !== null) {
                const distanceFromExtreme =
                    Math.abs(event.price - phaseExtreme) / event.price;
                const maxDistance = 0.001; // 0.1% threshold

                if (distanceFromExtreme > maxDistance) {
                    this.logger.debug(
                        "ExhaustionDetectorEnhanced: Signal too far from phase extreme",
                        {
                            detectorId: this.getId(),
                            price: event.price,
                            phaseExtreme,
                            distanceFromExtreme:
                                (distanceFromExtreme * 100).toFixed(3) + "%",
                            maxAllowed: maxDistance * 100 + "%",
                            reason: "phase_extreme_proximity",
                        }
                    );
                    return; // Reject signal - too far from phase extreme
                }

                this.logger.debug(
                    "ExhaustionDetectorEnhanced: Phase extreme proximity validated",
                    {
                        detectorId: this.getId(),
                        price: event.price,
                        phaseExtreme,
                        distanceFromExtreme:
                            (distanceFromExtreme * 100).toFixed(3) + "%",
                    }
                );
            }

            // Only emit reversal signals for directional phases:
            // - Bid exhaustion during UP phase (potential top reversal)
            // - Ask exhaustion during DOWN phase (potential bottom reversal)
            const isReversal =
                phaseDirection === "SIDEWAYS" ||
                (phaseDirection === "UP" && signalSide === "sell") ||
                (phaseDirection === "DOWN" && signalSide === "buy");

            if (!isReversal) {
                // Skip trend-confirming signals
                this.logger.debug(
                    "ExhaustionDetectorEnhanced: Signal skipped - trend-confirming",
                    {
                        detectorId: this.getId(),
                        price: event.price,
                        signalSide,
                        phaseDirection,
                        phaseAge: phaseContext.currentPhase.age,
                        phaseSize: phaseContext.currentPhase.currentSize,
                        reason: "trend_confirming_exhaustion",
                    }
                );
                //return; // TODO turned off temporarely for validation logging
            }

            // Log reversal signal detection
            this.logger.debug(
                "ExhaustionDetectorEnhanced: Reversal exhaustion detected",
                {
                    detectorId: this.getId(),
                    price: event.price,
                    signalSide,
                    phaseDirection,
                    phaseAge: phaseContext.currentPhase.age,
                    phaseSize: phaseContext.currentPhase.currentSize,
                    isReversal: true,
                }
            );
        } else {
            // No phase context - still emit signal but log this condition
            this.logger.debug(
                "ExhaustionDetectorEnhanced: No phase context - emitting signal",
                {
                    detectorId: this.getId(),
                    price: event.price,
                    signalSide: signalCandidate.side,
                }
            );
        }

        // STEP 3: Emit the signal
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

        // Update rolling average and history
        this.passiveRatioHistory.push(volumePressure.accumulatedPassiveRatio);
        if (this.passiveRatioHistory.length > this.ROLLING_WINDOW_SIZE) {
            this.passiveRatioHistory.shift();
        }
        this.rollingPassiveRatioAverage =
            this.passiveRatioHistory.reduce((a, b) => a + b, 0) /
            this.passiveRatioHistory.length;

        const stdDev = Math.sqrt(
            this.passiveRatioHistory
                .map((x) => Math.pow(x - this.rollingPassiveRatioAverage, 2))
                .reduce((a, b) => a + b, 0) / this.passiveRatioHistory.length
        );

        let passesThreshold_passiveRatioBalanceThreshold =
            volumePressure.accumulatedPassiveRatio <=
            this.rollingPassiveRatioAverage +
                stdDev * this.settings.passiveRatioAnomalyStdDev;

        const depletionResult = this.analyzeLiquidityDepletion(
            event.zoneData,
            event
        );
        const hasDepletion = depletionResult.hasDepletion;

        // exhaustionThreshold EQL : Depletion Ratio
        const passesThreshold_exhaustionThreshold =
            depletionResult.depletionRatio >= this.settings.exhaustionThreshold;

        // Check special overrides:
        // Scenario 1: Extreme Depletion Override
        if (
            hasDepletion &&
            depletionResult.depletionRatio >=
                this.settings.extremeDepletionOverrideThreshold
        ) {
            if (!passesThreshold_passiveRatioBalanceThreshold) {
                this.logger.info(
                    `[Exhaustion Override] Extreme Depletion triggered for ${this.getId()}. Bypassing balance checks.`
                );
                passesThreshold_passiveRatioBalanceThreshold = true;
            }
        }

        const isExhaustion =
            passesThreshold_passiveRatioBalanceThreshold &&
            hasDepletion &&
            passesThreshold_exhaustionThreshold;

        const thresholdChecks: ExhaustionThresholdChecks = {
            passiveRatioBalanceThreshold: {
                threshold: this.settings.passiveRatioBalanceThreshold,
                calculated: volumePressure.accumulatedPassiveRatio,
                op: "EQS", // Check: accumulatedPassiveRatio >= this.enhancementConfig.passiveRatioBalanceThreshold
            },
            exhaustionThreshold: {
                threshold: this.settings.exhaustionThreshold,
                calculated: depletionResult.depletionRatio,
                op: "EQL", // Check: depletionResult.depletionRatio >= settings.exhaustionThreshold,
            },
            minPeakVolumeCheck: {
                threshold: this.settings.minPeakVolume,
                calculated: volumePressure.directionalAggressiveVolume,
                op: "EQL",
            },
            phaseContext: event.phaseContext,
        };

        const dominantSide =
            this.determineExhaustionSignalSide(depletionResult);

        // Update current price for signal validation
        this.validationLogger.updateCurrentPrice(event.price);

        // CRITICAL FIX: Remove buyerIsMaker fallback - use passive-side logic only
        const signalSide = dominantSide;

        // Skip signal if direction is ambiguous (both sides depleted)
        if (!signalSide) {
            this.logger.debug(
                "ExhaustionDetectorEnhanced: Ambiguous exhaustion direction - skipping signal",
                {
                    detectorId: this.getId(),
                    price: event.price,
                    dominantSide: null,
                    reason: "both_sides_depleted",
                }
            );
            return null;
        }

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
                    side: dominantSide,
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
        // Exhaustion reverses a trend.
        // If buying pressure is exhausted (asks depleted), the trend reverses DOWN -> "sell" signal.
        // If selling pressure is exhausted (bids depleted), the trend reverses UP -> "buy" signal.
        switch (depletionResult.exhaustionType) {
            case "ask":
                // Buying pressure exhausted at resistance. Expect price to reverse DOWN.
                return "sell";
            case "bid":
                // Selling pressure exhausted at support. Expect price to reverse UP.
                return "buy";
            case "both":
                // Both sides are depleted; the direction is ambiguous.
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
        passesMinPeakVolume: boolean; // Added this line
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
        } else {
            this.logger.debug("Dynamic zone tracking:", { exhaustionPattern });
        }

        return {
            hasDepletion: exhaustionPattern.hasExhaustion,
            depletionRatio: exhaustionPattern.depletionRatio,
            affectedZones: exhaustionPattern.affectedZones,
            exhaustionType: exhaustionPattern.exhaustionType,
            passesMinPeakVolume: exhaustionPattern.passesMinPeakVolume,
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

        // A single, significant zone can be enough to signal exhaustion.
        // By setting the requirement to 1, we allow the detector to analyze these scenarios.
        const minRequiredZones = 1;
        if (relevantZones.length < minRequiredZones) {
            this.logger.debug(
                "ExhaustionDetectorEnhanced: Insufficient zone confluence",
                {
                    detectorId: this.getId(),
                    price: event.price,
                    zonesFound: relevantZones.length,
                    minRequired: minRequiredZones,
                }
            );
            return null;
        }

        return relevantZones;
    }

    /**
     * Calculate the phase extreme price for proximity validation
     * Returns the highest/lowest price in the current phase
     */
    private calculatePhaseExtreme(phaseContext: PhaseContext): number | null {
        if (!phaseContext?.currentPhase) {
            return null;
        }

        const phase = phaseContext.currentPhase;

        // For UP phases, the extreme is the start price + current size (highest point)
        // For DOWN phases, the extreme is the start price - current size (lowest point)
        // For SIDEWAYS phases, use the consolidation boundaries

        switch (phase.direction) {
            case "UP":
                // UP phase extreme is the highest point reached
                return (
                    phase.startPrice * (1 + Math.abs(phase.currentSize) / 100)
                );
            case "DOWN":
                // DOWN phase extreme is the lowest point reached
                return (
                    phase.startPrice * (1 - Math.abs(phase.currentSize) / 100)
                );
            case "SIDEWAYS":
                // For sideways phases, use the consolidation range center
                if (phase.consolidationHigh && phase.consolidationLow) {
                    return (
                        (phase.consolidationHigh + phase.consolidationLow) / 2
                    );
                }
                return phase.startPrice; // Fallback to start price
            default:
                return null;
        }
    }
}
