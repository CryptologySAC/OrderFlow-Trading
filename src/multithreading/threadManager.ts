import { Worker } from "worker_threads";

import type { SignalEvent } from "../services/signalLogger.js";
import type { WebSocketMessage } from "../utils/interfaces.js";

interface MetricsMessage {
    type: "metrics";
    data: unknown;
}

function isMetricsMessage(msg: unknown): msg is MetricsMessage {
    return (
        typeof msg === "object" &&
        msg !== null &&
        (msg as { type?: unknown }).type === "metrics"
    );
}

export class ThreadManager {
    private readonly loggerWorker: Worker;
    private readonly binanceWorker: Worker;
    private readonly commWorker: Worker;

    constructor() {
        this.loggerWorker = new Worker(
            new URL("./workers/loggerWorker.js", import.meta.url)
        );
        this.binanceWorker = new Worker(
            new URL("./workers/binanceWorker.js", import.meta.url)
        );
        this.commWorker = new Worker(
            new URL("./workers/communicationWorker.js", import.meta.url)
        );

        // Forward metrics from binance worker to communication worker
        this.binanceWorker.on("message", (msg: unknown) => {
            if (isMetricsMessage(msg)) {
                this.commWorker.postMessage(msg);
            }
        });
    }

    public startBinance(): void {
        this.binanceWorker.postMessage({ type: "start" });
    }

    public log(
        level: "info" | "error" | "warn" | "debug",
        message: string,
        context?: Record<string, unknown>,
        correlationId?: string
    ): void {
        this.loggerWorker.postMessage({
            type: "log",
            level,
            message,
            context,
            correlationId,
        });
    }

    public logSignal(event: SignalEvent): void {
        this.loggerWorker.postMessage({ type: "signal", event });
    }

    public broadcast(message: WebSocketMessage): void {
        this.commWorker.postMessage({ type: "broadcast", data: message });
    }

    public shutdown(): void {
        this.loggerWorker.postMessage({ type: "shutdown" });
        this.binanceWorker.postMessage({ type: "shutdown" });
        this.commWorker.postMessage({ type: "shutdown" });
    }
}
