// src/indicators/base/baseDetector.ts
import { Detector } from "./detectorEnrichedTrade.js";
import { SpotWebsocketStreams } from "@binance/spot";
import { randomUUID } from "crypto";
import type { ILogger } from "../../infrastructure/loggerInterface.js";
import type { IMetricsCollector } from "../../infrastructure/metricsCollectorInterface.js";
import { ISignalLogger } from "../../infrastructure/signalLoggerInterface.js";
import { RollingWindow } from "../../utils/rollingWindow.js";
import { SharedPools } from "../../utils/objectPool.js";
import {
    SignalType,
    SignalCandidate,
    DetectorResultType,
} from "../../types/signalTypes.js";

import type {
    EnrichedTradeEvent,
    AggressiveTrade,
} from "../../types/marketEvents.js";

import { DepthLevel } from "../../utils/interfaces.js";
import { CircularBuffer } from "../../utils/circularBuffer.js";
import { TimeAwareCache } from "../../utils/timeAwareCache.js";
import { AdaptiveZoneCalculator } from "../../utils/adaptiveZoneCalculator.js";
import { PassiveVolumeTracker } from "../../utils/passiveVolumeTracker.js";
import { SpoofingDetector } from "../../services/spoofingDetector.js";
import { FinancialMath } from "../../utils/financialMath.js";
import {
    AdaptiveThresholdCalculator,
    AdaptiveThresholds,
} from "../marketRegimeDetector.js";
import type {
    IDetector,
    DetectorStats,
    BaseDetectorSettings,
    DetectorFeatures,
    ImbalanceResult,
    VolumeCalculationResult,
} from "../interfaces/detectorInterfaces.js";
import { EWMA } from "../../utils/ewma.js";

export type ZoneSample = {
    bid: number;
    ask: number;
    total: number;
    timestamp: number;
};

/**
 * Abstract base class for orderflow detectors
 */
export abstract class BaseDetector extends Detector implements IDetector {
    // Data storage
    protected readonly depth = new TimeAwareCache<number, DepthLevel>(300000);
    protected readonly trades = new CircularBuffer<AggressiveTrade>(4000);

    // Configuration
    protected readonly windowMs: number;
    protected minAggVolume: number;
    protected readonly pricePrecision: number;
    protected zoneTicks: number;
    protected readonly eventCooldownMs: number;
    protected readonly symbol: string;

    // Confirmation parameters
    protected readonly minInitialMoveTicks: number;
    protected readonly confirmationTimeoutMs: number;
    protected readonly maxRevisitTicks: number;

    // Cooldown tracking
    protected readonly lastSignal = new TimeAwareCache<string, number>(900000);

    // Feature modules
    protected readonly features: DetectorFeatures;
    protected readonly spoofingDetector: SpoofingDetector;
    protected readonly adaptiveZoneCalculator: AdaptiveZoneCalculator;
    protected readonly passiveVolumeTracker: PassiveVolumeTracker;

    // Adaptive threshold system (shared across detectors)
    protected readonly adaptiveThresholdCalculator: AdaptiveThresholdCalculator;
    protected currentThresholds: AdaptiveThresholds;
    protected readonly performanceHistory: Map<string, number>;
    protected recentSignalCount: number;
    protected lastThresholdUpdate: number;
    protected readonly updateIntervalMs: number;

    // Abstract method for detector type
    protected abstract readonly detectorType: SignalType;

    protected lastTradeId: string | null = null;
    private zoneCleanupInterval: NodeJS.Timeout | null = null;

    // NEW: rolling window for passive volume tracking (strict apples-to-apples orderflow logic)
    protected readonly rollingPassiveVolume: RollingWindow;
    protected readonly zoneAgg = new Map<
        number,
        { trades: AggressiveTrade[]; vol: number }
    >();
    private totalPassive = 0;
    protected readonly zonePassiveHistory: Map<
        number,
        RollingWindow<ZoneSample>
    > = new Map();

    protected readonly passiveEWMA = new EWMA(15_000);
    protected readonly aggressiveEWMA = new EWMA(15_000);
    protected readonly aggrBuyEWMA: EWMA = new EWMA(15_000);
    protected readonly aggrSellEWMA: EWMA = new EWMA(15_000);

