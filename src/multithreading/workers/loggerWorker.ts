import { parentPort } from "worker_threads";
import { Logger } from "../../infrastructure/logger.js";
import { SignalLogger, type SignalEvent } from "../../services/signalLogger.js";

const logger = new Logger(process.env.NODE_ENV === "development");
const signalLogger = new SignalLogger("./storage/signals.csv", logger);

type LogLevel = "info" | "error" | "warn" | "debug";

interface LogMessage {
    type: "log";
    level: LogLevel;
    message: string;
    context?: Record<string, unknown>;
    correlationId?: string;
}

interface SignalMessage {
    type: "signal";
    event: SignalEvent;
}

interface CorrelationMessage {
    type: "correlation";
    action: "set" | "remove";
    id: string;
    context?: string;
}

type WorkerMessage =
    | LogMessage
    | SignalMessage
    | CorrelationMessage
    | { type: "shutdown" };

// Add global error handlers
process.on("uncaughtException", (error: Error) => {
    logger.error("Uncaught exception in logger worker", {
        error: error.message,
        stack: error.stack,
    });
    gracefulShutdown(1);
});

process.on("unhandledRejection", (reason: unknown) => {
    logger.error("Unhandled promise rejection in logger worker", {
        reason: reason instanceof Error ? reason.message : String(reason),
        stack: reason instanceof Error ? reason.stack : undefined,
    });
    gracefulShutdown(1);
});

function gracefulShutdown(exitCode: number = 0): void {
    try {
        logger.info("Logger worker starting graceful shutdown");

        // Signal logger uses synchronous file operations, no flush needed

        logger.info("Logger worker shutdown complete");
        process.exit(exitCode);
    } catch (error) {
        logger.error("Error during logger worker shutdown", {
            error: error instanceof Error ? error.message : String(error),
        });
        process.exit(1);
    }
}

parentPort?.on("message", (msg: WorkerMessage) => {
    try {
        switch (msg.type) {
            case "log":
                try {
                    handleLog(msg);
                } catch (error) {
                    // Failed to log message - notify parent
                    parentPort?.postMessage({
                        type: "error",
                        message: `Failed to log message: ${error instanceof Error ? error.message : String(error)}`,
                    });
                }
                break;
            case "signal":
                try {
                    signalLogger.logEvent(msg.event);
                } catch (error: unknown) {
                    logger.error("Failed to log signal event", {
                        error:
                            error instanceof Error
                                ? error.message
                                : String(error),
                        event: msg.event,
                    });
                    parentPort?.postMessage({
                        type: "error",
                        message: `Failed to log signal: ${error instanceof Error ? error.message : String(error)}`,
                    });
                }
                break;
            case "correlation":
                try {
                    handleCorrelation(msg);
                } catch (error) {
                    parentPort?.postMessage({
                        type: "error",
                        message: `Failed to handle correlation: ${error instanceof Error ? error.message : String(error)}`,
                    });
                }
                break;
            case "shutdown":
                gracefulShutdown(0);
                break;
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
});

function handleLog(msg: LogMessage): void {
    switch (msg.level) {
        case "info":
            logger.info(msg.message, msg.context, msg.correlationId);
            break;
        case "error":
            logger.error(msg.message, msg.context, msg.correlationId);
            break;
        case "warn":
            logger.warn(msg.message, msg.context, msg.correlationId);
            break;
        case "debug":
            logger.debug(msg.message, msg.context, msg.correlationId);
            break;
    }
}

function handleCorrelation(msg: CorrelationMessage): void {
    switch (msg.action) {
        case "set":
            if (msg.context) {
                logger.setCorrelationId(msg.id, msg.context);
            }
            break;
        case "remove":
            logger.removeCorrelationId(msg.id);
            break;
    }
}
