// test/framework/mathematicalPropertyTesting.ts - Mathematical Property Testing Framework

import { expect } from "vitest";
import type { EnrichedTradeEvent } from "../../src/types/marketEvents.js";
import type { SignalCandidate } from "../../src/types/signalTypes.js";
import type { ILogger } from "../../src/infrastructure/loggerInterface.js";
import type { IMetricsCollector } from "../../src/infrastructure/metricsCollectorInterface.js";

/**
 * Mathematical Property Testing Framework for Trading System Detectors
 *
 * This framework validates mathematical invariants and properties that should hold
 * true for all detectors regardless of market conditions or input data.
 *
 * Key Property Categories:
 * 1. Numerical Stability (no NaN, Infinity, or overflow)
 * 2. Monotonicity (increasing/decreasing functions behave correctly)
 * 3. Boundedness (values stay within expected ranges)
 * 4. Consistency (same input produces same output)
 * 5. Convergence (algorithms converge to expected values)
 * 6. Edge Case Handling (extreme values, empty data, etc.)
 */

// Property test configuration
export interface PropertyTestConfig {
    maxIterations: number;
    tolerance: number;
    confidenceInterval: number;
    randomSeed?: number;
}

export const DEFAULT_PROPERTY_CONFIG: PropertyTestConfig = {
    maxIterations: 1000,
    tolerance: 1e-10,
    confidenceInterval: 0.95,
    randomSeed: 42,
};

// Test data generators
export class PropertyTestDataGenerator {
    private rng: () => number;

    constructor(seed: number = 42) {
        // Simple seedable PRNG for reproducible tests
        let state = seed;
        this.rng = () => {
            state = (state * 1664525 + 1013904223) % 0x100000000;
            return state / 0x100000000;
        };
    }

    /**
     * Generate normal market conditions trade data
     */
    generateNormalTrades(
        count: number,
        basePrice: number = 100
    ): EnrichedTradeEvent[] {
        const trades: EnrichedTradeEvent[] = [];
        let currentPrice = basePrice;

        for (let i = 0; i < count; i++) {
            // Normal price movement: ±0.1% typically
            const priceChange = (this.rng() - 0.5) * 0.002 * currentPrice;
            currentPrice = Math.max(0.01, currentPrice + priceChange);

            // Normal quantity: 0.1 to 100 LTC
            const quantity = 0.1 + this.rng() * 99.9;

            trades.push({
                tradeId: i,
                timestamp: Date.now() + i * 1000,
                price: Number(currentPrice.toFixed(2)),
                quantity: Number(quantity.toFixed(8)),
                buyerIsMaker: this.rng() > 0.5,
            });
        }

        return trades;
    }

    /**
     * Generate extreme edge case trade data
     */
    generateExtremeTrades(count: number): EnrichedTradeEvent[] {
        const trades: EnrichedTradeEvent[] = [];
        const extremeValues = [
            { price: 0.01, quantity: 0.00000001 }, // Minimum values
            { price: 1000000, quantity: 1000000 }, // Maximum values
            { price: 0.00000001, quantity: 0.01 }, // Inverted extremes
            { price: 1000000, quantity: 0.00000001 }, // High price, low quantity
            { price: 0.01, quantity: 1000000 }, // Low price, high quantity
        ];

        for (let i = 0; i < count; i++) {
            const extreme = extremeValues[i % extremeValues.length];
            trades.push({
                tradeId: i,
                timestamp: Date.now() + i * 1000,
                price: extreme.price,
                quantity: extreme.quantity,
                buyerIsMaker: this.rng() > 0.5,
            });
        }

        return trades;
    }

    /**
     * Generate highly volatile market conditions
     */
    generateVolatileTrades(
        count: number,
        basePrice: number = 100
    ): EnrichedTradeEvent[] {
        const trades: EnrichedTradeEvent[] = [];
        let currentPrice = basePrice;

        for (let i = 0; i < count; i++) {
            // Volatile price movement: ±5% per trade
            const priceChange = (this.rng() - 0.5) * 0.1 * currentPrice;
            currentPrice = Math.max(0.01, currentPrice + priceChange);

            // Volatile quantity: wide range
            const quantity =
                this.rng() > 0.9
                    ? 1000 + this.rng() * 10000 // Large orders 10% of time
                    : 0.1 + this.rng() * 99.9; // Normal orders 90% of time

            trades.push({
                tradeId: i,
                timestamp: Date.now() + i * 100, // Faster trades during volatility
                price: Number(currentPrice.toFixed(2)),
                quantity: Number(quantity.toFixed(8)),
                buyerIsMaker: this.rng() > 0.5,
            });
        }

        return trades;
    }

