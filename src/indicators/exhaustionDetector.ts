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

/**
 * Callback executed on confirmed exhaustion event.
 */
export type ExhaustionCallback = (data: {
    price: number;
    side: "buy" | "sell";
    trades: SpotWebsocketStreams.AggTradeResponse[];
    totalAggressiveVolume: number;
    zone: number;
    refilled: boolean;
}) => void;

/**
 * Configuration options for ExhaustionDetector.
 *
 * @property windowMs           Rolling time window in milliseconds for trade aggregation.
 * @property minAggVolume       Minimum total aggressive volume for exhaustion detection.
 * @property pricePrecision     Price decimal places for tick/zone rounding.
 * @property zoneTicks          Tick width for exhaustion price bands.
 * @property eventCooldownMs    Debounce period between signals at the same zone/side.
 * @property minInitialMoveTicks Number of ticks price must move in expected direction to confirm.
 * @property confirmationTimeoutMs Max time (ms) allowed to confirm a signal.
 * @property maxRevisitTicks    Max allowed retest distance (in ticks) for invalidation.
 * @property features           Object with feature flags (see ExhaustionFeatures).
 * @property symbol             The instrument symbol for logging/analytics.
 */
export interface ExhaustionSettings {
    windowMs?: number;
    minAggVolume?: number;
    pricePrecision?: number;
    zoneTicks?: number;
    eventCooldownMs?: number;
    features?: ExhaustionFeatures;
    minInitialMoveTicks?: number;
    confirmationTimeoutMs?: number;
    maxRevisitTicks?: number;
    symbol?: string;
}

/**
 * Feature flags to enable/disable advanced exhaustion detection logic.
 */
export interface ExhaustionFeatures {
    spoofingDetection?: boolean;
    adaptiveZone?: boolean;
    passiveHistory?: boolean;
    multiZone?: boolean;
    priceResponse?: boolean;
    sideOverride?: boolean;
    autoCalibrate?: boolean;
}

/**
 * Modular, production-ready exhaustion event detector using orderflow.
 * Reuses all advanced features and data management patterns from AbsorptionDetector.
 *
 * @param onExhaustion Callback executed on confirmed exhaustion event.
 * @param settings Configuration options (windows, thresholds, feature flags, etc).
 * @param logger Optional SignalLogger for CSV/JSON event logging.
 */
export class ExhaustionDetector {
    // Data storage
    private depth = new TimeAwareCache<number, DepthLevel>(300000); // 5 min TTL
    private trades = new CircularBuffer<TradeData>(10000); // Bounded trades window

    // Core configuration
    private readonly onExhaustion: ExhaustionCallback;
    private readonly windowMs: number;
    private minAggVolume: number;
    private readonly pricePrecision: number;
    private zoneTicks: number;
    private readonly eventCooldownMs: number;
    private readonly symbol: string;

    // Cooldown tracking
    private lastSignal = new TimeAwareCache<string, number>(900000); // 15 min TTL

    // Feature modules (shared with AbsorptionDetector)
    private readonly features: ExhaustionFeatures;
    private readonly spoofingDetector: SpoofingDetector;
    private readonly adaptiveZoneCalculator: AdaptiveZoneCalculator;
    private readonly passiveVolumeTracker: PassiveVolumeTracker;
    private readonly autoCalibrator: AutoCalibrator;
    private readonly priceConfirmationManager: PriceConfirmationManager;

    // Confirmation parameters
    private readonly minInitialMoveTicks: number;
    private readonly confirmationTimeoutMs: number;
    private readonly maxRevisitTicks: number;
    private readonly logger?: ISignalLogger;

    constructor(
        callback: ExhaustionCallback,
        {
            windowMs = 90000,
            minAggVolume = 600,
            pricePrecision = 2,
            zoneTicks = 3,
            eventCooldownMs = 15000,
            minInitialMoveTicks = 12,
            confirmationTimeoutMs = 60000,
            maxRevisitTicks = 5,
            features = {
                spoofingDetection: true,
                adaptiveZone: true,
                passiveHistory: true,
                multiZone: true,
                priceResponse: true,
                sideOverride: true,
                autoCalibrate: true,
            },
            symbol = "LTCUSDT",
        }: ExhaustionSettings = {},
        logger?: ISignalLogger
    ) {
        this.onExhaustion = callback;
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

        // Feature modules (shared with absorption)
        this.spoofingDetector = new SpoofingDetector();
        this.adaptiveZoneCalculator = new AdaptiveZoneCalculator();
        this.passiveVolumeTracker = new PassiveVolumeTracker();
        this.autoCalibrator = new AutoCalibrator();
        this.priceConfirmationManager = new PriceConfirmationManager();

        console.log(
            "[ExhaustionDetector] Initialized with features:",
            this.features
        );
        console.log("[ExhaustionDetector] Symbol:", this.symbol);
    }

