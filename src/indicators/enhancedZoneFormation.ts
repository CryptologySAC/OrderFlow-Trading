// src/indicators/enhancedZoneFormation.ts
/**
 * 🔒 PRODUCTION-READY - DO NOT MODIFY
 * ===================================
 *
 * STATUS: PRODUCTION-READY ✅
 * LAST_AUDIT: 2025-06-07
 * PERFORMANCE_OPTIMIZED: YES ✅
 * TRADING_LOGIC_VERIFIED: YES ✅
 * ERROR_HANDLING_COMPLETE: YES ✅
 *
 * WARNING: This file has undergone comprehensive production readiness review.
 * Any modifications require explicit approval and full regression testing.
 *
 * PROTECTION_LEVEL: CRITICAL
 * CLAUDE_CODE_INSTRUCTION: DO NOT MODIFY - CONTACT HUMAN FOR ANY CHANGES
 *
 * Key optimizations implemented:
 * - CircularBuffer for O(1) performance
 * - Comprehensive input validation
 * - Centralized configuration
 * - Proper error handling
 * - Memory management optimizations
 */

/**
 * CRITICAL: BuyerIsMaker Field Interpretation
 * ==========================================
 *
 * The buyerIsMaker field indicates WHO WAS THE MAKER (passive) vs TAKER (aggressive):
 *
 * buyerIsMaker = true:
 *   - Buyer placed passive limit order (maker)
 *   - Seller placed aggressive market/limit order (taker)
 *   - SELLER WAS THE AGGRESSOR - this represents SELLING PRESSURE
 *
 * buyerIsMaker = false:
 *   - Seller placed passive limit order (maker)
 *   - Buyer placed aggressive market/limit order (taker)
 *   - BUYER WAS THE AGGRESSOR - this represents BUYING PRESSURE
 *
 * INSTITUTIONAL ACCUMULATION LOGIC:
 * - We want institutions PASSIVELY buying (absorbing sells from retail)
 * - High sellVolume ratio = sells being absorbed by institutional bids ✅
 * - Low buyVolume ratio = minimal retail FOMO/aggressive buying ✅
 *
 * INSTITUTIONAL DISTRIBUTION LOGIC:
 * - We want institutions AGGRESSIVELY selling (into retail buy pressure)
 * - High sellVolume from buyerIsMaker=true = aggressive institutional selling ✅
 * - Low buyVolume = weak retail support ✅
 *
 * This interpretation has been validated against:
 * - Binance API documentation
 * - Market microstructure research
 * - Cross-exchange implementation patterns
 *
 * DO NOT INVERT THIS LOGIC - it is correct as implemented.
 */

import type { EnrichedTradeEvent } from "../types/marketEvents.js";
import { FinancialMath } from "../utils/financialMath.js";
import { Config } from "../core/config.js";

/**
 * Enhanced zone formation criteria based on institutional trading patterns
 */
export interface InstitutionalSignals {
    largeBlockRatio: number; // Ratio of trades above institutional size threshold
    icebergDetection: number; // Score for iceberg order patterns (0-1)
    volumeConsistency: number; // Consistency of volume flow over time
    priceEfficiency: number; // How well price holds during accumulation
    orderSizeDistribution: number; // Institutional vs retail order size patterns
    timeConsistency: number; // Sustained activity over time windows
}

/**
 * Market regime context for adaptive thresholds
 */
export interface MarketRegime {
    volatilityLevel: "low" | "medium" | "high";
    volumeLevel: "low" | "medium" | "high";
    trendStrength: number; // 0-1, strength of current trend
    marketPhase: "accumulation" | "distribution" | "trending" | "consolidation";
    volumeStdDev?: number;
}

/**
 * Enhanced zone candidate with institutional analysis
 */
export interface EnhancedZoneCandidate {
    // Basic metrics
    priceLevel: number;
    startTime: number;
    totalVolume: number;
    buyVolume: number;
    sellVolume: number;
    tradeCount: number;
    averageOrderSize: number;

    // Enhanced metrics
    institutionalSignals: InstitutionalSignals;
    marketRegime: MarketRegime;
    qualityScore: number;
    confidenceLevel: number;
}

/**
 * Parameters for distribution scoring calculation
 */
export interface DistributionScoreParams {
    aggressiveSellingRatio: number; // Aggressive selling ratio (want HIGH - 0.65-0.85+)
    supportBuyingRatio: number; // Support buying ratio (want LOW - <0.35)
    priceResilience: number; // Price holding despite selling (want HIGH - 0.75+)
    volume: number; // Total volume significance
    duration: number; // Duration of distribution activity
    averageOrderSize: number; // Average order size (institutional indicator)
    institutionalSignals: InstitutionalSignals; // Institutional activity metrics
    marketRegime: MarketRegime; // Market context for adaptive thresholds
}

/**
 * Parameters for accumulation scoring calculation
 */
export interface AccumulationScoreParams {
    absorptionRatio: number; // Sell volume being absorbed (want HIGH - 0.65-0.85+)
    aggressiveRatio: number; // Aggressive buying ratio (want LOW - <0.35)
    priceStability: number; // Price stability during absorption (want HIGH - 0.85+)
    volume: number; // Total volume significance
    duration: number; // Duration of accumulation activity
    averageOrderSize: number; // Average order size (institutional indicator)
    institutionalSignals: InstitutionalSignals; // Institutional activity metrics
    marketRegime: MarketRegime; // Market context for adaptive thresholds
}

/**
 * Score calculation result with detailed breakdown
 */
export interface ScoreResult {
    score: number;
    confidence: number;
    reasons: string[];
}

/**
 * Enhanced zone formation analyzer with institutional-grade criteria
 */
export class EnhancedZoneFormation {
    private readonly institutionalSizeThreshold: number;
    private readonly icebergDetectionWindow: number;
    private readonly minInstitutionalRatio: number;

    constructor(
        institutionalSizeThreshold?: number, // Trades above this are "institutional"
        icebergDetectionWindow?: number, // Window for iceberg pattern detection
        minInstitutionalRatio?: number // Min ratio of institutional trades
    ) {
        const instCfg = Config.ENHANCED_ZONE_FORMATION.institutional;
        this.institutionalSizeThreshold =
            institutionalSizeThreshold ?? instCfg.sizeThreshold;
        this.icebergDetectionWindow =
            icebergDetectionWindow ?? instCfg.detectionWindow;
        this.minInstitutionalRatio = minInstitutionalRatio ?? instCfg.minRatio;
    }

    /**
     * Analyze institutional signals in trade sequence
     */
    public analyzeInstitutionalSignals(
        trades: EnrichedTradeEvent[]
    ): InstitutionalSignals {
        if (trades.length < 5) {
            return {
                largeBlockRatio: 0,
                icebergDetection: 0,
                volumeConsistency: 0,
                priceEfficiency: 0,
                orderSizeDistribution: 0,
                timeConsistency: 0,
            };
        }

        return {
            largeBlockRatio: this.calculateLargeBlockRatio(trades),
            icebergDetection: this.detectIcebergPatterns(trades),
            volumeConsistency: this.calculateVolumeConsistency(trades),
            priceEfficiency: this.calculatePriceEfficiency(trades),
            orderSizeDistribution: this.analyzeOrderSizeDistribution(trades),
            timeConsistency: this.calculateTimeConsistency(trades),
        };
    }

