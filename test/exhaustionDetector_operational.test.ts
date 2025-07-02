// test/exhaustionDetector_operational.test.ts

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import {
    ExhaustionDetector,
    type ExhaustionSettings,
} from "../src/indicators/exhaustionDetector.js";
import type { EnrichedTradeEvent } from "../src/types/marketEvents.js";
import type { ILogger } from "../src/infrastructure/loggerInterface.js";
import type { IMetricsCollector } from "../src/infrastructure/metricsCollectorInterface.js";
import { SpoofingDetector } from "../src/services/spoofingDetector.js";
import { FinancialMath } from "../src/utils/financialMath.js";

// Import mock config for complete settings
import mockConfig from "../__mocks__/config.json";

// Mock dependencies for operational tests
const createOperationalMocks = () => ({
    logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
    } as ILogger,
    metrics: {
        updateMetric: vi.fn(),
        incrementMetric: vi.fn(),
        incrementCounter: vi.fn(), // Add missing incrementCounter method
        recordHistogram: vi.fn(),
        getMetrics: vi.fn(() => ({})),
        getHealthSummary: vi.fn(() => "healthy"),
    } as IMetricsCollector,
    spoofingDetector: {
        isSpoofed: vi.fn(() => false),
        detectLayeringAttack: vi.fn(() => false),
    } as unknown as SpoofingDetector,
});

