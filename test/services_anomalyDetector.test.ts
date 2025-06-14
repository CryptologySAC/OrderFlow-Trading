import { describe, it, expect, vi } from "vitest";

// Mock the WorkerLogger before importing
vi.mock("../src/multithreading/workerLogger");

import { AnomalyDetector } from "../src/services/anomalyDetector";
import { WorkerLogger } from "../src/multithreading/workerLogger";

class DummySpoof {
    wasSpoofed = vi.fn().mockReturnValue(false);
    trackPassiveChange = vi.fn();
}

describe("services/AnomalyDetector", () => {
    it("reports insufficient data for market health", () => {
        const detector = new AnomalyDetector({ minHistory: 1 }, new WorkerLogger());
        const health = detector.getMarketHealth();
        expect(health.recommendation).toBe("insufficient_data");
    });

    it("calculates price statistics for anomaly detection", () => {
        vi.useFakeTimers();
        const detector = new AnomalyDetector(
            { tickSize: 0.5, minHistory: 1, spreadThresholdBps: 200 },
            new WorkerLogger()
        );
        detector.updateBestQuotes(100, 101);

        const start = Date.now();
        for (let i = 0; i < 15; i++) {
            detector.onEnrichedTrade({
                price: 100,
                quantity: 1,
                timestamp: start + i * 1000,
                buyerIsMaker: false,
                symbol: "TEST",
                tradeId: String(i),
                passiveBidVolume: 0,
                originalTrade: { s: "TEST" },
                passiveAskVolume: 0,
                zonePassiveBidVolume: 0,
                zonePassiveAskVolume: 0,
            } as any);
            vi.advanceTimersByTime(1000);
        }

        const health = detector.getMarketHealth();

        expect(health.isHealthy).toBe(false);
        expect(health.recommendation).toBe("pause");
        expect(health.recentAnomalies).toBeGreaterThan(0);
        expect(health.metrics.spreadBps).toBe(100);
        expect(health.metrics.flowImbalance).toBe(1);
        expect(health.metrics.volatility).toBe(0);
        expect(health.metrics.lastUpdateAge).toBe(1000);

        vi.useRealTimers();
    });

    it("stores trade snapshots in history", () => {
        const detector: any = new AnomalyDetector(
            { minHistory: 1 },
            new WorkerLogger()
        );
        detector.updateBestQuotes(100, 101);
        detector.onEnrichedTrade({
            price: 100,
            quantity: 1,
            timestamp: Date.now(),
            buyerIsMaker: false,
            symbol: "TEST",
            tradeId: "1",
            originalTrade: { s: "TEST" },
            passiveBidVolume: 0,
            passiveAskVolume: 0,
            zonePassiveBidVolume: 0,
            zonePassiveAskVolume: 0,
        } as any);
        expect(detector.marketHistory.count()).toBe(1);
    });

    it("calculates mean and stddev", () => {
        const detector: any = new AnomalyDetector({}, new WorkerLogger());
        const mean = detector.calculateMean([1, 2, 3]);
        const std = detector.calculateStdDev([1, 2, 3], mean);
        expect(mean).toBeCloseTo(2);
        expect(std).toBeCloseTo(0.816, 3);
    });
});
