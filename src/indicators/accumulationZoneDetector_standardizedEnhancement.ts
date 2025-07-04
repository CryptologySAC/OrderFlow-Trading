// src/indicators/accumulationZoneDetector_standardizedEnhancement.ts
//
// 🎯 PROOF OF CONCEPT: StandardizedZone Enhancement for AccumulationZoneDetector
//
// PURPOSE: Demonstrate integration value of standardized zones with existing
//          production AccumulationZoneDetector without modifying core logic
//
// APPROACH: Supplementary analysis layer that leverages standardized zone data
//           to enhance accumulation detection precision and reduce false signals
//
// BENEFITS DEMONSTRATION:
// 1. Cross-detector zone correlation (5T, 10T, 20T analysis)
// 2. Enhanced institutional volume detection across multiple timeframes
// 3. Zone confluence analysis for higher confidence signals
// 4. Standardized zone-based filtering to reduce false positives
//
// SAFETY: Pure analysis enhancement - does not modify AccumulationZoneDetector
//

import type {
    EnrichedTradeEvent,
    StandardZoneData,
    ZoneSnapshot,
} from "../types/marketEvents.js";
import type { ILogger } from "../infrastructure/loggerInterface.js";
import { FinancialMath } from "../utils/financialMath.js";

/**
 * Configuration for standardized zone enhancement analysis
 */
export interface StandardizedZoneEnhancementConfig {
    // Zone confluence analysis
    minZoneConfluenceCount?: number; // Minimum zones overlapping for confluence (default: 2)
    maxZoneConfluenceDistance?: number; // Max distance for zone confluence in ticks (default: 3)

    // Volume analysis thresholds
    institutionalVolumeThreshold?: number; // Threshold for institutional volume detection (default: 50)
    passiveVolumeRatioThreshold?: number; // Min passive/aggressive ratio for accumulation (default: 1.5)

    // Signal enhancement filters
    enableZoneConfluenceFilter?: boolean; // Filter signals by zone confluence (default: true)
    enableInstitutionalVolumeFilter?: boolean; // Filter by institutional volume presence (default: true)
    enableCrossTimeframeAnalysis?: boolean; // Analyze across multiple zone timeframes (default: true)

    // Confidence boosting
    confluenceConfidenceBoost?: number; // Confidence boost for zone confluence (default: 0.2)
    institutionalVolumeBoost?: number; // Confidence boost for institutional volume (default: 0.15)
    crossTimeframeBoost?: number; // Confidence boost for cross-timeframe confirmation (default: 0.1)
}

/**
 * Enhanced analysis result with standardized zone insights
 */
export interface StandardizedZoneAnalysisResult {
    // Core enhancement metrics
    hasZoneConfluence: boolean;
    confluenceZoneCount: number;
    confluenceStrength: number; // 0-1 scale

    // Institutional volume insights
    institutionalVolumePresent: boolean;
    institutionalVolumeRatio: number; // Ratio of institutional to total volume
    dominantTimeframe: "5T" | "10T" | "20T" | "adaptive" | null;

    // Cross-timeframe analysis
    crossTimeframeConfirmation: boolean;
    timeframeCorrelation: number; // 0-1 correlation across timeframes
    timeframesInAgreement: number; // Number of timeframes in agreement

    // Signal enhancement recommendations
    confidenceBoost: number; // Suggested confidence boost (0-1)
    signalQualityScore: number; // Overall signal quality enhancement (0-1)
    recommendedAction: "enhance" | "filter" | "neutral";

    // Supporting data
    relevantZones: ZoneSnapshot[];
    volumeAnalysis: {
        totalPassiveVolume: number;
        totalAggressiveVolume: number;
        passiveAggressiveRatio: number;
        institutionalZoneCount: number;
    };
}

/**
 * Proof of Concept: Standardized Zone Enhancement Layer
 *
 * Provides supplementary analysis to AccumulationZoneDetector using
 * standardized zone data for enhanced signal quality and precision.
 */
export class AccumulationZoneStandardizedEnhancement {
    private readonly config: Required<StandardizedZoneEnhancementConfig>;
    private readonly logger: ILogger;

