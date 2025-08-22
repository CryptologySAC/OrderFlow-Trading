// test/signalManager_coreProcessing.test.ts

import { describe, test, expect, vi, beforeEach } from "vitest";
import { SignalManager } from "../src/trading/signalManager.js";
import { AnomalyDetector } from "../src/services/anomalyDetector.js";
import { AlertManager } from "../src/alerts/alertManager.js";
import { ThreadManager } from "../src/multithreading/threadManager.js";
import { MetricsCollector } from "../src/infrastructure/metricsCollector.js";
import type {
    ProcessedSignal,
    ConfirmedSignal,
} from "../src/types/signalTypes.js";
import type { ILogger } from "../src/infrastructure/loggerInterface.js";

/**
 * 🏛️ INSTITUTIONAL-GRADE SIGNAL MANAGER CORE PROCESSING TESTS
 *
 * This comprehensive test suite validates the core signal processing pipeline
 * of SignalManager with institutional-grade rigor, covering:
 *
 * 1. Signal Validation & Rejection Scenarios
 * 2. Confidence Threshold Boundary Testing
 * 3. Invalid Input Handling
 * 4. Signal Transformation Pipeline
 * 5. Market Health Integration
 * 6. Edge Cases & Boundary Conditions
 *
 * COVERAGE: 15 comprehensive test cases covering all critical paths
 */

