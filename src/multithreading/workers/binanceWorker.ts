import { parentPort } from "worker_threads";
import { WorkerProxyLogger } from "../shared/workerProxylogger.js";
import { WorkerMetricsProxy } from "../shared/workerMetricsProxy.js";
import { WorkerCircuitBreakerProxy } from "../shared/workerCircuitBreakerProxy.js";
import { BinanceDataFeed } from "../../utils/binance.js";
import { DataStreamManager } from "../../trading/dataStreamManager.js";
import { Config } from "../../core/config.js";
import { DepthSnapshotRequestMessageSchema } from "../shared/messageSchemas.js";

// Validate worker thread context
if (!parentPort) {
    // POLICY OVERRIDE: Using console.error for system panic during worker validation
    // REASON: Worker thread validation failure is critical system state - logger not yet available
    console.error("❌ CRITICAL: BinanceWorker must be run in a worker thread");
    console.error(
        "❌ Application cannot continue without proper worker thread context"
    );
    process.exit(1);
}

// Use shared proxy implementations instead of direct infrastructure imports
function initializeComponents(): {
    logger: WorkerProxyLogger;
    metricsCollector: WorkerMetricsProxy;
    circuitBreaker: WorkerCircuitBreakerProxy;
    binanceFeed: BinanceDataFeed;
    manager: DataStreamManager;
} {
    const logger = new WorkerProxyLogger("binance");
    const metricsCollector = new WorkerMetricsProxy("binance");
    const circuitBreaker = new WorkerCircuitBreakerProxy(
        5,
        60000,
        "binance",
        logger
    );
    const binanceFeed = new BinanceDataFeed();

    // Proxies implement ICircuitBreaker interface for compatibility
    const manager = new DataStreamManager(
        Config.DATASTREAM,
        binanceFeed,
        circuitBreaker,
        logger,
        metricsCollector
    );

    return {
        logger,
        metricsCollector,
        circuitBreaker,
        binanceFeed,
        manager,
    };
}

let components: ReturnType<typeof initializeComponents>;
try {
    components = initializeComponents();
} catch (error) {
    // POLICY OVERRIDE: Using console.error for system panic during worker initialization
    // REASON: Logger infrastructure not yet available during startup, critical failure requires immediate visibility
    // This is the only acceptable use of console methods - system panic before logging infrastructure is ready
    console.error("❌ CRITICAL: BinanceWorker initialization failed:");
    console.error("❌", error instanceof Error ? error.message : String(error));
    console.error("❌ Stack:", error instanceof Error ? error.stack : "N/A");
    console.error("❌ Market data connectivity is essential - exiting");
    process.exit(1);
}

const { logger, metricsCollector, manager } = components;

// Store interval reference for proper cleanup
let metricsInterval: NodeJS.Timeout | null = null;

// Enhanced monitoring and correlation tracking
let currentCorrelationId: string | null = null;

function clearCorrelationContext(): void {
    if (currentCorrelationId) {
        if (logger.removeCorrelationId) {
            logger.removeCorrelationId(currentCorrelationId);
        }
        currentCorrelationId = null;
    }
}

// Setup DataStreamManager event handlers to forward to parent thread
manager.on("connected", () => {
    parentPort?.postMessage({
        type: "stream_event",
        eventType: "connected",
        data: { timestamp: Date.now() },
    });
});

manager.on("disconnected", (reason: string) => {
    parentPort?.postMessage({
        type: "stream_event",
        eventType: "disconnected",
        data: { reason, timestamp: Date.now() },
    });
});

manager.on("error", (error: Error) => {
    parentPort?.postMessage({
        type: "stream_event",
        eventType: "error",
        data: {
            message: error.message,
            stack: error.stack,
            timestamp: Date.now(),
        },
    });
});

manager.on("healthy", () => {
    parentPort?.postMessage({
        type: "stream_event",
        eventType: "healthy",
        data: { timestamp: Date.now() },
    });
});

manager.on("unhealthy", () => {
    parentPort?.postMessage({
        type: "stream_event",
        eventType: "unhealthy",
        data: { timestamp: Date.now() },
    });
});

