import { describe, it, expect, vi } from "vitest";
import { DetectorFactory } from "../src/utils/detectorFactory";

describe("utils/DetectorFactory", () => {
    it("provides available detector types", () => {
        // Test the actual method that exists
        const availableDetectors = DetectorFactory.getAvailableDetectors();

        // Should include enhanced detectors
        expect(availableDetectors.length).toBeGreaterThan(0);

        const detectorTypes = availableDetectors.map((d) => d.type);
        expect(detectorTypes).toContain("absorption");
        expect(detectorTypes).toContain("exhaustion");
        expect(detectorTypes).toContain("accumulation");
        expect(detectorTypes).toContain("distribution");
    });

    it("can be initialized with dependencies", () => {
        // Test factory initialization
        const mockDeps = {
            logger: {
                info: vi.fn(),
                warn: vi.fn(),
                error: vi.fn(),
                debug: vi.fn(),
            } as any,
            spoofingDetector: {} as any,
            metricsCollector: { incrementMetric: vi.fn() } as any,
            signalLogger: { logSignal: vi.fn() } as any,
        };

        expect(() => DetectorFactory.initialize(mockDeps)).not.toThrow();
    });
});
