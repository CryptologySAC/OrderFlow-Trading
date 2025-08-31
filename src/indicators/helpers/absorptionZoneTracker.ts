// src/indicators/helpers/absorptionZoneTracker.ts
//
// 🎯 DYNAMIC ZONE TRACKING for TRUE ABSORPTION DETECTION
//
// This helper class tracks passive volume absorption over time to identify real absorption patterns.
// TRUE ABSORPTION: When aggressive volume is absorbed by passive liquidity without moving price,
// indicating strong support/resistance levels that can lead to reversals.
//
// KEY PATTERNS DETECTED:
// 1. Passive Absorption: High passive volume absorbing aggressive trades
// 2. Directional Absorption: Tracking bid vs ask absorption separately
// 3. Absorption Quality: Ratio of passive to aggressive volume
//

import { FinancialMath } from "../../utils/financialMath.js";
import type { ZoneSnapshot } from "../../types/marketEvents.js";

/**
 * Optimized absorption event for memory-efficient history tracking
 */
export interface AbsorptionEvent {
    timestamp: number;
    eventType:
        | "absorption_start"
        | "absorption_progress"
        | "absorption_complete";
    side: "bid" | "ask";
    aggressiveVolume: number;
    passiveVolume: number;
    absorptionRatio: number;
    efficiency: number;
    confidence: number;
    detectorType: "absorption"; // For unified cross-detector analytics
}

/**
 * Legacy zone history entry - kept for backward compatibility during transition
 * TODO: Remove after optimization validation
 */
interface AbsorptionHistoryEntry {
    timestamp: number;
    passiveBidVolume: number;
    passiveAskVolume: number;
    aggressiveVolume: number;
    priceLevel: number;
    spread: number;
    absorptionRatio: number; // passive / aggressive ratio
}

/**
 * Optimized zone tracking state for absorption analysis
 */
interface OptimizedAbsorptionZone {
    zoneId: string;
    priceLevel: number;
    eventHistory: AbsorptionEvent[]; // Optimized event-based history
    currentState: AbsorptionState; // Current absorption state
    peakVolumes: PeakVolumes; // Peak volume tracking
    lastOptimization: number; // Track optimization timestamps
    absorptionEvents: number; // Count of significant absorption events
    maxAbsorptionRatio: number; // Peak absorption ratio seen
}

/**
 * Current absorption state for optimized tracking
 */
interface AbsorptionState {
    totalPassiveBidVolume: number;
    totalPassiveAskVolume: number;
    totalAggressiveVolume: number;
    lastUpdate: number;
}

/**
 * Peak volume tracking for absorption analysis
 */
interface PeakVolumes {
    maxPassiveBidVolume: number;
    maxPassiveAskVolume: number;
    maxAggressiveVolume: number;
}

/**
 * Legacy zone tracking state - kept for backward compatibility during transition
 * TODO: Remove after optimization validation
 */
interface TrackedAbsorptionZone {
    zoneId: string;
    priceLevel: number;
    history: AbsorptionHistoryEntry[];
    totalPassiveBidVolume: number; // Cumulative bid volume
    totalPassiveAskVolume: number; // Cumulative ask volume
    totalAggressiveVolume: number; // Cumulative aggressive volume
    lastUpdate: number;
    absorptionEvents: number; // Count of significant absorption events
    maxAbsorptionRatio: number; // Peak absorption ratio seen
}

/**
 * Absorption pattern detection result
 */
export interface AbsorptionPattern {
    hasAbsorption: boolean;
    absorptionType: "bid" | "ask" | "both" | null;
    absorptionRatio: number; // How much passive volume vs aggressive
    absorptionStrength: number; // Strength of absorption pattern
    affectedZones: number;
    confidence: number;
    priceStability: boolean; // True if price remained stable despite volume
    direction: "buy" | "sell" | null; // Signal direction based on absorption
}

/**
 * Configuration for absorption zone tracking
 */
export interface AbsorptionTrackerConfig {
    maxZonesPerSide: number; // Number of zones to track on each side of spread
    historyWindowMs: number; // How long to keep zone history
    absorptionThreshold: number; // Minimum passive/aggressive ratio for absorption (e.g., 1.5 = 50% more passive)
    minPassiveVolume: number; // Minimum passive volume to consider for absorption
    priceStabilityTicks: number; // Price movement tolerance in ticks for stability
    minAbsorptionEvents: number; // Minimum absorption events to confirm pattern
}

/**
 * Dynamic zone tracker for true absorption detection with optimized memory usage
 */
export class AbsorptionZoneTracker {
    private readonly bidZones = new Map<string, TrackedAbsorptionZone>();
    private readonly askZones = new Map<string, TrackedAbsorptionZone>();

    // Optimized event-based tracking system
    private readonly optimizedBidZones = new Map<
        string,
        OptimizedAbsorptionZone
    >();
    private readonly optimizedAskZones = new Map<
        string,
        OptimizedAbsorptionZone
    >();

