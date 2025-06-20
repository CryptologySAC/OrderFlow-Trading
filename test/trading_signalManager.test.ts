import { describe, it, expect, vi } from "vitest";

// Mock the WorkerLogger before importing
vi.mock("../src/multithreading/workerLogger");
vi.mock("../src/infrastructure/metricsCollector");
vi.mock("../src/services/anomalyDetector");
vi.mock("../src/multithreading/threadManager");
vi.mock("../src/alerts/alertManager");

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
            recommendation: "continue",
            criticalIssues: [],
            recentAnomalyTypes: [],
            volatilityRatio: 1.0,
            highestSeverity: "low",
        });

        const manager = new SignalManager(
            ad,
            new AlertManager(),
            new WorkerLogger(),
            new MetricsCollector(),
            new ThreadManager()
        );
        const signal = {
            id: "test_signal_1",
            originalCandidate: {} as any,
            type: "absorption" as const,
            confidence: 0.9, // Updated to exceed the new 0.85 threshold for absorption
            timestamp: new Date(),
            detectorId: "test_detector",
            processingMetadata: {},
            data: { price: 100 },
        } as any;
        const confirmed = manager.processSignal(signal);
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
            recommendation: "continue",
            criticalIssues: [],
            recentAnomalyTypes: [],
            volatilityRatio: 1.0,
            highestSeverity: "low",
        });

        const manager = new SignalManager(
            ad,
            new AlertManager(),
            new WorkerLogger(),
            new MetricsCollector(),
            new ThreadManager()
        );

        const baseSignal = {
            originalCandidate: {} as any,
            confidence: 0.8,
            timestamp: new Date(),
            detectorId: "test_detector",
            processingMetadata: {},
        } as any;

        const s1 = {
            ...baseSignal,
            id: "sig1",
            type: "accumulation_confirmed" as const,
            data: { price: 100 },
        };
        const s2 = {
            ...baseSignal,
            id: "sig2",
            type: "accumulation_confirmed" as const,
            data: { price: 100.01 },
        };

        const c1 = manager.handleProcessedSignal(s1 as any);
        expect(c1).not.toBeNull();

        const c2 = manager.handleProcessedSignal(s2 as any);
        expect(c2).toBeNull();
    });
});
