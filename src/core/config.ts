// src/core/config.ts
import dotenv from "dotenv";
dotenv.config();
import { readFileSync } from "fs";
import { resolve } from "path";
import { z } from "zod";
import { AnomalyDetectorOptions } from "../services/anomalyDetector.js";
import { SpoofingDetectorConfig } from "../services/spoofingDetector.js";
import type { HiddenOrderDetectorConfig } from "../services/hiddenOrderDetector.js";
import { OrderBookStateOptions } from "../market/orderBookState.js";
import type {
    AllowedSymbols,
    MarketDataStorageConfig,
} from "../types/configTypes.js";
import type { OrderflowPreprocessorOptions } from "../market/orderFlowPreprocessor.js";
import type { DataStreamConfig } from "../trading/dataStreamManager.js";
import type { IndividualTradesManagerConfig } from "../data/individualTradesManager.js";
import type { MicrostructureAnalyzerConfig } from "../data/microstructureAnalyzer.js";
import type { TradesProcessorOptions } from "../market/processors/tradesProcessor.js";
import type { SignalManagerConfig } from "../trading/signalManager.js";
import type { SignalCoordinatorConfig } from "../services/signalCoordinator.js";
import type { OrderBookProcessorOptions } from "../market/processors/orderBookProcessor.js";
import type { MQTTConfig } from "../types/configTypes.js";

// FUTURE-PROOF: Symbol-agnostic validation schemas with mathematical ranges

// Type for detector configurations - use the exact Zod inferred types for the enhanced settings
type DetectorConfigInput =
    | z.infer<typeof AbsorptionEnhancedSettingsSchema>
    | z.infer<typeof ExhaustionEnhancedSettingsSchema>
    | z.infer<typeof DeltaCVDDetectorSchema>
    | z.infer<typeof AccumulationDetectorSchema>
    | z.infer<typeof DistributionDetectorSchema>
    | z.infer<typeof SimpleIcebergDetectorSchema>;

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

// ============================================================================
// STANDARDIZED ZONE CONFIG - Zone volume aggregation for CVD detectors
// ============================================================================
export const StandardZoneConfigSchema = z.object({
    // CLAUDE.md SIMPLIFIED: Single zone configuration
    zoneTicks: z.number().int().min(1).max(50), // Zone size in ticks (configured to 10)
    timeWindows: z.array(z.number().int().min(60000).max(7200000)), // Time windows [5min, 15min, etc]
    adaptiveMode: z.boolean(), // Enable dynamic zone sizing

    // Volume thresholds (LTCUSDT data-driven values)
    volumeThresholds: z.object({
        aggressive: z.number().min(1.0).max(1000.0), // Aggressive volume threshold
        passive: z.number().min(0.5).max(500.0), // Passive volume threshold
        institutional: z.number().min(10.0).max(5000.0), // Institutional volume threshold
    }),

    // Price thresholds
    priceThresholds: z.object({
        tickValue: z.number().min(0.0001).max(1.0), // Value of one tick
        minZoneWidth: z.number().min(0.001).max(0.1), // Minimum zone width
        maxZoneWidth: z.number().min(0.01).max(1.0), // Maximum zone width
    }),

    // Performance configuration
    performanceConfig: z.object({
        maxZoneHistory: z.number().int().min(100).max(10000), // Max zones to keep in history
        cleanupInterval: z.number().int().min(300000).max(7200000), // Cleanup interval (5min-2h)
        maxMemoryMB: z.number().int().min(10).max(500), // Max memory usage
    }),
});

// EXHAUSTION detector - CLEANED UP - Only used settings remain (16 core parameters)
export const ExhaustionDetectorSchema = z.object({
    // Core detection
    minAggVolume: z.number().int().min(1).max(100000),
    timeWindowIndex: z.number().int().min(0).max(5),
    exhaustionThreshold: z.number().min(0.01).max(1.0),
    eventCooldownMs: z.number().int().min(1000).max(300000),

    // Enhancement control
    useStandardizedZones: z.boolean(),
    enhancementMode: z.enum(["disabled", "monitoring", "production"]),
    minEnhancedConfidenceThreshold: z.number().min(0.01).max(0.8),

    // Enhanced depletion analysis
    depletionVolumeThreshold: z.number().min(10).max(100000),
    depletionRatioThreshold: z.number().min(-1.0).max(0),
    enableDepletionAnalysis: z.boolean(),
    depletionConfidenceBoost: z.number().min(0.05).max(0.3),

    // Dynamic zone tracking for true exhaustion detection
    enableDynamicZoneTracking: z.boolean(),
    maxZonesPerSide: z.number().int().min(1).max(10),
    zoneDepletionThreshold: z.number().min(0.5).max(0.95),
    gapDetectionTicks: z.number().int().min(1).max(10),

    // Cross-timeframe calculations
    varianceReductionFactor: z.number().min(0.5).max(3.0),
    alignmentNormalizationFactor: z.number().min(0.2).max(3.0),
    passiveVolumeExhaustionRatio: z.number().min(0.3).max(2.0),
    aggressiveVolumeExhaustionThreshold: z.number().min(0.001).max(0.5),
    aggressiveVolumeReductionFactor: z.number().min(0.3).max(0.8),

    // Additional configurable thresholds to replace magic numbers
    passiveRatioBalanceThreshold: z.number().min(0.3).max(0.7), // Replace hardcoded 0.5
    premiumConfidenceThreshold: z.number().min(0.6).max(0.9), // Replace hardcoded 0.7
    variancePenaltyFactor: z.number().min(0.5).max(1.5), // Replace hardcoded variance calculation
    ratioBalanceCenterPoint: z.number().min(0.4).max(0.6), // Replace hardcoded 0.5 center points
});

