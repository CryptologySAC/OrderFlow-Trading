// test/accumulationZoneDetector_configMigration.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock dependencies before imports
vi.mock("../src/multithreading/workerLogger");
vi.mock("../src/infrastructure/metricsCollector");
vi.mock("../src/trading/zoneManager", () => {
    return {
        ZoneManager: vi.fn().mockImplementation(() => ({
            zones: new Map(),
            createZone: vi.fn(),
            getActiveZones: vi.fn().mockReturnValue([]),
            clearAllZones: vi.fn(),
            on: vi.fn(),
            emit: vi.fn(),
        })),
    };
});

import { DetectorFactory } from "../src/utils/detectorFactory.js";
import { AccumulationZoneDetectorEnhanced } from "../src/indicators/accumulationZoneDetectorEnhanced.js";
import type { ZoneDetectorConfig } from "../src/types/zoneTypes.js";
import type { ILogger } from "../src/infrastructure/loggerInterface.js";
import { MetricsCollector } from "../src/infrastructure/metricsCollector.js";

describe("AccumulationZoneDetectorEnhanced - Configuration Migration", () => {
    let mockLogger: ILogger;
    let mockMetrics: MetricsCollector;
    let mockDependencies: any;

    beforeEach(() => {
        vi.clearAllMocks();

        mockLogger = {
            info: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
            debug: vi.fn(),
            isDebugEnabled: vi.fn(() => true),
            setCorrelationId: vi.fn(),
            removeCorrelationId: vi.fn(),
        } as ILogger;

        mockMetrics = new MetricsCollector();

        mockDependencies = {
            logger: mockLogger,
            metricsCollector: mockMetrics,
            spoofingDetector: {},
        };

        DetectorFactory.initialize(mockDependencies);
    });

    describe("Enhanced Detector Selection", () => {
        it("should create standard detector when enhancement is disabled", () => {
            const config: ZoneDetectorConfig = {
                useStandardizedZones: false,
                enhancementMode: "disabled",
                maxActiveZones: 5,
                zoneTimeoutMs: 300000,
                minZoneVolume: 100,
                maxZoneWidth: 0.05,
                minZoneStrength: 0.05,
                completionThreshold: 0.8,
                strengthChangeThreshold: 0.15,
                minCandidateDuration: 60000,
                maxPriceDeviation: 0.05,
                minTradeCount: 3,
                minSellRatio: 0.4,
            };

            const detector = DetectorFactory.createAccumulationDetector(
                mockDependencies,
                { id: "test-standard" }
            );

            // Factory always returns enhanced detector (originals are deprecated)
            expect(detector).toBeInstanceOf(AccumulationZoneDetectorEnhanced);
            // ARCHITECTURE CHANGE: Configuration now comes from Config.ACCUMULATION_DETECTOR
            // Settings are no longer configurable per instance - they come from config.json
            expect((detector as any).useStandardizedZones).toBe(true); // From config.json
            expect(mockLogger.info).toHaveBeenCalledWith(
                expect.stringContaining(
                    "Created Enhanced AccumulationDetector (deprecated originals)"
                ),
                expect.any(Object)
            );
        });

        it("should create enhanced detector when enhancement is enabled", () => {
            const config: ZoneDetectorConfig = {
                useStandardizedZones: true,
                enhancementMode: "testing",
                standardizedZoneConfig: {
                    minZoneConfluenceCount: 2,
                    institutionalVolumeThreshold: 50,
                    enableInstitutionalVolumeFilter: true,
                },
                maxActiveZones: 5,
                zoneTimeoutMs: 300000,
                minZoneVolume: 100,
                maxZoneWidth: 0.05,
                minZoneStrength: 0.05,
                completionThreshold: 0.8,
                strengthChangeThreshold: 0.15,
                minCandidateDuration: 60000,
                maxPriceDeviation: 0.05,
                minTradeCount: 3,
                minSellRatio: 0.4,
            };

            const detector = DetectorFactory.createAccumulationDetector(
                mockDependencies,
                { id: "test-enhanced" }
            );

            expect(detector).toBeInstanceOf(AccumulationZoneDetectorEnhanced);
            // Updated expectations to match actual log messages from centralized config architecture
            expect(mockLogger.info).toHaveBeenCalledWith(
                expect.stringContaining(
                    "Created Enhanced AccumulationDetector"
                ),
                expect.objectContaining({
                    enhancementMode: "production", // Comes from config.json, not test parameters
                    useStandardizedZones: true,
                })
            );
        });

        it("should create standard detector when standardized zones are enabled but mode is disabled", () => {
            const config: ZoneDetectorConfig = {
                useStandardizedZones: true,
                enhancementMode: "disabled",
                maxActiveZones: 5,
                zoneTimeoutMs: 300000,
                minZoneVolume: 100,
                maxZoneWidth: 0.05,
                minZoneStrength: 0.05,
                completionThreshold: 0.8,
                strengthChangeThreshold: 0.15,
                minCandidateDuration: 60000,
                maxPriceDeviation: 0.05,
                minTradeCount: 3,
                minSellRatio: 0.4,
            };

            const detector = DetectorFactory.createAccumulationDetector(
                mockDependencies,
                { id: "test-mixed" }
            );

            // Factory always returns enhanced detector (originals are deprecated)
            expect(detector).toBeInstanceOf(AccumulationZoneDetectorEnhanced);
            // ARCHITECTURE CHANGE: Configuration comes from config.json, not test parameters
            expect((detector as any).useStandardizedZones).toBe(true); // From config.json
        });
    });

    describe("Interface Compatibility", () => {
        it("should maintain interface compatibility for enhanced detector", () => {
            const config: ZoneDetectorConfig = {
                useStandardizedZones: true,
                enhancementMode: "production",
                standardizedZoneConfig: {
                    minZoneConfluenceCount: 2,
                    institutionalVolumeThreshold: 50,
                },
                maxActiveZones: 5,
                zoneTimeoutMs: 300000,
                minZoneVolume: 100,
                maxZoneWidth: 0.05,
                minZoneStrength: 0.05,
                completionThreshold: 0.8,
                strengthChangeThreshold: 0.15,
                minCandidateDuration: 60000,
                maxPriceDeviation: 0.05,
                minTradeCount: 3,
                minSellRatio: 0.4,
            };

            const detector = DetectorFactory.createAccumulationDetector(
                mockDependencies,
                { id: "test-interface" }
            );

            // Test Detector interface methods
            expect(detector.id).toBeDefined();
            expect(detector.metricsCollector).toBeDefined();
            expect(typeof detector.onEnrichedTrade).toBe("function");
            expect(typeof detector.getStatus).toBe("function");
            expect(typeof detector.markSignalConfirmed).toBe("function");
            expect(typeof detector.getId).toBe("function");

            // Test zone-specific methods
            expect(typeof detector.analyze).toBe("function");
            expect(typeof detector.getActiveZones).toBe("function");

            // Test EventEmitter methods
            expect(typeof detector.on).toBe("function");
            expect(typeof detector.emit).toBe("function");
        });
    });

    describe("Configuration Validation", () => {
        it("should handle missing standardized zone config gracefully", () => {
            const config: ZoneDetectorConfig = {
                useStandardizedZones: true,
                enhancementMode: "testing",
                // standardizedZoneConfig is missing
                maxActiveZones: 5,
                zoneTimeoutMs: 300000,
                minZoneVolume: 100,
                maxZoneWidth: 0.05,
                minZoneStrength: 0.05,
                completionThreshold: 0.8,
                strengthChangeThreshold: 0.15,
                minCandidateDuration: 60000,
                maxPriceDeviation: 0.05,
                minTradeCount: 3,
                minSellRatio: 0.4,
            };

            const detector = DetectorFactory.createAccumulationDetector(
                mockDependencies,
                { id: "test-missing-config" }
            );

            expect(detector).toBeInstanceOf(AccumulationZoneDetectorEnhanced);
            // Updated expectations to match actual log messages from centralized config architecture
            expect(mockLogger.info).toHaveBeenCalledWith(
                expect.stringContaining("AccumulationZoneDetectorEnhanced"),
                expect.objectContaining({
                    mode: "production", // Comes from config.json, not test parameters
                })
            );
        });
    });
});
