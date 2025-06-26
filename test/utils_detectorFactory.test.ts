import { describe, it, expect } from "vitest";
import { DetectorFactory } from "../src/utils/detectorFactory";

// TODO

describe("utils/DetectorFactory", () => {
    it("applies production defaults", () => {
        const result = (DetectorFactory as any).applyProductionDefaults(
            { features: { spoofingDetection: false } },
            "absorption"
        );
        // Check features that are actually set by applyProductionDefaults
        expect(result.features.adaptiveZone).toBe(true);
        expect(result.features.passiveHistory).toBe(true);
        expect(result.features.multiZone).toBe(true);
        expect(result.features.autoCalibrate).toBe(true);
        expect(result.features.liquidityGradient).toBe(true);
        expect(result.features.spoofingDetection).toBe(false); // Should preserve input
    });
});
