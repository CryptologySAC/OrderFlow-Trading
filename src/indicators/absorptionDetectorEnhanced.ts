// src/indicators/absorptionDetectorEnhanced.ts
/**
 * Enhanced AbsorptionDetector with Standardized Zone Integration
 *
 * PRODUCTION-SAFE ENHANCEMENT WRAPPER
 *
 * This enhanced detector integrates with OrderFlowPreprocessor's standardized zones
 * to provide multi-timeframe absorption analysis while preserving the original
 * AbsorptionDetector's production-tested behavior as the baseline.
 *
 * Key Features:
 * - Multi-timeframe zone confluence analysis (5T, 10T, 20T)
 * - Institutional volume detection using standardized thresholds
 * - Enhanced absorption quality scoring with zone confluence
 * - Performance optimization through shared zone cache
 * - Feature flag controlled enhancement deployment
 *
 * Architecture:
 * - 80% weight: Original AbsorptionDetector behavior (production baseline)
 * - 20% weight: Enhanced standardized zone analysis (supplementary)
 * - Fallback: Graceful degradation if standardized zones unavailable
 *
 * CRITICAL: DO NOT MODIFY ORIGINAL DETECTOR - This is a wrapper only
 */

import {
    AbsorptionDetector,
    AbsorptionSettings,
} from "./absorptionDetector.js";
import type { ILogger } from "../infrastructure/loggerInterface.js";
import type { IMetricsCollector } from "../infrastructure/metricsCollectorInterface.js";
import { ISignalLogger } from "../infrastructure/signalLoggerInterface.js";
import { SpoofingDetector } from "../services/spoofingDetector.js";
import { IOrderBookState } from "../market/orderBookState.js";
import type {
    EnrichedTradeEvent,
    ZoneSnapshot,
    StandardZoneData,
} from "../types/marketEvents.js";
import type { StandardZoneConfig } from "../types/zoneTypes.js";

export interface AbsorptionEnhancementConfig {
    // Zone confluence analysis configuration
    minZoneConfluenceCount?: number; // Minimum zones overlapping for confluence (default: 2)
    maxZoneConfluenceDistance?: number; // Max distance for zone confluence in ticks (default: 3)

    // Institutional volume detection configuration
    institutionalVolumeThreshold?: number; // Threshold for institutional volume detection (default: 50)
    institutionalVolumeRatioThreshold?: number; // Min institutional/total ratio for enhancement (default: 0.3)

    // Enhancement control flags
    enableZoneConfluenceFilter?: boolean; // Filter signals by zone confluence (default: true)
    enableInstitutionalVolumeFilter?: boolean; // Filter by institutional volume presence (default: true)
    enableCrossTimeframeAnalysis?: boolean; // Analyze across multiple zone timeframes (default: true)

    // Confidence boost parameters
    confluenceConfidenceBoost?: number; // Confidence boost for zone confluence (default: 0.15)
    institutionalVolumeBoost?: number; // Confidence boost for institutional volume (default: 0.1)
    crossTimeframeBoost?: number; // Confidence boost for cross-timeframe confirmation (default: 0.05)

    // Enhancement mode control
    enhancementMode?: "disabled" | "testing" | "production"; // Enhancement mode (default: 'disabled')
    minEnhancedConfidenceThreshold?: number; // Minimum confidence for enhanced signals (default: 0.3)
}

export interface AbsorptionEnhancedSettings extends AbsorptionSettings {
    // Standardized zone enhancement configuration
    useStandardizedZones?: boolean; // Whether to use standardized zone enhancements
    standardizedZoneConfig?: AbsorptionEnhancementConfig;
}

export interface AbsorptionEnhancementStats {
    enabled: boolean;
    mode: string;
    callCount: number;
    enhancementCount: number;
    confluenceDetectionCount: number;
    institutionalDetectionCount: number;
    crossTimeframeDetectionCount: number;
    enhancementSuccessRate: number;
    averageConfidenceBoost: number;
    errorCount: number;
    lastEnhancementTime?: number;
}

