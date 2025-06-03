// src/indicators/base/flowDetectorBase.ts

//import { SpotWebsocketStreams } from "@binance/spot";
import { BaseDetector } from "./baseDetector.js";
import { Logger } from "../../infrastructure/logger.js";
import { MetricsCollector } from "../../infrastructure/metricsCollector.js";
import { ISignalLogger } from "../../services/signalLogger.js";
import { RollingWindow } from "../../utils/rollingWindow.js";

import type {
    EnrichedTradeEvent,
    AggressiveTrade,
} from "../../types/marketEvents.js";
import type {
    DetectorCallback,
    BaseDetectorSettings,
} from "../interfaces/detectorInterfaces.js";

import {
    SignalType,
    DistributionResult,
    MarketRegime,
} from "../../types/signalTypes.js";

/**
 * Superior FlowDetectorBase - Production-grade base class for Accumulation & Distribution
 *
 * Features from your AccumulationDetector + enhancements:
 * - Welford's algorithm for price statistics
 * - Correct market microstructure ratio calculations
 * - Production-tuned confidence scoring with penalties
 * - Advanced volume profile tracking
 * - Statistical validation and significance testing
 * - Enhanced cleanup and memory management
 * - Comprehensive metrics and monitoring
 */
export abstract class FlowDetectorBase extends BaseDetector {
    // Flow direction strategy
    protected readonly flowDirection: "accumulation" | "distribution";
    protected readonly detectorType: SignalType;
    protected readonly symbol: string;

    // Enhanced configuration with your proven defaults
    protected readonly minDurationMs: number;
    protected readonly minRatio: number;
    protected readonly minRecentActivityMs: number;
    protected readonly threshold: number;
    protected readonly volumeConcentrationWeight: number;
    protected readonly strengthAnalysisEnabled: boolean;
    protected readonly velocityAnalysisEnabled: boolean;

    // Superior tracking structures (based on your implementation)
    protected readonly zoneData = new Map<number, SuperiorZoneFlowData>();
    protected priceHistory = new RollingWindow<number>(200, false);
    protected readonly volumeHistory = new RollingWindow<number>(200, true);
    protected lastCleanup = Date.now();
    protected readonly cleanupIntervalMs = 60000;

    // Advanced market analytics
    private marketRegime = {
        volatility: 0,
        baselineVolatility: 0,
        trendStrength: 0,
        volumeNormalization: 1,
        lastUpdate: 0,
    };
    private recentPriceChanges: number[] = [];
    private readonly volatilityLookbackSec = 3600;

    constructor(
        id: string,
        callback: DetectorCallback,
        settings: SuperiorFlowSettings = {},
        logger: Logger,
        metricsCollector: MetricsCollector,
        signalLogger?: ISignalLogger
    ) {
        super(id, callback, settings, logger, metricsCollector, signalLogger);
        this.flowDirection = settings.flowDirection ?? "accumulation";
        this.detectorType = this.flowDirection;
        this.symbol = settings.symbol ?? "LTCUSDT";

        // Enhanced configuration with intelligent defaults
        this.minDurationMs = settings.minDurationMs ?? 300000; // 5 minutes
        this.minRatio = settings.minRatio ?? this.getDefaultMinRatio();
        this.minRecentActivityMs = settings.minRecentActivityMs ?? 60000;
        this.threshold = settings.threshold ?? this.getDefaultThreshold();
        this.volumeConcentrationWeight =
            settings.volumeConcentrationWeight ?? 0.2;
        this.strengthAnalysisEnabled = settings.strengthAnalysis ?? true;
        this.velocityAnalysisEnabled = settings.velocityAnalysis ?? false;

        // Setup enhanced cleanup with zone validation
        setInterval(
            () => this.performAdvancedCleanup(),
            this.cleanupIntervalMs
        );

        this.initializeFlowMetrics();
        this.logger.info(
            `[${this.flowDirection}Detector] Superior base initialized`,
            {
                minRatio: this.minRatio,
                threshold: this.threshold,
                features: {
                    strengthAnalysis: this.strengthAnalysisEnabled,
                    velocityAnalysis: this.velocityAnalysisEnabled,
                },
            }
        );
    }

    // Abstract methods for flow direction strategy
    protected abstract getDefaultMinRatio(): number;
    protected abstract getDefaultThreshold(): number;
    protected abstract getRequiredTradeSide(): "buy" | "sell";
    protected abstract getRelevantPassiveSide(
        event: EnrichedTradeEvent
    ): number;
    protected abstract calculateDirectionalRatio(
        aggressive: number,
        relevantPassive: number
    ): number;
    protected abstract calculatePriceEffect(
        zoneData: SuperiorZoneFlowData
    ): number;
    protected abstract validateFlowSpecificConditions(
        conditions: SuperiorFlowConditions
    ): boolean;
    protected abstract getSignalSide(): "buy" | "sell";
    protected abstract createFlowSignal(
        params: SignalCreationParams
    ): DistributionResult;

    protected onEnrichedTradeSpecific(event: EnrichedTradeEvent): void {
        // Update market regime analytics
        this.updateMarketRegime(event);

        // Update global tracking
        this.priceHistory.push(event.price);
        this.volumeHistory.push(event.quantity);

        // Update zone-specific flow tracking
        this.updateZoneFlow(event);
    }

    protected checkForSignal(triggerTrade: AggressiveTrade): void {
        const now = Date.now();
        const requiredSide = this.getRequiredTradeSide();

        // Only proceed if we see the right type of aggressive action
        if (this.getTradeSide(triggerTrade) !== requiredSide) {
            return;
        }

        try {
            // Analyze all active zones
            for (const [zone, data] of this.zoneData) {
                if (now - data.lastUpdate > this.minRecentActivityMs) {
                    continue; // Skip stale zones
                }

                this.analyzeZoneForFlow(zone, data, triggerTrade);
            }

            // Record detection metrics
            this.recordDetectionAttempt();
        } catch (error) {
            this.handleFlowDetectionError(error as Error);
        }
    }

