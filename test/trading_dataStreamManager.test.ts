import { describe, it, expect } from "vitest";
import { DataStreamManager } from "../src/trading/dataStreamManager";
import { BinanceDataFeed } from "../src/utils/binance";
import { CircuitBreaker } from "../src/infrastructure/circuitBreaker";
import { Logger } from "../src/infrastructure/logger";
import { MetricsCollector } from "../src/infrastructure/metricsCollector";

vi.mock("../src/utils/binance");
vi.mock("../src/infrastructure/logger");
vi.mock("../src/infrastructure/metricsCollector");

describe("trading/DataStreamManager", () => {
    it("connects and disconnects", async () => {
        const manager = new DataStreamManager(
            {
                symbol: "T",
                enableHeartbeat: false,
                enableStreamHealthCheck: false,
            },
            new BinanceDataFeed(),
            new CircuitBreaker(5, 1000, new Logger()),
            new Logger(),
            new MetricsCollector()
        );
        await manager.connect();
        expect(manager.getStatus().isConnected).toBe(true);
        await manager.disconnect();
        expect(manager.getStatus().isConnected).toBe(false);
    });
});
