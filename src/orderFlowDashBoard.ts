// src/orderFlowDashboard.ts

import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

import express from "express";
import * as path from "node:path";
import { EventEmitter } from "events";
import { randomUUID } from "crypto";
import { SpotWebsocketStreams } from "@binance/spot";

// Core imports
import { Config } from "./core/config.js";
import { SignalProcessingError, WebSocketError } from "./core/errors.js";

// Infrastructure imports
import { Logger } from "./infrastructure/logger.js";
import { MetricsCollector } from "./infrastructure/metricsCollector.js";
import { RateLimiter } from "./infrastructure/rateLimiter.js";
import { CircuitBreaker } from "./infrastructure/circuitBreaker.js";

// Service imports
import { DetectorFactory } from "./utils/detectorFactory.js";
import type {
    EnrichedTradeEvent,
    OrderBookSnapshot,
} from "./types/marketEvents.js";
import { OrderflowPreprocessor } from "./market/orderFlowPreprocessor.js";
import {
    OrderBookState,
    OrderBookStateOptions,
} from "./market/orderBookState.js";
import {
    WebSocketManager,
    type ExtendedWebSocket,
} from "./websocket/websocketManager.js";
import { SignalManager } from "./trading/signalManager.js";
import { DataStreamManager } from "./trading/dataStreamManager.js";
import { SignalCoordinator } from "./services/signalCoordinator.js";
import {
    AnomalyDetector,
    AnomalyEvent,
    AnomalyDetectorOptions,
} from "./services/anomalyDetector.js";
import { AlertManager } from "./alerts/alertManager.js";

// Indicator imports
import { AccumulationSettings } from "./indicators/interfaces/detectorInterfaces.js";
import {
    AbsorptionDetector,
    type AbsorptionSettings,
} from "./indicators/absorptionDetector.js";
import {
    ExhaustionDetector,
    type ExhaustionSettings,
} from "./indicators/exhaustionDetector.js";
import { SwingMetrics } from "./indicators/swingMetrics.js";
import { AccumulationDetector } from "./indicators/accumulationDetector.js";
import { MomentumDivergence } from "./indicators/momentumDivergence.js";
import {
    DeltaCVDConfirmation,
    DeltaCVDConfirmationSettings,
} from "./indicators/deltaCVDConfirmation.js";
import {
    SwingPredictor,
    SwingPredictorConfig,
    type SwingPrediction,
} from "./indicators/swingPredictor.js";

// Utils imports
import { parseBool, TradeData } from "./utils/utils.js";
import {
    calculateProfitTarget,
    calculateStopLoss,
} from "./utils/calculations.js";

// Types
import type { Dependencies } from "./types/dependencies.js";
import type { VolumeNodes } from "./indicators/swingMetrics.js";
import type {
    Signal,
    AccumulationResult,
    DivergenceResult,
    SwingSignalData,
    DeltaCVDConfirmationEvent,
} from "./types/signalTypes.js";
import type {
    TimeContext,
    DetectorRegisteredEvent,
    SignalQueuedEvent,
    SignalProcessedEvent,
    SignalFailedEvent,
    DetectorErrorEvent,
} from "./utils/types.js";

// Storage and processors
import { Storage } from "./infrastructure/storage.js";
import { BinanceDataFeed } from "./utils/binance.js";
import { TradesProcessor } from "./clients/tradesProcessor.js";
import {
    OrderBookProcessor,
    OrderBookProcessorOptions,
} from "./clients/orderBookProcessor.js";
import { SignalLogger } from "./services/signalLogger.js";
import type { WebSocketMessage } from "./utils/interfaces.js";

EventEmitter.defaultMaxListeners = 20;

/**
 * Main Order Flow Dashboard Controller
 * Coordinates all subsystems and manages application lifecycle
 */
export class OrderFlowDashboard {
    // Infrastructure components
    private readonly httpServer = express();
    private readonly logger: Logger;
    private readonly metricsCollector: MetricsCollector;

    // Managers
    private readonly wsManager: WebSocketManager;
    private readonly signalManager: SignalManager;
    private readonly dataStreamManager: DataStreamManager;

    // Market
    private orderBook: OrderBookState | null = null;
    private preprocessor: OrderflowPreprocessor | null = null;

    // Coordinators
    private readonly signalCoordinator: SignalCoordinator;
    private readonly anomalyDetector: AnomalyDetector;

    // Detectors
    private readonly absorptionDetector: AbsorptionDetector;
    private readonly exhaustionDetector: ExhaustionDetector;
    private readonly deltaCVDConfirmation: DeltaCVDConfirmation;
    private readonly swingPredictor: SwingPredictor;

    // Indicators
    private readonly swingMetrics = new SwingMetrics();
    private readonly accumulationDetector: AccumulationDetector;
    private readonly momentumDivergence = new MomentumDivergence();

    // Time context
    private timeContext: TimeContext = {
        wallTime: Date.now(),
        marketTime: Date.now(),
        mode: "realtime",
        speed: 1,
    };

    // State
    private isShuttingDown = false;
    private readonly purgeIntervalMs = 10 * 60 * 1000; // 10 minutes
    private purgeIntervalId?: NodeJS.Timeout;

