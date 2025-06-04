import { describe, it, expect } from "vitest";
import { runMigrations } from "../src/infrastructure/migrate";

describe("infrastructure/migrate", () => {
    it("runs migration SQL", () => {
        const exec = vi.fn();
        runMigrations({ exec } as any);
        expect(exec).toHaveBeenCalled();
        expect(exec.mock.calls[0][0]).toContain("coordinator_queue");
    });
});
