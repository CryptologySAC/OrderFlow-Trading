import { describe, it, expect } from "vitest";
import { SignalCoordinator } from "../src/services/signalCoordinator";
import { Logger } from "../src/infrastructure/logger";
import { MetricsCollector } from "../src/infrastructure/metricsCollector";

vi.mock("../src/infrastructure/logger");
vi.mock("../src/infrastructure/metricsCollector");

const storage = {
    enqueueJob: vi.fn(),
    dequeueJobs: vi.fn().mockReturnValue([]),
    markJobCompleted: vi.fn(),
    restoreQueuedJobs: vi.fn().mockReturnValue([]),
    saveActiveAnomaly: vi.fn(),
    removeActiveAnomaly: vi.fn(),
    getActiveAnomalies: vi.fn().mockReturnValue([]),
    saveSignalHistory: vi.fn(),
    getRecentSignals: vi.fn().mockReturnValue([]),
    purgeSignalHistory: vi.fn(),
    close: vi.fn(),
};

class DummyDetector extends (require("events").EventEmitter) {
    getId() {
        return "det";
    }
}

describe("services/SignalCoordinator", () => {
    it("queues signals from detectors", () => {
        const coordinator = new SignalCoordinator(
            {},
            new Logger(),
            new MetricsCollector(),
            { logProcessedSignal: vi.fn(), logProcessingError: vi.fn() } as any,
            { handleProcessedSignal: vi.fn() } as any,
            storage as any
        );

        const det = new DummyDetector() as any;
        coordinator.registerDetector(det, ["momentum"]);
        det.emit("signalCandidate", {
            id: "c1",
            type: "momentum",
            confidence: 1,
            data: {},
        });
        expect(storage.enqueueJob).toHaveBeenCalled();
    });
});
