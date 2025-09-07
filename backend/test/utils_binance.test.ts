import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@binance/spot", () => ({
    Spot: vi.fn().mockImplementation(() => ({
        websocketStreams: { connect: vi.fn() },
        websocketAPI: { connect: vi.fn() },
    })),
    SPOT_WS_STREAMS_PROD_URL: "",
    SPOT_WS_API_PROD_URL: "",
}));

import type {
    BinanceDataFeed,
    BinanceConfigurationError,
} from "../src/utils/binance";

describe("utils/binance", () => {
    beforeEach(() => {
        vi.resetModules();
        delete process.env.API_KEY;
        delete process.env.API_SECRET;
    });

    it("throws when credentials missing", async () => {
        const mod = await import("../src/utils/binance");
        const { BinanceDataFeed, BinanceConfigurationError } = mod;
        expect(() => new BinanceDataFeed()).toThrow(BinanceConfigurationError);
    });

    it("constructs when credentials present", async () => {
        process.env.API_KEY = "1234567890";
        process.env.API_SECRET = "1234567890";
        const mod = await import("../src/utils/binance");
        const { BinanceDataFeed } = mod;
        const feed = new BinanceDataFeed();
        expect(feed).toBeInstanceOf(BinanceDataFeed);
    });
});
