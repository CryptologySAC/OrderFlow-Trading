import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { PipelineStorage } from "../src/infrastructure/pipelineStorage";
import type { ProcessingJob } from "../src/utils/types";

vi.mock("../src/infrastructure/logger");
vi.mock("../src/infrastructure/metricsCollector");

const stubDetector = { getId: () => "det" } as any;

const makeJob = (): ProcessingJob => ({
    id: "job1",
    detector: stubDetector,
    candidate: { id: "c1", type: "test", confidence: 1, data: {} } as any,
    startTime: Date.now(),
    retryCount: 0,
    priority: 1,
});

describe("storage/PipelineStorage", () => {
    let storage: PipelineStorage;
    beforeEach(() => {
        storage = new PipelineStorage(new Database(":memory:"));
    });
    afterEach(() => {
        storage.close();
    });

    it("queues and restores jobs", () => {
        const job = makeJob();
        storage.enqueueJob(job);
        const dequeued = storage.dequeueJobs(1);
        expect(dequeued.length).toBe(1);
        expect(dequeued[0].candidate.id).toBe("c1");
        storage.markJobCompleted(job.id);
    });

    it("persists active anomalies", () => {
        const anomaly = {
            type: "test",
            detectedAt: Date.now(),
            severity: "high",
            affectedPriceRange: { min: 1, max: 2 },
            recommendedAction: "watch",
        };
        storage.saveActiveAnomaly(anomaly as any);
        const list = storage.getActiveAnomalies();
        expect(list.length).toBe(1);
        storage.removeActiveAnomaly("test");
        expect(storage.getActiveAnomalies().length).toBe(0);
    });
});
