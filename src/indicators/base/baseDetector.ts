// src/indicators/base/baseDetector.ts
import { Detector } from "./detectorEnrichedTrade.js";
import { SpotWebsocketStreams } from "@binance/spot";
import { randomUUID } from "crypto";
import { Logger } from "../../infrastructure/logger.js";
import { MetricsCollector } from "../../infrastructure/metricsCollector.js";
import { ISignalLogger } from "../../services/signalLogger.js";
import { RollingWindow } from "../../utils/rollingWindow.js";
import { DetectorUtils } from "./detectorUtils.js";

import type {
    EnrichedTradeEvent,
    AggressiveTrade,
} from "../../types/marketEvents.js";

import {
    CircularBuffer,
    TimeAwareCache,
    AdaptiveZoneCalculator,
    PassiveVolumeTracker,
    AutoCalibrator,
    PriceConfirmationManager,
    DepthLevel,
} from "../../utils/utils.js";
import {
    SpoofingDetector,
    SpoofingDetectorConfig,
} from "../../services/spoofingDetector.js";
import type {
    IDetector,
    DetectorStats,
    BaseDetectorSettings,
    DetectorFeatures,
    DetectorCallback,
    PendingDetection,
} from "../interfaces/detectorInterfaces.js";

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
    protected readonly trades = new CircularBuffer<AggressiveTrade>(10000);

    // Configuration
    protected readonly windowMs: number;
    protected minAggVolume: number;
    protected readonly pricePrecision: number;
    protected zoneTicks: number;
    protected readonly eventCooldownMs: number;
    protected readonly symbol: string;
    private readonly spoofingSettings: SpoofingDetectorConfig;

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
    protected readonly autoCalibrator: AutoCalibrator;
    protected readonly priceConfirmationManager: PriceConfirmationManager;

    // Dependencies
    protected readonly callback: DetectorCallback;

    // Abstract method for detector type
    protected abstract readonly detectorType: "absorption" | "exhaustion";

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

    constructor(
        callback: DetectorCallback,
        settings: BaseDetectorSettings & { features?: DetectorFeatures },
        logger: Logger,
        metricsCollector: MetricsCollector,
        signalLogger?: ISignalLogger
    ) {
        super(logger, metricsCollector, signalLogger);

        // Validate settings
        this.validateSettings(settings);

        // Initialize configuration
        this.callback = callback;
        this.windowMs = settings.windowMs ?? 90000;
        this.minAggVolume = settings.minAggVolume ?? 600;
        this.pricePrecision = settings.pricePrecision ?? 2;
        this.zoneTicks = settings.zoneTicks ?? 3;
        this.eventCooldownMs = settings.eventCooldownMs ?? 15000;
        this.minInitialMoveTicks = settings.minInitialMoveTicks ?? 10;
        this.confirmationTimeoutMs = settings.confirmationTimeoutMs ?? 60000;
        this.maxRevisitTicks = settings.maxRevisitTicks ?? 5;
        this.symbol = settings.symbol ?? "LTCUSDT";
        this.spoofingSettings = {
            tickSize: 0.01,
            wallTicks: 10,
            minWallSize: 20,
            dynamicWallWidth: false,
            ...settings.spoofing,
        };

        // Initialize features with defaults
        this.features = {
            spoofingDetection: true,
            adaptiveZone: true,
            passiveHistory: true,
            multiZone: true,
            priceResponse: true,
            sideOverride: false,
            autoCalibrate: true,
            ...settings.features,
        };

        // Initialize feature modules
        this.spoofingDetector = new SpoofingDetector(this.spoofingSettings);
        this.adaptiveZoneCalculator = new AdaptiveZoneCalculator();
        this.passiveVolumeTracker = new PassiveVolumeTracker();
        this.autoCalibrator = new AutoCalibrator();
        this.priceConfirmationManager = new PriceConfirmationManager();

        // NEW: initialize rolling window for passive volume, window size based on windowMs (1 sample per second)
        const rollingWindowSize = Math.max(Math.ceil(this.windowMs / 1000), 10);
        this.rollingPassiveVolume = new RollingWindow(rollingWindowSize);

        this.logger.info(`[${this.constructor.name}] Initialized`, {
            features: this.features,
            symbol: this.symbol,
            settings: {
                windowMs: this.windowMs,
                minAggVolume: this.minAggVolume,
                pricePrecision: this.pricePrecision,
            },
        });
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
     */
    protected cleanupOldZoneData(): void {
        const cutoff = Date.now() - this.windowMs * 2;
        let cleanedCount = 0;

        for (const [zone, window] of this.zonePassiveHistory) {
            const lastTimestamp = window.toArray().at(-1)?.timestamp ?? 0;
            if (lastTimestamp < cutoff) {
                this.zonePassiveHistory.delete(zone);
                cleanedCount++;
            }
        }

        if (cleanedCount > 0) {
            this.logger.debug(
                `[${this.constructor.name}] Cleaned ${cleanedCount} old zones`
            );
        }
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
            const zone = this.calculateZone(tradeData.price);
            const bucket = this.zoneAgg.get(zone) ?? { trades: [], vol: 0 };
            bucket.trades.push(tradeData);
            bucket.vol += tradeData.quantity;
            this.zoneAgg.set(zone, bucket);

            if (this.features.adaptiveZone) {
                this.adaptiveZoneCalculator.updatePrice(tradeData.price);
            }

            this.checkForSignal(tradeData);

            if (this.features.priceResponse) {
                this.processConfirmations(tradeData.price);
            }

            if (this.features.autoCalibrate) {
                this.performAutoCalibration();
            }
        } catch (error) {
            this.handleError(
                error as Error,
                `${this.constructor.name}.addTrade`
            );
        }
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
        const newSnapshot: ZoneSample = {
            bid: event.zonePassiveBidVolume,
            ask: event.zonePassiveAskVolume,
            total: event.zonePassiveBidVolume + event.zonePassiveAskVolume,
            timestamp: event.timestamp,
        };

        // Only add if values changed (avoid duplicate snapshots)
        if (
            !lastSnapshot ||
            lastSnapshot.bid !== newSnapshot.bid ||
            lastSnapshot.ask !== newSnapshot.ask
        ) {
            zoneHistory.push(newSnapshot);
        }
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

    /**
     * Generic detection handler
     */
    protected handleDetection(params: {
        zone: number;
        price: number;
        side: "buy" | "sell";
        trades: SpotWebsocketStreams.AggTradeResponse[];
        aggressive: number;
        passive: number;
        refilled: boolean;
        metadata?: Record<string, unknown>;
    }): void {
        const detection: PendingDetection = {
            id: randomUUID(),
            time: Date.now(),
            price: params.price,
            side: params.side,
            zone: params.zone,
            trades: params.trades,
            aggressive: params.aggressive,
            passive: params.passive,
            refilled: params.refilled,
            confirmed: false,
            metadata: params.metadata,
        };

        if (this.features.priceResponse) {
            this.priceConfirmationManager.addPendingDetection(detection);
            this.logger.info(
                `[${this.constructor.name}] Pending ${this.detectorType} at ${params.price}`,
                {
                    zone: params.zone,
                    side: params.side,
                    aggressive: params.aggressive,
                    passive: params.passive,
                }
            );
        } else {
            this.fireDetection(detection);
        }

        if (this.features.autoCalibrate) {
            this.autoCalibrator.recordSignal();
        }

        // Emit metrics
        this.metricsCollector.incrementMetric(
            `detector_${this.detectorType}Signals`
        );
        this.metricsCollector.updateMetric(
            `detector_${this.detectorType}Aggressive_volume`,
            params.aggressive
        );
        this.metricsCollector.updateMetric(
            `detector_${this.detectorType}Passive_volume`,
            params.passive
        );
    }

    /**
     * Fire detection callback
     */
    protected fireDetection(detection: PendingDetection): void {
        this.callback({
            id: detection.id || randomUUID(),
            price: detection.price,
            side: detection.side,
            trades: detection.trades,
            totalAggressiveVolume: detection.aggressive,
            passiveVolume: detection.passive,
            zone: detection.zone,
            refilled: detection.refilled,
            detectedAt: Date.now(),
            detectorSource: this.detectorType,
        });

        this.logger.info(
            `[${this.constructor.name}] Signal fired at ${detection.price}`,
            {
                zone: detection.zone,
                side: detection.side,
                type: this.detectorType,
                aggressive: detection.aggressive,
                passive: detection.passive,
            }
        );

        // Log to signal logger if available
        if (this.signalLogger) {
            this.signalLogger.logEvent({
                symbol: this.symbol,
                type: this.detectorType,
                signalPrice: detection.price,
                side: detection.side,
                aggressiveVolume: detection.aggressive,
                passiveVolume: detection.passive,
                timestamp: detection.time.toString(),
                zone: detection.zone,
                metadata: detection.metadata,
                refilled: detection.refilled,
                confirmed: detection.confirmed,
            });
        }
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

        // Clear zone data
        this.zonePassiveHistory.clear();
        this.zoneAgg.clear();

        this.logger.info(`[${this.constructor.name}] Cleanup completed`);
    }

    /**
     * Add depth update
     * (Now also push rolling passive total into the rolling window, for apples-to-apples comparison)
     */
    public addDepth(update: SpotWebsocketStreams.DiffBookDepthResponse): void {
        try {
            this.updateDepthLevel(
                "bid",
                (update.b as [string, string][]) || []
            );
            this.updateDepthLevel(
                "ask",
                (update.a as [string, string][]) || []
            );

            this.rollingPassiveVolume.push(this.totalPassive);
        } catch (error) {
            this.handleError(
                error as Error,
                `${this.constructor.name}.addDepth`
            );
        }
    }

    /**
     * Update depth levels
     */
    protected updateDepthLevel(
        side: "bid" | "ask",
        updates: [string, string][]
    ): void {
        for (const [priceStr, qtyStr] of updates) {
            const price = parseFloat(priceStr);
            const qty = parseFloat(qtyStr);
            if (isNaN(price) || isNaN(qty)) continue;

            const prev = this.depth.get(price) || { bid: 0, ask: 0 };
            const delta = side === "bid" ? qty - prev.bid : qty - prev.ask;

            // update running sum once
            this.totalPassive += delta;

            // mutate level & cache
            prev[side] = qty;
            if (prev.bid === 0 && prev.ask === 0) {
                this.depth.set(price, { bid: 0, ask: 0 });
            } else {
                this.depth.set(price, prev);
            }

            if (this.features.spoofingDetection)
                this.spoofingDetector.trackPassiveChange(
                    price,
                    prev.bid,
                    prev.ask
                );

            if (this.features.passiveHistory)
                this.passiveVolumeTracker.updatePassiveVolume(
                    price,
                    prev.bid,
                    prev.ask
                );
        }
    }

    protected checkPassiveImbalance(zone: number): {
        imbalance: number;
        dominantSide: "bid" | "ask" | "neutral";
    } {
        const zoneHistory = this.zonePassiveHistory.get(zone);
        if (!zoneHistory || zoneHistory.count() === 0) {
            return { imbalance: 0, dominantSide: "neutral" };
        }

        const recent = zoneHistory.toArray().slice(-10);
        const avgBid = DetectorUtils.calculateMean(recent.map((s) => s.bid));
        const avgAsk = DetectorUtils.calculateMean(recent.map((s) => s.ask));

        const total = avgBid + avgAsk;
        if (total === 0) return { imbalance: 0, dominantSide: "neutral" };

        const imbalance = (avgBid - avgAsk) / total;
        const dominantSide =
            imbalance > 0.2 ? "bid" : imbalance < -0.2 ? "ask" : "neutral";

        return { imbalance, dominantSide };
    }

    /**
     * Get trade side
     */
    protected getTradeSide(trade: AggressiveTrade): "buy" | "sell" {
        if (this.features.sideOverride) {
            this.logger.debug(
                `[${this.constructor.name}] Side override enabled`,
                { originalSide: trade.buyerIsMaker ? "sell" : "buy" }
            );
        }
        // Binance: m=true => buyer is maker, so aggressive sell
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
     * Perform auto calibration
     */
    protected performAutoCalibration(): void {
        if (this.features.autoCalibrate) {
            const newMinVolume = this.autoCalibrator.calibrate(
                this.minAggVolume
            );
            if (newMinVolume !== this.minAggVolume) {
                this.logger.info(
                    `[${this.constructor.name}] Auto-calibrated minAggVolume`,
                    { old: this.minAggVolume, new: newMinVolume }
                );
                this.minAggVolume = newMinVolume;
            }
        }
    }

    /**
     * Process pending confirmations
     */
    protected processConfirmations(currentPrice: number): void {
        const confirmed =
            this.priceConfirmationManager.processPendingConfirmations(
                currentPrice,
                this.pricePrecision,
                this.minInitialMoveTicks,
                this.maxRevisitTicks,
                this.confirmationTimeoutMs,
                this.signalLogger,
                this.symbol,
                this.detectorType
            );

        // Fire callbacks for confirmed detections
        for (const detection of confirmed) {
            this.callback({
                id: detection.id || randomUUID(),
                price: detection.price,
                side: detection.side,
                trades: detection.trades,
                totalAggressiveVolume: detection.aggressive,
                passiveVolume: detection.passive,
                zone: detection.zone,
                refilled: detection.refilled,
                detectedAt: Date.now(),
                detectorSource: this.detectorType,
            });
        }
    }

    /**
     * Check cooldown
     */
    protected checkCooldown(zone: number, side: "buy" | "sell"): boolean {
        const eventKey = `${zone}_${side}`;
        const now = Date.now();
        const lastSignalTime = this.lastSignal.get(eventKey) || 0;

        if (now - lastSignalTime <= this.eventCooldownMs) {
            return false;
        }

        this.lastSignal.set(eventKey, now);
        return true;
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
        const tick = 1 / Math.pow(10, this.pricePrecision);
        let aggressive = 0;
        let passive = 0;
        const trades: SpotWebsocketStreams.AggTradeResponse[] = [];

        for (let offset = -bandTicks; offset <= bandTicks; offset++) {
            const price = +(center + offset * tick).toFixed(
                this.pricePrecision
            );

            const now = Date.now();
            const tradesAtPrice = this.trades.filter(
                (t) =>
                    +t.price.toFixed(this.pricePrecision) === price &&
                    now - t.timestamp <= this.windowMs
            );

            aggressive += tradesAtPrice.reduce((sum, t) => sum + t.quantity, 0);
            trades.push(...tradesAtPrice.map((t) => t.originalTrade));

            const bookLevel = this.depth.get(price);
            if (bookLevel) {
                passive += bookLevel.bid + bookLevel.ask;
            }
        }

        return { aggressive, passive, trades };
    }

    /**
     * Get detector statistics
     */
    public getStats(): DetectorStats {
        const stats: DetectorStats = {
            tradesInBuffer: this.trades.length,
            depthLevels: this.depth.size(),
            pendingConfirmations:
                this.priceConfirmationManager.getPendingCount(),
            currentMinVolume: this.minAggVolume,
        };

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
                now - t.timestamp <= windowMs &&
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
     * Debug current state
     */
    protected debugCurrentState(): void {
        const now = Date.now();
        const recentTrades = this.trades.filter(
            (t) => now - t.timestamp <= 5000
        );
        const totalVolume = recentTrades.reduce(
            (sum, t) => sum + t.quantity,
            0
        );
        const spreadInfo = this.getCurrentSpread();

        this.logger.info(`[${this.constructor.name}] Debug State`, {
            recentTradeCount: recentTrades.length,
            recentVolume: totalVolume.toFixed(2),
            bestBid: spreadInfo?.bestBid.toFixed(this.pricePrecision),
            bestAsk: spreadInfo?.bestAsk.toFixed(this.pricePrecision),
            depthLevels: this.depth.size(),
            spreadPercent: spreadInfo
                ? (spreadInfo.spread * 100).toFixed(3) + "%"
                : "N/A",
        });
    }

    /**
     * Calculate price zone based on zone ticks
     */
    protected calculateZone(price: number): number {
        const zoneTicks = this.getEffectiveZoneTicks();
        const tickSize = Math.pow(10, -this.pricePrecision);
        const zoneSize = zoneTicks * tickSize;

        // Round price to nearest zone
        return +(Math.round(price / zoneSize) * zoneSize).toFixed(
            this.pricePrecision
        );
    }
}
