import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ✅ INTEGRATION TEST: Test real zone formation without mocking core functionality
// This tests the complete AccumulationZoneDetector workflow

import { AccumulationZoneDetectorEnhanced } from "../src/indicators/accumulationZoneDetectorEnhanced.js";
import type { EnrichedTradeEvent } from "../src/types/marketEvents.js";
import type { ILogger } from "../src/infrastructure/loggerInterface.js";
import type { IMetricsCollector } from "../src/infrastructure/metricsCollectorInterface.js";
import type { ZoneDetectorConfig } from "../src/types/zoneTypes.js";
import { Config } from "../src/core/config.js";

describe("AccumulationZoneDetectorEnhanced - Integration Tests", () => {
    let detector: AccumulationZoneDetectorEnhanced;
    let mockLogger: ILogger;
    let mockMetrics: IMetricsCollector;

    beforeEach(() => {
        // Clear any previous zone state
        vi.clearAllMocks();

        // Mock Config.UNIVERSAL_ZONE_CONFIG to use test-friendly values
        vi.spyOn(Config, "UNIVERSAL_ZONE_CONFIG", "get").mockReturnValue({
            maxActiveZones: 10,
            zoneTimeoutMs: 600000,
            minZoneVolume: 150, // Match integration test requirements
            maxZoneWidth: 0.05,
            minZoneStrength: 0.1,
            completionThreshold: 0.8,
            strengthChangeThreshold: 0.15,
            minCandidateDuration: 10000, // 10 seconds for integration test
            maxPriceDeviation: 0.05,
            minTradeCount: 4, // Match mixed pattern test requirement
            minBuyRatio: 0.5,
            minSellRatio: 0.4, // Reduced from production 0.65
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
            trace: vi.fn(),
        } as unknown as ILogger;

        mockMetrics = {
            updateMetric: vi.fn(),
            incrementMetric: vi.fn(),
            incrementCounter: vi.fn(), // Added for ZoneManager
            recordDuration: vi.fn(),
            getMetrics: vi.fn().mockReturnValue({}),
            resetMetrics: vi.fn(),
        } as unknown as IMetricsCollector;
    });

    afterEach(() => {
        // Clean up any zone state
        if (detector) {
            // Clear candidates and reset state
        }
    });

    describe("Zone Formation Lifecycle", () => {
        it("should create accumulation zone with sufficient institutional activity", async () => {
            // ✅ REALISTIC CONFIG: Use complete AccumulationEnhancedSettings
            const config = {
                // Core accumulation parameters (complete AccumulationDetectorSchema)
                useStandardizedZones: false,
                minDurationMs: 10000, // 10 seconds for fast testing
                minRatio: 0.5,
                minRecentActivityMs: 5000,
                threshold: 0.3,
                volumeSurgeMultiplier: 2.0,
                imbalanceThreshold: 0.3,
                institutionalThreshold: 15,
                burstDetectionMs: 1500,
                sustainedVolumeMs: 10000,
                medianTradeSize: 1.0,
                enhancementMode: "disabled" as const,
                minEnhancedConfidenceThreshold: 0.3,

                // Enhancement internal parameters (required by AccumulationDetectorSchema)
                enhancementCallFrequency: 10,
                highConfidenceThreshold: 0.8,
                lowConfidenceThreshold: 0.4,
                minConfidenceBoostThreshold: 0.05,
                defaultMinEnhancedConfidenceThreshold: 0.3,
                confidenceReductionFactor: 0.8,
                significanceBoostMultiplier: 0.5,
                neutralBoostReductionFactor: 0.6,
                enhancementSignificanceBoost: false,
            };

            detector = new AccumulationZoneDetectorEnhanced(
                "integration-test",
                "LTCUSDT",
                config,
                mockLogger,
                mockMetrics
            );

            // Clear zone state in the detector's zone manager to prevent test pollution
            const detectorAny = detector as any;
            if (
                detectorAny.zoneManager &&
                detectorAny.zoneManager.clearAllZones
            ) {
                detectorAny.zoneManager.clearAllZones();
            }

            const baseTime = Date.now();
            const ltcPrice = 82.15;

            // ✅ PHASE 1: Build institutional accumulation pattern
            console.log("🔧 Creating institutional accumulation pattern...");

            const institutionalTrades: EnrichedTradeEvent[] = [];
            // Use controlled price clustering for predictable zone formation
            const clusterPrices = [ltcPrice, ltcPrice + 0.01]; // Just 2 price levels
            for (let i = 0; i < 8; i++) {
                institutionalTrades.push({
                    price: clusterPrices[i % 2], // Alternate between 2 price levels
                    quantity: 45 + Math.random() * 15, // 45-60 LTC (institutional size)
                    timestamp: baseTime + i * 1500, // 1.5 second intervals
                    buyerIsMaker: i < 6, // First 6 trades are sell absorption, last 2 are buying
                    pair: "LTCUSDT",
                    tradeId: `inst-${i}`,
                    originalTrade: {} as any,
                    passiveBidVolume: 0,
                    passiveAskVolume: 0,
                    zonePassiveBidVolume: 0,
                    zonePassiveAskVolume: 0,
                });
            }

            // Process the institutional pattern
            const results: any[] = [];
            for (const trade of institutionalTrades) {
                const result = detector.analyze(trade);
                results.push(result);

                console.log(
                    `Trade ${trade.tradeId}: candidates=${detector.getCandidateCount()}, zones=${detector.getActiveZones().length}`
                );
            }

            // ✅ PHASE 2: Wait for minimum duration and trigger zone formation
            console.log("🔧 Triggering zone formation after duration...");

            const triggerTrade: EnrichedTradeEvent = {
                price: ltcPrice + 0.01,
                quantity: 50,
                timestamp: baseTime + 12000, // 12 seconds later (exceeds 10 second minimum)
                buyerIsMaker: true, // Sell absorption
                pair: "LTCUSDT",
                tradeId: "zone-trigger",
                originalTrade: {} as any,
                passiveBidVolume: 0,
                passiveAskVolume: 0,
                zonePassiveBidVolume: 0,
                zonePassiveAskVolume: 0,
            };

            const finalResult = detector.analyze(triggerTrade);

            // ✅ VALIDATION: Check zone formation occurred
            console.log("🔧 Final state analysis:");
            console.log(`- Updates: ${finalResult.updates.length}`);
            console.log(`- Signals: ${finalResult.signals.length}`);
            console.log(`- Active zones: ${finalResult.activeZones.length}`);
            console.log(`- Candidates: ${detector.getCandidateCount()}`);

            // Log candidate details for debugging
            const candidates = detector.getCandidates();
            candidates.forEach((candidate, i) => {
                console.log(`Candidate ${i}:`, {
                    priceLevel: candidate.priceLevel,
                    totalVolume: candidate.totalVolume,
                    tradeCount: candidate.tradeCount,
                    sellRatio: candidate.sellVolume / candidate.totalVolume,
                    duration: triggerTrade.timestamp - candidate.startTime,
                });
            });

            // ✅ VALIDATION: Zone should have been created
            expect(finalResult.updates.length).toBeGreaterThan(0);
            expect(finalResult.signals.length).toBeGreaterThan(0);

            // Verify zone creation update
            const zoneCreationUpdate = finalResult.updates.find(
                (u) => u.updateType === "zone_created"
            );
            if (zoneCreationUpdate) {
                expect(zoneCreationUpdate.zone.type).toBe("accumulation");
                expect(zoneCreationUpdate.zone.totalVolume).toBeGreaterThan(
                    300
                );
                console.log(
                    "✅ Zone created successfully:",
                    zoneCreationUpdate.zone.id
                );
            }

            // Verify signal generation
            if (finalResult.signals.length > 0) {
                const signal = finalResult.signals[0];
                console.log("Signal details:", signal);
                expect(signal.confidence).toBeGreaterThan(0);
                console.log("✅ Zone signal generated:", signal.type);
            }

            // Remaining candidates are just new activity after zone creation
            console.log(`✅ Zone formation test completed successfully`);
        });

        it("should handle mixed trading patterns correctly", () => {
            const config = {
                // Core accumulation parameters (complete AccumulationDetectorSchema)
                useStandardizedZones: false,
                minDurationMs: 10000, // 10 seconds for fast testing
                minRatio: 0.5,
                minRecentActivityMs: 5000,
                threshold: 0.3,
                volumeSurgeMultiplier: 2.0,
                imbalanceThreshold: 0.3,
                institutionalThreshold: 15,
                burstDetectionMs: 1500,
                sustainedVolumeMs: 10000,
                medianTradeSize: 1.0,
                enhancementMode: "disabled" as const,
                minEnhancedConfidenceThreshold: 0.3,

                // Enhancement internal parameters (required by AccumulationDetectorSchema)
                enhancementCallFrequency: 10,
                highConfidenceThreshold: 0.8,
                lowConfidenceThreshold: 0.4,
                minConfidenceBoostThreshold: 0.05,
                defaultMinEnhancedConfidenceThreshold: 0.3,
                confidenceReductionFactor: 0.8,
                significanceBoostMultiplier: 0.5,
                neutralBoostReductionFactor: 0.6,
                enhancementSignificanceBoost: false,
            };

            detector = new AccumulationZoneDetectorEnhanced(
                "mixed-pattern-test",
                "LTCUSDT",
                config,
                mockLogger,
                mockMetrics
            );

            const baseTime = Date.now();
            const ltcPrice = 78.45;

            // ✅ MIXED PATTERN: Realistic alternating pressure within tight range
            const mixedTrades = [
                { buyerIsMaker: true, quantity: 40, priceOffset: 0.0 }, // Sell pressure
                { buyerIsMaker: false, quantity: 30, priceOffset: 0.01 }, // Buy pressure
                { buyerIsMaker: true, quantity: 50, priceOffset: 0.0 }, // Sell pressure
                { buyerIsMaker: false, quantity: 25, priceOffset: 0.01 }, // Buy pressure
                { buyerIsMaker: true, quantity: 60, priceOffset: 0.0 }, // Sell pressure
                { buyerIsMaker: true, quantity: 45, priceOffset: 0.01 }, // More sell pressure
            ];

            mixedTrades.forEach((tradeConfig, i) => {
                const trade: EnrichedTradeEvent = {
                    price: ltcPrice + tradeConfig.priceOffset,
                    quantity: tradeConfig.quantity,
                    timestamp: baseTime + i * 2000,
                    buyerIsMaker: tradeConfig.buyerIsMaker,
                    pair: "LTCUSDT",
                    tradeId: `mixed-${i}`,
                    originalTrade: {} as any,
                    passiveBidVolume: 0,
                    passiveAskVolume: 0,
                    zonePassiveBidVolume: 0,
                    zonePassiveAskVolume: 0,
                };

                const result = detector.analyze(trade);
                console.log(
                    `Mixed trade ${i}: candidates=${detector.getCandidates().length}, zones=${result.updates.length}`
                );
            });

            // Add a trigger trade after sufficient duration
            const triggerTrade: EnrichedTradeEvent = {
                price: ltcPrice,
                quantity: 50,
                timestamp: baseTime + 15000, // 15 seconds later
                buyerIsMaker: true, // Sell pressure
                pair: "LTCUSDT",
                tradeId: "mixed-trigger",
                originalTrade: {} as any,
                passiveBidVolume: 0,
                passiveAskVolume: 0,
                zonePassiveBidVolume: 0,
                zonePassiveAskVolume: 0,
            };

            const triggerResult = detector.analyze(triggerTrade);
            console.log(
                `Trigger trade: candidates=${detector.getCandidates().length}, zones=${triggerResult.updates.length}`
            );

            // ✅ VALIDATION: Should handle mixed patterns (either candidates OR zones formed)
            const candidates = detector.getCandidates();
            const zones = triggerResult.activeZones;
            console.log(
                `Final candidates: ${candidates.length}, zones: ${zones.length}`
            );

            candidates.forEach((candidate, i) => {
                console.log(
                    `Candidate ${i}: price=${candidate.priceLevel}, volume=${candidate.totalVolume}, trades=${candidate.tradeCount}, sellRatio=${candidate.sellVolume / candidate.totalVolume}`
                );
            });

            // Should have either candidates OR zones (zone formation is success)
            expect(candidates.length + zones.length).toBeGreaterThan(0);

            // If zones were formed, that's a success - mixed pattern was handled correctly
            if (zones.length > 0) {
                console.log("✅ Mixed pattern successfully formed zones");
                expect(zones[0].totalVolume).toBeGreaterThan(200);
                return; // Test passed - zone formation is the correct outcome
            }

            // If only candidates remain, validate their mixed nature
            let totalBuyVolume = 0;
            let totalSellVolume = 0;
            candidates.forEach((candidate) => {
                totalBuyVolume += candidate.buyVolume;
                totalSellVolume += candidate.sellVolume;
            });

            // Should track volumes correctly (but zones forming is preferred outcome)
            expect(totalSellVolume).toBeGreaterThan(0);
            expect(totalBuyVolume + totalSellVolume).toBeGreaterThan(50);

            console.log(
                `Mixed pattern results: ${candidates.length} candidates, ${totalBuyVolume} buy vol, ${totalSellVolume} sell vol`
            );
        });
    });

    describe("Institutional Pattern Recognition", () => {
        it("should differentiate institutional vs retail patterns", () => {
            const config: Partial<ZoneDetectorConfig> = {
                minZoneVolume: 100,
                minTradeCount: 3,
                enhancedInstitutionalSizeThreshold: 50,
                pricePrecision: 2,
                zoneTicks: 2,
            };

            detector = new AccumulationZoneDetectorEnhanced(
                "institutional-test",
                "LTCUSDT",
                config,
                mockLogger,
                mockMetrics
            );

            const baseTime = Date.now();

            // ✅ SCENARIO 1: Institutional pattern (large size, controlled)
            console.log("🏛️ Testing institutional pattern...");
            const institutionalTrades = [
                { price: 85.2, quantity: 75, buyerIsMaker: true }, // Large sell absorption
                { price: 85.21, quantity: 80, buyerIsMaker: true }, // Large sell absorption
                { price: 85.2, quantity: 70, buyerIsMaker: true }, // Large sell absorption
            ];

            institutionalTrades.forEach((config, i) => {
                const trade: EnrichedTradeEvent = {
                    price: config.price,
                    quantity: config.quantity,
                    timestamp: baseTime + i * 2000,
                    buyerIsMaker: config.buyerIsMaker,
                    pair: "LTCUSDT",
                    tradeId: `inst-${i}`,
                    originalTrade: {} as any,
                    passiveBidVolume: 0,
                    passiveAskVolume: 0,
                    zonePassiveBidVolume: 0,
                    zonePassiveAskVolume: 0,
                };

                detector.analyze(trade);
            });

            const instCandidates = detector.getCandidates();

            // ✅ SCENARIO 2: Retail pattern (small size, scattered)
            console.log("🏪 Testing retail pattern...");
            const retailTrades = [
                { price: 85.25, quantity: 15, buyerIsMaker: false }, // Small buy
                { price: 85.26, quantity: 12, buyerIsMaker: false }, // Small buy
                { price: 85.24, quantity: 18, buyerIsMaker: false }, // Small buy
            ];

            retailTrades.forEach((config, i) => {
                const trade: EnrichedTradeEvent = {
                    price: config.price,
                    quantity: config.quantity,
                    timestamp: baseTime + 10000 + i * 1000,
                    buyerIsMaker: config.buyerIsMaker,
                    pair: "LTCUSDT",
                    tradeId: `retail-${i}`,
                    originalTrade: {} as any,
                    passiveBidVolume: 0,
                    passiveAskVolume: 0,
                    zonePassiveBidVolume: 0,
                    zonePassiveAskVolume: 0,
                };

                detector.analyze(trade);
            });

            const allCandidates = detector.getCandidates();

            // ✅ VALIDATION: Should distinguish patterns
            expect(allCandidates.length).toBeGreaterThan(instCandidates.length);

            // Find institutional vs retail candidates
            const instCandidate = allCandidates.find(
                (c) => c.averageOrderSize > 60 && c.sellVolume > c.buyVolume
            );
            const retailCandidate = allCandidates.find(
                (c) => c.averageOrderSize < 20 && c.buyVolume > c.sellVolume
            );

            if (instCandidate) {
                expect(instCandidate.averageOrderSize).toBeGreaterThan(60);
                expect(instCandidate.sellVolume).toBeGreaterThan(
                    instCandidate.buyVolume
                );
                console.log("✅ Institutional pattern detected:", {
                    avgSize: instCandidate.averageOrderSize,
                    sellRatio:
                        instCandidate.sellVolume / instCandidate.totalVolume,
                });
            }

            if (retailCandidate) {
                expect(retailCandidate.averageOrderSize).toBeLessThan(20);
                expect(retailCandidate.buyVolume).toBeGreaterThan(
                    retailCandidate.sellVolume
                );
                console.log("✅ Retail pattern detected:", {
                    avgSize: retailCandidate.averageOrderSize,
                    buyRatio:
                        retailCandidate.buyVolume / retailCandidate.totalVolume,
                });
            }
        });
    });

    describe("Error Handling and Edge Cases", () => {
        it("should handle rapid price movements gracefully", () => {
            const config: Partial<ZoneDetectorConfig> = {
                minZoneVolume: 50,
                minTradeCount: 2,
                pricePrecision: 2,
                zoneTicks: 2,
            };

            detector = new AccumulationZoneDetectorEnhanced(
                "rapid-movement-test",
                "LTCUSDT",
                config,
                mockLogger,
                mockMetrics
            );

            const baseTime = Date.now();

            // ✅ RAPID PRICE MOVEMENT: Simulate volatile market conditions
            const rapidTrades = [
                { price: 80.0, quantity: 30 },
                { price: 80.5, quantity: 25 }, // +50 cents
                { price: 79.75, quantity: 35 }, // -75 cents
                { price: 81.25, quantity: 40 }, // +150 cents
                { price: 80.8, quantity: 20 }, // -45 cents
            ];

            rapidTrades.forEach((config, i) => {
                const trade: EnrichedTradeEvent = {
                    price: config.price,
                    quantity: config.quantity,
                    timestamp: baseTime + i * 500, // 500ms intervals (very rapid)
                    buyerIsMaker: Math.random() < 0.5,
                    pair: "LTCUSDT",
                    tradeId: `rapid-${i}`,
                    originalTrade: {} as any,
                    passiveBidVolume: 0,
                    passiveAskVolume: 0,
                    zonePassiveBidVolume: 0,
                    zonePassiveAskVolume: 0,
                };

                // ✅ EXPECTED: Should not throw errors during rapid movement
                expect(() => detector.analyze(trade)).not.toThrow();
            });

            // ✅ VALIDATION: Should create separate candidates for different price levels
            const candidates = detector.getCandidates();
            expect(candidates.length).toBeGreaterThan(1);

            // Should handle price dispersion correctly
            const priceSpread =
                Math.max(...candidates.map((c) => c.priceLevel)) -
                Math.min(...candidates.map((c) => c.priceLevel));
            expect(priceSpread).toBeGreaterThan(1.0); // Should capture significant price range

            console.log(
                `Rapid movement handled: ${candidates.length} candidates across $${priceSpread.toFixed(2)} spread`
            );
        });

        it("should maintain performance under sustained load", () => {
            const config: Partial<ZoneDetectorConfig> = {
                minZoneVolume: 1000,
                minTradeCount: 10,
                pricePrecision: 2,
                zoneTicks: 2,
            };

            detector = new AccumulationZoneDetectorEnhanced(
                "performance-test",
                "LTCUSDT",
                config,
                mockLogger,
                mockMetrics
            );

            const startTime = Date.now();
            const tradeCount = 500; // Sustained load test

            // ✅ PERFORMANCE TEST: Process many trades efficiently
            for (let i = 0; i < tradeCount; i++) {
                const trade: EnrichedTradeEvent = {
                    price: 75.0 + (Math.random() - 0.5) * 2.0, // ±$1 range
                    quantity: 10 + Math.random() * 40,
                    timestamp: Date.now() + i * 10, // 10ms intervals
                    buyerIsMaker: Math.random() < 0.6,
                    pair: "LTCUSDT",
                    tradeId: `load-${i}`,
                    originalTrade: {} as any,
                    passiveBidVolume: 0,
                    passiveAskVolume: 0,
                    zonePassiveBidVolume: 0,
                    zonePassiveAskVolume: 0,
                };

                detector.analyze(trade);

                // Check periodically that performance is maintained
                if (i > 0 && i % 100 === 0) {
                    const elapsed = Date.now() - startTime;
                    const tradesPerSecond = (i / elapsed) * 1000;
                    expect(tradesPerSecond).toBeGreaterThan(100); // Should process >100 trades/sec
                }
            }

            const totalTime = Date.now() - startTime;
            const finalTps = (tradeCount / totalTime) * 1000;

            // ✅ PERFORMANCE VALIDATION: Should be fast enough for real-time trading
            expect(totalTime).toBeLessThan(2000); // Under 2 seconds for 500 trades
            expect(finalTps).toBeGreaterThan(100); // >100 trades per second
            expect(detector.getCandidateCount()).toBeGreaterThan(0);

            console.log(
                `✅ Performance test: ${tradeCount} trades in ${totalTime}ms (${finalTps.toFixed(0)} TPS)`
            );
        });
    });
});
