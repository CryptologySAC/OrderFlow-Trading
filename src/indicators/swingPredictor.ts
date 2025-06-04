// src/indicators/swingPredictor.ts

import { Signal } from "../types/signalTypes.js";

export interface SwingPrediction {
    time: number;
    price: number;
    type: "swingHigh" | "swingLow";
    sourceSignal: Signal;
}

export interface SwingPredictorConfig {
    lookaheadMs?: number; // How long to wait for confirmation
    retraceTicks?: number; // Ticks in opposite direction needed for confirmation
    pricePrecision?: number;
    signalCooldownMs?: number; // Prevent duplicate signals at same price/side
}

export class SwingPredictor {
    private readonly lookaheadMs: number;
    private readonly retraceTicks: number;
    private readonly pricePrecision: number;
    private readonly signalCooldownMs: number;
    private readonly onSwingPredicted: (p: SwingPrediction) => void;

    // Stores signal candidates with expiry and tracking direction
    private swingCandidates: Map<
        string,
        {
            signal: Signal;
            expires: number;
            initialPrice: number;
            triggered: boolean;
        }
    > = new Map();

    private lastSignalTime: Map<string, number> = new Map();

    constructor(config: SwingPredictorConfig, onSwingPredicted: (p: SwingPrediction) => void) {
        this.lookaheadMs = config.lookaheadMs ?? 60000;
        this.retraceTicks = config.retraceTicks ?? 10;
        this.pricePrecision = config.pricePrecision ?? 2;
        this.signalCooldownMs = config.signalCooldownMs ?? 300000;
        this.onSwingPredicted = onSwingPredicted;
    }

    public onSignal(signal: Signal): void {
        if (!signal.price || !signal.time || !signal.side) return;

        // Deduplication key: type+side+price (rounded)
        const priceKey = signal.price.toFixed(this.pricePrecision);
        const dedupeKey = `${signal.type}_${signal.side}_${priceKey}`;

        // Avoid duplicates
        if (this.swingCandidates.has(dedupeKey)) {
            return;
        }

        this.swingCandidates.set(dedupeKey, {
            signal,
            expires: signal.time + this.lookaheadMs,
            initialPrice: signal.price,
            triggered: false,
        });
    }

    public onPrice(price: number, time: number): void {
        for (const [key, candidate] of this.swingCandidates.entries()) {
            if (time > candidate.expires) {
                this.swingCandidates.delete(key);
                continue;
            }

            const { signal, initialPrice, triggered } = candidate;
            if (!signal.side) continue;
            const tickSize = 1 / Math.pow(10, this.pricePrecision);
            const retraceAmount = this.retraceTicks * tickSize;

            // Only consider a swing in the "expected" direction
            let swingTriggered = false;
            let swingType: "swingLow" | "swingHigh" | undefined;

            if (signal.side === "buy") {
                // Price needs to go DOWN by retraceAmount after the signal, then back UP past initialPrice
                if (!triggered && price <= initialPrice - retraceAmount) {
                    // Mark as "down-move completed"
                    candidate.triggered = true;
                }
                if (triggered && price >= initialPrice) {
                    swingType = "swingLow";
                    swingTriggered = true;
                }
            } else if (signal.side === "sell") {
                // Price needs to go UP by retraceAmount after the signal, then back DOWN past initialPrice
                if (!triggered && price >= initialPrice + retraceAmount) {
                    candidate.triggered = true;
                }
                if (triggered && price <= initialPrice) {
                    swingType = "swingHigh";
                    swingTriggered = true;
                }
            }

            if (swingTriggered && swingType) {
                // Check cooldown (per swing type and price)
                const cooldownKey = `${swingType}_${initialPrice.toFixed(this.pricePrecision)}`;
                const last = this.lastSignalTime.get(cooldownKey) ?? 0;
                if (time - last > this.signalCooldownMs) {
                    this.lastSignalTime.set(cooldownKey, time);
                    this.onSwingPredicted({
                        time,
                        price,
                        type: swingType,
                        sourceSignal: signal,
                    });
                }
                this.swingCandidates.delete(key);
            }
        }
    }
}
