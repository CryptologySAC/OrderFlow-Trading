import { SpotWebsocketStreams } from "@binance/spot";

export type AbsorptionCallback = (data: {
    price: number;
    side: "buy" | "sell";
    trades: SpotWebsocketStreams.AggTradeResponse[];
    totalAggressiveVolume: number;
    passiveVolume: number;
    refilled: boolean;
    zone: number;
}) => void;

export interface AbsorptionSettings {
    windowMs?: number;
    minAggVolume?: number;
    pricePrecision?: number;
    zoneTicks?: number;
    eventCooldownMs?: number;
    features?: AbsorptionFeatures;
}

export interface AbsorptionFeatures {
    spoofingDetection?: boolean;
    adaptiveZone?: boolean;
    passiveHistory?: boolean;
    multiZone?: boolean;
    priceResponse?: boolean;
    sideOverride?: boolean;
    autoCalibrate?: boolean;
}

export class AbsorptionDetector {
    private depth: Map<number, { bid: number; ask: number }> = new Map();
    private trades: SpotWebsocketStreams.AggTradeResponse[] = [];
    private readonly onAbsorption: AbsorptionCallback;
    private readonly windowMs: number;
    private minAggVolume: number;
    private readonly pricePrecision: number;
    private zoneTicks: number;
    private readonly eventCooldownMs: number;
    private lastSignal: Map<string, number> = new Map();
    private lastSeenPassive: Map<number, { bid: number; ask: number }> =
        new Map();

    // --- Enhanced features state ---
    private readonly features: AbsorptionFeatures;
    private passiveChangeHistory: Map<
        number,
        { time: number; bid: number; ask: number }[]
    > = new Map();
    private priceWindow: number[] = [];
    private rollingATR: number = 0;
    private readonly atrLookback: number = 30;
    private passiveVolumeHistory: Map<
        number,
        { time: number; bid: number; ask: number }[]
    > = new Map();
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
    // For auto-calibration
    private lastCalibrated: number = Date.now();

    constructor(
        callback: AbsorptionCallback,
        {
            windowMs = 90000,
            minAggVolume = 600,
            pricePrecision = 2,
            zoneTicks = 3,
            eventCooldownMs = 15000,
            features = {},
        }: AbsorptionSettings = {}
    ) {
        this.onAbsorption = callback;
        this.windowMs = windowMs;
        this.minAggVolume = minAggVolume;
        this.pricePrecision = pricePrecision;
        this.zoneTicks = zoneTicks;
        this.eventCooldownMs = eventCooldownMs;
        this.features = features;
        console.log("[AbsorptionDetector] Features enabled:", this.features);
    }

    public addTrade(trade: SpotWebsocketStreams.AggTradeResponse) {
        if (trade.T) {
            this.trades.push(trade);
            const now = Date.now();
            this.trades = this.trades.filter(
                (t) => now - (t.T ?? 0) <= this.windowMs
            );

            // --- Enhancement: Track price for adaptive zone ---
            if (this.features.adaptiveZone) {
                this.updateRollingATR(parseFloat(trade.p ?? "0"));
                console.log("[AbsorptionDetector] updateRollingATR called.");
            }

            this.checkAbsorption(trade);

            // --- Enhancement: Price response logic ---
            if (this.features.priceResponse) {
                this.onPrice(parseFloat(trade.p ?? "0"));
                console.log("[AbsorptionDetector] onPrice called.");
            }
        }
    }

    public addDepth(update: SpotWebsocketStreams.DiffBookDepthResponse) {
        const updateLevel = (
            side: "bid" | "ask",
            updates: [string, string][]
        ): void => {
            for (const [priceStr, qtyStr] of updates) {
                const price = parseFloat(priceStr);
                const qty = parseFloat(qtyStr);
                const level = this.depth.get(price) || { bid: 0, ask: 0 };
                level[side] = qty;
                this.depth.set(price, level);

                // --- Enhancement: Passive order history for spoofing ---
                if (this.features.spoofingDetection) {
                    this.trackPassiveOrderbookHistory(
                        price,
                        level.bid,
                        level.ask
                    );
                    console.log(
                        "[AbsorptionDetector] trackPassiveOrderbookHistory called."
                    );
                }
                // --- Enhancement: Passive volume time series ---
                if (this.features.passiveHistory) {
                    this.updatePassiveVolumeHistory(
                        price,
                        level.bid,
                        level.ask
                    );
                    console.log(
                        "[AbsorptionDetector] updatePassiveVolumeHistory called."
                    );
                }
            }
        };

        if (update.b) updateLevel("bid", update.b as [string, string][]);
        if (update.a) updateLevel("ask", update.a as [string, string][]);
    }

