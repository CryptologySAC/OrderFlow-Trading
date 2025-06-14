import { vi } from "vitest";

export class MetricsCollector {
    incrementMetric = vi.fn();
    updateMetric = vi.fn();
    recordHistogram = vi.fn();
    getMetrics = vi.fn().mockReturnValue({
        counters: {},
        histograms: {},
        gauges: {}
    });
    getHealthSummary = vi.fn().mockReturnValue("Healthy");
    
    // Additional methods used by SignalManager
    incrementCounter = vi.fn();
    setGauge = vi.fn();
    createCounter = vi.fn();
    createGauge = vi.fn();
    createHistogram = vi.fn();
}