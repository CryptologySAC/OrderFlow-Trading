// src/indicators/accumulationDetector.ts

import { SpotWebsocketStreams } from "@binance/spot";
import { TradeData } from "../utils/utils.js";
import { Logger } from "../infrastructure/logger.js";
import { MetricsCollector } from "../infrastructure/metricsCollector.js";
import { ISignalLogger } from "../services/signalLogger.js";
import { AccumulationResult } from "../types/signalTypes.js";
import { Detector } from "./base/detector.js";

/**
 * Configuration options for the AccumulationDetector.
 */
export interface AccumulationDetectorConfig {
    windowMs?: number; // Rolling window for aggregation (default: 15 min)
    minDurationMs?: number; // Min duration for an accumulation zone (default: 5 min)
    zoneSize?: number; // USDT per zone (default: 0.02)
    minRatio?: number; // Min passive/aggressive ratio to trigger (default: 1.2)
    minRecentActivityMs?: number; // Max ms since last trade (default: 1 min)
    minAggVolume?: number; // Minimum aggressive volume (default: 5)
    trackSide?: boolean; // Track buy/sell accumulation separately (default: true)
    pricePrecision?: number; // For reporting (default: 2)
}

export interface ZoneData {
    aggressive: number[];
    times: number[];
    startTime: number;
    lastUpdate: number;
    tradeCount: number;
    side: "buy" | "sell";
}

export interface PassiveVolumeEntry {
    volume: number;
    lastUpdate: number;
}

/**
 * AccumulationDetector
 * Tracks aggressive trading and passive liquidity per zone, for accumulation signals.
 */
export class AccumulationDetector extends Detector {
    private readonly zones = new Map<string, ZoneData>();
    private readonly passiveVolumeByZone = new Map<
        string,
        PassiveVolumeEntry
    >();
    private readonly config: Required<AccumulationDetectorConfig>;
    private readonly cleanupIntervalMs = 60_000;
    private lastCleanup = Date.now();

    constructor(
        private readonly symbol = "LTCUSDT",
        config: AccumulationDetectorConfig = {},
        logger: Logger,
        metricsCollector: MetricsCollector,
        signalLogger?: ISignalLogger
    ) {
        super(logger, metricsCollector, signalLogger);
        this.config = {
            windowMs: config.windowMs ?? 900_000,
            minDurationMs: config.minDurationMs ?? 300_000,
            zoneSize: config.zoneSize ?? 0.02,
            minRatio: config.minRatio ?? 1.2,
            minRecentActivityMs: config.minRecentActivityMs ?? 60_000,
            minAggVolume: config.minAggVolume ?? 5,
            trackSide: config.trackSide ?? true,
            pricePrecision: config.pricePrecision ?? 2,
        };
    }

    /**
     * Process new trades; updates rolling aggressive volume and timestamp.
     */
    public addTrade(trade: SpotWebsocketStreams.AggTradeResponse): void {
        const normalized: TradeData = {
            price: parseFloat(trade.p ?? "0"),
            quantity: parseFloat(trade.q ?? "0"),
            timestamp: trade.T ?? Date.now(),
            isMakerSell: trade.m || false,
            originalTrade: trade,
        };

        const zone = this.getZoneKey(normalized.price, normalized.isMakerSell);
        let data = this.zones.get(zone);
        const now = Date.now();

        if (!data) {
            data = {
                aggressive: [],
                times: [],
                startTime: normalized.timestamp,
                lastUpdate: normalized.timestamp,
                tradeCount: 0,
                side: normalized.isMakerSell ? "buy" : "sell",
            };
            this.zones.set(zone, data);
        }

        data.aggressive.push(normalized.quantity);
        data.times.push(normalized.timestamp);
        data.lastUpdate = normalized.timestamp;
        data.tradeCount++;

        // Prune rolling window
        while (
            data.times.length &&
            now - data.times[0] > this.config.windowMs
        ) {
            data.aggressive.shift();
            data.times.shift();
        }

        this.maybeCleanup();
    }

    /**
     * Update passive volumes for all price zones from the latest order book.
     */
    public addDepth(update: SpotWebsocketStreams.DiffBookDepthResponse): void {
        // For every depth update, walk bids/asks, aggregate passive at each price, and update per-zone.
        const now = Date.now();
        this.updateDepthSide(
            Array.isArray(update.b)
                ? update.b.filter(
                      (x): x is [string, string] =>
                          Array.isArray(x) && x.length === 2
                  )
                : undefined,
            "bid",
            now
        );
        this.updateDepthSide(
            Array.isArray(update.a)
                ? update.a.filter(
                      (x): x is [string, string] =>
                          Array.isArray(x) && x.length === 2
                  )
                : undefined,
            "ask",
            now
        );

        // Optionally: prune old entries if they haven't been updated recently (handled in maybeCleanup)
    }

