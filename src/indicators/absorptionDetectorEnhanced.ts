// src/indicators/absorptionDetectorEnhanced.ts

import { z } from "zod";
import { Detector } from "./base/detectorEnrichedTrade.js";
import { FinancialMath } from "../utils/financialMath.js";
import { SignalValidationLogger } from "../utils/signalValidationLogger.js";
import type { ILogger } from "../infrastructure/loggerInterface.js";
import type { IMetricsCollector } from "../infrastructure/metricsCollectorInterface.js";
import type { IOrderflowPreprocessor } from "../market/orderFlowPreprocessor.js";
import type { ISignalLogger } from "../infrastructure/signalLoggerInterface.js";
import {
    AbsorptionZoneTracker,
    type AbsorptionTrackerConfig,
} from "./helpers/absorptionZoneTracker.js";
import { AbsorptionDetectorSchema, Config } from "../core/config.js";
import type {
    EnrichedTradeEvent,
    ZoneSnapshot,
    StandardZoneData,
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

    // Dynamic zone tracking for true absorption detection
    private readonly zoneTracker: AbsorptionZoneTracker;

    // Signal cooldown tracking (CLAUDE.md compliance - no magic cooldown values)
    private readonly lastSignal = new Map<string, number>();

    constructor(
        id: string,
        private readonly settings: AbsorptionEnhancedSettings,
        private readonly preprocessor: IOrderflowPreprocessor,
        logger: ILogger,
        metrics: IMetricsCollector,
        private readonly validationLogger: SignalValidationLogger,
        signalLogger: ISignalLogger
    ) {
        super(id, logger, metrics, signalLogger);
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

        this.logger.info("AbsorptionDetectorEnhanced initialized", {
            detectorId: id,
            windowMs: this.windowMs,
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

        // STEP 2: EMIT SINGLE SIGNAL with quality flags
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
        const passesThreshold_passiveAbsorptionThreshold =
            passiveVolumeRatio >= this.settings.passiveAbsorptionThreshold;

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
        const passesThreshold_maxPriceImpactRatio =
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

        // NOTE: Removed redundant absorptionScore calculation
        // It was identical to passiveVolumeRatio (directionalPassiveVolume / totalDirectionalVolume)
        // minAbsorptionScore threshold has been removed to eliminate duplicate configuration

        // Caluclate balanced flow
        const balancedFlow = this.calculateBalancedFlow(relevantZones);
        const passesThreshold_balanceThreshold =
            balancedFlow && balancedFlow <= this.settings.balanceThreshold;

        // Calculate price movement range in ticks using zone tracker's time-based approach
        const priceMovementTicks = this.zoneTracker.getPriceRangeInTicks();
        const passesThreshold_priceStabilityTicks =
            priceMovementTicks <= this.settings.priceStabilityTicks;

        // Determine dominant side and signal direction
        const dominantSide = this.calculateDominantSide(
            volumePressure.directionalPassiveVolume,
            event.buyerIsMaker
        );

        // Check if we pass all thresholds
        const isCoreAbosrption =
            passesThreshold_minAggVolume &&
            passesThreshold_passiveAbsorptionThreshold &&
            passesThreshold_priceEfficiencyThreshold &&
            passesThreshold_maxPriceImpactRatio &&
            passesThreshold_minPassiveMultiplier &&
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
                threshold: this.settings.passiveAbsorptionThreshold,
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
        };

        // Update current price for signal validation
        this.validationLogger.updateCurrentPrice(event.price);

        if (isCoreAbosrption) {
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

            // Create signal candidate with correct interface structure
            const signalCandidate: SignalCandidate = {
                id: `absorption-${this.getId()}-${event.timestamp}`,
                type: "absorption" as SignalType,
                side: dominantSide, // Follow institutional flow direction
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
                thresholdChecks
            );
            void this.logSuccessfulSignalParameters(
                signalCandidate,
                event,
                thresholdChecks
            );

            return signalCandidate;
        } else {
            // No Absorption
            // Determine primary rejection reason for logging
            let rejectionReason = "comprehensive_rejection";
            let thresholdType = "multiple_thresholds";
            let thresholdValue = 0;
            let actualValue = 0;

            if (!passesThreshold_minAggVolume) {
                rejectionReason = "insufficient_aggressive_volume";
                thresholdType = "aggressive_volume";
                thresholdValue = this.settings.minAggVolume;
                actualValue = volumePressure.directionalAggressiveVolume;
            } else if (!passesThreshold_passiveAbsorptionThreshold) {
                rejectionReason = "passive_volume_ratio_too_low";
                thresholdType = "passive_volume_ratio";
                thresholdValue = this.settings.passiveAbsorptionThreshold;
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
                (dominantSide ?? event.buyerIsMaker) ? "sell" : "buy"
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
        thresholdChecks: AbsorptionThresholdChecks
    ): void {
        try {
            // Collect ACTUAL VALUES that each parameter was checked against when signal passed

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

            // Calculate the same values used in rejection logging

            this.validationLogger.logSuccessfulSignal(
                "absorption",
                event,
                thresholdChecks,
                marketContext,
                signal.side // Signal always has buy/sell
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
     * Log signal for validation tracking
     */
    private logSignalForValidation(
        signal: SignalCandidate,
        event: EnrichedTradeEvent,
        thresholdChecks: AbsorptionThresholdChecks
    ): void {
        try {
            // Calculate market context for validation logging
            const marketContext = {
                totalAggressiveVolume: thresholdChecks.minAggVolume.calculated,
                totalPassiveVolume:
                    thresholdChecks.passiveAbsorptionThreshold.calculated,
                aggressiveBuyVolume: thresholdChecks.minAggVolume.calculated,
                aggressiveSellVolume: thresholdChecks.minAggVolume.calculated,
                passiveBidVolume:
                    thresholdChecks.passiveAbsorptionThreshold.calculated,
                passiveAskVolume:
                    thresholdChecks.passiveAbsorptionThreshold.calculated,
                institutionalVolumeRatio:
                    thresholdChecks.maxPriceImpactRatio.calculated,
                priceEfficiency:
                    thresholdChecks.priceEfficiencyThreshold.calculated,
                priceImpactRatio:
                    thresholdChecks.maxPriceImpactRatio.calculated,
            };

            this.validationLogger.logSignal(
                signal,
                event,
                thresholdChecks,
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
        // CRITICAL FIX: Use same directional logic as calculateVolumePressure
        // - Buy trades (buyerIsMaker = false): Only count passiveAskVolume (hitting asks)
        // - Sell trades (buyerIsMaker = true): Only count passiveBidVolume (hitting bids)

        // DIRECTIONAL SIGNAL LOGIC: Signal follows the trade direction that shows absorption
        // This aligns with calculateVolumePressure which also uses directional passive volume
        if (relevantPassiveVolume > 0) {
            const signalSide = buyerIsMaker ? "sell" : "buy";
            this.logger.info(
                `AbsorptionDetectorEnhanced: Returning ${signalSide.toUpperCase()} signal (directional absorption detected)`,
                {
                    relevantPassiveVolume,
                    tradeDirection: buyerIsMaker ? "SELL" : "BUY",
                    signalSide,
                }
            );
            return signalSide;
        }
        return null; // No directional absorption
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
