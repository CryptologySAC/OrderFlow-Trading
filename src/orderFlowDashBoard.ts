import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

import express from "express";
import * as path from "node:path";
import * as ws from "ws";
import { SpotWebsocketStreams } from "@binance/spot";
import { TradesProcessor } from "./tradesProcessor.js";
import { BinanceDataFeed, IBinanceDataFeed } from "./binance.js";
import {
    OrderBookProcessor,
    IOrderBookProcessor,
} from "./orderBookProcessor.js";
import { Signal, WebSocketMessage, Detected } from "./interfaces.js";
import { Storage } from "./storage.js";
import {
    AbsorptionDetector,
    AbsorptionSettings,
} from "./absorptionDetector.js";
import {
    ExhaustionDetector,
    ExhaustionSettings,
} from "./exhaustionDetector.js";
import { DeltaCVDConfirmation } from "./deltaCVDCOnfirmation.js";
import { SwingPredictor, SwingPrediction } from "./swingPredictor.js";
import { parseBool } from "./utils.js";
import { SignalLogger, ISignalLogger } from "./signalLogger.js";

import { EventEmitter } from "events";
import { randomUUID } from "crypto";
EventEmitter.defaultMaxListeners = 20;

// Enhanced Error Types
class SignalProcessingError extends Error {
    constructor(
        message: string,
        public readonly context: Record<string, unknown>,
        public readonly correlationId?: string
    ) {
        super(message);
        this.name = "SignalProcessingError";
    }
}

class WebSocketError extends Error {
    constructor(
        message: string,
        public readonly clientId: string,
        public readonly correlationId?: string
    ) {
        super(message);
        this.name = "WebSocketError";
    }
}

class ConnectionError extends Error {
    constructor(
        message: string,
        public readonly service: string,
        public readonly correlationId?: string
    ) {
        super(message);
        this.name = "ConnectionError";
    }
}

// Configuration Management
class Config {
    static readonly SYMBOL = (process.env.SYMBOL ?? "LTCUSDT").toUpperCase();
    static readonly HTTP_PORT = parseInt(process.env.PORT ?? "3000", 10);
    static readonly WS_PORT = parseInt(process.env.WS_PORT ?? "3001", 10);
    static readonly WEBHOOK_URL = process.env.WEBHOOK_URL;

    // Exhaustion Settings
    static readonly EXHAUSTION_WINDOW_MS = parseInt(
        process.env.EXHAUSTION_WINDOW_MS ?? "90000",
        10
    );
    static readonly EXHAUSTION_MIN_AGG_VOLUME = parseInt(
        process.env.EXHAUSTION_MIN_AGG_VOLUME ?? "600",
        10
    );
    static readonly EXHAUSTION_PRICE_PRECISION = parseInt(
        process.env.EXHAUSTION_PRICE_PRECISION ?? "2",
        10
    );
    static readonly EXHAUSTION_ZONE_TICKS = parseInt(
        process.env.EXHAUSTION_ZONE_TICKS ?? "3",
        10
    );
    static readonly EXHAUSTION_EVENT_COOLDOWN_MS = parseInt(
        process.env.EXHAUSTION_EVENT_COOLDOWN_MS ?? "15000",
        10
    );
    static readonly EXHAUSTION_MOVE_TICKS = parseInt(
        process.env.EXHAUSTION_MOVE_TICKS ?? "12",
        10
    );
    static readonly EXHAUSTION_CONFIRMATION_TIMEOUT = parseInt(
        process.env.EXHAUSTION_CONFIRMATION_TIMEOUT ?? "60000",
        10
    );
    static readonly EXHAUSTION_MAX_REVISIT_TICKS = parseInt(
        process.env.EXHAUSTION_MAX_REVISIT_TICKS ?? "5",
        10
    );

    // Absorption Settings
    static readonly ABSORPTION_WINDOW_MS = parseInt(
        process.env.ABSORPTION_WINDOW_MS ?? "90000",
        10
    );
    static readonly ABSORPTION_MIN_AGG_VOLUME = parseInt(
        process.env.ABSORPTION_MIN_AGG_VOLUME ?? "600",
        10
    );
    static readonly ABSORPTION_PRICE_PRECISION = parseInt(
        process.env.ABSORPTION_PRICE_PRECISION ?? "2",
        10
    );
    static readonly ABSORPTION_ZONE_TICKS = parseInt(
        process.env.ABSORPTION_ZONE_TICKS ?? "3",
        10
    );
    static readonly ABSORPTION_EVENT_COOLDOWN_MS = parseInt(
        process.env.ABSORPTION_EVENT_COOLDOWN_MS ?? "15000",
        10
    );
    static readonly ABSORPTION_MOVE_TICKS = parseInt(
        process.env.ABSORPTION_MOVE_TICKS ?? "12",
        10
    );
    static readonly ABSORPTION_CONFIRMATION_TIMEOUT = parseInt(
        process.env.ABSORPTION_CONFIRMATION_TIMEOUT ?? "60000",
        10
    );
    static readonly ABSORPTION_MAX_REVISIT_TICKS = parseInt(
        process.env.ABSORPTION_MAX_REVISIT_TICKS ?? "5",
        10
    );

