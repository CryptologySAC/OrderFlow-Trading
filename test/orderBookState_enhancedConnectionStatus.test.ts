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
        const diagnostics = orderBookState.getConnectionDiagnostics();

        expect(diagnostics.orderBookStatus.isStreamConnected).toBe(true);
        expect(diagnostics.cachedWorkerStatus).toBeDefined();
        expect(diagnostics.cachedWorkerStatus?.isConnected).toBe(true);
        expect(diagnostics.statusMismatch).toBe(false);
    });

    it("should detect connection status mismatches", () => {
        // Simulate OrderBookState thinks it's disconnected but worker thinks it's connected
        orderBookState.onStreamDisconnected("test_reason");

        const diagnostics = orderBookState.getConnectionDiagnostics();

        expect(diagnostics.orderBookStatus.isStreamConnected).toBe(false);
        expect(diagnostics.cachedWorkerStatus?.isConnected).toBe(true);
        expect(diagnostics.statusMismatch).toBe(true);
    });

    it("should update status when worker reports disconnection", () => {
        // Simulate worker reports disconnection
        mockThreadManager.updateCachedStatus({
            isConnected: false,
            connectionState: "disconnected",
            streamHealth: {
                isHealthy: false,
                lastTradeMessage: Date.now() - 60000,
                lastDepthMessage: Date.now() - 60000,
            },
        });

        const diagnostics = orderBookState.getConnectionDiagnostics();

        expect(diagnostics.cachedWorkerStatus?.isConnected).toBe(false);
        expect(diagnostics.cachedWorkerStatus?.connectionState).toBe(
            "disconnected"
        );
        expect(diagnostics.cachedWorkerStatus?.streamHealth.isHealthy).toBe(
            false
        );
    });

    it("should provide comprehensive connection diagnostics", () => {
        const diagnostics = orderBookState.getConnectionDiagnostics();

        expect(diagnostics).toHaveProperty("orderBookStatus");
        expect(diagnostics).toHaveProperty("cachedWorkerStatus");
        expect(diagnostics).toHaveProperty("statusMismatch");

        expect(diagnostics.orderBookStatus).toHaveProperty("isStreamConnected");
        expect(diagnostics.orderBookStatus).toHaveProperty(
            "streamConnectionTime"
        );

        expect(diagnostics.cachedWorkerStatus).toHaveProperty("isConnected");
        expect(diagnostics.cachedWorkerStatus).toHaveProperty(
            "connectionState"
        );
        expect(diagnostics.cachedWorkerStatus).toHaveProperty("cacheAge");
        expect(diagnostics.cachedWorkerStatus).toHaveProperty("streamHealth");
    });

    it("should handle ThreadManager unavailable gracefully", async () => {
        // Create OrderBookState without ThreadManager
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

        const diagnostics =
            orderBookWithoutThreadManager.getConnectionDiagnostics();

        expect(diagnostics.orderBookStatus).toBeDefined();
        expect(diagnostics.cachedWorkerStatus).toBeUndefined();
        expect(diagnostics.statusMismatch).toBe(false);

        await orderBookWithoutThreadManager.shutdown();
    });

    it("should update connection status based on recent cache", () => {
        // Start with OrderBookState thinking it's connected
        expect(
            orderBookState.getConnectionDiagnostics().orderBookStatus
                .isStreamConnected
        ).toBe(true);

        // Simulate worker reports disconnection with recent cache
        mockThreadManager.updateCachedStatus({
            isConnected: false,
            connectionState: "disconnected",
        });

        // Trigger a health check to force status verification
        // This would normally happen automatically during connectionHealthCheck
        const diagnostics = orderBookState.getConnectionDiagnostics();

        // The cached status should show disconnected
        expect(diagnostics.cachedWorkerStatus?.isConnected).toBe(false);
        expect(diagnostics.statusMismatch).toBe(true);
    });

    it("should handle stream health information", () => {
        const now = Date.now();

        mockThreadManager.updateCachedStatus({
            streamHealth: {
                isHealthy: false,
                lastTradeMessage: now - 120000, // 2 minutes ago
                lastDepthMessage: now - 90000, // 1.5 minutes ago
            },
        });

        const diagnostics = orderBookState.getConnectionDiagnostics();

        expect(diagnostics.cachedWorkerStatus?.streamHealth.isHealthy).toBe(
            false
        );
        expect(
            diagnostics.cachedWorkerStatus?.streamHealth.lastTradeMessage
        ).toBe(now - 120000);
        expect(
            diagnostics.cachedWorkerStatus?.streamHealth.lastDepthMessage
        ).toBe(now - 90000);
    });
});