    /**
     * Generate trending market data (upward or downward)
     */
    generateTrendingTrades(
        count: number,
        basePrice: number = 100,
        trendDirection: "up" | "down" = "up"
    ): EnrichedTradeEvent[] {
        const trades: EnrichedTradeEvent[] = [];
        let currentPrice = basePrice;
        const trendMultiplier = trendDirection === "up" ? 1 : -1;

        for (let i = 0; i < count; i++) {
            // Trending price movement with noise
            const trend = trendMultiplier * 0.001 * currentPrice; // 0.1% trend per trade
            const noise = (this.rng() - 0.5) * 0.002 * currentPrice; // ±0.1% noise
            currentPrice = Math.max(0.01, currentPrice + trend + noise);

            // Normal quantity distribution
            const quantity = 0.1 + this.rng() * 99.9;

            trades.push({
                tradeId: i,
                timestamp: Date.now() + i * 1000,
                price: Number(currentPrice.toFixed(2)),
                quantity: Number(quantity.toFixed(8)),
                buyerIsMaker: this.rng() > 0.5,
            });
        }

        return trades;
    }

    /**
     * Generate sparse market data (low frequency)
     */
    generateSparseTrades(
        count: number,
        basePrice: number = 100
    ): EnrichedTradeEvent[] {
        const trades: EnrichedTradeEvent[] = [];
        let currentPrice = basePrice;

        for (let i = 0; i < count; i++) {
            // Minimal price movement
            const priceChange = (this.rng() - 0.5) * 0.0001 * currentPrice;
            currentPrice = Math.max(0.01, currentPrice + priceChange);

            // Small quantities
            const quantity = 0.1 + this.rng() * 9.9; // 0.1 to 10 LTC

            trades.push({
                tradeId: i,
                timestamp: Date.now() + i * 60000, // 1 minute intervals
                price: Number(currentPrice.toFixed(2)),
                quantity: Number(quantity.toFixed(8)),
                buyerIsMaker: this.rng() > 0.5,
            });
        }

        return trades;
    }
}

// Mathematical property validators
export class MathematicalPropertyValidator {
    /**
     * Validate numerical stability - no NaN, Infinity, or invalid numbers
     */
    static validateNumericalStability(value: unknown, context: string): void {
        if (typeof value === "number") {
            expect(
                isFinite(value),
                `${context}: Value should be finite, got ${value}`
            ).toBe(true);
            expect(!isNaN(value), `${context}: Value should not be NaN`).toBe(
                true
            );
            expect(
                value !== Infinity,
                `${context}: Value should not be Infinity`
            ).toBe(true);
            expect(
                value !== -Infinity,
                `${context}: Value should not be -Infinity`
            ).toBe(true);
        } else if (typeof value === "object" && value !== null) {
            // Recursively validate object properties
            Object.entries(value).forEach(([key, val]) => {
                this.validateNumericalStability(val, `${context}.${key}`);
            });
        }
    }

    /**
     * Validate confidence values are properly bounded [0, 1]
     */
    static validateConfidenceBounds(confidence: number, context: string): void {
        this.validateNumericalStability(confidence, `${context}.confidence`);
        expect(
            confidence,
            `${context}: Confidence should be >= 0`
        ).toBeGreaterThanOrEqual(0);
        expect(
            confidence,
            `${context}: Confidence should be <= 1`
        ).toBeLessThanOrEqual(1);
    }

    /**
     * Validate price values are positive and reasonable
     */
    static validatePriceBounds(price: number, context: string): void {
        this.validateNumericalStability(price, `${context}.price`);
        expect(price, `${context}: Price should be positive`).toBeGreaterThan(
            0
        );
        expect(
            price,
            `${context}: Price should be reasonable (<= 1M)`
        ).toBeLessThanOrEqual(1000000);
    }

    /**
     * Validate quantity values are positive
     */
    static validateQuantityBounds(quantity: number, context: string): void {
        this.validateNumericalStability(quantity, `${context}.quantity`);
        expect(
            quantity,
            `${context}: Quantity should be positive`
        ).toBeGreaterThan(0);
        expect(
            quantity,
            `${context}: Quantity should be reasonable (<= 1M)`
        ).toBeLessThanOrEqual(1000000);
    }

