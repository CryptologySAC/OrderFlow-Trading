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
    zoneDetectors?: Record<string, ZoneDetectorSymbolConfig>;
}

type SymbolConfig = {
    pricePrecision: number;
    windowMs: number;
    bandTicks: number;
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