// ABSORPTION detector - CLEANED UP - Only used settings remain
export const AbsorptionDetectorSchema = z.object({
    // Core detection
    minAggVolume: z.number().int().min(1).max(100000),
    timeWindowIndex: z.number().int().min(0).max(5), // Index into preprocessor timeWindows array
    eventCooldownMs: z.number().int().min(1000).max(60000),

    // Absorption thresholds
    priceEfficiencyThreshold: z.number().min(0.0001).max(0.1),
    maxAbsorptionRatio: z.number().min(0.1).max(1.0),
    minPassiveMultiplier: z.number().min(0.5).max(5.0),
    passiveAbsorptionThreshold: z.number().min(0.1).max(50),

    // Calculation parameters
    expectedMovementScalingFactor: z.number().int().min(1).max(100),
    contextConfidenceBoostMultiplier: z.number().min(0.1).max(1.0),
    liquidityGradientRange: z.number().int().min(1).max(20),

    // Institutional analysis
    institutionalVolumeThreshold: z.number().min(100).max(100000),
    institutionalVolumeRatioThreshold: z.number().min(1).max(50),
    enableInstitutionalVolumeFilter: z.boolean(),
    institutionalVolumeBoost: z.number().min(0.05).max(0.3),

    // Confidence and scoring
    minAbsorptionScore: z.number().min(0.3).max(0.99),
    finalConfidenceRequired: z.number().min(0.1).max(3.0),
    confidenceBoostReduction: z.number().min(0.3).max(0.8),
    maxZoneCountForScoring: z.number().int().min(1).max(10),
    minEnhancedConfidenceThreshold: z.number().min(0.01).max(0.8),

    // Enhancement control
    useStandardizedZones: z.boolean(),
    enhancementMode: z.enum(["disabled", "testing", "production"]),

    // Balance detection threshold
    balanceThreshold: z.number().min(0.01).max(0.75),

    // Zone confluence parameters (CLAUDE.md compliance - no magic numbers)
    confluenceMinZones: z.number().int().min(1).max(10),
    confluenceMaxDistance: z.number().int().min(1).max(20),
});

// DELTACVD detector - CLEANED UP - Only used settings remain
export const DeltaCVDDetectorSchema = z.object({
    // Core CVD analysis parameters (actually used by detector)
    minTradesPerSec: z.number().min(0.001).max(5.0),
    minVolPerSec: z.number().min(0.01).max(2000.0),
    signalThreshold: z.number().min(0.01).max(8.0),
    eventCooldownMs: z.number().int().min(1000).max(1800000),

    // Zone time window configuration
    timeWindowIndex: z.number().int().min(0).max(5),

    // Zone enhancement control
    enhancementMode: z.enum(["disabled", "monitoring", "production"]),

    // CVD divergence analysis parameters
    cvdImbalanceThreshold: z.number().min(0.05).max(0.4), // CVD imbalance ratio for detection (lower than signalThreshold)

    // Institutional trade threshold (replace hardcoded 17.8 LTC)
    institutionalThreshold: z.number().min(0.001).max(5.0), // LTC threshold for institutional trade detection

    // Volume efficiency threshold for quality flag
    volumeEfficiencyThreshold: z.number().min(0.1).max(0.5),
});

// ACCUMULATION detector - CLEANED UP - Only used settings remain
export const AccumulationDetectorSchema = z.object({
    // Core parameters
    enhancementMode: z.enum(["disabled", "testing", "production"]),

    // Signal deduplication parameter (CLAUDE.md compliance - no magic numbers)
    eventCooldownMs: z.number().int().min(1000).max(60000),

    // Single confidence threshold (replaces multiple thresholds)
    confidenceThreshold: z.number().min(0.1).max(0.9),

    // Zone confluence parameters
    confluenceMinZones: z.number().int().min(1).max(10),
    confluenceMaxDistance: z.number().min(0.01).max(1.0),
    confluenceConfidenceBoost: z.number().min(0.05).max(0.3),
    crossTimeframeConfidenceBoost: z.number().min(0.05).max(0.3),

    // Accumulation detection parameters
    accumulationVolumeThreshold: z.number().min(1).max(1000),
    accumulationRatioThreshold: z.number().min(0.3).max(0.9),
    alignmentScoreThreshold: z.number().min(0.3).max(0.8),

    // Financial calculation parameters
    defaultDurationMs: z.number().int().min(30000).max(600000),
    maxPriceSupport: z.number().min(0.5).max(5.0),
    priceSupportMultiplier: z.number().min(1.0).max(10.0),
    minPassiveVolumeForEfficiency: z.number().min(1).max(100),
    defaultVolatility: z.number().min(0.01).max(0.5),
    defaultBaselineVolatility: z.number().min(0.01).max(0.3),

    // Accumulation-specific calculations
    confluenceStrengthDivisor: z.number().min(1).max(10),
    passiveToAggressiveRatio: z.number().min(0.3).max(2.0),
});

