// src/indicators/helpers/crossDetectorAnalytics.ts
//
// 🎯 CROSS-DETECTOR ANALYTICS for UNIFIED PATTERN RECOGNITION
//
// This module provides unified analytics across absorption and exhaustion detectors
// to identify complex market patterns and institutional activity that span multiple
// detection systems.
//
// KEY CAPABILITIES:
// 1. Zone Behavior Analysis: Combined absorption/exhaustion patterns per zone
// 2. Pattern Switching Detection: Identify transitions between absorption/exhaustion
// 3. Institutional Activity Assessment: Multi-detector institutional quality scoring
// 4. Signal Quality Enhancement: Cross-validation of detector signals
// 5. Market Context Integration: Unified market behavior understanding
//
// MEMORY OPTIMIZATION:
// - Leverages optimized event histories from both detectors
// - Minimal memory footprint with smart caching
// - Real-time analytics without historical data duplication
//

import type { AbsorptionEvent } from "./absorptionZoneTracker.js";

/**
 * Unified zone event for cross-detector analysis
 */
interface UnifiedZoneEvent {
    timestamp: number;
    detectorType: "absorption" | "exhaustion";
    eventType: string;
    side: "bid" | "ask";
    volume: number;
    ratio: number;
    confidence: number;
    efficiency: number;
}

/**
 * Zone behavior analysis result
 */
export interface ZoneBehaviorAnalysis {
    zoneId: string;
    dominantPattern: "absorption_dominant" | "exhaustion_dominant" | "balanced";
    patternSwitching: PatternSwitch[];
    institutionalActivity: InstitutionalMetrics;
    zoneEfficiency: number;
    signalQuality: SignalQualityMetrics;
    marketContext: MarketContext;
}

/**
 * Pattern switching detection
 */
export interface PatternSwitch {
    timestamp: number;
    fromPattern: "absorption" | "exhaustion" | "neutral";
    toPattern: "absorption" | "exhaustion" | "neutral";
    confidence: number;
    volumeChange: number;
}

/**
 * Institutional activity metrics
 */
export interface InstitutionalMetrics {
    quality: "retail" | "mixed" | "institutional" | "elite";
    confidence: number;
    volumeProfile: VolumeProfile;
    patternConsistency: number;
    marketImpact: number;
}

/**
 * Volume profile analysis
 */
interface VolumeProfile {
    aggressiveVolume: number;
    passiveVolume: number;
    absorptionRatio: number;
    efficiency: number;
    institutionalRatio: number;
}

/**
 * Signal quality metrics
 */
interface SignalQualityMetrics {
    crossValidationScore: number;
    patternStrength: number;
    marketAlignment: number;
    institutionalConfirmation: boolean;
    overallQuality: "low" | "medium" | "high" | "elite";
}

/**
 * Market context for pattern interpretation
 */
interface MarketContext {
    volatility: "low" | "medium" | "high";
    trendDirection: "up" | "down" | "sideways";
    liquidity: "low" | "normal" | "high";
    institutionalPresence: number;
}

/**
 * Cross-detector analytics engine
 */
export class CrossDetectorAnalytics {
    private static readonly PATTERN_SWITCH_THRESHOLD = 0.7;
    private static readonly CROSS_VALIDATION_WINDOW_MS = 300000; // 5 minutes

    /**
     * Analyze zone behavior across absorption and exhaustion detectors
     */
    public analyzeZoneBehavior(
        zoneId: string,
        absorptionEvents: AbsorptionEvent[]
    ): ZoneBehaviorAnalysis {
        // For now, only analyze absorption events
        // TODO: Add exhaustion events when unified event system is implemented
        const unifiedEvents = this.unifyDetectorEvents(absorptionEvents);

        // Analyze pattern dominance
        const dominantPattern = this.determineDominantPattern(unifiedEvents);

        // Detect pattern switching
        const patternSwitching = this.detectPatternSwitching(unifiedEvents);

        // Assess institutional activity
        const institutionalActivity =
            this.assessInstitutionalActivity(unifiedEvents);

        // Calculate zone efficiency
        const zoneEfficiency = this.calculateZoneEfficiency(unifiedEvents);

        // Determine signal quality
        const signalQuality = this.calculateSignalQuality(
            unifiedEvents,
            dominantPattern
        );

        // Analyze market context
        const marketContext = this.analyzeMarketContext(unifiedEvents);

        return {
            zoneId,
            dominantPattern,
            patternSwitching,
            institutionalActivity,
            zoneEfficiency,
            signalQuality,
            marketContext,
        };
    }

