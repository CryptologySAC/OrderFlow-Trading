import { MessageType, } from "./types.js";
import * as Config from "./config.js";
export class TradeWebSocket {
    url;
    maxBacklogTrades;
    maxReconnectAttempts;
    reconnectDelay;
    pingIntervalTime;
    pongWaitTime;
    onMessage;
    onBacklog;
    onRsiBacklog;
    onReconnectFail;
    ws = null;
    pingInterval = null;
    pongTimeout = null;
    reconnectAttempts = 0;
    constructor({ url, maxBacklogTrades = Config.BACKLOG_TRADES_AMOUNT, maxReconnectAttempts = Config.MAX_RECONNECT_ATTEMPTS, reconnectDelay = Config.RECONNECT_DELAY_MS, pingInterval = Config.PING_INTERVAL_MS, pongWait = Config.PONG_WAIT_MS, onMessage = () => { }, onBacklog = () => { }, onRsiBacklog = () => { }, onReconnectFail = () => { }, }) {
        this.url = url;
        this.maxBacklogTrades = maxBacklogTrades;
        this.maxReconnectAttempts = maxReconnectAttempts;
        this.reconnectDelay = reconnectDelay;
        this.pingIntervalTime = pingInterval;
        this.pongWaitTime = pongWait;
        this.onMessage = onMessage;
        this.onBacklog = onBacklog;
        this.onRsiBacklog = onRsiBacklog;
        this.onReconnectFail = onReconnectFail;
    }
    connect() {
        try {
            this.ws = new WebSocket(this.url);
        }
        catch (error) {
            console.error("WebSocket instantiation failed:", error);
            this.handleReconnect();
            return;
        }
        this.ws.onopen = this.handleOpen.bind(this);
        this.ws.onmessage = this.handleMessage.bind(this);
        this.ws.onerror = this.handleError.bind(this);
        this.ws.onclose = this.handleClose.bind(this);
    }
    handleOpen() {
        console.log("WebSocket connected:", this.url);
        this.reconnectAttempts = 0;
        setTimeout(() => {
            this.sendMessage({
                type: MessageType.BACKLOG,
                data: { amount: this.maxBacklogTrades },
            });
            this.startPing();
        }, 50);
    }
    handleMessage(event) {
        try {
            const message = this.safeJsonParse(event.data);
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
        }
        catch (error) {
            console.error("Failed to process message:", error, event.data);
        }
    }
    handleBacklog(message) {
        if (Array.isArray(message.data)) {
            this.onBacklog(message.data);
        }
        else {
            console.warn("Received malformed backlog data:", message.data);
        }
    }
    handleRsiBacklog(message) {
        if (Array.isArray(message.data)) {
            this.onRsiBacklog(message.data);
        }
        else {
            console.warn("Received malformed RSI backlog data:", message.data);
        }
    }
    handleError(event) {
        console.error("WebSocket error:", event);
        this.stopPing();
    }
    handleClose() {
        console.warn("WebSocket closed:", this.url);
        this.stopPing();
        this.handleReconnect();
    }
    handleReconnect() {
        if (this.reconnectAttempts < this.maxReconnectAttempts) {
            this.reconnectAttempts++;
            const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);
            console.log(`Reconnecting in ${delay / 1000}s... (Attempt ${this.reconnectAttempts})`);
            setTimeout(() => this.connect(), delay);
        }
        else {
            console.error("Max reconnect attempts reached. Giving up.");
            this.onReconnectFail();
        }
    }
    startPing() {
        this.stopPing();
        this.pingInterval = setInterval(() => {
            if (this.sendMessage({ type: MessageType.PING })) {
                this.startPongTimeout();
            }
        }, this.pingIntervalTime);
    }
    startPongTimeout() {
        this.clearPongTimeout();
        this.pongTimeout = setTimeout(() => {
            console.warn("Pong timeout — closing WebSocket to force reconnect.");
            this.ws?.close();
        }, this.pongWaitTime);
    }
    clearPongTimeout() {
        if (this.pongTimeout) {
            clearTimeout(this.pongTimeout);
            this.pongTimeout = null;
        }
    }
    stopPing() {
        if (this.pingInterval) {
            clearInterval(this.pingInterval);
            this.pingInterval = null;
        }
        this.clearPongTimeout();
    }
    disconnect() {
        console.log("Disconnecting WebSocket.");
        this.stopPing();
        if (this.ws) {
            this.ws.onclose = null;
            this.ws.close();
        }
    }
    sendMessage(message) {
        if (this.ws?.readyState === WebSocket.OPEN) {
            try {
                const safeMessage = this.safeJsonStringify(message);
                if (!safeMessage) {
                    return false;
                }
                this.ws.send(safeMessage);
                return true;
            }
            catch (error) {
                console.error("Error sending WebSocket message:", error);
                return false;
            }
        }
        console.warn("WebSocket not open. Ready state:", this.ws?.readyState);
        return false;
    }
    isValidMessage(data) {
        if (typeof data !== "object" || data === null) {
            return false;
        }
        const obj = data;
        if (typeof obj["type"] !== "string") {
            return false;
        }
        return Object.values(MessageType).includes(obj["type"]);
    }
    safeJsonParse(str) {
        try {
            return JSON.parse(str);
        }
        catch (e) {
            console.error("JSON parsing error:", e);
            return null;
        }
    }
    safeJsonStringify(obj) {
        const cache = new Set();
        return JSON.stringify(obj, (_key, value) => {
            if (typeof value === "object" && value !== null) {
                if (cache.has(value)) {
                    return null;
                }
                cache.add(value);
            }
            return value;
        });
    }
}