    constructor(
        id: string,
        settings: BaseDetectorSettings & { features?: DetectorFeatures },
        logger: ILogger,
        spoofingDetector: SpoofingDetector,
        metricsCollector: IMetricsCollector,
        signalLogger?: ISignalLogger
    ) {
        super(id, logger, metricsCollector, signalLogger);

        // Validate settings
        this.validateSettings(settings);

        // Initialize configuration
        this.windowMs = settings.windowMs ?? 90000;
        this.minAggVolume = settings.minAggVolume ?? 600;
        this.pricePrecision = settings.pricePrecision ?? 2;
        this.zoneTicks = settings.zoneTicks ?? 3;
        this.eventCooldownMs = settings.eventCooldownMs ?? 15000;
        this.minInitialMoveTicks = settings.minInitialMoveTicks ?? 10;
        this.confirmationTimeoutMs = settings.confirmationTimeoutMs ?? 60000;
        this.maxRevisitTicks = settings.maxRevisitTicks ?? 5;
        this.symbol = settings.symbol ?? "LTCUSDT";

        // Initialize features with defaults
        this.features = {
            spoofingDetection: true,
            adaptiveZone: true,
            passiveHistory: true,
            multiZone: true,
            autoCalibrate: true,
            ...settings.features,
        };

        // Initialize feature modules
        this.spoofingDetector = spoofingDetector;
        this.adaptiveZoneCalculator = new AdaptiveZoneCalculator();
        this.passiveVolumeTracker = new PassiveVolumeTracker();

        // Initialize adaptive threshold system
        this.adaptiveThresholdCalculator = new AdaptiveThresholdCalculator();
        this.performanceHistory = new Map<string, number>();
        this.recentSignalCount = 0;
        this.lastThresholdUpdate = 0;
        this.updateIntervalMs = settings.updateIntervalMs ?? 300000; // 5 minutes default
        this.currentThresholds =
            this.adaptiveThresholdCalculator.calculateAdaptiveThresholds(
                this.performanceHistory,
                this.recentSignalCount
            );

        // NEW: initialize rolling window for passive volume, window size based on windowMs (1 sample per second)
        const rollingWindowSize = Math.max(Math.ceil(this.windowMs / 1000), 10);
        this.rollingPassiveVolume = new RollingWindow(rollingWindowSize);

        this.setupZoneCleanup();
    }

    /**
     * Setup periodic cleanup of old zone data
     */
    protected setupZoneCleanup(): void {
        this.zoneCleanupInterval = setInterval(() => {
            this.cleanupOldZoneData();
        }, this.windowMs);
    }

    /**
     * Clean up old zone data beyond retention window
     * Enhanced to handle pool cleanup within rolling windows
     */
    protected cleanupOldZoneData(): void {
        const cutoff = Date.now() - this.windowMs * 2;
        const sharedPools = SharedPools.getInstance();

        for (const [zone, window] of this.zonePassiveHistory) {
            const samples = window.toArray();
            const lastTimestamp = samples.at(-1)?.timestamp ?? 0;

            if (lastTimestamp < cutoff) {
                // Return all zone sample objects to pool before deletion
                for (const sample of samples) {
                    sharedPools.zoneSamples.release(sample);
                }

                this.zonePassiveHistory.delete(zone);
            } else {
                // Clean up individual old samples within the window
                const validSamples: ZoneSample[] = [];
                for (const sample of samples) {
                    if (sample.timestamp >= cutoff) {
                        validSamples.push(sample);
                    } else {
                        // Release old sample back to pool
                        sharedPools.zoneSamples.release(sample);
                    }
                }

                // Rebuild the window with only valid samples if needed
                if (validSamples.length !== samples.length) {
                    window.clear();
                    for (const sample of validSamples) {
                        window.push(sample);
                    }
                }
            }
        }
    }

    /**
     * Safe internal calculation methods to replace DetectorUtils dependencies
     */
    protected safeMean(values: number[]): number {
        if (!values || values.length === 0) {
            return 0;
        }

        let sum = 0;
        let validCount = 0;

        for (const value of values) {
            if (isFinite(value) && !isNaN(value)) {
                sum += value;
                validCount++;
            }
        }

        return validCount > 0 ? sum / validCount : 0;
    }

