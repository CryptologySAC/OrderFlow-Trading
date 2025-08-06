// __mocks__/src/utils/signalValidationLogger.ts

import { vi } from "vitest";
import type { SignalCandidate } from "../../../src/types/signalTypes.js";
import type { EnrichedTradeEvent } from "../../../src/types/marketEvents.js";

export class SignalValidationLogger {
    // Public method properties
    logSignal = vi.fn();
    logRejection = vi.fn();
    logSuccessfulSignal = vi.fn();
    updateCurrentPrice = vi.fn();
    cleanup = vi.fn();
    getValidationStats = vi.fn().mockReturnValue({
        pendingValidations: 0,
        totalLogged: 0,
    });
    run90MinuteOptimization = vi.fn();
    setupSuccessfulSignalValidationTimers = vi.fn();
    validateSuccessfulSignal = vi.fn();

    // Add all required properties to match the real interface
    public readonly signalsFilePath = "mock-signals.csv";
    public readonly rejectionsFilePath = "mock-rejections.csv";
    public readonly successfulSignalsFilePath = "mock-successful-signals.csv";
    public readonly pendingValidations = new Map();
    public readonly validationTimers = new Map();
    public readonly pendingRejections = new Map();
    public readonly successfulSignals = new Map();
    public readonly signalsBuffer: string[] = [];
    public readonly rejectionsBuffer: string[] = [];
    public readonly successfulSignalsBuffer: string[] = [];
    public readonly maxBufferSize = 100;
    public readonly flushInterval = 5000;
    private flushTimer?: NodeJS.Timeout;
    private optimizationTimer?: NodeJS.Timeout;
    private isInitialized = false;
    private currentPrice: number | null = null;
    public readonly logger: any;
    public readonly outputDir: string;

    // Detector-specific file paths (matching real interface)
    private absorptionSignalsFilePath: string = "";
    private absorptionRejectionsFilePath: string = "";
    private absorptionSuccessfulFilePath: string = "";
    private exhaustionSignalsFilePath: string = "";
    private exhaustionRejectionsFilePath: string = "";
    private exhaustionSuccessfulFilePath: string = "";
    private deltacvdSignalsFilePath: string = "";
    private deltacvdRejectionsFilePath: string = "";
    private deltacvdSuccessfulFilePath: string = "";
    private currentDateString: string = "";

    // Additional properties to match real interface
    private readonly pendingValidationSignals = new Map();
    private readonly validationWindow = 300000;
    private readonly rejectionValidationWindow = 900000;

    // Add all required private methods as mocks
    private initializeLogFiles = vi.fn();
    private startBackgroundFlushing = vi.fn();
    private flushBuffers = vi.fn();
    private flushSignalsBuffer = vi.fn();
    private flushRejectionsBuffer = vi.fn();
    private flushSuccessfulSignalsBuffer = vi.fn();
    private setupValidationTimers = vi.fn();
    private setupRejectionValidationTimers = vi.fn();
    private validateSignal = vi.fn();
    private validateRejection = vi.fn();
    private writeSignalRecord = vi.fn();
    private writeRejectionRecord = vi.fn();
    private writeSuccessfulSignalRecord = vi.fn();
    private calculateVolumeImbalance = vi.fn();
    private calculateZoneTotalVolume = vi.fn();
    private calculateConfluenceScore = vi.fn();
    private determineQualityGrade = vi.fn();
    private evaluateSignalAccuracy = vi.fn();
    private getCurrentPrice = vi.fn();
    private cleanupValidation = vi.fn();
    private start90MinuteOptimization = vi.fn();
    private processOptimizationCycle = vi.fn();
    private findOptimalParameters = vi.fn();
    private analyzeSuccessfulSignals = vi.fn();
    private groupSignalsByDetector = vi.fn();
    private extractParameterValues = vi.fn();
    private calculateParameterStats = vi.fn();
    private generateOptimizedConfig = vi.fn();
    private saveOptimizedConfig = vi.fn();
    private updateFilePaths = vi.fn();
    private getCurrentDateString = vi.fn().mockReturnValue("2024-01-01");
    private getDetectorFilePath = vi.fn();

    constructor(logger: any, outputDir: string = "logs/signal_validation") {
        this.logger = logger;
        this.outputDir = outputDir;
    }
}