    /**
     * Calculate ratio of large block trades (institutional indicator)
     */
    private calculateLargeBlockRatio(trades: EnrichedTradeEvent[]): number {
        const largeBlocks = trades.filter(
            (t) => t.quantity >= this.institutionalSizeThreshold
        );
        return largeBlocks.length / trades.length;
    }

    /**
     * CRITICAL FIX: Detect REAL iceberg patterns
     * Icebergs show as many small consistent fills, not large visible orders
     */
    private detectIcebergPatterns(trades: EnrichedTradeEvent[]): number {
        if (trades.length < this.icebergDetectionWindow) return 0;

        // Group trades by size to find consistent patterns
        const sizeFrequency = new Map<number, number>();
        const sideCount = { buy: 0, sell: 0 };

        for (const trade of trades) {
            const size = Math.round(trade.quantity * 100) / 100; // Round to avoid floating point issues
            sizeFrequency.set(size, (sizeFrequency.get(size) || 0) + 1);

            if (trade.buyerIsMaker) {
                sideCount.sell++;
            } else {
                sideCount.buy++;
            }
        }

        // Find most common trade size
        let maxFrequency = 0;
        let mostCommonSize = 0;
        for (const [size, frequency] of sizeFrequency.entries()) {
            if (frequency > maxFrequency) {
                maxFrequency = frequency;
                mostCommonSize = size;
            }
        }

        // Iceberg characteristics:
        // 1. High frequency of identical trade sizes (>60%)
        const sizeConsistency = maxFrequency / trades.length;

        // 2. One-sided flow (iceberg typically shows >70% same side)
        const totalTrades = sideCount.buy + sideCount.sell;
        const sideDominance =
            Math.max(sideCount.buy, sideCount.sell) / totalTrades;

        // 3. Reasonable trade size (not too small to be noise, not too large to be visible)
        const icebergCfg = Config.ENHANCED_ZONE_FORMATION.icebergDetection;
        const sizeScore =
            mostCommonSize >= icebergCfg.minSize &&
            mostCommonSize <= icebergCfg.maxSize
                ? 1
                : 0.5;

        // 4. Price stability during execution
        const prices = trades.map((t) => t.price);
        const priceRange = Math.max(...prices) - Math.min(...prices);
        const avgPrice = FinancialMath.calculateMean(prices);
        const priceStability =
            avgPrice > 0
                ? Math.max(
                      0,
                      1 -
                          priceRange /
                              avgPrice /
                              icebergCfg.priceStabilityTolerance
                  )
                : 0;

        // Combined iceberg score
        const icebergScore =
            (sizeConsistency > icebergCfg.sizeConsistencyThreshold
                ? sizeConsistency
                : 0) *
                0.4 +
            (sideDominance > icebergCfg.sideDominanceThreshold
                ? sideDominance
                : 0) *
                0.3 +
            priceStability * 0.2 +
            sizeScore * 0.1;

        return Math.min(1, icebergScore);
    }

    /**
     * Calculate volume flow consistency (steady accumulation vs erratic)
     */
    private calculateVolumeConsistency(trades: EnrichedTradeEvent[]): number {
        const timeWindows = Math.min(10, Math.floor(trades.length / 5));
        if (timeWindows < 3) return 0;

        const volumePerWindow = [];
        const windowSize = Math.floor(trades.length / timeWindows);

        for (let i = 0; i < timeWindows; i++) {
            const start = i * windowSize;
            const end = Math.min(start + windowSize, trades.length);
            const windowTrades = trades.slice(start, end);
            const windowVolume = windowTrades.reduce(
                (sum, t) => sum + t.quantity,
                0
            );
            volumePerWindow.push(windowVolume);
        }

        // Consistency = low standard deviation relative to mean
        const mean = FinancialMath.calculateMean(volumePerWindow);
        const stdDev = FinancialMath.calculateStdDev(volumePerWindow);

        return mean > 0 ? Math.max(0, 1 - stdDev / mean) : 0;
    }

    /**
     * PATCH: Fix calculatePriceEfficiency with realistic expectations
     */
    private calculatePriceEfficiency(trades: EnrichedTradeEvent[]): number {
        if (trades.length < 2) return 0;

        const firstPrice = trades[0].price;
        const lastPrice = trades[trades.length - 1].price;
        const totalVolume = trades.reduce((sum, t) => sum + t.quantity, 0);

        // More realistic price impact model
        const priceChange = Math.abs(lastPrice - firstPrice) / firstPrice;

        // Dynamic expected impact based on volume and market conditions
        // Institutional absorption should show minimal impact despite volume
        const priceEffCfg = Config.ENHANCED_ZONE_FORMATION.priceEfficiency;
        const volumeNormalized = Math.min(
            totalVolume / 1000,
            priceEffCfg.maxVolumeMultiplier
        );

        // Base impact varies by market conditions - now configurable
        const expectedPriceImpact =
            volumeNormalized * priceEffCfg.baseImpactRate;

        // Efficiency = actual impact much less than expected
        if (expectedPriceImpact === 0) {
            return priceChange < 0.001 ? 1 : priceEffCfg.minEfficiencyThreshold; // Configurable threshold
        }

        const efficiency = Math.max(0, 1 - priceChange / expectedPriceImpact);
        return Math.min(1, efficiency);
    }

    /**
     * Analyze order size distribution patterns
     */
    private analyzeOrderSizeDistribution(trades: EnrichedTradeEvent[]): number {
        const orderSizes = trades.map((t) => t.quantity);
        const median = FinancialMath.calculateMedian(orderSizes);
        const p75 = FinancialMath.calculatePercentile(orderSizes, 75);
        const p95 = FinancialMath.calculatePercentile(orderSizes, 95);

        // Institutional activity shows:
        // 1. Higher concentration in upper percentiles
        // 2. Significant gap between retail (median) and institutional (p95) sizes

        const retailSize = median;
        const institutionalSize = p95;
        const institutionalGap =
            institutionalSize > 0
                ? institutionalSize / Math.max(retailSize, 1)
                : 1;

        // Score based on institutional concentration
        const institutionalConcentration =
            orderSizes.filter((size) => size >= p75).length / orderSizes.length;

        return Math.min(
            1,
            (institutionalGap > 5 ? 0.5 : institutionalGap * 0.1) +
                institutionalConcentration * 0.5
        );
    }

    /**
     * Calculate time consistency (sustained activity over time)
     */
    private calculateTimeConsistency(trades: EnrichedTradeEvent[]): number {
        if (trades.length < 5) return 0;

        const duration =
            trades[trades.length - 1].timestamp - trades[0].timestamp;
        const timeWindows = Math.min(10, Math.floor(duration / 60000)); // 1-minute windows

        if (timeWindows < 3) return 0;

        const windowDuration = duration / timeWindows;
        const tradesPerWindow = [];

        for (let i = 0; i < timeWindows; i++) {
            const windowStart = trades[0].timestamp + i * windowDuration;
            const windowEnd = windowStart + windowDuration;

            const windowTrades = trades.filter(
                (t) => t.timestamp >= windowStart && t.timestamp < windowEnd
            );

            tradesPerWindow.push(windowTrades.length);
        }

        // Consistency = low variance in activity across time windows
        const mean = FinancialMath.calculateMean(tradesPerWindow);
        const stdDev = FinancialMath.calculateStdDev(tradesPerWindow);

        return mean > 0 ? Math.max(0, 1 - stdDev / mean) : 0;
    }

