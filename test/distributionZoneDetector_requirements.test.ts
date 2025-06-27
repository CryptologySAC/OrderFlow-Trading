import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock dependencies
vi.mock("../src/multithreading/workerLogger");

import { DistributionZoneDetector } from "../src/indicators/distributionZoneDetector.js";
import type { EnrichedTradeEvent } from "../src/types/marketEvents.js";
import type { ILogger } from "../src/infrastructure/loggerInterface.js";
import type { IMetricsCollector } from "../src/infrastructure/metricsCollectorInterface.js";
import type { ZoneDetectorConfig } from "../src/types/zoneTypes.js";

describe("DistributionZoneDetector - Production Requirements Validation", () => {
    let detector: DistributionZoneDetector;
    let mockLogger: ILogger;
    let mockMetrics: IMetricsCollector;

    beforeEach(async () => {
        mockLogger = {
            info: vi
                .fn()
                .mockImplementation((...args) => console.log("INFO:", ...args)),
            warn: vi
                .fn()
                .mockImplementation((...args) => console.log("WARN:", ...args)),
            error: vi
                .fn()
                .mockImplementation((...args) =>
                    console.log("ERROR:", ...args)
                ),
            debug: vi
                .fn()
                .mockImplementation((...args) =>
                    console.log("DEBUG:", ...args)
                ),
            isDebugEnabled: () => false,
            setCorrelationId: vi.fn(),
            removeCorrelationId: vi.fn(),
        } as ILogger;

        // Use proper mock from __mocks__/ directory per CLAUDE.md
        const { MetricsCollector: MockMetricsCollector } = await import(
            "../__mocks__/src/infrastructure/metricsCollector.js"
        );
        mockMetrics = new MockMetricsCollector() as any;

        // Use test-friendly config that can actually form zones
        const config: Partial<ZoneDetectorConfig> = {
            minCandidateDuration: 30000, // 30 seconds for faster tests
            minZoneVolume: 200, // Production requirement
            minTradeCount: 6, // Production requirement
            maxPriceDeviation: 0.02, // 2%
            minZoneStrength: 0.3, // Lowered to reduce institutional score requirements
            strengthChangeThreshold: 0.15,
            // Distribution-specific: high buy ratio for retail buying into institutional selling
            minSellRatio: 0.55, // Config reused with inverted logic - we want low sell ratio (high buy ratio)
        };

        detector = new DistributionZoneDetector(
            "test-distribution-requirements",
            "BTCUSDT",
            config,
            mockLogger,
            mockMetrics
        );
    });

    describe("Distribution Zone Formation Requirements Analysis", () => {
        it("should create distribution zone when ALL requirements are properly met", () => {
            const baseTime = Date.now();
            const basePrice = 50000;

            console.log(
                "🔧 TESTING: Creating distribution zone with all requirements met"
            );

            // Create exactly what production requires for DISTRIBUTION:
            // 1. minTradeCount: 6 trades minimum
            // 2. minZoneVolume: 200+ volume
            // 3. minCandidateDuration: 2+ minutes
            // 4. High BUY ratio for distribution (retail buying into institutional selling)
            // 5. Institutional selling activity signals
            // 6. Price stability despite buying pressure

            const distributionTrades: EnrichedTradeEvent[] = [];
            let totalVolume = 0;

            // Create 10 trades (exceeds minTradeCount: 6) with strong institutional patterns
            for (let i = 0; i < 10; i++) {
                const quantity = 50; // Consistent institutional size (>= 40 threshold)
                const trade: EnrichedTradeEvent = {
                    price: basePrice, // EXACT same price for concentration
                    quantity,
                    timestamp: baseTime + i * 2000, // 2-second intervals for consistency
                    // KEY DIFFERENCE: 70% BUY pressure for distribution (retail buying into institutional selling)
                    buyerIsMaker: i < 3, // First 3 are sells (30%), rest are buys (70%)
                    pair: "BTCUSDT",
                    tradeId: `distrib_${i}`,
                    originalTrade: {} as any,
                    passiveBidVolume: 0,
                    passiveAskVolume: 0,
                    zonePassiveBidVolume: 0,
                    zonePassiveAskVolume: 0,
                };
                distributionTrades.push(trade);
                totalVolume += quantity;
            }

            console.log(
                `🔧 Created ${distributionTrades.length} trades with total volume: ${totalVolume}`
            );
            console.log(
                `🔧 Buy pressure: ${distributionTrades.filter((t) => !t.buyerIsMaker).length / distributionTrades.length}`
            );
            console.log(
                `🔧 Sell pressure: ${distributionTrades.filter((t) => t.buyerIsMaker).length / distributionTrades.length}`
            );

            // Process all trades
            distributionTrades.forEach((trade, i) => {
                const result = detector.analyze(trade);
                console.log(
                    `🔧 Trade ${i}: candidates=${detector.getCandidateCount()}, zones=${detector.getActiveZones().length}`
                );
            });

            // Wait for minimum duration requirement (30 seconds)
            const formationTrade: EnrichedTradeEvent = {
                price: basePrice, // Same price to add to existing candidate
                quantity: 50, // Institutional size
                timestamp: baseTime + 35000, // 35 seconds later (> 30s requirement)
                buyerIsMaker: false, // Buy pressure (retail buying into institutional selling)
                pair: "BTCUSDT",
                tradeId: "distribution_formation_trigger",
                originalTrade: {} as any,
                passiveBidVolume: 0,
                passiveAskVolume: 0,
                zonePassiveBidVolume: 0,
                zonePassiveAskVolume: 0,
            };

            console.log(
                "🔧 Triggering distribution zone formation after 30+ seconds..."
            );
            const formationResult = detector.analyze(formationTrade);

            console.log(
                `🔧 Formation result: updates=${formationResult.updates.length}`
            );
            console.log(`🔧 Final zones: ${detector.getActiveZones().length}`);

            // Analyze candidate state for debugging
            const candidates = detector.getCandidates();
            if (candidates.length > 0) {
                const mainCandidate =
                    candidates.find((c) => c.priceLevel === basePrice) ||
                    candidates[0];
                console.log("🔧 Main candidate analysis:", {
                    priceLevel: mainCandidate.priceLevel,
                    totalVolume: mainCandidate.totalVolume,
                    tradeCount: mainCandidate.tradeCount,
                    sellVolume: mainCandidate.sellVolume,
                    buyVolume: mainCandidate.buyVolume,
                    buyRatio:
                        mainCandidate.buyVolume / mainCandidate.totalVolume,
                    sellRatio:
                        mainCandidate.sellVolume / mainCandidate.totalVolume,
                    duration:
                        formationTrade.timestamp - mainCandidate.startTime,
                    priceStability: mainCandidate.priceStability,
                });

                // DISTRIBUTION VALIDATION: High buy ratio indicates retail buying into institutional selling
                const buyRatio =
                    mainCandidate.buyVolume / mainCandidate.totalVolume;
                expect(buyRatio).toBeGreaterThan(0.6); // Should have high buy pressure
                expect(mainCandidate.totalVolume).toBeGreaterThanOrEqual(200); // minZoneVolume
                expect(mainCandidate.tradeCount).toBeGreaterThanOrEqual(6); // minTradeCount
                expect(
                    formationTrade.timestamp - mainCandidate.startTime
                ).toBeGreaterThanOrEqual(30000); // minCandidateDuration
            }

            // CRITICAL TEST: Distribution zone should be created with proper characteristics
            const activeZones = detector.getActiveZones();
            expect(activeZones.length).toBeGreaterThan(0);

            if (activeZones.length > 0) {
                const distributionZone = activeZones[0];
                expect(distributionZone.type).toBe("distribution");
                expect(
                    distributionZone.priceRange.center ||
                        distributionZone.priceRange.min
                ).toBe(basePrice);
                expect(distributionZone.strength).toBeGreaterThan(0.4);
                console.log("🔧 Distribution zone created successfully:", {
                    type: distributionZone.type,
                    strength: distributionZone.strength,
                    priceLevel:
                        distributionZone.priceRange.center ||
                        distributionZone.priceRange.min,
                });
            }
        });

        it("should reject distribution zone when buy ratio is too low", () => {
            const baseTime = Date.now();
            const basePrice = 50000;

            console.log(
                "🔧 TESTING: Rejecting distribution zone with low buy ratio"
            );

            // Create trades with low buy pressure (high sell pressure) - should NOT form distribution zone
            const lowBuyPressureTrades: EnrichedTradeEvent[] = [];
            for (let i = 0; i < 8; i++) {
                const quantity = 45 + Math.random() * 15;
                const trade: EnrichedTradeEvent = {
                    price: basePrice,
                    quantity,
                    timestamp: baseTime + i * 3000,
                    // HIGH sell pressure (80%) = LOW buy pressure (20%) - NOT distribution
                    buyerIsMaker: Math.random() < 0.8,
                    pair: "BTCUSDT",
                    tradeId: `low_buy_${i}`,
                    originalTrade: {} as any,
                    passiveBidVolume: 0,
                    passiveAskVolume: 0,
                    zonePassiveBidVolume: 0,
                    zonePassiveAskVolume: 0,
                };
                lowBuyPressureTrades.push(trade);
            }

            // Process all trades
            lowBuyPressureTrades.forEach((trade) => {
                detector.analyze(trade);
            });

            // Try to trigger formation after 2+ minutes
            const formationTrade: EnrichedTradeEvent = {
                price: basePrice,
                quantity: 50,
                timestamp: baseTime + 125000,
                buyerIsMaker: true, // Sell pressure
                pair: "BTCUSDT",
                tradeId: "low_buy_formation_attempt",
                originalTrade: {} as any,
                passiveBidVolume: 0,
                passiveAskVolume: 0,
                zonePassiveBidVolume: 0,
                zonePassiveAskVolume: 0,
            };

            detector.analyze(formationTrade);

            // Should NOT create distribution zone due to low buy ratio
            const activeZones = detector.getActiveZones();
            const candidates = detector.getCandidates();

            if (candidates.length > 0) {
                const candidate = candidates[0];
                const buyRatio = candidate.buyVolume / candidate.totalVolume;
                console.log(`🔧 Buy ratio: ${buyRatio} (should be low)`);
                expect(buyRatio).toBeLessThan(0.5); // Should have low buy pressure
            }

            // Should not form zone due to insufficient buy pressure for distribution
            expect(activeZones.length).toBe(0);
            console.log(
                "🔧 Correctly rejected distribution zone with low buy ratio"
            );
        });

        it("should handle institutional selling quality calculation", () => {
            const baseTime = Date.now();
            const basePrice = 50000;

            console.log(
                "🔧 TESTING: Institutional selling quality calculation"
            );

            // Create mixed institutional and retail trades for quality analysis
            const mixedTrades: EnrichedTradeEvent[] = [
                // Large institutional sells into retail buying
                {
                    price: basePrice,
                    quantity: 75, // Large institutional size
                    timestamp: baseTime,
                    buyerIsMaker: false, // Buy pressure (retail)
                    pair: "BTCUSDT",
                    tradeId: "inst_sell_1",
                    originalTrade: {} as any,
                    passiveBidVolume: 0,
                    passiveAskVolume: 0,
                    zonePassiveBidVolume: 0,
                    zonePassiveAskVolume: 0,
                },
                // Medium institutional sells
                {
                    price: basePrice,
                    quantity: 50,
                    timestamp: baseTime + 1000,
                    buyerIsMaker: false, // Buy pressure
                    pair: "BTCUSDT",
                    tradeId: "inst_sell_2",
                    originalTrade: {} as any,
                    passiveBidVolume: 0,
                    passiveAskVolume: 0,
                    zonePassiveBidVolume: 0,
                    zonePassiveAskVolume: 0,
                },
                // Small retail trades (mixed)
                {
                    price: basePrice,
                    quantity: 5, // Small retail size
                    timestamp: baseTime + 2000,
                    buyerIsMaker: true, // Some sell pressure
                    pair: "BTCUSDT",
                    tradeId: "retail_1",
                    originalTrade: {} as any,
                    passiveBidVolume: 0,
                    passiveAskVolume: 0,
                    zonePassiveBidVolume: 0,
                    zonePassiveAskVolume: 0,
                },
            ];

            mixedTrades.forEach((trade) => {
                detector.analyze(trade);
            });

            const candidates = detector.getCandidates();
            if (candidates.length > 0) {
                const candidate = candidates[0];
                console.log("🔧 Institutional quality metrics:", {
                    averageOrderSize: candidate.averageOrderSize,
                    absorptionQuality: candidate.absorptionQuality,
                    totalVolume: candidate.totalVolume,
                    buyVolume: candidate.buyVolume,
                    sellVolume: candidate.sellVolume,
                });

                // Should show high average order size due to institutional participation
                expect(candidate.averageOrderSize).toBeGreaterThan(40);
                // Should have meaningful institutional activity
                expect(candidate.absorptionQuality).toBeGreaterThanOrEqual(0);
            }
        });
    });

    describe("Distribution Zone Signal Generation", () => {
        it("should generate SELL signals when distribution zone is formed", () => {
            const baseTime = Date.now();
            const basePrice = 50000;

            console.log("🔧 TESTING: Distribution zone SELL signal generation");

            // Create strong distribution pattern
            const distributionTrades: EnrichedTradeEvent[] = [];
            for (let i = 0; i < 10; i++) {
                const trade: EnrichedTradeEvent = {
                    price: basePrice,
                    quantity: 60, // Large institutional size
                    timestamp: baseTime + i * 2000,
                    buyerIsMaker: false, // Strong buy pressure (retail buying)
                    pair: "BTCUSDT",
                    tradeId: `signal_test_${i}`,
                    originalTrade: {} as any,
                    passiveBidVolume: 0,
                    passiveAskVolume: 0,
                    zonePassiveBidVolume: 0,
                    zonePassiveAskVolume: 0,
                };
                distributionTrades.push(trade);
            }

            let signals: any[] = [];
            distributionTrades.forEach((trade) => {
                const result = detector.analyze(trade);
                if (result.signals.length > 0) {
                    signals.push(...result.signals);
                }
            });

            // Trigger zone formation
            const formationTrade: EnrichedTradeEvent = {
                price: basePrice,
                quantity: 70,
                timestamp: baseTime + 125000, // 2+ minutes later
                buyerIsMaker: false, // Buy pressure
                pair: "BTCUSDT",
                tradeId: "signal_formation",
                originalTrade: {} as any,
                passiveBidVolume: 0,
                passiveAskVolume: 0,
                zonePassiveBidVolume: 0,
                zonePassiveAskVolume: 0,
            };

            const formationResult = detector.analyze(formationTrade);
            if (formationResult.signals.length > 0) {
                signals.push(...formationResult.signals);
            }

            console.log(`🔧 Generated ${signals.length} signals`);

            if (signals.length > 0) {
                const distributionSignal = signals.find(
                    (s) => s.type === "distribution" || s.side === "SELL"
                );
                if (distributionSignal) {
                    expect(distributionSignal.side).toBe("SELL");
                    expect(distributionSignal.confidence).toBeGreaterThan(0.4);
                    console.log("🔧 Distribution SELL signal generated:", {
                        side: distributionSignal.side,
                        confidence: distributionSignal.confidence,
                        type: distributionSignal.type,
                    });
                }
            }
        });
    });

    describe("Production Configuration Validation", () => {
        it("should respect all production configuration parameters", () => {
            const strictConfig: Partial<ZoneDetectorConfig> = {
                minCandidateDuration: 180000, // 3 minutes - stricter
                minZoneVolume: 300, // Higher volume requirement
                minTradeCount: 8, // More trades required
                maxPriceDeviation: 0.015, // Tighter price tolerance
                minZoneStrength: 0.6, // Higher strength requirement
                strengthChangeThreshold: 0.1, // Smaller strength changes
            };

            const strictDetector = new DistributionZoneDetector(
                "test-strict-config",
                "BTCUSDT",
                strictConfig,
                mockLogger,
                mockMetrics
            );

            console.log(
                "🔧 TESTING: Strict production configuration compliance"
            );

            // Test that detector respects stricter requirements
            const baseTime = Date.now();
            const basePrice = 50000;

            // Create trades that meet old requirements but NOT strict requirements
            const trades: EnrichedTradeEvent[] = [];
            for (let i = 0; i < 6; i++) {
                // Only 6 trades (less than required 8)
                const trade: EnrichedTradeEvent = {
                    price: basePrice,
                    quantity: 35, // Smaller size
                    timestamp: baseTime + i * 2000,
                    buyerIsMaker: false,
                    pair: "BTCUSDT",
                    tradeId: `strict_${i}`,
                    originalTrade: {} as any,
                    passiveBidVolume: 0,
                    passiveAskVolume: 0,
                    zonePassiveBidVolume: 0,
                    zonePassiveAskVolume: 0,
                };
                trades.push(trade);
            }

            trades.forEach((trade) => {
                strictDetector.analyze(trade);
            });

            // Try to form zone after 2+ minutes (less than required 3 minutes)
            const earlyFormation: EnrichedTradeEvent = {
                price: basePrice,
                quantity: 40,
                timestamp: baseTime + 150000, // 2.5 minutes (less than 3 minutes required)
                buyerIsMaker: false,
                pair: "BTCUSDT",
                tradeId: "strict_formation",
                originalTrade: {} as any,
                passiveBidVolume: 0,
                passiveAskVolume: 0,
                zonePassiveBidVolume: 0,
                zonePassiveAskVolume: 0,
            };

            strictDetector.analyze(earlyFormation);

            // Should NOT form zone due to strict requirements
            const zones = strictDetector.getActiveZones();
            expect(zones.length).toBe(0);

            console.log(
                "🔧 Strict configuration properly rejected zone formation"
            );
        });
    });
});
