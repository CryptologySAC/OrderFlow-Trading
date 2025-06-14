import * as fs from "fs";
import * as path from "path";
import { parentPort } from "worker_threads";
import util from "node:util";
import type { ILogger } from "../../infrastructure/loggerInterface.js";
import {
    ISignalLogger,
    SignalEvent,
} from "../../infrastructure/signalLoggerInterface.js";
import type {
    ProcessedSignal,
    SignalCandidate,
} from "../../types/signalTypes.js";

// Validate worker thread context
if (!parentPort) {
    // POLICY OVERRIDE: Using console.error for system panic during worker validation
    // REASON: Worker thread validation failure is critical system state - logger not yet available
    console.error("❌ CRITICAL: LoggerWorker must be run in a worker thread");
    console.error(
        "❌ Application cannot continue without proper worker thread context"
    );
    process.exit(1);
}

/**
 * Simple Logger implementation for use within the logger worker
 */
class Logger implements ILogger {
    private correlationContext = new Map<string, string>();
    private pretty: boolean;

    constructor(pretty = false) {
        this.pretty = pretty;
    }

    public info(
        message: string,
        context?: Record<string, unknown>,
        correlationId?: string
    ): void {
        this.log("info", message, context, correlationId);
    }

    public error(
        message: string,
        context?: Record<string, unknown>,
        correlationId?: string
    ): void {
        this.log("error", message, context, correlationId);
    }

    public warn(
        message: string,
        context?: Record<string, unknown>,
        correlationId?: string
    ): void {
        this.log("warn", message, context, correlationId);
    }

    public debug(
        message: string,
        context?: Record<string, unknown>,
        correlationId?: string
    ): void {
        this.log("debug", message, context, correlationId);
    }

    public isDebugEnabled(): boolean {
        return process.env.NODE_ENV === "development";
    }

    public setCorrelationId(id: string, context: string): void {
        this.correlationContext.set(id, context);
    }

    public removeCorrelationId(id: string): void {
        this.correlationContext.delete(id);
    }

    private log(
        level: "info" | "error" | "warn" | "debug",
        message: string,
        context?: Record<string, unknown>,
        correlationId?: string
    ): void {
        const timestamp = new Date().toISOString();
        const correlationData = correlationId
            ? {
                  correlationId,
                  correlationContext:
                      this.correlationContext.get(correlationId),
              }
            : {};

        const logEntry = {
            timestamp,
            level,
            message,
            ...correlationData,
            ...context,
        };

        if (this.pretty) {
            // POLICY OVERRIDE: Using console.log for logger worker implementation
            // REASON: This IS the logger worker - it must output to console for logging functionality
            console.log(
                `[${level}] ${message}`,
                context
                    ? util.inspect(context, {
                          colors: true,
                          depth: null,
                          compact: false,
                      })
                    : ""
            );
        } else {
            // POLICY OVERRIDE: Using console.log for logger worker implementation
            // REASON: This IS the logger worker - it must output to console for logging functionality
            console.log(JSON.stringify(logEntry));
        }
    }
}

class SignalLogger implements ISignalLogger {
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
