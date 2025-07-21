import { describe, it, expect } from "vitest";
import { RollingWindow } from "../src/utils/rollingWindow";

describe("utils/rollingWindow", () => {
    it("computes stats over window", () => {
        const w = new RollingWindow(5);
        [1, 2, 3, 4, 5].forEach((n) => w.push(n));
        expect(w.count()).toBe(5);
        expect(w.mean()).toBe(3);
        expect(w.min()).toBe(1);
        expect(w.max()).toBe(5);
        expect(w.sum()).toBe(15);
        expect(w.stdDev()).toBeGreaterThan(0);
    });

    it("rotates when full", () => {
        const w = new RollingWindow(3);
        [1, 2, 3, 4].forEach((n) => w.push(n));
        expect(w.toArray()).toEqual([2, 3, 4]);
        expect(w.sum()).toBe(9);
        expect(w.stdDev()).toBeGreaterThan(0);
    });
});
