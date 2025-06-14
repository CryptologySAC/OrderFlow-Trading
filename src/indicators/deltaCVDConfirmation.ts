/* --------------------------------------------------------------------------
   Enhanced DeltaCVDConfirmation – Advanced multi-window CVD-slope detector
   --------------------------------------------------------------------------
   Features:
   • Sophisticated confidence scoring based on signal strength and alignment
   • Price/volume correlation validation to reduce false signals
   • Adaptive thresholds that adjust to market volatility regimes
   • Enhanced state management with cleanup and validation
   • Divergence detection between price and CVD
   • Volume-weighted confidence adjustments
   -------------------------------------------------------------------------- */

import { BaseDetector } from "./base/baseDetector.js";
import { DetectorUtils } from "./base/detectorUtils.js";
import type {
    DeltaCVDConfirmationResult,
    SignalType,
} from "../types/signalTypes.js";
import type { ILogger } from "../infrastructure/loggerInterface.js";
import { MetricsCollector } from "../infrastructure/metricsCollector.js";
import { ISignalLogger } from "../infrastructure/signalLoggerInterface.js";
import { SpoofingDetector } from "../services/spoofingDetector.js";
import type {
    DetectorCallback,
    BaseDetectorSettings,
} from "./interfaces/detectorInterfaces.js";
import { EnrichedTradeEvent } from "../types/marketEvents.js";

/* ------------------------------------------------------------------ */
/*  Enhanced Config & Types                                           */
/* ------------------------------------------------------------------ */

interface CVDCalculationResult {
    cvdSeries: number[];
    slope: number;
}

export interface DeltaCVDConfirmationSettings extends BaseDetectorSettings {
    windowsSec?: [60, 300, 900] | number[]; // analysed windows
    minZ?: number; // base min |zScore| on shortest window
    minTradesPerSec?: number; // floor scaled by window
    minVolPerSec?: number; // floor scaled by window

    // Enhanced settings
    volatilityLookbackSec?: number; // window for volatility baseline (default: 3600)
    priceCorrelationWeight?: number; // how much price correlation affects confidence (0-1)
    volumeConcentrationWeight?: number; // weight for volume concentration factor
    adaptiveThresholdMultiplier?: number; // multiplier for adaptive z-score thresholds
    maxDivergenceAllowed?: number; // max allowed price/CVD divergence before penalty
    stateCleanupIntervalSec?: number; // how often to cleanup old state
}

interface WindowState {
    trades: EnrichedTradeEvent[];
    rollingMean: number; // μ of slope
    rollingVar: number; // σ² of slope
    count: number; // samples for μ/σ

    // Enhanced state tracking
    priceRollingMean: number; // μ of price changes
    priceRollingVar: number; // σ² of price changes
    priceCount: number; // samples for price statistics
    lastCleanup: number; // timestamp of last cleanup
    volumeProfile: Map<number, number>; // price level -> cumulative volume

    // CVD-weighted price levels for institutional activity tracking
    cvdProfile: Map<number, number>; // price level -> net CVD accumulation
    buyFlowProfile: Map<number, number>; // price level -> buy flow accumulation
    sellFlowProfile: Map<number, number>; // price level -> sell flow accumulation
    institutionalZones: InstitutionalZone[]; // identified institutional activity zones
}

interface ConfidenceFactors {
    zScoreAlignment: number; // 0-1, how well z-scores align across windows
    magnitudeStrength: number; // 0-1, strength of z-score magnitudes
    priceCorrelation: number; // -1 to 1, correlation between price and CVD
    volumeConcentration: number; // 0-1, how concentrated volume is at key levels
    temporalConsistency: number; // 0-1, consistency of signal across timeframes
    divergencePenalty: number; // 0-1, penalty for price/CVD divergence
}

interface InstitutionalZone {
    priceLevel: number; // price level where institutional activity detected
    netCVD: number; // net CVD accumulation at this level
    buyVolume: number; // total buy volume at this level
    sellVolume: number; // total sell volume at this level
    firstSeen: number; // timestamp when first detected
    lastUpdate: number; // timestamp of last activity
    strength: number; // 0-1, strength of institutional activity
    isActive: boolean; // whether zone is currently active
}

interface MarketRegime {
    volatility: number; // current volatility estimate
    baselineVolatility: number; // historical baseline
    trendStrength: number; // 0-1, how trending vs ranging
    volumeNormalization: number; // volume normalization factor
}

const MIN_SAMPLES_FOR_STATS = 30;
//todo const MIN_SAMPLES_FOR_CONFIDENCE = 50;
const VOLATILITY_LOOKBACK_DEFAULT = 3600; // 1 hour
const CLEANUP_INTERVAL_DEFAULT = 300; // 5 minutes

/* ------------------------------------------------------------------ */
/*  Enhanced Detector Implementation                                  */
/* ------------------------------------------------------------------ */
export class DeltaCVDConfirmation extends BaseDetector {
    /* ---- immutable config --------------------------------------- */
    protected readonly detectorType = "cvd_confirmation" as const;
    private windows: number[] = [60, 300, 900];
    private readonly minZ: number;
    private readonly minTPS: number;
    private readonly minVPS: number;

    // Enhanced configuration
    private readonly volatilityLookbackSec: number;
    private readonly priceCorrelationWeight: number;
    private readonly volumeConcentrationWeight: number;
    private readonly adaptiveThresholdMultiplier: number;
    private readonly maxDivergenceAllowed: number;
    private readonly stateCleanupIntervalSec: number;

    /* ---- enhanced mutable state --------------------------------- */
    private readonly states = new Map<number, WindowState>();
    private lastSignalTs = 0;
    private lastStateCleanup = 0;

    // Market regime tracking
    private marketRegime: MarketRegime = {
        volatility: 0,
        baselineVolatility: 0,
        trendStrength: 0,
        volumeNormalization: 1,
    };

    // Historical data for baseline calculations
    private volatilityHistory: number[] = [];
    private recentPriceChanges: number[] = [];

