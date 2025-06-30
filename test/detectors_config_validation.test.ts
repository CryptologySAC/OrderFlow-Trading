// test/detectors_config_validation.test.ts
//
// Universal Config Validation Test Suite
// Tests that ALL detectors properly use config.json values instead of overriding with hard-coded defaults

import {
    describe,
    it,
    expect,
    beforeEach,
    vi,
    type MockedFunction,
} from "vitest";
import { Config } from "../src/core/config.js";
import {
    ExhaustionDetectorEnhanced,
    type ExhaustionEnhancedSettings,
} from "../src/indicators/exhaustionDetectorEnhanced.js";
import {
    AbsorptionDetectorEnhanced,
    type AbsorptionEnhancedSettings,
} from "../src/indicators/absorptionDetectorEnhanced.js";
import {
    DeltaCVDDetectorEnhanced,
    type DeltaCVDEnhancedSettings,
} from "../src/indicators/deltaCVDDetectorEnhanced.js";
import type { ILogger } from "../src/infrastructure/loggerInterface.js";
import type { IMetricsCollector } from "../src/infrastructure/metricsCollectorInterface.js";
import { ISignalLogger } from "../src/infrastructure/signalLoggerInterface.js";
import { SpoofingDetector } from "../src/services/spoofingDetector.js";
import { IOrderBookState } from "../src/market/orderBookState.js";

// Mock dependencies
const createMockLogger = (): ILogger => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
});

const createMockMetricsCollector = (): IMetricsCollector => ({
    updateMetric: vi.fn(),
    incrementMetric: vi.fn(),
    incrementCounter: vi.fn(),
    recordHistogram: vi.fn(),
    recordGauge: vi.fn(),
    createCounter: vi.fn(),
    createHistogram: vi.fn(),
    createGauge: vi.fn(),
    getMetrics: vi.fn(() => ({})),
    getHealthSummary: vi.fn(() => "healthy"),
});

const createMockSpoofingDetector = (): SpoofingDetector =>
    ({
        isSpoofed: vi.fn(() => false),
        detectLayeringAttack: vi.fn(() => false),
    }) as unknown as SpoofingDetector;

const createMockSignalLogger = (): ISignalLogger => ({
    logSignal: vi.fn(),
    logAlert: vi.fn(),
    getSignalHistory: vi.fn(() => []),
});

// Create realistic order book mock for config validation tests
const createMockOrderBookState = (): IOrderBookState => {
    const bestBid = 86.26;
    const bestAsk = 86.27;
    const midPrice = (bestBid + bestAsk) / 2;
    const spread = bestAsk - bestBid;

    const createDepthLevel = (price: number): { bid: number; ask: number } => {
        const distanceFromMid = Math.abs(price - midPrice);
        const decayFactor = Math.exp(-distanceFromMid * 10);
        const baseVolume = 200;

        return {
            bid: price <= bestBid ? Math.max(0, baseVolume * decayFactor) : 0,
            ask: price >= bestAsk ? Math.max(0, baseVolume * decayFactor) : 0,
        };
    };

    return {
        getBestBid: vi.fn(() => bestBid),
        getBestAsk: vi.fn(() => bestAsk),
        getSpread: vi.fn(() => spread),
        getMidPrice: vi.fn(() => midPrice),
        getDepthAtPrice: vi.fn((price: number) => createDepthLevel(price)),
        getVolumeAtLevel: vi.fn((price?: number) =>
            price ? createDepthLevel(price) : { bid: 0, ask: 0 }
        ),
        isHealthy: vi.fn(() => true),
        getLastUpdateTime: vi.fn(() => Date.now()),

        // Additional IOrderBookState methods
        updateDepth: vi.fn(),
        getLevel: vi.fn((price: number) => ({
            price,
            ...createDepthLevel(price),
            timestamp: Date.now(),
        })),
        sumBand: vi.fn(() => ({ bid: 300, ask: 300, levels: 5 })),
        snapshot: vi.fn(() => new Map()),
        getDepthMetrics: vi.fn(() => ({
            totalLevels: 20,
            bidLevels: 10,
            askLevels: 10,
            totalBidVolume: 1000,
            totalAskVolume: 1000,
            imbalance: 0,
        })),
        shutdown: vi.fn(),
        recover: vi.fn(async () => {}),
        getHealth: vi.fn(() => ({
            status: "healthy" as const,
            initialized: true,
            lastUpdateMs: 100,
            circuitBreakerOpen: false,
            errorRate: 0,
            bookSize: 20,
            spread: spread,
            midPrice: midPrice,
            details: {},
        })),
        onStreamConnected: vi.fn(),
        onStreamDisconnected: vi.fn(),
    } as unknown as IOrderBookState;
};