    /**
     * Market regime tracking (enhanced from your approach)
     */
    private updateMarketRegime(event: EnrichedTradeEvent): void {
        // Track price changes for volatility calculation
        if (this.recentPriceChanges.length > 0) {
            this.recentPriceChanges.push(event.price);

            // Maintain volatility lookback window
            while (
                this.recentPriceChanges.length > 2 &&
                this.recentPriceChanges.length > this.volatilityLookbackSec / 10
            ) {
                this.recentPriceChanges.shift();
            }

            // Calculate sophisticated volatility metrics
            if (this.recentPriceChanges.length > 20) {
                this.calculateMarketVolatility();
            }
        } else {
            this.recentPriceChanges.push(event.price);
        }
    }

    private calculateMarketVolatility(): void {
        const returns = [];
        for (let i = 1; i < this.recentPriceChanges.length; i++) {
            const return_ =
                (this.recentPriceChanges[i] - this.recentPriceChanges[i - 1]) /
                this.recentPriceChanges[i - 1];
            returns.push(return_);
        }

        // Calculate current volatility using Welford's algorithm
        let mean = 0;
        let m2 = 0;
        for (let i = 0; i < returns.length; i++) {
            const delta = returns[i] - mean;
            mean += delta / (i + 1);
            const delta2 = returns[i] - mean;
            m2 += delta * delta2;
        }

        this.marketRegime.volatility = Math.sqrt(m2 / returns.length);

        // Update baseline with exponential moving average
        if (this.marketRegime.baselineVolatility === 0) {
            this.marketRegime.baselineVolatility = this.marketRegime.volatility;
        } else {
            this.marketRegime.baselineVolatility =
                this.marketRegime.baselineVolatility * 0.99 +
                this.marketRegime.volatility * 0.01;
        }

        // Calculate trend strength
        this.marketRegime.trendStrength = this.calculateTrendStrength();
        this.marketRegime.lastUpdate = Date.now();
    }

    private calculateTrendStrength(): number {
        if (this.priceHistory.count() < 10) return 0;

        const prices = this.priceHistory.toArray();
        const n = prices.length;

        // Linear regression slope calculation
        const sumX = (n * (n - 1)) / 2;
        const sumX2 = ((n - 1) * n * (2 * n - 1)) / 6;
        const sumY = prices.reduce((sum, p) => sum + p, 0);
        const sumXY = prices.reduce((sum, p, i) => sum + p * i, 0);

        const denominator = n * sumX2 - sumX * sumX;
        if (denominator === 0) return 0;

        const slope = (n * sumXY - sumX * sumY) / denominator;
        const avgPrice = sumY / n;

        // Normalize slope to 0-1 range
        return Math.min(1, Math.abs(slope) / (avgPrice * 0.001)); // 0.1% price change = 1.0 strength
    }

    /**
     * Superior zone flow tracking (based on your implementation)
     */
    private updateZoneFlow(event: EnrichedTradeEvent): void {
        const zone = this.calculateZone(event.price);
        const side = this.getTradeSide(event);
        const now = Date.now();

        // Initialize zone if needed
        if (!this.zoneData.has(zone)) {
            this.initializeZoneData(zone, event);
        }

        const zoneData = this.zoneData.get(zone)!;

        // Update volume tracking (your superior approach)
        this.updateVolumeTracking(zoneData, event, side);

        // Update price statistics using Welford's algorithm (from your implementation)
        this.updatePriceStatistics(zoneData, event);

        // Update volume profile (enhanced)
        this.updateVolumeProfile(zoneData, event);

        // Update liquidity tracking
        this.updateLiquidityTracking(zoneData, event);

        // Calculate derived metrics
        this.calculateAdvancedFlowMetrics(zoneData);

        // Prune old data efficiently
        this.pruneZoneDataIntelligently(zoneData, now);
    }

    private initializeZoneData(zone: number, event: EnrichedTradeEvent): void {
        const windowSize = Math.ceil(this.windowMs / 3000); // ~1 sample per 3 seconds

        const side = this.getTradeSide(event);
        this.zoneData.set(zone, {
            // Your proven volume tracking approach
            aggressiveVolume: new RollingWindow<number>(windowSize, true),
            timestamps: new RollingWindow<number>(windowSize, true),
            sides: new RollingWindow<"buy" | "sell">(windowSize, false),

            // Enhanced price statistics (your Welford's approach)
            priceRollingMean: 0,
            priceRollingVar: 0,
            priceCount: 0,

            // Basic tracking
            startTime: event.timestamp,
            lastUpdate: event.timestamp,
            tradeCount: 0,

            // Current liquidity levels (your approach)
            currentPassiveBid: event.zonePassiveBidVolume || 0,
            currentPassiveAsk: event.zonePassiveAskVolume || 0,

            // Enhanced analytics
            volumeProfile: new Map<number, number>(),
            liquidityHistory: new RollingWindow<number>(windowSize, false),
            strengthScore: 0,
            velocityScore: 0,
            priceEffectScore: 0,

            // Statistical validation
            statisticalSignificance: 0,
            lastStatisticalUpdate: event.timestamp,

            // Dominant side tracking
            dominantSide: side,
            sideConfidence: 0,
        });
    }

    private updateVolumeTracking(
        zoneData: SuperiorZoneFlowData,
        event: EnrichedTradeEvent,
        side: "buy" | "sell"
    ): void {
        // Track all aggressive volume (your approach)
        zoneData.aggressiveVolume.push(event.quantity);
        zoneData.timestamps.push(event.timestamp);
        zoneData.sides.push(side);
        zoneData.lastUpdate = event.timestamp;
        zoneData.tradeCount++;

        // Update dominant side with confidence
        const sideCounts = this.countSides(zoneData.sides.toArray());
        const totalSides = sideCounts.buy + sideCounts.sell;

        if (totalSides > 0) {
            if (sideCounts.buy > sideCounts.sell) {
                zoneData.dominantSide = "buy";
                zoneData.sideConfidence = sideCounts.buy / totalSides;
            } else {
                zoneData.dominantSide = "sell";
                zoneData.sideConfidence = sideCounts.sell / totalSides;
            }
        }
    }

