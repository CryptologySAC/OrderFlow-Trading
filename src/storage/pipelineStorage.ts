/* --------------------------------------------------------------------------
   PipelineStorage – durable persistence for SignalCoordinator & SignalManager
   --------------------------------------------------------------------------
   • Persists: coordinator_queue, coordinator_active, signal_active_anomalies,
               signal_history.
   • Reuses the project’s Better-SQLite3 DB (“./storage/trades.db” by default).
   • Strict typing: no `any`; casts are explicit and safe.
   -------------------------------------------------------------------------- */

import { Database, Statement } from "better-sqlite3";
import { ulid } from "ulid";
import { EventEmitter } from "events";

import type { BaseDetector } from "../indicators/base/baseDetector.js";
import type {
    SignalCandidate,
    ProcessedSignal,
    ConfirmedSignal,
    SignalType,
} from "../types/signalTypes.js";
import type { ProcessingJob } from "../utils/types.js";
import type { AnomalyEvent } from "../services/anomalyDetector.js";
import type {
    SignalOutcome,
    MarketContext,
    FailedSignalAnalysis,
} from "../analysis/signalTracker.js";

/* ------------------------------------------------------------------ */
/*  Minimal stub for restoring jobs after restart                     */
/* ------------------------------------------------------------------ */
class DetectorStub extends EventEmitter {
    public constructor(private readonly id: string) {
        super();
    }
    public getId(): string {
        return this.id;
    }
}

/* ------------------------------------------------------------------ */
/*  Row interfaces                                                    */
/* ------------------------------------------------------------------ */
interface QueueRow {
    jobId: string;
    detectorId: string;
    candidateJson: string;
    priority: number;
    retryCount: number;
    enqueuedAt: number;
}
interface ActiveRow extends QueueRow {
    startedAt: number;
}
interface HistoryRow {
    signalId: string;
    signalJson: string;
    symbol: string;
    price: number;
    timestamp: number;
}
interface ConfirmedRow {
    signalId: string;
    signalJson: string;
    price: number;
    timestamp: number;
}

/* ------------------------------------------------------------------ */
/*  Public config / interface                                         */
/* ------------------------------------------------------------------ */
export interface PipelineStorageConfig {
    maxHistoryRows?: number;
    maxHistoryAgeMin?: number;
}

export interface IPipelineStorage {
    enqueueJob(job: ProcessingJob): void;
    dequeueJobs(limit: number): ProcessingJob[];
    markJobCompleted(jobId: string): void;
    restoreQueuedJobs(): ProcessingJob[];

    saveActiveAnomaly(anomaly: AnomalyEvent): void;
    removeActiveAnomaly(type: string): void;
    getActiveAnomalies(): AnomalyEvent[];

    saveSignalHistory(signal: ProcessedSignal): void;
    getRecentSignals(since: number, symbol?: string): ProcessedSignal[];
    purgeSignalHistory(): void;

    saveConfirmedSignal(signal: ConfirmedSignal): void;
    getRecentConfirmedSignals(since: number): ConfirmedSignal[];
    purgeConfirmedSignals(): void;

    // Signal tracking methods
    saveSignalOutcome(outcome: SignalOutcome): Promise<void>;
    updateSignalOutcome(
        signalId: string,
        updates: Partial<SignalOutcome>
    ): Promise<void>;
    getSignalOutcome(signalId: string): Promise<SignalOutcome | null>;
    getSignalOutcomes(
        timeWindow: number,
        endTime?: number
    ): Promise<SignalOutcome[]>;

    // Market context methods
    saveMarketContext(signalId: string, context: MarketContext): Promise<void>;
    getMarketContext(signalId: string): Promise<MarketContext | null>;

    // Failed signal analysis methods
    saveFailedSignalAnalysis(analysis: FailedSignalAnalysis): Promise<void>;
    getFailedSignalAnalyses(
        timeWindow: number
    ): Promise<FailedSignalAnalysis[]>;

    // Data cleanup
    purgeOldSignalData(olderThan: number): Promise<void>;

    close(): void;
}

/* ------------------------------------------------------------------ */
/*  Implementation                                                    */
/* ------------------------------------------------------------------ */
export class PipelineStorage implements IPipelineStorage {
    private readonly db: Database;

    /* prepared statements */
    private readonly insertQueue: Statement;
    private readonly selectQueue: Statement;
    private readonly deleteQueueBatch: Statement;
    private readonly insertActive: Statement;
    private readonly deleteActive: Statement;
    private readonly selectActive: Statement;

    private readonly upsertAnomaly: Statement;
    private readonly deleteAnomaly: Statement;
    private readonly selectAnomaly: Statement;

    private readonly insertHist: Statement;
    private readonly selectHist: Statement;
    private readonly deleteHistOlder: Statement;
    private readonly countHist: Statement;
    private readonly deleteHistExcess: Statement;

    private readonly insertConfirmed: Statement;
    private readonly selectConfirmed: Statement;
    private readonly deleteConfirmedOlder: Statement;
    private readonly countConfirmed: Statement;
    private readonly deleteConfirmedExcess: Statement;

    // Signal tracking statements
    private readonly insertSignalOutcome: Statement;
    private readonly updateSignalOutcomeStmt: Statement;
    private readonly selectSignalOutcome: Statement;
    private readonly selectSignalOutcomes: Statement;
    private readonly selectSignalOutcomesTimeRange: Statement;