    private readonly cvdResultPool = new CVDResultPool();

    constructor(
        id: string,
        callback: DetectorCallback,
        settings: DeltaCVDConfirmationSettings = {},
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

        // Basic settings
        this.windows = settings.windowsSec
            ? [...settings.windowsSec]
            : [60, 300, 900];
        this.minZ = settings.minZ ?? 3;
        this.minTPS = settings.minTradesPerSec ?? 0.5;
        this.minVPS = settings.minVolPerSec ?? 1;

        // Enhanced settings
        this.volatilityLookbackSec =
            settings.volatilityLookbackSec ?? VOLATILITY_LOOKBACK_DEFAULT;
        this.priceCorrelationWeight = settings.priceCorrelationWeight ?? 0.3;
        this.volumeConcentrationWeight =
            settings.volumeConcentrationWeight ?? 0.2;
        this.adaptiveThresholdMultiplier =
            settings.adaptiveThresholdMultiplier ?? 1.5;
        this.maxDivergenceAllowed = settings.maxDivergenceAllowed ?? 0.7;
        this.stateCleanupIntervalSec =
            settings.stateCleanupIntervalSec ?? CLEANUP_INTERVAL_DEFAULT;

        // Initialize window states
        for (const w of this.windows) {
            this.states.set(w, {
                trades: [],
                rollingMean: 0,
                rollingVar: 0,
                count: 0,
                priceRollingMean: 0,
                priceRollingVar: 0,
                priceCount: 0,
                lastCleanup: Date.now(),
                volumeProfile: new Map(),
                cvdProfile: new Map(),
                buyFlowProfile: new Map(),
                sellFlowProfile: new Map(),
                institutionalZones: [],
            });
        }

        // Enhanced metrics
        this.metricsCollector.createCounter(
            "cvd_confirmations_total",
            "CVD confirmation signals"
        );
        this.metricsCollector.createHistogram(
            "cvd_confidence_scores",
            "Distribution of CVD signal confidence scores",
            ["signal_side"],
            [0.0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0]
        );
        this.metricsCollector.createGauge(
            "cvd_market_volatility",
            "Current market volatility estimate"
        );
        this.metricsCollector.createCounter(
            "cvd_signals_rejected_total",
            "CVD signals rejected",
            ["reason"]
        );
    }

    protected getSignalType(): SignalType {
        return this.detectorType;
    }

    protected onEnrichedTradeSpecific(event: EnrichedTradeEvent): void {
        // Update market regime
        this.updateMarketRegime(event);

        // Push trade into each window state and update statistics
        for (const w of this.windows) {
            const state = this.states.get(w)!;
            state.trades.push(event);

            // Update volume profile
            this.updateVolumeProfile(state, event);

            // Update CVD-weighted price level tracking
            this.updateCVDProfile(state, event);

            // Update price statistics for this window
            this.updatePriceStatistics(state, event);

            // Drop old trades
            const cutoff = event.timestamp - w * 1000;
            while (state.trades.length && state.trades[0].timestamp < cutoff) {
                state.trades.shift();
            }
        }

        // Periodic state cleanup
        this.periodicStateCleanup(event.timestamp);

        // Try to emit signal
        this.tryEmitSignal(event.timestamp);
    }

    /* ------------------------------------------------------------------ */
    /*  Market Regime & State Management                                  */
    /* ------------------------------------------------------------------ */

    private updateMarketRegime(event: EnrichedTradeEvent): void {
        try {
            if (this.recentPriceChanges.length > 0) {
                this.recentPriceChanges.push(event.price);

                // FIX: Add bounds checking
                const maxLength = Math.max(
                    100,
                    this.volatilityLookbackSec / 10
                );
                while (this.recentPriceChanges.length > maxLength) {
                    this.recentPriceChanges.shift();
                }

                // FIX: Ensure minimum data before calculations
                if (this.recentPriceChanges.length > 20) {
                    // Increased from 10
                    const returns = [];
                    for (let i = 1; i < this.recentPriceChanges.length; i++) {
                        // FIX: Validate prices before calculation
                        const currentPrice = this.recentPriceChanges[i];
                        const prevPrice = this.recentPriceChanges[i - 1];

                        if (
                            !isFinite(currentPrice) ||
                            !isFinite(prevPrice) ||
                            prevPrice === 0
                        ) {
                            continue;
                        }

                        const priceReturn =
                            (currentPrice - prevPrice) / prevPrice;
                        if (isFinite(priceReturn)) {
                            returns.push(priceReturn);
                        }
                    }

                    if (returns.length > 10) {
                        const mean =
                            returns.reduce((sum, r) => sum + r, 0) /
                            returns.length;
                        const variance =
                            returns.reduce(
                                (sum, r) => sum + Math.pow(r - mean, 2),
                                0
                            ) / returns.length;

                        if (isFinite(variance) && variance > 0) {
                            this.marketRegime.volatility = Math.sqrt(variance);

                            // Update baseline volatility with bounds checking
                            if (this.marketRegime.baselineVolatility === 0) {
                                this.marketRegime.baselineVolatility =
                                    this.marketRegime.volatility;
                            } else {
                                this.marketRegime.baselineVolatility =
                                    this.marketRegime.baselineVolatility *
                                        0.99 +
                                    this.marketRegime.volatility * 0.01;
                            }

                            // Update metrics with validation
                            if (isFinite(this.marketRegime.volatility)) {
                                this.metricsCollector.setGauge(
                                    "cvd_market_volatility",
                                    this.marketRegime.volatility
                                );
                            }
                        }
                    }
                }
            } else {
                this.recentPriceChanges.push(event.price);
            }
        } catch (error) {
            this.logger.error("Market regime update failed", {
                error,
                eventPrice: event.price,
            });
        }
    }

