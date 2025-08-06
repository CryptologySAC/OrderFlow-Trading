# MQTT.js API Documentation

The MQTT client for Node.js and the browser with MQTT 5.0 support.

## 📦 Installation

```bash
npm install mqtt
# or
yarn add mqtt
```

## 🎯 Basic Usage

### Connect to MQTT Broker

```typescript
import mqtt from "mqtt";

// Connect to broker
const client = mqtt.connect("mqtt://broker.hivemq.com");

// Or with options
const client = mqtt.connect("mqtt://broker.hivemq.com", {
    clientId: "orderflow-client",
    username: "your-username",
    password: "your-password",
    keepalive: 60,
    reconnectPeriod: 5000,
});
```

### Basic Publish/Subscribe

```typescript
client.on("connect", function () {
    console.log("Connected to MQTT broker");

    // Subscribe to topic
    client.subscribe("orderflow/signals", function (err) {
        if (!err) {
            console.log("Subscribed to orderflow/signals");
        }
    });

    // Publish message
    client.publish(
        "orderflow/stats",
        JSON.stringify({
            timestamp: Date.now(),
            activeSignals: 5,
            systemStatus: "healthy",
        })
    );
});

client.on("message", function (topic, message) {
    console.log(`Received message on ${topic}:`, message.toString());
});

client.on("error", function (error) {
    console.error("MQTT Error:", error);
});
```

## 📖 Core API

### Connection Methods

```typescript
// Connect to broker
mqtt.connect(brokerUrl: string, options?: IClientOptions): MqttClient

// Connection URLs support multiple protocols
mqtt.connect('mqtt://localhost:1883')        // MQTT over TCP
mqtt.connect('mqtts://localhost:8883')       // MQTT over TLS
mqtt.connect('ws://localhost:8080/mqtt')     // MQTT over WebSocket
mqtt.connect('wss://localhost:8080/mqtt')    // MQTT over secure WebSocket
```

### Connection Options

```typescript
interface IClientOptions {
    // Connection
    host?: string; // Broker hostname
    port?: number; // Broker port
    protocol?: "mqtt" | "mqtts" | "ws" | "wss";
    hostname?: string; // Alias for host

    // Authentication
    clientId?: string; // Client identifier
    username?: string; // Username for authentication
    password?: string | Buffer; // Password for authentication

    // Connection behavior
    keepalive?: number; // Keep alive period (seconds, default: 60)
    connectTimeout?: number; // Connection timeout (ms, default: 30000)
    reconnectPeriod?: number; // Reconnect period (ms, default: 1000)
    clean?: boolean; // Clean session flag (default: true)

    // Will message
    will?: {
        topic: string;
        payload: string | Buffer;
        qos?: QoS;
        retain?: boolean;
        properties?: IUserProperties;
    };

    // TLS options (for mqtts)
    key?: string | Buffer;
    cert?: string | Buffer;
    ca?: string | Buffer | Buffer[];
    rejectUnauthorized?: boolean;

    // WebSocket options (for ws/wss)
    wsOptions?: any;

    // MQTT 5.0 properties
    properties?: {
        sessionExpiryInterval?: number;
        receiveMaximum?: number;
        maximumPacketSize?: number;
        topicAliasMaximum?: number;
        requestResponseInformation?: boolean;
        requestProblemInformation?: boolean;
        userProperties?: IUserProperties;
        authenticationMethod?: string;
        authenticationData?: Buffer;
    };
}

type QoS = 0 | 1 | 2;
type IUserProperties = { [key: string]: string | string[] };
```

### Client Methods

