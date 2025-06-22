/* --------------------------------------------------------------------------
   Enhanced DeltaCVDConfirmation – Advanced multi-window CVD-slope detector
   --------------------------------------------------------------------------

   🔒 PRODUCTION-CRITICAL FILE (NO MODIFICATIONS WITHOUT EXPLICIT APPROVAL)

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
    ConfidenceFactors,
    MarketRegime,
    InstitutionalZone,
} from "../types/signalTypes.js";
import type { ILogger } from "../infrastructure/loggerInterface.js";
import type { IMetricsCollector } from "../infrastructure/metricsCollectorInterface.js";
import { ISignalLogger } from "../infrastructure/signalLoggerInterface.js";
import { SpoofingDetector } from "../services/spoofingDetector.js";
import type { BaseDetectorSettings } from "./interfaces/detectorInterfaces.js";
import { EnrichedTradeEvent } from "../types/marketEvents.js";

/* ------------------------------------------------------------------ */
/*  Enhanced Config & Types                                           */
/* ------------------------------------------------------------------ */

// PHASE 2: Depth data ingestion interfaces
interface EnrichedDepthEvent {
    timestamp: number;
    side: "bid" | "ask";
    level: number;
    price: number;
    quantity: number;
}

interface OrderbookSnapshot {
    timestamp: number;
    bids: { price: number; quantity: number }[];
    asks: { price: number; quantity: number }[];
}

// PHASE 5: Iceberg tracking interfaces
interface IcebergTracking {
    price: number;
    side: "bid" | "ask";
    refillCount: number;
    maxSize: number;
    totalVolume: number;
    firstSeen: number;
    lastRefill: number;
}

interface CVDCalculationResult {
    cvdSeries: number[];
    slope: number;
}

export interface DeltaCVDConfirmationSettings extends BaseDetectorSettings {
    windowsSec?: [60, 300, 900] | number[]; // analysed windows
    minZ?: number; // base min |zScore| on shortest window
    minTradesPerSec?: number; // floor scaled by window
    minVolPerSec?: number; // floor scaled by window

    // NEW: Detection mode
    detectionMode?: "momentum" | "divergence" | "hybrid"; // Default: "momentum"
    divergenceThreshold?: number; // 0.3 = 30% correlation threshold for divergence
    divergenceLookbackSec?: number; // 60 seconds to check for price/CVD divergence

    // Enhanced settings
    volatilityLookbackSec?: number; // window for volatility baseline (default: 3600)
    priceCorrelationWeight?: number; // how much price correlation affects confidence (0-1)
    volumeConcentrationWeight?: number; // weight for volume concentration factor
    adaptiveThresholdMultiplier?: number; // multiplier for adaptive z-score thresholds
    maxDivergenceAllowed?: number; // max allowed price/CVD divergence before penalty
    stateCleanupIntervalSec?: number; // how often to cleanup old state

    // Volume surge detection for 0.7%+ moves
    volumeSurgeMultiplier?: number; // 4x volume surge threshold for momentum detection
    imbalanceThreshold?: number; // 35% order flow imbalance threshold
    institutionalThreshold?: number; // 17.8 LTC institutional trade size threshold
    burstDetectionMs?: number; // 1000ms burst detection window
    sustainedVolumeMs?: number; // 30000ms sustained volume confirmation window
    medianTradeSize?: number; // 0.6 LTC median trade size baseline
    dynamicThresholds?: boolean;
    logDebug?: boolean;

    // PHASE 2: Depth analysis settings
    enableDepthAnalysis?: boolean;
    maxOrderbookAge?: number; // 5000ms

    // PHASE 3: Absorption detection
    absorptionCVDThreshold?: number; // 50
    absorptionPriceThreshold?: number; // 0.1

    // PHASE 4: Imbalance analysis
    imbalanceWeight?: number; // 0.2

    // PHASE 5: Iceberg detection
    icebergMinRefills?: number; // 3
    icebergMinSize?: number; // 20

    // Enhanced confidence
    baseConfidenceRequired?: number; // 0.4
    finalConfidenceRequired?: number; // 0.6
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

    // Volume surge detection state
    volumeHistory: { timestamp: number; volume: number }[]; // recent volume snapshots
    burstHistory: { timestamp: number; volume: number; imbalance: number }[]; // detected bursts
}

const MIN_SAMPLES_FOR_STATS = 30;
const VOLATILITY_LOOKBACK_DEFAULT = 3600; // 1 hour
const CLEANUP_INTERVAL_DEFAULT = 300; // 5 minutes

/* ------------------------------------------------------------------ */
/*  Enhanced Detector Implementation                                  */
/* ------------------------------------------------------------------ */
export class DeltaCVDConfirmation extends BaseDetector {
    /* ---- immutable config --------------------------------------- */
    protected readonly detectorType = "cvd_confirmation" as const;
    private readonly windows: number[];
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

    // Volume surge detection parameters
    private readonly volumeSurgeMultiplier: number;
    private readonly imbalanceThreshold: number;
    private readonly institutionalThreshold: number;
    private readonly burstDetectionMs: number;
    private readonly sustainedVolumeMs: number;
    private readonly medianTradeSize: number;

