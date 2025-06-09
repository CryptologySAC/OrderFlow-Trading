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
import {
    RecoveryManager,
    type HardReloadEvent,
} from "./infrastructure/recoveryManager.js";
import { MicrostructureAnalyzer } from "./data/microstructureAnalyzer.js";
import { IndividualTradesManager } from "./data/individualTradesManager.js";
import { ThreadManager } from "./multithreading/threadManager.js";
import { WorkerLogger } from "./multithreading/workerLogger.js";
import { WorkerSignalLogger } from "./multithreading/workerSignalLogger.js";

// Service imports
import { DetectorFactory } from "./utils/detectorFactory.js";
import type {
    EnrichedTradeEvent,
    OrderBookSnapshot,
} from "./types/marketEvents.js";
import { OrderflowPreprocessor } from "./market/orderFlowPreprocessor.js";
import { OrderBookState } from "./market/orderBookState.js";
import {
    WebSocketManager,
    type ExtendedWebSocket,
} from "./websocket/websocketManager.js";
import { SignalManager } from "./trading/signalManager.js";
import { DataStreamManager } from "./trading/dataStreamManager.js";
import { SignalCoordinator } from "./services/signalCoordinator.js";
import { AnomalyDetector, AnomalyEvent } from "./services/anomalyDetector.js";
import { AlertManager } from "./alerts/alertManager.js";

// Indicator imports
import { AbsorptionDetector } from "./indicators/absorptionDetector.js";
import { ExhaustionDetector } from "./indicators/exhaustionDetector.js";
// Legacy detectors removed - using zone-based architecture
import { DeltaCVDConfirmation } from "./indicators/deltaCVDConfirmation.js";
import { SupportResistanceDetector } from "./indicators/supportResistanceDetector.js";

// Zone-based Detector imports
import { AccumulationZoneDetector } from "./indicators/accumulationZoneDetector.js";
import { DistributionZoneDetector } from "./indicators/distributionZoneDetector.js";
import type {
    AccumulationZone,
    ZoneUpdate,
    ZoneSignal,
    ZoneAnalysisResult,
} from "./types/zoneTypes.js";

// Utils imports
import { TradeData } from "./utils/utils.js";

// Types
import type { Dependencies } from "./types/dependencies.js";
import type { Signal, ConfirmedSignal } from "./types/signalTypes.js";
import type { ConnectivityIssue } from "./infrastructure/apiConnectivityMonitor.js";
import type {
    TimeContext,
    DetectorRegisteredEvent,
    SignalQueuedEvent,
    SignalProcessedEvent,
    SignalFailedEvent,
    DetectorErrorEvent,
} from "./utils/types.js";

