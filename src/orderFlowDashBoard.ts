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
import { SignalProcessingError } from "./core/errors.js";

// Infrastructure imports
import type { IMetricsCollector } from "./infrastructure/metricsCollectorInterface.js";

import {
    RecoveryManager,
    type HardReloadEvent,
} from "./infrastructure/recoveryManager.js";
import { ThreadManager } from "./multithreading/threadManager.js";

// Service imports
import {
    DetectorFactory,
    type DetectorDependencies,
} from "./utils/detectorFactory.js";
import type {
    EnrichedTradeEvent,
    OrderBookSnapshot,
} from "./types/marketEvents.js";
import { OrderflowPreprocessor } from "./market/orderFlowPreprocessor.js";
import { RedBlackTreeOrderBook } from "./market/redBlackTreeOrderBook.js";
import type { IOrderBookState } from "./market/orderBookState.js";
import { SignalManager } from "./trading/signalManager.js";
import { SignalCoordinator } from "./services/signalCoordinator.js";
import { AnomalyDetector, AnomalyEvent } from "./services/anomalyDetector.js";

// Enhanced Indicator imports
import { AbsorptionDetectorEnhanced } from "./indicators/absorptionDetectorEnhanced.js";
import { ExhaustionDetectorEnhanced } from "./indicators/exhaustionDetectorEnhanced.js";
import { DeltaCVDDetectorEnhanced } from "./indicators/deltaCVDDetectorEnhanced.js";
// Support/Resistance detector import removed - detector disabled
// import { SupportResistanceDetector } from "./indicators/supportResistanceDetector.js";

// Enhanced Zone-based Detector imports
import { AccumulationZoneDetectorEnhanced } from "./indicators/accumulationZoneDetectorEnhanced.js";
import { DistributionDetectorEnhanced } from "./indicators/distributionDetectorEnhanced.js";
import type {
    TradingZone,
    ZoneUpdate,
    ZoneSignal,
    ZoneAnalysisResult,
    IcebergZoneUpdate,
    HiddenOrderZoneUpdate,
    SpoofingZoneUpdate,
} from "./types/zoneTypes.js";

// Utils imports
import { TradeData } from "./utils/interfaces.js";

// Types
import type { Dependencies } from "./core/dependencies.js";
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
import {
    MarketDataStorageService,
    type DataStorageConfig,
} from "./services/marketDataStorageService.js";

import { ProductionUtils } from "./utils/productionUtils.js";

import type { WebSocketMessage } from "./utils/interfaces.js";
import { ILogger } from "./infrastructure/loggerInterface.js";

EventEmitter.defaultMaxListeners = 20;

/**
 * Main Order Flow Dashboard Controller
 * Coordinates all subsystems and manages application lifecycle
 */
export class OrderFlowDashboard {
    // Infrastructure components
    private readonly httpServer = express();
    private readonly logger: ILogger;
    private readonly metricsCollector: IMetricsCollector;
    private readonly recoveryManager: RecoveryManager;

    // Managers
    // WebSocketManager handled by communication worker
    private readonly threadManager: ThreadManager;
    private readonly signalManager: SignalManager;
    // DataStreamManager is handled by BinanceWorker in threaded mode

    // Market
    private orderBook!: IOrderBookState; // Initialized in initialize() method
    private preprocessor: OrderflowPreprocessor | null = null;

    // Coordinators
    private readonly signalCoordinator: SignalCoordinator;
    private readonly anomalyDetector: AnomalyDetector;

    // Market Data Storage for Backtesting
    private marketDataStorage?: MarketDataStorageService;

    // Event-based Detectors (initialized in initializeDetectors)
    private absorptionDetector!: AbsorptionDetectorEnhanced;
    private exhaustionDetector!: ExhaustionDetectorEnhanced;
    // Support/Resistance detector disabled - generating too many useless signals
    // private supportResistanceDetector!: SupportResistanceDetector;

    // Zone-based Detectors (initialized in initializeDetectors)
    private accumulationZoneDetector!: AccumulationZoneDetectorEnhanced;
    private distributionZoneDetector!: DistributionDetectorEnhanced;

    // Legacy detectors removed - replaced by zone-based architecture

