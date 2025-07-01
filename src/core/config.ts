// src/core/config.ts
import dotenv from "dotenv";
dotenv.config();
import { readFileSync } from "fs";
import { resolve } from "path";
import { z } from "zod";
import { AnomalyDetectorOptions } from "../services/anomalyDetector.js";
import { SpoofingDetectorConfig } from "../services/spoofingDetector.js";
import type { IcebergDetectorConfig } from "../services/icebergDetector.js";
import type { HiddenOrderDetectorConfig } from "../services/hiddenOrderDetector.js";
import { OrderBookStateOptions } from "../market/orderBookState.js";
import type {
    AllowedSymbols,
    EnhancedZoneFormationConfig,
    MarketDataStorageConfig,
} from "../types/configTypes.js";
import type { OrderflowPreprocessorOptions } from "../market/orderFlowPreprocessor.js";
import type { DataStreamConfig } from "../trading/dataStreamManager.js";
import type { SupportResistanceConfig } from "../indicators/supportResistanceDetector.js";
import type { IndividualTradesManagerConfig } from "../data/individualTradesManager.js";
import type { MicrostructureAnalyzerConfig } from "../data/microstructureAnalyzer.js";
import type { TradesProcessorOptions } from "../market/processors/tradesProcessor.js";
import type { SignalManagerConfig } from "../trading/signalManager.js";
import type { SignalCoordinatorConfig } from "../services/signalCoordinator.js";
import type { OrderBookProcessorOptions } from "../market/processors/orderBookProcessor.js";
import type { MQTTConfig } from "../types/configTypes.js";

// FUTURE-PROOF: Symbol-agnostic validation schemas with mathematical ranges

// Financial tick value validator - EXACT equality required for trading systems
export const createTickValueValidator = (pricePrecision: number) => {
    const expectedTickValue = 1 / Math.pow(10, pricePrecision);
    return z.number().refine((val) => val === expectedTickValue, {
        message: `Tick value must be exactly ${expectedTickValue} for pricePrecision ${pricePrecision}`,
    });
};

// ============================================================================
// UNIVERSAL ZONE CONFIG - Pure zone infrastructure shared by ALL detectors
// ============================================================================
export const UniversalZoneSchema = z.object({
    // Core zone lifecycle management
    maxActiveZones: z.number().int().min(1).max(100),
    zoneTimeoutMs: z.number().int().min(60000).max(7200000), // 1m-2h
    minZoneVolume: z.number().min(1).max(100000),
    maxZoneWidth: z.number().min(0.001).max(0.1), // 0.1%-10%
    minZoneStrength: z.number().min(0.1).max(1.0), // 10%-100%
    completionThreshold: z.number().min(0.5).max(1.0), // 50%-100%
    strengthChangeThreshold: z.number().min(0.05).max(0.5), // 5%-50%

    // Zone formation requirements
    minCandidateDuration: z.number().int().min(60000).max(1800000), // 1m-30m
    maxPriceDeviation: z.number().min(0.005).max(0.05), // 0.5%-5%
    minTradeCount: z.number().int().min(5).max(200),

    // Zone classification
    minBuyRatio: z.number().min(0.5).max(0.8), // 50%-80% for accumulation
    minSellRatio: z.number().min(0.5).max(0.8), // 50%-80% for distribution

    // Zone quality thresholds
    priceStabilityThreshold: z.number().min(0.8).max(0.99), // 80%-99%
    strongZoneThreshold: z.number().min(0.6).max(0.9), // 60%-90%
    weakZoneThreshold: z.number().min(0.2).max(0.6), // 20%-60%

    // Zone confluence settings (shared by ALL detectors)
    minZoneConfluenceCount: z.number().int().min(1).max(3), // 1-3 zones
    maxZoneConfluenceDistance: z.number().int().min(1).max(10), // 1-10 ticks
    enableZoneConfluenceFilter: z.boolean(),
    enableCrossTimeframeAnalysis: z.boolean(),
    confluenceConfidenceBoost: z.number().min(0.05).max(0.3), // 5%-30%
    crossTimeframeBoost: z.number().min(0.05).max(0.25), // 5%-25%

    // Zone enhancement
    useStandardizedZones: z.boolean(),
    enhancementMode: z.enum(["disabled", "testing", "production"]),
});

// EXHAUSTION detector - ALL properties from config.json exhaustion section
export const ExhaustionDetectorSchema = z.object({
    // Base detector settings (from config.json)
    minAggVolume: z.number().int().min(1).max(10000),
    windowMs: z.number().int().min(5000).max(300000),
    pricePrecision: z.number().int().min(0).max(8),
    zoneTicks: z.number().int().min(1).max(20),
    eventCooldownMs: z.number().int().min(1000).max(60000),
    minInitialMoveTicks: z.number().int().min(1).max(50),
    confirmationTimeoutMs: z.number().int().min(10000).max(300000),
    maxRevisitTicks: z.number().int().min(1).max(20),

    // Exhaustion-specific thresholds
    volumeSurgeMultiplier: z.number().min(0.5).max(10.0),
    imbalanceThreshold: z.number().min(0.1).max(0.8),
    institutionalThreshold: z.number().min(1).max(100),
    burstDetectionMs: z.number().int().min(500).max(10000),
    sustainedVolumeMs: z.number().int().min(5000).max(60000),
    medianTradeSize: z.number().min(0.1).max(10.0),
    exhaustionThreshold: z.number().min(0.1).max(1.0),
    maxPassiveRatio: z.number().min(0.1).max(1.0),
    minDepletionFactor: z.number().min(0.05).max(0.5),
    imbalanceHighThreshold: z.number().min(0.5).max(1.0),
    imbalanceMediumThreshold: z.number().min(0.3).max(0.8),
    spreadHighThreshold: z.number().min(0.001).max(0.01),
    spreadMediumThreshold: z.number().min(0.0005).max(0.005),

    // Scoring weights
    scoringWeights: z.object({
        depletion: z.number().min(0.1).max(0.8),
        passive: z.number().min(0.1).max(0.6),
        continuity: z.number().min(0.05).max(0.3),
        imbalance: z.number().min(0.02).max(0.2),
        spread: z.number().min(0.01).max(0.1),
        velocity: z.number().min(0.005).max(0.05),
    }),

    // Quality and performance settings
    depletionThresholdRatio: z.number().min(0.05).max(0.5),
    significantChangeThreshold: z.number().min(0.02).max(0.3),
    highQualitySampleCount: z.number().int().min(2).max(20),
    highQualityDataAge: z.number().int().min(10000).max(120000),
    mediumQualitySampleCount: z.number().int().min(1).max(10),
    mediumQualityDataAge: z.number().int().min(20000).max(300000),
    circuitBreakerMaxErrors: z.number().int().min(1).max(20),
    circuitBreakerWindowMs: z.number().int().min(30000).max(300000),

    // Confidence adjustments
    lowScoreConfidenceAdjustment: z.number().min(0.3).max(1.0),
    lowVolumeConfidenceAdjustment: z.number().min(0.3).max(1.0),
    invalidSurgeConfidenceAdjustment: z.number().min(0.3).max(1.0),
    passiveConsistencyThreshold: z.number().min(0.3).max(0.9),
    imbalanceNeutralThreshold: z.number().min(0.05).max(0.3),
    velocityMinBound: z.number().min(0.01).max(1.0),
    velocityMaxBound: z.number().min(5).max(50),

    // Zone management
    maxZones: z.number().int().min(10).max(200),
    zoneAgeLimit: z.number().int().min(300000).max(3600000),

    // Features configuration
    features: z.object({
        depletionTracking: z.boolean(),
        spreadAdjustment: z.boolean(),
        volumeVelocity: z.boolean(),
        spoofingDetection: z.boolean(),
        adaptiveZone: z.boolean(),
        multiZone: z.boolean(),
        passiveHistory: z.boolean(),
    }),

    // Enhancement control
    useStandardizedZones: z.boolean(),
    enhancementMode: z.enum(["disabled", "monitoring", "production"]),
    minEnhancedConfidenceThreshold: z.number().min(0.2).max(0.8),

    // Enhanced depletion analysis
    depletionVolumeThreshold: z.number().min(10).max(1000),
    depletionRatioThreshold: z.number().min(0.4).max(0.9),
    varianceReductionFactor: z.number().min(0.5).max(3.0),
    alignmentNormalizationFactor: z.number().min(0.5).max(3.0),
    distanceNormalizationDivisor: z.number().min(1).max(10),
    passiveVolumeExhaustionRatio: z.number().min(0.3).max(0.8),
    aggressiveVolumeExhaustionThreshold: z.number().min(0.5).max(1.0),
    aggressiveVolumeReductionFactor: z.number().min(0.3).max(0.8),
    enableDepletionAnalysis: z.boolean(),
    depletionConfidenceBoost: z.number().min(0.05).max(0.3),
});