    protected safeCalculateZone(price: number): number {
        if (
            !isFinite(price) ||
            isNaN(price) ||
            price <= 0 ||
            this.zoneTicks <= 0 ||
            this.pricePrecision < 0
        ) {
            this.logger.warn(
                "[BaseDetector] Invalid zone calculation parameters",
                {
                    price,
                    zoneTicks: this.zoneTicks,
                    pricePrecision: this.pricePrecision,
                }
            );
            return 0;
        }

        // Use integer arithmetic for financial precision
        const scale = Math.pow(10, this.pricePrecision);
        const scaledPrice = Math.round(price * scale);
        const scaledTickSize = Math.round(
            Math.pow(10, -this.pricePrecision) * scale
        );
        const scaledZoneSize = this.zoneTicks * scaledTickSize;

        // Ensure consistent rounding across all detectors
        const scaledResult =
            Math.round(scaledPrice / scaledZoneSize) * scaledZoneSize;
        return scaledResult / scale;
    }

    /**
     * Validate detector settings
     */
    protected validateSettings(settings: BaseDetectorSettings): void {
        if (settings.windowMs !== undefined && settings.windowMs < 1000) {
            throw new Error("windowMs must be at least 1000ms");
        }
        if (settings.minAggVolume !== undefined && settings.minAggVolume <= 0) {
            throw new Error("minAggVolume must be positive");
        }
        if (
            settings.pricePrecision !== undefined &&
            (settings.pricePrecision < 0 || settings.pricePrecision > 8)
        ) {
            throw new Error("pricePrecision must be between 0 and 8");
        }
        if (settings.zoneTicks !== undefined && settings.zoneTicks <= 0) {
            throw new Error("zoneTicks must be positive");
        }
        if (
            settings.eventCooldownMs !== undefined &&
            settings.eventCooldownMs < 0
        ) {
            throw new Error("eventCooldownMs must be non-negative");
        }
    }

    /**
     * Add a new trade to the detector
     */
    public addTrade(tradeData: AggressiveTrade): void {
        try {
            this.trades.add(tradeData);
            this.aggressiveEWMA.push(tradeData.quantity);

            const zone = this.calculateZone(tradeData.price);

            // Copy-on-write: create new bucket instead of mutating
            const currentBucket = this.zoneAgg.get(zone);
            const newBucket = this.createUpdatedBucket(
                currentBucket,
                tradeData
            );

            this.zoneAgg.set(zone, newBucket);

            if (this.features.adaptiveZone) {
                this.adaptiveZoneCalculator.updatePrice(tradeData.price);
            }

            if (tradeData.buyerIsMaker) {
                this.aggrSellEWMA.push(tradeData.quantity);
            } else {
                this.aggrBuyEWMA.push(tradeData.quantity);
            }

            this.checkForSignal(tradeData);
        } catch (error) {
            this.handleError(
                error as Error,
                `${this.constructor.name}.addTrade`
            );
        }
    }

    private createUpdatedBucket(
        currentBucket: { trades: AggressiveTrade[]; vol: number } | undefined,
        newTrade: AggressiveTrade
    ): { trades: AggressiveTrade[]; vol: number } {
        const base = currentBucket ?? { trades: [], vol: 0 };

        // Return new object - never mutate the original
        return {
            trades: [...base.trades, newTrade],
            vol: base.vol + newTrade.quantity,
        };
    }

    protected checkForSignal(triggerTrade: AggressiveTrade): void {
        void triggerTrade;
    }

    public onEnrichedTrade(event: EnrichedTradeEvent): void {
        try {
            const zone = this.calculateZone(event.price);

            // Ensure zone history exists
            this.ensureZoneHistory(zone);

            // Update zone passive history
            this.updateZonePassiveHistory(zone, event);

            // Add trade with deduplication
            if (this.lastTradeId !== event.tradeId) {
                this.lastTradeId = event.tradeId;
                this.addTrade(event);
            }

            // Let subclasses handle specific logic
            this.onEnrichedTradeSpecific(event);
        } catch (error) {
            this.handleError(
                error as Error,
                `${this.constructor.name}.onEnrichedTrade`
            );
        }
    }

    /**
     * Ensure zone history window exists
     */
    protected ensureZoneHistory(zone: number): void {
        if (!this.zonePassiveHistory.has(zone)) {
            this.zonePassiveHistory.set(
                zone,
                new RollingWindow<ZoneSample>(100, false)
            );
        }
    }

