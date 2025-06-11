import { randomUUID } from "crypto";
import { ILogger } from "./infrastructure/loggerInterface";
import type { Dependencies } from "./types/dependencies.js";
import { MetricsCollector } from "./infrastructure/metricsCollector.js";
import { ThreadManager } from "./multithreading/threadManager.js";
import { ProductionUtils } from "./utils/productionUtils.js";
import { HttpServer } from "./core/httpServer.js";
//import { Config } from "./core/config.js";

export class App {
    private logger: ILogger;
    private readonly httpServer: HttpServer;
    private readonly threadManager: ThreadManager;
    private readonly metricsCollector: MetricsCollector;

    // State
    private isShuttingDown = false;
    private readonly purgeIntervalMs = 10 * 60 * 1000; // 10 minutes
    private purgeIntervalId?: NodeJS.Timeout;

    constructor(
        private readonly dependencies: Dependencies,
        private readonly delayFn: (
            cb: () => void,
            ms: number
        ) => unknown = setTimeout
    ) {
        this.logger = dependencies.logger;
        this.metricsCollector = dependencies.metricsCollector;
        this.threadManager = dependencies.threadManager;
        this.httpServer = new HttpServer(this.logger, this.metricsCollector);
    }

    /**
     * Start the dashboard
     */
    public async start(): Promise<void> {
        const correlationId = randomUUID();

        try {
            this.logger.info("Starting Order Flow App", {}, correlationId);

            await this.startStreamConnection();
            await this.preloadHistoricalData();
            this.httpServer.start();

            // Start periodic tasks
            this.startPeriodicTasks();

            this.logger.info(
                "Order Flow App started successfully",
                {},
                correlationId
            );

            this.setupGracefulShutdown();
        } catch (error) {
            this.handleError(
                new Error(
                    `Error starting Order Flow App: ${(error as Error).message}`
                ),
                "dashboard_startup",
                correlationId
            );
            throw error;
        }
    }

    /**
     * Start stream connection for live data (runs parallel with backlog fill)
     */
    private async startStreamConnection(): Promise<void> {
        const correlationId = randomUUID();

        try {
            this.logger.info(
                "Starting live stream connection in parallel with backlog fill",
                {},
                correlationId
            );

            // Start BinanceWorker for live stream data
            this.threadManager.startBinance();

            // Wait a moment for the connection to establish
            await ProductionUtils.sleep(1000);

            this.logger.info(
                "Live stream connection initiated successfully",
                {},
                correlationId
            );
        } catch (error) {
            this.handleError(
                error as Error,
                "stream_connection",
                correlationId
            );
            throw error;
        }
    }

    /**
     * Preload historical data
     */
    private async preloadHistoricalData(): Promise<void> {
        const correlationId = randomUUID();

        try {
            await this.dependencies.circuitBreaker.execute(
                () => this.dependencies.tradesProcessor.fillBacklog(),
                correlationId
            );

            this.logger.info(
                "Historical data preloaded successfully",
                {},
                correlationId
            );
        } catch (error) {
            this.handleError(error as Error, "preload_data", correlationId);
            throw error;
        }

        process.exit(1);
    }

    /**
     * Start periodic tasks
     */
    private startPeriodicTasks(): void {
        // Update circuit breaker metrics
        // StatsBroadcaster started by communication worker
        setInterval(() => {
            const state = this.dependencies.circuitBreaker.getState();
            this.metricsCollector.updateMetric("circuitBreakerState", state);
        }, 30000);

        // Send main thread metrics to communication worker
        setInterval(() => {
            try {
                const mainMetrics = this.metricsCollector.getMetrics();
                this.threadManager.updateMainThreadMetrics(mainMetrics);
            } catch (error) {
                this.logger.error("Error sending main thread metrics", {
                    error:
                        error instanceof Error ? error.message : String(error),
                });
            }
        }, 5000); // Send every 5 seconds

        // Database purge
        this.purgeIntervalId = setInterval(() => {
            if (this.isShuttingDown) return;

            const correlationId = randomUUID();
            this.logger.info("Starting scheduled purge", {}, correlationId);

            try {
                this.dependencies.storage.purgeOldEntries();
                this.logger.info(
                    "Scheduled purge completed successfully",
                    {},
                    correlationId
                );
            } catch (error) {
                this.handleError(
                    error as Error,
                    "database_purge",
                    correlationId
                );
            }
        }, this.purgeIntervalMs);
    }

    /**
     * Handle errors
     */
    private handleError(
        error: Error,
        context: string,
        correlationId?: string
    ): void {
        this.metricsCollector.incrementMetric("errorsCount");

        const errorContext = {
            context,
            errorName: error.name,
            errorMessage: error.message,
            stack: error.stack,
            timestamp: new Date().toISOString(),
            correlationId: correlationId || randomUUID(),
        };

        errorContext.correlationId =
            "correlationId" in error && error.correlationId
                ? (error.correlationId as string)
                : randomUUID();

        this.logger.error(
            `[${context}] ${error.message}`,
            errorContext,
            correlationId
        );
    }

    /**
     * Setup graceful shutdown
     */
    private setupGracefulShutdown(): void {
        const shutdown = (signal: string): void => {
            this.logger.info(`Received ${signal}, starting graceful shutdown`);
            this.isShuttingDown = true;

            // Clear intervals
            if (this.purgeIntervalId) {
                clearInterval(this.purgeIntervalId);
            }

            // Shutdown components
            // WebSocketManager shutdown handled by communication worker
            // DataStreamManager disconnect handled by BinanceWorker

            // Give time for cleanup
            // StatsBroadcaster stopped by communication worker
            setTimeout(() => {
                this.logger.info("Graceful shutdown completed");
                process.exit(0);
            }, 5000);
        };

        process.on("SIGTERM", () => void shutdown("SIGTERM"));
        process.on("SIGINT", () => void shutdown("SIGINT"));
    }
}
