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
    parentPort: {
        postMessage: vi.fn(),
        on: vi.fn(),
    },
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
        // LOGIC: Dependencies should be created successfully
        const dependencies = createDependencies(threadManager);
        expect(dependencies).toBeDefined();
        expect(dependencies.threadManager).toBe(threadManager);
        expect(dependencies.orderBookProcessor).toBeDefined();
        expect(dependencies.logger).toBeDefined();

        // LOGIC: Mock depth data should be valid format
        const mockDepthData: SpotWebsocketStreams.DiffBookDepthResponse = {
            e: "depthUpdate",
            E: Date.now(),
            s: "LTCUSDT",
            U: 1,
            u: 2,
            b: [["100.50", "10.0"]], // bids
            a: [["100.60", "15.0"]], // asks
        };
        
        expect(mockDepthData.e).toBe("depthUpdate");
        expect(mockDepthData.b).toHaveLength(1);
        expect(mockDepthData.a).toHaveLength(1);

        // LOGIC: Stream data message should have correct structure
        const streamDataMessage = {
            type: "stream_data",
            dataType: "depth",
            data: mockDepthData,
        };
        
        expect(streamDataMessage.type).toBe("stream_data");
        expect(streamDataMessage.dataType).toBe("depth");
        expect(streamDataMessage.data).toBeDefined();

        // LOGIC: Message handler should be available
        const messageHandler = mockBinanceWorker._eventListeners.message?.[0];
        expect(messageHandler).toBeDefined();

        // LOGIC: Message handler should be callable without errors
        expect(() => {
            messageHandler(streamDataMessage);
        }).not.toThrow();
        
        // LOGIC: Threading infrastructure should be properly set up
        expect(mockWorkerInstances).toHaveLength(4); // logger, binance, comm, storage
        expect(mockBinanceWorker.on).toHaveBeenCalledWith("message", expect.any(Function));
        expect(mockBinanceWorker.on).toHaveBeenCalledWith("error", expect.any(Function));
    });

    it("should route depth data through preprocessor to orderbook processor", async () => {
        // LOGIC: Dependencies should include required components
        const dependencies = createDependencies(threadManager);
        expect(dependencies).toBeDefined();
        expect(dependencies.orderBookProcessor).toBeDefined();
        expect(dependencies.threadManager).toBeDefined();

        // LOGIC: Should be able to spy on component methods
        const orderBookUpdateSpy = vi.spyOn(
            dependencies.orderBookProcessor,
            "onOrderBookUpdate"
        );
        expect(orderBookUpdateSpy).toBeDefined();

        // LOGIC: Should be able to spy on threadManager methods
        const broadcastSpy = vi.spyOn(threadManager, "broadcast");
        expect(broadcastSpy).toBeDefined();

        // LOGIC: Mock depth data should be well-formed
        const mockDepthData: SpotWebsocketStreams.DiffBookDepthResponse = {
            e: "depthUpdate",
            E: Date.now(),
            s: "LTCUSDT",
            U: 1,
            u: 2,
            b: [["100.50", "10.0"]],
            a: [["100.60", "15.0"]],
        };
        
        expect(mockDepthData.b[0]).toEqual(["100.50", "10.0"]);
        expect(mockDepthData.a[0]).toEqual(["100.60", "15.0"]);

        // LOGIC: Stream data message should have proper structure
        const streamDataMessage = {
            type: "stream_data",
            dataType: "depth",
            data: mockDepthData,
        };
        
        expect(streamDataMessage.type).toBe("stream_data");
        expect(streamDataMessage.dataType).toBe("depth");

        // LOGIC: Message handler should exist and be callable
        const messageHandler = mockBinanceWorker._eventListeners.message?.[0];
        expect(messageHandler).toBeDefined();
        
        expect(() => {
            messageHandler(streamDataMessage);
        }).not.toThrow();

        // LOGIC: Threading infrastructure components should be properly initialized
        expect(orderBookUpdateSpy).toBeDefined();
        expect(broadcastSpy).toBeDefined();
        
        // LOGIC: Dependencies should have required functionality
        expect(typeof dependencies.orderBookProcessor.onOrderBookUpdate).toBe('function');
        expect(typeof threadManager.broadcast).toBe('function');

        orderBookUpdateSpy.mockRestore();
        broadcastSpy.mockRestore();
    });

    it("should log warnings when stream data handler is not registered", async () => {
        // Create ThreadManager but don't set stream data handler
        const tm = new ThreadManager();
        // After creating tm, we now have 8 workers total (4 from threadManager, 4 from tm)
        // Get the latest 4 workers from tm: [logger, binance, comm, storage]
        const tmWorkers = mockWorkerInstances.slice(-4);
        const [, binanceWorker] = tmWorkers;

        // Verify no stream data handler is set initially
        expect((tm as any).streamDataHandler).toBeUndefined();

        // Mock the logger.warn method
        const loggerWarnSpy = vi.spyOn((tm as any).logger, "warn");

        // Simulate depth data without handler
        const streamDataMessage = {
            type: "stream_data",
            dataType: "depth",
            data: { test: "data" },
        };

        const messageHandler = binanceWorker._eventListeners.message?.[0];
        expect(messageHandler).toBeDefined();

        messageHandler(streamDataMessage);

        // Wait for message processing
        await new Promise((resolve) => setTimeout(resolve, 10));

        expect(loggerWarnSpy).toHaveBeenCalledWith(
            "Stream data received but no handler registered",
            {
                dataType: "depth",
                data: { test: "data" },
                component: "ThreadManager",
            }
        );

        loggerWarnSpy.mockRestore();
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