    private updateVolumeProfile(
        state: WindowState,
        event: EnrichedTradeEvent
    ): void {
        // Round price to reasonable tick size for volume profile
        const tickSize = this.calculateTickSize(event.price);
        const roundedPrice = Math.round(event.price / tickSize) * tickSize;

        const currentVolume = state.volumeProfile.get(roundedPrice) || 0;
        state.volumeProfile.set(roundedPrice, currentVolume + event.quantity);

        // Cleanup old volume profile entries periodically
        if (state.volumeProfile.size > 1000) {
            // Keep only top 500 volume levels
            const sortedEntries = Array.from(state.volumeProfile.entries())
                .sort((a, b) => b[1] - a[1])
                .slice(0, 500);
            state.volumeProfile.clear();
            sortedEntries.forEach(([price, volume]) => {
                state.volumeProfile.set(price, volume);
            });
        }
    }

    private updateCVDProfile(
        state: WindowState,
        event: EnrichedTradeEvent
    ): void {
        const tickSize = this.calculateTickSize(event.price);
        const roundedPrice = Math.round(event.price / tickSize) * tickSize;

        // Calculate CVD delta for this trade
        const cvdDelta = event.buyerIsMaker ? -event.quantity : event.quantity;

        // Update CVD profile
        const currentCVD = state.cvdProfile.get(roundedPrice) || 0;
        state.cvdProfile.set(roundedPrice, currentCVD + cvdDelta);

        // Update flow profiles by side
        if (event.buyerIsMaker) {
            // Sell aggression
            const currentSellFlow =
                state.sellFlowProfile.get(roundedPrice) || 0;
            state.sellFlowProfile.set(
                roundedPrice,
                currentSellFlow + event.quantity
            );
        } else {
            // Buy aggression
            const currentBuyFlow = state.buyFlowProfile.get(roundedPrice) || 0;
            state.buyFlowProfile.set(
                roundedPrice,
                currentBuyFlow + event.quantity
            );
        }

        // Update institutional zones
        this.updateInstitutionalZones(state, roundedPrice, cvdDelta, event);

        // Cleanup old CVD profile entries periodically
        this.cleanupCVDProfiles(state);
    }

    private updateInstitutionalZones(
        state: WindowState,
        priceLevel: number,
        cvdDelta: number,
        event: EnrichedTradeEvent
    ): void {
        const now = event.timestamp;

        // Find existing zone at this price level
        let zone = state.institutionalZones.find(
            (z) =>
                Math.abs(z.priceLevel - priceLevel) <
                this.calculateTickSize(priceLevel)
        );

        if (!zone) {
            // Create new institutional zone if CVD accumulation is significant
            const netCVD = state.cvdProfile.get(priceLevel) || 0;
            const buyVolume = state.buyFlowProfile.get(priceLevel) || 0;
            const sellVolume = state.sellFlowProfile.get(priceLevel) || 0;

            // Only create zone if there's significant activity
            if (
                Math.abs(netCVD) > this.minVPS * 10 ||
                buyVolume + sellVolume > this.minVPS * 20
            ) {
                zone = {
                    priceLevel,
                    netCVD,
                    buyVolume,
                    sellVolume,
                    firstSeen: now,
                    lastUpdate: now,
                    strength: this.calculateZoneStrength(
                        netCVD,
                        buyVolume + sellVolume
                    ),
                    isActive: true,
                };
                state.institutionalZones.push(zone);
            }
        } else {
            // Update existing zone
            zone.netCVD = state.cvdProfile.get(priceLevel) || 0;
            zone.buyVolume = state.buyFlowProfile.get(priceLevel) || 0;
            zone.sellVolume = state.sellFlowProfile.get(priceLevel) || 0;
            zone.lastUpdate = now;
            zone.strength = this.calculateZoneStrength(
                zone.netCVD,
                zone.buyVolume + zone.sellVolume
            );
            zone.isActive = now - zone.lastUpdate < 60000; // Active if updated within last minute
        }

        // Sort zones by strength and keep only top institutional zones
        state.institutionalZones.sort((a, b) => b.strength - a.strength);
        if (state.institutionalZones.length > 20) {
            state.institutionalZones = state.institutionalZones.slice(0, 20);
        }
    }

    private calculateZoneStrength(netCVD: number, totalVolume: number): number {
        if (totalVolume === 0) return 0;

        // Combine CVD imbalance with total volume for strength calculation
        const cvdImbalance = Math.abs(netCVD) / totalVolume;
        const volumeSignificance = Math.min(
            totalVolume / (this.minVPS * 100),
            1
        );

        return cvdImbalance * 0.7 + volumeSignificance * 0.3;
    }

    private cleanupCVDProfiles(state: WindowState): void {
        try {
            // FIX: Add memory usage tracking
            const totalProfileSize =
                state.cvdProfile.size +
                state.buyFlowProfile.size +
                state.sellFlowProfile.size;

            if (totalProfileSize > 3000) {
                // More aggressive cleanup threshold
                // Keep only top 300 levels by absolute CVD (reduced from 500)
                const sortedCVDEntries = Array.from(state.cvdProfile.entries())
                    .filter(([price, cvd]) => isFinite(price) && isFinite(cvd)) // Validate data
                    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
                    .slice(0, 300);

                const pricesToKeep = new Set(
                    sortedCVDEntries.map(([price]) => price)
                );

                // Clear all profiles
                state.cvdProfile.clear();
                state.buyFlowProfile.clear();
                state.sellFlowProfile.clear();

                // Repopulate with significant levels only
                sortedCVDEntries.forEach(([price, cvd]) => {
                    state.cvdProfile.set(price, cvd);
                });

                // Clean institutional zones more aggressively
                state.institutionalZones = state.institutionalZones
                    .filter(
                        (zone) =>
                            isFinite(zone.priceLevel) &&
                            isFinite(zone.netCVD) &&
                            zone.isActive &&
                            Array.from(pricesToKeep).some(
                                (price) =>
                                    Math.abs(zone.priceLevel - price) <
                                    this.calculateTickSize(price)
                            )
                    )
                    .slice(0, 10); // Limit to 10 most significant zones

                this.logger.debug("Aggressive CVD profile cleanup completed", {
                    originalSize: totalProfileSize,
                    newSize: state.cvdProfile.size,
                    zonesKept: state.institutionalZones.length,
                });
            }
        } catch (error) {
            this.logger.error("CVD profile cleanup failed", { error: error });
            // Emergency cleanup on error
            state.cvdProfile.clear();
            state.buyFlowProfile.clear();
            state.sellFlowProfile.clear();
            state.institutionalZones = [];
        }
    }