    /**
     * DISTRIBUTION-SPECIFIC scoring algorithm with proper semantic parameters
     * Designed specifically for institutional distribution pattern detection
     */
    public calculateDistributionScore(
        aggressiveSellingRatio: number, // Aggressive selling ratio (want HIGH - 0.65-0.85+)
        supportBuyingRatio: number, // Support buying ratio (want LOW - <0.35)
        priceResilience: number, // Price holding despite selling (want HIGH - 0.75+)
        volume: number, // Total volume significance
        duration: number, // Duration of distribution activity
        averageOrderSize: number, // Average order size (institutional indicator)
        institutionalSignals: InstitutionalSignals, // Institutional activity metrics
        marketRegime: MarketRegime // Market context for adaptive thresholds
    ): ScoreResult;

    /**
     * DISTRIBUTION-SPECIFIC scoring algorithm with parameter object (recommended)
     */
    public calculateDistributionScore(
        params: DistributionScoreParams
    ): ScoreResult;

    /**
     * ⚠️ ALGORITHMIC INTEGRITY PROTECTED
     * This scoring algorithm has been validated for institutional trading patterns.
     * Modifications may break trading logic - human approval required.
     */
    public calculateDistributionScore(
        aggressiveSellingRatioOrParams: number | DistributionScoreParams,
        supportBuyingRatio?: number,
        priceResilience?: number,
        volume?: number,
        duration?: number,
        averageOrderSize?: number,
        institutionalSignals?: InstitutionalSignals,
        marketRegime?: MarketRegime
    ): ScoreResult {
        // Handle both parameter formats
        const params: DistributionScoreParams =
            typeof aggressiveSellingRatioOrParams === "object"
                ? aggressiveSellingRatioOrParams
                : {
                      aggressiveSellingRatio: aggressiveSellingRatioOrParams,
                      supportBuyingRatio: supportBuyingRatio!,
                      priceResilience: priceResilience!,
                      volume: volume!,
                      duration: duration!,
                      averageOrderSize: averageOrderSize!,
                      institutionalSignals: institutionalSignals!,
                      marketRegime: marketRegime!,
                  };

        // Calculate base score components
        const baseScore = this.calculateBaseDistributionScore(params);

        // Calculate bonuses and adjustments
        const bonuses = this.calculateDistributionBonuses(params);
        const adjustments = this.applyDistributionRegimeAdjustments(
            params.marketRegime
        );

        // Apply quality gates and final adjustments
        return this.finalizeDistributionScore(
            baseScore,
            bonuses,
            adjustments,
            params
        );
    }

    /**
     * Calculate base distribution score components
     * Handles primary scoring factors: selling dominance, support penalty, price resilience, institutional signals
     */
    private calculateBaseDistributionScore(params: DistributionScoreParams): {
        score: number;
        confidence: number;
        reasons: string[];
    } {
        const reasons: string[] = [];
        let score = 0;
        let confidence = 0;

        const adaptiveThresholds = this.getDistributionThresholds(
            params.marketRegime
        );

        // 1. AGGRESSIVE SELLING DOMINANCE (40% weight - PRIMARY FACTOR)
        const sellingResult = this.calculateSellingDominanceScore(
            params,
            adaptiveThresholds
        );
        score += sellingResult.score;
        confidence += sellingResult.confidence;
        reasons.push(...sellingResult.reasons);

        // 2. SUPPORT BUYING PENALTY (20% weight - RESISTANCE FACTOR)
        const supportResult = this.calculateSupportBuyingScore(
            params,
            adaptiveThresholds
        );
        score += supportResult.score;
        confidence += supportResult.confidence;
        reasons.push(...supportResult.reasons);

        // 3. PRICE RESILIENCE DURING SELLING (20% weight - ABSORPTION QUALITY)
        const resilienceResult = this.calculatePriceResilienceScore(params);
        score += resilienceResult.score;
        confidence += resilienceResult.confidence;
        reasons.push(...resilienceResult.reasons);

        // 4. INSTITUTIONAL SIGNALS (15% weight - QUALITY FACTOR)
        const instResult = this.calculateInstitutionalSignalsScore(params);
        score += instResult.score;
        confidence += instResult.confidence;
        reasons.push(...instResult.reasons);

        return { score, confidence, reasons };
    }

    /**
     * Calculate distribution bonuses and additional factors
     * Handles volume intensity, time urgency, efficiency bonuses
     */
    private calculateDistributionBonuses(params: DistributionScoreParams): {
        score: number;
        confidence: number;
        reasons: string[];
    } {
        const reasons: string[] = [];
        let score = 0;
        let confidence = 0;

        const adaptiveThresholds = this.getDistributionThresholds(
            params.marketRegime
        );

        // 5. VOLUME INTENSITY (3% weight - URGENCY FACTOR)
        const volumeScore = Math.min(
            1,
            params.volume / adaptiveThresholds.significantVolume
        );
        score += volumeScore * 0.03;
        confidence += volumeScore * 0.03;

        if (params.volume >= adaptiveThresholds.significantVolume * 1.5) {
            reasons.push("High volume distribution detected");
        }

        // 6. TIME URGENCY (2% weight - SPEED FACTOR)
        const urgencyScore = Math.min(
            1,
            adaptiveThresholds.optimalDuration /
                Math.max(params.duration, 60000)
        );
        score += urgencyScore * 0.02;
        confidence += urgencyScore * 0.02;

        if (params.duration < adaptiveThresholds.optimalDuration * 0.5) {
            reasons.push("Rapid distribution pattern");
        }

        // 7. DISTRIBUTION EFFICIENCY BONUS
        const distributionEfficiency = this.calculateDistributionEfficiency(
            params.aggressiveSellingRatio,
            params.supportBuyingRatio,
            params.priceResilience
        );

        if (distributionEfficiency > 0.1) {
            score += distributionEfficiency * 0.08; // Up to 8% bonus
            confidence += distributionEfficiency * 0.12;
            reasons.push("High distribution efficiency detected");
        }

        // 8. SELLING PRESSURE INTENSITY BONUS
        const sellingIntensity =
            params.aggressiveSellingRatio /
            Math.max(params.duration / 300000, 0.5);
        if (sellingIntensity > 1.5) {
            score += 0.04;
            reasons.push("High selling pressure intensity");
        }

        return { score, confidence, reasons };
    }

    /**
     * Apply market regime adjustments to distribution scoring
     */
    private applyDistributionRegimeAdjustments(marketRegime: MarketRegime): {
        scoreMultiplier: number;
        confidenceMultiplier: number;
        reasons: string[];
    } {
        const reasons: string[] = [];
        const regimeAdjustment =
            this.getDistributionRegimeAdjustment(marketRegime);

        if (regimeAdjustment.scoreMultiplier > 1.05) {
            reasons.push("Favorable conditions for distribution");
        } else if (regimeAdjustment.scoreMultiplier < 0.95) {
            reasons.push("Challenging distribution environment");
        }

        return {
            scoreMultiplier: regimeAdjustment.scoreMultiplier,
            confidenceMultiplier: regimeAdjustment.confidenceMultiplier,
            reasons,
        };
    }

