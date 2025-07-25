// __mocks__/src/core/config.ts

import { vi } from "vitest";
import type { SignalManagerConfig } from "../../../src/trading/signalManager.js";

const mockSignalManagerConfig = {
    confidenceThreshold: 0.3,
    signalTimeout: 120000,
    enableMarketHealthCheck: true,
    enableAlerts: true,
    maxQueueSize: 1000,
    processingBatchSize: 10,
    backpressureThreshold: 800,
    enableSignalPrioritization: true,
    adaptiveBatchSizing: true,
    maxAdaptiveBatchSize: 50,
    minAdaptiveBatchSize: 5,
    circuitBreakerThreshold: 5,
    circuitBreakerResetMs: 60000,
    adaptiveBackpressure: true,
    highPriorityBypassThreshold: 8.5,
    signalTypePriorities: {
        absorption: 10,
        deltacvd: 8,
        exhaustion: 9,
        accumulation: 7,
        distribution: 7,
    },
    detectorThresholds: {
        absorption: 0.6,
        deltacvd: 0.4,
        exhaustion: 0.2,
        accumulation: 0.3,
        distribution: 0.4,
    },
    positionSizing: {
        absorption: 0.5,
        deltacvd: 0.7,
        exhaustion: 1.0,
        accumulation: 0.6,
        distribution: 0.7,
    },
    // Required configurable parameters (CLAUDE.md compliance)
    correlationBoostFactor: 0.7,
    priceTolerancePercent: 0.3,
    signalThrottleMs: 10000,
    correlationWindowMs: 300000,
    maxHistorySize: 100,
    defaultPriority: 5,
    volatilityHighThreshold: 0.05,
    volatilityLowThreshold: 0.02,
    defaultLowVolatility: 0.02,
    defaultVolatilityError: 0.03,
    contextBoostHigh: 0.15,
    contextBoostLow: 0.1,
    priorityQueueHighThreshold: 8.0,
    backpressureYieldMs: 1,
    marketVolatilityWeight: 0.6,
    // Conflict resolution configuration - DISABLED for testing (to not break existing tests)
    conflictResolution: {
        enabled: false,
        strategy: "confidence_weighted" as const,
        minimumSeparationMs: 30000,
        contradictionPenaltyFactor: 0.5,
        priceTolerance: 0.001,
        volatilityNormalizationFactor: 0.02,
    },
    signalPriorityMatrix: {
        highVolatility: {
            absorption: 0.3,
            deltacvd: 0.7,
            exhaustion: 0.8,
            accumulation: 0.5,
            distribution: 0.5,
        },
        lowVolatility: {
            absorption: 0.7,
            deltacvd: 0.3,
            exhaustion: 0.4,
            accumulation: 0.8,
            distribution: 0.8,
        },
        balanced: {
            absorption: 0.5,
            deltacvd: 0.5,
            exhaustion: 0.6,
            accumulation: 0.6,
            distribution: 0.6,
        },
    },
} as SignalManagerConfig;

// Mock DeltaCVD detector configuration (SIMPLIFIED - matches production schema)
const mockDeltaCVDConfig = {
    // Core CVD analysis parameters (only what's actually used)
    windowsSec: [60, 300],
    minTradesPerSec: 0.75,
    minVolPerSec: 10,
    signalThreshold: 0.4,
    eventCooldownMs: 5000,

    // Zone enhancement control
    enhancementMode: "production" as const,

    // CVD divergence analysis (pure divergence mode only)
    cvdImbalanceThreshold: 0.3,
};

// Mock Universal Zone Configuration (CRITICAL for DeltaCVD tests)
const mockUniversalZoneConfig = {
    maxActiveZones: 50,
    zoneTimeoutMs: 1800000,
    minZoneVolume: 100,
    maxZoneWidth: 0.05,
    minZoneStrength: 0.5,
    completionThreshold: 0.6,
    strengthChangeThreshold: 0.15,
    minCandidateDuration: 180000,
    maxPriceDeviation: 0.02,
    minTradeCount: 30,
    minBuyRatio: 0.6,
    minSellRatio: 0.55,
    priceStabilityThreshold: 0.85,
    strongZoneThreshold: 0.7,
    weakZoneThreshold: 0.4,
    minZoneConfluenceCount: 2,
    maxZoneConfluenceDistance: 3,
    enableZoneConfluenceFilter: true,
    enableCrossTimeframeAnalysis: false,
    confluenceConfidenceBoost: 0.1,
    crossTimeframeBoost: 0.05,
    useStandardizedZones: true,
    enhancementMode: "production" as const,
};

