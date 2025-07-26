// __mocks__/src/utils/signalValidationLogger.ts

import { vi } from "vitest";
import type { SignalCandidate } from "../../../src/types/signalTypes.js";
import type { EnrichedTradeEvent } from "../../../src/types/marketEvents.js";

export class SignalValidationLogger {
    public logSignal = vi.fn();
    public logRejection = vi.fn(
        (
            detectorType: "exhaustion" | "absorption" | "deltacvd",
            rejectionReason: string,
            event: EnrichedTradeEvent,
            thresholdDetails: {
                type: string;
                threshold: number;
                actual: number;
            },
            marketContext: {
                aggressiveVolume: number;
                passiveVolume: number;
                priceEfficiency: number | null;
                confidence: number;
            }
        ) => {
            // Mock implementation that matches the real interface
        }
    );
    public cleanup = vi.fn();
    public getValidationStats = vi.fn().mockReturnValue({
        pendingValidations: 0,
        totalLogged: 0,
    });

    // Add all required properties to match the real interface
    public readonly signalsFilePath = "mock-signals.csv";
    public readonly rejectionsFilePath = "mock-rejections.csv";
    public readonly pendingValidations = new Map();
    public readonly validationTimers = new Map();
    public readonly signalsBuffer: string[] = [];
    public readonly rejectionsBuffer: string[] = [];
    public readonly maxBufferSize = 100;
    public readonly flushInterval = 5000;
    public readonly logger: any;
    public readonly outputDir: string;

    // Add all required private methods as mocks
    private initializeLogFiles = vi.fn();
    private startBackgroundFlushing = vi.fn();
    private flushBuffers = vi.fn();
    private flushSignalsBuffer = vi.fn();
    private flushRejectionsBuffer = vi.fn();
    private setupValidationTimers = vi.fn();
    private setupRejectionValidationTimers = vi.fn();
    private validateSignal = vi.fn();
    private validateRejection = vi.fn();
    private writeSignalRecord = vi.fn();
    private writeRejectionRecord = vi.fn();
    private calculateVolumeImbalance = vi.fn();
    private calculateZoneTotalVolume = vi.fn();
    private calculateConfluenceScore = vi.fn();
    private determineQualityGrade = vi.fn();
    private evaluateSignalAccuracy = vi.fn();
    private getCurrentPrice = vi.fn();
    private cleanupValidation = vi.fn();

    constructor(logger: any, outputDir: string = "logs/signal_validation") {
        this.logger = logger;
        this.outputDir = outputDir;
    }
}