    static validate(): void {
        const requiredEnvVars = ["SYMBOL"];
        const missing = requiredEnvVars.filter(
            (envVar) => !process.env[envVar]
        );

        if (missing.length > 0) {
            throw new Error(
                `Missing required environment variables: ${missing.join(", ")}`
            );
        }

        if (this.HTTP_PORT < 1 || this.HTTP_PORT > 65535) {
            throw new Error(`Invalid HTTP_PORT: ${this.HTTP_PORT}`);
        }

        if (this.WS_PORT < 1 || this.WS_PORT > 65535) {
            throw new Error(`Invalid WS_PORT: ${this.WS_PORT}`);
        }
    }
}

// Circuit Breaker Implementation
enum CircuitState {
    CLOSED = "CLOSED",
    OPEN = "OPEN",
    HALF_OPEN = "HALF_OPEN",
}

class CircuitBreaker {
    private state: CircuitState = CircuitState.CLOSED;
    private failureCount = 0;
    private lastFailureTime = 0;
    private successCount = 0;

    constructor(
        private readonly threshold: number = 5,
        private readonly timeout: number = 60000,
        private readonly monitoringPeriod: number = 10000
    ) {}

    async execute<T>(
        operation: () => Promise<T>,
        correlationId?: string
    ): Promise<T> {
        if (this.state === CircuitState.OPEN) {
            if (Date.now() - this.lastFailureTime > this.timeout) {
                this.state = CircuitState.HALF_OPEN;
                this.successCount = 0;
            } else {
                throw new Error(
                    `Circuit breaker is OPEN. Correlation ID: ${correlationId}`
                );
            }
        }

        try {
            const result = await operation();
            this.onSuccess();
            return result;
        } catch (error) {
            this.onFailure();
            throw error;
        }
    }

    private onSuccess(): void {
        this.failureCount = 0;
        if (this.state === CircuitState.HALF_OPEN) {
            this.successCount++;
            if (this.successCount >= 3) {
                this.state = CircuitState.CLOSED;
            }
        }
    }

    private onFailure(): void {
        this.failureCount++;
        this.lastFailureTime = Date.now();
        if (this.failureCount >= this.threshold) {
            this.state = CircuitState.OPEN;
        }
    }

    getState(): CircuitState {
        return this.state;
    }
}

// Enhanced Interfaces
interface IStorage {
    purgeOldEntries(): void;
}

interface ITradesProcessor {
    addTrade(data: SpotWebsocketStreams.AggTradeResponse): WebSocketMessage;
    requestBacklog(amount: number): unknown[];
    fillBacklog(): Promise<void>;
}

// Rate Limiter
class RateLimiter {
    private requests = new Map<string, number[]>();

    constructor(
        private readonly windowMs: number = 60000,
        private readonly maxRequests: number = 100
    ) {
        // Cleanup old entries every minute
        setInterval(() => this.cleanup(), this.windowMs);
    }

    isAllowed(clientId: string): boolean {
        const now = Date.now();
        const clientRequests = this.requests.get(clientId) || [];

        // Remove old requests outside the window
        const validRequests = clientRequests.filter(
            (time) => now - time < this.windowMs
        );

        if (validRequests.length >= this.maxRequests) {
            return false;
        }

        validRequests.push(now);
        this.requests.set(clientId, validRequests);
        return true;
    }

    private cleanup(): void {
        const now = Date.now();
        for (const [clientId, requests] of this.requests.entries()) {
            const validRequests = requests.filter(
                (time) => now - time < this.windowMs
            );
            if (validRequests.length === 0) {
                this.requests.delete(clientId);
            } else {
                this.requests.set(clientId, validRequests);
            }
        }
    }
}

// Metrics Collection
interface Metrics {
    signalsGenerated: number;
    connectionsActive: number;
    processingLatency: number[];
    errorsCount: number;
    circuitBreakerState: string;
    uptime: number;
}

class MetricsCollector {
    private metrics: Metrics = {
        signalsGenerated: 0,
        connectionsActive: 0,
        processingLatency: [],
        errorsCount: 0,
        circuitBreakerState: "CLOSED",
        uptime: Date.now(),
    };