```typescript
interface MqttClient extends EventEmitter {
    // Publishing
    publish(
        topic: string,
        message: string | Buffer,
        options?: IClientPublishOptions,
        callback?: PacketCallback
    ): MqttClient;
    publish(
        topic: string,
        message: string | Buffer,
        callback?: PacketCallback
    ): MqttClient;

    // Subscribing
    subscribe(
        topic: string | string[],
        options?: IClientSubscribeOptions,
        callback?: ClientSubscribeCallback
    ): MqttClient;
    subscribe(
        topic: string | string[],
        callback?: ClientSubscribeCallback
    ): MqttClient;

    // Unsubscribing
    unsubscribe(
        topic: string | string[],
        options?: any,
        callback?: PacketCallback
    ): MqttClient;
    unsubscribe(
        topic: string | string[],
        callback?: PacketCallback
    ): MqttClient;

    // Connection management
    end(force?: boolean, options?: any, callback?: () => void): MqttClient;
    reconnect(options?: IClientOptions): MqttClient;

    // Properties
    connected: boolean;
    disconnecting: boolean;
    disconnected: boolean;
    reconnecting: boolean;

    // Getters
    getLastMessageId(): number;
    options: IClientOptions;
}
```

### Publish Options

```typescript
interface IClientPublishOptions {
    qos?: QoS; // Quality of Service (0, 1, 2)
    retain?: boolean; // Retain flag
    dup?: boolean; // Duplicate flag

    // MQTT 5.0 properties
    properties?: {
        payloadFormatIndicator?: boolean;
        messageExpiryInterval?: number;
        topicAlias?: number;
        responseTopic?: string;
        correlationData?: Buffer;
        userProperties?: IUserProperties;
        subscriptionIdentifier?: number;
        contentType?: string;
    };
}
```

### Subscribe Options

```typescript
interface IClientSubscribeOptions {
    qos?: QoS; // Quality of Service

    // MQTT 5.0 properties
    properties?: {
        subscriptionIdentifier?: number;
        userProperties?: IUserProperties;
    };
}
```

### Events

```typescript
client.on('connect', (connack: IConnackPacket) => void);
client.on('reconnect', () => void);
client.on('close', () => void);
client.on('disconnect', (packet: IDisconnectPacket) => void);
client.on('offline', () => void);
client.on('error', (error: Error) => void);
client.on('message', (topic: string, payload: Buffer, packet: IPublishPacket) => void);
client.on('packetsend', (packet: Packet) => void);
client.on('packetreceive', (packet: Packet) => void);
```

## 🔧 Advanced Features

### Quality of Service (QoS)

```typescript
// QoS 0 - At most once delivery (fire and forget)
client.publish("sensors/temperature", "23.5", { qos: 0 });

// QoS 1 - At least once delivery (acknowledged delivery)
client.publish("alerts/critical", "System overheated", { qos: 1 }, (err) => {
    if (err) {
        console.error("Failed to publish:", err);
    } else {
        console.log("Message published successfully");
    }
});

// QoS 2 - Exactly once delivery (assured delivery)
client.publish("transactions/payment", JSON.stringify(paymentData), { qos: 2 });
```

### Retained Messages

```typescript
// Publish retained message (last value cache)
client.publish("status/system", "online", {
    retain: true,
    qos: 1,
});

// Clear retained message
client.publish("status/system", "", {
    retain: true,
    qos: 1,
});
```

### Will Messages (Last Will and Testament)

```typescript
const client = mqtt.connect("mqtt://broker.example.com", {
    will: {
        topic: "status/client",
        payload: "offline",
        qos: 1,
        retain: true,
    },
});
```

### Topic Wildcards

```typescript
// Single level wildcard (+)
client.subscribe("sensors/+/temperature"); // matches sensors/room1/temperature, sensors/room2/temperature

// Multi-level wildcard (#)
client.subscribe("sensors/#"); // matches sensors/room1/temperature, sensors/room1/humidity, etc.

// Specific subscription
client.subscribe("sensors/room1/temperature");
```

### MQTT 5.0 Features

```typescript
// User properties
client.publish("data/metrics", payload, {
    qos: 1,
    properties: {
        userProperties: {
            "client-type": "orderflow-trading",
            version: "1.0.0",
        },
        contentType: "application/json",
        messageExpiryInterval: 300, // 5 minutes
    },
});

// Topic aliases (reduce bandwidth)
client.publish("very/long/topic/name/for/trading/signals", payload, {
    properties: {
        topicAlias: 1,
    },
});

// Request-response pattern
client.publish("request/data", requestPayload, {
    properties: {
        responseTopic: "response/data",
        correlationData: Buffer.from("request-123"),
    },
});
```

