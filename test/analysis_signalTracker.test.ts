import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock the WorkerLogger before importing
vi.mock("../src/multithreading/workerLogger");
vi.mock("../src/infrastructure/metricsCollector");

import { SignalTracker } from "../src/analysis/signalTracker";
import { WorkerLogger } from "../src/multithreading/workerLogger";
import { MetricsCollector } from "../src/infrastructure/metricsCollector";

describe("analysis/SignalTracker", () => {
    let tracker: SignalTracker;
    beforeEach(() => {
        tracker = new SignalTracker(
            new WorkerLogger(),
            new MetricsCollector(),
            {
                successThreshold: 0.01,
                failureThreshold: -0.01,
                signalTimeoutMs: 500000,
            }
        );
    });

    it("should finalize based on thresholds", () => {
        // Test success threshold (0.02 return > 0.01 successThreshold)
        const finalize = (tracker as any).shouldFinalizeSignal(
            0, // timeElapsed
            0.02 // returnPct
        );
        expect(finalize).toBe("success");

        // Test failure threshold (-0.02 return < -0.01 failureThreshold)
        const finalizeFail = (tracker as any).shouldFinalizeSignal(
            0, // timeElapsed
            -0.02 // returnPct
        );
        expect(finalizeFail).toBe("failure");

        // Test timeout (1000000ms > 500000ms signalTimeoutMs)
        const finalizeTimeout = (tracker as any).shouldFinalizeSignal(
            1000000, // timeElapsed
            0 // returnPct
        );
        expect(finalizeTimeout).toBe("timeout");
    });

    it("returns empty metrics when no data", () => {
        const metrics = tracker.getPerformanceMetrics(1000);
        expect(metrics.totalSignals).toBe(0);
        expect(metrics.overallSuccessRate).toBe(0);
    });
});
