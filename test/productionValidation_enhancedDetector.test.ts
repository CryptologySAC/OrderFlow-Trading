// test/productionValidation_enhancedDetector.test.ts
/**
 * Production validation test for enhanced AccumulationZoneDetector deployment
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { DetectorFactory } from "../src/utils/detectorFactory.js";
import { AccumulationZoneDetectorEnhanced } from "../src/indicators/accumulationZoneDetectorEnhanced.js";
import { Config } from "../src/core/config.js";

// Mock dependencies
const mockLogger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
};

const mockMetricsCollector = {
    incrementMetric: vi.fn(),
    updateMetric: vi.fn(),
    recordGauge: vi.fn(),
    recordHistogram: vi.fn(),
    recordTimer: vi.fn(),
    startTimer: vi.fn(() => ({ stop: vi.fn() })),
    getMetrics: vi.fn(() => ({})),
};

const mockSpoofingDetector = {
    detect: vi.fn(() => ({ spoofing: false, confidence: 0 })),
    updateMarketData: vi.fn(),
};

const mockSignalLogger = {
    logSignal: vi.fn(),
    getHistory: vi.fn(() => []),
};

describe("Production Validation - Enhanced AccumulationZoneDetector", () => {
    beforeEach(() => {
        vi.clearAllMocks();

        // Initialize detector factory
        DetectorFactory.initialize({
            logger: mockLogger,
            spoofingDetector: mockSpoofingDetector,
            metricsCollector: mockMetricsCollector,
            signalLogger: mockSignalLogger,
        });
    });

    describe("Enhanced Detector Creation", () => {
        it("should create enhanced detector when standardized zones are enabled", () => {
            const config = {
                ...Config.ACCUMULATION_ZONE_DETECTOR,
                useStandardizedZones: true,
                enhancementMode: "production" as const,
            };

            const detector = DetectorFactory.createAccumulationDetector(
                config,
                {
                    logger: mockLogger,
                    spoofingDetector: mockSpoofingDetector,
                    metricsCollector: mockMetricsCollector,
                    signalLogger: mockSignalLogger,
                }
            );

            // Should create enhanced detector
            expect(detector).toBeInstanceOf(AccumulationZoneDetectorEnhanced);

            // Enhanced detector should have enhancement stats
            if (detector instanceof AccumulationZoneDetectorEnhanced) {
                const stats = detector.getEnhancementStats();
                expect(stats.enabled).toBe(true);
                expect(stats.mode).toBe("production");
            }
        });

        it("should validate production configuration", () => {
            const config = Config.ACCUMULATION_ZONE_DETECTOR;

            // Verify production configuration is correctly set
            expect(config.useStandardizedZones).toBe(true);
            expect(config.enhancementMode).toBe("production");
            expect(config.standardizedZoneConfig).toBeDefined();
            expect(config.standardizedZoneConfig?.minZoneConfluenceCount).toBe(
                2
            );
            expect(
                config.standardizedZoneConfig?.institutionalVolumeThreshold
            ).toBe(50);

            // Verify performance-optimized settings
            expect(
                config.standardizedZoneConfig?.enableInstitutionalVolumeFilter
            ).toBe(false);
            expect(
                config.standardizedZoneConfig?.enableCrossTimeframeAnalysis
            ).toBe(false);
        });

        it("should log deprecation warning when using original detector", () => {
            const config = {
                ...Config.ACCUMULATION_ZONE_DETECTOR,
                useStandardizedZones: false,
                enhancementMode: "disabled" as const,
            };

            DetectorFactory.createAccumulationDetector(config, {
                logger: mockLogger,
                spoofingDetector: mockSpoofingDetector,
                metricsCollector: mockMetricsCollector,
                signalLogger: mockSignalLogger,
            });

            // Should log deprecation warning
            expect(mockLogger.warn).toHaveBeenCalledWith(
                expect.stringContaining("DEPRECATED"),
                expect.objectContaining({
                    detector: "AccumulationZoneDetector",
                    replacement: "AccumulationZoneDetectorEnhanced",
                })
            );
        });
    });

    describe("Enhancement Configuration Validation", () => {
        it("should validate standardized zone configuration parameters", () => {
            const config =
                Config.ACCUMULATION_ZONE_DETECTOR.standardizedZoneConfig;

            expect(config).toBeDefined();
            if (config) {
                // Zone confluence settings
                expect(config.minZoneConfluenceCount).toBeGreaterThanOrEqual(1);
                expect(config.maxZoneConfluenceDistance).toBeGreaterThanOrEqual(
                    1
                );

                // Volume thresholds
                expect(config.institutionalVolumeThreshold).toBeGreaterThan(0);
                expect(config.passiveVolumeRatioThreshold).toBeGreaterThan(0);

                // Feature flags (performance optimized)
                expect(config.enableZoneConfluenceFilter).toBe(true);
                expect(config.enableInstitutionalVolumeFilter).toBe(false); // Disabled for performance
                expect(config.enableCrossTimeframeAnalysis).toBe(false); // Disabled for performance

                // Confidence boosts (optimized values)
                expect(config.confluenceConfidenceBoost).toBeLessThanOrEqual(
                    0.2
                );
                expect(config.institutionalVolumeBoost).toBeLessThanOrEqual(
                    0.15
                );
                expect(config.crossTimeframeBoost).toBeLessThanOrEqual(0.1);
            }
        });

        it("should have proper enhancement thresholds", () => {
            const config = Config.ACCUMULATION_ZONE_DETECTOR;

            expect(config.minEnhancedConfidenceThreshold).toBeDefined();
            expect(config.minEnhancedConfidenceThreshold).toBeGreaterThan(0);
            expect(config.minEnhancedConfidenceThreshold).toBeLessThanOrEqual(
                1
            );

            expect(config.enhancementSignificanceBoost).toBeDefined();
        });
    });

    describe("Production Readiness Validation", () => {
        it("should verify enhanced detector API compatibility", () => {
            const config = {
                ...Config.ACCUMULATION_ZONE_DETECTOR,
                useStandardizedZones: true,
                enhancementMode: "production" as const,
            };

            const detector = DetectorFactory.createAccumulationDetector(
                config,
                {
                    logger: mockLogger,
                    spoofingDetector: mockSpoofingDetector,
                    metricsCollector: mockMetricsCollector,
                    signalLogger: mockSignalLogger,
                }
            );

            // Should implement all required methods
            expect(typeof detector.analyze).toBe("function");
            expect(typeof detector.getActiveZones).toBe("function");
            expect(typeof detector.onEnrichedTrade).toBe("function");
            expect(typeof detector.getStatus).toBe("function");
            expect(typeof detector.markSignalConfirmed).toBe("function");
            expect(typeof detector.getId).toBe("function");

            // Enhanced detector specific methods
            if (detector instanceof AccumulationZoneDetectorEnhanced) {
                expect(typeof detector.getEnhancementStats).toBe("function");
                expect(typeof detector.setEnhancementMode).toBe("function");
            }
        });

        it("should validate monitoring capabilities", () => {
            const config = {
                ...Config.ACCUMULATION_ZONE_DETECTOR,
                useStandardizedZones: true,
                enhancementMode: "production" as const,
            };

            const detector = DetectorFactory.createAccumulationDetector(
                config,
                {
                    logger: mockLogger,
                    spoofingDetector: mockSpoofingDetector,
                    metricsCollector: mockMetricsCollector,
                    signalLogger: mockSignalLogger,
                }
            ) as AccumulationZoneDetectorEnhanced;

            const stats = detector.getEnhancementStats();

            // Should provide comprehensive monitoring data
            expect(stats).toHaveProperty("enabled");
            expect(stats).toHaveProperty("mode");
            expect(stats).toHaveProperty("callCount");
            expect(stats).toHaveProperty("successCount");
            expect(stats).toHaveProperty("errorCount");
            expect(stats).toHaveProperty("successRate");

            expect(typeof stats.enabled).toBe("boolean");
            expect(typeof stats.mode).toBe("string");
            expect(typeof stats.callCount).toBe("number");
            expect(typeof stats.successCount).toBe("number");
            expect(typeof stats.errorCount).toBe("number");
            expect(typeof stats.successRate).toBe("number");
        });
    });

    describe("Configuration Migration Validation", () => {
        it("should ensure proper configuration structure", () => {
            const config = Config.ACCUMULATION_ZONE_DETECTOR;

            // Basic zone detector configuration
            expect(config).toHaveProperty("symbol");
            expect(config).toHaveProperty("minDurationMs");
            expect(config).toHaveProperty("minRatio");
            expect(config).toHaveProperty("threshold");

            // Standardized zone configuration
            expect(config).toHaveProperty("useStandardizedZones");
            expect(config).toHaveProperty("enhancementMode");
            expect(config).toHaveProperty("standardizedZoneConfig");

            // Enhancement configuration
            expect(config).toHaveProperty("minEnhancedConfidenceThreshold");
            expect(config).toHaveProperty("enhancementSignificanceBoost");
        });

        it("should validate performance-optimized defaults", () => {
            const standardConfig =
                Config.ACCUMULATION_ZONE_DETECTOR.standardizedZoneConfig;

            if (standardConfig) {
                // Performance optimizations should be enabled
                expect(standardConfig.enableInstitutionalVolumeFilter).toBe(
                    false
                );
                expect(standardConfig.enableCrossTimeframeAnalysis).toBe(false);

                // Conservative confidence boosts for production
                expect(
                    standardConfig.confluenceConfidenceBoost
                ).toBeLessThanOrEqual(0.2);
                expect(
                    standardConfig.institutionalVolumeBoost
                ).toBeLessThanOrEqual(0.15);
                expect(standardConfig.crossTimeframeBoost).toBeLessThanOrEqual(
                    0.1
                );
            }
        });
    });
});
