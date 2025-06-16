import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock the WorkerLogger before importing
vi.mock("../src/multithreading/workerLogger");
vi.mock("../src/infrastructure/metricsCollector");

import { OrderflowPreprocessor } from "../src/market/orderFlowPreprocessor";
import { WorkerLogger } from "../src/multithreading/workerLogger";
import { MetricsCollector } from "../src/infrastructure/metricsCollector";

describe("market/OrderflowPreprocessor", () => {
    let pre: OrderflowPreprocessor;
    let book: any;
    beforeEach(() => {
        const logger = new WorkerLogger();
        const metrics = new MetricsCollector();
        book = {
            updateDepth: vi.fn(),
            getLevel: vi.fn().mockReturnValue({ bid: 1, ask: 2 }),
            getBestBid: vi.fn().mockReturnValue(100),
            getBestAsk: vi.fn().mockReturnValue(101),
            getSpread: vi.fn().mockReturnValue(1),
            sumBand: vi.fn().mockReturnValue({ bid: 2, ask: 3, levels: 1 }),
            snapshot: vi.fn().mockReturnValue(new Map()),
            getDepthMetrics: vi.fn().mockReturnValue({
                totalLevels: 1,
                bidLevels: 1,
                askLevels: 1,
                totalBidVolume: 1,
                totalAskVolume: 1,
                imbalance: 0,
            }),
        };
        pre = new OrderflowPreprocessor({}, book, logger, metrics);
    });

    it("emits enriched trade", (done) => {
        pre.on("enriched_trade", (t) => {
            expect(t.bestBid).toBe(100);
            done();
        });
        pre.handleAggTrade({
            e: "aggTrade",
            T: Date.now(),
            p: "100",
            q: "1",
            s: "TST",
            m: false,
            a: 1,
        } as any);
    });
});
