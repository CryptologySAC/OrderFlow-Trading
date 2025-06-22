import { describe, it, expect, beforeEach, vi } from "vitest";
import { HiddenOrderDetector } from "../src/services/hiddenOrderDetector.js";
import type {
    EnrichedTradeEvent,
    PassiveLevel,
} from "../src/types/marketEvents.js";
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
            minHiddenVolume: 10,
            minTradeSize: 5,
            priceTolerance: 0.0001,
            maxDepthAgeMs: 1000,
            minConfidence: 0.8,
            zoneHeightPercentage: 0.002,
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
        it("should detect hidden orders when executed volume exceeds visible liquidity", () => {
            const baseTime = Date.now();
            const price = 100.0;

            // Create depth snapshot with limited visible liquidity
            const depthSnapshot = new Map<number, PassiveLevel>();
            depthSnapshot.set(price, {
                price,
                bid: 20, // Only 20 visible on bid
                ask: 15, // Only 15 visible on ask
                timestamp: baseTime,
            });

            // Market buy order that executes 50 LTC but only 15 was visible
            const trade: EnrichedTradeEvent = {
                symbol: "LTCUSDT",
                price,
                quantity: 50, // Executed 50
                timestamp: baseTime,
                buyerIsMaker: false, // Market buy order
                tradeId: "1000",
                pair: "LTCUSDT",
                originalTrade: {} as any,
                passiveBidVolume: 20,
                passiveAskVolume: 15,
                zonePassiveBidVolume: 20,
                zonePassiveAskVolume: 15,
                depthSnapshot,
                bestBid: 99.99,
                bestAsk: 100.01,
            };

            detector.onEnrichedTrade(trade);

            // Should detect hidden order: 50 executed - 15 visible = 35 hidden
            const detectedOrders = detector.getDetectedHiddenOrders();
            expect(detectedOrders.length).toBe(1);

            const hiddenOrder = detectedOrders[0];
            expect(hiddenOrder.side).toBe("buy");
            expect(hiddenOrder.executedVolume).toBe(50);
            expect(hiddenOrder.visibleVolume).toBe(15);
            expect(hiddenOrder.hiddenVolume).toBe(35);
            expect(hiddenOrder.hiddenPercentage).toBe(0.7); // 35/50
            expect(hiddenOrder.confidence).toBeGreaterThan(0.7);
        });

        it("should not detect when executed volume equals visible liquidity", () => {
            const baseTime = Date.now();
            const price = 100.0;

            // Create depth snapshot with sufficient visible liquidity
            const depthSnapshot = new Map<number, PassiveLevel>();
            depthSnapshot.set(price, {
                price,
                bid: 50,
                ask: 50, // Enough visible liquidity
                timestamp: baseTime,
            });

            // Market buy order that executes exactly what was visible
            const trade: EnrichedTradeEvent = {
                symbol: "LTCUSDT",
                price,
                quantity: 25, // Less than visible ask (50)
                timestamp: baseTime,
                buyerIsMaker: false,
                tradeId: "1001",
                pair: "LTCUSDT",
                originalTrade: {} as any,
                passiveBidVolume: 50,
                passiveAskVolume: 50,
                zonePassiveBidVolume: 50,
                zonePassiveAskVolume: 50,
                depthSnapshot,
                bestBid: 99.99,
                bestAsk: 100.01,
            };

            detector.onEnrichedTrade(trade);

            // Should not detect hidden order
            const detectedOrders = detector.getDetectedHiddenOrders();
            expect(detectedOrders.length).toBe(0);
        });

        it("should handle market sell orders correctly", () => {
            const baseTime = Date.now();
            const price = 100.0;

            // Create depth snapshot
            const depthSnapshot = new Map<number, PassiveLevel>();
            depthSnapshot.set(price, {
                price,
                bid: 10, // Only 10 visible on bid
                ask: 40,
                timestamp: baseTime,
            });

            // Market sell order hitting bids
            const trade: EnrichedTradeEvent = {
                symbol: "LTCUSDT",
                price,
                quantity: 60, // Executed 60 but only 10 visible on bid
                timestamp: baseTime,
                buyerIsMaker: true, // Market sell order (seller is taker, buyer is maker)
                tradeId: "1002",
                pair: "LTCUSDT",
                originalTrade: {} as any,
                passiveBidVolume: 10,
                passiveAskVolume: 40,
                zonePassiveBidVolume: 10,
                zonePassiveAskVolume: 40,
                depthSnapshot,
                bestBid: 99.99,
                bestAsk: 100.01,
            };

            detector.onEnrichedTrade(trade);

            // Should detect hidden order on sell side
            const detectedOrders = detector.getDetectedHiddenOrders();
            expect(detectedOrders.length).toBe(1);

            const hiddenOrder = detectedOrders[0];
            expect(hiddenOrder.side).toBe("sell");
            expect(hiddenOrder.executedVolume).toBe(60);
            expect(hiddenOrder.visibleVolume).toBe(10);
            expect(hiddenOrder.hiddenVolume).toBe(50);
        });

        it("should not detect when hidden volume is below minimum threshold", () => {
            const baseTime = Date.now();
            const price = 100.0;

            const depthSnapshot = new Map<number, PassiveLevel>();
            depthSnapshot.set(price, {
                price,
                bid: 20,
                ask: 18, // Close to executed volume
                timestamp: baseTime,
            });

            // Small hidden volume (below 10 threshold)
            const trade: EnrichedTradeEvent = {
                symbol: "LTCUSDT",
                price,
                quantity: 25, // Only 7 hidden (25-18)
                timestamp: baseTime,
                buyerIsMaker: false,
                tradeId: "1003",
                pair: "LTCUSDT",
                originalTrade: {} as any,
                passiveBidVolume: 20,
                passiveAskVolume: 18,
                zonePassiveBidVolume: 20,
                zonePassiveAskVolume: 18,
                depthSnapshot,
                bestBid: 99.99,
                bestAsk: 100.01,
            };

            detector.onEnrichedTrade(trade);

            // Should not detect due to small hidden volume
            const detectedOrders = detector.getDetectedHiddenOrders();
            expect(detectedOrders.length).toBe(0);
        });

        it("should not detect when trade size is below minimum", () => {
            const baseTime = Date.now();
            const price = 100.0;

            const depthSnapshot = new Map<number, PassiveLevel>();
            depthSnapshot.set(price, {
                price,
                bid: 10,
                ask: 0, // No visible liquidity
                timestamp: baseTime,
            });

            // Small trade size (below 5 threshold)
            const trade: EnrichedTradeEvent = {
                symbol: "LTCUSDT",
                price,
                quantity: 3, // Below minTradeSize
                timestamp: baseTime,
                buyerIsMaker: false,
                tradeId: "1004",
                pair: "LTCUSDT",
                originalTrade: {} as any,
                passiveBidVolume: 10,
                passiveAskVolume: 0,
                zonePassiveBidVolume: 10,
                zonePassiveAskVolume: 0,
                depthSnapshot,
                bestBid: 99.99,
                bestAsk: 100.01,
            };

            detector.onEnrichedTrade(trade);

            // Should not detect due to small trade size
            const detectedOrders = detector.getDetectedHiddenOrders();
            expect(detectedOrders.length).toBe(0);
        });

        it("should require depth snapshot to analyze", () => {
            const baseTime = Date.now();
            const price = 100.0;

            // Trade without depth snapshot
            const trade: EnrichedTradeEvent = {
                symbol: "LTCUSDT",
                price,
                quantity: 50,
                timestamp: baseTime,
                buyerIsMaker: false,
                tradeId: "1005",
                pair: "LTCUSDT",
                originalTrade: {} as any,
                passiveBidVolume: 0,
                passiveAskVolume: 0,
                zonePassiveBidVolume: 0,
                zonePassiveAskVolume: 0,
                // No depthSnapshot
                bestBid: 99.99,
                bestAsk: 100.01,
            };

            detector.onEnrichedTrade(trade);

            // Should not detect without depth data
            const detectedOrders = detector.getDetectedHiddenOrders();
            expect(detectedOrders.length).toBe(0);
        });

        it("should handle price tolerance for order book matching", () => {
            const baseTime = Date.now();
            const price = 100.0;

            const depthSnapshot = new Map<number, PassiveLevel>();
            depthSnapshot.set(price, {
                price,
                bid: 30,
                ask: 5, // Limited ask liquidity
                timestamp: baseTime,
            });

            const trade: EnrichedTradeEvent = {
                symbol: "LTCUSDT",
                price,
                quantity: 50, // Larger trade for higher confidence
                timestamp: baseTime,
                buyerIsMaker: false,
                tradeId: "1006",
                pair: "LTCUSDT",
                originalTrade: {} as any,
                passiveBidVolume: 30,
                passiveAskVolume: 5,
                zonePassiveBidVolume: 30,
                zonePassiveAskVolume: 5,
                depthSnapshot,
                bestBid: 99.99,
                bestAsk: 100.01,
            };

            detector.onEnrichedTrade(trade);

            // Should find nearby price level within tolerance
            const detectedOrders = detector.getDetectedHiddenOrders();
            expect(detectedOrders.length).toBe(1);

            const hiddenOrder = detectedOrders[0];
            expect(hiddenOrder.hiddenVolume).toBe(45); // 50 - 5 (visible ask)
        });
    });

    describe("Zone Emission", () => {
        it("should emit zone events when hidden order is detected", () => {
            const mockEmit = vi.fn();
            detector.emit = mockEmit;

            const baseTime = Date.now();
            const price = 100.0;

            const depthSnapshot = new Map<number, PassiveLevel>();
            depthSnapshot.set(price, {
                price,
                bid: 30,
                ask: 10,
                timestamp: baseTime,
            });

            const trade: EnrichedTradeEvent = {
                symbol: "LTCUSDT",
                price,
                quantity: 60, // Large hidden volume
                timestamp: baseTime,
                buyerIsMaker: false,
                tradeId: "1007",
                pair: "LTCUSDT",
                originalTrade: {} as any,
                passiveBidVolume: 30,
                passiveAskVolume: 10,
                zonePassiveBidVolume: 30,
                zonePassiveAskVolume: 10,
                depthSnapshot,
                bestBid: 99.99,
                bestAsk: 100.01,
            };

            detector.onEnrichedTrade(trade);

            // Should emit zoneUpdated event
            expect(mockEmit).toHaveBeenCalledWith(
                "zoneUpdated",
                expect.objectContaining({
                    updateType: "zone_created",
                    zone: expect.objectContaining({
                        type: "hidden_liquidity",
                        priceRange: expect.objectContaining({
                            min: expect.any(Number),
                            max: expect.any(Number),
                        }),
                        executedVolume: 60,
                        visibleVolume: 10,
                        hiddenVolume: 50,
                        side: "buy",
                        completion: 1.0,
                    }),
                    significance: "high", // High confidence should result in high significance
                })
            );
        });
    });

    describe("Statistics and Status", () => {
        it("should provide accurate statistics", () => {
            const stats = detector.getStatistics();

            expect(stats).toEqual({
                totalHiddenOrders: 0,
                avgHiddenVolume: 0,
                avgHiddenPercentage: 0,
                avgConfidence: 0,
                totalHiddenVolumeDetected: 0,
                detectionsByConfidence: {
                    high: 0,
                    medium: 0,
                    low: 0,
                },
            });
        });

        it("should provide status string", () => {
            const status = detector.getStatus();
            expect(status).toContain("Detected:");
            expect(status).toContain("hidden orders");
            expect(status).toContain("avg hidden:");
        });

        it("should calculate statistics after detections", () => {
            const baseTime = Date.now();
            const price = 100.0;

            const depthSnapshot = new Map<number, PassiveLevel>();
            depthSnapshot.set(price, {
                price,
                bid: 20,
                ask: 5,
                timestamp: baseTime,
            });

            // Create multiple hidden orders
            for (let i = 0; i < 3; i++) {
                const trade: EnrichedTradeEvent = {
                    symbol: "LTCUSDT",
                    price,
                    quantity: 50 + i * 20, // Larger trades to meet confidence thresholds
                    timestamp: baseTime + i * 1000,
                    buyerIsMaker: false,
                    tradeId: `100${i}`,
                    pair: "LTCUSDT",
                    originalTrade: {} as any,
                    passiveBidVolume: 20,
                    passiveAskVolume: 5,
                    zonePassiveBidVolume: 20,
                    zonePassiveAskVolume: 5,
                    depthSnapshot,
                    bestBid: 99.99,
                    bestAsk: 100.01,
                };

                detector.onEnrichedTrade(trade);
            }

            const stats = detector.getStatistics();
            expect(stats.totalHiddenOrders).toBeGreaterThanOrEqual(2); // At least 2 should pass confidence thresholds
            expect(stats.avgHiddenVolume).toBeGreaterThan(0);
            expect(stats.totalHiddenVolumeDetected).toBeGreaterThan(0);
        });
    });

    describe("Data Cleanup", () => {
        it("should clean up old events", () => {
            const baseTime = Date.now();
            const price = 100.0;

            const depthSnapshot = new Map<number, PassiveLevel>();
            depthSnapshot.set(price, {
                price,
                bid: 20,
                ask: 5,
                timestamp: baseTime,
            });

            // Add some data
            const trade: EnrichedTradeEvent = {
                symbol: "LTCUSDT",
                price,
                quantity: 30,
                timestamp: baseTime,
                buyerIsMaker: false,
                tradeId: "1000",
                pair: "LTCUSDT",
                originalTrade: {} as any,
                passiveBidVolume: 20,
                passiveAskVolume: 5,
                zonePassiveBidVolume: 20,
                zonePassiveAskVolume: 5,
                depthSnapshot,
                bestBid: 99.99,
                bestAsk: 100.01,
            };

            detector.onEnrichedTrade(trade);

            // Verify detection
            expect(detector.getDetectedHiddenOrders().length).toBe(1);

            // Advance time beyond cleanup window (5 minutes)
            vi.advanceTimersByTime(350000); // 5.8 minutes

            // Data should be cleaned up
            const remainingOrders = detector.getDetectedHiddenOrders();
            expect(remainingOrders.length).toBe(0);
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
                depthSnapshot: undefined,
            } as any;

            // Should not throw error
            expect(() => {
                detector.onEnrichedTrade(invalidTrade);
            }).not.toThrow();

            // Should not create detections
            const detectedOrders = detector.getDetectedHiddenOrders();
            expect(detectedOrders.length).toBe(0);
        });

        it("should handle stale depth snapshots", () => {
            const baseTime = Date.now();
            const price = 100.0;

            // Create stale depth snapshot
            const depthSnapshot = new Map<number, PassiveLevel>();
            depthSnapshot.set(price, {
                price,
                bid: 20,
                ask: 5,
                timestamp: baseTime - 2000, // 2 seconds old (exceeds 1 second limit)
            });

            const trade: EnrichedTradeEvent = {
                symbol: "LTCUSDT",
                price,
                quantity: 30,
                timestamp: baseTime,
                buyerIsMaker: false,
                tradeId: "1000",
                pair: "LTCUSDT",
                originalTrade: {} as any,
                passiveBidVolume: 20,
                passiveAskVolume: 5,
                zonePassiveBidVolume: 20,
                zonePassiveAskVolume: 5,
                depthSnapshot,
                bestBid: 99.99,
                bestAsk: 100.01,
            };

            detector.onEnrichedTrade(trade);

            // Should not detect due to stale depth data
            const detectedOrders = detector.getDetectedHiddenOrders();
            expect(detectedOrders.length).toBe(0);
        });
    });
});
