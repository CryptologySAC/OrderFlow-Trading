import BetterSqlite3 from "better-sqlite3";
import { Trade, AbsorptionLabel, FeedState } from "./interfaces";
import { SpotWebsocketAPI } from "@binance/spot";

export class Storage {
    private readonly db: BetterSqlite3.Database;
    private readonly insertTrade: BetterSqlite3.Statement;
    private readonly insertAggregatedTrade: BetterSqlite3.Statement;
    private readonly insertSignal: BetterSqlite3.Statement;
    private readonly updateFeedState: BetterSqlite3.Statement;
    private readonly getFeedState: BetterSqlite3.Statement;
    private readonly getTrades: BetterSqlite3.Statement;
    private readonly getAggregatedTrades: BetterSqlite3.Statement;

    constructor() {
        this.db = new BetterSqlite3("xtrades.db", {});

        // Create tables with the updated schema
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS trades (
                tradeId INTEGER PRIMARY KEY,
                tradeTime INTEGER,
                symbol TEXT,
                price REAL,
                quantity REAL,
                isBuyerMaker INTEGER,
                orderType TEXT
            );

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

            CREATE TABLE IF NOT EXISTS signals (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                time INTEGER,
                price REAL,
                label TEXT
            );

            CREATE TABLE IF NOT EXISTS data_feed_state (
                id INTEGER PRIMARY KEY,
                lastTradeId INTEGER,
                lastTradeTime INTEGER,
                lastAggregatedTradeId INTEGER,
                lastAggregatedTradeTime INTEGER,
                updatedAt INTEGER
            );
        `);

        // Initialize data_feed_state with a single row
        this.db.exec(`
            INSERT OR IGNORE INTO data_feed_state (id, lastTradeId, lastTradeTime, lastAggregatedTradeId, lastAggregatedTradeTime, updatedAt)
            VALUES (1, 0, 0, 0, 0, 0)
        `);

        // Create indexes for performance
        this.db.exec(`
            CREATE INDEX IF NOT EXISTS idx_trades_tradeTime ON trades (tradeTime);
            CREATE INDEX IF NOT EXISTS idx_trades_symbol ON trades (symbol);
            CREATE INDEX IF NOT EXISTS idx_aggregated_trades_tradeTime ON aggregated_trades (tradeTime);
            CREATE INDEX IF NOT EXISTS idx_aggregated_trades_symbol ON aggregated_trades (symbol);
            CREATE INDEX IF NOT EXISTS idx_signals_time ON signals (time);
        `);

        // Prepare insert statements
        this.insertTrade = this.db.prepare(`
            INSERT INTO trades (tradeId, tradeTime, symbol, price, quantity, isBuyerMaker, orderType)
            VALUES (@tradeId, @tradeTime, @symbol, @price, @quantity, @isBuyerMaker, @orderType)
        `);

        this.insertAggregatedTrade = this.db.prepare(`
            INSERT INTO aggregated_trades (aggregatedTradeId, firstTradeId, lastTradeId, tradeTime, symbol, price, quantity, isBuyerMaker, orderType, bestMatch)
            VALUES (@aggregatedTradeId, @firstTradeId, @lastTradeId, @tradeTime, @symbol, @price, @quantity, @isBuyerMaker, @orderType, @bestMatch)
        `);

        this.insertSignal = this.db.prepare(`
            INSERT INTO signals (time, price, label)
            VALUES (@time, @price, @label)
        `);

        this.updateFeedState = this.db.prepare(`
            UPDATE data_feed_state
            SET lastTradeId = @lastTradeId,
                lastTradeTime = @lastTradeTime,
                lastAggregatedTradeId = @lastAggregatedTradeId,
                lastAggregatedTradeTime = @lastAggregatedTradeTime,
                updatedAt = @updatedAt
            WHERE id = 1
        `);

        this.getFeedState = this.db.prepare(`
            SELECT lastTradeId, lastTradeTime, lastAggregatedTradeId, lastAggregatedTradeTime
            FROM data_feed_state
            WHERE id = 1
        `);

        this.getTrades = this.db.prepare(`
            SELECT tradeId, tradeTime, symbol, price, quantity, isBuyerMaker, orderType
            FROM trades
            WHERE symbol = @symbol
            ORDER BY tradeTime DESC
            LIMIT @limit
        `);

        this.getAggregatedTrades = this.db.prepare(`
            SELECT aggregatedTradeId, firstTradeId, lastTradeId, tradeTime, symbol, price, quantity, isBuyerMaker, orderType, bestMatch
            FROM aggregated_trades
            WHERE symbol = @symbol
            ORDER BY tradeTime DESC
            LIMIT @limit
        `);
    }

    /**
     * Saves an individual trade to the trades table.
     * @param trade Trade object from Binance trade stream
     */
    public saveTrade(trade: Trade): void {
        try {
            const orderType = trade.m ? "SELL" : "BUY";
            this.insertTrade.run({
                tradeId: trade.t,
                tradeTime: trade.T,
                symbol: trade.s,
                price: parseFloat(trade.p),
                quantity: parseFloat(trade.q),
                isBuyerMaker: trade.m ? 1 : 0,
                orderType,
            });

            // Update feed state
            this.updateFeedState.run({
                lastTradeId: trade.t,
                lastTradeTime: trade.T,
                lastAggregatedTradeId:
                    this.getLastFeedState().lastAggregatedTradeId,
                lastAggregatedTradeTime:
                    this.getLastFeedState().lastAggregatedTradeTime,
                updatedAt: Date.now(),
            });
        } catch (error) {
            console.error("Error saving trade:", error);
        }
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

            // Update feed state
            this.updateFeedState.run({
                lastTradeId: this.getLastFeedState().lastTradeId,
                lastTradeTime: this.getLastFeedState().lastTradeTime,
                lastAggregatedTradeId: aggTrade.a,
                lastAggregatedTradeTime: aggTrade.T,
                updatedAt: Date.now(),
            });
        } catch (error) {
            console.error("Error saving aggregated trade:", error);
        }
    }

    /**
     * Saves a signal to the signals table.
     * @param signal AbsorptionLabel object
     */
    public saveSignal(signal: AbsorptionLabel): void {
        try {
            this.insertSignal.run({
                time: signal.time,
                price: signal.price,
                label: signal.label,
            });
        } catch (error) {
            console.error("Error saving signal:", error);
        }
    }

    public getLastFeedState(): FeedState {
        const result = this.getFeedState.get() as {
            lastTradeId: number | null;
            lastTradeTime: number | null;
            lastAggregatedTradeId: number | null;
            lastAggregatedTradeTime: number | null;
        };
        return {
            lastTradeId: result.lastTradeId || 0,
            lastTradeTime: result.lastTradeTime || 0,
            lastAggregatedTradeId: result.lastAggregatedTradeId || 0,
            lastAggregatedTradeTime: result.lastAggregatedTradeTime || 0,
        };
    }

    /**
     * Closes the database connection.
     */
    public close(): void {
        this.db.close();
    }

    /**
     * Retrieves the latest n trades from the database for a given symbol.
     * @param n Number of trades to retrieve
     * @param symbol Trading pair symbol (default: LTCUSDT)
     * @returns Array of Trade objects
     */
    public getLatestTrades(n: number, symbol: string = "LTCUSDT"): any[] {
        try {
            const rows = this.getTrades.all({ symbol, limit: n }) as {
                tradeId: number;
                tradeTime: number;
                symbol: string;
                price: number;
                quantity: number;
                isBuyerMaker: number;
                orderType: string;
            }[];
            return rows;
        } catch (error) {
            console.error("Error retrieving latest trades:", error);
            return [];
        }
    }

    /**
     * Retrieves the latest n aggregated trades from the database for a given symbol.
     * @param n Number of aggregated trades to retrieve
     * @param symbol Trading pair symbol (default: LTCUSDT)
     * @returns Array of AggregatedTrade objects
     */
    public getLatestAggregatedTrades(
        n: number,
        symbol: string = "LTCUSDT"
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
            }));
        } catch (error) {
            console.error("Error retrieving latest aggregated trades:", error);
            return [];
        }
    }
}
