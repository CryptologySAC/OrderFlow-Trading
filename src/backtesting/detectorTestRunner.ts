// src/backtesting/detectorTestRunner.ts

import { EventEmitter } from "events";
import type { ILogger } from "../infrastructure/loggerInterface.js";
import type { IMetricsCollector } from "../infrastructure/metricsCollectorInterface.js";
import type { ISignalLogger } from "../infrastructure/signalLoggerInterface.js";
import type {
    HealthSummary,
    HistogramSummary,
    MetricMetadata,
} from "../infrastructure/metricsCollector.js";
import type { EnrichedTradeEvent } from "../types/marketEvents.js";
import type { SignalCandidate } from "../types/signalTypes.js";

import {
    MarketSimulator,
    type SimulatorConfig,
    type DepthDataPoint,
} from "./marketSimulator.js";
import {
    PerformanceAnalyzer,
    type DetectorSignal,
    type PriceMovement,
    type SignalPerformance,
} from "./performanceAnalyzer.js";
import { type TestConfiguration } from "./configMatrix.js";

// Import detectors
import { HiddenOrderDetector } from "../services/hiddenOrderDetector.js";
import { IcebergDetector } from "../services/icebergDetector.js";
import { SpoofingDetector } from "../services/spoofingDetector.js";
import { AbsorptionDetectorEnhanced } from "../indicators/absorptionDetectorEnhanced.js";
import { ExhaustionDetectorEnhanced } from "../indicators/exhaustionDetectorEnhanced.js";
import { DeltaCVDDetectorEnhanced } from "../indicators/deltaCVDDetectorEnhanced.js";

// Import type definitions
import type { HiddenOrderDetectorConfig } from "../services/hiddenOrderDetector.js";
import type { IcebergDetectorConfig } from "../services/icebergDetector.js";
import type { SpoofingDetectorConfig } from "../services/spoofingDetector.js";
import type { AbsorptionEnhancedSettings } from "../indicators/absorptionDetectorEnhanced.js";
import type { ExhaustionEnhancedSettings } from "../indicators/exhaustionDetectorEnhanced.js";
import type { DeltaCVDEnhancedSettings } from "../indicators/deltaCVDDetectorEnhanced.js";

// Import real production components for authentic testing
import { RedBlackTreeOrderBook } from "../market/redBlackTreeOrderBook.js";
import type { IOrderBookState } from "../market/orderBookState.js";
import { OrderflowPreprocessor } from "../market/orderFlowPreprocessor.js";
import type { SpotWebsocketStreams } from "@binance/spot";
import type { ThreadManager } from "../multithreading/threadManager.js";

// Generic detector interface for testing
interface DetectorInstance {
    onEnrichedTrade?: (trade: EnrichedTradeEvent) => void;
    detect?: (trade: EnrichedTradeEvent) => void;
    on?: (event: string, handler: (signal: SignalCandidate) => void) => void;
}

export interface TestRunnerConfig {
    dataDirectory: string;
    symbol: string;
    speedMultiplier: number;
    startDate?: string;
    endDate?: string;
    parallelTests: number;
    logLevel: "debug" | "info" | "warn" | "error";
}

export interface TestResult {
    configId: string;
    detectorType: string;
    startTime: number;
    endTime: number;
    duration: number;
    totalSignals: number;
    totalMovements: number;
    success: boolean;
    error?: string;
    performance?: unknown;
}

export interface TestProgress {
    completedTests: number;
    totalTests: number;
    currentTest?: string;
    progress: number;
    estimatedTimeRemaining: number;
    runningTests: string[];
}

/**
 * Detector Test Runner for Backtesting
 *
 * Orchestrates the testing of multiple detector configurations against
 * historical market data, managing parallel execution and collecting
 * performance metrics.
 */
export class DetectorTestRunner extends EventEmitter {
    private config: TestRunnerConfig;
    private logger: ILogger;
    private metricsCollector: IMetricsCollector;

    // Test execution state
    private runningTests = new Map<string, TestExecution>();
    private completedTests = new Map<string, TestResult>();
    private testQueue: TestConfiguration[] = [];
    private isRunning = false;
    private startTime = 0;

    // Performance tracking
    private performanceAnalyzer: PerformanceAnalyzer;

