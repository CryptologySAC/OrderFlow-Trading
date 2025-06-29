// src/indicators/accumulationZoneDetectorEnhanced.ts
/**
 * Enhanced AccumulationZoneDetector with Standardized Zone Integration
 *
 * PRODUCTION-SAFE WRAPPER: This class extends the original AccumulationZoneDetector
 * without modifying the production-critical original implementation.
 *
 * Features:
 * - Feature flag controlled integration (disabled by default)
 * - Zero performance impact when disabled
 * - Full backward compatibility
 * - Gradual rollout capability
 */

import { AccumulationZoneDetector } from "./accumulationZoneDetector.js";
import { AccumulationZoneStandardizedEnhancement } from "./accumulationZoneDetector_standardizedEnhancement.js";
import { Detector } from "./base/detectorEnrichedTrade.js";
import type {
    ZoneAnalysisResult,
    ZoneDetectorConfig,
    ZoneSignal,
    AccumulationZone,
} from "../types/zoneTypes.js";
import type { EnrichedTradeEvent } from "../types/marketEvents.js";
import type { ILogger } from "../infrastructure/loggerInterface.js";
import type { IMetricsCollector } from "../infrastructure/metricsCollectorInterface.js";
import type { StandardizedZoneAnalysisResult } from "./accumulationZoneDetector_standardizedEnhancement.js";

/**
 * Enhanced AccumulationZoneDetector with Standardized Zone Integration
 *
 * This class wraps the original AccumulationZoneDetector and adds optional
 * standardized zone enhancement capabilities without modifying the original
 * production-critical implementation.
 */
export class AccumulationZoneDetectorEnhanced extends Detector {
    private readonly originalDetector: AccumulationZoneDetector;
    private readonly standardizedEnhancement?: AccumulationZoneStandardizedEnhancement;
    private readonly config: ZoneDetectorConfig;

    // Feature flag and control
    private readonly useStandardizedZones: boolean;
    private readonly enhancementMode: "disabled" | "testing" | "production";

    // Performance tracking
    private enhancementCallCount = 0;
    private enhancementSuccessCount = 0;
    private enhancementErrorCount = 0;

    constructor(
        id: string,
        symbol: string,
        config: ZoneDetectorConfig,
        logger: ILogger,
        metricsCollector: IMetricsCollector
    ) {
        super(id, logger, metricsCollector);
        this.config = config;

        // Initialize original detector with original config
        this.originalDetector = new AccumulationZoneDetector(
            id,
            symbol,
            config, // Pass through all original config options
            logger,
            metricsCollector
        );

        // Feature flag control
        this.enhancementMode = config.enhancementMode ?? "disabled";
        this.useStandardizedZones =
            (config.useStandardizedZones ?? false) &&
            this.enhancementMode !== "disabled";

        // Initialize standardized zone enhancement if enabled
        if (this.useStandardizedZones) {
            try {
                this.standardizedEnhancement =
                    new AccumulationZoneStandardizedEnhancement(
                        config.standardizedZoneConfig ?? {},
                        logger
                    );

                this.logger.info(
                    "AccumulationZoneDetectorEnhanced: Standardized zones enabled",
                    {
                        mode: this.enhancementMode,
                        config: config.standardizedZoneConfig,
                    }
                );
            } catch (error) {
                this.logger.error(
                    "Failed to initialize standardized zone enhancement",
                    {
                        error:
                            error instanceof Error
                                ? error.message
                                : String(error),
                    }
                );
                // Fall back to original detector only
                this.useStandardizedZones = false;
            }
        } else {
            this.logger.info(
                "AccumulationZoneDetectorEnhanced: Standardized zones disabled",
                {
                    mode: this.enhancementMode,
                    useStandardizedZones: config.useStandardizedZones,
                }
            );
        }
    }

