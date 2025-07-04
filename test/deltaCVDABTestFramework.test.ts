// test/deltaCVDABTestFramework.test.ts

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
    DeltaCVDABTestFramework,
    DeltaCVDTestProfile,
    TEST_PROFILE_CONFIGS,
} from "../src/backtesting/deltaCVDABTestFramework.js";
import {
    DeltaCVDABMonitor,
    AllocationStrategy,
} from "../src/analysis/deltaCVDABMonitor.js";
import { DeltaCVDWithABTesting } from "../src/indicators/deltaCVDWithABTesting.js";
import type { ILogger } from "../src/infrastructure/loggerInterface.js";
import { MetricsCollector } from "../src/infrastructure/metricsCollector.js";
import { RedBlackTreeOrderBook } from "../src/market/redBlackTreeOrderBook.js";
import type { EnrichedTradeEvent } from "../src/types/marketEvents.js";

// Import mock config for complete settings
import mockConfig from "../__mocks__/config.json";

// Mock dependencies
vi.mock("../src/infrastructure/metricsCollector");
vi.mock("../src/market/redBlackTreeOrderBook");

describe("DeltaCVD A/B Testing Framework", () => {
    let framework: DeltaCVDABTestFramework;
    let monitor: DeltaCVDABMonitor;
    let logger: ILogger;
    let metricsCollector: MetricsCollector;
    let orderBook: RedBlackTreeOrderBook;

    beforeEach(() => {
        // Create mock logger following logging standards
        logger = {
            info: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
            debug: vi.fn(),
        } as ILogger;
        metricsCollector = new MetricsCollector();
        orderBook = new RedBlackTreeOrderBook(
            "BTCUSDT",
            2,
            logger,
            metricsCollector
        );
        framework = new DeltaCVDABTestFramework(logger, metricsCollector);
        monitor = new DeltaCVDABMonitor(logger, metricsCollector);
    });

    describe("Test Profile Configurations", () => {
        it("should have correct configurations for each profile", () => {
            expect(
                TEST_PROFILE_CONFIGS[DeltaCVDTestProfile.SIMPLIFIED_NO_PASSIVE]
            ).toEqual({
                usePassiveVolume: false,
                enableDepthAnalysis: false,
                detectionMode: "momentum",
                baseConfidenceRequired: 0.3,
                finalConfidenceRequired: 0.5,
            });

            expect(
                TEST_PROFILE_CONFIGS[
                    DeltaCVDTestProfile.SIMPLIFIED_WITH_PASSIVE
                ]
            ).toEqual({
                usePassiveVolume: true,
                enableDepthAnalysis: false,
                detectionMode: "momentum",
                baseConfidenceRequired: 0.3,
                finalConfidenceRequired: 0.5,
            });

            expect(
                TEST_PROFILE_CONFIGS[DeltaCVDTestProfile.CURRENT_COMPLEX]
            ).toEqual({
                usePassiveVolume: true,
                enableDepthAnalysis: true,
                detectionMode: "hybrid",
                baseConfidenceRequired: 0.4,
                finalConfidenceRequired: 0.6,
            });
        });
    });

    describe("A/B Test Execution", () => {
        it("should run test for a single profile", async () => {
            const trades: EnrichedTradeEvent[] = generateMockTrades(100);

            const result = await framework.runTestProfile(
                DeltaCVDTestProfile.SIMPLIFIED_NO_PASSIVE,
                createAsyncIterable(trades),
                "BTCUSDT",
                orderBook
            );

            expect(result).toBeDefined();
            expect(result.profile).toBe(
                DeltaCVDTestProfile.SIMPLIFIED_NO_PASSIVE
            );
            expect(result.symbol).toBe("BTCUSDT");
            expect(result.metrics).toBeDefined();
            expect(result.metrics.totalSignals).toBeGreaterThanOrEqual(0);
        });

        it("should run parallel tests for all profiles", async () => {
            const trades: EnrichedTradeEvent[] = generateMockTrades(50);

            const results = await framework.runParallelTests(
                trades,
                "BTCUSDT",
                orderBook
            );

            expect(results.size).toBe(3);
            expect(results.has(DeltaCVDTestProfile.SIMPLIFIED_NO_PASSIVE)).toBe(
                true
            );
            expect(
                results.has(DeltaCVDTestProfile.SIMPLIFIED_WITH_PASSIVE)
            ).toBe(true);
            expect(results.has(DeltaCVDTestProfile.CURRENT_COMPLEX)).toBe(true);
        });
    });

    describe("Performance Comparison", () => {
        it("should correctly compare results and determine winner", async () => {
            const trades: EnrichedTradeEvent[] = generateMockTrades(100);
            const results = await framework.runParallelTests(
                trades,
                "BTCUSDT",
                orderBook
            );

            const comparison = framework.compareResults(results);

            expect(comparison).toBeDefined();
            expect(comparison.winner).toBeDefined();
            expect(comparison.confidenceLevel).toBeGreaterThanOrEqual(0);
            expect(comparison.confidenceLevel).toBeLessThanOrEqual(1);
            expect(comparison.recommendations).toBeInstanceOf(Array);
        });

        it("should calculate performance metrics correctly", async () => {
            const mockResults = new Map([
                [
                    DeltaCVDTestProfile.SIMPLIFIED_NO_PASSIVE,
                    createMockResult(
                        DeltaCVDTestProfile.SIMPLIFIED_NO_PASSIVE,
                        {
                            signalAccuracy: 0.8,
                            avgProcessingTimeMs: 5,
                            memoryUsageMB: 50,
                        }
                    ),
                ],
                [
                    DeltaCVDTestProfile.SIMPLIFIED_WITH_PASSIVE,
                    createMockResult(
                        DeltaCVDTestProfile.SIMPLIFIED_WITH_PASSIVE,
                        {
                            signalAccuracy: 0.85,
                            avgProcessingTimeMs: 6,
                            memoryUsageMB: 55,
                        }
                    ),
                ],
                [
                    DeltaCVDTestProfile.CURRENT_COMPLEX,
                    createMockResult(DeltaCVDTestProfile.CURRENT_COMPLEX, {
                        signalAccuracy: 0.82,
                        avgProcessingTimeMs: 10,
                        memoryUsageMB: 100,
                    }),
                ],
            ]);

            const comparison = framework.compareResults(mockResults);

            expect(comparison.memoryReduction).toBeGreaterThan(0);
            expect(comparison.processingSpeedGain).toBeGreaterThan(0);
        });
    });

    describe("A/B Test Monitor", () => {
        it("should assign profiles using round-robin strategy", () => {
            monitor["allocationStrategy"] = AllocationStrategy.ROUND_ROBIN;

            const profiles: DeltaCVDTestProfile[] = [];
            for (let i = 0; i < 6; i++) {
                profiles.push(monitor.assignProfile(`user${i}`));
            }

            // Should cycle through all 3 profiles twice
            expect(profiles[0]).toBe(profiles[3]);
            expect(profiles[1]).toBe(profiles[4]);
            expect(profiles[2]).toBe(profiles[5]);
        });

        it("should record performance metrics", () => {
            const profile = DeltaCVDTestProfile.SIMPLIFIED_WITH_PASSIVE;

            monitor.recordPerformance(profile, 5.5, undefined, false);
            monitor.recordPerformance(profile, 6.2, undefined, false);
            monitor.recordPerformance(profile, 4.8, undefined, false);

            const status = monitor.getStatus();
            const performance = status.profiles.get(profile);

            expect(performance).toBeDefined();
            expect(performance!.processingTimes).toHaveLength(3);
            expect(performance!.processingTimes).toContain(5.5);
            expect(performance!.processingTimes).toContain(6.2);
            expect(performance!.processingTimes).toContain(4.8);
        });

        it("should generate performance comparisons", () => {
            // Record some performance data
            for (let i = 0; i < 100; i++) {
                monitor.recordPerformance(
                    DeltaCVDTestProfile.SIMPLIFIED_NO_PASSIVE,
                    Math.random() * 10,
                    { confidence: 0.8 } as any,
                    false
                );
                monitor.recordPerformance(
                    DeltaCVDTestProfile.SIMPLIFIED_WITH_PASSIVE,
                    Math.random() * 8,
                    { confidence: 0.85 } as any,
                    false
                );
                monitor.recordPerformance(
                    DeltaCVDTestProfile.CURRENT_COMPLEX,
                    Math.random() * 15,
                    { confidence: 0.82 } as any,
                    false
                );
            }

            const comparison = monitor["compareProfiles"]();

            expect(comparison).toBeDefined();
            expect(comparison.leader).toBeDefined();
            expect(comparison.metrics.overallScore.size).toBe(3);
            expect(comparison.insights).toBeInstanceOf(Array);
        });
    });

    describe("DeltaCVD with A/B Testing Integration", () => {
        it("should create detector with A/B testing enabled", () => {
            const detector = DeltaCVDWithABTesting.createWithABTesting(
                "test-detector",
                mockConfig.symbols.LTCUSDT.deltaCvdConfirmation as any,
                orderBook,
                logger,
                metricsCollector,
                {} as any,
                monitor,
                "test-user"
            );

            const config = detector.getABTestConfig();
            expect(config.enabled).toBe(true);
            expect(config.profile).toBeDefined();
            expect(config.userId).toBe("test-user");
        });

        it("should track metrics during detection", () => {
            const detector = new DeltaCVDWithABTesting(
                "test-detector",
                {
                    ...mockConfig.symbols.LTCUSDT.deltaCvdConfirmation,
                    enableABTesting: true,
                    abTestProfile: DeltaCVDTestProfile.SIMPLIFIED_WITH_PASSIVE,
                    abTestMonitor: monitor,
                } as any,
                orderBook,
                logger,
                metricsCollector,
                {} as any
            );

            const recordSpy = vi.spyOn(monitor, "recordPerformance");

            const trade: EnrichedTradeEvent = {
                price: 50000,
                quantity: 1,
                timestamp: Date.now(),
                buyerIsMaker: false,
            } as any;

            // This will throw because orderbook is mocked, but that's ok
            try {
                (detector as any).processMarketEvent(trade);
            } catch {}

            expect(recordSpy).toHaveBeenCalled();
        });
    });
});

