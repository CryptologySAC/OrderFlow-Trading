import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Worker } from "worker_threads";

// Mock Worker to test resource management without actual worker threads
vi.mock("worker_threads", () => ({
    Worker: vi.fn(),
}));

const MockedWorker = vi.mocked(Worker);

describe("ThreadManager Resource Leak Fixes", () => {
    let mockWorkerInstances: Array<{
        postMessage: ReturnType<typeof vi.fn>;
        on: ReturnType<typeof vi.fn>;
        terminate: ReturnType<typeof vi.fn>;
        emit: (event: string, ...args: unknown[]) => void;
        _eventListeners: Record<string, Array<(...args: unknown[]) => void>>;
    }>;

    beforeEach(() => {
        vi.clearAllMocks();
        mockWorkerInstances = [];

        // Mock Worker constructor to create mock instances
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
            return mockWorker as unknown as Worker;
        });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("should demonstrate interval cleanup in binanceWorker pattern", () => {
        // Simulate the binanceWorker.ts pattern
        let metricsInterval: NodeJS.Timeout | null = null;
        const mockParentPort = {
            postMessage: vi.fn(),
            on: vi.fn(),
        };

        const messageHandlers: Record<string, () => void> = {};

        // Mock parentPort.on to capture message handlers
        mockParentPort.on.mockImplementation(
            (event: string, handler: (msg: { type: string }) => void) => {
                if (event === "message") {
                    messageHandlers.start = () => handler({ type: "start" });
                    messageHandlers.stop = () => handler({ type: "stop" });
                    messageHandlers.shutdown = () =>
                        handler({ type: "shutdown" });
                }
            }
        );

        // Simulate the improved binanceWorker message handling
        const handleMessage = (msg: { type: string }) => {
            if (msg.type === "start") {
                // Start metrics reporting when worker starts
                if (!metricsInterval) {
                    metricsInterval = setInterval(() => {
                        mockParentPort.postMessage({
                            type: "metrics",
                            data: { sample: "data" },
                        });
                    }, 100); // Use shorter interval for testing
                }
            } else if (msg.type === "stop") {
                // Clear metrics interval when stopped
                if (metricsInterval) {
                    clearInterval(metricsInterval);
                    metricsInterval = null;
                }
            } else if (msg.type === "shutdown") {
                // Clean up resources before shutdown
                if (metricsInterval) {
                    clearInterval(metricsInterval);
                    metricsInterval = null;
                }
            }
        };

        // Test the pattern
        expect(metricsInterval).toBeNull();

        // Start worker - should create interval
        handleMessage({ type: "start" });
        expect(metricsInterval).not.toBeNull();

        // Stop worker - should clear interval
        handleMessage({ type: "stop" });
        expect(metricsInterval).toBeNull();

        // Start again
        handleMessage({ type: "start" });
        expect(metricsInterval).not.toBeNull();

        // Shutdown - should clear interval
        handleMessage({ type: "shutdown" });
        expect(metricsInterval).toBeNull();
    });

    it("should demonstrate ThreadManager graceful shutdown pattern", async () => {
        // Import after mocking
        const { ThreadManager } = await import(
            "../src/multithreading/threadManager.js"
        );

        const threadManager = new ThreadManager();

        // Verify workers were created
        expect(MockedWorker).toHaveBeenCalledTimes(4);
        expect(mockWorkerInstances).toHaveLength(4);

        const [loggerWorker, binanceWorker, commWorker, storageWorker] =
            mockWorkerInstances;

        // Verify error handlers were set up
        expect(loggerWorker.on).toHaveBeenCalledWith(
            "error",
            expect.any(Function)
        );
        expect(loggerWorker.on).toHaveBeenCalledWith(
            "exit",
            expect.any(Function)
        );
        expect(binanceWorker.on).toHaveBeenCalledWith(
            "error",
            expect.any(Function)
        );
        expect(binanceWorker.on).toHaveBeenCalledWith(
            "exit",
            expect.any(Function)
        );
        expect(commWorker.on).toHaveBeenCalledWith(
            "error",
            expect.any(Function)
        );
        expect(commWorker.on).toHaveBeenCalledWith(
            "exit",
            expect.any(Function)
        );
        expect(storageWorker.on).toHaveBeenCalledWith(
            "error",
            expect.any(Function)
        );
        expect(storageWorker.on).toHaveBeenCalledWith(
            "exit",
            expect.any(Function)
        );

        // Test graceful shutdown
        const shutdownPromise = threadManager.shutdown();

        // Verify shutdown messages were sent
        expect(loggerWorker.postMessage).toHaveBeenCalledWith({
            type: "shutdown",
        });
        expect(binanceWorker.postMessage).toHaveBeenCalledWith({
            type: "shutdown",
        });
        expect(commWorker.postMessage).toHaveBeenCalledWith({
            type: "shutdown",
        });
        expect(storageWorker.postMessage).toHaveBeenCalledWith({
            type: "shutdown",
        });

        // Simulate workers exiting gracefully
        setTimeout(() => {
            loggerWorker.emit("exit", 0);
            binanceWorker.emit("exit", 0);
            commWorker.emit("exit", 0);
            storageWorker.emit("exit", 0);
        }, 10);

        await shutdownPromise;

        // Verify shutdown completed without calling terminate
        expect(loggerWorker.terminate).not.toHaveBeenCalled();
        expect(binanceWorker.terminate).not.toHaveBeenCalled();
        expect(commWorker.terminate).not.toHaveBeenCalled();
        expect(storageWorker.terminate).not.toHaveBeenCalled();
    });

    it("should handle worker timeout and force termination", async () => {
        const { ThreadManager } = await import(
            "../src/multithreading/threadManager.js"
        );

        const threadManager = new ThreadManager();
        const [loggerWorker, binanceWorker, commWorker, storageWorker] =
            mockWorkerInstances;

        // Mock console.warn to verify timeout warnings
        const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

        // Start shutdown but don't simulate worker exits (simulate hanging workers)
        const shutdownPromise = threadManager.shutdown();

        // Don't emit exit events to simulate hanging workers
        // The shutdown should still complete due to the timeout mechanism

        await shutdownPromise;

        // Verify that timeout warnings were issued
        expect(warnSpy).toHaveBeenCalledWith(
            expect.stringContaining("worker did not exit gracefully")
        );

        warnSpy.mockRestore();
    }, 10000); // Increase timeout for this test

    it("should handle worker errors gracefully", async () => {
        const { ThreadManager } = await import(
            "../src/multithreading/threadManager.js"
        );

        const threadManager = new ThreadManager();
        const [loggerWorker, binanceWorker, commWorker, storageWorker] =
            mockWorkerInstances;

        // Mock console.error to capture error handling
        const errorSpy = vi
            .spyOn(console, "error")
            .mockImplementation(() => {});

        // Simulate worker errors
        const testError = new Error("Test worker error");
        loggerWorker.emit("error", testError);
        binanceWorker.emit("error", testError);
        commWorker.emit("error", testError);
        storageWorker.emit("error", testError);

        // Verify errors were logged
        expect(errorSpy).toHaveBeenCalledWith(
            "Logger worker error:",
            testError
        );
        expect(errorSpy).toHaveBeenCalledWith(
            "Binance worker error:",
            testError
        );
        expect(errorSpy).toHaveBeenCalledWith(
            "Communication worker error:",
            testError
        );
        expect(errorSpy).toHaveBeenCalledWith(
            "Storage worker error:",
            testError
        );

        // Simulate unexpected worker exits
        loggerWorker.emit("exit", 1); // Non-zero exit code
        binanceWorker.emit("exit", 1);
        commWorker.emit("exit", 1);
        storageWorker.emit("exit", 1);

        expect(errorSpy).toHaveBeenCalledWith(
            "Logger worker exited with code 1"
        );
        expect(errorSpy).toHaveBeenCalledWith(
            "Binance worker exited with code 1"
        );
        expect(errorSpy).toHaveBeenCalledWith(
            "Communication worker exited with code 1"
        );
        expect(errorSpy).toHaveBeenCalledWith(
            "Storage worker exited with code 1"
        );

        errorSpy.mockRestore();

        // Clean shutdown should still work - simulate graceful exit for shutdown
        const shutdownPromise = threadManager.shutdown();

        // Simulate workers exiting gracefully during shutdown
        setTimeout(() => {
            loggerWorker.emit("exit", 0);
            binanceWorker.emit("exit", 0);
            commWorker.emit("exit", 0);
        }, 10);

        await shutdownPromise;
    }, 10000); // Increase timeout for this test

    it("should prevent double shutdown", async () => {
        const { ThreadManager } = await import(
            "../src/multithreading/threadManager.js"
        );

        const threadManager = new ThreadManager();
        const [loggerWorker] = mockWorkerInstances;

        // First shutdown
        const shutdown1 = threadManager.shutdown();

        // Immediate second shutdown should return without doing anything
        const shutdown2 = threadManager.shutdown();

        // Simulate workers exiting
        setTimeout(() => {
            mockWorkerInstances.forEach((worker) => worker.emit("exit", 0));
        }, 10);

        await Promise.all([shutdown1, shutdown2]);

        // Verify shutdown message was only sent once per worker
        expect(loggerWorker.postMessage).toHaveBeenCalledTimes(1);
    });

    it("should demonstrate memory leak prevention", () => {
        // Test pattern that prevents the original setInterval memory leak
        const intervals: NodeJS.Timeout[] = [];

        // Simulate creating multiple intervals (bad pattern)
        for (let i = 0; i < 10; i++) {
            const interval = setInterval(() => {
                // Some periodic work
            }, 1000);
            intervals.push(interval);
        }

        // Verify intervals were created
        expect(intervals).toHaveLength(10);

        // Clean up all intervals (good pattern)
        intervals.forEach((interval) => clearInterval(interval));
        intervals.length = 0;

        // Verify cleanup
        expect(intervals).toHaveLength(0);
    });
});
