// src/indicators/exhaustionDetector.ts
import { BaseDetector, ZoneSample } from "./base/baseDetector.js";
import type { ILogger } from "../infrastructure/loggerInterface.js";
import { MetricsCollector } from "../infrastructure/metricsCollector.js";
import { ISignalLogger } from "../infrastructure/signalLoggerInterface.js";
import { RollingWindow } from "../utils/rollingWindow.js";
import { DetectorUtils } from "./base/detectorUtils.js";
import { SpoofingDetector } from "../services/spoofingDetector.js";
import { SharedPools } from "../utils/objectPool.js";
import { AdaptiveThresholds, MarketRegime } from "./marketRegimeDetector.js";

import type {
    EnrichedTradeEvent,
    AggressiveTrade,
} from "../types/marketEvents.js";
import type {
    IExhaustionDetector,
    DetectorCallback,
    BaseDetectorSettings,
    ExhaustionFeatures,
} from "./interfaces/detectorInterfaces.js";
import { SignalType, ExhaustionSignalData } from "../types/signalTypes.js";
import { DepthLevel } from "../utils/interfaces.js";

export interface ExhaustionSettings extends BaseDetectorSettings {
    features?: ExhaustionFeatures;
    // Exhaustion-specific settings
    exhaustionThreshold?: number; // Minimum exhaustion score (0-1)
    maxPassiveRatio?: number; // Max ratio of current/avg passive for exhaustion
    minDepletionFactor?: number; // Min factor for passive depletion detection
}

type DetectorResult<T> =
    | { success: true; data: T }
    | { success: false; error: Error; fallbackSafe: boolean };

/**
 * Conditions analyzed for exhaustion detection
 */
interface ExhaustionConditions {
    aggressiveVolume: number;
    currentPassive: number;
    avgPassive: number;
    minPassive: number;
    maxPassive: number;
    avgLiquidity: number;
    passiveRatio: number; // current/avg passive
    depletionRatio: number; // aggressive/avg passive
    refillGap: number; // change in passive over window
    imbalance: number; // bid/ask imbalance
    spread: number; // current spread ratio
    passiveVelocity: number; // rate of passive change
    sampleCount: number; // number of samples used
    isValid: boolean;
    confidence: number; // 0-1 confidence in the data
    dataQuality: "high" | "medium" | "low" | "insufficient";
    // Additional fields for consistency with absorption detector
    absorptionRatio: number; // alias for depletionRatio for compatibility
    passiveStrength: number; // alias for passiveRatio for compatibility
    consistency: number; // how consistently passive is maintained
    velocityIncrease: number; // velocity change over time
    dominantSide: "buy" | "sell" | "neutral"; // which side is dominant
    hasRefill: boolean; // whether passive refill was detected
    icebergSignal: number; // iceberg detection score (0-1)
    liquidityGradient: number; // liquidity gradient around zone
}

/**
 * Exhaustion detector – identifies when one side of the orderbook is depleted.
 * Production-ready with enhanced error handling, metrics, and configuration.
 */
