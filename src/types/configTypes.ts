export type AllowedSymbols = "LTCUSDT";
import type { ZoneDetectorConfig } from "./zoneTypes.js";

export interface MQTTConfig {
    url: string;
    username?: string;
    password?: string;
    statsTopic?: string;
    clientId?: string;
    keepalive?: number;
    connectTimeout?: number;
    reconnectPeriod?: number;
}

export interface MarketDataStorageConfig {
    enabled: boolean;
    dataDirectory: string;
    format: "csv" | "jsonl" | "both";
    maxFileSize: number;
    depthLevels: number;
    rotationHours: number;
    compressionEnabled: boolean;
    monitoringInterval: number;
}

export interface ConfigType {
    nodeEnv: string;
    symbol: AllowedSymbols;
    symbols: {
        LTCUSDT: SymbolConfig;
    };
    httpPort: number;
    wsPort: number;
    mqtt?: MQTTConfig;
    alertWebhookUrl: string;
    alertCooldownMs: number;
    maxStorageTime: number;
    marketDataStorage?: MarketDataStorageConfig;
    zoneDetectors?: Record<string, ZoneDetectorSymbolConfig>;
    // ✅ Enhanced zone formation configuration
    enhancedZoneFormation?: EnhancedZoneFormationConfig;
}

type SymbolConfig = {
    pricePrecision: number;
    quantityPrecision?: number; // Quantity decimal places (XRP: 2, BNB: 3, ADA: 6, DOGE/SOL: 4-6, default: 8)
    windowMs: number;
    bandTicks: number;
    largeTradeThreshold?: number; // Threshold for large trades requiring full depth snapshot
    maxEventListeners?: number; // EventEmitter memory management
    // Dashboard update configuration for performance optimization
    dashboardUpdateInterval?: number; // Dashboard update frequency in ms (default: 200ms = 5 FPS)
    maxDashboardInterval?: number; // Maximum time between dashboard updates (default: 1000ms)
    significantChangeThreshold?: number; // Price change threshold for immediate updates (default: 0.001 = 0.1%)
    dataStream?: DataStreamConfig;
    orderBookState: OrderBookStateConfig;
    tradesProcessor?: TradesProcessorConfig;
    signalManager?: SignalManagerConfig;
    signalCoordinator?: SignalCoordinatorConfig;
    orderBookProcessor?: OrderBookProcessorConfig;
    emitDepthMetrics?: boolean;
    anomalyDetector?: AnomalyDetectorConfig;
    spoofingDetector?: SpoofingDetectorConfig;
    exhaustion?: ExhaustionDetectorConfig;
    absorption?: AbsorptionDetectorConfig;
    deltaCvdConfirmation?: DeltaCvdConfirmationConfig;
    accumulationDetector?: AccumulationDetectorConfig;
    distributionDetector?: DistributionDetectorConfig;
    supportResistanceDetector?: SupportResistanceConfig;
};

type DataStreamConfig = {
    reconnectDelay?: number;
    maxReconnectAttempts?: number;
    depthUpdateSpeed?: "100ms" | "1000ms";
    enableHeartbeat?: boolean;
    heartbeatInterval?: number;
    // Enhanced configuration
    maxBackoffDelay?: number;
    streamHealthTimeout?: number;
    enableStreamHealthCheck?: boolean;
    reconnectOnHealthFailure?: boolean;
    // Hard reload configuration
    enableHardReload?: boolean;
    hardReloadAfterAttempts?: number;
    hardReloadCooldownMs?: number;
    maxHardReloads?: number;
    hardReloadRestartCommand?: string;
};

type AnomalyDetectorConfig = {
    windowSize: number;
    anomalyCooldownMs: number;
    icebergDetectionWindow: number;
    volumeImbalanceThreshold: number;
    absorptionRatioThreshold: number;
    normalSpreadBps: number;
    minHistory: number;
    orderSizeAnomalyThreshold: number;
    tickSize: number;
    flowWindowMs?: number;
    orderSizeWindowMs?: number;
    volatilityThreshold?: number;
    spreadThresholdBps?: number;
    extremeVolatilityWindowMs?: number;
    liquidityCheckWindowMs?: number;
    whaleCooldownMs?: number;
    marketHealthWindowMs?: number;
};

type SpoofingDetectorConfig = {
    wallTicks: number;
    minWallSize: number;
    dynamicWallWidth: true;
    testLogMinSpoof: number;
};

type OrderBookStateConfig = {
    pricePrecision: number;
    maxLevels: number;
    maxPriceDistance: number;
    pruneIntervalMs: number;
    maxErrorRate: number;
    staleThresholdMs: number;
};

type ExhaustionDetectorConfig = {
    minAggVolume: number;
    threshold: number;
    windowMs: number;
    zoneTicks: number;
    eventCooldownMs: number;
    maxPassiveRatio: number;
    pricePrecision: number;
    moveTicks: number;
    confirmationTimeout: number;
    maxRevisitTicks: number;
    features: {
        depletionTracking: true;
        spreadAdjustment: true;
        spoofingDetection: true;
        autoCalibrate: false;
        adaptiveZone: true;
        multiZone: true;
        volumeVelocity: true;
        passiveHistory: true;
    };
};

type AbsorptionDetectorConfig = {
    minAggVolume: number;
    threshold: number;
    windowMs: number;
    zoneTicks: number;
    eventCooldownMs: number;
    minPassiveMultiplier: number;
    maxAbsorptionRatio: number;
    pricePrecision: number;
    moveTicks: number;
    confirmationTimeout: number;
    maxRevisitTicks: number;
    features: {
        spoofingDetection: true;
        adaptiveZone: true;
        passiveHistory: true;
        multiZone: true;
        autoCalibrate: false;
        icebergDetection: true;
        liquidityGradient: true;
        spreadAdjustment: true;
        absorptionVelocity: true;
    };
};

