// src/indicators/helpers/exhaustionZoneTracker.ts
//
// 🎯 DYNAMIC ZONE TRACKING for TRUE EXHAUSTION DETECTION
//
// This helper class tracks passive volume depletion over time to identify real exhaustion patterns.
// TRUE EXHAUSTION: When passive liquidity walls are progressively depleted, forcing price to move
// to wider levels as liquidity providers retreat.
//
// KEY PATTERNS DETECTED:
// 1. Wall Depletion: 1000 → 800 → 500 → 200 → 0 (progressive depletion)
// 2. Gap Creation: Orders moving to wider levels after exhaustion
// 3. Directional Exhaustion: Tracking bid vs ask depletion separately
//

import { FinancialMath } from "../../utils/financialMath.js";
import { Config } from "../../core/config.js";
import type { ZoneSnapshot } from "../../types/marketEvents.js";

/**
 * Zone history entry tracking passive volume over time
 */
interface ZoneHistoryEntry {
    timestamp: number;
    passiveBidVolume: number;
    passiveAskVolume: number;
    aggressiveVolume: number;
    priceLevel: number;
    spread: number;
}

/**
 * Zone tracking state for exhaustion analysis
 */
interface TrackedZone {
    zoneId: string;
    priceLevel: number;
    history: ZoneHistoryEntry[];
    maxPassiveBidVolume: number; // Peak bid volume seen
    maxPassiveAskVolume: number; // Peak ask volume seen
    lastUpdate: number;
    depletionEvents: number; // Count of significant depletion events
}

/**
 * Exhaustion pattern detection result
 */
export interface ExhaustionPattern {
    hasExhaustion: boolean;
    exhaustionType: "bid" | "ask" | "both" | null;
    depletionRatio: number; // How much of peak volume has been depleted
    depletionVelocity: number; // Rate of depletion
    affectedZones: number;
    confidence: number;
    gapCreated: boolean; // True if liquidity moved to wider levels
}

/**
 * Configuration for zone tracking
 */
export interface ZoneTrackerConfig {
    maxZonesPerSide: number; // Number of zones to track on each side of spread
    historyWindowMs: number; // How long to keep zone history
    depletionThreshold: number; // Minimum depletion ratio to consider exhaustion (e.g., 0.7 = 70% depleted)
    minPeakVolume: number; // Minimum peak volume to consider for exhaustion
    gapDetectionTicks: number; // Price distance in ticks to detect gap creation
}

/**
 * Dynamic zone tracker for true exhaustion detection
 */
export class ExhaustionZoneTracker {
    private readonly bidZones = new Map<string, TrackedZone>();
    private readonly askZones = new Map<string, TrackedZone>();
    private currentSpread: { bid: number; ask: number } | null = null;
    private readonly config: ZoneTrackerConfig;
    private readonly tickSize: number;

    // Confidence calculation constants
    private static readonly CONFIDENCE_BASE_MAX = 0.4;
    private static readonly CONFIDENCE_BASE_MULTIPLIER = 0.5;
    private static readonly CONFIDENCE_ZONES_CONTRIBUTION = 0.2;
    private static readonly CONFIDENCE_DEPLETION_CONTRIBUTION = 0.2;
    private static readonly CONFIDENCE_DEPLETION_MULTIPLIER = 0.25;
    private static readonly CONFIDENCE_GAP_BONUS = 0.2;

    // Zone distance constants
    private static readonly ZONE_SPREAD_TOLERANCE_TICKS = 2; // Allow zones 2 ticks inside spread

