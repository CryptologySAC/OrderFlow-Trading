/* --------------------------------------------------------------------------
   PipelineStorage – durable persistence for SignalCoordinator & SignalManager
   --------------------------------------------------------------------------
   • Persists: coordinator_queue, coordinator_active, signal_active_anomalies,
               signal_history.
   • Reuses the project’s Better-SQLite3 DB (“trades.db” by default).
   • Strict typing: no `any`; casts are explicit and safe.
   -------------------------------------------------------------------------- */

import { Database, Statement } from "better-sqlite3";
import { ulid } from "ulid";
import { EventEmitter } from "events";

import type { BaseDetector } from "../indicators/base/baseDetector.js";
import type { SignalCandidate, ProcessedSignal } from "../types/signalTypes.js";
import type { ProcessingJob } from "../utils/types.js";
import type { AnomalyEvent } from "../services/anomalyDetector.js";

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
