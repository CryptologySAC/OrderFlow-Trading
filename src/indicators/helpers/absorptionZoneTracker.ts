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
 * Zone history entry tracking absorption metrics over time
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
 * Zone tracking state for absorption analysis
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
 * Dynamic zone tracker for true absorption detection
 */
export class AbsorptionZoneTracker {
    private readonly bidZones = new Map<string, TrackedAbsorptionZone>();
    private readonly askZones = new Map<string, TrackedAbsorptionZone>();
    private currentSpread: { bid: number; ask: number } | null = null;
    private readonly config: AbsorptionTrackerConfig;
    private readonly tickSize: number;
    private priceHistory: Array<{ price: number; timestamp: number }> = [];

    constructor(config: AbsorptionTrackerConfig, tickSize: number) {
        this.config = config;
        this.tickSize = tickSize;
    }

    /**
     * Update spread and determine which zones to track
     */
    public updateSpread(bestBid: number, bestAsk: number): void {
        this.currentSpread = { bid: bestBid, ask: bestAsk };
        this.adjustTrackedZones();
    }

    /**
     * Process zone update and track absorption metrics
     */
    public updateZone(zone: ZoneSnapshot, timestamp: number): void {
        const zoneId = zone.zoneId;
        const isNearBid = this.isNearBid(zone.priceLevel);
        const isNearAsk = this.isNearAsk(zone.priceLevel);

        if (!isNearBid && !isNearAsk) {
            return; // Zone too far from spread
        }

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
     * Analyze zones for absorption patterns
     */
    public analyzeAbsorption(isBuyTrade: boolean): AbsorptionPattern {
        // ABSORPTION LOGIC (CORRECTED):
        // - Buy trades hit asks: If asks absorb buying → resistance holds → SELL signal (reversal down)
        // - Sell trades hit bids: If bids absorb selling → support holds → BUY signal (reversal up)
        const relevantZones = isBuyTrade ? this.askZones : this.bidZones;
        const absorptionType = isBuyTrade ? "ask" : "bid";

        let totalAbsorptionRatio = 0;
        let totalStrength = 0;
        let affectedZones = 0;
        let maxAbsorption = 0;
        let hasSignificantAbsorption = false;

        for (const zone of relevantZones.values()) {
            const analysis = this.analyzeZoneAbsorption(zone, absorptionType);

            if (analysis.isAbsorbing) {
                affectedZones++;
                totalAbsorptionRatio += analysis.absorptionRatio;
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

        if (affectedZones === 0) {
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

        const avgAbsorptionRatio = totalAbsorptionRatio / affectedZones;
        const avgStrength = totalStrength / affectedZones;
        const priceStability = this.checkPriceStability();

        // Calculate confidence based on multiple factors
        const confidence = this.calculateAbsorptionConfidence(
            avgAbsorptionRatio,
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
            absorptionRatio: avgAbsorptionRatio,
            absorptionStrength: avgStrength,
            affectedZones,
            confidence,
            priceStability,
            direction,
        };
    }

    /**
     * Analyze individual zone for absorption
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
     * Calculate absorption strength based on pattern consistency
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
    private checkPriceStability(): boolean {
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
        const tickDistance = distance / this.tickSize;
        return tickDistance >= 0 && tickDistance <= this.config.maxZonesPerSide;
    }

    /**
     * Check if zone is near ask
     */
    private isNearAsk(priceLevel: number): boolean {
        if (!this.currentSpread) return false;
        const distance = priceLevel - this.currentSpread.ask;
        const tickDistance = distance / this.tickSize;
        return tickDistance >= 0 && tickDistance <= this.config.maxZonesPerSide;
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
     * Get current tracking statistics
     */
    public getStats(): {
        bidZonesTracked: number;
        askZonesTracked: number;
        totalHistoryEntries: number;
        averageAbsorptionEvents: number;
    } {
        let totalHistory = 0;
        let totalAbsorptionEvents = 0;
        let zoneCount = 0;

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

        return {
            bidZonesTracked: this.bidZones.size,
            askZonesTracked: this.askZones.size,
            totalHistoryEntries: totalHistory,
            averageAbsorptionEvents:
                zoneCount > 0 ? totalAbsorptionEvents / zoneCount : 0,
        };
    }

    /**
     * Clear all tracked zones
     */
    public clear(): void {
        this.bidZones.clear();
        this.askZones.clear();
        this.currentSpread = null;
        this.priceHistory = [];
    }
}
