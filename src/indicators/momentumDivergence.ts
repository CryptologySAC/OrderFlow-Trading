import { CircularBuffer } from "../utils/utils.js";
import { DivergenceResult } from "../types/signalTypes.js";

export interface DataPoint {
    price: number;
    volume: number; // Consider: use buy-sell delta
    timestamp: number;
}

export interface MomentumDivergenceConfig {
    lookbackPeriods?: number;
    sampleIntervalMs?: number;
    minDataPoints?: number;
    slopeThreshold?: number;
    logDetections?: boolean;
    useDeltaVolume?: boolean; // If true, expect volume as net (buy-sell)
}

export class MomentumDivergence {
    private readonly dataPoints: CircularBuffer<DataPoint>;
    private readonly lookbackPeriods: number;
    private readonly sampleIntervalMs: number;
    private readonly minDataPoints: number;
    private readonly slopeThreshold: number;
    private readonly logDetections: boolean;
    private readonly useDeltaVolume: boolean;
    private lastSampleTime = 0;

    constructor(config: MomentumDivergenceConfig = {}) {
        this.lookbackPeriods = config.lookbackPeriods ?? 30;
        this.sampleIntervalMs = config.sampleIntervalMs ?? 30_000;
        this.minDataPoints = config.minDataPoints ?? 30;
        this.slopeThreshold = config.slopeThreshold ?? 0.001;
        this.logDetections = config.logDetections ?? false;
        this.useDeltaVolume = config.useDeltaVolume ?? false;
        this.dataPoints = new CircularBuffer<DataPoint>(
            this.lookbackPeriods * 2
        );
    }

    public addDataPoint(
        price: number,
        volume: number,
        timestamp: number
    ): void {
        if (timestamp - this.lastSampleTime < this.sampleIntervalMs) return;

        // Could optionally filter by volume direction here if useDeltaVolume = true
        this.dataPoints.add({ price, volume, timestamp });
        this.lastSampleTime = timestamp;
    }

    public detectDivergence(): DivergenceResult {
        const points = this.dataPoints.getAll();
        if (points.length < this.minDataPoints) {
            return {
                type: "none",
                strength: 0,
                priceSlope: 0,
                volumeSlope: 0,
            };
        }

        // Remove outliers/gaps
        const filtered = points.filter(
            (p, i, arr) =>
                i === 0 ||
                p.timestamp - arr[i - 1].timestamp < this.sampleIntervalMs * 2
        );
        const recent = filtered.slice(-this.lookbackPeriods);
        const prices = recent.map((p) => p.price);
        const volumes = recent.map((p) => p.volume);

        const priceSlope = this.calculateSlope(prices);
        const volumeSlope = this.calculateSlope(volumes);

        // Normalize price slope by price volatility (e.g., std dev)
        const avgPrice = prices.reduce((a, b) => a + b, 0) / prices.length;
        const priceStd =
            Math.sqrt(
                prices.reduce(
                    (acc, val) => acc + Math.pow(val - avgPrice, 2),
                    0
                ) / prices.length
            ) || 1;

        const normalizedPriceSlope = priceSlope / priceStd;

        let divergenceType: "bullish" | "bearish" | "none" = "none";
        let strength = 0;

        if (
            normalizedPriceSlope < -this.slopeThreshold &&
            volumeSlope > this.slopeThreshold
        ) {
            divergenceType = "bullish";
            strength =
                (Math.abs(normalizedPriceSlope) + Math.abs(volumeSlope)) / 2;
        } else if (
            normalizedPriceSlope > this.slopeThreshold &&
            volumeSlope < -this.slopeThreshold
        ) {
            divergenceType = "bearish";
            strength =
                (Math.abs(normalizedPriceSlope) + Math.abs(volumeSlope)) / 2;
        }

        if (this.logDetections && divergenceType !== "none") {
            console.log("[MomentumDivergence] Detected:", {
                divergenceType,
                strength,
                normalizedPriceSlope,
                volumeSlope,
                avgPrice,
                priceStd,
            });
        }

        return {
            type: divergenceType,
            strength: Math.max(0, Math.min(strength, 1)), // Clamp 0-1
            priceSlope: normalizedPriceSlope,
            volumeSlope,
        };
    }

    public getStats(): {
        dataPoints: number;
        oldestTimestamp: number | null;
        newestTimestamp: number | null;
    } {
        const points = this.dataPoints.getAll();
        return {
            dataPoints: points.length,
            oldestTimestamp: points[0]?.timestamp || null,
            newestTimestamp: points[points.length - 1]?.timestamp || null,
        };
    }

    private calculateSlope(values: number[]): number {
        const n = values.length;
        if (n < 2) return 0;

        let sumX = 0;
        let sumY = 0;
        let sumXY = 0;
        let sumX2 = 0;

        for (let i = 0; i < n; i++) {
            sumX += i;
            sumY += values[i];
            sumXY += i * values[i];
            sumX2 += i * i;
        }

        const denominator = n * sumX2 - sumX * sumX;
        if (denominator === 0) return 0;

        return (n * sumXY - sumX * sumY) / denominator;
    }
}