    /**
     * Superior price statistics using Welford's algorithm (from your implementation)
     */
    private updatePriceStatistics(
        zoneData: SuperiorZoneFlowData,
        event: EnrichedTradeEvent
    ): void {
        const trades = zoneData.timestamps.toArray(); // Use timestamps as proxy for trade count

        if (trades.length > 1) {
            // Calculate price change from previous trade (concept from your implementation)
            const prevPrice =
                this.priceHistory.toArray().slice(-2)[0] || event.price;
            const priceChange = event.price - prevPrice;

            // Welford's algorithm for online variance (your superior approach)
            const delta = priceChange - zoneData.priceRollingMean;
            zoneData.priceCount += 1;
            zoneData.priceRollingMean += delta / zoneData.priceCount;
            zoneData.priceRollingVar +=
                delta * (priceChange - zoneData.priceRollingMean);
        }
    }

    private updateVolumeProfile(
        zoneData: SuperiorZoneFlowData,
        event: EnrichedTradeEvent
    ): void {
        // Enhanced volume profile tracking
        const tickSize = this.calculateTickSize(event.price);
        const roundedPrice = Math.round(event.price / tickSize) * tickSize;

        const currentVolume = zoneData.volumeProfile.get(roundedPrice) || 0;
        zoneData.volumeProfile.set(
            roundedPrice,
            currentVolume + event.quantity
        );

        // Intelligent cleanup to prevent memory bloat
        if (zoneData.volumeProfile.size > 500) {
            const sortedEntries = Array.from(zoneData.volumeProfile.entries())
                .sort((a, b) => b[1] - a[1])
                .slice(0, 250); // Keep top 250 levels

            zoneData.volumeProfile.clear();
            sortedEntries.forEach(([price, volume]) => {
                zoneData.volumeProfile.set(price, volume);
            });
        }
    }

    private updateLiquidityTracking(
        zoneData: SuperiorZoneFlowData,
        event: EnrichedTradeEvent
    ): void {
        // Track relevant liquidity (your superior approach)
        const relevantLiquidity = this.getRelevantPassiveSide(event);
        zoneData.liquidityHistory.push(relevantLiquidity);

        // Update current levels
        zoneData.currentPassiveBid = event.zonePassiveBidVolume || 0;
        zoneData.currentPassiveAsk = event.zonePassiveAskVolume || 0;
    }

    /**
     * Advanced flow metrics calculation
     */
    private calculateAdvancedFlowMetrics(zoneData: SuperiorZoneFlowData): void {
        // Calculate strength score
        if (this.strengthAnalysisEnabled) {
            zoneData.strengthScore = this.calculateStrengthScore(zoneData);
        }

        // Calculate velocity score
        if (this.velocityAnalysisEnabled) {
            zoneData.velocityScore = this.calculateVelocityScore(zoneData);
        }

        // Calculate price effect score (direction-specific)
        zoneData.priceEffectScore = this.calculatePriceEffect(zoneData);

        // Calculate statistical significance
        zoneData.statisticalSignificance =
            this.calculateStatisticalSignificance(zoneData);
    }

    private calculateStrengthScore(zoneData: SuperiorZoneFlowData): number {
        const now = Date.now();
        const duration = now - zoneData.startTime;
        const aggressiveVolume = zoneData.aggressiveVolume.sum();
        const relevantPassive = this.getCurrentRelevantPassive(zoneData);

        // Your superior ratio calculation approach
        const ratio = this.calculateDirectionalRatio(
            aggressiveVolume,
            relevantPassive
        );

        // Multi-factor strength calculation (enhanced from your approach)
        const ratioStrength = Math.min(ratio / (this.minRatio * 2), 1);
        const durationStrength = Math.min(
            duration / (this.minDurationMs * 2),
            1
        );
        const volumeBalance =
            Math.min(relevantPassive / Math.max(aggressiveVolume, 1), 3) / 3;
        const sideConfidence = zoneData.sideConfidence;

        return (
            ratioStrength * 0.35 +
            durationStrength * 0.25 +
            volumeBalance * 0.25 +
            sideConfidence * 0.15
        );
    }

    private calculateVelocityScore(zoneData: SuperiorZoneFlowData): number {
        const timestamps = zoneData.timestamps.toArray();
        const volumes = zoneData.aggressiveVolume.toArray();

        if (timestamps.length < 3) return 0;

        // Calculate volume accumulation rate over time (your approach)
        const timeSpan = timestamps[timestamps.length - 1] - timestamps[0];
        const totalVolume = volumes.reduce((sum, vol) => sum + vol, 0);

        if (timeSpan <= 0) return 0;

        const rate = (totalVolume / timeSpan) * 1000; // per second
        return Math.min(rate / 20, 1); // Normalize to 0-1, more conservative than your 10
    }

    private calculateStatisticalSignificance(
        zoneData: SuperiorZoneFlowData
    ): number {
        // Enhanced statistical validation
        const sampleSize = zoneData.tradeCount;
        const minSamples = 30; // Statistical significance threshold

        if (sampleSize < minSamples) {
            return sampleSize / minSamples; // Gradual confidence buildup
        }

        // Calculate significance based on price variance
        if (zoneData.priceCount > 1) {
            const variance =
                zoneData.priceRollingVar / (zoneData.priceCount - 1);
            const standardError = Math.sqrt(variance / zoneData.priceCount);

            // Higher significance when we have low variance (consistent behavior)
            const consistencyScore =
                standardError > 0 ? Math.min(1, 0.01 / standardError) : 1;
            return Math.min(1, consistencyScore);
        }

        return 1; // Maximum significance if we have enough samples
    }

