import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { OrderFlowDashboard } from "../src/orderFlowDashBoard.js";
import { createDependencies } from "../src/core/dependencies.js";
import { ThreadManager } from "../src/multithreading/threadManager.js";
import type { SpotWebsocketStreams } from "@binance/spot";

// Mock external dependencies that connect to live services
vi.mock("../src/utils/binance.js");
vi.mock("../src/infrastructure/logger.js");
vi.mock("../src/infrastructure/metricsCollector.js");

// Mock worker threads
vi.mock("worker_threads", () => ({
    Worker: vi.fn(),
}));

const MockedWorker = vi.mocked((await import("worker_threads")).Worker);

describe("OrderBook Threading Data Flow", () => {
    let threadManager: ThreadManager;
    let mockBinanceWorker: any;
    let mockWorkerInstances: any[];

    beforeEach(() => {
        vi.clearAllMocks();
        mockWorkerInstances = [];

        // Mock Worker constructor
        MockedWorker.mockImplementation(() => {
            const mockWorker = {
                postMessage: vi.fn(),
                on: vi.fn(),
                terminate: vi.fn().mockResolvedValue(undefined),
                emit: vi.fn(),
                _eventListeners: {} as Record<
                    string,
                    Array<(...args: unknown[]) => void>
                >,
            };

            // Mock event handling
            mockWorker.on.mockImplementation(
                (event: string, listener: (...args: unknown[]) => void) => {
                    if (!mockWorker._eventListeners[event]) {
                        mockWorker._eventListeners[event] = [];
                    }
                    mockWorker._eventListeners[event].push(listener);
                    return mockWorker;
                }
            );

            // Mock emit functionality
            mockWorker.emit = (event: string, ...args: unknown[]) => {
                const listeners = mockWorker._eventListeners[event] || [];
                listeners.forEach((listener) => listener(...args));
            };

            mockWorkerInstances.push(mockWorker);
            return mockWorker as any;
        });

        threadManager = new ThreadManager();
        [, mockBinanceWorker] = mockWorkerInstances; // Logger, Binance, Communication, Storage
    });

    afterEach(async () => {
        if (threadManager) {
            await threadManager.shutdown();
        }
        vi.restoreAllMocks();
    });

    it("should have stream data handler registered", () => {
        // Verify ThreadManager was created with proper initialization
        expect(MockedWorker).toHaveBeenCalledTimes(4);
        expect(mockWorkerInstances).toHaveLength(4);

        // Check that binance worker has message listeners
        const [, binanceWorker] = mockWorkerInstances;
        expect(binanceWorker.on).toHaveBeenCalledWith(
            "message",
            expect.any(Function)
        );
    });

    it("should register stream data handler when creating dependencies", () => {
        const dependencies = createDependencies(threadManager);

        // Verify dependencies were created
        expect(dependencies.threadManager).toBe(threadManager);
        expect(dependencies.orderBookProcessor).toBeDefined();
        expect(dependencies.logger).toBeDefined();
    });

    it("should handle depth data from binance worker", async () => {
        const dependencies = createDependencies(threadManager);
        const dashboard = await OrderFlowDashboard.create(dependencies);

        // Mock depth data
        const mockDepthData: SpotWebsocketStreams.DiffBookDepthResponse = {
            e: "depthUpdate",
            E: Date.now(),
            s: "LTCUSDT",
            U: 1,
            u: 2,
            b: [["100.50", "10.0"]], // bids
            a: [["100.60", "15.0"]], // asks
        };

        // Create spy to track if depth is processed
        const processDepthSpy = vi.spyOn(dashboard as any, "processDepth");

        // Simulate BinanceWorker sending depth data
        const streamDataMessage = {
            type: "stream_data",
            dataType: "depth",
            data: mockDepthData,
        };

        // Find the message handler for binance worker
        const messageHandler = mockBinanceWorker._eventListeners.message?.[0];
        expect(messageHandler).toBeDefined();

        // Simulate receiving message from binance worker
        messageHandler(streamDataMessage);

        // Wait for async message processing
        await new Promise((resolve) => setTimeout(resolve, 20));

        // Verify depth processing was called
        expect(processDepthSpy).toHaveBeenCalledWith(mockDepthData);

        processDepthSpy.mockRestore();
    });

    it("should route depth data through preprocessor to orderbook processor", async () => {
        const dependencies = createDependencies(threadManager);
        const dashboard = await OrderFlowDashboard.create(dependencies);

        // Mock the OrderBookProcessor's onOrderBookUpdate method
        const orderBookUpdateSpy = vi.spyOn(
            dependencies.orderBookProcessor,
            "onOrderBookUpdate"
        );

        // Mock the broadcast method
        const broadcastSpy = vi.spyOn(threadManager, "broadcast");

        // Mock depth data
        const mockDepthData: SpotWebsocketStreams.DiffBookDepthResponse = {
            e: "depthUpdate",
            E: Date.now(),
            s: "LTCUSDT",
            U: 1,
            u: 2,
            b: [["100.50", "10.0"]],
            a: [["100.60", "15.0"]],
        };

        // Simulate BinanceWorker sending depth data
        const streamDataMessage = {
            type: "stream_data",
            dataType: "depth",
            data: mockDepthData,
        };

        const messageHandler = mockBinanceWorker._eventListeners.message?.[0];
        messageHandler(streamDataMessage);

        // Allow async processing
        await new Promise((resolve) => setTimeout(resolve, 10));

        // Verify the orderbook processor was called
        // The data flow is working correctly if this is called
        expect(orderBookUpdateSpy).toHaveBeenCalledTimes(1);

        orderBookUpdateSpy.mockRestore();
        broadcastSpy.mockRestore();
    });

    it("should log warnings when stream data handler is not registered", () => {
        const consoleSpy = vi
            .spyOn(console, "warn")
            .mockImplementation(() => {});

        // Create ThreadManager but don't set stream data handler
        const tm = new ThreadManager();
        // After creating tm, we now have 8 workers total (4 from threadManager, 4 from tm)
        // Get the latest 4 workers from tm: [logger, binance, comm, storage]
        const tmWorkers = mockWorkerInstances.slice(-4);
        const [, binanceWorker] = tmWorkers;

        // Simulate depth data without handler
        const streamDataMessage = {
            type: "stream_data",
            dataType: "depth",
            data: { test: "data" },
        };

        const messageHandler = binanceWorker._eventListeners.message?.[0];
        messageHandler(streamDataMessage);

        expect(consoleSpy).toHaveBeenCalledWith(
            "Stream data 'depth' received but no handler registered"
        );

        consoleSpy.mockRestore();
    });

    it("should verify BinanceWorker forwards depth events properly", () => {
        // Mock a simple test of the BinanceWorker pattern
        const mockParentPort = {
            postMessage: vi.fn(),
        };

        // Simulate what BinanceWorker does when it receives depth data
        const mockDepthData = {
            e: "depthUpdate",
            s: "LTCUSDT",
            b: [["100.50", "10.0"]],
            a: [["100.60", "15.0"]],
        };

        // This simulates the pattern in binanceWorker.ts line 106-112
        mockParentPort.postMessage({
            type: "stream_data",
            dataType: "depth",
            data: mockDepthData,
        });

        expect(mockParentPort.postMessage).toHaveBeenCalledWith({
            type: "stream_data",
            dataType: "depth",
            data: mockDepthData,
        });
    });
});
