import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { EventEmitter } from "events";

// Mock the required dependencies
vi.mock("../src/multithreading/workerLogger");
vi.mock("../src/infrastructure/metricsCollector");
vi.mock("../src/utils/financialMath");

import { OrderflowPreprocessor } from "../src/market/orderFlowPreprocessor";
import { WorkerLogger } from "../src/multithreading/workerLogger";
import { MetricsCollector } from "../src/infrastructure/metricsCollector";
import { FinancialMath } from "../src/utils/financialMath";
import type { SpotWebsocketStreams } from "@binance/spot";

// Helper function to create complete OrderflowPreprocessor configuration
function createTestConfig(overrides: any = {}) {
    return {
        pricePrecision: 2,
        quantityPrecision: 8,
        bandTicks: 5,
        tickSize: 0.01,
        symbol: "LTCUSDT",
        enableIndividualTrades: false,
        largeTradeThreshold: 100,
        maxEventListeners: 50,
        dashboardUpdateInterval: 200,
        maxDashboardInterval: 1000,
        significantChangeThreshold: 0.001,
        enableStandardizedZones: true,
        standardZoneConfig: {
            baseTicks: 5,
            zoneMultipliers: [1, 2, 4],
            timeWindows: [30000, 60000, 300000], // 30s, 60s, 5min
            adaptiveMode: false,
            volumeThresholds: {
                aggressive: 10.0,
                passive: 5.0,
                institutional: 50.0,
            },
            priceThresholds: {
                significantMove: 0.001, // 0.1%
                majorMove: 0.005, // 0.5%
            },
            maxZones: 100,
            zoneTimeoutMs: 300000,
        },
        maxZoneCacheAgeMs: 5400000,
        adaptiveZoneLookbackTrades: 500,
        zoneCalculationRange: 12,
        zoneCacheSize: 375,
        defaultZoneMultipliers: [1, 2, 4],
        defaultTimeWindows: [300000, 900000, 1800000, 3600000, 5400000],
        defaultMinZoneWidthMultiplier: 2,
        defaultMaxZoneWidthMultiplier: 10,
        defaultMaxZoneHistory: 2000,
        defaultMaxMemoryMB: 50,
        defaultAggressiveVolumeAbsolute: 10.0,
        defaultPassiveVolumeAbsolute: 5.0,
        defaultInstitutionalVolumeAbsolute: 50.0,
        ...overrides,
    };
}

