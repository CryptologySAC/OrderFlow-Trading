// src/infrastructure/migrate.ts
import { Database } from "better-sqlite3";

export function runMigrations(db: Database): void {
    db.exec(`
      CREATE TABLE IF NOT EXISTS coordinator_queue (
          jobId TEXT PRIMARY KEY,
          detectorId TEXT NOT NULL,
          candidateJson TEXT NOT NULL,
          priority INTEGER NOT NULL,
          retryCount INTEGER NOT NULL,
          enqueuedAt INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_queue_pri
          ON coordinator_queue (priority DESC, enqueuedAt);

      CREATE TABLE IF NOT EXISTS coordinator_active (
          jobId TEXT PRIMARY KEY,
          detectorId TEXT NOT NULL,
          candidateJson TEXT NOT NULL,
          priority INTEGER NOT NULL,
          retryCount INTEGER NOT NULL,
          startedAt INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS signal_active_anomalies (
          anomalyType TEXT PRIMARY KEY,
          anomalyJson TEXT NOT NULL,
          detectedAt  INTEGER NOT NULL,
          severity    TEXT NOT NULL
      );

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

      CREATE TABLE IF NOT EXISTS depth_snapshots (
          id TEXT PRIMARY KEY,
          symbol TEXT NOT NULL,
          json BLOB NOT NULL,
          ts INTEGER NOT NULL
       );
  `);
}
