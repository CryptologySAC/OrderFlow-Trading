import { parentPort } from "worker_threads";
import { WorkerProxyLogger } from "../shared/workerProxylogger.js";
import { MetricsCollector } from "../../infrastructure/metricsCollector.js";
import { CircuitBreaker } from "../../infrastructure/circuitBreaker.js";
import { BinanceDataFeed } from "../../utils/binance.js";
import { DataStreamManager } from "../../trading/dataStreamManager.js";
import { Config } from "../../core/config.js";

// Use proxy logger that forwards to logger worker
const logger = new WorkerProxyLogger("binance");
const metricsCollector = new MetricsCollector();
const circuitBreaker = new CircuitBreaker(5, 60000, logger);
const binanceFeed = new BinanceDataFeed();
const manager = new DataStreamManager(
    Config.DATASTREAM,
    binanceFeed,
    circuitBreaker,
    logger, // Now this uses the logger worker!
    metricsCollector
);

// Store interval reference for proper cleanup
let metricsInterval: NodeJS.Timeout | null = null;

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
                            parentPort?.postMessage({
                                type: "metrics",
                                data: manager.getDetailedMetrics(),
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
                void gracefulShutdown(0);
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
