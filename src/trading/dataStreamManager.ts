// src/trading/dataStreamManager.ts

import { SpotWebsocketStreams } from "@binance/spot";
import { EventEmitter } from "events";
import { randomUUID } from "crypto";
import { Logger } from "../infrastructure/logger.js";
import { CircuitBreaker } from "../infrastructure/circuitBreaker.js";
import { MetricsCollector } from "../infrastructure/metricsCollector.js";
import { ConnectionError } from "../core/errors.js";
import type { IBinanceDataFeed } from "../utils/binance.js";

/**
 * Events emitted by DataStreamManager
 */
export interface DataStreamEvents {
    trade: (data: SpotWebsocketStreams.AggTradeResponse) => void;
    depth: (data: SpotWebsocketStreams.DiffBookDepthResponse) => void;
    connected: () => void;
    disconnected: (reason?: string) => void;
    error: (error: Error) => void;
    reconnecting: (attempt: number) => void;
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
}

/**
 * Manages real-time data streams from Binance
 * Handles connection lifecycle, reconnection, and data distribution
 */
export class DataStreamManager extends EventEmitter {
    // Connection state
    private connection?: SpotWebsocketStreams.WebsocketStreamsConnection;
    private tradeStream?: SpotWebsocketStreams.WebsocketStreams<SpotWebsocketStreams.AggTradeResponse>;
    private depthStream?: SpotWebsocketStreams.WebsocketStreams;

    // State management
    private isShuttingDown = false;
    private isConnected = false;
    private reconnectAttempts = 0;
    private heartbeatTimer?: NodeJS.Timeout;
    private reconnectTimer?: NodeJS.Timeout;

    // Configuration
    private readonly reconnectDelay: number;
    private readonly maxReconnectAttempts: number;
    private readonly depthUpdateSpeed: "100ms" | "1000ms";
    private readonly enableHeartbeat: boolean;
    private readonly heartbeatInterval: number;

    constructor(
        private readonly config: DataStreamConfig,
        private readonly binanceFeed: IBinanceDataFeed,
        private readonly circuitBreaker: CircuitBreaker,
        private readonly logger: Logger,
        private readonly metricsCollector: MetricsCollector
    ) {
        super();

        // Apply defaults
        this.reconnectDelay = config.reconnectDelay || 5000;
        this.maxReconnectAttempts = config.maxReconnectAttempts || 10;
        this.depthUpdateSpeed = config.depthUpdateSpeed || "100ms";
        this.enableHeartbeat = config.enableHeartbeat ?? true;
        this.heartbeatInterval = config.heartbeatInterval || 30000;
    }

    /**
     * Connect to Binance WebSocket streams
     */
    public async connect(): Promise<void> {
        const correlationId = randomUUID();

        if (this.isConnected) {
            this.logger.warn("Already connected to streams", {}, correlationId);
            return;
        }

        try {
            this.logger.info(
                "Connecting to Binance streams",
                { symbol: this.config.symbol },
                correlationId
            );

            this.connection = await this.circuitBreaker.execute(
                () => this.binanceFeed.connectToStreams(),
                correlationId
            );

            this.setupConnectionHandlers();
            this.setupDataStreams();

            this.isConnected = true;
            this.reconnectAttempts = 0;

            if (this.enableHeartbeat) {
                this.startHeartbeat();
            }

            this.emit("connected");
            this.logger.info(
                "Successfully connected to Binance streams",
                { symbol: this.config.symbol },
                correlationId
            );
        } catch (error) {
            this.logger.error(
                "Failed to connect to Binance streams",
                { error, symbol: this.config.symbol },
                correlationId
            );

            throw new ConnectionError(
                "Failed to connect to Binance streams",
                "binance_api",
                correlationId
            );
        }
    }

    /**
     * Setup connection event handlers
     */
    private setupConnectionHandlers(): void {
        if (!this.connection) return;

        // Handle connection close
        this.connection.on("close", () => {
            this.handleConnectionClose();
        });

        // Handle connection errors
        this.connection.on("error", (error: Error) => {
            this.handleConnectionError(error);
        });
    }

