// src/indicators/absorptionDetector.ts

import { randomUUID } from "crypto";
import { SpotWebsocketStreams } from "@binance/spot";
import { BaseDetector } from "./base/baseDetector.js";
import { RollingWindow } from "../utils/rollingWindow.js";
import { Logger } from "../infrastructure/logger.js";
import { MetricsCollector } from "../infrastructure/metricsCollector.js";
import { ISignalLogger } from "../services/signalLogger.js";
import type { TradeData, PendingDetection } from "../utils/utils.js";
import type {
    IAbsorptionDetector,
    DetectorCallback,
    BaseDetectorSettings,
    DetectorFeatures,
} from "./interfaces/detectorInterfaces.js";
import { EnrichedTradeEvent } from "../types/marketEvents.js";

export interface AbsorptionSettings extends BaseDetectorSettings {
    features?: AbsorptionFeatures;
}

/** Placeholder for future expansion (API consistency) */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface AbsorptionFeatures extends DetectorFeatures {
    // Add any absorption-specific features here
}

type ZoneSample = {
    bid: number;
    ask: number;
    total: number;
    timestamp: number;
};

/**
 * Absorption detector - identifies when aggressive volume is absorbed by passive liquidity
 */
export class AbsorptionDetector
    extends BaseDetector
    implements IAbsorptionDetector
{
    protected readonly detectorType = "absorption" as const;

    // --- ADD: rolling passive window for apples-to-apples comparison
    private readonly rollingZonePassive: RollingWindow;
    private lastTradeId: string | null = null;
    private readonly zonePassiveHistory: Map<
        number,
        RollingWindow<ZoneSample>
    > = new Map();

    constructor(
        callback: DetectorCallback,
        settings: AbsorptionSettings = {},
        logger: Logger,
        metricsCollector: MetricsCollector,
        signalLogger?: ISignalLogger
    ) {
        super(callback, settings, logger, metricsCollector, signalLogger);

        // --- ADD: rolling window for zone passive, matches windowMs
        const windowSize = Math.max(Math.ceil(this.windowMs / 1000), 10);
        this.rollingZonePassive = new RollingWindow(windowSize);
    }

    public onEnrichedTrade(event: EnrichedTradeEvent): void {
        const zone = this.calculateZone(event.price);

        // Get or create zone-specific history
        if (!this.zonePassiveHistory.has(zone)) {
            this.zonePassiveHistory.set(
                zone,
                new RollingWindow<ZoneSample>(100, false)
            );
        }

        const zoneHistory = this.zonePassiveHistory.get(zone)!;

        // Track zone passive volumes
        zoneHistory.push({
            bid: event.zonePassiveBidVolume,
            ask: event.zonePassiveAskVolume,
            total: event.zonePassiveBidVolume + event.zonePassiveAskVolume,
            timestamp: event.timestamp,
        });

        // TODO Make sure trades are not double stacked
        if (this.lastTradeId !== event.tradeId) {
            this.lastTradeId = event.tradeId;
            this.addTrade(event.originalTrade); // TODO refactor to EnrichedTrade
        }
    }

    /**
     * Check for absorption signal
     */
    protected checkForSignal(triggerTrade: TradeData): void {
        const zoneTicks = this.getEffectiveZoneTicks();
        const now = Date.now();

        // Get trades within the time window
        const recentTrades = this.trades.filter(
            (t) => now - t.timestamp <= this.windowMs
        );

        if (recentTrades.length === 0) return;

        // Group trades by zone
        const zoneMap = this.groupTradesByZone(recentTrades, zoneTicks);

        // Analyze each zone
        for (const [zone, tradesAtZone] of zoneMap) {
            this.analyzeZoneForAbsorption(
                zone,
                tradesAtZone,
                triggerTrade,
                zoneTicks
            );
        }
    }

    /**
     * Group trades by price zone
     */
    private groupTradesByZone(
        trades: TradeData[],
        zoneTicks: number
    ): Map<number, TradeData[]> {
        const byPrice = new Map<number, TradeData[]>();

        for (const trade of trades) {
            const price = +trade.price.toFixed(this.pricePrecision);
            if (!byPrice.has(price)) {
                byPrice.set(price, []);
            }
            byPrice.get(price)!.push(trade);
        }

        const zoneMap = new Map<number, TradeData[]>();
        for (const [price, tradesAtPrice] of byPrice) {
            const zone = +(Math.round(price / zoneTicks) * zoneTicks).toFixed(
                this.pricePrecision
            );
            if (!zoneMap.has(zone)) {
                zoneMap.set(zone, []);
            }
            zoneMap.get(zone)!.push(...tradesAtPrice);
        }

        return zoneMap;
    }

    /**
     * Check absorption conditions with improved logic
     */
    private checkAbsorptionConditions(
        price: number,
        side: "buy" | "sell",
        zone: number
    ): boolean {
        // For buy absorption: aggressive buys hit the ASK (passive sellers)
        // For sell absorption: aggressive sells hit the BID (passive buyers)

        const zoneHistory = this.zonePassiveHistory.get(zone);
        if (!zoneHistory) return false;

        // Get the RELEVANT passive side
        const relevantPassive = zoneHistory
            .toArray()
            .map((snapshot) => (side === "buy" ? snapshot.ask : snapshot.bid));

        // Calculate rolling statistics
        const currentPassive = relevantPassive[relevantPassive.length - 1] || 0;
        const avgPassive = this.calculateMean(relevantPassive);
        const minPassive = Math.min(...relevantPassive);

        // Get recent aggressive volume
        const recentAggressive = this.getAggressiveVolumeAtPrice(price, 5000);

        // Absorption checks:
        // 1. Current passive exceeds aggressive (classic absorption)
        const classicAbsorption = currentPassive > recentAggressive * 0.8;

        // 2. Passive maintained despite hits (sponge effect)
        const maintainedPassive =
            minPassive > avgPassive * 0.7 && recentAggressive > avgPassive;

        // 3. Passive growing (iceberg/refill)
        const growingPassive = currentPassive > avgPassive * 1.2;

        return classicAbsorption || maintainedPassive || growingPassive;
    }

    private detectPassiveRefill(
        price: number,
        side: "buy" | "sell",
        zone: number
    ): boolean {
        const zoneHistory = this.zonePassiveHistory.get(zone);
        if (!zoneHistory || zoneHistory.count() < 10) return false;

        const snapshots = zoneHistory.toArray();
        const relevantSide = side === "buy" ? "ask" : "bid";

        let refillCount = 0;
        let previousLevel = snapshots[0][relevantSide];

        // Count how many times passive increased after decreasing
        for (let i = 1; i < snapshots.length; i++) {
            const currentLevel = snapshots[i][relevantSide];

            // If it dropped then came back up
            if (
                i > 1 &&
                snapshots[i - 1][relevantSide] < previousLevel * 0.8 &&
                currentLevel > previousLevel * 0.9
            ) {
                refillCount++;
            }

            previousLevel = currentLevel;
        }

        // Multiple refills indicate iceberg
        return refillCount >= 2;
    }

    private calculateAbsorptionMetrics(zone: number): {
        absorptionRatio: number;
        passiveStrength: number;
        refillRate: number;
    } {
        const now = Date.now();
        const windowMs = 30000; // 30 seconds

        // Get zone-specific passive history
        const zoneHistory = this.zonePassiveHistory.get(zone);
        if (!zoneHistory)
            return { absorptionRatio: 0, passiveStrength: 0, refillRate: 0 };

        // Calculate total aggressive in zone
        const aggressiveInZone = this.trades
            .filter((t) => {
                const tradeZone = this.calculateZone(t.price);
                return tradeZone === zone && now - t.timestamp <= windowMs;
            })
            .reduce((sum, t) => sum + t.quantity, 0);

        // Get passive statistics
        const passiveSnapshots = zoneHistory
            .toArray()
            .filter((s) => now - s.timestamp <= windowMs);

        if (passiveSnapshots.length === 0 || aggressiveInZone === 0) {
            return { absorptionRatio: 0, passiveStrength: 0, refillRate: 0 };
        }

        const avgPassiveTotal = this.calculateMean(
            passiveSnapshots.map((s) => s.total)
        );
        const currentPassive =
            passiveSnapshots[passiveSnapshots.length - 1].total;

        // Absorption ratio: how much passive vs aggressive
        const absorptionRatio = avgPassiveTotal / aggressiveInZone;

        // Passive strength: how well passive maintained
        const passiveStrength = currentPassive / avgPassiveTotal;

        // Refill rate: how often passive increases
        let increases = 0;
        for (let i = 1; i < passiveSnapshots.length; i++) {
            if (passiveSnapshots[i].total > passiveSnapshots[i - 1].total) {
                increases++;
            }
        }
        const refillRate = increases / (passiveSnapshots.length - 1);

        return { absorptionRatio, passiveStrength, refillRate };
    }

    private checkPassiveImbalance(zone: number): {
        imbalance: number;
        dominantSide: "bid" | "ask" | "neutral";
    } {
        const zoneHistory = this.zonePassiveHistory.get(zone);
        if (!zoneHistory || zoneHistory.count() === 0) {
            return { imbalance: 0, dominantSide: "neutral" };
        }

        const recent = zoneHistory.toArray().slice(-10);
        const avgBid = this.calculateMean(recent.map((s) => s.bid));
        const avgAsk = this.calculateMean(recent.map((s) => s.ask));

        const total = avgBid + avgAsk;
        if (total === 0) return { imbalance: 0, dominantSide: "neutral" };

        const imbalance = (avgBid - avgAsk) / total;
        const dominantSide =
            imbalance > 0.2 ? "bid" : imbalance < -0.2 ? "ask" : "neutral";

        return { imbalance, dominantSide };
    }

    private analyzeZoneForAbsorption(
        zone: number,
        tradesAtZone: TradeData[],
        triggerTrade: TradeData,
        zoneTicks: number
    ): void {
        // Get the most recent trade price in the zone
        const latestTrade = tradesAtZone[tradesAtZone.length - 1];
        const price = +latestTrade.price.toFixed(this.pricePrecision);
        const side = this.getTradeSide(latestTrade);

        // Skip if no orderbook data
        const bookLevel = this.depth.get(price);
        if (!bookLevel) return;

        // Check cooldown first
        if (!this.checkCooldown(zone, side)) return;

        // New absorption detection logic
        const absorptionDetected = this.checkAbsorptionConditions(
            price,
            side,
            zone
        );

        if (absorptionDetected) {
            // Calculate volumes for the signal
            const volumes = this.calculateZoneVolumes(
                zone,
                tradesAtZone,
                zoneTicks
            );

            // Check for spoofing
            if (
                this.features.spoofingDetection &&
                this.isSpoofed(price, side, triggerTrade.timestamp)
            ) {
                return;
            }

            // Get comprehensive passive metrics
            const metrics = this.calculateAbsorptionMetrics(zone);
            const imbalance = this.checkPassiveImbalance(zone);
            const hasRefill = this.detectPassiveRefill(price, side, zone);

            // Multi-factor absorption detection
            const absorptionScore = this.calculateAbsorptionScore({
                absorptionRatio: metrics.absorptionRatio,
                passiveStrength: metrics.passiveStrength,
                refillRate: metrics.refillRate,
                hasRefill,
                imbalance: Math.abs(imbalance.imbalance),
                aggressiveVolume: volumes.aggressive,
                minAggVolume: this.minAggVolume,
            });

            if (absorptionScore > 0.7) {
                // Threshold for detection
                // Create detailed signal
                const signal = {
                    zone,
                    price,
                    side,
                    trades: volumes.trades,
                    aggressive: volumes.aggressive,
                    passive: volumes.passive,
                    refilled: hasRefill,
                    metrics: {
                        absorptionRatio: metrics.absorptionRatio,
                        passiveStrength: metrics.passiveStrength,
                        refillRate: metrics.refillRate,
                        imbalance: imbalance.imbalance,
                        dominantSide: imbalance.dominantSide,
                        confidence: absorptionScore,
                    },
                };

                this.handleAbsorption(signal);
            }
        }
    }

    private calculateAbsorptionScore(factors: {
        absorptionRatio: number;
        passiveStrength: number;
        refillRate: number;
        hasRefill: boolean;
        imbalance: number;
        aggressiveVolume: number;
        minAggVolume: number;
    }): number {
        let score = 0;

        // Factor 1: Absorption ratio (passive vs aggressive)
        if (factors.absorptionRatio > 1.5) score += 0.3;
        else if (factors.absorptionRatio > 1.0) score += 0.2;
        else if (factors.absorptionRatio > 0.7) score += 0.1;

        // Factor 2: Passive strength (maintained liquidity)
        if (factors.passiveStrength > 0.9) score += 0.2;
        else if (factors.passiveStrength > 0.7) score += 0.1;

        // Factor 3: Refill behavior
        if (factors.hasRefill) score += 0.2;
        else if (factors.refillRate > 0.3) score += 0.1;

        // Factor 4: Volume significance
        if (factors.aggressiveVolume > factors.minAggVolume * 2) score += 0.1;

        // Factor 5: Passive imbalance (strong one-sided liquidity)
        if (factors.imbalance > 0.5) score += 0.1;

        return Math.min(1.0, score);
    }
    /**
     * Calculate zone volumes
     */
    private calculateZoneVolumes(
        zone: number,
        tradesAtZone: TradeData[],
        zoneTicks: number
    ): {
        aggressive: number;
        passive: number;
        trades: SpotWebsocketStreams.AggTradeResponse[];
    } {
        if (this.features.multiZone) {
            return this.sumVolumesInBand(zone, Math.floor(zoneTicks / 2));
        }

        const aggressive = tradesAtZone.reduce((sum, t) => sum + t.quantity, 0);
        const trades = tradesAtZone.map((t) => t.originalTrade);

        // --- CHANGE: Use rolling window mean/min for passive instead of current snapshot
        const passive = this.rollingZonePassive.mean();

        return { aggressive, passive, trades };
    }

    /**
     * When new depth data arrives, update rolling window for apples-to-apples comparison
     */
    public addDepth(update: SpotWebsocketStreams.DiffBookDepthResponse): void {
        super.addDepth(update);

        // For every depth update, push current sum of bid+ask at all known prices into rollingZonePassive
        let totalPassive = 0;
        const allPrices = this.depth.keys();
        for (const price of allPrices) {
            const level = this.depth.get(price);
            if (level) {
                totalPassive += level.bid + level.ask;
            }
        }
        this.rollingZonePassive.push(totalPassive);
    }

    /**
     * Check if price was spoofed
     */
    private isSpoofed(
        price: number,
        side: "buy" | "sell",
        timestamp: number
    ): boolean {
        if (
            this.spoofingDetector.wasSpoofed(
                price,
                side,
                timestamp,
                (p, from, to) => this.getAggressiveAtPrice(p, from, to)
            )
        ) {
            return true;
        }
        return false;
    }

    /**
     * Check for passive refill
     */
    private checkRefill(
        price: number,
        side: "buy" | "sell",
        passiveQty: number
    ): boolean {
        if (this.features.passiveHistory) {
            return this.passiveVolumeTracker.hasPassiveRefilled(price, side);
        }
        return this.passiveVolumeTracker.checkRefillStatus(
            price,
            side,
            passiveQty
        );
    }

    /**
     * Check cooldown
     */
    private checkCooldown(zone: number, side: "buy" | "sell"): boolean {
        const eventKey = `${zone}_${side}`;
        const now = Date.now();
        const lastSignalTime = this.lastSignal.get(eventKey) || 0;

        if (now - lastSignalTime <= this.eventCooldownMs) {
            return false;
        }

        this.lastSignal.set(eventKey, now);
        return true;
    }

    /**
     * Handle absorption detection
     */
    private handleAbsorption(params: {
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
                `[AbsorptionDetector] Pending absorption at ${params.price}`
            );
        } else {
            // Fire immediately
            this.fireDetection(detection);
        }

        if (this.features.autoCalibrate) {
            this.autoCalibrator.recordSignal();
        }
    }

    /**
     * Fire detection callback
     */
    private fireDetection(detection: PendingDetection): void {
        this.callback({
            id: detection.id || randomUUID(),
            price: detection.price,
            side: detection.side,
            trades: detection.trades,
            totalAggressiveVolume: detection.aggressive,
            passiveVolume: detection.passive,
            zone: detection.zone,
            refilled: detection.refilled,
            detectedAt: Date.now(),
            detectorSource: this.detectorType,
        });

        this.logger.info(
            `[AbsorptionDetector] Signal fired at ${detection.price}`
        );
    }
}
