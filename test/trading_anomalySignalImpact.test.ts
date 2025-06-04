import { describe, it, expect } from "vitest";
import { calculateAnomalyAdjustedConfidence } from "../src/trading/anomalySignalImpact";

describe("trading/anomalySignalImpact", () => {
    it("boosts confidence for positive anomaly", () => {
        const res = calculateAnomalyAdjustedConfidence(0.5, "momentum", [
            {
                type: "whale_activity",
                detectedAt: Date.now() - 60000,
                severity: "high",
            },
        ]);
        expect(res.adjustedConfidence).toBeGreaterThan(0.5);
    });
});