    /**
     * Zone analysis for flow detection (enhanced from your approach)
     */
    private analyzeZoneForFlow(
        zone: number,
        zoneData: SuperiorZoneFlowData,
        triggerTrade: AggressiveTrade
    ): void {
        const price = triggerTrade.price;
        const side = this.getSignalSide();

        // Check cooldown (your approach)
        if (!this.checkCooldown(zone, side)) {
            return;
        }

        // Analyze flow conditions
        const conditions = this.analyzeSuperiorFlowConditions(zone, zoneData);

        // Calculate confidence score (enhanced from your approach)
        const score = this.calculateSuperiorFlowScore(conditions);

        // Primary threshold check
        if (score < this.threshold) {
            return;
        }

        // Flow-specific validation (direction-dependent)
        if (!this.validateFlowSpecificConditions(conditions)) {
            this.recordRejection("flow_specific_validation");
            return;
        }

        // Statistical significance check
        if (conditions.statisticalSignificance < 0.7) {
            this.recordRejection("insufficient_statistical_significance");
            return;
        }

        // Volume threshold check
        if (conditions.aggressiveVolume < this.minAggVolume) {
            this.recordRejection("insufficient_volume");
            return;
        }

        // Spoofing detection
        if (
            this.isSpoofed &&
            this.isSpoofed(price, side, triggerTrade.timestamp)
        ) {
            this.recordRejection("spoofing_detected");
            return;
        }

        // Calculate volumes for signal
        const volumes = this.calculateSuperiorFlowVolumes(zone, zoneData);

        // Create and emit signal
        const signal = this.createFlowSignal({
            zone,
            price,
            side,
            score,
            conditions,
            volumes,
            zoneData,
            marketRegime: { ...this.marketRegime },
        });

        this.handleDetection(signal);
        this.recordSuccessfulSignal(score, conditions);
    }

    /**
     * Superior flow conditions analysis (based on your approach)
     */
    private analyzeSuperiorFlowConditions(
        zone: number,
        zoneData: SuperiorZoneFlowData
    ): SuperiorFlowConditions {
        const now = Date.now();
        const duration = now - zoneData.startTime;
        const recentActivity = now - zoneData.lastUpdate;

        // Calculate volumes
        const aggressiveVolume = zoneData.aggressiveVolume.sum();
        const relevantPassive = this.getCurrentRelevantPassive(zoneData);
        const totalPassive =
            zoneData.currentPassiveBid + zoneData.currentPassiveAsk;

        // Your superior ratio calculation
        const ratio = this.calculateDirectionalRatio(
            aggressiveVolume,
            relevantPassive
        );

        // Enhanced metrics
        const strength = zoneData.strengthScore;
        const velocity = zoneData.velocityScore;
        const priceEffect = zoneData.priceEffectScore;
        const statisticalSignificance = zoneData.statisticalSignificance;

        // Volume concentration analysis
        const volumeConcentration = this.calculateVolumeConcentration(zoneData);

        return {
            // Core metrics (your approach)
            ratio,
            duration,
            aggressiveVolume,
            relevantPassive,
            totalPassive,

            // Enhanced analytics
            strength,
            velocity,
            priceEffect,
            statisticalSignificance,
            volumeConcentration,

            // Timing and activity
            recentActivity,
            tradeCount: zoneData.tradeCount,

            // Validation flags
            meetsMinDuration: duration >= this.minDurationMs,
            meetsMinRatio: ratio >= this.minRatio,
            isRecentlyActive: recentActivity < this.minRecentActivityMs,

            // Side analysis
            dominantSide: zoneData.dominantSide,
            sideConfidence: zoneData.sideConfidence,

            // Market context
            marketVolatility: this.marketRegime.volatility,
            trendStrength: this.marketRegime.trendStrength,
        };
    }

    /**
     * Superior confidence scoring (enhanced from your production-tested approach)
     */
    private calculateSuperiorFlowScore(
        conditions: SuperiorFlowConditions
    ): number {
        let score = 0;

        // Factor 1: Ratio strength (your proven thresholds)
        if (conditions.ratio >= this.minRatio * 2)
            score += 0.3; // Very strong
        else if (conditions.ratio >= this.minRatio * 1.5)
            score += 0.2; // Strong
        else if (conditions.ratio >= this.minRatio) score += 0.1; // Meets minimum

        // Factor 2: Duration weighting (your approach)
        const durationFactor = Math.min(
            conditions.duration / this.minDurationMs,
            3
        );
        if (durationFactor >= 2)
            score += 0.25; // Long accumulation/distribution
        else if (durationFactor >= 1.5)
            score += 0.15; // Medium duration
        else if (durationFactor >= 1) score += 0.1; // Minimum duration

        // Factor 3: Strength analysis (enhanced)
        if (this.strengthAnalysisEnabled && conditions.strength > 0.7) {
            score += 0.2;
        } else if (conditions.strength > 0.5) {
            score += 0.1;
        }

        // Factor 4: Price effect (direction-specific)
        if (conditions.priceEffect > 0.7) {
            score += 0.15;
        } else if (conditions.priceEffect > 0.5) {
            score += 0.1;
        }

        // Factor 5: Statistical significance
        if (conditions.statisticalSignificance > 0.8) {
            score += 0.1;
        } else if (conditions.statisticalSignificance > 0.6) {
            score += 0.05;
        }

        // Factor 6: Volume significance (your approach)
        const volumeSignificance = Math.min(
            conditions.aggressiveVolume / this.minAggVolume,
            3
        );
        if (volumeSignificance >= 2) score += 0.1;
        else if (volumeSignificance >= 1.5) score += 0.05;

        // Factor 7: Volume concentration
        if (conditions.volumeConcentration > 0.6) {
            score += 0.05;
        }

        // Factor 8: Side confidence
        if (conditions.sideConfidence > 0.8) {
            score += 0.05;
        }

        // Penalties (your proven approach)
        if (!conditions.meetsMinDuration) score *= 0.5;
        if (!conditions.meetsMinRatio) score *= 0.3;
        if (!conditions.isRecentlyActive) score *= 0.2;

        // Market regime adjustment
        const volatilityAdjustment = this.calculateVolatilityAdjustment();
        score *= volatilityAdjustment;

        return Math.max(0, Math.min(1, score));
    }

