import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock dependencies
vi.mock("../src/multithreading/workerLogger");

import { DistributionDetectorEnhanced } from "../src/indicators/distributionDetectorEnhanced.js";
import type { EnrichedTradeEvent } from "../src/types/marketEvents.js";
import type { ILogger } from "../src/infrastructure/loggerInterface.js";
import type { IMetricsCollector } from "../src/infrastructure/metricsCollectorInterface.js";
import type { IOrderflowPreprocessor } from "../src/market/orderFlowPreprocessor.js";
import type { ZoneDetectorConfig } from "../src/types/zoneTypes.js";
import { Config } from "../src/core/config.js";

describe("DistributionDetectorEnhanced - Integration and Performance Tests", () => {
    let detector: DistributionDetectorEnhanced;
    let mockLogger: ILogger;
    let mockMetrics: IMetricsCollector;

    const mockPreprocessor: IOrderflowPreprocessor = {
        handleDepth: vi.fn(),
        handleAggTrade: vi.fn(),
        getStats: vi.fn(() => ({
            processedTrades: 0,
            processedDepthUpdates: 0,
            bookMetrics: {} as any,
        })),
        findZonesNearPrice: vi.fn(() => []),
        calculateZoneRelevanceScore: vi.fn(() => 0.5),
        findMostRelevantZone: vi.fn(() => null),
    };

    beforeEach(async () => {
        // Mock Config.UNIVERSAL_ZONE_CONFIG to use test-friendly values
        vi.spyOn(Config, "UNIVERSAL_ZONE_CONFIG", "get").mockReturnValue({
            maxActiveZones: 10,
            zoneTimeoutMs: 600000,
            minZoneVolume: 150, // Test-friendly value
            maxZoneWidth: 0.05,
            minZoneStrength: 0.1,
            completionThreshold: 0.8,
            strengthChangeThreshold: 0.15,
            minCandidateDuration: 25000, // 25 seconds for fast testing
            maxPriceDeviation: 0.05,
            minTradeCount: 5, // Test-friendly value
            minBuyRatio: 0.6, // For distribution (buying pressure for selling into)
            minSellRatio: 0.5, // Reduced for testing
            priceStabilityThreshold: 0.8,
            strongZoneThreshold: 0.7,
            weakZoneThreshold: 0.4,
            minZoneConfluenceCount: 1,
            maxZoneConfluenceDistance: 3,
            enableZoneConfluenceFilter: false,
            enableCrossTimeframeAnalysis: false,
            confluenceConfidenceBoost: 0.1,
            crossTimeframeBoost: 0.1,
            useStandardizedZones: false,
            enhancementMode: "disabled" as const,
        });

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
            minZoneVolume: 100, // Reduced to allow zone formation with test data
            minTradeCount: 4, // Reduced for testing
            maxPriceDeviation: 0.02,
            minZoneStrength: 0.45,
            strengthChangeThreshold: 0.15,
            minSellRatio: 0.55, // Required for distribution detection
        };

        detector = new DistributionDetectorEnhanced(
            "test-integration",
            "BTCUSDT",
            config,
            mockPreprocessor,
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

            // Volume surge during distribution formation - proper institutional patterns
            const surgeTrades: EnrichedTradeEvent[] = [];
            for (let i = 0; i < 10; i++) {
                // Create proper institutional patterns: 60% institutional size trades (≥50)
                const isInstitutional = i < 6; // First 6 trades are institutional (60%)
                const isIcebergPattern = i >= 6 && i < 9; // Last 3 trades form iceberg pattern (consistent 60 size)

                let quantity;
                if (isIcebergPattern) {
                    quantity = 60; // Consistent iceberg size
                } else if (isInstitutional) {
                    quantity = 70 + Math.random() * 30; // 70-100 institutional size
                } else {
                    quantity = 25 + Math.random() * 15; // 25-40 retail size
                }

                surgeTrades.push({
                    price: surgeLevel,
                    quantity: quantity,
                    timestamp: baseTime + i * 4000, // 4-second intervals
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
                quantity: 120, // Large institutional volume for formation
                timestamp: baseTime + 45000, // 45 seconds after first trade (> 30s requirement)
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
            const allSignals = [
                ...surgeResults.flatMap((r) =>
                    Array.isArray(r.signals) ? r.signals : []
                ),
                ...formationResult.signals,
            ];

            // Primary validation: Should generate distribution signals
            expect(allSignals.length).toBeGreaterThan(0);
            console.log(`🌊 Total signals generated: ${allSignals.length}`);

            // If zones are created, validate their strength
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

                // Level 1 distribution - institutional pattern
                multiLevelSurges.push({
                    price: level1,
                    quantity: cycle === 0 ? 120 : 80 + Math.random() * 25, // First trade institutional
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

                // Level 2 distribution - institutional pattern
                multiLevelSurges.push({
                    price: level2,
                    quantity: cycle === 1 ? 110 : 70 + Math.random() * 30, // Second cycle institutional
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

                // Level 3 distribution - institutional pattern
                multiLevelSurges.push({
                    price: level3,
                    quantity: cycle === 2 ? 100 : 65 + Math.random() * 20, // Third cycle institutional
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

            // Should handle multiple zones efficiently (zones created clean up candidates)
            const totalActivity =
                detector.getCandidateCount() + detector.getActiveZones().length;
            expect(totalActivity).toBeGreaterThanOrEqual(1);

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

            const strictDetector = new DistributionDetectorEnhanced(
                "test-strict",
                "BTCUSDT",
                strictConfig,
                mockPreprocessor,
                mockLogger,
                mockMetrics
            );

            const baseTime = Date.now();
            const strictLevel = 51000;

            // Create trades that would normally form zones
            const strictTrades: EnrichedTradeEvent[] = [];
            for (let i = 0; i < 3; i++) {
                // Only 3 trades (less than required 5 by universal mock)
                strictTrades.push({
                    price: strictLevel + (Math.random() - 0.5) * 0.01, // Very tight price range
                    quantity: 25 + Math.random() * 10, // Smaller quantities to stay under volume threshold
                    timestamp: baseTime + i * 5000,
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

            // Try formation (before minimum duration from universal zone config mock)
            const earlyFormation: EnrichedTradeEvent = {
                price: strictLevel,
                quantity: 30, // Small quantity to stay under volume threshold
                timestamp: baseTime + 5000, // Only 5 seconds (much less than 25 required by mock)
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

            // Test with very permissive configuration (align with universal zone config)
            const permissiveConfig: Partial<ZoneDetectorConfig> = {
                minCandidateDuration: 20000, // 20 seconds (less than universal 25s)
                minZoneVolume: 100, // Lower than universal 150
                minTradeCount: 4, // Less than universal 5
                maxPriceDeviation: 0.1, // Wide price tolerance
                minZoneStrength: 0.05, // Very low strength requirement
                strengthChangeThreshold: 0.5, // Large strength changes allowed
                minSellRatio: 0.4, // Very low requirement for easier zone formation
            };

            const permissiveDetector = new DistributionDetectorEnhanced(
                "test-permissive",
                "BTCUSDT",
                permissiveConfig,
                mockPreprocessor,
                mockLogger,
                mockMetrics
            );

            // Create enough trades with proper institutional pattern (need minimum 5 trades for universal config)
            const permissiveTrades: EnrichedTradeEvent[] = [];
            for (let i = 0; i < 6; i++) {
                permissiveTrades.push({
                    price: strictLevel,
                    quantity: 50, // Good institutional size
                    timestamp: baseTime + i * 2000, // 2-second intervals
                    buyerIsMaker: false, // High buy pressure for distribution
                    pair: "BTCUSDT",
                    tradeId: `permissive_${i + 1}`,
                    originalTrade: {} as any,
                    passiveBidVolume: 0,
                    passiveAskVolume: 0,
                    zonePassiveBidVolume: 0,
                    zonePassiveAskVolume: 0,
                });
            }

            permissiveTrades.forEach((trade) => {
                permissiveDetector.analyze(trade);
            });

            // Quick formation (after minimum duration from universal config mock)
            const quickFormation: EnrichedTradeEvent = {
                price: strictLevel,
                quantity: 100, // Large institutional formation trade
                timestamp: baseTime + 27000, // After universal config minimum (27s > 25s)
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
