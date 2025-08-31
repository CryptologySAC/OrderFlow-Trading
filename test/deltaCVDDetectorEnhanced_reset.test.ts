import { describe, it, expect, beforeEach, vi } from "vitest";
import { DeltaCVDDetectorEnhanced } from "../src/indicators/deltaCVDDetectorEnhanced.js";

// Use type assertion to bypass complex mock setup for this focused test
const mockLogger = {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    isDebugEnabled: vi.fn(() => true),
    setCorrelationId: vi.fn(),
    removeCorrelationId: vi.fn(),
} as any;
const mockMetrics = {
    incrementCounter: vi.fn(),
} as any;
const mockSignalLogger = {} as any;
const mockPreprocessor = {
    findZonesNearPrice: vi.fn(() => []),
} as any;
const mockTraditionalIndicators = {
    validateSignal: vi.fn(() => ({ isValid: true, score: 0.8 })),
} as any;
const mockValidationLogger = {
    updateCurrentPrice: vi.fn(),
} as any;

describe("DeltaCVDDetectorEnhanced - Reset Functionality", () => {
    let detector: DeltaCVDDetectorEnhanced;

    const BASE_PRICE = 95000;

    beforeEach(() => {
        // Reset mocks
        vi.clearAllMocks();

        // Create detector with test configuration
        detector = new DeltaCVDDetectorEnhanced(
            "test-detector",
            {
                // Basic configuration for testing
                institutionalThreshold: 1.0, // Lower threshold for test data
                signalThreshold: 0.1, // Lower threshold for easier testing
                tradeRateWindowSize: 100,
                volumeRateWindowSize: 100,
                timeWindowIndex: 0,
                eventCooldownMs: 1000,
                cvdImbalanceThreshold: 0.5,
                volumeEfficiencyThreshold: 0.7,
                zoneSearchDistance: 10,
            } as any,
            mockPreprocessor,
            mockLogger,
            mockMetrics,
            mockValidationLogger,
            mockSignalLogger,
            mockTraditionalIndicators
        );

        // Reset running statistics before each test
        detector.resetRunningStatistics();
    });

    const createMockTrade = (
        price: number,
        quantity: number,
        timestamp: number,
        isBuy: boolean
    ): any => ({
        price,
        quantity,
        timestamp,
        isBuy,
        tickSize: 0.1,
        zoneData: {
            zones: [
                {
                    zoneId: "test-zone-1",
                    direction: "UP",
                    startPrice: BASE_PRICE - 100,
                    currentSize: 50,
                    age: 10000,
                    lastUpdate: timestamp,
                    aggressiveVolume: quantity * 0.7,
                    aggressiveBuyVolume: isBuy ? quantity * 0.7 : 0,
                    aggressiveSellVolume: isBuy ? 0 : quantity * 0.7,
                    passiveVolume: quantity * 0.3,
                    passiveBuyVolume: isBuy ? quantity * 0.3 : 0,
                    passiveSellVolume: isBuy ? 0 : quantity * 0.3,
                    tradeHistory: [],
                    zoneConfig: {
                        minVolume: 10,
                        maxAge: 300000,
                        consolidationThreshold: 0.02,
                    },
                },
            ],
            zoneConfig: {
                minVolume: 10,
                maxAge: 300000,
                consolidationThreshold: 0.02,
            },
        } as any,
    });

    it("should reset running statistics correctly", () => {
        // Process some trades to accumulate statistics
        const trades = [
            createMockTrade(BASE_PRICE, 2.0, 1000, true),
            createMockTrade(BASE_PRICE + 10, 1.5, 2000, false),
            createMockTrade(BASE_PRICE - 5, 3.0, 3000, true),
        ];

        // Process trades (this should accumulate statistics)
        trades.forEach((trade) => {
            detector.detect(trade);
        });

        // Reset statistics
        detector.resetRunningStatistics();

        // Process same trades again - should behave identically
        // (statistics should not carry over from previous processing)
        const results1 = trades.map((trade) => detector.detect(trade));

        // Reset again
        detector.resetRunningStatistics();

        // Process trades third time - should behave identically again
        const results2 = trades.map((trade) => detector.detect(trade));

        // Results should be identical (no accumulation effects)
        expect(results1).toEqual(results2);
    });

    it("should handle multiple test runs without cross-contamination", () => {
        const testScenarios = [
            {
                name: "Scenario 1",
                trades: [
                    createMockTrade(BASE_PRICE, 1.0, 1000, true),
                    createMockTrade(BASE_PRICE + 5, 2.0, 2000, false),
                ],
            },
            {
                name: "Scenario 2",
                trades: [
                    createMockTrade(BASE_PRICE - 10, 1.5, 3000, true),
                    createMockTrade(BASE_PRICE + 15, 2.5, 4000, false),
                    createMockTrade(BASE_PRICE, 1.0, 5000, true),
                ],
            },
        ];

        const results: any[] = [];

        // Run each scenario
        testScenarios.forEach((scenario) => {
            // Reset before each scenario
            detector.resetRunningStatistics();

            // Process trades and collect results
            const scenarioResults = scenario.trades.map((trade) =>
                detector.detect(trade)
            );
            results.push(scenarioResults);
        });

        // Run scenarios again in reverse order
        const results2: any[] = [];
        [...testScenarios].reverse().forEach((scenario) => {
            detector.resetRunningStatistics();
            const scenarioResults = scenario.trades.map((trade) =>
                detector.detect(trade)
            );
            results2.push(scenarioResults);
        });

        // Results should be consistent regardless of order
        expect(results[0]).toEqual(results2[1]); // First scenario matches reverse second
        expect(results[1]).toEqual(results2[0]); // Second scenario matches reverse first
    });

    it("should maintain detector functionality after reset", () => {
        // Process initial trades
        const initialTrades = [
            createMockTrade(BASE_PRICE, 2.0, 1000, true),
            createMockTrade(BASE_PRICE + 10, 1.0, 2000, false),
        ];

        initialTrades.forEach((trade) => detector.detect(trade));

        // Reset statistics
        detector.resetRunningStatistics();

        // Process new trades - detector should still function
        const newTrades = [
            createMockTrade(BASE_PRICE - 5, 1.5, 3000, true),
            createMockTrade(BASE_PRICE + 20, 2.5, 4000, false),
        ];

        const results = newTrades.map((trade) => detector.detect(trade));

        // Should return valid results (either signals or null)
        results.forEach((result) => {
            expect(result).toBeDefined();
            if (result !== null) {
                expect(result).toHaveProperty("type");
                expect(result).toHaveProperty("price");
                expect(result).toHaveProperty("timestamp");
            }
        });
    });
});
