import { parentPort } from "worker_threads";
import { randomUUID } from "crypto";
import { WorkerProxyLogger } from "../shared/workerProxylogger.js";
import { WorkerMetricsProxy } from "../shared/workerMetricsProxy.js";
import { WorkerRateLimiterProxy } from "../shared/workerRateLimiterProxy.js";
import type { EnhancedMetrics } from "../../infrastructure/metricsCollector.js";
import type { IWorkerMetricsCollector } from "../shared/workerInterfaces.js";
import {
    WorkerWebSocketManager,
    type ExtendedWebSocket,
} from "../shared/workerWebSocketManager.js";

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

interface DataStreamMetrics {
    streamConnections: number;
    streamUptime: number;
    streamHealth: string;
    lastStreamData: number;
    reconnectionAttempts: number;
}

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

class DataStreamProxy {
    private metrics: DataStreamMetrics = {
        streamConnections: 0,
        streamUptime: 0,
        streamHealth: "Unknown",
        lastStreamData: 0,
        reconnectionAttempts: 0,
    };

    public setMetrics(m: BinanceWorkerMetrics): void {
        // Add safety checks for undefined connection object
        const connection = m?.connection;
        const streams = m?.streams;

        if (!connection) {
            // Handle case where connection data is missing
            this.metrics = {
                streamConnections: 0,
                streamUptime: 0,
                streamHealth: "Unknown",
                lastStreamData: 0,
                reconnectionAttempts: 0,
            };
            return;
        }

        // Extract stream-related metrics from the binance worker metrics
        this.metrics = {
            streamConnections: 1, // Connected if we're getting metrics
            streamUptime: connection.uptime || 0,
            streamHealth: connection.state || "Unknown",
            lastStreamData: Math.max(
                streams?.health?.lastTradeMessage || 0,
                streams?.health?.lastDepthMessage || 0
            ),
            reconnectionAttempts: connection.reconnectAttempts || 0,
        };
    }

    public getDetailedMetrics(): DataStreamMetrics {
        return this.metrics;
    }
}

// Validate worker thread context
if (!parentPort) {
    // POLICY OVERRIDE: Using console.error for system panic during worker validation
    // REASON: Worker thread validation failure is critical system state - logger not yet available
    console.error(
        "❌ CRITICAL: CommunicationWorker must be run in a worker thread"
    );
    console.error(
        "❌ Application cannot continue without proper worker thread context"
    );
    process.exit(1);
}

const logger = new WorkerProxyLogger("communication");
const metrics = new WorkerMetricsProxy("communication");
const rateLimiter = new WorkerRateLimiterProxy(60000, 100);
const dataStream = new DataStreamProxy();

// Enhanced monitoring
const workerStartTime = Date.now();
const totalRequestsProcessed = 0;
const errorCount = 0;

function updateWorkerMetrics(): void {
    metrics.updateMetric("worker_uptime", Date.now() - workerStartTime);
    metrics.updateMetric("total_requests_processed", totalRequestsProcessed);
    metrics.updateMetric("error_count", errorCount);
    metrics.updateMetric(
        "rate_limiter_remaining",
        rateLimiter.getRemainingRequests()
    );
}

