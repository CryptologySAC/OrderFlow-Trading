import type { ProcessedSignal, SignalCandidate } from "../types/signalTypes.ts";

export interface ISignalLogger {
    logEvent(event: SignalEvent): void;
    logProcessedSignal?(
        signal: ProcessedSignal,
        metadata: Record<string, unknown>
    ): void;
    logProcessingError?(
        candidate: SignalCandidate,
        error: Error,
        metadata: Record<string, unknown>
    ): void;
}

export interface SignalEvent {
    timestamp: string;
    type: string; // "absorption" | "exhaustion" | ...
    symbol?: string;
    signalPrice: number;
    side: "buy" | "sell";
    aggressiveVolume?: number;
    passiveVolume?: number | null;
    zone?: number;
    refilled?: boolean;
    confirmed?: boolean;
    confirmationTime?: string;
    moveSizeTicks?: number;
    moveTimeMs?: number;
    entryRecommended?: boolean;
    entryPrice?: number;
    invalidationTime?: string;
    invalidationReason?: string;
    outcome?: string;
    rateOfChange?: number;
    windowVolume?: number;
    direction?: "up" | "down";
    windowTrades?: number;
    triggerType?: "absorption" | "exhaustion";
    metadata?: Record<string, unknown>;
}
