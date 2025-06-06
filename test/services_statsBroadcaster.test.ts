import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { StatsBroadcaster } from "../src/services/statsBroadcaster";
import { MetricsCollector } from "../src/infrastructure/metricsCollector";
import { Logger } from "../src/infrastructure/logger";
import { Config } from "../src/core/config";

vi.mock("../src/core/config", async () => {
    const actual =
        await vi.importActual<typeof import("../src/core/config")>(
            "../src/core/config"
        );
    return { Config: { ...actual.Config, MQTT: undefined } };
});

describe("services/StatsBroadcaster", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });
    afterEach(() => {
        vi.useRealTimers();
    });
    it("broadcasts stats periodically", () => {
        const metrics = new MetricsCollector();
        const dataStream = { getDetailedMetrics: vi.fn().mockReturnValue({}) };
        const wsManager = { broadcast: vi.fn() };
        const sb = new StatsBroadcaster(
            metrics,
            dataStream as any,
            wsManager as any,
            new Logger()
        );
        sb.start();
        vi.advanceTimersByTime(10);
        expect(wsManager.broadcast).toHaveBeenCalled();
        sb.stop();
    });
});
