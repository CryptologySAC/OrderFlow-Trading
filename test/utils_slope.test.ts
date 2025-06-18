import { describe, it, expect } from "vitest";

function calculateSlope(x: number[], y: number[]): number {
    const n = x.length;
    const sumX = x.reduce((s, v) => s + v, 0);
    const sumY = y.reduce((s, v) => s + v, 0);
    const sumXY = x.reduce((s, v, i) => s + v * y[i], 0);
    const sumX2 = x.reduce((s, v) => s + v * v, 0);
    const denom = n * sumX2 - sumX * sumX;
    if (denom === 0) return 0;
    return (n * sumXY - sumX * sumY) / denom;
}

describe("slope calculation", () => {
    it("handles timestamp input", () => {
        const times = [1000, 2000, 3000, 4000, 5000];
        const values = [2, 4, 6, 8, 10];
        const slope = calculateSlope(times, values);
        expect(slope).toBeCloseTo(0.002, 6);
    });
});
