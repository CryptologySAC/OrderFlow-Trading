import { AlertManager } from "../src/alerts/alertManager";
import type { Signal, SwingSignalData } from "../src/types/signalTypes";
import { calculateBreakeven, calculateProfitTarget } from "../src/utils/calculations";

vi.mock("../src/utils/calculations");

const sampleSignal = (): Signal => {
    const data: SwingSignalData = {
        accumulation: {
            price: 100,
            side: "buy",
            isAccumulating: true,
            strength: 1,
            duration: 1,
            zone: 1,
            ratio: 1,
            confidence: 1,
        },
        divergence: {
            type: "bullish",
            strength: 1,
            priceSlope: 1,
            volumeSlope: 1,
        },
        expectedGainPercent: 0.01,
        swingType: "low",
        strength: 1,
        confidence: 1,
        supportingSignals: [],
        meta: {},
        side: "buy",
        price: 100,
    };

    return {
        id: "1",
        type: "flow",
        time: Date.now(),
        price: 100,
        side: "buy",
        signalData: data,
    };
};

describe("AlertManager", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        (calculateBreakeven as any).mockReturnValue(0);
        (calculateProfitTarget as any).mockReturnValue({
            price: 0,
            percentGain: 0,
            netGain: 0,
        });
    });

    it("formats and sends webhook alert", async () => {
        const manager = new AlertManager("http://example.com", 0);
        (global as any).fetch = vi.fn(async () => ({ ok: true }));

        (calculateBreakeven as any).mockReturnValue(101);
        (calculateProfitTarget as any)
            .mockReturnValueOnce({ price: 110, percentGain: 0.01, netGain: 0.009 })
            .mockReturnValueOnce({ price: 120, percentGain: 0.02, netGain: 0.018 });

        await manager.sendAlert(sampleSignal());

        expect(fetch).toHaveBeenCalled();
        const call = (fetch as any).mock.calls[0];
        expect(call[0]).toBe("http://example.com");
        const body = JSON.parse(call[1].body);
        expect(body.side).toBe("buy");
        expect(body.reasoning).toContain("Accumulation detected");
        expect(body.reasoning).toContain("Bullish divergence");
        expect(body.targets.profit1).toBe(110);
        expect(body.targets.profit2).toBe(120);
        expect(calculateBreakeven).toHaveBeenCalledWith(100, "buy");
        expect(calculateProfitTarget).toHaveBeenCalledWith(100, "buy", 0.01);
        expect(calculateProfitTarget).toHaveBeenCalledWith(100, "buy", 0.02);
    });

    it("honors cooldown between alerts", async () => {
        const manager = new AlertManager("http://example.com", 10000);
        (global as any).fetch = vi.fn(async () => ({ ok: true }));

        await manager.sendAlert(sampleSignal());
        await manager.sendAlert(sampleSignal());

        expect(fetch).toHaveBeenCalledTimes(1);
    });

    it("throws when webhook response not ok", async () => {
        const manager = new AlertManager("http://bad.com");
        (global as any).fetch = vi.fn(async () => ({ ok: false, statusText: "Bad" }));
        await expect((manager as any).sendWebhook({})).rejects.toThrow();
    });
});
