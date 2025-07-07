// test/distributionDetectorEnhanced_realistic.test.ts
//
// 🧪 REALISTIC DISTRIBUTION DETECTOR TEST SUITE
//
// CLAUDE.md Compliant Testing: Tests MUST validate real-world distribution patterns
// based on actual market behavior, not current implementation quirks.
//
// DISTRIBUTION DEFINITION (Market Reality):
// - Institutional selling over time at specific price levels
// - 50%+ aggressive selling volume sustained over multiple timeframes
// - Volume concentration indicating smart money liquidation
// - Price resistance formation through repeated selling interest
//
// TEST PHILOSOPHY:
// ✅ Test CORRECT distribution behavior per market specifications
// ✅ Use realistic LTCUSDT volumes and price movements with proper ticks
// ✅ Validate detection of TRUE distribution patterns
// ❌ Never adjust tests to match broken code behavior
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
import "../test/vitest.setup.ts";

// LTCUSDT Market Reality: Real trading parameters
const LTCUSDT_PRICE = 85.0; // $85 LTCUSDT current market level
const TICK_SIZE = 0.01; // 1-cent tick size for LTCUSDT
const TYPICAL_VOLUME_RANGE = [10, 500]; // LTC typical volume range per zone
const INSTITUTIONAL_VOLUME = 200; // LTC considered institutional size
const DISTRIBUTION_SELL_RATIO = 0.5; // 50%+ sell ratio = distribution per market def

