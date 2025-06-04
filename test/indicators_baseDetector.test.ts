import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { BaseDetector } from "../src/indicators/base/baseDetector";
import { Logger } from "../src/infrastructure/logger";
import { MetricsCollector } from "../src/infrastructure/metricsCollector";
import { SpoofingDetector } from "../src/services/spoofingDetector";
import type { AggressiveTrade } from "../src/types/marketEvents";
import { RollingWindow } from "../src/utils/rollingWindow";

vi.mock("../src/infrastructure/logger");
vi.mock("../src/infrastructure/metricsCollector");

class TestDetector extends BaseDetector {
    protected detectorType = "test" as const;
    constructor() {
        const logger = new Logger();
        const metrics = new MetricsCollector();
        const spoof = new SpoofingDetector({ tickSize: 0.01, wallTicks: 1, minWallSize: 1 });
        super(
            "1",
            () => {},
            {
                pricePrecision: 2,
                zoneTicks: 2,
                eventCooldownMs: 1000,
                features: {
                    multiZone: false,
                    adaptiveZone: false,
                    autoCalibrate: false,
                    priceResponse: false,
                    passiveHistory: false,
                    spoofingDetection: false,
                },
            },
            logger,
            spoof,
            metrics
        );
    }
    protected onEnrichedTradeSpecific(): void {}
    protected checkForSignal(): void {}
    protected getSignalType() { return "test" as const; }
    public calcZone(p: number) { return this.calculateZone(p); }
    public group(trades: AggressiveTrade[], ticks: number) { return this.groupTradesByZone(trades, ticks); }
    public volumes(zone: number, trades: AggressiveTrade[], ticks: number) { return this.calculateZoneVolumes(zone, trades, ticks); }
    public cooldown(zone: number, side: "buy" | "sell") { return this.checkCooldown(zone, side); }
}

describe("indicators/BaseDetector", () => {
    let det: TestDetector;
    beforeEach(() => {
        vi.useFakeTimers();
        det = new TestDetector();
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    const trade = (price: number, qty: number, ts: number): AggressiveTrade => ({
        price,
        quantity: qty,
        timestamp: ts,
        buyerIsMaker: false,
        pair: "TEST",
        tradeId: String(ts),
        originalTrade: {} as any,
    });

    it("calculates zones and groups trades", () => {
        const trades = [trade(100.01, 1, 1), trade(100.02, 1, 2), trade(100.07, 1, 3)];
        const grouped = det.group(trades, 2);
        expect(grouped.size).toBe(2);
        expect(det.calcZone(100.01)).toBe(100.02);
    });

    it("computes volumes and cooldown", () => {
        const zone = det.calcZone(100);
        const win = new RollingWindow<any>(10, false);
        win.push({ bid: 1, ask: 1, total: 2, timestamp: Date.now() });
        (det as any).zonePassiveHistory.set(zone, win);
        const vols = det.volumes(zone, [trade(100, 2, Date.now())], 2);
        expect(vols.aggressive).toBe(2);
        expect(vols.passive).toBe(2);
        expect(det.cooldown(zone, "buy")).toBe(true);
        expect(det.cooldown(zone, "buy")).toBe(false);
    });
});
