import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Mock the WorkerLogger before importing
vi.mock("../src/multithreading/workerLogger");

import { BaseDetector } from "../src/indicators/base/baseDetector";
import { WorkerLogger } from "../src/multithreading/workerLogger";
import { MetricsCollector } from "../src/infrastructure/metricsCollector";
import { SpoofingDetector } from "../src/services/spoofingDetector";
import type {
    EnrichedTradeEvent,
    AggressiveTrade,
} from "../src/types/marketEvents";

vi.mock("../src/infrastructure/logger");
vi.mock("../src/infrastructure/metricsCollector");

class TestDetector extends BaseDetector {
    public signals: { zone: number; aggressive: number; passive: number }[] =
        [];
    protected detectorType = "test" as const;
    private mockCallback = vi.fn();

    constructor() {
        const logger = new WorkerLogger();
        const metrics = new MetricsCollector();
        const spoof = {
            checkWallSpoofing: vi.fn().mockReturnValue(false),
            getWallDetectionMetrics: vi.fn().mockReturnValue({}),
            wasSpoofed: vi.fn().mockReturnValue(false),
            trackPassiveChange: vi.fn(),
        } as any;

        super(
            "1",
            {
                pricePrecision: 2,
                zoneTicks: 2,
                eventCooldownMs: 1000,
                symbol: "BTCUSDT",
                windowMs: 60000,
                minAggVolume: 100,
                features: {
                    multiZone: false,
                    adaptiveZone: false,
                    autoCalibrate: false,
                    passiveHistory: true,
                    spoofingDetection: false,
                },
            },
            logger,
            spoof,
            metrics
        );

        // Register callback manually since constructor doesn't take it anymore
        this.on("signal", this.mockCallback);
    }
    protected onEnrichedTradeSpecific(): void {}
    protected getSignalType() {
        return "test" as const;
    }
    protected checkForSignal(trade: AggressiveTrade): void {
        const zone = this.calculateZone(trade.price);
        const bucket = this.zoneAgg.get(zone)!;
        const { aggressive, passive } = this.calculateZoneVolumes(
            zone,
            bucket.trades,
            this.zoneTicks
        );
        const side = trade.buyerIsMaker ? "sell" : "buy";
        if (aggressive >= 2 && this.checkCooldown(zone, side, true)) {
            this.signals.push({ zone, aggressive, passive });
        }
    }
}

const makeEvent = (
    price: number,
    qty: number,
    ts: number
): EnrichedTradeEvent => ({
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
        // With zoneTicks=2 and precision=2, zone size = 0.02
        // Use prices that map to the same zone (100.02)
        det.onEnrichedTrade(makeEvent(100.02, 1, now)); // → zone 100.02
        det.onEnrichedTrade(makeEvent(100.03, 1, now + 1)); // → zone 100.02
        det.onEnrichedTrade(makeEvent(100.039, 1, now + 2)); // → zone 100.02
        expect(det.signals.length).toBe(1);
        expect(det.signals[0]).toMatchObject({
            zone: 100.02,
            aggressive: 2, // Need >= 2 aggressive volume to trigger
            passive: 2, // 2 trades processed when signal was generated
        });
    });

    it("enforces cooldown between detections", () => {
        const now = Date.now();
        det.onEnrichedTrade(makeEvent(100, 1, now));
        det.onEnrichedTrade(makeEvent(100, 1, now + 1));
        det.markSignalConfirmed(det.calculateZone(100), "buy");
        expect(det.signals.length).toBe(1);
        det.onEnrichedTrade(makeEvent(100, 1, now + 2));
        expect(det.signals.length).toBe(1);
        vi.advanceTimersByTime(1001);
        det.onEnrichedTrade(makeEvent(100, 1, now + 1001));
        expect(det.signals.length).toBe(2);
    });
});
