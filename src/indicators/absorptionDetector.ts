import { SpotWebsocketStreams } from "@binance/spot";
import { ISignalLogger } from "../services/signalLogger.js";
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
    PendingDetection,
} from "../utils/utils.js";

export type AbsorptionCallback = (data: {
    price: number;
    side: "buy" | "sell";
    trades: SpotWebsocketStreams.AggTradeResponse[];
    totalAggressiveVolume: number;
    passiveVolume: number;
    refilled: boolean;
    zone: number;
}) => void;

/**
 * Configuration options for AbsorptionDetector.
 *
 * Controls windows, thresholds, and advanced feature flags.
 * All fields are optional; reasonable defaults provided.
 *
 * @property windowMs           Rolling time window in milliseconds for trade aggregation.
 * @property minAggVolume       Minimum total aggressive volume for absorption detection.
 * @property pricePrecision     Price decimal places for tick/zone rounding.
 * @property zoneTicks          Tick width for absorption price bands.
 * @property eventCooldownMs    Debounce period between signals at the same zone/side.
 * @property minInitialMoveTicks Number of ticks price must move in expected direction to confirm.
 * @property confirmationTimeoutMs Max time (ms) allowed to confirm a signal.
 * @property maxRevisitTicks    Max allowed retest distance (in ticks) for invalidation.
 * @property features           Object with feature flags (see AbsorptionFeatures).
 */
export interface AbsorptionSettings {
    windowMs?: number;
    minAggVolume?: number;
    pricePrecision?: number;
    zoneTicks?: number;
    eventCooldownMs?: number;
    features?: AbsorptionFeatures;
    minInitialMoveTicks?: number;
    confirmationTimeoutMs?: number;
    maxRevisitTicks?: number;
    symbol?: string;
}

/**
 * Feature flags to enable/disable advanced absorption detection logic.
 *
 * @property spoofingDetection   Enables spoofing detection logic.
 * @property adaptiveZone        Enables adaptive ATR-based zone sizing.
 * @property passiveHistory      Tracks passive volume changes over time.
 * @property multiZone           Sums volume and passive liquidity across a price band.
 * @property priceResponse       Enables price move confirmation before signaling.
 * @property sideOverride        Enables advanced side-detection logic (for research).
 * @property autoCalibrate       Enables automatic threshold adjustment.
 */
export interface AbsorptionFeatures {
    spoofingDetection?: boolean;
    adaptiveZone?: boolean;
    passiveHistory?: boolean;
    multiZone?: boolean;
    priceResponse?: boolean;
    sideOverride?: boolean;
    autoCalibrate?: boolean;
}

/**
 * AbsorptionDetector detects and confirms orderflow absorption events
 * using Binance Spot WebSocket trades and orderbook depth.
 *
 * Features:
 * - Spoofing detection (filters fake walls)
 * - Adaptive zone sizing (ATR-based)
 * - Multi-zone (banded) logic
 * - Passive volume tracking and refill logic
 * - Auto-calibration of thresholds
 * - Price response confirmation/invalidation
 * - Structured event logging via SignalLogger
 *
 * Designed for high-precision intraday signal detection and research.
 *
 * @param onAbsorption Callback executed when a confirmed absorption event is detected.
 * @param settings Object containing configuration parameters (windows, thresholds, features, etc).
 * @param logger Optional SignalLogger instance for CSV/JSON event logging.
 *
 * @see AbsorptionSettings for parameter options.
 */
export class AbsorptionDetector {
    // Core data storage - now using efficient data structures
    private depth = new TimeAwareCache<number, DepthLevel>(300000); // 5 minutes TTL
    private trades = new CircularBuffer<TradeData>(10000); // Circular buffer for trades

    // Core configuration
    private readonly onAbsorption: AbsorptionCallback;
    private readonly windowMs: number;
    private minAggVolume: number;
    private readonly pricePrecision: number;
    private zoneTicks: number;
    private readonly eventCooldownMs: number;
    private readonly symbol: string;