// Enhanced mock configuration for comprehensive testing
vi.mock("../src/core/config.js", () => {
    const mockSignalManagerConfig = {
        confidenceThreshold: 0.3,
        signalTimeout: 120000,
        enableMarketHealthCheck: true,
        enableAlerts: true,
        maxQueueSize: 1000,
        processingBatchSize: 10,
        backpressureThreshold: 800,
        enableSignalPrioritization: false,
        adaptiveBatchSizing: false,
        maxAdaptiveBatchSize: 50,
        minAdaptiveBatchSize: 5,
        circuitBreakerThreshold: 100, // High threshold to prevent circuit breaking in tests
        circuitBreakerResetMs: 60000,
        adaptiveBackpressure: false,
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
        priceTolerancePercent: 0.3,
        signalThrottleMs: 10000,
        correlationWindowMs: 300000,
        maxHistorySize: 100,
        defaultPriority: 5,
        volatilityHighThreshold: 0.05,
        volatilityLowThreshold: 0.02,
        defaultLowVolatility: 0.02,
        defaultVolatilityError: 0.03,
        priorityQueueHighThreshold: 8.0,
        backpressureYieldMs: 1,
        marketVolatilityWeight: 0.6,
        conflictResolution: {
            enabled: false, // Disabled for core processing tests
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

// Create comprehensive mock dependencies
const mockLogger: ILogger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
};

// Market health states for testing
const createMockAnomalyDetector = (
    isHealthy: boolean = true,
    recommendation: string = "continue"
) =>
    ({
        getMarketHealth: vi.fn().mockReturnValue({
            isHealthy,
            recentAnomalies: 0,
            highestSeverity: isHealthy ? "low" : "critical",
            recommendation,
            criticalIssues: isHealthy ? [] : ["severe_anomaly"],
            recentAnomalyTypes: [],
            metrics: {
                volatility: 0.02,
                spreadBps: 1.0,
                flowImbalance: 0.0,
                lastUpdateAge: 0,
            },
        }),
    }) as unknown as AnomalyDetector;

const mockAlertManager = {
    sendAlert: vi.fn(),
} as unknown as AlertManager;

const mockThreadManager = {
    callStorage: vi.fn().mockResolvedValue(undefined),
} as unknown as ThreadManager;

const mockMetricsCollector = new MetricsCollector(mockLogger);

describe("SignalManager Core Processing - Institutional Grade", () => {
    let signalManager: SignalManager;
    let mockAnomalyDetector: AnomalyDetector;

    beforeEach(() => {
        vi.clearAllMocks();
        mockAnomalyDetector = createMockAnomalyDetector(true, "continue");
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

    // Utility function to create test signals
    const createTestSignal = (
        id: string,
        type: string,
        side: "buy" | "sell",
        price: number,
        confidence: number,
        timestamp: number = Date.now(),
        additionalData: any = {}
    ): ProcessedSignal => ({
        id,
        type: type as any,
        confidence,
        detectorId: `${type}_detector`,
        originalCandidate: {
            id: `${id}_candidate`,
            type: type as any,
            side,
            confidence,
            timestamp,
            data: {
                price,
                side,
                volume: 100,
                timestamp: new Date(timestamp),
                ...additionalData,
            },
            enrichedEvent: {
                phaseContext: {
                    currentPhase: {
                        direction: "UP" as const,
                        startPrice: price - 0.5,
                        startTime: timestamp - 300000,
                        currentSize: 0.005,
                        age: 300000,
                    },
                    previousPhase: {
                        direction: "DOWN" as const,
                        size: 0.008,
                        duration: 600000,
                    },
                    phaseConfirmed: true,
                },
            },
        },
        data: {
            price,
            side,
            volume: 100,
            timestamp: new Date(timestamp),
            ...additionalData,
        },
        timestamp: new Date(timestamp),
        correlationId: `corr_${id}`,
    });

    describe("Signal Validation & Processing", () => {
        test("should process valid signal with sufficient confidence", () => {
            const signal = createTestSignal(
                "test1",
                "absorption",
                "buy",
                89.5,
                0.7
            );

            const result = signalManager.handleProcessedSignal(signal);

            expect(result).toBeTruthy();
            expect(result).toHaveProperty("id");
            expect(result).toHaveProperty("confidence");
            expect(result!.confidence).toBeGreaterThan(0);
            expect(mockLogger.info).toHaveBeenCalledWith(
                expect.stringContaining("Processing signal"),
                expect.objectContaining({
                    signalId: signal.id,
                    signalType: signal.type,
                    confidence: signal.confidence,
                })
            );
        });

        test("should accept signal regardless of confidence (Option B architecture)", () => {
            // Option B: Detectors handle their own thresholds, signal manager accepts all
            const signal = createTestSignal(
                "test2",
                "absorption",
                "buy",
                89.5,
                0.1
            ); // Low confidence but should still be accepted

            const result = signalManager.handleProcessedSignal(signal);

            expect(result).toBeTruthy();
            expect(result!.confidence).toBe(0.1);
        });

        test("should accept all signal types regardless of confidence (Option B architecture)", () => {
            // Option B: No confidence filtering in signal manager
            const testCases = [
                { type: "absorption", confidence: 0.35 },
                { type: "deltacvd", confidence: 0.2 },
                { type: "exhaustion", confidence: 0.25 },
                { type: "accumulation", confidence: 0.2 }, // Previously rejected, now accepted
                { type: "distribution", confidence: 0.5 },
            ];

            testCases.forEach(({ type, confidence }, index) => {
                const signal = createTestSignal(
                    `test_${index}`,
                    type,
                    "buy",
                    89.5,
                    confidence
                );
                const result = signalManager.handleProcessedSignal(signal);

                // All signals should be accepted regardless of confidence
                expect(result).toBeTruthy();
                expect(result!.confidence).toBe(confidence);
            });
        });
    });

    describe("Market Health Integration", () => {
        test("should reject signals when market health is critical", () => {
            mockAnomalyDetector = createMockAnomalyDetector(
                false,
                "close_positions"
            );
            signalManager = new SignalManager(
                mockAnomalyDetector,
                mockAlertManager,
                mockLogger,
                mockMetricsCollector,
                mockThreadManager,
                undefined,
                undefined
            );

            const signal = createTestSignal(
                "test3",
                "absorption",
                "buy",
                89.5,
                0.7
            );
            const result = signalManager.handleProcessedSignal(signal);

            expect(result).toBeNull();
            expect(signalManager.getLastRejectReason()).toBe(
                "unhealthy_market"
            );
            expect(mockLogger.info).toHaveBeenCalledWith(
                expect.stringContaining("Signal blocked due to market health"),
                expect.objectContaining({
                    signalId: signal.id,
                })
            );
        });

        test("should process signals when market has non-critical issues", () => {
            mockAnomalyDetector = createMockAnomalyDetector(
                true,
                "reduce_size"
            );
            signalManager = new SignalManager(
                mockAnomalyDetector,
                mockAlertManager,
                mockLogger,
                mockMetricsCollector,
                mockThreadManager,
                undefined,
                undefined
            );

            const signal = createTestSignal(
                "test4",
                "absorption",
                "buy",
                89.5,
                0.7
            );
            const result = signalManager.handleProcessedSignal(signal);

            expect(result).toBeTruthy();
            expect(result!.anomalyData.marketHealthy).toBe(true);
            expect(result!.anomalyData.tradingAllowed).toBe(true);
        });

        test("should handle insufficient data scenario", () => {
            mockAnomalyDetector = createMockAnomalyDetector(
                false,
                "insufficient_data"
            );
            signalManager = new SignalManager(
                mockAnomalyDetector,
                mockAlertManager,
                mockLogger,
                mockMetricsCollector,
                mockThreadManager,
                undefined,
                undefined
            );

            const signal = createTestSignal(
                "test5",
                "absorption",
                "buy",
                89.5,
                0.7
            );
            const result = signalManager.handleProcessedSignal(signal);

            expect(result).toBeNull();
            expect(signalManager.getLastRejectReason()).toBe(
                "unhealthy_market"
            );
        });
    });

    describe("Edge Cases & Boundary Conditions", () => {
        test("should handle exact confidence threshold boundary", () => {
            const signal = createTestSignal(
                "test6",
                "absorption",
                "buy",
                89.5,
                0.3
            ); // Exactly at threshold

            const result = signalManager.handleProcessedSignal(signal);

            expect(result).toBeTruthy(); // Should pass at exact threshold
            expect(result!.confidence).toBeGreaterThanOrEqual(0.3);
        });

        test("should accept zero confidence signal (Option B architecture)", () => {
            // Option B: Signal manager doesn't filter by confidence
            const signal = createTestSignal(
                "test7",
                "absorption",
                "buy",
                89.5,
                0.0
            );

            const result = signalManager.handleProcessedSignal(signal);

            expect(result).toBeTruthy();
            expect(result!.confidence).toBe(0);
        });

        test("should handle maximum confidence signal", () => {
            const signal = createTestSignal(
                "test8",
                "absorption",
                "buy",
                89.5,
                1.0
            );

            const result = signalManager.handleProcessedSignal(signal);

            expect(result).toBeTruthy();
            expect(result!.confidence).toBeGreaterThan(0);
            expect(result!.confidence).toBeLessThanOrEqual(1.0);
        });

        test("should handle confidence above 1.0", () => {
            const signal = createTestSignal(
                "test9",
                "absorption",
                "buy",
                89.5,
                1.5
            );

            const result = signalManager.handleProcessedSignal(signal);

            expect(result).toBeTruthy();
            // High confidence signals should preserve their strength
            expect(result!.confidence).toBeGreaterThanOrEqual(1.5);
        });

        test("should accept negative confidence (Option B architecture)", () => {
            // Option B: Even negative confidence accepted (detectors should prevent this)
            const signal = createTestSignal(
                "test10",
                "absorption",
                "buy",
                89.5,
                -0.1
            );

            const result = signalManager.handleProcessedSignal(signal);

            expect(result).toBeTruthy();
            expect(result!.confidence).toBe(-0.1);
        });
    });

    describe("Signal Data Transformation", () => {
        test("should preserve original signal metadata in confirmed signal", () => {
            const originalData = {
                price: 89.5,
                side: "buy" as const,
                volume: 150,
                customField: "test_value",
            };
            const signal = createTestSignal(
                "test11",
                "absorption",
                "buy",
                89.5,
                0.7,
                Date.now(),
                originalData
            );

            const result = signalManager.handleProcessedSignal(signal);

            expect(result).toBeTruthy();
            expect(result!.originalSignals).toHaveLength(1);
            expect(result!.originalSignals[0].metadata).toMatchObject(
                originalData
            );
            expect(result!.finalPrice).toBe(89.5);
        });

        test("should calculate correlation data correctly", () => {
            const signal = createTestSignal(
                "test12",
                "absorption",
                "buy",
                89.5,
                0.7
            );

            const result = signalManager.handleProcessedSignal(signal);

            expect(result).toBeTruthy();
            expect(result!.correlationData).toBeDefined();
            expect(result!.correlationData.correlatedSignals).toBe(0); // No previous signals
            expect(
                result!.correlationData.correlationStrength
            ).toBeGreaterThanOrEqual(0);
        });

        test("should generate unique confirmed signal IDs", () => {
            const signal1 = createTestSignal(
                "test13a",
                "absorption",
                "buy",
                89.5,
                0.7
            );
            const signal2 = createTestSignal(
                "test13b",
                "exhaustion", // Different signal type to avoid deduplication
                "sell", // Different side to avoid deduplication
                89.6, // Slightly different price to avoid deduplication
                0.8 // Different confidence to avoid deduplication
            );

            const result1 = signalManager.handleProcessedSignal(signal1);
            const result2 = signalManager.handleProcessedSignal(signal2);

            expect(result1).toBeTruthy();
            expect(result2).toBeTruthy();
            expect(result1!.id).not.toBe(result2!.id);
            expect(result1!.id).toMatch(/^confirmed_/);
            expect(result2!.id).toMatch(/^confirmed_/);
        });
    });

    describe("Unknown Signal Types", () => {
        test("should reject signal with unknown signal type", () => {
            const signal = createTestSignal(
                "test14",
                "unknown_type",
                "buy",
                89.5,
                0.7
            );

            const result = signalManager.handleProcessedSignal(signal);

            // Unknown signal types should be rejected (return null)
            expect(result).toBeNull();
        });

        test("should handle known signal types correctly", () => {
            const signal = createTestSignal(
                "test15",
                "absorption", // Use known signal type
                "buy",
                89.5,
                0.7
            );

            const result = signalManager.handleProcessedSignal(signal);

            // Known signal types should be processed successfully
            expect(result).toBeTruthy();
            expect(result!.id).toMatch(/^confirmed_/);
        });
    });

    describe("Signal Processing Statistics", () => {
        test("should track processing metrics correctly", () => {
            const signal1 = createTestSignal(
                "metrics1",
                "absorption",
                "buy",
                89.5,
                0.7
            );
            const signal2 = createTestSignal(
                "metrics2",
                "absorption",
                "buy",
                89.5,
                0.1
            ); // Will be rejected

            signalManager.handleProcessedSignal(signal1);
            signalManager.handleProcessedSignal(signal2);

            const stats = signalManager.getSignalStatistics();
            expect(stats.processing.totalReceived).toBeGreaterThan(0);
            expect(stats.processing.totalConfirmed).toBeGreaterThan(0);
            expect(stats.processing.totalProcessed).toBeGreaterThan(0);
        });
    });
});
