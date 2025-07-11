import { describe, it, expect, beforeEach, vi } from "vitest";
import { AbsorptionDetectorEnhanced } from "../src/indicators/absorptionDetectorEnhanced.js";
import { Config } from "../src/core/config.js";
import { createMockLogger } from "../__mocks__/src/infrastructure/loggerInterface.js";
import mockMetricsCollector from "../__mocks__/src/infrastructure/metricsCollector.js";

describe("Debug Absorption Logger", () => {
    it("should create detector with proper logger", () => {
        const mockLogger = createMockLogger();
        console.log("Mock logger:", mockLogger);
        console.log("Mock logger info:", mockLogger.info);

        const mockPreprocessor = {
            findZonesNearPrice: vi.fn().mockReturnValue([]),
        } as any;

        const testConfig = {
            ...Config.ABSORPTION_DETECTOR_ENHANCED,
            minAggVolume: 50,
            absorptionThreshold: 0.6,
        };

        console.log("Creating detector...");
        const detector = new AbsorptionDetectorEnhanced(
            "test-absorption",
            "LTCUSDT",
            testConfig,
            mockPreprocessor,
            mockLogger,
            mockMetricsCollector
        );

        console.log("Detector created successfully");
        expect(detector).toBeDefined();
    });
});
