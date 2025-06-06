import { Logger } from "../infrastructure/logger.js";
import { MetricsCollector } from "../infrastructure/metricsCollector.js";
import { DataStreamManager } from "../trading/dataStreamManager.js";
import { WebSocketManager } from "../websocket/websocketManager.js";
import { Config } from "../core/config.js";
import mqtt, { MqttClient } from "mqtt";

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
        private readonly logger: Logger,
        private readonly intervalMs = 5000
    ) {}

    public start(): void {
        this.stop();
        if (Config.MQTT?.url) {
            this.mqttClient = mqtt.connect(Config.MQTT.url);
            this.mqttClient.on("error", (err) => {
                this.logger.error("MQTT error", { error: err as Error });
            });
        }
        this.timer = setInterval(() => {
            try {
                const stats = {
                    metrics: this.metrics.getMetrics(),
                    health: this.metrics.getHealthSummary(),
                    dataStream: this.dataStream.getDetailedMetrics(),
                };
                this.wsManager.broadcast({
                    type: "stats",
                    data: stats,
                    now: Date.now(),
                });
                if (this.mqttClient && this.mqttClient.connected) {
                    this.mqttClient.publish(
                        Config.MQTT?.statsTopic ?? "orderflow/stats",
                        JSON.stringify(stats)
                    );
                }
            } catch (err) {
                this.logger.error("Stats broadcast error", {
                    error: err as Error,
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
