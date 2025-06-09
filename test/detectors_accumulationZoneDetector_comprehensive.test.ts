// test/detectors_accumulationZoneDetector_comprehensive.test.ts
import { describe, it, expect, beforeEach, vi, MockedFunction } from "vitest";
import { AccumulationZoneDetector } from "../src/indicators/accumulationZoneDetector.js";
import { Logger } from "../src/infrastructure/logger.js";
import { MetricsCollector } from "../src/infrastructure/metricsCollector.js";
import { EnrichedTradeEvent } from "../src/types/marketEvents.js";
import { ZoneSignal, ZoneUpdate } from "../src/types/zoneTypes.js";

describe("AccumulationZoneDetector - Comprehensive Signal Testing", () => {
    let detector: AccumulationZoneDetector;
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

        // Create detector with realistic settings for accumulation
        detector = new AccumulationZoneDetector(
            "test-accumulation",
            "BTCUSDT",
            {
                maxActiveZones: 3,
                zoneTimeoutMs: 300000, // 5 minutes for testing
                minZoneVolume: 50, // Lower for testing
                maxZoneWidth: 0.05, // 5% price range
                minZoneStrength: 0.6, // 60% buy ratio for accumulation
                completionThreshold: 0.75,
                strengthChangeThreshold: 0.15,
                minCandidateDuration: 30000, // 30 seconds for testing
                maxPriceDeviation: 0.02,
                minTradeCount: 5, // Lower for testing
                minBuyRatio: 0.65, // 65% minimum buy ratio for accumulation
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

    describe("Realistic Accumulation Zone Scenarios - Should Generate Signals", () => {
        it("should detect institutional accumulation zone with consistent buying pressure", () => {
            const basePrice = BTCUSDT_PRICE;
            const timestamp = Date.now();
            const zoneRange = basePrice * 0.01; // 1% zone range

            // Scenario: Institutional accumulation over 3 minutes with consistent buying
            // Price range: $49,500 - $50,500 (tight accumulation zone)
            const accumulationTrades = [
                // Phase 1: Initial accumulation setup (0-60 seconds)
                ...generateZoneAccumulationTrades(
                    basePrice - zoneRange,
                    basePrice + zoneRange,
                    {
                        duration: 60000,
                        startTime: timestamp - 180000,
                        buyRatio: 0.75, // Strong buying pressure
                        tradeCount: 15,
                        volumeRange: [20, 80],
                        pattern: "institutional", // Larger, more patient orders
                    }
                ),

                // Phase 2: Accumulation intensifies (60-120 seconds)
                ...generateZoneAccumulationTrades(
                    basePrice - zoneRange,
                    basePrice + zoneRange,
                    {
                        duration: 60000,
                        startTime: timestamp - 120000,
                        buyRatio: 0.82, // Increased buying pressure
                        tradeCount: 20,
                        volumeRange: [30, 120],
                        pattern: "institutional",
                    }
                ),

                // Phase 3: Final accumulation phase (120-180 seconds)
                ...generateZoneAccumulationTrades(
                    basePrice - zoneRange,
                    basePrice + zoneRange,
                    {
                        duration: 60000,
                        startTime: timestamp - 60000,
                        buyRatio: 0.78, // Sustained buying
                        tradeCount: 18,
                        volumeRange: [25, 100],
                        pattern: "institutional",
                    }
                ),
            ];

            // Process all trades to build accumulation zone
            accumulationTrades.forEach((trade) => {
                detector.analyze(trade);
            });

            // Should detect strong accumulation zone
            expect(zoneSignals.length).toBeGreaterThan(0);

            const accumulationSignal = zoneSignals.find(
                (s) => s.type === "accumulation"
            );
            expect(accumulationSignal).toBeDefined();
            expect(accumulationSignal!.zone.buyRatio).toBeGreaterThan(0.65);
            expect(accumulationSignal!.zone.strength).toBeGreaterThan(0.6);
            expect(accumulationSignal!.zone.volume).toBeGreaterThan(50);
            expect(accumulationSignal!.confidence).toBeGreaterThan(0.7);
        });

        it("should detect accumulation zone with iceberg order patterns", () => {
            const basePrice = BTCUSDT_PRICE - 500; // $49,500 level
            const timestamp = Date.now();
            const tightRange = basePrice * 0.005; // 0.5% very tight range for iceberg

            // Iceberg accumulation: large hidden orders revealed progressively
            const icebergTrades = [
                // Initial probe orders
                ...generateIcebergAccumulation(basePrice, {
                    startTime: timestamp - 240000,
                    duration: 60000,
                    icebergSize: 500, // Large hidden order
                    showSize: 50, // Small visible clips
                    priceRange: tightRange,
                    clipCount: 10,
                }),

                // Iceberg continues with refills
                ...generateIcebergAccumulation(basePrice, {
                    startTime: timestamp - 180000,
                    duration: 60000,
                    icebergSize: 750,
                    showSize: 60,
                    priceRange: tightRange,
                    clipCount: 12,
                }),

                // Final iceberg phase with larger clips
                ...generateIcebergAccumulation(basePrice, {
                    startTime: timestamp - 120000,
                    duration: 60000,
                    icebergSize: 600,
                    showSize: 75,
                    priceRange: tightRange,
                    clipCount: 8,
                }),
            ];

            icebergTrades.forEach((trade) => {
                detector.analyze(trade);
            });

            expect(zoneSignals.length).toBeGreaterThan(0);

            const icebergSignal = zoneSignals.find(
                (s) => s.type === "accumulation"
            );
            expect(icebergSignal).toBeDefined();
            expect(icebergSignal!.zone.priceRange.width).toBeLessThan(
                basePrice * 0.01
            ); // Tight range
            expect(icebergSignal!.zone.buyRatio).toBeGreaterThan(0.75); // Strong buy dominance
            expect(icebergSignal!.zone.institutionalScore).toBeGreaterThan(0.6); // Institutional signature
        });

        it("should detect smart money accumulation during retail panic selling", () => {
            const basePrice = BTCUSDT_PRICE + 1000; // $51,000
            const timestamp = Date.now();
            const supportZone = basePrice * 0.015; // 1.5% support zone

            // Scenario: Smart money accumulating while retail panics
            const smartMoneyTrades = [
                // Phase 1: Retail selling starts
                ...generateRetailVsSmartMoneyTrades(
                    basePrice - supportZone,
                    basePrice + supportZone,
                    {
                        startTime: timestamp - 300000,
                        duration: 60000,
                        retailSellRatio: 0.7, // Heavy retail selling
                        smartMoneyBuyRatio: 0.8, // Smart money accumulating
                        retailVolumeRange: [10, 40], // Smaller retail trades
                        smartMoneyVolumeRange: [50, 200], // Larger institutional trades
                        smartMoneyPortion: 0.4, // 40% of trades are smart money
                    }
                ),

                // Phase 2: Smart money increases accumulation
                ...generateRetailVsSmartMoneyTrades(
                    basePrice - supportZone,
                    basePrice + supportZone,
                    {
                        startTime: timestamp - 240000,
                        duration: 60000,
                        retailSellRatio: 0.65, // Continued retail selling
                        smartMoneyBuyRatio: 0.85, // Increased smart money buying
                        retailVolumeRange: [8, 35],
                        smartMoneyVolumeRange: [60, 250],
                        smartMoneyPortion: 0.5, // Increased smart money activity
                    }
                ),

                // Phase 3: Accumulation completion
                ...generateRetailVsSmartMoneyTrades(
                    basePrice - supportZone,
                    basePrice + supportZone,
                    {
                        startTime: timestamp - 180000,
                        duration: 60000,
                        retailSellRatio: 0.55, // Retail selling weakens
                        smartMoneyBuyRatio: 0.9, // Strong smart money accumulation
                        retailVolumeRange: [5, 30],
                        smartMoneyVolumeRange: [70, 300],
                        smartMoneyPortion: 0.6, // Dominated by smart money
                    }
                ),
            ];

            smartMoneyTrades.forEach((trade) => {
                detector.analyze(trade);
            });

            expect(zoneSignals.length).toBeGreaterThan(0);

            const smartMoneySignal = zoneSignals.find(
                (s) => s.type === "accumulation"
            );
            expect(smartMoneySignal).toBeDefined();
            expect(smartMoneySignal!.zone.buyRatio).toBeGreaterThan(0.65);
            expect(smartMoneySignal!.zone.institutionalScore).toBeGreaterThan(
                0.7
            );
            expect(smartMoneySignal!.confidence).toBeGreaterThan(0.75);
        });

        it("should detect gradual accumulation zone with volume buildup", () => {
            const basePrice = BTCUSDT_PRICE - 1500; // $48,500
            const timestamp = Date.now();
            const gradualRange = basePrice * 0.02; // 2% range for gradual accumulation

            // Gradual accumulation with increasing volume over time
            const gradualTrades = [
                // Week 1: Light accumulation
                ...generateGradualAccumulation(
                    basePrice - gradualRange,
                    basePrice + gradualRange,
                    {
                        startTime: timestamp - 420000, // 7 minutes ago
                        duration: 60000,
                        initialBuyRatio: 0.68,
                        finalBuyRatio: 0.72,
                        initialVolumeRange: [15, 50],
                        finalVolumeRange: [20, 60],
                        tradeCount: 12,
                    }
                ),

                // Week 2: Moderate accumulation
                ...generateGradualAccumulation(
                    basePrice - gradualRange,
                    basePrice + gradualRange,
                    {
                        startTime: timestamp - 360000,
                        duration: 60000,
                        initialBuyRatio: 0.72,
                        finalBuyRatio: 0.78,
                        initialVolumeRange: [20, 60],
                        finalVolumeRange: [35, 90],
                        tradeCount: 15,
                    }
                ),

                // Week 3: Heavy accumulation
                ...generateGradualAccumulation(
                    basePrice - gradualRange,
                    basePrice + gradualRange,
                    {
                        startTime: timestamp - 300000,
                        duration: 60000,
                        initialBuyRatio: 0.78,
                        finalBuyRatio: 0.85,
                        initialVolumeRange: [35, 90],
                        finalVolumeRange: [50, 150],
                        tradeCount: 20,
                    }
                ),

                // Week 4: Peak accumulation
                ...generateGradualAccumulation(
                    basePrice - gradualRange,
                    basePrice + gradualRange,
                    {
                        startTime: timestamp - 240000,
                        duration: 60000,
                        initialBuyRatio: 0.85,
                        finalBuyRatio: 0.88,
                        initialVolumeRange: [50, 150],
                        finalVolumeRange: [70, 200],
                        tradeCount: 25,
                    }
                ),
            ];

            gradualTrades.forEach((trade) => {
                detector.analyze(trade);
            });

            expect(zoneSignals.length).toBeGreaterThan(0);

            const gradualSignal = zoneSignals.find(
                (s) => s.type === "accumulation"
            );
            expect(gradualSignal).toBeDefined();
            expect(gradualSignal!.zone.buyRatio).toBeGreaterThan(0.7);
            expect(gradualSignal!.zone.strength).toBeGreaterThan(0.65);
            expect(gradualSignal!.zone.volume).toBeGreaterThan(100);
        });
    });

    describe("Realistic Non-Accumulation Scenarios - Should NOT Generate Signals", () => {
        it("should NOT signal during random walk price action", () => {
            const basePrice = BTCUSDT_PRICE + 750;
            const timestamp = Date.now();

            // Random walk: no clear accumulation pattern
            const randomTrades = generateRandomWalkTrades(basePrice, {
                startTime: timestamp - 300000,
                duration: 300000,
                priceRange: basePrice * 0.03, // 3% range
                buyRatio: 0.52, // Nearly balanced (no accumulation)
                tradeCount: 50,
                volumeRange: [10, 80],
            });

            randomTrades.forEach((trade) => {
                detector.analyze(trade);
            });

            // Should not detect accumulation in random walk
            const accumulationSignals = zoneSignals.filter(
                (s) => s.type === "accumulation"
            );
            expect(accumulationSignals.length).toBe(0);
        });

        it("should NOT signal during distribution (sell-heavy) activity", () => {
            const basePrice = BTCUSDT_PRICE - 800;
            const timestamp = Date.now();
            const distributionRange = basePrice * 0.01;

            // Distribution pattern: heavy selling, light buying
            const distributionTrades = generateZoneAccumulationTrades(
                basePrice - distributionRange,
                basePrice + distributionRange,
                {
                    duration: 180000,
                    startTime: timestamp - 180000,
                    buyRatio: 0.35, // Heavy selling (opposite of accumulation)
                    tradeCount: 30,
                    volumeRange: [20, 100],
                    pattern: "institutional",
                }
            );

            distributionTrades.forEach((trade) => {
                detector.analyze(trade);
            });

            // Should NOT detect accumulation during distribution
            const accumulationSignals = zoneSignals.filter(
                (s) => s.type === "accumulation"
            );
            expect(accumulationSignals.length).toBe(0);
        });

        it("should NOT signal with insufficient volume", () => {
            const basePrice = BTCUSDT_PRICE + 250;
            const timestamp = Date.now();
            const smallRange = basePrice * 0.005;

            // Good buy ratio but insufficient volume
            const lowVolumeTrades = generateZoneAccumulationTrades(
                basePrice - smallRange,
                basePrice + smallRange,
                {
                    duration: 120000,
                    startTime: timestamp - 120000,
                    buyRatio: 0.8, // Good buy ratio
                    tradeCount: 8,
                    volumeRange: [2, 8], // Very low volume (below threshold)
                    pattern: "retail",
                }
            );

            lowVolumeTrades.forEach((trade) => {
                detector.analyze(trade);
            });

            const accumulationSignals = zoneSignals.filter(
                (s) => s.type === "accumulation"
            );
            expect(accumulationSignals.length).toBe(0);
        });

        it("should NOT signal with insufficient trade count", () => {
            const basePrice = BTCUSDT_PRICE - 300;
            const timestamp = Date.now();

            // Good metrics but too few trades
            const fewTrades = [
                createEnrichedTrade(basePrice, 100, false, timestamp - 60000), // Buy
                createEnrichedTrade(
                    basePrice + 5,
                    120,
                    false,
                    timestamp - 45000
                ), // Buy
                createEnrichedTrade(
                    basePrice - 3,
                    80,
                    false,
                    timestamp - 30000
                ), // Buy
                // Only 3 trades (below minTradeCount: 5)
            ];

            fewTrades.forEach((trade) => {
                detector.analyze(trade);
            });

            const accumulationSignals = zoneSignals.filter(
                (s) => s.type === "accumulation"
            );
            expect(accumulationSignals.length).toBe(0);
        });

        it("should NOT signal with too wide price range (lack of focus)", () => {
            const basePrice = BTCUSDT_PRICE + 1200;
            const timestamp = Date.now();
            const wideRange = basePrice * 0.08; // 8% range (too wide)

            // Wide price range indicates lack of focused accumulation
            const wideTrades = generateZoneAccumulationTrades(
                basePrice - wideRange,
                basePrice + wideRange,
                {
                    duration: 180000,
                    startTime: timestamp - 180000,
                    buyRatio: 0.75, // Good buy ratio
                    tradeCount: 25,
                    volumeRange: [30, 120], // Good volume
                    pattern: "institutional",
                }
            );

            wideTrades.forEach((trade) => {
                detector.analyze(trade);
            });

            // Should reject due to excessive price range
            const accumulationSignals = zoneSignals.filter(
                (s) => s.type === "accumulation"
            );
            expect(accumulationSignals.length).toBe(0);
        });

        it("should NOT signal with insufficient time duration", () => {
            const basePrice = BTCUSDT_PRICE - 1100;
            const timestamp = Date.now();
            const range = basePrice * 0.01;

            // Very short duration (below minCandidateDuration)
            const shortTrades = generateZoneAccumulationTrades(
                basePrice - range,
                basePrice + range,
                {
                    duration: 15000, // 15 seconds (below 30 second minimum)
                    startTime: timestamp - 15000,
                    buyRatio: 0.8,
                    tradeCount: 10,
                    volumeRange: [40, 100],
                    pattern: "institutional",
                }
            );

            shortTrades.forEach((trade) => {
                detector.analyze(trade);
            });

            const accumulationSignals = zoneSignals.filter(
                (s) => s.type === "accumulation"
            );
            expect(accumulationSignals.length).toBe(0);
        });
    });

    describe("Zone Evolution and Updates", () => {
        it("should track zone strength evolution over time", () => {
            const basePrice = BTCUSDT_PRICE;
            const timestamp = Date.now();
            const range = basePrice * 0.008;

            // Evolving accumulation with increasing strength
            const evolvingTrades = [
                // Weak start
                ...generateZoneAccumulationTrades(
                    basePrice - range,
                    basePrice + range,
                    {
                        duration: 30000,
                        startTime: timestamp - 150000,
                        buyRatio: 0.68, // Weak accumulation
                        tradeCount: 8,
                        volumeRange: [20, 60],
                        pattern: "mixed",
                    }
                ),

                // Strengthening
                ...generateZoneAccumulationTrades(
                    basePrice - range,
                    basePrice + range,
                    {
                        duration: 30000,
                        startTime: timestamp - 120000,
                        buyRatio: 0.75, // Stronger
                        tradeCount: 12,
                        volumeRange: [30, 80],
                        pattern: "institutional",
                    }
                ),

                // Strong finish
                ...generateZoneAccumulationTrades(
                    basePrice - range,
                    basePrice + range,
                    {
                        duration: 30000,
                        startTime: timestamp - 90000,
                        buyRatio: 0.85, // Very strong
                        tradeCount: 15,
                        volumeRange: [40, 120],
                        pattern: "institutional",
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
                (u) => u.zone.type === "accumulation"
            );
            if (updates.length > 1) {
                const earlyUpdate = updates[0];
                const lateUpdate = updates[updates.length - 1];
                expect(lateUpdate.zone.strength).toBeGreaterThan(
                    earlyUpdate.zone.strength
                );
            }
        });

        it("should handle zone completion and new zone formation", () => {
            const basePrice1 = BTCUSDT_PRICE;
            const basePrice2 = BTCUSDT_PRICE + 1000; // Different zone
            const timestamp = Date.now();
            const range = basePrice1 * 0.01;

            // Complete first zone
            const firstZoneTrades = generateZoneAccumulationTrades(
                basePrice1 - range,
                basePrice1 + range,
                {
                    duration: 90000,
                    startTime: timestamp - 200000,
                    buyRatio: 0.85,
                    tradeCount: 20,
                    volumeRange: [50, 150],
                    pattern: "institutional",
                }
            );

            // Start second zone
            const secondZoneTrades = generateZoneAccumulationTrades(
                basePrice2 - range,
                basePrice2 + range,
                {
                    duration: 60000,
                    startTime: timestamp - 100000,
                    buyRatio: 0.78,
                    tradeCount: 15,
                    volumeRange: [40, 120],
                    pattern: "institutional",
                }
            );

            [...firstZoneTrades, ...secondZoneTrades].forEach((trade) => {
                detector.analyze(trade);
            });

            // Should detect multiple zones
            const accumulationSignals = zoneSignals.filter(
                (s) => s.type === "accumulation"
            );
            expect(accumulationSignals.length).toBeGreaterThanOrEqual(1);

            // Zones should have different price centers
            if (accumulationSignals.length > 1) {
                const zone1Price =
                    accumulationSignals[0].zone.priceRange.center;
                const zone2Price =
                    accumulationSignals[1].zone.priceRange.center;
                expect(Math.abs(zone1Price - zone2Price)).toBeGreaterThan(500);
            }
        });
    });

    // Helper functions for generating realistic test data
    function generateZoneAccumulationTrades(
        minPrice: number,
        maxPrice: number,
        config: {
            duration: number;
            startTime: number;
            buyRatio: number;
            tradeCount: number;
            volumeRange: [number, number];
            pattern: "retail" | "institutional" | "mixed";
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
            const isBuy = Math.random() < config.buyRatio;

            // Volume based on pattern
            let volumeMultiplier = 1;
            if (config.pattern === "institutional") {
                volumeMultiplier = Math.random() < 0.3 ? 2.5 : 1; // 30% chance of large orders
            } else if (config.pattern === "retail") {
                volumeMultiplier = 0.5 + Math.random() * 0.5; // Smaller orders
            }

            const volume =
                (config.volumeRange[0] +
                    Math.random() *
                        (config.volumeRange[1] - config.volumeRange[0])) *
                volumeMultiplier;

            trades.push(createEnrichedTrade(price, volume, !isBuy, timestamp));
        }

        return trades;
    }

    function generateIcebergAccumulation(
        basePrice: number,
        config: {
            startTime: number;
            duration: number;
            icebergSize: number;
            showSize: number;
            priceRange: number;
            clipCount: number;
        }
    ): EnrichedTradeEvent[] {
        const trades: EnrichedTradeEvent[] = [];
        const timeStep = config.duration / config.clipCount;

        for (let i = 0; i < config.clipCount; i++) {
            const timestamp = config.startTime + i * timeStep;
            const price = basePrice + (Math.random() - 0.5) * config.priceRange;
            const volume = config.showSize + Math.random() * 10; // Small variation in clip size

            // Iceberg orders are typically buying (accumulation)
            trades.push(createEnrichedTrade(price, volume, false, timestamp)); // buyerIsMaker = false (aggressive buy)
        }

        return trades;
    }

    function generateRetailVsSmartMoneyTrades(
        minPrice: number,
        maxPrice: number,
        config: {
            startTime: number;
            duration: number;
            retailSellRatio: number;
            smartMoneyBuyRatio: number;
            retailVolumeRange: [number, number];
            smartMoneyVolumeRange: [number, number];
            smartMoneyPortion: number;
        }
    ): EnrichedTradeEvent[] {
        const trades: EnrichedTradeEvent[] = [];
        const totalTrades = 30;
        const smartMoneyTrades = Math.floor(
            totalTrades * config.smartMoneyPortion
        );
        const retailTrades = totalTrades - smartMoneyTrades;
        const timeStep = config.duration / totalTrades;

        let tradeIndex = 0;

        // Generate retail trades (more selling)
        for (let i = 0; i < retailTrades; i++) {
            const timestamp = config.startTime + tradeIndex * timeStep;
            const price = minPrice + Math.random() * (maxPrice - minPrice);
            const isSell = Math.random() < config.retailSellRatio;
            const volume =
                config.retailVolumeRange[0] +
                Math.random() *
                    (config.retailVolumeRange[1] - config.retailVolumeRange[0]);

            trades.push(createEnrichedTrade(price, volume, isSell, timestamp));
            tradeIndex++;
        }

        // Generate smart money trades (more buying)
        for (let i = 0; i < smartMoneyTrades; i++) {
            const timestamp = config.startTime + tradeIndex * timeStep;
            const price = minPrice + Math.random() * (maxPrice - minPrice);
            const isBuy = Math.random() < config.smartMoneyBuyRatio;
            const volume =
                config.smartMoneyVolumeRange[0] +
                Math.random() *
                    (config.smartMoneyVolumeRange[1] -
                        config.smartMoneyVolumeRange[0]);

            trades.push(createEnrichedTrade(price, volume, !isBuy, timestamp));
            tradeIndex++;
        }

        // Sort by timestamp
        return trades.sort((a, b) => a.timestamp - b.timestamp);
    }

    function generateGradualAccumulation(
        minPrice: number,
        maxPrice: number,
        config: {
            startTime: number;
            duration: number;
            initialBuyRatio: number;
            finalBuyRatio: number;
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

            // Gradually increase buy ratio and volume
            const buyRatio =
                config.initialBuyRatio +
                (config.finalBuyRatio - config.initialBuyRatio) * progress;
            const isBuy = Math.random() < buyRatio;

            const minVol =
                config.initialVolumeRange[0] +
                (config.finalVolumeRange[0] - config.initialVolumeRange[0]) *
                    progress;
            const maxVol =
                config.initialVolumeRange[1] +
                (config.finalVolumeRange[1] - config.initialVolumeRange[1]) *
                    progress;
            const volume = minVol + Math.random() * (maxVol - minVol);

            trades.push(createEnrichedTrade(price, volume, !isBuy, timestamp));
        }

        return trades;
    }

    function generateRandomWalkTrades(
        basePrice: number,
        config: {
            startTime: number;
            duration: number;
            priceRange: number;
            buyRatio: number;
            tradeCount: number;
            volumeRange: [number, number];
        }
    ): EnrichedTradeEvent[] {
        const trades: EnrichedTradeEvent[] = [];
        const timeStep = config.duration / config.tradeCount;
        let currentPrice = basePrice;

        for (let i = 0; i < config.tradeCount; i++) {
            const timestamp = config.startTime + i * timeStep;

            // Random walk price movement
            const priceChange = (Math.random() - 0.5) * config.priceRange * 0.1;
            currentPrice = Math.max(
                basePrice - config.priceRange,
                Math.min(
                    basePrice + config.priceRange,
                    currentPrice + priceChange
                )
            );

            const isBuy = Math.random() < config.buyRatio;
            const volume =
                config.volumeRange[0] +
                Math.random() * (config.volumeRange[1] - config.volumeRange[0]);

            trades.push(
                createEnrichedTrade(currentPrice, volume, !isBuy, timestamp)
            );
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
            zonePassiveBidVolume: buyerIsMaker ? quantity * 0.8 : 100,
            zonePassiveAskVolume: !buyerIsMaker ? quantity * 0.8 : 100,

            // Additional required fields
            isBuyerMaker: buyerIsMaker,
            firstTradeId: `first-${timestamp}`,
            lastTradeId: `last-${timestamp}`,
            count: 1,
        };
    }
});