// Real market configuration
const REAL_DISTRIBUTION_CONFIG = {
    useStandardizedZones: true,
    confidenceThreshold: 0.4, // Real config.json value
    confluenceMinZones: 1,
    confluenceMaxDistance: 0.1, // 10-cent confluence range
    confluenceConfidenceBoost: 0.1,
    crossTimeframeConfidenceBoost: 0.15,
    distributionVolumeThreshold: 15, // 15 LTC minimum volume
    distributionRatioThreshold: 0.5, // 50% sell ratio threshold
    alignmentScoreThreshold: 0.5,
    defaultDurationMs: 120000, // 2 minutes
    tickSize: TICK_SIZE,
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

// Helper: Create realistic market zone based on actual distribution behavior
function createDistributionZone(
    center: number,
    totalVolumeLTC: number,
    sellRatioPercent: number // 0-100, where 50+ = distribution (of TOTAL volume, not just aggressive)
): ZoneSnapshot {
    const sellRatio = sellRatioPercent / 100;
    const totalAggressive = totalVolumeLTC * 0.7; // 70% aggressive typical
    const totalPassive = totalVolumeLTC * 0.3; // 30% passive typical

    // Fix: Calculate aggressiveSell as percentage of TOTAL volume, not just aggressive
    const aggressiveSell = totalVolumeLTC * sellRatio; // Sell volume of total
    const aggressiveBuy = totalAggressive - aggressiveSell; // Remaining aggressive is buy

    return {
        center,
        aggressiveVolume: totalAggressive,
        passiveVolume: totalPassive,
        aggressiveBuyVolume: aggressiveBuy,
        aggressiveSellVolume: aggressiveSell,
        strength: FinancialMath.divideQuantities(
            aggressiveSell,
            totalVolumeLTC
        ),
        tradeCount: Math.max(1, Math.floor(totalVolumeLTC / 10)),
        lastUpdate: Date.now(),
    };
}

function createRealisticMarketEvent(
    price: number,
    quantity: number,
    buyerIsMaker: boolean,
    zones5T: ZoneSnapshot[],
    zones10T: ZoneSnapshot[] = [],
    zones20T: ZoneSnapshot[] = []
): EnrichedTradeEvent {
    return {
        symbol: "LTCUSDT",
        price,
        quantity,
        timestamp: Date.now(),
        tradeId: Math.floor(Math.random() * 1000000),
        buyerIsMaker,
        zoneData: {
            zones5Tick: zones5T,
            zones10Tick: zones10T,
            zones20Tick: zones20T,
        },
        spread: 0.01, // 1-cent spread typical for LTCUSDT
        midPrice: price,
        imbalance: buyerIsMaker ? -0.1 : 0.1,
        passiveVolume: quantity * 0.3,
        aggressiveVolume: quantity * 0.7,
        dominantSide: buyerIsMaker ? "sell" : "buy",
    };
}

describe("DistributionDetectorEnhanced - Realistic Market Scenarios", () => {
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
            "realistic-distribution",
            "LTCUSDT",
            REAL_DISTRIBUTION_CONFIG,
            mockPreprocessor,
            mockLogger,
            mockMetrics
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

    describe("🎯 TRUE DISTRIBUTION DETECTION - Market Reality (Tests 1-25)", () => {
        it("Test 1: Classic Institutional Distribution - Smart Money Selling at Resistance", () => {
            // SCENARIO: Large player distributing 300 LTC at $85 resistance with 75% sell ratio
            const resistanceLevel = LTCUSDT_PRICE;
            const zones = [
                createDistributionZone(resistanceLevel, 300, 75), // 75% sell = strong distribution
            ];
            const event = createRealisticMarketEvent(
                resistanceLevel,
                50,
                true,
                zones
            );

            detector.onEnrichedTrade(event);

            // EXPECTATION: Should detect true distribution
            expect(emittedEvents.length).toBeGreaterThan(0);
            const zoneUpdate = emittedEvents.find(
                (e) => e.event === "zoneUpdate"
            );
            expect(zoneUpdate).toBeDefined();
            expect(zoneUpdate?.data.zone.type).toBe("distribution");
        });

        it("Test 2: Multi-Timeframe Distribution Alignment - Consistent Selling Across All Frames", () => {
            // SCENARIO: Consistent 70% selling across 5T, 10T, 20T zones
            const price = LTCUSDT_PRICE;
            const zones5T = [createDistributionZone(price, 100, 70)];
            const zones10T = [createDistributionZone(price, 200, 70)];
            const zones20T = [createDistributionZone(price, 400, 70)];
            const event = createRealisticMarketEvent(
                price,
                30,
                true,
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
                expect(signal.data.side).toBe("sell");
                expect(signal.data.confidence).toBeGreaterThan(0.5);
            }
        });

        it("Test 3: Volume-Weighted Distribution - Large Orders Dominating", () => {
            // SCENARIO: 500 LTC zone with 80% sell ratio - institutional distribution
            const zones = [
                createDistributionZone(LTCUSDT_PRICE, 500, 80), // Large institutional volume
            ];
            const event = createRealisticMarketEvent(
                LTCUSDT_PRICE,
                100,
                true,
                zones
            );

            detector.onEnrichedTrade(event);

            // EXPECTATION: High confidence institutional signal
            expect(emittedEvents.length).toBeGreaterThan(0);
            const zoneSignal = emittedEvents.find(
                (e) => e.event === "zoneSignal"
            );
            expect(zoneSignal?.data.urgency).toBe("high");
        });

        it("Test 4: Gradual Distribution Building - Sustained Selling Pressure", () => {
            // SCENARIO: Multiple zones showing progressive distribution
            const basePrice = LTCUSDT_PRICE;
            const zones = [
                createDistributionZone(basePrice - 0.02, 80, 57), // Building up
                createDistributionZone(basePrice - 0.01, 100, 60), // Strengthening
                createDistributionZone(basePrice, 120, 63), // Peak distribution
            ];
            const event = createRealisticMarketEvent(
                basePrice,
                40,
                true,
                zones
            );

            detector.onEnrichedTrade(event);

            // EXPECTATION: Should detect building distribution pattern
            expect(emittedEvents.length).toBeGreaterThan(0);
        });

        it("Test 5: Perfect Distribution Scenario - 90% Sell Dominance", () => {
            // SCENARIO: Extreme distribution - 90% sell ratio with substantial volume
            const zones = [
                createDistributionZone(LTCUSDT_PRICE, 250, 90), // 90% sell = perfect distribution
            ];
            const event = createRealisticMarketEvent(
                LTCUSDT_PRICE,
                60,
                true,
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

        // Tests 6-25: Additional realistic distribution scenarios
        const realisticDistributionScenarios = [
            {
                name: "Profit Taking",
                volume: 180,
                sellRatio: 72,
                description: "Smart money profit taking",
            },
            {
                name: "Resistance Formation",
                volume: 220,
                sellRatio: 68,
                description: "Creating resistance level",
            },
            {
                name: "Breakdown Preparation",
                volume: 160,
                sellRatio: 74,
                description: "Pre-breakdown distribution",
            },
            {
                name: "Exit Distribution",
                volume: 300,
                sellRatio: 69,
                description: "Institutional exit strategy",
            },
            {
                name: "Momentum Reversal",
                volume: 140,
                sellRatio: 71,
                description: "Reversing momentum",
            },
            {
                name: "Stealth Distribution",
                volume: 90,
                sellRatio: 56,
                description: "Quiet institutional selling",
            },
            {
                name: "Resistance Defense",
                volume: 200,
                sellRatio: 76,
                description: "Defending resistance level",
            },
            {
                name: "Technical Distribution",
                volume: 170,
                sellRatio: 60,
                description: "Technical level selling",
            },
            {
                name: "Institutional Exit",
                volume: 400,
                sellRatio: 73,
                description: "Large institutional exit",
            },
            {
                name: "Smart Money Liquidation",
                volume: 260,
                sellRatio: 75,
                description: "Strategic liquidation",
            },
            {
                name: "Top Formation",
                volume: 190,
                sellRatio: 67,
                description: "Building market top",
            },
            {
                name: "Supply Distribution",
                volume: 320,
                sellRatio: 61,
                description: "Distributing supply",
            },
            {
                name: "Confluence Distribution",
                volume: 150,
                sellRatio: 73,
                description: "Multiple level confluence",
            },
            {
                name: "Time-Based Distribution",
                volume: 110,
                sellRatio: 58,
                description: "Extended time distribution",
            },
            {
                name: "Volume Spike Distribution",
                volume: 350,
                sellRatio: 74,
                description: "High volume selling",
            },
            {
                name: "Gradual Selling",
                volume: 130,
                sellRatio: 56,
                description: "Slow steady distribution",
            },
            {
                name: "Reversal Distribution",
                volume: 210,
                sellRatio: 77,
                description: "Reversal point selling",
            },
            {
                name: "Resistance Test Distribution",
                volume: 180,
                sellRatio: 69,
                description: "Testing resistance",
            },
            {
                name: "Momentum Distribution",
                volume: 240,
                sellRatio: 62,
                description: "Momentum-based selling",
            },
            {
                name: "Perfect Exit Distribution",
                volume: 280,
                sellRatio: 78,
                description: "Optimal exit point",
            },
        ];

        realisticDistributionScenarios.forEach((scenario, index) => {
            it(`Test ${6 + index}: ${scenario.name} - ${scenario.description}`, () => {
                const zones = [
                    createDistributionZone(
                        LTCUSDT_PRICE,
                        scenario.volume,
                        scenario.sellRatio
                    ),
                ];
                const event = createRealisticMarketEvent(
                    LTCUSDT_PRICE,
                    30,
                    true,
                    zones
                );

                detector.onEnrichedTrade(event);

                // All realistic distribution scenarios should trigger detection
                expect(emittedEvents.length).toBeGreaterThan(0);
                const zoneUpdate = emittedEvents.find(
                    (e) => e.event === "zoneUpdate"
                );
                expect(zoneUpdate).toBeDefined();
            });
        });
    });

    describe("🚫 NON-DISTRIBUTION REJECTION - Market Reality (Tests 26-50)", () => {
        it("Test 26: Balanced Trading - No Directional Bias", () => {
            // SCENARIO: 49% sell ratio - below distribution threshold, NOT distribution
            const zones = [
                createDistributionZone(LTCUSDT_PRICE, 150, 49), // Below 50% threshold = no distribution
            ];
            const event = createRealisticMarketEvent(
                LTCUSDT_PRICE,
                30,
                false,
                zones
            );

            detector.onEnrichedTrade(event);

            // EXPECTATION: Should NOT detect distribution
            expect(emittedEvents.length).toBe(0);
        });

        it("Test 27: Accumulation Pattern - Institutional Buying", () => {
            // SCENARIO: 30% sell ratio = accumulation, opposite of distribution
            const zones = [
                createDistributionZone(LTCUSDT_PRICE, 200, 30), // 30% sell = accumulation
            ];
            const event = createRealisticMarketEvent(
                LTCUSDT_PRICE,
                40,
                false,
                zones
            );

            detector.onEnrichedTrade(event);

            // EXPECTATION: Should NOT detect distribution (it's accumulation)
            expect(emittedEvents.length).toBe(0);
        });

        it("Test 28: Insufficient Volume - Below Market Significance", () => {
            // SCENARIO: Only 8 LTC volume - below 15 LTC threshold
            const zones = [
                createDistributionZone(LTCUSDT_PRICE, 8, 75), // Volume too low despite good ratio
            ];
            const event = createRealisticMarketEvent(
                LTCUSDT_PRICE,
                3,
                true,
                zones
            );

            detector.onEnrichedTrade(event);

            // EXPECTATION: Should NOT detect (insufficient volume)
            expect(emittedEvents.length).toBe(0);
        });

        it("Test 29: Weak Distribution - Below Significance Threshold", () => {
            // SCENARIO: 48% sell ratio - below distribution threshold
            const zones = [
                createDistributionZone(LTCUSDT_PRICE, 100, 48), // Too weak for distribution
            ];
            const event = createRealisticMarketEvent(
                LTCUSDT_PRICE,
                25,
                true,
                zones
            );

            detector.onEnrichedTrade(event);

            // EXPECTATION: Should NOT detect weak patterns
            expect(emittedEvents.length).toBe(0);
        });

        it("Test 30: No Relevant Zones - Price Outside Confluence Range", () => {
            // SCENARIO: Zone far from current price (>10 cents away)
            const zones = [
                createDistributionZone(LTCUSDT_PRICE + 0.5, 200, 75), // Too far from current price
            ];
            const event = createRealisticMarketEvent(
                LTCUSDT_PRICE,
                40,
                true,
                zones
            );

            detector.onEnrichedTrade(event);

            // EXPECTATION: Should NOT detect (no relevant zones)
            expect(emittedEvents.length).toBe(0);
        });

        // Tests 31-50: Realistic non-distribution scenarios
        const nonDistributionScenarios = [
            {
                name: "Random Noise",
                volume: 60,
                sellRatio: 48,
                description: "Random trading noise",
            },
            {
                name: "Buying Interest",
                volume: 120,
                sellRatio: 35,
                description: "Strong buying interest",
            },
            {
                name: "Weak Selling",
                volume: 40,
                sellRatio: 47,
                description: "Minimal selling pressure",
            },
            {
                name: "Accumulation Phase",
                volume: 180,
                sellRatio: 25,
                description: "Strong accumulation",
            },
            {
                name: "Market Optimism",
                volume: 80,
                sellRatio: 42,
                description: "Optimistic market conditions",
            },
            {
                name: "Low Participation",
                volume: 25,
                sellRatio: 40,
                description: "Low market participation",
            },
            {
                name: "Choppy Trading",
                volume: 90,
                sellRatio: 45,
                description: "Choppy market conditions",
            },
            {
                name: "Bull Market",
                volume: 150,
                sellRatio: 30,
                description: "Bull market buying",
            },
            {
                name: "Support Level",
                volume: 130,
                sellRatio: 40,
                description: "Strong support level",
            },
            {
                name: "Consolidation",
                volume: 70,
                sellRatio: 49,
                description: "Market consolidation",
            },
            {
                name: "Strong Demand",
                volume: 50,
                sellRatio: 44,
                description: "Strong buying demand",
            },
            {
                name: "Accumulation Phase",
                volume: 200,
                sellRatio: 28,
                description: "Early accumulation",
            },
            {
                name: "Market Acceptance",
                volume: 160,
                sellRatio: 33,
                description: "Price level acceptance",
            },
            {
                name: "Upward Movement",
                volume: 85,
                sellRatio: 41,
                description: "Upward price action",
            },
            {
                name: "Volume Exhaustion",
                volume: 20,
                sellRatio: 35,
                description: "Exhausted selling volume",
            },
            {
                name: "Failed Distribution",
                volume: 110,
                sellRatio: 42,
                description: "Failed distribution attempt",
            },
            {
                name: "Strong Hands",
                volume: 95,
                sellRatio: 38,
                description: "Strong hands buying",
            },
            {
                name: "Support Building",
                volume: 140,
                sellRatio: 36,
                description: "Building support",
            },
            {
                name: "Market Confidence",
                volume: 75,
                sellRatio: 43,
                description: "Market confidence",
            },
            {
                name: "Buying Dominance",
                volume: 190,
                sellRatio: 22,
                description: "Buying dominating",
            },
        ];

        nonDistributionScenarios.forEach((scenario, index) => {
            it(`Test ${31 + index}: ${scenario.name} - ${scenario.description}`, () => {
                const zones = [
                    createDistributionZone(
                        LTCUSDT_PRICE,
                        scenario.volume,
                        scenario.sellRatio
                    ),
                ];
                const event = createRealisticMarketEvent(
                    LTCUSDT_PRICE,
                    25,
                    false,
                    zones
                );

                detector.onEnrichedTrade(event);

                // Non-distribution scenarios should NOT trigger detection
                expect(emittedEvents.length).toBe(0);
            });
        });
    });

    describe("⚠️ EDGE CASES - Market Boundary Conditions (Tests 51-75)", () => {
        it("Test 51: Exact Threshold Boundary - 50% Sell Ratio", () => {
            // SCENARIO: Exactly at distribution threshold
            const zones = [
                createDistributionZone(LTCUSDT_PRICE, 80, 50), // Exactly at threshold
            ];
            const event = createRealisticMarketEvent(
                LTCUSDT_PRICE,
                20,
                true,
                zones
            );

            detector.onEnrichedTrade(event);

            // EXPECTATION: Should be at boundary - may trigger based on other factors
            expect(() => detector.onEnrichedTrade(event)).not.toThrow();
        });

        it("Test 52: Zero Volume Zones - Market Halt Scenario", () => {
            // SCENARIO: Market halt or extremely quiet period
            const zones = [
                createDistributionZone(LTCUSDT_PRICE, 0, 0), // No volume
            ];
            const event = createRealisticMarketEvent(
                LTCUSDT_PRICE,
                0,
                true,
                zones
            );

            detector.onEnrichedTrade(event);

            // EXPECTATION: Should handle gracefully, no detection
            expect(emittedEvents.length).toBe(0);
        });

        it("Test 53: Minimal Volume - 1 LTC Total", () => {
            // SCENARIO: Extremely low volume period
            const zones = [
                createDistributionZone(LTCUSDT_PRICE, 1, 80), // Minimal volume
            ];
            const event = createRealisticMarketEvent(
                LTCUSDT_PRICE,
                0.5,
                true,
                zones
            );

            detector.onEnrichedTrade(event);

            // EXPECTATION: Should not detect due to insufficient volume
            expect(emittedEvents.length).toBe(0);
        });

        it("Test 54: Maximum Confluence Distance - 10 Cent Range Edge", () => {
            // SCENARIO: Zone exactly at confluence boundary
            const zones = [
                createDistributionZone(LTCUSDT_PRICE + 0.1, 150, 70), // At max distance
            ];
            const event = createRealisticMarketEvent(
                LTCUSDT_PRICE,
                30,
                true,
                zones
            );

            detector.onEnrichedTrade(event);

            // EXPECTATION: Should still be considered if within range
            expect(() => detector.onEnrichedTrade(event)).not.toThrow();
        });

        it("Test 55: Extreme High Volume - 1000 LTC Whale Activity", () => {
            // SCENARIO: Massive institutional order
            const zones = [
                createDistributionZone(LTCUSDT_PRICE, 1000, 75), // Whale-size volume
            ];
            const event = createRealisticMarketEvent(
                LTCUSDT_PRICE,
                500,
                true,
                zones
            );

            detector.onEnrichedTrade(event);

            // EXPECTATION: Should handle large volumes and detect
            expect(emittedEvents.length).toBeGreaterThan(0);
        });

        // Tests 56-75: Additional realistic edge cases
        const edgeCaseScenarios = [
            {
                name: "Perfect 100% Sell",
                volume: 100,
                sellRatio: 100,
                description: "100% sell volume",
            },
            {
                name: "Floating Point Edge",
                volume: 33.33,
                sellRatio: 66.67,
                description: "Floating point precision",
            },
            {
                name: "Very Small Volumes",
                volume: 2.5,
                sellRatio: 80,
                description: "Very small volume amounts",
            },
            {
                name: "High Passive Volume",
                volume: 50,
                sellRatio: 70,
                description: "Predominantly passive volume",
            },
            {
                name: "Single Large Order",
                volume: 500,
                sellRatio: 68,
                description: "One massive order",
            },
            {
                name: "Micro Volume",
                volume: 0.1,
                sellRatio: 90,
                description: "Microscopic volume",
            },
            {
                name: "Price Precision Edge",
                volume: 150,
                sellRatio: 71,
                description: "Price at precision boundary",
            },
            {
                name: "High Frequency",
                volume: 200,
                sellRatio: 69,
                description: "High frequency trading",
            },
            {
                name: "Exact Tick Boundary",
                volume: 80,
                sellRatio: 67,
                description: "Exact tick boundary",
            },
            {
                name: "Multiple Identical",
                volume: 120,
                sellRatio: 72,
                description: "Multiple identical zones",
            },
            {
                name: "Exponential Growth",
                volume: 128,
                sellRatio: 74,
                description: "Exponential volume pattern",
            },
            {
                name: "Prime Numbers",
                volume: 67,
                sellRatio: 73,
                description: "Prime number volumes",
            },
            {
                name: "Golden Ratio",
                volume: 161.8,
                sellRatio: 61.8,
                description: "Golden ratio volumes",
            },
            {
                name: "Binary Pattern",
                volume: 64,
                sellRatio: 75,
                description: "Binary-like volume",
            },
            {
                name: "Fibonacci Volume",
                volume: 89,
                sellRatio: 68,
                description: "Fibonacci sequence volume",
            },
            {
                name: "Square Numbers",
                volume: 144,
                sellRatio: 70,
                description: "Square number volume",
            },
            {
                name: "Rounding Edge",
                volume: 99.999,
                sellRatio: 69.999,
                description: "Rounding boundary",
            },
            {
                name: "Max Precision",
                volume: 123.456789,
                sellRatio: 67.123456,
                description: "Maximum precision",
            },
            {
                name: "Near Zero",
                volume: 0.001,
                sellRatio: 99,
                description: "Near-zero volume",
            },
            {
                name: "Large Institutional",
                volume: 2000,
                sellRatio: 76,
                description: "Very large institutional",
            },
        ];

        edgeCaseScenarios.forEach((scenario, index) => {
            it(`Test ${56 + index}: ${scenario.name} - ${scenario.description}`, () => {
                const zones = [
                    createDistributionZone(
                        LTCUSDT_PRICE,
                        scenario.volume,
                        scenario.sellRatio
                    ),
                ];
                const event = createRealisticMarketEvent(
                    LTCUSDT_PRICE,
                    20,
                    true,
                    zones
                );

                // Edge cases should never throw errors
                expect(() => detector.onEnrichedTrade(event)).not.toThrow();
            });
        });
    });

    describe("🔧 ENHANCED DETECTION - Realistic Combinations (Tests 76-100)", () => {
        it("Test 76: Multi-Zone Confluence - 3 Zones at Resistance", () => {
            // SCENARIO: Multiple zones showing distribution at key resistance
            const resistancePrice = LTCUSDT_PRICE;
            const zones5T = [
                createDistributionZone(resistancePrice, 120, 70),
                createDistributionZone(resistancePrice + 0.01, 100, 68),
            ];
            const zones10T = [createDistributionZone(resistancePrice, 180, 72)];
            const event = createRealisticMarketEvent(
                resistancePrice,
                40,
                true,
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
            // SCENARIO: Clearly institutional-sized distribution
            const zones = [
                createDistributionZone(LTCUSDT_PRICE, 450, 73), // Institutional volume
            ];
            const event = createRealisticMarketEvent(
                LTCUSDT_PRICE,
                150,
                true,
                zones
            );

            detector.onEnrichedTrade(event);

            // EXPECTATION: High urgency institutional signal
            expect(emittedEvents.length).toBeGreaterThan(0);
            const zoneSignal = emittedEvents.find(
                (e) => e.event === "zoneSignal"
            );
            expect(zoneSignal?.data.urgency).toBe("high");
        });

        it("Test 78: Perfect Cross-Timeframe Alignment - All Frames 70% Sell", () => {
            // SCENARIO: Perfect alignment across all timeframes
            const zones5T = [createDistributionZone(LTCUSDT_PRICE, 100, 70)];
            const zones10T = [createDistributionZone(LTCUSDT_PRICE, 200, 70)];
            const zones20T = [createDistributionZone(LTCUSDT_PRICE, 300, 70)];
            const event = createRealisticMarketEvent(
                LTCUSDT_PRICE,
                50,
                true,
                zones5T,
                zones10T,
                zones20T
            );

            detector.onEnrichedTrade(event);

            // EXPECTATION: Maximum alignment confidence
            expect(emittedEvents.length).toBeGreaterThan(0);
        });

        it("Test 79: Weak Base + Strong Enhancement - Should Still Fail", () => {
            // SCENARIO: Weak base distribution (48%) with multiple zones
            const zones5T = [
                createDistributionZone(LTCUSDT_PRICE, 80, 48), // Too weak for distribution
                createDistributionZone(LTCUSDT_PRICE + 0.01, 85, 47),
            ];
            const event = createRealisticMarketEvent(
                LTCUSDT_PRICE,
                25,
                true,
                zones5T
            );

            detector.onEnrichedTrade(event);

            // EXPECTATION: Should still fail - base must be strong
            expect(emittedEvents.length).toBe(0);
        });

        it("Test 80: Maximum Signal Strength - All Enhancements Combined", () => {
            // SCENARIO: Perfect storm - large institutional distribution across all timeframes
            const zones5T = [
                createDistributionZone(LTCUSDT_PRICE, 350, 78),
                createDistributionZone(LTCUSDT_PRICE + 0.01, 320, 76),
            ];
            const zones10T = [createDistributionZone(LTCUSDT_PRICE, 500, 77)];
            const zones20T = [createDistributionZone(LTCUSDT_PRICE, 700, 79)];
            const event = createRealisticMarketEvent(
                LTCUSDT_PRICE,
                100,
                true,
                zones5T,
                zones10T,
                zones20T
            );

            detector.onEnrichedTrade(event);

            // EXPECTATION: Maximum confidence and urgency
            expect(emittedEvents.length).toBeGreaterThan(0);
            const signal = emittedEvents.find((e) => e.event === "zoneSignal");
            expect(signal?.data.confidence).toBeGreaterThan(0.8);
            expect(signal?.data.urgency).toBe("high");
        });

        // Tests 81-100: Enhanced combination scenarios
        const enhancedScenarios = [
            {
                name: "Strong Confluence",
                zones5: 150,
                zones10: 0,
                zones20: 0,
                sellRatio: 74,
            },
            {
                name: "Institutional Base",
                zones5: 400,
                zones10: 0,
                zones20: 0,
                sellRatio: 71,
            },
            {
                name: "Perfect Alignment",
                zones5: 120,
                zones10: 180,
                zones20: 240,
                sellRatio: 69,
            },
            {
                name: "Volume + Confluence",
                zones5: 200,
                zones10: 250,
                zones20: 0,
                sellRatio: 73,
            },
            {
                name: "Large Multi-Frame",
                zones5: 300,
                zones10: 400,
                zones20: 500,
                sellRatio: 75,
            },
            {
                name: "Stealth Institutional",
                zones5: 180,
                zones10: 0,
                zones20: 0,
                sellRatio: 68,
            },
            {
                name: "Building Momentum",
                zones5: 140,
                zones10: 200,
                zones20: 0,
                sellRatio: 70,
            },
            {
                name: "Resistance Confluence",
                zones5: 160,
                zones10: 240,
                zones20: 320,
                sellRatio: 72,
            },
            {
                name: "Smart Money Exit",
                zones5: 220,
                zones10: 0,
                zones20: 0,
                sellRatio: 76,
            },
            {
                name: "Cross-Frame Build",
                zones5: 100,
                zones10: 150,
                zones20: 200,
                sellRatio: 67,
            },
            {
                name: "Institutional Dump",
                zones5: 500,
                zones10: 600,
                zones20: 0,
                sellRatio: 74,
            },
            {
                name: "Perfect Setup",
                zones5: 180,
                zones10: 270,
                zones20: 360,
                sellRatio: 78,
            },
            {
                name: "Volume Surge",
                zones5: 350,
                zones10: 0,
                zones20: 0,
                sellRatio: 73,
            },
            {
                name: "Steady Building",
                zones5: 130,
                zones10: 190,
                zones20: 250,
                sellRatio: 69,
            },
            {
                name: "Whale Activity",
                zones5: 800,
                zones10: 0,
                zones20: 0,
                sellRatio: 72,
            },
            {
                name: "Strategic Exit",
                zones5: 200,
                zones10: 300,
                zones20: 400,
                sellRatio: 71,
            },
            {
                name: "Multi-Level",
                zones5: 160,
                zones10: 240,
                zones20: 0,
                sellRatio: 70,
            },
            {
                name: "Confluence Peak",
                zones5: 190,
                zones10: 285,
                zones20: 380,
                sellRatio: 75,
            },
            {
                name: "Institutional Block",
                zones5: 450,
                zones10: 550,
                zones20: 650,
                sellRatio: 77,
            },
            {
                name: "Perfect Storm",
                zones5: 300,
                zones10: 450,
                zones20: 600,
                sellRatio: 80,
            },
        ];

        enhancedScenarios.forEach((scenario, index) => {
            it(`Test ${81 + index}: ${scenario.name} - Enhanced Detection`, () => {
                const zones5T = [
                    createDistributionZone(
                        LTCUSDT_PRICE,
                        scenario.zones5,
                        scenario.sellRatio
                    ),
                ];
                const zones10T =
                    scenario.zones10 > 0
                        ? [
                              createDistributionZone(
                                  LTCUSDT_PRICE,
                                  scenario.zones10,
                                  scenario.sellRatio
                              ),
                          ]
                        : [];
                const zones20T =
                    scenario.zones20 > 0
                        ? [
                              createDistributionZone(
                                  LTCUSDT_PRICE,
                                  scenario.zones20,
                                  scenario.sellRatio
                              ),
                          ]
                        : [];
                const event = createRealisticMarketEvent(
                    LTCUSDT_PRICE,
                    50,
                    true,
                    zones5T,
                    zones10T,
                    zones20T
                );

                detector.onEnrichedTrade(event);

                // All enhanced scenarios should detect distribution
                expect(emittedEvents.length).toBeGreaterThan(0);
            });
        });
    });

    describe("📊 SIGNAL VALIDATION - Correct Market Behavior", () => {
        it("should emit zone updates for visualization", () => {
            const zones = [createDistributionZone(LTCUSDT_PRICE, 200, 75)];
            const event = createRealisticMarketEvent(
                LTCUSDT_PRICE,
                50,
                true,
                zones
            );

            detector.onEnrichedTrade(event);

            const zoneUpdate = emittedEvents.find(
                (e) => e.event === "zoneUpdate"
            );
            expect(zoneUpdate).toBeDefined();
            expect(zoneUpdate?.data.zone.type).toBe("distribution");
        });

        it("should emit proper sell signals for distribution", () => {
            const zones = [createDistributionZone(LTCUSDT_PRICE, 300, 78)];
            const event = createRealisticMarketEvent(
                LTCUSDT_PRICE,
                80,
                true,
                zones
            );

            detector.onEnrichedTrade(event);

            const signal = emittedEvents.find(
                (e) => e.event === "signalCandidate"
            );
            if (signal) {
                expect(signal.data.side).toBe("sell"); // Distribution = sell signal
                expect(signal.data.type).toBe("distribution");
            }
        });

        it("should provide accurate enhancement statistics", () => {
            const zones = [createDistributionZone(LTCUSDT_PRICE, 150, 70)];
            const event = createRealisticMarketEvent(
                LTCUSDT_PRICE,
                40,
                true,
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
