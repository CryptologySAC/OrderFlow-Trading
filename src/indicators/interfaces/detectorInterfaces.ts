// src/indicators/interfaces/detectorInterfaces.ts

import { SpotWebsocketStreams } from "@binance/spot";
import type { SpoofingDetectorConfig } from "../../services/spoofingDetector.js";
import { CircularBuffer } from "../../utils/utils.js";
import { EnrichedTradeEvent } from "../../types/marketEvents.js";

/**
 * Base detector interface
 */
export interface IDetector {
    //onEnrichedTrade(event: EnrichedTradeEvent): void;
    //addTrade(trade: SpotWebsocketStreams.AggTradeResponse): void;
    //addDepth(update: SpotWebsocketStreams.DiffBookDepthResponse): void;
    getStats(): DetectorStats;
    cleanup(): void;
}

/**
 * Detected orderflow event with deduplication support
 */
export interface Detected {
    id: string; // Unique identifier for deduplication
    side: "buy" | "sell";
    price: number;
    trades: SpotWebsocketStreams.AggTradeResponse[];
    totalAggressiveVolume: number;
    passiveVolume?: number;
    zone?: number;
    refilled?: boolean;
    detectedAt: number; // Timestamp for sequencing
    detectorSource: "absorption" | "exhaustion" | "accumulation";
    metadata?: Record<string, unknown>; // Additional context
    confirmed?: boolean; // Number of confirmations received
}

/**
 * Detector statistics
 */
export interface DetectorStats {
    tradesInBuffer: number;
    depthLevels: number;
    currentMinVolume: number;
    adaptiveZoneTicks?: number;
    rollingATR?: number;
    activeZones?: number; // Currently tracked zones
    signalsGenerated?: number; // Total signals in session
    errorCount?: number; // Error count in current window
    avgProcessingTimeMs?: number; // Average processing time
    memoryUsageMB?: number; // Current memory usage
    circuitBreakerTripped?: boolean; // Circuit breaker status
    lastCleanupTime?: number; // Last cleanup timestamp
    status?: "healthy" | "unknown";
}

/**
 * Common detector settings
 */
export interface BaseDetectorSettings {
    windowMs?: number;
    minAggVolume?: number;
    pricePrecision?: number;
    zoneTicks?: number;
    eventCooldownMs?: number;
    minInitialMoveTicks?: number;
    confirmationTimeoutMs?: number;
    maxRevisitTicks?: number;
    symbol?: string;
    updateIntervalMs?: number; // Adaptive threshold update interval
    spoofing?: SpoofingDetectorConfig;
    maxZoneHistory?: number; // Max zones to track in history
    cleanupIntervalMs?: number; // How often to cleanup old data
    metricsReportingIntervalMs?: number; // Metrics reporting frequency
    errorThresholdPerMinute?: number; // Max errors before circuit breaker
    circuitBreakerTimeoutMs?: number; // Circuit breaker reset time
    features?: AbsorptionFeatures | ExhaustionFeatures | AccumulationFeatures;
}

export interface AccumulationSettings extends BaseDetectorSettings {
    features?: AccumulationFeatures;
    // Accumulation-specific settings
    minDurationMs?: number; // Minimum accumulation duration
    minRatio?: number; // Min passive/aggressive ratio
    minRecentActivityMs?: number; // Trade staleness threshold
    accumulationThreshold?: number; // Confidence threshold (0-1)
}

export interface AbsorptionFeatures extends DetectorFeatures {
    // Absorption-specific features
    icebergDetection?: boolean; // Detect iceberg orders
    liquidityGradient?: boolean; // Analyze liquidity depth gradient
    absorptionVelocity?: boolean; // Track rate of absorption
    layeredAbsorption?: boolean; // Detect multi-level absorption
    spreadImpact?: boolean; // Detect Spread Impact
}

export interface ExhaustionFeatures extends DetectorFeatures {
    // Exhaustion-specific features
    depletionTracking?: boolean; // Track passive volume depletion over time
    spreadAdjustment?: boolean; // Adjust detection based on spread conditions
    volumeVelocity?: boolean; // Consider rate of volume change
}

export interface AccumulationFeatures extends DetectorFeatures {
    // Accumulation-specific features
    sideTracking?: boolean; // Track buy/sell sides separately
    durationWeighting?: boolean; // Weight signals by duration
    volumeVelocity?: boolean; // Consider accumulation velocity
    strengthAnalysis?: boolean; // Advanced strength calculation
}

