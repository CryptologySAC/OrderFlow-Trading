// src/indicators/types/deltaCVDTypes.ts
// Extracted from deltaCVDConfirmation.ts before deletion

import type { BaseDetectorSettings } from "../interfaces/detectorInterfaces.ts";

export interface DeltaCVDConfirmationSettings extends BaseDetectorSettings {
    windowsSec?: [60, 300, 900] | number[]; // analysed windows
    minZ?: number; // base min |zScore| on shortest window
    minTradesPerSec?: number; // floor scaled by window
    minVolPerSec?: number; // floor scaled by window

    // NEW: Detection mode
    detectionMode?: "momentum" | "divergence" | "hybrid"; // Default: "momentum"
    divergenceThreshold?: number; // 0.3 = 30% correlation threshold for divergence
    divergenceLookbackSec?: number; // 60 seconds to check for price/CVD divergence

    // A/B Testing: Passive volume usage control
    usePassiveVolume?: boolean; // Enable/disable passive volume in CVD calculation (default: true)

    // CRITICAL FIX: Make minimum samples configurable for testing
    minSamplesForStats?: number; // Minimum samples required for statistical analysis (default: 30)

    // Enhanced settings
    volatilityLookbackSec?: number; // window for volatility baseline (default: 3600)
    priceCorrelationWeight?: number; // how much price correlation affects confidence (0-1)
    volumeConcentrationWeight?: number; // weight for volume concentration factor
    adaptiveThresholdMultiplier?: number; // multiplier for adaptive z-score thresholds
    maxDivergenceAllowed?: number; // max allowed price/CVD divergence before penalty
    stateCleanupIntervalSec?: number; // how often to cleanup old state

    // Volume surge detection for 0.7%+ moves
    volumeSurgeMultiplier?: number; // 4x volume surge threshold for momentum detection
    imbalanceThreshold?: number; // 35% order flow imbalance threshold
    institutionalThreshold?: number; // 17.8 LTC institutional trade size threshold
    burstDetectionMs?: number; // 1000ms burst detection window
    sustainedVolumeMs?: number; // 30000ms sustained volume confirmation window
    medianTradeSize?: number; // 0.6 LTC median trade size baseline
    dynamicThresholds?: boolean;
    logDebug?: boolean;

    // PHASE 2: Depth analysis settings
    enableDepthAnalysis?: boolean;
    maxOrderbookAge?: number; // 5000ms

    // PHASE 3: Absorption detection
    absorptionCVDThreshold?: number; // 50
    absorptionPriceThreshold?: number; // 0.1

    // PHASE 4: Imbalance analysis
    imbalanceWeight?: number; // 0.2

    // PHASE 5: Iceberg detection
    icebergMinRefills?: number; // 3
    icebergMinSize?: number; // 20

    // Enhanced confidence
    baseConfidenceRequired?: number; // 0.4
    finalConfidenceRequired?: number; // 0.6

    // Correlation threshold parameters (previously hardcoded)
    strongCorrelationThreshold?: number; // Strong correlation threshold (default 0.7)
    weakCorrelationThreshold?: number; // Weak correlation threshold (default 0.3)
    depthImbalanceThreshold?: number; // Depth imbalance signal threshold (default 0.2)

    // ESSENTIAL CONFIGURABLE PARAMETERS - Trading Logic (8 parameters)
    minTradesForAnalysis?: number; // Minimum trades required for analysis (default: 20)
    minVolumeRatio?: number; // Minimum volume ratio for calculations (default: 0.1)
    maxVolumeRatio?: number; // Maximum volume ratio cap (default: 5.0)
    priceChangeThreshold?: number; // Price change threshold for direction detection (default: 0.001)
    minZScoreBound?: number; // Minimum z-score bound (default: -20)
    maxZScoreBound?: number; // Maximum z-score bound (default: 20)
    minCorrelationBound?: number; // Minimum correlation bound (default: -0.999)
    maxCorrelationBound?: number; // Maximum correlation bound (default: 0.999)
}
