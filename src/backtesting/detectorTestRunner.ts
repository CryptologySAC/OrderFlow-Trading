// src/backtesting/detectorTestRunner.ts

import { EventEmitter } from "events";
import type { ILogger } from "../infrastructure/loggerInterface.js";
import type { IMetricsCollector } from "../infrastructure/metricsCollectorInterface.js";
import type { EnrichedTradeEvent } from "../types/marketEvents.js";
import type { SignalCandidate } from "../types/signalTypes.js";

import { MarketSimulator, type SimulatorConfig } from "./marketSimulator.js";
import {
    PerformanceAnalyzer,
    type DetectorSignal,
    type PriceMovement,
} from "./performanceAnalyzer.js";
import { type TestConfiguration } from "./configMatrix.js";

// Import detectors
import { HiddenOrderDetector } from "../services/hiddenOrderDetector.js";
import { IcebergDetector } from "../services/icebergDetector.js";
import { SpoofingDetector } from "../services/spoofingDetector.js";
import { AbsorptionDetector } from "../indicators/absorptionDetector.js";
import { ExhaustionDetector } from "../indicators/exhaustionDetector.js";
import { DeltaCVDConfirmation } from "../indicators/deltaCVDConfirmation.js";

// Import type definitions
import type { HiddenOrderDetectorConfig } from "../services/hiddenOrderDetector.js";
import type { IcebergDetectorConfig } from "../services/icebergDetector.js";
import type { SpoofingDetectorConfig } from "../services/spoofingDetector.js";
import type { AbsorptionSettings } from "../indicators/absorptionDetector.js";
import type { ExhaustionSettings } from "../indicators/exhaustionDetector.js";
import type { DeltaCVDConfirmationSettings } from "../indicators/deltaCVDConfirmation.js";

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

            // Create test execution
            const execution: TestExecution = {
                testId,
                config: testConfig,
                simulator,
                detector: detector,
                signals: [],
                startTime: Date.now(),
                promise: this.executeTest(testId, simulator, detector),
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
     * Execute a single test
     */
    private async executeTest(
        testId: string,
        simulator: MarketSimulator,
        detector: unknown
    ): Promise<TestResult> {
        const execution = this.runningTests.get(testId)!;
        const startTime = Date.now();

        try {
            // Set up event listeners
            let signalCount = 0;
            let movementCount = 0;

            simulator.on("enrichedTrade", (trade: EnrichedTradeEvent) => {
                // Process trade through detector
                try {
                    if (detector.onEnrichedTrade && typeof detector.onEnrichedTrade === 'function') {
                        detector.onEnrichedTrade(trade);
                    } else if (detector.detect && typeof detector.detect === 'function') {
                        detector.detect(trade);
                    }
                } catch (error) {
                    this.logger.warn("Error processing trade through detector", { testId, error });
                }
            });

            simulator.on("priceMovement", (movement: PriceMovement) => {
                movementCount++;
                this.performanceAnalyzer.recordPriceMovement(movement);
            });

            // Listen for detector signals
            if (detector.on && typeof detector.on === 'function') {
                try {
                    detector.on("signalCandidate", (signal: SignalCandidate) => {
                    signalCount++;
                    const detectorSignal: DetectorSignal = {
                        timestamp: signal.timestamp,
                        detectorType: testConfig.detectorType,
                        configId: testConfig.id,
                        side: signal.side === "neutral" ? "buy" : signal.side,
                        confidence: signal.confidence,
                        price: signal.data?.price || 0,
                        data: signal.data as unknown as Record<string, unknown>,
                    };

                        execution.signals.push(detectorSignal);
                        this.performanceAnalyzer.recordSignal(detectorSignal);
                    });
                } catch (error) {
                    this.logger.warn("Error setting up detector signal listener", { testId, error });
                }
            }

            // Run simulation
            simulator.start();

            // Wait for simulation to complete
            await new Promise<void>((resolve, reject) => {
                simulator.once("simulationCompleted", () => resolve());
                simulator.once("error", reject);

                // Add timeout to prevent hanging tests
                setTimeout(
                    () => {
                        reject(new Error("Test timeout"));
                    },
                    10 * 60 * 1000
                ); // 10 minute timeout
            });

            const endTime = Date.now();
            const result: TestResult = {
                configId: execution.config.id,
                detectorType: execution.config.detectorType,
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

            return {
                configId: execution.config.id,
                detectorType: execution.config.detectorType,
                startTime,
                endTime,
                duration: endTime - startTime,
                totalSignals: execution.signals.length,
                totalMovements: 0,
                success: false,
                error: errorMessage,
            };
        }
    }

    /**
     * Create detector instance based on configuration
     */
    private createDetector(testConfig: TestConfiguration): DetectorInstance {
        const mockLogger: ILogger = {
            info: () => {},
            warn: () => {},
            error: () => {},
            debug: () => {},
            isDebugEnabled: () => false,
            setCorrelationId: () => {},
            removeCorrelationId: () => {},
        };

        const mockMetrics: IMetricsCollector = {
            updateMetric: () => {},
            incrementMetric: () => {},
            getMetrics: () => ({ legacy: {}, enhanced: {} }),
            getHealthSummary: () => "Healthy",
            getAverageLatency: () => 0,
            createCounter: () => ({ increment: () => {}, get: () => 0 }),
            createHistogram: () => ({ observe: () => {}, get: () => ({}) }),
            createGauge: () => ({ set: () => {}, get: () => 0 }),
        };

        switch (testConfig.detectorType) {
            case "hiddenOrderDetector":
                return new HiddenOrderDetector(
                    testConfig.id,
                    testConfig.config as Partial<HiddenOrderDetectorConfig>,
                    mockLogger,
                    mockMetrics
                );

            case "icebergDetector":
                return new IcebergDetector(
                    testConfig.id,
                    testConfig.config as Partial<IcebergDetectorConfig>,
                    mockLogger,
                    mockMetrics
                );

            case "spoofingDetector":
                return new SpoofingDetector(
                    testConfig.config as SpoofingDetectorConfig,
                    mockLogger
                );

            case "absorptionDetector":
                return new AbsorptionDetector(
                    testConfig.id,
                    testConfig.config as AbsorptionSettings,
                    mockLogger,
                    mockMetrics,
                    {} as SpoofingDetector,
                    {} as IMetricsCollector
                );

            case "exhaustionDetector":
                return new ExhaustionDetector(
                    testConfig.id,
                    testConfig.config as ExhaustionSettings,
                    mockLogger,
                    mockMetrics,
                    {} as IMetricsCollector
                );

            case "deltaCVDDetector":
                const mockSpoofingDetector = {} as SpoofingDetector;
                return new DeltaCVDConfirmation(
                    testConfig.id,
                    testConfig.config as DeltaCVDConfirmationSettings,
                    mockLogger,
                    mockSpoofingDetector,
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

        const runningPromises = Array.from(this.runningTests.entries()).map(
            async ([testId, execution]) => {
                try {
                    const result = await execution.promise;
                    this.completedTests.set(testId, result);
                    this.runningTests.delete(testId);

                    this.emit("testCompleted", {
                        testId,
                        result,
                        duration: result.duration,
                    });
                } catch (error) {
                    this.logger.error("Test execution error", {
                        component: "DetectorTestRunner",
                        testId,
                        error:
                            error instanceof Error
                                ? error.message
                                : String(error),
                    });

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
        );

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
    public getPerformanceResults(): Map<string, PerformanceMetrics> {
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
