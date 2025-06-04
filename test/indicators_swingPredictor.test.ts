import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { SwingPredictor } from "../src/indicators/swingPredictor";
import type { Signal } from "../src/types/signalTypes";

describe("indicators/SwingPredictor", () => {
    let predicted: any[];
    let predictor: SwingPredictor;
    const cb = (p: any) => predicted.push(p);

    beforeEach(() => {
        vi.useFakeTimers();
        predicted = [];
        predictor = new SwingPredictor(
            { lookaheadMs: 1000, retraceTicks: 1 },
            cb
        );
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    const makeSignal = (): Signal => ({
        id: "1",
        type: "absorption",
        side: "buy",
        price: 100,
        time: Date.now(),
        confidence: 1,
    });

    it("emits swing after retrace", () => {
        predictor.onSignal(makeSignal());
        predictor.onPrice(99.98, Date.now());
        predictor.onPrice(100, Date.now() + 1);
        expect(predicted.length).toBe(1);
        expect(predicted[0].type).toBe("swingLow");
    });

    it("deduplicates signals", () => {
        const sig = makeSignal();
        predictor.onSignal(sig);
        predictor.onSignal(sig);
        predictor.onPrice(99.98, Date.now());
        predictor.onPrice(100, Date.now() + 1);
        expect(predicted.length).toBe(1);
    });
});