    /**
     * Validate monotonicity - function should be monotonic in specified direction
     */
    static validateMonotonicity<T>(
        inputs: T[],
        outputs: number[],
        direction:
            | "increasing"
            | "decreasing"
            | "non-decreasing"
            | "non-increasing",
        context: string
    ): void {
        expect(
            inputs.length,
            `${context}: Inputs and outputs should have same length`
        ).toBe(outputs.length);

        for (let i = 1; i < outputs.length; i++) {
            const prev = outputs[i - 1];
            const curr = outputs[i];

            this.validateNumericalStability(
                prev,
                `${context}.output[${i - 1}]`
            );
            this.validateNumericalStability(curr, `${context}.output[${i}]`);

            switch (direction) {
                case "increasing":
                    expect(
                        curr,
                        `${context}: Output should be strictly increasing at index ${i}`
                    ).toBeGreaterThan(prev);
                    break;
                case "decreasing":
                    expect(
                        curr,
                        `${context}: Output should be strictly decreasing at index ${i}`
                    ).toBeLessThan(prev);
                    break;
                case "non-decreasing":
                    expect(
                        curr,
                        `${context}: Output should be non-decreasing at index ${i}`
                    ).toBeGreaterThanOrEqual(prev);
                    break;
                case "non-increasing":
                    expect(
                        curr,
                        `${context}: Output should be non-increasing at index ${i}`
                    ).toBeLessThanOrEqual(prev);
                    break;
            }
        }
    }

    /**
     * Validate consistency - same input should produce same output
     */
    static validateConsistency<T>(
        testFunction: (input: T) => number,
        input: T,
        iterations: number,
        tolerance: number,
        context: string
    ): void {
        const results: number[] = [];

        for (let i = 0; i < iterations; i++) {
            const result = testFunction(input);
            this.validateNumericalStability(result, `${context}.result[${i}]`);
            results.push(result);
        }

        // All results should be within tolerance of the first result
        const baseline = results[0];
        for (let i = 1; i < results.length; i++) {
            const diff = Math.abs(results[i] - baseline);
            expect(
                diff,
                `${context}: Result ${i} should be consistent with baseline (diff: ${diff}, tolerance: ${tolerance})`
            ).toBeLessThanOrEqual(tolerance);
        }
    }

    /**
     * Validate signal properties
     */
    static validateSignalProperties(
        signal: SignalCandidate,
        context: string
    ): void {
        // Basic structure validation
        expect(signal, `${context}: Signal should be defined`).toBeDefined();
        expect(signal.id, `${context}: Signal should have ID`).toBeDefined();
        expect(
            signal.type,
            `${context}: Signal should have type`
        ).toBeDefined();
        expect(signal.side, `${context}: Signal should have side`).toMatch(
            /^(buy|sell)$/
        );

        // Numerical validation
        this.validateConfidenceBounds(signal.confidence, context);
        this.validateNumericalStability(
            signal.timestamp,
            `${context}.timestamp`
        );
        expect(
            signal.timestamp,
            `${context}: Timestamp should be positive`
        ).toBeGreaterThan(0);

        // Data validation if present
        if (signal.data) {
            this.validateNumericalStability(signal.data, `${context}.data`);

            if (typeof signal.data === "object" && "price" in signal.data) {
                this.validatePriceBounds(
                    signal.data.price as number,
                    `${context}.data`
                );
            }
        }
    }

    /**
     * Validate detector state consistency
     */
    static validateDetectorState(detector: any, context: string): void {
        // Validate common detector properties
        expect(
            detector,
            `${context}: Detector should be defined`
        ).toBeDefined();

        // Check if detector has getStatus method and validate its output
        if (typeof detector.getStatus === "function") {
            const status = detector.getStatus();
            expect(typeof status, `${context}: Status should be string`).toBe(
                "string"
            );
            expect(
                status.length,
                `${context}: Status should not be empty`
            ).toBeGreaterThan(0);
        }

        // Validate any metrics if available
        if (typeof detector.getStatistics === "function") {
            const stats = detector.getStatistics();
            if (stats) {
                this.validateNumericalStability(stats, `${context}.statistics`);
            }
        }
    }

