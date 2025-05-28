// src/indicators/base/baseDetector.ts

import { SpotWebsocketStreams } from "@binance/spot";
import { randomUUID } from "crypto";
import { Logger } from "../../infrastructure/logger.js";
import { MetricsCollector } from "../../infrastructure/metricsCollector.js";
import { ISignalLogger } from "../../services/signalLogger.js";
import {
    CircularBuffer,
    TimeAwareCache,
    SpoofingDetector,
    AdaptiveZoneCalculator,
    PassiveVolumeTracker,
    AutoCalibrator,
    PriceConfirmationManager,
    TradeData,
    DepthLevel,
} from "../../utils/utils.js";
import type {
    IDetector,
    DetectorStats,
    BaseDetectorSettings,
    DetectorFeatures,
    DetectorCallback,
} from "../interfaces/detectorInterfaces.js";

/**
 * Abstract base class for orderflow detectors
 */
export abstract class BaseDetector implements IDetector {
    // Data storage
    protected readonly depth = new TimeAwareCache<number, DepthLevel>(300000);
    protected readonly trades = new CircularBuffer<TradeData>(10000);

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
    protected readonly autoCalibrator: AutoCalibrator;
    protected readonly priceConfirmationManager: PriceConfirmationManager;

    // Dependencies
    protected readonly logger: Logger;
    protected readonly metricsCollector: MetricsCollector;
    protected readonly signalLogger?: ISignalLogger;
    protected readonly callback: DetectorCallback;

    // Abstract method for detector type
    protected abstract readonly detectorType: "absorption" | "exhaustion";

    constructor(
        callback: DetectorCallback,
        settings: BaseDetectorSettings & { features?: DetectorFeatures },
        logger: Logger,
        metricsCollector: MetricsCollector,
        signalLogger?: ISignalLogger
    ) {
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

        // Initialize dependencies
        this.logger = logger;
        this.metricsCollector = metricsCollector;
        this.signalLogger = signalLogger;

        // Initialize feature modules
        this.spoofingDetector = new SpoofingDetector();
        this.adaptiveZoneCalculator = new AdaptiveZoneCalculator();
        this.passiveVolumeTracker = new PassiveVolumeTracker();
        this.autoCalibrator = new AutoCalibrator();
        this.priceConfirmationManager = new PriceConfirmationManager();

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
    public addTrade(trade: SpotWebsocketStreams.AggTradeResponse): void {
        if (!this.isValidTrade(trade)) {
            this.logger.warn(
                `[${this.constructor.name}] Invalid trade data received`
            );
            return;
        }

        try {
            const tradeData = this.normalizeTradeData(trade);
            this.trades.add(tradeData);

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

    /**
     * Add depth update
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
        } catch (error) {
            this.handleError(
                error as Error,
                `${this.constructor.name}.addDepth`
            );
        }
    }

    /**
     * Check if trade data is valid
     */
    protected isValidTrade(
        trade: SpotWebsocketStreams.AggTradeResponse
    ): boolean {
        return !!(trade.T && trade.p && trade.q);
    }

    /**
     * Normalize trade data
     */
    protected normalizeTradeData(
        trade: SpotWebsocketStreams.AggTradeResponse
    ): TradeData {
        return {
            price: parseFloat(trade.p!),
            quantity: parseFloat(trade.q!),
            timestamp: trade.T!,
            isMakerSell: trade.m || false,
            originalTrade: trade,
        };
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

            if (isNaN(price) || isNaN(qty)) {
                this.logger.warn(
                    `[${this.constructor.name}] Invalid depth data`,
                    { price: priceStr, quantity: qtyStr }
                );
                continue;
            }

            const level = this.depth.get(price) || { bid: 0, ask: 0 };
            level[side] = qty;

            if (level.bid === 0 && level.ask === 0) {
                this.depth.delete(price);
            } else {
                this.depth.set(price, level);
            }

            if (this.features.spoofingDetection) {
                this.spoofingDetector.trackPassiveChange(
                    price,
                    level.bid,
                    level.ask
                );
            }

            if (this.features.passiveHistory) {
                this.passiveVolumeTracker.updatePassiveVolume(
                    price,
                    level.bid,
                    level.ask
                );
            }
        }
    }

    /**
     * Get trade side
     */
    protected getTradeSide(trade: TradeData): "buy" | "sell" {
        if (this.features.sideOverride) {
            this.logger.debug(
                `[${this.constructor.name}] Side override enabled`,
                { originalSide: trade.isMakerSell ? "sell" : "buy" }
            );
        }
        // Binance: m=true => maker is sell, so aggressive buy
        return trade.isMakerSell ? "buy" : "sell";
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
     * Sum volumes in band
     */
    protected sumVolumesInBand(
        center: number,
        bandTicks: number
    ): {
        aggressive: number; // Changed from totalAggressive
        passive: number; // Changed from totalPassive
        trades: SpotWebsocketStreams.AggTradeResponse[]; // Changed from allTrades
    } {
        const tick = 1 / Math.pow(10, this.pricePrecision);
        let aggressive = 0; // Changed from totalAggressive
        let passive = 0; // Changed from totalPassive
        const trades: SpotWebsocketStreams.AggTradeResponse[] = []; // Changed from allTrades

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
     * Handle errors
     */
    protected handleError(
        error: Error,
        context: string,
        correlationId?: string
    ): void {
        this.metricsCollector.incrementMetric("errorsCount");

        const errorContext = {
            context,
            errorName: error.name,
            errorMessage: error.message,
            stack: error.stack,
            timestamp: new Date().toISOString(),
            correlationId: correlationId || randomUUID(),
        };

        this.logger.error(
            `[${context}] ${error.message}`,
            errorContext,
            correlationId
        );
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
     * Cleanup resources
     */
    public cleanup(): void {
        this.logger.info(`[${this.constructor.name}] Manual cleanup triggered`);
        // Caches handle their own cleanup, but we can force it if needed
        this.depth.forceCleanup();
        this.lastSignal.forceCleanup();
    }

    /**
     * Abstract method - must be implemented by subclasses
     */
    protected abstract checkForSignal(triggerTrade: TradeData): void;

    // src/indicators/base/baseDetector.ts
    // Add these methods to the BaseDetector class:

    /**
     * Get aggressive volume at a specific price within a time window
     */
    protected getAggressiveVolumeAtPrice(
        price: number,
        windowMs: number
    ): number {
        const now = Date.now();
        const priceStr = price.toFixed(this.pricePrecision);

        return this.trades
            .filter(
                (t) =>
                    now - t.timestamp <= windowMs &&
                    t.price.toFixed(this.pricePrecision) === priceStr
            )
            .reduce((sum, t) => sum + t.quantity, 0);
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
}
