import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const loadConfig = async () => {
    const mod = await import("../src/core/config");
    return mod.Config;
};

describe("core/config", () => {
    const env = process.env;

    beforeEach(() => {
        vi.resetModules();
        process.env = { ...env };
    });

    afterEach(() => {
        process.env = env;
    });

    it("uses environment variables", async () => {
        process.env.SYMBOL = "ethusdt";
        process.env.PORT = "4000";
        process.env.WS_PORT = "4001";
        const Config = await loadConfig();
        expect(Config.SYMBOL).toBe("ETHUSDT");
        expect(Config.HTTP_PORT).toBe(4000);
        expect(Config.WS_PORT).toBe(4001);
        expect(Config.TICK_SIZE).toBe(1 / Math.pow(10, Config.PRICE_PRECISION));
    });

    it("validate throws when required env missing", async () => {
        delete process.env.SYMBOL;
        const Config = await loadConfig();
        expect(() => Config.validate()).toThrow();
    });
});
