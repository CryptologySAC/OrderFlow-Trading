// src/multithreading/shared/workerMessageRouter.ts
import type { Worker } from "worker_threads";
import type { ILogger } from "../../infrastructure/loggerInterface.ts";

/**
 * Message handler function type
 */
type MessageHandler = (msg: unknown, worker: Worker) => void;

/**
 * Message routing statistics
 */
interface RoutingStats {
    totalMessages: number;
    messagesByType: Record<string, number>;
    errorCount: number;
    lastActivity: number;
}

/**
 * Dedicated message router to reduce ThreadManager complexity
 * Handles message routing and queue management
 */
export class WorkerMessageRouter {
    private handlers = new Map<string, MessageHandler>();
    private stats: RoutingStats = {
        totalMessages: 0,
        messagesByType: {},
        errorCount: 0,
        lastActivity: Date.now(),
    };

    constructor(private readonly logger: ILogger) {}
    private messageQueue: Array<{
        msg: unknown;
        worker: Worker;
        timestamp: number;
    }> = [];
    private queueTimer?: NodeJS.Timeout;
    private readonly maxQueueSize = 1000;
    private readonly queueFlushInterval = 10; // 10ms for low latency

    /**
     * Register a message handler for a specific message type
     */
    registerHandler(type: string, handler: MessageHandler): void {
        this.handlers.set(type, handler);
    }

    /**
     * Route a message to the appropriate handler
     */
    routeMessage(msg: unknown, worker: Worker): void {
        this.stats.totalMessages++;
        this.stats.lastActivity = Date.now();

        if (!this.isValidMessage(msg)) {
            this.stats.errorCount++;
            this.logger.warn("Invalid message received by router", {
                message: msg,
                component: "WorkerMessageRouter",
            });
            return;
        }

        const messageType = (msg as { type: string }).type;
        this.stats.messagesByType[messageType] =
            (this.stats.messagesByType[messageType] || 0) + 1;

        // Add to queue for batch processing
        this.addToQueue(msg, worker);
    }

    /**
     * Get routing statistics
     */
    getStats(): RoutingStats {
        return { ...this.stats };
    }

    /**
     * Clear statistics
     */
    clearStats(): void {
        this.stats = {
            totalMessages: 0,
            messagesByType: {},
            errorCount: 0,
            lastActivity: Date.now(),
        };
    }

    /**
     * Shutdown the router and flush any pending messages
     */
    shutdown(): void {
        if (this.queueTimer) {
            clearTimeout(this.queueTimer);
            this.flushQueue(); // Final flush
        }
    }

    private addToQueue(msg: unknown, worker: Worker): void {
        // Check queue size to prevent memory issues
        if (this.messageQueue.length >= this.maxQueueSize) {
            this.logger.warn("Message queue full, dropping oldest messages", {
                queueSize: this.maxQueueSize,
                component: "WorkerMessageRouter",
            });
            this.messageQueue.splice(0, Math.floor(this.maxQueueSize / 2)); // Drop half
        }

        this.messageQueue.push({
            msg,
            worker,
            timestamp: Date.now(),
        });

        // Schedule flush if not already scheduled
        if (!this.queueTimer) {
            this.queueTimer = setTimeout(
                () => this.flushQueue(),
                this.queueFlushInterval
            );
        }
    }

    private flushQueue(): void {
        if (this.messageQueue.length === 0) {
            this.queueTimer = undefined;
            return;
        }

        // Process all queued messages
        const messagesToProcess = [...this.messageQueue];
        this.messageQueue = [];

        for (const { msg, worker } of messagesToProcess) {
            try {
                this.processMessage(msg, worker);
            } catch (error) {
                this.stats.errorCount++;
                this.logger.error("Error processing queued message", {
                    error:
                        error instanceof Error ? error.message : String(error),
                    stack: error instanceof Error ? error.stack : undefined,
                    component: "WorkerMessageRouter",
                });
            }
        }

        this.queueTimer = undefined;
    }

    private processMessage(msg: unknown, worker: Worker): void {
        if (!this.isValidMessage(msg)) {
            return;
        }

        const messageType = (msg as { type: string }).type;
        const handler = this.handlers.get(messageType);

        if (handler) {
            try {
                handler(msg, worker);
            } catch (error) {
                this.stats.errorCount++;
                this.logger.error("Error in message handler", {
                    messageType,
                    error:
                        error instanceof Error ? error.message : String(error),
                    stack: error instanceof Error ? error.stack : undefined,
                    component: "WorkerMessageRouter",
                });
            }
        } else {
            this.logger.warn("No handler registered for message type", {
                messageType,
                component: "WorkerMessageRouter",
            });
        }
    }

    private isValidMessage(msg: unknown): msg is { type: string } {
        return (
            typeof msg === "object" &&
            msg !== null &&
            typeof (msg as { type?: unknown }).type === "string"
        );
    }
}
