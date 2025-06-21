// src/indicators/utils/volumeAnalyzer.ts

import {
    EnrichedTradeEvent,
    AggressiveTrade,
} from "../../types/marketEvents.js";
import type {
    IVolumeAnalyzer,
    VolumeHistory,
    BurstEvent,
    VolumeSurgeConfig,
    VolumeSurgeResult,
    OrderFlowImbalanceResult,
    InstitutionalActivityResult,
    VolumeAnalysisState,
    VolumeValidationResult,
} from "../interfaces/volumeAnalysisInterface.js";
import type { ILogger } from "../../infrastructure/loggerInterface.js";

/**
 * Shared volume analysis implementation for detector reuse
 * Extracted and enhanced from DeltaCVD implementation
 */
export class VolumeAnalyzer implements IVolumeAnalyzer {
    private volumeHistory: VolumeHistory[] = [];
    private burstHistory: BurstEvent[] = [];
    private lastAnalysis = 0;

    constructor(
        private readonly config: VolumeSurgeConfig,
        private readonly logger: ILogger,
        private readonly detectorId: string
    ) {}

    updateVolumeTracking(event: EnrichedTradeEvent): void {
        const now = event.timestamp;

        // Update volume history
        this.volumeHistory.push({
            timestamp: now,
            volume: event.quantity,
        });

        // Clean old volume history (keep sustained volume window)
        const cutoff = now - this.config.sustainedVolumeMs;
        this.volumeHistory = this.volumeHistory.filter(
            (vh) => vh.timestamp > cutoff
        );

        // Clean old burst history (keep 5 minutes for pattern analysis)
        const burstCutoff = now - 300000; // 5 minutes
        this.burstHistory = this.burstHistory.filter(
            (bh) => bh.timestamp > burstCutoff
        );
    }

    detectVolumeSurge(
        trades: AggressiveTrade[],
        now: number
    ): VolumeSurgeResult {
        if (this.volumeHistory.length < 10) {
            return {
                hasVolumeSurge: false,
                volumeMultiplier: 0,
                baselineVolume: 0,
                recentVolume: 0,
            };
        }

        // Calculate recent volume (last burst detection window)
        const recentCutoff = now - this.config.burstDetectionMs;
        const recentVolume = this.volumeHistory
            .filter((vh) => vh.timestamp > recentCutoff)
            .reduce((sum, vh) => sum + vh.volume, 0);

        // Calculate baseline volume (sustained window, excluding recent burst)
        const baselineCutoff = now - this.config.sustainedVolumeMs;
        const baselineHistory = this.volumeHistory.filter(
            (vh) =>
                vh.timestamp > baselineCutoff && vh.timestamp <= recentCutoff
        );

        if (baselineHistory.length === 0) {
            return {
                hasVolumeSurge: false,
                volumeMultiplier: 0,
                baselineVolume: 0,
                recentVolume,
            };
        }

        const baselineVolume =
            baselineHistory.reduce((sum, vh) => sum + vh.volume, 0) /
            (baselineHistory.length || 1);

        // Calculate volume multiplier
        const volumeMultiplier =
            recentVolume / (baselineVolume || this.config.medianTradeSize);
        const hasVolumeSurge =
            volumeMultiplier >= this.config.volumeSurgeMultiplier;

        return {
            hasVolumeSurge,
            volumeMultiplier,
            baselineVolume,
            recentVolume,
        };
    }

    detectOrderFlowImbalance(
        trades: AggressiveTrade[],
        now: number
    ): OrderFlowImbalanceResult {
        const recentCutoff = now - this.config.burstDetectionMs;
        const recentTrades = trades.filter((t) => t.timestamp > recentCutoff);

        if (recentTrades.length < 3) {
            return {
                detected: false,
                imbalance: 0,
                buyVolume: 0,
                sellVolume: 0,
                totalVolume: 0,
                dominantSide: "balanced",
            };
        }

        const buyVolume = recentTrades
            .filter((t) => !t.buyerIsMaker) // Aggressive buys
            .reduce((sum, t) => sum + t.quantity, 0);

        const sellVolume = recentTrades
            .filter((t) => t.buyerIsMaker) // Aggressive sells
            .reduce((sum, t) => sum + t.quantity, 0);

        const totalVolume = buyVolume + sellVolume;
        if (totalVolume === 0) {
            return {
                detected: false,
                imbalance: 0,
                buyVolume: 0,
                sellVolume: 0,
                totalVolume: 0,
                dominantSide: "balanced",
            };
        }

        // Calculate imbalance
        const imbalance = Math.abs(buyVolume - sellVolume) / totalVolume;
        const dominantSide =
            buyVolume > sellVolume
                ? "buy"
                : sellVolume > buyVolume
                  ? "sell"
                  : "balanced";

        return {
            detected: imbalance >= this.config.imbalanceThreshold,
            imbalance,
            buyVolume,
            sellVolume,
            totalVolume,
            dominantSide,
        };
    }

