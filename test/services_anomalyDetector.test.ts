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
});
