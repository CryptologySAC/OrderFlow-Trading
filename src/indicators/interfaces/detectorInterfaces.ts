// src/indicators/interfaces/detectorInterfaces.ts

import { SpotWebsocketStreams } from "@binance/spot";
import type { SpoofingDetectorConfig } from "../../services/spoofingDetector.js";

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
    pendingConfirmations: number;
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
    priceResponse?: boolean;
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