    // NEW: Detection mode configuration
    private readonly detectionMode: "momentum" | "divergence" | "hybrid";
    private readonly divergenceThreshold: number;
    private readonly divergenceLookbackSec: number;

    // PHASE 2: Depth analysis configuration
    private readonly enableDepthAnalysis: boolean;
    private readonly maxOrderbookAge: number;

    // PHASE 3: Absorption detection configuration
    private readonly absorptionCVDThreshold: number;
    private readonly absorptionPriceThreshold: number;

    // PHASE 4: Imbalance analysis configuration
    private readonly imbalanceWeight: number;

    // PHASE 5: Iceberg detection configuration
    private readonly icebergMinRefills: number;
    private readonly icebergMinSize: number;

    // Enhanced confidence thresholds
    private readonly baseConfidenceRequired: number;
    private readonly finalConfidenceRequired: number;

    /* ---- enhanced mutable state --------------------------------- */
    private readonly states = new Map<number, WindowState>();
    private lastSignalTs = 0;
    private lastStateCleanup = 0;

    // PHASE 2: Orderbook snapshot tracking
    private readonly orderbookSnapshots = new Map<number, OrderbookSnapshot>();
    private readonly maxSnapshotAge = 60000; // Keep 1 minute of snapshots

    // PHASE 5: Iceberg tracking state
    private readonly icebergTracking = new Map<string, IcebergTracking>();

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
        settings: DeltaCVDConfirmationSettings = {},
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

        // Volume surge detection parameters
        this.volumeSurgeMultiplier = settings.volumeSurgeMultiplier ?? 4.0;
        this.imbalanceThreshold = settings.imbalanceThreshold ?? 0.35;
        this.institutionalThreshold = settings.institutionalThreshold ?? 17.8;
        this.burstDetectionMs = settings.burstDetectionMs ?? 1000;
        this.sustainedVolumeMs = settings.sustainedVolumeMs ?? 30000;
        this.medianTradeSize = settings.medianTradeSize ?? 0.6;

        // NEW: Detection mode configuration
        this.detectionMode = settings.detectionMode ?? "momentum";
        this.divergenceThreshold = settings.divergenceThreshold ?? 0.3;
        this.divergenceLookbackSec = settings.divergenceLookbackSec ?? 60;

        // PHASE 2: Depth analysis configuration
        this.enableDepthAnalysis = settings.enableDepthAnalysis ?? true;
        this.maxOrderbookAge = settings.maxOrderbookAge ?? 5000;

        // PHASE 3: Absorption detection configuration
        this.absorptionCVDThreshold = settings.absorptionCVDThreshold ?? 50;
        this.absorptionPriceThreshold =
            settings.absorptionPriceThreshold ?? 0.1;

        // PHASE 4: Imbalance analysis configuration
        this.imbalanceWeight = settings.imbalanceWeight ?? 0.2;

        // PHASE 5: Iceberg detection configuration
        this.icebergMinRefills = settings.icebergMinRefills ?? 3;
        this.icebergMinSize = settings.icebergMinSize ?? 20;

        // Enhanced confidence thresholds
        this.baseConfidenceRequired = settings.baseConfidenceRequired ?? 0.4;
        this.finalConfidenceRequired = settings.finalConfidenceRequired ?? 0.6;

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
                volumeHistory: [],
                burstHistory: [],
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

            // Update volume surge tracking for momentum detection
            this.updateVolumeSurgeTracking(state, event);

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

    // PHASE 2: Depth data ingestion capability
    public processMarketEvent(
        event: EnrichedTradeEvent | EnrichedDepthEvent
    ): void {
        if ("side" in event && "level" in event) {
            // Depth event
            this.onDepthUpdate(event);
        } else {
            // Trade event (existing logic)
            this.onEnrichedTradeSpecific(event);
        }
    }

    protected onDepthUpdate(event: EnrichedDepthEvent): void {
        if (!this.enableDepthAnalysis) return;

        // Update orderbook snapshot
        this.updateOrderbookSnapshot(event);

        // Clean old snapshots
        this.cleanupOldSnapshots(event.timestamp);

        // PHASE 5: Detect iceberg patterns
        this.detectIcebergPattern(event);
    }

    private updateOrderbookSnapshot(event: EnrichedDepthEvent): void {
        const roundedTimestamp = Math.floor(event.timestamp / 1000) * 1000;

        let snapshot = this.orderbookSnapshots.get(roundedTimestamp);
        if (!snapshot) {
            snapshot = {
                timestamp: roundedTimestamp,
                bids: [],
                asks: [],
            };
            this.orderbookSnapshots.set(roundedTimestamp, snapshot);
        }

        const levels = event.side === "bid" ? snapshot.bids : snapshot.asks;
        const existingIndex = levels.findIndex((l) => l.price === event.price);

        if (event.quantity === 0) {
            // Remove level
            if (existingIndex >= 0) {
                levels.splice(existingIndex, 1);
            }
        } else {
            // Update or add level
            if (existingIndex >= 0) {
                levels[existingIndex].quantity = event.quantity;
            } else {
                levels.push({ price: event.price, quantity: event.quantity });
            }
        }

        // Sort levels (bids descending, asks ascending)
        if (event.side === "bid") {
            levels.sort((a, b) => b.price - a.price);
        } else {
            levels.sort((a, b) => a.price - b.price);
        }
    }

