// backend/__mocks__/src/infrastructure/signalLoggerInterface.js
import { vi } from "vitest";

const createMockSignalLogger = () => {
    const mockSignalLogger = {
        logEvent: vi.fn((event) => {}),
        logProcessedSignal: vi.fn((signal, metadata) => {}),
        logProcessingError: vi.fn((candidate, error, metadata) => {}),
    };

    return mockSignalLogger;
};

// Default mock export
export default createMockSignalLogger();
export { createMockSignalLogger };
