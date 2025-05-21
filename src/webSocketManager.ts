


export class WebSocketManager {
    private ws: WebSocket | null = null;
    private url: string;
    private reconnectAttempts = 0;
    private reconnectDelay = 1000;
    private maxReconnectAttempts = 10;
    private pingInterval: NodeJS.Timeout | null = null;
    private pongTimeout: NodeJS.Timeout | null = null;
    private pingIntervalTime = 10000; // 10 seconds
    private pongWaitTime = 5000; // Wait max 5 seconds for pong
    private reconnectTimer: NodeJS.Timeout | null = null;

    constructor(url: string) {
        this.url = url;
        this.connect();
    }

    private connect() {
        this.ws = new WebSocket(this.url);

        this.ws.onopen = () => {
            console.log("WebSocket connected");
            this.reconnectAttempts = 0;
            this.startPing();
        };

        this.ws.onmessage = (event) => {
            const data = JSON.parse(event.data);
            if (data.type === 'pong') {
                this.clearPongTimeout();
            } else {
                // handle other messages
                console.log("Received:", data);
            }
        };

        this.ws.onerror = (err) => {
            console.error("WebSocket error:", err);
        };

        this.ws.onclose = () => {
            console.warn("WebSocket closed");
            this.cleanup();
            this.tryReconnect();
        };
    }

    private startPing() {
        this.pingInterval = setInterval(() => {
            if (this.ws?.readyState === WebSocket.OPEN) {
                this.ws.send(JSON.stringify({ type: 'ping' }));
                this.startPongTimeout();
            }
        }, this.pingIntervalTime);
    }

    private startPongTimeout() {
        this.clearPongTimeout();
        this.pongTimeout = setTimeout(() => {
            console.warn("Pong not received. Reconnecting...");
            this.ws?.close();
        }, this.pongWaitTime);
    }

    private clearPongTimeout() {
        if (this.pongTimeout) clearTimeout(this.pongTimeout);
        this.pongTimeout = null;
    }

    private cleanup() {
        if (this.pingInterval) clearInterval(this.pingInterval);
        if (this.pongTimeout) clearTimeout(this.pongTimeout);
        this.pingInterval = null;
        this.pongTimeout = null;
    }

    private tryReconnect() {
        if (this.reconnectAttempts < this.maxReconnectAttempts) {
            this.reconnectAttempts++;
            const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);
            this.reconnectTimer = setTimeout(() => this.connect(), delay);
        } else {
            console.error("Max reconnection attempts reached.");
        }
    }

    public send(data: object) {
        if (this.ws?.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(data));
        } else {
            console.warn("WebSocket not open.");
        }
    }

    public close() {
        this.cleanup();
        this.ws?.close();
        if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    }
}