    // Real production components for authentic testing
    private realOrderBook?: IOrderBookState;
    private realSpoofingDetector?: SpoofingDetector;
    private preprocessor?: OrderflowPreprocessor;

    constructor(
        config: TestRunnerConfig,
        logger: ILogger,
        metricsCollector: IMetricsCollector
    ) {
        super();
        this.config = config;
        this.logger = logger;
        this.metricsCollector = metricsCollector;
        this.performanceAnalyzer = new PerformanceAnalyzer();

        // Initialize real production components for authentic testing
        this.initializeRealComponents();
    }

    /**
     * Initialize real production components instead of mocks
     */
    private initializeRealComponents(): void {
        try {
            // Create minimal ThreadManager mock for backtesting
            const mockThreadManager = {
                callStorage: <T>(): Promise<T> => Promise.resolve({} as T),
                broadcast: () => {},
                isInitialized: () => true,
                shutdown: () => Promise.resolve(),
                getWorkerStats: () => ({}),
                requestDepthSnapshot: () =>
                    Promise.resolve({
                        lastUpdateId: 0,
                        bids: [],
                        asks: [],
                    }),
            } as Partial<ThreadManager>;

            // Initialize RedBlackTreeOrderBook with production configuration
            // Performance optimized O(log n) operations for faster backtesting
            this.realOrderBook = new RedBlackTreeOrderBook(
                {
                    pricePrecision: 2, // LTCUSDT uses 2 decimal places
                    symbol: this.config.symbol,
                    maxLevels: 1000,
                    maxPriceDistance: 0.05, // 5% from mid price
                    pruneIntervalMs: 30000,
                    maxErrorRate: 1000, // Much higher tolerance for backtesting
                    staleThresholdMs: 5000,
                    disableSequenceValidation: true, // Disable for backtesting historical data
                },
                this.logger,
                this.metricsCollector,
                mockThreadManager as ThreadManager
            );

            // Note: orderBook.recover() will be called when testing starts

            // Initialize real SpoofingDetector with production configuration
            this.realSpoofingDetector = new SpoofingDetector(
                {
                    tickSize: 0.01, // LTCUSDT tick size
                    wallTicks: 5,
                    minWallSize: 10,
                    maxCancellationRatio: 0.8,
                    rapidCancellationMs: 500,
                    ghostLiquidityThresholdMs: 200,
                },
                this.logger
            );

            // Initialize OrderFlowPreprocessor for authentic EnrichedTradeEvent creation
            this.preprocessor = new OrderflowPreprocessor(
                {
                    symbol: this.config.symbol,
                    pricePrecision: 2,
                    quantityPrecision: 8,
                    bandTicks: 5,
                    tickSize: 0.01,
                    enableIndividualTrades: false, // Disabled for backtesting performance
                },
                this.realOrderBook,
                this.logger,
                this.metricsCollector
            );

            this.logger.info(
                "Real production components initialized for authentic backtesting",
                {
                    component: "DetectorTestRunner",
                    symbol: this.config.symbol,
                    orderBookInitialized: !!this.realOrderBook,
                    spoofingDetectorInitialized: !!this.realSpoofingDetector,
                    preprocessorInitialized: !!this.preprocessor,
                }
            );
        } catch (error) {
            const errorMessage =
                error instanceof Error ? error.message : String(error);
            this.logger.error(
                "Failed to initialize real production components",
                {
                    component: "DetectorTestRunner",
                    error: errorMessage,
                }
            );
            throw new Error(
                `Failed to initialize real production components: ${errorMessage}`
            );
        }
    }

