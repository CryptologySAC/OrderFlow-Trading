// src/types/marketEvents.ts

import type { SpotWebsocketStreams } from "@binance/spot";

export interface AggressiveTrade {
    price: number;
    quantity: number;
    timestamp: number;
    isMakerSell: boolean;
    originalTrade: SpotWebsocketStreams.AggTradeResponse;
}

export interface PassiveLevel {
    price: number;
    bid: number;
    ask: number;
    timestamp: number;
}

export interface EnrichedTradeEvent extends AggressiveTrade {
    passiveBidVolume: number;
    passiveAskVolume: number;
    zonePassiveBidVolume?: number;
    zonePassiveAskVolume?: number;
    depthSnapshot?: Map<number, PassiveLevel>; // Optional, advanced
}