// WebSocket handlers for client connections with isolation
const wsHandlers = {
    ping: (ws: IsolatedWebSocket, _: unknown, correlationId: string = "") => {
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
    backlog: (
        ws: IsolatedWebSocket,
        data: unknown,
        correlationId: string = ""
    ) => {
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
            const workerState = CommunicationWorkerState.getInstance();
            workerState.addPendingRequest(ws.clientId || "unknown", {
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
                    isolatedRequest: true, // Flag for isolated client-specific response
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
// Use module-scoped singleton instead of global variables
class CommunicationWorkerState {
    private static instance: CommunicationWorkerState;
    private readonly connectedClients = new Set<IsolatedWebSocket>();
    private readonly pendingBacklogRequests = new Map<
        string,
        { ws: IsolatedWebSocket; correlationId?: string }
    >();

    static getInstance(): CommunicationWorkerState {
        if (!this.instance) {
            this.instance = new CommunicationWorkerState();
        }
        return this.instance;
    }

    getConnectedClients(): Set<IsolatedWebSocket> {
        return this.connectedClients;
    }

    addClient(client: IsolatedWebSocket): void {
        this.connectedClients.add(client);
    }

    removeClient(client: IsolatedWebSocket): void {
        this.connectedClients.delete(client);
    }

    getPendingBacklogRequests(): Map<
        string,
        { ws: IsolatedWebSocket; correlationId?: string }
    > {
        return this.pendingBacklogRequests;
    }

    addPendingRequest(
        key: string,
        request: { ws: IsolatedWebSocket; correlationId?: string }
    ): void {
        this.pendingBacklogRequests.set(key, request);
    }

    removePendingRequest(key: string): void {
        this.pendingBacklogRequests.delete(key);
    }
}

// Client connection handler with proper isolation
const onClientConnect = (ws: IsolatedWebSocket) => {
    logger.info("Client connected to WebSocket", {
        clientId: ws.clientId,
        connectionTime: Date.now(),
    });

    // Store reference for later backlog/signal sending with client-specific state
    const workerState = CommunicationWorkerState.getInstance();
    workerState.addClient(ws);

    // Create isolated client state to prevent interference
    const clientState = {
        id: ws.clientId || "unknown",
        connectTime: Date.now(),
        lastActivity: Date.now(),
        pendingRequests: new Set<string>(),
    };

    // Store client-specific state (isolated from other clients)
    ws.clientState = clientState;

    // Don't auto-request backlog on connection - let clients explicitly request when needed
    // This prevents interference between dashboard.html and stats.html clients
    logger.info("Client connected - waiting for explicit backlog request", {
        clientId: ws.clientId,
    });

    ws.on("close", () => {
        logger.info("Client disconnecting", {
            clientId: ws.clientId,
            connectionDuration: Date.now() - clientState.connectTime,
        });

        // Clean up client-specific state to prevent memory leaks
        const workerState = CommunicationWorkerState.getInstance();
        workerState.removeClient(ws);

        // Clean up any pending requests for this client
        if (ws.clientId) {
            workerState.removePendingRequest(ws.clientId);
        }

        // Clear client state
        delete ws.clientState;
    });
};

const wsManager = new WorkerWebSocketManager(
    Config.WS_PORT,
    logger, // WorkerProxyLogger - no casting needed
    rateLimiter, // WorkerRateLimiterProxy - no casting needed
    metrics, // WorkerMetricsProxy - no casting needed
    wsHandlers,
    onClientConnect
);

// Enhanced stats broadcaster with MQTT and SignalTracker support
class EnhancedStatsBroadcaster {
    private timer?: NodeJS.Timeout | undefined;
    private mqttClient?: MqttClient | undefined;
    private signalTracker?: SignalTracker;
    private mainThreadMetrics: EnhancedMetrics | null = null;
    private signalTypeBreakdown: SignalBreakdownMessage["data"] | null = null;
    private signalTotals: SignalTotalsMessage["data"] | null = null;
    private zoneAnalytics: ZoneAnalyticsMessage["data"] | null = null;

    constructor(
        private readonly metrics: IWorkerMetricsCollector,
        private readonly dataStream: DataStreamProxy,
        private readonly wsManager: WorkerWebSocketManager,
        private readonly logger: WorkerProxyLogger,
        private readonly intervalMs = 5000
    ) {}

    public setMainThreadMetrics(mainMetrics: EnhancedMetrics): void {
        this.mainThreadMetrics = mainMetrics;
    }

    public setSignalTracker(signalTracker: SignalTracker): void {
        this.signalTracker = signalTracker;
    }

    public setSignalTypeBreakdown(
        breakdown: SignalBreakdownMessage["data"]
    ): void {
        this.signalTypeBreakdown = breakdown;
    }

    public setSignalTotals(totals: SignalTotalsMessage["data"]): void {
        this.signalTotals = totals;
    }

    public setZoneAnalytics(analytics: ZoneAnalyticsMessage["data"]): void {
        this.zoneAnalytics = analytics;
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
                // Merge main thread metrics with worker metrics
                const workerMetrics = this.metrics.getMetrics();
                const mainMetrics = this.mainThreadMetrics;

                // Combine counters and gauges from both sources
                const combinedMetrics = {
                    counters: {
                        ...(workerMetrics.counters || {}),
                        ...(mainMetrics?.counters || {}),
                    },
                    gauges: {
                        ...(workerMetrics.gauges || {}),
                        ...(mainMetrics?.gauges || {}),
                        // Add connection count from active clients
                        connections_active:
                            CommunicationWorkerState.getInstance().getConnectedClients()
                                .size,
                    },
                    histograms: {
                        ...(workerMetrics.histograms || {}),
                        ...(mainMetrics?.histograms || {}),
                    },
                    legacy: {
                        ...(workerMetrics.legacy || {}),
                        ...(mainMetrics?.legacy || {}),
                    },
                };

                const stats = {
                    metrics: combinedMetrics,
                    health: this.metrics.getHealthSummary(),
                    dataStream: this.dataStream.getDetailedMetrics(),
                    signalPerformance:
                        this.signalTracker?.getPerformanceMetrics(86400000), // 24h window
                    signalTrackerStatus: this.signalTracker?.getStatus(),
                    signalTypeBreakdown: this.signalTypeBreakdown || {},
                    signalTotals: this.signalTotals || {
                        candidates: 0,
                        confirmed: 0,
                        rejected: 0,
                    },
                    zoneAnalytics: this.zoneAnalytics || {
                        activeZones: 0,
                        completedZones: 0,
                        avgZoneStrength: 0,
                        avgZoneDuration: 0,
                        zonesByType: {},
                        zonesBySignificance: {},
                    },
                    workers: {
                        loggerWorker: "Running",
                        binanceWorker: "Running",
                        communicationWorker: "Running",
                        wsConnections:
                            CommunicationWorkerState.getInstance().getConnectedClients()
                                .size,
                        streamHealth: "Connected", // This will be updated from binance worker
                    },
                };

                // Broadcast via WebSocket
                this.wsManager.broadcast({
                    type: "stats",
                    data: stats,
                    now: Date.now(),
                });

                // Publish to MQTT if connected
                if (this.mqttClient?.connected) {
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

// Start monitoring interval
const monitoringInterval = setInterval(() => {
    updateWorkerMetrics();
}, 5000); // Update every 5 seconds

interface MetricsMessage {
    type: "metrics";
    data: BinanceWorkerMetrics;
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
        targetClientId?: string;
    };
}

interface SignalTrackerMessage {
    type: "signal_tracker";
    data: SignalTracker;
}

interface MainMetricsMessage {
    type: "main_metrics";
    data: EnhancedMetrics;
}

interface SignalBreakdownMessage {
    type: "signal_breakdown";
    data: {
        absorption: {
            candidates: number;
            confirmed: number;
            rejected: number;
            successRate: string;
        };
        exhaustion: {
            candidates: number;
            confirmed: number;
            rejected: number;
            successRate: string;
        };
        accumulation: {
            candidates: number;
            confirmed: number;
            rejected: number;
            successRate: string;
        };
        distribution: {
            candidates: number;
            confirmed: number;
            rejected: number;
            successRate: string;
        };
        deltacvd: {
            candidates: number;
            confirmed: number;
            rejected: number;
            successRate: string;
        };
    };
}

interface SignalTotalsMessage {
    type: "signal_totals";
    data: {
        candidates: number;
        confirmed: number;
        rejected: number;
    };
}

interface ZoneAnalyticsMessage {
    type: "zone_analytics";
    data: {
        activeZones: number;
        completedZones: number;
        avgZoneStrength: number;
        avgZoneDuration: number;
        zonesByType: Record<string, number>;
        zonesBySignificance: Record<string, number>;
    };
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
    const correlationId = randomUUID();

    try {
        logger.info(
            "Communication worker starting graceful shutdown",
            {
                component: "CommunicationWorker",
                operation: "gracefulShutdown",
                exitCode,
            },
            correlationId
        );

        // Stop monitoring interval
        try {
            clearInterval(monitoringInterval);
        } catch (error) {
            logger.error("Error stopping monitoring interval", {
                error: error instanceof Error ? error.message : String(error),
            });
        }

        // Stop enhanced stats broadcaster
        try {
            statsBroadcaster.stop();
        } catch (error) {
            logger.error("Error stopping enhanced stats broadcaster", {
                error: error instanceof Error ? error.message : String(error),
            });
        }

        // Cleanup proxy classes
        try {
            metrics.destroy();
        } catch (error) {
            logger.error("Error during proxy cleanup", {
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

        logger.info(
            "Communication worker shutdown complete",
            {
                component: "CommunicationWorker",
                operation: "gracefulShutdown",
                exitCode,
            },
            correlationId
        );
        process.exit(exitCode);
    } catch (error) {
        logger.error(
            "Error during communication worker shutdown",
            {
                component: "CommunicationWorker",
                operation: "gracefulShutdown",
                error: error instanceof Error ? error.message : String(error),
                stack: error instanceof Error ? error.stack : undefined,
                exitCode,
            },
            correlationId
        );
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
            | MainMetricsMessage
            | SignalBreakdownMessage
            | SignalTotalsMessage
            | ZoneAnalyticsMessage
            | { type: "shutdown" }
    ) => {
        try {
            if (msg.type === "metrics") {
                try {
                    // Validate metrics structure before processing
                    if (!msg.data || typeof msg.data !== "object") {
                        logger.warn("Received invalid metrics data", {
                            dataType: typeof msg.data,
                            data: JSON.stringify(msg.data),
                        });
                        return;
                    }

                    // Update the data stream proxy with metrics from binance worker
                    dataStream.setMetrics(msg.data);

                    // Also update our local metrics collector with the new data
                    // Update connections count from the new data
                    const connectedClients =
                        CommunicationWorkerState.getInstance().getConnectedClients();
                    metrics.updateMetric(
                        "connections_active",
                        connectedClients.size
                    );

                    // Metrics updated successfully - no logging needed to avoid spam
                } catch (error) {
                    logger.error("Error setting metrics data", {
                        error:
                            error instanceof Error
                                ? error.message
                                : String(error),
                        rawData: JSON.stringify(msg.data),
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
                    // Check if this is an isolated client-specific response
                    const targetClientId = msg.data.targetClientId;

                    if (targetClientId) {
                        // Send only to the specific requesting client (ISOLATED)
                        const pendingRequest =
                            CommunicationWorkerState.getInstance()
                                .getPendingBacklogRequests()
                                .get(targetClientId);
                        if (pendingRequest) {
                            const { ws, correlationId } = pendingRequest;
                            try {
                                // Send backlog
                                ws.send(
                                    JSON.stringify({
                                        type: "backlog",
                                        data: msg.data.backlog,
                                        now: Date.now(),
                                        correlationId,
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
                                            correlationId,
                                        })
                                    );
                                }

                                logger.info(
                                    "Isolated backlog sent to specific client",
                                    {
                                        clientId: targetClientId,
                                        backlogCount:
                                            msg.data.backlog?.length || 0,
                                        signalsCount:
                                            msg.data.signals?.length || 0,
                                    }
                                );

                                // Remove from pending requests
                                CommunicationWorkerState.getInstance().removePendingRequest(
                                    targetClientId
                                );
                            } catch (error) {
                                logger.error(
                                    "Error sending isolated backlog to client",
                                    {
                                        error:
                                            error instanceof Error
                                                ? error.message
                                                : String(error),
                                        clientId: targetClientId,
                                    }
                                );
                            }
                        } else {
                            logger.warn("No pending request found for client", {
                                targetClientId,
                            });
                        }
                    } else {
                        // Legacy behavior: Send backlog to all connected clients (for broadcast scenarios)
                        const connectedClients =
                            CommunicationWorkerState.getInstance().getConnectedClients();
                        if (connectedClients.size > 0) {
                            connectedClients.forEach(
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
                    }

                    // Legacy direct response handling (only if not isolated)
                    if (!targetClientId) {
                        const pendingRequests =
                            CommunicationWorkerState.getInstance().getPendingBacklogRequests();
                        pendingRequests.forEach(
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
                                        "Legacy direct backlog response sent",
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
                                        "Error sending legacy direct backlog response",
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
                        CommunicationWorkerState.getInstance()
                            .getPendingBacklogRequests()
                            .clear();
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
            } else if (msg.type === "main_metrics") {
                try {
                    // Set main thread metrics for stats broadcasting
                    statsBroadcaster.setMainThreadMetrics(msg.data);
                    // Main thread metrics updated successfully - no logging needed to avoid spam
                } catch (error) {
                    logger.error("Error setting main thread metrics", {
                        error:
                            error instanceof Error
                                ? error.message
                                : String(error),
                    });
                }
            } else if (msg.type === "signal_breakdown") {
                try {
                    // Set signal type breakdown for stats broadcasting
                    statsBroadcaster.setSignalTypeBreakdown(msg.data);
                    // Signal breakdown updated successfully - no logging needed to avoid spam
                } catch (error) {
                    logger.error("Error setting signal type breakdown", {
                        error:
                            error instanceof Error
                                ? error.message
                                : String(error),
                    });
                }
            } else if (msg.type === "signal_totals") {
                try {
                    // Set signal totals for stats broadcasting
                    statsBroadcaster.setSignalTotals(msg.data);
                    // Signal totals updated successfully - no logging needed to avoid spam
                } catch (error) {
                    logger.error("Error setting signal totals", {
                        error:
                            error instanceof Error
                                ? error.message
                                : String(error),
                    });
                }
            } else if (msg.type === "zone_analytics") {
                try {
                    // Set zone analytics for stats broadcasting
                    statsBroadcaster.setZoneAnalytics(msg.data);
                    // Zone analytics updated successfully - no logging needed to avoid spam
                } catch (error) {
                    logger.error("Error setting zone analytics", {
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
