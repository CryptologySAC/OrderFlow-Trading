import { describe, it, expect, vi, beforeEach } from "vitest";
import {
    parseBool,
    CircularBuffer,
    TimeAwareCache,
    AdaptiveZoneCalculator,
    PassiveVolumeTracker,
    AutoCalibrator,
    PriceConfirmationManager,
    isValidBacklogRequest,
    calculateProfitTarget,
    calculateBreakeven,
    getAggressiveSide,
} from "../src/utils/utils";

describe("utils/utils", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });
    it("parseBool converts strings", () => {
        expect(parseBool("true")).toBe(true);
        expect(parseBool("false")).toBe(false);
        expect(parseBool(undefined, true)).toBe(true);
    });

    it("CircularBuffer stores items in order", () => {
        const b = new CircularBuffer<number>(3);
        b.add(1);
        b.add(2);
        b.add(3);
        b.add(4);
        expect([...b]).toEqual([2, 3, 4]);
        expect(b.at(0)).toBe(2);
        expect(b.length).toBe(3);
    });

    it("TimeAwareCache expires items", () => {
        const c = new TimeAwareCache<string, number>(10);
        c.set("a", 1);
        expect(c.get("a")).toBe(1);
        vi.advanceTimersByTime(20);
        expect(c.get("a")).toBeUndefined();
    });

    it("AdaptiveZoneCalculator computes zone width", () => {
        const calc = new AdaptiveZoneCalculator(3);
        calc.updatePrice(1);
        calc.updatePrice(2);
        calc.updatePrice(3);
        expect(calc.getATR()).toBeGreaterThan(0);
        const zone = calc.getAdaptiveZoneTicks(2);
        expect(zone).toBeGreaterThan(0);
    });

    it("PassiveVolumeTracker detects refill", () => {
        const tracker = new PassiveVolumeTracker();
        tracker.updatePassiveVolume(100, 10, 10);
        vi.advanceTimersByTime(1000);
        tracker.updatePassiveVolume(100, 12, 12);
        vi.advanceTimersByTime(1000);
        tracker.updatePassiveVolume(100, 14, 14);
        vi.advanceTimersByTime(1000);
        tracker.updatePassiveVolume(100, 16, 16);
        vi.advanceTimersByTime(1000);
        tracker.updatePassiveVolume(100, 19, 19);
        expect(tracker.hasPassiveRefilled(100, "buy", 5000)).toBe(true);
    });

    it("AutoCalibrator adjusts volume", () => {
        const auto = new AutoCalibrator();
        auto.recordSignal();
        vi.advanceTimersByTime(16 * 60 * 1000);
        const result = auto.calibrate(100);
        expect(result).toBeLessThan(100);
    });

    it("PriceConfirmationManager confirms", () => {
        const mgr = new PriceConfirmationManager();
        mgr.addPendingDetection({
            time: Date.now(),
            price: 100,
            side: "buy",
            zone: 1,
            trades: [],
            aggressive: 1,
            passive: 1,
            refilled: false,
            confirmed: false,
            id: "1",
        });
        const confirmed = mgr.processPendingConfirmations(
            101,
            2,
            5,
            10,
            1000
        );
        expect(confirmed.length).toBe(1);
    });

    it("isValidBacklogRequest works", () => {
        expect(isValidBacklogRequest({ type: "backlog" })).toBe(true);
        expect(isValidBacklogRequest({})).toBe(false);
    });

    it("calculates profit and breakeven", () => {
        expect(calculateProfitTarget(100, "buy")).toBeGreaterThan(100);
        expect(calculateBreakeven(100, "sell")).toBeLessThan(100);
        expect(getAggressiveSide(false)).toBe("buy");
    });
});
