/**********************************************************************
 *  AccumulationDetector
 *  Emits `"accumulation"` EventEmitter events when passive > taker flow
 *  in a price zone for longer than minDurationMs.
 *********************************************************************/

import { EventEmitter } from "events";
import { Logger } from "../infrastructure/logger.js";
import { MetricsCollector } from "../infrastructure/metricsCollector.js";
import { ISignalLogger } from "../services/signalLogger.js";
import type { EnrichedTradeEvent } from "../types/marketEvents.js";
import { RollingWindow } from "../utils/rollingWindow.js";
import { AccumulationResult } from "../types/signalTypes.js";

/* ------------------------------------------------------------------ *
 *  Settings
 * ------------------------------------------------------------------ */

export interface AccumulationSettings {
    windowMs?: number; // length of rolling window   (default 15 min)
    minDurationMs?: number; // min life of zone           (default 5 min)
    zoneSize?: number; // USDT per zone              (default 0.02)
    minRatio?: number; // passive / aggressive >     (default 1.2)
    minRecentActivityMs?: number; // trade staleness threshold  (default 60 s)
    minAggVolume?: number; // min taker qty in zone      (default 5)
    trackSide?: boolean; // separate bid/ask zones     (default true)
    pricePrecision?: number; // toFixed digits             (default 2)
}

/* ------------------------------------------------------------------ *
 *  Internal structures
 * ------------------------------------------------------------------ */

interface ZoneData {
    aggressiveQty: RollingWindow<number>;
    timestamps: RollingWindow<number>;
    startTime: number;
    lastUpdate: number;
    tradeCount: number;
    side: "buy" | "sell";
}

interface PassiveVolumeSnap {
    volume: number;
    lastUpdate: number;
}

/* ------------------------------------------------------------------ *
 *  Detector
 * ------------------------------------------------------------------ */

export class AccumulationDetector extends EventEmitter {
    private readonly zones = new Map<string, ZoneData>();
    private readonly passiveByZone = new Map<string, PassiveVolumeSnap>();

    private readonly settings: Required<AccumulationSettings>;
    private lastCleanup = Date.now();
    private readonly cleanupIntervalMs = 60_000;

    constructor(
        /** Unused – kept for signature parity with AbsorptionDetector */
        _callback: unknown,
        settings: AccumulationSettings = {},
        private readonly logger: Logger,
        private readonly metrics: MetricsCollector,
        private readonly signalLogger?: ISignalLogger
    ) {
        super();
        this.settings = {
            windowMs: settings.windowMs ?? 900_000,
            minDurationMs: settings.minDurationMs ?? 300_000,
            zoneSize: settings.zoneSize ?? 0.02,
            minRatio: settings.minRatio ?? 1.2,
            minRecentActivityMs: settings.minRecentActivityMs ?? 60_000,
            minAggVolume: settings.minAggVolume ?? 5,
            trackSide: settings.trackSide ?? true,
            pricePrecision: settings.pricePrecision ?? 2,
        };
    }

    /* -------------------------------------------------------------- *
     *  Public entry – called for every EnrichedTradeEvent
     * -------------------------------------------------------------- */
    public onEnrichedTrade(evt: EnrichedTradeEvent): void {
        try {
            this.consumeTrade(evt);
            const signal: AccumulationResult = this.detectAccumulation(
                evt.price
            );
            if (signal.isAccumulating) {
                /** Emit event for listeners (dashboard, strategy, etc.) */
                this.emit("accumulation", signal);
                this.metrics.incrementMetric("accumulationDetected");
            }
        } catch (err) {
            this.logger.error?.("[AccumulationDetector] processing error", {
                err,
            });
            this.metrics.incrementMetric("accumulationErrors");
        }
    }

