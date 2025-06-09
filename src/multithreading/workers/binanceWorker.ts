import { parentPort } from "worker_threads";
import { Logger } from "../../infrastructure/logger.js";
import { MetricsCollector } from "../../infrastructure/metricsCollector.js";
import { CircuitBreaker } from "../../infrastructure/circuitBreaker.js";
import { BinanceDataFeed } from "../../utils/binance.js";
import { DataStreamManager } from "../../trading/dataStreamManager.js";
import { Config } from "../../core/config.js";

const logger = new Logger();
const metricsCollector = new MetricsCollector();
const circuitBreaker = new CircuitBreaker(5, 60000, logger);
const binanceFeed = new BinanceDataFeed();
const manager = new DataStreamManager(
    Config.DATASTREAM,
    binanceFeed,
    circuitBreaker,
    logger,
    metricsCollector
);

// Store interval reference for proper cleanup
let metricsInterval: NodeJS.Timeout | null = null;

parentPort?.on("message", (msg: { type: string }) => {
    if (msg.type === "start") {
        void manager.connect();
        // Start metrics reporting when worker starts
        if (!metricsInterval) {
            metricsInterval = setInterval(() => {
                parentPort?.postMessage({
                    type: "metrics",
                    data: manager.getDetailedMetrics(),
                });
            }, 1000);
        }
    } else if (msg.type === "stop") {
        void manager.disconnect();
        // Clear metrics interval when stopped
        if (metricsInterval) {
            clearInterval(metricsInterval);
            metricsInterval = null;
        }
    } else if (msg.type === "shutdown") {
        // Clean up resources before shutdown
        if (metricsInterval) {
            clearInterval(metricsInterval);
            metricsInterval = null;
        }
        void manager.disconnect();
        process.exit(0);
    }
});
