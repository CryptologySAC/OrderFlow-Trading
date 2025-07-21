import { describe, it, expect, vi } from "vitest";

// Mock the WorkerLogger before importing
vi.mock("../src/multithreading/workerLogger");
vi.mock("../src/infrastructure/metricsCollector");

import { ProductionUtils } from "../src/utils/productionUtils";
import { CircuitBreaker } from "../src/infrastructure/circuitBreaker";
import { WorkerLogger } from "../src/multithreading/workerLogger";
import { MetricsCollector } from "../src/infrastructure/metricsCollector";

describe("utils/productionUtils", () => {
    it("creates circuit breaker", () => {
        const logger = new WorkerLogger();
        const cb = ProductionUtils.createCircuitBreaker(1, 1000, logger);
        expect(cb).toBeInstanceOf(CircuitBreaker);
    });

    it("measures performance and records metric", () => {
        const metrics = new MetricsCollector();
        const result = ProductionUtils.measurePerformance(
            () => 5,
            metrics,
            "op"
        );
        expect(result).toBe(5);
        expect(metrics.recordHistogram).toHaveBeenCalled();
    });

    it("validates config and throws", () => {
        expect(() =>
            ProductionUtils.validateProductionConfig({} as any)
        ).toThrow();
    });

    it("getMemoryUsage returns number", () => {
        expect(typeof ProductionUtils.getMemoryUsage()).toBe("number");
    });
});
