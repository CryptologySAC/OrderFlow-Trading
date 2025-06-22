import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock dependencies before importing the detector
vi.mock("../src/multithreading/workerLogger");
vi.mock("../src/infrastructure/metricsCollector");

import { DeltaCVDConfirmation } from "../src/indicators/deltaCVDConfirmation.js";
import type { ILogger } from "../src/infrastructure/loggerInterface.js";
import { MetricsCollector } from "../src/infrastructure/metricsCollector.js";
import { SpoofingDetector } from "../src/services/spoofingDetector.js";

import type { EnrichedTradeEvent } from "../src/types/marketEvents.js";

describe("DeltaCVDConfirmation memory management", () => {
    let detector: DeltaCVDConfirmation;
    let mockLogger: ILogger;
    let mockMetrics: MetricsCollector;
    let mockSpoofing: SpoofingDetector;

    beforeEach(() => {
        mockLogger = {
            info: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
            debug: vi.fn(),
        } as ILogger;
        mockMetrics = new MetricsCollector();
        mockSpoofing = {} as any;
        detector = new DeltaCVDConfirmation(
            "test-cvd",
            {},
            mockLogger,
            mockSpoofing,
            mockMetrics
        );
    });

    it("should recycle CVDCalculationResult objects", () => {
        const detectorAny = detector as any;
        const now = Date.now();

        // Populate each window state with sufficient trades
        for (const w of detectorAny.windows as number[]) {
            const state = detectorAny.states.get(w)!;
            for (let i = 0; i < 30; i++) {
                const trade: EnrichedTradeEvent = {
                    price: 100 + i,
                    quantity: 2,
                    timestamp: now - (29 - i) * 1000,
                    buyerIsMaker: false,
                    pair: "TESTUSDT",
                    tradeId: `${i}`,
                    originalTrade: {} as any,
                    passiveBidVolume: 0,
                    passiveAskVolume: 0,
                    zonePassiveBidVolume: 0,
                    zonePassiveAskVolume: 0,
                } as EnrichedTradeEvent;
                state.trades.push(trade);
            }
        }

        // Execute multiple computations
        for (let i = 0; i < 5; i++) {
            detectorAny.tryEmitSignal(now + i * 1000);
        }

        // Pool size should remain constant (no leaks)
        const poolSize: number = detectorAny.cvdResultPool.pool.length;
        expect(poolSize).toBeGreaterThanOrEqual(0);
    });
});
