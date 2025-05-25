import { SwingPredictor, SwingPrediction } from "../src/swingPredictor";
import { Signal } from "../src/interfaces.js";
import { jest } from "@jest/globals";

describe("SwingPredictor", () => {
    let predictions: SwingPrediction[] = [];
    let predictor: SwingPredictor;

    beforeEach(() => {
        predictions = [];
        predictor = new SwingPredictor({
            lookaheadMs: 60000,
            retraceTicks: 5,
            pricePrecision: 2,
            signalCooldownMs: 10000,
            onSwingPredicted: (prediction) => predictions.push(prediction),
        });
    });

    it("should emit swingLow on valid retrace after long signal", () => {
        const signal: Signal = {
            time: Date.now(),
            price: 100.0,
            type: "absorption_confirmed",
        };

        predictor.onSignal(signal);
        predictor.onPrice(99.9, signal.time + 1000); // 1 tick retrace
        predictor.onPrice(99.75, signal.time + 2000); // 2.5 tick retrace

        expect(predictions.length).toBe(1);
        expect(predictions[0].type).toBe("swingLow");
    });

    it("should not emit swingHigh if retrace threshold not met", () => {
        const signal: Signal = {
            time: Date.now(),
            price: 100.0,
            type: "exhaustion_confirmed",
        };

        predictor.onSignal(signal);
        predictor.onPrice(100.01, signal.time + 1000); // 0.5 tick retrace

        expect(predictions.length).toBe(0);
    });

    it("should not emit duplicate predictions within cooldown", () => {
        const signal: Signal = {
            time: Date.now(),
            price: 100.0,
            type: "absorption_confirmed",
        };

        predictor.onSignal(signal);
        predictor.onPrice(99.75, signal.time + 1000); // First retrace
        predictor.onSignal(signal);
        predictor.onPrice(99.75, signal.time + 2000); // Second retrace within cooldown

        expect(predictions.length).toBe(1);
    });
});
