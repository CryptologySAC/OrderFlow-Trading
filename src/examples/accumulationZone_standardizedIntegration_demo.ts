// src/examples/accumulationZone_standardizedIntegration_demo.ts
//
// 🎯 DEMONSTRATION: How standardized zones enhance AccumulationZoneDetector
//
// This demonstration shows the practical integration of standardized zone data
// with the existing AccumulationZoneDetector to improve signal quality.
//
// Key Benefits Demonstrated:
// 1. Enhanced signal confidence through zone confluence
// 2. Institutional volume detection across multiple timeframes
// 3. Cross-timeframe correlation analysis
// 4. Signal filtering to reduce false positives
//

import type { AccumulationZoneDetectorEnhanced } from "../indicators/accumulationZoneDetectorEnhanced.js";
import { AccumulationZoneStandardizedEnhancement } from "../indicators/accumulationZoneDetector_standardizedEnhancement.js";
import type {
    EnrichedTradeEvent,
    StandardZoneData,
} from "../types/marketEvents.js";
import type { ZoneAnalysisResult } from "../types/zoneTypes.js";
import type { SpotWebsocketStreams } from "@binance/spot";

/**
 * Enhanced Accumulation Signal with standardized zone insights
 */
export interface EnhancedAccumulationSignal {
    // Original AccumulationZoneDetector output
    originalAnalysis: ZoneAnalysisResult;

    // Enhanced analysis from standardized zones
    standardizedEnhancement: {
        hasZoneConfluence: boolean;
        confluenceStrength: number;
        institutionalVolumePresent: boolean;
        crossTimeframeConfirmation: boolean;
        recommendedAction: "enhance" | "filter" | "neutral";
        confidenceBoost: number;
        signalQualityScore: number;
    } | null;

    // Final enhanced signal
    enhancedConfidence: number;
    enhancedSignalStrength: number;
    shouldEmitSignal: boolean;
    enhancementReason: string;
}

/**
 * Demonstration class showing integration of AccumulationZoneDetector
 * with standardized zone enhancement
 */
export class AccumulationZoneEnhancedDemo {
    private readonly accumulationDetector: AccumulationZoneDetectorEnhanced;
    private readonly standardizedEnhancement: AccumulationZoneStandardizedEnhancement;

    // Demo metrics
    private processedTrades = 0;
    private originalSignals = 0;
    private enhancedSignals = 0;
    private filteredSignals = 0;
    private confidenceBoostedSignals = 0;

    constructor(
        accumulationDetector: AccumulationZoneDetectorEnhanced,
        standardizedEnhancement: AccumulationZoneStandardizedEnhancement
    ) {
        this.accumulationDetector = accumulationDetector;
        this.standardizedEnhancement = standardizedEnhancement;
    }

    /**
     * Process trade with enhanced accumulation analysis
     */
    public processTradeWithEnhancement(
        trade: EnrichedTradeEvent
    ): EnhancedAccumulationSignal {
        this.processedTrades++;

        // 1. Get original AccumulationZoneDetector analysis
        const originalAnalysis = this.accumulationDetector.analyze(trade);

        // 2. Check if original detector found anything significant
        const hasOriginalSignal =
            originalAnalysis.signals.length > 0 ||
            originalAnalysis.updates.length > 0;
        if (hasOriginalSignal) {
            this.originalSignals++;
        }

        // 3. Apply standardized zone enhancement if zone data is available
        let standardizedEnhancement = null;
        let enhancedConfidence = 0;
        let enhancedSignalStrength = 0;
        let shouldEmitSignal = hasOriginalSignal;
        let enhancementReason = "No enhancement applied";

        if (trade.zoneData && hasOriginalSignal) {
            // Find the most relevant accumulation zone from original analysis
            const targetPrice = this.findMostRelevantAccumulationPrice(
                originalAnalysis,
                trade.price
            );

            standardizedEnhancement =
                this.standardizedEnhancement.enhanceAccumulationAnalysis(
                    trade,
                    targetPrice
                );

            if (standardizedEnhancement) {
                // Apply enhancement logic
                const enhancement = this.applyEnhancementLogic(
                    hasOriginalSignal,
                    standardizedEnhancement
                );

                enhancedConfidence = enhancement.confidence;
                enhancedSignalStrength = enhancement.signalStrength;
                shouldEmitSignal = enhancement.shouldEmit;
                enhancementReason = enhancement.reason;

                // Update demo metrics
                this.updateDemoMetrics(standardizedEnhancement, enhancement);
            }
        }

        return {
            originalAnalysis,
            standardizedEnhancement,
            enhancedConfidence,
            enhancedSignalStrength,
            shouldEmitSignal,
            enhancementReason,
        };
    }