    private calculateVolatilityAdjustment(): number {
        if (this.marketRegime.baselineVolatility === 0) return 1;

        const volatilityRatio =
            this.marketRegime.volatility / this.marketRegime.baselineVolatility;

        // Reduce confidence in highly volatile markets, increase in stable markets
        if (volatilityRatio > 2) return 0.8; // High volatility penalty
        if (volatilityRatio > 1.5) return 0.9; // Medium volatility penalty
        if (volatilityRatio < 0.5) return 1.1; // Low volatility bonus

        return 1; // Normal volatility
    }

    /**
     * Helper methods
     */
    private getCurrentRelevantPassive(zoneData: SuperiorZoneFlowData): number {
        // Use current liquidity levels (your superior approach)
        return this.flowDirection === "accumulation"
            ? zoneData.currentPassiveAsk // For accumulation, buyers hit asks
            : zoneData.currentPassiveBid; // For distribution, sellers hit bids
    }

    private calculateVolumeConcentration(
        zoneData: SuperiorZoneFlowData
    ): number {
        if (zoneData.volumeProfile.size < 3) return 0.5;

        const volumes = Array.from(zoneData.volumeProfile.values());
        const totalVolume = volumes.reduce((sum, vol) => sum + vol, 0);

        if (totalVolume === 0) return 0.5;

        // Calculate Herfindahl-Hirschman Index for concentration
        const hhi = volumes.reduce((sum, vol) => {
            const share = vol / totalVolume;
            return sum + share * share;
        }, 0);

        return Math.min(1.0, hhi * volumes.length);
    }

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

    private calculateTickSize(price: number): number {
        // Enhanced tick size calculation
        if (price < 1) return 0.0001;
        if (price < 10) return 0.001;
        if (price < 100) return 0.01;
        if (price < 1000) return 0.1;
        if (price < 10000) return 1.0;
        return 10.0;
    }

    private calculateSuperiorFlowVolumes(
        zone: number,
        zoneData: SuperiorZoneFlowData
    ) {
        const aggressive = zoneData.aggressiveVolume.sum();
        const passive = this.getCurrentRelevantPassive(zoneData);

        return { aggressive, passive };
    }

    /**
     * Advanced cleanup and memory management
     */
    private pruneZoneDataIntelligently(
        zoneData: SuperiorZoneFlowData,
        now: number
    ): void {
        const cutoff = now - this.windowMs;

        // Enhanced pruning similar to your implementation
        while (zoneData.timestamps.count() > 0) {
            const oldestTime = zoneData.timestamps.toArray()[0];
            if (oldestTime >= cutoff) break;

            // Remove oldest samples (your approach)
            const timestamps = zoneData.timestamps.toArray().slice(1);
            const volumes = zoneData.aggressiveVolume.toArray().slice(1);
            const sides = zoneData.sides.toArray().slice(1);

            // Rebuild windows efficiently
            const capacity = Math.max(timestamps.length, 10);
            zoneData.timestamps = new RollingWindow<number>(capacity, true);
            zoneData.aggressiveVolume = new RollingWindow<number>(
                capacity,
                true
            );
            zoneData.sides = new RollingWindow<"buy" | "sell">(capacity, false);

            // Repopulate with remaining data
            timestamps.forEach((t) => zoneData.timestamps.push(t));
            volumes.forEach((v) => zoneData.aggressiveVolume.push(v));
            sides.forEach((s) => zoneData.sides.push(s));

            // Update start time to first remaining timestamp
            zoneData.startTime = timestamps.length > 0 ? timestamps[0] : now;
        }
    }

    private performAdvancedCleanup(): void {
        const now = Date.now();
        const cutoff = now - this.windowMs * 2;
        let cleanedCount = 0;
        let resetCount = 0;

        for (const [zone, data] of this.zoneData) {
            if (data.lastUpdate < cutoff) {
                this.zoneData.delete(zone);
                cleanedCount++;
            } else if (
                data.tradeCount < 10 &&
                now - data.startTime > this.minDurationMs
            ) {
                // Reset zones with insufficient activity (your approach)
                data.strengthScore = 0;
                data.velocityScore = 0;
                data.priceEffectScore = 0;
                data.statisticalSignificance = 0;
                resetCount++;
            }
        }

        // Cleanup price history if too large
        if (this.priceHistory.count() > 300) {
            const prices = this.priceHistory.toArray().slice(-200);
            const newPriceHistory = new RollingWindow<number>(200, false);
            prices.forEach((p) => newPriceHistory.push(p));
            this.priceHistory = newPriceHistory;
        }

        if (cleanedCount > 0 || resetCount > 0) {
            this.logger.debug(
                `[${this.flowDirection}Detector] Advanced cleanup completed`,
                {
                    cleanedZones: cleanedCount,
                    resetZones: resetCount,
                    activeZones: this.zoneData.size,
                }
            );
        }

        this.lastCleanup = now;
    }

    /**
     * Metrics and monitoring
     */
    private initializeFlowMetrics(): void {
        const prefix = this.flowDirection;

        // Core metrics
        this.metricsCollector.createCounter(
            `${prefix}.signals.generated`,
            `${this.flowDirection} signals generated`
        );

        this.metricsCollector.createCounter(
            `${prefix}.detection.attempts`,
            `${this.flowDirection} detection attempts`
        );

        this.metricsCollector.createCounter(
            `${prefix}.detection.errors`,
            `${this.flowDirection} detection errors`
        );

        // Quality metrics
        this.metricsCollector.createHistogram(
            `${prefix}.confidence.scores`,
            `${this.flowDirection} confidence score distribution`,
            [],
            [0.0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0]
        );

        this.metricsCollector.createHistogram(
            `${prefix}.duration`,
            `${this.flowDirection} duration distribution`,
            [],
            [30000, 60000, 120000, 300000, 600000, 1200000, 1800000]
        );

        this.metricsCollector.createHistogram(
            `${prefix}.ratio`,
            `${this.flowDirection} ratio distribution`,
            [],
            [0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 4.0, 5.0]
        );

        // State metrics
        this.metricsCollector.createGauge(
            `${prefix}.zones.active`,
            `Active ${this.flowDirection} zones`
        );

        this.metricsCollector.createGauge(
            `${prefix}.market.volatility`,
            `Market volatility estimate`
        );

        this.metricsCollector.createGauge(
            `${prefix}.market.trend_strength`,
            `Market trend strength`
        );

        // Rejection reason counters
        const rejectionReasons = [
            "flow_specific_validation",
            "insufficient_statistical_significance",
            "insufficient_volume",
            "spoofing_detected",
            "below_threshold",
        ];

        rejectionReasons.forEach((reason) => {
            this.metricsCollector.createCounter(
                `${prefix}.rejected.${reason}`,
                `Signals rejected: ${reason}`
            );
        });
    }

