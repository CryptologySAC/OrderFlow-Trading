import { TradeData } from "../utils/utils.js";
import { ISignalLogger } from "../services/signalLogger.js";

export interface ZoneData {
    aggressive: number;
    passive: number;
    startTime: number;
    lastUpdate: number;
    tradeCount: number;
}

export interface AccumulationResult {
    isAccumulating: boolean;
    strength: number;
    duration: number;
    zone: number;
    ratio: number;
}

export class AccumulationDetector {
    private readonly zones = new Map<number, ZoneData>();
    private readonly windowMs = 900000; // 15 minutes
    private readonly minDurationMs = 300000; // 5 minutes
    private readonly zoneSize = 0.02; // USDT
    private readonly cleanupIntervalMs = 60000;
    private lastCleanup = Date.now();

    constructor(
        private readonly logger?: ISignalLogger,
        private readonly symbol = "LTCUSDT"
    ) {}

    public addTrade(trade: TradeData, passiveVolume: number): void {
        const zone = Math.round(trade.price / this.zoneSize) * this.zoneSize;
        const existing = this.zones.get(zone);

        if (existing) {
            existing.aggressive += trade.quantity;
            existing.passive = passiveVolume;
            existing.lastUpdate = trade.timestamp;
            existing.tradeCount++;
        } else {
            this.zones.set(zone, {
                aggressive: trade.quantity,
                passive: passiveVolume,
                startTime: trade.timestamp,
                lastUpdate: trade.timestamp,
                tradeCount: 1,
            });
        }

        this.maybeCleanup();
    }

    public detectAccumulation(currentPrice: number): AccumulationResult {
        const zone = Math.round(currentPrice / this.zoneSize) * this.zoneSize;
        const data = this.zones.get(zone);

        if (!data) {
            return {
                isAccumulating: false,
                strength: 0,
                duration: 0,
                zone,
                ratio: 0,
            };
        }

        const now = Date.now();
        const duration = now - data.startTime;
        const ratio = data.passive / (data.aggressive || 1);

        // Accumulation criteria:
        // 1. More passive than aggressive (absorption happening)
        // 2. Sufficient duration
        // 3. Recent activity
        const isAccumulating =
            ratio > 1.2 &&
            duration > this.minDurationMs &&
            now - data.lastUpdate < 60000; // Last trade within 1 minute

        const strength = Math.min(ratio / 3, 1);

        const result: AccumulationResult = {
            isAccumulating,
            strength,
            duration,
            zone,
            ratio,
        };

        if (isAccumulating && this.logger) {
            this.logger.logEvent({
                timestamp: new Date().toISOString(),
                type: "accumulation",
                symbol: this.symbol,
                signalPrice: currentPrice,
                side: "buy",
                aggressiveVolume: data.aggressive,
                passiveVolume: data.passive,
                zone,
                refilled: false,
                confirmed: false,
                outcome: "detected",
            });
        }

        return result;
    }

    public getStats(): {
        activeZones: number;
        totalVolume: number;
        strongestZone: number | null;
    } {
        let totalVolume = 0;
        let strongestZone: number | null = null;
        let maxRatio = 0;

        for (const [zone, data] of this.zones) {
            totalVolume += data.aggressive + data.passive;
            const ratio = data.passive / (data.aggressive || 1);
            if (ratio > maxRatio) {
                maxRatio = ratio;
                strongestZone = zone;
            }
        }

        return {
            activeZones: this.zones.size,
            totalVolume,
            strongestZone,
        };
    }

    private maybeCleanup(): void {
        const now = Date.now();
        if (now - this.lastCleanup < this.cleanupIntervalMs) return;

        const cutoff = now - this.windowMs;
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