    /**
     * Adds a new trade to the exhaustion detector.
     * @param trade Binance Spot AggTradeResponse object.
     */
    public addTrade(trade: SpotWebsocketStreams.AggTradeResponse): void {
        if (!trade.T || !trade.p || !trade.q) {
            console.warn("[ExhaustionDetector] Invalid trade data received");
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
            this.checkExhaustion(tradeData);

            if (this.features.priceResponse) {
                this.processConfirmations(tradeData.price);
            }

            if (this.features.autoCalibrate) {
                this.performAutoCalibration();
            }
        } catch (error) {
            console.error(
                "[ExhaustionDetector] Error processing trade:",
                error
            );
        }
    }

    /**
     * Adds a new order book depth update to the exhaustion detector.
     * @param update Binance Spot DiffBookDepthResponse.
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
                "[ExhaustionDetector] Error processing depth update:",
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
                    "[ExhaustionDetector] Invalid depth data:",
                    priceStr,
                    qtyStr
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

    private getTradeSide(trade: TradeData): "buy" | "sell" {
        if (this.features.sideOverride) {
            // Custom logic can be added here for research purposes
            console.log(
                "[ExhaustionDetector] Side override is enabled. Using default logic."
            );
        }
        return trade.isMakerSell ? "sell" : "buy";
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
        const confirmedExhaustions =
            this.priceConfirmationManager.processPendingConfirmations(
                currentPrice,
                this.pricePrecision,
                this.minInitialMoveTicks,
                this.maxRevisitTicks,
                this.confirmationTimeoutMs,
                this.logger,
                this.symbol,
                "exhaustion" // Pass the event type
            );
        // Fire callbacks for confirmed exhaustions
        for (const exhaustion of confirmedExhaustions) {
            this.onExhaustion({
                price: exhaustion.price,
                side: exhaustion.side,
                trades: exhaustion.trades,
                totalAggressiveVolume: exhaustion.aggressive,
                zone: exhaustion.zone,
                refilled: exhaustion.refilled,
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

    /**
     * Runs the exhaustion detection logic on the current trade window.
     * Called on every new trade to aggregate and scan for exhaustion clusters.
     */
    private checkExhaustion(triggerTrade: TradeData): void {
        const zoneTicks = this.getEffectiveZoneTicks();
        const now = Date.now();
        const recentTrades = this.trades.filter(
            (t) => now - t.timestamp <= this.windowMs
        );
        if (recentTrades.length === 0) return;

        // Group trades by price
        const byPrice = new Map<number, TradeData[]>();
        for (const trade of recentTrades) {
            const price = +trade.price.toFixed(this.pricePrecision);
            if (!byPrice.has(price)) byPrice.set(price, []);
            byPrice.get(price)!.push(trade);
        }

        // Group by zones
        const zoneMap = new Map<number, TradeData[]>();
        for (const [price, tradesAtPrice] of byPrice) {
            const zone = +(Math.round(price / zoneTicks) * zoneTicks).toFixed(
                this.pricePrecision
            );
            if (!zoneMap.has(zone)) zoneMap.set(zone, []);
            zoneMap.get(zone)!.push(...tradesAtPrice);
        }

        // Analyze each zone for exhaustion
        for (const [zone, tradesAtZone] of zoneMap.entries()) {
            this.analyzeZoneForExhaustion(
                zone,
                tradesAtZone,
                triggerTrade,
                zoneTicks
            );
        }
    }

    private analyzeZoneForExhaustion(
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

        // Exhaustion: opposite liquidity is zero (or near zero)
        const oppositeQty = side === "buy" ? bookLevel.ask : bookLevel.bid;

        // Passive refill detection
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
                oppositeQty
            );
        }

        // Spoofing detection
        if (this.features.spoofingDetection) {
            if (
                this.spoofingDetector.wasSpoofed(
                    price,
                    side,
                    triggerTrade.timestamp
                )
            ) {
                console.log(
                    "[ExhaustionDetector] Spoofing detected, exhaustion ignored at price:",
                    price
                );
                return;
            }
        }

        // Cooldown
        const eventKey = `${zone}_${side}`;
        const now = Date.now();
        const lastSignalTime = this.lastSignal.get(eventKey) || 0;

        if (
            (oppositeQty === 0 || oppositeQty < aggressiveVolume * 0.05) &&
            now - lastSignalTime > this.eventCooldownMs &&
            !refilled
        ) {
            this.lastSignal.set(eventKey, now);

            const exhaustion: PendingDetection = {
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
                this.priceConfirmationManager.addPendingDetection(exhaustion);
                console.log(
                    "[ExhaustionDetector] Pending exhaustion added for price response at",
                    price
                );
            } else {
                // Fire immediately if price response is disabled
                this.onExhaustion({
                    price: exhaustion.price,
                    side: exhaustion.side,
                    trades: exhaustion.trades,
                    totalAggressiveVolume: exhaustion.aggressive,
                    zone: exhaustion.zone,
                    refilled: exhaustion.refilled,
                });
                console.log(
                    "[ExhaustionDetector] Exhaustion event fired immediately at",
                    price
                );
            }
            if (this.features.autoCalibrate) {
                this.autoCalibrator.recordSignal();
            }
        }
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
     * Returns detector stats for monitoring and debugging.
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
     * Manual cleanup of old data (not usually required).
     */
    public cleanup(): void {
        // All caches and buffers auto-cleanup, but can force here if desired
        console.log("[ExhaustionDetector] Manual cleanup triggered");
    }
}