    /**
     * Update zone passive history with new snapshot
     */
    protected updateZonePassiveHistory(
        zone: number,
        event: EnrichedTradeEvent
    ): void {
        const zoneHistory = this.zonePassiveHistory.get(zone)!;

        const lastSnapshot =
            zoneHistory.count() > 0 ? zoneHistory.toArray().at(-1)! : null;

        // Use object pool to reduce GC pressure
        const newSnapshot = SharedPools.getInstance().zoneSamples.acquire();
        newSnapshot.bid = event.zonePassiveBidVolume;
        newSnapshot.ask = event.zonePassiveAskVolume;
        newSnapshot.total =
            event.zonePassiveBidVolume + event.zonePassiveAskVolume;
        newSnapshot.timestamp = event.timestamp;

        // Only add if values changed (avoid duplicate snapshots)
        if (
            !lastSnapshot ||
            lastSnapshot.bid !== newSnapshot.bid ||
            lastSnapshot.ask !== newSnapshot.ask
        ) {
            // Use pool-aware push to handle evicted objects
            this.pushToZoneHistoryWithPoolCleanup(zoneHistory, newSnapshot);
        } else {
            // Release snapshot back to pool if not used
            SharedPools.getInstance().zoneSamples.release(newSnapshot);
        }
    }

    /**
     * Pool-aware push to zone history that properly releases evicted objects
     */
    protected pushToZoneHistoryWithPoolCleanup(
        zoneHistory: RollingWindow<ZoneSample>,
        newSample: ZoneSample
    ): void {
        const sharedPools = SharedPools.getInstance();

        // Check if the window is full and will evict an object
        if (zoneHistory.count() >= zoneHistory.size) {
            // Get the sample that will be evicted (oldest one)
            const samples = zoneHistory.toArray();
            if (samples.length > 0) {
                const evictedSample = samples[0]; // Oldest sample
                sharedPools.zoneSamples.release(evictedSample);
            }
        }

        // Now safely push the new sample
        zoneHistory.push(newSample);
    }

    /**
     * Subclass-specific enriched trade handling
     */
    protected abstract onEnrichedTradeSpecific(event: EnrichedTradeEvent): void;

    /**
     * Group trades by price zones
     */
    protected groupTradesByZone(
        trades: AggressiveTrade[],
        zoneTicks: number
    ): Map<number, AggressiveTrade[]> {
        const byPrice = new Map<number, AggressiveTrade[]>();

        // Group by exact price first
        for (const trade of trades) {
            const price = +trade.price.toFixed(this.pricePrecision);
            if (!byPrice.has(price)) {
                byPrice.set(price, []);
            }
            byPrice.get(price)!.push(trade);
        }

        // Then group prices into zones
        const zoneMap = new Map<number, AggressiveTrade[]>();
        const tickSize = Math.pow(10, -this.pricePrecision);
        const zoneSize = zoneTicks * tickSize;

        for (const [price, tradesAtPrice] of byPrice) {
            const zone = +(Math.round(price / zoneSize) * zoneSize).toFixed(
                this.pricePrecision
            );
            if (!zoneMap.has(zone)) {
                zoneMap.set(zone, []);
            }
            zoneMap.get(zone)!.push(...tradesAtPrice);
        }

        return zoneMap;
    }

    /**
     * Calculate zone volumes with common logic
     * Uses object pooling for optimal performance
     */
    protected calculateZoneVolumes(
        zone: number,
        tradesAtZone: AggressiveTrade[],
        zoneTicks: number,
        useMultiZone: boolean = this.features.multiZone ?? false
    ): VolumeCalculationResult {
        if (useMultiZone) {
            // Fix: Ensure minimum band size and use proper calculation
            const bandTicks = Math.max(1, Math.floor(zoneTicks / 2));
            return this.sumVolumesInBand(zone, bandTicks);
        }

        const now = Date.now();
        const sharedPools = SharedPools.getInstance();
        const result = sharedPools.volumeResults.acquire();

        // Calculate aggressive volume
        result.aggressive = tradesAtZone.reduce(
            (sum, t) => sum + t.quantity,
            0
        );

        // Populate trades array (reusing pooled array for efficiency)
        for (const trade of tradesAtZone) {
            result.trades.push(trade.originalTrade);
        }

        // Get passive volume from zone history using pooled array
        const zoneHistory = this.zonePassiveHistory.get(zone);
        if (zoneHistory) {
            const passiveValues = sharedPools.numberArrays.acquire();
            try {
                const snapshots = zoneHistory.toArray();
                for (const snapshot of snapshots) {
                    if (now - snapshot.timestamp < this.windowMs) {
                        passiveValues.push(snapshot.total);
                    }
                }

                result.passive =
                    passiveValues.length > 0
                        ? FinancialMath.calculateMean(passiveValues)
                        : 0;
            } finally {
                sharedPools.numberArrays.release(passiveValues);
            }
        } else {
            result.passive = 0;
        }

        return result;
    }

