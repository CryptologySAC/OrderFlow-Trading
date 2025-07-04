import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../src/multithreading/workerLogger");
vi.mock("../src/infrastructure/metricsCollector");
vi.mock("../src/services/spoofingDetector");

import { DeltaCVDDetectorEnhanced } from "../src/indicators/deltaCVDDetectorEnhanced";
import { WorkerLogger } from "../src/multithreading/workerLogger";
import { MetricsCollector } from "../src/infrastructure/metricsCollector";
import { SpoofingDetector } from "../src/services/spoofingDetector";
import type { IOrderflowPreprocessor } from "../src/market/orderFlowPreprocessor.js";

const createMockPreprocessor = (): IOrderflowPreprocessor => ({
    handleDepth: vi.fn(),
    handleAggTrade: vi.fn(),
    getStats: vi.fn(() => ({
        processedTrades: 0,
        processedDepthUpdates: 0,
        bookMetrics: {} as any,
    })),
    findZonesNearPrice: vi.fn(() => []),
    calculateZoneRelevanceScore: vi.fn(() => 0.5),
    findMostRelevantZone: vi.fn(() => null),
});

describe("DeltaCVDDetectorEnhanced single window", () => {
    let detector: DeltaCVDDetectorEnhanced;
    let mockLogger: WorkerLogger;
    let mockMetrics: MetricsCollector;
    let mockSpoofing: SpoofingDetector;
    let mockPreprocessor: IOrderflowPreprocessor;

    beforeEach(() => {
        mockLogger = new WorkerLogger();
        mockMetrics = new MetricsCollector();
        mockSpoofing = new SpoofingDetector({
            tickSize: 0.01,
            wallTicks: 10,
            minWallSize: 100,
            dynamicWallWidth: true,
            testLogMinSpoof: 50,
        });
        mockPreprocessor = createMockPreprocessor();

        detector = new DeltaCVDDetectorEnhanced(
            "cvd_single_window",
            {
                windowsSec: [60],
            },
            mockPreprocessor,
            mockLogger,
            mockSpoofing,
            mockMetrics
        );
    });

    it("should produce numeric confidence with a single window", () => {
        const result = detector.simulateConfidence({ 60: 2.5 }, { 60: 0.8 });
        expect(result.finalConfidence).toBeGreaterThanOrEqual(0);
        expect(result.finalConfidence).toBeLessThanOrEqual(1);
        expect(Number.isFinite(result.finalConfidence)).toBe(true);
    });
});
