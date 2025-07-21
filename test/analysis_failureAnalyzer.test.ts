import { describe, it, expect, vi } from "vitest";
import { FailureAnalyzer } from "../src/analysis/failureAnalyzer";
import type { ILogger } from "../src/infrastructure/loggerInterface";
import type { IWorkerMetricsCollector } from "../src/multithreading/shared/workerInterfaces";

const storage = {
    getFailedSignalAnalyses: async () => [],
};

describe("analysis/FailureAnalyzer", () => {
    const mockLogger: ILogger = {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
        isDebugEnabled: vi.fn(() => false),
        setCorrelationId: vi.fn(),
        removeCorrelationId: vi.fn(),
    };

    const mockMetricsCollector: IWorkerMetricsCollector = {
        updateMetric: vi.fn(),
        incrementMetric: vi.fn(),
        incrementCounter: vi.fn(),
        decrementCounter: vi.fn(),
        recordGauge: vi.fn(),
        recordHistogram: vi.fn(),
        registerMetric: vi.fn(),
        createCounter: vi.fn(),
        createHistogram: vi.fn(),
        createGauge: vi.fn(),
        setGauge: vi.fn(),
        getMetrics: vi.fn(() => ({}) as any),
        getHealthSummary: vi.fn(() => ({}) as any),
        getHistogramPercentiles: vi.fn(() => ({})),
        getCounterRate: vi.fn(() => 0),
        getGaugeValue: vi.fn(() => 0),
        getHistogramSummary: vi.fn(() => null),
        getAverageLatency: vi.fn(() => 0),
        getLatencyPercentiles: vi.fn(() => ({})),
        exportPrometheus: vi.fn(() => ""),
        exportJSON: vi.fn(() => ""),
        reset: vi.fn(),
        cleanup: vi.fn(),
        destroy: vi.fn(),
    };

    const fa = new FailureAnalyzer(
        mockLogger,
        mockMetricsCollector,
        storage as any
    );
    it("provides empty failure patterns", () => {
        const empty = (fa as any).createEmptyFailurePatterns();
        expect(empty.commonFailureReasons.length).toBe(0);
        expect(empty.detectorFailurePatterns.size).toBe(0);
    });
});
