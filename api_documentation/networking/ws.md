# ws WebSocket API Documentation

Simple to use, blazing fast and thoroughly tested WebSocket client and server for Node.js.

## 📦 Installation

```bash
npm install ws
# or
yarn add ws
```

For TypeScript support:

```bash
npm install --save-dev @types/ws
```

## 🎯 Basic Usage

### WebSocket Client

```typescript
import WebSocket from "ws";

const ws = new WebSocket("ws://localhost:8080");

ws.on("error", console.error);

ws.on("open", function open() {
    console.log("Connected to WebSocket server");
    ws.send("Hello Server!");
});

ws.on("message", function message(data) {
    console.log("Received:", data.toString());
});

ws.on("close", function close() {
    console.log("Connection closed");
});
```

### WebSocket Server

```typescript
import { WebSocketServer } from "ws";

const wss = new WebSocketServer({ port: 8080 });

wss.on("connection", function connection(ws, request) {
    console.log("New client connected");

    ws.on("error", console.error);

    ws.on("message", function message(data) {
        console.log("Received from client:", data.toString());

        // Echo back to client
        ws.send(`Echo: ${data}`);

        // Broadcast to all clients
        wss.clients.forEach(function each(client) {
            if (client !== ws && client.readyState === WebSocket.OPEN) {
                client.send(`Broadcast: ${data}`);
            }
        });
    });

    ws.send("Welcome to the WebSocket server!");
});

console.log("WebSocket server listening on port 8080");
```

## 📖 Core API

### WebSocket Client Constructor

```typescript
new WebSocket(address: string | URL, protocols?: string | string[], options?: ClientOptions)

interface ClientOptions extends EventEmitter.EventEmitterOptions {
  followRedirects?: boolean;
  generateMask?: (mask: Buffer) => void;
  handshakeTimeout?: number;
  maxPayload?: number;
  maxRedirects?: number;
  origin?: string;
  perMessageDeflate?: boolean | PerMessageDeflateOptions;
  protocolVersion?: number;
  skipUTF8Validation?: boolean;
  headers?: { [key: string]: string };
  localAddress?: string;
  localPort?: number;
  family?: number;
  checkServerIdentity?: (servername: string, cert: any) => boolean;
  agent?: any;
  ca?: any;
  cert?: any;
  key?: any;
  passphrase?: string;
  pfx?: any;
  rejectUnauthorized?: boolean;
  timeout?: number;
}
```

### WebSocket Server Constructor

```typescript
new WebSocketServer(options?: ServerOptions, callback?: () => void)

interface ServerOptions extends EventEmitter.EventEmitterOptions {
  host?: string;
  port?: number;
  backlog?: number;
  server?: any; // HTTP server instance
  verifyClient?: VerifyClientCallbackAsync | VerifyClientCallbackSync;
  handleProtocols?: (protocols: Set<string>, request: any) => string | false;
  path?: string;
  noServer?: boolean;
  clientTracking?: boolean;
  perMessageDeflate?: boolean | PerMessageDeflateOptions;
  maxPayload?: number;
  skipUTF8Validation?: boolean;
  WebSocket?: typeof WebSocket;
}
```

### WebSocket Properties and Methods

```typescript
interface WebSocket extends EventEmitter {
  // Ready states
  static readonly CONNECTING: 0;
  static readonly OPEN: 1;
  static readonly CLOSING: 2;
  static readonly CLOSED: 3;

  // Instance properties
  readonly readyState: number;
  readonly url: string;
  readonly protocol: string;
  readonly extensions: { [key: string]: any };
  readonly bufferedAmount: number;
  readonly binaryType: 'nodebuffer' | 'arraybuffer' | 'fragments';

  // Methods
  send(data: any, options?: { mask?: boolean; binary?: boolean; compress?: boolean; fin?: boolean }, cb?: (err?: Error) => void): void;
  ping(data?: any, mask?: boolean, cb?: (err?: Error) => void): void;
  pong(data?: any, mask?: boolean, cb?: (err?: Error) => void): void;
  close(code?: number, reason?: string | Buffer): void;
  terminate(): void;

  // Event handlers
  on(event: 'open', listener: () => void): this;
  on(event: 'close', listener: (code: number, reason: Buffer) => void): this;
  on(event: 'error', listener: (err: Error) => void): this;
  on(event: 'message', listener: (data: RawData, isBinary: boolean) => void): this;
  on(event: 'ping', listener: (data: Buffer) => void): this;
  on(event: 'pong', listener: (data: Buffer) => void): this;
  on(event: 'unexpected-response', listener: (request: any, response: any) => void): this;
  on(event: 'upgrade', listener: (response: any) => void): this;
}

type RawData = Buffer | ArrayBuffer | Buffer[];
```

