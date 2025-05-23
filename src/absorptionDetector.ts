import { SpotWebsocketStreams } from "@binance/spot";

export type AbsorptionCallback = (data: {
    price: number;
    side: "buy" | "sell";
    trades: SpotWebsocketStreams.AggTradeResponse[];
    totalAggressiveVolume: number;
    passiveVolume: number;
    refilled: boolean;
}) => void;

export class AbsorptionDetector {
    private depth: Map<number, { bid: number; ask: number }> = new Map();
    private trades: SpotWebsocketStreams.AggTradeResponse[] = [];
    private readonly onAbsorption: AbsorptionCallback;
    private readonly windowMs = 5000;
    private readonly minAggVolume = 10000;
    private readonly pricePrecision = 2;
    private lastSeenPassive: Map<number, { bid: number; ask: number }> =
        new Map();

    constructor(callback: AbsorptionCallback) {
        this.onAbsorption = callback;
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
        const byPrice = new Map<
            number,
            SpotWebsocketStreams.AggTradeResponse[]
        >();

        for (const trade of this.trades) {
            const priceStr = trade.p ?? "0";
            const price = +parseFloat(priceStr).toFixed(this.pricePrecision);
            if (!byPrice.has(price)) byPrice.set(price, []);
            byPrice.get(price)!.push(trade);
        }

        for (const [price, tradesAtPrice] of byPrice.entries()) {
            const aggressiveVolume = tradesAtPrice.reduce((sum, t) => {
                const qty =
                    typeof t.q === "string" ? parseFloat(t.q) : (t.q ?? 0);
                return sum + qty;
            }, 0);
            if (aggressiveVolume < this.minAggVolume) continue;

            const bookLevel = this.depth.get(price);
            if (!bookLevel) continue;

            const side = tradesAtPrice[0].m ? "buy" : "sell";
            const passiveQty = side === "buy" ? bookLevel.ask : bookLevel.bid;

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

            if (passiveQty > aggressiveVolume * 0.8) {
                console.log("Absorption Detected");
                this.onAbsorption({
                    price,
                    side,
                    trades: tradesAtPrice,
                    totalAggressiveVolume: aggressiveVolume,
                    passiveVolume: passiveQty,
                    refilled,
                });
            }
        }
    }
}
