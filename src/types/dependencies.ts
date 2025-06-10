// src/types/dependencies.ts

import type { IStorage } from "../storage/storage.js";
import type { IBinanceDataFeed } from "../utils/binance.js";
import type { ITradesProcessor } from "../clients/tradesProcessor.js";
import type { OrderBookProcessor } from "../clients/orderBookProcessor.js";
import type { ISignalLogger } from "../infrastructure/signalLoggerInterface.js";
import { WorkerLogger } from "../multithreading/workerLogger";
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
import type { SignalTracker } from "../analysis/signalTracker.js";
import type { MarketContextCollector } from "../analysis/marketContextCollector.js";
import type { IPipelineStorage } from "../storage/pipelineStorage.js";
import type { ThreadManager } from "../multithreading/threadManager.js";

/**
 * Application dependencies interface
 */
export interface Dependencies {
    // Storage & Data
    storage: IStorage;
    pipelineStore: IPipelineStorage;
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