    // ----------- ENHANCEMENTS BELOW -----------

    // Spoofing detection - 1
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

    // Adaptive zone/tick size - 2
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

    // Passive volume time series & advanced refill - 3
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

    // Multi-zone (banded) absorption detection - 4
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

    // Price response integration - 5
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
        // Remove expired pendingAbsorptions
        const now = Date.now();
        this.pendingAbsorptions = this.pendingAbsorptions.filter(
            (abs) => now - abs.time < this.windowMs
        );
    }

    // Aggressive side logic validation/config - 6
    private getTradeSide(
        trade: SpotWebsocketStreams.AggTradeResponse
    ): "buy" | "sell" {
        if (this.features.sideOverride) {
            // For demonstration, could use custom logic, e.g., based on external property or config
            // TODO: implement custom side override logic as needed
            console.log(
                "[AbsorptionDetector] Side override is enabled. Using default logic."
            );
        }
        return trade.m ? "sell" : "buy"; // Binance: m=true => maker is sell, so aggressive buy
    }

    // Auto-calibration for main thresholds - 7
    private autoCalibrate() {
        const now = Date.now();
        // Every 15min or on signal burst, auto-calibrate
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

    // ---- MAIN ABSORPTION DETECTION, WITH FEATURE GATES ----
    private checkAbsorption(
        triggerTrade?: SpotWebsocketStreams.AggTradeResponse
    ) {
        // --- (zoneTicks may be adaptive) ---
        const zoneTicks = this.features.adaptiveZone
            ? this.getAdaptiveZoneTicks()
            : this.zoneTicks;

        // --- Map trades by price as before ---
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

        // --- Zone grouping ---
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
            // --- Enhancement: Multi-zone absorption ---
            let aggressiveVolume, passiveVolume, allTrades;
            if (this.features.multiZone) {
                ({
                    totalAggressive: aggressiveVolume,
                    totalPassive: passiveVolume,
                    allTrades,
                } = this.sumVolumesInBand(zone, Math.floor(zoneTicks / 2)));
                console.log("[AbsorptionDetector] sumVolumesInBand called.");
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

            // Use most recent trade for price, side
            const latestTrade = allTrades[allTrades.length - 1];
            const price = +parseFloat(latestTrade.p ?? "0").toFixed(
                this.pricePrecision
            );
            const side = this.getTradeSide(latestTrade);

            const bookLevel = this.depth.get(price);
            if (!bookLevel) continue;

            const passiveQty = side === "buy" ? bookLevel.ask : bookLevel.bid;

            // --- Enhancement: Passive volume refill logic ---
            let refilled = false;
            if (this.features.passiveHistory) {
                refilled = this.hasPassiveRefilled(price, side);
                console.log(
                    "[AbsorptionDetector] hasPassiveRefilled called. Refills:",
                    refilled
                );
            } else {
                const lastLevel = this.lastSeenPassive.get(price);
                if (lastLevel) {
                    const previousQty =
                        side === "buy" ? lastLevel.ask : lastLevel.bid;
                    if (passiveQty >= previousQty * 0.9) {
                        refilled = true;
                    }
                }
                this.lastSeenPassive.set(price, { ...bookLevel });
            }

            // --- Enhancement: Spoofing detection ---
            if (this.features.spoofingDetection && triggerTrade) {
                if (
                    this.wasSpoofed(price, side, triggerTrade.T ?? Date.now())
                ) {
                    console.log(
                        "[AbsorptionDetector] Spoofing detected, absorption ignored at price:",
                        price
                    );
                    continue; // skip this absorption
                }
            }

            // --- Debounce ---
            const eventKey = `${zone}_${side}`;
            const now = Date.now();
            const last = this.lastSignal.get(eventKey) ?? 0;

            if (
                passiveQty > aggressiveVolume * 0.8 &&
                now - last > this.eventCooldownMs
            ) {
                this.lastSignal.set(eventKey, now);

                // --- Enhancement: Price response confirmation ---
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

        // --- Enhancement: Auto-calibration ---
        if (this.features.autoCalibrate) {
            this.autoCalibrate();
        }
    }
}