    /**
     * Validate convergence properties - values should converge to expected range
     */
    static validateConvergence(
        values: number[],
        expectedRange: [number, number],
        context: string,
        minSamples: number = 100
    ): void {
        expect(
            values.length,
            `${context}: Should have enough samples for convergence test`
        ).toBeGreaterThanOrEqual(minSamples);

        // Take last 20% of values for convergence check
        const convergenceWindow = Math.floor(values.length * 0.2);
        const recentValues = values.slice(-convergenceWindow);

        const [expectedMin, expectedMax] = expectedRange;

        for (let i = 0; i < recentValues.length; i++) {
            const value = recentValues[i];
            this.validateNumericalStability(
                value,
                `${context}.convergence[${i}]`
            );
            expect(
                value,
                `${context}: Converged value ${i} should be >= ${expectedMin}`
            ).toBeGreaterThanOrEqual(expectedMin);
            expect(
                value,
                `${context}: Converged value ${i} should be <= ${expectedMax}`
            ).toBeLessThanOrEqual(expectedMax);
        }
    }
}

// Property-based test runner
export class PropertyTestRunner {
    private config: PropertyTestConfig;
    private dataGenerator: PropertyTestDataGenerator;

    constructor(config: Partial<PropertyTestConfig> = {}) {
        this.config = { ...DEFAULT_PROPERTY_CONFIG, ...config };
        this.dataGenerator = new PropertyTestDataGenerator(
            this.config.randomSeed
        );
    }

    /**
     * Run comprehensive property tests on a detector
     */
    async runDetectorPropertyTests<T>(
        detectorFactory: () => T,
        detectorProcessor: (detector: T, trade: EnrichedTradeEvent) => void,
        signalCollector: (detector: T) => SignalCandidate[],
        testName: string
    ): Promise<void> {
        console.log(`\n=== Running Property Tests for ${testName} ===`);

        // Test 1: Numerical Stability under Normal Conditions
        await this.testNumericalStability(
            detectorFactory,
            detectorProcessor,
            signalCollector,
            testName
        );

        // Test 2: Edge Case Handling
        await this.testEdgeCaseHandling(
            detectorFactory,
            detectorProcessor,
            signalCollector,
            testName
        );

        // Test 3: Consistency under Repeated Input
        await this.testConsistency(
            detectorFactory,
            detectorProcessor,
            signalCollector,
            testName
        );

        // Test 4: Behavior under Market Volatility
        await this.testVolatilityHandling(
            detectorFactory,
            detectorProcessor,
            signalCollector,
            testName
        );

        // Test 5: Signal Quality Properties
        await this.testSignalQuality(
            detectorFactory,
            detectorProcessor,
            signalCollector,
            testName
        );

        console.log(`✅ All property tests passed for ${testName}`);
    }

    private async testNumericalStability<T>(
        detectorFactory: () => T,
        detectorProcessor: (detector: T, trade: EnrichedTradeEvent) => void,
        signalCollector: (detector: T) => SignalCandidate[],
        testName: string
    ): Promise<void> {
        const detector = detectorFactory();
        const trades = this.dataGenerator.generateNormalTrades(100);

        for (const trade of trades) {
            detectorProcessor(detector, trade);

            // Validate detector state after each trade
            MathematicalPropertyValidator.validateDetectorState(
                detector,
                `${testName}.normalConditions`
            );
        }

        // Validate all signals produced
        const signals = signalCollector(detector);
        signals.forEach((signal, i) => {
            MathematicalPropertyValidator.validateSignalProperties(
                signal,
                `${testName}.normalConditions.signal[${i}]`
            );
        });
    }

    private async testEdgeCaseHandling<T>(
        detectorFactory: () => T,
        detectorProcessor: (detector: T, trade: EnrichedTradeEvent) => void,
        signalCollector: (detector: T) => SignalCandidate[],
        testName: string
    ): Promise<void> {
        const detector = detectorFactory();
        const extremeTrades = this.dataGenerator.generateExtremeTrades(20);

        for (const trade of extremeTrades) {
            detectorProcessor(detector, trade);

            // Validate detector doesn't break on extreme values
            MathematicalPropertyValidator.validateDetectorState(
                detector,
                `${testName}.extremeValues`
            );
        }

        // Validate signals remain valid even with extreme inputs
        const signals = signalCollector(detector);
        signals.forEach((signal, i) => {
            MathematicalPropertyValidator.validateSignalProperties(
                signal,
                `${testName}.extremeValues.signal[${i}]`
            );
        });
    }