// ABSORPTION detector - ALL properties from config.json absorption section
export const AbsorptionDetectorSchema = z.object({
    // Base detector settings (from config.json)
    minAggVolume: z.number().int().min(1).max(10000),
    windowMs: z.number().int().min(5000).max(300000),
    pricePrecision: z.number().int().min(0).max(8),
    zoneTicks: z.number().int().min(1).max(20),
    eventCooldownMs: z.number().int().min(1000).max(60000),
    minInitialMoveTicks: z.number().int().min(1).max(50),
    confirmationTimeoutMs: z.number().int().min(10000).max(300000),
    maxRevisitTicks: z.number().int().min(1).max(20),

    // Absorption-specific thresholds
    absorptionThreshold: z.number().min(0.1).max(1.0),
    minPassiveMultiplier: z.number().min(0.5).max(5.0),
    maxAbsorptionRatio: z.number().min(0.1).max(1.0),
    strongAbsorptionRatio: z.number().min(0.1).max(1.0),
    moderateAbsorptionRatio: z.number().min(0.1).max(1.0),
    weakAbsorptionRatio: z.number().min(0.1).max(2.0),
    priceEfficiencyThreshold: z.number().min(0.001).max(0.1),
    spreadImpactThreshold: z.number().min(0.0001).max(0.01),
    velocityIncreaseThreshold: z.number().min(0.5).max(5.0),
    significantChangeThreshold: z.number().min(0.01).max(0.5),

    // Dominant side analysis
    dominantSideAnalysisWindowMs: z.number().int().min(10000).max(300000),
    dominantSideFallbackTradeCount: z.number().int().min(1).max(100),
    dominantSideMinTradesRequired: z.number().int().min(1).max(20),
    dominantSideTemporalWeighting: z.boolean(),
    dominantSideWeightDecayFactor: z.number().min(0.1).max(1.0),

    // Features configuration
    features: z.object({
        adaptiveZone: z.boolean(),
        passiveHistory: z.boolean(),
        multiZone: z.boolean(),
        liquidityGradient: z.boolean(),
        absorptionVelocity: z.boolean(),
        layeredAbsorption: z.boolean(),
        spreadImpact: z.boolean(),
    }),

    // Enhancement control
    useStandardizedZones: z.boolean(),
    enhancementMode: z.enum(["disabled", "testing", "production"]),
    minEnhancedConfidenceThreshold: z.number().min(0.2).max(0.8),

    // Institutional volume detection (enhanced)
    institutionalVolumeThreshold: z.number().min(10).max(1000),
    institutionalVolumeRatioThreshold: z.number().min(0.2).max(0.8),
    enableInstitutionalVolumeFilter: z.boolean(),
    institutionalVolumeBoost: z.number().min(0.05).max(0.3),

    // Enhanced calculation parameters
    volumeNormalizationThreshold: z.number().min(50).max(5000),
    absorptionRatioNormalization: z.number().min(1).max(10),
    minAbsorptionScore: z.number().min(0.4).max(0.9),
    patternVarianceReduction: z.number().min(1).max(5),
    whaleActivityMultiplier: z.number().min(1.5).max(10.0),
    maxZoneCountForScoring: z.number().int().min(1).max(10),

    // Enhanced thresholds
    highConfidenceThreshold: z.number().min(0.6).max(0.9),
    lowConfidenceReduction: z.number().min(0.5).max(0.9),
    confidenceBoostReduction: z.number().min(0.3).max(0.8),
    passiveAbsorptionThreshold: z.number().min(0.4).max(0.8),
    aggressiveDistributionThreshold: z.number().min(0.4).max(0.8),
    patternDifferenceThreshold: z.number().min(0.05).max(0.3),
    minVolumeForRatio: z.number().min(0.5).max(20),

    // Enhanced scoring weights
    distanceWeight: z.number().min(0.2).max(0.6),
    volumeWeight: z.number().min(0.2).max(0.6),
    absorptionWeight: z.number().min(0.1).max(0.5),
    minConfluenceScore: z.number().min(0.4).max(0.8),
    volumeConcentrationWeight: z.number().min(0.1).max(0.3),
    patternConsistencyWeight: z.number().min(0.05).max(0.2),
    volumeBoostCap: z.number().min(0.1).max(0.5),
    volumeBoostMultiplier: z.number().min(0.1).max(0.5),
});

