import { describe, it, expect } from "vitest";
import {
    calculateProfitTarget,
    calculateBreakeven,
    calculatePositionSize,
    calculateStopLoss,
} from "../src/utils/calculations";

describe("utils/calculations", () => {
    it("calculates profit target for buy", () => {
        const result = calculateProfitTarget(100, "buy", 0.02, 0.001);
        expect(result.price).toBeCloseTo(100 * (1 + 0.02 + 0.002));
        expect(result.percentGain).toBeCloseTo(0.02);
        expect(result.netGain).toBeCloseTo(0.02 - 0.002);
    });

    it("calculates breakeven for sell", () => {
        expect(calculateBreakeven(100, "sell", 0.001)).toBeCloseTo(
            100 * (1 - 0.002)
        );
    });

    it("calculates position size", () => {
        expect(calculatePositionSize(10000, 0.5, 0.02)).toBeCloseTo(100);
    });

    it("calculates stop loss", () => {
        expect(calculateStopLoss(100, "buy", 0.05)).toBeCloseTo(95);
    });
});
