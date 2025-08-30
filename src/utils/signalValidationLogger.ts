// src/utils/signalValidationLogger.ts
//
// ✅ SIGNAL VALIDATION LOGGER: NON-BLOCKING signal performance tracking for real-time trading
//
// This module provides structured logging capabilities for exhaustion and absorption signals,
// capturing detailed performance metrics, market context, and validation data suitable for
// machine learning fine-tuning and systematic analysis.
//
// FEATURES:
// - NON-BLOCKING: Signal logging never blocks real-time trade processing
// - Internal buffering with background flushing for optimal performance
// - JSON Lines output format (.jsonl) for easy parsing and analysis
// - Real-time signal validation with market movement tracking
// - Comprehensive market context capture (volume patterns, zone data, price efficiency)
// - Signal performance metrics (accuracy, timing, reversal correlation)
// - Structured rejection logging for threshold optimization
// - Time-based performance analysis windows (5min, 15min, 1hr)
// - Complete threshold data preservation (no CSV comma conflicts)

import * as fs from "fs/promises";
import * as path from "path";
import { FinancialMath } from "./financialMath.js";
import type { ILogger } from "../infrastructure/loggerInterface.js";
import type {
    SignalCandidate,
    AbsorptionThresholdChecks,
    ExhaustionThresholdChecks,
    DeltaCVDThresholdChecks,
} from "../types/signalTypes.js";
import type { TraditionalIndicatorValues } from "../indicators/helpers/traditionalIndicators.js";
import type { EnrichedTradeEvent } from "../types/marketEvents.js";

/**
 * Signal validation data structure for ML training input
 */
export interface SignalValidationRecord {
    // Signal Identification
    timestamp: number;
    signalId: string;
    detectorType: "exhaustion" | "absorption" | "deltacvd";
    signalSide: "buy" | "sell";
    price: number;

    // Performance Validation (filled later)
    priceAt5min?: number;
    priceAt15min?: number;
    priceAt1hr?: number;
    movementDirection5min?: "up" | "down" | "sideways";
    movementDirection15min?: "up" | "down" | "sideways";
    movementDirection1hr?: "up" | "down" | "sideways";
    maxMovement5min?: number;
    maxMovement15min?: number;
    maxMovement1hr?: number;
    signalAccuracy5min?: boolean;
    signalAccuracy15min?: boolean;
    signalAccuracy1hr?: boolean;
    tpSlStatus?: "TP" | "SL" | "PENDING" | "NEITHER"; // Target reached or stop loss hit

    // Threshold Checks (for CSV output)
    thresholdChecks:
        | AbsorptionThresholdChecks
        | ExhaustionThresholdChecks
        | DeltaCVDThresholdChecks;

    // Traditional Indicators (for signal filtering analysis)
    traditionalIndicators: TraditionalIndicatorValues;

    // Rejection Analysis (for failed signals)
    rejectionReason?: string;
    thresholdValue?: number;
    actualValue?: number;
    missedOpportunity?: boolean;
}

/**
 * Signal rejection tracking for threshold optimization - ALL PARAMETERS INCLUDED
 */
export interface SignalRejectionRecord {
    timestamp: number;
    detectorType: "exhaustion" | "absorption" | "deltacvd";
    signalSide: "buy" | "sell";
    rejectionReason: string;
    price: number;

    // What caused rejection (primary failure)
    thresholdType: string;
    thresholdValue: number;
    actualValue: number;

    // THRESHOLD CHECKS - All actual thresholds and calculated values during detection
    thresholdChecks:
        | AbsorptionThresholdChecks
        | ExhaustionThresholdChecks
        | DeltaCVDThresholdChecks;

    // Traditional Indicators (for signal filtering analysis) - MANDATORY for analysis
    traditionalIndicators: TraditionalIndicatorValues;

    // Post-rejection analysis (filled later)
    actualTPPrice?: number; // The price where TP would have been hit (if reached)
    actualSLPrice?: number; // The price where SL would have been hit (if reached)
    maxFavorableMove?: number; // The best price reached in favorable direction
    timeToTP?: number; // Minutes until TP would have been reached (if reached)
    wasValidSignal?: boolean; // True if significant movement occurred despite rejection
    tpSlStatus?: "TP" | "SL" | "NEITHER"; // Would have hit target or stop loss

    // Quality flags (what signal had when rejected)
    crossTimeframe?: boolean;
    institutionalVolume?: boolean;
    zoneConfluence?: boolean;
    exhaustionGap?: boolean;
    priceEfficiencyHigh?: boolean;
}

/**
 * Successful signal parameter values for 90-minute optimization
 * INSTITUTIONAL COMPLIANCE: Includes calculatedValues for proper CSV alignment
 */
export interface SuccessfulSignalRecord {
    timestamp: number;
    detectorType: "exhaustion" | "absorption" | "deltacvd";
    signalSide: "buy" | "sell";
    price: number;

    // ✅ THRESHOLD CHECKS: For proper CSV header alignment
    thresholdChecks:
        | AbsorptionThresholdChecks
        | ExhaustionThresholdChecks
        | DeltaCVDThresholdChecks;

    // Traditional Indicators (for signal filtering analysis)
    traditionalIndicators: TraditionalIndicatorValues;

    // Post-signal analysis (filled later)
    actualTPPrice?: number; // The price where TP was hit (if reached)
    actualSLPrice?: number; // The price where SL was hit (if reached)
    maxFavorableMove?: number; // The best price reached in favorable direction
    timeToTP?: number; // Minutes until TP was reached (if reached)
    wasTopOrBottomSignal?: boolean;
    signalQuality?: "top" | "bottom" | "noise";
    tpSlStatus?: "TP" | "SL" | "NEITHER"; // Target reached or stop loss hit
}

/**
 * Signal Validation Logger - NON-BLOCKING signal performance tracking for real-time trading
 *
 * ✅ INSTITUTIONAL ARCHITECTURE: Internal buffering ensures signal processing never blocks on disk I/O
 */
export class SignalValidationLogger {
    // DETECTOR-SPECIFIC FILE PATHS
    private absorptionSignalsFilePath: string;
    private absorptionRejectionsFilePath: string;
    private absorptionSuccessfulFilePath: string;
    private absorptionRejectedMissedFilePath!: string; // Rejected signals that would have been TP

    private exhaustionSignalsFilePath: string;
    private exhaustionRejectionsFilePath: string;
    private exhaustionSuccessfulFilePath: string;
    private exhaustionRejectedMissedFilePath!: string; // Rejected signals that would have been TP

