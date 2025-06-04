import { OrderBookProcessor } from "../src/clients/orderBookProcessor";
import { Logger } from "../src/infrastructure/logger";
import { MetricsCollector } from "../src/infrastructure/metricsCollector";
import type {
    OrderBookSnapshot,
    PassiveLevel,
} from "../src/types/marketEvents";

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

    const createSnapshot = (): OrderBookSnapshot => {
        const depth = new Map<number, PassiveLevel>();
        depth.set(99.9, { price: 99.9, bid: 5, ask: 0, timestamp: Date.now() });
        depth.set(100, { price: 100, bid: 0, ask: 3, timestamp: Date.now() });
        return {
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
    };

    it("processes valid snapshot", () => {
        const snapshot = createSnapshot();

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

    it("tracks stats for processed and failed snapshots", () => {
        processor.onOrderBookUpdate(createSnapshot());
        processor.onOrderBookUpdate({} as OrderBookSnapshot);

        const stats = processor.getStats();
        expect(stats.processedUpdates).toBe(1);
        expect(stats.errorCount).toBe(1);
        expect(stats.lastError).toBeDefined();
    });

    it("reports degraded health after inactivity", () => {
        vi.useFakeTimers();
        processor.onOrderBookUpdate(createSnapshot());
        vi.advanceTimersByTime(6000);
        const health = processor.getHealth();
        expect(health.status).toBe("degraded");
        vi.useRealTimers();
    });

    it("becomes unhealthy when too many errors occur", () => {
        for (let i = 0; i < 11; i++) {
            processor.onOrderBookUpdate({} as OrderBookSnapshot);
        }
        const health = processor.getHealth();
        expect(health.status).toBe("unhealthy");
    });
});
