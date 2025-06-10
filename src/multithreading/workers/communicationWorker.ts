import { parentPort } from "worker_threads";
import { Logger } from "../../infrastructure/logger.js";
import { MetricsCollector } from "../../infrastructure/metricsCollector.js";
import { RateLimiter } from "../../infrastructure/rateLimiter.js";
import {
    WebSocketManager,
    type ExtendedWebSocket,
} from "../../websocket/websocketManager.js";

// Extend the WebSocket interface with client-specific state
interface IsolatedWebSocket extends ExtendedWebSocket {
    clientState?: {
        id: string;
        connectTime: number;
        lastActivity: number;
        pendingRequests: Set<string>;
    };
}
import { Config } from "../../core/config.js";
import type { WebSocketMessage } from "../../utils/interfaces.js";
import mqtt, { MqttClient, ErrorWithReasonCode } from "mqtt";
import type { SignalTracker } from "../../analysis/signalTracker.js";

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

// WebSocket handlers for client connections with isolation
const wsHandlers = {
    ping: (ws: IsolatedWebSocket, _: unknown, correlationId?: string) => {
        // Update client activity tracking
        if (ws.clientState) {
            ws.clientState.lastActivity = Date.now();
        }

        // Respond to ping with pong (exact same format as original)
        try {
            ws.send(
                JSON.stringify({
                    type: "pong",
                    now: Date.now(),
                    correlationId,
                })
            );
        } catch (error) {
            logger.error("Error sending pong response", {
                error: error instanceof Error ? error.message : String(error),
                clientId: ws.clientId,
                correlationId,
            });
        }
    },
    backlog: (ws: IsolatedWebSocket, data: unknown, correlationId?: string) => {
        const startTime = Date.now();
        try {
            let amount = 1000;

            // Validate and parse amount (same validation as original)
            if (data && typeof data === "object" && "amount" in data) {
                const rawAmount = (data as { amount?: string | number }).amount;
                amount = parseInt(rawAmount as string, 10);
                if (
                    !Number.isInteger(amount) ||
                    amount <= 0 ||
                    amount > 100000
                ) {
                    throw new Error("Invalid backlog amount");
                }
            }

            logger.info("Backlog request received from client", {
                amount,
                clientId: ws.clientId,
                correlationId,
            });

            // Store client reference for direct response
            if (!global.pendingBacklogRequests) {
                global.pendingBacklogRequests = new Map();
            }
            global.pendingBacklogRequests.set(ws.clientId || "unknown", {
                ws,
                correlationId,
            });

            // Request backlog from main thread via parent port
            parentPort?.postMessage({
                type: "request_backlog",
                data: {
                    clientId: ws.clientId || "unknown",
                    amount,
                    correlationId,
                    directResponse: true,
                },
            });

            // Track processing time
            const processingTime = Date.now() - startTime;
            metrics.updateMetric("processingLatency", processingTime);
        } catch (error) {
            metrics.incrementMetric("errorsCount");
            logger.error("Error handling backlog request", {
                error: error instanceof Error ? error.message : String(error),
                clientId: ws.clientId,
                correlationId,
            });

            // Send error response to client (same format as original)
            try {
                ws.send(
                    JSON.stringify({
                        type: "error",
                        message: (error as Error).message,
                        correlationId,
                    })
                );
            } catch (sendError) {
                logger.error("Error sending error response", {
                    error:
                        sendError instanceof Error
                            ? sendError.message
                            : String(sendError),
                    clientId: ws.clientId,
                });
            }
        }
    },
};

// Store connected clients and pending requests globally with isolation
declare global {
    var connectedClients: Set<IsolatedWebSocket> | undefined;
    var pendingBacklogRequests:
        | Map<string, { ws: IsolatedWebSocket; correlationId?: string }>
        | undefined;
}

// Client connection handler with proper isolation
const onClientConnect = (ws: IsolatedWebSocket) => {
    logger.info("Client connected to WebSocket", {
        clientId: ws.clientId,
        connectionTime: Date.now(),
    });

    // Store reference for later backlog/signal sending with client-specific state
    if (!global.connectedClients) {
        global.connectedClients = new Set<IsolatedWebSocket>();
    }
    global.connectedClients.add(ws);

    // Create isolated client state to prevent interference
    const clientState = {
        id: ws.clientId || "unknown",
        connectTime: Date.now(),
        lastActivity: Date.now(),
        pendingRequests: new Set<string>(),
    };

    // Store client-specific state (isolated from other clients)
    ws.clientState = clientState;

    // Request backlog and signals from main thread for this new client
    parentPort?.postMessage({
        type: "request_backlog",
        data: {
            clientId: ws.clientId || "unknown",
            amount: 1000,
            isolated: true, // Flag for isolated handling
        },
    });

    ws.on("close", () => {
        logger.info("Client disconnecting", {
            clientId: ws.clientId,
            connectionDuration: Date.now() - clientState.connectTime,
        });

        // Clean up client-specific state to prevent memory leaks
        if (global.connectedClients) {
            global.connectedClients.delete(ws);
        }

        // Clean up any pending requests for this client
        if (global.pendingBacklogRequests && ws.clientId) {
            global.pendingBacklogRequests.delete(ws.clientId);
        }

        // Clear client state
        delete ws.clientState;
    });
};

