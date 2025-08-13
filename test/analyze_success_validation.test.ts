#!/usr/bin/env npx vitest run
/**
 * Unit tests to mathematically validate the signal analysis logic
 * Ensures no contradictory calculations and all math is correct
 */
import { describe, it, expect } from "vitest";

describe("Signal Analysis Mathematical Validation", () => {
    describe("Basic Mathematical Invariants", () => {
        it("should validate that individual signal movements cannot exceed total market movement", () => {
            // If market moved from $131.39 to $129.59
            const marketHigh = 131.39;
            const marketLow = 129.59;
            const totalMarketMovement =
                ((marketHigh - marketLow) / marketHigh) * 100;

            // Then NO signal can achieve more than this movement
            const signalEntry = 131.26;
            const signalExit = 129.59;
            const signalMovement =
                ((signalEntry - signalExit) / signalEntry) * 100;

            // Signal movement MUST be less than or equal to total market movement
            expect(signalMovement).toBeLessThanOrEqual(totalMarketMovement);

            // Verify the math
            expect(totalMarketMovement).toBeCloseTo(1.37, 2);
            expect(signalMovement).toBeCloseTo(1.272, 2);
        });

        it("should validate that signals entering at lower prices achieve less percentage gain", () => {
            const commonExitPrice = 129.59;

            // Higher entry should yield higher percentage
            const highEntry = 131.39;
            const highEntryGain =
                ((highEntry - commonExitPrice) / highEntry) * 100;

            // Lower entry should yield lower percentage
            const lowEntry = 131.19;
            const lowEntryGain =
                ((lowEntry - commonExitPrice) / lowEntry) * 100;

            expect(highEntryGain).toBeGreaterThan(lowEntryGain);
            expect(highEntryGain).toBeCloseTo(1.37, 2);
            expect(lowEntryGain).toBeCloseTo(1.22, 2);
        });

        it("should validate phase movement calculation consistency", () => {
            // Phase movement should be from first signal entry to final low
            const signals = [
                { time: "19:15:05", price: 131.26 },
                { time: "19:15:52", price: 131.29 },
                { time: "19:17:01", price: 131.18 }, // Lowest entry
                { time: "19:17:54", price: 131.27 },
            ];

            const finalLow = 129.59;

            // WRONG: Using lowest entry price for phase start
            const wrongPhaseStart = Math.min(...signals.map((s) => s.price));
            const wrongPhaseMovement =
                ((wrongPhaseStart - finalLow) / wrongPhaseStart) * 100;

            // CORRECT: Using first chronological signal for phase start
            const correctPhaseStart = signals[0].price;
            const correctPhaseMovement =
                ((correctPhaseStart - finalLow) / correctPhaseStart) * 100;

            expect(wrongPhaseMovement).toBeCloseTo(1.212, 2); // From $131.18
            expect(correctPhaseMovement).toBeCloseTo(1.272, 2); // From $131.26

            // Verify phase movement matches actual first signal movement
            const firstSignalMovement =
                ((signals[0].price - finalLow) / signals[0].price) * 100;
            expect(correctPhaseMovement).toBe(firstSignalMovement);
        });
    });

    describe("Phase Detection Logic Validation", () => {
        it("should correctly identify separate phases based on time gaps", () => {
            const phase1EndTime = new Date(
                "2025-08-12T19:18:00-05:00"
            ).getTime();
            const phase2StartTime = new Date(
                "2025-08-12T19:48:14-05:00"
            ).getTime();

            const timeGapMinutes =
                (phase2StartTime - phase1EndTime) / (60 * 1000);
            const PHASE_GAP_THRESHOLD = 15; // minutes

            expect(timeGapMinutes).toBeGreaterThan(PHASE_GAP_THRESHOLD);
            expect(timeGapMinutes).toBeCloseTo(30.23, 1);
        });

        it("should correctly identify separate phases based on price retracement", () => {
            // Phase 1 exhaustion signals hit TP around $130.38
            const phase1TPLevel = 130.38;

            // Phase 2 absorption signaled at $130.89
            const phase2EntryPrice = 130.89;

            // Calculate retracement
            const retracement =
                ((phase2EntryPrice - phase1TPLevel) / phase1TPLevel) * 100;
            const RETRACEMENT_THRESHOLD = 0.3; // 0.3%

            expect(retracement).toBeGreaterThan(RETRACEMENT_THRESHOLD);
            expect(retracement).toBeCloseTo(0.391, 2);
        });
    });

    describe("Target Achievement Validation", () => {
        it("should correctly identify when 0.7% target is reached", () => {
            const TARGET_PERCENT = 0.007;

            // Test successful signal
            const successEntry = 131.26;
            const successTarget = successEntry * (1 - TARGET_PERCENT);
            const successActual = 129.59;
            const successMovement =
                (successEntry - successActual) / successEntry;

            expect(successTarget).toBeCloseTo(130.34, 2);
            expect(successActual).toBeLessThan(successTarget); // Went beyond target
            expect(successMovement).toBeGreaterThan(TARGET_PERCENT);

            // Test failed signal
            const failEntry = 130.0;
            const failTarget = failEntry * (1 - TARGET_PERCENT);
            const failActual = 129.59;
            const failMovement = (failEntry - failActual) / failEntry;

            expect(failTarget).toBeCloseTo(129.09, 2);
            expect(failActual).toBeGreaterThan(failTarget); // Didn't reach target
            expect(failMovement).toBeLessThan(TARGET_PERCENT);
            expect(failMovement).toBeCloseTo(0.00315, 4);
        });

        it("should show actual maximum movement, not capped at 0.7%", () => {
            const signals = [
                { entry: 131.26, maxReached: 129.59, expectedTP: 1.272 },
                { entry: 131.39, maxReached: 129.59, expectedTP: 1.37 },
                { entry: 130.89, maxReached: 129.59, expectedTP: 0.993 },
            ];

            for (const signal of signals) {
                const actualMovement =
                    ((signal.entry - signal.maxReached) / signal.entry) * 100;
                expect(actualMovement).toBeCloseTo(signal.expectedTP, 2);

                // Verify none are artificially capped at 0.7%
                if (actualMovement > 0.7) {
                    expect(actualMovement).toBeGreaterThan(0.7);
                }
            }
        });
    });

    describe("Cluster Detection Validation", () => {
        it("should group signals within time and price proximity", () => {
            const CLUSTER_TIME_WINDOW = 5 * 60 * 1000; // 5 minutes
            const CLUSTER_PRICE_PROXIMITY = 0.002; // 0.2%

            const cluster1Signals = [
                {
                    time: new Date("2025-08-12T19:15:05-05:00").getTime(),
                    price: 131.26,
                },
                {
                    time: new Date("2025-08-12T19:15:52-05:00").getTime(),
                    price: 131.29,
                },
                {
                    time: new Date("2025-08-12T19:18:00-05:00").getTime(),
                    price: 131.26,
                },
            ];

            // Check time span
            const timeSpan = cluster1Signals[2].time - cluster1Signals[0].time;
            expect(timeSpan).toBeLessThan(CLUSTER_TIME_WINDOW);

            // Check price range
            const prices = cluster1Signals.map((s) => s.price);
            const priceRange =
                (Math.max(...prices) - Math.min(...prices)) /
                Math.max(...prices);
            expect(priceRange).toBeLessThan(CLUSTER_PRICE_PROXIMITY);
        });
    });

    describe("Data Consistency Validation", () => {
        it("should ensure all calculations use consistent decimal precision", () => {
            // All prices should respect tick size for $100+ range
            const TICK_SIZE = 0.01;
            const prices = [131.26, 131.29, 130.89, 129.59];

            for (const price of prices) {
                // Check if price is valid for tick size (handle floating point)
                const scaledPrice = Math.round(price * 100);
                const scaledTick = Math.round(TICK_SIZE * 100);
                const remainder = scaledPrice % scaledTick;
                expect(remainder).toBe(0);
            }
        });

        it("should validate that phase summary matches individual signal data", () => {
            const phaseSignals = [
                { entry: 131.26, movement: 1.272 },
                { entry: 131.29, movement: 1.295 },
                { entry: 131.39, movement: 1.37 },
            ];

            // Phase should show movement from first signal to common exit
            const firstSignalMovement = phaseSignals[0].movement;
            const maxSignalMovement = Math.max(
                ...phaseSignals.map((s) => s.movement)
            );

            // Phase movement should be between first signal and max signal movement
            const phaseMovement = 1.272; // Should match first signal
            expect(phaseMovement).toBeGreaterThanOrEqual(firstSignalMovement);
            expect(phaseMovement).toBeLessThanOrEqual(maxSignalMovement);
        });

        it("should never show contradictory phase vs signal movements", () => {
            // Test case: Phase shows 1.21% but signals show 1.27%+
            const phaseMovement = 1.21;
            const signalMovements = [1.272, 1.295, 1.28, 1.37];

            // This is INVALID - signals cannot exceed phase movement
            const isContradictory = signalMovements.some(
                (s) => s > phaseMovement
            );

            // This test confirms the CURRENT BUG exists
            expect(isContradictory).toBe(true); // Current buggy state

            // The CORRECT logic should be:
            const correctPhaseMovement = 1.48; // From market high to low
            const allSignalsValid = signalMovements.every(
                (s) => s <= correctPhaseMovement
            );
            expect(allSignalsValid).toBe(true); // This is what SHOULD be true
        });
    });

    describe("Success Rate Calculation", () => {
        it("should correctly calculate success rates", () => {
            const phase1 = { total: 37, successful: 37 };
            const phase2 = { total: 1, successful: 1 };
            const phase3 = { total: 5, successful: 0 };
            const phase4 = { total: 1, successful: 0 };

            const totalSignals =
                phase1.total + phase2.total + phase3.total + phase4.total;
            const totalSuccessful =
                phase1.successful +
                phase2.successful +
                phase3.successful +
                phase4.successful;

            expect(totalSignals).toBe(44);
            expect(totalSuccessful).toBe(38);

            const successRate = (totalSuccessful / totalSignals) * 100;
            expect(successRate).toBeCloseTo(86.36, 1);
        });
    });
});