// Mock Absorption detector configuration (very permissive for testing)
const mockAbsorptionConfig = {
    minAggVolume: 10, // Very low threshold for testing
    timeWindowIndex: 0, // Use first time window (matches current schema)
    eventCooldownMs: 0, // Disable cooldown for testing
    priceEfficiencyThreshold: 0.001, // Very permissive for testing
    maxAbsorptionRatio: 0.95,
    minPassiveMultiplier: 1.05, // Very low multiplier
    passiveAbsorptionThreshold: 0.6, // Minimum valid threshold per schema
    institutionalVolumeThreshold: 5, // Very low threshold for testing
    institutionalVolumeRatioThreshold: 0.4, // More permissive for testing
    enableInstitutionalVolumeFilter: false, // Disable strict filtering for tests
    institutionalVolumeBoost: 0.1,
    minAbsorptionScore: 0.3, // Minimum valid score per schema
    finalConfidenceRequired: 0.2, // Very low confidence requirement for testing
    minEnhancedConfidenceThreshold: 0.1,
    useStandardizedZones: true,
    enhancementMode: "production" as const,
    liquidityGradientRange: 5,
    contextConfidenceBoostMultiplier: 0.2,
    expectedMovementScalingFactor: 8,
    confidenceBoostReduction: 0.4,
    maxZoneCountForScoring: 3,
};

// Mock Exhaustion detector configuration (test-friendly thresholds)
const mockExhaustionConfig = {
    minAggVolume: 10, // Very low threshold for testing
    exhaustionThreshold: 0.05, // Very low threshold for testing (5% aggressive volume indicates exhaustion)
    timeWindowIndex: 0, // Use first time window (matches current schema)
    eventCooldownMs: 0, // Disable cooldown for testing
    useStandardizedZones: true,
    enhancementMode: "production" as const,
    minEnhancedConfidenceThreshold: 0.01, // Very low threshold for testing
    enableDepletionAnalysis: true,
    depletionVolumeThreshold: 10, // Very low threshold for testing
    depletionRatioThreshold: 0.05, // Very low threshold for testing (5%)
    depletionConfidenceBoost: 0.15,
    passiveVolumeExhaustionRatio: 0.4,
    varianceReductionFactor: 1.0,
    alignmentNormalizationFactor: 0.4,
    aggressiveVolumeExhaustionThreshold: 0.05, // Very low threshold for testing
    aggressiveVolumeReductionFactor: 0.5,
};

// Mock preprocessor configuration (test-friendly values)
const mockPreprocessorConfig = {
    defaultZoneMultipliers: [1, 2, 4],
    defaultTimeWindows: [300000, 900000, 1800000, 3600000, 5400000],
    defaultMinZoneWidthMultiplier: 2,
    defaultMaxZoneWidthMultiplier: 10,
    defaultMaxZoneHistory: 2000,
    defaultMaxMemoryMB: 50,
    defaultAggressiveVolumeAbsolute: 10.0,
    defaultPassiveVolumeAbsolute: 5.0,
    defaultInstitutionalVolumeAbsolute: 50.0,
    maxTradesPerZone: 1500,
};

export const Config = {
    SIGNAL_MANAGER: mockSignalManagerConfig,
    DELTACVD_DETECTOR: mockDeltaCVDConfig,
    ABSORPTION_DETECTOR: mockAbsorptionConfig, // Add missing absorption config
    EXHAUSTION_DETECTOR: mockExhaustionConfig, // Add missing exhaustion config
    UNIVERSAL_ZONE_CONFIG: mockUniversalZoneConfig, // CRITICAL: Missing config added
    PREPROCESSOR: mockPreprocessorConfig, // Add preprocessor configuration for tests
    DETECTOR_CONFIDENCE_THRESHOLDS: {
        absorption: 0.3,
        deltacvd: 0.3,
        exhaustion: 0.3,
        accumulation: 0.3,
        distribution: 0.3,
    },
    DETECTOR_POSITION_SIZING: {
        absorption: 0.5,
        deltacvd: 0.7,
        exhaustion: 1.0,
        accumulation: 0.6,
        distribution: 0.7,
    },
};

// Allow tests to modify conflict resolution config
export const setConflictResolutionEnabled = (enabled: boolean) => {
    mockSignalManagerConfig.conflictResolution.enabled = enabled;
    // Also update the exported Config object directly
    Config.SIGNAL_MANAGER.conflictResolution.enabled = enabled;
};

export const removeConflictResolutionConfig = () => {
    delete (mockSignalManagerConfig as any).conflictResolution;
    delete (mockSignalManagerConfig as any).signalPriorityMatrix;
};

export const resetMockConfig = () => {
    // Restore default config with conflict resolution enabled
    (mockSignalManagerConfig as any).conflictResolution = {
        enabled: true,
        strategy: "confidence_weighted" as const,
        minimumSeparationMs: 30000,
        contradictionPenaltyFactor: 0.5,
        priceTolerance: 0.001,
        volatilityNormalizationFactor: 0.02,
    };
    (mockSignalManagerConfig as any).signalPriorityMatrix = {
        highVolatility: {
            absorption: 0.3,
            deltacvd: 0.7,
            exhaustion: 0.8,
            accumulation: 0.5,
            distribution: 0.5,
        },
        lowVolatility: {
            absorption: 0.7,
            deltacvd: 0.3,
            exhaustion: 0.4,
            accumulation: 0.8,
            distribution: 0.8,
        },
        balanced: {
            absorption: 0.5,
            deltacvd: 0.5,
            exhaustion: 0.6,
            accumulation: 0.6,
            distribution: 0.6,
        },
    };
};
