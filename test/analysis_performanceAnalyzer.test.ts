import { describe, it, expect, vi } from "vitest";

// Mock the WorkerLogger before importing
vi.mock("../src/multithreading/workerLogger");

import { PerformanceAnalyzer } from "../src/analysis/performanceAnalyzer";
import { WorkerLogger } from "../src/multithreading/workerLogger";
import { MetricsCollector } from "../src/infrastructure/metricsCollector";

const storage = {
    getSignalOutcomes: async () => [],
    getFailedSignalAnalyses: async () => [],
};

describe("analysis/PerformanceAnalyzer", () => {
    const pa = new PerformanceAnalyzer(
        new WorkerLogger(),
        new MetricsCollector(),
        storage as any
    );

    it("calculates sharpe ratio", () => {
        const ratio = (pa as any).calculateSharpeRatio([1, -1, 2]);
        expect(ratio).toBeGreaterThan(0);
    });

    it("calculates risk metrics", () => {
        const metrics = (pa as any).calculateRiskMetrics([0.1, -0.2, 0.3]);
        expect(metrics.winRate).toBeGreaterThan(0);
        expect(metrics.maxDrawdown).toBeLessThan(0);
    });
});