// DELTACVD detector - CVD-specific properties only (no zone settings)
export const DeltaCVDDetectorSchema = z.object({
    // Core CVD analysis
    windowsSec: z.array(z.number().int().min(30).max(3600)),
    minZ: z.number().min(0.1).max(1.0),
    priceCorrelationWeight: z.number().min(0.1).max(0.8),
    volumeConcentrationWeight: z.number().min(0.1).max(0.5),
    adaptiveThresholdMultiplier: z.number().min(0.3).max(2.0),
    eventCooldownMs: z.number().int().min(5000).max(60000),
    minTradesPerSec: z.number().min(0.01).max(5.0),
    minVolPerSec: z.number().min(0.1).max(10.0),
    minSamplesForStats: z.number().int().min(5).max(100),
    pricePrecision: z.number().int().min(0).max(8),
    volatilityLookbackSec: z.number().int().min(600).max(7200),
    maxDivergenceAllowed: z.number().min(0.1).max(2.0),
    stateCleanupIntervalSec: z.number().int().min(60).max(1800),
    dynamicThresholds: z.boolean(),
    logDebug: z.boolean(),

    // Volume and detection parameters
    volumeSurgeMultiplier: z.number().min(1.0).max(10.0),
    imbalanceThreshold: z.number().min(0.05).max(0.5),
    institutionalThreshold: z.number().min(5).max(100),
    burstDetectionMs: z.number().int().min(500).max(5000),
    sustainedVolumeMs: z.number().int().min(10000).max(120000),
    medianTradeSize: z.number().min(0.1).max(5.0),
    detectionMode: z.enum(["momentum", "divergence", "hybrid"]),
    divergenceThreshold: z.number().min(0.1).max(0.8),
    divergenceLookbackSec: z.number().int().min(30).max(300),
    enableDepthAnalysis: z.boolean(),
    usePassiveVolume: z.boolean(),
    maxOrderbookAge: z.number().int().min(1000).max(30000),
    absorptionCVDThreshold: z.number().min(10).max(200),
    absorptionPriceThreshold: z.number().min(0.01).max(1.0),
    imbalanceWeight: z.number().min(0.05).max(0.5),
    icebergMinRefills: z.number().int().min(1).max(10),
    icebergMinSize: z.number().min(5).max(100),
    baseConfidenceRequired: z.number().min(0.1).max(0.8),
    finalConfidenceRequired: z.number().min(0.2).max(0.9),
    strongCorrelationThreshold: z.number().min(0.5).max(0.95),
    weakCorrelationThreshold: z.number().min(0.1).max(0.6),
    depthImbalanceThreshold: z.number().min(0.05).max(0.5),

    // Enhancement control
    useStandardizedZones: z.boolean(),
    enhancementMode: z.enum(["disabled", "monitoring", "production"]),
    minEnhancedConfidenceThreshold: z.number().min(0.2).max(0.8),

    // Enhanced CVD analysis
    cvdDivergenceVolumeThreshold: z.number().min(20).max(2000),
    cvdDivergenceStrengthThreshold: z.number().min(0.5).max(1.0),
    cvdSignificantImbalanceThreshold: z.number().min(0.2).max(0.8),
    cvdDivergenceScoreMultiplier: z.number().min(1.0).max(5.0),
    alignmentMinimumThreshold: z.number().min(0.4).max(0.8),
    momentumScoreMultiplier: z.number().min(1.0).max(5.0),
    enableCVDDivergenceAnalysis: z.boolean(),
    enableMomentumAlignment: z.boolean(),
    divergenceConfidenceBoost: z.number().min(0.05).max(0.3),
    momentumAlignmentBoost: z.number().min(0.05).max(0.25),

    // ESSENTIAL CONFIGURABLE PARAMETERS - Trading Logic (8 mandatory parameters)
    minTradesForAnalysis: z.number().int().min(5).max(100),
    minVolumeRatio: z.number().min(0.01).max(1.0),
    maxVolumeRatio: z.number().min(1.0).max(20.0),
    priceChangeThreshold: z.number().min(0.0001).max(0.01),
    minZScoreBound: z.number().min(-50).max(-1),
    maxZScoreBound: z.number().min(1).max(50),
    minCorrelationBound: z.number().min(-1.0).max(-0.5),
    maxCorrelationBound: z.number().min(0.5).max(1.0),
});

// ACCUMULATION detector - ALL properties from config.json accumulation section
export const AccumulationDetectorSchema = z.object({
    // Core accumulation parameters
    useStandardizedZones: z.boolean(),
    minDurationMs: z.number().int().min(30000).max(1800000),
    minRatio: z.number().min(0.5).max(10.0),
    minRecentActivityMs: z.number().int().min(5000).max(120000),
    threshold: z.number().min(0.3).max(0.9),
    volumeSurgeMultiplier: z.number().min(1.5).max(10.0),
    imbalanceThreshold: z.number().min(0.1).max(0.7),
    institutionalThreshold: z.number().min(5).max(200),
    burstDetectionMs: z.number().int().min(500).max(10000),
    sustainedVolumeMs: z.number().int().min(10000).max(300000),
    medianTradeSize: z.number().min(0.1).max(50),
    enhancementMode: z.enum(["disabled", "testing", "production"]),
    minEnhancedConfidenceThreshold: z.number().min(0.2).max(0.8),

    // Enhancement internal parameters (accumulation-specific)
    enhancementCallFrequency: z.number().int().min(1).max(20),
    highConfidenceThreshold: z.number().min(0.6).max(0.95),
    lowConfidenceThreshold: z.number().min(0.2).max(0.6),
    minConfidenceBoostThreshold: z.number().min(0.01).max(0.2),
    defaultMinEnhancedConfidenceThreshold: z.number().min(0.2).max(0.8),
    confidenceReductionFactor: z.number().min(0.5).max(0.95),
    significanceBoostMultiplier: z.number().min(0.1).max(1.0),
    neutralBoostReductionFactor: z.number().min(0.3).max(0.8),
    enhancementSignificanceBoost: z.boolean(),
});

// DISTRIBUTION detector - Core zone properties + distribution-specific logic
export const DistributionDetectorSchema = z.object({
    // Core zone detector properties (inherited from DistributionZoneDetector requirements)
    minCandidateDuration: z.number().int().min(30000).max(1800000),
    maxPriceDeviation: z.number().min(0.005).max(0.1),
    minTradeCount: z.number().int().min(3).max(100),
    minBuyRatio: z.number().min(0.3).max(0.8),
    minSellRatio: z.number().min(0.3).max(0.8),
    minZoneVolume: z.number().min(10).max(10000),
    minZoneStrength: z.number().min(0.1).max(1.0),
    priceStabilityThreshold: z.number().min(0.7).max(0.99),
    strongZoneThreshold: z.number().min(0.5).max(0.9),
    weakZoneThreshold: z.number().min(0.2).max(0.6),

    // Volume analysis properties (inherited from DistributionZoneDetector requirements)
    volumeSurgeMultiplier: z.number().min(1.5).max(10.0),
    imbalanceThreshold: z.number().min(0.1).max(0.7),
    institutionalThreshold: z.number().min(5).max(200),
    burstDetectionMs: z.number().int().min(500).max(10000),
    sustainedVolumeMs: z.number().int().min(10000).max(300000),
    medianTradeSize: z.number().min(0.1).max(50),

    // Distribution-specific selling pressure
    sellingPressureVolumeThreshold: z.number().min(10).max(1000),
    sellingPressureRatioThreshold: z.number().min(0.5).max(0.9),
    enableSellingPressureAnalysis: z.boolean(),
    sellingPressureConfidenceBoost: z.number().min(0.05).max(0.3),

    // Distribution calculation parameters
    varianceReductionFactor: z.number().min(0.5).max(3.0),
    alignmentNormalizationFactor: z.number().min(0.5).max(3.0),
    confluenceStrengthDivisor: z.number().min(1).max(10),
    passiveToAggressiveRatio: z.number().min(0.3).max(2.0),
    varianceDivisor: z.number().min(1).max(10),
    moderateAlignmentThreshold: z.number().min(0.3).max(0.7),
    aggressiveSellingRatioThreshold: z.number().min(0.4).max(0.8),
    aggressiveSellingReductionFactor: z.number().min(0.3).max(0.8),

    // Enhancement control
    useStandardizedZones: z.boolean(),
    enhancementMode: z.enum(["disabled", "testing", "production"]),
    minEnhancedConfidenceThreshold: z.number().min(0.2).max(0.8),
});

const AccumulationEnhancedSettingsSchema = z
    .object({
        useStandardizedZones: z.boolean(),
        enhancementMode: z.enum(["disabled", "testing", "production"]),
        minEnhancedConfidenceThreshold: z.number(),
        enhancementCallFrequency: z.number(),
        highConfidenceThreshold: z.number(),
        lowConfidenceThreshold: z.number(),
        minConfidenceBoostThreshold: z.number(),
        defaultMinEnhancedConfidenceThreshold: z.number(),
        confidenceReductionFactor: z.number(),
        significanceBoostMultiplier: z.number(),
        neutralBoostReductionFactor: z.number(),
        enhancementSignificanceBoost: z.boolean(),
    })
    .passthrough();

