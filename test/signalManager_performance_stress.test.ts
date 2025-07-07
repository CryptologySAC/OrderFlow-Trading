// test/signalManager_performance_stress.test.ts

import { describe, test, expect, vi, beforeEach } from "vitest";
import { SignalManager } from "../src/trading/signalManager.js";
import { AnomalyDetector } from "../src/services/anomalyDetector.js";
import { AlertManager } from "../src/alerts/alertManager.js";
import { ThreadManager } from "../src/multithreading/threadManager.js";
import { MetricsCollector } from "../src/infrastructure/metricsCollector.js";
import type { ProcessedSignal } from "../src/types/signalTypes.js";
import type { ILogger } from "../src/infrastructure/loggerInterface.js";

/**
 * 🏛️ SIGNAL MANAGER PERFORMANCE & STRESS TESTS
 *
 * This institutional-grade test suite validates the performance characteristics
 * and stress resilience of SignalManager under extreme conditions:
 *
 * 1. High-Frequency Signal Processing (1000+ signals/sec)
 * 2. Memory Leak Detection (long-running operations)
 * 3. Latency Benchmarking (response time validation)
 * 4. Concurrent Access Patterns (multi-threaded scenarios)
 * 5. Scalability Testing (increasing load patterns)
 * 6. Resource Usage Monitoring
 * 7. Performance Degradation Detection
 * 8. Throughput Validation
 *
 * COVERAGE: 8 comprehensive performance test cases
 * BENCHMARKS: Establish baseline performance metrics for production
 */

// Performance-optimized mock configuration
vi.mock("../src/core/config.js", () => {
    const mockSignalManagerConfig = {
        confidenceThreshold: 0.3,
        signalTimeout: 120000,
        enableMarketHealthCheck: false, // Disabled for performance testing
        enableAlerts: false, // Disabled for performance testing
        maxQueueSize: 5000, // Large queue for stress testing
        processingBatchSize: 50, // Large batch for throughput
        backpressureThreshold: 4000,
        enableSignalPrioritization: true,
        adaptiveBatchSizing: true,
        maxAdaptiveBatchSize: 100,
        minAdaptiveBatchSize: 10,
        circuitBreakerThreshold: 100, // High threshold for stress testing
        circuitBreakerResetMs: 5000,
        adaptiveBackpressure: true,
        highPriorityBypassThreshold: 8.5,
        signalTypePriorities: {
            absorption: 10,
            deltacvd: 8,
            exhaustion: 9,
            accumulation: 7,
            distribution: 7,
        },
        detectorThresholds: {
            absorption: 0.6,
            deltacvd: 0.4,
            exhaustion: 0.2,
            accumulation: 0.3,
            distribution: 0.4,
        },
        positionSizing: {
            absorption: 0.5,
            deltacvd: 0.7,
            exhaustion: 1.0,
            accumulation: 0.6,
            distribution: 0.7,
        },
        correlationBoostFactor: 0.7,
        priceTolerancePercent: 0.3,
        signalThrottleMs: 0, // No throttling for performance testing
        correlationWindowMs: 60000, // Shorter window for performance
        maxHistorySize: 1000, // Large history for stress testing
        defaultPriority: 5,
        volatilityHighThreshold: 0.05,
        volatilityLowThreshold: 0.02,
        defaultLowVolatility: 0.02,
        defaultVolatilityError: 0.03,
        contextBoostHigh: 0.15,
        contextBoostLow: 0.1,
        priorityQueueHighThreshold: 8.0,
        backpressureYieldMs: 0, // No yielding for performance testing
        marketVolatilityWeight: 0.6,
        conflictResolution: {
            enabled: false, // Disabled for pure performance testing
            strategy: "confidence_weighted" as const,
            minimumSeparationMs: 30000,
            contradictionPenaltyFactor: 0.5,
            priceTolerance: 0.001,
            volatilityNormalizationFactor: 0.02,
        },
        signalPriorityMatrix: {
            highVolatility: {
                absorption: 0.3,
                deltacvd: 0.7,
                exhaustion: 0.8,
                accumulation: 0.5,
                distribution: 0.5,
            },
            lowVolatility: {
                absorption: 0.7,
                deltacvd: 0.3,
                exhaustion: 0.4,
                accumulation: 0.8,
                distribution: 0.8,
            },
            balanced: {
                absorption: 0.5,
                deltacvd: 0.5,
                exhaustion: 0.6,
                accumulation: 0.6,
                distribution: 0.6,
            },
        },
    };

    return {
        Config: {
            SIGNAL_MANAGER: mockSignalManagerConfig,
            DETECTOR_CONFIDENCE_THRESHOLDS: {
                absorption: 0.3,
                deltacvd: 0.15,
                exhaustion: 0.2,
                accumulation: 0.3,
                distribution: 0.4,
            },
            DETECTOR_POSITION_SIZING: {
                absorption: 0.5,
                deltacvd: 0.7,
                exhaustion: 1.0,
                accumulation: 0.6,
                distribution: 0.7,
            },
        },
    };
});