### WebSocketServer Methods

```typescript
interface WebSocketServer extends EventEmitter {
    readonly clients: Set<WebSocket>;
    readonly options: ServerOptions;
    readonly path: string;

    // Methods
    address(): AddressInfo | string | null;
    close(cb?: (err?: Error) => void): void;
    handleUpgrade(
        request: any,
        socket: any,
        head: Buffer,
        callback: (client: WebSocket, request: any) => void
    ): void;
    shouldHandle(request: any): boolean | Promise<boolean>;

    // Event handlers
    on(
        event: "connection",
        listener: (socket: WebSocket, request: any) => void
    ): this;
    on(event: "error", listener: (err: Error) => void): this;
    on(
        event: "headers",
        listener: (headers: string[], request: any) => void
    ): this;
    on(event: "close", listener: () => void): this;
    on(event: "listening", listener: () => void): this;
}
```

## 🔧 Advanced Features

### Message Types and Sending Data

```typescript
const ws = new WebSocket("ws://localhost:8080");

ws.on("open", function open() {
    // Send text message
    ws.send("Hello World!");

    // Send binary data
    const buffer = Buffer.from("binary data");
    ws.send(buffer);

    // Send JSON data
    ws.send(JSON.stringify({ type: "message", data: "Hello" }));

    // Send with options
    ws.send("data", {
        binary: false,
        compress: true,
        fin: true,
    });
});
```

### Connection Verification

```typescript
const wss = new WebSocketServer({
    port: 8080,
    verifyClient: (info) => {
        // Verify client based on origin, headers, etc.
        const origin = info.origin;
        const userAgent = info.req.headers["user-agent"];

        // Custom verification logic
        if (origin !== "https://trusted-domain.com") {
            return false;
        }

        return true;
    },
});
```

### Per-Message Deflate Compression

```typescript
// Client with compression
const ws = new WebSocket("ws://localhost:8080", {
    perMessageDeflate: {
        threshold: 1024, // Compress messages > 1KB
        concurrencyLimit: 10, // Max concurrent compression operations
        serverMaxWindowBits: 15, // Server's LZ77 sliding window size
        clientMaxWindowBits: 15, // Client's LZ77 sliding window size
    },
});

// Server with compression
const wss = new WebSocketServer({
    port: 8080,
    perMessageDeflate: {
        threshold: 1024,
        deflateOnBusyQueue: false,
    },
});
```

### Heartbeat/Ping-Pong

```typescript
function heartbeat() {
    this.isAlive = true;
}

const wss = new WebSocketServer({ port: 8080 });

wss.on("connection", function connection(ws) {
    ws.isAlive = true;
    ws.on("pong", heartbeat);
});

// Heartbeat interval
const interval = setInterval(function ping() {
    wss.clients.forEach(function each(ws) {
        if (ws.isAlive === false) {
            return ws.terminate();
        }

        ws.isAlive = false;
        ws.ping();
    });
}, 30000);

wss.on("close", function close() {
    clearInterval(interval);
});
```

### Custom Protocols

```typescript
// Client with subprotocol
const ws = new WebSocket("ws://localhost:8080", ["protocol1", "protocol2"]);

ws.on("open", function open() {
    console.log("Connected with protocol:", ws.protocol);
});

// Server handling protocols
const wss = new WebSocketServer({
    port: 8080,
    handleProtocols: (protocols, request) => {
        if (protocols.has("preferred-protocol")) {
            return "preferred-protocol";
        }
        return false; // Reject connection
    },
});
```

## 🎯 Usage in OrderFlow Trading