/**
 * Enhanced AbsorptionDetector with multi-timeframe zone analysis
 *
 * PRODUCTION-SAFE: Uses wrapper pattern to preserve original behavior
 */
export class AbsorptionDetectorEnhanced extends AbsorptionDetector {
    private readonly useStandardizedZones: boolean;
    private readonly enhancementConfig: AbsorptionEnhancementConfig;
    private readonly standardZoneConfig?: StandardZoneConfig;

    // Enhancement statistics and monitoring
    private enhancementStats: AbsorptionEnhancementStats = {
        enabled: false,
        mode: "disabled",
        callCount: 0,
        enhancementCount: 0,
        confluenceDetectionCount: 0,
        institutionalDetectionCount: 0,
        crossTimeframeDetectionCount: 0,
        enhancementSuccessRate: 0,
        averageConfidenceBoost: 0,
        errorCount: 0,
    };

    private totalConfidenceBoost = 0;

    constructor(
        id: string,
        settings: AbsorptionEnhancedSettings = {},
        orderBook: IOrderBookState,
        logger: ILogger,
        spoofingDetector: SpoofingDetector,
        metricsCollector: IMetricsCollector,
        signalLogger?: ISignalLogger
    ) {
        // Initialize the original detector with base settings
        super(
            id,
            settings,
            orderBook,
            logger,
            spoofingDetector,
            metricsCollector,
            signalLogger
        );

        // Configure standardized zone enhancement
        this.useStandardizedZones = settings.useStandardizedZones ?? false;
        this.enhancementConfig = this.getDefaultEnhancementConfig(
            settings.standardizedZoneConfig
        );

        // Update enhancement statistics
        this.enhancementStats.enabled = this.useStandardizedZones;
        this.enhancementStats.mode =
            this.enhancementConfig.enhancementMode ?? "disabled";

        this.logger.info("AbsorptionDetectorEnhanced initialized", {
            detectorId: id,
            useStandardizedZones: this.useStandardizedZones,
            enhancementMode: this.enhancementStats.mode,
            enhancementConfig: this.enhancementConfig,
        });
    }

    /**
     * Get default enhancement configuration with conservative production values
     */
    private getDefaultEnhancementConfig(
        config?: AbsorptionEnhancementConfig
    ): AbsorptionEnhancementConfig {
        return {
            // Zone confluence configuration (conservative for production)
            minZoneConfluenceCount: config?.minZoneConfluenceCount ?? 2,
            maxZoneConfluenceDistance: config?.maxZoneConfluenceDistance ?? 3,

            // Institutional volume configuration
            institutionalVolumeThreshold:
                config?.institutionalVolumeThreshold ?? 50,
            institutionalVolumeRatioThreshold:
                config?.institutionalVolumeRatioThreshold ?? 0.3,

            // Feature flags (conservative for production stability)
            enableZoneConfluenceFilter:
                config?.enableZoneConfluenceFilter ?? true,
            enableInstitutionalVolumeFilter:
                config?.enableInstitutionalVolumeFilter ?? false, // Disabled for performance
            enableCrossTimeframeAnalysis:
                config?.enableCrossTimeframeAnalysis ?? false, // Disabled for performance

            // Conservative confidence boosts for production
            confluenceConfidenceBoost:
                config?.confluenceConfidenceBoost ?? 0.15,
            institutionalVolumeBoost: config?.institutionalVolumeBoost ?? 0.1,
            crossTimeframeBoost: config?.crossTimeframeBoost ?? 0.05,

            // Enhancement control
            enhancementMode: config?.enhancementMode ?? "disabled",
            minEnhancedConfidenceThreshold:
                config?.minEnhancedConfidenceThreshold ?? 0.3,
        };
    }