/**
 * Common feature flags
 */
export interface DetectorFeatures {
    spoofingDetection?: boolean;
    adaptiveZone?: boolean;
    passiveHistory?: boolean;
    multiZone?: boolean;
    sideOverride?: boolean;
    autoCalibrate?: boolean;
    spreadAdjustment?: boolean;
}

/**
 * Detector callback type
 */
export type DetectorCallback = (data: Detected) => void;

/**
 * Absorption-specific interface
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface IAbsorptionDetector extends IDetector {
    // Absorption-specific methods if any
}

/**
 * Exhaustion-specific interface
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface IExhaustionDetector extends IDetector {
    // Exhaustion-specific methods if any
}

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface IAccumulationDetector {}

// Update PendingDetection interface to include metadata
export interface PendingDetection {
    id: string;
    time: number;
    price: number;
    side: "buy" | "sell";
    zone: number;
    trades: SpotWebsocketStreams.AggTradeResponse[];
    aggressive: number;
    passive: number;
    refilled: boolean;
    confirmed: boolean;
    metadata?: Record<string, unknown>; // ADD THIS
}

/**
 * Hot path object interfaces for object pooling
 */
export interface AbsorptionConditions {
    absorptionRatio: number; // aggressive/passive ratio
    passiveStrength: number; // current/avg passive strength
    hasRefill: boolean; // detected passive refills
    icebergSignal: number; // iceberg pattern strength (0-1)
    liquidityGradient: number; // depth gradient around zone (0-1)
    absorptionVelocity: number; // rate of absorption events (0-1)
    currentPassive: number; // current passive volume
    avgPassive: number; // average passive volume
    maxPassive: number; // maximum observed passive
    minPassive: number; // minimum observed passive
    aggressiveVolume: number; // total aggressive volume
    imbalance: number; // bid/ask imbalance
    sampleCount: number; // number of data samples
    dominantSide: "bid" | "ask" | "neutral"; // which side dominates
    consistency: number;
    velocityIncrease: number;
    spread: number;
    microstructure?: MicrostructureInsights;
}

export interface MicrostructureInsights {
    fragmentationScore: number; // Order fragmentation level (0-1)
    executionEfficiency: number; // Execution quality score (0-1)
    suspectedAlgoType: string; // Detected algorithm type
    toxicityScore: number; // Informed flow toxicity (0-1)
    timingPattern: string; // Execution timing pattern
    coordinationIndicators: number; // Number of coordination signals
    sustainabilityScore: number; // Predicted absorption sustainability (0-1)
    riskAdjustment: number; // Risk-based score adjustment (-0.3 to +0.3)
    confidenceBoost: number; // Confidence enhancement factor (0.8 to 1.5)
    urgencyFactor: number; // Signal urgency multiplier (0.5 to 2.0)
}

export interface ExhaustionConditions {
    aggressiveVolume: number;
    currentPassive: number;
    avgPassive: number;
    minPassive: number;
    avgLiquidity: number;
    passiveRatio: number;
    depletionRatio: number;
    refillGap: number;
    imbalance: number;
    spread: number;
    passiveVelocity: number;
    sampleCount: number;
}

export interface AccumulationConditions {
    ratio: number;
    duration: number;
    aggressiveVolume: number;
    relevantPassive: number;
    totalPassive: number;
    strength: number;
    velocity: number;
    dominantSide: "buy" | "sell";
    recentActivity: number;
    tradeCount: number;
    meetsMinDuration: boolean;
    meetsMinRatio: boolean;
    isRecentlyActive: boolean;
}

export interface VolumeCalculationResult {
    aggressive: number;
    passive: number;
    trades: SpotWebsocketStreams.AggTradeResponse[];
}

export interface ImbalanceResult {
    imbalance: number;
    dominantSide: "bid" | "ask" | "neutral";
}

interface ZoneCandidate {
    priceLevel: number;
    startTime: number;
    trades: CircularBuffer<EnrichedTradeEvent>;
    buyVolume: number;
    sellVolume: number;
    totalVolume: number;
    averageOrderSize: number;
    lastUpdate: number;
    consecutiveTrades: number;
    priceStability: number;
    tradeCount: number;
}
export interface DistributionCandidate extends ZoneCandidate {
    volumeDistribution: number; // How distributed the selling is
}

export interface AccumulationCandidate extends ZoneCandidate {
    absorptionQuality?: number; // Quality of sell absorption patterns
}
