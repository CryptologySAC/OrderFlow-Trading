import { SwingPoints } from "./swingpoints.js";
import { Storage } from "./storage.js";
import { SwingPoint } from "./interfaces.js";
import { SpotWebsocketAPI } from "@binance/spot";

const storage = new Storage();
const swingPoints = new SwingPoints(0.01);

try {
    let allAggregatedTrades: SpotWebsocketAPI.TradesAggregateResponseResultInner[] =
        storage.getLatestAggregatedTrades(15000000, "LTCUSDT");
    allAggregatedTrades = allAggregatedTrades.reverse();
    console.log("Aggregated trades amount: ", allAggregatedTrades.length);
    for (const trade of allAggregatedTrades) {
        const aggregateTrade: SwingPoint = {
            tradeId: trade.a !== undefined ? trade.a : 0,
            price: trade.p !== undefined ? parseFloat(trade.p) : 0,
            timeStamp: trade.T !== undefined ? trade.T : 0,
        };
        swingPoints.addPriceLevel(
            aggregateTrade.price,
            aggregateTrade.tradeId,
            aggregateTrade.timeStamp
        );
    }

    const { highs, lows } = swingPoints.getSwingPoints();
    console.log("Swing Highs amount: ", highs.length);
    console.log("Swing Lows amount: ", lows.length);
} catch (error) {
    console.error("Error in SwingPoints: ", error);
}
