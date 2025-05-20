import { SpotWebsocketAPI, SpotWebsocketStreams } from "@binance/spot";

export class OrderBook {
    private lastUpdateId: number;
    private bids: string[][];
    private asks: string[][];

    constructor(orderBook: SpotWebsocketAPI.DepthResponseResult) {
        this.lastUpdateId = orderBook.lastUpdateId ?? 0;
        this.bids = orderBook.bids ?? [];
        this.asks = orderBook.asks ?? [];
    }

    public updateOrderBook(
        update: SpotWebsocketStreams.DiffBookDepthResponse
    ): void {
        const latestUpdateId = update.u ?? 0;
        if (latestUpdateId <= this.lastUpdateId) {
            return; // Ignore updates that are not newer
        }

        // Update bids and asks
        if (update.b && update.b.length > 0) {
            update.b.forEach((bid) => {
                const existingBidIndex = this.bids.findIndex(
                    (b) => b[0] === bid[0]
                );
                if (existingBidIndex !== -1) {
                    this.bids[existingBidIndex][1] = bid[1]; // Update quantity
                } else {
                    if (parseFloat(bid[1]) === 0) {
                        this.bids.splice(existingBidIndex, 1); // Remove bid if quantity is 0
                    } else {
                        this.bids.push(bid); // Add new ask
                    }
                }
            });
        }

        if (update.a && update.a.length > 0) {
            update.a.forEach((ask) => {
                const existingAskIndex = this.asks.findIndex(
                    (a) => a[0] === ask[0]
                );
                if (existingAskIndex !== -1) {
                    this.asks[existingAskIndex][1] = ask[1]; // Update quantity
                } else {
                    if (parseFloat(ask[1]) === 0) {
                        this.asks.splice(existingAskIndex, 1); // Remove ask if quantity is 0
                    } else {
                        this.asks.push(ask); // Add new ask
                    }
                }
            });
        }
        this.lastUpdateId = latestUpdateId;
    }

    public getOrderBook(): SpotWebsocketAPI.DepthResponseResult {
        return {
            lastUpdateId: this.lastUpdateId,
            bids: this.bids,
            asks: this.asks,
        };
    }
}
