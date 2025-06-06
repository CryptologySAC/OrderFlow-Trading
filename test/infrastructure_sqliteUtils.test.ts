import { describe, it, expect, vi } from "vitest";
import { withBusyRetries, sleepSync } from "../src/infrastructure/sqliteUtils";

describe("infrastructure/sqliteUtils", () => {
    it("retries on SQLITE_BUSY", () => {
        let attempts = 0;
        const spy = vi.spyOn({ sleepSync }, "sleepSync");
        const result = withBusyRetries(
            () => {
                if (attempts++ < 1) {
                    const err: any = new Error("busy");
                    err.code = "SQLITE_BUSY";
                    throw err;
                }
                return "ok";
            },
            2,
            1
        );
        expect(result).toBe("ok");
        expect(spy).toHaveBeenCalled();
    });
});