    private async testConsistency<T>(
        detectorFactory: () => T,
        detectorProcessor: (detector: T, trade: EnrichedTradeEvent) => void,
        signalCollector: (detector: T) => SignalCandidate[],
        testName: string
    ): Promise<void> {
        const testTrade: EnrichedTradeEvent = {
            tradeId: 1,
            timestamp: Date.now(),
            price: 100.5,
            quantity: 25.0,
            buyerIsMaker: false,
        };

        const signalCounts: number[] = [];

        // Run same trade through fresh detector instances multiple times
        for (let i = 0; i < 10; i++) {
            const detector = detectorFactory();
            detectorProcessor(detector, testTrade);
            const signals = signalCollector(detector);
            signalCounts.push(signals.length);
        }

        // All runs should produce same number of signals
        MathematicalPropertyValidator.validateConsistency(
            () => signalCounts[0],
            null,
            1,
            0,
            `${testName}.consistency`
        );
    }

    private async testVolatilityHandling<T>(
        detectorFactory: () => T,
        detectorProcessor: (detector: T, trade: EnrichedTradeEvent) => void,
        signalCollector: (detector: T) => SignalCandidate[],
        testName: string
    ): Promise<void> {
        const detector = detectorFactory();
        const volatileTrades = this.dataGenerator.generateVolatileTrades(200);

        for (const trade of volatileTrades) {
            detectorProcessor(detector, trade);

            // Validate detector remains stable during high volatility
            MathematicalPropertyValidator.validateDetectorState(
                detector,
                `${testName}.volatility`
            );
        }

        // Validate signals during volatility
        const signals = signalCollector(detector);
        signals.forEach((signal, i) => {
            MathematicalPropertyValidator.validateSignalProperties(
                signal,
                `${testName}.volatility.signal[${i}]`
            );
        });
    }

    private async testSignalQuality<T>(
        detectorFactory: () => T,
        detectorProcessor: (detector: T, trade: EnrichedTradeEvent) => void,
        signalCollector: (detector: T) => SignalCandidate[],
        testName: string
    ): Promise<void> {
        const detector = detectorFactory();
        const trendingTrades = this.dataGenerator.generateTrendingTrades(
            500,
            100,
            "up"
        );

        const signalConfidences: number[] = [];

        for (const trade of trendingTrades) {
            detectorProcessor(detector, trade);

            const signals = signalCollector(detector);
            signalConfidences.push(...signals.map((s) => s.confidence));
        }

        if (signalConfidences.length > 0) {
            // Signal confidences should be reasonable and bounded
            MathematicalPropertyValidator.validateConvergence(
                signalConfidences,
                [0, 1],
                `${testName}.signalQuality.confidence`,
                Math.min(10, signalConfidences.length)
            );
        }
    }
}

// Mock factory helpers for common detector types
export class MockFactoryHelpers {
    static createMockLogger(): ILogger {
        return {
            info: (...args: any[]) => {},
            error: (...args: any[]) => {},
            warn: (...args: any[]) => {},
            debug: (...args: any[]) => {},
            isDebugEnabled: () => false,
            setCorrelationId: () => {},
            removeCorrelationId: () => {},
        };
    }

    static createMockMetrics(): IMetricsCollector {
        return {
            // Legacy metrics methods
            updateMetric: () => {},
            incrementMetric: () => {},
            getMetrics: () => ({ timestamp: Date.now() }),
            getHealthSummary: () => "healthy",

            // Metric registration
            registerMetric: () => {},

            // Histogram methods
            recordHistogram: () => {},
            getHistogramPercentiles: () => null,
            getHistogramSummary: () => null,
            createHistogram: () => {},

            // Gauge methods
            recordGauge: () => {},
            getGaugeValue: () => null,
            createGauge: () => {},
            setGauge: () => {},

            // Counter methods
            incrementCounter: () => {},
            decrementCounter: () => {},
            getCounterRate: () => 0,
            createCounter: () => {},

            // Latency methods
            getAverageLatency: () => 0,
            getLatencyPercentiles: () => ({}),

            // Export methods
            exportPrometheus: () => "",
            exportJSON: () => "{}",

            // Management methods
            reset: () => {},
            cleanup: () => {},
        };
    }
}
