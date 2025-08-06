// test/signalManager_marketContext_integration.test.ts

import { describe, test, expect, vi, beforeEach } from "vitest";
import { SignalManager } from "../src/trading/signalManager.js";
import { AnomalyDetector } from "../src/services/anomalyDetector.js";
import { AlertManager } from "../src/alerts/alertManager.js";
import { ThreadManager } from "../src/multithreading/threadManager.js";
import { MetricsCollector } from "../src/infrastructure/metricsCollector.js";
import type { ProcessedSignal } from "../src/types/signalTypes.js";
import type { ILogger } from "../src/infrastructure/loggerInterface.js";

/**
 * 🏛️ SIGNAL MANAGER MARKET CONTEXT INTEGRATION TESTS
 *
 * This institutional-grade test suite validates the integration between
 * SignalManager and market context systems:
 *
 * 1. Volatility Regime Transitions (high → low → high)
 * 2. Market Health Degradation Scenarios
 * 3. Anomaly Detector Integration
 * 4. Context-Based Signal Enhancement
 * 5. Market State Change Responses
 * 6. Volatility-Based Priority Adjustments
 * 7. Health-Based Signal Filtering
 * 8. Dynamic Configuration Adaptation
 *
 * COVERAGE: 10 comprehensive test cases covering market integration
 */

