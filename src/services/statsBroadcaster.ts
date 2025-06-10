import { WorkerLogger } from "../multithreading/workerLogger";
import { MetricsCollector } from "../infrastructure/metricsCollector.js";
import { DataStreamManager } from "../trading/dataStreamManager.js";
import { WebSocketManager } from "../websocket/websocketManager.js";
import { Config } from "../core/config.js";
import mqtt, { MqttClient, ErrorWithReasonCode } from "mqtt";
import type { SignalTracker } from "../analysis/signalTracker.js";

/**
 * Periodically collect metrics and broadcast via WebSocket.
 */
export class StatsBroadcaster {
    private timer?: NodeJS.Timeout;
    private mqttClient?: MqttClient;

    constructor(
        private readonly metrics: MetricsCollector,
        private readonly dataStream: DataStreamManager,
        private readonly wsManager: WebSocketManager,
        private readonly logger: WorkerLogger,
        private readonly signalTracker?: SignalTracker,
        private readonly intervalMs = 5000
    ) {}

    public start(): void {
        this.stop();

        if (Config.MQTT?.url) {
            const mqttOptions: mqtt.IClientOptions = {
                keepalive: Config.MQTT.keepalive ?? 60,
                connectTimeout: Config.MQTT.connectTimeout ?? 4000,
                reconnectPeriod: Config.MQTT.reconnectPeriod ?? 1000,
                clientId:
                    Config.MQTT.clientId ?? `orderflow-dashboard-${Date.now()}`,
                // Additional options for better compatibility
                rejectUnauthorized: false, // For self-signed certificates
                protocolVersion: 4, // Use MQTT 3.1.1
                clean: true, // Start with clean session
            };

            // Add authentication if provided
            if (Config.MQTT.username) {
                mqttOptions.username = Config.MQTT.username;
            }
            if (Config.MQTT.password) {
                mqttOptions.password = Config.MQTT.password;
            }

            this.logger.info("Connecting to MQTT broker", {
                url: Config.MQTT.url,
                clientId: mqttOptions.clientId,
                hasAuth: !!(Config.MQTT.username && Config.MQTT.password),
            });

            this.mqttClient = mqtt.connect(Config.MQTT.url, mqttOptions);

            this.mqttClient.on("connect", () => {
                this.logger.info("MQTT connected successfully", {
                    clientId: mqttOptions.clientId,
                });
            });

            this.mqttClient.on("error", (err: ErrorWithReasonCode | Error) => {
                this.logger.error("MQTT connection error", {
                    error: err.message,
                    code: "code" in err ? err.code : undefined,
                    url: Config.MQTT?.url ?? undefined,
                });

                // If SSL error, suggest trying different protocols
                if (
                    err.message.includes("SSL") ||
                    err.message.includes("EPROTO")
                ) {
                    this.logger.warn(
                        "SSL/TLS error detected. Try these alternatives:",
                        {
                            suggestions: [
                                "Use 'ws://' instead of 'wss://' for plain WebSocket",
                                "Use 'mqtt://' for standard MQTT (port 1883)",
                                "Use 'mqtts://' for MQTT over TLS (port 8883)",
                                "Check if broker supports WebSocket on this port",
                            ],
                        }
                    );
                }
            });

            this.mqttClient.on("close", () => {
                this.logger.warn("MQTT connection closed");
            });

            this.mqttClient.on("reconnect", () => {
                this.logger.info("MQTT reconnecting...");
            });
        }

        this.timer = setInterval(() => {
            try {
                const stats = {
                    metrics: this.metrics.getMetrics(),
                    health: this.metrics.getHealthSummary(),
                    timestamp: Date.now(),
                    dataStream: this.dataStream.getDetailedMetrics(),
                    signalTracking: {} as Record<string, unknown>,
                };

                // Broadcast to WebSocket clients
                this.wsManager.broadcast({
                    type: "stats",
                    data: stats,
                    now: stats.timestamp,
                });

                // Publish to MQTT if configured and connected (temporarily disabled for type safety)
                // if (this.mqttClient?.connected && Config.MQTT?.topic) {
                //     const topic = Config.MQTT.topic as string;
                //     this.mqttClient.publish(topic, JSON.stringify(stats), {
                //         qos: 0,
                //     });
                // }
            } catch (error: unknown) {
                const errorMessage =
                    error instanceof Error ? error.message : String(error);
                this.logger.error("Error collecting and broadcasting stats", {
                    error: errorMessage,
                });
            }
        }, this.intervalMs);
    }

    public stop(): void {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = undefined;
        }

        if (this.mqttClient) {
            this.mqttClient.end(true);
            this.mqttClient = undefined;
        }
    }
}