    /**
     * Main analysis method - enhanced version of original analyze()
     *
     * This method maintains full backward compatibility while adding optional
     * standardized zone enhancement when enabled.
     */
    public analyze(trade: EnrichedTradeEvent): ZoneAnalysisResult {
        // Always run original detector first (production-critical path)
        const originalResult = this.originalDetector.analyze(trade);

        // If standardized zones are disabled, return original result immediately
        if (!this.useStandardizedZones || !this.standardizedEnhancement) {
            return originalResult;
        }

        // Only enhance if there's zone data available and original analysis found something
        if (
            !trade.zoneData ||
            (!originalResult.activeZones.length &&
                !originalResult.signals.length)
        ) {
            return originalResult;
        }

        try {
            this.enhancementCallCount++;
            this.metricsCollector.incrementMetric("signalsGenerated");

            // Apply standardized zone enhancement
            const enhancedResult = this.enhanceWithStandardizedZones(
                trade,
                originalResult
            );

            this.enhancementSuccessCount++;
            this.metricsCollector.incrementMetric("signalsGenerated");

            return enhancedResult;
        } catch (error) {
            this.enhancementErrorCount++;
            this.metricsCollector.incrementMetric("signalsGenerated");

            this.logger.error(
                "Standardized zone enhancement failed, falling back to original",
                {
                    error:
                        error instanceof Error ? error.message : String(error),
                    tradeId: trade.tradeId,
                    price: trade.price,
                }
            );

            // Always fall back to original result on enhancement errors
            return originalResult;
        }
    }

    /**
     * Apply standardized zone enhancement to original analysis results
     */
    private enhanceWithStandardizedZones(
        trade: EnrichedTradeEvent,
        originalResult: ZoneAnalysisResult
    ): ZoneAnalysisResult {
        if (!this.standardizedEnhancement || !trade.zoneData) {
            return originalResult;
        }

        // Find most relevant accumulation price from original analysis
        const targetPrice = this.findMostRelevantAccumulationPrice(
            originalResult,
            trade.price
        );

        // Get standardized zone enhancement analysis
        const enhancement =
            this.standardizedEnhancement.enhanceAccumulationAnalysis(
                trade,
                targetPrice
            );

        if (!enhancement) {
            this.logger.debug("No standardized zone enhancement available", {
                targetPrice,
                hasZoneData: !!trade.zoneData,
                activeZones: originalResult.activeZones.length,
            });
            return originalResult;
        }

        // Apply enhancement to original results
        return this.mergeAnalysisResults(originalResult, enhancement);
    }

    /**
     * Find the most relevant accumulation price from original analysis
     */
    private findMostRelevantAccumulationPrice(
        analysis: ZoneAnalysisResult,
        currentPrice: number
    ): number {
        // If there are active zones, use the closest one
        if (analysis.activeZones.length > 0) {
            let closestZone = analysis.activeZones[0];
            let minDistance = Math.abs(
                closestZone.priceRange.center - currentPrice
            );

            for (const zone of analysis.activeZones) {
                const distance = Math.abs(
                    zone.priceRange.center - currentPrice
                );
                if (distance < minDistance) {
                    minDistance = distance;
                    closestZone = zone;
                }
            }
            return closestZone.priceRange.center;
        }

        // If there are recent updates, use the most recent zone
        if (analysis.updates.length > 0) {
            const recentUpdate = analysis.updates[analysis.updates.length - 1];
            return recentUpdate.zone.priceRange.center;
        }

        // Fallback to current price
        return currentPrice;
    }

    /**
     * Merge original analysis results with standardized zone enhancement
     */
    private mergeAnalysisResults(
        originalResult: ZoneAnalysisResult,
        enhancement: StandardizedZoneAnalysisResult
    ): ZoneAnalysisResult {
        const enhancedResult: ZoneAnalysisResult = {
            updates: [...originalResult.updates],
            signals: [],
            activeZones: [...originalResult.activeZones],
        };

        // Enhance existing signals based on standardized zone analysis
        enhancedResult.signals = originalResult.signals.map((signal) => {
            return this.enhanceSignal(signal, enhancement);
        });

        // Apply filtering based on enhancement recommendations
        if (enhancement.recommendedAction === "filter") {
            const minConfidence =
                this.config.minEnhancedConfidenceThreshold ?? 0.3;
            enhancedResult.signals = enhancedResult.signals.filter(
                (signal) => signal.confidence >= minConfidence
            );

            this.metricsCollector.incrementMetric("signalsGenerated");
            this.logger.debug(
                "Filtered signals based on standardized zone analysis",
                {
                    originalSignalCount: originalResult.signals.length,
                    filteredSignalCount: enhancedResult.signals.length,
                    minConfidence,
                }
            );
        }

        // Track enhancement metrics
        if (enhancement.recommendedAction === "enhance") {
            this.metricsCollector.incrementMetric("signalsGenerated");
        }

        return enhancedResult;
    }