    // Market context statements
    private readonly insertMarketContext: Statement;
    private readonly selectMarketContext: Statement;

    // Failed signal analysis statements
    private readonly insertFailedAnalysis: Statement;
    private readonly selectFailedAnalyses: Statement;

    // Cleanup statements
    private readonly deleteOldSignalOutcomes: Statement;
    private readonly deleteOldMarketContexts: Statement;
    private readonly deleteOldFailedAnalyses: Statement;

    private readonly maxRows: number;
    private readonly maxAgeMin: number;

    public constructor(db: Database, cfg: Partial<PipelineStorageConfig> = {}) {
        const { maxHistoryRows = 100_000, maxHistoryAgeMin = 24 * 60 } = cfg;
        this.maxRows = maxHistoryRows;
        this.maxAgeMin = maxHistoryAgeMin;

        /* ---------------- DB open & pragma ------------------------ */
        this.db = db;
        this.db.pragma("journal_mode = WAL");
        this.db.pragma("synchronous = NORMAL");
        this.db.pragma("foreign_keys = ON");

        /* ---------------- schema ------------------------------- */
        this.db.exec(`
            /* queue */
            CREATE TABLE IF NOT EXISTS coordinator_queue (
                jobId         TEXT PRIMARY KEY,
                detectorId    TEXT NOT NULL,
                candidateJson TEXT NOT NULL,
                priority      INTEGER NOT NULL,
                retryCount    INTEGER NOT NULL,
                enqueuedAt    INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_queue_pri
              ON coordinator_queue (priority DESC, enqueuedAt);

            /* active */
            CREATE TABLE IF NOT EXISTS coordinator_active (
                jobId         TEXT PRIMARY KEY,
                detectorId    TEXT NOT NULL,
                candidateJson TEXT NOT NULL,
                priority      INTEGER NOT NULL,
                retryCount    INTEGER NOT NULL,
                startedAt     INTEGER NOT NULL
            );

            /* anomalies */
            CREATE TABLE IF NOT EXISTS signal_active_anomalies (
                anomalyType TEXT PRIMARY KEY,
                anomalyJson TEXT NOT NULL,
                detectedAt  INTEGER NOT NULL,
                severity    TEXT NOT NULL
            );

            /* history */
            CREATE TABLE IF NOT EXISTS signal_history (
                signalId   TEXT PRIMARY KEY,
                signalJson TEXT NOT NULL,
                symbol     TEXT NOT NULL,
                price      REAL NOT NULL,
                timestamp  INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_hist_ts
              ON signal_history (timestamp DESC);
            CREATE INDEX IF NOT EXISTS idx_hist_sym_ts
              ON signal_history (symbol, timestamp DESC);

            /* confirmed signals */
            CREATE TABLE IF NOT EXISTS confirmed_signals (
                signalId   TEXT PRIMARY KEY,
                signalJson TEXT NOT NULL,
                price      REAL NOT NULL,
                timestamp  INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_confirmed_ts
              ON confirmed_signals (timestamp DESC);

            /* signal outcomes tracking */
            CREATE TABLE IF NOT EXISTS signal_outcomes (
                signalId TEXT PRIMARY KEY,
                signalType TEXT NOT NULL,
                detectorId TEXT NOT NULL,
                entryPrice REAL NOT NULL,
                entryTime INTEGER NOT NULL,
                originalConfidence REAL NOT NULL,
                priceAfter1min REAL,
                priceAfter5min REAL,
                priceAfter15min REAL,
                priceAfter1hour REAL,
                maxFavorableMove REAL NOT NULL DEFAULT 0,
                maxAdverseMove REAL NOT NULL DEFAULT 0,
                timeToMaxFavorable INTEGER,
                timeToMaxAdverse INTEGER,
                outcome TEXT,
                finalizedAt INTEGER,
                currentPrice REAL,
                lastUpdateTime INTEGER,
                isActive INTEGER NOT NULL DEFAULT 1,
                createdAt INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000),
                updatedAt INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000)
            );
            CREATE INDEX IF NOT EXISTS idx_signal_outcomes_entry_time 
              ON signal_outcomes (entryTime DESC);
            CREATE INDEX IF NOT EXISTS idx_signal_outcomes_detector 
              ON signal_outcomes (detectorId, entryTime DESC);
            CREATE INDEX IF NOT EXISTS idx_signal_outcomes_type 
              ON signal_outcomes (signalType, entryTime DESC);
            CREATE INDEX IF NOT EXISTS idx_signal_outcomes_active 
              ON signal_outcomes (isActive, entryTime DESC);

            /* market context at signal time */
            CREATE TABLE IF NOT EXISTS signal_market_context (
                signalId TEXT PRIMARY KEY,
                timestamp INTEGER NOT NULL,
                price REAL NOT NULL,
                currentVolume REAL,
                avgVolume24h REAL,
                volumeRatio REAL,
                recentVolatility REAL,
                normalizedVolatility REAL,
                bidAskSpread REAL,
                bidDepth REAL,
                askDepth REAL,
                liquidityRatio REAL,
                trend5min TEXT,
                trend15min TEXT,
                trend1hour TEXT,
                trendAlignment REAL,
                distanceFromSupport REAL,
                distanceFromResistance REAL,
                nearKeyLevel INTEGER,
                regime TEXT,
                regimeConfidence REAL,
                createdAt INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000),
                FOREIGN KEY (signalId) REFERENCES signal_outcomes (signalId)
            );
            CREATE INDEX IF NOT EXISTS idx_market_context_timestamp 
              ON signal_market_context (timestamp DESC);
            CREATE INDEX IF NOT EXISTS idx_market_context_regime 
              ON signal_market_context (regime, timestamp DESC);

            /* failed signal analysis */
            CREATE TABLE IF NOT EXISTS failed_signal_analysis (
                signalId TEXT PRIMARY KEY,
                signalType TEXT NOT NULL,
                detectorId TEXT NOT NULL,
                failureReason TEXT NOT NULL,
                warningLowVolume INTEGER NOT NULL DEFAULT 0,
                warningWeakConfirmation INTEGER NOT NULL DEFAULT 0,
                warningConflictingSignals INTEGER NOT NULL DEFAULT 0,
                warningPoorMarketConditions INTEGER NOT NULL DEFAULT 0,
                warningRecentFailures INTEGER NOT NULL DEFAULT 0,
                warningExtremeConfidence INTEGER NOT NULL DEFAULT 0,
                warningUnusualSpread INTEGER NOT NULL DEFAULT 0,
                actualDirection TEXT,
                actualMagnitude REAL,
                timeToFailure INTEGER,
                maxDrawdown REAL,
                avoidabilityScore REAL,
                preventionMethod TEXT,
                confidenceReduction REAL,
                filterSuggestion TEXT,
                marketContextJson TEXT, -- JSON of MarketContext at entry and failure
                createdAt INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000),
                FOREIGN KEY (signalId) REFERENCES signal_outcomes (signalId)
            );
            CREATE INDEX IF NOT EXISTS idx_failed_analysis_reason 
              ON failed_signal_analysis (failureReason, createdAt DESC);
            CREATE INDEX IF NOT EXISTS idx_failed_analysis_detector 
              ON failed_signal_analysis (detectorId, createdAt DESC);
            CREATE INDEX IF NOT EXISTS idx_failed_analysis_avoidability 
              ON failed_signal_analysis (avoidabilityScore, createdAt DESC);
        `);

        /* ---------------- prepared stmts ------------------------ */
        /* queue */
        this.insertQueue = this.db.prepare(`
            INSERT OR REPLACE INTO coordinator_queue
            (jobId, detectorId, candidateJson, priority, retryCount, enqueuedAt)
            VALUES (@jobId,@detectorId,@candidateJson,@priority,@retryCount,@enqueuedAt)
        `);
        this.selectQueue = this.db.prepare(`
            SELECT jobId, detectorId, candidateJson, priority, retryCount, enqueuedAt
            FROM coordinator_queue
            ORDER BY priority DESC, enqueuedAt
            LIMIT @limit
        `);
        this.deleteQueueBatch = this.db.prepare(`
            DELETE FROM coordinator_queue
            WHERE jobId IN (
                SELECT jobId FROM coordinator_queue
                ORDER BY priority DESC, enqueuedAt
                LIMIT @limit
            )
        `);
        this.insertActive = this.db.prepare(`
            INSERT OR REPLACE INTO coordinator_active
            (jobId, detectorId, candidateJson, priority, retryCount, startedAt)
            VALUES (@jobId,@detectorId,@candidateJson,@priority,@retryCount,@startedAt)
        `);
        this.deleteActive = this.db.prepare(`
            DELETE FROM coordinator_active WHERE jobId = @jobId
        `);
        this.selectActive = this.db.prepare(`
            SELECT jobId, detectorId, candidateJson, priority, retryCount, startedAt
            FROM coordinator_active
        `);

        /* anomalies */
        this.upsertAnomaly = this.db.prepare(`
            INSERT OR REPLACE INTO signal_active_anomalies
            (anomalyType, anomalyJson, detectedAt, severity)
            VALUES (@anomalyType,@anomalyJson,@detectedAt,@severity)
        `);
        this.deleteAnomaly = this.db.prepare(`
            DELETE FROM signal_active_anomalies WHERE anomalyType = @anomalyType
        `);
        this.selectAnomaly = this.db.prepare(`
            SELECT anomalyJson FROM signal_active_anomalies
        `);

        /* history */
        this.insertHist = this.db.prepare(`
            INSERT OR REPLACE INTO signal_history
            (signalId, signalJson, symbol, price, timestamp)
            VALUES (@signalId,@signalJson,@symbol,@price,@timestamp)
        `);
        this.selectHist = this.db.prepare(`
            SELECT signalJson FROM signal_history
            WHERE timestamp >= @since
              AND (@symbol IS NULL OR symbol = @symbol)
        `);
        this.deleteHistOlder = this.db.prepare(`
            DELETE FROM signal_history WHERE timestamp < @cutTs
        `);
        this.countHist = this.db.prepare(`
            SELECT COUNT(*) as cnt FROM signal_history
        `);
        this.deleteHistExcess = this.db.prepare(`
            DELETE FROM signal_history
            WHERE signalId IN (
              SELECT signalId FROM signal_history
              ORDER BY timestamp ASC
              LIMIT @excess
            )
        `);

        /* confirmed signals */
        this.insertConfirmed = this.db.prepare(`
            INSERT OR REPLACE INTO confirmed_signals
            (signalId, signalJson, price, timestamp)
            VALUES (@signalId,@signalJson,@price,@timestamp)
        `);
        this.selectConfirmed = this.db.prepare(`
            SELECT signalJson FROM confirmed_signals
            WHERE timestamp >= @since
        `);
        this.deleteConfirmedOlder = this.db.prepare(`
            DELETE FROM confirmed_signals WHERE timestamp < @cutTs
        `);
        this.countConfirmed = this.db.prepare(`
            SELECT COUNT(*) as cnt FROM confirmed_signals
        `);
        this.deleteConfirmedExcess = this.db.prepare(`
            DELETE FROM confirmed_signals
            WHERE signalId IN (
              SELECT signalId FROM confirmed_signals
              ORDER BY timestamp ASC
              LIMIT @excess
            )
        `);

        /* signal tracking */
        this.insertSignalOutcome = this.db.prepare(`
            INSERT OR REPLACE INTO signal_outcomes
            (signalId, signalType, detectorId, entryPrice, entryTime, originalConfidence,
             priceAfter1min, priceAfter5min, priceAfter15min, priceAfter1hour,
             maxFavorableMove, maxAdverseMove, timeToMaxFavorable, timeToMaxAdverse,
             outcome, finalizedAt, currentPrice, lastUpdateTime, isActive, updatedAt)
            VALUES (@signalId, @signalType, @detectorId, @entryPrice, @entryTime, @originalConfidence,
                    @priceAfter1min, @priceAfter5min, @priceAfter15min, @priceAfter1hour,
                    @maxFavorableMove, @maxAdverseMove, @timeToMaxFavorable, @timeToMaxAdverse,
                    @outcome, @finalizedAt, @currentPrice, @lastUpdateTime, @isActive, @updatedAt)
        `);
        this.updateSignalOutcomeStmt = this.db.prepare(`
            UPDATE signal_outcomes SET
                priceAfter1min = COALESCE(@priceAfter1min, priceAfter1min),
                priceAfter5min = COALESCE(@priceAfter5min, priceAfter5min),
                priceAfter15min = COALESCE(@priceAfter15min, priceAfter15min),
                priceAfter1hour = COALESCE(@priceAfter1hour, priceAfter1hour),
                maxFavorableMove = COALESCE(@maxFavorableMove, maxFavorableMove),
                maxAdverseMove = COALESCE(@maxAdverseMove, maxAdverseMove),
                timeToMaxFavorable = COALESCE(@timeToMaxFavorable, timeToMaxFavorable),
                timeToMaxAdverse = COALESCE(@timeToMaxAdverse, timeToMaxAdverse),
                outcome = COALESCE(@outcome, outcome),
                finalizedAt = COALESCE(@finalizedAt, finalizedAt),
                currentPrice = COALESCE(@currentPrice, currentPrice),
                lastUpdateTime = COALESCE(@lastUpdateTime, lastUpdateTime),
                isActive = COALESCE(@isActive, isActive),
                updatedAt = strftime('%s','now') * 1000
            WHERE signalId = @signalId
        `);
        this.selectSignalOutcome = this.db.prepare(`
            SELECT * FROM signal_outcomes WHERE signalId = @signalId
        `);
        this.selectSignalOutcomes = this.db.prepare(`
            SELECT * FROM signal_outcomes 
            WHERE entryTime > @startTime 
            ORDER BY entryTime DESC
        `);
        this.selectSignalOutcomesTimeRange = this.db.prepare(`
            SELECT * FROM signal_outcomes 
            WHERE entryTime > @startTime AND entryTime <= @endTime
            ORDER BY entryTime DESC
        `);

        /* market context */
        this.insertMarketContext = this.db.prepare(`
            INSERT OR REPLACE INTO signal_market_context
            (signalId, timestamp, price, currentVolume, avgVolume24h, volumeRatio,
             recentVolatility, normalizedVolatility, bidAskSpread, bidDepth, askDepth,
             liquidityRatio, trend5min, trend15min, trend1hour, trendAlignment,
             distanceFromSupport, distanceFromResistance, nearKeyLevel, regime, regimeConfidence)
            VALUES (@signalId, @timestamp, @price, @currentVolume, @avgVolume24h, @volumeRatio,
                    @recentVolatility, @normalizedVolatility, @bidAskSpread, @bidDepth, @askDepth,
                    @liquidityRatio, @trend5min, @trend15min, @trend1hour, @trendAlignment,
                    @distanceFromSupport, @distanceFromResistance, @nearKeyLevel, @regime, @regimeConfidence)
        `);
        this.selectMarketContext = this.db.prepare(`
            SELECT * FROM signal_market_context WHERE signalId = @signalId
        `);

        /* failed signal analysis */
        this.insertFailedAnalysis = this.db.prepare(`
            INSERT OR REPLACE INTO failed_signal_analysis
            (signalId, signalType, detectorId, failureReason,
             warningLowVolume, warningWeakConfirmation, warningConflictingSignals,
             warningPoorMarketConditions, warningRecentFailures, warningExtremeConfidence,
             warningUnusualSpread, actualDirection, actualMagnitude, timeToFailure,
             maxDrawdown, avoidabilityScore, preventionMethod, confidenceReduction,
             filterSuggestion, marketContextJson)
            VALUES (@signalId, @signalType, @detectorId, @failureReason,
                    @warningLowVolume, @warningWeakConfirmation, @warningConflictingSignals,
                    @warningPoorMarketConditions, @warningRecentFailures, @warningExtremeConfidence,
                    @warningUnusualSpread, @actualDirection, @actualMagnitude, @timeToFailure,
                    @maxDrawdown, @avoidabilityScore, @preventionMethod, @confidenceReduction,
                    @filterSuggestion, @marketContextJson)
        `);
        this.selectFailedAnalyses = this.db.prepare(`
            SELECT * FROM failed_signal_analysis 
            WHERE createdAt > @startTime
            ORDER BY createdAt DESC
        `);

        /* cleanup */
        this.deleteOldSignalOutcomes = this.db.prepare(`
            DELETE FROM signal_outcomes WHERE entryTime < @cutoffTime
        `);
        this.deleteOldMarketContexts = this.db.prepare(`
            DELETE FROM signal_market_context WHERE timestamp < @cutoffTime
        `);
        this.deleteOldFailedAnalyses = this.db.prepare(`
            DELETE FROM failed_signal_analysis WHERE createdAt < @cutoffTime
        `);

        /* graceful close */
        ["SIGINT", "SIGTERM"].forEach((sig) =>
            process.on(sig, () => {
                this.close();
                process.exit(0);
            })
        );
        process.on("exit", () => this.close());
    }

