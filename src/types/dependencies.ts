// src/types/dependencies.ts

import type { IStorage } from "../infrastructure/storage.js";
import type { IBinanceDataFeed } from "../utils/binance.js";
import type { ITradesProcessor } from "../tradesProcessor.js";
import type { IOrderBookProcessor } from "../orderBookProcessor.js";
import type { ISignalLogger } from "../services/signalLogger.js";
import { Logger } from "../infrastructure/logger.js";
import { MetricsCollector } from "../infrastructure/metricsCollector.js";
import { RateLimiter } from "../infrastructure/rateLimiter.js";
import { CircuitBreaker } from "../infrastructure/circuitBreaker.js";
import { AlertManager } from "../alerts/alertManager.js";
import { SignalCoordinator } from "../services/signalCoordinator.js";
import { AnomalyDetector } from "../services/anomalyDetector.js";

/**
 * Application dependencies interface
 */
export interface Dependencies {
    // Storage & Data
    storage: IStorage;
    binanceFeed: IBinanceDataFeed;
    tradesProcessor: ITradesProcessor;
    orderBookProcessor: IOrderBookProcessor;
    signalLogger: ISignalLogger;

    // Infrastructure
    logger: Logger;
    metricsCollector: MetricsCollector;
    rateLimiter: RateLimiter;
    circuitBreaker: CircuitBreaker;

    // Services
    alertManager: AlertManager;
    signalCoordinator: SignalCoordinator;
    anomalyDetector: AnomalyDetector;
}