    public static async create(
        dependencies: Dependencies,
        delayFn: (cb: () => void, ms: number) => unknown = setTimeout
    ): Promise<OrderFlowDashboard> {
        const instance = new OrderFlowDashboard(dependencies, delayFn);
        await instance.initialize(dependencies);
        return instance;
    }

    private async initialize(dependencies: Dependencies): Promise<void> {
        // TODO Initialize Market with real options
        const options: OrderBookStateOptions = {
            symbol: Config.SYMBOL,
            pricePrecision: Config.PRICE_PRECISION,
            maxLevels: 5000,
            maxPriceDistance: 10000,
            pruneIntervalMs: 30000,
            maxErrorRate: 20,
            staleThresholdMs: 900_000, // 15 minutes
        };
        this.orderBook = await OrderBookState.create(
            options,
            dependencies.logger,
            dependencies.metricsCollector
        );
        this.preprocessor = new OrderflowPreprocessor(
            {
                //TODO Config
                pricePrecision: Config.PRICE_PRECISION,
                bandTicks: 10,
                tickSize: Config.TICK_SIZE,
            },
            this.orderBook,
            dependencies.logger,
            dependencies.metricsCollector
        );
        this.logger.info(
            "[OrderFlowDashboard] Orderflow preprocessor initialized"
        );
        this.setupEventHandlers();
        this.setupHttpServer();
        this.setupGracefulShutdown();
    }

    constructor(
        private readonly dependencies: Dependencies,
        private readonly delayFn: (
            cb: () => void,
            ms: number
        ) => unknown = setTimeout
    ) {
        // Validate configuration
        Config.validate();

        // Initialize infrastructure
        this.logger = dependencies.logger;
        this.metricsCollector = dependencies.metricsCollector;

        // Initialize coordinators
        this.signalCoordinator = dependencies.signalCoordinator;
        this.anomalyDetector = dependencies.anomalyDetector;

        // Initialize managers
        this.wsManager = new WebSocketManager(
            Config.WS_PORT,
            this.logger,
            dependencies.rateLimiter,
            this.metricsCollector,
            this.createWSHandlers()
        );

        this.signalManager = dependencies.signalManager;

        this.dataStreamManager = new DataStreamManager(
            { symbol: Config.SYMBOL },
            dependencies.binanceFeed,
            dependencies.circuitBreaker,
            this.logger,
            this.metricsCollector
        );

        DetectorFactory.initialize(dependencies);

        this.absorptionDetector = DetectorFactory.createAbsorptionDetector(
            (signal) => {
                console.log("Absorption signal:", signal);
            },
            this.createAbsorptionSettings(),
            dependencies,
            { id: "ltcusdt-absorption-main" }
        );
        this.signalCoordinator.registerDetector(
            this.absorptionDetector,
            ["absorption"],
            100,
            true
        );

        this.exhaustionDetector = DetectorFactory.createExhaustionDetector(
            (signal) => {
                console.log("Exhaustion signal:", signal);
            },
            this.createExhaustionSettings(),
            dependencies,
            { id: "ltcusdt-exhaustion-main" }
        );
        this.signalCoordinator.registerDetector(
            this.exhaustionDetector,
            ["exhaustion"],
            90,
            true
        );

        this.accumulationDetector = DetectorFactory.createAccumulationDetector(
            (signal) => {
                console.log("Accumulation signal:", signal);
            },
            this.createAccumulationDetectorSettings(),
            dependencies,
            { id: "ltcusdt-accumulation-main" }
        );
        this.signalCoordinator.registerDetector(
            this.accumulationDetector,
            ["accumulation"],
            50,
            true
        );

        // Initialize other components
        this.deltaCVDConfirmation = new DeltaCVDConfirmation(
            this.DeltaCVDConfirmationCallback,
            this.createDeltaCVDSettings(),
            this.logger,
            this.metricsCollector,
            dependencies.signalLogger
        );

        this.swingPredictor = new SwingPredictor(
            this.createSwingPredictorSettings()
        );

        this.signalCoordinator.start();
        this.logger.info("SignalCoordinator started");
        this.logger.info("Status:", this.signalCoordinator.getStatus());
        const signalCoordinatorInfo = this.signalCoordinator.getDetectorInfo();
        this.logger.info("Detectors:", { signalCoordinatorInfo });

        setInterval(() => {
            const stats = DetectorFactory.getFactoryStats();
            this.logger.info("Factory stats:", { stats });
            const signalCoordinatorInfo =
                this.signalCoordinator.getDetectorInfo();
            this.logger.info("Detectors:", { signalCoordinatorInfo });
        }, 60000);

        // Cleanup on exit
        process.on("SIGINT", () => {
            DetectorFactory.destroyAll();
            void this.signalCoordinator.stop();
            process.exit(0);
        });
    }

