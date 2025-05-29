// src/services/signalCoordinator.ts

import { EventEmitter } from "events";
import {
    PendingSignal,
    ConfirmedSignal,
    SignalCoordination,
    TimeContext,
} from "../utils/types.js";
import { ISignalLogger } from "./signalLogger.js";

export interface SignalCoordinatorConfig {
    requiredConfirmations: number;
    confirmationWindowMs: number;
    deduplicationWindowMs: number;
    signalExpiryMs: number;
}

export class SignalCoordinator extends EventEmitter {
    private state: SignalCoordination = {
        pendingSignals: new Map(),
        confirmedSignals: new Map(),
        lastProcessedTime: 0,
    };

    private readonly deduplicationCache = new Map<string, number>();

    constructor(
        private readonly config: SignalCoordinatorConfig,
        private readonly logger?: ISignalLogger,
        private readonly timeContext: TimeContext = {
            wallTime: Date.now(),
            marketTime: Date.now(),
            mode: "realtime",
            speed: 1,
        }
    ) {
        super();
        this.startCleanupInterval();
    }

    /**
     * Submit a signal for coordination and deduplication
     */
    public submitSignal(
        type: "absorption" | "exhaustion" | "swing",
        price: number,
        detectorName: string,
        metadata: Record<string, unknown> = {}
    ): string | null {
        const now = this.getCurrentTime();

        // Check for duplicate
        const dedupeKey = `${type}-${Math.round(price * 100)}-${detectorName}`;
        const lastSeen = this.deduplicationCache.get(dedupeKey);

        if (lastSeen && now - lastSeen < this.config.deduplicationWindowMs) {
            console.log(
                `[SignalCoordinator] Duplicate signal rejected: ${dedupeKey}`
            );
            return null;
        }

        // Find existing pending signal or create new
        const signalId = this.findOrCreatePendingSignal(type, price, now);
        const signal = this.state.pendingSignals.get(signalId)!;

        // Add confirmation
        signal.confirmations.add(detectorName);
        signal.metadata[detectorName] = metadata;

        // Update deduplication cache
        this.deduplicationCache.set(dedupeKey, now);

        // Check if confirmed
        if (signal.confirmations.size >= signal.requiredConfirmations) {
            this.confirmSignal(signal);
        }

        return signalId;
    }

    /**
     * Find existing pending signal within price tolerance
     */
    private findOrCreatePendingSignal(
        type: "absorption" | "exhaustion" | "swing",
        price: number,
        timestamp: number
    ): string {
        const priceTolerance = 0.001; // 0.1%

        for (const [id, signal] of this.state.pendingSignals) {
            if (
                signal.type === type &&
                Math.abs(signal.price - price) / price < priceTolerance &&
                timestamp - signal.timestamp < this.config.confirmationWindowMs
            ) {
                return id;
            }
        }

        // Create new pending signal
        const id = `${type}-${timestamp}-${Math.random().toString(36).substr(2, 9)}`;
        const signal: PendingSignal = {
            id,
            type,
            price,
            timestamp,
            confirmations: new Set(),
            requiredConfirmations: this.config.requiredConfirmations,
            expiresAt: timestamp + this.config.signalExpiryMs,
            metadata: {},
        };

        this.state.pendingSignals.set(id, signal);
        return id;
    }

    /**
     * Confirm a signal and emit event
     */
    private confirmSignal(signal: PendingSignal): void {
        console.info("[SignalCoordinator] Signal confirmed", {
            id: signal.id,
            price: signal.price,
        });

        const confirmed: ConfirmedSignal = {
            id: signal.id,
            originalSignals: [signal],
            finalPrice: signal.price,
            confirmedAt: this.getCurrentTime(),
            confidence: signal.confirmations.size / 3, // Normalize to 0-1
            executed: false,
        };

        this.state.confirmedSignals.set(signal.id, confirmed);
        this.state.pendingSignals.delete(signal.id);

        // Log confirmation
        if (this.logger) {
            this.logger.logEvent({
                timestamp: new Date().toISOString(),
                type: "signal_confirmed",
                symbol: "LTCUSDT",
                signalPrice: confirmed.finalPrice,
                side: signal.type === "exhaustion" ? "sell" : "buy",
                aggressiveVolume: 0,
                passiveVolume: null,
                zone: 0,
                refilled: false,
                confirmed: true,
                confirmationTime: new Date(confirmed.confirmedAt).toISOString(),
                entryRecommended: true,
            });
        }

        this.emit("signal_confirmed", confirmed);
    }

    /**
     * Get current time based on mode
     */
    private getCurrentTime(): number {
        return this.timeContext.mode === "realtime"
            ? Date.now()
            : this.timeContext.marketTime;
    }

    /**
     * Cleanup expired signals
     */
    private startCleanupInterval(): void {
        setInterval(() => {
            const now = this.getCurrentTime();

            // Clean pending signals
            for (const [id, signal] of this.state.pendingSignals) {
                if (now > signal.expiresAt) {
                    this.state.pendingSignals.delete(id);
                }
            }

            // Clean deduplication cache
            const cutoff = now - this.config.deduplicationWindowMs * 2;
            for (const [key, time] of this.deduplicationCache) {
                if (time < cutoff) {
                    this.deduplicationCache.delete(key);
                }
            }
        }, 10000); // Every 10 seconds
    }

    /**
     * Get state snapshot for persistence
     */
    public getSnapshot(): SignalCoordination {
        return {
            pendingSignals: new Map(this.state.pendingSignals),
            confirmedSignals: new Map(this.state.confirmedSignals),
            lastProcessedTime: this.state.lastProcessedTime,
        };
    }

    /**
     * Restore from snapshot
     */
    public restoreSnapshot(snapshot: SignalCoordination): void {
        this.state = {
            pendingSignals: new Map(snapshot.pendingSignals),
            confirmedSignals: new Map(snapshot.confirmedSignals),
            lastProcessedTime: snapshot.lastProcessedTime,
        };
    }
}