describe("OrderFlowPreprocessor Logic Tests", () => {
    let preprocessor: OrderflowPreprocessor;
    let mockOrderBook: any;
    let mockLogger: any;
    let mockMetrics: any;
    let eventSpy: any;

    beforeEach(() => {
        // Reset all mocks
        vi.clearAllMocks();

        // Mock FinancialMath static methods
        vi.mocked(FinancialMath.parsePrice).mockImplementation(
            (price: string) => parseFloat(price)
        );
        vi.mocked(FinancialMath.parseQuantity).mockImplementation(
            (qty: string) => parseFloat(qty)
        );
        vi.mocked(FinancialMath.normalizeQuantity).mockImplementation(
            (qty: number, precision: number) => Number(qty.toFixed(precision))
        );
        vi.mocked(FinancialMath.normalizePriceToTick).mockImplementation(
            (price: number, tickSize: number) =>
                Math.round(price / tickSize) * tickSize
        );
        vi.mocked(FinancialMath.priceToZone).mockImplementation(
            (price: number, tickSize: number) =>
                Math.floor(price / tickSize) * tickSize
        );

        // Mock logger
        mockLogger = new WorkerLogger();
        mockLogger.info = vi.fn();
        mockLogger.warn = vi.fn();
        mockLogger.error = vi.fn();

        // Mock metrics
        mockMetrics = new MetricsCollector();
        mockMetrics.incrementMetric = vi.fn();

        // Mock order book
        mockOrderBook = {
            updateDepth: vi.fn(),
            getLevel: vi.fn().mockReturnValue({ bid: 100, ask: 50 }),
            getBestBid: vi.fn().mockReturnValue(99.5),
            getBestAsk: vi.fn().mockReturnValue(99.51),
            getSpread: vi.fn().mockReturnValue(0.01),
            getMidPrice: vi.fn().mockReturnValue(99.505),
            sumBand: vi.fn().mockReturnValue({ bid: 200, ask: 150 }),
            snapshot: vi.fn().mockReturnValue(
                new Map([
                    [
                        99.5,
                        {
                            price: 99.5,
                            bid: 100,
                            ask: 0,
                            timestamp: Date.now(),
                        },
                    ],
                    [
                        99.51,
                        {
                            price: 99.51,
                            bid: 0,
                            ask: 50,
                            timestamp: Date.now(),
                        },
                    ],
                ])
            ),
            getDepthMetrics: vi.fn().mockReturnValue({
                totalLevels: 10,
                bidLevels: 5,
                askLevels: 5,
                totalBidVolume: 1000,
                totalAskVolume: 900,
                imbalance: 0.1,
            }),
        };

        // Create event spy to track all events
        eventSpy = vi.fn();
    });

    afterEach(() => {
        if (preprocessor) {
            preprocessor.shutdown();
        }
    });

    describe("Trade Validation Logic", () => {
        beforeEach(() => {
            preprocessor = new OrderflowPreprocessor(
                createTestConfig({ largeTradeThreshold: 100 }),
                mockOrderBook,
                mockLogger,
                mockMetrics
            );
        });

        it("should reject trades with missing required fields", async () => {
            const invalidTrades = [
                { e: "aggTrade", T: Date.now(), p: "100", q: "1" }, // missing 's'
                { e: "aggTrade", T: Date.now(), q: "1", s: "BTCUSDT" }, // missing 'p'
                { e: "aggTrade", p: "100", q: "1", s: "BTCUSDT" }, // missing 'T'
                { T: Date.now(), p: "100", q: "1", s: "BTCUSDT" }, // missing 'e'
                { e: "aggTrade", T: Date.now(), p: "100", s: "BTCUSDT" }, // missing 'q'
            ];

            // Reset metrics spy before testing
            mockMetrics.incrementMetric.mockClear();

            for (const trade of invalidTrades) {
                // handleAggTrade catches errors internally, so it won't throw
                await preprocessor.handleAggTrade(trade as any);

                // Verify error metric was incremented for validation failure
                expect(mockMetrics.incrementMetric).toHaveBeenCalledWith(
                    "invalidTrades"
                );

                // Verify error was logged
                expect(mockLogger.error).toHaveBeenCalled();

                // Reset for next iteration
                mockMetrics.incrementMetric.mockClear();
                mockLogger.error.mockClear();
            }
        });

        it("should accept valid trades with all required fields", async () => {
            const validTrade = {
                e: "aggTrade",
                T: Date.now(),
                p: "100.50",
                q: "1.5",
                s: "BTCUSDT",
                m: false,
                a: 12345,
            };

            // Should not throw
            await expect(
                preprocessor.handleAggTrade(validTrade as any)
            ).resolves.not.toThrow();

            // Should not increment invalid trades metric
            expect(mockMetrics.incrementMetric).not.toHaveBeenCalledWith(
                "invalidTrades"
            );
        });

        it("should handle FinancialMath parsing failures gracefully", async () => {
            // Mock FinancialMath to throw on invalid data
            vi.mocked(FinancialMath.parsePrice).mockImplementation(() => {
                throw new Error("Invalid price format");
            });

            const trade = {
                e: "aggTrade",
                T: Date.now(),
                p: "invalid",
                q: "1.5",
                s: "BTCUSDT",
            };

            // handleAggTrade catches errors internally, should not throw
            await preprocessor.handleAggTrade(trade as any);

            // Should call error handler with correlation ID
            expect(mockLogger.error).toHaveBeenCalledWith(
                expect.stringContaining("Invalid price format"),
                expect.objectContaining({
                    context: "OrderflowPreprocessor.handleAggTrade",
                    correlationId: expect.any(String),
                }),
                expect.any(String)
            );
        });
    });

    describe("Dashboard Update Timing Logic", () => {
        beforeEach(() => {
            preprocessor = new OrderflowPreprocessor(
                createTestConfig({
                    dashboardUpdateInterval: 200,
                    maxDashboardInterval: 1000,
                    significantChangeThreshold: 0.01, // 1%
                }),
                mockOrderBook,
                mockLogger,
                mockMetrics
            );
        });

        it("should respect minimum dashboard update interval", () => {
            const now = Date.now();

            // Access private method
            const shouldUpdateDashboard = (
                preprocessor as any
            ).shouldUpdateDashboard.bind(preprocessor);

            // First call should allow update (lastDashboardUpdate starts at 0)
            expect(shouldUpdateDashboard(100, now)).toBe(true);

            // Set last update time to simulate a recent update
            (preprocessor as any).lastDashboardUpdate = now;
            (preprocessor as any).lastDashboardMidPrice = 100;

            // Immediate subsequent call should be blocked (within 200ms interval)
            expect(shouldUpdateDashboard(100, now + 100)).toBe(false);

            // Call after minimum interval but before max interval with same price should be blocked
            expect(shouldUpdateDashboard(100, now + 250)).toBe(false);

            // Call after minimum interval with significant price change should be allowed
            expect(shouldUpdateDashboard(101.5, now + 250)).toBe(true);
        });

        it("should force update after maximum interval", () => {
            const shouldUpdateDashboard = (
                preprocessor as any
            ).shouldUpdateDashboard.bind(preprocessor);
            const now = Date.now();

            // Set last update time
            (preprocessor as any).lastDashboardUpdate = now;
            (preprocessor as any).lastDashboardMidPrice = 100;

            // Should force update after max interval even with same price
            expect(shouldUpdateDashboard(100, now + 1100)).toBe(true);
        });

        it("should trigger update on significant price change", () => {
            const shouldUpdateDashboard = (
                preprocessor as any
            ).shouldUpdateDashboard.bind(preprocessor);
            const now = Date.now();

            // Set initial state
            (preprocessor as any).lastDashboardUpdate = now;
            (preprocessor as any).lastDashboardMidPrice = 100;

            // Small change should not trigger (within threshold)
            expect(shouldUpdateDashboard(100.5, now + 250)).toBe(false);

            // Significant change should trigger (1.5% > 1% threshold)
            expect(shouldUpdateDashboard(101.5, now + 250)).toBe(true);
        });
    });

    describe("Large Trade Threshold Logic", () => {
        it("should include snapshot for trades above threshold", async () => {
            preprocessor = new OrderflowPreprocessor(
                createTestConfig({ largeTradeThreshold: 100 }),
                mockOrderBook,
                mockLogger,
                mockMetrics
            );

            let capturedTrade: any;
            preprocessor.on("enriched_trade", (trade) => {
                capturedTrade = trade;
            });

            const largeTrade = {
                e: "aggTrade",
                T: Date.now(),
                p: "100",
                q: "150", // Above threshold
                s: "BTCUSDT",
                a: 1,
            };

            await preprocessor.handleAggTrade(largeTrade as any);

            expect(capturedTrade.depthSnapshot).toBeDefined();
            expect(mockOrderBook.snapshot).toHaveBeenCalled();
        });

        it("should not include snapshot for trades below threshold", async () => {
            preprocessor = new OrderflowPreprocessor(
                createTestConfig({ largeTradeThreshold: 100 }),
                mockOrderBook,
                mockLogger,
                mockMetrics
            );

            let capturedTrade: any;
            preprocessor.on("enriched_trade", (trade) => {
                capturedTrade = trade;
            });

            const smallTrade = {
                e: "aggTrade",
                T: Date.now(),
                p: "100",
                q: "50", // Below threshold
                s: "BTCUSDT",
                a: 1,
            };

            await preprocessor.handleAggTrade(smallTrade as any);

            expect(capturedTrade.depthSnapshot).toBeUndefined();
        });
    });

    describe("Event Emission Logic", () => {
        beforeEach(() => {
            preprocessor = new OrderflowPreprocessor(
                createTestConfig(),
                mockOrderBook,
                mockLogger,
                mockMetrics
            );
        });

        it("should emit separate orderbook_update and dashboard events", () => {
            const orderBookEvents: any[] = [];
            const dashboardEvents: any[] = [];

            preprocessor.on("orderbook_update", (event) =>
                orderBookEvents.push(event)
            );
            preprocessor.on("dashboard_orderbook_update", (event) =>
                dashboardEvents.push(event)
            );

            const depthUpdate = {
                E: Date.now(),
                s: "BTCUSDT",
                U: 1,
                u: 2,
                b: [["99.50", "100"]],
                a: [["99.51", "50"]],
            };

            preprocessor.handleDepth(depthUpdate as any);

            // Should emit orderbook_update immediately
            expect(orderBookEvents).toHaveLength(1);
            expect(orderBookEvents[0].depthSnapshot).toBeUndefined(); // No snapshot in trading signal event

            // Dashboard event comes from timer, so we verify it's configured
            expect((preprocessor as any).dashboardUpdateTimer).toBeDefined();
        });

        it("should emit best_quotes_update on depth changes", () => {
            const quotesEvents: any[] = [];
            preprocessor.on("best_quotes_update", (event) =>
                quotesEvents.push(event)
            );

            const depthUpdate = {
                E: Date.now(),
                s: "BTCUSDT",
                U: 1,
                u: 2,
                b: [["99.50", "100"]],
                a: [["99.51", "50"]],
            };

            preprocessor.handleDepth(depthUpdate as any);

            expect(quotesEvents).toHaveLength(1);
            expect(quotesEvents[0]).toMatchObject({
                bestBid: 99.5,
                bestAsk: 99.51,
                spread: 0.01,
            });
        });

        it("should emit processing_metrics periodically", async () => {
            const metricsEvents: any[] = [];
            preprocessor.on("processing_metrics", (event) =>
                metricsEvents.push(event)
            );

            // Process 101 trades to trigger metrics emission (every 100)
            for (let i = 1; i <= 101; i++) {
                const trade = {
                    e: "aggTrade",
                    T: Date.now(),
                    p: "100",
                    q: "1",
                    s: "BTCUSDT",
                    a: i,
                };
                await preprocessor.handleAggTrade(trade as any);
            }

            // Should emit metrics after 100th trade
            expect(metricsEvents).toHaveLength(1);
            expect(metricsEvents[0].processedTrades).toBe(100);
        });
    });

    describe("Individual Trades Enhancement Logic", () => {
        let mockIndividualTradesManager: any;
        let mockMicrostructureAnalyzer: any;

        beforeEach(() => {
            mockIndividualTradesManager = {
                shouldFetchIndividualTrades: vi.fn(),
                enhanceAggTradeWithIndividuals: vi.fn(),
            };

            mockMicrostructureAnalyzer = {
                analyze: vi.fn().mockReturnValue({
                    fragmentationScore: 0.5,
                    toxicityScore: 0.3,
                    suspectedAlgoType: "iceberg",
                }),
            };

            preprocessor = new OrderflowPreprocessor(
                createTestConfig({ enableIndividualTrades: true }),
                mockOrderBook,
                mockLogger,
                mockMetrics,
                mockIndividualTradesManager,
                mockMicrostructureAnalyzer
            );
        });

        it("should decide whether to fetch individual trades based on manager logic", async () => {
            // Mock manager to say "should fetch"
            mockIndividualTradesManager.shouldFetchIndividualTrades.mockReturnValue(
                true
            );
            mockIndividualTradesManager.enhanceAggTradeWithIndividuals.mockResolvedValue(
                {
                    hasIndividualData: true,
                    individualTrades: [{ id: 1, price: 100, quantity: 1 }],
                    price: 100,
                    quantity: 1,
                    timestamp: Date.now(),
                    buyerIsMaker: false,
                    pair: "BTCUSDT",
                    tradeId: "1",
                    originalTrade: {},
                    passiveBidVolume: 0,
                    passiveAskVolume: 0,
                    zonePassiveBidVolume: 0,
                    zonePassiveAskVolume: 0,
                }
            );

            let capturedTrade: any;
            preprocessor.on("enriched_trade", (trade) => {
                capturedTrade = trade;
            });

            const trade = {
                e: "aggTrade",
                T: Date.now(),
                p: "100",
                q: "1",
                s: "BTCUSDT",
                a: 1,
            };

            await preprocessor.handleAggTrade(trade as any);

            expect(
                mockIndividualTradesManager.shouldFetchIndividualTrades
            ).toHaveBeenCalled();
            expect(
                mockIndividualTradesManager.enhanceAggTradeWithIndividuals
            ).toHaveBeenCalled();
            expect(capturedTrade.hasIndividualData).toBe(true);
            expect(mockMetrics.incrementMetric).toHaveBeenCalledWith(
                "hybridTradesProcessed"
            );
        });

        it("should handle individual trades enhancement failure gracefully", async () => {
            mockIndividualTradesManager.shouldFetchIndividualTrades.mockReturnValue(
                true
            );
            mockIndividualTradesManager.enhanceAggTradeWithIndividuals.mockRejectedValue(
                new Error("Enhancement failed")
            );

            let capturedTrade: any;
            preprocessor.on("enriched_trade", (trade) => {
                capturedTrade = trade;
            });

            const trade = {
                e: "aggTrade",
                T: Date.now(),
                p: "100",
                q: "1",
                s: "BTCUSDT",
                a: 1,
            };

            await preprocessor.handleAggTrade(trade as any);

            // Should fallback to basic trade
            expect(capturedTrade.hasIndividualData).toBe(false);
            expect(capturedTrade.tradeComplexity).toBe("simple");
            expect(mockLogger.warn).toHaveBeenCalledWith(
                expect.stringContaining("Individual trades enhancement failed"),
                expect.any(Object),
                expect.any(String) // correlation ID
            );
            expect(mockMetrics.incrementMetric).toHaveBeenCalledWith(
                "individualTradesEnhancementErrors"
            );
        });

        it("should handle microstructure analysis failure gracefully", async () => {
            mockIndividualTradesManager.shouldFetchIndividualTrades.mockReturnValue(
                true
            );
            mockIndividualTradesManager.enhanceAggTradeWithIndividuals.mockResolvedValue(
                {
                    hasIndividualData: true,
                    individualTrades: [{ id: 1, price: 100, quantity: 1 }],
                    price: 100,
                    quantity: 1,
                    timestamp: Date.now(),
                    buyerIsMaker: false,
                    pair: "BTCUSDT",
                    tradeId: "1",
                    originalTrade: {},
                    passiveBidVolume: 0,
                    passiveAskVolume: 0,
                    zonePassiveBidVolume: 0,
                    zonePassiveAskVolume: 0,
                }
            );

            // Mock microstructure analyzer to fail
            mockMicrostructureAnalyzer.analyze.mockImplementation(() => {
                throw new Error("Analysis failed");
            });

            let capturedTrade: any;
            preprocessor.on("enriched_trade", (trade) => {
                capturedTrade = trade;
            });

            const trade = {
                e: "aggTrade",
                T: Date.now(),
                p: "100",
                q: "1",
                s: "BTCUSDT",
                a: 1,
            };

            await preprocessor.handleAggTrade(trade as any);

            // Should continue without microstructure data
            expect(capturedTrade.hasIndividualData).toBe(true);
            expect(capturedTrade.microstructure).toBeUndefined();
            expect(mockLogger.warn).toHaveBeenCalledWith(
                expect.stringContaining("Microstructure analysis failed"),
                expect.any(Object),
                expect.any(String) // correlation ID
            );
        });
    });

    describe("Error Handling Logic", () => {
        beforeEach(() => {
            preprocessor = new OrderflowPreprocessor(
                createTestConfig(),
                mockOrderBook,
                mockLogger,
                mockMetrics
            );
        });

        it("should generate and propagate correlation IDs for depth errors", () => {
            // Mock order book to throw
            mockOrderBook.updateDepth.mockImplementation(() => {
                throw new Error("Order book error");
            });

            const depthUpdate = {
                E: Date.now(),
                s: "BTCUSDT",
                U: 1,
                u: 2,
                b: [["99.50", "100"]],
                a: [["99.51", "50"]],
            };

            // Should not throw, but handle error internally
            expect(() =>
                preprocessor.handleDepth(depthUpdate as any)
            ).not.toThrow();

            // Should call error logger with correlation ID
            expect(mockLogger.error).toHaveBeenCalledWith(
                expect.stringContaining("Order book error"),
                expect.objectContaining({
                    context: "OrderflowPreprocessor.handleDepth",
                    correlationId: expect.any(String),
                }),
                expect.any(String) // correlation ID
            );
        });

        it("should generate and propagate correlation IDs for trade errors", async () => {
            // Mock FinancialMath to throw during normalization
            vi.mocked(FinancialMath.normalizeQuantity).mockImplementation(
                () => {
                    throw new Error("Normalization error");
                }
            );

            const trade = {
                e: "aggTrade",
                T: Date.now(),
                p: "100",
                q: "1",
                s: "BTCUSDT",
                a: 1,
            };

            // Should not throw, but handle error internally
            await expect(
                preprocessor.handleAggTrade(trade as any)
            ).resolves.not.toThrow();

            // Should call error logger with correlation ID
            expect(mockLogger.error).toHaveBeenCalledWith(
                expect.stringContaining("Normalization error"),
                expect.objectContaining({
                    context: "OrderflowPreprocessor.handleAggTrade",
                    correlationId: expect.any(String),
                }),
                expect.any(String) // correlation ID
            );
        });

        it("should include correlation ID in trade validation errors", async () => {
            const invalidTrade = {
                e: "aggTrade",
                T: Date.now(),
                p: "100",
                // Missing required fields (q and s)
            };

            // handleAggTrade catches errors internally, should not throw
            await preprocessor.handleAggTrade(invalidTrade as any);

            // Should call error handler with correlation ID
            expect(mockLogger.error).toHaveBeenCalledWith(
                expect.stringContaining(
                    "Invalid trade structure - correlationId:"
                ),
                expect.objectContaining({
                    context: "OrderflowPreprocessor.handleAggTrade",
                    correlationId: expect.any(String),
                }),
                expect.any(String)
            );
        });
    });

    describe("Configuration Logic", () => {
        it("should apply custom configuration options correctly", () => {
            const customOptions = {
                pricePrecision: 4,
                quantityPrecision: 6,
                bandTicks: 10,
                tickSize: 0.0001,
                largeTradeThreshold: 500,
                maxEventListeners: 100,
                dashboardUpdateInterval: 500,
                maxDashboardInterval: 2000,
                significantChangeThreshold: 0.005,
            };

            const customPreprocessor = new OrderflowPreprocessor(
                createTestConfig(customOptions),
                mockOrderBook,
                mockLogger,
                mockMetrics
            );

            const stats = customPreprocessor.getStats();
            expect(stats).toBeDefined();

            // Verify configuration is applied by checking behavior
            const shouldUpdateDashboard = (
                customPreprocessor as any
            ).shouldUpdateDashboard.bind(customPreprocessor);
            const now = Date.now();

            // Set initial state
            (customPreprocessor as any).lastDashboardUpdate = now;
            (customPreprocessor as any).lastDashboardMidPrice = 100;

            // Should respect custom update interval (500ms)
            // - should be blocked within interval
            expect(shouldUpdateDashboard(100, now + 400)).toBe(false);
            // - should still be blocked after interval with same price (needs max interval or price change)
            expect(shouldUpdateDashboard(100, now + 600)).toBe(false);
            // - should be allowed after max interval (2000ms)
            expect(shouldUpdateDashboard(100, now + 2100)).toBe(true);

            customPreprocessor.shutdown();
        });

        it("should use default values when options not provided", () => {
            const defaultPreprocessor = new OrderflowPreprocessor(
                createTestConfig(),
                mockOrderBook,
                mockLogger,
                mockMetrics
            );

            // Should not throw and should work with defaults
            expect(() => defaultPreprocessor.getStats()).not.toThrow();

            defaultPreprocessor.shutdown();
        });
    });

    describe("State Management Logic", () => {
        beforeEach(() => {
            preprocessor = new OrderflowPreprocessor(
                createTestConfig(),
                mockOrderBook,
                mockLogger,
                mockMetrics
            );
        });

        it("should track processing statistics correctly", async () => {
            const initialStats = preprocessor.getStats();
            expect(initialStats.processedTrades).toBe(0);
            expect(initialStats.processedDepthUpdates).toBe(0);

            // Process some trades and depth updates
            await preprocessor.handleAggTrade({
                e: "aggTrade",
                T: Date.now(),
                p: "100",
                q: "1",
                s: "BTCUSDT",
                a: 1,
            } as any);

            preprocessor.handleDepth({
                E: Date.now(),
                s: "BTCUSDT",
                U: 1,
                u: 2,
                b: [["99.50", "100"]],
                a: [["99.51", "50"]],
            } as any);

            const updatedStats = preprocessor.getStats();
            expect(updatedStats.processedTrades).toBe(1);
            expect(updatedStats.processedDepthUpdates).toBe(1);
        });

        it("should handle shutdown logic correctly", () => {
            // Timer should be initialized
            expect((preprocessor as any).dashboardUpdateTimer).toBeDefined();

            preprocessor.shutdown();

            // Timer should be cleared
            expect((preprocessor as any).dashboardUpdateTimer).toBeUndefined();
            expect(mockLogger.info).toHaveBeenCalledWith(
                expect.stringContaining("Dashboard timer cleared")
            );
        });
    });
});
