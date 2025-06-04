import { Logger } from "../infrastructure/logger.js";
import { MetricsCollector } from "../infrastructure/metricsCollector.js";
import { DataStreamManager } from "../trading/dataStreamManager.js";
import { WebSocketManager } from "../websocket/websocketManager.js";

/**
 * Periodically collect metrics and broadcast via WebSocket.
 */
export class StatsBroadcaster {
    private timer?: NodeJS.Timeout;

    constructor(
        private readonly metrics: MetricsCollector,
        private readonly dataStream: DataStreamManager,
        private readonly wsManager: WebSocketManager,
        private readonly logger: Logger,
        private readonly intervalMs = 5000
    ) {}

    public start(): void {
        this.stop();
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
            } catch (err) {
                this.logger.error("Stats broadcast error", { error: err as Error });
            }
        }, this.intervalMs);
    }

    public stop(): void {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = undefined;
        }
    }
}
