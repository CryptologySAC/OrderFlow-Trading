// frontend/src/websocket.ts

import {
    MessageType,
    type WebSocketMessage,
    type TradeData,
    type OrderBookData,
    type BacklogMessage,
    type PingMessage,
    type RsiBacklogMessage,
} from "./types.js";

import type { RSIDataPoint, Signal, Anomaly } from "./frontend-types.js";
import * as Config from "./config.js";

/**
 * Configuration options for the TradeWebSocket class
 * @interface TradeWebSocketConfig
 */
interface TradeWebSocketConfig {
    /** WebSocket server URL to connect to */
    url: string;
    /** Maximum number of backlog trades to request on connection */
    maxBacklogTrades?: number;
    /** Maximum number of backlog RSI points to request on connection */
    maxBacklogRsi?: number;
    /** Maximum number of reconnection attempts before giving up */
    maxReconnectAttempts?: number;
    /** Base delay between reconnection attempts (exponential backoff) */
    reconnectDelay?: number;
    /** Interval for sending ping messages to keep connection alive */
    pingInterval?: number;
    /** Time to wait for pong response before considering connection dead */
    pongWait?: number;
    /** Callback fired when a WebSocket message is received */
    onMessage?: (message: WebSocketMessage) => void;
    /** Callback fired when backlog trade data is received */
    onBacklog?: (data: TradeData[]) => void;
    /** Callback fired when RSI backlog data is received */
    onRsiBacklog?: (data: RSIDataPoint[]) => void;
    /** Callback fired when trade data is received */
    onTrade?: (data: TradeData) => void;
    /** Callback fired when RSI data is received */
    onRsi?: (data: RSIDataPoint) => void;
    /** Callback fired when Order book data is received */
    onOrderBook?: (data: OrderBookData) => void;
    /** Callback fired when Signal data is received */
    onSignal?: (data: Signal) => void;
    /** Callback fired when Anomaly data is received */
    onAnomaly?: (data: Anomaly) => void;
    /** Callback fired when reconnection attempts are exhausted */
    onReconnectFail?: () => void;
    /** Callback fired when connection times out */
    onTimeout?: () => void;
    /** Callback fired when a WebSocket error occurs */
    onError?: () => void;
}

/**
 * WebSocket client for real-time trade and RSI data streaming
 *
 * Handles automatic reconnection, ping/pong keepalive, and backlog data requests.
 * Provides robust error handling and connection state management.
 *
 * @example
 * ```typescript
 * const ws = new TradeWebSocket({
 *     url: 'wss://api.example.com/trades',
 *     onMessage: (msg) => console.log('Received:', msg),
 *     onBacklog: (trades) => updateChart(trades)
 * });
 * ws.connect();
 * ```
 */
export class TradeWebSocket {
    /** WebSocket server URL */
    private readonly url: string;
    /** Maximum backlog trades to request */
    private readonly maxBacklogTrades: number;
    /** Maximum backlog Rsi points to request */
    private readonly maxBacklogRsi: number;
    /** Maximum reconnection attempts */
    private readonly maxReconnectAttempts: number;
    /** Base reconnection delay */
    private readonly reconnectDelay: number;
    /** Ping interval duration */
    private readonly pingIntervalTime: number;
    /** Pong response timeout */
    private readonly pongWaitTime: number;

    /** Message handler callback */
    private onMessage: (message: WebSocketMessage) => void;
    /** Backlog data handler callback */
    private onBacklog: (data: TradeData[]) => void;
    /** RSI backlog data handler callback */
    private onRsiBacklog: (data: RSIDataPoint[]) => void;
    /** Reconnection failure handler callback */
    private onReconnectFail: () => void;

    /** Current WebSocket connection instance */
    private ws: WebSocket | null = null;
    /** Ping interval timer */
    private pingInterval: NodeJS.Timeout | null = null;
    /** Pong timeout timer */
    private pongTimeout: NodeJS.Timeout | null = null;
    /** Current reconnection attempt count */
    private reconnectAttempts = 0;

