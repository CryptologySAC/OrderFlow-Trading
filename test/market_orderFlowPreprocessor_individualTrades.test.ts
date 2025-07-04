import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the WorkerLogger before importing
vi.mock("../src/multithreading/workerLogger");

import { OrderflowPreprocessor } from "../src/market/orderFlowPreprocessor";
import { OrderBookState } from "../src/market/orderBookState";
import { WorkerLogger } from "../src/multithreading/workerLogger";
import { MetricsCollector } from "../src/infrastructure/metricsCollector";
import { IndividualTradesManager } from "../src/data/individualTradesManager";
import { MicrostructureAnalyzer } from "../src/data/microstructureAnalyzer";
import type { IBinanceDataFeed } from "../src/utils/binance";
import type { SpotWebsocketStreams } from "@binance/spot";
import type {
    HybridTradeEvent,
    EnrichedTradeEvent,
} from "../src/types/marketEvents";

vi.mock("../src/infrastructure/logger");
vi.mock("../src/infrastructure/metricsCollector");
vi.mock("../src/market/orderBookState");
vi.mock("../src/data/individualTradesManager");
vi.mock("../src/data/microstructureAnalyzer");

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

describe("market/OrderflowPreprocessor - Individual Trades Integration", () => {
    let preprocessor: OrderflowPreprocessor;
    let orderBookState: OrderBookState;
    let logger: Logger;
    let metricsCollector: MetricsCollector;
    let individualTradesManager: IndividualTradesManager;
    let microstructureAnalyzer: MicrostructureAnalyzer;
    const binanceFeed: IBinanceDataFeed = {
        connectToStreams: vi.fn(),
        tradesAggregate: vi.fn(),
        fetchAggTradesByTime: vi.fn(),
        getTrades: vi.fn().mockResolvedValue([]),
        getDepthSnapshot: vi.fn(),
        disconnect: vi.fn(),
    };
    let emittedTrades: (EnrichedTradeEvent | HybridTradeEvent)[] = [];

    const mockAggTrade: SpotWebsocketStreams.AggTradeResponse = {
        e: "aggTrade",
        E: Date.now(),
        s: "LTCUSDT",
        a: 12345,
        p: "100.00",
        q: "50.0",
        f: 1001,
        l: 1005,
        T: Date.now(),
        m: false,
        M: true,
    };

    beforeEach(() => {
        vi.clearAllMocks();
        emittedTrades = [];

        logger = new WorkerLogger();
        metricsCollector = new MetricsCollector();
        orderBookState = new OrderBookState(
            {} as any,
            logger,
            metricsCollector
        );
        individualTradesManager = new IndividualTradesManager(
            {} as any,
            logger,
            metricsCollector,
            binanceFeed
        );
        microstructureAnalyzer = new MicrostructureAnalyzer(
            {} as any,
            logger,
            metricsCollector
        );

        // Mock orderBookState methods
        vi.mocked(orderBookState.getLevel).mockReturnValue({
            bid: 100,
            ask: 150,
            timestamp: Date.now(),
        });
        vi.mocked(orderBookState.sumBand).mockReturnValue({
            bid: 500,
            ask: 600,
        });
        vi.mocked(orderBookState.getBestBid).mockReturnValue(99.99);
        vi.mocked(orderBookState.getBestAsk).mockReturnValue(100.01);
        vi.mocked(orderBookState.snapshot).mockReturnValue(new Map());
    });

    describe("individual trades disabled", () => {
        beforeEach(() => {
            preprocessor = new OrderflowPreprocessor(
                createTestConfig({ enableIndividualTrades: false }),
                orderBookState,
                logger,
                metricsCollector
            );

            preprocessor.on("enriched_trade", (trade) => {
                emittedTrades.push(trade);
            });
        });

        it("should process trades normally without individual trades enhancement", async () => {
            await preprocessor.handleAggTrade(mockAggTrade);

            expect(emittedTrades).toHaveLength(1);
            const trade = emittedTrades[0];

            // Should be a basic EnrichedTradeEvent
            expect("hasIndividualData" in trade).toBe(false);
            expect(trade.price).toBe(100);
            expect(trade.quantity).toBe(50);
            expect(trade.passiveBidVolume).toBe(100);
            expect(trade.passiveAskVolume).toBe(150);
        });
    });

    describe("individual trades enabled", () => {
        beforeEach(() => {
            preprocessor = new OrderflowPreprocessor(
                createTestConfig({ enableIndividualTrades: true }),
                orderBookState,
                logger,
                metricsCollector,
                individualTradesManager,
                microstructureAnalyzer
            );

            preprocessor.on("enriched_trade", (trade) => {
                emittedTrades.push(trade);
            });
        });

        it("should process simple trades without fetching individual data", async () => {
            // Mock should not fetch individual trades
            vi.mocked(
                individualTradesManager.shouldFetchIndividualTrades
            ).mockReturnValue(false);

            await preprocessor.handleAggTrade(mockAggTrade);

            expect(emittedTrades).toHaveLength(1);
            const trade = emittedTrades[0] as HybridTradeEvent;

            expect(trade.hasIndividualData).toBe(false);
            expect(trade.tradeComplexity).toBe("simple");
            expect(trade.individualTrades).toBeUndefined();
            expect(trade.microstructure).toBeUndefined();
        });

        it("should enhance trades with individual data when criteria met", async () => {
            // Mock individual trades enhancement
            vi.mocked(
                individualTradesManager.shouldFetchIndividualTrades
            ).mockReturnValue(true);
            vi.mocked(
                individualTradesManager.enhanceAggTradeWithIndividuals
            ).mockResolvedValue({
                ...mockAggTrade,
                price: 100,
                quantity: 50,
                timestamp: Date.now(),
                buyerIsMaker: false,
                pair: "LTCUSDT",
                tradeId: "12345",
                originalTrade: mockAggTrade,
                // Required EnrichedTradeEvent properties
                passiveBidVolume: 100,
                passiveAskVolume: 150,
                zonePassiveBidVolume: 500,
                zonePassiveAskVolume: 600,
                bestBid: 99.99,
                bestAsk: 100.01,
                // HybridTradeEvent specific properties
                hasIndividualData: true,
                tradeComplexity: "complex",
                fetchReason: "large_order",
                individualTrades: [
                    {
                        id: 1001,
                        price: 100,
                        quantity: 25,
                        timestamp: Date.now(),
                        isBuyerMaker: false,
                        quoteQuantity: 2500,
                    },
                    {
                        id: 1002,
                        price: 100,
                        quantity: 25,
                        timestamp: Date.now() + 100,
                        isBuyerMaker: false,
                        quoteQuantity: 2500,
                    },
                ],
            });

            // Mock microstructure analysis
            vi.mocked(microstructureAnalyzer.analyze).mockReturnValue({
                fragmentationScore: 0.3,
                avgTradeSize: 25,
                tradeSizeVariance: 0,
                timingPattern: "uniform",
                avgTimeBetweenTrades: 100,
                toxicityScore: 0.4,
                directionalPersistence: 0.6,
                suspectedAlgoType: "unknown",
                coordinationIndicators: [],
                sizingPattern: "consistent",
                executionEfficiency: 0.8,
            });

            await preprocessor.handleAggTrade(mockAggTrade);

            expect(emittedTrades).toHaveLength(1);
            const trade = emittedTrades[0] as HybridTradeEvent;

            expect(trade.hasIndividualData).toBe(true);
            expect(trade.tradeComplexity).toBe("complex");
            expect(trade.fetchReason).toBe("large_order");
            expect(trade.individualTrades).toHaveLength(2);
            expect(trade.microstructure).toBeDefined();
            expect(trade.microstructure?.fragmentationScore).toBe(0.3);
            expect(trade.microstructure?.suspectedAlgoType).toBe("unknown");

            // Should still have basic enrichment data
            expect(trade.passiveBidVolume).toBe(100);
            expect(trade.passiveAskVolume).toBe(150);
            expect(trade.zonePassiveBidVolume).toBe(500);
            expect(trade.zonePassiveAskVolume).toBe(600);
        });

        it("should update metrics for hybrid trades processing", async () => {
            vi.mocked(
                individualTradesManager.shouldFetchIndividualTrades
            ).mockReturnValue(true);
            vi.mocked(
                individualTradesManager.enhanceAggTradeWithIndividuals
            ).mockResolvedValue({
                ...mockAggTrade,
                price: 100,
                quantity: 50,
                timestamp: Date.now(),
                buyerIsMaker: false,
                pair: "LTCUSDT",
                tradeId: "12345",
                originalTrade: mockAggTrade,
                // Required EnrichedTradeEvent properties
                passiveBidVolume: 100,
                passiveAskVolume: 150,
                zonePassiveBidVolume: 500,
                zonePassiveAskVolume: 600,
                bestBid: 99.99,
                bestAsk: 100.01,
                // HybridTradeEvent specific properties
                hasIndividualData: true,
                tradeComplexity: "complex",
                individualTrades: [],
            });

            await preprocessor.handleAggTrade(mockAggTrade);

            expect(metricsCollector.incrementMetric).toHaveBeenCalledWith(
                "hybridTradesProcessed"
            );
        });

        it("should gracefully handle individual trades enhancement errors", async () => {
            vi.mocked(
                individualTradesManager.shouldFetchIndividualTrades
            ).mockReturnValue(true);
            vi.mocked(
                individualTradesManager.enhanceAggTradeWithIndividuals
            ).mockRejectedValue(new Error("API Error"));

            await preprocessor.handleAggTrade(mockAggTrade);

            expect(emittedTrades).toHaveLength(1);
            const trade = emittedTrades[0] as HybridTradeEvent;

            // Should fallback to basic enrichment
            expect(trade.hasIndividualData).toBe(false);
            expect(trade.tradeComplexity).toBe("simple");
            expect(trade.individualTrades).toBeUndefined();

            expect(logger.warn).toHaveBeenCalledWith(
                expect.stringContaining("Individual trades enhancement failed"),
                expect.any(Object),
                expect.any(String) // correlation ID
            );
            expect(metricsCollector.incrementMetric).toHaveBeenCalledWith(
                "individualTradesEnhancementErrors"
            );
        });

        it("should handle microstructure analysis errors gracefully", async () => {
            vi.mocked(
                individualTradesManager.shouldFetchIndividualTrades
            ).mockReturnValue(true);
            vi.mocked(
                individualTradesManager.enhanceAggTradeWithIndividuals
            ).mockResolvedValue({
                ...mockAggTrade,
                price: 100,
                quantity: 50,
                timestamp: Date.now(),
                buyerIsMaker: false,
                pair: "LTCUSDT",
                tradeId: "12345",
                originalTrade: mockAggTrade,
                // Required EnrichedTradeEvent properties
                passiveBidVolume: 100,
                passiveAskVolume: 150,
                zonePassiveBidVolume: 500,
                zonePassiveAskVolume: 600,
                bestBid: 99.99,
                bestAsk: 100.01,
                // HybridTradeEvent specific properties
                hasIndividualData: true,
                tradeComplexity: "complex",
                individualTrades: [
                    {
                        id: 1001,
                        price: 100,
                        quantity: 50,
                        timestamp: Date.now(),
                        isBuyerMaker: false,
                        quoteQuantity: 5000,
                    },
                ],
            });

            vi.mocked(microstructureAnalyzer.analyze).mockImplementation(() => {
                throw new Error("Analysis Error");
            });

            await preprocessor.handleAggTrade(mockAggTrade);

            expect(emittedTrades).toHaveLength(1);
            const trade = emittedTrades[0] as HybridTradeEvent;

            // Should still have individual trades data, just no microstructure analysis
            expect(trade.hasIndividualData).toBe(true);
            expect(trade.individualTrades).toHaveLength(1);
            expect(trade.microstructure).toBeUndefined();
        });

        it("should skip microstructure analysis for trades without individual data", async () => {
            vi.mocked(
                individualTradesManager.shouldFetchIndividualTrades
            ).mockReturnValue(true);
            vi.mocked(
                individualTradesManager.enhanceAggTradeWithIndividuals
            ).mockResolvedValue({
                ...mockAggTrade,
                price: 100,
                quantity: 50,
                timestamp: Date.now(),
                buyerIsMaker: false,
                pair: "LTCUSDT",
                tradeId: "12345",
                originalTrade: mockAggTrade,
                // Required EnrichedTradeEvent properties
                passiveBidVolume: 100,
                passiveAskVolume: 150,
                zonePassiveBidVolume: 500,
                zonePassiveAskVolume: 600,
                bestBid: 99.99,
                bestAsk: 100.01,
                // HybridTradeEvent specific properties
                hasIndividualData: false, // No individual data
                tradeComplexity: "simple",
            });

            await preprocessor.handleAggTrade(mockAggTrade);

            expect(microstructureAnalyzer.analyze).not.toHaveBeenCalled();
        });
    });

    describe("configuration and initialization", () => {
        it("should warn when individual trades enabled but components not provided", () => {
            new OrderflowPreprocessor(
                createTestConfig({ enableIndividualTrades: true }),
                orderBookState,
                logger,
                metricsCollector
                // Missing individualTradesManager and microstructureAnalyzer
            );

            expect(logger.warn).toHaveBeenCalledWith(
                expect.stringContaining(
                    "Individual trades enabled but components not provided"
                )
            );
        });

        it("should log initialization with individual trades status", () => {
            new OrderflowPreprocessor(
                createTestConfig({ enableIndividualTrades: true }),
                orderBookState,
                logger,
                metricsCollector,
                individualTradesManager,
                microstructureAnalyzer
            );

            expect(logger.info).toHaveBeenCalledWith(
                expect.stringContaining("Initialized"),
                expect.objectContaining({
                    enableIndividualTrades: true,
                    hasIndividualTradesManager: true,
                    hasMicrostructureAnalyzer: true,
                })
            );
        });
    });

    describe("type safety and compatibility", () => {
        it("should emit correct event types for different processing paths", async () => {
            const preprocessorWithoutIndividual = new OrderflowPreprocessor(
                createTestConfig({ enableIndividualTrades: false }),
                orderBookState,
                logger,
                metricsCollector
            );

            const preprocessorWithIndividual = new OrderflowPreprocessor(
                createTestConfig({ enableIndividualTrades: true }),
                orderBookState,
                logger,
                metricsCollector,
                individualTradesManager,
                microstructureAnalyzer
            );

            const tradesWithoutIndividual: any[] = [];
            const tradesWithIndividual: any[] = [];

            preprocessorWithoutIndividual.on("enriched_trade", (trade) => {
                tradesWithoutIndividual.push(trade);
            });

            preprocessorWithIndividual.on("enriched_trade", (trade) => {
                tradesWithIndividual.push(trade);
            });

            vi.mocked(
                individualTradesManager.shouldFetchIndividualTrades
            ).mockReturnValue(false);

            await preprocessorWithoutIndividual.handleAggTrade(mockAggTrade);
            await preprocessorWithIndividual.handleAggTrade(mockAggTrade);

            // Both should emit trades, but with different structures
            expect(tradesWithoutIndividual).toHaveLength(1);
            expect(tradesWithIndividual).toHaveLength(1);

            const regularTrade = tradesWithoutIndividual[0];
            const hybridTrade = tradesWithIndividual[0];

            // Regular trade shouldn't have hybrid properties
            expect("hasIndividualData" in regularTrade).toBe(false);
            expect("tradeComplexity" in regularTrade).toBe(false);

            // Hybrid trade should have these properties
            expect("hasIndividualData" in hybridTrade).toBe(true);
            expect("tradeComplexity" in hybridTrade).toBe(true);
            expect(hybridTrade.hasIndividualData).toBe(false);
            expect(hybridTrade.tradeComplexity).toBe("simple");
        });
    });
});
