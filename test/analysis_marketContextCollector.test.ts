import { describe, it, expect } from "vitest";
import { MarketContextCollector } from "../src/analysis/marketContextCollector";
import { Logger } from "../src/infrastructure/logger";
import { MetricsCollector } from "../src/infrastructure/metricsCollector";

describe("analysis/MarketContextCollector", () => {
    it("returns empty metrics when no data", () => {
        const mcc = new MarketContextCollector(
            new Logger(),
            new MetricsCollector()
        );
        const metrics = mcc.calculateMarketMetrics();
        expect(metrics.currentPrice).toBe(0);
        expect(metrics.volume24h).toBe(0);
    });
});
