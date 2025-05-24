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
}

export class AbsorptionDetector {
    private depth: Map<number, { bid: number; ask: number }> = new Map();
    private trades: SpotWebsocketStreams.AggTradeResponse[] = [];
    private readonly onAbsorption: AbsorptionCallback;
    private readonly windowMs: number;
    private readonly minAggVolume: number;
    private readonly pricePrecision: number;
    private readonly zoneTicks: number;
    private readonly eventCooldownMs: number;
    private lastSignal: Map<string, number> = new Map();
    private lastSeenPassive: Map<number, { bid: number; ask: number }> =
        new Map();

    constructor(
        callback: AbsorptionCallback,
        {
            windowMs = 90000,
            minAggVolume = 600,
            pricePrecision = 2,
            zoneTicks = 3,
            eventCooldownMs = 15000, // 15s default
        }: AbsorptionSettings = {}
    ) {
        this.onAbsorption = callback;
        this.windowMs = windowMs;
        this.minAggVolume = minAggVolume;
        this.pricePrecision = pricePrecision;
        this.zoneTicks = zoneTicks;
        this.eventCooldownMs = eventCooldownMs;
    }

    public addTrade(trade: SpotWebsocketStreams.AggTradeResponse) {
        if (trade.T) {
            this.trades.push(trade);
            const now = Date.now();
            this.trades = this.trades.filter(
                (t) => now - (t.T ?? 0) <= this.windowMs
            );
            this.checkAbsorption();
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
            }
        };

        if (update.b) updateLevel("bid", update.b as [string, string][]);
        if (update.a) updateLevel("ask", update.a as [string, string][]);
    }

    private checkAbsorption() {
        // Map of trades grouped by price
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

        // Group prices into zones
        const zoneMap = new Map<
            number,
            SpotWebsocketStreams.AggTradeResponse[]
        >();
        for (const [price, tradesAtPrice] of byPrice) {
            // Zone: round to nearest multiple of zoneTicks
            const zone = +(
                Math.round(price / this.zoneTicks) * this.zoneTicks
            ).toFixed(this.pricePrecision);
            if (!zoneMap.has(zone)) zoneMap.set(zone, []);
            zoneMap.get(zone)!.push(...tradesAtPrice);
        }

        for (const [zone, tradesAtZone] of zoneMap.entries()) {
            const aggressiveVolume = tradesAtZone.reduce((sum, t) => {
                const qty =
                    typeof t.q === "string" ? parseFloat(t.q) : (t.q ?? 0);
                return sum + qty;
            }, 0);
            if (aggressiveVolume < this.minAggVolume) continue;

            // Use most recent trade for price, side
            const latestTrade = tradesAtZone[tradesAtZone.length - 1];
            const price = +parseFloat(latestTrade.p ?? "0").toFixed(
                this.pricePrecision
            );
            const bookLevel = this.depth.get(price);
            if (!bookLevel) continue;

            const side = latestTrade.m ? "sell" : "buy"; // Binance: m=true = buyer is the maker (so sell trade)
            const passiveQty = side === "buy" ? bookLevel.ask : bookLevel.bid;

            // Book refill logic
            const lastLevel = this.lastSeenPassive.get(price);
            let refilled = false;
            if (lastLevel) {
                const previousQty =
                    side === "buy" ? lastLevel.ask : lastLevel.bid;
                if (passiveQty >= previousQty * 0.9) {
                    refilled = true;
                }
            }
            this.lastSeenPassive.set(price, { ...bookLevel });

            // Signal debounce
            const eventKey = `${zone}_${side}`;
            const now = Date.now();
            const last = this.lastSignal.get(eventKey) ?? 0;
            if (
                passiveQty > aggressiveVolume * 0.8 &&
                now - last > this.eventCooldownMs
            ) {
                this.lastSignal.set(eventKey, now);
                this.onAbsorption({
                    price,
                    side,
                    trades: tradesAtZone,
                    totalAggressiveVolume: aggressiveVolume,
                    passiveVolume: passiveQty,
                    refilled,
                    zone,
                });
            }
        }
    }
}