const DistributionEnhancedSettingsSchema = z
    .object({
        useStandardizedZones: z.boolean(),
        enhancementMode: z.enum(["disabled", "testing", "production"]),
        minEnhancedConfidenceThreshold: z.number(),
        enableSellingPressureAnalysis: z.boolean(),
        sellingPressureConfidenceBoost: z.number(),
        sellingPressureVolumeThreshold: z.number(),
        sellingPressureRatioThreshold: z.number(),
        varianceReductionFactor: z.number(),
        alignmentNormalizationFactor: z.number(),
        confluenceStrengthDivisor: z.number(),
        passiveToAggressiveRatio: z.number(),
        varianceDivisor: z.number(),
        moderateAlignmentThreshold: z.number(),
        aggressiveSellingRatioThreshold: z.number(),
        aggressiveSellingReductionFactor: z.number(),
    })
    .passthrough();

const ExhaustionEnhancedSettingsSchema = z
    .object({
        useStandardizedZones: z.boolean(),
        enhancementMode: z.enum(["disabled", "testing", "production"]),
        minEnhancedConfidenceThreshold: z.number(),
        enableDepletionAnalysis: z.boolean(),
        depletionConfidenceBoost: z.number(),
        depletionVolumeThreshold: z.number(),
        depletionRatioThreshold: z.number(),
        varianceReductionFactor: z.number(),
        alignmentNormalizationFactor: z.number(),
        distanceNormalizationDivisor: z.number(),
        passiveVolumeExhaustionRatio: z.number(),
        aggressiveVolumeExhaustionThreshold: z.number(),
        aggressiveVolumeReductionFactor: z.number(),
    })
    .passthrough();

const AbsorptionEnhancedSettingsSchema = z
    .object({
        useStandardizedZones: z.boolean(),
        enhancementMode: z.enum(["disabled", "testing", "production"]),
        minEnhancedConfidenceThreshold: z.number(),
        institutionalVolumeThreshold: z.number(),
        institutionalVolumeRatioThreshold: z.number(),
        enableInstitutionalVolumeFilter: z.boolean(),
        institutionalVolumeBoost: z.number(),
        volumeConcentrationWeight: z.number(),
        patternConsistencyWeight: z.number(),
        volumeBoostCap: z.number(),
        volumeBoostMultiplier: z.number(),
        patternVarianceReduction: z.number(),
        whaleActivityMultiplier: z.number(),
        maxZoneCountForScoring: z.number(),
    })
    .passthrough();

const DeltaCVDEnhancedSettingsSchema = z
    .object({
        useStandardizedZones: z.boolean(),
        enhancementMode: z.enum(["disabled", "testing", "production"]),
        minEnhancedConfidenceThreshold: z.number(),
        enableCVDDivergenceAnalysis: z.boolean(),
        enableMomentumAlignment: z.boolean(),
        divergenceConfidenceBoost: z.number(),
        momentumAlignmentBoost: z.number(),
        cvdDivergenceVolumeThreshold: z.number(),
        cvdDivergenceStrengthThreshold: z.number(),
        cvdSignificantImbalanceThreshold: z.number(),
        cvdDivergenceScoreMultiplier: z.number(),
        alignmentMinimumThreshold: z.number(),
        momentumScoreMultiplier: z.number(),
        minTradesForAnalysis: z.number(),
        minVolumeRatio: z.number(),
        maxVolumeRatio: z.number(),
        priceChangeThreshold: z.number(),
        minZScoreBound: z.number(),
        maxZScoreBound: z.number(),
        minCorrelationBound: z.number(),
        maxCorrelationBound: z.number(),
    })
    .passthrough();

const EnhancedZoneFormationConfigSchema = z.object({
    icebergDetection: z.object({
        minSize: z.number(),
        maxSize: z.number(),
        priceStabilityTolerance: z.number(),
        sizeConsistencyThreshold: z.number(),
        sideDominanceThreshold: z.number(),
    }),
    priceEfficiency: z.object({
        baseImpactRate: z.number(),
        maxVolumeMultiplier: z.number(),
        minEfficiencyThreshold: z.number(),
    }),
    institutional: z.object({
        minRatio: z.number(),
        sizeThreshold: z.number(),
        detectionWindow: z.number(),
    }),
    detectorThresholds: z.object({
        accumulation: z.object({
            minScore: z.number(),
            minAbsorptionRatio: z.number(),
            maxAggressiveRatio: z.number(),
            minPriceStability: z.number(),
            minInstitutionalScore: z.number(),
        }),
        distribution: z.object({
            minScore: z.number(),
            minSellingRatio: z.number(),
            maxSupportRatio: z.number(),
            minPriceStability: z.number(),
            minInstitutionalScore: z.number(),
        }),
    }),
    adaptiveThresholds: z.object({
        volatility: z.object({
            high: z.object({
                accumulation: z.object({
                    minAbsorptionRatio: z.number(),
                    maxAggressiveRatio: z.number(),
                }),
                distribution: z.object({
                    minSellingRatio: z.number(),
                    maxSupportRatio: z.number(),
                }),
            }),
            medium: z.object({
                accumulation: z.object({
                    minAbsorptionRatio: z.number(),
                    maxAggressiveRatio: z.number(),
                }),
                distribution: z.object({
                    minSellingRatio: z.number(),
                    maxSupportRatio: z.number(),
                }),
            }),
            low: z.object({
                accumulation: z.object({
                    minAbsorptionRatio: z.number(),
                    maxAggressiveRatio: z.number(),
                }),
                distribution: z.object({
                    minSellingRatio: z.number(),
                    maxSupportRatio: z.number(),
                }),
            }),
        }),
    }),
});

const MarketDataStorageConfigSchema = z.object({
    enabled: z.boolean(),
    dataDirectory: z.string(),
    format: z.enum(["csv", "jsonl", "both"]),
    maxFileSize: z.number(),
    depthLevels: z.number(),
    rotationHours: z.number(),
    compressionEnabled: z.boolean(),
    monitoringInterval: z.number(),
});

const MQTTConfigSchema = z.object({
    url: z.string(),
    username: z.string().optional(),
    password: z.string().optional(),
    statsTopic: z.string().optional(),
    clientId: z.string().optional(),
    keepalive: z.number().optional(),
    connectTimeout: z.number().optional(),
    reconnectPeriod: z.number().optional(),
});