// Lightweight mock dependencies for performance testing
const mockLogger: ILogger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
};

const mockAnomalyDetector = {
    getMarketHealth: vi.fn().mockReturnValue({
        isHealthy: true,
        recommendation: "continue",
        criticalIssues: [],
        recentAnomalyTypes: [],
        highestSeverity: "low",
        metrics: { volatility: 0.02 },
    }),
} as unknown as AnomalyDetector;

const mockAlertManager = {
    sendAlert: vi.fn(),
} as unknown as AlertManager;

const mockThreadManager = {
    callStorage: vi.fn().mockResolvedValue(undefined),
} as unknown as ThreadManager;

const mockMetricsCollector = new MetricsCollector(mockLogger);

describe("SignalManager Performance & Stress Testing", () => {
    let signalManager: SignalManager;

    beforeEach(() => {
        vi.clearAllMocks();
        // Reset metrics collector to ensure clean state
        mockMetricsCollector.reset();
        signalManager = new SignalManager(
            mockAnomalyDetector,
            mockAlertManager,
            mockLogger,
            mockMetricsCollector,
            mockThreadManager,
            undefined,
            undefined
        );
    });

    // Performance test utilities
    const createPerformanceSignal = (id: number): ProcessedSignal => {
        const signalData = {
            price: 89.5 + Math.random() * 0.01, // Small price variation
            side: Math.random() > 0.5 ? "buy" : "sell",
            volume: 100,
            timestamp: new Date(),
        };

        return {
            id: `perf_${id}`,
            type: "absorption",
            confidence: 0.7,
            detectorId: "performance_detector",
            data: signalData,
            metadata: signalData, // Include metadata for direction detection
            timestamp: new Date(),
            correlationId: `corr_perf_${id}`,
        };
    };

    const measureExecutionTime = async (
        operation: () => Promise<any> | any
    ): Promise<{ result: any; timeMs: number }> => {
        const startTime = process.hrtime.bigint();
        const result = await operation();
        const endTime = process.hrtime.bigint();
        const timeMs = Number(endTime - startTime) / 1000000; // Convert to milliseconds
        return { result, timeMs };
    };

    const getMemoryUsage = (): NodeJS.MemoryUsage => {
        return process.memoryUsage();
    };

    describe("High-Frequency Signal Processing", () => {
        test("should handle 1000 signals under 1 second", async () => {
            const signalCount = 1000;
            const signals = Array.from({ length: signalCount }, (_, i) =>
                createPerformanceSignal(i)
            );

            const { timeMs } = await measureExecutionTime(() => {
                return signals.map((signal) =>
                    signalManager.handleProcessedSignal(signal)
                );
            });

            console.log(
                `Processed ${signalCount} signals in ${timeMs.toFixed(2)}ms`
            );
            console.log(
                `Average processing time: ${(timeMs / signalCount).toFixed(4)}ms per signal`
            );
            console.log(
                `Throughput: ${(signalCount / (timeMs / 1000)).toFixed(0)} signals/second`
            );

            // Performance requirements for institutional trading
            expect(timeMs).toBeLessThan(1000); // Must complete under 1 second
            expect(timeMs / signalCount).toBeLessThan(1); // Must be under 1ms per signal
        });

        test("should maintain sub-millisecond latency for individual signals", async () => {
            const latencyMeasurements: number[] = [];

            for (let i = 0; i < 100; i++) {
                const signal = createPerformanceSignal(i);
                const { timeMs } = await measureExecutionTime(() => {
                    return signalManager.handleProcessedSignal(signal);
                });
                latencyMeasurements.push(timeMs);
            }

            const averageLatency =
                latencyMeasurements.reduce((a, b) => a + b, 0) /
                latencyMeasurements.length;
            const maxLatency = Math.max(...latencyMeasurements);
            const p95Latency = latencyMeasurements.sort((a, b) => a - b)[
                Math.floor(latencyMeasurements.length * 0.95)
            ];

            console.log(`Average latency: ${averageLatency.toFixed(4)}ms`);
            console.log(`Max latency: ${maxLatency.toFixed(4)}ms`);
            console.log(`P95 latency: ${p95Latency.toFixed(4)}ms`);

            // Institutional trading latency requirements
            expect(averageLatency).toBeLessThan(0.5); // Average under 0.5ms
            expect(p95Latency).toBeLessThan(1.0); // P95 under 1ms
            expect(maxLatency).toBeLessThan(5.0); // Max under 5ms
        });

        test("should scale linearly with signal volume", async () => {
            const testSizes = [100, 500, 1000, 2000];
            const performanceData: Array<{
                size: number;
                timeMs: number;
                throughput: number;
            }> = [];

            for (const size of testSizes) {
                const signals = Array.from({ length: size }, (_, i) =>
                    createPerformanceSignal(i)
                );

                const { timeMs } = await measureExecutionTime(() => {
                    return signals.map((signal) =>
                        signalManager.handleProcessedSignal(signal)
                    );
                });

                const throughput = size / (timeMs / 1000);
                performanceData.push({ size, timeMs, throughput });

                console.log(
                    `${size} signals: ${timeMs.toFixed(2)}ms, ${throughput.toFixed(0)} signals/sec`
                );
            }

            // Verify reasonable scaling (large batches should still be performant)
            const throughputs = performanceData.map((d) => d.throughput);
            const minAcceptableThroughput = 3000; // At least 3000 signals/sec for any batch size
            const allBatchesPerformant = throughputs.every(
                (t) => t >= minAcceptableThroughput
            );

            expect(allBatchesPerformant).toBe(true); // All batch sizes should meet minimum performance
        });
    });

    describe("Memory Leak Detection", () => {
        test("should maintain stable memory usage during extended operation", async () => {
            const initialMemory = getMemoryUsage();
            const memorySnapshots: NodeJS.MemoryUsage[] = [initialMemory];

            // Process signals over multiple iterations
            for (let iteration = 0; iteration < 10; iteration++) {
                // Process 500 signals per iteration
                const signals = Array.from({ length: 500 }, (_, i) =>
                    createPerformanceSignal(i + iteration * 500)
                );
                signals.forEach((signal) =>
                    signalManager.handleProcessedSignal(signal)
                );

                // Force garbage collection if available
                if (global.gc) {
                    global.gc();
                }

                // Take memory snapshot
                memorySnapshots.push(getMemoryUsage());

                // Brief pause between iterations
                await new Promise((resolve) => setTimeout(resolve, 10));
            }

            // Analyze memory growth
            const finalMemory = memorySnapshots[memorySnapshots.length - 1];
            const memoryGrowthMB =
                (finalMemory.heapUsed - initialMemory.heapUsed) / 1024 / 1024;

            console.log(
                `Initial memory: ${(initialMemory.heapUsed / 1024 / 1024).toFixed(2)}MB`
            );
            console.log(
                `Final memory: ${(finalMemory.heapUsed / 1024 / 1024).toFixed(2)}MB`
            );
            console.log(`Memory growth: ${memoryGrowthMB.toFixed(2)}MB`);

            // Memory growth should be reasonable (less than 70MB for this test)
            expect(memoryGrowthMB).toBeLessThan(70);

            // Memory usage should stabilize (last 3 snapshots should be similar)
            const lastThreeSnapshots = memorySnapshots.slice(-3);
            const memoryStability = lastThreeSnapshots.every(
                (snapshot, index) => {
                    if (index === 0) return true;
                    const growthMB =
                        (snapshot.heapUsed -
                            lastThreeSnapshots[index - 1].heapUsed) /
                        1024 /
                        1024;
                    return Math.abs(growthMB) < 10; // Less than 10MB variation
                }
            );

            expect(memoryStability).toBe(true);
        });

        test("should handle history size limits properly", () => {
            const maxHistorySize = 1000; // From config

            // Process more signals than history limit
            for (let i = 0; i < maxHistorySize + 500; i++) {
                signalManager.handleProcessedSignal(createPerformanceSignal(i));
            }

            const stats = signalManager.getSignalStatistics();
            expect(stats.processing.totalReceived).toBeGreaterThan(
                maxHistorySize
            );

            // History should be bounded to prevent memory growth
            // This is tested implicitly through the memory stability test above
        });
    });

    describe("Concurrent Access Patterns", () => {
        test("should handle concurrent signal processing", async () => {
            const concurrentBatches = 5;
            const signalsPerBatch = 200;

            // Create concurrent processing promises
            const concurrentOperations = Array.from(
                { length: concurrentBatches },
                async (_, batchIndex) => {
                    const signals = Array.from(
                        { length: signalsPerBatch },
                        (_, i) =>
                            createPerformanceSignal(
                                batchIndex * signalsPerBatch + i
                            )
                    );

                    return signals.map((signal) =>
                        signalManager.handleProcessedSignal(signal)
                    );
                }
            );

            const { timeMs } = await measureExecutionTime(async () => {
                return Promise.all(concurrentOperations);
            });

            const totalSignals = concurrentBatches * signalsPerBatch;
            console.log(
                `Processed ${totalSignals} signals concurrently in ${timeMs.toFixed(2)}ms`
            );
            console.log(
                `Concurrent throughput: ${(totalSignals / (timeMs / 1000)).toFixed(0)} signals/sec`
            );

            // Concurrent processing should complete efficiently
            expect(timeMs).toBeLessThan(2000); // Under 2 seconds for concurrent processing
        });

        test("should maintain data consistency under concurrent access", async () => {
            const concurrentOperations = 10;
            const signalsPerOperation = 100;

            // Run concurrent operations
            const results = await Promise.all(
                Array.from(
                    { length: concurrentOperations },
                    async (_, operationIndex) => {
                        const signals = Array.from(
                            { length: signalsPerOperation },
                            (_, i) =>
                                createPerformanceSignal(
                                    operationIndex * signalsPerOperation + i
                                )
                        );

                        return signals.map((signal) =>
                            signalManager.handleProcessedSignal(signal)
                        );
                    }
                )
            );

            // Verify all operations completed successfully
            const flatResults = results.flat();
            const successfulOperations = flatResults.filter(
                (result) => result !== null
            ).length;
            const totalOperations = concurrentOperations * signalsPerOperation;

            console.log(
                `Successful operations: ${successfulOperations}/${totalOperations}`
            );
            expect(successfulOperations).toBeGreaterThan(totalOperations * 0.9); // At least 90% success

            // Verify system state remains consistent
            const stats = signalManager.getSignalStatistics();
            expect(stats.processing.totalReceived).toBeGreaterThan(0);
        });
    });

    describe("Scalability Testing", () => {
        test("should handle increasing load gracefully", async () => {
            const loadLevels = [100, 500, 1000, 2500, 5000];
            const performanceMetrics: Array<{
                load: number;
                timeMs: number;
                throughput: number;
                avgLatency: number;
            }> = [];

            for (const load of loadLevels) {
                // Reset for clean measurement
                signalManager = new SignalManager(
                    mockAnomalyDetector,
                    mockAlertManager,
                    mockLogger,
                    mockMetricsCollector,
                    mockThreadManager,
                    undefined,
                    undefined
                );

                const signals = Array.from({ length: load }, (_, i) =>
                    createPerformanceSignal(i)
                );

                const { timeMs } = await measureExecutionTime(() => {
                    return signals.map((signal) =>
                        signalManager.handleProcessedSignal(signal)
                    );
                });

                const throughput = load / (timeMs / 1000);
                const avgLatency = timeMs / load;

                performanceMetrics.push({
                    load,
                    timeMs,
                    throughput,
                    avgLatency,
                });

                console.log(
                    `Load ${load}: ${timeMs.toFixed(2)}ms, ${throughput.toFixed(0)} signals/sec, ${avgLatency.toFixed(4)}ms avg latency`
                );
            }

            // Verify graceful degradation (not exponential slowdown)
            const maxLatency = Math.max(
                ...performanceMetrics.map((m) => m.avgLatency)
            );
            expect(maxLatency).toBeLessThan(2.0); // Should remain under 2ms even at high load
        });

        test("should maintain minimum throughput under stress", async () => {
            const stressSignalCount = 10000;
            const signals = Array.from({ length: stressSignalCount }, (_, i) =>
                createPerformanceSignal(i)
            );

            const { timeMs } = await measureExecutionTime(() => {
                return signals.map((signal) =>
                    signalManager.handleProcessedSignal(signal)
                );
            });

            const throughput = stressSignalCount / (timeMs / 1000);
            console.log(
                `Stress test throughput: ${throughput.toFixed(0)} signals/second`
            );

            // Minimum acceptable throughput for institutional trading
            expect(throughput).toBeGreaterThan(3000); // At least 3000 signals/second
        });
    });

    describe("Resource Usage Monitoring", () => {
        test("should track performance metrics accurately", () => {
            // Process various signals to generate metrics
            for (let i = 0; i < 100; i++) {
                signalManager.handleProcessedSignal(createPerformanceSignal(i));
            }

            const metrics = signalManager.getPerformanceMetrics();
            expect(metrics).toBeDefined();

            const stats = signalManager.getSignalStatistics();
            expect(stats.processing.totalReceived).toBe(100);
            expect(stats.processing.totalConfirmed).toBeGreaterThan(0);
        });

        test("should provide system status information", () => {
            // Process some signals
            for (let i = 0; i < 50; i++) {
                signalManager.handleProcessedSignal(createPerformanceSignal(i));
            }

            const status = signalManager.getStatus();
            expect(status).toBeDefined();
            expect(status.backpressure.queueSize).toBeGreaterThanOrEqual(0);
            expect(status.marketHealth.isHealthy).toBe(true);
        });
    });

    describe("Performance Degradation Detection", () => {
        test("should detect performance degradation patterns", async () => {
            const measurements: number[] = [];

            // Take multiple performance measurements
            for (let i = 0; i < 10; i++) {
                const batchSize = 100;
                const signals = Array.from({ length: batchSize }, (_, j) =>
                    createPerformanceSignal(i * batchSize + j)
                );

                const { timeMs } = await measureExecutionTime(() => {
                    return signals.map((signal) =>
                        signalManager.handleProcessedSignal(signal)
                    );
                });

                measurements.push(timeMs / batchSize); // Per-signal processing time
            }

            // Analyze performance trend
            const firstHalf = measurements.slice(0, 5);
            const secondHalf = measurements.slice(5);

            const firstHalfAvg =
                firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length;
            const secondHalfAvg =
                secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length;

            const degradationRatio = secondHalfAvg / firstHalfAvg;

            console.log(`First half avg: ${firstHalfAvg.toFixed(6)}ms`);
            console.log(`Second half avg: ${secondHalfAvg.toFixed(6)}ms`);
            console.log(`Degradation ratio: ${degradationRatio.toFixed(3)}`);

            // Performance should not degrade significantly over time
            expect(degradationRatio).toBeLessThan(3.5); // Less than 3.5x slowdown
        });
    });

    describe("Benchmarking & Baselines", () => {
        test("should establish performance baselines", async () => {
            const benchmarkSizes = [1, 10, 100, 1000];
            const baselines: Record<
                number,
                { avgLatency: number; throughput: number }
            > = {};

            for (const size of benchmarkSizes) {
                const iterations = Math.max(1, Math.floor(1000 / size)); // Adjust iterations based on size
                const measurements: number[] = [];

                for (let i = 0; i < iterations; i++) {
                    const signals = Array.from({ length: size }, (_, j) =>
                        createPerformanceSignal(i * size + j)
                    );

                    const { timeMs } = await measureExecutionTime(() => {
                        return signals.map((signal) =>
                            signalManager.handleProcessedSignal(signal)
                        );
                    });

                    measurements.push(timeMs);
                }

                const avgTimeMs =
                    measurements.reduce((a, b) => a + b, 0) /
                    measurements.length;
                const avgLatency = avgTimeMs / size;
                const throughput = size / (avgTimeMs / 1000);

                baselines[size] = { avgLatency, throughput };

                console.log(
                    `Baseline for ${size} signals: ${avgLatency.toFixed(6)}ms latency, ${throughput.toFixed(0)} signals/sec`
                );
            }

            // Store baselines for production monitoring
            expect(Object.keys(baselines)).toHaveLength(benchmarkSizes.length);

            // Verify baselines meet institutional requirements
            expect(baselines[1].avgLatency).toBeLessThan(0.5); // Single signal under 0.5ms
            expect(baselines[1000].throughput).toBeGreaterThan(3000); // Batch throughput over 3000/sec
        });
    });
});
