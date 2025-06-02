import BetterSqlite3, { Database, Statement } from "better-sqlite3";
import { SpotWebsocketAPI } from "@binance/spot";

/**
 * Shape of the rows stored in the aggregated_trades table.
 */
interface AggregatedTradeRow {
    aggregatedTradeId: number;
    firstTradeId: number;
    lastTradeId: number;
    tradeTime: number;
    symbol: string;
    price: number;
    quantity: number;
    isBuyerMaker: number; // 1 or 0
    orderType: string; // "BUY" or "SELL"
    bestMatch: number; // 1 or 0
}

export interface IStorage {
    saveAggregatedTrade(
        aggTrade: SpotWebsocketAPI.TradesAggregateResponseResultInner,
        symbol: string
    ): void;

    getLatestAggregatedTrades(
        n: number,
        symbol: string
    ): SpotWebsocketAPI.TradesAggregateResponseResultInner[];

    saveAggregatedTradesBulk(
        trades: SpotWebsocketAPI.TradesAggregateResponseResultInner[],
        symbol: string
    ): number;

    purgeOldEntries(hours?: number): number;

    close(): void;
}

export class Storage implements IStorage {
    private readonly db: Database;
    private readonly insertAggregatedTrade: Statement;
    private readonly getAggregatedTrades: Statement;
    private readonly purgeAggregatedTrades: Statement;