// DISTRIBUTION detector - CLEANED UP - Only used settings remain
export const DistributionDetectorSchema = z.object({
    // Core parameters
    enhancementMode: z.enum(["disabled", "testing", "production"]),

    // Signal deduplication parameter (CLAUDE.md compliance - no magic numbers)
    eventCooldownMs: z.number().int().min(1000).max(60000),

    // Single confidence threshold (replaces multiple thresholds)
    confidenceThreshold: z.number().min(0.1).max(0.9),

    // Zone confluence parameters
    confluenceMinZones: z.number().int().min(1).max(10),
    confluenceMaxDistance: z.number().min(0.01).max(1.0),
    confluenceConfidenceBoost: z.number().min(0.05).max(0.3),
    crossTimeframeConfidenceBoost: z.number().min(0.05).max(0.3),

    // Distribution detection parameters
    distributionVolumeThreshold: z.number().min(1).max(1000),
    distributionRatioThreshold: z.number().min(0.3).max(0.9),
    alignmentScoreThreshold: z.number().min(0.3).max(0.8),

    // Financial calculation parameters
    defaultDurationMs: z.number().int().min(30000).max(600000),
    maxPriceResistance: z.number().min(0.5).max(5.0),
    priceResistanceMultiplier: z.number().min(1.0).max(10.0),
    minPassiveVolumeForEfficiency: z.number().min(1).max(100),
    defaultVolatility: z.number().min(0.01).max(0.5),
    defaultBaselineVolatility: z.number().min(0.01).max(0.3),
});

// SIMPLE ICEBERG detector - CLAUDE.md COMPLIANT - Zero tolerance for magic numbers
export const SimpleIcebergDetectorSchema = z.object({
    // Core parameters
    enhancementMode: z.enum(["disabled", "testing", "production"]),

    // Pattern detection parameters - EXACT matching only
    minOrderCount: z.number().int().min(2).max(1000), // Min identical orders to qualify
    minTotalSize: z.number().min(10).max(100000000), // Min total volume for significance (starts at 10 LTC)

    // Timing parameters
    timeWindowIndex: z.number().int().min(0).max(5), // Index into preprocessor timeWindows array
    maxOrderGapMs: z.number().int().min(100).max(3600000), // Max gap between orders

    // Performance parameters
    maxActivePatterns: z.number().int().min(5).max(10000), // Memory management
    maxRecentTrades: z.number().int().min(10).max(10000), // Recent trades buffer for order book analysis
});

// Old schemas removed - using simplified AccumulationDetectorSchema and DistributionDetectorSchema above

// Use the main ExhaustionDetectorSchema directly - no separate enhanced schema needed
const ExhaustionEnhancedSettingsSchema = ExhaustionDetectorSchema;

// Use the main AbsorptionDetectorSchema directly - no separate enhanced schema needed
const AbsorptionEnhancedSettingsSchema = AbsorptionDetectorSchema;

// Remove duplicate schema - use DeltaCVDDetectorSchema directly

// ============================================================================
// MICROSTRUCTURE ANALYZER CONFIG - Algorithmic trading pattern detection
// ============================================================================
export const MicrostructureAnalyzerSchema = z.object({
    // Timing analysis thresholds
    burstThresholdMs: z.number().int().min(10).max(1000), // 10ms-1s coordinated trades
    uniformityThreshold: z.number().min(0.1).max(0.5), // CV threshold for uniform timing

    // Fragmentation analysis
    sizingConsistencyThreshold: z.number().min(0.05).max(0.3), // CV threshold for consistent sizing

    // Toxicity analysis
    persistenceWindowSize: z.number().int().min(3).max(20), // Number of trades for persistence

    // Algorithmic pattern detection
    marketMakingSpreadThreshold: z.number().min(0.001).max(0.1), // Price spread threshold
    icebergSizeRatio: z.number().min(0.5).max(0.95), // Ratio threshold for iceberg detection
    arbitrageTimeThreshold: z.number().int().min(10).max(500), // Max time for arbitrage detection
});