// Zod validation schemas for config.json
const BasicSymbolConfigSchema = z
    .object({
        pricePrecision: z.number().int().positive(),
        windowMs: z.number().int().positive(),
        bandTicks: z.number().int().positive(),
        quantityPrecision: z.number().int().positive(),
        largeTradeThreshold: z.number().positive(),
        maxEventListeners: z.number().int().positive(),
        dashboardUpdateInterval: z.number().int().positive(),
        maxDashboardInterval: z.number().int().positive(),
        significantChangeThreshold: z.number().positive(),
        orderBookState: z.object({
            maxLevels: z.number().int().positive(),
            snapshotIntervalMs: z.number().int().positive(),
            pricePrecision: z.number().int().positive(),
            symbol: z.string(),
            maxPriceDistance: z.number().positive(),
            pruneIntervalMs: z.number().int().positive(),
            maxErrorRate: z.number().positive(),
            staleThresholdMs: z.number().int().positive(),
        }),
        tradesProcessor: z.object({
            storageTime: z.number().int().positive(),
            maxBacklogRetries: z.number().int().positive(),
            backlogBatchSize: z.number().int().positive(),
            maxMemoryTrades: z.number().int().positive(),
            saveQueueSize: z.number().int().positive(),
            healthCheckInterval: z.number().int().positive(),
        }),
        signalManager: z.object({
            confidenceThreshold: z.number().positive(),
            signalTimeout: z.number().int().positive(),
            enableMarketHealthCheck: z.boolean(),
            enableAlerts: z.boolean(),
            detectorThresholds: z.record(z.number()),
            positionSizing: z.record(z.number()),
        }),
        signalCoordinator: z.object({
            maxConcurrentProcessing: z.number().int().positive(),
            processingTimeoutMs: z.number().int().positive(),
            retryAttempts: z.number().int().positive(),
            retryDelayMs: z.number().int().positive(),
            enableMetrics: z.boolean(),
            logLevel: z.string(),
        }),
        orderBookProcessor: z.object({
            binSize: z.number().int().positive(),
            numLevels: z.number().int().positive(),
            maxBufferSize: z.number().int().positive(),
        }),
        supportResistanceDetector: z.object({
            priceTolerancePercent: z.number().positive(),
            minTouchCount: z.number().int().positive(),
            minStrength: z.number().positive(),
            timeWindowMs: z.number().int().positive(),
            volumeWeightFactor: z.number().positive(),
            rejectionConfirmationTicks: z.number().int().positive(),
        }),
        spoofingDetector: z.object({
            wallTicks: z.number().int().positive(),
            minWallSize: z.number().positive(),
            dynamicWallWidth: z.boolean(),
            testLogMinSpoof: z.number().positive(),
        }),
        anomalyDetector: z.object({
            windowSize: z.number().int().positive(),
            anomalyCooldownMs: z.number().int().positive(),
            volumeImbalanceThreshold: z.number().positive(),
            normalSpreadBps: z.number().positive(),
            minHistory: z.number().int().positive(),
            flowWindowMs: z.number().int().positive(),
            orderSizeWindowMs: z.number().int().positive(),
            volatilityThreshold: z.number().positive(),
            spreadThresholdBps: z.number().positive(),
            extremeVolatilityWindowMs: z.number().int().positive(),
            liquidityCheckWindowMs: z.number().int().positive(),
            whaleCooldownMs: z.number().int().positive(),
            marketHealthWindowMs: z.number().int().positive(),
        }),
        icebergDetector: z.object({
            minRefillCount: z.number().int().positive(),
            maxSizeVariation: z.number().positive(),
            minTotalSize: z.number().positive(),
            maxRefillTimeMs: z.number().int().positive(),
            priceStabilityTolerance: z.number().positive(),
            institutionalSizeThreshold: z.number().positive(),
            trackingWindowMs: z.number().int().positive(),
            maxActiveIcebergs: z.number().int().positive(),
        }),
        hiddenOrderDetector: z.object({
            minHiddenVolume: z.number().positive(),
            minTradeSize: z.number().positive(),
            priceTolerance: z.number().positive(),
            maxDepthAgeMs: z.number().int().positive(),
            minConfidence: z.number().positive(),
            zoneHeightPercentage: z.number().positive(),
        }),
        exhaustion: ExhaustionEnhancedSettingsSchema,
        absorption: AbsorptionEnhancedSettingsSchema,
        deltaCvdConfirmation: DeltaCVDEnhancedSettingsSchema,
        accumulationDetector: AccumulationEnhancedSettingsSchema,
        dataStream: z.object({
            reconnectDelay: z.number().int().positive(),
            maxReconnectAttempts: z.number().int().positive(),
            depthUpdateSpeed: z.enum(["100ms", "1000ms"]),
            enableHeartbeat: z.boolean(),
            heartbeatInterval: z.number().int().positive(),
            maxBackoffDelay: z.number().int().positive(),
            streamHealthTimeout: z.number().int().positive(),
            enableStreamHealthCheck: z.boolean(),
            reconnectOnHealthFailure: z.boolean(),
            enableHardReload: z.boolean(),
            hardReloadAfterAttempts: z.number().int().positive(),
            hardReloadCooldownMs: z.number().int().positive(),
            maxHardReloads: z.number().int().positive(),
            hardReloadRestartCommand: z.string(),
        }),
        universalZoneConfig: UniversalZoneSchema,
        accumulation: AccumulationEnhancedSettingsSchema,
        distribution: DistributionEnhancedSettingsSchema,
    })
    .passthrough();

const ZoneDetectorSymbolConfigSchema = z.object({
    accumulation: AccumulationEnhancedSettingsSchema,
    distribution: DistributionEnhancedSettingsSchema,
});

const ConfigSchema = z.object({
    nodeEnv: z.string(),
    symbol: z.enum(["LTCUSDT"]),
    symbols: z.record(BasicSymbolConfigSchema),
    httpPort: z.number().int().positive(),
    wsPort: z.number().int().positive(),
    alertWebhookUrl: z.string().url(),
    alertCooldownMs: z.number().int().positive(),
    maxStorageTime: z.number().int().positive(),
    zoneDetectors: z.record(ZoneDetectorSymbolConfigSchema),
    mqtt: MQTTConfigSchema.optional(),
    enhancedZoneFormation: EnhancedZoneFormationConfigSchema,
    marketDataStorage: MarketDataStorageConfigSchema.optional(),
});

// Load and validate config.json
let rawConfig: unknown;
try {
    rawConfig = JSON.parse(
        readFileSync(resolve(process.cwd(), "config.json"), "utf-8")
    );
} catch {
    console.error("❌ FATAL: Cannot read config.json");
    process.exit(1);
}

// Validate config with Zod - PANIC on validation failure
let cfg: z.infer<typeof ConfigSchema>;
try {
    cfg = ConfigSchema.parse(rawConfig);
} catch (error) {
    console.error("❌ FATAL: config.json validation failed");
    if (error instanceof z.ZodError) {
        console.error("Validation errors:");
        error.errors.forEach((err) => {
            console.error(`  - ${err.path.join(".")}: ${err.message}`);
        });
    }
    console.error("Fix config.json and restart. NO DEFAULTS, NO FALLBACKS.");
    process.exit(1);
}

/**
 * MANDATORY CONFIG VALIDATION - PANIC EXIT ON MISSING SETTINGS
 *
 * Per CLAUDE.md: "panic exit on startup if settings are missing; no bullshit anymore"
 */