    private updatePriceStatistics(
        state: WindowState,
        event: EnrichedTradeEvent
    ): void {
        if (state.trades.length > 1) {
            const prevTrade = state.trades[state.trades.length - 2];
            const priceChange = event.price - prevTrade.price;

            // Update price rolling statistics using Welford's algorithm
            const delta = priceChange - state.priceRollingMean;
            state.priceCount += 1;
            state.priceRollingMean += delta / state.priceCount;
            state.priceRollingVar +=
                delta * (priceChange - state.priceRollingMean);
        }
    }

    private periodicStateCleanup(now: number): void {
        if (now - this.lastStateCleanup < this.stateCleanupIntervalSec * 1000)
            return;

        this.lastStateCleanup = now;
        const maxWindow = Math.max(...this.windows);
        const cutoff = now - maxWindow * 2000; // 2x safety margin

        for (const state of this.states.values()) {
            // Cleanup trades
            while (state.trades.length && state.trades[0].timestamp < cutoff) {
                state.trades.shift();
            }

            // Reset statistics if we don't have enough recent data
            if (state.trades.length < MIN_SAMPLES_FOR_STATS) {
                state.rollingMean = 0;
                state.rollingVar = 0;
                state.count = 0;
                state.priceRollingMean = 0;
                state.priceRollingVar = 0;
                state.priceCount = 0;
            }

            state.lastCleanup = now;
        }

        this.logger.debug("Periodic state cleanup completed", {
            detector: this.getId(),
            timestamp: now,
            statesCount: this.states.size,
        });
    }

    /* ------------------------------------------------------------------ */
    /*  Enhanced Signal Detection with Confidence Scoring                */
    /* ------------------------------------------------------------------ */

    private tryEmitSignal(now: number): void {
        // Compute slopes and z-scores for each window
        const slopes: Record<number, number> = {};
        const zScores: Record<number, number> = {};
        const priceCorrelations: Record<number, number> = {};

        for (const w of this.windows) {
            const state = this.states.get(w)!;
            if (state.trades.length < MIN_SAMPLES_FOR_STATS) return;

            // Enhanced trade/volume validation
            const result = this.validateTradeActivity(state, w);
            if (!result.valid) {
                this.metricsCollector.incrementCounter(
                    "cvd_signals_rejected_total",
                    1,
                    {
                        reason: result.reason,
                    }
                );
                return;
            }

            // Compute CVD series and slope
            const { cvdSeries, slope } = this.computeCVDSlope(state);

            // Calculate price correlation for this window
            const priceCorrelation = this.calculatePriceCorrelation(
                state,
                cvdSeries
            );
            priceCorrelations[w] = priceCorrelation;

            // Update slope statistics using Welford's algorithm
            this.updateSlopeStatistics(state, slope);

            // Calculate adaptive z-score threshold
            //const adaptiveMinZ = this.calculateAdaptiveThreshold();
            const zScore = this.calculateZScore(state, slope);

            slopes[w] = slope;
            zScores[w] = zScore;

            // Store for later use
            //this.logger.debug(`Window ${w}s analysis`, {
            //    slope,
            //    zScore,
            //    priceCorrelation,
            //    adaptiveMinZ,
            //    tradesCount: state.trades.length,
            //});
        }

        // Enhanced signal validation
        const validationResult = this.validateSignalConditions(
            zScores,
            priceCorrelations
        );
        if (!validationResult.valid) {
            this.metricsCollector.incrementCounter(
                "cvd_signals_rejected_total",
                1,
                {
                    reason: validationResult.reason,
                }
            );
            return;
        }

        // Throttle signals
        if (now - this.lastSignalTs < 60_000) return;
        this.lastSignalTs = now;

        // Calculate comprehensive confidence score
        const confidenceFactors = this.calculateConfidenceFactors(
            slopes,
            zScores,
            priceCorrelations,
            now
        );
        const finalConfidence = this.computeFinalConfidence(confidenceFactors);

        // Build enhanced signal result
        const candidate = this.buildSignalCandidate(
            slopes,
            zScores,
            priceCorrelations,
            confidenceFactors,
            finalConfidence,
            now
        );

        // Emit signal
        this.handleDetection(candidate);
        this.metricsCollector.incrementCounter("cvd_confirmations_total", 1);
        this.metricsCollector.recordHistogram(
            "cvd_confidence_scores",
            finalConfidence,
            {
                signal_side: candidate.side,
            }
        );

        this.logger.info("CVD confirmation signal emitted", {
            detector: this.getId(),
            side: candidate.side,
            confidence: finalConfidence,
            price: candidate.price,
            confidenceFactors,
        });
    }

    private validateTradeActivity(
        state: WindowState,
        windowSec: number
    ): { valid: boolean; reason: string } {
        const windowDur =
            (state.trades[state.trades.length - 1].timestamp -
                state.trades[0].timestamp) /
            1000;
        const actualWindowSec = Math.min(windowDur, windowSec);

        const tps = state.trades.length / Math.max(actualWindowSec, 1);
        if (tps < this.minTPS) {
            return { valid: false, reason: "insufficient_trade_rate" };
        }

        const totalVolume = state.trades.reduce(
            (sum, tr) => sum + tr.quantity,
            0
        );
        const vps = totalVolume / Math.max(actualWindowSec, 1);
        if (vps < this.minVPS) {
            return { valid: false, reason: "insufficient_volume_rate" };
        }

        return { valid: true, reason: "" };
    }

