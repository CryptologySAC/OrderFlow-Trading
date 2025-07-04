// __mocks__/src/infrastructure/loggerInterface.ts
import { vi } from "vitest";
import type { ILogger } from "../../../src/infrastructure/loggerInterface.js";

export const createMockLogger = (): ILogger => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
});

// Default mock export
export default createMockLogger();
