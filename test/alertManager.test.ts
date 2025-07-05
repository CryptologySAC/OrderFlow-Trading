import { AlertManager } from "../src/alerts/alertManager";
import type { Signal, SwingSignalData } from "../src/types/signalTypes";
import type { ILogger } from "../src/infrastructure/loggerInterface";
import {
    calculateBreakeven,
    calculateProfitTarget,
} from "../src/utils/calculations";

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
        type: "accumulation",
        time: Date.now(),
        price: 100,
        side: "buy",
        signalData: data,
    };
};

describe("AlertManager", () => {
    let mockLogger: ILogger;

    beforeEach(() => {
        vi.clearAllMocks();
        mockLogger = {
            info: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
            debug: vi.fn(),
            isDebugEnabled: vi.fn(() => false),
            setCorrelationId: vi.fn(),
            removeCorrelationId: vi.fn(),
        };
        (calculateBreakeven as any).mockReturnValue(0);
        (calculateProfitTarget as any).mockReturnValue({
            price: 0,
            percentGain: 0,
            netGain: 0,
        });
    });

    it("formats and sends webhook alert", async () => {
        const manager = new AlertManager("http://example.com", 0, mockLogger);
        (global as any).fetch = vi.fn(async () => ({ ok: true }));

        (calculateBreakeven as any).mockReturnValue(101);
        (calculateProfitTarget as any)
            .mockReturnValueOnce({
                price: 110,
                percentGain: 0.01,
                netGain: 0.009,
            })
            .mockReturnValueOnce({
                price: 120,
                percentGain: 0.02,
                netGain: 0.018,
            });

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
        const manager = new AlertManager(
            "http://example.com",
            10000,
            mockLogger
        );
        (global as any).fetch = vi.fn(async () => ({ ok: true }));

        await manager.sendAlert(sampleSignal());
        await manager.sendAlert(sampleSignal());

        expect(fetch).toHaveBeenCalledTimes(1);
    });

    it("throws when webhook response not ok", async () => {
        const manager = new AlertManager("http://bad.com", 0, mockLogger);
        (global as any).fetch = vi.fn(async () => ({
            ok: false,
            statusText: "Bad",
        }));
        await expect((manager as any).sendWebhook({})).rejects.toThrow();
    });

    describe("Nuclear Cleanup: All 5 Standardized Signal Types Support", () => {
        beforeEach(() => {
            (global as any).fetch = vi.fn(async () => ({ ok: true }));
            (calculateBreakeven as any).mockReturnValue(101);
            (calculateProfitTarget as any)
                .mockReturnValueOnce({
                    price: 110,
                    percentGain: 0.01,
                    netGain: 0.009,
                })
                .mockReturnValueOnce({
                    price: 120,
                    percentGain: 0.02,
                    netGain: 0.018,
                });
        });

        it("should handle absorption signals correctly", async () => {
            const manager = new AlertManager(
                "http://example.com",
                0,
                mockLogger
            );
            const absorptionSignal: Signal = {
                id: "absorption-1",
                type: "absorption",
                time: Date.now(),
                price: 100,
                side: "sell",
                signalData: {},
            };

            await manager.sendAlert(absorptionSignal);

            expect(fetch).toHaveBeenCalled();
            const call = (fetch as any).mock.calls[0];
            const body = JSON.parse(call[1].body);
            expect(body.side).toBe("sell");
            expect(body.type).toBe("swing_entry");
            expect(calculateBreakeven).toHaveBeenCalledWith(100, "sell");
            expect(calculateProfitTarget).toHaveBeenCalledWith(
                100,
                "sell",
                0.01
            );
            expect(calculateProfitTarget).toHaveBeenCalledWith(
                100,
                "sell",
                0.02
            );
        });

        it("should handle exhaustion signals correctly", async () => {
            const manager = new AlertManager(
                "http://example.com",
                0,
                mockLogger
            );
            const exhaustionSignal: Signal = {
                id: "exhaustion-1",
                type: "exhaustion",
                time: Date.now(),
                price: 85,
                side: "buy",
                signalData: {},
            };

            await manager.sendAlert(exhaustionSignal);

            expect(fetch).toHaveBeenCalled();
            const call = (fetch as any).mock.calls[0];
            const body = JSON.parse(call[1].body);
            expect(body.side).toBe("buy");
            expect(body.type).toBe("swing_entry");
            expect(calculateBreakeven).toHaveBeenCalledWith(85, "buy");
            expect(calculateProfitTarget).toHaveBeenCalledWith(85, "buy", 0.01);
            expect(calculateProfitTarget).toHaveBeenCalledWith(85, "buy", 0.02);
        });

        it("should handle accumulation signals correctly", async () => {
            const manager = new AlertManager(
                "http://example.com",
                0,
                mockLogger
            );
            const accumulationSignal: Signal = {
                id: "accumulation-1",
                type: "accumulation",
                time: Date.now(),
                price: 90,
                side: "buy",
                signalData: {
                    accumulation: {
                        price: 90,
                        side: "buy",
                        isAccumulating: true,
                        strength: 0.8,
                        duration: 300000,
                        zone: 1,
                        ratio: 0.7,
                        confidence: 0.9,
                    },
                    divergence: {
                        type: "bullish",
                        strength: 0.7,
                        priceSlope: 0.1,
                        volumeSlope: -0.1,
                    },
                },
            };

            await manager.sendAlert(accumulationSignal);

            expect(fetch).toHaveBeenCalled();
            const call = (fetch as any).mock.calls[0];
            const body = JSON.parse(call[1].body);
            expect(body.side).toBe("buy");
            expect(body.reasoning).toContain("Accumulation detected");
            expect(body.reasoning).toContain("Bullish divergence");
            expect(calculateBreakeven).toHaveBeenCalledWith(90, "buy");
        });

        it("should handle distribution signals correctly", async () => {
            const manager = new AlertManager(
                "http://example.com",
                0,
                mockLogger
            );
            const distributionSignal: Signal = {
                id: "distribution-1",
                type: "distribution",
                time: Date.now(),
                price: 95,
                side: "sell",
                signalData: {},
            };

            await manager.sendAlert(distributionSignal);

            expect(fetch).toHaveBeenCalled();
            const call = (fetch as any).mock.calls[0];
            const body = JSON.parse(call[1].body);
            expect(body.side).toBe("sell");
            expect(body.type).toBe("swing_entry");
            expect(calculateBreakeven).toHaveBeenCalledWith(95, "sell");
            expect(calculateProfitTarget).toHaveBeenCalledWith(
                95,
                "sell",
                0.01
            );
            expect(calculateProfitTarget).toHaveBeenCalledWith(
                95,
                "sell",
                0.02
            );
        });

        it("should handle deltacvd signals correctly", async () => {
            const manager = new AlertManager(
                "http://example.com",
                0,
                mockLogger
            );
            const deltacvdSignal: Signal = {
                id: "deltacvd-1",
                type: "deltacvd",
                time: Date.now(),
                price: 88,
                side: "buy",
                signalData: {
                    accumulation: {
                        price: 88,
                        side: "buy",
                        isAccumulating: false,
                        strength: 0.5,
                        duration: 180000,
                        zone: 2,
                        ratio: 0.6,
                        confidence: 0.7,
                    },
                    divergence: {
                        type: "bullish",
                        strength: 0.8,
                        priceSlope: 0.1,
                        volumeSlope: -0.2,
                    },
                },
            };

            await manager.sendAlert(deltacvdSignal);

            expect(fetch).toHaveBeenCalled();
            const call = (fetch as any).mock.calls[0];
            const body = JSON.parse(call[1].body);
            expect(body.side).toBe("buy");
            expect(body.reasoning).toContain("Bullish divergence");
            expect(calculateBreakeven).toHaveBeenCalledWith(88, "buy");
            expect(calculateProfitTarget).toHaveBeenCalledWith(88, "buy", 0.01);
            expect(calculateProfitTarget).toHaveBeenCalledWith(88, "buy", 0.02);
        });

        it("should handle signals with bearish divergence correctly", async () => {
            const manager = new AlertManager(
                "http://example.com",
                0,
                mockLogger
            );
            const deltacvdSignal: Signal = {
                id: "deltacvd-2",
                type: "deltacvd",
                time: Date.now(),
                price: 92,
                side: "sell",
                signalData: {
                    accumulation: {
                        price: 92,
                        side: "sell",
                        isAccumulating: false,
                        strength: 0.3,
                        duration: 240000,
                        zone: 3,
                        ratio: 0.4,
                        confidence: 0.6,
                    },
                    divergence: {
                        type: "bearish",
                        strength: 0.7,
                        priceSlope: 0.2,
                        volumeSlope: -0.1,
                    },
                },
            };

            await manager.sendAlert(deltacvdSignal);

            expect(fetch).toHaveBeenCalled();
            const call = (fetch as any).mock.calls[0];
            const body = JSON.parse(call[1].body);
            expect(body.side).toBe("sell");
            expect(body.reasoning).toContain("Bearish divergence");
            expect(calculateBreakeven).toHaveBeenCalledWith(92, "sell");
        });

        it("should use signal.side directly for all signal types (trading engine safety)", async () => {
            const manager = new AlertManager(
                "http://example.com",
                0,
                mockLogger
            );

            // Test all 5 signal types with both buy and sell sides
            const signalTypes: Array<
                | "absorption"
                | "exhaustion"
                | "accumulation"
                | "distribution"
                | "deltacvd"
            > = [
                "absorption",
                "exhaustion",
                "accumulation",
                "distribution",
                "deltacvd",
            ];
            const sides: Array<"buy" | "sell"> = ["buy", "sell"];

            for (const type of signalTypes) {
                for (const side of sides) {
                    // Reset mocks for each test
                    vi.clearAllMocks();
                    (global as any).fetch = vi.fn(async () => ({ ok: true }));
                    (calculateBreakeven as any).mockReturnValue(101);
                    (calculateProfitTarget as any)
                        .mockReturnValueOnce({
                            price: 110,
                            percentGain: 0.01,
                            netGain: 0.009,
                        })
                        .mockReturnValueOnce({
                            price: 120,
                            percentGain: 0.02,
                            netGain: 0.018,
                        });

                    const signal: Signal = {
                        id: `${type}-${side}-test`,
                        type,
                        time: Date.now(),
                        price: 100,
                        side,
                        signalData: {},
                    };

                    await manager.sendAlert(signal);

                    expect(fetch).toHaveBeenCalled();
                    const call = (fetch as any).mock.calls[0];
                    const body = JSON.parse(call[1].body);

                    // CRITICAL: AlertManager MUST use signal.side directly
                    expect(body.side).toBe(side);
                    expect(calculateBreakeven).toHaveBeenCalledWith(100, side);
                    expect(calculateProfitTarget).toHaveBeenCalledWith(
                        100,
                        side,
                        0.01
                    );
                    expect(calculateProfitTarget).toHaveBeenCalledWith(
                        100,
                        side,
                        0.02
                    );
                }
            }
        });
    });
});
