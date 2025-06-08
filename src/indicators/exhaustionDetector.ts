// src/indicators/exhaustionDetector.ts
import { BaseDetector, ZoneSample } from "./base/baseDetector.js";
import { Logger } from "../infrastructure/logger.js";
import { MetricsCollector } from "../infrastructure/metricsCollector.js";
import { ISignalLogger } from "../services/signalLogger.js";
import { RollingWindow } from "../utils/rollingWindow.js";
import { DetectorUtils } from "./base/detectorUtils.js";
import { SpoofingDetector } from "../services/spoofingDetector.js";
import { SharedPools } from "../utils/objectPool.js";

import type {
    EnrichedTradeEvent,
    AggressiveTrade,
} from "../types/marketEvents.js";
import type {
    IExhaustionDetector,
    DetectorCallback,
    BaseDetectorSettings,
    ExhaustionFeatures,
} from "./interfaces/detectorInterfaces.js";
import { SignalType, ExhaustionSignalData } from "../types/signalTypes.js";

export interface ExhaustionSettings extends BaseDetectorSettings {
    features?: ExhaustionFeatures;
    // Exhaustion-specific settings
    exhaustionThreshold?: number; // Minimum exhaustion score (0-1)
    maxPassiveRatio?: number; // Max ratio of current/avg passive for exhaustion
    minDepletionFactor?: number; // Min factor for passive depletion detection
}

type DetectorResult<T> =
    | { success: true; data: T }
    | { success: false; error: Error; fallbackSafe: boolean };

/**
 * Conditions analyzed for exhaustion detection
 */
interface ExhaustionConditions {
    aggressiveVolume: number;
    currentPassive: number;
    avgPassive: number;
    minPassive: number;
    avgLiquidity: number;
    passiveRatio: number; // current/avg passive
    depletionRatio: number; // aggressive/avg passive
    refillGap: number; // change in passive over window
    imbalance: number; // bid/ask imbalance
    spread: number; // current spread ratio
    passiveVelocity: number; // rate of passive change
    sampleCount: number; // number of samples used
    isValid: boolean;
    confidence: number; // 0-1 confidence in the data
    dataQuality: "high" | "medium" | "low" | "insufficient";
}

/**
 * Exhaustion detector – identifies when one side of the orderbook is depleted.
 * Production-ready with enhanced error handling, metrics, and configuration.
 */