type DeltaCvdConfirmationConfig = {
    windowSec: number[];
    minTradesPerSec: number;
    minVolPerSec: number;
    minZ: number;
    pricePrecision: number;
    dynamicThresholds: true;
    logDebug: true;
};

type AccumulationDetectorConfig = {
    minDurationMs: number;
    zoneSize: number;
    minRatio: number;
    minRecentActivityMs: number;
    minAggVolume: number;
    trackSide: false;
    pricePrecision: number;
    accumulationThreshold: number;
};

type DistributionDetectorConfig = {
    minDurationMs: number;
    minRatio: number;
    minRecentActivityMs: number;
    threshold: number;
    volumeConcentrationWeight: number;
    strengthAnalysis: boolean;
    velocityAnalysis: boolean;
    symbol: string;
    minAggVolume: number;
    pricePrecision: number;
};

type SupportResistanceConfig = {
    priceTolerancePercent: number;
    minTouchCount: number;
    minStrength: number;
    timeWindowMs: number;
    volumeWeightFactor: number;
    rejectionConfirmationTicks: number;
};

type TradesProcessorConfig = {
    storageTime?: number;
    maxBacklogRetries?: number;
    backlogBatchSize?: number;
    maxMemoryTrades?: number;
    saveQueueSize?: number;
    healthCheckInterval?: number;
};

type SignalManagerConfig = {
    confidenceThreshold?: number;
    signalTimeout?: number;
    enableMarketHealthCheck?: boolean;
    enableAlerts?: boolean;
    detectorThresholds?: Record<string, number>;
    positionSizing?: Record<string, number>;
};

type SignalCoordinatorConfig = {
    maxConcurrentProcessing?: number;
    processingTimeoutMs?: number;
    retryAttempts?: number;
    retryDelayMs?: number;
    enableMetrics?: boolean;
    logLevel?: string;
};

type OrderBookProcessorConfig = {
    binSize?: number;
    numLevels?: number;
    maxBufferSize?: number;
    tickSize?: number;
    precision?: number;
};

export type ZoneDetectorSymbolConfig = {
    accumulation?: Partial<ZoneDetectorConfig>;
    distribution?: Partial<ZoneDetectorConfig>;
};

/**
 * Enhanced zone formation configuration constants to replace magic numbers
 */
export interface EnhancedZoneFormationConfig {
    // Iceberg detection thresholds
    icebergDetection: {
        minSize: number; // Minimum trade size to consider for iceberg patterns
        maxSize: number; // Maximum trade size to consider for iceberg patterns
        priceStabilityTolerance: number; // Price stability tolerance (e.g., 0.02 = 2%)
        sizeConsistencyThreshold: number; // Minimum consistency for iceberg detection (e.g., 0.6 = 60%)
        sideDominanceThreshold: number; // Minimum side dominance for iceberg (e.g., 0.7 = 70%)
    };

    // Price efficiency calculation
    priceEfficiency: {
        baseImpactRate: number; // Base price impact rate per 1000 units (e.g., 0.0002 = 0.02%)
        maxVolumeMultiplier: number; // Maximum volume multiplier (e.g., 5)
        minEfficiencyThreshold: number; // Minimum efficiency threshold
    };

    // Institutional detection thresholds
    institutional: {
        minRatio: number; // Minimum institutional ratio (e.g., 0.3 = 30%)
        sizeThreshold: number; // Institutional size threshold (e.g., 50-100)
        detectionWindow: number; // Detection window size (e.g., 15-20)
    };

    // Detector scoring thresholds - CENTRALIZED!
    detectorThresholds: {
        accumulation: {
            minScore: number; // Minimum score for accumulation zones (e.g., 0.75)
            minAbsorptionRatio: number; // Minimum sell absorption ratio (e.g., 0.75)
            maxAggressiveRatio: number; // Maximum aggressive buying ratio (e.g., 0.35)
            minPriceStability: number; // Minimum price stability (e.g., 0.85)
            minInstitutionalScore: number; // Minimum institutional score (e.g., 0.4)
        };
        distribution: {
            minScore: number; // Minimum score for distribution zones (e.g., 0.55)
            minSellingRatio: number; // Minimum aggressive selling ratio (e.g., 0.65)
            maxSupportRatio: number; // Maximum support buying ratio (e.g., 0.35)
            minPriceStability: number; // Minimum price stability (e.g., 0.75)
            minInstitutionalScore: number; // Minimum institutional score (e.g., 0.3)
        };
    };

    // Adaptive thresholds by market regime
    adaptiveThresholds: {
        volatility: {
            high: {
                accumulation: {
                    minAbsorptionRatio: number;
                    maxAggressiveRatio: number;
                };
                distribution: {
                    minSellingRatio: number;
                    maxSupportRatio: number;
                };
            };
            medium: {
                accumulation: {
                    minAbsorptionRatio: number;
                    maxAggressiveRatio: number;
                };
                distribution: {
                    minSellingRatio: number;
                    maxSupportRatio: number;
                };
            };
            low: {
                accumulation: {
                    minAbsorptionRatio: number;
                    maxAggressiveRatio: number;
                };
                distribution: {
                    minSellingRatio: number;
                    maxSupportRatio: number;
                };
            };
        };
    };
}