    private currentSpread: { bid: number; ask: number } | null = null;
    private readonly config: AbsorptionTrackerConfig;
    private readonly tickSize: number;
    private priceHistory: Array<{ price: number; timestamp: number }> = [];

    // Memory monitoring constants (calculated based on configuration)
    private static readonly MEMORY_MONITORING_THRESHOLD_PERCENT = 0.1; // 10% of max expected events
    private static readonly EXPECTED_TRADES_PER_SECOND = 25; // Conservative estimate for LTCUSDT
    private static readonly EVENT_PRIORITIZATION_WEIGHTS = {
        recency: 0.4,
        confidence: 0.4,
        significance: 0.2,
    };

    // Memory monitoring state
    private memoryStats = {
        lastMemoryCheck: 0,
        totalEventsProcessed: 0,
        totalOptimizationsPerformed: 0,
        averageEventsPerZone: 0,
        peakMemoryUsage: 0,
    };

    constructor(config: AbsorptionTrackerConfig, tickSize: number) {
        this.config = config;
        this.tickSize = tickSize;
    }

    /**
     * Get tracker configuration
     */
    public getConfig(): AbsorptionTrackerConfig {
        return this.config;
    }

    /**
     * Update spread and determine which zones to track
     */
    public updateSpread(bestBid: number, bestAsk: number): void {
        this.currentSpread = { bid: bestBid, ask: bestAsk };
        this.adjustTrackedZones();
    }

    /**
     * Process zone update and track absorption metrics with optimized event system
     */
    public updateZone(zone: ZoneSnapshot, timestamp: number): void {
        const isNearBid = this.isNearBid(zone.priceLevel);
        const isNearAsk = this.isNearAsk(zone.priceLevel);

        if (!isNearBid && !isNearAsk) {
            return; // Zone too far from spread
        }

        // Update legacy system (for backward compatibility during transition)
        this.updateLegacyZone(zone, timestamp);

        // Update optimized event-based system
        this.updateOptimizedZone(zone, timestamp);
    }

    /**
     * Legacy zone update method - maintains backward compatibility
     */
    private updateLegacyZone(zone: ZoneSnapshot, timestamp: number): void {
        const zoneId = zone.zoneId;
        const isNearBid = this.isNearBid(zone.priceLevel);
        const isNearAsk = this.isNearAsk(zone.priceLevel);

        if (!isNearBid && !isNearAsk) return;

        const trackedZones = isNearBid ? this.bidZones : this.askZones;
        let tracked = trackedZones.get(zoneId);

        if (!tracked) {
            // Initialize new tracked zone
            tracked = {
                zoneId,
                priceLevel: zone.priceLevel,
                history: [],
                totalPassiveBidVolume: 0,
                totalPassiveAskVolume: 0,
                totalAggressiveVolume: 0,
                lastUpdate: timestamp,
                absorptionEvents: 0,
                maxAbsorptionRatio: 0,
            };
            trackedZones.set(zoneId, tracked);
        }

        // Update cumulative volumes
        tracked.totalPassiveBidVolume += zone.passiveBidVolume;
        tracked.totalPassiveAskVolume += zone.passiveAskVolume;
        tracked.totalAggressiveVolume += zone.aggressiveVolume;

        // Calculate absorption ratio
        const totalPassive = zone.passiveBidVolume + zone.passiveAskVolume;
        const absorptionRatio =
            zone.aggressiveVolume > 0
                ? FinancialMath.divideQuantities(
                      totalPassive,
                      zone.aggressiveVolume
                  )
                : 0;

        // Update max absorption ratio
        tracked.maxAbsorptionRatio = Math.max(
            tracked.maxAbsorptionRatio,
            absorptionRatio
        );

        // Add history entry
        const entry: AbsorptionHistoryEntry = {
            timestamp,
            passiveBidVolume: zone.passiveBidVolume,
            passiveAskVolume: zone.passiveAskVolume,
            aggressiveVolume: zone.aggressiveVolume,
            priceLevel: zone.priceLevel,
            spread: this.currentSpread
                ? this.currentSpread.ask - this.currentSpread.bid
                : 0,
            absorptionRatio,
        };

        tracked.history.push(entry);
        tracked.lastUpdate = timestamp;

        // Check for absorption event
        this.detectAbsorptionEvent(tracked);

        // Clean old history
        this.cleanOldHistory(tracked, timestamp);
    }

    /**
     * Optimized zone update method - uses event-based history for memory efficiency
     */

