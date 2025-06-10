import * as fs from "fs";
import * as path from "path";
import type { ProcessedSignal, SignalCandidate } from "../types/signalTypes.js";
import { Logger } from "../infrastructure/logger.js";

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

export class SignalLogger implements ISignalLogger {
    private readonly logger: Logger | null;
    private file: string;
    private headerWritten = false;

    constructor(filename: string, logger: Logger) {
        this.file = path.resolve(filename);
        if (!fs.existsSync(this.file)) {
            this.headerWritten = false;
        } else {
            this.headerWritten = true;
        }

        this.logger = logger;
    }

    // Implement the interface method (same as logEvent)
    logEvent(event: SignalEvent) {
        const header = Object.keys(event).join(",") + "\n";
        const row =
            Object.values(event)
                .map((v) => (v === undefined ? "" : `"${v}"`))
                .join(",") + "\n";

        if (!this.headerWritten) {
            fs.appendFileSync(this.file, header);
            this.headerWritten = true;
        }
        fs.appendFileSync(this.file, row);
    }

    /**
     * Log processed signal
     */
    public logProcessedSignal(
        signal: ProcessedSignal,
        metadata: Record<string, unknown>
    ): void {
        if (this.logger) {
            this.logger.info("Signal processed", {
                component: "SignalLogger",
                operation: "logProcessedSignal",
                signalId: signal.id,
                signalType: signal.type,
                detectorId: signal.detectorId,
                confidence: signal.confidence,
                ...metadata,
            });
        }
    }

    /**
     * Log processing error
     */
    public logProcessingError(
        candidate: SignalCandidate,
        error: Error,
        metadata: Record<string, unknown>
    ): void {
        if (this.logger) {
            this.logger.error("Signal processing error", {
                component: "SignalLogger",
                operation: "logProcessingError",
                candidateId: candidate.id,
                candidateType: candidate.type,
                error: error.message,
                stack: error.stack,
                ...metadata,
            });
        }
    }
}
