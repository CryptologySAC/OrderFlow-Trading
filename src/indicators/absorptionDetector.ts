// src/indicators/absorptionDetector.ts
import { SpotWebsocketStreams } from "@binance/spot";
import { BaseDetector, ZoneSample } from "./base/baseDetector.js";
import { RollingWindow } from "../utils/rollingWindow.js";
import type { ILogger } from "../infrastructure/loggerInterface.js";
import type { IMetricsCollector } from "../infrastructure/metricsCollectorInterface.js";
import { ISignalLogger } from "../infrastructure/signalLoggerInterface.js";
import { SpoofingDetector } from "../services/spoofingDetector.js";
import { AdaptiveThresholds } from "./marketRegimeDetector.js";
import type {
    IAbsorptionDetector,
    BaseDetectorSettings,
    AbsorptionFeatures,
    MicrostructureInsights,
    AbsorptionConditions,
} from "./interfaces/detectorInterfaces.js";
import {
    EnrichedTradeEvent,
    HybridTradeEvent,
    AggressiveTrade,
} from "../types/marketEvents.js";
import { DetectorUtils } from "./base/detectorUtils.js";
import { AbsorptionSignalData, SignalType } from "../types/signalTypes.js";
import { SharedPools } from "../utils/objectPool.js";
import { IOrderBookState } from "../market/orderBookState.js";
import { FinancialMath } from "../utils/financialMath.js";
import { VolumeAnalyzer } from "./utils/volumeAnalyzer.js";
import type { VolumeSurgeConfig } from "./interfaces/volumeAnalysisInterface.js";

export interface AbsorptionSettings extends BaseDetectorSettings {
    features?: AbsorptionFeatures;
    // Absorption-specific settings
    absorptionThreshold?: number; // Minimum absorption score (0-1)
    minPassiveMultiplier?: number; // Min passive/aggressive ratio for absorption
    icebergDetectionSensitivity?: number; // Sensitivity for iceberg detection (0-1)
    icebergConfidenceMultiplier?: number; // Confidence multiplier when iceberg detected (1.0-2.0)
    maxAbsorptionRatio?: number; // Max aggressive/passive ratio for absorption

    // Volume surge detection parameters for enhanced absorption analysis
    volumeSurgeMultiplier?: number; // Volume surge threshold for absorption validation
    imbalanceThreshold?: number; // Order flow imbalance threshold for absorption
    institutionalThreshold?: number; // Institutional trade size threshold
    burstDetectionMs?: number; // Burst detection window
    sustainedVolumeMs?: number; // Sustained volume analysis window
    medianTradeSize?: number; // Baseline trade size for volume analysis
}

