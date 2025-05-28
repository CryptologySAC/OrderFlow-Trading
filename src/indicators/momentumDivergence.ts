import { CircularBuffer } from "../utils/utils.js";

export interface DivergenceResult {
    type: "bullish" | "bearish" | "none";
    strength: number;
    priceSlope: number;
    volumeSlope: number;
}

export interface DataPoint {
    price: number;
    volume: number;
    timestamp: number;
}

export class MomentumDivergence {
    private readonly dataPoints: CircularBuffer<DataPoint>;
    private readonly sampleIntervalMs = 30000; // 30 seconds
    private readonly minDataPoints = 30; // 15 minutes worth
    private lastSampleTime = 0;

    constructor(
        private readonly lookbackPeriods = 30,
        private readonly slopeThreshold = 0.001
    ) {
        this.dataPoints = new CircularBuffer<DataPoint>(
            this.lookbackPeriods * 2
        );
    }

    public addDataPoint(
        price: number,
        volume: number,
        timestamp: number
    ): void {
        // Sample at intervals to avoid noise
        if (timestamp - this.lastSampleTime < this.sampleIntervalMs) {
            return;
        }

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

        // Use only recent points for calculation
        const recentPoints = points.slice(-this.lookbackPeriods);
        const prices = recentPoints.map((p) => p.price);
        const volumes = recentPoints.map((p) => p.volume);

        const priceSlope = this.calculateSlope(prices);
        const volumeSlope = this.calculateSlope(volumes);

        // Normalize slopes to percentage change
        const avgPrice = prices.reduce((a, b) => a + b, 0) / prices.length;
        const normalizedPriceSlope = priceSlope / avgPrice;

        let divergenceType: "bullish" | "bearish" | "none" = "none";
        let strength = 0;

        if (
            normalizedPriceSlope < -this.slopeThreshold &&
            volumeSlope > this.slopeThreshold
        ) {
            // Price falling, volume rising = bullish divergence
            divergenceType = "bullish";
            strength = Math.abs(normalizedPriceSlope) + Math.abs(volumeSlope);
        } else if (
            normalizedPriceSlope > this.slopeThreshold &&
            volumeSlope < -this.slopeThreshold
        ) {
            // Price rising, volume falling = bearish divergence
            divergenceType = "bearish";
            strength = Math.abs(normalizedPriceSlope) + Math.abs(volumeSlope);
        }

        return {
            type: divergenceType,
            strength: Math.min(strength * 100, 1), // Normalize to 0-1
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

        // Use indices as X values (0, 1, 2, ...)
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
