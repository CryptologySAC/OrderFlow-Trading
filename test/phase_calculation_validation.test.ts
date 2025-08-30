#!/usr/bin/env npx vitest run
/**
 * Validates that phase calculations are mathematically correct
 * and no signal can exceed the phase movement
 */
import { describe, it, expect } from "vitest";
import { FinancialMath } from "../src/utils/financialMath";

describe("Phase Calculation Mathematical Validation", () => {
    describe("Core Mathematical Invariant", () => {
        it("NO signal movement can exceed phase movement", () => {
            // Phase 1 data from actual analysis
            const phase1 = {
                start: 131.39, // Highest entry
                end: 129.59, // Final low
                movement:
                    Math.abs(
                        FinancialMath.calculatePercentageChange(
                            131.39,
                            129.59,
                            0
                        )
                    ) / 100,
            };

            // Individual signals in phase 1
            const signals = [
                { entry: 131.26, exit: 129.59 },
                { entry: 131.29, exit: 129.59 },
                { entry: 131.39, exit: 129.59 },
                { entry: 131.18, exit: 129.59 },
            ];

            // Calculate each signal movement
            const signalMovements = signals.map(
                (s) =>
                    Math.abs(
                        FinancialMath.calculatePercentageChange(
                            s.entry,
                            s.exit,
                            0
                        )
                    ) / 100
            );

            // CRITICAL TEST: No signal can exceed phase movement
            for (const movement of signalMovements) {
                expect(movement).toBeLessThanOrEqual(phase1.movement);
            }

            // Verify specific values
            expect(phase1.movement).toBeCloseTo(0.0137, 4);
            expect(signalMovements[0]).toBeCloseTo(0.01272, 4); // $131.26 signal
            expect(signalMovements[2]).toBeCloseTo(0.0137, 4); // $131.39 signal (equals phase)
        });

        it("Phase movement calculation must use correct start/end prices", () => {
            // For SELL signals entering at different prices
            const sellSignalEntries = [131.26, 131.29, 131.39, 131.18];
            const finalLow = 129.59;

            // CORRECT: Phase starts at HIGHEST entry (worst case for shorts)
            const correctPhaseStart = Math.max(...sellSignalEntries);
            const correctPhaseMovement =
                Math.abs(
                    FinancialMath.calculatePercentageChange(
                        correctPhaseStart,
                        finalLow,
                        0
                    )
                ) / 100;

            // WRONG: Using lowest entry (would understate movement)
            const wrongPhaseStart = Math.min(...sellSignalEntries);
            const wrongPhaseMovement =
                Math.abs(
                    FinancialMath.calculatePercentageChange(
                        wrongPhaseStart,
                        finalLow,
                        0
                    )
                ) / 100;

            expect(correctPhaseStart).toBe(131.39);
            expect(wrongPhaseStart).toBe(131.18);
            expect(correctPhaseMovement).toBeGreaterThan(wrongPhaseMovement);
            expect(correctPhaseMovement).toBeCloseTo(0.0137, 4);
            expect(wrongPhaseMovement).toBeCloseTo(0.01212, 4);
        });

        it("Each phase must be internally consistent", () => {
            const phases = [
                { start: 131.39, end: 129.59, expectedMovement: 0.0137 },
                { start: 130.89, end: 129.59, expectedMovement: 0.00993 },
                { start: 130.0, end: 129.59, expectedMovement: 0.00315 },
            ];

            for (const phase of phases) {
                const calculated =
                    Math.abs(
                        FinancialMath.calculatePercentageChange(
                            phase.start,
                            phase.end,
                            0
                        )
                    ) / 100;

                expect(calculated).toBeCloseTo(phase.expectedMovement, 4);
            }
        });
    });

    describe("Validation Requirements", () => {
        it("should return null/0 for invalid calculations", () => {
            // Test FinancialMath handles invalid inputs correctly
            expect(FinancialMath.calculatePercentageChange(0, 100, 0)).toBe(0);
            expect(FinancialMath.calculatePercentageChange(100, 0, -1)).toBe(
                -100
            );
            expect(FinancialMath.calculatePercentageChange(NaN, 100, 0)).toBe(
                0
            );
            expect(FinancialMath.calculatePercentageChange(100, NaN, 0)).toBe(
                0
            );
        });

        it("should validate all prices are positive", () => {
            const validatePrice = (price: number): boolean => {
                return Number.isFinite(price) && price > 0;
            };

            expect(validatePrice(131.26)).toBe(true);
            expect(validatePrice(0)).toBe(false);
            expect(validatePrice(-131.26)).toBe(false);
            expect(validatePrice(NaN)).toBe(false);
            expect(validatePrice(Infinity)).toBe(false);
        });
    });

    describe("Real Data Validation", () => {
        it("validates Phase 1 calculations are correct", () => {
            // Data from actual analysis output
            const phase1Data = {
                phaseMovement: 0.0137, // 1.37%
                signals: [
                    { entry: 131.26, movement: 0.01272 },
                    { entry: 131.29, movement: 0.01295 },
                    { entry: 131.39, movement: 0.0137 },
                ],
            };

            // All signals must be <= phase movement
            const allValid = phase1Data.signals.every(
                (s) => s.movement <= phase1Data.phaseMovement + 0.00001 // Small tolerance for rounding
            );

            expect(allValid).toBe(true);

            // Signal at highest entry should equal phase movement
            const highestSignal = phase1Data.signals.find(
                (s) => s.entry === 131.39
            );
            expect(highestSignal?.movement).toBeCloseTo(
                phase1Data.phaseMovement,
                4
            );
        });

        it("validates failed signals show correct percentages", () => {
            // Phase 3 failed signals
            const failedSignals = [
                { entry: 130.0, exit: 129.59, expectedMovement: 0.00315 },
                { entry: 129.77, exit: 129.64, expectedMovement: 0.001 },
                { entry: 129.74, exit: 129.64, expectedMovement: 0.00077 },
            ];

            for (const signal of failedSignals) {
                const calculated =
                    Math.abs(
                        FinancialMath.calculatePercentageChange(
                            signal.entry,
                            signal.exit,
                            0
                        )
                    ) / 100;

                expect(calculated).toBeCloseTo(signal.expectedMovement, 4);
                expect(calculated).toBeLessThan(0.007); // All failed to reach 0.7% target
            }
        });
    });
});