    // Cooldown tracking
    private lastSignal = new TimeAwareCache<string, number>(900000); // 15 minutes TTL

    // Feature modules
    private readonly features: AbsorptionFeatures;
    private readonly spoofingDetector: SpoofingDetector;
    private readonly adaptiveZoneCalculator: AdaptiveZoneCalculator;
    private readonly passiveVolumeTracker: PassiveVolumeTracker;
    private readonly autoCalibrator: AutoCalibrator;
    private readonly priceConfirmationManager: PriceConfirmationManager;

    // Price response confirmation settings
    private readonly minInitialMoveTicks: number;
    private readonly confirmationTimeoutMs: number;
    private readonly maxRevisitTicks: number;
    private readonly logger?: ISignalLogger;

    constructor(
        callback: AbsorptionCallback,
        {
            windowMs = 90000,
            minAggVolume = 600,
            pricePrecision = 2,
            zoneTicks = 3,
            eventCooldownMs = 15000,
            minInitialMoveTicks = 10,
            confirmationTimeoutMs = 60000,
            maxRevisitTicks = 5,
            features = {},
            symbol = "LTCUSDT",
        }: AbsorptionSettings = {},
        logger?: ISignalLogger
    ) {
        // Validate settings
        this.validateSettings({
            windowMs,
            minAggVolume,
            pricePrecision,
            zoneTicks,
            eventCooldownMs,
            minInitialMoveTicks,
            confirmationTimeoutMs,
            maxRevisitTicks,
            features,
            symbol,
        });

        this.onAbsorption = callback;
        this.windowMs = windowMs;
        this.minAggVolume = minAggVolume;
        this.pricePrecision = pricePrecision;
        this.zoneTicks = zoneTicks;
        this.eventCooldownMs = eventCooldownMs;
        this.minInitialMoveTicks = minInitialMoveTicks;
        this.confirmationTimeoutMs = confirmationTimeoutMs;
        this.maxRevisitTicks = maxRevisitTicks;
        this.features = features;
        this.symbol = symbol;
        this.logger = logger;

        // Initialize feature modules
        this.spoofingDetector = new SpoofingDetector();
        this.adaptiveZoneCalculator = new AdaptiveZoneCalculator();
        this.passiveVolumeTracker = new PassiveVolumeTracker();
        this.autoCalibrator = new AutoCalibrator();
        this.priceConfirmationManager = new PriceConfirmationManager();

        console.log(
            "[AbsorptionDetector] Initialized with features:",
            this.features
        );
        console.log("[AbsorptionDetector] Symbol:", this.symbol);
    }

    private validateSettings(settings: AbsorptionSettings): void {
        if (settings.windowMs && settings.windowMs < 1000) {
            throw new Error("windowMs must be at least 1000ms");
        }
        if (settings.minAggVolume && settings.minAggVolume <= 0) {
            throw new Error("minAggVolume must be positive");
        }
        if (
            settings.pricePrecision &&
            (settings.pricePrecision < 0 || settings.pricePrecision > 8)
        ) {
            throw new Error("pricePrecision must be between 0 and 8");
        }
        if (settings.zoneTicks && settings.zoneTicks <= 0) {
            throw new Error("zoneTicks must be positive");
        }
        if (settings.eventCooldownMs && settings.eventCooldownMs < 0) {
            throw new Error("eventCooldownMs must be non-negative");
        }
    }