export class ExhaustionDetector
    extends BaseDetector
    implements IExhaustionDetector
{
    protected readonly detectorType = "exhaustion" as const;
    protected readonly features: ExhaustionFeatures;

    // Add circuit breaker state
    private errorCount = 0;
    private lastErrorTime = 0;
    private readonly maxErrors = 5;
    private readonly errorWindowMs = 60000; // 1 minute
    private isCircuitOpen = false;

    // Exhaustion-specific configuration
    private readonly exhaustionThreshold: number;
    private readonly maxPassiveRatio: number;
    private readonly minDepletionFactor: number;

    constructor(
        id: string,
        callback: DetectorCallback,
        settings: ExhaustionSettings = {},
        logger: Logger,
        spoofingDetector: SpoofingDetector,
        metricsCollector: MetricsCollector,
        signalLogger?: ISignalLogger
    ) {
        super(
            id,
            callback,
            settings,
            logger,
            spoofingDetector,
            metricsCollector,
            signalLogger
        );

        // Initialize exhaustion-specific settings
        this.exhaustionThreshold = settings.exhaustionThreshold ?? 0.7;
        this.maxPassiveRatio = settings.maxPassiveRatio ?? 0.3;
        this.minDepletionFactor = settings.minDepletionFactor ?? 0.5;

        // Merge exhaustion-specific features
        this.features = {
            depletionTracking: true,
            spreadAdjustment: true,
            volumeVelocity: false,
            ...settings.features,
        };
    }

    protected getSignalType(): SignalType {
        return "exhaustion";
    }

    /* ------------------------------------------------------------------ */
    /*  Incoming enriched trade                                           */
    /* ------------------------------------------------------------------ */
    public onEnrichedTrade(event: EnrichedTradeEvent): void {
        const zone = this.calculateZone(event.price);

        // create window if absent
        if (!this.zonePassiveHistory.has(zone)) {
            this.zonePassiveHistory.set(
                zone,
                new RollingWindow<ZoneSample>(100, false)
            );
        }
        const zoneHistory = this.zonePassiveHistory.get(zone)!;

        // duplicate-snapshot guard
        const lastSnap =
            zoneHistory.count() > 0 ? zoneHistory.toArray().at(-1)! : null;

        // Use object pool to reduce GC pressure
        const snap = SharedPools.getInstance().zoneSamples.acquire();
        snap.bid = event.zonePassiveBidVolume;
        snap.ask = event.zonePassiveAskVolume;
        snap.total = event.zonePassiveBidVolume + event.zonePassiveAskVolume;
        snap.timestamp = event.timestamp;

        if (
            !lastSnap ||
            lastSnap.bid !== snap.bid ||
            lastSnap.ask !== snap.ask
        ) {
            // Use pool-aware push to handle evicted objects
            this.pushToZoneHistoryWithPoolCleanup(zoneHistory, snap);
        } else {
            // Release snapshot back to pool if not used
            SharedPools.getInstance().zoneSamples.release(snap);
        }

        // add trade exactly once
        if (this.lastTradeId !== event.tradeId) {
            this.lastTradeId = event.tradeId;
            this.addTrade(event); // EnrichedTradeEvent extends AggressiveTrade
        }
    }

    /**
     * Exhaustion-specific trade handling (called by base class)
     */
    protected onEnrichedTradeSpecific(event: EnrichedTradeEvent): void {
        void event;
    }

    /**
     * Main detection loop for exhaustion patterns
     */
    protected checkForSignal(triggerTrade: AggressiveTrade): void {
        const now = Date.now();
        const zoneTicks = this.getEffectiveZoneTicks();

        try {
            // Get recent trades within window
            const recentTrades = this.trades.filter(
                (t) => now - t.timestamp < this.windowMs
            );

            if (recentTrades.length === 0) {
                return;
            }

            // Group trades by zones for analysis
            const zoneMap = this.groupTradesByZone(recentTrades, zoneTicks);

            // Analyze each zone for exhaustion patterns
            for (const [zone, tradesAtZone] of zoneMap) {
                if (tradesAtZone.length === 0) continue;

                this.analyzeZoneForExhaustion(
                    zone,
                    tradesAtZone,
                    triggerTrade,
                    zoneTicks
                );
            }

            // Record detection attempt metrics
            this.metricsCollector.incrementMetric(
                "exhaustionDetectionAttempts"
            );
            //this.metricsCollector.recordGauge('exhaustion.zones.analyzed', zoneMap.size);
        } catch (error) {
            this.handleError(
                error as Error,
                "ExhaustionDetector.checkForSignal"
            );
            this.metricsCollector.incrementMetric("exhaustionDetectionErrors");
        }
    }

    /**
     * Analyze a specific zone for exhaustion patterns
     */
    private analyzeZoneForExhaustion(
        zone: number,
        tradesAtZone: AggressiveTrade[],
        triggerTrade: AggressiveTrade,
        zoneTicks: number
    ): void {
        const latestTrade = tradesAtZone[tradesAtZone.length - 1];
        const price = +latestTrade.price.toFixed(this.pricePrecision);
        const side = this.getTradeSide(latestTrade);

        // Get current book level
        const bookLevel = this.depth.get(price);
        if (!bookLevel) {
            this.logger.debug(
                `[ExhaustionDetector] No book data for price ${price}`
            );
            return;
        }

        // Check cooldown to prevent spam (update after confirmation)
        if (!this.checkCooldown(zone, side, false)) {
            return;
        }

        // Analyze exhaustion conditions
        //const conditions = this.analyzeExhaustionConditions(price, side, zone);
        //const score = this.calculateExhaustionScore(conditions);
        const conditionsResult = this.analyzeExhaustionConditionsSafe(
            price,
            side,
            zone
        );

        // Check if score meets threshold
        //if (score < this.exhaustionThreshold) {
        //    return;
        //}

        if (!conditionsResult.success) {
            // Handle error appropriately based on type
            if (conditionsResult.fallbackSafe) {
                // Safe to continue - just skip this signal
                this.logger.debug(
                    `[ExhaustionDetector] Skipping analysis: ${conditionsResult.error.message}`
                );
                return;
            } else {
                // Critical error - pause detector temporarily
                this.pauseDetectorTemporarily(conditionsResult.error);
                return;
            }
        }

        const conditions = conditionsResult.data;

        // Only proceed if data quality is acceptable
        if (
            conditions.dataQuality === "insufficient" ||
            conditions.confidence < 0.3
        ) {
            this.logger.debug(`[ExhaustionDetector] Data quality too low`, {
                quality: conditions.dataQuality,
                confidence: conditions.confidence,
            });
            return;
        }

        // Calculate score with confidence adjustment
        const baseScore = this.calculateExhaustionScore(conditions);
        const adjustedScore = baseScore * conditions.confidence;

        // Apply stricter threshold for low-quality data
        const effectiveThreshold =
            conditions.dataQuality === "low"
                ? this.exhaustionThreshold * 1.2
                : this.exhaustionThreshold;

        if (adjustedScore < effectiveThreshold) {
            return;
        }

        // Calculate zone volumes
        const volumes = this.calculateZoneVolumes(
            zone,
            tradesAtZone,
            zoneTicks
        );

        // Skip if insufficient volume
        if (volumes.aggressive < this.minAggVolume) {
            this.logger.debug(`[ExhaustionDetector] Insufficient volume`, {
                aggressive: volumes.aggressive,
                required: this.minAggVolume,
            });
            return;
        }

        // Check for spoofing if enabled (includes layering detection)
        if (
            this.features.spoofingDetection &&
            (this.isSpoofed(price, side, triggerTrade.timestamp) ||
                this.detectLayeringAttack(price, side, triggerTrade.timestamp))
        ) {
            this.logger.debug(
                `[ExhaustionDetector] Signal rejected - spoofing detected`
            );
            this.metricsCollector.incrementMetric("exhaustionSpoofingRejected");
            return;
        }

        // Check for refill
        const oppositeQty = side === "buy" ? bookLevel.ask : bookLevel.bid;
        const refilled = this.checkRefill(price, side, oppositeQty);

        if (refilled) {
            this.logger.debug(
                `[ExhaustionDetector] Signal rejected - refill detected`
            );
            this.metricsCollector.incrementMetric("exhaustionRefillRejected");
            return;
        }

        const signal: ExhaustionSignalData = {
            price,
            side,
            aggressive: volumes.aggressive,
            oppositeQty,
            avgLiquidity: conditions.avgLiquidity,
            spread: conditions.spread,
            confidence: adjustedScore,
            meta: {
                conditions,
                detectorVersion: "2.1-safe",
                dataQuality: conditions.dataQuality,
                originalConfidence: baseScore,
            },
        };

        this.handleDetection(signal);

        this.metricsCollector.updateMetric(
            `detector_${this.detectorType}Aggressive_volume`,
            signal.aggressive
        );
        this.metricsCollector.incrementMetric("exhaustionSignalsGenerated");
        this.metricsCollector.recordHistogram(
            "exhaustion.score",
            adjustedScore
        );
    }

    /**
     * Validate input parameters
     */
    private validateInputs(
        price: number,
        side: "buy" | "sell",
        zone: number
    ): boolean {
        if (!isFinite(price) || price <= 0) return false;
        if (side !== "buy" && side !== "sell") return false;
        if (!isFinite(zone)) return false;
        return true;
    }

    /**
     * Get and validate historical data
     */
    private getValidatedHistoricalData(
        price: number,
        side: "buy" | "sell",
        zone: number
    ): DetectorResult<{
        avgLiquidity: number;
        spreadInfo: { spread: number } | null;
        recentAggressive: number;
        samples: ZoneSample[];
    }> {
        try {
            const avgLiquidity =
                this.passiveVolumeTracker.getAveragePassiveBySide(
                    price,
                    side === "buy" ? "sell" : "buy",
                    this.windowMs
                );

            if (!isFinite(avgLiquidity) || avgLiquidity < 0) {
                return {
                    success: false,
                    error: new Error("Invalid average liquidity data"),
                    fallbackSafe: true,
                };
            }

            const spreadInfo = this.getCurrentSpread();
            const recentAggressive = this.getAggressiveVolumeAtPrice(
                price,
                5000
            );

            if (!isFinite(recentAggressive) || recentAggressive < 0) {
                return {
                    success: false,
                    error: new Error("Invalid aggressive volume data"),
                    fallbackSafe: true,
                };
            }

            // Get zone passive history
            const zoneHistory = this.zonePassiveHistory.get(zone);
            const now = Date.now();
            const samples = zoneHistory
                ? zoneHistory
                      .toArray()
                      .filter((s) => now - s.timestamp < this.windowMs)
                      .filter((s) => this.isValidSample(s))
                : [];

            return {
                success: true,
                data: { avgLiquidity, spreadInfo, recentAggressive, samples },
            };
        } catch (error) {
            return {
                success: false,
                error: error as Error,
                fallbackSafe: false,
            };
        }
    }

    /**
     * Assess data quality for decision making
     */
    private assessDataQuality(
        samples: ZoneSample[],
        avgLiquidity: number,
        recentAggressive: number
    ): "high" | "medium" | "low" | "insufficient" {
        if (samples.length < 2) return "insufficient";
        if (avgLiquidity === 0 && recentAggressive === 0) return "insufficient";

        const dataAge = Date.now() - samples[0].timestamp;
        const sampleCount = samples.length;

        if (sampleCount >= 10 && dataAge < 30000) return "high";
        if (sampleCount >= 5 && dataAge < 60000) return "medium";
        if (sampleCount >= 2) return "low";

        return "insufficient";
    }

    /**
     * Calculate confidence in the data
     */
    private calculateDataConfidence(
        samples: ZoneSample[],
        quality: "high" | "medium" | "low" | "insufficient",
        avgLiquidity: number
    ): number {
        let confidence = 0;

        // Base confidence from data quality
        switch (quality) {
            case "high":
                confidence = 0.9;
                break;
            case "medium":
                confidence = 0.7;
                break;
            case "low":
                confidence = 0.5;
                break;
            case "insufficient":
                confidence = 0.2;
                break;
        }

        // Adjust for sample consistency
        if (samples.length > 1) {
            const variance = this.calculateVariance(
                samples.map((s) => s.total)
            );
            const consistency = Math.exp(-variance / (avgLiquidity || 1));
            confidence *= consistency;
        }

        // Adjust for data freshness
        if (samples.length > 0) {
            const latestAge = Date.now() - samples.at(-1)!.timestamp;
            const freshness = Math.exp(-latestAge / 30000); // Decay over 30 seconds
            confidence *= freshness;
        }

        return Math.max(0, Math.min(1, confidence));
    }

    /**
     * Safe ratio calculation with bounds checking
     */
    private calculateSafeRatio(
        numerator: number,
        denominator: number,
        defaultValue = 0
    ): number {
        if (!isFinite(numerator) || !isFinite(denominator)) return defaultValue;
        if (denominator === 0) return defaultValue;

        const ratio = numerator / denominator;
        if (!isFinite(ratio)) return defaultValue;

        // Clamp to reasonable bounds
        return Math.max(0, Math.min(1000, ratio));
    }

    /**
     * Safe mean calculation
     */
    private calculateSafeMean(values: number[]): number {
        if (values.length === 0) return 0;

        const validValues = values.filter((v) => isFinite(v) && v >= 0);
        if (validValues.length === 0) return 0;

        return (
            validValues.reduce((sum, val) => sum + val, 0) / validValues.length
        );
    }

    /**
     * Safe velocity calculation
     */
    private calculateSafeVelocity(samples: ZoneSample[]): number {
        if (!this.features.volumeVelocity || samples.length < 2) return 0;

        try {
            const recent = samples.slice(-5);
            const velocities: number[] = [];

            for (let i = 1; i < recent.length; i++) {
                const deltaVol = recent[i].total - recent[i - 1].total;
                const deltaTime = recent[i].timestamp - recent[i - 1].timestamp;

                if (
                    deltaTime > 0 &&
                    isFinite(deltaVol) &&
                    isFinite(deltaTime)
                ) {
                    const velocity = deltaVol / (deltaTime / 1000);
                    if (isFinite(velocity)) {
                        velocities.push(velocity);
                    }
                }
            }

            return velocities.length > 0
                ? this.calculateSafeMean(velocities)
                : 0;
        } catch {
            return 0;
        }
    }

    /**
     * Safe imbalance check with Result pattern
     */
    private checkPassiveImbalanceSafe(
        zone: number
    ): DetectorResult<{ imbalance: number; dominantSide: string }> {
        try {
            const result = this.checkPassiveImbalance(zone);

            if (!isFinite(result.imbalance)) {
                return {
                    success: false,
                    error: new Error("Invalid imbalance calculation"),
                    fallbackSafe: true,
                };
            }

            return { success: true, data: result };
        } catch (error) {
            return {
                success: false,
                error: error as Error,
                fallbackSafe: true,
            };
        }
    }

    /**
     * Validate sample data
     */
    private isValidSample(sample: ZoneSample): boolean {
        return (
            isFinite(sample.bid) &&
            isFinite(sample.ask) &&
            isFinite(sample.total) &&
            isFinite(sample.timestamp) &&
            sample.bid >= 0 &&
            sample.ask >= 0 &&
            sample.timestamp > 0
        );
    }

    /**
     * Calculate variance for consistency check
     */
    private calculateVariance(values: number[]): number {
        if (values.length < 2) return 0;

        const mean = this.calculateSafeMean(values);
        const squaredDiffs = values.map((val) => Math.pow(val - mean, 2));
        return this.calculateSafeMean(squaredDiffs);
    }

    /**
     * Handle detector errors with circuit breaker
     */
    private handleDetectorError(error: Error): void {
        const now = Date.now();

        // Reset error count if outside window
        if (now - this.lastErrorTime > this.errorWindowMs) {
            this.errorCount = 0;
        }

        this.errorCount++;
        this.lastErrorTime = now;

        // Open circuit breaker if too many errors
        if (this.errorCount >= this.maxErrors) {
            this.isCircuitOpen = true;
            this.logger.error(
                `[ExhaustionDetector] Circuit breaker opened after ${this.errorCount} errors`
            );

            // Auto-reset circuit breaker after delay
            setTimeout(() => {
                this.isCircuitOpen = false;
                this.errorCount = 0;
                this.logger.info(`[ExhaustionDetector] Circuit breaker reset`);
            }, this.errorWindowMs);
        }

        this.handleError(error, `${this.constructor.name}.detectorError`);
    }

    /**
     * Temporarily pause detector on critical errors
     */
    private pauseDetectorTemporarily(error: Error): void {
        this.logger.error(
            `[ExhaustionDetector] Pausing detector due to critical error: ${error.message}`
        );

        // Emit status change event
        this.emitStatusChange("paused", "active");

        // Auto-resume after short delay
        setTimeout(() => {
            this.logger.info(
                `[ExhaustionDetector] Resuming detector operation`
            );
            this.emitStatusChange("active", "paused");
        }, 5000); // 5 second pause
    }

    private checkExhaustionConditions(
        price: number,
        side: "buy" | "sell"
    ): {
        ratio: number;
        passiveStrength: number;
        refillGap: number;
        imbalance: number;
        spread: number;
        recentAgg: number;
    } {
        const avgLiquidity = this.passiveVolumeTracker.getAveragePassiveBySide(
            price,
            side === "buy" ? "sell" : "buy",
            300000
        );

        const spreadInfo = this.getCurrentSpread();

        const recentAggressive = this.getAggressiveVolumeAtPrice(price, 5000);

        const zoneHist = this.zonePassiveHistory.get(this.calculateZone(price));
        const now = Date.now();
        const samples = zoneHist
            ? zoneHist
                  .toArray()
                  .filter((s) => now - s.timestamp < this.windowMs)
            : [];
        const rollingPassive = DetectorUtils.calculateMean(
            samples.map((s) => s.total)
        );

        /* imbalance  (|bid-ask| / total) */
        const imbalance = this.checkPassiveImbalance(
            this.calculateZone(price)
        ).imbalance;

        return {
            ratio: rollingPassive > 0 ? recentAggressive / rollingPassive : 1,
            passiveStrength:
                rollingPassive > 0 && avgLiquidity > 0
                    ? rollingPassive / avgLiquidity
                    : 0,
            refillGap: samples.length
                ? samples.at(-1)!.total - samples[0].total
                : 0,
            imbalance,
            spread: spreadInfo ? spreadInfo.spread : NaN,
            recentAgg: recentAggressive,
        };
    }

    /* ------------------------------------------------------------------ */
    /*  Confidence score (0-1)                                            */
    /* ------------------------------------------------------------------ */
    /**
     * Calculate exhaustion confidence score (0-1)
     */
    private calculateExhaustionScore(conditions: ExhaustionConditions): number {
        let score = 0;

        // Factor 1: Depletion ratio (aggressive vs passive)
        if (conditions.depletionRatio > 20)
            score += 0.35; // Very high depletion
        else if (conditions.depletionRatio > 10)
            score += 0.25; // High depletion
        else if (conditions.depletionRatio > 5) score += 0.15; // Moderate depletion

        // Factor 2: Passive strength relative to average
        if (conditions.passiveRatio < 0.2)
            score += 0.25; // Severely depleted
        else if (conditions.passiveRatio < 0.4)
            score += 0.15; // Moderately depleted
        else if (conditions.passiveRatio < 0.6) score += 0.1; // Somewhat depleted

        // Factor 3: Continuous depletion (negative refill gap)
        if (conditions.refillGap < -conditions.avgPassive * 0.5) score += 0.15;
        else if (conditions.refillGap < 0) score += 0.1;

        // Factor 4: Passive imbalance (one-sided depletion)
        if (conditions.imbalance > 0.8) score += 0.1;
        else if (conditions.imbalance > 0.6) score += 0.05;

        // Factor 5: Spread widening (sign of liquidity stress)
        if (this.features.spreadAdjustment) {
            if (conditions.spread > 0.005)
                score += 0.05; // 0.5%+ spread
            else if (conditions.spread > 0.002) score += 0.03; // 0.2%+ spread
        }

        // Factor 6: Passive velocity (accelerating depletion)
        if (this.features.volumeVelocity && conditions.passiveVelocity < -100) {
            score += 0.05; // Rapid depletion
        }

        // Penalty for insufficient data
        if (conditions.sampleCount < 5) {
            score *= 0.7; // Reduce confidence with limited data
        }

        return Math.max(0, Math.min(1, score));
    }

    /**
     * Safe analysis that returns Result type instead of dangerous defaults
     */
    private analyzeExhaustionConditionsSafe(
        price: number,
        side: "buy" | "sell",
        zone: number
    ): DetectorResult<ExhaustionConditions> {
        try {
            // Check circuit breaker
            if (this.isCircuitOpen) {
                return {
                    success: false,
                    error: new Error(
                        "Circuit breaker open - too many recent errors"
                    ),
                    fallbackSafe: true,
                };
            }

            // Validate inputs first
            if (!this.validateInputs(price, side, zone)) {
                return {
                    success: false,
                    error: new Error("Invalid input parameters"),
                    fallbackSafe: true,
                };
            }

            // Get historical data with validation
            const dataResult = this.getValidatedHistoricalData(
                price,
                side,
                zone
            );
            if (!dataResult.success) {
                return dataResult;
            }

            const { avgLiquidity, spreadInfo, recentAggressive, samples } =
                dataResult.data;

            // Validate data quality
            const quality = this.assessDataQuality(
                samples,
                avgLiquidity,
                recentAggressive
            );
            if (quality === "insufficient") {
                return {
                    success: false,
                    error: new Error("Insufficient data quality for analysis"),
                    fallbackSafe: true,
                };
            }

            // Calculate all metrics with bounds checking
            const currentPassive =
                samples.length > 0 ? samples.at(-1)!.total : 0;
            const avgPassive = this.calculateSafeMean(
                samples.map((s) => s.total)
            );
            const minPassive =
                samples.length > 0
                    ? Math.min(...samples.map((s) => s.total))
                    : 0;

            // Safe ratio calculations with bounds
            const passiveRatio = this.calculateSafeRatio(
                currentPassive,
                avgPassive
            );
            const depletionRatio = this.calculateSafeRatio(
                recentAggressive,
                avgPassive
            );

            // Calculate velocity with validation
            const passiveVelocity = this.calculateSafeVelocity(samples);

            // Check passive imbalance with error handling
            const imbalanceResult = this.checkPassiveImbalanceSafe(zone);
            const imbalance = imbalanceResult.success
                ? Math.abs(imbalanceResult.data.imbalance)
                : 0;

            // Calculate confidence based on data quality and completeness
            const confidence = this.calculateDataConfidence(
                samples,
                quality,
                avgLiquidity
            );

            const conditions: ExhaustionConditions = {
                aggressiveVolume: recentAggressive,
                currentPassive,
                avgPassive,
                minPassive,
                avgLiquidity,
                passiveRatio,
                depletionRatio,
                refillGap:
                    samples.length > 1
                        ? samples.at(-1)!.total - samples[0].total
                        : 0,
                imbalance,
                spread: spreadInfo?.spread ?? 0,
                passiveVelocity,
                sampleCount: samples.length,
                isValid: true,
                confidence,
                dataQuality: quality,
            };

            return { success: true, data: conditions };
        } catch (error) {
            this.handleDetectorError(error as Error);
            return {
                success: false,
                error: error as Error,
                fallbackSafe: false,
            };
        }
    }
}