### Dashboard WebSocket Server

```typescript
import { WebSocketServer, WebSocket } from "ws";
import type { RawData } from "ws";

export class OrderFlowWebSocketManager {
    private wss: WebSocketServer;
    private clients = new Map<string, WebSocket>();

    constructor(port: number) {
        this.wss = new WebSocketServer({
            port,
            perMessageDeflate: {
                threshold: 1024,
                concurrencyLimit: 10,
            },
            verifyClient: this.verifyClient.bind(this),
        });

        this.setupEventHandlers();
        this.startHeartbeat();
    }

    private setupEventHandlers(): void {
        this.wss.on("connection", this.handleConnection.bind(this));
        this.wss.on("error", (error) => {
            this.logger.error("WebSocket server error", error);
        });
    }

    private handleConnection(ws: WebSocket, request: any): void {
        const clientId = this.generateClientId();
        this.clients.set(clientId, ws);

        ws.on("message", (data: RawData) => {
            this.handleMessage(ws, clientId, data);
        });

        ws.on("close", () => {
            this.clients.delete(clientId);
            this.logger.info(`Client disconnected: ${clientId}`);
        });

        ws.on("error", (error) => {
            this.logger.error(`WebSocket error for client ${clientId}`, error);
        });

        // Send welcome message
        this.sendToClient(clientId, {
            type: "welcome",
            clientId,
            timestamp: Date.now(),
        });
    }

    private handleMessage(
        ws: WebSocket,
        clientId: string,
        message: RawData
    ): void {
        try {
            const data = JSON.parse(message.toString());

            switch (data.type) {
                case "subscribe":
                    this.handleSubscription(clientId, data.channels);
                    break;
                case "unsubscribe":
                    this.handleUnsubscription(clientId, data.channels);
                    break;
                case "signal_filter":
                    this.updateClientFilters(clientId, data.filters);
                    break;
                default:
                    this.logger.warn(`Unknown message type: ${data.type}`);
            }
        } catch (error) {
            this.logger.error("Failed to parse WebSocket message", {
                error,
                clientId,
            });
        }
    }

    // Broadcast signal to all subscribed clients
    public broadcastSignal(signal: ProcessedSignal): void {
        const message = {
            type: "signal",
            data: signal,
            timestamp: Date.now(),
        };

        this.clients.forEach((ws, clientId) => {
            if (this.shouldReceiveSignal(clientId, signal)) {
                this.sendToClient(clientId, message);
            }
        });
    }

    // Broadcast market data update
    public broadcastMarketUpdate(update: MarketUpdate): void {
        const message = {
            type: "market_update",
            data: update,
            timestamp: Date.now(),
        };

        this.broadcastToAll(message);
    }

    private sendToClient(clientId: string, data: any): void {
        const client = this.clients.get(clientId);
        if (client && client.readyState === WebSocket.OPEN) {
            try {
                client.send(JSON.stringify(data), { compress: true });
            } catch (error) {
                this.logger.error(
                    `Failed to send message to client ${clientId}`,
                    error
                );
            }
        }
    }

    private broadcastToAll(data: any): void {
        const message = JSON.stringify(data);
        this.clients.forEach((client, clientId) => {
            if (client.readyState === WebSocket.OPEN) {
                try {
                    client.send(message, { compress: true });
                } catch (error) {
                    this.logger.error(
                        `Failed to broadcast to client ${clientId}`,
                        error
                    );
                }
            }
        });
    }

    private startHeartbeat(): void {
        setInterval(() => {
            this.clients.forEach((client, clientId) => {
                if (client.readyState === WebSocket.OPEN) {
                    client.ping();
                } else {
                    this.clients.delete(clientId);
                }
            });
        }, 30000);
    }
}
```

### Real-time Data Client

