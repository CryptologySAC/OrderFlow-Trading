import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import MetricsCollector from "../src/infrastructure/metricsCollector";

describe("infrastructure/metricsCollector", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });
    afterEach(() => {
        vi.useRealTimers();
    });
    it("records histograms and calculates summary", () => {
        const m = new MetricsCollector();
        m.recordHistogram("latency", 100);
        m.recordHistogram("latency", 200);
        const summary = m.getHistogramSummary("latency");
        expect(summary?.count).toBe(2);
        expect(summary?.max).toBe(200);
    });

    it("handles gauges and counters", () => {
        const m = new MetricsCollector();
        m.recordGauge("connections_active", 2);
        expect(m.getGaugeValue("connections_active")).toBe(2);
        m.incrementCounter("errors_total", 3);
        vi.advanceTimersByTime(5000);
        (m as any).calculateRates();
        expect(m.getCounterRate("errors_total")).toBeGreaterThan(0);
    });

    it("exports prometheus format", () => {
        const m = new MetricsCollector();
        m.recordGauge("connections_active", 1);
        const text = m.exportPrometheus();
        expect(text).toContain("connections_active");
    });
});
