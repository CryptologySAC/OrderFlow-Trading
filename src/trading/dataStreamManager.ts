import { SpotWebsocketStreams } from "@binance/spot";
import { EventEmitter } from "events";
import { randomUUID } from "crypto";
import { Logger } from "../infrastructure/logger.js";
import { CircuitBreaker } from "../infrastructure/circuitBreaker.js";
import { MetricsCollector } from "../infrastructure/metricsCollector.js";
import { ConnectionError } from "../core/errors.js";
import type { IBinanceDataFeed } from "../utils/binance.js";
import {
    BinanceAggTradeStream,
    BinanceDiffBookDepthStream,
} from "../types/binanceTypes.js";

/**
 * Enhanced connection states for better state management
 */
enum ConnectionState {
    DISCONNECTED = "disconnected",
    CONNECTING = "connecting",
    CONNECTED = "connected",
    RECONNECTING = "reconnecting",
    SHUTTING_DOWN = "shutting_down",
    FAILED = "failed",
}

/**
 * Configuration for DataStreamManager
 */
export interface DataStreamConfig {
    symbol: string;
    reconnectDelay?: number;
    maxReconnectAttempts?: number;
    depthUpdateSpeed?: "100ms" | "1000ms";
    enableHeartbeat?: boolean;
    heartbeatInterval?: number;
    // Enhanced configuration
    maxBackoffDelay?: number;
    streamHealthTimeout?: number;
    enableStreamHealthCheck?: boolean;
    reconnectOnHealthFailure?: boolean;
}

/**
 * Stream health tracking
 */
interface StreamHealth {
    lastTradeMessage: number;
    lastDepthMessage: number;
    tradeMessageCount: number;
    depthMessageCount: number;
    isHealthy: boolean;
}

/**
 * Enhanced DataStreamManager with robust reconnection logic
 */
export class DataStreamManager extends EventEmitter {
    private connection?: SpotWebsocketStreams.WebsocketStreamsConnection;
    private tradeStream?: BinanceAggTradeStream;
    private depthStream?: BinanceDiffBookDepthStream;

    // Enhanced state management
    private connectionState = ConnectionState.DISCONNECTED;
    private reconnectAttempts = 0;
    private connectedAt?: number;
    private lastReconnectAttempt = 0;

    // Timers
    private heartbeatTimer?: NodeJS.Timeout;
    private reconnectTimer?: NodeJS.Timeout;
    private healthCheckTimer?: NodeJS.Timeout;

    // Configuration
    private readonly reconnectDelay: number;
    private readonly maxReconnectAttempts: number;
    private readonly maxBackoffDelay: number;
    private readonly depthUpdateSpeed: "100ms" | "1000ms";
    private readonly enableHeartbeat: boolean;
    private readonly heartbeatInterval: number;
    private readonly streamHealthTimeout: number;
    private readonly enableStreamHealthCheck: boolean;
    private readonly reconnectOnHealthFailure: boolean;

    // Stream health tracking
    private streamHealth: StreamHealth = {
        lastTradeMessage: 0,
        lastDepthMessage: 0,
        tradeMessageCount: 0,
        depthMessageCount: 0,
        isHealthy: false,
    };

    constructor(
        private readonly config: DataStreamConfig,
        private readonly binanceFeed: IBinanceDataFeed,
        private readonly circuitBreaker: CircuitBreaker,
        private readonly logger: Logger,
        private readonly metricsCollector: MetricsCollector
    ) {
        super();
        this.reconnectDelay = config.reconnectDelay || 5000;
        this.maxReconnectAttempts = config.maxReconnectAttempts || 10;
        this.maxBackoffDelay = config.maxBackoffDelay || 300000; // 5 minutes max
        this.depthUpdateSpeed = config.depthUpdateSpeed || "100ms";
        this.enableHeartbeat = config.enableHeartbeat ?? true;
        this.heartbeatInterval = config.heartbeatInterval || 30000;
        this.streamHealthTimeout = config.streamHealthTimeout || 60000; // 1 minute
        this.enableStreamHealthCheck = config.enableStreamHealthCheck ?? true;
        this.reconnectOnHealthFailure = config.reconnectOnHealthFailure ?? true;
    }

