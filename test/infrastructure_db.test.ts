import { describe, it, expect, afterEach } from "vitest";
import { getDB } from "../src/infrastructure/db";

let db: any;

describe("infrastructure/db", () => {
    afterEach(() => {
        if (db) db.close();
    });

    it("returns singleton instance", () => {
        db = getDB(":memory:");
        const db2 = getDB(":memory:");
        expect(db).toBe(db2);
    });
});