    /**
     * Run tests for multiple configurations
     */
    public async runTests(
        configurations: TestConfiguration[]
    ): Promise<Map<string, TestResult>> {
        if (this.isRunning) {
            throw new Error("Test runner is already running");
        }

        this.isRunning = true;
        this.startTime = Date.now();
        this.testQueue = [...configurations];
        this.completedTests.clear();
        this.runningTests.clear();
        this.performanceAnalyzer.clear();

        this.logger.info("Starting detector backtesting", {
            component: "DetectorTestRunner",
            totalConfigurations: configurations.length,
            parallelTests: this.config.parallelTests,
            dataDirectory: this.config.dataDirectory,
        });

        this.emit("testingStarted", {
            totalTests: configurations.length,
            parallelTests: this.config.parallelTests,
        });

        try {
            // Process tests in parallel batches
            while (this.testQueue.length > 0 || this.runningTests.size > 0) {
                // Start new tests up to parallel limit
                while (
                    this.testQueue.length > 0 &&
                    this.runningTests.size < this.config.parallelTests
                ) {
                    const testConfig = this.testQueue.shift()!;
                    this.startTest(testConfig);
                }

                // Wait for any running test to complete
                if (this.runningTests.size > 0) {
                    await this.waitForAnyTestCompletion();
                }

                // Emit progress update
                this.emitProgress();
            }

            // Analyze final performance across all tests
            const finalResults = this.performanceAnalyzer.analyzePerformance();

            this.logger.info("Backtesting completed", {
                component: "DetectorTestRunner",
                totalTests: configurations.length,
                successfulTests: this.completedTests.size,
                duration: Date.now() - this.startTime,
            });

            this.emit("testingCompleted", {
                results: this.completedTests,
                performance: finalResults,
                duration: Date.now() - this.startTime,
            });

            return new Map(this.completedTests);
        } catch (error) {
            this.logger.error("Backtesting failed", {
                component: "DetectorTestRunner",
                error: error instanceof Error ? error.message : String(error),
            });

            this.emit("testingFailed", {
                error: error instanceof Error ? error.message : String(error),
                completedTests: this.completedTests.size,
                totalTests: configurations.length,
            });

            throw error;
        } finally {
            this.isRunning = false;
        }
    }

    /**
     * Start a test for a specific configuration
     */
    private startTest(testConfig: TestConfiguration): void {
        const testId = testConfig.id;

        this.logger.debug("Starting test", {
            component: "DetectorTestRunner",
            testId,
            detectorType: testConfig.detectorType,
            profile: testConfig.profile,
        });

        try {
            // Create simulator for this test
            const simulatorConfig: SimulatorConfig = {
                dataDirectory: this.config.dataDirectory,
                speedMultiplier: this.config.speedMultiplier,
                symbol: this.config.symbol,
                startDate: this.config.startDate,
                endDate: this.config.endDate,
            };

            const simulator = new MarketSimulator(simulatorConfig, this.logger);
            simulator.initialize();

            // Create detector instance
            const detector = this.createDetector(testConfig);

            // Create test execution with the execution context passed directly
            const execution: TestExecution = {
                testId,
                config: testConfig,
                simulator,
                detector: detector,
                signals: [],
                startTime: Date.now(),
                promise: Promise.resolve().then(() =>
                    this.executeTestWithContext(testConfig, simulator, detector)
                ),
            };

            this.runningTests.set(testId, execution);

            this.emit("testStarted", {
                testId,
                detectorType: testConfig.detectorType,
                configId: testConfig.id,
            });
        } catch (error) {
            this.logger.error("Failed to start test", {
                component: "DetectorTestRunner",
                testId,
                error: error instanceof Error ? error.message : String(error),
            });

            const result: TestResult = {
                configId: testConfig.id,
                detectorType: testConfig.detectorType,
                startTime: Date.now(),
                endTime: Date.now(),
                duration: 0,
                totalSignals: 0,
                totalMovements: 0,
                success: false,
                error: error instanceof Error ? error.message : String(error),
            };

            this.completedTests.set(testId, result);
        }
    }