    private computeCVDSlope(state: WindowState): CVDCalculationResult {
        const result = this.cvdResultPool.acquire();

        try {
            let cvd = 0;

            for (const tr of state.trades) {
                // Validate trade data
                if (!isFinite(tr.quantity) || tr.quantity <= 0) {
                    continue;
                }

                const delta = tr.buyerIsMaker ? -tr.quantity : tr.quantity;
                cvd += delta;
                result.cvdSeries.push(cvd);
            }

            // Calculate slope with validation
            const n = result.cvdSeries.length;
            if (n < 2) {
                result.slope = 0;
                return result;
            }

            // Linear regression with overflow protection
            const sumX = (n * (n - 1)) / 2;
            const sumX2 = ((n - 1) * n * (2 * n - 1)) / 6;
            const sumY = result.cvdSeries.reduce((sum, v) => sum + v, 0);
            const sumXY = result.cvdSeries.reduce(
                (sum, v, i) => sum + v * i,
                0
            );
            const denom = n * sumX2 - sumX * sumX;

            if (denom === 0 || !isFinite(denom)) {
                result.slope = 0;
                return result;
            }

            const slope = (n * sumXY - sumX * sumY) / denom;
            result.slope = isFinite(slope) ? slope : 0;

            return result;
        } catch (error) {
            this.logger.error("CVD slope calculation failed", { error: error });
            result.slope = 0;
            return result;
        }
        // Note: Don't release here - caller should release
    }

    private calculatePriceCorrelation(
        state: WindowState,
        cvdSeries: number[]
    ): number {
        try {
            if (state.trades.length < 10) return 0; // Increased minimum

            const prices = state.trades.map((tr) => tr.price);
            const n = Math.min(prices.length, cvdSeries.length);

            if (n < 10) return 0;

            const priceSlice = prices.slice(-n);
            const cvdSlice = cvdSeries.slice(-n);

            // VALIDATE DATA
            if (
                priceSlice.some((p) => !isFinite(p)) ||
                cvdSlice.some((c) => !isFinite(c))
            ) {
                return 0;
            }

            const priceMean = priceSlice.reduce((sum, p) => sum + p, 0) / n;
            const cvdMean = cvdSlice.reduce((sum, c) => sum + c, 0) / n;

            let numerator = 0;
            let priceSSQ = 0;
            let cvdSSQ = 0;

            for (let i = 0; i < n; i++) {
                const priceDiff = priceSlice[i] - priceMean;
                const cvdDiff = cvdSlice[i] - cvdMean;
                numerator += priceDiff * cvdDiff;
                priceSSQ += priceDiff * priceDiff;
                cvdSSQ += cvdDiff * cvdDiff;
            }

            const denominator = Math.sqrt(priceSSQ * cvdSSQ);

            // FIX: Prevent division by zero
            if (denominator === 0 || !isFinite(denominator)) {
                return 0;
            }

            const correlation = numerator / denominator;

            // FIX: Validate result
            return isFinite(correlation)
                ? Math.max(-1, Math.min(1, correlation))
                : 0;
        } catch (error) {
            this.logger.error("Price correlation calculation failed", {
                error: error,
            });
            return 0;
        }
    }

    private updateSlopeStatistics(state: WindowState, slope: number): void {
        const delta = slope - state.rollingMean;
        state.count += 1;
        state.rollingMean += DetectorUtils.safeDivide(delta, state.count, 0);
        state.rollingVar += delta * (slope - state.rollingMean);
    }

    private calculateAdaptiveThreshold(): number {
        const volatilityRatio =
            this.marketRegime.baselineVolatility > 0
                ? this.marketRegime.volatility /
                  this.marketRegime.baselineVolatility
                : 1;

        return (
            this.minZ *
            Math.max(
                0.5,
                Math.min(
                    2.0,
                    volatilityRatio * this.adaptiveThresholdMultiplier
                )
            )
        );
    }

    private calculateZScore(state: WindowState, slope: number): number {
        if (state.count < 2) return 0;

        const variance = DetectorUtils.safeDivide(
            state.rollingVar,
            state.count - 1,
            0
        );
        const std = Math.sqrt(variance) || 1e-9;
        return DetectorUtils.safeDivide(slope - state.rollingMean, std, 0);
    }

    private validateSignalConditions(
        zScores: Record<number, number>,
        priceCorrelations: Record<number, number>
    ): { valid: boolean; reason: string } {
        try {
            // FIX: Validate input data
            for (const window of this.windows) {
                if (!isFinite(zScores[window])) {
                    return { valid: false, reason: "invalid_zscore_data" };
                }
                if (!isFinite(priceCorrelations[window])) {
                    return { valid: false, reason: "invalid_correlation_data" };
                }
            }

            // Check sign alignment with validation
            const signs = this.windows.map((w) => {
                const zScore = zScores[w];
                return isFinite(zScore) ? Math.sign(zScore) : 0;
            });

            if (
                signs.some((s) => s === 0) ||
                !signs.every((s) => s === signs[0])
            ) {
                return { valid: false, reason: "no_sign_alignment" };
            }

            // Check adaptive z-score threshold with bounds
            const adaptiveMinZ = this.calculateAdaptiveThreshold();
            if (!isFinite(adaptiveMinZ) || adaptiveMinZ <= 0) {
                return { valid: false, reason: "invalid_adaptive_threshold" };
            }

            const shortestWindowZ = Math.abs(zScores[this.windows[0]]);
            if (shortestWindowZ < adaptiveMinZ) {
                return { valid: false, reason: "below_adaptive_threshold" };
            }

            // Check for excessive price/CVD divergence with validation
            const correlations = this.windows
                .map((w) => priceCorrelations[w])
                .filter((c) => isFinite(c));
            if (correlations.length === 0) {
                return { valid: false, reason: "no_valid_correlations" };
            }

            const avgPriceCorrelation =
                correlations.reduce((sum, corr) => sum + corr, 0) /
                correlations.length;

            if (Math.abs(avgPriceCorrelation) < 1 - this.maxDivergenceAllowed) {
                return {
                    valid: false,
                    reason: "excessive_price_cvd_divergence",
                };
            }

            return { valid: true, reason: "" };
        } catch (error) {
            this.logger.error("Signal validation failed", { error: error });
            return { valid: false, reason: "validation_error" };
        }
    }

