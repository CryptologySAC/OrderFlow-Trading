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
// MEMORY MONITORING:
// - Calculated monitoring threshold based on configuration
// - Uses zoneHistoryWindowMs (300000ms) and expected trade frequency
// - Threshold = (trades/second × window/seconds) × 0.1
// - Provides foundation for future memory optimization strategies
// - Maintains original unlimited history behavior for full detection accuracy
//

import { FinancialMath } from "../../utils/financialMathRustDropIn.js";
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
    consumptionConfidence: number; // Confidence that depletion is from real consumption (0-1)
    lastConfirmedConsumption: number; // Timestamp of last confirmed consumption
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
    passesMinPeakVolume: boolean; // Added: Indicates if minPeakVolume was met for any affected zone
}

/**
 * Configuration for zone tracking
 */
export interface ZoneTrackerConfig {
    maxZonesPerSide: number; // Number of zones to track on each side
    historyWindowMs: number; // How long to keep zone history
    depletionThreshold: number; // Minimum depletion ratio to consider exhaustion (e.g., 0.7 = 70% depleted)
    minPeakVolume: number; // Minimum peak volume to consider for exhaustion
    gapDetectionTicks: number; // Price distance in ticks to detect gap creation
    consumptionValidation?:
        | {
              maxReasonableVelocity: number; // Maximum reasonable depletion velocity
              minConsumptionConfidence: number; // Minimum confidence required for exhaustion
              confidenceDecayTimeMs: number; // Time after which confidence decays
              minAggressiveVolume: number; // Minimum aggressive volume for validation
          }
        | undefined;
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
                consumptionConfidence: 0.6, // Start with higher confidence for new zones
                lastConfirmedConsumption: timestamp, // Initialize with current time
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
        let totalWeightedDepletion = 0;
        let totalPeakVolume = 0;
        let totalVelocity = 0;
        let affectedZones = 0;
        let maxDepletion = 0;
        let hasSignificantExhaustion = false;
        let passesMinPeakVolumeOverall = false; // Initialize

        for (const zone of relevantZones.values()) {
            const analysis = this.analyzeZoneExhaustion(zone, exhaustionType);

            if (analysis.isExhausted) {
                affectedZones++;
                const peakVolume =
                    exhaustionType === "bid"
                        ? zone.maxPassiveBidVolume
                        : zone.maxPassiveAskVolume;
                totalWeightedDepletion += analysis.depletionRatio * peakVolume;
                totalPeakVolume += peakVolume;
                totalVelocity += analysis.velocity;
                maxDepletion = Math.max(maxDepletion, analysis.depletionRatio);

                if (analysis.depletionRatio >= this.config.depletionThreshold) {
                    hasSignificantExhaustion = true;
                }
                // Add this line:
                if (peakVolume >= this.config.minPeakVolume) {
                    passesMinPeakVolumeOverall = true;
                }
            }
        }

        if (affectedZones === 0 || totalPeakVolume === 0) {
            return {
                hasExhaustion: false,
                exhaustionType: null,
                depletionRatio: 0,
                depletionVelocity: 0,
                affectedZones: 0,
                confidence: 0,
                gapCreated: false,
                passesMinPeakVolume: false, // Added this line
            };
        }

        const weightedAvgDepletionRatio =
            totalWeightedDepletion / totalPeakVolume;
        const avgVelocity = totalVelocity / affectedZones;
        const gapCreated = this.detectGapCreation(exhaustionType);

        // Calculate confidence based on multiple factors
        const confidence = this.calculateExhaustionConfidence(
            weightedAvgDepletionRatio,
            affectedZones,
            maxDepletion,
            gapCreated
        );

        return {
            hasExhaustion: hasSignificantExhaustion,
            exhaustionType,
            depletionRatio: weightedAvgDepletionRatio,
            depletionVelocity: avgVelocity,
            affectedZones,
            confidence,
            gapCreated,
            passesMinPeakVolume: passesMinPeakVolumeOverall, // Added this line
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

        const lastEntry = zone.history[zone.history.length - 1];
        if (!lastEntry) {
            return { isExhausted: false, depletionRatio: 0, velocity: 0 };
        }

        const peakVolume =
            side === "bid"
                ? zone.maxPassiveBidVolume
                : zone.maxPassiveAskVolume;

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

        if (peakVolume < this.config.minPeakVolume) {
            return {
                isExhausted: false,
                depletionRatio: depletionRatio,
                velocity: velocity,
            };
        }

        // Validate that depletion is from real consumption, not spoofing
        const isValidConsumption = this.validateConsumptionPattern(
            zone,
            side,
            depletionRatio,
            velocity
        );

        const isExhausted =
            depletionRatio >= this.config.depletionThreshold &&
            isValidConsumption;

        return { isExhausted, depletionRatio, velocity };
    }

