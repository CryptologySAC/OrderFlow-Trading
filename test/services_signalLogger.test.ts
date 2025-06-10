import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { WorkerSignalLogger } from "../src/multithreading/workerSignalLogger";
import { ThreadManager } from "../src/multithreading/threadManager";

// Mock ThreadManager
vi.mock("../src/multithreading/threadManager");

describe("services/WorkerSignalLogger", () => {
    let mockThreadManager: any;
    let workerSignalLogger: WorkerSignalLogger;

    beforeEach(() => {
        mockThreadManager = {
            logSignal: vi.fn(),
            log: vi.fn(),
        };
        workerSignalLogger = new WorkerSignalLogger(mockThreadManager);
    });

    it("logs signal events via ThreadManager", () => {
        const signalEvent = {
            timestamp: "t",
            type: "absorption",
            signalPrice: 1,
            side: "buy" as const,
        };

        workerSignalLogger.logEvent(signalEvent);

        expect(mockThreadManager.logSignal).toHaveBeenCalledWith(signalEvent);
    });

    it("logs processed signals via ThreadManager", () => {
        const processedSignal = {
            id: "1",
            originalCandidate: {
                id: "c1",
                type: "absorption",
                side: "buy",
                confidence: 1,
                timestamp: Date.now(),
                data: {} as any,
            },
            type: "absorption",
            confidence: 1,
            timestamp: new Date(),
            detectorId: "det",
            processingMetadata: {
                processedAt: new Date(),
                processingVersion: "1",
            },
            data: {} as any,
        };
        const metadata = { run: true };

        workerSignalLogger.logProcessedSignal(processedSignal, metadata);

        expect(mockThreadManager.log).toHaveBeenCalledWith(
            "info",
            "Signal processed",
            { signal: processedSignal, metadata }
        );
    });

    it("logs processing errors via ThreadManager", () => {
        const candidate = {
            id: "c1",
            type: "absorption",
            side: "buy",
            confidence: 1,
            timestamp: Date.now(),
            data: {} as any,
        };
        const error = new Error("Processing failed");
        const metadata = { run: true };

        workerSignalLogger.logProcessingError(candidate, error, metadata);

        expect(mockThreadManager.log).toHaveBeenCalledWith(
            "error",
            "Signal processing error",
            { candidate, error, metadata }
        );
    });
});
