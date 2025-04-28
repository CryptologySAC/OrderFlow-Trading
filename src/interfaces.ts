export interface PlotTrade {
    time: number; // eventTime in milliseconds
    price: number;
    quantity: number;
    orderType: "BUY" | "SELL";
    symbol: string;
    tradeId: number;
}

export interface MarketOrder {
    orderType: OrderType;
    eventTime: number;
    symbol: string;
    totalQuantity: number;
    averagePrice: number;
    orders: number;
}

export enum OrderType {
    BUY = "BUY Order",
    SELL = "SELL Order",
}

export interface Trade {
    e: string; // Event type (e.g., "trade")
    E: number; // Event time (milliseconds)
    s: string; // Symbol (e.g., "LTCUSDT")
    t: number; // Trade ID
    p: string; // Price
    q: string; // Quantity
    T: number; // Trade time (milliseconds)
    m: boolean; // Is the buyer the maker? (true = seller-initiated, false = buyer-initiated)
    M: boolean; // Is this the best match?
}

export interface AggregatedTrade {
    e: string; // Event type (e.g., "aggTrade")
    E: number; // Event time (milliseconds)
    s: string; // Symbol (e.g., "LTCUSDT")
    a: number; // Aggregated trade ID
    p: string; // Price (weighted average)
    q: string; // Quantity (total)
    f: number; // First trade ID
    l: number; // Last trade ID
    T: number; // Trade time (milliseconds)
    m: boolean; // Is the buyer the maker? (true = seller-initiated, false = buyer-initiated)
    M: boolean; // Is this the best match?
}

export interface AbsorptionLabel {
    time: number; // Time of the signal (milliseconds)
    price: number; // Price at which absorption occurred
    label: string; // Signal description (e.g., "Sell Absorption")
}

export interface Signal {
    type: "BUY" | "SELL";
    time: number;
    price: number;
    quantity: number;
    status: "pending" | "confirmed" | "invalidated";
    tradeIndex?: number;
}

export interface VolumeBin {
    buyVol: number;
    sellVol: number;
    lastUpdate: number;
}

export interface FeedState {
    lastTradeId: number;
    lastTradeTime: number;
    lastAggregatedTradeId: number;
    lastAggregatedTradeTime: number;
}
