// src/indicators/absorptionDetector.ts
import { SpotWebsocketStreams } from "@binance/spot";
import { BaseDetector, ZoneSample } from "./base/baseDetector.js";
import { RollingWindow } from "../utils/rollingWindow.js";
import { Logger } from "../infrastructure/logger.js";
import { MetricsCollector } from "../infrastructure/metricsCollector.js";
import { ISignalLogger } from "../services/signalLogger.js";
import type {
    IAbsorptionDetector,
    DetectorCallback,
    BaseDetectorSettings,
    AbsorptionFeatures,
} from "./interfaces/detectorInterfaces.js";
import { EnrichedTradeEvent, AggressiveTrade } from "../types/marketEvents.js";
import { DetectorUtils } from "./base/detectorUtils.js";
import { AbsorptionSignalData, SignalType } from "../types/signalTypes.js";

export interface AbsorptionSettings extends BaseDetectorSettings {
    features?: AbsorptionFeatures;
    // Absorption-specific settings
    absorptionThreshold?: number; // Minimum absorption score (0-1)
    minPassiveMultiplier?: number; // Min passive/aggressive ratio for absorption
    icebergDetectionSensitivity?: number; // Sensitivity for iceberg detection (0-1)
    maxAbsorptionRatio?: number; // Max aggressive/passive ratio for absorption
}

/**
 * Comprehensive absorption analysis conditions
 */
interface AbsorptionConditions {
    absorptionRatio: number; // aggressive/passive ratio
    passiveStrength: number; // current/avg passive strength
    hasRefill: boolean; // detected passive refills
    icebergSignal: number; // iceberg pattern strength (0-1)
    liquidityGradient: number; // depth gradient around zone (0-1)
    absorptionVelocity: number; // rate of absorption events (0-1)
    currentPassive: number; // current passive volume
    avgPassive: number; // average passive volume
    maxPassive: number; // maximum observed passive
    minPassive: number; // minimum observed passive
    aggressiveVolume: number; // total aggressive volume
    imbalance: number; // bid/ask imbalance
    sampleCount: number; // number of data samples
    dominantSide: "bid" | "ask" | "neutral"; // which side dominates
}

/**
 * Absorption event tracking
 */
interface AbsorptionEvent {
    timestamp: number;
    price: number;
    side: "buy" | "sell";
    volume: number;
}

/**
 * Liquidity layer for gradient analysis
 */
interface LiquidityLayer {
    timestamp: number;
    price: number;
    bidVolume: number;
    askVolume: number;
}

/**
 * Absorption detector - identifies when aggressive volume is absorbed by passive liquidity
 */
