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
        const detector = new AnomalyDetector(
            { minHistory: 1 },
            new Logger(),
            new DummySpoof() as any
        );
        const health = detector.getMarketHealth();
        expect(health.recommendation).toBe("insufficient_data");
    });

    it("roundToTick rounds according to tick size", () => {
        const detector: any = new AnomalyDetector(
            { tickSize: 0.5 },
            new Logger(),
            new DummySpoof() as any
        );
        expect(detector.roundToTick(1.23)).toBe(1);
        expect(detector.roundToTick(1.74)).toBe(1.5);
    });

    it("stores trade snapshots in history", () => {
        const detector: any = new AnomalyDetector(
            { minHistory: 1 },
            new Logger(),
            new DummySpoof() as any
        );
        detector.updateBestQuotes(100, 101);
        detector.onEnrichedTrade({
            price: 100,
            quantity: 1,
            timestamp: Date.now(),
            buyerIsMaker: false,
            pair: "TEST",
            tradeId: "1",
            originalTrade: { s: "TEST" } as any,
            passiveBidVolume: 0,
            passiveAskVolume: 0,
            zonePassiveBidVolume: 0,
            zonePassiveAskVolume: 0,
        });
        expect(detector.marketHistory.count()).toBe(1);
    });

    it("calculates mean and stddev", () => {
        const detector: any = new AnomalyDetector(
            {},
            new Logger(),
            new DummySpoof() as any
        );
        const mean = detector.calculateMean([1, 2, 3]);
        const std = detector.calculateStdDev([1, 2, 3], mean);
        expect(mean).toBeCloseTo(2);
        expect(std).toBeCloseTo(0.816, 3);
    });
});
