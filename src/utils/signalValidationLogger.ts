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
// - CSV output format for ML training data
// - Real-time signal validation with market movement tracking
// - Comprehensive market context capture (volume patterns, zone data, price efficiency)
// - Signal performance metrics (accuracy, timing, reversal correlation)
// - Structured rejection logging for threshold optimization
// - Time-based performance analysis windows (5min, 15min, 1hr)

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
    confidence: number;

    // Market Context at Signal Time
    price: number;
    tradeQuantity: number;
    bestBid?: number;
    bestAsk?: number;
    spread?: number;

    // Volume Analysis
    totalAggressiveVolume: number;
    totalPassiveVolume: number;
    aggressiveBuyVolume: number;
    aggressiveSellVolume: number;
    passiveBidVolume: number;
    passiveAskVolume: number;
    volumeImbalance: number;
    institutionalVolumeRatio: number;

    // Zone Analysis
    activeZones: number;
    zoneTotalVolume: number;
    priceEfficiency: number | null;
    absorptionRatio?: number;
    exhaustionRatio?: number;
    depletionRatio?: number;

    // Signal Quality Metrics
    signalStrength: number;
    confluenceScore: number;
    institutionalFootprint: number;
    qualityGrade: "premium" | "standard" | "low";

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

    // Quality flags
    crossTimeframe?: boolean;
    institutionalVolume?: boolean;
    zoneConfluence?: boolean;
    exhaustionGap?: boolean;
    priceEfficiencyHigh?: boolean;

    // Threshold Checks (for CSV output)
    thresholdChecks:
        | AbsorptionThresholdChecks
        | ExhaustionThresholdChecks
        | DeltaCVDThresholdChecks;

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

    // Basic market context
    aggressiveVolume: number;
    passiveVolume: number;
    priceEfficiency: number | null;

    // EXHAUSTION: All 20 parameters
    exhaustion_minAggVolume?: number;
    exhaustion_timeWindowIndex?: number;
    exhaustion_exhaustionThreshold?: number;
    exhaustion_eventCooldownMs?: number;
    exhaustion_useStandardizedZones?: boolean;
    exhaustion_enhancementMode?: string;
    exhaustion_minEnhancedConfidenceThreshold?: number;
    exhaustion_depletionVolumeThreshold?: number;
    exhaustion_depletionRatioThreshold?: number;
    exhaustion_enableDepletionAnalysis?: boolean;
    exhaustion_varianceReductionFactor?: number;
    exhaustion_alignmentNormalizationFactor?: number;
    exhaustion_passiveVolumeExhaustionRatio?: number;
    exhaustion_aggressiveVolumeExhaustionThreshold?: number;
    exhaustion_aggressiveVolumeReductionFactor?: number;
    exhaustion_passiveRatioBalanceThreshold?: number;
    exhaustion_premiumConfidenceThreshold?: number;
    exhaustion_variancePenaltyFactor?: number;
    exhaustion_ratioBalanceCenterPoint?: number;

    // ABSORPTION: All 23 parameters
    absorption_minAggVolume?: number;
    absorption_timeWindowIndex?: number;
    absorption_eventCooldownMs?: number;
    absorption_priceEfficiencyThreshold?: number;
    absorption_maxAbsorptionRatio?: number;
    absorption_minPassiveMultiplier?: number;
    absorption_passiveAbsorptionThreshold?: number;
    absorption_expectedMovementScalingFactor?: number;
    absorption_liquidityGradientRange?: number;
    absorption_institutionalVolumeThreshold?: number;
    absorption_institutionalVolumeRatioThreshold?: number;
    absorption_enableInstitutionalVolumeFilter?: boolean;
    absorption_minAbsorptionScore?: number;
    absorption_finalConfidenceRequired?: number;
    absorption_maxZoneCountForScoring?: number;
    absorption_minEnhancedConfidenceThreshold?: number;
    absorption_useStandardizedZones?: boolean;
    absorption_enhancementMode?: string;
    absorption_balanceThreshold?: number;
    absorption_confluenceMinZones?: number;
    absorption_confluenceMaxDistance?: number;

    // DELTACVD: All 8 parameters
    deltacvd_minTradesPerSec?: number;
    deltacvd_minVolPerSec?: number;
    deltacvd_signalThreshold?: number;
    deltacvd_eventCooldownMs?: number;
    deltacvd_timeWindowIndex?: number;
    deltacvd_enhancementMode?: string;
    deltacvd_cvdImbalanceThreshold?: number;
    deltacvd_institutionalThreshold?: number;

    // THRESHOLD CHECKS - All actual thresholds and calculated values during detection
    thresholdChecks:
        | AbsorptionThresholdChecks
        | ExhaustionThresholdChecks
        | DeltaCVDThresholdChecks;

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

    // ALL 40+ parameter values from config that allowed this signal to pass
    parameterValues: {
        // EXHAUSTION DETECTOR - ALL PARAMETERS FROM CONFIG
        minAggVolume?: number;
        exhaustionThreshold?: number;
        timeWindowIndex?: number;
        eventCooldownMs?: number;
        useStandardizedZones?: boolean;
        enhancementMode?: string;
        minEnhancedConfidenceThreshold?: number;
        enableDepletionAnalysis?: boolean;
        depletionVolumeThreshold?: number;
        depletionRatioThreshold?: number;
        passiveVolumeExhaustionRatio?: number;
        varianceReductionFactor?: number;
        alignmentNormalizationFactor?: number;
        aggressiveVolumeExhaustionThreshold?: number;
        aggressiveVolumeReductionFactor?: number;
        passiveRatioBalanceThreshold?: number;
        premiumConfidenceThreshold?: number;
        variancePenaltyFactor?: number;
        ratioBalanceCenterPoint?: number;

        // ABSORPTION DETECTOR - ALL PARAMETERS FROM CONFIG
        absorptionThreshold?: number;
        priceEfficiencyThreshold?: number;
        maxAbsorptionRatio?: number;
        minPassiveMultiplier?: number;
        passiveAbsorptionThreshold?: number;
        expectedMovementScalingFactor?: number;
        liquidityGradientRange?: number;
        institutionalVolumeThreshold?: number;
        institutionalVolumeRatioThreshold?: number;
        enableInstitutionalVolumeFilter?: boolean;
        minAbsorptionScore?: number;
        finalConfidenceRequired?: number;
        maxZoneCountForScoring?: number;
        balanceThreshold?: number;
        confluenceMinZones?: number;
        confluenceMaxDistance?: number;

        // RUNTIME VALUES (calculated during signal)
        priceEfficiency?: number;
        confidence?: number;
        aggressiveVolume?: number;
        passiveVolume?: number;
        volumeRatio?: number;
        institutionalVolumeRatio?: number;

        // DELTACVD DETECTOR - ALL PARAMETERS FROM CONFIG
        minTradesPerSec?: number;
        minVolPerSec?: number;
        signalThreshold?: number;
        cvdImbalanceThreshold?: number;
        institutionalThreshold?: number;

        // DeltaCVD-specific runtime values
        cvdDivergenceStrength?: number;
        cvdAffectedZones?: number;
        buyVolume?: number;
        sellVolume?: number;
        cvdDelta?: number;
        buyRatio?: number;
        enhancedConfidence?: number;
    };

    // ✅ THRESHOLD CHECKS: For proper CSV header alignment
    thresholdChecks:
        | AbsorptionThresholdChecks
        | ExhaustionThresholdChecks
        | DeltaCVDThresholdChecks;

    // Market context
    marketVolume: number;
    marketSpread: number;
    marketVolatility: number;

    // Post-signal analysis (filled later)
    actualTPPrice?: number; // The price where TP was hit (if reached)
    actualSLPrice?: number; // The price where SL was hit (if reached)
    maxFavorableMove?: number; // The best price reached in favorable direction
    timeToTP?: number; // Minutes until TP was reached (if reached)
    wasTopOrBottomSignal?: boolean;
    signalQuality?: "top" | "bottom" | "noise";
    tpSlStatus?: "TP" | "SL" | "NEITHER"; // Target reached or stop loss hit

    // Quality flags
    crossTimeframe?: boolean;
    institutionalVolume?: boolean;
    zoneConfluence?: boolean;
    exhaustionGap?: boolean;
    priceEfficiencyHigh?: boolean;
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
        // Absorption detector files
        this.absorptionSignalsFilePath = path.join(
            this.outputDir,
            `absorption_validation_${this.currentDateString}.csv`
        );
        this.absorptionRejectionsFilePath = path.join(
            this.outputDir,
            `absorption_rejections_${this.currentDateString}.csv`
        );
        this.absorptionSuccessfulFilePath = path.join(
            this.outputDir,
            `absorption_successful_${this.currentDateString}.csv`
        );
        this.absorptionRejectedMissedFilePath = path.join(
            this.outputDir,
            `absorption_rejected_missed_${this.currentDateString}.csv`
        );

        // Exhaustion detector files
        this.exhaustionSignalsFilePath = path.join(
            this.outputDir,
            `exhaustion_validation_${this.currentDateString}.csv`
        );
        this.exhaustionRejectionsFilePath = path.join(
            this.outputDir,
            `exhaustion_rejections_${this.currentDateString}.csv`
        );
        this.exhaustionSuccessfulFilePath = path.join(
            this.outputDir,
            `exhaustion_successful_${this.currentDateString}.csv`
        );
        this.exhaustionRejectedMissedFilePath = path.join(
            this.outputDir,
            `exhaustion_rejected_missed_${this.currentDateString}.csv`
        );

        // DeltaCVD detector files
        this.deltacvdSignalsFilePath = path.join(
            this.outputDir,
            `deltacvd_validation_${this.currentDateString}.csv`
        );
        this.deltacvdRejectionsFilePath = path.join(
            this.outputDir,
            `deltacvd_rejections_${this.currentDateString}.csv`
        );
        this.deltacvdSuccessfulFilePath = path.join(
            this.outputDir,
            `deltacvd_successful_${this.currentDateString}.csv`
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
     * Initialize CSV log files with headers
     */
    private async initializeLogFiles(): Promise<void> {
        try {
            // Ensure output directory exists
            await fs.mkdir(this.outputDir, { recursive: true });

            // ✅ DETECTOR-SPECIFIC HEADERS: Create functions for each file type
            const getDetectorSpecificValidationHeader = (
                detectorType: "absorption" | "exhaustion" | "deltacvd"
            ): string => {
                const commonFields = [
                    "timestamp",
                    "signalId",
                    "detectorType",
                    "signalSide",
                    "price",
                ];

                const outcomeFields = [
                    "confidence",
                    "priceAt5min",
                    "priceAt15min",
                    "priceAt1hr",
                    "signalAccuracy5min",
                    "signalAccuracy15min",
                    "signalAccuracy1hr",
                    "TP_SL",
                    "crossTimeframe",
                    "institutionalVolume",
                    "zoneConfluence",
                    "exhaustionGap",
                    "priceEfficiencyHigh",
                ];

                let configParameters: string[] = [];
                switch (detectorType) {
                    case "exhaustion":
                        configParameters = [
                            "minAggVolume",
                            "exhaustionThreshold",
                            "timeWindowIndex",
                            "eventCooldownMs",
                            "useStandardizedZones",
                            "enhancementMode",
                            "minEnhancedConfidenceThreshold",
                            "enableDepletionAnalysis",
                            "depletionVolumeThreshold",
                            "depletionRatioThreshold",
                            "passiveVolumeExhaustionRatio",
                            "varianceReductionFactor",
                            "alignmentNormalizationFactor",
                            "aggressiveVolumeExhaustionThreshold",
                            "aggressiveVolumeReductionFactor",
                            "passiveRatioBalanceThreshold",
                            "premiumConfidenceThreshold",
                            "variancePenaltyFactor",
                            "ratioBalanceCenterPoint",
                        ];
                        break;
                    case "absorption":
                        configParameters = [
                            "minAggVolume",
                            "timeWindowIndex",
                            "eventCooldownMs",
                            "priceEfficiencyThreshold",
                            "maxAbsorptionRatio",
                            "minPassiveMultiplier",
                            "passiveAbsorptionThreshold",
                            "expectedMovementScalingFactor",
                            "liquidityGradientRange",
                            "institutionalVolumeThreshold",
                            "institutionalVolumeRatioThreshold",
                            "enableInstitutionalVolumeFilter",
                            "minAbsorptionScore",
                            "finalConfidenceRequired",
                            "maxZoneCountForScoring",
                            "minEnhancedConfidenceThreshold",
                            "useStandardizedZones",
                            "enhancementMode",
                            "balanceThreshold",
                            "confluenceMinZones",
                            "confluenceMaxDistance",
                        ];
                        break;
                    case "deltacvd":
                        configParameters = [
                            "minTradesPerSec",
                            "minVolPerSec",
                            "signalThreshold",
                            "eventCooldownMs",
                            "enhancementMode",
                            "cvdImbalanceThreshold",
                            "timeWindowIndex",
                            "institutionalThreshold",
                        ];
                        break;
                }
                return (
                    [
                        ...commonFields,
                        ...configParameters,
                        ...outcomeFields,
                    ].join(",") + "\n"
                );
            };

            const getDetectorSpecificRejectionHeader = (
                detectorType: "absorption" | "exhaustion" | "deltacvd"
            ): string => {
                const commonFields = [
                    "timestamp",
                    "detectorType",
                    "signalSide",
                    "rejectionReason",
                    "price",
                    "thresholdType",
                    "thresholdValue",
                    "actualValue",
                ];

                const outcomeFields = [
                    "confidence",
                    "actualTPPrice",
                    "actualSLPrice",
                    "maxFavorableMove",
                    "timeToTP",
                    "wasValidSignal",
                    "TP_SL",
                    "crossTimeframe",
                    "institutionalVolume",
                    "zoneConfluence",
                    "exhaustionGap",
                    "priceEfficiencyHigh",
                ];

                let configParameters: string[] = [];
                switch (detectorType) {
                    case "exhaustion":
                        configParameters = [
                            "minAggVolume",
                            "exhaustionThreshold",
                            "timeWindowIndex",
                            "eventCooldownMs",
                            "useStandardizedZones",
                            "enhancementMode",
                            "minEnhancedConfidenceThreshold",
                            "enableDepletionAnalysis",
                            "depletionVolumeThreshold",
                            "depletionRatioThreshold",
                            "passiveVolumeExhaustionRatio",
                            "varianceReductionFactor",
                            "alignmentNormalizationFactor",
                            "aggressiveVolumeExhaustionThreshold",
                            "aggressiveVolumeReductionFactor",
                            "passiveRatioBalanceThreshold",
                            "premiumConfidenceThreshold",
                            "variancePenaltyFactor",
                            "ratioBalanceCenterPoint",
                        ];
                        break;
                    case "absorption":
                        configParameters = [
                            "minAggVolume",
                            "timeWindowIndex",
                            "eventCooldownMs",
                            "priceEfficiencyThreshold",
                            "maxAbsorptionRatio",
                            "minPassiveMultiplier",
                            "passiveAbsorptionThreshold",
                            "expectedMovementScalingFactor",
                            "liquidityGradientRange",
                            "institutionalVolumeThreshold",
                            "institutionalVolumeRatioThreshold",
                            "enableInstitutionalVolumeFilter",
                            "minAbsorptionScore",
                            "finalConfidenceRequired",
                            "maxZoneCountForScoring",
                            "minEnhancedConfidenceThreshold",
                            "useStandardizedZones",
                            "enhancementMode",
                            "balanceThreshold",
                            "confluenceMinZones",
                            "confluenceMaxDistance",
                        ];
                        break;
                    case "deltacvd":
                        configParameters = [
                            "minTradesPerSec",
                            "minVolPerSec",
                            "signalThreshold",
                            "eventCooldownMs",
                            "enhancementMode",
                            "cvdImbalanceThreshold",
                            "timeWindowIndex",
                            "institutionalThreshold",
                        ];
                        break;
                }
                return (
                    [
                        ...commonFields,
                        ...configParameters,
                        ...outcomeFields,
                    ].join(",") + "\n"
                );
            };

            // ✅ DETECTOR-SPECIFIC HEADERS: Only config.json parameters + runtime values
            const getDetectorSpecificSuccessfulHeader = (
                detectorType: "absorption" | "exhaustion" | "deltacvd"
            ): string => {
                const commonFields = [
                    "timestamp",
                    "detectorType",
                    "signalSide",
                    "price",
                ];

                const outcomeFields = [
                    "confidence",
                    "actualTPPrice",
                    "actualSLPrice",
                    "maxFavorableMove",
                    "timeToTP",
                    "wasValidSignal",
                    "TP_SL",
                    "crossTimeframe",
                    "institutionalVolume",
                    "zoneConfluence",
                    "exhaustionGap",
                    "priceEfficiencyHigh",
                ];

                let configParameters: string[] = [];

                switch (detectorType) {
                    case "exhaustion":
                        configParameters = [
                            "minAggVolume",
                            "exhaustionThreshold",
                            "timeWindowIndex",
                            "eventCooldownMs",
                            "useStandardizedZones",
                            "enhancementMode",
                            "minEnhancedConfidenceThreshold",
                            "enableDepletionAnalysis",
                            "depletionVolumeThreshold",
                            "depletionRatioThreshold",
                            "passiveVolumeExhaustionRatio",
                            "varianceReductionFactor",
                            "alignmentNormalizationFactor",
                            "aggressiveVolumeExhaustionThreshold",
                            "aggressiveVolumeReductionFactor",
                            "passiveRatioBalanceThreshold",
                            "premiumConfidenceThreshold",
                            "variancePenaltyFactor",
                            "ratioBalanceCenterPoint",
                        ];
                        break;
                    case "absorption":
                        configParameters = [
                            "minAggVolume",
                            "timeWindowIndex",
                            "eventCooldownMs",
                            "priceEfficiencyThreshold",
                            "maxAbsorptionRatio",
                            "minPassiveMultiplier",
                            "passiveAbsorptionThreshold",
                            "expectedMovementScalingFactor",
                            "liquidityGradientRange",
                            "institutionalVolumeThreshold",
                            "institutionalVolumeRatioThreshold",
                            "enableInstitutionalVolumeFilter",
                            "minAbsorptionScore",
                            "finalConfidenceRequired",
                            "maxZoneCountForScoring",
                            "minEnhancedConfidenceThreshold",
                            "useStandardizedZones",
                            "enhancementMode",
                            "balanceThreshold",
                            "confluenceMinZones",
                            "confluenceMaxDistance",
                        ];
                        break;
                    case "deltacvd":
                        configParameters = [
                            "minTradesPerSec",
                            "minVolPerSec",
                            "signalThreshold",
                            "eventCooldownMs",
                            "enhancementMode",
                            "cvdImbalanceThreshold",
                            "timeWindowIndex",
                            "institutionalThreshold",
                        ];
                        break;
                }

                return (
                    [
                        ...commonFields,
                        ...configParameters,
                        ...outcomeFields,
                    ].join(",") + "\n"
                );
            };

            // ✅ DETECTOR-SPECIFIC FILE INITIALIZATION: Create all 9 detector-specific files
            const detectorTypes: ("absorption" | "exhaustion" | "deltacvd")[] =
                ["absorption", "exhaustion", "deltacvd"];

            for (const detectorType of detectorTypes) {
                // Initialize validation signals file with detector-specific header
                const signalsPath = this.getDetectorFilePath(
                    detectorType,
                    "signals"
                );
                try {
                    await fs.access(signalsPath);
                } catch {
                    const detectorSpecificValidationHeader =
                        getDetectorSpecificValidationHeader(detectorType);
                    await fs.writeFile(
                        signalsPath,
                        detectorSpecificValidationHeader
                    );
                }

                // Initialize rejections file with detector-specific header
                const rejectionsPath = this.getDetectorFilePath(
                    detectorType,
                    "rejections"
                );
                try {
                    await fs.access(rejectionsPath);
                } catch {
                    const detectorSpecificRejectionHeader =
                        getDetectorSpecificRejectionHeader(detectorType);
                    await fs.writeFile(
                        rejectionsPath,
                        detectorSpecificRejectionHeader
                    );
                }

                // Initialize successful signals file with detector-specific header
                const successfulPath = this.getDetectorFilePath(
                    detectorType,
                    "successful"
                );
                try {
                    await fs.access(successfulPath);
                } catch {
                    const detectorSpecificHeader =
                        getDetectorSpecificSuccessfulHeader(detectorType);
                    await fs.writeFile(successfulPath, detectorSpecificHeader);
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
                        // Use same header as rejections but will only contain signals that would have been TP
                        const rejectedMissedHeader =
                            getDetectorSpecificRejectionHeader(detectorType);
                        await fs.writeFile(
                            rejectedMissedPath,
                            rejectedMissedHeader
                        );
                    }
                }
            }

            this.logger.info(
                "SignalValidationLogger: DETECTOR-SPECIFIC CSV files initialized",
                {
                    detectorTypes: detectorTypes,
                    totalFiles: detectorTypes.length * 3, // 3 files per detector
                    maxBufferSize: this.maxBufferSize,
                    flushInterval: this.flushInterval,
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
        marketContext: {
            totalAggressiveVolume: number;
            totalPassiveVolume: number;
            aggressiveBuyVolume: number;
            aggressiveSellVolume: number;
            passiveBidVolume: number;
            passiveAskVolume: number;
            institutionalVolumeRatio: number;
            priceEfficiency: number | null;
            absorptionRatio?: number;
            exhaustionRatio?: number;
            depletionRatio?: number;
        }
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
                confidence: signal.confidence,

                // Market Context
                price: event.price,
                tradeQuantity: event.quantity,
                bestBid: event.bestBid ?? 0,
                bestAsk: event.bestAsk ?? 0,
                spread:
                    event.bestAsk && event.bestBid
                        ? event.bestAsk - event.bestBid
                        : -1,

                // Volume Analysis
                totalAggressiveVolume: marketContext.totalAggressiveVolume,
                totalPassiveVolume: marketContext.totalPassiveVolume,
                aggressiveBuyVolume: marketContext.aggressiveBuyVolume,
                aggressiveSellVolume: marketContext.aggressiveSellVolume,
                passiveBidVolume: marketContext.passiveBidVolume,
                passiveAskVolume: marketContext.passiveAskVolume,
                volumeImbalance: this.calculateVolumeImbalance(
                    marketContext.aggressiveBuyVolume,
                    marketContext.aggressiveSellVolume
                ),
                institutionalVolumeRatio:
                    marketContext.institutionalVolumeRatio,

                // Zone Analysis
                activeZones: event.zoneData ? event.zoneData.zones.length : 0,
                zoneTotalVolume: event.zoneData
                    ? this.calculateZoneTotalVolume(event.zoneData.zones)
                    : 0,
                priceEfficiency: marketContext.priceEfficiency,
                absorptionRatio: marketContext.absorptionRatio ?? 0,
                exhaustionRatio: marketContext.exhaustionRatio ?? 0,
                depletionRatio: marketContext.depletionRatio ?? 0,

                // Signal Quality Metrics
                signalStrength: signal.confidence,
                confluenceScore: this.calculateConfluenceScore(event),
                institutionalFootprint: marketContext.institutionalVolumeRatio,
                qualityGrade: this.determineQualityGrade(
                    signal.confidence,
                    marketContext.institutionalVolumeRatio
                ),

                // Quality flags from signal (default to false if not present)
                crossTimeframe: signal.qualityFlags?.crossTimeframe ?? false,
                institutionalVolume:
                    signal.qualityFlags?.institutionalVolume ?? false,
                zoneConfluence: signal.qualityFlags?.zoneConfluence ?? false,
                exhaustionGap: signal.qualityFlags?.exhaustionGap ?? false,
                priceEfficiencyHigh:
                    signal.qualityFlags?.priceEfficiency ?? false,

                // Store threshold checks for later use
                thresholdChecks: thresholdChecks,
            };

            // Store for validation tracking
            this.pendingValidations.set(signal.id, record);

            // Set up validation timers
            this.setupValidationTimers(signal.id, event.price);

            // Log immediately (partial record)
            this.writeSignalRecord(record, thresholdChecks);

            this.logger.info(
                "SignalValidationLogger: Signal logged for validation",
                {
                    signalId: signal.id,
                    detectorType: record.detectorType,
                    signalSide: record.signalSide,
                    price: record.price,
                    confidence: record.confidence,
                }
            );
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
        marketContext: {
            marketVolume: number;
            marketSpread: number;
            marketVolatility: number;
        },
        signalSide: "buy" | "sell"
    ): void {
        try {
            // Check for daily rotation before logging
            this.checkAndRotateFiles();

            // Convert thresholdChecks to parameterValues format for CSV output
            const parameterValues: SuccessfulSignalRecord["parameterValues"] =
                this.convertThresholdChecksToParameterValues(thresholdChecks);

            const record: SuccessfulSignalRecord = {
                timestamp: event.timestamp,
                detectorType,
                signalSide, // Mandatory - a signal without side is useless
                price: event.price,
                parameterValues,
                thresholdChecks, // ✅ Store for CSV alignment
                marketVolume: marketContext.marketVolume,
                marketSpread: marketContext.marketSpread,
                marketVolatility: marketContext.marketVolatility,
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

            this.logger.debug(
                "SignalValidationLogger: Successful signal parameters logged",
                {
                    detectorType,
                    price: event.price,
                    timestamp: event.timestamp,
                    parameterCount: Object.keys(parameterValues).length,
                }
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
     * ✅ Log rejected signal with ALL CALCULATED VALUES
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
        signalSide: "buy" | "sell"
    ): void {
        try {
            // Check for daily rotation before logging
            this.checkAndRotateFiles();

            // Use the thresholdChecks parameter directly
            const allThresholdChecks = thresholdChecks;

            // Extract basic values for backward compatibility
            // Note: We're extracting calculated values from the threshold checks
            const aggressiveVolume =
                "minAggVolume" in thresholdChecks
                    ? Number(thresholdChecks.minAggVolume.calculated) || 0
                    : 0;
            const passiveVolume = 0; // Not included in new interface
            const priceEfficiency =
                "priceEfficiencyThreshold" in thresholdChecks
                    ? Number(
                          thresholdChecks.priceEfficiencyThreshold?.calculated
                      ) || 0
                    : 0;

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

                // Basic market context (still needed for backward compatibility)
                aggressiveVolume,
                passiveVolume,
                priceEfficiency,

                // ✅ ALL THRESHOLD CHECKS: Every threshold and calculation the detector made
                thresholdChecks: allThresholdChecks,
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

            this.logger.debug(
                "SignalValidationLogger: Signal rejection logged",
                {
                    detectorType,
                    rejectionReason,
                    price: event.price,
                    thresholdType: thresholdDetails.type,
                    threshold: thresholdDetails.threshold,
                    actual: thresholdDetails.actual,
                }
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
     * Write signal record to CSV
     */
    private writeSignalRecord(
        record: SignalValidationRecord,
        thresholdChecks:
            | AbsorptionThresholdChecks
            | ExhaustionThresholdChecks
            | DeltaCVDThresholdChecks
    ): void {
        try {
            const commonFields = [
                record.timestamp,
                record.signalId,
                record.detectorType,
                record.signalSide,
                record.price,
            ];

            let calculatedFields: string[] = [];
            switch (record.detectorType) {
                case "deltacvd":
                    const deltacvdChecks =
                        thresholdChecks as DeltaCVDThresholdChecks;
                    calculatedFields = [
                        JSON.stringify(deltacvdChecks.minTradesPerSec),
                        JSON.stringify(deltacvdChecks.minVolPerSec),
                        JSON.stringify(deltacvdChecks.signalThreshold),
                        JSON.stringify(deltacvdChecks.eventCooldownMs),
                        JSON.stringify(deltacvdChecks.enhancementMode),
                        JSON.stringify(deltacvdChecks.cvdImbalanceThreshold),
                        JSON.stringify(deltacvdChecks.timeWindowIndex),
                        JSON.stringify(deltacvdChecks.institutionalThreshold),
                    ];
                    break;
                case "exhaustion":
                    const exhaustionChecks =
                        thresholdChecks as ExhaustionThresholdChecks;
                    calculatedFields = [
                        JSON.stringify(exhaustionChecks.minAggVolume),
                        JSON.stringify(exhaustionChecks.exhaustionThreshold),
                        JSON.stringify(exhaustionChecks.timeWindowIndex),
                        JSON.stringify(exhaustionChecks.eventCooldownMs),

                        JSON.stringify(
                            exhaustionChecks.passiveRatioBalanceThreshold
                        ),
                    ];
                    break;
                case "absorption":
                    const absorptionChecks =
                        thresholdChecks as AbsorptionThresholdChecks;
                    calculatedFields = [
                        JSON.stringify(absorptionChecks.minAggVolume),
                        JSON.stringify(absorptionChecks.timeWindowIndex),
                        JSON.stringify(absorptionChecks.eventCooldownMs),
                        JSON.stringify(
                            absorptionChecks.priceEfficiencyThreshold
                        ),
                        JSON.stringify(absorptionChecks.maxAbsorptionRatio),
                        JSON.stringify(absorptionChecks.minPassiveMultiplier),
                        JSON.stringify(
                            absorptionChecks.passiveAbsorptionThreshold
                        ),
                        JSON.stringify(
                            absorptionChecks.expectedMovementScalingFactor
                        ),

                        JSON.stringify(absorptionChecks.minAbsorptionScore),

                        JSON.stringify(absorptionChecks.maxZoneCountForScoring),
                        JSON.stringify(absorptionChecks.balanceThreshold),
                    ];
                    break;
            }

            const outcomeFields = [
                record.confidence,
                record.priceAt5min || "",
                record.priceAt15min || "",
                record.priceAt1hr || "",
                record.signalAccuracy5min !== undefined
                    ? record.signalAccuracy5min
                    : "",
                record.signalAccuracy15min !== undefined
                    ? record.signalAccuracy15min
                    : "",
                record.signalAccuracy1hr !== undefined
                    ? record.signalAccuracy1hr
                    : "",
                record.tpSlStatus || "",
                record.crossTimeframe || false,
                record.institutionalVolume || false,
                record.zoneConfluence || false,
                record.exhaustionGap || false,
                record.priceEfficiencyHigh || false,
            ];

            const csvLine =
                [...commonFields, ...calculatedFields, ...outcomeFields].join(
                    ","
                ) + "\n";

            // ✅ NON-BLOCKING: Add to detector-specific buffer instead of direct file write
            const detectorBuffer = this.getDetectorBuffer(
                record.detectorType,
                "signals"
            );
            detectorBuffer.push(csvLine);

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

    /**
     * ✅ DETECTOR-SPECIFIC CSV formatter for successful signals - explicit field extraction for header alignment
     * INSTITUTIONAL COMPLIANCE: Uses thresholdChecks parameter with JSON format for each column
     */
    private formatDetectorSpecificSuccessfulSignalCSV(
        record: SuccessfulSignalRecord,
        thresholdChecks:
            | AbsorptionThresholdChecks
            | ExhaustionThresholdChecks
            | DeltaCVDThresholdChecks
    ): string {
        // Try to find signalSide from validation record with same timestamp
        let signalSide = record.signalSide || "";
        if (!signalSide) {
            for (const [, validationRecord] of this.pendingValidations) {
                if (
                    validationRecord.timestamp === record.timestamp &&
                    validationRecord.detectorType === record.detectorType
                ) {
                    signalSide = validationRecord.signalSide;
                    break;
                }
            }
        }

        const commonFields = [
            record.timestamp,
            record.detectorType,
            signalSide,
            record.price,
        ];

        const outcomeFields = [
            record.parameterValues.confidence || "",
            record.actualTPPrice || "",
            record.actualSLPrice || "",
            record.maxFavorableMove || "",
            record.timeToTP || "",
            record.wasTopOrBottomSignal !== undefined
                ? record.wasTopOrBottomSignal
                : "",
            record.tpSlStatus || "",
            record.crossTimeframe || false,
            record.institutionalVolume || false,
            record.zoneConfluence || false,
            record.exhaustionGap || false,
            record.priceEfficiencyHigh || false,
        ];

        // ✅ NEW FORMAT: Output threshold checks as JSON for each parameter column
        let configParameters: string[] = [];

        switch (record.detectorType) {
            case "exhaustion":
                const exhaustionChecks =
                    thresholdChecks as ExhaustionThresholdChecks;
                configParameters = [
                    JSON.stringify(exhaustionChecks.minAggVolume),
                    JSON.stringify(exhaustionChecks.exhaustionThreshold),
                    JSON.stringify(exhaustionChecks.timeWindowIndex),
                    JSON.stringify(exhaustionChecks.eventCooldownMs),

                    JSON.stringify(
                        exhaustionChecks.passiveRatioBalanceThreshold
                    ),
                    JSON.stringify(exhaustionChecks.maxZonesPerSide),
                    JSON.stringify(exhaustionChecks.zoneDepletionThreshold),
                    JSON.stringify(exhaustionChecks.gapDetectionTicks),
                ];
                break;
            case "absorption":
                const absorptionChecks =
                    thresholdChecks as AbsorptionThresholdChecks;
                configParameters = [
                    JSON.stringify(absorptionChecks.minAggVolume),
                    JSON.stringify(absorptionChecks.timeWindowIndex),
                    JSON.stringify(absorptionChecks.eventCooldownMs),
                    JSON.stringify(absorptionChecks.priceEfficiencyThreshold),
                    JSON.stringify(absorptionChecks.maxAbsorptionRatio),
                    JSON.stringify(absorptionChecks.minPassiveMultiplier),
                    JSON.stringify(absorptionChecks.passiveAbsorptionThreshold),
                    JSON.stringify(
                        absorptionChecks.expectedMovementScalingFactor
                    ),
                    JSON.stringify(absorptionChecks.minAbsorptionScore),
                    JSON.stringify(absorptionChecks.maxZoneCountForScoring),
                    JSON.stringify(absorptionChecks.balanceThreshold),
                    JSON.stringify(absorptionChecks.maxZonesPerSide),
                    JSON.stringify(absorptionChecks.zoneHistoryWindowMs),
                    JSON.stringify(absorptionChecks.absorptionZoneThreshold),
                    JSON.stringify(absorptionChecks.minPassiveVolumeForZone),
                    JSON.stringify(absorptionChecks.priceStabilityTicks),
                    JSON.stringify(absorptionChecks.minAbsorptionEvents),
                ];
                break;
            case "deltacvd":
                const deltacvdChecks =
                    thresholdChecks as DeltaCVDThresholdChecks;
                configParameters = [
                    JSON.stringify(deltacvdChecks.minTradesPerSec),
                    JSON.stringify(deltacvdChecks.minVolPerSec),
                    JSON.stringify(deltacvdChecks.signalThreshold),
                    JSON.stringify(deltacvdChecks.eventCooldownMs),
                    JSON.stringify(deltacvdChecks.enhancementMode),
                    JSON.stringify(deltacvdChecks.cvdImbalanceThreshold),
                    JSON.stringify(deltacvdChecks.timeWindowIndex),
                    JSON.stringify(deltacvdChecks.institutionalThreshold),
                ];
                break;
        }

        const allFields = [
            ...commonFields,
            ...configParameters, // Already JSON strings
            ...outcomeFields.map(String),
        ];
        return allFields.join(",") + "\n";
    }

    /**
     * Write successful signal record to CSV
     * INSTITUTIONAL COMPLIANCE: Uses thresholdChecks for proper header alignment
     */
    private writeSuccessfulSignalRecord(
        record: SuccessfulSignalRecord,
        thresholdChecks:
            | AbsorptionThresholdChecks
            | ExhaustionThresholdChecks
            | DeltaCVDThresholdChecks
    ): void {
        try {
            // ✅ DETECTOR-SPECIFIC CSV LINE: Pass thresholdChecks for proper alignment
            const csvLine = this.formatDetectorSpecificSuccessfulSignalCSV(
                record,
                thresholdChecks
            );

            // ✅ NON-BLOCKING: Add to detector-specific buffer instead of direct file write
            const detectorBuffer = this.getDetectorBuffer(
                record.detectorType,
                "successful"
            );
            detectorBuffer.push(csvLine);

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

    /**
     * ✅ DETECTOR-SPECIFIC CSV formatter for rejections - explicit field extraction for header alignment
     * INSTITUTIONAL COMPLIANCE: Uses thresholdChecks parameter with JSON format for each column
     */
    private formatDetectorSpecificRejectionCSV(
        record: SignalRejectionRecord,
        thresholdChecks:
            | AbsorptionThresholdChecks
            | ExhaustionThresholdChecks
            | DeltaCVDThresholdChecks
    ): string {
        const commonFields = [
            record.timestamp,
            record.detectorType,
            record.signalSide || "",
            record.rejectionReason,
            record.price,
            record.thresholdType,
            record.thresholdValue,
            record.actualValue,
        ];

        const outcomeFields = [
            record.actualTPPrice || "",
            record.actualSLPrice || "",
            record.maxFavorableMove || "",
            record.timeToTP || "",
            record.wasValidSignal !== undefined ? record.wasValidSignal : "",
            record.tpSlStatus || "",
            record.crossTimeframe || false,
            record.institutionalVolume || false,
            record.zoneConfluence || false,
            record.exhaustionGap || false,
            record.priceEfficiencyHigh || false,
        ];

        // ✅ NEW FORMAT: Output threshold checks as JSON for each parameter column
        let configParameters: string[] = [];

        switch (record.detectorType) {
            case "exhaustion":
                const exhaustionChecks =
                    thresholdChecks as ExhaustionThresholdChecks;
                configParameters = [
                    JSON.stringify(exhaustionChecks.minAggVolume),
                    JSON.stringify(exhaustionChecks.exhaustionThreshold),
                    JSON.stringify(exhaustionChecks.timeWindowIndex),
                    JSON.stringify(exhaustionChecks.eventCooldownMs),

                    JSON.stringify(
                        exhaustionChecks.passiveRatioBalanceThreshold
                    ),
                    JSON.stringify(exhaustionChecks.maxZonesPerSide),
                    JSON.stringify(exhaustionChecks.zoneDepletionThreshold),
                    JSON.stringify(exhaustionChecks.gapDetectionTicks),
                ];
                break;
            case "absorption":
                const absorptionChecks =
                    thresholdChecks as AbsorptionThresholdChecks;
                configParameters = [
                    JSON.stringify(absorptionChecks.minAggVolume),
                    JSON.stringify(absorptionChecks.timeWindowIndex),
                    JSON.stringify(absorptionChecks.eventCooldownMs),
                    JSON.stringify(absorptionChecks.priceEfficiencyThreshold),
                    JSON.stringify(absorptionChecks.maxAbsorptionRatio),
                    JSON.stringify(absorptionChecks.minPassiveMultiplier),
                    JSON.stringify(absorptionChecks.passiveAbsorptionThreshold),
                    JSON.stringify(
                        absorptionChecks.expectedMovementScalingFactor
                    ),
                    JSON.stringify(absorptionChecks.minAbsorptionScore),
                    JSON.stringify(absorptionChecks.maxZoneCountForScoring),
                    JSON.stringify(absorptionChecks.balanceThreshold),
                    JSON.stringify(absorptionChecks.maxZonesPerSide),
                    JSON.stringify(absorptionChecks.zoneHistoryWindowMs),
                    JSON.stringify(absorptionChecks.absorptionZoneThreshold),
                    JSON.stringify(absorptionChecks.minPassiveVolumeForZone),
                    JSON.stringify(absorptionChecks.priceStabilityTicks),
                    JSON.stringify(absorptionChecks.minAbsorptionEvents),
                ];
                break;
            case "deltacvd":
                const deltacvdChecks =
                    thresholdChecks as DeltaCVDThresholdChecks;
                configParameters = [
                    JSON.stringify(deltacvdChecks.minTradesPerSec),
                    JSON.stringify(deltacvdChecks.minVolPerSec),
                    JSON.stringify(deltacvdChecks.signalThreshold),
                    JSON.stringify(deltacvdChecks.eventCooldownMs),
                    JSON.stringify(deltacvdChecks.enhancementMode),
                    JSON.stringify(deltacvdChecks.cvdImbalanceThreshold),
                    JSON.stringify(deltacvdChecks.timeWindowIndex),
                    JSON.stringify(deltacvdChecks.institutionalThreshold),
                ];
                break;
        }

        const allFields = [
            ...commonFields,
            ...configParameters, // Already JSON strings
            ...outcomeFields.map(String),
        ];
        return allFields.join(",") + "\n";
    }

    /**
     * Write rejected_missed record to CSV (rejections that would have been TP)
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

            // Use same CSV format as rejection records
            const csvLine = this.formatDetectorSpecificRejectionCSV(
                record,
                record.thresholdChecks
            );

            // Add to detector-specific rejected_missed buffer
            const detectorBuffer = this.getDetectorBuffer(
                record.detectorType,
                "rejected_missed"
            );
            detectorBuffer.push(csvLine);

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
     * Write rejection record to CSV
     * INSTITUTIONAL COMPLIANCE: Uses calculatedValues for proper header alignment
     */
    private writeRejectionRecord(record: SignalRejectionRecord): void {
        try {
            // ✅ DETECTOR-SPECIFIC CSV LINE: Pass thresholdChecks for proper alignment
            const csvLine = this.formatDetectorSpecificRejectionCSV(
                record,
                record.thresholdChecks
            );

            // ✅ NON-BLOCKING: Add to detector-specific buffer instead of direct file write
            const detectorBuffer = this.getDetectorBuffer(
                record.detectorType,
                "rejections"
            );
            detectorBuffer.push(csvLine);

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
     * Calculate volume imbalance ratio
     */
    private calculateVolumeImbalance(
        buyVolume: number,
        sellVolume: number
    ): number {
        const totalVolume = buyVolume + sellVolume;
        if (totalVolume === 0) return 0;

        const buyRatio = FinancialMath.divideQuantities(buyVolume, totalVolume);
        return Math.abs(buyRatio - 0.5); // Distance from perfect balance
    }

    /**
     * Calculate total volume across all zones
     */
    private calculateZoneTotalVolume(zones: unknown[]): number {
        return zones.reduce((total: number, zone) => {
            const typedZone = zone as {
                aggressiveVolume?: number;
                passiveVolume?: number;
            };
            return (
                total +
                (typedZone.aggressiveVolume || 0) +
                (typedZone.passiveVolume || 0)
            );
        }, 0);
    }

    /**
     * Calculate confluence score based on zone overlap
     */
    private calculateConfluenceScore(event: EnrichedTradeEvent): number {
        if (!event.zoneData) return 0;

        // Simple confluence score based on number of active zones
        const zoneCount = event.zoneData.zones.length;
        return Math.min(1.0, zoneCount / 10); // Normalize to 0-1 scale
    }

    /**
     * Determine signal quality grade
     */
    private determineQualityGrade(
        confidence: number,
        institutionalRatio: number
    ): "premium" | "standard" | "low" {
        if (confidence > 0.8 && institutionalRatio > 0.7) return "premium";
        if (confidence > 0.6 && institutionalRatio > 0.5) return "standard";
        return "low";
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
     * Convert thresholdChecks to parameterValues format for CSV output
     * INSTITUTIONAL COMPLIANCE: Maps threshold checks to expected CSV structure
     */
    private convertThresholdChecksToParameterValues(
        thresholdChecks:
            | AbsorptionThresholdChecks
            | ExhaustionThresholdChecks
            | DeltaCVDThresholdChecks
    ): SuccessfulSignalRecord["parameterValues"] {
        const result: SuccessfulSignalRecord["parameterValues"] = {};

        try {
            // Extract common fields that exist across all detector types
            if ("minAggVolume" in thresholdChecks) {
                result.minAggVolume = thresholdChecks.minAggVolume.calculated;
            }
            if ("timeWindowIndex" in thresholdChecks) {
                result.timeWindowIndex =
                    thresholdChecks.timeWindowIndex.calculated;
            }
            if ("eventCooldownMs" in thresholdChecks) {
                result.eventCooldownMs =
                    thresholdChecks.eventCooldownMs.calculated;
            }
            if ("enhancementMode" in thresholdChecks) {
                result.enhancementMode =
                    thresholdChecks.enhancementMode.calculated;
            }

            // Handle Exhaustion-specific fields
            if ("exhaustionThreshold" in thresholdChecks) {
                const exhaustionChecks = thresholdChecks;
                result.exhaustionThreshold =
                    exhaustionChecks.exhaustionThreshold.calculated;
                result.passiveRatioBalanceThreshold =
                    exhaustionChecks.passiveRatioBalanceThreshold.calculated;
            }

            // Handle Absorption-specific fields
            if ("priceEfficiencyThreshold" in thresholdChecks) {
                const absorptionChecks = thresholdChecks;
                result.priceEfficiencyThreshold =
                    absorptionChecks.priceEfficiencyThreshold.calculated;
                result.maxAbsorptionRatio =
                    absorptionChecks.maxAbsorptionRatio.calculated;
                result.minPassiveMultiplier =
                    absorptionChecks.minPassiveMultiplier.calculated;
                result.passiveAbsorptionThreshold =
                    absorptionChecks.passiveAbsorptionThreshold.calculated;
                result.expectedMovementScalingFactor =
                    absorptionChecks.expectedMovementScalingFactor.calculated;
                result.minAbsorptionScore =
                    absorptionChecks.minAbsorptionScore.calculated;

                result.maxZoneCountForScoring =
                    absorptionChecks.maxZoneCountForScoring.calculated;
                result.balanceThreshold =
                    absorptionChecks.balanceThreshold.calculated;
                result.absorptionThreshold =
                    absorptionChecks.maxAbsorptionRatio.calculated;

                // Set priceEfficiency from threshold for compatibility
                result.priceEfficiency =
                    absorptionChecks.priceEfficiencyThreshold.calculated;
            }

            // Handle DeltaCVD-specific fields
            if ("minTradesPerSec" in thresholdChecks) {
                const deltacvdChecks = thresholdChecks;
                result.minTradesPerSec =
                    deltacvdChecks.minTradesPerSec.calculated;
                result.minVolPerSec = deltacvdChecks.minVolPerSec.calculated;
                result.signalThreshold =
                    deltacvdChecks.signalThreshold.calculated;
                result.cvdImbalanceThreshold =
                    deltacvdChecks.cvdImbalanceThreshold.calculated;
                result.institutionalThreshold =
                    deltacvdChecks.institutionalThreshold.calculated;
            }

            return result;
        } catch (error) {
            this.logger.error(
                "SignalValidationLogger: Failed to convert thresholdChecks to parameterValues",
                {
                    error:
                        error instanceof Error ? error.message : String(error),
                }
            );
            return {};
        }
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
}