    constructor(config: StandardizedZoneEnhancementConfig, logger: ILogger) {
        this.config = {
            minZoneConfluenceCount: config.minZoneConfluenceCount ?? 2,
            maxZoneConfluenceDistance: config.maxZoneConfluenceDistance ?? 3,
            institutionalVolumeThreshold:
                config.institutionalVolumeThreshold ?? 50,
            passiveVolumeRatioThreshold:
                config.passiveVolumeRatioThreshold ?? 1.5,
            enableZoneConfluenceFilter:
                config.enableZoneConfluenceFilter ?? true,
            enableInstitutionalVolumeFilter:
                config.enableInstitutionalVolumeFilter ?? true,
            enableCrossTimeframeAnalysis:
                config.enableCrossTimeframeAnalysis ?? true,
            confluenceConfidenceBoost: config.confluenceConfidenceBoost ?? 0.2,
            institutionalVolumeBoost: config.institutionalVolumeBoost ?? 0.15,
            crossTimeframeBoost: config.crossTimeframeBoost ?? 0.1,
        };
        this.logger = logger;
    }

    /**
     * Enhance accumulation zone analysis with standardized zone insights
     *
     * @param trade - Current trade event with zone data
     * @param accumulationAnalysis - Result from AccumulationZoneDetector.analyze()
     * @param targetPrice - Price level being analyzed for accumulation
     * @returns Enhanced analysis with standardized zone insights
     */
    public enhanceAccumulationAnalysis(
        trade: EnrichedTradeEvent,
        targetPrice: number
    ): StandardizedZoneAnalysisResult | null {
        // Verify standardized zone data is available
        if (!trade.zoneData) {
            this.logger.debug(
                "No standardized zone data available for enhancement"
            );
            return null;
        }

        const zoneData = trade.zoneData;

        // 1. Zone Confluence Analysis
        const confluenceAnalysis = this.analyzeZoneConfluence(
            zoneData,
            targetPrice
        );

        // 2. Institutional Volume Detection
        const institutionalAnalysis = this.analyzeInstitutionalVolume(zoneData);

        // 3. Cross-Timeframe Correlation
        const crossTimeframeAnalysis =
            this.analyzeCrossTimeframeCorrelation(zoneData);

        // 4. Calculate enhancement recommendations
        const enhancement = this.calculateEnhancementRecommendations(
            confluenceAnalysis,
            institutionalAnalysis,
            crossTimeframeAnalysis
        );

        return enhancement;
    }

    /**
     * Analyze zone confluence around target price
     */
    private analyzeZoneConfluence(
        zoneData: StandardZoneData,
        targetPrice: number
    ): {
        hasConfluence: boolean;
        confluenceCount: number;
        confluenceStrength: number;
        relevantZones: ZoneSnapshot[];
    } {
        const allZones = [
            ...zoneData.zones5Tick,
            ...zoneData.zones10Tick,
            ...zoneData.zones20Tick,
            ...(zoneData.adaptiveZones || []),
        ];

        const maxDistance =
            this.config.maxZoneConfluenceDistance *
            (zoneData.zoneConfig?.tickValue || 0.01);

        // Find zones near target price
        const nearbyZones = allZones.filter((zone) => {
            const distance = Math.abs(zone.priceLevel - targetPrice);
            return distance <= maxDistance;
        });

        const confluenceCount = nearbyZones.length;
        const hasConfluence =
            confluenceCount >= this.config.minZoneConfluenceCount;

        // Calculate confluence strength based on zone overlap and volume
        let confluenceStrength = 0;
        if (hasConfluence) {
            const totalVolume = nearbyZones.reduce(
                (sum, zone) => sum + zone.aggressiveVolume + zone.passiveVolume,
                0
            );
            const avgVolume = totalVolume / confluenceCount;

            // Normalize strength based on volume concentration
            confluenceStrength = Math.min(
                1.0,
                (avgVolume / 100) * (confluenceCount / 4)
            );
        }

        return {
            hasConfluence,
            confluenceCount,
            confluenceStrength,
            relevantZones: nearbyZones,
        };
    }