function validateMandatoryConfig(): void {
    const errors: string[] = [];

    // Validate symbol configuration exists
    if (!cfg.symbol) {
        errors.push("MISSING: cfg.symbol is required");
    }

    // Validate symbols configuration
    if (!cfg.symbols || !cfg.symbols.LTCUSDT) {
        errors.push("MISSING: cfg.symbols.LTCUSDT configuration is required");
    }

    // Validate zone detectors configuration
    if (!cfg.zoneDetectors || !cfg.zoneDetectors.LTCUSDT) {
        errors.push(
            "MISSING: cfg.zoneDetectors.LTCUSDT configuration is required"
        );
    }

    if (cfg.symbols && cfg.symbols.LTCUSDT) {
        const symbolCfg = cfg.symbols.LTCUSDT;

        // Mandatory enhanced detector configurations - simplified validation
        if (!symbolCfg.exhaustion) {
            errors.push(
                "MISSING: symbols.LTCUSDT.exhaustion configuration is required"
            );
        }

        if (!symbolCfg.absorption) {
            errors.push(
                "MISSING: symbols.LTCUSDT.absorption configuration is required"
            );
        }

        if (!symbolCfg.deltaCvdConfirmation) {
            errors.push(
                "MISSING: symbols.LTCUSDT.deltaCvdConfirmation configuration is required"
            );
        }

        if (!symbolCfg.universalZoneConfig) {
            errors.push(
                "MISSING: symbols.LTCUSDT.universalZoneConfig is required"
            );
        }
    }

    // Validate zone detectors configuration
    if (!cfg.zoneDetectors || !cfg.zoneDetectors.LTCUSDT) {
        errors.push(
            "MISSING: cfg.zoneDetectors.LTCUSDT configuration is required"
        );
    } else {
        const zoneCfg = cfg.zoneDetectors.LTCUSDT;
        if (!zoneCfg.accumulation) {
            errors.push(
                "MISSING: zoneDetectors.LTCUSDT.accumulation configuration is required"
            );
        }

        if (!zoneCfg.distribution) {
            errors.push(
                "MISSING: zoneDetectors.LTCUSDT.distribution configuration is required"
            );
        }
    }

    // Validate enhanced zone formation config
    if (!cfg.enhancedZoneFormation) {
        errors.push(
            "MISSING: cfg.enhancedZoneFormation configuration is required"
        );
    }

    // PANIC EXIT if any required configuration is missing
    if (errors.length > 0) {
        console.error("🚨 CRITICAL CONFIG ERROR - PANIC EXIT");
        console.error("=".repeat(60));
        console.error("MANDATORY CONFIGURATION MISSING:");
        errors.forEach((error) => console.error(`  ❌ ${error}`));
        console.error("=".repeat(60));
        console.error("Per CLAUDE.md: All enhanced detector settings must be");
        console.error("explicitly configured in config.json with NO defaults.");
        console.error("=".repeat(60));
        process.exit(1);
    }

    console.log("✅ CONFIG VALIDATION PASSED - All mandatory settings present");
}

// Execute validation immediately after config load
validateMandatoryConfig();

let ENV_SYMBOL: string | undefined = process.env.SYMBOL?.toUpperCase();
let CONFIG_SYMBOL: AllowedSymbols = (ENV_SYMBOL ||
    cfg.symbol) as AllowedSymbols;
let SYMBOL_CFG = cfg.symbols[CONFIG_SYMBOL as keyof typeof cfg.symbols];
if (!SYMBOL_CFG) {
    console.error(
        `🚨 CRITICAL CONFIG ERROR: Symbol ${CONFIG_SYMBOL} configuration missing from config.json`
    );
    process.exit(1);
}

let DATASTREAM_CFG = SYMBOL_CFG.dataStream;

// Universal zone config from LTCUSDT symbol configuration
let UNIVERSAL_ZONE_CFG = SYMBOL_CFG.universalZoneConfig;
if (!UNIVERSAL_ZONE_CFG) {
    console.error(
        `🚨 CRITICAL CONFIG ERROR: universalZoneConfig configuration missing from symbols.LTCUSDT in config.json`
    );
    process.exit(1);
}

let ENHANCED_ZONE_CFG = cfg.enhancedZoneFormation;
if (!ENHANCED_ZONE_CFG) {
    console.error(
        `🚨 CRITICAL CONFIG ERROR: enhancedZoneFormation configuration missing from config.json`
    );
    process.exit(1);
}

/**
 * Centralized configuration management
 */

export class Config {
    // Symbol configuration
    static get SYMBOL(): AllowedSymbols {
        return CONFIG_SYMBOL;
    }
    static get PRICE_PRECISION(): number {
        return Number(SYMBOL_CFG.pricePrecision);
    }
    static get TICK_SIZE(): number {
        return 1 / Math.pow(10, Config.PRICE_PRECISION);
    }
    static get MAX_STORAGE_TIME(): number {
        return Number(cfg.maxStorageTime);
    }
    static get WINDOW_MS(): number {
        return Number(SYMBOL_CFG.windowMs);
    }

    // Server configuration
    static get HTTP_PORT(): number {
        return Number(cfg.httpPort);
    }
    static get WS_PORT(): number {
        return Number(cfg.wsPort);
    }
    static get MQTT(): MQTTConfig | undefined {
        return cfg.mqtt;
    }
    static get API_KEY(): string | undefined {
        return process.env.API_KEY;
    }
    static get API_SECRET(): string | undefined {
        return process.env.API_SECRET;
    }
    static get LLM_API_KEY(): string | undefined {
        return process.env.LLM_API_KEY;
    }
    static get LLM_MODEL(): string {
        return process.env.LLM_MODEL!;
    }
    static get NODE_ENV(): string {
        return cfg.nodeEnv;
    }
    static get ALERT_WEBHOOK_URL(): string | undefined {
        return cfg.alertWebhookUrl as string | undefined;
    }
    static get ALERT_COOLDOWN_MS(): number {
        return Number(cfg.alertCooldownMs);
    }

    static get PREPROCESSOR(): OrderflowPreprocessorOptions {
        return {
            symbol: Config.SYMBOL,
            pricePrecision: Config.PRICE_PRECISION,
            quantityPrecision: SYMBOL_CFG.quantityPrecision,
            bandTicks: SYMBOL_CFG.bandTicks,
            tickSize: Config.TICK_SIZE,
            largeTradeThreshold: SYMBOL_CFG.largeTradeThreshold,
            maxEventListeners: SYMBOL_CFG.maxEventListeners,
            // Dashboard update configuration
            dashboardUpdateInterval: SYMBOL_CFG.dashboardUpdateInterval,
            maxDashboardInterval: SYMBOL_CFG.maxDashboardInterval,
            significantChangeThreshold: SYMBOL_CFG.significantChangeThreshold,
        };
    }

    static get DATASTREAM(): DataStreamConfig {
        return {
            symbol: Config.SYMBOL,
            reconnectDelay: DATASTREAM_CFG.reconnectDelay,
            maxReconnectAttempts: DATASTREAM_CFG.maxReconnectAttempts,
            depthUpdateSpeed: DATASTREAM_CFG.depthUpdateSpeed,
            enableHeartbeat: DATASTREAM_CFG.enableHeartbeat,
            heartbeatInterval: DATASTREAM_CFG.heartbeatInterval,
            maxBackoffDelay: DATASTREAM_CFG.maxBackoffDelay,
            streamHealthTimeout: DATASTREAM_CFG.streamHealthTimeout,
            enableStreamHealthCheck: DATASTREAM_CFG.enableStreamHealthCheck,
            reconnectOnHealthFailure: DATASTREAM_CFG.reconnectOnHealthFailure,
            enableHardReload: DATASTREAM_CFG.enableHardReload,
            hardReloadAfterAttempts: DATASTREAM_CFG.hardReloadAfterAttempts,
            hardReloadCooldownMs: DATASTREAM_CFG.hardReloadCooldownMs,
            maxHardReloads: DATASTREAM_CFG.maxHardReloads,
            hardReloadRestartCommand: DATASTREAM_CFG.hardReloadRestartCommand,
        };
    }

    static get ORDERBOOK_STATE(): OrderBookStateOptions {
        return {
            symbol: Config.SYMBOL,
            pricePrecision: Config.PRICE_PRECISION,
            maxLevels: Number(cfg.symbols[cfg.symbol].orderBookState.maxLevels),
            maxPriceDistance: Number(
                cfg.symbols[cfg.symbol].orderBookState.maxPriceDistance
            ),
            pruneIntervalMs: Number(
                cfg.symbols[cfg.symbol].orderBookState.pruneIntervalMs
            ),
            maxErrorRate: Number(
                cfg.symbols[cfg.symbol].orderBookState.maxErrorRate
            ),
            staleThresholdMs: Number(
                cfg.symbols[cfg.symbol].orderBookState.staleThresholdMs
            ),
        };
    }

