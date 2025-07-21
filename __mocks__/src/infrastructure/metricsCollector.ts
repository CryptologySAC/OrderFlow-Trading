import { vi } from "vitest";

export class MetricsCollector {
    // Core metrics methods
    incrementMetric = vi.fn();
    updateMetric = vi.fn();
    recordHistogram = vi.fn();
    getMetrics = vi.fn().mockReturnValue({
        counters: {},
        histograms: {},
        gauges: {},
    });
    getHealthSummary = vi.fn().mockReturnValue("Healthy");

    // IMetricsCollector interface methods
    registerMetric = vi.fn();
    getHistogramPercentiles = vi.fn().mockReturnValue({
        p50: 0,
        p95: 0,
        p99: 0,
        max: 0,
        min: 0,
        mean: 0,
        stdDev: 0,
        count: 0,
    });
    getHistogramSummary = vi.fn().mockReturnValue({
        mean: 0,
        stdDev: 0,
        count: 0,
        min: 0,
        max: 0,
        p50: 0,
        p95: 0,
        p99: 0,
    });
    recordGauge = vi.fn();
    incrementCounter = vi.fn();
    setGauge = vi.fn();
    createCounter = vi.fn();
    createGauge = vi.fn();
    createHistogram = vi.fn();
    getCounterValue = vi.fn().mockReturnValue(0);
    getGaugeValue = vi.fn().mockReturnValue(0);
    resetMetrics = vi.fn();
    getMetricNames = vi.fn().mockReturnValue([]);
    deleteMetric = vi.fn();

    // Health monitoring methods
    getHealthStatus = vi.fn().mockReturnValue("healthy");
    getCriticalMetrics = vi.fn().mockReturnValue([]);
}
