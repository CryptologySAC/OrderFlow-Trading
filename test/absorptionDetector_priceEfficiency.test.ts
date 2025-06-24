import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock dependencies
vi.mock("../src/multithreading/workerLogger");
vi.mock("../src/infrastructure/metricsCollector");

import { AbsorptionDetector } from "../src/indicators/absorptionDetector.js";
import { MetricsCollector } from "../src/infrastructure/metricsCollector.js";
import { SpoofingDetector } from "../src/services/spoofingDetector.js";
import { OrderBookState } from "../src/market/orderBookState.js";
import type { ILogger } from "../src/infrastructure/loggerInterface.js";
import type { EnrichedTradeEvent } from "../src/types/marketEvents.js";
import type { AbsorptionSettings } from "../src/indicators/absorptionDetector.js";

/**
 * 🔬 PRICE EFFICIENCY ANALYSIS VALIDATION TEST SUITE
 * 
 * This test suite validates the CORE mathematical model of the AbsorptionDetector:
 * 
 * Formula: priceEfficiency = actualPriceMovement / expectedPriceMovement
 * Where: expectedPriceMovement = (volume/passiveLiquidity) × tickSize × scalingFactor
 * 
 * BUSINESS LOGIC: Low price efficiency indicates institutional absorption
 * (large volume with minimal price impact = hidden large orders)
 */