    /**
     * Finalize distribution score with quality gates and confidence boosters
     */
    private finalizeDistributionScore(
        baseScore: { score: number; confidence: number; reasons: string[] },
        bonuses: { score: number; confidence: number; reasons: string[] },
        adjustments: {
            scoreMultiplier: number;
            confidenceMultiplier: number;
            reasons: string[];
        },
        params: DistributionScoreParams
    ): ScoreResult {
        let score = baseScore.score + bonuses.score;
        let confidence = baseScore.confidence + bonuses.confidence;
        const reasons = [
            ...baseScore.reasons,
            ...bonuses.reasons,
            ...adjustments.reasons,
        ];

        // Apply market regime adjustments
        score *= adjustments.scoreMultiplier;
        confidence *= adjustments.confidenceMultiplier;

        // Quality gates
        if (score > 0.65) {
            if (
                params.aggressiveSellingRatio < 0.65 ||
                params.priceResilience < 0.7
            ) {
                score *= 0.85;
                reasons.push("Distribution score adjusted for consistency");
            }
        }

        // Confidence boosters
        if (
            params.aggressiveSellingRatio > 0.78 &&
            params.supportBuyingRatio < 0.25 &&
            params.priceResilience > 0.8
        ) {
            confidence *= 1.15;
            reasons.push("Clear institutional distribution pattern");
        }

        return {
            score: Math.min(1, Math.max(0, score)),
            confidence: Math.min(1, Math.max(0, confidence)),
            reasons: reasons.slice(0, 8),
        };
    }

    /**
     * Calculate selling dominance score component
     */
    private calculateSellingDominanceScore(
        params: DistributionScoreParams,
        adaptiveThresholds: {
            minAggressiveSellingRatio: number;
            maxSupportBuyingRatio: number;
            significantVolume: number;
            optimalDuration: number;
        }
    ): { score: number; confidence: number; reasons: string[] } {
        const reasons: string[] = [];
        let score = 0;
        let confidence = 0;

        if (
            params.aggressiveSellingRatio >=
            adaptiveThresholds.minAggressiveSellingRatio
        ) {
            const excessSelling =
                params.aggressiveSellingRatio -
                adaptiveThresholds.minAggressiveSellingRatio;
            const maxPossibleExcess =
                1 - adaptiveThresholds.minAggressiveSellingRatio;
            const sellingScore = Math.pow(
                excessSelling / maxPossibleExcess,
                0.9
            );

            score += sellingScore * 0.4;
            confidence += sellingScore * 0.45;
            reasons.push(
                `Strong aggressive selling: ${(params.aggressiveSellingRatio * 100).toFixed(1)}%`
            );

            if (params.aggressiveSellingRatio > 0.8) {
                score += 0.06;
                confidence += 0.12;
                reasons.push("Intense distribution pressure detected");
            }
        } else {
            const sellingDeficit =
                (adaptiveThresholds.minAggressiveSellingRatio -
                    params.aggressiveSellingRatio) *
                1.8;
            score = Math.max(0, score - sellingDeficit);
            reasons.push(
                `Insufficient selling pressure: ${(params.aggressiveSellingRatio * 100).toFixed(1)}%`
            );
        }

        return { score, confidence, reasons };
    }

    /**
     * Calculate support buying score component
     */
    private calculateSupportBuyingScore(
        params: DistributionScoreParams,
        adaptiveThresholds: {
            minAggressiveSellingRatio: number;
            maxSupportBuyingRatio: number;
            significantVolume: number;
            optimalDuration: number;
        }
    ): { score: number; confidence: number; reasons: string[] } {
        const reasons: string[] = [];
        const supportPenalty = Math.min(
            params.supportBuyingRatio /
                adaptiveThresholds.maxSupportBuyingRatio,
            1
        );
        const supportScore = Math.max(0, 1 - supportPenalty * 1.3);

        const score = supportScore * 0.2;
        const confidence = supportScore * 0.15;

        if (
            params.supportBuyingRatio <=
            adaptiveThresholds.maxSupportBuyingRatio
        ) {
            reasons.push(
                `Weak support buying: ${(params.supportBuyingRatio * 100).toFixed(1)}%`
            );
        } else {
            reasons.push(
                `Strong support detected: ${(params.supportBuyingRatio * 100).toFixed(1)}% (reduces score)`
            );
        }

        return { score, confidence, reasons };
    }

    /**
     * Calculate price resilience score component
     */
    private calculatePriceResilienceScore(params: DistributionScoreParams): {
        score: number;
        confidence: number;
        reasons: string[];
    } {
        const reasons: string[] = [];
        const resilienceScore = Math.pow(params.priceResilience, 1.2);
        const score = resilienceScore * 0.2;
        const confidence = resilienceScore * 0.15;

        if (params.priceResilience > 0.85) {
            reasons.push("Excellent price resilience during selling");
        } else if (params.priceResilience > 0.75) {
            reasons.push("Good price control during distribution");
        } else {
            reasons.push("Price weakness reduces distribution quality");
        }

        return { score, confidence, reasons };
    }

    /**
     * Calculate institutional signals score component
     */
    private calculateInstitutionalSignalsScore(
        params: DistributionScoreParams
    ): {
        score: number;
        confidence: number;
        reasons: string[];
    } {
        const reasons: string[] = [];
        const instScore = this.calculateDistributionInstitutionalScore(
            params.institutionalSignals
        );
        const score = instScore * 0.15;
        const confidence = instScore * 0.2;

        if (instScore > 0.6) {
            reasons.push("Strong institutional distribution signals");
        } else if (instScore > 0.4) {
            reasons.push("Moderate institutional activity");
        }

        if (params.institutionalSignals.largeBlockRatio > 0.25) {
            reasons.push(
                `Large distribution blocks: ${(params.institutionalSignals.largeBlockRatio * 100).toFixed(1)}%`
            );
        }

        if (params.institutionalSignals.volumeConsistency > 0.7) {
            reasons.push("Coordinated selling pattern detected");
        }

        return { score, confidence, reasons };
    }

    /**
     * Calculate distribution-specific institutional score
     * Distribution patterns differ from accumulation patterns
     */
    private calculateDistributionInstitutionalScore(
        signals: InstitutionalSignals
    ): number {
        // Distribution weights differ from accumulation
        return (
            signals.largeBlockRatio * 0.25 + // Less weight than accumulation
            signals.volumeConsistency * 0.3 + // More important for distribution
            signals.priceEfficiency * 0.2 + // Price control during selling
            signals.orderSizeDistribution * 0.15 + // Size distribution matters
            signals.icebergDetection * 0.1 // Less relevant for distribution
        );
    }

