import BetterSqlite3 from "better-sqlite3";
import { SpotWebsocketAPI } from "@binance/spot";

export class Storage {
    private readonly db: BetterSqlite3.Database;
    private readonly insertAggregatedTrade: BetterSqlite3.Statement;
    private readonly getAggregatedTrades: BetterSqlite3.Statement;
    private readonly purgeAggregatedTrades: BetterSqlite3.Statement;

    constructor() {
        this.db = new BetterSqlite3("trades.db", {});

        ["SIGINT", "exit"].forEach((signal) =>
            process.on(signal, () => {
                this.close();
                process.exit();
            })
        );

        // Create tables with the updated schema
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS aggregated_trades (
                aggregatedTradeId INTEGER PRIMARY KEY,
                firstTradeId INTEGER,
                lastTradeId INTEGER,
                tradeTime INTEGER,
                symbol TEXT,
                price REAL,
                quantity REAL,
                isBuyerMaker INTEGER,
                orderType TEXT,
                bestMatch INTEGER
            );
        `);

        // Create indexes for performance
        this.db.exec(`
            CREATE INDEX IF NOT EXISTS idx_aggregated_trades_tradeTime ON aggregated_trades (tradeTime);
            CREATE INDEX IF NOT EXISTS idx_aggregated_trades_symbol ON aggregated_trades (symbol);
        `);

        // Prepare insert statements
        this.insertAggregatedTrade = this.db.prepare(`
            INSERT OR IGNORE INTO aggregated_trades (aggregatedTradeId, firstTradeId, lastTradeId, tradeTime, symbol, price, quantity, isBuyerMaker, orderType, bestMatch)
            VALUES (@aggregatedTradeId, @firstTradeId, @lastTradeId, @tradeTime, @symbol, @price, @quantity, @isBuyerMaker, @orderType, @bestMatch)
        `);

        this.getAggregatedTrades = this.db.prepare(`
            SELECT aggregatedTradeId, firstTradeId, lastTradeId, tradeTime, symbol, price, quantity, isBuyerMaker, orderType, bestMatch
            FROM aggregated_trades
            WHERE symbol = @symbol
            ORDER BY tradeTime DESC
            LIMIT @limit
        `);

        this.purgeAggregatedTrades = this.db.prepare(
            `DELETE FROM aggregated_trades WHERE tradeTime < @cutOffTime`
        );
    }

    /**
     * Saves an aggregated trade to the aggregated_trades table.
     * @param aggTrade AggregatedTrade object from Binance aggTrade stream
     */
    public saveAggregatedTrade(
        aggTrade: SpotWebsocketAPI.TradesAggregateResponseResultInner,
        symbol: string
    ): void {
        try {
            const orderType = aggTrade.m ? "SELL" : "BUY";
            this.insertAggregatedTrade.run({
                aggregatedTradeId: aggTrade.a,
                firstTradeId:
                    aggTrade.f !== undefined ? Math.trunc(aggTrade.f) : 0,
                lastTradeId:
                    aggTrade.l !== undefined ? Math.trunc(aggTrade.l) : 0,
                tradeTime:
                    aggTrade.T !== undefined ? Math.trunc(aggTrade.T) : 0,
                symbol,
                price: aggTrade.p !== undefined ? parseFloat(aggTrade.p) : 0,
                quantity: aggTrade.q !== undefined ? parseFloat(aggTrade.q) : 0,
                isBuyerMaker: aggTrade.m ? 1 : 0,
                orderType,
                bestMatch: aggTrade.M ? 1 : 0,
            });
        } catch (err: any) {
            // Ignore duplicate primary key errors (trade already stored)
            if (err.code !== "SQLITE_CONSTRAINT_PRIMARYKEY") {
                console.warn("Unexpected error saving aggregated trade:", err);
            }

            // Otherwise silently skip
            return;
        }
    }

    /**
     * Closes the database connection.
     */
    public close(): void {
        this.db.close();
        console.info("Database connection closed.");
    }

    /**
     * Retrieves the latest n aggregated trades from the database for a given symbol.
     * @param n Number of aggregated trades to retrieve
     * @param symbol Trading pair symbol (default: LTCUSDT)
     * @returns Array of AggregatedTrade objects
     */
    public getLatestAggregatedTrades(
        n: number,
        symbol: string
    ): SpotWebsocketAPI.TradesAggregateResponseResultInner[] {
        try {
            const rows = this.getAggregatedTrades.all({ symbol, limit: n }) as {
                aggregatedTradeId: number;
                firstTradeId: number;
                lastTradeId: number;
                tradeTime: number;
                symbol: string;
                price: number;
                quantity: number;
                isBuyerMaker: number;
                orderType: string;
                bestMatch: number;
            }[];
            return rows.map((row) => ({
                e: "aggTrade",
                s: row.symbol,
                a: row.aggregatedTradeId,
                p: row.price.toString(),
                q: row.quantity.toString(),
                f: row.firstTradeId,
                l: row.lastTradeId,
                T: row.tradeTime,
                m: row.isBuyerMaker === 1,
                M: row.bestMatch === 1,
            })) as SpotWebsocketAPI.TradesAggregateResponseResultInner[];
        } catch (error) {
            console.error("Error retrieving latest aggregated trades:", error);
            return [] as SpotWebsocketAPI.TradesAggregateResponseResultInner[];
        }
    }

    // Function to purge entries older than 24 hours
    public purgeOldEntries(): void {
        // Calculate the cutoff timestamp (24 hours ago in epoch milliseconds)
        const currentTimeMs: number = Date.now(); // Current time in milliseconds
        const hours24Ms: number = 24 * 60 * 60 * 1000; // 24 hours in milliseconds
        const cutoffMs: number = currentTimeMs - hours24Ms;

        try {
            this.purgeAggregatedTrades.run({
                cutOffTime: cutoffMs,
            });
        } catch (error) {
            throw error;
        }
    }
}