    /**
     * Execute a single test with direct context (avoids race conditions)
     */
    private async executeTestWithContext(
        testConfig: TestConfiguration,
        simulator: MarketSimulator,
        detector: unknown
    ): Promise<TestResult> {
        const startTime = Date.now();
        const testId = testConfig.id;
        let signalCount = 0;
        let movementCount = 0;

        try {
            // Initialize order book with initial snapshot if not already done
            if (this.realOrderBook) {
                await this.realOrderBook.recover();
            }
            // Set up event listeners for authentic market data processing

            // Process depth events through real order book
            simulator.on("depthEvent", (depth: DepthDataPoint) => {
                try {
                    if (this.realOrderBook && this.preprocessor) {
                        // Convert depth event to Binance format for real order book
                        const binanceDepthUpdate = {
                            e: "depthUpdate",
                            E: depth.timestamp,
                            s: this.config.symbol,
                            U: depth.timestamp, // Using timestamp as update ID
                            u: depth.timestamp,
                            b:
                                depth.side === "bid"
                                    ? [
                                          [
                                              depth.price.toString(),
                                              depth.quantity.toString(),
                                          ],
                                      ]
                                    : [],
                            a:
                                depth.side === "ask"
                                    ? [
                                          [
                                              depth.price.toString(),
                                              depth.quantity.toString(),
                                          ],
                                      ]
                                    : [],
                        } as SpotWebsocketStreams.DiffBookDepthResponse;

                        this.realOrderBook.updateDepth(binanceDepthUpdate);
                    }
                } catch (error) {
                    this.logger.error("Error processing depth event", {
                        testId,
                        error:
                            error instanceof Error
                                ? error.message
                                : String(error),
                    });
                }
            });

            simulator.on("enrichedTrade", (trade: EnrichedTradeEvent) => {
                // Process trade through detector using authentic market data
                try {
                    // Validate trade data
                    if (
                        !trade ||
                        typeof trade.price !== "number" ||
                        typeof trade.quantity !== "number"
                    ) {
                        this.logger.warn("Invalid trade event received", {
                            testId,
                            trade,
                        });
                        return;
                    }

                    // Create authentic enriched trade event using real preprocessor
                    let authenticTradeEvent = trade;
                    if (this.preprocessor && this.realOrderBook) {
                        try {
                            // Use real order book data for depth snapshot
                            const depthSnapshot = this.realOrderBook.snapshot();
                            authenticTradeEvent = {
                                ...trade,
                                depthSnapshot,
                                bestBid: this.realOrderBook.getBestBid(),
                                bestAsk: this.realOrderBook.getBestAsk(),
                                // Update passive volumes using real order book
                                passiveBidVolume:
                                    this.getPassiveVolumeFromRealOrderBook(
                                        trade.price,
                                        "bid"
                                    ),
                                passiveAskVolume:
                                    this.getPassiveVolumeFromRealOrderBook(
                                        trade.price,
                                        "ask"
                                    ),
                                zonePassiveBidVolume:
                                    this.getZonePassiveVolumeFromRealOrderBook(
                                        trade.price,
                                        "bid"
                                    ),
                                zonePassiveAskVolume:
                                    this.getZonePassiveVolumeFromRealOrderBook(
                                        trade.price,
                                        "ask"
                                    ),
                            };
                        } catch (preprocessError) {
                            this.logger.warn(
                                "Error creating authentic trade event, using original",
                                {
                                    testId,
                                    error:
                                        preprocessError instanceof Error
                                            ? preprocessError.message
                                            : String(preprocessError),
                                }
                            );
                        }
                    }

                    // Process through detector
                    if (
                        (detector as DetectorInstance).onEnrichedTrade &&
                        typeof (detector as DetectorInstance)
                            .onEnrichedTrade === "function"
                    ) {
                        (detector as DetectorInstance).onEnrichedTrade!(
                            authenticTradeEvent
                        );
                    } else if (
                        (detector as DetectorInstance).detect &&
                        typeof (detector as DetectorInstance).detect ===
                            "function"
                    ) {
                        (detector as DetectorInstance).detect!(
                            authenticTradeEvent
                        );
                    }
                } catch (error) {
                    this.logger.error(
                        "Error processing trade through detector",
                        {
                            testId,
                            detectorType: testConfig.detectorType,
                            error:
                                error instanceof Error
                                    ? error.message
                                    : String(error),
                            stack:
                                error instanceof Error
                                    ? error.stack
                                    : undefined,
                        }
                    );
                    // Don't throw the error - just log it and continue
                }
            });

            simulator.on("priceMovement", (movement: PriceMovement) => {
                movementCount++;
                this.performanceAnalyzer.recordPriceMovement(movement);
            });

            // Listen for detector signals
            if (
                (detector as DetectorInstance).on &&
                typeof (detector as DetectorInstance).on === "function"
            ) {
                try {
                    (detector as DetectorInstance).on!(
                        "signalCandidate",
                        (signal: SignalCandidate) => {
                            signalCount++;
                            const detectorSignal: DetectorSignal = {
                                timestamp: signal.timestamp,
                                detectorType: testConfig.detectorType,
                                configId: testConfig.id,
                                side:
                                    signal.side === "neutral"
                                        ? "buy"
                                        : signal.side,
                                confidence: signal.confidence,
                                price: signal.data?.price || 0,
                                data: signal.data as unknown as Record<
                                    string,
                                    unknown
                                >,
                            };

                            // Store signals in execution object if it still exists
                            const execution = this.runningTests.get(testId);
                            if (execution) {
                                execution.signals.push(detectorSignal);
                            }
                            this.performanceAnalyzer.recordSignal(
                                detectorSignal
                            );
                        }
                    );
                } catch (error) {
                    this.logger.warn(
                        "Error setting up detector signal listener",
                        {
                            testId,
                            error:
                                error instanceof Error
                                    ? error.message
                                    : String(error),
                        }
                    );
                }
            }

            // Run simulation
            simulator.start();

            // Wait for simulation to complete
            await new Promise<void>((resolve, reject) => {
                simulator.once("simulationCompleted", () => {
                    // Clean up event listeners to prevent memory leaks
                    simulator.removeAllListeners();
                    resolve();
                });
                simulator.once("error", (error) => {
                    // Clean up event listeners on error
                    simulator.removeAllListeners();
                    reject(
                        error instanceof Error
                            ? error
                            : new Error(String(error))
                    );
                });

                // Add timeout to prevent hanging tests
                setTimeout(
                    () => {
                        simulator.removeAllListeners();
                        reject(new Error("Test timeout"));
                    },
                    10 * 60 * 1000
                ); // 10 minute timeout
            });

            const endTime = Date.now();
            const result: TestResult = {
                configId: testConfig.id,
                detectorType: testConfig.detectorType,
                startTime,
                endTime,
                duration: endTime - startTime,
                totalSignals: signalCount,
                totalMovements: movementCount,
                success: true,
            };

            this.logger.debug("Test completed successfully", {
                component: "DetectorTestRunner",
                testId,
                duration: result.duration,
                totalSignals: signalCount,
                totalMovements: movementCount,
            });

            // 🔧 MEMORY FIX: Comprehensive cleanup to prevent memory leaks

            // Stop and clean up simulator
            simulator.stop();
            if (typeof simulator.cleanup === "function") {
                simulator.cleanup();
            }

            // Memory cleanup - remove all detector listeners and clear references
            if (detector && typeof detector === "object") {
                if (
                    "removeAllListeners" in detector &&
                    typeof (detector as { removeAllListeners?: () => void })
                        .removeAllListeners === "function"
                ) {
                    (
                        detector as { removeAllListeners: () => void }
                    ).removeAllListeners();
                }

                // Additional cleanup for detectors with cleanup methods
                if (
                    "cleanup" in detector &&
                    typeof (detector as { cleanup?: () => void }).cleanup ===
                        "function"
                ) {
                    (detector as { cleanup: () => void }).cleanup();
                }
            }

            // Force garbage collection after every test to prevent memory accumulation
            if (global.gc) {
                global.gc();
            }

            this.logger.debug("Test memory cleanup completed", {
                component: "DetectorTestRunner",
                testId,
                memoryUsage: Math.round(
                    process.memoryUsage().heapUsed / 1024 / 1024
                ),
            });

            return result;
        } catch (error) {
            const endTime = Date.now();
            const errorMessage =
                error instanceof Error ? error.message : String(error);

            this.logger.error("Test execution failed", {
                component: "DetectorTestRunner",
                testId,
                error: errorMessage,
                duration: endTime - startTime,
            });

            // 🔧 MEMORY FIX: Critical cleanup on error to prevent memory leaks

            // Stop and clean up simulator
            try {
                simulator.stop();
                if (typeof simulator.cleanup === "function") {
                    simulator.cleanup();
                }
            } catch (cleanupError) {
                this.logger.warn("Error during simulator cleanup", {
                    component: "DetectorTestRunner",
                    testId,
                    error:
                        cleanupError instanceof Error
                            ? cleanupError.message
                            : String(cleanupError),
                });
            }

            // Memory cleanup on error - remove all listeners
            if (detector && typeof detector === "object") {
                if (
                    "removeAllListeners" in detector &&
                    typeof (detector as { removeAllListeners?: () => void })
                        .removeAllListeners === "function"
                ) {
                    (
                        detector as { removeAllListeners: () => void }
                    ).removeAllListeners();
                }

                // Additional cleanup for detectors with cleanup methods
                if (
                    "cleanup" in detector &&
                    typeof (detector as { cleanup?: () => void }).cleanup ===
                        "function"
                ) {
                    try {
                        (detector as { cleanup: () => void }).cleanup();
                    } catch (cleanupError) {
                        this.logger.warn("Error during detector cleanup", {
                            component: "DetectorTestRunner",
                            testId,
                            error:
                                cleanupError instanceof Error
                                    ? cleanupError.message
                                    : String(cleanupError),
                        });
                    }
                }
            }

            // Force garbage collection on error
            if (global.gc) {
                global.gc();
            }

            return {
                configId: testConfig.id,
                detectorType: testConfig.detectorType,
                startTime,
                endTime,
                duration: endTime - startTime,
                totalSignals: signalCount,
                totalMovements: 0,
                success: false,
                error: errorMessage,
            };
        }
    }

