import { parentPort } from "worker_threads";
import { Logger } from "../../infrastructure/logger.js";
import { MetricsCollector } from "../../infrastructure/metricsCollector.js";
import { RateLimiter } from "../../infrastructure/rateLimiter.js";
import { WebSocketManager } from "../../websocket/websocketManager.js";
import { StatsBroadcaster } from "../../services/statsBroadcaster.js";
import { Config } from "../../core/config.js";
import type { WebSocketMessage } from "../../utils/interfaces.js";
import type { DataStreamManager } from "../../trading/dataStreamManager.js";

class DataStreamProxy {
    private metrics: unknown = {};
    public setMetrics(m: unknown): void {
        this.metrics = m;
    }
    public getDetailedMetrics(): unknown {
        return this.metrics;
    }
}

const logger = new Logger();
const metrics = new MetricsCollector();
const rateLimiter = new RateLimiter(60000, 100);
const dataStream = new DataStreamProxy();
const wsManager = new WebSocketManager(
    Config.WS_PORT,
    logger,
    rateLimiter,
    metrics,
    {}
);
const statsBroadcaster = new StatsBroadcaster(
    metrics,
    dataStream as unknown as DataStreamManager,
    wsManager,
    logger
);

statsBroadcaster.start();

interface MetricsMessage {
    type: "metrics";
    data: unknown;
}
interface BroadcastMessage {
    type: "broadcast";
    data: WebSocketMessage;
}

parentPort?.on(
    "message",
    (msg: MetricsMessage | BroadcastMessage | { type: "shutdown" }) => {
        if (msg.type === "metrics") {
            dataStream.setMetrics(msg.data);
        } else if (msg.type === "broadcast") {
            wsManager.broadcast(msg.data);
        } else if (msg.type === "shutdown") {
            statsBroadcaster.stop();
            wsManager.shutdown();
            process.exit(0);
        }
    }
);
