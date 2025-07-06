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

export const Config = {
    SIGNAL_MANAGER: mockSignalManagerConfig,
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
