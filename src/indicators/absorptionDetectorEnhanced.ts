// src/indicators/absorptionDetectorEnhanced.ts

import { z } from "zod";
import { Detector } from "./base/detectorEnrichedTrade.js";
import { FinancialMath } from "../utils/financialMath.js";
import { SignalValidationLogger } from "../utils/signalValidationLogger.js";
import type { ILogger } from "../infrastructure/loggerInterface.js";
import type { IMetricsCollector } from "../infrastructure/metricsCollectorInterface.js";
import type { IOrderflowPreprocessor } from "../market/orderFlowPreprocessor.js";
import type { ISignalLogger } from "../infrastructure/signalLoggerInterface.js";
import type {
    TraditionalIndicators,
    TraditionalIndicatorValues,
} from "./helpers/traditionalIndicators.js";
import {
    AbsorptionZoneTracker,
    type AbsorptionTrackerConfig,
} from "./helpers/absorptionZoneTracker.js";
import { AbsorptionDetectorSchema, Config } from "../core/config.js";
import { AbsorptionABTestManager } from "../services/absorptionABTestManager.js";
import type {
    EnrichedTradeEvent,
    ZoneSnapshot,
    StandardZoneData,
    PhaseContext,
} from "../types/marketEvents.js";

import type {
    SignalCandidate,
    SignalType,
    AbsorptionThresholdChecks,
} from "../types/signalTypes.js";

/**
 * Statistics interface for monitoring absorption detector enhancements
 * Comprehensive monitoring and debugging
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

interface VolumePressure {
    directionalAggressiveVolume: number;
    directionalPassiveVolume: number;
    totalDirectionalVolume: number;
    pressureRatio: number;
}

const _BALANCE_CENTER_POINT = 0.5;

/**
 * Enhanced configuration interface for absorption detection - ONLY absorption-specific parameters
 *
 * STANDALONE VERSION: Core interface for enhanced absorption detection
 */
// Use Zod schema inference for complete type safety - matches config.json exactly
export type AbsorptionEnhancedSettings = z.infer<
    typeof AbsorptionDetectorSchema
>;

export class AbsorptionDetectorEnhanced extends Detector {
    private readonly windowMs: number;
    private readonly enhancementStats: AbsorptionEnhancementStats;

    // Dynamic thresholding
    private passiveVolumeRatioHistory: number[] = [];

    // Dynamic zone tracking for true absorption detection
    private readonly zoneTracker: AbsorptionZoneTracker;

    // Signal cooldown tracking (CLAUDE.md compliance - no magic cooldown values)
    private readonly lastSignal = new Map<string, number>();

    // A/B testing properties
    private abTestManager?: AbsorptionABTestManager;
    private abTestVariant?: AbsorptionVariant;
    private testId = "absorption-optimization";