    /* ------------------------------------------------------------------ */
    /*  Queue                                                             */
    /* ------------------------------------------------------------------ */
    public enqueueJob(job: ProcessingJob): void {
        const row: QueueRow = {
            jobId: job.id ?? ulid(),
            detectorId: job.detector.getId(),
            candidateJson: JSON.stringify(job.candidate),
            priority: job.priority,
            retryCount: job.retryCount,
            enqueuedAt: Date.now(),
        };
        this.insertQueue.run(row);
    }

    public dequeueJobs(limit: number): ProcessingJob[] {
        const rows = this.db.transaction(() => {
            const r = this.selectQueue.all({ limit }) as unknown as QueueRow[];
            this.deleteQueueBatch.run({ limit });
            return r;
        })();

        const now = Date.now();
        const jobs: ProcessingJob[] = [];

        for (const r of rows) {
            const candidate = JSON.parse(r.candidateJson) as SignalCandidate;
            const job: ProcessingJob = {
                id: r.jobId,
                detector: new DetectorStub(
                    r.detectorId
                ) as unknown as BaseDetector,
                candidate,
                priority: r.priority,
                retryCount: r.retryCount,
                startTime: now,
            };
            jobs.push(job);

            const activeRow: ActiveRow = { ...r, startedAt: now };
            this.insertActive.run(activeRow);
        }
        return jobs;
    }

