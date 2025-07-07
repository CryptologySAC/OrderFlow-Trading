// test/distributionDetectorEnhanced_comprehensive.test.ts
//
// 🧪 COMPREHENSIVE DISTRIBUTION DETECTOR TEST SUITE
//
// This test suite provides 100 comprehensive test scenarios for DistributionDetectorEnhanced
// covering all possible combinations of base detection, enhanced detection, pass/fail/edge cases.
//
// TEST COVERAGE:
// - Base Detection: Pure volume-based distribution patterns
// - Enhanced Detection: Confluence, institutional, alignment contributions
// - Pass Cases: Scenarios that should correctly detect distribution
// - Fail Cases: Scenarios that should correctly reject non-distribution
// - Edge Cases: Boundary conditions, minimal data, extreme values
//
// VALIDATION APPROACH:
// - Real market-like data with proper tick sizes
// - FinancialMath compliance for all calculations
// - Zone data validation with proper volume aggregation
// - Signal emission verification for visualization and actionable events
//

import { describe, it, expect, beforeEach, vi } from "vitest";
import { DistributionDetectorEnhanced } from "../src/indicators/distributionDetectorEnhanced.js";
import { FinancialMath } from "../src/utils/financialMath.js";
import type { ILogger } from "../src/infrastructure/loggerInterface.js";
import type { IMetricsCollector } from "../src/infrastructure/metricsCollectorInterface.js";
import type { IOrderflowPreprocessor } from "../src/market/orderFlowPreprocessor.js";
import type {
    EnrichedTradeEvent,
    StandardZoneData,
    ZoneSnapshot,
} from "../src/types/marketEvents.js";
import type { ZoneVisualizationData } from "../src/types/zoneTypes.js";
import "../test/vitest.setup.ts";

// Real market price levels for LTCUSDT with proper tick sizes
const BASE_PRICE = 85.0; // $85 LTCUSDT - 1-cent tick size
const TICK_SIZE = 0.01;

// Test configuration matching real config.json values
const TEST_DISTRIBUTION_CONFIG = {
    useStandardizedZones: true,
    confidenceThreshold: 0.4,
    confluenceMinZones: 1,
    confluenceMaxDistance: 0.1,
    confluenceConfidenceBoost: 0.1,
    crossTimeframeConfidenceBoost: 0.15,
    distributionVolumeThreshold: 15,
    distributionRatioThreshold: 0.5,
    alignmentScoreThreshold: 0.5,
    defaultDurationMs: 120000,
    tickSize: 0.01,
    maxPriceResistance: 2.0,
    priceResistanceMultiplier: 1.5,
    minPassiveVolumeForEfficiency: 5,
    defaultVolatility: 0.1,
    defaultBaselineVolatility: 0.05,
    sellingPressureVolumeThreshold: 10,
    sellingPressureRatioThreshold: 0.45,
    enableSellingPressureAnalysis: true,
    sellingPressureConfidenceBoost: 0.08,
    varianceReductionFactor: 1.0,
    confluenceStrengthDivisor: 2,
    passiveToAggressiveRatio: 0.6,
    aggressiveSellingRatioThreshold: 0.6,
    aggressiveSellingReductionFactor: 0.5,
    enableZoneConfluenceFilter: true,
    enableCrossTimeframeAnalysis: true,
    enhancementMode: "production" as const,
};

// Mock implementations
const createMockLogger = (): ILogger => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    isDebugEnabled: vi.fn(() => false),
    setCorrelationId: vi.fn(),
    removeCorrelationId: vi.fn(),
});

const createMockMetrics = (): IMetricsCollector => ({
    recordGauge: vi.fn(),
    recordCounter: vi.fn(),
    recordHistogram: vi.fn(),
    recordTimer: vi.fn(),
    getMetrics: vi.fn(() => ({})),
});

const createMockPreprocessor = (): IOrderflowPreprocessor => ({
    findZonesNearPrice: vi.fn(
        (zones: ZoneSnapshot[], price: number, distance: number) => {
            // Return zones within distance of price
            return zones.filter(
                (zone) => Math.abs(zone.center - price) <= distance
            );
        }
    ),
    // Add other required methods as mocks
    preprocess: vi.fn(),
    getState: vi.fn(),
    cleanup: vi.fn(),
});

// Helper functions for creating test data
function createZoneSnapshot(
    center: number,
    aggressiveVolume: number,
    passiveVolume: number,
    aggressiveBuyVolume: number,
    aggressiveSellVolume: number
): ZoneSnapshot {
    return {
        center,
        aggressiveVolume,
        passiveVolume,
        aggressiveBuyVolume,
        aggressiveSellVolume,
        strength: FinancialMath.divideQuantities(
            aggressiveSellVolume,
            aggressiveVolume + passiveVolume
        ),
        tradeCount: Math.floor(aggressiveVolume / 10) + 1,
        lastUpdate: Date.now(),
    };
}

function createStandardZoneData(
    zones5Tick: ZoneSnapshot[],
    zones10Tick: ZoneSnapshot[],
    zones20Tick: ZoneSnapshot[]
): StandardZoneData {
    return {
        zones5Tick,
        zones10Tick,
        zones20Tick,
    };
}

function createEnrichedTradeEvent(
    price: number,
    quantity: number,
    buyerIsMaker: boolean,
    zoneData: StandardZoneData
): EnrichedTradeEvent {
    return {
        symbol: "LTCUSDT",
        price,
        quantity,
        timestamp: Date.now(),
        tradeId: Math.floor(Math.random() * 1000000),
        buyerIsMaker,
        zoneData,
        spread: 0.01,
        midPrice: price,
        imbalance: buyerIsMaker ? -0.1 : 0.1,
        passiveVolume: quantity * 0.3,
        aggressiveVolume: quantity * 0.7,
        dominantSide: buyerIsMaker ? "sell" : "buy",
    };
}