    /**
     * Creates a new TradeWebSocket instance
     * @param config - Configuration options for the WebSocket connection
     */
    constructor({
        url,
        maxBacklogTrades = Config.BACKLOG_TRADES_AMOUNT,
        maxBacklogRsi = Config.BACKLOG_RSI_AMOUNT,
        maxReconnectAttempts = Config.MAX_RECONNECT_ATTEMPTS,
        reconnectDelay = Config.RECONNECT_DELAY_MS,
        pingInterval = Config.PING_INTERVAL_MS,
        pongWait = Config.PONG_WAIT_MS,
        onMessage = () => {},
        onBacklog = () => {},
        onRsiBacklog = () => {},
        onReconnectFail = () => {},
    }: TradeWebSocketConfig) {
        this.url = url;
        this.maxBacklogTrades = maxBacklogTrades;
        this.maxBacklogRsi = maxBacklogRsi;
        this.maxReconnectAttempts = maxReconnectAttempts;
        this.reconnectDelay = reconnectDelay;
        this.pingIntervalTime = pingInterval;
        this.pongWaitTime = pongWait;

        this.onMessage = onMessage;
        this.onBacklog = onBacklog;
        this.onRsiBacklog = onRsiBacklog;
        this.onReconnectFail = onReconnectFail;
    }

    /**
     * Initiates WebSocket connection to the server
     * Sets up event handlers and begins the connection process
     */
    connect(): void {
        try {
            this.ws = new WebSocket(this.url);
        } catch (error) {
            console.error("WebSocket instantiation failed:", error);
            this.handleReconnect();
            return;
        }

        this.ws.onopen = this.handleOpen.bind(this);
        this.ws.onmessage = this.handleMessage.bind(this);
        this.ws.onerror = this.handleError.bind(this);
        this.ws.onclose = this.handleClose.bind(this);
    }

    /**
     * Handles successful WebSocket connection
     * Requests backlog data and starts ping interval
     * @private
     */
    private handleOpen(): void {
        console.log("WebSocket connected:", this.url);
        this.reconnectAttempts = 0;
        setTimeout(() => {
            this.sendMessage({
                type: MessageType.BACKLOG,
                data: { amount: this.maxBacklogTrades },
            });
            //this.sendMessage({ //TODO
            //    type: MessageType.RSI_BACKLOG,
            //    data: { amount: this.maxBacklogRsi },
            //});
            void this.maxBacklogRsi; // TODO
            this.startPing();
        }, 50);
    }

    /**
     * Processes incoming WebSocket messages
     * Routes messages to appropriate handlers based on message type
     * @param event - WebSocket message event
     * @private
     */
    private handleMessage(event: MessageEvent): void {
        try {
            const message = this.safeJsonParse(event.data as string);
            if (!this.isValidMessage(message)) {
                console.warn("Invalid message structure or type:", message);
                return;
            }

            switch (message.type) {
                case MessageType.PONG:
                    this.clearPongTimeout();
                    break;
                case MessageType.BACKLOG:
                    this.handleBacklog(message);
                    break;
                case MessageType.RSI_BACKLOG:
                    this.handleRsiBacklog(message);
                    break;
                default:
                    this.onMessage(message);
                    break;
            }
        } catch (error) {
            console.error("Failed to process message:", error, event.data);
        }
    }

    /**
     * Processes backlog trade data messages
     * @param message - Backlog message containing trade data
     * @private
     */
    private handleBacklog(message: BacklogMessage): void {
        if (Array.isArray(message.data)) {
            this.onBacklog(message.data);
        } else {
            console.warn("Received malformed backlog data:", message.data);
        }
    }

    /**
     * Processes RSI backlog data messages
     * @param message - RSI backlog message containing RSI data
     * @private
     */
    private handleRsiBacklog(message: RsiBacklogMessage): void {
        if (Array.isArray(message.data)) {
            this.onRsiBacklog(message.data);
        } else {
            console.warn("Received malformed RSI backlog data:", message.data);
        }
    }

    /**
     * Handles WebSocket errors
     * @param event - Error event
     * @private
     */
    private handleError(event: Event): void {
        console.error("WebSocket error:", event);
        this.stopPing();
    }

    /**
     * Handles WebSocket connection closure
     * Initiates reconnection process
     * @private
     */
    private handleClose(): void {
        console.warn("WebSocket closed:", this.url);
        this.stopPing();
        this.handleReconnect();
    }

