// /src/indicators/base/detectorEnrichedTrade.ts
import { EventEmitter } from "events";
import type { ILogger } from "../../infrastructure/loggerInterface.js";
import type { IMetricsCollector } from "../../infrastructure/metricsCollectorInterface.js";
import { ISignalLogger } from "../../infrastructure/signalLoggerInterface.js";
import type { EnrichedTradeEvent } from "../../types/marketEvents.js";
import type { SignalCandidate } from "../../types/signalTypes.js";

/**
 * Abstract base for all detectors (handles logging/metrics/signalLogger).
 */
export abstract class Detector extends EventEmitter {
    public readonly logger: ILogger;
    protected readonly metricsCollector: IMetricsCollector;
    protected readonly signalLogger?: ISignalLogger;
    protected readonly id: string;

    constructor(
        id: string,
        logger: ILogger,
        metricsCollector: IMetricsCollector,
        signalLogger?: ISignalLogger
    ) {
        super();
        this.id = id;
        this.logger = logger;
        this.metricsCollector = metricsCollector;
        this.signalLogger = signalLogger;
    }

    /**
     * Handle a new trade and evaluate for confirmation.
     * Must be implemented by subclasses.
     */
    public abstract onEnrichedTrade(event: EnrichedTradeEvent): void;

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

    /**
     * Get detector ID
     */
    public getId(): string {
        return this.id || `${this.constructor.name}_${Date.now()}`;
    }

    /**
     * Emit signal candidate (call this when a signal is detected)
     */
    protected emitSignalCandidate(candidate: SignalCandidate): void {
        this.emit("signalCandidate", candidate);
    }

    /**
     * Emit error
     */
    protected emitError(error: Error): void {
        this.emit("error", error);
    }

    /**
     * Emit status change
     */
    protected emitStatusChange(status: string): void {
        this.emit("statusChange", status);
    }
}