    private recordDetectionAttempt(): void {
        this.metricsCollector.incrementCounter(
            `${this.flowDirection}.detection.attempts`
        );
        this.metricsCollector.recordGauge(
            `${this.flowDirection}.zones.active`,
            this.zoneData.size
        );
        this.metricsCollector.recordGauge(
            `${this.flowDirection}.market.volatility`,
            this.marketRegime.volatility
        );
        this.metricsCollector.recordGauge(
            `${this.flowDirection}.market.trend_strength`,
            this.marketRegime.trendStrength
        );
    }

    private handleFlowDetectionError(error: Error): void {
        this.handleError(error, `${this.flowDirection}Detector.checkForSignal`);
        this.metricsCollector.incrementCounter(
            `${this.flowDirection}.detection.errors`
        );
    }

    private recordRejection(reason: string): void {
        this.metricsCollector.incrementCounter(
            `${this.flowDirection}.rejected.${reason}`
        );
        this.logger.debug(`[${this.flowDirection}Detector] Signal rejected`, {
            reason,
        });
    }

    private recordSuccessfulSignal(
        score: number,
        conditions: SuperiorFlowConditions
    ): void {
        this.metricsCollector.incrementCounter(
            `${this.flowDirection}.signals.generated`
        );
        this.metricsCollector.recordHistogram(
            `${this.flowDirection}.confidence.scores`,
            score
        );
        this.metricsCollector.recordHistogram(
            `${this.flowDirection}.duration`,
            conditions.duration
        );
        this.metricsCollector.recordHistogram(
            `${this.flowDirection}.ratio`,
            conditions.ratio
        );
    }

    /**
     * Advanced analytics and debugging
     */
    public getDetailedFlowState(): DetailedFlowState {
        const now = Date.now();
        const zones = Array.from(this.zoneData.entries()).map(
            ([zone, data]) => ({
                zone,
                duration: now - data.startTime,
                ratio: this.calculateDirectionalRatio(
                    data.aggressiveVolume.sum(),
                    this.getCurrentRelevantPassive(data)
                ),
                strength: data.strengthScore,
                priceEffect: data.priceEffectScore,
                velocity: data.velocityScore,
                statisticalSignificance: data.statisticalSignificance,
                tradeCount: data.tradeCount,
                isActive: now - data.lastUpdate < this.minRecentActivityMs,
                dominantSide: data.dominantSide,
                sideConfidence: data.sideConfidence,
            })
        );

        const activeZones = zones.filter((z) => z.isActive);
        const strongZones = activeZones.filter((z) => z.strength > 0.7);

        return {
            flowDirection: this.flowDirection,
            zones,
            marketRegime: { ...this.marketRegime },
            summary: {
                totalZones: zones.length,
                activeZones: activeZones.length,
                strongZones: strongZones.length,
                avgConfidence:
                    activeZones.length > 0
                        ? activeZones.reduce((sum, z) => sum + z.strength, 0) /
                          activeZones.length
                        : 0,
                avgRatio:
                    activeZones.length > 0
                        ? activeZones.reduce((sum, z) => sum + z.ratio, 0) /
                          activeZones.length
                        : 0,
            },
            configuration: {
                minRatio: this.minRatio,
                threshold: this.threshold,
                minDurationMs: this.minDurationMs,
                strengthAnalysis: this.strengthAnalysisEnabled,
                velocityAnalysis: this.velocityAnalysisEnabled,
            },
        };
    }

    public analyzeZoneAtPrice(price: number): ZoneAnalysisResult {
        const zone = this.calculateZone(price);
        const zoneData = this.zoneData.get(zone);

        if (!zoneData) {
            return {
                zone,
                exists: false,
                analysis: null,
                recommendation: "no_activity",
                confidence: 0,
            };
        }

        const conditions = this.analyzeSuperiorFlowConditions(zone, zoneData);
        const confidence = this.calculateSuperiorFlowScore(conditions);

        let recommendation:
            | "strong_flow"
            | "weak_flow"
            | "no_flow"
            | "developing";
        if (confidence > 0.7) {
            recommendation = "strong_flow";
        } else if (confidence > 0.4) {
            recommendation = "weak_flow";
        } else if (conditions.tradeCount > 5) {
            recommendation = "developing";
        } else {
            recommendation = "no_flow";
        }

        return {
            zone,
            exists: true,
            analysis: conditions,
            recommendation,
            confidence,
        };
    }