    /* ------------------------------------------------------------------ */
    /*  Confidence Scoring System                                         */
    /* ------------------------------------------------------------------ */

    private calculateConfidenceFactors(
        slopes: Record<number, number>,
        zScores: Record<number, number>,
        priceCorrelations: Record<number, number>,
        timestamp: number
    ): ConfidenceFactors {
        void timestamp; //todo
        // 1. Z-Score Alignment (how consistent are the signals across timeframes)
        const zScoreAlignment = this.calculateZScoreAlignment(zScores);

        // 2. Magnitude Strength (how strong are the z-scores)
        const magnitudeStrength = this.calculateMagnitudeStrength(zScores);

        // 3. Price Correlation (how well does price follow CVD)
        const avgPriceCorrelation =
            this.windows
                .map((w) => priceCorrelations[w])
                .reduce((sum, corr) => sum + corr, 0) / this.windows.length;

        // 4. Volume Concentration (how concentrated is volume at key levels)
        const volumeConcentration = this.calculateVolumeConcentration();

        // 5. Temporal Consistency (how consistent is the signal over time)
        const temporalConsistency = this.calculateTemporalConsistency(slopes);

        // 6. Divergence Penalty (penalty for price/CVD divergence)
        const divergencePenalty =
            this.calculateDivergencePenalty(avgPriceCorrelation);

        return {
            zScoreAlignment,
            magnitudeStrength,
            priceCorrelation: avgPriceCorrelation,
            volumeConcentration,
            temporalConsistency,
            divergencePenalty,
        };
    }

    private calculateZScoreAlignment(zScores: Record<number, number>): number {
        const values = this.windows.map((w) => zScores[w]);
        const signs = values.map((z) => Math.sign(z));

        // Perfect alignment = 1.0, no alignment = 0.0
        const signAlignment = signs.every((s) => s === signs[0]) ? 1.0 : 0.0;

        // Magnitude alignment - how similar are the relative magnitudes
        const magnitudes = values.map((z) => Math.abs(z));
        const maxMag = Math.max(...magnitudes);
        const minMag = Math.min(...magnitudes);
        const magnitudeAlignment = maxMag > 0 ? minMag / maxMag : 0;

        return signAlignment * 0.7 + magnitudeAlignment * 0.3;
    }

    private calculateMagnitudeStrength(
        zScores: Record<number, number>
    ): number {
        const adaptiveMinZ = this.calculateAdaptiveThreshold();
        const shortestWindowZ = Math.abs(zScores[this.windows[0]]);

        // Normalize strength based on adaptive threshold
        const rawStrength = shortestWindowZ / adaptiveMinZ;

        // Apply sigmoid to cap at reasonable values
        return Math.tanh(rawStrength - 1); // 0 at threshold, approaching 1 for very high z-scores
    }

    private calculateVolumeConcentration(): number {
        const shortestWindow = this.windows[0];
        const state = this.states.get(shortestWindow)!;

        if (state.volumeProfile.size < 3) return 0.5; // Default if insufficient data

        const volumes = Array.from(state.volumeProfile.values());
        const totalVolume = volumes.reduce((sum, vol) => sum + vol, 0);

        if (totalVolume === 0) return 0.5;

        // Calculate Herfindahl-Hirschman Index for volume concentration
        const hhi = volumes.reduce((sum, vol) => {
            const share = vol / totalVolume;
            return sum + share * share;
        }, 0);

        // Normalize HHI to 0-1 range (more concentrated = higher confidence)
        return Math.min(1.0, hhi * volumes.length);
    }

    private calculateTemporalConsistency(
        slopes: Record<number, number>
    ): number {
        // Check if slopes are consistently increasing or decreasing across timeframes
        const slopeValues = this.windows.map((w) => slopes[w]);

        // Calculate how monotonic the slopes are
        let increasing = 0;
        let decreasing = 0;

        for (let i = 1; i < slopeValues.length; i++) {
            if (slopeValues[i] > slopeValues[i - 1]) increasing++;
            if (slopeValues[i] < slopeValues[i - 1]) decreasing++;
        }

        const totalComparisons = slopeValues.length - 1;
        const consistency = Math.max(increasing, decreasing) / totalComparisons;

        return consistency;
    }

    private calculateDivergencePenalty(avgPriceCorrelation: number): number {
        // Penalty increases as correlation decreases
        const absCorrelation = Math.abs(avgPriceCorrelation);

        if (absCorrelation > 0.7) return 1.0; // No penalty for good correlation
        if (absCorrelation > 0.3) return 0.5 + (absCorrelation - 0.3) * 1.25; // Linear penalty
        return 0.1; // Heavy penalty for poor correlation
    }

    private computeFinalConfidence(factors: ConfidenceFactors): number {
        // Weighted combination of confidence factors
        const weights = {
            zScoreAlignment: 0.25,
            magnitudeStrength: 0.2,
            priceCorrelation: this.priceCorrelationWeight,
            volumeConcentration: this.volumeConcentrationWeight,
            temporalConsistency: 0.15,
            divergencePenalty: 0.1,
        };

        // Ensure weights sum to 1
        const totalWeight = Object.values(weights).reduce(
            (sum, w) => sum + w,
            0
        );
        Object.keys(weights).forEach((key) => {
            weights[key as keyof typeof weights] /= totalWeight;
        });

        let confidence =
            factors.zScoreAlignment * weights.zScoreAlignment +
            factors.magnitudeStrength * weights.magnitudeStrength +
            Math.abs(factors.priceCorrelation) * weights.priceCorrelation +
            factors.volumeConcentration * weights.volumeConcentration +
            factors.temporalConsistency * weights.temporalConsistency;

        // Apply divergence penalty
        confidence *= factors.divergencePenalty;

        // Ensure confidence is in [0, 1] range
        return Math.max(0.0, Math.min(1.0, confidence));
    }

