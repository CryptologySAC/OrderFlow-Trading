// src/indicators/interfaces/detectorInterfaces.ts

import { SpotWebsocketStreams } from "@binance/spot";
import type { Detected } from "../../utils/types.js";

/**
 * Base detector interface
 */
export interface IDetector {
    addTrade(trade: SpotWebsocketStreams.AggTradeResponse): void;
    addDepth(update: SpotWebsocketStreams.DiffBookDepthResponse): void;
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
