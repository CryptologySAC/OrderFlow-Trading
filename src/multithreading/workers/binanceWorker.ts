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

parentPort?.on("message", (msg: { type: string }) => {
    if (msg.type === "start") {
        void manager.connect();
    } else if (msg.type === "stop") {
        void manager.disconnect();
    } else if (msg.type === "shutdown") {
        void manager.disconnect();
        process.exit(0);
    }
});

setInterval(() => {
    parentPort?.postMessage({
        type: "metrics",
        data: manager.getDetailedMetrics(),
    });
}, 1000);