    private DeltaCVDConfirmationCallback = (event: unknown): void => {
        if (!this.isDeltaCVDConfirmationEvent(event)) {
            this.handleError(
                new SignalProcessingError(
                    "Invalid Delta CVD confirmation event",
                    { event }
                ),
                "delta_cvd_confirmation",
                randomUUID()
            );
            return;
        }

        // TypeScript now knows event is DeltaCVDConfirmationEvent
        const correlationId = randomUUID();
        try {
            const signal: Signal = {
                id: correlationId,
                type: "cvd_confirmation",
                time: event.time, // No error - TypeScript knows the type
                price: event.price, // No error
                side: event.side, // No error
                closeReason: "delta_divergence",
                signalData: event,
            };

            this.swingPredictor.onSignal(signal);
        } catch (error) {
            this.handleError(
                error instanceof Error ? error : new Error("Unknown error"),
                "delta_cvd_confirmation",
                correlationId
            );
        }
    };

    /**
     * Create WebSocket handlers
     */
    private createWSHandlers(): Record<
        string,
        (ws: ExtendedWebSocket, data: unknown, correlationId?: string) => void
    > {
        return {
            ping: (ws, _, correlationId) => {
                ws.send(
                    JSON.stringify({
                        type: "pong",
                        now: Date.now(),
                        correlationId,
                    })
                );
            },
            backlog: (ws, data, correlationId) => {
                this.handleBacklogRequest(ws, data, correlationId);
            },
        };
    }

    private isDeltaCVDConfirmationEvent(
        value: unknown
    ): value is DeltaCVDConfirmationEvent {
        if (typeof value !== "object" || value === null) {
            return false;
        }

        const obj = value as Record<string, unknown>;

        return (
            typeof obj.time === "number" &&
            typeof obj.price === "number" &&
            typeof obj.side === "string" &&
            (obj.side === "buy" || obj.side === "sell")
        );
    }

    /**
     * Handle backlog request
     */
    private handleBacklogRequest(
        ws: ExtendedWebSocket,
        data: unknown,
        correlationId?: string
    ): void {
        const startTime = Date.now();
        try {
            let amount = 1000;
            if (data && typeof data === "object" && "amount" in data) {
                const rawAmount = (data as { amount?: string | number }).amount;
                amount = parseInt(rawAmount as string, 10);
                if (
                    !Number.isInteger(amount) ||
                    amount <= 0 ||
                    amount > 100000
                ) {
                    throw new WebSocketError(
                        "Invalid backlog amount",
                        ws.clientId || "unknown",
                        correlationId
                    );
                }
            }

            let backlog =
                this.dependencies.tradesProcessor.requestBacklog(amount);
            backlog = backlog.reverse();

            ws.send(
                JSON.stringify({
                    type: "backlog",
                    data: backlog,
                    now: Date.now(),
                    correlationId,
                })
            );

            const processingTime = Date.now() - startTime;
            this.metricsCollector.updateMetric(
                "processingLatency",
                processingTime
            );
        } catch (error) {
            this.metricsCollector.incrementMetric("errorsCount");
            this.handleError(error as Error, "backlog_handler", correlationId);
            ws.send(
                JSON.stringify({
                    type: "error",
                    message: (error as Error).message,
                    correlationId,
                })
            );
        }
    }

    // TODO Make this real
    private createAnomalyDetectorSettings(): AnomalyDetectorOptions {
        return {
            windowSize: 1200,
            minHistory: 200,
            anomalyCooldownMs: 20000, // 20 seconds
            volumeImbalanceThreshold: 0.85,
            absorptionRatioThreshold: 4.2,
            icebergDetectionWindow: 120000,
            orderSizeAnomalyThreshold: 4.5,
            normalSpreadBps: 12,
            tickSize: 0.01,
        };
    }

    private createAccumulationDetectorSettings(): AccumulationSettings {
        return {
            symbol: Config.SYMBOL,
            windowMs: Config.ACCUMULATION_DETECTOR.WINDOW_MS,
            minDurationMs: Config.ACCUMULATION_DETECTOR.MIN_DURATION_MS,
            minRatio: Config.ACCUMULATION_DETECTOR.MIN_RATIO,
            minRecentActivityMs:
                Config.ACCUMULATION_DETECTOR.MIN_RECENT_ACTIVITY_MS,
            minAggVolume: Config.ACCUMULATION_DETECTOR.MIN_AGG_VOLUME,
            pricePrecision: Config.ACCUMULATION_DETECTOR.PRICE_PRECISION,
        };
    }

    private createDeltaCVDSettings(): DeltaCVDConfirmationSettings {
        return {
            windowSec: Config.DELTA_CVD_CONFIRMATION.WINDOW_SEC,
            minWindowTrades: Config.DELTA_CVD_CONFIRMATION.MIN_WINDOW_TRADES,
            minWindowVolume: Config.DELTA_CVD_CONFIRMATION.MIN_WINDOW_VOLUME,
            minRateOfChange: Config.DELTA_CVD_CONFIRMATION.MIN_RATE_OF_CHANGE, // Use adaptive if 0
            pricePrecision: Config.DELTA_CVD_CONFIRMATION.PRICE_PRECISION,
            dynamicThresholds: Config.DELTA_CVD_CONFIRMATION.DYNAMIC_THRESHOLDS,
            logDebug: Config.DELTA_CVD_CONFIRMATION.LOG_DEBUG,
        };
    }