    /**
     * Adds a new trade (aggTrade) from Binance Spot to the absorption detector.
     *
     * Should be called for every incoming trade. Aggregates aggressive volume and
     * manages absorption and spoofing detection. Triggers absorption checks and, if
     * enabled, initiates price response confirmation.
     *
     * @param trade Binance Spot AggTradeResponse object.
     *
     * @example
     * detector.addTrade({
     *   e: "aggTrade",
     *   p: "95.00",
     *   q: "50.00",
     *   m: true,
     *   T: 1748281037000,
     *   // ...
     * });
     */
    public addTrade(trade: SpotWebsocketStreams.AggTradeResponse): void {
        if (!trade.T || !trade.p || !trade.q) {
            console.warn("[AbsorptionDetector] Invalid trade data received");
            return;
        }

        try {
            const tradeData: TradeData = {
                price: parseFloat(trade.p),
                quantity: parseFloat(trade.q),
                timestamp: trade.T,
                isMakerSell: trade.m || false,
                originalTrade: trade,
            };

            this.trades.add(tradeData);

            if (this.features.adaptiveZone) {
                this.adaptiveZoneCalculator.updatePrice(tradeData.price);
            }

            this.checkAbsorption(tradeData);

            if (this.features.priceResponse) {
                this.processConfirmations(tradeData.price);
            }

            if (this.features.autoCalibrate) {
                this.performAutoCalibration();
            }
        } catch (error) {
            console.error(
                "[AbsorptionDetector] Error processing trade:",
                error
            );
        }
    }

