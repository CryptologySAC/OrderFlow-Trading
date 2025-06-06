import { describe, it, expect } from "vitest";
import { FailureAnalyzer } from "../src/analysis/failureAnalyzer";
import { Logger } from "../src/infrastructure/logger";
import { MetricsCollector } from "../src/infrastructure/metricsCollector";

const storage = {
    getFailedSignalAnalyses: async () => [],
};

describe("analysis/FailureAnalyzer", () => {
    const fa = new FailureAnalyzer(
        new Logger(),
        new MetricsCollector(),
        storage as any
    );
    it("provides empty failure patterns", () => {
        const empty = (fa as any).createEmptyFailurePatterns();
        expect(empty.commonFailureReasons.length).toBe(0);
        expect(empty.detectorFailurePatterns.size).toBe(0);
    });
});