    public async connect(): Promise<void> {
        const correlationId = randomUUID();

        if (this.connectionState === ConnectionState.CONNECTED) {
            this.logger.warn("Already connected to streams", {}, correlationId);
            return;
        }

        if (this.connectionState === ConnectionState.CONNECTING) {
            this.logger.warn(
                "Connection already in progress",
                {},
                correlationId
            );
            return;
        }

        this.setConnectionState(ConnectionState.CONNECTING);

        try {
            this.logger.info(
                "Connecting to Binance streams",
                {
                    symbol: this.config.symbol,
                    attempt: this.reconnectAttempts + 1,
                    state: this.connectionState,
                },
                correlationId
            );

            // Use circuit breaker for all connection attempts
            this.connection = await this.circuitBreaker.execute(
                () => this.binanceFeed.connectToStreams(),
                correlationId
            );

            this.setupConnectionHandlers();
            this.setupDataStreams();

            this.setConnectionState(ConnectionState.CONNECTED);
            this.reconnectAttempts = 0;
            this.connectedAt = Date.now();
            this.resetStreamHealth();

            if (this.enableHeartbeat) this.startHeartbeat();
            if (this.enableStreamHealthCheck) this.startStreamHealthCheck();

            this.emit("connected");
            this.metricsCollector.incrementCounter(
                "stream.connections.successful"
            );

            this.logger.info(
                "Successfully connected to Binance streams",
                {
                    symbol: this.config.symbol,
                    reconnectAttempts: this.reconnectAttempts,
                },
                correlationId
            );
        } catch (error) {
            this.setConnectionState(ConnectionState.FAILED);
            this.metricsCollector.incrementCounter("stream.connections.failed");

            this.logger.error(
                "Failed to connect to Binance streams",
                {
                    error,
                    symbol: this.config.symbol,
                    attempt: this.reconnectAttempts + 1,
                    state: this.connectionState,
                },
                correlationId
            );

            // Don't throw on reconnection attempts, schedule next attempt instead
            if (this.reconnectAttempts > 0) {
                this.scheduleReconnect();
                return;
            }

            throw new ConnectionError(
                "Failed to connect to Binance streams",
                "binance_api",
                correlationId
            );
        }
    }

    private setConnectionState(newState: ConnectionState): void {
        const oldState = this.connectionState;
        this.connectionState = newState;

        this.logger.debug("Connection state changed", {
            from: oldState,
            to: newState,
            symbol: this.config.symbol,
        });

        this.metricsCollector.recordGauge(
            "stream.connection.state",
            this.getStateNumeric(newState)
        );
        this.emit("stateChange", { from: oldState, to: newState });
    }

    private getStateNumeric(state: ConnectionState): number {
        const stateMap = {
            [ConnectionState.DISCONNECTED]: 0,
            [ConnectionState.CONNECTING]: 1,
            [ConnectionState.CONNECTED]: 2,
            [ConnectionState.RECONNECTING]: 3,
            [ConnectionState.SHUTTING_DOWN]: 4,
            [ConnectionState.FAILED]: 5,
        };
        return stateMap[state] || 0;
    }

    private setupConnectionHandlers(): void {
        if (!this.connection) return;

        this.connection.on("close", () => this.handleConnectionClose());
        this.connection.on("error", (error: Error) =>
            this.handleConnectionError(error)
        );
    }

    private setupDataStreams(): void {
        if (!this.connection) return;

        const correlationId = randomUUID();

        try {
            // Trade stream
            this.tradeStream = this.connection.aggTrade({
                symbol: this.config.symbol,
            }) as unknown as BinanceAggTradeStream;

            this.tradeStream.on(
                "message",
                (data: SpotWebsocketStreams.AggTradeResponse) =>
                    this.handleTradeMessage(data)
            );

            this.tradeStream.on("error", (error: Error) => {
                this.logger.error(
                    "Trade stream error",
                    { error, symbol: this.config.symbol },
                    correlationId
                );
                this.metricsCollector.incrementCounter("stream.trade.errors");
                // Don't emit error immediately, let connection handler decide
            });

            // Depth stream
            this.depthStream = this.connection.diffBookDepth({
                symbol: this.config.symbol,
                updateSpeed: this.depthUpdateSpeed,
            }) as unknown as BinanceDiffBookDepthStream;

            this.depthStream.on(
                "message",
                (data: SpotWebsocketStreams.DiffBookDepthResponse) =>
                    this.handleDepthMessage(data)
            );

            this.depthStream.on("error", (error: Error) => {
                this.logger.error(
                    "Depth stream error",
                    { error, symbol: this.config.symbol },
                    correlationId
                );
                this.metricsCollector.incrementCounter("stream.depth.errors");
                // Don't emit error immediately, let connection handler decide
            });
        } catch (error) {
            this.logger.error(
                "Failed to setup data streams",
                { error, symbol: this.config.symbol },
                correlationId
            );
            throw error;
        }
    }