    private updateOptimizedZone(zone: ZoneSnapshot, timestamp: number): void {
        const zoneId = zone.zoneId;
        const isNearBid = this.isNearBid(zone.priceLevel);
        const isNearAsk = this.isNearAsk(zone.priceLevel);

        if (!isNearBid && !isNearAsk) return;

        const optimizedZones = isNearBid
            ? this.optimizedBidZones
            : this.optimizedAskZones;
        const side = isNearBid ? "bid" : "ask";
        let optimized = optimizedZones.get(zoneId);

        if (!optimized) {
            // Initialize new optimized zone
            optimized = {
                zoneId,
                priceLevel: zone.priceLevel,
                eventHistory: [],
                currentState: {
                    totalPassiveBidVolume: 0,
                    totalPassiveAskVolume: 0,
                    totalAggressiveVolume: 0,
                    lastUpdate: timestamp,
                },
                peakVolumes: {
                    maxPassiveBidVolume: zone.passiveBidVolume,
                    maxPassiveAskVolume: zone.passiveAskVolume,
                    maxAggressiveVolume: zone.aggressiveVolume,
                },
                lastOptimization: timestamp,
                absorptionEvents: 0,
                maxAbsorptionRatio: 0,
            };
            optimizedZones.set(zoneId, optimized);
        }

        // Update current state
        optimized.currentState.totalPassiveBidVolume += zone.passiveBidVolume;
        optimized.currentState.totalPassiveAskVolume += zone.passiveAskVolume;
        optimized.currentState.totalAggressiveVolume += zone.aggressiveVolume;
        optimized.currentState.lastUpdate = timestamp;

        // Update peak volumes
        optimized.peakVolumes.maxPassiveBidVolume = Math.max(
            optimized.peakVolumes.maxPassiveBidVolume,
            zone.passiveBidVolume
        );
        optimized.peakVolumes.maxPassiveAskVolume = Math.max(
            optimized.peakVolumes.maxPassiveAskVolume,
            zone.passiveAskVolume
        );
        optimized.peakVolumes.maxAggressiveVolume = Math.max(
            optimized.peakVolumes.maxAggressiveVolume,
            zone.aggressiveVolume
        );

        // Calculate absorption metrics
        const totalPassive = zone.passiveBidVolume + zone.passiveAskVolume;
        const absorptionRatio =
            zone.aggressiveVolume > 0
                ? FinancialMath.divideQuantities(
                      totalPassive,
                      zone.aggressiveVolume
                  )
                : 0;

        // Update max absorption ratio
        optimized.maxAbsorptionRatio = Math.max(
            optimized.maxAbsorptionRatio,
            absorptionRatio
        );

        // Create absorption event
        const absorptionEvent: AbsorptionEvent = {
            timestamp,
            eventType: this.determineEventType(absorptionRatio, optimized),
            side,
            aggressiveVolume: zone.aggressiveVolume,
            passiveVolume: totalPassive,
            absorptionRatio,
            efficiency: this.calculateAbsorptionEfficiency(
                zone,
                absorptionRatio
            ),
            confidence: this.calculateEventConfidence(absorptionRatio, zone),
            detectorType: "absorption",
        };

        // Add event to history
        optimized.eventHistory.push(absorptionEvent);

        // Check for significant absorption event
        this.detectOptimizedAbsorptionEvent(optimized, absorptionEvent);

        // Optimize history (smart cleanup)
        this.optimizeAbsorptionHistory(optimized);
    }

    /**
     * Update price history for stability tracking
     */
    public updatePrice(price: number, timestamp: number): void {
        this.priceHistory.push({ price, timestamp });

        // Keep only recent price history
        const cutoff = timestamp - this.config.historyWindowMs;
        this.priceHistory = this.priceHistory.filter(
            (p) => p.timestamp > cutoff
        );
    }

    /**
     * Analyze zones for absorption patterns using optimized event system
     */
    public analyzeAbsorption(isBuyTrade: boolean): AbsorptionPattern {
        // Use optimized event-based analysis for better performance
        const optimizedResult = this.analyzeOptimizedAbsorption(isBuyTrade);

        // Fallback to legacy analysis if optimized result is insufficient
        if (optimizedResult.affectedZones === 0) {
            return this.analyzeLegacyAbsorption(isBuyTrade);
        }

        return optimizedResult;
    }