    private cleanupOldSnapshots(timestamp: number): void {
        const cutoff = timestamp - this.maxSnapshotAge;

        for (const [ts, snapshot] of this.orderbookSnapshots.entries()) {
            if (snapshot.timestamp < cutoff) {
                this.orderbookSnapshots.delete(ts);
            }
        }
    }

    private getOrderbookSnapshotNear(
        timestamp: number
    ): OrderbookSnapshot | null {
        // Find snapshot within maxOrderbookAge
        const tolerance = this.maxOrderbookAge;

        for (const snapshot of this.orderbookSnapshots.values()) {
            if (Math.abs(snapshot.timestamp - timestamp) <= tolerance) {
                return snapshot;
            }
        }

        return null;
    }

    /* ------------------------------------------------------------------ */
    /*  PHASE 3: Absorption Detection                                     */
    /* ------------------------------------------------------------------ */

    private validateAbsorptionConditions(windowSec: number): {
        detected: boolean;
        type: "bullish_absorption" | "bearish_absorption" | "none";
        strength: number;
        expectedSignal: "buy" | "sell" | "neutral";
        cvdMagnitude?: number;
        priceChange?: number;
    } {
        const state = this.states.get(windowSec)!;

        if (state.trades.length < 20) {
            return {
                detected: false,
                type: "none",
                strength: 0,
                expectedSignal: "neutral",
            };
        }

        // Calculate CVD with correct passive calculation
        let cvd = 0;
        const prices: number[] = [];

        state.trades.forEach((trade) => {
            const delta = trade.buyerIsMaker ? trade.quantity : -trade.quantity;
            cvd += delta;
            prices.push(trade.price);
        });

        if (prices.length < 2) {
            return {
                detected: false,
                type: "none",
                strength: 0,
                expectedSignal: "neutral",
            };
        }

        // Analyze divergence
        const priceChange =
            ((prices[prices.length - 1] - prices[0]) / prices[0]) * 100;
        const cvdMagnitude = Math.abs(cvd);

        // Absorption pattern: Strong CVD, weak price movement
        const strongCVD = cvdMagnitude > this.absorptionCVDThreshold;
        const weakPrice = Math.abs(priceChange) < this.absorptionPriceThreshold;

        if (strongCVD && weakPrice) {
            const type = cvd > 0 ? "bullish_absorption" : "bearish_absorption";
            const expectedSignal = cvd > 0 ? "buy" : "sell";
            const strength = Math.min(
                1.0,
                cvdMagnitude / (this.absorptionCVDThreshold * 4)
            );

            return {
                detected: true,
                type,
                strength,
                expectedSignal,
                cvdMagnitude,
                priceChange,
            };
        }

        return {
            detected: false,
            type: "none",
            strength: 0,
            expectedSignal: "neutral",
        };
    }