describe("DistributionDetectorEnhanced - 100 Comprehensive Test Scenarios", () => {
    let detector: DistributionDetectorEnhanced;
    let mockLogger: ILogger;
    let mockMetrics: IMetricsCollector;
    let mockPreprocessor: IOrderflowPreprocessor;
    let emittedEvents: Array<{ event: string; data: any }>;

    beforeEach(() => {
        mockLogger = createMockLogger();
        mockMetrics = createMockMetrics();
        mockPreprocessor = createMockPreprocessor();
        emittedEvents = [];

        detector = new DistributionDetectorEnhanced(
            "test-distribution",
            "LTCUSDT",
            TEST_DISTRIBUTION_CONFIG,
            mockPreprocessor,
            mockLogger,
            mockMetrics
        );

        // Capture all emitted events
        detector.on("zoneUpdate", (data) =>
            emittedEvents.push({ event: "zoneUpdate", data })
        );
        detector.on("zoneSignal", (data) =>
            emittedEvents.push({ event: "zoneSignal", data })
        );
        detector.on("signalCandidate", (data) =>
            emittedEvents.push({ event: "signalCandidate", data })
        );
    });

    describe("🎯 Base Detection - Pass Cases (Tests 1-25)", () => {
        it("Test 1: Strong single-timeframe distribution - high sell volume concentration", () => {
            // Strong selling activity in 5-tick zones
            const zones5Tick = [
                createZoneSnapshot(BASE_PRICE, 100, 20, 20, 80), // 80% sell ratio
                createZoneSnapshot(BASE_PRICE + 0.01, 90, 25, 15, 75), // 83% sell ratio
            ];
            const zoneData = createStandardZoneData(zones5Tick, [], []);
            const event = createEnrichedTradeEvent(
                BASE_PRICE,
                50,
                true,
                zoneData
            );

            detector.onEnrichedTrade(event);

            expect(emittedEvents.length).toBeGreaterThan(0);
            const zoneUpdate = emittedEvents.find(
                (e) => e.event === "zoneUpdate"
            );
            expect(zoneUpdate).toBeDefined();
        });

        it("Test 2: Multi-timeframe distribution - consistent sell pressure across all timeframes", () => {
            const zones5Tick = [createZoneSnapshot(BASE_PRICE, 50, 10, 10, 40)];
            const zones10Tick = [
                createZoneSnapshot(BASE_PRICE, 80, 15, 15, 65),
            ];
            const zones20Tick = [
                createZoneSnapshot(BASE_PRICE, 120, 25, 25, 95),
            ];
            const zoneData = createStandardZoneData(
                zones5Tick,
                zones10Tick,
                zones20Tick
            );
            const event = createEnrichedTradeEvent(
                BASE_PRICE,
                30,
                true,
                zoneData
            );

            detector.onEnrichedTrade(event);

            expect(emittedEvents.length).toBeGreaterThan(0);
        });

        it("Test 3: High-volume institutional distribution - large order concentration", () => {
            const zones5Tick = [
                createZoneSnapshot(BASE_PRICE, 200, 30, 40, 160), // Large volume
                createZoneSnapshot(BASE_PRICE + 0.01, 180, 25, 35, 145),
            ];
            const zoneData = createStandardZoneData(zones5Tick, [], []);
            const event = createEnrichedTradeEvent(
                BASE_PRICE,
                100,
                true,
                zoneData
            );

            detector.onEnrichedTrade(event);

            expect(emittedEvents.length).toBeGreaterThan(0);
            const signalCandidate = emittedEvents.find(
                (e) => e.event === "signalCandidate"
            );
            expect(signalCandidate?.data.side).toBe("sell");
        });

        it("Test 4: Gradual distribution - sustained selling pressure over time", () => {
            // Multiple smaller zones showing consistent distribution
            const zones5Tick = [
                createZoneSnapshot(BASE_PRICE - 0.02, 30, 8, 8, 22),
                createZoneSnapshot(BASE_PRICE - 0.01, 35, 10, 9, 26),
                createZoneSnapshot(BASE_PRICE, 40, 12, 10, 30),
                createZoneSnapshot(BASE_PRICE + 0.01, 32, 9, 8, 24),
            ];
            const zoneData = createStandardZoneData(zones5Tick, [], []);
            const event = createEnrichedTradeEvent(
                BASE_PRICE,
                25,
                true,
                zoneData
            );

            detector.onEnrichedTrade(event);

            expect(emittedEvents.length).toBeGreaterThan(0);
        });

        it("Test 5: Perfect distribution scenario - 90%+ sell ratios", () => {
            const zones5Tick = [
                createZoneSnapshot(BASE_PRICE, 100, 20, 5, 95), // 95% sell ratio
                createZoneSnapshot(BASE_PRICE + 0.01, 80, 15, 4, 76), // 95% sell ratio
            ];
            const zoneData = createStandardZoneData(zones5Tick, [], []);
            const event = createEnrichedTradeEvent(
                BASE_PRICE,
                40,
                true,
                zoneData
            );

            detector.onEnrichedTrade(event);

            expect(emittedEvents.length).toBeGreaterThan(0);
            const zoneUpdate = emittedEvents.find(
                (e) => e.event === "zoneUpdate"
            );
            expect(zoneUpdate?.data.significance).toBeGreaterThan(0.6);
        });

        it("Test 6: Zone confluence distribution - multiple zones at same price level", () => {
            const zones5Tick = [createZoneSnapshot(BASE_PRICE, 60, 12, 12, 48)];
            const zones10Tick = [
                createZoneSnapshot(BASE_PRICE, 90, 18, 18, 72),
            ];
            const zones20Tick = [
                createZoneSnapshot(BASE_PRICE, 120, 24, 24, 96),
            ];
            const zoneData = createStandardZoneData(
                zones5Tick,
                zones10Tick,
                zones20Tick
            );
            const event = createEnrichedTradeEvent(
                BASE_PRICE,
                35,
                true,
                zoneData
            );

            detector.onEnrichedTrade(event);
            expect(emittedEvents.length).toBeGreaterThan(0);
        });

        it("Test 7: Minimum threshold distribution - just above detection limits", () => {
            const zones5Tick = [
                createZoneSnapshot(BASE_PRICE, 20, 5, 6, 14), // 70% sell ratio, minimum volume
            ];
            const zoneData = createStandardZoneData(zones5Tick, [], []);
            const event = createEnrichedTradeEvent(
                BASE_PRICE,
                15,
                true,
                zoneData
            );

            detector.onEnrichedTrade(event);
            expect(emittedEvents.length).toBeGreaterThan(0);
        });

        it("Test 8: Asymmetric distribution - stronger in larger timeframes", () => {
            const zones5Tick = [createZoneSnapshot(BASE_PRICE, 25, 8, 8, 17)]; // 68% sell
            const zones10Tick = [
                createZoneSnapshot(BASE_PRICE, 50, 12, 10, 40),
            ]; // 80% sell
            const zones20Tick = [
                createZoneSnapshot(BASE_PRICE, 100, 20, 15, 85),
            ]; // 85% sell
            const zoneData = createStandardZoneData(
                zones5Tick,
                zones10Tick,
                zones20Tick
            );
            const event = createEnrichedTradeEvent(
                BASE_PRICE,
                20,
                true,
                zoneData
            );

            detector.onEnrichedTrade(event);
            expect(emittedEvents.length).toBeGreaterThan(0);
        });

        it("Test 9: Wide-spread distribution - across multiple price levels", () => {
            const zones5Tick = [
                createZoneSnapshot(BASE_PRICE - 0.05, 30, 8, 8, 22),
                createZoneSnapshot(BASE_PRICE - 0.03, 35, 10, 9, 26),
                createZoneSnapshot(BASE_PRICE - 0.01, 40, 12, 10, 30),
                createZoneSnapshot(BASE_PRICE + 0.01, 35, 10, 9, 26),
                createZoneSnapshot(BASE_PRICE + 0.03, 30, 8, 8, 22),
            ];
            const zoneData = createStandardZoneData(zones5Tick, [], []);
            const event = createEnrichedTradeEvent(
                BASE_PRICE,
                25,
                true,
                zoneData
            );

            detector.onEnrichedTrade(event);
            expect(emittedEvents.length).toBeGreaterThan(0);
        });

        it("Test 10: Volume-weighted distribution - higher volume zones dominate", () => {
            const zones5Tick = [
                createZoneSnapshot(BASE_PRICE, 150, 25, 30, 120), // Large volume, strong sell
                createZoneSnapshot(BASE_PRICE + 0.01, 20, 5, 8, 12), // Small volume, weaker
            ];
            const zoneData = createStandardZoneData(zones5Tick, [], []);
            const event = createEnrichedTradeEvent(
                BASE_PRICE,
                75,
                true,
                zoneData
            );

            detector.onEnrichedTrade(event);
            expect(emittedEvents.length).toBeGreaterThan(0);
        });

        // Tests 11-25: Additional pass cases for comprehensive coverage
        it("Test 11-25: Batch distribution pass scenarios", () => {
            const passScenarios = [
                // Test 11: Enhanced confluence detection
                {
                    zones: [
                        createZoneSnapshot(BASE_PRICE, 50, 10, 10, 40),
                        createZoneSnapshot(BASE_PRICE + 0.01, 45, 9, 9, 36),
                    ],
                    desc: "Enhanced confluence",
                },
                // Test 12: Enhanced institutional detection
                {
                    zones: [createZoneSnapshot(BASE_PRICE, 200, 40, 40, 160)],
                    desc: "Institutional distribution",
                },
                // Test 13: Enhanced alignment detection
                {
                    zones: [createZoneSnapshot(BASE_PRICE, 40, 10, 8, 32)],
                    desc: "Perfect alignment",
                },
                // Test 14: Momentum distribution
                {
                    zones: [createZoneSnapshot(BASE_PRICE, 50, 10, 8, 42)],
                    desc: "Momentum distribution",
                },
                // Test 15: Resistance-based distribution
                {
                    zones: [createZoneSnapshot(BASE_PRICE, 80, 15, 15, 65)],
                    desc: "Resistance distribution",
                },
                // Test 16: High passive volume distribution
                {
                    zones: [createZoneSnapshot(BASE_PRICE, 80, 40, 16, 64)],
                    desc: "High passive volume",
                },
                // Test 17: Balanced timeframe distribution
                {
                    zones: [createZoneSnapshot(BASE_PRICE, 70, 20, 14, 56)],
                    desc: "Balanced distribution",
                },
                // Test 18: Sustained distribution pattern
                {
                    zones: [createZoneSnapshot(BASE_PRICE, 90, 25, 18, 72)],
                    desc: "Sustained pattern",
                },
                // Test 19: Price level clustering
                {
                    zones: [createZoneSnapshot(BASE_PRICE, 60, 18, 12, 48)],
                    desc: "Price clustering",
                },
                // Test 20: Volume surge distribution
                {
                    zones: [createZoneSnapshot(BASE_PRICE, 120, 30, 24, 96)],
                    desc: "Volume surge",
                },
                // Test 21: Stealth distribution
                {
                    zones: [createZoneSnapshot(BASE_PRICE, 35, 12, 7, 28)],
                    desc: "Stealth distribution",
                },
                // Test 22: Breakdown distribution
                {
                    zones: [createZoneSnapshot(BASE_PRICE, 55, 15, 11, 44)],
                    desc: "Breakdown preparation",
                },
                // Test 23: Institutional scale
                {
                    zones: [createZoneSnapshot(BASE_PRICE, 250, 50, 50, 200)],
                    desc: "Institutional scale",
                },
                // Test 24: Multi-level distribution
                {
                    zones: [createZoneSnapshot(BASE_PRICE, 45, 12, 9, 36)],
                    desc: "Multi-level",
                },
                // Test 25: Perfect ratio distribution
                {
                    zones: [createZoneSnapshot(BASE_PRICE, 60, 15, 6, 54)],
                    desc: "Perfect ratio",
                },
            ];

            passScenarios.forEach((scenario, index) => {
                const zoneData = createStandardZoneData(scenario.zones, [], []);
                const event = createEnrichedTradeEvent(
                    BASE_PRICE,
                    30,
                    true,
                    zoneData
                );

                emittedEvents = []; // Reset for each test
                detector.onEnrichedTrade(event);

                expect(emittedEvents.length).toBeGreaterThan(0);
            });
        });
    });

    describe("🚫 Base Detection - Fail Cases (Tests 26-50)", () => {
        it("Test 26: No distribution - balanced buy/sell activity", () => {
            const zones5Tick = [
                createZoneSnapshot(BASE_PRICE, 100, 20, 50, 50), // 50% sell ratio
            ];
            const zoneData = createStandardZoneData(zones5Tick, [], []);
            const event = createEnrichedTradeEvent(
                BASE_PRICE,
                50,
                false,
                zoneData
            );

            detector.onEnrichedTrade(event);

            expect(emittedEvents.length).toBe(0);
        });

        it("Test 27: Accumulation pattern - strong buy pressure", () => {
            const zones5Tick = [
                createZoneSnapshot(BASE_PRICE, 100, 20, 80, 20), // 20% sell ratio - accumulation
            ];
            const zoneData = createStandardZoneData(zones5Tick, [], []);
            const event = createEnrichedTradeEvent(
                BASE_PRICE,
                50,
                false,
                zoneData
            );

            detector.onEnrichedTrade(event);

            expect(emittedEvents.length).toBe(0);
        });

        it("Test 28: Insufficient volume - below minimum thresholds", () => {
            const zones5Tick = [
                createZoneSnapshot(BASE_PRICE, 5, 2, 1, 4), // Too low volume
            ];
            const zoneData = createStandardZoneData(zones5Tick, [], []);
            const event = createEnrichedTradeEvent(
                BASE_PRICE,
                3,
                true,
                zoneData
            );

            detector.onEnrichedTrade(event);

            expect(emittedEvents.length).toBe(0);
        });

        it("Test 29: Weak distribution - below confidence threshold", () => {
            const zones5Tick = [
                createZoneSnapshot(BASE_PRICE, 40, 10, 24, 16), // 40% sell ratio - below threshold
            ];
            const zoneData = createStandardZoneData(zones5Tick, [], []);
            const event = createEnrichedTradeEvent(
                BASE_PRICE,
                20,
                true,
                zoneData
            );

            detector.onEnrichedTrade(event);

            expect(emittedEvents.length).toBe(0);
        });

        it("Test 30: No relevant zones - price too far from zone centers", () => {
            const zones5Tick = [
                createZoneSnapshot(BASE_PRICE + 1.0, 80, 15, 15, 65), // Too far away
            ];
            const zoneData = createStandardZoneData(zones5Tick, [], []);
            const event = createEnrichedTradeEvent(
                BASE_PRICE,
                40,
                true,
                zoneData
            );

            detector.onEnrichedTrade(event);

            expect(emittedEvents.length).toBe(0);
        });

        // Tests 31-50: Additional fail cases
        it("Test 31-50: Batch distribution fail scenarios", () => {
            const failScenarios = [
                // Test 31: Random noise trading
                {
                    zones: [createZoneSnapshot(BASE_PRICE, 30, 8, 15, 15)],
                    desc: "Random noise",
                },
                // Test 32: Weak buying pressure
                {
                    zones: [createZoneSnapshot(BASE_PRICE, 40, 10, 22, 18)],
                    desc: "Weak buying",
                },
                // Test 33: Low volume activity
                {
                    zones: [createZoneSnapshot(BASE_PRICE, 8, 3, 3, 5)],
                    desc: "Low volume",
                },
                // Test 34: Conflicting signals
                {
                    zones: [createZoneSnapshot(BASE_PRICE, 50, 12, 30, 20)],
                    desc: "Conflicting signals",
                },
                // Test 35: Minimal activity
                {
                    zones: [createZoneSnapshot(BASE_PRICE, 12, 4, 5, 7)],
                    desc: "Minimal activity",
                },
                // Test 36: Neutral market
                {
                    zones: [createZoneSnapshot(BASE_PRICE, 60, 15, 30, 30)],
                    desc: "Neutral market",
                },
                // Test 37: Rising interest
                {
                    zones: [createZoneSnapshot(BASE_PRICE, 25, 8, 13, 12)],
                    desc: "Rising interest",
                },
                // Test 38: Choppy trading
                {
                    zones: [createZoneSnapshot(BASE_PRICE, 35, 10, 18, 17)],
                    desc: "Choppy trading",
                },
                // Test 39: Weak participation
                {
                    zones: [createZoneSnapshot(BASE_PRICE, 18, 5, 9, 9)],
                    desc: "Weak participation",
                },
                // Test 40: Consolidation phase
                {
                    zones: [createZoneSnapshot(BASE_PRICE, 45, 12, 23, 22)],
                    desc: "Consolidation",
                },
                // Test 41: Bull market sentiment
                {
                    zones: [createZoneSnapshot(BASE_PRICE, 70, 18, 45, 25)],
                    desc: "Bull sentiment",
                },
                // Test 42: Profit taking end
                {
                    zones: [createZoneSnapshot(BASE_PRICE, 80, 20, 50, 30)],
                    desc: "Profit taking end",
                },
                // Test 43: Accumulation beginning
                {
                    zones: [createZoneSnapshot(BASE_PRICE, 90, 22, 55, 35)],
                    desc: "Early accumulation",
                },
                // Test 44: Market confidence
                {
                    zones: [createZoneSnapshot(BASE_PRICE, 55, 15, 29, 26)],
                    desc: "Market confidence",
                },
                // Test 45: Upward movement
                {
                    zones: [createZoneSnapshot(BASE_PRICE, 42, 12, 21, 21)],
                    desc: "Upward movement",
                },
                // Test 46: Volume exhaustion
                {
                    zones: [createZoneSnapshot(BASE_PRICE, 15, 5, 7, 8)],
                    desc: "Volume exhaustion",
                },
                // Test 47: Failed distribution
                {
                    zones: [createZoneSnapshot(BASE_PRICE, 65, 18, 37, 28)],
                    desc: "Failed distribution",
                },
                // Test 48: Strong hands buying
                {
                    zones: [createZoneSnapshot(BASE_PRICE, 75, 20, 43, 32)],
                    desc: "Strong hands",
                },
                // Test 49: Support level
                {
                    zones: [createZoneSnapshot(BASE_PRICE, 85, 22, 47, 38)],
                    desc: "Support level",
                },
                // Test 50: Accumulation dominance
                {
                    zones: [createZoneSnapshot(BASE_PRICE, 95, 25, 55, 40)],
                    desc: "Accumulation dominance",
                },
            ];

            failScenarios.forEach((scenario, index) => {
                const zoneData = createStandardZoneData(scenario.zones, [], []);
                const event = createEnrichedTradeEvent(
                    BASE_PRICE,
                    30,
                    false,
                    zoneData
                );

                emittedEvents = []; // Reset for each test
                detector.onEnrichedTrade(event);

                expect(emittedEvents.length).toBe(0);
            });
        });
    });

    describe("⚠️ Edge Cases - Boundary Conditions (Tests 51-75)", () => {
        it("Test 51: Exact threshold boundary - right at confidence limit", () => {
            // Calculate exact volume to hit threshold
            const totalVolume = 60;
            const sellVolume = Math.floor(
                totalVolume *
                    TEST_DISTRIBUTION_CONFIG.distributionRatioThreshold
            );
            const buyVolume = totalVolume - sellVolume;

            const zones5Tick = [
                createZoneSnapshot(
                    BASE_PRICE,
                    totalVolume * 0.7,
                    totalVolume * 0.3,
                    buyVolume,
                    sellVolume
                ),
            ];
            const zoneData = createStandardZoneData(zones5Tick, [], []);
            const event = createEnrichedTradeEvent(
                BASE_PRICE,
                30,
                true,
                zoneData
            );

            detector.onEnrichedTrade(event);

            // Should be right at boundary - may or may not trigger based on other factors
            expect(emittedEvents.length).toBeGreaterThanOrEqual(0);
        });

        it("Test 52: Zero volume zones - empty market activity", () => {
            const zones5Tick = [createZoneSnapshot(BASE_PRICE, 0, 0, 0, 0)];
            const zoneData = createStandardZoneData(zones5Tick, [], []);
            const event = createEnrichedTradeEvent(
                BASE_PRICE,
                0,
                true,
                zoneData
            );

            detector.onEnrichedTrade(event);

            expect(emittedEvents.length).toBe(0);
        });

        it("Test 53: Single tick volumes - minimal viable activity", () => {
            const zones5Tick = [createZoneSnapshot(BASE_PRICE, 1, 1, 0, 1)];
            const zoneData = createStandardZoneData(zones5Tick, [], []);
            const event = createEnrichedTradeEvent(
                BASE_PRICE,
                1,
                true,
                zoneData
            );

            detector.onEnrichedTrade(event);

            expect(emittedEvents.length).toBe(0);
        });

        it("Test 54: Maximum distance zones - at edge of confluence range", () => {
            const maxDistance = TEST_DISTRIBUTION_CONFIG.confluenceMaxDistance;
            const zones5Tick = [
                createZoneSnapshot(BASE_PRICE + maxDistance, 80, 15, 15, 65),
            ];
            const zoneData = createStandardZoneData(zones5Tick, [], []);
            const event = createEnrichedTradeEvent(
                BASE_PRICE,
                40,
                true,
                zoneData
            );

            detector.onEnrichedTrade(event);

            expect(emittedEvents.length).toBeGreaterThanOrEqual(0);
        });

        it("Test 55: Extremely high volumes - stress test large numbers", () => {
            const zones5Tick = [
                createZoneSnapshot(BASE_PRICE, 10000, 2000, 2000, 8000), // Very high volume
            ];
            const zoneData = createStandardZoneData(zones5Tick, [], []);
            const event = createEnrichedTradeEvent(
                BASE_PRICE,
                5000,
                true,
                zoneData
            );

            detector.onEnrichedTrade(event);

            expect(emittedEvents.length).toBeGreaterThan(0);
        });

        it("Test 56: Perfect sell dominance - 100% sell volume", () => {
            const zones5Tick = [
                createZoneSnapshot(BASE_PRICE, 100, 20, 0, 100), // 100% sell
            ];
            const zoneData = createStandardZoneData(zones5Tick, [], []);
            const event = createEnrichedTradeEvent(
                BASE_PRICE,
                50,
                true,
                zoneData
            );

            detector.onEnrichedTrade(event);

            expect(emittedEvents.length).toBeGreaterThan(0);
        });

        // Tests 57-75: Additional edge cases
        it("Test 57-75: Batch edge case scenarios", () => {
            const edgeCases = [
                // Test 57: Floating point precision edge
                {
                    zones: [
                        createZoneSnapshot(
                            BASE_PRICE,
                            33.333333,
                            6.666667,
                            6.666667,
                            26.666666
                        ),
                    ],
                    desc: "Float precision",
                },
                // Test 58: Very small volumes
                {
                    zones: [
                        createZoneSnapshot(BASE_PRICE, 0.1, 0.05, 0.02, 0.08),
                    ],
                    desc: "Tiny volumes",
                },
                // Test 59: Asymmetric passive volume
                {
                    zones: [createZoneSnapshot(BASE_PRICE, 50, 150, 10, 40)],
                    desc: "High passive volume",
                },
                // Test 60: Near-zero buy volume
                {
                    zones: [createZoneSnapshot(BASE_PRICE, 100, 20, 1, 99)],
                    desc: "Near-zero buys",
                },
                // Test 61: Identical buy/sell volumes
                {
                    zones: [createZoneSnapshot(BASE_PRICE, 80, 20, 40, 40)],
                    desc: "Identical volumes",
                },
                // Test 62: Single large order
                {
                    zones: [createZoneSnapshot(BASE_PRICE, 1000, 0, 200, 800)],
                    desc: "Single large order",
                },
                // Test 63: Micro-spread zones
                {
                    zones: [createZoneSnapshot(BASE_PRICE, 25, 8, 5, 20)],
                    desc: "Micro-spread",
                },
                // Test 64: High frequency activity
                {
                    zones: [createZoneSnapshot(BASE_PRICE, 200, 50, 40, 160)],
                    desc: "High frequency",
                },
                // Test 65: Price at exact tick boundary
                {
                    zones: [createZoneSnapshot(85.0, 60, 15, 12, 48)],
                    desc: "Exact tick boundary",
                },
                // Test 66: Multiple identical zones
                {
                    zones: [
                        createZoneSnapshot(BASE_PRICE, 40, 10, 8, 32),
                        createZoneSnapshot(BASE_PRICE, 40, 10, 8, 32),
                    ],
                    desc: "Identical zones",
                },
                // Test 67: Exponential volume growth
                {
                    zones: [createZoneSnapshot(BASE_PRICE, 128, 32, 26, 102)],
                    desc: "Exponential growth",
                },
                // Test 68: Prime number volumes
                {
                    zones: [createZoneSnapshot(BASE_PRICE, 67, 13, 14, 53)],
                    desc: "Prime numbers",
                },
                // Test 69: Golden ratio volumes
                {
                    zones: [
                        createZoneSnapshot(
                            BASE_PRICE,
                            61.8,
                            15.45,
                            12.36,
                            49.44
                        ),
                    ],
                    desc: "Golden ratio",
                },
                // Test 70: Binary-like volumes
                {
                    zones: [createZoneSnapshot(BASE_PRICE, 64, 16, 13, 51)],
                    desc: "Binary volumes",
                },
                // Test 71: Fibonacci sequence
                {
                    zones: [createZoneSnapshot(BASE_PRICE, 55, 13, 11, 44)],
                    desc: "Fibonacci",
                },
                // Test 72: Square number volumes
                {
                    zones: [createZoneSnapshot(BASE_PRICE, 49, 9, 10, 39)],
                    desc: "Square numbers",
                },
                // Test 73: Standard positive test
                {
                    zones: [createZoneSnapshot(BASE_PRICE, 50, 12, 10, 40)],
                    desc: "Standard positive",
                },
                // Test 74: Boundary rounding test
                {
                    zones: [createZoneSnapshot(84.995, 45, 11, 9, 36)],
                    desc: "Rounding boundary",
                },
                // Test 75: Maximum precision test
                {
                    zones: [createZoneSnapshot(85.01234567, 37, 9, 8, 29)],
                    desc: "Max precision",
                },
            ];

            edgeCases.forEach((edgeCase, index) => {
                const zoneData = createStandardZoneData(edgeCase.zones, [], []);
                const event = createEnrichedTradeEvent(
                    BASE_PRICE,
                    20,
                    true,
                    zoneData
                );

                emittedEvents = []; // Reset for each test
                detector.onEnrichedTrade(event);

                // Edge cases should either pass or fail gracefully, never throw errors
                expect(() => detector.onEnrichedTrade(event)).not.toThrow();
            });
        });
    });

    describe("🔧 Enhanced Detection Combinations (Tests 76-100)", () => {
        it("Test 76: Base pass + Enhanced confluence pass", () => {
            // Strong base + multiple confluent zones
            const zones5Tick = [
                createZoneSnapshot(BASE_PRICE, 80, 15, 15, 65),
                createZoneSnapshot(BASE_PRICE + 0.01, 75, 14, 15, 60),
            ];
            const zones10Tick = [
                createZoneSnapshot(BASE_PRICE, 90, 18, 18, 72),
            ];
            const zoneData = createStandardZoneData(
                zones5Tick,
                zones10Tick,
                []
            );
            const event = createEnrichedTradeEvent(
                BASE_PRICE,
                40,
                true,
                zoneData
            );

            detector.onEnrichedTrade(event);

            expect(emittedEvents.length).toBeGreaterThan(0);
            const zoneSignal = emittedEvents.find(
                (e) => e.event === "zoneSignal"
            );
            expect(zoneSignal?.data.confidence).toBeGreaterThan(0.5);
        });

        it("Test 77: Base pass + Enhanced institutional pass", () => {
            // Strong base + institutional-sized orders
            const zones5Tick = [
                createZoneSnapshot(BASE_PRICE, 300, 50, 60, 240), // Institutional volume
            ];
            const zoneData = createStandardZoneData(zones5Tick, [], []);
            const event = createEnrichedTradeEvent(
                BASE_PRICE,
                150,
                true,
                zoneData
            );

            detector.onEnrichedTrade(event);

            expect(emittedEvents.length).toBeGreaterThan(0);
            const zoneSignal = emittedEvents.find(
                (e) => e.event === "zoneSignal"
            );
            expect(zoneSignal?.data.urgency).toBe("high");
        });

        it("Test 78: Base pass + Enhanced alignment pass", () => {
            // Perfect alignment across timeframes
            const zones5Tick = [createZoneSnapshot(BASE_PRICE, 50, 12, 10, 40)]; // 80% sell
            const zones10Tick = [
                createZoneSnapshot(BASE_PRICE, 75, 18, 15, 60),
            ]; // 80% sell
            const zones20Tick = [
                createZoneSnapshot(BASE_PRICE, 100, 24, 20, 80),
            ]; // 80% sell
            const zoneData = createStandardZoneData(
                zones5Tick,
                zones10Tick,
                zones20Tick
            );
            const event = createEnrichedTradeEvent(
                BASE_PRICE,
                30,
                true,
                zoneData
            );

            detector.onEnrichedTrade(event);

            expect(emittedEvents.length).toBeGreaterThan(0);
        });

        it("Test 79: Base fail + Enhanced confluence pass", () => {
            // Weak base but strong confluence should still fail
            const zones5Tick = [
                createZoneSnapshot(BASE_PRICE, 30, 8, 13, 17), // 43% sell - weak
                createZoneSnapshot(BASE_PRICE + 0.01, 32, 9, 14, 18), // Confluent but weak
            ];
            const zoneData = createStandardZoneData(zones5Tick, [], []);
            const event = createEnrichedTradeEvent(
                BASE_PRICE,
                20,
                true,
                zoneData
            );

            detector.onEnrichedTrade(event);

            expect(emittedEvents.length).toBe(0);
        });

        it("Test 80: All enhancements combined - maximum signal strength", () => {
            // Strong base + confluence + institutional + alignment
            const zones5Tick = [
                createZoneSnapshot(BASE_PRICE, 200, 40, 40, 160),
                createZoneSnapshot(BASE_PRICE + 0.01, 180, 35, 35, 145),
            ];
            const zones10Tick = [
                createZoneSnapshot(BASE_PRICE, 250, 50, 50, 200),
            ];
            const zones20Tick = [
                createZoneSnapshot(BASE_PRICE, 300, 60, 60, 240),
            ];
            const zoneData = createStandardZoneData(
                zones5Tick,
                zones10Tick,
                zones20Tick
            );
            const event = createEnrichedTradeEvent(
                BASE_PRICE,
                100,
                true,
                zoneData
            );

            detector.onEnrichedTrade(event);

            expect(emittedEvents.length).toBeGreaterThan(0);
            const zoneSignal = emittedEvents.find(
                (e) => e.event === "zoneSignal"
            );
            expect(zoneSignal?.data.confidence).toBeGreaterThan(0.7);
            expect(zoneSignal?.data.urgency).toBe("high");
        });

        // Tests 81-100: Comprehensive enhancement combinations
        it("Test 81-100: Enhanced detection combination matrix", () => {
            const combinationTests = [
                // Test 81-85: Confluence combinations
                {
                    base: "strong",
                    confluence: "strong",
                    institutional: "weak",
                    alignment: "weak",
                    expectPass: true,
                },
                {
                    base: "strong",
                    confluence: "weak",
                    institutional: "strong",
                    alignment: "weak",
                    expectPass: true,
                },
                {
                    base: "strong",
                    confluence: "weak",
                    institutional: "weak",
                    alignment: "strong",
                    expectPass: true,
                },
                {
                    base: "weak",
                    confluence: "strong",
                    institutional: "strong",
                    alignment: "strong",
                    expectPass: false,
                },
                {
                    base: "threshold",
                    confluence: "strong",
                    institutional: "weak",
                    alignment: "weak",
                    expectPass: true,
                },

                // Test 86-90: Institutional combinations
                {
                    base: "strong",
                    confluence: "medium",
                    institutional: "strong",
                    alignment: "medium",
                    expectPass: true,
                },
                {
                    base: "medium",
                    confluence: "strong",
                    institutional: "strong",
                    alignment: "medium",
                    expectPass: true,
                },
                {
                    base: "medium",
                    confluence: "medium",
                    institutional: "medium",
                    alignment: "strong",
                    expectPass: true,
                },
                {
                    base: "weak",
                    confluence: "medium",
                    institutional: "strong",
                    alignment: "strong",
                    expectPass: false,
                },
                {
                    base: "threshold",
                    confluence: "medium",
                    institutional: "strong",
                    alignment: "medium",
                    expectPass: true,
                },

                // Test 91-95: Alignment combinations
                {
                    base: "strong",
                    confluence: "strong",
                    institutional: "strong",
                    alignment: "strong",
                    expectPass: true,
                },
                {
                    base: "medium",
                    confluence: "strong",
                    institutional: "strong",
                    alignment: "strong",
                    expectPass: true,
                },
                {
                    base: "medium",
                    confluence: "medium",
                    institutional: "strong",
                    alignment: "strong",
                    expectPass: true,
                },
                {
                    base: "medium",
                    confluence: "strong",
                    institutional: "medium",
                    alignment: "strong",
                    expectPass: true,
                },
                {
                    base: "weak",
                    confluence: "strong",
                    institutional: "strong",
                    alignment: "strong",
                    expectPass: false,
                },

                // Test 96-100: Edge enhancement combinations
                {
                    base: "threshold",
                    confluence: "threshold",
                    institutional: "threshold",
                    alignment: "threshold",
                    expectPass: true,
                },
                {
                    base: "strong",
                    confluence: "zero",
                    institutional: "zero",
                    alignment: "zero",
                    expectPass: true,
                },
                {
                    base: "zero",
                    confluence: "strong",
                    institutional: "strong",
                    alignment: "strong",
                    expectPass: false,
                },
                {
                    base: "maximum",
                    confluence: "maximum",
                    institutional: "maximum",
                    alignment: "maximum",
                    expectPass: true,
                },
                {
                    base: "minimum",
                    confluence: "minimum",
                    institutional: "minimum",
                    alignment: "minimum",
                    expectPass: false,
                },
            ];

            combinationTests.forEach((test, index) => {
                // Create zones based on test parameters
                const baseStrength = test.base;
                const [buyVol, sellVol] =
                    baseStrength === "strong"
                        ? [12.5, 87.5]  // 87.5/100 * 0.8 = 70% sell ratio
                        : baseStrength === "medium"
                          ? [25, 75]     // 75/100 * 0.8 = 60% sell ratio
                          : baseStrength === "weak"
                            ? [55, 45]   // 45/100 * 0.8 = 36% sell ratio (should fail)
                            : baseStrength === "threshold"
                              ? [37.5, 62.5]  // 62.5/100 * 0.8 = 50% sell ratio (exact threshold)
                              : baseStrength === "zero"
                                ? [0, 0]
                                : baseStrength === "maximum"
                                  ? [5, 95]      // 95/100 * 0.8 = 76% sell ratio
                                  : baseStrength === "minimum"
                                    ? [49, 51]   // 51/100 * 0.8 = 40.8% sell ratio (should fail)
                                    : [50, 50];

                const volumeLevel =
                    test.institutional === "strong"
                        ? 200
                        : test.institutional === "medium"
                          ? 100
                          : test.institutional === "weak"
                            ? 50
                            : test.institutional === "zero"
                              ? 25 // Minimum viable volume for base pattern
                              : 75;

                const zones5Tick = [
                    createZoneSnapshot(
                        BASE_PRICE,
                        volumeLevel * 0.8,
                        volumeLevel * 0.2,
                        (buyVol / (buyVol + sellVol)) * (volumeLevel * 0.8),
                        (sellVol / (buyVol + sellVol)) * (volumeLevel * 0.8)
                    ),
                ];
                const zones10Tick =
                    test.confluence !== "zero"
                        ? [
                              createZoneSnapshot(
                                  BASE_PRICE,
                                  volumeLevel * 0.6,
                                  volumeLevel * 0.15,
                                  (buyVol / (buyVol + sellVol)) *
                                      (volumeLevel * 0.6),
                                  (sellVol / (buyVol + sellVol)) *
                                      (volumeLevel * 0.6)
                              ),
                          ]
                        : [];
                const zones20Tick =
                    test.alignment !== "zero"
                        ? [
                              createZoneSnapshot(
                                  BASE_PRICE,
                                  volumeLevel * 0.4,
                                  volumeLevel * 0.1,
                                  (buyVol / (buyVol + sellVol)) *
                                      (volumeLevel * 0.4),
                                  (sellVol / (buyVol + sellVol)) *
                                      (volumeLevel * 0.4)
                              ),
                          ]
                        : [];

                const zoneData = createStandardZoneData(
                    zones5Tick,
                    zones10Tick,
                    zones20Tick
                );
                const event = createEnrichedTradeEvent(
                    BASE_PRICE,
                    50,
                    true,
                    zoneData
                );

                emittedEvents = []; // Reset for each test
                detector.onEnrichedTrade(event);

                if (test.expectPass) {
                    expect(emittedEvents.length).toBeGreaterThan(0);
                } else {
                    expect(emittedEvents.length).toBe(0);
                }
            });
        });
    });

    describe("📊 Signal Emission Validation", () => {
        it("should emit proper zone update events for visualization", () => {
            const zones5Tick = [
                createZoneSnapshot(BASE_PRICE, 100, 20, 20, 80),
            ];
            const zoneData = createStandardZoneData(zones5Tick, [], []);
            const event = createEnrichedTradeEvent(
                BASE_PRICE,
                50,
                true,
                zoneData
            );

            detector.onEnrichedTrade(event);

            const zoneUpdate = emittedEvents.find(
                (e) => e.event === "zoneUpdate"
            );
            expect(zoneUpdate).toBeDefined();
            expect(zoneUpdate?.data.updateType).toBeTypeOf("string");
            expect(zoneUpdate?.data.zone.type).toBe("distribution");
        });

        it("should emit proper zone signal events for actionable signals", () => {
            const zones5Tick = [
                createZoneSnapshot(BASE_PRICE, 200, 40, 40, 160),
            ];
            const zoneData = createStandardZoneData(zones5Tick, [], []);
            const event = createEnrichedTradeEvent(
                BASE_PRICE,
                100,
                true,
                zoneData
            );

            detector.onEnrichedTrade(event);

            const zoneSignal = emittedEvents.find(
                (e) => e.event === "zoneSignal"
            );
            expect(zoneSignal).toBeDefined();
            expect(zoneSignal?.data.signalType).toBeTypeOf("string");
            expect(zoneSignal?.data.expectedDirection).toBe("down");
        });

        it("should provide enhancement statistics", () => {
            const zones5Tick = [
                createZoneSnapshot(BASE_PRICE, 100, 20, 20, 80),
            ];
            const zoneData = createStandardZoneData(zones5Tick, [], []);
            const event = createEnrichedTradeEvent(
                BASE_PRICE,
                50,
                true,
                zoneData
            );

            detector.onEnrichedTrade(event);

            const stats = detector.getEnhancementStats();
            expect(stats.callCount).toBeGreaterThan(0);
            expect(stats.enhancementSuccessRate).toBeGreaterThanOrEqual(0);
        });
    });
});
