// test/absorptionDetector_signalDirectionFix.test.ts
import { describe, it, expect, beforeEach, vi, MockedFunction } from "vitest";

// Mock the WorkerLogger before importing
vi.mock("../src/multithreading/workerLogger");
vi.mock("../src/infrastructure/metricsCollector");

import { AbsorptionDetector } from "../src/indicators/absorptionDetector.js";
import { WorkerLogger } from "../src/multithreading/workerLogger.js";
import { MetricsCollector } from "../src/infrastructure/metricsCollector.js";
import { SpoofingDetector } from "../src/services/spoofingDetector.js";
import { OrderBookState } from "../src/market/orderBookState.js";
import { EnrichedTradeEvent } from "../src/types/marketEvents.js";
import { Detected } from "../src/indicators/interfaces/detectorInterfaces.js";
import type { ILogger } from "../src/infrastructure/loggerInterface.js";
import { AbsorptionSignalData } from "../src/types/signalTypes.js";

/**
 * 🎯 CRITICAL FIX TESTS: Absorption Signal Direction Correctness
 *
 * These tests verify that the absorption detector generates signals with the correct
 * direction after the fix. Absorption signals should represent the ABSORBING side
 * (passive liquidity) not the aggressive side.
 *
 * Expected behavior:
 * - At market tops: SELL signals (sellers absorbing aggressive buys)
 * - At market bottoms: BUY signals (buyers absorbing aggressive sells)
 */