    /**
     * Manages reconnection attempts with exponential backoff
     * @private
     */
    private handleReconnect(): void {
        if (this.reconnectAttempts < this.maxReconnectAttempts) {
            this.reconnectAttempts++;
            const delay =
                this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);
            console.log(
                `Reconnecting in ${delay / 1000}s... (Attempt ${this.reconnectAttempts})`
            );
            setTimeout(() => this.connect(), delay);
        } else {
            console.error("Max reconnect attempts reached. Giving up.");
            this.onReconnectFail();
        }
    }

    /**
     * Starts the ping interval for connection keepalive
     * @private
     */
    private startPing(): void {
        this.stopPing(); // Ensure no multiple intervals are running
        this.pingInterval = setInterval(() => {
            if (this.sendMessage({ type: MessageType.PING, now: Date.now() })) {
                this.startPongTimeout();
            }
        }, this.pingIntervalTime);
    }

    /**
     * Starts pong timeout timer for connection health monitoring
     * @private
     */
    private startPongTimeout(): void {
        this.clearPongTimeout();
        this.pongTimeout = setTimeout(() => {
            console.warn(
                "Pong timeout — closing WebSocket to force reconnect."
            );
            this.ws?.close();
        }, this.pongWaitTime);
    }

    /**
     * Clears the pong timeout timer
     * @private
     */
    private clearPongTimeout(): void {
        if (this.pongTimeout) {
            clearTimeout(this.pongTimeout);
            this.pongTimeout = null;
        }
    }

    /**
     * Stops the ping interval and clears pong timeout
     * @private
     */
    private stopPing(): void {
        if (this.pingInterval) {
            clearInterval(this.pingInterval);
            this.pingInterval = null;
        }
        this.clearPongTimeout();
    }

    /**
     * Gracefully disconnects the WebSocket connection
     * Stops ping interval and prevents automatic reconnection
     */
    disconnect(): void {
        console.log("Disconnecting WebSocket.");
        this.stopPing();
        if (this.ws) {
            this.ws.onclose = null; // Prevent reconnect logic on manual disconnect
            this.ws.close();
        }
    }

    /**
     * Sends a message through the WebSocket connection
     * @param message - Message to send (Ping or Backlog request)
     * @returns true if message was sent successfully, false otherwise
     */
    sendMessage(
        message:
            | PingMessage
            | { type: MessageType.BACKLOG; data: { amount: number } }
            | { type: MessageType.RSI_BACKLOG; data: { amount: number } }
    ): boolean {
        if (this.ws?.readyState === WebSocket.OPEN) {
            try {
                const safeMessage = this.safeJsonStringify(message);
                if (!safeMessage) {
                    return false;
                }

                this.ws.send(safeMessage);
                return true;
            } catch (error) {
                console.error("Error sending WebSocket message:", error);
                return false;
            }
        }
        console.warn("WebSocket not open. Ready state:", this.ws?.readyState);
        return false;
    }

    /**
     * Validates if the received data is a valid WebSocket message
     * @param data - Data to validate
     * @returns true if data is a valid WebSocketMessage
     * @private
     */
    private isValidMessage(data: unknown): data is WebSocketMessage {
        if (typeof data !== "object" || data === null) {
            return false;
        }

        const obj = data as Record<string, unknown>;

        if (typeof obj["type"] !== "string") {
            return false;
        }

        return Object.values(MessageType).includes(obj["type"] as MessageType);
    }

    /**
     * Safely parses JSON string with error handling
     * @param str - JSON string to parse
     * @returns parsed object or null if parsing failed
     * @private
     */
    private safeJsonParse(str: string): unknown {
        try {
            return JSON.parse(str);
        } catch (e) {
            console.error("JSON parsing error:", e);
            return null;
        }
    }

    /**
     * Safely stringifies object to JSON with circular reference protection
     * @param obj - Object to stringify
     * @returns JSON string or null if stringification failed
     * @private
     */
    private safeJsonStringify(obj: unknown): string | null {
        const cache = new Set();
        return JSON.stringify(obj, (_key, value) => {
            if (typeof value === "object" && value !== null) {
                if (cache.has(value)) {
                    // Circular reference found, discard key
                    return null;
                }
                cache.add(value);
            }
            return value as string;
        });
    }
}