    /**
     * Analyze absorption using optimized event-based system
     */
    private analyzeOptimizedAbsorption(isBuyTrade: boolean): AbsorptionPattern {
        const relevantZones = isBuyTrade
            ? this.optimizedAskZones
            : this.optimizedBidZones;
        const absorptionType = isBuyTrade ? "ask" : "bid";

        let totalWeightedAbsorptionRatio = 0;
        let totalAggressiveVolume = 0;
        let totalStrength = 0;
        let affectedZones = 0;
        let maxAbsorption = 0;
        let hasSignificantAbsorption = false;

        for (const zone of relevantZones.values()) {
            const analysis = this.analyzeOptimizedZoneAbsorption(
                zone,
                absorptionType
            );

            if (analysis.isAbsorbing) {
                affectedZones++;
                totalWeightedAbsorptionRatio +=
                    analysis.absorptionRatio *
                    zone.peakVolumes.maxAggressiveVolume;
                totalAggressiveVolume += zone.peakVolumes.maxAggressiveVolume;
                totalStrength += analysis.strength;
                maxAbsorption = Math.max(
                    maxAbsorption,
                    analysis.absorptionRatio
                );

                if (
                    analysis.absorptionRatio >=
                        this.config.absorptionThreshold &&
                    zone.absorptionEvents >= this.config.minAbsorptionEvents
                ) {
                    hasSignificantAbsorption = true;
                }
            }
        }

        if (affectedZones === 0 || totalAggressiveVolume === 0) {
            return {
                hasAbsorption: false,
                absorptionType: null,
                absorptionRatio: 0,
                absorptionStrength: 0,
                affectedZones: 0,
                confidence: 0,
                priceStability: false,
                direction: null,
            };
        }

        const weightedAvgAbsorptionRatio =
            totalWeightedAbsorptionRatio / totalAggressiveVolume;
        const avgStrength = totalStrength / affectedZones;
        const priceStability = this.checkPriceStability();

        const confidence = this.calculateAbsorptionConfidence(
            weightedAvgAbsorptionRatio,
            affectedZones,
            maxAbsorption,
            priceStability
        );

        const direction = hasSignificantAbsorption
            ? absorptionType === "ask"
                ? "sell" // Ask absorption = resistance holds = bearish reversal
                : "buy" // Bid absorption = support holds = bullish reversal
            : null;

        return {
            hasAbsorption: hasSignificantAbsorption,
            absorptionType,
            absorptionRatio: weightedAvgAbsorptionRatio,
            absorptionStrength: avgStrength,
            affectedZones,
            confidence,
            priceStability,
            direction,
        };
    }

    /**
     * Legacy absorption analysis for backward compatibility
     */
    private analyzeLegacyAbsorption(isBuyTrade: boolean): AbsorptionPattern {
        // ABSORPTION LOGIC (CORRECTED):
        // - Buy trades hit asks: If asks absorb buying → resistance holds → SELL signal (reversal down)
        // - Sell trades hit bids: If bids absorb selling → support holds → BUY signal (reversal up)
        const relevantZones = isBuyTrade ? this.askZones : this.bidZones;
        const absorptionType = isBuyTrade ? "ask" : "bid";

        let totalWeightedAbsorptionRatio = 0;
        let totalAggressiveVolume = 0;
        let totalStrength = 0;
        let affectedZones = 0;
        let maxAbsorption = 0;
        let hasSignificantAbsorption = false;

        for (const zone of relevantZones.values()) {
            const analysis = this.analyzeZoneAbsorption(zone, absorptionType);

            if (analysis.isAbsorbing) {
                affectedZones++;
                totalWeightedAbsorptionRatio +=
                    analysis.absorptionRatio * zone.totalAggressiveVolume;
                totalAggressiveVolume += zone.totalAggressiveVolume;
                totalStrength += analysis.strength;
                maxAbsorption = Math.max(
                    maxAbsorption,
                    analysis.absorptionRatio
                );

                if (
                    analysis.absorptionRatio >=
                        this.config.absorptionThreshold &&
                    zone.absorptionEvents >= this.config.minAbsorptionEvents
                ) {
                    hasSignificantAbsorption = true;
                }
            }
        }

        if (affectedZones === 0 || totalAggressiveVolume === 0) {
            return {
                hasAbsorption: false,
                absorptionType: null,
                absorptionRatio: 0,
                absorptionStrength: 0,
                affectedZones: 0,
                confidence: 0,
                priceStability: false,
                direction: null,
            };
        }

        const weightedAvgAbsorptionRatio =
            totalWeightedAbsorptionRatio / totalAggressiveVolume;
        const avgStrength = totalStrength / affectedZones;
        const priceStability = this.checkPriceStability();

        // Calculate confidence based on multiple factors
        const confidence = this.calculateAbsorptionConfidence(
            weightedAvgAbsorptionRatio,
            affectedZones,
            maxAbsorption,
            priceStability
        );

        // Determine signal direction (CORRECTED - absorption signals reversal):
        // - Ask absorption = resistance holding against buying = SELL signal (reversal down)
        // - Bid absorption = support holding against selling = BUY signal (reversal up)
        const direction = hasSignificantAbsorption
            ? absorptionType === "ask"
                ? "sell" // Ask absorption = resistance holds = bearish reversal
                : "buy" // Bid absorption = support holds = bullish reversal
            : null;

        return {
            hasAbsorption: hasSignificantAbsorption,
            absorptionType,
            absorptionRatio: weightedAvgAbsorptionRatio,
            absorptionStrength: avgStrength,
            affectedZones,
            confidence,
            priceStability,
            direction,
        };
    }

