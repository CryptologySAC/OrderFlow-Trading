import { describe, it, expect, vi } from "vitest";
import { SignalManager } from "../src/trading/signalManager";
import { AnomalyDetector } from "../src/services/anomalyDetector";
import { Logger } from "../src/infrastructure/logger";
import { MetricsCollector } from "../src/infrastructure/metricsCollector";

vi.mock("../src/infrastructure/logger");
vi.mock("../src/infrastructure/metricsCollector");

const alertManager = { sendAlert: vi.fn() } as any;
const storage = {
    getActiveAnomalies: vi.fn().mockReturnValue([]),
    purgeSignalHistory: vi.fn(),
    saveSignalHistory: vi.fn(),
    saveConfirmedSignal: vi.fn(),
    purgeConfirmedSignals: vi.fn(),
} as any;

describe("trading/SignalManager", () => {
    it("processes signal and returns confirmation", () => {
        const ad = new AnomalyDetector({ minHistory: 1 }, new Logger());
        // Mock the getMarketHealth method to return healthy state
        vi.spyOn(ad, "getMarketHealth").mockReturnValue({
            isHealthy: true,
            recommendation: "continue",
            criticalIssues: [],
            recentAnomalyTypes: [],
            volatilityRatio: 1.0,
        });

        const manager = new SignalManager(
            ad,
            alertManager,
            new Logger(),
            new MetricsCollector(),
            storage
        );
        const signal = {
            id: "test_signal_1",
            originalCandidate: {} as any,
            type: "absorption" as const,
            confidence: 0.8,
            timestamp: new Date(),
            detectorId: "test_detector",
            processingMetadata: {},
            data: { price: 100 },
        } as any;
        const confirmed = manager.processSignal(signal);
        expect(confirmed).not.toBeNull();
        expect(confirmed?.id).toContain("confirmed");
        expect(confirmed?.id).toContain("test_signal_1");
        expect(storage.saveConfirmedSignal).toHaveBeenCalled();
    });

    it("throttles similar signals with underscore types", () => {
        const ad = new AnomalyDetector({ minHistory: 1 }, new Logger());
        vi.spyOn(ad, "getMarketHealth").mockReturnValue({
            isHealthy: true,
            recommendation: "continue",
            criticalIssues: [],
            recentAnomalyTypes: [],
            volatilityRatio: 1.0,
        });

        const manager = new SignalManager(
            ad,
            alertManager,
            new Logger(),
            new MetricsCollector(),
            storage
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

        const c1 = manager.processSignal(s1);
        expect(c1).not.toBeNull();

        const c2 = manager.processSignal(s2);
        expect(c2).toBeNull();
    });
});
