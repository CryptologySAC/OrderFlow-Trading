import { SpotWebsocketStreams } from "@binance/spot";

interface ConfirmationSignal {
    time: number;
    price: number;
    confirmedType: "absorption" | "exhaustion";
    reason: "delta_divergence" | "cvd_slope_reversal" | "both";
}

export class DeltaCVDConfirmation {
    private tradeHistory: {
        price: number;
        quantity: number;
        isBuyerMaker: boolean;
        time: number;
    }[] = [];
    private readonly lookback: number;
    private readonly confirmationCallback: (signal: ConfirmationSignal) => void;
    private lastCVD: number[] = [];
    private cvdLength: number;

    constructor(
        confirmationCallback: (signal: ConfirmationSignal) => void,
        lookback = 60,
        cvdLength = 10
    ) {
        this.confirmationCallback = confirmationCallback;
        this.lookback = lookback;
        this.cvdLength = cvdLength;
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
        const delta = this.calculateDelta();
        this.updateCVD(delta);

        const recentCVD = this.lastCVD.slice(-this.cvdLength);
        const slope = this.calculateSlope(recentCVD);

        const divergence =
            signalType === "absorption"
                ? delta < 0 && slope > 0
                : delta > 0 && slope < 0;

        const reason =
            divergence && Math.abs(slope) > 0.1
                ? "both"
                : divergence
                  ? "delta_divergence"
                  : Math.abs(slope) > 0.1
                    ? "cvd_slope_reversal"
                    : null;

        if (reason) {
            this.confirmationCallback({
                time: currentTime,
                price: currentPrice,
                confirmedType: signalType,
                reason,
            });
        }
    }

    private calculateDelta(): number {
        let buyVol = 0;
        let sellVol = 0;

        for (const trade of this.tradeHistory) {
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