    /* ------------------------------------------------------------------ */
    /*  Signal Construction                                               */
    /* ------------------------------------------------------------------ */

    private buildSignalCandidate(
        slopes: Record<number, number>,
        zScores: Record<number, number>,
        priceCorrelations: Record<number, number>,
        confidenceFactors: ConfidenceFactors,
        finalConfidence: number,
        timestamp: number
    ): DeltaCVDConfirmationResult {
        // CRITICAL FIX: Direction should be based on actual CVD slope, not z-score sign
        // Z-score tells us if momentum is unusual, slope tells us the direction
        const side = Math.sign(slopes[this.windows[0]]) > 0 ? "buy" : "sell";
        const shortestWindowState = this.states.get(this.windows[0])!;
        const lastTrade =
            shortestWindowState.trades[shortestWindowState.trades.length - 1];

        // Calculate total window volume
        const windowVolume = shortestWindowState.trades.reduce(
            (sum, t) => sum + t.quantity,
            0
        );

        // Calculate rate of change (slope normalized by time)
        const rateOfChange = slopes[this.windows[0]] / this.windows[0]; // qty per second

        const candidate: DeltaCVDConfirmationResult = {
            price: lastTrade.price,
            side,
            slopes,
            zScores,
            tradesInWindow: shortestWindowState.trades.length,
            rateOfChange,
            confidence: finalConfidence,
            windowVolume,

            // Enhanced metadata
            metadata: {
                confidenceFactors,
                priceCorrelations,
                marketRegime: { ...this.marketRegime },
                adaptiveThreshold: this.calculateAdaptiveThreshold(),
                timestamp,

                // Volume profile insights
                volumeConcentration: confidenceFactors.volumeConcentration,
                majorVolumeLevel:
                    this.findMajorVolumeLevel(shortestWindowState),

                // Institutional activity insights
                institutionalZones: shortestWindowState.institutionalZones,
                dominantInstitutionalSide:
                    this.getDominantInstitutionalSide(shortestWindowState),
                cvdWeightedPrice:
                    this.calculateCVDWeightedPrice(shortestWindowState),
                institutionalFlowStrength:
                    this.calculateInstitutionalFlowStrength(
                        shortestWindowState
                    ),

                // Statistical context
                sampleSizes: this.windows.reduce(
                    (acc, w) => {
                        acc[w] = this.states.get(w)!.trades.length;
                        return acc;
                    },
                    {} as Record<number, number>
                ),

                // Divergence analysis
                priceMovement: this.calculatePriceMovement(shortestWindowState),
                cvdMovement: this.calculateCVDMovement(shortestWindowState),

                // Timing context
                signalFrequency: this.calculateRecentSignalFrequency(timestamp),
                timeToLastSignal: timestamp - this.lastSignalTs,
            },
        };

        return candidate;
    }

    /* ------------------------------------------------------------------ */
    /*  Helper Methods for Signal Enhancement                             */
    /* ------------------------------------------------------------------ */

    private findMajorVolumeLevel(state: WindowState): number | null {
        if (state.volumeProfile.size === 0) return null;

        let maxVolume = 0;
        let majorLevel = null;

        for (const [price, volume] of state.volumeProfile) {
            if (volume > maxVolume) {
                maxVolume = volume;
                majorLevel = price;
            }
        }

        return majorLevel;
    }

    private calculatePriceMovement(state: WindowState): {
        absoluteMove: number;
        percentMove: number;
        direction: "up" | "down" | "flat";
    } {
        if (state.trades.length < 2) {
            return { absoluteMove: 0, percentMove: 0, direction: "flat" };
        }

        const firstPrice = state.trades[0].price;
        const lastPrice = state.trades[state.trades.length - 1].price;
        const absoluteMove = lastPrice - firstPrice;
        const percentMove = (absoluteMove / firstPrice) * 100;

        const direction =
            absoluteMove > 0.001
                ? "up"
                : absoluteMove < -0.001
                  ? "down"
                  : "flat";

        return { absoluteMove, percentMove, direction };
    }

    private calculateCVDMovement(state: WindowState): {
        totalCVD: number;
        normalizedCVD: number;
        direction: "bullish" | "bearish" | "neutral";
    } {
        let cvd = 0;
        for (const trade of state.trades) {
            const delta = trade.buyerIsMaker ? -trade.quantity : trade.quantity;
            cvd += delta;
        }

        const totalVolume = state.trades.reduce(
            (sum, t) => sum + t.quantity,
            0
        );
        const normalizedCVD = totalVolume > 0 ? cvd / totalVolume : 0;

        const direction =
            normalizedCVD > 0.05
                ? "bullish"
                : normalizedCVD < -0.05
                  ? "bearish"
                  : "neutral";

        return { totalCVD: cvd, normalizedCVD, direction };
    }

    private calculateRecentSignalFrequency(currentTime: number): number {
        // This is a simplified version - in a real implementation,
        // you'd track historical signals
        const timeSinceLastSignal = currentTime - this.lastSignalTs;
        const hoursSpan = Math.max(1, timeSinceLastSignal / (1000 * 60 * 60));

        // Estimate based on current configuration and throttling
        return Math.min(60, 1 / hoursSpan); // signals per hour, capped at 60
    }

    private calculateTickSize(price: number): number {
        // Simple tick size calculation - adjust based on your market
        if (price < 1) return 0.0001;
        if (price < 10) return 0.001;
        if (price < 100) return 0.01;
        if (price < 1000) return 0.1;
        return 1.0;
    }