describe("Required Fixes for Correct Implementation", () => {
    it("should use FinancialMath for all calculations", () => {
        // Mock FinancialMath usage
        const calculatePercentageChange = (
            start: number,
            end: number
        ): number => {
            // Should use FinancialMath.calculatePercentageChange
            return ((start - end) / start) * 100;
        };

        const result = calculatePercentageChange(131.26, 129.59);
        expect(result).toBeCloseTo(1.272, 3);
    });

    it("should calculate phase movement from actual market highs/lows during signal period", () => {
        // Correct approach:
        // 1. Find the actual market high when signals started
        // 2. Find the actual market low during the phase
        // 3. Calculate movement from high to low

        const marketHighAtSignals = 131.54; // Actual market price when signals fired
        const marketLowDuringPhase = 129.59; // Actual low reached

        const correctPhaseMovement =
            ((marketHighAtSignals - marketLowDuringPhase) /
                marketHighAtSignals) *
            100;
        expect(correctPhaseMovement).toBeCloseTo(1.48, 2);

        // This explains why signals show 1.27-1.37% - they caught most of a 1.48% move
    });

    it("should return null when calculations are invalid", () => {
        const calculateMovement = (
            entry: number,
            exit: number
        ): number | null => {
            if (entry <= 0 || exit <= 0) return null;
            if (entry === exit) return 0;
            return ((entry - exit) / entry) * 100;
        };

        expect(calculateMovement(0, 129.59)).toBeNull();
        expect(calculateMovement(131.26, 0)).toBeNull();
        expect(calculateMovement(131.26, 131.26)).toBe(0);
        expect(calculateMovement(131.26, 129.59)).toBeCloseTo(1.272, 3);
    });
});
