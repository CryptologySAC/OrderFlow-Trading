import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { SwingMetrics } from "../src/indicators/swingMetrics";
import type { TradeData } from "../src/utils/utils";

describe("indicators/SwingMetrics", () => {
    let metrics: SwingMetrics;

    const makeTrade = (
        price: number,
        qty: number,
        buyerIsMaker: boolean,
        ts: number
    ): TradeData => ({
        price,
        quantity: qty,
        timestamp: ts,
        buyerIsMaker,
        originalTrade: {} as any,
    });

    beforeEach(() => {
        vi.useFakeTimers();
        metrics = new SwingMetrics();
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it("computes volume nodes", () => {
        const now = Date.now();
        metrics.addTrade(makeTrade(100, 2, false, now));
        metrics.addTrade(makeTrade(101, 0.5, true, now));

        const nodes = metrics.getVolumeNodes(100);
        expect(nodes.poc).toBe(100);
        expect(nodes.hvn).toContain(100);
        expect(nodes.lvn).toContain(101);
    });

    it("cleans up old levels", () => {
        const now = Date.now();
        metrics.addTrade(makeTrade(100, 1, false, now));
        vi.advanceTimersByTime(1_800_001);
        metrics.addTrade(makeTrade(101, 1, false, Date.now()));
        const stats = metrics.getStats();
        expect(stats.levels).toBe(1);
    });
});