    /**
     * Analyze institutional volume presence across zone timeframes
     */
    private analyzeInstitutionalVolume(zoneData: StandardZoneData): {
        institutionalPresent: boolean;
        institutionalRatio: number;
        dominantTimeframe: "5T" | "10T" | "20T" | "adaptive" | null;
        passiveAggressiveRatio: number;
    } {
        const timeframes = [
            { zones: zoneData.zones5Tick, name: "5T" as const },
            { zones: zoneData.zones10Tick, name: "10T" as const },
            { zones: zoneData.zones20Tick, name: "20T" as const },
            { zones: zoneData.adaptiveZones || [], name: "adaptive" as const },
        ];

        let maxInstitutionalVolume = 0;
        let dominantTimeframe: "5T" | "10T" | "20T" | "adaptive" | null = null;
        let totalPassiveVolume = 0;
        let totalAggressiveVolume = 0;

        for (const timeframe of timeframes) {
            for (const zone of timeframe.zones) {
                // Use total volume (passive + aggressive) as institutional indicator
                const totalZoneVolume =
                    zone.aggressiveVolume + zone.passiveVolume;

                if (totalZoneVolume > maxInstitutionalVolume) {
                    maxInstitutionalVolume = totalZoneVolume;
                    dominantTimeframe = timeframe.name;
                }

                totalPassiveVolume += zone.passiveVolume;
                totalAggressiveVolume += zone.aggressiveVolume;
            }
        }

        const institutionalPresent =
            maxInstitutionalVolume >= this.config.institutionalVolumeThreshold;
        const totalVolume = totalPassiveVolume + totalAggressiveVolume;
        const institutionalRatio =
            totalVolume > 0 ? maxInstitutionalVolume / totalVolume : 0;
        const passiveAggressiveRatio =
            totalAggressiveVolume > 0
                ? totalPassiveVolume / totalAggressiveVolume
                : 0;

        return {
            institutionalPresent,
            institutionalRatio,
            dominantTimeframe,
            passiveAggressiveRatio,
        };
    }

    /**
     * Analyze correlation across different zone timeframes
     */
    private analyzeCrossTimeframeCorrelation(zoneData: StandardZoneData): {
        hasCorrelation: boolean;
        correlationStrength: number;
        timeframesInAgreement: number;
    } {
        const timeframes = [
            zoneData.zones5Tick,
            zoneData.zones10Tick,
            zoneData.zones20Tick,
        ];

        const correlations: number[] = [];
        let timeframesInAgreement = 0;

        // Analyze volume patterns across timeframes
        for (let i = 0; i < timeframes.length - 1; i++) {
            for (let j = i + 1; j < timeframes.length; j++) {
                const tf1Zones = timeframes[i];
                const tf2Zones = timeframes[j];

                // Calculate volume correlation between timeframes
                const correlation = this.calculateVolumeCorrelation(
                    tf1Zones,
                    tf2Zones
                );
                correlations.push(correlation);

                if (correlation > 0.6) {
                    // Strong correlation threshold
                    timeframesInAgreement++;
                }
            }
        }

        const avgCorrelation =
            correlations.length > 0
                ? FinancialMath.calculateMean(correlations)
                : 0;

        return {
            hasCorrelation: avgCorrelation > 0.5,
            correlationStrength: avgCorrelation,
            timeframesInAgreement,
        };
    }

    /**
     * Calculate volume correlation between two zone arrays
     */
    private calculateVolumeCorrelation(
        zones1: ZoneSnapshot[],
        zones2: ZoneSnapshot[]
    ): number {
        if (zones1.length === 0 || zones2.length === 0) return 0;

        // Calculate normalized volume distributions
        const vol1Avg = FinancialMath.calculateMean(
            zones1.map((z) => z.aggressiveVolume + z.passiveVolume)
        );
        const vol2Avg = FinancialMath.calculateMean(
            zones2.map((z) => z.aggressiveVolume + z.passiveVolume)
        );

        if (vol1Avg === 0 || vol2Avg === 0) return 0;

        // Calculate passive/aggressive ratios for correlation
        const passiveRatio1 =
            zones1.length > 0
                ? FinancialMath.calculateMean(
                      zones1.map(
                          (z) =>
                              z.passiveVolume / Math.max(z.aggressiveVolume, 1)
                      )
                  )
                : 0;
        const passiveRatio2 =
            zones2.length > 0
                ? FinancialMath.calculateMean(
                      zones2.map(
                          (z) =>
                              z.passiveVolume / Math.max(z.aggressiveVolume, 1)
                      )
                  )
                : 0;

        // Calculate volume magnitude correlation
        const volCorrelation =
            Math.min(vol1Avg, vol2Avg) / Math.max(vol1Avg, vol2Avg);

        // Calculate pattern correlation (passive/aggressive ratios)
        const ratioCorrelation =
            Math.min(passiveRatio1, passiveRatio2) /
            Math.max(passiveRatio1, passiveRatio2);

        // Combined correlation (weighted average)
        return volCorrelation * 0.6 + ratioCorrelation * 0.4;
    }

