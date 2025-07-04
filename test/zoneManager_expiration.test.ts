import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ZoneManager } from "../src/trading/zoneManager";
import { MetricsCollector } from "../__mocks__/src/infrastructure/metricsCollector";
import type { EnrichedTradeEvent } from "../src/types/marketEvents";
import type { ZoneDetectionData } from "../src/types/zoneTypes";

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

describe("ZoneManager expiration", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it("invalidates zones past timeout", () => {
        const metrics = new MetricsCollector();
        const manager = new ZoneManager(
            { zoneTimeoutMs: 1000 },
            logger as unknown as any,
            metrics as unknown as any
        );

        const trade: EnrichedTradeEvent = {
            price: 100,
            quantity: 1,
            timestamp: Date.now(),
            buyerIsMaker: false,
            pair: "BTCUSDT",
            tradeId: "t1",
            originalTrade: {} as never,
            passiveBidVolume: 0,
            passiveAskVolume: 0,
            zonePassiveBidVolume: 0,
            zonePassiveAskVolume: 0,
        };

        const detection: ZoneDetectionData = {
            priceRange: { min: 100, max: 101, center: 100.5 },
            totalVolume: 1,
            averageOrderSize: 1,
            initialStrength: 0.5,
            confidence: 0.8,
            supportingFactors: {
                volumeConcentration: 0.5,
                orderSizeProfile: "retail",
                timeConsistency: 0.5,
                priceStability: 0.5,
                flowConsistency: 0.5,
            },
        };

        manager.createZone("accumulation", "BTCUSDT", trade, detection);
        expect(manager.getActiveZones("BTCUSDT")).toHaveLength(1);

        vi.advanceTimersByTime(1500);
        (
            manager as unknown as { cleanupExpiredZones: () => void }
        ).cleanupExpiredZones();
        expect(manager.getActiveZones("BTCUSDT")).toHaveLength(0);
    });
});
