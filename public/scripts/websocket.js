export class TradeWebSocket {
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
    }) {
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

        this.ws = null;
        this.pingInterval = null;
        this.pongTimeout = null;
        this.reconnectAttempts = 0;
    }

    connect() {
        this.ws = new WebSocket(this.url);

        this.ws.onopen = () => {
            console.log("WebSocket connected:", this.url);
            this.reconnectAttempts = 0;

            // Small delay to ensure connection is stable, then send backlog request
            setTimeout(() => {
                this.sendMessage({
                    type: "backlog",
                    data: { amount: this.maxTrades },
                });
                this.startPing();
            }, 50);
        };

        this.ws.onmessage = (event) => {
            try {
                const message = JSON.parse(event.data);

                if (message.type === "pong") {
                    this.clearPongTimeout();
                    return;
                }

                if (message.type === "backlog") {
                    console.log("Backlog received.");
                    this.onBacklog(message.data);
                    return;
                }

                this.onMessage(message);
            } catch (error) {
                console.error("WebSocket message parse error:", error);
            }
        };

        this.ws.onerror = (error) => {
            console.error("WebSocket error:", error);
            this.stopPing();
        };

        this.ws.onclose = () => {
            console.warn("WebSocket closed:", this.url);
            this.stopPing();

            if (this.reconnectAttempts < this.maxReconnectAttempts) {
                this.reconnectAttempts++;
                const delay =
                    this.reconnectDelay *
                    Math.pow(2, this.reconnectAttempts - 1);
                console.log(`Reconnecting in ${delay / 1000}s...`);
                setTimeout(() => this.connect(), delay);
            } else {
                console.error("Max reconnect attempts reached.");
                this.onReconnectFail();
            }

            this.onTimeout();
        };
    }

    startPing() {
        this.pingInterval = setInterval(() => {
            if (this.sendMessage({ type: "ping" })) {
                this.startPongTimeout();
            }
        }, this.pingIntervalTime);
    }

    startPongTimeout() {
        this.clearPongTimeout();
        this.pongTimeout = setTimeout(() => {
            console.warn("Pong timeout — closing WebSocket");
            this.ws.close(); // triggers reconnect
        }, this.pongWaitTime);
    }

    clearPongTimeout() {
        if (this.pongTimeout) clearTimeout(this.pongTimeout);
        this.pongTimeout = null;
    }

    stopPing() {
        if (this.pingInterval) clearInterval(this.pingInterval);
        this.clearPongTimeout();
        this.pingInterval = null;
    }

    disconnect() {
        this.stopPing();
        if (this.ws) this.ws.close();
    }

    // Safe send method that checks connection state
    sendMessage(message) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            try {
                // Import safe stringify from main.js or use fallback
                const safeStringify = window.safeStringify || JSON.stringify;
                this.ws.send(safeStringify(message));
                return true;
            } catch (error) {
                console.error("Error sending WebSocket message:", error);
                return false;
            }
        } else {
            console.warn(
                "WebSocket not ready for sending:",
                this.ws ? this.ws.readyState : "no connection"
            );
            return false;
        }
    }
}
