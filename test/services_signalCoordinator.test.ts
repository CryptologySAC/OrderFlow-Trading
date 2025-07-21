import { describe, it, expect, vi } from "vitest";

// Mock the WorkerLogger before importing
vi.mock("../src/multithreading/workerLogger");
vi.mock("../src/infrastructure/metricsCollector");

import { SignalCoordinator } from "../src/services/signalCoordinator";
import { WorkerLogger } from "../src/multithreading/workerLogger";
import { MetricsCollector } from "../src/infrastructure/metricsCollector";

const storage = {
    enqueueJob: vi.fn(),
    dequeueJobs: vi.fn().mockReturnValue([]),
    markJobCompleted: vi.fn(),
    restoreQueuedJobs: vi.fn().mockReturnValue([]),
    saveActiveAnomaly: vi.fn(),
    removeActiveAnomaly: vi.fn(),
    getActiveAnomalies: vi.fn().mockReturnValue([]),
    saveSignalHistory: vi.fn(),
    saveConfirmedSignal: vi.fn(),
    getRecentSignals: vi.fn().mockReturnValue([]),
    purgeSignalHistory: vi.fn(),
    purgeConfirmedSignals: vi.fn(),
    close: vi.fn(),
};

const mockThreadManager = {
    callStorage: vi
        .fn()
        .mockImplementation((method: string, ...args: any[]) => {
            // Handle the actual storage method calls
            if (storage[method as keyof typeof storage]) {
                const result = (storage as any)[method](...args);
                return Promise.resolve(result);
            }
            return Promise.resolve([]);
        }),
    broadcast: vi.fn(),
    shutdown: vi.fn(),
};

class DummyDetector extends require("events").EventEmitter {
    getId() {
        return "det";
    }
}

describe("services/SignalCoordinator", () => {
    it("queues signals from detectors", () => {
        const coordinator = new SignalCoordinator(
            {},
            new WorkerLogger(),
            new MetricsCollector(),
            { logProcessedSignal: vi.fn(), logProcessingError: vi.fn() } as any,
            { handleProcessedSignal: vi.fn() } as any,
            mockThreadManager as any
        );

        const det = new DummyDetector() as any;
        coordinator.registerDetector(det, ["momentum"]);
        det.emit("signalCandidate", {
            id: "c1",
            type: "momentum",
            confidence: 1,
            data: {},
        });
        expect(mockThreadManager.callStorage).toHaveBeenCalledWith(
            "enqueueJob",
            expect.any(Object)
        );
    });

    it("reports status correctly", async () => {
        const coordinator = new SignalCoordinator(
            {},
            new WorkerLogger(),
            new MetricsCollector(),
            { logProcessedSignal: vi.fn(), logProcessingError: vi.fn() } as any,
            { handleProcessedSignal: vi.fn() } as any,
            mockThreadManager as any
        );
        const det = new DummyDetector() as any;
        coordinator.registerDetector(det, ["momentum"]);
        expect(coordinator.getStatus().registeredDetectors).toBe(1);
        await coordinator.start();
        expect(coordinator.getStatus().isRunning).toBe(true);
        await coordinator.stop();
        expect(coordinator.getStatus().isRunning).toBe(false);
    });
});