    constructor(
        id: string,
        private readonly settings: AbsorptionEnhancedSettings,
        private readonly preprocessor: IOrderflowPreprocessor,
        logger: ILogger,
        metrics: IMetricsCollector,
        private readonly validationLogger: SignalValidationLogger,
        signalLogger: ISignalLogger,
        protected override readonly traditionalIndicators: TraditionalIndicators
    ) {
        super(id, logger, metrics, signalLogger, traditionalIndicators);
        this.windowMs = Config.getTimeWindow(settings.timeWindowIndex);
        this.enhancementStats = this.initEnhancementStats();

        // Initialize dynamic zone tracking
        const zoneTrackerConfig: AbsorptionTrackerConfig = {
            maxZonesPerSide: settings.maxZonesPerSide,
            historyWindowMs: settings.zoneHistoryWindowMs,
            absorptionThreshold: settings.absorptionZoneThreshold,
            minPassiveVolume: settings.minPassiveVolumeForZone,
            priceStabilityTicks: settings.priceStabilityTicks,
            minAbsorptionEvents: settings.minAbsorptionEvents,
        };
        this.zoneTracker = new AbsorptionZoneTracker(
            zoneTrackerConfig,
            Config.TICK_SIZE
        );

        // Initialize A/B testing if enabled
        if (process.env["ABSORPTION_AB_TESTING"] === "true") {
            this.abTestManager = new AbsorptionABTestManager(logger, metrics);
            this.abTestVariant = this.abTestManager.assignVariant(
                id,
                this.testId
            );

            if (this.abTestVariant) {
                // Apply variant-specific settings
                (this.settings as any).passiveAbsorptionThreshold =
                    this.abTestVariant.thresholds.passiveAbsorptionThreshold;
                (this.settings as any).minPassiveMultiplier =
                    this.abTestVariant.thresholds.minPassiveMultiplier;
                (this.settings as any).priceEfficiencyThreshold =
                    this.abTestVariant.thresholds.priceEfficiencyThreshold;
                (this.settings as any).balanceThreshold =
                    this.abTestVariant.thresholds.balanceThreshold;
                (this.settings as any).priceStabilityTicks =
                    this.abTestVariant.thresholds.priceStabilityTicks;
                (this.settings as any).absorptionDirectionThreshold =
                    this.abTestVariant.thresholds.absorptionDirectionThreshold;
                (this.settings as any).minPassiveVolumeForDirection =
                    this.abTestVariant.thresholds.minPassiveVolumeForDirection;
                (this.settings as any).useZoneSpecificPassiveVolume =
                    this.abTestVariant.phaseTiming.useZoneSpecificPassiveVolume;

                this.logger.info("Applied A/B test variant", {
                    detectorId: id,
                    variantId: this.abTestVariant.variantId,
                    variantName: this.abTestVariant.name,
                    passiveAbsorptionThreshold:
                        this.abTestVariant.thresholds
                            .passiveAbsorptionThreshold,
                    minPassiveMultiplier:
                        this.abTestVariant.thresholds.minPassiveMultiplier,
                });
            }
        }

        this.logger.info("AbsorptionDetectorEnhanced initialized", {
            detectorId: id,
            windowMs: this.windowMs,
            abTestingEnabled: process.env["ABSORPTION_AB_TESTING"] === "true",
            variantApplied: !!this.abTestVariant,
        });
    }