    /**
     * Analyze individual zone for absorption using optimized event system
     */
    private analyzeOptimizedZoneAbsorption(
        zone: OptimizedAbsorptionZone,
        side: "bid" | "ask"
    ): {
        isAbsorbing: boolean;
        absorptionRatio: number;
        strength: number;
    } {
        if (zone.eventHistory.length < 2) {
            return { isAbsorbing: false, absorptionRatio: 0, strength: 0 };
        }

        // Get current passive volume for the relevant side
        const currentPassive =
            side === "bid"
                ? zone.currentState.totalPassiveBidVolume
                : zone.currentState.totalPassiveAskVolume;

        if (currentPassive < this.config.minPassiveVolume) {
            return { isAbsorbing: false, absorptionRatio: 0, strength: 0 };
        }

        // Calculate absorption ratio using current aggressive volume
        const absorptionRatio =
            zone.currentState.totalAggressiveVolume > 0
                ? FinancialMath.divideQuantities(
                      currentPassive,
                      zone.currentState.totalAggressiveVolume
                  )
                : 0;

        // Calculate absorption strength based on event history consistency
        const strength = this.calculateOptimizedAbsorptionStrength(zone);

        const isAbsorbing = absorptionRatio >= this.config.absorptionThreshold;

        return { isAbsorbing, absorptionRatio, strength };
    }

    /**
     * Analyze individual zone for absorption (legacy method)
     */
    private analyzeZoneAbsorption(
        zone: TrackedAbsorptionZone,
        side: "bid" | "ask"
    ): {
        isAbsorbing: boolean;
        absorptionRatio: number;
        strength: number;
    } {
        if (zone.history.length < 2) {
            return { isAbsorbing: false, absorptionRatio: 0, strength: 0 };
        }

        const totalPassive =
            side === "bid"
                ? zone.totalPassiveBidVolume
                : zone.totalPassiveAskVolume;

        if (totalPassive < this.config.minPassiveVolume) {
            return { isAbsorbing: false, absorptionRatio: 0, strength: 0 };
        }

        const absorptionRatio =
            zone.totalAggressiveVolume > 0
                ? FinancialMath.divideQuantities(
                      totalPassive,
                      zone.totalAggressiveVolume
                  )
                : 0;

        // Calculate absorption strength based on consistency
        const strength = this.calculateAbsorptionStrength(zone);

        const isAbsorbing = absorptionRatio >= this.config.absorptionThreshold;

        return { isAbsorbing, absorptionRatio, strength };
    }

    /**
     * Calculate absorption strength based on event history consistency (optimized)
     */
    private calculateOptimizedAbsorptionStrength(
        zone: OptimizedAbsorptionZone
    ): number {
        if (zone.eventHistory.length < 3) {
            return 0;
        }

        // Look at consistency of absorption events over time
        let consistentAbsorption = 0;
        const recentEvents = zone.eventHistory.slice(-10); // Look at last 10 events

        for (const event of recentEvents) {
            if (event.absorptionRatio >= this.config.absorptionThreshold) {
                consistentAbsorption++;
            }
        }

        const consistencyRatio = consistentAbsorption / recentEvents.length;

        // Strength is average of consistency and normalized max absorption ratio
        const normalizedMaxRatio = Math.min(
            1,
            zone.maxAbsorptionRatio / (this.config.absorptionThreshold * 2)
        );
        const strength = (consistencyRatio + normalizedMaxRatio) / 2;

        return strength;
    }

    /**
     * Calculate absorption strength based on pattern consistency (legacy)
     */
    private calculateAbsorptionStrength(zone: TrackedAbsorptionZone): number {
        if (zone.history.length < 3) {
            return 0;
        }

        // Look at consistency of absorption over time
        let consistentAbsorption = 0;
        const recentHistory = zone.history.slice(
            -this.config.maxZonesPerSide * 2
        ); // Use double max zones as lookback

        for (const entry of recentHistory) {
            if (entry.absorptionRatio >= this.config.absorptionThreshold) {
                consistentAbsorption++;
            }
        }

        const consistencyRatio = consistentAbsorption / recentHistory.length;

        // Strength is average of consistency and normalized max absorption ratio
        const normalizedMaxRatio = Math.min(
            1,
            zone.maxAbsorptionRatio / (this.config.absorptionThreshold * 2)
        );
        const strength = (consistencyRatio + normalizedMaxRatio) / 2; // Simple average, no magic weights

        return strength;
    }

    /**
     * Check if price has remained stable despite volume
     */
    public checkPriceStability(): boolean {
        if (this.priceHistory.length < 2) {
            return false;
        }

        const firstPrice = this.priceHistory[0]?.price;
        const lastPrice =
            this.priceHistory[this.priceHistory.length - 1]?.price;

        if (firstPrice === undefined || lastPrice === undefined) {
            return false;
        }

        const priceChange = Math.abs(lastPrice - firstPrice);
        const maxAllowedChange =
            this.tickSize * this.config.priceStabilityTicks;

        return priceChange <= maxAllowedChange;
    }

    /**
     * Get actual price range in ticks for logging/analysis
     */
    public getPriceRangeInTicks(): number {
        if (this.priceHistory.length < 2) {
            return 0;
        }

        const firstPrice = this.priceHistory[0]?.price;
        const lastPrice =
            this.priceHistory[this.priceHistory.length - 1]?.price;

        if (firstPrice === undefined || lastPrice === undefined) {
            return 0;
        }

        const priceChange = Math.abs(lastPrice - firstPrice);
        return FinancialMath.divideQuantities(priceChange, this.tickSize);
    }

