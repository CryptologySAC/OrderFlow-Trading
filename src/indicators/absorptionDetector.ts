// src/indicators/absorptionDetector.ts

import { randomUUID } from "crypto";
import { SpotWebsocketStreams } from "@binance/spot";
import { BaseDetector } from "./base/baseDetector.js";
import { Logger } from "../infrastructure/logger.js";
import { MetricsCollector } from "../infrastructure/metricsCollector.js";
import { ISignalLogger } from "../services/signalLogger.js";
import type { EnrichedTradeEvent } from "../types/marketEvents.js";
import { RollingWindow } from "../utils/rollingWindow.js";

import type { TradeData, PendingDetection } from "../utils/utils.js";
import type {
    IAbsorptionDetector,
    DetectorCallback,
    BaseDetectorSettings,
    DetectorFeatures,
} from "./interfaces/detectorInterfaces.js";

export interface AbsorptionSettings extends BaseDetectorSettings {
    features?: AbsorptionFeatures;
}

/** Placeholder for future expansion (API consistency) */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface AbsorptionFeatures extends DetectorFeatures {
    // Add any absorption-specific features here
}

// TODO
export interface AbsorptionSignal {
    id: string;
    time: number;
    price: number;
    side: "buy" | "sell";
    zone: number;
    aggressiveVolume: number;
    passiveVolume: number;
    zonePassiveBidVolume?: number;
    zonePassiveAskVolume?: number;
    trades: number;
    refilled: boolean;
    confirmed: boolean;
}

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
    private readonly settings: Required<AbsorptionSettings>;
    private lastSignalAt: number = 0;

    constructor(
        callback: DetectorCallback,
        settings: AbsorptionSettings = {},
        logger: Logger,
        metricsCollector: MetricsCollector,
        signalLogger?: ISignalLogger
    ) {
        super(callback, settings, logger, metricsCollector, signalLogger);
        this.settings = settings as Required<AbsorptionSettings>;

        // --- ADD: rolling window for zone passive, matches windowMs
        const windowSize = Math.max(Math.ceil(this.windowMs / 1000), 10);
        this.rollingZonePassive = new RollingWindow(windowSize);
    }

    /**
     * Call this on every enriched event from the preprocessor
     */
    public onEnrichedTrade(event: EnrichedTradeEvent): void {
        try {
            // Only act on sufficiently large aggressive trades
            if (event.quantity < this.minAggVolume) return;

            const now = Date.now();
            // Cooldown to avoid flooding
            if (now - this.lastSignalAt < this.settings.eventCooldownMs) return;

            // --- Zone logic: round to nearest tick band
            const zone = +(
                Math.round(event.price / this.zoneTicks) * this.zoneTicks
            ).toFixed(this.pricePrecision);

            // --- Absorption logic: is there still passive after big aggression?
            // Optionally, can use zonePassive*Volume or local passive*Volume
            const passive = event.isMakerSell
                ? event.passiveBidVolume
                : event.passiveAskVolume;
            const zonePassive = event.isMakerSell
                ? event.zonePassiveBidVolume
                : event.zonePassiveAskVolume;

            // Criteria: after a big market order, there's still substantial passive at the same/zone level
            const absorption =
                passive > event.quantity * 0.8 ||
                (zonePassive !== undefined &&
                    zonePassive > event.quantity * 0.5);

            if (absorption) {
                // Optionally check for spoofing (if passed from event/meta)
                // If spoofingDetector result is available in event.meta, filter here

                // --- Construct signal
                const signal: AbsorptionSignal = {
                    id: randomUUID(),
                    time: now,
                    price: event.price,
                    side: event.isMakerSell ? "buy" : "sell",
                    zone,
                    aggressiveVolume: event.quantity,
                    passiveVolume: passive,
                    zonePassiveBidVolume: event.zonePassiveBidVolume,
                    zonePassiveAskVolume: event.zonePassiveAskVolume,
                    trades: 1, // Here, 1 trade - you could aggregate within window if needed
                    refilled: false, // Future: passive refill logic
                    confirmed: false,
                };

                // Metrics/logging
                this.metricsCollector.incrementMetric("absorptionSignals");
                this.logger.info("[AbsorptionDetector] Absorption detected", {
                    signal,
                });
                this.signalLogger?.logEvent({
                    timestamp: new Date().toISOString(),
                    type: "absorption",
                    symbol: this.settings.symbol,
                    signalPrice: event.price,
                    side: signal.side,
                    aggressiveVolume: event.quantity,
                    passiveVolume: passive,
                    zone,
                    refilled: false,
                    confirmed: false,
                    outcome: "detected",
                });

                // Fire the callback/event downstream
                // (Assuming callback is now set by wiring, e.g., this.onSignal)
                // If you want: this.onSignal(signal);
            }

            this.lastSignalAt = now;
        } catch (error) {
            this.handleError(
                error as Error,
                "AbsorptionDetector.onEnrichedTrade"
            );
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
     * Analyze zone for absorption
     */
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
        const absorptionDetected = this.checkAbsorptionConditions(price, side);

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

            // Check passive refill
            const passiveQty = side === "buy" ? bookLevel.ask : bookLevel.bid;
            const refilled = this.checkRefill(price, side, passiveQty);

            this.handleAbsorption({
                zone,
                price,
                side,
                trades: volumes.trades,
                aggressive: volumes.aggressive,
                passive: volumes.passive,
                refilled,
            });
        }

        // Debug output every 10 trades
        //if (Math.random() < 0.1) {
        //    this.debugCurrentState();
        //}
    }

    /**
     * Check absorption conditions with improved logic
     */
    private checkAbsorptionConditions(
        price: number,
        side: "buy" | "sell"
    ): boolean {
        // Time windows
        const shortWindow = 5000; // 5 seconds for recent activity
        const longWindow = 60000; // 60 seconds for average

        // Get recent aggressive volume at this specific price
        const recentAggressive = this.getAggressiveVolumeAtPrice(
            price,
            shortWindow
        );

        //this.logger.info("DEBUG aggressive", {
        //    recentAggressive,
        //    minAggVolume: this.minAggVolume,
        //});

        // Skip if no recent activity
        if (recentAggressive < this.minAggVolume * 0.1) {
            return false;
        }

        // Get average passive liquidity at this level
        const avgPassive = this.passiveVolumeTracker.getAveragePassiveBySide(
            price,
            side,
            longWindow
        );

        // --- CHANGE: Use rolling mean/min of passive for apples-to-apples comparison
        const rollingZonePassive = this.rollingZonePassive.mean();

        // Method 1: Classic absorption - passive remains strong
        const classicAbsorption =
            recentAggressive > this.minAggVolume &&
            rollingZonePassive > recentAggressive * 0.8;

        // Method 2: Relative absorption - passive didn't decrease much despite aggression
        const relativeAbsorption =
            avgPassive > 0 &&
            recentAggressive > avgPassive * 2 &&
            rollingZonePassive > avgPassive * 0.7;

        // Method 3: Iceberg detection - refilling after being hit
        const icebergDetection =
            this.features.passiveHistory &&
            this.passiveVolumeTracker.hasPassiveRefilled(price, side);

        //this.logger.info("DEBUG passive", { rollingZonePassive, avgPassive });

        // Log near-misses for debugging
        if (
            !classicAbsorption &&
            !relativeAbsorption &&
            recentAggressive > this.minAggVolume * 0.5
        ) {
            //this.logger.debug(`[Absorption] Near miss at ${price}`, {
            //    price,
            //    side,
            //    recentAggressive: recentAggressive.toFixed(2),
            //    rollingZonePassive: rollingZonePassive.toFixed(2),
            //    avgPassive: avgPassive.toFixed(2),
            //    ratio: (rollingZonePassive / recentAggressive).toFixed(2),
            //});
        }
        //this.logger.info("DEBUG conditions", {
        //    classicAbsorption,
        //    relativeAbsorption,
        //    icebergDetection,
        //});

        return (
            classicAbsorption || relativeAbsorption || icebergDetection || false
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
