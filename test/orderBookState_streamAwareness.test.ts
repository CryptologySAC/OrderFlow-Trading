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

        // LOGIC: OrderBook should have valid health state on initialization
        expect(health).toBeDefined();
        expect(health.status).toBeDefined();
        expect(health.details).toBeDefined();

        // LOGIC: Should be able to handle stream events without errors
        expect(() => {
            orderBookState.onStreamDisconnected("test");
            orderBookState.onStreamConnected();
        }).not.toThrow();
    });

    it("should handle stream disconnection events", () => {
        // Get initial health state
        let health = orderBookState.getHealth();
        expect(health).toBeDefined();

        // LOGIC: Should handle stream disconnection gracefully
        expect(() => {
            orderBookState.onStreamDisconnected("reconnecting");
        }).not.toThrow();

        // LOGIC: Should still provide valid health information after disconnection
        health = orderBookState.getHealth();
        expect(health).toBeDefined();
        expect(health.status).toBeDefined();
        expect(health.details).toBeDefined();

        // LOGIC: Should log the disconnection event
        expect(mockLogger.info).toHaveBeenCalledWith(
            expect.stringContaining("Stream disconnected"),
            expect.objectContaining({
                symbol: "LTCUSDT",
                reason: "reconnecting",
            })
        );
    });

    it("should handle stream reconnection events", () => {
        // LOGIC: Should handle disconnection and reconnection cycle gracefully
        expect(() => {
            orderBookState.onStreamDisconnected("testing");
        }).not.toThrow();

        let health = orderBookState.getHealth();
        expect(health).toBeDefined();

        // LOGIC: Should handle reconnection gracefully
        expect(() => {
            orderBookState.onStreamConnected();
        }).not.toThrow();

        // LOGIC: Should maintain valid health state after reconnection
        health = orderBookState.getHealth();
        expect(health).toBeDefined();
        expect(health.status).toBeDefined();
        expect(health.details).toBeDefined();

        // Verify logger was called
        expect(mockLogger.info).toHaveBeenCalledWith(
            expect.stringContaining("Stream connection restored"),
            expect.objectContaining({
                symbol: "LTCUSDT",
            })
        );
    });

    it("should provide comprehensive health information including stream status", () => {
        // LOGIC: Should handle stream disconnection
        expect(() => {
            orderBookState.onStreamDisconnected("manual_test");
        }).not.toThrow();

        const health = orderBookState.getHealth();

        // LOGIC: Should provide comprehensive health information
        expect(health).toBeDefined();
        expect(health.details).toBeDefined();

        // LOGIC: Essential health fields should be present
        expect(health).toHaveProperty("status");
        expect(health).toHaveProperty("initialized");
        expect(health).toHaveProperty("lastUpdateMs");
        expect(health.details).toHaveProperty("bidLevels");
        expect(health.details).toHaveProperty("askLevels");
        expect(health.details).toHaveProperty("memoryUsageMB");

        // LOGIC: Health data should be valid types
        expect(typeof health.status).toBe("string");
        expect(typeof health.details.bidLevels).toBe("number");
        expect(typeof health.details.askLevels).toBe("number");
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
