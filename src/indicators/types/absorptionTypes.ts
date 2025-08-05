// src/indicators/types/absorptionTypes.ts
// Extracted from absorptionDetector.ts before deletion

import type {
    BaseDetectorSettings,
    AbsorptionFeatures,
} from "../interfaces/detectorInterfaces.ts";

export interface AbsorptionSettings extends BaseDetectorSettings {
    features?: AbsorptionFeatures;
    // Absorption-specific settings
    absorptionThreshold?: number; // Minimum absorption score (0-1)
    minPassiveMultiplier?: number; // Min passive/aggressive ratio for absorption
    maxAbsorptionRatio?: number; // Max aggressive/passive ratio for absorption

    // Magic number elimination - absorption level thresholds
    strongAbsorptionRatio?: number; // Threshold for strong absorption detection (default 0.1)
    moderateAbsorptionRatio?: number; // Threshold for moderate absorption detection (default 0.3)
    weakAbsorptionRatio?: number; // Threshold for weak absorption detection (default 0.5)

    // Magic number elimination - threshold configurations
    spreadImpactThreshold?: number; // Threshold for spread impact detection (default 0.003)
    velocityIncreaseThreshold?: number; // Threshold for velocity increase detection (default 1.5)
    priceEfficiencyThreshold?: number; // Threshold for price efficiency validation (default 0.7)
    significantChangeThreshold?: number; // Threshold for significant threshold changes (default 0.1)

    // Magic number elimination - configurable calculation parameters
    liquidityGradientRange?: number; // Range for liquidity gradient calculation (default 5)
    recentEventsNormalizer?: number; // Normalizer for recent events velocity (default 10)
    contextTimeWindowMs?: number; // Time window for context analysis (default 300000)
    historyMultiplier?: number; // Multiplier for history cleanup window (default 2)
    refillThreshold?: number; // Threshold for passive refill detection (default 1.1)
    consistencyThreshold?: number; // Threshold for consistency calculation (default 0.7)
    passiveStrengthPeriods?: number; // Number of periods for passive strength calculation (default 3)

    // Dominant side analysis configuration
    dominantSideAnalysisWindowMs?: number; // Time window for dominant side analysis (default 45000)
    dominantSideFallbackTradeCount?: number; // Fallback trade count when insufficient time data (default 10)
    dominantSideMinTradesRequired?: number; // Minimum trades required for time-based analysis (default 3)
    dominantSideTemporalWeighting?: boolean; // Enable temporal weighting for older trades (default false)
    dominantSideWeightDecayFactor?: number; // Weight decay factor for temporal weighting (default 0.5)

    // CLAUDE.md COMPLIANT: Critical calculation integrity fixes (NO magic numbers)
    expectedMovementScalingFactor?: number; // Ticks per unit volume pressure for expected movement calculation (default 10)

    // CRITICAL: Magic number elimination - confidence and urgency thresholds
    contextConfidenceBoostMultiplier?: number; // Multiplier for context-based confidence boost (default 0.3)
    highUrgencyThreshold?: number; // Threshold for high urgency classification (default 1.3)
    lowUrgencyThreshold?: number; // Threshold for low urgency classification (default 0.8)
    reversalStrengthThreshold?: number; // Threshold for reversal strength urgency (default 0.7)
    pricePercentileHighThreshold?: number; // Threshold for high price percentile (default 0.8)

    // CRITICAL: Magic number elimination - microstructure thresholds
    microstructureSustainabilityThreshold?: number; // Threshold for sustainability score (default 0.7)
    microstructureEfficiencyThreshold?: number; // Threshold for execution efficiency (default 0.8)
    microstructureFragmentationThreshold?: number; // Threshold for fragmentation score (default 0.7)
    microstructureSustainabilityBonus?: number; // Bonus for high sustainability (default 0.3)
    microstructureToxicityMultiplier?: number; // Multiplier for toxicity adjustment (default 0.3)
}