    /**
     * Enhanced signal builder that ALWAYS includes proper CVD data
     * Replaces the problematic buildAbsorptionSignal() method
     */
    private buildEnhancedSignalCandidate(
        slopes: Record<number, number>,
        zScores: Record<number, number>,
        priceCorrelations: Record<number, number>,
        confidenceFactors: ConfidenceFactors,
        finalConfidence: number,
        absorption: ReturnType<typeof this.validateAbsorptionConditions> | null,
        signalType: "enhanced_cvd" | "cvd_divergence" | "absorption_enhanced",
        timestamp: number
    ): DeltaCVDConfirmationResult {
        const shortestWindowState = this.states.get(this.windows[0])!;
        const lastTrade =
            shortestWindowState.trades[shortestWindowState.trades.length - 1];

        // Signal direction logic based on detection mode
        let side: "buy" | "sell" | "neutral";

        if (this.detectionMode === "divergence") {
            // In divergence mode, signal OPPOSITE to CVD direction
            const priceDirection =
                this.calculateRecentPriceDirection(shortestWindowState);
            const cvdDirection = slopes[this.windows[0]] > 0 ? "up" : "down";

            // If price up but CVD down → sell signal (expect reversal down)
            // If price down but CVD up → buy signal (expect reversal up)
            if (priceDirection === "up" && cvdDirection === "down") {
                side = "sell";
            } else if (priceDirection === "down" && cvdDirection === "up") {
                side = "buy";
            } else {
                side = "neutral";
            }
        } else {
            // Original momentum logic
            const slope = slopes[this.windows[0]];
            side = slope > 0 ? "buy" : slope < 0 ? "sell" : "neutral";
        }

        // If we have absorption, potentially override signal direction
        if (absorption?.detected && absorption.expectedSignal !== "neutral") {
            // In enhanced mode, absorption can provide additional conviction
            if (signalType === "absorption_enhanced") {
                // Use absorption signal if it aligns with CVD, otherwise use CVD
                if (
                    (side === "buy" && absorption.expectedSignal === "buy") ||
                    (side === "sell" && absorption.expectedSignal === "sell")
                ) {
                    // Perfect alignment - keep CVD signal
                } else {
                    // Conflict - use the stronger signal or default to CVD
                    side = side; // Keep CVD signal as primary
                }
            }
        }

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
            slopes, // ✅ REAL CVD slopes, not hardcoded zeros!
            zScores, // ✅ REAL z-scores, not hardcoded zeros!
            tradesInWindow: shortestWindowState.trades.length,
            rateOfChange,
            confidence: finalConfidence,
            windowVolume,

            // Enhanced metadata with absorption information
            metadata: {
                confidenceFactors,
                priceCorrelations,
                marketRegime: { ...this.marketRegime },
                adaptiveThreshold: this.calculateAdaptiveThreshold(),
                timestamp,
                signalType, // Track what type of signal this is

                // CVD Analysis (always present now!)
                cvdAnalysis: {
                    shortestWindowSlope: slopes[this.windows[0]],
                    shortestWindowZScore: zScores[this.windows[0]],
                    requiredMinZ: this.calculateAdaptiveThreshold(),
                    detectionMode: this.detectionMode,
                    passedStatisticalTest:
                        Math.abs(zScores[this.windows[0]]) >=
                        this.calculateAdaptiveThreshold(),
                },

                // Absorption Analysis (if present)
                absorptionAnalysis: absorption?.detected
                    ? {
                          type: absorption.type,
                          strength: absorption.strength,
                          expectedSignal: absorption.expectedSignal,
                          cvdMagnitude: absorption.cvdMagnitude,
                          priceChange: absorption.priceChange,
                          alignsWithCVD:
                              (side === "buy" &&
                                  absorption.expectedSignal === "buy") ||
                              (side === "sell" &&
                                  absorption.expectedSignal === "sell"),
                      }
                    : null,

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

                // Quality metrics
                qualityMetrics: {
                    cvdStatisticalSignificance:
                        Math.abs(zScores[this.windows[0]]) /
                        this.calculateAdaptiveThreshold(),
                    absorptionConfirmation: absorption?.detected || false,
                    signalPurity:
                        signalType === "absorption_enhanced"
                            ? "premium"
                            : "standard",
                },
            },
        };