    /**
     * Unify events from absorption detector (exhaustion support TODO)
     */
    private unifyDetectorEvents(
        absorptionEvents: AbsorptionEvent[]
    ): UnifiedZoneEvent[] {
        const unifiedEvents: UnifiedZoneEvent[] = [];

        // Convert absorption events
        for (const event of absorptionEvents) {
            unifiedEvents.push({
                timestamp: event.timestamp,
                detectorType: "absorption",
                eventType: event.eventType,
                side: event.side,
                volume: event.aggressiveVolume + event.passiveVolume,
                ratio: event.absorptionRatio,
                confidence: event.confidence,
                efficiency: event.efficiency,
            });
        }

        // Convert exhaustion events (placeholder - will be implemented when exhaustion events are defined)
        // TODO: Implement exhaustion event conversion

        // Sort by timestamp
        unifiedEvents.sort((a, b) => a.timestamp - b.timestamp);

        return unifiedEvents;
    }

    /**
     * Determine dominant pattern for the zone
     */
    private determineDominantPattern(
        events: UnifiedZoneEvent[]
    ): ZoneBehaviorAnalysis["dominantPattern"] {
        if (events.length === 0) return "balanced";

        let absorptionScore = 0;
        let exhaustionScore = 0;

        for (const event of events) {
            const weight = event.confidence * event.efficiency;

            if (event.detectorType === "absorption") {
                absorptionScore += weight;
            } else {
                exhaustionScore += weight;
            }
        }

        const totalScore = absorptionScore + exhaustionScore;
        if (totalScore === 0) return "balanced";

        const absorptionRatio = absorptionScore / totalScore;
        const exhaustionRatio = exhaustionScore / totalScore;

        if (absorptionRatio > 0.6) return "absorption_dominant";
        if (exhaustionRatio > 0.6) return "exhaustion_dominant";

        return "balanced";
    }

    /**
     * Detect pattern switching in the zone
     */
    private detectPatternSwitching(
        events: UnifiedZoneEvent[]
    ): PatternSwitch[] {
        const switches: PatternSwitch[] = [];
        if (events.length < 3) return switches;

        for (let i = 1; i < events.length; i++) {
            const prevEvent = events[i - 1];
            const currentEvent = events[i];

            if (!prevEvent || !currentEvent) continue;

            // Determine pattern for each event
            const prevPattern = this.getEventPattern(prevEvent);
            const newPattern = this.getEventPattern(currentEvent);

            // Detect pattern switch
            if (prevPattern !== newPattern && newPattern !== "neutral") {
                const confidence = Math.min(
                    currentEvent.confidence,
                    prevEvent.confidence
                );
                const volumeChange = Math.abs(
                    currentEvent.volume - prevEvent.volume
                );

                if (
                    confidence > CrossDetectorAnalytics.PATTERN_SWITCH_THRESHOLD
                ) {
                    switches.push({
                        timestamp: currentEvent.timestamp,
                        fromPattern: prevPattern,
                        toPattern: newPattern,
                        confidence,
                        volumeChange,
                    });
                }
            }
        }

        return switches;
    }

    /**
     * Get pattern type for an event
     */
    private getEventPattern(
        event: UnifiedZoneEvent
    ): "absorption" | "exhaustion" | "neutral" {
        if (event.detectorType === "absorption" && event.ratio > 1.2) {
            return "absorption";
        }
        if (event.detectorType === "exhaustion" && event.ratio > 0.8) {
            return "exhaustion";
        }
        return "neutral";
    }

