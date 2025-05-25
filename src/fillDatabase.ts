import { BinanceDataFeed } from "./binance.js";
import { SpotWebsocketAPI } from "@binance/spot";
import { Storage } from "./storage.js";

const binanceFeed = new BinanceDataFeed();
const storage = new Storage();
let thresholdTime: number = 0;
const symbol = process.env.SYMBOL ?? "ltcusdt";
const fromId = (process.env.FROM_ID ?? 0) as number; // Default to 0 if not provided
const limit = (process.env.LIMIT ?? 5) as number; // Default to 5 if not provided

async function requestBacklog(fromId: number, limit: number = 1000) {
    try {
        while (thresholdTime < Date.now()) {
            const aggregatedTrades: SpotWebsocketAPI.TradesAggregateResponseResultInner[] =
                await binanceFeed.tradesAggregate(symbol, limit, fromId);
            aggregatedTrades.forEach(
                (
                    trade: SpotWebsocketAPI.TradesAggregateResponseResultInner
                ) => {
                    if (trade.T !== undefined && trade.T > thresholdTime) {
                        thresholdTime = trade.T;
                        storage.saveAggregatedTrade(trade, symbol);
                    }
                }
            );

            if (aggregatedTrades.length < 10) {
                throw new Error("No more trades available");
            }
            console.log(
                "THRESHOLD TIME: %s (now: %s, diff: %s)",
                thresholdTime,
                Date.now(),
                Date.now() - thresholdTime
            );
        }
    } catch (error) {
        console.warn("Backlog filled:", error);
    }
}

requestBacklog(fromId, limit).catch((err) => {
    console.log(err);
});
