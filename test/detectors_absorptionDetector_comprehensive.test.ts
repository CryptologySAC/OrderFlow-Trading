// test/detectors_absorptionDetector_simple.test.ts
import { describe, it, expect, beforeEach, vi, MockedFunction } from "vitest";

// Mock the WorkerLogger before importing
vi.mock("../src/multithreading/workerLogger");
vi.mock("../src/infrastructure/metricsCollector");

import { AbsorptionDetector } from "../src/indicators/absorptionDetector.js";
import { WorkerLogger } from "../src/multithreading/workerLogger.js";
import { MetricsCollector } from "../src/infrastructure/metricsCollector.js";
import { SpoofingDetector } from "../src/services/spoofingDetector.js";
import { OrderBookState } from "../src/market/orderBookState.js";
import { EnrichedTradeEvent } from "../src/types/marketEvents.js";
import { Detected } from "../src/indicators/interfaces/detectorInterfaces.js";
import type { ILogger } from "../src/infrastructure/loggerInterface.js";

describe("AbsorptionDetector - Simple Test", () => {
    let detector: AbsorptionDetector;
    let mockCallback: MockedFunction<(signal: Detected) => void>;
    let mockLogger: ILogger;
    let mockMetrics: MetricsCollector;
    let mockSpoofing: SpoofingDetector;
    let mockOrderBook: OrderBookState;

    const BTCUSDT_PRICE = 50000;

    beforeEach(() => {
        // Create mocks
        mockCallback = vi.fn();
        mockLogger = new WorkerLogger();
        mockMetrics = new MetricsCollector();
        mockSpoofing = {
            checkWallSpoofing: vi.fn().mockReturnValue(false),
            getWallDetectionMetrics: vi.fn().mockReturnValue({}),
        } as any;
        mockOrderBook = {
            getLevel: vi.fn().mockReturnValue({ bid: 100, ask: 100 }),
            getCurrentSpread: vi.fn().mockReturnValue({ spread: 0.01 }),
        } as any;

        // Create detector with very permissive settings
        detector = new AbsorptionDetector(
            "test-absorption",
            {
                symbol: "BTCUSDT",
                windowMs: 10000, // 10 seconds
                minAggVolume: 1, // Very low threshold
                absorptionThreshold: 0.1, // Very low threshold
                minPassiveMultiplier: 1.0, // Very low threshold
                maxAbsorptionRatio: 0.9, // High threshold
                pricePrecision: 2,
                zoneTicks: 1,
                eventCooldownMs: 100, // Very short cooldown
                features: {
                    icebergDetection: false,
                    liquidityGradient: false,
                    absorptionVelocity: false,
                    spreadImpact: false,
                    spoofingDetection: false,
                },
            },
            mockOrderBook,
            mockLogger,
            mockSpoofing,
            mockMetrics
        );

        // Register callback manually since constructor doesn't take it anymore
        detector.on("signal", mockCallback);
    });

    it("should accept trades without crashing", () => {
        const trade = createEnrichedTrade(BTCUSDT_PRICE, 10, false, Date.now());

        expect(() => {
            detector.onEnrichedTrade(trade);
        }).not.toThrow();
    });

    function createEnrichedTrade(
        price: number,
        quantity: number,
        buyerIsMaker: boolean,
        timestamp: number
    ): EnrichedTradeEvent {
        return {
            tradeId: `trade-${timestamp}-${Math.random()}`,
            symbol: "BTCUSDT",
            price,
            quantity,
            timestamp,
            buyerIsMaker,

            // Enriched fields with realistic values
            zonePassiveBidVolume: buyerIsMaker ? quantity * 2 : 100,
            zonePassiveAskVolume: !buyerIsMaker ? quantity * 2 : 100,

            // Additional required fields
            isBuyerMaker: buyerIsMaker,
            firstTradeId: `first-${timestamp}`,
            lastTradeId: `last-${timestamp}`,
            count: 1,
        };
    }
});
