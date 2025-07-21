import { describe, it, expect, vi } from "vitest";

// Mock the WorkerLogger before importing
vi.mock("../src/multithreading/workerLogger");

import { MarketContextCollector } from "../src/analysis/marketContextCollector";
import { WorkerLogger } from "../src/multithreading/workerLogger";
import { MetricsCollector } from "../src/infrastructure/metricsCollector";

describe("analysis/MarketContextCollector", () => {
    it("returns empty metrics when no data", () => {
        const mcc = new MarketContextCollector(
            new WorkerLogger(),
            new MetricsCollector()
        );
        const metrics = mcc.calculateMarketMetrics();
        expect(metrics.currentPrice).toBe(0);
        expect(metrics.volume24h).toBe(0);
    });
});