describe("Detector Config Validation - Universal Test Suite", () => {
    let mockLogger: ILogger;
    let mockMetrics: IMetricsCollector;
    let mockSpoofing: SpoofingDetector;
    let mockSignalLogger: ISignalLogger;
    let mockOrderBook: IOrderBookState;

    beforeEach(() => {
        mockLogger = createMockLogger();
        mockMetrics = createMockMetricsCollector();
        mockSpoofing = createMockSpoofingDetector();
        mockSignalLogger = createMockSignalLogger();
        mockOrderBook = createMockOrderBookState();
    });

    describe("Exhaustion Detector Config Usage", () => {
        it("should use exhaustionThreshold from config, not hard-coded default", () => {
            // Config specifies 0.4, but code defaults to 0.7 - this is the bug!
            const configValue = 0.4;
            const wrongDefault = 0.7;

            const settings: ExhaustionSettings = {
                symbol: "LTCUSDT",
                exhaustionThreshold: configValue, // From config.json
                windowMs: 45000,
                minAggVolume: 20,
                pricePrecision: 2,
                zoneTicks: 3,
                eventCooldownMs: 10000,
            };

            const detector = new ExhaustionDetectorEnhanced(
                "test-exhaustion",
                settings,
                mockLogger,
                mockSpoofing,
                mockMetrics,
                mockSignalLogger
            );

            // Access private property to verify actual threshold used
            const actualThreshold = (detector as any).exhaustionThreshold;

            // CRITICAL: Should use config value, not hard-coded default
            expect(actualThreshold).toBe(configValue);
            expect(actualThreshold).not.toBe(wrongDefault);
        });

        it("should use minAggVolume from config", () => {
            const configValue = 20; // From config.json

            const settings: ExhaustionSettings = {
                symbol: "LTCUSDT",
                minAggVolume: configValue,
                windowMs: 45000,
                pricePrecision: 2,
                zoneTicks: 3,
                eventCooldownMs: 10000,
            };

            const detector = new ExhaustionDetectorEnhanced(
                "test-exhaustion",
                settings,
                mockLogger,
                mockSpoofing,
                mockMetrics,
                mockSignalLogger
            );

            const actualMinAggVolume = (detector as any).minAggVolume;
            expect(actualMinAggVolume).toBe(configValue);
        });

        it("should use maxPassiveRatio from config", () => {
            const configValue = 0.35; // From config.json

            const settings: ExhaustionSettings = {
                symbol: "LTCUSDT",
                maxPassiveRatio: configValue,
                windowMs: 45000,
                minAggVolume: 20,
                pricePrecision: 2,
                zoneTicks: 3,
                eventCooldownMs: 10000,
            };

            const detector = new ExhaustionDetectorEnhanced(
                "test-exhaustion",
                settings,
                mockLogger,
                mockSpoofing,
                mockMetrics,
                mockSignalLogger
            );

            const actualMaxPassiveRatio = (detector as any).maxPassiveRatio;
            expect(actualMaxPassiveRatio).toBe(configValue);
        });

        it("should use all scoring weights from config", () => {
            const configWeights = {
                depletion: 0.45,
                passive: 0.3,
                continuity: 0.12,
                imbalance: 0.08,
                spread: 0.04,
                velocity: 0.01,
            };

            const settings: ExhaustionSettings = {
                symbol: "LTCUSDT",
                scoringWeights: configWeights,
                windowMs: 45000,
                minAggVolume: 20,
                pricePrecision: 2,
                zoneTicks: 3,
                eventCooldownMs: 10000,
            };

            const detector = new ExhaustionDetectorEnhanced(
                "test-exhaustion",
                settings,
                mockLogger,
                mockSpoofing,
                mockMetrics,
                mockSignalLogger
            );

            const actualWeights = (detector as any).scoringWeights;
            expect(actualWeights.depletion).toBe(configWeights.depletion);
            expect(actualWeights.passive).toBe(configWeights.passive);
            expect(actualWeights.continuity).toBe(configWeights.continuity);
            expect(actualWeights.imbalance).toBe(configWeights.imbalance);
            expect(actualWeights.spread).toBe(configWeights.spread);
            expect(actualWeights.velocity).toBe(configWeights.velocity);
        });
    });

    describe("Absorption Detector Config Usage", () => {
        it("should use absorptionThreshold from config", () => {
            const configValue = 0.6; // From config.json

            const settings: AbsorptionSettings = {
                symbol: "LTCUSDT",
                absorptionThreshold: configValue,
                windowMs: 60000,
                minAggVolume: 175,
                pricePrecision: 2,
                zoneTicks: 5,
                eventCooldownMs: 15000,
            };

            const detector = new AbsorptionDetectorEnhanced(
                "test-absorption",
                settings,
                mockOrderBook,
                mockLogger,
                mockSpoofing,
                mockMetrics,
                mockSignalLogger
            );

            const actualThreshold = (detector as any).absorptionThreshold;
            expect(actualThreshold).toBe(configValue);
        });

        it("should use minAggVolume from config", () => {
            const configValue = 175; // From config.json

            const settings: AbsorptionSettings = {
                symbol: "LTCUSDT",
                minAggVolume: configValue,
                windowMs: 60000,
                pricePrecision: 2,
                zoneTicks: 5,
                eventCooldownMs: 15000,
            };

            const detector = new AbsorptionDetectorEnhanced(
                "test-absorption",
                settings,
                mockOrderBook,
                mockLogger,
                mockSpoofing,
                mockMetrics,
                mockSignalLogger
            );

            const actualMinAggVolume = (detector as any).minAggVolume;
            expect(actualMinAggVolume).toBe(configValue);
        });

        it("should use priceEfficiencyThreshold from config", () => {
            const configValue = 0.02; // From config.json

            const settings: AbsorptionSettings = {
                symbol: "LTCUSDT",
                priceEfficiencyThreshold: configValue,
                windowMs: 60000,
                minAggVolume: 175,
                pricePrecision: 2,
                zoneTicks: 5,
                eventCooldownMs: 15000,
            };

            const detector = new AbsorptionDetectorEnhanced(
                "test-absorption",
                settings,
                mockOrderBook,
                mockLogger,
                mockSpoofing,
                mockMetrics,
                mockSignalLogger
            );

            const actualThreshold = (detector as any).priceEfficiencyThreshold;
            expect(actualThreshold).toBe(configValue);
        });

        it("should use maxAbsorptionRatio from config", () => {
            const configValue = 0.4; // From config.json

            const settings: AbsorptionSettings = {
                symbol: "LTCUSDT",
                maxAbsorptionRatio: configValue,
                windowMs: 60000,
                minAggVolume: 175,
                pricePrecision: 2,
                zoneTicks: 5,
                eventCooldownMs: 15000,
            };

            const detector = new AbsorptionDetectorEnhanced(
                "test-absorption",
                settings,
                mockOrderBook,
                mockLogger,
                mockSpoofing,
                mockMetrics,
                mockSignalLogger
            );

            const actualRatio = (detector as any).maxAbsorptionRatio;
            expect(actualRatio).toBe(configValue);
        });
    });

    describe("DeltaCVD Detector Config Usage", () => {
        it("should use baseConfidenceRequired from config", () => {
            const configValue = 0.2; // From config.json

            const settings: DeltaCVDEnhancedSettings = {
                symbol: "LTCUSDT",
                baseConfidenceRequired: configValue,
                windowMs: 60000,
                minAggVolume: 20,
                pricePrecision: 2,
                zoneTicks: 3,
                eventCooldownMs: 15000,
            };

            const detector = new DeltaCVDDetectorEnhanced(
                "test-deltacvd",
                settings,
                mockLogger,
                mockSpoofing,
                mockMetrics,
                mockSignalLogger
            );

            const actualConfidence = (detector as any).baseConfidenceRequired;
            expect(actualConfidence).toBe(configValue);
        });

        it("should use finalConfidenceRequired from config", () => {
            const configValue = 0.35; // From config.json

            const settings: DeltaCVDEnhancedSettings = {
                symbol: "LTCUSDT",
                finalConfidenceRequired: configValue,
                windowMs: 60000,
                minAggVolume: 20,
                pricePrecision: 2,
                zoneTicks: 3,
                eventCooldownMs: 15000,
            };

            const detector = new DeltaCVDDetectorEnhanced(
                "test-deltacvd",
                settings,
                mockLogger,
                mockSpoofing,
                mockMetrics,
                mockSignalLogger
            );

            const actualConfidence = (detector as any).finalConfidenceRequired;
            expect(actualConfidence).toBe(configValue);
        });

        it("should use usePassiveVolume feature flag from config", () => {
            const configValue = true; // From config.json

            const settings: DeltaCVDEnhancedSettings = {
                symbol: "LTCUSDT",
                usePassiveVolume: configValue,
                windowMs: 60000,
                minAggVolume: 20,
                pricePrecision: 2,
                zoneTicks: 3,
                eventCooldownMs: 15000,
            };

            const detector = new DeltaCVDDetectorEnhanced(
                "test-deltacvd",
                settings,
                mockLogger,
                mockSpoofing,
                mockMetrics,
                mockSignalLogger
            );

            const actualFlag = (detector as any).usePassiveVolume;
            expect(actualFlag).toBe(configValue);
        });

        it("should use enableDepthAnalysis feature flag from config", () => {
            const configValue = true; // From config.json

            const settings: DeltaCVDEnhancedSettings = {
                symbol: "LTCUSDT",
                enableDepthAnalysis: configValue,
                windowMs: 60000,
                minAggVolume: 20,
                pricePrecision: 2,
                zoneTicks: 3,
                eventCooldownMs: 15000,
            };

            const detector = new DeltaCVDDetectorEnhanced(
                "test-deltacvd",
                settings,
                mockLogger,
                mockSpoofing,
                mockMetrics,
                mockSignalLogger
            );

            const actualFlag = (detector as any).enableDepthAnalysis;
            expect(actualFlag).toBe(configValue);
        });
    });

    describe("Config Override Detection", () => {
        it("should detect when hard-coded defaults override config values", () => {
            // This test specifically catches the exhaustion threshold bug
            const configSettings: ExhaustionSettings = {
                symbol: "LTCUSDT",
                exhaustionThreshold: 0.4, // Config value
                windowMs: 45000,
                minAggVolume: 20,
                pricePrecision: 2,
                zoneTicks: 3,
                eventCooldownMs: 10000,
            };

            const detector = new ExhaustionDetectorEnhanced(
                "test-exhaustion",
                configSettings,
                mockLogger,
                mockSpoofing,
                mockMetrics,
                mockSignalLogger
            );

            const actualThreshold = (detector as any).exhaustionThreshold;

            // If this fails, it means the detector is using hard-coded defaults
            // instead of honoring the config values
            expect(actualThreshold).toBe(0.4);

            // This would be the wrong behavior (using hard-coded default)
            expect(actualThreshold).not.toBe(0.7);
        });

        it("should validate all parameters match their config inputs exactly", () => {
            const testSettings = {
                exhaustionThreshold: 0.123,
                maxPassiveRatio: 0.456,
                minDepletionFactor: 0.789,
                imbalanceHighThreshold: 0.999,
                spreadHighThreshold: 0.001,
            };

            const settings: ExhaustionSettings = {
                symbol: "LTCUSDT",
                ...testSettings,
                windowMs: 45000,
                minAggVolume: 20,
                pricePrecision: 2,
                zoneTicks: 3,
                eventCooldownMs: 10000,
            };

            const detector = new ExhaustionDetectorEnhanced(
                "test-exhaustion",
                settings,
                mockLogger,
                mockSpoofing,
                mockMetrics,
                mockSignalLogger
            );

            // Verify exact match for all parameters
            expect((detector as any).exhaustionThreshold).toBe(
                testSettings.exhaustionThreshold
            );
            expect((detector as any).maxPassiveRatio).toBe(
                testSettings.maxPassiveRatio
            );
            expect((detector as any).minDepletionFactor).toBe(
                testSettings.minDepletionFactor
            );
            expect((detector as any).imbalanceHighThreshold).toBe(
                testSettings.imbalanceHighThreshold
            );
            expect((detector as any).spreadHighThreshold).toBe(
                testSettings.spreadHighThreshold
            );
        });
    });

    describe("Missing Config Handling", () => {
        it("should use appropriate defaults when config values are undefined", () => {
            // Test that missing config values get sensible defaults,
            // but explicitly provided values are always honored
            const settingsWithMissingValues: ExhaustionSettings = {
                symbol: "LTCUSDT",
                // exhaustionThreshold intentionally omitted
                windowMs: 45000,
                minAggVolume: 20,
                pricePrecision: 2,
                zoneTicks: 3,
                eventCooldownMs: 10000,
            };

            const detector = new ExhaustionDetectorEnhanced(
                "test-exhaustion",
                settingsWithMissingValues,
                mockLogger,
                mockSpoofing,
                mockMetrics,
                mockSignalLogger
            );

            const actualThreshold = (detector as any).exhaustionThreshold;

            // Should have a valid default (not undefined)
            expect(actualThreshold).toBeDefined();
            expect(typeof actualThreshold).toBe("number");
            expect(actualThreshold).toBeGreaterThan(0);
            expect(actualThreshold).toBeLessThanOrEqual(1);
        });

        it("should prefer explicit config values over defaults", () => {
            const explicitValue = 0.333;

            const settingsWithExplicitValue: ExhaustionSettings = {
                symbol: "LTCUSDT",
                exhaustionThreshold: explicitValue,
                windowMs: 45000,
                minAggVolume: 20,
                pricePrecision: 2,
                zoneTicks: 3,
                eventCooldownMs: 10000,
            };

            const detector = new ExhaustionDetectorEnhanced(
                "test-exhaustion",
                settingsWithExplicitValue,
                mockLogger,
                mockSpoofing,
                mockMetrics,
                mockSignalLogger
            );

            const actualThreshold = (detector as any).exhaustionThreshold;

            // Must use the explicitly provided value
            expect(actualThreshold).toBe(explicitValue);
        });
    });
});
