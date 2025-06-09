// test/detectors_absorptionDetector_comprehensive.test.ts
import { describe, it, expect, beforeEach, vi, MockedFunction } from "vitest";
import { AbsorptionDetector } from "../src/indicators/absorptionDetector.js";
import { Logger } from "../src/infrastructure/logger.js";
import { MetricsCollector } from "../src/infrastructure/metricsCollector.js";
import { SpoofingDetector } from "../src/services/spoofingDetector.js";
import { EnrichedTradeEvent } from "../src/types/marketEvents.js";
import { AbsorptionSignalData } from "../src/types/signalTypes.js";
import { RollingWindow } from "../src/utils/rollingWindow.js";

describe("AbsorptionDetector - Comprehensive Signal Testing", () => {
    let detector: AbsorptionDetector;
    let mockCallback: MockedFunction<(signal: AbsorptionSignalData) => void>;
    let mockLogger: Logger;
    let mockMetrics: MetricsCollector;
    let mockSpoofing: SpoofingDetector;

    const BTCUSDT_PRICE = 50000;
    const PRICE_PRECISION = 2;
    const TICK_SIZE = 0.01;

    beforeEach(() => {
        // Create mocks
        mockCallback = vi.fn();
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
        mockSpoofing = {
            checkWallSpoofing: vi.fn().mockReturnValue(false),
            getWallDetectionMetrics: vi.fn().mockReturnValue({}),
        } as any;

        // Create detector with realistic settings
        detector = new AbsorptionDetector(
            "test-absorption",
            mockCallback,
            {
                symbol: "BTCUSDT",
                windowMs: 60000, // 1 minute
                minAggVolume: 10, // Low threshold for testing
                absorptionThreshold: 0.3, // Lower threshold for easier testing
                minPassiveMultiplier: 1.5,
                maxAbsorptionRatio: 0.7,
                pricePrecision: PRICE_PRECISION,
                zoneTicks: 3,
                eventCooldownMs: 1000, // Short cooldown for testing
                features: {
                    icebergDetection: true,
                    liquidityGradient: true,
                    absorptionVelocity: true,
                    spreadImpact: true,
                    spoofingDetection: false, // Disable for testing
                },
            },
            mockLogger,
            mockSpoofing,
            mockMetrics
        );
    });

    describe("Realistic Absorption Scenarios - Should Generate Signals", () => {
        it("should detect strong buy absorption with iceberg refill pattern", () => {
            const basePrice = BTCUSDT_PRICE;
            const timestamp = Date.now();

            // Scenario: Strong passive ask liquidity absorbing aggressive buy flow
            // 1. Setup initial passive liquidity at price level
            setupPassiveLiquidity(basePrice, {
                bid: 50,
                ask: 200, // Strong ask side
                timestamp: timestamp - 30000,
            });

            // 2. Add consistent passive refills (iceberg pattern)
            addPassiveRefills(basePrice, [
                { bid: 50, ask: 180, timestamp: timestamp - 25000 },
                { bid: 50, ask: 195, timestamp: timestamp - 20000 }, // Refill
                { bid: 50, ask: 175, timestamp: timestamp - 15000 },
                { bid: 50, ask: 190, timestamp: timestamp - 10000 }, // Refill
                { bid: 50, ask: 170, timestamp: timestamp - 5000 },
                { bid: 50, ask: 185, timestamp: timestamp - 2000 }, // Refill
            ]);

            // 3. Add aggressive buy trades that should be absorbed
            const aggressiveBuyTrades = generateAggressiveTrades(
                basePrice,
                "buy",
                [
                    { quantity: 15, timestamp: timestamp - 24000 },
                    { quantity: 12, timestamp: timestamp - 19000 },
                    { quantity: 18, timestamp: timestamp - 14000 },
                    { quantity: 10, timestamp: timestamp - 9000 },
                    { quantity: 16, timestamp: timestamp - 4000 },
                    { quantity: 14, timestamp: timestamp - 1000 }, // Trigger trade
                ]
            );

            // 4. Process all trades
            aggressiveBuyTrades.forEach((trade) => {
                detector.onEnrichedTrade(trade);
            });

            // 5. Verify signal was generated
            expect(mockCallback).toHaveBeenCalled();
            const signalCall = mockCallback.mock.calls[0];
            const signal: AbsorptionSignalData = signalCall[0];

            expect(signal.side).toBe("buy");
            expect(signal.price).toBe(basePrice);
            expect(signal.aggressive).toBeGreaterThan(10); // Above threshold
            expect(signal.passive).toBeGreaterThan(0);
            expect(signal.confidence).toBeGreaterThan(0.3);
            expect(signal.refilled).toBe(true); // Should detect iceberg refills
        });

        it("should detect sell absorption with strong bid liquidity", () => {
            const basePrice = BTCUSDT_PRICE + 0.5; // Different price level
            const timestamp = Date.now();

            // Scenario: Strong passive bid liquidity absorbing aggressive sell flow
            setupPassiveLiquidity(basePrice, {
                bid: 300,
                ask: 80, // Strong bid side
                timestamp: timestamp - 35000,
            });

            // Add deep liquidity gradient (multiple levels)
            addMultipleLevelLiquidity(basePrice, {
                [basePrice - 0.01]: { bid: 250, ask: 70 },
                [basePrice]: { bid: 300, ask: 80 },
                [basePrice + 0.01]: { bid: 280, ask: 75 },
            });

            // Passive liquidity maintained despite aggressive selling
            addPassiveRefills(basePrice, [
                { bid: 300, ask: 80, timestamp: timestamp - 30000 },
                { bid: 285, ask: 80, timestamp: timestamp - 25000 }, // Hit but maintained
                { bid: 290, ask: 80, timestamp: timestamp - 20000 }, // Partial refill
                { bid: 275, ask: 80, timestamp: timestamp - 15000 },
                { bid: 285, ask: 80, timestamp: timestamp - 10000 }, // Refill again
                { bid: 270, ask: 80, timestamp: timestamp - 5000 },
                { bid: 280, ask: 80, timestamp: timestamp - 1000 }, // Final refill
            ]);

            // Aggressive sell trades
            const aggressiveSellTrades = generateAggressiveTrades(
                basePrice,
                "sell",
                [
                    { quantity: 20, timestamp: timestamp - 24000 },
                    { quantity: 15, timestamp: timestamp - 19000 },
                    { quantity: 25, timestamp: timestamp - 14000 },
                    { quantity: 18, timestamp: timestamp - 9000 },
                    { quantity: 22, timestamp: timestamp - 4000 },
                    { quantity: 12, timestamp: timestamp - 500 }, // Trigger
                ]
            );

            aggressiveSellTrades.forEach((trade) => {
                detector.onEnrichedTrade(trade);
            });

            expect(mockCallback).toHaveBeenCalled();
            const signal: AbsorptionSignalData = mockCallback.mock.calls[0][0];

            expect(signal.side).toBe("sell");
            expect(signal.price).toBe(basePrice);
            expect(signal.aggressive).toBeGreaterThan(10);
            expect(signal.confidence).toBeGreaterThan(0.3);
            expect(signal.metrics?.liquidityGradient).toBeGreaterThan(0);
        });

        it("should detect institutional iceberg with consistent sizing", () => {
            const basePrice = BTCUSDT_PRICE - 1.0;
            const timestamp = Date.now();

            // Classic iceberg pattern: consistent size, regular refills
            setupPassiveLiquidity(basePrice, {
                bid: 100,
                ask: 500, // Large ask wall
                timestamp: timestamp - 40000,
            });

            // Iceberg pattern: wall gets hit, refills to same level consistently
            const icebergRefills = [
                { bid: 100, ask: 500, timestamp: timestamp - 35000 }, // Initial
                { bid: 100, ask: 450, timestamp: timestamp - 30000 }, // Hit
                { bid: 100, ask: 500, timestamp: timestamp - 29000 }, // Instant refill
                { bid: 100, ask: 420, timestamp: timestamp - 25000 }, // Hit again
                { bid: 100, ask: 500, timestamp: timestamp - 24000 }, // Instant refill
                { bid: 100, ask: 380, timestamp: timestamp - 20000 }, // Hit
                { bid: 100, ask: 500, timestamp: timestamp - 19000 }, // Refill
                { bid: 100, ask: 350, timestamp: timestamp - 15000 }, // Hit
                { bid: 100, ask: 500, timestamp: timestamp - 14000 }, // Refill
                { bid: 100, ask: 320, timestamp: timestamp - 10000 }, // Hit
                { bid: 100, ask: 500, timestamp: timestamp - 9000 }, // Final refill
            ];

            addPassiveRefills(basePrice, icebergRefills);

            // Consistent aggressive buying (typical algo behavior)
            const aggressiveTrades = generateAggressiveTrades(
                basePrice,
                "buy",
                [
                    { quantity: 50, timestamp: timestamp - 29500 },
                    { quantity: 50, timestamp: timestamp - 24500 },
                    { quantity: 50, timestamp: timestamp - 19500 },
                    { quantity: 50, timestamp: timestamp - 14500 },
                    { quantity: 50, timestamp: timestamp - 9500 },
                    { quantity: 50, timestamp: timestamp - 1000 }, // Trigger
                ]
            );

            aggressiveTrades.forEach((trade) => {
                detector.onEnrichedTrade(trade);
            });

            expect(mockCallback).toHaveBeenCalled();
            const signal: AbsorptionSignalData = mockCallback.mock.calls[0][0];

            expect(signal.side).toBe("buy");
            expect(signal.refilled).toBe(true);
            expect(signal.metrics?.icebergDetected).toBeGreaterThan(0.5); // High iceberg confidence
            expect(signal.confidence).toBeGreaterThan(0.4); // Strong signal
        });
    });

    describe("Realistic Non-Absorption Scenarios - Should NOT Generate Signals", () => {
        it("should NOT signal when aggressive overwhelms passive (exhaustion, not absorption)", () => {
            const basePrice = BTCUSDT_PRICE + 2.0;
            const timestamp = Date.now();

            // Scenario: Passive liquidity gets depleted without refill
            setupPassiveLiquidity(basePrice, {
                bid: 80,
                ask: 120, // Moderate liquidity
                timestamp: timestamp - 30000,
            });

            // Liquidity depletes without refilling (exhaustion pattern)
            addPassiveRefills(basePrice, [
                { bid: 80, ask: 120, timestamp: timestamp - 25000 },
                { bid: 80, ask: 95, timestamp: timestamp - 20000 }, // Depleted
                { bid: 80, ask: 70, timestamp: timestamp - 15000 }, // Further depleted
                { bid: 80, ask: 45, timestamp: timestamp - 10000 }, // Almost gone
                { bid: 80, ask: 20, timestamp: timestamp - 5000 }, // Critically low
                { bid: 80, ask: 5, timestamp: timestamp - 1000 }, // Exhausted
            ]);

            // Large aggressive volume overwhelming the passive side
            const aggressiveTrades = generateAggressiveTrades(
                basePrice,
                "buy",
                [
                    { quantity: 25, timestamp: timestamp - 24000 },
                    { quantity: 30, timestamp: timestamp - 19000 },
                    { quantity: 35, timestamp: timestamp - 14000 },
                    { quantity: 40, timestamp: timestamp - 9000 },
                    { quantity: 50, timestamp: timestamp - 4000 }, // Large hit
                    { quantity: 60, timestamp: timestamp - 500 }, // Overwhelming
                ]
            );

            aggressiveTrades.forEach((trade) => {
                detector.onEnrichedTrade(trade);
            });

            // Should NOT generate absorption signal (this is exhaustion)
            expect(mockCallback).not.toHaveBeenCalled();
        });

        it("should NOT signal with insufficient volume", () => {
            const basePrice = BTCUSDT_PRICE - 0.75;
            const timestamp = Date.now();

            // Good passive liquidity setup
            setupPassiveLiquidity(basePrice, {
                bid: 150,
                ask: 300,
                timestamp: timestamp - 20000,
            });

            addPassiveRefills(basePrice, [
                { bid: 150, ask: 300, timestamp: timestamp - 15000 },
                { bid: 150, ask: 285, timestamp: timestamp - 10000 },
                { bid: 150, ask: 295, timestamp: timestamp - 5000 },
            ]);

            // Volume below threshold (minAggVolume = 10)
            const lowVolumeTrades = generateAggressiveTrades(basePrice, "buy", [
                { quantity: 1, timestamp: timestamp - 14000 },
                { quantity: 2, timestamp: timestamp - 9000 },
                { quantity: 1.5, timestamp: timestamp - 4000 },
                { quantity: 2.5, timestamp: timestamp - 1000 }, // Total: 7 < 10
            ]);

            lowVolumeTrades.forEach((trade) => {
                detector.onEnrichedTrade(trade);
            });

            expect(mockCallback).not.toHaveBeenCalled();
        });

        it("should NOT signal when absorption ratio is too high (passive can't absorb)", () => {
            const basePrice = BTCUSDT_PRICE + 1.25;
            const timestamp = Date.now();

            // Weak passive liquidity
            setupPassiveLiquidity(basePrice, {
                bid: 30,
                ask: 40, // Low liquidity
                timestamp: timestamp - 25000,
            });

            addPassiveRefills(basePrice, [
                { bid: 30, ask: 40, timestamp: timestamp - 20000 },
                { bid: 30, ask: 35, timestamp: timestamp - 15000 },
                { bid: 30, ask: 30, timestamp: timestamp - 10000 },
                { bid: 30, ask: 25, timestamp: timestamp - 5000 },
            ]);

            // Massive aggressive volume (ratio > maxAbsorptionRatio)
            const massiveAggressiveTrades = generateAggressiveTrades(
                basePrice,
                "buy",
                [
                    { quantity: 100, timestamp: timestamp - 19000 }, // Much larger than passive
                    { quantity: 150, timestamp: timestamp - 14000 },
                    { quantity: 200, timestamp: timestamp - 9000 },
                    { quantity: 250, timestamp: timestamp - 4000 },
                    { quantity: 300, timestamp: timestamp - 1000 },
                ]
            );

            massiveAggressiveTrades.forEach((trade) => {
                detector.onEnrichedTrade(trade);
            });

            // Absorption ratio too high: 1000 aggressive vs ~32.5 avg passive = 30.7 ratio
            // This exceeds maxAbsorptionRatio (0.7), so no signal
            expect(mockCallback).not.toHaveBeenCalled();
        });

        it("should NOT signal during cooldown period", () => {
            const basePrice = BTCUSDT_PRICE;
            const timestamp = Date.now();

            // First, generate a valid absorption signal
            setupPassiveLiquidity(basePrice, {
                bid: 100,
                ask: 200,
                timestamp: timestamp - 30000,
            });

            addPassiveRefills(basePrice, [
                { bid: 100, ask: 180, timestamp: timestamp - 25000 },
                { bid: 100, ask: 195, timestamp: timestamp - 20000 },
            ]);

            const firstTrades = generateAggressiveTrades(basePrice, "buy", [
                { quantity: 15, timestamp: timestamp - 24000 },
                { quantity: 12, timestamp: timestamp - 19000 },
            ]);

            firstTrades.forEach((trade) => {
                detector.onEnrichedTrade(trade);
            });

            expect(mockCallback).toHaveBeenCalledTimes(1);
            mockCallback.mockClear();

            // Now try to generate another signal immediately (within cooldown)
            const secondTrades = generateAggressiveTrades(basePrice, "buy", [
                { quantity: 20, timestamp: timestamp - 500 }, // Within 1000ms cooldown
            ]);

            secondTrades.forEach((trade) => {
                detector.onEnrichedTrade(trade);
            });

            // Should NOT generate second signal due to cooldown
            expect(mockCallback).not.toHaveBeenCalled();
        });

        it("should NOT signal with poor data quality", () => {
            const basePrice = BTCUSDT_PRICE - 0.25;
            const timestamp = Date.now();

            // Minimal passive data (poor quality)
            setupPassiveLiquidity(basePrice, {
                bid: 100,
                ask: 200,
                timestamp: timestamp - 5000, // Only one recent snapshot
            });

            // Single aggressive trade (insufficient history)
            const singleTrade = generateAggressiveTrades(basePrice, "buy", [
                { quantity: 50, timestamp: timestamp - 1000 },
            ]);

            singleTrade.forEach((trade) => {
                detector.onEnrichedTrade(trade);
            });

            // Poor data quality should prevent signal
            expect(mockCallback).not.toHaveBeenCalled();
        });
    });

    describe("Edge Cases and Boundary Conditions", () => {
        it("should handle zero passive liquidity gracefully", () => {
            const basePrice = BTCUSDT_PRICE + 3.0;
            const timestamp = Date.now();

            // No passive liquidity
            setupPassiveLiquidity(basePrice, {
                bid: 0,
                ask: 0,
                timestamp: timestamp - 10000,
            });

            const aggressiveTrades = generateAggressiveTrades(
                basePrice,
                "buy",
                [{ quantity: 50, timestamp: timestamp - 5000 }]
            );

            expect(() => {
                aggressiveTrades.forEach((trade) => {
                    detector.onEnrichedTrade(trade);
                });
            }).not.toThrow();

            expect(mockCallback).not.toHaveBeenCalled();
        });

        it("should handle very high passive liquidity (whale walls)", () => {
            const basePrice = BTCUSDT_PRICE - 2.5;
            const timestamp = Date.now();

            // Massive passive wall
            setupPassiveLiquidity(basePrice, {
                bid: 500,
                ask: 10000, // 10k ask wall
                timestamp: timestamp - 30000,
            });

            addPassiveRefills(basePrice, [
                { bid: 500, ask: 9800, timestamp: timestamp - 25000 },
                { bid: 500, ask: 10000, timestamp: timestamp - 24000 }, // Refill
                { bid: 500, ask: 9500, timestamp: timestamp - 20000 },
                { bid: 500, ask: 10000, timestamp: timestamp - 19000 }, // Refill
            ]);

            // Normal aggressive volume vs whale wall
            const aggressiveTrades = generateAggressiveTrades(
                basePrice,
                "buy",
                [
                    { quantity: 200, timestamp: timestamp - 24500 },
                    { quantity: 150, timestamp: timestamp - 19500 },
                    { quantity: 250, timestamp: timestamp - 1000 },
                ]
            );

            aggressiveTrades.forEach((trade) => {
                detector.onEnrichedTrade(trade);
            });

            expect(mockCallback).toHaveBeenCalled();
            const signal: AbsorptionSignalData = mockCallback.mock.calls[0][0];
            expect(signal.confidence).toBeGreaterThan(0.5); // High confidence due to strong absorption
        });
    });

    // Helper functions for test data generation
    function setupPassiveLiquidity(
        price: number,
        liquidity: { bid: number; ask: number; timestamp: number }
    ) {
        const zone = Math.round(price / TICK_SIZE) * TICK_SIZE;
        const zoneHistory = new RollingWindow<any>(100, false);

        zoneHistory.push({
            bid: liquidity.bid,
            ask: liquidity.ask,
            total: liquidity.bid + liquidity.ask,
            timestamp: liquidity.timestamp,
        });

        // Use reflection to set private field
        (detector as any).zonePassiveHistory.set(
            Math.round(zone / (detector as any).zoneTicks),
            zoneHistory
        );
    }

    function addPassiveRefills(
        price: number,
        refills: Array<{ bid: number; ask: number; timestamp: number }>
    ) {
        const zone = Math.round(price / TICK_SIZE) * TICK_SIZE;
        const zoneKey = Math.round(zone / (detector as any).zoneTicks);
        const zoneHistory = (detector as any).zonePassiveHistory.get(zoneKey);

        if (zoneHistory) {
            refills.forEach((refill) => {
                zoneHistory.push({
                    bid: refill.bid,
                    ask: refill.ask,
                    total: refill.bid + refill.ask,
                    timestamp: refill.timestamp,
                });
            });
        }
    }

    function addMultipleLevelLiquidity(
        basePrice: number,
        levels: Record<number, { bid: number; ask: number }>
    ) {
        const depthMap = new Map();
        Object.entries(levels).forEach(([priceStr, liquidity]) => {
            const price = parseFloat(priceStr);
            depthMap.set(price, liquidity);
        });

        // Set the depth map on detector
        (detector as any).depth = depthMap;
    }

    function generateAggressiveTrades(
        price: number,
        side: "buy" | "sell",
        trades: Array<{ quantity: number; timestamp: number }>
    ): EnrichedTradeEvent[] {
        return trades.map((trade, index) => ({
            tradeId: `trade-${Date.now()}-${index}`,
            symbol: "BTCUSDT",
            price,
            quantity: trade.quantity,
            timestamp: trade.timestamp,
            buyerIsMaker: side === "sell", // If aggressive side is buy, buyer is NOT maker

            // Enriched fields
            zonePassiveBidVolume: side === "sell" ? trade.quantity * 0.8 : 100,
            zonePassiveAskVolume: side === "buy" ? trade.quantity * 0.8 : 100,

            // Additional required fields
            isBuyerMaker: side === "sell",
            firstTradeId: `first-${trade.timestamp}`,
            lastTradeId: `last-${trade.timestamp}`,
            count: 1,
        }));
    }
});
