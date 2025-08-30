// src/types/calculatedValuesTypes.ts
//
// TypeScript interfaces for calculated values from each detector
// These define the exact structure for CSV logging
//

/**
 * Calculated values interface for AbsorptionDetector
 * Properties match config parameter names, values are calculated results
 */
export interface AbsorptionCalculatedValues {
    // Values that get compared against config thresholds
    calculatedMinAggVolume: number; // vs config minAggVolume (200)
    calculatedTimeWindowIndex: number; // vs config timeWindowIndex (0)
    calculatedEventCooldownMs: number; // vs config eventCooldownMs (30000)
    calculatedPriceEfficiencyThreshold: number; // vs config priceEfficiencyThreshold (0.0047)
    calculatedMaxAbsorptionRatio: number; // vs config maxAbsorptionRatio (0.9)
    calculatedMinPassiveMultiplier: number; // vs config minPassiveMultiplier (2.2)
    calculatedPassiveAbsorptionThreshold: number; // vs config passiveAbsorptionThreshold (0.62)
    calculatedExpectedMovementScalingFactor: number; // vs config expectedMovementScalingFactor (10)
    calculatedMinAbsorptionScore: number; // vs config minAbsorptionScore (0.8)
    calculatedFinalConfidenceRequired: number; // vs config finalConfidenceRequired (2.0)
    calculatedMaxZoneCountForScoring: number; // vs config maxZoneCountForScoring (5)
    calculatedBalanceThreshold: number; // vs config balanceThreshold (0.017)
    calculatedConfluenceMinZones: number; // vs config confluenceMinZones (2)
    calculatedConfluenceMaxDistance: number; // vs config confluenceMaxDistance (5)

    // Zone tracking parameters
    calculatedMaxZonesPerSide: number; // vs config maxZonesPerSide (5)
    calculatedZoneHistoryWindowMs: number; // vs config zoneHistoryWindowMs (60000)
    calculatedAbsorptionZoneThreshold: number; // vs config absorptionZoneThreshold (1.5)
    calculatedMinPassiveVolumeForZone: number; // vs config minPassiveVolumeForZone (50)
    calculatedPriceStabilityTicks: number; // vs config priceStabilityTicks (2)
    calculatedMinAbsorptionEvents: number; // vs config minAbsorptionEvents (2)
}

/**
 * Calculated values interface for ExhaustionDetector
 * Properties match config parameter names, values are calculated results
 */
export interface ExhaustionCalculatedValues {
    // Values that get compared against config thresholds
    calculatedMinAggVolume: number; // vs config minAggVolume (80)
    calculatedExhaustionThreshold: number; // vs config exhaustionThreshold (0.5)
    calculatedTimeWindowIndex: number; // vs config timeWindowIndex (0)
    calculatedEventCooldownMs: number; // vs config eventCooldownMs (30000)
    calculatedUseStandardizedZones: boolean; // vs config useStandardizedZones (true)
    calculatedEnhancementMode: string; // vs config enhancementMode ("production")
    calculatedMinEnhancedConfidenceThreshold: number; // vs config minEnhancedConfidenceThreshold (0.4)
    calculatedEnableDepletionAnalysis: boolean; // vs config enableDepletionAnalysis (true)
    calculatedDepletionVolumeThreshold: number; // vs config depletionVolumeThreshold (750)
    calculatedDepletionRatioThreshold: number; // vs config depletionRatioThreshold (0.2)
    calculatedPassiveVolumeExhaustionRatio: number; // vs config passiveVolumeExhaustionRatio (0.4)
    calculatedVarianceReductionFactor: number; // vs config varianceReductionFactor (1.0)
    calculatedAlignmentNormalizationFactor: number; // vs config alignmentNormalizationFactor (0.4)
    calculatedAggressiveVolumeExhaustionThreshold: number; // vs config aggressiveVolumeExhaustionThreshold (0.5)
    calculatedAggressiveVolumeReductionFactor: number; // vs config aggressiveVolumeReductionFactor (0.5)
    calculatedPassiveRatioBalanceThreshold: number; // vs config passiveRatioBalanceThreshold (0.5)
    calculatedPremiumConfidenceThreshold: number; // vs config premiumConfidenceThreshold (0.8)
    calculatedVariancePenaltyFactor: number; // vs config variancePenaltyFactor (1.0)
    calculatedRatioBalanceCenterPoint: number; // vs config ratioBalanceCenterPoint (0.5)
}

/**
 * Calculated values interface for DeltaCVDDetector
 * Properties match config parameter names, values are calculated results
 */
export interface DeltaCVDCalculatedValues {
    // Values that get compared against config thresholds
    calculatedMinTradesPerSec: number; // compared against minTradesPerSec (1.0)
    calculatedMinVolPerSec: number; // compared against minVolPerSec (5.0)
    calculatedSignalThreshold: number; // compared against signalThreshold (0.7)
    calculatedEventCooldownMs: number; // compared against eventCooldownMs (1000)
    calculatedCvdImbalanceThreshold: number; // compared against cvdImbalanceThreshold (0.18)
    calculatedTimeWindowIndex: number; // compared against timeWindowIndex (0)
    calculatedInstitutionalThreshold: number; // compared against institutionalThreshold (25.0)
    calculatedVolumeEfficiencyThreshold: number; // compared against volumeEfficiencyThreshold (0.3)
}

/**
 * Union type for all calculated values
 */
export type DetectorCalculatedValues =
    | AbsorptionCalculatedValues
    | ExhaustionCalculatedValues
    | DeltaCVDCalculatedValues;