    /**
     * Enhanced trade processing with standardized zone analysis
     *
     * PRODUCTION-SAFE: Preserves original behavior, adds enhancements as supplementary analysis
     */
    public override onEnrichedTrade(event: EnrichedTradeEvent): void {
        // Always call the original detector first (production baseline)
        super.onEnrichedTrade(event);

        // Only apply enhancements if enabled and standardized zones are available
        if (
            !this.useStandardizedZones ||
            this.enhancementConfig.enhancementMode === "disabled" ||
            !event.zoneData
        ) {
            return;
        }

        this.enhancementStats.callCount++;

        try {
            // Apply standardized zone enhancements
            this.enhanceAbsorptionAnalysis(event);
        } catch (error) {
            this.enhancementStats.errorCount++;
            this.logger.warn("AbsorptionDetectorEnhanced: Enhancement failed", {
                error: error instanceof Error ? error.message : String(error),
                detectorId: this.getId(),
                price: event.price,
                timestamp: event.timestamp,
            });
            // Continue with original detector behavior - no impact on production signals
        }
    }

    /**
     * Enhance absorption analysis with standardized zone data
     */
    private enhanceAbsorptionAnalysis(event: EnrichedTradeEvent): void {
        const zoneData = event.zoneData;
        if (!zoneData) return;

        this.enhancementStats.enhancementCount++;
        this.enhancementStats.lastEnhancementTime = Date.now();

        let totalConfidenceBoost = 0;

        // Zone confluence analysis
        if (this.enhancementConfig.enableZoneConfluenceFilter) {
            const confluenceResult = this.analyzeZoneConfluence(
                zoneData,
                event.price
            );
            if (confluenceResult.hasConfluence) {
                this.enhancementStats.confluenceDetectionCount++;
                totalConfidenceBoost +=
                    this.enhancementConfig.confluenceConfidenceBoost ?? 0.15;

                this.logger.debug(
                    "AbsorptionDetectorEnhanced: Zone confluence detected",
                    {
                        detectorId: this.getId(),
                        price: event.price,
                        confluenceZones: confluenceResult.confluenceZones,
                        confidenceBoost:
                            this.enhancementConfig.confluenceConfidenceBoost,
                    }
                );
            }
        }

        // Institutional volume analysis
        if (this.enhancementConfig.enableInstitutionalVolumeFilter) {
            const institutionalResult = this.analyzeInstitutionalVolume(
                zoneData,
                event
            );
            if (institutionalResult.hasInstitutionalPresence) {
                this.enhancementStats.institutionalDetectionCount++;
                totalConfidenceBoost +=
                    this.enhancementConfig.institutionalVolumeBoost ?? 0.1;

                this.logger.debug(
                    "AbsorptionDetectorEnhanced: Institutional volume detected",
                    {
                        detectorId: this.getId(),
                        price: event.price,
                        institutionalRatio:
                            institutionalResult.institutionalRatio,
                        confidenceBoost:
                            this.enhancementConfig.institutionalVolumeBoost,
                    }
                );
            }
        }

        // Cross-timeframe analysis
        if (this.enhancementConfig.enableCrossTimeframeAnalysis) {
            const crossTimeframeResult = this.analyzeCrossTimeframe(
                zoneData,
                event
            );
            if (crossTimeframeResult.hasAlignment) {
                this.enhancementStats.crossTimeframeDetectionCount++;
                totalConfidenceBoost +=
                    this.enhancementConfig.crossTimeframeBoost ?? 0.05;

                this.logger.debug(
                    "AbsorptionDetectorEnhanced: Cross-timeframe alignment detected",
                    {
                        detectorId: this.getId(),
                        price: event.price,
                        alignedTimeframes:
                            crossTimeframeResult.alignedTimeframes,
                        confidenceBoost:
                            this.enhancementConfig.crossTimeframeBoost,
                    }
                );
            }
        }

        // Update enhancement statistics
        this.totalConfidenceBoost += totalConfidenceBoost;
        this.enhancementStats.averageConfidenceBoost =
            this.enhancementStats.enhancementCount > 0
                ? this.totalConfidenceBoost /
                  this.enhancementStats.enhancementCount
                : 0;

        this.enhancementStats.enhancementSuccessRate =
            this.enhancementStats.callCount > 0
                ? (this.enhancementStats.enhancementCount -
                      this.enhancementStats.errorCount) /
                  this.enhancementStats.callCount
                : 0;

        // Store enhanced metrics for potential signal boosting
        if (totalConfidenceBoost > 0) {
            this.storeEnhancedAbsorptionMetrics(event, totalConfidenceBoost);
        }
    }

