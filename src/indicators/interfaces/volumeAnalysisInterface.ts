// src/indicators/interfaces/volumeAnalysisInterface.ts

import {
    EnrichedTradeEvent,
    AggressiveTrade,
} from "../../types/marketEvents.js";

/**
 * Shared volume surge analysis interface for detector reuse
 * Extracted from DeltaCVD implementation for cross-detector consistency
 */

export interface VolumeHistory {
    timestamp: number;
    volume: number;
}

export interface BurstEvent {
    timestamp: number;
    volume: number;
    imbalance: number;
    hasInstitutional: boolean;
}

export interface VolumeSurgeConfig {
    volumeSurgeMultiplier: number; // 4x volume surge threshold
    imbalanceThreshold: number; // 35% order flow imbalance threshold
    institutionalThreshold: number; // 17.8 LTC institutional threshold
    burstDetectionMs: number; // 1000ms burst detection window
    sustainedVolumeMs: number; // 30000ms sustained volume window
    medianTradeSize: number; // 0.6 LTC baseline trade size
}

export interface VolumeSurgeResult {
    hasVolumeSurge: boolean;
    volumeMultiplier: number;
    baselineVolume: number;
    recentVolume: number;
}

export interface OrderFlowImbalanceResult {
    detected: boolean;
    imbalance: number;
    buyVolume: number;
    sellVolume: number;
    totalVolume: number;
    dominantSide: "buy" | "sell" | "balanced";
}

export interface InstitutionalActivityResult {
    detected: boolean;
    institutionalTrades: number;
    largestTradeSize: number;
    totalInstitutionalVolume: number;
}

export interface VolumeAnalysisState {
    volumeHistory: VolumeHistory[];
    burstHistory: BurstEvent[];
    lastAnalysis: number;
}

/**
 * Common volume analysis interface for all detectors
 */
export interface IVolumeAnalyzer {
    /**
     * Update volume tracking with new trade
     */
    updateVolumeTracking(event: EnrichedTradeEvent): void;

    /**
     * Detect volume surge against baseline
     */
    detectVolumeSurge(
        trades: AggressiveTrade[],
        now: number
    ): VolumeSurgeResult;

    /**
     * Detect order flow imbalance in recent window
     */
    detectOrderFlowImbalance(
        trades: AggressiveTrade[],
        now: number
    ): OrderFlowImbalanceResult;

    /**
     * Detect institutional activity
     */
    detectInstitutionalActivity(
        trades: AggressiveTrade[],
        now: number
    ): InstitutionalActivityResult;

    /**
     * Validate all volume surge conditions
     */
    validateVolumeSurgeConditions(
        trades: AggressiveTrade[],
        now: number
    ): {
        valid: boolean;
        reason?: string;
        volumeSurge: VolumeSurgeResult;
        imbalance: OrderFlowImbalanceResult;
        institutional: InstitutionalActivityResult;
    };

    /**
     * Get current analysis state
     */
    getAnalysisState(): VolumeAnalysisState;

    /**
     * Clear old data
     */
    cleanup(now: number): void;
}

/**
 * Volume surge validation result for detector integration
 */
export interface VolumeValidationResult {
    isValid: boolean;
    confidence: number; // 0-1 confidence boost from volume analysis
    reason: string;
    enhancementFactors: {
        volumeSurgeBoost: number; // 0-1 boost from volume surge
        imbalanceBoost: number; // 0-1 boost from order flow imbalance
        institutionalBoost: number; // 0-1 boost from institutional activity
    };
    metadata: {
        volumeMultiplier: number;
        imbalancePercent: number;
        institutionalTradesCount: number;
        burstDuration: number;
    };
}