    static get TRADES_PROCESSOR(): TradesProcessorOptions {
        return {
            symbol: Config.SYMBOL,
            storageTime: Number(
                cfg.symbols[cfg.symbol].tradesProcessor.storageTime
            ),
            maxBacklogRetries: Number(
                cfg.symbols[cfg.symbol].tradesProcessor.maxBacklogRetries
            ),
            backlogBatchSize: Number(
                cfg.symbols[cfg.symbol].tradesProcessor.backlogBatchSize
            ),
            maxMemoryTrades: Number(
                cfg.symbols[cfg.symbol].tradesProcessor.maxMemoryTrades
            ),
            saveQueueSize: Number(
                cfg.symbols[cfg.symbol].tradesProcessor.saveQueueSize
            ),
            healthCheckInterval: Number(
                cfg.symbols[cfg.symbol].tradesProcessor.healthCheckInterval
            ),
        };
    }

    static get SIGNAL_MANAGER(): SignalManagerConfig {
        return {
            confidenceThreshold: Number(
                cfg.symbols[cfg.symbol].signalManager.confidenceThreshold
            ),
            signalTimeout: Number(
                cfg.symbols[cfg.symbol].signalManager.signalTimeout
            ),
            enableMarketHealthCheck:
                cfg.symbols[cfg.symbol].signalManager.enableMarketHealthCheck,
            enableAlerts: cfg.symbols[cfg.symbol].signalManager.enableAlerts,
        };
    }

    static get DETECTOR_CONFIDENCE_THRESHOLDS(): Record<string, number> {
        return cfg.symbols[cfg.symbol].signalManager.detectorThresholds;
    }

    static get DETECTOR_POSITION_SIZING(): Record<string, number> {
        return cfg.symbols[cfg.symbol].signalManager.positionSizing;
    }

    static get SIGNAL_COORDINATOR(): SignalCoordinatorConfig {
        return {
            maxConcurrentProcessing: Number(
                cfg.symbols[cfg.symbol].signalCoordinator
                    .maxConcurrentProcessing
            ),
            processingTimeoutMs: Number(
                cfg.symbols[cfg.symbol].signalCoordinator.processingTimeoutMs
            ),
            retryAttempts: Number(
                cfg.symbols[cfg.symbol].signalCoordinator.retryAttempts
            ),
            retryDelayMs: Number(
                cfg.symbols[cfg.symbol].signalCoordinator.retryDelayMs
            ),
            enableMetrics:
                cfg.symbols[cfg.symbol].signalCoordinator.enableMetrics,
            logLevel: cfg.symbols[cfg.symbol].signalCoordinator.logLevel,
        };
    }

    static get ORDERBOOK_PROCESSOR(): OrderBookProcessorOptions {
        const precision = Config.PRICE_PRECISION;
        const tickSize = 1 / Math.pow(10, precision);
        return {
            binSize: Number(cfg.symbols[cfg.symbol].orderBookProcessor.binSize),
            numLevels: Number(
                cfg.symbols[cfg.symbol].orderBookProcessor.numLevels
            ),
            maxBufferSize: Number(
                cfg.symbols[cfg.symbol].orderBookProcessor.maxBufferSize
            ),
            tickSize: tickSize,
            precision: precision,
        };
    }

    // Universal zone configuration (shared by ALL detectors)
    static get UNIVERSAL_ZONE_CONFIG() {
        return UNIVERSAL_ZONE_CFG;
    }

    // Individual detector configurations
    static get EXHAUSTION_CONFIG() {
        return SYMBOL_CFG.exhaustion;
    }
    static get ABSORPTION_CONFIG() {
        return SYMBOL_CFG.absorption;
    }
    static get DELTACVD_CONFIG() {
        return SYMBOL_CFG.deltaCvdConfirmation;
    }
    static get ACCUMULATION_CONFIG() {
        return SYMBOL_CFG.accumulation;
    }
    static get DISTRIBUTION_CONFIG() {
        return SYMBOL_CFG.distribution;
    }

    // Distribution detector with schema validation
    static get DISTRIBUTION_DETECTOR() {
        return this.validateDetectorConfig(
            DistributionDetectorSchema,
            SYMBOL_CFG.distribution,
            "DISTRIBUTION_DETECTOR"
        );
    }

    // 🚨 NUCLEAR CLEANUP: Zero tolerance configuration validation helpers
    private static validateDetectorConfig<T>(
        schema: z.ZodSchema<T>,
        config: unknown,
        detectorName: string
    ): T {
        try {
            return schema.parse(config);
        } catch (error) {
            // POLICY OVERRIDE: Use console.error for critical config failures
            // This is a system panic situation that requires immediate visibility
            console.error(`🚨 CRITICAL CONFIG ERROR - ${detectorName}`);
            console.error("Missing mandatory configuration properties:");
            console.error(error);
            console.error(
                "Per CLAUDE.md: NO DEFAULTS, NO FALLBACKS, NO BULLSHIT"
            );
            process.exit(1);
        }
    }

    // Enhanced detector configurations - validated Zod schemas
    static get ABSORPTION_DETECTOR() {
        return this.validateDetectorConfig(
            AbsorptionDetectorSchema,
            SYMBOL_CFG.absorption,
            "AbsorptionDetectorEnhanced"
        );
    }

    static get EXHAUSTION_DETECTOR() {
        return this.validateDetectorConfig(
            ExhaustionDetectorSchema,
            SYMBOL_CFG.exhaustion,
            "ExhaustionDetectorEnhanced"
        );
    }

    static get DELTACVD_DETECTOR() {
        return this.validateDetectorConfig(
            DeltaCVDDetectorSchema,
            SYMBOL_CFG.deltaCvdConfirmation,
            "DeltaCVDDetectorEnhanced"
        );
    }

    static get ACCUMULATION_DETECTOR() {
        return this.validateDetectorConfig(
            AccumulationDetectorSchema,
            SYMBOL_CFG.accumulation,
            "AccumulationZoneDetectorEnhanced"
        );
    }

    static get DISTRIBUTION_ZONE_DETECTOR() {
        return this.validateDetectorConfig(
            DistributionDetectorSchema,
            SYMBOL_CFG.distribution,
            "DistributionDetectorEnhanced"
        );
    }

    static get SUPPORT_RESISTANCE_DETECTOR(): SupportResistanceConfig {
        return {
            priceTolerancePercent: Number(
                cfg.symbols[cfg.symbol].supportResistanceDetector
                    .priceTolerancePercent
            ),
            minTouchCount:
                cfg.symbols[cfg.symbol].supportResistanceDetector.minTouchCount,
            minStrength: Number(
                cfg.symbols[cfg.symbol].supportResistanceDetector.minStrength
            ),
            timeWindowMs: Number(
                cfg.symbols[cfg.symbol].supportResistanceDetector.timeWindowMs
            ),
            volumeWeightFactor: Number(
                cfg.symbols[cfg.symbol].supportResistanceDetector
                    .volumeWeightFactor
            ),
            rejectionConfirmationTicks: Number(
                cfg.symbols[cfg.symbol].supportResistanceDetector
                    .rejectionConfirmationTicks
            ),
        };
    }