    /**
     * Generic detection handler
     */
    protected handleDetection(pendingSignal: DetectorResultType): void {
        const detection: SignalCandidate = {
            id: randomUUID(),
            type: this.getSignalType(),
            side: pendingSignal.side,
            confidence: pendingSignal.confidence,
            timestamp: Date.now(),
            data: pendingSignal,
        };

        this.emitSignalCandidate(detection);

        // Emit metrics
        this.metricsCollector.incrementCounter(
            `detector_${this.detectorType}Signals`
        );
    }

    /**
     * Cleanup resources
     */
    public cleanup(): void {
        this.logger.info(`[${this.constructor.name}] Cleanup initiated`);

        // Clear zone cleanup interval
        if (this.zoneCleanupInterval) {
            clearInterval(this.zoneCleanupInterval);
            this.zoneCleanupInterval = null;
        }

        // Force cleanup of caches
        this.depth.forceCleanup();
        this.lastSignal.forceCleanup();

        // Return zone sample objects to pool before clearing
        const sharedPools = SharedPools.getInstance();
        for (const [, window] of this.zonePassiveHistory) {
            const samples = window.toArray();
            for (const sample of samples) {
                sharedPools.zoneSamples.release(sample);
            }
        }

        // Clear zone data
        this.zonePassiveHistory.clear();
        this.zoneAgg.clear();

        // Remove all event listeners to avoid leaks when detector is reused
        this.removeAllListeners();

        this.logger.info(`[${this.constructor.name}] Cleanup completed`);
    }

    protected checkPassiveImbalance(zone: number): ImbalanceResult {
        const zoneHistory = this.zonePassiveHistory.get(zone);
        if (!zoneHistory || zoneHistory.count() === 0) {
            const result = SharedPools.getInstance().imbalanceResults.acquire();
            result.imbalance = 0;
            result.dominantSide = "neutral";
            return result;
        }

        const recent = zoneHistory.toArray().slice(-10);
        const sharedPools = SharedPools.getInstance();

        // Use pooled arrays for calculations
        const bidValues = sharedPools.numberArrays.acquire();
        const askValues = sharedPools.numberArrays.acquire();

        try {
            for (const sample of recent) {
                bidValues.push(sample.bid);
                askValues.push(sample.ask);
            }

            const avgBid = FinancialMath.calculateMean(bidValues);
            const avgAsk = FinancialMath.calculateMean(askValues);

            const total = avgBid + avgAsk;
            const result = sharedPools.imbalanceResults.acquire();

            if (total === 0) {
                result.imbalance = 0;
                result.dominantSide = "neutral";
                return result;
            }

            const imbalance = (avgBid - avgAsk) / total;
            result.imbalance = imbalance;
            result.dominantSide =
                imbalance > 0.2 ? "bid" : imbalance < -0.2 ? "ask" : "neutral";

            return result;
        } finally {
            // Always release pooled arrays
            sharedPools.numberArrays.release(bidValues);
            sharedPools.numberArrays.release(askValues);
        }
    }

    /**
     * Get trade side
     */
    protected getTradeSide(trade: AggressiveTrade): "buy" | "sell" {
        return trade.buyerIsMaker ? "sell" : "buy";
    }

    /**
     * Get effective zone ticks
     */
    protected getEffectiveZoneTicks(): number {
        if (this.features.adaptiveZone) {
            return this.adaptiveZoneCalculator.getAdaptiveZoneTicks(
                this.pricePrecision
            );
        }
        return this.zoneTicks;
    }

    /**
     * Check cooldown
     */
    protected checkCooldown(
        zone: number,
        side: "buy" | "sell",
        update = false
    ): boolean {
        const eventKey = `${zone}_${side}`;
        const now = Date.now();
        const lastSignalTime = this.lastSignal.get(eventKey) || 0;

        if (now - lastSignalTime <= this.eventCooldownMs) {
            return false;
        }

        if (update) {
            this.lastSignal.set(eventKey, now);
        }
        return true;
    }

    /**
     * Mark a signal as confirmed to start cooldown.
     */
    public markSignalConfirmed(zone: number, side: "buy" | "sell"): void {
        const eventKey = `${zone}_${side}`;
        this.lastSignal.set(eventKey, Date.now());
    }