## 🎯 Usage in OrderFlow Trading

### Signal Broadcasting

```typescript
export class OrderFlowMQTTClient {
    private client: mqtt.MqttClient;
    private isConnected = false;

    constructor(private config: MQTTConfig) {
        this.client = mqtt.connect(config.url, {
            clientId: config.clientId,
            username: config.username,
            password: config.password,
            keepalive: config.keepalive || 60,
            reconnectPeriod: config.reconnectPeriod || 5000,
            clean: true,
            will: {
                topic: "orderflow/status",
                payload: JSON.stringify({
                    status: "offline",
                    timestamp: Date.now(),
                    clientId: config.clientId,
                }),
                qos: 1,
                retain: true,
            },
        });

        this.setupEventHandlers();
    }

    private setupEventHandlers(): void {
        this.client.on("connect", () => {
            this.isConnected = true;
            this.logger.info("Connected to MQTT broker");

            // Publish online status
            this.publishStatus("online");

            // Subscribe to control topics
            this.client.subscribe("orderflow/control/+", { qos: 1 });
        });

        this.client.on("message", (topic, message) => {
            this.handleMessage(topic, message);
        });

        this.client.on("error", (error) => {
            this.logger.error("MQTT error:", error);
        });

        this.client.on("close", () => {
            this.isConnected = false;
            this.logger.warn("MQTT connection closed");
        });
    }

    // Publish trading signal
    public publishSignal(signal: ProcessedSignal): void {
        if (!this.isConnected) return;

        const topic = `orderflow/signals/${signal.symbol}/${signal.detectorType}`;
        const payload = JSON.stringify({
            ...signal,
            publishedAt: Date.now(),
        });

        this.client.publish(
            topic,
            payload,
            {
                qos: 1,
                retain: false,
                properties: {
                    userProperties: {
                        "signal-id": signal.id,
                        "detector-type": signal.detectorType,
                        "confidence-level": signal.confidence.toString(),
                    },
                    contentType: "application/json",
                    messageExpiryInterval: 300, // 5 minutes
                },
            },
            (err) => {
                if (err) {
                    this.logger.error("Failed to publish signal", {
                        error: err,
                        signalId: signal.id,
                    });
                }
            }
        );
    }

    // Publish system statistics
    public publishStats(stats: SystemStats): void {
        if (!this.isConnected) return;

        this.client.publish("orderflow/stats", JSON.stringify(stats), {
            qos: 0,
            retain: true, // Keep latest stats
            properties: {
                userProperties: {
                    "stats-type": "system-metrics",
                },
            },
        });
    }

    // Publish market update
    public publishMarketUpdate(update: MarketUpdate): void {
        if (!this.isConnected) return;

        const topic = `orderflow/market/${update.symbol}`;
        this.client.publish(topic, JSON.stringify(update), {
            qos: 0, // High frequency, best effort
            properties: {
                userProperties: {
                    "update-type": update.type,
                },
            },
        });
    }

    private publishStatus(status: "online" | "offline"): void {
        this.client.publish(
            "orderflow/status",
            JSON.stringify({
                status,
                timestamp: Date.now(),
                clientId: this.config.clientId,
                version: process.env.APP_VERSION,
            }),
            {
                qos: 1,
                retain: true,
            }
        );
    }

    private handleMessage(topic: string, message: Buffer): void {
        try {
            const data = JSON.parse(message.toString());

            if (topic.startsWith("orderflow/control/")) {
                this.handleControlMessage(topic, data);
            }
        } catch (error) {
            this.logger.error("Failed to parse MQTT message", { topic, error });
        }
    }

    private handleControlMessage(topic: string, data: any): void {
        const command = topic.split("/").pop();

        switch (command) {
            case "pause":
                this.eventEmitter.emit("pause_requested");
                break;
            case "resume":
                this.eventEmitter.emit("resume_requested");
                break;
            case "restart":
                this.eventEmitter.emit("restart_requested");
                break;
            default:
                this.logger.warn(`Unknown control command: ${command}`);
        }
    }

    public disconnect(): Promise<void> {
        return new Promise((resolve) => {
            this.publishStatus("offline");
            this.client.end(false, {}, () => {
                this.logger.info("MQTT client disconnected");
                resolve();
            });
        });
    }
}
```