export class AbsorptionDetector
    extends BaseDetector
    implements IAbsorptionDetector
{
    protected readonly detectorType = "absorption" as const;
    protected readonly features: AbsorptionFeatures;

    // Absorption-specific configuration
    private readonly absorptionThreshold: number;
    private readonly minPassiveMultiplier: number;
    private readonly icebergDetectionSensitivity: number;
    private readonly maxAbsorptionRatio: number;

    // Advanced tracking
    private readonly absorptionHistory = new Map<number, AbsorptionEvent[]>();
    private readonly liquidityLayers = new Map<number, LiquidityLayer[]>();

    constructor(
        id: string,
        callback: DetectorCallback,
        settings: AbsorptionSettings = {},
        logger: Logger,
        metricsCollector: MetricsCollector,
        signalLogger?: ISignalLogger
    ) {
        super(id, callback, settings, logger, metricsCollector, signalLogger);

        // Initialize absorption-specific settings
        this.absorptionThreshold = settings.absorptionThreshold ?? 0.7;
        this.minPassiveMultiplier = settings.minPassiveMultiplier ?? 1.5;
        this.icebergDetectionSensitivity =
            settings.icebergDetectionSensitivity ?? 0.8;
        this.maxAbsorptionRatio = settings.maxAbsorptionRatio ?? 0.5;

        // Merge absorption-specific features
        this.features = {
            icebergDetection: true,
            liquidityGradient: true,
            absorptionVelocity: false,
            layeredAbsorption: false,
            ...settings.features,
        };

        // Setup periodic cleanup for absorption tracking
        setInterval(() => this.cleanupAbsorptionHistory(), this.windowMs);
    }

    protected getSignalType(): SignalType {
        return "absorption";
    }

    public onEnrichedTrade(event: EnrichedTradeEvent): void {
        const zone = this.calculateZone(event.price);

        // Get or create zone-specific history
        if (!this.zonePassiveHistory.has(zone)) {
            this.zonePassiveHistory.set(
                zone,
                new RollingWindow<ZoneSample>(100, false)
            );
        }

        // Track zone passive volumes
        const zoneHistory = this.zonePassiveHistory.get(zone)!;
        const last = zoneHistory.count() ? zoneHistory.toArray().at(-1)! : null;
        const snap = {
            bid: event.zonePassiveBidVolume,
            ask: event.zonePassiveAskVolume,
            total: event.zonePassiveBidVolume + event.zonePassiveAskVolume,
            timestamp: event.timestamp,
        };

        if (!last || last.bid !== snap.bid || last.ask !== snap.ask) {
            zoneHistory.push(snap); // passive actually moved
        }

        // Track agressive trades
        if (this.lastTradeId !== event.tradeId) {
            this.lastTradeId = event.tradeId;
            this.addTrade(event);
        }
    }

    /**
     * Absorption-specific trade handling (called by base class)
     */
    protected onEnrichedTradeSpecific(event: EnrichedTradeEvent): void {
        // Track absorption events for advanced analysis
        if (this.features.absorptionVelocity) {
            this.trackAbsorptionEvent(event);
        }

        // Update liquidity layers for gradient analysis
        if (this.features.liquidityGradient) {
            this.updateLiquidityLayers(event);
        }
        void event;
    }

    /**
     * Check for absorption signal
     */
    protected checkForSignal(triggerTrade: AggressiveTrade): void {
        const now = Date.now();
        const zoneTicks = this.getEffectiveZoneTicks();

        try {
            for (const [zone, bucket] of this.zoneAgg) {
                // prune old trades
                bucket.trades = bucket.trades.filter(
                    (t) => now - t.timestamp <= this.windowMs
                );
                bucket.vol = bucket.trades.reduce((s, t) => s + t.quantity, 0);

                if (bucket.trades.length === 0) continue;
                this.analyzeZoneForAbsorption(
                    zone,
                    bucket.trades,
                    triggerTrade,
                    zoneTicks
                );

                // Record detection metrics
                this.metricsCollector.incrementMetric(
                    "absorptionDetectionAttempts"
                );
                this.metricsCollector.updateMetric(
                    "absorptionZonesActive",
                    this.zoneAgg.size
                );
            }
        } catch (error) {
            this.handleError(
                error as Error,
                "AbsorptionDetector.checkForSignal"
            );
            this.metricsCollector.incrementMetric("absorptionDetectionErrors");
        }
    }

    /**
     * Check absorption conditions with improved logic
     */
    private checkAbsorptionConditions(
        price: number,
        side: "buy" | "sell",
        zone: number
    ): boolean {
        // For buy absorption: aggressive buys hit the ASK (passive sellers)
        // For sell absorption: aggressive sells hit the BID (passive buyers)
        const zoneHistory = this.zonePassiveHistory.get(zone);
        if (!zoneHistory) return false;

        // Get the RELEVANT passive side
        const relevantPassive = zoneHistory
            .toArray()
            .map((snapshot) => (side === "buy" ? snapshot.ask : snapshot.bid));

        if (relevantPassive.length === 0) return false;

        // Calculate rolling statistics
        const currentPassive = relevantPassive[relevantPassive.length - 1] || 0;
        const avgPassive = DetectorUtils.calculateMean(relevantPassive);
        const minPassive = Math.min(...relevantPassive);

        // Get recent aggressive volume
        const recentAggressive = this.getAggressiveVolumeAtPrice(price, 5000);

        // Absorption checks:
        // 1. Current passive exceeds aggressive (classic absorption)
        const classicAbsorption = currentPassive > recentAggressive * 0.8;

        // 2. Passive maintained despite hits (sponge effect)
        const maintainedPassive =
            minPassive > avgPassive * 0.7 && recentAggressive > avgPassive;

        // 3. Passive growing (iceberg/refill)
        const growingPassive = currentPassive > avgPassive * 1.2;

        return classicAbsorption || maintainedPassive || growingPassive;
    }

    /**
     * Advanced passive refill detection
     */
    private detectPassiveRefill(
        price: number,
        side: "buy" | "sell",
        zone: number,
        snapshots: ZoneSample[]
    ): boolean {
        if (snapshots.length < 5) return false;

        const relevantSide = side === "buy" ? "ask" : "bid";
        const recent = snapshots.slice(-5);

        let refillEvents = 0;
        for (let i = 1; i < recent.length; i++) {
            const current: number = recent[i][relevantSide];
            const previous: number = recent[i - 1][relevantSide];

            if (current > previous * 1.1) {
                // 10% increase
                refillEvents++;
            }
        }

        return refillEvents >= 2;
    }

    /**
     * Calculate liquidity gradient around zone
     */
    private calculateLiquidityGradient(
        zone: number,
        price: number,
        side: "buy" | "sell"
    ): number {
        // Simplified implementation - would be more sophisticated in production
        const tickSize = Math.pow(10, -this.pricePrecision);
        const nearbyLevels = [];

        for (let offset = -5; offset <= 5; offset++) {
            const testPrice = +(price + offset * tickSize).toFixed(
                this.pricePrecision
            );
            const level = this.depth.get(testPrice);
            if (level) {
                const relevantVolume = side === "buy" ? level.ask : level.bid;
                nearbyLevels.push(relevantVolume);
            }
        }

        if (nearbyLevels.length < 3) return 0;

        // Calculate gradient strength (higher = more liquidity depth)
        const avgVolume = DetectorUtils.calculateMean(nearbyLevels);
        const centerIndex = Math.floor(nearbyLevels.length / 2);
        const centerVolume = nearbyLevels[centerIndex] || 0;

        return avgVolume > 0 ? Math.min(1, centerVolume / avgVolume) : 0;
    }

    /**
     * Calculate absorption velocity
     */
    private calculateAbsorptionVelocity(
        zone: number,
        side: "buy" | "sell"
    ): number {
        const events = this.absorptionHistory.get(zone) || [];
        if (events.length < 2) return 0;

        const recentEvents = events.filter(
            (e) => Date.now() - e.timestamp <= 30000 && e.side === side
        );

        return Math.min(1, recentEvents.length / 10); // Normalize to 0-1
    }

    /**
     * Track absorption events for velocity analysis
     */
    private trackAbsorptionEvent(event: EnrichedTradeEvent): void {
        const zone = this.calculateZone(event.price);
        const side = this.getTradeSide(event);

        if (!this.absorptionHistory.has(zone)) {
            this.absorptionHistory.set(zone, []);
        }

        const events = this.absorptionHistory.get(zone)!;
        events.push({
            timestamp: event.timestamp,
            price: event.price,
            side,
            volume: event.quantity,
        });

        // Keep only recent events
        const cutoff = Date.now() - this.windowMs * 2;
        this.absorptionHistory.set(
            zone,
            events.filter((e) => e.timestamp > cutoff)
        );
    }

    /**
     * Update liquidity layers for gradient analysis
     */
    private updateLiquidityLayers(event: EnrichedTradeEvent): void {
        const zone = this.calculateZone(event.price);

        if (!this.liquidityLayers.has(zone)) {
            this.liquidityLayers.set(zone, []);
        }

        const layers = this.liquidityLayers.get(zone)!;
        layers.push({
            timestamp: event.timestamp,
            price: event.price,
            bidVolume: event.zonePassiveBidVolume,
            askVolume: event.zonePassiveAskVolume,
        });

        // Keep only recent layers
        const cutoff = Date.now() - this.windowMs;
        this.liquidityLayers.set(
            zone,
            layers.filter((l) => l.timestamp > cutoff)
        );
    }

    /**
     * Cleanup absorption tracking data
     */
    private cleanupAbsorptionHistory(): void {
        const cutoff = Date.now() - this.windowMs * 2;
        let cleanedZones = 0;

        for (const [zone, events] of this.absorptionHistory) {
            const filtered = events.filter((e) => e.timestamp > cutoff);
            if (filtered.length === 0) {
                this.absorptionHistory.delete(zone);
                cleanedZones++;
            } else {
                this.absorptionHistory.set(zone, filtered);
            }
        }

        for (const [zone, layers] of this.liquidityLayers) {
            const filtered = layers.filter((l) => l.timestamp > cutoff);
            if (filtered.length === 0) {
                this.liquidityLayers.delete(zone);
            } else {
                this.liquidityLayers.set(zone, filtered);
            }
        }

        if (cleanedZones > 0) {
            this.logger.debug(
                `[AbsorptionDetector] Cleaned ${cleanedZones} absorption zones`
            );
        }
    }

    /**
     * Get default conditions for error cases
     */
    private getDefaultConditions(): AbsorptionConditions {
        return {
            absorptionRatio: 1,
            passiveStrength: 0,
            hasRefill: false,
            icebergSignal: 0,
            liquidityGradient: 0,
            absorptionVelocity: 0,
            currentPassive: 0,
            avgPassive: 0,
            maxPassive: 0,
            minPassive: 0,
            aggressiveVolume: 0,
            imbalance: 0,
            sampleCount: 0,
            dominantSide: "neutral",
        };
    }

    /**
     * Analyze a specific zone for absorption patterns
     */
    private analyzeZoneForAbsorption(
        zone: number,
        tradesAtZone: AggressiveTrade[],
        triggerTrade: AggressiveTrade,
        zoneTicks: number
    ): void {
        const latestTrade = tradesAtZone[tradesAtZone.length - 1];
        const price = +latestTrade.price.toFixed(this.pricePrecision);
        const side = this.getTradeSide(latestTrade);

        // Get book data (with fallback to zone history)
        let bookLevel = this.depth.get(price);
        if (!bookLevel || (bookLevel.bid === 0 && bookLevel.ask === 0)) {
            const zoneHistory = this.zonePassiveHistory.get(zone);
            const lastSnapshot = zoneHistory?.toArray().at(-1);
            if (lastSnapshot) {
                bookLevel = { bid: lastSnapshot.bid, ask: lastSnapshot.ask };
            }
        }
        if (!bookLevel) {
            this.logger.debug(
                `[AbsorptionDetector] No book data for zone ${zone}`
            );
            return;
        }

        // Check cooldown
        if (!this.checkCooldown(zone, side)) {
            return;
        }

        // Analyze absorption conditions
        const conditions = this.analyzeAbsorptionConditions(
            price,
            side,
            zone,
            tradesAtZone
        );
        const score = this.calculateAbsorptionScore(conditions);

        // Check score threshold
        if (score < this.absorptionThreshold) {
            return;
        }

        // Calculate volumes
        const volumes = this.calculateZoneVolumes(
            zone,
            tradesAtZone,
            zoneTicks
        );

        // Volume threshold check
        if (volumes.aggressive < this.minAggVolume) {
            this.logger.debug(`[AbsorptionDetector] Insufficient volume`, {
                aggressive: volumes.aggressive,
                required: this.minAggVolume,
            });
            return;
        }

        // Absorption ratio check (aggressive shouldn't overwhelm passive)
        const absorptionRatio =
            volumes.passive > 0 ? volumes.aggressive / volumes.passive : 1;
        if (absorptionRatio > this.maxAbsorptionRatio) {
            this.logger.debug(
                `[AbsorptionDetector] Absorption ratio too high`,
                {
                    ratio: absorptionRatio,
                    maxAllowed: this.maxAbsorptionRatio,
                }
            );
            return;
        }

        // Spoofing check
        if (
            this.features.spoofingDetection &&
            this.isSpoofed(price, side, triggerTrade.timestamp)
        ) {
            this.logger.debug(
                `[AbsorptionDetector] Signal rejected - spoofing detected`
            );
            this.metricsCollector.incrementMetric("absorptionSpoofingRejected");
            return;
        }

        const signal: AbsorptionSignalData = {
            zone,
            price,
            side,
            aggressive: volumes.aggressive,
            passive: volumes.passive,
            refilled: conditions.hasRefill,
            confidence: score,
            metrics: {
                absorptionScore: score,
                absorptionRatio,
                icebergDetected: conditions.icebergSignal,
                liquidityGradient: conditions.liquidityGradient,
                conditions,
                detectorVersion: "2.0",
            },
        };

        this.handleDetection(signal);

        this.metricsCollector.updateMetric(
            `detector_${this.detectorType}Aggressive_volume`,
            signal.aggressive
        );
        this.metricsCollector.updateMetric(
            `detector_${this.detectorType}Passive_volume`,
            signal.passive
        );
        this.metricsCollector.incrementMetric("absorptionSignalsGenerated");
        this.metricsCollector.recordHistogram("absorption.score", score);
        this.metricsCollector.recordHistogram(
            "absorption.ratio",
            absorptionRatio
        );
    }

    private calculateAbsorptionMetrics(zone: number): {
        absorptionRatio: number;
        passiveStrength: number;
        refillRate: number;
    } {
        const now = Date.now();
        const windowMs = 30000; // 30 seconds

        // Get zone-specific passive history
        const zoneHistory = this.zonePassiveHistory.get(zone);
        if (!zoneHistory)
            return { absorptionRatio: 0, passiveStrength: 0, refillRate: 0 };

        // Calculate total aggressive in zone
        const aggressiveInZone = this.trades
            .filter((t) => {
                const tradeZone = this.calculateZone(t.price);
                return tradeZone === zone && now - t.timestamp <= windowMs;
            })
            .reduce((sum, t) => sum + t.quantity, 0);

        // Get passive statistics
        const passiveSnapshots = zoneHistory
            .toArray()
            .filter((s) => now - s.timestamp <= windowMs);

        if (passiveSnapshots.length === 0 || aggressiveInZone === 0) {
            return { absorptionRatio: 0, passiveStrength: 0, refillRate: 0 };
        }

        const avgPassiveTotal = DetectorUtils.calculateMean(
            passiveSnapshots.map((s) => s.total)
        );
        const currentPassive =
            passiveSnapshots[passiveSnapshots.length - 1].total;

        // Absorption ratio: how much passive vs aggressive
        const absorptionRatio =
            aggressiveInZone === 0
                ? 1 // neutral
                : aggressiveInZone / avgPassiveTotal;

        // Passive strength: how well passive maintained
        const passiveStrength = currentPassive / avgPassiveTotal;

        // Refill rate: how often passive increases
        let increases = 0;
        for (let i = 1; i < passiveSnapshots.length; i++) {
            if (passiveSnapshots[i].total > passiveSnapshots[i - 1].total) {
                increases++;
            }
        }
        const refillRate = increases / (passiveSnapshots.length - 1);

        return { absorptionRatio, passiveStrength, refillRate };
    }

    /**
     * Comprehensive absorption condition analysis
     */
    private analyzeAbsorptionConditions(
        price: number,
        side: "buy" | "sell",
        zone: number,
        tradesAtZone: AggressiveTrade[]
    ): AbsorptionConditions {
        try {
            const zoneHistory = this.zonePassiveHistory.get(zone);
            if (!zoneHistory || zoneHistory.count() === 0) {
                return this.getDefaultConditions();
            }

            const now = Date.now();
            const snapshots = zoneHistory
                .toArray()
                .filter((s) => now - s.timestamp <= this.windowMs);

            if (snapshots.length === 0) {
                return this.getDefaultConditions();
            }

            // Basic metrics
            const relevantPassive = snapshots.map((s) =>
                side === "buy" ? s.ask : s.bid
            );
            const currentPassive =
                relevantPassive[relevantPassive.length - 1] || 0;
            const avgPassive = DetectorUtils.calculateMean(relevantPassive);
            const maxPassive = Math.max(...relevantPassive);
            const minPassive = Math.min(...relevantPassive);

            const aggressiveVolume = tradesAtZone.reduce(
                (sum, t) => sum + t.quantity,
                0
            );
            const absorptionRatio =
                avgPassive > 0 ? aggressiveVolume / avgPassive : 1;

            // Advanced analysis
            const passiveStrength =
                avgPassive > 0 ? currentPassive / avgPassive : 0;
            const hasRefill = this.detectPassiveRefill(
                price,
                side,
                zone,
                snapshots
            );
            const icebergSignal = this.features.icebergDetection
                ? this.detectIcebergPattern(zone, snapshots, side)
                : 0;
            const liquidityGradient = this.features.liquidityGradient
                ? this.calculateLiquidityGradient(zone, price, side)
                : 0;

            // Velocity analysis
            let absorptionVelocity = 0;
            if (this.features.absorptionVelocity) {
                absorptionVelocity = this.calculateAbsorptionVelocity(
                    zone,
                    side
                );
            }

            // Imbalance analysis
            const imbalance = this.checkPassiveImbalance(zone);

            return {
                absorptionRatio,
                passiveStrength,
                hasRefill,
                icebergSignal,
                liquidityGradient,
                absorptionVelocity,
                currentPassive,
                avgPassive,
                maxPassive,
                minPassive,
                aggressiveVolume,
                imbalance: Math.abs(imbalance.imbalance),
                sampleCount: snapshots.length,
                dominantSide: imbalance.dominantSide,
            };
        } catch (error) {
            this.handleError(
                error as Error,
                "AbsorptionDetector.analyzeAbsorptionConditions"
            );
            return this.getDefaultConditions();
        }
    }

    /**
     * Calculate sophisticated absorption score
     */
    private calculateAbsorptionScore(conditions: AbsorptionConditions): number {
        let score = 0;

        // Factor 1: Absorption ratio (lower = better absorption)
        if (conditions.absorptionRatio < 0.1)
            score += 0.25; // 10:1 passive advantage
        else if (conditions.absorptionRatio < 0.2)
            score += 0.2; // 5:1 advantage
        else if (conditions.absorptionRatio < 0.5) score += 0.15; // 2:1 advantage

        // Factor 2: Passive strength (maintained/growing liquidity)
        if (conditions.passiveStrength > 1.3)
            score += 0.2; // Growing
        else if (conditions.passiveStrength > 1.0)
            score += 0.15; // Maintained
        else if (conditions.passiveStrength > 0.8)
            score += 0.1; // Slightly depleted
        else score -= 0.05; // Significantly depleted (not absorption)

        // Factor 3: Refill behavior (iceberg/hidden orders)
        if (conditions.hasRefill) score += 0.2;
        else if (conditions.icebergSignal > 0.7) score += 0.15;
        else if (conditions.icebergSignal > 0.4) score += 0.1;

        // Factor 4: Liquidity gradient (deeper absorption zones)
        if (this.features.liquidityGradient) {
            if (conditions.liquidityGradient > 0.7) score += 0.1;
            else if (conditions.liquidityGradient > 0.4) score += 0.05;
        }

        // Factor 5: Absorption velocity (sustained absorption)
        if (
            this.features.absorptionVelocity &&
            conditions.absorptionVelocity > 0.5
        ) {
            score += 0.05;
        }

        // Factor 6: Volume significance
        const volumeSignificance = Math.min(
            1,
            conditions.aggressiveVolume / this.minAggVolume
        );
        score += volumeSignificance * 0.05;

        // Penalty for insufficient data
        if (conditions.sampleCount < 5) {
            score *= 0.8;
        }

        // Penalty for extreme imbalance (might indicate manipulation)
        if (conditions.imbalance > 0.9) {
            score *= 0.9;
        }

        return Math.max(0, Math.min(1, score));
    }

    /**
     * Detect iceberg order patterns
     */
    private detectIcebergPattern(
        zone: number,
        snapshots: ZoneSample[],
        side: "buy" | "sell"
    ): number {
        if (snapshots.length < 10) return 0;

        const relevantSide = side === "buy" ? "ask" : "bid";
        let refillCount = 0;
        let significantRefills = 0;
        let previousLevel = snapshots[0][relevantSide];

        for (let i = 1; i < snapshots.length; i++) {
            const currentLevel = snapshots[i][relevantSide];
            const prevLevel = snapshots[i - 1][relevantSide];

            // Detect refill after depletion
            if (
                prevLevel < previousLevel * 0.7 && // Depleted
                currentLevel > previousLevel * 0.9
            ) {
                // Refilled
                refillCount++;

                if (currentLevel > previousLevel) {
                    significantRefills++; // Even stronger than before
                }
            }

            previousLevel = Math.max(previousLevel, currentLevel);
        }

        // Calculate iceberg confidence
        const refillRate = refillCount / (snapshots.length / 10);
        const strengthRate = significantRefills / Math.max(1, refillCount);

        return Math.min(1, refillRate * 0.7 + strengthRate * 0.3);
    }

    /**
     * Calculate zone volumes with common logic
     */
    protected calculateZoneVolumes(
        zone: number,
        tradesAtZone: AggressiveTrade[],
        zoneTicks: number,
        useMultiZone: boolean = this.features.multiZone ?? false
    ): {
        aggressive: number;
        passive: number;
        trades: SpotWebsocketStreams.AggTradeResponse[];
    } {
        if (useMultiZone) {
            return this.sumVolumesInBand(zone, Math.floor(zoneTicks / 2));
        }

        const now = Date.now();
        const aggressive = tradesAtZone.reduce((sum, t) => sum + t.quantity, 0);
        const trades = tradesAtZone.map((t) => t.originalTrade);

        // Get passive volume from zone history
        const zoneHistory = this.zonePassiveHistory.get(zone);
        const passiveSnapshots = zoneHistory
            ? zoneHistory
                  .toArray()
                  .filter((s) => now - s.timestamp <= this.windowMs)
            : [];

        const passive =
            passiveSnapshots.length > 0
                ? DetectorUtils.calculateMean(
                      passiveSnapshots.map((s) => s.total)
                  )
                : 0;

        return { aggressive, passive, trades };
    }
}