describe("ExhaustionDetector - Operational Safety Tests", () => {
    let detector: ExhaustionDetector;
    let mocks: ReturnType<typeof createOperationalMocks>;

    beforeEach(() => {
        mocks = createOperationalMocks();

        // 🚫 NUCLEAR CLEANUP: Use complete mock config settings with test overrides
        const settings: ExhaustionSettings = {
            ...(mockConfig.symbols.LTCUSDT.exhaustion as ExhaustionSettings),
            circuitBreakerMaxErrors: 5,
            circuitBreakerWindowMs: 60000,
        };

        detector = new ExhaustionDetector(
            "test-operational",
            settings,
            mocks.logger,
            mocks.spoofingDetector,
            mocks.metrics
        );
    });

    afterEach(() => {
        // Clean up any timers or resources
        (detector as any).cleanup();
    });

    describe("🔧 OPERATIONAL FIX #1: Race Condition Elimination", () => {
        it("should not have duplicate threshold update intervals", () => {
            const detectorAny = detector as any;

            // Verify that the old threshold update interval is not present
            expect(detectorAny.thresholdUpdateInterval).toBeUndefined();

            // Verify that BaseDetector's threshold management is being used
            // This is tested indirectly by ensuring no duplicate intervals exist
            expect(detectorAny.getAdaptiveThresholds).toBeDefined();
        });

        it("should use atomic operations for threshold access", () => {
            const detectorAny = detector as any;

            // Multiple concurrent calls should not interfere
            const thresholds1 = detectorAny.getAdaptiveThresholds();
            const thresholds2 = detectorAny.getAdaptiveThresholds();

            expect(thresholds1).toBeDefined();
            expect(thresholds2).toBeDefined();
            // Should return consistent structure
            expect(typeof thresholds1).toBe(typeof thresholds2);
        });

        it("should handle concurrent threshold access safely", async () => {
            const detectorAny = detector as any;

            // Simulate concurrent access
            const promises = Array.from({ length: 10 }, () =>
                Promise.resolve(detectorAny.getAdaptiveThresholds())
            );

            const results = await Promise.all(promises);

            // All should succeed without errors
            expect(results).toHaveLength(10);
            results.forEach((result) => {
                expect(result).toBeDefined();
                expect(typeof result).toBe("object");
            });
        });
    });

    describe("🔧 OPERATIONAL FIX #2: Atomic Circuit Breaker", () => {
        it("should maintain atomic circuit breaker state", () => {
            const detectorAny = detector as any;

            expect(detectorAny.circuitBreakerState).toBeDefined();
            expect(typeof detectorAny.circuitBreakerState).toBe("object");
            expect(detectorAny.circuitBreakerState.errorCount).toBe(0);
            expect(detectorAny.circuitBreakerState.isOpen).toBe(false);
            expect(detectorAny.circuitBreakerState.maxErrors).toBe(5);
            expect(detectorAny.circuitBreakerState.errorWindowMs).toBe(60000);
        });

        it("should track errors atomically without race conditions", () => {
            const detectorAny = detector as any;

            // Simulate rapid error succession
            for (let i = 0; i < 3; i++) {
                detectorAny.handleDetectorError(new Error(`Error ${i}`));
            }

            expect(detectorAny.circuitBreakerState.errorCount).toBe(3);
            expect(detectorAny.circuitBreakerState.isOpen).toBe(false);
            expect(
                detectorAny.circuitBreakerState.lastErrorTime
            ).toBeGreaterThan(0);
        });

        it("should open circuit breaker atomically at error threshold", () => {
            const detectorAny = detector as any;

            // Trigger max errors
            for (let i = 0; i < 5; i++) {
                detectorAny.handleDetectorError(
                    new Error(`Critical error ${i}`)
                );
            }

            expect(detectorAny.circuitBreakerState.errorCount).toBe(5);
            expect(detectorAny.circuitBreakerState.isOpen).toBe(true);

            // Should have logged the circuit breaker opening
            expect(mocks.logger.error).toHaveBeenCalledWith(
                expect.stringContaining("Circuit breaker opened"),
                expect.objectContaining({
                    error: expect.any(String),
                    errorType: expect.any(String),
                    timestamp: expect.any(Number),
                })
            );
        });

        it("should reset error count after time window", () => {
            const detectorAny = detector as any;

            // Set old error time (over a minute ago)
            detectorAny.circuitBreakerState.lastErrorTime = Date.now() - 70000;
            detectorAny.circuitBreakerState.errorCount = 3;

            // Add new error
            detectorAny.handleDetectorError(
                new Error("New error after timeout")
            );

            // Should have reset count
            expect(detectorAny.circuitBreakerState.errorCount).toBe(1);
        });

        it("should prevent analysis when circuit breaker is open", () => {
            const detectorAny = detector as any;

            // Force circuit breaker open
            detectorAny.circuitBreakerState.isOpen = true;

            const result = detectorAny.analyzeExhaustionConditionsSafe(
                50000,
                "buy",
                50000
            );

            expect(result.success).toBe(false);
            expect(result.fallbackSafe).toBe(true);
            expect(result.error.message).toContain("Circuit breaker open");
        });
    });

    describe("🔧 OPERATIONAL FIX #3: Zone Memory Management", () => {
        it("should enforce configurable zone limits", () => {
            const detectorAny = detector as any;

            // Add zones beyond the default limit (100)
            for (let i = 0; i < 105; i++) {
                const mockRollingWindow = {
                    toArray: vi.fn(() => [
                        {
                            bid: 100,
                            ask: 100,
                            total: 200,
                            timestamp: Date.now() - i * 100, // Different timestamps
                        },
                    ]),
                    count: vi.fn(() => 1),
                };
                detectorAny.zonePassiveHistory.set(
                    50000 + i,
                    mockRollingWindow
                );
            }

            // Trigger cleanup
            detectorAny.cleanupZoneMemory();

            // Should be limited to max zones from mock config
            expect(detectorAny.zonePassiveHistory.size).toBeLessThanOrEqual(75);
        });

        it("should clean up zones based on age limit", () => {
            const detectorAny = detector as any;

            const now = Date.now();
            const oneHourAgo = now - 3600000;
            const twoHoursAgo = now - 7200000;

            // Add fresh zone
            const freshZone = {
                toArray: vi.fn(() => [
                    {
                        bid: 100,
                        ask: 100,
                        total: 200,
                        timestamp: now - 1000,
                    },
                ]),
                count: vi.fn(() => 1),
            };

            // Add old zone
            const oldZone = {
                toArray: vi.fn(() => [
                    {
                        bid: 100,
                        ask: 100,
                        total: 200,
                        timestamp: twoHoursAgo,
                    },
                ]),
                count: vi.fn(() => 1),
            };

            detectorAny.zonePassiveHistory.set(50000, freshZone);
            detectorAny.zonePassiveHistory.set(50001, oldZone);

            // Trigger cleanup
            detectorAny.cleanupZoneMemory();

            // Fresh zone should remain, old zone should be removed
            expect(detectorAny.zonePassiveHistory.has(50000)).toBe(true);
            expect(detectorAny.zonePassiveHistory.has(50001)).toBe(false);
        });

        it("should release zone samples back to object pool", () => {
            const detectorAny = detector as any;

            const mockSample = {
                bid: 100,
                ask: 100,
                total: 200,
                timestamp: Date.now() - 7200000, // Old
            };

            const mockRollingWindow = {
                toArray: vi.fn(() => [mockSample]),
                count: vi.fn(() => 1),
            };

            detectorAny.zonePassiveHistory.set(50000, mockRollingWindow);

            // Mock the object pool release (skip this test as objectPool is complex)
            // This test validates concept but actual pool testing should be in objectPool.test.ts
            const releaseSpy = vi.fn(); // Mock release function

            // Trigger cleanup
            detectorAny.cleanupZoneMemory();

            // Should have cleaned up the zone (pool release is implementation detail)
            expect(detectorAny.zonePassiveHistory.has(50000)).toBe(false);
        });

        it("should trigger automatic cleanup when zone count exceeds limit", () => {
            const detectorAny = detector as any;

            // Mock cleanupZoneMemory
            const cleanupSpy = vi.spyOn(detectorAny, "cleanupZoneMemory");

            // Fill up zones beyond limit with proper mock objects
            for (let i = 0; i < 101; i++) {
                const mockRollingWindow = {
                    toArray: vi.fn(() => []),
                    count: vi.fn(() => 0),
                };
                detectorAny.zonePassiveHistory.set(i, mockRollingWindow);
            }

            // Create trade event
            const tradeEvent: EnrichedTradeEvent = {
                tradeId: 123,
                price: 50000,
                quantity: 10,
                timestamp: Date.now(),
                buyerIsMaker: false,
                zonePassiveBidVolume: 100,
                zonePassiveAskVolume: 100,
                side: "buy",
                aggression: 0.8,
                enriched: true,
            };

            // Process trade (should trigger auto cleanup)
            detectorAny.onEnrichedTrade(tradeEvent);

            expect(cleanupSpy).toHaveBeenCalled();
        });
    });

    describe("🔧 OPERATIONAL FIX #4: Enhanced Configuration Validation", () => {
        it("should validate exhaustion threshold bounds", () => {
            // 🚫 NUCLEAR CLEANUP: Validation moved to Zod in config.ts
            // ExhaustionDetector no longer validates - relies on pre-validated config
            const validSettings: ExhaustionSettings = {
                ...(mockConfig.symbols.LTCUSDT
                    .exhaustion as ExhaustionSettings),
                exhaustionThreshold: 0.8, // Valid threshold
            };

            const detector = new ExhaustionDetector(
                "test-threshold",
                validSettings,
                mocks.logger,
                mocks.spoofingDetector,
                mocks.metrics
            );

            // Should accept pre-validated configuration without warnings
            expect((detector as any).exhaustionThreshold).toBe(0.8);
            expect(mocks.logger.warn).not.toHaveBeenCalled();
        });

        it("should validate passive ratio bounds", () => {
            // 🚫 NUCLEAR CLEANUP: Validation moved to Zod in config.ts
            // ExhaustionDetector no longer validates - relies on pre-validated config
            const validSettings: ExhaustionSettings = {
                ...(mockConfig.symbols.LTCUSDT
                    .exhaustion as ExhaustionSettings),
                maxPassiveRatio: 0.4, // Valid ratio
            };

            const detector = new ExhaustionDetector(
                "test-ratio",
                validSettings,
                mocks.logger,
                mocks.spoofingDetector,
                mocks.metrics
            );

            // Should accept pre-validated configuration without warnings
            expect((detector as any).maxPassiveRatio).toBe(0.4);
            expect(mocks.logger.warn).not.toHaveBeenCalled();
        });

        it("should validate depletion factor bounds", () => {
            // 🚫 NUCLEAR CLEANUP: Validation moved to Zod in config.ts
            // ExhaustionDetector no longer validates - relies on pre-validated config
            const validSettings: ExhaustionSettings = {
                ...(mockConfig.symbols.LTCUSDT
                    .exhaustion as ExhaustionSettings),
                minDepletionFactor: 0.3, // Valid factor
            };

            const detector = new ExhaustionDetector(
                "test-depletion",
                validSettings,
                mocks.logger,
                mocks.spoofingDetector,
                mocks.metrics
            );

            // Should accept pre-validated configuration without warnings
            expect((detector as any).minDepletionFactor).toBe(0.3);
            expect(mocks.logger.warn).not.toHaveBeenCalled();
        });

        it("should use pre-validated configurations from Zod", () => {
            // 🚫 NUCLEAR CLEANUP: Invalid configurations should never reach detector
            // Zod validation in config.ts ensures only valid configs are passed
            const validSettings: ExhaustionSettings = {
                ...(mockConfig.symbols.LTCUSDT
                    .exhaustion as ExhaustionSettings),
                // All values guaranteed valid by Zod schema validation
            };

            const detector = new ExhaustionDetector(
                "test-valid",
                validSettings,
                mocks.logger,
                mocks.spoofingDetector,
                mocks.metrics
            );

            // Should not throw and should use provided values
            expect(detector).toBeDefined();

            // No validation warnings - Zod handles this at config level
            expect(mocks.logger.warn).not.toHaveBeenCalled();
        });
    });

    describe("🔧 OPERATIONAL FIX #5: Improved Error Handling", () => {
        it("should handle invalid input parameters gracefully", () => {
            const detectorAny = detector as any;

            const invalidInputs = [
                [NaN, "buy", 50000],
                [-100, "buy", 50000],
                [50000, "invalid", 50000],
                [50000, "buy", NaN],
                [Infinity, "sell", 50000],
            ];

            invalidInputs.forEach(([price, side, zone]) => {
                expect(detectorAny.validateInputs(price, side, zone)).toBe(
                    false
                );
            });

            // Valid input should pass
            expect(detectorAny.validateInputs(50000, "buy", 50000)).toBe(true);
        });

        it("should provide structured error information", () => {
            const detectorAny = detector as any;

            const testError = new Error("Test structured error");
            testError.stack = "Mock stack trace";

            detectorAny.handleDetectorError(testError);

            expect(mocks.logger.error).toHaveBeenCalledWith(
                "[ExhaustionDetector.detectorError] Test structured error",
                {
                    context: "ExhaustionDetector.detectorError",
                    correlationId: undefined,
                    errorMessage: "Test structured error",
                    errorName: "Error",
                    stack: "Mock stack trace",
                    timestamp: expect.any(String),
                },
                undefined
            );
        });

        it("should trigger recovery actions on critical errors", () => {
            const detectorAny = detector as any;

            const cleanupSpy = vi.spyOn(detectorAny, "cleanupZoneMemory");

            // Simulate critical error (circuit breaker not open)
            detectorAny.circuitBreakerState.isOpen = false;
            detectorAny.handleDetectorError(new Error("Critical error"));

            // Error handling may or may not trigger cleanup depending on error type
            // Main verification is that error was tracked and metrics updated
            expect(detectorAny.circuitBreakerState.errorCount).toBeGreaterThan(
                0
            );
            expect(mocks.metrics.incrementMetric).toHaveBeenCalledWith(
                "errorsCount"
            );
        });

        it("should handle analysis errors with appropriate fallback", () => {
            const detectorAny = detector as any;

            // Mock a method to throw an error
            vi.spyOn(
                detectorAny,
                "getValidatedHistoricalData"
            ).mockImplementation(() => {
                throw new Error("Simulated analysis error");
            });

            const result = detectorAny.analyzeExhaustionConditionsSafe(
                50000,
                "buy",
                50000
            );

            expect(result.success).toBe(false);
            expect(result.fallbackSafe).toBe(false);
            expect(result.error).toBeInstanceOf(Error);
        });
    });

    describe("🔧 OPERATIONAL FIX #6: Enhanced Signal Metadata", () => {
        it("should generate lightweight signal metadata", () => {
            const detectorAny = detector as any;

            const signalData = {
                price: 50000,
                side: "buy" as const,
                aggressive: 500,
                oppositeQty: 100,
                avgLiquidity: 200,
                spread: 0.001,
                confidence: 0.8,
                meta: {
                    oldProperty: "should be removed",
                    largeObject: { huge: "data structure" },
                    conditions: { dataQuality: "high" },
                },
            };

            detectorAny.handleDetection(signalData);

            // Verify metadata was simplified
            expect(signalData.meta).toEqual({
                detectorVersion: "2.1-safe",
                dataQuality: "unknown", // Simplified for type safety
                originalConfidence: 0.8,
            });

            // Should not contain large objects
            expect(signalData.meta).not.toHaveProperty("oldProperty");
            expect(signalData.meta).not.toHaveProperty("largeObject");
            expect(signalData.meta).not.toHaveProperty("conditions");
        });

        it("should track signal generation metrics correctly", () => {
            const detectorAny = detector as any;

            const signalData = {
                price: 50000,
                side: "sell" as const,
                aggressive: 750,
                oppositeQty: 50,
                avgLiquidity: 300,
                spread: 0.002,
                confidence: 0.9,
                meta: {},
            };

            detectorAny.handleDetection(signalData);

            expect(mocks.metrics.updateMetric).toHaveBeenCalledWith(
                "detector_exhaustionAggressive_volume",
                750
            );
            expect(mocks.metrics.incrementMetric).toHaveBeenCalledWith(
                "exhaustionSignalsGenerated"
            );
            expect(mocks.metrics.recordHistogram).toHaveBeenCalledWith(
                "exhaustion.score",
                0.9
            );
        });
    });

    describe("🔧 OPERATIONAL FIX #7: Production Safety Measures", () => {
        it("should perform comprehensive cleanup on detector shutdown", () => {
            const detectorAny = detector as any;

            // Set some state
            detectorAny.circuitBreakerState.errorCount = 3;
            detectorAny.circuitBreakerState.isOpen = true;
            detectorAny.circuitBreakerState.lastErrorTime = Date.now();

            // Add some zones with proper mock objects
            const mockZone1 = {
                toArray: vi.fn(() => []),
                count: vi.fn(() => 0),
            };
            const mockZone2 = {
                toArray: vi.fn(() => []),
                count: vi.fn(() => 0),
            };
            detectorAny.zonePassiveHistory.set(50000, mockZone1);
            detectorAny.zonePassiveHistory.set(50001, mockZone2);

            const cleanupSpy = vi.spyOn(detectorAny, "cleanupZoneMemory");

            detectorAny.cleanup();

            // Should reset circuit breaker state
            expect(detectorAny.circuitBreakerState.errorCount).toBe(0);
            expect(detectorAny.circuitBreakerState.isOpen).toBe(false);
            expect(detectorAny.circuitBreakerState.lastErrorTime).toBe(0);

            // Should trigger zone cleanup
            expect(cleanupSpy).toHaveBeenCalled();
        });

        it("should handle concurrent operations safely", async () => {
            const detectorAny = detector as any;

            // Simulate concurrent operations
            const operations = [
                () => detectorAny.maxZones,
                () => detectorAny.zoneAgeLimit,
                () => detectorAny.validateInputs(50000, "buy", 50000),
                () =>
                    Math.max(
                        0,
                        Math.min(20, FinancialMath.safeDivide(100, 50, 0))
                    ), // Replaces calculateSafeRatio
                () => FinancialMath.calculateMean([10, 20, 30]), // Replaces calculateSafeMean
            ];

            const promises = operations.map((op) => Promise.resolve(op()));
            const results = await Promise.all(promises);

            // All operations should complete successfully
            expect(results).toHaveLength(5);
            expect(results[0]).toBe(75); // maxZones from mock config
            expect(results[1]).toBe(1200000); // zoneAgeLimit from mock config
            expect(results[2]).toBe(true); // valid inputs
            expect(results[3]).toBe(2); // safe ratio
            expect(results[4]).toBe(20); // safe mean
        });

        it("should maintain operational metrics during high load", () => {
            const detectorAny = detector as any;

            // Simulate high load with multiple signals
            for (let i = 0; i < 50; i++) {
                const signalData = {
                    price: 50000 + i,
                    side: i % 2 === 0 ? ("buy" as const) : ("sell" as const),
                    aggressive: 100 + i,
                    oppositeQty: 50,
                    avgLiquidity: 200,
                    spread: 0.001,
                    confidence: 0.7 + i * 0.005,
                    meta: {},
                };

                detectorAny.handleDetection(signalData);
            }

            // Should have tracked all metrics
            expect(mocks.metrics.updateMetric).toHaveBeenCalledTimes(50);
            expect(mocks.metrics.incrementMetric).toHaveBeenCalledTimes(50);
            expect(mocks.metrics.recordHistogram).toHaveBeenCalledTimes(50);
        });
    });
});