    updateMetric(metric: keyof Metrics, value: number | string): void {
        if (metric === "processingLatency" && typeof value === "number") {
            this.metrics.processingLatency.push(value);
            // Keep only last 1000 entries
            if (this.metrics.processingLatency.length > 1000) {
                this.metrics.processingLatency =
                    this.metrics.processingLatency.slice(-1000);
            }
        } else if (typeof value === "number") {
            (this.metrics[metric] as number) = value;
        } else if (typeof value === "string") {
            (this.metrics[metric] as string) = value;
        }
    }

    incrementMetric(metric: keyof Metrics): void {
        if (typeof this.metrics[metric] === "number") {
            this.metrics[metric]++;
        }
    }

    getMetrics(): Metrics {
        return {
            ...this.metrics,
            uptime: Date.now() - this.metrics.uptime,
        };
    }

    getAverageLatency(): number {
        const latencies = this.metrics.processingLatency;
        return latencies.length > 0
            ? latencies.reduce((a, b) => a + b, 0) / latencies.length
            : 0;
    }
}

// Enhanced Logger
class Logger {
    private correlationContext = new Map<string, string>();

    info(
        message: string,
        context?: Record<string, unknown>,
        correlationId?: string
    ): void {
        this.log("INFO", message, context, correlationId);
    }

    error(
        message: string,
        context?: Record<string, unknown>,
        correlationId?: string
    ): void {
        this.log("ERROR", message, context, correlationId);
    }

    warn(
        message: string,
        context?: Record<string, unknown>,
        correlationId?: string
    ): void {
        this.log("WARN", message, context, correlationId);
    }

    private log(
        level: string,
        message: string,
        context?: Record<string, unknown>,
        correlationId?: string
    ): void {
        const timestamp = new Date().toISOString();
        const logEntry = {
            timestamp,
            level,
            message,
            correlationId,
            ...context,
        };

        console.log(JSON.stringify(logEntry));
    }

    setCorrelationId(id: string, context: string): void {
        this.correlationContext.set(id, context);
    }

    removeCorrelationId(id: string): void {
        this.correlationContext.delete(id);
    }
}

function isValidWSRequest(
    obj: unknown
): obj is { type: string; data?: unknown } {
    return (
        typeof obj === "object" &&
        obj !== null &&
        "type" in obj &&
        typeof (obj as { type: unknown }).type === "string"
    );
}

// Dependencies Interface
interface Dependencies {
    storage: IStorage;
    binanceFeed: IBinanceDataFeed;
    tradesProcessor: ITradesProcessor;
    orderBookProcessor: IOrderBookProcessor;
    signalLogger: ISignalLogger;
    logger: Logger;
    metricsCollector: MetricsCollector;
    rateLimiter: RateLimiter;
    circuitBreaker: CircuitBreaker;
}

type WS = ws.WebSocket;
interface ExtendedWebSocket extends WS {
    clientId?: string;
    correlationId?: string;
}

type WSHandler<T = unknown> = (
    ws: ExtendedWebSocket,
    data: T,
    correlationId?: string
) => void | Promise<void>;

export class OrderFlowDashboard {
    private readonly intervalMs: number = 10 * 60 * 1000; // 10 minutes
    private readonly httpServer: express.Application = express();
    private readonly BroadCastWebSocket: ws.WebSocketServer;
    private readonly absorptionDetector: AbsorptionDetector;
    private readonly exhaustionDetector: ExhaustionDetector;
    private readonly deltaCVDConfirmation: DeltaCVDConfirmation;
    private isShuttingDown = false;
    private activeConnections = new Set<ExtendedWebSocket>();

    private swingPredictor = new SwingPredictor({
        lookaheadMs: 10000,
        retraceTicks: 1,
        pricePrecision: 2,
        signalCooldownMs: 1000,
        onSwingPredicted: this.handleSwingPrediction.bind(this),
    });

    private readonly exhaustionSettings: ExhaustionSettings = {
        windowMs: Config.EXHAUSTION_WINDOW_MS,
        minAggVolume: Config.EXHAUSTION_MIN_AGG_VOLUME,
        pricePrecision: Config.EXHAUSTION_PRICE_PRECISION,
        zoneTicks: Config.EXHAUSTION_ZONE_TICKS,
        eventCooldownMs: Config.EXHAUSTION_EVENT_COOLDOWN_MS,
        minInitialMoveTicks: Config.EXHAUSTION_MOVE_TICKS,
        confirmationTimeoutMs: Config.EXHAUSTION_CONFIRMATION_TIMEOUT,
        maxRevisitTicks: Config.EXHAUSTION_MAX_REVISIT_TICKS,
        features: {
            spoofingDetection: parseBool(
                process.env.EXHAUSTION_SPOOFING_DETECTION,
                true
            ),
            adaptiveZone: parseBool(process.env.EXHAUSTION_ADAPTIVE_ZONE, true),
            passiveHistory: parseBool(
                process.env.EXHAUSTION_PASSIVE_HISTORY,
                true
            ),
            multiZone: parseBool(process.env.EXHAUSTION_MULTI_ZONE, true),
            priceResponse: parseBool(
                process.env.EXHAUSTION_PRICE_RESPONSE,
                true
            ),
            sideOverride: parseBool(
                process.env.EXHAUSTION_SIDE_OVERRIDE,
                false
            ),
            autoCalibrate: parseBool(
                process.env.EXHAUSTION_AUTO_CALIBRATE,
                true
            ),
        },
    };

