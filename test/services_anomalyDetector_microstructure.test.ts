import { describe, it, expect, vi, beforeEach } from "vitest";
import { AnomalyDetector } from "../src/services/anomalyDetector";
import { Logger } from "../src/infrastructure/logger";
import type {
    HybridTradeEvent,
    MicrostructureMetrics,
    CoordinationSignal,
} from "../src/types/marketEvents";

vi.mock("../src/infrastructure/logger");

describe("services/AnomalyDetector - Microstructure Analysis", () => {
    let detector: AnomalyDetector;
    let logger: Logger;
    let emittedAnomalies: any[] = [];

    beforeEach(() => {
        vi.clearAllMocks();
        emittedAnomalies = [];

        logger = new Logger();
        detector = new AnomalyDetector(
            {
                windowSize: 100,
                minHistory: 10,
            },
            logger
        );

        // Capture emitted anomalies
        detector.on("anomaly", (anomaly) => {
            emittedAnomalies.push(anomaly);
        });
    });

    const createMockHybridTrade = (
        microstructure: Partial<MicrostructureMetrics>
    ): HybridTradeEvent => ({
        price: 100,
        quantity: 50,
        timestamp: Date.now(),
        buyerIsMaker: false,
        pair: "LTCUSDT",
        tradeId: "test123",
        originalTrade: {} as any,
        passiveBidVolume: 100,
        passiveAskVolume: 150,
        zonePassiveBidVolume: 500,
        zonePassiveAskVolume: 600,
        hasIndividualData: true,
        tradeComplexity: "complex",
        fetchReason: "large_order",
        microstructure: {
            fragmentationScore: 0.5,
            avgTradeSize: 10,
            tradeSizeVariance: 25,
            timingPattern: "uniform",
            avgTimeBetweenTrades: 1000,
            toxicityScore: 0.3,
            directionalPersistence: 0.4,
            suspectedAlgoType: "unknown",
            coordinationIndicators: [],
            sizingPattern: "consistent",
            executionEfficiency: 0.7,
            ...microstructure,
        } as MicrostructureMetrics,
    });

    describe("coordinated activity detection", () => {
        it("should detect coordinated timing patterns", () => {
            const coordinationSignal: CoordinationSignal = {
                type: "time_coordination",
                strength: 0.9,
                details: "5 trades in same second window",
            };

            const trade = createMockHybridTrade({
                timingPattern: "coordinated",
                coordinationIndicators: [coordinationSignal],
            });

            detector.onEnrichedTrade(trade);

            expect(emittedAnomalies).toHaveLength(1);
            expect(emittedAnomalies[0].type).toBe("coordinated_activity");
            expect(emittedAnomalies[0].severity).toBe("high"); // strength 0.9 > 0.8
            expect(emittedAnomalies[0].details.coordinationScore).toBe(1);
            expect(emittedAnomalies[0].details.timingPattern).toBe(
                "coordinated"
            );
            expect(emittedAnomalies[0].details.coordinationIndicators).toEqual([
                coordinationSignal,
            ]);
            expect(emittedAnomalies[0].recommendedAction).toBe(
                "close_positions"
            );
        });

        it("should detect medium severity coordinated activity", () => {
            const coordinationSignal: CoordinationSignal = {
                type: "size_coordination",
                strength: 0.6,
                details: "3 trades with identical size",
            };

            const trade = createMockHybridTrade({
                coordinationIndicators: [coordinationSignal],
            });

            detector.onEnrichedTrade(trade);

            expect(emittedAnomalies).toHaveLength(1);
            expect(emittedAnomalies[0].severity).toBe("medium"); // strength 0.6 < 0.8
            expect(emittedAnomalies[0].recommendedAction).toBe("reduce_size");
        });

        it("should include trade metadata in coordinated activity anomaly", () => {
            const trade = createMockHybridTrade({
                timingPattern: "coordinated",
                coordinationIndicators: [
                    {
                        type: "price_coordination",
                        strength: 0.8,
                        details: "Multiple trades at same price",
                    },
                ],
                fragmentationScore: 0.75,
            });

            detector.onEnrichedTrade(trade);

            const anomaly = emittedAnomalies[0];
            expect(anomaly.details.price).toBe(100);
            expect(anomaly.details.quantity).toBe(50);
            expect(anomaly.details.fragmentationScore).toBe(0.75);
            expect(anomaly.details.fetchReason).toBe("large_order");
            expect(anomaly.affectedPriceRange).toEqual({ min: 100, max: 100 });
        });
    });

    describe("algorithmic activity detection", () => {
        it("should detect high-risk algorithmic patterns", () => {
            const trade = createMockHybridTrade({
                suspectedAlgoType: "arbitrage",
                fragmentationScore: 0.8,
                executionEfficiency: 0.9,
                sizingPattern: "structured",
            });

            detector.onEnrichedTrade(trade);

            expect(emittedAnomalies).toHaveLength(1);
            expect(emittedAnomalies[0].type).toBe("algorithmic_activity");
            expect(emittedAnomalies[0].severity).toBe("medium"); // arbitrage is high-risk
            expect(emittedAnomalies[0].details.algoType).toBe("arbitrage");
            expect(emittedAnomalies[0].details.confidence).toBe(0.8);
            expect(emittedAnomalies[0].recommendedAction).toBe("reduce_size");
        });

        it("should detect low-risk algorithmic patterns", () => {
            const trade = createMockHybridTrade({
                suspectedAlgoType: "market_making",
                executionEfficiency: 0.95,
                timingPattern: "uniform",
            });

            detector.onEnrichedTrade(trade);

            expect(emittedAnomalies).toHaveLength(1);
            expect(emittedAnomalies[0].severity).toBe("info"); // market_making is low-risk
            expect(emittedAnomalies[0].details.algoType).toBe("market_making");
            expect(emittedAnomalies[0].recommendedAction).toBe("continue");
        });

        it("should detect order splitting patterns", () => {
            const trade = createMockHybridTrade({
                suspectedAlgoType: "splitting",
                fragmentationScore: 0.9,
                executionEfficiency: 0.4,
                sizingPattern: "structured",
            });

            detector.onEnrichedTrade(trade);

            expect(emittedAnomalies).toHaveLength(1);
            expect(emittedAnomalies[0].severity).toBe("medium");
            expect(emittedAnomalies[0].details.algoType).toBe("splitting");
        });

        it("should not detect unknown algorithmic patterns", () => {
            const trade = createMockHybridTrade({
                suspectedAlgoType: "unknown",
            });

            detector.onEnrichedTrade(trade);

            expect(emittedAnomalies).toHaveLength(0);
        });
    });

    describe("toxic flow detection", () => {
        it("should detect high toxicity flow", () => {
            const trade = createMockHybridTrade({
                toxicityScore: 0.96,
                directionalPersistence: 0.9,
                executionEfficiency: 0.8,
                fragmentationScore: 0.3,
                suspectedAlgoType: "iceberg",
            });

            detector.onEnrichedTrade(trade);

            expect(emittedAnomalies).toHaveLength(1);
            expect(emittedAnomalies[0].type).toBe("toxic_flow");
            expect(emittedAnomalies[0].severity).toBe("high"); // toxicity 0.96 > 0.95
            expect(emittedAnomalies[0].details.toxicityScore).toBe(0.96);
            expect(emittedAnomalies[0].details.directionalPersistence).toBe(
                0.9
            );
            expect(emittedAnomalies[0].recommendedAction).toBe(
                "close_positions"
            );
        });

        it("should detect medium toxicity flow", () => {
            const trade = createMockHybridTrade({
                toxicityScore: 0.87,
                directionalPersistence: 0.75,
            });

            detector.onEnrichedTrade(trade);

            expect(emittedAnomalies).toHaveLength(1);
            expect(emittedAnomalies[0].severity).toBe("medium"); // 0.85 < toxicity < 0.95
            expect(emittedAnomalies[0].recommendedAction).toBe("reduce_size");
        });

        it("should detect info-level toxicity flow", () => {
            const trade = createMockHybridTrade({
                toxicityScore: 0.82,
                directionalPersistence: 0.6,
            });

            detector.onEnrichedTrade(trade);

            expect(emittedAnomalies).toHaveLength(1);
            expect(emittedAnomalies[0].severity).toBe("info"); // toxicity < 0.85
            expect(emittedAnomalies[0].recommendedAction).toBe("continue");
        });

        it("should not detect low toxicity flow", () => {
            const trade = createMockHybridTrade({
                toxicityScore: 0.7, // Below 0.8 threshold
            });

            detector.onEnrichedTrade(trade);

            expect(emittedAnomalies).toHaveLength(0);
        });

        it("should include comprehensive toxicity details", () => {
            const trade = createMockHybridTrade({
                toxicityScore: 0.9,
                directionalPersistence: 0.85,
                executionEfficiency: 0.7,
                fragmentationScore: 0.4,
                avgTradeSize: 25,
                suspectedAlgoType: "splitting",
                tradeComplexity: "highly_fragmented",
            });

            detector.onEnrichedTrade(trade);

            const anomaly = emittedAnomalies[0];
            expect(anomaly.details.toxicityScore).toBe(0.9);
            expect(anomaly.details.directionalPersistence).toBe(0.85);
            expect(anomaly.details.executionEfficiency).toBe(0.7);
            expect(anomaly.details.fragmentationScore).toBe(0.4);
            expect(anomaly.details.avgTradeSize).toBe(25);
            expect(anomaly.details.tradeComplexity).toBe("highly_fragmented");
            expect(anomaly.details.suspectedAlgoType).toBe("splitting");
        });
    });

    describe("order fragmentation detection", () => {
        it("should detect highly fragmented orders with poor efficiency", () => {
            const trade = createMockHybridTrade({
                fragmentationScore: 0.85,
                tradeComplexity: "highly_fragmented",
                executionEfficiency: 0.25,
                avgTradeSize: 5,
                tradeSizeVariance: 12,
                sizingPattern: "random",
            });

            detector.onEnrichedTrade(trade);

            expect(emittedAnomalies).toHaveLength(1);
            expect(emittedAnomalies[0].type).toBe("algorithmic_activity");
            expect(emittedAnomalies[0].severity).toBe("medium");
            expect(emittedAnomalies[0].details.algoType).toBe(
                "order_fragmentation"
            );
            expect(emittedAnomalies[0].details.fragmentationScore).toBe(0.85);
            expect(emittedAnomalies[0].details.executionEfficiency).toBe(0.25);
            expect(emittedAnomalies[0].recommendedAction).toBe("reduce_size");
        });

        it("should not detect fragmentation for efficient execution", () => {
            const trade = createMockHybridTrade({
                fragmentationScore: 0.85,
                tradeComplexity: "highly_fragmented",
                executionEfficiency: 0.7, // Above 0.3 threshold
            });

            detector.onEnrichedTrade(trade);

            expect(emittedAnomalies).toHaveLength(0);
        });

        it("should not detect fragmentation for simple trades", () => {
            const trade = createMockHybridTrade({
                fragmentationScore: 0.85,
                tradeComplexity: "simple", // Not highly_fragmented
                executionEfficiency: 0.2,
            });

            detector.onEnrichedTrade(trade);

            expect(emittedAnomalies).toHaveLength(0);
        });
    });

    describe("multiple anomaly detection", () => {
        it("should detect multiple anomalies in single trade", () => {
            const trade = createMockHybridTrade({
                // Coordinated activity
                timingPattern: "coordinated",
                coordinationIndicators: [
                    {
                        type: "time_coordination",
                        strength: 0.9,
                        details: "5 trades in same second",
                    },
                ],
                // Algorithmic activity
                suspectedAlgoType: "arbitrage",
                // Toxic flow
                toxicityScore: 0.9,
                // Fragmentation
                fragmentationScore: 0.85,
                tradeComplexity: "highly_fragmented",
                executionEfficiency: 0.2,
            });

            detector.onEnrichedTrade(trade);

            expect(emittedAnomalies).toHaveLength(4); // All four types detected

            const anomalyTypes = emittedAnomalies.map((a) => a.type);
            expect(anomalyTypes).toContain("coordinated_activity");
            expect(anomalyTypes).toContain("algorithmic_activity");
            expect(anomalyTypes).toContain("toxic_flow");

            // Two algorithmic_activity anomalies (one for arbitrage, one for fragmentation)
            const algoAnomalies = emittedAnomalies.filter(
                (a) => a.type === "algorithmic_activity"
            );
            expect(algoAnomalies).toHaveLength(2);
            expect(
                algoAnomalies.some((a) => a.details.algoType === "arbitrage")
            ).toBe(true);
            expect(
                algoAnomalies.some(
                    (a) => a.details.algoType === "order_fragmentation"
                )
            ).toBe(true);
        });
    });

    describe("microstructure anomaly integration with existing system", () => {
        it("should work with trades without individual data", () => {
            const regularTrade = {
                price: 100,
                quantity: 50,
                timestamp: Date.now(),
                buyerIsMaker: false,
                pair: "LTCUSDT",
                tradeId: "test123",
                originalTrade: {} as any,
                passiveBidVolume: 100,
                passiveAskVolume: 150,
                zonePassiveBidVolume: 500,
                zonePassiveAskVolume: 600,
            };

            // Should not throw and should not detect microstructure anomalies
            expect(() => detector.onEnrichedTrade(regularTrade)).not.toThrow();
            expect(emittedAnomalies).toHaveLength(0);
        });

        it("should work with hybrid trades without microstructure data", () => {
            const hybridTradeWithoutMicrostructure: HybridTradeEvent = {
                price: 100,
                quantity: 50,
                timestamp: Date.now(),
                buyerIsMaker: false,
                pair: "LTCUSDT",
                tradeId: "test123",
                originalTrade: {} as any,
                passiveBidVolume: 100,
                passiveAskVolume: 150,
                zonePassiveBidVolume: 500,
                zonePassiveAskVolume: 600,
                hasIndividualData: false,
                tradeComplexity: "simple",
                // No microstructure data
            };

            expect(() =>
                detector.onEnrichedTrade(hybridTradeWithoutMicrostructure)
            ).not.toThrow();
            expect(emittedAnomalies).toHaveLength(0);
        });
    });
});