    private deltacvdSignalsFilePath: string;
    private deltacvdRejectionsFilePath: string;
    private deltacvdSuccessfulFilePath: string;
    private readonly pendingValidations = new Map<
        string,
        SignalValidationRecord
    >();
    private readonly validationTimers = new Map<string, NodeJS.Timeout[]>();
    private readonly pendingRejections = new Map<
        string,
        SignalRejectionRecord
    >();
    private readonly successfulSignals = new Map<
        string,
        SuccessfulSignalRecord
    >();

    // ✅ NON-BLOCKING ARCHITECTURE: Detector-specific buffering for high-performance logging
    private readonly absorptionSignalsBuffer: string[] = [];
    private readonly absorptionRejectionsBuffer: string[] = [];
    private readonly absorptionSuccessfulBuffer: string[] = [];
    private readonly absorptionRejectedMissedBuffer: string[] = [];

    private readonly exhaustionSignalsBuffer: string[] = [];
    private readonly exhaustionRejectionsBuffer: string[] = [];
    private readonly exhaustionSuccessfulBuffer: string[] = [];
    private readonly exhaustionRejectedMissedBuffer: string[] = [];

    private readonly deltacvdSignalsBuffer: string[] = [];
    private readonly deltacvdRejectionsBuffer: string[] = [];
    private readonly deltacvdSuccessfulBuffer: string[] = [];
    private readonly maxBufferSize = 100; // Flush after 100 entries
    private readonly flushInterval = 5000; // Flush every 5 seconds
    private flushTimer?: NodeJS.Timeout | undefined;
    private optimizationTimer?: NodeJS.Timeout | undefined;
    //private isInitialized = false;

    // Price tracking for validation
    private currentPrice: number | null = null;
    private priceHistory: Map<number, number> = new Map(); // timestamp -> price for stop loss tracking
    private readonly STOP_LOSS_THRESHOLD = 0.0035; // 0.35% stop loss
    private readonly TARGET_THRESHOLD = 0.007; // 0.7% target

    // Daily rotation tracking
    private currentDateString: string;

    constructor(
        private readonly logger: ILogger,
        private readonly outputDir: string = "logs/signal_validation"
    ) {
        this.currentDateString = this.getCurrentDateString();

        // Initialize detector-specific file paths
        this.absorptionSignalsFilePath = "";
        this.absorptionRejectionsFilePath = "";
        this.absorptionSuccessfulFilePath = "";
        this.exhaustionSignalsFilePath = "";
        this.exhaustionRejectionsFilePath = "";
        this.exhaustionSuccessfulFilePath = "";
        this.deltacvdSignalsFilePath = "";
        this.deltacvdRejectionsFilePath = "";
        this.deltacvdSuccessfulFilePath = "";

        this.updateFilePaths();

        void this.initializeLogFiles();

        // Start 90-minute optimization cycle
        this.start90MinuteOptimization();
    }

    /**
     * Get current date string for file naming (YYYY-MM-DD format)
     */
    private getCurrentDateString(): string {
        const [datePart] = new Date()
            .toISOString()
            .replace(/[:.]/g, "-")
            .split("T");
        return datePart!; // Ensure we have a valid date string
    }

    /**
     * Update detector-specific file paths with current date
     */
    private updateFilePaths(): void {
        // Absorption detector files - now JSON Lines format
        this.absorptionSignalsFilePath = path.join(
            this.outputDir,
            `absorption_validation_${this.currentDateString}.jsonl`
        );
        this.absorptionRejectionsFilePath = path.join(
            this.outputDir,
            `absorption_rejections_${this.currentDateString}.jsonl`
        );
        this.absorptionSuccessfulFilePath = path.join(
            this.outputDir,
            `absorption_successful_${this.currentDateString}.jsonl`
        );
        this.absorptionRejectedMissedFilePath = path.join(
            this.outputDir,
            `absorption_rejected_missed_${this.currentDateString}.jsonl`
        );

        // Exhaustion detector files - now JSON Lines format
        this.exhaustionSignalsFilePath = path.join(
            this.outputDir,
            `exhaustion_validation_${this.currentDateString}.jsonl`
        );
        this.exhaustionRejectionsFilePath = path.join(
            this.outputDir,
            `exhaustion_rejections_${this.currentDateString}.jsonl`
        );
        this.exhaustionSuccessfulFilePath = path.join(
            this.outputDir,
            `exhaustion_successful_${this.currentDateString}.jsonl`
        );
        this.exhaustionRejectedMissedFilePath = path.join(
            this.outputDir,
            `exhaustion_rejected_missed_${this.currentDateString}.jsonl`
        );

        // DeltaCVD detector files - now JSON Lines format
        this.deltacvdSignalsFilePath = path.join(
            this.outputDir,
            `deltacvd_validation_${this.currentDateString}.jsonl`
        );
        this.deltacvdRejectionsFilePath = path.join(
            this.outputDir,
            `deltacvd_rejections_${this.currentDateString}.jsonl`
        );
        this.deltacvdSuccessfulFilePath = path.join(
            this.outputDir,
            `deltacvd_successful_${this.currentDateString}.jsonl`
        );
    }

    /**
     * Get detector-specific file path
     */
    private getDetectorFilePath(
        detectorType: "exhaustion" | "absorption" | "deltacvd",
        fileType: "signals" | "rejections" | "successful" | "rejected_missed"
    ): string {
        switch (detectorType) {
            case "absorption":
                return fileType === "signals"
                    ? this.absorptionSignalsFilePath
                    : fileType === "rejections"
                      ? this.absorptionRejectionsFilePath
                      : fileType === "successful"
                        ? this.absorptionSuccessfulFilePath
                        : this.absorptionRejectedMissedFilePath;
            case "exhaustion":
                return fileType === "signals"
                    ? this.exhaustionSignalsFilePath
                    : fileType === "rejections"
                      ? this.exhaustionRejectionsFilePath
                      : fileType === "successful"
                        ? this.exhaustionSuccessfulFilePath
                        : this.exhaustionRejectedMissedFilePath;
            case "deltacvd":
                return fileType === "signals"
                    ? this.deltacvdSignalsFilePath
                    : fileType === "rejections"
                      ? this.deltacvdRejectionsFilePath
                      : this.deltacvdSuccessfulFilePath;
        }
    }

    /**
     * Get detector-specific buffer
     */
    private getDetectorBuffer(
        detectorType: "exhaustion" | "absorption" | "deltacvd",
        fileType: "signals" | "rejections" | "successful" | "rejected_missed"
    ): string[] {
        switch (detectorType) {
            case "absorption":
                return fileType === "signals"
                    ? this.absorptionSignalsBuffer
                    : fileType === "rejections"
                      ? this.absorptionRejectionsBuffer
                      : fileType === "successful"
                        ? this.absorptionSuccessfulBuffer
                        : this.absorptionRejectedMissedBuffer;
            case "exhaustion":
                return fileType === "signals"
                    ? this.exhaustionSignalsBuffer
                    : fileType === "rejections"
                      ? this.exhaustionRejectionsBuffer
                      : fileType === "successful"
                        ? this.exhaustionSuccessfulBuffer
                        : this.exhaustionRejectedMissedBuffer;
            case "deltacvd":
                return fileType === "signals"
                    ? this.deltacvdSignalsBuffer
                    : fileType === "rejections"
                      ? this.deltacvdRejectionsBuffer
                      : this.deltacvdSuccessfulBuffer;
        }
    }

