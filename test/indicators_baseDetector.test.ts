import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { BaseDetector } from "../src/indicators/base/baseDetector";
import { Logger } from "../src/infrastructure/logger";
import { MetricsCollector } from "../src/infrastructure/metricsCollector";
import { SpoofingDetector } from "../src/services/spoofingDetector";
import type { EnrichedTradeEvent, AggressiveTrade } from "../src/types/marketEvents";

vi.mock("../src/infrastructure/logger");
vi.mock("../src/infrastructure/metricsCollector");

class TestDetector extends BaseDetector {
    public signals: { zone: number; aggressive: number; passive: number }[] = [];
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
                    passiveHistory: true,
                    spoofingDetection: false,
                },
            },
            logger,
            spoof,
            metrics
        );
    }
    protected onEnrichedTradeSpecific(): void {}
    protected getSignalType() {
        return "test" as const;
    }
    protected checkForSignal(trade: AggressiveTrade): void {
        const zone = this.calculateZone(trade.price);
        const bucket = this.zoneAgg.get(zone)!;
        const { aggressive, passive } = this.calculateZoneVolumes(zone, bucket.trades, this.zoneTicks);
        const side = trade.buyerIsMaker ? "sell" : "buy";
        if (aggressive >= 2 && this.checkCooldown(zone, side)) {
            this.signals.push({ zone, aggressive, passive });
        }
    }
}

const makeEvent = (price: number, qty: number, ts: number): EnrichedTradeEvent => ({
    price,
    quantity: qty,
    timestamp: ts,
    buyerIsMaker: false,
    pair: "TEST",
    tradeId: String(ts),
    originalTrade: {} as any,
    passiveBidVolume: 1,
    passiveAskVolume: 1,
    zonePassiveBidVolume: 1,
    zonePassiveAskVolume: 1,
});

describe("indicators/BaseDetector", () => {
    let det: TestDetector;
    beforeEach(() => {
        vi.useFakeTimers();
        det = new TestDetector();
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it("groups trades into zones and emits once per threshold", () => {
        const now = Date.now();
        det.onEnrichedTrade(makeEvent(100.01, 1, now));
        det.onEnrichedTrade(makeEvent(100.02, 1, now + 1));
        det.onEnrichedTrade(makeEvent(100.07, 1, now + 2));
        expect(det.signals.length).toBe(1);
        expect(det.signals[0]).toMatchObject({ zone: 100.02, aggressive: 2, passive: 2 });
    });

    it("enforces cooldown between detections", () => {
        const now = Date.now();
        det.onEnrichedTrade(makeEvent(100, 1, now));
        det.onEnrichedTrade(makeEvent(100, 1, now + 1));
        expect(det.signals.length).toBe(1);
        det.onEnrichedTrade(makeEvent(100, 1, now + 2));
        expect(det.signals.length).toBe(1);
        vi.advanceTimersByTime(1001);
        det.onEnrichedTrade(makeEvent(100, 1, now + 1001));
        expect(det.signals.length).toBe(2);
    });
});
