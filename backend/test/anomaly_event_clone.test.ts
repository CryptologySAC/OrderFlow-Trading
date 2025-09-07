import { describe, it, expect, vi } from "vitest";

vi.mock("../src/multithreading/workerLogger");

import { AnomalyDetector } from "../src/services/anomalyDetector";
import { WorkerLogger } from "../src/multithreading/workerLogger";

// Basic test to ensure emitted anomaly events preserve all fields

describe("AnomalyDetector event payload", () => {
    it("emits deep cloned anomalies", () => {
        const detector: any = new AnomalyDetector({}, new WorkerLogger());
        const anomaly = {
            type: "flash_crash",
            detectedAt: Date.now(),
            severity: "high",
            affectedPriceRange: { min: 1, max: 2 },
            recommendedAction: "pause",
            details: { nested: { value: 42 } },
        } as any;

        const received: any[] = [];
        detector.on("anomaly", (ev: any) => received.push(ev));
        (detector as any).emitAnomaly(anomaly);

        expect(received).toHaveLength(1);
        // Should be a deep clone preserving all fields
        expect(received[0]).toEqual(anomaly);
        expect(received[0]).not.toBe(anomaly);
    });
});
