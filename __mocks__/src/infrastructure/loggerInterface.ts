// __mocks__/src/infrastructure/loggerInterface.ts
import { vi } from "vitest";
import type { ILogger } from "../../../src/infrastructure/loggerInterface.js";

export const createMockLogger = (): ILogger => {
    // Create proper mock logger object that can be bound with 'this'
    const mockLogger: ILogger = {
        info: vi.fn(() => {}),
        warn: vi.fn(() => {}),
        error: vi.fn(() => {}),
        debug: vi.fn(() => {}),
        isDebugEnabled: vi.fn(() => false),
        setCorrelationId: vi.fn(() => {}),
        removeCorrelationId: vi.fn(() => {}),
    };

    return mockLogger;
};

// Default mock export - create a fresh instance each time
export default createMockLogger();
