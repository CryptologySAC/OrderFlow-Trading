import { Worker } from "worker_threads";
import { randomUUID } from "crypto";

import type { SignalEvent } from "../infrastructure/signalLoggerInterface.js";
import type { WebSocketMessage } from "../utils/interfaces.js";
import type { SignalTracker } from "../analysis/signalTracker.js";
import type { EnhancedMetrics } from "../infrastructure/metricsCollector.js";

interface BinanceWorkerMetrics {
    connection: {
        state: string;
        uptime: number | undefined;
        reconnectAttempts: number;
        lastReconnectAttempt: number;
    };
    streams: {
        health: {
            tradeMessageCount: number;
            depthMessageCount: number;
            lastTradeMessage: number;
            lastDepthMessage: number;
            isHealthy: boolean;
        };
        tradeMessagesPerSecond: number;
        depthMessagesPerSecond: number;
    };
    timers: {
        heartbeat: boolean;
        healthCheck: boolean;
        reconnect: boolean;
    };
}

interface MetricsMessage {
    type: "metrics";
    data: BinanceWorkerMetrics;
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

interface StreamEventMessage {
    type: "stream_event";
    eventType:
        | "connected"
        | "disconnected"
        | "error"
        | "healthy"
        | "unhealthy"
        | "reconnecting"
        | "hardReloadRequired"
        | "connectivityIssue";
    data: unknown;
}

interface StatusRequestMessage {
    type: "status_request";
    requestId: string;
}

interface StatusResponseMessage {
    type: "status_response";
    requestId: string;
    status: {
        isConnected: boolean;
        connectionState: string;
        reconnectAttempts: number;
        uptime?: number;
        lastReconnectAttempt: number;
        streamHealth: {
            isHealthy: boolean;
            lastTradeMessage: number;
            lastDepthMessage: number;
        };
    };
}

interface StreamDataMessage {
    type: "stream_data";
    dataType: "trade" | "depth";
    data: Record<string, unknown>;
}

interface ProxyLogMessage {
    type: "log_message";
    data: {
        level: "info" | "error" | "warn" | "debug";
        message: string;
        context?: Record<string, unknown>;
        correlationId?: string;
    };
}

interface ProxyCorrelationMessage {
    type: "log_correlation";
    action: "set" | "remove";
    id: string;
    context?: string;
}

function isProxyLogMessage(msg: unknown): msg is ProxyLogMessage {
    return (
        typeof msg === "object" &&
        msg !== null &&
        (msg as { type?: unknown }).type === "log_message"
    );
}

function isProxyCorrelationMessage(
    msg: unknown
): msg is ProxyCorrelationMessage {
    return (
        typeof msg === "object" &&
        msg !== null &&
        (msg as { type?: unknown }).type === "log_correlation"
    );
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

function isStreamEventMessage(msg: unknown): msg is StreamEventMessage {
    return (
        typeof msg === "object" &&
        msg !== null &&
        (msg as { type?: unknown }).type === "stream_event"
    );
}

function isStreamDataMessage(msg: unknown): msg is StreamDataMessage {
    return (
        typeof msg === "object" &&
        msg !== null &&
        (msg as { type?: unknown }).type === "stream_data"
    );
}

function isStatusResponseMessage(msg: unknown): msg is StatusResponseMessage {
    return (
        typeof msg === "object" &&
        msg !== null &&
        (msg as { type?: unknown }).type === "status_response"
    );
}

export class ThreadManager {
    private readonly loggerWorker: Worker;
    private readonly binanceWorker: Worker;
    private readonly commWorker: Worker;
    private readonly storageWorker: Worker;
    private isShuttingDown = false;
    private backlogRequestHandler?: (clientId: string, amount: number) => void;
    private streamEventHandler?: (eventType: string, data: unknown) => void;
    private streamDataHandler?: (dataType: string, data: unknown) => void;
    private readonly storageResolvers = new Map<
        string,
        { resolve: (val: unknown) => void; reject: (err: Error) => void }
    >();
    private readonly statusResolvers = new Map<
        string,
        {
            resolve: (status: {
                isConnected: boolean;
                connectionState: string;
                reconnectAttempts: number;
                uptime?: number;
                lastReconnectAttempt: number;
                streamHealth: {
                    isHealthy: boolean;
                    lastTradeMessage: number;
                    lastDepthMessage: number;
                };
            }) => void;
            reject: (err: Error) => void;
        }
    >();

    // Connection status cache
    private cachedConnectionStatus: {
        isConnected: boolean;
        connectionState: string;
        lastUpdated: number;
        streamHealth: {
            isHealthy: boolean;
            lastTradeMessage: number;
            lastDepthMessage: number;
        };
    } = {
        isConnected: false,
        connectionState: "disconnected",
        lastUpdated: Date.now(),
        streamHealth: {
            isHealthy: false,
            lastTradeMessage: 0,
            lastDepthMessage: 0,
        },
    };

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
        this.storageWorker = new Worker(
            new URL("./workers/storageWorker.js", import.meta.url)
        );

        // Forward metrics from binance worker to communication worker
        this.binanceWorker.on("message", (msg: unknown) => {
            if (isMetricsMessage(msg)) {
                this.commWorker.postMessage(msg);
            } else if (isErrorMessage(msg)) {
                console.error("Binance worker error:", msg.message);
            } else if (isStreamEventMessage(msg)) {
                this.updateConnectionStatusCache(msg.eventType);
                this.handleStreamEvent(msg.eventType, msg.data);
            } else if (isStreamDataMessage(msg)) {
                this.handleStreamData(msg.dataType, msg.data);
            } else if (isStatusResponseMessage(msg)) {
                this.handleStatusResponse(msg);
            } else if (isProxyLogMessage(msg)) {
                // Forward proxy log messages to logger worker
                this.loggerWorker.postMessage({
                    type: "log",
                    level: msg.data.level,
                    message: msg.data.message,
                    context: msg.data.context,
                    correlationId: msg.data.correlationId,
                });
            } else if (isProxyCorrelationMessage(msg)) {
                // Forward correlation messages to logger worker
                this.loggerWorker.postMessage({
                    type: "correlation",
                    action: msg.action,
                    id: msg.id,
                    context: msg.context,
                });
            }
        });

        this.storageWorker.on("message", (msg: unknown) => {
            if (
                typeof msg === "object" &&
                msg !== null &&
                (msg as { type?: unknown }).type === "reply"
            ) {
                const { requestId, ok, result, error } = msg as {
                    requestId: string;
                    ok: boolean;
                    result: unknown;
                    error?: string;
                };

                const entry = this.storageResolvers.get(requestId);
                if (entry) {
                    this.storageResolvers.delete(requestId);

                    if (ok) {
                        entry.resolve(result);
                    } else {
                        entry.reject(new Error(error));
                    }
                }
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
                this.handleBacklogRequest(msg.data);
            } else if (isProxyLogMessage(msg)) {
                // Forward proxy log messages to logger worker
                this.loggerWorker.postMessage({
                    type: "log",
                    level: msg.data.level,
                    message: msg.data.message,
                    context: msg.data.context,
                    correlationId: msg.data.correlationId,
                });
            } else if (isProxyCorrelationMessage(msg)) {
                // Forward correlation messages to logger worker
                this.loggerWorker.postMessage({
                    type: "correlation",
                    action: msg.action,
                    id: msg.id,
                    context: msg.context,
                });
            }
        });

        // Set up error handlers for graceful degradation
        this.setupWorkerErrorHandlers();
    }

    public startBinance(): void {
        this.binanceWorker.postMessage({ type: "start" });
    }

    /**
     * Type-safe async proxy to storageWorker.
     */
    public async callStorage<
        M extends
            | "saveAggregatedTrade"
            | "getLatestAggregatedTrades"
            | "saveAggregatedTradesBulk"
            | "purgeOldEntries"
            | "clearAllTradeData"
            | "getLastTradeTimestamp"
            | "close"
            | "enqueueJob"
            | "dequeueJobs"
            | "markJobCompleted"
            | "restoreQueuedJobs"
            | "saveActiveAnomaly"
            | "removeActiveAnomaly"
            | "getActiveAnomalies"
            | "saveSignalHistory"
            | "getRecentSignals"
            | "purgeSignalHistory"
            | "saveConfirmedSignal"
            | "getRecentConfirmedSignals"
            | "purgeConfirmedSignals"
            | "saveSignalOutcome"
            | "updateSignalOutcome"
            | "getSignalOutcome"
            | "getSignalOutcomes"
            | "saveMarketContext"
            | "getMarketContext"
            | "saveFailedSignalAnalysis"
            | "getFailedSignalAnalyses"
            | "purgeOldSignalData",
    >(
        method: M,
        ...args: Parameters<Storage[M]>
    ): Promise<Awaited<ReturnType<Storage[M]>>> {
        if (this.isShuttingDown) {
            throw new Error("ThreadManager is shutting down");
        }

        const requestId = randomUUID();
        return new Promise<Awaited<ReturnType<Storage[M]>>>(
            (resolvePromise, rejectPromise) => {
                this.storageResolvers.set(requestId, {
                    resolve: (val: unknown) => {
                        // cast once, still type-safe
                        resolvePromise(val as Awaited<ReturnType<Storage[M]>>);
                    },
                    reject: rejectPromise,
                });
                this.storageWorker.postMessage({
                    type: "call",
                    method,
                    args,
                    requestId,
                });
            }
        );
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

    public sendBacklogToSpecificClient(
        clientId: string,
        backlog: unknown[],
        signals: unknown[]
    ): void {
        this.commWorker.postMessage({
            type: "send_backlog",
            data: { backlog, signals, targetClientId: clientId },
        });
    }

    public setBacklogRequestHandler(
        handler: (clientId: string, amount: number) => void
    ): void {
        this.backlogRequestHandler = handler;
    }

    public setStreamEventHandler(
        handler: (eventType: string, data: unknown) => void
    ): void {
        this.streamEventHandler = handler;
    }

    public setStreamDataHandler(
        handler: (dataType: string, data: unknown) => void
    ): void {
        this.streamDataHandler = handler;
    }

    public setCorrelationContext(id: string, context: string): void {
        this.loggerWorker.postMessage({
            type: "correlation",
            action: "set",
            id,
            context,
        });
    }

    public removeCorrelationContext(id: string): void {
        this.loggerWorker.postMessage({
            type: "correlation",
            action: "remove",
            id,
        });
    }

    public setSignalTracker(signalTracker: SignalTracker): void {
        this.commWorker.postMessage({
            type: "signal_tracker",
            data: signalTracker,
        });
    }

    public updateMainThreadMetrics(metrics: EnhancedMetrics): void {
        this.commWorker.postMessage({
            type: "main_metrics",
            data: metrics,
        });
    }

    /**
     * Get current connection status from cache (fast, no worker communication)
     */
    public getCachedConnectionStatus(): {
        isConnected: boolean;
        connectionState: string;
        lastUpdated: number;
        cacheAge: number;
        streamHealth: {
            isHealthy: boolean;
            lastTradeMessage: number;
            lastDepthMessage: number;
        };
    } {
        const now = Date.now();
        return {
            ...this.cachedConnectionStatus,
            cacheAge: now - this.cachedConnectionStatus.lastUpdated,
        };
    }

    /**
     * Request fresh connection status from BinanceWorker (async)
     */
    public async getConnectionStatus(timeoutMs = 5000): Promise<{
        isConnected: boolean;
        connectionState: string;
        reconnectAttempts: number;
        uptime?: number;
        lastReconnectAttempt: number;
        streamHealth: {
            isHealthy: boolean;
            lastTradeMessage: number;
            lastDepthMessage: number;
        };
    }> {
        if (this.isShuttingDown) {
            throw new Error("ThreadManager is shutting down");
        }

        const requestId = randomUUID();
        return new Promise((resolve, reject) => {
            const timeoutHandle = setTimeout(() => {
                this.statusResolvers.delete(requestId);
                reject(
                    new Error(`Status request timeout after ${timeoutMs}ms`)
                );
            }, timeoutMs);

            this.statusResolvers.set(requestId, {
                resolve: (status) => {
                    clearTimeout(timeoutHandle);
                    // Update cache with fresh data
                    this.updateConnectionStatusFromResponse(status);
                    resolve(status);
                },
                reject: (err: Error) => {
                    clearTimeout(timeoutHandle);
                    reject(err);
                },
            });

            this.binanceWorker.postMessage({
                type: "status_request",
                requestId,
            } as StatusRequestMessage);
        });
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

    private handleStreamEvent(eventType: string, data: unknown): void {
        if (this.streamEventHandler) {
            this.streamEventHandler(eventType, data);
        } else {
            console.warn(
                `Stream event '${eventType}' received but no handler registered`
            );
        }
    }

    private handleStreamData(dataType: string, data: unknown): void {
        if (this.streamDataHandler) {
            this.streamDataHandler(dataType, data);
        } else {
            console.warn(
                `Stream data '${dataType}' received but no handler registered`
            );
        }
    }

    private updateConnectionStatusCache(eventType: string): void {
        const now = Date.now();
        this.cachedConnectionStatus.lastUpdated = now;

        switch (eventType) {
            case "connected":
                this.cachedConnectionStatus.isConnected = true;
                this.cachedConnectionStatus.connectionState = "connected";
                break;
            case "disconnected":
                this.cachedConnectionStatus.isConnected = false;
                this.cachedConnectionStatus.connectionState = "disconnected";
                break;
            case "reconnecting":
                this.cachedConnectionStatus.isConnected = false;
                this.cachedConnectionStatus.connectionState = "reconnecting";
                break;
            case "healthy":
                this.cachedConnectionStatus.streamHealth.isHealthy = true;
                break;
            case "unhealthy":
                this.cachedConnectionStatus.streamHealth.isHealthy = false;
                break;
            case "error":
                this.cachedConnectionStatus.connectionState = "error";
                break;
        }
    }

    private updateConnectionStatusFromResponse(status: {
        isConnected: boolean;
        connectionState: string;
        streamHealth?: {
            isHealthy: boolean;
            lastTradeMessage: number;
            lastDepthMessage: number;
        };
    }): void {
        this.cachedConnectionStatus = {
            isConnected: status.isConnected,
            connectionState: status.connectionState,
            lastUpdated: Date.now(),
            streamHealth: {
                isHealthy: status.streamHealth?.isHealthy || false,
                lastTradeMessage: status.streamHealth?.lastTradeMessage || 0,
                lastDepthMessage: status.streamHealth?.lastDepthMessage || 0,
            },
        };
    }

    private handleStatusResponse(msg: StatusResponseMessage): void {
        const resolver = this.statusResolvers.get(msg.requestId);
        if (resolver) {
            this.statusResolvers.delete(msg.requestId);
            resolver.resolve(msg.status);
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
            this.storageWorker.postMessage({ type: "shutdown" });

            // Wait for workers to gracefully shut down
            const shutdownPromises = [
                this.terminateWorkerGracefully(this.loggerWorker, "logger"),
                this.terminateWorkerGracefully(this.binanceWorker, "binance"),
                this.terminateWorkerGracefully(
                    this.commWorker,
                    "communication"
                ),
                this.terminateWorkerGracefully(this.storageWorker, "storage"),
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

        this.storageWorker.on("error", (error) => {
            console.error("Storage worker error:", error);
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

        this.storageWorker.on("exit", (code) => {
            if (!this.isShuttingDown && code !== 0) {
                console.error(`Storage worker exited with code ${code}`);
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