    static get INDIVIDUAL_TRADES_MANAGER(): IndividualTradesManagerConfig {
        return {
            enabled: process.env.INDIVIDUAL_TRADES_ENABLED === "true" || false,

            criteria: {
                minOrderSizePercentile: Number(
                    process.env.INDIVIDUAL_TRADES_SIZE_PERCENTILE ?? 95
                ),
                keyLevelsEnabled:
                    process.env.INDIVIDUAL_TRADES_KEY_LEVELS === "true" ||
                    false,
                anomalyPeriodsEnabled:
                    process.env.INDIVIDUAL_TRADES_ANOMALY_PERIODS === "true" ||
                    true,
                highVolumePeriodsEnabled:
                    process.env.INDIVIDUAL_TRADES_HIGH_VOLUME === "true" ||
                    true,
            },

            cache: {
                maxSize: Number(
                    process.env.INDIVIDUAL_TRADES_CACHE_SIZE ?? 10000
                ),
                ttlMs: Number(
                    process.env.INDIVIDUAL_TRADES_CACHE_TTL ?? 300000
                ), // 5 minutes
            },

            rateLimit: {
                maxRequestsPerSecond: Number(
                    process.env.INDIVIDUAL_TRADES_RATE_LIMIT ?? 5
                ),
                batchSize: Number(
                    process.env.INDIVIDUAL_TRADES_BATCH_SIZE ?? 100
                ),
            },
        };
    }

    static get MICROSTRUCTURE_ANALYZER(): MicrostructureAnalyzerConfig {
        return {
            burstThresholdMs: Number(
                process.env.MICROSTRUCTURE_BURST_THRESHOLD ?? 100
            ),
            uniformityThreshold: Number(
                process.env.MICROSTRUCTURE_UNIFORMITY_THRESHOLD ?? 0.2
            ),
            sizingConsistencyThreshold: Number(
                process.env.MICROSTRUCTURE_SIZING_THRESHOLD ?? 0.15
            ),
            persistenceWindowSize: Number(
                process.env.MICROSTRUCTURE_PERSISTENCE_WINDOW ?? 5
            ),
            marketMakingSpreadThreshold: Number(
                process.env.MICROSTRUCTURE_MM_SPREAD_THRESHOLD ?? 0.01
            ),
            icebergSizeRatio: Number(
                process.env.MICROSTRUCTURE_ICEBERG_RATIO ?? 0.8
            ),
            arbitrageTimeThreshold: Number(
                process.env.MICROSTRUCTURE_ARBITRAGE_TIME ?? 50
            ),
        };
    }

    static get SPOOFING_DETECTOR(): SpoofingDetectorConfig {
        return {
            tickSize: this.TICK_SIZE,
            wallTicks: Number(
                cfg.symbols[cfg.symbol].spoofingDetector.wallTicks
            ),
            minWallSize: Number(
                cfg.symbols[cfg.symbol].spoofingDetector.minWallSize
            ),
            dynamicWallWidth:
                cfg.symbols[cfg.symbol].spoofingDetector.dynamicWallWidth,
            testLogMinSpoof: Number(
                cfg.symbols[cfg.symbol].spoofingDetector.testLogMinSpoof
            ),
        };
    }

    static get ANOMALY_DETECTOR(): AnomalyDetectorOptions {
        return {
            windowSize: Number(
                cfg.symbols[cfg.symbol].anomalyDetector.windowSize
            ),
            anomalyCooldownMs: Number(
                cfg.symbols[cfg.symbol].anomalyDetector.anomalyCooldownMs
            ),
            volumeImbalanceThreshold: Number(
                cfg.symbols[cfg.symbol].anomalyDetector.volumeImbalanceThreshold
            ),
            normalSpreadBps: Number(
                cfg.symbols[cfg.symbol].anomalyDetector.normalSpreadBps
            ),
            minHistory: Number(
                cfg.symbols[cfg.symbol].anomalyDetector.minHistory
            ),
            tickSize: this.TICK_SIZE,
            flowWindowMs: Number(
                cfg.symbols[cfg.symbol].anomalyDetector.flowWindowMs
            ),
            orderSizeWindowMs: Number(
                cfg.symbols[cfg.symbol].anomalyDetector.orderSizeWindowMs
            ),
            volatilityThreshold: Number(
                cfg.symbols[cfg.symbol].anomalyDetector.volatilityThreshold
            ),
            spreadThresholdBps: Number(
                cfg.symbols[cfg.symbol].anomalyDetector.spreadThresholdBps
            ),
            extremeVolatilityWindowMs: Number(
                cfg.symbols[cfg.symbol].anomalyDetector
                    .extremeVolatilityWindowMs
            ),
            liquidityCheckWindowMs: Number(
                cfg.symbols[cfg.symbol].anomalyDetector.liquidityCheckWindowMs
            ),
            whaleCooldownMs: Number(
                cfg.symbols[cfg.symbol].anomalyDetector.whaleCooldownMs
            ),
            marketHealthWindowMs: Number(
                cfg.symbols[cfg.symbol].anomalyDetector.marketHealthWindowMs
            ),
        };
    }

    static get ICEBERG_DETECTOR(): Partial<IcebergDetectorConfig> {
        const icebergConfig = cfg.symbols[cfg.symbol].icebergDetector;
        return {
            minRefillCount: Number(icebergConfig.minRefillCount),
            maxSizeVariation: Number(icebergConfig.maxSizeVariation),
            minTotalSize: Number(icebergConfig.minTotalSize),
            maxRefillTimeMs: Number(icebergConfig.maxRefillTimeMs),
            priceStabilityTolerance: Number(
                icebergConfig.priceStabilityTolerance
            ),
            institutionalSizeThreshold: Number(
                icebergConfig.institutionalSizeThreshold
            ),
            trackingWindowMs: Number(icebergConfig.trackingWindowMs),
            maxActiveIcebergs: Number(icebergConfig.maxActiveIcebergs),
        };
    }

    static get HIDDEN_ORDER_DETECTOR(): Partial<HiddenOrderDetectorConfig> {
        const hiddenOrderConfig = cfg.symbols[cfg.symbol].hiddenOrderDetector;
        return {
            minHiddenVolume: Number(hiddenOrderConfig.minHiddenVolume),
            minTradeSize: Number(hiddenOrderConfig.minTradeSize),
            priceTolerance: Number(hiddenOrderConfig.priceTolerance),
            maxDepthAgeMs: Number(hiddenOrderConfig.maxDepthAgeMs),
            minConfidence: Number(hiddenOrderConfig.minConfidence),
            zoneHeightPercentage: Number(
                hiddenOrderConfig.zoneHeightPercentage
            ),
        };
    }

    // ✅ Enhanced zone formation configuration (replaces magic numbers)
    static get ENHANCED_ZONE_FORMATION(): EnhancedZoneFormationConfig {
        return ENHANCED_ZONE_CFG;
    }

    // Market Data Storage configuration for backtesting
    static get marketDataStorage(): MarketDataStorageConfig | null {
        return cfg.marketDataStorage || null;
    }

    /**
     * Validate configuration on startup
     */
    static validate(): void {
        if (!this.SYMBOL) {
            throw new Error("Missing SYMBOL configuration");
        }

        if (this.HTTP_PORT < 1 || this.HTTP_PORT > 65535) {
            throw new Error(`Invalid HTTP_PORT: ${this.HTTP_PORT}`);
        }

        if (this.WS_PORT < 1 || this.WS_PORT > 65535) {
            throw new Error(`Invalid WS_PORT: ${this.WS_PORT}`);
        }
    }
}