    public markJobCompleted(jobId: string): void {
        this.deleteActive.run({ jobId });
    }

    public restoreQueuedJobs(): ProcessingJob[] {
        const queued = this.selectQueue.all({
            limit: 1_000_000,
        }) as unknown as QueueRow[];
        const active = this.selectActive.all() as unknown as ActiveRow[];

        return [...queued, ...active].map((r) => {
            const cand = JSON.parse(r.candidateJson) as SignalCandidate;
            const start =
                "startedAt" in r ? (r as ActiveRow).startedAt : r.enqueuedAt;
            return {
                id: r.jobId,
                detector: new DetectorStub(
                    r.detectorId
                ) as unknown as BaseDetector,
                candidate: cand,
                priority: r.priority,
                retryCount: r.retryCount,
                startTime: start,
            } satisfies ProcessingJob;
        });
    }

    /* ------------------------------------------------------------------ */
    /*  Anomalies                                                         */
    /* ------------------------------------------------------------------ */
    public saveActiveAnomaly(anomaly: AnomalyEvent): void {
        this.upsertAnomaly.run({
            anomalyType: anomaly.type,
            anomalyJson: JSON.stringify(anomaly),
            detectedAt: anomaly.detectedAt,
            severity: anomaly.severity,
        });
    }

    public removeActiveAnomaly(type: string): void {
        this.deleteAnomaly.run({ anomalyType: type });
    }

