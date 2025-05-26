import { SpotWebsocketStreams } from "@binance/spot";
import { SignalLogger } from "./signalLogger.js";

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
    private depth = new Map<number, { bid: number; ask: number }>();
    private trades: SpotWebsocketStreams.AggTradeResponse[] = [];
    private readonly onAbsorption: AbsorptionCallback;
    private readonly windowMs: number;
    private minAggVolume: number;
    private readonly pricePrecision: number;
    private zoneTicks: number;
    private readonly eventCooldownMs: number;
    private lastSignal = new Map<string, number>();
    private lastSeenPassive = new Map<number, { bid: number; ask: number }>();

    private readonly features: AbsorptionFeatures;
    private passiveChangeHistory = new Map<
        number,
        { time: number; bid: number; ask: number }[]
    >();
    private priceWindow: number[] = [];
    private rollingATR = 0;
    private readonly atrLookback = 30;
    private passiveVolumeHistory = new Map<
        number,
        { time: number; bid: number; ask: number }[]
    >();
    private pendingAbsorptions: {
        time: number;
        price: number;
        side: "buy" | "sell";
        zone: number;
        trades: SpotWebsocketStreams.AggTradeResponse[];
        aggressive: number;
        passive: number;
        refilled: boolean;
        confirmed: boolean;
    }[] = [];
    private lastCalibrated: number = Date.now();

    private readonly minInitialMoveTicks: number;
    private readonly confirmationTimeoutMs: number;
    private readonly maxRevisitTicks: number;
    private readonly logger?: SignalLogger;

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
        }: AbsorptionSettings = {},
        logger?: SignalLogger
    ) {
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
        this.logger = logger;
        console.log("[AbsorptionDetector] Features enabled:", this.features);
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
    public addTrade(trade: SpotWebsocketStreams.AggTradeResponse) {
        if (!trade.T) return;
        this.trades.push(trade);
        const now = Date.now();
        this.trades = this.trades.filter(
            (t) => now - (t.T ?? 0) <= this.windowMs
        );

        if (this.features.adaptiveZone) {
            this.updateRollingATR(parseFloat(trade.p ?? "0"));
        }
        this.checkAbsorption(trade);

        if (this.features.priceResponse) {
            this.onPrice(parseFloat(trade.p ?? "0"));
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
    public addDepth(update: SpotWebsocketStreams.DiffBookDepthResponse) {
        const updateLevel = (
            side: "bid" | "ask",
            updates: [string, string][]
        ) => {
            for (const [priceStr, qtyStr] of updates) {
                const price = parseFloat(priceStr);
                const qty = parseFloat(qtyStr);
                const level = this.depth.get(price) || { bid: 0, ask: 0 };
                level[side] = qty;
                this.depth.set(price, level);

                if (this.features.spoofingDetection) {
                    this.trackPassiveOrderbookHistory(
                        price,
                        level.bid,
                        level.ask
                    );
                }
                if (this.features.passiveHistory) {
                    this.updatePassiveVolumeHistory(
                        price,
                        level.bid,
                        level.ask
                    );
                }
            }
        };
        if (update.b) updateLevel("bid", update.b as [string, string][]);
        if (update.a) updateLevel("ask", update.a as [string, string][]);
    }

    // Spoofing detection
    private trackPassiveOrderbookHistory(
        price: number,
        newBid: number,
        newAsk: number
    ) {
        const now = Date.now();
        if (!this.passiveChangeHistory.has(price))
            this.passiveChangeHistory.set(price, []);
        const history = this.passiveChangeHistory.get(price)!;
        history.push({ time: now, bid: newBid, ask: newAsk });
        if (history.length > 10) history.shift();
    }

    private wasSpoofed(
        price: number,
        side: "buy" | "sell",
        tradeTime: number
    ): boolean {
        const hist = this.passiveChangeHistory.get(price);
        if (!hist || hist.length < 2) return false;
        for (let i = hist.length - 2; i >= 0; i--) {
            const curr = hist[i + 1],
                prev = hist[i];
            if (curr.time > tradeTime) continue;
            const delta =
                side === "buy" ? prev.ask - curr.ask : prev.bid - curr.bid;
            const base = side === "buy" ? prev.ask : prev.bid;
            if (
                base > 0 &&
                delta / base > 0.6 &&
                curr.time - prev.time < 1200
            ) {
                console.log(
                    "[AbsorptionDetector] Spoofing detected at price:",
                    price
                );
                return true;
            }
            if (curr.time < tradeTime - 2000) break;
        }
        return false;
    }

    // Adaptive zone/tick size
    private updateRollingATR(price: number) {
        this.priceWindow.push(price);
        if (this.priceWindow.length > this.atrLookback)
            this.priceWindow.shift();
        if (this.priceWindow.length > 2) {
            let sum = 0;
            for (let i = 1; i < this.priceWindow.length; i++) {
                sum += Math.abs(this.priceWindow[i] - this.priceWindow[i - 1]);
            }
            this.rollingATR = sum / (this.priceWindow.length - 1);
        }
    }

    private getAdaptiveZoneTicks(): number {
        const tick = 1 / Math.pow(10, this.pricePrecision);
        return Math.max(
            1,
            Math.min(10, Math.round((this.rollingATR / tick) * 2))
        );
    }

    // Passive volume time series & advanced refill
    private updatePassiveVolumeHistory(
        price: number,
        bid: number,
        ask: number
    ) {
        if (!this.passiveVolumeHistory.has(price))
            this.passiveVolumeHistory.set(price, []);
        const arr = this.passiveVolumeHistory.get(price)!;
        arr.push({ time: Date.now(), bid, ask });
        if (arr.length > 30) arr.shift();
    }

    private hasPassiveRefilled(
        price: number,
        side: "buy" | "sell",
        windowMs = 15000
    ): boolean {
        const arr = this.passiveVolumeHistory.get(price);
        if (!arr || arr.length < 3) return false;
        let refills = 0;
        let prev = side === "buy" ? arr[0].ask : arr[0].bid;
        for (const snap of arr) {
            const qty = side === "buy" ? snap.ask : snap.bid;
            if (qty > prev * 1.15) refills++;
            prev = qty;
        }
        const now = Date.now();
        return refills >= 3 && now - arr[0].time < windowMs;
    }

    // Multi-zone (banded) absorption detection
    private sumVolumesInBand(center: number, bandTicks: number) {
        const tick = 1 / Math.pow(10, this.pricePrecision);
        let totalAggressive = 0,
            totalPassive = 0;
        let allTrades: SpotWebsocketStreams.AggTradeResponse[] = [];
        for (let offset = -bandTicks; offset <= bandTicks; offset++) {
            const price = +(center + offset * tick).toFixed(
                this.pricePrecision
            );
            const tradesAtPrice = this.trades.filter(
                (t) =>
                    +parseFloat(t.p ?? "0").toFixed(this.pricePrecision) ===
                    price
            );
            totalAggressive += tradesAtPrice.reduce(
                (sum, t) => sum + parseFloat(t.q as string),
                0
            );
            allTrades.push(...tradesAtPrice);
            const bookLevel = this.depth.get(price);
            if (bookLevel) totalPassive += bookLevel.bid + bookLevel.ask;
        }
        return { totalAggressive, totalPassive, allTrades };
    }

    // Price response integration
    private onPrice(price: number) {
        const tick = 1 / Math.pow(10, this.pricePrecision);
        this.pendingAbsorptions.forEach((abs) => {
            if (abs.confirmed) return;
            if (
                (abs.side === "buy" && price <= abs.price - tick * 2) ||
                (abs.side === "sell" && price >= abs.price + tick * 2)
            ) {
                abs.confirmed = true;
                console.log(
                    "[AbsorptionDetector] Price response: confirmed absorption at",
                    abs.price
                );
                this.onAbsorption({
                    price: abs.price,
                    side: abs.side,
                    trades: abs.trades,
                    totalAggressiveVolume: abs.aggressive,
                    passiveVolume: abs.passive,
                    refilled: abs.refilled,
                    zone: abs.zone,
                });
            }
        });
        const now = Date.now();
        this.pendingAbsorptions = this.pendingAbsorptions.filter(
            (abs) => now - abs.time < this.windowMs
        );
    }

    private getTradeSide(
        trade: SpotWebsocketStreams.AggTradeResponse
    ): "buy" | "sell" {
        if (this.features.sideOverride) {
            // Custom logic can be added here.
            console.log(
                "[AbsorptionDetector] Side override is enabled. Using default logic."
            );
        }
        return trade.m ? "sell" : "buy"; // Binance: m=true => maker is sell, so aggressive buy
    }

    private autoCalibrate() {
        const now = Date.now();
        if (now - this.lastCalibrated < 15 * 60 * 1000) return;
        this.lastCalibrated = now;
        const signals = Array.from(this.lastSignal.values()).filter(
            (t) => now - t < 30 * 60 * 1000
        );
        if (signals.length > 10) {
            this.minAggVolume = Math.round(this.minAggVolume * 1.2);
            console.log(
                "[AbsorptionDetector] AutoCalibrate: Too many absorptions, raising minAggVolume to",
                this.minAggVolume
            );
        } else if (signals.length < 2) {
            this.minAggVolume = Math.max(
                1,
                Math.round(this.minAggVolume * 0.85)
            );
            console.log(
                "[AbsorptionDetector] AutoCalibrate: Too few absorptions, lowering minAggVolume to",
                this.minAggVolume
            );
        }
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
    private checkAbsorption(
        triggerTrade: SpotWebsocketStreams.AggTradeResponse
    ) {
        const zoneTicks = this.features.adaptiveZone
            ? this.getAdaptiveZoneTicks()
            : this.zoneTicks;

        const byPrice = new Map<
            number,
            SpotWebsocketStreams.AggTradeResponse[]
        >();
        for (const trade of this.trades) {
            const price = +parseFloat(trade.p ?? "0").toFixed(
                this.pricePrecision
            );
            if (!byPrice.has(price)) byPrice.set(price, []);
            byPrice.get(price)!.push(trade);
        }

        const zoneMap = new Map<
            number,
            SpotWebsocketStreams.AggTradeResponse[]
        >();
        for (const [price, tradesAtPrice] of byPrice) {
            const zone = +(Math.round(price / zoneTicks) * zoneTicks).toFixed(
                this.pricePrecision
            );
            if (!zoneMap.has(zone)) zoneMap.set(zone, []);
            zoneMap.get(zone)!.push(...tradesAtPrice);
        }

        for (const [zone, tradesAtZone] of zoneMap.entries()) {
            let aggressiveVolume, passiveVolume, allTrades;
            if (this.features.multiZone) {
                ({
                    totalAggressive: aggressiveVolume,
                    totalPassive: passiveVolume,
                    allTrades,
                } = this.sumVolumesInBand(zone, Math.floor(zoneTicks / 2)));
            } else {
                aggressiveVolume = tradesAtZone.reduce((sum, t) => {
                    const qty =
                        typeof t.q === "string" ? parseFloat(t.q) : (t.q ?? 0);
                    return sum + qty;
                }, 0);
                allTrades = tradesAtZone;
                const latestTrade = tradesAtZone[tradesAtZone.length - 1];
                const price = +parseFloat(latestTrade.p ?? "0").toFixed(
                    this.pricePrecision
                );
                const bookLevel = this.depth.get(price);
                passiveVolume = bookLevel ? bookLevel.bid + bookLevel.ask : 0;
            }
            if (aggressiveVolume < this.minAggVolume) continue;

            const latestTrade = allTrades[allTrades.length - 1];
            const price = +parseFloat(latestTrade.p ?? "0").toFixed(
                this.pricePrecision
            );
            const side = this.getTradeSide(latestTrade);

            const bookLevel = this.depth.get(price);
            if (!bookLevel) continue;

            const passiveQty = side === "buy" ? bookLevel.ask : bookLevel.bid;

            // Passive volume refill logic
            let refilled = false;
            if (this.features.passiveHistory) {
                refilled = this.hasPassiveRefilled(price, side);
            } else {
                const lastLevel = this.lastSeenPassive.get(price);
                if (lastLevel) {
                    const previousQty =
                        side === "buy" ? lastLevel.ask : lastLevel.bid;
                    if (passiveQty >= previousQty * 0.9) refilled = true;
                }
                this.lastSeenPassive.set(price, { ...bookLevel });
            }

            // Spoofing detection
            if (this.features.spoofingDetection && triggerTrade) {
                if (
                    this.wasSpoofed(price, side, triggerTrade.T ?? Date.now())
                ) {
                    console.log(
                        "[AbsorptionDetector] Spoofing detected, absorption ignored at price:",
                        price
                    );
                    continue;
                }
            }

            const eventKey = `${zone}_${side}`;
            const now = Date.now();
            const last = this.lastSignal.get(eventKey) ?? 0;

            if (
                passiveQty > aggressiveVolume * 0.8 &&
                now - last > this.eventCooldownMs
            ) {
                this.lastSignal.set(eventKey, now);

                if (this.features.priceResponse) {
                    this.pendingAbsorptions.push({
                        time: now,
                        price,
                        side,
                        zone,
                        trades: allTrades,
                        aggressive: aggressiveVolume,
                        passive: passiveVolume,
                        refilled,
                        confirmed: false,
                    });
                    console.log(
                        "[AbsorptionDetector] Pending absorption added for price response."
                    );
                } else {
                    this.onAbsorption({
                        price,
                        side,
                        trades: allTrades,
                        totalAggressiveVolume: aggressiveVolume,
                        passiveVolume: passiveVolume,
                        refilled,
                        zone,
                    });
                    console.log("[AbsorptionDetector] Absorption event fired.");
                }
            }
        }

        // Confirm or invalidate pending absorptions
        this.processPendingConfirmations(parseFloat(triggerTrade.p ?? "0"));

        if (this.features.autoCalibrate) {
            this.autoCalibrate();
        }
    }

    /**
     * Confirms or invalidates all pending absorption signals based on
     * price movement and configured thresholds.
     *
     * Called after every new trade (and optionally after depth changes).
     * If price moves the required number of ticks (minInitialMoveTicks)
     * in the expected direction within the allowed time, confirms the signal;
     * otherwise invalidates on timeout or snap-back.
     *
     * @param currentPrice The most recent price (from trade or orderbook).
     *
     * @remarks
     * Internal method; not for direct use outside the detector.
     */
    private processPendingConfirmations(currentPrice: number) {
        const tick = 1 / Math.pow(10, this.pricePrecision);
        const now = Date.now();

        this.pendingAbsorptions.forEach((abs) => {
            if (abs.confirmed) return;

            const moveTicks = Math.abs(currentPrice - abs.price) / tick;

            if (
                (abs.side === "buy" &&
                    currentPrice >=
                        abs.price + this.minInitialMoveTicks * tick) ||
                (abs.side === "sell" &&
                    currentPrice <= abs.price - this.minInitialMoveTicks * tick)
            ) {
                abs.confirmed = true;
                if (this.logger) {
                    this.logger.logEvent({
                        timestamp: new Date(now).toISOString(),
                        type: "absorption",
                        symbol: "LTCUSDT",
                        signalPrice: abs.price,
                        side: abs.side,
                        aggressiveVolume: abs.aggressive,
                        passiveVolume: abs.passive,
                        zone: abs.zone,
                        refilled: abs.refilled,
                        confirmed: true,
                        confirmationTime: new Date(now).toISOString(),
                        moveSizeTicks: moveTicks,
                        moveTimeMs: now - abs.time,
                        entryRecommended: true,
                    });
                }
                this.onAbsorption({
                    price: abs.price,
                    side: abs.side,
                    trades: abs.trades,
                    totalAggressiveVolume: abs.aggressive,
                    passiveVolume: abs.passive,
                    refilled: abs.refilled,
                    zone: abs.zone,
                });
                console.log(
                    "[AbsorptionDetector] Absorption confirmed by price response."
                );
                return;
            }

            if (
                (abs.side === "buy" &&
                    currentPrice <= abs.price - this.maxRevisitTicks * tick) ||
                (abs.side === "sell" &&
                    currentPrice >= abs.price + this.maxRevisitTicks * tick)
            ) {
                abs.confirmed = false;
                if (this.logger) {
                    this.logger.logEvent({
                        timestamp: new Date(now).toISOString(),
                        type: "absorption",
                        symbol: "LTCUSDT",
                        signalPrice: abs.price,
                        side: abs.side,
                        aggressiveVolume: abs.aggressive,
                        passiveVolume: abs.passive,
                        zone: abs.zone,
                        refilled: abs.refilled,
                        confirmed: false,
                        invalidationTime: new Date(now).toISOString(),
                        invalidationReason: "Price revisited absorption level",
                        outcome: "fail",
                    });
                }
                console.log(
                    "[AbsorptionDetector] Absorption invalidated by price revisit."
                );
                return;
            }

            if (now - abs.time > this.confirmationTimeoutMs) {
                abs.confirmed = false;
                if (this.logger) {
                    this.logger.logEvent({
                        timestamp: new Date(now).toISOString(),
                        type: "absorption",
                        symbol: "LTCUSDT",
                        signalPrice: abs.price,
                        side: abs.side,
                        aggressiveVolume: abs.aggressive,
                        passiveVolume: abs.passive,
                        zone: abs.zone,
                        refilled: abs.refilled,
                        confirmed: false,
                        invalidationTime: new Date(now).toISOString(),
                        invalidationReason: "Timeout (no move)",
                        outcome: "fail",
                    });
                }
                console.log(
                    "[AbsorptionDetector] Absorption invalidated by timeout."
                );
                return;
            }
        });

        // Remove processed absorptions
        this.pendingAbsorptions = this.pendingAbsorptions.filter(
            (abs) =>
                !abs.confirmed && now - abs.time < this.confirmationTimeoutMs
        );
    }
}