    private readonly absorptionSettings: AbsorptionSettings = {
        windowMs: Config.ABSORPTION_WINDOW_MS,
        minAggVolume: Config.ABSORPTION_MIN_AGG_VOLUME,
        pricePrecision: Config.ABSORPTION_PRICE_PRECISION,
        zoneTicks: Config.ABSORPTION_ZONE_TICKS,
        eventCooldownMs: Config.ABSORPTION_EVENT_COOLDOWN_MS,
        minInitialMoveTicks: Config.ABSORPTION_MOVE_TICKS,
        confirmationTimeoutMs: Config.ABSORPTION_CONFIRMATION_TIMEOUT,
        maxRevisitTicks: Config.ABSORPTION_MAX_REVISIT_TICKS,
        features: {
            spoofingDetection: parseBool(
                process.env.ABSORPTION_SPOOFING_DETECTION,
                true
            ),
            adaptiveZone: parseBool(process.env.ABSORPTION_ADAPTIVE_ZONE, true),
            passiveHistory: parseBool(
                process.env.ABSORPTION_PASSIVE_HISTORY,
                true
            ),
            multiZone: parseBool(process.env.ABSORPTION_MULTI_ZONE, true),
            priceResponse: parseBool(
                process.env.ABSORPTION_PRICE_RESPONSE,
                true
            ),
            sideOverride: parseBool(
                process.env.ABSORPTION_SIDE_OVERRIDE,
                false
            ),
            autoCalibrate: parseBool(
                process.env.ABSORPTION_AUTO_CALIBRATE,
                true
            ),
        },
    };

    private wsHandlers: Record<string, WSHandler> = {
        ping: (ws, _, correlationId) => {
            ws.send(
                JSON.stringify({
                    type: "pong",
                    now: Date.now(),
                    correlationId,
                })
            );
        },
        backlog: (ws, data, correlationId) => {
            const startTime = Date.now();
            try {
                let amount = 1000;
                if (data && typeof data === "object" && "amount" in data) {
                    const rawAmount = (data as { amount?: string | number })
                        .amount;
                    amount = parseInt(rawAmount as string, 10);
                    if (
                        !Number.isInteger(amount) ||
                        amount <= 0 ||
                        amount > 100000
                    ) {
                        throw new WebSocketError(
                            "Invalid backlog amount",
                            ws.clientId || "unknown",
                            correlationId
                        );
                    }
                }

                let backlog =
                    this.dependencies.tradesProcessor.requestBacklog(amount);
                backlog = backlog.reverse();
                ws.send(
                    JSON.stringify({
                        type: "backlog",
                        data: backlog,
                        now: Date.now(),
                        correlationId,
                    })
                );

                const processingTime = Date.now() - startTime;
                this.dependencies.metricsCollector.updateMetric(
                    "processingLatency",
                    processingTime
                );
            } catch (error) {
                this.dependencies.metricsCollector.incrementMetric(
                    "errorsCount"
                );
                this.handleError(
                    error as Error,
                    "backlog_handler",
                    correlationId
                );
                ws.send(
                    JSON.stringify({
                        type: "error",
                        message: (error as Error).message,
                        correlationId,
                    })
                );
            }
        },
    };

    constructor(
        private dependencies: Dependencies,
        private delayFn: (cb: () => void, ms: number) => unknown = setTimeout
    ) {
        // Validate configuration
        Config.validate();

        this.exhaustionDetector = new ExhaustionDetector(
            (data) =>
                void this.handleDetection(
                    () => this.onExhaustionDetected(data),
                    "exhaustion"
                ),
            this.exhaustionSettings,
            dependencies.signalLogger
        );

        this.absorptionDetector = new AbsorptionDetector(
            (data) =>
                void this.handleDetection(
                    () => this.onAbsorptionDetected(data),
                    "absorption"
                ),
            this.absorptionSettings,
            dependencies.signalLogger
        );

        this.deltaCVDConfirmation = new DeltaCVDConfirmation(
            (confirmed) => {
                const correlationId = randomUUID();
                try {
                    const confirmedSignal: Signal = {
                        type: `${confirmed.confirmedType}_confirmed` as Signal["type"],
                        time: confirmed.time,
                        price: confirmed.price,
                        takeProfit: confirmed.price * 1.01,
                        stopLoss: confirmed.price * 0.99,
                        closeReason: confirmed.reason,
                    };

                    this.swingPredictor.onSignal(confirmedSignal);
                } catch (error) {
                    this.handleError(
                        error as Error,
                        "delta_cvd_confirmation",
                        correlationId
                    );
                }
            },
            {
                lookback: 90,
                cvdLength: 20,
                slopeThreshold: 0.08,
                deltaThreshold: 30,
            }
        );

        this.BroadCastWebSocket = new ws.WebSocketServer({
            port: Config.WS_PORT,
        });
        this.setupWebSocketServer();
        this.setupHealthCheck();
        this.setupGracefulShutdown();
        this.broadcastMessage = this.broadcastMessage.bind(this);
    }

