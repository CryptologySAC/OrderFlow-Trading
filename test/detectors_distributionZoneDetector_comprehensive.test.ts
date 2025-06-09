// test/detectors_distributionZoneDetector_comprehensive.test.ts
import { describe, it, expect, beforeEach, vi, MockedFunction } from "vitest";
import { DistributionZoneDetector } from "../src/indicators/distributionZoneDetector.js";
import { Logger } from "../src/infrastructure/logger.js";
import { MetricsCollector } from "../src/infrastructure/metricsCollector.js";
import { EnrichedTradeEvent } from "../src/types/marketEvents.js";
import { ZoneSignal, ZoneUpdate } from "../src/types/zoneTypes.js";

describe("DistributionZoneDetector - Comprehensive Signal Testing", () => {
    let detector: DistributionZoneDetector;
    let mockLogger: Logger;
    let mockMetrics: MetricsCollector;
    let zoneSignals: ZoneSignal[] = [];
    let zoneUpdates: ZoneUpdate[] = [];

    const BTCUSDT_PRICE = 50000;
    const PRICE_PRECISION = 2;

    beforeEach(() => {
        // Reset signal collections
        zoneSignals = [];
        zoneUpdates = [];

        // Create mocks
        mockLogger = {
            info: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
            debug: vi.fn(),
        } as any;
        mockMetrics = {
            incrementMetric: vi.fn(),
            updateMetric: vi.fn(),
            recordHistogram: vi.fn(),
            recordGauge: vi.fn(),
        } as any;

        // Create detector with realistic settings for distribution
        detector = new DistributionZoneDetector(
            "test-distribution",
            "BTCUSDT",
            {
                maxActiveZones: 3,
                zoneTimeoutMs: 180000, // 3 minutes for testing (shorter than accumulation)
                minZoneVolume: 75, // Higher than accumulation (distribution is more aggressive)
                maxZoneWidth: 0.012, // Tighter than accumulation (1.2% vs 5%)
                minZoneStrength: 0.45, // Lower threshold (distribution can be more subtle)
                completionThreshold: 0.75,
                strengthChangeThreshold: 0.12,
                minCandidateDuration: 20000, // 20 seconds (faster than accumulation)
                maxPriceDeviation: 0.008,
                minTradeCount: 8, // Higher minimum trade count
                minSellRatio: 0.68, // 68% minimum sell ratio for distribution
            },
            mockLogger,
            mockMetrics
        );

        // Subscribe to zone events
        detector.on("zoneSignal", (signal: ZoneSignal) => {
            zoneSignals.push(signal);
        });

        detector.on("zoneUpdate", (update: ZoneUpdate) => {
            zoneUpdates.push(update);
        });
    });

    describe("Realistic Distribution Zone Scenarios - Should Generate Signals", () => {
        it("should detect institutional distribution at resistance level", () => {
            const basePrice = BTCUSDT_PRICE; // Major resistance at round number
            const timestamp = Date.now();
            const resistanceRange = basePrice * 0.008; // 0.8% tight distribution zone

            // Scenario: Institutional distribution at psychological resistance
            // Smart money selling into retail FOMO buying
            const distributionTrades = [
                // Phase 1: Initial distribution setup (0-40 seconds)
                ...generateZoneDistributionTrades(
                    basePrice - resistanceRange,
                    basePrice + resistanceRange,
                    {
                        duration: 40000,
                        startTime: timestamp - 120000,
                        sellRatio: 0.75, // Strong selling pressure
                        tradeCount: 12,
                        volumeRange: [30, 120],
                        pattern: "institutional", // Large, strategic sells
                        retailBuyingPressure: 0.6, // Moderate retail buying to absorb
                    }
                ),

                // Phase 2: Distribution intensifies (40-80 seconds)
                ...generateZoneDistributionTrades(
                    basePrice - resistanceRange,
                    basePrice + resistanceRange,
                    {
                        duration: 40000,
                        startTime: timestamp - 80000,
                        sellRatio: 0.82, // Increased selling pressure
                        tradeCount: 15,
                        volumeRange: [40, 180],
                        pattern: "institutional",
                        retailBuyingPressure: 0.4, // Retail buying weakens
                    }
                ),

                // Phase 3: Final distribution phase (80-120 seconds)
                ...generateZoneDistributionTrades(
                    basePrice - resistanceRange,
                    basePrice + resistanceRange,
                    {
                        duration: 40000,
                        startTime: timestamp - 40000,
                        sellRatio: 0.78, // Sustained selling
                        tradeCount: 18,
                        volumeRange: [35, 150],
                        pattern: "institutional",
                        retailBuyingPressure: 0.3, // Retail exhausted
                    }
                ),
            ];

            // Process all trades to build distribution zone
            distributionTrades.forEach((trade) => {
                detector.analyze(trade);
            });

            // Should detect strong distribution zone
            expect(zoneSignals.length).toBeGreaterThan(0);

            const distributionSignal = zoneSignals.find(
                (s) => s.type === "distribution"
            );
            expect(distributionSignal).toBeDefined();
            expect(distributionSignal!.zone.sellRatio).toBeGreaterThan(0.68);
            expect(distributionSignal!.zone.strength).toBeGreaterThan(0.45);
            expect(distributionSignal!.zone.volume).toBeGreaterThan(75);
            expect(distributionSignal!.confidence).toBeGreaterThan(0.7);
        });

        it("should detect stealth distribution with hidden selling", () => {
            const basePrice = BTCUSDT_PRICE + 1500; // $51,500 - new high area
            const timestamp = Date.now();
            const stealthRange = basePrice * 0.006; // Very tight 0.6% range

            // Stealth distribution: large hidden sells broken into smaller pieces
            const stealthTrades = [
                // Hidden selling through fragmented orders
                ...generateStealthDistribution(basePrice, {
                    startTime: timestamp - 150000,
                    duration: 50000,
                    hiddenSellSize: 800, // Large institutional sell order
                    fragmentSize: 40, // Broken into smaller pieces
                    priceRange: stealthRange,
                    fragmentCount: 20,
                    disguiseRatio: 0.3, // 30% disguised as retail buying
                }),

                // Continued stealth selling with larger fragments
                ...generateStealthDistribution(basePrice, {
                    startTime: timestamp - 100000,
                    duration: 50000,
                    hiddenSellSize: 1200,
                    fragmentSize: 60,
                    priceRange: stealthRange,
                    fragmentCount: 20,
                    disguiseRatio: 0.25,
                }),
            ];

            stealthTrades.forEach((trade) => {
                detector.analyze(trade);
            });

            expect(zoneSignals.length).toBeGreaterThan(0);

            const stealthSignal = zoneSignals.find(
                (s) => s.type === "distribution"
            );
            expect(stealthSignal).toBeDefined();
            expect(stealthSignal!.zone.priceRange.width).toBeLessThan(
                basePrice * 0.01
            ); // Tight range
            expect(stealthSignal!.zone.sellRatio).toBeGreaterThan(0.7); // Strong sell dominance
            expect(stealthSignal!.zone.institutionalScore).toBeGreaterThan(0.6); // Institutional signature
        });

        it("should detect distribution during retail euphoria", () => {
            const basePrice = BTCUSDT_PRICE + 2000; // $52,000 - euphoria level
            const timestamp = Date.now();
            const euphoriaRange = basePrice * 0.01; // 1% euphoria zone

            // Scenario: Smart money distributing during retail euphoria/FOMO
            const euphoriaDistribution = [
                // Phase 1: Retail FOMO starts, smart money begins selling
                ...generateEuphoriaDistribution(
                    basePrice - euphoriaRange,
                    basePrice + euphoriaRange,
                    {
                        startTime: timestamp - 180000,
                        duration: 60000,
                        retailFOMORatio: 0.7, // Heavy retail buying
                        smartMoneySellRatio: 0.85, // Smart money selling aggressively
                        retailVolumeRange: [15, 60], // Smaller retail FOMO trades
                        smartMoneyVolumeRange: [80, 300], // Large institutional sales
                        smartMoneyPortion: 0.35, // 35% of trades are smart money sells
                    }
                ),

                // Phase 2: Peak euphoria, maximum distribution
                ...generateEuphoriaDistribution(
                    basePrice - euphoriaRange,
                    basePrice + euphoriaRange,
                    {
                        startTime: timestamp - 120000,
                        duration: 60000,
                        retailFOMORatio: 0.8, // Peak retail FOMO
                        smartMoneySellRatio: 0.9, // Maximum smart money selling
                        retailVolumeRange: [10, 50],
                        smartMoneyVolumeRange: [100, 400],
                        smartMoneyPortion: 0.4, // Increased smart money activity
                    }
                ),

                // Phase 3: Retail exhaustion, final distribution
                ...generateEuphoriaDistribution(
                    basePrice - euphoriaRange,
                    basePrice + euphoriaRange,
                    {
                        startTime: timestamp - 60000,
                        duration: 60000,
                        retailFOMORatio: 0.6, // Retail buying weakens
                        smartMoneySellRatio: 0.85, // Continued selling
                        retailVolumeRange: [5, 40],
                        smartMoneyVolumeRange: [60, 250],
                        smartMoneyPortion: 0.5, // Dominated by smart money
                    }
                ),
            ];

            euphoriaDistribution.forEach((trade) => {
                detector.analyze(trade);
            });

            expect(zoneSignals.length).toBeGreaterThan(0);

            const euphoriaSignal = zoneSignals.find(
                (s) => s.type === "distribution"
            );
            expect(euphoriaSignal).toBeDefined();
            expect(euphoriaSignal!.zone.sellRatio).toBeGreaterThan(0.68);
            expect(euphoriaSignal!.zone.institutionalScore).toBeGreaterThan(
                0.7
            );
            expect(euphoriaSignal!.confidence).toBeGreaterThan(0.75);
        });

        it("should detect distribution with volume climax pattern", () => {
            const basePrice = BTCUSDT_PRICE - 500; // $49,500
            const timestamp = Date.now();
            const climaxRange = basePrice * 0.015; // 1.5% range for climax

            // Volume climax distribution: increasing volume leading to peak selling
            const climaxTrades = [
                // Stage 1: Building volume
                ...generateVolumeClimaxDistribution(
                    basePrice - climaxRange,
                    basePrice + climaxRange,
                    {
                        startTime: timestamp - 160000,
                        duration: 40000,
                        initialSellRatio: 0.72,
                        finalSellRatio: 0.78,
                        initialVolumeRange: [40, 100],
                        finalVolumeRange: [60, 140],
                        tradeCount: 10,
                    }
                ),

                // Stage 2: Accelerating volume
                ...generateVolumeClimaxDistribution(
                    basePrice - climaxRange,
                    basePrice + climaxRange,
                    {
                        startTime: timestamp - 120000,
                        duration: 40000,
                        initialSellRatio: 0.78,
                        finalSellRatio: 0.85,
                        initialVolumeRange: [60, 140],
                        finalVolumeRange: [100, 220],
                        tradeCount: 15,
                    }
                ),

                // Stage 3: Volume climax
                ...generateVolumeClimaxDistribution(
                    basePrice - climaxRange,
                    basePrice + climaxRange,
                    {
                        startTime: timestamp - 80000,
                        duration: 40000,
                        initialSellRatio: 0.85,
                        finalSellRatio: 0.9,
                        initialVolumeRange: [100, 220],
                        finalVolumeRange: [150, 350],
                        tradeCount: 20,
                    }
                ),

                // Stage 4: Post-climax exhaustion
                ...generateVolumeClimaxDistribution(
                    basePrice - climaxRange,
                    basePrice + climaxRange,
                    {
                        startTime: timestamp - 40000,
                        duration: 40000,
                        initialSellRatio: 0.9,
                        finalSellRatio: 0.85,
                        initialVolumeRange: [150, 350],
                        finalVolumeRange: [80, 180],
                        tradeCount: 12,
                    }
                ),
            ];

            climaxTrades.forEach((trade) => {
                detector.analyze(trade);
            });

            expect(zoneSignals.length).toBeGreaterThan(0);

            const climaxSignal = zoneSignals.find(
                (s) => s.type === "distribution"
            );
            expect(climaxSignal).toBeDefined();
            expect(climaxSignal!.zone.sellRatio).toBeGreaterThan(0.75);
            expect(climaxSignal!.zone.strength).toBeGreaterThan(0.6);
            expect(climaxSignal!.zone.volume).toBeGreaterThan(200);
        });
    });

    describe("Realistic Non-Distribution Scenarios - Should NOT Generate Signals", () => {
        it("should NOT signal during accumulation pattern", () => {
            const basePrice = BTCUSDT_PRICE - 1000;
            const timestamp = Date.now();
            const accumulationRange = basePrice * 0.01;

            // This is accumulation pattern, not distribution
            const accumulationTrades = generateZoneDistributionTrades(
                basePrice - accumulationRange,
                basePrice + accumulationRange,
                {
                    duration: 120000,
                    startTime: timestamp - 120000,
                    sellRatio: 0.35, // Heavy buying (opposite of distribution)
                    tradeCount: 20,
                    volumeRange: [30, 120],
                    pattern: "institutional",
                    retailBuyingPressure: 0.8, // Strong retail buying
                }
            );

            accumulationTrades.forEach((trade) => {
                detector.analyze(trade);
            });

            // Should NOT detect distribution during accumulation
            const distributionSignals = zoneSignals.filter(
                (s) => s.type === "distribution"
            );
            expect(distributionSignals.length).toBe(0);
        });

        it("should NOT signal with balanced buying/selling", () => {
            const basePrice = BTCUSDT_PRICE + 800;
            const timestamp = Date.now();
            const balancedRange = basePrice * 0.008;

            // Balanced market with no clear distribution
            const balancedTrades = generateZoneDistributionTrades(
                basePrice - balancedRange,
                basePrice + balancedRange,
                {
                    duration: 100000,
                    startTime: timestamp - 100000,
                    sellRatio: 0.52, // Nearly balanced (no distribution)
                    tradeCount: 25,
                    volumeRange: [20, 100],
                    pattern: "mixed",
                    retailBuyingPressure: 0.5,
                }
            );

            balancedTrades.forEach((trade) => {
                detector.analyze(trade);
            });

            const distributionSignals = zoneSignals.filter(
                (s) => s.type === "distribution"
            );
            expect(distributionSignals.length).toBe(0);
        });

        it("should NOT signal with insufficient volume", () => {
            const basePrice = BTCUSDT_PRICE + 300;
            const timestamp = Date.now();
            const lowVolRange = basePrice * 0.005;

            // Good sell ratio but insufficient volume
            const lowVolumeTrades = generateZoneDistributionTrades(
                basePrice - lowVolRange,
                basePrice + lowVolRange,
                {
                    duration: 80000,
                    startTime: timestamp - 80000,
                    sellRatio: 0.8, // Good sell ratio
                    tradeCount: 12,
                    volumeRange: [3, 12], // Very low volume (below threshold)
                    pattern: "retail",
                    retailBuyingPressure: 0.3,
                }
            );

            lowVolumeTrades.forEach((trade) => {
                detector.analyze(trade);
            });

            const distributionSignals = zoneSignals.filter(
                (s) => s.type === "distribution"
            );
            expect(distributionSignals.length).toBe(0);
        });

        it("should NOT signal with too wide price range", () => {
            const basePrice = BTCUSDT_PRICE - 700;
            const timestamp = Date.now();
            const wideRange = basePrice * 0.025; // 2.5% range (too wide for distribution)

            // Wide price range indicates lack of focused distribution
            const wideTrades = generateZoneDistributionTrades(
                basePrice - wideRange,
                basePrice + wideRange,
                {
                    duration: 120000,
                    startTime: timestamp - 120000,
                    sellRatio: 0.75, // Good sell ratio
                    tradeCount: 30,
                    volumeRange: [40, 150], // Good volume
                    pattern: "institutional",
                    retailBuyingPressure: 0.4,
                }
            );

            wideTrades.forEach((trade) => {
                detector.analyze(trade);
            });

            // Should reject due to excessive price range
            const distributionSignals = zoneSignals.filter(
                (s) => s.type === "distribution"
            );
            expect(distributionSignals.length).toBe(0);
        });

        it("should NOT signal with insufficient trade count", () => {
            const basePrice = BTCUSDT_PRICE + 600;
            const timestamp = Date.now();

            // Good metrics but too few trades
            const fewTrades = [
                createEnrichedTrade(basePrice, 120, true, timestamp - 50000), // Sell
                createEnrichedTrade(
                    basePrice + 3,
                    140,
                    true,
                    timestamp - 35000
                ), // Sell
                createEnrichedTrade(
                    basePrice - 2,
                    100,
                    true,
                    timestamp - 20000
                ), // Sell
                createEnrichedTrade(
                    basePrice + 1,
                    80,
                    false,
                    timestamp - 10000
                ), // Buy
                // Only 4 trades (below minTradeCount: 8)
            ];

            fewTrades.forEach((trade) => {
                detector.analyze(trade);
            });

            const distributionSignals = zoneSignals.filter(
                (s) => s.type === "distribution"
            );
            expect(distributionSignals.length).toBe(0);
        });

        it("should NOT signal with insufficient duration", () => {
            const basePrice = BTCUSDT_PRICE - 400;
            const timestamp = Date.now();
            const range = basePrice * 0.008;

            // Very short duration (below minCandidateDuration)
            const shortTrades = generateZoneDistributionTrades(
                basePrice - range,
                basePrice + range,
                {
                    duration: 10000, // 10 seconds (below 20 second minimum)
                    startTime: timestamp - 10000,
                    sellRatio: 0.8,
                    tradeCount: 12,
                    volumeRange: [50, 150],
                    pattern: "institutional",
                    retailBuyingPressure: 0.3,
                }
            );

            shortTrades.forEach((trade) => {
                detector.analyze(trade);
            });

            const distributionSignals = zoneSignals.filter(
                (s) => s.type === "distribution"
            );
            expect(distributionSignals.length).toBe(0);
        });
    });

    describe("Distribution Zone Evolution and Patterns", () => {
        it("should track distribution strength evolution", () => {
            const basePrice = BTCUSDT_PRICE + 1200;
            const timestamp = Date.now();
            const range = basePrice * 0.009;

            // Evolving distribution with increasing strength
            const evolvingTrades = [
                // Weak start
                ...generateZoneDistributionTrades(
                    basePrice - range,
                    basePrice + range,
                    {
                        duration: 25000,
                        startTime: timestamp - 100000,
                        sellRatio: 0.7, // Weak distribution
                        tradeCount: 10,
                        volumeRange: [30, 80],
                        pattern: "mixed",
                        retailBuyingPressure: 0.6,
                    }
                ),

                // Strengthening
                ...generateZoneDistributionTrades(
                    basePrice - range,
                    basePrice + range,
                    {
                        duration: 25000,
                        startTime: timestamp - 75000,
                        sellRatio: 0.78, // Stronger
                        tradeCount: 12,
                        volumeRange: [40, 120],
                        pattern: "institutional",
                        retailBuyingPressure: 0.4,
                    }
                ),

                // Strong finish
                ...generateZoneDistributionTrades(
                    basePrice - range,
                    basePrice + range,
                    {
                        duration: 25000,
                        startTime: timestamp - 50000,
                        sellRatio: 0.88, // Very strong
                        tradeCount: 15,
                        volumeRange: [60, 180],
                        pattern: "institutional",
                        retailBuyingPressure: 0.2,
                    }
                ),
            ];

            evolvingTrades.forEach((trade) => {
                detector.analyze(trade);
            });

            // Should have zone updates showing strength evolution
            expect(zoneUpdates.length).toBeGreaterThan(0);

            // Verify strength progression
            const updates = zoneUpdates.filter(
                (u) => u.zone.type === "distribution"
            );
            if (updates.length > 1) {
                const earlyUpdate = updates[0];
                const lateUpdate = updates[updates.length - 1];
                expect(lateUpdate.zone.strength).toBeGreaterThan(
                    earlyUpdate.zone.strength
                );
            }
        });

        it("should handle multiple distribution zones simultaneously", () => {
            const basePrice1 = BTCUSDT_PRICE;
            const basePrice2 = BTCUSDT_PRICE + 1500; // Different resistance level
            const timestamp = Date.now();
            const range = basePrice1 * 0.008;

            // Two separate distribution zones
            const zone1Trades = generateZoneDistributionTrades(
                basePrice1 - range,
                basePrice1 + range,
                {
                    duration: 80000,
                    startTime: timestamp - 120000,
                    sellRatio: 0.82,
                    tradeCount: 18,
                    volumeRange: [50, 180],
                    pattern: "institutional",
                    retailBuyingPressure: 0.3,
                }
            );

            const zone2Trades = generateZoneDistributionTrades(
                basePrice2 - range,
                basePrice2 + range,
                {
                    duration: 60000,
                    startTime: timestamp - 80000,
                    sellRatio: 0.75,
                    tradeCount: 15,
                    volumeRange: [40, 140],
                    pattern: "institutional",
                    retailBuyingPressure: 0.4,
                }
            );

            [...zone1Trades, ...zone2Trades].forEach((trade) => {
                detector.analyze(trade);
            });

            // Should detect multiple zones
            const distributionSignals = zoneSignals.filter(
                (s) => s.type === "distribution"
            );
            expect(distributionSignals.length).toBeGreaterThanOrEqual(1);

            // Zones should have different price centers
            if (distributionSignals.length > 1) {
                const zone1Price =
                    distributionSignals[0].zone.priceRange.center;
                const zone2Price =
                    distributionSignals[1].zone.priceRange.center;
                expect(Math.abs(zone1Price - zone2Price)).toBeGreaterThan(1000);
            }
        });
    });

    // Helper functions for generating realistic distribution test data
    function generateZoneDistributionTrades(
        minPrice: number,
        maxPrice: number,
        config: {
            duration: number;
            startTime: number;
            sellRatio: number;
            tradeCount: number;
            volumeRange: [number, number];
            pattern: "retail" | "institutional" | "mixed";
            retailBuyingPressure: number;
        }
    ): EnrichedTradeEvent[] {
        const trades: EnrichedTradeEvent[] = [];
        const timeStep = config.duration / config.tradeCount;

        for (let i = 0; i < config.tradeCount; i++) {
            const timestamp =
                config.startTime +
                i * timeStep +
                Math.random() * timeStep * 0.5;
            const price = minPrice + Math.random() * (maxPrice - minPrice);
            const isSell = Math.random() < config.sellRatio;

            // Volume based on pattern and whether it's institutional selling
            let volumeMultiplier = 1;
            if (config.pattern === "institutional" && isSell) {
                volumeMultiplier = Math.random() < 0.4 ? 3 : 1.5; // 40% chance of large sells
            } else if (config.pattern === "retail") {
                volumeMultiplier = 0.4 + Math.random() * 0.6; // Smaller retail orders
            }

            const volume =
                (config.volumeRange[0] +
                    Math.random() *
                        (config.volumeRange[1] - config.volumeRange[0])) *
                volumeMultiplier;

            trades.push(createEnrichedTrade(price, volume, isSell, timestamp));
        }

        return trades;
    }

    function generateStealthDistribution(
        basePrice: number,
        config: {
            startTime: number;
            duration: number;
            hiddenSellSize: number;
            fragmentSize: number;
            priceRange: number;
            fragmentCount: number;
            disguiseRatio: number;
        }
    ): EnrichedTradeEvent[] {
        const trades: EnrichedTradeEvent[] = [];
        const timeStep = config.duration / config.fragmentCount;

        for (let i = 0; i < config.fragmentCount; i++) {
            const timestamp = config.startTime + i * timeStep;
            const price = basePrice + (Math.random() - 0.5) * config.priceRange;

            // Most fragments are sells, but some are disguised as buys
            const isDisguisedBuy = Math.random() < config.disguiseRatio;
            const volume = config.fragmentSize + Math.random() * 15; // Small variation in fragment size

            trades.push(
                createEnrichedTrade(price, volume, !isDisguisedBuy, timestamp)
            );
        }

        return trades;
    }

    function generateEuphoriaDistribution(
        minPrice: number,
        maxPrice: number,
        config: {
            startTime: number;
            duration: number;
            retailFOMORatio: number;
            smartMoneySellRatio: number;
            retailVolumeRange: [number, number];
            smartMoneyVolumeRange: [number, number];
            smartMoneyPortion: number;
        }
    ): EnrichedTradeEvent[] {
        const trades: EnrichedTradeEvent[] = [];
        const totalTrades = 25;
        const smartMoneyTrades = Math.floor(
            totalTrades * config.smartMoneyPortion
        );
        const retailTrades = totalTrades - smartMoneyTrades;
        const timeStep = config.duration / totalTrades;

        let tradeIndex = 0;

        // Generate retail FOMO trades (more buying)
        for (let i = 0; i < retailTrades; i++) {
            const timestamp = config.startTime + tradeIndex * timeStep;
            const price = minPrice + Math.random() * (maxPrice - minPrice);
            const isBuy = Math.random() < config.retailFOMORatio;
            const volume =
                config.retailVolumeRange[0] +
                Math.random() *
                    (config.retailVolumeRange[1] - config.retailVolumeRange[0]);

            trades.push(createEnrichedTrade(price, volume, !isBuy, timestamp));
            tradeIndex++;
        }

        // Generate smart money trades (more selling)
        for (let i = 0; i < smartMoneyTrades; i++) {
            const timestamp = config.startTime + tradeIndex * timeStep;
            const price = minPrice + Math.random() * (maxPrice - minPrice);
            const isSell = Math.random() < config.smartMoneySellRatio;
            const volume =
                config.smartMoneyVolumeRange[0] +
                Math.random() *
                    (config.smartMoneyVolumeRange[1] -
                        config.smartMoneyVolumeRange[0]);

            trades.push(createEnrichedTrade(price, volume, isSell, timestamp));
            tradeIndex++;
        }

        // Sort by timestamp
        return trades.sort((a, b) => a.timestamp - b.timestamp);
    }

    function generateVolumeClimaxDistribution(
        minPrice: number,
        maxPrice: number,
        config: {
            startTime: number;
            duration: number;
            initialSellRatio: number;
            finalSellRatio: number;
            initialVolumeRange: [number, number];
            finalVolumeRange: [number, number];
            tradeCount: number;
        }
    ): EnrichedTradeEvent[] {
        const trades: EnrichedTradeEvent[] = [];
        const timeStep = config.duration / config.tradeCount;

        for (let i = 0; i < config.tradeCount; i++) {
            const progress = i / (config.tradeCount - 1);
            const timestamp = config.startTime + i * timeStep;
            const price = minPrice + Math.random() * (maxPrice - minPrice);

            // Gradually increase sell ratio and volume (building to climax)
            const sellRatio =
                config.initialSellRatio +
                (config.finalSellRatio - config.initialSellRatio) * progress;
            const isSell = Math.random() < sellRatio;

            const minVol =
                config.initialVolumeRange[0] +
                (config.finalVolumeRange[0] - config.initialVolumeRange[0]) *
                    progress;
            const maxVol =
                config.initialVolumeRange[1] +
                (config.finalVolumeRange[1] - config.initialVolumeRange[1]) *
                    progress;
            const volume = minVol + Math.random() * (maxVol - minVol);

            trades.push(createEnrichedTrade(price, volume, isSell, timestamp));
        }

        return trades;
    }

    function createEnrichedTrade(
        price: number,
        quantity: number,
        buyerIsMaker: boolean,
        timestamp: number
    ): EnrichedTradeEvent {
        return {
            tradeId: `trade-${timestamp}-${Math.random()}`,
            symbol: "BTCUSDT",
            price,
            quantity,
            timestamp,
            buyerIsMaker,

            // Enriched fields
            zonePassiveBidVolume: buyerIsMaker ? quantity * 0.8 : 120,
            zonePassiveAskVolume: !buyerIsMaker ? quantity * 0.8 : 120,

            // Additional required fields
            isBuyerMaker: buyerIsMaker,
            firstTradeId: `first-${timestamp}`,
            lastTradeId: `last-${timestamp}`,
            count: 1,
        };
    }
});