    public simulateFlow(params: FlowSimulationParams): FlowSimulationResult {
        // Create mock conditions for simulation
        const conditions: SuperiorFlowConditions = {
            ratio: this.calculateDirectionalRatio(
                params.aggressiveVolume,
                params.passiveVolume
            ),
            duration: params.duration,
            aggressiveVolume: params.aggressiveVolume,
            relevantPassive: params.passiveVolume,
            totalPassive: params.passiveVolume,
            strength: params.strength ?? 0.5,
            velocity: params.velocity ?? 0.3,
            priceEffect: params.priceEffect ?? 0.4,
            statisticalSignificance: params.statisticalSignificance ?? 0.8,
            volumeConcentration: params.volumeConcentration ?? 0.5,
            recentActivity: 0,
            tradeCount: params.tradeCount ?? 20,
            meetsMinDuration: params.duration >= this.minDurationMs,
            meetsMinRatio:
                this.calculateDirectionalRatio(
                    params.aggressiveVolume,
                    params.passiveVolume
                ) >= this.minRatio,
            isRecentlyActive: true,
            dominantSide: this.getRequiredTradeSide(),
            sideConfidence: 0.8,
            marketVolatility: this.marketRegime.volatility,
            trendStrength: this.marketRegime.trendStrength,
        };

        const score = this.calculateSuperiorFlowScore(conditions);
        const wouldSignal =
            score >= this.threshold &&
            this.validateFlowSpecificConditions(conditions);

        const breakdown = {
            ratioComponent: conditions.ratio >= this.minRatio ? 0.3 : 0,
            durationComponent: conditions.meetsMinDuration ? 0.25 : 0,
            strengthComponent: conditions.strength * 0.2,
            priceEffectComponent: conditions.priceEffect * 0.15,
            statisticalComponent: conditions.statisticalSignificance * 0.1,
        };

        const missingRequirements: string[] = [];
        if (!conditions.meetsMinDuration) missingRequirements.push("duration");
        if (!conditions.meetsMinRatio) missingRequirements.push("ratio");
        if (conditions.priceEffect < 0.3)
            missingRequirements.push("price_effect");
        if (conditions.statisticalSignificance < 0.7)
            missingRequirements.push("statistical_significance");

        return {
            score,
            wouldSignal,
            breakdown,
            missingRequirements,
            conditions,
        };
    }

    /**
     * BaseDetector API Implementation
     */
    public getId(): string {
        return this.id || `${this.flowDirection}Detector`;
    }

    public start(): void {
        this.logger.info(`Superior ${this.flowDirection} detector started`, {
            detector: this.getId(),
            minRatio: this.minRatio,
            threshold: this.threshold,
            features: {
                strengthAnalysis: this.strengthAnalysisEnabled,
                velocityAnalysis: this.velocityAnalysisEnabled,
            },
        });
    }

    public stop(): void {
        this.logger.info(`Superior ${this.flowDirection} detector stopped`, {
            detector: this.getId(),
        });
    }

    public enable(): void {
        this.logger.info(`Superior ${this.flowDirection} detector enabled`);
    }

    public disable(): void {
        this.logger.info(`Superior ${this.flowDirection} detector disabled`);
    }

    public getStatus(): string {
        const state = this.getDetailedFlowState();
        const stats = {
            activeZones: state.summary.activeZones,
            strongZones: state.summary.strongZones,
            avgConfidence: state.summary.avgConfidence.toFixed(3),
            marketVolatility: this.marketRegime.volatility.toFixed(6),
            trendStrength: this.marketRegime.trendStrength.toFixed(3),
        };

        return `Superior ${this.flowDirection} Detector: ${JSON.stringify(stats)}`;
    }
}

// ============================================================================
// CONCRETE IMPLEMENTATIONS
// ============================================================================

/**
 * Superior Accumulation Detector V2
 */
export class AccumulationDetectorV2 extends FlowDetectorBase {
    protected readonly detectorType = "accumulation" as const;
    protected readonly flowDirection = "accumulation" as const;

    protected getDefaultMinRatio(): number {
        return 1.5; // Your proven threshold
    }

    protected getDefaultThreshold(): number {
        return 0.6; // Your proven threshold
    }

    protected getRequiredTradeSide(): "buy" | "sell" {
        return "buy"; // Accumulation requires aggressive buying
    }

    protected getRelevantPassiveSide(event: EnrichedTradeEvent): number {
        return event.zonePassiveAskVolume || 0; // For accumulation, buyers hit asks
    }

    protected calculateDirectionalRatio(
        aggressive: number,
        relevantPassive: number
    ): number {
        // Your superior approach: passive/aggressive for accumulation
        return aggressive > 0 ? relevantPassive / aggressive : 0;
    }

    protected calculatePriceEffect(zoneData: SuperiorZoneFlowData): number {
        // For accumulation: price should show strength (hold up during buying pressure)
        if (zoneData.priceCount < 2) return 0;

        const priceVariance =
            zoneData.priceRollingVar / (zoneData.priceCount - 1);
        const priceStd = Math.sqrt(priceVariance);

        // Lower variance during accumulation = price strength
        // Higher price stability during buying pressure = accumulation
        const stabilityScore = priceStd > 0 ? Math.min(1, 0.01 / priceStd) : 1;

        // Check if price trend is positive or stable during accumulation
        const avgPriceChange = zoneData.priceRollingMean;
        const trendScore =
            avgPriceChange >= 0 ? 1 : Math.max(0, 1 + avgPriceChange * 100);

        return stabilityScore * 0.6 + trendScore * 0.4;
    }

    protected validateFlowSpecificConditions(
        conditions: SuperiorFlowConditions
    ): boolean {
        // Accumulation must show price strength
        return conditions.priceEffect > 0.3;
    }

    protected getSignalSide(): "buy" | "sell" {
        return "buy"; // Accumulation signals are bullish
    }

    protected getSignalType() {
        return this.detectorType;
    }

    protected createFlowSignal(params: SignalCreationParams) {
        return {
            duration: params.conditions.duration,
            zone: params.zone,
            ratio: params.conditions.ratio,
            strength: params.conditions.strength,
            isAccumulating: params.conditions.isRecentlyActive,
            price: params.price,
            side: params.side,
            confidence: params.score,
            metadata: {
                accumulationScore: params.score,
                conditions: params.conditions,
                marketRegime: params.marketRegime,
                statisticalSignificance:
                    params.conditions.statisticalSignificance,
                volumeConcentration: params.conditions.volumeConcentration,
                detectorVersion: "2.0-superior",
            },
        };
    }
}

/**
 * Superior Distribution Detector V2
 */
export class DistributionDetectorV2 extends FlowDetectorBase {
    protected readonly detectorType = "distribution" as const;
    protected readonly flowDirection = "distribution" as const;

    protected getDefaultMinRatio(): number {
        return 1.8; // Higher threshold for distribution
    }

    protected getDefaultThreshold(): number {
        return 0.65; // Higher confidence threshold for distribution
    }

    protected getRequiredTradeSide(): "buy" | "sell" {
        return "sell"; // Distribution requires aggressive selling
    }