manager.on(
    "reconnecting",
    (data: { attempt: number; delay: number; maxAttempts: number }) => {
        parentPort?.postMessage({
            type: "stream_event",
            eventType: "reconnecting",
            data: { ...data, timestamp: Date.now() },
        });
    }
);

manager.on("hardReloadRequired", (event: unknown) => {
    parentPort?.postMessage({
        type: "stream_event",
        eventType: "hardReloadRequired",
        data: { event, timestamp: Date.now() },
    });
});

manager.on("connectivityIssue", (issue: unknown) => {
    parentPort?.postMessage({
        type: "stream_event",
        eventType: "connectivityIssue",
        data: { issue, timestamp: Date.now() },
    });
});

// Forward trade and depth data to parent for processing
manager.on("trade", (data: unknown) => {
    parentPort?.postMessage({
        type: "stream_data",
        dataType: "trade",
        data,
    });
});

manager.on("depth", (data: unknown) => {
    parentPort?.postMessage({
        type: "stream_data",
        dataType: "depth",
        data,
    });
});

// Add global error handlers
process.on("uncaughtException", (error: Error) => {
    logger.error("Uncaught exception in binance worker", {
        error: error.message,
        stack: error.stack,
    });
    void gracefulShutdown(1);
});

process.on("unhandledRejection", (reason: unknown) => {
    logger.error("Unhandled promise rejection in binance worker", {
        reason: reason instanceof Error ? reason.message : String(reason),
        stack: reason instanceof Error ? reason.stack : undefined,
    });
    void gracefulShutdown(1);
});

async function gracefulShutdown(exitCode: number = 0): Promise<void> {
    try {
        logger.info("Binance worker starting graceful shutdown");

        // Clear metrics interval
        if (metricsInterval) {
            clearInterval(metricsInterval);
            metricsInterval = null;
        }

        // Disconnect from data stream with timeout
        const disconnectPromise = manager.disconnect();
        const timeoutPromise = new Promise<void>((resolve) => {
            setTimeout(() => resolve(), 5000); // 5 second timeout
        });

        await Promise.race([disconnectPromise, timeoutPromise]);

        logger.info("Binance worker shutdown complete");
        process.exit(exitCode);
    } catch (error) {
        logger.error("Error during binance worker shutdown", {
            error: error instanceof Error ? error.message : String(error),
        });
        process.exit(1);
    }
}