    /**
     * Get distribution-specific adaptive thresholds
     */
    private getDistributionThresholds(regime: MarketRegime) {
        const detectorCfg =
            Config.ENHANCED_ZONE_FORMATION.detectorThresholds.distribution;
        const base = {
            minAggressiveSellingRatio: detectorCfg.minSellingRatio, // Configurable aggressive selling
            maxSupportBuyingRatio: detectorCfg.maxSupportRatio, // Configurable support buying
            significantVolume: 400, // Higher volume threshold than accumulation
            optimalDuration: 300000, // 5 minutes optimal (faster than accumulation)
        };

        // Adjust based on market conditions
        switch (regime.volatilityLevel) {
            case "high":
                const highThresholds =
                    Config.ENHANCED_ZONE_FORMATION.adaptiveThresholds.volatility
                        .high.distribution;
                return {
                    ...base,
                    minAggressiveSellingRatio: highThresholds.minSellingRatio,
                    maxSupportBuyingRatio: highThresholds.maxSupportRatio,
                    significantVolume: 600, // Higher volume requirement
                    optimalDuration: 240000, // Faster distribution expected
                };
            case "low":
                const lowThresholds =
                    Config.ENHANCED_ZONE_FORMATION.adaptiveThresholds.volatility
                        .low.distribution;
                return {
                    ...base,
                    minAggressiveSellingRatio: lowThresholds.minSellingRatio,
                    maxSupportBuyingRatio: lowThresholds.maxSupportRatio,
                    significantVolume: 300, // Lower volume requirement
                    optimalDuration: 450000, // Slower distribution acceptable
                };
            default:
                return base;
        }
    }

    /**
     * Calculate distribution efficiency bonus
     */
    private calculateDistributionEfficiency(
        aggressiveSellingRatio: number,
        supportBuyingRatio: number,
        priceResilience: number
    ): number {
        // Perfect distribution: High selling + Low support + Good price control
        const sellingComponent =
            Math.max(0, aggressiveSellingRatio - 0.65) / 0.35; // 0-1 scale above 65%
        const supportComponent = Math.max(0, 0.35 - supportBuyingRatio) / 0.35; // 0-1 scale below 35%
        const resilienceComponent = Math.max(0, priceResilience - 0.75) / 0.25; // 0-1 scale above 75%

        // Geometric mean for balanced efficiency
        return Math.pow(
            sellingComponent * supportComponent * resilienceComponent,
            1 / 3
        );
    }

    /**
     * Get distribution-specific market regime adjustments
     */
    private getDistributionRegimeAdjustment(regime: MarketRegime) {
        let scoreMultiplier = 1.0;
        let confidenceMultiplier = 1.0;

        // Adjust based on market phase
        switch (regime.marketPhase) {
            case "distribution":
                scoreMultiplier = 1.2; // 20% boost in distribution phase
                confidenceMultiplier = 1.25; // 25% confidence boost
                break;
            case "accumulation":
                scoreMultiplier = 0.7; // 30% reduction in accumulation phase
                confidenceMultiplier = 0.75; // 25% confidence reduction
                break;
            case "trending":
                if (regime.trendStrength > 0.6) {
                    scoreMultiplier = 0.8; // Trending down may mask distribution
                    confidenceMultiplier = 0.85;
                } else {
                    scoreMultiplier = 0.9; // Weak trend
                    confidenceMultiplier = 0.9;
                }
                break;
            case "consolidation":
                scoreMultiplier = 1.1; // 10% boost in consolidation
                confidenceMultiplier = 1.15; // 15% confidence boost
                break;
        }

        // Volume regime adjustments
        if (regime.volumeLevel === "high") {
            scoreMultiplier *= 1.15; // Distribution often comes with high volume
            confidenceMultiplier *= 1.2;
        } else if (regime.volumeLevel === "low") {
            scoreMultiplier *= 0.85; // Low volume distribution is less reliable
            confidenceMultiplier *= 0.8;
        }

        // Volatility adjustments (distribution creates volatility)
        if (regime.volatilityLevel === "medium") {
            // Medium volatility is optimal for distribution detection
            scoreMultiplier *= 1.05;
            confidenceMultiplier *= 1.1;
        } else if (regime.volatilityLevel === "low") {
            // Low volatility may indicate weak distribution
            scoreMultiplier *= 0.9;
            confidenceMultiplier *= 0.85;
        }
        // High volatility is neutral (could be distribution or other factors)

        return { scoreMultiplier, confidenceMultiplier };
    }

    /**
     * ACCUMULATION-SPECIFIC scoring algorithm with proper semantic parameters
     * Designed specifically for institutional accumulation pattern detection
     */
    public calculateAccumulationScore(
        absorptionRatio: number, // Sell volume being absorbed (want HIGH - 0.65-0.85+)
        aggressiveRatio: number, // Aggressive buying ratio (want LOW - <0.35)
        priceStability: number, // Price stability during absorption (want HIGH - 0.85+)
        volume: number, // Total volume significance
        duration: number, // Duration of accumulation activity
        averageOrderSize: number, // Average order size (institutional indicator)
        institutionalSignals: InstitutionalSignals, // Institutional activity metrics
        marketRegime: MarketRegime // Market context for adaptive thresholds
    ): ScoreResult;

    /**
     * ACCUMULATION-SPECIFIC scoring algorithm with parameter object (recommended)
     */
    public calculateAccumulationScore(
        params: AccumulationScoreParams
    ): ScoreResult;

    /**
     * ⚠️ ALGORITHMIC INTEGRITY PROTECTED
     * This scoring algorithm has been validated for institutional trading patterns.
     * Modifications may break trading logic - human approval required.
     */
    public calculateAccumulationScore(
        absorptionRatioOrParams: number | AccumulationScoreParams,
        aggressiveRatio?: number,
        priceStability?: number,
        volume?: number,
        duration?: number,
        averageOrderSize?: number,
        institutionalSignals?: InstitutionalSignals,
        marketRegime?: MarketRegime
    ): ScoreResult {
        // Handle both parameter formats
        const params: AccumulationScoreParams =
            typeof absorptionRatioOrParams === "object"
                ? absorptionRatioOrParams
                : {
                      absorptionRatio: absorptionRatioOrParams,
                      aggressiveRatio: aggressiveRatio!,
                      priceStability: priceStability!,
                      volume: volume!,
                      duration: duration!,
                      averageOrderSize: averageOrderSize!,
                      institutionalSignals: institutionalSignals!,
                      marketRegime: marketRegime!,
                  };

        // Calculate base score components
        const baseScore = this.calculateBaseAccumulationScore(params);

        // Calculate bonuses and adjustments
        const bonuses = this.calculateAccumulationBonuses(params);
        const adjustments = this.applyAccumulationRegimeAdjustments(
            params.marketRegime
        );

        // Apply quality gates and final adjustments
        return this.finalizeAccumulationScore(
            baseScore,
            bonuses,
            adjustments,
            params
        );
    }

