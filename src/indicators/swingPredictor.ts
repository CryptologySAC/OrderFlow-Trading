import { Signal } from "../types/signalTypes.js";

export interface SwingPrediction {
    time: number;
    price: number;
    type: "swingHigh" | "swingLow";
    sourceSignal: Signal;
}

interface SwingPredictorConfig {
    lookaheadMs?: number; // how long to wait for confirmation
    retraceTicks?: number; // how many ticks opposite needed to confirm swing
    pricePrecision?: number;
    signalCooldownMs?: number; // prevent duplicate predictions
    onSwingPredicted: (prediction: SwingPrediction) => void;
}

export class SwingPredictor {
    private readonly lookaheadMs: number;
    private readonly retraceTicks: number;
    private readonly pricePrecision: number;
    private readonly signalCooldownMs: number;
    private readonly onSwingPredicted: (p: SwingPrediction) => void;

    private lastSignalTime: Map<string, number> = new Map();
    private swingCandidates: Map<string, { signal: Signal; expires: number }> =
        new Map();

    constructor(config: SwingPredictorConfig) {
        this.lookaheadMs = config.lookaheadMs ?? 900000;
        this.retraceTicks = config.retraceTicks ?? 50;
        this.pricePrecision = config.pricePrecision ?? 2;
        this.signalCooldownMs = config.signalCooldownMs ?? 300000;
        this.onSwingPredicted = config.onSwingPredicted;
    }

    public onSignal(signal: Signal) {
        const key = `${signal.type}_${signal.time}`;
        console.log("[SwingPredictor] Signal received:", signal, "key:", key);
        this.swingCandidates.set(key, {
            signal,
            expires: signal.time + this.lookaheadMs,
        });
    }

    public onPrice(price: number, time: number) {
        for (const [key, candidate] of this.swingCandidates.entries()) {
            if (time > candidate.expires) {
                this.swingCandidates.delete(key);
                continue;
            }

            console.log(
                "[SwingPredictor] Processing candidate:",
                candidate.signal,
                "current price:",
                price,
                "time:",
                time
            );

            const { signal } = candidate;
            const roundedPrice = +price.toFixed(this.pricePrecision);
            const signalPrice = +signal.price.toFixed(this.pricePrecision);
            const tickSize = 1 / Math.pow(10, this.pricePrecision);

            const isLong =
                signal.type === "absorption_confirmed" ||
                (signal.type === "exhaustion_confirmed" &&
                    signal.price < price);
            const threshold = this.retraceTicks * tickSize;
            const triggered = isLong
                ? roundedPrice <= signalPrice - threshold
                : roundedPrice >= signalPrice + threshold;

            if (triggered) {
                const swingType = isLong ? "swingLow" : "swingHigh";
                const cooldownKey = `${swingType}_${signal.price}`;
                const last = this.lastSignalTime.get(cooldownKey) ?? 0;

                if (time - last > this.signalCooldownMs) {
                    this.lastSignalTime.set(cooldownKey, time);
                    this.onSwingPredicted({
                        time,
                        price,
                        type: swingType,
                        sourceSignal: signal,
                    });
                    this.swingCandidates.delete(key);
                }
            }
        }
    }
}
