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

interface ErrorMessage {
    type: "error";
    message: string;
}

interface BacklogRequestMessage {
    type: "request_backlog";
    data: {
        clientId: string;
        amount: number;
    };
}

function isErrorMessage(msg: unknown): msg is ErrorMessage {
    return (
        typeof msg === "object" &&
        msg !== null &&
        (msg as { type?: unknown }).type === "error"
    );
}

function isBacklogRequestMessage(msg: unknown): msg is BacklogRequestMessage {
    return (
        typeof msg === "object" &&
        msg !== null &&
        (msg as { type?: unknown }).type === "request_backlog"
    );
}

export class ThreadManager {
    private readonly loggerWorker: Worker;
    private readonly binanceWorker: Worker;
    private readonly commWorker: Worker;
    private isShuttingDown = false;
    private backlogRequestHandler?: (clientId: string, amount: number) => void;

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
            } else if (isErrorMessage(msg)) {
                console.error("Binance worker error:", msg.message);
            }
        });

        // Handle error messages from other workers
        this.loggerWorker.on("message", (msg: unknown) => {
            if (isErrorMessage(msg)) {
                console.error("Logger worker error:", msg.message);
            }
        });

        this.commWorker.on("message", (msg: unknown) => {
            if (isErrorMessage(msg)) {
                console.error("Communication worker error:", msg.message);
            } else if (isBacklogRequestMessage(msg)) {
                // Forward backlog request to the main thread
                this.handleBacklogRequest(msg.data);
            }
        });

        // Set up error handlers for graceful degradation
        this.setupWorkerErrorHandlers();
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

    public sendBacklogToClients(backlog: unknown[], signals: unknown[]): void {
        this.commWorker.postMessage({
            type: "send_backlog",
            data: { backlog, signals },
        });
    }

    public setBacklogRequestHandler(
        handler: (clientId: string, amount: number) => void
    ): void {
        this.backlogRequestHandler = handler;
    }

    private handleBacklogRequest(data: {
        clientId: string;
        amount: number;
    }): void {
        if (this.backlogRequestHandler) {
            this.backlogRequestHandler(data.clientId, data.amount);
        } else {
            console.warn("Backlog request received but no handler registered");
        }
    }

    public async shutdown(): Promise<void> {
        if (this.isShuttingDown) return;
        this.isShuttingDown = true;

        try {
            // Send shutdown messages to all workers
            this.loggerWorker.postMessage({ type: "shutdown" });
            this.binanceWorker.postMessage({ type: "shutdown" });
            this.commWorker.postMessage({ type: "shutdown" });

            // Wait for workers to gracefully shut down
            const shutdownPromises = [
                this.terminateWorkerGracefully(this.loggerWorker, "logger"),
                this.terminateWorkerGracefully(this.binanceWorker, "binance"),
                this.terminateWorkerGracefully(
                    this.commWorker,
                    "communication"
                ),
            ];

            // Wait up to 5 seconds for graceful shutdown
            await Promise.allSettled(shutdownPromises);
        } catch (error) {
            console.error("Error during ThreadManager shutdown:", error);
        }
    }

    private setupWorkerErrorHandlers(): void {
        this.loggerWorker.on("error", (error) => {
            console.error("Logger worker error:", error);
        });

        this.binanceWorker.on("error", (error) => {
            console.error("Binance worker error:", error);
        });

        this.commWorker.on("error", (error) => {
            console.error("Communication worker error:", error);
        });

        // Handle worker exits
        this.loggerWorker.on("exit", (code) => {
            if (!this.isShuttingDown && code !== 0) {
                console.error(`Logger worker exited with code ${code}`);
            }
        });

        this.binanceWorker.on("exit", (code) => {
            if (!this.isShuttingDown && code !== 0) {
                console.error(`Binance worker exited with code ${code}`);
            }
        });

        this.commWorker.on("exit", (code) => {
            if (!this.isShuttingDown && code !== 0) {
                console.error(`Communication worker exited with code ${code}`);
            }
        });
    }

    private async terminateWorkerGracefully(
        worker: Worker,
        name: string,
        timeoutMs = 5000
    ): Promise<void> {
        return new Promise<void>((resolve) => {
            const timeout = setTimeout(() => {
                console.warn(
                    `${name} worker did not exit gracefully, terminating...`
                );
                try {
                    const terminatePromise = worker.terminate();
                    // Handle terminate result which may or may not be a Promise
                    void Promise.resolve(terminatePromise)
                        .catch((err) => {
                            console.error(
                                `Error terminating ${name} worker:`,
                                err
                            );
                        })
                        .finally(() => resolve());
                } catch (err) {
                    console.error(`Error terminating ${name} worker:`, err);
                    resolve();
                }
            }, timeoutMs);

            worker.on("exit", () => {
                clearTimeout(timeout);
                resolve();
            });
        });
    }
}
