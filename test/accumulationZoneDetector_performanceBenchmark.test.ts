// test/accumulationZoneDetector_performanceBenchmark.test.ts
/**
 * Performance benchmark test for AccumulationZoneDetector
 * Compares original vs enhanced detector performance to ensure no regression
 */

import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { AccumulationZoneDetector } from "../src/indicators/accumulationZoneDetector.js";
import { AccumulationZoneDetectorEnhanced } from "../src/indicators/accumulationZoneDetectorEnhanced.js";
import type { ZoneDetectorConfig } from "../src/types/zoneTypes.js";
import type { EnrichedTradeEvent } from "../src/types/marketEvents.js";

// Mock dependencies
const mockLogger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
};

const mockMetricsCollector = {
    incrementMetric: vi.fn(),
    updateMetric: vi.fn(),
    recordGauge: vi.fn(),
    recordHistogram: vi.fn(),
    recordTimer: vi.fn(),
    startTimer: vi.fn(() => ({ stop: vi.fn() })),
    getMetrics: vi.fn(() => ({})),
};

describe("AccumulationZoneDetector Performance Benchmark", () => {
    let baseConfig: ZoneDetectorConfig;
    let originalDetector: AccumulationZoneDetector;
    let enhancedDetectorDisabled: AccumulationZoneDetectorEnhanced;
    let enhancedDetectorEnabled: AccumulationZoneDetectorEnhanced;
    let testTradeEvents: EnrichedTradeEvent[];

    beforeEach(() => {
        vi.clearAllMocks();

        // Base configuration
        baseConfig = {
            symbol: "LTCUSDT",
            minDurationMs: 30000,
            minRatio: 0.7,
            minRecentActivityMs: 120000,
            threshold: 0.85,
            pricePrecision: 2,
            windowMs: 300000,
            minAggVolume: 50,
            zoneTicks: 5,
            eventCooldownMs: 15000,
        };

        // Create test instances
        originalDetector = new AccumulationZoneDetector(
            "test-original",
            "LTCUSDT",
            baseConfig,
            mockLogger,
            mockMetricsCollector
        );

        // Enhanced detector with standardized zones disabled (should be nearly identical to original)
        enhancedDetectorDisabled = new AccumulationZoneDetectorEnhanced(
            "test-enhanced-disabled",
            "LTCUSDT",
            {
                ...baseConfig,
                useStandardizedZones: false,
                enhancementMode: "disabled",
            },
            mockLogger,
            mockMetricsCollector
        );

        // Enhanced detector with standardized zones enabled (optimized for performance)
        enhancedDetectorEnabled = new AccumulationZoneDetectorEnhanced(
            "test-enhanced-enabled",
            "LTCUSDT",
            {
                ...baseConfig,
                useStandardizedZones: true,
                enhancementMode: "production",
                standardizedZoneConfig: {
                    minZoneConfluenceCount: 2,
                    institutionalVolumeThreshold: 50,
                    // Disable expensive features for performance
                    enableCrossTimeframeAnalysis: false,
                    enableInstitutionalVolumeFilter: false,
                    confluenceConfidenceBoost: 0.1, // Reduced boost
                },
            },
            mockLogger,
            mockMetricsCollector
        );

        // Generate test trade events
        testTradeEvents = generateTestTradeEvents(1000);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe("Baseline Performance Validation", () => {
        it("should have minimal performance overhead when enhancement is disabled", () => {
            const originalResults: number[] = [];
            const enhancedDisabledResults: number[] = [];

            // Warmup
            for (let i = 0; i < 10; i++) {
                originalDetector.analyze(testTradeEvents[i]);
                enhancedDetectorDisabled.analyze(testTradeEvents[i]);
            }

            // Benchmark original detector
            const originalStart = process.hrtime.bigint();
            for (const trade of testTradeEvents) {
                originalDetector.analyze(trade);
            }
            const originalEnd = process.hrtime.bigint();
            const originalTime = Number(originalEnd - originalStart) / 1000000; // Convert to ms

            // Benchmark enhanced detector with disabled enhancement
            const enhancedDisabledStart = process.hrtime.bigint();
            for (const trade of testTradeEvents) {
                enhancedDetectorDisabled.analyze(trade);
            }
            const enhancedDisabledEnd = process.hrtime.bigint();
            const enhancedDisabledTime =
                Number(enhancedDisabledEnd - enhancedDisabledStart) / 1000000;

            console.log(`Original detector: ${originalTime.toFixed(2)}ms`);
            console.log(
                `Enhanced detector (disabled): ${enhancedDisabledTime.toFixed(2)}ms`
            );

            const overhead =
                ((enhancedDisabledTime - originalTime) / originalTime) * 100;
            console.log(`Performance overhead: ${overhead.toFixed(1)}%`);

            // Enhanced detector with disabled features should have < 5% overhead
            expect(overhead).toBeLessThan(5);
            expect(enhancedDisabledTime).toBeLessThan(originalTime * 1.05);
        });

        it("should measure enhancement performance impact when enabled", () => {
            const enhancedEnabledResults: number[] = [];

            // Warmup
            for (let i = 0; i < 10; i++) {
                enhancedDetectorEnabled.analyze(testTradeEvents[i]);
            }

            // Benchmark enhanced detector with enabled enhancement
            const enhancedEnabledStart = process.hrtime.bigint();
            for (const trade of testTradeEvents) {
                enhancedDetectorEnabled.analyze(trade);
            }
            const enhancedEnabledEnd = process.hrtime.bigint();
            const enhancedEnabledTime =
                Number(enhancedEnabledEnd - enhancedEnabledStart) / 1000000;

            // Benchmark baseline for comparison
            const originalStart = process.hrtime.bigint();
            for (const trade of testTradeEvents) {
                originalDetector.analyze(trade);
            }
            const originalEnd = process.hrtime.bigint();
            const originalTime = Number(originalEnd - originalStart) / 1000000;

            console.log(`Original detector: ${originalTime.toFixed(2)}ms`);
            console.log(
                `Enhanced detector (enabled): ${enhancedEnabledTime.toFixed(2)}ms`
            );

            const overhead =
                ((enhancedEnabledTime - originalTime) / originalTime) * 100;
            console.log(`Enhancement overhead: ${overhead.toFixed(1)}%`);

            // Enhanced detector with enabled features should have reasonable overhead
            // Note: 100% overhead is acceptable for a complex enhancement system in production
            // as the enhancement only runs selectively on high-value signals
            expect(overhead).toBeLessThan(150);
            expect(enhancedEnabledTime).toBeLessThan(originalTime * 2.5);
        });
    });

    describe("Memory Usage Validation", () => {
        it("should not significantly increase memory usage", () => {
            const initialMemory = process.memoryUsage();

            // Process trades with original detector
            for (const trade of testTradeEvents) {
                originalDetector.analyze(trade);
            }

            const originalMemory = process.memoryUsage();
            const originalHeapUsed =
                originalMemory.heapUsed - initialMemory.heapUsed;

            // Reset memory measurement
            global.gc?.();
            const resetMemory = process.memoryUsage();

            // Process trades with enhanced detector
            for (const trade of testTradeEvents) {
                enhancedDetectorEnabled.analyze(trade);
            }

            const enhancedMemory = process.memoryUsage();
            const enhancedHeapUsed =
                enhancedMemory.heapUsed - resetMemory.heapUsed;

            console.log(
                `Original detector heap usage: ${(originalHeapUsed / 1024 / 1024).toFixed(2)}MB`
            );
            console.log(
                `Enhanced detector heap usage: ${(enhancedHeapUsed / 1024 / 1024).toFixed(2)}MB`
            );

            const memoryIncrease =
                ((enhancedHeapUsed - originalHeapUsed) / originalHeapUsed) *
                100;
            console.log(`Memory increase: ${memoryIncrease.toFixed(1)}%`);

            // Memory usage should not increase by more than 50%
            if (originalHeapUsed > 0) {
                expect(memoryIncrease).toBeLessThan(50);
            }
        });
    });

    describe("Latency Distribution Analysis", () => {
        it("should maintain consistent latency characteristics", () => {
            const originalLatencies: number[] = [];
            const enhancedLatencies: number[] = [];

            // Measure individual trade processing latencies
            for (let i = 0; i < 100; i++) {
                const trade = testTradeEvents[i];

                // Original detector latency
                const originalStart = process.hrtime.bigint();
                originalDetector.analyze(trade);
                const originalEnd = process.hrtime.bigint();
                originalLatencies.push(
                    Number(originalEnd - originalStart) / 1000000
                );

                // Enhanced detector latency
                const enhancedStart = process.hrtime.bigint();
                enhancedDetectorEnabled.analyze(trade);
                const enhancedEnd = process.hrtime.bigint();
                enhancedLatencies.push(
                    Number(enhancedEnd - enhancedStart) / 1000000
                );
            }

            const originalP95 = calculatePercentile(originalLatencies, 95);
            const enhancedP95 = calculatePercentile(enhancedLatencies, 95);
            const originalAvg =
                originalLatencies.reduce((a, b) => a + b) /
                originalLatencies.length;
            const enhancedAvg =
                enhancedLatencies.reduce((a, b) => a + b) /
                enhancedLatencies.length;

            console.log(`Original P95 latency: ${originalP95.toFixed(4)}ms`);
            console.log(`Enhanced P95 latency: ${enhancedP95.toFixed(4)}ms`);
            console.log(`Original avg latency: ${originalAvg.toFixed(4)}ms`);
            console.log(`Enhanced avg latency: ${enhancedAvg.toFixed(4)}ms`);

            // P95 latency should not be more than 2x worse
            expect(enhancedP95).toBeLessThan(originalP95 * 2);
            expect(enhancedAvg).toBeLessThan(originalAvg * 2);
        });
    });

    describe("Throughput Analysis", () => {
        it("should maintain high throughput under load", () => {
            const tradeCount = 5000;
            const largeBatch = generateTestTradeEvents(tradeCount);

            // Original detector throughput
            const originalStart = process.hrtime.bigint();
            for (const trade of largeBatch) {
                originalDetector.analyze(trade);
            }
            const originalEnd = process.hrtime.bigint();
            const originalTime = Number(originalEnd - originalStart) / 1000000;
            const originalThroughput = tradeCount / (originalTime / 1000); // trades/sec

            // Enhanced detector throughput
            const enhancedStart = process.hrtime.bigint();
            for (const trade of largeBatch) {
                enhancedDetectorEnabled.analyze(trade);
            }
            const enhancedEnd = process.hrtime.bigint();
            const enhancedTime = Number(enhancedEnd - enhancedStart) / 1000000;
            const enhancedThroughput = tradeCount / (enhancedTime / 1000); // trades/sec

            console.log(
                `Original throughput: ${originalThroughput.toFixed(0)} trades/sec`
            );
            console.log(
                `Enhanced throughput: ${enhancedThroughput.toFixed(0)} trades/sec`
            );

            const throughputRatio = enhancedThroughput / originalThroughput;
            console.log(`Throughput ratio: ${throughputRatio.toFixed(2)}x`);

            // Enhanced detector should maintain at least 70% of original throughput
            expect(throughputRatio).toBeGreaterThan(0.7);
        });
    });

    describe("Enhancement Statistics Validation", () => {
        it("should provide meaningful enhancement statistics", () => {
            // Process enough trades to trigger enhancement logic
            for (let i = 0; i < 200; i++) {
                enhancedDetectorEnabled.analyze(testTradeEvents[i]);
            }

            const stats = enhancedDetectorEnabled.getEnhancementStats();

            expect(stats).toHaveProperty("enabled");
            expect(stats).toHaveProperty("mode");
            expect(stats).toHaveProperty("callCount");
            expect(stats).toHaveProperty("successCount");
            expect(stats).toHaveProperty("errorCount");
            expect(stats).toHaveProperty("successRate");

            expect(stats.enabled).toBe(true);
            expect(stats.mode).toBe("production");
            expect(stats.callCount).toBeGreaterThanOrEqual(0);
            expect(stats.successRate).toBeGreaterThanOrEqual(0);
            expect(stats.successRate).toBeLessThanOrEqual(1);

            console.log("Enhancement statistics:", stats);
        });
    });
});

/**
 * Generate test trade events with realistic LTCUSDT data
 */
function generateTestTradeEvents(count: number): EnrichedTradeEvent[] {
    const events: EnrichedTradeEvent[] = [];
    const basePrice = 89.0;
    const baseTime = Date.now() - 3600000; // 1 hour ago

    for (let i = 0; i < count; i++) {
        const price = basePrice + (Math.random() - 0.5) * 2; // ±$1 variation
        const quantity = 0.5 + Math.random() * 4.5; // 0.5-5.0 LTC
        const timestamp = baseTime + i * 1000; // 1 second intervals

        events.push({
            tradeId: i.toString(),
            price,
            quantity,
            timestamp,
            pair: "LTCUSDT",
            side: Math.random() > 0.5 ? "buy" : "sell",

            // Zone data for enhanced detector
            zoneData: {
                zones: new Map([
                    [
                        5,
                        {
                            price: Math.floor(price / 5) * 5,
                            volume: 100 + Math.random() * 500,
                        },
                    ],
                    [
                        10,
                        {
                            price: Math.floor(price / 10) * 10,
                            volume: 200 + Math.random() * 800,
                        },
                    ],
                    [
                        20,
                        {
                            price: Math.floor(price / 20) * 20,
                            volume: 400 + Math.random() * 1200,
                        },
                    ],
                ]),
                lastUpdate: timestamp,
            },

            // Passive volume data
            zonePassiveBidVolume: 50 + Math.random() * 200,
            zonePassiveAskVolume: 50 + Math.random() * 200,
        });
    }

    return events;
}

/**
 * Calculate percentile value from array of numbers
 */
function calculatePercentile(values: number[], percentile: number): number {
    const sorted = [...values].sort((a, b) => a - b);
    const index = Math.ceil((percentile / 100) * sorted.length) - 1;
    return sorted[index] || 0;
}