    private handleTradeMessage(
        data: SpotWebsocketStreams.AggTradeResponse
    ): void {
        if (!data || data.s !== this.config.symbol) return;

        // Update stream health
        this.streamHealth.lastTradeMessage = Date.now();
        this.streamHealth.tradeMessageCount++;
        this.updateStreamHealthStatus();

        this.emit("trade", data);
        this.metricsCollector.incrementCounter("stream.trade.messages");
    }

    private handleDepthMessage(
        data: SpotWebsocketStreams.DiffBookDepthResponse
    ): void {
        if (!data || data.s !== this.config.symbol) return;

        // Update stream health
        this.streamHealth.lastDepthMessage = Date.now();
        this.streamHealth.depthMessageCount++;
        this.updateStreamHealthStatus();

        this.emit("depth", data);
        this.metricsCollector.incrementCounter("stream.depth.messages");
    }

    private updateStreamHealthStatus(): void {
        const now = Date.now();
        const tradeHealthy =
            now - this.streamHealth.lastTradeMessage < this.streamHealthTimeout;
        const depthHealthy =
            now - this.streamHealth.lastDepthMessage < this.streamHealthTimeout;

        const wasHealthy = this.streamHealth.isHealthy;
        this.streamHealth.isHealthy = tradeHealthy && depthHealthy;

        // Emit health change events
        if (wasHealthy && !this.streamHealth.isHealthy) {
            this.logger.warn("Stream health degraded", {
                symbol: this.config.symbol,
                tradeHealthy,
                depthHealthy,
                lastTrade: this.streamHealth.lastTradeMessage,
                lastDepth: this.streamHealth.lastDepthMessage,
            });
            this.emit("unhealthy");
            this.metricsCollector.incrementCounter("stream.health.degraded");
        } else if (!wasHealthy && this.streamHealth.isHealthy) {
            this.logger.info("Stream health restored", {
                symbol: this.config.symbol,
            });
            this.emit("healthy");
            this.metricsCollector.incrementCounter("stream.health.restored");
        }

        this.metricsCollector.recordGauge(
            "stream.health.status",
            this.streamHealth.isHealthy ? 1 : 0
        );
    }

    private handleConnectionClose(): void {
        // Prevent duplicate handling
        if (
            this.connectionState === ConnectionState.SHUTTING_DOWN ||
            this.connectionState === ConnectionState.DISCONNECTED
        ) {
            return;
        }

        this.logger.warn("Connection closed", {
            symbol: this.config.symbol,
            state: this.connectionState,
            wasHealthy: this.streamHealth.isHealthy,
        });

        this.setConnectionState(ConnectionState.DISCONNECTED);
        this.stopAllTimers();
        this.emit("disconnected", "connection_closed");
        this.metricsCollector.incrementCounter("stream.connections.closed");

        this.scheduleReconnect();
    }

    private handleConnectionError(error: Error): void {
        this.logger.error("Stream connection error", {
            error,
            symbol: this.config.symbol,
            state: this.connectionState,
        });

        this.metricsCollector.incrementCounter("stream.connections.errors");
        this.emit("error", error);

        // Only trigger reconnection if we're not already handling disconnection
        if (this.connectionState === ConnectionState.CONNECTED) {
            this.handleConnectionClose();
        }
    }

    private scheduleReconnect(): void {
        // Clear any existing reconnect timer
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = undefined;
        }