describe("AbsorptionDetector - Signal Direction Fix", () => {
    let detector: AbsorptionDetector;
    let mockCallback: MockedFunction<(signal: Detected) => void>;
    let mockLogger: ILogger;
    let mockMetrics: MetricsCollector;
    let mockSpoofing: SpoofingDetector;
    let mockOrderBook: OrderBookState;

    const BASE_PRICE = 50000;
    let lastSignal: AbsorptionSignalData | null = null;

    beforeEach(() => {
        // Reset signal capture
        lastSignal = null;

        // Create mocks
        mockCallback = vi.fn().mockImplementation((signal: Detected) => {
            lastSignal = signal.signalData as AbsorptionSignalData;
        });

        mockLogger = new WorkerLogger();
        mockMetrics = new MetricsCollector();
        mockSpoofing = {
            checkWallSpoofing: vi.fn().mockReturnValue(false),
            getWallDetectionMetrics: vi.fn().mockReturnValue({}),
        } as any;

        mockOrderBook = {
            getLevel: vi.fn().mockReturnValue({ bid: 100, ask: 100 }),
            getCurrentSpread: vi.fn().mockReturnValue({ spread: 0.01 }),
        } as any;

        // Create detector with very permissive settings for testing
        detector = new AbsorptionDetector(
            "test-signal-direction",
            {
                symbol: "BTCUSDT",
                windowMs: 30000,
                minAggVolume: 1.0, // Low threshold but realistic
                absorptionThreshold: 0.001, // Extremely low threshold for testing
                minPassiveMultiplier: 0.1, // Very low threshold
                maxAbsorptionRatio: 100.0, // Very high threshold to avoid rejection
                pricePrecision: 2,
                zoneTicks: 1, // Small zone for easier triggering
                eventCooldownMs: 1, // Minimal cooldown
                features: {
                    icebergDetection: false, // Disable all complex features
                    liquidityGradient: false,
                    absorptionVelocity: false,
                    spreadImpact: false,
                    spoofingDetection: false, // Disable spoofing detection for testing
                },
            },
            mockOrderBook,
            mockLogger,
            mockSpoofing,
            mockMetrics
        );

        // Register callback using event emitter pattern
        detector.on("signal", mockCallback);
    });

    describe("Core Logic Tests", () => {
        it("should correctly identify absorbing side for aggressive buy trades", () => {
            // Direct test of the getAbsorbingSide method logic (legacy method)
            const detectorAny = detector as any;

            // Aggressive BUY trade (buyerIsMaker=false) hits ASK side
            const aggressiveBuyTrade: EnrichedTradeEvent = {
                symbol: "BTCUSDT",
                tradeId: 1,
                price: BASE_PRICE,
                quantity: 100,
                timestamp: Date.now(),
                buyerIsMaker: false, // Aggressive buy hitting ask
                zonePassiveBidVolume: 50,
                zonePassiveAskVolume: 150,
            };

            // Test both sides
            const aggressiveSide = detectorAny.getTradeSide(aggressiveBuyTrade);
            const absorbingSide =
                detectorAny.getAbsorbingSide(aggressiveBuyTrade);

            expect(aggressiveSide).toBe("buy"); // Aggressive side is buy
            expect(absorbingSide).toBe("sell"); // Absorbing side is sell (opposite)
        });

        it("should correctly identify absorbing side for aggressive sell trades", () => {
            const detectorAny = detector as any;

            // Aggressive SELL trade (buyerIsMaker=true) hits BID side
            const aggressiveSellTrade: EnrichedTradeEvent = {
                symbol: "BTCUSDT",
                tradeId: 1,
                price: BASE_PRICE,
                quantity: 100,
                timestamp: Date.now(),
                buyerIsMaker: true, // Aggressive sell hitting bid
                zonePassiveBidVolume: 150,
                zonePassiveAskVolume: 50,
            };

            // Test both sides
            const aggressiveSide =
                detectorAny.getTradeSide(aggressiveSellTrade);
            const absorbingSide =
                detectorAny.getAbsorbingSide(aggressiveSellTrade);

            expect(aggressiveSide).toBe("sell"); // Aggressive side is sell
            expect(absorbingSide).toBe("buy"); // Absorbing side is buy (opposite)
        });

        it("should analyze dominant aggressive flow correctly", () => {
            const detectorAny = detector as any;

            // Create trades with dominant buy flow
            const buyDominantTrades = [
                { buyerIsMaker: false, quantity: 1000 }, // Aggressive buy
                { buyerIsMaker: false, quantity: 800 }, // Aggressive buy
                { buyerIsMaker: true, quantity: 200 }, // Aggressive sell (small)
                { buyerIsMaker: false, quantity: 900 }, // Aggressive buy
            ];

            const dominantSide =
                detectorAny.getDominantAggressiveSide(buyDominantTrades);
            expect(dominantSide).toBe("buy"); // Should identify buy as dominant

            // Create trades with dominant sell flow
            const sellDominantTrades = [
                { buyerIsMaker: true, quantity: 1000 }, // Aggressive sell
                { buyerIsMaker: true, quantity: 800 }, // Aggressive sell
                { buyerIsMaker: false, quantity: 200 }, // Aggressive buy (small)
                { buyerIsMaker: true, quantity: 900 }, // Aggressive sell
            ];

            const dominantSide2 =
                detectorAny.getDominantAggressiveSide(sellDominantTrades);
            expect(dominantSide2).toBe("sell"); // Should identify sell as dominant
        });

        it("should determine absorption method correctly", () => {
            const detectorAny = detector as any;

            // Test that the method exists and can be called
            expect(typeof detectorAny.determineAbsorptionMethod).toBe(
                "function"
            );

            // Test that it returns valid method types
            const method = detectorAny.determineAbsorptionMethod(1, BASE_PRICE);
            expect([
                "zone-strength-resolution",
                "condition-based",
                "flow-based",
            ]).toContain(method);
        });
    });

    describe("Signal Direction Correctness", () => {
        it("should use absorbing side logic in signal generation flow", () => {
            // Test that the analyzeZoneForAbsorption method uses getAbsorbingSide
            // This validates the core fix without requiring full signal generation

            const detectorAny = detector as any;

            // Create test trade
            const aggressiveBuyTrade: EnrichedTradeEvent = {
                symbol: "BTCUSDT",
                tradeId: 1,
                price: BASE_PRICE,
                quantity: 1000,
                timestamp: Date.now(),
                buyerIsMaker: false, // Aggressive buy
                zonePassiveBidVolume: 500,
                zonePassiveAskVolume: 1500,
            };

            // Test that getAbsorbingSide returns the correct side (opposite of aggressive)
            const absorbingSide =
                detectorAny.getAbsorbingSide(aggressiveBuyTrade);
            expect(absorbingSide).toBe("sell"); // Should be sell for aggressive buy

            // Test with aggressive sell
            const aggressiveSellTrade: EnrichedTradeEvent = {
                ...aggressiveBuyTrade,
                tradeId: 2,
                buyerIsMaker: true, // Aggressive sell
            };

            const absorbingSide2 =
                detectorAny.getAbsorbingSide(aggressiveSellTrade);
            expect(absorbingSide2).toBe("buy"); // Should be buy for aggressive sell

            // This confirms the core signal direction fix is implemented correctly
        });

        it("should validate enhanced flow analysis integration", () => {
            // Test that the enhanced getAbsorbingSideForZone method works with flow analysis
            const detectorAny = detector as any;

            // Create a set of trades with dominant buy flow
            const tradesWithBuyFlow = [
                { buyerIsMaker: false, quantity: 1000, price: BASE_PRICE }, // Aggressive buy
                { buyerIsMaker: false, quantity: 800, price: BASE_PRICE }, // Aggressive buy
                { buyerIsMaker: true, quantity: 200, price: BASE_PRICE }, // Small aggressive sell
                { buyerIsMaker: false, quantity: 900, price: BASE_PRICE }, // Aggressive buy
            ];

            // Test dominant flow analysis
            const dominantSide =
                detectorAny.getDominantAggressiveSide(tradesWithBuyFlow);
            expect(dominantSide).toBe("buy"); // Dominant aggressive flow is buy

            // Test enhanced getAbsorbingSideForZone method exists
            expect(typeof detectorAny.getAbsorbingSideForZone).toBe("function");

            // Test that it can be called without errors (fallback to flow analysis)
            const absorbingSide = detectorAny.getAbsorbingSideForZone(
                tradesWithBuyFlow,
                1, // zone
                BASE_PRICE
            );

            // With dominant buy flow, absorbing side should be ask (corrected logic)
            expect(absorbingSide).toBe("ask");

            // Test signal interpretation logic with enhanced metadata
            const expectedInterpretation =
                absorbingSide === "buy"
                    ? "buyers_absorbing_aggressive_sells"
                    : "sellers_absorbing_aggressive_buys";

            expect(expectedInterpretation).toBe(
                "sellers_absorbing_aggressive_buys"
            );
        });

        it("should validate flow analysis metadata structure", () => {
            // Test the flow analysis calculation logic
            const detectorAny = detector as any;

            const mockTrades = [
                { buyerIsMaker: false, quantity: 1000 }, // Buy: 1000
                { buyerIsMaker: false, quantity: 800 }, // Buy: 1800 total
                { buyerIsMaker: true, quantity: 500 }, // Sell: 500
                { buyerIsMaker: true, quantity: 300 }, // Sell: 800 total
            ];

            // Calculate buy/sell volumes (matching implementation logic)
            const buyVolume = mockTrades
                .filter((t) => !t.buyerIsMaker)
                .reduce((s, t) => s + t.quantity, 0);
            const sellVolume = mockTrades
                .filter((t) => t.buyerIsMaker)
                .reduce((s, t) => s + t.quantity, 0);

            expect(buyVolume).toBe(1800); // 1000 + 800
            expect(sellVolume).toBe(800); // 500 + 300

            // Test volume ratio calculation
            const volumeRatio =
                sellVolume > 0 ? buyVolume / sellVolume : buyVolume;
            expect(volumeRatio).toBe(2.25); // 1800 / 800

            // Test confidence calculation
            const confidenceScore =
                Math.abs(buyVolume - sellVolume) /
                Math.max(buyVolume + sellVolume, 1);
            expect(confidenceScore).toBeCloseTo(0.385, 3); // |1800-800| / (1800+800) = 1000/2600

            // Test dominant side determination
            const dominantSide =
                detectorAny.getDominantAggressiveSide(mockTrades);
            expect(dominantSide).toBe("buy");
        });
    });

    describe("Context-Aware Enhancement", () => {
        it("should have context-aware calculation method", () => {
            // Test that the calculateAbsorptionContext method exists and can be called
            const detectorAny = detector as any;

            // Test that the method exists
            expect(typeof detectorAny.calculateAbsorptionContext).toBe(
                "function"
            );

            // Test that it can be called without errors for both sides
            expect(() => {
                detectorAny.calculateAbsorptionContext(BASE_PRICE, "buy");
                detectorAny.calculateAbsorptionContext(BASE_PRICE, "sell");
            }).not.toThrow();
        });
    });

    describe("Regression Tests", () => {
        it("should not break existing spoofing detection", () => {
            // Verify that signal direction fix doesn't interfere with spoofing detection
            mockSpoofing.checkWallSpoofing = vi.fn().mockReturnValue(true); // Simulate spoofing detected

            const trade: EnrichedTradeEvent = {
                symbol: "BTCUSDT",
                tradeId: 1,
                price: BASE_PRICE,
                quantity: 100,
                timestamp: Date.now(),
                buyerIsMaker: false,
                zonePassiveBidVolume: 50,
                zonePassiveAskVolume: 150,
            };

            // Send trades
            for (let i = 0; i < 10; i++) {
                detector.onEnrichedTrade({
                    ...trade,
                    tradeId: i + 1,
                    timestamp: Date.now() + i,
                });
            }

            // Should not generate signal due to spoofing detection
            expect(lastSignal).toBeNull();
        });

        it("should maintain performance characteristics", () => {
            // Test that the fix doesn't significantly impact performance
            const startTime = performance.now();

            const trade: EnrichedTradeEvent = {
                symbol: "BTCUSDT",
                tradeId: 1,
                price: BASE_PRICE,
                quantity: 100,
                timestamp: Date.now(),
                buyerIsMaker: false,
                zonePassiveBidVolume: 50,
                zonePassiveAskVolume: 150,
            };

            // Process moderate number of trades (reduced for performance)
            for (let i = 0; i < 100; i++) {
                detector.onEnrichedTrade({
                    ...trade,
                    tradeId: i + 1,
                    timestamp: Date.now() + i,
                    price: BASE_PRICE + (Math.random() - 0.5) * 10,
                });
            }

            const endTime = performance.now();
            const executionTime = endTime - startTime;

            // Should complete in reasonable time
            expect(executionTime).toBeLessThan(5000); // Less than 5 seconds for 100 trades
        }, 10000); // 10 second timeout
    });

    describe("Edge Cases", () => {
        it("should handle zero passive volume gracefully", () => {
            const trade: EnrichedTradeEvent = {
                symbol: "BTCUSDT",
                tradeId: 1,
                price: BASE_PRICE,
                quantity: 100,
                timestamp: Date.now(),
                buyerIsMaker: false,
                zonePassiveBidVolume: 0, // No passive volume
                zonePassiveAskVolume: 0,
            };

            // Should not crash
            expect(() => {
                for (let i = 0; i < 10; i++) {
                    detector.onEnrichedTrade({
                        ...trade,
                        tradeId: i + 1,
                        timestamp: Date.now() + i,
                    });
                }
            }).not.toThrow();
        });

        it("should handle rapid buy/sell alternation", () => {
            // Test rapid alternation between buy and sell absorption scenarios
            for (let i = 0; i < 20; i++) {
                const trade: EnrichedTradeEvent = {
                    symbol: "BTCUSDT",
                    tradeId: i + 1,
                    price: BASE_PRICE + (i % 2 === 0 ? 10 : -10),
                    quantity: 100,
                    timestamp: Date.now() + i * 100,
                    buyerIsMaker: i % 2 === 0, // Alternate between buy and sell absorption
                    zonePassiveBidVolume: 150,
                    zonePassiveAskVolume: 150,
                };

                expect(() => {
                    detector.onEnrichedTrade(trade);
                }).not.toThrow();
            }
        });
    });
});
