// test/simpleIcebergDetector_realWorld.test.ts
//
// 🧪 REAL-WORLD SIMPLE ICEBERG DETECTOR TESTS
//
// Tests for exact-size iceberg pattern detection with zero tolerance:
// 1. Passive Icebergs: Identical sizes at same price level
// 2. Aggressive LTC Icebergs: Identical LTC quantities at different prices
// 3. Aggressive USDT Icebergs: Identical dollar amounts at different prices
//
// ZERO TOLERANCE: No size variations allowed - exact matching only

import { describe, it, expect, beforeEach, vi } from "vitest";
import { SimpleIcebergDetector } from "../src/services/icebergDetector.js";
import type { EnrichedTradeEvent } from "../src/types/marketEvents.js";
import type { ILogger } from "../src/infrastructure/loggerInterface.js";
import type { IMetricsCollector } from "../src/infrastructure/metricsCollectorInterface.js";

// Mock Config to use test configuration instead of production
vi.mock("../src/core/config.js", () => ({
    Config: {
        SIMPLE_ICEBERG_DETECTOR: {
            enhancementMode: "production",
            minOrderCount: 3,
            minTotalSize: 50, // Test configuration - much lower than production 500
            maxOrderGapMs: 30000,
            trackingWindowMs: 300000,
            maxActivePatterns: 50,
            maxRecentTrades: 100,
        },
    },
}));