    /**
     * Check if date has changed and rotate files if necessary
     */
    private checkAndRotateFiles(): boolean {
        const newDateString = this.getCurrentDateString();
        if (newDateString !== this.currentDateString) {
            this.logger.info(
                "SignalValidationLogger: Daily rotation detected",
                {
                    oldDate: this.currentDateString,
                    newDate: newDateString,
                    operation: "file_rotation",
                }
            );

            this.currentDateString = newDateString;
            this.updateFilePaths();

            // Initialize new files with headers
            void this.initializeLogFiles();

            return true;
        }
        return false;
    }

    /**
     * Initialize JSON Lines log files (no headers needed for JSON format)
     */
    private async initializeLogFiles(): Promise<void> {
        try {
            // Ensure output directory exists
            await fs.mkdir(this.outputDir, { recursive: true });

            // ✅ JSON LINES FORMAT: No headers needed, each line is complete JSON
            const detectorTypes: ("absorption" | "exhaustion" | "deltacvd")[] =
                ["absorption", "exhaustion", "deltacvd"];

            for (const detectorType of detectorTypes) {
                // Just ensure files exist - no headers for JSON Lines
                const signalsPath = this.getDetectorFilePath(
                    detectorType,
                    "signals"
                );
                try {
                    await fs.access(signalsPath);
                } catch {
                    await fs.writeFile(signalsPath, ""); // Empty file
                }

                const rejectionsPath = this.getDetectorFilePath(
                    detectorType,
                    "rejections"
                );
                try {
                    await fs.access(rejectionsPath);
                } catch {
                    await fs.writeFile(rejectionsPath, ""); // Empty file
                }

                const successfulPath = this.getDetectorFilePath(
                    detectorType,
                    "successful"
                );
                try {
                    await fs.access(successfulPath);
                } catch {
                    await fs.writeFile(successfulPath, ""); // Empty file
                }

                // Initialize rejected_missed file for absorption and exhaustion only
                if (
                    detectorType === "absorption" ||
                    detectorType === "exhaustion"
                ) {
                    const rejectedMissedPath = this.getDetectorFilePath(
                        detectorType,
                        "rejected_missed"
                    );
                    try {
                        await fs.access(rejectedMissedPath);
                    } catch {
                        await fs.writeFile(rejectedMissedPath, ""); // Empty file
                    }
                }
            }

            this.logger.info(
                "SignalValidationLogger: JSON Lines files initialized",
                {
                    detectorTypes: detectorTypes,
                    totalFiles: detectorTypes.length * 3, // 3 files per detector
                    maxBufferSize: this.maxBufferSize,
                    flushInterval: this.flushInterval,
                    format: "JSON Lines",
                    optimizationInterval: "90 minutes",
                }
            );

            // ✅ START BACKGROUND FLUSHING for non-blocking performance
            this.startBackgroundFlushing();
        } catch (error) {
            this.logger.error(
                "SignalValidationLogger: Failed to initialize log files",
                {
                    error:
                        error instanceof Error ? error.message : String(error),
                    outputDir: this.outputDir,
                }
            );
        }
    }

    /**
     * ✅ START BACKGROUND FLUSHING: Non-blocking buffer management for real-time performance
     */
    private startBackgroundFlushing(): void {
        this.flushTimer = setInterval(() => {
            // Check for daily rotation before flushing
            this.checkAndRotateFiles();
            this.flushBuffers();
        }, this.flushInterval);
    }

    /**
     * ✅ BACKGROUND BUFFER FLUSH: Asynchronous disk writes without blocking signal processing
     */
    private flushBuffers(): void {
        const detectorTypes: ("absorption" | "exhaustion" | "deltacvd")[] = [
            "absorption",
            "exhaustion",
            "deltacvd",
        ];

        for (const detectorType of detectorTypes) {
            // Flush signals buffer
            const signalsBuffer = this.getDetectorBuffer(
                detectorType,
                "signals"
            );
            if (signalsBuffer.length > 0) {
                const signalsToFlush = signalsBuffer.splice(0);
                void this.flushDetectorBuffer(
                    detectorType,
                    "signals",
                    signalsToFlush
                );
            }

            // Flush rejections buffer
            const rejectionsBuffer = this.getDetectorBuffer(
                detectorType,
                "rejections"
            );
            if (rejectionsBuffer.length > 0) {
                const rejectionsToFlush = rejectionsBuffer.splice(0);
                void this.flushDetectorBuffer(
                    detectorType,
                    "rejections",
                    rejectionsToFlush
                );
            }

            // Flush successful signals buffer
            const successfulBuffer = this.getDetectorBuffer(
                detectorType,
                "successful"
            );
            if (successfulBuffer.length > 0) {
                const successfulToFlush = successfulBuffer.splice(0);
                void this.flushDetectorBuffer(
                    detectorType,
                    "successful",
                    successfulToFlush
                );
            }

            // Flush rejected_missed buffer (only for absorption and exhaustion)
            if (
                detectorType === "absorption" ||
                detectorType === "exhaustion"
            ) {
                const rejectedMissedBuffer = this.getDetectorBuffer(
                    detectorType,
                    "rejected_missed"
                );
                if (rejectedMissedBuffer.length > 0) {
                    const rejectedMissedToFlush =
                        rejectedMissedBuffer.splice(0);
                    void this.flushDetectorBuffer(
                        detectorType,
                        "rejected_missed",
                        rejectedMissedToFlush
                    );
                }
            }
        }
    }

    /**
     * ✅ ASYNC DETECTOR BUFFER FLUSH: Background file writes to detector-specific files
     */
    private async flushDetectorBuffer(
        detectorType: "exhaustion" | "absorption" | "deltacvd",
        fileType: "signals" | "rejections" | "successful" | "rejected_missed",
        records: string[]
    ): Promise<void> {
        try {
            const content = records.join("");
            const filePath = this.getDetectorFilePath(detectorType, fileType);
            await fs.appendFile(filePath, content);
        } catch (error) {
            this.logger.error(
                `SignalValidationLogger: Failed to flush ${detectorType} ${fileType} buffer`,
                {
                    error:
                        error instanceof Error ? error.message : String(error),
                    recordCount: records.length,
                    detectorType,
                    fileType,
                }
            );
        }
    }

