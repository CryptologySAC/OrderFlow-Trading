// src/indicators/accumulationDetector.ts

import { SpotWebsocketStreams } from "@binance/spot";
import { BaseDetector } from "./base/baseDetector.js";
import { Logger } from "../infrastructure/logger.js";
import { MetricsCollector } from "../infrastructure/metricsCollector.js";
import { ISignalLogger } from "../services/signalLogger.js";
import { SpoofingDetector } from "../services/spoofingDetector.js";
import { RollingWindow } from "../utils/rollingWindow.js";
import { SharedPools } from "../utils/objectPool.js";

import type {
    EnrichedTradeEvent,
    AggressiveTrade,
} from "../types/marketEvents.js";
import type {
    DetectorCallback,
    AccumulationSettings,
    AccumulationFeatures,
    IAccumulationDetector,
} from "./interfaces/detectorInterfaces.js";
import { SignalType, AccumulationResult } from "../types/signalTypes.js";

/**
 * Enhanced AccumulationDetector - detects sustained passive > aggressive flow
 * Production-ready with standardized architecture and features
 */
export class AccumulationDetector
    extends BaseDetector
    implements IAccumulationDetector
{
    protected readonly detectorType = "accumulation" as const;
    protected readonly features: AccumulationFeatures;

    // Accumulation-specific configuration
    private readonly minDurationMs: number;
    private readonly minRatio: number;
    private readonly minRecentActivityMs: number;
    private readonly accumulationThreshold: number;

    // Enhanced tracking structures
    private readonly zoneData = new Map<number, ZoneAccumulationData>();
    private lastCleanup = Date.now();
    private readonly cleanupIntervalMs = 60000;

    constructor(
        id: string,
        callback: DetectorCallback,
        settings: AccumulationSettings = {},
        logger: Logger,
        spoofingDetector: SpoofingDetector,
        metricsCollector: MetricsCollector,
        signalLogger?: ISignalLogger
    ) {
        super(
            id,
            callback,
            settings,
            logger,
            spoofingDetector,
            metricsCollector,
            signalLogger
        );

        // Initialize accumulation-specific settings
        this.minDurationMs = settings.minDurationMs ?? 300000; // 5 minutes
        this.minRatio = settings.minRatio ?? 1.5;
        this.minRecentActivityMs = settings.minRecentActivityMs ?? 60000; // 1 minute
        this.accumulationThreshold = settings.accumulationThreshold ?? 0.6;

        // Merge accumulation-specific features
        this.features = {
            sideTracking: true,
            durationWeighting: true,
            volumeVelocity: false,
            strengthAnalysis: true,
            ...settings.features,
        };

        this.logger.info(
            `[AccumulationDetector] Initialized with enhanced features`,
            {
                minDurationMs: this.minDurationMs,
                minRatio: this.minRatio,
                accumulationThreshold: this.accumulationThreshold,
                features: this.features,
            }
        );

        // Setup cleanup interval
        setInterval(() => this.cleanupOldData(), this.cleanupIntervalMs);
    }

    protected getSignalType(): SignalType {
        return this.detectorType;
    }

    /**
     * Accumulation-specific trade handling (called by base class)
     */
    protected onEnrichedTradeSpecific(event: EnrichedTradeEvent): void {
        // Track accumulation in zones
        this.updateZoneAccumulation(event);
    }

    /**
     * Main detection loop for accumulation patterns
     */
    protected checkForSignal(triggerTrade: AggressiveTrade): void {
        const now = Date.now();

        try {
            // Check all active zones for accumulation patterns
            for (const [zone, data] of this.zoneData) {
                if (now - data.lastUpdate > this.minRecentActivityMs) {
                    continue; // Skip stale zones
                }

                this.analyzeZoneForAccumulation(zone, data, triggerTrade);
            }

            // Record detection attempt metrics
            this.metricsCollector.incrementMetric(
                "accumulationDetectionAttempts"
            );
            this.metricsCollector.updateMetric(
                "accumulationZonesActive",
                this.zoneData.size
            );
        } catch (error) {
            this.handleError(
                error as Error,
                "AccumulationDetector.checkForSignal"
            );
            this.metricsCollector.incrementMetric(
                "accumulationDetectionErrors"
            );
        }
    }

    /**
     * Update zone accumulation data
     */
    private updateZoneAccumulation(event: EnrichedTradeEvent): void {
        const zone = this.calculateZone(event.price);
        const side = this.getTradeSide(event);
        const now = Date.now();

        // Get or create zone data
        if (!this.zoneData.has(zone)) {
            const windowSize = Math.ceil(this.windowMs / 3000); // ~1 sample per 3 seconds
            this.zoneData.set(zone, {
                aggressiveVolume: new RollingWindow<number>(windowSize, true),
                timestamps: new RollingWindow<number>(windowSize, true),
                sides: new RollingWindow<"buy" | "sell">(windowSize, false),
                startTime: event.timestamp,
                lastUpdate: event.timestamp,
                tradeCount: 0,
                currentPassiveBid: 0,
                currentPassiveAsk: 0,
                accumulationStrength: 0,
                dominantSide: side,
            });
        }

        const zoneData = this.zoneData.get(zone)!;

        // Update aggressive volume tracking
        zoneData.aggressiveVolume.push(event.quantity);
        zoneData.timestamps.push(event.timestamp);
        zoneData.sides.push(side);
        zoneData.lastUpdate = event.timestamp;
        zoneData.tradeCount++;

        // Update passive volumes from enriched trade data
        zoneData.currentPassiveBid = event.zonePassiveBidVolume || 0;
        zoneData.currentPassiveAsk = event.zonePassiveAskVolume || 0;

        // Prune old data
        this.pruneZoneData(zoneData, now);
    }

    /**
     * Analyze zone for accumulation patterns
     */
    private analyzeZoneForAccumulation(
        zone: number,
        zoneData: ZoneAccumulationData,
        triggerTrade: AggressiveTrade
    ): void {
        const price = triggerTrade.price;
        const side = this.getTradeSide(triggerTrade);

        // Check cooldown (only confirm updates later)
        if (!this.checkCooldown(zone, side, false)) {
            return;
        }

        // Analyze accumulation conditions using object pooling
        const conditions = this.analyzeAccumulationConditions(zone, zoneData);
        const score = this.calculateAccumulationScore(conditions);

        // Store conditions reference for later cleanup
        const conditionsToRelease = conditions;

        // Check score threshold
        if (score < this.accumulationThreshold) {
            return;
        }

        // Calculate volumes for signal
        const volumes = this.calculateAccumulationVolumes(zone, zoneData);

        // Volume threshold check
        if (volumes.aggressive < this.minAggVolume) {
            this.logger.debug(`[AccumulationDetector] Insufficient volume`, {
                aggressive: volumes.aggressive,
                required: this.minAggVolume,
            });
            return;
        }

        // Spoofing check (includes layering detection)
        if (
            this.features.spoofingDetection &&
            (this.isSpoofed(price, side, triggerTrade.timestamp) ||
                this.detectLayeringAttack(price, side, triggerTrade.timestamp))
        ) {
            this.logger.debug(
                `[AccumulationDetector] Signal rejected - spoofing detected`
            );
            this.metricsCollector.incrementCounter(
                "accumulation.spoofing.rejected"
            );
            // Release pooled conditions object before early return
            SharedPools.getInstance().accumulationConditions.release(
                conditionsToRelease
            );
            return;
        }

        const signal: AccumulationResult = {
            duration: conditions.duration,
            zone,
            ratio: conditions.ratio,
            strength: conditions.strength,
            isAccumulating: conditions.isRecentlyActive,

            price,
            side: conditions.dominantSide,
            confidence: score,
            metadata: {
                accumulationScore: score,
                duration: conditions.duration,
                ratio: conditions.ratio,
                strength: conditions.strength,
                dominantSide: conditions.dominantSide,
                conditions,
                detectorVersion: "2.0",
            },
        };

        this.handleDetection(signal);

        this.metricsCollector.incrementCounter(
            "accumulation.signals.generated"
        );
        this.metricsCollector.recordHistogram("accumulation.score", score);
        this.metricsCollector.recordHistogram(
            "accumulation.duration",
            conditions.duration
        );

        // Release pooled conditions object back to pool
        SharedPools.getInstance().accumulationConditions.release(
            conditionsToRelease
        );
    }

    /**
     * Analyze accumulation conditions
     */
    private analyzeAccumulationConditions(
        zone: number,
        zoneData: ZoneAccumulationData
    ): AccumulationConditions {
        const now = Date.now();
        const duration = now - zoneData.startTime;
        const recentActivity = now - zoneData.lastUpdate;

        // Calculate aggressive volume
        const aggressiveVolume = zoneData.aggressiveVolume.sum();

        // Calculate relevant passive volume based on dominant side
        const sideCounts = this.countSides(zoneData.sides.toArray());
        const dominantSide = sideCounts.buy > sideCounts.sell ? "buy" : "sell";

        // For buy accumulation, we care about ask liquidity (what buyers hit)
        // For sell accumulation, we care about bid liquidity (what sellers hit)
        const relevantPassive =
            dominantSide === "buy"
                ? zoneData.currentPassiveAsk
                : zoneData.currentPassiveBid;

        const totalPassive =
            zoneData.currentPassiveBid + zoneData.currentPassiveAsk;
        const ratio =
            aggressiveVolume > 0 ? relevantPassive / aggressiveVolume : 0;

        // Calculate strength factors
        let strength = 0;
        if (this.features.strengthAnalysis) {
            strength = this.calculateStrength(
                ratio,
                duration,
                aggressiveVolume,
                totalPassive
            );
        }

        // Calculate velocity if enabled
        let velocity = 0;
        if (this.features.volumeVelocity) {
            velocity = this.calculateAccumulationVelocity(zoneData);
        }

        // Use pooled conditions object for optimal performance
        const sharedPools = SharedPools.getInstance();
        const conditions = sharedPools.accumulationConditions.acquire();

        // Populate pooled conditions object
        conditions.ratio = ratio;
        conditions.duration = duration;
        conditions.aggressiveVolume = aggressiveVolume;
        conditions.relevantPassive = relevantPassive;
        conditions.totalPassive = totalPassive;
        conditions.strength = strength;
        conditions.velocity = velocity;
        conditions.dominantSide = dominantSide;
        conditions.recentActivity = recentActivity;
        conditions.tradeCount = zoneData.tradeCount;
        conditions.meetsMinDuration = duration >= this.minDurationMs;
        conditions.meetsMinRatio = ratio >= this.minRatio;
        conditions.isRecentlyActive = recentActivity < this.minRecentActivityMs;

        return conditions;
    }

    /**
     * Calculate accumulation confidence score
     */
    private calculateAccumulationScore(
        conditions: AccumulationConditions
    ): number {
        let score = 0;

        // Factor 1: Ratio strength (passive vs aggressive)
        if (conditions.ratio >= this.minRatio * 2)
            score += 0.3; // Very strong
        else if (conditions.ratio >= this.minRatio * 1.5)
            score += 0.2; // Strong
        else if (conditions.ratio >= this.minRatio) score += 0.1; // Meets minimum

        // Factor 2: Duration weighting
        if (this.features.durationWeighting) {
            const durationFactor = Math.min(
                conditions.duration / this.minDurationMs,
                3
            ); // Cap at 3x
            if (durationFactor >= 2)
                score += 0.25; // Long accumulation
            else if (durationFactor >= 1.5)
                score += 0.15; // Medium duration
            else if (durationFactor >= 1) score += 0.1; // Minimum duration
        }

        // Factor 3: Strength analysis
        if (this.features.strengthAnalysis && conditions.strength > 0.7) {
            score += 0.2;
        } else if (conditions.strength > 0.5) {
            score += 0.1;
        }

        // Factor 4: Volume significance
        const volumeSignificance = Math.min(
            conditions.aggressiveVolume / this.minAggVolume,
            3
        );
        if (volumeSignificance >= 2) score += 0.1;
        else if (volumeSignificance >= 1.5) score += 0.05;

        // Factor 5: Velocity (if enabled)
        if (this.features.volumeVelocity && conditions.velocity > 0.6) {
            score += 0.05;
        }

        // Penalties
        if (!conditions.meetsMinDuration) score *= 0.5;
        if (!conditions.meetsMinRatio) score *= 0.3;
        if (!conditions.isRecentlyActive) score *= 0.2;

        return Math.max(0, Math.min(1, score));
    }

    /**
     * Calculate zone volumes for signal
     */
    private calculateAccumulationVolumes(
        zone: number,
        zoneData: ZoneAccumulationData
    ): {
        aggressive: number;
        passive: number;
        trades: SpotWebsocketStreams.AggTradeResponse[];
    } {
        const aggressive = zoneData.aggressiveVolume.sum();
        const passive = zoneData.currentPassiveBid + zoneData.currentPassiveAsk;

        // Create mock trades for compatibility (accumulation doesn't track individual trades)
        const trades: SpotWebsocketStreams.AggTradeResponse[] = [
            {
                e: "aggTrade",
                E: Date.now(),
                s: this.symbol,
                a: Date.now(), // Mock trade ID
                p: zone.toString(),
                q: aggressive.toString(),
                f: Date.now(),
                l: Date.now(),
                T: zoneData.lastUpdate,
                m: zoneData.dominantSide === "sell", // Mock maker flag
            },
        ];

        return { aggressive, passive, trades };
    }

    /**
     * Helper methods
     */
    private countSides(sides: ("buy" | "sell")[]): {
        buy: number;
        sell: number;
    } {
        return sides.reduce(
            (counts, side) => {
                counts[side]++;
                return counts;
            },
            { buy: 0, sell: 0 }
        );
    }

    private calculateStrength(
        ratio: number,
        duration: number,
        aggressiveVolume: number,
        passiveVolume: number
    ): number {
        // Composite strength calculation
        const ratioStrength = Math.min(ratio / (this.minRatio * 2), 1);
        const durationStrength = Math.min(
            duration / (this.minDurationMs * 2),
            1
        );
        const volumeBalance =
            Math.min(passiveVolume / Math.max(aggressiveVolume, 1), 3) / 3;

        return (
            ratioStrength * 0.4 + durationStrength * 0.3 + volumeBalance * 0.3
        );
    }

    private calculateAccumulationVelocity(
        zoneData: ZoneAccumulationData
    ): number {
        const timestamps = zoneData.timestamps.toArray();
        const volumes = zoneData.aggressiveVolume.toArray();

        if (timestamps.length < 3) return 0;

        // Calculate volume accumulation rate over time
        const timeSpan = timestamps[timestamps.length - 1] - timestamps[0];
        const totalVolume = volumes.reduce((sum, vol) => sum + vol, 0);

        if (timeSpan <= 0) return 0;

        const rate = (totalVolume / timeSpan) * 1000; // per second
        return Math.min(rate / 10, 1); // Normalize to 0-1
    }

    private pruneZoneData(zoneData: ZoneAccumulationData, now: number): void {
        const cutoff = now - this.windowMs;

        // Remove old samples
        while (zoneData.timestamps.count() > 0) {
            const oldestTime = zoneData.timestamps.toArray()[0];
            if (oldestTime >= cutoff) break;

            // Remove oldest sample from all arrays
            const timestamps = zoneData.timestamps.toArray().slice(1);
            const volumes = zoneData.aggressiveVolume.toArray().slice(1);
            const sides = zoneData.sides.toArray().slice(1);

            // Rebuild windows
            const capacity = Math.max(timestamps.length, 10);
            zoneData.timestamps = new RollingWindow<number>(capacity, true);
            zoneData.aggressiveVolume = new RollingWindow<number>(
                capacity,
                true
            );
            zoneData.sides = new RollingWindow<"buy" | "sell">(capacity, false);

            // Repopulate
            timestamps.forEach((t) => zoneData.timestamps.push(t));
            volumes.forEach((v) => zoneData.aggressiveVolume.push(v));
            sides.forEach((s) => zoneData.sides.push(s));

            // Update start time
            zoneData.startTime = timestamps.length > 0 ? timestamps[0] : now;
        }
    }

    private cleanupOldData(): void {
        const now = Date.now();
        const cutoff = now - this.windowMs * 2;
        let cleanedCount = 0;

        for (const [zone, data] of this.zoneData) {
            if (data.lastUpdate < cutoff) {
                this.zoneData.delete(zone);
                cleanedCount++;
            }
        }

        if (cleanedCount > 0) {
            this.logger.debug(
                `[AccumulationDetector] Cleaned ${cleanedCount} old zones`
            );
        }

        this.lastCleanup = now;
    }
}

// Type definitions
interface ZoneAccumulationData {
    aggressiveVolume: RollingWindow<number>;
    timestamps: RollingWindow<number>;
    sides: RollingWindow<"buy" | "sell">;
    startTime: number;
    lastUpdate: number;
    tradeCount: number;
    currentPassiveBid: number;
    currentPassiveAsk: number;
    accumulationStrength: number;
    dominantSide: "buy" | "sell";
}

interface AccumulationConditions {
    ratio: number; // passive/aggressive ratio
    duration: number; // accumulation duration
    aggressiveVolume: number; // total aggressive volume
    relevantPassive: number; // passive volume on relevant side
    totalPassive: number; // total passive volume
    strength: number; // composite strength score
    velocity: number; // accumulation velocity
    dominantSide: "buy" | "sell"; // which side is accumulating
    recentActivity: number; // ms since last activity
    tradeCount: number; // number of trades
    meetsMinDuration: boolean; // meets minimum duration
    meetsMinRatio: boolean; // meets minimum ratio
    isRecentlyActive: boolean; // recently active
}
