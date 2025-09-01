import { describe, it, expect, vi } from "vitest";

// Mock the WorkerLogger before importing
vi.mock("../src/utils/binance");
vi.mock("../src/multithreading/workerLogger");
vi.mock("../src/infrastructure/metricsCollector");

import { DataStreamManager } from "../src/trading/dataStreamManager";
import { BinanceDataFeed } from "../src/utils/binance";
import { CircuitBreaker } from "../src/infrastructure/circuitBreaker";
import { WorkerLogger } from "../src/multithreading/workerLogger";
import { MetricsCollector } from "../src/infrastructure/metricsCollector";

describe("trading/DataStreamManager", () => {
    it("connects and disconnects", async () => {
        const manager = new DataStreamManager(
            {
                symbol: "T",
                enableHeartbeat: false,
                enableStreamHealthCheck: false,
            },
            new BinanceDataFeed(),
            new CircuitBreaker(5, 1000, new WorkerLogger()),
            new WorkerLogger(),
            new MetricsCollector()
        );
        await manager.connect();
        expect(manager.getStatus().isConnected).toBe(true);
        await manager.disconnect();
        expect(manager.getStatus().isConnected).toBe(false);
    });
});
