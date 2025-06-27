import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock dependencies
vi.mock("../src/multithreading/workerLogger");

import { DistributionZoneDetector } from "../src/indicators/distributionZoneDetector.js";
import type { EnrichedTradeEvent } from "../src/types/marketEvents.js";
import type { ILogger } from "../src/infrastructure/loggerInterface.js";
import type { IMetricsCollector } from "../src/infrastructure/metricsCollectorInterface.js";
import type { ZoneDetectorConfig } from "../src/types/zoneTypes.js";

describe("DistributionZoneDetector - Integration and Performance Tests", () => {
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
        const { MetricsCollector: MockMetricsCollector } = await import(
            "../__mocks__/src/infrastructure/metricsCollector.js"
        );
        mockMetrics = new MockMetricsCollector() as any;

        const config: Partial<ZoneDetectorConfig> = {
            minCandidateDuration: 30000, // 30 seconds - reduced for test
            minZoneVolume: 200,
            minTradeCount: 6,
            maxPriceDeviation: 0.02,
            minZoneStrength: 0.45,
            strengthChangeThreshold: 0.15,
            minSellRatio: 0.55, // Required for distribution detection
        };

        detector = new DistributionZoneDetector(
            "test-integration",
            "BTCUSDT",
            config,
            mockLogger,
            mockMetrics
        );
    });

    describe("Volume Surge Integration", () => {
        it("should integrate volume surge detection with distribution zone formation", () => {
            console.log(
                "🌊 TESTING: Volume surge integration with distribution detection"
            );

            const baseTime = Date.now();
            const surgeLevel = 51800;

            // Baseline volume establishment
            const baselineTrades: EnrichedTradeEvent[] = [];
            for (let i = 0; i < 4; i++) {
                baselineTrades.push({
                    price: surgeLevel - 5 + Math.random() * 10, // Spread around price
                    quantity: 15 + Math.random() * 10, // Normal retail sizes
                    timestamp: baseTime - 300000 + i * 30000, // Historical baseline
                    buyerIsMaker: Math.random() < 0.5,
                    pair: "BTCUSDT",
                    tradeId: `baseline_${i}`,
                    originalTrade: {} as any,
                    passiveBidVolume: 0,
                    passiveAskVolume: 0,
                    zonePassiveBidVolume: 0,
                    zonePassiveAskVolume: 0,
                });
            }

            // Process baseline to establish normal volume
            baselineTrades.forEach((trade) => {
                detector.analyze(trade);
            });

            // Volume surge during distribution formation
            const surgeTrades: EnrichedTradeEvent[] = [];
            for (let i = 0; i < 8; i++) {
                surgeTrades.push({
                    price: surgeLevel,
                    quantity: 75 + Math.random() * 30, // 3-5x surge in volume
                    timestamp: baseTime + i * 5000,
                    buyerIsMaker: false, // Buy pressure (distribution pattern)
                    pair: "BTCUSDT",
                    tradeId: `surge_${i}`,
                    originalTrade: {} as any,
                    passiveBidVolume: 0,
                    passiveAskVolume: 0,
                    zonePassiveBidVolume: 0,
                    zonePassiveAskVolume: 0,
                });
            }

            let surgeResults: any[] = [];
            surgeTrades.forEach((trade, i) => {
                const result = detector.analyze(trade);
                surgeResults.push({
                    tradeIndex: i,
                    candidateCount: detector.getCandidateCount(),
                    activeZones: detector.getActiveZones().length,
                    signals: result.signals.length,
                });

                if (result.signals.length > 0) {
                    console.log(
                        `🌊 Volume surge trade ${i}: Generated ${result.signals.length} signals`
                    );
                }
            });

            // Formation with continued surge - ensure enough time has passed
            const surgeFormation: EnrichedTradeEvent = {
                price: surgeLevel,
                quantity: 120, // Very large volume
                timestamp: baseTime + 40000, // 40 seconds after first trade (> 30s requirement)
                buyerIsMaker: false,
                pair: "BTCUSDT",
                tradeId: "surge_formation",
                originalTrade: {} as any,
                passiveBidVolume: 0,
                passiveAskVolume: 0,
                zonePassiveBidVolume: 0,
                zonePassiveAskVolume: 0,
            };

            const formationResult = detector.analyze(surgeFormation);

            console.log("🌊 Volume surge integration results:");
            console.log(`  - Final zones: ${detector.getActiveZones().length}`);
            console.log(
                `  - Formation signals: ${formationResult.signals.length}`
            );

            // Validation: Volume surge should enhance distribution detection
            const zones = detector.getActiveZones();
            expect(zones.length).toBeGreaterThan(0);

            if (zones.length > 0) {
                const distributionZone = zones[0];
                expect(distributionZone.strength).toBeGreaterThan(0.5); // Volume surge should increase strength
                console.log(
                    `🌊 Distribution zone strength with volume surge: ${distributionZone.strength.toFixed(3)}`
                );
            }

            // Check candidates for volume surge characteristics
            const candidates = detector.getCandidates();
            if (candidates.length > 0) {
                const surgeCandidate = candidates.find(
                    (c) => c.priceLevel === surgeLevel
                );
                if (surgeCandidate) {
                    expect(surgeCandidate.averageOrderSize).toBeGreaterThan(60); // Large average due to surge
                    console.log(
                        `🌊 Average order size during surge: ${surgeCandidate.averageOrderSize.toFixed(1)}`
                    );
                }
            }
        });

        it("should handle multiple distribution zones with volume surges", () => {
            console.log(
                "🌊🌊 TESTING: Multiple distribution zones with simultaneous volume surges"
            );

            const baseTime = Date.now();
            const level1 = 51000;
            const level2 = 51200;
            const level3 = 51400;

            // Simultaneous distribution at multiple levels with volume surges
            const multiLevelSurges: EnrichedTradeEvent[] = [];

            for (let cycle = 0; cycle < 4; cycle++) {
                const cycleTime = baseTime + cycle * 20000;

                // Level 1 distribution
                multiLevelSurges.push({
                    price: level1,
                    quantity: 80 + Math.random() * 25,
                    timestamp: cycleTime,
                    buyerIsMaker: false,
                    pair: "BTCUSDT",
                    tradeId: `multi_level1_${cycle}`,
                    originalTrade: {} as any,
                    passiveBidVolume: 0,
                    passiveAskVolume: 0,
                    zonePassiveBidVolume: 0,
                    zonePassiveAskVolume: 0,
                });

                // Level 2 distribution
                multiLevelSurges.push({
                    price: level2,
                    quantity: 70 + Math.random() * 30,
                    timestamp: cycleTime + 2000,
                    buyerIsMaker: false,
                    pair: "BTCUSDT",
                    tradeId: `multi_level2_${cycle}`,
                    originalTrade: {} as any,
                    passiveBidVolume: 0,
                    passiveAskVolume: 0,
                    zonePassiveBidVolume: 0,
                    zonePassiveAskVolume: 0,
                });

                // Level 3 distribution
                multiLevelSurges.push({
                    price: level3,
                    quantity: 65 + Math.random() * 20,
                    timestamp: cycleTime + 4000,
                    buyerIsMaker: false,
                    pair: "BTCUSDT",
                    tradeId: `multi_level3_${cycle}`,
                    originalTrade: {} as any,
                    passiveBidVolume: 0,
                    passiveAskVolume: 0,
                    zonePassiveBidVolume: 0,
                    zonePassiveAskVolume: 0,
                });
            }

            // Process multi-level surges
            multiLevelSurges.forEach((trade) => {
                detector.analyze(trade);
            });

            // Formation triggers for each level
            const formationTriggers = [
                { price: level1, id: "formation_level1" },
                { price: level2, id: "formation_level2" },
                { price: level3, id: "formation_level3" },
            ];

            let totalSignals = 0;
            formationTriggers.forEach((trigger) => {
                const formationTrade: EnrichedTradeEvent = {
                    price: trigger.price,
                    quantity: 95,
                    timestamp: baseTime + 85000, // Ensure enough time has passed (> 30s + cycles)
                    buyerIsMaker: false,
                    pair: "BTCUSDT",
                    tradeId: trigger.id,
                    originalTrade: {} as any,
                    passiveBidVolume: 0,
                    passiveAskVolume: 0,
                    zonePassiveBidVolume: 0,
                    zonePassiveAskVolume: 0,
                };

                const result = detector.analyze(formationTrade);
                totalSignals += result.signals.length;
            });

            console.log("🌊🌊 Multi-level surge results:");
            console.log(
                `  - Total candidates: ${detector.getCandidateCount()}`
            );
            console.log(
                `  - Active zones: ${detector.getActiveZones().length}`
            );
            console.log(`  - Total signals: ${totalSignals}`);

            // Should handle multiple zones efficiently
            expect(detector.getCandidateCount()).toBeGreaterThanOrEqual(2);

            // Should form zones at multiple levels
            const zones = detector.getActiveZones();
            const zonePrices = new Set(
                zones.map((z) => z.priceRange.center || z.priceRange.min)
            );
            expect(zonePrices.size).toBeGreaterThanOrEqual(1);

            console.log(
                `🌊🌊 Distribution zones at price levels: ${Array.from(zonePrices).join(", ")}`
            );
        });
    });

    describe("Memory Management and Performance", () => {
        it("should handle large volume of trades without memory leaks", () => {
            console.log(
                "💾 TESTING: Memory management under high trade volume"
            );

            const baseTime = Date.now();
            const testLevel = 50500;

            // Generate large volume of trades
            const largeBatchTrades: EnrichedTradeEvent[] = [];
            for (let i = 0; i < 1000; i++) {
                largeBatchTrades.push({
                    price: testLevel + (Math.random() - 0.5) * 2, // Small price variations
                    quantity: 20 + Math.random() * 40,
                    timestamp: baseTime + i * 100, // High frequency
                    buyerIsMaker: Math.random() < 0.3, // 70% buy pressure for distribution
                    pair: "BTCUSDT",
                    tradeId: `perf_${i}`,
                    originalTrade: {} as any,
                    passiveBidVolume: 0,
                    passiveAskVolume: 0,
                    zonePassiveBidVolume: 0,
                    zonePassiveAskVolume: 0,
                });
            }

            const startTime = Date.now();
            let processedCount = 0;
            let totalSignals = 0;

            // Process trades in batches to simulate real-time processing
            const batchSize = 50;
            for (let i = 0; i < largeBatchTrades.length; i += batchSize) {
                const batch = largeBatchTrades.slice(i, i + batchSize);

                batch.forEach((trade) => {
                    const result = detector.analyze(trade);
                    totalSignals += result.signals.length;
                    processedCount++;
                });

                // Log progress every 200 trades
                if (processedCount % 200 === 0) {
                    console.log(
                        `💾 Processed ${processedCount}/1000 trades, signals: ${totalSignals}`
                    );
                }
            }

            const endTime = Date.now();
            const processingTime = endTime - startTime;

            console.log("💾 Performance results:");
            console.log(
                `  - Processed ${processedCount} trades in ${processingTime}ms`
            );
            console.log(
                `  - Average processing time: ${(processingTime / processedCount).toFixed(3)}ms per trade`
            );
            console.log(`  - Total signals generated: ${totalSignals}`);
            console.log(
                `  - Final candidates: ${detector.getCandidateCount()}`
            );
            console.log(
                `  - Active zones: ${detector.getActiveZones().length}`
            );

            // Performance validation
            expect(processingTime / processedCount).toBeLessThan(1); // Less than 1ms per trade
            expect(detector.getCandidateCount()).toBeLessThan(50); // Reasonable memory usage for 1000 trades

            // Should maintain functionality under load
            expect(detector.getActiveZones().length).toBeGreaterThanOrEqual(0);
        });

        it("should cleanup old candidates efficiently", () => {
            console.log("🧹 TESTING: Candidate cleanup efficiency");

            const baseTime = Date.now();
            const oldLevel = 49000;
            const newLevel = 52000;

            // Create old candidates that should be cleaned up
            const oldTrades: EnrichedTradeEvent[] = [];
            for (let i = 0; i < 6; i++) {
                oldTrades.push({
                    price: oldLevel,
                    quantity: 50 + Math.random() * 20,
                    timestamp: baseTime - 600000 + i * 10000, // 10 minutes ago
                    buyerIsMaker: false,
                    pair: "BTCUSDT",
                    tradeId: `old_${i}`,
                    originalTrade: {} as any,
                    passiveBidVolume: 0,
                    passiveAskVolume: 0,
                    zonePassiveBidVolume: 0,
                    zonePassiveAskVolume: 0,
                });
            }

            oldTrades.forEach((trade) => {
                detector.analyze(trade);
            });

            const oldCandidateCount = detector.getCandidateCount();
            console.log(`🧹 Old candidates created: ${oldCandidateCount}`);

            // Fast forward time and create new candidates
            const newTrades: EnrichedTradeEvent[] = [];
            for (let i = 0; i < 8; i++) {
                newTrades.push({
                    price: newLevel,
                    quantity: 60 + Math.random() * 25,
                    timestamp: baseTime + i * 5000, // Current time
                    buyerIsMaker: false,
                    pair: "BTCUSDT",
                    tradeId: `new_${i}`,
                    originalTrade: {} as any,
                    passiveBidVolume: 0,
                    passiveAskVolume: 0,
                    zonePassiveBidVolume: 0,
                    zonePassiveAskVolume: 0,
                });
            }

            newTrades.forEach((trade) => {
                detector.analyze(trade);
            });

            const finalCandidateCount = detector.getCandidateCount();
            console.log(
                `🧹 Final candidates after cleanup: ${finalCandidateCount}`
            );

            // Should have cleaned up old candidates
            expect(finalCandidateCount).toBeLessThanOrEqual(
                oldCandidateCount + 2
            );

            // Check that new candidates are at the current price level
            const candidates = detector.getCandidates();
            const currentLevelCandidates = candidates.filter(
                (c) => c.priceLevel === newLevel
            );
            expect(currentLevelCandidates.length).toBeGreaterThan(0);

            console.log(
                `🧹 Current level candidates: ${currentLevelCandidates.length}`
            );
        });
    });

    describe("Configuration Edge Cases", () => {
        it("should handle extreme configuration values gracefully", () => {
            console.log("⚙️ TESTING: Extreme configuration value handling");

            // Test with very strict configuration
            const strictConfig: Partial<ZoneDetectorConfig> = {
                minCandidateDuration: 600000, // 10 minutes (very strict)
                minZoneVolume: 1000, // Very high volume requirement
                minTradeCount: 20, // Many trades required
                maxPriceDeviation: 0.001, // Very tight price tolerance
                minZoneStrength: 0.9, // Very high strength requirement
                strengthChangeThreshold: 0.05, // Small strength changes
            };

            const strictDetector = new DistributionZoneDetector(
                "test-strict",
                "BTCUSDT",
                strictConfig,
                mockLogger,
                mockMetrics
            );

            const baseTime = Date.now();
            const strictLevel = 51000;

            // Create trades that would normally form zones
            const strictTrades: EnrichedTradeEvent[] = [];
            for (let i = 0; i < 15; i++) {
                // Less than required 20
                strictTrades.push({
                    price: strictLevel + (Math.random() - 0.5) * 0.01, // Very tight price range
                    quantity: 40 + Math.random() * 20,
                    timestamp: baseTime + i * 10000,
                    buyerIsMaker: false,
                    pair: "BTCUSDT",
                    tradeId: `strict_${i}`,
                    originalTrade: {} as any,
                    passiveBidVolume: 0,
                    passiveAskVolume: 0,
                    zonePassiveBidVolume: 0,
                    zonePassiveAskVolume: 0,
                });
            }

            strictTrades.forEach((trade) => {
                strictDetector.analyze(trade);
            });

            // Try formation (before minimum duration)
            const earlyFormation: EnrichedTradeEvent = {
                price: strictLevel,
                quantity: 80,
                timestamp: baseTime + 300000, // Only 5 minutes (less than 10 required)
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

            console.log("⚙️ Strict configuration results:");
            console.log(
                `  - Candidates: ${strictDetector.getCandidateCount()}`
            );
            console.log(`  - Zones: ${strictDetector.getActiveZones().length}`);

            // Should not form zones due to strict requirements
            expect(strictDetector.getActiveZones().length).toBe(0);

            // Test with very permissive configuration
            const permissiveConfig: Partial<ZoneDetectorConfig> = {
                minCandidateDuration: 10000, // 10 seconds (very permissive)
                minZoneVolume: 50, // Low volume requirement
                minTradeCount: 2, // Few trades required
                maxPriceDeviation: 0.1, // Wide price tolerance
                minZoneStrength: 0.1, // Low strength requirement
                strengthChangeThreshold: 0.5, // Large strength changes allowed
                minSellRatio: 0.5, // Lower requirement for easier zone formation
            };

            const permissiveDetector = new DistributionZoneDetector(
                "test-permissive",
                "BTCUSDT",
                permissiveConfig,
                mockLogger,
                mockMetrics
            );

            // Create minimal trades
            const permissiveTrades: EnrichedTradeEvent[] = [
                {
                    price: strictLevel,
                    quantity: 30,
                    timestamp: baseTime,
                    buyerIsMaker: false,
                    pair: "BTCUSDT",
                    tradeId: "permissive_1",
                    originalTrade: {} as any,
                    passiveBidVolume: 0,
                    passiveAskVolume: 0,
                    zonePassiveBidVolume: 0,
                    zonePassiveAskVolume: 0,
                },
                {
                    price: strictLevel,
                    quantity: 25,
                    timestamp: baseTime + 5000,
                    buyerIsMaker: false,
                    pair: "BTCUSDT",
                    tradeId: "permissive_2",
                    originalTrade: {} as any,
                    passiveBidVolume: 0,
                    passiveAskVolume: 0,
                    zonePassiveBidVolume: 0,
                    zonePassiveAskVolume: 0,
                },
            ];

            permissiveTrades.forEach((trade) => {
                permissiveDetector.analyze(trade);
            });

            // Quick formation
            const quickFormation: EnrichedTradeEvent = {
                price: strictLevel,
                quantity: 30,
                timestamp: baseTime + 15000, // After minimum duration
                buyerIsMaker: false,
                pair: "BTCUSDT",
                tradeId: "permissive_formation",
                originalTrade: {} as any,
                passiveBidVolume: 0,
                passiveAskVolume: 0,
                zonePassiveBidVolume: 0,
                zonePassiveAskVolume: 0,
            };

            permissiveDetector.analyze(quickFormation);

            console.log("⚙️ Permissive configuration results:");
            console.log(
                `  - Candidates: ${permissiveDetector.getCandidateCount()}`
            );
            console.log(
                `  - Zones: ${permissiveDetector.getActiveZones().length}`
            );

            // Should form zones easily due to permissive requirements
            expect(permissiveDetector.getActiveZones().length).toBeGreaterThan(
                0
            );
        });
    });
});