    private setupWebSocketServer(): void {
        this.BroadCastWebSocket.on("connection", (ws: ExtendedWebSocket) => {
            const clientId = randomUUID();
            const correlationId = randomUUID();

            ws.clientId = clientId;
            ws.correlationId = correlationId;
            this.activeConnections.add(ws);

            this.dependencies.metricsCollector.updateMetric(
                "connectionsActive",
                this.activeConnections.size
            );
            this.dependencies.logger.info(
                "Client connected",
                { clientId },
                correlationId
            );

            ws.on("close", () => {
                this.activeConnections.delete(ws);
                this.dependencies.metricsCollector.updateMetric(
                    "connectionsActive",
                    this.activeConnections.size
                );
                this.dependencies.logger.info(
                    "Client disconnected",
                    { clientId },
                    correlationId
                );
            });

            ws.on("message", (message) => this.handleWSMessage(ws, message));

            ws.on("error", (error) => {
                this.handleError(error, "websocket_connection", correlationId);
            });
        });
    }

    private setupHealthCheck(): void {
        this.httpServer.get("/health", (req, res) => {
            const correlationId = randomUUID();
            try {
                const metrics = this.dependencies.metricsCollector.getMetrics();
                const health = {
                    status: "healthy",
                    timestamp: new Date().toISOString(),
                    uptime: process.uptime(),
                    connections: this.activeConnections.size,
                    circuitBreakerState:
                        this.dependencies.circuitBreaker.getState(),
                    metrics: {
                        signalsGenerated: metrics.signalsGenerated,
                        averageLatency:
                            this.dependencies.metricsCollector.getAverageLatency(),
                        errorsCount: metrics.errorsCount,
                    },
                    correlationId,
                };

                res.json(health);
                this.dependencies.logger.info(
                    "Health check requested",
                    health,
                    correlationId
                );
            } catch (error) {
                this.handleError(error as Error, "health_check", correlationId);
                res.status(500).json({
                    status: "unhealthy",
                    error: (error as Error).message,
                    correlationId,
                });
            }
        });
    }

    private setupGracefulShutdown(): void {
        const gracefulShutdown = (signal: string) => {
            this.dependencies.logger.info(
                `Received ${signal}, starting graceful shutdown`
            );
            this.isShuttingDown = true;

            // Close WebSocket server
            this.BroadCastWebSocket.close(() => {
                this.dependencies.logger.info("WebSocket server closed");
            });

            // Close all active connections
            this.activeConnections.forEach((ws) => {
                ws.close(1001, "Server shutting down");
            });

            // Give some time for cleanup
            setTimeout(() => {
                this.dependencies.logger.info("Graceful shutdown completed");
                process.exit(0);
            }, 5000);
        };

        process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
        process.on("SIGINT", () => gracefulShutdown("SIGINT"));
    }

    private handleError(
        error: Error,
        context: string,
        correlationId?: string
    ): void {
        this.dependencies.metricsCollector.incrementMetric("errorsCount");

        const errorContext = {
            context,
            errorName: error.name,
            errorMessage: error.message,
            stack: error.stack,
            timestamp: new Date().toISOString(),
            correlationId: correlationId || randomUUID(),
        };

        if (
            error instanceof SignalProcessingError ||
            error instanceof WebSocketError ||
            error instanceof ConnectionError
        ) {
            errorContext.correlationId = error.correlationId ?? randomUUID();
        }

        this.dependencies.logger.error(
            `[${context}] ${error.message}`,
            errorContext,
            correlationId
        );
    }

    private async handleDetection(
        detectionFn: () => Promise<void>,
        type: string
    ): Promise<void> {
        const correlationId = randomUUID();
        try {
            await this.dependencies.circuitBreaker.execute(
                detectionFn,
                correlationId
            );
        } catch {
            this.handleError(
                new SignalProcessingError(
                    `${type} detection failed`,
                    { type },
                    correlationId
                ),
                "signal_detection",
                correlationId
            );
        }
    }