    /**
     * Calculate final enhancement recommendations
     */
    private calculateEnhancementRecommendations(
        confluenceAnalysis: ReturnType<
            AccumulationZoneStandardizedEnhancement["analyzeZoneConfluence"]
        >,
        institutionalAnalysis: ReturnType<
            AccumulationZoneStandardizedEnhancement["analyzeInstitutionalVolume"]
        >,
        crossTimeframeAnalysis: ReturnType<
            AccumulationZoneStandardizedEnhancement["analyzeCrossTimeframeCorrelation"]
        >
    ): StandardizedZoneAnalysisResult {
        // Calculate confidence boost
        let confidenceBoost = 0;

        if (confluenceAnalysis.hasConfluence) {
            confidenceBoost +=
                this.config.confluenceConfidenceBoost *
                confluenceAnalysis.confluenceStrength;
        }

        if (institutionalAnalysis.institutionalPresent) {
            confidenceBoost +=
                this.config.institutionalVolumeBoost *
                institutionalAnalysis.institutionalRatio;
        }

        if (crossTimeframeAnalysis.hasCorrelation) {
            confidenceBoost +=
                this.config.crossTimeframeBoost *
                crossTimeframeAnalysis.correlationStrength;
        }

        // Calculate overall signal quality score with normalized factors
        const qualityFactors = [
            confluenceAnalysis.confluenceStrength,
            institutionalAnalysis.institutionalRatio * 2, // Weight institutional ratio higher
            crossTimeframeAnalysis.correlationStrength,
            institutionalAnalysis.passiveAggressiveRatio >=
            this.config.passiveVolumeRatioThreshold
                ? 1
                : 0.2, // More harsh penalty
        ];

        const signalQualityScore = Math.min(
            1.0,
            FinancialMath.calculateMean(qualityFactors)
        );

        // Determine recommended action with adjusted thresholds
        let recommendedAction: "enhance" | "filter" | "neutral";

        if (
            signalQualityScore > 0.6 &&
            confidenceBoost > 0.15 &&
            institutionalAnalysis.institutionalPresent
        ) {
            recommendedAction = "enhance";
        } else if (
            signalQualityScore < 0.4 ||
            (!institutionalAnalysis.institutionalPresent &&
                this.config.enableInstitutionalVolumeFilter)
        ) {
            recommendedAction = "filter";
        } else {
            recommendedAction = "neutral";
        }

        return {
            hasZoneConfluence: confluenceAnalysis.hasConfluence,
            confluenceZoneCount: confluenceAnalysis.confluenceCount,
            confluenceStrength: confluenceAnalysis.confluenceStrength,

            institutionalVolumePresent:
                institutionalAnalysis.institutionalPresent,
            institutionalVolumeRatio: institutionalAnalysis.institutionalRatio,
            dominantTimeframe: institutionalAnalysis.dominantTimeframe,

            crossTimeframeConfirmation: crossTimeframeAnalysis.hasCorrelation,
            timeframeCorrelation: crossTimeframeAnalysis.correlationStrength,
            timeframesInAgreement: crossTimeframeAnalysis.timeframesInAgreement,

            confidenceBoost,
            signalQualityScore,
            recommendedAction,

            relevantZones: confluenceAnalysis.relevantZones,
            volumeAnalysis: {
                totalPassiveVolume: confluenceAnalysis.relevantZones.reduce(
                    (sum, z) => sum + z.passiveVolume,
                    0
                ),
                totalAggressiveVolume: confluenceAnalysis.relevantZones.reduce(
                    (sum, z) => sum + z.aggressiveVolume,
                    0
                ),
                passiveAggressiveRatio:
                    institutionalAnalysis.passiveAggressiveRatio,
                institutionalZoneCount: confluenceAnalysis.relevantZones.filter(
                    (z) =>
                        z.aggressiveVolume + z.passiveVolume >=
                        this.config.institutionalVolumeThreshold
                ).length,
            },
        };
    }
}
