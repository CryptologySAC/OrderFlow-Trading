// __mocks__/src/infrastructure/loggerInterface.ts
import { vi } from "vitest";
import type { ILogger } from "../../../src/infrastructure/loggerInterface.js";

export const createMockLogger = (): ILogger => {
    // Create actual bindable functions for AccumulationZoneDetectorEnhanced compatibility
    const info = vi.fn((msg, data) => console.log(`INFO: ${msg}`, data));
    const warn = vi.fn((msg, data) => console.log(`WARN: ${msg}`, data));
    const error = vi.fn((msg, data) => console.log(`ERROR: ${msg}`, data));
    const debug = vi.fn((msg, data) => console.log(`DEBUG: ${msg}`, data));
    const setCorrelationId = vi.fn();
    const removeCorrelationId = vi.fn();
    const isDebugEnabled = vi.fn().mockReturnValue(false);

    return {
        info,
        warn,
        error,
        debug,
        isDebugEnabled,
        setCorrelationId,
        removeCorrelationId,
    };
};

// Default mock export
export default createMockLogger();
