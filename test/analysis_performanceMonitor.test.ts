import { describe, it, expect, beforeEach, vi } from "vitest";
import { PerformanceMonitor } from "../src/analysis/performanceMonitor";
import { Logger } from "../src/infrastructure/logger";
import { MetricsCollector } from "../src/infrastructure/metricsCollector";
import { AlertManager } from "../src/alerts/alertManager";

const signalTracker = {
    getStatus: () => ({ total: 0 }),
};
const performanceAnalyzer = {
    analyzeOverallPerformance: vi
        .fn()
        .mockResolvedValue({
            totalSignals: 0,
            generatedAt: Date.now(),
            confidenceBands: {},
            signalTypePerformance: {},
            detectorPerformance: {},
            performanceByTimeOfDay: new Map(),
            performanceByDayOfWeek: new Map(),
            recentPerformanceTrend: "stable",
            performanceChangeRate: 0,
            maxDrawdown: 0,
            avgDrawdown: 0,
            volatilityOfReturns: 0,
            winRate: 0,
            profitFactor: 0,
            avgTimeToSuccess: 0,
            avgTimeToFailure: 0,
            signalFrequency: 0,
            overallSuccessRate: 0,
            avgReturnPerSignal: 0,
            sharpeRatio: 0,
            timeWindow: 0,
        }),
};
const failureAnalyzer = {
    detectFailurePatterns: vi
        .fn()
        .mockResolvedValue({
            commonFailureReasons: [],
            failureClusters: [],
            temporalPatterns: {
                byTimeOfDay: new Map(),
                byDayOfWeek: new Map(),
                byMarketSession: new Map(),
                seasonalTrends: [],
            },
            marketConditionPatterns: {
                byVolatility: new Map(),
                byVolume: new Map(),
                byRegime: new Map(),
                byTrendAlignment: new Map(),
            },
            detectorFailurePatterns: new Map(),
            signalTypeFailurePatterns: new Map(),
        }),
};

const alertManager = new AlertManager(new Logger(), new MetricsCollector());

describe("analysis/PerformanceMonitor", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });
    afterEach(() => {
        vi.useRealTimers();
    });
    it("reports monitoring status", () => {
        const pm = new PerformanceMonitor(
            signalTracker as any,
            performanceAnalyzer as any,
            failureAnalyzer as any,
            alertManager,
            new Logger(),
            new MetricsCollector()
        );
        expect(pm.getStatus().isMonitoring).toBe(false);
        pm.startMonitoring();
        expect(pm.getStatus().isMonitoring).toBe(true);
        pm.stopMonitoring();
        expect(pm.getStatus().isMonitoring).toBe(false);
    });
});
