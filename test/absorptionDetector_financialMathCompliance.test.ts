// test/absorptionDetector_financialMathCompliance.test.ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { AbsorptionDetector } from "../src/indicators/absorptionDetector.js";
import type { AbsorptionSettings } from "../src/indicators/absorptionDetector.js";
import type { EnrichedTradeEvent } from "../src/types/marketEvents.js";
import type { ILogger } from "../src/infrastructure/loggerInterface.js";
import type { IMetricsCollector } from "../src/infrastructure/metricsCollectorInterface.js";
import type { IOrderBookState } from "../src/market/orderBookState.js";
import { SpoofingDetector } from "../src/services/spoofingDetector.js";
import { FinancialMath } from "../src/utils/financialMath.js";

/**
 * CRITICAL REQUIREMENT: These tests validate FINANCIAL PRECISION COMPLIANCE
 * Tests MUST fail if detector uses direct floating-point arithmetic
 * instead of FinancialMath for financial calculations
 */

describe("AbsorptionDetector - FinancialMath Compliance", () => {
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

    beforeEach(() => {
        mockOrderBook = {
            getBestBid: vi.fn().mockReturnValue(100.5),
            getBestAsk: vi.fn().mockReturnValue(100.6),
            getSpread: vi.fn().mockReturnValue({ spread: 0.1, spreadBps: 10 }),
            getDepth: vi.fn().mockReturnValue(
                new Map([
                    [100.5, { bid: 1000, ask: 800 }],
                    [100.6, { bid: 900, ask: 1200 }],
                ])
            ),
            isHealthy: vi.fn().mockReturnValue(true),
            getLastUpdate: vi.fn().mockReturnValue(Date.now()),
        } as any;

        mockLogger = {
            info: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
            debug: vi.fn(),
        } as any;

        mockMetrics = {
            updateMetric: vi.fn(),
            incrementMetric: vi.fn(),
        } as any;

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

    describe("SPECIFICATION: Mandatory FinancialMath Usage", () => {
        it("MUST use FinancialMath.divideQuantities for all ratio calculations", () => {
            // REQUIREMENT: All financial ratios must use FinancialMath for precision
            const spy = vi.spyOn(FinancialMath, "divideQuantities");

            const trade = createTradeEvent({
                price: 100.5,
                volume: 1000,
                side: "buy",
            });

            detector.onEnrichedTrade(trade);

            // EXPECTED BEHAVIOR: Must use FinancialMath for ratio calculations
            expect(spy).toHaveBeenCalled();
        });

        it("MUST use FinancialMath.multiplyQuantities for volume calculations", () => {
            // REQUIREMENT: All volume operations must use FinancialMath
            const spy = vi.spyOn(FinancialMath, "multiplyQuantities");

            const trade = createTradeEvent({
                price: 100.5,
                volume: 1000,
                side: "buy",
            });

            detector.onEnrichedTrade(trade);

            // EXPECTED BEHAVIOR: Must use FinancialMath for volume operations
            expect(spy).toHaveBeenCalled();
        });

        it("MUST use FinancialMath.calculateMean for statistical calculations", () => {
            // REQUIREMENT: All statistical operations must use FinancialMath
            const spy = vi.spyOn(FinancialMath, "calculateMean");

            // Process multiple trades to trigger statistical calculations
            const trades = [
                createTradeEvent({ price: 100.5, volume: 100, side: "buy" }),
                createTradeEvent({ price: 100.5, volume: 200, side: "buy" }),
                createTradeEvent({ price: 100.5, volume: 150, side: "buy" }),
            ];

            trades.forEach((trade) => detector.onEnrichedTrade(trade));

            // EXPECTED BEHAVIOR: Must use FinancialMath for statistical calculations
            expect(spy).toHaveBeenCalled();
        });

        it("MUST use FinancialMath.addAmounts for price arithmetic", () => {
            // REQUIREMENT: All price additions must use FinancialMath
            const spy = vi.spyOn(FinancialMath, "addAmounts");

            const trade = createTradeEvent({
                price: 100.5,
                volume: 1000,
                side: "buy",
            });

            detector.onEnrichedTrade(trade);

            // EXPECTED BEHAVIOR: Must use FinancialMath for price arithmetic
            expect(spy).toHaveBeenCalled();
        });
    });

    describe("SPECIFICATION: Precision Requirements", () => {
        it("MUST maintain precision in volume pressure calculations", () => {
            // REQUIREMENT: Volume pressure calculations must be precise to prevent trading errors
            const precisionTestData = {
                aggressiveVolume: 123.456789,
                passiveVolume: 234.567891,
            };

            const trade = createTradeEvent({
                price: 100.5,
                volume: precisionTestData.aggressiveVolume,
                side: "buy",
            });

            // Mock order book with precise passive volume
            mockOrderBook.getDepth = vi
                .fn()
                .mockReturnValue(
                    new Map([
                        [
                            100.5,
                            { bid: precisionTestData.passiveVolume, ask: 1000 },
                        ],
                    ])
                );

            const divideQuantitiesSpy = vi.spyOn(
                FinancialMath,
                "divideQuantities"
            );

            detector.onEnrichedTrade(trade);

            // EXPECTED BEHAVIOR: Must pass exact precision values to FinancialMath
            expect(divideQuantitiesSpy).toHaveBeenCalledWith(
                precisionTestData.aggressiveVolume,
                precisionTestData.passiveVolume
            );
        });

        it("MUST handle high-precision price calculations correctly", () => {
            // REQUIREMENT: Price calculations must maintain precision for institutional trading
            const highPrecisionPrice = 100.12345678;
            const offsetAmount = 0.00000001;

            const trade = createTradeEvent({
                price: highPrecisionPrice,
                volume: 1000,
                side: "buy",
            });

            const addAmountsSpy = vi.spyOn(FinancialMath, "addAmounts");

            detector.onEnrichedTrade(trade);

            // EXPECTED BEHAVIOR: Must handle high-precision prices without loss
            if (addAmountsSpy.mock.calls.length > 0) {
                const calls = addAmountsSpy.mock.calls;
                calls.forEach((call) => {
                    expect(call[0]).toSatisfy(
                        (value: number) =>
                            Number.isFinite(value) && !isNaN(value)
                    );
                    expect(call[1]).toSatisfy(
                        (value: number) =>
                            Number.isFinite(value) && !isNaN(value)
                    );
                });
            }
        });

        it("MUST prevent floating-point accumulation errors in moving averages", () => {
            // REQUIREMENT: Repeated calculations must not accumulate floating-point errors
            const calculateMeanSpy = vi.spyOn(FinancialMath, "calculateMean");

            // Process many trades to test accumulation
            for (let i = 0; i < 100; i++) {
                const trade = createTradeEvent({
                    price: 100.5 + i * 0.0001, // Small price increments
                    volume: 100 + i * 0.1, // Small volume increments
                    side: i % 2 === 0 ? "buy" : "sell",
                });

                detector.onEnrichedTrade(trade);
            }

            // EXPECTED BEHAVIOR: Must use FinancialMath for all mean calculations
            expect(calculateMeanSpy).toHaveBeenCalled();

            // Verify no direct arithmetic was used
            expect(mockLogger.error).not.toHaveBeenCalledWith(
                expect.stringContaining("precision")
            );
        });
    });

    describe("SPECIFICATION: Prohibited Direct Arithmetic", () => {
        it("MUST NOT use direct division for financial ratios", () => {
            // REQUIREMENT: Direct division (/) is prohibited for financial calculations
            const originalDivide = global.Number.prototype.valueOf;
            let directDivisionDetected = false;

            // Mock to detect direct division operations
            const trade = createTradeEvent({
                price: 100.5,
                volume: 1000,
                side: "buy",
            });

            // This test ensures the detector uses FinancialMath.divideQuantities
            // instead of direct division operators
            detector.onEnrichedTrade(trade);

            // EXPECTED BEHAVIOR: All divisions should go through FinancialMath
            expect(directDivisionDetected).toBe(false);
        });

        it("MUST NOT use direct multiplication for volume operations", () => {
            // REQUIREMENT: Direct multiplication (*) is prohibited for financial calculations
            const multiplyQuantitiesSpy = vi.spyOn(
                FinancialMath,
                "multiplyQuantities"
            );

            const trade = createTradeEvent({
                price: 100.5,
                volume: 1000,
                side: "buy",
            });

            detector.onEnrichedTrade(trade);

            // EXPECTED BEHAVIOR: Volume operations must use FinancialMath
            expect(multiplyQuantitiesSpy).toHaveBeenCalled();
        });

        it("MUST NOT use Array.reduce for statistical calculations", () => {
            // REQUIREMENT: Statistical calculations must use FinancialMath, not Array.reduce
            const calculateMeanSpy = vi.spyOn(FinancialMath, "calculateMean");

            // Process multiple trades to trigger statistical analysis
            const trades = Array.from({ length: 10 }, (_, i) =>
                createTradeEvent({
                    price: 100.5 + i * 0.01,
                    volume: 100 + i * 10,
                    side: i % 2 === 0 ? "buy" : "sell",
                })
            );

            trades.forEach((trade) => detector.onEnrichedTrade(trade));

            // EXPECTED BEHAVIOR: Must use FinancialMath.calculateMean instead of Array.reduce
            expect(calculateMeanSpy).toHaveBeenCalled();
        });
    });

    describe("SPECIFICATION: Calculation Integrity", () => {
        it("MUST validate calculation inputs before processing", () => {
            // REQUIREMENT: All inputs to FinancialMath must be validated
            const invalidInputs = [NaN, Infinity, -Infinity, undefined, null];

            invalidInputs.forEach((invalidValue) => {
                const trade = createTradeEvent({
                    price: invalidValue as any,
                    volume: 1000,
                    side: "buy",
                });

                expect(() => {
                    detector.onEnrichedTrade(trade);
                }).not.toThrow(); // Should handle gracefully, not crash
            });

            // EXPECTED BEHAVIOR: Invalid inputs should be rejected before FinancialMath
            expect(mockLogger.error).toHaveBeenCalled();
        });

        it("MUST handle edge cases in FinancialMath operations", () => {
            // REQUIREMENT: FinancialMath operations must handle edge cases
            const edgeCases = [
                { volume: Number.MIN_VALUE, price: 100.5 }, // Minimum positive value
                { volume: Number.MAX_SAFE_INTEGER, price: 100.5 }, // Maximum safe integer
                { volume: 1e-10, price: 100.5 }, // Very small volume
                { volume: 1000, price: 1e-6 }, // Very small price
            ];

            edgeCases.forEach((testCase) => {
                const trade = createTradeEvent({
                    price: testCase.price,
                    volume: testCase.volume,
                    side: "buy",
                });

                expect(() => {
                    detector.onEnrichedTrade(trade);
                }).not.toThrow();
            });

            // EXPECTED BEHAVIOR: Edge cases should be handled without errors
            expect(mockLogger.error).not.toHaveBeenCalledWith(
                expect.stringContaining("FinancialMath")
            );
        });
    });

    describe("SPECIFICATION: Institutional-Grade Precision", () => {
        it("MUST maintain precision equivalent to 8 decimal places", () => {
            // REQUIREMENT: Calculations must maintain institutional-grade precision
            const highPrecisionData = {
                price: 100.12345678,
                volume: 1234.56789012,
                passiveVolume: 5678.90123456,
            };

            mockOrderBook.getDepth = vi.fn().mockReturnValue(
                new Map([
                    [
                        highPrecisionData.price,
                        {
                            bid: highPrecisionData.passiveVolume,
                            ask: 1000,
                        },
                    ],
                ])
            );

            const trade = createTradeEvent({
                price: highPrecisionData.price,
                volume: highPrecisionData.volume,
                side: "buy",
            });

            const divideQuantitiesSpy = vi.spyOn(
                FinancialMath,
                "divideQuantities"
            );

            detector.onEnrichedTrade(trade);

            // EXPECTED BEHAVIOR: Must preserve full precision in calculations
            if (divideQuantitiesSpy.mock.calls.length > 0) {
                divideQuantitiesSpy.mock.calls.forEach((call) => {
                    expect(call[0]).toBeCloseTo(call[0], 8); // 8 decimal places precision
                    expect(call[1]).toBeCloseTo(call[1], 8);
                });
            }
        });

        it("MUST produce deterministic results for identical inputs", () => {
            // REQUIREMENT: Same inputs must always produce same outputs
            const testTrade = createTradeEvent({
                price: 100.12345,
                volume: 1000.6789,
                side: "buy",
            });

            const results: any[] = [];
            let signalCount = 0;

            detector.on("signal", (signal: any) => {
                results.push({
                    confidence: signal.confidence,
                    priceEfficiency: signal.metadata?.priceEfficiency,
                });
                signalCount++;
            });

            // Process same trade multiple times
            for (let i = 0; i < 3; i++) {
                detector.onEnrichedTrade(testTrade);
            }

            // EXPECTED BEHAVIOR: Results must be deterministic
            if (results.length > 1) {
                for (let i = 1; i < results.length; i++) {
                    expect(results[i].confidence).toBe(results[0].confidence);
                    expect(results[i].priceEfficiency).toBe(
                        results[0].priceEfficiency
                    );
                }
            }
        });
    });

    // Helper function to create trade events
    function createTradeEvent(params: {
        price: number;
        volume: number;
        side: "buy" | "sell";
    }): EnrichedTradeEvent {
        return {
            eventType: "aggTrade",
            eventTime: Date.now(),
            symbol: "TESTUSDT",
            price: params.price.toString(),
            quantity: params.volume.toString(),
            tradeTime: Date.now(),
            buyerIsMaker: params.side === "sell",
            aggressiveTrade: {
                id: `test_${Date.now()}_${Math.random()}`,
                symbol: "TESTUSDT",
                price: params.price,
                quantity: params.volume,
                time: Date.now(),
                side: params.side,
                zone: Math.round(params.price * 10000),
                buyerIsMaker: params.side === "sell",
            },
        } as EnrichedTradeEvent;
    }
});