    /**
     * Calculate confidence score for absorption pattern
     */
    private calculateAbsorptionConfidence(
        avgAbsorptionRatio: number,
        affectedZones: number,
        maxAbsorption: number,
        priceStability: boolean
    ): number {
        // Simple average of normalized factors - NO BONUSES, NO MAGIC WEIGHTS
        const factors: number[] = [];

        // Normalized absorption ratio
        factors.push(
            Math.min(1, avgAbsorptionRatio / this.config.absorptionThreshold)
        );

        // Normalized zone count
        factors.push(Math.min(1, affectedZones / this.config.maxZonesPerSide));

        // Normalized max absorption
        factors.push(
            Math.min(1, maxAbsorption / (this.config.absorptionThreshold * 2))
        );

        // Price stability as binary factor (1 or 0)
        factors.push(priceStability ? 1 : 0);

        // Return simple average of all factors
        return factors.reduce((sum, f) => sum + f, 0) / factors.length;
    }

    /**
     * Detect significant absorption events
     */
    private detectAbsorptionEvent(zone: TrackedAbsorptionZone): void {
        if (zone.history.length < 2) {
            return;
        }

        const current = zone.history[zone.history.length - 1];

        if (!current) {
            return;
        }

        // Detect significant absorption using threshold
        if (current.absorptionRatio >= this.config.absorptionThreshold) {
            zone.absorptionEvents++;
        }
    }

    /**
     * Check if zone is near bid
     */
    private isNearBid(priceLevel: number): boolean {
        if (!this.currentSpread) return false;
        const distance = this.currentSpread.bid - priceLevel;
        const tickDistance = Math.abs(distance) / this.tickSize;
        return tickDistance <= this.config.maxZonesPerSide;
    }

    /**
     * Check if zone is near ask
     */
    private isNearAsk(priceLevel: number): boolean {
        if (!this.currentSpread) return false;
        const distance = priceLevel - this.currentSpread.ask;
        const tickDistance = Math.abs(distance) / this.tickSize;
        return tickDistance <= this.config.maxZonesPerSide;
    }

    /**
     * Adjust which zones are being tracked based on spread movement
     */
    private adjustTrackedZones(): void {
        if (!this.currentSpread) return;

        // Clean zones that are now too far from spread
        this.cleanDistantZones(this.bidZones, "bid");
        this.cleanDistantZones(this.askZones, "ask");
    }

    /**
     * Remove zones that are too far from current spread
     */
    private cleanDistantZones(
        zones: Map<string, TrackedAbsorptionZone>,
        side: "bid" | "ask"
    ): void {
        const toRemove: string[] = [];

        for (const [id, zone] of zones) {
            const isNear =
                side === "bid"
                    ? this.isNearBid(zone.priceLevel)
                    : this.isNearAsk(zone.priceLevel);

            if (!isNear) {
                toRemove.push(id);
            }
        }

        for (const id of toRemove) {
            zones.delete(id);
        }
    }

    /**
     * Clean old history entries
     */
    private cleanOldHistory(
        zone: TrackedAbsorptionZone,
        currentTime: number
    ): void {
        const cutoff = currentTime - this.config.historyWindowMs;
        zone.history = zone.history.filter((entry) => entry.timestamp > cutoff);
    }

    /**
     * Determine the type of absorption event
     */
    private determineEventType(
        absorptionRatio: number,
        zone: OptimizedAbsorptionZone
    ): AbsorptionEvent["eventType"] {
        if (absorptionRatio >= this.config.absorptionThreshold) {
            // Check if this is the start of absorption
            const recentEvents = zone.eventHistory.slice(-3);
            const hasRecentAbsorption = recentEvents.some(
                (e) =>
                    e.eventType.includes("absorption") &&
                    e.absorptionRatio >= this.config.absorptionThreshold
            );

            if (!hasRecentAbsorption) {
                return "absorption_start";
            } else if (absorptionRatio > zone.maxAbsorptionRatio * 0.9) {
                return "absorption_complete";
            } else {
                return "absorption_progress";
            }
        }

        return "absorption_progress"; // Default for non-significant events
    }

    /**
     * Calculate absorption efficiency for the event
     */
    private calculateAbsorptionEfficiency(
        zone: ZoneSnapshot,
        absorptionRatio: number
    ): number {
        // Efficiency = absorption ratio relative to threshold, capped at 1.0
        const efficiency = Math.min(
            1.0,
            absorptionRatio / this.config.absorptionThreshold
        );

        // Factor in volume quality (higher passive volume = higher efficiency)
        const totalPassive = zone.passiveBidVolume + zone.passiveAskVolume;
        const volumeQuality =
            totalPassive >= this.config.minPassiveVolume ? 1.0 : 0.5;

        return efficiency * volumeQuality;
    }

