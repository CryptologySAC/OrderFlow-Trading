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
    getAggressiveSide,
} from "../src/utils/utils";
import {
    calculateProfitTarget,
    calculateBreakeven,
} from "../src/utils/calculations";

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
        const logger = { logEvent: vi.fn() } as unknown as ISignalLogger;
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
            1000,
            logger,
            "SYM"
        );
        expect(confirmed.length).toBe(1);
        expect(logger.logEvent).toHaveBeenCalled();
    });

    it("isValidBacklogRequest works", () => {
        expect(isValidBacklogRequest({ type: "backlog" })).toBe(true);
        expect(isValidBacklogRequest({})).toBe(false);
    });

    it("calculates profit and breakeven", () => {
        expect(calculateProfitTarget(100, "buy").price).toBeGreaterThan(100);
        expect(calculateBreakeven(100, "sell")).toBeLessThan(100);
        expect(getAggressiveSide(false)).toBe("buy");
    });

    it("CircularBuffer filter and clear", () => {
        const b = new CircularBuffer<number>(5);
        b.add(1);
        b.add(2);
        b.add(3);
        const even = b.filter((v) => v % 2 === 0);
        expect(even).toEqual([2]);
        b.clear();
        expect(b.length).toBe(0);
        expect([...b]).toEqual([]);
    });

    it("TimeAwareCache utilities", () => {
        const c = new TimeAwareCache<string, number>(10);
        c.set("a", 1);
        expect(c.has("a")).toBe(true);
        c.delete("a");
        expect(c.has("a")).toBe(false);

        c.set("b", 2);
        vi.advanceTimersByTime(20);
        c.forceCleanup();
        expect(c.get("b")).toBeUndefined();

        c.set("c", 3);
        (c as any).lastCleanup = Date.now() - 61000;
        vi.advanceTimersByTime(20);
        c.set("d", 4); // triggers maybeCleanup removing "c"
        expect(c.get("c")).toBeUndefined();
        expect(c.size()).toBe(1);
        expect(c.keys()).toEqual(["d"]);
    });

    it("AdaptiveZoneCalculator shifts window", () => {
        const calc = new AdaptiveZoneCalculator(3);
        calc.updatePrice(1);
        calc.updatePrice(3);
        calc.updatePrice(5);
        calc.updatePrice(7); // trigger shift
        expect(calc.getATR()).toBeGreaterThan(0);
        expect(calc.getAdaptiveZoneTicks(1)).toBe(10);
    });

    it("PassiveVolumeTracker averages and refill check", () => {
        const tracker = new PassiveVolumeTracker();
        tracker.updatePassiveVolume(200, 10, 20);
        vi.advanceTimersByTime(1000);
        tracker.updatePassiveVolume(200, 20, 30);
        vi.advanceTimersByTime(1000);
        tracker.updatePassiveVolume(200, 30, 40);

        expect(tracker.checkRefillStatus(200, "buy", 40)).toBe(true);
        expect(tracker.getAveragePassive(200, 1500)).toBe(60);
        expect(tracker.getAveragePassiveBySide(200, "buy", 1500)).toBe(35);
        expect(tracker.getAveragePassiveBySide(200, "sell", 1500)).toBe(25);

        vi.advanceTimersByTime(2000);
        expect(tracker.getAveragePassiveBySide(200, "buy", 1000)).toBe(0);
        expect(tracker.getAveragePassiveBySide(201, "buy", 1000)).toBe(0);
        expect(tracker.getAveragePassive(200, 1000)).toBe(0);
        expect(tracker.getAveragePassive(999, 1000)).toBe(0);
    });

    it("AutoCalibrator raises volume when busy", () => {
        const auto = new AutoCalibrator();
        for (let i = 0; i < 11; i++) {
            auto.recordSignal();
        }
        vi.advanceTimersByTime(16 * 60 * 1000);
        const result = auto.calibrate(100);
        expect(result).toBeGreaterThan(100);
    });

    it("AutoCalibrator keeps volume when moderate", () => {
        const auto = new AutoCalibrator();
        for (let i = 0; i < 5; i++) auto.recordSignal();
        vi.advanceTimersByTime(16 * 60 * 1000);
        const result = auto.calibrate(50);
        expect(result).toBe(50);
    });

    it("PriceConfirmationManager invalidates by revisit", () => {
        const logger = { logEvent: vi.fn() } as unknown as ISignalLogger;
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
        mgr.processPendingConfirmations(99.9, 2, 50, 5, 1000, logger, "SYM");
        expect(logger.logEvent).toHaveBeenCalled();
        expect(mgr.getPendingCount()).toBe(0);
    });

    it("PriceConfirmationManager keeps pending when idle", () => {
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
            id: "pending",
        });
        const res = mgr.processPendingConfirmations(100, 2, 5, 10, 1000);
        expect(res.length).toBe(0);
        expect(mgr.getPendingCount()).toBe(1);
    });

    it("PriceConfirmationManager invalidates by timeout", () => {
        const logger = { logEvent: vi.fn() } as unknown as ISignalLogger;
        const mgr = new PriceConfirmationManager();
        mgr.addPendingDetection({
            time: Date.now() - 2000,
            price: 100,
            side: "sell",
            zone: 1,
            trades: [],
            aggressive: 1,
            passive: 1,
            refilled: false,
            confirmed: false,
            id: "2",
        });
        mgr.processPendingConfirmations(100, 2, 5, 10, 1000, logger, "SYM");
        expect(logger.logEvent).toHaveBeenCalled();
        expect(mgr.getPendingCount()).toBe(0);
    });

    it("profit and breakeven other sides", () => {
        expect(calculateProfitTarget(100, "sell").price).toBeLessThan(100);
        expect(calculateBreakeven(100, "buy")).toBeGreaterThan(100);
        expect(getAggressiveSide(true)).toBe("sell");
    });
});
