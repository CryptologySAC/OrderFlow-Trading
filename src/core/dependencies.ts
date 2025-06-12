// src/types/dependencies.ts

import type { IBinanceDataFeed } from "../utils/binance.js";
import type { ITradesProcessor } from "../clients/tradesProcessor.js";
import { OrderBookProcessor } from "../clients/orderBookProcessor.js";
import type { ISignalLogger } from "../infrastructure/signalLoggerInterface.js";
import { WorkerLogger } from "../multithreading/workerLogger.js";
import { MetricsCollector } from "../infrastructure/metricsCollector.js";
import { RateLimiter } from "../infrastructure/rateLimiter.js";
import { CircuitBreaker } from "../infrastructure/circuitBreaker.js";
import { AlertManager } from "../alerts/alertManager.js";
import { SignalCoordinator } from "../services/signalCoordinator.js";
import { AnomalyDetector } from "../services/anomalyDetector.js";
import { SignalManager } from "../trading/signalManager.js";
import { SpoofingDetector } from "../services/spoofingDetector.js";
import { IndividualTradesManager } from "../data/individualTradesManager.js";
import { MicrostructureAnalyzer } from "../data/microstructureAnalyzer.js";
import { SignalTracker } from "../analysis/signalTracker.js";
import { MarketContextCollector } from "../analysis/marketContextCollector.js";
import type { ThreadManager } from "../multithreading/threadManager.js";
import { WorkerSignalLogger } from "../multithreading/workerSignalLogger.js";
import { getDB } from "../infrastructure/db.js";
import { runMigrations } from "../infrastructure/migrate.js";
import { BinanceDataFeed } from "../utils/binance.js";
import { TradesProcessor } from "../clients/tradesProcessor.js";
import { Config } from "./config.js";

/**
 * Application dependencies interface
 */
export interface Dependencies {
    // Data
    binanceFeed: IBinanceDataFeed;
    mainThreadBinanceFeed: IBinanceDataFeed;
    tradesProcessor: ITradesProcessor;
    orderBookProcessor: OrderBookProcessor;
    signalLogger: ISignalLogger;

    // Infrastructure
    logger: WorkerLogger;
    metricsCollector: MetricsCollector;
    rateLimiter: RateLimiter;
    circuitBreaker: CircuitBreaker;

    // Services
    alertManager: AlertManager;
    signalCoordinator: SignalCoordinator;
    anomalyDetector: AnomalyDetector;
    signalManager: SignalManager;
    spoofingDetector: SpoofingDetector;
    individualTradesManager?: IndividualTradesManager;
    microstructureAnalyzer?: MicrostructureAnalyzer;

    // Performance Analysis (optional)
    signalTracker?: SignalTracker;
    marketContextCollector?: MarketContextCollector;

    /** Thread manager for worker offloading */
    threadManager: ThreadManager;
}

/**
 * Factory function to create dependencies
 */

export function createDependencies(threadManager: ThreadManager): Dependencies {
    const logger = new WorkerLogger(
        threadManager,
        process.env.NODE_ENV === "development"
    );
    const metricsCollector = new MetricsCollector();
    const signalLogger = new WorkerSignalLogger(threadManager);
    const rateLimiter = new RateLimiter(60000, 100);
    const circuitBreaker = new CircuitBreaker(5, 60000, logger);
    const db = getDB("./storage/trades.db");
    runMigrations(db);
    const spoofingDetector = new SpoofingDetector(Config.SPOOFING_DETECTOR);
    const binanceFeed = new BinanceDataFeed();
    const individualTradesManager = new IndividualTradesManager(
        Config.INDIVIDUAL_TRADES_MANAGER,
        logger,
        metricsCollector,
        binanceFeed
    );
    const microstructureAnalyzer = new MicrostructureAnalyzer(
        Config.MICROSTRUCTURE_ANALYZER,
        logger,
        metricsCollector
    );

    const orderBookProcessor = new OrderBookProcessor(
        Config.ORDERBOOK_PROCESSOR,
        logger,
        metricsCollector
    );

    // Create separate BinanceDataFeed for main thread historical data loading
    const mainThreadBinanceFeed = new BinanceDataFeed();

    const tradesProcessor = new TradesProcessor(
        Config.TRADES_PROCESSOR,
        logger,
        metricsCollector,
        mainThreadBinanceFeed,
        threadManager
    );

    const anomalyDetector = new AnomalyDetector(
        Config.ANOMALY_DETECTOR,
        logger
    );

    const alertManager = new AlertManager(
        process.env.ALERT_WEBHOOK_URL,
        parseInt(process.env.ALERT_COOLDOWN_MS || "300000", 10)
    );

    // Create SignalTracker and MarketContextCollector for performance analysis
    const signalTracker = new SignalTracker(logger, metricsCollector);

    const marketContextCollector = new MarketContextCollector(
        logger,
        metricsCollector
    );

    const signalManager = new SignalManager(
        anomalyDetector,
        alertManager,
        logger,
        metricsCollector,
        threadManager,
        signalTracker,
        marketContextCollector,
        Config.SIGNAL_MANAGER
    );

    const signalCoordinator = new SignalCoordinator(
        Config.SIGNAL_COORDINATOR,
        logger,
        metricsCollector,
        signalLogger,
        signalManager,
        threadManager
    );

    return {
        tradesProcessor,
        orderBookProcessor,
        signalLogger,
        logger,
        metricsCollector,
        rateLimiter,
        circuitBreaker,
        alertManager,
        signalCoordinator,
        anomalyDetector,
        signalManager,
        spoofingDetector,
        individualTradesManager,
        microstructureAnalyzer,
        binanceFeed,
        mainThreadBinanceFeed,
        signalTracker,
        marketContextCollector,
        threadManager,
    };
}