    /**
     * Get passive volume from real order book at specific price level
     */
    private getPassiveVolumeFromRealOrderBook(
        price: number,
        side: "bid" | "ask"
    ): number {
        if (!this.realOrderBook) return 0;

        try {
            const level = this.realOrderBook.getLevel(price);
            if (!level) return 0;
            return side === "bid" ? level.bid : level.ask;
        } catch {
            return 0;
        }
    }

    /**
     * Get zone passive volume from real order book in price zone around target price
     */
    private getZonePassiveVolumeFromRealOrderBook(
        price: number,
        side: "bid" | "ask"
    ): number {
        if (!this.realOrderBook) return 0;

        try {
            const tolerance = price * 0.001; // 0.1% zone
            const snapshot = this.realOrderBook.snapshot();
            let total = 0;

            for (const [levelPrice, level] of snapshot) {
                if (Math.abs(levelPrice - price) <= tolerance) {
                    total += side === "bid" ? level.bid : level.ask;
                }
            }

            return total;
        } catch {
            return 0;
        }
    }

    /**
     * Create detector instance based on configuration using real production components
     */
    private createDetector(testConfig: TestConfiguration): DetectorInstance {
        // Use real logger for authentic debugging (but keep it quiet)
        const realLogger: ILogger = {
            info: (msg, data) => {
                if (
                    this.config.logLevel === "debug" ||
                    this.config.logLevel === "info"
                ) {
                    this.logger.info(
                        `[${testConfig.detectorType}] ${msg}`,
                        data
                    );
                }
            },
            warn: (msg, data) => {
                if (
                    this.config.logLevel === "debug" ||
                    this.config.logLevel === "info" ||
                    this.config.logLevel === "warn"
                ) {
                    this.logger.warn(
                        `[${testConfig.detectorType}] ${msg}`,
                        data
                    );
                }
            },
            error: (msg, data) =>
                this.logger.error(`[${testConfig.detectorType}] ${msg}`, data),
            debug: (msg, data) => {
                if (this.config.logLevel === "debug") {
                    this.logger.debug(
                        `[${testConfig.detectorType}] ${msg}`,
                        data
                    );
                }
            },
            isDebugEnabled: () => this.config.logLevel === "debug",
            setCorrelationId: () => {},
            removeCorrelationId: () => {},
        };

        const mockMetrics: IMetricsCollector = {
            registerMetric: () => {},
            recordHistogram: () => {},
            getHistogramPercentiles: () => null,
            getHistogramSummary: () => null,
            recordGauge: () => {},
            getGaugeValue: () => null,
            createGauge: () => ({
                increment: () => {},
                decrement: () => {},
                set: () => {},
                get: () => 0,
            }),
            setGauge: () => {},
            incrementCounter: () => {},
            decrementCounter: () => {},
            getCounterRate: () => 0,
            createCounter: () => ({ increment: () => {}, get: () => 0 }),
            createHistogram: () => ({ observe: () => {}, reset: () => {} }),
            updateMetric: () => {},
            incrementMetric: () => {},
            getMetrics: () => ({
                legacy: {
                    signalsGenerated: 0,
                    connectionsActive: 0,
                    processingLatency: [],
                    errorsCount: 0,
                    circuitBreakerState: "closed",
                    uptime: 0,
                },
                enhanced: {
                    signalsGenerated: 0,
                    connectionsActive: 0,
                    processingLatency: [],
                    errorsCount: 0,
                    circuitBreakerState: "closed",
                    uptime: 0,
                },
                counters: {} as Record<
                    string,
                    { value: string; rate?: number; lastIncrement: number }
                >,
                gauges: {} as Record<string, number>,
                histograms: {} as Record<string, HistogramSummary | null>,
                metadata: {} as Record<string, MetricMetadata>,
            }),
            getAverageLatency: () => 0,
            getLatencyPercentiles: () => ({}),
            exportPrometheus: () => "",
            exportJSON: () => "",
            getHealthSummary: (): HealthSummary =>
                ({
                    status: "healthy",
                    details: {},
                    healthy: true,
                    uptime: 0,
                    errorRate: 0,
                    avgLatency: 0,
                    memoryUsage: 0,
                    cpuUsage: 0,
                    activeConnections: 0,
                }) as unknown as HealthSummary,
            reset: () => {},
            cleanup: () => {},
        };

        const mockSignalLogger: ISignalLogger = {
            logEvent: () => {},
            logProcessedSignal: () => {},
            logProcessingError: () => {},
        };

        switch (testConfig.detectorType) {
            case "hiddenOrderDetector":
                return new HiddenOrderDetector(
                    testConfig.id,
                    testConfig.config as Partial<HiddenOrderDetectorConfig>,
                    realLogger,
                    mockMetrics
                );

            case "icebergDetector":
                return new IcebergDetector(
                    testConfig.id,
                    testConfig.config as Partial<IcebergDetectorConfig>,
                    realLogger,
                    mockMetrics
                );

            case "spoofingDetector": {
                const spoofingConfig =
                    testConfig.config as Partial<SpoofingDetectorConfig>;
                const fullConfig: SpoofingDetectorConfig = {
                    tickSize: 0.01,
                    wallTicks: 5,
                    minWallSize: 10,
                    ...spoofingConfig,
                };
                return new SpoofingDetector(fullConfig, realLogger);
            }

            case "absorptionDetector": {
                // Use real production components for authentic testing
                if (!this.realOrderBook) {
                    throw new Error(
                        "Real OrderBookState not initialized for AbsorptionDetector testing"
                    );
                }
                if (!this.realSpoofingDetector) {
                    throw new Error(
                        "Real SpoofingDetector not initialized for AbsorptionDetector testing"
                    );
                }

                return new AbsorptionDetectorEnhanced(
                    testConfig.id,
                    testConfig.config as unknown as AbsorptionEnhancedSettings,
                    this.realOrderBook, // Use real order book with authentic market data
                    realLogger,
                    this.realSpoofingDetector, // Use real spoofing detector
                    mockMetrics // Keep simplified metrics for performance
                );
            }

            case "exhaustionDetector": {
                // Use real spoofing detector for authentic testing
                if (!this.realSpoofingDetector) {
                    throw new Error(
                        "Real SpoofingDetector not initialized for ExhaustionDetectorEnhanced testing"
                    );
                }

                return new ExhaustionDetectorEnhanced(
                    testConfig.id,
                    testConfig.config as unknown as ExhaustionEnhancedSettings,
                    realLogger,
                    this.realSpoofingDetector, // Use real spoofing detector
                    mockMetrics,
                    mockSignalLogger
                );
            }

            case "deltaCVDDetector":
                // Use real spoofing detector for authentic DeltaCVD testing
                if (!this.realSpoofingDetector) {
                    throw new Error(
                        "Real SpoofingDetector not initialized for DeltaCVDDetectorEnhanced testing"
                    );
                }

                return new DeltaCVDDetectorEnhanced(
                    testConfig.id,
                    testConfig.config as unknown as DeltaCVDEnhancedSettings,
                    realLogger,
                    this.realSpoofingDetector, // Use real spoofing detector with actual config
                    mockMetrics
                );

            default:
                throw new Error(
                    `Unsupported detector type: ${testConfig.detectorType}`
                );
        }
    }