    /**
     * Check if price was spoofed
     */
    protected isSpoofed(
        price: number,
        side: "buy" | "sell",
        timestamp: number
    ): boolean {
        if (
            this.spoofingDetector.wasSpoofed(
                price,
                side,
                timestamp,
                (p, from, to) => this.getAggressiveAtPrice(p, from, to)
            )
        ) {
            return true;
        }
        return false;
    }

    /**
     * Detect layering attack patterns in order flow
     */
    protected detectLayeringAttack(
        price: number,
        side: "buy" | "sell",
        timestamp: number
    ): boolean {
        const windowMs = 10000; // 10 second window
        const tickSize = Math.pow(10, -this.pricePrecision);

        // Check for layering patterns in nearby price levels
        const layerCount = 5; // Check 5 levels each side
        let suspiciousLayers = 0;

        for (let i = 1; i <= layerCount; i++) {
            const layerPrice =
                side === "buy"
                    ? +(price - i * tickSize).toFixed(this.pricePrecision)
                    : +(price + i * tickSize).toFixed(this.pricePrecision);

            // Get recent aggressive volume at this layer
            const recentAggressive = this.getAggressiveVolumeAtPrice(
                layerPrice,
                windowMs
            );

            // Get current passive volume at this layer
            const currentLevel = this.depth.get(layerPrice);
            const currentPassive = currentLevel
                ? side === "buy"
                    ? currentLevel.bid
                    : currentLevel.ask
                : 0;

            // Check for layering pattern: high recent aggressive but little remaining passive
            if (
                recentAggressive > 0 &&
                currentPassive < recentAggressive * 0.1
            ) {
                suspiciousLayers++;
            }
        }

        // Layering detected if multiple layers show this pattern
        const isLayering = suspiciousLayers >= 3;

        if (isLayering) {
            this.logger.warn("Potential layering attack detected", {
                price,
                side,
                suspiciousLayers,
                timestamp,
            });
            this.metricsCollector.incrementMetric("layeringAttackDetected");
        }

        return isLayering;
    }

    /**
     * Check for passive refill
     */
    protected checkRefill(
        price: number,
        side: "buy" | "sell",
        passiveQty: number
    ): boolean {
        if (this.features.passiveHistory) {
            return this.passiveVolumeTracker.hasPassiveRefilled(price, side);
        }
        return this.passiveVolumeTracker.checkRefillStatus(
            price,
            side,
            passiveQty
        );
    }

    /**
     * Sum volumes in band
     */
    protected sumVolumesInBand(
        center: number,
        bandTicks: number
    ): {
        aggressive: number;
        passive: number;
        trades: SpotWebsocketStreams.AggTradeResponse[];
    } {
        // Fix: Use consistent tick size calculation
        const tickSize = Math.pow(10, -this.pricePrecision);
        let aggressive = 0;
        let passive = 0;
        const trades: SpotWebsocketStreams.AggTradeResponse[] = [];
        const now = Date.now();

        for (let offset = -bandTicks; offset <= bandTicks; offset++) {
            const price = +(center + offset * tickSize).toFixed(
                this.pricePrecision
            );

            // Get trades at this specific price level
            const tradesAtPrice = this.trades.filter(
                (t) =>
                    +t.price.toFixed(this.pricePrecision) === price &&
                    now - t.timestamp < this.windowMs
            );

            aggressive += tradesAtPrice.reduce((sum, t) => sum + t.quantity, 0);
            trades.push(...tradesAtPrice.map((t) => t.originalTrade));

            // Get passive volume from order book
            const bookLevel = this.depth.get(price);
            if (bookLevel) {
                passive += bookLevel.bid + bookLevel.ask;
            }

            // Also check zone passive history for this price level
            const priceZone = FinancialMath.calculateZone(
                price,
                this.getEffectiveZoneTicks(),
                this.pricePrecision
            );
            const zoneHistory = this.zonePassiveHistory.get(priceZone);
            if (zoneHistory) {
                const passiveSnapshots = zoneHistory
                    .toArray()
                    .filter((s) => now - s.timestamp < this.windowMs);

                if (passiveSnapshots.length > 0) {
                    const avgPassiveAtPriceZone = FinancialMath.calculateMean(
                        passiveSnapshots.map((s) => s.total)
                    );
                    // Add to passive if we don't have current book data
                    if (
                        !bookLevel ||
                        (bookLevel.bid === 0 && bookLevel.ask === 0)
                    ) {
                        passive += avgPassiveAtPriceZone;
                    }
                }
            }
        }

        return { aggressive, passive, trades };
    }

