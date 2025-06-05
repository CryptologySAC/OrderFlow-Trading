import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { Storage } from "../src/storage/storage";

vi.mock("../src/infrastructure/logger");
vi.mock("../src/infrastructure/metricsCollector");

const sampleTrade = (): any => ({
    e: "aggTrade",
    a: 1,
    p: "100",
    q: "2",
    f: 1,
    l: 1,
    T: Date.now(),
    m: false,
    M: true,
});

describe("storage/Storage", () => {
    let storage: Storage;
    beforeEach(() => {
        const db = new Database(":memory:");
        storage = new Storage(db);
    });
    afterEach(() => {
        storage.close();
    });

    it("saves and retrieves trades", () => {
        const trade = sampleTrade();
        storage.saveAggregatedTrade(trade, "TEST");
        const rows = storage.getLatestAggregatedTrades(1, "TEST");
        expect(rows.length).toBe(1);
        expect(rows[0].a).toBe(1);
    });

    it("purges old entries", () => {
        const trade = sampleTrade();
        trade.T = Date.now() - 10000;
        storage.saveAggregatedTrade(trade, "TEST");
        const purged = storage.purgeOldEntries(0);
        expect(purged).toBeGreaterThanOrEqual(1);
    });
});
