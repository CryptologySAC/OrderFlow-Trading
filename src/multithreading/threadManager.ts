import { Worker } from "worker_threads";
import { randomUUID } from "crypto";
import { WorkerMessageRouter } from "./shared/workerMessageRouter.js";
import {
    MetricsBatchMessageSchema,
    type MetricsBatchMessage,
    DepthSnapshotResponseMessageSchema,
} from "./shared/messageSchemas.js";

import type { SignalEvent } from "../infrastructure/signalLoggerInterface.js";
import type { WebSocketMessage } from "../utils/interfaces.js";
import type { SignalTracker } from "../analysis/signalTracker.js";
import type { EnhancedMetrics } from "../infrastructure/metricsCollector.js";
import type { ILogger } from "../infrastructure/loggerInterface.js";
import { WorkerProxyLogger } from "./shared/workerProxylogger.js";

export interface BinanceWorkerMetrics {
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

// Metrics messages are handled by message router

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

// New message types for worker proxy functionality
interface MetricsUpdateMessage {
    type: "metrics_update";
    metricName: string;
    value: number;
    worker: string;
}

interface MetricsIncrementMessage {
    type: "metrics_increment";
    metricName: string;
    worker: string;
}

interface CircuitBreakerFailureMessage {
    type: "circuit_breaker_failure";
    failures: number;
    failuresString?: string; // Safe BigInt serialization
    failuresIsTruncated?: boolean; // Indicates if failures exceeded Number.MAX_SAFE_INTEGER
    worker: string;
    state?: string;
    timestamp?: number;
    correlationId?: string;
}

// MetricsBatchMessage interface removed - now using imported schema type

// Message type guards removed as they're handled by message router

export class ThreadManager {
    private readonly loggerWorker: Worker;
    private readonly binanceWorker: Worker;
    private readonly commWorker: Worker;
    private readonly storageWorker: Worker;
    private readonly messageRouter: WorkerMessageRouter;
    private readonly logger: ILogger;
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
        // Initialize message router
        this.logger = new WorkerProxyLogger("threadManager");
        this.messageRouter = new WorkerMessageRouter(this.logger);
        this.setupMessageRouterHandlers();

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