### External Alert Integration

```typescript
// Integration with external trading platforms
export class TradingAlertMQTT {
    private client: mqtt.MqttClient;

    constructor() {
        this.client = mqtt.connect("mqtts://secure-broker.trading.com", {
            clientId: `orderflow-alerts-${Date.now()}`,
            username: process.env.TRADING_MQTT_USER,
            password: process.env.TRADING_MQTT_PASS,
            ca: fs.readFileSync("ca-cert.pem"),
            cert: fs.readFileSync("client-cert.pem"),
            key: fs.readFileSync("client-key.pem"),
        });
    }

    public sendTradingAlert(alert: TradingAlert): void {
        const topic = `alerts/${alert.exchange}/${alert.symbol}`;

        this.client.publish(
            topic,
            JSON.stringify({
                type: alert.type,
                symbol: alert.symbol,
                side: alert.side,
                confidence: alert.confidence,
                price: alert.price,
                timestamp: alert.timestamp,
                strategy: "orderflow-analysis",
            }),
            {
                qos: 2, // Exactly once delivery for trading alerts
                properties: {
                    userProperties: {
                        "alert-priority": alert.priority,
                        "strategy-version": "2.1.0",
                    },
                },
            }
        );
    }
}
```

## ⚙️ Configuration Best Practices

### Connection Resilience

```typescript
const client = mqtt.connect("mqtt://broker.example.com", {
    keepalive: 30, // Shorter keepalive for faster detection
    reconnectPeriod: 2000, // Quick reconnection
    connectTimeout: 10000, // 10 second timeout
    clean: false, // Persist session for reliability

    // Retry configuration
    retryDelayOnFailure: 1000,
    maxReconnectTimes: 10,
});

// Handle connection issues
client.on("offline", () => {
    console.log("MQTT client went offline");
});

client.on("reconnect", () => {
    console.log("MQTT client reconnecting...");
});
```

### Performance Optimization

```typescript
const client = mqtt.connect("mqtt://high-performance-broker.com", {
    // Optimize for high throughput
    keepalive: 60,
    clean: true, // Reduce broker memory usage
    protocolVersion: 5, // Use MQTT 5.0 features

    // Increase limits
    properties: {
        receiveMaximum: 100, // More concurrent messages
        maximumPacketSize: 1048576, // 1MB max packet size
        topicAliasMaximum: 10, // Use topic aliases
    },
});
```

## 🔗 Official Resources

- **GitHub Repository**: https://github.com/mqttjs/MQTT.js
- **npm Package**: https://www.npmjs.com/package/mqtt
- **MQTT 5.0 Specification**: https://docs.oasis-open.org/mqtt/mqtt/v5.0/mqtt-v5.0.html
- **MQTT.org**: https://mqtt.org/

## 📝 Requirements

- Node.js v12.0.0 or later
- MQTT broker (HiveMQ, Eclipse Mosquitto, etc.)
- Network connectivity to broker

## ⚠️ Best Practices

1. **Use appropriate QoS levels** - QoS 0 for high-frequency data, QoS 1-2 for critical messages
2. **Implement proper error handling** for network issues
3. **Use retained messages wisely** - only for state information
4. **Keep topic names organized** with hierarchical structure
5. **Set reasonable keepalive intervals** based on network conditions
6. **Handle reconnection gracefully** with exponential backoff
7. **Use TLS/SSL** for production deployments
8. **Monitor connection health** and implement circuit breakers

---

_Version: 5.13.1_  
_Compatible with: OrderFlow Trading System_