    /**
     * Calculate base accumulation score components
     * Handles primary scoring factors: absorption dominance, aggressive buying penalty, institutional signals, price stability
     */
    private calculateBaseAccumulationScore(params: AccumulationScoreParams): {
        score: number;
        confidence: number;
        reasons: string[];
    } {
        const reasons: string[] = [];
        let score = 0;
        let confidence = 0;

        const adaptiveThresholds = this.getAccumulationThresholds(
            params.marketRegime
        );

        // 1. ABSORPTION DOMINANCE SCORING (35% weight - PRIMARY FACTOR)
        const absorptionResult = this.calculateAbsorptionDominanceScore(
            params,
            adaptiveThresholds
        );
        score += absorptionResult.score;
        confidence += absorptionResult.confidence;
        reasons.push(...absorptionResult.reasons);

        // 2. AGGRESSIVE BUYING PENALTY (25% weight - PENALTY FACTOR)
        const aggressiveResult = this.calculateAggressiveBuyingScore(
            params,
            adaptiveThresholds
        );
        score += aggressiveResult.score;
        confidence += aggressiveResult.confidence;
        reasons.push(...aggressiveResult.reasons);

        // 3. INSTITUTIONAL SIGNALS (20% weight - QUALITY FACTOR)
        const instResult =
            this.calculateAccumulationInstitutionalSignalsScore(params);
        score += instResult.score;
        confidence += instResult.confidence;
        reasons.push(...instResult.reasons);

        // 4. PRICE STABILITY DURING ABSORPTION (15% weight - EFFICIENCY FACTOR)
        const stabilityResult =
            this.calculateAccumulationPriceStabilityScore(params);
        score += stabilityResult.score;
        confidence += stabilityResult.confidence;
        reasons.push(...stabilityResult.reasons);

        return { score, confidence, reasons };
    }

    /**
     * Calculate accumulation bonuses and additional factors
     * Handles volume significance, duration consistency, efficiency bonuses
     */
    private calculateAccumulationBonuses(params: AccumulationScoreParams): {
        score: number;
        confidence: number;
        reasons: string[];
    } {
        const reasons: string[] = [];
        let score = 0;
        let confidence = 0;

        const adaptiveThresholds = this.getAccumulationThresholds(
            params.marketRegime
        );

        // 5. VOLUME SIGNIFICANCE (3% weight - SCALE FACTOR)
        const volumeScore = Math.min(
            1,
            params.volume / adaptiveThresholds.significantVolume
        );
        score += volumeScore * 0.03;
        confidence += volumeScore * 0.03;

        if (params.volume >= adaptiveThresholds.significantVolume) {
            reasons.push("Significant volume detected");
        }

        // 6. DURATION CONSISTENCY (2% weight - PERSISTENCE FACTOR)
        const durationScore = Math.min(
            1,
            Math.sqrt(params.duration / adaptiveThresholds.optimalDuration)
        );
        score += durationScore * 0.02;
        confidence += durationScore * 0.02;

        // 7. ABSORPTION EFFICIENCY BONUS
        const efficiencyBonus = this.calculateAbsorptionEfficiency(
            params.absorptionRatio,
            params.aggressiveRatio,
            params.priceStability
        );

        if (efficiencyBonus > 0.1) {
            score += efficiencyBonus * 0.1; // Up to 10% bonus
            confidence += efficiencyBonus * 0.15;
            reasons.push("High absorption efficiency detected");
        }

        return { score, confidence, reasons };
    }

    /**
     * Apply market regime adjustments to accumulation scoring
     */
    private applyAccumulationRegimeAdjustments(marketRegime: MarketRegime): {
        scoreMultiplier: number;
        confidenceMultiplier: number;
        reasons: string[];
    } {
        const reasons: string[] = [];
        const regimeAdjustment =
            this.getAccumulationRegimeAdjustment(marketRegime);

        if (regimeAdjustment.scoreMultiplier > 1.05) {
            reasons.push("Favorable market conditions for accumulation");
        } else if (regimeAdjustment.scoreMultiplier < 0.95) {
            reasons.push("Challenging market conditions");
        }

        return {
            scoreMultiplier: regimeAdjustment.scoreMultiplier,
            confidenceMultiplier: regimeAdjustment.confidenceMultiplier,
            reasons,
        };
    }

    /**
     * Finalize accumulation score with quality gates and confidence boosters
     */
    private finalizeAccumulationScore(
        baseScore: { score: number; confidence: number; reasons: string[] },
        bonuses: { score: number; confidence: number; reasons: string[] },
        adjustments: {
            scoreMultiplier: number;
            confidenceMultiplier: number;
            reasons: string[];
        },
        params: AccumulationScoreParams
    ): ScoreResult {
        let score = baseScore.score + bonuses.score;
        let confidence = baseScore.confidence + bonuses.confidence;
        const reasons = [
            ...baseScore.reasons,
            ...bonuses.reasons,
            ...adjustments.reasons,
        ];

        // Apply market regime adjustments
        score *= adjustments.scoreMultiplier;
        confidence *= adjustments.confidenceMultiplier;

        // Quality gates
        if (score > 0.7) {
            const instScore = this.calculateInstitutionalScore(
                params.institutionalSignals
            );
            if (
                params.absorptionRatio < 0.7 ||
                params.priceStability < 0.8 ||
                instScore < 0.4
            ) {
                score *= 0.8;
                reasons.push("High score adjusted for consistency");
            }
        }

        // Confidence boosters
        if (
            params.absorptionRatio > 0.8 &&
            params.aggressiveRatio < 0.2 &&
            params.priceStability > 0.9
        ) {
            confidence *= 1.2;
            reasons.push("Textbook accumulation pattern");
        }

        return {
            score: Math.min(1, Math.max(0, score)),
            confidence: Math.min(1, Math.max(0, confidence)),
            reasons: reasons.slice(0, 8),
        };
    }

    /**
     * Calculate absorption dominance score component
     */
    private calculateAbsorptionDominanceScore(
        params: AccumulationScoreParams,
        adaptiveThresholds: {
            minAbsorptionRatio: number;
            maxAggressiveRatio: number;
            significantVolume: number;
            optimalDuration: number;
        }
    ): { score: number; confidence: number; reasons: string[] } {
        const reasons: string[] = [];
        let score = 0;
        let confidence = 0;

        if (params.absorptionRatio >= adaptiveThresholds.minAbsorptionRatio) {
            const excessAbsorption =
                params.absorptionRatio - adaptiveThresholds.minAbsorptionRatio;
            const maxPossibleExcess = 1 - adaptiveThresholds.minAbsorptionRatio;
            const absorptionScore = Math.pow(
                excessAbsorption / maxPossibleExcess,
                0.8
            );

            score += absorptionScore * 0.35;
            confidence += absorptionScore * 0.4;
            reasons.push(
                `Strong sell absorption: ${(params.absorptionRatio * 100).toFixed(1)}%`
            );

            if (params.absorptionRatio > 0.8) {
                score += 0.05;
                confidence += 0.1;
                reasons.push("Exceptional absorption pattern detected");
            }
        } else {
            const absorptionDeficit =
                (adaptiveThresholds.minAbsorptionRatio -
                    params.absorptionRatio) *
                2;
            score = Math.max(0, score - absorptionDeficit);
            reasons.push(
                `Insufficient sell absorption: ${(params.absorptionRatio * 100).toFixed(1)}%`
            );
        }

        return { score, confidence, reasons };
    }

