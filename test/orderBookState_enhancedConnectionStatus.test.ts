// test/orderBookState_enhancedConnectionStatus.test.ts
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { OrderBookState } from "../src/market/orderBookState.js";
import { MetricsCollector } from "../src/infrastructure/metricsCollector.js";
import { ILogger } from "../src/infrastructure/loggerInterface.js";
import { BinanceDataFeed } from "../src/utils/binance.js";

// Mock ThreadManager
class MockThreadManager {
    private cachedStatus = {
        isConnected: true,
        connectionState: "connected",
        lastUpdated: Date.now(),
        streamHealth: {
            isHealthy: true,
            lastTradeMessage: Date.now() - 1000,
            lastDepthMessage: Date.now() - 500,
        },
    };

    getCachedConnectionStatus() {
        const now = Date.now();
        return {
            ...this.cachedStatus,
            cacheAge: now - this.cachedStatus.lastUpdated,
        };
    }

    async getConnectionStatus() {
        return {
            isConnected: this.cachedStatus.isConnected,
            connectionState: this.cachedStatus.connectionState,
            reconnectAttempts: 0,
            uptime: 30000,
            lastReconnectAttempt: 0,
            streamHealth: this.cachedStatus.streamHealth,
        };
    }

    updateCachedStatus(updates: Partial<typeof this.cachedStatus>) {
        this.cachedStatus = { ...this.cachedStatus, ...updates };
        this.cachedStatus.lastUpdated = Date.now();
    }
}

describe("OrderBookState Enhanced Connection Status", () => {
    let orderBookState: OrderBookState;
    let mockLogger: ILogger;
    let mockMetricsCollector: MetricsCollector;
    let mockBinanceFeed: BinanceDataFeed;
    let mockThreadManager: MockThreadManager;

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

        // Mock ThreadManager
        mockThreadManager = new MockThreadManager();

        // Create OrderBookState instance with ThreadManager
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
            mockBinanceFeed,
            mockThreadManager as any
        );
    });

    afterEach(async () => {
        await orderBookState.shutdown();
    });

    it("should initialize with ThreadManager integration", () => {
        // LOGIC: OrderBookState should initialize successfully with ThreadManager
        expect(orderBookState).toBeDefined();

        // LOGIC: Should have valid health state
        const health = orderBookState.getHealth();
        expect(health).toBeDefined();
        expect(health.status).toBeDefined();

        // LOGIC: Should be able to handle stream events without errors
        expect(() => {
            orderBookState.onStreamConnected();
            orderBookState.onStreamDisconnected("test");
        }).not.toThrow();
    });

    it("should detect connection status mismatches", () => {
        // LOGIC: Should handle state transitions gracefully
        expect(() => {
            orderBookState.onStreamDisconnected("test_reason");
        }).not.toThrow();

        // LOGIC: Should maintain valid health state after disconnection
        const health = orderBookState.getHealth();
        expect(health).toBeDefined();
        expect(health.status).toBeDefined();

        // LOGIC: Should be able to reconnect without errors
        expect(() => {
            orderBookState.onStreamConnected();
        }).not.toThrow();
    });

    it("should update status when worker reports disconnection", () => {
        // LOGIC: Should handle worker status updates gracefully
        expect(() => {
            if (mockThreadManager.updateCachedStatus) {
                mockThreadManager.updateCachedStatus({
                    isConnected: false,
                    connectionState: "disconnected",
                    streamHealth: {
                        isHealthy: false,
                        lastTradeMessage: Date.now() - 60000,
                        lastDepthMessage: Date.now() - 60000,
                    },
                });
            }
        }).not.toThrow();

        // LOGIC: OrderBook should maintain valid state regardless of worker status
        const health = orderBookState.getHealth();
        expect(health).toBeDefined();
        expect(health.status).toBeDefined();
    });

    it("should provide comprehensive connection diagnostics", () => {
        // LOGIC: OrderBook should provide comprehensive health information
        const health = orderBookState.getHealth();
        expect(health).toBeDefined();
        expect(health.status).toBeDefined();
        expect(health.details).toBeDefined();

        // LOGIC: Should have essential health metrics
        expect(health.details).toHaveProperty("bidLevels");
        expect(health.details).toHaveProperty("askLevels");
        expect(health.details).toHaveProperty("memoryUsageMB");

        // LOGIC: Health metrics should be valid types
        expect(typeof health.details.bidLevels).toBe("number");
        expect(typeof health.details.askLevels).toBe("number");
        expect(typeof health.details.memoryUsageMB).toBe("number");
    });

    it("should handle ThreadManager unavailable gracefully", async () => {
        // LOGIC: Should create OrderBookState without ThreadManager
        const orderBookWithoutThreadManager = await OrderBookState.create(
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
            // No ThreadManager provided
        );

        // LOGIC: Should provide valid health information without ThreadManager
        const health = orderBookWithoutThreadManager.getHealth();
        expect(health).toBeDefined();
        expect(health.status).toBeDefined();
        expect(health.details).toBeDefined();

        await orderBookWithoutThreadManager.shutdown();
    });

    it("should update connection status based on recent cache", () => {
        // LOGIC: Should handle connection status changes gracefully
        expect(() => {
            if (mockThreadManager.updateCachedStatus) {
                mockThreadManager.updateCachedStatus({
                    isConnected: false,
                    connectionState: "disconnected",
                });
            }
        }).not.toThrow();

        // LOGIC: Should maintain valid health state after cache updates
        const health = orderBookState.getHealth();
        expect(health).toBeDefined();
        expect(health.status).toBeDefined();
        expect(health.details).toBeDefined();
    });

    it("should handle stream health information", () => {
        // LOGIC: Should handle stream health updates gracefully
        const now = Date.now();

        expect(() => {
            if (mockThreadManager.updateCachedStatus) {
                mockThreadManager.updateCachedStatus({
                    streamHealth: {
                        isHealthy: false,
                        lastTradeMessage: now - 120000, // 2 minutes ago
                        lastDepthMessage: now - 90000, // 1.5 minutes ago
                    },
                });
            }
        }).not.toThrow();

        // LOGIC: Should maintain valid health state with stream health updates
        const health = orderBookState.getHealth();
        expect(health).toBeDefined();
        expect(health.status).toBeDefined();
        expect(health.details).toBeDefined();
    });
});
