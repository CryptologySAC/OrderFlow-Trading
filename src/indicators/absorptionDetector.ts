// src/indicators/absorptionDetector.ts

import { randomUUID } from "crypto";
import { SpotWebsocketStreams } from "@binance/spot";
import { BaseDetector } from "./base/baseDetector.js";
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

export interface AbsorptionSettings extends BaseDetectorSettings {
    features?: AbsorptionFeatures;
}

/** Placeholder for future expansion (API consistency) */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface AbsorptionFeatures extends DetectorFeatures {
    // Add any absorption-specific features here
}

/**
 * Absorption detector - identifies when aggressive volume is absorbed by passive liquidity
 */
export class AbsorptionDetector
    extends BaseDetector
    implements IAbsorptionDetector
{
    protected readonly detectorType = "absorption" as const;

    constructor(
        callback: DetectorCallback,
        settings: AbsorptionSettings = {},
        logger: Logger,
        metricsCollector: MetricsCollector,
        signalLogger?: ISignalLogger
    ) {
        super(callback, settings, logger, metricsCollector, signalLogger);
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
        const volumes = this.calculateZoneVolumes(
            zone,
            tradesAtZone,
            zoneTicks
        );

        if (volumes.aggressive < this.minAggVolume) return;

        const latestTrade = tradesAtZone[tradesAtZone.length - 1];
        const price = +latestTrade.price.toFixed(this.pricePrecision);
        const side = this.getTradeSide(latestTrade);

        const bookLevel = this.depth.get(price);
        if (!bookLevel) return;

        const passiveQty = side === "buy" ? bookLevel.ask : bookLevel.bid;

        // Check for spoofing
        if (
            this.features.spoofingDetection &&
            this.isSpoofed(price, side, triggerTrade.timestamp)
        ) {
            return;
        }

        // Check passive refill
        const refilled = this.checkRefill(price, side, passiveQty);

        // Check cooldown
        if (!this.checkCooldown(zone, side)) return;

        // Absorption criteria: passive volume absorbs aggressive volume
        if (passiveQty > volumes.aggressive * 0.8) {
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

        const latestTrade = tradesAtZone[tradesAtZone.length - 1];
        const price = +latestTrade.price.toFixed(this.pricePrecision);
        const bookLevel = this.depth.get(price);
        const passive = bookLevel ? bookLevel.bid + bookLevel.ask : 0;

        return { aggressive, passive, trades };
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
                `[AbsorptionDetector] Spoofing detected at price ${price}`
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
