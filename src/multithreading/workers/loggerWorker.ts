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

type WorkerMessage = LogMessage | SignalMessage | { type: "shutdown" };

parentPort?.on("message", (msg: WorkerMessage) => {
    switch (msg.type) {
        case "log":
            handleLog(msg);
            break;
        case "signal":
            signalLogger.logEvent(msg.event);
            break;
        case "shutdown":
            process.exit(0);
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