    /**
     * Get detector status - returns detailed operational information
     */
    public getStatus(): string {
        const stats = this.getStats();
        const isHealthy = this.isDetectorHealthy();

        if (!isHealthy) {
            return `${this.detectorType} detector: UNHEALTHY`;
        }

        // Return detailed status for healthy detectors
        const statusInfo: {
            trades: number;
            zones: number;
            minVol: number;
            health: string;
            zoneTicks?: number;
        } = {
            trades: stats.tradesInBuffer,
            zones: Math.min(this.zonePassiveHistory.size, 99),
            minVol: stats.currentMinVolume,
            health: "OK",
        };

        if (this.features.adaptiveZone && stats.adaptiveZoneTicks) {
            statusInfo.zoneTicks = stats.adaptiveZoneTicks;
        }

        return `${this.detectorType} detector: ${JSON.stringify(statusInfo)}`;
    }

    /**
     * Get detector statistics
     */
    public getStats(): DetectorStats {
        // Calculate actual depth levels from zone passive history
        let totalDepthSamples = 0;
        for (const [zone, window] of this.zonePassiveHistory) {
            totalDepthSamples += window.count();
            void zone;
        }

        const stats: DetectorStats = {
            tradesInBuffer: this.trades.length,
            depthLevels: totalDepthSamples, // ← ONLY CHANGE: Use actual zone data instead of empty cache
            currentMinVolume: this.minAggVolume,
            status: this.isDetectorHealthy() ? "healthy" : "unknown",
        };

        // Keep all your existing adaptive zone logic unchanged
        if (this.features.adaptiveZone) {
            stats.adaptiveZoneTicks =
                this.adaptiveZoneCalculator.getAdaptiveZoneTicks(
                    this.pricePrecision
                );
            stats.rollingATR = this.adaptiveZoneCalculator.getATR();
        }

        return stats;
    }

    /**
     * Check if detector is healthy based on data flow and operational state
     */
    protected isDetectorHealthy(): boolean {
        const now = Date.now();

        // Check if we have recent trades (within last 2 minutes)
        const recentTrades = this.trades.filter(
            (t) => now - t.timestamp < 120000
        );
        if (recentTrades.length === 0) {
            return false; // No recent data
        }

        // Check if we have some depth data
        if (this.zonePassiveHistory.size === 0) {
            return false; // No market depth data
        }

        // Check if we have recent depth updates
        let hasRecentDepth = false;
        for (const [_, window] of this.zonePassiveHistory) {
            void _;
            const recent = window
                .toArray()
                .filter((sample) => now - sample.timestamp < 300000);
            if (recent.length > 0) {
                hasRecentDepth = true;
                break;
            }
        }

        if (!hasRecentDepth) {
            return false; // Stale depth data
        }

        // All checks passed
        return true;
    }

    /**
     * Get aggressive volume at a specific price within a time window
     */
    protected getAggressiveVolumeAtPrice(
        price: number,
        windowMs: number
    ): number {
        const now = Date.now();
        const precision = Math.pow(10, -this.pricePrecision) / 2;
        const filtered = this.trades.filter(
            (t) =>
                now - t.timestamp < windowMs &&
                Math.abs(t.price - price) < precision
        );

        return filtered.reduce((sum, t) => sum + t.quantity, 0);
    }

    protected getAggressiveAtPrice(
        price: number,
        from: number,
        to: number
    ): number {
        const precision = Math.pow(10, -this.pricePrecision) / 2;
        const filtered = this.trades.filter(
            (t) =>
                t.timestamp >= from &&
                t.timestamp < to &&
                Math.abs(t.price - price) < precision
        );

        return filtered.reduce((sum, t) => sum + t.quantity, 0);
    }

