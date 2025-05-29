// /src/indicators/base/detector.ts
import { SpotWebsocketStreams } from "@binance/spot";
import { Logger } from "../../infrastructure/logger.js";
import { MetricsCollector } from "../../infrastructure/metricsCollector.js";
import { ISignalLogger } from "../../services/signalLogger.js";

/**
 * Abstract base for all detectors (handles logging/metrics/signalLogger).
 */
export abstract class Detector {
    protected readonly logger: Logger;
    protected readonly metricsCollector: MetricsCollector;
    protected readonly signalLogger?: ISignalLogger;

    constructor(
        logger: Logger,
        metricsCollector: MetricsCollector,
        signalLogger?: ISignalLogger
    ) {
        this.logger = logger;
        this.metricsCollector = metricsCollector;
        this.signalLogger = signalLogger;
    }

    /**
     * Handle a new trade and evaluate for confirmation.
     * Must be implemented by subclasses.
     */
    public abstract addTrade(
        trade: SpotWebsocketStreams.AggTradeResponse
    ): void;
    public abstract addDepth(
        update: SpotWebsocketStreams.DiffBookDepthResponse
    ): void;

    protected handleError(
        error: Error,
        context: string,
        correlationId?: string
    ): void {
        this.metricsCollector.incrementMetric("errorsCount");
        this.logger.error(
            `[${context}] ${error.message}`,
            {
                context,
                errorName: error.name,
                errorMessage: error.message,
                stack: error.stack,
                timestamp: new Date().toISOString(),
                correlationId,
            },
            correlationId
        );
    }
}
