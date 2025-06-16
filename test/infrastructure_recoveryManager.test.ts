import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the WorkerLogger before importing
vi.mock("../src/multithreading/workerLogger");

import { RecoveryManager } from "../src/infrastructure/recoveryManager";
import { WorkerLogger } from "../src/multithreading/workerLogger";
import { MetricsCollector } from "../src/infrastructure/metricsCollector";

const event = { reason: "test", component: "unit", attempts: 0, timestamp: 0 };

describe("infrastructure/RecoveryManager", () => {
    let rm: RecoveryManager;
    beforeEach(() => {
        rm = new RecoveryManager(
            {
                enableHardReload: true,
                hardReloadCooldownMs: 1000,
                maxHardReloads: 2,
                hardReloadRestartCommand: "echo",
            },
            new WorkerLogger(),
            new MetricsCollector()
        );
        vi.spyOn(rm as any, "executeHardReload").mockResolvedValue();
    });
    it("rejects when disabled", () => {
        const disabled = new RecoveryManager(
            {
                enableHardReload: false,
                hardReloadCooldownMs: 1000,
                maxHardReloads: 1,
                hardReloadRestartCommand: "echo",
            },
            new WorkerLogger(),
            new MetricsCollector()
        );
        expect(disabled.requestHardReload(event)).toBe(false);
    });
    it("limits by cooldown", () => {
        expect(rm.requestHardReload(event)).toBe(true);
        expect(rm.requestHardReload(event)).toBe(false);
    });
    it("resets counters", () => {
        rm.resetHardReloadCount();
        expect(rm.getStats().hardReloadCount).toBe(0);
    });
});
