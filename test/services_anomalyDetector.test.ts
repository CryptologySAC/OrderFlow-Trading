import { describe, it, expect } from "vitest";
import { AnomalyDetector } from "../src/services/anomalyDetector";
import { Logger } from "../src/infrastructure/logger";

vi.mock("../src/infrastructure/logger");

class DummySpoof {
    wasSpoofed = vi.fn().mockReturnValue(false);
    trackPassiveChange = vi.fn();
}

describe("services/AnomalyDetector", () => {
    it("reports insufficient data for market health", () => {
        const detector = new AnomalyDetector({ minHistory: 1 }, new Logger());
        const health = detector.getMarketHealth();
        expect(health.recommendation).toBe("insufficient_data");
    });

    it("calculates price statistics for anomaly detection", () => {
        const detector = new AnomalyDetector(
            { tickSize: 0.5, minHistory: 1 },
            new Logger()
        );
        detector.updateBestQuotes(100, 101);
        detector.onEnrichedTrade({
            price: 100,
            quantity: 1,
            timestamp: Date.now(),
            buyerIsMaker: false,
            symbol: "TEST",
            tradeId: "1",
            passiveBidVolume: 0,
            originalTrade: { s: "TEST" },
            passiveAskVolume: 0,
            zonePassiveBidVolume: 0,
            zonePassiveAskVolume: 0,
        } as any);
        const health = detector.getMarketHealth();
        expect(health.isHealthy).toBeDefined();
        expect(health.recommendation).toBeDefined();
    });

    it("stores trade snapshots in history", () => {
        const detector: any = new AnomalyDetector(
            { minHistory: 1 },
            new Logger()
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
        const detector: any = new AnomalyDetector({}, new Logger());
        const mean = detector.calculateMean([1, 2, 3]);
        const std = detector.calculateStdDev([1, 2, 3], mean);
        expect(mean).toBeCloseTo(2);
        expect(std).toBeCloseTo(0.816, 3);
    });
});