    private handleWSMessage(ws: ExtendedWebSocket, message: ws.RawData): void {
        const correlationId = randomUUID();

        if (
            !this.dependencies.rateLimiter.isAllowed(ws.clientId || "unknown")
        ) {
            ws.send(
                JSON.stringify({
                    type: "error",
                    message: "Rate limit exceeded",
                    correlationId,
                })
            );
            return;
        }

        let raw: string;
        try {
            if (typeof message === "string") raw = message;
            else if (message instanceof Buffer) raw = message.toString();
            else
                throw new WebSocketError(
                    "Unexpected message format",
                    ws.clientId || "unknown",
                    correlationId
                );

            const parsed: unknown = JSON.parse(raw);
            if (!isValidWSRequest(parsed)) {
                throw new WebSocketError(
                    "Invalid message shape",
                    ws.clientId || "unknown",
                    correlationId
                );
            }

            const { type, data } = parsed;
            const handler = this.wsHandlers[type];
            if (!handler) {
                ws.send(
                    JSON.stringify({
                        type: "error",
                        message: "Unknown request type",
                        correlationId,
                    })
                );
                return;
            }

            Promise.resolve(handler(ws, data, correlationId)).catch(
                (err: Error) => {
                    this.handleError(err, `ws_handler_${type}`, correlationId);
                    ws.send(
                        JSON.stringify({
                            type: "error",
                            message: err.message,
                            correlationId,
                        })
                    );
                }
            );
        } catch (err) {
            this.handleError(err as Error, "ws_message_parse", correlationId);
            ws.send(
                JSON.stringify({
                    type: "error",
                    message: (err as Error).message,
                    correlationId,
                })
            );
        }
    }

    private startWebServer(): void {
        const publicPath = path.join(__dirname, "../public");
        this.dependencies.logger.info("Serving static files from", {
            publicPath,
        });
        this.httpServer.use(express.static(publicPath));
        this.httpServer.listen(Config.HTTP_PORT, () => {
            this.dependencies.logger.info(
                `Server running at http://localhost:${Config.HTTP_PORT}`
            );
        });
    }

    private async preloadTrades(): Promise<void> {
        const correlationId = randomUUID();
        try {
            await this.dependencies.circuitBreaker.execute(
                () => this.dependencies.tradesProcessor.fillBacklog(),
                correlationId
            );
        } catch {
            this.handleError(
                new ConnectionError(
                    "Error preloading trades",
                    "trades_processor",
                    correlationId
                ),
                "preload_trades",
                correlationId
            );
        }
    }

    private async fetchInitialOrderBook(): Promise<void> {
        const correlationId = randomUUID();
        try {
            await this.dependencies.circuitBreaker.execute(
                () =>
                    this.dependencies.orderBookProcessor.fetchInitialOrderBook(),
                correlationId
            );
        } catch {
            this.handleError(
                new ConnectionError(
                    "Error preloading order book",
                    "order_book_processor",
                    correlationId
                ),
                "fetch_initial_orderbook",
                correlationId
            );
        }
    }

    private sendToClients(message: WebSocketMessage): void {
        if (this.isShuttingDown) return;

        this.BroadCastWebSocket.clients.forEach((client) => {
            if (client.readyState === WebSocket.OPEN) {
                try {
                    client.send(JSON.stringify(message));
                } catch (error) {
                    this.handleError(error as Error, "send_to_client");
                }
            }
        });
    }

    private broadcastMessage(message: WebSocketMessage): void {
        try {
            this.sendToClients(message);
        } catch (error) {
            this.handleError(error as Error, "broadcast_message");
        }
    }