    constructor(dbPath = "trades.db") {
        this.db = new BetterSqlite3(dbPath, {});

        // Handle process signals for graceful DB closure
        ["SIGINT", "SIGTERM"].forEach((signal) =>
            process.on(signal, () => {
                this.close();
                process.exit(0);
            })
        );
        process.on("exit", () => this.close());

        // DB schema (with NOT NULL for all columns except orderType, which is always set)
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS aggregated_trades (
                aggregatedTradeId INTEGER PRIMARY KEY,
                firstTradeId INTEGER NOT NULL,
                lastTradeId INTEGER NOT NULL,
                tradeTime INTEGER NOT NULL,
                symbol TEXT NOT NULL,
                price REAL NOT NULL,
                quantity REAL NOT NULL,
                isBuyerMaker INTEGER NOT NULL,
                orderType TEXT NOT NULL,
                bestMatch INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_aggregated_trades_tradeTime ON aggregated_trades (tradeTime);
            CREATE INDEX IF NOT EXISTS idx_aggregated_trades_symbol ON aggregated_trades (symbol);
        `);

        // Prepare statements
        this.insertAggregatedTrade = this.db.prepare(`
            INSERT OR IGNORE INTO aggregated_trades (
                aggregatedTradeId, firstTradeId, lastTradeId, tradeTime, symbol, price, quantity, isBuyerMaker, orderType, bestMatch
            ) VALUES (
                @aggregatedTradeId, @firstTradeId, @lastTradeId, @tradeTime, @symbol, @price, @quantity, @isBuyerMaker, @orderType, @bestMatch
            )
        `);

        this.getAggregatedTrades = this.db.prepare(`
            SELECT aggregatedTradeId, firstTradeId, lastTradeId, tradeTime, symbol, price, quantity, isBuyerMaker, orderType, bestMatch
            FROM aggregated_trades
            WHERE symbol = @symbol
            ORDER BY tradeTime DESC
            LIMIT @limit
        `);

        this.purgeAggregatedTrades = this.db.prepare(`
            DELETE FROM aggregated_trades WHERE tradeTime < @cutOffTime
        `);
    }

    /**
     * Save a single aggregated trade.
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
                    typeof aggTrade.f === "number" ? Math.trunc(aggTrade.f) : 0,
                lastTradeId:
                    typeof aggTrade.l === "number" ? Math.trunc(aggTrade.l) : 0,
                tradeTime:
                    typeof aggTrade.T === "number" ? Math.trunc(aggTrade.T) : 0,
                symbol,
                price: aggTrade.p !== undefined ? parseFloat(aggTrade.p) : 0,
                quantity: aggTrade.q !== undefined ? parseFloat(aggTrade.q) : 0,
                isBuyerMaker: aggTrade.m ? 1 : 0,
                orderType,
                bestMatch: aggTrade.M ? 1 : 0,
            });
        } catch (err: unknown) {
            // Ignore duplicate key errors (SQLITE_CONSTRAINT) only
            if (
                typeof err === "object" &&
                err !== null &&
                "code" in err &&
                // This covers all constraint violations, not just PK, which is safest
                (err as { code: string }).code !== "SQLITE_CONSTRAINT"
            ) {
                console.warn("Unexpected error saving aggregated trade:", err);
            }
            // Otherwise, ignore (e.g., duplicate PK)
        }
    }

    /**
     * Retrieve the latest N aggregated trades for a symbol.
     */
    public getLatestAggregatedTrades(
        n: number,
        symbol: string
    ): SpotWebsocketAPI.TradesAggregateResponseResultInner[] {
        try {
            const rows = this.getAggregatedTrades.all({
                symbol,
                limit: n,
            }) as AggregatedTradeRow[];
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
            return [];
        }
    }

    /**
     * Bulk-insert aggregated trades. Returns number of successfully inserted records.
     * Skips trades that already exist (by PK).
     */
    public saveAggregatedTradesBulk(
        trades: SpotWebsocketAPI.TradesAggregateResponseResultInner[],
        symbol: string
    ): number {
        let inserted = 0;
        const insert = this.insertAggregatedTrade;
        this.db.transaction(() => {
            for (const aggTrade of trades) {
                try {
                    const orderType = aggTrade.m ? "SELL" : "BUY";
                    const info = insert.run({
                        aggregatedTradeId: aggTrade.a,
                        firstTradeId:
                            typeof aggTrade.f === "number"
                                ? Math.trunc(aggTrade.f)
                                : 0,
                        lastTradeId:
                            typeof aggTrade.l === "number"
                                ? Math.trunc(aggTrade.l)
                                : 0,
                        tradeTime:
                            typeof aggTrade.T === "number"
                                ? Math.trunc(aggTrade.T)
                                : 0,
                        symbol,
                        price:
                            aggTrade.p !== undefined
                                ? parseFloat(aggTrade.p)
                                : 0,
                        quantity:
                            aggTrade.q !== undefined
                                ? parseFloat(aggTrade.q)
                                : 0,
                        isBuyerMaker: aggTrade.m ? 1 : 0,
                        orderType,
                        bestMatch: aggTrade.M ? 1 : 0,
                    });
                    if (typeof info.changes === "number" && info.changes > 0) {
                        inserted++;
                    }
                } catch (err: unknown) {
                    // Ignore constraint violation (duplicate)
                    if (
                        typeof err === "object" &&
                        err !== null &&
                        "code" in err &&
                        (err as { code: string }).code === "SQLITE_CONSTRAINT"
                    ) {
                        // do nothing (duplicate)
                    } else {
                        console.warn("Error in bulk insert:", err);
                    }
                }
            }
        })();
        return inserted;
    }

    /**
     * Purge all entries older than the cutoff timestamp (ms since epoch).
     * Returns number of deleted rows.
     */
    public purgeOldEntries(hours = 24): number {
        const cutoffMs = Date.now() - hours * 60 * 60 * 1000;
        try {
            const info = this.purgeAggregatedTrades.run({
                cutOffTime: cutoffMs,
            });
            return typeof info.changes === "number" ? info.changes : 0;
        } catch (error) {
            console.error("Error purging old entries:", error);
            return 0;
        }
    }

    /**
     * Close the database connection.
     */
    public close(): void {
        try {
            this.db.close();
            console.info("Database connection closed.");
        } catch (e) {
            console.error("Error closing database:", e);
        }
    }
}