    /**
     * Setup individual data stream handlers
     */
    private setupDataStreams(): void {
        if (!this.connection) return;

        const correlationId = randomUUID();

        try {
            // Setup aggregated trade stream
            this.tradeStream = this.connection.aggTrade({
                symbol: this.config.symbol,
            });

            this.tradeStream.on(
                "message",
                (data: SpotWebsocketStreams.AggTradeResponse) => {
                    this.handleTradeMessage(data);
                }
            );

            this.tradeStream.on("error", (error: Error) => {
                this.logger.error(
                    "Trade stream error",
                    { error, symbol: this.config.symbol },
                    correlationId
                );
                this.emit("error", error);
            });

            // Setup order book depth stream
            this.depthStream = this.connection.diffBookDepth({
                symbol: this.config.symbol,
                updateSpeed: this.depthUpdateSpeed,
            });

            this.depthStream.on(
                "message",
                (data: SpotWebsocketStreams.DiffBookDepthResponse) => {
                    this.handleDepthMessage(data);
                }
            );

            this.depthStream.on("error", (error: Error) => {
                this.logger.error(
                    "Depth stream error",
                    { error, symbol: this.config.symbol },
                    correlationId
                );
                this.emit("error", error);
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

    /**
     * Handle incoming trade messages
     */
    private handleTradeMessage(
        data: SpotWebsocketStreams.AggTradeResponse
    ): void {
        const startTime = Date.now();

        try {
            // Validate trade data
            if (!this.isValidTradeData(data)) {
                this.logger.warn("Invalid trade data received", { data });
                return;
            }

            // Emit trade event
            this.emit("trade", data);

            // Record metrics
            this.recordMessageMetrics("trade", startTime);
        } catch (error) {
            this.logger.error("Error processing trade message", {
                error,
                data,
            });
            this.emit("error", error as Error);
        }
    }

    /**
     * Handle incoming depth messages
     */
    private handleDepthMessage(
        data: SpotWebsocketStreams.DiffBookDepthResponse
    ): void {
        const startTime = Date.now();

        try {
            // Validate depth data
            if (!this.isValidDepthData(data)) {
                this.logger.warn("Invalid depth data received", { data });
                return;
            }

            // Emit depth event
            this.emit("depth", data);

            // Record metrics
            this.recordMessageMetrics("depth", startTime);
        } catch (error) {
            this.logger.error("Error processing depth message", {
                error,
                data,
            });
            this.emit("error", error as Error);
        }
    }

    /**
     * Validate trade data structure
     */
    private isValidTradeData(
        data: SpotWebsocketStreams.AggTradeResponse
    ): boolean {
        return !!(
            data &&
            data.T && // Trade time
            data.p && // Price
            data.q && // Quantity
            data.s === this.config.symbol // Symbol matches
        );
    }

    /**
     * Validate depth data structure
     */
    private isValidDepthData(
        data: SpotWebsocketStreams.DiffBookDepthResponse
    ): boolean {
        return !!(
            data &&
            data.u && // Update ID
            data.s === this.config.symbol && // Symbol matches
            (data.b || data.a) // Has bids or asks
        );
    }

    /**
     * Record message processing metrics
     */
    private recordMessageMetrics(
        type: "trade" | "depth",
        startTime: number
    ): void {
        const latency = Date.now() - startTime;

        this.metricsCollector.updateMetric("processingLatency", latency);

        // Track message rates
        if (type === "trade") {
            this.metricsCollector.incrementMetric("tradeMessages" as any);
        } else {
            this.metricsCollector.incrementMetric("depthMessages" as any);
        }
    }

    /**
     * Handle connection close event
     */
    private handleConnectionClose(): void {
        const correlationId = randomUUID();

        this.isConnected = false;
        this.stopHeartbeat();

        this.logger.warn(
            "Stream connection closed",
            { symbol: this.config.symbol },
            correlationId
        );

        this.emit("disconnected", "connection_closed");

        if (!this.isShuttingDown) {
            this.scheduleReconnect();
        }
    }

    /**
     * Handle connection error
     */
    private handleConnectionError(error: Error): void {
        const correlationId = randomUUID();

        this.logger.error(
            "Stream connection error",
            { error, symbol: this.config.symbol },
            correlationId
        );

        this.emit("error", error);

        // Connection errors usually lead to disconnection
        if (!this.isConnected) {
            this.handleConnectionClose();
        }
    }

    /**
     * Schedule reconnection attempt
     */
    private scheduleReconnect(): void {
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
        }

        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            const error = new ConnectionError(
                `Max reconnection attempts (${this.maxReconnectAttempts}) exceeded`,
                "binance_api"
            );
            this.emit("error", error);
            return;
        }

        this.reconnectAttempts++;
        const delay = this.getReconnectDelay();

        this.logger.info(
            `Scheduling reconnection attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts}`,
            { delay, symbol: this.config.symbol }
        );

        this.emit("reconnecting", this.reconnectAttempts);

        this.reconnectTimer = setTimeout(() => {
            this.reconnect().catch((error) => {
                this.logger.error("Reconnection failed", { error });
                // Will trigger another reconnect attempt via handleConnectionClose
            });
        }, delay);
    }

    /**
     * Calculate reconnect delay with exponential backoff
     */
    private getReconnectDelay(): number {
        // Exponential backoff: 5s, 10s, 20s, 40s, etc.
        const baseDelay = this.reconnectDelay;
        const maxDelay = 60000; // Max 1 minute
        const delay = Math.min(
            baseDelay * Math.pow(2, this.reconnectAttempts - 1),
            maxDelay
        );

        // Add jitter to prevent thundering herd
        const jitter = Math.random() * 0.3 * delay;

        return Math.floor(delay + jitter);
    }

    /**
     * Attempt to reconnect
     */
    private async reconnect(): Promise<void> {
        const correlationId = randomUUID();

        try {
            this.logger.info(
                "Attempting to reconnect",
                { attempt: this.reconnectAttempts, symbol: this.config.symbol },
                correlationId
            );

            // Clean up existing connection
            await this.cleanup();

            // Reconnect
            await this.connect();
        } catch (error) {
            this.logger.error(
                "Reconnection attempt failed",
                { error, attempt: this.reconnectAttempts },
                correlationId
            );
            throw error;
        }
    }

    /**
     * Start connection heartbeat
     */
    private startHeartbeat(): void {
        this.stopHeartbeat();

        this.heartbeatTimer = setInterval(() => {
            if (this.isConnected && this.connection) {
                // Binance WebSocket connections have built-in ping/pong
                // This is just for monitoring connection health
                const correlationId = randomUUID();
                this.logger.debug(
                    "Heartbeat check",
                    { symbol: this.config.symbol },
                    correlationId
                );
            }
        }, this.heartbeatInterval);
    }

    /**
     * Stop connection heartbeat
     */
    private stopHeartbeat(): void {
        if (this.heartbeatTimer) {
            clearInterval(this.heartbeatTimer);
            this.heartbeatTimer = undefined;
        }
    }

    /**
     * Clean up resources
     */
    private async cleanup(): Promise<void> {
        this.stopHeartbeat();

        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = undefined;
        }

        if (this.tradeStream) {
            this.tradeStream.removeAllListeners();
            this.tradeStream = undefined;
        }

        if (this.depthStream) {
            this.depthStream.removeAllListeners();
            this.depthStream = undefined;
        }

        if (this.connection) {
            try {
                await this.connection.disconnect();
            } catch (error) {
                this.logger.error("Error disconnecting connection", { error });
            }
            this.connection = undefined;
        }

        this.isConnected = false;
    }

    /**
     * Disconnect from streams
     */
    public async disconnect(): Promise<void> {
        const correlationId = randomUUID();

        this.logger.info(
            "Disconnecting from streams",
            { symbol: this.config.symbol },
            correlationId
        );

        this.isShuttingDown = true;
        await this.cleanup();

        this.emit("disconnected", "manual_disconnect");

        this.logger.info(
            "Successfully disconnected from streams",
            { symbol: this.config.symbol },
            correlationId
        );
    }

    /**
     * Get connection status
     */
    public getStatus(): {
        isConnected: boolean;
        reconnectAttempts: number;
        symbol: string;
        uptime?: number;
    } {
        return {
            isConnected: this.isConnected,
            reconnectAttempts: this.reconnectAttempts,
            symbol: this.config.symbol,
            uptime: this.isConnected
                ? Date.now() - (this.connectedAt || 0)
                : undefined,
        };
    }

    // Add connected timestamp tracking
    private connectedAt?: number;

    // Override emit to track connection time
    emit(event: string | symbol, ...args: any[]): boolean {
        if (event === "connected") {
            this.connectedAt = Date.now();
        } else if (event === "disconnected") {
            this.connectedAt = undefined;
        }
        return super.emit(event, ...args);
    }
}

// Type-safe event emitter
export interface DataStreamManager {
    on<K extends keyof DataStreamEvents>(
        event: K,
        listener: DataStreamEvents[K]
    ): this;

    off<K extends keyof DataStreamEvents>(
        event: K,
        listener: DataStreamEvents[K]
    ): this;

    emit<K extends keyof DataStreamEvents>(
        event: K,
        ...args: Parameters<DataStreamEvents[K]>
    ): boolean;
}