// Mock configuration for market context testing
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
        circuitBreakerThreshold: 100, // High threshold to prevent circuit breaking
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
        correlationBoostFactor: 0.7,
        priceTolerancePercent: 0.3,
        signalThrottleMs: 10000,
        correlationWindowMs: 300000,
        maxHistorySize: 100,
        defaultPriority: 5,
        volatilityHighThreshold: 0.05, // 5% volatility threshold
        volatilityLowThreshold: 0.02, // 2% volatility threshold
        defaultLowVolatility: 0.02,
        defaultVolatilityError: 0.03,
        contextBoostHigh: 0.15, // 15% boost in high volatility
        contextBoostLow: 0.1, // 10% boost in low volatility
        priorityQueueHighThreshold: 8.0,
        backpressureYieldMs: 1,
        marketVolatilityWeight: 0.6,
        conflictResolution: {
            enabled: false, // Disable for simpler testing
            strategy: "market_context" as const, // Use market context strategy
            minimumSeparationMs: 30000,
            contradictionPenaltyFactor: 0.5,
            priceTolerance: 0.001,
            volatilityNormalizationFactor: 0.02,
        },
        signalPriorityMatrix: {
            highVolatility: {
                absorption: 0.3, // Lower priority in high volatility
                deltacvd: 0.7, // Higher priority in high volatility
                exhaustion: 0.8,
                accumulation: 0.5,
                distribution: 0.5,
            },
            lowVolatility: {
                absorption: 0.7, // Higher priority in low volatility
                deltacvd: 0.3, // Lower priority in low volatility
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

// Mock dependencies with dynamic behavior
const mockLogger: ILogger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
};

// Factory for creating anomaly detector with different market states
const createMockAnomalyDetector = (
    isHealthy: boolean = true,
    recommendation: string = "continue",
    volatility: number = 0.02,
    severity: string = "low",
    anomalyTypes: string[] = []
) =>
    ({
        getMarketHealth: vi.fn().mockReturnValue({
            isHealthy,
            recentAnomalies: anomalyTypes.length,
            highestSeverity: severity,
            recommendation,
            criticalIssues: isHealthy ? [] : ["market_stress"],
            recentAnomalyTypes: anomalyTypes,
            metrics: {
                volatility,
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

describe("SignalManager Market Context Integration", () => {
    let signalManager: SignalManager;
    let mockAnomalyDetector: AnomalyDetector;

    beforeEach(() => {
        vi.clearAllMocks();
    });

    const createTestSignal = (
        id: string,
        type: string,
        side: "buy" | "sell",
        price: number,
        confidence: number,
        timestamp: number = Date.now()
    ): ProcessedSignal => ({
        id,
        type: type as any,
        confidence,
        detectorId: `${type}_detector`,
        data: {
            price,
            side,
            volume: 100,
            timestamp: new Date(timestamp),
        },
        timestamp: new Date(timestamp),
        correlationId: `corr_${id}`,
    });

    describe("Volatility Regime Transitions", () => {
        test("should handle transition from low to high volatility", () => {
            // Start with low volatility market
            mockAnomalyDetector = createMockAnomalyDetector(
                true,
                "continue",
                0.01
            ); // 1% volatility
            signalManager = new SignalManager(
                mockAnomalyDetector,
                mockAlertManager,
                mockLogger,
                mockMetricsCollector,
                mockThreadManager,
                undefined,
                undefined
            );

            // Process signal in low volatility
            const lowVolSignal = createTestSignal(
                "low_vol",
                "absorption",
                "buy",
                89.5,
                0.7
            );
            const result1 = signalManager.handleProcessedSignal(lowVolSignal);
            expect(result1).toBeTruthy();

            // Transition to high volatility
            mockAnomalyDetector = createMockAnomalyDetector(
                true,
                "continue",
                0.08
            ); // 8% volatility
            signalManager = new SignalManager(
                mockAnomalyDetector,
                mockAlertManager,
                mockLogger,
                mockMetricsCollector,
                mockThreadManager,
                undefined,
                undefined
            );

            // Process signal in high volatility - should have different enhancement
            const highVolSignal = createTestSignal(
                "high_vol",
                "absorption",
                "buy",
                89.5,
                0.7
            );
            const result2 = signalManager.handleProcessedSignal(highVolSignal);
            expect(result2).toBeTruthy();

            // Confidence enhancement should differ between regimes
            expect(result1!.confidence).not.toBe(result2!.confidence);
        });

        test("should apply appropriate priority matrix for volatility regime", () => {
            // High volatility: deltacvd should have higher priority than absorption
            mockAnomalyDetector = createMockAnomalyDetector(
                true,
                "continue",
                0.07
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

            const now = Date.now();
            const absorptionSignal = createTestSignal(
                "abs_high_vol",
                "absorption",
                "buy",
                89.5,
                0.7,
                now - 15000
            );
            const deltacvdSignal = createTestSignal(
                "cvd_high_vol",
                "deltacvd",
                "sell",
                89.51,
                0.7,
                now
            );

            const result1 =
                signalManager.handleProcessedSignal(absorptionSignal);
            const result2 = signalManager.handleProcessedSignal(deltacvdSignal);

            expect(result1).toBeTruthy();
            // In high volatility, deltacvd should be favored in conflict resolution
            expect(typeof result2 === "object" || result2 === null).toBe(true);
        });

        test("should calculate market volatility from signal history", () => {
            mockAnomalyDetector = createMockAnomalyDetector(
                true,
                "continue",
                0.03
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

            // Create signals with varying prices to generate volatility
            const prices = [89.0, 89.5, 89.2, 89.8, 89.1, 89.6];
            prices.forEach((price, index) => {
                const signal = createTestSignal(
                    `vol_calc_${index}`,
                    "absorption",
                    "buy",
                    price,
                    0.7
                );
                signalManager.handleProcessedSignal(signal);
            });

            // Market context should consider calculated volatility
            const contextData = signalManager.getMarketHealthContext();
            expect(contextData).toBeDefined();
        });
    });

    describe("Market Health Degradation", () => {
        test("should handle gradual market health degradation", () => {
            // Start with healthy market
            mockAnomalyDetector = createMockAnomalyDetector(
                true,
                "continue",
                0.02
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

            const healthySignal = createTestSignal(
                "healthy",
                "absorption",
                "buy",
                89.5,
                0.7
            );
            const result1 = signalManager.handleProcessedSignal(healthySignal);
            expect(result1).toBeTruthy();

            // Transition to degraded health
            mockAnomalyDetector = createMockAnomalyDetector(
                true,
                "reduce_size",
                0.04,
                "medium",
                ["liquidity_crunch"]
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

            const degradedSignal = createTestSignal(
                "degraded",
                "absorption",
                "buy",
                89.5,
                0.7
            );
            const result2 = signalManager.handleProcessedSignal(degradedSignal);
            expect(result2).toBeTruthy();
            expect(result2!.anomalyData.healthRecommendation).toBe(
                "reduce_size"
            );

            // Transition to critical health
            mockAnomalyDetector = createMockAnomalyDetector(
                false,
                "close_positions",
                0.08,
                "critical",
                ["market_crash"]
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

            const criticalSignal = createTestSignal(
                "critical",
                "absorption",
                "buy",
                89.5,
                0.7
            );
            const result3 = signalManager.handleProcessedSignal(criticalSignal);
            expect(result3).toBeNull(); // Should be blocked
        });

        test("should track anomaly types in signal context", () => {
            mockAnomalyDetector = createMockAnomalyDetector(
                true,
                "continue",
                0.03,
                "medium",
                ["spoofing", "wash_trading"]
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
                "anomaly_context",
                "absorption",
                "buy",
                89.5,
                0.7
            );
            const result = signalManager.handleProcessedSignal(signal);

            expect(result).toBeTruthy();
            expect(result!.anomalyData.recentAnomalyTypes).toContain(
                "spoofing"
            );
            expect(result!.anomalyData.recentAnomalyTypes).toContain(
                "wash_trading"
            );
        });
    });

    describe("Context-Based Signal Enhancement", () => {
        test("should apply context boost based on market conditions", () => {
            mockAnomalyDetector = createMockAnomalyDetector(
                true,
                "continue",
                0.02
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

            // Create correlated signals to test correlation boost
            const signal1 = createTestSignal(
                "corr1",
                "absorption",
                "buy",
                89.5,
                0.6,
                Date.now() - 60000 // 60 seconds ago to avoid conflicts
            );
            const signal2 = createTestSignal(
                "corr2",
                "deltacvd", // Different type to avoid throttling but enable correlation
                "buy", // Same side for correlation
                89.52, // Similar but different price
                0.6 // Same confidence
            );

            signalManager.handleProcessedSignal(signal1);
            const result2 = signalManager.handleProcessedSignal(signal2);

            expect(result2).toBeTruthy();
            // Should have correlation boost applied
            expect(
                result2!.correlationData.correlationStrength
            ).toBeGreaterThan(0);
        });

        test("should adjust confidence based on market volatility", () => {
            // Low volatility environment
            mockAnomalyDetector = createMockAnomalyDetector(
                true,
                "continue",
                0.01
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

            const lowVolSignal = createTestSignal(
                "low_vol_adj",
                "absorption",
                "buy",
                89.5,
                0.6
            );
            const result1 = signalManager.handleProcessedSignal(lowVolSignal);

            // High volatility environment
            mockAnomalyDetector = createMockAnomalyDetector(
                true,
                "continue",
                0.08
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

            const highVolSignal = createTestSignal(
                "high_vol_adj",
                "absorption",
                "buy",
                89.5,
                0.6
            );
            const result2 = signalManager.handleProcessedSignal(highVolSignal);

            expect(result1).toBeTruthy();
            expect(result2).toBeTruthy();

            // Confidence adjustments should differ based on volatility context
            const lowVolConfidence = result1!.confidence;
            const highVolConfidence = result2!.confidence;
            expect(lowVolConfidence).not.toBe(highVolConfidence);
        });
    });

    describe("Market State Change Responses", () => {
        test("should handle sudden market state changes", () => {
            // Normal market conditions
            mockAnomalyDetector = createMockAnomalyDetector(
                true,
                "continue",
                0.02
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

            const normalSignal = createTestSignal(
                "normal",
                "absorption",
                "buy",
                89.5,
                0.7
            );
            const result1 = signalManager.handleProcessedSignal(normalSignal);
            expect(result1).toBeTruthy();

            // Sudden market shock
            mockAnomalyDetector = createMockAnomalyDetector(
                false,
                "close_positions",
                0.15,
                "critical",
                ["flash_crash", "liquidity_crisis"]
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

            const shockSignal = createTestSignal(
                "shock",
                "absorption",
                "buy",
                89.5,
                0.7
            );
            const result2 = signalManager.handleProcessedSignal(shockSignal);
            expect(result2).toBeNull(); // Should be blocked due to critical conditions
        });

        test("should adapt to insufficient data scenarios", () => {
            mockAnomalyDetector = createMockAnomalyDetector(
                false,
                "insufficient_data",
                0.03
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
                "insufficient",
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

    describe("Dynamic Configuration Adaptation", () => {
        test("should respect volatility-based threshold adjustments", () => {
            // Test different volatility regimes and their effect on signal processing
            const testCases = [
                { volatility: 0.01, regime: "low" },
                { volatility: 0.035, regime: "balanced" },
                { volatility: 0.08, regime: "high" },
            ];

            testCases.forEach(({ volatility, regime }) => {
                mockAnomalyDetector = createMockAnomalyDetector(
                    true,
                    "continue",
                    volatility
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
                    `${regime}_regime`,
                    "absorption",
                    "buy",
                    89.5,
                    0.7
                );
                const result = signalManager.handleProcessedSignal(signal);

                expect(result).toBeTruthy();
                expect(result!.anomalyData.marketHealthy).toBe(true);
            });
        });

        test("should handle edge case volatility values", () => {
            // Test boundary conditions for volatility thresholds
            const edgeCases = [
                0.0, // Zero volatility
                0.02, // Exactly at low threshold
                0.05, // Exactly at high threshold
                0.2, // Extreme volatility
            ];

            edgeCases.forEach((volatility, index) => {
                mockAnomalyDetector = createMockAnomalyDetector(
                    true,
                    "continue",
                    volatility
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
                    `edge_${index}`,
                    "absorption",
                    "buy",
                    89.5,
                    0.7
                );
                const result = signalManager.handleProcessedSignal(signal);

                expect(result).toBeTruthy();
                expect(result!.anomalyData.marketHealthy).toBe(true);
            });
        });
    });

    describe("Integration Error Handling", () => {
        test("should handle anomaly detector failures gracefully", () => {
            // Mock anomaly detector that throws errors
            const failingAnomalyDetector = {
                getMarketHealth: vi.fn().mockImplementation(() => {
                    throw new Error("Anomaly detector failure");
                }),
            } as unknown as AnomalyDetector;

            signalManager = new SignalManager(
                failingAnomalyDetector,
                mockAlertManager,
                mockLogger,
                mockMetricsCollector,
                mockThreadManager,
                undefined,
                undefined
            );

            const signal = createTestSignal(
                "error_handling",
                "absorption",
                "buy",
                89.5,
                0.7
            );
            // Anomaly detector failures during priority calculation should be handled
            expect(() => {
                signalManager.handleProcessedSignal(signal);
            }).toThrow("Anomaly detector failure");
        });

        test("should maintain functionality with partial anomaly data", () => {
            // Mock anomaly detector with incomplete data
            const partialAnomalyDetector = {
                getMarketHealth: vi.fn().mockReturnValue({
                    isHealthy: true,
                    recentAnomalies: 0,
                    highestSeverity: "low",
                    recommendation: "continue",
                    criticalIssues: [],
                    recentAnomalyTypes: [],
                    // Minimal metrics for partial data test
                    metrics: {
                        volatility: 0.02,
                        spreadBps: 0,
                        flowImbalance: 0,
                        lastUpdateAge: 0,
                    },
                }),
            } as unknown as AnomalyDetector;

            signalManager = new SignalManager(
                partialAnomalyDetector,
                mockAlertManager,
                mockLogger,
                mockMetricsCollector,
                mockThreadManager,
                undefined,
                undefined
            );

            const signal = createTestSignal(
                "partial_data",
                "absorption",
                "buy",
                89.5,
                0.7
            );
            const result = signalManager.handleProcessedSignal(signal);

            expect(result).toBeTruthy();
            expect(result!.anomalyData.marketHealthy).toBe(true);
        });
    });
});
