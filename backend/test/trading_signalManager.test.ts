import { describe, it, expect, vi } from "vitest";

// Mock the WorkerLogger before importing
vi.mock("../src/multithreading/workerLogger");
vi.mock("../src/infrastructure/metricsCollector");
vi.mock("../src/services/anomalyDetector");
vi.mock("../src/multithreading/threadManager");
vi.mock("../src/alerts/alertManager");

// Mock config to prevent validation errors
vi.mock("../src/core/config", () => ({
    Config: {
        SIGNAL_MANAGER: {
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
            circuitBreakerThreshold: 100,
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
                absorption: 0.3,
                deltacvd: 0.15,
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
                enabled: false,
                strategy: "confidence_weighted",
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
        },
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
}));

import { SignalManager } from "../src/trading/signalManager";
import { AnomalyDetector } from "../src/services/anomalyDetector";
import { WorkerLogger } from "../src/multithreading/workerLogger";
import { MetricsCollector } from "../src/infrastructure/metricsCollector";
import { ThreadManager } from "../src/multithreading/threadManager";
import { AlertManager } from "../src/alerts/alertManager";

describe("trading/SignalManager", () => {
    it("processes signal and returns confirmation", () => {
        const ad = new AnomalyDetector({ minHistory: 1 }, new WorkerLogger());

        // Manually spy on the getMarketHealth method to ensure it returns the expected value
        vi.spyOn(ad, "getMarketHealth").mockReturnValue({
            isHealthy: true,
            recentAnomalies: 0,
            highestSeverity: "low",
            recommendation: "continue",
            criticalIssues: [],
            recentAnomalyTypes: [],
            metrics: {
                volatility: 0.5,
                spreadBps: 1.0,
                flowImbalance: 0.0,
                lastUpdateAge: 0,
            },
        });

        const manager = new SignalManager(
            ad,
            new AlertManager(),
            new WorkerLogger(),
            new MetricsCollector(),
            new ThreadManager(),
            undefined,
            undefined,
            {
                confidenceThreshold: 0.3,
                signalTimeout: 120000,
                enableMarketHealthCheck: true,
                enableAlerts: true,
                maxQueueSize: 1000,
                processingBatchSize: 10,
                backpressureThreshold: 800,
                enableSignalPrioritization: true,
                adaptiveBatchSizing: true,
                maxAdaptiveBatchSize: 50,
                minAdaptiveBatchSize: 5,
                circuitBreakerThreshold: 5,
                circuitBreakerResetMs: 60000,
                adaptiveBackpressure: true,
                highPriorityBypassThreshold: 8.5,
                signalTypePriorities: {
                    absorption: 10,
                    exhaustion: 9,
                    deltacvd: 8,
                    accumulation: 7,
                    distribution: 7,
                },
                detectorThresholds: {
                    absorption: 0.3,
                    exhaustion: 0.2,
                    accumulation: 0.3,
                    distribution: 0.4,
                    deltacvd: 0.15,
                },
                positionSizing: {
                    absorption: 0.5,
                    exhaustion: 1.0,
                    accumulation: 0.6,
                    distribution: 0.7,
                    deltacvd: 0.7,
                },
            }
        );
        const signalData = {
            price: 100,
            side: "buy" as const,
            volume: 100,
            timestamp: new Date(),
        };
        const signal = {
            id: "test_signal_1",
            originalCandidate: {} as any,
            type: "absorption" as const,
            confidence: 0.9, // Updated to exceed the new 0.85 threshold for absorption
            timestamp: new Date(),
            detectorId: "test_detector",
            processingMetadata: {},
            data: signalData,
            metadata: signalData, // Include metadata for direction detection
        } as any;
        const confirmed = manager.handleProcessedSignal(signal);
        expect(confirmed).not.toBeNull();
        expect(confirmed?.id).toContain("confirmed");
        expect(confirmed?.id).toContain("test_signal_1");
        // Note: storage operations go through threadManager.callStorage()
    });

    it("throttles similar signals with underscore types", () => {
        const ad = new AnomalyDetector({ minHistory: 1 }, new WorkerLogger());

        // Manually spy on the getMarketHealth method to ensure it returns the expected value
        vi.spyOn(ad, "getMarketHealth").mockReturnValue({
            isHealthy: true,
            recentAnomalies: 0,
            highestSeverity: "low",
            recommendation: "continue",
            criticalIssues: [],
            recentAnomalyTypes: [],
            metrics: {
                volatility: 0.5,
                spreadBps: 1.0,
                flowImbalance: 0.0,
                lastUpdateAge: 0,
            },
        });

        const manager = new SignalManager(
            ad,
            new AlertManager(),
            new WorkerLogger(),
            new MetricsCollector(),
            new ThreadManager(),
            undefined,
            undefined,
            {
                confidenceThreshold: 0.3,
                signalTimeout: 120000,
                enableMarketHealthCheck: true,
                enableAlerts: true,
                maxQueueSize: 1000,
                processingBatchSize: 10,
                backpressureThreshold: 800,
                enableSignalPrioritization: true,
                adaptiveBatchSizing: true,
                maxAdaptiveBatchSize: 50,
                minAdaptiveBatchSize: 5,
                circuitBreakerThreshold: 5,
                circuitBreakerResetMs: 60000,
                adaptiveBackpressure: true,
                highPriorityBypassThreshold: 8.5,
                signalTypePriorities: {
                    absorption: 10,
                    exhaustion: 9,
                    deltacvd: 8,
                    accumulation: 7,
                    distribution: 7,
                },
                detectorThresholds: {
                    absorption: 0.3,
                    exhaustion: 0.2,
                    accumulation: 0.3,
                    distribution: 0.4,
                    deltacvd: 0.15,
                },
                positionSizing: {
                    absorption: 0.5,
                    exhaustion: 1.0,
                    accumulation: 0.6,
                    distribution: 0.7,
                    deltacvd: 0.7,
                },
            }
        );

        const baseSignal = {
            originalCandidate: {} as any,
            confidence: 0.96, // Updated to exceed the accumulation threshold of 0.95
            timestamp: new Date(),
            detectorId: "test_detector",
            processingMetadata: {},
        } as any;

        const signalData1 = {
            price: 100,
            side: "buy" as const,
            volume: 100,
            timestamp: new Date(),
        };
        const signalData2 = {
            price: 100.01,
            side: "buy" as const,
            volume: 100,
            timestamp: new Date(),
        };

        const s1 = {
            ...baseSignal,
            id: "sig1",
            type: "accumulation" as const,
            data: signalData1,
            metadata: signalData1,
        };
        const s2 = {
            ...baseSignal,
            id: "sig2",
            type: "accumulation" as const,
            data: signalData2,
            metadata: signalData2,
        };

        const c1 = manager.handleProcessedSignal(s1 as any);
        expect(c1).not.toBeNull();

        const c2 = manager.handleProcessedSignal(s2 as any);
        expect(c2).toBeNull();
    });
});
