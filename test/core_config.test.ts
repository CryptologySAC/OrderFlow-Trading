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

    it("loads configuration from config.json", async () => {
        const Config = await loadConfig();
        expect(Config.SYMBOL).toBe("LTCUSDT");
        expect(Config.HTTP_PORT).toBe(3000);
        expect(Config.WS_PORT).toBe(3001);
        expect(Config.TICK_SIZE).toBe(1 / Math.pow(10, Config.PRICE_PRECISION));
    });

    it("ignores environment variables for ports", async () => {
        process.env.PORT = "4000";
        process.env.WS_PORT = "4001";
        const Config = await loadConfig();
        expect(Config.HTTP_PORT).toBe(3000);
        expect(Config.WS_PORT).toBe(3001);
    });

    it("validate passes without SYMBOL env", async () => {
        delete process.env.SYMBOL;
        const Config = await loadConfig();
        expect(() => Config.validate()).not.toThrow();
    });
});