const wsManager = new WebSocketManager(
    Config.WS_PORT,
    logger,
    rateLimiter,
    metrics,
    wsHandlers,
    onClientConnect
);

// Enhanced stats broadcaster with MQTT and SignalTracker support
class EnhancedStatsBroadcaster {
    private timer?: NodeJS.Timeout;
    private mqttClient?: MqttClient;
    private signalTracker?: SignalTracker;

    constructor(
        private readonly metrics: MetricsCollector,
        private readonly dataStream: DataStreamProxy,
        private readonly wsManager: WebSocketManager,
        private readonly logger: Logger,
        private readonly intervalMs = 5000
    ) {}

    public setSignalTracker(signalTracker: SignalTracker): void {
        this.signalTracker = signalTracker;
    }

    public start(): void {
        this.stop();

        // Initialize MQTT if configured
        if (Config.MQTT?.url) {
            this.initializeMQTT();
        }

        // Start stats broadcasting timer
        this.timer = setInterval(() => {
            try {
                const stats = {
                    metrics: this.metrics.getMetrics(),
                    health: this.metrics.getHealthSummary(),
                    dataStream: this.dataStream.getDetailedMetrics(),
                    signalPerformance:
                        this.signalTracker?.getPerformanceMetrics(86400000), // 24h window
                    signalTrackerStatus: this.signalTracker?.getStatus(),
                };

                // Broadcast via WebSocket
                this.wsManager.broadcast({
                    type: "stats",
                    data: stats,
                    now: Date.now(),
                });

                // Publish to MQTT if connected
                if (this.mqttClient && this.mqttClient.connected) {
                    this.mqttClient.publish(
                        Config.MQTT?.statsTopic ?? "orderflow/stats",
                        JSON.stringify(stats)
                    );
                }
            } catch (err) {
                this.logger.error("Stats broadcast error", {
                    error: err as Error,
                });
            }
        }, this.intervalMs);
    }

    private initializeMQTT(): void {
        if (!Config.MQTT?.url) return;

        const mqttOptions: mqtt.IClientOptions = {
            keepalive: Config.MQTT.keepalive ?? 60,
            connectTimeout: Config.MQTT.connectTimeout ?? 4000,
            reconnectPeriod: Config.MQTT.reconnectPeriod ?? 1000,
            clientId:
                Config.MQTT.clientId ?? `orderflow-dashboard-${Date.now()}`,
            rejectUnauthorized: false,
            protocolVersion: 4,
            clean: true,
        };

        // Add authentication if provided
        if (Config.MQTT.username) {
            mqttOptions.username = Config.MQTT.username;
        }
        if (Config.MQTT.password) {
            mqttOptions.password = Config.MQTT.password;
        }

        this.logger.info("Connecting to MQTT broker", {
            url: Config.MQTT.url,
            clientId: mqttOptions.clientId,
            hasAuth: !!(Config.MQTT.username && Config.MQTT.password),
        });

        this.mqttClient = mqtt.connect(Config.MQTT.url, mqttOptions);

        this.mqttClient.on("connect", () => {
            this.logger.info("MQTT connected successfully", {
                clientId: mqttOptions.clientId,
            });
        });

        this.mqttClient.on("error", (err: ErrorWithReasonCode | Error) => {
            this.logger.error("MQTT connection error", {
                error: err.message,
                code: (err as ErrorWithReasonCode).code,
                url: Config.MQTT?.url ?? undefined,
            });

            if (err.message.includes("SSL") || err.message.includes("EPROTO")) {
                this.logger.warn(
                    "SSL/TLS error detected. Try these alternatives:",
                    {
                        suggestions: [
                            "Use 'ws://' instead of 'wss://' for plain WebSocket",
                            "Use 'mqtt://' for standard MQTT (port 1883)",
                            "Use 'mqtts://' for MQTT over TLS (port 8883)",
                            "Check if broker supports WebSocket on this port",
                        ],
                    }
                );
            }
        });

        this.mqttClient.on("close", () => {
            this.logger.warn("MQTT connection closed");
        });

        this.mqttClient.on("reconnect", () => {
            this.logger.info("MQTT reconnecting...");
        });
    }

