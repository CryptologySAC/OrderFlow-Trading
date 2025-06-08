// src/indicators/absorptionDetector.ts
import { SpotWebsocketStreams } from "@binance/spot";
import { BaseDetector, ZoneSample } from "./base/baseDetector.js";
import { RollingWindow } from "../utils/rollingWindow.js";
import { Logger } from "../infrastructure/logger.js";
import { MetricsCollector } from "../infrastructure/metricsCollector.js";
import { ISignalLogger } from "../services/signalLogger.js";
import { SpoofingDetector } from "../services/spoofingDetector.js";

import type {
    IAbsorptionDetector,
    DetectorCallback,
    BaseDetectorSettings,
    AbsorptionFeatures,
    MicrostructureInsights,
} from "./interfaces/detectorInterfaces.js";
import {
    EnrichedTradeEvent,
    HybridTradeEvent,
    AggressiveTrade,
} from "../types/marketEvents.js";
import { DetectorUtils } from "./base/detectorUtils.js";
import { AbsorptionSignalData, SignalType } from "../types/signalTypes.js";
import { SharedPools } from "../utils/objectPool.js";

export interface AbsorptionSettings extends BaseDetectorSettings {
    features?: AbsorptionFeatures;
    // Absorption-specific settings
    absorptionThreshold?: number; // Minimum absorption score (0-1)
    minPassiveMultiplier?: number; // Min passive/aggressive ratio for absorption
    icebergDetectionSensitivity?: number; // Sensitivity for iceberg detection (0-1)
    maxAbsorptionRatio?: number; // Max aggressive/passive ratio for absorption
}

/**
 * Comprehensive absorption analysis conditions with microstructure integration
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
    // ✅ NEW: Integrated microstructure insights
    microstructure?: MicrostructureInsights;
}

/**
 * Enhanced absorption event tracking with microstructure data
 */
interface AbsorptionEvent {
    timestamp: number;
    price: number;
    side: "buy" | "sell";
    volume: number;
    // ✅ NEW: Optional microstructure insights
    microstructure?: {
        fragmentationScore: number;
        executionEfficiency: number;
        suspectedAlgoType: string;
        toxicityScore: number;
        timingPattern: string;
        coordinationIndicators: number;
    };
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