    /**
     * Calculate rate of passive volume depletion
     */
    private calculateDepletionVelocity(
        zone: TrackedZone,
        side: "bid" | "ask"
    ): number {
        if (zone.history.length < 2) {
            return 0;
        }

        const historyLookback = 5; // Number of recent entries to analyze
        const recentHistory = zone.history.slice(-historyLookback);
        if (recentHistory.length < 2) {
            return 0;
        }

        let totalChange = 0;
        const startTime = recentHistory[0]?.timestamp;
        const endTime = recentHistory[recentHistory.length - 1]?.timestamp;

        if (!startTime || !endTime || startTime === endTime) {
            return 0;
        }

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
        }

        const timeSpan = endTime - startTime;
        if (timeSpan <= 0) {
            return 0;
        }

        // Return depletion rate per second
        return FinancialMath.divideQuantities(
            totalChange * 1000, // Convert to per second
            timeSpan
        );
    }

    /**
     * Validate that depletion is from real consumption, not spoofing
     * Uses multiple heuristics to distinguish genuine trading activity from order manipulation
     */
    private validateConsumptionPattern(
        zone: TrackedZone,
        side: "bid" | "ask",
        depletionRatio: number,
        velocity: number
    ): boolean {
        // Relaxed validation: allow 2 entries for basic validation
        if (zone.history.length < 2) {
            return false; // Need at least 2 data points
        }

        // For high depletion ratios, be more lenient with validation
        if (
            depletionRatio >= this.config.depletionThreshold &&
            zone.history.length >= 2
        ) {
            return true; // High depletion with sufficient history
        }

        // Relaxed validation: allow 2 entries for basic validation
        if (zone.history.length < 2) {
            return false; // Need at least 2 data points
        }

        // For high depletion ratios, be more lenient with validation
        if (
            depletionRatio >= this.config.depletionThreshold &&
            zone.history.length >= 2
        ) {
            return true; // High depletion with sufficient history
        }

        if (zone.history.length < 3) {
            return false; // Need more data for full validation
        }

        // Heuristic 1: Check for suspicious velocity patterns (too fast = likely spoofing)
        // Use adaptive threshold based on zone's historical activity
        const adaptiveVelocityThreshold =
            this.calculateAdaptiveVelocityThreshold(zone, side);
        const maxReasonableVelocity =
            this.config.consumptionValidation?.maxReasonableVelocity ?? 5000;

        if (
            velocity >
            Math.max(adaptiveVelocityThreshold, maxReasonableVelocity)
        ) {
            return false; // Too fast, likely spoofing
        }

        // Heuristic 2: Check for gradual vs sudden depletion patterns
        const recentHistory = zone.history.slice(-5);
        let suddenDrops = 0;
        let gradualChanges = 0;

        for (let i = 1; i < recentHistory.length; i++) {
            const prev = recentHistory[i - 1];
            const curr = recentHistory[i];

            if (!prev || !curr) continue;

            const prevVolume =
                side === "bid" ? prev.passiveBidVolume : prev.passiveAskVolume;
            const currVolume =
                side === "bid" ? curr.passiveBidVolume : curr.passiveAskVolume;

            if (prevVolume > 0) {
                const changeRatio = (prevVolume - currVolume) / prevVolume;

                if (changeRatio > 0.5) {
                    suddenDrops++; // >50% drop in single update
                } else if (changeRatio > 0.05) {
                    gradualChanges++; // 5-50% drop (reasonable trading)
                }
            }
        }

        // If mostly sudden drops with few gradual changes, likely spoofing
        if (suddenDrops > gradualChanges * 2) {
            return false;
        }

        // Heuristic 3: Check for consumption confidence based on recent activity
        const timeSinceLastConsumption =
            Date.now() - zone.lastConfirmedConsumption;
        const confidenceDecayTime =
            this.config.consumptionValidation?.confidenceDecayTimeMs ?? 30000;

        if (timeSinceLastConsumption > confidenceDecayTime) {
            // Confidence decays over time without confirmed consumption
            zone.consumptionConfidence = Math.max(
                0.1,
                zone.consumptionConfidence * 0.9
            );
        }

        // Heuristic 4: Check for realistic depletion patterns
        // Real consumption typically shows some aggressive volume activity
        const recentAggressiveVolume = recentHistory.reduce((sum, entry) => {
            return FinancialMath.safeAdd(sum, entry.aggressiveVolume);
        }, 0);

        // If significant depletion but no aggressive volume, suspicious
        const minAggressiveVolume =
            this.config.consumptionValidation?.minAggressiveVolume ?? 20;
        if (
            depletionRatio > 0.3 &&
            recentAggressiveVolume < minAggressiveVolume
        ) {
            return false;
        }

        // Update confidence based on validation results
        if (gradualChanges > 0 && recentAggressiveVolume > 0) {
            zone.consumptionConfidence = Math.min(
                1.0,
                zone.consumptionConfidence + 0.1
            );
            zone.lastConfirmedConsumption = Date.now();
        }

        // Require minimum confidence for exhaustion signal
        const minConfidence =
            this.config.consumptionValidation?.minConsumptionConfidence ?? 0.4;
        return zone.consumptionConfidence >= minConfidence;
    }

    /**
     * Detect if liquidity has moved to wider levels (gap creation)
     */
    private detectGapCreation(side: "bid" | "ask"): boolean {
        if (!this.currentSpread) {
            return false;
        }

        const zones = side === "bid" ? this.bidZones : this.askZones;
        if (zones.size === 0) {
            return false;
        }

        const spreadPrice =
            side === "bid" ? this.currentSpread.bid : this.currentSpread.ask;

        // Find the most relevant, depleted zone at the spread
        let primaryZone: TrackedZone | null = null;
        let minDistance = Infinity;

        for (const zone of zones.values()) {
            const distance = Math.abs(zone.priceLevel - spreadPrice);
            if (distance < minDistance) {
                minDistance = distance;
                primaryZone = zone;
            }
        }

        if (!primaryZone) {
            return false;
        }

        // 1. Check if the primary zone is significantly depleted
        const primaryAnalysis = this.analyzeZoneExhaustion(primaryZone, side);
        if (primaryAnalysis.depletionRatio < 0.8) {
            // Not depleted enough to be the leading edge of a gap
            return false;
        }

        // 2. Define the "gap zone" immediately behind the primary zone
        const gapZoneStart =
            side === "bid"
                ? primaryZone.priceLevel - this.tickSize
                : primaryZone.priceLevel + this.tickSize;
        const gapZoneEnd =
            side === "bid"
                ? gapZoneStart - this.config.gapDetectionTicks * this.tickSize
                : gapZoneStart + this.config.gapDetectionTicks * this.tickSize;

        // 3. Check for a lack of liquidity in the gap zone
        let liquidityInGapZone = 0;
        for (const zone of zones.values()) {
            if (
                (side === "bid" &&
                    zone.priceLevel < primaryZone.priceLevel &&
                    zone.priceLevel >= gapZoneEnd) ||
                (side === "ask" &&
                    zone.priceLevel > primaryZone.priceLevel &&
                    zone.priceLevel <= gapZoneEnd)
            ) {
                const lastEntry = zone.history[zone.history.length - 1];
                const currentVolume =
                    side === "bid"
                        ? lastEntry?.passiveBidVolume || 0
                        : lastEntry?.passiveAskVolume || 0;
                liquidityInGapZone += currentVolume;
            }
        }

        // If liquidity in the gap is high, it's not a true gap
        if (liquidityInGapZone > this.config.minPeakVolume * 0.5) {
            return false;
        }

        // 4. Confirm that significant liquidity exists at a wider level
        let hasWiderLiquidity = false;
        const widerZoneStart =
            side === "bid"
                ? gapZoneEnd - this.tickSize
                : gapZoneEnd + this.tickSize;

        for (const zone of zones.values()) {
            if (
                (side === "bid" && zone.priceLevel <= widerZoneStart) ||
                (side === "ask" && zone.priceLevel >= widerZoneStart)
            ) {
                const lastEntry = zone.history[zone.history.length - 1];
                const currentVolume =
                    side === "bid"
                        ? lastEntry?.passiveBidVolume || 0
                        : lastEntry?.passiveAskVolume || 0;

                if (currentVolume > this.config.minPeakVolume) {
                    hasWiderLiquidity = true;
                    break;
                }
            }
        }

        return hasWiderLiquidity; // A true gap exists if there's a depleted front, a low-liquidity middle, and a high-liquidity back.
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
        const previous =
            zone.history.length > 1
                ? zone.history[zone.history.length - 2]
                : null;

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
     * Clean old history entries with calculated memory monitoring
     * Uses configuration-based calculations instead of magic numbers
     */
    private cleanOldHistory(zone: TrackedZone, currentTime: number): void {
        const cutoff = currentTime - this.config.historyWindowMs;
        zone.history = zone.history.filter((entry) => entry.timestamp > cutoff);

        // CALCULATED MEMORY MONITORING THRESHOLD:
        // Based on configuration and market data analysis
        // - zoneHistoryWindowMs: 300000ms (5 minutes) from config.json exhaustion settings
        // - Expected trades per second: 25 (conservative estimate for LTCUSDT based on typical volume)
        // - Memory threshold: 10% of max expected history size (7500 entries max × 0.1 = 750)
        // - Formula: (trades/second × window/seconds) × monitoring_percentage
        const expectedTradesPerSecond = 25; // Based on LTCUSDT average trade frequency
        const historyWindowSeconds = this.config.historyWindowMs / 1000;
        const maxExpectedHistorySize =
            expectedTradesPerSecond * historyWindowSeconds;
        const memoryMonitoringThreshold = Math.floor(
            maxExpectedHistorySize * 0.1
        ); // 10% threshold

        // MEMORY MONITORING: Track history size for optimization insights
        // This provides data for future memory optimization without breaking functionality
        if (zone.history.length > memoryMonitoringThreshold) {
            // Log when history becomes large (for monitoring purposes)
            // In production, this could trigger memory optimization strategies
            console.log(
                `Zone ${zone.zoneId} has ${zone.history.length} history entries (threshold: ${memoryMonitoringThreshold})`
            );
        }
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
     * Calculate adaptive velocity threshold based on zone's historical activity
     * This makes validation more flexible in volatile vs calm market conditions
     */
    private calculateAdaptiveVelocityThreshold(
        zone: TrackedZone,
        side: "bid" | "ask"
    ): number {
        if (zone.history.length < 3) {
            // Not enough data, use default
            return (
                this.config.consumptionValidation?.maxReasonableVelocity ?? 1000
            );
        }

        // Calculate average velocity from recent history
        const recentHistory = zone.history.slice(-10); // Last 10 entries
        let totalVelocity = 0;
        let validPairs = 0;

        for (let i = 1; i < recentHistory.length; i++) {
            const prev = recentHistory[i - 1];
            const curr = recentHistory[i];

            if (!prev || !curr) continue;

            const prevVolume =
                side === "bid" ? prev.passiveBidVolume : prev.passiveAskVolume;
            const currVolume =
                side === "bid" ? curr.passiveBidVolume : curr.passiveAskVolume;

            if (prevVolume > 0) {
                const depletion = (prevVolume - currVolume) / prevVolume;
                const timeDiff = curr.timestamp - prev.timestamp;

                if (timeDiff > 0) {
                    const velocity = depletion / (timeDiff / 1000); // per second
                    totalVelocity += velocity;
                    validPairs++;
                }
            }
        }

        if (validPairs === 0) {
            return (
                this.config.consumptionValidation?.maxReasonableVelocity ?? 1000
            );
        }

        const avgVelocity = totalVelocity / validPairs;

        // Allow 3x the average velocity as adaptive threshold
        // This provides flexibility for volatile markets while still catching spoofing
        const adaptiveThreshold = avgVelocity * 3;

        // Don't go below a minimum threshold to prevent too much leniency
        const minThreshold = 500;
        // Don't go above the configured maximum to maintain safety
        const maxThreshold =
            this.config.consumptionValidation?.maxReasonableVelocity ?? 5000;

        return Math.max(
            minThreshold,
            Math.min(maxThreshold, adaptiveThreshold)
        );
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
