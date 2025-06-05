import { TradesProcessor } from "../src/clients/tradesProcessor";
import { Logger } from "../src/infrastructure/logger";
import { MetricsCollector } from "../src/infrastructure/metricsCollector";
import type { EnrichedTradeEvent } from "../src/types/marketEvents";
import type { SpotWebsocketAPI } from "@binance/spot";

vi.mock("../src/infrastructure/logger");
vi.mock("../src/infrastructure/metricsCollector");
vi.mock("../src/utils/binance");

describe("TradesProcessor", () => {
    let logger: Logger;
    let metrics: MetricsCollector;
    let storage: any;
    let processor: TradesProcessor;

    beforeEach(() => {
        vi.useFakeTimers();
        logger = new Logger();
        metrics = new MetricsCollector();
        storage = {
            saveAggregatedTradesBulk: vi.fn(),
            getLatestAggregatedTrades: vi.fn().mockReturnValue([]),
        };
        processor = new TradesProcessor(
            { symbol: "TEST", healthCheckInterval: 1000000, saveQueueSize: 10 },
            storage,
            logger,
            metrics
        );
    });

    afterEach(async () => {
        vi.useRealTimers();
        await processor.shutdown();
    });

    const createEvent = (): EnrichedTradeEvent => {
        const originalTrade: SpotWebsocketAPI.TradesAggregateResponseResultInner =
            {
                e: "aggTrade",
                s: "TEST",
                a: 1,
                p: "100",
                q: "2",
                f: 1,
                l: 1,
                T: Date.now(),
                m: false,
                M: true,
            } as any;
        return {
            price: 100,
            quantity: 2,
            timestamp: Date.now(),
            buyerIsMaker: false,
            pair: "TEST",
            tradeId: "1",
            originalTrade,
            passiveBidVolume: 0,
            passiveAskVolume: 0,
            zonePassiveBidVolume: 0,
            zonePassiveAskVolume: 0,
        };
    };

    it("processes enriched trade and queues save", () => {
        const event = createEvent();

        const msg = processor.onEnrichedTrade(event);
        expect(msg.type).toBe("trade");
        expect(metrics.incrementMetric).toHaveBeenCalledWith("tradesProcessed");
        const backlog = processor.requestBacklog(1);
        expect(backlog[0].price).toBe(100);
    });

    it("requests backlog from storage when memory empty", () => {
        const storedTrade: SpotWebsocketAPI.TradesAggregateResponseResultInner =
            {
                e: "aggTrade",
                s: "TEST",
                a: 2,
                p: "101",
                q: "1",
                f: 2,
                l: 2,
                T: 1,
                m: false,
                M: true,
            } as any;
        storage.getLatestAggregatedTrades.mockReturnValue([storedTrade]);

        const trades = processor.requestBacklog(1);
        expect(storage.getLatestAggregatedTrades).toHaveBeenCalledWith(
            1,
            "TEST"
        );
        expect(trades[0].price).toBe(101);
    });

    it("reports health transitions based on activity", () => {
        const event = createEvent();
        processor.onEnrichedTrade(event);
        expect(processor.getHealth().status).toBe("healthy");

        vi.advanceTimersByTime(31000);
        expect(processor.getHealth().status).toBe("degraded");

        vi.advanceTimersByTime(30000);
        expect(processor.getHealth().status).toBe("unhealthy");
    });

    it("is unhealthy when save queue is full", () => {
        for (let i = 0; i < 11; i++) {
            processor.onEnrichedTrade(createEvent());
        }
        const health = processor.getHealth();
        expect(health.status).toBe("unhealthy");
    });

    it("collects statistics for processed trades", async () => {
        processor.onEnrichedTrade(createEvent());
        processor.onEnrichedTrade(createEvent());

        await vi.advanceTimersByTimeAsync(1000);

        const stats = processor.getStats();
        expect(stats.processedTrades).toBe(2);
        expect(stats.savedTrades).toBe(2);
    });
});