    /* -------------------------------------------------------------- *
     *  In-memory aggregation
     * -------------------------------------------------------------- */
    private consumeTrade(e: EnrichedTradeEvent): void {
        const {
            price,
            quantity,
            timestamp,
            buyerIsMaker,
            zonePassiveBidVolume = 0,
            zonePassiveAskVolume = 0,
        } = e;

        const isBidSide = buyerIsMaker; // m=true ⇒ bid side liquidity hit
        const key = this.zoneKey(price, isBidSide);
        const now = Date.now();

        /* ---- ensure zone exists ---- */
        let zone = this.zones.get(key);
        if (!zone) {
            const cap = Math.ceil(this.settings.windowMs / 3_000); // ~1 trade / 3 s
            zone = {
                aggressiveQty: new RollingWindow<number>(cap, true),
                timestamps: new RollingWindow<number>(cap, true),
                startTime: timestamp,
                lastUpdate: timestamp,
                tradeCount: 0,
                side: isBidSide ? "sell" : "buy",
            };
            this.zones.set(key, zone);
        }

        /* ---- store trade ---- */
        zone.aggressiveQty.push(quantity);
        zone.timestamps.push(timestamp);
        zone.lastUpdate = timestamp;
        zone.tradeCount++;

        /* ---- overwrite passive snapshot ---- */
        const passiveVol = isBidSide
            ? zonePassiveBidVolume
            : zonePassiveAskVolume;
        this.passiveByZone.set(key, {
            volume: passiveVol,
            lastUpdate: timestamp,
        });

        /* ---- prune window by time ---- */
        this.pruneZone(zone, now);
        this.maybeCleanup(now);
    }

    /* -------------------------------------------------------------- *
     *  Detection logic for a given price
     * -------------------------------------------------------------- */
    private detectAccumulation(price: number): AccumulationResult {
        const sideKeys = this.settings.trackSide
            ? ["buy", "sell"]
            : [undefined];

        let best: AccumulationResult = {
            isAccumulating: false,
            strength: 0,
            duration: 0,
            zone: 0,
            ratio: 0,
        };

        for (const side of sideKeys) {
            const key = this.zoneKey(price, side === "buy");
            const zone = this.zones.get(key);
            if (!zone || zone.aggressiveQty.sum() === 0) continue;

            const now = Date.now();
            const duration = now - zone.startTime;
            const aggVol = zone.aggressiveQty.sum();
            const passiveVol = this.passiveByZone.get(key)?.volume ?? 0;
            const ratio = passiveVol / (aggVol || 1);

            const accumulating =
                ratio > this.settings.minRatio &&
                duration > this.settings.minDurationMs &&
                now - zone.lastUpdate < this.settings.minRecentActivityMs &&
                aggVol > this.settings.minAggVolume;

            if (!accumulating) continue;

            const strength = Math.min(ratio / (this.settings.minRatio * 2), 1);
            if (!best.isAccumulating || strength > best.strength) {
                best = {
                    isAccumulating: true,
                    strength,
                    duration,
                    zone: parseFloat(key),
                    ratio,
                };
            }
        }
        return best;
    }

    /* -------------------------------------------------------------- *
     *  Helpers
     * -------------------------------------------------------------- */
    private zoneKey(price: number, isBid: boolean | undefined): string {
        const base = (
            Math.round(price / this.settings.zoneSize) * this.settings.zoneSize
        ).toFixed(this.settings.pricePrecision);
        if (!this.settings.trackSide) return base;
        return `${base}_${isBid === undefined ? "both" : isBid ? "buy" : "sell"}`;
    }

    private pruneZone(z: ZoneData, now: number): void {
        while (
            z.timestamps.count() &&
            now - z.timestamps.toArray()[0] > this.settings.windowMs
        ) {
            /* drop oldest sample by rebuilding windows minus first element */
            const ts = z.timestamps.toArray().slice(1);
            const qty = z.aggressiveQty.toArray().slice(1);
            const cap = z.timestamps.count() || 1;

            z.timestamps = new RollingWindow<number>(cap, true);
            z.aggressiveQty = new RollingWindow<number>(cap, true);
            ts.forEach((t) => z.timestamps.push(t));
            qty.forEach((q) => z.aggressiveQty.push(q));
            z.startTime = ts.length ? ts[0] : now;
        }
    }

    private maybeCleanup(now: number): void {
        if (now - this.lastCleanup < this.cleanupIntervalMs) return;

        const cutoff = now - this.settings.windowMs;
        const passiveCut = now - this.settings.minRecentActivityMs * 2;

        for (const [k, z] of this.zones)
            if (z.lastUpdate < cutoff) this.zones.delete(k);
        for (const [k, p] of this.passiveByZone)
            if (p.lastUpdate < passiveCut) this.passiveByZone.delete(k);

        this.lastCleanup = now;
    }
}
