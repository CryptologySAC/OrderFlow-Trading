import { SpotWebsocketStreams } from "@binance/spot";

interface ConfirmationSignal {
    time: number;
    price: number;
    confirmedType: "absorption" | "exhaustion";
    reason: "delta_divergence" | "cvd_slope_reversal" | "both";
    delta: number;
    slope: number;
}

export interface DeltaCVDConfig {
    lookback?: number; // seconds for window (default 60)
    cvdLength?: number; // bars to measure slope (default 10)
    slopeThreshold?: number; // minimal slope for reversal (default 0.1)
    deltaThreshold?: number; // minimal delta for divergence (default 0.1)
}

export class DeltaCVDConfirmation {
    private tradeHistory: {
        price: number;
        quantity: number;
        isBuyerMaker: boolean;
        time: number;
    }[] = [];
    private lastCVD: number[] = [];
    private readonly lookback: number;
    private readonly cvdLength: number;
    private readonly slopeThreshold: number;
    private readonly deltaThreshold: number;
    private readonly confirmationCallback: (signal: ConfirmationSignal) => void;

    constructor(
        confirmationCallback: (signal: ConfirmationSignal) => void,
        config: DeltaCVDConfig = {}
    ) {
        this.confirmationCallback = confirmationCallback;
        this.lookback = config.lookback ?? 60; // seconds
        this.cvdLength = config.cvdLength ?? 10;
        this.slopeThreshold = config.slopeThreshold ?? 0.1;
        this.deltaThreshold = config.deltaThreshold ?? 0.1;
    }

    public addTrade(trade: SpotWebsocketStreams.AggTradeResponse) {
        const quantity = parseFloat(trade.q ?? "0");
        const price = parseFloat(trade.p ?? "0");
        const isBuyerMaker = !!trade.m;
        const time = trade.T ?? Date.now();

        this.tradeHistory.push({ price, quantity, isBuyerMaker, time });

        // Clean up old trades
        const cutoff = time - this.lookback * 1000;
        this.tradeHistory = this.tradeHistory.filter((t) => t.time >= cutoff);
    }

    public confirmSignal(
        signalType: "absorption" | "exhaustion",
        currentPrice: number,
        currentTime: number
    ) {
        // Calculate delta only for recent lookback window
        const windowTrades = this.tradeHistory.filter(
            (t) => currentTime - t.time <= this.lookback * 1000
        );
        const delta = this.calculateDelta(windowTrades);
        this.updateCVD(delta);

        const recentCVD = this.lastCVD.slice(-this.cvdLength);
        const slope = this.calculateSlope(recentCVD);

        // If absorption: expect delta negative (selling dominates), but CVD rises (buying pressure)
        // If exhaustion: expect delta positive (buying dominates), but CVD falls (selling pressure)
        let divergence = false;
        if (signalType === "absorption") {
            divergence =
                delta < -this.deltaThreshold && slope > this.slopeThreshold;
        } else {
            divergence =
                delta > this.deltaThreshold && slope < -this.slopeThreshold;
        }

        const hasSlope = Math.abs(slope) > this.slopeThreshold;

        let reason: ConfirmationSignal["reason"] | null = null;
        if (divergence && hasSlope) {
            reason = "both";
        } else if (divergence) {
            reason = "delta_divergence";
        } else if (hasSlope) {
            reason = "cvd_slope_reversal";
        }

        if (reason) {
            this.confirmationCallback({
                time: currentTime,
                price: currentPrice,
                confirmedType: signalType,
                reason,
                delta,
                slope,
            });
        }
    }

    private calculateDelta(trades: typeof this.tradeHistory): number {
        let buyVol = 0;
        let sellVol = 0;
        for (const trade of trades) {
            if (trade.isBuyerMaker) {
                sellVol += trade.quantity;
            } else {
                buyVol += trade.quantity;
            }
        }
        return buyVol - sellVol;
    }

    private updateCVD(delta: number): void {
        const prevCVD =
            this.lastCVD.length > 0 ? this.lastCVD[this.lastCVD.length - 1] : 0;
        const newCVD = prevCVD + delta;
        this.lastCVD.push(newCVD);
        if (this.lastCVD.length > 1000) this.lastCVD.shift(); // Keep it bounded
    }

    private calculateSlope(values: number[]): number {
        const n = values.length;
        if (n < 2) return 0;

        const sumX = (n * (n - 1)) / 2;
        const sumX2 = ((n - 1) * n * (2 * n - 1)) / 6;
        const sumY = values.reduce((a, b) => a + b, 0);
        const sumXY = values.reduce((sum, y, i) => sum + i * y, 0);

        const numerator = n * sumXY - sumX * sumY;
        const denominator = n * sumX2 - sumX * sumX;

        return denominator !== 0 ? numerator / denominator : 0;
    }
}

// Add to deltaCVDConfirmation.ts
export class SwingMomentumDivergence {
    private priceMA: number[] = [];
    private volumeMA: number[] = [];
    private readonly periods = 30; // 30 x 30s = 15 minutes

    addDataPoint(price: number, volume: number): void {
        this.priceMA.push(price);
        this.volumeMA.push(volume);

        if (this.priceMA.length > this.periods) {
            this.priceMA.shift();
            this.volumeMA.shift();
        }
    }

    detectDivergence(): {
        type: "bullish" | "bearish" | "none";
        strength: number;
    } {
        if (this.priceMA.length < this.periods) {
            return { type: "none", strength: 0 };
        }

        // Calculate slopes
        const priceSlope = this.calculateSlope(this.priceMA);
        const volumeSlope = this.calculateSlope(this.volumeMA);

        // Divergence: price and volume moving opposite
        if (priceSlope < -0.001 && volumeSlope > 0.001) {
            // Price down, volume up = bullish divergence
            return {
                type: "bullish",
                strength: Math.abs(volumeSlope - priceSlope),
            };
        } else if (priceSlope > 0.001 && volumeSlope < -0.001) {
            // Price up, volume down = bearish divergence
            return {
                type: "bearish",
                strength: Math.abs(priceSlope - volumeSlope),
            };
        }

        return { type: "none", strength: 0 };
    }

    private calculateSlope(values: number[]): number {
        // Linear regression slope
        const n = values.length;
        const sumX = (n * (n - 1)) / 2;
        const sumY = values.reduce((a, b) => a + b, 0);
        const sumXY = values.reduce((sum, y, i) => sum + i * y, 0);
        const sumX2 = (n * (n - 1) * (2 * n - 1)) / 6;

        return (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
    }
}
