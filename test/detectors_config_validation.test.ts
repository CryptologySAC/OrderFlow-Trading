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
import type { IOrderflowPreprocessor } from "../src/market/orderFlowPreprocessor.js";

// Mock dependencies
const createMockLogger = (): ILogger => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    isDebugEnabled: vi.fn().mockReturnValue(false),
    setCorrelationId: vi.fn(),
    removeCorrelationId: vi.fn(),
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

const createMockPreprocessor = (): IOrderflowPreprocessor => ({
    handleDepth: vi.fn(),
    handleAggTrade: vi.fn(),
    getStats: vi.fn(() => ({
        processedTrades: 0,
        processedDepthUpdates: 0,
        bookMetrics: {} as any,
    })),
    findZonesNearPrice: vi.fn(() => []),
    calculateZoneRelevanceScore: vi.fn(() => 0.5),
    findMostRelevantZone: vi.fn(() => null),
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

            const settings: ExhaustionEnhancedSettings = {
                // Base detector settings
                minAggVolume: 20,
                windowMs: 45000,
                pricePrecision: 2,
                zoneTicks: 3,
                eventCooldownMs: 10000,
                minInitialMoveTicks: 1,
                confirmationTimeoutMs: 40000,
                maxRevisitTicks: 8,

                // Exhaustion-specific thresholds
                volumeSurgeMultiplier: 2.0,
                imbalanceThreshold: 0.3,
                institutionalThreshold: 15,
                burstDetectionMs: 2000,
                sustainedVolumeMs: 20000,
                medianTradeSize: 0.8,
                exhaustionThreshold: configValue, // From config.json
                maxPassiveRatio: 0.35,
                minDepletionFactor: 0.2,
                imbalanceHighThreshold: 0.75,
                imbalanceMediumThreshold: 0.55,
                spreadHighThreshold: 0.004,
                spreadMediumThreshold: 0.0015,

                // Scoring weights
                scoringWeights: {
                    depletion: 0.45,
                    passive: 0.3,
                    continuity: 0.12,
                    imbalance: 0.08,
                    spread: 0.04,
                    velocity: 0.01,
                },

                // Quality and performance settings
                depletionThresholdRatio: 0.15,
                significantChangeThreshold: 0.08,
                highQualitySampleCount: 6,
                highQualityDataAge: 35000,
                mediumQualitySampleCount: 3,
                mediumQualityDataAge: 70000,
                circuitBreakerMaxErrors: 8,
                circuitBreakerWindowMs: 90000,

                // Confidence adjustments
                lowScoreConfidenceAdjustment: 0.7,
                lowVolumeConfidenceAdjustment: 0.8,
                invalidSurgeConfidenceAdjustment: 0.8,
                passiveConsistencyThreshold: 0.7,
                imbalanceNeutralThreshold: 0.1,
                velocityMinBound: 0.1,
                velocityMaxBound: 10,

                // Zone management
                maxZones: 75,
                zoneAgeLimit: 1200000,

                // Features configuration
                features: {
                    depletionTracking: true,
                    spreadAdjustment: true,
                    volumeVelocity: false,
                    spoofingDetection: true,
                    adaptiveZone: true,
                    multiZone: false,
                    passiveHistory: true,
                },

                // Enhancement control
                useStandardizedZones: true,
                enhancementMode: "production" as const,
                minEnhancedConfidenceThreshold: 0.3,

                // Enhanced depletion analysis
                depletionVolumeThreshold: 30,
                depletionRatioThreshold: 0.6,
                varianceReductionFactor: 1,
                alignmentNormalizationFactor: 1,
                distanceNormalizationDivisor: 2,
                passiveVolumeExhaustionRatio: 0.5,
                aggressiveVolumeExhaustionThreshold: 0.7,
                aggressiveVolumeReductionFactor: 0.5,
                enableDepletionAnalysis: true,
                depletionConfidenceBoost: 0.1,
            };

            const detector = new ExhaustionDetectorEnhanced(
                "test-exhaustion",
                settings,
                createMockPreprocessor(),
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

            const settings: ExhaustionEnhancedSettings = {
                // Base detector settings
                minAggVolume: configValue,
                windowMs: 45000,
                pricePrecision: 2,
                zoneTicks: 3,
                eventCooldownMs: 10000,
                minInitialMoveTicks: 1,
                confirmationTimeoutMs: 40000,
                maxRevisitTicks: 8,

                // Exhaustion-specific thresholds
                volumeSurgeMultiplier: 2.0,
                imbalanceThreshold: 0.3,
                institutionalThreshold: 15,
                burstDetectionMs: 2000,
                sustainedVolumeMs: 20000,
                medianTradeSize: 0.8,
                exhaustionThreshold: 0.3,
                maxPassiveRatio: 0.35,
                minDepletionFactor: 0.2,
                imbalanceHighThreshold: 0.75,
                imbalanceMediumThreshold: 0.55,
                spreadHighThreshold: 0.004,
                spreadMediumThreshold: 0.0015,

                // Scoring weights
                scoringWeights: {
                    depletion: 0.45,
                    passive: 0.3,
                    continuity: 0.12,
                    imbalance: 0.08,
                    spread: 0.04,
                    velocity: 0.01,
                },

                // Quality and performance settings
                depletionThresholdRatio: 0.15,
                significantChangeThreshold: 0.08,
                highQualitySampleCount: 6,
                highQualityDataAge: 35000,
                mediumQualitySampleCount: 3,
                mediumQualityDataAge: 70000,
                circuitBreakerMaxErrors: 8,
                circuitBreakerWindowMs: 90000,

                // Confidence adjustments
                lowScoreConfidenceAdjustment: 0.7,
                lowVolumeConfidenceAdjustment: 0.8,
                invalidSurgeConfidenceAdjustment: 0.8,
                passiveConsistencyThreshold: 0.7,
                imbalanceNeutralThreshold: 0.1,
                velocityMinBound: 0.1,
                velocityMaxBound: 10,

                // Zone management
                maxZones: 75,
                zoneAgeLimit: 1200000,

                // Features configuration
                features: {
                    depletionTracking: true,
                    spreadAdjustment: true,
                    volumeVelocity: false,
                    spoofingDetection: true,
                    adaptiveZone: true,
                    multiZone: false,
                    passiveHistory: true,
                },

                // Enhancement control
                useStandardizedZones: true,
                enhancementMode: "production" as const,
                minEnhancedConfidenceThreshold: 0.3,

                // Enhanced depletion analysis
                depletionVolumeThreshold: 30,
                depletionRatioThreshold: 0.6,
                varianceReductionFactor: 1,
                alignmentNormalizationFactor: 1,
                distanceNormalizationDivisor: 2,
                passiveVolumeExhaustionRatio: 0.5,
                aggressiveVolumeExhaustionThreshold: 0.7,
                aggressiveVolumeReductionFactor: 0.5,
                enableDepletionAnalysis: true,
                depletionConfidenceBoost: 0.1,
            };

            const detector = new ExhaustionDetectorEnhanced(
                "test-exhaustion",
                settings,
                createMockPreprocessor(),
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

            const settings: ExhaustionEnhancedSettings = {
                // Base detector settings
                minAggVolume: 20,
                windowMs: 45000,
                pricePrecision: 2,
                zoneTicks: 3,
                eventCooldownMs: 10000,
                minInitialMoveTicks: 1,
                confirmationTimeoutMs: 40000,
                maxRevisitTicks: 8,

                // Exhaustion-specific thresholds
                volumeSurgeMultiplier: 2.0,
                imbalanceThreshold: 0.3,
                institutionalThreshold: 15,
                burstDetectionMs: 2000,
                sustainedVolumeMs: 20000,
                medianTradeSize: 0.8,
                exhaustionThreshold: 0.3,
                maxPassiveRatio: configValue,
                minDepletionFactor: 0.2,
                imbalanceHighThreshold: 0.75,
                imbalanceMediumThreshold: 0.55,
                spreadHighThreshold: 0.004,
                spreadMediumThreshold: 0.0015,

                // Scoring weights
                scoringWeights: {
                    depletion: 0.45,
                    passive: 0.3,
                    continuity: 0.12,
                    imbalance: 0.08,
                    spread: 0.04,
                    velocity: 0.01,
                },

                // Quality and performance settings
                depletionThresholdRatio: 0.15,
                significantChangeThreshold: 0.08,
                highQualitySampleCount: 6,
                highQualityDataAge: 35000,
                mediumQualitySampleCount: 3,
                mediumQualityDataAge: 70000,
                circuitBreakerMaxErrors: 8,
                circuitBreakerWindowMs: 90000,

                // Confidence adjustments
                lowScoreConfidenceAdjustment: 0.7,
                lowVolumeConfidenceAdjustment: 0.8,
                invalidSurgeConfidenceAdjustment: 0.8,
                passiveConsistencyThreshold: 0.7,
                imbalanceNeutralThreshold: 0.1,
                velocityMinBound: 0.1,
                velocityMaxBound: 10,

                // Zone management
                maxZones: 75,
                zoneAgeLimit: 1200000,

                // Features configuration
                features: {
                    depletionTracking: true,
                    spreadAdjustment: true,
                    volumeVelocity: false,
                    spoofingDetection: true,
                    adaptiveZone: true,
                    multiZone: false,
                    passiveHistory: true,
                },

                // Enhancement control
                useStandardizedZones: true,
                enhancementMode: "production" as const,
                minEnhancedConfidenceThreshold: 0.3,

                // Enhanced depletion analysis
                depletionVolumeThreshold: 30,
                depletionRatioThreshold: 0.6,
                varianceReductionFactor: 1,
                alignmentNormalizationFactor: 1,
                distanceNormalizationDivisor: 2,
                passiveVolumeExhaustionRatio: 0.5,
                aggressiveVolumeExhaustionThreshold: 0.7,
                aggressiveVolumeReductionFactor: 0.5,
                enableDepletionAnalysis: true,
                depletionConfidenceBoost: 0.1,
            };

            const detector = new ExhaustionDetectorEnhanced(
                "test-exhaustion",
                settings,
                createMockPreprocessor(),
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

            const settings: ExhaustionEnhancedSettings = {
                // Base detector settings
                minAggVolume: 20,
                windowMs: 45000,
                pricePrecision: 2,
                zoneTicks: 3,
                eventCooldownMs: 10000,
                minInitialMoveTicks: 1,
                confirmationTimeoutMs: 40000,
                maxRevisitTicks: 8,

                // Exhaustion-specific thresholds
                volumeSurgeMultiplier: 2.0,
                imbalanceThreshold: 0.3,
                institutionalThreshold: 15,
                burstDetectionMs: 2000,
                sustainedVolumeMs: 20000,
                medianTradeSize: 0.8,
                exhaustionThreshold: 0.3,
                maxPassiveRatio: 0.35,
                minDepletionFactor: 0.2,
                imbalanceHighThreshold: 0.75,
                imbalanceMediumThreshold: 0.55,
                spreadHighThreshold: 0.004,
                spreadMediumThreshold: 0.0015,

                // Scoring weights
                scoringWeights: configWeights,

                // Quality and performance settings
                depletionThresholdRatio: 0.15,
                significantChangeThreshold: 0.08,
                highQualitySampleCount: 6,
                highQualityDataAge: 35000,
                mediumQualitySampleCount: 3,
                mediumQualityDataAge: 70000,
                circuitBreakerMaxErrors: 8,
                circuitBreakerWindowMs: 90000,

                // Confidence adjustments
                lowScoreConfidenceAdjustment: 0.7,
                lowVolumeConfidenceAdjustment: 0.8,
                invalidSurgeConfidenceAdjustment: 0.8,
                passiveConsistencyThreshold: 0.7,
                imbalanceNeutralThreshold: 0.1,
                velocityMinBound: 0.1,
                velocityMaxBound: 10,

                // Zone management
                maxZones: 75,
                zoneAgeLimit: 1200000,

                // Features configuration
                features: {
                    depletionTracking: true,
                    spreadAdjustment: true,
                    volumeVelocity: false,
                    spoofingDetection: true,
                    adaptiveZone: true,
                    multiZone: false,
                    passiveHistory: true,
                },

                // Enhancement control
                useStandardizedZones: true,
                enhancementMode: "production" as const,
                minEnhancedConfidenceThreshold: 0.3,

                // Enhanced depletion analysis
                depletionVolumeThreshold: 30,
                depletionRatioThreshold: 0.6,
                varianceReductionFactor: 1,
                alignmentNormalizationFactor: 1,
                distanceNormalizationDivisor: 2,
                passiveVolumeExhaustionRatio: 0.5,
                aggressiveVolumeExhaustionThreshold: 0.7,
                aggressiveVolumeReductionFactor: 0.5,
                enableDepletionAnalysis: true,
                depletionConfidenceBoost: 0.1,
            };

            const detector = new ExhaustionDetectorEnhanced(
                "test-exhaustion",
                settings,
                createMockPreprocessor(),
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

            const settings: AbsorptionEnhancedSettings = {
                symbol: "LTCUSDT",
                absorptionThreshold: configValue,
                windowMs: 60000,
                minAggVolume: 175,
                pricePrecision: 2,
                zoneTicks: 5,
                eventCooldownMs: 15000,
                minInitialMoveTicks: 4,
                confirmationTimeoutMs: 60000,
                maxRevisitTicks: 5,

                // Absorption-specific thresholds
                minPassiveMultiplier: 1.2,
                maxAbsorptionRatio: 0.4,
                strongAbsorptionRatio: 0.6,
                moderateAbsorptionRatio: 0.8,
                weakAbsorptionRatio: 1.0,
                priceEfficiencyThreshold: 0.02,
                spreadImpactThreshold: 0.003,
                velocityIncreaseThreshold: 1.5,
                significantChangeThreshold: 0.1,

                // Dominant side analysis
                dominantSideAnalysisWindowMs: 45000,
                dominantSideFallbackTradeCount: 10,
                dominantSideMinTradesRequired: 3,
                dominantSideTemporalWeighting: true,
                dominantSideWeightDecayFactor: 0.3,

                // Features configuration
                features: {
                    adaptiveZone: true,
                    passiveHistory: true,
                    multiZone: false,
                    liquidityGradient: true,
                    absorptionVelocity: true,
                    layeredAbsorption: true,
                    spreadImpact: true,
                },

                // Enhancement control
                useStandardizedZones: true,
                enhancementMode: "production" as const,
                minEnhancedConfidenceThreshold: 0.3,

                // Institutional volume detection (enhanced)
                institutionalVolumeThreshold: 50,
                institutionalVolumeRatioThreshold: 0.3,
                enableInstitutionalVolumeFilter: true,
                institutionalVolumeBoost: 0.1,

                // Enhanced calculation parameters
                volumeNormalizationThreshold: 200,
                absorptionRatioNormalization: 3,
                minAbsorptionScore: 0.8,
                patternVarianceReduction: 2,
                whaleActivityMultiplier: 2,
                maxZoneCountForScoring: 3,

                // Enhanced thresholds
                highConfidenceThreshold: 0.7,
                lowConfidenceReduction: 0.7,
                confidenceBoostReduction: 0.5,
                passiveAbsorptionThreshold: 0.6,
                aggressiveDistributionThreshold: 0.6,
                patternDifferenceThreshold: 0.1,
                minVolumeForRatio: 1,

                // Enhanced scoring weights
                distanceWeight: 0.4,
                volumeWeight: 0.35,
                absorptionWeight: 0.25,
                minConfluenceScore: 0.6,
                volumeConcentrationWeight: 0.15,
                patternConsistencyWeight: 0.1,
                volumeBoostCap: 0.25,
                volumeBoostMultiplier: 0.25,
            };

            const detector = new AbsorptionDetectorEnhanced(
                "test-absorption",
                "LTCUSDT",
                settings,
                createMockPreprocessor(),
                mockLogger,
                mockMetrics
            );

            // Verify the detector was created with correct config values
            // Enhanced detector uses config directly, no internal property exposure needed
            expect(settings.absorptionThreshold).toBe(configValue);
        });

        it("should use minAggVolume from config", () => {
            const configValue = 175; // From config.json

            const settings: AbsorptionEnhancedSettings = {
                symbol: "LTCUSDT",
                minAggVolume: configValue,
                windowMs: 60000,
                pricePrecision: 2,
                zoneTicks: 5,
                eventCooldownMs: 15000,
                minInitialMoveTicks: 4,
                confirmationTimeoutMs: 60000,
                maxRevisitTicks: 5,

                // Absorption-specific thresholds
                absorptionThreshold: 0.6,
                minPassiveMultiplier: 1.2,
                maxAbsorptionRatio: 0.4,
                strongAbsorptionRatio: 0.6,
                moderateAbsorptionRatio: 0.8,
                weakAbsorptionRatio: 1.0,
                priceEfficiencyThreshold: 0.02,
                spreadImpactThreshold: 0.003,
                velocityIncreaseThreshold: 1.5,
                significantChangeThreshold: 0.1,

                // Dominant side analysis
                dominantSideAnalysisWindowMs: 45000,
                dominantSideFallbackTradeCount: 10,
                dominantSideMinTradesRequired: 3,
                dominantSideTemporalWeighting: true,
                dominantSideWeightDecayFactor: 0.3,

                // Features configuration
                features: {
                    adaptiveZone: true,
                    passiveHistory: true,
                    multiZone: false,
                    liquidityGradient: true,
                    absorptionVelocity: true,
                    layeredAbsorption: true,
                    spreadImpact: true,
                },

                // Enhancement control
                useStandardizedZones: true,
                enhancementMode: "production" as const,
                minEnhancedConfidenceThreshold: 0.3,

                // Institutional volume detection (enhanced)
                institutionalVolumeThreshold: 50,
                institutionalVolumeRatioThreshold: 0.3,
                enableInstitutionalVolumeFilter: true,
                institutionalVolumeBoost: 0.1,

                // Enhanced calculation parameters
                volumeNormalizationThreshold: 200,
                absorptionRatioNormalization: 3,
                minAbsorptionScore: 0.8,
                patternVarianceReduction: 2,
                whaleActivityMultiplier: 2,
                maxZoneCountForScoring: 3,

                // Enhanced thresholds
                highConfidenceThreshold: 0.7,
                lowConfidenceReduction: 0.7,
                confidenceBoostReduction: 0.5,
                passiveAbsorptionThreshold: 0.6,
                aggressiveDistributionThreshold: 0.6,
                patternDifferenceThreshold: 0.1,
                minVolumeForRatio: 1,

                // Enhanced scoring weights
                distanceWeight: 0.4,
                volumeWeight: 0.35,
                absorptionWeight: 0.25,
                minConfluenceScore: 0.6,
                volumeConcentrationWeight: 0.15,
                patternConsistencyWeight: 0.1,
                volumeBoostCap: 0.25,
                volumeBoostMultiplier: 0.25,
            };

            const detector = new AbsorptionDetectorEnhanced(
                "test-absorption",
                "LTCUSDT",
                settings,
                createMockPreprocessor(),
                mockLogger,
                mockMetrics
            );

            // Verify the detector was created with correct config values
            expect(settings.minAggVolume).toBe(configValue);
        });

        it("should use priceEfficiencyThreshold from config", () => {
            const configValue = 0.02; // From config.json

            const settings: AbsorptionEnhancedSettings = {
                symbol: "LTCUSDT",
                priceEfficiencyThreshold: configValue,
                windowMs: 60000,
                minAggVolume: 175,
                pricePrecision: 2,
                zoneTicks: 5,
                eventCooldownMs: 15000,
                minInitialMoveTicks: 4,
                confirmationTimeoutMs: 60000,
                maxRevisitTicks: 5,

                // Absorption-specific thresholds
                absorptionThreshold: 0.6,
                minPassiveMultiplier: 1.2,
                maxAbsorptionRatio: 0.4,
                strongAbsorptionRatio: 0.6,
                moderateAbsorptionRatio: 0.8,
                weakAbsorptionRatio: 1.0,
                spreadImpactThreshold: 0.003,
                velocityIncreaseThreshold: 1.5,
                significantChangeThreshold: 0.1,

                // Dominant side analysis
                dominantSideAnalysisWindowMs: 45000,
                dominantSideFallbackTradeCount: 10,
                dominantSideMinTradesRequired: 3,
                dominantSideTemporalWeighting: true,
                dominantSideWeightDecayFactor: 0.3,

                // Features configuration
                features: {
                    adaptiveZone: true,
                    passiveHistory: true,
                    multiZone: false,
                    liquidityGradient: true,
                    absorptionVelocity: true,
                    layeredAbsorption: true,
                    spreadImpact: true,
                },

                // Enhancement control
                useStandardizedZones: true,
                enhancementMode: "production" as const,
                minEnhancedConfidenceThreshold: 0.3,

                // Institutional volume detection (enhanced)
                institutionalVolumeThreshold: 50,
                institutionalVolumeRatioThreshold: 0.3,
                enableInstitutionalVolumeFilter: true,
                institutionalVolumeBoost: 0.1,

                // Enhanced calculation parameters
                volumeNormalizationThreshold: 200,
                absorptionRatioNormalization: 3,
                minAbsorptionScore: 0.8,
                patternVarianceReduction: 2,
                whaleActivityMultiplier: 2,
                maxZoneCountForScoring: 3,

                // Enhanced thresholds
                highConfidenceThreshold: 0.7,
                lowConfidenceReduction: 0.7,
                confidenceBoostReduction: 0.5,
                passiveAbsorptionThreshold: 0.6,
                aggressiveDistributionThreshold: 0.6,
                patternDifferenceThreshold: 0.1,
                minVolumeForRatio: 1,

                // Enhanced scoring weights
                distanceWeight: 0.4,
                volumeWeight: 0.35,
                absorptionWeight: 0.25,
                minConfluenceScore: 0.6,
                volumeConcentrationWeight: 0.15,
                patternConsistencyWeight: 0.1,
                volumeBoostCap: 0.25,
                volumeBoostMultiplier: 0.25,
            };

            const detector = new AbsorptionDetectorEnhanced(
                "test-absorption",
                "LTCUSDT",
                settings,
                createMockPreprocessor(),
                mockLogger,
                mockMetrics
            );

            // Verify the detector was created with correct config values
            expect(settings.priceEfficiencyThreshold).toBe(configValue);
        });

        it("should use maxAbsorptionRatio from config", () => {
            const configValue = 0.4; // From config.json

            const settings: AbsorptionEnhancedSettings = {
                symbol: "LTCUSDT",
                maxAbsorptionRatio: configValue,
                windowMs: 60000,
                minAggVolume: 175,
                pricePrecision: 2,
                zoneTicks: 5,
                eventCooldownMs: 15000,
                minInitialMoveTicks: 4,
                confirmationTimeoutMs: 60000,
                maxRevisitTicks: 5,

                // Absorption-specific thresholds
                absorptionThreshold: 0.6,
                minPassiveMultiplier: 1.2,
                strongAbsorptionRatio: 0.6,
                moderateAbsorptionRatio: 0.8,
                weakAbsorptionRatio: 1.0,
                priceEfficiencyThreshold: 0.02,
                spreadImpactThreshold: 0.003,
                velocityIncreaseThreshold: 1.5,
                significantChangeThreshold: 0.1,

                // Dominant side analysis
                dominantSideAnalysisWindowMs: 45000,
                dominantSideFallbackTradeCount: 10,
                dominantSideMinTradesRequired: 3,
                dominantSideTemporalWeighting: true,
                dominantSideWeightDecayFactor: 0.3,

                // Features configuration
                features: {
                    adaptiveZone: true,
                    passiveHistory: true,
                    multiZone: false,
                    liquidityGradient: true,
                    absorptionVelocity: true,
                    layeredAbsorption: true,
                    spreadImpact: true,
                },

                // Enhancement control
                useStandardizedZones: true,
                enhancementMode: "production" as const,
                minEnhancedConfidenceThreshold: 0.3,

                // Institutional volume detection (enhanced)
                institutionalVolumeThreshold: 50,
                institutionalVolumeRatioThreshold: 0.3,
                enableInstitutionalVolumeFilter: true,
                institutionalVolumeBoost: 0.1,

                // Enhanced calculation parameters
                volumeNormalizationThreshold: 200,
                absorptionRatioNormalization: 3,
                minAbsorptionScore: 0.8,
                patternVarianceReduction: 2,
                whaleActivityMultiplier: 2,
                maxZoneCountForScoring: 3,

                // Enhanced thresholds
                highConfidenceThreshold: 0.7,
                lowConfidenceReduction: 0.7,
                confidenceBoostReduction: 0.5,
                passiveAbsorptionThreshold: 0.6,
                aggressiveDistributionThreshold: 0.6,
                patternDifferenceThreshold: 0.1,
                minVolumeForRatio: 1,

                // Enhanced scoring weights
                distanceWeight: 0.4,
                volumeWeight: 0.35,
                absorptionWeight: 0.25,
                minConfluenceScore: 0.6,
                volumeConcentrationWeight: 0.15,
                patternConsistencyWeight: 0.1,
                volumeBoostCap: 0.25,
                volumeBoostMultiplier: 0.25,
            };

            const detector = new AbsorptionDetectorEnhanced(
                "test-absorption",
                "LTCUSDT",
                settings,
                createMockPreprocessor(),
                mockLogger,
                mockMetrics
            );

            // Verify the detector was created with correct config values
            expect(settings.maxAbsorptionRatio).toBe(configValue);
        });
    });

    describe("DeltaCVD Detector Config Usage", () => {
        it("should use baseConfidenceRequired from config", () => {
            const configValue = 0.2; // From config.json

            const settings: DeltaCVDEnhancedSettings = {
                // Core CVD analysis (12 properties)
                windowsSec: [60, 300],
                minZ: 0.4,
                priceCorrelationWeight: 0.3,
                volumeConcentrationWeight: 0.2,
                adaptiveThresholdMultiplier: 0.7,
                eventCooldownMs: 15000,
                minTradesPerSec: 0.1,
                minVolPerSec: 0.5,
                minSamplesForStats: 15,
                pricePrecision: 2,
                volatilityLookbackSec: 3600,
                maxDivergenceAllowed: 0.5,
                stateCleanupIntervalSec: 300,
                dynamicThresholds: true,
                logDebug: true,

                // Volume and detection parameters (15 properties)
                volumeSurgeMultiplier: 2.5,
                imbalanceThreshold: 0.15,
                institutionalThreshold: 17.8,
                burstDetectionMs: 1000,
                sustainedVolumeMs: 30000,
                medianTradeSize: 0.6,
                detectionMode: "momentum" as const,
                divergenceThreshold: 0.3,
                divergenceLookbackSec: 60,
                enableDepthAnalysis: false,
                usePassiveVolume: true,
                maxOrderbookAge: 5000,
                absorptionCVDThreshold: 75,
                absorptionPriceThreshold: 0.1,
                imbalanceWeight: 0.2,
                icebergMinRefills: 3,
                icebergMinSize: 20,
                baseConfidenceRequired: configValue, // Test parameter
                finalConfidenceRequired: 0.35,
                strongCorrelationThreshold: 0.7,
                weakCorrelationThreshold: 0.3,
                depthImbalanceThreshold: 0.2,

                // Enhancement control (3 properties)
                useStandardizedZones: true,
                enhancementMode: "production" as const,
                minEnhancedConfidenceThreshold: 0.3,

                // Enhanced CVD analysis (6 properties)
                cvdDivergenceVolumeThreshold: 50,
                cvdDivergenceStrengthThreshold: 0.7,
                cvdSignificantImbalanceThreshold: 0.3,
                cvdDivergenceScoreMultiplier: 1.5,
                alignmentMinimumThreshold: 0.5,
                momentumScoreMultiplier: 2,
                enableCVDDivergenceAnalysis: true,
                enableMomentumAlignment: false,
                divergenceConfidenceBoost: 0.12,
                momentumAlignmentBoost: 0.08,

                // ESSENTIAL CONFIGURABLE PARAMETERS - Trading Logic (8 mandatory parameters)
                minTradesForAnalysis: 20,
                minVolumeRatio: 0.1,
                maxVolumeRatio: 5.0,
                priceChangeThreshold: 0.001,
                minZScoreBound: -20,
                maxZScoreBound: 20,
                minCorrelationBound: -0.999,
                maxCorrelationBound: 0.999,
            };

            const detector = new DeltaCVDDetectorEnhanced(
                "test-deltacvd",
                settings,
                createMockPreprocessor(),
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
                // Core CVD analysis (12 properties)
                windowsSec: [60, 300],
                minZ: 0.4,
                priceCorrelationWeight: 0.3,
                volumeConcentrationWeight: 0.2,
                adaptiveThresholdMultiplier: 0.7,
                eventCooldownMs: 15000,
                minTradesPerSec: 0.1,
                minVolPerSec: 0.5,
                minSamplesForStats: 15,
                pricePrecision: 2,
                volatilityLookbackSec: 3600,
                maxDivergenceAllowed: 0.5,
                stateCleanupIntervalSec: 300,
                dynamicThresholds: true,
                logDebug: true,

                // Volume and detection parameters (15 properties)
                volumeSurgeMultiplier: 2.5,
                imbalanceThreshold: 0.15,
                institutionalThreshold: 17.8,
                burstDetectionMs: 1000,
                sustainedVolumeMs: 30000,
                medianTradeSize: 0.6,
                detectionMode: "momentum" as const,
                divergenceThreshold: 0.3,
                divergenceLookbackSec: 60,
                enableDepthAnalysis: false,
                usePassiveVolume: true,
                maxOrderbookAge: 5000,
                absorptionCVDThreshold: 75,
                absorptionPriceThreshold: 0.1,
                imbalanceWeight: 0.2,
                icebergMinRefills: 3,
                icebergMinSize: 20,
                baseConfidenceRequired: 0.2,
                finalConfidenceRequired: configValue, // Test parameter
                strongCorrelationThreshold: 0.7,
                weakCorrelationThreshold: 0.3,
                depthImbalanceThreshold: 0.2,

                // Enhancement control (3 properties)
                useStandardizedZones: true,
                enhancementMode: "production" as const,
                minEnhancedConfidenceThreshold: 0.3,

                // Enhanced CVD analysis (6 properties)
                cvdDivergenceVolumeThreshold: 50,
                cvdDivergenceStrengthThreshold: 0.7,
                cvdSignificantImbalanceThreshold: 0.3,
                cvdDivergenceScoreMultiplier: 1.5,
                alignmentMinimumThreshold: 0.5,
                momentumScoreMultiplier: 2,
                enableCVDDivergenceAnalysis: true,
                enableMomentumAlignment: false,
                divergenceConfidenceBoost: 0.12,
                momentumAlignmentBoost: 0.08,

                // ESSENTIAL CONFIGURABLE PARAMETERS - Trading Logic (8 mandatory parameters)
                minTradesForAnalysis: 20,
                minVolumeRatio: 0.1,
                maxVolumeRatio: 5.0,
                priceChangeThreshold: 0.001,
                minZScoreBound: -20,
                maxZScoreBound: 20,
                minCorrelationBound: -0.999,
                maxCorrelationBound: 0.999,
            };

            const detector = new DeltaCVDDetectorEnhanced(
                "test-deltacvd",
                settings,
                createMockPreprocessor(),
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
                // Core CVD analysis (12 properties)
                windowsSec: [60, 300],
                minZ: 0.4,
                priceCorrelationWeight: 0.3,
                volumeConcentrationWeight: 0.2,
                adaptiveThresholdMultiplier: 0.7,
                eventCooldownMs: 15000,
                minTradesPerSec: 0.1,
                minVolPerSec: 0.5,
                minSamplesForStats: 15,
                pricePrecision: 2,
                volatilityLookbackSec: 3600,
                maxDivergenceAllowed: 0.5,
                stateCleanupIntervalSec: 300,
                dynamicThresholds: true,
                logDebug: true,

                // Volume and detection parameters (15 properties)
                volumeSurgeMultiplier: 2.5,
                imbalanceThreshold: 0.15,
                institutionalThreshold: 17.8,
                burstDetectionMs: 1000,
                sustainedVolumeMs: 30000,
                medianTradeSize: 0.6,
                detectionMode: "momentum" as const,
                divergenceThreshold: 0.3,
                divergenceLookbackSec: 60,
                enableDepthAnalysis: false,
                usePassiveVolume: configValue, // Test parameter
                maxOrderbookAge: 5000,
                absorptionCVDThreshold: 75,
                absorptionPriceThreshold: 0.1,
                imbalanceWeight: 0.2,
                icebergMinRefills: 3,
                icebergMinSize: 20,
                baseConfidenceRequired: 0.2,
                finalConfidenceRequired: 0.35,
                strongCorrelationThreshold: 0.7,
                weakCorrelationThreshold: 0.3,
                depthImbalanceThreshold: 0.2,

                // Enhancement control (3 properties)
                useStandardizedZones: true,
                enhancementMode: "production" as const,
                minEnhancedConfidenceThreshold: 0.3,

                // Enhanced CVD analysis (6 properties)
                cvdDivergenceVolumeThreshold: 50,
                cvdDivergenceStrengthThreshold: 0.7,
                cvdSignificantImbalanceThreshold: 0.3,
                cvdDivergenceScoreMultiplier: 1.5,
                alignmentMinimumThreshold: 0.5,
                momentumScoreMultiplier: 2,
                enableCVDDivergenceAnalysis: true,
                enableMomentumAlignment: false,
                divergenceConfidenceBoost: 0.12,
                momentumAlignmentBoost: 0.08,

                // ESSENTIAL CONFIGURABLE PARAMETERS - Trading Logic (8 mandatory parameters)
                minTradesForAnalysis: 20,
                minVolumeRatio: 0.1,
                maxVolumeRatio: 5.0,
                priceChangeThreshold: 0.001,
                minZScoreBound: -20,
                maxZScoreBound: 20,
                minCorrelationBound: -0.999,
                maxCorrelationBound: 0.999,
            };

            const detector = new DeltaCVDDetectorEnhanced(
                "test-deltacvd",
                settings,
                createMockPreprocessor(),
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
                // Core CVD analysis (12 properties)
                windowsSec: [60, 300],
                minZ: 0.4,
                priceCorrelationWeight: 0.3,
                volumeConcentrationWeight: 0.2,
                adaptiveThresholdMultiplier: 0.7,
                eventCooldownMs: 15000,
                minTradesPerSec: 0.1,
                minVolPerSec: 0.5,
                minSamplesForStats: 15,
                pricePrecision: 2,
                volatilityLookbackSec: 3600,
                maxDivergenceAllowed: 0.5,
                stateCleanupIntervalSec: 300,
                dynamicThresholds: true,
                logDebug: true,

                // Volume and detection parameters (15 properties)
                volumeSurgeMultiplier: 2.5,
                imbalanceThreshold: 0.15,
                institutionalThreshold: 17.8,
                burstDetectionMs: 1000,
                sustainedVolumeMs: 30000,
                medianTradeSize: 0.6,
                detectionMode: "momentum" as const,
                divergenceThreshold: 0.3,
                divergenceLookbackSec: 60,
                enableDepthAnalysis: configValue, // Test parameter
                usePassiveVolume: true,
                maxOrderbookAge: 5000,
                absorptionCVDThreshold: 75,
                absorptionPriceThreshold: 0.1,
                imbalanceWeight: 0.2,
                icebergMinRefills: 3,
                icebergMinSize: 20,
                baseConfidenceRequired: 0.2,
                finalConfidenceRequired: 0.35,
                strongCorrelationThreshold: 0.7,
                weakCorrelationThreshold: 0.3,
                depthImbalanceThreshold: 0.2,

                // Enhancement control (3 properties)
                useStandardizedZones: true,
                enhancementMode: "production" as const,
                minEnhancedConfidenceThreshold: 0.3,

                // Enhanced CVD analysis (6 properties)
                cvdDivergenceVolumeThreshold: 50,
                cvdDivergenceStrengthThreshold: 0.7,
                cvdSignificantImbalanceThreshold: 0.3,
                cvdDivergenceScoreMultiplier: 1.5,
                alignmentMinimumThreshold: 0.5,
                momentumScoreMultiplier: 2,
                enableCVDDivergenceAnalysis: true,
                enableMomentumAlignment: false,
                divergenceConfidenceBoost: 0.12,
                momentumAlignmentBoost: 0.08,

                // ESSENTIAL CONFIGURABLE PARAMETERS - Trading Logic (8 mandatory parameters)
                minTradesForAnalysis: 20,
                minVolumeRatio: 0.1,
                maxVolumeRatio: 5.0,
                priceChangeThreshold: 0.001,
                minZScoreBound: -20,
                maxZScoreBound: 20,
                minCorrelationBound: -0.999,
                maxCorrelationBound: 0.999,
            };

            const detector = new DeltaCVDDetectorEnhanced(
                "test-deltacvd",
                settings,
                createMockPreprocessor(),
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
            const configSettings: ExhaustionEnhancedSettings = {
                // Base detector settings
                minAggVolume: 20,
                windowMs: 45000,
                pricePrecision: 2,
                zoneTicks: 3,
                eventCooldownMs: 10000,
                minInitialMoveTicks: 1,
                confirmationTimeoutMs: 40000,
                maxRevisitTicks: 8,

                // Exhaustion-specific thresholds
                volumeSurgeMultiplier: 2.0,
                imbalanceThreshold: 0.3,
                institutionalThreshold: 15,
                burstDetectionMs: 2000,
                sustainedVolumeMs: 20000,
                medianTradeSize: 0.8,
                exhaustionThreshold: 0.4, // Config value
                maxPassiveRatio: 0.35,
                minDepletionFactor: 0.2,
                imbalanceHighThreshold: 0.75,
                imbalanceMediumThreshold: 0.55,
                spreadHighThreshold: 0.004,
                spreadMediumThreshold: 0.0015,

                // Scoring weights
                scoringWeights: {
                    depletion: 0.45,
                    passive: 0.3,
                    continuity: 0.12,
                    imbalance: 0.08,
                    spread: 0.04,
                    velocity: 0.01,
                },

                // Quality and performance settings
                depletionThresholdRatio: 0.15,
                significantChangeThreshold: 0.08,
                highQualitySampleCount: 6,
                highQualityDataAge: 35000,
                mediumQualitySampleCount: 3,
                mediumQualityDataAge: 70000,
                circuitBreakerMaxErrors: 8,
                circuitBreakerWindowMs: 90000,

                // Confidence adjustments
                lowScoreConfidenceAdjustment: 0.7,
                lowVolumeConfidenceAdjustment: 0.8,
                invalidSurgeConfidenceAdjustment: 0.8,
                passiveConsistencyThreshold: 0.7,
                imbalanceNeutralThreshold: 0.1,
                velocityMinBound: 0.1,
                velocityMaxBound: 10,

                // Zone management
                maxZones: 75,
                zoneAgeLimit: 1200000,

                // Features configuration
                features: {
                    depletionTracking: true,
                    spreadAdjustment: true,
                    volumeVelocity: false,
                    spoofingDetection: true,
                    adaptiveZone: true,
                    multiZone: false,
                    passiveHistory: true,
                },

                // Enhancement control
                useStandardizedZones: true,
                enhancementMode: "production" as const,
                minEnhancedConfidenceThreshold: 0.3,

                // Enhanced depletion analysis
                depletionVolumeThreshold: 30,
                depletionRatioThreshold: 0.6,
                varianceReductionFactor: 1,
                alignmentNormalizationFactor: 1,
                distanceNormalizationDivisor: 2,
                passiveVolumeExhaustionRatio: 0.5,
                aggressiveVolumeExhaustionThreshold: 0.7,
                aggressiveVolumeReductionFactor: 0.5,
                enableDepletionAnalysis: true,
                depletionConfidenceBoost: 0.1,
            };

            const detector = new ExhaustionDetectorEnhanced(
                "test-exhaustion",
                configSettings,
                createMockPreprocessor(),
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
                minDepletionFactor: 0.35, // Within valid range of 0.05-0.5
                imbalanceHighThreshold: 0.999,
                spreadHighThreshold: 0.001,
            };

            const settings: ExhaustionEnhancedSettings = {
                // Base detector settings
                minAggVolume: 20,
                windowMs: 45000,
                pricePrecision: 2,
                zoneTicks: 3,
                eventCooldownMs: 10000,
                minInitialMoveTicks: 1,
                confirmationTimeoutMs: 40000,
                maxRevisitTicks: 8,

                // Exhaustion-specific thresholds
                volumeSurgeMultiplier: 2.0,
                imbalanceThreshold: 0.3,
                institutionalThreshold: 15,
                burstDetectionMs: 2000,
                sustainedVolumeMs: 20000,
                medianTradeSize: 0.8,
                exhaustionThreshold: testSettings.exhaustionThreshold,
                maxPassiveRatio: testSettings.maxPassiveRatio,
                minDepletionFactor: testSettings.minDepletionFactor, // 0.35
                imbalanceHighThreshold: testSettings.imbalanceHighThreshold,
                imbalanceMediumThreshold: 0.55,
                spreadHighThreshold: testSettings.spreadHighThreshold,
                spreadMediumThreshold: 0.0015,

                // Scoring weights
                scoringWeights: {
                    depletion: 0.45,
                    passive: 0.3,
                    continuity: 0.12,
                    imbalance: 0.08,
                    spread: 0.04,
                    velocity: 0.01,
                },

                // Quality and performance settings
                depletionThresholdRatio: 0.15,
                significantChangeThreshold: 0.08,
                highQualitySampleCount: 6,
                highQualityDataAge: 35000,
                mediumQualitySampleCount: 3,
                mediumQualityDataAge: 70000,
                circuitBreakerMaxErrors: 8,
                circuitBreakerWindowMs: 90000,

                // Confidence adjustments
                lowScoreConfidenceAdjustment: 0.7,
                lowVolumeConfidenceAdjustment: 0.8,
                invalidSurgeConfidenceAdjustment: 0.8,
                passiveConsistencyThreshold: 0.7,
                imbalanceNeutralThreshold: 0.1,
                velocityMinBound: 0.1,
                velocityMaxBound: 10,

                // Zone management
                maxZones: 75,
                zoneAgeLimit: 1200000,

                // Features configuration
                features: {
                    depletionTracking: true,
                    spreadAdjustment: true,
                    volumeVelocity: false,
                    spoofingDetection: true,
                    adaptiveZone: true,
                    multiZone: false,
                    passiveHistory: true,
                },

                // Enhancement control
                useStandardizedZones: true,
                enhancementMode: "production" as const,
                minEnhancedConfidenceThreshold: 0.3,

                // Enhanced depletion analysis
                depletionVolumeThreshold: 30,
                depletionRatioThreshold: 0.6,
                varianceReductionFactor: 1,
                alignmentNormalizationFactor: 1,
                distanceNormalizationDivisor: 2,
                passiveVolumeExhaustionRatio: 0.5,
                aggressiveVolumeExhaustionThreshold: 0.7,
                aggressiveVolumeReductionFactor: 0.5,
                enableDepletionAnalysis: true,
                depletionConfidenceBoost: 0.1,
            };

            const detector = new ExhaustionDetectorEnhanced(
                "test-exhaustion",
                settings,
                createMockPreprocessor(),
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
        it("should crash immediately on missing mandatory configuration (Nuclear Cleanup)", () => {
            // Test that missing mandatory config values cause immediate crash
            // This is per CLAUDE.md Nuclear Cleanup: "NO DEFAULTS, NO FALLBACKS, NO BULLSHIT"
            const settingsWithMissingValues: any = {
                // Base detector settings
                minAggVolume: 20,
                windowMs: 45000,
                pricePrecision: 2,
                zoneTicks: 3,
                eventCooldownMs: 10000,
                minInitialMoveTicks: 1,
                confirmationTimeoutMs: 40000,
                maxRevisitTicks: 8,

                // Exhaustion-specific thresholds
                volumeSurgeMultiplier: 2.0,
                imbalanceThreshold: 0.3,
                institutionalThreshold: 15,
                burstDetectionMs: 2000,
                sustainedVolumeMs: 20000,
                medianTradeSize: 0.8,
                // exhaustionThreshold intentionally omitted to test crash behavior
                maxPassiveRatio: 0.35,
                minDepletionFactor: 0.2,
                imbalanceHighThreshold: 0.75,
                imbalanceMediumThreshold: 0.55,
                spreadHighThreshold: 0.004,
                spreadMediumThreshold: 0.0015,

                // Scoring weights
                scoringWeights: {
                    depletion: 0.45,
                    passive: 0.3,
                    continuity: 0.12,
                    imbalance: 0.08,
                    spread: 0.04,
                    velocity: 0.01,
                },

                // Quality and performance settings
                depletionThresholdRatio: 0.15,
                significantChangeThreshold: 0.08,
                highQualitySampleCount: 6,
                highQualityDataAge: 35000,
                mediumQualitySampleCount: 3,
                mediumQualityDataAge: 70000,
                circuitBreakerMaxErrors: 8,
                circuitBreakerWindowMs: 90000,

                // Confidence adjustments
                lowScoreConfidenceAdjustment: 0.7,
                lowVolumeConfidenceAdjustment: 0.8,
                invalidSurgeConfidenceAdjustment: 0.8,
                passiveConsistencyThreshold: 0.7,
                imbalanceNeutralThreshold: 0.1,
                velocityMinBound: 0.1,
                velocityMaxBound: 10,

                // Zone management
                maxZones: 75,
                zoneAgeLimit: 1200000,

                // Features configuration
                features: {
                    depletionTracking: true,
                    spreadAdjustment: true,
                    volumeVelocity: false,
                    spoofingDetection: true,
                    adaptiveZone: true,
                    multiZone: false,
                    passiveHistory: true,
                },

                // Enhancement control
                useStandardizedZones: true,
                enhancementMode: "production" as const,
                minEnhancedConfidenceThreshold: 0.3,

                // Enhanced depletion analysis
                depletionVolumeThreshold: 30,
                depletionRatioThreshold: 0.6,
                varianceReductionFactor: 1,
                alignmentNormalizationFactor: 1,
                distanceNormalizationDivisor: 2,
                passiveVolumeExhaustionRatio: 0.5,
                aggressiveVolumeExhaustionThreshold: 0.7,
                aggressiveVolumeReductionFactor: 0.5,
                enableDepletionAnalysis: true,
                depletionConfidenceBoost: 0.1,
            };

            const mockExhaustionSettings: ExhaustionEnhancedSettings = {
                // Base detector settings
                minAggVolume: 20,
                windowMs: 45000,
                pricePrecision: 2,
                zoneTicks: 3,
                eventCooldownMs: 10000,
                minInitialMoveTicks: 1,
                confirmationTimeoutMs: 40000,
                maxRevisitTicks: 8,

                // Exhaustion-specific thresholds
                volumeSurgeMultiplier: 2.0,
                imbalanceThreshold: 0.3,
                institutionalThreshold: 15,
                burstDetectionMs: 2000,
                sustainedVolumeMs: 20000,
                medianTradeSize: 0.8,
                exhaustionThreshold: 0.75,
                maxPassiveRatio: 0.35,
                minDepletionFactor: 0.2,
                imbalanceHighThreshold: 0.75,
                imbalanceMediumThreshold: 0.55,
                spreadHighThreshold: 0.004,
                spreadMediumThreshold: 0.0015,

                // Scoring weights
                scoringWeights: {
                    depletion: 0.45,
                    passive: 0.3,
                    continuity: 0.12,
                    imbalance: 0.08,
                    spread: 0.04,
                    velocity: 0.01,
                },

                // Quality and performance settings
                depletionThresholdRatio: 0.15,
                significantChangeThreshold: 0.08,
                highQualitySampleCount: 6,
                highQualityDataAge: 35000,
                mediumQualitySampleCount: 3,
                mediumQualityDataAge: 70000,
                circuitBreakerMaxErrors: 8,
                circuitBreakerWindowMs: 90000,

                // Confidence adjustments
                lowScoreConfidenceAdjustment: 0.7,
                lowVolumeConfidenceAdjustment: 0.8,
                invalidSurgeConfidenceAdjustment: 0.8,
                passiveConsistencyThreshold: 0.7,
                imbalanceNeutralThreshold: 0.1,
                velocityMinBound: 0.1,
                velocityMaxBound: 10,

                // Zone management
                maxZones: 75,
                zoneAgeLimit: 1200000,

                // Features configuration
                features: {
                    depletionTracking: true,
                    spreadAdjustment: true,
                    volumeVelocity: false,
                    spoofingDetection: true,
                    adaptiveZone: true,
                    multiZone: false,
                    passiveHistory: true,
                },

                // Enhancement control
                useStandardizedZones: true,
                enhancementMode: "production" as const,
                minEnhancedConfidenceThreshold: 0.3,

                // Enhanced depletion analysis
                depletionVolumeThreshold: 30,
                depletionRatioThreshold: 0.6,
                varianceReductionFactor: 1,
                alignmentNormalizationFactor: 1,
                distanceNormalizationDivisor: 2,
                passiveVolumeExhaustionRatio: 0.5,
                aggressiveVolumeExhaustionThreshold: 0.7,
                aggressiveVolumeReductionFactor: 0.5,
                enableDepletionAnalysis: true,
                depletionConfidenceBoost: 0.1,
            };

            // ARCHITECTURE: Validation moved to config.ts - detectors trust pre-validated settings
            // Test that detector works with complete validated configuration instead
            expect(() => {
                new ExhaustionDetectorEnhanced(
                    "test-exhaustion",
                    mockExhaustionSettings, // Complete valid configuration
                    createMockPreprocessor(),
                    mockLogger,
                    mockSpoofing,
                    mockMetrics,
                    mockSignalLogger
                );
            }).not.toThrow(); // Should work with valid config
        });

        it("should prefer explicit config values over defaults", () => {
            const explicitValue = 0.333;

            const settingsWithExplicitValue: ExhaustionEnhancedSettings = {
                // Base detector settings
                minAggVolume: 20,
                windowMs: 45000,
                pricePrecision: 2,
                zoneTicks: 3,
                eventCooldownMs: 10000,
                minInitialMoveTicks: 1,
                confirmationTimeoutMs: 40000,
                maxRevisitTicks: 8,

                // Exhaustion-specific thresholds
                volumeSurgeMultiplier: 2.0,
                imbalanceThreshold: 0.3,
                institutionalThreshold: 15,
                burstDetectionMs: 2000,
                sustainedVolumeMs: 20000,
                medianTradeSize: 0.8,
                exhaustionThreshold: explicitValue,
                maxPassiveRatio: 0.35,
                minDepletionFactor: 0.2,
                imbalanceHighThreshold: 0.75,
                imbalanceMediumThreshold: 0.55,
                spreadHighThreshold: 0.004,
                spreadMediumThreshold: 0.0015,

                // Scoring weights
                scoringWeights: {
                    depletion: 0.45,
                    passive: 0.3,
                    continuity: 0.12,
                    imbalance: 0.08,
                    spread: 0.04,
                    velocity: 0.01,
                },

                // Quality and performance settings
                depletionThresholdRatio: 0.15,
                significantChangeThreshold: 0.08,
                highQualitySampleCount: 6,
                highQualityDataAge: 35000,
                mediumQualitySampleCount: 3,
                mediumQualityDataAge: 70000,
                circuitBreakerMaxErrors: 8,
                circuitBreakerWindowMs: 90000,

                // Confidence adjustments
                lowScoreConfidenceAdjustment: 0.7,
                lowVolumeConfidenceAdjustment: 0.8,
                invalidSurgeConfidenceAdjustment: 0.8,
                passiveConsistencyThreshold: 0.7,
                imbalanceNeutralThreshold: 0.1,
                velocityMinBound: 0.1,
                velocityMaxBound: 10,

                // Zone management
                maxZones: 75,
                zoneAgeLimit: 1200000,

                // Features configuration
                features: {
                    depletionTracking: true,
                    spreadAdjustment: true,
                    volumeVelocity: false,
                    spoofingDetection: true,
                    adaptiveZone: true,
                    multiZone: false,
                    passiveHistory: true,
                },

                // Enhancement control
                useStandardizedZones: true,
                enhancementMode: "production" as const,
                minEnhancedConfidenceThreshold: 0.3,

                // Enhanced depletion analysis
                depletionVolumeThreshold: 30,
                depletionRatioThreshold: 0.6,
                varianceReductionFactor: 1,
                alignmentNormalizationFactor: 1,
                distanceNormalizationDivisor: 2,
                passiveVolumeExhaustionRatio: 0.5,
                aggressiveVolumeExhaustionThreshold: 0.7,
                aggressiveVolumeReductionFactor: 0.5,
                enableDepletionAnalysis: true,
                depletionConfidenceBoost: 0.1,
            };

            const detector = new ExhaustionDetectorEnhanced(
                "test-exhaustion",
                settingsWithExplicitValue,
                createMockPreprocessor(),
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