// ============================================================================
// INDIVIDUAL TRADES MANAGER CONFIG - High-value trade individual data fetching
// ============================================================================
export const IndividualTradesManagerSchema = z.object({
    // Feature enablement
    enabled: z.boolean(),

    // Selective fetching criteria
    criteria: z.object({
        minOrderSizePercentile: z.number().int().min(50).max(99), // 50-99th percentile
        keyLevelsEnabled: z.boolean(), // Fetch at support/resistance levels
        anomalyPeriodsEnabled: z.boolean(), // Fetch during anomaly detection
        highVolumePeriodsEnabled: z.boolean(), // Fetch during high activity periods
    }),

    // Performance tuning
    cache: z.object({
        maxSize: z.number().int().min(1000).max(100000), // 1K-100K cached trades
        ttlMs: z.number().int().min(60000).max(3600000), // 1min-1hour TTL
    }),

    // API rate limiting
    rateLimit: z.object({
        maxRequestsPerSecond: z.number().int().min(1).max(10), // 1-10 req/sec (Binance limits)
        batchSize: z.number().int().min(10).max(1000), // 10-1000 trades per API call
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
        preprocessor: z.object({
            defaultZoneMultipliers: z.array(z.number().int().positive()),
            defaultTimeWindows: z.array(z.number().int().positive()),
            defaultMinZoneWidthMultiplier: z.number().int().positive(),
            defaultMaxZoneWidthMultiplier: z.number().int().positive(),
            defaultMaxZoneHistory: z.number().int().positive(),
            defaultMaxMemoryMB: z.number().int().positive(),
            defaultAggressiveVolumeAbsolute: z.number().positive(),
            defaultPassiveVolumeAbsolute: z.number().positive(),
            defaultInstitutionalVolumeAbsolute: z.number().positive(),
            maxTradesPerZone: z.number().int().positive(),
        }),
        signalManager: z.object({
            confidenceThreshold: z.number().positive(),
            signalTimeout: z.number().int().positive(),
            enableMarketHealthCheck: z.boolean(),
            enableAlerts: z.boolean(),
            maxQueueSize: z.number().int().positive(),
            processingBatchSize: z.number().int().positive(),
            backpressureThreshold: z.number().int().positive(),
            enableSignalPrioritization: z.boolean(),
            adaptiveBatchSizing: z.boolean(),
            maxAdaptiveBatchSize: z.number().int().positive(),
            minAdaptiveBatchSize: z.number().int().positive(),
            circuitBreakerThreshold: z.number().int().positive(),
            circuitBreakerResetMs: z.number().int().positive(),
            adaptiveBackpressure: z.boolean(),
            highPriorityBypassThreshold: z.number().positive(),
            signalTypePriorities: z.record(z.number()),
            detectorThresholds: z.record(z.number()),
            positionSizing: z.record(z.number()),
            conflictResolution: z.object({
                enabled: z.boolean(),
                strategy: z.enum([
                    "confidence_weighted",
                    "priority_based",
                    "market_context",
                ]),
                minimumSeparationMs: z.number().int().positive(),
                contradictionPenaltyFactor: z.number().min(0).max(1),
                priceTolerance: z.number().positive(),
                volatilityNormalizationFactor: z.number().positive(),
            }),
            signalPriorityMatrix: z.object({
                highVolatility: z.record(z.number().min(0).max(1)),
                lowVolatility: z.record(z.number().min(0).max(1)),
                balanced: z.record(z.number().min(0).max(1)),
            }),
            // 🔧 Configurable parameters to eliminate magic numbers (REQUIRED)
            correlationBoostFactor: z.number().min(0.1).max(2.0),
            priceTolerancePercent: z.number().min(0.01).max(10.0),
            signalThrottleMs: z.number().int().min(1000).max(60000),
            correlationWindowMs: z.number().int().min(60000).max(3600000),
            maxHistorySize: z.number().int().min(10).max(1000),
            defaultPriority: z.number().min(1).max(10),
            volatilityHighThreshold: z.number().min(0.01).max(0.5),
            volatilityLowThreshold: z.number().min(0.001).max(0.1),
            defaultLowVolatility: z.number().min(0.001).max(0.1),
            defaultVolatilityError: z.number().min(0.01).max(0.2),
            contextBoostHigh: z.number().min(0.05).max(0.5),
            contextBoostLow: z.number().min(0.05).max(0.3),
            priorityQueueHighThreshold: z.number().min(5.0).max(10.0),
            backpressureYieldMs: z.number().int().min(1).max(100),
            marketVolatilityWeight: z.number().min(0.1).max(1.0),
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
            minHistory: z.number().int().min(2).positive(),
            flowWindowMs: z.number().int().positive(),
            orderSizeWindowMs: z.number().int().positive(),
            volatilityThreshold: z.number().positive(),
            spreadThresholdBps: z.number().positive(),
            extremeVolatilityWindowMs: z.number().int().positive(),
            liquidityCheckWindowMs: z.number().int().positive(),
            whaleCooldownMs: z.number().int().positive(),
            marketHealthWindowMs: z.number().int().positive(),
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
        deltaCVD: DeltaCVDDetectorSchema,
        universalZoneConfig: UniversalZoneSchema,
        accumulation: AccumulationDetectorSchema,
        distribution: DistributionDetectorSchema,
        simpleIceberg: SimpleIcebergDetectorSchema,
    })
    .passthrough();

const ConfigSchema = z.object({
    nodeEnv: z.string(),
    symbol: z.enum(["LTCUSDT"]),
    symbols: z.record(BasicSymbolConfigSchema),
    httpPort: z.number().int().positive(),
    wsPort: z.number().int().positive(),
    alertWebhookUrl: z.string().url(),
    alertCooldownMs: z.number().int().positive(),
    maxStorageTime: z.number().int().positive(),
    mqtt: MQTTConfigSchema.optional(),
    marketDataStorage: MarketDataStorageConfigSchema.optional(),
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
    if (!cfg.symbols || !cfg.symbols["LTCUSDT"]) {
        errors.push("MISSING: cfg.symbols.LTCUSDT configuration is required");
    }

    if (cfg.symbols && cfg.symbols["LTCUSDT"]) {
        const symbolCfg = cfg.symbols["LTCUSDT"];

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

        if (!symbolCfg.deltaCVD) {
            errors.push(
                "MISSING: symbols.LTCUSDT.deltaCVD configuration is required"
            );
        }

        if (!symbolCfg.accumulation) {
            errors.push(
                "MISSING: symbols.LTCUSDT.accumulation configuration is required"
            );
        }

        if (!symbolCfg.distribution) {
            errors.push(
                "MISSING: symbols.LTCUSDT.distribution configuration is required"
            );
        }

        if (!symbolCfg.universalZoneConfig) {
            errors.push(
                "MISSING: symbols.LTCUSDT.universalZoneConfig is required"
            );
        }
    }

    // Validate enhanced zone formation config

    // 🚨 CRITICAL: Validate ALL detector configurations at startup (not lazily)
    // This ensures process.exit(1) happens immediately for ANY validation failures
    // including missing properties AND out-of-range values
    if (SYMBOL_CFG) {
        try {
            AbsorptionDetectorSchema.parse(SYMBOL_CFG.absorption);
        } catch (error) {
            console.error(
                "🚨 CRITICAL CONFIG ERROR - AbsorptionDetectorEnhanced"
            );
            console.error("Missing mandatory configuration properties:");
            console.error(error);
            console.error(
                "Per CLAUDE.md: NO DEFAULTS, NO FALLBACKS, NO BULLSHIT"
            );
            process.exit(1);
        }

        try {
            ExhaustionDetectorSchema.parse(SYMBOL_CFG.exhaustion);
        } catch (error) {
            console.error(
                "🚨 CRITICAL CONFIG ERROR - ExhaustionDetectorEnhanced"
            );
            console.error("Missing mandatory configuration properties:");
            console.error(error);
            console.error(
                "Per CLAUDE.md: NO DEFAULTS, NO FALLBACKS, NO BULLSHIT"
            );
            process.exit(1);
        }

        try {
            DeltaCVDDetectorSchema.parse(SYMBOL_CFG.deltaCVD);
        } catch (error) {
            console.error(
                "🚨 CRITICAL CONFIG ERROR - DeltaCVDDetectorEnhanced"
            );
            console.error("Missing mandatory configuration properties:");
            console.error(error);
            console.error(
                "Per CLAUDE.md: NO DEFAULTS, NO FALLBACKS, NO BULLSHIT"
            );
            process.exit(1);
        }

        try {
            AccumulationDetectorSchema.parse(SYMBOL_CFG.accumulation);
        } catch (error) {
            console.error(
                "🚨 CRITICAL CONFIG ERROR - AccumulationZoneDetectorEnhanced"
            );
            console.error("Missing mandatory configuration properties:");
            console.error(error);
            console.error(
                "Per CLAUDE.md: NO DEFAULTS, NO FALLBACKS, NO BULLSHIT"
            );
            process.exit(1);
        }

        try {
            DistributionDetectorSchema.parse(SYMBOL_CFG.distribution);
        } catch (error) {
            console.error(
                "🚨 CRITICAL CONFIG ERROR - DistributionDetectorEnhanced"
            );
            console.error("Missing mandatory configuration properties:");
            console.error(error);
            console.error(
                "Per CLAUDE.md: NO DEFAULTS, NO FALLBACKS, NO BULLSHIT"
            );
            process.exit(1);
        }

        try {
            MicrostructureAnalyzerSchema.parse(
                SYMBOL_CFG["microstructureAnalyzer"]
            );
        } catch (error) {
            console.error("🚨 CRITICAL CONFIG ERROR - MicrostructureAnalyzer");
            console.error("Missing mandatory configuration properties:");
            console.error(error);
            console.error(
                "Per CLAUDE.md: NO DEFAULTS, NO FALLBACKS, NO BULLSHIT"
            );
            process.exit(1);
        }

        try {
            IndividualTradesManagerSchema.parse(
                SYMBOL_CFG["individualTradesManager"]
            );
        } catch (error) {
            console.error("🚨 CRITICAL CONFIG ERROR - IndividualTradesManager");
            console.error("Missing mandatory configuration properties:");
            console.error(error);
            console.error(
                "Per CLAUDE.md: NO DEFAULTS, NO FALLBACKS, NO BULLSHIT"
            );
            process.exit(1);
        }

        // CRITICAL: StandardZoneConfig validation for CVD signal generation
        try {
            StandardZoneConfigSchema.parse(SYMBOL_CFG["standardZoneConfig"]);
        } catch (error) {
            console.error(
                "🚨 CRITICAL CONFIG ERROR - StandardZoneConfig (CVD signals)"
            );
            console.error("Missing mandatory zone configuration properties:");
            console.error(error);
            console.error(
                "Per CLAUDE.md: NO DEFAULTS, NO FALLBACKS, NO BULLSHIT"
            );
            console.error(
                "Zone configuration is REQUIRED for CVD signal generation"
            );
            process.exit(1);
        }
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

const ENV_SYMBOL: string | undefined = process.env["SYMBOL"]?.toUpperCase();
const CONFIG_SYMBOL: AllowedSymbols = (ENV_SYMBOL ||
    cfg.symbol) as AllowedSymbols;
const SYMBOL_CFG = cfg.symbols[CONFIG_SYMBOL as keyof typeof cfg.symbols];
if (!SYMBOL_CFG) {
    console.error(
        `🚨 CRITICAL CONFIG ERROR: Symbol ${CONFIG_SYMBOL} configuration missing from config.json`
    );
    process.exit(1);
}

// Execute validation after SYMBOL_CFG is initialized
validateMandatoryConfig();

const DATASTREAM_CFG = cfg.dataStream;

// Universal zone config from LTCUSDT symbol configuration
const UNIVERSAL_ZONE_CFG = SYMBOL_CFG.universalZoneConfig;
if (!UNIVERSAL_ZONE_CFG) {
    console.error(
        `🚨 CRITICAL CONFIG ERROR: universalZoneConfig configuration missing from symbols.LTCUSDT in config.json`
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
        return Number(SYMBOL_CFG!.pricePrecision);
    }
    static get TICK_SIZE(): number {
        return 1 / Math.pow(10, Config.PRICE_PRECISION);
    }
    static get MAX_STORAGE_TIME(): number {
        return Number(cfg.maxStorageTime);
    }
    static getTimeWindow(timeWindowIndex: number): number {
        return Config.STANDARD_ZONE_CONFIG.timeWindows[timeWindowIndex]!;
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
        return process.env["API_KEY"];
    }
    static get API_SECRET(): string | undefined {
        return process.env["API_SECRET"];
    }
    static get LLM_API_KEY(): string | undefined {
        return process.env["LLM_API_KEY"];
    }
    static get LLM_MODEL(): string {
        return process.env["LLM_MODEL"]!;
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
            quantityPrecision: SYMBOL_CFG!.quantityPrecision,
            bandTicks: SYMBOL_CFG!.bandTicks,
            tickSize: Config.TICK_SIZE,
            largeTradeThreshold: SYMBOL_CFG!.largeTradeThreshold,
            maxEventListeners: SYMBOL_CFG!.maxEventListeners,
            dashboardUpdateInterval: SYMBOL_CFG!.dashboardUpdateInterval,
            maxDashboardInterval: SYMBOL_CFG!.maxDashboardInterval,
            significantChangeThreshold: SYMBOL_CFG!.significantChangeThreshold,
            standardZoneConfig: Config.STANDARD_ZONE_CONFIG,

            enableIndividualTrades: true,
            maxZoneCacheAgeMs: 5400000, // 90 minutes for cross-detector zone persistence
            adaptiveZoneLookbackTrades: 500, // 500 trades ≈ meaningful zone formation over 12-15 min
            zoneCalculationRange: 12, // ±12 zones for broader price action coverage
            zoneCacheSize: 375, // Pre-allocated cache size for 90-minute analysis
            defaultZoneMultipliers:
                SYMBOL_CFG!.preprocessor.defaultZoneMultipliers,
            defaultTimeWindows: SYMBOL_CFG!.preprocessor.defaultTimeWindows,
            defaultMinZoneWidthMultiplier:
                SYMBOL_CFG!.preprocessor.defaultMinZoneWidthMultiplier,
            defaultMaxZoneWidthMultiplier:
                SYMBOL_CFG!.preprocessor.defaultMaxZoneWidthMultiplier,
            defaultMaxZoneHistory:
                SYMBOL_CFG!.preprocessor.defaultMaxZoneHistory,
            defaultMaxMemoryMB: SYMBOL_CFG!.preprocessor.defaultMaxMemoryMB,
            defaultAggressiveVolumeAbsolute:
                SYMBOL_CFG!.preprocessor.defaultAggressiveVolumeAbsolute,
            defaultPassiveVolumeAbsolute:
                SYMBOL_CFG!.preprocessor.defaultPassiveVolumeAbsolute,
            defaultInstitutionalVolumeAbsolute:
                SYMBOL_CFG!.preprocessor.defaultInstitutionalVolumeAbsolute,
            maxTradesPerZone: SYMBOL_CFG!.preprocessor.maxTradesPerZone,
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
            maxLevels: Number(
                cfg.symbols[cfg.symbol]!.orderBookState.maxLevels
            ),
            maxPriceDistance: Number(
                cfg.symbols[cfg.symbol]!.orderBookState.maxPriceDistance
            ),
            pruneIntervalMs: Number(
                cfg.symbols[cfg.symbol]!.orderBookState.pruneIntervalMs
            ),
            maxErrorRate: Number(
                cfg.symbols[cfg.symbol]!.orderBookState.maxErrorRate
            ),
            staleThresholdMs: Number(
                cfg.symbols[cfg.symbol]!.orderBookState.staleThresholdMs
            ),
        };
    }

    static get TRADES_PROCESSOR(): TradesProcessorOptions {
        return {
            symbol: Config.SYMBOL,
            storageTime: Number(
                cfg.symbols[cfg.symbol]!.tradesProcessor.storageTime
            ),
            maxBacklogRetries: Number(
                cfg.symbols[cfg.symbol]!.tradesProcessor.maxBacklogRetries
            ),
            backlogBatchSize: Number(
                cfg.symbols[cfg.symbol]!.tradesProcessor.backlogBatchSize
            ),
            maxMemoryTrades: Number(
                cfg.symbols[cfg.symbol]!.tradesProcessor.maxMemoryTrades
            ),
            saveQueueSize: Number(
                cfg.symbols[cfg.symbol]!.tradesProcessor.saveQueueSize
            ),
            healthCheckInterval: Number(
                cfg.symbols[cfg.symbol]!.tradesProcessor.healthCheckInterval
            ),
        };
    }

    static get SIGNAL_MANAGER(): SignalManagerConfig {
        const smConfig = cfg.symbols[cfg.symbol]!.signalManager;
        return {
            confidenceThreshold: Number(smConfig.confidenceThreshold),
            signalTimeout: Number(smConfig.signalTimeout),
            enableMarketHealthCheck: smConfig.enableMarketHealthCheck,
            enableAlerts: smConfig.enableAlerts,
            maxQueueSize: Number(smConfig.maxQueueSize),
            processingBatchSize: Number(smConfig.processingBatchSize),
            backpressureThreshold: Number(smConfig.backpressureThreshold),
            detectorThresholds: smConfig.detectorThresholds,
            positionSizing: smConfig.positionSizing,
            enableSignalPrioritization: smConfig.enableSignalPrioritization,
            adaptiveBatchSizing: smConfig.adaptiveBatchSizing,
            maxAdaptiveBatchSize: Number(smConfig.maxAdaptiveBatchSize),
            minAdaptiveBatchSize: Number(smConfig.minAdaptiveBatchSize),
            circuitBreakerThreshold: Number(smConfig.circuitBreakerThreshold),
            circuitBreakerResetMs: Number(smConfig.circuitBreakerResetMs),
            signalTypePriorities: smConfig.signalTypePriorities,
            adaptiveBackpressure: smConfig.adaptiveBackpressure,
            highPriorityBypassThreshold: Number(
                smConfig.highPriorityBypassThreshold
            ),
            conflictResolution: smConfig.conflictResolution,
            signalPriorityMatrix: smConfig.signalPriorityMatrix,
            // 🔧 Configurable parameters to eliminate magic numbers (REQUIRED)
            priceTolerancePercent: Number(smConfig.priceTolerancePercent),
            signalThrottleMs: Number(smConfig.signalThrottleMs),
            correlationWindowMs: Number(smConfig.correlationWindowMs),
            maxHistorySize: Number(smConfig.maxHistorySize),
            defaultPriority: Number(smConfig.defaultPriority),
            volatilityHighThreshold: Number(smConfig.volatilityHighThreshold),
            volatilityLowThreshold: Number(smConfig.volatilityLowThreshold),
            defaultLowVolatility: Number(smConfig.defaultLowVolatility),
            defaultVolatilityError: Number(smConfig.defaultVolatilityError),
            priorityQueueHighThreshold: Number(
                smConfig.priorityQueueHighThreshold
            ),
            backpressureYieldMs: Number(smConfig.backpressureYieldMs),
            marketVolatilityWeight: Number(smConfig.marketVolatilityWeight),
        };
    }

    static get DETECTOR_CONFIDENCE_THRESHOLDS(): Record<string, number> {
        return cfg.symbols[cfg.symbol]!.signalManager.detectorThresholds;
    }

    static get DETECTOR_POSITION_SIZING(): Record<string, number> {
        return cfg.symbols[cfg.symbol]!.signalManager.positionSizing;
    }

    static get SIGNAL_COORDINATOR(): SignalCoordinatorConfig {
        return {
            maxConcurrentProcessing: Number(
                cfg.symbols[cfg.symbol]!.signalCoordinator
                    .maxConcurrentProcessing
            ),
            processingTimeoutMs: Number(
                cfg.symbols[cfg.symbol]!.signalCoordinator.processingTimeoutMs
            ),
            retryAttempts: Number(
                cfg.symbols[cfg.symbol]!.signalCoordinator.retryAttempts
            ),
            retryDelayMs: Number(
                cfg.symbols[cfg.symbol]!.signalCoordinator.retryDelayMs
            ),
            enableMetrics:
                cfg.symbols[cfg.symbol]!.signalCoordinator.enableMetrics,
            logLevel: cfg.symbols[cfg.symbol]!.signalCoordinator.logLevel,
        };
    }

    static get ORDERBOOK_PROCESSOR(): OrderBookProcessorOptions {
        const precision = Config.PRICE_PRECISION;
        const tickSize = 1 / Math.pow(10, precision);
        return {
            binSize: Number(
                cfg.symbols[cfg.symbol]!.orderBookProcessor.binSize
            ),
            numLevels: Number(
                cfg.symbols[cfg.symbol]!.orderBookProcessor.numLevels
            ),
            maxBufferSize: Number(
                cfg.symbols[cfg.symbol]!.orderBookProcessor.maxBufferSize
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
        return SYMBOL_CFG!.exhaustion;
    }
    static get ABSORPTION_CONFIG() {
        return SYMBOL_CFG!.absorption;
    }
    static get DELTACVD_CONFIG() {
        return SYMBOL_CFG!.deltaCVD;
    }
    static get ACCUMULATION_CONFIG() {
        return SYMBOL_CFG!.accumulation;
    }
    static get DISTRIBUTION_CONFIG() {
        return SYMBOL_CFG!.distribution;
    }

    // Distribution detector with schema validation
    static get DISTRIBUTION_DETECTOR() {
        return this.validateDetectorConfig(
            DistributionDetectorSchema,
            SYMBOL_CFG!.distribution
        );
    }

    // 🚨 NUCLEAR CLEANUP: Zero tolerance configuration validation helpers
    // NOTE: Validation now happens at startup in validateMandatoryConfig()
    // This method is kept for type safety but should never fail
    private static validateDetectorConfig<T>(
        schema: z.ZodSchema<T>,
        config: DetectorConfigInput
    ): T {
        // Config already validated at startup, but parse again for type safety
        return schema.parse(config);
    }

    // Enhanced detector configurations - validated Zod schemas
    static get ABSORPTION_DETECTOR() {
        return this.validateDetectorConfig(
            AbsorptionDetectorSchema,
            SYMBOL_CFG!.absorption
        );
    }

    static get EXHAUSTION_DETECTOR() {
        return this.validateDetectorConfig(
            ExhaustionDetectorSchema,
            SYMBOL_CFG!.exhaustion
        );
    }

    static get DELTACVD_DETECTOR() {
        return this.validateDetectorConfig(
            DeltaCVDDetectorSchema,
            SYMBOL_CFG!.deltaCVD
        );
    }

    static get ACCUMULATION_DETECTOR() {
        return this.validateDetectorConfig(
            AccumulationDetectorSchema,
            SYMBOL_CFG!.accumulation
        );
    }

    static get DISTRIBUTION_ZONE_DETECTOR() {
        return this.validateDetectorConfig(
            DistributionDetectorSchema,
            SYMBOL_CFG!.distribution
        );
    }

    static get SIMPLE_ICEBERG_DETECTOR() {
        try {
            return SimpleIcebergDetectorSchema.parse(SYMBOL_CFG!.simpleIceberg);
        } catch (error) {
            console.error("🚨 CRITICAL CONFIG ERROR - SimpleIcebergDetector");
            console.error("Missing mandatory configuration properties:");
            console.error(error);
            console.error(
                "Per CLAUDE.md: NO DEFAULTS, NO FALLBACKS, NO BULLSHIT"
            );
            process.exit(1);
        }
    }

    // Backward compatibility getter for tests expecting ICEBERG_DETECTOR
    static get ICEBERG_DETECTOR() {
        return this.SIMPLE_ICEBERG_DETECTOR;
    }

    // CRITICAL: Zone configuration with Zod validation for CVD signal generation
    static get STANDARD_ZONE_CONFIG() {
        return StandardZoneConfigSchema.parse(
            SYMBOL_CFG!["standardZoneConfig"]
        );
    }

    static get INDIVIDUAL_TRADES_MANAGER(): IndividualTradesManagerConfig {
        return IndividualTradesManagerSchema.parse(
            SYMBOL_CFG!["individualTradesManager"]
        );
    }

    static get MICROSTRUCTURE_ANALYZER(): MicrostructureAnalyzerConfig {
        return MicrostructureAnalyzerSchema.parse(
            SYMBOL_CFG!["microstructureAnalyzer"]
        );
    }

    static get SPOOFING_DETECTOR(): SpoofingDetectorConfig {
        return {
            tickSize: this.TICK_SIZE,
            wallTicks: Number(
                cfg.symbols[cfg.symbol]!.spoofingDetector.wallTicks
            ),
            minWallSize: Number(
                cfg.symbols[cfg.symbol]!.spoofingDetector.minWallSize
            ),
            dynamicWallWidth:
                cfg.symbols[cfg.symbol]!.spoofingDetector.dynamicWallWidth,
            testLogMinSpoof: Number(
                cfg.symbols[cfg.symbol]!.spoofingDetector.testLogMinSpoof
            ),
        };
    }

    static get ANOMALY_DETECTOR(): AnomalyDetectorOptions {
        return {
            windowSize: Number(
                cfg.symbols[cfg.symbol]!.anomalyDetector.windowSize
            ),
            anomalyCooldownMs: Number(
                cfg.symbols[cfg.symbol]!.anomalyDetector.anomalyCooldownMs
            ),
            volumeImbalanceThreshold: Number(
                cfg.symbols[cfg.symbol]!.anomalyDetector
                    .volumeImbalanceThreshold
            ),
            normalSpreadBps: Number(
                cfg.symbols[cfg.symbol]!.anomalyDetector.normalSpreadBps
            ),
            minHistory: Number(
                cfg.symbols[cfg.symbol]!.anomalyDetector.minHistory
            ),
            tickSize: this.TICK_SIZE,
            flowWindowMs: Number(
                cfg.symbols[cfg.symbol]!.anomalyDetector.flowWindowMs
            ),
            orderSizeWindowMs: Number(
                cfg.symbols[cfg.symbol]!.anomalyDetector.orderSizeWindowMs
            ),
            volatilityThreshold: Number(
                cfg.symbols[cfg.symbol]!.anomalyDetector.volatilityThreshold
            ),
            spreadThresholdBps: Number(
                cfg.symbols[cfg.symbol]!.anomalyDetector.spreadThresholdBps
            ),
            extremeVolatilityWindowMs: Number(
                cfg.symbols[cfg.symbol]!.anomalyDetector
                    .extremeVolatilityWindowMs
            ),
            liquidityCheckWindowMs: Number(
                cfg.symbols[cfg.symbol]!.anomalyDetector.liquidityCheckWindowMs
            ),
            whaleCooldownMs: Number(
                cfg.symbols[cfg.symbol]!.anomalyDetector.whaleCooldownMs
            ),
            marketHealthWindowMs: Number(
                cfg.symbols[cfg.symbol]!.anomalyDetector.marketHealthWindowMs
            ),
        };
    }

    static get HIDDEN_ORDER_DETECTOR(): Partial<HiddenOrderDetectorConfig> {
        const hiddenOrderConfig = cfg.symbols[cfg.symbol]!.hiddenOrderDetector;
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
