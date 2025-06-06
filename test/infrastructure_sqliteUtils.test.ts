import { describe, it, expect } from "vitest";
import { withBusyRetries } from "../src/infrastructure/sqliteUtils";

describe("infrastructure/sqliteUtils", () => {
    it("retries on SQLITE_BUSY", () => {
        let attempts = 0;
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
        expect(attempts).toBe(2); // Should have retried once
    });
});