parentPort?.on("message", (msg: unknown) => {
    try {
        // Enhanced message validation
        if (!msg || typeof msg !== "object" || !("type" in msg)) {
            logger.warn("Invalid message received", { message: msg });
            return;
        }

        const message = msg as { type: string; [key: string]: unknown };

        switch (message.type) {
            case "start":
                manager
                    .connect()
                    .then(() => {
                        logger.info(
                            "Binance data stream connected successfully"
                        );
                    })
                    .catch((error: unknown) => {
                        logger.error("Failed to connect binance data stream", {
                            error:
                                error instanceof Error
                                    ? error.message
                                    : String(error),
                        });
                        parentPort?.postMessage({
                            type: "error",
                            message: "Failed to connect to binance data stream",
                        });
                    });

                // Start metrics reporting
                if (!metricsInterval) {
                    metricsInterval = setInterval(() => {
                        try {
                            const metrics = manager.getDetailedMetrics();

                            // Validate metrics structure before sending
                            if (!metrics || !metrics.connection) {
                                logger.warn(
                                    "Invalid metrics structure from DataStreamManager",
                                    {
                                        metrics: JSON.stringify(metrics),
                                    }
                                );
                                return;
                            }

                            parentPort?.postMessage({
                                type: "metrics",
                                data: metrics,
                            });
                        } catch (error) {
                            logger.error("Error sending metrics", {
                                error:
                                    error instanceof Error
                                        ? error.message
                                        : String(error),
                            });
                        }
                    }, 1000);
                }
                break;

            case "stop":
                manager
                    .disconnect()
                    .then(() => {
                        logger.info(
                            "Binance data stream disconnected successfully"
                        );
                    })
                    .catch((error: unknown) => {
                        logger.error(
                            "Error disconnecting binance data stream",
                            {
                                error:
                                    error instanceof Error
                                        ? error.message
                                        : String(error),
                            }
                        );
                    });

                if (metricsInterval) {
                    clearInterval(metricsInterval);
                    metricsInterval = null;
                }
                break;

            case "status_request":
                try {
                    const statusMsg = message as {
                        requestId: string;
                        type: string;
                    };
                    if (!statusMsg.requestId) {
                        logger.error("Status request missing requestId");
                        break;
                    }
                    const status = manager.getStatus();
                    parentPort?.postMessage({
                        type: "status_response",
                        requestId: statusMsg.requestId,
                        status: {
                            isConnected: status.isConnected,
                            connectionState: status.state,
                            reconnectAttempts: status.reconnectAttempts,
                            uptime: status.uptime,
                            lastReconnectAttempt: status.lastReconnectAttempt,
                            streamHealth: {
                                isHealthy: status.streamHealth.isHealthy,
                                lastTradeMessage:
                                    status.streamHealth.lastTradeMessage,
                                lastDepthMessage:
                                    status.streamHealth.lastDepthMessage,
                            },
                        },
                    });
                } catch (error) {
                    logger.error("Error handling status request", {
                        error:
                            error instanceof Error
                                ? error.message
                                : String(error),
                    });
                }
                break;

            case "shutdown":
                // Cleanup proxy classes before shutdown
                try {
                    if (metricsCollector.destroy) {
                        (metricsCollector.destroy as () => void)();
                    }
                    clearCorrelationContext();
                } catch (error) {
                    logger.error("Error during proxy cleanup", {
                        error:
                            error instanceof Error
                                ? error.message
                                : String(error),
                    });
                }
                void gracefulShutdown(0);
                break;

            case "depth_snapshot_request":
                void (async () => {
                    try {
                        const validationResult =
                            DepthSnapshotRequestMessageSchema.safeParse(
                                message
                            );

                        if (!validationResult.success) {
                            logger.error(
                                "Invalid depth snapshot request schema",
                                {
                                    errors: validationResult.error.errors,
                                    message,
                                }
                            );
                            parentPort?.postMessage({
                                type: "depth_snapshot_response",
                                correlationId: "unknown",
                                success: false,
                                error: "Invalid request schema",
                            });
                            return;
                        }

                        const requestMsg = validationResult.data;
                        const { binanceFeed } = components;
                        const snapshot = await binanceFeed.getDepthSnapshot(
                            requestMsg.symbol,
                            requestMsg.limit
                        );

                        if (
                            !snapshot ||
                            !snapshot.lastUpdateId ||
                            !snapshot.bids ||
                            !snapshot.asks
                        ) {
                            parentPort?.postMessage({
                                type: "depth_snapshot_response",
                                correlationId: requestMsg.correlationId,
                                success: false,
                                error: "Failed to fetch order book snapshot",
                            });
                            return;
                        }

                        parentPort?.postMessage({
                            type: "depth_snapshot_response",
                            correlationId: requestMsg.correlationId,
                            success: true,
                            data: {
                                lastUpdateId: snapshot.lastUpdateId,
                                bids: snapshot.bids as [string, string][],
                                asks: snapshot.asks as [string, string][],
                            },
                        });

                        logger.info("Depth snapshot request completed", {
                            symbol: requestMsg.symbol,
                            limit: requestMsg.limit,
                            correlationId: requestMsg.correlationId,
                            bidLevels: snapshot.bids?.length || 0,
                            askLevels: snapshot.asks?.length || 0,
                        });
                    } catch (error) {
                        logger.error("Error handling depth snapshot request", {
                            error:
                                error instanceof Error
                                    ? error.message
                                    : String(error),
                            stack:
                                error instanceof Error
                                    ? error.stack
                                    : undefined,
                        });
                        parentPort?.postMessage({
                            type: "depth_snapshot_response",
                            correlationId: "unknown",
                            success: false,
                            error:
                                error instanceof Error
                                    ? error.message
                                    : String(error),
                        });
                    }
                })();
                break;

            default:
                logger.warn("Unknown message type received", {
                    messageType: message.type,
                });
        }
    } catch (error) {
        logger.error("Error handling worker message", {
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined,
        });

        parentPort?.postMessage({
            type: "error",
            message: `Error handling message: ${error instanceof Error ? error.message : String(error)}`,
        });
    }
});
