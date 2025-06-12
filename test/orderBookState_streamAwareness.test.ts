// test/orderBookState_streamAwareness.test.ts
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { OrderBookState } from "../src/market/orderBookState.js";
import { MetricsCollector } from "../src/infrastructure/metricsCollector.js";
import { ILogger } from "../src/infrastructure/loggerInterface.js";
import { BinanceDataFeed } from "../src/utils/binance.js";

describe("OrderBookState Stream Awareness", () => {
    let orderBookState: OrderBookState;
    let mockLogger: ILogger;
    let mockMetricsCollector: MetricsCollector;
    let mockBinanceFeed: BinanceDataFeed;

    beforeEach(async () => {
        // Mock logger
        mockLogger = {
            info: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
            debug: vi.fn(),
        };

        // Mock metrics collector
        mockMetricsCollector = {
            updateMetric: vi.fn(),
            incrementMetric: vi.fn(),
            incrementCounter: vi.fn(),
            recordGauge: vi.fn(),
            recordHistogram: vi.fn(),
            getMetrics: vi.fn(() => ({ legacy: {} })),
            getAverageLatency: vi.fn(() => 0),
            getHealthSummary: vi.fn(() => ({})),
        } as any;

        // Mock Binance feed
        mockBinanceFeed = {
            getDepthSnapshot: vi.fn(() =>
                Promise.resolve({
                    lastUpdateId: 123456,
                    bids: [["100.0", "10.0"]],
                    asks: [["101.0", "5.0"]],
                })
            ),
            disconnect: vi.fn(() => Promise.resolve()),
        } as any;

        // Create OrderBookState instance
        orderBookState = await OrderBookState.create(
            {
                pricePrecision: 2,
                symbol: "LTCUSDT",
                maxLevels: 1000,
                maxPriceDistance: 0.1,
                pruneIntervalMs: 30000,
                maxErrorRate: 10,
                staleThresholdMs: 300000,
            },
            mockLogger,
            mockMetricsCollector,
            mockBinanceFeed
        );
    });

    afterEach(async () => {
        await orderBookState.shutdown();
    });

    it("should initialize with default stream connected state", () => {
        const health = orderBookState.getHealth();

        expect(health.details.isStreamConnected).toBe(true);
        expect(health.details.timeoutThreshold).toBe(30000); // 30s for connected state
        expect(health.details.streamConnectionTime).toBeTypeOf("number");
    });

    it("should handle stream disconnection events", () => {
        // Initially connected
        let health = orderBookState.getHealth();
        expect(health.details.isStreamConnected).toBe(true);
        expect(health.details.timeoutThreshold).toBe(30000);

        // Simulate stream disconnection
        orderBookState.onStreamDisconnected("reconnecting");

        // Check updated state
        health = orderBookState.getHealth();
        expect(health.details.isStreamConnected).toBe(false);
        expect(health.details.timeoutThreshold).toBe(300000); // 5 minutes for disconnected state

        // Verify logger was called
        expect(mockLogger.info).toHaveBeenCalledWith(
            expect.stringContaining("Stream disconnected"),
            expect.objectContaining({
                symbol: "LTCUSDT",
                reason: "reconnecting",
            })
        );
    });

    it("should handle stream reconnection events", () => {
        // Start in disconnected state
        orderBookState.onStreamDisconnected("testing");
        let health = orderBookState.getHealth();
        expect(health.details.isStreamConnected).toBe(false);

        // Simulate stream reconnection
        orderBookState.onStreamConnected();

        // Check updated state
        health = orderBookState.getHealth();
        expect(health.details.isStreamConnected).toBe(true);
        expect(health.details.timeoutThreshold).toBe(30000); // Back to 30s for connected state

        // Verify logger was called
        expect(mockLogger.info).toHaveBeenCalledWith(
            expect.stringContaining("Stream connection restored"),
            expect.objectContaining({
                symbol: "LTCUSDT",
            })
        );
    });

    it("should provide comprehensive health information including stream status", () => {
        // Disconnect stream
        orderBookState.onStreamDisconnected("manual_test");

        const health = orderBookState.getHealth();

        // Check that all stream-related fields are present
        expect(health.details).toHaveProperty("isStreamConnected");
        expect(health.details).toHaveProperty("streamConnectionTime");
        expect(health.details).toHaveProperty("timeoutThreshold");

        // Check the specific values
        expect(health.details.isStreamConnected).toBe(false);
        expect(health.details.timeoutThreshold).toBe(300000);
        expect(health.details.streamConnectionTime).toBeTypeOf("number");

        // Check other health fields are still present
        expect(health).toHaveProperty("status");
        expect(health).toHaveProperty("initialized");
        expect(health).toHaveProperty("lastUpdateMs");
        expect(health.details).toHaveProperty("bidLevels");
        expect(health.details).toHaveProperty("askLevels");
        expect(health.details).toHaveProperty("memoryUsageMB");
    });

    it("should not log duplicate connection status changes", () => {
        // Clear any initialization logs
        vi.clearAllMocks();

        // Multiple connected calls should only log once
        orderBookState.onStreamConnected();
        orderBookState.onStreamConnected();
        orderBookState.onStreamConnected();

        // Should not have logged anything since already connected
        expect(mockLogger.info).not.toHaveBeenCalled();

        // Disconnect and reconnect
        orderBookState.onStreamDisconnected("test");
        vi.clearAllMocks();

        orderBookState.onStreamConnected();

        // Should log once for the reconnection
        expect(mockLogger.info).toHaveBeenCalledTimes(1);
        expect(mockLogger.info).toHaveBeenCalledWith(
            expect.stringContaining("Stream connection restored"),
            expect.any(Object)
        );
    });
});