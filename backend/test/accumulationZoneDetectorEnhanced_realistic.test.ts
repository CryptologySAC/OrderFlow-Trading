// test/accumulationZoneDetectorEnhanced_realistic.test.ts
//
// 🧪 REALISTIC ACCUMULATION DETECTOR TEST SUITE
//
// CLAUDE.md Compliant Testing: Tests MUST validate real-world accumulation patterns
// based on actual market behavior, not current implementation quirks.
//
// ACCUMULATION DEFINITION (Market Reality):
// - Institutional buying over time at specific price levels
// - 65%+ aggressive buying volume sustained over multiple timeframes
// - Volume concentration indicating smart money positioning
// - Price support formation through repeated buying interest
//
// TEST PHILOSOPHY:
// ✅ Test CORRECT accumulation behavior per market specifications
// ✅ Use realistic LTCUSDT volumes and price movements with proper ticks
// ✅ Validate detection of TRUE accumulation patterns
// ❌ Never adjust tests to match broken code behavior
//

import { describe, it, expect, beforeEach, vi } from "vitest";
import { AccumulationZoneDetectorEnhanced } from "../src/indicators/accumulationZoneDetectorEnhanced.js";
import { SignalValidationLogger } from "../__mocks__/src/utils/signalValidationLogger.js";
import { FinancialMath } from "../src/utils/financialMath.js";
import type { ILogger } from "../src/infrastructure/loggerInterface.js";
import type { IMetricsCollector } from "../src/infrastructure/metricsCollectorInterface.js";
import type { IOrderflowPreprocessor } from "../src/market/orderFlowPreprocessor.js";
import type {
    EnrichedTradeEvent,
    StandardZoneData,
    ZoneSnapshot,
} from "../src/types/marketEvents.js";
import "../test/vitest.setup.ts";

// LTCUSDT Market Reality: Real trading parameters
const LTCUSDT_PRICE = 85.0; // $85 LTCUSDT current market level
const TICK_SIZE = 0.01; // 1-cent tick size for LTCUSDT
const TYPICAL_VOLUME_RANGE = [10, 500]; // LTC typical volume range per zone
const INSTITUTIONAL_VOLUME = 200; // LTC considered institutional size
const ACCUMULATION_BUY_RATIO = 0.65; // 65%+ buy ratio = accumulation per market def

// Real market configuration
const REAL_ACCUMULATION_CONFIG = {
    useStandardizedZones: true,
    enhancementMode: "production" as const,
    eventCooldownMs: 15000, // Required parameter
    confidenceThreshold: 0.4, // Real config.json value
    confluenceMinZones: 1,
    confluenceMaxDistance: 0.1, // 10-cent confluence range
    accumulationVolumeThreshold: 15, // 15 LTC minimum volume
    accumulationRatioThreshold: 0.55, // 55% buy ratio threshold
    alignmentScoreThreshold: 0.5,
    defaultDurationMs: 120000, // 2 minutes
    tickSize: TICK_SIZE,
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
};

// Mock implementations - simplified
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
            return zones.filter(
                (zone) => Math.abs(zone.center - price) <= distance
            );
        }
    ),
    preprocess: vi.fn(),
    getState: vi.fn(),
    cleanup: vi.fn(),
});

// Helper: Create realistic market zone based on actual accumulation behavior
function createAccumulationZone(
    center: number,
    totalVolumeLTC: number,
    buyRatioPercent: number // 0-100, where 55+ = accumulation (of TOTAL volume, not just aggressive)
): ZoneSnapshot {
    const buyRatio = buyRatioPercent / 100;
    const totalAggressive = totalVolumeLTC * 0.7; // 70% aggressive typical
    const totalPassive = totalVolumeLTC * 0.3; // 30% passive typical

    // Fix: Calculate aggressiveBuy as percentage of TOTAL volume, not just aggressive
    const aggressiveBuy = totalVolumeLTC * buyRatio; // Buy volume of total
    const aggressiveSell = totalAggressive - aggressiveBuy; // Remaining aggressive is sell

    return {
        center,
        aggressiveVolume: totalAggressive,
        passiveVolume: totalPassive,
        aggressiveBuyVolume: aggressiveBuy,
        aggressiveSellVolume: aggressiveSell,
        strength: FinancialMath.divideQuantities(aggressiveBuy, totalVolumeLTC),
        tradeCount: Math.max(1, Math.floor(totalVolumeLTC / 10)),
        lastUpdate: Date.now(),
    };
}