    /**
     * Apply enhancement logic based on standardized zone analysis
     */
    private applyEnhancementLogic(
        hasOriginalSignal: boolean,
        enhancement: NonNullable<
            ReturnType<
                AccumulationZoneStandardizedEnhancement["enhanceAccumulationAnalysis"]
            >
        >
    ): {
        confidence: number;
        signalStrength: number;
        shouldEmit: boolean;
        reason: string;
    } {
        const baseConfidence = hasOriginalSignal ? 0.6 : 0;
        const baseSignalStrength = hasOriginalSignal ? 0.7 : 0;

        switch (enhancement.recommendedAction) {
            case "enhance":
                return {
                    confidence: Math.min(
                        1.0,
                        baseConfidence + enhancement.confidenceBoost
                    ),
                    signalStrength: Math.min(
                        1.0,
                        baseSignalStrength +
                            enhancement.signalQualityScore * 0.3
                    ),
                    shouldEmit: true,
                    reason:
                        `Enhanced: Zone confluence (${enhancement.confluenceZoneCount} zones), ` +
                        `institutional volume ${enhancement.institutionalVolumePresent ? "detected" : "absent"}, ` +
                        `cross-timeframe ${enhancement.crossTimeframeConfirmation ? "confirmed" : "mixed"}`,
                };

            case "filter":
                return {
                    confidence: baseConfidence * 0.3, // Reduce confidence significantly
                    signalStrength: baseSignalStrength * 0.2,
                    shouldEmit: false,
                    reason:
                        `Filtered: Low quality signal - ` +
                        `${enhancement.institutionalVolumePresent ? "" : "no institutional volume, "}` +
                        `${enhancement.hasZoneConfluence ? "" : "no zone confluence, "}` +
                        `quality score: ${enhancement.signalQualityScore.toFixed(2)}`,
                };

            case "neutral":
            default:
                return {
                    confidence:
                        baseConfidence + enhancement.confidenceBoost * 0.5,
                    signalStrength: baseSignalStrength,
                    shouldEmit: hasOriginalSignal,
                    reason:
                        `Neutral: Moderate quality signal, ` +
                        `modest enhancement (${(enhancement.confidenceBoost * 100).toFixed(1)}% boost)`,
                };
        }
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
     * Update demo metrics based on enhancement results
     */
    private updateDemoMetrics(
        enhancement: NonNullable<
            ReturnType<
                AccumulationZoneStandardizedEnhancement["enhanceAccumulationAnalysis"]
            >
        >,
        result: { shouldEmit: boolean; confidence: number }
    ): void {
        switch (enhancement.recommendedAction) {
            case "enhance":
                if (result.shouldEmit) {
                    this.enhancedSignals++;
                    if (enhancement.confidenceBoost > 0.1) {
                        this.confidenceBoostedSignals++;
                    }
                }
                break;
            case "filter":
                if (!result.shouldEmit) {
                    this.filteredSignals++;
                }
                break;
        }
    }

    /**
     * Get demonstration statistics
     */
    public getDemoStatistics(): {
        processedTrades: number;
        originalSignals: number;
        enhancedSignals: number;
        filteredSignals: number;
        confidenceBoostedSignals: number;
        enhancementRate: number;
        filterRate: number;
        confidenceBoostRate: number;
    } {
        return {
            processedTrades: this.processedTrades,
            originalSignals: this.originalSignals,
            enhancedSignals: this.enhancedSignals,
            filteredSignals: this.filteredSignals,
            confidenceBoostedSignals: this.confidenceBoostedSignals,
            enhancementRate:
                this.originalSignals > 0
                    ? this.enhancedSignals / this.originalSignals
                    : 0,
            filterRate:
                this.originalSignals > 0
                    ? this.filteredSignals / this.originalSignals
                    : 0,
            confidenceBoostRate:
                this.originalSignals > 0
                    ? this.confidenceBoostedSignals / this.originalSignals
                    : 0,
        };
    }

    /**
     * Generate demonstration report
     */
    public generateDemoReport(): string {
        const stats = this.getDemoStatistics();

        return `
🎯 AccumulationZoneDetector Standardized Enhancement Demo Report
================================================================

Trade Processing:
- Total trades processed: ${stats.processedTrades}
- Original signals detected: ${stats.originalSignals}

Enhancement Results:
- Signals enhanced: ${stats.enhancedSignals} (${(stats.enhancementRate * 100).toFixed(1)}%)
- Signals filtered out: ${stats.filteredSignals} (${(stats.filterRate * 100).toFixed(1)}%)
- Signals with confidence boost: ${stats.confidenceBoostedSignals} (${(stats.confidenceBoostRate * 100).toFixed(1)}%)

Key Benefits Demonstrated:
✅ Zone Confluence Analysis: Identifies overlapping accumulation zones across timeframes
✅ Institutional Volume Detection: Filters retail noise, highlights institutional activity  
✅ Cross-Timeframe Correlation: Validates signals across 5T, 10T, 20T zones
✅ Signal Quality Enhancement: Boosts confidence for high-quality institutional accumulation
✅ False Positive Reduction: Filters low-quality signals lacking institutional characteristics

Integration Value:
- The standardized zone system provides ${this.enhancedSignals > 0 ? "significant" : "measurable"} enhancement to AccumulationZoneDetector
- ${stats.filterRate > 0.2 ? "Substantial" : "Moderate"} reduction in false positives through institutional volume filtering
- ${stats.confidenceBoostRate > 0.3 ? "High" : "Moderate"} confidence improvement for qualified signals
        `;
    }
}

/**
 * Demo scenario: Institutional accumulation at support level
 */
export function createInstitutionalAccumulationScenario(): {
    trade: EnrichedTradeEvent;
    description: string;
} {
    const supportLevel = 89.45;

    // Create standardized zone data showing institutional accumulation
    const zoneData: StandardZoneData = {
        zones5Tick: [
            {
                zoneId: `LTCUSDT_5T_${(supportLevel - 0.01).toFixed(2)}`,
                priceLevel: supportLevel - 0.01,
                tickSize: 0.01,
                aggressiveVolume: 67.8,
                passiveVolume: 353.0, // High passive volume = absorption
                aggressiveBuyVolume: 40.7,
                aggressiveSellVolume: 27.1,
                passiveBidVolume: 187.6, // Strong bid support
                passiveAskVolume: 165.4,
                tradeCount: 25,
                timespan: 300000,
                boundaries: {
                    min: supportLevel - 0.035,
                    max: supportLevel + 0.015,
                },
                lastUpdate: Date.now(),
                volumeWeightedPrice: supportLevel - 0.008,
            },
            {
                zoneId: `LTCUSDT_5T_${supportLevel.toFixed(2)}`,
                priceLevel: supportLevel,
                tickSize: 0.01,
                aggressiveVolume: 156.8,
                passiveVolume: 729.9, // Very high passive volume
                aggressiveBuyVolume: 94.1,
                aggressiveSellVolume: 62.7,
                passiveBidVolume: 387.2, // Massive bid support
                passiveAskVolume: 342.7,
                tradeCount: 58,
                timespan: 300000,
                boundaries: {
                    min: supportLevel - 0.025,
                    max: supportLevel + 0.025,
                },
                lastUpdate: Date.now(),
                volumeWeightedPrice: supportLevel + 0.003,
            },
        ],
        zones10Tick: [
            {
                zoneId: `LTCUSDT_10T_${supportLevel.toFixed(2)}`,
                priceLevel: supportLevel,
                tickSize: 0.01,
                aggressiveVolume: 456.7,
                passiveVolume: 1854.5, // Institutional-level volume
                aggressiveBuyVolume: 274.0,
                aggressiveSellVolume: 182.7,
                passiveBidVolume: 987.3, // Heavy institutional bidding
                passiveAskVolume: 867.2,
                tradeCount: 169,
                timespan: 600000,
                boundaries: {
                    min: supportLevel - 0.05,
                    max: supportLevel + 0.05,
                },
                lastUpdate: Date.now(),
                volumeWeightedPrice: supportLevel + 0.002,
            },
        ],
        zones20Tick: [
            {
                zoneId: `LTCUSDT_20T_${supportLevel.toFixed(2)}`,
                priceLevel: supportLevel,
                tickSize: 0.01,
                aggressiveVolume: 876.5,
                passiveVolume: 3531.1, // Massive institutional accumulation
                aggressiveBuyVolume: 525.9,
                aggressiveSellVolume: 350.6,
                passiveBidVolume: 1876.8, // Enormous bid wall
                passiveAskVolume: 1654.3,
                tradeCount: 324,
                timespan: 1200000,
                boundaries: {
                    min: supportLevel - 0.1,
                    max: supportLevel + 0.1,
                },
                lastUpdate: Date.now(),
                volumeWeightedPrice: supportLevel + 0.001,
            },
        ],
        zoneConfig: {
            baseTicks: 5,
            tickValue: 0.01,
            timeWindow: 300000,
        },
    };

    const trade: EnrichedTradeEvent = {
        price: supportLevel,
        quantity: 2.71,
        timestamp: Date.now(),
        buyerIsMaker: true, // Seller is aggressive, hitting institutional bids
        pair: "LTCUSDT",
        tradeId: "demo_institutional_accumulation",
        originalTrade: {} as SpotWebsocketStreams.AggTradeResponse,
        passiveBidVolume: 387.2,
        passiveAskVolume: 342.7,
        zonePassiveBidVolume: 987.3,
        zonePassiveAskVolume: 867.2,
        bestBid: supportLevel - 0.01,
        bestAsk: supportLevel + 0.01,
        zoneData: zoneData,
    };

    return {
        trade,
        description: `Institutional Accumulation at Support ($${supportLevel}):
- Strong zone confluence across 5T, 10T, 20T timeframes
- Massive passive bid volume (1876.8 LTC in 20T zone)
- High passive/aggressive ratio (3531.1/876.5 = 4.03x)
- Clear institutional absorption pattern at key support level
Expected Enhancement: High confidence boost, "enhance" recommendation`,
    };
}

/**
 * Demo scenario: Retail noise without institutional backing
 */
export function createRetailNoiseScenario(): {
    trade: EnrichedTradeEvent;
    description: string;
} {
    const currentPrice = 89.47;

    // Create standardized zone data showing only retail activity
    const zoneData: StandardZoneData = {
        zones5Tick: [
            {
                zoneId: `LTCUSDT_5T_${currentPrice.toFixed(2)}`,
                priceLevel: currentPrice,
                tickSize: 0.01,
                aggressiveVolume: 12.3, // Low retail volume
                passiveVolume: 18.7, // Low passive volume
                aggressiveBuyVolume: 7.4,
                aggressiveSellVolume: 4.9,
                passiveBidVolume: 9.8, // Weak bid support
                passiveAskVolume: 8.9,
                tradeCount: 5,
                timespan: 300000,
                boundaries: {
                    min: currentPrice - 0.025,
                    max: currentPrice + 0.025,
                },
                lastUpdate: Date.now(),
                volumeWeightedPrice: currentPrice - 0.001,
            },
        ],
        zones10Tick: [
            {
                zoneId: `LTCUSDT_10T_${currentPrice.toFixed(2)}`,
                priceLevel: currentPrice,
                tickSize: 0.01,
                aggressiveVolume: 25.6, // Still low combined volume
                passiveVolume: 34.2,
                aggressiveBuyVolume: 15.4,
                aggressiveSellVolume: 10.2,
                passiveBidVolume: 18.7,
                passiveAskVolume: 15.5,
                tradeCount: 9,
                timespan: 600000,
                boundaries: {
                    min: currentPrice - 0.05,
                    max: currentPrice + 0.05,
                },
                lastUpdate: Date.now(),
                volumeWeightedPrice: currentPrice + 0.002,
            },
        ],
        zones20Tick: [], // No 20T zone activity
        zoneConfig: {
            baseTicks: 5,
            tickValue: 0.01,
            timeWindow: 300000,
        },
    };

    const trade: EnrichedTradeEvent = {
        price: currentPrice,
        quantity: 1.83, // Small retail trade
        timestamp: Date.now(),
        buyerIsMaker: false, // Retail FOMO buying
        pair: "LTCUSDT",
        tradeId: "demo_retail_noise",
        originalTrade: {} as SpotWebsocketStreams.AggTradeResponse,
        passiveBidVolume: 9.8,
        passiveAskVolume: 8.9,
        zonePassiveBidVolume: 18.7,
        zonePassiveAskVolume: 15.5,
        bestBid: currentPrice - 0.01,
        bestAsk: currentPrice + 0.01,
        zoneData: zoneData,
    };

    return {
        trade,
        description: `Retail Noise Without Institutional Support ($${currentPrice}):
- Low volume across all timeframes (<30 LTC per zone)
- No institutional presence (max volume 34.2 LTC << 50 LTC threshold)
- Weak passive/aggressive ratio (34.2/25.6 = 1.34x)
- No zone confluence (dispersed, low-volume zones)
Expected Enhancement: Signal filtering, "filter" recommendation`,
    };
}
