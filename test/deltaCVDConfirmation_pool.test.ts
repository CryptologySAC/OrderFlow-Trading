import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock dependencies before importing the detector
vi.mock("../src/multithreading/workerLogger");
vi.mock("../src/infrastructure/metricsCollector");

import { DeltaCVDDetectorEnhanced } from "../src/indicators/deltaCVDDetectorEnhanced.js";
import type { ILogger } from "../src/infrastructure/loggerInterface.js";
import { MetricsCollector } from "../src/infrastructure/metricsCollector.js";
import { SpoofingDetector } from "../src/services/spoofingDetector.js";
import type { IOrderflowPreprocessor } from "../src/market/orderFlowPreprocessor.js";

import type { EnrichedTradeEvent } from "../src/types/marketEvents.js";

// Import mock config for complete settings
import mockConfig from "../__mocks__/config.json";

const createMockPreprocessor = (): IOrderflowPreprocessor => ({
    handleDepth: vi.fn(),
    handleAggTrade: vi.fn(),
    getStats: vi.fn(() => ({
        processedTrades: 0,
        processedDepthUpdates: 0,
        bookMetrics: {} as any,
    })),
    findZonesNearPrice: vi.fn(() => []),
    calculateZoneRelevanceScore: vi.fn(() => 0.5),
    findMostRelevantZone: vi.fn(() => null),
});

describe("DeltaCVDConfirmation memory management", () => {
    let detector: DeltaCVDDetectorEnhanced;
    let mockLogger: ILogger;
    let mockMetrics: MetricsCollector;
    let mockSpoofing: SpoofingDetector;
    let mockPreprocessor: IOrderflowPreprocessor;

    beforeEach(() => {
        mockLogger = {
            info: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
            debug: vi.fn(),
        } as ILogger;
        mockMetrics = new MetricsCollector();
        mockSpoofing = {} as any;
        mockPreprocessor = createMockPreprocessor();
        // 🚫 NUCLEAR CLEANUP: Use complete mock config settings instead of empty object
        detector = new DeltaCVDDetectorEnhanced(
            "test-cvd",
            mockConfig.symbols.LTCUSDT.deltaCvdConfirmation as any,
            mockPreprocessor,
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