```typescript
export class BinanceWebSocketClient {
    private ws: WebSocket | null = null;
    private reconnectAttempts = 0;
    private maxReconnectAttempts = 5;
    private reconnectDelay = 1000;

    constructor(
        private url: string,
        private onMessage: (data: any) => void,
        private onError: (error: Error) => void
    ) {}

    public connect(): void {
        try {
            this.ws = new WebSocket(this.url, {
                perMessageDeflate: true,
                handshakeTimeout: 10000,
                maxPayload: 100 * 1024 * 1024, // 100MB
            });

            this.ws.on("open", this.handleOpen.bind(this));
            this.ws.on("message", this.handleMessage.bind(this));
            this.ws.on("close", this.handleClose.bind(this));
            this.ws.on("error", this.handleError.bind(this));
            this.ws.on("pong", this.handlePong.bind(this));
        } catch (error) {
            this.handleError(error as Error);
        }
    }

    private handleOpen(): void {
        this.reconnectAttempts = 0;
        this.logger.info("WebSocket connected");

        // Start heartbeat
        this.startHeartbeat();
    }

    private handleMessage(data: RawData): void {
        try {
            const message = JSON.parse(data.toString());
            this.onMessage(message);
        } catch (error) {
            this.logger.error("Failed to parse WebSocket message", error);
        }
    }

    private handleClose(code: number, reason: Buffer): void {
        this.logger.warn(`WebSocket closed: ${code} ${reason.toString()}`);
        this.stopHeartbeat();
        this.scheduleReconnect();
    }

    private handleError(error: Error): void {
        this.logger.error("WebSocket error", error);
        this.onError(error);
    }

    private scheduleReconnect(): void {
        if (this.reconnectAttempts < this.maxReconnectAttempts) {
            this.reconnectAttempts++;
            const delay =
                this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);

            setTimeout(() => {
                this.logger.info(
                    `Reconnecting attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts}`
                );
                this.connect();
            }, delay);
        } else {
            this.logger.error("Max reconnection attempts reached");
        }
    }

    private startHeartbeat(): void {
        this.heartbeatInterval = setInterval(() => {
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                this.ws.ping();
            }
        }, 30000);
    }

    public close(): void {
        this.stopHeartbeat();
        if (this.ws) {
            this.ws.close(1000, "Client closing");
            this.ws = null;
        }
    }
}
```

## ⚙️ Configuration Options

### Client Options

```typescript
interface ClientOptions {
    followRedirects?: boolean; // Follow HTTP redirects
    generateMask?: (mask: Buffer) => void; // Custom masking function
    handshakeTimeout?: number; // Handshake timeout (ms)
    maxPayload?: number; // Max message size
    maxRedirects?: number; // Max redirect follows
    origin?: string; // Origin header
    perMessageDeflate?: boolean; // Enable compression
    protocolVersion?: number; // WebSocket version
    skipUTF8Validation?: boolean; // Skip UTF-8 validation
    headers?: { [key: string]: string }; // Custom headers
}
```

### Server Options

```typescript
interface ServerOptions {
    host?: string; // Bind address
    port?: number; // Listen port
    backlog?: number; // Connection backlog
    server?: any; // Existing HTTP server
    verifyClient?: Function; // Client verification
    handleProtocols?: Function; // Protocol selection
    path?: string; // WebSocket path
    noServer?: boolean; // No HTTP server
    clientTracking?: boolean; // Track client connections
    perMessageDeflate?: boolean; // Enable compression
    maxPayload?: number; // Max message size
    skipUTF8Validation?: boolean; // Skip UTF-8 validation
}
```

## 🔗 Official Resources

- **GitHub Repository**: https://github.com/websockets/ws
- **npm Package**: https://www.npmjs.com/package/ws
- **API Documentation**: https://github.com/websockets/ws/blob/master/doc/ws.md
- **WebSocket RFC**: https://tools.ietf.org/html/rfc6455

## 📝 Requirements

- Node.js v10.0.0 or later
- Optional native add-ons for better performance
- TypeScript definitions available via @types/ws

## ⚠️ Best Practices

1. **Always handle errors** for both client and server
2. **Implement heartbeat/ping-pong** for connection health
3. **Use compression** for large messages
4. **Validate incoming data** before processing
5. **Implement reconnection logic** for clients
6. **Limit message size** to prevent memory issues
7. **Clean up resources** on connection close
8. **Use proper error codes** when closing connections

---

_Version: 8.18.2_  
_Compatible with: OrderFlow Trading System_