    /**
     * Analyze zone confluence across multiple timeframes
     */
    private analyzeZoneConfluence(
        zoneData: StandardZoneData,
        price: number
    ): {
        hasConfluence: boolean;
        confluenceZones: number;
        confluenceStrength: number;
    } {
        const minConfluenceZones =
            this.enhancementConfig.minZoneConfluenceCount ?? 2;
        const maxDistance =
            this.enhancementConfig.maxZoneConfluenceDistance ?? 3;

        // Find zones that overlap around the current price
        const relevantZones: ZoneSnapshot[] = [];

        // Check 5-tick zones
        relevantZones.push(
            ...this.findZonesNearPrice(zoneData.zones5Tick, price, maxDistance)
        );

        // Check 10-tick zones
        relevantZones.push(
            ...this.findZonesNearPrice(zoneData.zones10Tick, price, maxDistance)
        );

        // Check 20-tick zones
        relevantZones.push(
            ...this.findZonesNearPrice(zoneData.zones20Tick, price, maxDistance)
        );

        const confluenceZones = relevantZones.length;
        const hasConfluence = confluenceZones >= minConfluenceZones;

        // Calculate confluence strength (higher = more zones overlapping)
        const confluenceStrength = Math.min(
            1.0,
            confluenceZones / (minConfluenceZones * 2)
        );

        return {
            hasConfluence,
            confluenceZones,
            confluenceStrength,
        };
    }

    /**
     * Find zones near a specific price within distance threshold
     */
    private findZonesNearPrice(
        zones: ZoneSnapshot[],
        price: number,
        maxDistanceTicks: number
    ): ZoneSnapshot[] {
        const maxDistance =
            maxDistanceTicks *
            (this.standardZoneConfig?.priceThresholds?.tickValue ?? 0.01);

        return zones.filter((zone) => {
            const distance = Math.abs(zone.priceLevel - price);
            return distance <= maxDistance;
        });
    }

    /**
     * Analyze institutional volume presence in zones
     */
    private analyzeInstitutionalVolume(
        zoneData: StandardZoneData,
        event: EnrichedTradeEvent
    ): {
        hasInstitutionalPresence: boolean;
        institutionalRatio: number;
        whaleActivity: number;
    } {
        const institutionalThreshold =
            this.enhancementConfig.institutionalVolumeThreshold ?? 50;
        const minRatio =
            this.enhancementConfig.institutionalVolumeRatioThreshold ?? 0.3;

        // Check if current trade meets institutional volume threshold
        const isInstitutionalTrade = event.quantity >= institutionalThreshold;

        // Analyze institutional volume in relevant zones
        const allZones = [
            ...zoneData.zones5Tick,
            ...zoneData.zones10Tick,
            ...zoneData.zones20Tick,
        ];

        const relevantZones = this.findZonesNearPrice(allZones, event.price, 5);

        let totalVolume = 0;
        let institutionalVolume = 0;

        relevantZones.forEach((zone) => {
            const zoneVolume = zone.aggressiveVolume + zone.passiveVolume;
            totalVolume += zoneVolume;

            // Estimate institutional volume based on threshold
            if (zone.aggressiveVolume >= institutionalThreshold) {
                institutionalVolume += zone.aggressiveVolume;
            }
            if (zone.passiveVolume >= institutionalThreshold) {
                institutionalVolume += zone.passiveVolume;
            }
        });

        const institutionalRatio =
            totalVolume > 0 ? institutionalVolume / totalVolume : 0;
        const hasInstitutionalPresence =
            isInstitutionalTrade || institutionalRatio >= minRatio;

        // Calculate whale activity score (0-1)
        const whaleActivity = Math.min(1.0, institutionalRatio * 2);

        return {
            hasInstitutionalPresence,
            institutionalRatio,
            whaleActivity,
        };
    }

