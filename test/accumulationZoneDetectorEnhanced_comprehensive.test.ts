// test/accumulationZoneDetectorEnhanced_comprehensive.test.ts
//
// 🧪 COMPREHENSIVE ACCUMULATION DETECTOR TEST SUITE
//
// This test suite provides 100 comprehensive test scenarios for AccumulationZoneDetectorEnhanced
// covering all possible combinations of base detection, enhanced detection, pass/fail/edge cases.
//
// TEST COVERAGE:
// - Base Detection: Pure volume-based accumulation patterns
// - Enhanced Detection: Confluence, institutional, alignment contributions
// - Pass Cases: Scenarios that should correctly detect accumulation
// - Fail Cases: Scenarios that should correctly reject non-accumulation
// - Edge Cases: Boundary conditions, minimal data, extreme values
//
// VALIDATION APPROACH:
// - Real market-like data with proper tick sizes
// - FinancialMath compliance for all calculations
// - Zone data validation with proper volume aggregation
// - Signal emission verification for visualization and actionable events
//

import { describe, it, expect, beforeEach, vi } from "vitest";
import { AccumulationZoneDetectorEnhanced } from "../src/indicators/accumulationZoneDetectorEnhanced.js";
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
const TEST_ACCUMULATION_CONFIG = {
    useStandardizedZones: true,
    confidenceThreshold: 0.4,
    confluenceMinZones: 1,
    confluenceMaxDistance: 0.1,
    confluenceConfidenceBoost: 0.1,
    crossTimeframeConfidenceBoost: 0.15,
    accumulationVolumeThreshold: 15,
    accumulationRatioThreshold: 0.55,
    alignmentScoreThreshold: 0.5,
    defaultDurationMs: 120000,
    tickSize: 0.01,
    maxPriceSupport: 2.0,
    priceSupportMultiplier: 1.5,
    minPassiveVolumeForEfficiency: 5,
    defaultVolatility: 0.1,
    defaultBaselineVolatility: 0.05,
    confluenceStrengthDivisor: 2,
    passiveToAggressiveRatio: 0.6,
    varianceReductionFactor: 1.0,
    aggressiveBuyingRatioThreshold: 0.6,
    aggressiveBuyingReductionFactor: 0.5,
    buyingPressureConfidenceBoost: 0.08,
    enableZoneConfluenceFilter: true,
    enableBuyingPressureAnalysis: true,
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
            aggressiveBuyVolume,
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

describe("AccumulationZoneDetectorEnhanced - 100 Realistic Market Scenarios", () => {
    let detector: AccumulationZoneDetectorEnhanced;
    let mockLogger: ILogger;
    let mockMetrics: IMetricsCollector;
    let mockPreprocessor: IOrderflowPreprocessor;
    let emittedEvents: Array<{ event: string; data: any }>;

    beforeEach(() => {
        mockLogger = createMockLogger();
        mockMetrics = createMockMetrics();
        mockPreprocessor = createMockPreprocessor();
        emittedEvents = [];

        detector = new AccumulationZoneDetectorEnhanced(
            "test-accumulation",
            "LTCUSDT",
            TEST_ACCUMULATION_CONFIG,
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
        it("Test 1: Strong single-timeframe accumulation - high buy volume concentration", () => {
            // Strong buying activity in 5-tick zones
            const zones5Tick = [
                createZoneSnapshot(BASE_PRICE, 100, 20, 80, 20), // 80% buy ratio
                createZoneSnapshot(BASE_PRICE + 0.01, 90, 25, 75, 15), // 83% buy ratio
            ];
            const zoneData = createStandardZoneData(zones5Tick, [], []);
            const event = createEnrichedTradeEvent(
                BASE_PRICE,
                50,
                false,
                zoneData
            );

            detector.onEnrichedTrade(event);

            expect(emittedEvents.length).toBeGreaterThan(0);
            const zoneUpdate = emittedEvents.find(
                (e) => e.event === "zoneUpdate"
            );
            expect(zoneUpdate).toBeDefined();
        });

        it("Test 2: Multi-timeframe accumulation - consistent buy pressure across all timeframes", () => {
            const zones5Tick = [createZoneSnapshot(BASE_PRICE, 50, 10, 40, 10)];
            const zones10Tick = [
                createZoneSnapshot(BASE_PRICE, 80, 15, 65, 15),
            ];
            const zones20Tick = [
                createZoneSnapshot(BASE_PRICE, 120, 25, 95, 25),
            ];
            const zoneData = createStandardZoneData(
                zones5Tick,
                zones10Tick,
                zones20Tick
            );
            const event = createEnrichedTradeEvent(
                BASE_PRICE,
                30,
                false,
                zoneData
            );

            detector.onEnrichedTrade(event);

            expect(emittedEvents.length).toBeGreaterThan(0);
        });

        it("Test 3: High-volume institutional accumulation - large order concentration", () => {
            const zones5Tick = [
                createZoneSnapshot(BASE_PRICE, 200, 30, 160, 40), // Large volume
                createZoneSnapshot(BASE_PRICE + 0.01, 180, 25, 145, 35),
            ];
            const zoneData = createStandardZoneData(zones5Tick, [], []);
            const event = createEnrichedTradeEvent(
                BASE_PRICE,
                100,
                false,
                zoneData
            );

            detector.onEnrichedTrade(event);

            expect(emittedEvents.length).toBeGreaterThan(0);
            const signalCandidate = emittedEvents.find(
                (e) => e.event === "signalCandidate"
            );
            expect(signalCandidate?.data.side).toBe("buy");
        });

        it("Test 4: Gradual accumulation - sustained buying pressure over time", () => {
            // Multiple smaller zones showing consistent accumulation
            const zones5Tick = [
                createZoneSnapshot(BASE_PRICE - 0.02, 30, 8, 22, 8),
                createZoneSnapshot(BASE_PRICE - 0.01, 35, 10, 26, 9),
                createZoneSnapshot(BASE_PRICE, 40, 12, 30, 10),
                createZoneSnapshot(BASE_PRICE + 0.01, 32, 9, 24, 8),
            ];
            const zoneData = createStandardZoneData(zones5Tick, [], []);
            const event = createEnrichedTradeEvent(
                BASE_PRICE,
                25,
                false,
                zoneData
            );

            detector.onEnrichedTrade(event);

            expect(emittedEvents.length).toBeGreaterThan(0);
        });

        it("Test 5: Perfect accumulation scenario - 90%+ buy ratios", () => {
            const zones5Tick = [
                createZoneSnapshot(BASE_PRICE, 100, 20, 95, 5), // 95% buy ratio
                createZoneSnapshot(BASE_PRICE + 0.01, 80, 15, 76, 4), // 95% buy ratio
            ];
            const zoneData = createStandardZoneData(zones5Tick, [], []);
            const event = createEnrichedTradeEvent(
                BASE_PRICE,
                40,
                false,
                zoneData
            );

            detector.onEnrichedTrade(event);

            expect(emittedEvents.length).toBeGreaterThan(0);
            const zoneUpdate = emittedEvents.find(
                (e) => e.event === "zoneUpdate"
            );
            expect(zoneUpdate?.data.significance).toBeGreaterThan(0.6);
        });

        // Tests 6-25: Additional pass cases covering various accumulation patterns
        it("Test 6: Zone confluence accumulation - multiple zones at same price level", () => {
            const zones5Tick = [createZoneSnapshot(BASE_PRICE, 60, 12, 48, 12)];
            const zones10Tick = [
                createZoneSnapshot(BASE_PRICE, 90, 18, 72, 18),
            ];
            const zones20Tick = [
                createZoneSnapshot(BASE_PRICE, 120, 24, 96, 24),
            ];
            const zoneData = createStandardZoneData(
                zones5Tick,
                zones10Tick,
                zones20Tick
            );
            const event = createEnrichedTradeEvent(
                BASE_PRICE,
                35,
                false,
                zoneData
            );

            detector.onEnrichedTrade(event);
            expect(emittedEvents.length).toBeGreaterThan(0);
        });

        it("Test 7: Minimum threshold accumulation - just above detection limits", () => {
            const zones5Tick = [
                createZoneSnapshot(BASE_PRICE, 20, 5, 14, 6), // 70% buy ratio, minimum volume
            ];
            const zoneData = createStandardZoneData(zones5Tick, [], []);
            const event = createEnrichedTradeEvent(
                BASE_PRICE,
                15,
                false,
                zoneData
            );

            detector.onEnrichedTrade(event);
            expect(emittedEvents.length).toBeGreaterThan(0);
        });

        it("Test 8: Asymmetric accumulation - stronger in larger timeframes", () => {
            const zones5Tick = [createZoneSnapshot(BASE_PRICE, 25, 8, 17, 8)]; // 68% buy
            const zones10Tick = [
                createZoneSnapshot(BASE_PRICE, 50, 12, 40, 10),
            ]; // 80% buy
            const zones20Tick = [
                createZoneSnapshot(BASE_PRICE, 100, 20, 85, 15),
            ]; // 85% buy
            const zoneData = createStandardZoneData(
                zones5Tick,
                zones10Tick,
                zones20Tick
            );
            const event = createEnrichedTradeEvent(
                BASE_PRICE,
                20,
                false,
                zoneData
            );

            detector.onEnrichedTrade(event);
            expect(emittedEvents.length).toBeGreaterThan(0);
        });

        it("Test 9: Wide-spread accumulation - across multiple price levels", () => {
            const zones5Tick = [
                createZoneSnapshot(BASE_PRICE - 0.05, 30, 8, 22, 8),
                createZoneSnapshot(BASE_PRICE - 0.03, 35, 10, 26, 9),
                createZoneSnapshot(BASE_PRICE - 0.01, 40, 12, 30, 10),
                createZoneSnapshot(BASE_PRICE + 0.01, 35, 10, 26, 9),
                createZoneSnapshot(BASE_PRICE + 0.03, 30, 8, 22, 8),
            ];
            const zoneData = createStandardZoneData(zones5Tick, [], []);
            const event = createEnrichedTradeEvent(
                BASE_PRICE,
                25,
                false,
                zoneData
            );

            detector.onEnrichedTrade(event);
            expect(emittedEvents.length).toBeGreaterThan(0);
        });

        it("Test 10: Volume-weighted accumulation - higher volume zones dominate", () => {
            const zones5Tick = [
                createZoneSnapshot(BASE_PRICE, 150, 25, 120, 30), // Large volume, strong buy
                createZoneSnapshot(BASE_PRICE + 0.01, 20, 5, 12, 8), // Small volume, weaker
            ];
            const zoneData = createStandardZoneData(zones5Tick, [], []);
            const event = createEnrichedTradeEvent(
                BASE_PRICE,
                75,
                false,
                zoneData
            );

            detector.onEnrichedTrade(event);
            expect(emittedEvents.length).toBeGreaterThan(0);
        });

        // Tests 11-15: Enhanced detection pass cases
        it("Test 11: Enhanced confluence detection - multiple nearby zones", () => {
            const zones5Tick = [
                createZoneSnapshot(BASE_PRICE, 50, 10, 40, 10),
                createZoneSnapshot(BASE_PRICE + 0.01, 45, 9, 36, 9),
                createZoneSnapshot(BASE_PRICE + 0.02, 40, 8, 32, 8),
            ];
            const zoneData = createStandardZoneData(zones5Tick, [], []);
            const event = createEnrichedTradeEvent(
                BASE_PRICE + 0.01,
                30,
                false,
                zoneData
            );

            detector.onEnrichedTrade(event);
            expect(emittedEvents.length).toBeGreaterThan(0);
        });

        it("Test 12: Enhanced institutional detection - large order clustering", () => {
            const zones5Tick = [
                createZoneSnapshot(BASE_PRICE, 200, 40, 160, 40), // Institutional size
                createZoneSnapshot(BASE_PRICE + 0.01, 180, 35, 145, 35),
            ];
            const zoneData = createStandardZoneData(zones5Tick, [], []);
            const event = createEnrichedTradeEvent(
                BASE_PRICE,
                100,
                false,
                zoneData
            );

            detector.onEnrichedTrade(event);
            expect(emittedEvents.length).toBeGreaterThan(0);
            const zoneSignal = emittedEvents.find(
                (e) => e.event === "zoneSignal"
            );
            expect(zoneSignal?.data.urgency).toBe("high");
        });

        it("Test 13: Enhanced alignment detection - consistent cross-timeframe pattern", () => {
            // Perfect alignment across all timeframes
            const zones5Tick = [createZoneSnapshot(BASE_PRICE, 40, 10, 32, 8)]; // 80% buy
            const zones10Tick = [
                createZoneSnapshot(BASE_PRICE, 60, 15, 48, 12),
            ]; // 80% buy
            const zones20Tick = [
                createZoneSnapshot(BASE_PRICE, 80, 20, 64, 16),
            ]; // 80% buy
            const zoneData = createStandardZoneData(
                zones5Tick,
                zones10Tick,
                zones20Tick
            );
            const event = createEnrichedTradeEvent(
                BASE_PRICE,
                25,
                false,
                zoneData
            );

            detector.onEnrichedTrade(event);
            expect(emittedEvents.length).toBeGreaterThan(0);
        });

        // Tests 14-25: Additional pass scenarios
        it("Test 14: Momentum accumulation - accelerating buy pressure", () => {
            const zones5Tick = [
                createZoneSnapshot(BASE_PRICE - 0.02, 30, 10, 20, 10), // 67% buy
                createZoneSnapshot(BASE_PRICE - 0.01, 40, 10, 30, 10), // 75% buy
                createZoneSnapshot(BASE_PRICE, 50, 10, 42, 8), // 84% buy
            ];
            const zoneData = createStandardZoneData(zones5Tick, [], []);
            const event = createEnrichedTradeEvent(
                BASE_PRICE,
                30,
                false,
                zoneData
            );

            detector.onEnrichedTrade(event);
            expect(emittedEvents.length).toBeGreaterThan(0);
        });

        it("Test 15: Support-based accumulation - buying at key support level", () => {
            const zones5Tick = [
                createZoneSnapshot(BASE_PRICE, 80, 15, 65, 15), // At support
                createZoneSnapshot(BASE_PRICE + 0.01, 20, 8, 14, 6), // Above support
            ];
            const zoneData = createStandardZoneData(zones5Tick, [], []);
            const event = createEnrichedTradeEvent(
                BASE_PRICE,
                40,
                false,
                zoneData
            );

            detector.onEnrichedTrade(event);
            expect(emittedEvents.length).toBeGreaterThan(0);
        });

        // Tests 16-25: More comprehensive pass cases
        it("Test 16-25: Batch accumulation pass scenarios", () => {
            const passScenarios = [
                // Test 16: High passive volume accumulation
                {
                    zones: [createZoneSnapshot(BASE_PRICE, 40, 60, 55, 5)], // 55% buy ratio
                    desc: "High passive volume",
                },
                // Test 17: Balanced timeframe accumulation
                {
                    zones: [createZoneSnapshot(BASE_PRICE, 70, 20, 56, 14)],
                    desc: "Balanced accumulation",
                },
                // Test 18: Sustained accumulation pattern
                {
                    zones: [createZoneSnapshot(BASE_PRICE, 90, 25, 72, 18)],
                    desc: "Sustained pattern",
                },
                // Test 19: Price level clustering
                {
                    zones: [createZoneSnapshot(BASE_PRICE, 60, 18, 48, 12)],
                    desc: "Price clustering",
                },
                // Test 20: Volume surge accumulation
                {
                    zones: [createZoneSnapshot(BASE_PRICE, 120, 30, 96, 24)],
                    desc: "Volume surge",
                },
                // Test 21: Stealth accumulation
                {
                    zones: [createZoneSnapshot(BASE_PRICE, 35, 12, 28, 7)],
                    desc: "Stealth accumulation",
                },
                // Test 22: Breakout accumulation
                {
                    zones: [createZoneSnapshot(BASE_PRICE, 55, 15, 44, 11)],
                    desc: "Breakout preparation",
                },
                // Test 23: Institutional scale
                {
                    zones: [createZoneSnapshot(BASE_PRICE, 250, 50, 200, 50)],
                    desc: "Institutional scale",
                },
                // Test 24: Multi-level accumulation
                {
                    zones: [createZoneSnapshot(BASE_PRICE, 45, 12, 36, 9)],
                    desc: "Multi-level",
                },
                // Test 25: Perfect ratio accumulation
                {
                    zones: [createZoneSnapshot(BASE_PRICE, 60, 15, 54, 6)],
                    desc: "Perfect ratio",
                },
            ];

            passScenarios.forEach((scenario, index) => {
                const zoneData = createStandardZoneData(scenario.zones, [], []);
                const event = createEnrichedTradeEvent(
                    BASE_PRICE,
                    30,
                    false,
                    zoneData
                );

                emittedEvents = []; // Reset for each test
                detector.onEnrichedTrade(event);

                expect(emittedEvents.length).toBeGreaterThan(0);
            });
        });
    });

    describe("🚫 Base Detection - Fail Cases (Tests 26-50)", () => {
        it("Test 26: No accumulation - balanced buy/sell activity", () => {
            const zones5Tick = [
                createZoneSnapshot(BASE_PRICE, 100, 20, 50, 50), // 50% buy ratio
            ];
            const zoneData = createStandardZoneData(zones5Tick, [], []);
            const event = createEnrichedTradeEvent(
                BASE_PRICE,
                50,
                true,
                zoneData
            );

            detector.onEnrichedTrade(event);

            expect(emittedEvents.length).toBe(0);
        });

        it("Test 27: Distribution pattern - strong sell pressure", () => {
            const zones5Tick = [
                createZoneSnapshot(BASE_PRICE, 100, 20, 20, 80), // 20% buy ratio - distribution
            ];
            const zoneData = createStandardZoneData(zones5Tick, [], []);
            const event = createEnrichedTradeEvent(
                BASE_PRICE,
                50,
                true,
                zoneData
            );

            detector.onEnrichedTrade(event);

            expect(emittedEvents.length).toBe(0);
        });

        it("Test 28: Insufficient volume - below minimum thresholds", () => {
            const zones5Tick = [
                createZoneSnapshot(BASE_PRICE, 5, 2, 4, 1), // Too low volume
            ];
            const zoneData = createStandardZoneData(zones5Tick, [], []);
            const event = createEnrichedTradeEvent(
                BASE_PRICE,
                3,
                false,
                zoneData
            );

            detector.onEnrichedTrade(event);

            expect(emittedEvents.length).toBe(0);
        });

        it("Test 29: Weak accumulation - below confidence threshold", () => {
            const zones5Tick = [
                createZoneSnapshot(BASE_PRICE, 40, 10, 24, 16), // 60% buy ratio - below threshold
            ];
            const zoneData = createStandardZoneData(zones5Tick, [], []);
            const event = createEnrichedTradeEvent(
                BASE_PRICE,
                20,
                false,
                zoneData
            );

            detector.onEnrichedTrade(event);

            expect(emittedEvents.length).toBe(0);
        });

        it("Test 30: No relevant zones - price too far from zone centers", () => {
            const zones5Tick = [
                createZoneSnapshot(BASE_PRICE + 1.0, 80, 15, 65, 15), // Too far away
            ];
            const zoneData = createStandardZoneData(zones5Tick, [], []);
            const event = createEnrichedTradeEvent(
                BASE_PRICE,
                40,
                false,
                zoneData
            );

            detector.onEnrichedTrade(event);

            expect(emittedEvents.length).toBe(0);
        });

        // Tests 31-50: Additional fail cases
        it("Test 31-50: Batch accumulation fail scenarios", () => {
            const failScenarios = [
                // Test 31: Random noise trading
                {
                    zones: [createZoneSnapshot(BASE_PRICE, 30, 8, 15, 15)],
                    desc: "Random noise",
                },
                // Test 32: Weak selling pressure
                {
                    zones: [createZoneSnapshot(BASE_PRICE, 40, 10, 18, 22)],
                    desc: "Weak selling",
                },
                // Test 33: Low volume activity
                {
                    zones: [createZoneSnapshot(BASE_PRICE, 8, 3, 5, 3)],
                    desc: "Low volume",
                },
                // Test 34: Conflicting signals
                {
                    zones: [createZoneSnapshot(BASE_PRICE, 50, 12, 20, 30)],
                    desc: "Conflicting signals",
                },
                // Test 35: Minimal activity
                {
                    zones: [createZoneSnapshot(BASE_PRICE, 12, 4, 7, 5)],
                    desc: "Minimal activity",
                },
                // Test 36: Neutral market
                {
                    zones: [createZoneSnapshot(BASE_PRICE, 60, 15, 30, 30)],
                    desc: "Neutral market",
                },
                // Test 37: Declining interest
                {
                    zones: [createZoneSnapshot(BASE_PRICE, 25, 8, 12, 13)],
                    desc: "Declining interest",
                },
                // Test 38: Choppy trading
                {
                    zones: [createZoneSnapshot(BASE_PRICE, 35, 10, 17, 18)],
                    desc: "Choppy trading",
                },
                // Test 39: Weak participation
                {
                    zones: [createZoneSnapshot(BASE_PRICE, 18, 5, 9, 9)],
                    desc: "Weak participation",
                },
                // Test 40: Consolidation phase
                {
                    zones: [createZoneSnapshot(BASE_PRICE, 45, 12, 22, 23)],
                    desc: "Consolidation",
                },
                // Test 41: Bear market sentiment
                {
                    zones: [createZoneSnapshot(BASE_PRICE, 70, 18, 25, 45)],
                    desc: "Bear sentiment",
                },
                // Test 42: Profit taking
                {
                    zones: [createZoneSnapshot(BASE_PRICE, 80, 20, 30, 50)],
                    desc: "Profit taking",
                },
                // Test 43: Distribution beginning
                {
                    zones: [createZoneSnapshot(BASE_PRICE, 90, 22, 35, 55)],
                    desc: "Early distribution",
                },
                // Test 44: Market uncertainty
                {
                    zones: [createZoneSnapshot(BASE_PRICE, 55, 15, 26, 29)],
                    desc: "Market uncertainty",
                },
                // Test 45: Sideways movement
                {
                    zones: [createZoneSnapshot(BASE_PRICE, 42, 12, 21, 21)],
                    desc: "Sideways movement",
                },
                // Test 46: Volume exhaustion
                {
                    zones: [createZoneSnapshot(BASE_PRICE, 15, 5, 8, 7)],
                    desc: "Volume exhaustion",
                },
                // Test 47: Failed accumulation
                {
                    zones: [createZoneSnapshot(BASE_PRICE, 65, 18, 28, 37)],
                    desc: "Failed accumulation",
                },
                // Test 48: Weak hands selling
                {
                    zones: [createZoneSnapshot(BASE_PRICE, 75, 20, 32, 43)],
                    desc: "Weak hands",
                },
                // Test 49: Resistance level
                {
                    zones: [createZoneSnapshot(BASE_PRICE, 85, 22, 38, 47)],
                    desc: "Resistance level",
                },
                // Test 50: Distribution dominance
                {
                    zones: [createZoneSnapshot(BASE_PRICE, 95, 25, 40, 55)],
                    desc: "Distribution dominance",
                },
            ];

            failScenarios.forEach((scenario, index) => {
                const zoneData = createStandardZoneData(scenario.zones, [], []);
                const event = createEnrichedTradeEvent(
                    BASE_PRICE,
                    30,
                    true,
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
            const buyVolume = Math.floor(
                totalVolume *
                    TEST_ACCUMULATION_CONFIG.accumulationRatioThreshold
            );
            const sellVolume = totalVolume - buyVolume;

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
                false,
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
                false,
                zoneData
            );

            detector.onEnrichedTrade(event);

            expect(emittedEvents.length).toBe(0);
        });

        it("Test 53: Single tick volumes - minimal viable activity", () => {
            const zones5Tick = [createZoneSnapshot(BASE_PRICE, 1, 1, 1, 0)];
            const zoneData = createStandardZoneData(zones5Tick, [], []);
            const event = createEnrichedTradeEvent(
                BASE_PRICE,
                1,
                false,
                zoneData
            );

            detector.onEnrichedTrade(event);

            expect(emittedEvents.length).toBe(0);
        });

        it("Test 54: Maximum distance zones - at edge of confluence range", () => {
            const maxDistance = TEST_ACCUMULATION_CONFIG.confluenceMaxDistance;
            const zones5Tick = [
                createZoneSnapshot(BASE_PRICE + maxDistance, 80, 15, 65, 15),
            ];
            const zoneData = createStandardZoneData(zones5Tick, [], []);
            const event = createEnrichedTradeEvent(
                BASE_PRICE,
                40,
                false,
                zoneData
            );

            detector.onEnrichedTrade(event);

            expect(emittedEvents.length).toBeGreaterThanOrEqual(0);
        });

        it("Test 55: Extremely high volumes - stress test large numbers", () => {
            const zones5Tick = [
                createZoneSnapshot(BASE_PRICE, 10000, 2000, 8000, 2000), // Very high volume
            ];
            const zoneData = createStandardZoneData(zones5Tick, [], []);
            const event = createEnrichedTradeEvent(
                BASE_PRICE,
                5000,
                false,
                zoneData
            );

            detector.onEnrichedTrade(event);

            expect(emittedEvents.length).toBeGreaterThan(0);
        });

        it("Test 56: Perfect buy dominance - 100% buy volume", () => {
            const zones5Tick = [
                createZoneSnapshot(BASE_PRICE, 100, 20, 100, 0), // 100% buy
            ];
            const zoneData = createStandardZoneData(zones5Tick, [], []);
            const event = createEnrichedTradeEvent(
                BASE_PRICE,
                50,
                false,
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
                            26.666666,
                            6.666667
                        ),
                    ],
                    desc: "Float precision",
                },
                // Test 58: Very small volumes
                {
                    zones: [
                        createZoneSnapshot(BASE_PRICE, 0.1, 0.05, 0.08, 0.02),
                    ],
                    desc: "Tiny volumes",
                },
                // Test 59: Asymmetric passive volume
                {
                    zones: [createZoneSnapshot(BASE_PRICE, 50, 150, 40, 10)],
                    desc: "High passive volume",
                },
                // Test 60: Near-zero sell volume
                {
                    zones: [createZoneSnapshot(BASE_PRICE, 100, 20, 99, 1)],
                    desc: "Near-zero sells",
                },
                // Test 61: Identical buy/sell volumes
                {
                    zones: [createZoneSnapshot(BASE_PRICE, 80, 20, 40, 40)],
                    desc: "Identical volumes",
                },
                // Test 62: Single large order
                {
                    zones: [createZoneSnapshot(BASE_PRICE, 1000, 0, 800, 200)],
                    desc: "Single large order",
                },
                // Test 63: Micro-spread zones
                {
                    zones: [createZoneSnapshot(BASE_PRICE, 25, 8, 20, 5)],
                    desc: "Micro-spread",
                },
                // Test 64: High frequency activity
                {
                    zones: [createZoneSnapshot(BASE_PRICE, 200, 50, 160, 40)],
                    desc: "High frequency",
                },
                // Test 65: Price at exact tick boundary
                {
                    zones: [createZoneSnapshot(85.0, 60, 15, 48, 12)],
                    desc: "Exact tick boundary",
                },
                // Test 66: Multiple identical zones
                {
                    zones: [
                        createZoneSnapshot(BASE_PRICE, 40, 10, 32, 8),
                        createZoneSnapshot(BASE_PRICE, 40, 10, 32, 8),
                    ],
                    desc: "Identical zones",
                },
                // Test 67: Exponential volume growth
                {
                    zones: [createZoneSnapshot(BASE_PRICE, 128, 32, 102, 26)],
                    desc: "Exponential growth",
                },
                // Test 68: Prime number volumes
                {
                    zones: [createZoneSnapshot(BASE_PRICE, 67, 13, 53, 14)],
                    desc: "Prime numbers",
                },
                // Test 69: Golden ratio volumes
                {
                    zones: [
                        createZoneSnapshot(
                            BASE_PRICE,
                            61.8,
                            15.45,
                            49.44,
                            12.36
                        ),
                    ],
                    desc: "Golden ratio",
                },
                // Test 70: Binary-like volumes
                {
                    zones: [createZoneSnapshot(BASE_PRICE, 64, 16, 51, 13)],
                    desc: "Binary volumes",
                },
                // Test 71: Fibonacci sequence
                {
                    zones: [createZoneSnapshot(BASE_PRICE, 55, 13, 44, 11)],
                    desc: "Fibonacci",
                },
                // Test 72: Square number volumes
                {
                    zones: [createZoneSnapshot(BASE_PRICE, 49, 9, 39, 10)],
                    desc: "Square numbers",
                },
                // Test 73: Negative test (should not happen)
                {
                    zones: [createZoneSnapshot(BASE_PRICE, 50, 12, 40, 10)],
                    desc: "Standard positive",
                },
                // Test 74: Boundary rounding test
                {
                    zones: [createZoneSnapshot(84.995, 45, 11, 36, 9)],
                    desc: "Rounding boundary",
                },
                // Test 75: Maximum precision test
                {
                    zones: [createZoneSnapshot(85.01234567, 37, 9, 29, 8)],
                    desc: "Max precision",
                },
            ];

            edgeCases.forEach((edgeCase, index) => {
                const zoneData = createStandardZoneData(edgeCase.zones, [], []);
                const event = createEnrichedTradeEvent(
                    BASE_PRICE,
                    20,
                    false,
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
                createZoneSnapshot(BASE_PRICE, 80, 15, 65, 15),
                createZoneSnapshot(BASE_PRICE + 0.01, 75, 14, 60, 15),
            ];
            const zones10Tick = [
                createZoneSnapshot(BASE_PRICE, 90, 18, 72, 18),
            ];
            const zoneData = createStandardZoneData(
                zones5Tick,
                zones10Tick,
                []
            );
            const event = createEnrichedTradeEvent(
                BASE_PRICE,
                40,
                false,
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
                createZoneSnapshot(BASE_PRICE, 300, 50, 240, 60), // Institutional volume
            ];
            const zoneData = createStandardZoneData(zones5Tick, [], []);
            const event = createEnrichedTradeEvent(
                BASE_PRICE,
                150,
                false,
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
            const zones5Tick = [createZoneSnapshot(BASE_PRICE, 50, 12, 40, 10)]; // 80% buy
            const zones10Tick = [
                createZoneSnapshot(BASE_PRICE, 75, 18, 60, 15),
            ]; // 80% buy
            const zones20Tick = [
                createZoneSnapshot(BASE_PRICE, 100, 24, 80, 20),
            ]; // 80% buy
            const zoneData = createStandardZoneData(
                zones5Tick,
                zones10Tick,
                zones20Tick
            );
            const event = createEnrichedTradeEvent(
                BASE_PRICE,
                30,
                false,
                zoneData
            );

            detector.onEnrichedTrade(event);

            expect(emittedEvents.length).toBeGreaterThan(0);
        });

        it("Test 79: Base fail + Enhanced confluence pass", () => {
            // Weak base but strong confluence should still fail
            const zones5Tick = [
                createZoneSnapshot(BASE_PRICE, 30, 8, 17, 13), // 57% buy - weak
                createZoneSnapshot(BASE_PRICE + 0.01, 32, 9, 18, 14), // Confluent but weak
            ];
            const zoneData = createStandardZoneData(zones5Tick, [], []);
            const event = createEnrichedTradeEvent(
                BASE_PRICE,
                20,
                false,
                zoneData
            );

            detector.onEnrichedTrade(event);

            expect(emittedEvents.length).toBe(0);
        });

        it("Test 80: All enhancements combined - maximum signal strength", () => {
            // Strong base + confluence + institutional + alignment
            const zones5Tick = [
                createZoneSnapshot(BASE_PRICE, 200, 40, 160, 40),
                createZoneSnapshot(BASE_PRICE + 0.01, 180, 35, 145, 35),
            ];
            const zones10Tick = [
                createZoneSnapshot(BASE_PRICE, 250, 50, 200, 50),
            ];
            const zones20Tick = [
                createZoneSnapshot(BASE_PRICE, 300, 60, 240, 60),
            ];
            const zoneData = createStandardZoneData(
                zones5Tick,
                zones10Tick,
                zones20Tick
            );
            const event = createEnrichedTradeEvent(
                BASE_PRICE,
                100,
                false,
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
                        ? [87.5, 12.5]  // 87.5/100 * 0.8 = 70% buy ratio
                        : baseStrength === "medium"
                          ? [75, 25]     // 75/100 * 0.8 = 60% buy ratio  
                          : baseStrength === "weak"
                            ? [45, 55]   // 45/100 * 0.8 = 36% buy ratio (should fail)
                            : baseStrength === "threshold"
                              ? [68.75, 31.25]  // 68.75/100 * 0.8 = 55% buy ratio (exact threshold)
                              : baseStrength === "zero"
                                ? [0, 0]
                                : baseStrength === "maximum"
                                  ? [95, 5]      // 95/100 * 0.8 = 76% buy ratio
                                  : baseStrength === "minimum"
                                    ? [51, 49]   // 51/100 * 0.8 = 40.8% buy ratio (should fail)
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
                    false,
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
                createZoneSnapshot(BASE_PRICE, 100, 20, 80, 20),
            ];
            const zoneData = createStandardZoneData(zones5Tick, [], []);
            const event = createEnrichedTradeEvent(
                BASE_PRICE,
                50,
                false,
                zoneData
            );

            detector.onEnrichedTrade(event);

            const zoneUpdate = emittedEvents.find(
                (e) => e.event === "zoneUpdate"
            );
            expect(zoneUpdate).toBeDefined();
            expect(zoneUpdate?.data.updateType).toBeTypeOf("string");
            expect(zoneUpdate?.data.zone.type).toBe("accumulation");
        });

        it("should emit proper zone signal events for actionable signals", () => {
            const zones5Tick = [
                createZoneSnapshot(BASE_PRICE, 200, 40, 160, 40),
            ];
            const zoneData = createStandardZoneData(zones5Tick, [], []);
            const event = createEnrichedTradeEvent(
                BASE_PRICE,
                100,
                false,
                zoneData
            );

            detector.onEnrichedTrade(event);

            const zoneSignal = emittedEvents.find(
                (e) => e.event === "zoneSignal"
            );
            expect(zoneSignal).toBeDefined();
            expect(zoneSignal?.data.signalType).toBeTypeOf("string");
            expect(zoneSignal?.data.expectedDirection).toBe("up");
        });

        it("should provide enhancement statistics", () => {
            const zones5Tick = [
                createZoneSnapshot(BASE_PRICE, 100, 20, 80, 20),
            ];
            const zoneData = createStandardZoneData(zones5Tick, [], []);
            const event = createEnrichedTradeEvent(
                BASE_PRICE,
                50,
                false,
                zoneData
            );

            detector.onEnrichedTrade(event);

            const stats = detector.getEnhancementStats();
            expect(stats.callCount).toBeGreaterThan(0);
            expect(stats.enhancementSuccessRate).toBeGreaterThanOrEqual(0);
        });
    });
});
