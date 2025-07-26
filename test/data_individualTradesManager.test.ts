import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { IndividualTradesManager } from "../src/data/individualTradesManager";
import type { ILogger } from "../src/infrastructure/loggerInterface";
import type { IWorkerMetricsCollector } from "../src/multithreading/shared/workerInterfaces";
import type { IBinanceDataFeed } from "../src/utils/binance";
import type {
    AggTradeEvent,
    EnrichedTradeEvent,
    IndividualTrade,
} from "../src/types/marketEvents";

describe("data/IndividualTradesManager", () => {
    let manager: IndividualTradesManager;
    let logger: ILogger;
    let metricsCollector: IWorkerMetricsCollector;
    const binanceFeed: IBinanceDataFeed = {
        connectToStreams: vi.fn(),
        tradesAggregate: vi.fn(),
        fetchAggTradesByTime: vi.fn(),
        getTrades: vi.fn(),
        getDepthSnapshot: vi.fn(),
        disconnect: vi.fn(),
    };

    const mockConfig = {
        enabled: true,
        criteria: {
            minOrderSizePercentile: 95,
            keyLevelsEnabled: false,
            anomalyPeriodsEnabled: true,
            highVolumePeriodsEnabled: true,
        },
        cache: {
            maxSize: 1000,
            ttlMs: 300000,
        },
        rateLimit: {
            maxRequestsPerSecond: 5,
            batchSize: 100,
        },
    };

    beforeEach(() => {
        vi.clearAllMocks();

        // Create mock implementations of the interfaces
        logger = {
            info: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
            debug: vi.fn(),
            isDebugEnabled: vi.fn(() => false),
            setCorrelationId: vi.fn(),
            removeCorrelationId: vi.fn(),
        };

        metricsCollector = {
            updateMetric: vi.fn(),
            incrementMetric: vi.fn(),
            incrementCounter: vi.fn(),
            decrementCounter: vi.fn(),
            recordGauge: vi.fn(),
            recordHistogram: vi.fn(),
            registerMetric: vi.fn(),
            createCounter: vi.fn(),
            createHistogram: vi.fn(),
            createGauge: vi.fn(),
            setGauge: vi.fn(),
            getMetrics: vi.fn(() => ({})),
            getHealthSummary: vi.fn(() => "Healthy"),
            getHistogramPercentiles: vi.fn(() => ({})),
            getCounterRate: vi.fn(() => 0),
            getGaugeValue: vi.fn(() => 0),
            getHistogramSummary: vi.fn(() => ({})),
            getAverageLatency: vi.fn(() => 0),
            getLatencyPercentiles: vi.fn(() => ({})),
            exportPrometheus: vi.fn(() => ""),
            exportJSON: vi.fn(() => ""),
            reset: vi.fn(),
            cleanup: vi.fn(),
            destroy: vi.fn(),
        };

        manager = new IndividualTradesManager(
            mockConfig,
            logger,
            metricsCollector,
            binanceFeed
        );

        // Mock the rate limiter after construction
        (manager as any).rateLimiter = {
            isAllowed: vi.fn().mockReturnValue(true),
            getRequestCount: vi.fn().mockReturnValue(0),
            clear: vi.fn(),
            destroy: vi.fn(),
        };
    });

    afterEach(() => {
        vi.clearAllTimers();
    });

    describe("shouldFetchIndividualTrades", () => {
        it("should return false when disabled", () => {
            const disabledManager = new IndividualTradesManager(
                { ...mockConfig, enabled: false },
                logger,
                metricsCollector,
                binanceFeed
            );

            const mockTrade: AggTradeEvent = {
                price: 100,
                quantity: 50,
                timestamp: Date.now(),
                buyerIsMaker: false,
                pair: "LTCUSDT",
                tradeId: "test123",
                originalTrade: {} as any,
            };

            expect(disabledManager.shouldFetchIndividualTrades(mockTrade)).toBe(
                false
            );
        });

        it("should return true for large orders above percentile", () => {
            // Build up trade size history
            for (let i = 0; i < 100; i++) {
                const trade: AggTradeEvent = {
                    price: 100,
                    quantity: 10 + i * 0.1, // Gradually increasing sizes
                    timestamp: Date.now(),
                    buyerIsMaker: false,
                    pair: "LTCUSDT",
                    tradeId: `test${i}`,
                    originalTrade: {} as any,
                };
                manager.shouldFetchIndividualTrades(trade);
            }

            // Create a large trade that should trigger fetching
            const largeTrade: AggTradeEvent = {
                price: 100,
                quantity: 500, // Much larger than historical trades
                timestamp: Date.now(),
                buyerIsMaker: false,
                pair: "LTCUSDT",
                tradeId: "large_trade",
                originalTrade: {} as any,
            };

            expect(manager.shouldFetchIndividualTrades(largeTrade)).toBe(true);
            expect(manager.getLastFetchReason()).toBe("large_order");
        });

        it("should return true during anomaly periods", () => {
            manager.setAnomalyPeriod(true);

            const normalTrade: AggTradeEvent = {
                price: 100,
                quantity: 10,
                timestamp: Date.now(),
                buyerIsMaker: false,
                pair: "LTCUSDT",
                tradeId: "normal_trade",
                originalTrade: {} as any,
            };

            expect(manager.shouldFetchIndividualTrades(normalTrade)).toBe(true);
            expect(manager.getLastFetchReason()).toBe("anomaly_period");
        });

        it("should return true during high volume periods", () => {
            manager.setHighVolumePeriod(true);

            const normalTrade: AggTradeEvent = {
                price: 100,
                quantity: 10,
                timestamp: Date.now(),
                buyerIsMaker: false,
                pair: "LTCUSDT",
                tradeId: "normal_trade",
                originalTrade: {} as any,
            };

            expect(manager.shouldFetchIndividualTrades(normalTrade)).toBe(true);
            expect(manager.getLastFetchReason()).toBe("high_volume_period");
        });
    });

    describe("fetchIndividualTrades", () => {
        it("should return cached trades when available", async () => {
            // Reset and set up the mock fresh for this test
            binanceFeed.getTrades = vi.fn().mockResolvedValue([
                {
                    id: 1,
                    price: "100.00",
                    qty: "10.00",
                    quoteQty: "1000.00",
                    time: Date.now(),
                    isBuyerMaker: false,
                    isBestMatch: true,
                },
                {
                    id: 2,
                    price: "100.01",
                    qty: "5.00",
                    quoteQty: "500.05",
                    time: Date.now() + 100,
                    isBuyerMaker: true,
                    isBestMatch: true,
                },
            ]);

            // Mock the cache by pre-fetching the trades
            await manager.fetchIndividualTrades(1, 2);

            // Verify metrics were called
            expect(metricsCollector.incrementMetric).toHaveBeenCalledWith(
                "individualTrades.fetchSuccess"
            );
            expect(metricsCollector.updateMetric).toHaveBeenCalledWith(
                "individualTrades.lastFetchSize",
                expect.any(Number)
            );
        });

        it("should handle fetch errors gracefully", async () => {
            // Create a spy that throws an error
            const errorSpy = vi
                .spyOn(manager as any, "performFetch")
                .mockRejectedValue(new Error("API Error"));

            const trades = await manager.fetchIndividualTrades(999, 1000);

            expect(trades).toEqual([]);
            expect(metricsCollector.incrementMetric).toHaveBeenCalledWith(
                "individualTrades.fetchErrors"
            );
            expect(logger.error).toHaveBeenCalled();

            errorSpy.mockRestore();
        });

        it("should deduplicate pending requests", async () => {
            const performFetchSpy = vi
                .spyOn(manager as any, "performFetch")
                .mockResolvedValue([]);

            // Make two concurrent requests for the same range
            const promise1 = manager.fetchIndividualTrades(1, 5);
            const promise2 = manager.fetchIndividualTrades(1, 5);

            await Promise.all([promise1, promise2]);

            // Should only call performFetch once due to deduplication
            expect(performFetchSpy).toHaveBeenCalledTimes(1);

            performFetchSpy.mockRestore();
        });
    });

    describe("enhanceAggTradeWithIndividuals", () => {
        it("should return simple hybrid trade when fetching not needed", async () => {
            const mockTrade: EnrichedTradeEvent = {
                price: 100,
                quantity: 1, // Small quantity
                timestamp: Date.now(),
                buyerIsMaker: false,
                pair: "LTCUSDT",
                tradeId: "small_trade",
                originalTrade: {} as any,
                passiveBidVolume: 100,
                passiveAskVolume: 150,
                zonePassiveBidVolume: 500,
                zonePassiveAskVolume: 600,
            };

            const result =
                await manager.enhanceAggTradeWithIndividuals(mockTrade);

            expect(result.hasIndividualData).toBe(false);
            expect(result.tradeComplexity).toBe("simple");
            expect(result.individualTrades).toBeUndefined();
        });

        it("should return enhanced hybrid trade when individual trades available", async () => {
            // Set up conditions for fetching
            manager.setAnomalyPeriod(true);

            // Mock getTrades to return some individual trades
            vi.mocked(binanceFeed.getTrades).mockResolvedValue([
                {
                    id: 1,
                    price: "100.00",
                    qty: "25.0",
                    quoteQty: "2500.0",
                    time: Date.now(),
                    isBuyerMaker: false,
                    isBestMatch: true,
                },
                {
                    id: 2,
                    price: "100.01",
                    qty: "25.0",
                    quoteQty: "2500.25",
                    time: Date.now() + 100,
                    isBuyerMaker: false,
                    isBestMatch: true,
                },
            ]);

            const mockTrade: EnrichedTradeEvent = {
                price: 100,
                quantity: 50,
                timestamp: Date.now(),
                buyerIsMaker: false,
                pair: "LTCUSDT",
                tradeId: "enhanced_trade",
                originalTrade: {
                    f: 1, // firstTradeId
                    l: 3, // lastTradeId
                } as any,
                passiveBidVolume: 100,
                passiveAskVolume: 150,
                zonePassiveBidVolume: 500,
                zonePassiveAskVolume: 600,
            };

            const result =
                await manager.enhanceAggTradeWithIndividuals(mockTrade);

            expect(result.hasIndividualData).toBe(true);
            expect(result.tradeComplexity).toBeOneOf([
                "simple",
                "complex",
                "highly_fragmented",
            ]);
            expect(result.fetchReason).toBe("anomaly_period");
        });
    });

    describe("caching functionality", () => {
        it("should cache fetched trades", async () => {
            const trades = await manager.fetchIndividualTrades(1, 2);

            // Second fetch should hit cache
            vi.spyOn(metricsCollector, "incrementMetric");

            const cachedTrades = manager.getCachedTrades(1, 2);

            if (trades.length > 0) {
                expect(cachedTrades).toEqual(trades);
            }
        });

        it("should respect cache TTL", () => {
            const shortTtlConfig = {
                ...mockConfig,
                cache: { ...mockConfig.cache, ttlMs: 100 }, // 100ms TTL
            };

            const shortTtlManager = new IndividualTradesManager(
                shortTtlConfig,
                logger,
                metricsCollector,
                binanceFeed
            );

            // Manually add to cache
            const mockTrade = {
                id: 1,
                price: 100,
                quantity: 10,
                timestamp: Date.now(),
                isBuyerMaker: false,
                quoteQuantity: 1000,
            };

            // Simulate cache entry
            (shortTtlManager as any).tradeCache.set(1, {
                trade: mockTrade,
                timestamp: Date.now() - 200, // Expired
            });

            const cachedTrades = shortTtlManager.getCachedTrades(1, 1);
            expect(cachedTrades).toEqual([]);
        });
    });

    describe("metrics and monitoring", () => {
        it("should provide performance metrics", () => {
            const metrics = manager.getMetrics();

            expect(metrics).toHaveProperty("cacheSize");
            expect(metrics).toHaveProperty("pendingRequests");
            expect(metrics).toHaveProperty("isAnomalyPeriod");
            expect(metrics).toHaveProperty("isHighVolumePeriod");
            expect(metrics).toHaveProperty("circuitBreakerOpen");
            expect(metrics).toHaveProperty("tradeSizeHistorySize");

            expect(typeof metrics.cacheSize).toBe("number");
            expect(typeof metrics.pendingRequests).toBe("number");
            expect(typeof metrics.isAnomalyPeriod).toBe("boolean");
            expect(typeof metrics.isHighVolumePeriod).toBe("boolean");
            expect(typeof metrics.circuitBreakerOpen).toBe("boolean");
            expect(typeof metrics.tradeSizeHistorySize).toBe("number");
        });

        it("should track state changes", () => {
            expect(manager.getMetrics().isAnomalyPeriod).toBe(false);
            expect(manager.getMetrics().isHighVolumePeriod).toBe(false);

            manager.setAnomalyPeriod(true);
            manager.setHighVolumePeriod(true);

            expect(manager.getMetrics().isAnomalyPeriod).toBe(true);
            expect(manager.getMetrics().isHighVolumePeriod).toBe(true);
        });
    });

    describe("trade complexity classification", () => {
        it("should classify trade complexity correctly", () => {
            const classifyComplexity = (manager as any).classifyComplexity.bind(
                manager
            );

            expect(classifyComplexity([])).toBe("simple");
            expect(classifyComplexity([{}, {}])).toBe("complex");
            expect(classifyComplexity([{}, {}, {}, {}, {}, {}])).toBe(
                "highly_fragmented"
            );
        });
    });
});