    /**
     * Start 90-minute automatic optimization cycle
     */
    private start90MinuteOptimization(): void {
        const optimizationInterval = 90 * 60 * 1000; // 90 minutes in milliseconds

        this.optimizationTimer = setInterval(() => {
            void this.run90MinuteOptimization();
        }, optimizationInterval);

        this.logger.info(
            "SignalValidationLogger: 90-minute optimization started",
            {
                intervalMinutes: 90,
                nextOptimization: new Date(
                    Date.now() + optimizationInterval
                ).toISOString(),
            }
        );
    }

    /**
     * Run 90-minute optimization analysis
     */
    private async run90MinuteOptimization(): Promise<void> {
        try {
            this.logger.info(
                "SignalValidationLogger: Starting 90-minute optimization analysis"
            );

            // Import and run the optimizer
            const { AutomaticParameterOptimizer } = await import(
                "./automaticParameterOptimizer.js"
            );
            const optimizer = new AutomaticParameterOptimizer(
                this.logger,
                this.outputDir
            );

            await optimizer.runOptimization();

            this.logger.info(
                "SignalValidationLogger: 90-minute optimization completed"
            );
        } catch (error) {
            this.logger.error(
                "SignalValidationLogger: Failed to run 90-minute optimization",
                {
                    error:
                        error instanceof Error ? error.message : String(error),
                }
            );
        }
    }

    /**
     * ✅ CLEANUP: Flush remaining buffers and clear timers
     */
    public cleanup(): void {
        if (this.flushTimer) {
            clearInterval(this.flushTimer);
            this.flushTimer = undefined;
        }

        if (this.optimizationTimer) {
            clearInterval(this.optimizationTimer);
            this.optimizationTimer = undefined;
        }

        // Final flush of any remaining buffered data
        this.flushBuffers();

        // Clear validation timers
        for (const [, timers] of this.validationTimers) {
            timers.forEach((timer) => clearTimeout(timer));
        }
        this.validationTimers.clear();
        this.pendingValidations.clear();
        this.pendingRejections.clear();
        this.successfulSignals.clear();
    }

    /**
     * Update current price for validation calculations
     */
    public updateCurrentPrice(price: number): void {
        this.currentPrice = price;
        // Store price history for stop loss tracking (keep last 2 hours)
        const now = Date.now();
        this.priceHistory.set(now, price);

        // Clean up old price history (older than 2 hours)
        const cutoff = now - 2 * 60 * 60 * 1000;
        for (const [timestamp] of this.priceHistory) {
            if (timestamp < cutoff) {
                this.priceHistory.delete(timestamp);
            } else {
                break; // Map is ordered by insertion, so we can stop once we hit recent entries
            }
        }
    }