    /**
     * Adds a new order book depth (diffBookDepth) update to the absorption detector.
     *
     * This method should be called for every incoming Binance Spot diffBookDepth stream message.
     * Updates the passive (bid/ask) levels tracked internally, enabling real-time
     * absorption, spoofing, and refill logic. Supports all feature flags, including
     * spoofing detection and passive volume history.
     *
     * @param update Binance Spot DiffBookDepthResponse object.
     *   Should include price/quantity pairs for bids (`b`) and/or asks (`a`).
     *
     * @remarks
     * - Keeps internal orderbook in sync with the live Binance feed for accurate
     *   absorption detection and event timing.
     * - If enabled, also tracks time-series of passive volume for refill and spoofing features.
     *
     * @example
     * detector.addDepth({
     *   b: [["95.00", "100.00"]],
     *   a: [["95.10", "50.00"]],
     *   // ...other fields
     * });
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
            console.error(
                "[AbsorptionDetector] Error processing depth update:",
                error
            );
        }
    }

    private updateDepthLevel(
        side: "bid" | "ask",
        updates: [string, string][]
    ): void {
        for (const [priceStr, qtyStr] of updates) {
            const price = parseFloat(priceStr);
            const qty = parseFloat(qtyStr);

            if (isNaN(price) || isNaN(qty)) {
                console.warn(
                    "[AbsorptionDetector] Invalid depth data:",
                    priceStr,
                    qtyStr
                );
                continue;
            }

            const level = this.depth.get(price) || { bid: 0, ask: 0 };
            level[side] = qty;

            // Remove level if both sides are zero
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

    private getTradeSide(trade: TradeData): "buy" | "sell" {
        if (this.features.sideOverride) {
            // Custom logic can be added here for research purposes
            console.log(
                "[AbsorptionDetector] Side override is enabled. Using default logic."
            );
        }
        return trade.isMakerSell ? "buy" : "sell"; // Binance: m=true => maker is sell, so aggressive buy
    }

    private performAutoCalibration(): void {
        if (this.features.autoCalibrate) {
            const newMinVolume = this.autoCalibrator.calibrate(
                this.minAggVolume
            );
            if (newMinVolume !== this.minAggVolume) {
                this.minAggVolume = newMinVolume;
            }
        }
    }

    private processConfirmations(currentPrice: number): void {
        const confirmedAbsorptions =
            this.priceConfirmationManager.processPendingConfirmations(
                currentPrice,
                this.pricePrecision,
                this.minInitialMoveTicks,
                this.maxRevisitTicks,
                this.confirmationTimeoutMs,
                this.logger,
                this.symbol,
                "absorption"
            );

        // Fire callbacks for confirmed absorptions
        for (const absorption of confirmedAbsorptions) {
            this.onAbsorption({
                price: absorption.price,
                side: absorption.side,
                trades: absorption.trades,
                totalAggressiveVolume: absorption.aggressive,
                passiveVolume: absorption.passive,
                refilled: absorption.refilled,
                zone: absorption.zone,
            });
        }
    }

    private getEffectiveZoneTicks(): number {
        if (this.features.adaptiveZone) {
            return this.adaptiveZoneCalculator.getAdaptiveZoneTicks(
                this.pricePrecision
            );
        }
        return this.zoneTicks;
    }

    private sumVolumesInBand(
        center: number,
        bandTicks: number
    ): {
        totalAggressive: number;
        totalPassive: number;
        allTrades: SpotWebsocketStreams.AggTradeResponse[];
    } {
        const tick = 1 / Math.pow(10, this.pricePrecision);
        let totalAggressive = 0;
        let totalPassive = 0;
        const allTrades: SpotWebsocketStreams.AggTradeResponse[] = [];

        for (let offset = -bandTicks; offset <= bandTicks; offset++) {
            const price = +(center + offset * tick).toFixed(
                this.pricePrecision
            );

            // Get trades at this price within the time window
            const now = Date.now();
            const tradesAtPrice = this.trades.filter(
                (t) =>
                    +t.price.toFixed(this.pricePrecision) === price &&
                    now - t.timestamp <= this.windowMs
            );

            totalAggressive += tradesAtPrice.reduce(
                (sum, t) => sum + t.quantity,
                0
            );
            allTrades.push(...tradesAtPrice.map((t) => t.originalTrade));

            const bookLevel = this.depth.get(price);
            if (bookLevel) {
                totalPassive += bookLevel.bid + bookLevel.ask;
            }
        }

        return { totalAggressive, totalPassive, allTrades };
    }

    /**
     * Runs the absorption detection algorithm on the current trade window.
     *
     * Called internally on each new trade to group and scan for high-probability
     * absorption clusters by price zone. If a candidate is detected, logs as
     * pending and (if enabled) starts price response confirmation logic.
     *
     * @param triggerTrade The trade that triggered this check. Used for price reference
     *                     and advanced spoofing/side detection.
     *
     * @remarks
     * Usually called automatically from addTrade; not for public use.
     */
    private checkAbsorption(triggerTrade: TradeData): void {
        const zoneTicks = this.getEffectiveZoneTicks();
        const now = Date.now();

        // Get trades within the time window
        const recentTrades = this.trades.filter(
            (t) => now - t.timestamp <= this.windowMs
        );

        if (recentTrades.length === 0) return;

        // Group trades by price
        const byPrice = new Map<number, TradeData[]>();
        for (const trade of recentTrades) {
            const price = +trade.price.toFixed(this.pricePrecision);
            if (!byPrice.has(price)) {
                byPrice.set(price, []);
            }
            byPrice.get(price)!.push(trade);
        }

        // Group by zones
        const zoneMap = new Map<number, TradeData[]>();
        for (const [price, tradesAtPrice] of byPrice) {
            const zone = +(Math.round(price / zoneTicks) * zoneTicks).toFixed(
                this.pricePrecision
            );
            if (!zoneMap.has(zone)) {
                zoneMap.set(zone, []);
            }
            zoneMap.get(zone)!.push(...tradesAtPrice);
        }

        // Analyze each zone for absorption
        for (const [zone, tradesAtZone] of zoneMap.entries()) {
            this.analyzeZoneForAbsorption(
                zone,
                tradesAtZone,
                triggerTrade,
                zoneTicks
            );
        }
    }