    private updateDepthSide(
        updates: [string, string][] | undefined,
        side: "bid" | "ask",
        now: number
    ) {
        if (!updates) return;
        for (const [priceStr, qtyStr] of updates) {
            const price = parseFloat(priceStr);
            const qty = parseFloat(qtyStr);
            if (isNaN(price) || isNaN(qty)) continue;
            // We aggregate both bids and asks into the same zone map,
            // but for more advanced detectors, you could split by side.
            const zone = this.getZoneKey(price, side === "bid");
            const entry = this.passiveVolumeByZone.get(zone);
            const volume = (entry?.volume ?? 0) + qty;
            this.passiveVolumeByZone.set(zone, { volume, lastUpdate: now });
        }
    }

    /**
     * Compute accumulation result for the current price.
     */
    public detectAccumulation(currentPrice: number): AccumulationResult {
        const sideKeys = this.config.trackSide ? ["buy", "sell"] : [undefined];

        let result: AccumulationResult = {
            isAccumulating: false,
            strength: 0,
            duration: 0,
            zone: 0,
            ratio: 0,
        };

        for (const side of sideKeys) {
            const zoneKey = this.getZoneKey(currentPrice, side === "buy");
            const data = this.zones.get(zoneKey);

            if (!data || data.aggressive.length === 0) continue;

            const now = Date.now();
            const duration = now - data.startTime;
            const recentAgg = data.aggressive.reduce((a, b) => a + b, 0);

            // Pull the most recent passive volume for this zone
            const passiveEntry = this.passiveVolumeByZone.get(zoneKey);
            const recentPassive = passiveEntry ? passiveEntry.volume : 0;

            const ratio = recentPassive / (recentAgg || 1);

            const isAccumulating =
                ratio > this.config.minRatio &&
                duration > this.config.minDurationMs &&
                now - data.lastUpdate < this.config.minRecentActivityMs &&
                recentAgg > this.config.minAggVolume;

            const strength = Math.min(ratio / (this.config.minRatio * 2), 1);

            if (
                isAccumulating &&
                (!result.isAccumulating || strength > result.strength)
            ) {
                result = {
                    isAccumulating,
                    strength,
                    duration,
                    zone: parseFloat(zoneKey),
                    ratio,
                };
                // Log only if logging enabled
                if (this.signalLogger) {
                    this.signalLogger.logEvent({
                        timestamp: new Date().toISOString(),
                        type: "accumulation",
                        symbol: this.symbol,
                        signalPrice: currentPrice,
                        side: side as "buy" | "sell",
                        aggressiveVolume: recentAgg,
                        passiveVolume: recentPassive,
                        zone: parseFloat(zoneKey),
                        refilled: false,
                        confirmed: false,
                        outcome: "detected",
                    });
                }
            }
        }

        return result;
    }

    public getStats(): {
        activeZones: number;
        strongestZone: number | null;
        totalAggVolume: number;
        totalPassiveVolume: number;
    } {
        let totalAggVolume = 0;
        let totalPassiveVolume = 0;
        let strongestZone: number | null = null;
        let maxStrength = 0;

        for (const [zoneKey, data] of this.zones) {
            const agg = data.aggressive.reduce((a, b) => a + b, 0);
            const passive = this.passiveVolumeByZone.get(zoneKey)?.volume ?? 0;
            const ratio = passive / (agg || 1);
            const strength = Math.min(ratio / (this.config.minRatio * 2), 1);
            totalAggVolume += agg;
            totalPassiveVolume += passive;

            if (strength > maxStrength) {
                maxStrength = strength;
                strongestZone = parseFloat(zoneKey);
            }
        }

        return {
            activeZones: this.zones.size,
            strongestZone,
            totalAggVolume,
            totalPassiveVolume,
        };
    }

    private getZoneKey(price: number, isBuy: boolean | undefined): string {
        // Compose a key with price zone and, if enabled, side
        const baseZone = (
            Math.round(price / this.config.zoneSize) * this.config.zoneSize
        ).toFixed(this.config.pricePrecision);
        if (this.config.trackSide) {
            const sideStr =
                isBuy === undefined ? "both" : isBuy ? "buy" : "sell";
            return `${baseZone}_${sideStr}`;
        }
        return baseZone;
    }

    private maybeCleanup(): void {
        const now = Date.now();
        if (now - this.lastCleanup < this.cleanupIntervalMs) return;

        const cutoff = now - this.config.windowMs;
        const toDelete: string[] = [];

        for (const [zoneKey, data] of this.zones) {
            if (data.lastUpdate < cutoff) {
                toDelete.push(zoneKey);
            }
        }
        for (const zoneKey of toDelete) {
            this.zones.delete(zoneKey);
        }

        // Prune passive volume entries as well
        const passiveCutoff = now - this.config.minRecentActivityMs * 2;
        for (const [zoneKey, entry] of this.passiveVolumeByZone) {
            if (entry.lastUpdate < passiveCutoff) {
                this.passiveVolumeByZone.delete(zoneKey);
            }
        }

        this.lastCleanup = now;
    }
}