describe("SimpleIcebergDetector - Real-World Scenarios", () => {
    let detector: SimpleIcebergDetector;
    let mockLogger: ILogger;
    let mockMetrics: IMetricsCollector;
    let mockSignalLogger: any;

    beforeEach(() => {
        mockLogger = {
            info: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
            debug: vi.fn(),
        };

        mockMetrics = {
            recordGauge: vi.fn(),
            recordCounter: vi.fn(),
            recordHistogram: vi.fn(),
            incrementMetric: vi.fn(),
            updateMetric: vi.fn(),
        };

        mockSignalLogger = {
            logSignal: vi.fn(),
        };

        detector = new SimpleIcebergDetector(
            "test-simple-iceberg",
            mockLogger,
            mockMetrics,
            mockSignalLogger
        );
    });

    // Helper to create realistic trade events
    const createTrade = (
        price: number,
        quantity: number,
        timestamp: number,
        buyerIsMaker: boolean = false
    ): EnrichedTradeEvent => ({
        tradeId: `${timestamp}_${Math.random().toString(36)}`,
        price,
        quantity,
        timestamp,
        buyerIsMaker,
        symbol: "LTCUSDT",
        side: buyerIsMaker ? "sell" : "buy",
        pair: "LTCUSDT",
        originalTrade: {} as any,
        passiveBidVolume: 0,
        passiveAskVolume: 0,
        zonePassiveBidVolume: 0,
        zonePassiveAskVolume: 0,
    });

    describe("🎯 Passive Icebergs - Exact Size at Same Price", () => {
        it("should detect institutional passive iceberg: 4 orders of exactly 25 LTC at $89.45", () => {
            const basePrice = 89.45;
            const baseTime = Date.now();
            const exactSize = 25.0; // Exactly identical
            let signalEmitted = false;
            let emittedSignal: any = null;

            detector.on("signalCandidate", (signal) => {
                signalEmitted = true;
                emittedSignal = signal;
            });

            // Simulate institutional passive iceberg: exact same sizes at same price
            for (let i = 0; i < 4; i++) {
                detector.onEnrichedTrade(
                    createTrade(
                        basePrice,
                        exactSize,
                        baseTime + i * 5000,
                        false
                    )
                );
            }

            expect(signalEmitted).toBe(true);
            expect(emittedSignal).not.toBeNull();
            expect(emittedSignal.data.meta.icebergEvent.type).toBe("passive");
            expect(emittedSignal.data.meta.icebergEvent.orderSize).toBe(
                exactSize
            );

            // Signal emitted after 3rd trade, but completed iceberg should show final count
            const completed = detector.getCompletedIcebergs();
            expect(completed).toHaveLength(1);
            const iceberg = completed[0];
            expect(iceberg.orderCount).toBe(4); // Full pattern including 4th trade
            expect(iceberg.totalSize).toBe(100); // 4 * 25
            expect(iceberg.type).toBe("passive");
            expect(iceberg.side).toBe("buy");
        });

        it("should detect large institutional sell iceberg: 5 orders of exactly 50 LTC", () => {
            const basePrice = 91.23;
            const baseTime = Date.now();
            const exactSize = 50.0;
            let signalEmitted = false;

            detector.on("signalCandidate", () => {
                signalEmitted = true;
            });

            // Large sell iceberg with exact sizes
            for (let i = 0; i < 5; i++) {
                detector.onEnrichedTrade(
                    createTrade(basePrice, exactSize, baseTime + i * 8000, true) // Sell trades
                );
            }

            expect(signalEmitted).toBe(true);

            const completed = detector.getCompletedIcebergs();
            expect(completed).toHaveLength(1);

            const iceberg = completed[0];
            expect(iceberg.type).toBe("passive");
            expect(iceberg.side).toBe("sell");
            expect(iceberg.totalSize).toBe(250); // 5 * 50
            expect(iceberg.orderSize).toBe(exactSize);
            expect(iceberg.orderCount).toBe(5);
        });

        it("should NOT detect trades with any size variation (zero tolerance)", () => {
            const basePrice = 89.45;
            const baseTime = Date.now();
            let signalEmitted = false;

            detector.on("signalCandidate", () => {
                signalEmitted = true;
            });

            // Simulate slight variations that would fail zero tolerance
            // Only 2 valid trades of same size (< 3 minimum), others have variations
            const slightlyDifferentSizes = [25.0, 25.1, 25.0, 25.2]; // Multiple different sizes
            slightlyDifferentSizes.forEach((qty, i) => {
                detector.onEnrichedTrade(
                    createTrade(basePrice, qty, baseTime + i * 5000, false)
                );
            });

            expect(signalEmitted).toBe(false);
            expect(detector.getCompletedIcebergs()).toHaveLength(0);
        });
    });

    describe("⚡ Aggressive LTC Icebergs - Same LTC Amount, Different Prices", () => {
        it("should detect aggressive LTC iceberg: 3 orders of exactly 30 LTC at different prices", () => {
            const baseTime = Date.now();
            const exactLtcSize = 30.0;
            const prices = [89.5, 89.52, 89.48]; // Different market prices
            let signalEmitted = false;
            let emittedSignal: any = null;

            detector.on("signalCandidate", (signal) => {
                signalEmitted = true;
                emittedSignal = signal;
            });

            // Market orders with exact LTC amounts at different prices
            prices.forEach((price, i) => {
                detector.onEnrichedTrade(
                    createTrade(price, exactLtcSize, baseTime + i * 3000, false)
                );
            });

            expect(signalEmitted).toBe(true);
            expect(emittedSignal.data.meta.icebergEvent.type).toBe(
                "aggressive_ltc"
            );
            expect(emittedSignal.data.meta.icebergEvent.orderSize).toBe(
                exactLtcSize
            );
            expect(emittedSignal.data.meta.icebergEvent.orderCount).toBe(3);
            expect(emittedSignal.data.meta.icebergEvent.totalSize).toBe(90); // 3 * 30
            expect(
                emittedSignal.data.meta.icebergEvent.priceRange
            ).toBeDefined();
            expect(emittedSignal.data.meta.icebergEvent.priceRange.min).toBe(
                89.48
            );
            expect(emittedSignal.data.meta.icebergEvent.priceRange.max).toBe(
                89.52
            );
        });

        it("should detect rapid aggressive LTC execution: 4 orders of 15 LTC within seconds", () => {
            const baseTime = Date.now();
            const exactLtcSize = 15.0;
            const prices = [88.95, 88.97, 88.93, 88.96];
            let signalEmitted = false;

            detector.on("signalCandidate", () => {
                signalEmitted = true;
            });

            // Rapid market execution with exact LTC sizes
            prices.forEach((price, i) => {
                detector.onEnrichedTrade(
                    createTrade(price, exactLtcSize, baseTime + i * 1500, false) // 1.5s intervals
                );
            });

            expect(signalEmitted).toBe(true);

            const completed = detector.getCompletedIcebergs();
            expect(completed).toHaveLength(1);

            const iceberg = completed[0];
            expect(iceberg.type).toBe("aggressive_ltc");
            expect(iceberg.orderSize).toBe(exactLtcSize);
            expect(iceberg.orderCount).toBe(4);
            expect(iceberg.totalSize).toBe(60); // 4 * 15
        });
    });

    describe("💰 Aggressive USDT Icebergs - Same Dollar Amount, Different Prices", () => {
        it("should detect aggressive USDT iceberg: 4 orders of exactly $1000 USDT value", () => {
            const baseTime = Date.now();
            const targetUsdtValue = 1000.0;
            let signalEmitted = false;
            let emittedSignal: any = null;

            detector.on("signalCandidate", (signal) => {
                signalEmitted = true;
                emittedSignal = signal;
            });

            // Use exact quantities that produce the same USDT value
            // IMPORTANT: Total LTC volume must be >= 50 (minTotalSize)
            const trades = [
                { price: 100.0, qty: 10.0 }, // Exactly 10.0 * 100.0 = $1000
                { price: 200.0, qty: 5.0 }, // Exactly 5.0 * 200.0 = $1000
                { price: 50.0, qty: 20.0 }, // Exactly 20.0 * 50.0 = $1000
                { price: 40.0, qty: 25.0 }, // Exactly 25.0 * 40.0 = $1000 (Total: 60 LTC >= 50)
            ];

            trades.forEach((trade, i) => {
                detector.onEnrichedTrade(
                    createTrade(
                        trade.price,
                        trade.qty,
                        baseTime + i * 4000,
                        false
                    )
                );
            });

            expect(signalEmitted).toBe(true);
            expect(emittedSignal.data.meta.icebergEvent.type).toBe(
                "aggressive_usdt"
            );
            expect(emittedSignal.data.meta.icebergEvent.orderSize).toBeCloseTo(
                targetUsdtValue,
                2
            );
            expect(emittedSignal.data.meta.icebergEvent.orderCount).toBe(4);
        });

        it("should detect institutional USDT iceberg: 5 orders of exactly $2500 each", () => {
            const baseTime = Date.now();
            const targetUsdtValue = 2500.0;
            let signalEmitted = false;

            detector.on("signalCandidate", () => {
                signalEmitted = true;
            });

            // Large institutional orders with exact USDT values
            const trades = [
                { price: 100.0, qty: 25.0 }, // Exactly 25.0 * 100.0 = $2500
                { price: 125.0, qty: 20.0 }, // Exactly 20.0 * 125.0 = $2500
                { price: 250.0, qty: 10.0 }, // Exactly 10.0 * 250.0 = $2500
                { price: 50.0, qty: 50.0 }, // Exactly 50.0 * 50.0 = $2500
                { price: 500.0, qty: 5.0 }, // Exactly 5.0 * 500.0 = $2500
            ];
            trades.forEach((trade, i) => {
                detector.onEnrichedTrade(
                    createTrade(
                        trade.price,
                        trade.qty,
                        baseTime + i * 6000,
                        true
                    ) // Sell orders
                );
            });

            expect(signalEmitted).toBe(true);

            const completed = detector.getCompletedIcebergs();
            expect(completed).toHaveLength(1);

            const iceberg = completed[0];
            expect(iceberg.type).toBe("aggressive_usdt");
            expect(iceberg.side).toBe("sell");
            expect(iceberg.orderCount).toBe(5);
            expect(iceberg.orderSize).toBeCloseTo(targetUsdtValue, 2);
        });
    });

    describe("🚫 Edge Cases - Should NOT Trigger Detection", () => {
        it("should NOT detect insufficient order count (< minOrderCount)", () => {
            const basePrice = 90.0;
            const baseTime = Date.now();
            let signalEmitted = false;

            detector.on("signalCandidate", () => {
                signalEmitted = true;
            });

            // Only 2 orders (minOrderCount is 3)
            detector.onEnrichedTrade(
                createTrade(basePrice, 20.0, baseTime, false)
            );
            detector.onEnrichedTrade(
                createTrade(basePrice, 20.0, baseTime + 5000, false)
            );

            expect(signalEmitted).toBe(false);
            expect(detector.getCompletedIcebergs()).toHaveLength(0);
        });

        it("should NOT detect insufficient total size (< minTotalSize)", () => {
            const basePrice = 90.0;
            const baseTime = Date.now();
            let signalEmitted = false;

            detector.on("signalCandidate", () => {
                signalEmitted = true;
            });

            // 4 orders of 10 LTC each = 40 LTC total (< 50 LTC minTotalSize)
            for (let i = 0; i < 4; i++) {
                detector.onEnrichedTrade(
                    createTrade(basePrice, 10.0, baseTime + i * 5000, false)
                );
            }

            expect(signalEmitted).toBe(false);
            expect(detector.getCompletedIcebergs()).toHaveLength(0);
        });

        it("should NOT detect orders with gaps exceeding maxOrderGapMs", () => {
            const basePrice = 90.0;
            const baseTime = Date.now();
            let signalEmitted = false;

            detector.on("signalCandidate", () => {
                signalEmitted = true;
            });

            // Orders with 35-second gaps (> 30s maxOrderGapMs)
            detector.onEnrichedTrade(
                createTrade(basePrice, 20.0, baseTime, false)
            );
            detector.onEnrichedTrade(
                createTrade(basePrice, 20.0, baseTime + 5000, false)
            );
            detector.onEnrichedTrade(
                createTrade(basePrice, 20.0, baseTime + 40000, false)
            ); // 35s gap

            expect(signalEmitted).toBe(false);
            expect(detector.getCompletedIcebergs()).toHaveLength(0);
        });

        it("should NOT detect random trading activity", () => {
            const baseTime = Date.now();
            let signalEmitted = false;

            detector.on("signalCandidate", () => {
                signalEmitted = true;
            });

            // Random trades with different sizes and prices
            const randomTrades = [
                { price: 89.12, qty: 5.3 },
                { price: 89.15, qty: 12.7 },
                { price: 89.11, qty: 8.9 },
                { price: 89.18, qty: 3.2 },
            ];

            randomTrades.forEach((trade, i) => {
                detector.onEnrichedTrade(
                    createTrade(
                        trade.price,
                        trade.qty,
                        baseTime + i * 3000,
                        false
                    )
                );
            });

            expect(signalEmitted).toBe(false);
            expect(detector.getCompletedIcebergs()).toHaveLength(0);
        });
    });

    describe("⏰ Timing and Memory Management", () => {
        it("should handle rapid-fire identical orders correctly", () => {
            const basePrice = 89.5;
            const baseTime = Date.now();
            const exactSize = 15.0; // 4 * 15 = 60 LTC total >= 50 minimum
            let signalEmitted = false;

            detector.on("signalCandidate", () => {
                signalEmitted = true;
            });

            // Very rapid execution (500ms between orders)
            for (let i = 0; i < 4; i++) {
                detector.onEnrichedTrade(
                    createTrade(basePrice, exactSize, baseTime + i * 500, false)
                );
            }

            expect(signalEmitted).toBe(true);

            const completed = detector.getCompletedIcebergs();
            expect(completed).toHaveLength(1);
            expect(completed[0].orderCount).toBe(4);
        });

        it("should clean up expired patterns automatically", () => {
            const basePrice = 90.0;
            const oldTime = Date.now() - 400000; // 6.67 minutes ago (beyond 5min window)

            // Create old pattern that should be cleaned up
            detector.onEnrichedTrade(
                createTrade(basePrice, 15.0, oldTime, false)
            );
            detector.onEnrichedTrade(
                createTrade(basePrice, 15.0, oldTime + 5000, false)
            );

            // Trigger cleanup by processing a current trade
            detector.onEnrichedTrade(
                createTrade(90.01, 15.0, Date.now(), false)
            );

            // Check statistics - old patterns should be cleaned up, only recent patterns remain
            const stats = detector.getStatistics();
            expect(stats.activePatterns).toBeLessThanOrEqual(3); // Recent patterns for different iceberg types
        });

        it("should provide accurate statistics", () => {
            const baseTime = Date.now();

            // Create one completed iceberg
            const exactSize = 25.0;
            for (let i = 0; i < 3; i++) {
                detector.onEnrichedTrade(
                    createTrade(90.5, exactSize, baseTime + i * 5000, false)
                );
            }

            // Create partial pattern (incomplete)
            detector.onEnrichedTrade(
                createTrade(91.5, 20.0, baseTime + 50000, false)
            );
            detector.onEnrichedTrade(
                createTrade(91.5, 20.0, baseTime + 55000, false)
            );

            const stats = detector.getStatistics();
            expect(stats.completedIcebergs).toBe(1);
            expect(stats.totalVolumeDetected).toBe(75); // 3 * 25
            expect(stats.activePatterns).toBeGreaterThan(0); // Has incomplete pattern
        });
    });

    describe("🛡️ Error Handling", () => {
        it("should handle invalid trade data gracefully", () => {
            expect(() => {
                detector.onEnrichedTrade(
                    createTrade(NaN, 20, Date.now(), false)
                );
            }).not.toThrow();

            expect(() => {
                detector.onEnrichedTrade(
                    createTrade(90.0, NaN, Date.now(), false)
                );
            }).not.toThrow();

            expect(() => {
                detector.onEnrichedTrade(
                    createTrade(-50, 20, Date.now(), false)
                );
            }).not.toThrow();

            // Should log errors but not crash
            expect(mockLogger.error).toHaveBeenCalled();
        });

        it("should handle insufficient patterns correctly", () => {
            // Single trade creates candidate patterns but no completed icebergs (< 3 minimum)
            detector.onEnrichedTrade(createTrade(90.0, 20, Date.now(), false));
            expect(detector.getStatistics().activePatterns).toBeGreaterThan(0); // Patterns started
            expect(detector.getCompletedIcebergs()).toHaveLength(0); // No completed icebergs

            // Two trades still insufficient for completion
            detector.onEnrichedTrade(
                createTrade(90.0, 20, Date.now() + 5000, false)
            );
            expect(detector.getCompletedIcebergs()).toHaveLength(0); // Still no completed icebergs
        });
    });

    describe("🔄 Mixed Market Scenarios", () => {
        it("should detect both buy and sell icebergs simultaneously", () => {
            const basePrice = 91.0;
            const baseTime = Date.now();
            let buySignals = 0;
            let sellSignals = 0;

            detector.on("signalCandidate", (signal: any) => {
                if (signal.data.meta.icebergEvent.side === "buy") buySignals++;
                if (signal.data.meta.icebergEvent.side === "sell")
                    sellSignals++;
            });

            // Interleave buy and sell icebergs with exact sizes
            const exactSize = 18.0;
            for (let i = 0; i < 3; i++) {
                // Buy iceberg
                detector.onEnrichedTrade(
                    createTrade(
                        basePrice,
                        exactSize,
                        baseTime + i * 8000,
                        false
                    )
                );
                // Sell iceberg
                detector.onEnrichedTrade(
                    createTrade(
                        basePrice,
                        exactSize,
                        baseTime + i * 8000 + 1000,
                        true
                    )
                );
            }

            expect(buySignals).toBe(1);
            expect(sellSignals).toBe(1);
            expect(detector.getCompletedIcebergs()).toHaveLength(2);
        });

        it("should handle high-frequency trading scenario", () => {
            const baseTime = Date.now();
            let signalCount = 0;

            detector.on("signalCandidate", () => {
                signalCount++;
            });

            // Create multiple simultaneous icebergs at different prices
            // All must meet minimum total size: 3 trades * size >= 50 LTC
            const icebergConfigs = [
                { price: 89.5, size: 20.0 }, // 3 * 20 = 60 LTC ✅
                { price: 91.25, size: 17.0 }, // 3 * 17 = 51 LTC ✅
                { price: 88.75, size: 25.0 }, // 3 * 25 = 75 LTC ✅
            ];

            icebergConfigs.forEach((config, configIndex) => {
                for (let i = 0; i < 3; i++) {
                    detector.onEnrichedTrade(
                        createTrade(
                            config.price,
                            config.size,
                            baseTime + configIndex * 200000 + i * 5000,
                            false
                        )
                    );
                }
            });

            expect(signalCount).toBe(3);
            expect(detector.getCompletedIcebergs()).toHaveLength(3);

            // Verify each iceberg has correct data
            const completed = detector.getCompletedIcebergs();
            const prices = completed.map((i) => i.price || 0);
            expect(new Set(prices).size).toBe(3); // All unique prices
        });
    });
});