    /**
     * Enhance individual signal based on standardized zone analysis
     */
    private enhanceSignal(
        signal: ZoneSignal,
        enhancement: StandardizedZoneAnalysisResult
    ): ZoneSignal {
        const enhancedSignal: ZoneSignal = { ...signal };

        switch (enhancement.recommendedAction) {
            case "enhance":
                enhancedSignal.confidence = Math.min(
                    1.0,
                    signal.confidence + enhancement.confidenceBoost
                );

                // Optionally upgrade significance level
                if (this.config.enhancementSignificanceBoost) {
                    enhancedSignal.zoneStrength = Math.min(
                        1.0,
                        signal.zoneStrength +
                            enhancement.signalQualityScore * 0.2
                    );
                }

                this.logger.debug("Enhanced signal confidence", {
                    originalConfidence: signal.confidence,
                    enhancedConfidence: enhancedSignal.confidence,
                    boost: enhancement.confidenceBoost,
                    qualityScore: enhancement.signalQualityScore,
                });
                break;

            case "filter":
                enhancedSignal.confidence = Math.max(
                    0.0,
                    signal.confidence * 0.7 // Reduce confidence for low-quality signals
                );

                this.logger.debug("Reduced signal confidence for filtering", {
                    originalConfidence: signal.confidence,
                    reducedConfidence: enhancedSignal.confidence,
                    qualityScore: enhancement.signalQualityScore,
                });
                break;

            case "neutral":
                enhancedSignal.confidence = Math.min(
                    1.0,
                    signal.confidence + enhancement.confidenceBoost * 0.5
                );

                this.logger.debug("Applied neutral enhancement", {
                    originalConfidence: signal.confidence,
                    enhancedConfidence: enhancedSignal.confidence,
                    boost: enhancement.confidenceBoost * 0.5,
                });
                break;
        }

        return enhancedSignal;
    }

    /**
     * Get active zones (delegates to original detector)
     */
    public getActiveZones(): AccumulationZone[] {
        return this.originalDetector.getActiveZones();
    }

    /**
     * Get enhancement statistics for monitoring
     */
    public getEnhancementStats(): {
        enabled: boolean;
        mode: string;
        callCount: number;
        successCount: number;
        errorCount: number;
        successRate: number;
    } {
        return {
            enabled: this.useStandardizedZones,
            mode: this.enhancementMode,
            callCount: this.enhancementCallCount,
            successCount: this.enhancementSuccessCount,
            errorCount: this.enhancementErrorCount,
            successRate:
                this.enhancementCallCount > 0
                    ? this.enhancementSuccessCount / this.enhancementCallCount
                    : 0,
        };
    }

    /**
     * Enable/disable standardized zones at runtime (for A/B testing)
     */
    public setEnhancementMode(
        mode: "disabled" | "testing" | "production"
    ): void {
        if (mode !== this.enhancementMode) {
            this.logger.info("Changing enhancement mode", {
                from: this.enhancementMode,
                to: mode,
            });

            // Note: This would require updating the private field, but that's not directly possible
            // In a real implementation, this would need to be handled differently
            // For now, this method serves as a placeholder for the API design
        }
    }

    /**
     * Delegate all other methods to original detector for full compatibility
     */

    // Required interface methods for compatibility with Detector interface
    // Note: id is inherited from Detector base class

    public onEnrichedTrade(event: EnrichedTradeEvent): void {
        this.analyze(event);
    }

    public getStatus(): string {
        return this.originalDetector.getStatus();
    }

    public markSignalConfirmed(zone: number, side: "buy" | "sell"): void {
        return this.originalDetector.markSignalConfirmed(zone, side);
    }

    public getId(): string {
        return this.id || `${this.constructor.name}_${Date.now()}`;
    }

    // Forward events from original detector with proper typing
    public on(event: string, listener: (...args: unknown[]) => void): this {
        const detector = this.originalDetector as {
            on?: (
                event: string,
                listener: (...args: unknown[]) => void
            ) => void;
        };
        if (typeof detector.on === "function") {
            detector.on(event, listener);
        }
        return super.on(event, listener);
    }

    public emit(event: string, ...args: unknown[]): boolean {
        const detector = this.originalDetector as {
            emit?: (event: string, ...args: unknown[]) => boolean;
        };
        if (typeof detector.emit === "function") {
            detector.emit(event, ...args);
        }
        return super.emit(event, ...args);
    }
}