    /**
     * Calculate aggressive buying score component
     */
    private calculateAggressiveBuyingScore(
        params: AccumulationScoreParams,
        adaptiveThresholds: {
            minAbsorptionRatio: number;
            maxAggressiveRatio: number;
            significantVolume: number;
            optimalDuration: number;
        }
    ): { score: number; confidence: number; reasons: string[] } {
        const reasons: string[] = [];
        const aggressivePenalty = Math.min(
            params.aggressiveRatio / adaptiveThresholds.maxAggressiveRatio,
            1
        );
        const aggressiveScore = Math.max(0, 1 - aggressivePenalty * 1.5);

        const score = aggressiveScore * 0.25;
        const confidence = aggressiveScore * 0.2;

        if (params.aggressiveRatio <= adaptiveThresholds.maxAggressiveRatio) {
            reasons.push(
                `Low aggressive buying: ${(params.aggressiveRatio * 100).toFixed(1)}%`
            );
        } else {
            reasons.push(
                `Excessive aggressive buying: ${(params.aggressiveRatio * 100).toFixed(1)}% (reduces score)`
            );
        }

        return { score, confidence, reasons };
    }

    /**
     * Calculate accumulation institutional signals score component
     */
    private calculateAccumulationInstitutionalSignalsScore(
        params: AccumulationScoreParams
    ): {
        score: number;
        confidence: number;
        reasons: string[];
    } {
        const reasons: string[] = [];
        const instScore = this.calculateInstitutionalScore(
            params.institutionalSignals
        );
        const score = instScore * 0.2;
        const confidence = instScore * 0.25;

        if (instScore > 0.6) {
            reasons.push("Strong institutional activity detected");
        } else if (instScore > 0.4) {
            reasons.push("Moderate institutional activity");
        } else {
            reasons.push("Limited institutional signals");
        }

        if (params.institutionalSignals.largeBlockRatio > 0.3) {
            reasons.push(
                `Large block trades: ${(params.institutionalSignals.largeBlockRatio * 100).toFixed(1)}%`
            );
        }

        if (params.institutionalSignals.icebergDetection > 0.5) {
            reasons.push("Iceberg order patterns detected");
        }

        return { score, confidence, reasons };
    }

    /**
     * Calculate accumulation price stability score component
     */
    private calculateAccumulationPriceStabilityScore(
        params: AccumulationScoreParams
    ): {
        score: number;
        confidence: number;
        reasons: string[];
    } {
        const reasons: string[] = [];
        const stabilityScore = Math.pow(params.priceStability, 1.5);
        const score = stabilityScore * 0.15;
        const confidence = stabilityScore * 0.1;

        if (params.priceStability > 0.9) {
            reasons.push("Excellent price stability during absorption");
        } else if (params.priceStability > 0.8) {
            reasons.push("Good price stability");
        } else {
            reasons.push("Price instability reduces confidence");
        }

        return { score, confidence, reasons };
    }

    /**
     * Get accumulation-specific adaptive thresholds
     */
    private getAccumulationThresholds(regime: MarketRegime) {
        const detectorCfg =
            Config.ENHANCED_ZONE_FORMATION.detectorThresholds.accumulation;
        const base = {
            minAbsorptionRatio: detectorCfg.minAbsorptionRatio, // Configurable sell absorption
            maxAggressiveRatio: detectorCfg.maxAggressiveRatio, // Configurable aggressive buying
            significantVolume: 300, // Volume threshold
            optimalDuration: 600000, // 10 minutes optimal duration
        };

        // Adjust based on market conditions
        switch (regime.volatilityLevel) {
            case "high":
                const highAccumThresholds =
                    Config.ENHANCED_ZONE_FORMATION.adaptiveThresholds.volatility
                        .high.accumulation;
                return {
                    ...base,
                    minAbsorptionRatio: highAccumThresholds.minAbsorptionRatio,
                    maxAggressiveRatio: highAccumThresholds.maxAggressiveRatio,
                    significantVolume: 500, // Higher volume requirement
                };
            case "low":
                const lowAccumThresholds =
                    Config.ENHANCED_ZONE_FORMATION.adaptiveThresholds.volatility
                        .low.accumulation;
                return {
                    ...base,
                    minAbsorptionRatio: lowAccumThresholds.minAbsorptionRatio,
                    maxAggressiveRatio: lowAccumThresholds.maxAggressiveRatio,
                    significantVolume: 200, // Lower volume requirement
                };
            default:
                return base;
        }
    }

    /**
     * Calculate absorption efficiency bonus
     */
    private calculateAbsorptionEfficiency(
        absorptionRatio: number,
        aggressiveRatio: number,
        priceStability: number
    ): number {
        // Perfect efficiency: High absorption + Low aggression + High stability
        const absorptionComponent = Math.max(0, absorptionRatio - 0.7) / 0.3; // 0-1 scale above 70%
        const aggressiveComponent = Math.max(0, 0.3 - aggressiveRatio) / 0.3; // 0-1 scale below 30%
        const stabilityComponent = Math.max(0, priceStability - 0.8) / 0.2; // 0-1 scale above 80%

        // Geometric mean for balanced efficiency (all components must be good)
        return Math.pow(
            absorptionComponent * aggressiveComponent * stabilityComponent,
            1 / 3
        );
    }

    /**
     * Get accumulation-specific market regime adjustments
     */
    private getAccumulationRegimeAdjustment(regime: MarketRegime) {
        let scoreMultiplier = 1.0;
        let confidenceMultiplier = 1.0;

        // Adjust based on market phase
        switch (regime.marketPhase) {
            case "accumulation":
                scoreMultiplier = 1.15; // 15% boost in accumulation phase
                confidenceMultiplier = 1.2; // 20% confidence boost
                break;
            case "distribution":
                scoreMultiplier = 0.7; // 30% reduction in distribution phase
                confidenceMultiplier = 0.8; // 20% confidence reduction
                break;
            case "trending":
                scoreMultiplier = 0.75; // 25% reduction in trending markets
                confidenceMultiplier = 0.85; // 15% confidence reduction
                break;
            case "consolidation":
                scoreMultiplier = 1.05; // 5% boost in consolidation
                confidenceMultiplier = 1.1; // 10% confidence boost
                break;
        }

        // Adjust based on volume regime
        if (regime.volumeLevel === "high") {
            scoreMultiplier *= 1.1; // Higher confidence with more data
            confidenceMultiplier *= 1.15;
        } else if (regime.volumeLevel === "low") {
            scoreMultiplier *= 0.9; // Lower confidence with sparse data
            confidenceMultiplier *= 0.85;
        }

        // Volatility adjustments
        if (regime.volatilityLevel === "low") {
            // Low volatility is better for detecting accumulation
            scoreMultiplier *= 1.05;
            confidenceMultiplier *= 1.1;
        } else if (regime.volatilityLevel === "high") {
            // High volatility makes detection harder
            scoreMultiplier *= 0.95;
            confidenceMultiplier *= 0.9;
        }

        return { scoreMultiplier, confidenceMultiplier };
    }

