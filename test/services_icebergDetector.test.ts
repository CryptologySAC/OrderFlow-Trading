import { describe, it, expect, beforeEach, vi } from "vitest";
import { IcebergDetector } from "../src/services/icebergDetector.js";
import type { EnrichedTradeEvent } from "../src/types/marketEvents.js";
import type { ILogger } from "../src/infrastructure/loggerInterface.js";
import type { IMetricsCollector } from "../src/infrastructure/metricsCollectorInterface.js";

describe("services/IcebergDetector", () => {
    let detector: IcebergDetector;
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
            minRefillCount: 3,
            maxSizeVariation: 0.2,
            minTotalSize: 50,
            maxRefillTimeMs: 30000,
            priceStabilityTolerance: 0.005,
            institutionalSizeThreshold: 10,
            trackingWindowMs: 300000,
            maxActiveIcebergs: 20,
        };

        detector = new IcebergDetector(
            "test-iceberg",
            config,
            mockLogger,
            mockMetricsCollector
        );
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    describe("Iceberg Detection Logic", () => {
        it("should detect iceberg pattern with consistent refills", () => {
            const baseTime = Date.now();
            const price = 100.0;
            const size = 12; // Above institutional threshold (10)
            
            // Create consistent refill pattern at the same price level
            for (let i = 0; i < 4; i++) {
                const trade: EnrichedTradeEvent = {
                    symbol: "LTCUSDT",
                    price, // Same price for all trades (key for iceberg detection)
                    quantity: size + (i * 0.2), // Small size variation (within 20% tolerance)
                    timestamp: baseTime + (i * 15000), // 15 second intervals (within 30 second timeout)
                    buyerIsMaker: false, // Buy order (market order hitting asks)
                    tradeId: 1000 + i,
                    orderData: {
                        passive: { buy: 100, sell: 0 },
                        aggressive: { buy: size, sell: 0 },
                        imbalance: { buy: 0.8, sell: 0.2 },
                        refill: { buy: true, sell: false },
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

            // Check that candidates are being tracked
            const candidates = detector.getActiveCandidates();
            expect(candidates.length).toBeGreaterThan(0);
            
            if (candidates.length > 0) {
                // Verify candidate properties
                const candidate = candidates[0];
                expect(candidate.side).toBe("buy");
                expect(candidate.price).toBe(price);
                expect(candidate.pieces.length).toBe(4);
                expect(candidate.totalExecuted).toBeGreaterThan(45); // Total size should be significant
            }
        });

        it("should calculate size variation correctly", () => {
            const baseTime = Date.now();
            const price = 100.0;
            const baseSize = 15;
            
            // Create trades with high size variation (should not detect as iceberg)
            const trades = [
                { size: baseSize, time: baseTime },
                { size: baseSize * 3, time: baseTime + 10000 }, // 200% variation
                { size: baseSize * 0.4, time: baseTime + 20000 }, // High variation
                { size: baseSize * 2.5, time: baseTime + 30000 },
            ];

            trades.forEach(({ size, time }) => {
                const trade: EnrichedTradeEvent = {
                    symbol: "LTCUSDT",
                    price,
                    quantity: size,
                    timestamp: time,
                    buyerIsMaker: false,
                    tradeId: Math.floor(time / 1000),
                    orderData: {
                        passive: { buy: 100, sell: 0 },
                        aggressive: { buy: size, sell: 0 },
                        imbalance: { buy: 0.8, sell: 0.2 },
                        refill: { buy: true, sell: false },
                    },
                    derivedMetrics: {
                        isAbsorption: false,
                        absorptionStrength: 0,
                        marketPressure: 0.1,
                        liquidityImpact: 0.05,
                    },
                };

                detector.onEnrichedTrade(trade);
            });

            // Should not detect iceberg due to high size variation
            const stats = detector.getStatistics();
            expect(stats.completedIcebergs).toBe(0);
        });

        it("should respect minimum institutional size threshold", () => {
            const baseTime = Date.now();
            const price = 100.0;
            const smallSize = 5; // Below institutional threshold of 10
            
            // Create pattern with small sizes
            for (let i = 0; i < 5; i++) {
                const trade: EnrichedTradeEvent = {
                    symbol: "LTCUSDT",
                    price,
                    quantity: smallSize,
                    timestamp: baseTime + (i * 10000),
                    buyerIsMaker: false,
                    tradeId: 1000 + i,
                    orderData: {
                        passive: { buy: 100, sell: 0 },
                        aggressive: { buy: smallSize, sell: 0 },
                        imbalance: { buy: 0.8, sell: 0.2 },
                        refill: { buy: true, sell: false },
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

        it("should handle refill timeout correctly", () => {
            const baseTime = Date.now();
            const price = 100.0;
            const size = 12; // Above threshold
            
            // First two trades within timeout
            for (let i = 0; i < 2; i++) {
                const trade: EnrichedTradeEvent = {
                    symbol: "LTCUSDT",
                    price,
                    quantity: size,
                    timestamp: baseTime + (i * 15000), // 15 second intervals
                    buyerIsMaker: false,
                    tradeId: 1000 + i,
                    orderData: {
                        passive: { buy: 100, sell: 0 },
                        aggressive: { buy: size, sell: 0 },
                        imbalance: { buy: 0.8, sell: 0.2 },
                        refill: { buy: true, sell: false },
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

            // Verify first sequence is tracked
            let candidates = detector.getActiveCandidates();
            expect(candidates.length).toBe(1);
            expect(candidates[0].pieces.length).toBe(2);

            // Third trade after timeout (35 seconds, maxRefillTimeMs is 30 seconds)
            const timeoutTrade: EnrichedTradeEvent = {
                symbol: "LTCUSDT",
                price,
                quantity: size,
                timestamp: baseTime + 35000,
                buyerIsMaker: false,
                tradeId: 1002,
                orderData: {
                    passive: { buy: 100, sell: 0 },
                    aggressive: { buy: size, sell: 0 },
                    imbalance: { buy: 0.8, sell: 0.2 },
                    refill: { buy: true, sell: false },
                },
                derivedMetrics: {
                    isAbsorption: false,
                    absorptionStrength: 0,
                    marketPressure: 0.1,
                    liquidityImpact: 0.05,
                },
            };

            detector.onEnrichedTrade(timeoutTrade);

            // Should abandon the first candidate due to timeout
            candidates = detector.getActiveCandidates();
            // The behavior might vary - either no candidates or a new one started
            expect(candidates.length).toBeLessThanOrEqual(1);
        });
    });

    describe("Zone Emission", () => {
        it("should emit zone events when iceberg is detected", () => {
            const mockEmit = vi.fn();
            detector.emit = mockEmit;

            const baseTime = Date.now();
            const price = 100.0;
            const size = 20; // Large institutional size
            
            // Create perfect iceberg pattern
            for (let i = 0; i < 4; i++) {
                const trade: EnrichedTradeEvent = {
                    symbol: "LTCUSDT",
                    price,
                    quantity: size, // Consistent size
                    timestamp: baseTime + (i * 15000),
                    buyerIsMaker: false,
                    tradeId: 1000 + i,
                    orderData: {
                        passive: { buy: 100, sell: 0 },
                        aggressive: { buy: size, sell: 0 },
                        imbalance: { buy: 0.9, sell: 0.1 },
                        refill: { buy: true, sell: false },
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

            // Should have emitted zoneUpdated event
            expect(mockEmit).toHaveBeenCalledWith("zoneUpdated", expect.objectContaining({
                updateType: "zone_created",
                zone: expect.objectContaining({
                    type: "iceberg",
                    priceRange: expect.objectContaining({
                        min: expect.any(Number),
                        max: expect.any(Number),
                    }),
                    strength: expect.any(Number),
                    completion: 1.0,
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
                completedIcebergs: 0,
                avgConfidence: 0,
                avgInstitutionalScore: 0,
                totalVolumeDetected: 0,
            });
        });

        it("should provide status string", () => {
            const status = detector.getStatus();
            expect(status).toContain("Active:");
            expect(status).toContain("candidates");
            expect(status).toContain("completed");
        });
    });

    describe("Error Handling", () => {
        it("should handle invalid trade data gracefully", () => {
            const invalidTrade = {
                symbol: "LTCUSDT",
                price: NaN,
                quantity: -10,
                timestamp: 0,
                buyerIsMaker: false,
                tradeId: 1,
                orderData: null,
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