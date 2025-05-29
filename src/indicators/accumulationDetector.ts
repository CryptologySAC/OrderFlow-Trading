// src/indicators/accumulationDetector.ts

import { TradeData } from "../utils/utils.js";
import { ISignalLogger } from "../services/signalLogger.js";
import { AccumulationResult } from "../types/signalTypes.js";

export interface AccumulationDetectorConfig {
    windowMs?: number; // Rolling window for aggregation (default: 15 min)
    minDurationMs?: number; // Min duration for an accumulation zone (default: 5 min)
    zoneSize?: number; // USDT per zone (default: 0.02)
    minRatio?: number; // Min passive/aggressive ratio to trigger (default: 1.2)
    minRecentActivityMs?: number; // Max ms since last trade (default: 1 min)
    minAggVolume?: number; // Minimum aggressive volume (default: 5)
    trackSide?: boolean; // Track buy/sell accumulation separately
}

export interface ZoneData {
    aggressive: number[];
    passive: number[];
    times: number[];
    startTime: number;
    lastUpdate: number;
    tradeCount: number;
    side: "buy" | "sell";
}

export class AccumulationDetector {
    private readonly zones = new Map<number, ZoneData>();
    private readonly cfg: Required<AccumulationDetectorConfig>;
    private readonly cleanupIntervalMs = 60000;
    private lastCleanup = Date.now();

    constructor(
        private readonly logger?: ISignalLogger,
        private readonly symbol = "LTCUSDT",
        config: AccumulationDetectorConfig = {}
    ) {
        this.cfg = {
            windowMs: config.windowMs ?? 900_000,
            minDurationMs: config.minDurationMs ?? 300_000,
            zoneSize: config.zoneSize ?? 0.02,
            minRatio: config.minRatio ?? 1.2,
            minRecentActivityMs: config.minRecentActivityMs ?? 60_000,
            minAggVolume: config.minAggVolume ?? 5,
            trackSide: config.trackSide ?? true,
        };
    }

    public addTrade(trade: TradeData, passiveVolume: number): void {
        const zone =
            Math.round(trade.price / this.cfg.zoneSize) * this.cfg.zoneSize;
        const side: "buy" | "sell" = trade.isMakerSell ? "buy" : "sell"; // Adjust as needed!

        let zoneKey = zone;
        if (this.cfg.trackSide) {
            // If tracking sides, combine zone and side
            zoneKey = parseFloat(`${zone}.${side === "buy" ? 1 : 2}`);
        }

        let data = this.zones.get(zoneKey);
        const now = Date.now();

        if (!data) {
            data = {
                aggressive: [],
                passive: [],
                times: [],
                startTime: trade.timestamp,
                lastUpdate: trade.timestamp,
                tradeCount: 0,
                side,
            };
            this.zones.set(zoneKey, data);
        }

        data.aggressive.push(trade.quantity);
        data.passive.push(passiveVolume);
        data.times.push(trade.timestamp);
        data.lastUpdate = trade.timestamp;
        data.tradeCount++;

        // Remove old data from rolling window
        while (data.times.length && now - data.times[0] > this.cfg.windowMs) {
            data.aggressive.shift();
            data.passive.shift();
            data.times.shift();
        }

        this.maybeCleanup();
    }

    public detectAccumulation(currentPrice: number): AccumulationResult {
        // Detect for both buy and sell
        const sideKeys = this.cfg.trackSide ? ["buy", "sell"] : [undefined];

        let result: AccumulationResult = {
            isAccumulating: false,
            strength: 0,
            duration: 0,
            zone: 0,
            ratio: 0,
        };

        for (const side of sideKeys) {
            const zone =
                Math.round(currentPrice / this.cfg.zoneSize) *
                this.cfg.zoneSize;
            const zoneKey = this.cfg.trackSide
                ? parseFloat(`${zone}.${side === "buy" ? 1 : 2}`)
                : zone;
            const data = this.zones.get(zoneKey);

            if (!data || data.aggressive.length === 0) continue;

            const now = Date.now();
            const duration = now - data.startTime;
            const recentAgg = data.aggressive.reduce((a, b) => a + b, 0);
            const recentPassive = data.passive.reduce((a, b) => a + b, 0);

            const ratio = recentPassive / (recentAgg || 1);

            const isAccumulating =
                ratio > this.cfg.minRatio &&
                duration > this.cfg.minDurationMs &&
                now - data.lastUpdate < this.cfg.minRecentActivityMs &&
                recentAgg > this.cfg.minAggVolume;

            const strength = Math.min(ratio / (this.cfg.minRatio * 2), 1);

            if (
                isAccumulating &&
                (!result.isAccumulating || strength > result.strength)
            ) {
                result = {
                    isAccumulating,
                    strength,
                    duration,
                    zone,
                    ratio,
                };
                if (this.logger) {
                    this.logger.logEvent({
                        timestamp: new Date().toISOString(),
                        type: "accumulation",
                        symbol: this.symbol,
                        signalPrice: currentPrice,
                        side: side as "buy" | "sell",
                        aggressiveVolume: recentAgg,
                        passiveVolume: recentPassive,
                        zone,
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

        for (const [zone, data] of this.zones) {
            const agg = data.aggressive.reduce((a, b) => a + b, 0);
            const passive = data.passive.reduce((a, b) => a + b, 0);
            const ratio = passive / (agg || 1);
            const strength = Math.min(ratio / (this.cfg.minRatio * 2), 1);
            totalAggVolume += agg;
            totalPassiveVolume += passive;

            if (strength > maxStrength) {
                maxStrength = strength;
                strongestZone = zone;
            }
        }

        return {
            activeZones: this.zones.size,
            strongestZone,
            totalAggVolume,
            totalPassiveVolume,
        };
    }

    private maybeCleanup(): void {
        const now = Date.now();
        if (now - this.lastCleanup < this.cleanupIntervalMs) return;

        const cutoff = now - this.cfg.windowMs;
        const toDelete: number[] = [];

        for (const [zone, data] of this.zones) {
            if (data.lastUpdate < cutoff) {
                toDelete.push(zone);
            }
        }
        for (const zone of toDelete) {
            this.zones.delete(zone);
        }
        this.lastCleanup = now;
    }
}
