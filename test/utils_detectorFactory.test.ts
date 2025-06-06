import { describe, it, expect } from "vitest";
import { DetectorFactory } from "../src/utils/detectorFactory";

describe("utils/DetectorFactory", () => {
    it("applies production defaults", () => {
        const result = (DetectorFactory as any).applyProductionDefaults(
            { features: { spoofingDetection: false } },
            "absorption"
        );
        expect(result.features.icebergDetection).toBe(true);
        expect(result.features.spoofingDetection).toBe(false);
    });
});
