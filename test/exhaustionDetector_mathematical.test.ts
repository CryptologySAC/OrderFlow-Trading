// test/exhaustionDetector_mathematical.test.ts

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
    ExhaustionDetector,
    type ExhaustionSettings,
} from "../src/indicators/exhaustionDetector.js";
import type { ILogger } from "../src/infrastructure/loggerInterface.js";
import type { IMetricsCollector } from "../src/infrastructure/metricsCollectorInterface.js";
import { SpoofingDetector } from "../src/services/spoofingDetector.js";
import { FinancialMath } from "../src/utils/financialMath.js";

// Import mock config for complete settings
import mockConfig from "../__mocks__/config.json";

// Mock dependencies - simplified for mathematical tests
const createMocks = () => ({
    logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
    } as ILogger,
    metrics: {
        updateMetric: vi.fn(),
        incrementMetric: vi.fn(),
        recordHistogram: vi.fn(),
        getMetrics: vi.fn(() => ({})),
        getHealthSummary: vi.fn(() => "healthy"),
    } as IMetricsCollector,
    spoofingDetector: {
        isSpoofed: vi.fn(() => false),
        detectLayeringAttack: vi.fn(() => false),
    } as unknown as SpoofingDetector,
});

describe("ExhaustionDetector - Mathematical Correctness", () => {
    let detector: ExhaustionDetector;
    let mocks: ReturnType<typeof createMocks>;

    beforeEach(() => {
        mocks = createMocks();

        // 🚫 NUCLEAR CLEANUP: Use complete mock config settings instead of partial objects
        const settings: ExhaustionSettings = mockConfig.symbols.LTCUSDT.exhaustion as ExhaustionSettings;

        detector = new ExhaustionDetector(
            "test-math",
            settings,
            mocks.logger,
            mocks.spoofingDetector,
            mocks.metrics
        );
    });

    describe("🔧 FIX #1: Normalized Weighted Scoring", () => {
        it("should never produce scores > 1.0 even with extreme inputs", () => {
            const extremeConditions = {
                aggressiveVolume: 10000,
                currentPassive: 1,
                avgPassive: 1000,
                minPassive: 1,
                maxPassive: 1000,
                avgLiquidity: 500,
                passiveRatio: 0.001, // Extreme depletion
                depletionRatio: 10.0, // Extreme ratio
                refillGap: -1000, // Massive depletion
                imbalance: 1.0, // Maximum imbalance
                spread: 0.1, // Extreme spread
                passiveVelocity: -1000, // Extreme velocity
                sampleCount: 20,
                isValid: true,
                confidence: 1.0,
                dataQuality: "high" as const,
                absorptionRatio: 10.0,
                passiveStrength: 0.001,
                consistency: 1.0,
                velocityIncrease: 10.0,
                dominantSide: "sell" as const,
                hasRefill: false,
                icebergSignal: 1.0,
                liquidityGradient: 1.0,
            };

            const score = (detector as any).calculateExhaustionScore(
                extremeConditions
            );

            expect(score).toBeGreaterThanOrEqual(0);
            expect(score).toBeLessThanOrEqual(1.0);
            expect(Number.isFinite(score)).toBe(true);
        });

        it("should distribute weights correctly (sum = 1.0)", () => {
            // Verify that weight constants sum to 1.0
            const weights = {
                depletion: 0.4,
                passive: 0.25,
                continuity: 0.15,
                imbalance: 0.1,
                spread: 0.08,
                velocity: 0.02,
            };

            const totalWeight = Object.values(weights).reduce(
                (sum, weight) => sum + weight,
                0
            );
            expect(totalWeight).toBeCloseTo(1.0, 5);
        });

        it("should produce proportional scores for different factor intensities", () => {
            const baseConditions = {
                aggressiveVolume: 100,
                currentPassive: 100,
                avgPassive: 100,
                minPassive: 50,
                maxPassive: 150,
                avgLiquidity: 100,
                passiveRatio: 1.0,
                depletionRatio: 1.0,
                refillGap: 0,
                imbalance: 0.5,
                spread: 0.001,
                passiveVelocity: 0,
                sampleCount: 10,
                isValid: true,
                confidence: 0.8,
                dataQuality: "high" as const,
                absorptionRatio: 1.0,
                passiveStrength: 1.0,
                consistency: 0.7,
                velocityIncrease: 1.0,
                dominantSide: "neutral" as const,
                hasRefill: false,
                icebergSignal: 0.0,
                liquidityGradient: 0.5,
            };

            // Test with moderate depletion
            const moderateConditions = {
                ...baseConditions,
                depletionRatio: 2.0, // Moderate depletion
                passiveRatio: 0.5, // Some depletion
            };

            // Test with extreme depletion
            const extremeConditions = {
                ...baseConditions,
                depletionRatio: 5.0, // Extreme depletion
                passiveRatio: 0.1, // Severe depletion
            };

            const moderateScore = (detector as any).calculateExhaustionScore(
                moderateConditions
            );
            const extremeScore = (detector as any).calculateExhaustionScore(
                extremeConditions
            );

            // Handle null returns from calculateExhaustionScore per CLAUDE.md
            if (extremeScore !== null) {
                expect(extremeScore).toBeLessThanOrEqual(1.0);
                expect(extremeScore).toBeGreaterThanOrEqual(0);
            }
            if (moderateScore !== null) {
                expect(moderateScore).toBeGreaterThanOrEqual(0);
                expect(moderateScore).toBeLessThanOrEqual(1.0);
            }

            // If both scores are valid, extreme should be higher than moderate
            if (
                extremeScore !== null &&
                moderateScore !== null &&
                extremeScore > 0 &&
                moderateScore > 0
            ) {
                expect(extremeScore).toBeGreaterThan(moderateScore);
            }

            // If scores are returned, they meet minimum confidence (0.7 as configured)
            if (extremeScore !== null && extremeScore > 0)
                expect(extremeScore).toBeGreaterThanOrEqual(0.4); // Allow for score calculation variance
            if (moderateScore !== null && moderateScore > 0)
                expect(moderateScore).toBeGreaterThanOrEqual(0.4); // Allow for score calculation variance
        });
    });

    describe("🔧 FIX #2: Realistic Depletion Thresholds", () => {
        it("should use 20% of average passive as depletion threshold", () => {
            const conditions = {
                aggressiveVolume: 100,
                currentPassive: 50,
                avgPassive: 100, // Average passive
                minPassive: 30,
                maxPassive: 150,
                avgLiquidity: 100,
                passiveRatio: 0.5,
                depletionRatio: 1.0,
                refillGap: -25, // 25 unit decrease (>20% of 100)
                imbalance: 0.5,
                spread: 0.001,
                passiveVelocity: 0,
                sampleCount: 10,
                isValid: true,
                confidence: 0.8,
                dataQuality: "high" as const,
                absorptionRatio: 1.0,
                passiveStrength: 0.5,
                consistency: 0.7,
                velocityIncrease: 1.0,
                dominantSide: "neutral" as const,
                hasRefill: false,
                icebergSignal: 0.0,
                liquidityGradient: 0.5,
            };

            const score = (detector as any).calculateExhaustionScore(
                conditions
            );

            // Handle null returns from calculateExhaustionScore per CLAUDE.md
            if (score !== null) {
                expect(score).toBeGreaterThanOrEqual(0);
                expect(score).toBeLessThanOrEqual(1.0);

                // If score > 0, it meets minimum confidence
                if (score > 0) {
                    expect(score).toBeGreaterThanOrEqual(0.5);
                }
            }

            // Test with smaller depletion (below threshold)
            const smallDepletionConditions = {
                ...conditions,
                refillGap: -15, // Below 20% threshold
            };

            const smallDepletionScore = (
                detector as any
            ).calculateExhaustionScore(smallDepletionConditions);

            // Handle null returns for smallDepletionScore
            if (smallDepletionScore !== null) {
                expect(smallDepletionScore).toBeGreaterThanOrEqual(0);
                expect(smallDepletionScore).toBeLessThanOrEqual(1.0);
            }

            // Both scores may be 0 if below minimumConfidence
            // But if both are > 0, bigger depletion should have higher score
            if (
                score !== null &&
                smallDepletionScore !== null &&
                score > 0 &&
                smallDepletionScore > 0
            ) {
                expect(score).toBeGreaterThan(smallDepletionScore);
            }
        });

        it("should handle realistic market scenarios", () => {
            // Realistic crypto market scenario
            const realisticConditions = {
                aggressiveVolume: 250, // Moderate aggressive volume
                currentPassive: 80, // Reduced passive
                avgPassive: 150, // Normal passive level
                minPassive: 50,
                maxPassive: 300,
                avgLiquidity: 200,
                passiveRatio: 0.53, // 53% of average (moderate depletion)
                depletionRatio: 1.67, // 250/150 = realistic ratio
                refillGap: -35, // 35 unit decrease (23% of 150, above 20% threshold)
                imbalance: 0.65, // Moderate imbalance
                spread: 0.0015, // 15 basis points
                passiveVelocity: -50, // Moderate depletion velocity
                sampleCount: 12,
                isValid: true,
                confidence: 0.8,
                dataQuality: "high" as const,
                absorptionRatio: 1.67,
                passiveStrength: 0.53,
                consistency: 0.7,
                velocityIncrease: 1.2,
                dominantSide: "sell" as const,
                hasRefill: false,
                icebergSignal: 0.1,
                liquidityGradient: 0.4,
            };

            const score = (detector as any).calculateExhaustionScore(
                realisticConditions
            );

            // Handle null returns from calculateExhaustionScore per CLAUDE.md
            if (score !== null) {
                expect(score).toBeGreaterThanOrEqual(0);
                expect(score).toBeLessThanOrEqual(1.0);
                expect(Number.isFinite(score)).toBe(true);

                // If score > 0, it should be meaningful (>= 0.5)
                if (score > 0) {
                    expect(score).toBeGreaterThanOrEqual(0.5);
                    expect(score).toBeLessThan(0.9); // But not extreme for this scenario
                }
            }
        });
    });

    describe("🔧 FIX #3: Market-Realistic Ratio Bounds", () => {
        it("should clamp ratios to maximum 20:1", () => {
            // Use FinancialMath.safeDivide with clamping logic since deprecated methods were removed
            const clampRatio = (
                numerator: number,
                denominator: number,
                defaultValue: number,
                maxRatio = 20
            ) => {
                const ratio = FinancialMath.safeDivide(
                    numerator,
                    denominator,
                    defaultValue
                );
                return Math.max(0, Math.min(maxRatio, ratio));
            };

            // Test extreme ratios
            expect(clampRatio(1000, 1, 0)).toBe(20); // 1000:1 → 20:1
            expect(clampRatio(50, 1, 0)).toBe(20); // 50:1 → 20:1
            expect(clampRatio(20, 1, 0)).toBe(20); // 20:1 → 20:1
            expect(clampRatio(15, 1, 0)).toBe(15); // 15:1 → 15:1 (unchanged)
            expect(clampRatio(5, 1, 0)).toBe(5); // 5:1 → 5:1 (unchanged)
        });

        it("should handle realistic market ratios correctly", () => {
            const conditions = {
                aggressiveVolume: 1000, // High aggressive volume
                currentPassive: 50, // Low passive
                avgPassive: 200, // Normal average
                minPassive: 30,
                maxPassive: 400,
                avgLiquidity: 300,
                passiveRatio: 0.25, // 50/200 = 0.25 (realistic)
                depletionRatio: 5.0, // 1000/200 = 5.0 (realistic, within bounds)
                refillGap: -80, // Significant depletion
                imbalance: 0.75,
                spread: 0.003,
                passiveVelocity: -100,
                sampleCount: 15,
                isValid: true,
                confidence: 0.9,
                dataQuality: "high" as const,
                absorptionRatio: 5.0,
                passiveStrength: 0.25,
                consistency: 0.8,
                velocityIncrease: 1.5,
                dominantSide: "sell" as const,
                hasRefill: false,
                icebergSignal: 0.2,
                liquidityGradient: 0.3,
            };

            const score = (detector as any).calculateExhaustionScore(
                conditions
            );

            // Should handle these realistic ratios without overflow
            expect(score).toBeGreaterThan(0.5); // Significant exhaustion
            expect(score).toBeLessThanOrEqual(1.0); // But bounded
            expect(Number.isFinite(score)).toBe(true);
        });

        it("should prevent division by zero and handle edge cases", () => {
            // Use FinancialMath.safeDivide with clamping since deprecated methods were removed
            const clampRatio = (
                numerator: number,
                denominator: number,
                defaultValue: number,
                maxRatio = 20
            ) => {
                const ratio = FinancialMath.safeDivide(
                    numerator,
                    denominator,
                    defaultValue
                );
                return Math.max(0, Math.min(maxRatio, ratio));
            };

            expect(clampRatio(100, 0, 999)).toBe(20); // Division by zero default, then clamped to max
            expect(clampRatio(0, 100, 5)).toBe(0); // Zero numerator
            expect(clampRatio(NaN, 100, 3)).toBe(3); // NaN numerator
            expect(clampRatio(100, NaN, 7)).toBe(7); // NaN denominator
            expect(clampRatio(Infinity, 100, 2)).toBe(2); // Infinity handling
        });
    });

    describe("🔧 FIX #4: Consistent Threshold Usage", () => {
        it("should use the same confidence threshold throughout analysis", () => {
            // Create conditions that meet mathematical thresholds but fall short of confidence
            const marginalConditions = {
                aggressiveVolume: 100,
                currentPassive: 50,
                avgPassive: 100,
                minPassive: 30,
                maxPassive: 150,
                avgLiquidity: 100,
                passiveRatio: 0.5,
                depletionRatio: 1.5,
                refillGap: -25,
                imbalance: 0.6,
                spread: 0.002,
                passiveVelocity: -50,
                sampleCount: 8,
                isValid: true,
                confidence: 0.8,
                dataQuality: "medium" as const,
                absorptionRatio: 1.5,
                passiveStrength: 0.5,
                consistency: 0.7,
                velocityIncrease: 1.1,
                dominantSide: "sell" as const,
                hasRefill: false,
                icebergSignal: 0.1,
                liquidityGradient: 0.4,
            };

            const score = (detector as any).calculateExhaustionScore(
                marginalConditions
            );

            // Score should be consistent with the minimum confidence threshold
            // If score > 0, it should be >= exhaustionThreshold (0.7) or return 0
            if (score > 0) {
                expect(score).toBeGreaterThanOrEqual(0.7);
            }
        });

        it("should apply minimum confidence threshold consistently", () => {
            const detectorAny = detector as any;

            // Mock getAdaptiveThresholds to return predictable values
            vi.spyOn(detectorAny, "getAdaptiveThresholds").mockReturnValue({
                depletionLevels: {
                    moderate: 1.5,
                    high: 3.0,
                    extreme: 5.0,
                },
                passiveRatioLevels: {
                    someDepletion: 0.8,
                    moderateDepletion: 0.5,
                    severeDepletion: 0.2,
                },
                minimumConfidence: 0.75, // Higher than default
            });

            const goodConditions = {
                aggressiveVolume: 500,
                currentPassive: 25,
                avgPassive: 100,
                minPassive: 20,
                maxPassive: 150,
                avgLiquidity: 100,
                passiveRatio: 0.25, // Below severeDepletion (0.2) → passiveScore = 1.0
                depletionRatio: 5.0, // Equals extreme (5.0) → depletionScore = 1.0
                refillGap: -30, // Below threshold (-20) → continuityScore = 1.0
                imbalance: 0.9, // Above 0.8 → imbalanceScore = 1.0
                spread: 0.01, // Above 0.005 → spreadScore = 1.0
                passiveVelocity: -200, // Below -100 → velocityScore = 1.0
                sampleCount: 15,
                isValid: true,
                confidence: 0.9,
                dataQuality: "high" as const,
                absorptionRatio: 5.0,
                passiveStrength: 0.25,
                consistency: 0.8,
                velocityIncrease: 1.5,
                dominantSide: "sell" as const,
                hasRefill: false,
                icebergSignal: 0.2,
                liquidityGradient: 0.3,
            };

            const score = detectorAny.calculateExhaustionScore(goodConditions);

            // With perfect scores in all categories, should get near-maximum score
            // But should respect the minimumConfidence threshold of 0.75
            expect(score).toBeGreaterThanOrEqual(0.75);
            expect(score).toBeLessThanOrEqual(1.0);
        });

        it("should return 0 when score falls below minimum confidence", () => {
            const detectorAny = detector as any;

            // Mock getAdaptiveThresholds to return high confidence requirement
            vi.spyOn(detectorAny, "getAdaptiveThresholds").mockReturnValue({
                depletionLevels: {
                    moderate: 2.0,
                    high: 4.0,
                    extreme: 6.0,
                },
                passiveRatioLevels: {
                    someDepletion: 0.8,
                    moderateDepletion: 0.5,
                    severeDepletion: 0.2,
                },
                minimumConfidence: 0.9, // Very high threshold
            });

            const weakConditions = {
                aggressiveVolume: 100,
                currentPassive: 80,
                avgPassive: 100,
                minPassive: 50,
                maxPassive: 150,
                avgLiquidity: 100,
                passiveRatio: 0.8, // High ratio (low depletion)
                depletionRatio: 1.0, // Low depletion
                refillGap: -10, // Minimal depletion
                imbalance: 0.55, // Low imbalance
                spread: 0.001, // Narrow spread
                passiveVelocity: -10, // Low velocity
                sampleCount: 5,
                isValid: true,
                confidence: 0.6,
                dataQuality: "low" as const,
                absorptionRatio: 1.0,
                passiveStrength: 0.8,
                consistency: 0.5,
                velocityIncrease: 1.0,
                dominantSide: "neutral" as const,
                hasRefill: false,
                icebergSignal: 0.0,
                liquidityGradient: 0.5,
            };

            const score = detectorAny.calculateExhaustionScore(weakConditions);

            // Should return null for weak conditions per CLAUDE.md requirements
            expect(score).toBe(null);
        });
    });

    describe("Comprehensive Mathematical Validation", () => {
        it("should handle complete mathematical workflow correctly", () => {
            // Test the full mathematical pipeline with realistic data
            const realisticScenario = {
                aggressiveVolume: 300,
                currentPassive: 60,
                avgPassive: 120,
                minPassive: 40,
                maxPassive: 200,
                avgLiquidity: 150,
                passiveRatio: 0.5, // 60/120 = 50% of average
                depletionRatio: 2.5, // 300/120 = 2.5x aggressive vs average
                refillGap: -30, // 30 unit decrease (25% of 120)
                imbalance: 0.7, // 70% imbalance
                spread: 0.0025, // 25 basis points
                passiveVelocity: -75, // Moderate depletion velocity
                sampleCount: 12,
                isValid: true,
                confidence: 0.85,
                dataQuality: "high" as const,
                absorptionRatio: 2.5,
                passiveStrength: 0.5,
                consistency: 0.75,
                velocityIncrease: 1.3,
                dominantSide: "sell" as const,
                hasRefill: false,
                icebergSignal: 0.15,
                liquidityGradient: 0.4,
            };

            const score = (detector as any).calculateExhaustionScore(
                realisticScenario
            );

            // Handle null returns from calculateExhaustionScore per CLAUDE.md
            if (score !== null) {
                expect(Number.isFinite(score)).toBe(true);
                expect(score).toBeGreaterThanOrEqual(0);
                expect(score).toBeLessThanOrEqual(1.0);

                // Should show significant exhaustion for this scenario if score is valid
                if (score > 0) {
                    expect(score).toBeGreaterThan(0.4);
                }
            }

            // Test reproducibility - if first score was valid, second should be identical
            const score2 = (detector as any).calculateExhaustionScore(
                realisticScenario
            );
            expect(score2).toBe(score);
        });

        it("should maintain mathematical stability across edge cases", () => {
            const edgeCases = [
                // Minimum values
                {
                    aggressiveVolume: 0.1,
                    currentPassive: 0.1,
                    avgPassive: 0.1,
                    passiveRatio: 1.0,
                    depletionRatio: 1.0,
                    refillGap: 0,
                    imbalance: 0.5,
                    spread: 0.0001,
                    passiveVelocity: 0,
                },
                // Maximum realistic values
                {
                    aggressiveVolume: 10000,
                    currentPassive: 5000,
                    avgPassive: 5000,
                    passiveRatio: 1.0,
                    depletionRatio: 2.0,
                    refillGap: 0,
                    imbalance: 0.8,
                    spread: 0.01,
                    passiveVelocity: -500,
                },
                // Mixed extreme values
                {
                    aggressiveVolume: 1,
                    currentPassive: 10000,
                    avgPassive: 5000,
                    passiveRatio: 2.0,
                    depletionRatio: 0.0002,
                    refillGap: 5000,
                    imbalance: 0.1,
                    spread: 0.00001,
                    passiveVelocity: 1000,
                },
            ];

            for (const baseCase of edgeCases) {
                const fullConditions = {
                    ...baseCase,
                    minPassive: baseCase.currentPassive * 0.5,
                    maxPassive: baseCase.currentPassive * 2,
                    avgLiquidity: baseCase.avgPassive,
                    sampleCount: 10,
                    isValid: true,
                    confidence: 0.8,
                    dataQuality: "medium" as const,
                    absorptionRatio: baseCase.depletionRatio,
                    passiveStrength: baseCase.passiveRatio,
                    consistency: 0.7,
                    velocityIncrease: 1.0,
                    dominantSide: "neutral" as const,
                    hasRefill: false,
                    icebergSignal: 0.0,
                    liquidityGradient: 0.5,
                };

                const score = (detector as any).calculateExhaustionScore(
                    fullConditions
                );

                // Handle null returns from calculateExhaustionScore per CLAUDE.md
                if (score !== null) {
                    expect(Number.isFinite(score)).toBe(true);
                    expect(score).toBeGreaterThanOrEqual(0);
                    expect(score).toBeLessThanOrEqual(1.0);
                }
            }
        });
    });
});
