import type { ProcessedSignal, SignalCandidate } from "../types/signalTypes.js";
import type { ISignalLogger, SignalEvent } from "../services/signalLogger.js";
import { ThreadManager } from "./threadManager.js";

export class WorkerSignalLogger implements ISignalLogger {
    constructor(private readonly manager: ThreadManager) {}

    public logEvent(event: SignalEvent): void {
        this.manager.logSignal(event);
    }

    public logProcessedSignal(
        signal: ProcessedSignal,
        metadata: Record<string, unknown>
    ): void {
        this.manager.log("info", "Signal processed", { signal, metadata });
    }

    public logProcessingError(
        candidate: SignalCandidate,
        error: Error,
        metadata: Record<string, unknown>
    ): void {
        this.manager.log("error", "Signal processing error", {
            candidate,
            error,
            metadata,
        });
    }
}
