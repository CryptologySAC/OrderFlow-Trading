// src/indicators/types/exhaustionTypes.ts
// Extracted from exhaustionDetector.ts before deletion

import type {
    BaseDetectorSettings,
    ExhaustionFeatures,
} from "../interfaces/detectorInterfaces.js";

export interface ExhaustionSettings extends BaseDetectorSettings {
    features?: ExhaustionFeatures;
    // Exhaustion-specific settings
    exhaustionThreshold?: number; // Minimum exhaustion score (0-1)
    maxPassiveRatio?: number; // Max ratio of current/avg passive for exhaustion
    minDepletionFactor?: number; // Min factor for passive depletion detection

    // Scoring threshold parameters (previously hardcoded)
    imbalanceHighThreshold?: number; // High imbalance threshold (default 0.8)
    imbalanceMediumThreshold?: number; // Medium imbalance threshold (default 0.6)
    spreadHighThreshold?: number; // High spread threshold (default 0.005)
    spreadMediumThreshold?: number; // Medium spread threshold (default 0.002)

    // Volume surge detection parameters for enhanced exhaustion analysis
    volumeSurgeMultiplier?: number; // Volume surge threshold for exhaustion validation
    imbalanceThreshold?: number; // Order flow imbalance threshold for exhaustion
    institutionalThreshold?: number; // Institutional trade size threshold
    burstDetectionMs?: number; // Burst detection window
    sustainedVolumeMs?: number; // Sustained volume analysis window
    medianTradeSize?: number; // Baseline trade size for volume analysis

    // Scoring weight parameters (previously hardcoded)
    scoringWeights?: {
        depletion?: number; // Primary exhaustion factor (default 0.4)
        passive?: number; // Passive liquidity depletion (default 0.25)
        continuity?: number; // Continuous depletion trend (default 0.15)
        imbalance?: number; // Market imbalance (default 0.1)
        spread?: number; // Spread widening (default 0.08)
        velocity?: number; // Volume velocity (default 0.02)
    };

    // Depletion calculation parameters (previously hardcoded)
    depletionThresholdRatio?: number; // Ratio of avgPassive for depletion threshold (default 0.2)

    // Data quality assessment parameters (previously hardcoded)
    significantChangeThreshold?: number; // Significant change threshold (default 0.1)
    highQualitySampleCount?: number; // High quality minimum sample count (default 8)
    highQualityDataAge?: number; // High quality maximum data age (default 45000ms)
    mediumQualitySampleCount?: number; // Medium quality minimum sample count (default 3)
    mediumQualityDataAge?: number; // Medium quality maximum data age (default 90000ms)

    // Circuit breaker configuration (previously hardcoded)
    circuitBreakerMaxErrors?: number; // Maximum errors before circuit breaker opens (default 5)
    circuitBreakerWindowMs?: number; // Error count reset window (default 60000ms)

    // CLAUDE.md COMPLIANCE: Confidence adjustment parameters (previously hardcoded)
    lowScoreConfidenceAdjustment?: number; // Confidence reduction for low scores (default 0.7)
    lowVolumeConfidenceAdjustment?: number; // Confidence reduction for low volume (default 0.8)
    invalidSurgeConfidenceAdjustment?: number; // Confidence reduction for invalid surge (default 0.8)
}