    /**
     * Main trade event processing - implements required BaseDetector interface
     */
    public onEnrichedTrade(event: EnrichedTradeEvent): void {
        // Only process if standardized zones are enabled and available
        if (!event.zoneData) {
            return;
        }
        this.enhancementStats.callCount++;

        try {
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
        return `Absorption Enhanced - Window: ${this.windowMs}ms`;
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
     * Complete absorption detection with enhancement analysis
     */
    private analyzeAbsorptionPattern(event: EnrichedTradeEvent): void {
        this.updateZoneTracker(event);

        // STEP 1: CORE ABSORPTION DETECTION (Required for any signals)
        const signalCandidate = this.detectCoreAbsorption(event);
        if (!signalCandidate) {
            return; // No core absorption - no signals at all
        }

        // STEP 2: Phase filtering - only emit reversal signals
        const phaseContext = event.phaseContext;
        if (phaseContext?.currentPhase) {
            const phaseDirection = phaseContext.currentPhase.direction;
            const signalSide = signalCandidate.side;

            // Only emit reversal signals for directional phases:
            // - Buy absorption during DOWN phase (potential bottom reversal)
            // - Sell absorption during UP phase (potential top reversal)
            const isReversal =
                phaseDirection === "SIDEWAYS" ||
                (phaseDirection === "DOWN" && signalSide === "buy") ||
                (phaseDirection === "UP" && signalSide === "sell");

            if (!isReversal) {
                // Skip trend-confirming signals
                this.logger.debug(
                    "AbsorptionDetectorEnhanced: Signal skipped - trend-confirming",
                    {
                        detectorId: this.getId(),
                        price: event.price,
                        signalSide,
                        phaseDirection,
                        phaseAge: phaseContext.currentPhase.age,
                        phaseSize: phaseContext.currentPhase.currentSize,
                        reason: "trend_confirming_absorption",
                    }
                );
                //return; // TODO turned off temporarely for validation logging
            }

            // Log reversal signal detection
            this.logger.debug(
                "AbsorptionDetectorEnhanced: Reversal absorption detected",
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
                "AbsorptionDetectorEnhanced: No phase context - emitting signal",
                {
                    detectorId: this.getId(),
                    price: event.price,
                    signalSide: signalCandidate.side,
                }
            );
        }

        // STEP 3: EMIT SINGLE SIGNAL with quality flags
        // Check signal cooldown to prevent too many signals
        const eventKey = `absorption`; // Single cooldown for all absorption signals
        if (!this.canEmitSignal(eventKey)) {
            this.logger.debug(
                "AbsorptionDetectorEnhanced: Signal blocked by cooldown",
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

        // Record A/B testing results if enabled
        if (
            process.env["ABSORPTION_AB_TESTING"] === "true" &&
            this.abTestManager &&
            this.abTestVariant
        ) {
            this.abTestManager.recordSignalResult(
                this.getId(),
                this.testId,
                this.abTestVariant.variantId,
                {
                    signalId: signalCandidate.id,
                    side: signalCandidate.side,
                    price: event.price,
                    reachedTP: false, // Will be updated when signal completes
                    profit: 0,
                    timeToTP: 0,
                    maxDrawdown: 0,
                }
            );
        }

        this.logger.info(
            "🎯 AbsorptionDetectorEnhanced: ENHANCED ABSORPTION SIGNAL GENERATED!",
            {
                detectorId: this.getId(),
                price: event.price,
                side: signalCandidate.side,
                confidence: signalCandidate.confidence,
                qualityFlags: signalCandidate.qualityFlags,
                signalId: signalCandidate.id,
                signalType: "absorption",
                timestamp: new Date(signalCandidate.timestamp).toISOString(),
                abTestVariant: this.abTestVariant?.name || "none",
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

    /**
     * Core absorption detection logic with FinancialMath compliance
     *
     * INSTITUTIONAL GRADE: Complete absorption detection using standardized zones
     * ARCHITECTURAL PATTERN: Follows successful exhaustion detector restructuring
     */
    private detectCoreAbsorption(
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

        // Calculate passive volume ratio for institutional absorption
        // passiveAbsorptionThreshold: passiveVolumeRatio >= this.enhancementConfig.passiveAbsorptionThreshold
        const passiveVolumeRatio = FinancialMath.divideQuantities(
            volumePressure.directionalPassiveVolume,
            volumePressure.totalDirectionalVolume
        );

        // Update rolling average and history
        this.passiveVolumeRatioHistory.push(passiveVolumeRatio);
        if (
            this.passiveVolumeRatioHistory.length >
            this.settings.rollingWindowSize
        ) {
            this.passiveVolumeRatioHistory.shift();
        }
        // Using a percentile-based threshold is more robust for bounded data [0, 1]
        // as a std dev multiplier can create impossible thresholds > 1.0.
        // The 99th percentile corresponds roughly to a 2.5 std dev cutoff.
        const sortedHistory = [...this.passiveVolumeRatioHistory].sort(
            (a, b) => a - b
        );
        const percentileIndex = Math.floor(sortedHistory.length * 0.9);
        let dynamicPassiveThreshold =
            sortedHistory[percentileIndex] ??
            this.settings.passiveAbsorptionThreshold;
        dynamicPassiveThreshold = Math.max(
            dynamicPassiveThreshold,
            this.settings.passiveAbsorptionThreshold
        );

        const passesThreshold_passiveAbsorptionThreshold =
            passiveVolumeRatio >= dynamicPassiveThreshold;

        // Calculate price efficiency using FinancialMath (institutional precision)
        // priceEfficiencyThreshold: priceEfficiency <= this.enhancementConfig.priceEfficiencyThreshold
        const priceEfficiency = this.calculatePriceEfficiency(
            event,
            relevantZones
        );
        const passesThreshold_priceEfficiencyThreshold =
            priceEfficiency <= this.settings.priceEfficiencyThreshold;

        // Calculate absorption ratio using FinancialMath
        // maxPriceImpactRatio: // Check: priceImpactRatio <= this.enhancementConfig.maxPriceImpactRatio
        const priceImpactRatio = this.calculatePriceImpactRatio(
            event,
            volumePressure.pressureRatio
        );
        let passesThreshold_maxPriceImpactRatio =
            priceImpactRatio !== null &&
            priceImpactRatio <= this.settings.maxPriceImpactRatio;

        // Check passive multiplier (passive must be X times aggressive)
        // minPassiveMultiplier: Check: actualPassiveMultiplier >= this.enhancementConfig.minPassiveMultiplier,
        const actualPassiveMultiplier =
            volumePressure.directionalAggressiveVolume > 0
                ? FinancialMath.divideQuantities(
                      volumePressure.directionalPassiveVolume,
                      volumePressure.directionalAggressiveVolume
                  )
                : 0;
        const passesThreshold_minPassiveMultiplier =
            actualPassiveMultiplier >= this.settings.minPassiveMultiplier;

        // Check volume/multiplier ratio to detect exhaustion patterns (high ratio = exhaustion, not healthy absorption)
        // maxVolumeMultiplierRatio: volumeMultiplierRatio <= this.settings.maxVolumeMultiplierRatio
        const volumeMultiplierRatio =
            actualPassiveMultiplier > 0
                ? FinancialMath.divideQuantities(
                      volumePressure.directionalAggressiveVolume,
                      actualPassiveMultiplier
                  )
                : Number.MAX_SAFE_INTEGER;
        let passesThreshold_maxVolumeMultiplierRatio =
            volumeMultiplierRatio <= this.settings.maxVolumeMultiplierRatio;

        // NOTE: Removed redundant absorptionScore calculation
        // It was identical to passiveVolumeRatio (directionalPassiveVolume / totalDirectionalVolume)
        // minAbsorptionScore threshold has been removed to eliminate duplicate configuration

        // Caluclate balanced flow
        const balancedFlow = this.calculateBalancedFlow(relevantZones);
        let passesThreshold_balanceThreshold =
            balancedFlow && balancedFlow <= this.settings.balanceThreshold;

        // Calculate price movement range in ticks using zone tracker's time-based approach
        const priceMovementTicks = this.zoneTracker.getPriceRangeInTicks();
        let passesThreshold_priceStabilityTicks =
            priceMovementTicks <= this.settings.priceStabilityTicks;

        // Determine dominant side and signal direction
        const dominantSide = this.calculateDominantSide(
            volumePressure.directionalPassiveVolume,
            event.buyerIsMaker
        );

        const phaseContext: PhaseContext = event.phaseContext;
        this.logger.debug("PhaseContext:", { phaseContext });

        // Check special overrides:

        // Combination group 1: Volume Excellence Override (Corrected Logic)
        // Rationale: Massive volume absorbed with low price impact is a textbook institutional signal.
        const volumeExcellenceOverride =
            volumePressure.directionalAggressiveVolume >=
                5 * this.settings.minAggVolume &&
            passiveVolumeRatio > this.settings.passiveAbsorptionThresholdElite;
        if (volumeExcellenceOverride) {
            this.logger.info(
                "[Absorption Override] Volume Excellence triggered."
            );
            // Override balance and stability, but ENFORCE low price impact.
            passesThreshold_balanceThreshold = true;
            passesThreshold_priceStabilityTicks =
                priceMovementTicks <= 3 * this.settings.priceStabilityTicks;
            // CRITICAL CHANGE: Ensure price impact is LOW, not relaxed.
            passesThreshold_maxPriceImpactRatio =
                priceImpactRatio !== null &&
                priceImpactRatio <= this.settings.maxPriceImpactRatio * 0.5;
        }

        // Combination group 2: Efficiency Champion Override (Unchanged)
        // Rationale: Exceptional efficiency + strong passive absorption indicates smart money accumulation.
        const efficiencyChampionOverride =
            priceEfficiency <= this.settings.priceEfficiencyThreshold / 5 &&
            actualPassiveMultiplier >= 3 * this.settings.minPassiveMultiplier;
        if (efficiencyChampionOverride) {
            this.logger.info(
                "[Absorption Override] Efficiency Champion triggered."
            );
            passesThreshold_balanceThreshold = true;
            passesThreshold_maxVolumeMultiplierRatio = true;
            passesThreshold_priceStabilityTicks =
                priceMovementTicks <= 2 * this.settings.priceStabilityTicks;
        }

        // Combination group 3: Institutional Override (Corrected Logic)
        // Rationale: Elite passive absorption indicates sophisticated accumulation patterns.
        const institutionalOverride =
            actualPassiveMultiplier >= 5 * this.settings.minPassiveMultiplier &&
            passiveVolumeRatio >= this.settings.passiveAbsorptionThresholdElite;
        if (institutionalOverride) {
            this.logger.info(
                "[Absorption Override] Institutional Override triggered."
            );
            passesThreshold_balanceThreshold = true;
            // CRITICAL CHANGE: Removed relaxation of price impact. Strong passive absorption should control price.
            passesThreshold_priceStabilityTicks =
                priceMovementTicks <= 2 * this.settings.priceStabilityTicks;
        }

        // Check if we pass all thresholds
        const isCoreAbosrption =
            passesThreshold_minAggVolume &&
            passesThreshold_passiveAbsorptionThreshold &&
            passesThreshold_priceEfficiencyThreshold &&
            passesThreshold_maxPriceImpactRatio &&
            passesThreshold_minPassiveMultiplier &&
            passesThreshold_maxVolumeMultiplierRatio &&
            passesThreshold_balanceThreshold &&
            passesThreshold_priceStabilityTicks &&
            dominantSide;

        // ✅ BUILD THRESHOLD CHECKS: Complete set with threshold, calculated, and operator
        const thresholdChecks: AbsorptionThresholdChecks = {
            minAggVolume: {
                threshold: this.settings.minAggVolume,
                calculated: volumePressure.directionalAggressiveVolume,
                op: "EQL", // Check: directionalAggressive >= this.enhancementConfig.minAggVolume
            },
            passiveAbsorptionThreshold: {
                threshold: dynamicPassiveThreshold,
                calculated: passiveVolumeRatio,
                op: "EQL", // Check: passiveVolumeRatio >= this.enhancementConfig.passiveAbsorptionThreshold
            },
            priceEfficiencyThreshold: {
                threshold: this.settings.priceEfficiencyThreshold,
                calculated: priceEfficiency,
                op: "EQS", // Check: priceEfficiency <= threshold
            },
            maxPriceImpactRatio: {
                threshold: this.settings.maxPriceImpactRatio,
                calculated: priceImpactRatio ?? Number.MAX_SAFE_INTEGER,
                op: "EQS", // Check: priceImpactRatio <= threshold
            },
            minPassiveMultiplier: {
                threshold: this.settings.minPassiveMultiplier,
                calculated: actualPassiveMultiplier,
                op: "EQL", // Check: actualPassiveMultiplier >= threshold
            },
            maxVolumeMultiplierRatio: {
                threshold: this.settings.maxVolumeMultiplierRatio,
                calculated: volumeMultiplierRatio,
                op: "EQS", // Check: volumeMultiplierRatio <= threshold (detect exhaustion)
            },
            balanceThreshold: {
                threshold: this.settings.balanceThreshold,
                calculated: balancedFlow ?? -1,
                op: "EQS", // Used for balance detection, specific check logic
            },
            priceStabilityTicks: {
                threshold: this.settings.priceStabilityTicks,
                calculated: priceMovementTicks,
                op: "EQS", // Used for stability analysis, not directly checked
            },
            phaseContext: event.phaseContext,
        };

        // Update current price for signal validation
        this.validationLogger.updateCurrentPrice(event.price);

        // MANDATORY: Calculate traditional indicators for ALL signals (pass or reject)
        // Absorption signals are reversal signals - large orders absorbed at key levels
        const traditionalIndicatorResult =
            this.traditionalIndicators.validateSignal(
                event.price,
                (dominantSide ?? event.buyerIsMaker) ? "sell" : "buy",
                "absorption_reversal" // Absorption detects reversals through order flow absorption
            );

        if (
            isCoreAbosrption &&
            traditionalIndicatorResult.overallDecision !== "filter"
        ) {
            // Core Absorption: return a Signal Candidate
            // Create Signal Enhancements (Track signal quality indicators)
            const confluenceResult = this.analyzeZoneConfluence(
                event.zoneData,
                event.price
            );
            const hasZoneConfluence = confluenceResult.hasConfluence;

            const crossTimeframeResult = this.analyzeCrossTimeframeAbsorption(
                event.zoneData,
                event
            );
            const hasCrossTimeframe = crossTimeframeResult.hasAlignment;

            // Determine if any enhancements/quality flags were detected
            const enhancementApplied = hasZoneConfluence || hasCrossTimeframe;

            if (enhancementApplied) {
                // Update enhancement statistics
                this.enhancementStats.enhancementCount++;
                this.enhancementStats.enhancementSuccessRate =
                    this.enhancementStats.enhancementCount /
                    this.enhancementStats.callCount;
            }

            // Signal passes all thresholds AND traditional indicators

            // Create signal candidate with correct interface structure
            const signalCandidate: SignalCandidate = {
                id: `absorption-${this.getId()}-${event.timestamp}`,
                type: "absorption" as SignalType,
                side: dominantSide, // Follow institutional flow direction
                traditionalIndicators: {
                    vwap: traditionalIndicatorResult.vwap.value,
                    rsi: traditionalIndicatorResult.rsi.value,
                    oir: traditionalIndicatorResult.oir.value,
                    decision: traditionalIndicatorResult.overallDecision,
                    filtersTriggered:
                        traditionalIndicatorResult.filtersTriggered,
                },
                timestamp: event.timestamp,
                confidence: 1, //todo
                data: {
                    price: event.price,
                    zone:
                        relevantZones.length > 0 && relevantZones[0]
                            ? relevantZones[0].priceLevel
                            : event.price,
                    side: dominantSide,
                    aggressive: volumePressure.directionalAggressiveVolume,
                    passive: volumePressure.directionalPassiveVolume,
                    refilled: false, // Will be determined later
                    passiveVolumeRatio: passiveVolumeRatio, // Use the meaningful metric instead
                    passiveMultiplier: actualPassiveMultiplier,
                    priceEfficiency,
                    confidence: passiveVolumeRatio,
                    spreadImpact:
                        event.bestAsk !== undefined &&
                        event.bestBid !== undefined
                            ? FinancialMath.calculateSpread(
                                  event.bestAsk,
                                  event.bestBid,
                                  2
                              )
                            : 0,
                    volumeProfile: {
                        totalVolume: volumePressure.totalDirectionalVolume,
                        institutionalRatio: volumePressure.pressureRatio,
                    },
                    metadata: {
                        signalType: "absorption",
                        timestamp: event.timestamp,
                        institutionalRatio: volumePressure.pressureRatio,
                        enhancementType: "standalone_enhanced",
                        qualityMetrics: {
                            absorptionStatisticalSignificance:
                                passiveVolumeRatio,
                            institutionalConfirmation: true,
                            signalPurity: "premium",
                        },
                    },
                },
                qualityFlags: {
                    crossTimeframe: hasCrossTimeframe,
                    zoneConfluence: hasZoneConfluence,
                    priceEfficiency: true, // is a threshold
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
            // No Absorption
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
            } else if (!passesThreshold_passiveAbsorptionThreshold) {
                rejectionReason = "passive_volume_ratio_too_low";
                thresholdType = "passive_volume_ratio";
                thresholdValue = dynamicPassiveThreshold;
                actualValue = passiveVolumeRatio;
            } else if (!passesThreshold_priceEfficiencyThreshold) {
                rejectionReason = "price_efficiency_too_high";
                thresholdType = "price_efficiency";
                thresholdValue = this.settings.priceEfficiencyThreshold;
                actualValue = priceEfficiency;
            } else if (!passesThreshold_maxPriceImpactRatio) {
                rejectionReason = "price_impact_ratio_too_high";
                thresholdType = "price_impact_ratio";
                thresholdValue = this.settings.maxPriceImpactRatio;
                actualValue = priceImpactRatio ?? Number.MAX_SAFE_INTEGER;
            } else if (!passesThreshold_minPassiveMultiplier) {
                rejectionReason = "passive_multiplier_too_low";
                thresholdType = "passive_multiplier";
                thresholdValue = this.settings.minPassiveMultiplier;
                actualValue = actualPassiveMultiplier;
            } else if (!passesThreshold_maxVolumeMultiplierRatio) {
                rejectionReason = "volume_multiplier_ratio_too_high";
                thresholdType = "volume_multiplier_ratio";
                thresholdValue = this.settings.maxVolumeMultiplierRatio;
                actualValue = volumeMultiplierRatio;
            } else if (!passesThreshold_balanceThreshold) {
                rejectionReason = "balanced_institutional_flow";
                thresholdType = "institutional_balance";
                thresholdValue = this.settings.balanceThreshold;
                actualValue = 0;
            } else if (!passesThreshold_priceStabilityTicks) {
                rejectionReason = "price_stability_score_too_high";
                thresholdType = "price_stability_threshold";
                thresholdValue = this.settings.priceStabilityTicks;
                actualValue = priceMovementTicks;
            } else if (!dominantSide) {
                rejectionReason = "no_dominant_side";
                thresholdType = "side_determination";
                thresholdValue = 1;
                actualValue = 0;
            }

            // Log the rejection
            this.validationLogger.logRejection(
                "absorption",
                rejectionReason,
                event,
                {
                    type: thresholdType,
                    threshold: thresholdValue,
                    actual: actualValue,
                },
                thresholdChecks,
                (dominantSide ?? event.buyerIsMaker) ? "sell" : "buy",
                traditionalIndicatorResult
            );
            return null;
        }
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
        const hasAlignment =
            alignmentScore >= this.settings.passiveAbsorptionThreshold; // Require strong alignment for absorption

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
            Config.UNIVERSAL_ZONE_CONFIG.maxZoneConfluenceDistance
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

            // Use passive ratio directly instead of redundant absorptionScore calculation
            totalAbsorptionScore = FinancialMath.safeAdd(
                totalAbsorptionScore,
                passiveRatio
            );
        }

        return FinancialMath.divideQuantities(
            totalAbsorptionScore,
            relevantZones.length
        );
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
        const minConfluenceZones =
            Config.UNIVERSAL_ZONE_CONFIG.minZoneConfluenceCount;
        const maxDistance =
            Config.UNIVERSAL_ZONE_CONFIG.maxZoneConfluenceDistance;

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

        if (hasConfluence) this.enhancementStats.confluenceDetectionCount++;

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
     * Log successful signal parameters for 90-minute optimization
     */
    private logSuccessfulSignalParameters(
        signal: SignalCandidate,
        event: EnrichedTradeEvent,
        thresholdChecks: AbsorptionThresholdChecks,
        traditionalIndicatorResult: TraditionalIndicatorValues
    ): void {
        try {
            // Collect ACTUAL VALUES that each parameter was checked against when signal passed

            // Calculate the same values used in rejection logging

            this.validationLogger.logSuccessfulSignal(
                "absorption",
                event,
                thresholdChecks,
                signal.side,
                traditionalIndicatorResult
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
     * Log signal for validation tracking
     */
    private logSignalForValidation(
        signal: SignalCandidate,
        event: EnrichedTradeEvent,
        thresholdChecks: AbsorptionThresholdChecks,
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
                "AbsorptionDetectorEnhanced: Failed to log signal for validation",
                {
                    signalId: signal.id,
                    error:
                        error instanceof Error ? error.message : String(error),
                }
            );
        }
    }

    // Calculate the Balance between both sides and maker and taker volume
    private calculateBalancedFlow(
        relevantZones: ZoneSnapshot[]
    ): number | null {
        let totalAggressiveBuy = 0;
        let totalAggressiveSell = 0;
        let totalPassiveBuy = 0;
        let totalPassiveSell = 0;

        for (const zone of relevantZones) {
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

        return Math.max(aggressiveBalance, passiveBalance);
    }

    /**
     * Calculate price efficiency using FinancialMath (institutional compliance)
     */
    private calculatePriceEfficiency(
        event: EnrichedTradeEvent,
        relevantZones: ZoneSnapshot[]
    ): number {
        // Calculate volume-weighted average price using FinancialMath
        let totalVolumeWeightedPrice = 0;
        let totalVolume = 0;

        for (const zone of relevantZones) {
            // CRITICAL: Check for both null and undefined, and skip zones with invalid data
            if (
                zone.volumeWeightedPrice == null ||
                !FinancialMath.isValidFinancialNumber(zone.volumeWeightedPrice)
            )
                continue;
            if (
                zone.aggressiveVolume == null ||
                !FinancialMath.isValidFinancialNumber(zone.aggressiveVolume)
            )
                continue;

            const zoneWeight = FinancialMath.multiplyQuantities(
                zone.volumeWeightedPrice,
                zone.aggressiveVolume
            );

            // Skip zones where calculation fails
            if (!FinancialMath.isValidFinancialNumber(zoneWeight)) continue;

            totalVolumeWeightedPrice = FinancialMath.safeAdd(
                totalVolumeWeightedPrice,
                zoneWeight
            );
            totalVolume = FinancialMath.safeAdd(
                totalVolume,
                zone.aggressiveVolume
            );
        }

        if (totalVolume === 0) return 0;

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
     * Calculate price impact ratio - measures how much price moved relative to expected movement
     * Lower values indicate better absorption (less price movement despite volume)
     */
    private calculatePriceImpactRatio(
        event: EnrichedTradeEvent,
        pressureRatio: number
    ): number | null {
        const expectedMovement = FinancialMath.multiplyQuantities(
            event.quantity,
            this.settings.expectedMovementScalingFactor
        );

        if (expectedMovement === 0) return null;

        // Calculate price impact from best bid
        if (event.bestBid === undefined) return null; // Cannot calculate without bid price
        const actualImpact = FinancialMath.calculateAbs(
            FinancialMath.safeSubtract(event.price, event.bestBid)
        );

        // Factor in volume pressure for adjusted impact
        const pressureAdjustedImpact = FinancialMath.multiplyQuantities(
            actualImpact,
            pressureRatio
        );

        return FinancialMath.divideQuantities(
            pressureAdjustedImpact,
            expectedMovement
        );
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
        const windowStartTime = event.timestamp - this.windowMs;
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

        return relevantZones;
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
        const pressureRatio = FinancialMath.divideQuantities(
            directionalAggressiveVolume,
            directionalPassiveVolume
        );
        const totalDirectionalVolume = FinancialMath.safeAdd(
            directionalAggressiveVolume,
            directionalPassiveVolume
        );

        return {
            directionalAggressiveVolume,
            directionalPassiveVolume,
            totalDirectionalVolume,
            pressureRatio,
        };
    }

    /**
     * Calculate dominant side based on directional passive volume absorption
     * CRITICAL: Determines signal direction based on institutional flow
     * FIXED: Now uses same directional logic as calculateVolumePressure
     */
    private calculateDominantSide(
        relevantPassiveVolume: number,
        buyerIsMaker: boolean
    ): "buy" | "sell" | null {
        // Corrected Reversal Logic for Absorption:
        // - If aggressive BUYING is absorbed by passive sellers, it's a bearish signal (SELL).
        // - If aggressive SELLING is absorbed by passive buyers, it's a bullish signal (BUY).
        if (relevantPassiveVolume > 0) {
            // The trade direction is being absorbed; the signal should be for a reversal.
            const signalSide = buyerIsMaker ? "buy" : "sell"; // If seller is maker (buy trade), signal sell. If buyer is maker (sell trade), signal buy.
            this.logger.info(
                `AbsorptionDetectorEnhanced: Returning ${signalSide.toUpperCase()} reversal signal`,
                {
                    relevantPassiveVolume,
                    absorbedTradeDirection: buyerIsMaker ? "SELL" : "BUY",
                    signalSide,
                }
            );
            return signalSide;
        }
        return null; // No directional absorption detected.
    }

    // Update zone tracker with current market data
    private updateZoneTracker(event: EnrichedTradeEvent): void {
        // Update spread if available
        if (event.bestBid && event.bestAsk) {
            this.zoneTracker.updateSpread(event.bestBid, event.bestAsk);
        }

        // Update price history for stability tracking
        this.zoneTracker.updatePrice(event.price, event.timestamp);

        // Update zones in tracker
        for (const zone of event.zoneData.zones) {
            this.zoneTracker.updateZone(zone, event.timestamp);
        }
    }

    // Initialize enhancement statistics
    private initEnhancementStats(): AbsorptionEnhancementStats {
        return {
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
    }
}
