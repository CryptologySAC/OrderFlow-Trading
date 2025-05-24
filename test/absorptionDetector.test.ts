import {
    AbsorptionDetector,
    AbsorptionSettings,
} from "../src/absorptionDetector";
import { SpotWebsocketStreams } from "@binance/spot";

describe("AbsorptionDetector", () => {
    it("should not trigger signal below min volume", () => {
        const mockCallback = jest.fn();
        const detector = new AbsorptionDetector(mockCallback, {
            windowMs: 30000,
            minAggVolume: 500,
            pricePrecision: 2,
            zoneTicks: 3,
        });

        const trade: SpotWebsocketStreams.AggTradeResponse = {
            e: "aggTrade",
            s: "LTCUSDT",
            a: 123456,
            p: "95.00",
            q: "10",
            f: 100,
            l: 101,
            T: Date.now(),
            m: false,
            M: true,
        };

        detector.addTrade(trade);
        expect(mockCallback).not.toHaveBeenCalled();
    });
});
