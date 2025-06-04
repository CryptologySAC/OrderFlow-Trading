import { OrderBookProcessor } from "../src/clients/orderBookProcessor";
import { Logger } from "../src/infrastructure/logger";
import { MetricsCollector } from "../src/infrastructure/metricsCollector";
import type { OrderBookSnapshot, PassiveLevel } from "../src/types/marketEvents";

vi.mock("../src/infrastructure/logger");
vi.mock("../src/infrastructure/metricsCollector");

describe("OrderBookProcessor", () => {
    let logger: Logger;
    let metrics: MetricsCollector;
    let processor: OrderBookProcessor;

    beforeEach(() => {
        logger = new Logger();
        metrics = new MetricsCollector();
        processor = new OrderBookProcessor({}, logger, metrics);
    });

    it("processes valid snapshot", () => {
        const depth = new Map<number, PassiveLevel>();
        depth.set(99.9, { price: 99.9, bid: 5, ask: 0, timestamp: Date.now() });
        depth.set(100, { price: 100, bid: 0, ask: 3, timestamp: Date.now() });
        const snapshot: OrderBookSnapshot = {
            timestamp: Date.now(),
            bestBid: 99.9,
            bestAsk: 100,
            spread: 0.1,
            midPrice: 99.95,
            depthSnapshot: depth,
            passiveBidVolume: 5,
            passiveAskVolume: 3,
            imbalance: 0,
        };

        const msg = processor.onOrderBookUpdate(snapshot);
        expect(msg.type).toBe("orderbook");
        expect(metrics.updateMetric).toHaveBeenCalledWith(
            "orderbookProcessingTime",
            expect.any(Number)
        );
        expect(metrics.incrementMetric).toHaveBeenCalledWith(
            "orderbookUpdatesProcessed"
        );
    });

    it("handles invalid snapshot", () => {
        const msg = processor.onOrderBookUpdate({} as OrderBookSnapshot);
        expect(msg.type).toBe("error");
        expect(logger.warn).toHaveBeenCalled();
        expect(logger.error).toHaveBeenCalled();
    });
});
