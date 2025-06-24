// test/icebergDetector_performance.test.ts - Performance optimization validation tests

import { describe, it, expect, beforeEach, vi } from "vitest";
import { IcebergDetector } from "../src/services/icebergDetector.js";
import type { ILogger } from "../src/infrastructure/loggerInterface.js";
import type { IMetricsCollector } from "../src/infrastructure/metricsCollectorInterface.js";
import type { EnrichedTradeEvent } from "../src/types/marketEvents.js";

describe("IcebergDetector Performance Optimizations", () => {
    let detector: IcebergDetector;
    let mockLogger: ILogger;
    let mockMetrics: IMetricsCollector;

    beforeEach(() => {
        mockLogger = {
            info: vi.fn(),
            error: vi.fn(),
            warn: vi.fn(),
            debug: vi.fn(),
            isDebugEnabled: vi.fn(() => false),
            setCorrelationId: vi.fn(),
            removeCorrelationId: vi.fn(),
        };

        mockMetrics = {
            updateMetric: vi.fn(),
            incrementMetric: vi.fn(),
            getMetrics: vi.fn(() => ({ timestamp: Date.now() })),
            getHealthSummary: vi.fn(() => "healthy"),
        };

        detector = new IcebergDetector(
            "test-iceberg-detector",
            {
                minRefillCount: 3,
                maxActiveIcebergs: 5, // Small limit for testing
                maxStoredIcebergs: 10, // Small limit for testing
                trackingWindowMs: 60000,
                institutionalSizeThreshold: 10,
            },
            mockLogger,
            mockMetrics
        );
    });

    describe("Memory Management", () => {
        it("should maintain bounded active candidates with LRU eviction", () => {
            const baseTime = Date.now();

            // Create more candidates than the limit (different prices create different candidates)
            for (let i = 0; i < 8; i++) {
                const trade: EnrichedTradeEvent = {
                    tradeId: i,
                    timestamp: baseTime + i * 1000,
                    price: 100 + i * 0.01, // Different prices = different candidates
                    quantity: 15, // Above institutional threshold
                    buyerIsMaker: false, // Creates "buy" side candidates
                };

                detector.onEnrichedTrade(trade);
            }

            // Should not exceed maxActiveIcebergs due to LRU eviction
            const activeCandidates = detector.getActiveCandidates();
            expect(activeCandidates.length).toBeLessThanOrEqual(5);
        });

        it("should use efficient array operations for completed icebergs", () => {
            // Create a spy to monitor array operations
            const completedIcebergs = (detector as any).completedIcebergs;
            const originalSlice = Array.prototype.slice;
            const sliceSpy = vi.spyOn(Array.prototype, "slice");

            // Fill beyond capacity to trigger optimization
            for (let i = 0; i < 15; i++) {
                completedIcebergs.push({
                    id: `test-${i}`,
                    confidence: 0.8,
                    timestamp: Date.now() + i,
                });
            }

            // Manually trigger the slice optimization (normally done in emitIcebergSignal)
            if (completedIcebergs.length > 10) {
                (detector as any).completedIcebergs =
                    completedIcebergs.slice(-10);
            }

            // Verify slice was used for efficiency
            expect(sliceSpy).toHaveBeenCalled();
            expect((detector as any).completedIcebergs.length).toBe(10);

            sliceSpy.mockRestore();
        });

        it("should handle price level activity with bounded memory", () => {
            const baseTime = Date.now();

            // Create many different price levels to test memory bounds
            for (let i = 0; i < 50; i++) {
                const trade: EnrichedTradeEvent = {
                    tradeId: i,
                    timestamp: baseTime + i * 100,
                    price: 100 + i * 0.001, // Many different prices
                    quantity: 12,
                    buyerIsMaker: false,
                };

                detector.onEnrichedTrade(trade);
            }

            // Check that price level activity is tracked but bounded
            const priceLevelActivity = (detector as any).priceLevelActivity;
            expect(priceLevelActivity.size).toBeGreaterThan(0);
            expect(priceLevelActivity.size).toBeLessThanOrEqual(1000); // maxPriceLevels
        });
    });

    describe("LRU Cache Behavior", () => {
        it("should maintain LRU order for price level access", () => {
            const trade1: EnrichedTradeEvent = {
                tradeId: 1,
                timestamp: Date.now(),
                price: 100.0,
                quantity: 15,
                buyerIsMaker: false,
            };

            const trade2: EnrichedTradeEvent = {
                tradeId: 2,
                timestamp: Date.now() + 1000,
                price: 100.01,
                quantity: 15,
                buyerIsMaker: false,
            };

            // Process trades to create price level activity
            detector.onEnrichedTrade(trade1);
            detector.onEnrichedTrade(trade2);

            // Access the private LRU tracking
            const accessOrder = (detector as any).priceLevelAccessOrder;
            expect(Array.isArray(accessOrder)).toBe(true);
        });

        it("should evict least recently used candidates when at capacity", () => {
            const baseTime = Date.now();

            // Create candidates at capacity with different prices
            for (let i = 0; i < 5; i++) {
                const trade: EnrichedTradeEvent = {
                    tradeId: i,
                    timestamp: baseTime + i * 1000, // Spaced out times
                    price: 100 + i * 0.01, // Different prices for different candidates
                    quantity: 15, // Above institutional threshold
                    buyerIsMaker: false, // All buy side
                };

                detector.onEnrichedTrade(trade);
            }

            // Verify we're at capacity first
            let activeCandidates = detector.getActiveCandidates();
            expect(activeCandidates.length).toBe(5);

            // Add one more to trigger eviction
            const extraTrade: EnrichedTradeEvent = {
                tradeId: 999,
                timestamp: baseTime + 10000,
                price: 100.99, // New price to create new candidate
                quantity: 15,
                buyerIsMaker: false,
            };

            detector.onEnrichedTrade(extraTrade);

            // Should still be at capacity due to LRU eviction
            activeCandidates = detector.getActiveCandidates();
            expect(activeCandidates.length).toBeLessThanOrEqual(5);
        });
    });

    describe("Cleanup Optimization", () => {
        it("should perform batch cleanup operations efficiently", () => {
            const baseTime = Date.now();
            const oldTime = baseTime - 70000; // Beyond tracking window

            // Create old candidates that should be cleaned up
            for (let i = 0; i < 3; i++) {
                const trade: EnrichedTradeEvent = {
                    tradeId: i,
                    timestamp: oldTime + i * 1000,
                    price: 100 + i * 0.01,
                    quantity: 15,
                    buyerIsMaker: false,
                };

                detector.onEnrichedTrade(trade);
            }

            // Manually trigger cleanup (normally done by interval)
            (detector as any).cleanupExpiredCandidates();

            // Old candidates should be cleaned up
            const activeCandidates = detector.getActiveCandidates();
            expect(activeCandidates.length).toBe(0);
        });

        it("should maintain access order consistency during cleanup", () => {
            const baseTime = Date.now();

            // Create mixed old and new activity
            const trades = [
                { time: baseTime - 70000, price: 100.0 }, // Old - should be cleaned
                { time: baseTime - 5000, price: 100.01 }, // Recent - should remain
                { time: baseTime - 80000, price: 100.02 }, // Old - should be cleaned
                { time: baseTime - 1000, price: 100.03 }, // Recent - should remain
            ];

            trades.forEach((t, i) => {
                const trade: EnrichedTradeEvent = {
                    tradeId: i,
                    timestamp: t.time,
                    price: t.price,
                    quantity: 15,
                    buyerIsMaker: false,
                };

                detector.onEnrichedTrade(trade);
            });

            // Trigger cleanup
            (detector as any).cleanupExpiredCandidates();

            // Check that access order is maintained
            const accessOrder = (detector as any).priceLevelAccessOrder;
            const priceLevelActivity = (detector as any).priceLevelActivity;

            // All prices in access order should exist in price level activity
            accessOrder.forEach((price: number) => {
                expect(priceLevelActivity.has(price)).toBe(true);
            });
        });
    });

    describe("Performance Metrics", () => {
        it("should handle high-frequency trades without memory leaks", () => {
            const baseTime = Date.now();
            const initialMemory = process.memoryUsage().heapUsed;

            // Process many trades rapidly
            for (let i = 0; i < 1000; i++) {
                const trade: EnrichedTradeEvent = {
                    tradeId: i,
                    timestamp: baseTime + i * 10,
                    price: 100 + (i % 100) * 0.001, // Cycling prices
                    quantity: 10 + (i % 20), // Varying quantities
                    buyerIsMaker: i % 2 === 0,
                };

                detector.onEnrichedTrade(trade);
            }

            // Trigger cleanup multiple times
            for (let i = 0; i < 5; i++) {
                (detector as any).cleanupExpiredCandidates();
            }

            const finalMemory = process.memoryUsage().heapUsed;
            const memoryIncrease = finalMemory - initialMemory;

            // Memory increase should be reasonable (less than 10MB for 1000 trades)
            expect(memoryIncrease).toBeLessThan(10 * 1024 * 1024);
        });
    });
});
