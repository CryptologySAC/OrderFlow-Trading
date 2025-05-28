// src/indicators/exhaustionDetector.ts

import { randomUUID } from "crypto";
import { SpotWebsocketStreams } from "@binance/spot";
import { BaseDetector, RollingWindow } from "./base/baseDetector.js";
import { Logger } from "../infrastructure/logger.js";
import { MetricsCollector } from "../infrastructure/metricsCollector.js";
import { ISignalLogger } from "../services/signalLogger.js";
import type { TradeData, PendingDetection } from "../utils/utils.js";
import type {
    IExhaustionDetector,
    DetectorCallback,
    BaseDetectorSettings,
    DetectorFeatures,
} from "./interfaces/detectorInterfaces.js";

export interface ExhaustionSettings extends BaseDetectorSettings {
    features?: ExhaustionFeatures;
}

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface ExhaustionFeatures extends DetectorFeatures {
    // Add any exhaustion-specific features here
}

/**
 * Exhaustion detector - identifies when one side of the orderbook is depleted
 */
export class ExhaustionDetector
    extends BaseDetector
    implements IExhaustionDetector
{
    protected readonly detectorType = "exhaustion" as const;

    // --- ADD: rolling passive window for strict apples-to-apples comparison
    private readonly rollingZonePassive: RollingWindow;

    constructor(
        callback: DetectorCallback,
        settings: ExhaustionSettings = {},
        logger: Logger,
        metricsCollector: MetricsCollector,
        signalLogger?: ISignalLogger
    ) {
        super(callback, settings, logger, metricsCollector, signalLogger);

        // --- ADD: rolling window for zone passive, matches windowMs
        const windowSize = Math.max(Math.ceil(this.windowMs / 1000), 10);
        this.rollingZonePassive = new RollingWindow(windowSize);
    }

    /**
     * Check for exhaustion signal
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
            this.analyzeZoneForExhaustion(
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
     * Analyze zone for exhaustion
     */
    private analyzeZoneForExhaustion(
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

        // New exhaustion detection logic
        const exhaustionDetected = this.checkExhaustionConditions(price, side);

        if (exhaustionDetected) {
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

            // Check passive refill (exhaustion is invalid if liquidity returns)
            const oppositeQty = side === "buy" ? bookLevel.ask : bookLevel.bid;
            const refilled = this.checkRefill(price, side, oppositeQty);

            if (!refilled) {
                // Only signal if NOT refilled
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
        }

        // Debug output every 10 trades
        if (Math.random() < 0.1) {
            this.debugCurrentState();
        }
    }

    /**
     * Check exhaustion conditions with improved logic
     */
    private checkExhaustionConditions(
        price: number,
        side: "buy" | "sell"
    ): boolean {
        // Get average liquidity at this level
        const avgLiquidity = this.passiveVolumeTracker.getAveragePassiveBySide(
            price,
            side === "buy" ? "sell" : "buy", // Opposite side for average
            300000 // 5 minutes
        );

        // Get spread information
        const spreadInfo = this.getCurrentSpread();
        if (!spreadInfo) {
            return false; // Can't detect exhaustion without spread
        }

        // Get recent aggressive volume
        const recentAggressive = this.getAggressiveVolumeAtPrice(price, 5000);

        // --- CHANGE: Use rolling mean/min for passive for apples-to-apples comparison
        const rollingZonePassive = this.rollingZonePassive.mean();

        // Method 1: Absolute exhaustion - opposite side is nearly empty
        const absoluteExhaustion =
            recentAggressive > this.minAggVolume &&
            rollingZonePassive < this.minAggVolume * 0.05;

        // Method 2: Relative exhaustion - liquidity depleted vs average
        const relativeExhaustion =
            avgLiquidity > 0 &&
            rollingZonePassive < avgLiquidity * 0.1 &&
            recentAggressive > this.minAggVolume;

        // Method 3: Spread exhaustion - wide spread indicates lack of liquidity
        const spreadExhaustion =
            spreadInfo.spread > 0.002 && // 0.2% spread
            rollingZonePassive < this.minAggVolume &&
            recentAggressive > this.minAggVolume * 0.5;

        // Method 4: Price at extreme - exhaustion at best bid/ask
        const priceAtExtreme =
            (side === "buy" && Math.abs(price - spreadInfo.bestBid) < 0.01) ||
            (side === "sell" && Math.abs(price - spreadInfo.bestAsk) < 0.01);

        const extremeExhaustion =
            priceAtExtreme &&
            rollingZonePassive < this.minAggVolume * 0.1 &&
            spreadInfo.spread > 0.001;

        // Log near-misses for debugging
        if (
            !absoluteExhaustion &&
            !relativeExhaustion &&
            !spreadExhaustion &&
            !extremeExhaustion
        ) {
            if (
                rollingZonePassive < this.minAggVolume * 0.2 &&
                recentAggressive > this.minAggVolume * 0.3
            ) {
                this.logger.debug(`[Exhaustion] Near miss at ${price}`, {
                    price,
                    side,
                    rollingZonePassive: rollingZonePassive.toFixed(2),
                    avgLiquidity: avgLiquidity.toFixed(2),
                    recentAggressive: recentAggressive.toFixed(2),
                    spread: (spreadInfo.spread * 100).toFixed(3) + "%",
                    depletion:
                        avgLiquidity > 0
                            ? (
                                  (1 - rollingZonePassive / avgLiquidity) *
                                  100
                              ).toFixed(1) + "%"
                            : "N/A",
                });
            }
        }

        return (
            absoluteExhaustion ||
            relativeExhaustion ||
            spreadExhaustion ||
            extremeExhaustion
        );
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
        if (this.spoofingDetector.wasSpoofed(price, side, timestamp)) {
            this.logger.info(
                `[ExhaustionDetector] Spoofing detected at price ${price}`
            );
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
        oppositeQty: number
    ): boolean {
        if (this.features.passiveHistory) {
            return this.passiveVolumeTracker.hasPassiveRefilled(price, side);
        }
        return this.passiveVolumeTracker.checkRefillStatus(
            price,
            side,
            oppositeQty
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
     * Handle exhaustion detection
     */
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
            `[ExhaustionDetector] Signal fired at ${detection.price}`
        );
    }
}
