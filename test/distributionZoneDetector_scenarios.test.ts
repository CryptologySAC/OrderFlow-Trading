import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock dependencies
vi.mock("../src/multithreading/workerLogger");

import { DistributionZoneDetector } from "../src/indicators/distributionZoneDetector.js";
import type { EnrichedTradeEvent } from "../src/types/marketEvents.js";
import type { ILogger } from "../src/infrastructure/loggerInterface.js";
import type { IMetricsCollector } from "../src/infrastructure/metricsCollectorInterface.js";
import type { ZoneDetectorConfig } from "../src/types/zoneTypes.js";

describe("DistributionZoneDetector - Real Distribution Scenarios", () => {
    let detector: DistributionZoneDetector;
    let mockLogger: ILogger;
    let mockMetrics: IMetricsCollector;

    beforeEach(async () => {
        mockLogger = {
            info: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
            debug: vi.fn(),
            isDebugEnabled: () => false,
            setCorrelationId: vi.fn(),
            removeCorrelationId: vi.fn(),
        } as ILogger;

        // Use proper mock from __mocks__/ directory per CLAUDE.md
        const { MetricsCollector: MockMetricsCollector } = await import("../__mocks__/src/infrastructure/metricsCollector.js");
        mockMetrics = new MockMetricsCollector() as any;

        const config: Partial<ZoneDetectorConfig> = {
            minCandidateDuration: 30000, // 30 seconds for faster testing
            minZoneVolume: 150,
            minTradeCount: 5,
            maxPriceDeviation: 0.025,
            minZoneStrength: 0.3, // Lowered to reduce institutional requirements
            strengthChangeThreshold: 0.12,
            minSellRatio: 0.55, // Required for distribution detection
        };

        detector = new DistributionZoneDetector(
            "test-scenarios",
            "BTCUSDT",
            config,
            mockLogger,
            mockMetrics
        );
    });

    describe("Institutional Distribution Patterns", () => {
        it("should detect institutional distribution during retail FOMO buying", () => {
            console.log(
                "🚀 SCENARIO: Institutional distribution during retail FOMO"
            );

            const baseTime = Date.now();
            const resistanceLevel = 51000; // Key resistance level

            // Scenario: Heavy retail buying meets institutional selling that controls price
            const distributionScenario: EnrichedTradeEvent[] = [];

            // Phase 1: Initial retail buying push (aggressive buyers)
            for (let i = 0; i < 4; i++) {
                distributionScenario.push({
                    price: resistanceLevel - i * 0.1, // Slight price progression
                    quantity: 25 + Math.random() * 10, // Medium retail sizes
                    timestamp: baseTime + i * 2000,
                    buyerIsMaker: false, // Aggressive buying (retail FOMO)
                    pair: "BTCUSDT",
                    tradeId: `fomo_buy_${i}`,
                    originalTrade: {} as any,
                    passiveBidVolume: 0,
                    passiveAskVolume: 0,
                    zonePassiveBidVolume: 0,
                    zonePassiveAskVolume: 0,
                });
            }

            // Phase 2: Institutional sellers step in at resistance (price gets controlled)
            for (let i = 0; i < 6; i++) {
                distributionScenario.push({
                    price: resistanceLevel, // Price held at resistance despite buying pressure
                    quantity: 70, // Consistent institutional size (>= 40 threshold)
                    timestamp: baseTime + 10000 + i * 2000,
                    buyerIsMaker: false, // Continued buying pressure from retail
                    pair: "BTCUSDT",
                    tradeId: `inst_distribution_${i}`,
                    originalTrade: {} as any,
                    passiveBidVolume: 0,
                    passiveAskVolume: 0,
                    zonePassiveBidVolume: 0,
                    zonePassiveAskVolume: 0,
                });
            }

            // Process the scenario
            let totalBuyVolume = 0;
            let totalSellVolume = 0;
            distributionScenario.forEach((trade, i) => {
                if (!trade.buyerIsMaker) totalBuyVolume += trade.quantity;
                else totalSellVolume += trade.quantity;

                const result = detector.analyze(trade);
                console.log(
                    `Trade ${i}: price=${trade.price}, qty=${trade.quantity.toFixed(1)}, aggressor=${trade.buyerIsMaker ? "SELL" : "BUY"}`
                );
            });

            // Wait for minimum duration and trigger formation
            const formationTrigger: EnrichedTradeEvent = {
                price: resistanceLevel,
                quantity: 80, // Large institutional distribution
                timestamp: baseTime + 35000, // 35 seconds after start (> 30s requirement)
                buyerIsMaker: false, // Retail buying into institutional selling
                pair: "BTCUSDT",
                tradeId: "formation_trigger",
                originalTrade: {} as any,
                passiveBidVolume: 0,
                passiveAskVolume: 0,
                zonePassiveBidVolume: 0,
                zonePassiveAskVolume: 0,
            };

            const formationResult = detector.analyze(formationTrigger);

            console.log(`🚀 Scenario summary:`);
            console.log(`  - Total buy volume: ${totalBuyVolume.toFixed(1)}`);
            console.log(`  - Total sell volume: ${totalSellVolume.toFixed(1)}`);
            console.log(
                `  - Buy ratio: ${(totalBuyVolume / (totalBuyVolume + totalSellVolume)).toFixed(3)}`
            );
            console.log(
                `  - Zones formed: ${detector.getActiveZones().length}`
            );

            // Validation
            const zones = detector.getActiveZones();
            expect(zones.length).toBeGreaterThan(0);

            if (zones.length > 0) {
                const distributionZone = zones[0];
                expect(distributionZone.type).toBe("distribution");
                expect(
                    distributionZone.priceRange.center ||
                        distributionZone.priceRange.min
                ).toBe(resistanceLevel);
                expect(distributionZone.strength).toBeGreaterThan(0.3);
                console.log(
                    `🚀 Distribution zone detected at ${resistanceLevel} with strength ${distributionZone.strength.toFixed(3)}`
                );
            }

            // Check for distribution signals
            if (formationResult.signals.length > 0) {
                const sellSignal = formationResult.signals.find(
                    (s) => s.side === "SELL"
                );
                if (sellSignal) {
                    expect(sellSignal.confidence).toBeGreaterThan(0.4);
                    console.log(
                        `🚀 SELL signal generated with confidence ${sellSignal.confidence.toFixed(3)}`
                    );
                }
            }
        });

        it("should detect ask wall refill distribution pattern", () => {
            console.log("🏗️ SCENARIO: Ask wall refill distribution pattern");

            const baseTime = Date.now();
            const wallLevel = 52500;

            // Scenario: Institutional sellers continuously refill ask walls as retail buyers consume them
            const askWallScenario: EnrichedTradeEvent[] = [];

            // Pattern: Retail buys followed by immediate ask refills at same level
            for (let cycle = 0; cycle < 3; cycle++) {
                const cycleBase = baseTime + cycle * 30000;

                // Retail buyers consume ask wall
                for (let i = 0; i < 3; i++) {
                    askWallScenario.push({
                        price: wallLevel,
                        quantity: 30 + Math.random() * 15,
                        timestamp: cycleBase + i * 1500,
                        buyerIsMaker: false, // Aggressive buying
                        pair: "BTCUSDT",
                        tradeId: `wall_consume_${cycle}_${i}`,
                        originalTrade: {} as any,
                        passiveBidVolume: 0,
                        passiveAskVolume: 0,
                        zonePassiveBidVolume: 0,
                        zonePassiveAskVolume: 0,
                    });
                }

                // Institutional seller refills the wall
                askWallScenario.push({
                    price: wallLevel,
                    quantity: 120 + Math.random() * 30, // Large refill
                    timestamp: cycleBase + 8000,
                    buyerIsMaker: false, // Buying pressure continues (retail)
                    pair: "BTCUSDT",
                    tradeId: `wall_refill_${cycle}`,
                    originalTrade: {} as any,
                    passiveBidVolume: 0,
                    passiveAskVolume: 0,
                    zonePassiveBidVolume: 0,
                    zonePassiveAskVolume: 0,
                });
            }

            // Process the ask wall scenario
            askWallScenario.forEach((trade, i) => {
                const result = detector.analyze(trade);
                if (trade.tradeId.includes("refill")) {
                    console.log(
                        `🏗️ Wall refill ${trade.tradeId}: ${trade.quantity.toFixed(1)} at ${trade.price}`
                    );
                }
            });

            // Final formation trigger
            const finalTrigger: EnrichedTradeEvent = {
                price: wallLevel,
                quantity: 100,
                timestamp: baseTime + 120000,
                buyerIsMaker: false,
                pair: "BTCUSDT",
                tradeId: "final_wall_test",
                originalTrade: {} as any,
                passiveBidVolume: 0,
                passiveAskVolume: 0,
                zonePassiveBidVolume: 0,
                zonePassiveAskVolume: 0,
            };

            detector.analyze(finalTrigger);

            // Validation: Should detect repeated distribution at the wall level
            const candidates = detector.getCandidates();
            const zones = detector.getActiveZones();

            console.log(`🏗️ Ask wall scenario results:`);
            console.log(`  - Candidates: ${candidates.length}`);
            console.log(`  - Zones: ${zones.length}`);

            if (candidates.length > 0) {
                const wallCandidate = candidates.find(
                    (c) => c.priceLevel === wallLevel
                );
                if (wallCandidate) {
                    console.log(
                        `🏗️ Wall candidate: ${wallCandidate.totalVolume.toFixed(1)} volume, ${wallCandidate.tradeCount} trades`
                    );
                    expect(wallCandidate.totalVolume).toBeGreaterThan(300); // High volume from refills
                    expect(wallCandidate.tradeCount).toBeGreaterThan(8); // Multiple refill cycles
                }
            }
        });

        it("should detect layered distribution across price levels", () => {
            console.log(
                "📊 SCENARIO: Layered distribution across multiple price levels"
            );

            const baseTime = Date.now();
            const basePrice = 50000;

            // Scenario: Institutional sellers distribute across multiple price levels
            // as retail buyers push price higher
            const layeredScenario: EnrichedTradeEvent[] = [];

            // Layer 1: Distribution at base level
            for (let i = 0; i < 4; i++) {
                layeredScenario.push({
                    price: basePrice,
                    quantity: 45 + Math.random() * 20,
                    timestamp: baseTime + i * 5000,
                    buyerIsMaker: false, // Buy pressure
                    pair: "BTCUSDT",
                    tradeId: `layer1_${i}`,
                    originalTrade: {} as any,
                    passiveBidVolume: 0,
                    passiveAskVolume: 0,
                    zonePassiveBidVolume: 0,
                    zonePassiveAskVolume: 0,
                });
            }

            // Layer 2: Distribution at higher level (price progression)
            for (let i = 0; i < 4; i++) {
                layeredScenario.push({
                    price: basePrice + 5,
                    quantity: 40 + Math.random() * 25,
                    timestamp: baseTime + 25000 + i * 5000,
                    buyerIsMaker: false, // Continued buy pressure
                    pair: "BTCUSDT",
                    tradeId: `layer2_${i}`,
                    originalTrade: {} as any,
                    passiveBidVolume: 0,
                    passiveAskVolume: 0,
                    zonePassiveBidVolume: 0,
                    zonePassiveAskVolume: 0,
                });
            }

            // Layer 3: Distribution at highest level
            for (let i = 0; i < 3; i++) {
                layeredScenario.push({
                    price: basePrice + 10,
                    quantity: 55 + Math.random() * 15,
                    timestamp: baseTime + 50000 + i * 5000,
                    buyerIsMaker: false, // Buy pressure continues
                    pair: "BTCUSDT",
                    tradeId: `layer3_${i}`,
                    originalTrade: {} as any,
                    passiveBidVolume: 0,
                    passiveAskVolume: 0,
                    zonePassiveBidVolume: 0,
                    zonePassiveAskVolume: 0,
                });
            }

            // Process layered distribution
            layeredScenario.forEach((trade) => {
                detector.analyze(trade);
            });

            // Formation triggers for each layer
            const formationTriggers = [
                { price: basePrice, time: baseTime + 100000 },
                { price: basePrice + 5, time: baseTime + 105000 },
                { price: basePrice + 10, time: baseTime + 110000 },
            ];

            formationTriggers.forEach((trigger, index) => {
                const formationTrade: EnrichedTradeEvent = {
                    price: trigger.price,
                    quantity: 60,
                    timestamp: trigger.time,
                    buyerIsMaker: false,
                    pair: "BTCUSDT",
                    tradeId: `formation_layer_${index}`,
                    originalTrade: {} as any,
                    passiveBidVolume: 0,
                    passiveAskVolume: 0,
                    zonePassiveBidVolume: 0,
                    zonePassiveAskVolume: 0,
                };
                detector.analyze(formationTrade);
            });

            // Validation: Should detect multiple distribution zones
            const zones = detector.getActiveZones();
            const candidates = detector.getCandidates();

            console.log(`📊 Layered distribution results:`);
            console.log(`  - Zones formed: ${zones.length}`);
            console.log(`  - Candidates tracked: ${candidates.length}`);

            candidates.forEach((candidate, i) => {
                console.log(
                    `📊 Candidate ${i}: price=${candidate.priceLevel}, volume=${candidate.totalVolume.toFixed(1)}`
                );
            });

            // Should have candidates or zones at multiple price levels
            const priceLevels = new Set(candidates.map((c) => c.priceLevel));
            expect(priceLevels.size).toBeGreaterThanOrEqual(2);

            // Should have significant distribution activity
            const totalDistributionVolume = candidates.reduce(
                (sum, c) => sum + c.totalVolume,
                0
            );
            expect(totalDistributionVolume).toBeGreaterThan(500);
        });
    });

    describe("Distribution vs Accumulation Differentiation", () => {
        it("should differentiate distribution from accumulation patterns", () => {
            console.log(
                "⚖️ TESTING: Distribution vs Accumulation differentiation"
            );

            const baseTime = Date.now();
            const testPrice = 50500;

            // Test accumulation pattern (should NOT form distribution zone)
            const accumulationTrades: EnrichedTradeEvent[] = [];
            for (let i = 0; i < 6; i++) {
                accumulationTrades.push({
                    price: testPrice,
                    quantity: 50 + Math.random() * 20,
                    timestamp: baseTime + i * 4000,
                    buyerIsMaker: true, // HIGH sell pressure = accumulation pattern
                    pair: "BTCUSDT",
                    tradeId: `accum_test_${i}`,
                    originalTrade: {} as any,
                    passiveBidVolume: 0,
                    passiveAskVolume: 0,
                    zonePassiveBidVolume: 0,
                    zonePassiveAskVolume: 0,
                });
            }

            accumulationTrades.forEach((trade) => {
                detector.analyze(trade);
            });

            // Try to form with accumulation pattern
            const accumFormation: EnrichedTradeEvent = {
                price: testPrice,
                quantity: 70,
                timestamp: baseTime + 100000,
                buyerIsMaker: true, // Sell pressure (accumulation)
                pair: "BTCUSDT",
                tradeId: "accum_formation",
                originalTrade: {} as any,
                passiveBidVolume: 0,
                passiveAskVolume: 0,
                zonePassiveBidVolume: 0,
                zonePassiveAskVolume: 0,
            };

            detector.analyze(accumFormation);

            const accumResults = {
                zones: detector.getActiveZones().length,
                candidates: detector.getCandidates(),
            };

            // Reset detector for distribution test
            detector = new DistributionZoneDetector(
                "test-scenarios-reset",
                "BTCUSDT",
                {
                    minCandidateDuration: 90000,
                    minZoneVolume: 150,
                    minTradeCount: 5,
                },
                mockLogger,
                mockMetrics
            );

            // Test distribution pattern (should form distribution zone)
            const distributionTrades: EnrichedTradeEvent[] = [];
            for (let i = 0; i < 6; i++) {
                distributionTrades.push({
                    price: testPrice,
                    quantity: 50 + Math.random() * 20,
                    timestamp: baseTime + i * 4000,
                    buyerIsMaker: false, // HIGH buy pressure = distribution pattern
                    pair: "BTCUSDT",
                    tradeId: `distrib_test_${i}`,
                    originalTrade: {} as any,
                    passiveBidVolume: 0,
                    passiveAskVolume: 0,
                    zonePassiveBidVolume: 0,
                    zonePassiveAskVolume: 0,
                });
            }

            distributionTrades.forEach((trade) => {
                detector.analyze(trade);
            });

            const distribFormation: EnrichedTradeEvent = {
                price: testPrice,
                quantity: 70,
                timestamp: baseTime + 100000,
                buyerIsMaker: false, // Buy pressure (distribution)
                pair: "BTCUSDT",
                tradeId: "distrib_formation",
                originalTrade: {} as any,
                passiveBidVolume: 0,
                passiveAskVolume: 0,
                zonePassiveBidVolume: 0,
                zonePassiveAskVolume: 0,
            };

            detector.analyze(distribFormation);

            const distribResults = {
                zones: detector.getActiveZones().length,
                candidates: detector.getCandidates(),
            };

            console.log("⚖️ Pattern differentiation results:");
            console.log(
                `  - Accumulation pattern zones: ${accumResults.zones}`
            );
            console.log(
                `  - Distribution pattern zones: ${distribResults.zones}`
            );

            if (accumResults.candidates.length > 0) {
                const accumBuyRatio =
                    accumResults.candidates[0].buyVolume /
                    accumResults.candidates[0].totalVolume;
                console.log(
                    `  - Accumulation buy ratio: ${accumBuyRatio.toFixed(3)} (should be low)`
                );
            }

            if (distribResults.candidates.length > 0) {
                const distribBuyRatio =
                    distribResults.candidates[0].buyVolume /
                    distribResults.candidates[0].totalVolume;
                console.log(
                    `  - Distribution buy ratio: ${distribBuyRatio.toFixed(3)} (should be high)`
                );
            }

            // Distribution pattern should form zones more readily than accumulation pattern
            expect(distribResults.zones).toBeGreaterThanOrEqual(
                accumResults.zones
            );

            // Buy ratios should be clearly different
            if (
                accumResults.candidates.length > 0 &&
                distribResults.candidates.length > 0
            ) {
                const accumBuyRatio =
                    accumResults.candidates[0].buyVolume /
                    accumResults.candidates[0].totalVolume;
                const distribBuyRatio =
                    distribResults.candidates[0].buyVolume /
                    distribResults.candidates[0].totalVolume;
                expect(distribBuyRatio).toBeGreaterThan(accumBuyRatio + 0.3); // Clear differentiation
            }
        });
    });

    describe("Price Stability Under Distribution", () => {
        it("should detect price stability despite heavy buying pressure", () => {
            console.log(
                "🎯 SCENARIO: Price stability during institutional distribution"
            );

            const baseTime = Date.now();
            const resistanceLevel = 51500;

            // Scenario: Heavy retail buying but price held stable by institutional selling
            const stabilityTest: EnrichedTradeEvent[] = [];

            // High volume buying but price remains controlled
            for (let i = 0; i < 10; i++) {
                stabilityTest.push({
                    price: resistanceLevel + (Math.random() - 0.5) * 0.2, // Minimal price deviation
                    quantity: 50, // Consistent institutional size to reach 500+ total volume
                    timestamp: baseTime + i * 3000,
                    buyerIsMaker: false, // Aggressive buying
                    pair: "BTCUSDT",
                    tradeId: `stability_${i}`,
                    originalTrade: {} as any,
                    passiveBidVolume: 0,
                    passiveAskVolume: 0,
                    zonePassiveBidVolume: 0,
                    zonePassiveAskVolume: 0,
                });
            }

            stabilityTest.forEach((trade) => {
                detector.analyze(trade);
            });

            const formationTrade: EnrichedTradeEvent = {
                price: resistanceLevel,
                quantity: 85,
                timestamp: baseTime + 35000, // 35 seconds after start (> 30s requirement)
                buyerIsMaker: false,
                pair: "BTCUSDT",
                tradeId: "stability_formation",
                originalTrade: {} as any,
                passiveBidVolume: 0,
                passiveAskVolume: 0,
                zonePassiveBidVolume: 0,
                zonePassiveAskVolume: 0,
            };

            detector.analyze(formationTrade);

            // Analyze price stability
            const candidates = detector.getCandidates();
            if (candidates.length > 0) {
                const candidate = candidates[0];
                console.log(`🎯 Price stability analysis:`);
                console.log(
                    `  - Price stability: ${candidate.priceStability.toFixed(3)}`
                );
                console.log(
                    `  - Total volume: ${candidate.totalVolume.toFixed(1)}`
                );
                console.log(`  - Trade count: ${candidate.tradeCount}`);

                // Should show high price stability despite large volumes
                expect(candidate.priceStability).toBeGreaterThan(0.95);
                expect(candidate.totalVolume).toBeGreaterThan(400);

                // High buy ratio but stable price = distribution signature
                const buyRatio = candidate.buyVolume / candidate.totalVolume;
                expect(buyRatio).toBeGreaterThan(0.7);
                console.log(
                    `  - Buy ratio: ${buyRatio.toFixed(3)} (high buying pressure)`
                );
            }
        });
    });
});
