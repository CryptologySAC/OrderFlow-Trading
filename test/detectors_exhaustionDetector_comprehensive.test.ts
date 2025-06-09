// test/detectors_exhaustionDetector_comprehensive.test.ts
import { describe, it, expect, beforeEach, vi, MockedFunction } from "vitest";
import { ExhaustionDetector } from "../src/indicators/exhaustionDetector.js";
import { Logger } from "../src/infrastructure/logger.js";
import { MetricsCollector } from "../src/infrastructure/metricsCollector.js";
import { SpoofingDetector } from "../src/services/spoofingDetector.js";
import { EnrichedTradeEvent } from "../src/types/marketEvents.js";
import { ExhaustionSignalData } from "../src/types/signalTypes.js";
import { RollingWindow } from "../src/utils/rollingWindow.js";

describe("ExhaustionDetector - Comprehensive Signal Testing", () => {
    let detector: ExhaustionDetector;
    let mockCallback: MockedFunction<(signal: ExhaustionSignalData) => void>;
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
        detector = new ExhaustionDetector(
            "test-exhaustion",
            mockCallback,
            {
                symbol: "BTCUSDT",
                windowMs: 60000, // 1 minute
                minAggVolume: 8, // Low threshold for testing
                exhaustionThreshold: 0.4, // Lower threshold for easier testing
                maxPassiveRatio: 0.5, // Max current/avg passive for exhaustion
                pricePrecision: PRICE_PRECISION,
                zoneTicks: 3,
                eventCooldownMs: 1000, // Short cooldown for testing
                features: {
                    depletionTracking: true,
                    spreadAdjustment: true,
                    volumeVelocity: true,
                    passiveHistory: true,
                    spoofingDetection: false, // Disable for testing
                },
            },
            mockLogger,
            mockSpoofing,
            mockMetrics
        );
    });

    describe("Realistic Exhaustion Scenarios - Should Generate Signals", () => {
        it("should detect buy exhaustion when ask liquidity depletes without refill", () => {
            const basePrice = BTCUSDT_PRICE;
            const timestamp = Date.now();

            // Scenario: Ask liquidity gets progressively depleted by aggressive buying
            setupPassiveLiquidity(basePrice, {
                bid: 200,
                ask: 300, // Initial strong liquidity
                timestamp: timestamp - 35000,
            });

            // Progressive depletion without meaningful refill
            addPassiveDepletion(basePrice, [
                { bid: 200, ask: 300, timestamp: timestamp - 30000 }, // Baseline
                { bid: 200, ask: 250, timestamp: timestamp - 25000 }, // First hit
                { bid: 200, ask: 200, timestamp: timestamp - 20000 }, // Further depletion
                { bid: 200, ask: 120, timestamp: timestamp - 15000 }, // Significant depletion
                { bid: 200, ask: 80, timestamp: timestamp - 10000 }, // Heavy depletion
                { bid: 200, ask: 40, timestamp: timestamp - 5000 }, // Critical depletion
                { bid: 200, ask: 15, timestamp: timestamp - 1000 }, // Exhausted
            ]);

            // Aggressive buying that depletes the ask side
            const aggressiveBuyTrades = generateAggressiveTrades(
                basePrice,
                "buy",
                [
                    { quantity: 50, timestamp: timestamp - 24000 },
                    { quantity: 45, timestamp: timestamp - 19000 },
                    { quantity: 80, timestamp: timestamp - 14000 }, // Large hit
                    { quantity: 40, timestamp: timestamp - 9000 },
                    { quantity: 35, timestamp: timestamp - 4000 },
                    { quantity: 25, timestamp: timestamp - 500 }, // Final blow
                ]
            );

            aggressiveBuyTrades.forEach((trade) => {
                detector.onEnrichedTrade(trade);
            });

            expect(mockCallback).toHaveBeenCalled();
            const signal: ExhaustionSignalData = mockCallback.mock.calls[0][0];

            expect(signal.side).toBe("buy");
            expect(signal.price).toBe(basePrice);
            expect(signal.aggressive).toBeGreaterThan(8); // Above threshold
            expect(signal.confidence).toBeGreaterThan(0.4);
            expect(signal.avgLiquidity).toBeGreaterThan(0);
            expect(signal.meta?.conditions?.depletionRatio).toBeGreaterThan(1); // High depletion
        });

        it("should detect sell exhaustion when bid liquidity depletes rapidly", () => {
            const basePrice = BTCUSDT_PRICE + 1.5;
            const timestamp = Date.now();

            // Scenario: Bid liquidity exhausted by aggressive selling
            setupPassiveLiquidity(basePrice, {
                bid: 400,
                ask: 150, // Strong bid initially
                timestamp: timestamp - 40000,
            });

            // Rapid bid depletion (typical of stop-loss cascades)
            addPassiveDepletion(basePrice, [
                { bid: 400, ask: 150, timestamp: timestamp - 35000 },
                { bid: 350, ask: 150, timestamp: timestamp - 30000 },
                { bid: 280, ask: 150, timestamp: timestamp - 25000 },
                { bid: 200, ask: 150, timestamp: timestamp - 20000 }, // Rapid depletion
                { bid: 120, ask: 150, timestamp: timestamp - 15000 }, // Accelerating
                { bid: 60, ask: 150, timestamp: timestamp - 10000 }, // Critical
                { bid: 20, ask: 150, timestamp: timestamp - 5000 }, // Near empty
                { bid: 5, ask: 150, timestamp: timestamp - 1000 }, // Exhausted
            ]);

            // High velocity aggressive selling
            const aggressiveSellTrades = generateAggressiveTrades(
                basePrice,
                "sell",
                [
                    { quantity: 50, timestamp: timestamp - 29000 },
                    { quantity: 70, timestamp: timestamp - 24000 },
                    { quantity: 80, timestamp: timestamp - 19000 }, // Acceleration
                    { quantity: 60, timestamp: timestamp - 14000 },
                    { quantity: 55, timestamp: timestamp - 9000 },
                    { quantity: 40, timestamp: timestamp - 4000 },
                    { quantity: 15, timestamp: timestamp - 500 }, // Final exhaustion
                ]
            );

            aggressiveSellTrades.forEach((trade) => {
                detector.onEnrichedTrade(trade);
            });

            expect(mockCallback).toHaveBeenCalled();
            const signal: ExhaustionSignalData = mockCallback.mock.calls[0][0];

            expect(signal.side).toBe("sell");
            expect(signal.confidence).toBeGreaterThan(0.4);
            expect(signal.meta?.conditions?.velocityIncrease).toBeGreaterThan(
                1
            ); // High velocity
            expect(signal.meta?.conditions?.passiveRatio).toBeLessThan(0.5); // Low ratio indicates exhaustion
        });

        it("should detect exhaustion with high spread impact", () => {
            const basePrice = BTCUSDT_PRICE - 0.75;
            const timestamp = Date.now();

            // Setup for spread analysis
            setupPassiveLiquidity(basePrice, {
                bid: 250,
                ask: 260, // Initial tight spread
                timestamp: timestamp - 30000,
            });

            // Spread widens as liquidity depletes
            addPassiveDepletion(basePrice, [
                { bid: 250, ask: 260, timestamp: timestamp - 25000 }, // 10 spread
                { bid: 240, ask: 270, timestamp: timestamp - 20000 }, // 30 spread
                { bid: 220, ask: 290, timestamp: timestamp - 15000 }, // 70 spread
                { bid: 180, ask: 320, timestamp: timestamp - 10000 }, // 140 spread
                { bid: 120, ask: 380, timestamp: timestamp - 5000 }, // 260 spread
                { bid: 60, ask: 440, timestamp: timestamp - 1000 }, // 380 spread (wide)
            ]);

            // Mock spread information
            vi.spyOn(detector as any, "getCurrentSpread").mockReturnValue({
                spread: 0.008, // 0.8% spread (high)
                bid: basePrice - 0.3,
                ask: basePrice + 0.5,
            });

            const aggressiveTrades = generateAggressiveTrades(
                basePrice,
                "buy",
                [
                    { quantity: 30, timestamp: timestamp - 24000 },
                    { quantity: 40, timestamp: timestamp - 19000 },
                    { quantity: 60, timestamp: timestamp - 14000 },
                    { quantity: 80, timestamp: timestamp - 9000 },
                    { quantity: 50, timestamp: timestamp - 4000 },
                    { quantity: 20, timestamp: timestamp - 500 },
                ]
            );

            aggressiveTrades.forEach((trade) => {
                detector.onEnrichedTrade(trade);
            });

            expect(mockCallback).toHaveBeenCalled();
            const signal: ExhaustionSignalData = mockCallback.mock.calls[0][0];

            expect(signal.spread).toBeGreaterThan(0.005); // High spread
            expect(signal.confidence).toBeGreaterThan(0.4);
        });

        it("should detect exhaustion with consistent passive depletion pattern", () => {
            const basePrice = BTCUSDT_PRICE + 2.25;
            const timestamp = Date.now();

            // Consistent depletion pattern (institutional selling pressure)
            setupPassiveLiquidity(basePrice, {
                bid: 500,
                ask: 200,
                timestamp: timestamp - 45000,
            });

            // Very consistent depletion rate (high consistency in depletion)
            const depletionPattern = [];
            for (let i = 0; i < 15; i++) {
                const depletionTime = timestamp - (40000 - i * 2500);
                const bidLevel = 500 - i * 30; // Consistent 30 unit depletion
                depletionPattern.push({
                    bid: Math.max(20, bidLevel),
                    ask: 200,
                    timestamp: depletionTime,
                });
            }

            addPassiveDepletion(basePrice, depletionPattern);

            // Matching aggressive trades
            const aggressiveTrades = [];
            for (let i = 0; i < 10; i++) {
                aggressiveTrades.push({
                    quantity: 30 + i * 2, // Increasing pressure
                    timestamp: timestamp - (38000 - i * 3500),
                });
            }

            const trades = generateAggressiveTrades(
                basePrice,
                "sell",
                aggressiveTrades
            );
            trades.forEach((trade) => {
                detector.onEnrichedTrade(trade);
            });

            expect(mockCallback).toHaveBeenCalled();
            const signal: ExhaustionSignalData = mockCallback.mock.calls[0][0];

            expect(signal.meta?.conditions?.consistency).toBeGreaterThan(0.6); // High consistency
            expect(signal.meta?.conditions?.depletionRatio).toBeGreaterThan(2); // High depletion ratio
        });
    });

    describe("Realistic Non-Exhaustion Scenarios - Should NOT Generate Signals", () => {
        it("should NOT signal when passive liquidity refills (absorption, not exhaustion)", () => {
            const basePrice = BTCUSDT_PRICE - 1.25;
            const timestamp = Date.now();

            // This is absorption pattern, not exhaustion
            setupPassiveLiquidity(basePrice, {
                bid: 150,
                ask: 300,
                timestamp: timestamp - 30000,
            });

            // Liquidity gets hit but refills (iceberg/institutional support)
            addPassiveDepletion(basePrice, [
                { bid: 150, ask: 300, timestamp: timestamp - 25000 },
                { bid: 150, ask: 250, timestamp: timestamp - 20000 }, // Hit
                { bid: 150, ask: 295, timestamp: timestamp - 19000 }, // Refill!
                { bid: 150, ask: 240, timestamp: timestamp - 15000 }, // Hit again
                { bid: 150, ask: 290, timestamp: timestamp - 14000 }, // Refill again!
                { bid: 150, ask: 230, timestamp: timestamp - 10000 }, // Hit
                { bid: 150, ask: 285, timestamp: timestamp - 9000 }, // Refill again!
            ]);

            const aggressiveTrades = generateAggressiveTrades(
                basePrice,
                "buy",
                [
                    { quantity: 50, timestamp: timestamp - 19500 },
                    { quantity: 55, timestamp: timestamp - 14500 },
                    { quantity: 60, timestamp: timestamp - 9500 },
                    { quantity: 45, timestamp: timestamp - 1000 },
                ]
            );

            aggressiveTrades.forEach((trade) => {
                detector.onEnrichedTrade(trade);
            });

            // Should NOT signal - this is absorption behavior
            expect(mockCallback).not.toHaveBeenCalled();
        });

        it("should NOT signal with insufficient aggressive volume", () => {
            const basePrice = BTCUSDT_PRICE + 0.8;
            const timestamp = Date.now();

            // Good exhaustion setup but low volume
            setupPassiveLiquidity(basePrice, {
                bid: 100,
                ask: 200,
                timestamp: timestamp - 25000,
            });

            addPassiveDepletion(basePrice, [
                { bid: 100, ask: 200, timestamp: timestamp - 20000 },
                { bid: 100, ask: 150, timestamp: timestamp - 15000 },
                { bid: 100, ask: 80, timestamp: timestamp - 10000 },
                { bid: 100, ask: 30, timestamp: timestamp - 5000 },
                { bid: 100, ask: 10, timestamp: timestamp - 1000 },
            ]);

            // Volume below threshold (minAggVolume = 8)
            const lowVolumeTrades = generateAggressiveTrades(basePrice, "buy", [
                { quantity: 1, timestamp: timestamp - 19000 },
                { quantity: 2, timestamp: timestamp - 14000 },
                { quantity: 1.5, timestamp: timestamp - 9000 },
                { quantity: 2, timestamp: timestamp - 4000 }, // Total: 6.5 < 8
            ]);

            lowVolumeTrades.forEach((trade) => {
                detector.onEnrichedTrade(trade);
            });

            expect(mockCallback).not.toHaveBeenCalled();
        });

        it("should NOT signal when passive ratio is still healthy", () => {
            const basePrice = BTCUSDT_PRICE - 2.1;
            const timestamp = Date.now();

            // Moderate passive reduction but still healthy levels
            setupPassiveLiquidity(basePrice, {
                bid: 300,
                ask: 400,
                timestamp: timestamp - 30000,
            });

            // Only moderate depletion (passive ratio stays healthy)
            addPassiveDepletion(basePrice, [
                { bid: 300, ask: 400, timestamp: timestamp - 25000 },
                { bid: 300, ask: 370, timestamp: timestamp - 20000 }, // 92.5% of original
                { bid: 300, ask: 350, timestamp: timestamp - 15000 }, // 87.5% of original
                { bid: 300, ask: 330, timestamp: timestamp - 10000 }, // 82.5% of original
                { bid: 300, ask: 310, timestamp: timestamp - 5000 }, // 77.5% of original
                { bid: 300, ask: 290, timestamp: timestamp - 1000 }, // 72.5% (still healthy)
            ]);

            const aggressiveTrades = generateAggressiveTrades(
                basePrice,
                "buy",
                [
                    { quantity: 30, timestamp: timestamp - 24000 },
                    { quantity: 20, timestamp: timestamp - 19000 },
                    { quantity: 20, timestamp: timestamp - 14000 },
                    { quantity: 20, timestamp: timestamp - 9000 },
                    { quantity: 20, timestamp: timestamp - 4000 },
                ]
            );

            aggressiveTrades.forEach((trade) => {
                detector.onEnrichedTrade(trade);
            });

            // Passive ratio > maxPassiveRatio (0.5), so not exhausted
            expect(mockCallback).not.toHaveBeenCalled();
        });

        it("should NOT signal during cooldown period", () => {
            const basePrice = BTCUSDT_PRICE + 1.6;
            const timestamp = Date.now();

            // Generate first exhaustion signal
            setupPassiveLiquidity(basePrice, {
                bid: 200,
                ask: 300,
                timestamp: timestamp - 30000,
            });

            addPassiveDepletion(basePrice, [
                { bid: 200, ask: 300, timestamp: timestamp - 25000 },
                { bid: 200, ask: 200, timestamp: timestamp - 20000 },
                { bid: 200, ask: 100, timestamp: timestamp - 15000 },
                { bid: 200, ask: 50, timestamp: timestamp - 10000 },
                { bid: 200, ask: 20, timestamp: timestamp - 5000 },
            ]);

            const firstTrades = generateAggressiveTrades(basePrice, "buy", [
                { quantity: 100, timestamp: timestamp - 24000 },
                { quantity: 100, timestamp: timestamp - 19000 },
                { quantity: 50, timestamp: timestamp - 14000 },
                { quantity: 30, timestamp: timestamp - 9000 },
            ]);

            firstTrades.forEach((trade) => {
                detector.onEnrichedTrade(trade);
            });

            expect(mockCallback).toHaveBeenCalledTimes(1);
            mockCallback.mockClear();

            // Try to generate another signal immediately (within cooldown)
            const secondTrades = generateAggressiveTrades(basePrice, "buy", [
                { quantity: 20, timestamp: timestamp - 500 }, // Within 1000ms cooldown
            ]);

            secondTrades.forEach((trade) => {
                detector.onEnrichedTrade(trade);
            });

            // Should NOT generate second signal due to cooldown
            expect(mockCallback).not.toHaveBeenCalled();
        });

        it("should NOT signal with insufficient sample count", () => {
            const basePrice = BTCUSDT_PRICE - 0.35;
            const timestamp = Date.now();

            // Very limited data history
            setupPassiveLiquidity(basePrice, {
                bid: 100,
                ask: 200,
                timestamp: timestamp - 5000, // Only very recent data
            });

            // Single depletion point (insufficient history)
            addPassiveDepletion(basePrice, [
                { bid: 100, ask: 50, timestamp: timestamp - 2000 }, // Only one data point
            ]);

            const singleTrade = generateAggressiveTrades(basePrice, "buy", [
                { quantity: 150, timestamp: timestamp - 1000 },
            ]);

            singleTrade.forEach((trade) => {
                detector.onEnrichedTrade(trade);
            });

            // Insufficient data quality should prevent signal
            expect(mockCallback).not.toHaveBeenCalled();
        });
    });

    describe("Edge Cases and Boundary Conditions", () => {
        it("should handle zero passive liquidity gracefully", () => {
            const basePrice = BTCUSDT_PRICE + 3.75;
            const timestamp = Date.now();

            // Complete liquidity absence
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

        it("should detect exhaustion with very rapid depletion velocity", () => {
            const basePrice = BTCUSDT_PRICE - 3.2;
            const timestamp = Date.now();

            // Flash crash scenario - ultra-rapid depletion
            setupPassiveLiquidity(basePrice, {
                bid: 1000,
                ask: 300, // Large initial liquidity
                timestamp: timestamp - 10000,
            });

            // Extremely rapid depletion (flash crash pattern)
            addPassiveDepletion(basePrice, [
                { bid: 1000, ask: 300, timestamp: timestamp - 9000 },
                { bid: 700, ask: 300, timestamp: timestamp - 8000 }, // 30% gone in 1 sec
                { bid: 400, ask: 300, timestamp: timestamp - 7000 }, // 60% gone in 2 sec
                { bid: 150, ask: 300, timestamp: timestamp - 6000 }, // 85% gone in 3 sec
                { bid: 50, ask: 300, timestamp: timestamp - 5000 }, // 95% gone in 4 sec
                { bid: 10, ask: 300, timestamp: timestamp - 4000 }, // 99% gone in 5 sec
            ]);

            // Massive aggressive selling causing flash crash
            const crashTrades = generateAggressiveTrades(basePrice, "sell", [
                { quantity: 300, timestamp: timestamp - 8500 },
                { quantity: 300, timestamp: timestamp - 7500 },
                { quantity: 250, timestamp: timestamp - 6500 },
                { quantity: 100, timestamp: timestamp - 5500 },
                { quantity: 40, timestamp: timestamp - 4500 },
            ]);

            crashTrades.forEach((trade) => {
                detector.onEnrichedTrade(trade);
            });

            expect(mockCallback).toHaveBeenCalled();
            const signal: ExhaustionSignalData = mockCallback.mock.calls[0][0];

            expect(signal.confidence).toBeGreaterThan(0.6); // Very high confidence
            expect(signal.meta?.conditions?.velocityIncrease).toBeGreaterThan(
                2
            ); // Extreme velocity
        });

        it("should handle alternating side exhaustion", () => {
            const basePrice = BTCUSDT_PRICE + 0.9;
            const timestamp = Date.now();

            // Both sides depleting at different times
            setupPassiveLiquidity(basePrice, {
                bid: 200,
                ask: 200,
                timestamp: timestamp - 30000,
            });

            // First exhaust bid side
            addPassiveDepletion(basePrice, [
                { bid: 200, ask: 200, timestamp: timestamp - 25000 },
                { bid: 150, ask: 200, timestamp: timestamp - 20000 },
                { bid: 80, ask: 200, timestamp: timestamp - 15000 },
                { bid: 30, ask: 200, timestamp: timestamp - 10000 }, // Bid exhausted
                { bid: 25, ask: 180, timestamp: timestamp - 8000 }, // Now ask starts depleting
                { bid: 25, ask: 120, timestamp: timestamp - 6000 },
                { bid: 25, ask: 60, timestamp: timestamp - 4000 },
                { bid: 25, ask: 20, timestamp: timestamp - 2000 }, // Ask also exhausted
            ]);

            // First sell pressure, then buy pressure
            const mixedTrades = [
                ...generateAggressiveTrades(basePrice, "sell", [
                    { quantity: 50, timestamp: timestamp - 24000 },
                    { quantity: 70, timestamp: timestamp - 19000 },
                    { quantity: 50, timestamp: timestamp - 14000 },
                    { quantity: 20, timestamp: timestamp - 11000 },
                ]),
                ...generateAggressiveTrades(basePrice, "buy", [
                    { quantity: 60, timestamp: timestamp - 7000 },
                    { quantity: 60, timestamp: timestamp - 5000 },
                    { quantity: 40, timestamp: timestamp - 3000 },
                    { quantity: 20, timestamp: timestamp - 1000 },
                ]),
            ];

            mixedTrades.forEach((trade) => {
                detector.onEnrichedTrade(trade);
            });

            // Should detect at least one exhaustion (likely the second one)
            expect(mockCallback).toHaveBeenCalled();
        });
    });

    // Helper functions
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

        (detector as any).zonePassiveHistory.set(
            Math.round(zone / (detector as any).zoneTicks),
            zoneHistory
        );
    }

    function addPassiveDepletion(
        price: number,
        depletions: Array<{ bid: number; ask: number; timestamp: number }>
    ) {
        const zone = Math.round(price / TICK_SIZE) * TICK_SIZE;
        const zoneKey = Math.round(zone / (detector as any).zoneTicks);
        const zoneHistory = (detector as any).zonePassiveHistory.get(zoneKey);

        if (zoneHistory) {
            depletions.forEach((depletion) => {
                zoneHistory.push({
                    bid: depletion.bid,
                    ask: depletion.ask,
                    total: depletion.bid + depletion.ask,
                    timestamp: depletion.timestamp,
                });
            });
        }
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
            buyerIsMaker: side === "sell",

            // Enriched fields
            zonePassiveBidVolume: side === "sell" ? trade.quantity * 0.5 : 150,
            zonePassiveAskVolume: side === "buy" ? trade.quantity * 0.5 : 150,

            // Additional required fields
            isBuyerMaker: side === "sell",
            firstTradeId: `first-${trade.timestamp}`,
            lastTradeId: `last-${trade.timestamp}`,
            count: 1,
        }));
    }
});
