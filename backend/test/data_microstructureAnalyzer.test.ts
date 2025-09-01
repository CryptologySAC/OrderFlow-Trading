import { describe, it, expect, vi, beforeEach } from "vitest";
import { MicrostructureAnalyzer } from "../src/data/microstructureAnalyzer";
import type { ILogger } from "../src/infrastructure/loggerInterface";
import type { IWorkerMetricsCollector } from "../src/multithreading/shared/workerInterfaces";
import type {
    IndividualTrade,
    MicrostructureMetrics,
} from "../src/types/marketEvents";

describe("data/MicrostructureAnalyzer", () => {
    let analyzer: MicrostructureAnalyzer;
    let logger: ILogger;
    let metricsCollector: IWorkerMetricsCollector;

    const mockConfig = {
        burstThresholdMs: 100,
        uniformityThreshold: 0.2,
        sizingConsistencyThreshold: 0.15,
        persistenceWindowSize: 5,
        marketMakingSpreadThreshold: 0.01,
        icebergSizeRatio: 0.8,
        arbitrageTimeThreshold: 50,
    };

    beforeEach(() => {
        vi.clearAllMocks();

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

        analyzer = new MicrostructureAnalyzer(
            mockConfig,
            logger,
            metricsCollector
        );
    });

    describe("analyze", () => {
        it("should return empty metrics for no trades", async () => {
            const result = analyzer.analyze([]);

            expect(result).toEqual({
                fragmentationScore: 0,
                avgTradeSize: 0,
                tradeSizeVariance: 0,
                timingPattern: "uniform",
                avgTimeBetweenTrades: 0,
                toxicityScore: 0,
                directionalPersistence: 0,
                suspectedAlgoType: "unknown",
                coordinationIndicators: [],
                sizingPattern: "consistent",
                executionEfficiency: 0,
            });
        });

        it("should analyze basic trade patterns", async () => {
            const trades: IndividualTrade[] = [
                {
                    id: 1,
                    price: 100,
                    quantity: 10,
                    timestamp: Date.now(),
                    isBuyerMaker: false,
                    quoteQuantity: 1000,
                },
                {
                    id: 2,
                    price: 100.1,
                    quantity: 15,
                    timestamp: Date.now() + 1000,
                    isBuyerMaker: true,
                    quoteQuantity: 1501.5,
                },
                {
                    id: 3,
                    price: 100.2,
                    quantity: 12,
                    timestamp: Date.now() + 2000,
                    isBuyerMaker: false,
                    quoteQuantity: 1202.4,
                },
            ];

            const result = analyzer.analyze(trades);

            expect(result.fragmentationScore).toBeGreaterThan(0);
            expect(result.avgTradeSize).toBeCloseTo(12.33, 1);
            expect(result.tradeSizeVariance).toBeGreaterThan(0);
            expect(result.timingPattern).toBeOneOf([
                "uniform",
                "burst",
                "coordinated",
            ]);
            expect(result.avgTimeBetweenTrades).toBeCloseTo(1000, 1);
            expect(result.suspectedAlgoType).toBeOneOf([
                "market_making",
                "iceberg",
                "splitting",
                "arbitrage",
                "unknown",
            ]);
            expect(result.sizingPattern).toBeOneOf([
                "consistent",
                "random",
                "structured",
            ]);
            expect(result.executionEfficiency).toBeGreaterThanOrEqual(0);
            expect(result.executionEfficiency).toBeLessThanOrEqual(1);
        });

        it("should update metrics on successful analysis", async () => {
            const trades: IndividualTrade[] = [
                {
                    id: 1,
                    price: 100,
                    quantity: 10,
                    timestamp: Date.now(),
                    isBuyerMaker: false,
                    quoteQuantity: 1000,
                },
            ];

            analyzer.analyze(trades);

            expect(metricsCollector.updateMetric).toHaveBeenCalledWith(
                "microstructure.analysisTimeMs",
                expect.any(Number)
            );
            expect(metricsCollector.incrementMetric).toHaveBeenCalledWith(
                "microstructure.analysisCount"
            );
        });

        it("should handle analysis errors gracefully", async () => {
            // Create a malformed trade that might cause errors
            const trades: any = [null, undefined, {}];

            const result = analyzer.analyze(trades);

            expect(result.fragmentationScore).toBe(0);
            expect(metricsCollector.incrementMetric).toHaveBeenCalledWith(
                "microstructure.analysisErrors"
            );
            expect(logger.error).toHaveBeenCalled();
        });
    });

    describe("fragmentation analysis", () => {
        it("should detect consistent sizing patterns", async () => {
            const trades: IndividualTrade[] = Array.from(
                { length: 5 },
                (_, i) => ({
                    id: i + 1,
                    price: 100 + i * 0.01,
                    quantity: 10, // Consistent size
                    timestamp: Date.now() + i * 1000,
                    isBuyerMaker: i % 2 === 0,
                    quoteQuantity: 1000 + i * 10,
                })
            );

            const result = analyzer.analyze(trades);

            expect(result.sizingPattern).toBe("consistent");
            expect(result.fragmentationScore).toBeLessThan(0.5); // Low fragmentation for consistent sizes
            expect(result.tradeSizeVariance).toBe(0); // No variance for identical sizes
        });

        it("should detect high fragmentation for varying sizes", async () => {
            const trades: IndividualTrade[] = [
                {
                    id: 1,
                    price: 100,
                    quantity: 1,
                    timestamp: Date.now(),
                    isBuyerMaker: false,
                    quoteQuantity: 100,
                },
                {
                    id: 2,
                    price: 100,
                    quantity: 50,
                    timestamp: Date.now() + 100,
                    isBuyerMaker: false,
                    quoteQuantity: 5000,
                },
                {
                    id: 3,
                    price: 100,
                    quantity: 5,
                    timestamp: Date.now() + 200,
                    isBuyerMaker: false,
                    quoteQuantity: 500,
                },
                {
                    id: 4,
                    price: 100,
                    quantity: 100,
                    timestamp: Date.now() + 300,
                    isBuyerMaker: false,
                    quoteQuantity: 10000,
                },
                {
                    id: 5,
                    price: 100,
                    quantity: 2,
                    timestamp: Date.now() + 400,
                    isBuyerMaker: false,
                    quoteQuantity: 200,
                },
            ];

            const result = analyzer.analyze(trades);

            expect(result.fragmentationScore).toBeGreaterThan(0.5); // High fragmentation
            expect(result.sizingPattern).toBeOneOf(["random", "structured"]);
            expect(result.tradeSizeVariance).toBeGreaterThan(0);
        });
    });

    describe("timing pattern analysis", () => {
        it("should detect burst patterns", async () => {
            const baseTime = Date.now();
            const trades: IndividualTrade[] = Array.from(
                { length: 5 },
                (_, i) => ({
                    id: i + 1,
                    price: 100,
                    quantity: 10,
                    timestamp: baseTime + i * 10, // Very close together (10ms apart)
                    isBuyerMaker: false,
                    quoteQuantity: 1000,
                })
            );

            const result = analyzer.analyze(trades);

            expect(result.timingPattern).toBe("burst");
            expect(result.avgTimeBetweenTrades).toBeLessThan(
                mockConfig.burstThresholdMs
            );
        });

        it("should detect uniform patterns", async () => {
            const baseTime = Date.now();
            const trades: IndividualTrade[] = Array.from(
                { length: 5 },
                (_, i) => ({
                    id: i + 1,
                    price: 100,
                    quantity: 10,
                    timestamp: baseTime + i * 1000, // Evenly spaced (1s apart)
                    isBuyerMaker: false,
                    quoteQuantity: 1000,
                })
            );

            const result = analyzer.analyze(trades);

            expect(result.timingPattern).toBe("uniform");
            expect(result.avgTimeBetweenTrades).toBe(1000);
        });

        it("should detect coordinated timing", async () => {
            const baseTime = Date.now();
            const roundedTime = Math.floor(baseTime / 1000) * 1000; // Round to nearest second

            const trades: IndividualTrade[] = Array.from(
                { length: 5 },
                (_, i) => ({
                    id: i + 1,
                    price: 100,
                    quantity: 10,
                    timestamp: roundedTime + i * 10, // All in same second window
                    isBuyerMaker: false,
                    quoteQuantity: 1000,
                })
            );

            const result = analyzer.analyze(trades);

            expect(result.timingPattern).toBeOneOf(["coordinated", "burst"]);
        });
    });

    describe("algorithmic pattern detection", () => {
        it("should detect market making patterns", async () => {
            const baseTime = Date.now();
            const trades: IndividualTrade[] = [
                {
                    id: 1,
                    price: 100.0,
                    quantity: 10,
                    timestamp: baseTime,
                    isBuyerMaker: true,
                    quoteQuantity: 1000,
                },
                {
                    id: 2,
                    price: 100.01,
                    quantity: 10,
                    timestamp: baseTime + 100,
                    isBuyerMaker: false,
                    quoteQuantity: 1000.1,
                },
                {
                    id: 3,
                    price: 100.0,
                    quantity: 10,
                    timestamp: baseTime + 200,
                    isBuyerMaker: true,
                    quoteQuantity: 1000,
                },
                {
                    id: 4,
                    price: 100.01,
                    quantity: 10,
                    timestamp: baseTime + 300,
                    isBuyerMaker: false,
                    quoteQuantity: 1000.1,
                },
            ];

            const result = analyzer.analyze(trades);

            expect(result.suspectedAlgoType).toBe("market_making");
        });

        it("should detect iceberg patterns", async () => {
            const baseTime = Date.now();
            const trades: IndividualTrade[] = Array.from(
                { length: 5 },
                (_, i) => ({
                    id: i + 1,
                    price: 100,
                    quantity: 10, // Consistent size
                    timestamp: baseTime + i * 100,
                    isBuyerMaker: false, // All same direction
                    quoteQuantity: 1000,
                })
            );

            const result = analyzer.analyze(trades);

            expect(result.suspectedAlgoType).toBe("iceberg");
        });

        it("should detect order splitting patterns", async () => {
            const baseTime = Date.now();
            const trades: IndividualTrade[] = [
                {
                    id: 1,
                    price: 100,
                    quantity: 50,
                    timestamp: baseTime,
                    isBuyerMaker: false,
                    quoteQuantity: 5000,
                },
                {
                    id: 2,
                    price: 100,
                    quantity: 40,
                    timestamp: baseTime + 100,
                    isBuyerMaker: false,
                    quoteQuantity: 4000,
                },
                {
                    id: 3,
                    price: 100,
                    quantity: 30,
                    timestamp: baseTime + 200,
                    isBuyerMaker: false,
                    quoteQuantity: 3000,
                },
                {
                    id: 4,
                    price: 100,
                    quantity: 20,
                    timestamp: baseTime + 300,
                    isBuyerMaker: false,
                    quoteQuantity: 2000,
                },
                {
                    id: 5,
                    price: 100,
                    quantity: 10,
                    timestamp: baseTime + 400,
                    isBuyerMaker: false,
                    quoteQuantity: 1000,
                },
            ];

            const result = analyzer.analyze(trades);

            expect(result.suspectedAlgoType).toBe("splitting");
        });

        it("should detect arbitrage patterns", async () => {
            const baseTime = Date.now();
            const trades: IndividualTrade[] = [
                {
                    id: 1,
                    price: 100.0,
                    quantity: 10,
                    timestamp: baseTime,
                    isBuyerMaker: false,
                    quoteQuantity: 1000,
                },
                {
                    id: 2,
                    price: 100.05,
                    quantity: 10,
                    timestamp: baseTime + 20,
                    isBuyerMaker: true,
                    quoteQuantity: 1000.5,
                }, // Quick execution across price levels
            ];

            const result = analyzer.analyze(trades);

            expect(result.suspectedAlgoType).toBe("arbitrage");
        });
    });

    describe("coordination detection", () => {
        it("should detect time coordination", async () => {
            const baseTime = Date.now();
            const roundedTime = Math.floor(baseTime / 1000) * 1000;

            const trades: IndividualTrade[] = Array.from(
                { length: 4 },
                (_, i) => ({
                    id: i + 1,
                    price: 100,
                    quantity: 10,
                    timestamp: roundedTime + i * 10, // All in same second
                    isBuyerMaker: false,
                    quoteQuantity: 1000,
                })
            );

            const result = analyzer.analyze(trades);

            const timeCoordination = result.coordinationIndicators.find(
                (c) => c.type === "time_coordination"
            );
            expect(timeCoordination).toBeDefined();
            expect(timeCoordination?.strength).toBeGreaterThan(0.5);
        });

        it("should detect size coordination", async () => {
            const baseTime = Date.now();
            const trades: IndividualTrade[] = Array.from(
                { length: 4 },
                (_, i) => ({
                    id: i + 1,
                    price: 100 + i * 0.01,
                    quantity: 10, // Identical sizes
                    timestamp: baseTime + i * 1000,
                    isBuyerMaker: false,
                    quoteQuantity: 1000 + i * 10,
                })
            );

            const result = analyzer.analyze(trades);

            const sizeCoordination = result.coordinationIndicators.find(
                (c) => c.type === "size_coordination"
            );
            expect(sizeCoordination).toBeDefined();
            expect(sizeCoordination?.strength).toBeGreaterThan(0.5);
        });

        it("should detect price coordination", async () => {
            const baseTime = Date.now();
            const trades: IndividualTrade[] = Array.from(
                { length: 4 },
                (_, i) => ({
                    id: i + 1,
                    price: 100.0, // Identical prices
                    quantity: 10 + i,
                    timestamp: baseTime + i * 1000,
                    isBuyerMaker: false,
                    quoteQuantity: 1000 + i * 100,
                })
            );

            const result = analyzer.analyze(trades);

            const priceCoordination = result.coordinationIndicators.find(
                (c) => c.type === "price_coordination"
            );
            expect(priceCoordination).toBeDefined();
            expect(priceCoordination?.strength).toBeGreaterThan(0.5);
        });
    });

    describe("flow toxicity analysis", () => {
        it("should detect high toxicity in persistent directional flow", async () => {
            const baseTime = Date.now();
            const trades: IndividualTrade[] = Array.from(
                { length: 10 },
                (_, i) => ({
                    id: i + 1,
                    price: 100 + i * 0.01, // Gradually increasing price
                    quantity: 50, // Large sizes
                    timestamp: baseTime + i * 100,
                    isBuyerMaker: false, // All aggressive buys (same direction)
                    quoteQuantity: 5000 + i * 50,
                })
            );

            const result = analyzer.analyze(trades);

            expect(result.toxicityScore).toBeGreaterThan(0.5);
            expect(result.directionalPersistence).toBeGreaterThan(0.8);
        });

        it("should detect low toxicity in random flow", async () => {
            const baseTime = Date.now();
            const trades: IndividualTrade[] = Array.from(
                { length: 10 },
                (_, i) => ({
                    id: i + 1,
                    price: 100,
                    quantity: 5, // Small sizes
                    timestamp: baseTime + i * 2000, // Slow execution
                    isBuyerMaker: i % 2 === 0, // Alternating directions
                    quoteQuantity: 500,
                })
            );

            const result = analyzer.analyze(trades);

            expect(result.toxicityScore).toBeLessThan(0.5);
            expect(result.directionalPersistence).toBeLessThan(0.5);
        });
    });

    describe("execution efficiency", () => {
        it("should calculate high efficiency for quick, focused execution", async () => {
            const baseTime = Date.now();
            const trades: IndividualTrade[] = [
                {
                    id: 1,
                    price: 100.0,
                    quantity: 100,
                    timestamp: baseTime,
                    isBuyerMaker: false,
                    quoteQuantity: 10000,
                },
                {
                    id: 2,
                    price: 100.0,
                    quantity: 100,
                    timestamp: baseTime + 50,
                    isBuyerMaker: false,
                    quoteQuantity: 10000,
                },
            ];

            const result = analyzer.analyze(trades);

            expect(result.executionEfficiency).toBeGreaterThan(0.5); // Quick execution at same price
        });

        it("should calculate low efficiency for fragmented, slow execution", async () => {
            const baseTime = Date.now();
            const trades: IndividualTrade[] = Array.from(
                { length: 20 },
                (_, i) => ({
                    id: i + 1,
                    price: 100 + i * 0.1, // Wide price range
                    quantity: 5, // Small fragments
                    timestamp: baseTime + i * 5000, // Slow execution
                    isBuyerMaker: false,
                    quoteQuantity: 500 + i * 50,
                })
            );

            const result = analyzer.analyze(trades);

            expect(result.executionEfficiency).toBeLessThan(0.5); // Inefficient fragmented execution
        });
    });
});
