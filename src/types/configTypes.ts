export type AllowedSymbols = "LTCUSDT";

export interface ConfigType {
    nodeEnv: string;
    symbol: AllowedSymbols;
    symbols: {
        LTCUSDT: SymbolConfig;
    };
    httpPort: number;
    wsPort: number;
    alertWebhookUrl: string;
    alertCooldownMs: number;
    maxStorageTime: number;
}

type SymbolConfig = {
    pricePrecision: number;
    windowMs: number;
    bandTicks: number;
    dataStream?: DataStreamConfig;
    orderBookState: OrderBookStateConfig;
    emitDepthMetrics?: boolean;
    anomalyDetector?: AnomalyDetectorConfig;
    spoofingDetector?: SpoofingDetectorConfig;
    exhaustion?: ExhaustionDetectorConfig;
    absorption?: AbsorptionDetectorConfig;
    deltaCvdConfirmation?: DeltaCvdConfirmationConfig;
    accumulationDetector?: AccumulationDetectorConfig;
    distributionDetector?: DistributionDetectorConfig;
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