    private async getFromBinanceAPI(): Promise<void> {
        const correlationId = randomUUID();

        try {
            const connection = await this.dependencies.circuitBreaker.execute(
                () => this.dependencies.binanceFeed.connectToStreams(),
                correlationId
            );

            connection.on("close", (): void => {
                if (this.isShuttingDown) return;

                this.dependencies.logger.warn(
                    "Stream closed. Attempting reconnect in 5s...",
                    {},
                    correlationId
                );
                this.delayFn(() => {
                    this.getFromBinanceAPI().catch(() => {
                        this.handleError(
                            new ConnectionError(
                                "Reconnection failed",
                                "binance_api",
                                correlationId
                            ),
                            "binance_reconnect",
                            correlationId
                        );
                    });
                }, 5000);
            });

            const streamAggTrade = connection.aggTrade({
                symbol: Config.SYMBOL,
            });
            const streamDepth = connection.diffBookDepth({
                symbol: Config.SYMBOL,
                updateSpeed: "100ms",
            });

            streamDepth.on(
                "message",
                (data: SpotWebsocketStreams.DiffBookDepthResponse): void => {
                    const processingCorrelationId = randomUUID();
                    const startTime = Date.now();
                    try {
                        this.absorptionDetector.addDepth(data);
                        this.exhaustionDetector.addDepth(data);
                        const message: WebSocketMessage =
                            this.dependencies.orderBookProcessor.processWebSocketUpdate(
                                data
                            );
                        this.broadcastMessage(message);

                        const processingTime = Date.now() - startTime;
                        this.dependencies.metricsCollector.updateMetric(
                            "processingLatency",
                            processingTime
                        );
                    } catch {
                        this.handleError(
                            new SignalProcessingError(
                                "Error processing depth data",
                                { data },
                                processingCorrelationId
                            ),
                            "depth_processing",
                            processingCorrelationId
                        );
                    }
                }
            );

            streamAggTrade.on(
                "message",
                (data: SpotWebsocketStreams.AggTradeResponse): void => {
                    const processingCorrelationId = randomUUID();
                    const startTime = Date.now();
                    try {
                        this.absorptionDetector.addTrade(data);
                        this.exhaustionDetector.addTrade(data);
                        this.deltaCVDConfirmation.addTrade(data);
                        this.swingPredictor.onPrice(
                            parseFloat(data.p ?? "0"),
                            data.T ?? Date.now()
                        );
                        const processedData: WebSocketMessage =
                            this.dependencies.tradesProcessor.addTrade(data);
                        this.broadcastMessage(processedData);

                        const processingTime = Date.now() - startTime;
                        this.dependencies.metricsCollector.updateMetric(
                            "processingLatency",
                            processingTime
                        );
                    } catch {
                        this.handleError(
                            new SignalProcessingError(
                                "Error processing trade data",
                                { data },
                                processingCorrelationId
                            ),
                            "trade_processing",
                            processingCorrelationId
                        );
                    }
                }
            );
        } catch (error) {
            this.handleError(
                new ConnectionError(
                    "Error connecting to Binance streams",
                    "binance_api",
                    correlationId
                ),
                "binance_connection",
                correlationId
            );
            throw error;
        }
    }