    private getDominantInstitutionalSide(
        state: WindowState
    ): "buy" | "sell" | "neutral" {
        if (state.institutionalZones.length === 0) return "neutral";

        let netInstitutionalCVD = 0;
        for (const zone of state.institutionalZones) {
            if (zone.isActive) {
                netInstitutionalCVD += zone.netCVD * zone.strength;
            }
        }

        if (netInstitutionalCVD > this.minVPS * 5) return "buy";
        if (netInstitutionalCVD < -this.minVPS * 5) return "sell";
        return "neutral";
    }

    private calculateCVDWeightedPrice(state: WindowState): number {
        let totalWeightedPrice = 0;
        let totalWeight = 0;

        for (const [price, cvd] of state.cvdProfile.entries()) {
            const weight = Math.abs(cvd);
            totalWeightedPrice += price * weight;
            totalWeight += weight;
        }

        return totalWeight > 0 ? totalWeightedPrice / totalWeight : 0;
    }

    private calculateInstitutionalFlowStrength(state: WindowState): number {
        if (state.institutionalZones.length === 0) return 0;

        // Calculate strength as weighted average of active zones
        let totalStrength = 0;
        let activeZones = 0;

        for (const zone of state.institutionalZones) {
            if (zone.isActive) {
                totalStrength += zone.strength;
                activeZones++;
            }
        }

        return activeZones > 0 ? totalStrength / activeZones : 0;
    }

    /* ------------------------------------------------------------------ */
    /*  BaseDetector API Implementation                                   */
    /* ------------------------------------------------------------------ */

    public getId(): string {
        return this.id || "enhanced_deltaCVDConfirmation";
    }

    public start(): void {
        this.logger.info("Enhanced CVD Confirmation detector started", {
            detector: this.getId(),
            windows: this.windows,
            minZ: this.minZ,
            adaptiveThresholds: true,
        });
    }

    public stop(): void {
        this.logger.info("Enhanced CVD Confirmation detector stopped", {
            detector: this.getId(),
        });
    }

    public enable(): void {
        this.logger.info("Enhanced CVD Confirmation detector enabled");
    }

    public disable(): void {
        this.logger.info("Enhanced CVD Confirmation detector disabled");
    }

    public getStatus(): string {
        const stats = {
            activeWindows: this.windows.length,
            totalTrades: Array.from(this.states.values()).reduce(
                (sum, state) => sum + state.trades.length,
                0
            ),
            lastSignal: this.lastSignalTs,
            marketVolatility: this.marketRegime.volatility.toFixed(6),
            adaptiveThreshold: this.calculateAdaptiveThreshold().toFixed(2),
        };

        return `Enhanced CVD Detector: ${JSON.stringify(stats)}`;
    }

    /* ------------------------------------------------------------------ */
    /*  Advanced Analytics & Debugging                                    */
    /* ------------------------------------------------------------------ */

    /**
     * Get detailed internal state for debugging and monitoring
     */
    public getDetailedState(): {
        windows: number[];
        states: Array<{
            window: number;
            tradesCount: number;
            slopeStats: { mean: number; variance: number; count: number };
            priceStats: { mean: number; variance: number; count: number };
            volumeProfileSize: number;
        }>;
        marketRegime: MarketRegime;
        lastSignal: number;
        configuration: {
            minZ: number;
            adaptiveThreshold: number;
            priceCorrelationWeight: number;
            volumeConcentrationWeight: number;
        };
    } {
        const states = Array.from(this.states.entries()).map(
            ([window, state]) => ({
                window,
                tradesCount: state.trades.length,
                slopeStats: {
                    mean: state.rollingMean,
                    variance:
                        state.count > 1
                            ? state.rollingVar / (state.count - 1)
                            : 0,
                    count: state.count,
                },
                priceStats: {
                    mean: state.priceRollingMean,
                    variance:
                        state.priceCount > 1
                            ? state.priceRollingVar / (state.priceCount - 1)
                            : 0,
                    count: state.priceCount,
                },
                volumeProfileSize: state.volumeProfile.size,
            })
        );

        return {
            windows: this.windows,
            states,
            marketRegime: { ...this.marketRegime },
            lastSignal: this.lastSignalTs,
            configuration: {
                minZ: this.minZ,
                adaptiveThreshold: this.calculateAdaptiveThreshold(),
                priceCorrelationWeight: this.priceCorrelationWeight,
                volumeConcentrationWeight: this.volumeConcentrationWeight,
            },
        };
    }

    /**
     * Simulate confidence calculation for given parameters (testing/debugging)
     */
    public simulateConfidence(
        testZScores: Record<number, number>,
        testPriceCorrelations: Record<number, number>
    ): {
        factors: ConfidenceFactors;
        finalConfidence: number;
        breakdown: Record<string, number>;
    } {
        const slopes = this.windows.reduce(
            (acc, w) => {
                acc[w] = testZScores[w] * 100; // Mock slope from z-score
                return acc;
            },
            {} as Record<number, number>
        );

        const factors = this.calculateConfidenceFactors(
            slopes,
            testZScores,
            testPriceCorrelations,
            Date.now()
        );

        const finalConfidence = this.computeFinalConfidence(factors);

        const breakdown = {
            zScoreAlignment: factors.zScoreAlignment * 0.25,
            magnitudeStrength: factors.magnitudeStrength * 0.2,
            priceCorrelation:
                Math.abs(factors.priceCorrelation) *
                this.priceCorrelationWeight,
            volumeConcentration:
                factors.volumeConcentration * this.volumeConcentrationWeight,
            temporalConsistency: factors.temporalConsistency * 0.15,
            divergencePenalty: factors.divergencePenalty * 0.1,
        };

        return { factors, finalConfidence, breakdown };
    }
}

class CVDResultPool {
    private pool: CVDCalculationResult[] = [];
    private readonly maxSize = 100;

    acquire(): CVDCalculationResult {
        const result = this.pool.pop();
        if (result) {
            result.cvdSeries.length = 0; // Clear array
            result.slope = 0;
            return result;
        }
        return { cvdSeries: [], slope: 0 };
    }

    release(result: CVDCalculationResult): void {
        if (this.pool.length < this.maxSize) {
            this.pool.push(result);
        }
    }
}
