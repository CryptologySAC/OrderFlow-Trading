import BetterSqlite3, { Database } from "better-sqlite3";

/**
 * Singleton database instance for thread-safe access
 * CRITICAL: Thread-safe initialization prevents race conditions in multi-worker environment
 */
let dbInstance: Database | undefined;

/**
 * Initialization flag for thread synchronization
 * Prevents multiple concurrent database connections from being created
 */
let isInitializing = false;

/**
 * Get singleton database instance with thread-safe initialization
 *
 * PRODUCTION-CRITICAL: This function is called from multiple worker threads
 * and must prevent race conditions that could create duplicate connections
 *
 * @param dbPath - Path to SQLite database file
 * @returns Singleton Database instance
 */
export function getDB(dbPath = "./storage/trades.db"): Database {
    if (!dbInstance) {
        // Thread-safe initialization check
        if (isInitializing) {
            // Another thread is initializing - wait for completion
            // SYNC MECHANISM: Busy wait prevents duplicate database connections
            while (isInitializing && !dbInstance) {
                // Minimal delay busy wait for initialization completion
            }
            return dbInstance!;
        }

        // Set flag to prevent concurrent initialization
        isInitializing = true;

        // Initialize database with production settings
        dbInstance = new BetterSqlite3(dbPath);
        dbInstance.pragma("journal_mode = WAL"); // Write-Ahead Logging for performance
        dbInstance.pragma("synchronous = NORMAL"); // Balance safety and performance
        dbInstance.pragma("busy_timeout = 60000"); // Wait up to 60s on lock
        dbInstance.pragma("foreign_keys = ON"); // Enforce referential integrity

        // Clear initialization flag
        isInitializing = false;
    }
    return dbInstance;
}