        return candidate;
    }

    /* ------------------------------------------------------------------ */
    /*  PHASE 4: Orderbook Imbalance Analysis                            */
    /* ------------------------------------------------------------------ */

    private calculateOrderbookImbalance(timestamp: number): {
        imbalance: number; // -1 to 1, negative = ask heavy, positive = bid heavy
        strength: number; // 0 to 1, how significant the imbalance is
        signal: "buy" | "sell" | "neutral";
    } {
        const snapshot = this.getOrderbookSnapshotNear(timestamp);
        if (!snapshot) return { imbalance: 0, strength: 0, signal: "neutral" };

        // Calculate top 5 levels on each side
        const bidDepth = snapshot.bids
            .slice(0, 5)
            .reduce((sum, bid) => sum + bid.quantity, 0);
        const askDepth = snapshot.asks
            .slice(0, 5)
            .reduce((sum, ask) => sum + ask.quantity, 0);

        const totalDepth = bidDepth + askDepth;
        if (totalDepth === 0)
            return { imbalance: 0, strength: 0, signal: "neutral" };

        const imbalance = (bidDepth - askDepth) / totalDepth;
        const strength = Math.abs(imbalance);

        let signal: "buy" | "sell" | "neutral" = "neutral";
        if (imbalance > 0.2) signal = "buy"; // Strong bid depth
        if (imbalance < -0.2) signal = "sell"; // Strong ask depth

        return { imbalance, strength, signal };
    }

    /* ------------------------------------------------------------------ */
    /*  PHASE 5: Iceberg Detection                                       */
    /* ------------------------------------------------------------------ */

    private detectIcebergPattern(event: EnrichedDepthEvent): void {
        if (!this.enableDepthAnalysis) return;

        const levelKey = `${event.side}_${event.price.toFixed(4)}`;

        if (event.quantity === 0) {
            // Level removed - finalize iceberg tracking
            this.icebergTracking.delete(levelKey);
        } else {
            // Check for refill pattern
            const existing = this.icebergTracking.get(levelKey);
            if (existing) {
                // Detect refill (size suddenly increased)
                if (event.quantity > existing.maxSize * 1.3) {
                    existing.refillCount++;
                    existing.maxSize = event.quantity;
                    existing.totalVolume += event.quantity;
                    existing.lastRefill = event.timestamp;

                    // Log potential iceberg
                    if (existing.refillCount >= this.icebergMinRefills) {
                        this.logger.info(`Iceberg detected at ${event.price}`, {
                            side: event.side,
                            refillCount: existing.refillCount,
                            totalVolume: existing.totalVolume,
                            maxSize: existing.maxSize,
                        });
                    }
                }
            } else if (event.quantity > this.icebergMinSize) {
                // Track large new levels
                this.icebergTracking.set(levelKey, {
                    price: event.price,
                    side: event.side,
                    refillCount: 1,
                    maxSize: event.quantity,
                    totalVolume: event.quantity,
                    firstSeen: event.timestamp,
                    lastRefill: event.timestamp,
                });
            }
        }
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
            this.logger.error(
                "[DeltaCVDConfirmation] Market regime update failed",
                {
                    error,
                    eventPrice: event.price,
                }
            );
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
        const cvdDelta = event.buyerIsMaker ? event.quantity : -event.quantity;

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

                this.logger.debug(
                    "[DeltaCVDConfirmation] Aggressive CVD profile cleanup completed",
                    {
                        originalSize: totalProfileSize,
                        newSize: state.cvdProfile.size,
                        zonesKept: state.institutionalZones.length,
                    }
                );
            }
        } catch (error) {
            this.logger.error(
                "[DeltaCVDConfirmation] CVD profile cleanup failed",
                { error: error }
            );
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

        this.logger.debug(
            "[DeltaCVDConfirmation] Periodic state cleanup completed",
            {
                detector: this.getId(),
                timestamp: now,
                statesCount: this.states.size,
            }
        );
    }

    /* ------------------------------------------------------------------ */
    /*  Volume Surge Detection for 0.7%+ Moves                         */
    /* ------------------------------------------------------------------ */

    private updateVolumeSurgeTracking(
        state: WindowState,
        event: EnrichedTradeEvent
    ): void {
        const now = event.timestamp;

        // Update volume history with current trade volume
        state.volumeHistory.push({
            timestamp: now,
            volume: event.quantity,
        });

        // Clean old volume history (keep last 30 seconds for sustained volume check)
        const cutoff = now - this.sustainedVolumeMs;
        state.volumeHistory = state.volumeHistory.filter(
            (vh) => vh.timestamp > cutoff
        );

        // Clean old burst history (keep last 5 minutes for pattern analysis)
        const burstCutoff = now - 300000; // 5 minutes
        state.burstHistory = state.burstHistory.filter(
            (bh) => bh.timestamp > burstCutoff
        );
    }

    private detectVolumeSurge(state: WindowState, now: number): boolean {
        if (state.volumeHistory.length < 10) return false; // Need minimum data

        // Calculate recent volume (last 1 second)
        const recentCutoff = now - this.burstDetectionMs;
        const recentVolume = state.volumeHistory
            .filter((vh) => vh.timestamp > recentCutoff)
            .reduce((sum, vh) => sum + vh.volume, 0);

        // Calculate baseline volume (previous 30 seconds, excluding recent 1 second)
        const baselineCutoff = now - this.sustainedVolumeMs;
        const baselineHistory = state.volumeHistory.filter(
            (vh) =>
                vh.timestamp > baselineCutoff && vh.timestamp <= recentCutoff
        );

        if (baselineHistory.length === 0) return false;

        const baselineVolume =
            baselineHistory.reduce((sum, vh) => sum + vh.volume, 0) /
            (baselineHistory.length || 1);

        // Check for volume surge (4x baseline)
        const volumeMultiplier =
            recentVolume / (baselineVolume || this.medianTradeSize);
        return volumeMultiplier >= this.volumeSurgeMultiplier;
    }

    private detectOrderFlowImbalance(
        state: WindowState,
        now: number
    ): { detected: boolean; imbalance: number } {
        const recentCutoff = now - this.burstDetectionMs;
        const recentTrades = state.trades.filter(
            (t) => t.timestamp > recentCutoff
        );

        if (recentTrades.length < 3) return { detected: false, imbalance: 0 }; // Need minimum trades

        const buyVolume = recentTrades
            .filter((t) => !t.buyerIsMaker) // Aggressive buys
            .reduce((sum, t) => sum + t.quantity, 0);

        const sellVolume = recentTrades
            .filter((t) => t.buyerIsMaker) // Aggressive sells
            .reduce((sum, t) => sum + t.quantity, 0);

        const totalVolume = buyVolume + sellVolume;
        if (totalVolume === 0) return { detected: false, imbalance: 0 };

        // Calculate imbalance (positive = buy imbalance, negative = sell imbalance)
        const imbalance = Math.abs(buyVolume - sellVolume) / totalVolume;

        return {
            detected: imbalance >= this.imbalanceThreshold,
            imbalance,
        };
    }

    private detectInstitutionalActivity(
        state: WindowState,
        now: number
    ): boolean {
        const recentCutoff = now - this.burstDetectionMs;
        const institutionalTrades = state.trades.filter(
            (t) =>
                t.timestamp > recentCutoff &&
                t.quantity >= this.institutionalThreshold
        );

        // Look for institutional-sized trades in the recent burst window
        return institutionalTrades.length > 0;
    }

    private validateVolumeSurgeConditions(
        state: WindowState,
        now: number
    ): { valid: boolean; reason?: string } {
        // Check for volume surge
        const hasVolumeSurge = this.detectVolumeSurge(state, now);
        if (!hasVolumeSurge) {
            return { valid: false, reason: "no_volume_surge" };
        }

        // Check for order flow imbalance
        const imbalanceResult = this.detectOrderFlowImbalance(state, now);
        if (!imbalanceResult.detected) {
            return { valid: false, reason: "insufficient_imbalance" };
        }

        // Check for institutional activity (optional enhancement)
        const hasInstitutional = this.detectInstitutionalActivity(state, now);

        // Record the burst for historical analysis
        state.burstHistory.push({
            timestamp: now,
            volume: state.volumeHistory
                .filter((vh) => vh.timestamp > now - this.burstDetectionMs)
                .reduce((sum, vh) => sum + vh.volume, 0),
            imbalance: imbalanceResult.imbalance,
        });

        this.logger.debug(
            "[DeltaCVDConfirmation] Volume surge conditions validated",
            {
                detector: this.getId(),
                hasVolumeSurge,
                imbalance: imbalanceResult.imbalance,
                hasInstitutional,
                reason: hasInstitutional
                    ? "institutional_enhanced"
                    : "volume_imbalance_confirmed",
            }
        );

        return { valid: true };
    }

    /* ------------------------------------------------------------------ */
    /*  Enhanced Signal Detection with Confidence Scoring                */
    /* ------------------------------------------------------------------ */

    private tryEmitSignal(now: number): void {
        // STEP 1: ALWAYS calculate CVD divergence first (no bypassing!)
        const slopes: Record<number, number> = {};
        const zScores: Record<number, number> = {};
        const priceCorrelations: Record<number, number> = {};

        // Calculate CVD for all windows
        for (const w of this.windows) {
            const state = this.states.get(w)!;
            if (state.trades.length < MIN_SAMPLES_FOR_STATS) return;

            // Enhanced trade/volume validation
            const result = this.validateTradeActivity(state, w);
            if (!result.valid) {
                this.metricsCollector.incrementCounter(
                    "cvd_signals_rejected_total",
                    1,
                    { reason: result.reason }
                );
                return;
            }

            // Volume surge validation for 0.7%+ moves (only check shortest window for responsiveness)
            if (w === this.windows[0]) {
                const surgeResult = this.validateVolumeSurgeConditions(
                    state,
                    now
                );
                if (!surgeResult.valid) {
                    this.metricsCollector.incrementCounter(
                        "cvd_signals_rejected_total",
                        1,
                        { reason: surgeResult.reason || "volume_surge_failed" }
                    );
                    return;
                }
            }

            // Compute CVD series and slope
            const cvdResult: CVDCalculationResult = this.computeCVDSlope(state);
            const { cvdSeries, slope } = cvdResult;

            // Calculate price correlation for this window
            const priceCorrelation = this.calculatePriceCorrelation(
                state,
                cvdSeries
            );
            priceCorrelations[w] = priceCorrelation;

            // Update slope statistics using Welford's algorithm
            this.updateSlopeStatistics(state, slope);

            // Calculate adaptive z-score threshold
            const adaptiveMinZ = this.calculateAdaptiveThreshold();
            const zScore = this.calculateZScore(state, slope);

            slopes[w] = slope;
            zScores[w] = zScore;

            // Release the pooled result object for reuse
            this.cvdResultPool.release(cvdResult);

            this.logger.debug(`[DeltaCVDConfirmation] Window ${w}s analysis`, {
                slope,
                zScore,
                priceCorrelation,
                adaptiveMinZ,
                tradesCount: state.trades.length,
            });
        }

        // STEP 2: REQUIRE CVD statistical significance FIRST
        const validationResult = this.validateSignalConditions(
            zScores,
            priceCorrelations
        );
        if (!validationResult.valid) {
            this.metricsCollector.incrementCounter(
                "cvd_signals_rejected_total",
                1,
                { reason: validationResult.reason }
            );
            return;
        }

        // STEP 3: Check for absorption as ADDITIONAL confirmation (not replacement!)
        const absorption = this.validateAbsorptionConditions(this.windows[0]);

        // STEP 4: Decide signal type based on what we have
        let signalType:
            | "enhanced_cvd"
            | "cvd_divergence"
            | "absorption_enhanced";
        let enhancedConfidence = false;

        if (absorption.detected && absorption.strength > 0.5) {
            // We have BOTH CVD divergence AND absorption - this is the premium signal!
            signalType = "absorption_enhanced";
            enhancedConfidence = true;

            this.logger.info(
                `[CVD] ENHANCED SIGNAL: CVD divergence + absorption alignment detected`,
                {
                    cvdZScore: zScores[this.windows[0]],
                    absorptionStrength: absorption.strength,
                    absorptionType: absorption.type,
                }
            );
        } else {
            // We have CVD divergence but no absorption confirmation
            signalType = "cvd_divergence";

            this.logger.info(
                `[CVD] Standard CVD divergence signal (no absorption confirmation)`,
                {
                    cvdZScore: zScores[this.windows[0]],
                    detectionMode: this.detectionMode,
                }
            );
        }

        // Throttle signals
        if (now - this.lastSignalTs < 60_000) return;
        this.lastSignalTs = now;

        // STEP 5: Calculate comprehensive confidence score
        const confidenceFactors = this.calculateConfidenceFactors(
            slopes,
            zScores,
            priceCorrelations,
            now
        );

        let finalConfidence = this.computeFinalConfidence(
            confidenceFactors,
            now
        );

        // STEP 6: Apply absorption enhancement bonus (if applicable)
        if (enhancedConfidence) {
            const absorptionBonus = absorption.strength * 0.15; // 15% max bonus
            finalConfidence = Math.min(0.98, finalConfidence + absorptionBonus);
        }

        // STEP 7: Build the signal with proper CVD data (no more hardcoded zeros!)
        const candidate = this.buildEnhancedSignalCandidate(
            slopes,
            zScores,
            priceCorrelations,
            confidenceFactors,
            finalConfidence,
            absorption.detected ? absorption : null,
            signalType,
            now
        );

        // Emit signal
        this.handleDetection(candidate);
        this.metricsCollector.incrementCounter("cvd_confirmations_total", 1);
        this.metricsCollector.recordHistogram(
            "cvd_confidence_scores",
            finalConfidence,
            { signal_side: candidate.side }
        );

        this.logger.info("[DeltaCVDConfirmation] CVD signal emitted", {
            detector: this.getId(),
            side: candidate.side,
            confidence: finalConfidence,
            price: candidate.price,
            signalType,
            hasAbsorption: absorption.detected,
            cvdZScore: zScores[this.windows[0]],
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

                const delta = tr.buyerIsMaker ? tr.quantity : -tr.quantity;
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
            this.logger.error(
                "[DeltaCVDConfirmation] CVD slope calculation failed",
                { error: error }
            );
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
            this.logger.error(
                "[DeltaCVDConfirmation] Price correlation calculation failed",
                {
                    error: error,
                }
            );
            return 0;
        }
    }

    private updateSlopeStatistics(state: WindowState, slope: number): void {
        const delta = slope - state.rollingMean;
        state.count += 1;
        if (state.count === 1) {
            state.rollingVar = 0; // Initialize
        }
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

            // NEW: Mode-specific validation
            if (this.detectionMode === "divergence") {
                return this.validateDivergenceConditions(
                    zScores,
                    priceCorrelations
                );
            } else if (this.detectionMode === "hybrid") {
                // Try divergence first, fall back to momentum
                const divergenceResult = this.validateDivergenceConditions(
                    zScores,
                    priceCorrelations
                );
                if (divergenceResult.valid) return divergenceResult;
                return this.validateMomentumConditions(
                    zScores,
                    priceCorrelations
                );
            } else {
                // Default momentum mode (existing logic)
                return this.validateMomentumConditions(
                    zScores,
                    priceCorrelations
                );
            }
        } catch (error) {
            this.logger.error(
                "[DeltaCVDConfirmation] Signal validation failed",
                { error: error }
            );
            return { valid: false, reason: "validation_error" };
        }
    }

    // NEW: DIVERGENCE VALIDATION METHOD
    private validateDivergenceConditions(
        zScores: Record<number, number>,
        priceCorrelations: Record<number, number>
    ): { valid: boolean; reason: string } {
        const shortWindow = this.windows[0];
        const state = this.states.get(shortWindow)!;

        // Check for significant CVD activity (lower threshold than momentum mode)
        const shortZ = Math.abs(zScores[shortWindow]);
        if (shortZ < this.minZ * 0.5) {
            // Half the normal threshold
            return { valid: false, reason: "insufficient_cvd_activity" };
        }

        // REWARD divergence instead of penalizing it
        const avgCorrelation =
            this.windows
                .map((w) => Math.abs(priceCorrelations[w]))
                .reduce((sum, corr) => sum + corr, 0) / this.windows.length;

        // In divergence mode, we WANT low correlation (divergence)
        if (avgCorrelation > this.divergenceThreshold) {
            return { valid: false, reason: "price_cvd_too_correlated" };
        }

        // Check for price/CVD direction mismatch in recent period
        // For simulation mode, we can skip the detailed price direction check
        // since we don't have actual trade data
        if (state && state.trades.length >= 20) {
            const priceDirection = this.calculateRecentPriceDirection(state);
            const cvdDirection = zScores[shortWindow] > 0 ? "up" : "down";

            const hasDivergence =
                (priceDirection === "up" && cvdDirection === "down") ||
                (priceDirection === "down" && cvdDirection === "up");

            if (!hasDivergence) {
                return { valid: false, reason: "no_price_cvd_divergence" };
            }
        }
        // In simulation mode without trade data, we accept based on correlation alone

        return { valid: true, reason: "divergence_detected" };
    }

    // NEW: MOMENTUM VALIDATION (existing logic extracted)
    private validateMomentumConditions(
        zScores: Record<number, number>,
        priceCorrelations: Record<number, number>
    ): { valid: boolean; reason: string } {
        // Check sign alignment with validation
        const signs = this.windows.map((w) => {
            const zScore = zScores[w];
            return isFinite(zScore) ? Math.sign(zScore) : 0;
        });

        if (signs.some((s) => s === 0) || !signs.every((s) => s === signs[0])) {
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

        return { valid: true, reason: "momentum_confirmed" };
    }

    // NEW: RECENT PRICE DIRECTION HELPER
    private calculateRecentPriceDirection(
        state: WindowState
    ): "up" | "down" | "sideways" {
        if (state.trades.length < 20) return "sideways";

        // Look at price movement over the divergence lookback period
        const lookbackMs = this.divergenceLookbackSec * 1000;
        const now = state.trades[state.trades.length - 1].timestamp;
        const cutoff = now - lookbackMs;

        const recentTrades = state.trades.filter((t) => t.timestamp >= cutoff);
        if (recentTrades.length < 10) return "sideways";

        const startPrice = recentTrades[0].price;
        const endPrice = recentTrades[recentTrades.length - 1].price;
        const priceChange = (endPrice - startPrice) / startPrice;

        if (priceChange > 0.001) return "up"; // 0.1% threshold
        if (priceChange < -0.001) return "down";
        return "sideways";
    }

    /* ------------------------------------------------------------------ */
    /*  Confidence Scoring System                                         */
    /* ------------------------------------------------------------------ */

    private calculateConfidenceFactors(
        slopes: Record<number, number>,
        zScores: Record<number, number>,
        priceCorrelations: Record<number, number>,
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        _timestamp: number
    ): ConfidenceFactors {
        // Note: timestamp parameter reserved for future temporal analysis features
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

        // Guard against single-window configuration
        if (slopeValues.length < 2) {
            return 0;
        }

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

    private computeFinalConfidence(
        factors: ConfidenceFactors,
        timestamp?: number
    ): number {
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

        // PHASE 4: Add imbalance bonus if depth analysis enabled and timestamp provided
        if (this.enableDepthAnalysis && timestamp) {
            const imbalanceAnalysis =
                this.calculateOrderbookImbalance(timestamp);
            const imbalanceBonus =
                imbalanceAnalysis.strength * this.imbalanceWeight;
            confidence = Math.min(1.0, confidence + imbalanceBonus);
        }

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
        const shortestWindowState = this.states.get(this.windows[0])!;
        const lastTrade =
            shortestWindowState.trades[shortestWindowState.trades.length - 1];

        // NEW: Mode-specific signal direction
        let side: "buy" | "sell" | "neutral";

        if (this.detectionMode === "divergence") {
            // In divergence mode, signal OPPOSITE to CVD direction
            const priceDirection =
                this.calculateRecentPriceDirection(shortestWindowState);
            const cvdDirection = slopes[this.windows[0]] > 0 ? "up" : "down";

            // If price up but CVD down → sell signal (expect reversal down)
            // If price down but CVD up → buy signal (expect reversal up)
            if (priceDirection === "up" && cvdDirection === "down") {
                side = "sell";
            } else if (priceDirection === "down" && cvdDirection === "up") {
                side = "buy";
            } else {
                side = "neutral";
            }
        } else {
            // Original momentum logic
            const slope = slopes[this.windows[0]];
            side = slope > 0 ? "buy" : slope < 0 ? "sell" : "neutral";
        }

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
            const delta = trade.buyerIsMaker ? trade.quantity : -trade.quantity;
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
        this.logger.info(
            "[DeltaCVDConfirmation] Enhanced CVD Confirmation detector started",
            {
                detector: this.getId(),
                windows: this.windows,
                minZ: this.minZ,
                adaptiveThresholds: true,
            }
        );
    }

    public stop(): void {
        this.logger.info(
            "[DeltaCVDConfirmation] Enhanced CVD Confirmation detector stopped",
            {
                detector: this.getId(),
            }
        );
    }

    public enable(): void {
        this.logger.info(
            "[DeltaCVDConfirmation] Enhanced CVD Confirmation detector enabled"
        );
    }

    public disable(): void {
        this.logger.info(
            "[DeltaCVDConfirmation] Enhanced CVD Confirmation detector disabled"
        );
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
        // FIX: Validate inputs to handle NaN values
        const validZScores: Record<number, number> = {};
        const validCorrelations: Record<number, number> = {};

        for (const window of this.windows) {
            validZScores[window] = Number.isFinite(testZScores[window])
                ? testZScores[window]
                : 0;
            validCorrelations[window] = Number.isFinite(
                testPriceCorrelations[window]
            )
                ? testPriceCorrelations[window]
                : 0;
        }

        // FIX: Respect detection mode in simulation
        const validationResult = this.validateSignalConditions(
            validZScores,
            validCorrelations
        );

        // If validation fails, return low confidence
        if (!validationResult.valid) {
            const emptyFactors: ConfidenceFactors = {
                zScoreAlignment: 0,
                magnitudeStrength: 0,
                priceCorrelation: 0,
                volumeConcentration: 0,
                temporalConsistency: 0,
                divergencePenalty: 0,
            };

            return {
                factors: emptyFactors,
                finalConfidence: 0,
                breakdown: {
                    zScoreAlignment: 0,
                    magnitudeStrength: 0,
                    priceCorrelation: 0,
                    volumeConcentration: 0,
                    temporalConsistency: 0,
                    divergencePenalty: 0,
                },
            };
        }

        const slopes = this.windows.reduce(
            (acc, w) => {
                acc[w] = validZScores[w] * 100; // Mock slope from z-score
                return acc;
            },
            {} as Record<number, number>
        );

        const factors = this.calculateConfidenceFactors(
            slopes,
            validZScores,
            validCorrelations,
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