// Helper functions
function generateMockTrades(count: number): EnrichedTradeEvent[] {
    const trades: EnrichedTradeEvent[] = [];
    const basePrice = 50000;

    for (let i = 0; i < count; i++) {
        trades.push({
            price: basePrice + Math.random() * 100 - 50,
            quantity: Math.random() * 10,
            timestamp: Date.now() + i * 100,
            buyerIsMaker: Math.random() > 0.5,
            side: Math.random() > 0.5 ? "buy" : "sell",
            tradeId: `trade-${i}`,
            pair: "BTCUSDT",
        } as any);
    }

    return trades;
}

function createAsyncIterable<T>(items: T[]): AsyncIterable<T> {
    return {
        async *[Symbol.asyncIterator]() {
            for (const item of items) {
                yield item;
            }
        },
    };
}

function createMockResult(
    profile: DeltaCVDTestProfile,
    metrics: Partial<any>
): any {
    return {
        profile,
        config: TEST_PROFILE_CONFIGS[profile],
        metrics: {
            totalSignals: 100,
            confirmedSignals: 80,
            falsePositives: 5,
            missedOpportunities: 15,
            signalToNoiseRatio: 0.8,
            avgConfidence: 0.85,
            avgProcessingTimeMs: 5,
            maxProcessingTimeMs: 20,
            memoryUsageMB: 50,
            cpuUtilization: 0.2,
            performanceByVolatility: new Map(),
            performanceByVolume: new Map(),
            performanceByTrend: new Map(),
            avgSignalLeadTimeMs: 100,
            avgSignalDurationMs: 5000,
            signalAccuracy: 0.8,
            ...metrics,
        },
        startTime: Date.now() - 3600000,
        endTime: Date.now(),
        symbol: "BTCUSDT",
        marketConditions: {
            avgVolatility: 0.02,
            avgVolume: 1000,
            trendDirection: "sideways",
            priceRange: { high: 51000, low: 49000 },
            totalTrades: 10000,
        },
        errors: [],
    };
}