    // Indicators (initialized in initializeDetectors)
    private deltaCVDConfirmation!: DeltaCVDDetectorEnhanced;

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
    // StatsBroadcaster handled by communication worker
    private broadcastMessage: (msg: WebSocketMessage) => void = () => {};
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
        try {
            this.orderBook = new RedBlackTreeOrderBook(
                Config.ORDERBOOK_STATE,
                dependencies.logger,
                dependencies.metricsCollector,
                this.threadManager
            );
            await this.orderBook.recover();
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

            // 🚨 CRITICAL FIX: Initialize detectors AFTER orderBook is ready
            this.initializeDetectors(dependencies);

            // Initialize market data storage for backtesting
            this.initializeMarketDataStorage();

            this.setupEventHandlers();
            this.setupHttpServer();
            this.setupGracefulShutdown();
            this.setupConnectionStatusMonitoring();
        } catch (error) {
            this.logger.error("[OrderFlowDashboard] Failed to initialize", {
                error: error instanceof Error ? error.message : String(error),
                stack: error instanceof Error ? error.stack : undefined,
            });
            throw error; // Re-throw to allow caller to handle initialization failure
        }
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
        this.threadManager = dependencies.threadManager;

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
            dependencies.logger,
            this.metricsCollector
        );

        // Initialize coordinators
        this.signalCoordinator = dependencies.signalCoordinator;
        this.anomalyDetector = dependencies.anomalyDetector;

        // Initialize managers
        this.broadcastMessage = (msg: WebSocketMessage): void => {
            this.threadManager.broadcast(msg);
        };

        // Set up backlog request handler for multithreaded mode
        this.threadManager.setBacklogRequestHandler(
            (clientId: string, amount: number) => {
                void this.handleBacklogRequest(clientId, amount);
            }
        );

        // Set up stream event handler for multithreaded mode
        this.threadManager.setStreamEventHandler(
            (eventType: string, data: unknown) => {
                this.handleWorkerStreamEvent(eventType, data);
            }
        );

        // Set up stream data handler for multithreaded mode
        this.threadManager.setStreamDataHandler(
            (dataType: string, data: unknown) => {
                this.handleWorkerStreamData(dataType, data).catch((err) =>
                    this.logger.error("threadManager.setStreamDataHandler", {
                        err,
                    })
                );
            }
        );

        this.signalManager = dependencies.signalManager;

        // Note: All detector initialization moved to initialize() method
        // to ensure proper dependency order (after orderBook is ready)
    }

    /**
     * Initialize market data storage for backtesting
     */
    private initializeMarketDataStorage(): void {
        try {
            const storageConfig = Config.marketDataStorage;
            if (!storageConfig) {
                this.logger.info(
                    "[OrderFlowDashboard] Market data storage not configured - skipping"
                );
                return;
            }

            const dataStorageConfig: DataStorageConfig = {
                enabled: storageConfig.enabled ?? false,
                dataDirectory:
                    storageConfig.dataDirectory ?? "./backtesting_data",
                format: storageConfig.format ?? "both",
                symbol: Config.SYMBOL,
                maxFileSize: storageConfig.maxFileSize ?? 100,
                depthLevels: storageConfig.depthLevels ?? 20,
                rotationHours: storageConfig.rotationHours ?? 6,
                compressionEnabled: storageConfig.compressionEnabled ?? false,
                monitoringInterval: storageConfig.monitoringInterval ?? 30,
            };

            this.marketDataStorage = new MarketDataStorageService(
                dataStorageConfig,
                this.logger,
                this.metricsCollector
            );

            if (dataStorageConfig.enabled) {
                this.marketDataStorage.start();
                this.logger.info(
                    "[OrderFlowDashboard] Market data storage initialized and started",
                    {
                        directory: dataStorageConfig.dataDirectory,
                        format: dataStorageConfig.format,
                        symbol: dataStorageConfig.symbol,
                        depthLevels: dataStorageConfig.depthLevels,
                    }
                );
            } else {
                this.logger.info(
                    "[OrderFlowDashboard] Market data storage is disabled"
                );
            }
        } catch (error) {
            this.logger.error(
                "[OrderFlowDashboard] Failed to initialize market data storage",
                {
                    error:
                        error instanceof Error ? error.message : String(error),
                }
            );
            // Don't throw - this is not critical for main functionality
        }
    }

    /**
     * Initialize all detectors after orderBook is ready
     */
    private initializeDetectors(dependencies: Dependencies): void {
        this.logger.info("[OrderFlowDashboard] Initializing detectors...");

        // Create DetectorDependencies with preprocessor for enhanced detectors
        if (!this.preprocessor) {
            throw new Error(
                "Preprocessor must be initialized before initializing detectors"
            );
        }

        const detectorDependencies: DetectorDependencies = {
            logger: dependencies.logger,
            spoofingDetector: dependencies.spoofingDetector,
            metricsCollector: dependencies.metricsCollector,
            signalLogger: dependencies.signalLogger,
            preprocessor: this.preprocessor,
        };

        DetectorFactory.initialize(detectorDependencies);

        // Absorption Detector - REQUIRES orderBook
        this.absorptionDetector = DetectorFactory.createAbsorptionDetector(
            this.orderBook, // Now guaranteed to be initialized
            detectorDependencies,
            { id: "ltcusdt-absorption-main" }
        );
        this.signalCoordinator.registerDetector(
            this.absorptionDetector,
            ["absorption"],
            20,
            true
        );

        // Exhaustion Detector
        this.exhaustionDetector = DetectorFactory.createExhaustionDetector(
            detectorDependencies,
            { id: "ltcusdt-exhaustion-main" }
        );
        this.signalCoordinator.registerDetector(
            this.exhaustionDetector,
            ["exhaustion"],
            100,
            true
        );

        // Delta CVD Confirmation Detector
        this.deltaCVDConfirmation =
            DetectorFactory.createDeltaCVDConfirmationDetector(
                detectorDependencies,
                {
                    id: "ltcusdt-cvdConfirmation-main",
                }
            );
        this.signalCoordinator.registerDetector(
            this.deltaCVDConfirmation,
            ["cvd_confirmation"],
            500,
            true
        );

        // Support/Resistance Detector - DISABLED: Generating too many useless signals
        // this.supportResistanceDetector =
        //     DetectorFactory.createSupportResistanceDetector(
        //         Config.SUPPORT_RESISTANCE_DETECTOR,
        //         dependencies,
        //         { id: "ltcusdt-support-resistance-main" }
        //     );
        // this.signalCoordinator.registerDetector(
        //     this.supportResistanceDetector,
        //     ["support_resistance_level"],
        //     10,
        //     true
        // );

        // Accumulation Zone Detector
        this.accumulationZoneDetector =
            DetectorFactory.createAccumulationDetector(detectorDependencies, {
                id: "ltcusdt-accumulation-zone-main",
            });
        this.signalCoordinator.registerDetector(
            this.accumulationZoneDetector,
            ["accumulation"],
            40,
            true
        );

        // Distribution Zone Detector
        this.distributionZoneDetector =
            DetectorFactory.createDistributionDetector(detectorDependencies, {
                id: "ltcusdt-distribution-zone-main",
            });
        this.signalCoordinator.registerDetector(
            this.distributionZoneDetector,
            ["distribution"],
            50,
            true
        );

        // Start signal coordinator
        void this.signalCoordinator.start();

        this.logger.info(
            "[OrderFlowDashboard] All detectors initialized successfully"
        );

        // Log detector status periodically
        setInterval(() => {
            const stats = DetectorFactory.getFactoryStats();
            this.logger.info("Factory stats:", { stats });
            const signalCoordinatorInfo =
                this.signalCoordinator.getDetectorInfo();
            this.logger.info("Detectors:", { signalCoordinatorInfo });
        }, 60000);

        // Setup cleanup on exit
        process.on("SIGINT", () => {
            DetectorFactory.destroyAll();
            void this.signalCoordinator.stop();
            process.exit(0);
        });
    }

    private DeltaCVDConfirmationCallback = (event: unknown): void => {
        void event; //todo
    };

    private async handleBacklogRequest(
        clientId: string,
        amount: number
    ): Promise<void> {
        try {
            this.logger.info(
                `Handling backlog request for client ${clientId}`,
                { amount }
            );

            // Get backlog data
            let backlog =
                await this.dependencies.tradesProcessor.requestBacklog(amount);
            backlog = backlog.reverse();

            // Get signal backlog
            const maxSignalBacklogAge = 90 * 60 * 1000; // 90 minutes
            const since = Math.max(
                backlog.length > 0 ? backlog[0].time : Date.now(),
                Date.now() - maxSignalBacklogAge
            );

            const signals = (await this.dependencies.threadManager.callStorage(
                "getRecentConfirmedSignals",
                since,
                100
            )) as ConfirmedSignal[];
            const deduplicatedSignals = this.deduplicateSignals(signals);

            this.logger.info(`Sending backlog to client ${clientId}`, {
                backlogCount: backlog.length,
                signalsCount: deduplicatedSignals.length,
            });

            // Send backlog to communication worker with client ID for isolation
            this.threadManager.sendBacklogToSpecificClient(
                clientId,
                backlog,
                deduplicatedSignals
            );
        } catch (error) {
            this.logger.error(
                `Error handling backlog request for client ${clientId}`,
                {
                    error:
                        error instanceof Error ? error.message : String(error),
                }
            );
        }
    }

    /**
     * Handle stream events from worker thread
     */
    private handleWorkerStreamEvent(eventType: string, data: unknown): void {
        try {
            switch (eventType) {
                case "connected":
                    this.logger.info(
                        "[OrderFlowDashboard] Data stream connected via worker"
                    );
                    this.dependencies.tradesProcessor.emit("stream_connected");

                    // Notify OrderBookState of stream connection
                    if (this.orderBook) {
                        this.orderBook.onStreamConnected();
                    }
                    break;
                case "disconnected":
                    const disconnectData = data as { reason: string };
                    this.logger.warn(
                        "[OrderFlowDashboard] Data stream disconnected via worker",
                        {
                            reason: disconnectData.reason,
                        }
                    );
                    this.dependencies.tradesProcessor.emit(
                        "stream_disconnected",
                        disconnectData
                    );

                    // Notify OrderBookState of stream disconnection
                    if (this.orderBook) {
                        this.orderBook.onStreamDisconnected(
                            disconnectData.reason
                        );
                    }
                    break;
                case "error":
                    const errorData = data as {
                        message: string;
                        stack?: string;
                    };
                    this.handleError(
                        new Error(errorData.message),
                        "worker_stream_error"
                    );
                    break;
                case "healthy":
                    this.logger.info(
                        "[OrderFlowDashboard] Data stream health restored via worker"
                    );
                    break;
                case "unhealthy":
                    this.logger.warn(
                        "[OrderFlowDashboard] Data stream health degraded via worker"
                    );
                    break;
                case "reconnecting":
                    const reconnectData = data as {
                        attempt: number;
                        delay: number;
                        maxAttempts: number;
                    };
                    this.logger.info(
                        "[OrderFlowDashboard] Data stream reconnecting via worker",
                        reconnectData
                    );
                    break;
                case "hardReloadRequired":
                    this.logger.error(
                        "[OrderFlowDashboard] Hard reload required via worker",
                        { data }
                    );
                    break;
                case "connectivityIssue":
                    if (this.lastTradePrice > 0) {
                        const issueData = data as { issue: ConnectivityIssue };
                        this.anomalyDetector.onConnectivityIssue(
                            issueData.issue,
                            this.lastTradePrice
                        );
                    }
                    break;
                default:
                    this.logger.warn(
                        `[OrderFlowDashboard] Unknown stream event type: ${eventType}`
                    );
            }
        } catch (error) {
            this.handleError(error as Error, "worker_stream_event_handler");
        }
    }

    /**
     * Handle stream data from worker thread
     */
    private async handleWorkerStreamData(
        dataType: string,
        data: unknown
    ): Promise<void> {
        try {
            switch (dataType) {
                case "trade":
                    await this.processTrade(
                        data as SpotWebsocketStreams.AggTradeResponse
                    );
                    break;
                case "depth":
                    this.processDepth(
                        data as SpotWebsocketStreams.DiffBookDepthResponse
                    );
                    break;
                default:
                    this.logger.warn(
                        `[OrderFlowDashboard] Unknown stream data type: ${dataType}`
                    );
            }
        } catch (error) {
            this.handleError(error as Error, "worker_stream_data_handler");
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

        // In threaded mode, stream events come from BinanceWorker via ThreadManager
        // No local DataStreamManager event handlers needed

        // Handle signal events
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
                this.logger.error("CRITICAL ANOMALY DETECTED", {
                    anomaly,
                    recommendedAction,
                    component: "SignalManager",
                });
                // Notify risk management, pause trading, etc.
            }
        );

        this.signalManager.on("emergencyPause", ({ reason, duration }) => {
            this.logger.error("EMERGENCY PAUSE ACTIVATED", {
                reason,
                duration,
                component: "SignalManager",
            });
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

                    // Store trade data for backtesting (if enabled)
                    if (this.marketDataStorage?.isActive()) {
                        this.marketDataStorage.storeTrade(enrichedTrade);
                    }

                    // Feed trade data to event-based detectors
                    this.absorptionDetector.onEnrichedTrade(enrichedTrade);
                    this.exhaustionDetector.onEnrichedTrade(enrichedTrade);
                    this.anomalyDetector.onEnrichedTrade(enrichedTrade);
                    this.deltaCVDConfirmation.onEnrichedTrade(enrichedTrade);

                    // Feed trade data to new advanced detectors
                    this.dependencies.icebergDetector.onEnrichedTrade(
                        enrichedTrade
                    );
                    this.dependencies.hiddenOrderDetector.onEnrichedTrade(
                        enrichedTrade
                    );
                    // Support/Resistance detector disabled
                    // this.supportResistanceDetector.onEnrichedTrade(
                    //     enrichedTrade
                    // );

                    // Enhanced zone-based detectors (standalone architecture)
                    this.accumulationZoneDetector.onEnrichedTrade(
                        enrichedTrade
                    );
                    this.distributionZoneDetector.onEnrichedTrade(
                        enrichedTrade
                    );

                    const aggTradeMessage: WebSocketMessage =
                        this.dependencies.tradesProcessor.onEnrichedTrade(
                            enrichedTrade
                        );
                    if (aggTradeMessage) {
                        this.broadcastMessage(aggTradeMessage);
                    }
                }
            );
            // Dashboard-specific orderbook updates with full snapshot for visualization
            this.preprocessor?.on(
                "dashboard_orderbook_update",
                (dashboardUpdate: OrderBookSnapshot) => {
                    // Store depth data for backtesting (if enabled)
                    if (this.marketDataStorage?.isActive()) {
                        // Convert depth snapshot map to bids/asks arrays
                        const bids: { price: number; quantity: number }[] = [];
                        const asks: { price: number; quantity: number }[] = [];

                        for (const [
                            price,
                            level,
                        ] of dashboardUpdate.depthSnapshot) {
                            if (level.bid > 0) {
                                bids.push({ price, quantity: level.bid });
                            }
                            if (level.ask > 0) {
                                asks.push({ price, quantity: level.ask });
                            }
                        }

                        // Sort bids highest to lowest, asks lowest to highest
                        bids.sort((a, b) => b.price - a.price);
                        asks.sort((a, b) => a.price - b.price);

                        this.marketDataStorage.storeDepthSnapshot(
                            bids,
                            asks,
                            dashboardUpdate.timestamp
                        );
                    }

                    const orderBookMessage: WebSocketMessage =
                        this.dependencies.orderBookProcessor.onOrderBookUpdate(
                            dashboardUpdate
                        );
                    if (orderBookMessage) {
                        this.broadcastMessage(orderBookMessage);
                    }
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
                this.broadcastMessage(message);
            });
        }

        // Support/Resistance detector event handlers disabled
        // if (this.supportResistanceDetector) {
        //     this.logger.info(
        //         "[OrderFlowDashboard] Setting up support/resistance detector event handlers..."
        //     );
        //     this.supportResistanceDetector.on(
        //         "supportResistanceLevel",
        //         (event: {
        //             type: string;
        //             data: Record<string, unknown>;
        //             timestamp: Date;
        //         }) => {
        //             const message: WebSocketMessage = {
        //                 type: "supportResistanceLevel",
        //                 data: event.data,
        //                 now: Date.now(),
        //             };
        //             this.broadcastMessage(message);
        //             this.logger.info(
        //                 "Support/Resistance level broadcasted via WebSocket",
        //                 {
        //                     levelId: event.data.id,
        //                     price: event.data.price,
        //                     type: event.data.type,
        //                 }
        //             );
        //         }
        //     );
        // }

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

        this.broadcastMessage(message);
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

        this.broadcastMessage(message);
    }

    /**
     * Setup event handlers for zone-based detectors
     */
    private setupZoneEventHandlers(): void {
        // Accumulation Zone Events
        this.accumulationZoneDetector.on(
            "zoneCreated",
            (...args: unknown[]) => {
                const zone = args[0] as TradingZone;
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
            (...args: unknown[]) => {
                const zone = args[0] as TradingZone;
                this.logger.info("Accumulation zone completed", {
                    zoneId: zone.id,
                    finalStrength: zone.strength.toFixed(3),
                    duration: zone.timeInZone,
                    totalVolume: zone.totalVolume,
                });
            }
        );

        // Distribution Zone Events
        this.distributionZoneDetector.on("zoneCreated", (zone: TradingZone) => {
            this.logger.info("Distribution zone created", {
                zoneId: zone.id,
                priceCenter: zone.priceRange.center,
                strength: zone.strength.toFixed(3),
                significance: zone.significance,
            });
        });

        this.distributionZoneDetector.on(
            "zoneCompleted",
            (zone: TradingZone) => {
                this.logger.info("Distribution zone completed", {
                    zoneId: zone.id,
                    finalStrength: zone.strength.toFixed(3),
                    duration: zone.timeInZone,
                    totalVolume: zone.totalVolume,
                });
            }
        );

        // Iceberg Detector Zone Events
        this.dependencies.icebergDetector.on(
            "zoneUpdated",
            (update: IcebergZoneUpdate) => {
                this.logger.info("Iceberg zone detected", {
                    component: "IcebergDetector",
                    zoneId: update.zone.id,
                    priceRange: update.zone.priceRange,
                    strength: update.zone.strength,
                    refillCount: update.zone.refillCount,
                    totalVolume: update.zone.totalVolume,
                });

                // Broadcast zone update to clients
                const message: WebSocketMessage = {
                    type: "zoneUpdate",
                    now: Date.now(),
                    data: {
                        updateType: update.updateType,
                        zone: {
                            id: update.zone.id,
                            type: update.zone.type,
                            priceRange: update.zone.priceRange,
                            strength: update.zone.strength,
                            completion: update.zone.completion,
                            startTime: update.zone.startTime,
                            endTime: update.zone.endTime,
                            totalVolume: update.zone.totalVolume,
                            refillCount: update.zone.refillCount,
                            side: update.zone.side,
                            institutionalScore: update.zone.institutionalScore,
                            priceStability: update.zone.priceStability,
                            avgRefillGap: update.zone.avgRefillGap,
                            temporalScore: update.zone.temporalScore,
                        },
                        significance: update.significance,
                    },
                };
                this.broadcastMessage(message);
            }
        );

        // Hidden Order Detector Zone Events
        this.dependencies.hiddenOrderDetector.on(
            "zoneUpdated",
            (update: HiddenOrderZoneUpdate) => {
                this.logger.info("Hidden order zone detected", {
                    component: "HiddenOrderDetector",
                    zoneId: update.zone.id,
                    priceRange: update.zone.priceRange,
                    strength: update.zone.strength,
                    stealthType: update.zone.stealthType,
                    totalVolume: update.zone.totalVolume,
                });

                // Broadcast zone update to clients
                const message: WebSocketMessage = {
                    type: "zoneUpdate",
                    now: Date.now(),
                    data: {
                        updateType: update.updateType,
                        zone: {
                            id: update.zone.id,
                            type: update.zone.type,
                            priceRange: update.zone.priceRange,
                            strength: update.zone.strength,
                            completion: update.zone.completion,
                            startTime: update.zone.startTime,
                            endTime: update.zone.endTime,
                            totalVolume: update.zone.totalVolume,
                            tradeCount: update.zone.tradeCount,
                            side: update.zone.side,
                            stealthType: update.zone.stealthType,
                            stealthScore: update.zone.stealthScore,
                        },
                        significance: update.significance,
                    },
                };
                this.broadcastMessage(message);
            }
        );

        // Spoofing Detector Zone Events
        this.dependencies.spoofingDetector.on(
            "zoneUpdated",
            (update: SpoofingZoneUpdate) => {
                this.logger.info("Spoofing zone detected", {
                    component: "SpoofingDetector",
                    zoneId: update.zone.id,
                    priceRange: update.zone.priceRange,
                    strength: update.zone.strength,
                    spoofType: update.zone.spoofType,
                    wallSize: update.zone.wallSize,
                });

                // Broadcast zone update to clients
                const message: WebSocketMessage = {
                    type: "zoneUpdate",
                    now: Date.now(),
                    data: {
                        updateType: update.updateType,
                        zone: {
                            id: update.zone.id,
                            type: update.zone.type,
                            priceRange: update.zone.priceRange,
                            strength: update.zone.strength,
                            completion: update.zone.completion,
                            startTime: update.zone.startTime,
                            endTime: update.zone.endTime,
                            spoofType: update.zone.spoofType,
                            wallSize: update.zone.wallSize,
                            canceled: update.zone.canceled,
                            executed: update.zone.executed,
                            side: update.zone.side,
                            confidence: update.zone.confidence,
                        },
                        significance: update.significance,
                    },
                };
                this.broadcastMessage(message);
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
                    connections: 0, // WebSocketManager handled by communication worker
                    circuitBreakerState:
                        this.dependencies.circuitBreaker.getState(),
                    dataStreamState: "threaded", // DataStreamManager handled by BinanceWorker
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
                    dataStream: null, // DataStreamManager handled by BinanceWorker
                    marketDataStorage:
                        this.marketDataStorage?.getStorageStats() || {
                            enabled: false,
                        },
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

        // Market data storage status and control endpoint
        this.httpServer.get("/market-data-storage", (req, res) => {
            const correlationId = randomUUID();
            try {
                if (!this.marketDataStorage) {
                    res.json({
                        status: "not_configured",
                        message: "Market data storage is not configured",
                        correlationId,
                    });
                    return;
                }

                const stats = this.marketDataStorage.getStorageStats();
                const config = this.marketDataStorage.getConfig();

                res.json({
                    status: "configured",
                    stats,
                    config,
                    correlationId,
                });
            } catch (error) {
                this.handleError(
                    error as Error,
                    "market_data_storage_endpoint",
                    correlationId
                );
                res.status(500).json({
                    status: "error",
                    error: (error as Error).message,
                    correlationId,
                });
            }
        });

        // Market data storage control endpoint
        this.httpServer.post("/market-data-storage/log-status", (req, res) => {
            const correlationId = randomUUID();
            try {
                if (!this.marketDataStorage) {
                    res.status(404).json({
                        status: "not_configured",
                        message: "Market data storage is not configured",
                        correlationId,
                    });
                    return;
                }

                this.marketDataStorage.logStatus();

                res.json({
                    status: "success",
                    message: "Storage status logged",
                    correlationId,
                });
            } catch (error) {
                this.handleError(
                    error as Error,
                    "market_data_storage_control_endpoint",
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
    private async processTrade(
        data: SpotWebsocketStreams.AggTradeResponse
    ): Promise<void> {
        const correlationId = randomUUID();
        const startTime = Date.now();

        try {
            // Store stream data to database (CRITICAL: prevents gaps on reload)
            await this.threadManager.callStorage(
                "saveAggregatedTrade",
                data,
                data.s || "LTCUSDT"
            );

            // Create simple trade object for broadcasting to WebSocket clients
            const tradeMessage = {
                type: "trade" as const,
                now: Date.now(),
                data: {
                    time: data.T || Date.now(),
                    price: parseFloat(data.p || "0"),
                    quantity: parseFloat(data.q || "0"),
                    orderType: data.m ? "SELL" : "BUY",
                    symbol: data.s || "LTCUSDT",
                    tradeId: data.a || 0,
                },
            };

            // Broadcast to WebSocket clients
            this.broadcastMessage(tradeMessage);

            // Update detectors
            if (this.preprocessor) void this.preprocessor.handleAggTrade(data);

            const processingTime = Date.now() - startTime;
            this.metricsCollector.updateMetric(
                "processingLatency",
                processingTime
            );
        } catch (error) {
            this.handleError(
                new SignalProcessingError(
                    "Error processing trade data",
                    { data, error: (error as Error).message },
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
            if (this.preprocessor) {
                this.preprocessor.handleDepth(data);
            }

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
            this.broadcastMessage({
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
            });
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

        if (error instanceof SignalProcessingError) {
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
    private gracefulShutdown(): void {
        this.logger.info(
            "[OrderFlowDashboard] Starting graceful shutdown for hard reload"
        );

        try {
            // Stop signal processing
            if (this.signalCoordinator) {
                // Signal coordinator doesn't have a stop method, but we can let pending signals finish
                this.logger.info(
                    "[OrderFlowDashboard] Allowing signal coordinator to finish pending signals"
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
    public async preloadHistoricalData(): Promise<void> {
        const correlationId = randomUUID();
        try {
            // 🚨 CRITICAL: Clear trade data first to eliminate gaps
            await this.dependencies.circuitBreaker.execute(() =>
                this.dependencies.tradesProcessor.clearTradeDataOnStartup()
            );

            // Load fresh 90 minutes of trade data
            await this.dependencies.circuitBreaker.execute(() =>
                this.dependencies.tradesProcessor.fillBacklog()
            );

            this.logger.info(
                "Historical data preloaded successfully",
                {},
                correlationId
            );
        } catch (error) {
            this.logger.error("WRONG!", { error });
            this.handleError(error as Error, "preload_data", correlationId);
            throw error;
        }
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

            // 🔧 FIX: Use 1.5 hours (90 minutes) retention instead of default 24 hours
            const retentionHours = 1.5; // Match Config.maxStorageTime (5400000ms = 90 minutes)

            this.threadManager
                .callStorage("purgeOldEntries", correlationId, retentionHours)
                .then((deletedCount) => {
                    this.logger.info("Scheduled purge completed successfully", {
                        deletedRecords: deletedCount,
                        retentionHours,
                        correlationId,
                    });

                    // 🔧 FIX: Run VACUUM after purge to reclaim disk space
                    if (deletedCount > 0) {
                        return this.threadManager.callStorage(
                            "vacuumDatabase",
                            correlationId
                        );
                    }
                })
                .then(() => {
                    // 🔧 FIX: Monitor database size after cleanup
                    return this.threadManager.callStorage(
                        "getDatabaseSize",
                        correlationId
                    );
                })
                .then((sizeInfo) => {
                    if (sizeInfo) {
                        const { sizeMB } = sizeInfo as {
                            sizeBytes: number;
                            sizeMB: number;
                        };

                        // Alert on database size thresholds
                        if (sizeMB > 200) {
                            this.logger.warn(
                                "Database size exceeds warning threshold",
                                {
                                    sizeMB,
                                    threshold: "200MB",
                                    correlationId,
                                }
                            );
                        } else if (sizeMB > 100) {
                            this.logger.info("Database size monitoring", {
                                sizeMB,
                                status: "normal",
                                correlationId,
                            });
                        }
                    }
                })
                .catch((error) => {
                    this.handleError(
                        error as Error,
                        "database_purge",
                        correlationId
                    );
                });
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
     * Setup connection status monitoring
     */
    private setupConnectionStatusMonitoring(): void {
        // Monitor connection status every 30 seconds
        setInterval(() => {
            if (this.isShuttingDown || !this.orderBook) return;

            //try {
            //const diagnostics = this.orderBook.getConnectionDiagnostics();

            // Log status if there's a mismatch
            //if (diagnostics.statusMismatch) {
            //    this.logger.warn(
            //        "[OrderFlowDashboard] Connection status mismatch detected",
            //        {
            //            orderBookStatus: diagnostics.orderBookStatus,
            //            workerStatus: diagnostics.cachedWorkerStatus,
            //        }
            //    );
            //}

            // Optionally broadcast connection status to dashboard
            //this.broadcastMessage({
            //    type: "connection_status",
            //    now: Date.now(),
            //    data: {
            //        orderBookConnected:
            //            diagnostics.orderBookStatus.isStreamConnected,
            //        workerConnected:
            //            diagnostics.cachedWorkerStatus?.isConnected,
            //        connectionState:
            //            diagnostics.cachedWorkerStatus?.connectionState,
            //        streamHealth:
            //            diagnostics.cachedWorkerStatus?.streamHealth,
            //        statusMismatch: diagnostics.statusMismatch,
            //        cacheAge: diagnostics.cachedWorkerStatus?.cacheAge,
            //    },
            //});
            //} catch (error) {
            //    this.logger.debug(
            //        "[OrderFlowDashboard] Error monitoring connection status",
            //        {
            //            error:
            //                error instanceof Error
            //                    ? error.message
            //                    : String(error),
            //        }
            //    );
            //}
        }, 30000); // Every 30 seconds
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

            // Stop market data storage
            if (this.marketDataStorage?.isActive()) {
                void this.marketDataStorage.stop();
            }

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

            // 🚨 CRITICAL FIX: Parallel execution to prevent data gaps
            // Stream and backfill MUST run simultaneously as per CLAUDE.md architecture
            this.logger.info(
                "Starting parallel data loading: live stream + 90min backfill",
                {},
                correlationId
            );

            await Promise.all([
                this.startStreamConnection(), // Live data stream
                this.preloadHistoricalData(), // 90-minute backfill
            ]);
            await this.startHttpServer();

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
