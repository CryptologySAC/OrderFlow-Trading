// __mocks__/src/infrastructure/loggerInterface.ts
import { vi } from "vitest";
import type { ILogger } from "../../../src/infrastructure/loggerInterface.js";

export const createMockLogger = (): ILogger => {
    // Create actual bindable functions for AccumulationZoneDetectorEnhanced compatibility
    const info = vi.fn();
    const warn = vi.fn();
    const error = vi.fn();
    const debug = vi.fn();
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
