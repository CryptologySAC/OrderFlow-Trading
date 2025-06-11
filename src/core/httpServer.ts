import express from "express";
import * as path from "node:path";
import { Config } from "./config.js";
import { ILogger } from "../infrastructure/loggerInterface";
import { randomUUID } from "crypto";
import { MetricsCollector } from "../infrastructure/metricsCollector.js";

export class HttpServer {
    private readonly port = Config.HTTP_PORT;
    private readonly httpServer = express();

    private readonly logger: ILogger;
    private readonly metricsCollector: MetricsCollector;

    constructor(logger: ILogger, metricsCollector: MetricsCollector) {
        this.logger = logger;
        this.metricsCollector = metricsCollector;
    }

    public start() {
        this.httpServer.listen(Config.HTTP_PORT, () => {
            this.logger.info(
                `HTTP server running at http://localhost:${Config.HTTP_PORT}`
            );
        });
    }

    /**
     * Setup HTTP server
     */

    private setupHttpServer(): void {
        const publicPath = path.join(__dirname, "../public");
        this.httpServer.use(express.static(publicPath));

        this.httpServer.get("/stats", (req, res) => {
            const correlationId = randomUUID();
            try {
                const stats = {
                    metrics: this.metricsCollector.getMetrics(),
                    health: this.metricsCollector.getHealthSummary(),
                    correlationId,
                };
                res.json(stats);
                this.logger.info("Stats requested", stats, correlationId);
            } catch (error) {
                this.handleError(
                    error as Error,
                    "stats_endpoint",
                    correlationId
                );
                res.status(500).json({
                    status: "error",
                    error: (error as Error).message,
                    correlationId,
                });
            }
        });
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
}