    public getActiveAnomalies(): AnomalyEvent[] {
        const rows = this.selectAnomaly.all() as { anomalyJson: string }[];
        return rows.map((r) => JSON.parse(r.anomalyJson) as AnomalyEvent);
    }

    /* ------------------------------------------------------------------ */
    /*  History                                                           */
    /* ------------------------------------------------------------------ */
    public saveSignalHistory(signal: ProcessedSignal): void {
        const d = signal.data as { symbol?: string; price?: number };
        const row: HistoryRow = {
            signalId: signal.id,
            signalJson: JSON.stringify(signal),
            symbol: d.symbol ?? "UNKNOWN",
            price: typeof d.price === "number" ? d.price : 0,
            timestamp: signal.timestamp.getTime(),
        };
        this.insertHist.run(row);
    }

    public getRecentSignals(since: number, symbol?: string): ProcessedSignal[] {
        const rows = this.selectHist.all({
            since,
            symbol: symbol ?? null,
        }) as { signalJson: string }[];
        return rows.map((r) => JSON.parse(r.signalJson) as ProcessedSignal);
    }

    public purgeSignalHistory(): void {
        const cutTs = Date.now() - this.maxAgeMin * 60 * 1_000;
        this.deleteHistOlder.run({ cutTs });

        const total: number = (this.countHist.get() as { cnt: number }).cnt;
        if (total > this.maxRows) {
            this.deleteHistExcess.run({ excess: total - this.maxRows });
        }
    }

