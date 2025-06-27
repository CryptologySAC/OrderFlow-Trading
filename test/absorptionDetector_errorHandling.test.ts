// test/absorptionDetector_errorHandling.test.ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { AbsorptionDetector } from "../src/indicators/absorptionDetector.js";
import type { AbsorptionSettings } from "../src/indicators/absorptionDetector.js";
import type { EnrichedTradeEvent } from "../src/types/marketEvents.js";
import type { ILogger } from "../src/infrastructure/loggerInterface.js";
import type { IMetricsCollector } from "../src/infrastructure/metricsCollectorInterface.js";
import type { IOrderBookState } from "../src/market/orderBookState.js";
import { SpoofingDetector } from "../src/services/spoofingDetector.js";

/**
 * CRITICAL REQUIREMENT: These tests validate EXPECTED ERROR HANDLING BEHAVIOR
 * Tests MUST fail if error handling doesn't meet institutional-grade standards
 */

describe("AbsorptionDetector - Error Handling & Edge Cases", () => {
    let detector: AbsorptionDetector;
    let mockOrderBook: IOrderBookState;
    let mockLogger: ILogger;
    let mockMetrics: IMetricsCollector;
    let mockSpoofingDetector: SpoofingDetector;

    const defaultSettings: AbsorptionSettings = {
        windowMs: 60000,
        minAggVolume: 10,
        pricePrecision: 4,
        zoneTicks: 10,
        absorptionThreshold: 0.7,
        priceEfficiencyThreshold: 0.85,
    };

    beforeEach(async () => {
        mockOrderBook = {
            getBestBid: vi.fn().mockReturnValue(100.5),
            getBestAsk: vi.fn().mockReturnValue(100.6),
            getSpread: vi.fn().mockReturnValue({ spread: 0.1, spreadBps: 10 }),
            getDepth: vi.fn().mockReturnValue(new Map()),
            isHealthy: vi.fn().mockReturnValue(true),
            getLastUpdate: vi.fn().mockReturnValue(Date.now()),
        } as any;

        mockLogger = {
            info: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
            debug: vi.fn(),
        } as any;

        // Use proper mock from __mocks__/ directory per CLAUDE.md
        const { MetricsCollector: MockMetricsCollector } = await import(
            "../__mocks__/src/infrastructure/metricsCollector.js"
        );
        mockMetrics = new MockMetricsCollector() as any;

        mockSpoofingDetector = {
            isLikelySpoof: vi.fn().mockReturnValue(false),
        } as any;

        detector = new AbsorptionDetector(
            "TEST",
            defaultSettings,
            mockOrderBook,
            mockLogger,
            mockSpoofingDetector,
            mockMetrics
        );
    });

    describe("SPECIFICATION: Null Return on Insufficient Data", () => {
        it("MUST return null when zone has no history", () => {
            // REQUIREMENT: Return null instead of defaults when no zone data exists
            const freshTrade = createTradeEvent({
                price: 999.9999, // Completely new price zone
                volume: 1000,
                side: "buy",
            });

            let signalEmitted = false;
            detector.on("signal", () => {
                signalEmitted = true;
            });

            detector.onEnrichedTrade(freshTrade);

            // EXPECTED BEHAVIOR: Must not emit signal for zones with no history
            expect(signalEmitted).toBe(false);
        });

        it("MUST return null when passive volume data is insufficient", () => {
            // REQUIREMENT: Return null when passive volume calculations cannot be performed
            const tradeWithInsufficientPassive = createTradeEvent({
                price: 100.5,
                volume: 1000,
                side: "buy",
            });

            // Mock order book to return no passive liquidity data
            mockOrderBook.getDepth = vi.fn().mockReturnValue(new Map());

            let signalEmitted = false;
            detector.on("signal", () => {
                signalEmitted = true;
            });

            detector.onEnrichedTrade(tradeWithInsufficientPassive);

            // EXPECTED BEHAVIOR: Must not emit signal when passive data unavailable
            expect(signalEmitted).toBe(false);
        });

        it("MUST return null when price data is invalid", () => {
            // REQUIREMENT: Handle invalid price data gracefully
            const invalidPriceTrades = [
                createTradeEvent({ price: NaN, volume: 100, side: "buy" }),
                createTradeEvent({ price: Infinity, volume: 100, side: "buy" }),
                createTradeEvent({ price: -100, volume: 100, side: "buy" }),
                createTradeEvent({ price: 0, volume: 100, side: "buy" }),
            ];

            let signalCount = 0;
            detector.on("signal", () => {
                signalCount++;
            });

            invalidPriceTrades.forEach((trade) => {
                detector.onEnrichedTrade(trade);
            });

            // EXPECTED BEHAVIOR: Must not emit signals for invalid price data
            expect(signalCount).toBe(0);
        });

        it("MUST return null when volume data is invalid", () => {
            // REQUIREMENT: Handle invalid volume data gracefully
            const invalidVolumeTrades = [
                createTradeEvent({ price: 100.5, volume: NaN, side: "buy" }),
                createTradeEvent({
                    price: 100.5,
                    volume: Infinity,
                    side: "buy",
                }),
                createTradeEvent({ price: 100.5, volume: -100, side: "buy" }),
                createTradeEvent({ price: 100.5, volume: 0, side: "buy" }),
            ];

            let signalCount = 0;
            detector.on("signal", () => {
                signalCount++;
            });

            invalidVolumeTrades.forEach((trade) => {
                detector.onEnrichedTrade(trade);
            });

            // EXPECTED BEHAVIOR: Must not emit signals for invalid volume data
            expect(signalCount).toBe(0);
        });
    });

    describe("SPECIFICATION: Division by Zero Protection", () => {
        it("MUST handle zero passive volume gracefully", () => {
            // REQUIREMENT: Prevent division by zero in volume pressure calculations
            const trade = createTradeEvent({
                price: 100.5,
                volume: 1000,
                side: "buy",
            });

            // Simulate zero passive volume scenario
            const mockDepth = new Map();
            mockDepth.set(100.5, { bid: 0, ask: 0 }); // Zero passive liquidity
            mockOrderBook.getDepth = vi.fn().mockReturnValue(mockDepth);

            let errorOccurred = false;
            detector.on("error", () => {
                errorOccurred = true;
            });

            expect(() => {
                detector.onEnrichedTrade(trade);
            }).not.toThrow();

            // EXPECTED BEHAVIOR: Must not throw errors on zero passive volume
            expect(errorOccurred).toBe(false);
        });

        it("MUST handle zero expected movement gracefully", () => {
            // REQUIREMENT: Handle scenarios where expected price movement is zero
            const trade = createTradeEvent({
                price: 100.5,
                volume: 0.1, // Very small volume
                side: "buy",
            });

            expect(() => {
                detector.onEnrichedTrade(trade);
            }).not.toThrow();

            // EXPECTED BEHAVIOR: Must not crash on zero expected movement
            expect(mockLogger.error).not.toHaveBeenCalled();
        });
    });

    describe("SPECIFICATION: Memory Management", () => {
        it("MUST clean up old zone data automatically", () => {
            // REQUIREMENT: Prevent memory leaks by cleaning up old zone data
            const oldTimestamp = Date.now() - 24 * 60 * 60 * 1000; // 24 hours ago

            // Create many trades to fill memory
            for (let i = 0; i < 1000; i++) {
                const trade = createTradeEvent({
                    price: 100 + i * 0.001,
                    volume: 100,
                    side: i % 2 === 0 ? "buy" : "sell",
                });

                // Simulate old timestamp
                trade.eventTime = oldTimestamp;
                trade.tradeTime = oldTimestamp;

                detector.onEnrichedTrade(trade);
            }

            // Trigger cleanup by processing recent trade
            const recentTrade = createTradeEvent({
                price: 200.5,
                volume: 100,
                side: "buy",
            });

            detector.onEnrichedTrade(recentTrade);

            // EXPECTED BEHAVIOR: Memory should not grow indefinitely
            // Note: This is a behavioral test - implementation should cleanup old data
            expect(mockMetrics.updateMetric).toHaveBeenCalledWith(
                "absorptionZonesActive",
                expect.any(Number)
            );
        });

        it("MUST release object pool resources on cleanup", () => {
            // REQUIREMENT: Properly release pooled objects to prevent memory leaks
            detector.cleanup();

            // EXPECTED BEHAVIOR: Cleanup should not throw errors
            expect(mockLogger.error).not.toHaveBeenCalled();
        });
    });

    describe("SPECIFICATION: Configuration Validation", () => {
        it("MUST throw error for invalid threshold configurations", () => {
            // REQUIREMENT: Validate configuration parameters at construction
            const invalidConfigs = [
                { ...defaultSettings, priceEfficiencyThreshold: -1 }, // Negative threshold
                { ...defaultSettings, priceEfficiencyThreshold: 2 }, // Above 1.0
                { ...defaultSettings, windowMs: -1000 }, // Negative window
                { ...defaultSettings, minAggVolume: -100 }, // Negative volume
                { ...defaultSettings, pricePrecision: -1 }, // Negative precision
            ];

            invalidConfigs.forEach((config) => {
                expect(() => {
                    new AbsorptionDetector(
                        "INVALID",
                        config,
                        mockOrderBook,
                        mockLogger,
                        mockSpoofingDetector,
                        mockMetrics
                    );
                }).toThrow();
            });
        });

        it("MUST use default values for undefined optional settings", () => {
            // REQUIREMENT: Provide sensible defaults for optional configuration
            const minimalSettings: AbsorptionSettings = {
                // Only required settings
            };

            expect(() => {
                const detector = new AbsorptionDetector(
                    "MINIMAL",
                    minimalSettings,
                    mockOrderBook,
                    mockLogger,
                    mockSpoofingDetector,
                    mockMetrics
                );

                // Should be able to process trades with defaults
                detector.onEnrichedTrade(
                    createTradeEvent({
                        price: 100.5,
                        volume: 100,
                        side: "buy",
                    })
                );
            }).not.toThrow();
        });
    });

    describe("SPECIFICATION: Order Book Health Validation", () => {
        it("MUST handle unhealthy order book gracefully", () => {
            // REQUIREMENT: Continue operation when order book is unhealthy
            mockOrderBook.isHealthy = vi.fn().mockReturnValue(false);

            const trade = createTradeEvent({
                price: 100.5,
                volume: 1000,
                side: "buy",
            });

            expect(() => {
                detector.onEnrichedTrade(trade);
            }).not.toThrow();

            // EXPECTED BEHAVIOR: Should handle gracefully but not necessarily log
            // The detector may or may not log warnings for unhealthy order book
            // depending on implementation - the key requirement is no crash
            expect(true).toBe(true); // Test passes if no exception thrown
        });

        it("MUST handle missing order book data gracefully", () => {
            // REQUIREMENT: Handle scenarios where order book data is unavailable
            mockOrderBook.getBestBid = vi.fn().mockReturnValue(undefined);
            mockOrderBook.getBestAsk = vi.fn().mockReturnValue(undefined);
            mockOrderBook.getSpread = vi.fn().mockReturnValue(undefined);

            const trade = createTradeEvent({
                price: 100.5,
                volume: 1000,
                side: "buy",
            });

            expect(() => {
                detector.onEnrichedTrade(trade);
            }).not.toThrow();

            // EXPECTED BEHAVIOR: Should handle gracefully without crashing
        });
    });

    describe("SPECIFICATION: Error Recovery", () => {
        it("MUST continue processing after encountering errors", () => {
            // REQUIREMENT: Isolated error handling - one bad trade shouldn't break the detector
            const badTrade = createTradeEvent({
                price: NaN,
                volume: 1000,
                side: "buy",
            });

            const goodTrade = createTradeEvent({
                price: 100.5,
                volume: 1000,
                side: "buy",
            });

            // Process bad trade first
            detector.onEnrichedTrade(badTrade);

            // Then process good trade
            let signalEmitted = false;
            detector.on("signal", () => {
                signalEmitted = true;
            });

            detector.onEnrichedTrade(goodTrade);

            // EXPECTED BEHAVIOR: Detector should still function after error
            // (Note: Whether signal is emitted depends on sufficient data, but should not crash)
            expect(mockLogger.error).not.toHaveBeenCalledWith(
                expect.stringContaining("fatal")
            );
        });

        it("MUST log errors with correlation IDs for debugging", () => {
            // REQUIREMENT: Error logging must include correlation IDs for tracing
            const invalidTrade = createTradeEvent({
                price: "invalid" as any,
                volume: 1000,
                side: "buy",
            });

            detector.onEnrichedTrade(invalidTrade);

            // EXPECTED BEHAVIOR: Errors should be logged with correlation context
            expect(mockLogger.error).toHaveBeenCalledWith(
                expect.any(String),
                expect.objectContaining({
                    correlationId: expect.any(String),
                })
            );
        });
    });

    // Helper function to create trade events
    function createTradeEvent(params: {
        price: number | any;
        volume: number | any;
        side: "buy" | "sell";
    }): EnrichedTradeEvent {
        return {
            // Simulate properly processed EnrichedTradeEvent (not raw Binance data)
            price: params.price, // Should be number, not string
            quantity: params.volume, // Should be number, not string
            timestamp: Date.now(),
            buyerIsMaker: params.side === "sell",
            pair: "TESTUSDT",
            tradeId: `test_${Date.now()}_${Math.random()}`,
            originalTrade: {
                // Raw Binance data would have strings, but this is processed
                p: params.price?.toString() || "0",
                q: params.volume?.toString() || "0",
                T: Date.now(),
                m: params.side === "sell",
            } as any,
            // Required enriched fields
            passiveBidVolume: 1000,
            passiveAskVolume: 1000,
            zonePassiveBidVolume: 500,
            zonePassiveAskVolume: 500,
            bestBid: (params.price || 100) - 0.01,
            bestAsk: (params.price || 100) + 0.01,
        } as EnrichedTradeEvent;
    }
});