    /**
     * Assess institutional activity quality
     */
    private assessInstitutionalActivity(
        events: UnifiedZoneEvent[]
    ): InstitutionalMetrics {
        if (events.length === 0) {
            return {
                quality: "retail",
                confidence: 0,
                volumeProfile: {
                    aggressiveVolume: 0,
                    passiveVolume: 0,
                    absorptionRatio: 0,
                    efficiency: 0,
                    institutionalRatio: 0,
                },
                patternConsistency: 0,
                marketImpact: 0,
            };
        }

        // Calculate volume profile
        const volumeProfile = this.calculateVolumeProfile(events);

        // Assess pattern consistency
        const patternConsistency = this.calculatePatternConsistency(events);

        // Calculate institutional quality score
        const qualityScore = this.calculateInstitutionalQualityScore(
            volumeProfile,
            patternConsistency
        );

        // Determine quality level
        let quality: InstitutionalMetrics["quality"];
        if (qualityScore >= 0.9) quality = "elite";
        else if (qualityScore >= 0.75) quality = "institutional";
        else if (qualityScore >= 0.5) quality = "mixed";
        else quality = "retail";

        return {
            quality,
            confidence: qualityScore,
            volumeProfile,
            patternConsistency,
            marketImpact: volumeProfile.institutionalRatio,
        };
    }

    /**
     * Calculate volume profile from events
     */
    private calculateVolumeProfile(events: UnifiedZoneEvent[]): VolumeProfile {
        let totalAggressive = 0;
        let totalPassive = 0;
        let totalEfficiency = 0;

        for (const event of events) {
            if (event.detectorType === "absorption") {
                // Fix volume calculation bug: absorption ratio represents passive/aggressive
                // When ratio > 1, passive volume > aggressive volume (normal absorption)
                // When ratio < 1, aggressive volume > passive volume (weak absorption)
                if (event.ratio >= 1) {
                    // Normal absorption: passive absorbs aggressive
                    totalAggressive += event.volume / event.ratio;
                    totalPassive += event.volume;
                } else {
                    // Weak absorption: aggressive dominates
                    totalAggressive += event.volume;
                    totalPassive += event.volume * event.ratio;
                }
            } else if (event.detectorType === "exhaustion") {
                // Exhaustion events (when implemented) have different volume distribution
                // For now, treat as neutral
                totalAggressive += event.volume * 0.5;
                totalPassive += event.volume * 0.5;
            }
            totalEfficiency += event.efficiency;
        }

        const absorptionRatio =
            totalPassive > 0 ? totalAggressive / totalPassive : 0;
        const avgEfficiency =
            events.length > 0 ? totalEfficiency / events.length : 0;
        const institutionalRatio = Math.min(
            1.0,
            absorptionRatio * avgEfficiency
        );

        return {
            aggressiveVolume: Math.max(0, totalAggressive), // Ensure non-negative
            passiveVolume: Math.max(0, totalPassive), // Ensure non-negative
            absorptionRatio,
            efficiency: avgEfficiency,
            institutionalRatio,
        };
    }

    /**
     * Calculate pattern consistency across events
     */
    private calculatePatternConsistency(events: UnifiedZoneEvent[]): number {
        if (events.length < 2) return 0;

        let consistencySum = 0;
        let pairCount = 0;

        for (let i = 1; i < events.length; i++) {
            const prev = events[i - 1];
            const curr = events[i];

            if (prev && curr && prev.detectorType === curr.detectorType) {
                // Same detector type - check ratio consistency
                const ratioDiff = Math.abs(prev.ratio - curr.ratio);
                const consistency = Math.max(0, 1 - ratioDiff);
                consistencySum +=
                    consistency * Math.min(prev.confidence, curr.confidence);
                pairCount++;
            }
        }

        return pairCount > 0 ? consistencySum / pairCount : 0;
    }

    /**
     * Calculate institutional quality score
     */
    private calculateInstitutionalQualityScore(
        volumeProfile: VolumeProfile,
        patternConsistency: number
    ): number {
        // Weighted combination of factors
        const volumeQuality = Math.min(
            1.0,
            volumeProfile.absorptionRatio / 2.0
        );
        const efficiencyQuality = volumeProfile.efficiency;
        const consistencyQuality = patternConsistency;

        return (
            volumeQuality * 0.4 +
            efficiencyQuality * 0.4 +
            consistencyQuality * 0.2
        );
    }

