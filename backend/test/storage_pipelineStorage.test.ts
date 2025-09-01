import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Database from "better-sqlite3";
import { PipelineStorage } from "../src/infrastructure/pipelineStorage";
import type { SerializableJobData } from "../src/utils/types";
import type { ILogger } from "../src/infrastructure/loggerInterface";

vi.mock("../src/infrastructure/logger");
vi.mock("../src/infrastructure/metricsCollector");

const makeJobData = (): SerializableJobData => ({
    jobId: "job1",
    detectorId: "det",
    candidate: { id: "c1", type: "test", confidence: 1, data: {} } as any,
    startTime: Date.now(),
    retryCount: 0,
    priority: 1,
});

describe("storage/PipelineStorage", () => {
    let storage: PipelineStorage;
    let mockLogger: ILogger;

    beforeEach(() => {
        mockLogger = {
            info: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
            debug: vi.fn(),
            isDebugEnabled: vi.fn(() => false),
            setCorrelationId: vi.fn(),
            removeCorrelationId: vi.fn(),
        };
        storage = new PipelineStorage(new Database(":memory:"), mockLogger);
    });
    afterEach(() => {
        storage.close();
    });

    it("queues and restores jobs", () => {
        const jobData = makeJobData();
        storage.enqueueJob(jobData);
        const dequeued = storage.dequeueJobs(1);
        expect(dequeued.length).toBe(1);
        expect(dequeued[0].candidate.id).toBe("c1");
        storage.markJobCompleted(jobData.jobId);
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
