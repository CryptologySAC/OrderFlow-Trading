import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { SignalValidationLogger } from "../src/utils/signalValidationLogger";
import type { Signal } from "../src/types";
import * as fs from "fs";
import * as path from "path";

// Mock fs and path modules
vi.mock("fs");
vi.mock("path");

describe("SignalValidationLogger", () => {
    let logger: SignalValidationLogger;
    let mockSignal: Signal;
    const mockTimestamp = 1000000000000;

    beforeEach(() => {
        vi.clearAllMocks();
        vi.useFakeTimers();
        vi.setSystemTime(mockTimestamp);

        // Mock fs methods
        vi.mocked(fs.existsSync).mockReturnValue(false);
        vi.mocked(fs.mkdirSync).mockImplementation(() => undefined);
        vi.mocked(fs.appendFileSync).mockImplementation(() => undefined);
        vi.mocked(fs.readFileSync).mockReturnValue("");

        logger = SignalValidationLogger.getInstance();

        mockSignal = {
            timestamp: mockTimestamp,
            detectorType: "absorption",
            signalType: "BOTTOM",
            price: 100,
            confidence: 0.75,
            correlationId: "test-123",
            metadata: {},
        };
    });

    afterEach(() => {
        vi.useRealTimers();
        SignalValidationLogger["instance"] = null;
    });

    describe("TP/SL Calculation Logic", () => {
        it("should correctly calculate TP and SL for BOTTOM (long) signals", () => {
            const signal: Signal = {
                ...mockSignal,
                signalType: "BOTTOM",
                price: 100,
            };

            logger.logSignal(signal, true);

            // For BOTTOM signal (long):
            // TP = entry * (1 + 0.007) = 100 * 1.007 = 100.7
            // SL = entry * (1 - 0.0035) = 100 * 0.9965 = 99.65

            // Test TP reached
            logger.updatePrice(100.8); // Above TP
            const validationData = logger["validationData"].get("test-123");
            expect(validationData).toBeDefined();

            // Manually check outcome
            const outcome = logger["checkSignalOutcome"](
                validationData!,
                100.8
            );
            expect(outcome.hitTarget).toBe(true);
            expect(outcome.targetPrice).toBeCloseTo(100.7, 2);
            expect(outcome.stopLossPrice).toBeCloseTo(99.65, 2);
        });

        it("should correctly calculate TP and SL for TOP (short) signals", () => {
            const signal: Signal = {
                ...mockSignal,
                signalType: "TOP",
                price: 100,
            };

            logger.logSignal(signal, true);

            // For TOP signal (short):
            // TP = entry * (1 - 0.007) = 100 * 0.993 = 99.3
            // SL = entry * (1 + 0.0035) = 100 * 1.0035 = 100.35

            // Test TP reached
            logger.updatePrice(99.2); // Below TP
            const validationData = logger["validationData"].get("test-123");

            const outcome = logger["checkSignalOutcome"](validationData!, 99.2);
            expect(outcome.hitTarget).toBe(true);
            expect(outcome.targetPrice).toBeCloseTo(99.3, 2);
            expect(outcome.stopLossPrice).toBeCloseTo(100.35, 2);
        });
    });

    describe("Signal Outcome Determination", () => {
        it("should mark signal as TP when target reached without hitting SL", () => {
            const signal: Signal = {
                ...mockSignal,
                signalType: "BOTTOM",
                price: 100,
            };

            logger.logSignal(signal, true);

            // Price moves directly to TP without hitting SL
            logger.updatePrice(100.2); // +0.2%
            logger.updatePrice(100.5); // +0.5%
            logger.updatePrice(100.71); // +0.71% - crosses TP threshold

            const validationData = logger["validationData"].get("test-123");
            const outcome = logger["checkSignalOutcome"](
                validationData!,
                100.71
            );

            expect(outcome.hitTarget).toBe(true);
            expect(outcome.hitStopLoss).toBe(false);
            expect(outcome.outcome).toBe("TP");
        });

        it("should mark signal as SL when stop loss hit before target", () => {
            const signal: Signal = {
                ...mockSignal,
                signalType: "BOTTOM",
                price: 100,
            };

            logger.logSignal(signal, true);

            // Price hits SL first
            logger.updatePrice(99.64); // -0.36% - crosses SL threshold
            logger.updatePrice(100.71); // Later reaches TP but SL was hit first

            const validationData = logger["validationData"].get("test-123");
            const outcome = logger["checkSignalOutcome"](
                validationData!,
                100.71
            );

            expect(outcome.hitTarget).toBe(true);
            expect(outcome.hitStopLoss).toBe(true);
            expect(outcome.outcome).toBe("SL"); // SL takes precedence
        });

        it("should handle case where neither TP nor SL is reached", () => {
            const signal: Signal = {
                ...mockSignal,
                signalType: "BOTTOM",
                price: 100,
            };

            logger.logSignal(signal, true);

            // Price stays in neutral zone
            logger.updatePrice(100.1); // +0.1%
            logger.updatePrice(99.9); // -0.1%
            logger.updatePrice(100.05); // +0.05%

            const validationData = logger["validationData"].get("test-123");
            const outcome = logger["checkSignalOutcome"](
                validationData!,
                100.05
            );

            expect(outcome.hitTarget).toBe(false);
            expect(outcome.hitStopLoss).toBe(false);
            expect(outcome.outcome).toBe("NEITHER");
        });
    });

    describe("Price History Tracking", () => {
        it("should track minimum and maximum prices correctly", () => {
            const signal: Signal = {
                ...mockSignal,
                signalType: "BOTTOM",
                price: 100,
            };

            logger.logSignal(signal, true);

            // Update prices
            logger.updatePrice(100.5);
            logger.updatePrice(99.5);
            logger.updatePrice(101);
            logger.updatePrice(99);

            const validationData = logger["validationData"].get("test-123");
            const priceHistory = validationData!.priceHistory;

            // Check min/max tracking
            expect(Math.min(...priceHistory.prices)).toBe(99);
            expect(Math.max(...priceHistory.prices)).toBe(101);
        });

        it("should maintain chronological order of price updates", () => {
            const signal: Signal = {
                ...mockSignal,
                signalType: "BOTTOM",
                price: 100,
            };

            logger.logSignal(signal, true);

            const prices = [100.1, 100.2, 99.9, 100.3];
            prices.forEach((price) => logger.updatePrice(price));

            const validationData = logger["validationData"].get("test-123");
            const priceHistory = validationData!.priceHistory;

            // Verify prices are stored in order
            expect(priceHistory.prices.slice(-4)).toEqual(prices);
        });
    });

    describe("Signal Classification Logic", () => {
        it("should only mark signals as successful if TP reached without SL", () => {
            const signal: Signal = {
                ...mockSignal,
                signalType: "BOTTOM",
                price: 100,
            };

            logger.logSignal(signal, true);

            // Direct TP hit
            logger.updatePrice(100.71);

            const validationData = logger["validationData"].get("test-123");
            validationData!.wasValidSignal = true; // Simulate validation

            const outcome = logger["checkSignalOutcome"](
                validationData!,
                100.71
            );
            const isSuccessful = outcome.hitTarget && !outcome.hitStopLoss;

            expect(isSuccessful).toBe(true);
            expect(outcome.outcome).toBe("TP");
        });

        it("should NOT mark signal as successful if SL hit before TP", () => {
            const signal: Signal = {
                ...mockSignal,
                signalType: "BOTTOM",
                price: 100,
            };

            logger.logSignal(signal, true);

            // SL hit first, then TP
            logger.updatePrice(99.64); // SL hit
            logger.updatePrice(100.71); // TP reached later

            const validationData = logger["validationData"].get("test-123");
            const outcome = logger["checkSignalOutcome"](
                validationData!,
                100.71
            );
            const isSuccessful = outcome.hitTarget && !outcome.hitStopLoss;

            expect(isSuccessful).toBe(false); // Not successful due to SL hit
            expect(outcome.outcome).toBe("SL");
        });
    });

    describe("Edge Cases and Boundary Conditions", () => {
        it("should handle exact TP threshold correctly", () => {
            const signal: Signal = {
                ...mockSignal,
                signalType: "BOTTOM",
                price: 100,
            };

            logger.logSignal(signal, true);

            // Exact TP: 100 * 1.007 = 100.7
            logger.updatePrice(100.7);

            const validationData = logger["validationData"].get("test-123");
            const outcome = logger["checkSignalOutcome"](
                validationData!,
                100.7
            );

            expect(outcome.hitTarget).toBe(true);
        });

        it("should handle exact SL threshold correctly", () => {
            const signal: Signal = {
                ...mockSignal,
                signalType: "BOTTOM",
                price: 100,
            };

            logger.logSignal(signal, true);

            // Exact SL: 100 * 0.9965 = 99.65
            logger.updatePrice(99.65);

            const validationData = logger["validationData"].get("test-123");
            const outcome = logger["checkSignalOutcome"](
                validationData!,
                99.65
            );

            expect(outcome.hitStopLoss).toBe(true);
        });

        it("should handle price at entry level", () => {
            const signal: Signal = {
                ...mockSignal,
                signalType: "BOTTOM",
                price: 100,
            };

            logger.logSignal(signal, true);
            logger.updatePrice(100); // Same as entry

            const validationData = logger["validationData"].get("test-123");
            const outcome = logger["checkSignalOutcome"](validationData!, 100);

            expect(outcome.hitTarget).toBe(false);
            expect(outcome.hitStopLoss).toBe(false);
            expect(outcome.percentMove).toBe(0);
        });

        it("should handle very small price movements", () => {
            const signal: Signal = {
                ...mockSignal,
                signalType: "BOTTOM",
                price: 100,
            };

            logger.logSignal(signal, true);

            // Small movements below both thresholds
            logger.updatePrice(100.001); // +0.001%
            logger.updatePrice(99.999); // -0.001%

            const validationData = logger["validationData"].get("test-123");
            const outcome = logger["checkSignalOutcome"](
                validationData!,
                100.001
            );

            expect(outcome.hitTarget).toBe(false);
            expect(outcome.hitStopLoss).toBe(false);
        });
    });

    describe("Multiple Signal Handling", () => {
        it("should track multiple signals independently", () => {
            const signal1: Signal = {
                ...mockSignal,
                correlationId: "signal-1",
                price: 100,
            };

            const signal2: Signal = {
                ...mockSignal,
                correlationId: "signal-2",
                price: 200,
            };

            logger.logSignal(signal1, true);
            logger.logSignal(signal2, true);

            // Update price affects both signals differently
            logger.updatePrice(100.71); // TP for signal1, not for signal2

            const validation1 = logger["validationData"].get("signal-1");
            const validation2 = logger["validationData"].get("signal-2");

            const outcome1 = logger["checkSignalOutcome"](validation1!, 100.71);
            const outcome2 = logger["checkSignalOutcome"](validation2!, 100.71);

            expect(outcome1.hitTarget).toBe(true); // Signal1 reached TP
            expect(outcome2.hitTarget).toBe(false); // Signal2 did not
            expect(outcome2.hitStopLoss).toBe(true); // Signal2 hit SL (massive drop from 200 to 100.71)
        });
    });

    describe("Validation File Writing", () => {
        it("should write successful signals to success file when TP reached without SL", () => {
            const writeFileSpy = vi.spyOn(logger as any, "writeValidationFile");

            const signal: Signal = {
                ...mockSignal,
                signalType: "BOTTOM",
                price: 100,
            };

            logger.logSignal(signal, true);
            logger.updatePrice(100.71); // TP reached

            // Trigger validation
            vi.advanceTimersByTime(60 * 60 * 1000); // 1 hour

            // Check if success file would be written
            const validationData = logger["validationData"].get("test-123");
            if (validationData) {
                const outcome = logger["checkSignalOutcome"](
                    validationData,
                    100.71
                );
                const shouldWriteSuccess =
                    outcome.hitTarget && !outcome.hitStopLoss;
                expect(shouldWriteSuccess).toBe(true);
            }
        });

        it("should NOT write to success file when SL hit before TP", () => {
            const signal: Signal = {
                ...mockSignal,
                signalType: "BOTTOM",
                price: 100,
            };

            logger.logSignal(signal, true);
            logger.updatePrice(99.64); // SL hit
            logger.updatePrice(100.71); // TP later

            const validationData = logger["validationData"].get("test-123");
            if (validationData) {
                const outcome = logger["checkSignalOutcome"](
                    validationData,
                    100.71
                );
                const shouldWriteSuccess =
                    outcome.hitTarget && !outcome.hitStopLoss;
                expect(shouldWriteSuccess).toBe(false);
            }
        });
    });

    describe("Threshold Values", () => {
        it("should use correct threshold values", () => {
            // Verify the thresholds match what's in the code
            expect(logger["STOP_LOSS_THRESHOLD"]).toBe(0.0035); // 0.35%
            expect(logger["TARGET_THRESHOLD"]).toBe(0.007); // 0.7%
        });

        it("should calculate movements as percentages correctly", () => {
            const signal: Signal = {
                ...mockSignal,
                signalType: "BOTTOM",
                price: 100,
            };

            logger.logSignal(signal, true);

            // Test various percentage calculations
            const testCases = [
                { price: 100.7, expectedPercent: 0.7 },
                { price: 99.65, expectedPercent: -0.35 },
                { price: 101, expectedPercent: 1.0 },
                { price: 99, expectedPercent: -1.0 },
            ];

            testCases.forEach(({ price, expectedPercent }) => {
                logger.updatePrice(price);
                const validationData = logger["validationData"].get("test-123");
                const outcome = logger["checkSignalOutcome"](
                    validationData!,
                    price
                );
                expect(outcome.percentMove).toBeCloseTo(expectedPercent, 2);
            });
        });
    });
});
