import { describe, it, expect, beforeEach, vi } from "vitest";
import { OrderBookState } from "../src/market/orderBookState";
import { WorkerProxyLogger } from "../src/multithreading/shared/workerProxylogger";
import { MetricsCollector } from "../src/infrastructure/metricsCollector";
import { BinanceDataFeed } from "../src/utils/binance";

vi.mock("../src/infrastructure/logger");
vi.mock("../src/infrastructure/metricsCollector");
vi.mock("../src/utils/binance");

describe("OrderBookState purgeCrossedLevels midpoint", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("keeps midpoint level when bestBid equals bestAsk", async () => {
        const feed = new BinanceDataFeed();
        vi.spyOn(feed, "getDepthSnapshot").mockResolvedValue({
            lastUpdateId: 1,
            bids: [["100", "2"]],
            asks: [["100", "3"]],
        });

        const logger = new WorkerProxyLogger("test");
        const metrics = new MetricsCollector();
        const ob = await OrderBookState.create(
            { pricePrecision: 2, symbol: "TST" },
            logger,
            metrics,
            feed
        );

        expect(ob.getBestBid()).toBe(100);
        expect(ob.getBestAsk()).toBe(100);

        ob.purgeCrossedLevelsForTest();

        const level = ob.getLevel(100);
        expect(level?.bid).toBe(2);
        expect(level?.ask).toBe(3);
    });
});