export class ExhaustionDetector
    extends BaseDetector
    implements IExhaustionDetector
{
    protected readonly detectorType = "exhaustion" as const;
    protected readonly features: ExhaustionFeatures;

    // Add circuit breaker state
    private errorCount = 0;
    private lastErrorTime = 0;
    private readonly maxErrors = 5;
    private readonly errorWindowMs = 60000; // 1 minute
    private isCircuitOpen = false;

    // Exhaustion-specific configuration
    private readonly exhaustionThreshold: number;
    private readonly maxPassiveRatio: number;
    private readonly minDepletionFactor: number;

    constructor(
        id: string,
        callback: DetectorCallback,
        settings: ExhaustionSettings = {},
        logger: ILogger,
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

        // Initialize exhaustion-specific settings
        this.exhaustionThreshold = settings.exhaustionThreshold ?? 0.7;
        this.maxPassiveRatio = settings.maxPassiveRatio ?? 0.3;
        this.minDepletionFactor = settings.minDepletionFactor ?? 0.5;

        // Merge exhaustion-specific features
        this.features = {
            depletionTracking: true,
            spreadAdjustment: true,
            volumeVelocity: false,
            ...settings.features,
        };

        // NEW: Set up periodic threshold updates
        setInterval(() => this.updateThresholds(), this.updateIntervalMs);

        //TODO debuG
        this.isCircuitOpen = false;
        this.errorCount = 0;

        // Enable debug mode after data accumulates
        setTimeout(() => {
            this.logger.info(`[ExhaustionDetector] 🔧 FORCING DEBUG TEST`);
            this.testExhaustionCalculation();
        }, 10000);
    }

    protected getSignalType(): SignalType {
        return "exhaustion";
    }

    /* ------------------------------------------------------------------ */
    /*  Incoming enriched trade                                           */
    /* ------------------------------------------------------------------ */
    public onEnrichedTrade(event: EnrichedTradeEvent): void {
        // Debug: Log every trade to verify detector is receiving data
        if (Math.random() < 0.01) {
            // Log 1% of trades to avoid spam
            this.logger?.info(`[ExhaustionDetector] 🔍 RECEIVING TRADE`, {
                price: event.price,
                quantity: event.quantity,
                side: event.buyerIsMaker ? "sell" : "buy",
                timestamp: new Date(event.timestamp).toISOString(),
                totalTradesReceived: this.trades.length + 1,
            });
        }

        const zone = this.calculateZone(event.price);

        // create window if absent
        if (!this.zonePassiveHistory.has(zone)) {
            this.zonePassiveHistory.set(
                zone,
                new RollingWindow<ZoneSample>(100, false)
            );
        }
        const zoneHistory = this.zonePassiveHistory.get(zone)!;

        // duplicate-snapshot guard
        const lastSnap =
            zoneHistory.count() > 0 ? zoneHistory.toArray().at(-1)! : null;

        // Use object pool to reduce GC pressure
        const snap = SharedPools.getInstance().zoneSamples.acquire();
        snap.bid = event.zonePassiveBidVolume;
        snap.ask = event.zonePassiveAskVolume;
        snap.total = event.zonePassiveBidVolume + event.zonePassiveAskVolume;
        snap.timestamp = event.timestamp;

        const spread = this.getCurrentSpread()?.spread ?? 0;
        this.adaptiveThresholdCalculator.updateMarketData(
            event.price,
            event.quantity,
            spread
        );

        if (
            !lastSnap ||
            lastSnap.bid !== snap.bid ||
            lastSnap.ask !== snap.ask
        ) {
            // Use pool-aware push to handle evicted objects
            this.pushToZoneHistoryWithPoolCleanup(zoneHistory, snap);
        } else {
            // Release snapshot back to pool if not used
            SharedPools.getInstance().zoneSamples.release(snap);
        }

        // add trade exactly once
        if (this.lastTradeId !== event.tradeId) {
            this.lastTradeId = event.tradeId;
            this.addTrade(event); // EnrichedTradeEvent extends AggressiveTrade
        }
    }

    private calculateExhaustionScore(conditions: ExhaustionConditions): number {
        // NEW: Update thresholds if needed
        this.maybeUpdateThresholds();

        let score = 0;
        const thresholds = this.getAdaptiveThresholds(); // NEW: Use adaptive thresholds

        // Factor 1: Adaptive depletion ratio (CHANGED from hardcoded values)
        if (conditions.depletionRatio > thresholds.depletionLevels.extreme) {
            score += thresholds.scores.extreme;
        } else if (
            conditions.depletionRatio > thresholds.depletionLevels.high
        ) {
            score += thresholds.scores.high;
        } else if (
            conditions.depletionRatio > thresholds.depletionLevels.moderate
        ) {
            score += thresholds.scores.moderate;
        }

        // Factor 2: Adaptive passive strength (CHANGED from hardcoded values)
        if (
            conditions.passiveRatio <
            thresholds.passiveRatioLevels.severeDepletion
        ) {
            score += 0.25; // Severely depleted
        } else if (
            conditions.passiveRatio <
            thresholds.passiveRatioLevels.moderateDepletion
        ) {
            score += 0.15; // Moderately depleted
        } else if (
            conditions.passiveRatio <
            thresholds.passiveRatioLevels.someDepletion
        ) {
            score += 0.1; // Somewhat depleted
        }

        // Factor 3: Continuous depletion (adaptive to volatility) - CHANGED
        const depletionThreshold =
            thresholds.depletionLevels.moderate * conditions.avgPassive * 0.5;
        if (conditions.refillGap < -depletionThreshold) {
            score += 0.15;
        } else if (conditions.refillGap < 0) {
            score += 0.1;
        }

        // Factor 4-6: Keep existing logic for imbalance, spread, velocity (UNCHANGED)
        if (conditions.imbalance > 0.8) score += 0.1;
        else if (conditions.imbalance > 0.6) score += 0.05;

        if (this.features.spreadAdjustment) {
            if (conditions.spread > 0.005) score += 0.05;
            else if (conditions.spread > 0.002) score += 0.03;
        }

        if (this.features.volumeVelocity && conditions.passiveVelocity < -100) {
            score += 0.05;
        }

        // Penalty for insufficient data (UNCHANGED)
        if (conditions.sampleCount < 5) {
            score *= 0.7;
        }

        // NEW: Apply minimum confidence threshold
        const finalScore = Math.max(0, Math.min(1, score));
        return finalScore >= thresholds.minimumConfidence ? finalScore : 0;
    }

    /**
     * Maybe update thresholds based on time or performance
     */
    private maybeUpdateThresholds(): void {
        const now = Date.now();
        if (now - this.lastThresholdUpdate > this.updateIntervalMs) {
            this.updateThresholds();
        }
    }

    /**
     * Update adaptive thresholds
     */
    private updateThresholds(): void {
        const oldThresholds = this.getAdaptiveThresholds();

        this.updateAdaptiveThresholds(); // Use BaseDetector method

        // Log significant threshold changes
        const newThresholds = this.getAdaptiveThresholds();
        if (this.hasSignificantChange(oldThresholds, newThresholds)) {
            this.logger?.info("[ExhaustionDetector] Thresholds adapted", {
                old: oldThresholds,
                new: newThresholds,
                timestamp: new Date().toISOString(),
            });
        }
    }

    /**
     * Check if threshold changes are significant
     */
    private hasSignificantChange(
        old: AdaptiveThresholds,
        current: AdaptiveThresholds
    ): boolean {
        const threshold = 0.1; // 10% change threshold

        return (
            Math.abs(
                old.depletionLevels.extreme - current.depletionLevels.extreme
            ) /
                old.depletionLevels.extreme >
                threshold ||
            Math.abs(old.scores.extreme - current.scores.extreme) /
                old.scores.extreme >
                threshold ||
            Math.abs(old.minimumConfidence - current.minimumConfidence) /
                old.minimumConfidence >
                threshold
        );
    }

    /**
     * Exhaustion-specific trade handling (called by base class)
     */
    protected onEnrichedTradeSpecific(event: EnrichedTradeEvent): void {
        void event;
    }

    /**
     * Main detection loop for exhaustion patterns
     */
    protected checkForSignal(triggerTrade: AggressiveTrade): void {
        // Debug: Log every signal check to verify method is being called
        this.logger?.info(`[ExhaustionDetector] 🔍 SIGNAL CHECK TRIGGERED`, {
            triggerPrice: triggerTrade.price,
            triggerSide: this.getTradeSide(triggerTrade),
            tradesInBuffer: this.trades.length,
            zoneAggregations: this.zoneAgg.size,
            timestamp: new Date(triggerTrade.timestamp).toISOString(),
        });

        const now = Date.now();
        const zoneTicks = this.getEffectiveZoneTicks();

        try {
            // Get recent trades within window
            const recentTrades = this.trades.filter(
                (t) => now - t.timestamp < this.windowMs
            );

            if (recentTrades.length === 0) {
                return;
            }

            // Group trades by zones for analysis
            const zoneMap = this.groupTradesByZone(recentTrades, zoneTicks);

            // Analyze each zone for exhaustion patterns
            for (const [zone, tradesAtZone] of zoneMap) {
                if (tradesAtZone.length === 0) continue;

                this.analyzeZoneForExhaustion(
                    zone,
                    tradesAtZone,
                    triggerTrade,
                    zoneTicks
                );
            }

            // Record detection attempt metrics
            this.metricsCollector.incrementMetric(
                "exhaustionDetectionAttempts"
            );
            //this.metricsCollector.recordGauge('exhaustion.zones.analyzed', zoneMap.size);
        } catch (error) {
            this.handleError(
                error as Error,
                "ExhaustionDetector.checkForSignal"
            );
            this.metricsCollector.incrementMetric("exhaustionDetectionErrors");
        }
    }

    /**
     * Analyze a specific zone for exhaustion patterns
     */
    private analyzeZoneForExhaustion(
        zone: number,
        tradesAtZone: AggressiveTrade[],
        triggerTrade: AggressiveTrade,
        zoneTicks: number
    ): void {
        const latestTrade = tradesAtZone[tradesAtZone.length - 1];
        const price = +latestTrade.price.toFixed(this.pricePrecision);
        const side = this.getTradeSide(latestTrade);

        // 🔍 DEBUG: Log analysis start
        this.logger.info(`[ExhaustionDetector] Zone analysis started`, {
            zone,
            price,
            side,
            tradesCount: tradesAtZone.length,
            latestTradeTime: new Date(latestTrade.timestamp).toISOString(),
            circuitBreakerOpen: this.isCircuitOpen,
            errorCount: this.errorCount,
        });

        // Get current book level
        const bookLevel = this.getBookLevel(price, zone, side);
        if (!bookLevel) {
            this.logger.info(
                `[ExhaustionDetector] No passive volume data for zone`,
                {
                    zone,
                    price,
                    side,
                    zoneHistorySize:
                        this.zonePassiveHistory.get(zone)?.count() || 0,
                }
            );
            return;
        }

        this.logger.info(`[ExhaustionDetector] ✅ FOUND BOOK LEVEL DATA`, {
            zone,
            price,
            side,
            bookLevel: { bid: bookLevel.bid, ask: bookLevel.ask },
        });

        // Check cooldown to prevent spam (update after confirmation)
        if (!this.checkCooldown(zone, side, false)) {
            this.logger.info(`[ExhaustionDetector] Cooldown active`, {
                zone,
                price,
                side,
            });
            return;
        }

        // 🔍 DEBUG: Log before conditions analysis
        this.logger.info(`[ExhaustionDetector] Starting conditions analysis`, {
            zone,
            price,
            side,
            zoneHistorySize: this.zonePassiveHistory.get(zone)?.count() || 0,
            windowMs: this.windowMs,
        });

        // Analyze exhaustion conditions
        const conditionsResult = this.analyzeExhaustionConditionsSafe(
            price,
            side,
            zone
        );

        // 🔍 DEBUG: Log conditions result
        if (!conditionsResult.success) {
            this.logger.info(
                `[ExhaustionDetector] ❌ CONDITIONS ANALYSIS FAILED`,
                {
                    zone,
                    price,
                    side,
                    error: conditionsResult.error.message,
                    fallbackSafe: conditionsResult.fallbackSafe,
                    errorType: conditionsResult.error.constructor.name,
                }
            );

            // Handle error appropriately based on type
            if (conditionsResult.fallbackSafe) {
                this.logger.debug(
                    `[ExhaustionDetector] Skipping analysis: ${conditionsResult.error.message}`
                );
                return;
            } else {
                this.pauseDetectorTemporarily(conditionsResult.error);
                return;
            }
        }

        const conditions = conditionsResult.data;

        // 🔍 DEBUG: Log successful conditions
        this.logger.info(
            `[ExhaustionDetector] ✅ CONDITIONS ANALYSIS SUCCESS`,
            {
                zone,
                price,
                side,
                conditions: {
                    depletionRatio: conditions.depletionRatio,
                    passiveRatio: conditions.passiveRatio,
                    aggressiveVolume: conditions.aggressiveVolume,
                    avgPassive: conditions.avgPassive,
                    consistency: conditions.consistency,
                    velocityIncrease: conditions.velocityIncrease,
                    sampleCount: conditions.sampleCount,
                    confidence: conditions.confidence,
                    dataQuality: conditions.dataQuality,
                    isValid: conditions.isValid,
                },
            }
        );
        if (conditions.dataQuality === "insufficient") {
            // 🔧 FIX: Only reject if confidence is extremely low
            if (conditions.confidence < 0.1) {
                this.logger.info(`[ExhaustionDetector] Data quality too low`, {
                    quality: conditions.dataQuality,
                    confidence: conditions.confidence,
                    zone,
                    price,
                    side,
                });
                return;
            } else {
                this.logger.info(
                    `[ExhaustionDetector] ⚠️ Low data quality but proceeding due to reasonable confidence`,
                    {
                        quality: conditions.dataQuality,
                        confidence: conditions.confidence,
                    }
                );
            }
        }

        // 🔍 DEBUG: Log before score calculation
        this.logger.info(`[ExhaustionDetector] 📊 STARTING SCORE CALCULATION`, {
            zone,
            price,
            side,
            currentThresholds: this.getAdaptiveThresholds(),
        });

        // Calculate score with confidence adjustment
        const baseScore = this.calculateExhaustionScore(conditions);
        const adjustedScore = baseScore * conditions.confidence;

        this.logger.info(`[ExhaustionDetector] Conditions analyzed`, {
            zone,
            price,
            side,
            baseScore,
            adjustedScore,
            threshold: this.exhaustionThreshold,
            conditions: {
                depletionRatio: conditions.depletionRatio,
                passiveRatio: conditions.passiveRatio,
                aggressiveVolume: conditions.aggressiveVolume,
                avgPassive: conditions.avgPassive,
                consistency: conditions.consistency,
                velocityIncrease: conditions.velocityIncrease,
                sampleCount: conditions.sampleCount,
                confidence: conditions.confidence,
                dataQuality: conditions.dataQuality,
            },
        });

        // Apply stricter threshold for low-quality data
        const effectiveThreshold =
            conditions.dataQuality === "low"
                ? this.exhaustionThreshold * 1.2
                : this.exhaustionThreshold;

        if (adjustedScore < effectiveThreshold) {
            this.logger.info(
                `[ExhaustionDetector] Signal rejected - score below threshold`,
                {
                    zone,
                    price,
                    side,
                    adjustedScore,
                    effectiveThreshold,
                    baseScore,
                    confidence: conditions.confidence,
                    dataQuality: conditions.dataQuality,
                    deficit: effectiveThreshold - adjustedScore,
                }
            );
            return;
        }

        // Calculate zone volumes
        const volumes = this.calculateZoneVolumes(
            zone,
            tradesAtZone,
            zoneTicks
        );

        this.logger.info(`[ExhaustionDetector] Volume analysis`, {
            zone,
            price,
            side,
            aggressive: volumes.aggressive,
            passive: volumes.passive,
            minRequired: this.minAggVolume,
            passesVolumeCheck: volumes.aggressive >= this.minAggVolume,
        });

        // Skip if insufficient volume
        if (volumes.aggressive < this.minAggVolume) {
            this.logger.info(
                `[ExhaustionDetector] Signal rejected - insufficient volume`,
                {
                    zone,
                    price,
                    side,
                    aggressive: volumes.aggressive,
                    required: this.minAggVolume,
                    deficit: this.minAggVolume - volumes.aggressive,
                }
            );
            return;
        }

        // Check for spoofing if enabled (includes layering detection)
        if (
            this.features.spoofingDetection &&
            (this.isSpoofed(price, side, triggerTrade.timestamp) ||
                this.detectLayeringAttack(price, side, triggerTrade.timestamp))
        ) {
            this.logger.info(
                `[ExhaustionDetector] Signal rejected - spoofing detected`,
                {
                    zone,
                    price,
                    side,
                }
            );
            this.metricsCollector.incrementMetric("exhaustionSpoofingRejected");
            return;
        }

        // Check for refill
        const oppositeQty = side === "buy" ? bookLevel.ask : bookLevel.bid;
        const refilled = this.checkRefill(price, side, oppositeQty);

        if (refilled) {
            this.logger.info(
                `[ExhaustionDetector] Signal rejected - refill detected`,
                {
                    zone,
                    price,
                    side,
                    oppositeQty,
                }
            );
            this.metricsCollector.incrementMetric("exhaustionRefillRejected");
            return;
        }

        this.logger.info(`[ExhaustionDetector] 🎯 SIGNAL GENERATED!`, {
            zone,
            price,
            side,
            aggressive: volumes.aggressive,
            passive: volumes.passive,
            oppositeQty,
            baseScore,
            adjustedScore,
            confidence: conditions.confidence,
            conditions: {
                depletionRatio: conditions.depletionRatio,
                passiveRatio: conditions.passiveRatio,
                consistency: conditions.consistency,
                velocityIncrease: conditions.velocityIncrease,
                hasRefill: conditions.hasRefill,
                icebergSignal: conditions.icebergSignal,
            },
        });

        const signal: ExhaustionSignalData = {
            price,
            side,
            aggressive: volumes.aggressive,
            oppositeQty,
            avgLiquidity: conditions.avgLiquidity,
            spread: conditions.spread,
            confidence: adjustedScore,
            meta: {
                conditions,
                detectorVersion: "2.1-safe",
                dataQuality: conditions.dataQuality,
                originalConfidence: baseScore,
            },
        };

        this.handleDetection(signal);

        this.metricsCollector.updateMetric(
            `detector_${this.detectorType}Aggressive_volume`,
            signal.aggressive
        );
        this.metricsCollector.incrementMetric("exhaustionSignalsGenerated");
        this.metricsCollector.recordHistogram(
            "exhaustion.score",
            adjustedScore
        );
    }

    private findNearestPriceLevels(
        targetPrice: number,
        maxResults: number = 5
    ): number[] {
        const allPrices = Array.from(this.depth.keys())
            .filter((p) => typeof p === "number" && isFinite(p))
            .sort(
                (a, b) => Math.abs(a - targetPrice) - Math.abs(b - targetPrice)
            );

        return allPrices.slice(0, maxResults);
    }

    private getBookLevelFromZoneHistory(zone: number): DepthLevel | undefined {
        const zoneHistory = this.zonePassiveHistory.get(zone);
        if (!zoneHistory || zoneHistory.count() === 0) {
            return undefined; // ✅ Return undefined instead of null
        }

        const latestSnapshot = zoneHistory.toArray().at(-1);
        if (!latestSnapshot) {
            return undefined; // ✅ Return undefined instead of null
        }

        // ✅ Return proper DepthLevel object
        return {
            bid: latestSnapshot.bid,
            ask: latestSnapshot.ask,
        } as DepthLevel; // ✅ Cast to DepthLevel type
    }

    private getBookLevelFromRecentTrade(zone: number): DepthLevel | undefined {
        // Find recent trades in this zone
        const now = Date.now();
        const recentTrades = this.trades.filter((trade) => {
            const tradeZone = this.calculateZone(trade.price);
            return tradeZone === zone && now - trade.timestamp < 30000; // Last 30 seconds
        });

        if (recentTrades.length === 0) {
            return undefined;
        }

        // Get the most recent trade
        const latestTrade = recentTrades[recentTrades.length - 1];

        // If it's an EnrichedTradeEvent, it should have passive volume data
        if (
            "zonePassiveBidVolume" in latestTrade &&
            "zonePassiveAskVolume" in latestTrade
        ) {
            const enrichedTrade = latestTrade as EnrichedTradeEvent;
            return {
                bid: enrichedTrade.zonePassiveBidVolume,
                ask: enrichedTrade.zonePassiveAskVolume,
            };
        }

        return undefined;
    }

    private getBookLevel(
        price: number,
        zone: number,
        side: "buy" | "sell"
    ): { bid: number; ask: number } | null {
        // Method 1: Try this.depth (if it gets populated later)
        let bookLevel = this.depth.get(price);
        if (bookLevel && (bookLevel.bid > 0 || bookLevel.ask > 0)) {
            this.logger.debug(
                `[ExhaustionDetector] Book level from depth map`,
                { price, bookLevel }
            );
            return bookLevel;
        }

        // Method 2: Use zone passive history (current working data)
        bookLevel = this.getBookLevelFromZoneHistory(zone);
        if (bookLevel && (bookLevel.bid > 0 || bookLevel.ask > 0)) {
            this.logger.debug(
                `[ExhaustionDetector] Book level from zone history`,
                { zone, bookLevel }
            );
            return bookLevel;
        }

        // Method 3: Try recent enriched trade data
        bookLevel = this.getBookLevelFromRecentTrade(zone);
        if (bookLevel && (bookLevel.bid > 0 || bookLevel.ask > 0)) {
            this.logger.debug(
                `[ExhaustionDetector] Book level from recent trade`,
                { zone, bookLevel }
            );
            return bookLevel;
        }

        // No book level data available
        this.logger.debug(`[ExhaustionDetector] No book level data available`, {
            price,
            zone,
            side,
            zoneHistorySize: this.zonePassiveHistory.get(zone)?.count() || 0,
        });

        return null;
    }

    protected handleDetection(signal: ExhaustionSignalData): void {
        this.recentSignalCount++; // NEW: Track signal count

        // NEW: Add adaptive threshold info to signal metadata
        signal.meta = {
            ...signal.meta,
            adaptiveThresholds: this.getAdaptiveThresholds(),
            thresholdVersion: "adaptive-v1.0",
        };

        this.metricsCollector.updateMetric(
            `detector_${this.detectorType}Aggressive_volume`,
            signal.aggressive
        );
        this.metricsCollector.incrementMetric("exhaustionSignalsGenerated");
        this.metricsCollector.recordHistogram(
            "exhaustion.score",
            signal.confidence
        );

        // Call parent handleDetection
        super.handleDetection(signal);
    }

    /**
     * Record signal performance for learning
     */
    public recordSignalResult(signalId: string, profitable: boolean): void {
        // Convert boolean to numerical performance score
        const performance = profitable ? 1.0 : 0.0;
        this.recordSignalPerformance(signalId, performance);
    }

    /**
     * Get current threshold information for monitoring
     */
    public getThresholdStatus(): {
        current: AdaptiveThresholds;
        recentSignals: number;
        lastUpdated: Date;
        performanceByRegime: Map<string, number>;
    } {
        return {
            current: this.getAdaptiveThresholds(),
            recentSignals: this.recentSignalCount,
            lastUpdated: new Date(this.lastThresholdUpdate),
            performanceByRegime: new Map(this.performanceHistory),
        };
    }

    /**
     * Manually trigger threshold update (for testing or immediate adaptation)
     */
    public forceThresholdUpdate(): void {
        this.updateThresholds();
    }

    /**
     * Get current market regime (for debugging/monitoring)
     */
    public getCurrentMarketRegime(): MarketRegime {
        return this.adaptiveThresholdCalculator.detectCurrentRegime();
    }

    /**
     * Validate input parameters
     */
    private validateInputs(
        price: number,
        side: "buy" | "sell",
        zone: number
    ): boolean {
        if (!isFinite(price) || price <= 0) return false;
        if (side !== "buy" && side !== "sell") return false;
        if (!isFinite(zone)) return false;
        return true;
    }

    /**
     * Get and validate historical data
     */
    private getValidatedHistoricalData(
        price: number,
        side: "buy" | "sell",
        zone: number
    ): DetectorResult<{
        avgLiquidity: number;
        spreadInfo: { spread: number } | null;
        recentAggressive: number;
        samples: ZoneSample[];
    }> {
        try {
            const avgLiquidity =
                this.passiveVolumeTracker.getAveragePassiveBySide(
                    price,
                    side === "buy" ? "sell" : "buy",
                    this.windowMs
                );

            if (!isFinite(avgLiquidity) || avgLiquidity < 0) {
                return {
                    success: false,
                    error: new Error("Invalid average liquidity data"),
                    fallbackSafe: true,
                };
            }

            const spreadInfo = this.getCurrentSpread();
            const recentAggressive = this.getAggressiveVolumeAtPrice(
                price,
                5000
            );

            if (!isFinite(recentAggressive) || recentAggressive < 0) {
                return {
                    success: false,
                    error: new Error("Invalid aggressive volume data"),
                    fallbackSafe: true,
                };
            }

            // Get zone passive history
            const zoneHistory = this.zonePassiveHistory.get(zone);
            const now = Date.now();
            const samples = zoneHistory
                ? zoneHistory
                      .toArray()
                      .filter((s) => now - s.timestamp < this.windowMs)
                      .filter((s) => this.isValidSample(s))
                : [];

            return {
                success: true,
                data: { avgLiquidity, spreadInfo, recentAggressive, samples },
            };
        } catch (error) {
            return {
                success: false,
                error: error as Error,
                fallbackSafe: false,
            };
        }
    }

    /**
     * Assess data quality for decision making
     */
    private assessDataQuality(
        samples: ZoneSample[],
        avgLiquidity: number,
        recentAggressive: number
    ): "high" | "medium" | "low" | "insufficient" {
        this.logger.info(`[ExhaustionDetector] 📊 Assessing data quality`, {
            samplesCount: samples.length,
            avgLiquidity,
            recentAggressive,
        });

        // 🔧 FIX: Be less strict about "insufficient"
        if (samples.length === 0) return "insufficient";

        // 🔧 FIX: Allow analysis with minimal data
        if (
            samples.length === 1 &&
            (avgLiquidity > 0 || recentAggressive > 0)
        ) {
            return "low"; // Changed from "insufficient" to "low"
        }

        const dataAge =
            samples.length > 0 ? Date.now() - samples[0].timestamp : Infinity;
        const sampleCount = samples.length;

        this.logger.info(`[ExhaustionDetector] 📊 Data quality factors`, {
            sampleCount,
            dataAge,
            dataAgeSeconds: dataAge / 1000,
        });

        // 🔧 FIX: More lenient thresholds
        if (sampleCount >= 8 && dataAge < 45000) return "high"; // Relaxed from 10 samples & 30s
        if (sampleCount >= 3 && dataAge < 90000) return "medium"; // Relaxed from 5 samples & 60s
        if (sampleCount >= 1) return "low"; // Relaxed from 2 samples

        return "insufficient";
    }

    public testExhaustionCalculation(): void {
        this.logger.info(
            `[ExhaustionDetector] 🧪 TESTING EXHAUSTION CALCULATION`
        );

        // Test with zones that have actual data
        let testCount = 0;
        for (const [zone, bucket] of this.zoneAgg) {
            if (bucket.trades.length > 0 && testCount < 3) {
                const latestTrade = bucket.trades[bucket.trades.length - 1];
                const price = +latestTrade.price.toFixed(this.pricePrecision);
                const side = this.getTradeSide(latestTrade);

                this.logger.info(
                    `[ExhaustionDetector] 🧪 Testing zone ${zone}`,
                    {
                        price,
                        side,
                        tradesCount: bucket.trades.length,
                    }
                );

                // Force the analysis to run with debug logging
                this.analyzeZoneForExhaustion(
                    zone,
                    bucket.trades,
                    latestTrade,
                    this.getEffectiveZoneTicks()
                );
                testCount++;
            }
        }

        if (testCount === 0) {
            this.logger.info(
                `[ExhaustionDetector] 🧪 No zones with trades to test`
            );
        }
    }

    public resetCircuitBreaker(): void {
        this.isCircuitOpen = false;
        this.errorCount = 0;
        this.lastErrorTime = 0;

        this.logger.info(`[ExhaustionDetector] 🔄 Circuit breaker reset`, {
            errorCount: this.errorCount,
            isCircuitOpen: this.isCircuitOpen,
        });
    }

    public enableDebugMode(): void {
        this.logger.info(`[ExhaustionDetector] 🐛 ENABLING DEBUG MODE`);

        // Reset any blocking states
        this.resetCircuitBreaker();

        // Test the calculation immediately
        setTimeout(() => {
            this.testExhaustionCalculation();
        }, 2000);
    }

    /**
     * Calculate confidence in the data
     */
    private calculateDataConfidence(
        samples: ZoneSample[],
        quality: "high" | "medium" | "low" | "insufficient",
        avgLiquidity: number
    ): number {
        let confidence = 0;

        // Base confidence from data quality
        switch (quality) {
            case "high":
                confidence = 0.9;
                break;
            case "medium":
                confidence = 0.7;
                break;
            case "low":
                confidence = 0.5;
                break;
            case "insufficient":
                confidence = 0.2;
                break;
        }

        // Adjust for sample consistency
        if (samples.length > 1) {
            const variance = this.calculateVariance(
                samples.map((s) => s.total)
            );
            const consistency = Math.exp(-variance / (avgLiquidity || 1));
            confidence *= consistency;
        }

        // Adjust for data freshness
        if (samples.length > 0) {
            const latestAge = Date.now() - samples.at(-1)!.timestamp;
            const freshness = Math.exp(-latestAge / 30000); // Decay over 30 seconds
            confidence *= freshness;
        }

        return Math.max(0, Math.min(1, confidence));
    }

    /**
     * Safe ratio calculation with bounds checking
     */
    private calculateSafeRatio(
        numerator: number,
        denominator: number,
        defaultValue = 0
    ): number {
        if (!isFinite(numerator) || !isFinite(denominator)) return defaultValue;
        if (denominator === 0) return defaultValue;

        const ratio = numerator / denominator;
        if (!isFinite(ratio)) return defaultValue;

        // Clamp to reasonable bounds
        return Math.max(0, Math.min(1000, ratio));
    }

    /**
     * Safe mean calculation
     */
    private calculateSafeMean(values: number[]): number {
        if (values.length === 0) return 0;

        const validValues = values.filter((v) => isFinite(v) && v >= 0);
        if (validValues.length === 0) return 0;

        return (
            validValues.reduce((sum, val) => sum + val, 0) / validValues.length
        );
    }

    /**
     * Safe velocity calculation
     */
    private calculateSafeVelocity(samples: ZoneSample[]): number {
        if (!this.features.volumeVelocity || samples.length < 2) return 0;

        try {
            const recent = samples.slice(-5);
            const velocities: number[] = [];

            for (let i = 1; i < recent.length; i++) {
                const deltaVol = recent[i].total - recent[i - 1].total;
                const deltaTime = recent[i].timestamp - recent[i - 1].timestamp;

                if (
                    deltaTime > 0 &&
                    isFinite(deltaVol) &&
                    isFinite(deltaTime)
                ) {
                    const velocity = deltaVol / (deltaTime / 1000);
                    if (isFinite(velocity)) {
                        velocities.push(velocity);
                    }
                }
            }

            return velocities.length > 0
                ? this.calculateSafeMean(velocities)
                : 0;
        } catch {
            return 0;
        }
    }

    /**
     * Safe imbalance check with Result pattern
     */
    private checkPassiveImbalanceSafe(
        zone: number
    ): DetectorResult<{ imbalance: number; dominantSide: string }> {
        try {
            const result = this.checkPassiveImbalance(zone);

            if (!isFinite(result.imbalance)) {
                return {
                    success: false,
                    error: new Error("Invalid imbalance calculation"),
                    fallbackSafe: true,
                };
            }

            return { success: true, data: result };
        } catch (error) {
            return {
                success: false,
                error: error as Error,
                fallbackSafe: true,
            };
        }
    }

    /**
     * Validate sample data
     */
    private isValidSample(sample: ZoneSample): boolean {
        return (
            isFinite(sample.bid) &&
            isFinite(sample.ask) &&
            isFinite(sample.total) &&
            isFinite(sample.timestamp) &&
            sample.bid >= 0 &&
            sample.ask >= 0 &&
            sample.timestamp > 0
        );
    }

    /**
     * Calculate variance for consistency check
     */
    private calculateVariance(values: number[]): number {
        if (values.length < 2) return 0;

        const mean = this.calculateSafeMean(values);
        const squaredDiffs = values.map((val) => Math.pow(val - mean, 2));
        return this.calculateSafeMean(squaredDiffs);
    }

    /**
     * Handle detector errors with circuit breaker
     */
    private handleDetectorError(error: Error): void {
        const now = Date.now();

        // Reset error count if outside window
        if (now - this.lastErrorTime > this.errorWindowMs) {
            this.errorCount = 0;
        }

        this.errorCount++;
        this.lastErrorTime = now;

        // Open circuit breaker if too many errors
        if (this.errorCount >= this.maxErrors) {
            this.isCircuitOpen = true;
            this.logger.error(
                `[ExhaustionDetector] Circuit breaker opened after ${this.errorCount} errors`
            );

            // Auto-reset circuit breaker after delay
            setTimeout(() => {
                this.isCircuitOpen = false;
                this.errorCount = 0;
                this.logger.info(`[ExhaustionDetector] Circuit breaker reset`);
            }, this.errorWindowMs);
        }

        this.handleError(error, `${this.constructor.name}.detectorError`);
    }

    /**
     * Temporarily pause detector on critical errors
     */
    private pauseDetectorTemporarily(error: Error): void {
        this.logger.error(
            `[ExhaustionDetector] Pausing detector due to critical error: ${error.message}`
        );

        // Emit status change event
        this.emitStatusChange("paused", "active");

        // Auto-resume after short delay
        setTimeout(() => {
            this.logger.info(
                `[ExhaustionDetector] Resuming detector operation`
            );
            this.emitStatusChange("active", "paused");
        }, 5000); // 5 second pause
    }

    /* ------------------------------------------------------------------ */
    /*  Confidence score (0-1)                                            */
    /* ------------------------------------------------------------------ */

    /**
     * Safe analysis that returns Result type instead of dangerous defaults
     */
    private analyzeExhaustionConditionsSafe(
        price: number,
        side: "buy" | "sell",
        zone: number
    ): DetectorResult<ExhaustionConditions> {
        this.logger.info(
            `[ExhaustionDetector] 🔬 SAFE CONDITIONS ANALYSIS START`,
            {
                price,
                side,
                zone,
                circuitBreakerOpen: this.isCircuitOpen,
                errorCount: this.errorCount,
                lastErrorTime: new Date(this.lastErrorTime).toISOString(),
            }
        );

        try {
            // Check circuit breaker
            if (this.isCircuitOpen) {
                this.logger.info(
                    `[ExhaustionDetector] ❌ Circuit breaker is open`,
                    {
                        errorCount: this.errorCount,
                        timeSinceLastError: Date.now() - this.lastErrorTime,
                    }
                );
                return {
                    success: false,
                    error: new Error(
                        "Circuit breaker open - too many recent errors"
                    ),
                    fallbackSafe: true,
                };
            }

            // Validate inputs first
            if (!this.validateInputs(price, side, zone)) {
                this.logger.info(`[ExhaustionDetector] ❌ Invalid inputs`, {
                    price,
                    side,
                    zone,
                });
                return {
                    success: false,
                    error: new Error("Invalid input parameters"),
                    fallbackSafe: true,
                };
            }

            this.logger.info(`[ExhaustionDetector] ✅ Input validation passed`);

            // Get historical data with validation
            const dataResult = this.getValidatedHistoricalData(
                price,
                side,
                zone
            );
            if (!dataResult.success) {
                this.logger.info(
                    `[ExhaustionDetector] ❌ Historical data validation failed`,
                    {
                        error: dataResult.error.message,
                        fallbackSafe: dataResult.fallbackSafe,
                    }
                );
                return dataResult;
            }

            const { avgLiquidity, spreadInfo, recentAggressive, samples } =
                dataResult.data;

            this.logger.info(
                `[ExhaustionDetector] ✅ Historical data obtained`,
                {
                    avgLiquidity,
                    recentAggressive,
                    samplesCount: samples.length,
                    spreadInfo,
                }
            );

            // Validate data quality (LOOSEN THIS)
            const quality = this.assessDataQuality(
                samples,
                avgLiquidity,
                recentAggressive
            );

            // 🔧 FIX: Don't reject for insufficient quality - just flag it
            this.logger.info(
                `[ExhaustionDetector] 📊 Data quality assessment`,
                {
                    quality,
                    samplesCount: samples.length,
                    avgLiquidity,
                    recentAggressive,
                    decision:
                        quality === "insufficient"
                            ? "PROCEEDING_ANYWAY"
                            : "ACCEPTABLE",
                }
            );

            // Continue with calculation regardless of quality (we'll adjust confidence instead)

            // Calculate all metrics with bounds checking
            const currentPassive =
                samples.length > 0 ? samples.at(-1)!.total : 0;
            const avgPassive = this.calculateSafeMean(
                samples.map((s) => s.total)
            );
            const minPassive =
                samples.length > 0
                    ? Math.min(...samples.map((s) => s.total))
                    : 0;

            this.logger.info(
                `[ExhaustionDetector] 📊 Basic metrics calculated`,
                {
                    currentPassive,
                    avgPassive,
                    minPassive,
                }
            );

            // Safe ratio calculations with bounds
            const passiveRatio = this.calculateSafeRatio(
                currentPassive,
                avgPassive
            );
            const depletionRatio = this.calculateSafeRatio(
                recentAggressive,
                avgPassive
            );

            this.logger.info(`[ExhaustionDetector] 📊 Ratios calculated`, {
                passiveRatio,
                depletionRatio,
            });

            // Calculate velocity with validation
            const passiveVelocity = this.calculateSafeVelocity(samples);

            // Check passive imbalance with error handling
            const imbalanceResult = this.checkPassiveImbalanceSafe(zone);
            const imbalance = imbalanceResult.success
                ? Math.abs(imbalanceResult.data.imbalance)
                : 0;

            this.logger.info(
                `[ExhaustionDetector] 📊 Advanced metrics calculated`,
                {
                    passiveVelocity,
                    imbalance,
                    imbalanceSuccess: imbalanceResult.success,
                }
            );

            // Calculate confidence based on data quality and completeness (ADJUSTED)
            let confidence = this.calculateDataConfidence(
                samples,
                quality,
                avgLiquidity
            );

            // 🔧 FIX: Don't let confidence go too low for reasonable data
            if (samples.length > 2 && avgLiquidity > 0) {
                confidence = Math.max(0.3, confidence); // Minimum 30% confidence for any reasonable data
            }

            // Calculate additional fields for compatibility
            const maxPassive =
                samples.length > 0
                    ? Math.max(...samples.map((s) => s.total))
                    : 0;
            const consistency = this.calculateConsistency(
                samples.map((s) => s.total)
            );
            const velocityIncrease = this.calculateVelocityIncrease(samples);

            // Determine dominant side based on imbalance
            const dominantSide = imbalanceResult.success
                ? imbalanceResult.data.imbalance > 0.1
                    ? "sell"
                    : imbalanceResult.data.imbalance < -0.1
                      ? "buy"
                      : "neutral"
                : ("neutral" as const);

            // Calculate refill detection
            const hasRefill = this.detectPassiveRefill(samples);
            const icebergSignal = this.calculateIcebergSignal(samples);
            const liquidityGradient = this.calculateLiquidityGradient(
                samples,
                avgLiquidity
            );

            this.logger.info(`[ExhaustionDetector] 📊 All metrics calculated`, {
                maxPassive,
                consistency,
                velocityIncrease,
                dominantSide,
                hasRefill,
                icebergSignal,
                liquidityGradient,
            });

            const conditions: ExhaustionConditions = {
                aggressiveVolume: recentAggressive,
                currentPassive,
                avgPassive,
                minPassive,
                maxPassive,
                avgLiquidity,
                passiveRatio,
                depletionRatio,
                refillGap:
                    samples.length > 1
                        ? samples.at(-1)!.total - samples[0].total
                        : 0,
                imbalance,
                spread: spreadInfo?.spread ?? 0,
                passiveVelocity,
                sampleCount: samples.length,
                isValid: true,
                confidence,
                dataQuality: quality,
                // Additional fields for compatibility
                absorptionRatio: depletionRatio, // alias for compatibility
                passiveStrength: passiveRatio, // alias for compatibility
                consistency,
                velocityIncrease,
                dominantSide,
                hasRefill,
                icebergSignal,
                liquidityGradient,
            };

            this.logger.info(
                `[ExhaustionDetector] ✅ CONDITIONS FULLY CALCULATED`,
                {
                    zone,
                    price,
                    side,
                    finalConditions: {
                        depletionRatio: conditions.depletionRatio,
                        passiveRatio: conditions.passiveRatio,
                        confidence: conditions.confidence,
                        dataQuality: conditions.dataQuality,
                        sampleCount: conditions.sampleCount,
                        aggressiveVolume: conditions.aggressiveVolume,
                        avgPassive: conditions.avgPassive,
                    },
                }
            );

            return { success: true, data: conditions };
        } catch (error) {
            this.logger.error(
                `[ExhaustionDetector] ❌ EXCEPTION in conditions analysis`,
                {
                    zone,
                    price,
                    side,
                    error: (error as Error).message,
                    stack: (error as Error).stack,
                }
            );

            this.handleDetectorError(error as Error);
            return {
                success: false,
                error: error as Error,
                fallbackSafe: false,
            };
        }
    }

    /**
     * Calculate consistency (how consistently passive is maintained)
     */
    private calculateConsistency(passiveValues: number[]): number {
        if (passiveValues.length < 3) {
            return 0.7; // Default reasonable consistency for small samples
        }

        try {
            const avgPassive = DetectorUtils.calculateMean(passiveValues);
            if (avgPassive === 0) return 0.5; // Neutral consistency if no passive volume

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
            this.logger?.warn(
                `[ExhaustionDetector] Error calculating consistency: ${(error as Error).message}`
            );
            return 0.5; // Safe default
        }
    }

    /**
     * Calculate velocity increase over time
     */
    private calculateVelocityIncrease(samples: ZoneSample[]): number {
        if (samples.length < 5) {
            return 1.0; // Neutral velocity for insufficient data
        }

        try {
            // Calculate velocity change over time
            const recent = samples.slice(-3); // Last 3 snapshots
            const earlier = samples.slice(-6, -3); // Previous 3 snapshots

            if (recent.length < 2 || earlier.length < 2) {
                return 1.0; // Neutral velocity
            }

            // Calculate velocity for recent period
            const recentVelocity = this.calculatePeriodVelocity(recent);
            const earlierVelocity = this.calculatePeriodVelocity(earlier);

            // Return velocity increase ratio with safety checks
            if (earlierVelocity <= 0) return 1.0; // Avoid division by zero

            const velocityRatio = recentVelocity / earlierVelocity;

            // Safety checks and bounds
            if (!isFinite(velocityRatio)) return 1.0;
            return Math.max(0.1, Math.min(10, velocityRatio)); // Reasonable bounds
        } catch (error) {
            this.logger?.warn(
                `[ExhaustionDetector] Error calculating velocity increase: ${(error as Error).message}`
            );
            return 1.0; // Safe default
        }
    }

    /**
     * Calculate period velocity
     */
    private calculatePeriodVelocity(samples: ZoneSample[]): number {
        if (samples.length < 2) return 0;

        try {
            let totalVelocity = 0;
            let validPeriods = 0;

            for (let i = 1; i < samples.length; i++) {
                const current = samples[i];
                const previous = samples[i - 1];
                const timeDelta = current.timestamp - previous.timestamp;

                if (timeDelta > 0) {
                    const volumeChange = Math.abs(
                        current.total - previous.total
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
            this.logger?.warn(
                `[ExhaustionDetector] Error calculating period velocity: ${(error as Error).message}`
            );
            return 0;
        }
    }

    /**
     * Detect passive refill patterns
     */
    private detectPassiveRefill(samples: ZoneSample[]): boolean {
        if (samples.length < 5) return false;

        try {
            const recent = samples.slice(-5);
            let refillEvents = 0;

            for (let i = 1; i < recent.length; i++) {
                const current = recent[i].total;
                const previous = recent[i - 1].total;

                if (current > previous * 1.1) {
                    // 10% increase
                    refillEvents++;
                }
            }

            return refillEvents >= 2;
        } catch (error) {
            this.logger?.warn(
                `[ExhaustionDetector] Error detecting refill: ${(error as Error).message}`
            );
            return false;
        }
    }

    /**
     * Calculate iceberg signal (simplified for exhaustion)
     */
    private calculateIcebergSignal(samples: ZoneSample[]): number {
        if (samples.length < 10) return 0;

        try {
            let refillCount = 0;
            let significantRefills = 0;
            let previousLevel = samples[0].total;

            for (let i = 1; i < samples.length; i++) {
                const currentLevel = samples[i].total;
                const prevLevel = samples[i - 1].total;

                // Detect refill after depletion
                if (
                    prevLevel < previousLevel * 0.7 && // Depleted
                    currentLevel > previousLevel * 0.9 // Refilled
                ) {
                    refillCount++;

                    if (currentLevel > previousLevel) {
                        significantRefills++; // Even stronger than before
                    }
                }

                previousLevel = Math.max(previousLevel, currentLevel);
            }

            // Calculate iceberg confidence
            const refillRate = refillCount / (samples.length / 10);
            const strengthRate = significantRefills / Math.max(1, refillCount);

            return Math.min(1, refillRate * 0.7 + strengthRate * 0.3);
        } catch (error) {
            this.logger?.warn(
                `[ExhaustionDetector] Error calculating iceberg signal: ${(error as Error).message}`
            );
            return 0;
        }
    }

    /**
     * Calculate liquidity gradient (simplified for exhaustion)
     */
    private calculateLiquidityGradient(
        samples: ZoneSample[],
        avgLiquidity: number
    ): number {
        if (samples.length < 3 || avgLiquidity === 0) return 0;

        try {
            // Calculate gradient strength (higher = more liquidity depth)
            const currentLiquidity = samples[samples.length - 1]?.total || 0;
            const gradientStrength = currentLiquidity / avgLiquidity;

            return Math.min(1, Math.max(0, gradientStrength));
        } catch (error) {
            this.logger?.warn(
                `[ExhaustionDetector] Error calculating liquidity gradient: ${(error as Error).message}`
            );
            return 0;
        }
    }
}