    public stop(): void {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = undefined;
        }
        if (this.mqttClient) {
            this.mqttClient.end(true);
            this.mqttClient = undefined;
        }
    }
}

const statsBroadcaster = new EnhancedStatsBroadcaster(
    metrics,
    dataStream,
    wsManager,
    logger
);

// Start only the original stats broadcaster (remove duplicate broadcasting)
statsBroadcaster.start();

interface MetricsMessage {
    type: "metrics";
    data: unknown;
}
interface BroadcastMessage {
    type: "broadcast";
    data: WebSocketMessage;
}

interface BacklogMessage {
    type: "send_backlog";
    data: {
        backlog: unknown[];
        signals: unknown[];
    };
}

interface SignalTrackerMessage {
    type: "signal_tracker";
    data: SignalTracker;
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

        // Stop enhanced stats broadcaster first
        try {
            statsBroadcaster.stop();
        } catch (error) {
            logger.error("Error stopping enhanced stats broadcaster", {
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
    (
        msg:
            | MetricsMessage
            | BroadcastMessage
            | BacklogMessage
            | SignalTrackerMessage
            | { type: "shutdown" }
    ) => {
        try {
            if (msg.type === "metrics") {
                try {
                    // Update the data stream proxy with metrics from binance worker
                    dataStream.setMetrics(msg.data);

                    // Also update our local metrics collector with the new data
                    if (msg.data && typeof msg.data === "object") {
                        // Update connections count from the new data
                        if (global.connectedClients) {
                            metrics.updateMetric(
                                "connections_active",
                                global.connectedClients.size
                            );
                        }

                        logger.debug("Updated metrics from binance worker", {
                            dataSize: JSON.stringify(msg.data).length,
                            connectionCount: global.connectedClients?.size || 0,
                        });
                    }
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
            } else if (msg.type === "send_backlog") {
                try {
                    // Send backlog and signals to all connected clients (isolated)
                    if (global.connectedClients) {
                        global.connectedClients.forEach(
                            (ws: IsolatedWebSocket) => {
                                try {
                                    // Send backlog
                                    ws.send(
                                        JSON.stringify({
                                            type: "backlog",
                                            data: msg.data.backlog,
                                            now: Date.now(),
                                        })
                                    );

                                    // Send signal backlog
                                    if (
                                        msg.data.signals &&
                                        msg.data.signals.length > 0
                                    ) {
                                        ws.send(
                                            JSON.stringify({
                                                type: "signal_backlog",
                                                data: msg.data.signals,
                                                now: Date.now(),
                                            })
                                        );
                                    }
                                } catch (error) {
                                    logger.error(
                                        "Error sending backlog to client",
                                        {
                                            error:
                                                error instanceof Error
                                                    ? error.message
                                                    : String(error),
                                        }
                                    );
                                }
                            }
                        );
                    }

                    // Check for pending direct responses
                    if (global.pendingBacklogRequests) {
                        global.pendingBacklogRequests.forEach(
                            ({ ws, correlationId }, clientId) => {
                                try {
                                    // Send direct backlog response
                                    ws.send(
                                        JSON.stringify({
                                            type: "backlog",
                                            data: msg.data.backlog,
                                            now: Date.now(),
                                            correlationId,
                                        })
                                    );

                                    // Send direct signal backlog response
                                    if (
                                        msg.data.signals &&
                                        msg.data.signals.length > 0
                                    ) {
                                        ws.send(
                                            JSON.stringify({
                                                type: "signal_backlog",
                                                data: msg.data.signals,
                                                now: Date.now(),
                                                correlationId,
                                            })
                                        );
                                    }

                                    logger.info(
                                        "Direct backlog response sent",
                                        {
                                            clientId,
                                            backlogCount:
                                                msg.data.backlog?.length || 0,
                                            signalsCount:
                                                msg.data.signals?.length || 0,
                                            correlationId,
                                        }
                                    );
                                } catch (error) {
                                    logger.error(
                                        "Error sending direct backlog response",
                                        {
                                            error:
                                                error instanceof Error
                                                    ? error.message
                                                    : String(error),
                                            clientId,
                                            correlationId,
                                        }
                                    );
                                }
                            }
                        );

                        // Clear pending requests after sending
                        global.pendingBacklogRequests.clear();
                    }
                } catch (error) {
                    logger.error("Error handling backlog message", {
                        error:
                            error instanceof Error
                                ? error.message
                                : String(error),
                    });
                }
            } else if (msg.type === "signal_tracker") {
                try {
                    // Set the SignalTracker instance for enhanced stats broadcasting
                    statsBroadcaster.setSignalTracker(msg.data);
                    logger.info("SignalTracker set in communication worker");
                } catch (error) {
                    logger.error("Error setting SignalTracker", {
                        error:
                            error instanceof Error
                                ? error.message
                                : String(error),
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