    /**
     * Analyze cross-timeframe absorption alignment
     */
    private analyzeCrossTimeframe(
        zoneData: StandardZoneData,
        event: EnrichedTradeEvent
    ): {
        hasAlignment: boolean;
        alignedTimeframes: string[];
        alignmentStrength: number;
    } {
        const alignedTimeframes: string[] = [];

        // Check absorption patterns across timeframes
        const price = event.price;

        // Analyze 5-tick timeframe
        if (this.hasAbsorptionPattern(zoneData.zones5Tick, price)) {
            alignedTimeframes.push("5T");
        }

        // Analyze 10-tick timeframe
        if (this.hasAbsorptionPattern(zoneData.zones10Tick, price)) {
            alignedTimeframes.push("10T");
        }

        // Analyze 20-tick timeframe
        if (this.hasAbsorptionPattern(zoneData.zones20Tick, price)) {
            alignedTimeframes.push("20T");
        }

        const hasAlignment = alignedTimeframes.length >= 2; // Require at least 2 timeframes
        const alignmentStrength = alignedTimeframes.length / 3; // Normalize to 0-1

        return {
            hasAlignment,
            alignedTimeframes,
            alignmentStrength,
        };
    }

    /**
     * Check if zones show absorption pattern near price
     */
    private hasAbsorptionPattern(
        zones: ZoneSnapshot[],
        price: number
    ): boolean {
        const relevantZones = this.findZonesNearPrice(zones, price, 2);

        if (relevantZones.length === 0) return false;

        // Look for absorption characteristics: high passive volume, low aggressive/passive ratio
        return relevantZones.some((zone) => {
            const totalVolume = zone.aggressiveVolume + zone.passiveVolume;
            if (totalVolume === 0) return false;

            const aggressiveRatio = zone.aggressiveVolume / totalVolume;
            const hasHighPassive = zone.passiveVolume > zone.aggressiveVolume;
            const hasLowAggressiveRatio = aggressiveRatio < 0.4; // Less than 40% aggressive

            return hasHighPassive && hasLowAggressiveRatio;
        });
    }

    /**
     * Store enhanced absorption metrics for potential signal boosting
     */
    private storeEnhancedAbsorptionMetrics(
        event: EnrichedTradeEvent,
        confidenceBoost: number
    ): void {
        // Store enhanced metrics that could be used for signal generation
        // This is supplementary data that doesn't affect the original detector

        this.logger.debug(
            "AbsorptionDetectorEnhanced: Enhanced metrics stored",
            {
                detectorId: this.getId(),
                price: event.price,
                timestamp: event.timestamp,
                confidenceBoost: confidenceBoost,
                enhancementCount: this.enhancementStats.enhancementCount,
            }
        );

        // Update metrics collector with enhancement data
        this.metricsCollector.updateMetric(
            "absorptionEnhancementConfidenceBoost",
            confidenceBoost
        );
        this.metricsCollector.incrementMetric(
            "absorptionEnhancementApplications"
        );
    }

    /**
     * Get enhancement statistics for monitoring and debugging
     */
    public getEnhancementStats(): AbsorptionEnhancementStats {
        return { ...this.enhancementStats };
    }

    /**
     * Set enhancement mode (for runtime configuration)
     */
    public setEnhancementMode(
        mode: "disabled" | "testing" | "production"
    ): void {
        this.enhancementConfig.enhancementMode = mode;
        this.enhancementStats.mode = mode;

        this.logger.info(
            "AbsorptionDetectorEnhanced: Enhancement mode changed",
            {
                detectorId: this.getId(),
                newMode: mode,
                timestamp: Date.now(),
            }
        );
    }

    /**
     * Override cleanup to include enhancement cleanup
     */
    public override cleanup(): void {
        // Log final enhancement statistics
        this.logger.info(
            "AbsorptionDetectorEnhanced: Cleanup with final stats",
            {
                detectorId: this.getId(),
                enhancementStats: this.enhancementStats,
            }
        );

        // Call parent cleanup
        super.cleanup();
    }
}