    /* ------------------------------------------------------------------ */
    /*  Confirmed Signals                                                 */
    /* ------------------------------------------------------------------ */
    public saveConfirmedSignal(signal: ConfirmedSignal): void {
        const row: ConfirmedRow = {
            signalId: signal.id,
            signalJson: JSON.stringify(signal),
            price: signal.finalPrice,
            timestamp: signal.confirmedAt,
        };
        this.insertConfirmed.run(row);
    }

    public getRecentConfirmedSignals(since: number): ConfirmedSignal[] {
        const rows = this.selectConfirmed.all({ since }) as { signalJson: string }[];
        return rows.map((r) => JSON.parse(r.signalJson) as ConfirmedSignal);
    }

    public purgeConfirmedSignals(): void {
        const cutTs = Date.now() - this.maxAgeMin * 60 * 1_000;
        this.deleteConfirmedOlder.run({ cutTs });

        const total: number = (this.countConfirmed.get() as { cnt: number }).cnt;
        if (total > this.maxRows) {
            this.deleteConfirmedExcess.run({ excess: total - this.maxRows });
        }
    }

    /* ------------------------------------------------------------------ */
    /*  Signal Tracking                                                   */
    /* ------------------------------------------------------------------ */
    public async saveSignalOutcome(outcome: SignalOutcome): Promise<void> {
        try {
            await Promise.resolve();
            this.insertSignalOutcome.run({
                signalId: outcome.signalId,
                signalType: outcome.signalType,
                detectorId: outcome.detectorId,
                entryPrice: outcome.entryPrice,
                entryTime: outcome.entryTime,
                originalConfidence: outcome.originalConfidence,
                priceAfter1min: outcome.priceAfter1min || null,
                priceAfter5min: outcome.priceAfter5min || null,
                priceAfter15min: outcome.priceAfter15min || null,
                priceAfter1hour: outcome.priceAfter1hour || null,
                maxFavorableMove: outcome.maxFavorableMove,
                maxAdverseMove: outcome.maxAdverseMove,
                timeToMaxFavorable: outcome.timeToMaxFavorable || null,
                timeToMaxAdverse: outcome.timeToMaxAdverse || null,
                outcome: outcome.outcome || null,
                finalizedAt: outcome.finalizedAt || null,
                currentPrice: outcome.currentPrice || null,
                lastUpdateTime: outcome.lastUpdated || null,
                isActive: outcome.isActive ? 1 : 0,
                updatedAt: Date.now(),
            });
        } catch (error) {
            throw new Error(
                `Failed to save signal outcome: ${error instanceof Error ? error.message : String(error)}`
            );
        }
    }

    public async updateSignalOutcome(
        signalId: string,
        updates: Partial<SignalOutcome>
    ): Promise<void> {
        try {
            await Promise.resolve();
            this.updateSignalOutcomeStmt.run({
                signalId,
                priceAfter1min: updates.priceAfter1min || null,
                priceAfter5min: updates.priceAfter5min || null,
                priceAfter15min: updates.priceAfter15min || null,
                priceAfter1hour: updates.priceAfter1hour || null,
                maxFavorableMove: updates.maxFavorableMove || null,
                maxAdverseMove: updates.maxAdverseMove || null,
                timeToMaxFavorable: updates.timeToMaxFavorable || null,
                timeToMaxAdverse: updates.timeToMaxAdverse || null,
                outcome: updates.outcome || null,
                finalizedAt: updates.finalizedAt || null,
                currentPrice: updates.currentPrice || null,
                lastUpdateTime: updates.lastUpdated || null,
                isActive:
                    updates.isActive !== undefined
                        ? updates.isActive
                            ? 1
                            : 0
                        : null,
            });
        } catch (error) {
            throw new Error(
                `Failed to update signal outcome: ${error instanceof Error ? error.message : String(error)}`
            );
        }
    }

    public async getSignalOutcome(
        signalId: string
    ): Promise<SignalOutcome | null> {
        try {
            await Promise.resolve();
            const row = this.selectSignalOutcome.get({ signalId }) as
                | Record<string, unknown>
                | undefined;
            if (!row) return null;

            return this.mapRowToSignalOutcome(row);
        } catch (error) {
            throw new Error(
                `Failed to get signal outcome: ${error instanceof Error ? error.message : String(error)}`
            );
        }
    }

    public async getSignalOutcomes(
        timeWindow: number,
        endTime?: number
    ): Promise<SignalOutcome[]> {
        try {
            await Promise.resolve();
            const currentTime = endTime || Date.now();
            const startTime = currentTime - timeWindow;

            const rows = endTime
                ? (this.selectSignalOutcomesTimeRange.all({
                      startTime,
                      endTime,
                  }) as Record<string, unknown>[])
                : (this.selectSignalOutcomes.all({ startTime }) as Record<
                      string,
                      unknown
                  >[]);

            return rows.map((row) => this.mapRowToSignalOutcome(row));
        } catch (error) {
            throw new Error(
                `Failed to get signal outcomes: ${error instanceof Error ? error.message : String(error)}`
            );
        }
    }

