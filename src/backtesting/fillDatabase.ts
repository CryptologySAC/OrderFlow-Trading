// src/backtesting/fillDatabase.ts
import { BinanceDataFeed } from "../utils/binance.js";
import { Storage } from "../infrastructure/storage.js";

async function fillHistoricalData(): Promise<void> {
    const binanceFeed = new BinanceDataFeed();
    const storage = new Storage();
    const symbol = process.env.SYMBOL || "LTCUSDT";
    const days = parseInt(process.env.BACKFILL_DAYS || "7", 10);

    console.log(`Filling ${days} days of historical data for ${symbol}`);

    try {
        const now = Date.now();
        const startTime = now - days * 24 * 60 * 60 * 1000;
        let currentTime = startTime;

        while (currentTime < now) {
            const trades = await binanceFeed.fetchAggTradesByTime(
                symbol,
                currentTime
            );

            if (trades.length === 0) {
                console.log("No more trades available");
                break;
            }

            // Type-safe iteration
            for (const trade of trades) {
                storage.saveAggregatedTrade(trade, symbol);

                // Update currentTime to last trade time
                if (trade.T && trade.T > currentTime) {
                    currentTime = trade.T;
                }
            }

            console.log(
                `Processed ${trades.length} trades, current time: ${new Date(currentTime).toISOString()}`
            );

            // Avoid rate limits
            await new Promise((resolve) => setTimeout(resolve, 100));
        }

        console.log("Historical data fill completed");
    } catch (error) {
        console.error("Error filling historical data:", error);
        throw error;
    } finally {
        await binanceFeed.disconnect();
        storage.close();
    }
}

// Self-executing async function
void (async () => {
    try {
        await fillHistoricalData();
        process.exit(0);
    } catch (error) {
        console.error("Fatal error:", error);
        process.exit(1);
    }
})();