    private async sendWebhookMessage(
        webhookUrl: string,
        message: object,
        correlationId?: string
    ): Promise<void> {
        try {
            await this.dependencies.circuitBreaker.execute(async () => {
                const response = await fetch(webhookUrl, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "X-Correlation-ID": correlationId || randomUUID(),
                    },
                    body: JSON.stringify(message),
                });

                if (!response.ok) {
                    throw new ConnectionError(
                        `Webhook request failed: ${response.status} ${response.statusText}`,
                        "webhook",
                        correlationId
                    );
                }

                this.dependencies.logger.info(
                    "Webhook message sent successfully",
                    { webhookUrl },
                    correlationId
                );
            }, correlationId);
        } catch (error) {
            this.handleError(error as Error, "webhook_send", correlationId);
        }
    }

    public async broadcastSignal(signal: Signal): Promise<void> {
        const correlationId = randomUUID();

        try {
            this.dependencies.logger.info(
                "Broadcasting signal",
                { signal },
                correlationId
            );
            this.dependencies.metricsCollector.incrementMetric(
                "signalsGenerated"
            );

            if (Config.WEBHOOK_URL) {
                const message = {
                    type: signal.type,
                    time: signal.time,
                    price: signal.price,
                    takeProfit: signal.takeProfit,
                    stopLoss: signal.stopLoss,
                    label: signal.closeReason,
                    correlationId,
                };
                await this.sendWebhookMessage(
                    Config.WEBHOOK_URL,
                    message,
                    correlationId
                );
            } else {
                this.dependencies.logger.warn(
                    "No webhook URL provided",
                    {},
                    correlationId
                );
            }

            this.sendToClients({
                type: "signal",
                data: signal,
                now: Date.now(),
            });
        } catch {
            this.handleError(
                new SignalProcessingError(
                    "Error broadcasting signal",
                    { signal },
                    correlationId
                ),
                "broadcast_signal",
                correlationId
            );
        }
    }

    private purgeDatabase(): void {
        const intervalId = setInterval(() => {
            if (this.isShuttingDown) {
                clearInterval(intervalId);
                return;
            }

            const correlationId = randomUUID();
            this.dependencies.logger.info(
                "Starting scheduled purge",
                {},
                correlationId
            );

            try {
                this.dependencies.storage.purgeOldEntries();
                this.dependencies.logger.info(
                    "Scheduled purge completed successfully",
                    {},
                    correlationId
                );
            } catch (error) {
                this.handleError(
                    new Error(
                        `Scheduled purge failed: ${(error as Error).message}`
                    ),
                    "database_purge",
                    correlationId
                );
            }
        }, this.intervalMs);

        // Cleanup on shutdown
        const cleanup = () => {
            this.dependencies.logger.info("Stopping purge timer");
            clearInterval(intervalId);
        };

        process.on("SIGINT", cleanup);
        process.on("SIGTERM", cleanup);
    }

    private async onExhaustionDetected(detected: Detected): Promise<void> {
        const correlationId = randomUUID();
        const time = Date.now();

        try {
            const signal: Signal = {
                time,
                price: detected.price,
                type: "exhaustion",
                takeProfit:
                    detected.price + (detected.side === "buy" ? -0.005 : 0.005),
                stopLoss:
                    detected.price + (detected.side === "buy" ? 0.005 : -0.005),
                closeReason: "exhaustion",
                signalData: detected,
            };

            this.dependencies.logger.info(
                "Exhaustion detected",
                { detected },
                correlationId
            );
            await this.broadcastSignal(signal);
            this.deltaCVDConfirmation.confirmSignal(
                "exhaustion",
                detected.price,
                time
            );
        } catch {
            this.handleError(
                new SignalProcessingError(
                    "Error handling exhaustion detection",
                    { detected },
                    correlationId
                ),
                "exhaustion_detection",
                correlationId
            );
        }
    }

    private async onAbsorptionDetected(detected: Detected): Promise<void> {
        const correlationId = randomUUID();
        const time = Date.now();

        try {
            const signal: Signal = {
                time,
                price: detected.price,
                type: "absorption",
                takeProfit:
                    detected.price + (detected.side === "buy" ? -0.005 : 0.005),
                stopLoss:
                    detected.price + (detected.side === "buy" ? 0.005 : -0.005),
                closeReason: "absorption",
                signalData: detected,
            };

            this.dependencies.logger.info(
                "Absorption detected",
                { detected },
                correlationId
            );
            await this.broadcastSignal(signal);
            this.deltaCVDConfirmation.confirmSignal(
                "absorption",
                detected.price,
                time
            );
        } catch {
            this.handleError(
                new SignalProcessingError(
                    "Error handling absorption detection",
                    { detected },
                    correlationId
                ),
                "absorption_detection",
                correlationId
            );
        }
    }

    private handleSwingPrediction(prediction: SwingPrediction): void {
        const correlationId = randomUUID();

        try {
            this.broadcastSignal(prediction).catch(() => {
                this.handleError(
                    new SignalProcessingError(
                        "Error broadcasting swing prediction",
                        { prediction },
                        correlationId
                    ),
                    "swing_prediction",
                    correlationId
                );
            });
        } catch (error) {
            this.handleError(
                error as Error,
                "swing_prediction_handler",
                correlationId
            );
        }
    }

    // Update circuit breaker state metrics
    private updateCircuitBreakerMetrics(): void {
        const state = this.dependencies.circuitBreaker.getState();
        this.dependencies.metricsCollector.updateMetric(
            "circuitBreakerState",
            state
        );
    }

    public async startDashboard(): Promise<void> {
        const correlationId = randomUUID();

        try {
            this.dependencies.logger.info(
                "Starting Order Flow Dashboard",
                {},
                correlationId
            );

            // Update circuit breaker metrics periodically
            setInterval(() => this.updateCircuitBreakerMetrics(), 30000);

            this.startWebServer();

            const preloadTrades = this.preloadTrades();
            const fetchInitialOrderBook = this.fetchInitialOrderBook();
            const getFromBinanceAPI = this.getFromBinanceAPI();

            await Promise.all([
                preloadTrades,
                fetchInitialOrderBook,
                getFromBinanceAPI,
            ]);

            this.purgeDatabase();
            this.dependencies.logger.info(
                "Order Flow Dashboard started successfully",
                {},
                correlationId
            );
        } catch (error) {
            this.handleError(
                new Error(
                    `Error starting Order Flow Dashboard: ${(error as Error).message}`
                ),
                "dashboard_startup",
                correlationId
            );
            throw error;
        }
    }
}

// Factory function to create dependencies
export function createDependencies(): Dependencies {
    const logger = new Logger();
    const metricsCollector = new MetricsCollector();
    const rateLimiter = new RateLimiter();
    const circuitBreaker = new CircuitBreaker();

    return {
        storage: new Storage() as IStorage,
        binanceFeed: new BinanceDataFeed() as IBinanceDataFeed,
        tradesProcessor: new TradesProcessor() as ITradesProcessor,
        orderBookProcessor: new OrderBookProcessor() as IOrderBookProcessor,
        signalLogger: new SignalLogger("signals.csv") as ISignalLogger,
        logger,
        metricsCollector,
        rateLimiter,
        circuitBreaker,
    };
}

// Usage example:
// const dependencies = createDependencies();
// const dashboard = new OrderFlowDashboard(dependencies);
// await dashboard.startDashboard();