    /**
     * Enhanced scoring algorithm with institutional factors
     */
    public calculateEnhancedScore(
        buyRatio: number,
        sellRatio: number,
        priceStability: number,
        volume: number,
        duration: number,
        averageOrderSize: number,
        institutionalSignals: InstitutionalSignals,
        marketRegime: MarketRegime
    ): { score: number; confidence: number; reasons: string[] } {
        const reasons: string[] = [];
        let score = 0;
        let confidence = 0;

        // Adaptive thresholds based on market regime
        const adaptiveThresholds = this.getAdaptiveThresholds(marketRegime);

        // Enhanced buy/sell dominance scoring (non-linear)
        if (buyRatio >= adaptiveThresholds.minBuyRatio) {
            const excessBuyRatio = buyRatio - adaptiveThresholds.minBuyRatio;
            const buyScore = Math.min(
                1,
                excessBuyRatio / (1 - adaptiveThresholds.minBuyRatio)
            );
            score += buyScore * 0.3; // 30% weight
            confidence += buyScore * 0.25;
            reasons.push(
                `Strong buy dominance: ${(buyRatio * 100).toFixed(1)}%`
            );
        }

        // Institutional signals (major factor)
        const instScore =
            this.calculateInstitutionalScore(institutionalSignals);
        score += instScore * 0.25; // 25% weight
        confidence += instScore * 0.3;
        if (instScore > 0.6) {
            reasons.push("Institutional activity detected");
        }

        // Price stability (higher weight for accumulation)
        const stabilityScore = Math.pow(priceStability, 2); // Non-linear preference for high stability
        score += stabilityScore * 0.2; // 20% weight
        confidence += stabilityScore * 0.2;
        if (priceStability > 0.9) {
            reasons.push("Excellent price stability");
        }

        // Volume significance (adaptive)
        const volumeScore = Math.min(
            1,
            volume / adaptiveThresholds.significantVolume
        );
        score += volumeScore * 0.15; // 15% weight
        confidence += volumeScore * 0.15;

        // Duration with diminishing returns
        const durationScore = Math.min(
            1,
            Math.sqrt(duration / adaptiveThresholds.optimalDuration)
        );
        score += durationScore * 0.1; // 10% weight
        confidence += durationScore * 0.1;

        // Market regime bonus/penalty
        const regimeAdjustment = this.getRegimeAdjustment(marketRegime);
        score *= regimeAdjustment.scoreMultiplier;
        confidence *= regimeAdjustment.confidenceMultiplier;

        if (regimeAdjustment.scoreMultiplier > 1) {
            reasons.push("Favorable market conditions");
        }

        return {
            score: Math.min(1, score),
            confidence: Math.min(1, confidence),
            reasons,
        };
    }

    /**
     * Calculate institutional activity score
     */
    private calculateInstitutionalScore(signals: InstitutionalSignals): number {
        return (
            signals.largeBlockRatio * 0.3 +
            signals.icebergDetection * 0.25 +
            signals.volumeConsistency * 0.2 +
            signals.priceEfficiency * 0.15 +
            signals.orderSizeDistribution * 0.1
        );
    }

    /**
     * Get adaptive thresholds based on market regime
     */
    private getAdaptiveThresholds(regime: MarketRegime) {
        const base = {
            minBuyRatio: 0.75,
            minSellRatio: 0.75,
            significantVolume: 500,
            optimalDuration: 600000, // 10 minutes
        };

        // Adjust based on volatility
        switch (regime.volatilityLevel) {
            case "high":
                return {
                    ...base,
                    minBuyRatio: 0.8, // Higher threshold in volatile markets
                    minSellRatio: 0.8,
                    significantVolume: 800,
                };
            case "low":
                return {
                    ...base,
                    minBuyRatio: 0.7, // Lower threshold in stable markets
                    minSellRatio: 0.7,
                    significantVolume: 300,
                };
            default:
                return base;
        }
    }

    /**
     * Get regime-based score adjustments
     */
    private getRegimeAdjustment(regime: MarketRegime) {
        let scoreMultiplier = 1.0;
        let confidenceMultiplier = 1.0;

        // Adjust based on market phase
        switch (regime.marketPhase) {
            case "accumulation":
                scoreMultiplier = 1.2; // Boost accumulation detection
                confidenceMultiplier = 1.1;
                break;
            case "distribution":
                scoreMultiplier = 0.8; // Reduce false accumulation signals
                confidenceMultiplier = 0.9;
                break;
            case "trending":
                scoreMultiplier = 0.7; // Less likely to be accumulation
                confidenceMultiplier = 0.8;
                break;
        }

        // Adjust based on volume regime
        if (regime.volumeLevel === "high") {
            scoreMultiplier *= 1.1; // Higher confidence with more data
            confidenceMultiplier *= 1.15;
        } else if (regime.volumeLevel === "low") {
            scoreMultiplier *= 0.9; // Lower confidence with sparse data
            confidenceMultiplier *= 0.85;
        }

        return { scoreMultiplier, confidenceMultiplier };
    }

    /**
     * Determine market regime from recent trading data
     */
    public analyzeMarketRegime(
        recentTrades: EnrichedTradeEvent[],
        priceHistory: number[]
    ): MarketRegime {
        if (recentTrades.length < 10 || priceHistory.length < 20) {
            return {
                volatilityLevel: "medium",
                volumeLevel: "medium",
                trendStrength: 0.5,
                marketPhase: "consolidation",
            };
        }

        // Calculate volatility
        const priceChanges = [];
        for (let i = 1; i < priceHistory.length; i++) {
            priceChanges.push(
                (priceHistory[i] - priceHistory[i - 1]) / priceHistory[i - 1]
            );
        }
        const volatility = FinancialMath.calculateStdDev(priceChanges);

        // Calculate volume characteristics
        const volumes = recentTrades.map((t) => t.quantity);
        const avgVolume = FinancialMath.calculateMean(volumes);
        const volumeStdDev = FinancialMath.calculateStdDev(volumes);

        // Determine trend strength
        const trendStrength = this.calculateTrendStrength(priceHistory);

        return {
            volatilityLevel:
                volatility > 0.02
                    ? "high"
                    : volatility < 0.005
                      ? "low"
                      : "medium",
            volumeLevel:
                avgVolume > 100 ? "high" : avgVolume < 30 ? "low" : "medium",
            trendStrength,
            marketPhase: this.determineMarketPhase(
                trendStrength,
                volatility,
                avgVolume
            ),
            volumeStdDev: volumeStdDev,
        };
    }

    private calculateTrendStrength(prices: number[]): number {
        if (prices.length < 10) return 0.5;

        const firstHalf = prices.slice(0, Math.floor(prices.length / 2));
        const secondHalf = prices.slice(Math.floor(prices.length / 2));

        const firstAvg = FinancialMath.calculateMean(firstHalf);
        const secondAvg = FinancialMath.calculateMean(secondHalf);

        const priceChange = Math.abs(secondAvg - firstAvg) / firstAvg;
        return Math.min(1, priceChange * 10); // Scale to 0-1
    }

    private determineMarketPhase(
        trendStrength: number,
        volatility: number,
        volume: number
    ): MarketRegime["marketPhase"] {
        if (trendStrength > 0.7) return "trending";
        if (volatility > 0.015 && volume > 80) return "distribution";
        if (volatility < 0.008 && volume > 60) return "accumulation";
        return "consolidation";
    }
}