    detectInstitutionalActivity(
        trades: AggressiveTrade[],
        now: number
    ): InstitutionalActivityResult {
        const recentCutoff = now - this.config.burstDetectionMs;
        const institutionalTrades = trades.filter(
            (t) =>
                t.timestamp > recentCutoff &&
                t.quantity >= this.config.institutionalThreshold
        );

        const totalInstitutionalVolume = institutionalTrades.reduce(
            (sum, t) => sum + t.quantity,
            0
        );

        const largestTradeSize =
            institutionalTrades.length > 0
                ? Math.max(...institutionalTrades.map((t) => t.quantity))
                : 0;

        return {
            detected: institutionalTrades.length > 0,
            institutionalTrades: institutionalTrades.length,
            largestTradeSize,
            totalInstitutionalVolume,
        };
    }

    validateVolumeSurgeConditions(
        trades: AggressiveTrade[],
        now: number
    ): {
        valid: boolean;
        reason?: string;
        volumeSurge: VolumeSurgeResult;
        imbalance: OrderFlowImbalanceResult;
        institutional: InstitutionalActivityResult;
    } {
        // Analyze all volume conditions
        const volumeSurge = this.detectVolumeSurge(trades, now);
        const imbalance = this.detectOrderFlowImbalance(trades, now);
        const institutional = this.detectInstitutionalActivity(trades, now);

        // Check volume surge requirement
        if (!volumeSurge.hasVolumeSurge) {
            return {
                valid: false,
                reason: "no_volume_surge",
                volumeSurge,
                imbalance,
                institutional,
            };
        }

        // Check order flow imbalance requirement
        if (!imbalance.detected) {
            return {
                valid: false,
                reason: "insufficient_imbalance",
                volumeSurge,
                imbalance,
                institutional,
            };
        }

        // Record the burst for historical analysis
        this.burstHistory.push({
            timestamp: now,
            volume: volumeSurge.recentVolume,
            imbalance: imbalance.imbalance,
            hasInstitutional: institutional.detected,
        });

        this.logger.debug("Volume surge conditions validated", {
            detector: this.detectorId,
            volumeMultiplier: volumeSurge.volumeMultiplier,
            imbalance: imbalance.imbalance,
            hasInstitutional: institutional.detected,
            reason: institutional.detected
                ? "institutional_enhanced"
                : "volume_imbalance_confirmed",
        });

        return {
            valid: true,
            volumeSurge,
            imbalance,
            institutional,
        };
    }

    /**
     * Calculate confidence enhancement factors from volume analysis
     */
    calculateVolumeConfidenceBoost(
        volumeSurge: VolumeSurgeResult,
        imbalance: OrderFlowImbalanceResult,
        institutional: InstitutionalActivityResult
    ): VolumeValidationResult {
        // Base confidence from volume surge strength
        const volumeSurgeBoost = Math.min(
            ((volumeSurge.volumeMultiplier -
                this.config.volumeSurgeMultiplier) /
                this.config.volumeSurgeMultiplier) *
                0.3,
            0.3
        );

        // Imbalance strength boost
        const imbalanceBoost = Math.min(
            ((imbalance.imbalance - this.config.imbalanceThreshold) /
                (1 - this.config.imbalanceThreshold)) *
                0.2,
            0.2
        );

        // Institutional activity boost
        const institutionalBoost = institutional.detected
            ? Math.min(
                  (institutional.largestTradeSize /
                      this.config.institutionalThreshold) *
                      0.15,
                  0.25
              )
            : 0;

        const totalConfidence = Math.min(
            volumeSurgeBoost + imbalanceBoost + institutionalBoost,
            0.4
        );

        return {
            isValid: volumeSurge.hasVolumeSurge && imbalance.detected,
            confidence: totalConfidence,
            reason: institutional.detected
                ? "institutional_volume_surge"
                : "volume_imbalance_surge",
            enhancementFactors: {
                volumeSurgeBoost,
                imbalanceBoost,
                institutionalBoost,
            },
            metadata: {
                volumeMultiplier: volumeSurge.volumeMultiplier,
                imbalancePercent: imbalance.imbalance * 100,
                institutionalTradesCount: institutional.institutionalTrades,
                burstDuration: this.config.burstDetectionMs,
            },
        };
    }

    getAnalysisState(): VolumeAnalysisState {
        return {
            volumeHistory: [...this.volumeHistory],
            burstHistory: [...this.burstHistory],
            lastAnalysis: this.lastAnalysis,
        };
    }

    cleanup(now: number): void {
        // Clean volume history
        const volumeCutoff = now - this.config.sustainedVolumeMs;
        this.volumeHistory = this.volumeHistory.filter(
            (vh) => vh.timestamp > volumeCutoff
        );

        // Clean burst history
        const burstCutoff = now - 300000; // 5 minutes
        this.burstHistory = this.burstHistory.filter(
            (bh) => bh.timestamp > burstCutoff
        );

        this.lastAnalysis = now;
    }
}
