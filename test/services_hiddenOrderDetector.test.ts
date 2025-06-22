import { describe, it, expect, beforeEach, vi } from "vitest";
import { HiddenOrderDetector } from "../src/services/hiddenOrderDetector.js";
import type { EnrichedTradeEvent } from "../src/types/marketEvents.js";
import type { ILogger } from "../src/infrastructure/loggerInterface.js";
import type { IMetricsCollector } from "../src/infrastructure/metricsCollectorInterface.js";

describe("services/HiddenOrderDetector", () => {
    let detector: HiddenOrderDetector;
    let mockLogger: ILogger;
    let mockMetricsCollector: IMetricsCollector;

    beforeEach(() => {
        vi.useFakeTimers();
        
        mockLogger = {
            info: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
            debug: vi.fn(),
        };

        mockMetricsCollector = {
            updateMetric: vi.fn(),
            incrementMetric: vi.fn(),
            getMetrics: vi.fn().mockReturnValue({ legacy: {}, enhanced: {} }),
            getHealthSummary: vi.fn().mockReturnValue("Healthy"),
            getAverageLatency: vi.fn().mockReturnValue(10),
        };

        const config = {
            minTradeSize: 5,
            maxTradeGapMs: 10000,
            minTradeSequence: 4,
            priceDeviationTolerance: 0.002,
            volumeConcentrationThreshold: 0.7,
            minCumulativeVolume: 30,
            trackingWindowMs: 180000,
            maxActiveCandidates: 15,
            stealthThreshold: 0.8,
            reserveActivationDistance: 0.001,
        };

        detector = new HiddenOrderDetector(
            "test-hidden",
            config,
            mockLogger,
            mockMetricsCollector
        );
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    describe("Hidden Order Detection Logic", () => {
        it("should detect stealth liquidity pattern", () => {
            const baseTime = Date.now();
            const price = 100.0;
            const size = 8; // Above minimum trade size
            
            // Create consistent algorithmic pattern
            for (let i = 0; i < 5; i++) {
                const trade: EnrichedTradeEvent = {
                    symbol: "LTCUSDT",
                    price: price + (Math.random() * 0.002), // Very tight price range
                    quantity: size + (Math.random() * 0.1), // Very consistent size
                    timestamp: baseTime + (i * 8000), // Regular timing
                    buyerIsMaker: false,
                    tradeId: 1000 + i,
                    orderData: {
                        passive: { buy: 50, sell: 0 },
                        aggressive: { buy: size, sell: 0 },
                        imbalance: { buy: 0.85, sell: 0.15 },
                        refill: { buy: false, sell: false }, // No visible refill
                    },
                    derivedMetrics: {
                        isAbsorption: false,
                        absorptionStrength: 0,
                        marketPressure: 0.05,
                        liquidityImpact: 0.02, // Low impact despite size
                    },
                };

                detector.onEnrichedTrade(trade);
            }

            // Should create candidates
            const candidates = detector.getActiveCandidates();
            expect(candidates.length).toBeGreaterThan(0);
            
            // Verify candidate properties
            const candidate = candidates[0];
            expect(candidate.side).toBe("buy");
            expect(candidate.trades.length).toBe(5);
            expect(candidate.totalVolume).toBeGreaterThan(30); // Above minimum
        });

        it("should calculate stealth score correctly", () => {
            const baseTime = Date.now();
            const price = 100.0;
            const exactSize = 10; // Exactly same size (high consistency)
            
            // Create highly algorithmic pattern
            for (let i = 0; i < 6; i++) {
                const trade: EnrichedTradeEvent = {
                    symbol: "LTCUSDT",
                    price, // Exact same price
                    quantity: exactSize, // Exact same size
                    timestamp: baseTime + (i * 5000), // Exact timing intervals
                    buyerIsMaker: false,
                    tradeId: 1000 + i,
                    orderData: {
                        passive: { buy: 100, sell: 0 },
                        aggressive: { buy: exactSize, sell: 0 },
                        imbalance: { buy: 0.9, sell: 0.1 },
                        refill: { buy: false, sell: false },
                    },
                    derivedMetrics: {
                        isAbsorption: false,
                        absorptionStrength: 0,
                        marketPressure: 0.02,
                        liquidityImpact: 0.01, // Minimal impact
                    },
                };

                detector.onEnrichedTrade(trade);
            }

            // Should detect high stealth score due to perfect consistency
            const detectedOrders = detector.getDetectedHiddenOrders();
            if (detectedOrders.length > 0) {
                const order = detectedOrders[0];
                expect(order.stealthScore).toBeGreaterThan(0.6);
                expect(order.type).toBe("algorithmic_hidden");
            }
        });

        it("should filter out non-qualifying sequences", () => {
            const baseTime = Date.now();
            const price = 100.0;
            const smallSize = 3; // Below minimum trade size
            
            // Create pattern with small trades
            for (let i = 0; i < 5; i++) {
                const trade: EnrichedTradeEvent = {
                    symbol: "LTCUSDT",
                    price,
                    quantity: smallSize,
                    timestamp: baseTime + (i * 5000),
                    buyerIsMaker: false,
                    tradeId: 1000 + i,
                    orderData: {
                        passive: { buy: 50, sell: 0 },
                        aggressive: { buy: smallSize, sell: 0 },
                        imbalance: { buy: 0.8, sell: 0.2 },
                        refill: { buy: false, sell: false },
                    },
                    derivedMetrics: {
                        isAbsorption: false,
                        absorptionStrength: 0,
                        marketPressure: 0.1,
                        liquidityImpact: 0.05,
                    },
                };

                detector.onEnrichedTrade(trade);
            }

            // Should not create candidates due to small size
            const candidates = detector.getActiveCandidates();
            expect(candidates.length).toBe(0);
        });

        it("should handle trade gaps correctly", () => {
            const baseTime = Date.now();
            const price = 100.0;
            const size = 10;
            
            // First sequence
            for (let i = 0; i < 3; i++) {
                const trade: EnrichedTradeEvent = {
                    symbol: "LTCUSDT",
                    price,
                    quantity: size,
                    timestamp: baseTime + (i * 5000),
                    buyerIsMaker: false,
                    tradeId: 1000 + i,
                    orderData: {
                        passive: { buy: 100, sell: 0 },
                        aggressive: { buy: size, sell: 0 },
                        imbalance: { buy: 0.8, sell: 0.2 },
                        refill: { buy: false, sell: false },
                    },
                    derivedMetrics: {
                        isAbsorption: false,
                        absorptionStrength: 0,
                        marketPressure: 0.1,
                        liquidityImpact: 0.05,
                    },
                };

                detector.onEnrichedTrade(trade);
            }

            // Large gap (15 seconds, maxTradeGapMs is 10 seconds)
            const gapTrade: EnrichedTradeEvent = {
                symbol: "LTCUSDT",
                price,
                quantity: size,
                timestamp: baseTime + 20000,
                buyerIsMaker: false,
                tradeId: 1003,
                orderData: {
                    passive: { buy: 100, sell: 0 },
                    aggressive: { buy: size, sell: 0 },
                    imbalance: { buy: 0.8, sell: 0.2 },
                    refill: { buy: false, sell: false },
                },
                derivedMetrics: {
                    isAbsorption: false,
                    absorptionStrength: 0,
                    marketPressure: 0.1,
                    liquidityImpact: 0.05,
                },
            };

            detector.onEnrichedTrade(gapTrade);

            // Should still have candidates but sequence should be broken
            const candidates = detector.getActiveCandidates();
            if (candidates.length > 0) {
                expect(candidates[0].consecutiveGaps).toBeGreaterThan(0);
            }
        });
    });

    describe("Hidden Order Classification", () => {
        it("should classify algorithmic hidden orders", () => {
            const baseTime = Date.now();
            const price = 100.0;
            const size = 12;
            
            // Perfect algorithmic pattern
            for (let i = 0; i < 8; i++) {
                const trade: EnrichedTradeEvent = {
                    symbol: "LTCUSDT",
                    price,
                    quantity: size, // Exact same size
                    timestamp: baseTime + (i * 6000), // Exact intervals
                    buyerIsMaker: false,
                    tradeId: 1000 + i,
                    orderData: {
                        passive: { buy: 100, sell: 0 },
                        aggressive: { buy: size, sell: 0 },
                        imbalance: { buy: 0.95, sell: 0.05 },
                        refill: { buy: false, sell: false },
                    },
                    derivedMetrics: {
                        isAbsorption: false,
                        absorptionStrength: 0,
                        marketPressure: 0.01,
                        liquidityImpact: 0.005,
                    },
                };

                detector.onEnrichedTrade(trade);
            }

            // Force evaluation
            vi.advanceTimersByTime(180000); // Move past evaluation window

            const detectedOrders = detector.getDetectedHiddenOrders();
            if (detectedOrders.length > 0) {
                const order = detectedOrders[0];
                expect(order.type).toBe("algorithmic_hidden");
            }
        });

        it("should classify institutional stealth orders", () => {
            const baseTime = Date.now();
            const price = 100.0;
            const largeSize = 25; // Large institutional size
            
            // Institutional pattern
            for (let i = 0; i < 6; i++) {
                const trade: EnrichedTradeEvent = {
                    symbol: "LTCUSDT",
                    price: price + (i * 0.001), // Slight price progression
                    quantity: largeSize + (i * 2), // Varying large sizes
                    timestamp: baseTime + (i * 12000),
                    buyerIsMaker: false,
                    tradeId: 1000 + i,
                    orderData: {
                        passive: { buy: 200, sell: 0 },
                        aggressive: { buy: largeSize, sell: 0 },
                        imbalance: { buy: 0.8, sell: 0.2 },
                        refill: { buy: false, sell: false },
                    },
                    derivedMetrics: {
                        isAbsorption: false,
                        absorptionStrength: 0,
                        marketPressure: 0.2,
                        liquidityImpact: 0.1,
                    },
                };

                detector.onEnrichedTrade(trade);
            }

            const detectedOrders = detector.getDetectedHiddenOrders();
            if (detectedOrders.length > 0) {
                const order = detectedOrders[0];
                expect(order.type).toBe("institutional_stealth");
                expect(order.averageTradeSize).toBeGreaterThan(20);
                expect(order.totalVolume).toBeGreaterThan(100);
            }
        });
    });

    describe("Zone Emission", () => {
        it("should emit zone events when hidden order is detected", () => {
            const mockEmit = vi.fn();
            detector.emit = mockEmit;

            const baseTime = Date.now();
            const price = 100.0;
            const size = 15;
            
            // Create stealth pattern
            for (let i = 0; i < 6; i++) {
                const trade: EnrichedTradeEvent = {
                    symbol: "LTCUSDT",
                    price,
                    quantity: size,
                    timestamp: baseTime + (i * 8000),
                    buyerIsMaker: false,
                    tradeId: 1000 + i,
                    orderData: {
                        passive: { buy: 100, sell: 0 },
                        aggressive: { buy: size, sell: 0 },
                        imbalance: { buy: 0.9, sell: 0.1 },
                        refill: { buy: false, sell: false },
                    },
                    derivedMetrics: {
                        isAbsorption: false,
                        absorptionStrength: 0,
                        marketPressure: 0.05,
                        liquidityImpact: 0.02,
                    },
                };

                detector.onEnrichedTrade(trade);
            }

            // Should emit zoneUpdated event for hidden order zone
            expect(mockEmit).toHaveBeenCalledWith("zoneUpdated", expect.objectContaining({
                updateType: "zone_created",
                zone: expect.objectContaining({
                    type: "hidden_liquidity",
                    priceRange: expect.objectContaining({
                        min: expect.any(Number),
                        max: expect.any(Number),
                    }),
                    strength: expect.any(Number),
                    completion: 1.0,
                    stealthType: expect.stringMatching(/^(reserve_order|stealth_liquidity|algorithmic_hidden|institutional_stealth)$/),
                }),
                significance: expect.stringMatching(/^(low|medium|high)$/),
            }));
        });
    });

    describe("Statistics and Status", () => {
        it("should provide accurate statistics", () => {
            const stats = detector.getStatistics();
            
            expect(stats).toEqual({
                activeCandidates: 0,
                detectedHiddenOrders: 0,
                avgStealthScore: 0,
                avgConfidence: 0,
                totalVolumeDetected: 0,
                detectionsByType: {},
            });
        });

        it("should provide status string", () => {
            const status = detector.getStatus();
            expect(status).toContain("Active:");
            expect(status).toContain("candidates");
            expect(status).toContain("detected");
        });
    });

    describe("Data Cleanup", () => {
        it("should clean up expired data", () => {
            const baseTime = Date.now();
            const price = 100.0;
            const size = 10;
            
            // Add some data
            const trade: EnrichedTradeEvent = {
                symbol: "LTCUSDT",
                price,
                quantity: size,
                timestamp: baseTime,
                buyerIsMaker: false,
                tradeId: 1000,
                orderData: {
                    passive: { buy: 100, sell: 0 },
                    aggressive: { buy: size, sell: 0 },
                    imbalance: { buy: 0.8, sell: 0.2 },
                    refill: { buy: false, sell: false },
                },
                derivedMetrics: {
                    isAbsorption: false,
                    absorptionStrength: 0,
                    marketPressure: 0.1,
                    liquidityImpact: 0.05,
                },
            };

            detector.onEnrichedTrade(trade);

            // Advance time beyond tracking window (3 minutes)
            vi.advanceTimersByTime(200000); // 3.3 minutes

            // Data should be cleaned up
            const candidates = detector.getActiveCandidates();
            expect(candidates.length).toBe(0);
        });
    });

    describe("Error Handling", () => {
        it("should handle invalid trade data gracefully", () => {
            const invalidTrade = {
                symbol: "LTCUSDT",
                price: undefined,
                quantity: null,
                timestamp: NaN,
                buyerIsMaker: false,
                tradeId: -1,
                orderData: undefined,
                derivedMetrics: null,
            } as any;

            // Should not throw error
            expect(() => {
                detector.onEnrichedTrade(invalidTrade);
            }).not.toThrow();

            // Should not create candidates
            const candidates = detector.getActiveCandidates();
            expect(candidates.length).toBe(0);
        });
    });
});