    private createSwingPredictorSettings(): SwingPredictorConfig {
        return {
            lookaheadMs: Config.SWING_PREDICTOR.LOOKAHEAD_MS,
            retraceTicks: Config.SWING_PREDICTOR.RETRACE_TICKS,
            pricePrecision: Config.SWING_PREDICTOR.PRICE_PRECISION,
            signalCooldownMs: Config.SWING_PREDICTOR.SIGNAL_COOLDOWN_MS,
            onSwingPredicted: this.handleSwingPrediction.bind(this),
        };
    }

    /**
     * Create absorption detector settings
     */
    private createAbsorptionSettings(): AbsorptionSettings {
        console.log("Spoofing Settings:", Config.SPOOFING);
        console.log(
            "Creating absorption settings with config:",
            Config.ABSORPTION
        );
        return {
            minAggVolume: Config.ABSORPTION.MIN_AGG_VOLUME,
            absorptionThreshold: Config.ABSORPTION.THRESHOLD,
            windowMs: Config.ABSORPTION.WINDOW_MS,
            zoneTicks: Config.ABSORPTION.ZONE_TICKS,
            eventCooldownMs: Config.ABSORPTION.EVENT_COOLDOWN_MS,
            minPassiveMultiplier: Config.ABSORPTION.MIN_PASSIVE_MULTIPLIER,
            maxAbsorptionRatio: Config.ABSORPTION.MAX_ABSORPTION_RATIO,
            pricePrecision: Config.ABSORPTION.PRICE_PRECISION,
            minInitialMoveTicks: Config.ABSORPTION.MOVE_TICKS,
            confirmationTimeoutMs: Config.ABSORPTION.CONFIRMATION_TIMEOUT,
            maxRevisitTicks: Config.ABSORPTION.MAX_REVISIT_TICKS,
            symbol: Config.SYMBOL,
            spoofing: {
                tickSize: Config.SPOOFING.TICK_SIZE,
                wallTicks: Config.SPOOFING.WALL_TICKS,
                minWallSize: Config.SPOOFING.MIN_WALL_SIZE,
                dynamicWallWidth: Config.SPOOFING.DYNAMIC_WALL_WIDTH,
                testLogMinSpoof: Config.SPOOFING.TEST_LOG_MIN_SPOOF,
            },
            features: {
                spoofingDetection: parseBool(
                    process.env.ABSORPTION_SPOOFING_DETECTION,
                    true
                ),
                adaptiveZone: parseBool(
                    process.env.ABSORPTION_ADAPTIVE_ZONE,
                    true
                ),
                passiveHistory: parseBool(
                    process.env.ABSORPTION_PASSIVE_HISTORY,
                    true
                ),
                multiZone: parseBool(process.env.ABSORPTION_MULTI_ZONE, true),
                priceResponse: parseBool(
                    process.env.ABSORPTION_PRICE_RESPONSE,
                    true
                ),
                sideOverride: parseBool(
                    process.env.ABSORPTION_SIDE_OVERRIDE,
                    false
                ),
                autoCalibrate: parseBool(
                    process.env.ABSORPTION_AUTO_CALIBRATE,
                    true
                ),
                icebergDetection: parseBool(
                    process.env.ABSORPTION_ICEBERG_DETECTION,
                    true
                ),
                liquidityGradient: parseBool(
                    process.env.ABSORPTION_LIQUIDITY_GRADIENT,
                    true
                ),
                spreadAdjustment: parseBool(
                    process.env.ABSORPTION_SPREAD_AJUSTMENT,
                    true
                ),
                absorptionVelocity: parseBool(
                    process.env.ABSORPTION_VELOCITY,
                    true
                ),
            },
        };
    }

    /**
     * Create exhaustion detector settings
     */
    private createExhaustionSettings(): ExhaustionSettings {
        console.log(
            "Creating exhaustion settings with config:",
            Config.EXHAUSTION
        );
        return {
            minAggVolume: Config.EXHAUSTION.MIN_AGG_VOLUME,
            exhaustionThreshold: Config.EXHAUSTION.THRESHOLD,
            windowMs: Config.EXHAUSTION.WINDOW_MS,
            zoneTicks: Config.EXHAUSTION.ZONE_TICKS,
            eventCooldownMs: Config.EXHAUSTION.EVENT_COOLDOWN_MS,
            maxPassiveRatio: Config.EXHAUSTION.MAX_PASSIVE_RATIO,
            pricePrecision: Config.EXHAUSTION.PRICE_PRECISION,
            minInitialMoveTicks: Config.EXHAUSTION.MOVE_TICKS,
            confirmationTimeoutMs: Config.EXHAUSTION.CONFIRMATION_TIMEOUT,
            maxRevisitTicks: Config.EXHAUSTION.MAX_REVISIT_TICKS,
            symbol: Config.SYMBOL,
            spoofing: {
                tickSize: Config.SPOOFING.TICK_SIZE,
                wallTicks: Config.SPOOFING.WALL_TICKS,
                minWallSize: Config.SPOOFING.MIN_WALL_SIZE,
                dynamicWallWidth: Config.SPOOFING.DYNAMIC_WALL_WIDTH,
                testLogMinSpoof: Config.SPOOFING.TEST_LOG_MIN_SPOOF,
            },
            features: {
                priceResponse: parseBool(
                    process.env.EXHAUSTION_PRICE_RESPONSE,
                    true
                ),
                depletionTracking: parseBool(
                    process.env.EXHAUSTION_DEPLETION_TRACKING,
                    true
                ),
                spreadAdjustment: parseBool(
                    process.env.EXHAUSTION_SPREAD_AJUSTMENT,
                    true
                ),
                spoofingDetection: parseBool(
                    process.env.EXHAUSTION_SPOOFING_DETECTION,
                    true
                ),
                autoCalibrate: parseBool(
                    process.env.EXHAUSTION_AUTO_CALIBRATE,
                    true
                ),
                adaptiveZone: parseBool(
                    process.env.EXHAUSTION_ADAPTIVE_ZONE,
                    true
                ),
                multiZone: parseBool(process.env.EXHAUSTION_MULTI_ZONE, true),
                volumeVelocity: parseBool(
                    process.env.EXHAUSTION_VOLUME_VELOCITY,
                    true
                ),
                passiveHistory: parseBool(
                    process.env.EXHAUSTION_PASSIVE_HISTORY,
                    true
                ),

                sideOverride: parseBool(
                    process.env.EXHAUSTION_SIDE_OVERRIDE,
                    false
                ),
            },
        };
    }

