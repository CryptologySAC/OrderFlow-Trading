import { SpotWebsocketStreams } from "@binance/spot";

export type ExhaustionCallback = (data: {
    price: number;
    side: "buy" | "sell";
    trades: SpotWebsocketStreams.AggTradeResponse[];
    totalAggressiveVolume: number;
}) => void;

export class ExhaustionDetector {
    private depth: Map<number, { bid: number; ask: number }> = new Map();
    private trades: SpotWebsocketStreams.AggTradeResponse[] = [];
    private readonly onExhaustion: ExhaustionCallback;
    private readonly windowMs = 5000;
    private readonly minAggVolume = 10000;
    private readonly pricePrecision = 2;

    constructor(callback: ExhaustionCallback) {
        this.onExhaustion = callback;
    }

    public addTrade(trade: SpotWebsocketStreams.AggTradeResponse) {
        if (trade.T) {
            this.trades.push(trade);
            const now = Date.now();
            this.trades = this.trades.filter(
                (t) => now - (t.T ?? 0) <= this.windowMs
            );
            this.checkExhaustion();
        }
    }

    public addDepth(update: SpotWebsocketStreams.DiffBookDepthResponse) {
        const updateLevel = (
            type: "bid" | "ask",
            updates: [string, string][]
        ) => {
            for (const [priceStr, qtyStr] of updates) {
                const price = parseFloat(priceStr);
                const qty = parseFloat(qtyStr);
                const level = this.depth.get(price) || { bid: 0, ask: 0 };
                if (type === "bid") level.bid = qty;
                else level.ask = qty;
                this.depth.set(price, level);
            }
        };

        if (update.b) updateLevel("bid", update.b as [string, string][]);
        if (update.a) updateLevel("ask", update.a as [string, string][]);
    }

    private checkExhaustion() {
        const byPrice = new Map<
            number,
            SpotWebsocketStreams.AggTradeResponse[]
        >();

        for (const trade of this.trades) {
            const price = parseFloat(trade.p ?? "0");
            const priceKey = +price.toFixed(this.pricePrecision);
            if (!byPrice.has(priceKey)) byPrice.set(priceKey, []);
            byPrice.get(priceKey)!.push(trade);
        }

        for (const [price, tradesAtPrice] of byPrice.entries()) {
            const aggressiveVolume = tradesAtPrice.reduce(
                (sum, t) => sum + parseFloat(t.q ?? "0"),
                0
            );
            if (aggressiveVolume < this.minAggVolume) continue;

            const bookLevel = this.depth.get(price);
            if (!bookLevel) continue;

            const side = tradesAtPrice[0].m ? "buy" : "sell";
            const oppositeQty = side === "buy" ? bookLevel.ask : bookLevel.bid;

            // If there's no more passive liquidity on the opposite side
            if (oppositeQty === 0) {
                console.log("Exhaustion Detected");
                this.onExhaustion({
                    price,
                    side,
                    trades: tradesAtPrice,
                    totalAggressiveVolume: aggressiveVolume,
                });
            }
        }
    }
}
