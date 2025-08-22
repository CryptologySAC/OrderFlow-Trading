// __mocks__/src/utils/signalValidationLogger.ts

import { vi } from "vitest";
import type { SignalCandidate } from "../../../src/types/signalTypes.js";
import type { EnrichedTradeEvent } from "../../../src/types/marketEvents.js";

export class SignalValidationLogger {
    // Public method properties
    logSignal = vi
        .fn()
        .mockImplementation((signal: any, wasValidSignal: boolean) => {
            // Store signal data for test access
            this.validationData.set(signal.correlationId, {
                signal,
                wasValidSignal,
                priceHistory: {
                    prices: [signal.price],
                    timestamps: [signal.timestamp],
                },
            });
        });
    logRejection = vi.fn();
    logSuccessfulSignal = vi.fn();
    updateCurrentPrice = vi.fn();
    updatePrice = vi.fn().mockImplementation((price: number) => {
        // Update price history for all signals
        for (const [correlationId, data] of this.validationData.entries()) {
            data.priceHistory.prices.push(price);
            data.priceHistory.timestamps.push(Date.now());

            // Track when thresholds are hit for proper test behavior
            const signal = data.signal;
            const entryPrice = signal.price;
            const signalType = signal.signalType;

            if (signalType === "BOTTOM") {
                const targetPrice = entryPrice * (1 + this.TARGET_THRESHOLD);
                const stopLossPrice =
                    entryPrice * (1 - this.STOP_LOSS_THRESHOLD);

                if (!data.hitTargetAt && price >= targetPrice) {
                    data.hitTargetAt = Date.now();
                }
                if (!data.hitStopLossAt && price <= stopLossPrice) {
                    data.hitStopLossAt = Date.now();
                }
            } else {
                const targetPrice = entryPrice * (1 - this.TARGET_THRESHOLD);
                const stopLossPrice =
                    entryPrice * (1 + this.STOP_LOSS_THRESHOLD);

                if (!data.hitTargetAt && price <= targetPrice) {
                    data.hitTargetAt = Date.now();
                }
                if (!data.hitStopLossAt && price >= stopLossPrice) {
                    data.hitStopLossAt = Date.now();
                }
            }
        }
    });
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

    // Properties accessed by tests
    public readonly validationData = new Map();
    public readonly STOP_LOSS_THRESHOLD = 0.0035;
    public readonly TARGET_THRESHOLD = 0.007;

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
    private writeValidationFile = vi.fn();

    // Method accessed by tests
    public checkSignalOutcome = vi
        .fn()
        .mockImplementation((validationData: any, currentPrice: number) => {
            const entryPrice = validationData.signal?.price || 100;
            const signalType = validationData.signal?.signalType || "BOTTOM";

            const percentMove =
                ((currentPrice - entryPrice) / entryPrice) * 100;

            let targetPrice = 0;
            let stopLossPrice = 0;

            if (signalType === "BOTTOM") {
                // Long position
                targetPrice = entryPrice * (1 + this.TARGET_THRESHOLD);
                stopLossPrice = entryPrice * (1 - this.STOP_LOSS_THRESHOLD);
            } else {
                // Short position
                targetPrice = entryPrice * (1 - this.TARGET_THRESHOLD);
                stopLossPrice = entryPrice * (1 + this.STOP_LOSS_THRESHOLD);
            }

            // Check if thresholds were ever hit (based on historical tracking)
            const hitTarget = validationData.hitTargetAt !== undefined;
            const hitStopLoss = validationData.hitStopLossAt !== undefined;

            let outcome = "NEITHER";
            if (hitStopLoss && hitTarget) {
                // Both hit - check which was first
                outcome =
                    validationData.hitStopLossAt <= validationData.hitTargetAt
                        ? "SL"
                        : "TP";
            } else if (hitStopLoss) {
                outcome = "SL";
            } else if (hitTarget) {
                outcome = "TP";
            }

            return {
                hitTarget,
                hitStopLoss,
                outcome,
                targetPrice,
                stopLossPrice,
                percentMove,
            };
        });

    constructor(logger: any, outputDir: string = "logs/signal_validation") {
        this.logger = logger;
        this.outputDir = outputDir;
    }
}
