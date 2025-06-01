// src/indicators/interfaces/detectorInterfaces.ts

import { SpotWebsocketStreams } from "@binance/spot";
import type { Detected } from "../../utils/types.js";
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
    features?: AbsorptionFeatures | ExhaustionFeatures;
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
