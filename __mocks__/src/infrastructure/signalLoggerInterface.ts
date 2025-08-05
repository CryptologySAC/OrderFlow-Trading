// __mocks__/src/infrastructure/signalLoggerInterface.ts
import { vi } from "vitest";
import type {
    ISignalLogger,
    SignalEvent,
} from "../../../src/infrastructure/signalLoggerInterface.js";
import type {
    ProcessedSignal,
    SignalCandidate,
} from "../../../src/types/signalTypes.js";

export const createMockSignalLogger = (): ISignalLogger => {
    const mockSignalLogger: ISignalLogger = {
        logEvent: vi.fn((event: SignalEvent) => {}),
        logProcessedSignal: vi.fn(
            (signal: ProcessedSignal, metadata: Record<string, unknown>) => {}
        ),
        logProcessingError: vi.fn(
            (
                candidate: SignalCandidate,
                error: Error,
                metadata: Record<string, unknown>
            ) => {}
        ),
    };

    return mockSignalLogger;
};

// Default mock export
export default createMockSignalLogger();