    /**
     * Calculate zone efficiency across all events
     */
    private calculateZoneEfficiency(events: UnifiedZoneEvent[]): number {
        if (events.length === 0) return 0;

        const totalEfficiency = events.reduce(
            (sum, event) => sum + event.efficiency,
            0
        );
        return totalEfficiency / events.length;
    }

    /**
     * Calculate signal quality metrics
     */
    private calculateSignalQuality(
        events: UnifiedZoneEvent[],
        dominantPattern: ZoneBehaviorAnalysis["dominantPattern"]
    ): SignalQualityMetrics {
        if (events.length === 0) {
            return {
                crossValidationScore: 0,
                patternStrength: 0,
                marketAlignment: 0,
                institutionalConfirmation: false,
                overallQuality: "low",
            };
        }

        // Cross-validation score (how well patterns align)
        const crossValidationScore = this.calculateCrossValidationScore(events);

        // Pattern strength based on dominant pattern
        const patternStrength =
            dominantPattern === "balanced"
                ? 0.5
                : dominantPattern.includes("dominant")
                  ? 0.8
                  : 0.3;

        // Market alignment (consistency with recent events)
        const marketAlignment = this.calculateMarketAlignment(events);

        // Institutional confirmation
        const institutionalConfirmation = events.some(
            (e) => e.confidence > 0.8 && e.efficiency > 0.7
        );

        // Overall quality determination
        const overallScore =
            (crossValidationScore + patternStrength + marketAlignment) / 3;
        let overallQuality: SignalQualityMetrics["overallQuality"];
        if (overallScore >= 0.85) overallQuality = "elite";
        else if (overallScore >= 0.7) overallQuality = "high";
        else if (overallScore >= 0.5) overallQuality = "medium";
        else overallQuality = "low";

        return {
            crossValidationScore,
            patternStrength,
            marketAlignment,
            institutionalConfirmation,
            overallQuality,
        };
    }

    /**
     * Calculate cross-validation score
     */
    private calculateCrossValidationScore(events: UnifiedZoneEvent[]): number {
        if (events.length < 2) return 0;

        let validationSum = 0;
        let pairCount = 0;

        // Check for complementary patterns (absorption + exhaustion in same timeframe)
        const timeWindow = CrossDetectorAnalytics.CROSS_VALIDATION_WINDOW_MS;

        for (let i = 0; i < events.length; i++) {
            for (let j = i + 1; j < events.length; j++) {
                const event1 = events[i];
                const event2 = events[j];

                if (!event1 || !event2) continue;

                // Check if events are within time window and different detector types
                if (
                    Math.abs(event1.timestamp - event2.timestamp) <=
                        timeWindow &&
                    event1.detectorType !== event2.detectorType
                ) {
                    // Complementary patterns get higher validation score
                    const complementaryBonus = this.arePatternsComplementary(
                        event1,
                        event2
                    )
                        ? 0.2
                        : 0;
                    const confidenceAvg =
                        (event1.confidence + event2.confidence) / 2;
                    validationSum += confidenceAvg + complementaryBonus;
                    pairCount++;
                }
            }
        }

        return pairCount > 0 ? Math.min(1.0, validationSum / pairCount) : 0;
    }

    /**
     * Check if two patterns are complementary
     */
    private arePatternsComplementary(
        event1: UnifiedZoneEvent,
        event2: UnifiedZoneEvent
    ): boolean {
        // Absorption and exhaustion on same side can be complementary
        return (
            event1.side === event2.side &&
            event1.detectorType !== event2.detectorType &&
            event1.confidence > 0.6 &&
            event2.confidence > 0.6
        );
    }

    /**
     * Calculate market alignment score
     */
    private calculateMarketAlignment(events: UnifiedZoneEvent[]): number {
        if (events.length < 3) return 0.5; // Neutral alignment with insufficient data

        // Check consistency of recent events
        const recentEvents = events.slice(-5);
        let alignmentSum = 0;

        for (let i = 1; i < recentEvents.length; i++) {
            const prev = recentEvents[i - 1];
            const curr = recentEvents[i];

            if (prev && curr) {
                // Alignment based on pattern consistency and confidence
                const patternAlignment =
                    prev.detectorType === curr.detectorType ? 0.7 : 0.3;
                const confidenceAlignment = Math.min(
                    prev.confidence,
                    curr.confidence
                );
                alignmentSum += patternAlignment * confidenceAlignment;
            }
        }

        return recentEvents.length > 1
            ? alignmentSum / (recentEvents.length - 1)
            : 0.5;
    }