    /**
     * Calculate confidence score for the absorption event
     */
    private calculateEventConfidence(
        absorptionRatio: number,
        zone: ZoneSnapshot
    ): number {
        let confidence = 0;

        // Base confidence from absorption ratio
        confidence += Math.min(
            0.5,
            (absorptionRatio / this.config.absorptionThreshold) * 0.5
        );

        // Volume quality contribution
        const totalPassive = zone.passiveBidVolume + zone.passiveAskVolume;
        if (totalPassive >= this.config.minPassiveVolume) {
            confidence += 0.3;
        }

        // Aggressive volume contribution
        if (zone.aggressiveVolume >= this.config.minPassiveVolume) {
            confidence += 0.2;
        }

        return Math.min(1.0, confidence);
    }

    /**
     * Detect significant absorption events in optimized system
     */
    private detectOptimizedAbsorptionEvent(
        zone: OptimizedAbsorptionZone,
        event: AbsorptionEvent
    ): void {
        if (event.absorptionRatio >= this.config.absorptionThreshold) {
            zone.absorptionEvents++;
        }
    }

    /**
     * Optimize absorption history using smart cleanup and prioritization
     */
    private optimizeAbsorptionHistory(zone: OptimizedAbsorptionZone): void {
        const currentTime = Date.now();
        const cutoffTime = currentTime - this.config.historyWindowMs;

        // Remove old events
        const originalEventCount = zone.eventHistory.length;
        zone.eventHistory = zone.eventHistory.filter(
            (e) => e.timestamp >= cutoffTime
        );
        const eventsRemoved = originalEventCount - zone.eventHistory.length;

        // Calculate maximum events per zone based on configuration
        const maxEvents = this.calculateMaxEventsPerZone();

        // Always perform optimization if we have events, not just when exceeding max
        let optimizationPerformed = false;
        if (zone.eventHistory.length > 0) {
            // Prioritize events to keep most important ones
            this.prioritizeAbsorptionEvents(zone);

            // Apply memory optimization even if under maxEvents limit
            // This ensures we maintain optimal memory usage
            if (zone.eventHistory.length > maxEvents * 0.7) {
                // 70% threshold for optimization
                const optimizedCount = Math.max(1, Math.floor(maxEvents * 0.8)); // Keep 80% of max
                zone.eventHistory = zone.eventHistory.slice(-optimizedCount);
                optimizationPerformed = true;
            }

            // Update optimization timestamp
            zone.lastOptimization = currentTime;
        }

        // Track optimization performance
        if (optimizationPerformed || eventsRemoved > 0) {
            this.memoryStats.totalOptimizationsPerformed++;
        }

        // Memory monitoring
        this.monitorAbsorptionMemoryUsage(zone);
    }

    /**
     * Calculate maximum events per zone based on configuration and expected load
     */
    private calculateMaxEventsPerZone(): number {
        const historyWindowSeconds = this.config.historyWindowMs / 1000;
        const maxExpectedEvents =
            AbsorptionZoneTracker.EXPECTED_TRADES_PER_SECOND *
            historyWindowSeconds;

        // Ensure minimum of 5 events for meaningful optimization
        // and maximum of 50 to prevent excessive memory usage
        const calculatedMax = Math.floor(
            maxExpectedEvents *
                AbsorptionZoneTracker.MEMORY_MONITORING_THRESHOLD_PERCENT
        );

        return Math.max(5, Math.min(50, calculatedMax));
    }

    /**
     * Prioritize absorption events based on recency, confidence, and significance
     */
    private prioritizeAbsorptionEvents(zone: OptimizedAbsorptionZone): void {
        const weights = AbsorptionZoneTracker.EVENT_PRIORITIZATION_WEIGHTS;

        zone.eventHistory.sort((a, b) => {
            // Calculate priority score for each event
            const scoreA = this.calculateEventPriorityScore(a, weights);
            const scoreB = this.calculateEventPriorityScore(b, weights);
            return scoreB - scoreA; // Higher scores first
        });
    }

    /**
     * Calculate priority score for an absorption event
     */
    private calculateEventPriorityScore(
        event: AbsorptionEvent,
        weights: typeof AbsorptionZoneTracker.EVENT_PRIORITIZATION_WEIGHTS
    ): number {
        const currentTime = Date.now();
        const ageHours = (currentTime - event.timestamp) / (1000 * 60 * 60);

        // Recency score (newer = higher, max 1.0 for events < 1 hour old)
        const recencyScore = Math.max(0, 1.0 - ageHours);

        // Confidence score (already 0-1)
        const confidenceScore = event.confidence;

        // Significance score based on absorption ratio
        const significanceScore = Math.min(
            1.0,
            event.absorptionRatio / this.config.absorptionThreshold
        );

        return (
            recencyScore * weights.recency +
            confidenceScore * weights.confidence +
            significanceScore * weights.significance
        );
    }

