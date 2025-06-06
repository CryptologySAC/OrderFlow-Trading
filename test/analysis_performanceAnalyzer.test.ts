import { describe, it, expect } from "vitest";
import { PerformanceAnalyzer } from "../src/analysis/performanceAnalyzer";
import { Logger } from "../src/infrastructure/logger";
import { MetricsCollector } from "../src/infrastructure/metricsCollector";

const storage = {
    getSignalOutcomes: async () => [],
    getFailedSignalAnalyses: async () => [],
};

describe("analysis/PerformanceAnalyzer", () => {
    const pa = new PerformanceAnalyzer(
        new Logger(),
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