    /**
     * Setup event handlers
     */
    private setupEventHandlers(): void {
        // Listen to coordinator events
        this.signalCoordinator.on(
            "detectorRegistered",
            (info: DetectorRegisteredEvent) => {
                this.logger.info("Detector registered:", { info });
            }
        );

        this.signalCoordinator.on(
            "signalQueued",
            ({ job, queueSize }: SignalQueuedEvent) => {
                this.logger.info(
                    `Signal queued: ${job.id}, queue size: ${queueSize}`
                );
            }
        );

        this.signalCoordinator.on(
            "signalProcessed",
            ({
                job,
                processedSignal,
                processingTimeMs,
            }: SignalProcessedEvent) => {
                this.logger.info(`Signal processed in ${processingTimeMs}ms:`, {
                    signalId: processedSignal.id,
                    jobId: job.id,
                });
                // TODO
                const signal: Signal = {
                    time: Date.now(),
                    type: processedSignal.type,
                    price: processedSignal.data.price,
                    id: processedSignal.id,
                    side: processedSignal.data.side,
                    confidence: processedSignal.confidence,
                };
                void signal; //this.broadcastSignal(signal);
            }
        );

        this.signalCoordinator.on(
            "signalFailed",
            ({ job, error }: SignalFailedEvent) => {
                this.logger.error(`Signal failed permanently:`, {
                    jobId: job.id,
                    errorMessage: error.message,
                });
            }
        );

        this.signalCoordinator.on(
            "detectorError",
            ({ detectorId, error }: DetectorErrorEvent) => {
                this.logger.error(`Detector ${detectorId} error:`, {
                    errorMessage: error.message,
                });
            }
        );

        // Handle data stream events
        if (!this.dataStreamManager) {
            throw new Error("Data stream manager is not initialized");
        }

        this.logger.info(
            "[OrderFlowDashboard] Setting up data stream event handlers..."
        );
        this.dataStreamManager.on(
            "trade",
            (data: SpotWebsocketStreams.AggTradeResponse) => {
                this.processTrade(data);
            }
        );

        this.dataStreamManager.on(
            "depth",
            (data: SpotWebsocketStreams.DiffBookDepthResponse) => {
                this.processDepth(data);
            }
        );

        this.dataStreamManager.on("error", (error: Error) => {
            this.handleError(error, "data_stream");
        });

        // Handle signal events
        // Listen to final trading signals
        this.signalManager.on("signalGenerated", (tradingSignal: Signal) => {
            this.logger.info("Ready to trade:", { tradingSignal });
            void this.broadcastSignal(tradingSignal).catch((error) => {
                this.handleError(error as Error, "signal_broadcast");
            });
        });

        this.signalManager.on(
            "signalRejected",
            ({ signal, reason, anomaly }) => {
                this.logger.error("Signal rejected:", {
                    reason,
                    anomaly,
                    signal,
                });
            }
        );

        if (this.preprocessor) {
            this.logger.info(
                "[OrderFlowDashboard] Setting up preprocessor event handlers..."
            );
            this.preprocessor.on(
                "enriched_trade",
                (enrichedTrade: EnrichedTradeEvent) => {
                    // TODO
                    this.absorptionDetector.onEnrichedTrade(enrichedTrade);
                    this.anomalyDetector.onEnrichedTrade(enrichedTrade);
                    this.accumulationDetector.onEnrichedTrade(enrichedTrade);
                    this.exhaustionDetector.onEnrichedTrade(enrichedTrade);

                    const aggTradeMessage: WebSocketMessage =
                        this.dependencies.tradesProcessor.onEnrichedTrade(
                            enrichedTrade
                        );
                    if (aggTradeMessage) {
                        this.wsManager.broadcast(aggTradeMessage);
                    }
                }
            );
            this.preprocessor?.on(
                "orderbook_update",
                (orderBookUpdate: OrderBookSnapshot) => {
                    const orderBookMessage: WebSocketMessage =
                        this.dependencies.orderBookProcessor.onOrderBookUpdate(
                            orderBookUpdate
                        );
                    if (orderBookMessage)
                        this.wsManager.broadcast(orderBookMessage);
                }
            );
        }

        if (this.accumulationDetector) {
            this.logger.info(
                "[OrderFlowDashboard] Setting up accumulation detector event handlers..."
            );
            this.accumulationDetector.on(
                "accumulation",
                (event: AccumulationResult) => {
                    //TODO make this robust
                    this.logger.warn("Market accumulation detected:", {
                        event,
                    });
                }
            );
        }

        if (this.anomalyDetector) {
            this.logger.info(
                "[OrderFlowDashboard] Setting up anomaly detector event handlers..."
            );
            this.anomalyDetector.on("anomaly", (event: AnomalyEvent) => {
                if (
                    event &&
                    (event.severity === "critical" || event.severity === "high")
                ) {
                    this.logger.warn("Market anomaly detected:", { event });
                }
                const message: WebSocketMessage = {
                    type: "anomaly",
                    data: event,
                    now: Date.now(),
                };
                this.wsManager.broadcast(message);
                // TODO Take action (pause trading, alert, etc.)
            });
        }
    }

