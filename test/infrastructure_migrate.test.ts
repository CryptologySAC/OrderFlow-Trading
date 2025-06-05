import { describe, it, expect, afterEach } from "vitest";
import Database from "better-sqlite3";
import { runMigrations } from "../src/infrastructure/migrate";

describe("infrastructure/migrate", () => {
    let db: Database.Database | undefined;
    afterEach(() => {
        if (db) db.close();
    });

    it("creates required tables", () => {
        db = new Database(":memory:");
        runMigrations(db);
        const rows = db
            .prepare("SELECT name FROM sqlite_master WHERE type='table'")
            .all();
        const names = rows.map((r: { name: string }) => r.name);
        expect(names).toContain("coordinator_queue");
        expect(names).toContain("signal_history");
    });
});