// Storage and processors
import { getDB } from "./infrastructure/db.js";
import { runMigrations } from "./infrastructure/migrate.js";
import { Storage } from "./storage/storage.js";
import { PipelineStorage } from "./storage/pipelineStorage.js";
import { BinanceDataFeed } from "./utils/binance.js";
import { SignalTracker } from "./analysis/signalTracker.js";
import { MarketContextCollector } from "./analysis/marketContextCollector.js";
import { TradesProcessor } from "./clients/tradesProcessor.js";
import { OrderBookProcessor } from "./clients/orderBookProcessor.js";
import { SignalLogger } from "./services/signalLogger.js";
import type { WebSocketMessage } from "./utils/interfaces.js";
import { SpoofingDetector } from "./services/spoofingDetector.js";
import { StatsBroadcaster } from "./services/statsBroadcaster.js";

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
    private readonly recoveryManager: RecoveryManager;

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

    // Event-based Detectors (keep as-is)
    private readonly absorptionDetector: AbsorptionDetector;
    private readonly exhaustionDetector: ExhaustionDetector;
    private readonly supportResistanceDetector: SupportResistanceDetector;

    // Zone-based Detectors (new architecture)
    private readonly accumulationZoneDetector: AccumulationZoneDetector;
    private readonly distributionZoneDetector: DistributionZoneDetector;

    // Legacy detectors removed - replaced by zone-based architecture

    // Indicators
    private readonly deltaCVDConfirmation: DeltaCVDConfirmation;

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
    private statsBroadcaster: StatsBroadcaster;
    private lastTradePrice = 0; // Track last trade price for anomaly context

    public static async create(
        dependencies: Dependencies,
        delayFn: (cb: () => void, ms: number) => unknown = setTimeout
    ): Promise<OrderFlowDashboard> {
        const instance = new OrderFlowDashboard(dependencies, delayFn);
        await instance.initialize(dependencies);
        return instance;
    }

    private async initialize(dependencies: Dependencies): Promise<void> {
        this.orderBook = await OrderBookState.create(
            Config.ORDERBOOK_STATE,
            dependencies.logger,
            dependencies.metricsCollector
        );
        this.preprocessor = new OrderflowPreprocessor(
            Config.PREPROCESSOR,
            this.orderBook,
            dependencies.logger,
            dependencies.metricsCollector,
            dependencies.individualTradesManager,
            dependencies.microstructureAnalyzer
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

        // Initialize recovery manager
        this.recoveryManager = new RecoveryManager(
            {
                enableHardReload: Config.DATASTREAM.enableHardReload ?? false,
                hardReloadCooldownMs:
                    Config.DATASTREAM.hardReloadCooldownMs ?? 300000,
                maxHardReloads: Config.DATASTREAM.maxHardReloads ?? 3,
                hardReloadRestartCommand:
                    Config.DATASTREAM.hardReloadRestartCommand ??
                    "process.exit",
            },
            this.logger,
            this.metricsCollector
        );

        // Initialize coordinators
        this.signalCoordinator = dependencies.signalCoordinator;
        this.anomalyDetector = dependencies.anomalyDetector;

        // Initialize managers
        this.wsManager = new WebSocketManager(
            Config.WS_PORT,
            this.logger,
            dependencies.rateLimiter,
            this.metricsCollector,
            this.createWSHandlers(),
            (ws) => this.onClientConnected(ws)
        );

        this.signalManager = dependencies.signalManager;

        this.dataStreamManager = new DataStreamManager(
            Config.DATASTREAM,
            dependencies.binanceFeed,
            dependencies.circuitBreaker,
            this.logger,
            this.metricsCollector
        );

        this.statsBroadcaster = new StatsBroadcaster(
            this.metricsCollector,
            this.dataStreamManager,
            this.wsManager,
            this.logger,
            dependencies.signalTracker
        );
        DetectorFactory.initialize(dependencies);

        this.absorptionDetector = DetectorFactory.createAbsorptionDetector(
            (signal) => {
                console.log("Absorption signal:", signal);
            },
            Config.ABSORPTION_DETECTOR,
            dependencies,
            { id: "ltcusdt-absorption-main" }
        );
        this.signalCoordinator.registerDetector(
            this.absorptionDetector,
            ["absorption"],
            60,
            true
        );

        this.exhaustionDetector = DetectorFactory.createExhaustionDetector(
            (signal) => {
                console.log("Exhaustion signal:", signal);
            },
            Config.EXHAUSTION_DETECTOR,
            dependencies,
            { id: "ltcusdt-exhaustion-main" }
        );
        this.signalCoordinator.registerDetector(
            this.exhaustionDetector,
            ["exhaustion"],
            100,
            true
        );

        // Legacy accumulation/distribution detectors removed
        // Replaced by zone-based AccumulationZoneDetector and DistributionZoneDetector

        // Initialize other components
        this.deltaCVDConfirmation =
            DetectorFactory.createDeltaCVDConfirmationDetector(
                (signal) => {
                    console.log("Delta CVD signal:", signal);
                },
                Config.DELTACVD_DETECTOR,
                dependencies,
                { id: "ltcusdt-cvdConfirmation-main" }
            );
        this.signalCoordinator.registerDetector(
            this.deltaCVDConfirmation,
            ["cvd_confirmation"],
            30,
            true
        );

        // Support/Resistance Detector
        this.supportResistanceDetector =
            DetectorFactory.createSupportResistanceDetector(
                (signal) => {
                    console.log("Support/Resistance level detected:", signal);
                },
                Config.SUPPORT_RESISTANCE_DETECTOR,
                dependencies,
                { id: "ltcusdt-support-resistance-main" }
            );
        this.signalCoordinator.registerDetector(
            this.supportResistanceDetector,
            ["support_resistance_level"],
            10,
            true
        );

        // Initialize Zone-based Detectors
        this.accumulationZoneDetector =
            DetectorFactory.createAccumulationDetector(
                (signal) => {
                    console.log("Accumulation zone detected:", signal);
                },
                Config.ACCUMULATION_ZONE_DETECTOR,
                dependencies,
                { id: "ltcusdt-accumulation-zone-main" }
            );
        this.signalCoordinator.registerDetector(
            this.supportResistanceDetector,
            ["accumulation"],
            40,
            true
        );

        // Initialize Zone-based Detectors
        this.distributionZoneDetector =
            DetectorFactory.createDistributionDetector(
                (signal) => {
                    console.log("Distribution zone detected:", signal);
                },
                Config.DISTRIBUTION_ZONE_DETECTOR,
                dependencies,
                { id: "ltcusdt-distribution-zone-main" }
            );
        this.signalCoordinator.registerDetector(
            this.supportResistanceDetector,
            ["distribution"],
            40,
            true
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
        void event; //todo
    };

    private onClientConnected(ws: ExtendedWebSocket): void {
        try {
            const backlogAmount =
                Config.TRADES_PROCESSOR.backlogBatchSize ?? 1000;
            let backlog =
                this.dependencies.tradesProcessor.requestBacklog(backlogAmount);
            backlog = backlog.reverse();
            ws.send(
                JSON.stringify({
                    type: "backlog",
                    data: backlog,
                    now: Date.now(),
                })
            );

            // Extended signal backlog for better client experience
            const maxSignalBacklogAge = 90 * 60 * 1000; // 90 minutes (matches chart range)
            const since = Math.max(
                backlog.length > 0 ? backlog[0].time : Date.now(),
                Date.now() - maxSignalBacklogAge
            );

            // Get more comprehensive signals and deduplicate
            const signals =
                this.dependencies.pipelineStore.getRecentConfirmedSignals(
                    since,
                    100 // Increased from 30 to 100 for better coverage
                );
            const deduplicatedSignals = this.deduplicateSignals(signals);

            if (deduplicatedSignals.length > 0) {
                this.logger.info(
                    `Sending ${deduplicatedSignals.length} signals in backlog to client`,
                    {
                        clientId: ws.clientId,
                        originalCount: signals.length,
                        deduplicatedCount: deduplicatedSignals.length,
                        timeWindow: `${maxSignalBacklogAge / 60000} minutes`,
                    }
                );

                ws.send(
                    JSON.stringify({
                        type: "signal_backlog",
                        data: deduplicatedSignals,
                        now: Date.now(),
                    })
                );
            }

            // Send current active zones to new client
            const accumulationZones =
                this.accumulationZoneDetector.getActiveZones();
            const distributionZones =
                this.distributionZoneDetector.getActiveZones();
            const allActiveZones = [...accumulationZones, ...distributionZones];

            if (allActiveZones.length > 0) {
                this.logger.info(
                    `Sending ${allActiveZones.length} active zones to client`,
                    {
                        clientId: ws.clientId,
                        accumulation: accumulationZones.length,
                        distribution: distributionZones.length,
                    }
                );

                for (const zone of allActiveZones) {
                    ws.send(
                        JSON.stringify({
                            type: "zoneUpdate",
                            data: {
                                updateType: "zone_created",
                                zone: {
                                    id: zone.id,
                                    type: zone.type,
                                    priceRange: zone.priceRange,
                                    strength: zone.strength,
                                    completion: zone.completion,
                                    confidence: zone.confidence,
                                    significance: zone.significance,
                                    totalVolume: zone.totalVolume,
                                    timeInZone: zone.timeInZone,
                                },
                                significance: zone.significance,
                                timestamp: Date.now(),
                            },
                            now: Date.now(),
                        })
                    );
                }
            }

            // Send current support/resistance levels to new client
            const currentLevels = this.supportResistanceDetector.getLevels();
            if (currentLevels.length > 0) {
                this.logger.info(
                    `Sending ${currentLevels.length} support/resistance levels to client`,
                    {
                        clientId: ws.clientId,
                        levels: currentLevels.map((l) => ({
                            id: l.id,
                            price: l.price,
                            type: l.type,
                            strength: l.strength,
                        })),
                    }
                );

                // Send each level as individual supportResistanceLevel messages
                currentLevels.forEach((level) => {
                    ws.send(
                        JSON.stringify({
                            type: "supportResistanceLevel",
                            data: level,
                            now: Date.now(),
                        })
                    );
                });
            }
        } catch (error) {
            this.handleError(error as Error, "on_connect_send");
        }
    }

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

        // Handle hard reload requests from data stream manager
        this.dataStreamManager.on(
            "hardReloadRequired",
            (event: HardReloadEvent) => {
                this.handleHardReloadRequest(event);
            }
        );

        // Handle recovery manager events
        this.recoveryManager.on(
            "hardReloadStarting",
            (event: HardReloadEvent) => {
                this.logger.error(
                    "[OrderFlowDashboard] Hard reload starting, initiating graceful shutdown",
                    {
                        reason: event.reason,
                        component: event.component,
                    }
                );
                void this.gracefulShutdown();
            }
        );

        this.recoveryManager.on(
            "hardReloadLimitExceeded",
            (event: HardReloadEvent) => {
                this.logger.error(
                    "[OrderFlowDashboard] Hard reload limit exceeded, system needs manual intervention",
                    {
                        reason: event.reason,
                        component: event.component,
                        hardReloadCount: (
                            event as HardReloadEvent & {
                                hardReloadCount: number;
                            }
                        ).hardReloadCount,
                    }
                );
                // Could emit alert to external monitoring system here
            }
        );

        this.dataStreamManager.on("disconnected", (reason: string) => {
            this.logger.warn("[OrderFlowDashboard] Data stream disconnected", {
                reason,
            });
            // Notify components that data stream is down
            this.dependencies.tradesProcessor.emit("stream_disconnected", {
                reason,
            });
        });

        this.dataStreamManager.on("connected", () => {
            this.logger.info(
                "[OrderFlowDashboard] Data stream reconnected successfully"
            );
            // Notify components that data stream is back up
            this.dependencies.tradesProcessor.emit("stream_connected");
            void this.dependencies.tradesProcessor
                .fillBacklog()
                .catch((error) => {
                    this.logger.error(
                        "[OrderFlowDashboard] Failed to load missed trades",
                        { error }
                    );
                });
            if (this.orderBook) {
                void this.orderBook.recover().catch((error) => {
                    this.logger.error(
                        "[OrderFlowDashboard] OrderBook recovery failed after reconnection",
                        { error }
                    );
                });
            }
        });

        this.dataStreamManager.on(
            "reconnecting",
            ({ attempt, delay, maxAttempts }) => {
                this.logger.info(
                    "[OrderFlowDashboard] Data stream reconnecting",
                    {
                        attempt,
                        delay,
                        maxAttempts,
                    }
                );
            }
        );

        this.dataStreamManager.on("unhealthy", () => {
            this.logger.warn(
                "[OrderFlowDashboard] Data stream health degraded"
            );
        });

        this.dataStreamManager.on("healthy", () => {
            this.logger.info(
                "[OrderFlowDashboard] Data stream health restored"
            );
        });

        // Handle API connectivity issues
        this.dataStreamManager.on(
            "connectivityIssue",
            (issue: ConnectivityIssue) => {
                // Get current price for anomaly context - use last trade price or skip if no trades yet
                if (this.lastTradePrice === 0) {
                    this.logger.debug(
                        "Skipping connectivity anomaly - no trades received yet"
                    );
                    return;
                }
                const currentPrice = this.lastTradePrice;

                this.logger.warn("API connectivity issue detected", {
                    type: issue.type,
                    severity: issue.severity,
                    description: issue.description,
                    suggestedAction: issue.suggestedAction,
                });

                // Report to anomaly detector
                this.anomalyDetector.onConnectivityIssue(issue, currentPrice);
            }
        );

        // Handle signal events
        // Handle data stream events
        if (!this.signalManager) {
            throw new Error("Signal Manager is not initialized");
        }
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

        this.signalManager.on(
            "criticalAnomalyDetected",
            ({ anomaly, recommendedAction }) => {
                console.log(`CRITICAL: ${anomaly} - ${recommendedAction}`);
                // Notify risk management, pause trading, etc.
            }
        );

        this.signalManager.on("emergencyPause", ({ reason, duration }) => {
            console.log(`EMERGENCY PAUSE: ${reason} for ${duration}ms`);
            // Halt all trading activity
        });

        if (this.preprocessor) {
            this.logger.info(
                "[OrderFlowDashboard] Setting up preprocessor event handlers..."
            );
            this.preprocessor.on(
                "enriched_trade",
                (enrichedTrade: EnrichedTradeEvent) => {
                    // Store last trade price for anomaly context
                    this.lastTradePrice = enrichedTrade.price;

                    // Feed trade data to event-based detectors
                    this.absorptionDetector.onEnrichedTrade(enrichedTrade);
                    this.anomalyDetector.onEnrichedTrade(enrichedTrade);
                    this.exhaustionDetector.onEnrichedTrade(enrichedTrade);
                    this.deltaCVDConfirmation.onEnrichedTrade(enrichedTrade);
                    this.supportResistanceDetector.onEnrichedTrade(
                        enrichedTrade
                    );

                    // Legacy detectors removed - replaced by zone-based architecture

                    // Process zone-based detectors (new architecture)
                    const accumulationAnalysis =
                        this.accumulationZoneDetector.analyze(enrichedTrade);
                    const distributionAnalysis =
                        this.distributionZoneDetector.analyze(enrichedTrade);

                    // Handle zone updates and signals
                    this.processZoneAnalysis(accumulationAnalysis);
                    this.processZoneAnalysis(distributionAnalysis);

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

        // Legacy accumulation detector event handler removed

        if (this.anomalyDetector) {
            this.logger.info(
                "[OrderFlowDashboard] Setting up anomaly detector event handlers..."
            );
            this.anomalyDetector.on("anomaly", (event: AnomalyEvent) => {
                const message: WebSocketMessage = {
                    type: "anomaly",
                    data: { ...event, details: event.details },
                    now: Date.now(),
                };
                this.wsManager.broadcast(message);
            });
        }

        if (this.supportResistanceDetector) {
            this.logger.info(
                "[OrderFlowDashboard] Setting up support/resistance detector event handlers..."
            );
            this.supportResistanceDetector.on(
                "supportResistanceLevel",
                (event: {
                    type: string;
                    data: Record<string, unknown>;
                    timestamp: Date;
                }) => {
                    const message: WebSocketMessage = {
                        type: "supportResistanceLevel",
                        data: event.data,
                        now: Date.now(),
                    };
                    this.wsManager.broadcast(message);
                    this.logger.info(
                        "Support/Resistance level broadcasted via WebSocket",
                        {
                            levelId: event.data.id,
                            price: event.data.price,
                            type: event.data.type,
                        }
                    );
                }
            );
        }

        // Setup zone-based detector event handlers
        this.setupZoneEventHandlers();
    }

    /**
     * Process zone analysis results from zone-based detectors
     */
    private processZoneAnalysis(analysis: ZoneAnalysisResult): void {
        try {
            // Process zone updates
            for (const update of analysis.updates) {
                this.handleZoneUpdate(update);
            }

            // Process zone signals
            for (const signal of analysis.signals) {
                this.handleZoneSignal(signal);
            }
        } catch (error) {
            this.logger.error("Error processing zone analysis", {
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }

    /**
     * Handle zone updates (creation, strengthening, completion, etc.)
     */
    private handleZoneUpdate(update: ZoneUpdate): void {
        const zone = update.zone;

        this.logger.info(`Zone ${update.updateType}`, {
            component: "ZoneProcessor",
            zoneId: zone.id,
            type: zone.type,
            updateType: update.updateType,
            significance: update.significance,
            strength: zone.strength.toFixed(3),
            completion: zone.completion.toFixed(3),
            priceCenter: zone.priceRange.center,
            totalVolume: zone.totalVolume,
        });

        // Broadcast zone update to clients
        const message: WebSocketMessage = {
            type: "zoneUpdate",
            data: {
                updateType: update.updateType,
                zone: {
                    id: zone.id,
                    type: zone.type,
                    priceRange: zone.priceRange,
                    strength: zone.strength,
                    completion: zone.completion,
                    confidence: zone.confidence,
                    significance: zone.significance,
                    isActive: zone.isActive,
                    totalVolume: zone.totalVolume,
                    timeInZone: zone.timeInZone,
                },
                significance: update.significance,
                changeMetrics: update.changeMetrics,
            },
            now: Date.now(),
        };

        this.wsManager.broadcast(message);
    }

    /**
     * Handle zone signals (entry, strength change, completion, etc.)
     */
    private handleZoneSignal(signal: ZoneSignal): void {
        const zone = signal.zone;

        this.logger.info(`Zone signal generated`, {
            component: "ZoneProcessor",
            zoneId: zone.id,
            signalType: signal.signalType,
            actionType: signal.actionType,
            confidence: signal.confidence.toFixed(3),
            urgency: signal.urgency,
            expectedDirection: signal.expectedDirection,
            zoneStrength: signal.zoneStrength.toFixed(3),
        });

        // Broadcast zone signal to clients
        const message: WebSocketMessage = {
            type: "zoneSignal",
            data: {
                signalType: signal.signalType,
                actionType: signal.actionType,
                confidence: signal.confidence,
                urgency: signal.urgency,
                timeframe: signal.timeframe,
                expectedDirection: signal.expectedDirection,
                zoneStrength: signal.zoneStrength,
                completionLevel: signal.completionLevel,
                positionSizing: signal.positionSizing,
                stopLossLevel: signal.stopLossLevel,
                takeProfitLevel: signal.takeProfitLevel,
                zone: {
                    id: zone.id,
                    type: zone.type,
                    priceRange: zone.priceRange,
                    strength: zone.strength,
                    completion: zone.completion,
                    significance: zone.significance,
                },
            },
            now: Date.now(),
        };

        this.wsManager.broadcast(message);
    }

    /**
     * Setup event handlers for zone-based detectors
     */
    private setupZoneEventHandlers(): void {
        // Accumulation Zone Events
        this.accumulationZoneDetector.on(
            "zoneCreated",
            (zone: AccumulationZone) => {
                this.logger.info("Accumulation zone created", {
                    zoneId: zone.id,
                    priceCenter: zone.priceRange.center,
                    strength: zone.strength.toFixed(3),
                    significance: zone.significance,
                });
            }
        );

        this.accumulationZoneDetector.on(
            "zoneCompleted",
            (zone: AccumulationZone) => {
                this.logger.info("Accumulation zone completed", {
                    zoneId: zone.id,
                    finalStrength: zone.strength.toFixed(3),
                    duration: zone.timeInZone,
                    totalVolume: zone.totalVolume,
                });
            }
        );

        // Distribution Zone Events
        this.distributionZoneDetector.on(
            "zoneCreated",
            (zone: AccumulationZone) => {
                this.logger.info("Distribution zone created", {
                    zoneId: zone.id,
                    priceCenter: zone.priceRange.center,
                    strength: zone.strength.toFixed(3),
                    significance: zone.significance,
                });
            }
        );

        this.distributionZoneDetector.on(
            "zoneCompleted",
            (zone: AccumulationZone) => {
                this.logger.info("Distribution zone completed", {
                    zoneId: zone.id,
                    finalStrength: zone.strength.toFixed(3),
                    duration: zone.timeInZone,
                    totalVolume: zone.totalVolume,
                });
            }
        );
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
                    dataStreamState:
                        this.dataStreamManager?.getStatus()?.state ?? "unknown",
                    recovery: this.recoveryManager.getStats(),
                    metrics: {
                        signalsGenerated: metrics.legacy.signalsGenerated,
                        averageLatency:
                            this.metricsCollector.getAverageLatency(),
                        errorsCount: metrics.legacy.errorsCount,
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

        this.httpServer.get("/stats", (req, res) => {
            const correlationId = randomUUID();
            try {
                const stats = {
                    metrics: this.metricsCollector.getMetrics(),
                    health: this.metricsCollector.getHealthSummary(),
                    dataStream: this.dataStreamManager.getDetailedMetrics(),
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
     * Process incoming trade data
     */
    private processTrade(data: SpotWebsocketStreams.AggTradeResponse): void {
        const correlationId = randomUUID();
        const startTime = Date.now();

        try {
            // Update detectors
            if (this.preprocessor) void this.preprocessor.handleAggTrade(data);

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
     * Broadcast signal to clients
     */
    private async broadcastSignal(signal: Signal): Promise<void> {
        const correlationId = randomUUID();
        try {
            this.logger.info("Broadcasting signal", { signal }, correlationId);
            this.metricsCollector.incrementMetric("signalsGenerated");

            // Send webhook if configured
            if (Config.ALERT_WEBHOOK_URL) {
                await this.sendWebhookMessage(
                    Config.ALERT_WEBHOOK_URL,
                    {
                        type: signal.type,
                        time: signal.time,
                        price: signal.price,
                        takeProfit: signal.takeProfit,
                        stopLoss: signal.stopLoss,
                        label: signal.type,
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
     * Handle hard reload requests from components
     */
    private handleHardReloadRequest(event: HardReloadEvent): void {
        this.logger.error("[OrderFlowDashboard] Hard reload requested", {
            reason: event.reason,
            component: event.component,
            attempts: event.attempts,
            metadata: event.metadata,
        });

        // Forward to recovery manager
        const success = this.recoveryManager.requestHardReload(event);

        if (!success) {
            this.logger.warn(
                "[OrderFlowDashboard] Hard reload request rejected by recovery manager",
                {
                    reason: event.reason,
                    component: event.component,
                }
            );
        }
    }

    /**
     * Graceful shutdown before hard reload
     */
    private async gracefulShutdown(): Promise<void> {
        this.logger.info(
            "[OrderFlowDashboard] Starting graceful shutdown for hard reload"
        );

        try {
            // Stop accepting new connections
            if (this.wsManager) {
                this.wsManager.shutdown();
            }

            // Disconnect data streams
            if (this.dataStreamManager) {
                await this.dataStreamManager.disconnect();
            }

            // Stop signal processing
            if (this.signalCoordinator) {
                // Signal coordinator doesn't have a stop method, but we can let pending signals finish
                this.logger.info(
                    "[OrderFlowDashboard] Allowing signal coordinator to finish pending signals"
                );
            }

            // Clean up storage connections
            if (this.dependencies?.storage) {
                // Most storage implementations don't need explicit cleanup
                this.logger.info(
                    "[OrderFlowDashboard] Storage cleanup completed"
                );
            }

            this.logger.info(
                "[OrderFlowDashboard] Graceful shutdown completed"
            );
        } catch (error) {
            this.logger.error(
                "[OrderFlowDashboard] Error during graceful shutdown",
                {
                    error:
                        error instanceof Error ? error.message : String(error),
                }
            );
        }
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
        this.statsBroadcaster.start();
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
            this.statsBroadcaster.stop();
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

    /**
     * Deduplicate confirmed signals based on price tolerance and time proximity
     */
    private deduplicateSignals(signals: ConfirmedSignal[]): ConfirmedSignal[] {
        if (signals.length === 0) return signals;

        const deduplicationConfig = {
            priceTolerancePercent: 0.02, // 0.02% price tolerance
            timeWindowMs: 30000, // 30 second time window
        };

        const deduplicated: ConfirmedSignal[] = [];

        // Sort by time (newest first)
        signals.sort((a, b) => b.confirmedAt - a.confirmedAt);

        for (const signal of signals) {
            let isDuplicate = false;

            // Check against already added signals
            for (const existingSignal of deduplicated) {
                const timeDiff = Math.abs(
                    signal.confirmedAt - existingSignal.confirmedAt
                );
                const priceDiff = Math.abs(
                    signal.finalPrice - existingSignal.finalPrice
                );
                const priceThreshold =
                    signal.finalPrice *
                    (deduplicationConfig.priceTolerancePercent / 100);

                // Also check if they have overlapping signal types
                const signalTypes = new Set(
                    signal.originalSignals.map((s) => s.type)
                );
                const existingTypes = new Set(
                    existingSignal.originalSignals.map((s) => s.type)
                );
                const hasOverlappingTypes = [...signalTypes].some((type) =>
                    existingTypes.has(type)
                );

                if (
                    timeDiff <= deduplicationConfig.timeWindowMs &&
                    priceDiff <= priceThreshold &&
                    hasOverlappingTypes
                ) {
                    isDuplicate = true;
                    break;
                }
            }

            if (!isDuplicate) {
                deduplicated.push(signal);
            }
        }

        // Sort final result by time (newest first)
        return deduplicated.sort((a, b) => b.confirmedAt - a.confirmedAt);
    }
}

/**
 * Factory function to create dependencies
 */

export function createDependencies(
    threadManager?: ThreadManager
): Dependencies {
    const logger = threadManager
        ? new WorkerLogger(
              threadManager,
              process.env.NODE_ENV === "development"
          )
        : new Logger(process.env.NODE_ENV === "development");
    const metricsCollector = new MetricsCollector();
    const signalLogger = threadManager
        ? new WorkerSignalLogger(threadManager)
        : new SignalLogger("./storage/signals.csv");
    const rateLimiter = new RateLimiter(60000, 100);
    const circuitBreaker = new CircuitBreaker(5, 60000, logger);
    const db = getDB("./storage/trades.db");
    runMigrations(db);
    const pipelineStore = new PipelineStorage(db, {});
    const storage = new Storage(db);
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

    const tradesProcessor = new TradesProcessor(
        Config.TRADES_PROCESSOR,
        storage,
        logger,
        metricsCollector
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
    const signalTracker = new SignalTracker(
        logger,
        metricsCollector,
        pipelineStore
    );

    const marketContextCollector = new MarketContextCollector(
        logger,
        metricsCollector
    );

    const signalManager = new SignalManager(
        anomalyDetector,
        alertManager,
        logger,
        metricsCollector,
        pipelineStore,
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
        pipelineStore
    );

    return {
        storage,
        pipelineStore,
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
        signalTracker,
        marketContextCollector,
    };
}

// Export for use
export { Config } from "./core/config.js";
export type { Dependencies } from "./types/dependencies.js";