    constructor(config: ZoneTrackerConfig, tickSize: number) {
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
     * Process zone update and track passive volume changes
     */
    public updateZone(zone: ZoneSnapshot, timestamp: number): void {
        // Track all zones including depleted ones (passive volume = 0) to detect exhaustion patterns

        if (!this.currentSpread) {
            return; // Wait for spread to be set
        }

        const isNearBid = this.isNearBid(zone.priceLevel);
        const isNearAsk = this.isNearAsk(zone.priceLevel);

        if (!isNearBid && !isNearAsk) {
            // Zone too far from spread - skip silently
            return;
        }

        // Precise zone classification: check exact prices first
        let isAskZone: boolean;
        if (this.currentSpread && zone.priceLevel === this.currentSpread.ask) {
            isAskZone = true; // Exactly at ask price -> ask zone
        } else if (
            this.currentSpread &&
            zone.priceLevel === this.currentSpread.bid
        ) {
            isAskZone = false; // Exactly at bid price -> bid zone
        } else if (isNearAsk && !isNearBid) {
            isAskZone = true; // Only near ask -> ask zone
        } else if (isNearBid && !isNearAsk) {
            isAskZone = false; // Only near bid -> bid zone
        } else {
            // Both near bid and ask (in spread) - use distance to determine
            const bidDistance = Math.abs(
                zone.priceLevel - (this.currentSpread?.bid || 0)
            );
            const askDistance = Math.abs(
                zone.priceLevel - (this.currentSpread?.ask || 0)
            );
            isAskZone = askDistance <= bidDistance;
        }

        const trackedZones = isAskZone ? this.askZones : this.bidZones;

        // Use price level as key for better zone continuity
        // Normalize to tick size using FinancialMath for consistency
        const normalizedPrice = FinancialMath.normalizePriceToTick(
            zone.priceLevel,
            this.tickSize
        );
        const zoneKey = `${isAskZone ? "ask" : "bid"}_${normalizedPrice.toFixed(Config.PRICE_PRECISION)}`;
        let tracked = trackedZones.get(zoneKey);

        if (!tracked) {
            // Initialize new tracked zone
            tracked = {
                zoneId: zoneKey,
                priceLevel: zone.priceLevel,
                history: [],
                maxPassiveBidVolume: zone.passiveBidVolume,
                maxPassiveAskVolume: zone.passiveAskVolume,
                lastUpdate: timestamp,
                depletionEvents: 0,
            };
            trackedZones.set(zoneKey, tracked);
        }

        // Update peak volumes - use cumulative maximum for proper depletion detection
        const currentBidVolume = zone.passiveBidVolume || 0;
        const currentAskVolume = zone.passiveAskVolume || 0;

        // Track cumulative maximum volumes - never decrease peaks
        tracked.maxPassiveBidVolume = Math.max(
            tracked.maxPassiveBidVolume || 0,
            currentBidVolume
        );
        tracked.maxPassiveAskVolume = Math.max(
            tracked.maxPassiveAskVolume || 0,
            currentAskVolume
        );

        // Add history entry with proper defaults
        const entry: ZoneHistoryEntry = {
            timestamp,
            passiveBidVolume: currentBidVolume,
            passiveAskVolume: currentAskVolume,
            aggressiveVolume: zone.aggressiveVolume || 0,
            priceLevel: zone.priceLevel,
            spread: this.currentSpread
                ? FinancialMath.calculateSpread(
                      this.currentSpread.ask,
                      this.currentSpread.bid,
                      4
                  )
                : 0,
        };

        tracked.history.push(entry);
        tracked.lastUpdate = timestamp;

        // Check for depletion event
        this.detectDepletionEvent(tracked, isAskZone ? "ask" : "bid");

        // Clean old history
        this.cleanOldHistory(tracked, timestamp);
    }

    /**
     * Analyze zones for exhaustion patterns
     */
    public analyzeExhaustion(isBuyTrade: boolean): ExhaustionPattern {
        const relevantZones = isBuyTrade ? this.askZones : this.bidZones;
        const exhaustionType = isBuyTrade ? "ask" : "bid";

        let totalDepletionRatio = 0;
        let totalVelocity = 0;
        let affectedZones = 0;
        let maxDepletion = 0;
        let hasSignificantExhaustion = false;

        for (const zone of relevantZones.values()) {
            const analysis = this.analyzeZoneExhaustion(zone, exhaustionType);

            if (analysis.isExhausted) {
                affectedZones++;
                totalDepletionRatio += analysis.depletionRatio;
                totalVelocity += analysis.velocity;
                maxDepletion = Math.max(maxDepletion, analysis.depletionRatio);

                if (analysis.depletionRatio >= this.config.depletionThreshold) {
                    hasSignificantExhaustion = true;
                }
            }
        }

        if (affectedZones === 0) {
            return {
                hasExhaustion: false,
                exhaustionType: null,
                depletionRatio: 0,
                depletionVelocity: 0,
                affectedZones: 0,
                confidence: 0,
                gapCreated: false,
            };
        }

        const avgDepletionRatio = totalDepletionRatio / affectedZones;
        const avgVelocity = totalVelocity / affectedZones;
        const gapCreated = this.detectGapCreation(exhaustionType);

        // Calculate confidence based on multiple factors
        const confidence = this.calculateExhaustionConfidence(
            avgDepletionRatio,
            affectedZones,
            maxDepletion,
            gapCreated
        );

        return {
            hasExhaustion: hasSignificantExhaustion,
            exhaustionType,
            depletionRatio: avgDepletionRatio,
            depletionVelocity: avgVelocity,
            affectedZones,
            confidence,
            gapCreated,
        };
    }

    /**
     * Analyze individual zone for exhaustion
     */
    private analyzeZoneExhaustion(
        zone: TrackedZone,
        side: "bid" | "ask"
    ): {
        isExhausted: boolean;
        depletionRatio: number;
        velocity: number;
    } {
        if (zone.history.length < 2) {
            return { isExhausted: false, depletionRatio: 0, velocity: 0 };
        }

        const peakVolume =
            side === "bid"
                ? zone.maxPassiveBidVolume
                : zone.maxPassiveAskVolume;

        if (peakVolume < this.config.minPeakVolume) {
            return { isExhausted: false, depletionRatio: 0, velocity: 0 };
        }

        const lastEntry = zone.history[zone.history.length - 1];
        if (!lastEntry) {
            return { isExhausted: false, depletionRatio: 0, velocity: 0 };
        }

        const currentVolume =
            side === "bid"
                ? lastEntry.passiveBidVolume
                : lastEntry.passiveAskVolume;

        const depletionRatio = FinancialMath.divideQuantities(
            peakVolume - currentVolume,
            peakVolume
        );

        // Calculate velocity (rate of depletion)
        const velocity = this.calculateDepletionVelocity(zone, side);

        const isExhausted = depletionRatio >= this.config.depletionThreshold;

        return { isExhausted, depletionRatio, velocity };
    }

    /**
     * Calculate rate of passive volume depletion
     */
    private calculateDepletionVelocity(
        zone: TrackedZone,
        side: "bid" | "ask"
    ): number {
        if (zone.history.length < 3) {
            return 0;
        }

        // Look at recent history (last N entries or available)
        const historyLookback = 5; // Number of recent entries to analyze
        const recentHistory = zone.history.slice(-historyLookback);
        let totalChange = 0;
        let timeSpan = 0;

        for (let i = 1; i < recentHistory.length; i++) {
            const prev = recentHistory[i - 1];
            const curr = recentHistory[i];

            if (!prev || !curr) {
                continue;
            }

            const prevVolume =
                side === "bid" ? prev.passiveBidVolume : prev.passiveAskVolume;
            const currVolume =
                side === "bid" ? curr.passiveBidVolume : curr.passiveAskVolume;

            const change = prevVolume - currVolume;
            if (change > 0) {
                // Only count depletion
                totalChange += change;
            }

            timeSpan = curr.timestamp - prev.timestamp;
        }

        if (timeSpan === 0) {
            return 0;
        }

        // Return depletion rate per second
        return FinancialMath.divideQuantities(
            totalChange * 1000, // Convert to per second
            timeSpan
        );
    }

    /**
     * Detect if liquidity has moved to wider levels (gap creation)
     */
    private detectGapCreation(side: "bid" | "ask"): boolean {
        if (!this.currentSpread) {
            return false;
        }

        const zones = side === "bid" ? this.bidZones : this.askZones;
        const spreadPrice =
            side === "bid" ? this.currentSpread.bid : this.currentSpread.ask;

        // Check if nearest zones are depleted
        let nearestDepleted = false;
        let hasWiderLiquidity = false;

        for (const zone of zones.values()) {
            const distance = Math.abs(zone.priceLevel - spreadPrice);
            const distanceInTicks = distance / this.tickSize;

            if (distanceInTicks <= 1) {
                // Nearest zone
                const analysis = this.analyzeZoneExhaustion(zone, side);
                if (analysis.depletionRatio > 0.8) {
                    nearestDepleted = true;
                }
            } else if (distanceInTicks >= this.config.gapDetectionTicks) {
                // Wider zone
                const lastEntry = zone.history[zone.history.length - 1];
                const currentVolume =
                    side === "bid"
                        ? lastEntry?.passiveBidVolume || 0
                        : lastEntry?.passiveAskVolume || 0;

                if (currentVolume > this.config.minPeakVolume) {
                    hasWiderLiquidity = true;
                }
            }
        }

        return nearestDepleted && hasWiderLiquidity;
    }

    /**
     * Calculate confidence score for exhaustion pattern
     */
    private calculateExhaustionConfidence(
        avgDepletionRatio: number,
        affectedZones: number,
        maxDepletion: number,
        gapCreated: boolean
    ): number {
        let confidence = 0;

        // Base confidence from depletion ratio (0-40%)
        confidence += Math.min(
            ExhaustionZoneTracker.CONFIDENCE_BASE_MAX,
            avgDepletionRatio * ExhaustionZoneTracker.CONFIDENCE_BASE_MULTIPLIER
        );

        // Affected zones contribution (0-20%)
        const zoneScore = Math.min(
            1,
            affectedZones / this.config.maxZonesPerSide
        );
        confidence +=
            zoneScore * ExhaustionZoneTracker.CONFIDENCE_ZONES_CONTRIBUTION;

        // Max depletion contribution (0-20%)
        confidence += Math.min(
            ExhaustionZoneTracker.CONFIDENCE_DEPLETION_CONTRIBUTION,
            maxDepletion * ExhaustionZoneTracker.CONFIDENCE_DEPLETION_MULTIPLIER
        );

        // Gap creation bonus (0-20%)
        if (gapCreated) {
            confidence += ExhaustionZoneTracker.CONFIDENCE_GAP_BONUS;
        }

        return confidence;
    }

    /**
     * Detect significant depletion events
     */
    private detectDepletionEvent(zone: TrackedZone, side: "bid" | "ask"): void {
        if (zone.history.length < 2) {
            return;
        }

        const current = zone.history[zone.history.length - 1];
        const previous = zone.history[zone.history.length - 2];

        if (!current || !previous) {
            return;
        }

        const currentVolume =
            side === "bid"
                ? current.passiveBidVolume
                : current.passiveAskVolume;
        const previousVolume =
            side === "bid"
                ? previous.passiveBidVolume
                : previous.passiveAskVolume;

        // Detect significant depletion using configured threshold
        if (previousVolume > 0) {
            const depletion = (previousVolume - currentVolume) / previousVolume;
            if (depletion > this.config.depletionThreshold * 0.5) {
                // Use half of main threshold for single-update detection
                zone.depletionEvents++;
            }
        }
    }

    /**
     * Check if zone is near bid
     */
    private isNearBid(priceLevel: number): boolean {
        if (!this.currentSpread) return false;
        // Include zones AT and BELOW the bid (and slightly above for spread zones)
        const distance = this.currentSpread.bid - priceLevel;
        const tickDistance = distance / this.tickSize;
        // Allow zones from slightly above bid (negative distance) to maxZonesPerSide below
        return (
            tickDistance >=
                -ExhaustionZoneTracker.ZONE_SPREAD_TOLERANCE_TICKS &&
            tickDistance <= this.config.maxZonesPerSide
        );
    }

    /**
     * Check if zone is near ask
     */
    private isNearAsk(priceLevel: number): boolean {
        if (!this.currentSpread) return false;
        // Include zones AT and ABOVE the ask (and slightly below for spread zones)
        const distance = priceLevel - this.currentSpread.ask;
        const tickDistance = distance / this.tickSize;
        // Allow zones from slightly below ask (negative distance) to maxZonesPerSide above
        return (
            tickDistance >=
                -ExhaustionZoneTracker.ZONE_SPREAD_TOLERANCE_TICKS &&
            tickDistance <= this.config.maxZonesPerSide
        );
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
        zones: Map<string, TrackedZone>,
        side: "bid" | "ask"
    ): void {
        const toRemove: string[] = [];

        for (const [key] of zones) {
            // Extract price from "bid_89.50" or "ask_89.50" key format
            const parts = key.split("_");
            if (parts.length !== 2 || !parts[1]) {
                toRemove.push(key); // Invalid key format
                continue;
            }

            const price = parseFloat(parts[1]);
            if (isNaN(price)) {
                toRemove.push(key); // Invalid price
                continue;
            }

            const isNear =
                side === "bid" ? this.isNearBid(price) : this.isNearAsk(price);

            if (!isNear) {
                toRemove.push(key);
            }
        }

        for (const key of toRemove) {
            zones.delete(key);
        }
    }

    /**
     * Clean old history entries
     */
    private cleanOldHistory(zone: TrackedZone, currentTime: number): void {
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
        averageDepletionEvents: number;
    } {
        let totalHistory = 0;
        let totalDepletionEvents = 0;
        let zoneCount = 0;

        for (const zone of this.bidZones.values()) {
            totalHistory += zone.history.length;
            totalDepletionEvents += zone.depletionEvents;
            zoneCount++;
        }

        for (const zone of this.askZones.values()) {
            totalHistory += zone.history.length;
            totalDepletionEvents += zone.depletionEvents;
            zoneCount++;
        }

        return {
            bidZonesTracked: this.bidZones.size,
            askZonesTracked: this.askZones.size,
            totalHistoryEntries: totalHistory,
            averageDepletionEvents:
                zoneCount > 0 ? totalDepletionEvents / zoneCount : 0,
        };
    }

    /**
     * Clear all tracked zones
     */
    public clear(): void {
        this.bidZones.clear();
        this.askZones.clear();
        this.currentSpread = null;
    }
}