    /**
     * ✅ NON-BLOCKING Log a generated signal for validation tracking
     * INSTITUTIONAL COMPLIANCE: Uses calculatedValues for data integrity
     */
    public logSignal(
        signal: SignalCandidate,
        event: EnrichedTradeEvent,
        thresholdChecks:
            | AbsorptionThresholdChecks
            | ExhaustionThresholdChecks
            | DeltaCVDThresholdChecks,
        traditionalIndicators: TraditionalIndicatorValues
    ): void {
        try {
            // Check for daily rotation before logging
            this.checkAndRotateFiles();

            const record: SignalValidationRecord = {
                // Signal Identification
                timestamp: signal.timestamp,
                signalId: signal.id,
                detectorType: signal.type as
                    | "exhaustion"
                    | "absorption"
                    | "deltacvd",
                signalSide: signal.side,

                // Market Context
                price: event.price,

                // Store threshold checks for later use
                thresholdChecks: thresholdChecks,

                // Traditional indicators (if provided)
                traditionalIndicators: traditionalIndicators,
            };

            // Store for validation tracking
            this.pendingValidations.set(signal.id, record);

            // Set up validation timers
            this.setupValidationTimers(signal.id, event.price);

            // Log immediately (partial record)
            this.writeSignalRecord(record, thresholdChecks);
        } catch (error) {
            this.logger.error("SignalValidationLogger: Failed to log signal", {
                signalId: signal.id,
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }

    /**
     * Log successful signal parameters for 90-minute optimization
     * INSTITUTIONAL COMPLIANCE: Uses calculatedValues interface for data integrity
     */
    public logSuccessfulSignal(
        detectorType: "exhaustion" | "absorption" | "deltacvd",
        event: EnrichedTradeEvent,
        thresholdChecks:
            | AbsorptionThresholdChecks
            | ExhaustionThresholdChecks
            | DeltaCVDThresholdChecks,
        signalSide: "buy" | "sell",
        traditionalIndicators: TraditionalIndicatorValues
    ): void {
        try {
            // Check for daily rotation before logging
            this.checkAndRotateFiles();

            // Convert thresholdChecks to parameterValues format for CSV output
            const record: SuccessfulSignalRecord = {
                timestamp: event.timestamp,
                detectorType,
                signalSide, // Mandatory - a signal without side is useless
                price: event.price,
                thresholdChecks, // ✅ Store for CSV alignment
                traditionalIndicators, // Traditional indicators (if provided)
            };

            // Store for validation tracking
            const recordId = `successful-${event.timestamp}-${Math.random()}`;
            this.successfulSignals.set(recordId, record);

            // Set up validation timers for 5min, 15min, and 90min
            this.setupSuccessfulSignalValidationTimers(
                recordId,
                event.price,
                record
            );
        } catch (error) {
            this.logger.error(
                "SignalValidationLogger: Failed to log successful signal",
                {
                    detectorType,
                    error:
                        error instanceof Error ? error.message : String(error),
                }
            );
        }
    }

    /**
     * ✅ Log rejected signal with ALL CALCULATED VALUES including MANDATORY traditional indicators
     *
     * CRITICAL: traditionalIndicators parameter is MANDATORY for precision analysis.
     * All callers MUST provide traditional indicator values to enable:
     * - Signal filtering accuracy analysis
     * - Traditional indicator optimization
     * - Phase direction correlation studies
     * - Dynamic color-changing line analysis
     */
    public logRejection(
        detectorType: "exhaustion" | "absorption" | "deltacvd",
        rejectionReason: string,
        event: EnrichedTradeEvent,
        thresholdDetails: {
            type: string;
            threshold: number;
            actual: number;
        },
        thresholdChecks:
            | AbsorptionThresholdChecks
            | ExhaustionThresholdChecks
            | DeltaCVDThresholdChecks,
        signalSide: "buy" | "sell",
        traditionalIndicators: TraditionalIndicatorValues
    ): void {
        try {
            // Check for daily rotation before logging
            this.checkAndRotateFiles();

            // Use the thresholdChecks parameter directly
            const allThresholdChecks = thresholdChecks;

            const record: SignalRejectionRecord = {
                timestamp: event.timestamp,
                detectorType,
                signalSide, // Mandatory - a rejection without side is useless for analysis
                rejectionReason,
                price: event.price,

                // Threshold details
                thresholdType: thresholdDetails.type,
                thresholdValue: thresholdDetails.threshold,
                actualValue: thresholdDetails.actual,

                // ✅ ALL THRESHOLD CHECKS: Every threshold and calculation the detector made
                thresholdChecks: allThresholdChecks,

                // Traditional indicators (if provided)
                traditionalIndicators,
            };

            // Store rejection for later validation
            const rejectionId = `rejection-${event.timestamp}-${Math.random()}`;
            this.pendingRejections.set(rejectionId, record);

            // Write rejection immediately to CSV (with empty movement fields)
            this.writeRejectionRecord(record);

            // Schedule retrospective analysis with validation timers for movement tracking
            this.setupRejectionValidationTimers(
                rejectionId,
                event.price,
                record
            );
        } catch (error) {
            this.logger.error(
                "SignalValidationLogger: Failed to log rejection",
                {
                    detectorType,
                    rejectionReason,
                    error:
                        error instanceof Error ? error.message : String(error),
                }
            );
        }
    }

    /**
     * Set up validation timers for signal performance tracking
     */
    private setupValidationTimers(signalId: string, signalPrice: number): void {
        const timers: NodeJS.Timeout[] = [];

        // 5-minute validation
        timers.push(
            setTimeout(
                () => {
                    this.validateSignal(signalId, signalPrice, "5min");
                },
                5 * 60 * 1000
            )
        );

        // 15-minute validation
        timers.push(
            setTimeout(
                () => {
                    this.validateSignal(signalId, signalPrice, "15min");
                },
                15 * 60 * 1000
            )
        );

        // 1-hour validation
        timers.push(
            setTimeout(
                () => {
                    this.validateSignal(signalId, signalPrice, "1hr");
                    // Clean up after final validation
                    this.cleanupValidation(signalId);
                },
                60 * 60 * 1000
            )
        );

        this.validationTimers.set(signalId, timers);
    }

    /**
     * Set up successful signal validation timers
     */
    private setupSuccessfulSignalValidationTimers(
        recordId: string,
        signalPrice: number,
        record: SuccessfulSignalRecord
    ): void {
        // 5-minute validation
        setTimeout(
            () => {
                this.validateSuccessfulSignal(signalPrice, record, "5min");
            },
            5 * 60 * 1000
        );

        // 15-minute validation
        setTimeout(
            () => {
                this.validateSuccessfulSignal(signalPrice, record, "15min");
            },
            15 * 60 * 1000
        );

        // 90-minute validation and final write (for optimization analysis)
        setTimeout(
            () => {
                this.validateSuccessfulSignal(signalPrice, record, "90min");

                // CRITICAL FIX: Only write to successful file if signal reached TP without hitting SL
                // A signal is only truly successful if it reached the target profit
                if (record.tpSlStatus === "TP") {
                    this.writeSuccessfulSignalRecord(
                        record,
                        record.thresholdChecks
                    );
                } else {
                    // Signal hit SL or didn't reach TP - log but don't write to successful file
                    this.logger.info(
                        "Signal did not meet success criteria, not writing to successful file",
                        {
                            signalId: recordId,
                            tpSlStatus: record.tpSlStatus,
                            signalQuality: record.signalQuality,
                            wasTopOrBottomSignal: record.wasTopOrBottomSignal,
                        }
                    );
                }

                this.successfulSignals.delete(recordId);
            },
            90 * 60 * 1000
        );
    }

    /**
     * Set up rejection validation timers
     */
    private setupRejectionValidationTimers(
        rejectionId: string,
        rejectionPrice: number,
        record: SignalRejectionRecord
    ): void {
        // 5-minute validation
        setTimeout(
            () => {
                this.validateRejection(
                    rejectionId,
                    rejectionPrice,
                    record,
                    "5min"
                );
            },
            5 * 60 * 1000
        );

        // 15-minute validation
        setTimeout(
            () => {
                this.validateRejection(
                    rejectionId,
                    rejectionPrice,
                    record,
                    "15min"
                );
            },
            15 * 60 * 1000
        );

        // 1-hour validation
        setTimeout(
            () => {
                this.validateRejection(
                    rejectionId,
                    rejectionPrice,
                    record,
                    "1hr"
                );
            },
            60 * 60 * 1000
        );

        // 90-minute final validation for rejected_missed tracking
        setTimeout(
            () => {
                this.validateRejection(
                    rejectionId,
                    rejectionPrice,
                    record,
                    "90min"
                );
                // Clean up after final validation
                this.pendingRejections.delete(rejectionId);
            },
            90 * 60 * 1000
        );
    }

    /**
     * Check if signal hit stop loss or target within a timeframe
     */
    private checkSignalOutcome(
        signalTimestamp: number,
        signalPrice: number,
        signalSide: "buy" | "sell",
        endTime: number
    ): {
        hitStopLoss: boolean;
        hitTarget: boolean;
        finalPrice: number | null;
        actualTPPrice: number | null;
        actualSLPrice: number | null;
        maxFavorableMove: number | null;
        timeToTP: number | null;
    } {
        const stopLossPrice =
            signalSide === "buy"
                ? signalPrice * (1 - this.STOP_LOSS_THRESHOLD) // Buy signal: stop loss below entry
                : signalPrice * (1 + this.STOP_LOSS_THRESHOLD); // Sell signal: stop loss above entry

        const targetPrice =
            signalSide === "buy"
                ? signalPrice * (1 + this.TARGET_THRESHOLD) // Buy signal: target above entry
                : signalPrice * (1 - this.TARGET_THRESHOLD); // Sell signal: target below entry

        let hitStopLoss = false;
        let hitTarget = false;
        let hitStopLossFirst = false;
        let finalPrice: number | null = null;

        // Track actual prices and timing
        let actualTPPrice: number | null = null;
        let actualSLPrice: number | null = null;
        let maxFavorableMove: number | null = null;
        let timeToTP: number | null = null;

        // Initialize max favorable move tracking
        let bestPriceSoFar = signalPrice;

        // Check price history from signal time to endTime
        for (const [timestamp, price] of this.priceHistory) {
            if (timestamp <= signalTimestamp) continue;
            if (timestamp > endTime) break;

            finalPrice = price;

            // Track max favorable move (best price in the direction we want)
            if (signalSide === "buy" && price > bestPriceSoFar) {
                bestPriceSoFar = price;
                maxFavorableMove = FinancialMath.divideQuantities(
                    price - signalPrice,
                    signalPrice
                );
            }
            if (signalSide === "sell" && price < bestPriceSoFar) {
                bestPriceSoFar = price;
                maxFavorableMove = FinancialMath.divideQuantities(
                    signalPrice - price,
                    signalPrice
                );
            }

            // Check for stop loss hit (only matters if TP not yet reached)
            if (!hitTarget) {
                if (signalSide === "buy" && price <= stopLossPrice) {
                    hitStopLoss = true;
                    hitStopLossFirst = true;
                    actualSLPrice = price;
                }
                if (signalSide === "sell" && price >= stopLossPrice) {
                    hitStopLoss = true;
                    hitStopLossFirst = true;
                    actualSLPrice = price;
                }
            }

            // Check for target hit
            if (!hitTarget) {
                if (signalSide === "buy" && price >= targetPrice) {
                    hitTarget = true;
                    actualTPPrice = price;
                    timeToTP = (timestamp - signalTimestamp) / (1000 * 60); // Convert to minutes
                }
                if (signalSide === "sell" && price <= targetPrice) {
                    hitTarget = true;
                    actualTPPrice = price;
                    timeToTP = (timestamp - signalTimestamp) / (1000 * 60); // Convert to minutes
                }
            }
        }

        // Return whether target was hit and if SL was hit BEFORE target
        hitStopLoss = hitStopLossFirst;

        // If we don't have enough price history, use current price
        if (finalPrice === null) {
            finalPrice = this.currentPrice;
        }

        return {
            hitStopLoss,
            hitTarget,
            finalPrice,
            actualTPPrice,
            actualSLPrice,
            maxFavorableMove,
            timeToTP,
        };
    }

    /**
     * Validate signal performance at specific time intervals
     */
    private validateSignal(
        signalId: string,
        originalPrice: number,
        timeframe: "5min" | "15min" | "1hr"
    ): void {
        const record = this.pendingValidations.get(signalId);
        if (!record) return;

        const currentPrice = this.currentPrice;

        if (currentPrice === null) {
            this.logger.warn(
                "SignalValidationLogger: No current price available for validation",
                {
                    signalId,
                    timeframe,
                }
            );
            return;
        }

        // Calculate timeframe end
        const timeframeMs =
            timeframe === "5min"
                ? 5 * 60 * 1000
                : timeframe === "15min"
                  ? 15 * 60 * 1000
                  : 60 * 60 * 1000;
        const endTime = record.timestamp + timeframeMs;

        // Check if stop loss or target was hit
        const outcome = this.checkSignalOutcome(
            record.timestamp,
            originalPrice,
            record.signalSide,
            endTime
        );

        const movement = FinancialMath.divideQuantities(
            Math.abs(currentPrice - originalPrice),
            originalPrice
        );

        const direction =
            currentPrice > originalPrice
                ? "up"
                : currentPrice < originalPrice
                  ? "down"
                  : "sideways";

        // Signal is accurate only if target hit WITHOUT stop loss
        const isAccurate = outcome.hitTarget && !outcome.hitStopLoss;

        // Update record
        switch (timeframe) {
            case "5min":
                record.priceAt5min = currentPrice;
                record.movementDirection5min = direction;
                record.maxMovement5min = movement;
                record.signalAccuracy5min = isAccurate;
                break;
            case "15min":
                record.priceAt15min = currentPrice;
                record.movementDirection15min = direction;
                record.maxMovement15min = movement;
                record.signalAccuracy15min = isAccurate;
                break;
            case "1hr":
                record.priceAt1hr = currentPrice;
                record.movementDirection1hr = direction;
                record.maxMovement1hr = movement;
                record.signalAccuracy1hr = isAccurate;

                // CRITICAL FIX: Proper success list categorization
                // Only signals that reach 0.7% TP within 90 minutes go to success list

                if (outcome.hitTarget) {
                    // Signal reached 0.7% TP within timeframe - goes to success list
                    if (outcome.hitStopLoss) {
                        // Hit 0.35% SL BEFORE reaching TP (but still reached TP later)
                        record.tpSlStatus = "SL";
                    } else {
                        // Reached TP directly without hitting SL first
                        record.tpSlStatus = "TP";
                    }
                    // Write to success/validation file - this signal was successful (reached TP)
                    this.writeSignalRecord(record, record.thresholdChecks);
                } else {
                    // Signal did NOT reach 0.7% TP within timeframe
                    // This is a FALSE signal - don't track it in success/validation
                    // Simply don't write it anywhere - it failed to reach TP
                    this.logger.debug(
                        "Signal failed to reach TP within timeframe, not tracking",
                        {
                            signalId: record.signalId,
                            price: record.price,
                            maxMovement: record.maxMovement1hr,
                        }
                    );
                }
                break;
        }

        this.logger.debug("SignalValidationLogger: Signal validated", {
            signalId,
            timeframe,
            originalPrice,
            currentPrice,
            movement,
            direction,
            isAccurate,
            hitStopLoss: outcome.hitStopLoss,
            hitTarget: outcome.hitTarget,
        });
    }

    /**
     * Validate successful signal to classify as top/bottom or noise
     */
    private validateSuccessfulSignal(
        originalPrice: number,
        record: SuccessfulSignalRecord,
        timeframe: "5min" | "15min" | "90min"
    ): void {
        const currentPrice = this.currentPrice;
        if (currentPrice === null) return;

        switch (timeframe) {
            case "5min":
            case "15min":
                // Skip these timeframes - we only validate at 90min
                break;
            case "90min":
                // Check if stop loss or target was hit within 90 minutes
                const endTime = record.timestamp + 90 * 60 * 1000;
                const outcome = this.checkSignalOutcome(
                    record.timestamp,
                    originalPrice,
                    record.signalSide,
                    endTime
                );

                // Store the actual price and timing data
                if (outcome.actualTPPrice !== null)
                    record.actualTPPrice = outcome.actualTPPrice;
                if (outcome.actualSLPrice !== null)
                    record.actualSLPrice = outcome.actualSLPrice;
                if (outcome.maxFavorableMove !== null)
                    record.maxFavorableMove = outcome.maxFavorableMove;
                if (outcome.timeToTP !== null)
                    record.timeToTP = outcome.timeToTP;

                // Signal is only successful if it reached target WITHOUT hitting stop loss
                record.wasTopOrBottomSignal =
                    outcome.hitTarget && !outcome.hitStopLoss;

                // Set TP/SL status
                if (outcome.hitStopLoss) {
                    record.tpSlStatus = "SL";
                    record.signalQuality = "noise"; // Stop loss hit = failed signal
                } else if (outcome.hitTarget) {
                    record.tpSlStatus = "TP";
                    // Determine if top or bottom signal based on max favorable move
                    if (
                        outcome.maxFavorableMove &&
                        outcome.maxFavorableMove >= this.TARGET_THRESHOLD
                    ) {
                        if (record.signalSide === "buy") {
                            record.signalQuality = "bottom"; // Buy signal that went up = bottom signal
                        } else {
                            record.signalQuality = "top"; // Sell signal that went down = top signal
                        }
                    } else {
                        record.signalQuality = "noise"; // Didn't reach significant movement
                    }
                } else {
                    record.tpSlStatus = "NEITHER";
                    record.signalQuality = "noise";
                }
                break;
        }
    }

    /**
     * Validate rejection to see if it was a missed opportunity
     */
    private validateRejection(
        rejectionId: string,
        originalPrice: number,
        record: SignalRejectionRecord,
        timeframe: "5min" | "15min" | "1hr" | "90min"
    ): void {
        const currentPrice = this.currentPrice;
        if (currentPrice === null) return;

        switch (timeframe) {
            case "5min":
            case "15min":
                // Skip these timeframes - we only validate meaningfully at 1hr and 90min
                break;
            case "1hr":
                // Write regular rejection record at 1hr
                this.writeRejectionRecord(record);
                break;

            case "90min":
                // Final validation to check if this was a missed opportunity
                // Determine what would have happened if signal was not rejected

                // Check if it would have hit target or stop loss within 90 minutes
                const endTime = record.timestamp + 90 * 60 * 1000;
                const outcome = this.checkSignalOutcome(
                    record.timestamp,
                    originalPrice,
                    record.signalSide,
                    endTime
                );

                // Store the actual price and timing data
                if (outcome.actualTPPrice !== null)
                    record.actualTPPrice = outcome.actualTPPrice;
                if (outcome.actualSLPrice !== null)
                    record.actualSLPrice = outcome.actualSLPrice;
                if (outcome.maxFavorableMove !== null)
                    record.maxFavorableMove = outcome.maxFavorableMove;
                if (outcome.timeToTP !== null)
                    record.timeToTP = outcome.timeToTP;

                // Signal was a missed opportunity if it would have hit target without stop loss
                record.wasValidSignal =
                    outcome.hitTarget && !outcome.hitStopLoss;

                // Set TP/SL status for what would have happened
                if (outcome.hitStopLoss) {
                    record.tpSlStatus = "SL";
                } else if (outcome.hitTarget) {
                    record.tpSlStatus = "TP";
                } else {
                    record.tpSlStatus = "NEITHER";
                }

                // CRITICAL: Write to rejected_missed file if this would have been successful
                // Only for absorption and exhaustion, and only if not rejected for minAggVolume
                if (
                    record.tpSlStatus === "TP" &&
                    (record.detectorType === "absorption" ||
                        record.detectorType === "exhaustion") &&
                    record.rejectionReason !== "Insufficient aggregate volume"
                ) {
                    this.writeRejectedMissedRecord(record);
                    this.logger.info(
                        "Rejected signal would have been successful - logged to rejected_missed",
                        {
                            rejectionId,
                            detectorType: record.detectorType,
                            reason: record.rejectionReason,
                            price: originalPrice,
                            wouldHaveBeenTP: true,
                        }
                    );
                }
                break;
        }
    }

    /**
     * Write signal record as JSON Lines
     */
    private writeSignalRecord(
        record: SignalValidationRecord,
        thresholdChecks:
            | AbsorptionThresholdChecks
            | ExhaustionThresholdChecks
            | DeltaCVDThresholdChecks
    ): void {
        try {
            // Create complete JSON object with all data
            const jsonRecord = {
                timestamp: record.timestamp,
                signalId: record.signalId,
                detectorType: record.detectorType,
                signalSide: record.signalSide,
                price: record.price,

                // Performance validation
                priceAt5min: record.priceAt5min,
                priceAt15min: record.priceAt15min,
                priceAt1hr: record.priceAt1hr,
                movementDirection5min: record.movementDirection5min,
                movementDirection15min: record.movementDirection15min,
                movementDirection1hr: record.movementDirection1hr,
                maxMovement5min: record.maxMovement5min,
                maxMovement15min: record.maxMovement15min,
                maxMovement1hr: record.maxMovement1hr,
                signalAccuracy5min: record.signalAccuracy5min,
                signalAccuracy15min: record.signalAccuracy15min,
                signalAccuracy1hr: record.signalAccuracy1hr,
                tpSlStatus: record.tpSlStatus,

                // Complete threshold checks for analysis
                thresholdChecks: thresholdChecks,

                // Traditional indicators for signal filtering analysis
                traditionalIndicators: record.traditionalIndicators,
            };

            // Convert to JSON string + newline (JSON Lines format)
            const jsonLine = JSON.stringify(jsonRecord) + "\n";

            // ✅ NON-BLOCKING: Add to detector-specific buffer instead of direct file write
            const detectorBuffer = this.getDetectorBuffer(
                record.detectorType,
                "signals"
            );
            detectorBuffer.push(jsonLine);

            // ✅ AUTO-FLUSH: Trigger flush if buffer is full
            if (detectorBuffer.length >= this.maxBufferSize) {
                this.flushBuffers();
            }
        } catch (error) {
            this.logger.error(
                "SignalValidationLogger: Failed to write signal record",
                {
                    signalId: record.signalId,
                    error:
                        error instanceof Error ? error.message : String(error),
                }
            );
        }
    }

    // Old CSV formatting functions removed - now using JSON Lines format

    /**
     * Write successful signal record as JSON Lines
     */
    private writeSuccessfulSignalRecord(
        record: SuccessfulSignalRecord,
        thresholdChecks:
            | AbsorptionThresholdChecks
            | ExhaustionThresholdChecks
            | DeltaCVDThresholdChecks
    ): void {
        try {
            // Create complete JSON object with all successful signal data
            const jsonRecord = {
                timestamp: record.timestamp,
                detectorType: record.detectorType,
                signalSide: record.signalSide,
                price: record.price,

                // Post-signal analysis
                actualTPPrice: record.actualTPPrice,
                actualSLPrice: record.actualSLPrice,
                maxFavorableMove: record.maxFavorableMove,
                timeToTP: record.timeToTP,
                wasTopOrBottomSignal: record.wasTopOrBottomSignal,
                signalQuality: record.signalQuality,
                tpSlStatus: record.tpSlStatus,

                // Complete threshold checks for analysis
                thresholdChecks: thresholdChecks,

                // Traditional indicators for successful signal analysis
                traditionalIndicators: record.traditionalIndicators,
            };

            // Convert to JSON string + newline (JSON Lines format)
            const jsonLine = JSON.stringify(jsonRecord) + "\n";

            // ✅ NON-BLOCKING: Add to detector-specific buffer instead of direct file write
            const detectorBuffer = this.getDetectorBuffer(
                record.detectorType,
                "successful"
            );
            detectorBuffer.push(jsonLine);

            // ✅ AUTO-FLUSH: Trigger flush if buffer is full
            if (detectorBuffer.length >= this.maxBufferSize) {
                this.flushBuffers();
            }
        } catch (error) {
            this.logger.error(
                "SignalValidationLogger: Failed to write successful signal record",
                {
                    timestamp: record.timestamp,
                    detectorType: record.detectorType,
                    error:
                        error instanceof Error ? error.message : String(error),
                }
            );
        }
    }

    // Old CSV rejection formatting function removed - now using JSON Lines format

    /**
     * Write rejected_missed record as JSON Lines (rejections that would have been TP)
     * INSTITUTIONAL COMPLIANCE: Only for absorption/exhaustion, excluding minAggVolume rejections
     */
    private writeRejectedMissedRecord(record: SignalRejectionRecord): void {
        try {
            // Only for absorption and exhaustion detectors
            if (
                record.detectorType !== "absorption" &&
                record.detectorType !== "exhaustion"
            ) {
                return;
            }

            // Create complete JSON object - same structure as rejection records
            const jsonRecord = {
                timestamp: record.timestamp,
                detectorType: record.detectorType,
                signalSide: record.signalSide,
                rejectionReason: record.rejectionReason,
                price: record.price,

                // Threshold details
                thresholdType: record.thresholdType,
                thresholdValue: record.thresholdValue,
                actualValue: record.actualValue,

                // Post-rejection analysis (why this was a missed opportunity)
                actualTPPrice: record.actualTPPrice,
                actualSLPrice: record.actualSLPrice,
                maxFavorableMove: record.maxFavorableMove,
                timeToTP: record.timeToTP,
                wasValidSignal: record.wasValidSignal,
                tpSlStatus: record.tpSlStatus,

                // Quality flags
                crossTimeframe: record.crossTimeframe,
                institutionalVolume: record.institutionalVolume,
                zoneConfluence: record.zoneConfluence,
                exhaustionGap: record.exhaustionGap,
                priceEfficiencyHigh: record.priceEfficiencyHigh,

                // Complete threshold checks for analysis
                thresholdChecks: record.thresholdChecks,

                // Mark this as a missed opportunity
                missedOpportunity: true,
            };

            // Convert to JSON string + newline (JSON Lines format)
            const jsonLine = JSON.stringify(jsonRecord) + "\n";

            // Add to detector-specific rejected_missed buffer
            const detectorBuffer = this.getDetectorBuffer(
                record.detectorType,
                "rejected_missed"
            );
            detectorBuffer.push(jsonLine);

            // Auto-flush if buffer is full
            if (detectorBuffer.length >= this.maxBufferSize) {
                this.flushBuffers();
            }
        } catch (error) {
            this.logger.error(
                "SignalValidationLogger: Failed to write rejected_missed record",
                {
                    timestamp: record.timestamp,
                    detectorType: record.detectorType,
                    reason: record.rejectionReason,
                    error:
                        error instanceof Error ? error.message : String(error),
                }
            );
        }
    }

    /**
     * Write rejection record as JSON Lines
     */
    private writeRejectionRecord(record: SignalRejectionRecord): void {
        try {
            // Create complete JSON object with all rejection data
            const jsonRecord = {
                timestamp: record.timestamp,
                detectorType: record.detectorType,
                signalSide: record.signalSide,
                rejectionReason: record.rejectionReason,
                price: record.price,

                // Threshold details
                thresholdType: record.thresholdType,
                thresholdValue: record.thresholdValue,
                actualValue: record.actualValue,

                // Post-rejection analysis
                actualTPPrice: record.actualTPPrice,
                actualSLPrice: record.actualSLPrice,
                maxFavorableMove: record.maxFavorableMove,
                timeToTP: record.timeToTP,
                wasValidSignal: record.wasValidSignal,
                tpSlStatus: record.tpSlStatus,

                // Quality flags
                crossTimeframe: record.crossTimeframe,
                institutionalVolume: record.institutionalVolume,
                zoneConfluence: record.zoneConfluence,
                exhaustionGap: record.exhaustionGap,
                priceEfficiencyHigh: record.priceEfficiencyHigh,

                // Complete threshold checks for analysis
                thresholdChecks: record.thresholdChecks,

                // Traditional indicators for rejection analysis
                traditionalIndicators: record.traditionalIndicators,
            };

            // Convert to JSON string + newline (JSON Lines format)
            const jsonLine = JSON.stringify(jsonRecord) + "\n";

            // ✅ NON-BLOCKING: Add to detector-specific buffer instead of direct file write
            const detectorBuffer = this.getDetectorBuffer(
                record.detectorType,
                "rejections"
            );
            detectorBuffer.push(jsonLine);

            // ✅ AUTO-FLUSH: Trigger flush if buffer is full
            if (detectorBuffer.length >= this.maxBufferSize) {
                this.flushBuffers();
            }
        } catch (error) {
            this.logger.error(
                "SignalValidationLogger: Failed to write rejection record",
                {
                    timestamp: record.timestamp,
                    detectorType: record.detectorType,
                    error:
                        error instanceof Error ? error.message : String(error),
                }
            );
        }
    }

    /**
     * Clean up validation timers and records
     */
    private cleanupValidation(signalId: string): void {
        // Clear timers
        const timers = this.validationTimers.get(signalId);
        if (timers) {
            timers.forEach((timer) => clearTimeout(timer));
            this.validationTimers.delete(signalId);
        }

        // Remove from pending validations
        this.pendingValidations.delete(signalId);
    }

    /**
     * Get validation statistics
     */
    public getValidationStats(): {
        pendingValidations: number;
        totalLogged: number;
    } {
        return {
            pendingValidations: this.pendingValidations.size,
            totalLogged: this.pendingValidations.size, // Simplified for this implementation
        };
    }

    /**
     * ✅ Create default traditional indicator values for backwards compatibility
     *
     * USAGE: When traditional indicators are not available but logging is required.
     * This ensures all logs have traditional indicator data while indicating insufficient data.
     *
     * @param reason - Reason why traditional indicators are not available
     * @returns TraditionalIndicatorValues with null values and appropriate reasons
     */
    public static createDefaultTraditionalIndicators(
        reason: string = "insufficient_data"
    ): TraditionalIndicatorValues {
        return {
            vwap: {
                value: null,
                deviation: null,
                deviationPercent: null,
                volume: 0,
                passed: true,
                reason,
            },
            rsi: {
                value: null,
                condition: "neutral",
                passed: true,
                periods: 14,
                reason,
            },
            oir: {
                value: null,
                buyVolume: 0,
                sellVolume: 0,
                totalVolume: 0,
                condition: "neutral",
                passed: true,
                reason,
            },
            overallDecision: "insufficient_data",
            filtersTriggered: [],
        };
    }
}