    public onEnrichedTrade(event: EnrichedTradeEvent | HybridTradeEvent): void {
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

        // Enhanced microstructure analysis for HybridTradeEvent
        if (
            "hasIndividualData" in event &&
            event.hasIndividualData &&
            event.microstructure
        ) {
            this.analyzeMicrostructureForAbsorption(event);
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
            // Record detection metrics once per trade
            this.metricsCollector.incrementMetric(
                "absorptionDetectionAttempts"
            );
            this.metricsCollector.updateMetric(
                "absorptionZonesActive",
                this.zoneAgg.size
            );

            for (const [zone, bucket] of this.zoneAgg) {
                // prune old trades
                bucket.trades = bucket.trades.filter(
                    (t) => now - t.timestamp < this.windowMs
                );
                bucket.vol = bucket.trades.reduce((s, t) => s + t.quantity, 0);

                if (bucket.trades.length === 0) continue;
                this.analyzeZoneForAbsorption(
                    zone,
                    bucket.trades,
                    triggerTrade,
                    zoneTicks
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
     *
     * 🔒 PRODUCTION METHOD - PERFORMANCE CRITICAL
     * This method has been optimized for production use.
     * Any changes require performance impact analysis.
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
        // ✅ VERIFIED LOGIC: Aggressive flow hits opposite-side passive liquidity
        // - Buy absorption (aggressive buys): Tests ASK liquidity depletion/refill
        // - Sell absorption (aggressive sells): Tests BID liquidity depletion/refill
        // Validated against docs/BuyerIsMaker-field.md and unit tests
        const relevantPassive = zoneHistory.toArray().map((snapshot) => {
            // Aggressive buys (side="buy") consume ASK liquidity
            // Aggressive sells (side="sell") consume BID liquidity
            return side === "buy" ? snapshot.ask : snapshot.bid;
        });

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
            (e) => Date.now() - e.timestamp < 30000 && e.side === side
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

        // Check cooldown (only confirm updates later)
        if (!this.checkCooldown(zone, side, false)) {
            return;
        }

        // Analyze absorption conditions using object pooling
        const conditions = this.analyzeAbsorptionConditions(
            price,
            side,
            zone,
            tradesAtZone
        );
        const score = this.calculateAbsorptionScore(conditions);

        // Store conditions reference for later cleanup
        const conditionsToRelease = conditions;

        // Check score threshold
        if (score < this.absorptionThreshold) {
            // Release pooled conditions object before early return
            SharedPools.getInstance().absorptionConditions.release(
                conditionsToRelease
            );
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
            // Release pooled conditions object before early return
            SharedPools.getInstance().absorptionConditions.release(
                conditionsToRelease
            );
            return;
        }

        // Absorption ratio check (aggressive shouldn't overwhelm passive)
        const absorptionRatio =
            volumes.passive > 0 ? volumes.aggressive / volumes.passive : 1;
        if (absorptionRatio > this.maxAbsorptionRatio) {
            // Release pooled conditions object before early return
            SharedPools.getInstance().absorptionConditions.release(
                conditionsToRelease
            );
            return;
        }

        // Enhanced absorption spoofing detection
        if (
            this.detectAbsorptionSpoofing(
                price,
                side,
                volumes.aggressive,
                triggerTrade.timestamp
            )
        ) {
            this.logger.debug(
                `[AbsorptionDetector] Signal rejected - absorption spoofing detected`
            );
            this.metricsCollector.incrementMetric("absorptionSpoofingRejected");
            // Release pooled conditions object before early return
            SharedPools.getInstance().absorptionConditions.release(
                conditionsToRelease
            );
            return;
        }

        // General spoofing check (includes layering detection)
        if (
            this.features.spoofingDetection &&
            (this.isSpoofed(price, side, triggerTrade.timestamp) ||
                this.detectLayeringAttack(price, side, triggerTrade.timestamp))
        ) {
            this.logger.debug(
                `[AbsorptionDetector] Signal rejected - spoofing detected`
            );
            this.metricsCollector.incrementMetric("absorptionSpoofingRejected");
            // Release pooled conditions object before early return
            SharedPools.getInstance().absorptionConditions.release(
                conditionsToRelease
            );
            return;
        }

        // ✅ ENHANCED: Apply microstructure confidence and urgency adjustments
        let finalConfidence = score;
        let signalUrgency = "medium" as "low" | "medium" | "high";

        if (conditions.microstructure) {
            finalConfidence *= conditions.microstructure.confidenceBoost;

            // Adjust urgency based on microstructure insights
            if (conditions.microstructure.urgencyFactor > 1.3) {
                signalUrgency = "high";
            } else if (conditions.microstructure.urgencyFactor < 0.8) {
                signalUrgency = "low";
            }
        }

        const signal: AbsorptionSignalData = {
            zone,
            price,
            side,
            aggressive: volumes.aggressive,
            passive: volumes.passive,
            refilled: conditions.hasRefill,
            confidence: Math.min(1, finalConfidence), // Cap at 1.0
            metrics: {
                absorptionScore: score,
                absorptionRatio,
                icebergDetected: conditions.icebergSignal,
                liquidityGradient: conditions.liquidityGradient,
                conditions,
                detectorVersion: "3.0-microstructure", // Updated version
                // ✅ NEW: Include microstructure insights in signal
                microstructureInsights: conditions.microstructure
                    ? {
                          sustainabilityScore:
                              conditions.microstructure.sustainabilityScore,
                          toxicityScore:
                              conditions.microstructure.toxicityScore,
                          algorithmType:
                              conditions.microstructure.suspectedAlgoType,
                          timingPattern:
                              conditions.microstructure.timingPattern,
                          executionQuality:
                              conditions.microstructure.executionEfficiency,
                          urgency: signalUrgency,
                          riskLevel:
                              conditions.microstructure.riskAdjustment < -0.1
                                  ? "high"
                                  : conditions.microstructure.riskAdjustment >
                                      0.05
                                    ? "low"
                                    : "medium",
                      }
                    : undefined,
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

        // Release pooled conditions object back to pool
        SharedPools.getInstance().absorptionConditions.release(
            conditionsToRelease
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
                return tradeZone === zone && now - t.timestamp < windowMs;
            })
            .reduce((sum, t) => sum + t.quantity, 0);

        // Get passive statistics
        const passiveSnapshots = zoneHistory
            .toArray()
            .filter((s) => now - s.timestamp < windowMs);

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
                : DetectorUtils.safeDivide(
                      aggressiveInZone,
                      avgPassiveTotal,
                      0
                  );

        // Passive strength: how well passive maintained
        const passiveStrength = DetectorUtils.safeDivide(
            currentPassive,
            avgPassiveTotal,
            0
        );

        // Refill rate: how often passive increases
        let increases = 0;
        for (let i = 1; i < passiveSnapshots.length; i++) {
            if (passiveSnapshots[i].total > passiveSnapshots[i - 1].total) {
                increases++;
            }
        }
        const refillRate =
            passiveSnapshots.length > 1
                ? increases / (passiveSnapshots.length - 1)
                : 0;

        return { absorptionRatio, passiveStrength, refillRate };
    }

    /**
     * Comprehensive absorption condition analysis
     * Uses object pooling for optimal performance in hot path
     */
    private analyzeAbsorptionConditions(
        price: number,
        side: "buy" | "sell",
        zone: number,
        tradesAtZone: AggressiveTrade[]
    ): AbsorptionConditions {
        const sharedPools = SharedPools.getInstance();
        const conditions = sharedPools.absorptionConditions.acquire();

        try {
            const zoneHistory = this.zonePassiveHistory.get(zone);
            if (!zoneHistory || zoneHistory.count() === 0) {
                // Copy default values to pooled object
                const defaultConditions = this.getDefaultConditions();
                Object.assign(conditions, defaultConditions);
                return conditions;
            }

            const now = Date.now();
            const snapshots = zoneHistory
                .toArray()
                .filter((s) => now - s.timestamp < this.windowMs);

            if (snapshots.length === 0) {
                // Copy default values to pooled object
                const defaultConditions = this.getDefaultConditions();
                Object.assign(conditions, defaultConditions);
                return conditions;
            }

            // Use pooled array for relevant passive values calculation
            const relevantPassiveValues = sharedPools.numberArrays.acquire();
            try {
                for (const snapshot of snapshots) {
                    relevantPassiveValues.push(
                        side === "buy" ? snapshot.ask : snapshot.bid
                    );
                }

                const currentPassive =
                    relevantPassiveValues[relevantPassiveValues.length - 1] ||
                    0;
                const avgPassive = DetectorUtils.calculateMean(
                    relevantPassiveValues
                );
                const maxPassive = Math.max(...relevantPassiveValues);
                const minPassive = Math.min(...relevantPassiveValues);

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
                const imbalanceResult = this.checkPassiveImbalance(zone);

                // ✅ INTEGRATE: Add microstructure insights to conditions
                const microstructureInsights =
                    this.integrateMicrostructureInsights(zone);

                // Populate pooled conditions object
                conditions.absorptionRatio = absorptionRatio;
                conditions.passiveStrength = passiveStrength;
                conditions.hasRefill = hasRefill;
                conditions.icebergSignal = icebergSignal;
                conditions.liquidityGradient = liquidityGradient;
                conditions.absorptionVelocity = absorptionVelocity;
                conditions.currentPassive = currentPassive;
                conditions.avgPassive = avgPassive;
                conditions.maxPassive = maxPassive;
                conditions.minPassive = minPassive;
                conditions.aggressiveVolume = aggressiveVolume;
                conditions.imbalance = Math.abs(imbalanceResult.imbalance);
                conditions.sampleCount = snapshots.length;
                conditions.dominantSide = imbalanceResult.dominantSide;
                conditions.microstructure = microstructureInsights;

                // Release imbalance result back to pool
                sharedPools.imbalanceResults.release(imbalanceResult);

                return conditions;
            } finally {
                // Always release pooled array
                sharedPools.numberArrays.release(relevantPassiveValues);
            }
        } catch (error) {
            this.handleError(
                error as Error,
                "AbsorptionDetector.analyzeAbsorptionConditions"
            );
            // Copy default values to pooled object on error
            const defaultConditions = this.getDefaultConditions();
            Object.assign(conditions, defaultConditions);
            return conditions;
        }
    }

    /**
     * Calculate sophisticated absorption score with integrated microstructure insights
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

        // ✅ MICROSTRUCTURE INTEGRATION: Apply microstructure-based adjustments
        if (conditions.microstructure) {
            score = this.applyMicrostructureScoreAdjustments(
                score,
                conditions.microstructure
            );
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
     * Detect potential absorption spoofing patterns
     */
    private detectAbsorptionSpoofing(
        price: number,
        side: "buy" | "sell",
        aggressiveVolume: number,
        timestamp: number
    ): boolean {
        const windowMs = 30000; // 30 second window

        // Get recent trades at this price level
        const recentTrades = this.trades.filter(
            (t) =>
                Math.abs(t.price - price) <
                    Math.pow(10, -this.pricePrecision) / 2 &&
                timestamp - t.timestamp < windowMs
        );

        if (recentTrades.length < 3) return false;

        // Check for rapid order placement/cancellation patterns
        const timeBetweenTrades = [];
        for (let i = 1; i < recentTrades.length; i++) {
            timeBetweenTrades.push(
                recentTrades[i].timestamp - recentTrades[i - 1].timestamp
            );
        }

        // Detect suspiciously uniform timing (sub-second intervals)
        const avgInterval =
            timeBetweenTrades.reduce((a, b) => a + b, 0) /
            timeBetweenTrades.length;
        const uniformTiming = timeBetweenTrades.every(
            (interval) => Math.abs(interval - avgInterval) < 100 // Within 100ms
        );

        // Check for volume patterns that suggest spoofing
        const volumes = recentTrades.map((t) => t.quantity);
        const avgVolume = volumes.reduce((a, b) => a + b, 0) / volumes.length;
        const uniformVolumes = volumes.every(
            (vol) => Math.abs(vol - avgVolume) < avgVolume * 0.1 // Within 10%
        );

        // Red flags for spoofing
        const isSpoofing =
            uniformTiming &&
            uniformVolumes &&
            avgInterval < 1000 && // Faster than 1 second intervals
            aggressiveVolume > avgVolume * 10; // Suddenly large volume

        if (isSpoofing) {
            this.logger.warn("Potential absorption spoofing detected", {
                price,
                side,
                aggressiveVolume,
                avgInterval,
                uniformTiming,
            });
            this.metricsCollector.incrementMetric("absorptionSpoofingDetected");
        }

        return isSpoofing;
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
                  .filter((s) => now - s.timestamp < this.windowMs)
            : [];

        const passive =
            passiveSnapshots.length > 0
                ? DetectorUtils.calculateMean(
                      passiveSnapshots.map((s) => s.total)
                  )
                : 0;

        return { aggressive, passive, trades };
    }

    /**
     * ✅ NEW: Integrate microstructure insights for enhanced scoring
     */
    private integrateMicrostructureInsights(
        zone: number
    ): MicrostructureInsights | undefined {
        const zoneEvents = this.absorptionHistory.get(zone);
        if (!zoneEvents || zoneEvents.length < 2) {
            return undefined;
        }

        // Analyze recent microstructure events in this zone
        const recentEvents = zoneEvents.filter(
            (event) =>
                event.microstructure && event.timestamp > Date.now() - 300000 // Last 5 minutes
        );

        if (recentEvents.length === 0) {
            return undefined;
        }

        // Calculate aggregate microstructure metrics
        const avgFragmentation = DetectorUtils.calculateMean(
            recentEvents.map((e) => e.microstructure!.fragmentationScore)
        );
        const avgEfficiency = DetectorUtils.calculateMean(
            recentEvents.map((e) => e.microstructure!.executionEfficiency)
        );
        const avgToxicity = DetectorUtils.calculateMean(
            recentEvents.map((e) => e.microstructure!.toxicityScore)
        );
        const totalCoordination = recentEvents.reduce(
            (sum, e) => sum + e.microstructure!.coordinationIndicators,
            0
        );

        // Determine dominant algorithm type
        const algoTypes = recentEvents.map(
            (e) => e.microstructure!.suspectedAlgoType
        );
        const dominantAlgoType = this.findMostFrequent(algoTypes);

        // Determine dominant timing pattern
        const timingPatterns = recentEvents.map(
            (e) => e.microstructure!.timingPattern
        );
        const dominantTimingPattern = this.findMostFrequent(timingPatterns);

        // Calculate derived metrics
        const sustainabilityScore = this.calculateSustainabilityScore(
            dominantAlgoType,
            avgEfficiency,
            avgToxicity
        );
        const riskAdjustment = this.calculateRiskAdjustment(
            avgToxicity,
            dominantTimingPattern,
            totalCoordination
        );
        const confidenceBoost = this.calculateConfidenceBoost(
            avgFragmentation,
            dominantAlgoType,
            avgEfficiency
        );
        const urgencyFactor = this.calculateUrgencyFactor(
            dominantTimingPattern,
            avgToxicity
        );

        return {
            fragmentationScore: avgFragmentation,
            executionEfficiency: avgEfficiency,
            suspectedAlgoType: dominantAlgoType,
            toxicityScore: avgToxicity,
            timingPattern: dominantTimingPattern,
            coordinationIndicators: totalCoordination,
            sustainabilityScore,
            riskAdjustment,
            confidenceBoost,
            urgencyFactor,
        };
    }

    /**
     * ✅ NEW: Apply microstructure-based score adjustments
     */
    private applyMicrostructureScoreAdjustments(
        baseScore: number,
        microstructure: MicrostructureInsights
    ): number {
        let adjustedScore = baseScore;

        // 1. Risk-based adjustments for toxic flow
        adjustedScore += microstructure.riskAdjustment;

        // 2. Sustainability bonuses for favorable patterns
        if (microstructure.sustainabilityScore > 0.7) {
            adjustedScore += 0.05; // Sustainability bonus
        }

        // 3. Algorithm type adjustments
        switch (microstructure.suspectedAlgoType) {
            case "market_making":
                adjustedScore += 0.08; // Market makers enhance absorption
                break;
            case "iceberg":
                adjustedScore += 0.06; // Icebergs provide deep liquidity
                break;
            case "arbitrage":
                adjustedScore -= 0.03; // May indicate temporary opportunity
                break;
        }

        // 4. Execution efficiency bonus
        if (microstructure.executionEfficiency > 0.8) {
            adjustedScore += 0.03; // High efficiency suggests institutional quality
        }

        // 5. Fragmentation-based adjustments
        if (microstructure.fragmentationScore > 0.7) {
            adjustedScore += 0.04; // High fragmentation suggests iceberg behavior
        }

        // 6. Coordination penalty (may indicate manipulation)
        if (microstructure.coordinationIndicators > 3) {
            adjustedScore -= 0.04; // Too much coordination is suspicious
        }

        return Math.max(0, Math.min(1, adjustedScore));
    }

    /**
     * ✅ NEW: Calculate sustainability score based on microstructure patterns
     */
    private calculateSustainabilityScore(
        algoType: string,
        efficiency: number,
        toxicity: number
    ): number {
        let sustainability = 0.5; // Base sustainability

        // Algorithm type impact
        switch (algoType) {
            case "market_making":
                sustainability += 0.3; // Highly sustainable
                break;
            case "iceberg":
                sustainability += 0.2; // Generally sustainable
                break;
            case "splitting":
                sustainability += 0.1; // Moderately sustainable
                break;
            case "arbitrage":
                sustainability -= 0.2; // Temporary by nature
                break;
        }

        // Efficiency impact
        sustainability += (efficiency - 0.5) * 0.4;

        // Toxicity impact (inverse relationship)
        sustainability -= toxicity * 0.3;

        return Math.max(0, Math.min(1, sustainability));
    }

    /**
     * ✅ NEW: Calculate risk adjustment based on toxic flow and patterns
     */
    private calculateRiskAdjustment(
        toxicity: number,
        timingPattern: string,
        coordination: number
    ): number {
        let risk = 0;

        // Toxicity-based risk
        if (toxicity > 0.8) {
            risk -= 0.15; // High toxicity = high risk
        } else if (toxicity > 0.6) {
            risk -= 0.08;
        } else if (toxicity < 0.3) {
            risk += 0.05; // Low toxicity = low risk
        }

        // Timing pattern risk
        switch (timingPattern) {
            case "burst":
                risk -= 0.08; // Burst patterns suggest instability
                break;
            case "uniform":
                risk += 0.03; // Uniform patterns suggest stability
                break;
        }

        // Coordination risk (too much coordination is suspicious)
        if (coordination > 5) {
            risk -= 0.05;
        }

        return Math.max(-0.3, Math.min(0.3, risk));
    }

    /**
     * ✅ NEW: Calculate confidence boost based on execution quality
     */
    private calculateConfidenceBoost(
        fragmentation: number,
        algoType: string,
        efficiency: number
    ): number {
        let boost = 1.0; // Base confidence

        // High fragmentation with high efficiency suggests institutional quality
        if (fragmentation > 0.7 && efficiency > 0.7) {
            boost += 0.2;
        }

        // Algorithm type confidence impact
        switch (algoType) {
            case "market_making":
            case "iceberg":
                boost += 0.15; // High confidence algorithms
                break;
            case "splitting":
                boost += 0.08;
                break;
            case "unknown":
                boost -= 0.05; // Unknown patterns reduce confidence
                break;
        }

        // Efficiency-based boost
        if (efficiency > 0.8) {
            boost += 0.1;
        }

        return Math.max(0.8, Math.min(1.5, boost));
    }

    /**
     * ✅ NEW: Calculate urgency factor based on timing patterns
     */
    private calculateUrgencyFactor(
        timingPattern: string,
        toxicity: number
    ): number {
        let urgency = 1.0; // Base urgency

        // Timing pattern urgency
        switch (timingPattern) {
            case "burst":
                urgency += 0.5; // Burst patterns suggest immediate action needed
                break;
            case "coordinated":
                urgency += 0.3; // Coordinated patterns need quick response
                break;
            case "uniform":
                urgency -= 0.2; // Uniform patterns are less urgent
                break;
        }

        // High toxicity increases urgency
        if (toxicity > 0.8) {
            urgency += 0.3;
        }

        return Math.max(0.5, Math.min(2.0, urgency));
    }

    /**
     * ✅ NEW: Find most frequent item in array
     */
    private findMostFrequent<T>(array: T[]): T {
        const frequency = new Map<T, number>();
        for (const item of array) {
            frequency.set(item, (frequency.get(item) || 0) + 1);
        }

        let maxCount = 0;
        let mostFrequent = array[0];
        for (const [item, count] of frequency.entries()) {
            if (count > maxCount) {
                maxCount = count;
                mostFrequent = item;
            }
        }

        return mostFrequent;
    }

    /**
     * Analyze microstructure patterns for enhanced absorption detection
     */
    private analyzeMicrostructureForAbsorption(event: HybridTradeEvent): void {
        if (!event.microstructure || !event.individualTrades) {
            return;
        }

        const microstructure = event.microstructure;
        const zone = this.calculateZone(event.price);

        // Store microstructure insights for zone-specific analysis
        if (!this.absorptionHistory.has(zone)) {
            this.absorptionHistory.set(zone, []);
        }

        const zoneEvents = this.absorptionHistory.get(zone)!;

        // Enhanced absorption event with microstructure data
        const enhancedEvent: AbsorptionEvent & {
            microstructure: {
                fragmentationScore: number;
                executionEfficiency: number;
                suspectedAlgoType: string;
                toxicityScore: number;
                timingPattern: string;
                coordinationIndicators: number;
            };
        } = {
            timestamp: event.timestamp,
            price: event.price,
            side: event.buyerIsMaker ? "sell" : "buy",
            volume: event.quantity,
            microstructure: {
                fragmentationScore: microstructure.fragmentationScore,
                executionEfficiency: microstructure.executionEfficiency,
                suspectedAlgoType: microstructure.suspectedAlgoType,
                toxicityScore: microstructure.toxicityScore,
                timingPattern: microstructure.timingPattern,
                coordinationIndicators:
                    microstructure.coordinationIndicators.length,
            },
        };

        zoneEvents.push(enhancedEvent);

        // Keep only recent events (5 minutes)
        const cutoff = Date.now() - 300000;
        const recentEvents = zoneEvents.filter((e) => e.timestamp > cutoff);
        this.absorptionHistory.set(zone, recentEvents);

        // Analyze patterns for enhanced signal quality
        this.analyzeAbsorptionMicrostructurePatterns(
            zone,
            event,
            microstructure
        );
    }

    /**
     * Analyze microstructure patterns to enhance absorption signal quality
     */
    private analyzeAbsorptionMicrostructurePatterns(
        zone: number,
        event: HybridTradeEvent,
        microstructure: typeof event.microstructure
    ): void {
        if (!microstructure) return;

        // Get recent absorption events in this zone
        const zoneEvents = this.absorptionHistory.get(zone) || [];
        if (zoneEvents.length < 2) return;

        // Analyze iceberg behavior enhancement
        if (
            microstructure.suspectedAlgoType === "iceberg" ||
            microstructure.fragmentationScore > 0.7
        ) {
            // This enhances our existing iceberg detection
            // High fragmentation + consistent sizing = strong iceberg signal
            if (
                microstructure.sizingPattern === "consistent" &&
                microstructure.executionEfficiency > 0.6
            ) {
                // Boost absorption signal confidence for icebergs
                this.logger?.info(
                    "Enhanced iceberg absorption pattern detected",
                    {
                        zone,
                        price: event.price,
                        fragmentationScore: microstructure.fragmentationScore,
                        executionEfficiency: microstructure.executionEfficiency,
                        tradeComplexity: event.tradeComplexity,
                    }
                );
            }
        }

        // Analyze coordinated absorption (multiple parties absorbing together)
        if (microstructure.coordinationIndicators.length > 0) {
            const coordinationTypes = microstructure.coordinationIndicators.map(
                (c) => c.type
            );

            if (
                coordinationTypes.includes("time_coordination") ||
                coordinationTypes.includes("size_coordination")
            ) {
                this.logger?.info("Coordinated absorption activity detected", {
                    zone,
                    price: event.price,
                    coordinationIndicators:
                        microstructure.coordinationIndicators,
                    timingPattern: microstructure.timingPattern,
                });
            }
        }

        // Analyze toxic flow impact on absorption quality
        if (microstructure.toxicityScore > 0.8) {
            // High toxicity suggests informed flow - absorption may be temporary
            this.logger?.warn("High toxicity flow in absorption zone", {
                zone,
                price: event.price,
                toxicityScore: microstructure.toxicityScore,
                directionalPersistence: microstructure.directionalPersistence,
                note: "Absorption may be overwhelmed by informed flow",
            });
        }

        // Analyze timing patterns for absorption sustainability
        if (microstructure.timingPattern === "burst") {
            // Burst patterns may indicate imminent absorption breakdown
            this.logger?.info("Burst timing pattern in absorption zone", {
                zone,
                price: event.price,
                timingPattern: microstructure.timingPattern,
                avgTimeBetweenTrades: microstructure.avgTimeBetweenTrades,
                note: "Monitor for potential absorption breakdown",
            });
        }

        // Market making detection in absorption zones
        if (microstructure.suspectedAlgoType === "market_making") {
            // Market makers providing liquidity - positive for absorption sustainability
            this.logger?.info("Market making activity in absorption zone", {
                zone,
                price: event.price,
                algoType: microstructure.suspectedAlgoType,
                executionEfficiency: microstructure.executionEfficiency,
                note: "Enhanced absorption sustainability expected",
            });
        }
    }
}
