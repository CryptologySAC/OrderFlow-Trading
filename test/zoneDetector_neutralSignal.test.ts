import { describe, it, expect, vi } from "vitest";
import { AccumulationZoneDetector } from "../src/indicators/accumulationZoneDetector";
import { MetricsCollector } from "../__mocks__/src/infrastructure/metricsCollector";
import type {
    AccumulationZone,
    ZoneUpdate,
    ZoneSignal,
} from "../src/types/zoneTypes";

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

describe("AccumulationZoneDetector neutral signal", () => {
    it("returns neutral expectedDirection on weakened zone", () => {
        const metrics = new MetricsCollector();
        const detector = new AccumulationZoneDetector(
            "test",
            "BTCUSDT",
            {},
            logger as unknown as any,
            metrics as unknown as any
        );

        const zone: AccumulationZone = {
            id: "z1",
            type: "accumulation",
            symbol: "BTCUSDT",
            startTime: Date.now(),
            priceRange: { min: 100, max: 101, center: 100.5, width: 1 },
            totalVolume: 10,
            averageOrderSize: 1,
            tradeCount: 10,
            timeInZone: 1000,
            intensity: 0,
            strength: 0.3,
            completion: 0.5,
            confidence: 0.8,
            significance: "minor",
            isActive: true,
            lastUpdate: Date.now(),
            strengthHistory: [],
            supportingFactors: {
                volumeConcentration: 0.5,
                orderSizeProfile: "retail",
                timeConsistency: 0.5,
                priceStability: 0.5,
                flowConsistency: 0.5,
            },
        };

        const update: ZoneUpdate = {
            updateType: "zone_weakened",
            zone,
            significance: "low",
            timestamp: Date.now(),
            changeMetrics: {
                strengthChange: -0.2,
                volumeAdded: 0,
                timeProgression: 0,
                completionChange: 0,
            },
        };

        const signals = (
            detector as unknown as {
                generateZoneSignals(u: ZoneUpdate): ZoneSignal[];
            }
        ).generateZoneSignals(update);

        expect(signals).toHaveLength(1);
        expect(signals[0].expectedDirection).toBe("neutral");
    });
});