    /**
     * Setup HTTP server
     */
    private setupHttpServer(): void {
        const publicPath = path.join(__dirname, "../public");
        this.httpServer.use(express.static(publicPath));

        this.httpServer.get("/health", (req, res) => {
            const correlationId = randomUUID();
            try {
                const metrics = this.metricsCollector.getMetrics();
                const health = {
                    status: "healthy",
                    timestamp: new Date().toISOString(),
                    uptime: process.uptime(),
                    connections: this.wsManager.getConnectionCount(),
                    circuitBreakerState:
                        this.dependencies.circuitBreaker.getState(),
                    metrics: {
                        signalsGenerated: metrics.legacy.signalsGenerated, //TODO
                        averageLatency:
                            this.metricsCollector.getAverageLatency(),
                        errorsCount: metrics.legacy.errorsCount, //TODO
                    },
                    correlationId,
                };

                res.json(health);
                this.logger.info(
                    "Health check requested",
                    health,
                    correlationId
                );
            } catch (error) {
                this.handleError(error as Error, "health_check", correlationId);
                res.status(500).json({
                    status: "unhealthy",
                    error: (error as Error).message,
                    correlationId,
                });
            }
        });
    }

    /**
     * Process incoming trade data
     */
    private processTrade(data: SpotWebsocketStreams.AggTradeResponse): void {
        const correlationId = randomUUID();
        const startTime = Date.now();

        try {
            // Update detectors
            if (this.preprocessor) this.preprocessor.handleAggTrade(data);
            this.deltaCVDConfirmation.addTrade(data);

            // Update swing predictor
            this.swingPredictor.onPrice(
                parseFloat(data.p ?? "0"),
                data.T ?? Date.now()
            );

            // Process for indicators
            const tradeData = this.normalizeTradeData(data);
            this.analyzeSwingOpportunity(tradeData.price, tradeData);

            // Process and broadcast
            //const message = this.dependencies.tradesProcessor.addTrade(data);
            //this.wsManager.broadcast(message);

            const processingTime = Date.now() - startTime;
            this.metricsCollector.updateMetric(
                "processingLatency",
                processingTime
            );
        } catch {
            this.handleError(
                new SignalProcessingError(
                    "Error processing trade data",
                    { data },
                    correlationId
                ),
                "trade_processing",
                correlationId
            );
        }
    }

    /**
     * Process incoming depth data
     */
    private processDepth(
        data: SpotWebsocketStreams.DiffBookDepthResponse
    ): void {
        const correlationId = randomUUID();
        const startTime = Date.now();

        try {
            // Update preprocessor
            if (this.preprocessor) this.preprocessor.handleDepth(data);

            const processingTime = Date.now() - startTime;
            this.metricsCollector.updateMetric(
                "processingLatency",
                processingTime
            );
        } catch {
            this.handleError(
                new SignalProcessingError(
                    "Error processing depth data",
                    { data },
                    correlationId
                ),
                "depth_processing",
                correlationId
            );
        }
    }

    /**
     * Normalize trade data
     */
    private normalizeTradeData(
        data: SpotWebsocketStreams.AggTradeResponse
    ): TradeData {
        return {
            price: parseFloat(data.p || "0"),
            quantity: parseFloat(data.q || "0"),
            timestamp: data.T || Date.now(),
            buyerIsMaker: data.m || false,
            originalTrade: data,
        };
    }