    /**
     * Analyze market context from events
     */
    private analyzeMarketContext(events: UnifiedZoneEvent[]): MarketContext {
        if (events.length === 0) {
            return {
                volatility: "medium",
                trendDirection: "sideways",
                liquidity: "normal",
                institutionalPresence: 0.5,
            };
        }

        // Analyze volatility from event frequency and magnitude
        const volatility = this.analyzeVolatility(events);

        // Determine trend direction from pattern bias
        const trendDirection = this.analyzeTrendDirection(events);

        // Assess liquidity from volume patterns
        const liquidity = this.analyzeLiquidity(events);

        // Calculate institutional presence
        const institutionalPresence =
            events.reduce((sum, event) => sum + event.confidence, 0) /
            events.length;

        return {
            volatility,
            trendDirection,
            liquidity,
            institutionalPresence,
        };
    }

    /**
     * Analyze market volatility from events
     */
    private analyzeVolatility(
        events: UnifiedZoneEvent[]
    ): MarketContext["volatility"] {
        if (events.length < 3) return "medium";

        // Calculate volatility from event magnitude variation
        const magnitudes = events.map((e) => e.volume * e.ratio);
        const avgMagnitude =
            magnitudes.reduce((sum, mag) => sum + mag, 0) / magnitudes.length;
        const variance =
            magnitudes.reduce(
                (sum, mag) => sum + Math.pow(mag - avgMagnitude, 2),
                0
            ) / magnitudes.length;
        const volatilityScore = Math.sqrt(variance) / avgMagnitude;

        if (volatilityScore > 0.7) return "high";
        if (volatilityScore < 0.3) return "low";
        return "medium";
    }

    /**
     * Analyze trend direction from pattern bias
     */
    private analyzeTrendDirection(
        events: UnifiedZoneEvent[]
    ): MarketContext["trendDirection"] {
        let buyPressure = 0;
        let sellPressure = 0;

        for (const event of events) {
            const pressure = event.volume * event.confidence;

            if (event.detectorType === "absorption") {
                // Absorption signals reversal, so opposite of current flow
                if (event.side === "bid")
                    sellPressure += pressure; // Bid absorption = sell signal
                else buyPressure += pressure; // Ask absorption = buy signal
            } else {
                // Exhaustion signals continuation
                if (event.side === "bid")
                    buyPressure += pressure; // Bid exhaustion = buy continuation
                else sellPressure += pressure; // Ask exhaustion = sell continuation
            }
        }

        const totalPressure = buyPressure + sellPressure;
        if (totalPressure === 0) return "sideways";

        const buyRatio = buyPressure / totalPressure;
        if (buyRatio > 0.6) return "up";
        if (buyRatio < 0.4) return "down";
        return "sideways";
    }

    /**
     * Analyze liquidity from volume patterns
     */
    private analyzeLiquidity(
        events: UnifiedZoneEvent[]
    ): MarketContext["liquidity"] {
        if (events.length === 0) return "normal";

        const avgVolume =
            events.reduce((sum, event) => sum + event.volume, 0) /
            events.length;
        const volumeConsistency = this.calculateVolumeConsistency(events);

        // High volume with consistency = high liquidity
        // Low volume or inconsistent = low liquidity
        if (avgVolume > 1000 && volumeConsistency > 0.7) return "high";
        if (avgVolume < 100 && volumeConsistency < 0.3) return "low";
        return "normal";
    }

    /**
     * Calculate volume consistency across events
     */
    private calculateVolumeConsistency(events: UnifiedZoneEvent[]): number {
        if (events.length < 2) return 0.5;

        const volumes = events.map((e) => e.volume);
        const avgVolume =
            volumes.reduce((sum, vol) => sum + vol, 0) / volumes.length;
        const variance =
            volumes.reduce(
                (sum, vol) => sum + Math.pow(vol - avgVolume, 2),
                0
            ) / volumes.length;
        const consistency = 1 - Math.min(1, Math.sqrt(variance) / avgVolume);

        return consistency;
    }
}