    /* ------------------------------------------------------------------ */
    /*  Market Context                                                    */
    /* ------------------------------------------------------------------ */
    public async saveMarketContext(
        signalId: string,
        context: MarketContext
    ): Promise<void> {
        try {
            await Promise.resolve();
            this.insertMarketContext.run({
                signalId,
                timestamp: context.timestamp,
                price: context.price,
                currentVolume: context.currentVolume,
                avgVolume24h: context.avgVolume24h,
                volumeRatio: context.volumeRatio,
                recentVolatility: context.recentVolatility,
                normalizedVolatility: context.normalizedVolatility,
                bidAskSpread: context.bidAskSpread,
                bidDepth: context.bidDepth,
                askDepth: context.askDepth,
                liquidityRatio: context.liquidityRatio,
                trend5min: context.trend5min,
                trend15min: context.trend15min,
                trend1hour: context.trend1hour,
                trendAlignment: context.trendAlignment,
                distanceFromSupport: context.distanceFromSupport,
                distanceFromResistance: context.distanceFromResistance,
                nearKeyLevel: context.nearKeyLevel ? 1 : 0,
                regime: context.regime,
                regimeConfidence: context.regimeConfidence,
            });
        } catch (error) {
            throw new Error(
                `Failed to save market context: ${error instanceof Error ? error.message : String(error)}`
            );
        }
    }

    public async getMarketContext(
        signalId: string
    ): Promise<MarketContext | null> {
        try {
            await Promise.resolve();
            const row = this.selectMarketContext.get({ signalId }) as
                | Record<string, unknown>
                | undefined;
            if (!row) return null;

            return {
                timestamp: row.timestamp as number,
                price: row.price as number,
                currentVolume: row.currentVolume as number,
                avgVolume24h: row.avgVolume24h as number,
                volumeRatio: row.volumeRatio as number,
                recentVolatility: row.recentVolatility as number,
                normalizedVolatility: row.normalizedVolatility as number,
                bidAskSpread: row.bidAskSpread as number,
                bidDepth: row.bidDepth as number,
                askDepth: row.askDepth as number,
                liquidityRatio: row.liquidityRatio as number,
                trend5min: row.trend5min as "up" | "down" | "sideways",
                trend15min: row.trend15min as "up" | "down" | "sideways",
                trend1hour: row.trend1hour as "up" | "down" | "sideways",
                trendAlignment: row.trendAlignment as number,
                distanceFromSupport: row.distanceFromSupport as number,
                distanceFromResistance: row.distanceFromResistance as number,
                nearKeyLevel: row.nearKeyLevel === 1,
                regime: row.regime as
                    | "bull_trending"
                    | "bear_trending"
                    | "ranging"
                    | "breakout"
                    | "volatile",
                regimeConfidence: row.regimeConfidence as number,
            };
        } catch (error) {
            throw new Error(
                `Failed to get market context: ${error instanceof Error ? error.message : String(error)}`
            );
        }
    }

    /* ------------------------------------------------------------------ */
    /*  Failed Signal Analysis                                            */
    /* ------------------------------------------------------------------ */
    public async saveFailedSignalAnalysis(
        analysis: FailedSignalAnalysis
    ): Promise<void> {
        try {
            await Promise.resolve();
            this.insertFailedAnalysis.run({
                signalId: analysis.signalId,
                signalType: analysis.signalType,
                detectorId: analysis.detectorId,
                failureReason: analysis.failureReason,
                warningLowVolume: analysis.warningSignals.lowVolume ? 1 : 0,
                warningWeakConfirmation: analysis.warningSignals
                    .weakConfirmation
                    ? 1
                    : 0,
                warningConflictingSignals: analysis.warningSignals
                    .conflictingSignals
                    ? 1
                    : 0,
                warningPoorMarketConditions: analysis.warningSignals
                    .poorMarketConditions
                    ? 1
                    : 0,
                warningRecentFailures: analysis.warningSignals
                    .recentFailuresNearby
                    ? 1
                    : 0,
                warningExtremeConfidence: analysis.warningSignals
                    .extremeConfidence
                    ? 1
                    : 0,
                warningUnusualSpread: analysis.warningSignals.unusualSpread
                    ? 1
                    : 0,
                actualDirection: analysis.actualPriceAction.direction,
                actualMagnitude: analysis.actualPriceAction.magnitude,
                timeToFailure: analysis.actualPriceAction.timeToFailure,
                maxDrawdown: analysis.actualPriceAction.maxDrawdown,
                avoidabilityScore: analysis.avoidability.score,
                preventionMethod: analysis.avoidability.preventionMethod,
                confidenceReduction: analysis.avoidability.confidenceReduction,
                filterSuggestion: analysis.avoidability.filterSuggestion,
                marketContextJson: JSON.stringify({
                    entry: analysis.marketContextAtEntry,
                    failure: analysis.marketContextAtFailure,
                }),
            });
        } catch (error) {
            throw new Error(
                `Failed to save failed signal analysis: ${error instanceof Error ? error.message : String(error)}`
            );
        }
    }

