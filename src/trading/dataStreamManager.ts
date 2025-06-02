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
 * Manages real-time data streams from Binance.
 */
export class DataStreamManager extends EventEmitter {
    private connection?: SpotWebsocketStreams.WebsocketStreamsConnection;
    private tradeStream?: BinanceAggTradeStream;
    private depthStream?: BinanceDiffBookDepthStream;
    private isShuttingDown = false;
    private isConnected = false;
    private reconnectAttempts = 0;
    private heartbeatTimer?: NodeJS.Timeout;
    private reconnectTimer?: NodeJS.Timeout;
    private readonly reconnectDelay: number;
    private readonly maxReconnectAttempts: number;
    private readonly depthUpdateSpeed: "100ms" | "1000ms";
    private readonly enableHeartbeat: boolean;
    private readonly heartbeatInterval: number;
    private connectedAt?: number;

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
        this.depthUpdateSpeed = config.depthUpdateSpeed || "100ms";
        this.enableHeartbeat = config.enableHeartbeat ?? true;
        this.heartbeatInterval = config.heartbeatInterval || 30000;
    }

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

            if (this.enableHeartbeat) this.startHeartbeat();

            this.connectedAt = Date.now();
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
                this.emit("error", error);
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

    private handleTradeMessage(
        data: SpotWebsocketStreams.AggTradeResponse
    ): void {
        if (!data || data.s !== this.config.symbol) return;
        this.emit("trade", data);
        this.metricsCollector.incrementMetric("tradeMessages");
    }

    private handleDepthMessage(
        data: SpotWebsocketStreams.DiffBookDepthResponse
    ): void {
        if (!data || data.s !== this.config.symbol) return;
        this.emit("depth", data);
        this.metricsCollector.incrementMetric("depthMessages");
    }

    private handleConnectionClose(): void {
        this.isConnected = false;
        this.stopHeartbeat();
        this.emit("disconnected", "connection_closed");
        if (!this.isShuttingDown) this.scheduleReconnect();
    }

    private handleConnectionError(error: Error): void {
        this.logger.error("Stream connection error", {
            error,
            symbol: this.config.symbol,
        });
        this.emit("error", error);
        if (!this.isConnected) this.handleConnectionClose();
    }

    private scheduleReconnect(): void {
        if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            const error = new ConnectionError(
                `Max reconnection attempts (${this.maxReconnectAttempts}) exceeded`,
                "binance_api"
            );
            this.emit("error", error);
            return;
        }
        this.reconnectAttempts++;
        const delay =
            Math.min(
                this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1),
                60000
            ) +
            Math.random() * 3000;
        this.emit("reconnecting", this.reconnectAttempts);
        this.reconnectTimer = setTimeout(() => {
            void this.reconnect().catch((e) =>
                this.logger.error("Reconnection failed", { e })
            );
        }, delay);
    }

    private async reconnect(): Promise<void> {
        try {
            await this.cleanup();
            await this.connect();
        } catch (error) {
            this.logger.error("Reconnection attempt failed", {
                error,
                attempt: this.reconnectAttempts,
            });
            throw error;
        }
    }

    private startHeartbeat(): void {
        this.stopHeartbeat();
        this.heartbeatTimer = setInterval(() => {
            if (this.isConnected && this.connection) {
                this.logger.debug("Heartbeat check", {
                    symbol: this.config.symbol,
                });
            }
        }, this.heartbeatInterval);
    }

    private stopHeartbeat(): void {
        if (this.heartbeatTimer) {
            clearInterval(this.heartbeatTimer);
            this.heartbeatTimer = undefined;
        }
    }

    private async cleanup(): Promise<void> {
        this.stopHeartbeat();
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = undefined;
        }
        if (this.tradeStream) {
            this.tradeStream.removeAllListeners?.();
            this.tradeStream = undefined;
        }
        if (this.depthStream) {
            this.depthStream.removeAllListeners?.();
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

    public async disconnect(): Promise<void> {
        this.isShuttingDown = true;
        await this.cleanup();
        this.emit("disconnected", "manual_disconnect");
    }

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
            uptime:
                this.isConnected && this.connectedAt
                    ? Date.now() - this.connectedAt
                    : undefined,
        };
    }
}