        // Use message router for all worker communication
        this.binanceWorker.on("message", (msg: unknown) => {
            this.messageRouter.routeMessage(msg, this.binanceWorker);
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

        // Use message router for other workers too
        this.loggerWorker.on("message", (msg: unknown) => {
            this.messageRouter.routeMessage(msg, this.loggerWorker);
        });

        this.commWorker.on("message", (msg: unknown) => {
            this.messageRouter.routeMessage(msg, this.commWorker);
        });

        // Set up error handlers for graceful degradation
        this.setupWorkerErrorHandlers();
    }

    private setupMessageRouterHandlers(): void {
        // Handle metrics-related messages
        this.messageRouter.registerHandler("metrics", (msg: unknown) => {
            this.commWorker.postMessage(msg);
        });

        this.messageRouter.registerHandler("metrics_update", (msg: unknown) => {
            const updateMsg = msg as MetricsUpdateMessage;
            this.commWorker.postMessage({
                type: "metrics",
                data: {
                    action: "update",
                    metricName: updateMsg.metricName,
                    value: updateMsg.value,
                    worker: updateMsg.worker,
                },
            });
        });

        this.messageRouter.registerHandler(
            "metrics_increment",
            (msg: unknown) => {
                const incrementMsg = msg as MetricsIncrementMessage;
                this.commWorker.postMessage({
                    type: "metrics",
                    data: {
                        action: "increment",
                        metricName: incrementMsg.metricName,
                        worker: incrementMsg.worker,
                    },
                });
            }
        );

        this.messageRouter.registerHandler("metrics_batch", (msg: unknown) => {
            // Use Zod schema for message validation
            const validationResult = MetricsBatchMessageSchema.safeParse(msg);
            if (!validationResult.success) {
                this.log("error", "Invalid metrics batch message", {
                    error: validationResult.error.message,
                    correlationId: `threadmanager-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`,
                });
                return;
            }
            const batchMsg: MetricsBatchMessage = validationResult.data;

            // Optimized batch processing - group by type for fewer IPC calls
            const updateMetrics: Array<{
                name: string;
                value: number;
                timestamp: number;
            }> = [];
            const incrementMetrics: Array<{ name: string; timestamp: number }> =
                [];

            batchMsg.updates.forEach((update) => {
                if (update.type === "update") {
                    updateMetrics.push({
                        name: update.name,
                        value: update.value,
                        timestamp: update.timestamp,
                    });
                } else if (update.type === "increment") {
                    incrementMetrics.push({
                        name: update.name,
                        timestamp: update.timestamp,
                    });
                }
            });

            // Send batched updates in fewer IPC calls
            if (updateMetrics.length > 0) {
                this.commWorker.postMessage({
                    type: "metrics",
                    data: {
                        action: "batch_update",
                        metrics: updateMetrics,
                        worker: batchMsg.worker,
                    },
                });
            }

            if (incrementMetrics.length > 0) {
                this.commWorker.postMessage({
                    type: "metrics",
                    data: {
                        action: "batch_increment",
                        metrics: incrementMetrics,
                        worker: batchMsg.worker,
                    },
                });
            }

            // Metrics batch processed successfully - no logging to avoid spam
        });

        // Handle circuit breaker failures
        this.messageRouter.registerHandler(
            "circuit_breaker_failure",
            (msg: unknown) => {
                const failureMsg = msg as CircuitBreakerFailureMessage;
                const actualFailures =
                    failureMsg.failuresString || failureMsg.failures.toString();
                const truncationWarning = failureMsg.failuresIsTruncated
                    ? " (count exceeded Number.MAX_SAFE_INTEGER, showing truncated value)"
                    : "";

                this.loggerWorker.postMessage({
                    type: "log",
                    level: "warn",
                    message: `Circuit breaker failure in ${failureMsg.worker} worker - ${actualFailures} failures${truncationWarning}`,
                    context: {
                        worker: failureMsg.worker,
                        failures: failureMsg.failures,
                        failuresString: failureMsg.failuresString,
                        failuresIsTruncated: failureMsg.failuresIsTruncated,
                        state: failureMsg.state,
                        timestamp: failureMsg.timestamp || Date.now(),
                        correlationId: failureMsg.correlationId,
                    },
                });
            }
        );

        // Handle stream events
        this.messageRouter.registerHandler("stream_event", (msg: unknown) => {
            const eventMsg = msg as StreamEventMessage;
            this.updateConnectionStatusCache(eventMsg.eventType);
            this.handleStreamEvent(eventMsg.eventType, eventMsg.data);
        });

        this.messageRouter.registerHandler("stream_data", (msg: unknown) => {
            const dataMsg = msg as StreamDataMessage;
            this.handleStreamData(dataMsg.dataType, dataMsg.data);
        });

        this.messageRouter.registerHandler(
            "status_response",
            (msg: unknown) => {
                const statusMsg = msg as StatusResponseMessage;
                this.handleStatusResponse(statusMsg);
            }
        );

        // Handle log proxy messages
        this.messageRouter.registerHandler("log_message", (msg: unknown) => {
            const logMsg = msg as ProxyLogMessage;
            this.loggerWorker.postMessage({
                type: "log",
                level: logMsg.data.level,
                message: logMsg.data.message,
                context: logMsg.data.context,
                correlationId: logMsg.data.correlationId,
            });
        });

        this.messageRouter.registerHandler(
            "log_correlation",
            (msg: unknown) => {
                const correlationMsg = msg as ProxyCorrelationMessage;
                this.loggerWorker.postMessage({
                    type: "correlation",
                    action: correlationMsg.action,
                    id: correlationMsg.id,
                    context: correlationMsg.context,
                });
            }
        );

        // Handle backlog requests
        this.messageRouter.registerHandler(
            "request_backlog",
            (msg: unknown) => {
                const backlogMsg = msg as BacklogRequestMessage;
                this.handleBacklogRequest(backlogMsg.data);
            }
        );

        // Handle errors
        this.messageRouter.registerHandler("error", (msg: unknown) => {
            const errorMsg = msg as ErrorMessage;
            this.logger.error("Worker error received", {
                message: errorMsg.message,
                component: "ThreadManager",
            });
        });

        // Handle storage replies (special case - bypass router for direct handling)
        this.messageRouter.registerHandler("reply", (msg: unknown) => {
            const replyMsg = msg as {
                requestId: string;
                ok: boolean;
                result: unknown;
                error?: string;
            };
            const { requestId, ok, result, error } = replyMsg;
            const entry = this.storageResolvers.get(requestId);
            if (entry) {
                this.storageResolvers.delete(requestId);
                if (ok) {
                    entry.resolve(result);
                } else {
                    entry.reject(new Error(error));
                }
            }
        });
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
            | "vacuumDatabase"
            | "getDatabaseSize"
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

    /**
     * Request depth snapshot from BinanceWorker to maintain data source consistency
     */
    public async requestDepthSnapshot(
        symbol: string,
        limit: number,
        timeoutMs = 10000
    ): Promise<{
        lastUpdateId: number;
        bids: [string, string][];
        asks: [string, string][];
    }> {
        if (this.isShuttingDown) {
            throw new Error("ThreadManager is shutting down");
        }

        const correlationId = randomUUID();
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(
                    new Error(
                        `Depth snapshot request timeout after ${timeoutMs}ms`
                    )
                );
            }, timeoutMs);

            const messageHandler = (message: unknown) => {
                try {
                    const validationResult =
                        DepthSnapshotResponseMessageSchema.safeParse(message);

                    if (!validationResult.success) {
                        return; // Not a depth snapshot response or invalid format
                    }

                    const response = validationResult.data;

                    if (response.correlationId === correlationId) {
                        clearTimeout(timeout);
                        this.binanceWorker.off("message", messageHandler);

                        if (response.success && response.data) {
                            resolve(response.data);
                        } else {
                            reject(
                                new Error(
                                    response.error ||
                                        "Unknown error in depth snapshot"
                                )
                            );
                        }
                    }
                } catch {
                    // Ignore validation errors for other message types
                }
            };

            this.binanceWorker.on("message", messageHandler);
            this.binanceWorker.postMessage({
                type: "depth_snapshot_request",
                symbol,
                limit,
                correlationId,
            });
        });
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
            this.logger.warn(
                "Backlog request received but no handler registered",
                {
                    clientId: data.clientId,
                    amount: data.amount,
                    component: "ThreadManager",
                }
            );
        }
    }

    private handleStreamEvent(eventType: string, data: unknown): void {
        if (this.streamEventHandler) {
            this.streamEventHandler(eventType, data);
        } else {
            this.logger.warn(
                "Stream event received but no handler registered",
                {
                    eventType,
                    data,
                    component: "ThreadManager",
                }
            );
        }
    }

    private handleStreamData(dataType: string, data: unknown): void {
        if (this.streamDataHandler) {
            this.streamDataHandler(dataType, data);
        } else {
            this.logger.warn("Stream data received but no handler registered", {
                dataType,
                data,
                component: "ThreadManager",
            });
        }
    }

    private updateConnectionStatusCache(eventType: string): void {
        const now = Date.now();

        // Atomic update using object spread to prevent race conditions
        const newStatus = {
            ...this.cachedConnectionStatus,
            lastUpdated: now,
        };

        switch (eventType) {
            case "connected":
                Object.assign(newStatus, {
                    isConnected: true,
                    connectionState: "connected",
                });
                break;
            case "disconnected":
                Object.assign(newStatus, {
                    isConnected: false,
                    connectionState: "disconnected",
                });
                break;
            case "reconnecting":
                Object.assign(newStatus, {
                    isConnected: false,
                    connectionState: "reconnecting",
                });
                break;
            case "healthy":
                newStatus.streamHealth = {
                    ...newStatus.streamHealth,
                    isHealthy: true,
                };
                break;
            case "unhealthy":
                newStatus.streamHealth = {
                    ...newStatus.streamHealth,
                    isHealthy: false,
                };
                break;
            case "error":
                Object.assign(newStatus, {
                    connectionState: "error",
                });
                break;
        }

        // Atomic assignment - prevents partial state updates
        this.cachedConnectionStatus = newStatus;
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
        // Atomic update with complete object replacement
        const newStatus = {
            isConnected: status.isConnected,
            connectionState: status.connectionState,
            lastUpdated: Date.now(),
            streamHealth: {
                isHealthy: status.streamHealth?.isHealthy || false,
                lastTradeMessage: status.streamHealth?.lastTradeMessage || 0,
                lastDepthMessage: status.streamHealth?.lastDepthMessage || 0,
            },
        };

        // Atomic assignment
        this.cachedConnectionStatus = newStatus;
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
            // Shutdown message router first
            this.messageRouter.shutdown();

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
            this.logger.error("Error during ThreadManager shutdown", {
                error: error instanceof Error ? error.message : String(error),
                stack: error instanceof Error ? error.stack : undefined,
                component: "ThreadManager",
            });
        }
    }

    private setupWorkerErrorHandlers(): void {
        this.loggerWorker.on("error", (error) => {
            this.logger.error("Logger worker error", {
                error: error instanceof Error ? error.message : String(error),
                stack: error instanceof Error ? error.stack : undefined,
                component: "ThreadManager",
                worker: "logger",
            });
        });

        this.binanceWorker.on("error", (error) => {
            this.logger.error("Binance worker error", {
                error: error instanceof Error ? error.message : String(error),
                stack: error instanceof Error ? error.stack : undefined,
                component: "ThreadManager",
                worker: "binance",
            });
        });

        this.commWorker.on("error", (error) => {
            this.logger.error("Communication worker error", {
                error: error instanceof Error ? error.message : String(error),
                stack: error instanceof Error ? error.stack : undefined,
                component: "ThreadManager",
                worker: "communication",
            });
        });

        this.storageWorker.on("error", (error) => {
            this.logger.error("Storage worker error", {
                error: error instanceof Error ? error.message : String(error),
                stack: error instanceof Error ? error.stack : undefined,
                component: "ThreadManager",
                worker: "storage",
            });
        });

        // Handle worker exits
        this.loggerWorker.on("exit", (code) => {
            if (!this.isShuttingDown && code !== 0) {
                this.logger.error("Logger worker exited unexpectedly", {
                    exitCode: code,
                    component: "ThreadManager",
                    worker: "logger",
                });
            }
        });

        this.binanceWorker.on("exit", (code) => {
            if (!this.isShuttingDown && code !== 0) {
                // POLICY OVERRIDE: Using console.error for system panic
                // REASON: Binance worker crash is critical - entire system must exit immediately
                console.error(
                    `❌ CRITICAL: Binance worker exited with code ${code}`
                );
                console.error(
                    "❌ Market data connectivity lost - system cannot continue"
                );
                console.error("❌ Initiating emergency shutdown");
                process.exit(1);
            }
        });

        this.commWorker.on("exit", (code) => {
            if (!this.isShuttingDown && code !== 0) {
                this.logger.error("Communication worker exited unexpectedly", {
                    exitCode: code,
                    component: "ThreadManager",
                    worker: "communication",
                });
            }
        });

        this.storageWorker.on("exit", (code) => {
            if (!this.isShuttingDown && code !== 0) {
                this.logger.error("Storage worker exited unexpectedly", {
                    exitCode: code,
                    component: "ThreadManager",
                    worker: "storage",
                });
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
                this.logger.warn(
                    "Worker did not exit gracefully, terminating",
                    {
                        workerName: name,
                        component: "ThreadManager",
                    }
                );
                try {
                    const terminatePromise = worker.terminate();
                    // Handle terminate result which may or may not be a Promise
                    void Promise.resolve(terminatePromise)
                        .catch((err) => {
                            this.logger.error("Error terminating worker", {
                                workerName: name,
                                error:
                                    err instanceof Error
                                        ? err.message
                                        : String(err),
                                stack:
                                    err instanceof Error
                                        ? err.stack
                                        : undefined,
                                component: "ThreadManager",
                            });
                        })
                        .finally(() => resolve());
                } catch (err) {
                    this.logger.error("Error terminating worker", {
                        workerName: name,
                        error: err instanceof Error ? err.message : String(err),
                        stack: err instanceof Error ? err.stack : undefined,
                        component: "ThreadManager",
                    });
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