    /**
     * Analyze swing opportunity
     */
    // TODO
    private analyzeSwingOpportunity(
        currentPrice: number,
        trade: TradeData
    ): void {
        // Update all indicators
        this.swingMetrics.addTrade(trade);
        this.momentumDivergence.addDataPoint(
            trade.price,
            trade.quantity,
            trade.timestamp
        );

        // Check for swing signals
        const volumeNodes: VolumeNodes =
            this.swingMetrics.getVolumeNodes(currentPrice);
        const accumulation: AccumulationResult = {
            price: 0,
            side: "buy",
            confidence: 0,
            isAccumulating: false,
            strength: 0,
            zone: 0,
            duration: 0,
            ratio: 0,
        };
        // TODO this.accumulationDetector.detectAccumulation(currentPrice);
        const divergence: DivergenceResult =
            this.momentumDivergence.detectDivergence();

        // Signal generation logic
        if (
            this.shouldGenerateSwingSignal(
                currentPrice,
                accumulation,
                divergence,
                volumeNodes
            )
        ) {
            void this.generateSwingSignal(
                currentPrice,
                accumulation,
                divergence
            ).catch((error) => {
                this.handleError(
                    error as Error,
                    "swing_signal_generation",
                    randomUUID()
                );
            });
        }
    }

    /**
     * Should generate swing signal
     */
    private shouldGenerateSwingSignal(
        currentPrice: number,
        accumulation: AccumulationResult,
        divergence: DivergenceResult,
        volumeNodes: VolumeNodes
    ): boolean {
        let confirmations = 0;

        if (accumulation.isAccumulating && accumulation.strength > 0.5) {
            confirmations++;
        }

        if (divergence.type === "bullish" && divergence.strength > 0.3) {
            confirmations++;
        }

        // Check if price is near a low volume node
        const nearLVN = volumeNodes.lvn.some(
            (lvn) => Math.abs(lvn - currentPrice) < currentPrice * 0.001
        );
        if (nearLVN) {
            confirmations++;
        }

        return confirmations >= 2;
    }

    /**
     * Generate swing signal
     */
    private async generateSwingSignal(
        currentPrice: number,
        accumulation: AccumulationResult,
        divergence: DivergenceResult
    ): Promise<void> {
        const side: "buy" | "sell" =
            divergence.type === "bullish" || accumulation.isAccumulating
                ? "buy"
                : "sell";

        const profitTarget = calculateProfitTarget(currentPrice, side);
        const stopLoss = calculateStopLoss(currentPrice, side);

        const signalData: SwingSignalData = {
            accumulation,
            divergence,
            expectedGainPercent: profitTarget.netGain,
            swingType: side === "buy" ? "low" : "high",
            strength: Math.max(accumulation.strength, divergence.strength),
        };
        const signal: Signal = {
            id: randomUUID(),
            side,
            type: "flow",
            time: Date.now(),
            price: currentPrice,
            takeProfit: profitTarget.price,
            stopLoss,
            closeReason: "swing_detection",
            signalData,
        };

        // Send alert via AlertManager
        await this.dependencies.alertManager.sendAlert(signal);

        // Also broadcast to WebSocket clients
        await this.broadcastSignal(signal);
    }

    /**
     * Handle swing prediction
     */
    private handleSwingPrediction(prediction: SwingPrediction): void {
        const correlationId = randomUUID();

        try {
            void this.broadcastSignal(prediction as unknown as Signal).catch(
                () => {
                    this.handleError(
                        new SignalProcessingError(
                            "Error broadcasting swing prediction",
                            { prediction },
                            correlationId
                        ),
                        "swing_prediction",
                        correlationId
                    );
                }
            );
        } catch (error) {
            this.handleError(
                error as Error,
                "swing_prediction_handler",
                correlationId
            );
        }
    }

    /**
     * Broadcast signal to clients
     */
    private async broadcastSignal(signal: Signal): Promise<void> {
        const correlationId = randomUUID();
        try {
            this.logger.info("Broadcasting signal", { signal }, correlationId);
            this.metricsCollector.incrementMetric("signalsGenerated");

            // Send webhook if configured
            if (Config.WEBHOOK_URL) {
                await this.sendWebhookMessage(
                    Config.WEBHOOK_URL,
                    {
                        type: signal.type,
                        time: signal.time,
                        price: signal.price,
                        takeProfit: signal.takeProfit,
                        stopLoss: signal.stopLoss,
                        label: signal.closeReason,
                        correlationId,
                    },
                    correlationId
                );
            }

            // Broadcast to WebSocket clients
            this.wsManager.broadcast({
                type: "signal",
                data: signal,
                now: Date.now(),
            });
        } catch {
            this.handleError(
                new SignalProcessingError(
                    "Error broadcasting signal",
                    { signal },
                    correlationId
                ),
                "broadcast_signal",
                correlationId
            );
        }
    }

