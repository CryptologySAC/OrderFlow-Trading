// src/indicators/exhaustionDetector.ts
import { randomUUID } from "crypto";
import { SpotWebsocketStreams } from "@binance/spot";
import { BaseDetector, ZoneSample } from "./base/baseDetector.js";
import { Logger } from "../infrastructure/logger.js";
import { MetricsCollector } from "../infrastructure/metricsCollector.js";
import { ISignalLogger } from "../services/signalLogger.js";
import { RollingWindow } from "../utils/rollingWindow.js";
import { DetectorUtils } from "./base/detectorUtils.js";

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
import type { PendingDetection } from "../utils/utils.js";

export interface ExhaustionSettings extends BaseDetectorSettings {
    features?: ExhaustionFeatures;
    // Exhaustion-specific settings
    exhaustionThreshold?: number; // Minimum exhaustion score (0-1)
    maxPassiveRatio?: number; // Max ratio of current/avg passive for exhaustion
    minDepletionFactor?: number; // Min factor for passive depletion detection
}

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

    // Exhaustion-specific configuration
    private readonly exhaustionThreshold: number;
    private readonly maxPassiveRatio: number;
    private readonly minDepletionFactor: number;

    constructor(
        callback: DetectorCallback,
        settings: ExhaustionSettings = {},
        logger: Logger,
        metricsCollector: MetricsCollector,
        signalLogger?: ISignalLogger
    ) {
        super(callback, settings, logger, metricsCollector, signalLogger);

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

        this.logger.info(
            `[ExhaustionDetector] Initialized with enhanced features`,
            {
                exhaustionThreshold: this.exhaustionThreshold,
                maxPassiveRatio: this.maxPassiveRatio,
                features: this.features,
            }
        );
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
        const snap: ZoneSample = {
            bid: event.zonePassiveBidVolume,
            ask: event.zonePassiveAskVolume,
            total: event.zonePassiveBidVolume + event.zonePassiveAskVolume,
            timestamp: event.timestamp,
        };
        if (
            !lastSnap ||
            lastSnap.bid !== snap.bid ||
            lastSnap.ask !== snap.ask
        ) {
            zoneHistory.push(snap);
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
                (t) => now - t.timestamp <= this.windowMs
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

    /* ------------------------------------------------------------------ */
    /*  Detection loop                                                    */
    /* ------------------------------------------------------------------ */
    protected checkForSignal_old(triggerTrade: AggressiveTrade): void {
        const zoneTicks = this.getEffectiveZoneTicks();
        const now = Date.now();

        const recentTrades = this.trades.filter(
            (t) => now - t.timestamp <= this.windowMs
        );
        if (recentTrades.length === 0) return;

        const zoneMap = this.groupTradesByZone(recentTrades, zoneTicks);

        for (const [zone, tradesAtZone] of zoneMap) {
            this.analyzeZoneForExhaustion(
                zone,
                tradesAtZone,
                triggerTrade,
                zoneTicks
            );
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
            return;
        }

        // Check cooldown to prevent spam
        if (!this.checkCooldown(zone, side)) {
            return;
        }

        // Analyze exhaustion conditions
        const conditions = this.analyzeExhaustionConditions(price, side, zone);
        const score = this.calculateExhaustionScore(conditions);

        this.logger.debug(`[ExhaustionDetector] Zone analysis`, {
            zone,
            price,
            side,
            score,
            conditions,
        });

        // Check if score meets threshold
        if (score < this.exhaustionThreshold) {
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

        // Check for spoofing if enabled
        if (
            this.features.spoofingDetection &&
            this.isSpoofed(price, side, triggerTrade.timestamp)
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

        // Signal detected - handle it
        this.handleDetection({
            zone,
            price,
            side,
            trades: volumes.trades,
            aggressive: volumes.aggressive,
            passive: volumes.passive,
            refilled,
            metadata: {
                exhaustionScore: score,
                conditions,
                detectorVersion: "2.0",
            },
        });

        this.metricsCollector.incrementMetric("exhaustionSignalsGenerated");
        //this.metricsCollector.recordHistogram('exhaustion.score', score);
    }

    private analyzeZoneForExhaustion_old(
        zone: number,
        tradesAtZone: AggressiveTrade[],
        triggerTrade: AggressiveTrade,
        zoneTicks: number
    ): void {
        const latestTrade = tradesAtZone[tradesAtZone.length - 1];
        const price = +latestTrade.price.toFixed(this.pricePrecision);
        const side = this.getTradeSide(latestTrade);

        const bookLevel = this.depth.get(price);
        if (!bookLevel) return;

        if (!this.checkCooldown(zone, side)) return;

        const factors = this.checkExhaustionConditions(price, side);
        const score = this.calculateExhaustionScore_old(factors);
        if (score < 0.7) return;

        const volumes = this.calculateZoneVolumes(
            zone,
            tradesAtZone,
            zoneTicks
        );

        if (
            this.features.spoofingDetection &&
            this.isSpoofed(price, side, triggerTrade.timestamp)
        ) {
            return;
        }

        const oppositeQty = side === "buy" ? bookLevel.ask : bookLevel.bid;
        const refilled = this.checkRefill(price, side, oppositeQty);

        if (refilled) return;

        this.handleExhaustion({
            zone,
            price,
            side,
            trades: volumes.trades,
            aggressive: volumes.aggressive,
            passive: volumes.passive,
            refilled,
        });
    }

    /**
     * Analyze conditions that indicate exhaustion
     */
    private analyzeExhaustionConditions(
        price: number,
        side: "buy" | "sell",
        zone: number
    ): ExhaustionConditions {
        try {
            // Get historical data
            const avgLiquidity =
                this.passiveVolumeTracker.getAveragePassiveBySide(
                    price,
                    side === "buy" ? "sell" : "buy",
                    this.windowMs
                );

            const spreadInfo = this.getCurrentSpread();
            const recentAggressive = this.getAggressiveVolumeAtPrice(
                price,
                5000
            );

            // Get zone passive history
            const zoneHistory = this.zonePassiveHistory.get(zone);
            const now = Date.now();
            const samples = zoneHistory
                ? zoneHistory
                      .toArray()
                      .filter((s) => now - s.timestamp <= this.windowMs)
                : [];

            const currentPassive =
                samples.length > 0 ? samples.at(-1)!.total : 0;
            const avgPassive = DetectorUtils.calculateMean(
                samples.map((s) => s.total)
            );
            const minPassive =
                samples.length > 0
                    ? Math.min(...samples.map((s) => s.total))
                    : 0;

            // Calculate passive velocity (rate of change)
            let passiveVelocity = 0;
            if (this.features.volumeVelocity && samples.length >= 2) {
                const recent = samples.slice(-5);
                const velocities = [];
                for (let i = 1; i < recent.length; i++) {
                    const deltaVol = recent[i].total - recent[i - 1].total;
                    const deltaTime =
                        recent[i].timestamp - recent[i - 1].timestamp;
                    if (deltaTime > 0) {
                        velocities.push(deltaVol / (deltaTime / 1000)); // per second
                    }
                }
                passiveVelocity =
                    velocities.length > 0
                        ? DetectorUtils.calculateMean(velocities)
                        : 0;
            }

            // Check passive imbalance
            const imbalance = this.checkPassiveImbalance(zone);

            return {
                aggressiveVolume: recentAggressive,
                currentPassive,
                avgPassive,
                minPassive,
                avgLiquidity,
                passiveRatio: avgPassive > 0 ? currentPassive / avgPassive : 0,
                depletionRatio:
                    avgPassive > 0 ? recentAggressive / avgPassive : 1,
                refillGap:
                    samples.length > 1
                        ? samples.at(-1)!.total - samples[0].total
                        : 0,
                imbalance: Math.abs(imbalance.imbalance),
                spread: spreadInfo ? spreadInfo.spread : 0,
                passiveVelocity,
                sampleCount: samples.length,
            };
        } catch (error) {
            this.handleError(
                error as Error,
                "ExhaustionDetector.analyzeExhaustionConditions"
            );
            // Return safe defaults
            return {
                aggressiveVolume: 0,
                currentPassive: 0,
                avgPassive: 0,
                minPassive: 0,
                avgLiquidity: 0,
                passiveRatio: 0,
                depletionRatio: 0,
                refillGap: 0,
                imbalance: 0,
                spread: 0,
                passiveVelocity: 0,
                sampleCount: 0,
            };
        }
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
                  .filter((s) => now - s.timestamp <= this.windowMs)
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

    private calculateExhaustionScore_old(f: {
        ratio: number; // aggr / passive (0-∞, lower = stronger)
        passiveStrength: number; // currentPassive / avgLiquidity
        refillGap: number; // positive gap = depletion
        imbalance: number; // 0-1
        spread: number; // current spread ratio
        recentAgg: number;
    }): number {
        let s = 0;

        /* Ratio: <0.05 → strong depletion */
        if (f.ratio < 0.02) s += 0.35;
        else if (f.ratio < 0.05) s += 0.25;
        else if (f.ratio < 0.1) s += 0.15;

        /* Passive strength: ↓ means depletion */
        if (f.passiveStrength < 0.3) s += 0.2;
        else if (f.passiveStrength < 0.5) s += 0.1;

        /* Refill gap */
        if (f.refillGap < 0) s += 0.1; // continuing drop

        /* Imbalance */
        if (f.imbalance > 0.7) s += 0.1;
        else if (f.imbalance > 0.4) s += 0.05;

        /* Spread */
        if (f.spread > 0.002) s += 0.05;

        /* Agg volume significance already in ratio; can add bonus if huge */
        return Math.max(0, Math.min(1, s));
    }

    /* ------------------------------------------------------------------ */
    /*  Spoofing, refill, cooldown – inherited helpers from BaseDetector  */
    /* ------------------------------------------------------------------ */

    private handleExhaustion(params: {
        zone: number;
        price: number;
        side: "buy" | "sell";
        trades: SpotWebsocketStreams.AggTradeResponse[];
        aggressive: number;
        passive: number;
        refilled: boolean;
    }): void {
        const detection: PendingDetection = {
            id: randomUUID(),
            time: Date.now(),
            price: params.price,
            side: params.side,
            zone: params.zone,
            trades: params.trades,
            aggressive: params.aggressive,
            passive: params.passive,
            refilled: params.refilled,
            confirmed: false,
        };

        if (this.features.priceResponse) {
            this.priceConfirmationManager.addPendingDetection(detection);
            this.logger.info(
                `[ExhaustionDetector] Pending exhaustion at ${params.price}`
            );
        } else {
            this.fireDetection(detection);
        }

        if (this.features.autoCalibrate) {
            this.autoCalibrator.recordSignal();
        }
    }
}