    private analyzeZoneForAbsorption(
        zone: number,
        tradesAtZone: TradeData[],
        triggerTrade: TradeData,
        zoneTicks: number
    ): void {
        let aggressiveVolume: number;
        let passiveVolume: number;
        let allTrades: SpotWebsocketStreams.AggTradeResponse[];

        if (this.features.multiZone) {
            const bandResult = this.sumVolumesInBand(
                zone,
                Math.floor(zoneTicks / 2)
            );
            aggressiveVolume = bandResult.totalAggressive;
            passiveVolume = bandResult.totalPassive;
            allTrades = bandResult.allTrades;
        } else {
            aggressiveVolume = tradesAtZone.reduce(
                (sum, t) => sum + t.quantity,
                0
            );
            allTrades = tradesAtZone.map((t) => t.originalTrade);

            const latestTrade = tradesAtZone[tradesAtZone.length - 1];
            const price = +latestTrade.price.toFixed(this.pricePrecision);
            const bookLevel = this.depth.get(price);
            passiveVolume = bookLevel ? bookLevel.bid + bookLevel.ask : 0;
        }

        if (aggressiveVolume < this.minAggVolume) return;

        const latestTrade = tradesAtZone[tradesAtZone.length - 1];
        const price = +latestTrade.price.toFixed(this.pricePrecision);
        const side = this.getTradeSide(latestTrade);

        const bookLevel = this.depth.get(price);
        if (!bookLevel) return;

        const passiveQty = side === "buy" ? bookLevel.ask : bookLevel.bid;

        // Check for spoofing
        if (this.features.spoofingDetection) {
            if (
                this.spoofingDetector.wasSpoofed(
                    price,
                    side,
                    triggerTrade.timestamp
                )
            ) {
                console.log(
                    "[AbsorptionDetector] Spoofing detected, absorption ignored at price:",
                    price
                );
                return;
            }
        }

        // Check passive volume refill
        let refilled = false;
        if (this.features.passiveHistory) {
            refilled = this.passiveVolumeTracker.hasPassiveRefilled(
                price,
                side
            );
        } else {
            refilled = this.passiveVolumeTracker.checkRefillStatus(
                price,
                side,
                passiveQty
            );
        }

        // Check cooldown
        const eventKey = `${zone}_${side}`;
        const now = Date.now();
        const lastSignalTime = this.lastSignal.get(eventKey) || 0;

        if (
            passiveQty > aggressiveVolume * 0.8 &&
            now - lastSignalTime > this.eventCooldownMs
        ) {
            this.lastSignal.set(eventKey, now);

            const absorption: PendingDetection = {
                time: now,
                price,
                side,
                zone,
                trades: allTrades,
                aggressive: aggressiveVolume,
                passive: passiveVolume,
                refilled,
                confirmed: false,
            };

            if (this.features.priceResponse) {
                this.priceConfirmationManager.addPendingDetection(absorption);
                console.log(
                    "[AbsorptionDetector] Pending absorption added for price response at",
                    price
                );
            } else {
                // Fire immediately if price response is disabled
                this.onAbsorption({
                    price: absorption.price,
                    side: absorption.side,
                    trades: absorption.trades,
                    totalAggressiveVolume: absorption.aggressive,
                    passiveVolume: absorption.passive,
                    refilled: absorption.refilled,
                    zone: absorption.zone,
                });
                console.log(
                    "[AbsorptionDetector] Absorption event fired immediately at",
                    price
                );
            }

            if (this.features.autoCalibrate) {
                this.autoCalibrator.recordSignal();
            }
        }
    }

    /**
     * Get current detector statistics for monitoring and debugging.
     */
    public getStats(): {
        tradesInBuffer: number;
        depthLevels: number;
        pendingConfirmations: number;
        currentMinVolume: number;
        adaptiveZoneTicks?: number;
        rollingATR?: number;
    } {
        const stats = {
            tradesInBuffer: this.trades.length,
            depthLevels: this.depth.size(),
            pendingConfirmations:
                this.priceConfirmationManager.getPendingCount(),
            currentMinVolume: this.minAggVolume,
        };

        if (this.features.adaptiveZone) {
            return {
                ...stats,
                adaptiveZoneTicks:
                    this.adaptiveZoneCalculator.getAdaptiveZoneTicks(
                        this.pricePrecision
                    ),
                rollingATR: this.adaptiveZoneCalculator.getATR(),
            };
        }

        return stats;
    }

    /**
     * Manually trigger cleanup of old data (normally happens automatically).
     * Useful for testing or explicit memory management.
     */
    public cleanup(): void {
        // The TimeAwareCache instances handle their own cleanup automatically
        // This method is provided for explicit cleanup if needed
        console.log("[AbsorptionDetector] Manual cleanup triggered");
    }
}