    /**
     * Send webhook message
     */
    private async sendWebhookMessage(
        webhookUrl: string,
        message: object,
        correlationId?: string
    ): Promise<void> {
        try {
            await this.dependencies.circuitBreaker.execute(async () => {
                const response = await fetch(webhookUrl, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "X-Correlation-ID": correlationId || randomUUID(),
                    },
                    body: JSON.stringify(message),
                });

                if (!response.ok) {
                    throw new Error(
                        `Webhook request failed: ${response.status} ${response.statusText}`
                    );
                }

                this.logger.info(
                    "Webhook message sent successfully",
                    { webhookUrl },
                    correlationId
                );
            }, correlationId);
        } catch (error) {
            this.handleError(error as Error, "webhook_send", correlationId);
        }
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

        if (
            error instanceof SignalProcessingError ||
            error instanceof WebSocketError
        ) {
            errorContext.correlationId = error.correlationId ?? randomUUID();
        }

        this.logger.error(
            `[${context}] ${error.message}`,
            errorContext,
            correlationId
        );
    }

    /**
     * Preload historical data
     */
    private async preloadData(): Promise<void> {
        const correlationId = randomUUID();

        try {
            // TODO Preload trades
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
    }

    /**
     * Start periodic tasks
     */
    private startPeriodicTasks(): void {
        // Update circuit breaker metrics
        setInterval(() => {
            const state = this.dependencies.circuitBreaker.getState();
            this.metricsCollector.updateMetric("circuitBreakerState", state);
        }, 30000);

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
     * Start HTTP server
     */
    private async startHttpServer(): Promise<void> {
        return new Promise((resolve) => {
            this.httpServer.listen(Config.HTTP_PORT, () => {
                this.logger.info(
                    `HTTP server running at http://localhost:${Config.HTTP_PORT}`
                );
                resolve();
            });
        });
    }

    /**
     * Setup graceful shutdown
     */
    private setupGracefulShutdown(): void {
        const shutdown = async (signal: string): Promise<void> => {
            this.logger.info(`Received ${signal}, starting graceful shutdown`);
            this.isShuttingDown = true;

            // Clear intervals
            if (this.purgeIntervalId) {
                clearInterval(this.purgeIntervalId);
            }

            // Shutdown components
            this.wsManager.shutdown();
            await this.dataStreamManager.disconnect();

            // Give time for cleanup
            setTimeout(() => {
                this.logger.info("Graceful shutdown completed");
                process.exit(0);
            }, 5000);
        };

        process.on("SIGTERM", () => void shutdown("SIGTERM"));
        process.on("SIGINT", () => void shutdown("SIGINT"));
    }

    /**
     * Start the dashboard
     */
    public async startDashboard(): Promise<void> {
        const correlationId = randomUUID();

        try {
            this.logger.info(
                "Starting Order Flow Dashboard",
                {},
                correlationId
            );

            // Start components in parallel
            await Promise.all([this.startHttpServer(), this.preloadData()]);

            // Connect to data streams
            await this.dataStreamManager.connect();

            // Start periodic tasks
            this.startPeriodicTasks();

            this.logger.info(
                "Order Flow Dashboard started successfully",
                {},
                correlationId
            );
        } catch (error) {
            this.handleError(
                new Error(
                    `Error starting Order Flow Dashboard: ${(error as Error).message}`
                ),
                "dashboard_startup",
                correlationId
            );
            throw error;
        }
    }
}

/**
 * Factory function to create dependencies
 */
export function createDependencies(): Dependencies {
    const logger = new Logger(process.env.NODE_ENV === "development");
    const metricsCollector = new MetricsCollector();
    const signalLogger = new SignalLogger("signals.csv");
    const rateLimiter = new RateLimiter(60000, 100);
    const circuitBreaker = new CircuitBreaker(5, 60000, logger);

    const orderBookProcessor = new OrderBookProcessor(
        {
            binSize: 10,
            numLevels: 10,
            maxBufferSize: 1000,
            tickSize: Config.TICK_SIZE,
            precision: Config.PRICE_PRECISION,
        } as OrderBookProcessorOptions,
        logger,
        metricsCollector
    );

    const tradesProcessor = new TradesProcessor(
        {
            symbol: Config.SYMBOL,
            storageTime: Config.MAX_STORAGE_TIME,
        },
        logger,
        metricsCollector
    );

    const anomalyDetector = new AnomalyDetector({
        windowSize: 1200,
        minHistory: 200,
        anomalyCooldownMs: 20000, // 20 seconds
        volumeImbalanceThreshold: 0.85,
        absorptionRatioThreshold: 4.2,
        icebergDetectionWindow: 120000,
        orderSizeAnomalyThreshold: 4.5,
        normalSpreadBps: 12,
        tickSize: 0.01,
        logger,
    });

    const alertManager = new AlertManager(
        process.env.ALERT_WEBHOOK_URL,
        parseInt(process.env.ALERT_COOLDOWN_MS || "300000", 10)
    );

    // TODO
    const signalManager = new SignalManager(
        anomalyDetector,
        alertManager,
        logger,
        metricsCollector,
        {
            confidenceThreshold: 0.75,
            enableAnomalyDetection: true,
            enableAlerts: true,
        }
    );

    /*
    config: Partial<SignalCoordinatorConfig> = {},
        logger: Logger,
        metricsCollector: MetricsCollector,
        signalLogger: SignalLogger,
        signalManager: SignalManager,
        detectorFactory: DetectorFactory,
)
*/
    const signalCoordinator = new SignalCoordinator(
        {
            maxConcurrentProcessing: 10, // TODO
        },
        logger,
        metricsCollector,
        signalLogger,
        signalManager
    );

    return {
        storage: new Storage(),
        binanceFeed: new BinanceDataFeed(),
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
    };
}

// Export for use
export { Config } from "./core/config.js";
export type { Dependencies } from "./types/dependencies.js";
