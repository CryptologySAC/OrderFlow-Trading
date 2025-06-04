import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Logger } from "../src/infrastructure/logger";

describe("infrastructure/logger", () => {
    let spy: any;
    beforeEach(() => {
        spy = vi.spyOn(console, "log").mockImplementation(() => {});
    });
    afterEach(() => {
        spy.mockRestore();
    });

    it("logs json when pretty is false", () => {
        const logger = new Logger(false);
        logger.info("test", { a: 1 }, "id");
        expect(spy).toHaveBeenCalled();
        const payload = JSON.parse(spy.mock.calls[0][0]);
        expect(payload.level).toBe("INFO");
        expect(payload.message).toBe("test");
        expect(payload.a).toBe(1);
        expect(payload.correlationId).toBe("id");
    });

    it("logs formatted output when pretty is true", () => {
        const logger = new Logger(true);
        logger.error("oops");
        expect(spy).toHaveBeenCalled();
        expect(spy.mock.calls[0][0]).toContain("[ERROR] oops");
    });
});
