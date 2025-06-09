import { parentPort } from "worker_threads";
import { Logger } from "../../infrastructure/logger.js";
import { MetricsCollector } from "../../infrastructure/metricsCollector.js";
import { RateLimiter } from "../../infrastructure/rateLimiter.js";
import { WebSocketManager } from "../../websocket/websocketManager.js";
import { StatsBroadcaster } from "../../services/statsBroadcaster.js";
import { Config } from "../../core/config.js";
import type { WebSocketMessage } from "../../utils/interfaces.js";
import type { DataStreamManager } from "../../trading/dataStreamManager.js";

class DataStreamProxy {
    private metrics: unknown = {};
    public setMetrics(m: unknown): void {
        this.metrics = m;
    }
    public getDetailedMetrics(): unknown {
        return this.metrics;
    }
}

const logger = new Logger();
const metrics = new MetricsCollector();
const rateLimiter = new RateLimiter(60000, 100);
const dataStream = new DataStreamProxy();
const wsManager = new WebSocketManager(
    Config.WS_PORT,
    logger,
    rateLimiter,
    metrics,
    {}
);
const statsBroadcaster = new StatsBroadcaster(
    metrics,
    dataStream as unknown as DataStreamManager,
    wsManager,
    logger
);

statsBroadcaster.start();

interface MetricsMessage {
    type: "metrics";
    data: unknown;
}
interface BroadcastMessage {
    type: "broadcast";
    data: WebSocketMessage;
}

// Add global error handlers
process.on("uncaughtException", (error: Error) => {
    logger.error("Uncaught exception in communication worker", {
        error: error.message,
        stack: error.stack,
    });
    void gracefulShutdown(1);
});

process.on("unhandledRejection", (reason: unknown) => {
    logger.error("Unhandled promise rejection in communication worker", {
        reason: reason instanceof Error ? reason.message : String(reason),
        stack: reason instanceof Error ? reason.stack : undefined,
    });
    void gracefulShutdown(1);
});

async function gracefulShutdown(exitCode: number = 0): Promise<void> {
    try {
        logger.info("Communication worker starting graceful shutdown");

        // Stop broadcasting first
        try {
            statsBroadcaster.stop();
        } catch (error) {
            logger.error("Error stopping stats broadcaster", {
                error: error instanceof Error ? error.message : String(error),
            });
        }

        // Shutdown WebSocket manager with timeout
        try {
            const shutdownPromise = wsManager.shutdown();
            const timeoutPromise = new Promise<void>((resolve) => {
                setTimeout(() => resolve(), 5000); // 5 second timeout
            });

            await Promise.race([shutdownPromise, timeoutPromise]);
        } catch (error) {
            logger.error("Error shutting down WebSocket manager", {
                error: error instanceof Error ? error.message : String(error),
            });
        }

        logger.info("Communication worker shutdown complete");
        process.exit(exitCode);
    } catch (error) {
        logger.error("Error during communication worker shutdown", {
            error: error instanceof Error ? error.message : String(error),
        });
        process.exit(1);
    }
}

parentPort?.on(
    "message",
    (msg: MetricsMessage | BroadcastMessage | { type: "shutdown" }) => {
        try {
            if (msg.type === "metrics") {
                try {
                    dataStream.setMetrics(msg.data);
                } catch (error) {
                    logger.error("Error setting metrics data", {
                        error:
                            error instanceof Error
                                ? error.message
                                : String(error),
                    });
                    parentPort?.postMessage({
                        type: "error",
                        message: `Failed to set metrics: ${error instanceof Error ? error.message : String(error)}`,
                    });
                }
            } else if (msg.type === "broadcast") {
                try {
                    wsManager.broadcast(msg.data);
                } catch (error) {
                    logger.error("Error broadcasting message", {
                        error:
                            error instanceof Error
                                ? error.message
                                : String(error),
                        messageData: msg.data,
                    });
                    parentPort?.postMessage({
                        type: "error",
                        message: `Failed to broadcast: ${error instanceof Error ? error.message : String(error)}`,
                    });
                }
            } else if (msg.type === "shutdown") {
                void gracefulShutdown(0);
            }
        } catch (error) {
            logger.error("Error handling worker message", {
                messageType: msg.type,
                error: error instanceof Error ? error.message : String(error),
                stack: error instanceof Error ? error.stack : undefined,
            });

            // Notify parent of error
            parentPort?.postMessage({
                type: "error",
                message: `Error handling ${msg.type} message: ${error instanceof Error ? error.message : String(error)}`,
            });
        }
    }
);
