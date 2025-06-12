import BetterSqlite3, { Database } from "better-sqlite3";

let dbInstance: Database | undefined;

export function getDB(dbPath = "./storage/trades.db"): Database {
    if (!dbInstance) {
        dbInstance = new BetterSqlite3(dbPath);
        dbInstance.pragma("journal_mode = WAL");
        dbInstance.pragma("synchronous = NORMAL");
        dbInstance.pragma("busy_timeout = 60000"); // wait up to 60 s on lock
        dbInstance.pragma("foreign_keys = ON");
    }
    return dbInstance;
}
