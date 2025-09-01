import {
    type WebSocketMessage,
    MessageType,
    type TradeMessage,
    type BacklogMessage,
    type PingMessage,
} from "./types.js";

// --- Configuration Interfaces ---
interface TradeWebSocketConfig {
    url: string;
    maxTrades?: number;
    maxReconnectAttempts?: number;
    reconnectDelay?: number;
    pingInterval?: number;
    pongWait?: number;
    onMessage?: (message: WebSocketMessage) => void;
    onBacklog?: (data: TradeMessage[]) => void;
    onReconnectFail?: () => void;
    onTimeout?: () => void;
}

// --- Main Class ---
export class TradeWebSocket {
    private readonly url: string;
    private readonly maxTrades: number;
    private readonly maxReconnectAttempts: number;
    private readonly reconnectDelay: number;
    private readonly pingIntervalTime: number;
    private readonly pongWaitTime: number;

    private onMessage: (message: WebSocketMessage) => void;
    private onBacklog: (data: TradeMessage[]) => void;
    private onReconnectFail: () => void;
    private onTimeout: () => void;

    private ws: WebSocket | null = null;
    private pingInterval: NodeJS.Timeout | null = null;
    private pongTimeout: NodeJS.Timeout | null = null;
    private reconnectAttempts = 0;

    constructor({
        url,
        maxTrades = 50000,
        maxReconnectAttempts = 10,
        reconnectDelay = 1000,
        pingInterval = 10000,
        pongWait = 5000,
        onMessage = () => {},
        onBacklog = () => {},
        onReconnectFail = () => {},
        onTimeout = () => {},
    }: TradeWebSocketConfig) {
        this.url = url;
        this.maxTrades = maxTrades;
        this.maxReconnectAttempts = maxReconnectAttempts;
        this.reconnectDelay = reconnectDelay;
        this.pingIntervalTime = pingInterval;
        this.pongWaitTime = pongWait;

        this.onMessage = onMessage;
        this.onBacklog = onBacklog;
        this.onReconnectFail = onReconnectFail;
        this.onTimeout = onTimeout;
    }

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

    private handleOpen(): void {
        console.log("WebSocket connected:", this.url);
        this.reconnectAttempts = 0;
        setTimeout(() => {
            this.sendMessage({
                type: MessageType.BACKLOG,
                data: { amount: this.maxTrades },
            });
            this.startPing();
        }, 50);
    }

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
                default:
                    this.onMessage(message);
                    break;
            }
        } catch (error) {
            console.error("Failed to process message:", error, event.data);
        }
    }

    private handleBacklog(message: BacklogMessage): void {
        if (Array.isArray(message.data)) {
            console.log(`Backlog of ${message.data.length} trades received.`);
            this.onBacklog(message.data);
        } else {
            console.warn("Received malformed backlog data:", message.data);
        }
    }

    private handleError(event: Event): void {
        console.error("WebSocket error:", event);
        this.stopPing();
    }

    private handleClose(): void {
        console.warn("WebSocket closed:", this.url);
        this.stopPing();
        this.handleReconnect();
    }

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

    private startPing(): void {
        this.stopPing(); // Ensure no multiple intervals are running
        this.pingInterval = setInterval(() => {
            if (this.sendMessage({ type: MessageType.PING })) {
                this.startPongTimeout();
            }
        }, this.pingIntervalTime);
    }

    private startPongTimeout(): void {
        this.clearPongTimeout();
        this.pongTimeout = setTimeout(() => {
            console.warn(
                "Pong timeout — closing WebSocket to force reconnect."
            );
            this.ws?.close();
        }, this.pongWaitTime);
    }

    private clearPongTimeout(): void {
        if (this.pongTimeout) {
            clearTimeout(this.pongTimeout);
            this.pongTimeout = null;
        }
    }

    private stopPing(): void {
        if (this.pingInterval) {
            clearInterval(this.pingInterval);
            this.pingInterval = null;
        }
        this.clearPongTimeout();
    }

    disconnect(): void {
        console.log("Disconnecting WebSocket.");
        this.stopPing();
        if (this.ws) {
            this.ws.onclose = null; // Prevent reconnect logic on manual disconnect
            this.ws.close();
        }
    }

    sendMessage(
        message:
            | PingMessage
            | { type: MessageType.BACKLOG; data: { amount: number } }
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

    // --- Data Safety & Validation ---
    private isValidMessage(data: unknown): data is WebSocketMessage {
        if (typeof data !== "object" || data === null) {
            return false;
        }

        const obj = data as Record<string, unknown>;

        if (typeof obj.type !== "string") {
            return false;
        }

        return Object.values(MessageType).includes(obj.type as MessageType);
    }

    private safeJsonParse(str: string): unknown {
        try {
            return JSON.parse(str);
        } catch (e) {
            console.error("JSON parsing error:", e);
            return null;
        }
    }

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