    /**
     * Wait for any running test to complete
     */
    private async waitForAnyTestCompletion(): Promise<void> {
        if (this.runningTests.size === 0) {
            return;
        }

        // Create a copy of the current running tests to avoid modification during iteration
        const testEntries = Array.from(this.runningTests.entries());

        const runningPromises = testEntries.map(async ([testId, execution]) => {
            try {
                const result = await execution.promise;

                // Only update if the test is still in running state (avoid double processing)
                if (this.runningTests.has(testId)) {
                    this.completedTests.set(testId, result);
                    this.runningTests.delete(testId);

                    this.emit("testCompleted", {
                        testId,
                        result,
                        duration: result.duration,
                    });
                }
            } catch (error) {
                this.logger.error("Test execution error", {
                    component: "DetectorTestRunner",
                    testId,
                    error:
                        error instanceof Error ? error.message : String(error),
                });

                // Only process error if test is still running (avoid double processing)
                if (this.runningTests.has(testId)) {
                    const result: TestResult = {
                        configId: execution.config.id,
                        detectorType: execution.config.detectorType,
                        startTime: execution.startTime,
                        endTime: Date.now(),
                        duration: Date.now() - execution.startTime,
                        totalSignals: execution.signals.length,
                        totalMovements: 0,
                        success: false,
                        error:
                            error instanceof Error
                                ? error.message
                                : String(error),
                    };

                    this.completedTests.set(testId, result);
                    this.runningTests.delete(testId);

                    this.emit("testFailed", {
                        testId,
                        error: result.error,
                        duration: result.duration,
                    });
                }
            }
        });

        // Wait for the first test to complete
        await Promise.race(runningPromises);
    }