        // Check if we've exceeded max attempts
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            this.setConnectionState(ConnectionState.FAILED);
            const error = new ConnectionError(
                `Max reconnection attempts (${this.maxReconnectAttempts}) exceeded`,
                "binance_api"
            );
            this.emit("error", error);
            this.metricsCollector.incrementCounter(
                "stream.reconnect.exhausted"
            );
            return;
        }

        // Prevent too frequent reconnection attempts
        const now = Date.now();
        const minInterval = 1000; // 1 second minimum between attempts
        if (now - this.lastReconnectAttempt < minInterval) {
            this.logger.debug("Throttling reconnect attempt", {
                symbol: this.config.symbol,
                lastAttempt: this.lastReconnectAttempt,
                now,
            });
            setTimeout(() => this.scheduleReconnect(), minInterval);
            return;
        }

        this.reconnectAttempts++;
        this.lastReconnectAttempt = now;
        this.setConnectionState(ConnectionState.RECONNECTING);

        // Enhanced exponential backoff with jitter
        const baseDelay =
            this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);
        const cappedDelay = Math.min(baseDelay, this.maxBackoffDelay);
        const jitter = Math.random() * Math.min(cappedDelay * 0.1, 5000); // Up to 10% jitter, max 5s
        const delay = cappedDelay + jitter;

        this.logger.info("Scheduling reconnection", {
            symbol: this.config.symbol,
            attempt: this.reconnectAttempts,
            delay: Math.round(delay),
            maxAttempts: this.maxReconnectAttempts,
        });

        this.emit("reconnecting", {
            attempt: this.reconnectAttempts,
            delay: Math.round(delay),
            maxAttempts: this.maxReconnectAttempts,
        });

        this.metricsCollector.incrementCounter("stream.reconnect.scheduled");
        this.metricsCollector.recordHistogram("stream.reconnect.delay", delay);

        this.reconnectTimer = setTimeout(() => {
            this.reconnect().catch((error) => {
                this.logger.error("Reconnection attempt failed", {
                    error,
                    attempt: this.reconnectAttempts,
                    symbol: this.config.symbol,
                });
                this.metricsCollector.incrementCounter(
                    "stream.reconnect.failed"
                );

                // Schedule next attempt
                this.scheduleReconnect();
            });
        }, delay);
    }

    private async reconnect(): Promise<void> {
        this.logger.info("Attempting reconnection", {
            symbol: this.config.symbol,
            attempt: this.reconnectAttempts,
        });

        try {
            await this.cleanup();
            await this.connect();
        } catch (error) {
            this.logger.error("Reconnection failed", {
                error,
                attempt: this.reconnectAttempts,
                symbol: this.config.symbol,
            });
            throw error;
        }
    }

    private startHeartbeat(): void {
        this.stopHeartbeat();
        this.heartbeatTimer = setInterval(() => {
            if (
                this.connectionState === ConnectionState.CONNECTED &&
                this.connection
            ) {
                this.logger.debug("Heartbeat check", {
                    symbol: this.config.symbol,
                    streamHealth: this.streamHealth.isHealthy,
                    uptime: this.getUptime(),
                });
                this.metricsCollector.recordGauge(
                    "stream.uptime",
                    this.getUptime() || 0
                );
            }
        }, this.heartbeatInterval);
    }

    private stopHeartbeat(): void {
        if (this.heartbeatTimer) {
            clearInterval(this.heartbeatTimer);
            this.heartbeatTimer = undefined;
        }
    }

    private startStreamHealthCheck(): void {
        this.stopStreamHealthCheck();
        this.healthCheckTimer = setInterval(() => {
            this.checkStreamHealth();
        }, this.streamHealthTimeout / 2); // Check twice per timeout period
    }

    private stopStreamHealthCheck(): void {
        if (this.healthCheckTimer) {
            clearInterval(this.healthCheckTimer);
            this.healthCheckTimer = undefined;
        }
    }

    private checkStreamHealth(): void {
        if (this.connectionState !== ConnectionState.CONNECTED) return;

        this.updateStreamHealthStatus();

        if (!this.streamHealth.isHealthy && this.reconnectOnHealthFailure) {
            this.logger.warn("Stream unhealthy, triggering reconnection", {
                symbol: this.config.symbol,
                tradeMessages: this.streamHealth.tradeMessageCount,
                depthMessages: this.streamHealth.depthMessageCount,
                lastTrade: this.streamHealth.lastTradeMessage,
                lastDepth: this.streamHealth.lastDepthMessage,
            });

            this.metricsCollector.incrementCounter(
                "stream.health.reconnection_triggered"
            );
            this.handleConnectionClose();
        }
    }

    private resetStreamHealth(): void {
        const now = Date.now();
        this.streamHealth = {
            lastTradeMessage: now,
            lastDepthMessage: now,
            tradeMessageCount: 0,
            depthMessageCount: 0,
            isHealthy: true,
        };
    }

    private stopAllTimers(): void {
        this.stopHeartbeat();
        this.stopStreamHealthCheck();

        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = undefined;
        }
    }

    private async cleanup(): Promise<void> {
        this.logger.debug("Cleaning up connection resources", {
            symbol: this.config.symbol,
            state: this.connectionState,
        });

        // Set disconnected state first to prevent race conditions
        const wasConnected = this.connectionState === ConnectionState.CONNECTED;
        if (wasConnected) {
            this.setConnectionState(ConnectionState.DISCONNECTED);
        }

        this.stopAllTimers();

        // Clean up streams
        if (this.tradeStream) {
            this.tradeStream.removeAllListeners?.();
            this.tradeStream = undefined;
        }

        if (this.depthStream) {
            this.depthStream.removeAllListeners?.();
            this.depthStream = undefined;
        }

        // Clean up connection
        if (this.connection) {
            try {
                await this.connection.disconnect();
                this.logger.debug("Connection disconnected successfully", {
                    symbol: this.config.symbol,
                });
            } catch (error) {
                this.logger.error("Error disconnecting connection", {
                    error,
                    symbol: this.config.symbol,
                });
            }
            this.connection = undefined;
        }

        this.connectedAt = undefined;
    }

    public async disconnect(): Promise<void> {
        this.logger.info("Manual disconnect requested", {
            symbol: this.config.symbol,
            state: this.connectionState,
        });

        this.setConnectionState(ConnectionState.SHUTTING_DOWN);
        await this.cleanup();
        this.reconnectAttempts = 0; // Reset for future connections
        this.emit("disconnected", "manual_disconnect");
    }

    private getUptime(): number | undefined {
        return this.connectionState === ConnectionState.CONNECTED &&
            this.connectedAt
            ? Date.now() - this.connectedAt
            : undefined;
    }

    public getStatus(): {
        state: ConnectionState;
        isConnected: boolean;
        reconnectAttempts: number;
        symbol: string;
        uptime?: number;
        streamHealth: StreamHealth;
        lastReconnectAttempt: number;
    } {
        return {
            state: this.connectionState,
            isConnected: this.connectionState === ConnectionState.CONNECTED,
            reconnectAttempts: this.reconnectAttempts,
            symbol: this.config.symbol,
            uptime: this.getUptime(),
            streamHealth: { ...this.streamHealth },
            lastReconnectAttempt: this.lastReconnectAttempt,
        };
    }

    public getDetailedMetrics(): {
        connection: {
            state: string;
            uptime: number | undefined;
            reconnectAttempts: number;
            lastReconnectAttempt: number;
        };
        streams: {
            health: StreamHealth;
            tradeMessagesPerSecond: number;
            depthMessagesPerSecond: number;
        };
        timers: {
            heartbeat: boolean;
            healthCheck: boolean;
            reconnect: boolean;
        };
    } {
        const uptime = this.getUptime();
        const uptimeSeconds = uptime ? uptime / 1000 : 0;

        return {
            connection: {
                state: this.connectionState,
                uptime,
                reconnectAttempts: this.reconnectAttempts,
                lastReconnectAttempt: this.lastReconnectAttempt,
            },
            streams: {
                health: { ...this.streamHealth },
                tradeMessagesPerSecond:
                    uptimeSeconds > 0
                        ? this.streamHealth.tradeMessageCount / uptimeSeconds
                        : 0,
                depthMessagesPerSecond:
                    uptimeSeconds > 0
                        ? this.streamHealth.depthMessageCount / uptimeSeconds
                        : 0,
            },
            timers: {
                heartbeat: !!this.heartbeatTimer,
                healthCheck: !!this.healthCheckTimer,
                reconnect: !!this.reconnectTimer,
            },
        };
    }

    // Force reconnection for testing/debugging
    public async forceReconnect(): Promise<void> {
        this.logger.info("Force reconnection requested", {
            symbol: this.config.symbol,
            state: this.connectionState,
        });

        if (this.connectionState === ConnectionState.CONNECTED) {
            this.handleConnectionClose();
        } else {
            await this.connect();
        }
    }
}
