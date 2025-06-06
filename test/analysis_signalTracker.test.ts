import { describe, it, expect, beforeEach } from "vitest";
import { SignalTracker } from "../src/analysis/signalTracker";
import { Logger } from "../src/infrastructure/logger";
import { MetricsCollector } from "../src/infrastructure/metricsCollector";

const storage = {
    getSignalOutcomes: () => Promise.resolve([]),
    getFailedSignalAnalyses: () => Promise.resolve([]),
};

describe("analysis/SignalTracker", () => {
    let tracker: SignalTracker;
    beforeEach(() => {
        tracker = new SignalTracker(
            new Logger(),
            new MetricsCollector(),
            storage as any,
            {
                successThreshold: 0.01,
                failureThreshold: -0.01,
            }
        );
    });

    it("should finalize based on thresholds", () => {
        const outcome: any = {
            signalId: "1",
            entryPrice: 100,
            entryTime: 0,
            maxFavorableMove: 0,
            maxAdverseMove: 0,
        };
        const finalize = (tracker as any).shouldFinalizeSignal(
            outcome,
            0,
            0.02
        );
        expect(finalize).toBe("success");
        const finalizeFail = (tracker as any).shouldFinalizeSignal(
            outcome,
            0,
            -0.02
        );
        expect(finalizeFail).toBe("failure");
        const finalizeNone = (tracker as any).shouldFinalizeSignal(
            outcome,
            1000000,
            0
        );
        expect(finalizeNone).toBe("timeout");
    });

    it("returns empty metrics when no data", () => {
        const metrics = tracker.getPerformanceMetrics(1000);
        expect(metrics.totalSignals).toBe(0);
        expect(metrics.overallSuccessRate).toBe(0);
    });
});