    public getFailedSignalAnalyses(
        timeWindow: number
    ): Promise<FailedSignalAnalysis[]> {
        try {
            const startTime = Date.now() - timeWindow;
            const rows = this.selectFailedAnalyses.all({ startTime }) as Record<
                string,
                unknown
            >[];

            return Promise.resolve(
                rows.map((row) => {
                    const marketContexts = JSON.parse(
                        row.marketContextJson as string
                    ) as {
                        entry: MarketContext;
                        failure: MarketContext;
                    };

                    return {
                        signalId: row.signalId as string,
                        signalType: row.signalType as SignalType,
                        detectorId: row.detectorId as string,
                        failureReason: row.failureReason as string,
                        warningSignals: {
                            lowVolume: row.warningLowVolume === 1,
                            weakConfirmation: row.warningWeakConfirmation === 1,
                            conflictingSignals:
                                row.warningConflictingSignals === 1,
                            poorMarketConditions:
                                row.warningPoorMarketConditions === 1,
                            recentFailuresNearby:
                                row.warningRecentFailures === 1,
                            extremeConfidence:
                                row.warningExtremeConfidence === 1,
                            unusualSpread: row.warningUnusualSpread === 1,
                        },
                        actualPriceAction: {
                            direction: row.actualDirection as
                                | "opposite"
                                | "sideways"
                                | "choppy",
                            magnitude: row.actualMagnitude as number,
                            timeToFailure: row.timeToFailure as number,
                            maxDrawdown: row.maxDrawdown as number,
                        },
                        avoidability: {
                            score: row.avoidabilityScore as number,
                            preventionMethod: row.preventionMethod as string,
                            confidenceReduction:
                                row.confidenceReduction as number,
                            filterSuggestion: row.filterSuggestion as string,
                        },
                        marketContextAtEntry: marketContexts.entry,
                        marketContextAtFailure: marketContexts.failure,
                    } as FailedSignalAnalysis;
                })
            );
        } catch (error) {
            throw new Error(
                `Failed to get failed signal analyses: ${error instanceof Error ? error.message : String(error)}`
            );
        }
    }

    /* ------------------------------------------------------------------ */
    /*  Data Cleanup                                                      */
    /* ------------------------------------------------------------------ */
    public purgeOldSignalData(olderThan: number): Promise<void> {
        try {
            this.db.transaction(() => {
                this.deleteOldSignalOutcomes.run({ cutoffTime: olderThan });
                this.deleteOldMarketContexts.run({ cutoffTime: olderThan });
                this.deleteOldFailedAnalyses.run({ cutoffTime: olderThan });
                this.deleteConfirmedOlder.run({ cutoffTime: olderThan });
            })();
            return Promise.resolve();
        } catch (error) {
            return Promise.reject(
                new Error(
                    `Failed to purge old signal data: ${error instanceof Error ? error.message : String(error)}`
                )
            );
        }
    }

    /* ------------------------------------------------------------------ */
    /*  Helper Methods                                                    */
    /* ------------------------------------------------------------------ */
    private mapRowToSignalOutcome(row: Record<string, unknown>): SignalOutcome {
        // Create a minimal MarketContext for the outcome
        // In practice, this would be fetched from the market context table
        const marketContext: MarketContext = {
            timestamp: row.entryTime as number,
            price: row.entryPrice as number,
            currentVolume: 0,
            avgVolume24h: 0,
            volumeRatio: 1,
            recentVolatility: 0,
            normalizedVolatility: 1,
            bidAskSpread: 0,
            bidDepth: 0,
            askDepth: 0,
            liquidityRatio: 0.5,
            trend5min: "sideways",
            trend15min: "sideways",
            trend1hour: "sideways",
            trendAlignment: 0,
            distanceFromSupport: 0.05,
            distanceFromResistance: 0.05,
            nearKeyLevel: false,
            regime: "ranging",
            regimeConfidence: 0.5,
        };

        return {
            signalId: row.signalId as string,
            signalType: row.signalType as string,
            detectorId: row.detectorId as string,
            entryPrice: row.entryPrice as number,
            entryTime: row.entryTime as number,
            originalConfidence: row.originalConfidence as number,
            priceAfter1min: row.priceAfter1min as number | undefined,
            priceAfter5min: row.priceAfter5min as number | undefined,
            priceAfter15min: row.priceAfter15min as number | undefined,
            priceAfter1hour: row.priceAfter1hour as number | undefined,
            maxFavorableMove: row.maxFavorableMove as number,
            maxAdverseMove: row.maxAdverseMove as number,
            timeToMaxFavorable: row.timeToMaxFavorable as number | undefined,
            timeToMaxAdverse: row.timeToMaxAdverse as number | undefined,
            outcome: row.outcome as
                | "success"
                | "failure"
                | "mixed"
                | "timeout"
                | "pending",
            finalizedAt: row.finalizedAt as number | undefined,
            marketContext,
            currentPrice: row.currentPrice as number | undefined,
            lastUpdated: row.lastUpdateTime as number,
            isActive: row.isActive === 1,
        };
    }

    /* ------------------------------------------------------------------ */
    /*  Close                                                             */
    /* ------------------------------------------------------------------ */
    public close(): void {
        try {
            this.db.close();

            console.info("[PipelineStorage] DB closed");
        } catch (err) {
            console.error("[PipelineStorage] Error closing DB:", err);
        }
    }
}