    /**
     * Emit progress update
     */
    private emitProgress(): void {
        const totalTests =
            this.completedTests.size +
            this.runningTests.size +
            this.testQueue.length;
        const completedTests = this.completedTests.size;
        const progress = totalTests > 0 ? completedTests / totalTests : 0;

        // Estimate remaining time based on average test duration
        const avgDuration = this.calculateAverageTestDuration();
        const remainingTests = this.runningTests.size + this.testQueue.length;
        const estimatedTimeRemaining = avgDuration * remainingTests;

        const progressInfo: TestProgress = {
            completedTests,
            totalTests,
            progress: progress * 100,
            estimatedTimeRemaining,
            runningTests: Array.from(this.runningTests.keys()),
        };

        this.emit("progress", progressInfo);
    }

    /**
     * Calculate average test duration for time estimation
     */
    private calculateAverageTestDuration(): number {
        const durations = Array.from(this.completedTests.values()).map(
            (result) => result.duration
        );

        if (durations.length === 0) {
            return 60000; // Default 1 minute estimate
        }

        return (
            durations.reduce((sum, duration) => sum + duration, 0) /
            durations.length
        );
    }

    /**
     * Stop all running tests
     */
    public stop(): void {
        this.logger.info("Stopping test runner", {
            component: "DetectorTestRunner",
            runningTests: this.runningTests.size,
            queuedTests: this.testQueue.length,
        });

        // Clear queue
        this.testQueue = [];

        // Stop running tests (simulators should handle cleanup)
        for (const [testId, execution] of this.runningTests) {
            try {
                execution.simulator.stop();
            } catch (error) {
                this.logger.warn("Error stopping test", {
                    component: "DetectorTestRunner",
                    testId,
                    error:
                        error instanceof Error ? error.message : String(error),
                });
            }
        }

        this.isRunning = false;
        this.emit("testingStopped");
    }

    /**
     * Get current test results
     */
    public getResults(): Map<string, TestResult> {
        return new Map(this.completedTests);
    }

    /**
     * Get performance analysis results
     */
    public getPerformanceResults(): Map<string, SignalPerformance> {
        return this.performanceAnalyzer.getAllPerformanceResults();
    }

    /**
     * Get test progress information
     */
    public getProgress(): TestProgress {
        const totalTests =
            this.completedTests.size +
            this.runningTests.size +
            this.testQueue.length;
        const completedTests = this.completedTests.size;
        const progress = totalTests > 0 ? completedTests / totalTests : 0;
        const avgDuration = this.calculateAverageTestDuration();
        const remainingTests = this.runningTests.size + this.testQueue.length;

        return {
            completedTests,
            totalTests,
            progress: progress * 100,
            estimatedTimeRemaining: avgDuration * remainingTests,
            runningTests: Array.from(this.runningTests.keys()),
        };
    }
}

interface TestExecution {
    testId: string;
    config: TestConfiguration;
    simulator: MarketSimulator;
    detector: unknown;
    signals: DetectorSignal[];
    startTime: number;
    promise: Promise<TestResult>;
}
