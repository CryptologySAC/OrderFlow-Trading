import { describe, it, expect, beforeEach } from "vitest";
import { OrderBookState } from "../src/market/orderBookState";
import { Logger } from "../src/infrastructure/logger";
import { MetricsCollector } from "../src/infrastructure/metricsCollector";
import { BinanceDataFeed } from "../src/utils/binance";

vi.mock("../src/infrastructure/logger");
vi.mock("../src/infrastructure/metricsCollector");
vi.mock("../src/utils/binance");

describe("market/OrderBookState", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("updates depth and tracks best bid/ask", async () => {
        vi.spyOn(BinanceDataFeed.prototype, "getDepthSnapshot").mockResolvedValue({
            lastUpdateId: 1,
            bids: [["100", "1"]],
            asks: [["101", "1"]],
        });

        const logger = new Logger();
        const metrics = new MetricsCollector();
        const ob = await OrderBookState.create(
            { pricePrecision: 2, symbol: "TST" },
            logger,
            metrics
        );

        ob.updateDepth({ u: 2, b: [["100", "2"]], a: [["101", "1"]] } as any);
        expect(ob.getBestBid()).toBe(100);
        expect(ob.getBestAsk()).toBe(101);
        expect(ob.getSpread()).toBe(1);
    });
});