/**
 * Comprehensive absorption analysis conditions with microstructure integration
 */

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
    private readonly icebergConfidenceMultiplier: number;
    private readonly maxAbsorptionRatio: number;

    // Advanced tracking
    private readonly absorptionHistory = new Map<number, AbsorptionEvent[]>();
    private readonly liquidityLayers = new Map<number, LiquidityLayer[]>();

    private readonly orderBook: IOrderBookState;

    // Volume surge analysis integration
    private readonly volumeAnalyzer: VolumeAnalyzer;
    private readonly volumeSurgeConfig: VolumeSurgeConfig;

    // Interval handles for proper cleanup
    private thresholdUpdateInterval?: NodeJS.Timeout;
    private historyCleanupInterval?: NodeJS.Timeout;

    constructor(
        id: string,
        settings: AbsorptionSettings = {},
        orderBook: IOrderBookState,
        logger: ILogger,
        spoofingDetector: SpoofingDetector,
        metricsCollector: IMetricsCollector,
        signalLogger?: ISignalLogger
    ) {
        super(
            id,
            settings,
            logger,
            spoofingDetector,
            metricsCollector,
            signalLogger
        );

        // 🚨 CRITICAL FIX: OrderBook should now be guaranteed to be initialized
        if (!orderBook) {
            throw new Error(
                `AbsorptionDetector[${id}]: orderBook is unexpectedly null. This indicates an initialization order bug.`
            );
        }
        this.orderBook = orderBook;

        // Initialize absorption-specific settings
        this.absorptionThreshold = settings.absorptionThreshold ?? 0.7;
        this.minPassiveMultiplier = settings.minPassiveMultiplier ?? 1.5;
        this.icebergDetectionSensitivity =
            settings.icebergDetectionSensitivity ?? 0.8;
        this.icebergConfidenceMultiplier =
            settings.icebergConfidenceMultiplier ?? 1.2;
        this.maxAbsorptionRatio = settings.maxAbsorptionRatio ?? 0.5;

        // Initialize volume surge configuration
        this.volumeSurgeConfig = {
            volumeSurgeMultiplier: settings.volumeSurgeMultiplier ?? 3.0,
            imbalanceThreshold: settings.imbalanceThreshold ?? 0.3,
            institutionalThreshold: settings.institutionalThreshold ?? 15.0,
            burstDetectionMs: settings.burstDetectionMs ?? 1500,
            sustainedVolumeMs: settings.sustainedVolumeMs ?? 25000,
            medianTradeSize: settings.medianTradeSize ?? 0.8,
        };

        // Initialize volume analyzer for enhanced absorption detection
        this.volumeAnalyzer = new VolumeAnalyzer(
            this.volumeSurgeConfig,
            logger,
            `${id}_absorption`
        );

        // Merge absorption-specific features
        this.features = {
            icebergDetection: true,
            liquidityGradient: true,
            absorptionVelocity: false,
            layeredAbsorption: false,
            ...settings.features,
        };

        // 🔧 CRITICAL FIX: Fix backwards thresholds
        this.adaptiveThresholdCalculator.updateBaseThresholds({
            absorptionLevels: {
                strong: 0.1, // 10% ratio = strong absorption (LOWER ratios = stronger)
                moderate: 0.3, // 30% ratio = moderate absorption (LOWER ratios = stronger)
                weak: 0.5, // 50% ratio = weak absorption (LOWER ratios = stronger)
            },
            minimumConfidence: 0.05, // Lower from 0.5 to 0.05
            consistencyRequirement: 0.4, // Lower from 0.6 to 0.4
        });

        this.updateThresholds(); // Force recalculation

        // NEW: Set up periodic threshold updates
        this.thresholdUpdateInterval = setInterval(
            () => this.updateThresholds(),
            this.updateIntervalMs
        );

        // Setup periodic cleanup for absorption tracking
        this.historyCleanupInterval = setInterval(
            () => this.cleanupAbsorptionHistory(),
            this.windowMs
        );
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

        // Use object pool to reduce GC pressure
        const snap = SharedPools.getInstance().zoneSamples.acquire();
        snap.bid = event.zonePassiveBidVolume;
        snap.ask = event.zonePassiveAskVolume;
        snap.total = event.zonePassiveBidVolume + event.zonePassiveAskVolume;
        snap.timestamp = event.timestamp;

        this.passiveEWMA.push(
            event.buyerIsMaker
                ? event.zonePassiveBidVolume // aggressive sell → tests BID
                : event.zonePassiveAskVolume // aggressive buy  → tests ASK
        );

        if (!last || last.bid !== snap.bid || last.ask !== snap.ask) {
            // Use pool-aware push to handle evicted objects
            this.pushToZoneHistoryWithPoolCleanup(zoneHistory, snap);
        } else {
            // Release snapshot back to pool if not used
            SharedPools.getInstance().zoneSamples.release(snap);
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

        const spread = this.getCurrentSpread()?.spread ?? 0;
        this.adaptiveThresholdCalculator.updateMarketData(
            event.price,
            event.quantity,
            spread
        );
    }

    /**
     * Absorption-specific trade handling (called by base class)
     */
    protected onEnrichedTradeSpecific(event: EnrichedTradeEvent): void {
        // Update volume analysis tracking for enhanced absorption detection
        this.volumeAnalyzer.updateVolumeTracking(event);

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

    private calculateAbsorptionScore(conditions: AbsorptionConditions): number {
        this.maybeUpdateThresholds();

        let score = 0;
        const thresholds = this.currentThresholds; // NEW: Use adaptive thresholds

        // Factor 1: Adaptive absorption ratio (LOWER ratios = stronger absorption)
        if (conditions.absorptionRatio <= thresholds.absorptionLevels.strong) {
            score += thresholds.absorptionScores.strong;
        } else if (
            conditions.absorptionRatio <= thresholds.absorptionLevels.moderate
        ) {
            score += thresholds.absorptionScores.moderate;
        } else if (
            conditions.absorptionRatio <= thresholds.absorptionLevels.weak
        ) {
            score += thresholds.absorptionScores.weak;
        }

        // Factor 2: Adaptive volume strength (CHANGED from hardcoded)
        const volumeRatio = FinancialMath.divideQuantities(
            conditions.aggressiveVolume,
            conditions.avgPassive
        );

        if (volumeRatio >= thresholds.volumeThresholds.highVolume) {
            score += 0.2; // High volume boost
        } else if (volumeRatio >= thresholds.volumeThresholds.mediumVolume) {
            score += 0.1; // Medium volume boost
        }

        // Factor 3: Adaptive consistency requirements (CHANGED from hardcoded)
        if (conditions.consistency >= thresholds.consistencyRequirement) {
            score += 0.15; // Consistency bonus
        } else if (
            conditions.consistency >=
            thresholds.consistencyRequirement * 0.8
        ) {
            score += 0.08; // Partial consistency bonus
        }

        if (this.features.spreadImpact && conditions.spread > 0.003) {
            score += 0.05;
        }

        if (conditions.velocityIncrease > 1.5) {
            score += 0.1;
        }

        // Penalty for insufficient data (UNCHANGED)
        if (conditions.sampleCount < 5) {
            score *= 0.8;
        }

        if (conditions.sampleCount < 5) {
            score *= 0.8;
        }

        const finalScore = Math.max(0, Math.min(1, score));
        const passesMinConfidence = finalScore >= thresholds.minimumConfidence;
        const returnedScore = passesMinConfidence ? finalScore : 0;

        return returnedScore;
    }

    // NEW: Add threshold management methods (same as exhaustion detector)
    private maybeUpdateThresholds(): void {
        const now = Date.now();
        if (now - this.lastThresholdUpdate > this.updateIntervalMs) {
            this.updateThresholds();
        }
    }

    private updateThresholds(): void {
        const oldThresholds = { ...this.currentThresholds };

        this.updateAdaptiveThresholds(); // Use BaseDetector method
        this.recentSignalCount = 0;

        if (this.hasSignificantChange(oldThresholds, this.currentThresholds)) {
            this.logger?.info("[AbsorptionDetector] Thresholds adapted", {
                old: oldThresholds,
                new: this.currentThresholds,
                timestamp: new Date().toISOString(),
            });
        }
    }

    private hasSignificantChange(
        old: AdaptiveThresholds,
        current: AdaptiveThresholds
    ): boolean {
        const threshold = 0.1;

        return (
            Math.abs(
                old.absorptionLevels.strong - current.absorptionLevels.strong
            ) /
                old.absorptionLevels.strong >
                threshold ||
            Math.abs(
                old.absorptionScores.strong - current.absorptionScores.strong
            ) /
                old.absorptionScores.strong >
                threshold ||
            Math.abs(old.minimumConfidence - current.minimumConfidence) /
                old.minimumConfidence >
                threshold
        );
    }

    // NEW: Update handleDetection to track signals
    protected handleDetection(signal: AbsorptionSignalData): void {
        this.recentSignalCount++;

        signal.meta = {
            ...signal.meta,
            adaptiveThresholds: this.currentThresholds,
            thresholdVersion: "adaptive-v1.0",
        };

        this.metricsCollector.updateMetric(
            `detector_${this.detectorType}Aggressive_volume`,
            signal.aggressive
        );
        this.metricsCollector.incrementMetric("absorptionSignalsGenerated");
        this.metricsCollector.recordHistogram(
            "absorption.score",
            signal.confidence
        );

        super.handleDetection(signal);
    }

    /**
     * Override cleanup to properly clear interval timers and prevent memory leaks
     */
    public cleanup(): void {
        // Clear absorption detector specific intervals
        if (this.thresholdUpdateInterval) {
            clearInterval(this.thresholdUpdateInterval);
            this.thresholdUpdateInterval = undefined;
        }

        if (this.historyCleanupInterval) {
            clearInterval(this.historyCleanupInterval);
            this.historyCleanupInterval = undefined;
        }

        // Call parent cleanup for zone management and other base cleanup
        super.cleanup();
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

                if (bucket.trades.length === 0) {
                    continue;
                }

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
        side: "bid" | "ask", // FIXED: Now correctly represents passive side
        zone: number
    ): boolean {
        // For buy absorption: aggressive buys hit the ASK (passive sellers)
        // For sell absorption: aggressive sells hit the BID (passive buyers)

        //Check for Iceberg first
        const zoneHistory = this.zonePassiveHistory.get(zone);
        if (!zoneHistory) return false;

        // 🚨 CRITICAL FIX: Add null safety guard for orderBook
        if (!this.orderBook) {
            this.logger.warn("OrderBook unavailable for absorption analysis", {
                price,
                side,
                zone,
                detectorId: this.id,
            });
            return false; // Skip iceberg detection, continue with basic absorption logic
        }

        // 🚨 CRITICAL FIX: Iceberg detection should ENHANCE absorption confidence, not abort
        let icebergConfidenceFactor = 1.0;

        if (this.features.icebergDetection) {
            const lvl = this.orderBook.getLevel(price);
            const icebergLikely =
                lvl &&
                (side === "bid"
                    ? (lvl.addedBid ?? 0) >
                      (lvl.consumedBid ?? 0) * this.icebergDetectionSensitivity
                    : (lvl.addedAsk ?? 0) >
                      (lvl.consumedAsk ?? 0) *
                          this.icebergDetectionSensitivity);

            if (icebergLikely) {
                // Iceberg orders represent significant institutional absorption
                // Use configured multiplier to enhance absorption confidence
                icebergConfidenceFactor = this.icebergConfidenceMultiplier;
            }
        }

        // Get the RELEVANT passive side
        // ✅ VERIFIED LOGIC: Aggressive flow hits opposite-side passive liquidity
        // - Buy absorption (aggressive buys): Tests ASK liquidity depletion/refill
        // - Sell absorption (aggressive sells): Tests BID liquidity depletion/refill
        // Validated against docs/BuyerIsMaker-field.md and unit tests
        const relevantPassive = zoneHistory.toArray().map((snapshot) => {
            return side === "bid" ? snapshot.bid : snapshot.ask;
        });

        if (relevantPassive.length === 0) return false;

        // Calculate rolling statistics
        const currentPassive = relevantPassive[relevantPassive.length - 1] || 0;
        const avgPassive = DetectorUtils.calculateMean(relevantPassive);
        const minPassive = Math.min(...relevantPassive);

        // Get recent aggressive volume
        const recentAggressive =
            side === "bid"
                ? this.aggrSellEWMA.get() // “buy” absorption: compare to buy aggression
                : this.aggrBuyEWMA.get(); // “sell” absorption: compare to sell aggression

        // Sophisticated absorption checks (enhanced with iceberg confidence factor):
        // 1. Passive maintained despite hits (liquidity resilience under pressure)
        const maintainedPassive =
            minPassive > avgPassive * (0.7 / icebergConfidenceFactor) &&
            recentAggressive > avgPassive;

        // 2. Passive growing (iceberg/refill - active liquidity replenishment)
        const growingPassive =
            currentPassive > avgPassive * (1.2 / icebergConfidenceFactor);

        return maintainedPassive || growingPassive;
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
            // Use integer arithmetic for financial precision
            const scale = Math.pow(10, this.pricePrecision);
            const scaledPrice = Math.round(price * scale);
            const scaledTickSize = Math.round(tickSize * scale);
            const testPrice = (scaledPrice + offset * scaledTickSize) / scale;
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
        // Use absorbing side for consistent absorption tracking
        const side = this.getAbsorbingSide(event);

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
     * Get absorbing (passive) side for absorption signals - LEGACY METHOD
     *
     * @deprecated Use getAbsorbingSideForZone() for proper flow analysis
     * @param trade The aggressive trade hitting passive liquidity
     * @returns The side that is providing passive liquidity (absorbing)
     */
    private getAbsorbingSide(trade: AggressiveTrade): "buy" | "sell" {
        // For absorption, we want the PASSIVE side that's absorbing the aggressive flow
        // - Aggressive buy (buyerIsMaker=false) hits ask → sellers are absorbing → "sell"
        // - Aggressive sell (buyerIsMaker=true) hits bid → buyers are absorbing → "buy"
        return trade.buyerIsMaker ? "buy" : "sell";
    }

    /**
     * Determine the dominant aggressive side in recent trades for proper absorption detection
     *
     * CRITICAL FIX: Absorption should be based on dominant flow patterns, not individual trades
     *
     * @param trades Recent trades in the zone
     * @returns The dominant aggressive side based on volume analysis
     */
    private getDominantAggressiveSide(
        trades: AggressiveTrade[]
    ): "buy" | "sell" {
        const recentTrades = trades.slice(-10); // Last 10 trades for pattern analysis

        let buyVolume = 0;
        let sellVolume = 0;

        for (const trade of recentTrades) {
            if (trade.buyerIsMaker) {
                // buyerIsMaker = true → aggressive sell hitting bid
                sellVolume += trade.quantity;
            } else {
                // buyerIsMaker = false → aggressive buy hitting ask
                buyVolume += trade.quantity;
            }
        }

        return buyVolume > sellVolume ? "buy" : "sell";
    }

    /**
     * Get absorbing side based on dominant flow analysis and absorption conditions
     *
     * ENHANCED ABSORPTION LOGIC: This method properly determines which side is absorbing
     * by analyzing both absorption conditions and dominant flow patterns
     *
     * @param tradesAtZone Recent trades in the zone
     * @param zone Zone number
     * @param price Current price level
     * @returns The absorbing side or null if no clear absorption
     */
    private getAbsorbingSideForZone(
        tradesAtZone: AggressiveTrade[],
        zone: number,
        price: number
    ): "bid" | "ask" | null {
        // Determine dominant aggressive flow
        const dominantAggressiveSide =
            this.getDominantAggressiveSide(tradesAtZone);

        // Calculate price efficiency for absorption detection
        const priceEfficiency = this.calculatePriceEfficiency(
            tradesAtZone,
            zone
        );

        // If price efficiency < 0.7, there's likely absorption happening
        if (priceEfficiency < 0.7) {
            // The PASSIVE side opposite to aggressive flow is absorbing
            return dominantAggressiveSide === "buy" ? "ask" : "bid";
        }

        // Fallback: Check explicit absorption conditions
        const bidAbsorption = this.checkAbsorptionConditions(
            price,
            "bid",
            zone
        );
        const askAbsorption = this.checkAbsorptionConditions(
            price,
            "ask",
            zone
        );

        if (bidAbsorption && !askAbsorption) return "bid";
        if (askAbsorption && !bidAbsorption) return "ask";
        if (bidAbsorption && askAbsorption) {
            // Both showing absorption - return stronger one
            const stronger = this.resolveConflictingAbsorption(zone);
            // Convert trading direction back to order book side:
            // - "buy" absorption → "bid" side is absorbing
            // - "sell" absorption → "ask" side is absorbing
            return stronger === "buy" ? "bid" : "ask";
        }

        return null; // No clear absorption
    }

    /**
     * Calculate how efficiently price moved relative to volume pressure
     * Lower efficiency indicates absorption (volume without proportional price movement)
     */
    private calculatePriceEfficiency(
        tradesAtZone: AggressiveTrade[],
        zone: number
    ): number {
        if (tradesAtZone.length < 3) return 1.0; // Neutral if insufficient data

        // Get price range during this period
        const prices = tradesAtZone.map((t) => t.price);
        const priceMovement = Math.max(...prices) - Math.min(...prices);

        // Get total aggressive volume
        const totalVolume = tradesAtZone.reduce(
            (sum, t) => sum + t.quantity,
            0
        );

        // Get average passive liquidity in this zone
        const zoneHistory = this.zonePassiveHistory.get(zone);
        const avgPassive = zoneHistory
            ? DetectorUtils.calculateMean(
                  zoneHistory.toArray().map((s) => s.total)
              )
            : totalVolume; // Fallback to aggressive volume

        if (avgPassive === 0) return 1.0;

        // Calculate expected price movement based on volume pressure
        const volumePressure = totalVolume / avgPassive;
        const tickSize = Math.pow(10, -this.pricePrecision);
        const expectedMovement = volumePressure * tickSize * 10; // Scaling factor

        if (expectedMovement === 0) return 1.0;

        // Efficiency = actual movement / expected movement
        // Low efficiency = absorption (price didn't move as much as expected)
        const efficiency = priceMovement / expectedMovement;

        return Math.max(0.1, Math.min(2.0, efficiency));
    }

    /**
     * Resolve conflicting absorption signals using zone passive strength analysis
     *
     * When both buy and sell sides show absorption, determine which is stronger
     * based on recent passive liquidity strength trends
     *
     * @param zone Zone number
     * @returns The side with stronger absorption based on passive strength
     */
    private resolveConflictingAbsorption(zone: number): "buy" | "sell" {
        const zoneHistory = this.zonePassiveHistory.get(zone);
        if (!zoneHistory || zoneHistory.count() < 6) {
            return "buy"; // Default to buy if insufficient data
        }

        const snapshots = zoneHistory.toArray();
        const recentBidStrength = this.calculatePassiveStrength(
            snapshots,
            "bid"
        );
        const recentAskStrength = this.calculatePassiveStrength(
            snapshots,
            "ask"
        );

        // Return the trading direction being absorbed:
        // - Strong bid side → buy orders being absorbed → "buy" absorption
        // - Strong ask side → sell orders being absorbed → "sell" absorption
        return recentBidStrength > recentAskStrength ? "buy" : "sell";
    }

    /**
     * Calculate passive strength growth for bid or ask side
     *
     * @param snapshots Zone passive history snapshots
     * @param side "bid" or "ask" side to analyze
     * @returns Strength ratio (>1 means growing, <1 means declining)
     */
    private calculatePassiveStrength(
        snapshots: ZoneSample[],
        side: "bid" | "ask"
    ): number {
        if (snapshots.length < 3) return 1; // Neutral if insufficient data

        const values = snapshots.map((s) => s[side]);
        const recent = values.slice(-3); // Last 3 snapshots
        const earlier = values.slice(-6, -3); // Previous 3 snapshots

        if (earlier.length === 0) return 1;

        const recentAvg = DetectorUtils.calculateMean(recent);
        const earlierAvg = DetectorUtils.calculateMean(earlier);

        // Return growth ratio (>1 means growing passive liquidity = stronger absorption)
        return earlierAvg > 0 ? recentAvg / earlierAvg : 1;
    }

    /**
     * Determine which method was used to identify absorption for metadata
     *
     * @param zone Zone number
     * @param price Current price level
     * @param side Determined absorption side
     * @returns Method used to determine absorption
     */
    private determineAbsorptionMethod(zone: number, price: number): string {
        const bidAbsorption = this.checkAbsorptionConditions(
            price,
            "bid",
            zone
        );
        const askAbsorption = this.checkAbsorptionConditions(
            price,
            "ask",
            zone
        );

        if (bidAbsorption && askAbsorption) {
            return "zone-strength-resolution"; // Both sides showed absorption, resolved by passive strength
        } else if (bidAbsorption || askAbsorption) {
            return "condition-based"; // Clear absorption condition detected
        } else {
            return "flow-based"; // Fallback to dominant flow analysis
        }
    }

    /**
     * Calculate absorption context based on market structure for enhanced signal quality
     *
     * @param price Current price level
     * @param side Absorbing side (buy/sell)
     * @returns Context analysis including reversal potential and price position
     */
    private calculateAbsorptionContext(
        price: number,
        side: "bid" | "ask" // FIXED: Now correctly typed
    ): {
        isReversal: boolean;
        strength: number;
        priceContext: "high" | "low" | "middle";
        contextConfidence: number;
    } {
        const recentPrices = this.getRecentPriceRange();
        const pricePercentile = this.calculatePricePercentile(
            price,
            recentPrices
        );

        const priceContext =
            pricePercentile > 0.8
                ? "high"
                : pricePercentile < 0.2
                  ? "low"
                  : "middle";

        // CORRECTED LOGIC:
        // At highs + ask absorption = likely resistance/reversal down
        // At lows + bid absorption = likely support/bounce up
        const isLogicalReversal =
            (side === "ask" && pricePercentile > 0.8) || // Ask absorption at highs
            (side === "bid" && pricePercentile < 0.2); // Bid absorption at lows

        // Strength increases at price extremes
        const strength = isLogicalReversal
            ? Math.abs(pricePercentile - 0.5) * 2
            : 0.5;

        // Context confidence based on how extreme the price is
        const contextConfidence = Math.abs(pricePercentile - 0.5) * 2;

        return {
            isReversal: isLogicalReversal,
            strength,
            priceContext,
            contextConfidence,
        };
    }

    /**
     * Get recent price range for context analysis
     */
    private getRecentPriceRange(): number[] {
        const windowMs = 300000; // 5 minutes
        const now = Date.now();

        return this.trades
            .filter((t) => now - t.timestamp < windowMs)
            .map((t) => t.price);
    }

    /**
     * Calculate price percentile within recent range
     */
    private calculatePricePercentile(
        price: number,
        recentPrices: number[]
    ): number {
        if (recentPrices.length < 10) return 0.5; // Neutral if insufficient data

        const sortedPrices = [...recentPrices].sort((a, b) => a - b);
        const below = sortedPrices.filter((p) => p < price).length;

        return below / sortedPrices.length;
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

        for (const [zone, events] of this.absorptionHistory) {
            const filtered = events.filter((e) => e.timestamp > cutoff);
            if (filtered.length === 0) {
                this.absorptionHistory.delete(zone);
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

        // ✅ ENHANCED: Use proper absorption detection logic based on dominant flow
        const side = this.getAbsorbingSideForZone(tradesAtZone, zone, price);

        if (!side) {
            // No clear absorption detected - exit early
            return;
        } //else if (side) {
        //const opposingSide = side === "bid" ? "ask" : "bid";
        //const opposingAbsorption = this.checkAbsorptionConditions(
        //    price,
        //    opposingSide,
        //    zone
        //);

        // if (opposingAbsorption) {
        // Both sides showing absorption - use stronger one only
        //const stronger = this.resolveConflictingAbsorption(zone);
        // Convert trading direction to order book side for comparison:
        // - "buy" absorption → "bid" side is absorbing
        // - "sell" absorption → "ask" side is absorbing
        //const strongerSide = stronger === "buy" ? "bid" : "ask";
        //if (strongerSide !== side) {
        //return; // Skip this signal, opposing side is stronger
        //}
        //}
        //}

        // Only signal at price extremes for "true tops"
        //const pricePercentile = this.calculatePricePercentile(
        //    price,
        //    this.getRecentPriceRange()
        //);

        // For resistance (SELL signals): Only trigger near highs
        //if (side === "ask" && pricePercentile < 0.8) {
        //    return; // Not high enough for true top
        // }

        // For support (BUY signals): Only trigger near lows
        //if (side === "bid" && pricePercentile > 0.2) {
        //    return; // Not low enough for true bottom
        //}

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
            this.logger.warn(`[AbsorptionDetector] No book data available`, {
                zone,
                price,
                side,
                hasZoneHistory: this.zonePassiveHistory.has(zone),
            });
            return;
        }

        // Check cooldown (only confirm updates later)
        if (!this.checkCooldown(zone, side === "bid" ? "sell" : "buy", false)) {
            // IMPORTANT: This is the correct order SELL/BUY
            return;
        }

        // Analyze absorption conditions using object pooling
        const conditions = this.analyzeAbsorptionConditions(
            price,
            side === "bid" ? "sell" : "buy", // IMPORTANT: This is the correct order SELL/BUY
            zone
        );

        const missingFields = [
            "consistency",
            "velocityIncrease",
            "spread",
            "absorptionVelocity",
            "liquidityGradient",
            "currentPassive",
            "maxPassive",
            "minPassive",
            "imbalance",
            "dominantSide",
        ].filter((field) => !(field in conditions));

        if (missingFields.length > 0) {
            this.logger.warn(
                `[AbsorptionDetector] ⚠️ MISSING CONDITION FIELDS`,
                {
                    missingFields,
                    note: "analyzeAbsorptionConditions() is not populating all required fields",
                }
            );
        }

        const completeConditions = {
            ...conditions,
            // Add missing fields with safe defaults if they're undefined
            consistency: conditions.consistency ?? 0.7, // Default good consistency
            velocityIncrease: conditions.velocityIncrease ?? 1.0, // Default neutral velocity
            spread: conditions.spread ?? 0.002, // Default small spread

            // Ensure other fields have safe values
            absorptionVelocity: conditions.absorptionVelocity ?? 0,
            liquidityGradient: conditions.liquidityGradient ?? 0,
            currentPassive: conditions.currentPassive ?? conditions.avgPassive,
            maxPassive: conditions.maxPassive ?? conditions.avgPassive,
            minPassive: conditions.minPassive ?? conditions.avgPassive,
            imbalance: conditions.imbalance ?? 0,
            dominantSide: conditions.dominantSide ?? ("neutral" as const),
            microstructure: conditions.microstructure,
        };

        const score = this.calculateAbsorptionScore(completeConditions);

        // Store conditions reference for later cleanup
        const conditionsToRelease = conditions;

        // Check score threshold
        if (score < this.absorptionThreshold) {
            SharedPools.getInstance().absorptionConditions.release(
                conditionsToRelease
            );
            return;
        }

        // ✅ ENHANCED: Volume surge validation for absorption confirmation
        const volumeValidation =
            this.volumeAnalyzer.validateVolumeSurgeConditions(
                tradesAtZone,
                triggerTrade.timestamp
            );

        if (!volumeValidation.valid) {
            this.logger.debug(
                `[AbsorptionDetector] Absorption signal rejected - volume surge validation failed`,
                {
                    zone,
                    price,
                    score,
                    reason: volumeValidation.reason,
                    volumeMultiplier:
                        volumeValidation.volumeSurge.volumeMultiplier,
                    imbalance: volumeValidation.imbalance.imbalance,
                }
            );
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
            SharedPools.getInstance().volumeResults.release(volumes);
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
            SharedPools.getInstance().volumeResults.release(volumes);
            return;
        }

        // Enhanced absorption spoofing detection
        if (
            this.detectAbsorptionSpoofing(
                price,
                side === "bid" ? "buy" : "sell",
                volumes.aggressive,
                triggerTrade.timestamp
            )
        ) {
            this.logger.warn(
                `[AbsorptionDetector] Signal rejected - absorption spoofing detected`,
                {
                    zone,
                    price,
                    side,
                    aggressive: volumes.aggressive,
                }
            );
            this.metricsCollector.incrementMetric("absorptionSpoofingRejected");
            // Release pooled conditions object before early return
            SharedPools.getInstance().absorptionConditions.release(
                conditionsToRelease
            );
            SharedPools.getInstance().volumeResults.release(volumes);
            return;
        }

        // General spoofing check (includes layering detection)
        if (
            this.features.spoofingDetection &&
            (this.isSpoofed(
                price,
                side === "bid" ? "buy" : "sell",
                triggerTrade.timestamp
            ) ||
                this.detectLayeringAttack(
                    price,
                    side === "bid" ? "buy" : "sell",
                    triggerTrade.timestamp
                ))
        ) {
            this.logger.warn(
                `[AbsorptionDetector] Signal rejected - general spoofing detected`,
                {
                    zone,
                    price,
                    side,
                }
            );
            this.metricsCollector.incrementMetric("absorptionSpoofingRejected");
            // Release pooled conditions object before early return
            SharedPools.getInstance().absorptionConditions.release(
                conditionsToRelease
            );
            SharedPools.getInstance().volumeResults.release(volumes);
            return;
        }

        // ✅ ENHANCED: Apply context-aware absorption logic for market structure
        const absorptionContext = this.calculateAbsorptionContext(price, side);

        // ✅ ENHANCED: Apply microstructure confidence and urgency adjustments
        let finalConfidence = score;
        let signalUrgency = "medium" as "low" | "medium" | "high";

        // Apply context-aware confidence adjustments
        if (absorptionContext.isReversal) {
            // Boost confidence for logical reversal scenarios
            finalConfidence *= 1 + absorptionContext.strength * 0.3; // Up to 30% boost
            this.logger.info(
                `[AbsorptionDetector] Context-enhanced absorption at ${absorptionContext.priceContext}`,
                {
                    zone,
                    price,
                    side,
                    priceContext: absorptionContext.priceContext,
                    reversalStrength: absorptionContext.strength,
                    confidenceBoost: absorptionContext.strength * 0.3,
                }
            );
        }

        if (conditions.microstructure) {
            // Incorporate risk and sustainability into scoring
            finalConfidence = this.applyMicrostructureScoreAdjustments(
                finalConfidence,
                conditions.microstructure
            );

            finalConfidence *= conditions.microstructure.confidenceBoost;

            // Adjust urgency based on microstructure insights
            if (conditions.microstructure.urgencyFactor > 1.3) {
                signalUrgency = "high";
            } else if (conditions.microstructure.urgencyFactor < 0.8) {
                signalUrgency = "low";
            }
        }

        // Context-based urgency adjustments
        if (absorptionContext.isReversal && absorptionContext.strength > 0.7) {
            signalUrgency = "high"; // High urgency for strong reversal signals
        }

        // ✅ ENHANCED: Apply volume surge confidence boost
        const volumeBoost = this.volumeAnalyzer.calculateVolumeConfidenceBoost(
            volumeValidation.volumeSurge,
            volumeValidation.imbalance,
            volumeValidation.institutional
        );

        if (volumeBoost.isValid) {
            finalConfidence += volumeBoost.confidence;

            this.logger.debug(
                `[AbsorptionDetector] Volume surge confidence boost applied`,
                {
                    zone,
                    price,
                    side,
                    originalConfidence: score,
                    volumeBoost: volumeBoost.confidence,
                    finalConfidence,
                    reason: volumeBoost.reason,
                    enhancementFactors: volumeBoost.enhancementFactors,
                    metadata: volumeBoost.metadata,
                }
            );
        }

        // ✅ ENHANCED: Calculate flow analysis for comprehensive debugging
        const dominantAggressiveSide =
            this.getDominantAggressiveSide(tradesAtZone);
        const buyVolume = tradesAtZone
            .filter((t) => !t.buyerIsMaker)
            .reduce((s, t) => s + t.quantity, 0);
        const sellVolume = tradesAtZone
            .filter((t) => t.buyerIsMaker)
            .reduce((s, t) => s + t.quantity, 0);

        // Calculate price efficiency for enhanced logging
        const priceEfficiency = this.calculatePriceEfficiency(
            tradesAtZone,
            zone
        );

        this.logger.info(
            `[AbsorptionDetector] 🎯 CORRECTED ABSORPTION SIGNAL!`,
            {
                zone,
                price,
                side,
                aggressive: volumes.aggressive,
                passive: volumes.passive,
                confidence: score,
                absorptionRatio,
                conditions: {
                    absorptionRatio: conditions.absorptionRatio,
                    hasRefill: conditions.hasRefill,
                    icebergSignal: conditions.icebergSignal,
                },
                // ✅ NEW: Enhanced debug information for flow analysis
                debugInfo: {
                    dominantAggressiveFlow: dominantAggressiveSide,
                    absorbingSide: side,
                    priceContext: absorptionContext.priceContext,
                    interpretation:
                        side === "bid"
                            ? "Bid liquidity absorbing sell pressure → Support forming"
                            : "Ask liquidity absorbing buy pressure → Resistance forming",
                    tradeCount: tradesAtZone.length,
                    latestTradeWasMaker: latestTrade.buyerIsMaker,
                    flowAnalysis: {
                        buyVolume,
                        sellVolume,
                        volumeRatio:
                            sellVolume > 0 ? buyVolume / sellVolume : buyVolume,
                        dominantFlowConfidence:
                            Math.abs(buyVolume - sellVolume) /
                            (buyVolume + sellVolume),
                    },
                },
            }
        );

        this.logger.info(
            `[AbsorptionDetector] 🎯 CORRECTED ABSORPTION SIGNAL!`,
            {
                zone,
                price,
                absorbingSide: side,
                dominantAggressiveFlow: dominantAggressiveSide,
                priceEfficiency,
                interpretation:
                    side === "bid"
                        ? "Bid liquidity absorbing sell pressure → Support level forming"
                        : "Ask liquidity absorbing buy pressure → Resistance level forming",
                marketLogic: `Heavy ${dominantAggressiveSide} flow → ${side} side absorbing → Price rejection expected`,
            }
        );

        const signal: AbsorptionSignalData = {
            zone,
            price,
            side: side === "bid" ? "buy" : "sell", // Convert to expected interface format
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
                detectorVersion: "6.0-corrected-absorption-logic", // CORRECTED: Perfect absorption logic

                // CORRECTED: Proper signal interpretation
                absorbingSide: side,
                aggressiveSide: dominantAggressiveSide,
                signalInterpretation:
                    side === "bid"
                        ? "bid_liquidity_absorbing_sell_pressure_support_forming"
                        : "ask_liquidity_absorbing_buy_pressure_resistance_forming",
                absorptionType:
                    side === "bid"
                        ? "support_absorption"
                        : "resistance_absorption",

                // Enhanced context
                marketContext: {
                    priceEfficiency: this.calculatePriceEfficiency(
                        tradesAtZone,
                        zone
                    ),
                    expectedPriceMovement: this.calculateExpectedMovement(
                        volumes.aggressive,
                        volumes.passive
                    ),
                    actualPriceMovement: Math.abs(
                        price - tradesAtZone[0].price
                    ),
                    absorptionStrength:
                        1 - this.calculatePriceEfficiency(tradesAtZone, zone), // Inverse of efficiency
                },
                absorptionMethod: this.determineAbsorptionMethod(zone, price),
                flowAnalysis: {
                    buyVolume,
                    sellVolume,
                    tradeCount: tradesAtZone.length,
                    dominantSide: dominantAggressiveSide,
                    volumeRatio:
                        sellVolume > 0 ? buyVolume / sellVolume : buyVolume,
                    confidenceScore:
                        Math.abs(buyVolume - sellVolume) /
                        Math.max(buyVolume + sellVolume, 1),
                },
                // ✅ NEW: Include context-aware analysis
                absorptionContext: {
                    isReversal: absorptionContext.isReversal,
                    priceContext: absorptionContext.priceContext,
                    contextStrength: absorptionContext.strength,
                    contextConfidence: absorptionContext.contextConfidence,
                },
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
        SharedPools.getInstance().volumeResults.release(volumes);
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
    // PROPER FIX: Complete the analyzeAbsorptionConditions() method

    /**
     * Comprehensive absorption condition analysis
     * Uses object pooling for optimal performance in hot path
     */
    private analyzeAbsorptionConditions(
        price: number,
        side: "buy" | "sell",
        zone: number
    ): AbsorptionConditions {
        const sharedPools = SharedPools.getInstance();
        const conditions = sharedPools.absorptionConditions.acquire();

        try {
            const zoneHistory = this.zonePassiveHistory.get(zone);
            if (!zoneHistory || zoneHistory.count() === 0) {
                // Return safe defaults for empty zone history
                sharedPools.absorptionConditions.release(conditions);
                return this.getDefaultConditions();
            }

            const now = Date.now();
            const snapshots = zoneHistory
                .toArray()
                .filter((s) => now - s.timestamp < this.windowMs);

            if (snapshots.length === 0) {
                sharedPools.absorptionConditions.release(conditions);
                return this.getDefaultConditions();
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

                /* ── Aligned 15-second ratio ──────────────────────────────────────────── */
                const ewmaAgg = this.aggressiveEWMA.get(); // 15 s aggressive
                const ewmaPas = this.passiveEWMA.get(); // 15 s passive (opposite side)

                const absorptionRatio = ewmaPas > 0 ? ewmaAgg / ewmaPas : 1; // smaller = stronger absorption

                // ✅ FIX 1: Properly calculate passive strength
                const passiveStrength =
                    avgPassive > 0 ? currentPassive / avgPassive : 0;

                // ✅ FIX 3: Properly implement iceberg detection
                const icebergSignal = this.features.icebergDetection
                    ? this.detectIcebergPattern(zone, snapshots, side)
                    : 0;

                // ✅ FIX 4: Properly implement liquidity gradient
                const liquidityGradient = this.features.liquidityGradient
                    ? this.calculateLiquidityGradient(zone, price, side)
                    : 0;

                // ✅ FIX 5: Properly implement absorption velocity
                const absorptionVelocity = this.features.absorptionVelocity
                    ? this.calculateAbsorptionVelocity(zone, side)
                    : 0;

                // ✅ FIX 6: Properly calculate consistency
                const consistency = this.calculateAbsorptionConsistency(
                    relevantPassiveValues
                );

                // ✅ FIX 7: Properly calculate velocity increase
                const velocityIncrease = this.calculateVelocityIncrease(
                    zone,
                    side,
                    snapshots
                );

                // ✅ FIX 8: Properly get spread information
                const spreadInfo = this.getCurrentSpread();
                const spread = spreadInfo?.spread ?? 0;

                // ✅ FIX 9: Properly calculate imbalance
                const imbalanceResult = this.checkPassiveImbalance(zone);

                // ✅ FIX 10: Properly integrate microstructure insights
                const microstructureInsights =
                    this.integrateMicrostructureInsights(zone);

                // ✅ POPULATE ALL FIELDS: Ensure every field is properly set
                conditions.absorptionRatio = absorptionRatio;
                conditions.passiveStrength = passiveStrength;
                conditions.icebergSignal = icebergSignal;
                conditions.liquidityGradient = liquidityGradient;
                conditions.absorptionVelocity = absorptionVelocity;
                conditions.currentPassive = currentPassive;
                conditions.avgPassive = avgPassive;
                conditions.maxPassive = maxPassive;
                conditions.minPassive = minPassive;
                conditions.aggressiveVolume = ewmaAgg;
                conditions.imbalance = Math.abs(imbalanceResult.imbalance);
                conditions.sampleCount = snapshots.length;
                conditions.dominantSide = imbalanceResult.dominantSide;
                conditions.microstructure = microstructureInsights;
                conditions.consistency = consistency;
                conditions.velocityIncrease = velocityIncrease;
                conditions.spread = spread;

                // Calculate hasRefill: maxPassive > avgPassive * 1.1 indicates refill activity
                conditions.hasRefill = maxPassive > avgPassive * 1.1;

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
            // Return safe defaults on error
            const defaultConditions = this.getDefaultConditions();
            Object.assign(conditions, defaultConditions);
            return conditions;
        }
    }

    /**
     * ✅ FIX: Proper consistency calculation with safety checks
     */
    private calculateAbsorptionConsistency(passiveValues: number[]): number {
        if (passiveValues.length < 2) {
            // For insufficient data, calculate consistency from current EWMA state
            const passiveEWMA = this.passiveEWMA.get();
            const aggressiveEWMA = this.aggressiveEWMA.get();

            if (passiveEWMA > 0 && aggressiveEWMA > 0) {
                // Use ratio stability as consistency proxy
                const ratio =
                    Math.min(passiveEWMA, aggressiveEWMA) /
                    Math.max(passiveEWMA, aggressiveEWMA);
                return Math.max(0.1, Math.min(0.9, ratio)); // Scale to reasonable consistency range
            }

            // Last resort: use spread tightness as consistency indicator
            const spreadInfo = this.getCurrentSpread();
            if (spreadInfo?.spread) {
                // Tighter spreads = higher consistency (inverted relationship)
                const normalizedSpread = Math.min(spreadInfo.spread * 100, 1); // Cap at 1%
                return Math.max(0.1, 1 - normalizedSpread);
            }

            return 0.5; // True fallback when no market data available
        }

        try {
            // Check how consistently passive liquidity is maintained
            const avgPassive = DetectorUtils.calculateMean(passiveValues);
            if (avgPassive === 0) {
                // Calculate consistency from value distribution instead
                const nonZeroValues = passiveValues.filter((v) => v > 0);
                if (nonZeroValues.length === 0) return 0.5;

                // Measure how consistently values are non-zero
                return nonZeroValues.length / passiveValues.length;
            }

            let consistentPeriods = 0;
            for (const value of passiveValues) {
                // Count periods where passive stays above 70% of average
                if (value >= avgPassive * 0.7) {
                    consistentPeriods++;
                }
            }

            const consistency = consistentPeriods / passiveValues.length;

            // Safety checks
            if (!isFinite(consistency)) return 0.5;
            return Math.max(0, Math.min(1, consistency));
        } catch (error) {
            this.logger.warn(
                `[AbsorptionDetector] Error calculating consistency: ${(error as Error).message}`
            );
            // Calculate from market spread as fallback
            const spreadInfo = this.getCurrentSpread();
            if (spreadInfo?.spread) {
                const normalizedSpread = Math.min(spreadInfo.spread * 100, 1);
                return Math.max(0.1, 1 - normalizedSpread);
            }
            return 0.5;
        }
    }

    /**
     * ✅ FIX: Proper velocity increase calculation with safety checks
     */
    private calculateVelocityIncrease(
        zone: number,
        side: "buy" | "sell",
        snapshots: ZoneSample[]
    ): number {
        if (snapshots.length < 3) {
            // Calculate velocity from current EWMA momentum instead of hardcoded default
            const currentAggressive =
                side === "buy"
                    ? this.aggrBuyEWMA.get()
                    : this.aggrSellEWMA.get();
            const currentPassive = this.passiveEWMA.get();

            if (currentAggressive > 0 && currentPassive > 0) {
                // Use current aggression vs passive ratio as velocity proxy
                const ratio = currentAggressive / currentPassive;
                // Scale ratio to velocity increase factor (0.5 to 2.0 range)
                return Math.max(0.5, Math.min(2.0, ratio));
            }

            // Use market spread momentum as velocity indicator
            const spreadInfo = this.getCurrentSpread();
            if (spreadInfo?.spread) {
                // Wider spreads = higher velocity (more volatility)
                const spreadFactor = Math.min(spreadInfo.spread * 50, 1); // Scale spread to factor
                return 1.0 + spreadFactor; // 1.0 to 2.0 range
            }

            return 1.0; // True neutral when no market data
        }

        try {
            // Calculate velocity change over time
            const recent = snapshots.slice(-3); // Last 3 snapshots
            const earlier = snapshots.slice(-6, -3); // Previous 3 snapshots

            if (recent.length < 2 || earlier.length < 2) {
                // Calculate from current momentum instead of hardcoded neutral
                const currentAggressive =
                    side === "buy"
                        ? this.aggrBuyEWMA.get()
                        : this.aggrSellEWMA.get();
                const currentPassive = this.passiveEWMA.get();

                if (currentAggressive > 0 && currentPassive > 0) {
                    const momentumRatio = currentAggressive / currentPassive;
                    return Math.max(0.5, Math.min(2.0, momentumRatio));
                }
                return 1.0; // True neutral only when no data available
            }

            // Calculate velocity for recent period
            const recentVelocity = this.calculatePeriodVelocity(recent, side);
            const earlierVelocity = this.calculatePeriodVelocity(earlier, side);

            // Return velocity increase ratio with safety checks
            if (earlierVelocity <= 0) {
                // Use recent velocity as increase indicator instead of hardcoded 1.0
                return recentVelocity > 0
                    ? Math.max(1.0, Math.min(2.0, recentVelocity))
                    : 1.0;
            }

            const velocityRatio = recentVelocity / earlierVelocity;

            // Safety checks and bounds
            if (!isFinite(velocityRatio)) {
                // Calculate from recent velocity instead of hardcoded 1.0
                return recentVelocity > 0
                    ? Math.max(1.0, Math.min(2.0, recentVelocity))
                    : 1.0;
            }
            return Math.max(0.1, Math.min(10, velocityRatio)); // Reasonable bounds
        } catch (error) {
            this.logger.warn(
                `[AbsorptionDetector] Error calculating velocity increase: ${(error as Error).message}`
            );
            // Calculate fallback from current market state instead of hardcoded 1.0
            const currentAggressive =
                side === "buy"
                    ? this.aggrBuyEWMA.get()
                    : this.aggrSellEWMA.get();
            const currentPassive = this.passiveEWMA.get();

            if (currentAggressive > 0 && currentPassive > 0) {
                const ratio = currentAggressive / currentPassive;
                return Math.max(0.5, Math.min(2.0, ratio));
            }

            return 1.0; // True safe default when no market data
        }
    }

    /**
     * ✅ FIX: Enhanced period velocity calculation with safety checks
     */
    private calculatePeriodVelocity(
        snapshots: ZoneSample[],
        side: "buy" | "sell"
    ): number {
        if (snapshots.length < 2) return 0;

        try {
            const relevantSide = side === "buy" ? "ask" : "bid";
            let totalVelocity = 0;
            let validPeriods = 0;

            for (let i = 1; i < snapshots.length; i++) {
                const current = snapshots[i];
                const previous = snapshots[i - 1];
                const timeDelta = current.timestamp - previous.timestamp;

                if (timeDelta > 0) {
                    const volumeChange = Math.abs(
                        current[relevantSide] - previous[relevantSide]
                    );
                    const velocity = volumeChange / (timeDelta / 1000); // per second

                    if (isFinite(velocity)) {
                        totalVelocity += velocity;
                        validPeriods++;
                    }
                }
            }

            const avgVelocity =
                validPeriods > 0 ? totalVelocity / validPeriods : 0;
            return isFinite(avgVelocity) ? avgVelocity : 0;
        } catch (error) {
            this.logger.warn(
                `[AbsorptionDetector] Error calculating period velocity: ${(error as Error).message}`
            );
            return 0;
        }
    }

    /**
     * ✅ FIX: Add validation to ensure all required fields are present
     */

    /**
     * ✅ FIX: Enhanced default conditions with all required fields
     */
    private getDefaultConditions(): AbsorptionConditions {
        // Calculate real-time defaults from current market state instead of hardcoded values
        const currentPassive = this.passiveEWMA.get();
        const currentAggressive = this.aggressiveEWMA.get();
        const spreadInfo = this.getCurrentSpread();

        // Calculate consistency from EWMA stability
        let calculatedConsistency = 0.5;
        if (currentPassive > 0 && currentAggressive > 0) {
            const ratio =
                Math.min(currentPassive, currentAggressive) /
                Math.max(currentPassive, currentAggressive);
            calculatedConsistency = Math.max(0.1, Math.min(0.9, ratio));
        } else if (spreadInfo?.spread) {
            const normalizedSpread = Math.min(spreadInfo.spread * 100, 1);
            calculatedConsistency = Math.max(0.1, 1 - normalizedSpread);
        }

        // Calculate velocity from current momentum
        let calculatedVelocity = 1.0;
        if (currentAggressive > 0 && currentPassive > 0) {
            const momentumRatio = currentAggressive / currentPassive;
            calculatedVelocity = Math.max(0.5, Math.min(2.0, momentumRatio));
        } else if (spreadInfo?.spread) {
            const spreadFactor = Math.min(spreadInfo.spread * 50, 1);
            calculatedVelocity = 1.0 + spreadFactor;
        }

        // Use real spread or calculate reasonable estimate
        const calculatedSpread =
            spreadInfo?.spread ??
            (currentPassive > 0 ? Math.min(0.01, 100 / currentPassive) : 0.002);

        return {
            absorptionRatio:
                currentPassive > 0 ? currentAggressive / currentPassive : 1,
            passiveStrength: 0,
            hasRefill: false,
            icebergSignal: 0,
            liquidityGradient: 0,
            absorptionVelocity: 0,
            currentPassive: currentPassive,
            avgPassive: currentPassive,
            maxPassive: currentPassive,
            minPassive: currentPassive,
            aggressiveVolume: currentAggressive,
            imbalance:
                currentPassive > 0 && currentAggressive > 0
                    ? Math.abs(currentAggressive - currentPassive) /
                      (currentAggressive + currentPassive)
                    : 0,
            sampleCount: 0,
            dominantSide:
                currentAggressive > currentPassive
                    ? "ask"
                    : currentPassive > currentAggressive
                      ? "bid"
                      : "neutral",
            consistency: calculatedConsistency,
            velocityIncrease: calculatedVelocity,
            spread: calculatedSpread,
            microstructure: undefined,
        };
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

    /**
     * Calculate expected price movement based on volume pressure
     */
    private calculateExpectedMovement(
        aggressiveVolume: number,
        passiveVolume: number
    ): number {
        if (passiveVolume === 0) return 0;

        const volumeRatio = aggressiveVolume / passiveVolume;
        const tickSize = Math.pow(10, -this.pricePrecision);

        // Simple heuristic: more volume pressure = more expected movement
        return volumeRatio * tickSize * 5; // Scaling factor
    }
}