describe("AbsorptionDetector - Price Efficiency Analysis Core", () => {
    let detector: AbsorptionDetector;
    let mockLogger: ILogger;
    let mockMetrics: MetricsCollector;
    let mockSpoofing: SpoofingDetector;
    let mockOrderBook: OrderBookState;
    
    const TICK_SIZE = 0.01;
    const SCALING_FACTOR = 10; // Default scaling factor
    const BASE_PRICE = 50000;
    
    beforeEach(() => {
        mockLogger = {
            info: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
            debug: vi.fn(),
            isDebugEnabled: () => false,
            setCorrelationId: vi.fn(),
            removeCorrelationId: vi.fn(),
        } as ILogger;

        mockMetrics = new MetricsCollector();
        
        mockSpoofing = {
            wasSpoofed: vi.fn().mockReturnValue(false),
        } as any;

        mockOrderBook = {
            getLevel: vi.fn().mockReturnValue({
                bid: 100,
                ask: 100,
                addedBid: 0,
                consumedBid: 0,
                addedAsk: 0,
                consumedAsk: 0,
                bidCount: 1,
                askCount: 1,
            }),
            getCurrentSpread: vi.fn().mockReturnValue(0.01),
            getBestBid: vi.fn().mockReturnValue(BASE_PRICE - 0.005),
            getBestAsk: vi.fn().mockReturnValue(BASE_PRICE + 0.005),
        } as any;

        const config: AbsorptionSettings = {
            minAggVolume: 40,
            windowMs: 60000,
            pricePrecision: 2,
            zoneTicks: 3,
            eventCooldownMs: 15000,
            priceEfficiencyThreshold: 0.85,
            absorptionThreshold: 0.6,
            minPassiveMultiplier: 1.2,
            maxAbsorptionRatio: 0.4,
        };

        detector = new AbsorptionDetector(
            "test-price-efficiency",
            config,
            mockOrderBook,
            mockLogger,
            mockSpoofing,
            mockMetrics
        );
    });

    describe("Mathematical Price Efficiency Formula Validation", () => {
        it("should calculate price efficiency correctly using the documented formula", () => {
            console.log("🔬 TESTING: Price efficiency mathematical formula validation");
            
            // Test the exact formula from docs/Absorption-Detector.md
            // priceEfficiency = actualPriceMovement / expectedPriceMovement
            // expectedPriceMovement = (volume/passiveLiquidity) × tickSize × scalingFactor
            
            const testScenarios = [
                {
                    name: "High Efficiency (Normal Market)",
                    trades: [
                        { price: 50000, quantity: 25, passive: 100 },
                        { price: 50020, quantity: 25, passive: 100 },
                        { price: 50040, quantity: 25, passive: 100 },
                        { price: 50060, quantity: 25, passive: 100 },
                    ],
                    expectedEfficiency: "> 0.85", // Should be above threshold
                    shouldDetectAbsorption: false,
                },
                {
                    name: "Low Efficiency (Institutional Absorption)",
                    trades: [
                        { price: 50000, quantity: 100, passive: 200 },
                        { price: 50002, quantity: 100, passive: 200 },
                        { price: 50003, quantity: 100, passive: 200 },
                        { price: 50004, quantity: 100, passive: 200 },
                    ],
                    expectedEfficiency: "< 0.85", // Should be below threshold
                    shouldDetectAbsorption: true,
                },
                {
                    name: "Borderline Efficiency",
                    trades: [
                        { price: 50000, quantity: 50, passive: 150 },
                        { price: 50015, quantity: 50, passive: 150 },
                        { price: 50030, quantity: 50, passive: 150 },
                        { price: 50045, quantity: 50, passive: 150 },
                    ],
                    expectedEfficiency: "≈ 0.85", // Should be near threshold
                    shouldDetectAbsorption: false,
                },
            ];

            testScenarios.forEach(scenario => {
                console.log(`\n🔬 Testing scenario: ${scenario.name}`);
                
                let signalGenerated = false;
                const testDetector = new AbsorptionDetector(
                    `test-${scenario.name.replace(/\s+/g, '-').toLowerCase()}`,
                    {
                        minAggVolume: 40,
                        windowMs: 60000,
                        pricePrecision: 2,
                        zoneTicks: 3,
                        eventCooldownMs: 15000,
                        priceEfficiencyThreshold: 0.85,
                        absorptionThreshold: 0.6,
                        minPassiveMultiplier: 1.2,
                        maxAbsorptionRatio: 0.4,
                    },
                    mockOrderBook,
                    mockLogger,
                    mockSpoofing,
                    mockMetrics
                );

                testDetector.on("signalCandidate", () => {
                    signalGenerated = true;
                });

                // Create trades for scenario
                const trades: EnrichedTradeEvent[] = scenario.trades.map((trade, i) => ({
                    price: trade.price,
                    quantity: trade.quantity,
                    timestamp: Date.now() + i * 1000,
                    buyerIsMaker: false,
                    pair: "BTCUSDT",
                    tradeId: `${scenario.name}_${i}`,
                    originalTrade: {} as any,
                    passiveBidVolume: trade.passive,
                    passiveAskVolume: trade.passive,
                    zonePassiveBidVolume: 0,
                    zonePassiveAskVolume: 0,
                }));

                // Process trades
                trades.forEach(trade => {
                    testDetector.onEnrichedTrade(trade);
                });

                // Calculate expected efficiency using the documented formula
                const totalVolume = trades.reduce((sum, t) => sum + t.quantity, 0);
                const avgPassive = trades.reduce((sum, t) => sum + t.passiveBidVolume, 0) / trades.length;
                const actualPriceMovement = Math.max(...trades.map(t => t.price)) - 
                                           Math.min(...trades.map(t => t.price));
                
                const volumePressure = totalVolume / avgPassive;
                const expectedPriceMovement = volumePressure * TICK_SIZE * SCALING_FACTOR;
                const calculatedEfficiency = actualPriceMovement / expectedPriceMovement;

                console.log(`🔬 Formula breakdown:`);
                console.log(`   Total Volume: ${totalVolume}`);
                console.log(`   Avg Passive: ${avgPassive}`);
                console.log(`   Volume Pressure: ${volumePressure.toFixed(3)}`);
                console.log(`   Actual Price Movement: ${actualPriceMovement.toFixed(4)}`);
                console.log(`   Expected Price Movement: ${expectedPriceMovement.toFixed(4)}`);
                console.log(`   Calculated Efficiency: ${calculatedEfficiency.toFixed(3)}`);
                console.log(`   Signal Generated: ${signalGenerated}`);

                // Validate mathematical correctness
                expect(calculatedEfficiency).toBeGreaterThan(0); // Sanity check
                
                // Validate business logic
                if (scenario.shouldDetectAbsorption) {
                    expect(calculatedEfficiency).toBeLessThan(0.85);
                    expect(signalGenerated).toBe(true);
                } else {
                    expect(signalGenerated).toBe(scenario.shouldDetectAbsorption);
                }
            });
        });

        it("should handle edge cases in price efficiency calculation", () => {
            console.log("🔬 TESTING: Price efficiency edge cases");
            
            const edgeCases = [
                {
                    name: "Zero Price Movement",
                    trades: [
                        { price: 50000, quantity: 100, passive: 200 },
                        { price: 50000, quantity: 100, passive: 200 },
                        { price: 50000, quantity: 100, passive: 200 },
                    ],
                    expectedBehavior: "Should detect maximum absorption (efficiency = 0)",
                },
                {
                    name: "Very Large Volume Pressure",
                    trades: [
                        { price: 50000, quantity: 500, passive: 50 },
                        { price: 50001, quantity: 500, passive: 50 },
                        { price: 50002, quantity: 500, passive: 50 },
                    ],
                    expectedBehavior: "Should detect strong absorption (very low efficiency)",
                },
                {
                    name: "High Passive Liquidity",
                    trades: [
                        { price: 50000, quantity: 50, passive: 1000 },
                        { price: 50010, quantity: 50, passive: 1000 },
                        { price: 50020, quantity: 50, passive: 1000 },
                    ],
                    expectedBehavior: "Should show high efficiency (low volume pressure)",
                },
            ];

            edgeCases.forEach(edgeCase => {
                console.log(`\n🔬 Testing edge case: ${edgeCase.name}`);
                
                let edgeSignalGenerated = false;
                const edgeDetector = new AbsorptionDetector(
                    `test-edge-${edgeCase.name.replace(/\s+/g, '-').toLowerCase()}`,
                    {
                        minAggVolume: 40,
                        windowMs: 60000,
                        pricePrecision: 2,
                        zoneTicks: 3,
                        eventCooldownMs: 15000,
                        priceEfficiencyThreshold: 0.85,
                        absorptionThreshold: 0.6,
                        minPassiveMultiplier: 1.2,
                        maxAbsorptionRatio: 0.4,
                    },
                    mockOrderBook,
                    mockLogger,
                    mockSpoofing,
                    mockMetrics
                );

                edgeDetector.on("signalCandidate", () => {
                    edgeSignalGenerated = true;
                });

                const edgeTrades: EnrichedTradeEvent[] = edgeCase.trades.map((trade, i) => ({
                    price: trade.price,
                    quantity: trade.quantity,
                    timestamp: Date.now() + i * 1000,
                    buyerIsMaker: false,
                    pair: "BTCUSDT",
                    tradeId: `edge_${edgeCase.name}_${i}`,
                    originalTrade: {} as any,
                    passiveBidVolume: trade.passive,
                    passiveAskVolume: trade.passive,
                    zonePassiveBidVolume: 0,
                    zonePassiveAskVolume: 0,
                }));

                edgeTrades.forEach(trade => {
                    edgeDetector.onEnrichedTrade(trade);
                });

                // Calculate edge case efficiency
                const totalVolume = edgeTrades.reduce((sum, t) => sum + t.quantity, 0);
                const avgPassive = edgeTrades.reduce((sum, t) => sum + t.passiveBidVolume, 0) / edgeTrades.length;
                const actualMovement = Math.max(...edgeTrades.map(t => t.price)) - 
                                     Math.min(...edgeTrades.map(t => t.price));
                
                const volumePressure = totalVolume / avgPassive;
                const expectedMovement = volumePressure * TICK_SIZE * SCALING_FACTOR;
                const efficiency = actualMovement / expectedMovement;

                console.log(`🔬 Edge case results:`);
                console.log(`   ${edgeCase.expectedBehavior}`);
                console.log(`   Volume Pressure: ${volumePressure.toFixed(3)}`);
                console.log(`   Price Efficiency: ${efficiency.toFixed(3)}`);
                console.log(`   Signal Generated: ${edgeSignalGenerated}`);

                // Edge case validations
                switch (edgeCase.name) {
                    case "Zero Price Movement":
                        expect(efficiency).toBe(0); // Zero movement = zero efficiency
                        expect(edgeSignalGenerated).toBe(true); // Should detect absorption
                        break;
                    case "Very Large Volume Pressure":
                        expect(volumePressure).toBeGreaterThan(10); // High pressure
                        expect(efficiency).toBeLessThan(0.1); // Very low efficiency
                        expect(edgeSignalGenerated).toBe(true); // Should detect absorption
                        break;
                    case "High Passive Liquidity":
                        expect(volumePressure).toBeLessThan(1); // Low pressure
                        expect(efficiency).toBeGreaterThan(1); // High efficiency
                        expect(edgeSignalGenerated).toBe(false); // Should NOT detect absorption
                        break;
                }
            });
        });
    });

    describe("Threshold Configuration Impact", () => {
        it("should respect priceEfficiencyThreshold for absorption detection", () => {
            console.log("🔬 TESTING: Price efficiency threshold configuration impact");
            
            const thresholdTests = [
                { threshold: 0.5, name: "Lenient", shouldDetect: true },
                { threshold: 0.85, name: "Default", shouldDetect: false },
                { threshold: 1.2, name: "Strict", shouldDetect: false },
            ];

            // Create a consistent test scenario with moderate efficiency (~0.75)
            const moderateEfficiencyTrades = [
                { price: 50000, quantity: 75, passive: 150 },
                { price: 50010, quantity: 75, passive: 150 },
                { price: 50020, quantity: 75, passive: 150 },
                { price: 50025, quantity: 75, passive: 150 },
            ];

            thresholdTests.forEach(test => {
                console.log(`\n🔬 Testing ${test.name} threshold: ${test.threshold}`);
                
                let thresholdSignalGenerated = false;
                const thresholdDetector = new AbsorptionDetector(
                    `test-threshold-${test.name.toLowerCase()}`,
                    {
                        minAggVolume: 40,
                        windowMs: 60000,
                        pricePrecision: 2,
                        zoneTicks: 3,
                        eventCooldownMs: 15000,
                        priceEfficiencyThreshold: test.threshold,
                        absorptionThreshold: 0.6,
                        minPassiveMultiplier: 1.2,
                        maxAbsorptionRatio: 0.4,
                    },
                    mockOrderBook,
                    mockLogger,
                    mockSpoofing,
                    mockMetrics
                );

                thresholdDetector.on("signalCandidate", () => {
                    thresholdSignalGenerated = true;
                });

                const thresholdTrades: EnrichedTradeEvent[] = moderateEfficiencyTrades.map((trade, i) => ({
                    price: trade.price,
                    quantity: trade.quantity,
                    timestamp: Date.now() + i * 1000,
                    buyerIsMaker: false,
                    pair: "BTCUSDT",
                    tradeId: `threshold_${test.name}_${i}`,
                    originalTrade: {} as any,
                    passiveBidVolume: trade.passive,
                    passiveAskVolume: trade.passive,
                    zonePassiveBidVolume: 0,
                    zonePassiveAskVolume: 0,
                }));

                thresholdTrades.forEach(trade => {
                    thresholdDetector.onEnrichedTrade(trade);
                });

                // Calculate actual efficiency for this scenario
                const totalVolume = thresholdTrades.reduce((sum, t) => sum + t.quantity, 0);
                const avgPassive = thresholdTrades.reduce((sum, t) => sum + t.passiveBidVolume, 0) / thresholdTrades.length;
                const actualMovement = Math.max(...thresholdTrades.map(t => t.price)) - 
                                     Math.min(...thresholdTrades.map(t => t.price));
                
                const volumePressure = totalVolume / avgPassive;
                const expectedMovement = volumePressure * TICK_SIZE * SCALING_FACTOR;
                const efficiency = actualMovement / expectedMovement;

                console.log(`🔬 Threshold test results:`);
                console.log(`   Calculated Efficiency: ${efficiency.toFixed(3)}`);
                console.log(`   Threshold: ${test.threshold}`);
                console.log(`   Expected Detection: ${test.shouldDetect}`);
                console.log(`   Actual Detection: ${thresholdSignalGenerated}`);

                // Validate threshold behavior
                expect(thresholdSignalGenerated).toBe(test.shouldDetect);
                
                // Efficiency should be consistent across all tests (~0.75)
                expect(efficiency).toBeGreaterThan(0.7);
                expect(efficiency).toBeLessThan(0.8);
            });
        });
    });
});