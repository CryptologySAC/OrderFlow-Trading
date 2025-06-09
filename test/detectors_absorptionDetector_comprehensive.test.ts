// test/detectors_absorptionDetector_simple.test.ts
import { describe, it, expect, beforeEach, vi, MockedFunction } from "vitest";
import { AbsorptionDetector } from "../src/indicators/absorptionDetector.js";
import { Logger } from "../src/infrastructure/logger.js";
import { MetricsCollector } from "../src/infrastructure/metricsCollector.js";
import { SpoofingDetector } from "../src/services/spoofingDetector.js";
import { EnrichedTradeEvent } from "../src/types/marketEvents.js";
import { Detected } from "../src/indicators/interfaces/detectorInterfaces.js";

describe("AbsorptionDetector - Simple Test", () => {
    let detector: AbsorptionDetector;
    let mockCallback: MockedFunction<(signal: Detected) => void>;
    let mockLogger: Logger;
    let mockMetrics: MetricsCollector;
    let mockSpoofing: SpoofingDetector;

    const BTCUSDT_PRICE = 50000;

    beforeEach(() => {
        // Create mocks
        mockCallback = vi.fn();
        mockLogger = {
            info: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
            debug: vi.fn(),
        } as any;
        mockMetrics = {
            incrementCounter: vi.fn(),
            incrementMetric: vi.fn(),
            updateMetric: vi.fn(),
            recordHistogram: vi.fn(),
            recordGauge: vi.fn(),
            setGauge: vi.fn(),
            createCounter: vi.fn(),
            createHistogram: vi.fn(),
            createGauge: vi.fn(),
        } as any;
        mockSpoofing = {
            checkWallSpoofing: vi.fn().mockReturnValue(false),
            getWallDetectionMetrics: vi.fn().mockReturnValue({}),
        } as any;

        // Create detector with very permissive settings
        detector = new AbsorptionDetector(
            "test-absorption",
            mockCallback,
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
            mockLogger,
            mockSpoofing,
            mockMetrics
        );
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