    /**
     * Get current spread from recent trades and known depth levels
     */
    protected getCurrentSpread(): {
        spread: number;
        bestBid: number;
        bestAsk: number;
    } | null {
        // Get the most recent trade price as a reference
        const recentTrades = this.trades.getAll();
        if (recentTrades.length === 0) {
            return null;
        }

        const lastPrice = recentTrades[recentTrades.length - 1].price;

        // Simple approach: look for nearby price levels
        let bestBid = 0;
        let bestAsk = Number.MAX_VALUE;

        // Check prices near the last trade
        const checkRange = 100; // Check 100 ticks each direction
        const tickSize = Math.pow(10, -this.pricePrecision);

        for (let i = 0; i <= checkRange; i++) {
            // Check bid side
            const bidPrice = +(lastPrice - i * tickSize).toFixed(
                this.pricePrecision
            );
            const bidLevel = this.depth.get(bidPrice);
            if (bidLevel && bidLevel.bid > 0 && bidPrice > bestBid) {
                bestBid = bidPrice;
            }

            // Check ask side
            const askPrice = +(lastPrice + i * tickSize).toFixed(
                this.pricePrecision
            );
            const askLevel = this.depth.get(askPrice);
            if (askLevel && askLevel.ask > 0 && askPrice < bestAsk) {
                bestAsk = askPrice;
            }

            // Stop if we found both sides close to last trade
            if (
                bestBid > 0 &&
                bestAsk < Number.MAX_VALUE &&
                bestAsk - bestBid < lastPrice * 0.01
            ) {
                break;
            }
        }

        if (bestBid === 0 || bestAsk === Number.MAX_VALUE) {
            return null;
        }

        const spread = (bestAsk - bestBid) / bestBid;

        return { spread, bestBid, bestAsk };
    }

    /**
     * Calculate price zone based on zone ticks
     * Uses standardized calculation method for consistency across all detectors
     */
    protected calculateZone(price: number): number {
        return FinancialMath.calculateZone(
            price,
            this.getEffectiveZoneTicks(),
            this.pricePrecision
        );
    }

    /**
     * Emit a signal candidate when a pattern is detected
     */
    protected emitSignalCandidate(signalCandidate: SignalCandidate): void {
        // Emit for SignalCoordinator to pick up
        this.emit("signalCandidate", signalCandidate);
    }

    /**
     * Emit error event
     */
    protected emitError(error: Error, context?: Record<string, unknown>): void {
        this.logger.error(`Detector error`, {
            component: this.constructor.name,
            detectorId: this.id,
            error: error.message,
            context,
        });

        this.emit("error", error);
    }

    /**
     * Emit status change event
     */
    protected emitStatusChange(newStatus: string, oldStatus?: string): void {
        this.logger.info(`Detector status changed`, {
            component: this.constructor.name,
            detectorId: this.id,
            oldStatus,
            newStatus,
        });

        this.emit("statusChange", newStatus);
    }

    /**
     * Update adaptive thresholds based on performance history
     */
    protected updateAdaptiveThresholds(): void {
        const now = Date.now();
        if (now - this.lastThresholdUpdate < this.updateIntervalMs) {
            return; // Skip update if not enough time has passed
        }

        this.currentThresholds =
            this.adaptiveThresholdCalculator.calculateAdaptiveThresholds(
                this.performanceHistory,
                this.recentSignalCount
            );

        this.lastThresholdUpdate = now;
    }

    /**
     * Record signal performance for adaptive threshold calculation
     */
    protected recordSignalPerformance(
        signalId: string,
        performance: number
    ): void {
        this.performanceHistory.set(signalId, performance);
        this.recentSignalCount++;

        // Clean up old performance history (keep last 100 entries)
        if (this.performanceHistory.size > 100) {
            const entries = Array.from(this.performanceHistory.entries());
            const toDelete = entries.slice(0, entries.length - 100);
            toDelete.forEach(([key]) => this.performanceHistory.delete(key));
        }
    }

    /**
     * Get current adaptive thresholds (readonly access for child detectors)
     */
    protected getAdaptiveThresholds(): Readonly<AdaptiveThresholds> {
        return Object.freeze({ ...this.currentThresholds });
    }

    /**
     * Reset adaptive threshold performance tracking
     */
    protected resetAdaptiveThresholds(): void {
        this.performanceHistory.clear();
        this.recentSignalCount = 0;
        this.lastThresholdUpdate = 0;
        this.currentThresholds =
            this.adaptiveThresholdCalculator.calculateAdaptiveThresholds(
                this.performanceHistory,
                this.recentSignalCount
            );

        this.logger.info(
            `[${this.constructor.name}] Reset adaptive thresholds`,
            { detectorId: this.id }
        );
    }

    /**
     * Abstract method - each detector must implement
     */
    protected abstract getSignalType(): SignalType;
}
