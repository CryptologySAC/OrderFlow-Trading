import { Database, Statement } from "better-sqlite3";
import { SpotWebsocketAPI } from "@binance/spot";
import { ILogger } from "../infrastructure/loggerInterface.js";
import {
    PipelineStorage,
    IPipelineStorage,
} from "../storage/pipelineStorage.js";
import type { ProcessingJob } from "../utils/types.js";
import type { AnomalyEvent } from "../services/anomalyDetector.js";
import type {
    SignalOutcome,
    MarketContext,
    FailedSignalAnalysis,
} from "../analysis/signalTracker.js";
import type { ProcessedSignal, ConfirmedSignal } from "../types/signalTypes.js";

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

export interface IStorage extends IPipelineStorage {
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

    purgeOldEntries(correlationId: string, hours?: number): number;

    getLastTradeTimestamp(symbol: string): number | null;

    close(): void;
}

export class Storage implements IStorage {
    private readonly db: Database;
    private readonly insertAggregatedTrade: Statement;
    private readonly getAggregatedTrades: Statement;
    private readonly purgeAggregatedTrades: Statement;
    private readonly getLastTradeTimestampStmt: Statement;
    private readonly logger: ILogger;
    private readonly pipelineStorage: PipelineStorage;

    constructor(db: Database, logger: ILogger) {
        this.db = db;
        this.logger = logger;

        this.pipelineStorage = new PipelineStorage(db, {});

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

        this.getLastTradeTimestampStmt = this.db.prepare(`
            SELECT MAX(tradeTime) as lastTime 
            FROM aggregated_trades 
            WHERE symbol = @symbol
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
    public purgeOldEntries(correlationId: string, hours = 24): number {
        const cutoffMs = Date.now() - hours * 60 * 60 * 1000;
        try {
            const info = this.purgeAggregatedTrades.run({
                cutOffTime: cutoffMs,
            });

            this.logger.info(
                "Scheduled purge completed successfully",
                {},
                correlationId
            );
            return typeof info.changes === "number" ? info.changes : 0;
        } catch (error) {
            throw error;
        }
    }

    /**
     * Get the timestamp of the most recent trade for a symbol.
     * Returns null if no trades exist for the symbol.
     */
    public getLastTradeTimestamp(symbol: string): number | null {
        try {
            const result = this.getLastTradeTimestampStmt.get({
                symbol: symbol,
            }) as { lastTime: number | null } | undefined;

            return result?.lastTime || null;
        } catch (error) {
            console.error("Error getting last trade timestamp:", error);
            return null;
        }
    }

    /**
     * Close the database connection.
     */
    public close(): void {
        try {
            this.db.close();
            console.info("Database connection closed.");
            this.pipelineStorage.close();
            console.info("PipeLine Storage conenction closed.");
        } catch (e) {
            console.error("Error closing database:", e);
        }
    }

    public enqueueJob(job: ProcessingJob): void {
        this.pipelineStorage.enqueueJob(job);
    }

    public dequeueJobs(limit: number): ProcessingJob[] {
        return this.pipelineStorage.dequeueJobs(limit);
    }

    public markJobCompleted(jobId: string): void {
        this.pipelineStorage.markJobCompleted(jobId);
    }

    public restoreQueuedJobs(): ProcessingJob[] {
        return this.pipelineStorage.restoreQueuedJobs();
    }

    public saveActiveAnomaly(anomaly: AnomalyEvent): void {
        this.pipelineStorage.saveActiveAnomaly(anomaly);
    }

    public removeActiveAnomaly(type: string): void {
        this.pipelineStorage.removeActiveAnomaly(type);
    }

    public getActiveAnomalies(): AnomalyEvent[] {
        return this.pipelineStorage.getActiveAnomalies();
    }

    public saveSignalHistory(signal: ProcessedSignal): void {
        this.pipelineStorage.saveSignalHistory(signal);
    }

    public getRecentSignals(since: number, symbol?: string): ProcessedSignal[] {
        return this.pipelineStorage.getRecentSignals(since, symbol);
    }

    public purgeSignalHistory(): void {
        this.pipelineStorage.purgeSignalHistory();
    }

    public saveConfirmedSignal(signal: ConfirmedSignal): void {
        return this.pipelineStorage.saveConfirmedSignal(signal);
    }

    public getRecentConfirmedSignals(
        since: number,
        limit?: number
    ): ConfirmedSignal[] {
        return this.pipelineStorage.getRecentConfirmedSignals(since, limit);
    }

    public purgeConfirmedSignals(): void {
        this.pipelineStorage.purgeConfirmedSignals();
    }

    // Signal tracking methods
    public async saveSignalOutcome(outcome: SignalOutcome): Promise<void> {
        await this.pipelineStorage.saveSignalOutcome(outcome);
    }

    public async updateSignalOutcome(
        signalId: string,
        updates: Partial<SignalOutcome>
    ): Promise<void> {
        await this.pipelineStorage.updateSignalOutcome(signalId, updates);
    }

    public async getSignalOutcome(
        signalId: string
    ): Promise<SignalOutcome | null> {
        return await this.pipelineStorage.getSignalOutcome(signalId);
    }

    public async getSignalOutcomes(
        timeWindow: number,
        endTime?: number
    ): Promise<SignalOutcome[]> {
        return await this.pipelineStorage.getSignalOutcomes(
            timeWindow,
            endTime
        );
    }

    // Market context methods
    public async saveMarketContext(
        signalId: string,
        context: MarketContext
    ): Promise<void> {
        await this.pipelineStorage.saveMarketContext(signalId, context);
    }

    public async getMarketContext(
        signalId: string
    ): Promise<MarketContext | null> {
        return await this.pipelineStorage.getMarketContext(signalId);
    }

    // Failed signal analysis methods
    public async saveFailedSignalAnalysis(
        analysis: FailedSignalAnalysis
    ): Promise<void> {
        await this.pipelineStorage.saveFailedSignalAnalysis(analysis);
    }

    public async getFailedSignalAnalyses(
        timeWindow: number
    ): Promise<FailedSignalAnalysis[]> {
        return await this.pipelineStorage.getFailedSignalAnalyses(timeWindow);
    }

    // Data cleanup
    public async purgeOldSignalData(olderThan: number): Promise<void> {
        await this.pipelineStorage.purgeOldSignalData(olderThan);
    }
}