    /**
     * Monitor memory usage for absorption history optimization
     */
    private monitorAbsorptionMemoryUsage(zone: OptimizedAbsorptionZone): void {
        const currentTime = Date.now();
        const maxEvents = this.calculateMaxEventsPerZone();

        // Update memory statistics
        this.memoryStats.totalEventsProcessed++;
        this.memoryStats.averageEventsPerZone =
            (this.memoryStats.averageEventsPerZone + zone.eventHistory.length) /
            2;
        this.memoryStats.peakMemoryUsage = Math.max(
            this.memoryStats.peakMemoryUsage,
            zone.eventHistory.length
        );

        // Periodic memory check (every 30 seconds)
        if (currentTime - this.memoryStats.lastMemoryCheck > 30000) {
            this.performMemoryCheck();
            this.memoryStats.lastMemoryCheck = currentTime;
        }

        // Alert on high memory usage
        if (zone.eventHistory.length > maxEvents * 0.8) {
            // 80% threshold
            console.log(
                `AbsorptionZone ${zone.zoneId}: High memory usage - ${zone.eventHistory.length}/${maxEvents} events`
            );
        }
    }

    /**
     * Perform comprehensive memory usage check
     */
    private performMemoryCheck(): void {
        const totalOptimizedZones =
            this.optimizedBidZones.size + this.optimizedAskZones.size;
        const totalLegacyZones = this.bidZones.size + this.askZones.size;

        let totalOptimizedEvents = 0;
        let totalLegacyHistory = 0;

        // Count optimized events
        for (const zone of this.optimizedBidZones.values()) {
            totalOptimizedEvents += zone.eventHistory.length;
        }
        for (const zone of this.optimizedAskZones.values()) {
            totalOptimizedEvents += zone.eventHistory.length;
        }

        // Count legacy history
        for (const zone of this.bidZones.values()) {
            totalLegacyHistory += zone.history.length;
        }
        for (const zone of this.askZones.values()) {
            totalLegacyHistory += zone.history.length;
        }

        const memoryReductionPercent =
            totalLegacyHistory > 0
                ? Math.round(
                      ((totalLegacyHistory - totalOptimizedEvents) /
                          totalLegacyHistory) *
                          100
                  )
                : 0;

        console.log(`Absorption Memory Check:`, {
            optimizedZones: totalOptimizedZones,
            legacyZones: totalLegacyZones,
            optimizedEvents: totalOptimizedEvents,
            legacyHistory: totalLegacyHistory,
            memoryReductionPercent: `${memoryReductionPercent}%`,
            averageEventsPerZone: Math.round(
                this.memoryStats.averageEventsPerZone
            ),
            peakMemoryUsage: this.memoryStats.peakMemoryUsage,
            optimizationsPerformed:
                this.memoryStats.totalOptimizationsPerformed,
        } as const);
    }

    /**
     * Get current tracking statistics including optimized system metrics
     */
    public getStats(): {
        bidZonesTracked: number;
        askZonesTracked: number;
        totalHistoryEntries: number;
        averageAbsorptionEvents: number;
        optimizedBidZones: number;
        optimizedAskZones: number;
        totalOptimizedEvents: number;
        memoryReductionPercent: number;
    } {
        let totalHistory = 0;
        let totalAbsorptionEvents = 0;
        let zoneCount = 0;

        // Legacy system stats
        for (const zone of this.bidZones.values()) {
            totalHistory += zone.history.length;
            totalAbsorptionEvents += zone.absorptionEvents;
            zoneCount++;
        }

        for (const zone of this.askZones.values()) {
            totalHistory += zone.history.length;
            totalAbsorptionEvents += zone.absorptionEvents;
            zoneCount++;
        }

        // Optimized system stats
        let totalOptimizedEvents = 0;
        for (const zone of this.optimizedBidZones.values()) {
            totalOptimizedEvents += zone.eventHistory.length;
        }
        for (const zone of this.optimizedAskZones.values()) {
            totalOptimizedEvents += zone.eventHistory.length;
        }

        // Calculate memory reduction
        const memoryReductionPercent =
            totalHistory > 0
                ? Math.round(
                      ((totalHistory - totalOptimizedEvents) / totalHistory) *
                          100
                  )
                : 0;

        return {
            bidZonesTracked: this.bidZones.size,
            askZonesTracked: this.askZones.size,
            totalHistoryEntries: totalHistory,
            averageAbsorptionEvents:
                zoneCount > 0 ? totalAbsorptionEvents / zoneCount : 0,
            optimizedBidZones: this.optimizedBidZones.size,
            optimizedAskZones: this.optimizedAskZones.size,
            totalOptimizedEvents,
            memoryReductionPercent,
        };
    }

    /**
     * Clear all tracked zones (both legacy and optimized systems)
     */
    public clear(): void {
        this.bidZones.clear();
        this.askZones.clear();
        this.optimizedBidZones.clear();
        this.optimizedAskZones.clear();
        this.currentSpread = null;
        this.priceHistory = [];
    }
}