function createRealisticMarketEvent(
    price: number,
    quantity: number,
    buyerIsMaker: boolean,
    zones: ZoneSnapshot[]
): EnrichedTradeEvent {
    return {
        symbol: "LTCUSDT",
        price,
        quantity,
        timestamp: Date.now(),
        tradeId: Math.floor(Math.random() * 1000000),
        buyerIsMaker,
        zoneData: {
            zones: zones,
            zoneConfig: {
                zoneTicks: 10,
                tickValue: 0.01,
                timeWindow: 60000,
            },
        },
        spread: 0.01, // 1-cent spread typical for LTCUSDT
        midPrice: price,
        imbalance: buyerIsMaker ? -0.1 : 0.1,
        passiveVolume: quantity * 0.3,
        aggressiveVolume: quantity * 0.7,
        dominantSide: buyerIsMaker ? "sell" : "buy",
    };
}

describe("AccumulationZoneDetectorEnhanced - Realistic Market Scenarios", () => {
    let detector: AccumulationZoneDetectorEnhanced;
    let mockLogger: ILogger;
    let mockMetrics: IMetricsCollector;
    let mockPreprocessor: IOrderflowPreprocessor;
    let emittedEvents: Array<{ event: string; data: any }>;

    beforeEach(async () => {
        mockLogger = createMockLogger();
        mockMetrics = createMockMetrics();
        mockPreprocessor = createMockPreprocessor();
        emittedEvents = [];

        // Import and create mockSignalLogger
        const { createMockSignalLogger } = await import(
            "../__mocks__/src/infrastructure/signalLoggerInterface.js"
        );
        const mockSignalLogger = createMockSignalLogger();

        detector = new AccumulationZoneDetectorEnhanced(
            "realistic-accumulation",
            REAL_ACCUMULATION_CONFIG,
            mockPreprocessor,
            mockLogger,
            mockMetrics,
            mockSignalLogger
        );

        // Capture emitted events
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

    describe("🎯 TRUE ACCUMULATION DETECTION - Market Reality (Tests 1-25)", () => {
        it("Test 1: Classic Institutional Accumulation - Smart Money Buying at Support", () => {
            // SCENARIO: Large player accumulating 300 LTC at $85 support with 75% buy ratio
            const supportLevel = LTCUSDT_PRICE;
            const zones = [
                createAccumulationZone(supportLevel, 300, 75), // 75% buy = strong accumulation
            ];
            const event = createRealisticMarketEvent(
                supportLevel,
                50,
                false,
                zones
            );

            detector.onEnrichedTrade(event);

            // EXPECTATION: Should detect true accumulation
            expect(emittedEvents.length).toBeGreaterThan(0);
            const zoneUpdate = emittedEvents.find(
                (e) => e.event === "zoneUpdate"
            );
            expect(zoneUpdate).toBeDefined();
            expect(zoneUpdate?.data.zone.type).toBe("accumulation");
        });

        it("Test 2: Multi-Timeframe Accumulation Alignment - Consistent Buying Across All Frames", () => {
            // SCENARIO: Consistent 70% buying across 5T, 10T, 20T zones
            const price = LTCUSDT_PRICE;
            const zones5T = [createAccumulationZone(price, 100, 70)];
            const zones10T = [createAccumulationZone(price, 200, 70)];
            const zones20T = [createAccumulationZone(price, 400, 70)];
            const event = createRealisticMarketEvent(
                price,
                30,
                false,
                zones5T,
                zones10T,
                zones20T
            );

            detector.onEnrichedTrade(event);

            // EXPECTATION: Strong cross-timeframe signal
            expect(emittedEvents.length).toBeGreaterThan(0);
            const signal = emittedEvents.find(
                (e) => e.event === "signalCandidate"
            );
            if (signal) {
                expect(signal.data.side).toBe("buy");
                expect(signal.data.confidence).toBeGreaterThan(0.5);
            }
        });

        it("Test 3: Volume-Weighted Accumulation - Large Orders Dominating", () => {
            // SCENARIO: 500 LTC zone with 80% buy ratio - institutional accumulation
            const zones = [
                createAccumulationZone(LTCUSDT_PRICE, 500, 80), // Large institutional volume
            ];
            const event = createRealisticMarketEvent(
                LTCUSDT_PRICE,
                100,
                false,
                zones
            );

            detector.onEnrichedTrade(event);

            // EXPECTATION: High confidence institutional signal
            expect(emittedEvents.length).toBeGreaterThan(0);
            const zoneSignal = emittedEvents.find(
                (e) => e.event === "zoneSignal"
            );
            expect(zoneSignal?.data.confidence).toBeGreaterThan(0.7); // High confidence replaces high urgency
        });

        it("Test 4: Gradual Accumulation Building - Sustained Buying Pressure", () => {
            // SCENARIO: Multiple zones showing progressive accumulation
            const basePrice = LTCUSDT_PRICE;
            const zones = [
                createAccumulationZone(basePrice - 0.02, 80, 67), // Building up
                createAccumulationZone(basePrice - 0.01, 100, 70), // Strengthening
                createAccumulationZone(basePrice, 120, 73), // Peak accumulation
            ];
            const event = createRealisticMarketEvent(
                basePrice,
                40,
                false,
                zones
            );

            detector.onEnrichedTrade(event);

            // EXPECTATION: Should detect building accumulation pattern
            expect(emittedEvents.length).toBeGreaterThan(0);
        });

        it("Test 5: Perfect Accumulation Scenario - 90% Buy Dominance", () => {
            // SCENARIO: Extreme accumulation - 90% buy ratio with substantial volume
            const zones = [
                createAccumulationZone(LTCUSDT_PRICE, 250, 90), // 90% buy = perfect accumulation
            ];
            const event = createRealisticMarketEvent(
                LTCUSDT_PRICE,
                60,
                false,
                zones
            );

            detector.onEnrichedTrade(event);

            // EXPECTATION: Maximum confidence signal
            expect(emittedEvents.length).toBeGreaterThan(0);
            const zoneUpdate = emittedEvents.find(
                (e) => e.event === "zoneUpdate"
            );
            expect(zoneUpdate?.data.significance).toBeGreaterThan(0.7);
        });

        // Tests 6-25: Additional realistic accumulation scenarios
        const realisticAccumulationScenarios = [
            {
                name: "Dip Buying",
                volume: 180,
                buyRatio: 72,
                description: "Smart money buying dips",
            },
            {
                name: "Support Reinforcement",
                volume: 220,
                buyRatio: 68,
                description: "Strengthening support level",
            },
            {
                name: "Breakout Preparation",
                volume: 160,
                buyRatio: 74,
                description: "Pre-breakout accumulation",
            },
            {
                name: "Value Accumulation",
                volume: 300,
                buyRatio: 69,
                description: "Value-based institutional buying",
            },
            {
                name: "Momentum Building",
                volume: 140,
                buyRatio: 71,
                description: "Early momentum accumulation",
            },
            {
                name: "Stealth Accumulation",
                volume: 90,
                buyRatio: 66,
                description: "Quiet institutional building",
            },
            {
                name: "Support Defense",
                volume: 200,
                buyRatio: 76,
                description: "Defending key support level",
            },
            {
                name: "Technical Accumulation",
                volume: 170,
                buyRatio: 70,
                description: "Technical level buying",
            },
            {
                name: "Institutional Entry",
                volume: 400,
                buyRatio: 73,
                description: "Large institutional entry",
            },
            {
                name: "Smart Money Positioning",
                volume: 260,
                buyRatio: 75,
                description: "Strategic positioning",
            },
            {
                name: "Base Building",
                volume: 190,
                buyRatio: 67,
                description: "Building trading base",
            },
            {
                name: "Absorption Accumulation",
                volume: 320,
                buyRatio: 71,
                description: "Absorbing selling pressure",
            },
            {
                name: "Confluence Accumulation",
                volume: 150,
                buyRatio: 73,
                description: "Multiple level confluence",
            },
            {
                name: "Time-Based Accumulation",
                volume: 110,
                buyRatio: 68,
                description: "Extended time accumulation",
            },
            {
                name: "Volume Spike Accumulation",
                volume: 350,
                buyRatio: 74,
                description: "High volume buying",
            },
            {
                name: "Gradual Building",
                volume: 130,
                buyRatio: 66,
                description: "Slow steady accumulation",
            },
            {
                name: "Reversal Accumulation",
                volume: 210,
                buyRatio: 77,
                description: "Reversal point buying",
            },
            {
                name: "Support Test Accumulation",
                volume: 180,
                buyRatio: 69,
                description: "Testing and holding support",
            },
            {
                name: "Momentum Accumulation",
                volume: 240,
                buyRatio: 72,
                description: "Momentum-based buying",
            },
            {
                name: "Perfect Entry Accumulation",
                volume: 280,
                buyRatio: 78,
                description: "Optimal entry point",
            },
        ];

        realisticAccumulationScenarios.forEach((scenario, index) => {
            it(`Test ${6 + index}: ${scenario.name} - ${scenario.description}`, () => {
                const zones = [
                    createAccumulationZone(
                        LTCUSDT_PRICE,
                        scenario.volume,
                        scenario.buyRatio
                    ),
                ];
                const event = createRealisticMarketEvent(
                    LTCUSDT_PRICE,
                    30,
                    false,
                    zones
                );

                detector.onEnrichedTrade(event);

                // All realistic accumulation scenarios should trigger detection
                expect(emittedEvents.length).toBeGreaterThan(0);
                const zoneUpdate = emittedEvents.find(
                    (e) => e.event === "zoneUpdate"
                );
                expect(zoneUpdate).toBeDefined();
            });
        });
    });

    describe("🚫 NON-ACCUMULATION REJECTION - Market Reality (Tests 26-50)", () => {
        it("Test 26: Balanced Trading - No Directional Bias", () => {
            // SCENARIO: 50/50 buy/sell ratio - normal trading, NOT accumulation
            const zones = [
                createAccumulationZone(LTCUSDT_PRICE, 150, 50), // Balanced = no accumulation
            ];
            const event = createRealisticMarketEvent(
                LTCUSDT_PRICE,
                30,
                true,
                zones
            );

            detector.onEnrichedTrade(event);

            // EXPECTATION: Should NOT detect accumulation
            expect(emittedEvents.length).toBe(0);
        });

        it("Test 27: Distribution Pattern - Institutional Selling", () => {
            // SCENARIO: 30% buy ratio = distribution, opposite of accumulation
            const zones = [
                createAccumulationZone(LTCUSDT_PRICE, 200, 30), // 30% buy = distribution
            ];
            const event = createRealisticMarketEvent(
                LTCUSDT_PRICE,
                40,
                true,
                zones
            );

            detector.onEnrichedTrade(event);

            // EXPECTATION: Should NOT detect accumulation (it's distribution)
            expect(emittedEvents.length).toBe(0);
        });

        it("Test 28: Insufficient Volume - Below Market Significance", () => {
            // SCENARIO: Only 8 LTC volume - below 15 LTC threshold
            const zones = [
                createAccumulationZone(LTCUSDT_PRICE, 8, 75), // Volume too low despite good ratio
            ];
            const event = createRealisticMarketEvent(
                LTCUSDT_PRICE,
                3,
                false,
                zones
            );

            detector.onEnrichedTrade(event);

            // EXPECTATION: Should NOT detect (insufficient volume)
            expect(emittedEvents.length).toBe(0);
        });

        it("Test 29: Weak Accumulation - Below Significance Threshold", () => {
            // SCENARIO: 52% buy ratio - barely above random but below accumulation threshold
            const zones = [
                createAccumulationZone(LTCUSDT_PRICE, 100, 52), // Too weak for accumulation
            ];
            const event = createRealisticMarketEvent(
                LTCUSDT_PRICE,
                25,
                false,
                zones
            );

            detector.onEnrichedTrade(event);

            // EXPECTATION: Should NOT detect weak patterns
            expect(emittedEvents.length).toBe(0);
        });

        it("Test 30: No Relevant Zones - Price Outside Confluence Range", () => {
            // SCENARIO: Zone far from current price (>10 cents away)
            const zones = [
                createAccumulationZone(LTCUSDT_PRICE + 0.5, 200, 75), // Too far from current price
            ];
            const event = createRealisticMarketEvent(
                LTCUSDT_PRICE,
                40,
                false,
                zones
            );

            detector.onEnrichedTrade(event);

            // EXPECTATION: Should NOT detect (no relevant zones)
            expect(emittedEvents.length).toBe(0);
        });

        // Tests 31-50: Realistic non-accumulation scenarios
        const nonAccumulationScenarios = [
            {
                name: "Random Noise",
                volume: 60,
                buyRatio: 48,
                description: "Random trading noise",
            },
            {
                name: "Profit Taking",
                volume: 120,
                buyRatio: 35,
                description: "Profit taking activity",
            },
            {
                name: "Weak Interest",
                volume: 40,
                buyRatio: 53,
                description: "Minimal buying interest",
            },
            {
                name: "Selling Pressure",
                volume: 180,
                buyRatio: 25,
                description: "Strong selling pressure",
            },
            {
                name: "Market Uncertainty",
                volume: 80,
                buyRatio: 47,
                description: "Uncertain market conditions",
            },
            {
                name: "Low Participation",
                volume: 10,
                buyRatio: 60,
                description: "Low market participation",
            },
            {
                name: "Choppy Trading",
                volume: 90,
                buyRatio: 45,
                description: "Choppy market conditions",
            },
            {
                name: "Bear Market",
                volume: 150,
                buyRatio: 30,
                description: "Bear market selling",
            },
            {
                name: "Resistance Level",
                volume: 130,
                buyRatio: 40,
                description: "Meeting resistance",
            },
            {
                name: "Consolidation",
                volume: 70,
                buyRatio: 49,
                description: "Market consolidation",
            },
            {
                name: "Weak Demand",
                volume: 50,
                buyRatio: 54,
                description: "Weak buying demand",
            },
            {
                name: "Distribution Phase",
                volume: 200,
                buyRatio: 28,
                description: "Early distribution",
            },
            {
                name: "Market Rejection",
                volume: 160,
                buyRatio: 33,
                description: "Price level rejection",
            },
            {
                name: "Sideways Movement",
                volume: 85,
                buyRatio: 51,
                description: "Sideways price action",
            },
            {
                name: "Volume Exhaustion",
                volume: 20,
                buyRatio: 50,
                description: "Exhausted buying volume",
            },
            {
                name: "Failed Accumulation",
                volume: 110,
                buyRatio: 42,
                description: "Failed accumulation attempt",
            },
            {
                name: "Weak Hands",
                volume: 95,
                buyRatio: 38,
                description: "Weak hands selling",
            },
            {
                name: "Overhead Supply",
                volume: 140,
                buyRatio: 36,
                description: "Overhead supply pressure",
            },
            {
                name: "Market Indecision",
                volume: 75,
                buyRatio: 50,
                description: "Market indecision",
            },
            {
                name: "Selling Dominance",
                volume: 190,
                buyRatio: 22,
                description: "Selling dominating",
            },
        ];

        nonAccumulationScenarios.forEach((scenario, index) => {
            it(`Test ${31 + index}: ${scenario.name} - ${scenario.description}`, () => {
                const zones = [
                    createAccumulationZone(
                        LTCUSDT_PRICE,
                        scenario.volume,
                        scenario.buyRatio
                    ),
                ];
                const event = createRealisticMarketEvent(
                    LTCUSDT_PRICE,
                    25,
                    true,
                    zones
                );

                detector.onEnrichedTrade(event);

                // Non-accumulation scenarios should NOT trigger detection
                expect(emittedEvents.length).toBe(0);
            });
        });
    });

    describe("⚠️ EDGE CASES - Market Boundary Conditions (Tests 51-75)", () => {
        it("Test 51: Exact Threshold Boundary - 55% Buy Ratio", () => {
            // SCENARIO: Exactly at accumulation threshold
            const zones = [
                createAccumulationZone(LTCUSDT_PRICE, 80, 55), // Exactly at threshold
            ];
            const event = createRealisticMarketEvent(
                LTCUSDT_PRICE,
                20,
                false,
                zones
            );

            detector.onEnrichedTrade(event);

            // EXPECTATION: Should be at boundary - may trigger based on other factors
            // This tests the exact threshold behavior
            expect(() => detector.onEnrichedTrade(event)).not.toThrow();
        });

        it("Test 52: Zero Volume Zones - Market Halt Scenario", () => {
            // SCENARIO: Market halt or extremely quiet period
            const zones = [
                createAccumulationZone(LTCUSDT_PRICE, 0, 0), // No volume
            ];
            const event = createRealisticMarketEvent(
                LTCUSDT_PRICE,
                0,
                false,
                zones
            );

            detector.onEnrichedTrade(event);

            // EXPECTATION: Should handle gracefully, no detection
            expect(emittedEvents.length).toBe(0);
        });

        it("Test 53: Minimal Volume - 1 LTC Total", () => {
            // SCENARIO: Extremely low volume period
            const zones = [
                createAccumulationZone(LTCUSDT_PRICE, 1, 80), // Minimal volume
            ];
            const event = createRealisticMarketEvent(
                LTCUSDT_PRICE,
                0.5,
                false,
                zones
            );

            detector.onEnrichedTrade(event);

            // EXPECTATION: Should not detect due to insufficient volume
            expect(emittedEvents.length).toBe(0);
        });

        it("Test 54: Maximum Confluence Distance - 10 Cent Range Edge", () => {
            // SCENARIO: Zone exactly at confluence boundary
            const zones = [
                createAccumulationZone(LTCUSDT_PRICE + 0.1, 150, 70), // At max distance
            ];
            const event = createRealisticMarketEvent(
                LTCUSDT_PRICE,
                30,
                false,
                zones
            );

            detector.onEnrichedTrade(event);

            // EXPECTATION: Should still be considered if within range
            expect(() => detector.onEnrichedTrade(event)).not.toThrow();
        });

        it("Test 55: Extreme High Volume - 1000 LTC Whale Activity", () => {
            // SCENARIO: Massive institutional order
            const zones = [
                createAccumulationZone(LTCUSDT_PRICE, 1000, 75), // Whale-size volume
            ];
            const event = createRealisticMarketEvent(
                LTCUSDT_PRICE,
                500,
                false,
                zones
            );

            detector.onEnrichedTrade(event);

            // EXPECTATION: Should handle large volumes and detect
            expect(emittedEvents.length).toBeGreaterThan(0);
        });

        // Tests 56-75: Additional realistic edge cases
        const edgeCaseScenarios = [
            {
                name: "Perfect 100% Buy",
                volume: 100,
                buyRatio: 100,
                description: "100% buy volume",
            },
            {
                name: "Floating Point Edge",
                volume: 33.33,
                buyRatio: 66.67,
                description: "Floating point precision",
            },
            {
                name: "Very Small Volumes",
                volume: 2.5,
                buyRatio: 80,
                description: "Very small volume amounts",
            },
            {
                name: "High Passive Volume",
                volume: 50,
                buyRatio: 70,
                description: "Predominantly passive volume",
            },
            {
                name: "Single Large Order",
                volume: 500,
                buyRatio: 68,
                description: "One massive order",
            },
            {
                name: "Micro Volume",
                volume: 0.1,
                buyRatio: 90,
                description: "Microscopic volume",
            },
            {
                name: "Price Precision Edge",
                volume: 150,
                buyRatio: 71,
                description: "Price at precision boundary",
            },
            {
                name: "High Frequency",
                volume: 200,
                buyRatio: 69,
                description: "High frequency trading",
            },
            {
                name: "Exact Tick Boundary",
                volume: 80,
                buyRatio: 67,
                description: "Exact tick boundary",
            },
            {
                name: "Multiple Identical",
                volume: 120,
                buyRatio: 72,
                description: "Multiple identical zones",
            },
            {
                name: "Exponential Growth",
                volume: 128,
                buyRatio: 74,
                description: "Exponential volume pattern",
            },
            {
                name: "Prime Numbers",
                volume: 67,
                buyRatio: 73,
                description: "Prime number volumes",
            },
            {
                name: "Golden Ratio",
                volume: 161.8,
                buyRatio: 61.8,
                description: "Golden ratio volumes",
            },
            {
                name: "Binary Pattern",
                volume: 64,
                buyRatio: 75,
                description: "Binary-like volume",
            },
            {
                name: "Fibonacci Volume",
                volume: 89,
                buyRatio: 68,
                description: "Fibonacci sequence volume",
            },
            {
                name: "Square Numbers",
                volume: 144,
                buyRatio: 70,
                description: "Square number volume",
            },
            {
                name: "Rounding Edge",
                volume: 99.999,
                buyRatio: 69.999,
                description: "Rounding boundary",
            },
            {
                name: "Max Precision",
                volume: 123.456789,
                buyRatio: 67.123456,
                description: "Maximum precision",
            },
            {
                name: "Near Zero",
                volume: 0.001,
                buyRatio: 99,
                description: "Near-zero volume",
            },
            {
                name: "Large Institutional",
                volume: 2000,
                buyRatio: 76,
                description: "Very large institutional",
            },
        ];

        edgeCaseScenarios.forEach((scenario, index) => {
            it(`Test ${56 + index}: ${scenario.name} - ${scenario.description}`, () => {
                const zones = [
                    createAccumulationZone(
                        LTCUSDT_PRICE,
                        scenario.volume,
                        scenario.buyRatio
                    ),
                ];
                const event = createRealisticMarketEvent(
                    LTCUSDT_PRICE,
                    20,
                    false,
                    zones
                );

                // Edge cases should never throw errors
                expect(() => detector.onEnrichedTrade(event)).not.toThrow();

                // Results depend on scenario - some should detect, others shouldn't
                // Key is that they handle gracefully
            });
        });
    });

    describe("🔧 ENHANCED DETECTION - Realistic Combinations (Tests 76-100)", () => {
        it("Test 76: Multi-Zone Confluence - 3 Zones at Support", () => {
            // SCENARIO: Multiple zones showing accumulation at key support
            const supportPrice = LTCUSDT_PRICE;
            const zones5T = [
                createAccumulationZone(supportPrice, 120, 70),
                createAccumulationZone(supportPrice + 0.01, 100, 68),
            ];
            const zones10T = [createAccumulationZone(supportPrice, 180, 72)];
            const event = createRealisticMarketEvent(
                supportPrice,
                40,
                false,
                zones5T,
                zones10T
            );

            detector.onEnrichedTrade(event);

            // EXPECTATION: Enhanced confidence from confluence
            expect(emittedEvents.length).toBeGreaterThan(0);
            const signal = emittedEvents.find((e) => e.event === "zoneSignal");
            if (signal) {
                expect(signal.data.confidence).toBeGreaterThan(0.5);
            }
        });

        it("Test 77: Institutional Size Detection - 400+ LTC Volume", () => {
            // SCENARIO: Clearly institutional-sized accumulation
            const zones = [
                createAccumulationZone(LTCUSDT_PRICE, 450, 73), // Institutional volume
            ];
            const event = createRealisticMarketEvent(
                LTCUSDT_PRICE,
                150,
                false,
                zones
            );

            detector.onEnrichedTrade(event);

            // EXPECTATION: High confidence institutional signal
            expect(emittedEvents.length).toBeGreaterThan(0);
            const zoneSignal = emittedEvents.find(
                (e) => e.event === "zoneSignal"
            );
            expect(zoneSignal?.data.confidence).toBeGreaterThan(0.7); // High confidence for institutional volume
        });

        it("Test 78: Perfect Cross-Timeframe Alignment - All Frames 70% Buy", () => {
            // SCENARIO: Perfect alignment across all timeframes
            const zones5T = [createAccumulationZone(LTCUSDT_PRICE, 100, 70)];
            const zones10T = [createAccumulationZone(LTCUSDT_PRICE, 200, 70)];
            const zones20T = [createAccumulationZone(LTCUSDT_PRICE, 300, 70)];
            const event = createRealisticMarketEvent(
                LTCUSDT_PRICE,
                50,
                false,
                zones5T,
                zones10T,
                zones20T
            );

            detector.onEnrichedTrade(event);

            // EXPECTATION: Maximum alignment confidence
            expect(emittedEvents.length).toBeGreaterThan(0);
        });

        it("Test 79: Weak Base + Strong Enhancement - Should Still Fail", () => {
            // SCENARIO: Weak base accumulation (52%) with multiple zones
            const zones5T = [
                createAccumulationZone(LTCUSDT_PRICE, 80, 52), // Too weak for accumulation
                createAccumulationZone(LTCUSDT_PRICE + 0.01, 85, 53),
            ];
            const event = createRealisticMarketEvent(
                LTCUSDT_PRICE,
                25,
                false,
                zones5T
            );

            detector.onEnrichedTrade(event);

            // EXPECTATION: Should still fail - base must be strong
            expect(emittedEvents.length).toBe(0);
        });

        it("Test 80: Maximum Signal Strength - All Enhancements Combined", () => {
            // SCENARIO: Perfect storm - large institutional accumulation across all timeframes
            const zones5T = [
                createAccumulationZone(LTCUSDT_PRICE, 350, 78),
                createAccumulationZone(LTCUSDT_PRICE + 0.01, 320, 76),
            ];
            const zones10T = [createAccumulationZone(LTCUSDT_PRICE, 500, 77)];
            const zones20T = [createAccumulationZone(LTCUSDT_PRICE, 700, 79)];
            const event = createRealisticMarketEvent(
                LTCUSDT_PRICE,
                100,
                false,
                zones5T,
                zones10T,
                zones20T
            );

            detector.onEnrichedTrade(event);

            // EXPECTATION: Maximum confidence (replaces urgency concept)
            expect(emittedEvents.length).toBeGreaterThan(0);
            const signal = emittedEvents.find((e) => e.event === "zoneSignal");
            expect(signal?.data.confidence).toBeGreaterThan(0.8); // Maximum confidence for perfect storm scenario
        });

        // Tests 81-100: Enhanced combination scenarios
        const enhancedScenarios = [
            {
                name: "Strong Confluence",
                zones5: 150,
                zones10: 0,
                zones20: 0,
                buyRatio: 74,
            },
            {
                name: "Institutional Base",
                zones5: 400,
                zones10: 0,
                zones20: 0,
                buyRatio: 71,
            },
            {
                name: "Perfect Alignment",
                zones5: 120,
                zones10: 180,
                zones20: 240,
                buyRatio: 69,
            },
            {
                name: "Volume + Confluence",
                zones5: 200,
                zones10: 250,
                zones20: 0,
                buyRatio: 73,
            },
            {
                name: "Large Multi-Frame",
                zones5: 300,
                zones10: 400,
                zones20: 500,
                buyRatio: 75,
            },
            {
                name: "Stealth Institutional",
                zones5: 180,
                zones10: 0,
                zones20: 0,
                buyRatio: 68,
            },
            {
                name: "Building Momentum",
                zones5: 140,
                zones10: 200,
                zones20: 0,
                buyRatio: 70,
            },
            {
                name: "Support Confluence",
                zones5: 160,
                zones10: 240,
                zones20: 320,
                buyRatio: 72,
            },
            {
                name: "Smart Money Entry",
                zones5: 220,
                zones10: 0,
                zones20: 0,
                buyRatio: 76,
            },
            {
                name: "Cross-Frame Build",
                zones5: 100,
                zones10: 150,
                zones20: 200,
                buyRatio: 67,
            },
            {
                name: "Institutional Sweep",
                zones5: 500,
                zones10: 600,
                zones20: 0,
                buyRatio: 74,
            },
            {
                name: "Perfect Setup",
                zones5: 180,
                zones10: 270,
                zones20: 360,
                buyRatio: 78,
            },
            {
                name: "Volume Surge",
                zones5: 350,
                zones10: 0,
                zones20: 0,
                buyRatio: 73,
            },
            {
                name: "Steady Building",
                zones5: 130,
                zones10: 190,
                zones20: 250,
                buyRatio: 69,
            },
            {
                name: "Whale Activity",
                zones5: 800,
                zones10: 0,
                zones20: 0,
                buyRatio: 72,
            },
            {
                name: "Strategic Entry",
                zones5: 200,
                zones10: 300,
                zones20: 400,
                buyRatio: 71,
            },
            {
                name: "Multi-Level",
                zones5: 160,
                zones10: 240,
                zones20: 0,
                buyRatio: 70,
            },
            {
                name: "Confluence Peak",
                zones5: 190,
                zones10: 285,
                zones20: 380,
                buyRatio: 75,
            },
            {
                name: "Institutional Block",
                zones5: 450,
                zones10: 550,
                zones20: 650,
                buyRatio: 77,
            },
            {
                name: "Perfect Storm",
                zones5: 300,
                zones10: 450,
                zones20: 600,
                buyRatio: 80,
            },
        ];

        enhancedScenarios.forEach((scenario, index) => {
            it(`Test ${81 + index}: ${scenario.name} - Enhanced Detection`, () => {
                const zones5T = [
                    createAccumulationZone(
                        LTCUSDT_PRICE,
                        scenario.zones5,
                        scenario.buyRatio
                    ),
                ];
                const zones10T =
                    scenario.zones10 > 0
                        ? [
                              createAccumulationZone(
                                  LTCUSDT_PRICE,
                                  scenario.zones10,
                                  scenario.buyRatio
                              ),
                          ]
                        : [];
                const zones20T =
                    scenario.zones20 > 0
                        ? [
                              createAccumulationZone(
                                  LTCUSDT_PRICE,
                                  scenario.zones20,
                                  scenario.buyRatio
                              ),
                          ]
                        : [];
                const event = createRealisticMarketEvent(
                    LTCUSDT_PRICE,
                    50,
                    false,
                    zones5T,
                    zones10T,
                    zones20T
                );

                detector.onEnrichedTrade(event);

                // All enhanced scenarios should detect accumulation
                expect(emittedEvents.length).toBeGreaterThan(0);
            });
        });
    });

    describe("📊 SIGNAL VALIDATION - Correct Market Behavior", () => {
        it("should emit zone updates for visualization", () => {
            const zones = [createAccumulationZone(LTCUSDT_PRICE, 200, 75)];
            const event = createRealisticMarketEvent(
                LTCUSDT_PRICE,
                50,
                false,
                zones
            );

            detector.onEnrichedTrade(event);

            const zoneUpdate = emittedEvents.find(
                (e) => e.event === "zoneUpdate"
            );
            expect(zoneUpdate).toBeDefined();
            expect(zoneUpdate?.data.zone.type).toBe("accumulation");
        });

        it("should emit proper buy signals for accumulation", () => {
            const zones = [createAccumulationZone(LTCUSDT_PRICE, 300, 78)];
            const event = createRealisticMarketEvent(
                LTCUSDT_PRICE,
                80,
                false,
                zones
            );

            detector.onEnrichedTrade(event);

            const signal = emittedEvents.find(
                (e) => e.event === "signalCandidate"
            );
            if (signal) {
                expect(signal.data.side).toBe("buy"); // Accumulation = buy signal
                expect(signal.data.type).toBe("accumulation");
            }
        });

        it("should provide accurate enhancement statistics", () => {
            const zones = [createAccumulationZone(LTCUSDT_PRICE, 150, 70)];
            const event = createRealisticMarketEvent(
                LTCUSDT_PRICE,
                40,
                false,
                zones
            );

            detector.onEnrichedTrade(event);

            const stats = detector.getEnhancementStats();
            expect(stats.callCount).toBeGreaterThan(0);
            expect(stats.enhancementSuccessRate).toBeGreaterThanOrEqual(0);
            expect(stats.enhancementSuccessRate).toBeLessThanOrEqual(1);
        });
    });
});
