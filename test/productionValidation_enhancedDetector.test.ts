// test/productionValidation_enhancedDetector.test.ts
/**
 * Production validation test for enhanced AccumulationZoneDetector deployment
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { DetectorFactory } from "../src/utils/detectorFactory.js";
import { AccumulationZoneDetectorEnhanced } from "../src/indicators/accumulationZoneDetectorEnhanced.js";
import { Config } from "../src/core/config.js";

// Mock dependencies - Complete ILogger interface
const mockLogger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    isDebugEnabled: vi.fn(() => false),
    setCorrelationId: vi.fn(),
    removeCorrelationId: vi.fn(),
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
            const detector = DetectorFactory.createAccumulationDetector({
                logger: mockLogger,
                spoofingDetector: mockSpoofingDetector,
                metricsCollector: mockMetricsCollector,
                signalLogger: mockSignalLogger,
            });

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
            const config = Config.ACCUMULATION_DETECTOR;

            // Verify production configuration is correctly set
            expect(config.useStandardizedZones).toBe(true);
            expect(config.enhancementMode).toBe("production");
            expect(config.minEnhancedConfidenceThreshold).toBeDefined();
            expect(config.enhancementMode).toBeDefined();
            expect(config.useStandardizedZones).toBeDefined();
        });

        it("should log info about enhanced detector creation", () => {
            DetectorFactory.createAccumulationDetector({
                logger: mockLogger,
                spoofingDetector: mockSpoofingDetector,
                metricsCollector: mockMetricsCollector,
                signalLogger: mockSignalLogger,
            });

            // Should log info about enhanced detector creation
            expect(mockLogger.info).toHaveBeenCalledWith(
                expect.stringContaining("Enhanced AccumulationDetector"),
                expect.objectContaining({
                    id: expect.any(String),
                    enhancementMode: expect.any(String),
                })
            );
        });
    });

    describe("Enhancement Configuration Validation", () => {
        it("should validate accumulation detector configuration parameters", () => {
            const config = Config.ACCUMULATION_DETECTOR;

            expect(config).toBeDefined();

            // Core accumulation parameters
            expect(config.useStandardizedZones).toBeDefined();
            expect(config.enhancementMode).toBeDefined();
            expect(config.minEnhancedConfidenceThreshold).toBeDefined();
            expect(config.minDurationMs).toBeGreaterThan(0);
            expect(config.threshold).toBeGreaterThan(0);
            expect(config.volumeSurgeMultiplier).toBeGreaterThan(1);
        });

        it("should have proper enhancement thresholds", () => {
            const config = Config.ACCUMULATION_DETECTOR;

            expect(config.minEnhancedConfidenceThreshold).toBeDefined();
            expect(config.minEnhancedConfidenceThreshold).toBeGreaterThan(0);
            expect(config.minEnhancedConfidenceThreshold).toBeLessThanOrEqual(
                1
            );

            expect(config.enhancementCallFrequency).toBeDefined();
        });
    });

    describe("Production Readiness Validation", () => {
        it("should verify enhanced detector API compatibility", () => {
            const detector = DetectorFactory.createAccumulationDetector({
                logger: mockLogger,
                spoofingDetector: mockSpoofingDetector,
                metricsCollector: mockMetricsCollector,
                signalLogger: mockSignalLogger,
            });

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
            const detector = DetectorFactory.createAccumulationDetector({
                logger: mockLogger,
                spoofingDetector: mockSpoofingDetector,
                metricsCollector: mockMetricsCollector,
                signalLogger: mockSignalLogger,
            }) as AccumulationZoneDetectorEnhanced;

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
            const config = Config.ACCUMULATION_DETECTOR;

            // Basic accumulation detector configuration
            expect(config).toHaveProperty("minDurationMs");
            expect(config).toHaveProperty("minRatio");
            expect(config).toHaveProperty("threshold");
            expect(config).toHaveProperty("useStandardizedZones");

            // Enhancement configuration
            expect(config).toHaveProperty("minEnhancedConfidenceThreshold");
            expect(config).toHaveProperty("enhancementCallFrequency");
        });

        it("should validate performance-optimized defaults", () => {
            const config = Config.ACCUMULATION_DETECTOR;

            // Performance optimizations should be properly configured
            expect(config.enhancementMode).toBeDefined();
            expect(config.useStandardizedZones).toBeDefined();
            expect(config.minEnhancedConfidenceThreshold).toBeGreaterThan(0);
            expect(config.enhancementCallFrequency).toBeGreaterThan(0);
        });
    });
});