    protected getRelevantPassiveSide(event: EnrichedTradeEvent): number {
        return event.zonePassiveBidVolume || 0; // For distribution, sellers hit bids
    }

    protected calculateDirectionalRatio(
        aggressive: number,
        relevantPassive: number
    ): number {
        // For distribution: aggressive sells vs relevant passive bids
        return relevantPassive > 0 ? aggressive / relevantPassive : 0;
    }

    protected calculatePriceEffect(zoneData: SuperiorZoneFlowData): number {
        // For distribution: price should show weakness despite buying interest
        if (zoneData.priceCount < 2) return 0;

        // Calculate price weakness - negative mean change indicates weakness
        const avgPriceChange = zoneData.priceRollingMean;
        const weaknessFromTrend =
            avgPriceChange <= 0 ? Math.abs(avgPriceChange) * 100 : 0;

        // High variance during distribution can also indicate weakness/uncertainty
        const priceVariance =
            zoneData.priceRollingVar / (zoneData.priceCount - 1);
        const instabilityScore = Math.min(1, Math.sqrt(priceVariance) * 10);

        return Math.min(1, weaknessFromTrend * 0.7 + instabilityScore * 0.3);
    }

    protected validateFlowSpecificConditions(
        conditions: SuperiorFlowConditions
    ): boolean {
        // Distribution must show price weakness
        return conditions.priceEffect > 0.3;
    }

    protected getSignalSide(): "buy" | "sell" {
        return "sell"; // Distribution signals are bearish
    }

    protected getSignalType() {
        return this.detectorType;
    }

    protected createFlowSignal(
        params: SignalCreationParams
    ): DistributionResult {
        return {
            duration: params.conditions.duration,
            zone: params.zone,
            sellRatio: params.conditions.ratio,
            strength: params.conditions.strength,
            priceWeakness: params.conditions.priceEffect,
            isDistributing: params.conditions.isRecentlyActive,
            price: params.price,
            side: params.side,
            confidence: params.score,
            metadata: {
                distributionScore: params.score,
                conditions: params.conditions,
                marketRegime: params.marketRegime,
                statisticalSignificance:
                    params.conditions.statisticalSignificance,
                volumeConcentration: params.conditions.volumeConcentration,
                detectorVersion: "2.0-superior",
            },
        };
    }
}

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

export interface SuperiorFlowSettings extends BaseDetectorSettings {
    minDurationMs?: number;
    minRatio?: number;
    minRecentActivityMs?: number;
    threshold?: number;
    volumeConcentrationWeight?: number;
    strengthAnalysis?: boolean;
    velocityAnalysis?: boolean;
    flowDirection?: "accumulation" | "distribution";
    symbol?: string;
}

export interface SuperiorZoneFlowData {
    // Core tracking (your approach)
    aggressiveVolume: RollingWindow<number>;
    timestamps: RollingWindow<number>;
    sides: RollingWindow<"buy" | "sell">;

    // Superior price statistics (your Welford's algorithm)
    priceRollingMean: number;
    priceRollingVar: number;
    priceCount: number;

    // Basic state
    startTime: number;
    lastUpdate: number;
    tradeCount: number;

    // Liquidity tracking (your approach)
    currentPassiveBid: number;
    currentPassiveAsk: number;

    // Enhanced analytics
    volumeProfile: Map<number, number>;
    liquidityHistory: RollingWindow<number>;
    strengthScore: number;
    velocityScore: number;
    priceEffectScore: number;

    // Statistical validation
    statisticalSignificance: number;
    lastStatisticalUpdate: number;

    // Side tracking
    dominantSide: "buy" | "sell";
    sideConfidence: number;
}

export interface SuperiorFlowConditions {
    // Core metrics
    ratio: number;
    duration: number;
    aggressiveVolume: number;
    relevantPassive: number;
    totalPassive: number;

    // Enhanced analytics
    strength: number;
    velocity: number;
    priceEffect: number;
    statisticalSignificance: number;
    volumeConcentration: number;

    // Timing
    recentActivity: number;
    tradeCount: number;

    // Validation flags
    meetsMinDuration: boolean;
    meetsMinRatio: boolean;
    isRecentlyActive: boolean;

    // Side analysis
    dominantSide: "buy" | "sell";
    sideConfidence: number;

    // Market context
    marketVolatility: number;
    trendStrength: number;
}

export interface SignalCreationParams {
    zone: number;
    price: number;
    side: "buy" | "sell";
    score: number;
    conditions: SuperiorFlowConditions;
    volumes: {
        aggressive: number;
        passive: number;
    };
    zoneData: SuperiorZoneFlowData;
    marketRegime: MarketRegime;
}

interface DetailedFlowState {
    flowDirection: "accumulation" | "distribution";
    zones: Array<{
        zone: number;
        duration: number;
        ratio: number;
        strength: number;
        priceEffect: number;
        velocity: number;
        statisticalSignificance: number;
        tradeCount: number;
        isActive: boolean;
        dominantSide: "buy" | "sell";
        sideConfidence: number;
    }>;
    marketRegime: MarketRegime;
    summary: {
        totalZones: number;
        activeZones: number;
        strongZones: number;
        avgConfidence: number;
        avgRatio: number;
    };
    configuration: {
        minRatio: number;
        threshold: number;
        minDurationMs: number;
        strengthAnalysis: boolean;
        velocityAnalysis: boolean;
    };
}

interface ZoneAnalysisResult {
    zone: number;
    exists: boolean;
    analysis: SuperiorFlowConditions | null;
    recommendation:
        | "strong_flow"
        | "weak_flow"
        | "no_flow"
        | "developing"
        | "no_activity";
    confidence: number;
}

interface FlowSimulationParams {
    aggressiveVolume: number;
    passiveVolume: number;
    duration: number;
    strength?: number;
    velocity?: number;
    priceEffect?: number;
    statisticalSignificance?: number;
    volumeConcentration?: number;
    tradeCount?: number;
}

interface FlowSimulationResult {
    score: number;
    wouldSignal: boolean;
    breakdown: Record<string, number>;
    missingRequirements: string[];
    conditions: SuperiorFlowConditions;
}
